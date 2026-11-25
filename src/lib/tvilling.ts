import {
  atgOddsToDecimal,
  fetchAtgGame,
  fetchCalendarDay,
  fetchRace,
  fetchStartDetailsForRace,
  isAtgRaceFinished,
  personName,
  type AtgGameSummary,
  type AtgRace,
  type AtgStart,
  type AtgStartDetail,
} from "./atg";

export type TvillingHorseTip = {
  startNumber: number;
  name: string;
  driver: string;
  winOdds: number | null;
  winRatePct: number | null;
  isHomeTrack: boolean;
  score: number;
  reason: string;
  inTip: boolean;
  inBestPair: boolean;
};

export type TvillingRaceTip = {
  raceId: string;
  gameId: string;
  raceNumber: number;
  raceName: string;
  trackName: string;
  trackId: number | null;
  startTime: string | null;
  status: string;
  horses: TvillingHorseTip[];
  /** Tipphästar (startnr) – 2–3 st. */
  pickNumbers: number[];
  pickLabel: string;
  /** Bästa tvillingpar. */
  bestPair: [number, number];
  bestPairLabel: string;
  bestPairOdds: number | null;
  tipCombinations: number;
  tipCostKr: number;
  summary: string;
};

export type TvillingDayTip = {
  generatedAt: string;
  product: "tvilling";
  playDate: string;
  playDateLabel: string;
  trackNames: string[];
  startTime: string | null;
  rowPriceKr: number;
  tipRows: number;
  tipCostKr: number;
  tipsStreck: string;
  tipsStreckLabel: string;
  couponLine: string;
  atgUrl: string;
  races: TvillingRaceTip[];
  rules: string[];
  disclaimer: string;
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

function winPct(start: AtgStart): number | null {
  const life = start.horse.statistics?.life?.winPercentage;
  if (life != null && Number.isFinite(life)) {
    return life > 100 ? Math.round((life / 100) * 10) / 10 : life;
  }
  const years = start.horse.statistics?.years || {};
  const y2026 = years["2026"]?.winPercentage;
  if (y2026 != null && Number.isFinite(y2026)) {
    return y2026 > 100 ? Math.round((y2026 / 100) * 10) / 10 : y2026;
  }
  return null;
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

function scoreHorse(
  start: AtgStart,
  trackId: number | null,
  detail: AtgStartDetail | null
): TvillingHorseTip {
  const winOdds = atgOddsToDecimal(start.pools?.vinnare?.odds);
  const wr = winPct(start);
  const home =
    trackId != null && start.horse.homeTrack?.id === trackId;
  let score = 0;
  const reasons: string[] = [];

  if (winOdds != null && winOdds > 1 && winOdds < 80) {
    score += Math.max(0, 22 - winOdds * 1.1);
    reasons.push(`vinnarodds ${String(winOdds).replace(".", ",")}`);
  }
  if (wr != null) {
    score += Math.min(12, wr / 4);
    reasons.push(`seger% ${String(wr).replace(".", ",")}`);
  }
  if (home) {
    score += 2.2;
    reasons.push("hemma");
  }
  const driverHome = trackId != null && start.driver?.homeTrack?.id === trackId;
  if (driverHome) {
    score += 0.8;
    reasons.push("kusk hemma");
  }
  // Platsstatistik hjälper tvilling (1–2)
  const placeRaw = start.horse.statistics?.life?.placePercentage;
  if (placeRaw != null && Number.isFinite(placeRaw)) {
    const placePct = placeRaw > 100 ? placeRaw / 100 : placeRaw;
    score += Math.min(8, placePct / 8);
  }
  if (detail?.horse?.results?.records?.length) {
    score += 0.4;
  }

  return {
    startNumber: start.number,
    name: start.horse.name,
    driver: personName(start.driver),
    winOdds,
    winRatePct: wr,
    isHomeTrack: home,
    score: Math.round(score * 10) / 10,
    reason: reasons.join(" · ") || "fältet",
    inTip: false,
    inBestPair: false,
  };
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

  // Prefer one Swedish track cluster (most races soon)
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

function analyzeTvillingRace(
  race: AtgRace,
  gameId: string,
  comboOdds: number[][] | undefined,
  details: Map<number, AtgStartDetail>,
  rowPriceKr: number
): TvillingRaceTip {
  const trackName = race.track?.name || "Okänd bana";
  const trackId = race.track?.id ?? null;
  const starts = (race.starts || []).filter((s) => !s.scratched);
  const horses = starts
    .map((s) => scoreHorse(s, trackId, details.get(s.number) || null))
    .sort((a, b) => b.score - a.score);

  const leaderOdds = horses[0]?.winOdds ?? 99;
  const pickCount = leaderOdds <= 3.2 ? 2 : leaderOdds <= 6 ? 3 : 3;
  const picks = horses.slice(0, Math.min(pickCount, horses.length));
  for (const h of picks) h.inTip = true;
  const pickNumbers = picks.map((h) => h.startNumber);

  // Best pair among tip horses (or top 4 scored)
  const poolForPair = horses.slice(0, Math.min(4, horses.length));
  let bestPair: [number, number] = [
    poolForPair[0]?.startNumber || 1,
    poolForPair[1]?.startNumber || 2,
  ];
  let bestPairOdds: number | null = null;
  let bestScore = -1;
  for (let i = 0; i < poolForPair.length; i++) {
    for (let j = i + 1; j < poolForPair.length; j++) {
      const a = poolForPair[i]!;
      const b = poolForPair[j]!;
      const odds = tvillingComboOdds(comboOdds, a.startNumber, b.startNumber);
      const pairScore =
        a.score +
        b.score +
        (odds != null ? Math.max(0, 8 - Math.log10(Math.max(odds, 1.5))) : 0);
      if (pairScore > bestScore) {
        bestScore = pairScore;
        bestPair = [a.startNumber, b.startNumber];
        bestPairOdds = odds;
      }
    }
  }
  for (const h of horses) {
    h.inBestPair = bestPair.includes(h.startNumber);
  }

  const tipCombinations =
    pickNumbers.length < 2
      ? 0
      : (pickNumbers.length * (pickNumbers.length - 1)) / 2;
  const tipCostKr = Math.round(tipCombinations * rowPriceKr * 100) / 100;
  const pairNames = bestPair
    .map((n) => horses.find((h) => h.startNumber === n)?.name || `#${n}`)
    .join(" + ");

  return {
    raceId: race.id,
    gameId,
    raceNumber: race.number,
    raceName: race.name || `Lopp ${race.number}`,
    trackName,
    trackId,
    startTime: race.startTime || race.scheduledStartTime || null,
    status: race.status || "unknown",
    horses,
    pickNumbers,
    pickLabel: pickNumbers.join(","),
    bestPair,
    bestPairLabel: `${bestPair[0]}-${bestPair[1]} (${pairNames})`,
    bestPairOdds,
    tipCombinations,
    tipCostKr,
    summary:
      pickNumbers.length >= 2
        ? `Tvilling ${pickNumbers.join("-")} · bäst par ${bestPair[0]}-${bestPair[1]}` +
          (bestPairOdds != null
            ? ` @ ${String(bestPairOdds).replace(".", ",")}`
            : "")
        : "För tunt fält",
  };
}

export async function buildTvillingDayTip(): Promise<TvillingDayTip> {
  const { date, games, trackNames } = await findUpcomingTvillingBatch();
  const rowPriceKr = ROW_PRICE_KR;

  const races: TvillingRaceTip[] = [];
  await Promise.all(
    games.map(async (summary) => {
      try {
        const game = await fetchAtgGame(summary.id);
        const race = (game.races || [])[0];
        if (!race) return;
        const comboOdds = (
          game.pools as { tvilling?: { comboOdds?: number[][] } } | undefined
        )?.tvilling?.comboOdds;
        const nums = (race.starts || [])
          .filter((s) => !s.scratched)
          .map((s) => s.number);
        const details = await fetchStartDetailsForRace(race.id, nums, 4);
        races.push(
          analyzeTvillingRace(
            race,
            game.id,
            comboOdds,
            details,
            game.newBettingSystem ? 5 : rowPriceKr
          )
        );
      } catch {
        /* skip race */
      }
    })
  );

  races.sort(
    (a, b) =>
      (a.startTime || "").localeCompare(b.startTime || "") ||
      a.raceNumber - b.raceNumber
  );

  if (!races.length) {
    throw new Error("Kunde inte analysera några Tvilling-lopp just nu.");
  }

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

  return {
    generatedAt: new Date().toISOString(),
    product: "tvilling",
    playDate: date,
    playDateLabel: fmtDateLabel(date),
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
    rules: [
      "Tvilling = två hästar i målordning 1–2 (valfri ordning).",
      `Tips: 2–3 hästar per lopp (system). Radpris ca ${String(rowPriceKr).replace(".", ",")} kr per kombination.`,
      "Bästa par = högst poäng bland toppade hästar (odds + form + hemma).",
      "ATG-data: vinnarodds, seger%/plats%, hemma-bana och kombinationsodds.",
      "Analys – ingen garanti. 18+ spela ansvarsfullt.",
    ],
    disclaimer:
      "Analysverktyg för Tvilling – inga spelråd med garanti. Odds ändras. 18+ spela ansvarsfullt.",
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
