export type MatchScoreResult = {
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  over25Hit: boolean;
  status: "live" | "final";
  sourceName: string;
};

type EspnCompetitor = {
  homeAway?: string;
  score?: string | number;
  team?: { displayName?: string; shortDisplayName?: string; name?: string };
};

type EspnEvent = {
  name?: string;
  shortName?: string;
  date?: string;
  status?: {
    type?: {
      name?: string;
      state?: string;
      completed?: boolean;
      description?: string;
    };
  };
  competitions?: Array<{
    competitors?: EspnCompetitor[];
  }>;
};

const STOCKHOLM = "Europe/Stockholm";

/** Vanliga översättningar/smeknamn så Kambi ↔ ESPN matchar. */
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
];

function normalizeName(s: string): string {
  let out = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\b(fc|cf|sc|ac|as|afc|fk|if|bk|sk|cd|ud|rcd|ssc|sv|vfl|vfb|tsg|1)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
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
export function teamNameScore(a: string, b: string): number {
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

function ymdInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function neighborYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

async function fetchEspnScoreboard(ymd: string): Promise<EspnEvent[]> {
  const dates = ymdCompact(ymd);
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${dates}`;
  try {
    // Vanlig webbläsar-UA – ESPN/Akamai blockerar bot-UA (403).
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { events?: EspnEvent[] };
    return json.events || [];
  } catch {
    return [];
  }
}

function parseCompetitorGoals(c: EspnCompetitor | undefined): number | null {
  if (!c || c.score == null || c.score === "") return null;
  const n = Number(c.score);
  return Number.isFinite(n) ? n : null;
}

function eventTeams(ev: EspnEvent): { home: string; away: string } | null {
  const comps = ev.competitions?.[0]?.competitors || [];
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  return {
    home:
      home.team?.displayName ||
      home.team?.shortDisplayName ||
      home.team?.name ||
      "",
    away:
      away.team?.displayName ||
      away.team?.shortDisplayName ||
      away.team?.name ||
      "",
  };
}

function classifyStatus(
  ev: EspnEvent
): "pre" | "live" | "final" | "unknown" {
  const t = ev.status?.type;
  if (!t) return "unknown";
  if (
    t.completed ||
    t.state === "post" ||
    t.name === "STATUS_FULL_TIME" ||
    t.name === "STATUS_FINAL"
  ) {
    return "final";
  }
  if (
    t.state === "in" ||
    t.name?.includes("HALF") ||
    t.name === "STATUS_IN_PROGRESS" ||
    t.name === "STATUS_HALFTIME"
  ) {
    return "live";
  }
  if (t.state === "pre" || t.name === "STATUS_SCHEDULED") return "pre";
  return "unknown";
}

const scoreboardCache = new Map<string, { at: number; events: EspnEvent[] }>();

async function scoreboardForDates(dates: string[]): Promise<EspnEvent[]> {
  const out: EspnEvent[] = [];
  const seen = new Set<string>();
  for (const ymd of dates) {
    const cached = scoreboardCache.get(ymd);
    let events: EspnEvent[];
    if (cached && Date.now() - cached.at < 45_000) {
      events = cached.events;
    } else {
      events = await fetchEspnScoreboard(ymd);
      scoreboardCache.set(ymd, { at: Date.now(), events });
    }
    for (const ev of events) {
      const key = `${ev.date}|${ev.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ev);
    }
  }
  return out;
}

/**
 * Hitta slutresultat (eller live) för en tippad match via ESPN soccer scoreboard.
 */
export async function lookupMatchScore(input: {
  home: string;
  away: string;
  kickoff: string;
}): Promise<MatchScoreResult | null> {
  const stockholm = ymdInZone(input.kickoff, STOCKHOLM);
  const utc = ymdInZone(input.kickoff, "UTC");
  const dates = Array.from(
    new Set([
      stockholm,
      utc,
      neighborYmd(stockholm, -1),
      neighborYmd(stockholm, 1),
    ])
  );

  const events = await scoreboardForDates(dates);
  let best: { score: number; ev: EspnEvent; homeG: number; awayG: number } | null =
    null;

  for (const ev of events) {
    const teams = eventTeams(ev);
    if (!teams) continue;
    const homeScore = teamNameScore(input.home, teams.home);
    const awayScore = teamNameScore(input.away, teams.away);
    const flippedHome = teamNameScore(input.home, teams.away);
    const flippedAway = teamNameScore(input.away, teams.home);
    const direct = Math.min(homeScore, awayScore) * 0.55 + ((homeScore + awayScore) / 2) * 0.45;
    const flipped =
      Math.min(flippedHome, flippedAway) * 0.55 +
      ((flippedHome + flippedAway) / 2) * 0.45;
    const useFlip = flipped > direct + 0.08;
    const matchScore = useFlip ? flipped : direct;
    if (matchScore < 0.55) continue;

    const comps = ev.competitions?.[0]?.competitors || [];
    const homeC = comps.find((c) => c.homeAway === "home");
    const awayC = comps.find((c) => c.homeAway === "away");
    let homeG = parseCompetitorGoals(homeC);
    let awayG = parseCompetitorGoals(awayC);
    if (homeG == null || awayG == null) continue;
    if (useFlip) {
      const tmp = homeG;
      homeG = awayG;
      awayG = tmp;
    }

    // Prefer final over live over pre
    const st = classifyStatus(ev);
    const statusBoost = st === "final" ? 0.15 : st === "live" ? 0.05 : -0.2;
    const total = matchScore + statusBoost;
    if (!best || total > best.score) {
      best = { score: total, ev, homeG, awayG };
    }
  }

  if (!best) return null;
  const st = classifyStatus(best.ev);
  if (st === "pre" || st === "unknown") return null;

  const totalGoals = best.homeG + best.awayG;
  return {
    homeGoals: best.homeG,
    awayGoals: best.awayG,
    totalGoals,
    over25Hit: totalGoals >= 3,
    status: st === "final" ? "final" : "live",
    sourceName: best.ev.name || `${input.home} – ${input.away}`,
  };
}
