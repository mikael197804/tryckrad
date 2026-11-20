export type OddsetMarket = "over_1_5" | "over_2_5";

export type OddsetCandidate = {
  eventId: number;
  home: string;
  away: string;
  league: string;
  country: string;
  kickoff: string;
  market: OddsetMarket;
  line: 1.5 | 2.5;
  odds: number;
  odds15: number | null;
  odds25: number | null;
  score: number;
  reason: string;
  url: string;
};

export type OddsetDayTip = {
  playDate: string;
  playDateLabel: string;
  generatedAt: string;
  selected: OddsetCandidate | null;
  candidates: OddsetCandidate[];
  analyzedCount: number;
  eligibleCount: number;
  rules: string[];
  disclaimer: string;
};

const KAMBI_BASE =
  "https://eu.offering-api.kambicdn.com/offering/v2018/svenskaspel";

const STOCKHOLM = "Europe/Stockholm";

type KambiEvent = {
  id: number;
  name: string;
  homeName?: string;
  awayName?: string;
  start: string;
  group?: string;
  path?: Array<{ name?: string; englishName?: string; termKey?: string }>;
};

type KambiOutcome = {
  label?: string;
  odds?: number;
  line?: number;
};

type KambiBetOffer = {
  eventId?: number;
  criterion?: { label?: string; englishLabel?: string };
  betOfferType?: { id?: number; englishName?: string };
  outcomes?: KambiOutcome[];
};

function stockholmDateIso(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCKHOLM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Kalenderdagen efter i svensk tid (speldag som inte krockar med innevarande dygn). */
export function nextSwedishPlayDate(now = new Date()): {
  isoDate: string;
  label: string;
} {
  const today = stockholmDateIso(now);
  // Stega framåt tills svensk kalenderdag byts
  let probe = new Date(now.getTime());
  let isoDate = today;
  for (let i = 0; i < 50; i++) {
    probe = new Date(probe.getTime() + 60 * 60 * 1000);
    isoDate = stockholmDateIso(probe);
    if (isoDate !== today) break;
  }

  const label = new Intl.DateTimeFormat("sv-SE", {
    timeZone: STOCKHOLM,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(probe);

  return { isoDate, label };
}

async function kambiFetch(path: string, tries = 4): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${KAMBI_BASE}${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; MikaelsTips/1.0; +https://tryckrad.vercel.app)",
          Origin: "https://www.svenskaspel.se",
          Referer: "https://www.svenskaspel.se/oddset/fotboll",
        },
        next: { revalidate: 120 },
      });
      if (res.status === 410 || res.status === 429 || res.status >= 500) {
        last = new Error(`Kambi ${res.status}`);
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Kambi ${res.status} för ${path}`);
      return res.json();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("Kambi-fel");
}

function parseOdds(raw?: number): number | null {
  if (raw == null || raw <= 0) return null;
  return Math.round((raw / 1000) * 1000) / 1000;
}

function parseLine(raw?: number): number | null {
  if (raw == null) return null;
  return Math.round((raw / 1000) * 10) / 10;
}

function extractTotals(betOffers: KambiBetOffer[]): {
  odds15: number | null;
  odds25: number | null;
} {
  let odds15: number | null = null;
  let odds25: number | null = null;

  for (const bo of betOffers) {
    const label = bo.criterion?.englishLabel || bo.criterion?.label || "";
    if (label !== "Total Goals" && label !== "Antal mål") continue;
    // Skip half-time / team totals which use different labels
    for (const o of bo.outcomes || []) {
      const side = (o.label || "").toLowerCase();
      if (side !== "över" && side !== "over") continue;
      const line = parseLine(o.line);
      const odds = parseOdds(o.odds);
      if (odds == null || line == null) continue;
      if (line === 1.5) odds15 = odds;
      if (line === 2.5) odds25 = odds;
    }
  }
  return { odds15, odds25 };
}

function eventUrl(eventId: number): string {
  return `https://www.svenskaspel.se/oddset/event/${eventId}`;
}

function countryOf(event: KambiEvent): string {
  return event.path?.[1]?.name || event.path?.[1]?.englishName || "";
}

/**
 * Poängsätt kandidat:
 * - Primärt Över 1,5 om odds >= 1,8 (ju närmare 1,80 desto "säkrare" inom regelverket)
 * - Annars Över 2,5 om odds > 2,0
 * - Bonus om båda linjerna tyder på målrikt matchbild
 */
function buildCandidate(
  event: KambiEvent,
  odds15: number | null,
  odds25: number | null
): OddsetCandidate | null {
  const home = event.homeName || event.name.split(" - ")[0] || event.name;
  const away =
    event.awayName || event.name.split(" - ").slice(1).join(" - ") || "";

  let market: OddsetMarket | null = null;
  let line: 1.5 | 2.5 | null = null;
  let odds: number | null = null;
  const reasons: string[] = [];

  if (odds15 != null && odds15 >= 1.8) {
    market = "over_1_5";
    line = 1.5;
    odds = odds15;
    reasons.push(`Över 1,5 till ${odds15.toFixed(2).replace(".", ",")} (≥ 1,80)`);
  } else if (odds25 != null && odds25 > 2.0) {
    market = "over_2_5";
    line = 2.5;
    odds = odds25;
    if (odds15 != null && odds15 < 1.8) {
      reasons.push(
        `Över 1,5 för lågt odds (${odds15.toFixed(2).replace(".", ",")}) – tar Över 2,5`
      );
    } else {
      reasons.push("Över 1,5 saknas – tar Över 2,5");
    }
    reasons.push(`Över 2,5 till ${odds25.toFixed(2).replace(".", ",")} (> 2,00)`);
  } else {
    return null;
  }

  // Score: prefer over 1.5; within market prefer safer (lower) odds but still meeting floor
  let score = 0;
  if (market === "over_1_5" && odds != null) {
    // Highest score near 1.80; fade if too high (less "garanterad")
    const dist = Math.abs(odds - 1.8);
    score = 100 - dist * 40;
    if (odds25 != null) {
      // Strong scoring profile if 2.5 is not crazy long
      if (odds25 <= 2.35) score += 12;
      else if (odds25 <= 2.7) score += 6;
    }
    reasons.push("prioriterad spelformel Över 1,5");
  } else if (market === "over_2_5" && odds != null) {
    const dist = Math.abs(odds - 2.05);
    score = 70 - dist * 25;
    if (odds15 != null && odds15 < 1.55) score += 8; // very likely 2+ goals
    reasons.push("reservformel Över 2,5");
  }

  // Prefer top European leagues (country-aware – undvik t.ex. Ukrainas/Etiopiens "Premier League")
  const league = event.group || "";
  const country = countryOf(event);
  const topCountry =
    /england|spanien|spain|italien|italy|tyskland|germany|frankrike|france|nederländerna|netherlands|portugal|sverige|sweden|skottland|scotland/i.test(
      country
    );
  if (
    topCountry &&
    /premier league|la liga|serie a|bundesliga|ligue 1|championship|eredivisie|primeira|allsvenskan|liga portugal/i.test(
      league
    )
  ) {
    score += 8;
    reasons.push(`stark liga: ${league} (${country})`);
  } else if (/champions league|europa league|conference league/i.test(league)) {
    score += 6;
    reasons.push(`stark liga: ${league}`);
  }

  return {
    eventId: event.id,
    home,
    away,
    league,
    country,
    kickoff: event.start,
    market: market!,
    line: line!,
    odds: odds!,
    odds15,
    odds25,
    score,
    reason: reasons.join(". "),
    url: eventUrl(event.id),
  };
}

async function fetchTotalsForEvents(
  events: KambiEvent[],
  seeded?: Map<number, KambiBetOffer[]>
): Promise<Map<number, { odds15: number | null; odds25: number | null }>> {
  const map = new Map<number, { odds15: number | null; odds25: number | null }>();

  // Seed from listView when Total Goals already present
  for (const ev of events) {
    const seededOffers = seeded?.get(ev.id) || [];
    const seededTotals = extractTotals(seededOffers);
    if (seededTotals.odds15 != null || seededTotals.odds25 != null) {
      map.set(ev.id, seededTotals);
    }
  }

  const missing = events.filter((e) => !map.has(e.id));
  const concurrency = 6;
  for (let i = 0; i < missing.length; i += concurrency) {
    const slice = missing.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (ev) => {
        try {
          const data = (await kambiFetch(
            `/betoffer/event/${ev.id}.json?lang=sv_SE&market=SE`
          )) as { betOffers?: KambiBetOffer[] };
          map.set(ev.id, extractTotals(data.betOffers || []));
        } catch {
          map.set(ev.id, { odds15: null, odds25: null });
        }
      })
    );
  }
  return map;
}

export async function buildOddsetDayTip(): Promise<OddsetDayTip> {
  const play = nextSwedishPlayDate();
  const list = (await kambiFetch(
    "/listView/football.json?lang=sv_SE&market=SE"
  )) as { events?: Array<{ event: KambiEvent; betOffers?: KambiBetOffer[] }> };

  const dayEvents: KambiEvent[] = [];
  const seeded = new Map<number, KambiBetOffer[]>();
  for (const wrap of list.events || []) {
    const ev = wrap.event;
    if (!ev?.start || !ev.id) continue;
    if (stockholmDateIso(new Date(ev.start)) === play.isoDate) {
      dayEvents.push(ev);
      if (wrap.betOffers?.length) seeded.set(ev.id, wrap.betOffers);
    }
  }

  // Prioritera större ligor så capen inte missar bra matcher
  const leagueRank = (ev: KambiEvent) => {
    const league = ev.group || "";
    const country = countryOf(ev);
    const topCountry =
      /england|spanien|spain|italien|italy|tyskland|germany|frankrike|france|nederländerna|netherlands|portugal|sverige|sweden|skottland|scotland/i.test(
        country
      );
    if (
      topCountry &&
      /premier league|la liga|serie a|bundesliga|ligue 1/i.test(league)
    )
      return 0;
    if (
      topCountry &&
      /championship|eredivisie|primeira|liga portugal|allsvenskan|la liga 2|serie b/i.test(
        league
      )
    )
      return 1;
    if (/champions league|europa league/i.test(league)) return 1;
    if (/superliga|pro league|liga profesional|mls/i.test(league)) return 2;
    return 3;
  };
  dayEvents.sort(
    (a, b) =>
      leagueRank(a) - leagueRank(b) ||
      new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  // Analysera morgondagens matcher (cap för Vercel-timeout på mycket stora dagar)
  const maxAnalyze = 140;
  const toAnalyze = dayEvents.slice(0, maxAnalyze);
  const totals = await fetchTotalsForEvents(toAnalyze, seeded);

  const candidates: OddsetCandidate[] = [];
  for (const ev of toAnalyze) {
    const t = totals.get(ev.id) || { odds15: null, odds25: null };
    const c = buildCandidate(ev, t.odds15, t.odds25);
    if (c) candidates.push(c);
  }

  candidates.sort((a, b) => b.score - a.score || a.odds - b.odds);
  const selected = candidates[0] ?? null;

  return {
    playDate: play.isoDate,
    playDateLabel: play.label,
    generatedAt: new Date().toISOString(),
    selected,
    candidates: candidates.slice(0, 12),
    analyzedCount: toAnalyze.length,
    eligibleCount: candidates.length,
    rules: [
      "En match per 24 timmar (svenskt dygn).",
      "Speldatum = dagen efter (kickoff under morgondagens svenska kalenderdag).",
      "Primär formel: Över 1,5 mål – odds minst 1,80.",
      "Alternativ: Över 2,5 mål – odds över 2,00.",
      "Bland godkända matcher väljs den med starkast analysscore (säkrast målbild inom reglerna).",
    ],
    disclaimer:
      "Oddset-tips är analys, ingen garanti. Odds från Svenska Spel/Kambi kan ändras. 18+ spela ansvarsfullt.",
  };
}
