/**
 * Flashscore livescore-feed (fotboll) – uppdaterar slutresultat/live för alla spel.
 * Använder samma x/feed som flashscore.se (fältavgränsad text, x-fsign).
 */

export type FlashscoreMatch = {
  id: string;
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  /** Unix-sekunder kickoff (UTC). */
  kickoffUnix: number | null;
  status: "pre" | "live" | "final" | "other";
  statusCode: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Stabil feed-sign som Flashscore accepterar för publika score-feeds. */
const FALLBACK_FSIGN = "SW9D1eZo";

const STOCKHOLM = "Europe/Stockholm";

const feedCache = new Map<
  string,
  { at: number; matches: FlashscoreMatch[] }
>();

const FSIGN_TTL_MS = 6 * 60 * 60 * 1000;
let cachedFsign: { at: number; value: string } | null = null;

const NAME_ALIASES: Array<[RegExp, string]> = [
  [/\bbayern munchen\b/g, "bayern munich"],
  [/\bkoln\b|\bkoeln\b/g, "cologne"],
  [/\bfc cologne\b/g, "cologne"],
  [/\bathletic club\b|\bathletic bilbao\b/g, "athletic bilbao"],
  [/\bman united\b|\bmanchester utd\b|\bman utd\b/g, "manchester united"],
  [/\bman city\b/g, "manchester city"],
  [/\bpsg\b|\bparis sg\b/g, "paris saint germain"],
  [/\binternazionale\b|\binter milan\b/g, "inter"],
  [/\btottenham hotspur\b|\bspurs\b/g, "tottenham"],
  [/\bwolves\b/g, "wolverhampton"],
  [/\bnottm forest\b/g, "nottingham forest"],
  [/\batletico de madrid\b/g, "atletico madrid"],
  [/\bborussia dortmund\b/g, "dortmund"],
  [/\bgladbach\b|\bmonchengladbach\b/g, "monchengladbach"],
  [/\bbayer 04\b|\bbayer leverkusen\b/g, "leverkusen"],
  [/\bifk goteborg\b|\bgoteborg\b|\bgöteborg\b/g, "goteborg"],
  [/\bmalmo ff\b|\bmalmö ff\b|\bmalmo\b|\bmalmö\b/g, "malmo"],
  [/\bdjurgardens if\b|\bdjurgården\b|\bdif\b/g, "djurgarden"],
  [/\bhammarby if\b/g, "hammarby"],
  [/\baik\b/g, "aik"],
];

function normalizeName(s: string): string {
  let out = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\b(fc|cf|sc|ac|as|afc|fk|if|bk|sk|cd|ud|rcd|ssc|sv|vfl|vfb|tsg|hf|hc|1|ff|ifk)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b([a-z]+)\s+(\d+)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, rep] of NAME_ALIASES) {
    out = out.replace(re, rep);
  }
  return out.replace(/\s+/g, " ").trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeName(s)
      .split(" ")
      .filter((t) => t.length > 2)
  );
}

/** Hur väl två lagnamn matchar (0–1). */
export function flashscoreTeamScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const fa = na.split(" ")[0];
  const fb = nb.split(" ")[0];
  if (fa && fa === fb && fa.length >= 4) return 0.88;

  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  const denom = Math.min(ta.size, tb.size);
  return hits / denom;
}

function ymdInZone(isoOrMs: string | number, timeZone: string): string {
  const d =
    typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((bUtc - aUtc) / 86_400_000);
}

/**
 * Flashscore statuskoder (fotboll/ishockey):
 * 1 = ej startad
 * 2 / 12 / 13 / 31–38 = pågående (1H, HT, 2H, perioder)
 * 3 = full time
 * 4 / 5 / 10 / 11 = avgjord (förlängning, straffar, walkover m.m.)
 * 14–16 / 46 = ishockey-perioder live
 */
function classifyStatus(code: string): FlashscoreMatch["status"] {
  const c = String(code || "");
  if (
    c === "3" ||
    c === "4" ||
    c === "5" ||
    c === "10" ||
    c === "11" ||
    c === "54"
  ) {
    return "final";
  }
  if (c === "1") return "pre";
  if (
    c === "2" ||
    c === "6" ||
    c === "12" ||
    c === "13" ||
    c === "14" ||
    c === "15" ||
    c === "16" ||
    c === "31" ||
    c === "32" ||
    c === "33" ||
    c === "34" ||
    c === "36" ||
    c === "37" ||
    c === "38" ||
    c === "45" ||
    c === "46"
  ) {
    return "live";
  }
  return "other";
}

/** Efter tillräckligt lång tid med måltal: behandla som avgjord (feed-status kan släpa). */
function promoteToFinalIfStale(
  status: FlashscoreMatch["status"],
  kickoffUnix: number | null,
  kickMs: number
): FlashscoreMatch["status"] {
  if (status === "final" || status === "pre") return status;
  const start = kickoffUnix != null ? kickoffUnix * 1000 : kickMs;
  // Fotboll ~2 h, ishockey ~3 h – ge marginal
  if (Date.now() - start >= 2.5 * 60 * 60 * 1000) return "final";
  return status;
}

function parseFeed(text: string): FlashscoreMatch[] {
  const out: FlashscoreMatch[] = [];
  for (const part of text.split("~")) {
    if (!part.includes("AA÷") || !part.includes("AE÷")) continue;
    const fields: Record<string, string> = {};
    for (const item of part.split("¬")) {
      const sep = item.indexOf("÷");
      if (sep < 0) continue;
      fields[item.slice(0, sep)] = item.slice(sep + 1);
    }
    const id = fields.AA;
    const home = fields.AE || fields.CX || "";
    const away = fields.AF || "";
    if (!id || !home || !away) continue;

    const homeGoals =
      fields.AG != null && fields.AG !== "" && Number.isFinite(Number(fields.AG))
        ? Number(fields.AG)
        : null;
    const awayGoals =
      fields.AH != null && fields.AH !== "" && Number.isFinite(Number(fields.AH))
        ? Number(fields.AH)
        : null;

    const kickRaw = fields.AD;
    const kickoffUnix =
      kickRaw && /^\d+$/.test(kickRaw) ? Number(kickRaw) : null;

    const statusCode = fields.AC || fields.AB || "";
    out.push({
      id,
      home,
      away,
      homeGoals,
      awayGoals,
      kickoffUnix,
      status: classifyStatus(statusCode),
      statusCode,
    });
  }
  return out;
}

async function resolveFsign(): Promise<string> {
  if (cachedFsign && Date.now() - cachedFsign.at < FSIGN_TTL_MS) {
    return cachedFsign.value;
  }
  try {
    const res = await fetch("https://www.flashscore.se/", {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const html = await res.text();
      const m =
        html.match(/feed_sign["']?\s*[:=]\s*["']([^"']+)/i) ||
        html.match(/["']fsign["']\s*:\s*["']([^"']+)/i);
      if (m?.[1]) {
        cachedFsign = { at: Date.now(), value: m[1] };
        return m[1];
      }
    }
  } catch {
    /* fallback */
  }
  cachedFsign = { at: Date.now(), value: FALLBACK_FSIGN };
  return FALLBACK_FSIGN;
}

/** Flashscore sport-id: 1 = fotboll, 4 = ishockey (Powerplay). */
const FS_SPORTS = [1, 4] as const;

async function fetchSportDayFeed(
  sportId: number,
  dayOffset: number
): Promise<FlashscoreMatch[]> {
  const key = `s${sportId}:d${dayOffset}`;
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.at < 45_000) {
    return cached.matches;
  }

  const fsign = await resolveFsign();
  const url = `https://global.flashscore.ninja/2/x/feed/f_${sportId}_${dayOffset}_8_sv_1`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
        Referer: "https://www.flashscore.se/",
        "X-Fsign": fsign,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      feedCache.set(key, { at: Date.now(), matches: [] });
      return [];
    }
    const text = await res.text();
    const matches = parseFeed(text);
    feedCache.set(key, { at: Date.now(), matches });
    return matches;
  } catch {
    feedCache.set(key, { at: Date.now(), matches: [] });
    return [];
  }
}

async function matchesForKickoff(kickoffIso: string): Promise<FlashscoreMatch[]> {
  const today = ymdInZone(Date.now(), STOCKHOLM);
  const kickYmd = ymdInZone(kickoffIso, STOCKHOLM);
  const base = daysBetweenYmd(today, kickYmd);
  // Flashscore day_offset: 0 = idag, −1 = igår. Hämta grann-dagar p.g.a. tidzon.
  const offsets = Array.from(
    new Set(
      [base - 1, base, base + 1, 0, -1, 1].filter(
        (n) => Number.isFinite(n) && n >= -7 && n <= 7
      )
    )
  );

  const out: FlashscoreMatch[] = [];
  const seen = new Set<string>();
  for (const sportId of FS_SPORTS) {
    for (const off of offsets) {
      const list = await fetchSportDayFeed(sportId, off);
      for (const m of list) {
        const id = `${sportId}:${m.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(m);
      }
    }
  }
  return out;
}

export type FlashscoreScoreResult = {
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  overLineHit: boolean;
  status: "live" | "final";
  sourceName: string;
};

/**
 * Hitta live/slutresultat via Flashscore för en tippad match.
 */
export async function lookupFlashscoreScore(input: {
  home: string;
  away: string;
  kickoff: string;
}): Promise<FlashscoreScoreResult | null> {
  const kickMs = Date.parse(input.kickoff);
  if (!Number.isFinite(kickMs)) return null;

  const matches = await matchesForKickoff(input.kickoff);
  let best: {
    score: number;
    m: FlashscoreMatch;
    homeG: number;
    awayG: number;
    flipped: boolean;
  } | null = null;

  for (const m of matches) {
    const homeScore = flashscoreTeamScore(input.home, m.home);
    const awayScore = flashscoreTeamScore(input.away, m.away);
    const flippedHome = flashscoreTeamScore(input.home, m.away);
    const flippedAway = flashscoreTeamScore(input.away, m.home);
    const direct =
      Math.min(homeScore, awayScore) * 0.55 +
      ((homeScore + awayScore) / 2) * 0.45;
    const flipped =
      Math.min(flippedHome, flippedAway) * 0.55 +
      ((flippedHome + flippedAway) / 2) * 0.45;
    const useFlip = flipped > direct + 0.08;
    const matchScore = useFlip ? flipped : direct;
    if (matchScore < 0.55) continue;

    let homeG = m.homeGoals;
    let awayG = m.awayGoals;
    if (homeG == null || awayG == null) continue;
    if (useFlip) {
      const tmp = homeG;
      homeG = awayG;
      awayG = tmp;
    }

    // Tid-närhet: ±18 h runt tippad kickoff
    let timeBoost = 0;
    if (m.kickoffUnix != null) {
      const deltaH = Math.abs(m.kickoffUnix * 1000 - kickMs) / 3_600_000;
      if (deltaH > 18) continue;
      timeBoost = Math.max(0, 0.12 - deltaH * 0.01);
    }

    const statusBoost =
      m.status === "final" ? 0.15 : m.status === "live" ? 0.05 : -0.25;
    const total = matchScore + statusBoost + timeBoost;
    if (!best || total > best.score) {
      best = { score: total, m, homeG, awayG, flipped: useFlip };
    }
  }

  if (!best) return null;

  let status = best.m.status;
  // Har vi måltal men okänd/släpande status: hellre live än att hoppa över
  if (status === "other") status = "live";
  if (status === "pre") return null;
  status = promoteToFinalIfStale(status, best.m.kickoffUnix, kickMs);

  const totalGoals = best.homeG + best.awayG;
  return {
    homeGoals: best.homeG,
    awayGoals: best.awayG,
    totalGoals,
    overLineHit: totalGoals >= 2,
    status: status === "final" ? "final" : "live",
    sourceName: `Flashscore · ${best.m.home} – ${best.m.away}`,
  };
}
