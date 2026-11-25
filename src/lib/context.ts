import type { FatigueInfo, RestSignal, TableContext, TeamInfo } from "./types";

export type StandingRow = {
  name: string;
  aliases: string[];
  rank: number;
  points: number;
  played: number;
};

export type LeagueTable = {
  league: string;
  size: number;
  rows: StandingRow[];
};

const ESPN_SOCCER: Record<string, string> = {
  "premier league": "eng.1",
  championship: "eng.2",
  "la liga": "esp.1",
  laliga: "esp.1",
  "serie a": "ita.1",
  bundesliga: "ger.1",
  "ligue 1": "fra.1",
  allsvenskan: "swe.1",
  superettan: "swe.2",
  eredivisie: "ned.1",
  "primeira liga": "por.1",
  "liga portugal": "por.1",
  "scottish premiership": "sco.1",
};

const HA_CODE_ALIASES: Record<string, string[]> = {
  AIK: ["AIK"],
  LIF: ["Leksand", "Leksands IF"],
  KHC: ["Kalmar", "Kalmar HC"],
  MoDo: ["MoDo", "Modo"],
  SSK: ["Södertälje", "Södertälje SK"],
  IKO: ["Oskarshamn", "IK Oskarshamn"],
  MORA: ["Mora", "Mora IK"],
  ÖIK: ["Östersund", "Östersunds IK"],
  VIK: ["Västerås", "Västerås IK"],
  BIK: ["BIK Karlskoga", "Karlskoga", "BIK"],
  AIS: ["Almtuna", "Almtuna IS"],
  NVIF: ["Nybro", "Nybro Vikings"],
  VHC: ["Visby-Roma", "Visby", "Roma"],
  VIS: ["Vimmerby", "Vimmerby HC"],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && !["if", "hc", "ik", "bk", "sk", "fc", "afc"].includes(t));
}

export function matchStanding(
  teamName: string,
  table: LeagueTable | null
): StandingRow | null {
  if (!table) return null;
  const want = normalize(teamName);
  const wantTokens = nameTokens(teamName);

  let best: { row: StandingRow; score: number } | null = null;
  for (const row of table.rows) {
    const candidates = [row.name, ...row.aliases].map(normalize);
    for (const c of candidates) {
      if (!c) continue;
      let score = 0;
      if (c === want) score = 100;
      else if (c.includes(want) || want.includes(c)) score = 80;
      else {
        const cTokens = c.split(" ").filter(Boolean);
        const overlap = wantTokens.filter((t) => cTokens.some((ct) => ct.includes(t) || t.includes(ct)));
        score = overlap.length * 25;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { row, score };
      }
    }
  }
  return best && best.score >= 50 ? best.row : null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": "TryckRad/1.0 (analysverktyg)",
        ...(init?.headers ?? {}),
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchEspnSoccerTable(slug: string, league: string): Promise<LeagueTable | null> {
  const data = (await fetchJson(
    `https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`
  )) as
    | {
        children?: Array<{
          standings?: {
            entries?: Array<{
              team?: { displayName?: string; shortDisplayName?: string; name?: string; abbreviation?: string };
              stats?: Array<{ name?: string; value?: number }>;
            }>;
          };
        }>;
      }
    | null;
  const entries = data?.children?.[0]?.standings?.entries ?? [];
  if (!entries.length) return null;

  const rows: StandingRow[] = entries
    .map((e) => {
      const stats = e.stats ?? [];
      const num = (name: string) =>
        stats.find((s) => s.name === name)?.value ?? null;
      const rank = num("rank") ?? 0;
      const points = num("points") ?? 0;
      const played = num("gamesPlayed") ?? 0;
      const team = e.team ?? {};
      const name = team.displayName || team.name || "";
      return {
        name,
        aliases: [team.shortDisplayName, team.abbreviation, team.name].filter(
          Boolean
        ) as string[],
        rank: Number(rank) || 0,
        points: Number(points) || 0,
        played: Number(played) || 0,
      };
    })
    .filter((r) => r.name && r.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  return rows.length ? { league, size: rows.length, rows } : null;
}

async function fetchEspnNhlTable(league: string): Promise<LeagueTable | null> {
  const data = (await fetchJson(
    "https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings"
  )) as
    | {
        children?: Array<{
          standings?: {
            entries?: Array<{
              team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string };
              stats?: Array<{ name?: string; value?: number }>;
            }>;
          };
        }>;
      }
    | null;

  const rows: StandingRow[] = [];
  for (const conf of data?.children ?? []) {
    for (const e of conf.standings?.entries ?? []) {
      const stats = e.stats ?? [];
      const num = (name: string) => stats.find((s) => s.name === name)?.value ?? null;
      const points = Number(num("points") ?? 0);
      const played = Number(num("gamesPlayed") ?? 0);
      const team = e.team ?? {};
      rows.push({
        name: team.displayName || "",
        aliases: [team.shortDisplayName, team.abbreviation].filter(Boolean) as string[],
        rank: 0,
        points,
        played,
      });
    }
  }
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows.length ? { league, size: rows.length, rows } : null;
}

async function discoverShlSsgtUuid(): Promise<string | null> {
  try {
    const res = await fetch(
      "https://www.shl.se/game-stats/standings/standings?count=25",
      {
        headers: { "User-Agent": "TryckRad/1.0" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return null;
    const html = await res.text();
    const active = html.match(
      /"state":"active","ssgtUuid":"([a-zA-Z0-9_-]+)"/
    );
    if (active) return active[1];
    const any = html.match(/"ssgtUuid":"([a-zA-Z0-9_-]+)"/);
    return any?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchShlTable(league: string): Promise<LeagueTable | null> {
  const ssgt = (await discoverShlSsgtUuid()) ?? "qa98unlbd6";
  const data = (await fetchJson(
    `https://www.shl.se/api/statistics-v2/league-standings?ssgtUuid=${ssgt}`,
    { headers: { "x-s8y-instance-id": "shl1_shl" } }
  )) as
    | {
        leagueStandings?: Array<{
          Rank?: number;
          Points?: number;
          GP?: number;
          info?: {
            code?: string;
            teamInfo?: {
              teamNames?: Record<string, string>;
              siteTeamDisplayName?: string;
              siteTeamDisplayCode?: string;
            };
          };
        }>;
      }
    | null;

  const rows: StandingRow[] = (data?.leagueStandings ?? [])
    .map((e) => {
      const names = e.info?.teamInfo?.teamNames ?? {};
      const display =
        e.info?.teamInfo?.siteTeamDisplayName ||
        names.long ||
        names.long_site ||
        e.info?.code ||
        "";
      const aliases = [
        e.info?.code,
        e.info?.teamInfo?.siteTeamDisplayCode,
        names.short,
        names.code,
        names.full,
        names.long,
      ].filter(Boolean) as string[];
      return {
        name: display,
        aliases,
        rank: Number(e.Rank) || 0,
        points: Number(e.Points) || 0,
        played: Number(e.GP) || 0,
      };
    })
    .filter((r) => r.name && r.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  return rows.length ? { league, size: rows.length, rows } : null;
}

async function fetchHaTable(league: string): Promise<LeagueTable | null> {
  const data = (await fetchJson(
    "https://hockeyallsvenskan.se/api/all-time-league-stats",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }
  )) as
    | {
        results?: Array<{
          rank?: number;
          team?: string;
          Points?: number;
          GP?: number;
        }>;
      }
    | null;

  const rows: StandingRow[] = (data?.results ?? [])
    .map((e) => {
      const code = e.team || "";
      const aliases = HA_CODE_ALIASES[code] ?? [code];
      return {
        name: aliases[0] || code,
        aliases: [...aliases, code],
        rank: Number(e.rank) || 0,
        points: Number(e.Points) || 0,
        played: Number(e.GP) || 0,
      };
    })
    .filter((r) => r.name && r.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  return rows.length ? { league, size: rows.length, rows } : null;
}

/** HockeyEttan Södra – overview-id uppdateras per säsong. */
const HOCKEYETTAN_SODRA_OVERVIEW = 21044;

async function fetchHockeyEttanTable(
  league: string
): Promise<LeagueTable | null> {
  try {
    const res = await fetch(
      `https://stats.swehockey.se/ScheduleAndResults/Overview/${HOCKEYETTAN_SODRA_OVERVIEW}`,
      {
        headers: {
          Accept: "text/html",
          "User-Agent": "TryckRad/1.0 (tabell-analys)",
        },
        next: { revalidate: 600 },
      }
    );
    if (!res.ok) return null;
    const page = await res.text();
    // RK, Team, GP, W, T, L, GF:GA, GD, TP, …
    const fullRe =
      /<tr>\s*<td class="tdNormal">(\d+)<\/td><td class="tdNormal">([^<]+)<\/td><td class="tdNormal">(\d+)<\/td><td class="tdNormal">\d+<\/td><td class="tdNormal">\d+<\/td><td class="tdNormal">\d+<\/td>[\s\S]*?<td class="tdNormal">(\d+)<\/td><td class="tdNormal d-none d-md-table-cell">/g;
    const rows: StandingRow[] = [];
    let m: RegExpExecArray | null;
    while ((m = fullRe.exec(page))) {
      const name = m[2].trim();
      rows.push({
        name,
        aliases: [
          name,
          name.replace(/\s+HC$/i, ""),
          name.replace(/\s+IK$/i, ""),
          name.replace(/\s+AIF$/i, ""),
          name.replace(/^HC\s+/i, ""),
          name.replace(/Boro\/Vetlanda HC/i, "Boro"),
          name.replace(/Mjölby HC/i, "Mjölby"),
        ],
        rank: Number(m[1]),
        played: Number(m[3]),
        points: Number(m[4]),
      });
    }
    if (!rows.length) return null;
    return { league, size: rows.length, rows };
  } catch {
    return null;
  }
}

export async function loadLeagueTables(
  leagues: string[]
): Promise<Map<string, LeagueTable>> {
  const map = new Map<string, LeagueTable>();
  const unique = [...new Set(leagues.map((l) => l.trim()).filter(Boolean))];

  await Promise.all(
    unique.map(async (league) => {
      const key = league.toLowerCase();
      let table: LeagueTable | null = null;
      if (key === "shl") table = await fetchShlTable(league);
      else if (key === "hockeyallsvenskan") table = await fetchHaTable(league);
      else if (key.includes("hockeyettan") || /hockey\s*ettan/.test(key)) {
        table = await fetchHockeyEttanTable(league);
      } else if (key === "nhl") table = await fetchEspnNhlTable(league);
      else if (ESPN_SOCCER[key]) {
        table = await fetchEspnSoccerTable(ESPN_SOCCER[key], league);
      }
      if (table) map.set(league, table);
    })
  );

  return map;
}

function comfortFor(
  row: StandingRow | null,
  size: number,
  rows: StandingRow[]
): TableContext["comfort"] {
  if (!row || size < 4) return "unknown";
  const topCut = Math.max(2, Math.ceil(size * 0.25));
  const bottomCut = size - Math.max(2, Math.ceil(size * 0.2)) + 1;

  if (row.rank <= topCut) {
    const below = rows.find((r) => r.rank === row.rank + 3) ?? rows[rows.length - 1];
    const gap = below ? row.points - below.points : 0;
    if (gap >= 4 || row.rank <= 2) return "comfortable";
    return "mid";
  }
  if (row.rank >= bottomCut) return "fighting";
  return "mid";
}

export function buildTableContext(
  team: TeamInfo,
  opponent: TeamInfo,
  table: LeagueTable | null
): TableContext {
  const standing = matchStanding(team.name, table);
  const oppStanding = matchStanding(opponent.name, table);
  const comfort = comfortFor(standing, table?.size ?? 0, table?.rows ?? []);
  const rankGap =
    standing && oppStanding ? Math.abs(standing.rank - oppStanding.rank) : null;

  const notes: string[] = [];
  if (standing) {
    notes.push(
      `${standing.rank}:a plats · ${standing.points} p (${standing.played} matcher)`
    );
  }
  if (comfort === "comfortable") {
    notes.push("bra poängställning – kan sakna udd");
  } else if (comfort === "fighting") {
    notes.push("poängjakt / bottenstrid");
  }
  if (rankGap != null && rankGap <= 2) {
    notes.push("jämna tabellplaceringar");
  }

  return {
    rank: standing?.rank ?? null,
    points: standing?.points ?? null,
    played: standing?.played ?? null,
    leagueSize: table?.size ?? null,
    comfort,
    rankGapToOpponent: rankGap,
    note: notes.join(" · ") || "ingen tabelldata",
  };
}

function importanceScore(
  opponentRank: number | null,
  leagueSize: number | null,
  description: string
): number {
  let score = 0;
  const desc = description.toLowerCase();
  if (/derby|cup|final|playoff|slutspel|champions|europa|finalen/.test(desc)) {
    score += 4;
  }
  if (opponentRank != null && leagueSize != null && leagueSize > 0) {
    // Better (lower) rank → higher importance
    score += Math.max(0, (leagueSize - opponentRank + 1) / leagueSize) * 5;
  }
  return score;
}

export function buildRestSignal(args: {
  teamName: string;
  currentOpponentName: string;
  currentOpponentRank: number | null;
  leagueSize: number | null;
  table: LeagueTable | null;
  fatigue: FatigueInfo;
  teamComfort: TableContext["comfort"];
}): RestSignal {
  const {
    teamName,
    currentOpponentName,
    currentOpponentRank,
    leagueSize,
    table,
    fatigue,
    teamComfort,
  } = args;

  const next = fatigue.upcoming
    .filter((u) => new Date(u.matchStart).getTime() > Date.now() - 60_000)
    .sort(
      (a, b) =>
        new Date(a.matchStart).getTime() - new Date(b.matchStart).getTime()
    )[0];

  if (!next || fatigue.hoursUntilNext == null) {
    return {
      level: "none",
      note: "ingen tydlig vilomotiv",
      nextMatchDescription: null,
      nextOpponentRank: null,
      hoursUntilNext: fatigue.hoursUntilNext,
    };
  }

  // Guess next opponent from "A - B" description
  const parts = next.description.split(/\s+-\s+/);
  let nextOppName = "";
  if (parts.length === 2) {
    const nTeam = normalize(teamName);
    nextOppName =
      normalize(parts[0]).includes(nTeam) ||
      nameTokens(teamName).some((t) => normalize(parts[0]).includes(t))
        ? parts[1]
        : parts[0];
  }

  const nextOppStanding = nextOppName
    ? matchStanding(nextOppName, table)
    : null;
  const nextOppRank = nextOppStanding?.rank ?? null;

  const currentImportance = importanceScore(
    currentOpponentRank,
    leagueSize,
    `${teamName} - ${currentOpponentName}`
  );
  const nextImportance = importanceScore(
    nextOppRank,
    leagueSize,
    next.description
  );

  const withinWindow =
    fatigue.hoursUntilNext <= 48 ||
    (fatigue.hoursUntilNext <= 72 && teamComfort === "comfortable");

  const biggerNext =
    nextImportance >= currentImportance + 1.4 ||
    (currentOpponentRank != null &&
      nextOppRank != null &&
      nextOppRank + 3 <= currentOpponentRank);

  const softCurrent =
    teamComfort === "comfortable" ||
    (currentOpponentRank != null &&
      leagueSize != null &&
      currentOpponentRank >= Math.ceil(leagueSize * 0.55));

  let level: RestSignal["level"] = "none";
  const notes: string[] = [];

  if (withinWindow && biggerNext && softCurrent) {
    level = "likely";
    notes.push(
      `kan vila mot ${currentOpponentName} inför ${next.description}`
    );
  } else if (withinWindow && biggerNext) {
    level = "possible";
    notes.push(
      `närmar sig tyngre match (${next.description}) – rotationsrisk`
    );
  } else if (
    withinWindow &&
    teamComfort === "comfortable" &&
    softCurrent &&
    fatigue.hoursUntilNext <= 36
  ) {
    level = "possible";
    notes.push("tätt schema + trygg tabell – sparar krafter möjligt");
  }

  if (nextOppRank != null) {
    notes.push(`nästa motståndare tabellplacering ${nextOppRank}`);
  }

  return {
    level,
    note: notes.join(" · ") || "ingen tydlig vilomotiv",
    nextMatchDescription: next.description,
    nextOpponentRank: nextOppRank,
    hoursUntilNext: fatigue.hoursUntilNext,
  };
}

export async function enrichShlUpcoming(
  teamName: string,
  matchStart: string,
  table: LeagueTable | null,
  fatigue: FatigueInfo
): Promise<FatigueInfo> {
  // If SVS schedule already knows the next game, keep it.
  if (fatigue.hoursUntilNext != null && fatigue.hoursUntilNext <= 96) {
    return fatigue;
  }
  if (!table) return fatigue;

  const row = matchStanding(teamName, table);
  if (!row) return fatigue;

  // Resolve team UUID via SHL standings payload indirectly: re-fetch and map names.
  const ssgt = (await discoverShlSsgtUuid()) ?? "qa98unlbd6";
  const data = (await fetchJson(
    `https://www.shl.se/api/statistics-v2/league-standings?ssgtUuid=${ssgt}`,
    { headers: { "x-s8y-instance-id": "shl1_shl" } }
  )) as
    | {
        leagueStandings?: Array<{
          info?: {
            teamInfo?: {
              teamUuid?: string;
              siteTeamDisplayName?: string;
              teamNames?: Record<string, string>;
            };
          };
        }>;
      }
    | null;

  let uuid: string | null = null;
  for (const e of data?.leagueStandings ?? []) {
    const info = e.info?.teamInfo;
    const names = [
      info?.siteTeamDisplayName,
      info?.teamNames?.long,
      info?.teamNames?.short,
      info?.teamNames?.code,
    ].filter(Boolean) as string[];
    if (names.some((n) => matchStanding(n, table)?.name === row.name)) {
      uuid = info?.teamUuid ?? null;
      break;
    }
    // fuzzy against teamName
    if (
      names.some((n) => {
        const a = normalize(n);
        const b = normalize(teamName);
        return a.includes(b) || b.includes(a);
      })
    ) {
      uuid = info?.teamUuid ?? null;
      break;
    }
  }
  if (!uuid) return fatigue;

  const upcoming = (await fetchJson(
    `https://www.shl.se/api/sports-v2/upcoming-games/${uuid}`,
    { headers: { "x-s8y-instance-id": "shl1_shl" } }
  )) as
    | {
        upcomingGames?: Array<{
          startDateTime?: string;
          homeTeamInfo?: { names?: { long?: string; short?: string } };
          awayTeamInfo?: { names?: { long?: string; short?: string } };
        }>;
      }
    | null;

  const startMs = new Date(matchStart).getTime();
  const nextGame = (upcoming?.upcomingGames ?? [])
    .map((g) => ({
      start: g.startDateTime ? new Date(g.startDateTime).getTime() : 0,
      home: g.homeTeamInfo?.names?.long || g.homeTeamInfo?.names?.short || "",
      away: g.awayTeamInfo?.names?.long || g.awayTeamInfo?.names?.short || "",
    }))
    .filter((g) => g.start > startMs + 30 * 60 * 1000)
    .sort((a, b) => a.start - b.start)[0];

  if (!nextGame) return fatigue;

  const hoursUntilNext = Math.round((nextGame.start - startMs) / (1000 * 60 * 60));
  const description = `${nextGame.home} - ${nextGame.away}`;
  return {
    ...fatigue,
    hoursUntilNext,
    upcoming: [
      ...fatigue.upcoming,
      {
        drawNumber: 0,
        closeTime: new Date(nextGame.start).toISOString(),
        matchStart: new Date(nextGame.start).toISOString(),
        description,
      },
    ],
    note:
      fatigue.note === "normal belastning"
        ? `nästa SHL-match om ${hoursUntilNext} h (${description})`
        : `${fatigue.note}; nästa om ${hoursUntilNext} h`,
  };
}

/** Look ahead on ESPN scoreboards for football teams' next league match. */
export async function enrichFootballUpcoming(
  league: string,
  teamName: string,
  matchStart: string,
  fatigue: FatigueInfo
): Promise<FatigueInfo> {
  if (fatigue.hoursUntilNext != null && fatigue.hoursUntilNext <= 120) {
    return fatigue;
  }
  const slug = ESPN_SOCCER[league.toLowerCase()];
  if (!slug) return fatigue;

  const startMs = new Date(matchStart).getTime();
  const days: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const d = new Date(startMs + i * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    days.push(`${y}${m}${day}`);
  }

  const want = normalize(teamName);
  for (const day of days) {
    const data = (await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${day}`
    )) as
      | {
          events?: Array<{
            date?: string;
            name?: string;
            competitions?: Array<{
              competitors?: Array<{
                team?: { displayName?: string };
              }>;
            }>;
          }>;
        }
      | null;

    for (const ev of data?.events ?? []) {
      const comps = ev.competitions?.[0]?.competitors ?? [];
      const names = comps.map((c) => c.team?.displayName || "");
      const hit = names.some((n) => {
        const a = normalize(n);
        return a.includes(want) || want.includes(a) || nameTokens(teamName).some((t) => a.includes(t));
      });
      if (!hit || !ev.date) continue;
      const nextMs = new Date(ev.date).getTime();
      if (nextMs <= startMs) continue;
      const hoursUntilNext = Math.round((nextMs - startMs) / (1000 * 60 * 60));
      const description = ev.name || names.join(" - ");
      return {
        ...fatigue,
        hoursUntilNext,
        upcoming: [
          ...fatigue.upcoming,
          {
            drawNumber: 0,
            closeTime: ev.date,
            matchStart: ev.date,
            description,
          },
        ],
        note:
          fatigue.note === "normal belastning"
            ? `nästa ligamatch om ${hoursUntilNext} h (${description})`
            : `${fatigue.note}; nästa om ${hoursUntilNext} h`,
      };
    }
  }
  return fatigue;
}
