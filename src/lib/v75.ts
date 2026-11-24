import {
  atgDistToPct,
  atgOddsToDecimal,
  fetchV75Game,
  findUpcomingV75,
  personName,
  type AtgGame,
  type AtgRace,
  type AtgStart,
} from "./atg";
import {
  collectExternalV75Tips,
  type ExternalTipMention,
  type TipSourceReport,
} from "./v75Tips";

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
  externalSources: TipSourceReport[];
  headlineSignals: ExternalTipMention[];
  rules: string[];
  disclaimer: string;
};

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

function analyzeHorse(
  start: AtgStart,
  leg: number,
  trackId: number | null,
  trackName: string,
  mentions: ExternalTipMention[]
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
  if (consensus === "fade" && v75Pct != null && v75Pct >= 20) {
    misleading =
      (misleading ? misleading + " " : "") +
      "Externa tips varnar / tonar ner favoriten.";
  }

  // Ranking: poolfavoriter först, värde/tips lyfter garderingar utan att sparka bort bankar
  let score = (v75Pct ?? 0) * 0.6 + model * 0.35;
  if (valueEdgePct != null && valueEdgePct > 0) {
    score += Math.min(valueEdgePct, 10) * 0.25;
  }
  if (home.horse) score += 1.2;
  if (misleading) score -= 6;
  if (horseMentions.some((m) => m.sentiment === "hot")) score += 2.5;
  if (horseMentions.some((m) => m.sentiment === "fade")) score -= 2;

  let role: V75HorseTip["role"] = "skip";
  const reasons: string[] = [];

  if (v75Pct != null && v75Pct >= 32 && !misleading) {
    role = "spik";
    reasons.push(
      `tung favorit i poolen (${v75Pct.toFixed(1).replace(".", ",")}%)`
    );
  } else if (
    valueEdgePct != null &&
    valueEdgePct >= 5 &&
    (impliedWinPct == null || impliedWinPct >= 6)
  ) {
    role = "skräll";
    reasons.push(
      `överodds/värde: modell ${model
        .toFixed(1)
        .replace(".", ",")}% vs V75 ${String(v75Pct ?? "–").replace(".", ",")}%)`
    );
  } else if (
    (v75Pct != null && v75Pct >= 14) ||
    (consensus === "hot" && (v75Pct ?? 0) >= 8) ||
    (consensus === "value" && (v75Pct ?? 0) >= 6)
  ) {
    role = "gardering";
    reasons.push("hålls med som gardering");
  }

  if (home.note) reasons.push(home.note);
  if (winOdds != null)
    reasons.push(`vinnarodds ${winOdds.toFixed(2).replace(".", ",")}`);
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
  allMentions: ExternalTipMention[]
): V75LegAnalysis {
  const trackName = race.track?.name || "Okänd bana";
  const trackId = race.track?.id ?? null;
  const starts = (race.starts || []).filter((s) => !s.scratched);
  const horses = starts
    .map((s) => analyzeHorse(s, leg, trackId, trackName, allMentions))
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

  const legs = races.map((race, idx) =>
    analyzeLeg(race, idx + 1, horseMentions)
  );

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
    rowPriceKr: game.newBettingSystem ? 0.6 : 1,
    atgUrl: `https://www.atg.se/spel/V75/${found.date}`,
    legs,
    couponLine,
    valueHorses,
    homeTrackHorses,
    misleadingFavorites,
    externalSources: sources,
    headlineSignals,
    rules: [
      "ATG-data: vinnarodds, V75-streckprocent, form och hemma-bana (häst/tränare/kusk).",
      "Överodds = modellchans högre än V75-procenten (folkets streck).",
      "Missvisande favorit = högt streck men svagare odds/form eller tippsajter som varnar.",
      "Externa tips: Travcash, Aftonbladet, Expressen, Sulkysport, Google News (fri text där det går).",
      "Radpris på nya V75: 0,60 kr. Analys – ingen garanti. 18+ spelansvarsfullt.",
    ],
    disclaimer:
      "Analysverktyg för V75 – inga spelråd med garanti. Odds och streck ändras. 18+ spela ansvarsfullt.",
  };
}
