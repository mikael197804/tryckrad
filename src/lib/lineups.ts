import { upstreamFetchInit } from "./fetch-mode";
import type { Odds, TeamInfo } from "./types";

export type LineupImpactItem = {
  side: "home" | "away";
  player: string;
  status: "out" | "doubt" | "returned";
  impact: "worse" | "better" | "neutral";
  severity: "low" | "medium" | "high";
  note: string;
  source: string;
};

export type LateLineupAnalysis = {
  /** True when we are within 15 minutes before kickoff (or past close, before start). */
  windowActive: boolean;
  minutesToKickoff: number | null;
  homeImpact: "better" | "worse" | "neutral" | "unknown";
  awayImpact: "better" | "worse" | "neutral" | "unknown";
  items: LineupImpactItem[];
  oddsDriftNote: string | null;
  note: string;
  analyzedAt: string;
};

const LATE_WINDOW_MS = 15 * 60 * 1000;

const LEAGUE_TO_ESPN: Record<string, string> = {
  "Premier League": "eng.1",
  Championship: "eng.2",
  "League One": "eng.3",
  "League Two": "eng.4",
  "La Liga": "esp.1",
  "Serie A": "ita.1",
  Bundesliga: "ger.1",
  "Ligue 1": "fra.1",
  Eredivisie: "ned.1",
  "Allsvenskan": "swe.1",
  Superettan: "swe.2",
  "Champions League": "uefa.champions",
  "Europa League": "uefa.europa",
};

type NewsArticle = {
  headline?: string;
  description?: string;
};

const newsCache = new Map<string, { at: number; articles: NewsArticle[] }>();

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamMentions(text: string, team: TeamInfo): boolean {
  const hay = normalizeName(text);
  const candidates = [team.name, team.shortName]
    .map(normalizeName)
    .filter((s) => s.length >= 3);
  return candidates.some((c) => hay.includes(c));
}

async function fetchLeagueNews(espnLeague: string): Promise<NewsArticle[]> {
  const cached = newsCache.get(espnLeague);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.articles;
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/news?limit=50`,
      upstreamFetchInit({
        headers: { Accept: "application/json", "User-Agent": "MikaelsTips/1.0" },
        next: { revalidate: 120 },
      })
    );
    if (!res.ok) return cached?.articles ?? [];
    const data = (await res.json()) as { articles?: NewsArticle[] };
    const articles = data.articles ?? [];
    newsCache.set(espnLeague, { at: Date.now(), articles });
    return articles;
  } catch {
    return cached?.articles ?? [];
  }
}

function parseOddsSv(raw?: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function oddsDrift(
  start: Odds | null | undefined,
  current: Odds
): {
  homeImpact: "better" | "worse" | "neutral";
  awayImpact: "better" | "worse" | "neutral";
  note: string | null;
} {
  if (!start || start.one == null || current.one == null) {
    return { homeImpact: "neutral", awayImpact: "neutral", note: null };
  }
  const homeDelta = current.one / start.one - 1;
  const awayDelta =
    start.two != null && current.two != null ? current.two / start.two - 1 : 0;

  let homeImpact: "better" | "worse" | "neutral" = "neutral";
  let awayImpact: "better" | "worse" | "neutral" = "neutral";
  const parts: string[] = [];

  // Odds upp = svagare enligt marknaden
  if (homeDelta >= 0.12) {
    homeImpact = "worse";
    parts.push(
      `hemmalagets odds har gått upp (${start.one.toFixed(2).replace(".", ",")} → ${current.one.toFixed(2).replace(".", ",")}) – marknaden ser dem svagare`
    );
  } else if (homeDelta <= -0.1) {
    homeImpact = "better";
    parts.push(
      `hemmalagets odds har gått ner – marknaden ser dem starkare`
    );
  }

  if (awayDelta >= 0.12) {
    awayImpact = "worse";
    parts.push(`bortalaget har blivit dyrare i oddsen – ser svagare ut`);
  } else if (awayDelta <= -0.1) {
    awayImpact = "better";
    parts.push(`bortalaget har blivit billigare – ser starkare ut`);
  }

  return {
    homeImpact,
    awayImpact,
    note: parts.length ? parts.join(". ") : null,
  };
}

const IGNORE_PLAYERS = new Set([
  "messi",
  "ronaldo",
  "cristiano",
  "brady",
  "sources",
  "transfer",
  "english",
  "premier",
]);

function plausiblePlayer(name: string): boolean {
  const n = normalizeName(name);
  if (n.length < 4 || n.split(" ").length > 3) return false;
  if (IGNORE_PLAYERS.has(n) || IGNORE_PLAYERS.has(n.split(" ")[0])) return false;
  if (/^(the|and|for|from|with|over|against|after|near|decade|of)$/i.test(name))
    return false;
  // Kräv att varje del ser ut som namn (stor bokstav i original)
  if (!/^[A-ZÅÄÖ]/.test(name)) return false;
  if (/\b(of|near|after|decade|finally|get)\b/i.test(name)) return false;
  return true;
}

function extractAbsences(
  articles: NewsArticle[],
  home: TeamInfo,
  away: TeamInfo
): LineupImpactItem[] {
  const items: LineupImpactItem[] = [];
  // Strikta mönster: "Saka out for a month", "Saliba available", "X ruled out"
  const patterns: Array<{
    re: RegExp;
    status: LineupImpactItem["status"];
    impact: LineupImpactItem["impact"];
    severity: LineupImpactItem["severity"];
  }> = [
    {
      re: /\b([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)\b(?:'s)?\s+(?:is\s+)?(?:ruled\s+out|out\s+for|out\s+with|sidelined|unavailable|injured|will\s+miss|set\s+to\s+miss)/i,
      status: "out",
      impact: "worse",
      severity: "high",
    },
    {
      re: /\b([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)\b(?:'s)?\s+(?:is\s+)?(?:a\s+)?doubt(?:ful)?/i,
      status: "doubt",
      impact: "worse",
      severity: "low",
    },
    {
      re: /\b([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)\b(?:'s)?\s+(?:is\s+)?(?:available|fit(?:\s+to\s+play)?|cleared\s+to\s+play|returns?)/i,
      status: "returned",
      impact: "better",
      severity: "medium",
    },
    {
      re: /\b([A-ZÅÄÖ][\w'’-]+(?:\s+[A-ZÅÄÖ][\w'’-]+)?)\b\s+(?:missar|borta|skadad)/i,
      status: "out",
      impact: "worse",
      severity: "high",
    },
  ];

  for (const article of articles) {
    const headline = article.headline || "";
    if (!headline.trim()) continue;
    const homeHit = teamMentions(headline, home);
    const awayHit = teamMentions(headline, away);
    if (!homeHit && !awayHit) continue;

    for (const pat of patterns) {
      const m = headline.match(pat.re);
      if (!m) continue;
      const player = m[1];
      if (!plausiblePlayer(player)) continue;

      // Koppla till laget före spelarnamnet ("Arsenal's Bukayo Saka…")
      let side: "home" | "away" | null = null;
      const before = headline.slice(0, m.index ?? 0);
      if (homeHit && teamMentions(before + " " + (m[0] || ""), home)) side = "home";
      if (awayHit && teamMentions(before + " " + (m[0] || ""), away)) {
        // Prefer the closer team mention before the player
        if (side == null) side = "away";
        else {
          const homePos = normalizeName(before).lastIndexOf(
            normalizeName(home.name).split(" ")[0]
          );
          const awayPos = normalizeName(before).lastIndexOf(
            normalizeName(away.name).split(" ")[0]
          );
          side = awayPos > homePos ? "away" : "home";
        }
      }
      if (side == null) {
        if (homeHit && !awayHit) side = "home";
        else if (awayHit && !homeHit) side = "away";
      }
      if (side == null) continue;

      const team = side === "home" ? home : away;
      if (normalizeName(player).includes(normalizeName(team.name).split(" ")[0])) {
        continue;
      }
      items.push({
        side,
        player,
        status: pat.status,
        impact: pat.impact,
        severity: pat.severity,
        note:
          pat.status === "out"
            ? `${player} borta för ${team.name}`
            : pat.status === "doubt"
              ? `${player} osäker för ${team.name}`
              : `${player} tillgänglig igen för ${team.name}`,
        source: headline,
      });
    }
  }

  const seen = new Set<string>();
  return items.filter((it) => {
    const key = `${it.side}:${normalizeName(it.player)}:${it.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function aggregateImpact(
  items: LineupImpactItem[],
  side: "home" | "away",
  drift: "better" | "worse" | "neutral"
): "better" | "worse" | "neutral" | "unknown" {
  const sideItems = items.filter((i) => i.side === side);
  let score = 0;
  for (const it of sideItems) {
    const w =
      it.severity === "high" ? 2 : it.severity === "medium" ? 1 : 0.4;
    if (it.impact === "worse") score -= w;
    if (it.impact === "better") score += w;
  }
  if (drift === "worse") score -= 0.8;
  if (drift === "better") score += 0.8;
  if (score <= -0.8) return "worse";
  if (score >= 0.8) return "better";
  if (sideItems.length || drift !== "neutral") return "neutral";
  return "unknown";
}

export function emptyLineup(
  matchStart: string,
  note = "ingen lagnyhet ännu"
): LateLineupAnalysis {
  const start = new Date(matchStart).getTime();
  const mins = Number.isFinite(start)
    ? Math.round((start - Date.now()) / 60000)
    : null;
  const windowActive =
    mins != null && mins <= 15 && mins >= -5;
  return {
    windowActive,
    minutesToKickoff: mins,
    homeImpact: "unknown",
    awayImpact: "unknown",
    items: [],
    oddsDriftNote: null,
    note: windowActive
      ? `Sen analys aktiv (${mins} min till avspark) – ${note}`
      : note,
    analyzedAt: new Date().toISOString(),
  };
}

export async function analyzeMatchLineup(args: {
  home: TeamInfo;
  away: TeamInfo;
  league: string;
  matchStart: string;
  startOdds?: Odds | null;
  currentOdds: Odds;
}): Promise<LateLineupAnalysis> {
  const { home, away, league, matchStart, startOdds, currentOdds } = args;
  const startMs = new Date(matchStart).getTime();
  const minutesToKickoff = Number.isFinite(startMs)
    ? Math.round((startMs - Date.now()) / 60000)
    : null;
  const windowActive =
    minutesToKickoff != null &&
    minutesToKickoff <= 15 &&
    minutesToKickoff >= -5;

  const espnLeague = LEAGUE_TO_ESPN[league] ?? null;
  const articles = espnLeague ? await fetchLeagueNews(espnLeague) : [];
  const items = extractAbsences(articles, home, away);
  const drift = oddsDrift(startOdds ?? null, currentOdds);

  const homeImpact = aggregateImpact(items, "home", drift.homeImpact);
  const awayImpact = aggregateImpact(items, "away", drift.awayImpact);

  const parts: string[] = [];
  if (windowActive) {
    parts.push(
      `Sen analys (${minutesToKickoff} min till avspark): spelare borta / oddsrörelse vägs in`
    );
  } else if (minutesToKickoff != null && minutesToKickoff > 15) {
    parts.push(
      `Förhandstips – ny sen analys körs automatiskt ca 15 min före avspark`
    );
  }

  for (const it of items.slice(0, 4)) {
    parts.push(
      `${it.note} → ${it.impact === "worse" ? "sämre" : it.impact === "better" ? "bättre" : "neutralt"} för laget`
    );
  }
  if (drift.note) parts.push(drift.note);
  if (!items.length && !drift.note) {
    parts.push(
      windowActive
        ? "inga bekräftade bortalägen i nyhetsflödet just nu"
        : "ingen lagnyhet kopplad ännu"
    );
  }

  return {
    windowActive,
    minutesToKickoff,
    homeImpact,
    awayImpact,
    items,
    oddsDriftNote: drift.note,
    note: parts.join(". "),
    analyzedAt: new Date().toISOString(),
  };
}

/** Score adjustment for 1X2 based on late lineup (positive = more likely). */
export function lineupScoreAdjust(lineup: LateLineupAnalysis): {
  d1: number;
  dX: number;
  d2: number;
} {
  let d1 = 0;
  let d2 = 0;
  let dX = 0;
  const weight = lineup.windowActive ? 1 : 0.45;

  if (lineup.homeImpact === "worse") {
    d1 -= 0.06 * weight;
    d2 += 0.03 * weight;
    dX += 0.02 * weight;
  } else if (lineup.homeImpact === "better") {
    d1 += 0.05 * weight;
    d2 -= 0.025 * weight;
  }

  if (lineup.awayImpact === "worse") {
    d2 -= 0.06 * weight;
    d1 += 0.03 * weight;
    dX += 0.02 * weight;
  } else if (lineup.awayImpact === "better") {
    d2 += 0.05 * weight;
    d1 -= 0.025 * weight;
  }

  // Both sides hit → more chaos / draw
  if (
    (lineup.homeImpact === "worse" || lineup.homeImpact === "better") &&
    (lineup.awayImpact === "worse" || lineup.awayImpact === "better")
  ) {
    dX += 0.015 * weight;
  }

  return { d1, dX, d2 };
}

export function lineupGoalAdjust(lineup: LateLineupAnalysis): number {
  let delta = 0;
  const weight = lineup.windowActive ? 1 : 0.5;
  for (const it of lineup.items) {
    if (it.status === "out" && it.severity === "high") delta -= 0.25 * weight;
    else if (it.status === "out") delta -= 0.12 * weight;
    else if (it.status === "returned" && it.severity !== "low")
      delta += 0.12 * weight;
  }
  return delta;
}
