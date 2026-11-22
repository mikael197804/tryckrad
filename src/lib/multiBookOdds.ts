import { upstreamFetchInit } from "./fetch-mode";
import { teamNameScore } from "./oddsetSettle";
import type { Odds, Outcome } from "./types";

/**
 * Multi-book odds scan for överodds-granskning.
 * Svenska Kambi-böcker (SVS/Unibet/Paf/ATG) har ofta samma priser.
 * Pinnacle används som sharp-referens (regulation 1X2).
 */

export type BookOddsQuote = {
  book: string;
  label: string;
  one: number | null;
  x: number | null;
  two: number | null;
};

export type MultiBookMatchOdds = {
  home: string;
  away: string;
  sharp: Odds | null;
  sharpLabel: string | null;
  books: BookOddsQuote[];
  /** SVS-odds relativt sharp: positiv = mjukare/högre än sharp */
  softEdgePct: { one: number | null; x: number | null; two: number | null };
  booksChecked: string[];
  note: string;
};

type PinMatchup = {
  id: number;
  startTime: string;
  league?: { name?: string };
  participants: Array<{ alignment?: string; name?: string }>;
};

type PinCatalog = {
  sport: "football" | "hockey";
  matchups: PinMatchup[];
  fetchedAt: number;
};

const PIN_SPORT: Record<"football" | "hockey", number> = {
  football: 29,
  hockey: 19,
};

const SE_KAMBI_OPS: Array<{ book: string; label: string }> = [
  { book: "svenskaspel", label: "Svenska Spel" },
  { book: "ubse", label: "Unibet" },
  { book: "pafse", label: "Paf" },
  { book: "atg", label: "ATG" },
];

let pinCache: Partial<Record<"football" | "hockey", PinCatalog>> = {};

function americanToDecimal(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || price === 0) return null;
  const d = price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
  return Math.round(d * 1000) / 1000;
}

function edgePct(svs: number | null, sharp: number | null): number | null {
  if (svs == null || sharp == null || sharp <= 1 || svs <= 1) return null;
  return Math.round((svs / sharp - 1) * 1000) / 10;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(
      url,
      upstreamFetchInit({
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; MikaelsTips/1.0; +https://tryckrad.vercel.app)",
        },
      })
    );
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadPinnacleCatalog(
  sport: "football" | "hockey"
): Promise<PinCatalog> {
  const cached = pinCache[sport];
  if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
    return cached;
  }
  const sportId = PIN_SPORT[sport];
  const raw = await fetchJson<PinMatchup[]>(
    `https://guest.api.arcadia.pinnacle.com/0.1/sports/${sportId}/matchups?brandId=0`
  );
  const matchups = (raw || []).filter(
    (m) =>
      (m as { type?: string }).type === "matchup" &&
      !m.participants?.some((p) => /over|under|yes|no/i.test(p.name || "")) &&
      (m.participants?.length || 0) >= 2
  );
  const catalog: PinCatalog = {
    sport,
    matchups: matchups as PinMatchup[],
    fetchedAt: Date.now(),
  };
  pinCache[sport] = catalog;
  return catalog;
}

function pickPinMatchup(
  catalog: PinCatalog,
  home: string,
  away: string,
  matchStart: string
): { matchup: PinMatchup; flipped: boolean; score: number } | null {
  const t0 = new Date(matchStart).getTime();
  if (!Number.isFinite(t0)) return null;
  let best: { matchup: PinMatchup; flipped: boolean; score: number } | null =
    null;

  for (const m of catalog.matchups) {
    const dt = Math.abs(new Date(m.startTime).getTime() - t0);
    if (dt > 36 * 60 * 60 * 1000) continue;
    const mh =
      m.participants.find((p) => p.alignment === "home")?.name ||
      m.participants[0]?.name ||
      "";
    const ma =
      m.participants.find((p) => p.alignment === "away")?.name ||
      m.participants[1]?.name ||
      "";
    const direct = teamNameScore(home, mh) + teamNameScore(away, ma);
    const flipped = teamNameScore(home, ma) + teamNameScore(away, mh);
    const score = Math.max(direct, flipped);
    if (!best || score > best.score) {
      best = { matchup: m, flipped: flipped > direct, score };
    }
  }
  if (!best || best.score < 1.35) return null;
  return best;
}

async function fetchPinnacle1x2(
  matchupId: number,
  sport: "football" | "hockey",
  flipped: boolean
): Promise<Odds | null> {
  const markets = await fetchJson<
    Array<{
      key?: string;
      type?: string;
      period?: number;
      prices?: Array<{ designation?: string; price?: number }>;
    }>
  >(
    `https://guest.api.arcadia.pinnacle.com/0.1/matchups/${matchupId}/markets/related/straight`
  );
  if (!markets?.length) return null;

  // Hockey: period 6 = regulation med kryss. Fotboll: period 0 moneyline.
  const preferKey = sport === "hockey" ? "s;6;m" : "s;0;m";
  const fallbackKey = "s;0;m";
  const money =
    markets.find((m) => m.key === preferKey) ||
    markets.find((m) => m.key === fallbackKey) ||
    markets.find((m) => m.type === "moneyline" && m.prices?.some((p) => p.designation === "draw"));

  if (!money?.prices?.length) return null;

  const homeP = money.prices.find((p) => p.designation === "home")?.price;
  const awayP = money.prices.find((p) => p.designation === "away")?.price;
  const drawP = money.prices.find((p) => p.designation === "draw")?.price;

  const one = americanToDecimal(flipped ? awayP : homeP);
  const two = americanToDecimal(flipped ? homeP : awayP);
  const x = americanToDecimal(drawP);
  if (one == null && two == null && x == null) return null;
  return { one, x, two };
}

function extractMatchOdds(
  betOffers: Array<{
    betOfferType?: { id?: number; name?: string };
    criterion?: { englishLabel?: string; label?: string };
    outcomes?: Array<{ type?: string; label?: string; odds?: number }>;
  }>
): Odds | null {
  const ml = betOffers.find((bo) => {
    if (bo.betOfferType?.id !== 2) return false;
    const label = bo.criterion?.englishLabel || bo.criterion?.label || "";
    return /Match Odds/i.test(label) && !/Half|Period|Quarter/i.test(label);
  });
  if (!ml?.outcomes?.length) return null;
  let one: number | null = null;
  let x: number | null = null;
  let two: number | null = null;
  for (const o of ml.outcomes) {
    const odds =
      o.odds != null && o.odds > 0
        ? Math.round((o.odds / 1000) * 1000) / 1000
        : null;
    if (odds == null) continue;
    if (o.type === "OT_ONE") one = odds;
    else if (o.type === "OT_CROSS") x = odds;
    else if (o.type === "OT_TWO") two = odds;
  }
  if (one == null && x == null && two == null) return null;
  return { one, x, two };
}

export async function fetchSwedishBookQuotes(
  kambiEventId: string | null | undefined
): Promise<BookOddsQuote[]> {
  if (!kambiEventId) return [];
  const quotes = await Promise.all(
    SE_KAMBI_OPS.map(async ({ book, label }) => {
      const data = await fetchJson<{
        betOffers?: Array<{
          betOfferType?: { id?: number; name?: string };
          criterion?: { englishLabel?: string; label?: string };
          outcomes?: Array<{ type?: string; label?: string; odds?: number }>;
        }>;
      }>(
        `https://eu.offering-api.kambicdn.com/offering/v2018/${book}/betoffer/event/${kambiEventId}.json?lang=sv_SE&market=SE`
      );
      const odds = data?.betOffers ? extractMatchOdds(data.betOffers) : null;
      if (!odds) return null;
      return { book, label, ...odds } satisfies BookOddsQuote;
    })
  );
  return quotes.filter((q): q is BookOddsQuote => q != null);
}

export async function resolveMultiBookOdds(args: {
  home: string;
  away: string;
  matchStart: string;
  sport: "football" | "hockey";
  kambiEventId?: string | null;
  svsOdds: Odds;
}): Promise<MultiBookMatchOdds> {
  const { home, away, matchStart, sport, kambiEventId, svsOdds } = args;

  const [catalog, books] = await Promise.all([
    loadPinnacleCatalog(sport),
    fetchSwedishBookQuotes(kambiEventId),
  ]);

  // Se till att SVS finns i listan även om Kambi-id saknas
  const hasSvs = books.some((b) => b.book === "svenskaspel");
  const allBooks: BookOddsQuote[] = hasSvs
    ? books
    : [
        {
          book: "svenskaspel",
          label: "Svenska Spel",
          one: svsOdds.one,
          x: svsOdds.x,
          two: svsOdds.two,
        },
        ...books,
      ];

  let sharp: Odds | null = null;
  let sharpLabel: string | null = null;
  const pinHit = pickPinMatchup(catalog, home, away, matchStart);
  if (pinHit) {
    sharp = await fetchPinnacle1x2(pinHit.matchup.id, sport, pinHit.flipped);
    if (sharp) {
      const league = pinHit.matchup.league?.name || "Pinnacle";
      sharpLabel = `Pinnacle (${league})`;
    }
  }

  const softEdgePct = {
    one: edgePct(svsOdds.one, sharp?.one ?? null),
    x: edgePct(svsOdds.x, sharp?.x ?? null),
    two: edgePct(svsOdds.two, sharp?.two ?? null),
  };

  const booksChecked = [
    ...allBooks.map((b) => b.label),
    ...(sharpLabel ? [sharpLabel] : []),
  ];

  const bits: string[] = [];
  bits.push(`Böcker: ${allBooks.map((b) => b.label).join(", ") || "SVS"}`);
  if (sharpLabel && sharp) {
    bits.push(
      `Sharp ${sharpLabel}: ${fmtO(sharp.one)}/${fmtO(sharp.x)}/${fmtO(sharp.two)}`
    );
  } else {
    bits.push("Ingen Pinnacle-match – sharp saknas");
  }

  // Notera om SE-böcker skiljer sig (ovanligt på Kambi)
  const spread = bookSpread(allBooks);
  if (spread) bits.push(spread);

  return {
    home,
    away,
    sharp,
    sharpLabel,
    books: allBooks,
    softEdgePct,
    booksChecked,
    note: bits.join(". "),
  };
}

function fmtO(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toFixed(2).replace(".", ",");
}

function bookSpread(books: BookOddsQuote[]): string | null {
  if (books.length < 2) return null;
  const diffs: string[] = [];
  for (const side of ["one", "x", "two"] as const) {
    const vals = books
      .map((b) => b[side])
      .filter((v): v is number => v != null && v > 1);
    if (vals.length < 2) continue;
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max / min >= 1.06) {
      const label = side === "one" ? "1" : side === "x" ? "X" : "2";
      diffs.push(`${label} ${min.toFixed(2)}–${max.toFixed(2)}`);
    }
  }
  if (!diffs.length) {
    return "SE-böcker i princip samma Kambi-pris";
  }
  return `Avvikelse mellan SE-böcker: ${diffs.join(", ")}`;
}

export function softEdgeForOutcome(
  multi: MultiBookMatchOdds | null | undefined,
  outcome: Outcome
): number | null {
  if (!multi) return null;
  if (outcome === "1") return multi.softEdgePct.one;
  if (outcome === "X") return multi.softEdgePct.x;
  return multi.softEdgePct.two;
}

export function sharpOddsForOutcome(
  multi: MultiBookMatchOdds | null | undefined,
  outcome: Outcome
): number | null {
  if (!multi?.sharp) return null;
  if (outcome === "1") return multi.sharp.one;
  if (outcome === "X") return multi.sharp.x;
  return multi.sharp.two;
}
