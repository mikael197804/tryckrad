import type { OddsetCandidate } from "./oddset";
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

function toTracked(
  c: OddsetCandidate,
  tippedAt: string,
  prev?: OddsetTrackedTip
): OddsetTrackedTip {
  return {
    ...c,
    tippedAt: prev?.tippedAt || tippedAt,
    outcome: prev?.outcome || "pending",
    homeGoals: prev?.homeGoals ?? null,
    awayGoals: prev?.awayGoals ?? null,
    totalGoals: prev?.totalGoals ?? null,
    settledAt: prev?.settledAt ?? null,
    resultNote: prev?.resultNote ?? null,
  };
}

/** Spara/uppdatera dagens tips så de syns i 24 h. */
export async function rememberOddsetTips(
  selected: OddsetCandidate[],
  tippedAt = new Date().toISOString()
): Promise<void> {
  await ensureLoaded();
  const s = store();
  const byId = new Map(s.tips.map((t) => [t.eventId, t]));
  for (const c of selected) {
    const prev = byId.get(c.eventId);
    byId.set(c.eventId, toTracked(c, tippedAt, prev));
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
  const byId = new Map(s.tips.map((t) => [t.eventId, t]));
  const nowIso = new Date().toISOString();
  for (const raw of tips) {
    if (!raw?.eventId || !raw.home || !raw.away || !raw.kickoff) continue;
    const tippedAt = raw.tippedAt || nowIso;
    const tippedMs = Date.parse(tippedAt);
    if (!Number.isFinite(tippedMs) || Date.now() - tippedMs > RETENTION_MS) {
      continue;
    }
    const prev = byId.get(raw.eventId);
    // Behåll äldre tippedAt och eventuell settlement
    byId.set(
      raw.eventId,
      toTracked(raw, tippedAt, prev ? { ...prev, tippedAt: prev.tippedAt } : undefined)
    );
  }
  s.tips = prune([...byId.values()]);
  await persist();
}

function applyScore(
  tip: OddsetTrackedTip,
  score: NonNullable<Awaited<ReturnType<typeof lookupMatchScore>>>
): OddsetTrackedTip {
  if (score.status === "live") {
    return {
      ...tip,
      outcome: "live",
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      totalGoals: score.totalGoals,
      settledAt: null,
      resultNote: `Live ${score.homeGoals}–${score.awayGoals} · ${
        score.over25Hit ? "Över 2,5 redan inne" : "väntar på fler mål"
      }`,
    };
  }

  const outcome: OddsetOutcome = score.over25Hit ? "won" : "lost";
  return {
    ...tip,
    outcome,
    homeGoals: score.homeGoals,
    awayGoals: score.awayGoals,
    totalGoals: score.totalGoals,
    settledAt: new Date().toISOString(),
    resultNote: score.over25Hit
      ? `Rätt · ${score.homeGoals}–${score.awayGoals} (Över 2,5)`
      : `Fel · ${score.homeGoals}–${score.awayGoals} (Under 2,5)`,
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
    // Vänta tills matchen rimligen startat
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
          resultNote: tip.resultNote || "Väntar på slutresultat…",
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
