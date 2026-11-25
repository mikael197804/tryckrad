import {
  buildRestSignal,
  buildTableContext,
  enrichFootballUpcoming,
  enrichShlUpcoming,
  loadLeagueTables,
  type LeagueTable,
} from "./context";
import { analyzeMatchGoals, kambiIdFromProviders } from "./goals";
import {
  analyzeMatchLineup,
  emptyLineup,
  lineupGoalAdjust,
  lineupScoreAdjust,
} from "./lineups";
import {
  favouriteFromDist,
  isFootballProduct,
  parseDistribution,
  parseOdds,
  participants,
  type ProductKind,
  type RawDraw,
  type RawEvent,
} from "./svenskaspel";
import type {
  FatigueInfo,
  MatchAnalysis,
  Outcome,
  RestSignal,
  SafeWinnerTip,
  TableContext,
  UpcomingMatch,
  ValueOddsInfo,
} from "./types";
import {
  learningAdjustForMatch,
  type LearningMemory,
} from "./learning";
import { resolveMultiBookOdds } from "./multiBookOdds";
import {
  analyzeValueOdds,
  applyValueOddsToScores,
  isOvertrustedHomeFavourite,
  overMarketValue,
} from "./valueOdds";

const MS_HOUR = 1000 * 60 * 60;

type TeamOccurrence = {
  teamId: number;
  teamName: string;
  drawNumber: number;
  closeTime: string;
  matchStart: string;
  description: string;
};

function buildTeamSchedule(draws: RawDraw[]): Map<number, TeamOccurrence[]> {
  const map = new Map<number, TeamOccurrence[]>();
  for (const draw of draws) {
    for (const event of draw.drawEvents) {
      if (event.cancelled) continue;
      for (const p of event.match.participants) {
        const list = map.get(p.id) ?? [];
        list.push({
          teamId: p.id,
          teamName: p.name,
          drawNumber: draw.drawNumber,
          closeTime: draw.regCloseTime,
          matchStart: event.match.matchStart,
          description: event.eventDescription,
        });
        map.set(p.id, list);
      }
    }
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        new Date(a.matchStart).getTime() - new Date(b.matchStart).getTime()
    );
  }
  return map;
}

function fatigueForTeam(
  teamId: number,
  matchStart: string,
  schedule: Map<number, TeamOccurrence[]>
): FatigueInfo {
  const start = new Date(matchStart).getTime();
  const all = schedule.get(teamId) ?? [];
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

  const upcoming: UpcomingMatch[] = nearby
    .filter((o) => o.matchStart !== matchStart)
    .map((o) => ({
      drawNumber: o.drawNumber,
      closeTime: o.closeTime,
      matchStart: o.matchStart,
      description: o.description,
    }));

  return {
    level,
    gamesInWindow,
    hoursSincePrevious:
      hoursSincePrevious != null ? Math.round(hoursSincePrevious) : null,
    hoursUntilNext:
      hoursUntilNext != null ? Math.round(hoursUntilNext) : null,
    note: notes.join("; ") || "normal belastning",
    upcoming,
  };
}

function impliedProb(odds: number | null): number {
  if (odds == null || odds <= 1) return 0;
  return 1 / odds;
}

function entropy(dist: { one: number; x: number; two: number }): number {
  const vals = [dist.one, dist.x, dist.two].map((v) => Math.max(v, 0.1) / 100);
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  return -vals
    .map((v) => v / sum)
    .reduce((acc, p) => acc + p * Math.log2(p), 0);
}

function scoreOutcomes(
  event: RawEvent,
  homeFatigue: FatigueInfo,
  awayFatigue: FatigueInfo,
  homeTable: TableContext,
  awayTable: TableContext,
  homeRest: RestSignal,
  awayRest: RestSignal
) {
  const odds = parseOdds(event.odds);
  const dist = parseDistribution(event.svenskaFolket);

  const p1 = impliedProb(odds.one) || dist.one / 100;
  const pX = impliedProb(odds.x) || dist.x / 100;
  const p2 = impliedProb(odds.two) || dist.two / 100;

  let score1 = p1 * 0.55 + (dist.one / 100) * 0.45;
  let scoreX = pX * 0.55 + (dist.x / 100) * 0.45;
  let score2 = p2 * 0.55 + (dist.two / 100) * 0.45;

  const homePenalty =
    homeFatigue.level === "high" ? 0.08 : homeFatigue.level === "medium" ? 0.04 : 0;
  const awayPenalty =
    awayFatigue.level === "high" ? 0.08 : awayFatigue.level === "medium" ? 0.04 : 0;

  score1 = Math.max(0.01, score1 - homePenalty + awayPenalty * 0.6);
  score2 = Math.max(0.01, score2 - awayPenalty + homePenalty * 0.6);
  scoreX = Math.max(0.01, scoreX + (homePenalty + awayPenalty) * 0.25);

  // Tabell: jämna placeringar eller trygg poängställning → mer X
  const rankGap = homeTable.rankGapToOpponent;
  if (rankGap != null && rankGap <= 2) {
    scoreX += 0.05;
  } else if (rankGap != null && rankGap <= 4) {
    scoreX += 0.025;
  }

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

  // Favorit med bra tabelläge mot svagare lag → mer kryss än vad odds säger
  if (
    homeTable.rank != null &&
    awayTable.rank != null &&
    homeTable.rank + 4 <= awayTable.rank &&
    homeTable.comfort === "comfortable"
  ) {
    scoreX += 0.035;
    score1 -= 0.02;
  }
  if (
    homeTable.rank != null &&
    awayTable.rank != null &&
    awayTable.rank + 4 <= homeTable.rank &&
    awayTable.comfort === "comfortable"
  ) {
    scoreX += 0.035;
    score2 -= 0.02;
  }

  // Vila inför viktigare match
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

  // Djup konsensus: odds + folk + tabell samma håll → spetsa favoriten (säkrare enkel)
  const oddsEntries: Array<{ o: Outcome; v: number }> = [];
  if (odds.one != null) oddsEntries.push({ o: "1", v: odds.one });
  if (odds.x != null) oddsEntries.push({ o: "X", v: odds.x });
  if (odds.two != null) oddsEntries.push({ o: "2", v: odds.two });
  oddsEntries.sort((a, b) => a.v - b.v);
  const oddsFav = oddsEntries[0]?.o;
  const folkFav = favouriteFromDist(dist);
  const leagueName = event.match?.league?.name || "";
  const overtrustedHome = isOvertrustedHomeFavourite({
    league: leagueName,
    homeOdds: odds.one,
    awayOdds: odds.two,
    folkHomePct: dist.one,
  });

  if (oddsFav && oddsFav === folkFav && !overtrustedHome) {
    if (oddsFav === "1") score1 += 0.055;
    if (oddsFav === "X") scoreX += 0.055;
    if (oddsFav === "2") score2 += 0.055;
    // Kort favoritodds → ännu säkrare enkel
    const favOdds = oddsEntries[0]?.v;
    if (favOdds != null && favOdds <= 1.55) {
      if (oddsFav === "1") score1 += 0.04;
      if (oddsFav === "X") scoreX += 0.04;
      if (oddsFav === "2") score2 += 0.04;
    }
  }

  // HockeyEttan m.fl.: korta hemmafavoriter med högt folk faller oftare
  // (Mjölby–Boro @ 1,68 / 67% folk → bortaseger). Tona ner 1, lyft 2.
  if (overtrustedHome) {
    score1 = Math.max(0.01, score1 - 0.09);
    score2 = score2 + 0.08;
    scoreX = scoreX + 0.025;
  }

  const sum = Math.max(score1 + scoreX + score2, 0.01);
  return {
    score1: score1 / sum,
    scoreX: scoreX / sum,
    score2: score2 / sum,
    odds,
    dist,
    overtrustedHome,
  };
}

function buildPick(
  scores: { score1: number; scoreX: number; score2: number },
  homeFatigue: FatigueInfo,
  awayFatigue: FatigueInfo,
  homeTable: TableContext,
  awayTable: TableContext,
  homeRest: RestSignal,
  awayRest: RestSignal,
  valueOdds?: ValueOddsInfo | null,
  opts?: { overtrustedHome?: boolean; league?: string }
): { pick: Outcome[]; reason: string; valueOutcomes: Outcome[] } {
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

  let pick: Outcome[] = [top.o];

  // Högre ribba för enkel – 48 kr-system kräver säkra enklar
  if (gap < 0.1 || top.s < 0.52) {
    pick = [top.o, second.o];
    reasons.push("jämnt/svagt läge – halvgardering för träffsäkerhet");
  } else if (gap < 0.18 && second.s > 0.2) {
    pick = [top.o, second.o];
    reasons.push("osäker favorit – halv för säkerhet");
  } else if (top.s >= 0.62 && gap >= 0.2) {
    reasons.push(
      `stark enkel ${top.o} (${Math.round(top.s * 100)}%, marginal ${Math.round(gap * 100)}%)`
    );
  } else {
    pick = [top.o, second.o];
    reasons.push("medelstark favorit – halv för att skydda 48 kr-system");
  }

  if (homeFatigue.level === "high" || awayFatigue.level === "high") {
    reasons.push("hög matchbelastning påverkar bedömningen");
  }

  if (
    homeTable.comfort === "comfortable" ||
    awayTable.comfort === "comfortable"
  ) {
    reasons.push("bra poängställning kan öka kryssrisken");
    if (!pick.includes("X") && scores.scoreX >= 0.2) {
      pick = [...pick, "X"];
    }
  }

  if (
    homeTable.rankGapToOpponent != null &&
    homeTable.rankGapToOpponent <= 2
  ) {
    reasons.push("jämna tabellplaceringar");
  }

  if (homeRest.level !== "none" || awayRest.level !== "none") {
    const restNotes = [homeRest, awayRest]
      .filter((r) => r.level !== "none")
      .map((r) => r.note);
    reasons.push(restNotes.join(". "));
    if (!pick.includes("X") && scores.scoreX >= 0.18) {
      pick = [...pick, "X"];
    }
  }

  const admin = valueOdds?.admin;
  if (admin?.verdict) {
    reasons.push(admin.verdict);
  }

  // Säker vinnare: alltid 2 @ odds ca 2,00 → enkel 2
  if (admin?.safeWinner?.outcome === "2") {
    pick = ["2"];
    reasons.push(
      `SÄKER VINNARE: 2 @ ${admin.safeWinner.odds.toFixed(2).replace(".", ",")} – oddset är 2`
    );
    const orderSafe: Outcome[] = ["1", "X", "2"];
    pick = orderSafe.filter((o) => pick.includes(o));
    return {
      pick,
      reason: reasons.join(". "),
      valueOutcomes: ["2"],
    };
  }

  // HockeyEttan m.fl.: övertröstat hemma – tvinga bortatäckning (inte enkel 1)
  if (opts?.overtrustedHome) {
    reasons.push(
      `lägre liga (${opts.league || "HockeyEttan"}): kort hemmafavorit med högt folkstreck – täck bortasegern (kolla form, inte bara oddsen)`
    );
    if (!pick.includes("2")) {
      if (pick.length <= 1) pick = [...pick, "2"];
      else {
        // Byt ut X mot 2 om vi redan har halv – bortasidan är risken
        pick = pick.includes("1") ? ["1", "2"] : [...pick.filter((o) => o !== "X"), "2"];
      }
    }
    // Aldrig enkel 1 i detta läge
    if (pick.length === 1 && pick[0] === "1") pick = ["1", "2"];
  }

  // Administrera tipset utifrån överodds-granskning
  if (admin?.recommended) {
    const rec = admin.recommended;
    const recScore =
      rec === "1" ? scores.score1 : rec === "X" ? scores.scoreX : scores.score2;
    const midDogCover =
      /mittfält-underdog|4,xx|Gardera gärna favoriten/i.test(
        admin.verdict || ""
      );
    if (midDogCover) {
      // Exempel 4,30 / 5,10 / 2,36 → tippa underdog + favorit
      const favSide = ranked[0].o === rec ? ranked[1].o : ranked[0].o;
      pick = [rec, favSide];
      reasons.push(
        `tippar ${rec}+${favSide} – mittfält-underdog (t.ex. 4,30) mot favorit`
      );
    } else if (admin.confidence === "high" && recScore >= 0.42) {
      // Stark bedömning: enkel på rekommenderad sida om inte extremt jämnt
      const others = ranked.filter((r) => r.o !== rec);
      const secondAlt = others[0];
      if (recScore - (secondAlt?.s ?? 0) >= 0.12 || recScore >= 0.55) {
        pick = [rec];
        reasons.push(`tippar enkel ${rec} efter överodds-granskning`);
      } else {
        pick = [rec, secondAlt.o].filter(Boolean) as Outcome[];
        reasons.push(`tippar ${rec} (+halv) efter överodds-granskning`);
      }
    } else if (!pick.includes(rec)) {
      // Medium/low: se till att rekommenderad sida är med
      if (pick.length < 2) pick = [...pick, rec];
      else if (admin.confidence !== "low") {
        // Byt ut den svagaste som inte är top
        const weak = [...pick]
          .filter((o) => o !== ranked[0].o)
          .sort((a, b) => {
            const sa =
              a === "1" ? scores.score1 : a === "X" ? scores.scoreX : scores.score2;
            const sb =
              b === "1" ? scores.score1 : b === "X" ? scores.scoreX : scores.score2;
            return sa - sb;
          })[0];
        if (weak && weak !== rec) {
          pick = pick.map((o) => (o === weak ? rec : o));
        }
      }
    }
  }

  // Ta bort fällor från tipset om det går (behåll minst en)
  if (admin?.avoid?.length) {
    for (const o of admin.avoid) {
      const ov = valueOdds?.outcomes.find((x) => x.outcome === o);
      const oddsTxt =
        ov?.odds != null ? ` @ ${ov.odds.toFixed(2).replace(".", ",")}` : "";
      reasons.push(`överodds-fälla ${o}${oddsTxt} undviks`);
    }
    const withoutTrap = pick.filter((o) => !admin.avoid.includes(o));
    if (withoutTrap.length >= 1) {
      pick = withoutTrap;
      // Om bara en kvar och läget var osäkert, lägg till näst bästa icke-fälla
      if (pick.length === 1 && (gap < 0.18 || top.s < 0.55)) {
        const alt = ranked.find(
          (r) => !pick.includes(r.o) && !admin.avoid.includes(r.o)
        );
        if (alt && alt.s >= 0.18) pick = [...pick, alt.o];
      }
    }
  }

  if (valueOdds?.overOddsOutcomes?.length) {
    for (const o of valueOdds.overOddsOutcomes) {
      const ov = valueOdds.outcomes.find((x) => x.outcome === o);
      const oddsTxt =
        ov?.odds != null ? ` @ ${ov.odds.toFixed(2).replace(".", ",")}` : "";
      if (!reasons.some((r) => r.includes(`överodds ${o}`))) {
        reasons.push(`överodds ${o}${oddsTxt}`);
      }
      if (
        !pick.includes(o) &&
        pick.length < 2 &&
        !(admin?.avoid || []).includes(o)
      ) {
        const s =
          o === "1" ? scores.score1 : o === "X" ? scores.scoreX : scores.score2;
        if (s >= 0.18) pick = [...pick, o];
      }
    }
  } else if (
    valueOdds?.bestValue &&
    !pick.includes(valueOdds.bestValue) &&
    !(admin?.avoid || []).includes(valueOdds.bestValue)
  ) {
    const o = valueOdds.bestValue;
    const s =
      o === "1" ? scores.score1 : o === "X" ? scores.scoreX : scores.score2;
    if (s >= 0.2 && pick.length < 2) {
      pick = [...pick, o];
      reasons.push(`värde på ${o}`);
    }
  }

  if (valueOdds?.folkOddsDisagree && !admin?.verdict.includes("Folk tippar")) {
    reasons.push("folk och odds favorit skiljer");
  }

  // Deduplicate pick order 1-X-2
  const order: Outcome[] = ["1", "X", "2"];
  pick = order.filter((o) => pick.includes(o));
  if (!pick.length) pick = [top.o];

  const valueOutcomes = [
    ...new Set([
      ...ranked.filter((r) => r.s >= 0.22).map((r) => r.o),
      ...(valueOdds?.overOddsOutcomes ?? []),
    ]),
  ].slice(0, 3) as Outcome[];

  return { pick, reason: reasons.join(". "), valueOutcomes };
}

export async function analyzeDraw(
  draw: RawDraw,
  allDraws: RawDraw[],
  product: ProductKind = "powerplay",
  learning: LearningMemory | null = null
): Promise<{
  matches: MatchAnalysis[];
  fatigueAlerts: string[];
  tableAlerts: string[];
  restAlerts: string[];
  goalAlerts: string[];
  lineupAlerts: string[];
  valueAlerts: string[];
  learningAlerts: string[];
  safeWinners: SafeWinnerTip[];
  malTip: number[];
  leagueSummary: string;
}> {
  const schedule = buildTeamSchedule(allDraws);
  const drafts: Array<
    Omit<
      MatchAnalysis,
      "goals" | "lineup" | "goalRank" | "malSelected"
    > & {
      startOdds: ReturnType<typeof parseOdds>;
    }
  > = [];
  const fatigueAlerts: string[] = [];
  const tableAlerts: string[] = [];
  const restAlerts: string[] = [];
  const goalAlerts: string[] = [];
  const lineupAlerts: string[] = [];
  const valueAlerts: string[] = [];
  const learningAlerts: string[] = learning?.lastRoundSummary?.length
    ? [...learning.lastRoundSummary]
    : [];
  if (learning?.biases?.note) {
    learningAlerts.push(`Bias till denna omgång: ${learning.biases.note}`);
  }
  const leagues = new Set<string>();
  const kambiByEvent = new Map<number, string | null>();
  const football = isFootballProduct(product);
  const goalSport = football ? "football" : "hockey";

  for (const event of draw.drawEvents) {
    if (event.cancelled) continue;
    leagues.add(event.match.league.name);
  }

  const tables = await loadLeagueTables([...leagues]);

  const activeEvents = draw.drawEvents.filter((e) => !e.cancelled);
  for (const event of activeEvents) {
    kambiByEvent.set(
      event.eventNumber,
      kambiIdFromProviders(event.providerIds)
    );
  }

  // Prefetch multi-book (SE-Kambi + Pinnacle sharp) parallellt
  const multiBookByEvent = new Map<
    number,
    Awaited<ReturnType<typeof resolveMultiBookOdds>>
  >();
  await Promise.all(
    activeEvents.map(async (event) => {
      const { home, away } = participants(event);
      const multi = await resolveMultiBookOdds({
        home: home.name,
        away: away.name,
        matchStart: event.match.matchStart,
        sport: goalSport,
        kambiEventId: kambiByEvent.get(event.eventNumber),
        svsOdds: parseOdds(event.odds),
      });
      multiBookByEvent.set(event.eventNumber, multi);
    })
  );

  for (const event of activeEvents) {
    const { home, away } = participants(event);
    const league = event.match.league.name;
    const table: LeagueTable | null = tables.get(league) ?? null;
    const startOdds = parseOdds(event.startOdds);

    let homeFatigue = fatigueForTeam(home.id, event.match.matchStart, schedule);
    let awayFatigue = fatigueForTeam(away.id, event.match.matchStart, schedule);

    if (league.toLowerCase() === "shl") {
      [homeFatigue, awayFatigue] = await Promise.all([
        enrichShlUpcoming(home.name, event.match.matchStart, table, homeFatigue),
        enrichShlUpcoming(away.name, event.match.matchStart, table, awayFatigue),
      ]);
    } else if (
      [
        "premier league",
        "championship",
        "la liga",
        "laliga",
        "serie a",
        "bundesliga",
        "ligue 1",
        "allsvenskan",
        "superettan",
      ].includes(league.toLowerCase())
    ) {
      [homeFatigue, awayFatigue] = await Promise.all([
        enrichFootballUpcoming(
          league,
          home.name,
          event.match.matchStart,
          homeFatigue
        ),
        enrichFootballUpcoming(
          league,
          away.name,
          event.match.matchStart,
          awayFatigue
        ),
      ]);
    }

    if (homeFatigue.level !== "low") {
      fatigueAlerts.push(
        `${home.name}: ${homeFatigue.note} (match ${event.eventNumber})`
      );
    }
    if (awayFatigue.level !== "low") {
      fatigueAlerts.push(
        `${away.name}: ${awayFatigue.note} (match ${event.eventNumber})`
      );
    }

    const homeTable = buildTableContext(home, away, table);
    const awayTable = buildTableContext(away, home, table);

    if (homeTable.comfort === "comfortable" || awayTable.comfort === "comfortable") {
      tableAlerts.push(
        `Match ${event.eventNumber}: ${home.name} (${homeTable.note}) vs ${away.name} (${awayTable.note})`
      );
    }

    const homeRest = buildRestSignal({
      teamName: home.name,
      currentOpponentName: away.name,
      currentOpponentRank: awayTable.rank,
      leagueSize: homeTable.leagueSize,
      table,
      fatigue: homeFatigue,
      teamComfort: homeTable.comfort,
    });
    const awayRest = buildRestSignal({
      teamName: away.name,
      currentOpponentName: home.name,
      currentOpponentRank: homeTable.rank,
      leagueSize: awayTable.leagueSize,
      table,
      fatigue: awayFatigue,
      teamComfort: awayTable.comfort,
    });

    if (homeRest.level !== "none") {
      restAlerts.push(
        `${home.name}: ${homeRest.note} (match ${event.eventNumber})`
      );
    }
    if (awayRest.level !== "none") {
      restAlerts.push(
        `${away.name}: ${awayRest.note} (match ${event.eventNumber})`
      );
    }

    const scored = scoreOutcomes(
      event,
      homeFatigue,
      awayFatigue,
      homeTable,
      awayTable,
      homeRest,
      awayRest
    );
    const valueRaw = analyzeValueOdds({
      odds: scored.odds,
      dist: scored.dist,
      sport: goalSport,
      multiBook: multiBookByEvent.get(event.eventNumber) ?? null,
    });
    let adjusted = applyValueOddsToScores(
      {
        score1: scored.score1,
        scoreX: scored.scoreX,
        score2: scored.score2,
      },
      valueRaw
    );
    // Behåll bortalyft efter värdeodds om hemma fortfarande är övertröstat
    if (scored.overtrustedHome && adjusted.score1 > adjusted.score2 + 0.12) {
      let s1 = Math.max(0.01, adjusted.score1 - 0.05);
      let s2 = adjusted.score2 + 0.045;
      let sX = adjusted.scoreX + 0.01;
      const sSum = Math.max(s1 + sX + s2, 0.01);
      adjusted = {
        score1: s1 / sSum,
        scoreX: sX / sSum,
        score2: s2 / sSum,
      };
    }
    const learnAdj = learningAdjustForMatch({
      memory: learning,
      home,
      away,
    });
    if (learnAdj.d1 || learnAdj.dX || learnAdj.d2) {
      let s1 = adjusted.score1 + learnAdj.d1;
      let sX = adjusted.scoreX + learnAdj.dX;
      let s2 = adjusted.score2 + learnAdj.d2;
      const sum = Math.max(s1 + sX + s2, 0.01);
      adjusted = { score1: s1 / sum, scoreX: sX / sum, score2: s2 / sum };
    }
    const learningNotes = learnAdj.notes;
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
      ryck: (() => {
        const r = multiBookByEvent.get(event.eventNumber)?.ryck ?? null;
        if (!r) return null;
        return {
          toward: r.toward,
          awayFrom: r.awayFrom,
          booksMoved: r.booksMoved,
          booksTotal: r.booksTotal,
          avgDeltaPct: r.avgDeltaPct,
          allProvidersSync: r.allProvidersSync,
          sharpAligned: r.sharpAligned,
          note: r.note,
        };
      })(),
    };
    if (valueOdds.ryck?.note) {
      valueAlerts.push(`Match ${event.eventNumber}: ${valueOdds.ryck.note}`);
    }
    if (valueOdds.admin?.safeWinner) {
      valueAlerts.push(
        `Match ${event.eventNumber}: ${valueOdds.admin.safeWinner.note}`
      );
    }
    if (valueOdds.admin?.verdict) {
      valueAlerts.push(`Match ${event.eventNumber}: ${valueOdds.admin.verdict}`);
    }
    if (valueOdds.explanations.length) {
      for (const line of valueOdds.explanations) {
        valueAlerts.push(`Match ${event.eventNumber}: ${line}`);
      }
    } else if (valueOdds.folkOddsDisagree && !valueOdds.admin?.verdict) {
      valueAlerts.push(`Match ${event.eventNumber}: ${valueOdds.note}`);
    }
    const { pick, reason, valueOutcomes } = buildPick(
      adjusted,
      homeFatigue,
      awayFatigue,
      homeTable,
      awayTable,
      homeRest,
      awayRest,
      valueOdds,
      { overtrustedHome: scored.overtrustedHome, league }
    );
    const pickReason = learningNotes.length
      ? `${reason}. ${learningNotes[0]}`
      : reason;

    const safeWinner: SafeWinnerTip | null = valueOdds.admin?.safeWinner
      ? {
          eventNumber: event.eventNumber,
          description: event.eventDescription,
          league,
          outcome: "2",
          odds: valueOdds.admin.safeWinner.odds,
          note: valueOdds.admin.safeWinner.note,
          confidence: valueOdds.admin.confidence,
        }
      : null;

    drafts.push({
      eventNumber: event.eventNumber,
      description: event.eventDescription,
      league,
      matchStart: event.match.matchStart,
      matchId: event.match.matchId,
      home,
      away,
      odds: scored.odds,
      svenskaFolket: scored.dist,
      favourite: favouriteFromDist(scored.dist),
      valueOutcomes,
      uncertainty: entropy(scored.dist),
      homeFatigue,
      awayFatigue,
      homeTable,
      awayTable,
      homeRest,
      awayRest,
      valueOdds,
      learningNotes,
      pick,
      pickReason,
      score1: adjusted.score1,
      scoreX: adjusted.scoreX,
      score2: adjusted.score2,
      safeWinner,
      startOdds,
    });
  }

  // Laguppställning / oddsrörelse + målanalys efter helhetsbilden
  let matches: MatchAnalysis[] = await Promise.all(
    drafts.map(async (draft) => {
      const { startOdds, ...base } = draft;
      const lineup = football
        ? await analyzeMatchLineup({
            home: draft.home,
            away: draft.away,
            league: draft.league,
            matchStart: draft.matchStart,
            startOdds,
            currentOdds: draft.odds,
          })
        : emptyLineup(draft.matchStart, "laganalys gäller fotbollstips");

      // draft.score* är redan värdeodds-justerade
      const adj = football ? lineupScoreAdjust(lineup) : { d1: 0, dX: 0, d2: 0 };
      let score1 = draft.score1 + adj.d1;
      let scoreX = draft.scoreX + adj.dX;
      let score2 = draft.score2 + adj.d2;
      const sum = Math.max(score1 + scoreX + score2, 0.01);
      score1 /= sum;
      scoreX /= sum;
      score2 /= sum;

      let pick = draft.pick;
      let pickReason = draft.pickReason;
      // Säker vinnare (2 @ ca 2) låses – lagnyheter får inte bryta enkel 2
      if (
        !draft.safeWinner &&
        (adj.d1 !== 0 || adj.dX !== 0 || adj.d2 !== 0)
      ) {
        const rebuilt = buildPick(
          { score1, scoreX, score2 },
          draft.homeFatigue,
          draft.awayFatigue,
          draft.homeTable,
          draft.awayTable,
          draft.homeRest,
          draft.awayRest,
          draft.valueOdds,
          {
            overtrustedHome: isOvertrustedHomeFavourite({
              league: draft.league,
              homeOdds: draft.odds.one,
              awayOdds: draft.odds.two,
              folkHomePct: draft.svenskaFolket.one,
            }),
            league: draft.league,
          }
        );
        pick = rebuilt.pick;
        pickReason = `${rebuilt.reason}. ${
          lineup.windowActive
            ? "Sen laganalys inräknad"
            : "Lagnyhet/oddsrörelse vägd in"
        }`;
      }

      if (
        football &&
        (lineup.windowActive ||
          lineup.items.length > 0 ||
          lineup.oddsDriftNote)
      ) {
        const impactBits = [
          lineup.homeImpact === "worse" || lineup.homeImpact === "better"
            ? `${draft.home.name}: ${lineup.homeImpact === "worse" ? "sämre" : "bättre"}`
            : null,
          lineup.awayImpact === "worse" || lineup.awayImpact === "better"
            ? `${draft.away.name}: ${lineup.awayImpact === "worse" ? "sämre" : "bättre"}`
            : null,
        ].filter(Boolean);
        if (impactBits.length || lineup.windowActive || lineup.oddsDriftNote) {
          lineupAlerts.push(
            `Match ${draft.eventNumber}${lineup.windowActive ? " · SEN 15 min" : ""}: ${
              impactBits.join(" · ") || lineup.oddsDriftNote || lineup.note
            }`
          );
        }
      }

      const goals = await analyzeMatchGoals({
        kambiEventId: kambiByEvent.get(draft.eventNumber) ?? null,
        sport: goalSport,
        home: draft.home,
        away: draft.away,
        homeTable: draft.homeTable,
        awayTable: draft.awayTable,
        homeFatigue: draft.homeFatigue,
        awayFatigue: draft.awayFatigue,
        homeRest: draft.homeRest,
        awayRest: draft.awayRest,
        score1,
        score2,
        homeOdds: draft.odds.one,
        awayOdds: draft.odds.two,
        lambdaAdjust: football ? lineupGoalAdjust(lineup) : 0,
      });
      // Utjämnarpress är inbakad i varje tips motivering
      pickReason = `${pickReason}. ${goals.equalizer.headline}${
        goals.equalizer.points[0] ? ` · ${goals.equalizer.points[0]}` : ""
      }`;
      if (goals.expectedGoals != null || goals.equalizer.level !== "weak") {
        goalAlerts.push(
          `Match ${draft.eventNumber}: ${goals.equalizer.headline}${
            goals.expectedGoals != null
              ? ` · ca ${goals.expectedGoals.toFixed(1).replace(".", ",")} mål (${goals.likelyRange})`
              : ""
          }`
        );
      }

      return {
        ...base,
        pick,
        pickReason,
        score1,
        scoreX,
        score2,
        goals,
        lineup,
        learningNotes: base.learningNotes || [],
        goalRank: null,
        malSelected: false,
      };
    })
  );

  // Måltipset: rangordna efter förväntat målantal, tippa topp 8
  let malTip: number[] = [];
  if (product === "maltipset") {
    const malScore = (m: MatchAnalysis) => {
      let s = m.goals.expectedGoals ?? 0;
      const ov = overMarketValue({
        overOdds: m.goals.mainLineOverOdds,
        modelProb:
          m.goals.over25ProbPct != null ? m.goals.over25ProbPct / 100 : null,
      });
      if (ov.isValue) s += 0.18;
      // Stark utjämnarpress (jakt på 1–1 vid 0–1) lyfter måltips
      if (m.goals.equalizer.level === "strong") s += 0.22;
      else if (m.goals.equalizer.level === "medium") s += 0.1;
      else s -= 0.08;
      return s;
    };
    const ranked = [...matches].sort((a, b) => {
      const ga = malScore(a);
      const gb = malScore(b);
      if (gb !== ga) return gb - ga;
      const oa = a.goals.over25ProbPct ?? 0;
      const ob = b.goals.over25ProbPct ?? 0;
      if (ob !== oa) return ob - oa;
      return a.eventNumber - b.eventNumber;
    });
    ranked.forEach((m, i) => {
      m.goalRank = i + 1;
      m.malSelected = i < 8;
    });
    malTip = ranked.slice(0, 8).map((m) => m.eventNumber);
    matches = matches
      .map((m) => {
        const r = ranked.find((x) => x.eventNumber === m.eventNumber)!;
        const ov = overMarketValue({
          overOdds: r.goals.mainLineOverOdds,
          modelProb:
            r.goals.over25ProbPct != null ? r.goals.over25ProbPct / 100 : null,
        });
        const valueBit = ov.note ? ` · ${ov.note}` : "";
        return {
          ...m,
          goalRank: r.goalRank,
          malSelected: r.malSelected,
          pickReason: r.malSelected
            ? `Måltips #${r.goalRank}: ${r.goals.note}${valueBit}`
            : `Ej bland topp 8 (rank ${r.goalRank}): ${r.goals.note}${valueBit}`,
        };
      })
      .sort((a, b) => a.eventNumber - b.eventNumber);
  } else {
    matches.sort((a, b) => a.eventNumber - b.eventNumber);
  }

  const safeWinners: SafeWinnerTip[] = matches
    .map((m) => m.safeWinner)
    .filter((s): s is SafeWinnerTip => s != null);

  return {
    matches,
    fatigueAlerts,
    tableAlerts,
    restAlerts,
    goalAlerts,
    lineupAlerts,
    valueAlerts,
    learningAlerts,
    safeWinners,
    malTip,
    leagueSummary: [...leagues].join(", "),
  };
}
