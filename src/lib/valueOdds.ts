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
 *
 * Fältmönster: 1X2 typ 4,30 / 5,10 / 2,36 – mittfält-underdog (~3,2–5,5)
 * mot kort favorit (≤2,6) vinner oftare än folk tror. Då ska 4,30-sidan
 * administreras som rätt kandidat (inte bara favoriten @ 2,36).
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
  /** Mittfält-underdog som ofta slår kort favorit (t.ex. 4,30 vs 2,36) */
  midUnderdogMin: 3.2,
  midUnderdogMax: 5.5,
  shortFavMax: 2.6,
} as const;

/** Oddsband där underdog ofta blir vinnare mot kort favorit (ej 8+ longshot). */
export function isMidUnderdogOdds(o: number | null | undefined): boolean {
  if (o == null || !Number.isFinite(o)) return false;
  return (
    o >= VALUE_ODDS_INSIGHTS.midUnderdogMin &&
    o <= VALUE_ODDS_INSIGHTS.midUnderdogMax
  );
}

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

/** Administrativ 1X2-bedömning utifrån överodds + sharp/folk. */
export type OverOddsAdmin = {
  /** Vilken utgång som bedöms rätt att tippa */
  recommended: Outcome | null;
  /** Utgångar som undviks (fällor m.m.) */
  avoid: Outcome[];
  confidence: "high" | "medium" | "low";
  /** Kort verdict t.ex. "1 bedöms rätt …" */
  verdict: string;
  /**
   * Säker vinnare: endast utgång 2 med odds runt 2,00
   * (krav: oddset måste vara 2).
   */
  safeWinner: {
    outcome: "2";
    odds: number;
    note: string;
  } | null;
};

/** Oddsband för "säker vinnare" – oddset ska vara ca 2. */
export const SAFE_WINNER_2_ODDS = {
  min: 1.85,
  max: 2.25,
  target: 2.0,
} as const;

export function isSafeWinnerTwoOdds(o: number | null | undefined): boolean {
  if (o == null || !Number.isFinite(o)) return false;
  return o >= SAFE_WINNER_2_ODDS.min && o <= SAFE_WINNER_2_ODDS.max;
}

export type ValueOddsAnalysis = {
  outcomes: OutcomeValue[];
  bestValue: Outcome | null;
  overOddsOutcomes: Outcome[];
  trapOverOddsOutcomes: Outcome[];
  /** En rad per överodds/fälla: vilket 1X2 + odds + varför */
  explanations: string[];
  admin: OverOddsAdmin;
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
      // Extra vikt: mittfält-underdog (t.ex. 4,30) mot kort favorit – ofta vinnare
      if (o != null && isMidUnderdogOdds(o) && outcome !== "X") {
        scoreBoost += trusted ? 0.04 : 0.02;
        bits.push(
          `mittfält-underdog ${outcome} @ ${fmtDec(o)} (band 3,2–5,5) – mönster där 4,xx ofta slår favorit ~2,x`
        );
      }
      if (trusted && softEdge != null) {
        bits.push(
          `överodds på ${outcome} @ ${fmtDec(o)} (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk, nära sharp)`
        );
      } else if (softEdge == null) {
        bits.push(
          `överodds på ${outcome} @ ${fmtDec(o)} (+${edgePct?.toFixed?.(0) ?? "?"} % vs folk) – sharp saknas, försiktig vikt`
        );
        scoreBoost = Math.min(scoreBoost, 0.045);
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
    // Mittfält-underdog även utan överodds-flagga (4,30 vs 2,36-mönster)
    if (
      !isOverOdds &&
      !isTrap &&
      !isTrashLongshot &&
      outcome !== "X" &&
      o != null &&
      isMidUnderdogOdds(o) &&
      oddsFavourite != null &&
      outcome !== oddsFavourite
    ) {
      const favO =
        oddsFavourite === "1"
          ? odds.one
          : oddsFavourite === "X"
            ? odds.x
            : odds.two;
      if (favO != null && favO <= VALUE_ODDS_INSIGHTS.shortFavMax) {
        scoreBoost += 0.035;
        bits.push(
          `mittfält-underdog ${outcome} @ ${fmtDec(o)} mot favorit @ ${fmtDec(favO)} – 4,xx-mönster`
        );
        if (!explain) {
          explain = `Mittfält-underdog på ${outcome} = ${outcomeSideLabel(outcome)} @ ${fmtDec(o)} mot favorit @ ${fmtDec(favO)}. Samma typ som 4,30 / 5,10 / 2,36 där 4,30 blivit vinnare – väg in ${outcome} i tipset.`;
        }
      }
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

  const admin = administer1x2({
    outcomes,
    overOddsOutcomes,
    trapOverOddsOutcomes,
    oddsFavourite,
    folkFavourite,
    folkOddsDisagree,
    antiFolkLean,
    multiBook: multiBook ?? null,
  });

  // Extra scoreBoost utifrån administrativ bedömning
  if (admin.recommended) {
    for (const ov of outcomes) {
      if (ov.outcome === admin.recommended) {
        const bump =
          admin.confidence === "high"
            ? 0.07
            : admin.confidence === "medium"
              ? 0.045
              : 0.02;
        ov.scoreBoost += bump;
      }
      if (admin.avoid.includes(ov.outcome)) {
        ov.scoreBoost -= 0.06;
      }
    }
  }

  const insights: string[] = [];
  if (admin.verdict) insights.push(admin.verdict);
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
    admin,
    folkOddsDisagree,
    folkFavourite,
    oddsFavourite,
    antiFolkLean,
    booksChecked,
    note: insights.join(" "),
    insights,
  };
}

function sharpFavouriteFromOdds(odds: Odds | null | undefined): Outcome | null {
  if (!odds) return null;
  return favouriteFromOdds(odds);
}

function attachSafeWinner(
  base: Omit<OverOddsAdmin, "safeWinner">,
  args: {
    outcomes: OutcomeValue[];
    oddsFavourite: Outcome | null;
    folkFavourite: Outcome | null;
    multiBook: MultiBookMatchOdds | null;
  }
): OverOddsAdmin {
  const two = args.outcomes.find((o) => o.outcome === "2");
  const odds2 = two?.odds ?? null;
  const sharpFav = sharpFavouriteFromOdds(args.multiBook?.sharp ?? null);
  const soft2 = softEdgeForOutcome(args.multiBook, "2");

  // Krav: säker vinnare = utgång 2 OCH odds runt 2,00
  if (
    odds2 != null &&
    isSafeWinnerTwoOdds(odds2) &&
    !base.avoid.includes("2") &&
    !two?.isTrap &&
    !two?.isTrashLongshot &&
    (sharpFav === "2" || args.oddsFavourite === "2") &&
    (soft2 == null || soft2 <= VALUE_ODDS_INSIGHTS.trapSoftEdgePct) &&
    (two?.folkPct ?? 0) >= 35
  ) {
    const note = `Säker vinnare: 2 (bortavinst) @ ${fmtDec(odds2)} – oddset är ca 2, sharp/odds favorit 2, folk ${Math.round(two?.folkPct ?? 0)} %.`;
    return {
      recommended: "2",
      avoid: base.avoid,
      confidence: "high",
      verdict: `Bedömning: 2 är säker vinnare @ ${fmtDec(odds2)}. ${base.verdict}`,
      safeWinner: { outcome: "2", odds: odds2, note },
    };
  }

  return { ...base, safeWinner: null };
}

/**
 * Avgör om 1, X eller 2 bedöms rätt utifrån överodds + sharp/folk.
 */
export function administer1x2(args: {
  outcomes: OutcomeValue[];
  overOddsOutcomes: Outcome[];
  trapOverOddsOutcomes: Outcome[];
  oddsFavourite: Outcome | null;
  folkFavourite: Outcome | null;
  folkOddsDisagree: boolean;
  antiFolkLean: Outcome | null;
  multiBook: MultiBookMatchOdds | null;
}): OverOddsAdmin {
  const raw = administer1x2Core(args);
  return attachSafeWinner(raw, args);
}

function administer1x2Core(args: {
  outcomes: OutcomeValue[];
  overOddsOutcomes: Outcome[];
  trapOverOddsOutcomes: Outcome[];
  oddsFavourite: Outcome | null;
  folkFavourite: Outcome | null;
  folkOddsDisagree: boolean;
  antiFolkLean: Outcome | null;
  multiBook: MultiBookMatchOdds | null;
}): Omit<OverOddsAdmin, "safeWinner"> {
  const {
    overOddsOutcomes,
    trapOverOddsOutcomes,
    oddsFavourite,
    folkFavourite,
    folkOddsDisagree,
    antiFolkLean,
    multiBook,
  } = args;

  const avoid = [...trapOverOddsOutcomes];
  const sharpFav = sharpFavouriteFromOdds(multiBook?.sharp ?? null);

  const favOv =
    oddsFavourite != null
      ? args.outcomes.find((x) => x.outcome === oddsFavourite)
      : null;
  const favOdds = favOv?.odds ?? null;

  // 0) Mittfält-underdog FÖRST (t.ex. 4,30 / 5,10 / 2,36 → 4,30 vann)
  //    Kort favorit ≤2,6 + 1/2 i band 3,2–5,5 som inte är fälla.
  //    Gäller även utan klassisk överodds-flagga – mönstret i sig är signalen.
  if (favOdds != null && favOdds <= VALUE_ODDS_INSIGHTS.shortFavMax) {
    const midDogs = args.outcomes.filter(
      (ov) =>
        !avoid.includes(ov.outcome) &&
        ov.outcome !== "X" &&
        ov.outcome !== oddsFavourite &&
        isMidUnderdogOdds(ov.odds) &&
        !ov.isTrashLongshot &&
        !ov.isTrap &&
        (ov.isOverOdds ||
          ov.isValue ||
          (ov.folkPct >= 15 &&
            (ov.softEdgePct == null ||
              ov.softEdgePct <= VALUE_ODDS_INSIGHTS.trapSoftEdgePct)))
    );
    if (midDogs.length) {
      const dog = [...midDogs].sort((a, b) => {
        const aOver = a.isOverOdds ? 1 : 0;
        const bOver = b.isOverOdds ? 1 : 0;
        if (bOver !== aOver) return bOver - aOver;
        return (b.scoreBoost || 0) - (a.scoreBoost || 0);
      })[0];
      const nearSharp =
        dog.softEdgePct == null ||
        dog.softEdgePct <= VALUE_ODDS_INSIGHTS.trapSoftEdgePct;
      if (nearSharp) {
        return {
          recommended: dog.outcome,
          avoid,
          confidence:
            dog.isOverOdds &&
            dog.softEdgePct != null &&
            dog.softEdgePct <= VALUE_ODDS_INSIGHTS.trustedSoftEdgePct
              ? "high"
              : "medium",
          verdict: `Bedömning: ${dog.outcome} är rätt (${outcomeSideLabel(dog.outcome)} @ ${fmtDec(dog.odds)}) – mittfält-underdog mot favorit @ ${fmtDec(favOdds)}; mönster som 4,30 vs 2,36 där 4,xx ofta vinner. Gardera gärna favoriten.`,
        };
      }
    }
  }

  // 1) Trusted överodds som sammanfaller med sharp-favorit → starkt "rätt"
  const trustedAligned = overOddsOutcomes.find(
    (o) => sharpFav != null && o === sharpFav && !avoid.includes(o)
  );
  if (trustedAligned) {
    const ov = args.outcomes.find((x) => x.outcome === trustedAligned);
    return {
      recommended: trustedAligned,
      avoid,
      confidence: "high",
      verdict: `Bedömning: ${trustedAligned} är rätt (${outcomeSideLabel(trustedAligned)}${ov?.odds != null ? ` @ ${fmtDec(ov.odds)}` : ""}) – överodds stöds av sharp, inte fälla.`,
    };
  }

  // 2) Trusted överodds på oddsfavoriten (chalk) utan sharp-motstrid
  const chalkOver = overOddsOutcomes.find(
    (o) => oddsFavourite != null && o === oddsFavourite && !avoid.includes(o)
  );
  if (chalkOver) {
    const ov = args.outcomes.find((x) => x.outcome === chalkOver);
    const sharpOk =
      sharpFav == null ||
      sharpFav === chalkOver ||
      (ov?.softEdgePct != null &&
        ov.softEdgePct <= VALUE_ODDS_INSIGHTS.trustedSoftEdgePct);
    if (sharpOk) {
      return {
        recommended: chalkOver,
        avoid,
        confidence: sharpFav === chalkOver ? "high" : "medium",
        verdict: `Bedömning: ${chalkOver} är rätt (${outcomeSideLabel(chalkOver)}${ov?.odds != null ? ` @ ${fmtDec(ov.odds)}` : ""}) – överodds på favoriten mot folk, sharp motsäger inte.`,
      };
    }
  }

  // 4) Fälla finns → tippa sharp/oddsfavorit, undvik fällan
  if (avoid.length && (sharpFav || oddsFavourite)) {
    const rec =
      sharpFav && !avoid.includes(sharpFav)
        ? sharpFav
        : oddsFavourite && !avoid.includes(oddsFavourite)
          ? oddsFavourite
          : (["1", "X", "2"] as Outcome[]).find((o) => !avoid.includes(o)) ??
            null;
    if (rec) {
      return {
        recommended: rec,
        avoid,
        confidence: sharpFav === rec ? "high" : "medium",
        verdict: `Bedömning: ${rec} är rätt (${outcomeSideLabel(rec)}) – undvik överodds-fälla ${avoid.join("/")}, lutar mot ${sharpFav ? "sharp" : "oddsfavorit"}.`,
      };
    }
  }

  // 5) Folk ≠ odds: historiskt oftare oddsfavorit rätt (om ej fälla)
  //    Men om mittfält-underdog finns utanför overOdds-listan, nämns den inte här.
  if (
    folkOddsDisagree &&
    antiFolkLean &&
    !avoid.includes(antiFolkLean) &&
    (sharpFav == null || sharpFav === antiFolkLean)
  ) {
    return {
      recommended: antiFolkLean,
      avoid,
      confidence: sharpFav === antiFolkLean ? "high" : "medium",
      verdict: `Bedömning: ${antiFolkLean} är rätt (${outcomeSideLabel(antiFolkLean)}) – oddsfavorit mot folk${sharpFav === antiFolkLean ? ", bekräftad av sharp" : ""}.`,
    };
  }

  // 6) Sharp ensam peikar tydligt – men hoppa inte över mittfält-underdog utan överodds-flagga
  if (sharpFav && !avoid.includes(sharpFav)) {
    const soft = softEdgeForOutcome(multiBook, sharpFav);
    const upsetCandidate = args.outcomes.find(
      (ov) =>
        ov.outcome !== sharpFav &&
        ov.outcome !== "X" &&
        isMidUnderdogOdds(ov.odds) &&
        !ov.isTrap &&
        !ov.isTrashLongshot &&
        (ov.isOverOdds || ov.isValue)
    );
    if (upsetCandidate && (soft == null || soft <= 5)) {
      return {
        recommended: upsetCandidate.outcome,
        avoid,
        confidence: "medium",
        verdict: `Bedömning: ${upsetCandidate.outcome} är rätt kandidat (${outcomeSideLabel(upsetCandidate.outcome)} @ ${fmtDec(upsetCandidate.odds)}) mot sharp-favorit ${sharpFav} – mittfält-underdog (4,xx-mönster). Tippa/gardera ${upsetCandidate.outcome}.`,
      };
    }
    if (soft == null || soft <= 5) {
      return {
        recommended: sharpFav,
        avoid,
        confidence: "medium",
        verdict: `Bedömning: ${sharpFav} är rätt (${outcomeSideLabel(sharpFav)}) – sharp-favorit efter bokgranskning.`,
      };
    }
  }

  // 7) Trusted överodds (underdog) – ta underdog på allvar i mittfältet
  if (overOddsOutcomes.length >= 1) {
    const o = overOddsOutcomes.find((x) => !avoid.includes(x));
    if (o) {
      const ov = args.outcomes.find((x) => x.outcome === o);
      if (ov && isMidUnderdogOdds(ov.odds) && ov.outcome !== "X") {
        return {
          recommended: o,
          avoid,
          confidence: "medium",
          verdict: `Bedömning: ${o} är rätt (${outcomeSideLabel(o)} @ ${fmtDec(ov.odds)}) – överodds i mittfältet; favoriten @ ${fmtDec(favOdds)} ska inte ensam styra tipset.`,
        };
      }
      return {
        recommended: o,
        avoid,
        confidence: "low",
        verdict: `Bedömning: lutar ${o} (${outcomeSideLabel(o)}${ov?.odds != null ? ` @ ${fmtDec(ov.odds)}` : ""}) via överodds – väg in i tipset.`,
      };
    }
  }

  if (oddsFavourite && !avoid.includes(oddsFavourite)) {
    return {
      recommended: oddsFavourite,
      avoid,
      confidence: "low",
      verdict: `Bedömning: ${oddsFavourite} är rätt (${outcomeSideLabel(oddsFavourite)}) – oddsfavorit, ingen tydlig överodds-signal emot.`,
    };
  }

  return {
    recommended: null,
    avoid,
    confidence: "low",
    verdict: "Bedömning: oklart 1X2 – ingen tydlig överodds-/sharp-signal.",
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
