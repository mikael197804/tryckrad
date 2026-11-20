import type { Distribution, Odds, Outcome, TeamInfo } from "./types";

const DRAWS_URL = "https://api.www.svenskaspel.se/draw/1/powerplay/draws";

export type ProductKind =
  | "powerplay"
  | "topptipset"
  | "stryktipset"
  | "maltipset";

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
  };
};

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
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TryckRad/1.0 (analysverktyg)",
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Kunde inte hämta ${url} (${res.status})`);
  }
  return res.json();
}

export async function fetchPowerplayDraws(): Promise<RawDraw[]> {
  const data = (await fetchJson(DRAWS_URL)) as { draws?: RawDraw[] };
  const draws = (data.draws ?? []).filter(
    (d) => Array.isArray(d.drawEvents) && d.drawEvents.length > 0
  );
  return draws.sort(
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

/** Dagliga Topptipset-omgångar (productId 25) – t.ex. fredag 20:29. */
async function fetchDailyTopptipsetDraws(): Promise<RawDraw[]> {
  const latest = await findLatestTopptipsetDrawNumber();
  const start = Math.max(1, latest - 18);
  const end = latest + 4;
  const numbers: number[] = [];
  for (let n = start; n <= end; n++) numbers.push(n);

  const draws = (
    await Promise.all(numbers.map((n) => fetchOptionalDraw("topptipset", n)))
  ).filter((d): d is RawDraw => {
    if (!d?.drawEvents?.length) return false;
    if (d.drawState && d.drawState !== "Open") return false;
    // Hoppa över redan stängda (säkerhetsnät om state släpar)
    if (new Date(d.regCloseTime).getTime() < Date.now() - 5 * 60 * 1000) {
      return false;
    }
    return true;
  });

  return draws;
}

/** Topptipset via Stryk/Europa relatedDraws (helgkuponger). */
async function fetchRelatedTopptipsetDraws(): Promise<RawDraw[]> {
  const parents: { slug: string; toppSlug: string; productId: number }[] = [
    { slug: "stryktipset", toppSlug: "topptipsetstryk", productId: 23 },
    { slug: "europatipset", toppSlug: "topptipsetextra", productId: 24 },
  ];
  const found: RawDraw[] = [];
  const seen = new Set<string>();

  for (const parent of parents) {
    const list = (await fetchJson(
      `https://api.www.svenskaspel.se/draw/1/${parent.slug}/draws`
    )) as { draws?: RawDraw[] };

    for (const parentDraw of list.draws ?? []) {
      for (const rel of parentDraw.relatedDraws ?? []) {
        const meta = parents.find((p) => p.productId === rel.productId);
        if (!meta) continue;
        const key = `${meta.toppSlug}:${rel.drawNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const draw = await fetchOptionalDraw(meta.toppSlug, rel.drawNumber);
        if (!draw?.drawEvents?.length) continue;
        if (draw.drawState && draw.drawState !== "Open") continue;
        found.push(draw);
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

async function fetchOpenListDraws(slug: string): Promise<RawDraw[]> {
  const data = (await fetchJson(
    `https://api.www.svenskaspel.se/draw/1/${slug}/draws`
  )) as { draws?: RawDraw[] };
  return (data.draws ?? []).filter((d) => {
    if (!Array.isArray(d.drawEvents) || d.drawEvents.length === 0) return false;
    if (d.drawState && d.drawState !== "Open") return false;
    return true;
  });
}

export async function fetchStryktipsetDraws(): Promise<RawDraw[]> {
  return (await fetchOpenListDraws("stryktipset")).sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}

export async function fetchMaltipsetDraws(): Promise<RawDraw[]> {
  return (await fetchOpenListDraws("maltipset")).sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}

export async function fetchDrawsForProduct(
  product: ProductKind
): Promise<RawDraw[]> {
  if (product === "topptipset") return fetchTopptipsetDraws();
  if (product === "stryktipset") return fetchStryktipsetDraws();
  if (product === "maltipset") return fetchMaltipsetDraws();
  return fetchPowerplayDraws();
}

export function isFootballProduct(product: ProductKind): boolean {
  return (
    product === "topptipset" ||
    product === "stryktipset" ||
    product === "maltipset"
  );
}
