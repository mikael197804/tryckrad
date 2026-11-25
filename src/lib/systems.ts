import type {
  GeneratedSystem,
  MatchAnalysis,
  Outcome,
  SystemPick,
} from "./types";
import {
  isMidUnderdogOdds,
  isOvertrustedHomeFavourite,
} from "./valueOdds";

const MIN_COST = 48;
const MAX_COST = 720;

/** Valid combination counts for 1 kr/rad with only halv (2) and hel (3). */
const TARGET_COSTS = [
  48, 72, 96, 144, 192, 216, 288, 384, 432, 576, 648,
] as const;

type CoverPlan = "enkel" | "halv" | "hel";

type MatchProb = {
  p1: number;
  pX: number;
  p2: number;
  bestSingle: Outcome;
  bestSingleP: number;
  bestHalf: Outcome[];
  bestHalfP: number;
  /** Hur mycket halv förbättrar vs enkel (högre = behöver gardering). */
  hedgeNeed: number;
};

function coverLabel(outcomes: Outcome[]): SystemPick["cover"] {
  if (outcomes.length >= 3) return "hel";
  if (outcomes.length === 2) return "halv";
  return "enkel";
}

function rowCost(picks: SystemPick[]): number {
  return picks.reduce((acc, p) => acc * Math.max(1, p.outcomes.length), 1);
}

function normalize3(a: number, b: number, c: number): [number, number, number] {
  const s = Math.max(a + b + c, 0.01);
  return [a / s, b / s, c / s];
}

/** Djupare sannolikhet: scores + odds + folk, kalibrerad mot säkra enklar. */
export function matchProbabilities(m: MatchAnalysis): MatchProb {
  let s1 = Math.max(m.score1, 0.01);
  let sX = Math.max(m.scoreX, 0.01);
  let s2 = Math.max(m.score2, 0.01);

  // Odds-implicit
  const o1 = m.odds.one != null && m.odds.one > 1 ? 1 / m.odds.one : null;
  const oX = m.odds.x != null && m.odds.x > 1 ? 1 / m.odds.x : null;
  const o2 = m.odds.two != null && m.odds.two > 1 ? 1 / m.odds.two : null;
  if (o1 != null && oX != null && o2 != null) {
    const [n1, nX, n2] = normalize3(o1, oX, o2);
    s1 = s1 * 0.55 + n1 * 0.45;
    sX = sX * 0.55 + nX * 0.45;
    s2 = s2 * 0.55 + n2 * 0.45;
  }

  // Folk
  const fSum = Math.max(
    m.svenskaFolket.one + m.svenskaFolket.x + m.svenskaFolket.two,
    0.01
  );
  const f1 = m.svenskaFolket.one / fSum;
  const fX = m.svenskaFolket.x / fSum;
  const f2 = m.svenskaFolket.two / fSum;
  s1 = s1 * 0.85 + f1 * 0.15;
  sX = sX * 0.85 + fX * 0.15;
  s2 = s2 * 0.85 + f2 * 0.15;

  // Konsensusboost: när modell/odds/folk pekar samma håll → spetsa enkel
  const modelTop = (
    [
      ["1", s1],
      ["X", sX],
      ["2", s2],
    ] as [Outcome, number][]
  ).sort((a, b) => b[1] - a[1])[0][0];
  const oddsTop =
    o1 != null && oX != null && o2 != null
      ? (
          [
            ["1", o1],
            ["X", oX],
            ["2", o2],
          ] as [Outcome, number][]
        ).sort((a, b) => b[1] - a[1])[0][0]
      : null;
  const folkTop = (
    [
      ["1", f1],
      ["X", fX],
      ["2", f2],
    ] as [Outcome, number][]
  ).sort((a, b) => b[1] - a[1])[0][0];

  const overtrustedHome = isOvertrustedHomeFavourite({
    league: m.league,
    homeOdds: m.odds.one,
    awayOdds: m.odds.two,
    folkHomePct: m.svenskaFolket.one,
  });

  // Spetsa inte kort hemmafavorit i HockeyEttan m.fl. – där faller 1 oftare
  if (
    oddsTop &&
    modelTop === oddsTop &&
    modelTop === folkTop &&
    !(overtrustedHome && modelTop === "1")
  ) {
    if (modelTop === "1") s1 += 0.11;
    if (modelTop === "X") sX += 0.11;
    if (modelTop === "2") s2 += 0.11;
  } else if (
    oddsTop &&
    modelTop === oddsTop &&
    !(overtrustedHome && modelTop === "1")
  ) {
    if (modelTop === "1") s1 += 0.055;
    if (modelTop === "X") sX += 0.055;
    if (modelTop === "2") s2 += 0.055;
  }

  if (overtrustedHome) {
    s1 = Math.max(0.01, s1 - 0.07);
    s2 += 0.06;
    sX += 0.02;
  }

  // Osäkerhetssignaler → mer X / plattare
  if (m.homeFatigue.level === "high" || m.awayFatigue.level === "high") {
    sX += 0.05;
  }
  if (m.homeRest.level === "likely" || m.awayRest.level === "likely") {
    sX += 0.04;
  }
  if (
    m.homeTable.rankGapToOpponent != null &&
    m.homeTable.rankGapToOpponent <= 2
  ) {
    sX += 0.03;
  }

  [s1, sX, s2] = normalize3(s1, sX, s2);

  const singles: { o: Outcome; p: number }[] = [
    { o: "1", p: s1 },
    { o: "X", p: sX },
    { o: "2", p: s2 },
  ];
  singles.sort((a, b) => b.p - a.p);
  const bestSingle = singles[0].o;
  const bestSingleP = singles[0].p;

  const halves: { outcomes: Outcome[]; p: number }[] = [
    { outcomes: ["1", "X"], p: s1 + sX },
    { outcomes: ["1", "2"], p: s1 + s2 },
    { outcomes: ["X", "2"], p: sX + s2 },
  ];
  halves.sort((a, b) => b.p - a.p);
  let bestHalf = halves[0].outcomes;
  let bestHalfP = halves[0].p;

  // Övertröstat hemma i lägre liga: halv ska vara 12 (inte 1X)
  if (overtrustedHome) {
    const twelve = halves.find(
      (h) => h.outcomes.includes("1") && h.outcomes.includes("2")
    );
    if (twelve) {
      bestHalf = twelve.outcomes;
      bestHalfP = twelve.p;
    }
  } else if (
    m.odds.one != null &&
    m.odds.two != null &&
    m.odds.one <= 2.0 &&
    isMidUnderdogOdds(m.odds.two) &&
    m.pick?.includes("2") &&
    m.pick?.includes("1")
  ) {
    const twelve = halves.find(
      (h) => h.outcomes.includes("1") && h.outcomes.includes("2")
    );
    if (twelve && twelve.p + 0.02 >= bestHalfP) {
      bestHalf = twelve.outcomes;
      bestHalfP = twelve.p;
    }
  }

  // Behöver gardering om enkel är svag eller halv ger stor lyft
  let hedgeNeed =
    1 - bestSingleP + Math.max(0, bestHalfP - bestSingleP) * 0.85;
  if (overtrustedHome) {
    // Tvinga upp prioritet för halv – får inte bli enkel 1
    hedgeNeed = Math.max(hedgeNeed, 0.72);
  }

  return {
    p1: s1,
    pX: sX,
    p2: s2,
    bestSingle,
    bestSingleP: overtrustedHome
      ? Math.min(bestSingleP, 0.54)
      : bestSingleP,
    bestHalf,
    bestHalfP,
    hedgeNeed,
  };
}

function estimatedCoverP(m: MatchAnalysis, cover: CoverPlan): number {
  const pr = matchProbabilities(m);
  if (cover === "hel") return 0.997;
  if (cover === "halv") return Math.min(0.98, Math.max(0.58, pr.bestHalfP));
  // Enkel: kräv kalibrering – spetsade konsensusfavoriter behåller mer
  const peak = pr.bestSingleP;
  const cal = peak >= 0.7 ? 0.99 : peak >= 0.62 ? 0.97 : 0.94;
  return Math.min(0.93, Math.max(0.36, peak * cal));
}

function estimateSystemHitPct(
  matches: MatchAnalysis[],
  plan: CoverPlan[]
): number {
  let p = 1;
  for (let i = 0; i < matches.length; i++) {
    p *= estimatedCoverP(matches[i], plan[i] ?? "enkel");
  }
  return Math.round(p * 1000) / 10;
}

/** P(minst k matcher täcks) med olika p per match (DP). */
function estimateAtLeastK(coverPs: number[], k: number): number {
  const n = coverPs.length;
  let dp = Array(n + 1).fill(0);
  dp[0] = 1;
  for (const p of coverPs) {
    const next = Array(n + 1).fill(0);
    for (let s = 0; s <= n; s++) {
      if (!dp[s]) continue;
      next[s] += dp[s] * (1 - p);
      if (s + 1 <= n) next[s + 1] += dp[s] * p;
    }
    dp = next;
  }
  let sum = 0;
  for (let s = k; s <= n; s++) sum += dp[s];
  return Math.round(Math.min(1, Math.max(0, sum)) * 1000) / 10;
}

function coverPsForPlan(
  matches: MatchAnalysis[],
  plan: CoverPlan[]
): number[] {
  return matches.map((m, i) => estimatedCoverP(m, plan[i] ?? "enkel"));
}

function estimateWinPct(
  matches: MatchAnalysis[],
  plan: CoverPlan[]
): number {
  const ps = coverPsForPlan(matches, plan);
  const n = ps.length;
  // 8-matcherspel (PP/Topp): utdelning bara vid 8 rätt
  if (n >= 7 && n <= 9) {
    return estimateAtLeastK(ps, n);
  }
  if (n >= 13) {
    // Stryk: visa P(≥10) som mjuk vinstproxy
    return estimateAtLeastK(ps, 10);
  }
  return estimateSystemHitPct(matches, plan);
}

/**
 * Välj hel/halv/enkel så att P(hela kupongen täcks) maximeras
 * för given radkostnad 2^halv * 3^hel.
 */
function planForHighHit(
  matches: MatchAnalysis[],
  target: number
): CoverPlan[] | null {
  const n = matches.length;
  const probs = matches.map(matchProbabilities);

  // Kandidater: (hel, halv) som ger exakt target
  const candidates: Array<{ hel: number; halv: number }> = [];
  for (let hel = 0; hel <= n; hel++) {
    for (let halv = 0; halv <= n - hel; halv++) {
      if (Math.pow(2, halv) * Math.pow(3, hel) === target) {
        candidates.push({ hel, halv });
      }
    }
  }
  if (!candidates.length) return null;

  let bestPlan: CoverPlan[] | null = null;
  let bestP = -1;

  for (const { hel, halv } of candidates) {
    // Sortera: störst hedgeNeed först (behöver täckning)
    const order = probs
      .map((pr, i) => ({
        i,
        need: pr.hedgeNeed,
        // Bland lika: lägre bestHalfP ska ha hel före halv
        halfP: pr.bestHalfP,
        singleP: pr.bestSingleP,
      }))
      .sort(
        (a, b) =>
          b.need - a.need || a.halfP - b.halfP || a.singleP - b.singleP
      );

    const plan: CoverPlan[] = Array(n).fill("enkel");
    let idx = 0;
    // Hel först på de som halv fortfarande missar mest
    const helOrder = [...order].sort(
      (a, b) => a.halfP - b.halfP || b.need - a.need
    );
    for (let h = 0; h < hel; h++) {
      plan[helOrder[h].i] = "hel";
    }
    for (const o of order) {
      if (idx >= halv) break;
      if (plan[o.i] === "hel") continue;
      // Enkel bara om riktigt stark – annars prioritera halv-slot hit
      plan[o.i] = "halv";
      idx++;
    }

    // Om vi har halv-slots kvar (borde inte hända): fyll
    for (let i = 0; i < n && idx < halv; i++) {
      if (plan[i] === "enkel") {
        plan[i] = "halv";
        idx++;
      }
    }

    // Flytta halv → enkel bara på extremt säkra matcher om vi har för många halv?
    // Nej – för target är antalet fixerat.

    // Extra: om en "enkel" har bestSingleP < 0.58, byt med en halv som är säkrare enkel
    const enkelIdx = plan
      .map((c, i) => ({ c, i, p: probs[i].bestSingleP }))
      .filter((x) => x.c === "enkel");
    const halvIdx = plan
      .map((c, i) => ({ c, i, p: probs[i].bestSingleP, halfP: probs[i].bestHalfP }))
      .filter((x) => x.c === "halv");

    for (const e of enkelIdx) {
      if (e.p >= 0.62) continue;
      // Byt med halv som har högre singleP (den halv-matchen är säkrare som enkel)
      const swap = halvIdx
        .filter((h) => h.p > e.p + 0.04)
        .sort((a, b) => b.p - a.p)[0];
      if (!swap) continue;
      plan[e.i] = "halv";
      plan[swap.i] = "enkel";
      swap.p = -1; // förbrukad
    }

    // Maximera vinstnivå (≥ n-1) i första hand, helträff som tiebreak
    const win = estimateWinPct(matches, plan);
    const hit = estimateSystemHitPct(matches, plan);
    const score = win * 10 + hit;
    if (score > bestP) {
      bestP = score;
      bestPlan = plan;
    }
  }

  return bestPlan;
}

/** Äldre osäkerhetsrank – fallback. */
function uncertaintyRank(m: MatchAnalysis): number {
  const spread =
    Math.max(m.score1, m.scoreX, m.score2) -
    [m.score1, m.scoreX, m.score2].sort((a, b) => b - a)[1];
  const fatigueBoost =
    (m.homeFatigue.level === "high"
      ? 0.15
      : m.homeFatigue.level === "medium"
        ? 0.07
        : 0) +
    (m.awayFatigue.level === "high"
      ? 0.15
      : m.awayFatigue.level === "medium"
        ? 0.07
        : 0);
  return m.uncertainty + (1 - spread) + fatigueBoost;
}

function planForCost(
  matches: MatchAnalysis[],
  target: number
): CoverPlan[] | null {
  // Primärt: maximera träffsannolikhet
  const highHit = planForHighHit(matches, target);
  if (highHit) return highHit;

  const n = matches.length;
  const order = matches
    .map((m, i) => ({ i, u: uncertaintyRank(m) }))
    .sort((a, b) => b.u - a.u)
    .map((x) => x.i);

  for (let hel = 0; hel <= n; hel++) {
    for (let halv = 0; halv <= n - hel; halv++) {
      const cost = Math.pow(2, halv) * Math.pow(3, hel);
      if (cost === target) {
        const plan = Array<CoverPlan>(n).fill("enkel");
        let idx = 0;
        for (let h = 0; h < hel; h++) plan[order[idx++]] = "hel";
        for (let h = 0; h < halv; h++) plan[order[idx++]] = "halv";
        return plan;
      }
    }
  }
  return null;
}

function makePicks(
  matches: MatchAnalysis[],
  coverPlan: CoverPlan[]
): SystemPick[] {
  // Den match vi minst kan avgöra = hel, annars svagaste halv
  let undecidedIdx = coverPlan.findIndex((c) => c === "hel");
  if (undecidedIdx < 0) {
    let worst = -1;
    let worstNeed = -1;
    for (let i = 0; i < matches.length; i++) {
      if (coverPlan[i] !== "halv") continue;
      const need = matchProbabilities(matches[i]).hedgeNeed;
      if (need > worstNeed) {
        worstNeed = need;
        worst = i;
      }
    }
    undecidedIdx = worst;
  }

  return matches.map((m, i) => {
    const plan = coverPlan[i] ?? "enkel";
    const pr = matchProbabilities(m);
    let outcomes: Outcome[];
    let reason = m.pickReason;
    const undecided = i === undecidedIdx;
    let undecidedNote: string | undefined;
    if (plan === "hel") {
      outcomes = ["1", "X", "2"];
      undecidedNote =
        "Kan inte avgöras – för jämnt/osäkert. Helgarderas (1/X/2).";
      reason = `${undecidedNote} ${m.pickReason}`;
    } else if (plan === "halv") {
      outcomes = pr.bestHalf;
      if (undecided) {
        undecidedNote = `Kan inte avgöras säkert – svåraste matchen. Halv ${outcomes.join("")}.`;
        reason = `${undecidedNote} ${m.pickReason}`;
      } else {
        reason = `halv ${outcomes.join("")} (~${Math.round(pr.bestHalfP * 100)}%) – ${m.pickReason}`;
      }
    } else if (
      isOvertrustedHomeFavourite({
        league: m.league,
        homeOdds: m.odds.one,
        awayOdds: m.odds.two,
        folkHomePct: m.svenskaFolket.one,
      })
    ) {
      // Aldrig enkel 1 i HockeyEttan-typ när hemma är övertröstat – tvinga 12
      outcomes = pr.bestHalf.includes("2") ? pr.bestHalf : (["1", "2"] as Outcome[]);
      reason = `halv ${outcomes.join("")} (övertröstat hemma i ${m.league}) – ${m.pickReason}`;
    } else {
      outcomes = [pr.bestSingle];
      reason = `enkel ${pr.bestSingle} (~${Math.round(pr.bestSingleP * 100)}%) – ${m.pickReason}`;
    }
    return {
      eventNumber: m.eventNumber,
      description: m.description,
      outcomes,
      cover: coverLabel(outcomes),
      reason,
      undecided,
      undecidedNote,
    };
  });
}

function riskFromHitPct(hitPct: number, cost: number): GeneratedSystem["risk"] {
  if (hitPct >= 75) return "lågt";
  if (hitPct >= 55 || cost >= 288) return "medel";
  return "högt";
}

function systemName(cost: number, hitPct: number, index: number): string {
  if (cost === 48) {
    return hitPct >= 70
      ? `Säkerhet ${cost} kr`
      : `Skarp säkerhet ${cost} kr`;
  }
  const labels = ["Skarp", "Balanserad", "Bred", "Maximal"];
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
        cover: "enkel",
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
      estimatedHitPct: null,
    });
  }
  return systems;
}

/** Dagligt system (Powerplay + Topptipset) som alltid sparas i resultat 4 h. */
export const DAILY_SYSTEM_COST_KR = 192;
/** @deprecated Använd DAILY_SYSTEM_COST_KR */
export const POWERPLAY_DAILY_COST_KR = DAILY_SYSTEM_COST_KR;

/** Stryktipset R 4-4-144: 4 hel · 4 halv · 5 spik, 144 rader, garanti 12. */
export const STRYK_R44_COST_KR = 144;
export const STRYK_R44_LABEL = "R 4-4-144";
const STRYK_R44_HEL = 4;
const STRYK_R44_HALV = 4;
const STRYK_R44_GUARANTEE = 12;
/** Full M-ram för samma garderingar (3^4 × 2^4). */
const STRYK_R44_FULL_ROWS = 1296;

/**
 * Bygg Svenska Spels R 4-4-144 för Stryktipset (13 matcher).
 * Kupongen visar ramen (4 hel / 4 halv / 5 spik); raderna är reducerade till 144.
 */
export function buildRSystem44144(
  matches: MatchAnalysis[]
): GeneratedSystem | null {
  if (matches.length !== 13) return null;

  const probs = matches.map(matchProbabilities);
  const order = probs
    .map((pr, i) => ({
      i,
      need: pr.hedgeNeed,
      halfP: pr.bestHalfP,
      singleP: pr.bestSingleP,
    }))
    .sort(
      (a, b) =>
        b.need - a.need || a.halfP - b.halfP || a.singleP - b.singleP
    );

  const plan: CoverPlan[] = Array(matches.length).fill("enkel");
  const helOrder = [...order].sort(
    (a, b) => a.halfP - b.halfP || b.need - a.need
  );
  for (let h = 0; h < STRYK_R44_HEL; h++) {
    plan[helOrder[h].i] = "hel";
  }
  let halvLeft = STRYK_R44_HALV;
  for (const o of order) {
    if (halvLeft <= 0) break;
    if (plan[o.i] === "hel") continue;
    plan[o.i] = "halv";
    halvLeft--;
  }

  // Säkerställ exakt 4/4 om sorteringen lämnade luckor
  for (let i = 0; i < matches.length && halvLeft > 0; i++) {
    if (plan[i] === "enkel") {
      plan[i] = "halv";
      halvLeft--;
    }
  }

  const picks = makePicks(matches, plan);
  const hel = picks.filter((p) => p.cover === "hel").length;
  const halv = picks.filter((p) => p.cover === "halv").length;
  const enklar = picks.filter((p) => p.cover === "enkel").length;
  if (hel !== STRYK_R44_HEL || halv !== STRYK_R44_HALV) return null;

  // Ramen måste sitta; 13 rätt ≈ 144/1296 om tecknen går in
  const frameHit = estimateSystemHitPct(matches, plan);
  const p13IfFrame =
    Math.round((STRYK_R44_COST_KR / STRYK_R44_FULL_ROWS) * 1000) / 10;
  const winPct =
    Math.round(frameHit * (STRYK_R44_COST_KR / STRYK_R44_FULL_ROWS) * 10) / 10;

  const undecidedPicks = picks.filter((p) => p.undecided);
  const undecidedEventNumbers = undecidedPicks.map((p) => p.eventNumber);
  const undecidedLabel = undecidedPicks.length
    ? `Kan inte avgöras: match ${undecidedPicks
        .map((p) => `${p.eventNumber} (${p.description})`)
        .join(", ")} – helgarderas.`
    : "";

  return {
    name: `${STRYK_R44_LABEL} · ${STRYK_R44_COST_KR} kr`,
    costKr: STRYK_R44_COST_KR,
    rows: STRYK_R44_COST_KR,
    picks,
    summary: `Reducerat R-system ${STRYK_R44_LABEL}: ${hel} hel · ${halv} halv · ${enklar} spik (${STRYK_R44_COST_KR} rader). Garanti ${STRYK_R44_GUARANTEE} rätt om alla tecken sitter (som M: ${STRYK_R44_FULL_ROWS.toLocaleString("sv-SE")} rader). Chans 13 rätt ≈ ${String(p13IfFrame).replace(".", ",")}% om ramen sitter. ${undecidedLabel}`.trim(),
    risk: riskFromHitPct(frameHit, STRYK_R44_COST_KR),
    kind: "r",
    rSystem: STRYK_R44_LABEL,
    guaranteeRights: STRYK_R44_GUARANTEE,
    estimatedHitPct: frameHit,
    estimatedWinPct: winPct,
    undecidedEventNumbers,
  };
}

function buildSystemForCost(
  matches: MatchAnalysis[],
  target: number,
  index: number
): GeneratedSystem | null {
  if (target < MIN_COST || target > MAX_COST) return null;
  const plan = planForCost(matches, target);
  if (!plan) return null;
  const picks = makePicks(matches, plan);
  const cost = rowCost(picks);
  if (cost < MIN_COST || cost > MAX_COST) return null;

  const hitPct = estimateSystemHitPct(matches, plan);
  const winPct = estimateWinPct(matches, plan);
  const halv = picks.filter((p) => p.cover === "halv").length;
  const hel = picks.filter((p) => p.cover === "hel").length;
  const enklar = picks.filter((p) => p.cover === "enkel");
  const minEnkel = enklar.length
    ? Math.min(
        ...enklar.map((p) => {
          const m = matches.find((x) => x.eventNumber === p.eventNumber);
          return m ? matchProbabilities(m).bestSingleP : 0.5;
        })
      )
    : 1;

  const fatigueMatches = matches.filter(
    (m) => m.homeFatigue.level !== "low" || m.awayFatigue.level !== "low"
  ).length;

  const undecidedPicks = picks.filter((p) => p.undecided);
  const undecidedEventNumbers = undecidedPicks.map((p) => p.eventNumber);
  const undecidedLabel = undecidedPicks.length
    ? `Kan inte avgöras: match ${undecidedPicks
        .map((p) => `${p.eventNumber} (${p.description})`)
        .join(", ")} – helgarderas.`
    : "";

  const safetyNote =
    cost === 48
      ? `Säkerhetsbygge mot hög vinstnivå: hel/halv där det skakar, enkel bara vid stark konsensus (svagaste enkel ~${Math.round(minEnkel * 100)}%).`
      : cost === DAILY_SYSTEM_COST_KR
        ? `Dagligt system ${DAILY_SYSTEM_COST_KR} kr (${hel} hel · ${halv} halv · ${enklar.length} enkel) – sparas i resultat 4 h.`
        : `${hel} hel · ${halv} halv · ${enklar.length} enkel.`;

  const winLabel =
    matches.length >= 7 && matches.length <= 9
      ? `Vinstnivå (≥${matches.length - 1} rätt) ~${String(winPct).replace(".", ",")}%`
      : `Uppskattad täckning ~${String(hitPct).replace(".", ",")}%`;

  return {
    name: systemName(cost, winPct, index),
    costKr: cost,
    rows: cost,
    picks,
    summary: `${safetyNote} ${undecidedLabel} ${winLabel}. Helträff ~${String(hitPct).replace(".", ",")}%. ${fatigueMatches} matcher med belastning vägdes in.`,
    risk: riskFromHitPct(winPct, cost),
    kind: "1x2",
    estimatedHitPct: hitPct,
    estimatedWinPct: winPct,
    undecidedEventNumbers,
  };
}

export type GenerateSystemsOptions = {
  /** Stryk/Europa: 6 systemspel inkl. R 4-4-144. */
  product?:
    | "powerplay"
    | "topptipset"
    | "stryktipset"
    | "europatipset"
    | "maltipset"
    | string;
};

/**
 * Bygg system 48–720 kr. För 48 kr (Powerplay/Topptipset) maximeras
 * uppskattad träffsannolikhet via djupare p-modell och optimal gardering.
 * 192 kr tvingas alltid med (dagligt PP/Topp-resultat 4 h).
 * Stryk/Europa: 6 systemspel inkl. R 4-4-144 (ersätter matematiskt 144 kr).
 */
export function generateSystems(
  matches: MatchAnalysis[],
  opts: GenerateSystemsOptions = {}
): GeneratedSystem[] {
  if (matches.length === 0) return [];

  const isStryk =
    opts.product === "stryktipset" ||
    opts.product === "europatipset" ||
    matches.length === 13;
  // Stryk/Europa: 5 M-system + R 4-4-144 = 6 spel
  const maxMathSystems = isStryk ? 5 : 5;

  // 48 först – säkerhetsfokus för PP/Topp; 192 alltid (dagligt resultat)
  // Stryk/Europa: hoppa M-144 (ersätts av R 4-4-144)
  const preferred = isStryk
    ? [48, 96, 72, 192, 288, 432]
    : [48, 96, 72, 144, 192, 288, 432, 576];
  if (matches.length >= 13 && !isStryk) {
    preferred.push(64, 108, 162, 216, 324, 486, 729);
  }
  const systems: GeneratedSystem[] = [];
  const used = new Set<number>();

  for (const target of preferred) {
    if (used.has(target)) continue;
    const built = buildSystemForCost(matches, target, systems.length);
    if (!built) continue;
    used.add(built.costKr);
    systems.push(built);
    if (systems.length >= maxMathSystems && used.has(DAILY_SYSTEM_COST_KR)) {
      break;
    }
  }

  // Tvinga in 192 kr om det saknas
  if (!systems.some((s) => s.costKr === DAILY_SYSTEM_COST_KR)) {
    const forced = buildSystemForCost(
      matches,
      DAILY_SYSTEM_COST_KR,
      systems.length
    );
    if (forced && forced.costKr === DAILY_SYSTEM_COST_KR) {
      systems.push(forced);
    }
  }

  // Stryk/Europa: R 4-4-144 som sjätte systemspel
  if (isStryk) {
    const r44 = buildRSystem44144(matches);
    if (r44) {
      // Inga matematiska 144 kr – R-systemet äger den kostnaden
      for (let i = systems.length - 1; i >= 0; i--) {
        if (systems[i].costKr === STRYK_R44_COST_KR && systems[i].kind !== "r") {
          systems.splice(i, 1);
        }
      }
      while (systems.length > 5) systems.pop();
      if (!systems.some((s) => s.rSystem === STRYK_R44_LABEL)) {
        systems.push(r44);
      }
    }
  }

  if (systems.length === 0) {
    for (const target of TARGET_COSTS) {
      const built = buildSystemForCost(matches, target, 0);
      if (!built) continue;
      systems.push(built);
      break;
    }
  }

  return systems.sort((a, b) => {
    // 48 kr säkerhet först, sedan 192 (dagligt), R 4-4, sedan kostnad
    if (a.costKr === 48 && b.costKr !== 48) return -1;
    if (b.costKr === 48 && a.costKr !== 48) return 1;
    if (a.costKr === DAILY_SYSTEM_COST_KR && b.costKr !== DAILY_SYSTEM_COST_KR)
      return -1;
    if (b.costKr === DAILY_SYSTEM_COST_KR && a.costKr !== DAILY_SYSTEM_COST_KR)
      return 1;
    if (a.kind === "r" && b.kind !== "r") return -1;
    if (b.kind === "r" && a.kind !== "r") return 1;
    return a.costKr - b.costKr;
  });
}

export function formatCouponLine(pick: SystemPick): string {
  const marks = (["1", "X", "2"] as Outcome[])
    .map((o) => (pick.outcomes.includes(o) ? o : "·"))
    .join(" ");
  return `${String(pick.eventNumber).padStart(2, " ")}. ${pick.description.padEnd(22, " ")}  ${marks}`;
}
