import { promises as fs } from "node:fs";
import path from "node:path";
import { upstreamFetchInit } from "./fetch-mode";
import { teamNameScore } from "./oddsetSettle";
import type { Odds, Outcome } from "./types";

/**
 * Multi-book odds scan for överodds-granskning.
 * Svenska Kambi-böcker (SVS/Unibet/Paf/ATG) har ofta samma priser.
 * Pinnacle används som sharp-referens (regulation 1X2).
 *
 * Oddsryck: när flera/alla leverantörer levererar samtidigt och oddsen
 * rör sig åt samma håll – det är nyckeln (inte att jaga överodds överallt).
 */

export type BookOddsQuote = {
  book: string;
  label: string;
  one: number | null;
  x: number | null;
  two: number | null;
};

/** Synkad oddsleverans / ryck över böcker */
export type OddsRyck = {
  /** Utgången oddsen kortats mot (marknaden "köper") */
  toward: Outcome | null;
  /** Utgången oddsen längats mot (marknaden "säljer") */
  awayFrom: Outcome | null;
  /** Antal SE-böcker som rört sig samma håll */
  booksMoved: number;
  booksTotal: number;
  /** Medel absolut %-rörelse på den starkaste sidan */
  avgDeltaPct: number;
  /** Nästan alla böcker + ev. sharp i samma riktning */
  allProvidersSync: boolean;
  /** Sharp (Pinnacle) rörde sig samma håll */
  sharpAligned: boolean;
  detectedAt: string;
  note: string;
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
  /** Ryck när leverantörer levererar samtidigt */
  ryck: OddsRyck | null;
};

type OddsSnapshot = {
  key: string;
  at: string;
  books: BookOddsQuote[];
  sharp: Odds | null;
};

const SNAP_FILE = path.join("/tmp", "mikaels-odds-ryck.json");
const SNAP_MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** Minsta oddsändring för att räkna som rörelse (andel) */
const RYCK_MIN_DELTA = 0.035;
/** Minsta antal böcker som måste röra sig samma håll */
const RYCK_MIN_BOOKS = 2;

declare global {
  // eslint-disable-next-line no-var
  var __tryckradOddsSnaps: Record<string, OddsSnapshot> | undefined;
}

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
  const candidates = betOffers.filter((bo) => {
    if (bo.betOfferType?.id !== 2) return false;
    const label = bo.criterion?.englishLabel || bo.criterion?.label || "";
    return /Match Odds/i.test(label) && !/Half|Period|Quarter/i.test(label);
  });
  // Ishockey: preferera regulation (X efter 60 min) framför OT-moneyline
  const ml =
    candidates.find((bo) =>
      /Regular Time|Ordinarie/i.test(
        bo.criterion?.englishLabel || bo.criterion?.label || ""
      )
    ) ||
    candidates.find((bo) => {
      const label = bo.criterion?.englishLabel || bo.criterion?.label || "";
      return !/Overtime|inkl/i.test(label);
    }) ||
    candidates[0];
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

function snapshotKey(args: {
  kambiEventId?: string | null;
  home: string;
  away: string;
  matchStart: string;
}): string {
  if (args.kambiEventId) return `kambi:${args.kambiEventId}`;
  return `m:${args.home}|${args.away}|${args.matchStart}`.toLowerCase();
}

async function loadSnapshots(): Promise<Record<string, OddsSnapshot>> {
  if (globalThis.__tryckradOddsSnaps) return globalThis.__tryckradOddsSnaps;
  try {
    const raw = await fs.readFile(SNAP_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, OddsSnapshot>;
    globalThis.__tryckradOddsSnaps = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    globalThis.__tryckradOddsSnaps = {};
  }
  return globalThis.__tryckradOddsSnaps!;
}

async function saveSnapshots(store: Record<string, OddsSnapshot>): Promise<void> {
  globalThis.__tryckradOddsSnaps = store;
  try {
    await fs.writeFile(SNAP_FILE, JSON.stringify(store), "utf8");
  } catch {
    /* ignore on read-only hosts */
  }
}

function sideDeltaPct(
  prev: number | null | undefined,
  next: number | null | undefined
): number | null {
  if (prev == null || next == null || prev <= 1 || next <= 1) return null;
  return (next - prev) / prev;
}

/**
 * Detekterar synkat oddsryck: flera leverantörer rör oddsen samma håll
 * när de levererar/uppdaterar samtidigt.
 */
export function detectOddsRyck(
  prev: OddsSnapshot | null | undefined,
  books: BookOddsQuote[],
  sharp: Odds | null
): OddsRyck | null {
  if (!prev?.books?.length || !books.length) return null;
  const age = Date.now() - Date.parse(prev.at);
  if (!Number.isFinite(age) || age < 20_000 || age > SNAP_MAX_AGE_MS) {
    return null;
  }

  const prevByBook = new Map(prev.books.map((b) => [b.book, b]));
  type SideMove = { shorten: number; lengthen: number; abs: number[]; n: number };
  const sides: Record<"one" | "x" | "two", SideMove> = {
    one: { shorten: 0, lengthen: 0, abs: [], n: 0 },
    x: { shorten: 0, lengthen: 0, abs: [], n: 0 },
    two: { shorten: 0, lengthen: 0, abs: [], n: 0 },
  };

  let booksCompared = 0;
  for (const cur of books) {
    const old = prevByBook.get(cur.book);
    if (!old) continue;
    booksCompared += 1;
    for (const side of ["one", "x", "two"] as const) {
      const d = sideDeltaPct(old[side], cur[side]);
      if (d == null || Math.abs(d) < RYCK_MIN_DELTA) continue;
      sides[side].n += 1;
      sides[side].abs.push(Math.abs(d) * 100);
      if (d < 0) sides[side].shorten += 1;
      else sides[side].lengthen += 1;
    }
  }
  if (booksCompared < RYCK_MIN_BOOKS) return null;

  let bestToward: Outcome | null = null;
  let bestAway: Outcome | null = null;
  let bestShorten = 0;
  let bestLengthen = 0;
  let bestAbs = 0;
  let bestMoved = 0;

  const sideToOutcome = { one: "1", x: "X", two: "2" } as const;
  for (const side of ["one", "x", "two"] as const) {
    const s = sides[side];
    if (s.shorten >= RYCK_MIN_BOOKS && s.shorten > bestShorten) {
      bestShorten = s.shorten;
      bestToward = sideToOutcome[side];
      bestAbs = s.abs.reduce((a, b) => a + b, 0) / Math.max(s.abs.length, 1);
      bestMoved = s.shorten;
    }
    if (s.lengthen >= RYCK_MIN_BOOKS && s.lengthen > bestLengthen) {
      bestLengthen = s.lengthen;
      bestAway = sideToOutcome[side];
      if (!bestToward) {
        bestAbs = s.abs.reduce((a, b) => a + b, 0) / Math.max(s.abs.length, 1);
        bestMoved = s.lengthen;
      }
    }
  }

  if (!bestToward && !bestAway) return null;

  // Sharp-alignment: Pinnacle kortar samma sida
  let sharpAligned = false;
  if (prev.sharp && sharp && bestToward) {
    const key =
      bestToward === "1" ? "one" : bestToward === "X" ? "x" : "two";
    const d = sideDeltaPct(prev.sharp[key], sharp[key]);
    if (d != null && d <= -RYCK_MIN_DELTA) sharpAligned = true;
  }

  const syncThreshold = Math.max(RYCK_MIN_BOOKS, Math.ceil(booksCompared * 0.75));
  const allProvidersSync =
    bestMoved >= syncThreshold && (sharpAligned || !prev.sharp || !sharp);

  const avgDeltaPct = Math.round(bestAbs * 10) / 10;
  const bits: string[] = [];
  if (bestToward) {
    bits.push(
      `Oddsryck mot ${bestToward}: ${bestMoved}/${booksCompared} böcker kortade samtidigt (ca ${avgDeltaPct.toFixed(0)} %)`
    );
  }
  if (bestAway && bestAway !== bestToward) {
    bits.push(`samtidigt längades ${bestAway}`);
  }
  if (allProvidersSync) {
    bits.push("alla leverantörer synkade – leveransryck");
  }
  if (sharpAligned) bits.push("Pinnacle samma håll");

  return {
    toward: bestToward,
    awayFrom: bestAway,
    booksMoved: bestMoved,
    booksTotal: booksCompared,
    avgDeltaPct,
    allProvidersSync,
    sharpAligned,
    detectedAt: new Date().toISOString(),
    note: bits.join(". "),
  };
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

  const key = snapshotKey({ kambiEventId, home, away, matchStart });
  const store = await loadSnapshots();
  const prev = store[key] ?? null;
  const ryck = detectOddsRyck(prev, allBooks, sharp);

  // Spara aktuell leverans för nästa jämförelse
  store[key] = {
    key,
    at: new Date().toISOString(),
    books: allBooks,
    sharp,
  };
  // Rensa gamla
  const now = Date.now();
  for (const [k, snap] of Object.entries(store)) {
    const t = Date.parse(snap.at);
    if (!Number.isFinite(t) || now - t > SNAP_MAX_AGE_MS) delete store[k];
  }
  await saveSnapshots(store);

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
  if (ryck?.note) bits.push(ryck.note);
  else if (!prev) bits.push("Första oddsleverans sparad – ryck syns vid nästa uppdatering");

  return {
    home,
    away,
    sharp,
    sharpLabel,
    books: allBooks,
    softEdgePct,
    booksChecked,
    note: bits.join(". "),
    ryck,
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
