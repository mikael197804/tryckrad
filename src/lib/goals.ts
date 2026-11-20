import type {
  FatigueInfo,
  GoalAnalysis,
  RestSignal,
  TableContext,
  TeamInfo,
} from "./types";

type KambiOutcome = { label?: string; odds?: number; line?: number };
type KambiBetOffer = {
  criterion?: { englishLabel?: string; label?: string };
  outcomes?: KambiOutcome[];
};

const KAMBI_BASE =
  "https://eu.offering-api.kambicdn.com/offering/v2018/svenskaspel";

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

function poissonPAtLeast(lambda: number, min: number): number {
  if (lambda <= 0) return 0;
  let pLess = 0;
  for (let k = 0; k < min; k++) {
    pLess += (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  }
  return Math.max(0, Math.min(1, 1 - pLess));
}

function deVigOver(
  over: number | null,
  under: number | null
): number | null {
  if (over == null || over <= 1) return null;
  if (under != null && under > 1) {
    const a = 1 / over;
    const b = 1 / under;
    return a / (a + b);
  }
  return Math.min(0.92, (1 / over) * 1.04);
}

type GoalLine = { line: number; over: number; under: number | null };

function extractHockeyGoalLines(betOffers: KambiBetOffer[]): {
  regulation: GoalLine[];
  withOt: GoalLine[];
} {
  const regulation: GoalLine[] = [];
  const withOt: GoalLine[] = [];

  for (const bo of betOffers) {
    const label = bo.criterion?.englishLabel || bo.criterion?.label || "";
    let bucket: GoalLine[] | null = null;
    if (label === "Total Goals - Regular Time") bucket = regulation;
    else if (
      label === "Total Goals - Including Overtime and Penalty Shootout"
    )
      bucket = withOt;
    else continue;

    let over: number | null = null;
    let under: number | null = null;
    let line: number | null = null;
    for (const o of bo.outcomes || []) {
      const side = (o.label || "").toLowerCase();
      const odds = parseOdds(o.odds);
      const ln = parseLine(o.line);
      if (odds == null || ln == null) continue;
      line = ln;
      if (side === "över" || side === "over") over = odds;
      if (side === "under") under = odds;
    }
    if (line != null && over != null) {
      bucket.push({ line, over, under });
    }
  }

  return { regulation, withOt };
}

function estimateLambda(lines: GoalLine[]): number | null {
  if (!lines.length) return null;
  const points = lines
    .map((l) => {
      const p = deVigOver(l.over, l.under);
      return p == null ? null : { line: l.line, pOver: p };
    })
    .filter((p): p is { line: number; pOver: number } => p != null);
  if (!points.length) return null;

  let bestL = 5.2;
  let bestErr = Infinity;
  for (let l = 3.0; l <= 8.5; l += 0.05) {
    let err = 0;
    for (const p of points) {
      const model = poissonPAtLeast(l, Math.floor(p.line) + 1);
      err += (model - p.pOver) ** 2;
    }
    if (err < bestErr) {
      bestErr = err;
      bestL = l;
    }
  }
  return Math.round(bestL * 100) / 100;
}

function likelyRange(lambda: number): string {
  const floor = Math.max(0, Math.floor(lambda - 0.6));
  const ceil = Math.ceil(lambda + 0.6);
  if (floor === ceil) return `${floor}`;
  return `${floor}–${ceil}`;
}

function attackNeed(
  table: TableContext,
  rest: RestSignal,
  fatigue: FatigueInfo,
  isFavourite: boolean
): GoalAnalysis["homeAttackNeed"] {
  if (rest.level === "likely") return "low";
  if (table.comfort === "fighting") return "high";
  if (fatigue.level === "high" && table.comfort === "comfortable") return "low";
  if (table.comfort === "comfortable" && isFavourite) return "low";
  if (table.comfort === "comfortable") return "medium";
  if (!isFavourite && table.comfort !== "unknown") return "high";
  return "medium";
}

function emptyGoals(note: string): GoalAnalysis {
  return {
    expectedGoals: null,
    likelyRange: "–",
    over45ProbPct: null,
    over55ProbPct: null,
    mainLine: null,
    mainLineOverOdds: null,
    homeAttackNeed: "medium",
    awayAttackNeed: "medium",
    homeNeedNote: "",
    awayNeedNote: "",
    note,
  };
}

async function fetchKambiOffers(eventId: string): Promise<KambiBetOffer[]> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(
        `${KAMBI_BASE}/betoffer/event/${eventId}.json?lang=sv_SE&market=SE`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "MikaelsTips/1.0",
            Origin: "https://www.svenskaspel.se",
            Referer: "https://www.svenskaspel.se/oddset",
          },
          next: { revalidate: 120 },
        }
      );
      if (res.status === 410 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
        continue;
      }
      if (!res.ok) return [];
      const data = (await res.json()) as { betOffers?: KambiBetOffer[] };
      return data.betOffers || [];
    } catch {
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  return [];
}

function needNote(
  team: TeamInfo,
  need: GoalAnalysis["homeAttackNeed"],
  table: TableContext
): string {
  if (need === "high") {
    if (table.comfort === "fighting") {
      return `${team.name} behöver poäng – jagar mål`;
    }
    return `${team.name} måste skapa mer – utmanare`;
  }
  if (need === "low") {
    if (table.comfort === "comfortable") {
      return `${team.name} har råd att lugna – färre forcerade mål`;
    }
    return `${team.name} kan prioritera vila/kontroll`;
  }
  return `${team.name} normal målhunger`;
}

export async function analyzeMatchGoals(args: {
  kambiEventId: string | null;
  home: TeamInfo;
  away: TeamInfo;
  homeTable: TableContext;
  awayTable: TableContext;
  homeFatigue: FatigueInfo;
  awayFatigue: FatigueInfo;
  homeRest: RestSignal;
  awayRest: RestSignal;
  score1: number;
  score2: number;
}): Promise<GoalAnalysis> {
  const {
    kambiEventId,
    home,
    away,
    homeTable,
    awayTable,
    homeFatigue,
    awayFatigue,
    homeRest,
    awayRest,
    score1,
    score2,
  } = args;

  const homeFav = score1 >= score2;
  const homeNeed = attackNeed(homeTable, homeRest, homeFatigue, homeFav);
  const awayNeed = attackNeed(awayTable, awayRest, awayFatigue, !homeFav);

  if (!kambiEventId) {
    const g = emptyGoals("ingen målmarknad kopplad");
    g.homeAttackNeed = homeNeed;
    g.awayAttackNeed = awayNeed;
    g.homeNeedNote = needNote(home, homeNeed, homeTable);
    g.awayNeedNote = needNote(away, awayNeed, awayTable);
    g.note = `${g.homeNeedNote}. ${g.awayNeedNote}`;
    return g;
  }

  const offers = await fetchKambiOffers(kambiEventId);
  const { regulation, withOt } = extractHockeyGoalLines(offers);
  const lines = regulation.length ? regulation : withOt;
  if (!lines.length) {
    const g = emptyGoals("målodds saknas just nu");
    g.homeAttackNeed = homeNeed;
    g.awayAttackNeed = awayNeed;
    g.homeNeedNote = needNote(home, homeNeed, homeTable);
    g.awayNeedNote = needNote(away, awayNeed, awayTable);
    g.note = `${g.homeNeedNote}. ${g.awayNeedNote}`;
    return g;
  }

  let lambda = estimateLambda(lines);
  // Justera lätt efter motivation/vila
  if (lambda != null) {
    if (homeNeed === "high" || awayNeed === "high") lambda += 0.15;
    if (homeNeed === "low" && awayNeed === "low") lambda -= 0.2;
    if (homeRest.level === "likely" || awayRest.level === "likely") lambda -= 0.25;
    if (homeFatigue.level === "high" || awayFatigue.level === "high") lambda -= 0.15;
    lambda = Math.round(Math.max(2.8, lambda) * 100) / 100;
  }

  const line45 = lines.find((l) => l.line === 4.5);
  const line55 = lines.find((l) => l.line === 5.5);
  const main =
    lines.find((l) => l.line === 5.5) ||
    lines.find((l) => l.line === 4.5) ||
    lines[0];

  const over45 =
    lambda != null
      ? poissonPAtLeast(lambda, 5)
      : deVigOver(line45?.over ?? null, line45?.under ?? null);
  const over55 =
    lambda != null
      ? poissonPAtLeast(lambda, 6)
      : deVigOver(line55?.over ?? null, line55?.under ?? null);

  const homeNeedNote = needNote(home, homeNeed, homeTable);
  const awayNeedNote = needNote(away, awayNeed, awayTable);
  const parts: string[] = [];
  if (lambda != null) {
    parts.push(
      `ca ${lambda.toFixed(1).replace(".", ",")} mål totalt (troligen ${likelyRange(lambda)})`
    );
  }
  if (over45 != null) {
    parts.push(`Över 4,5 ≈ ${Math.round(over45 * 100)}%`);
  }
  if (over55 != null) {
    parts.push(`Över 5,5 ≈ ${Math.round(over55 * 100)}%`);
  }
  parts.push(homeNeedNote);
  parts.push(awayNeedNote);

  return {
    expectedGoals: lambda,
    likelyRange: lambda != null ? likelyRange(lambda) : "–",
    over45ProbPct: over45 != null ? Math.round(over45 * 1000) / 10 : null,
    over55ProbPct: over55 != null ? Math.round(over55 * 1000) / 10 : null,
    mainLine: main?.line ?? null,
    mainLineOverOdds: main?.over ?? null,
    homeAttackNeed: homeNeed,
    awayAttackNeed: awayNeed,
    homeNeedNote,
    awayNeedNote,
    note: parts.join(". "),
  };
}

export function kambiIdFromProviders(
  providers?: Array<{ provider?: string; id?: string }> | null
): string | null {
  const hit = (providers || []).find(
    (p) => (p.provider || "").toLowerCase() === "kambi" && p.id
  );
  return hit?.id ?? null;
}
