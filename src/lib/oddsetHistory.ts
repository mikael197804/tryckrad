import type { OddsetCandidate } from "./oddset";
import { learnFromSettledTips } from "./oddsetLearning";
import { lookupMatchScore } from "./oddsetSettle";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type OddsetOutcome = "pending" | "live" | "won" | "lost";

export type OddsetTrackedTip = OddsetCandidate & {
  tippedAt: string;
  outcome: OddsetOutcome;
  homeGoals: number | null;
  awayGoals: number | null;
  totalGoals: number | null;
  settledAt: string | null;
  resultNote: string | null;
};

const RETENTION_MS = 24 * 60 * 60 * 1000;
const STORE_PATH = path.join("/tmp", "mikaels-oddset-history.json");

export function oddsetTipKey(
  t: Pick<OddsetCandidate, "eventId" | "market" | "pick1x2">
): string {
  if (t.market === "1x2") {
    return `${t.eventId}:1x2:${t.pick1x2 || "?"}`;
  }
  return `${t.eventId}:${t.market || "over_1_5"}`;
}

type GlobalStore = {
  tips: OddsetTrackedTip[];
  loaded: boolean;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & {
    __mikaelsOddsetHistory?: GlobalStore;
  };
  if (!g.__mikaelsOddsetHistory) {
    g.__mikaelsOddsetHistory = { tips: [], loaded: false };
  }
  return g.__mikaelsOddsetHistory;
}

function prune(tips: OddsetTrackedTip[], now = Date.now()): OddsetTrackedTip[] {
  return tips.filter((t) => {
    const tipped = Date.parse(t.tippedAt);
    if (!Number.isFinite(tipped)) return false;
    return now - tipped <= RETENTION_MS;
  });
}

async function ensureLoaded(): Promise<void> {
  const s = store();
  if (s.loaded) return;
  s.loaded = true;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { tips?: OddsetTrackedTip[] };
    if (Array.isArray(parsed.tips)) {
      s.tips = prune(parsed.tips);
    }
  } catch {
    // ingen fil ännu / ephemeral FS
  }
}

async function persist(): Promise<void> {
  const s = store();
  s.tips = prune(s.tips);
  try {
    await mkdir(path.dirname(STORE_PATH), { recursive: true });
    await writeFile(
      STORE_PATH,
      JSON.stringify({ tips: s.tips, savedAt: new Date().toISOString() }),
      "utf8"
    );
  } catch {
    // Vercel /tmp kan faila – minnet räcker för warm instances
  }
}

function outcomeRank(o: OddsetOutcome | undefined): number {
  if (o === "won" || o === "lost") return 3;
  if (o === "live") return 2;
  return 1;
}

function toTracked(
  c: OddsetCandidate & Partial<OddsetTrackedTip>,
  tippedAt: string,
  prev?: OddsetTrackedTip
): OddsetTrackedTip {
  const incomingOutcome = (c.outcome as OddsetOutcome | undefined) || "pending";
  const preferIncoming =
    outcomeRank(incomingOutcome) >= outcomeRank(prev?.outcome);
  const outcome = preferIncoming
    ? incomingOutcome
    : prev?.outcome || "pending";
  const useIncomingScore = preferIncoming && incomingOutcome !== "pending";
  return {
    ...c,
    tippedAt: prev?.tippedAt || tippedAt,
    outcome,
    homeGoals: useIncomingScore
      ? (c.homeGoals ?? prev?.homeGoals ?? null)
      : (prev?.homeGoals ?? c.homeGoals ?? null),
    awayGoals: useIncomingScore
      ? (c.awayGoals ?? prev?.awayGoals ?? null)
      : (prev?.awayGoals ?? c.awayGoals ?? null),
    totalGoals: useIncomingScore
      ? (c.totalGoals ?? prev?.totalGoals ?? null)
      : (prev?.totalGoals ?? c.totalGoals ?? null),
    settledAt: useIncomingScore
      ? (c.settledAt ?? prev?.settledAt ?? null)
      : (prev?.settledAt ?? c.settledAt ?? null),
    resultNote: useIncomingScore
      ? (c.resultNote ?? prev?.resultNote ?? null)
      : (prev?.resultNote ?? c.resultNote ?? null),
  };
}

/** Spara/uppdatera dagens tips så de syns i 24 h. */
export async function rememberOddsetTips(
  selected: OddsetCandidate[],
  tippedAt = new Date().toISOString()
): Promise<void> {
  await ensureLoaded();
  const s = store();
  const byId = new Map(s.tips.map((t) => [oddsetTipKey(t), t]));
  for (const c of selected) {
    const key = oddsetTipKey(c);
    const prev = byId.get(key);
    byId.set(key, toTracked(c, tippedAt, prev));
  }
  s.tips = prune([...byId.values()]);
  await persist();
}

/** Importera tips från klientens localStorage (överlever cold start). */
export async function importOddsetTips(
  tips: Array<OddsetCandidate & { tippedAt?: string }>
): Promise<void> {
  await ensureLoaded();
  const s = store();
  const byId = new Map(s.tips.map((t) => [oddsetTipKey(t), t]));
  const nowIso = new Date().toISOString();
  for (const raw of tips) {
    if (!raw?.eventId || !raw.home || !raw.away || !raw.kickoff) continue;
    const tippedAt = raw.tippedAt || nowIso;
    const tippedMs = Date.parse(tippedAt);
    if (!Number.isFinite(tippedMs) || Date.now() - tippedMs > RETENTION_MS) {
      continue;
    }
    const key = oddsetTipKey(raw);
    const prev = byId.get(key);
    byId.set(
      key,
      toTracked(
        raw,
        tippedAt,
        prev ? { ...prev, tippedAt: prev.tippedAt } : undefined
      )
    );
  }
  s.tips = prune([...byId.values()]);
  await persist();
}

function applyScore(
  tip: OddsetTrackedTip,
  score: NonNullable<Awaited<ReturnType<typeof lookupMatchScore>>>
): OddsetTrackedTip {
  const is1x2 = tip.market === "1x2";
  const pick = tip.pick1x2;

  if (score.status === "live") {
    let liveNote = `Live ${score.homeGoals}–${score.awayGoals}`;
    if (is1x2 && pick) {
      liveNote += ` · tippat ${pick}`;
    } else {
      liveNote += ` · ${
        score.overLineHit ? "Över 1,5 redan inne" : "väntar på fler mål"
      }`;
    }
    return {
      ...tip,
      outcome: "live",
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      totalGoals: score.totalGoals,
      settledAt: null,
      resultNote: liveNote,
    };
  }

  if (is1x2 && pick) {
    const actual: "1" | "X" | "2" =
      score.homeGoals > score.awayGoals
        ? "1"
        : score.homeGoals < score.awayGoals
          ? "2"
          : "X";
    const won = actual === pick;
    return {
      ...tip,
      outcome: won ? "won" : "lost",
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      totalGoals: score.totalGoals,
      settledAt: new Date().toISOString(),
      resultNote: won
        ? `Rätt · ${score.homeGoals}–${score.awayGoals} (1X2 ${pick})`
        : `Fel · ${score.homeGoals}–${score.awayGoals} (tippat ${pick}, blev ${actual})`,
    };
  }

  const outcome: OddsetOutcome = score.overLineHit ? "won" : "lost";
  return {
    ...tip,
    outcome,
    homeGoals: score.homeGoals,
    awayGoals: score.awayGoals,
    totalGoals: score.totalGoals,
    settledAt: new Date().toISOString(),
    resultNote: score.overLineHit
      ? `Rätt · ${score.homeGoals}–${score.awayGoals} (Över 1,5)`
      : `Fel · ${score.homeGoals}–${score.awayGoals} (Under 1,5)`,
  };
}

/** Uppdatera resultat för alla tips inom 24 h. */
export async function settleOddsetTips(): Promise<OddsetTrackedTip[]> {
  await ensureLoaded();
  const s = store();
  s.tips = prune(s.tips);
  const updated: OddsetTrackedTip[] = [];

  for (const tip of s.tips) {
    if (tip.outcome === "won" || tip.outcome === "lost") {
      updated.push(tip);
      continue;
    }
    const kick = Date.parse(tip.kickoff);
    if (Number.isFinite(kick) && Date.now() < kick + 5 * 60 * 1000) {
      updated.push(tip);
      continue;
    }
    try {
      const score = await lookupMatchScore({
        home: tip.home,
        away: tip.away,
        kickoff: tip.kickoff,
      });
      if (!score) {
        updated.push({
          ...tip,
          resultNote: tip.resultNote || "Väntar på Flashscore…",
        });
        continue;
      }
      updated.push(applyScore(tip, score));
    } catch {
      updated.push(tip);
    }
  }

  s.tips = updated;
  await persist();
  await learnFromSettledTips(updated);
  return listTrackedOddsetTips();
}

export async function listTrackedOddsetTips(): Promise<OddsetTrackedTip[]> {
  await ensureLoaded();
  const tips = prune(store().tips);
  return [...tips].sort(
    (a, b) =>
      Date.parse(b.tippedAt) - Date.parse(a.tippedAt) ||
      Date.parse(a.kickoff) - Date.parse(b.kickoff)
  );
}

export const ODDSET_TIP_RETENTION_HOURS = 24;
