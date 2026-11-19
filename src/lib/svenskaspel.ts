import type { Distribution, Odds, Outcome, TeamInfo } from "./types";

const DRAWS_URL = "https://api.www.svenskaspel.se/draw/1/powerplay/draws";

export type RawDraw = {
  drawNumber: number;
  productName: string;
  regCloseDescription: string;
  regCloseTime: string;
  regOpenTime: string;
  rowPrice: string;
  currentNetSale?: string;
  sport?: { name: string };
  drawEvents: RawEvent[];
};

export type RawEvent = {
  eventNumber: number;
  eventDescription: string;
  cancelled: boolean;
  odds?: { one?: string; x?: string; two?: string } | null;
  svenskaFolket?: {
    one?: string;
    x?: string;
    two?: string;
  } | null;
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

export async function fetchPowerplayDraws(): Promise<RawDraw[]> {
  const res = await fetch(DRAWS_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TryckRad/1.0 (analysverktyg)",
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Kunde inte hämta Powerplay (${res.status})`);
  }
  const data = (await res.json()) as { draws?: RawDraw[] };
  const draws = (data.draws ?? []).filter(
    (d) => Array.isArray(d.drawEvents) && d.drawEvents.length > 0
  );
  return draws.sort(
    (a, b) =>
      new Date(a.regCloseTime).getTime() - new Date(b.regCloseTime).getTime()
  );
}
