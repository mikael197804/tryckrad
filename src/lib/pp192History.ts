import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { POWERPLAY_DAILY_COST_KR } from "./systems";
import type { DrawBundle } from "./types";
import type { HistoryPick } from "./tipHistory";

/**
 * Dagligt Powerplay 192 kr – sparas server-side och visas i resultat 24 h.
 */

const STORE_PATH = path.join("/tmp", "mikaels-pp192-history.json");
const RETENTION_MS = 24 * 60 * 60 * 1000;

type GlobalStore = {
  picks: HistoryPick[];
  loaded: boolean;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & {
    __mikaelsPp192History?: GlobalStore;
  };
  if (!g.__mikaelsPp192History) {
    g.__mikaelsPp192History = { picks: [], loaded: false };
  }
  return g.__mikaelsPp192History;
}

function anchorMs(p: HistoryPick): number {
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

function prune(picks: HistoryPick[], now = Date.now()): HistoryPick[] {
  return picks.filter((p) => {
    const at = anchorMs(p);
    return Number.isFinite(at) && now - at <= RETENTION_MS;
  });
}

async function ensureLoaded(): Promise<void> {
  const s = store();
  if (s.loaded) return;
  s.loaded = true;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { picks?: HistoryPick[] };
    if (Array.isArray(parsed.picks)) s.picks = prune(parsed.picks);
  } catch {
    /* ingen fil ännu */
  }
}

async function persist(): Promise<void> {
  const s = store();
  s.picks = prune(s.picks);
  try {
    await mkdir(path.dirname(STORE_PATH), { recursive: true });
    await writeFile(
      STORE_PATH,
      JSON.stringify({ picks: s.picks, savedAt: new Date().toISOString() }),
      "utf8"
    );
  } catch {
    /* /tmp kan faila – minnet räcker för warm instances */
  }
}

/** Bygg HistoryPick-rader för Powerplay 192 kr från en omgång. */
export function powerplay192PicksFromDraw(
  draw: DrawBundle,
  tippedAt: string
): HistoryPick[] {
  if (draw.productKind !== "powerplay") return [];
  const system = (draw.systems || []).find(
    (s) => s.costKr === POWERPLAY_DAILY_COST_KR && s.kind !== "mal"
  );
  if (!system?.picks?.length) return [];

  const costKr = POWERPLAY_DAILY_COST_KR;
  const gameKey = `powerplay:${draw.drawNumber}:${costKr}`;
  const gameLabel = `Powerplay #${draw.drawNumber} · ${costKr} kr`;

  return system.picks.map((p) => {
    const match = draw.matches.find((m) => m.eventNumber === p.eventNumber);
    return {
      id: `powerplay:${draw.drawNumber}:${costKr}:${p.eventNumber}`,
      product: "powerplay" as const,
      gameKey,
      gameLabel,
      tippedAt,
      description:
        p.description || match?.description || `Match ${p.eventNumber}`,
      home: match?.home.name || "",
      away: match?.away.name || "",
      market: "1x2" as const,
      pick: p.outcomes,
      kickoff: match?.matchStart || null,
      drawNumber: draw.drawNumber,
      eventNumber: p.eventNumber,
      eventId: null,
      status: "pending" as const,
      actual: null,
      resultNote: null,
      costKr,
    };
  });
}

/** Spara dagens Powerplay 192 kr från öppna omgångar (anropas vid draws-build). */
export async function rememberPowerplay192(
  draws: DrawBundle[],
  tippedAt = new Date().toISOString()
): Promise<HistoryPick[]> {
  await ensureLoaded();
  const s = store();
  const incoming = draws.flatMap((d) =>
    powerplay192PicksFromDraw(d, tippedAt)
  );
  if (!incoming.length) {
    s.picks = prune(s.picks);
    return s.picks.filter((p) => p.costKr === POWERPLAY_DAILY_COST_KR);
  }

  const byId = new Map(s.picks.map((p) => [p.id, p]));
  for (const p of incoming) {
    const prev = byId.get(p.id);
    if (!prev) {
      byId.set(p.id, p);
      continue;
    }
    // Behåll tidigaste tippedAt och ev. settlat resultat
    byId.set(p.id, {
      ...prev,
      ...p,
      tippedAt:
        Date.parse(prev.tippedAt) <= Date.parse(p.tippedAt)
          ? prev.tippedAt
          : p.tippedAt,
      status:
        prev.status === "won" || prev.status === "lost" ? prev.status : p.status,
      actual: prev.actual ?? p.actual,
      resultNote: prev.resultNote ?? p.resultNote,
      settledAt: prev.settledAt ?? p.settledAt ?? null,
    });
  }
  s.picks = prune([...byId.values()]);
  await persist();
  return s.picks.filter((p) => p.costKr === POWERPLAY_DAILY_COST_KR);
}

export async function listPowerplay192Picks(): Promise<HistoryPick[]> {
  await ensureLoaded();
  return prune(store().picks).filter(
    (p) => p.product === "powerplay" && p.costKr === POWERPLAY_DAILY_COST_KR
  );
}

/** Uppdatera sparade 192 kr-rader med settlat rätt/fel (24 h). */
export async function rememberPowerplay192Settled(
  settled: HistoryPick[]
): Promise<void> {
  if (!settled.length) return;
  await ensureLoaded();
  const s = store();
  const byId = new Map(s.picks.map((p) => [p.id, p]));
  for (const p of settled) {
    if (p.product !== "powerplay" || p.costKr !== POWERPLAY_DAILY_COST_KR) {
      continue;
    }
    const prev = byId.get(p.id);
    byId.set(p.id, prev ? { ...prev, ...p } : p);
  }
  s.picks = prune([...byId.values()]);
  await persist();
}
