import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { DAILY_SYSTEM_COST_KR } from "./systems";
import type { DrawBundle } from "./types";
import type { HistoryPick, HistoryProduct } from "./tipHistoryShared";

/**
 * Dagligt 192 kr-system för Powerplay och Topptipset –
 * sparas server-side och visas i resultat 8 h.
 */

const STORE_PATH = path.join("/tmp", "mikaels-daily192-history.json");
const RETENTION_MS = 8 * 60 * 60 * 1000;

const DAILY_PRODUCTS = new Set<HistoryProduct>(["powerplay", "topptipset"]);

type GlobalStore = {
  picks: HistoryPick[];
  loaded: boolean;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & {
    __mikaelsDaily192History?: GlobalStore;
  };
  if (!g.__mikaelsDaily192History) {
    g.__mikaelsDaily192History = { picks: [], loaded: false };
  }
  return g.__mikaelsDaily192History;
}

function productLabel(product: HistoryProduct): string {
  if (product === "topptipset") return "Topptipset";
  if (product === "powerplay") return "Powerplay";
  return product;
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
    const kick = p.kickoff ? Date.parse(p.kickoff) : NaN;
    if (Number.isFinite(kick) && kick > now) return false;
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
    /* ingen fil ännu – prova gamla PP-filen en gång */
    try {
      const legacy = await readFile(
        path.join("/tmp", "mikaels-pp192-history.json"),
        "utf8"
      );
      const parsed = JSON.parse(legacy) as { picks?: HistoryPick[] };
      if (Array.isArray(parsed.picks)) s.picks = prune(parsed.picks);
    } catch {
      /* ignore */
    }
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

function isDailyProduct(
  product: string
): product is "powerplay" | "topptipset" {
  return DAILY_PRODUCTS.has(product as HistoryProduct);
}

/** Bygg HistoryPick-rader för 192 kr från en Powerplay/Topptipset-omgång. */
export function daily192PicksFromDraw(
  draw: DrawBundle,
  tippedAt: string
): HistoryPick[] {
  if (!isDailyProduct(draw.productKind)) return [];
  const system = (draw.systems || []).find(
    (s) => s.costKr === DAILY_SYSTEM_COST_KR && s.kind !== "mal"
  );
  if (!system?.picks?.length) return [];

  const product = draw.productKind;
  const costKr = DAILY_SYSTEM_COST_KR;
  const gameKey = `${product}:${draw.drawNumber}:${costKr}`;
  const first = draw.matches[0];
  const firstLabel = first
    ? `${first.home.name}–${first.away.name}`
    : null;
  const state = String(draw.drawState || "");
  const playing =
    state === "Closed" ||
    (state !== "Finalized" &&
      Number.isFinite(Date.parse(draw.closeTime)) &&
      Date.parse(draw.closeTime) <= Date.now());
  const gameLabel = [
    `${productLabel(product)} #${draw.drawNumber}`,
    playing ? "Spelas nu" : null,
    firstLabel,
    `${costKr} kr`,
  ]
    .filter(Boolean)
    .join(" · ");

  return system.picks.map((p) => {
    const match = draw.matches.find((m) => m.eventNumber === p.eventNumber);
    return {
      id: `${product}:${draw.drawNumber}:${costKr}:${p.eventNumber}`,
      product,
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

/** @deprecated Använd daily192PicksFromDraw */
export const powerplay192PicksFromDraw = daily192PicksFromDraw;

/** Spara dagens 192 kr från öppna omgångar (Powerplay eller Topptipset). */
export async function rememberDaily192(
  draws: DrawBundle[],
  tippedAt = new Date().toISOString()
): Promise<HistoryPick[]> {
  await ensureLoaded();
  const s = store();
  // Bara omgångar som stängt / spelas nu – inte framtida öppna tipp
  const started = draws.filter((d) => {
    const state = String(d.drawState || "");
    if (state === "Closed" || state === "Finalized") return true;
    const close = Date.parse(d.closeTime);
    return Number.isFinite(close) && close <= Date.now();
  });
  const incoming = started
    .flatMap((d) => daily192PicksFromDraw(d, tippedAt))
    .filter((p) => {
      const kick = p.kickoff ? Date.parse(p.kickoff) : NaN;
      return !Number.isFinite(kick) || kick <= Date.now();
    });
  if (!incoming.length) {
    s.picks = prune(s.picks);
    return s.picks.filter((p) => p.costKr === DAILY_SYSTEM_COST_KR);
  }

  const byId = new Map(s.picks.map((p) => [p.id, p]));
  for (const p of incoming) {
    const prev = byId.get(p.id);
    if (!prev) {
      byId.set(p.id, p);
      continue;
    }
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
  return s.picks.filter((p) => p.costKr === DAILY_SYSTEM_COST_KR);
}

/** @deprecated Använd rememberDaily192 */
export const rememberPowerplay192 = rememberDaily192;

export async function listDaily192Picks(): Promise<HistoryPick[]> {
  await ensureLoaded();
  return prune(store().picks).filter(
    (p) =>
      isDailyProduct(p.product) && p.costKr === DAILY_SYSTEM_COST_KR
  );
}

/** @deprecated Använd listDaily192Picks */
export const listPowerplay192Picks = listDaily192Picks;

/** Uppdatera sparade 192 kr-rader med settlat rätt/fel (8 h). */
export async function rememberDaily192Settled(
  settled: HistoryPick[]
): Promise<void> {
  if (!settled.length) return;
  await ensureLoaded();
  const s = store();
  const byId = new Map(s.picks.map((p) => [p.id, p]));
  for (const p of settled) {
    if (!isDailyProduct(p.product) || p.costKr !== DAILY_SYSTEM_COST_KR) {
      continue;
    }
    const prev = byId.get(p.id);
    byId.set(p.id, prev ? { ...prev, ...p } : p);
  }
  s.picks = prune([...byId.values()]);
  await persist();
}

/** @deprecated Använd rememberDaily192Settled */
export const rememberPowerplay192Settled = rememberDaily192Settled;
