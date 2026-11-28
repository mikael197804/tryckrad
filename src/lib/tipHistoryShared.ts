/**
 * Klientsäkra typer/helpers för resultatbiblioteket (ingen Node fs / async_hooks).
 */

export type HistoryProduct =
  | "oddset"
  | "powerplay"
  | "topptipset"
  | "stryktipset"
  | "europatipset"
  | "maltipset"
  | "v75"
  | "v64"
  | "tvilling"
  | "hockey_1x2";

export type HistoryPickStatus = "pending" | "live" | "won" | "lost";

export type HistoryPick = {
  id: string;
  product: HistoryProduct;
  gameKey: string;
  gameLabel: string;
  tippedAt: string;
  description: string;
  home: string;
  away: string;
  market: "1x2" | "over_1_5" | "over_2_5" | "mal" | "atg_win" | "atg_twin";
  /** T.ex. ["1","X"], ["over_1_5"], ["mal"] eller startnr ["2","4"]. */
  pick: string[];
  kickoff: string | null;
  drawNumber: number | null;
  eventNumber: number | null;
  eventId: number | null;
  /**
   * Svenska Spel API-slug för just denna kupong
   * (topptipsetstryk / topptipsetextra / topptipset …).
   */
  apiSlug?: string | null;
  /** ATG race-id för V75/V64/Tvilling. */
  raceId?: string | null;
  status: HistoryPickStatus;
  actual: string | null;
  resultNote: string | null;
  /** När spelet settlades (färdigt) – resultat visas 8 h efter detta. */
  settledAt?: string | null;
  /** Systemkostnad 48–720 kr (null för Oddset). */
  costKr?: number | null;
};

export type HistoryGameSummary = {
  gameKey: string;
  product: HistoryProduct;
  label: string;
  tippedAt: string;
  total: number;
  settled: number;
  won: number;
  lost: number;
  pending: number;
  live: number;
  /** System 48–720 kr */
  costKr: number | null;
  /**
   * Systemresultat när allt är settlat:
   * Powerplay/Topptipset = endast 8 rätt (annars ingen utdelning).
   * Övriga: ≈ ≥7 rätt på 8 matcher (eller alla rätt på färre).
   */
  systemResult: "won" | "lost" | "pending";
  /** Officiell utdelning från Svenska Spel, t.ex. "8 rätt · 601,18". */
  payoutLabel?: string | null;
  drawNumber?: number | null;
  /** Kupong-slug för utdelnings-API (Stryk/Extra ≠ daglig Topp). */
  apiSlug?: string | null;
};

/**
 * PP/Topp kräver fullträff (8 rätt).
 * V75 ≈ 5 av 7, V64 ≈ 4 av 6 (poolnivå).
 * Övriga: en miss ok på 8-matcher.
 */
export function systemWinThreshold(
  product: HistoryProduct,
  total: number
): number {
  if (product === "powerplay" || product === "topptipset") {
    return total;
  }
  if (product === "v75") {
    return Math.max(1, total - 2);
  }
  if (product === "v64") {
    return Math.max(1, total - 2);
  }
  if (product === "tvilling") {
    return Math.max(1, Math.ceil(total * 0.6));
  }
  if (product === "hockey_1x2") {
    // 9 tips – en miss ok (samma som Oddset 7–9)
    return Math.max(1, total - 1);
  }
  if (total >= 7 && total <= 9) {
    return Math.max(1, total - 1);
  }
  return total;
}

export type TipHistoryResponse = {
  generatedAt: string;
  retentionHours: number;
  picks: HistoryPick[];
  games: HistoryGameSummary[];
  totals: {
    total: number;
    settled: number;
    won: number;
    lost: number;
    pending: number;
    live: number;
  };
};

export const TIP_HISTORY_RETENTION_MS = 8 * 60 * 60 * 1000;
export const TIP_HISTORY_RETENTION_HOURS = 8;

/**
 * Behåll tips 8 h efter att spelet är färdigt / startat.
 * Framtida matcher (kickoff > nu) hör inte hemma i resultat.
 */
export function historyRetentionAnchorMs(p: HistoryPick): number {
  if (p.status === "won" || p.status === "lost") {
    const settled = p.settledAt ? Date.parse(p.settledAt) : NaN;
    if (Number.isFinite(settled)) return settled;
    const kick = p.kickoff ? Date.parse(p.kickoff) : NaN;
    if (Number.isFinite(kick)) return kick;
  }
  const kick = p.kickoff ? Date.parse(p.kickoff) : NaN;
  const tipped = Date.parse(p.tippedAt);
  if (Number.isFinite(kick) && Number.isFinite(tipped)) {
    return Math.max(kick, tipped);
  }
  return Number.isFinite(kick) ? kick : tipped;
}

/** true om matchen/tippet fortfarande ligger i framtiden. */
export function isFutureHistoryPick(
  p: HistoryPick,
  now = Date.now()
): boolean {
  const kick = p.kickoff ? Date.parse(p.kickoff) : NaN;
  if (Number.isFinite(kick) && kick > now) return true;
  return false;
}

export function productHistoryLabel(p: HistoryProduct): string {
  switch (p) {
    case "powerplay":
      return "Powerplay";
    case "topptipset":
      return "Topptipset";
    case "stryktipset":
      return "Stryktipset";
    case "europatipset":
      return "Europatipset";
    case "maltipset":
      return "Måltipset";
    case "oddset":
      return "Oddset";
    case "v75":
      return "V75";
    case "v64":
      return "V64";
    case "tvilling":
      return "Tvilling";
    case "hockey_1x2":
      return "Hockey 9";
  }
}
