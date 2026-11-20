import { upstreamFetchInit } from "./fetch-mode";
import {
  importOddsetTips,
  listTrackedOddsetTips,
  ODDSET_TIP_RETENTION_HOURS,
  rememberOddsetTips,
  settleOddsetTips,
  type OddsetTrackedTip,
} from "./oddsetHistory";
import {
  importOddsetLessons,
  loadOddsetLearning,
  oddsetLearningAdjust,
  type OddsetLearningMemory,
  type OddsetLesson,
} from "./oddsetLearning";
import { overMarketValue } from "./valueOdds";

export type { OddsetTrackedTip } from "./oddsetHistory";
export type { OddsetLearningMemory, OddsetLesson } from "./oddsetLearning";
export type OddsetMarket = "over_2_5";

export type RivalryInfo = {
  level: "none" | "possible" | "likely";
  note: string;
};

export type RedCardInfo = {
  level: "low" | "medium" | "high";
  probabilityPct: number | null;
  oddsYes: number | null;
  totalCardsLine: number | null;
  totalCardsOverOdds: number | null;
  note: string;
};

export type OddsetCandidate = {
  eventId: number;
  home: string;
  away: string;
  league: string;
  country: string;
  kickoff: string;
  market: OddsetMarket;
  line: 2.5;
  odds: number;
  odds15: number | null;
  odds25: number | null;
  odds35: number | null;
  /** Uppskattad sannolikhet (%) att matchen får minst 3 mål (Över 2,5). */
  over25ProbPct: number;
  expectedGoals: number | null;
  rivalry: RivalryInfo;
  redCard: RedCardInfo;
  score: number;
  reason: string;
  url: string;
  /** Lärdomar som påverkat just detta tips. */
  learningNotes?: string[];
};

export type OddsetDayTip = {
  playDate: string;
  playDateLabel: string;
  generatedAt: string;
  /** Upp till 5 matcher att spela detta svenska dygn. */
  selected: OddsetCandidate[];
  candidates: OddsetCandidate[];
  /** Tips som sparats senaste 24 h, med grönt/rött när resultatet är klart. */
  tracked: OddsetTrackedTip[];
  retentionHours: number;
  analyzedCount: number;
  eligibleCount: number;
  picksPerDay: number;
  rules: string[];
  disclaimer: string;
  /** Efteranalys + aspekter till nästa tips (uppdateras automatiskt). */
  learning: {
    updatedAt: string;
    summary: string[];
    biasesNote: string;
    lessons: OddsetLesson[];
  };
};

const PICKS_PER_DAY = 5;

const KAMBI_BASE =
  "https://eu.offering-api.kambicdn.com/offering/v2018/svenskaspel";

const STOCKHOLM = "Europe/Stockholm";

/** Visa bara matcher där modellen tror Över 2,5 är sannolikt. */
const MIN_OVER25_PROB = 0.55;

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

type MatchMarkets = {
  odds15: number | null;
  odds25: number | null;
  odds35: number | null;
  under25: number | null;
  redCardYes: number | null;
  redCardNo: number | null;
  totalCardsOver: { line: number; odds: number } | null;
};

function stockholmDateIso(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCKHOLM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Dagens svenska kalenderdag (öppna Oddset-spel nu). */
export function todaySwedishPlayDate(now = new Date()): {
  isoDate: string;
  label: string;
} {
  const isoDate = stockholmDateIso(now);
  const label = new Intl.DateTimeFormat("sv-SE", {
    timeZone: STOCKHOLM,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  return { isoDate, label };
}

/** Morgondagens svenska kalenderdag (fallback om få öppna matcher idag). */
export function nextSwedishPlayDate(now = new Date()): {
  isoDate: string;
  label: string;
} {
  const today = stockholmDateIso(now);
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
      const res = await fetch(
        `${KAMBI_BASE}${path}`,
        upstreamFetchInit({
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (compatible; MikaelsTips/1.0; +https://tryckrad.vercel.app)",
            Origin: "https://www.svenskaspel.se",
            Referer: "https://www.svenskaspel.se/oddset/fotboll",
          },
          next: { revalidate: 120 },
        })
      );
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

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonCdfAtLeast(lambda: number, minGoals: number): number {
  if (lambda <= 0) return 0;
  let pLess = 0;
  for (let k = 0; k < minGoals; k++) {
    pLess += (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  }
  return Math.max(0, Math.min(1, 1 - pLess));
}

/** Uppskatta λ (förväntade mål) från Ö/U-stegen. */
function estimateExpectedGoals(
  odds15: number | null,
  odds25: number | null,
  odds35: number | null,
  under25: number | null
): number | null {
  const points: Array<{ line: number; pOver: number }> = [];

  const add = (line: number, over: number | null, under: number | null) => {
    if (over == null || over <= 1) return;
    let pOver = 1 / over;
    if (under != null && under > 1) {
      const invOver = 1 / over;
      const invUnder = 1 / under;
      const sum = invOver + invUnder;
      if (sum > 0) pOver = invOver / sum;
    }
    points.push({ line, pOver });
  };

  add(1.5, odds15, null);
  add(2.5, odds25, under25);
  add(3.5, odds35, null);

  if (!points.length) return null;

  // Sök λ som bäst matchar P(X > line) ≈ poisson
  let bestL = 2.5;
  let bestErr = Infinity;
  for (let l = 1.2; l <= 4.2; l += 0.05) {
    let err = 0;
    for (const p of points) {
      const model = poissonCdfAtLeast(l, Math.floor(p.line) + 1);
      err += (model - p.pOver) ** 2;
    }
    if (err < bestErr) {
      bestErr = err;
      bestL = l;
    }
  }
  return Math.round(bestL * 100) / 100;
}

function estimateOver25Probability(
  lambda: number | null,
  odds25: number | null,
  under25: number | null
): number | null {
  const fromPoisson =
    lambda != null ? poissonCdfAtLeast(lambda, 3) : null;

  let fromOdds: number | null = null;
  if (odds25 != null && odds25 > 1) {
    if (under25 != null && under25 > 1) {
      const a = 1 / odds25;
      const b = 1 / under25;
      fromOdds = a / (a + b);
    } else {
      // grov de-vig ~4%
      fromOdds = Math.min(0.92, (1 / odds25) * 1.04);
    }
  }

  if (fromPoisson == null && fromOdds == null) return null;
  if (fromPoisson == null) return fromOdds;
  if (fromOdds == null) return fromPoisson;
  // Vikta Poisson tyngre när vi har bra stege
  return fromPoisson * 0.65 + fromOdds * 0.35;
}

function extractMarkets(betOffers: KambiBetOffer[]): MatchMarkets {
  let odds15: number | null = null;
  let odds25: number | null = null;
  let odds35: number | null = null;
  let under25: number | null = null;
  let redCardYes: number | null = null;
  let redCardNo: number | null = null;
  let totalCardsOver: { line: number; odds: number } | null = null;

  for (const bo of betOffers) {
    const label = bo.criterion?.englishLabel || bo.criterion?.label || "";

    if (label === "Total Goals" || label === "Antal mål") {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const line = parseLine(o.line);
        const odds = parseOdds(o.odds);
        if (odds == null || line == null) continue;
        if (side === "över" || side === "over") {
          if (line === 1.5) odds15 = odds;
          if (line === 2.5) odds25 = odds;
          if (line === 3.5) odds35 = odds;
        }
        if ((side === "under") && line === 2.5) under25 = odds;
      }
    }

    if (label === "Red Card given" || label === "Rött kort i matchen") {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const odds = parseOdds(o.odds);
        if (odds == null) continue;
        if (side === "ja" || side === "yes") redCardYes = odds;
        if (side === "nej" || side === "no") redCardNo = odds;
      }
    }

    if (label === "Total Cards" || label === "Antal kort") {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const line = parseLine(o.line);
        const odds = parseOdds(o.odds);
        if (odds == null || line == null) continue;
        if (side !== "över" && side !== "over") continue;
        // Prefer main line around 3.5–4.5
        if (
          !totalCardsOver ||
          Math.abs(line - 4) < Math.abs(totalCardsOver.line - 4)
        ) {
          totalCardsOver = { line, odds };
        }
      }
    }
  }

  return {
    odds15,
    odds25,
    odds35,
    under25,
    redCardYes,
    redCardNo,
    totalCardsOver,
  };
}

function eventUrl(eventId: number): string {
  return `https://www.svenskaspel.se/oddset/event/${eventId}`;
}

function countryOf(event: KambiEvent): string {
  return event.path?.[1]?.name || event.path?.[1]?.englishName || "";
}

function isSeniorMensMatch(event: KambiEvent): boolean {
  const blob = [
    event.name,
    event.homeName,
    event.awayName,
    event.group,
    ...(event.path || []).map((p) => p.name || p.englishName || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    /\(d\)|\(w\)|women|woman|dames|damer|dam |female|u18|u19|u20|u21|u23|youth|ungdom|reserves| reserve|junior|academy|amateur|\(mani\)|\(sena\)/.test(
      blob
    )
  ) {
    return false;
  }
  return true;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Kända derbyn / rivalpar (normaliserade namnfragment). */
const RIVALRY_PAIRS: Array<[string, string, string]> = [
  ["sevilla", "betis", "Sevilla-derby"],
  ["real madrid", "barcelona", "El Clásico"],
  ["atletico", "real madrid", "Madrid-derby"],
  ["inter", "milan", "Milano-derby"],
  ["juventus", "torino", "Derby della Mole"],
  ["roma", "lazio", "Rom-derby"],
  ["liverpool", "everton", "Merseyside-derby"],
  ["manchester united", "manchester city", "Manchester-derby"],
  ["arsenal", "tottenham", "North London-derby"],
  ["celtic", "rangers", "Old Firm"],
  ["ajax", "feyenoord", "De Klassieker"],
  ["benfica", "porto", "O Clássico"],
  ["galatasaray", "fenerbahce", "Istanbul-derby"],
  ["boca", "river", "Superclásico"],
  ["flamengo", "fluminense", "Fla-Flu"],
  ["aik", "djurgarden", "Stockholmsderby"],
  ["aik", "hammarby", "Stockholmsderby"],
  ["hammarby", "djurgarden", "Stockholmsderby"],
  ["ifk goteborg", "malmo", "Klassikermöte"],
  ["porto", "sporting", "Lisboa-rivalitet"],
  ["olympiacos", "panathinaikos", "Athensderby"],
  ["celtic", "hearts", "Skotsk rivalitet"],
];

function analyzeRivalry(home: string, away: string, league: string): RivalryInfo {
  const h = normalizeName(home);
  const a = normalizeName(away);

  for (const [x, y, label] of RIVALRY_PAIRS) {
    const hit =
      (h.includes(x) && a.includes(y)) || (h.includes(y) && a.includes(x));
    if (hit) {
      return {
        level: "likely",
        note: `${label} – hög rivalitet, ofta hetsigare matchbild`,
      };
    }
  }

  // Samma stadsnamn i båda lagnamnen
  const cityHints = [
    "madrid",
    "milan",
    "manchester",
    "london",
    "glasgow",
    "lisboa",
    "lisbon",
    "stockholm",
    "goteborg",
    "malmo",
    "roma",
    "rome",
    "istanbul",
    "athens",
    "athen",
  ];
  for (const city of cityHints) {
    if (h.includes(city) && a.includes(city)) {
      return {
        level: "possible",
        note: `Möjligt lokalderby (${city})`,
      };
    }
  }

  if (/derby|klassiker|clásico|clasico/i.test(league)) {
    return { level: "possible", note: "Ligans derby-/klassikerprofil" };
  }

  return { level: "none", note: "Ingen tydlig derby-/bråksignal" };
}

function analyzeRedCard(
  markets: MatchMarkets,
  rivalry: RivalryInfo
): RedCardInfo {
  const notes: string[] = [];
  let level: RedCardInfo["level"] = "low";
  let probabilityPct: number | null = null;

  if (markets.redCardYes != null && markets.redCardYes > 1) {
    if (markets.redCardNo != null && markets.redCardNo > 1) {
      const y = 1 / markets.redCardYes;
      const n = 1 / markets.redCardNo;
      probabilityPct = Math.round((100 * y) / (y + n));
    } else {
      probabilityPct = Math.round(Math.min(90, (100 / markets.redCardYes) * 1.05));
    }
    notes.push(
      `Marknad rött kort Ja @ ${markets.redCardYes.toFixed(2).replace(".", ",")} (~${probabilityPct}%)`
    );
  }

  if (markets.totalCardsOver) {
    notes.push(
      `Kort Över ${markets.totalCardsOver.line.toFixed(1).replace(".", ",")} @ ${markets.totalCardsOver.odds.toFixed(2).replace(".", ",")}`
    );
    // Kort över 4.5 till lågt odds ≈ fysiskt
    if (
      markets.totalCardsOver.line >= 4 &&
      markets.totalCardsOver.odds <= 1.85
    ) {
      level = "medium";
      notes.push("hög kortlinje tyder på fysisk match");
    }
  }

  if (probabilityPct != null) {
    if (probabilityPct >= 32) level = "high";
    else if (probabilityPct >= 22) level = level === "low" ? "medium" : level;
  }

  if (rivalry.level === "likely") {
    if (level === "low") level = "medium";
    else if (level === "medium") level = "high";
    notes.push("rivalitet höjer risken för heta situationer/rött kort");
  } else if (rivalry.level === "possible" && level === "low") {
    level = "medium";
    notes.push("möjlig lokal rivalitet kan ge kort");
  }

  return {
    level,
    probabilityPct,
    oddsYes: markets.redCardYes,
    totalCardsLine: markets.totalCardsOver?.line ?? null,
    totalCardsOverOdds: markets.totalCardsOver?.odds ?? null,
    note: notes.join(" · ") || "ingen tydlig rött-kort-signal",
  };
}

function buildCandidate(
  event: KambiEvent,
  markets: MatchMarkets
): OddsetCandidate | null {
  const home = event.homeName || event.name.split(" - ")[0] || event.name;
  const away =
    event.awayName || event.name.split(" - ").slice(1).join(" - ") || "";
  const league = event.group || "";
  const country = countryOf(event);

  if (markets.odds25 == null || markets.odds25 <= 1) return null;
  // För öppna spel: undvik nästan avgjorda/live-lika korta Över-odds
  if (markets.odds25 < 1.28) return null;

  const lambda = estimateExpectedGoals(
    markets.odds15,
    markets.odds25,
    markets.odds35,
    markets.under25
  );
  const p25 = estimateOver25Probability(
    lambda,
    markets.odds25,
    markets.under25
  );
  if (p25 == null || p25 < MIN_OVER25_PROB) return null;

  const rivalry = analyzeRivalry(home, away, league);
  const redCard = analyzeRedCard(markets, rivalry);

  const over25ProbPct = Math.round(p25 * 1000) / 10;
  const reasons: string[] = [];
  reasons.push(
    `Modell: ${over25ProbPct.toFixed(1).replace(".", ",")}% chans till minst 3 mål`
  );
  if (lambda != null) {
    reasons.push(`förväntade mål ≈ ${lambda.toFixed(2).replace(".", ",")}`);
  }
  reasons.push(
    `Över 2,5 @ ${markets.odds25.toFixed(2).replace(".", ",")}`
  );
  if (markets.odds15 != null) {
    reasons.push(`Ö1,5 @ ${markets.odds15.toFixed(2).replace(".", ",")}`);
  }
  if (rivalry.level !== "none") reasons.push(rivalry.note);
  if (redCard.level !== "low") reasons.push(`rött kort: ${redCard.note}`);

  // Score: sannolikhet först, sedan liga, rivalitet/kort som kontext
  let score = over25ProbPct * 1.2;
  if (lambda != null) score += Math.min(12, (lambda - 2.4) * 10);

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
    score += 6;
  }

  // Liten bonus för derby (underhållning/hets) men inte krav
  if (rivalry.level === "likely") score += 3;
  if (redCard.level === "high") score += 2;

  // Preferera kortare odds bland hög-sannolikhet (säkrare träff)
  score += Math.max(0, 12 - Math.abs(markets.odds25 - 1.7) * 4);

  // Överodds/värde: modellens p högre än oddsimplicit
  const ov = overMarketValue({
    overOdds: markets.odds25,
    modelProb: p25,
  });
  if (ov.isValue) {
    score += 8;
    if (ov.note) reasons.push(ov.note);
  } else if (ov.edgePct != null && ov.edgePct < -5) {
    score -= 4;
    if (ov.note) reasons.push(ov.note);
  }

  return {
    eventId: event.id,
    home,
    away,
    league,
    country,
    kickoff: event.start,
    market: "over_2_5",
    line: 2.5,
    odds: markets.odds25,
    odds15: markets.odds15,
    odds25: markets.odds25,
    odds35: markets.odds35,
    over25ProbPct,
    expectedGoals: lambda,
    rivalry,
    redCard,
    score,
    reason: reasons.join(". "),
    url: eventUrl(event.id),
  };
}

async function fetchMarketsForEvents(
  events: KambiEvent[]
): Promise<Map<number, MatchMarkets>> {
  const map = new Map<number, MatchMarkets>();
  const concurrency = 6;
  for (let i = 0; i < events.length; i += concurrency) {
    const slice = events.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (ev) => {
        try {
          const data = (await kambiFetch(
            `/betoffer/event/${ev.id}.json?lang=sv_SE&market=SE`
          )) as { betOffers?: KambiBetOffer[] };
          map.set(ev.id, extractMarkets(data.betOffers || []));
        } catch {
          map.set(ev.id, {
            odds15: null,
            odds25: null,
            odds35: null,
            under25: null,
            redCardYes: null,
            redCardNo: null,
            totalCardsOver: null,
          });
        }
      })
    );
  }
  return map;
}

function selectUniquePicks(
  ranked: OddsetCandidate[],
  limit: number
): OddsetCandidate[] {
  const picked: OddsetCandidate[] = [];
  const usedTeams = new Set<string>();
  const usedLeagues = new Map<string, number>();

  const teamKey = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  for (const c of ranked) {
    if (picked.length >= limit) break;
    const h = teamKey(c.home);
    const a = teamKey(c.away);
    if (usedTeams.has(h) || usedTeams.has(a)) continue;
    const leagueCount = usedLeagues.get(c.league) || 0;
    // Max 2 tips per liga i samma batch → mer unika tips
    if (c.league && leagueCount >= 2) continue;
    picked.push(c);
    usedTeams.add(h);
    usedTeams.add(a);
    if (c.league) usedLeagues.set(c.league, leagueCount + 1);
  }

  // Fyll på om filtret blev för hårt
  if (picked.length < limit) {
    for (const c of ranked) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.eventId === c.eventId)) continue;
      picked.push(c);
    }
  }
  return picked;
}

export async function buildOddsetDayTip(opts?: {
  clientTips?: Array<OddsetCandidate & { tippedAt?: string }>;
  clientLessons?: OddsetLesson[];
}): Promise<OddsetDayTip> {
  const now = new Date();
  const today = todaySwedishPlayDate(now);
  const tomorrow = nextSwedishPlayDate(now);

  if (opts?.clientLessons?.length) {
    await importOddsetLessons(opts.clientLessons);
  }
  // Importera + settla tidigare tips först så lärdomar finns innan nytt urval
  if (opts?.clientTips?.length) {
    await importOddsetTips(opts.clientTips);
  }
  await settleOddsetTips();
  const learning = await loadOddsetLearning();
  const recentTracked = await listTrackedOddsetTips();
  const recentEventIds = new Set(recentTracked.map((t) => t.eventId));
  const recentTeams = new Set<string>();
  const recentLeagues = new Set<string>();
  for (const t of recentTracked) {
    recentTeams.add(t.home);
    recentTeams.add(t.away);
    if (t.league) recentLeagues.add(t.league);
  }
  const list = (await kambiFetch(
    "/listView/football.json?lang=sv_SE&market=SE"
  )) as { events?: Array<{ event: KambiEvent; betOffers?: KambiBetOffer[] }> };

  // Öppna spel nu: avspark minst ~12 min framåt, i första hand idag (svensk tid)
  const minStart = now.getTime() + 12 * 60 * 1000;
  const openEvents: KambiEvent[] = [];
  for (const wrap of list.events || []) {
    const ev = wrap.event;
    if (!ev?.start || !ev.id) continue;
    const start = new Date(ev.start);
    if (start.getTime() < minStart) continue;
    if (!isSeniorMensMatch(ev)) continue;
    openEvents.push(ev);
  }

  const todayEvents = openEvents.filter(
    (ev) => stockholmDateIso(new Date(ev.start)) === today.isoDate
  );
  const tomorrowEvents = openEvents.filter(
    (ev) => stockholmDateIso(new Date(ev.start)) === tomorrow.isoDate
  );

  // Prioritera dagens öppna matcher; ta alltid med imorgon som backup-pool
  let dayEvents = [...todayEvents, ...tomorrowEvents];
  let play = today;
  let windowNote = "öppna matcher idag (svensk tid)";
  if (!todayEvents.length && tomorrowEvents.length) {
    play = tomorrow;
    windowNote = "öppna matcher imorgon (inga kvar idag)";
  } else if (todayEvents.length && tomorrowEvents.length) {
    windowNote = "öppna matcher idag + imorgon";
  } else if (!dayEvents.length) {
    windowNote = "inga öppna fotbollsmatcher just nu";
  }

  // Rangordna: dagens matcher före imorgon vid lika liga-kvalitet
  const isToday = (ev: KambiEvent) =>
    stockholmDateIso(new Date(ev.start)) === today.isoDate;

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
      Number(isToday(b)) - Number(isToday(a)) ||
      leagueRank(a) - leagueRank(b) ||
      new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  const maxAnalyze = 100;
  const toAnalyze = dayEvents.slice(0, maxAnalyze);
  const markets = await fetchMarketsForEvents(toAnalyze);

  const floorBump = learning.biases.raiseProbFloor;
  const minProb = MIN_OVER25_PROB + floorBump;

  const candidates: OddsetCandidate[] = [];
  for (const ev of toAnalyze) {
    const m = markets.get(ev.id);
    if (!m) continue;
    const c = buildCandidate(ev, m);
    if (!c) continue;

    // Dynamisk ribba från missar (övertygade fel → höj golvet)
    if (c.over25ProbPct / 100 < minProb) continue;

    const adj = oddsetLearningAdjust({
      memory: learning,
      candidate: c,
      recentEventIds,
      recentTeams,
      recentLeagues,
    });
    c.score += adj.scoreDelta;
    if (adj.notes.length) {
      c.learningNotes = adj.notes;
      c.reason = `${c.reason}. ${adj.notes[0]}`;
    }
    candidates.push(c);
  }

  const todayIso = today.isoDate;
  candidates.sort((a, b) => {
    const aToday = stockholmDateIso(new Date(a.kickoff)) === todayIso ? 1 : 0;
    const bToday = stockholmDateIso(new Date(b.kickoff)) === todayIso ? 1 : 0;
    // Nära i score: prioritera matcher som går idag (öppna att spela snart)
    if (Math.abs(a.score - b.score) < 8 && aToday !== bToday) {
      return bToday - aToday;
    }
    return (
      b.score - a.score ||
      b.over25ProbPct - a.over25ProbPct ||
      new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    );
  });
  const selected = selectUniquePicks(candidates, PICKS_PER_DAY);

  await rememberOddsetTips(selected);
  const tracked = await settleOddsetTips();
  const learningAfter = await loadOddsetLearning();

  return {
    playDate: play.isoDate,
    playDateLabel: play.label,
    generatedAt: new Date().toISOString(),
    selected,
    candidates: candidates.slice(0, 12),
    tracked,
    retentionHours: ODDSET_TIP_RETENTION_HOURS,
    analyzedCount: toAnalyze.length,
    eligibleCount: candidates.length,
    picksPerDay: PICKS_PER_DAY,
    learning: {
      updatedAt: learningAfter.updatedAt,
      summary: learningAfter.lastSummary,
      biasesNote: learningAfter.biases.note,
      lessons: learningAfter.lessons.slice(0, 12),
    },
    rules: [
      `${PICKS_PER_DAY} unika öppna Oddset-matcher (Över 2,5) som går att spela nu.`,
      `Fönster: ${windowNote}.`,
      "Bara matcher som inte startat ännu (för nya tips).",
      `Tipsen ligger kvar på sidan ${ODDSET_TIP_RETENTION_HOURS} timmar.`,
      "Efter slutsignal: grönt = Över 2,5 rätt, rött = fel.",
      "Efter varje avgjort tips lär sig analysen varför det gick rätt/fel och justerar nästa urval automatiskt.",
      `Sannolikhetsgolv nu: ≥${Math.round(minProb * 100)}% (höjs efter övertygade missar).`,
      "Rivalitet/derby och rött-kort-marknad analyseras som extrakontext.",
      "Uppdateras automatiskt 12 min före avspark och när resultat kommer in.",
    ],
    disclaimer:
      "Oddset-tips är analys, ingen garanti. Odds från Svenska Spel/Kambi kan ändras. 18+ spela ansvarsfullt.",
  };
}

/** Enbart settlement av sparade/klienttips (lättare anrop). */
export async function settleStoredOddsetTips(
  clientTips?: Array<OddsetCandidate & { tippedAt?: string }>
): Promise<OddsetTrackedTip[]> {
  if (clientTips?.length) await importOddsetTips(clientTips);
  return settleOddsetTips();
}

export async function getTrackedOddsetTips(): Promise<OddsetTrackedTip[]> {
  return listTrackedOddsetTips();
}
