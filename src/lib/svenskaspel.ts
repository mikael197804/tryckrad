import { upstreamFetchInit } from "./fetch-mode";
import type { Distribution, Odds, Outcome, TeamInfo } from "./types";

const DRAWS_URL = "https://api.www.svenskaspel.se/draw/1/powerplay/draws";

export type ProductKind =
  | "powerplay"
  | "topptipset"
  | "stryktipset"
  | "europatipset"
  | "maltipset";

/** Stryk/Europa: 13 matcher, samma system (inkl. R 4-4-144). */
export function isStrykFamilyProduct(product: string): boolean {
  return product === "stryktipset" || product === "europatipset";
}

export type RawDraw = {
  drawNumber: number;
  productName: string;
  productId?: number;
  regCloseDescription: string;
  regCloseTime: string;
  regOpenTime: string;
  rowPrice: string;
  currentNetSale?: string;
  drawState?: string;
  sport?: { name: string };
  relatedDraws?: Array<{
    productId: number;
    drawNumber: number;
    regCloseTime: string;
  }>;
  drawEvents: RawEvent[];
};

export type RawMatchScore = {
  home?: string;
  away?: string;
  sportEventResultType?: string;
  description?: string;
  type?: number;
};

export type RawEvent = {
  eventNumber: number;
  eventDescription: string;
  cancelled: boolean;
  odds?: { one?: string; x?: string; two?: string } | null;
  startOdds?: { one?: string; x?: string; two?: string } | null;
  svenskaFolket?: {
    one?: string;
    x?: string;
    two?: string;
  } | null;
  providerIds?: Array<{ provider?: string; type?: string; id?: string }> | null;
  match: {
    matchId: number;
    matchStart: string;
    participants: Array<{
      id: number;
      type: "home" | "away";
      name: string;
      shortName: string;
    }>;
    league: { name: string };
    /** Live/FT-mål från Svenska Spel (90 min – inte aggregat). */
    result?: RawMatchScore[] | null;
  };
};

/** Officiell API-slug per productId – blanda aldrig kuponger. */
const PRODUCT_ID_SLUG: Record<number, string> = {
  1: "stryktipset",
  2: "europatipset",
  8: "maltipset",
  23: "topptipsetstryk",
  24: "topptipsetextra",
  25: "topptipset",
  28: "powerplay",
};

/**
 * Rätt Svenska Spel-slug för just denna kupong.
 * Topptipset / Stryk / Extra har olika drawNumber-serier.
 */
export function drawApiSlug(
  draw: Pick<RawDraw, "productId" | "productName">
): string {
  if (draw.productId != null && PRODUCT_ID_SLUG[draw.productId]) {
    return PRODUCT_ID_SLUG[draw.productId];
  }
  const name = String(draw.productName || "").toLowerCase();
  if (name.includes("topp") && name.includes("stryk")) return "topptipsetstryk";
  if (name.includes("topp") && name.includes("extra")) return "topptipsetextra";
  if (name.includes("topp")) return "topptipset";
  if (name.includes("europa")) return "europatipset";
  if (name.includes("stryk")) return "stryktipset";
  if (name.includes("mål") || name.includes("mal")) return "maltipset";
  if (name.includes("power")) return "powerplay";
  return "topptipset";
}

/**
 * 1X2-facit från Svenska Spels matchresultat.
 * Fulltime = klart (90 min). Current utan FT = live. Aldrig halvlek/aggregat.
 */
export function parseEventFacit(event: RawEvent): {
  outcome: Outcome;
  homeGoals: number;
  awayGoals: number;
  status: "ft" | "live";
} | null {
  const results = event.match?.result;
  if (!Array.isArray(results) || results.length === 0) return null;
  const ft = results.find((r) => r.sportEventResultType === "Fulltime");
  const cur = results.find((r) => r.sportEventResultType === "Current");
  const row = ft || cur;
  if (!row) return null;
  const h = Number(row.home);
  const a = Number(row.away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const outcome: Outcome = h > a ? "1" : h < a ? "2" : "X";
  return {
    outcome,
    homeGoals: h,
    awayGoals: a,
    status: ft ? "ft" : "live",
  };
}

function parseSvNumber(value: string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseOdds(raw?: RawEvent["odds"]): Odds {
  return {
    one: parseSvNumber(raw?.one),
    x: parseSvNumber(raw?.x),
    two: parseSvNumber(raw?.two),
  };
}

export function parseDistribution(
  raw?: RawEvent["svenskaFolket"]
): Distribution {
  return {
    one: parseSvNumber(raw?.one) ?? 0,
    x: parseSvNumber(raw?.x) ?? 0,
    two: parseSvNumber(raw?.two) ?? 0,
  };
}

export function favouriteFromDist(dist: Distribution): Outcome {
  const entries: [Outcome, number][] = [
    ["1", dist.one],
    ["X", dist.x],
    ["2", dist.two],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function participants(
  event: RawEvent
): { home: TeamInfo; away: TeamInfo } {
  const homeRaw = event.match.participants.find((p) => p.type === "home");
  const awayRaw = event.match.participants.find((p) => p.type === "away");
  if (!homeRaw || !awayRaw) {
    throw new Error(`Saknar lag i event ${event.eventNumber}`);
  }
  return {
    home: {
      id: homeRaw.id,
      name: homeRaw.name,
      shortName: homeRaw.shortName,
      type: "home",
    },
    away: {
      id: awayRaw.id,
      name: awayRaw.name,
      shortName: awayRaw.shortName,
      type: "away",
    },
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(
    url,
    upstreamFetchInit({
      headers: {
        Accept: "application/json",
        "User-Agent": "TryckRad/1.0 (analysverktyg)",
      },
      next: { revalidate: 60 },
    })
  );
  if (!res.ok) {
    throw new Error(`Kunde inte hämta ${url} (${res.status})`);
  }
  return res.json();
}

const HISTORY_KEEP_MS = 8 * 60 * 60 * 1000;

/** Stängda/finaliserade omgångar som fortfarande ska synas (Spelas nu + resultat). */
function isRecentClosedDraw(d: RawDraw, now = Date.now()): boolean {
  const state = String(d.drawState || "");
  if (state !== "Closed" && state !== "Finalized") return false;
  const close = Date.parse(d.regCloseTime);
  if (!Number.isFinite(close)) return false;
  return now - close <= HISTORY_KEEP_MS;
}

export async function fetchPowerplayDraws(): Promise<RawDraw[]> {
  const data = (await fetchJson(DRAWS_URL)) as { draws?: RawDraw[] };
  const listed = (data.draws ?? []).filter(
    (d) => Array.isArray(d.drawEvents) && d.drawEvents.length > 0
  );

  // List-API ger bara Open – hämta nyligen Closed/Finalized bakåt så
  // "Spelas nu" (t.ex. Örebro–Frölunda) syns i tipp + resultat.
  const openNums = listed
    .map((d) => d.drawNumber)
    .filter((n) => Number.isFinite(n));
  const lowestOpen = openNums.length ? Math.min(...openNums) : null;
  const probeFrom = lowestOpen ?? null;
  const recentClosed: RawDraw[] = [];
  if (probeFrom != null && probeFrom > 1) {
    const probes: number[] = [];
    for (let n = probeFrom - 1; n >= Math.max(1, probeFrom - 10); n--) {
      probes.push(n);
    }
    const fetched = await Promise.all(
      probes.map((n) => fetchOptionalDraw("powerplay", n))
    );
    for (const d of fetched) {
      if (!d?.drawEvents?.length) continue;
      if (!isRecentClosedDraw(d)) continue;
      recentClosed.push(d);
    }
  }

  const byNum = new Map<number, RawDraw>();
  for (const d of [...recentClosed, ...listed]) {
    byNum.set(d.drawNumber, d);
  }
  return [...byNum.values()].sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}

async function fetchOptionalDraw(
  slug: string,
  drawNumber: number
): Promise<RawDraw | null> {
  try {
    const detail = (await fetchJson(
      `https://api.www.svenskaspel.se/draw/1/${slug}/draws/${drawNumber}`
    )) as { draw?: RawDraw };
    return detail.draw ?? null;
  } catch {
    return null;
  }
}

/** Hämta en specifik Powerplay-omgång (t.ex. #4826 Spelas nu). */
export async function fetchOptionalPowerplayDraw(
  drawNumber: number
): Promise<RawDraw | null> {
  return fetchOptionalDraw("powerplay", drawNumber);
}

/** Hitta högsta befintliga Topptipset-drawNumber (list-API kräver nyckel). */
async function findLatestTopptipsetDrawNumber(): Promise<number> {
  // Expansiv sökning uppåt, sedan binärsök i sista fönstret
  let step = 64;
  let probe = 4400;
  let best = 4400;
  const first = await fetchOptionalDraw("topptipset", probe);
  if (!first) {
    probe = 1;
    step = 256;
  } else {
    best = probe;
  }

  while (probe < 20000) {
    const next = probe + step;
    const draw = await fetchOptionalDraw("topptipset", next);
    if (draw) {
      best = next;
      probe = next;
      step = Math.min(step * 2, 512);
    } else {
      break;
    }
  }

  let lo = best + 1;
  let hi = probe + step;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const draw = await fetchOptionalDraw("topptipset", mid);
    if (draw) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Öppen tipp eller nyligen stängd (Spelas nu / facit inom HISTORY_KEEP_MS). */
function isOpenOrRecentResultDraw(
  d: RawDraw | null | undefined,
  now = Date.now()
): boolean {
  if (!d?.drawEvents?.length) return false;
  const state = String(d.drawState || "");
  if (state === "Closed" || state === "Finalized") {
    return isRecentClosedDraw(d, now);
  }
  // Open / okänd – hoppa över om stängningstid redan passerat med marginal
  if (new Date(d.regCloseTime).getTime() < now - 5 * 60 * 1000) {
    return false;
  }
  return true;
}

/** Dagliga Topptipset-omgångar (productId 25) – inkl. nyligen stängda för facit. */
async function fetchDailyTopptipsetDraws(): Promise<RawDraw[]> {
  const latest = await findLatestTopptipsetDrawNumber();
  const start = Math.max(1, latest - 18);
  const end = latest + 4;
  const numbers: number[] = [];
  for (let n = start; n <= end; n++) numbers.push(n);

  const draws = (
    await Promise.all(numbers.map((n) => fetchOptionalDraw("topptipset", n)))
  ).filter((d): d is RawDraw => isOpenOrRecentResultDraw(d));

  return draws;
}

/** Topptipset via Stryk/Europa relatedDraws (helgkuponger) – rätt slug per nation/kupong. */
async function fetchRelatedTopptipsetDraws(): Promise<RawDraw[]> {
  const parents: { slug: string; toppSlug: string; productId: number }[] = [
    { slug: "stryktipset", toppSlug: "topptipsetstryk", productId: 23 },
    { slug: "europatipset", toppSlug: "topptipsetextra", productId: 24 },
  ];
  const found: RawDraw[] = [];
  const seen = new Set<string>();

  async function absorbRelated(parentDraw: RawDraw) {
    for (const rel of parentDraw.relatedDraws ?? []) {
      const meta = parents.find((p) => p.productId === rel.productId);
      if (!meta) continue;
      const key = `${meta.toppSlug}:${rel.drawNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const draw = await fetchOptionalDraw(meta.toppSlug, rel.drawNumber);
      if (!draw || !isOpenOrRecentResultDraw(draw)) continue;
      found.push(draw);
    }
  }

  for (const parent of parents) {
    const list = (await fetchJson(
      `https://api.www.svenskaspel.se/draw/1/${parent.slug}/draws`
    )) as { draws?: RawDraw[] };

    const listed = list.draws ?? [];
    for (const parentDraw of listed) {
      await absorbRelated(parentDraw);
    }

    // List-API tappar stängda föräldrar – sondera bakåt så facit syns
    const openNums = listed
      .map((d) => d.drawNumber)
      .filter((n) => Number.isFinite(n));
    const lowestOpen = openNums.length ? Math.min(...openNums) : null;
    if (lowestOpen != null && lowestOpen > 1) {
      const probes: number[] = [];
      for (let n = lowestOpen - 1; n >= Math.max(1, lowestOpen - 4); n--) {
        probes.push(n);
      }
      const closedParents = await Promise.all(
        probes.map((n) => fetchOptionalDraw(parent.slug, n))
      );
      for (const pd of closedParents) {
        if (!pd || !isRecentClosedDraw(pd)) continue;
        await absorbRelated(pd);
      }
    }
  }

  return found;
}

/**
 * Topptipset list kräver accesskey.
 * Hämtar: (1) dagliga topptipset-omgångar + (2) Stryk/Europa-relaterade.
 */
export async function fetchTopptipsetDraws(): Promise<RawDraw[]> {
  const [daily, related] = await Promise.all([
    fetchDailyTopptipsetDraws(),
    fetchRelatedTopptipsetDraws(),
  ]);

  const found: RawDraw[] = [];
  const seen = new Set<string>();
  for (const draw of [...daily, ...related]) {
    const key = `${draw.productId ?? draw.productName}:${draw.drawNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(draw);
  }

  return found.sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}

/** Öppna + nyligen stängda omgångar (facit / Spelas nu) för list-API-produkter. */
async function fetchListWithRecentClosed(slug: string): Promise<RawDraw[]> {
  const data = (await fetchJson(
    `https://api.www.svenskaspel.se/draw/1/${slug}/draws`
  )) as { draws?: RawDraw[] };
  const listed = (data.draws ?? []).filter(
    (d) => Array.isArray(d.drawEvents) && d.drawEvents.length > 0
  );
  const openListed = listed.filter(
    (d) => !d.drawState || d.drawState === "Open"
  );

  const openNums = openListed
    .map((d) => d.drawNumber)
    .filter((n) => Number.isFinite(n));
  const lowestOpen = openNums.length ? Math.min(...openNums) : null;
  const recentClosed: RawDraw[] = [];
  if (lowestOpen != null && lowestOpen > 1) {
    const probes: number[] = [];
    for (let n = lowestOpen - 1; n >= Math.max(1, lowestOpen - 6); n--) {
      probes.push(n);
    }
    const fetched = await Promise.all(
      probes.map((n) => fetchOptionalDraw(slug, n))
    );
    for (const d of fetched) {
      if (!d?.drawEvents?.length) continue;
      if (!isRecentClosedDraw(d)) continue;
      recentClosed.push(d);
    }
  }

  const byNum = new Map<number, RawDraw>();
  for (const d of [...recentClosed, ...openListed]) {
    byNum.set(d.drawNumber, d);
  }
  return [...byNum.values()];
}

export async function fetchStryktipsetDraws(): Promise<RawDraw[]> {
  return (await fetchListWithRecentClosed("stryktipset")).sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}

export async function fetchEuropatipsetDraws(): Promise<RawDraw[]> {
  return (await fetchListWithRecentClosed("europatipset")).sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}

export async function fetchMaltipsetDraws(): Promise<RawDraw[]> {
  return (await fetchListWithRecentClosed("maltipset")).sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}

export async function fetchDrawsForProduct(
  product: ProductKind
): Promise<RawDraw[]> {
  if (product === "topptipset") return fetchTopptipsetDraws();
  if (product === "stryktipset") return fetchStryktipsetDraws();
  if (product === "europatipset") return fetchEuropatipsetDraws();
  if (product === "maltipset") return fetchMaltipsetDraws();
  return fetchPowerplayDraws();
}

export function isFootballProduct(product: ProductKind): boolean {
  return (
    product === "topptipset" ||
    product === "stryktipset" ||
    product === "europatipset" ||
    product === "maltipset"
  );
}
