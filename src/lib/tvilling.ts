import {
  fetchAtgGame,
  fetchCalendarDay,
  fetchRace,
  fetchStartDetailsForRace,
  isAtgRaceFinished,
  type AtgGameSummary,
  type AtgRace,
} from "./atg";
import {
  applyDriverStrategyBoosts,
  applyDualDriverSignals,
  analyzeLeg,
  buildDriverStrategies,
  enrichStrategiesFromPreRaces,
  resolvePreRaces,
  type V75DayTip,
  type V75HorseTip,
  type V75LegAnalysis,
} from "./v75";
import { collectExternalAtgTips } from "./v75Tips";

export type TvillingHorseTip = V75HorseTip & {
  inTip: boolean;
  inBestPair: boolean;
};

export type TvillingRaceTip = Omit<V75LegAnalysis, "horses"> & {
  gameId: string;
  raceNumber: number;
  horses: TvillingHorseTip[];
  /** Bästa tvillingpar. */
  bestPair: [number, number];
  bestPairLabel: string;
  bestPairOdds: number | null;
  tipCombinations: number;
  tipCostKr: number;
};

export type TvillingDayTip = Omit<
  V75DayTip,
  | "product"
  | "gameId"
  | "status"
  | "turnoverKr"
  | "jackpotKr"
  | "estimatedJackpotKr"
  | "tipBudgetMinKr"
  | "tipBudgetMaxKr"
  | "legs"
  | "dualDriverSignals"
  | "driverStrategies"
> & {
  product: "tvilling";
  gameId: string | null;
  status: string;
  races: TvillingRaceTip[];
  dualDriverSignals: V75DayTip["dualDriverSignals"];
  driverStrategies: V75DayTip["driverStrategies"];
};

const ROW_PRICE_KR = 5;
const MAX_RACES = 8;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDateLabel(isoDate: string): string {
  try {
    return new Date(isoDate + "T12:00:00").toLocaleDateString("sv-SE", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return isoDate;
  }
}

/** ATG comboOdds: triangel index [hi-1][lo-1] för hi > lo. */
export function tvillingComboOdds(
  comboOdds: number[][] | undefined,
  a: number,
  b: number
): number | null {
  if (!comboOdds?.length || a === b) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const row = comboOdds[hi - 1];
  if (!row) return null;
  const raw = row[lo - 1];
  if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw >= 99990) {
    return null;
  }
  return Math.round((raw / 100) * 100) / 100;
}

type CalGame = AtgGameSummary & {
  races?: string[];
  tracks?: number[];
};

async function findUpcomingTvillingBatch(): Promise<{
  date: string;
  games: CalGame[];
  trackNames: string[];
}> {
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  type Cand = {
    date: string;
    game: CalGame;
    rank: number;
    start: string;
    trackId: number | null;
  };
  const cands: Cand[] = [];

  for (let offset = 0; offset <= 5; offset++) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + offset);
    const date = ymd(day);
    try {
      const cal = await fetchCalendarDay(date);
      const list = (cal.games?.tvilling || []) as CalGame[];
      for (const g of list) {
        const status = String(g.status || "").toLowerCase();
        if (status !== "bettable" && status !== "upcoming") continue;
        const rank = status === "bettable" ? 0 : 1;
        cands.push({
          date,
          game: g,
          rank,
          start: g.startTime || g.scheduledStartTime || date,
          trackId: g.tracks?.[0] ?? null,
        });
      }
      if (cands.some((c) => c.rank === 0 && c.date === date)) break;
    } catch {
      /* skip */
    }
  }

  if (!cands.length) {
    throw new Error("Ingen öppen Tvilling-omgång hittades hos ATG just nu.");
  }

  cands.sort(
    (a, b) => a.rank - b.rank || a.start.localeCompare(b.start)
  );

  const byTrack = new Map<number, Cand[]>();
  for (const c of cands.filter((x) => x.rank === 0)) {
    const tid = c.trackId ?? -1;
    const list = byTrack.get(tid) || [];
    list.push(c);
    byTrack.set(tid, list);
  }
  let bestTrack = -1;
  let bestCount = 0;
  for (const [tid, list] of byTrack) {
    if (list.length > bestCount) {
      bestCount = list.length;
      bestTrack = tid;
    }
  }
  const pool =
    bestTrack !== -1
      ? (byTrack.get(bestTrack) || []).slice(0, MAX_RACES)
      : cands.slice(0, MAX_RACES);

  const date = pool[0]!.date;
  let trackNames: string[] = [];
  try {
    const cal = await fetchCalendarDay(date);
    const names = new Set<string>();
    for (const c of pool) {
      const tid = c.trackId;
      const track = (cal.tracks || []).find((t) => t.id === tid);
      if (track?.name) names.add(track.name);
    }
    trackNames = [...names];
  } catch {
    trackNames = [];
  }

  return { date, games: pool.map((p) => p.game), trackNames };
}

function pickBestPair(
  horses: TvillingHorseTip[],
  pickNumbers: number[],
  comboOdds: number[][] | undefined
): {
  bestPair: [number, number];
  bestPairOdds: number | null;
  bestPairLabel: string;
} {
  const tipSet = new Set(pickNumbers);
  const pool =
    horses.filter((h) => tipSet.has(h.startNumber)).length >= 2
      ? horses.filter((h) => tipSet.has(h.startNumber))
      : horses.slice(0, Math.min(4, horses.length));

  let bestPair: [number, number] = [
    pool[0]?.startNumber || 1,
    pool[1]?.startNumber || 2,
  ];
  let bestPairOdds: number | null = null;
  let bestScore = -1;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!;
      const b = pool[j]!;
      const odds = tvillingComboOdds(comboOdds, a.startNumber, b.startNumber);
      const pairScore =
        a.score +
        b.score +
        (odds != null ? Math.max(0, 8 - Math.log10(Math.max(odds, 1.5))) : 0) +
        (a.role === "spik" || b.role === "spik" ? 1.5 : 0);
      if (pairScore > bestScore) {
        bestScore = pairScore;
        bestPair = [a.startNumber, b.startNumber];
        bestPairOdds = odds;
      }
    }
  }

  const pairNames = bestPair
    .map((n) => horses.find((h) => h.startNumber === n)?.name || `#${n}`)
    .join(" + ");

  return {
    bestPair,
    bestPairOdds,
    bestPairLabel: `${bestPair[0]}-${bestPair[1]} (${pairNames})`,
  };
}

function toTvillingRace(
  leg: V75LegAnalysis,
  gameId: string,
  raceNumber: number,
  comboOdds: number[][] | undefined,
  rowPriceKr: number
): TvillingRaceTip {
  // Behåll V75-analysens picks men max 3 för tvilling-system
  let pickNumbers = [...leg.pickNumbers].sort((a, b) => a - b);
  if (pickNumbers.length > 3) {
    const ranked = [...leg.horses]
      .filter((h) => pickNumbers.includes(h.startNumber))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    pickNumbers = ranked.map((h) => h.startNumber).sort((a, b) => a - b);
  }
  if (pickNumbers.length < 2) {
    const ranked = [...leg.horses].sort((a, b) => b.score - a.score);
    pickNumbers = ranked
      .slice(0, Math.min(2, ranked.length))
      .map((h) => h.startNumber)
      .sort((a, b) => a - b);
  }

  const tipSet = new Set(pickNumbers);
  const pairInfo = pickBestPair(
    leg.horses.map((h) => ({
      ...h,
      inTip: tipSet.has(h.startNumber),
      inBestPair: false,
    })),
    pickNumbers,
    comboOdds
  );
  const pairSet = new Set(pairInfo.bestPair);

  const horses: TvillingHorseTip[] = leg.horses.map((h) => ({
    ...h,
    inTip: tipSet.has(h.startNumber),
    inBestPair: pairSet.has(h.startNumber),
  }));

  const tipCombinations =
    pickNumbers.length < 2
      ? 0
      : (pickNumbers.length * (pickNumbers.length - 1)) / 2;
  const tipCostKr = Math.round(tipCombinations * rowPriceKr * 100) / 100;

  return {
    ...leg,
    leg: raceNumber,
    gameId,
    raceNumber,
    horses,
    pickNumbers,
    pickLabel: pickNumbers.join(","),
    bestPair: pairInfo.bestPair,
    bestPairLabel: pairInfo.bestPairLabel,
    bestPairOdds: pairInfo.bestPairOdds,
    tipCombinations,
    tipCostKr,
    summary:
      pickNumbers.length >= 2
        ? `${leg.openness === "spikläge" ? "Spikläge" : leg.openness === "halvöppet" ? "Halvöppet" : "Vidöppet"} · Tvilling ${pickNumbers.join("-")} · bäst par ${pairInfo.bestPair[0]}-${pairInfo.bestPair[1]}` +
          (pairInfo.bestPairOdds != null
            ? ` @ ${String(pairInfo.bestPairOdds).replace(".", ",")}`
            : "")
        : leg.summary,
  };
}

export async function buildTvillingDayTip(): Promise<TvillingDayTip> {
  const { date, games, trackNames: initialTracks } = await findUpcomingTvillingBatch();
  const rowPriceKr = ROW_PRICE_KR;

  type Loaded = {
    summary: CalGame;
    race: AtgRace;
    gameId: string;
    comboOdds: number[][] | undefined;
    rowPrice: number;
  };
  const loaded: Loaded[] = [];

  await Promise.all(
    games.map(async (summary) => {
      try {
        const game = await fetchAtgGame(summary.id);
        const race = (game.races || [])[0];
        if (!race) return;
        const comboOdds = (
          game.pools as { tvilling?: { comboOdds?: number[][] } } | undefined
        )?.tvilling?.comboOdds;
        loaded.push({
          summary,
          race,
          gameId: game.id,
          comboOdds,
          rowPrice: game.newBettingSystem ? 5 : rowPriceKr,
        });
      } catch {
        /* skip */
      }
    })
  );

  loaded.sort(
    (a, b) =>
      (a.race.startTime || "").localeCompare(b.race.startTime || "") ||
      a.race.number - b.race.number
  );

  if (!loaded.length) {
    throw new Error("Kunde inte analysera några Tvilling-lopp just nu.");
  }

  const racesOnly = loaded.map((l) => l.race);

  const horseIndex: Array<{ name: string; number: number; leg: number }> = [];
  for (const race of racesOnly) {
    for (const s of race.starts || []) {
      if (s.scratched) continue;
      horseIndex.push({
        name: s.horse.name,
        number: s.number,
        leg: race.number,
      });
    }
  }

  const { mentions, sources } = await collectExternalAtgTips(
    "Tvilling",
    horseIndex
  );
  const horseMentions = mentions.filter((m) => m.horseName);
  const headlineSignals = mentions
    .filter((m) => !m.horseName && m.snippet)
    .slice(0, 12);

  const detailsByRace = new Map<string, Map<number, import("./atg").AtgStartDetail>>();
  await Promise.all(
    racesOnly.map(async (race) => {
      const nums = (race.starts || [])
        .filter((s) => !s.scratched)
        .map((s) => s.number);
      const map = await fetchStartDetailsForRace(race.id, nums, 5);
      detailsByRace.set(race.id, map);
    })
  );

  // Samma analysmotor som V75/V64 (leg = loppnummer)
  const rawLegs = racesOnly.map((race) =>
    analyzeLeg(
      race,
      race.number,
      horseMentions,
      detailsByRace.get(race.id) || new Map(),
      "Tvilling"
    )
  );

  const {
    preRaces,
    preRacesDone,
    tipsActivated,
    tipsPhaseNote,
  } = await resolvePreRaces(date, racesOnly);

  const driverStrategies = buildDriverStrategies(rawLegs, "Tvilling");
  if (preRaces.some((r) => r.finished)) {
    await enrichStrategiesFromPreRaces(driverStrategies, preRaces);
  }

  const dualDriverSignals = applyDualDriverSignals(
    rawLegs,
    "Tvilling",
    tipsActivated
  );
  if (tipsActivated) {
    applyDriverStrategyBoosts(rawLegs, driverStrategies, "Tvilling");
  }

  // Om tippboostar ändrat score – bygg om picks med samma analys
  const boostedLegs = tipsActivated
    ? racesOnly.map((race) => {
        const existing = rawLegs.find((l) => l.raceId === race.id);
        // Re-run pick logic is already in analyzeLeg; boosts mutated horse scores
        // so re-select picks from boosted horses
        if (!existing) return analyzeLeg(race, race.number, horseMentions, detailsByRace.get(race.id) || new Map(), "Tvilling");
        const ranked = [...existing.horses].sort((a, b) => b.score - a.score);
        const leaderOdds = ranked[0]?.winOdds ?? 99;
        const maxPicks = leaderOdds <= 3.2 ? 2 : 3;
        const picks: typeof ranked = [];
        if (ranked[0]) {
          if (ranked[0].role === "skip") ranked[0].role = "gardering";
          picks.push(ranked[0]);
        }
        for (const h of ranked.slice(1)) {
          if (picks.length >= maxPicks) break;
          if (
            h.role === "spik" ||
            h.role === "gardering" ||
            h.role === "skräll" ||
            h.classDrop?.dropped ||
            h.highWinRate ||
            h.dualDriverLongshot ||
            (h.valueEdgePct != null && h.valueEdgePct >= 5)
          ) {
            if (h.role === "skip") h.role = "gardering";
            picks.push(h);
          }
        }
        while (picks.length < Math.min(2, ranked.length)) {
          const next = ranked.find((h) => !picks.includes(h));
          if (!next) break;
          if (next.role === "skip") next.role = "gardering";
          picks.push(next);
        }
        picks.sort((a, b) => a.startNumber - b.startNumber);
        const pickNumbers = picks.map((p) => p.startNumber);
        return {
          ...existing,
          pickNumbers,
          pickLabel: pickNumbers.join(","),
        };
      })
    : rawLegs;

  const races: TvillingRaceTip[] = boostedLegs.map((leg) => {
    const src = loaded.find((l) => l.race.id === leg.raceId)!;
    return toTvillingRace(
      leg,
      src.gameId,
      src.race.number,
      src.comboOdds,
      src.rowPrice
    );
  });

  const tipRows = races.reduce((s, r) => s + r.tipCombinations, 0);
  const tipCostKr =
    Math.round(races.reduce((s, r) => s + r.tipCostKr, 0) * 100) / 100;
  const tipsStreck = races.map((r) => String(r.pickNumbers.length)).join("-");
  const couponLine = races
    .map(
      (r) =>
        `L${r.raceNumber}: ${r.pickLabel || "–"} (par ${r.bestPair[0]}-${r.bestPair[1]})`
    )
    .join(" · ");

  const trackNames = [
    ...new Set(
      [...initialTracks, ...races.map((r) => r.trackName)].filter(Boolean)
    ),
  ];

  const valueHorses = races
    .flatMap((race) =>
      race.horses
        .filter((h) => h.valueEdgePct != null && h.valueEdgePct >= 3.5)
        .map((h) => ({
          leg: race.raceNumber,
          startNumber: h.startNumber,
          name: h.name,
          edgePct: h.valueEdgePct!,
          reason: h.reason,
        }))
    )
    .sort((a, b) => b.edgePct - a.edgePct)
    .slice(0, 10);

  const homeTrackHorses = races
    .flatMap((race) =>
      race.horses
        .filter((h) => h.isHomeTrack)
        .map((h) => ({
          leg: race.raceNumber,
          startNumber: h.startNumber,
          name: h.name,
          note: h.homeNote || `Trivs/hemma på ${race.trackName}`,
        }))
    )
    .slice(0, 16);

  const misleadingFavorites = races
    .flatMap((race) =>
      race.horses
        .filter((h) => h.misleading)
        .map((h) => ({
          leg: race.raceNumber,
          startNumber: h.startNumber,
          name: h.name,
          note: h.misleading!,
        }))
    )
    .slice(0, 8);

  const classDropHorses = races
    .flatMap((race) =>
      race.horses
        .filter((h) => h.classDrop?.dropped || h.classDrop?.note)
        .map((h) => ({
          leg: race.raceNumber,
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

  const highWinRateHorses = races
    .flatMap((race) =>
      race.horses
        .filter((h) => h.highWinRate && h.winRatePct != null)
        .map((h) => ({
          leg: race.raceNumber,
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

  const lowOddsReviews = races
    .flatMap((race) =>
      race.horses
        .filter((h) => h.lowOddsReview?.isLowOdds && h.winOdds != null)
        .map((h) => ({
          leg: race.raceNumber,
          startNumber: h.startNumber,
          name: h.name,
          winOdds: h.winOdds!,
          supported: h.lowOddsReview?.supported ?? null,
          note: h.lowOddsReview?.note || "",
        }))
    )
    .sort((a, b) => a.winOdds - b.winOdds)
    .slice(0, 14);

  return {
    generatedAt: new Date().toISOString(),
    product: "tvilling",
    gameId: loaded[0]?.gameId || null,
    playDate: date,
    playDateLabel: fmtDateLabel(date),
    status: loaded[0]?.summary.status || "bettable",
    trackNames,
    startTime: races[0]?.startTime || null,
    rowPriceKr,
    tipRows,
    tipCostKr,
    tipsStreck,
    tipsStreckLabel: `TS ${tipsStreck}`,
    couponLine,
    atgUrl: `https://www.atg.se/spel/tvilling/${date}`,
    races,
    valueHorses,
    homeTrackHorses,
    misleadingFavorites,
    classDropHorses,
    highWinRateHorses,
    lowOddsReviews,
    dualDriverSignals,
    driverStrategies,
    preRaces,
    preRacesDone,
    tipsActivated,
    tipsPhase: tipsActivated ? "aktiv" : "forhands",
    tipsPhaseNote,
    externalSources: sources,
    headlineSignals,
    rules: [
      tipsActivated
        ? `Riktiga tips aktiva (förelopp klara). ${`TS ${tipsStreck}`} · ${String(tipCostKr).replace(".", ",")} kr.`
        : `Förhandstips – TS ${tipsStreck} visas nu; tippboostar aktiveras efter föreloppen.`,
      "Tvilling = två hästar i målordning 1–2 (valfri ordning). Tips: 2–3 hästar per lopp.",
      "Samma analysmotor som V75/V64: odds, form, hemma, klassdroppe, lågoddsgranskning, kuskstrategi, förelopp och externa tips.",
      "TS = tipsstreck (antal hästar per lopp). Bästa par = högst poäng bland tipphästar (inkl. kombinationsodds).",
      "Nergraderad = hästen kommer från lopp med tydligt högre förstapris än dagens.",
      "Dubbelkusk = kusk i exakt två Tvilling-lopp; fokus på hästen med högst vinnarodds.",
      "Externa tips: Travcash, Aftonbladet, Expressen, Sulkysport, Google News.",
      "Analys – ingen garanti. 18+ spelansvarsfullt.",
    ],
    disclaimer:
      "Analysverktyg för Tvilling – samma motor som V75/V64. Inga spelråd med garanti. Odds ändras. 18+ spela ansvarsfullt.",
  };
}

/** Settla ett tvillingtips mot ATG-resultat (1:a och 2:a). */
export async function settleTvillingRacePick(args: {
  raceId: string;
  pickNumbers: number[];
}): Promise<{
  status: "won" | "lost" | "live" | "pending";
  actual: string | null;
  note: string;
}> {
  const race = await fetchRace(args.raceId);
  if (!race) {
    return { status: "pending", actual: null, note: "Väntar på ATG…" };
  }
  if (!isAtgRaceFinished(race.status)) {
    return { status: "live", actual: null, note: "Loppet pågår / väntar…" };
  }
  const placed: Array<{ n: number; place: number; name: string }> = [];
  for (const s of race.starts || []) {
    if (s.scratched) continue;
    const placeRaw = s.result?.place;
    const place =
      typeof placeRaw === "number"
        ? placeRaw
        : placeRaw != null
          ? Number(placeRaw)
          : null;
    if (place === 1 || place === 2) {
      placed.push({
        n: s.number,
        place,
        name: s.horse?.name || `#${s.number}`,
      });
    }
  }
  const first = placed.find((p) => p.place === 1);
  const second = placed.find((p) => p.place === 2);
  if (!first || !second) {
    return { status: "pending", actual: null, note: "Saknar 1–2 plats…" };
  }
  const set = new Set(args.pickNumbers);
  const hit = set.has(first.n) && set.has(second.n);
  const actual = `#${first.n}+#${second.n} (${first.name} / ${second.name})`;
  return {
    status: hit ? "won" : "lost",
    actual,
    note: hit
      ? `Rätt tvilling · ${actual}`
      : `Fel · blev ${actual} (tipset ${args.pickNumbers.join(",")})`,
  };
}
