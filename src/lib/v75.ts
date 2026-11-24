import {
  atgDistToPct,
  atgOddsToDecimal,
  fetchStartDetailsForRace,
  fetchV75Game,
  findUpcomingV75,
  personName,
  type AtgGame,
  type AtgPriorRecord,
  type AtgRace,
  type AtgStart,
  type AtgStartDetail,
} from "./atg";
import {
  collectExternalV75Tips,
  type ExternalTipMention,
  type TipSourceReport,
} from "./v75Tips";

export type V75ClassDrop = {
  dropped: boolean;
  note: string | null;
  /** Medel förstapris i senaste starter (kr). */
  recentAvgFirstPrizeKr: number | null;
  currentFirstPrizeKr: number | null;
  /** Antal av senaste starter med högre förstapris. */
  higherPrizeStarts: number;
};

export type V75LowOddsReview = {
  isLowOdds: boolean;
  note: string | null;
  /** true om lågoddsaren stöds av seger%/klass/form. */
  supported: boolean | null;
};

export type V75HorseTip = {
  startNumber: number;
  postPosition: number | null;
  name: string;
  driver: string;
  trainer: string;
  winOdds: number | null;
  v75Pct: number | null;
  impliedWinPct: number | null;
  /** Modell-p justerad för form/hemma/tips – jämförs med v75Pct. */
  modelWinPct: number | null;
  valueEdgePct: number | null;
  winRatePct: number | null;
  /** Seger% relativt fältets median (procentenheter). */
  winRateEdgePct: number | null;
  highWinRate: boolean;
  classDrop: V75ClassDrop | null;
  lowOddsReview: V75LowOddsReview | null;
  recentForm: string | null;
  isHomeTrack: boolean;
  trainerHomeTrack: boolean;
  driverHomeTrack: boolean;
  homeNote: string | null;
  formNote: string | null;
  misleading: string | null;
  tipMentions: ExternalTipMention[];
  tipConsensus: "hot" | "value" | "fade" | "split" | "none";
  score: number;
  role: "spik" | "gardering" | "skräll" | "skip";
  reason: string;
};

export type V75LegAnalysis = {
  leg: number;
  raceId: string;
  raceName: string;
  trackName: string;
  trackId: number | null;
  distance: number | null;
  startMethod: string | null;
  startTime: string | null;
  horses: V75HorseTip[];
  pickNumbers: number[];
  pickLabel: string;
  openness: "spikläge" | "halvöppet" | "vidöppet";
  alerts: string[];
  summary: string;
};

export type V75DayTip = {
  generatedAt: string;
  gameId: string;
  playDate: string;
  playDateLabel: string;
  status: string;
  trackNames: string[];
  startTime: string | null;
  turnoverKr: number | null;
  jackpotKr: number | null;
  estimatedJackpotKr: number | null;
  rowPriceKr: number;
  /** Antal matematiska rader i tippraden. */
  tipRows: number;
  /** Kostnad för tippraden (rader × radpris), styrs till 50–500 kr. */
  tipCostKr: number;
  tipBudgetMinKr: number;
  tipBudgetMaxKr: number;
  atgUrl: string;
  legs: V75LegAnalysis[];
  couponLine: string;
  valueHorses: Array<{
    leg: number;
    startNumber: number;
    name: string;
    edgePct: number;
    reason: string;
  }>;
  homeTrackHorses: Array<{
    leg: number;
    startNumber: number;
    name: string;
    note: string;
  }>;
  misleadingFavorites: Array<{
    leg: number;
    startNumber: number;
    name: string;
    note: string;
  }>;
  classDropHorses: Array<{
    leg: number;
    startNumber: number;
    name: string;
    note: string;
  }>;
  highWinRateHorses: Array<{
    leg: number;
    startNumber: number;
    name: string;
    winRatePct: number;
    edgePct: number;
    note: string;
  }>;
  lowOddsReviews: Array<{
    leg: number;
    startNumber: number;
    name: string;
    winOdds: number;
    supported: boolean | null;
    note: string;
  }>;
  externalSources: TipSourceReport[];
  headlineSignals: ExternalTipMention[];
  rules: string[];
  disclaimer: string;
};

function divisionFromName(name: string | null | undefined): {
  rank: number | null;
  label: string | null;
} {
  if (!name) return { rank: null, label: null };
  const n = name.toLowerCase();
  if (n.includes("gulddivisionen")) return { rank: 100, label: "Gulddivisionen" };
  if (n.includes("silverdivisionen"))
    return { rank: 80, label: "Silverdivisionen" };
  if (n.includes("diamantstoet")) return { rank: 62, label: "Diamantstoet" };
  if (n.includes("bronsdivisionen"))
    return { rank: 60, label: "Bronsdivisionen" };
  if (n.includes("stodivisionen")) return { rank: 58, label: "Stodivisionen" };
  if (/klass\s*iii\b/.test(n)) return { rank: 30, label: "Klass III" };
  if (/klass\s*ii\b/.test(n)) return { rank: 40, label: "Klass II" };
  if (/klass\s*i\b/.test(n)) return { rank: 50, label: "Klass I" };
  return { rank: null, label: null };
}

/** Förstapris i kr från ATG-prissträng "Pris: 150.000-…". */
export function parseFirstPrizeKr(prize: string | null | undefined): number | null {
  if (!prize) return null;
  const m = prize.match(/Pris:\s*([\d.]+)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ATG firstPrize i historik är i öre. */
function priorFirstPrizeKr(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw / 100);
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function recentFormLine(records: AtgPriorRecord[]): string | null {
  const places = records.slice(0, 5).map((r) => {
    const p = String(r.place ?? "");
    if (!p || p === "0") return "d";
    return p;
  });
  if (!places.length) return null;
  return `form ${places.join("-")}`;
}

function analyzeClassDrop(
  records: AtgPriorRecord[],
  currentFirstPrizeKr: number | null,
  currentDivisionRank: number | null
): V75ClassDrop {
  const recent = records.slice(0, 6);
  const prizes = recent
    .map((r) => priorFirstPrizeKr(r.race?.firstPrize))
    .filter((n): n is number => n != null);
  const avg = prizes.length
    ? Math.round(prizes.reduce((a, b) => a + b, 0) / prizes.length)
    : null;
  let higher = 0;
  if (currentFirstPrizeKr != null) {
    higher = prizes.filter((p) => p >= currentFirstPrizeKr * 1.25).length;
  }

  // Prize-based drop: recent average clearly above tonight
  let dropped = false;
  const notes: string[] = [];
  if (
    currentFirstPrizeKr != null &&
    avg != null &&
    avg >= currentFirstPrizeKr * 1.35 &&
    higher >= 2
  ) {
    dropped = true;
    notes.push(
      `nergraderad klass: snitt förstapris senaste starter ${avg.toLocaleString("sv-SE")} kr mot ${currentFirstPrizeKr.toLocaleString("sv-SE")} kr i dag`
    );
  } else if (
    currentFirstPrizeKr != null &&
    higher >= 3 &&
    prizes.some((p) => p >= currentFirstPrizeKr * 1.6)
  ) {
    dropped = true;
    notes.push(
      `kommer från starkare lopp (${higher} av ${prizes.length} senaste med högre förstapris)`
    );
  }

  // Soft signal even without hard drop
  if (
    !dropped &&
    currentFirstPrizeKr != null &&
    avg != null &&
    avg > currentFirstPrizeKr * 1.15 &&
    higher >= 2
  ) {
    notes.push(
      `lättare uppgift än vanligt (snittförstapris ${avg.toLocaleString("sv-SE")} kr)`
    );
  }

  void currentDivisionRank; // reserved if race names appear on priors later

  return {
    dropped,
    note: notes[0] || null,
    recentAvgFirstPrizeKr: avg,
    currentFirstPrizeKr,
    higherPrizeStarts: higher,
  };
}

function analyzeLowOdds(
  winOdds: number | null,
  winRatePct: number | null,
  impliedWinPct: number | null,
  classDrop: V75ClassDrop | null,
  recentPlaces: string[],
  fieldMedianWin: number | null
): V75LowOddsReview | null {
  if (winOdds == null || winOdds > 5.5) return null;
  const bits: string[] = [];
  let supported: boolean | null = null;
  const winsInRecent = recentPlaces.filter((p) => p === "1").length;
  const placed = recentPlaces.filter((p) => ["1", "2", "3"].includes(p)).length;

  bits.push(`lågoddsare @ ${winOdds.toFixed(2).replace(".", ",")}`);

  if (winRatePct != null && impliedWinPct != null) {
    const gap = winRatePct - impliedWinPct;
    if (gap >= 4) {
      bits.push(
        `seger% ${winRatePct.toFixed(1).replace(".", ",")} över odds-implied ${impliedWinPct.toFixed(1).replace(".", ",")}`
      );
      supported = true;
    } else if (gap <= -8) {
      bits.push(
        `seger% ${winRatePct.toFixed(1).replace(".", ",")} under odds-implied ${impliedWinPct.toFixed(1).replace(".", ",")} – odds kan vara för snäva`
      );
      supported = false;
    } else {
      bits.push(
        `seger% ${winRatePct.toFixed(1).replace(".", ",")} ≈ odds (${impliedWinPct.toFixed(1).replace(".", ",")}%)`
      );
    }
  }

  if (fieldMedianWin != null && winRatePct != null && winRatePct >= fieldMedianWin + 8) {
    bits.push(
      `högst/hög seger% i fältet (median ${fieldMedianWin.toFixed(1).replace(".", ",")}%)`
    );
    supported = supported !== false ? true : supported;
  }

  if (classDrop?.dropped) {
    bits.push(classDrop.note || "nergraderad från starkare lopp");
    supported = supported !== false ? true : supported;
  }

  if (recentPlaces.length) {
    bits.push(`senaste: ${recentPlaces.join("-")}`);
    if (winsInRecent >= 1 || placed >= 3) {
      supported = supported !== false ? true : supported;
    } else if (placed === 0 && recentPlaces.length >= 4) {
      bits.push("svag recent form mot låga oddsen");
      supported = false;
    }
  }

  return {
    isLowOdds: true,
    note: bits.join(" · "),
    supported,
  };
}

function yearKey(): string {
  return String(new Date().getUTCFullYear());
}

function winPctFromStats(start: AtgStart): number | null {
  const life = start.horse.statistics?.life?.winPercentage;
  if (life != null && life > 0) return life / 100; // ATG: 1777 → 17.77%
  const y = start.horse.statistics?.years?.[yearKey()]?.winPercentage;
  if (y != null && y > 0) return y / 100;
  return null;
}

function placePctFromStats(start: AtgStart): number | null {
  const p = start.horse.statistics?.life?.placePercentage;
  if (p != null && p > 0) return p / 100;
  return null;
}

function formNoteFor(start: AtgStart): string | null {
  const life = start.horse.statistics?.life;
  const parts: string[] = [];
  if (life?.starts != null) {
    const w = life.placement?.["1"] ?? 0;
    const p2 = life.placement?.["2"] ?? 0;
    const p3 = life.placement?.["3"] ?? 0;
    parts.push(`karriär ${w}-${p2}-${p3} på ${life.starts} starter`);
  }
  const win = winPctFromStats(start);
  if (win != null) parts.push(`seger% ≈ ${win.toFixed(1).replace(".", ",")}`);
  const avg = start.horse.statistics?.lastFiveStarts?.averageOdds;
  if (avg != null && avg > 0) {
    parts.push(`snittodds 5 starter ${(avg / 100).toFixed(1).replace(".", ",")}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function homeTrackSignals(
  start: AtgStart,
  trackId: number | null,
  trackName: string
): {
  horse: boolean;
  trainer: boolean;
  driver: boolean;
  note: string | null;
} {
  const horseHome = start.horse.homeTrack?.id === trackId;
  const trainerHome = start.horse.trainer?.homeTrack?.id === trackId;
  const driverHome = start.driver?.homeTrack?.id === trackId;
  const bits: string[] = [];
  if (horseHome) bits.push(`hemmahäst på ${trackName}`);
  if (trainerHome) bits.push("tränare hemma");
  if (driverHome) bits.push("kusk hemma");
  return {
    horse: !!horseHome,
    trainer: !!trainerHome,
    driver: !!driverHome,
    note: bits.length ? bits.join(" · ") : null,
  };
}

function tipConsensus(
  mentions: ExternalTipMention[]
): V75HorseTip["tipConsensus"] {
  if (!mentions.length) return "none";
  const hot = mentions.filter((m) => m.sentiment === "hot").length;
  const value = mentions.filter((m) => m.sentiment === "value").length;
  const fade = mentions.filter((m) => m.sentiment === "fade").length;
  if (fade > hot && fade > value) return "fade";
  if (hot && value) return "split";
  if (hot >= value && hot > 0) return "hot";
  if (value > 0) return "value";
  return "split";
}

type HorseEnrichment = {
  detail: AtgStartDetail | null;
  currentFirstPrizeKr: number | null;
  currentDivisionRank: number | null;
  fieldMedianWinPct: number | null;
};

function analyzeHorse(
  start: AtgStart,
  leg: number,
  trackId: number | null,
  trackName: string,
  mentions: ExternalTipMention[],
  enrich: HorseEnrichment
): V75HorseTip {
  const winOdds = atgOddsToDecimal(start.pools?.vinnare?.odds);
  const v75Pct = atgDistToPct(start.pools?.V75?.betDistribution);
  const impliedWinPct =
    winOdds != null && winOdds > 1
      ? Math.round((100 / winOdds) * 10) / 10
      : null;

  const home = homeTrackSignals(start, trackId, trackName);
  const formWin = winPctFromStats(start);
  const place = placePctFromStats(start);
  const form = formNoteFor(start);
  const winRatePct =
    formWin != null ? Math.round(formWin * 10) / 10 : null;
  const winRateEdgePct =
    winRatePct != null && enrich.fieldMedianWinPct != null
      ? Math.round((winRatePct - enrich.fieldMedianWinPct) * 10) / 10
      : null;
  const highWinRate =
    winRateEdgePct != null &&
    winRateEdgePct >= 8 &&
    (start.horse.statistics?.life?.starts ?? 0) >= 5;

  const records = enrich.detail?.horse?.results?.records || [];
  const classDrop = analyzeClassDrop(
    records,
    enrich.currentFirstPrizeKr,
    enrich.currentDivisionRank
  );
  const recentPlaces = records.slice(0, 5).map((r) => String(r.place ?? "0"));
  const recentForm = recentFormLine(records);
  const lowOddsReview = analyzeLowOdds(
    winOdds,
    winRatePct,
    impliedWinPct,
    classDrop,
    recentPlaces,
    enrich.fieldMedianWinPct
  );

  // Modell: blanda odds-implied, form och hemmafördel – sedan jämför mot V75%
  let model =
    impliedWinPct != null
      ? impliedWinPct * 0.55
      : formWin != null
        ? formWin * 0.7
        : 8;
  if (formWin != null) model += formWin * 0.25;
  if (place != null) model += place * 0.08;
  if (home.horse) model += 2.2;
  if (home.trainer) model += 1.1;
  if (home.driver) model += 0.8;
  if (highWinRate) model += Math.min(6, (winRateEdgePct || 0) * 0.35);
  if (classDrop.dropped) model += 4.5;
  else if (classDrop.note) model += 1.5;

  const horseMentions = mentions.filter(
    (m) =>
      m.horseName &&
      m.horseName.toLowerCase() === start.horse.name.toLowerCase() &&
      (m.leg == null || m.leg === leg)
  );
  const consensus = tipConsensus(horseMentions);
  if (consensus === "hot") model += 3.5;
  if (consensus === "value") model += 2.5;
  if (consensus === "fade") model -= 3;
  if (consensus === "split") model += 1;

  // Post position mild boost for auto early posts (rough)
  const post = start.postPosition ?? start.number;
  if (post <= 3) model += 0.8;
  if (post >= 10) model -= 0.6;

  // Lågoddsare: granska noga – lyft om stödd, sänk om ej
  if (lowOddsReview?.isLowOdds) {
    if (lowOddsReview.supported === true) model += 3;
    if (lowOddsReview.supported === false) model -= 4;
  }

  model = Math.max(1, Math.min(65, Math.round(model * 10) / 10));

  const valueEdgePct =
    v75Pct != null ? Math.round((model - v75Pct) * 10) / 10 : null;

  let misleading: string | null = null;
  if (v75Pct != null && v75Pct >= 28 && impliedWinPct != null) {
    if (impliedWinPct + 8 < v75Pct) {
      misleading = `Högt V75-streck (${v75Pct
        .toFixed(1)
        .replace(".", ",")}%) mot vinnarodds som ger ≈${impliedWinPct
        .toFixed(1)
        .replace(".", ",")}% – risk att favoriten är missvisande/överstreckad.`;
    }
  }
  if (v75Pct != null && v75Pct >= 35 && formWin != null && formWin < 12) {
    misleading =
      (misleading ? misleading + " " : "") +
      `Mycket spel men låg segerprocent i statistiken (≈${formWin
        .toFixed(1)
        .replace(".", ",")}%).`;
  }
  if (
    lowOddsReview?.isLowOdds &&
    lowOddsReview.supported === false &&
    (v75Pct ?? 0) >= 22
  ) {
    misleading =
      (misleading ? misleading + " " : "") +
      `Lågoddsare utan stöd i seger%/form: ${lowOddsReview.note}`;
  }
  if (consensus === "fade" && v75Pct != null && v75Pct >= 20) {
    misleading =
      (misleading ? misleading + " " : "") +
      "Externa tips varnar / tonar ner favoriten.";
  }

  // Ranking: poolfavoriter först, värde/tips lyfter garderingar utan att sparka bort bankar
  let score = (v75Pct ?? 0) * 0.55 + model * 0.35;
  if (valueEdgePct != null && valueEdgePct > 0) {
    score += Math.min(valueEdgePct, 10) * 0.25;
  }
  if (highWinRate) score += 3.5;
  if (classDrop.dropped) score += 4;
  if (lowOddsReview?.supported === true) score += 2.5;
  if (lowOddsReview?.supported === false) score -= 3;
  if (home.horse) score += 1.2;
  if (misleading) score -= 6;
  if (horseMentions.some((m) => m.sentiment === "hot")) score += 2.5;
  if (horseMentions.some((m) => m.sentiment === "fade")) score -= 2;

  let role: V75HorseTip["role"] = "skip";
  const reasons: string[] = [];

  if (
    (v75Pct != null && v75Pct >= 32 && !misleading) ||
    (lowOddsReview?.supported === true && (winOdds ?? 99) <= 3.2)
  ) {
    role = "spik";
    reasons.push(
      v75Pct != null && v75Pct >= 32
        ? `tung favorit i poolen (${v75Pct.toFixed(1).replace(".", ",")}%)`
        : "lågoddsare med stöd i seger%/klass"
    );
  } else if (
    classDrop.dropped ||
    highWinRate ||
    (valueEdgePct != null &&
      valueEdgePct >= 5 &&
      (impliedWinPct == null || impliedWinPct >= 6))
  ) {
    role = classDrop.dropped || highWinRate ? "gardering" : "skräll";
    if (classDrop.dropped && classDrop.note) reasons.push(classDrop.note);
    if (highWinRate && winRatePct != null) {
      reasons.push(
        `högre seger% än fältet (${winRatePct
          .toFixed(1)
          .replace(".", ",")}% · +${String(winRateEdgePct).replace(".", ",")}%-enheter)`
      );
    }
    if (valueEdgePct != null && valueEdgePct >= 5) {
      reasons.push(
        `överodds/värde: modell ${model
          .toFixed(1)
          .replace(".", ",")}% vs V75 ${String(v75Pct ?? "–").replace(".", ",")}%)`
      );
    }
  } else if (
    (v75Pct != null && v75Pct >= 14) ||
    (consensus === "hot" && (v75Pct ?? 0) >= 8) ||
    (consensus === "value" && (v75Pct ?? 0) >= 6) ||
    (lowOddsReview?.isLowOdds && lowOddsReview.supported !== false)
  ) {
    role = "gardering";
    reasons.push("hålls med som gardering");
  }

  if (home.note) reasons.push(home.note);
  if (winOdds != null)
    reasons.push(`vinnarodds ${winOdds.toFixed(2).replace(".", ",")}`);
  if (lowOddsReview?.note && (winOdds ?? 99) <= 5.5) {
    reasons.push(lowOddsReview.note);
  }
  if (recentForm) reasons.push(recentForm);
  if (horseMentions.length) {
    const srcs = [...new Set(horseMentions.map((m) => m.source))].slice(0, 3);
    reasons.push(`tips: ${srcs.join(", ")}`);
  }
  if (misleading) reasons.push("varning: missvisande favoritläge");

  // If nothing else but top score later – role may upgrade in leg pass
  if (role === "skip" && reasons.length === 0) {
    reasons.push(form || "ingen tydlig signal");
  }

  return {
    startNumber: start.number,
    postPosition: start.postPosition ?? null,
    name: start.horse.name,
    driver: personName(start.driver),
    trainer: personName(start.horse.trainer),
    winOdds,
    v75Pct,
    impliedWinPct,
    modelWinPct: model,
    valueEdgePct,
    winRatePct,
    winRateEdgePct,
    highWinRate,
    classDrop,
    lowOddsReview,
    recentForm,
    isHomeTrack: home.horse,
    trainerHomeTrack: home.trainer,
    driverHomeTrack: home.driver,
    homeNote: home.note,
    formNote: form,
    misleading,
    tipMentions: horseMentions.slice(0, 4),
    tipConsensus: consensus,
    score,
    role,
    reason: reasons.join(" · "),
  };
}

function opennessFromPicks(
  pickCount: number,
  fieldSize: number
): V75LegAnalysis["openness"] {
  if (pickCount <= 1) return "spikläge";
  if (pickCount <= Math.max(2, Math.floor(fieldSize * 0.35))) return "halvöppet";
  return "vidöppet";
}

function analyzeLeg(
  race: AtgRace,
  leg: number,
  allMentions: ExternalTipMention[],
  details: Map<number, AtgStartDetail>
): V75LegAnalysis {
  const trackName = race.track?.name || "Okänd bana";
  const trackId = race.track?.id ?? null;
  const starts = (race.starts || []).filter((s) => !s.scratched);
  const firstPrize = parseFirstPrizeKr(race.prize);
  const div = divisionFromName(race.name);
  const fieldWins = starts
    .map((s) => winPctFromStats(s))
    .filter((n): n is number => n != null);
  const fieldMedianWinPct = median(fieldWins);

  const horses = starts
    .map((s) =>
      analyzeHorse(s, leg, trackId, trackName, allMentions, {
        detail: details.get(s.number) || null,
        currentFirstPrizeKr: firstPrize,
        currentDivisionRank: div.rank,
        fieldMedianWinPct,
      })
    )
    .sort((a, b) => b.score - a.score);

  // Bygg pick: topp + tydliga garderingar/skrällar – aldrig hela fältet
  const ranked = [...horses];
  const leaderPct = Math.max(...horses.map((h) => h.v75Pct ?? 0), 0);
  const maxPicks =
    leaderPct >= 42 ? 2 : leaderPct >= 30 ? 3 : leaderPct >= 22 ? 4 : 5;

  const picks: V75HorseTip[] = [];
  const top = ranked[0];
  if (top) {
    if (top.role === "skip") top.role = leaderPct >= 30 ? "spik" : "gardering";
    picks.push(top);
  }

  for (const h of ranked.slice(1)) {
    if (picks.length >= maxPicks) break;
    if (h.role === "spik" || h.role === "gardering" || h.role === "skräll") {
      picks.push(h);
      continue;
    }
    if (
      (h.classDrop?.dropped || h.highWinRate) &&
      picks.length < maxPicks
    ) {
      h.role = "gardering";
      picks.push(h);
      continue;
    }
    if (h.valueEdgePct != null && h.valueEdgePct >= 6 && picks.length < maxPicks) {
      h.role = "skräll";
      picks.push(h);
    }
  }

  // Fyll upp till max med nästa högst scorade om loppet är öppet
  if (leaderPct < 30) {
    for (const h of ranked) {
      if (picks.length >= maxPicks) break;
      if (picks.includes(h)) continue;
      h.role = h.role === "skip" ? "gardering" : h.role;
      picks.push(h);
    }
  } else if (picks.length < 2) {
    for (const h of ranked.slice(1)) {
      if (picks.length >= 2) break;
      if (picks.includes(h)) continue;
      h.role = "gardering";
      picks.push(h);
    }
  }

  // Sort picks by start number for coupon display
  picks.sort((a, b) => a.startNumber - b.startNumber);
  const pickNumbers = picks.map((p) => p.startNumber);
  const open = opennessFromPicks(pickNumbers.length, horses.length);

  const alerts: string[] = [];
  for (const h of horses) {
    if (h.misleading) {
      alerts.push(`#${h.startNumber} ${h.name}: ${h.misleading}`);
    }
  }
  const value = horses.filter(
    (h) => h.valueEdgePct != null && h.valueEdgePct >= 4
  );
  if (value.length) {
    alerts.push(
      `Överodds: ${value
        .slice(0, 3)
        .map(
          (h) =>
            `#${h.startNumber} ${h.name} (+${String(h.valueEdgePct).replace(".", ",")}%)`
        )
        .join(", ")}`
    );
  }
  const drops = horses.filter((h) => h.classDrop?.dropped);
  if (drops.length) {
    alerts.push(
      `Nergraderade: ${drops
        .slice(0, 3)
        .map((h) => `#${h.startNumber} ${h.name}`)
        .join(", ")}`
    );
  }
  const highWr = horses.filter((h) => h.highWinRate);
  if (highWr.length) {
    alerts.push(
      `Högre seger%: ${highWr
        .slice(0, 3)
        .map(
          (h) =>
            `#${h.startNumber} ${h.name} (${String(h.winRatePct).replace(".", ",")}%)`
        )
        .join(", ")}`
    );
  }
  const lowOdds = horses.filter((h) => h.lowOddsReview?.isLowOdds);
  if (lowOdds.length) {
    alerts.push(
      `Lågoddsare: ${lowOdds
        .slice(0, 3)
        .map((h) => {
          const tag =
            h.lowOddsReview?.supported === true
              ? "stödd"
              : h.lowOddsReview?.supported === false
                ? "svag"
                : "kollad";
          return `#${h.startNumber} ${h.name} @ ${String(h.winOdds).replace(".", ",")} (${tag})`;
        })
        .join(", ")}`
    );
  }
  const homes = horses.filter((h) => h.isHomeTrack);
  if (homes.length) {
    alerts.push(
      `Hemma på ${trackName}: ${homes
        .slice(0, 4)
        .map((h) => `#${h.startNumber} ${h.name}`)
        .join(", ")}`
    );
  }

  const summaryParts = [
    `${open === "spikläge" ? "Spikläge" : open === "halvöppet" ? "Halvöppet" : "Vidöppet"}`,
    `streck ${pickNumbers.join(",") || "–"}`,
  ];
  if (top?.winOdds != null) {
    summaryParts.push(
      `topp ${top.name} @ ${top.winOdds.toFixed(2).replace(".", ",")}`
    );
  }

  return {
    leg,
    raceId: race.id,
    raceName: race.name || `Avd ${leg}`,
    trackName,
    trackId,
    distance: race.distance ?? null,
    startMethod: race.startMethod ?? null,
    startTime: race.startTime || race.scheduledStartTime || null,
    horses,
    pickNumbers,
    pickLabel: pickNumbers.join(","),
    openness: open,
    alerts,
    summary: summaryParts.join(" · "),
  };
}

function fmtDateLabel(isoDate: string): string {
  try {
    const d = new Date(isoDate + "T12:00:00");
    return d.toLocaleDateString("sv-SE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return isoDate;
  }
}

export const V75_TIP_MIN_KR = 50;
export const V75_TIP_MAX_KR = 500;
/** Sikte mitt i spannet om möjligt. */
export const V75_TIP_TARGET_KR = 180;

function tipRowsFromCounts(counts: number[]): number {
  return counts.reduce((acc, n) => acc * Math.max(1, n), 1);
}

function tipCostFromCounts(counts: number[], rowPrice: number): number {
  return Math.round(tipRowsFromCounts(counts) * rowPrice * 100) / 100;
}

/**
 * Justera antal streck per avd så tippraden kostar 50–500 kr.
 * Fyller öppna lopp först, behåller spikar snäva.
 */
function fitLegsToBudget(
  legs: V75LegAnalysis[],
  rowPrice: number,
  minKr = V75_TIP_MIN_KR,
  maxKr = V75_TIP_MAX_KR,
  targetKr = V75_TIP_TARGET_KR
): { legs: V75LegAnalysis[]; rows: number; costKr: number } {
  // Kandidater per lopp: scorade hästar (högst först), minst topp 1
  const pools = legs.map((leg) => {
    const ranked = [...leg.horses].sort((a, b) => b.score - a.score);
    const must = ranked.filter(
      (h) =>
        h.role === "spik" ||
        h.classDrop?.dropped ||
        h.highWinRate ||
        (h.lowOddsReview?.supported === true && (h.winOdds ?? 99) <= 3.5)
    );
    // Se till att must ingår tidigt i ordningen
    const ordered: V75HorseTip[] = [];
    const seen = new Set<number>();
    for (const h of [...must, ...ranked]) {
      if (seen.has(h.startNumber)) continue;
      seen.add(h.startNumber);
      ordered.push(h);
    }
    // Max streck per lopp: öppnare lopp får fler
    const leaderPct = Math.max(...ordered.map((h) => h.v75Pct ?? 0), 0);
    const maxMarks =
      leaderPct >= 45 ? 2 : leaderPct >= 32 ? 3 : leaderPct >= 22 ? 4 : 5;
    return {
      leg,
      ordered: ordered.slice(0, Math.max(1, Math.min(maxMarks, ordered.length))),
      maxMarks,
      // Osäkerhet: hur mycket vi vill bredda
      need:
        leaderPct < 22
          ? 4
          : leaderPct < 32
            ? 3
            : leaderPct < 45
              ? 2
              : 1.2,
    };
  });

  // Start: 1 streck i varje (billigast)
  const counts = pools.map(() => 1);

  const costOf = () => tipCostFromCounts(counts, rowPrice);
  const canAdd = (i: number) => counts[i] < pools[i].ordered.length;

  // 1) Expandera tills vi når minst minKr, prioritera mest öppna lopp
  let guard = 0;
  while (costOf() < minKr && guard++ < 80) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < pools.length; i++) {
      if (!canAdd(i)) continue;
      // Marginalvärde: need / (nuvarande antal)^1.2
      const next = pools[i].ordered[counts[i]];
      if (!next) continue;
      const s =
        pools[i].need * 10 +
        next.score * 0.15 -
        counts[i] * 3;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) break;
    // Skulle tillägget spräcka max?
    const trial = [...counts];
    trial[best]++;
    if (tipCostFromCounts(trial, rowPrice) > maxKr) {
      // Markera att vi inte kan addera här – försök annan
      // Temporarily pretend at cap by not adding; try next best
      const blocked = best;
      let alt = -1;
      let altScore = -1;
      for (let i = 0; i < pools.length; i++) {
        if (i === blocked || !canAdd(i)) continue;
        const t2 = [...counts];
        t2[i]++;
        if (tipCostFromCounts(t2, rowPrice) > maxKr) continue;
        const next = pools[i].ordered[counts[i]];
        const s = pools[i].need * 10 + (next?.score ?? 0) * 0.15 - counts[i] * 3;
        if (s > altScore) {
          altScore = s;
          alt = i;
        }
      }
      if (alt < 0) break;
      counts[alt]++;
      continue;
    }
    counts[best]++;
  }

  // 2) Sikta mot target om vi fortfarande har marginal under max
  guard = 0;
  while (costOf() < targetKr && costOf() <= maxKr && guard++ < 40) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < pools.length; i++) {
      if (!canAdd(i)) continue;
      const trial = [...counts];
      trial[i]++;
      const nextCost = tipCostFromCounts(trial, rowPrice);
      if (nextCost > maxKr) continue;
      // Föredra tillägg som landar närmare target utan att överskrida
      const next = pools[i].ordered[counts[i]];
      const overshoot = Math.max(0, nextCost - targetKr);
      const s =
        pools[i].need * 8 +
        (next?.score ?? 0) * 0.12 -
        counts[i] * 2.5 -
        overshoot * 0.08;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) break;
    counts[best]++;
    if (costOf() >= targetKr * 0.92) break;
  }

  // 3) Om fortfarande under min (för få kandidater): fyll max tillåtet ≤ maxKr
  guard = 0;
  while (costOf() < minKr && guard++ < 40) {
    let added = false;
    const order = pools
      .map((p, i) => ({ i, need: p.need }))
      .sort((a, b) => b.need - a.need);
    for (const { i } of order) {
      if (!canAdd(i)) continue;
      const trial = [...counts];
      trial[i]++;
      if (tipCostFromCounts(trial, rowPrice) > maxKr) continue;
      counts[i]++;
      added = true;
      break;
    }
    if (!added) break;
  }

  // 4) Om över max (ska sällan hända): trimma bredaste loppen
  guard = 0;
  while (costOf() > maxKr && guard++ < 40) {
    let best = -1;
    let bestNeed = Infinity;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] <= 1) continue;
      // Trimma där need är lägst (säkraste lopp)
      if (pools[i].need < bestNeed) {
        bestNeed = pools[i].need;
        best = i;
      }
    }
    if (best < 0) break;
    counts[best]--;
  }

  const nextLegs = legs.map((leg, idx) => {
    const selected = pools[idx].ordered.slice(0, counts[idx]);
    const pickNumbers = selected
      .map((h) => h.startNumber)
      .sort((a, b) => a - b);
    // Uppdatera roller på valda
    for (const h of leg.horses) {
      if (!pickNumbers.includes(h.startNumber)) {
        if (h.role !== "skip" && !h.classDrop?.dropped && !h.highWinRate) {
          // behåll analysflaggor men tippraden markerar inte
        }
        continue;
      }
      if (h.role === "skip") h.role = "gardering";
    }
    const open = opennessFromPicks(pickNumbers.length, leg.horses.length);
    const top = [...leg.horses].sort((a, b) => b.score - a.score)[0];
    const summaryParts = [
      `${open === "spikläge" ? "Spikläge" : open === "halvöppet" ? "Halvöppet" : "Vidöppet"}`,
      `streck ${pickNumbers.join(",") || "–"}`,
    ];
    if (top?.winOdds != null) {
      summaryParts.push(
        `topp ${top.name} @ ${top.winOdds.toFixed(2).replace(".", ",")}`
      );
    }
    return {
      ...leg,
      pickNumbers,
      pickLabel: pickNumbers.join(","),
      openness: open,
      summary: summaryParts.join(" · "),
    };
  });

  const rows = tipRowsFromCounts(counts);
  const costKr = tipCostFromCounts(counts, rowPrice);
  return { legs: nextLegs, rows, costKr };
}

export async function buildV75DayTip(): Promise<V75DayTip> {
  const found = await findUpcomingV75(12, 2);
  if (!found) {
    throw new Error("Ingen V75-omgång hittades hos ATG just nu.");
  }

  const game: AtgGame = await fetchV75Game(found.summary.id);
  const races = [...(game.races || [])].sort((a, b) => a.number - b.number);

  const horseIndex: Array<{ name: string; number: number; leg: number }> = [];
  races.forEach((race, idx) => {
    const leg = idx + 1;
    for (const s of race.starts || []) {
      if (s.scratched) continue;
      horseIndex.push({ name: s.horse.name, number: s.number, leg });
    }
  });

  const { mentions, sources } = await collectExternalV75Tips(horseIndex);
  const horseMentions = mentions.filter((m) => m.horseName);
  const headlineSignals = mentions
    .filter((m) => !m.horseName && m.snippet)
    .slice(0, 12);

  // Historik per häst (förstapris i tidigare lopp) – klassdroppar
  const detailsByRace = new Map<string, Map<number, AtgStartDetail>>();
  await Promise.all(
    races.map(async (race) => {
      const nums = (race.starts || [])
        .filter((s) => !s.scratched)
        .map((s) => s.number);
      const map = await fetchStartDetailsForRace(race.id, nums, 5);
      detailsByRace.set(race.id, map);
    })
  );

  const rawLegs = races.map((race, idx) =>
    analyzeLeg(
      race,
      idx + 1,
      horseMentions,
      detailsByRace.get(race.id) || new Map()
    )
  );

  const rowPriceKr = game.newBettingSystem ? 0.6 : 1;
  const fitted = fitLegsToBudget(
    rawLegs,
    rowPriceKr,
    V75_TIP_MIN_KR,
    V75_TIP_MAX_KR,
    V75_TIP_TARGET_KR
  );
  const legs = fitted.legs;

  const valueHorses = legs
    .flatMap((leg) =>
      leg.horses
        .filter((h) => h.valueEdgePct != null && h.valueEdgePct >= 3.5)
        .map((h) => ({
          leg: leg.leg,
          startNumber: h.startNumber,
          name: h.name,
          edgePct: h.valueEdgePct!,
          reason: h.reason,
        }))
    )
    .sort((a, b) => b.edgePct - a.edgePct)
    .slice(0, 10);

  const homeTrackHorses = legs
    .flatMap((leg) =>
      leg.horses
        .filter((h) => h.isHomeTrack)
        .map((h) => ({
          leg: leg.leg,
          startNumber: h.startNumber,
          name: h.name,
          note: h.homeNote || `Trivs/hemma på ${leg.trackName}`,
        }))
    )
    .slice(0, 16);

  const misleadingFavorites = legs
    .flatMap((leg) =>
      leg.horses
        .filter((h) => h.misleading)
        .map((h) => ({
          leg: leg.leg,
          startNumber: h.startNumber,
          name: h.name,
          note: h.misleading!,
        }))
    )
    .slice(0, 8);

  const classDropHorses = legs
    .flatMap((leg) =>
      leg.horses
        .filter((h) => h.classDrop?.dropped || h.classDrop?.note)
        .map((h) => ({
          leg: leg.leg,
          startNumber: h.startNumber,
          name: h.name,
          note: h.classDrop?.note || "Lättare uppgift än tidigare",
          dropped: !!h.classDrop?.dropped,
        }))
    )
    .sort((a, b) => Number(b.dropped) - Number(a.dropped))
    .slice(0, 12)
    .map(({ leg, startNumber, name, note }) => ({
      leg,
      startNumber,
      name,
      note,
    }));

  const highWinRateHorses = legs
    .flatMap((leg) =>
      leg.horses
        .filter((h) => h.highWinRate && h.winRatePct != null)
        .map((h) => ({
          leg: leg.leg,
          startNumber: h.startNumber,
          name: h.name,
          winRatePct: h.winRatePct!,
          edgePct: h.winRateEdgePct ?? 0,
          note:
            h.formNote ||
            `Seger% ${String(h.winRatePct).replace(".", ",")}% i fältet`,
        }))
    )
    .sort((a, b) => b.edgePct - a.edgePct)
    .slice(0, 12);

  const lowOddsReviews = legs
    .flatMap((leg) =>
      leg.horses
        .filter((h) => h.lowOddsReview?.isLowOdds && h.winOdds != null)
        .map((h) => ({
          leg: leg.leg,
          startNumber: h.startNumber,
          name: h.name,
          winOdds: h.winOdds!,
          supported: h.lowOddsReview?.supported ?? null,
          note: h.lowOddsReview?.note || "",
        }))
    )
    .sort((a, b) => a.winOdds - b.winOdds)
    .slice(0, 14);

  const trackNames = [
    ...new Set(legs.map((l) => l.trackName).filter(Boolean)),
  ];
  const couponLine = legs
    .map((l) => `V75-${l.leg}: ${l.pickLabel || "–"}`)
    .join(" · ");

  const pool = game.pools?.V75;
  const jackpot =
    pool?.jackpotAmount ??
    found.summary.jackpotAmount ??
    null;
  const estimated =
    found.summary.estimatedJackpot ?? null;

  return {
    generatedAt: new Date().toISOString(),
    gameId: game.id,
    playDate: found.date,
    playDateLabel: fmtDateLabel(found.date),
    status: game.status || found.summary.status,
    trackNames,
    startTime:
      found.summary.startTime ||
      legs[0]?.startTime ||
      null,
    turnoverKr: pool?.turnover ?? null,
    jackpotKr: jackpot,
    estimatedJackpotKr: estimated,
    rowPriceKr,
    tipRows: fitted.rows,
    tipCostKr: fitted.costKr,
    tipBudgetMinKr: V75_TIP_MIN_KR,
    tipBudgetMaxKr: V75_TIP_MAX_KR,
    atgUrl: `https://www.atg.se/spel/V75/${found.date}`,
    legs,
    couponLine,
    valueHorses,
    homeTrackHorses,
    misleadingFavorites,
    classDropHorses,
    highWinRateHorses,
    lowOddsReviews,
    externalSources: sources,
    headlineSignals,
    rules: [
      `Tippraden kostar ${V75_TIP_MIN_KR}–${V75_TIP_MAX_KR} kr (nu ${String(fitted.costKr).replace(".", ",")} kr · ${fitted.rows} rader × ${String(rowPriceKr).replace(".", ",")} kr).`,
      "ATG-data: vinnarodds, V75-streckprocent, form, hemma-bana och tidigare förstapris (klassnivå).",
      "Nergraderad = hästen kommer från lopp med tydligt högre förstapris än dagens.",
      "Högre seger% = klart över fältets median (karriärstatistik).",
      "Lågoddsare (@ ≤5,5) granskas mot seger%, form och klassdroppe – stödd eller svag.",
      "Överodds = modellchans högre än V75-procenten. Missvisande favorit = högt streck utan stöd.",
      "Externa tips: Travcash, Aftonbladet, Expressen, Sulkysport, Google News.",
      "Analys – ingen garanti. 18+ spelansvarsfullt.",
    ],
    disclaimer:
      "Analysverktyg för V75 – inga spelråd med garanti. Odds och streck ändras. 18+ spela ansvarsfullt.",
  };
}
