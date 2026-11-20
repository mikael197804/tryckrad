import type { OddsetCandidate } from "./oddset";
import type { OddsetTrackedTip } from "./oddsetHistory";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type OddsetMistakeKind =
  | "low_scoring_trap"
  | "narrow_under"
  | "overconfident_model"
  | "short_odds_miss"
  | "high_xg_miss"
  | "rivalry_overrated"
  | "red_card_noise"
  | "value_miss"
  | "value_worked"
  | "solid_over_hit"
  | "scrappy_over_hit";

export type OddsetLesson = {
  eventId: number;
  tippedAt: string;
  settledAt: string;
  home: string;
  away: string;
  league: string;
  country: string;
  odds: number;
  over25ProbPct: number;
  expectedGoals: number | null;
  rivalryLevel: OddsetCandidate["rivalry"]["level"];
  redCardLevel: OddsetCandidate["redCard"]["level"];
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  hit: boolean;
  kinds: OddsetMistakeKind[];
  whyWrong: string;
  whyRight: string | null;
  nextAspect: string;
};

export type OddsetTeamAspect = {
  team: string;
  note: string;
  /** Score-delta för Över 2,5 (negativt = tona ner). */
  dOver: number;
  fromEventId: number;
  kind: OddsetMistakeKind;
};

export type OddsetLearningMemory = {
  updatedAt: string;
  lessons: OddsetLesson[];
  lastSummary: string[];
  teamAspects: OddsetTeamAspect[];
  leagueAspects: Array<{
    league: string;
    note: string;
    dOver: number;
    sample: number;
  }>;
  biases: {
    raiseProbFloor: number;
    cutShortOverOdds: number;
    cutHighXgBlindTrust: number;
    cutRivalryBoost: number;
    preferValueEdge: number;
    diversifyLeagues: number;
    note: string;
  };
};

const LEARNING_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
const STORE_PATH = path.join("/tmp", "mikaels-oddset-learning.json");
const MAX_LESSONS = 80;

type GlobalLearn = {
  memory: OddsetLearningMemory;
  loaded: boolean;
};

function gstore(): GlobalLearn {
  const g = globalThis as typeof globalThis & {
    __mikaelsOddsetLearning?: GlobalLearn;
  };
  if (!g.__mikaelsOddsetLearning) {
    g.__mikaelsOddsetLearning = {
      loaded: false,
      memory: emptyMemory(),
    };
  }
  return g.__mikaelsOddsetLearning;
}

function emptyMemory(): OddsetLearningMemory {
  return {
    updatedAt: new Date().toISOString(),
    lessons: [],
    lastSummary: ["Ingen avgjord Oddset-tipp att lära av ännu"],
    teamAspects: [],
    leagueAspects: [],
    biases: {
      raiseProbFloor: 0,
      cutShortOverOdds: 0,
      cutHighXgBlindTrust: 0,
      cutRivalryBoost: 0,
      preferValueEdge: 0,
      diversifyLeagues: 0,
      note: "Ingen Oddset-historik ännu",
    },
  };
}

function pruneLessons(lessons: OddsetLesson[], now = Date.now()): OddsetLesson[] {
  return lessons
    .filter((l) => {
      const at = Date.parse(l.settledAt || l.tippedAt);
      return Number.isFinite(at) && now - at <= LEARNING_RETENTION_MS;
    })
    .sort((a, b) => Date.parse(b.settledAt) - Date.parse(a.settledAt))
    .slice(0, MAX_LESSONS);
}

async function ensureLoaded(): Promise<void> {
  const s = gstore();
  if (s.loaded) return;
  s.loaded = true;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as OddsetLearningMemory;
    if (parsed && Array.isArray(parsed.lessons)) {
      s.memory = {
        ...emptyMemory(),
        ...parsed,
        lessons: pruneLessons(parsed.lessons),
      };
      rebuildDerived(s.memory);
    }
  } catch {
    // first run
  }
}

async function persist(): Promise<void> {
  const s = gstore();
  s.memory.lessons = pruneLessons(s.memory.lessons);
  s.memory.updatedAt = new Date().toISOString();
  try {
    await mkdir(path.dirname(STORE_PATH), { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(s.memory), "utf8");
  } catch {
    // ephemeral FS
  }
}

function classifyTip(tip: OddsetTrackedTip): OddsetLesson | null {
  if (tip.outcome !== "won" && tip.outcome !== "lost") return null;
  if (tip.homeGoals == null || tip.awayGoals == null || tip.totalGoals == null) {
    return null;
  }

  const hit = tip.outcome === "won";
  const total = tip.totalGoals;
  const kinds: OddsetMistakeKind[] = [];
  const whyParts: string[] = [];
  const rightParts: string[] = [];
  const nextParts: string[] = [];

  if (!hit) {
    if (total <= 1) {
      kinds.push("low_scoring_trap");
      whyParts.push(
        `Bara ${total} mål – spelet föll på en låg målbild trots Över 2,5 @ ${tip.odds.toFixed(2).replace(".", ",")}`
      );
      nextParts.push(
        `Var försiktig med ${tip.home}/${tip.away} och liknande lågtempo-matcher`
      );
    } else if (total === 2) {
      kinds.push("narrow_under");
      whyParts.push(
        `Exakt 2 mål – nära men Under 2,5. Modellen hade ${tip.over25ProbPct.toFixed(0)}% på Över`
      );
      nextParts.push(
        "Kräv tydligare kant (högre modell-p eller värde) innan Över 2,5 i jämna matcher"
      );
    }

    if (tip.over25ProbPct >= 68) {
      kinds.push("overconfident_model");
      whyParts.push(
        `För hög modelltro (${tip.over25ProbPct.toFixed(0)}%) mot verkligt under`
      );
      nextParts.push("Höj ribban – lita inte blint på ≥68% utan värde/oddsstöd");
    }

    if (tip.odds <= 1.55) {
      kinds.push("short_odds_miss");
      whyParts.push(
        `Korta Över-odds (${tip.odds.toFixed(2).replace(".", ",")}) gick fel – “säker” linje var det inte`
      );
      nextParts.push("Tona ner ultrakorta Över-odds; sök hellre 1,60–1,95 med kant");
    }

    if (tip.expectedGoals != null && tip.expectedGoals >= 3.0) {
      kinds.push("high_xg_miss");
      whyParts.push(
        `Hög xG≈${tip.expectedGoals.toFixed(2).replace(".", ",")} men bara ${total} mål`
      );
      nextParts.push("xG från oddsstegen kan överskatta – kräv bekräftelse från flera linjer");
    }

    if (tip.rivalry.level === "likely") {
      kinds.push("rivalry_overrated");
      whyParts.push("Derby/rivalitet vägde upp tipset men målsnittet blev lågt");
      nextParts.push("Rivalitet ≠ mål – använd derby mer som underhållning än Över-signal");
    }

    if (tip.redCard.level === "high" || tip.redCard.level === "medium") {
      kinds.push("red_card_noise");
      whyParts.push("Rött-kort-signal hjälpte inte Över 2,5");
      nextParts.push("Kort/hets är svag Över-proxy – sänk den vikten");
    }

    const implied = tip.odds > 1 ? 1 / tip.odds : 0;
    if (tip.over25ProbPct / 100 > implied + 0.08) {
      kinds.push("value_miss");
      whyParts.push("“Värde” enligt modell slog fel denna gång");
      nextParts.push("Värde kräver stabilitet – fjolika liga/lag kan behöva mer historik");
    }

    if (!kinds.length) {
      kinds.push("narrow_under");
      whyParts.push(`Över 2,5 missade (${tip.homeGoals}–${tip.awayGoals})`);
      nextParts.push("Justera urvalet bort från liknande profiler");
    }
  } else {
    if (tip.over25ProbPct >= 62 && tip.odds >= 1.55 && tip.odds <= 2.05) {
      kinds.push("solid_over_hit");
      rightParts.push(
        `Stabil träff ${tip.homeGoals}–${tip.awayGoals} med balanserad profil (p ${tip.over25ProbPct.toFixed(0)}% / odds ${tip.odds.toFixed(2).replace(".", ",")})`
      );
      nextParts.push("Prioritera liknande mittenodds + solid modell-p framför ultrakorta favoriter");
    } else if (total >= 4) {
      kinds.push("scrappy_over_hit");
      rightParts.push(`Målrik träff ${tip.homeGoals}–${tip.awayGoals} – öppet matchtempo`);
      nextParts.push("Leta fler matcher med hög Ö1,5 + rimlig Ö3,5-stege");
    } else {
      kinds.push("solid_over_hit");
      rightParts.push(`Över 2,5 rätt (${tip.homeGoals}–${tip.awayGoals})`);
      nextParts.push("Behåll liknande signaler i nästa urval");
    }

    const implied = tip.odds > 1 ? 1 / tip.odds : 0;
    if (tip.over25ProbPct / 100 > implied + 0.06) {
      kinds.push("value_worked");
      rightParts.push("Värdekant mot oddset levererade");
      nextParts.push("Fortsätt belöna positiv edge när Poisson + Ö/U stämmer överens");
    }
  }

  return {
    eventId: tip.eventId,
    tippedAt: tip.tippedAt,
    settledAt: tip.settledAt || new Date().toISOString(),
    home: tip.home,
    away: tip.away,
    league: tip.league,
    country: tip.country,
    odds: tip.odds,
    over25ProbPct: tip.over25ProbPct,
    expectedGoals: tip.expectedGoals,
    rivalryLevel: tip.rivalry.level,
    redCardLevel: tip.redCard.level,
    homeGoals: tip.homeGoals,
    awayGoals: tip.awayGoals,
    totalGoals: tip.totalGoals,
    hit,
    kinds,
    whyWrong: hit ? "" : whyParts.join(". "),
    whyRight: hit ? rightParts.join(". ") : null,
    nextAspect: nextParts.join(". "),
  };
}

function buildBiases(lessons: OddsetLesson[]): OddsetLearningMemory["biases"] {
  const misses = lessons.filter((l) => !l.hit);
  const hits = lessons.filter((l) => l.hit);
  const nMiss = Math.max(misses.length, 1);
  const nAll = Math.max(lessons.length, 1);

  const low = misses.filter((l) => l.kinds.includes("low_scoring_trap")).length;
  const narrow = misses.filter((l) => l.kinds.includes("narrow_under")).length;
  const overconf = misses.filter((l) =>
    l.kinds.includes("overconfident_model")
  ).length;
  const shortMiss = misses.filter((l) =>
    l.kinds.includes("short_odds_miss")
  ).length;
  const xgMiss = misses.filter((l) => l.kinds.includes("high_xg_miss")).length;
  const rivMiss = misses.filter((l) =>
    l.kinds.includes("rivalry_overrated")
  ).length;
  const valueMiss = misses.filter((l) => l.kinds.includes("value_miss")).length;
  const valueHit = hits.filter((l) => l.kinds.includes("value_worked")).length;
  const solid = hits.filter((l) => l.kinds.includes("solid_over_hit")).length;

  const raiseProbFloor = Math.min(0.06, ((overconf + narrow) / nMiss) * 0.07);
  const cutShortOverOdds = Math.min(0.08, (shortMiss / nMiss) * 0.1);
  const cutHighXgBlindTrust = Math.min(0.06, (xgMiss / nMiss) * 0.08);
  const cutRivalryBoost = Math.min(0.05, (rivMiss / nMiss) * 0.08);
  const preferValueEdge = Math.min(
    0.07,
    Math.max(0, (valueHit - valueMiss * 0.6) / nAll) * 0.15
  );
  const diversifyLeagues = Math.min(
    0.05,
    ((low + shortMiss) / nMiss) * 0.06 + (solid > 0 ? 0.01 : 0)
  );

  const bits: string[] = [];
  if (raiseProbFloor > 0.015)
    bits.push("höj ribban – för många nära/övertygade missar");
  if (cutShortOverOdds > 0.015)
    bits.push("tona ner ultrakorta Över-odds");
  if (cutHighXgBlindTrust > 0.015)
    bits.push("lita mindre blint på hög xG-stege");
  if (cutRivalryBoost > 0.015) bits.push("derby ≠ mål");
  if (preferValueEdge > 0.015) bits.push("belöna värde-edge mer");
  if (diversifyLeagues > 0.015)
    bits.push("sprid tipsen – undvik samma liga/profil");
  if (!bits.length) bits.push("Oddset-lärdomar i balans – behåll basmodellen");

  return {
    raiseProbFloor,
    cutShortOverOdds,
    cutHighXgBlindTrust,
    cutRivalryBoost,
    preferValueEdge,
    diversifyLeagues,
    note: bits.join(". "),
  };
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

function buildTeamAspects(lessons: OddsetLesson[]): OddsetTeamAspect[] {
  const aspects: OddsetTeamAspect[] = [];
  for (const l of lessons.filter((x) => !x.hit).slice(0, 40)) {
    const kind = l.kinds[0] || "narrow_under";
    const dOver =
      l.kinds.includes("low_scoring_trap")
        ? -10
        : l.kinds.includes("narrow_under")
          ? -6
          : l.kinds.includes("high_xg_miss")
            ? -7
            : -5;

    for (const team of [l.home, l.away]) {
      aspects.push({
        team,
        note: `${team} i ${l.home}–${l.away} (${l.homeGoals}–${l.awayGoals}): ${l.nextAspect}`,
        dOver,
        fromEventId: l.eventId,
        kind,
      });
    }
  }

  for (const l of lessons.filter((x) => x.hit).slice(0, 20)) {
    if (!l.kinds.includes("solid_over_hit") && !l.kinds.includes("scrappy_over_hit")) {
      continue;
    }
    for (const team of [l.home, l.away]) {
      aspects.push({
        team,
        note: `${team} levererade Över senast (${l.homeGoals}–${l.awayGoals}) – ge liten bonus`,
        dOver: 3,
        fromEventId: l.eventId,
        kind: l.kinds[0],
      });
    }
  }

  const seen = new Set<string>();
  return aspects.filter((a) => {
    const key = `${norm(a.team)}|${a.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildLeagueAspects(
  lessons: OddsetLesson[]
): OddsetLearningMemory["leagueAspects"] {
  const byLeague = new Map<string, { hit: number; miss: number; low: number }>();
  for (const l of lessons) {
    const key = l.league || l.country || "?";
    const row = byLeague.get(key) || { hit: 0, miss: 0, low: 0 };
    if (l.hit) row.hit++;
    else {
      row.miss++;
      if (l.totalGoals <= 1) row.low++;
    }
    byLeague.set(key, row);
  }

  const out: OddsetLearningMemory["leagueAspects"] = [];
  for (const [league, row] of byLeague) {
    const sample = row.hit + row.miss;
    if (sample < 2) continue;
    const missRate = row.miss / sample;
    let dOver = 0;
    let note = "";
    if (missRate >= 0.6) {
      dOver = -8;
      note = `${league}: ${row.miss}/${sample} Över-missar – tona ner ligan`;
    } else if (row.low >= 2) {
      dOver = -6;
      note = `${league}: flera 0–1-målsmatcher – försiktig med Över`;
    } else if (row.hit >= 2 && missRate <= 0.35) {
      dOver = 4;
      note = `${league}: Över har träffat bra (${row.hit}/${sample})`;
    } else continue;
    out.push({ league, note, dOver, sample });
  }
  return out.sort((a, b) => Math.abs(b.dOver) - Math.abs(a.dOver)).slice(0, 12);
}

function rebuildDerived(memory: OddsetLearningMemory): void {
  memory.lessons = pruneLessons(memory.lessons);
  memory.biases = buildBiases(memory.lessons);
  memory.teamAspects = buildTeamAspects(memory.lessons);
  memory.leagueAspects = buildLeagueAspects(memory.lessons);

  const recent = memory.lessons.slice(0, 8);
  const summary: string[] = [];
  if (!recent.length) {
    summary.push("Ingen avgjord Oddset-tipp att lära av ännu");
  } else {
    const hits = recent.filter((l) => l.hit).length;
    summary.push(
      `Senaste ${recent.length} avgjorda tips: ${hits} rätt / ${recent.length - hits} fel · ${memory.biases.note}`
    );
    for (const l of recent.filter((x) => !x.hit).slice(0, 5)) {
      summary.push(
        `${l.home}–${l.away} ${l.homeGoals}–${l.awayGoals}: ${l.whyWrong}. → ${l.nextAspect}`
      );
    }
    for (const l of recent.filter((x) => x.hit).slice(0, 2)) {
      summary.push(
        `Rätt ${l.home}–${l.away} ${l.homeGoals}–${l.awayGoals}: ${l.whyRight || "Över 2,5"}. → ${l.nextAspect}`
      );
    }
  }
  memory.lastSummary = summary;
}

/** Importera avgjorda tips (t.ex. från klient) och bygg om lärdomar. */
export async function learnFromSettledTips(
  tips: OddsetTrackedTip[]
): Promise<OddsetLearningMemory> {
  await ensureLoaded();
  const s = gstore();
  const byId = new Map(s.memory.lessons.map((l) => [l.eventId, l]));

  for (const tip of tips) {
    const lesson = classifyTip(tip);
    if (!lesson) continue;
    const prev = byId.get(lesson.eventId);
    // Uppdatera om ny settlement / behåll tidigaste tippedAt
    byId.set(lesson.eventId, {
      ...lesson,
      tippedAt: prev?.tippedAt || lesson.tippedAt,
    });
  }

  s.memory.lessons = pruneLessons([...byId.values()]);
  rebuildDerived(s.memory);
  await persist();
  return s.memory;
}

export async function loadOddsetLearning(): Promise<OddsetLearningMemory> {
  await ensureLoaded();
  const s = gstore();
  rebuildDerived(s.memory);
  return s.memory;
}

export async function importOddsetLessons(
  lessons: OddsetLesson[]
): Promise<OddsetLearningMemory> {
  await ensureLoaded();
  const s = gstore();
  const byId = new Map(s.memory.lessons.map((l) => [l.eventId, l]));
  for (const l of lessons) {
    if (!l?.eventId || l.homeGoals == null) continue;
    byId.set(l.eventId, l);
  }
  s.memory.lessons = pruneLessons([...byId.values()]);
  rebuildDerived(s.memory);
  await persist();
  return s.memory;
}

export type OddsetLearningAdjust = {
  scoreDelta: number;
  probFloorBump: number;
  notes: string[];
  related: OddsetLesson[];
};

/** Justeringar för ett kandidattips utifrån tidigare rätt/fel. */
export function oddsetLearningAdjust(args: {
  memory: OddsetLearningMemory | null;
  candidate: Pick<
    OddsetCandidate,
    | "home"
    | "away"
    | "league"
    | "country"
    | "odds"
    | "over25ProbPct"
    | "expectedGoals"
    | "rivalry"
    | "redCard"
    | "eventId"
  >;
  recentEventIds?: Set<number>;
  recentTeams?: Set<string>;
  recentLeagues?: Set<string>;
}): OddsetLearningAdjust {
  const notes: string[] = [];
  const related: OddsetLesson[] = [];
  if (!args.memory) {
    return { scoreDelta: 0, probFloorBump: 0, notes, related };
  }
  const { memory, candidate } = args;
  let scoreDelta = 0;
  const biases = memory.biases;

  const probFloorBump = biases.raiseProbFloor;

  if (biases.cutShortOverOdds > 0 && candidate.odds <= 1.55) {
    scoreDelta -= biases.cutShortOverOdds * 80;
    notes.push("Lärdom: ultrakorta Över har missat – tona ner");
  }
  if (
    biases.cutHighXgBlindTrust > 0 &&
    candidate.expectedGoals != null &&
    candidate.expectedGoals >= 3.0
  ) {
    scoreDelta -= biases.cutHighXgBlindTrust * 70;
    notes.push("Lärdom: hög xG har överskattats tidigare");
  }
  if (biases.cutRivalryBoost > 0 && candidate.rivalry.level !== "none") {
    scoreDelta -= biases.cutRivalryBoost * 50;
    notes.push("Lärdom: rivalitet gav svag Över-träff");
  }
  if (biases.preferValueEdge > 0) {
    const implied = candidate.odds > 1 ? 1 / candidate.odds : 0;
    const edge = candidate.over25ProbPct / 100 - implied;
    if (edge > 0.05) {
      scoreDelta += biases.preferValueEdge * 90;
      notes.push("Lärdom: positiv värde-edge har fungerat");
    }
  }

  for (const a of memory.teamAspects) {
    if (teamMatch(a.team, candidate.home) || teamMatch(a.team, candidate.away)) {
      scoreDelta += a.dOver;
      if (notes.length < 4) notes.push(a.note);
      const lesson = memory.lessons.find((l) => l.eventId === a.fromEventId);
      if (lesson) related.push(lesson);
    }
  }

  for (const la of memory.leagueAspects) {
    if (
      norm(la.league) &&
      (norm(candidate.league).includes(norm(la.league)) ||
        norm(la.league).includes(norm(candidate.league)))
    ) {
      scoreDelta += la.dOver;
      if (notes.length < 4) notes.push(la.note);
    }
  }

  // Unikhet: undvik samma lag/liga som nyligen tippats
  if (args.recentEventIds?.has(candidate.eventId)) {
    scoreDelta -= 100;
  }
  const homeN = norm(candidate.home);
  const awayN = norm(candidate.away);
  if (args.recentTeams) {
    for (const t of args.recentTeams) {
      if (teamMatch(t, candidate.home) || teamMatch(t, candidate.away)) {
        scoreDelta -= 12 + biases.diversifyLeagues * 80;
        notes.push(`Unikt tips: ${candidate.home}/${candidate.away} tippades nyligen – sänk prioritet`);
        break;
      }
    }
  }
  if (args.recentLeagues && candidate.league) {
    for (const lg of args.recentLeagues) {
      if (norm(lg) === norm(candidate.league)) {
        scoreDelta -= 6 + biases.diversifyLeagues * 40;
        notes.push(`Unikt tips: sprid bort från ${candidate.league}`);
        break;
      }
    }
  }

  // Undvik att tippa exakt samma lagpar som en färsk miss
  for (const l of memory.lessons.filter((x) => !x.hit).slice(0, 15)) {
    if (
      (teamMatch(l.home, candidate.home) && teamMatch(l.away, candidate.away)) ||
      (teamMatch(l.home, candidate.away) && teamMatch(l.away, candidate.home))
    ) {
      scoreDelta -= 15;
      notes.push(`Samma par missade Över senast (${l.homeGoals}–${l.awayGoals})`);
      related.push(l);
    } else if (
      teamMatch(l.home, candidate.home) ||
      teamMatch(l.home, candidate.away) ||
      teamMatch(l.away, candidate.home) ||
      teamMatch(l.away, candidate.away)
    ) {
      // already handled via team aspects mostly
      void homeN;
      void awayN;
    }
  }

  return {
    scoreDelta,
    probFloorBump,
    notes: [...new Set(notes)].slice(0, 4),
    related: related.slice(0, 3),
  };
}

export const ODDSET_LEARNING_RETENTION_DAYS = 21;
