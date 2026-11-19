import {
  favouriteFromDist,
  parseDistribution,
  parseOdds,
  participants,
  type RawDraw,
  type RawEvent,
} from "./svenskaspel";
import type {
  FatigueInfo,
  MatchAnalysis,
  Outcome,
  UpcomingMatch,
} from "./types";

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

function scoreOutcomes(event: RawEvent, homeFatigue: FatigueInfo, awayFatigue: FatigueInfo) {
  const odds = parseOdds(event.odds);
  const dist = parseDistribution(event.svenskaFolket);

  const p1 = impliedProb(odds.one) || dist.one / 100;
  const pX = impliedProb(odds.x) || dist.x / 100;
  const p2 = impliedProb(odds.two) || dist.two / 100;

  // Blend market implied probability with svenska folket
  let score1 = p1 * 0.55 + (dist.one / 100) * 0.45;
  let scoreX = pX * 0.55 + (dist.x / 100) * 0.45;
  let score2 = p2 * 0.55 + (dist.two / 100) * 0.45;

  // Fatigue: tired home team → slight away bump; tired away → home bump
  const homePenalty =
    homeFatigue.level === "high" ? 0.08 : homeFatigue.level === "medium" ? 0.04 : 0;
  const awayPenalty =
    awayFatigue.level === "high" ? 0.08 : awayFatigue.level === "medium" ? 0.04 : 0;

  score1 = Math.max(0.01, score1 - homePenalty + awayPenalty * 0.6);
  score2 = Math.max(0.01, score2 - awayPenalty + homePenalty * 0.6);
  scoreX = Math.max(0.01, scoreX + (homePenalty + awayPenalty) * 0.25);

  // Normalize
  const sum = score1 + scoreX + score2;
  return {
    score1: score1 / sum,
    scoreX: scoreX / sum,
    score2: score2 / sum,
    odds,
    dist,
  };
}

function buildPick(
  scores: { score1: number; scoreX: number; score2: number },
  homeFatigue: FatigueInfo,
  awayFatigue: FatigueInfo
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

  if (gap < 0.07) {
    pick = [top.o, second.o];
    reasons.push("jämnt läge – halvgardering");
  } else if (gap < 0.14 && second.s > 0.22) {
    pick = [top.o, second.o];
    reasons.push("osäker favorit – halv för säkerhet");
  } else {
    reasons.push(`starkast stöd för ${top.o} (${Math.round(top.s * 100)}%)`);
  }

  if (homeFatigue.level === "high" || awayFatigue.level === "high") {
    reasons.push("hög matchbelastning påverkar bedömningen");
    if (!pick.includes("X") && top.o !== "X" && scores.scoreX > 0.18) {
      // keep existing cover; note only
    }
  }

  const valueOutcomes = ranked
    .filter((r) => r.s >= 0.22)
    .map((r) => r.o)
    .slice(0, 2);

  return { pick, reason: reasons.join(". "), valueOutcomes };
}

export function analyzeDraw(
  draw: RawDraw,
  allDraws: RawDraw[]
): {
  matches: MatchAnalysis[];
  fatigueAlerts: string[];
  leagueSummary: string;
} {
  const schedule = buildTeamSchedule(allDraws);
  const matches: MatchAnalysis[] = [];
  const fatigueAlerts: string[] = [];
  const leagues = new Set<string>();

  for (const event of draw.drawEvents) {
    if (event.cancelled) continue;
    const { home, away } = participants(event);
    leagues.add(event.match.league.name);

    const homeFatigue = fatigueForTeam(home.id, event.match.matchStart, schedule);
    const awayFatigue = fatigueForTeam(away.id, event.match.matchStart, schedule);

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

    const scored = scoreOutcomes(event, homeFatigue, awayFatigue);
    const { pick, reason, valueOutcomes } = buildPick(
      scored,
      homeFatigue,
      awayFatigue
    );

    matches.push({
      eventNumber: event.eventNumber,
      description: event.eventDescription,
      league: event.match.league.name,
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
      pick,
      pickReason: reason,
      score1: scored.score1,
      scoreX: scored.scoreX,
      score2: scored.score2,
    });
  }

  matches.sort((a, b) => a.eventNumber - b.eventNumber);

  return {
    matches,
    fatigueAlerts,
    leagueSummary: [...leagues].join(", "),
  };
}
