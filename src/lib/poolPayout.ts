import type {
  Distribution,
  MatchAnalysis,
  Odds,
  Outcome,
  SystemPick,
} from "./types";

/** Standardgolv (Stryk/Europa/Hockey 9 m.fl.). Ingen övre gräns. */
export const MIN_PAYOUT_KR = 3000;
/** Golv för Powerplay och Topptipset – gäller alla system. */
export const MIN_PAYOUT_PP_TOPP_KR = 2000;

/** Minsta utdelning per produkt (golv, ingen tak). */
export function minPayoutForProduct(product: string | null | undefined): number {
  const p = String(product || "").toLowerCase();
  if (p === "powerplay" || p === "topptipset") return MIN_PAYOUT_PP_TOPP_KR;
  return MIN_PAYOUT_KR;
}

/** Andel av omsättningen som går till max-rätt-potten (schablon). */
const TIER_SHARE: Record<string, number> = {
  powerplay: 0.42,
  topptipset: 0.42,
  stryktipset: 0.28,
  europatipset: 0.28,
  hockey9: 0.4,
  default: 0.35,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseNetSaleKr(netSale: string | number | null | undefined): number | null {
  if (netSale == null || netSale === "") return null;
  if (typeof netSale === "number") {
    return Number.isFinite(netSale) && netSale > 0 ? netSale : null;
  }
  const n = Number(String(netSale).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function outcomeOdds(odds: Odds, o: Outcome): number | null {
  const v = o === "1" ? odds.one : o === "X" ? odds.x : odds.two;
  return v != null && v > 1 && v < 80 ? v : null;
}

function outcomeFolk(dist: Distribution, o: Outcome): number {
  const v = o === "1" ? dist.one : o === "X" ? dist.x : dist.two;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Tipputgång för utdelningsestimat inom tipset.
 * mode "high" = högst odds (högsta utdelning), "low" = lägst odds.
 */
export function primaryOutcomeForPayout(
  pick: SystemPick,
  match: MatchAnalysis,
  mode: "high" | "low" = "high"
): Outcome {
  const outs = pick.outcomes.length ? pick.outcomes : (["1"] as Outcome[]);
  if (outs.length === 1) return outs[0]!;
  let best: Outcome = outs[0]!;
  let bestOdds = mode === "high" ? -1 : Number.POSITIVE_INFINITY;
  for (const o of outs) {
    const od = outcomeOdds(match.odds, o) ?? 1;
    if (mode === "high" ? od > bestOdds : od < bestOdds) {
      bestOdds = od;
      best = o;
    }
  }
  return best;
}

export type MaxPayoutEstimate = {
  /** Typisk beräknad utdelning vid fullträff (kr). */
  estimatedKr: number;
  /** Lägsta beräknade utdelning (favoriter i gardering). */
  lowKr: number;
  /** Högsta beräknade utdelning för tipset (sällsynta utgångar i gardering). */
  highKr: number;
  /** Oddsprodukt för högsta-scenariot. */
  oddsProduct: number;
  /** Folkandel för samma rad (0–1). */
  folkShare: number;
  /** Utdelning via odds×omsättning. */
  oddsBasedKr: number;
  /** Utdelning via folk×omsättning. */
  folkBasedKr: number;
  /** true om högsta ≥ produktens golv (ingen tak). */
  meetsMin: boolean;
  /** Golvet som användes (kr). */
  minKr: number;
  note: string;
};

function blendPayoutKr(oddsBasedKr: number, folkBasedKr: number): number {
  return Math.round(
    Math.sqrt(Math.max(1, oddsBasedKr) * Math.max(1, folkBasedKr))
  );
}

function payoutForPath(args: {
  product: string;
  matches: MatchAnalysis[];
  picks: SystemPick[];
  netSale: string | number | null | undefined;
  rowPrice: number;
  mode: "high" | "low";
}): {
  estimatedKr: number;
  oddsProduct: number;
  folkShare: number;
  oddsBasedKr: number;
  folkBasedKr: number;
  highSideKr: number;
} {
  const product = String(args.product || "default").toLowerCase();
  const share = TIER_SHARE[product] ?? TIER_SHARE.default;
  const rowPrice =
    args.rowPrice > 0 && Number.isFinite(args.rowPrice) ? args.rowPrice : 1;
  const netSale = parseNetSaleKr(args.netSale);
  const byEvent = new Map(args.matches.map((m) => [m.eventNumber, m]));
  let oddsProduct = 1;
  let folkShare = 1;
  let used = 0;

  for (const pick of args.picks) {
    const m = byEvent.get(pick.eventNumber);
    if (!m) continue;
    const primary = primaryOutcomeForPayout(pick, m, args.mode);
    const od = outcomeOdds(m.odds, primary);
    const folk = outcomeFolk(m.svenskaFolket, primary);
    if (od != null) {
      oddsProduct *= od;
      used++;
    }
    folkShare *= clamp(folk / 100, 0.01, 0.95);
  }

  if (used === 0) {
    return {
      estimatedKr: 0,
      oddsProduct: 1,
      folkShare: 1,
      oddsBasedKr: 0,
      folkBasedKr: 0,
      highSideKr: 0,
    };
  }

  const oddsBasedKr = share * rowPrice * oddsProduct;
  let folkBasedKr = oddsBasedKr;
  if (netSale != null && netSale > 0 && folkShare > 0) {
    const rowsSold = Math.max(1, netSale / rowPrice);
    const winningRows = Math.max(0.01, rowsSold * folkShare);
    folkBasedKr = (netSale * share) / winningRows;
  }

  const estimatedKr = blendPayoutKr(oddsBasedKr, folkBasedKr);
  const highSideKr = Math.round(Math.max(oddsBasedKr, folkBasedKr, estimatedKr));
  return {
    estimatedKr,
    oddsProduct: Math.round(oddsProduct * 100) / 100,
    folkShare: Math.round(folkShare * 1e6) / 1e6,
    oddsBasedKr: Math.round(oddsBasedKr),
    folkBasedKr: Math.round(folkBasedKr),
    highSideKr,
  };
}

/**
 * Beräkna utdelning vid max rätt så att odds och omsättning stämmer.
 *
 * folkBased ≈ (omsättning × potshare) / (sålda rader × folkandel)
 * oddsBased ≈ potshare × radpris × oddsprodukt
 * blended = geometriskt medel → “odds till omsättning stämmer”
 */
export function estimateMaxPayout(args: {
  product: string;
  matches: MatchAnalysis[];
  picks: SystemPick[];
  netSale: string | number | null | undefined;
  rowPrice: number;
}): MaxPayoutEstimate {
  const product = String(args.product || "default").toLowerCase();
  const minKr = minPayoutForProduct(product);
  const highPath = payoutForPath({ ...args, product, mode: "high" });
  const lowPath = payoutForPath({ ...args, product, mode: "low" });

  if (highPath.estimatedKr <= 0 && highPath.oddsBasedKr <= 0) {
    return {
      estimatedKr: 0,
      lowKr: 0,
      highKr: 0,
      oddsProduct: 1,
      folkShare: 1,
      oddsBasedKr: 0,
      folkBasedKr: 0,
      meetsMin: false,
      minKr,
      note: "Saknar odds för utdelningsestimat.",
    };
  }

  // Typisk = geometriskt medel av hög/låg-scenarier; spann = low–high
  const estimatedKr = blendPayoutKr(
    highPath.estimatedKr,
    Math.max(1, lowPath.estimatedKr)
  );
  const highKr = Math.max(
    highPath.highSideKr,
    highPath.estimatedKr,
    estimatedKr
  );
  const lowKr = Math.min(
    Math.max(1, lowPath.estimatedKr),
    highKr
  );
  const meetsMin = highKr >= minKr;
  const note = meetsMin
    ? `Golv ${minKr.toLocaleString("sv-SE")} kr · spann ~${lowKr.toLocaleString("sv-SE")}–${highKr.toLocaleString("sv-SE")} kr vid fullträff (odds×omsättning).`
    : `Spann ~${lowKr.toLocaleString("sv-SE")}–${highKr.toLocaleString("sv-SE")} kr – under golvet ${minKr.toLocaleString("sv-SE")} kr.`;

  return {
    estimatedKr,
    lowKr,
    highKr,
    oddsProduct: highPath.oddsProduct,
    folkShare: highPath.folkShare,
    oddsBasedKr: highPath.oddsBasedKr,
    folkBasedKr: highPath.folkBasedKr,
    meetsMin,
    minKr,
    note,
  };
}

/** Utdelningsspann för en egen tipprad (gardering → lägsta–högsta). */
export function estimatePayoutRange(args: {
  product: string;
  matches: MatchAnalysis[];
  picks: SystemPick[];
  netSale: string | number | null | undefined;
  rowPrice: number;
}): MaxPayoutEstimate {
  return estimateMaxPayout(args);
}

export function coverFromOutcomes(
  outcomes: Outcome[]
): "enkel" | "halv" | "hel" {
  const n = outcomes.length;
  if (n >= 3) return "hel";
  if (n === 2) return "halv";
  return "enkel";
}

export function systemRowCount(picks: SystemPick[]): number {
  return picks.reduce((acc, p) => acc * Math.max(1, p.outcomes.length), 1);
}

/**
 * Hockey 9: systemrad-estimat = insats × oddsprodukt.
 * 100 kr på niofalt kräver oddsprodukt ≥ 30 för ≥ 3000 kr.
 */
export function estimateHockey9Payout(args: {
  odds: number[];
  unitStakeKr?: number;
}): MaxPayoutEstimate {
  const stake = args.unitStakeKr ?? 100;
  const odds = args.odds.filter((o) => o > 1 && o < 80);
  let product = 1;
  for (const o of odds) product *= o;
  const minKr = MIN_PAYOUT_KR;
  const estimatedKr = Math.round(stake * product);
  const highKr = estimatedKr;
  const lowKr = estimatedKr;
  const meetsMin = highKr >= minKr && odds.length >= 9;
  return {
    estimatedKr,
    lowKr,
    highKr,
    oddsProduct: Math.round(product * 100) / 100,
    folkShare: 0,
    oddsBasedKr: estimatedKr,
    folkBasedKr: estimatedKr,
    meetsMin,
    minKr,
    note: meetsMin
      ? `Hockey 9 · golv ${minKr.toLocaleString("sv-SE")} kr · högsta ~${highKr.toLocaleString("sv-SE")} kr vid 9 rätt (oddsprodukt ${String(Math.round(product * 10) / 10).replace(".", ",")}).`
      : `Hockey 9 · högsta ~${highKr.toLocaleString("sv-SE")} kr – under golvet ${minKr.toLocaleString("sv-SE")} kr.`,
  };
}

function hockeyOutcomeOdds(
  oddsByOutcome: Partial<Record<Outcome, number | null | undefined>>,
  o: Outcome
): number | null {
  const v = oddsByOutcome[o];
  return v != null && v > 1 && v < 80 ? v : null;
}

/**
 * Hockey 9 egen rad: spann lägsta–högsta vid gardering (100 kr × oddsprodukt).
 * En kombination = en niofalt; kostnad = antal kombinationer × 100 kr.
 */
export function estimateHockey9PayoutRange(args: {
  /** Per match: valda tecken + odds 1/X/2. */
  legs: Array<{
    outcomes: Outcome[];
    oddsByOutcome: Partial<Record<Outcome, number | null | undefined>>;
  }>;
  unitStakeKr?: number;
}): MaxPayoutEstimate & { rows: number; costKr: number } {
  const stake = args.unitStakeKr ?? 100;
  const minKr = MIN_PAYOUT_KR;
  const legs = args.legs.filter((l) => l.outcomes.length > 0);
  let lowProduct = 1;
  let highProduct = 1;
  let rows = 1;
  let used = 0;

  for (const leg of legs) {
    const oddsList = leg.outcomes
      .map((o) => hockeyOutcomeOdds(leg.oddsByOutcome, o))
      .filter((v): v is number => v != null);
    if (!oddsList.length) continue;
    used++;
    rows *= leg.outcomes.length;
    lowProduct *= Math.min(...oddsList);
    highProduct *= Math.max(...oddsList);
  }

  if (used === 0) {
    return {
      estimatedKr: 0,
      lowKr: 0,
      highKr: 0,
      oddsProduct: 1,
      folkShare: 0,
      oddsBasedKr: 0,
      folkBasedKr: 0,
      meetsMin: false,
      minKr,
      note: "Välj nio matcher och tecken för utdelningsspann.",
      rows: 0,
      costKr: 0,
    };
  }

  const lowKr = Math.round(stake * lowProduct);
  const highKr = Math.round(stake * highProduct);
  const estimatedKr = blendPayoutKr(lowKr, highKr);
  const meetsMin = highKr >= minKr && used >= 9;
  const costKr = Math.round(rows * stake);
  return {
    estimatedKr,
    lowKr: Math.min(lowKr, highKr),
    highKr: Math.max(lowKr, highKr),
    oddsProduct: Math.round(highProduct * 100) / 100,
    folkShare: 0,
    oddsBasedKr: highKr,
    folkBasedKr: highKr,
    meetsMin,
    minKr,
    note: meetsMin
      ? `Hockey 9 · golv ${minKr.toLocaleString("sv-SE")} kr · spann ~${Math.min(lowKr, highKr).toLocaleString("sv-SE")}–${Math.max(lowKr, highKr).toLocaleString("sv-SE")} kr (${rows} komb. × ${stake} kr).`
      : `Hockey 9 · spann ~${Math.min(lowKr, highKr).toLocaleString("sv-SE")}–${Math.max(lowKr, highKr).toLocaleString("sv-SE")} kr – under golvet ${minKr.toLocaleString("sv-SE")} kr.`,
    rows,
    costKr,
  };
}

/**
 * På enkelmatcher: byt till näst bästa utgång om det lyfter
 * beräknad utdelning mot produktens golv (ingen tak).
 */
export function liftPicksTowardMinPayout(args: {
  product: string;
  matches: MatchAnalysis[];
  picks: SystemPick[];
  netSale: string | number | null | undefined;
  rowPrice: number;
  /** Modellscore per eventNumber → Outcome → 0–1 */
  outcomeScore: (m: MatchAnalysis, o: Outcome) => number;
}): { picks: SystemPick[]; estimate: MaxPayoutEstimate } {
  let picks = args.picks.map((p) => ({ ...p, outcomes: [...p.outcomes] }));
  let estimate = estimateMaxPayout({
    product: args.product,
    matches: args.matches,
    picks,
    netSale: args.netSale,
    rowPrice: args.rowPrice,
  });
  if (estimate.meetsMin) return { picks, estimate };

  const byEvent = new Map(args.matches.map((m) => [m.eventNumber, m]));
  const order = [...picks.keys()].sort((ia, ib) => {
    const ma = byEvent.get(picks[ia]!.eventNumber);
    const mb = byEvent.get(picks[ib]!.eventNumber);
    if (!ma || !mb) return 0;
    const oa = primaryOutcomeForPayout(picks[ia]!, ma, "high");
    const ob = primaryOutcomeForPayout(picks[ib]!, mb, "high");
    const oddsa = outcomeOdds(ma.odds, oa) ?? 1;
    const oddsb = outcomeOdds(mb.odds, ob) ?? 1;
    return oddsa - oddsb; // lyft först korta favoriter
  });

  for (const idx of order) {
    if (estimate.meetsMin) break;
    const pick = picks[idx]!;
    if (pick.cover !== "enkel" || pick.outcomes.length !== 1) continue;
    const m = byEvent.get(pick.eventNumber);
    if (!m) continue;
    const current = pick.outcomes[0]!;
    const alts = (["1", "X", "2"] as Outcome[])
      .filter((o) => o !== current)
      .map((o) => ({
        o,
        score: args.outcomeScore(m, o),
        odds: outcomeOdds(m.odds, o) ?? 1,
      }))
      .filter((a) => a.score >= 0.28 && a.odds > (outcomeOdds(m.odds, current) ?? 1) * 1.08)
      .sort((a, b) => b.odds * b.score - a.odds * a.score);
    for (const alt of alts) {
      const trial = picks.map((p, i) =>
        i === idx
          ? {
              ...p,
              outcomes: [alt.o],
              reason: `enkel ${alt.o} (utdelningslyft) – ${p.reason}`,
            }
          : p
      );
      const next = estimateMaxPayout({
        product: args.product,
        matches: args.matches,
        picks: trial,
        netSale: args.netSale,
        rowPrice: args.rowPrice,
      });
      if (next.highKr > estimate.highKr) {
        picks = trial;
        estimate = next;
        if (estimate.meetsMin) break;
      }
    }
  }

  return { picks, estimate };
}
