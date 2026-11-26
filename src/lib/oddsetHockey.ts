/**
 * Hockey · 1X2 med samma analyslager som Powerplay:
 * tabell, matchbelastning, vila, multi-book/överodds, målanalys, admin-1X2.
 */
import {
  buildRestSignal,
  buildTableContext,
  enrichShlUpcoming,
  loadLeagueTables,
} from "./context";
import { analyzeMatchGoals } from "./goals";
import {
  fetchSwedishBookQuotes,
  resolveMultiBookOdds,
} from "./multiBookOdds";
import type {
  OddsetCandidate,
  Oddset1x2Pick,
  RivalryInfo,
  RedCardInfo,
} from "./oddset";
import type {
  Distribution,
  FatigueInfo,
  GoalAnalysis,
  Odds,
  Outcome,
  RestSignal,
  TableContext,
  TeamInfo,
  ValueOddsInfo,
} from "./types";
import {
  analyzeValueOdds,
  applyValueOddsToScores,
} from "./valueOdds";

export type HockeyKambiEvent = {
  id: number;
  name: string;
  homeName?: string;
  awayName?: string;
  start: string;
  group?: string;
  path?: Array<{ name?: string; englishName?: string; termKey?: string }>;
};

export type HockeyAnalysisAlerts = {
  fatigueAlerts: string[];
  tableAlerts: string[];
  restAlerts: string[];
  goalAlerts: string[];
  valueAlerts: string[];
};

const MS_HOUR = 60 * 60 * 1000;

const EMPTY_RIVALRY: RivalryInfo = {
  level: "none",
  note: "Ingen tydlig derby-/bråksignal",
};

const EMPTY_RED: RedCardInfo = {
  level: "low",
  probabilityPct: null,
  oddsYes: null,
  totalCardsLine: null,
  totalCardsOverOdds: null,
  note: "rött kort ej relevant i ishockey-1X2",
};

function teamInfo(name: string, type: "home" | "away"): TeamInfo {
  const short = name.split(" ")[0] || name;
  let id = 0;
  for (let i = 0; i < name.length; i++) id = (id * 31 + name.charCodeAt(i)) | 0;
  return { id: Math.abs(id) || 1, name, shortName: short, type };
}

function countryOf(event: HockeyKambiEvent): string {
  return event.path?.[1]?.name || event.path?.[1]?.englishName || "";
}

function eventUrl(eventId: number): string {
  return `https://www.svenskaspel.se/oddset/event/${eventId}`;
}

function normalizeTeamKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function impliedProb(odds: number | null): number {
  if (odds == null || odds <= 1) return 0;
  return 1 / odds;
}

/** Marknadskonsensus som “folk” när Oddset saknar svenskaFolket. */
function distFromOdds(odds: Odds): Distribution {
  const i1 = impliedProb(odds.one);
  const iX = impliedProb(odds.x);
  const i2 = impliedProb(odds.two);
  const s = i1 + iX + i2 || 1;
  return {
    one: Math.round((100 * i1) / s),
    x: Math.round((100 * iX) / s),
    two: Math.round((100 * i2) / s),
  };
}

function hockeyLeagueRank(league: string, country: string): number {
  if (/^nhl$/i.test(league)) return 0;
  if (/^shl$/i.test(league)) return 0;
  if (/hockeyallsvenskan|liiga|khl|extraliga|nla|del\b/i.test(league)) return 1;
  if (
    /sverige|sweden|finland|usa|canada|kanada|tjeckien|schweiz|switzerland/i.test(
      country
    )
  )
    return 2;
  return 3;
}

type SchedHit = {
  matchStart: string;
  description: string;
  drawNumber: number;
  closeTime: string;
};

function fatigueFromSchedule(
  teamKey: string,
  matchStart: string,
  schedule: Map<string, SchedHit[]>
): FatigueInfo {
  const start = new Date(matchStart).getTime();
  const all = (schedule.get(teamKey) || []).slice().sort(
    (a, b) =>
      new Date(a.matchStart).getTime() - new Date(b.matchStart).getTime()
  );
  const windowStart = start - 72 * MS_HOUR;
  const windowEnd = start + 72 * MS_HOUR;
  const nearby = all.filter((o) => {
    const t = new Date(o.matchStart).getTime();
    return t >= windowStart && t <= windowEnd;
  });
  const previous = all
    .filter((o) => new Date(o.matchStart).getTime() < start)
    .at(-1);
  const next = all.find((o) => new Date(o.matchStart).getTime() > start);
  const hoursSincePrevious = previous
    ? (start - new Date(previous.matchStart).getTime()) / MS_HOUR
    : null;
  const hoursUntilNext = next
    ? (new Date(next.matchStart).getTime() - start) / MS_HOUR
    : null;

  const gamesInWindow = nearby.length;
  let level: FatigueInfo["level"] = "low";
  const notes: string[] = [];

  if (
    (hoursSincePrevious != null && hoursSincePrevious <= 28) ||
    (hoursUntilNext != null && hoursUntilNext <= 28)
  ) {
    level = "high";
    if (hoursSincePrevious != null && hoursSincePrevious <= 28) {
      notes.push(
        `spelade för ${Math.round(hoursSincePrevious)} h sedan (${previous!.description})`
      );
    }
    if (hoursUntilNext != null && hoursUntilNext <= 28) {
      notes.push(
        `spelar igen om ${Math.round(hoursUntilNext)} h (${next!.description})`
      );
    }
  } else if (
    gamesInWindow >= 3 ||
    (hoursSincePrevious != null && hoursSincePrevious <= 48) ||
    (hoursUntilNext != null && hoursUntilNext <= 48)
  ) {
    level = "medium";
    notes.push(`${gamesInWindow} matcher inom ±72 h`);
  } else if (gamesInWindow >= 2) {
    notes.push("ytterligare match inom tre dygn");
  }

  return {
    level,
    gamesInWindow,
    hoursSincePrevious:
      hoursSincePrevious != null ? Math.round(hoursSincePrevious) : null,
    hoursUntilNext: hoursUntilNext != null ? Math.round(hoursUntilNext) : null,
    note: notes.join("; ") || "normal belastning",
    upcoming: nearby
      .filter((o) => o.matchStart !== matchStart)
      .map((o) => ({
        drawNumber: o.drawNumber,
        closeTime: o.closeTime,
        matchStart: o.matchStart,
        description: o.description,
      })),
  };
}

function scoreHockeyOutcomes(args: {
  odds: Odds;
  homeFatigue: FatigueInfo;
  awayFatigue: FatigueInfo;
  homeTable: TableContext;
  awayTable: TableContext;
  homeRest: RestSignal;
  awayRest: RestSignal;
}) {
  const { odds, homeFatigue, awayFatigue, homeTable, awayTable, homeRest, awayRest } =
    args;
  const dist = distFromOdds(odds);
  const p1 = impliedProb(odds.one) || dist.one / 100;
  const pX = impliedProb(odds.x) || dist.x / 100;
  const p2 = impliedProb(odds.two) || dist.two / 100;

  // Oddset saknar folkstreck – lutning mer mot odds än Powerplay (55/45).
  let score1 = p1 * 0.7 + (dist.one / 100) * 0.3;
  let scoreX = pX * 0.7 + (dist.x / 100) * 0.3;
  let score2 = p2 * 0.7 + (dist.two / 100) * 0.3;

  const homePenalty =
    homeFatigue.level === "high" ? 0.08 : homeFatigue.level === "medium" ? 0.04 : 0;
  const awayPenalty =
    awayFatigue.level === "high" ? 0.08 : awayFatigue.level === "medium" ? 0.04 : 0;

  score1 = Math.max(0.01, score1 - homePenalty + awayPenalty * 0.6);
  score2 = Math.max(0.01, score2 - awayPenalty + homePenalty * 0.6);
  scoreX = Math.max(0.01, scoreX + (homePenalty + awayPenalty) * 0.25);

  const rankGap = homeTable.rankGapToOpponent;
  if (rankGap != null && rankGap <= 2) scoreX += 0.05;
  else if (rankGap != null && rankGap <= 4) scoreX += 0.025;

  if (homeTable.comfort === "comfortable" && awayTable.comfort !== "fighting") {
    scoreX += 0.04;
    score1 -= 0.025;
  }
  if (awayTable.comfort === "comfortable" && homeTable.comfort !== "fighting") {
    scoreX += 0.04;
    score2 -= 0.025;
  }
  if (
    homeTable.comfort === "comfortable" &&
    awayTable.comfort === "comfortable"
  ) {
    scoreX += 0.03;
  }

  const applyRest = (rest: RestSignal, isHome: boolean) => {
    if (rest.level === "none") return;
    const bump = rest.level === "likely" ? 0.07 : 0.04;
    const favCut = rest.level === "likely" ? 0.05 : 0.03;
    scoreX += bump;
    if (isHome) score1 -= favCut;
    else score2 -= favCut;
  };
  applyRest(homeRest, true);
  applyRest(awayRest, false);

  const sum = Math.max(score1 + scoreX + score2, 0.01);
  return {
    score1: score1 / sum,
    scoreX: scoreX / sum,
    score2: score2 / sum,
    dist,
  };
}

/**
 * Powerplay-inspirerad tipplogik men för Oddset: alltid ett huvudtecken (1/X/2),
 * med gardering sparad i pickCover när läget är jämnt.
 */
function pickHockey1x2(args: {
  scores: { score1: number; scoreX: number; score2: number };
  odds: Odds;
  valueOdds: ValueOddsInfo;
  homeFatigue: FatigueInfo;
  awayFatigue: FatigueInfo;
  homeTable: TableContext;
  awayTable: TableContext;
  homeRest: RestSignal;
  awayRest: RestSignal;
}): {
  pick: Oddset1x2Pick;
  cover: Outcome[];
  reason: string;
  confidence: number;
} {
  const {
    scores,
    odds,
    valueOdds,
    homeFatigue,
    awayFatigue,
    homeTable,
    awayTable,
    homeRest,
    awayRest,
  } = args;
  const ranked = (
    [
      { o: "1" as const, s: scores.score1 },
      { o: "X" as const, s: scores.scoreX },
      { o: "2" as const, s: scores.score2 },
    ] satisfies { o: Outcome; s: number }[]
  ).sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const second = ranked[1];
  const gap = top.s - second.s;
  const reasons: string[] = [];
  let cover: Outcome[] = [top.o];
  let pick: Oddset1x2Pick = top.o;
  let confidence = Math.round(top.s * 100);

  if (gap < 0.1 || top.s < 0.52) {
    cover = [top.o, second.o];
    reasons.push("jämnt/svagt läge – halvgardering i Powerplay-stil");
    confidence = Math.round(top.s * 100 - 4);
  } else if (gap < 0.18 && second.s > 0.2) {
    cover = [top.o, second.o];
    reasons.push("osäker favorit – halv för säkerhet");
  } else if (top.s >= 0.62 && gap >= 0.2) {
    reasons.push(
      `stark enkel ${top.o} (${Math.round(top.s * 100)}%, marginal ${Math.round(gap * 100)}%)`
    );
    confidence = Math.min(88, Math.round(top.s * 100 + 6));
  } else {
    cover = [top.o, second.o];
    reasons.push("medelstark favorit – halv i Powerplay-stil");
  }

  if (homeFatigue.level === "high" || awayFatigue.level === "high") {
    reasons.push("hög matchbelastning påverkar bedömningen");
  }
  if (
    homeTable.comfort === "comfortable" ||
    awayTable.comfort === "comfortable"
  ) {
    reasons.push("bra poängställning kan öka kryssrisken");
    if (!cover.includes("X") && scores.scoreX >= 0.2) cover = [...cover, "X"];
  }
  if (homeRest.level !== "none" || awayRest.level !== "none") {
    const restNotes = [homeRest, awayRest]
      .filter((r) => r.level !== "none")
      .map((r) => r.note);
    reasons.push(restNotes.join(". "));
    if (!cover.includes("X") && scores.scoreX >= 0.18) cover = [...cover, "X"];
  }

  const admin = valueOdds.admin;
  if (admin?.verdict) reasons.push(admin.verdict);

  if (admin?.safeWinner?.outcome === "2") {
    pick = "2";
    cover = ["2"];
    confidence = admin.confidence === "high" ? 86 : 78;
    reasons.push(
      `SÄKER VINNARE: 2 @ ${admin.safeWinner.odds
        .toFixed(2)
        .replace(".", ",")} – samma regel som Powerplay`
    );
  } else if (admin?.recommended) {
    const rec = admin.recommended;
    const recScore =
      rec === "1" ? scores.score1 : rec === "X" ? scores.scoreX : scores.score2;
    const midDog = /mittfält-underdog|4,xx|Gardera gärna favoriten/i.test(
      admin.verdict || ""
    );
    pick = rec;
    if (midDog) {
      const favSide = ranked[0].o === rec ? ranked[1].o : ranked[0].o;
      cover = [rec, favSide];
      reasons.push(`tippar ${rec} (huvud) · garderar ${favSide} – mittfält-underdog`);
      confidence = admin.confidence === "high" ? 76 : 70;
    } else if (admin.confidence === "high" && recScore >= 0.42) {
      cover = [rec];
      confidence = Math.max(confidence, 80);
      reasons.push(`tippar enkel ${rec} efter överodds-granskning`);
    } else {
      if (!cover.includes(rec)) cover = [...cover, rec].slice(0, 2);
      confidence = Math.max(confidence, 68);
      reasons.push(`tippar ${rec} efter överodds-granskning`);
    }
  }

  if (admin?.avoid?.length) {
    for (const o of admin.avoid) {
      const ov = valueOdds.outcomes.find((x) => x.outcome === o);
      const oddsTxt =
        ov?.odds != null ? ` @ ${ov.odds.toFixed(2).replace(".", ",")}` : "";
      reasons.push(`överodds-fälla ${o}${oddsTxt} undviks`);
    }
    const withoutTrap = cover.filter((o) => !admin.avoid.includes(o));
    if (withoutTrap.length >= 1) cover = withoutTrap;
    if (admin.avoid.includes(pick)) {
      pick = (withoutTrap[0] || top.o) as Oddset1x2Pick;
    }
  }

  if (valueOdds.overOddsOutcomes?.length) {
    for (const o of valueOdds.overOddsOutcomes) {
      const ov = valueOdds.outcomes.find((x) => x.outcome === o);
      const oddsTxt =
        ov?.odds != null ? ` @ ${ov.odds.toFixed(2).replace(".", ",")}` : "";
      if (!reasons.some((r) => r.includes(`överodds ${o}`))) {
        reasons.push(`överodds ${o}${oddsTxt}`);
      }
    }
  }

  reasons.unshift("Ishockey · 1X2 ordinarie tid (X efter 60 min) · Powerplay-analys");
  const pickOdds =
    pick === "1" ? odds.one : pick === "2" ? odds.two : odds.x;
  if (pickOdds != null) {
    reasons.push(`1X2 ${pick} @ ${pickOdds.toFixed(2).replace(".", ",")}`);
  }
  reasons.push(
    `1 @ ${(odds.one ?? 0).toFixed(2).replace(".", ",")} · X @ ${(
      odds.x ?? 0
    )
      .toFixed(2)
      .replace(".", ",")} · 2 @ ${(odds.two ?? 0).toFixed(2).replace(".", ",")}`
  );

  const order: Outcome[] = ["1", "X", "2"];
  cover = order.filter((o) => cover.includes(o));
  if (!cover.length) cover = [pick];

  return { pick, cover, reason: reasons.join(". "), confidence };
}

function emptyTable(): TableContext {
  return {
    rank: null,
    points: null,
    played: null,
    leagueSize: null,
    comfort: "unknown",
    rankGapToOpponent: null,
    note: "ingen tabelldata",
  };
}

function emptyRest(): RestSignal {
  return {
    level: "none",
    note: "ingen vilasignal",
    nextMatchDescription: null,
    nextOpponentRank: null,
    hoursUntilNext: null,
  };
}

export async function buildHockey1x2LikePowerplay(
  events: HockeyKambiEvent[],
  opts?: { maxAnalyze?: number }
): Promise<{
  candidates: OddsetCandidate[];
  alerts: HockeyAnalysisAlerts;
  analyzedCount: number;
}> {
  const alerts: HockeyAnalysisAlerts = {
    fatigueAlerts: [],
    tableAlerts: [],
    restAlerts: [],
    goalAlerts: [],
    valueAlerts: [],
  };

  const maxAnalyze = opts?.maxAnalyze ?? 60;
  const toAnalyze = events.slice(0, maxAnalyze);

  // Schema för belastning (namnbaserat från öppna Oddset-matcher)
  const schedule = new Map<string, SchedHit[]>();
  for (const ev of events) {
    const home = ev.homeName || ev.name.split(" - ")[0] || ev.name;
    const away =
      ev.awayName || ev.name.split(" - ").slice(1).join(" - ") || "";
    const desc = `${home} – ${away}`;
    const hit: SchedHit = {
      matchStart: ev.start,
      description: desc,
      drawNumber: ev.id,
      closeTime: ev.start,
    };
    for (const name of [home, away]) {
      const key = normalizeTeamKey(name);
      if (!key) continue;
      const list = schedule.get(key) || [];
      list.push(hit);
      schedule.set(key, list);
    }
  }

  const leagues = [
    ...new Set(toAnalyze.map((e) => e.group || "").filter(Boolean)),
  ];
  const tables = await loadLeagueTables(leagues);

  const candidates: OddsetCandidate[] = [];

  // Kör med begränsad parallellitet
  const concurrency = 5;
  for (let i = 0; i < toAnalyze.length; i += concurrency) {
    const slice = toAnalyze.slice(i, i + concurrency);
    const part = await Promise.all(
      slice.map(async (ev) => {
        try {
          return await analyzeOneHockeyEvent(ev, tables, schedule, alerts);
        } catch {
          return null;
        }
      })
    );
    for (const c of part) {
      if (c) candidates.push(c);
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.over25ProbPct - a.over25ProbPct ||
      new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  );

  return {
    candidates,
    alerts,
    analyzedCount: toAnalyze.length,
  };
}

async function analyzeOneHockeyEvent(
  ev: HockeyKambiEvent,
  tables: Awaited<ReturnType<typeof loadLeagueTables>>,
  schedule: Map<string, SchedHit[]>,
  alerts: HockeyAnalysisAlerts
): Promise<OddsetCandidate | null> {
  const homeName = ev.homeName || ev.name.split(" - ")[0] || ev.name;
  const awayName =
    ev.awayName || ev.name.split(" - ").slice(1).join(" - ") || "";
  const league = ev.group || "";
  const country = countryOf(ev);
  const home = teamInfo(homeName, "home");
  const away = teamInfo(awayName, "away");
  const table = tables.get(league) ?? null;

  let homeFatigue = fatigueFromSchedule(
    normalizeTeamKey(homeName),
    ev.start,
    schedule
  );
  let awayFatigue = fatigueFromSchedule(
    normalizeTeamKey(awayName),
    ev.start,
    schedule
  );

  if (league.toLowerCase() === "shl") {
    [homeFatigue, awayFatigue] = await Promise.all([
      enrichShlUpcoming(home.name, ev.start, table, homeFatigue),
      enrichShlUpcoming(away.name, ev.start, table, awayFatigue),
    ]);
  }

  if (homeFatigue.level !== "low") {
    alerts.fatigueAlerts.push(`${home.name}: ${homeFatigue.note}`);
  }
  if (awayFatigue.level !== "low") {
    alerts.fatigueAlerts.push(`${away.name}: ${awayFatigue.note}`);
  }

  const homeTable = table
    ? buildTableContext(home, away, table)
    : emptyTable();
  const awayTable = table
    ? buildTableContext(away, home, table)
    : emptyTable();

  if (
    homeTable.comfort === "comfortable" ||
    awayTable.comfort === "comfortable"
  ) {
    alerts.tableAlerts.push(
      `${home.name} (${homeTable.note}) vs ${away.name} (${awayTable.note})`
    );
  }

  const homeRest = table
    ? buildRestSignal({
        teamName: home.name,
        currentOpponentName: away.name,
        currentOpponentRank: awayTable.rank,
        leagueSize: homeTable.leagueSize,
        table,
        fatigue: homeFatigue,
        teamComfort: homeTable.comfort,
      })
    : emptyRest();
  const awayRest = table
    ? buildRestSignal({
        teamName: away.name,
        currentOpponentName: home.name,
        currentOpponentRank: homeTable.rank,
        leagueSize: awayTable.leagueSize,
        table,
        fatigue: awayFatigue,
        teamComfort: awayTable.comfort,
      })
    : emptyRest();

  if (homeRest.level !== "none") {
    alerts.restAlerts.push(`${home.name}: ${homeRest.note}`);
  }
  if (awayRest.level !== "none") {
    alerts.restAlerts.push(`${away.name}: ${awayRest.note}`);
  }

  // SVS regulation 1X2 först, sedan multi-book + sharp (samma som Powerplay)
  const quotes = await fetchSwedishBookQuotes(String(ev.id));
  const svsQuote =
    quotes.find((b) => b.book === "svenskaspel") || quotes[0] || null;
  if (
    !svsQuote ||
    svsQuote.one == null ||
    svsQuote.x == null ||
    svsQuote.two == null
  ) {
    return null;
  }
  const odds: Odds = {
    one: svsQuote.one,
    x: svsQuote.x,
    two: svsQuote.two,
  };

  const multi = await resolveMultiBookOdds({
    home: home.name,
    away: away.name,
    matchStart: ev.start,
    sport: "hockey",
    kambiEventId: String(ev.id),
    svsOdds: odds,
  });

  const scored = scoreHockeyOutcomes({
    odds,
    homeFatigue,
    awayFatigue,
    homeTable,
    awayTable,
    homeRest,
    awayRest,
  });

  const valueRaw = analyzeValueOdds({
    odds,
    dist: scored.dist,
    sport: "hockey",
    multiBook: multi,
  });
  const adjusted = applyValueOddsToScores(
    {
      score1: scored.score1,
      scoreX: scored.scoreX,
      score2: scored.score2,
    },
    valueRaw
  );

  const valueOdds: ValueOddsInfo = {
    outcomes: valueRaw.outcomes.map((o) => ({
      outcome: o.outcome,
      odds: o.odds,
      folkPct: o.folkPct,
      isOverOdds: o.isOverOdds,
      isValue: o.isValue,
      isTrashLongshot: o.isTrashLongshot,
      isTrap: o.isTrap,
      scoreBoost: o.scoreBoost,
      note: o.note,
      explain: o.explain,
    })),
    bestValue: valueRaw.bestValue,
    overOddsOutcomes: valueRaw.overOddsOutcomes,
    trapOverOddsOutcomes: valueRaw.trapOverOddsOutcomes,
    explanations: valueRaw.explanations,
    admin: valueRaw.admin,
    folkOddsDisagree: valueRaw.folkOddsDisagree,
    booksChecked: valueRaw.booksChecked,
    note: valueRaw.note,
    ryck: multi.ryck
      ? {
          toward: multi.ryck.toward,
          awayFrom: multi.ryck.awayFrom,
          booksMoved: multi.ryck.booksMoved,
          booksTotal: multi.ryck.booksTotal,
          avgDeltaPct: multi.ryck.avgDeltaPct,
          allProvidersSync: multi.ryck.allProvidersSync,
          sharpAligned: multi.ryck.sharpAligned,
          note: multi.ryck.note,
        }
      : null,
  };

  if (valueOdds.ryck?.note) {
    alerts.valueAlerts.push(`${home.name}–${away.name}: ${valueOdds.ryck.note}`);
  }
  if (valueOdds.admin?.safeWinner) {
    alerts.valueAlerts.push(
      `${home.name}–${away.name}: ${valueOdds.admin.safeWinner.note}`
    );
  }
  if (valueOdds.admin?.verdict) {
    alerts.valueAlerts.push(
      `${home.name}–${away.name}: ${valueOdds.admin.verdict}`
    );
  }

  const goals: GoalAnalysis = await analyzeMatchGoals({
    kambiEventId: String(ev.id),
    sport: "hockey",
    home,
    away,
    homeTable,
    awayTable,
    homeFatigue,
    awayFatigue,
    homeRest,
    awayRest,
    score1: adjusted.score1,
    score2: adjusted.score2,
    homeOdds: odds.one,
    awayOdds: odds.two,
  });

  if (goals.expectedGoals != null || goals.equalizer.level !== "weak") {
    alerts.goalAlerts.push(
      `${home.name}–${away.name}: ${goals.equalizer.headline}${
        goals.expectedGoals != null
          ? ` · ca ${goals.expectedGoals.toFixed(1).replace(".", ",")} mål (${goals.likelyRange})`
          : ""
      }`
    );
  }

  const picked = pickHockey1x2({
    scores: adjusted,
    odds,
    valueOdds,
    homeFatigue,
    awayFatigue,
    homeTable,
    awayTable,
    homeRest,
    awayRest,
  });

  const pickOdds =
    picked.pick === "1"
      ? odds.one!
      : picked.pick === "2"
        ? odds.two!
        : odds.x!;
  if (pickOdds < 1.28 || pickOdds > 5.5) return null;

  let reason = `${picked.reason}. ${goals.equalizer.headline}${
    goals.equalizer.points[0] ? ` · ${goals.equalizer.points[0]}` : ""
  }`;
  if (goals.expectedGoals != null) {
    reason += `. förväntade mål ≈ ${goals.expectedGoals
      .toFixed(2)
      .replace(".", ",")}`;
  }

  let score = picked.confidence * 1.15 + goals.equalizer.score * 2;
  const hr = hockeyLeagueRank(league, country);
  score += Math.max(0, 8 - hr * 3);
  if (valueOdds.admin?.safeWinner) score += 12;
  if (valueOdds.admin?.confidence === "high") score += 8;
  if (valueOdds.admin?.confidence === "medium") score += 4;
  if (valueOdds.ryck?.toward === picked.pick) score += 6;
  if (homeFatigue.level === "high" || awayFatigue.level === "high") score -= 3;
  if (picked.cover.length > 1) score -= 1;

  return {
    eventId: ev.id,
    home: homeName,
    away: awayName,
    league,
    country,
    kickoff: ev.start,
    sport: "hockey",
    market: "1x2",
    line: null,
    pick1x2: picked.pick,
    pickCover: picked.cover,
    odds: pickOdds,
    odds15: null,
    odds25: null,
    odds35: null,
    under15: null,
    homeOdds: odds.one,
    awayOdds: odds.two,
    drawOdds: odds.x,
    over25ProbPct: picked.confidence,
    expectedGoals: goals.expectedGoals,
    rivalry: EMPTY_RIVALRY,
    redCard: EMPTY_RED,
    equalizer: goals.equalizer,
    score,
    reason,
    url: eventUrl(ev.id),
    valueOdds,
    goals,
    homeFatigue,
    awayFatigue,
    homeTable,
    awayTable,
    homeRest,
    awayRest,
  };
}

export function emptyHockeyAlerts(): HockeyAnalysisAlerts {
  return {
    fatigueAlerts: [],
    tableAlerts: [],
    restAlerts: [],
    goalAlerts: [],
    valueAlerts: [],
  };
}
