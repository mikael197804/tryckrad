import type {
  GeneratedSystem,
  MatchAnalysis,
  Outcome,
  SystemPick,
} from "./types";

const MIN_COST = 48;
const MAX_COST = 720;

/** Valid combination counts for 1 kr/rad with only halv (2) and hel (3). */
const TARGET_COSTS = [
  48, 72, 96, 144, 192, 216, 288, 384, 432, 576, 648,
] as const;

function coverLabel(outcomes: Outcome[]): SystemPick["cover"] {
  if (outcomes.length >= 3) return "hel";
  if (outcomes.length === 2) return "halv";
  return "enkel";
}

function rowCost(picks: SystemPick[]): number {
  return picks.reduce((acc, p) => acc * Math.max(1, p.outcomes.length), 1);
}

function uncertaintyRank(m: MatchAnalysis): number {
  const spread = Math.max(m.score1, m.scoreX, m.score2) -
    [m.score1, m.scoreX, m.score2].sort((a, b) => b - a)[1];
  const fatigueBoost =
    (m.homeFatigue.level === "high" ? 0.15 : m.homeFatigue.level === "medium" ? 0.07 : 0) +
    (m.awayFatigue.level === "high" ? 0.15 : m.awayFatigue.level === "medium" ? 0.07 : 0);
  return m.uncertainty + (1 - spread) + fatigueBoost;
}

function rankedOutcomes(m: MatchAnalysis): Outcome[] {
  return (
    [
      { o: "1" as const, s: m.score1 },
      { o: "X" as const, s: m.scoreX },
      { o: "2" as const, s: m.score2 },
    ] satisfies { o: Outcome; s: number }[]
  )
    .sort((a, b) => b.s - a.s)
    .map((x) => x.o);
}

function baseOutcomes(m: MatchAnalysis): Outcome[] {
  return [rankedOutcomes(m)[0]];
}

function halfOutcomes(m: MatchAnalysis): Outcome[] {
  const ranked = rankedOutcomes(m);
  return [ranked[0], ranked[1]];
}

function fullOutcomes(): Outcome[] {
  return ["1", "X", "2"];
}

function makePicks(
  matches: MatchAnalysis[],
  coverPlan: ("enkel" | "halv" | "hel")[]
): SystemPick[] {
  return matches.map((m, i) => {
    const plan = coverPlan[i] ?? "enkel";
    let outcomes: Outcome[];
    let reason = m.pickReason;
    if (plan === "hel") {
      outcomes = fullOutcomes();
      reason = `helgardering – ${m.pickReason}`;
    } else if (plan === "halv") {
      outcomes = halfOutcomes(m);
      reason = `halvgardering – ${m.pickReason}`;
    } else {
      outcomes = baseOutcomes(m);
    }
    return {
      eventNumber: m.eventNumber,
      description: m.description,
      outcomes,
      cover: coverLabel(outcomes),
      reason,
    };
  });
}

function planForCost(
  matches: MatchAnalysis[],
  target: number
): ("enkel" | "halv" | "hel")[] | null {
  const n = matches.length;
  const order = matches
    .map((m, i) => ({ i, u: uncertaintyRank(m) }))
    .sort((a, b) => b.u - a.u)
    .map((x) => x.i);

  // Find a,b such that 2^a * 3^b == target and a+b <= n
  for (let hel = 0; hel <= n; hel++) {
    for (let halv = 0; halv <= n - hel; halv++) {
      const cost = Math.pow(2, halv) * Math.pow(3, hel);
      if (cost === target) {
        const plan = Array<"enkel" | "halv" | "hel">(n).fill("enkel");
        let idx = 0;
        for (let h = 0; h < hel; h++) plan[order[idx++]] = "hel";
        for (let h = 0; h < halv; h++) plan[order[idx++]] = "halv";
        return plan;
      }
    }
  }
  return null;
}

function riskFromCost(cost: number): GeneratedSystem["risk"] {
  if (cost <= 96) return "högt";
  if (cost <= 288) return "medel";
  return "lågt";
}

function systemName(cost: number, index: number): string {
  const labels = ["Skarp", "Balanserad", "Bred"];
  return `${labels[index] ?? "System"} ${cost} kr`;
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 1; i <= k; i++) {
    r = (r * (n - k + i)) / i;
  }
  return Math.round(r);
}

/** Måltipset: markera N matcher, vinst om 8 målrikaste ingår (M-system). */
export function generateMaltipsetSystems(
  matches: MatchAnalysis[],
  rowPrice = 2.5
): GeneratedSystem[] {
  const ranked = [...matches].sort((a, b) => {
    const ra = a.goalRank ?? 999;
    const rb = b.goalRank ?? 999;
    return ra - rb;
  });
  if (ranked.length < 8) return [];

  const systems: GeneratedSystem[] = [];
  // M8–M12: radkostnad = C(n,8) * 2,50
  for (const n of [8, 9, 10, 11, 12]) {
    if (n > ranked.length) break;
    const rows = combinations(n, 8);
    const cost = Math.round(rows * rowPrice * 100) / 100;
    if (cost > 1500) continue;
    const selected = ranked.slice(0, n);
    const picks: SystemPick[] = matches.map((m) => {
      const on = selected.some((s) => s.eventNumber === m.eventNumber);
      return {
        eventNumber: m.eventNumber,
        description: m.description,
        outcomes: on ? (["1"] as Outcome[]) : [],
        cover: on ? "enkel" : "enkel",
        reason: on
          ? `Markerad (målrank ${m.goalRank})`
          : `Ej markerad (rank ${m.goalRank})`,
      };
    });
    systems.push({
      name: `M${n} · ${cost} kr`,
      costKr: cost,
      rows,
      picks,
      summary: `${n} matcher markerade · ${rows} rader × ${String(rowPrice).replace(".", ",")} kr. Tippar de målrikaste.`,
      risk: n <= 8 ? "högt" : n <= 10 ? "medel" : "lågt",
      kind: "mal",
      malEventNumbers: selected.map((m) => m.eventNumber),
    });
  }
  return systems;
}

export function generateSystems(matches: MatchAnalysis[]): GeneratedSystem[] {
  if (matches.length === 0) return [];

  const preferred = [48, 96, 144, 288, 432, 72, 192, 576];
  // Stryktipset (13): fler större system behövs ibland
  if (matches.length >= 13) {
    preferred.push(64, 108, 162, 216, 324, 486, 729);
  }
  const systems: GeneratedSystem[] = [];
  const used = new Set<number>();

  for (const target of preferred) {
    if (target < MIN_COST || target > MAX_COST) continue;
    if (used.has(target)) continue;
    const plan = planForCost(matches, target);
    if (!plan) continue;
    const picks = makePicks(matches, plan);
    const cost = rowCost(picks);
    if (cost < MIN_COST || cost > MAX_COST) continue;
    used.add(cost);

    const halv = picks.filter((p) => p.cover === "halv").length;
    const hel = picks.filter((p) => p.cover === "hel").length;
    const fatigueMatches = matches.filter(
      (m) =>
        m.homeFatigue.level !== "low" || m.awayFatigue.level !== "low"
    ).length;

    systems.push({
      name: systemName(cost, systems.length),
      costKr: cost,
      rows: cost,
      picks,
      summary: `${hel} hel · ${halv} halv · ${picks.length - hel - halv} enkel. ${fatigueMatches} matcher med förhöjd belastning vägdes in.`,
      risk: riskFromCost(cost),
      kind: "1x2",
    });

    if (systems.length >= 4) break;
  }

  // Fallback: build closest valid cost in range
  if (systems.length === 0) {
    for (const target of TARGET_COSTS) {
      const plan = planForCost(matches, target);
      if (!plan) continue;
      const picks = makePicks(matches, plan);
      const cost = rowCost(picks);
      systems.push({
        name: `System ${cost} kr`,
        costKr: cost,
        rows: cost,
        picks,
        summary: `Automatiskt system inom 48–720 kr.`,
        risk: riskFromCost(cost),
        kind: "1x2",
      });
      break;
    }
  }

  return systems.sort((a, b) => a.costKr - b.costKr);
}

export function formatCouponLine(pick: SystemPick): string {
  const marks = (["1", "X", "2"] as Outcome[])
    .map((o) => (pick.outcomes.includes(o) ? o : "·"))
    .join(" ");
  return `${String(pick.eventNumber).padStart(2, " ")}. ${pick.description.padEnd(22, " ")}  ${marks}`;
}
