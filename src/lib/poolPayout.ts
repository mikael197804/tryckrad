import type {
  Distribution,
  MatchAnalysis,
  Odds,
  Outcome,
  SystemPick,
} from "./types";

/** Minsta beräknade utdelning vid fullträff (kr). Ingen övre gräns. */
export const MIN_PAYOUT_KR = 3000;

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
 * Primär tipputgång för max-rätt-estimat:
 * enkel = tipset; halv/hel = den i tipset med högst odds (lägre folk → högre utdelning).
 */
export function primaryOutcomeForPayout(
  pick: SystemPick,
  match: MatchAnalysis
): Outcome {
  const outs = pick.outcomes.length ? pick.outcomes : (["1"] as Outcome[]);
  if (outs.length === 1) return outs[0]!;
  let best: Outcome = outs[0]!;
  let bestOdds = -1;
  for (const o of outs) {
    const od = outcomeOdds(match.odds, o) ?? 1;
    if (od > bestOdds) {
      bestOdds = od;
      best = o;
    }
  }
  return best;
}

export type MaxPayoutEstimate = {
  /** Beräknad utdelning max rätt (kr). */
  estimatedKr: number;
  /** Oddsprodukt för primära utgångar. */
  oddsProduct: number;
  /** Folkandel för samma rad (0–1). */
  folkShare: number;
  /** Utdelning via odds×omsättning. */
  oddsBasedKr: number;
  /** Utdelning via folk×omsättning. */
  folkBasedKr: number;
  /** true om estimatet ≥ MIN_PAYOUT_KR (golv, ingen tak). */
  meetsMin: boolean;
  note: string;
};

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
    const primary = primaryOutcomeForPayout(pick, m);
    const od = outcomeOdds(m.odds, primary);
    const folk = outcomeFolk(m.svenskaFolket, primary);
    if (od != null) {
      oddsProduct *= od;
      used++;
    }
    // Golv 1% per match så en enda tunn favorit inte spränger estimatet
    folkShare *= clamp(folk / 100, 0.01, 0.95);
  }

  if (used === 0) {
    return {
      estimatedKr: 0,
      oddsProduct: 1,
      folkShare: 1,
      oddsBasedKr: 0,
      folkBasedKr: 0,
      meetsMin: false,
      note: "Saknar odds för utdelningsestimat.",
    };
  }

  const oddsBasedKr = share * rowPrice * oddsProduct;
  let folkBasedKr = oddsBasedKr;
  if (netSale != null && netSale > 0 && folkShare > 0) {
    const rowsSold = Math.max(1, netSale / rowPrice);
    const winningRows = Math.max(0.01, rowsSold * folkShare);
    folkBasedKr = (netSale * share) / winningRows;
  }

  // Geometriskt medel – tvingar odds och omsättning/folk att “stämma”
  const estimatedKr = Math.round(
    Math.sqrt(Math.max(1, oddsBasedKr) * Math.max(1, folkBasedKr))
  );
  const meetsMin = estimatedKr >= MIN_PAYOUT_KR;
  const note = meetsMin
    ? `Beräknad utdelning vid fullträff ~${estimatedKr.toLocaleString("sv-SE")} kr (odds×omsättning, potshare ${Math.round(share * 100)}% – ingen övre gräns).`
    : `Beräknad utdelning ~${estimatedKr.toLocaleString("sv-SE")} kr – under golvet ${MIN_PAYOUT_KR.toLocaleString("sv-SE")} kr.`;

  return {
    estimatedKr,
    oddsProduct: Math.round(oddsProduct * 100) / 100,
    folkShare: Math.round(folkShare * 1e6) / 1e6,
    oddsBasedKr: Math.round(oddsBasedKr),
    folkBasedKr: Math.round(folkBasedKr),
    meetsMin,
    note,
  };
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
  const estimatedKr = Math.round(stake * product);
  const meetsMin = estimatedKr >= MIN_PAYOUT_KR && odds.length >= 9;
  return {
    estimatedKr,
    oddsProduct: Math.round(product * 100) / 100,
    folkShare: 0,
    oddsBasedKr: estimatedKr,
    folkBasedKr: estimatedKr,
    meetsMin,
    note: meetsMin
      ? `Hockey 9 · ${stake} kr-rad → ~${estimatedKr.toLocaleString("sv-SE")} kr vid 9 rätt (oddsprodukt ${String(Math.round(product * 10) / 10).replace(".", ",")} – ingen övre gräns).`
      : `Hockey 9 · beräknad utdelning ~${estimatedKr.toLocaleString("sv-SE")} kr – under golvet ${MIN_PAYOUT_KR.toLocaleString("sv-SE")} kr.`,
  };
}

/**
 * På enkelmatcher: byt till näst bästa utgång om det lyfter
 * beräknad utdelning mot golvet ≥ MIN_PAYOUT_KR (ingen tak).
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
    const oa = primaryOutcomeForPayout(picks[ia]!, ma);
    const ob = primaryOutcomeForPayout(picks[ib]!, mb);
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
      if (next.estimatedKr > estimate.estimatedKr) {
        picks = trial;
        estimate = next;
        if (estimate.meetsMin) break;
      }
    }
  }

  return { picks, estimate };
}
