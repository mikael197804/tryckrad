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
  band: string | null;
  edgePct: number | null;
  scoreBoost: number;
  note: string;
};

export type ValueOddsAnalysis = {
  outcomes: OutcomeValue[];
  bestValue: Outcome | null;
  overOddsOutcomes: Outcome[];
  folkOddsDisagree: boolean;
  folkFavourite: Outcome | null;
  oddsFavourite: Outcome | null;
  antiFolkLean: Outcome | null;
  note: string;
  insights: string[];
};

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
}): ValueOddsAnalysis {
  const { odds, dist, sport = "football" } = args;
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

    let scoreBoost = 0;
    const bits: string[] = [];

    if (isOverOdds) {
      // Empiriskt +EV
      const strength = Math.min(0.08, 0.035 + Math.max(0, (edgePct ?? 0) - 12) * 0.002);
      scoreBoost += strength;
      bits.push(
        `överodds (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk) – historiskt +EV`
      );
    }
    if (isValue && !isOverOdds) {
      scoreBoost += 0.03;
      bits.push("folket högre än oddsen – värde");
    }
    if (isTrashLongshot) {
      scoreBoost -= 0.06;
      bits.push("extremt högt odds (8+) – sällan värt");
    } else if (o != null && o > 5.5 && o < 8) {
      // Fotboll 5–8 hade bättre EV än hockey i stickprov
      scoreBoost += sport === "football" ? 0.01 : -0.025;
      if (sport === "hockey") bits.push("högt underdog-odds i hockey – försiktig");
    }

    // X i "sött" oddsintervall
    if (outcome === "X" && o != null && o >= 3.0 && o <= 4.8) {
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
      band: o != null ? bandOf(o) : null,
      edgePct,
      scoreBoost,
      note: bits.join(". "),
    };
  });

  // När folk och odds favorit skiljer: lätta upp folkfavoriten
  if (folkOddsDisagree && folkFavourite && oddsFavourite) {
    for (const ov of outcomes) {
      if (ov.outcome === folkFavourite) {
        ov.scoreBoost -= 0.035;
        ov.note = [ov.note, "folk ≠ oddsfavorit – tona ner folkfavorit"]
          .filter(Boolean)
          .join(". ");
      } else if (ov.outcome === oddsFavourite) {
        ov.scoreBoost += 0.025;
        ov.note = [ov.note, "oddsfavorit mot folk – historiskt oftare rätt"]
          .filter(Boolean)
          .join(". ");
      }
    }
  }

  const overOddsOutcomes = outcomes
    .filter((o) => o.isOverOdds && !o.isTrashLongshot)
    .map((o) => o.outcome);

  const rankedValue = [...outcomes]
    .filter((o) => (o.isOverOdds || o.isValue) && !o.isTrashLongshot)
    .sort((a, b) => b.scoreBoost - a.scoreBoost);
  const bestValue = rankedValue[0]?.outcome ?? null;

  const antiFolkLean =
    folkOddsDisagree && oddsFavourite && folkFavourite
      ? oddsFavourite
      : null;

  const insights: string[] = [];
  if (overOddsOutcomes.length) {
    insights.push(
      `Överodds på ${overOddsOutcomes.join("/")}: historiskt ca ${Math.round(
        VALUE_ODDS_INSIGHTS.overOddsHitRate * 100
      )}% träff och +EV mot folk`
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
  if (!insights.length) {
    insights.push(
      "Inga tydliga överodds just nu – lutar mot oddsfavorit/folkbalans"
    );
  }

  return {
    outcomes,
    bestValue,
    overOddsOutcomes,
    folkOddsDisagree,
    folkFavourite,
    oddsFavourite,
    antiFolkLean,
    note: insights.join(". "),
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
  // Modell tror mer än oddsen → värde på Över
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
