import { isFreshFetch, upstreamFetchInit } from "./fetch-mode";
import {
  parseDistribution,
  parseOdds,
  type ProductKind,
  type RawDraw,
  type RawEvent,
} from "./svenskaspel";
import type { Outcome, TeamInfo } from "./types";
import { analyzeValueOdds } from "./valueOdds";

export type MistakeKind =
  | "fav_failed"
  | "x_surprise"
  | "longshot_hit"
  | "folk_wrong"
  | "overodds_missed"
  | "overodds_worked"
  | "narrow_miss";

export type MatchLesson = {
  drawNumber: number;
  product: "powerplay" | "topptipset";
  eventNumber: number;
  description: string;
  league: string;
  home: string;
  away: string;
  actual: Outcome;
  modelPick: Outcome[];
  oddsFavourite: Outcome;
  folkFavourite: Outcome;
  startOdds: { one: number | null; x: number | null; two: number | null };
  kinds: MistakeKind[];
  whyWrong: string;
  nextAspect: string;
  hit: boolean;
};

export type TeamAspect = {
  team: string;
  note: string;
  /** Soft score deltas when this team appears next */
  d1: number;
  dX: number;
  d2: number;
  asHome: boolean | null;
  fromDraw: number;
  kind: MistakeKind;
};

export type LearningMemory = {
  product: "powerplay" | "topptipset";
  updatedAt: string;
  drawsAnalyzed: number[];
  lessons: MatchLesson[];
  /** Senaste omgångens missar – för UI */
  lastRoundSummary: string[];
  teamAspects: TeamAspect[];
  /** Globala bias från senaste N omgångar */
  biases: {
    boostX: number;
    cutShortFavourite: number;
    trustOverOdds: number;
    distrustFolkFavourite: number;
    note: string;
  };
};

type CacheEntry = { at: number; memory: LearningMemory };

const memoryCache = new Map<string, CacheEntry>();
const CACHE_MS = 10 * 60 * 1000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(
    url,
    upstreamFetchInit({
      headers: {
        Accept: "application/json",
        "User-Agent": "MikaelsTips/1.0",
      },
      next: { revalidate: 300 },
    })
  );
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function parseSv(v: string | undefined | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function favouriteFromOdds(odds: {
  one: number | null;
  x: number | null;
  two: number | null;
}): Outcome {
  const entries: [Outcome, number][] = [];
  if (odds.one != null) entries.push(["1", odds.one]);
  if (odds.x != null) entries.push(["X", odds.x]);
  if (odds.two != null) entries.push(["2", odds.two]);
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0]?.[0] ?? "1";
}

function favouriteFromFolk(dist: {
  one: number;
  x: number;
  two: number;
}): Outcome {
  const entries: [Outcome, number][] = [
    ["1", dist.one],
    ["X", dist.x],
    ["2", dist.two],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/** Enkel retrospektiv modellpick (odds+folk), samma bas som live utan kontext. */
function retrospectivePick(event: RawEvent): {
  pick: Outcome[];
  odds: ReturnType<typeof parseOdds>;
  dist: ReturnType<typeof parseDistribution>;
  oddsFav: Outcome;
  folkFav: Outcome;
} {
  const odds = parseOdds(event.startOdds || event.odds);
  const dist = parseDistribution(event.svenskaFolket);
  const p1 = (odds.one && odds.one > 1 ? 1 / odds.one : 0) || dist.one / 100;
  const pX = (odds.x && odds.x > 1 ? 1 / odds.x : 0) || dist.x / 100;
  const p2 = (odds.two && odds.two > 1 ? 1 / odds.two : 0) || dist.two / 100;
  let s1 = p1 * 0.55 + (dist.one / 100) * 0.45;
  let sX = pX * 0.55 + (dist.x / 100) * 0.45;
  let s2 = p2 * 0.55 + (dist.two / 100) * 0.45;
  const value = analyzeValueOdds({
    odds,
    dist,
  });
  for (const ov of value.outcomes) {
    if (ov.outcome === "1") s1 += ov.scoreBoost;
    if (ov.outcome === "X") sX += ov.scoreBoost;
    if (ov.outcome === "2") s2 += ov.scoreBoost;
  }
  const sum = Math.max(s1 + sX + s2, 0.01);
  s1 /= sum;
  sX /= sum;
  s2 /= sum;
  const ranked = [
    { o: "1" as Outcome, s: s1 },
    { o: "X" as Outcome, s: sX },
    { o: "2" as Outcome, s: s2 },
  ].sort((a, b) => b.s - a.s);
  let pick: Outcome[] = [ranked[0].o];
  if (ranked[0].s - ranked[1].s < 0.12 && ranked[1].s > 0.22) {
    pick = [ranked[0].o, ranked[1].o];
  }
  if (value.overOddsOutcomes.length) {
    for (const o of value.overOddsOutcomes) {
      if (!pick.includes(o) && pick.length < 2) pick.push(o);
    }
  }
  const order: Outcome[] = ["1", "X", "2"];
  pick = order.filter((o) => pick.includes(o));
  return {
    pick,
    odds,
    dist,
    oddsFav: favouriteFromOdds(odds),
    folkFav: favouriteFromFolk(dist),
  };
}

function classifyLesson(
  actual: Outcome,
  model: ReturnType<typeof retrospectivePick>,
  home: string,
  away: string
): Omit<MatchLesson, "drawNumber" | "product" | "eventNumber" | "description" | "league"> {
  const hit = model.pick.includes(actual);
  const kinds: MistakeKind[] = [];
  const why: string[] = [];
  const next: string[] = [];

  const winOdds =
    actual === "1"
      ? model.odds.one
      : actual === "X"
        ? model.odds.x
        : model.odds.two;

  if (hit) {
    if (model.oddsFav !== actual && model.pick.includes(actual)) {
      kinds.push("overodds_worked");
      why.push(`träffade ${actual} mot oddsfavorit ${model.oddsFav}`);
    }
    return {
      home,
      away,
      actual,
      modelPick: model.pick,
      oddsFavourite: model.oddsFav,
      folkFavourite: model.folkFav,
      startOdds: model.odds,
      kinds,
      whyWrong: why.join(". ") || "tipset höll",
      nextAspect: `${home}/${away}: fortsätt väga liknande odds/folk-mönster`,
      hit: true,
    };
  }

  // Miss
  if (model.oddsFav !== actual) {
    kinds.push("fav_failed");
    why.push(
      `oddsfavorit ${model.oddsFav} föll – rätt blev ${actual}${
        winOdds != null ? ` @ ${winOdds.toFixed(2).replace(".", ",")}` : ""
      }`
    );
    next.push(
      actual === "X"
        ? `Nästa gång ${home} eller ${away} spelar: höj kryssrisken om oddsen är jämna`
        : `Misstro korta favoriter i liknande matcher för ${
            model.oddsFav === "1" ? home : away
          }`
    );
  }
  if (actual === "X" && !model.pick.includes("X")) {
    kinds.push("x_surprise");
    why.push("X kom utan att vara garderad");
    next.push("Gardera X oftare när 1 och 2 är nära varandra");
  }
  if (winOdds != null && winOdds >= 3.5) {
    kinds.push("longshot_hit");
    why.push(`högt odds (${winOdds.toFixed(2).replace(".", ",")}) slog in`);
    next.push("Låt överodds/underdog få halvgardering oftare");
  }
  if (model.folkFav !== actual) {
    kinds.push("folk_wrong");
    why.push(`svenska folket (${model.folkFav}) hade fel`);
    next.push("Lita mindre på folkfavorit när oddsen säger annat");
  }
  if (
    model.pick.length === 1 &&
    ((actual === "1" && model.pick[0] === "2") ||
      (actual === "2" && model.pick[0] === "1"))
  ) {
    kinds.push("narrow_miss");
    why.push("enkelrad fel sida – halvgardering hade räddat");
  }

  // Överodds vi missade
  const value = analyzeValueOdds({
    odds: model.odds,
    dist: model.dist,
  });
  if (value.overOddsOutcomes.includes(actual) && !model.pick.includes(actual)) {
    kinds.push("overodds_missed");
    why.push(`överodds på ${actual} fanns men togs inte med`);
    next.push(`Ta med överodds-${actual} i gardering nästa gång`);
  }

  if (!kinds.length) kinds.push("narrow_miss");
  if (!why.length) why.push(`tipset ${model.pick.join("")} missade – rätt ${actual}`);
  if (!next.length) {
    next.push(
      `Inför nästa match med ${home} eller ${away}: granska oddsrörelse och tabelläge extra noga`
    );
  }

  return {
    home,
    away,
    actual,
    modelPick: model.pick,
    oddsFavourite: model.oddsFav,
    folkFavourite: model.folkFav,
    startOdds: model.odds,
    kinds,
    whyWrong: why.join(". "),
    nextAspect: next.join(". "),
    hit: false,
  };
}

async function loadFinalizedDraw(
  slug: string,
  drawNumber: number
): Promise<{ draw: RawDraw; results: Map<number, Outcome> } | null> {
  try {
    const [drawWrap, resWrap] = await Promise.all([
      fetchJson(
        `https://api.www.svenskaspel.se/draw/1/${slug}/draws/${drawNumber}`
      ) as Promise<{ draw?: RawDraw }>,
      fetchJson(
        `https://api.www.svenskaspel.se/draw/1/${slug}/draws/${drawNumber}/result`
      ).catch(() => null) as Promise<{
        result?: { events?: Array<{ eventNumber: number; outcome?: string }> };
      } | null>,
    ]);
    const draw = drawWrap.draw;
    if (!draw || draw.drawState !== "Finalized") return null;
    const results = new Map<number, Outcome>();
    for (const e of resWrap?.result?.events || []) {
      const o = String(e.outcome || "").toUpperCase();
      if (o === "1" || o === "X" || o === "2") {
        results.set(e.eventNumber, o as Outcome);
      }
    }
    // Fallback from match scores
    if (!results.size) {
      for (const ev of draw.drawEvents || []) {
        const ft = (ev.match as { result?: Array<{ home?: string; away?: string; sportEventResultType?: string }> })
          ?.result?.find(
            (r) =>
              r.sportEventResultType === "Fulltime" ||
              r.sportEventResultType === "Current"
          );
        if (!ft) continue;
        const h = Number(ft.home);
        const a = Number(ft.away);
        if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
        results.set(
          ev.eventNumber,
          h > a ? "1" : h < a ? "2" : "X"
        );
      }
    }
    if (!results.size) return null;
    return { draw, results };
  } catch {
    return null;
  }
}

async function findRecentFinalizedNumbers(
  product: "powerplay" | "topptipset",
  count: number
): Promise<number[]> {
  if (product === "powerplay") {
    // List endpoint: open draws – start from lowest open − 1 and walk back
    try {
      const list = (await fetchJson(
        "https://api.www.svenskaspel.se/draw/1/powerplay/draws"
      )) as { draws?: RawDraw[] };
      const openNums = (list.draws || []).map((d) => d.drawNumber);
      const start = openNums.length
        ? Math.min(...openNums) - 1
        : 4817;
      const found: number[] = [];
      for (let n = start; n >= start - 40 && found.length < count; n--) {
        const hit = await loadFinalizedDraw("powerplay", n);
        if (hit) found.push(n);
      }
      return found;
    } catch {
      return [];
    }
  }

  // Topptipset: expand upward then walk back for Finalized
  const found: number[] = [];
  let best = 4400;
  let step = 64;
  let probe = best;
  while (probe < 20000) {
    const next = probe + step;
    const d = (await fetchJson(
      `https://api.www.svenskaspel.se/draw/1/topptipset/draws/${next}`
    ).catch(() => null)) as { draw?: RawDraw } | null;
    if (d?.draw) {
      best = next;
      probe = next;
      step = Math.min(step * 2, 256);
    } else break;
  }
  for (let n = best; n >= best - 100 && found.length < count; n--) {
    const hit = await loadFinalizedDraw("topptipset", n);
    if (hit) found.push(n);
  }
  return found;
}

function buildBiases(lessons: MatchLesson[]): LearningMemory["biases"] {
  const misses = lessons.filter((l) => !l.hit);
  const n = Math.max(misses.length, 1);
  const xSurprise = misses.filter((l) => l.kinds.includes("x_surprise")).length;
  const favFail = misses.filter((l) => l.kinds.includes("fav_failed")).length;
  const overMiss = misses.filter((l) =>
    l.kinds.includes("overodds_missed")
  ).length;
  const folkWrong = misses.filter((l) => l.kinds.includes("folk_wrong")).length;
  const overWorked = lessons.filter((l) =>
    l.kinds.includes("overodds_worked")
  ).length;

  const boostX = Math.min(0.06, (xSurprise / n) * 0.08);
  const cutShortFavourite = Math.min(0.05, (favFail / n) * 0.07);
  const trustOverOdds = Math.min(0.05, ((overMiss + overWorked) / Math.max(lessons.length, 1)) * 0.1);
  const distrustFolkFavourite = Math.min(0.04, (folkWrong / n) * 0.06);

  const bits: string[] = [];
  if (boostX > 0.015) bits.push(`fler X-missar → höj kryssvikt (+${(boostX * 100).toFixed(1)}%)`);
  if (cutShortFavourite > 0.015)
    bits.push(`favoriter föll → tona ner udda favoriter`);
  if (trustOverOdds > 0.015) bits.push(`överodds borde vägts in mer`);
  if (distrustFolkFavourite > 0.015) bits.push(`folkfel → lita mindre på folkfavorit`);
  if (!bits.length) bits.push("senaste omgångarna i balans – behåll basmodellen");

  return {
    boostX,
    cutShortFavourite,
    trustOverOdds,
    distrustFolkFavourite,
    note: bits.join(". "),
  };
}

function buildTeamAspects(lessons: MatchLesson[]): TeamAspect[] {
  const aspects: TeamAspect[] = [];
  for (const l of lessons.filter((x) => !x.hit).slice(0, 40)) {
    const kind = l.kinds[0] || "narrow_miss";
    if (l.kinds.includes("fav_failed") && l.oddsFavourite === "1") {
      aspects.push({
        team: l.home,
        note: `${l.home} som favorit föll (${l.actual}) – ${l.whyWrong}`,
        d1: -0.04,
        dX: 0.025,
        d2: 0.02,
        asHome: true,
        fromDraw: l.drawNumber,
        kind,
      });
    }
    if (l.kinds.includes("fav_failed") && l.oddsFavourite === "2") {
      aspects.push({
        team: l.away,
        note: `${l.away} som favorit föll (${l.actual}) – ${l.whyWrong}`,
        d1: 0.02,
        dX: 0.025,
        d2: -0.04,
        asHome: false,
        fromDraw: l.drawNumber,
        kind,
      });
    }
    if (l.kinds.includes("x_surprise")) {
      for (const team of [l.home, l.away]) {
        aspects.push({
          team,
          note: `X utan gardering i ${l.description} – höj kryssrisk`,
          d1: -0.015,
          dX: 0.035,
          d2: -0.015,
          asHome: null,
          fromDraw: l.drawNumber,
          kind: "x_surprise",
        });
      }
    }
    if (l.kinds.includes("longshot_hit")) {
      const underdog = l.actual === "1" ? l.home : l.actual === "2" ? l.away : null;
      if (underdog) {
        aspects.push({
          team: underdog,
          note: `${underdog} som underdog levererade – ge mer respekt`,
          d1: l.actual === "1" ? 0.03 : -0.01,
          dX: 0.01,
          d2: l.actual === "2" ? 0.03 : -0.01,
          asHome: null,
          fromDraw: l.drawNumber,
          kind: "longshot_hit",
        });
      }
    }
  }
  // Dedup keep newest per team+kind
  const seen = new Set<string>();
  return aspects.filter((a) => {
    const key = `${a.team.toLowerCase()}|${a.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyMemory(product: "powerplay" | "topptipset"): LearningMemory {
  return {
    product,
    updatedAt: new Date().toISOString(),
    drawsAnalyzed: [],
    lessons: [],
    lastRoundSummary: ["Ingen finaliserad omgång att lära av ännu"],
    teamAspects: [],
    biases: {
      boostX: 0,
      cutShortFavourite: 0,
      trustOverOdds: 0,
      distrustFolkFavourite: 0,
      note: "Ingen historik ännu",
    },
  };
}

export async function loadLearningMemory(
  product: ProductKind
): Promise<LearningMemory | null> {
  if (product !== "powerplay" && product !== "topptipset") return null;
  const cached = memoryCache.get(product);
  if (
    cached &&
    Date.now() - cached.at < CACHE_MS &&
    !isFreshFetch()
  ) {
    return cached.memory;
  }

  const slug = product;
  const numbers = await findRecentFinalizedNumbers(product, 6);
  if (!numbers.length) {
    const empty = emptyMemory(product);
    memoryCache.set(product, { at: Date.now(), memory: empty });
    return empty;
  }

  const lessons: MatchLesson[] = [];
  for (const n of numbers) {
    const loaded = await loadFinalizedDraw(slug, n);
    if (!loaded) continue;
    for (const ev of loaded.draw.drawEvents || []) {
      if (ev.cancelled) continue;
      const actual = loaded.results.get(ev.eventNumber);
      if (!actual) continue;
      const home =
        ev.match.participants.find((p) => p.type === "home")?.name || "?";
      const away =
        ev.match.participants.find((p) => p.type === "away")?.name || "?";
      const model = retrospectivePick(ev);
      const classified = classifyLesson(actual, model, home, away);
      lessons.push({
        drawNumber: n,
        product,
        eventNumber: ev.eventNumber,
        description: ev.eventDescription,
        league: ev.match.league?.name || "",
        ...classified,
      });
    }
  }

  const latestDraw = numbers[0];
  const lastRound = lessons.filter((l) => l.drawNumber === latestDraw);
  const misses = lastRound.filter((l) => !l.hit);
  const hits = lastRound.filter((l) => l.hit);
  const lastRoundSummary = [
    `Omgång #${latestDraw}: ${hits.length}/${lastRound.length} rätt enligt retrospektiv tipslogik`,
    ...misses.slice(0, 6).map(
      (m) =>
        `Match ${m.eventNumber} ${m.description}: tipset ${m.modelPick.join("")} → ${m.actual}. ${m.whyWrong}. → ${m.nextAspect}`
    ),
  ];
  if (!misses.length && lastRound.length) {
    lastRoundSummary.push("Inga missar i senaste omgången – behåll mönstret");
  }

  const memory: LearningMemory = {
    product,
    updatedAt: new Date().toISOString(),
    drawsAnalyzed: numbers,
    lessons,
    lastRoundSummary,
    teamAspects: buildTeamAspects(lessons),
    biases: buildBiases(lessons),
  };
  memoryCache.set(product, { at: Date.now(), memory });
  return memory;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function learningAdjustForMatch(args: {
  memory: LearningMemory | null;
  home: TeamInfo;
  away: TeamInfo;
}): {
  d1: number;
  dX: number;
  d2: number;
  notes: string[];
  relatedLessons: MatchLesson[];
} {
  if (!args.memory) {
    return { d1: 0, dX: 0, d2: 0, notes: [], relatedLessons: [] };
  }
  const { memory, home, away } = args;
  let d1 = 0;
  let dX = memory.biases.boostX;
  let d2 = 0;
  const notes: string[] = [];

  // Global biases
  if (memory.biases.cutShortFavourite > 0) {
    // applied softly both sides – stronger cut when we later know who's favourite
    d1 -= memory.biases.cutShortFavourite * 0.5;
    d2 -= memory.biases.cutShortFavourite * 0.5;
    dX += memory.biases.cutShortFavourite * 0.35;
  }
  if (memory.biases.distrustFolkFavourite > 0) {
    dX += memory.biases.distrustFolkFavourite * 0.4;
  }
  if (memory.biases.trustOverOdds > 0) {
    // mild X/underdog openness
    dX += memory.biases.trustOverOdds * 0.3;
  }
  if (memory.biases.note && (memory.biases.boostX > 0.01 || memory.biases.cutShortFavourite > 0.01)) {
    notes.push(`Lärdom: ${memory.biases.note}`);
  }

  for (const aspect of memory.teamAspects) {
    const onHome = teamMatch(aspect.team, home.name);
    const onAway = teamMatch(aspect.team, away.name);
    if (!onHome && !onAway) continue;
    if (aspect.asHome === true && !onHome) continue;
    if (aspect.asHome === false && !onAway) continue;
    d1 += aspect.d1;
    dX += aspect.dX;
    d2 += aspect.d2;
    notes.push(aspect.note);
  }

  const relatedLessons = memory.lessons
    .filter(
      (l) =>
        !l.hit &&
        (teamMatch(l.home, home.name) ||
          teamMatch(l.away, home.name) ||
          teamMatch(l.home, away.name) ||
          teamMatch(l.away, away.name))
    )
    .slice(0, 3);

  for (const l of relatedLessons) {
    notes.push(
      `Förra: ${l.description} tipset ${l.modelPick.join("")}→${l.actual}. ${l.nextAspect}`
    );
  }

  return {
    d1,
    dX,
    d2,
    notes: [...new Set(notes)].slice(0, 4),
    relatedLessons,
  };
}

export function emptyLearningNotes(): string[] {
  return [];
}
