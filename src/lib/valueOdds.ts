import type { MultiBookMatchOdds } from "./multiBookOdds";
import {
  sharpOddsForOutcome,
  softEdgeForOutcome,
} from "./multiBookOdds";
import type { Distribution, Odds, Outcome } from "./types";

/**
 * Empirisk kalibrering från finaliserade Stryk/Europa/Powerplay-omgångar
 * (startodds + svenska folket vs faktiskt 1X2-resultat).
 *
 * Huvudfynd:
 * - "Överodds" vs folk (odds ≥12% över fair från folkandel, folk ≥12%)
 *   hade positiv EV (~+5–13%) och ~48–57% träff.
 * - Folk-andel tydligt högre än oddsimplicit + odds ≥2,2: också +EV.
 * - Extremt höga odds (8+) nästan aldrig värda; 5–8 blandat (bättre i fotboll).
 * - När folkfavorit ≠ oddsfavorit: "anti-folk" träffade oftare (~54–69%).
 *
 * Multi-book (2026): många "överodds" är fällor – SVS/Unibet/Paf/ATG (Kambi)
 * ligger mjukare än sharp (Pinnacle). Då förlorar vanliga spelare pengar.
 */
export const VALUE_ODDS_INSIGHTS = {
  sampleNote:
    "Baserat på slutspelade Stryktipset-, Europatipset- och Powerplay-omgångar",
  overOddsHitRate: 0.52,
  overOddsUnits: 0.09,
  valueHitRate: 0.44,
  valueUnits: 0.18,
  longshot8HitEv: 0.35,
  antiFolkWhenDisagree: 0.6,
  xMidHitRate: 0.25,
  /** SVS ≥8% högre än Pinnacle → behandla som soft-trap */
  trapSoftEdgePct: 8,
  /** SVS inom 3% av sharp → överodds mer trovärdig */
  trustedSoftEdgePct: 3,
} as const;

export type OutcomeValue = {
  outcome: Outcome;
  odds: number | null;
  folkPct: number;
  impliedPct: number | null;
  fairFromFolk: number | null;
  isOverOdds: boolean;
  isValue: boolean;
  isTrashLongshot: boolean;
  isTrap: boolean;
  band: string | null;
  edgePct: number | null;
  softEdgePct: number | null;
  scoreBoost: number;
  note: string;
  /** Tydlig 1X2-förklaring för UI/analys */
  explain: string | null;
};

export type ValueOddsAnalysis = {
  outcomes: OutcomeValue[];
  bestValue: Outcome | null;
  overOddsOutcomes: Outcome[];
  trapOverOddsOutcomes: Outcome[];
  /** En rad per överodds/fälla: vilket 1X2 + odds + varför */
  explanations: string[];
  folkOddsDisagree: boolean;
  folkFavourite: Outcome | null;
  oddsFavourite: Outcome | null;
  antiFolkLean: Outcome | null;
  booksChecked: string[];
  note: string;
  insights: string[];
};

function fmtDec(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return n.toFixed(2).replace(".", ",");
}

/** 1 = hemmavinst, X = kryss, 2 = bortavinst */
export function outcomeSideLabel(outcome: Outcome): string {
  if (outcome === "1") return "hemmavinst (1)";
  if (outcome === "X") return "kryss (X)";
  return "bortavinst (2)";
}

function buildOverOddsExplain(args: {
  outcome: Outcome;
  odds: number;
  folkPct: number;
  fairFromFolk: number | null;
  edgePct: number | null;
  softEdgePct: number | null;
  sharpOdds: number | null;
  isTrap: boolean;
}): string {
  const {
    outcome,
    odds,
    folkPct,
    fairFromFolk,
    edgePct,
    softEdgePct,
    sharpOdds,
    isTrap,
  } = args;
  const side = outcomeSideLabel(outcome);
  const head = isTrap
    ? `Överodds-fälla på ${outcome}`
    : `Överodds på ${outcome}`;
  const fairBit =
    fairFromFolk != null
      ? `folket tippar ${Math.round(folkPct)} % → fair ca ${fmtDec(fairFromFolk)}, oddsen ${fmtDec(odds)} är ${edgePct != null ? `+${Math.round(edgePct)} %` : "högre"} än fair`
      : `odds ${fmtDec(odds)} mot folk ${Math.round(folkPct)} %`;
  let sharpBit = "";
  if (sharpOdds != null && softEdgePct != null) {
    sharpBit =
      softEdgePct >= 8
        ? ` Sharp (Pinnacle) har ${fmtDec(sharpOdds)} – SVS är +${Math.round(softEdgePct)} % mjukare (fälla).`
        : softEdgePct <= 3
          ? ` Nära sharp ${fmtDec(sharpOdds)} – mer trovärdigt.`
          : ` Sharp ${fmtDec(sharpOdds)} (SVS ${softEdgePct > 0 ? "+" : ""}${Math.round(softEdgePct)} %).`;
  }
  const verdict = isTrap
    ? " Undvik – vanliga spelare förlorar ofta här."
    : " Kan vägas in i tipset.";
  return `${head} = ${side} @ ${fmtDec(odds)}. ${fairBit}.${sharpBit}${verdict}`;
}

function bandOf(o: number): string {
  if (o <= 1.5) return "1.01–1,50";
  if (o <= 2) return "1,51–2,00";
  if (o <= 3) return "2,01–3,00";
  if (o <= 5) return "3,01–5,00";
  if (o <= 8) return "5,01–8,00";
  return "8,01+";
}

function favouriteFromOdds(odds: Odds): Outcome | null {
  const entries: [Outcome, number][] = [];
  if (odds.one != null) entries.push(["1", odds.one]);
  if (odds.x != null) entries.push(["X", odds.x]);
  if (odds.two != null) entries.push(["2", odds.two]);
  if (!entries.length) return null;
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0][0];
}

function favouriteFromFolk(dist: Distribution): Outcome | null {
  const entries: [Outcome, number][] = [
    ["1", dist.one],
    ["X", dist.x],
    ["2", dist.two],
  ];
  if (entries.every((e) => e[1] <= 0)) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function analyzeValueOdds(args: {
  odds: Odds;
  dist: Distribution;
  sport?: "football" | "hockey";
  multiBook?: MultiBookMatchOdds | null;
}): ValueOddsAnalysis {
  const { odds, dist, sport = "football", multiBook = null } = args;
  const oddsFavourite = favouriteFromOdds(odds);
  const folkFavourite = favouriteFromFolk(dist);
  const folkOddsDisagree =
    oddsFavourite != null &&
    folkFavourite != null &&
    oddsFavourite !== folkFavourite;

  const pairs: Array<{ outcome: Outcome; o: number | null; folk: number }> = [
    { outcome: "1", o: odds.one, folk: dist.one },
    { outcome: "X", o: odds.x, folk: dist.x },
    { outcome: "2", o: odds.two, folk: dist.two },
  ];

  const outcomes: OutcomeValue[] = pairs.map(({ outcome, o, folk }) => {
    const impliedPct = o != null && o > 1 ? Math.round((100 / o) * 10) / 10 : null;
    const fairFromFolk = folk >= 8 ? Math.round((100 / folk) * 100) / 100 : null;
    const isOverOdds =
      o != null &&
      fairFromFolk != null &&
      folk >= 12 &&
      o >= fairFromFolk * 1.12;
    const isValue =
      o != null &&
      o >= 2.2 &&
      impliedPct != null &&
      folk >= 15 &&
      folk > impliedPct * 1.15;
    const isTrashLongshot = o != null && o >= 8;
    const edgePct =
      o != null && fairFromFolk != null
        ? Math.round(((o / fairFromFolk - 1) * 100) * 10) / 10
        : null;

    const softEdge = softEdgeForOutcome(multiBook, outcome);
    const sharpO = sharpOddsForOutcome(multiBook, outcome);

    // Trap: överodds vs folk men SVS tydligt mjukare/högre än sharp
    let isTrap = false;
    if (isOverOdds && !isTrashLongshot && softEdge != null) {
      if (softEdge >= VALUE_ODDS_INSIGHTS.trapSoftEdgePct) {
        isTrap = true;
      }
    }
    // Extra fälla: underdog-överodds (≥2,4) där folk redan ligger tungt på favoriten
    // och sharp inte stödjer samma uppsida – folk jagar "billiga" underdogs.
    if (
      !isTrap &&
      isOverOdds &&
      !isTrashLongshot &&
      o != null &&
      o >= 2.4 &&
      folkFavourite &&
      folkFavourite !== outcome &&
      (dist[folkFavourite === "1" ? "one" : folkFavourite === "X" ? "x" : "two"] ??
        0) >= 55 &&
      softEdge != null &&
      softEdge >= 5
    ) {
      isTrap = true;
    }

    let scoreBoost = 0;
    const bits: string[] = [];

    let explain: string | null = null;

    if (isOverOdds && o != null) {
      explain = buildOverOddsExplain({
        outcome,
        odds: o,
        folkPct: folk,
        fairFromFolk,
        edgePct,
        softEdgePct: softEdge,
        sharpOdds: sharpO,
        isTrap,
      });
    }

    if (isOverOdds && isTrap) {
      scoreBoost -= 0.055;
      bits.push(
        softEdge != null && sharpO != null
          ? `överodds-fälla på ${outcome} @ ${fmtDec(o)} (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk, SVS ${softEdge > 0 ? "+" : ""}${softEdge.toFixed(0)} % mjukare än sharp ${fmtDec(sharpO)}) – undvik`
          : `överodds-fälla på ${outcome} @ ${fmtDec(o)} (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk) – undvik`
      );
    } else if (isOverOdds) {
      const trusted =
        softEdge == null ||
        softEdge <= VALUE_ODDS_INSIGHTS.trustedSoftEdgePct;
      const strength = trusted
        ? Math.min(0.08, 0.035 + Math.max(0, (edgePct ?? 0) - 12) * 0.002)
        : Math.min(0.04, 0.015 + Math.max(0, (edgePct ?? 0) - 12) * 0.001);
      scoreBoost += strength;
      if (trusted && softEdge != null) {
        bits.push(
          `överodds på ${outcome} @ ${fmtDec(o)} (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk, nära sharp)`
        );
      } else if (softEdge == null) {
        bits.push(
          `överodds på ${outcome} @ ${fmtDec(o)} (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk) – sharp saknas, försiktig vikt`
        );
        scoreBoost = Math.min(scoreBoost, 0.025);
      } else {
        bits.push(
          `överodds på ${outcome} @ ${fmtDec(o)} (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk, +${softEdge.toFixed(0)} % vs sharp) – begränsad vikt`
        );
      }
    }
    if (isValue && !isOverOdds) {
      scoreBoost += 0.03;
      bits.push(`värde på ${outcome} @ ${fmtDec(o)} – folket högre än oddsen`);
    }
    if (isTrashLongshot) {
      scoreBoost -= 0.06;
      bits.push(`extremt högt odds på ${outcome} (${fmtDec(o)}, 8+) – sällan värt`);
    } else if (o != null && o > 5.5 && o < 8) {
      scoreBoost += sport === "football" ? 0.01 : -0.025;
      if (sport === "hockey")
        bits.push(`högt underdog-odds på ${outcome} @ ${fmtDec(o)} i hockey – försiktig`);
    }

    if (outcome === "X" && o != null && o >= 3.0 && o <= 4.8 && !isTrap) {
      scoreBoost += 0.015;
    }

    return {
      outcome,
      odds: o,
      folkPct: folk,
      impliedPct,
      fairFromFolk,
      isOverOdds,
      isValue,
      isTrashLongshot,
      isTrap,
      band: o != null ? bandOf(o) : null,
      edgePct,
      softEdgePct: softEdge,
      scoreBoost,
      note: bits.join(". "),
      explain,
    };
  });

  if (folkOddsDisagree && folkFavourite && oddsFavourite) {
    for (const ov of outcomes) {
      if (ov.outcome === folkFavourite) {
        ov.scoreBoost -= 0.035;
        ov.note = [ov.note, "folk ≠ oddsfavorit – tona ner folkfavorit"]
          .filter(Boolean)
          .join(". ");
      } else if (ov.outcome === oddsFavourite && !ov.isTrap) {
        ov.scoreBoost += 0.025;
        ov.note = [ov.note, "oddsfavorit mot folk – historiskt oftare rätt"]
          .filter(Boolean)
          .join(". ");
      }
    }
  }

  const trapOverOddsOutcomes = outcomes
    .filter((o) => o.isOverOdds && o.isTrap && !o.isTrashLongshot)
    .map((o) => o.outcome);

  const overOddsOutcomes = outcomes
    .filter((o) => o.isOverOdds && !o.isTrashLongshot && !o.isTrap)
    .map((o) => o.outcome);

  const rankedValue = [...outcomes]
    .filter(
      (o) => (o.isOverOdds || o.isValue) && !o.isTrashLongshot && !o.isTrap
    )
    .sort((a, b) => b.scoreBoost - a.scoreBoost);
  const bestValue = rankedValue[0]?.outcome ?? null;

  const antiFolkLean =
    folkOddsDisagree && oddsFavourite && folkFavourite
      ? oddsFavourite
      : null;

  const booksChecked = multiBook?.booksChecked ?? [];
  const explanations = outcomes
    .filter((o) => o.explain)
    .map((o) => o.explain as string);

  const insights: string[] = [];
  // Led med tydlig 1X2-förklaring (vilket odds som är över)
  for (const line of explanations) {
    insights.push(line);
  }
  if (overOddsOutcomes.length && !trapOverOddsOutcomes.length) {
    insights.push(
      `Granskad mot böcker${
        multiBook?.sharpLabel ? ` + ${multiBook.sharpLabel}` : ""
      } – historiskt ca ${Math.round(
        VALUE_ODDS_INSIGHTS.overOddsHitRate * 100
      )}% träff när oddsen inte är uppblåsta`
    );
  }
  if (folkOddsDisagree && folkFavourite && oddsFavourite) {
    insights.push(
      `Folk tippar ${folkFavourite}, oddsen ${oddsFavourite} – anti-folk har oftare stämt (~${Math.round(
        VALUE_ODDS_INSIGHTS.antiFolkWhenDisagree * 100
      )}%)`
    );
  }
  if (outcomes.some((o) => o.isTrashLongshot && o.outcome !== "X")) {
    insights.push("Extremodds 8+ undviks – mycket låg historisk EV");
  }
  if (multiBook?.note) {
    insights.push(multiBook.note);
  }
  if (!insights.length) {
    insights.push(
      "Inga tydliga överodds just nu – lutar mot oddsfavorit/folkbalans"
    );
  }

  return {
    outcomes,
    bestValue,
    overOddsOutcomes,
    trapOverOddsOutcomes,
    explanations,
    folkOddsDisagree,
    folkFavourite,
    oddsFavourite,
    antiFolkLean,
    booksChecked,
    note: insights.join(" "),
    insights,
  };
}

export function applyValueOddsToScores(
  scores: { score1: number; scoreX: number; score2: number },
  value: ValueOddsAnalysis
): { score1: number; scoreX: number; score2: number } {
  let { score1, scoreX, score2 } = scores;
  for (const ov of value.outcomes) {
    if (ov.outcome === "1") score1 += ov.scoreBoost;
    if (ov.outcome === "X") scoreX += ov.scoreBoost;
    if (ov.outcome === "2") score2 += ov.scoreBoost;
  }
  const sum = Math.max(score1 + scoreX + score2, 0.01);
  return {
    score1: Math.max(0.01, score1) / sum,
    scoreX: Math.max(0.01, scoreX) / sum,
    score2: Math.max(0.01, score2) / sum,
  };
}

/** Oddset/Mål: är Över-linjen "överodds" mot modellens sannolikhet? */
export function overMarketValue(args: {
  overOdds: number | null;
  modelProb: number | null;
}): { isValue: boolean; edgePct: number | null; note: string } {
  const { overOdds, modelProb } = args;
  if (overOdds == null || overOdds <= 1 || modelProb == null || modelProb <= 0) {
    return { isValue: false, edgePct: null, note: "" };
  }
  const implied = 1 / overOdds;
  const edgePct = Math.round((modelProb - implied) * 1000) / 10;
  const isValue = modelProb >= implied * 1.08 && modelProb >= 0.52;
  return {
    isValue,
    edgePct,
    note: isValue
      ? `Över ser billig ut mot modell (+${edgePct} %-enheter)`
      : edgePct < -5
        ? `Över ser dyr ut mot modell (${edgePct} %-enheter)`
        : "",
  };
}
