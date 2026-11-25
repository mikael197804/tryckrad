import { upstreamFetchInit } from "./fetch-mode";

const ATG_BASE = "https://www.atg.se/services/racinginfo/v1/api";

/** ATG märkningsspel vi analyserar (samma tipplogik). */
export type AtgPoolProduct = "V75" | "V64";

export type AtgGameSummary = {
  id: string;
  status: string;
  startTime?: string;
  scheduledStartTime?: string;
  tracks?: number[];
  races?: string[];
  jackpotAmount?: number;
  estimatedJackpot?: number;
  newBettingSystem?: boolean;
};

export type AtgHomeTrack = { id: number; name: string };

export type AtgStart = {
  id: number | string;
  number: number;
  postPosition?: number;
  distance?: number;
  scratched?: boolean;
  horse: {
    id: number;
    name: string;
    age?: number;
    sex?: string;
    homeTrack?: AtgHomeTrack | null;
    trainer?: {
      firstName?: string;
      lastName?: string;
      homeTrack?: AtgHomeTrack | null;
    } | null;
    statistics?: {
      life?: {
        starts?: number;
        earnings?: number;
        placement?: Record<string, number>;
        winPercentage?: number;
        placePercentage?: number;
      };
      lastFiveStarts?: { averageOdds?: number };
      years?: Record<
        string,
        {
          starts?: number;
          earnings?: number;
          placement?: Record<string, number>;
          winPercentage?: number;
        }
      >;
    };
  };
  driver?: {
    id?: number;
    firstName?: string;
    lastName?: string;
    shortName?: string;
    homeTrack?: AtgHomeTrack | null;
  } | null;
  pools?: {
    vinnare?: { odds?: number };
    plats?: { minOdds?: number; maxOdds?: number };
    V75?: { betDistribution?: number; trend?: number };
    V64?: { betDistribution?: number; trend?: number };
  };
};

export type AtgRace = {
  id: string;
  name?: string;
  number: number;
  date?: string;
  startTime?: string;
  scheduledStartTime?: string;
  distance?: number;
  startMethod?: string;
  status?: string;
  prize?: string;
  terms?: string[];
  track?: AtgHomeTrack & { countryCode?: string };
  starts?: AtgStart[];
};

export type AtgGame = {
  id: string;
  type: string;
  status: string;
  newBettingSystem?: boolean;
  races: AtgRace[];
  pools?: {
    V75?: {
      turnover?: number;
      jackpotAmount?: number;
      status?: string;
      addOns?: string[];
    };
    V64?: {
      turnover?: number;
      jackpotAmount?: number;
      status?: string;
      addOns?: string[];
    };
  };
};

async function atgFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${ATG_BASE}${path}`, {
    ...upstreamFetchInit({
      headers: {
        Accept: "application/json",
        "User-Agent": "MikaelsTips/1.0 (ATG)",
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`ATG ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Odds från ATG lagras ×100 (2832 → 28,32). */
export function atgOddsToDecimal(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round((raw / 100) * 100) / 100;
}

/** V75/V64 betDistribution lagras ×100 (5607 → 56,07 %). */
export function atgDistToPct(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  return Math.round((raw / 100) * 100) / 100;
}

export function atgPoolDistRaw(
  start: AtgStart,
  product: AtgPoolProduct
): number | null {
  const pools = start.pools;
  if (!pools) return null;
  const raw =
    product === "V64"
      ? pools.V64?.betDistribution
      : pools.V75?.betDistribution;
  return raw ?? null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Hitta närmaste V75/V64 (öppen/kommande) inom ±dagar. */
export async function findUpcomingAtgPool(
  product: AtgPoolProduct,
  lookAheadDays = 10,
  lookBackDays = 1
): Promise<{ date: string; summary: AtgGameSummary } | null> {
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  const candidates: Array<{
    date: string;
    summary: AtgGameSummary;
    rank: number;
    start: string;
  }> = [];

  for (let offset = -lookBackDays; offset <= lookAheadDays; offset++) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + offset);
    const date = ymd(day);
    try {
      const cal = await atgFetch<{
        games?: Record<string, AtgGameSummary[]>;
      }>(`/calendar/day/${date}`);
      const list = cal.games?.[product] || [];
      for (const g of list) {
        const status = String(g.status || "").toLowerCase();
        const rank =
          status === "bettable"
            ? 0
            : status === "upcoming"
              ? 1
              : status === "results" || status === "finalized"
                ? 3
                : 2;
        candidates.push({
          date,
          summary: g,
          rank,
          start: g.startTime || g.scheduledStartTime || date,
        });
      }
    } catch {
      /* skip day */
    }
  }

  if (!candidates.length) return null;
  candidates.sort(
    (a, b) => a.rank - b.rank || a.start.localeCompare(b.start)
  );
  const best = candidates[0];
  return { date: best.date, summary: best.summary };
}

/** @deprecated Använd findUpcomingAtgPool("V75") */
export async function findUpcomingV75(
  lookAheadDays = 10,
  lookBackDays = 1
): Promise<{ date: string; summary: AtgGameSummary } | null> {
  return findUpcomingAtgPool("V75", lookAheadDays, lookBackDays);
}

export async function findUpcomingV64(
  lookAheadDays = 10,
  lookBackDays = 1
): Promise<{ date: string; summary: AtgGameSummary } | null> {
  return findUpcomingAtgPool("V64", lookAheadDays, lookBackDays);
}

export async function fetchAtgGame(gameId: string): Promise<AtgGame> {
  return atgFetch<AtgGame>(`/games/${gameId}`);
}

/** @deprecated Använd fetchAtgGame */
export async function fetchV75Game(gameId: string): Promise<AtgGame> {
  return fetchAtgGame(gameId);
}

/** Tidigare start från /races/{id}/start/{n} – firstPrize i öre. */
export type AtgPriorRecord = {
  date?: string;
  odds?: number;
  place?: string;
  race?: {
    id?: string;
    number?: number;
    firstPrize?: number;
    startMethod?: string;
  };
  track?: { id?: number; name?: string };
};

export type AtgStartDetail = {
  raceId: string;
  startNumber: number;
  horse?: {
    id?: number;
    name?: string;
    money?: number;
    results?: {
      records?: AtgPriorRecord[];
      hasMoreRecords?: boolean;
    };
  };
};

export async function fetchStartDetail(
  raceId: string,
  startNumber: number
): Promise<AtgStartDetail | null> {
  try {
    return await atgFetch<AtgStartDetail>(
      `/races/${raceId}/start/${startNumber}`
    );
  } catch {
    return null;
  }
}

/** Hämta startdetaljer (historik) med begränsad parallellitet. */
export async function fetchStartDetailsForRace(
  raceId: string,
  startNumbers: number[],
  concurrency = 5
): Promise<Map<number, AtgStartDetail>> {
  const map = new Map<number, AtgStartDetail>();
  for (let i = 0; i < startNumbers.length; i += concurrency) {
    const slice = startNumbers.slice(i, i + concurrency);
    const rows = await Promise.all(
      slice.map(async (n) => {
        const d = await fetchStartDetail(raceId, n);
        return d ? ([n, d] as const) : null;
      })
    );
    for (const row of rows) {
      if (row) map.set(row[0], row[1]);
    }
  }
  return map;
}

export function personName(
  p: { firstName?: string; lastName?: string; shortName?: string } | null | undefined
): string {
  if (!p) return "";
  const full = `${p.firstName || ""} ${p.lastName || ""}`.trim();
  return full || p.shortName || "";
}
