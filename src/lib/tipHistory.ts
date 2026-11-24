import { upstreamFetchInit } from "./fetch-mode";
import { lookupMatchScore } from "./oddsetSettle";
import type { Outcome } from "./types";

export type HistoryProduct =
  | "oddset"
  | "powerplay"
  | "topptipset"
  | "stryktipset"
  | "maltipset";

export type HistoryPickStatus = "pending" | "live" | "won" | "lost";

export type HistoryPick = {
  id: string;
  product: HistoryProduct;
  gameKey: string;
  gameLabel: string;
  tippedAt: string;
  description: string;
  home: string;
  away: string;
  market: "1x2" | "over_1_5" | "over_2_5" | "mal";
  /** T.ex. ["1","X"], ["over_1_5"] eller ["mal"]. */
  pick: string[];
  kickoff: string | null;
  drawNumber: number | null;
  eventNumber: number | null;
  eventId: number | null;
  status: HistoryPickStatus;
  actual: string | null;
  resultNote: string | null;
  /** När spelet settlades (färdigt) – resultat visas 24 h efter detta. */
  settledAt?: string | null;
  /** Systemkostnad 48–720 kr (null för Oddset). */
  costKr?: number | null;
};

export type HistoryGameSummary = {
  gameKey: string;
  product: HistoryProduct;
  label: string;
  tippedAt: string;
  total: number;
  settled: number;
  won: number;
  lost: number;
  pending: number;
  live: number;
  /** System 48–720 kr */
  costKr: number | null;
  /**
   * Systemresultat när allt är settlat:
   * vinst ≈ ≥7 rätt på 8 matcher (eller alla rätt på färre).
   */
  systemResult: "won" | "lost" | "pending";
};

export type TipHistoryResponse = {
  generatedAt: string;
  retentionHours: number;
  picks: HistoryPick[];
  games: HistoryGameSummary[];
  totals: {
    total: number;
    settled: number;
    won: number;
    lost: number;
    pending: number;
    live: number;
  };
};

export const TIP_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const TIP_HISTORY_RETENTION_HOURS = 24;

const PRODUCT_SLUG: Record<
  Exclude<HistoryProduct, "oddset">,
  string
> = {
  powerplay: "powerplay",
  topptipset: "topptipset",
  stryktipset: "stryktipset",
  maltipset: "maltipset",
};

/**
 * Behåll tips 24 h efter att spelet är färdigt.
 * Väntande tips behålls tills kickoff/tipp + 24 h så de hinner settlas.
 */
export function historyRetentionAnchorMs(p: HistoryPick): number {
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
    const at = historyRetentionAnchorMs(p);
    return Number.isFinite(at) && now - at <= TIP_HISTORY_RETENTION_MS;
  });
}

function mergePicks(groups: HistoryPick[][]): HistoryPick[] {
  const byId = new Map<string, HistoryPick>();
  for (const group of groups) {
    for (const p of group) {
      if (!p?.id) continue;
      const prev = byId.get(p.id);
      if (!prev) {
        byId.set(p.id, p);
        continue;
      }
      const rank = (s: HistoryPickStatus) =>
        s === "won" || s === "lost" ? 3 : s === "live" ? 2 : 1;
      const preferNew = rank(p.status) >= rank(prev.status);
      const base = preferNew ? p : prev;
      const other = preferNew ? prev : p;
      byId.set(p.id, {
        ...base,
        tippedAt:
          Date.parse(prev.tippedAt) <= Date.parse(p.tippedAt)
            ? prev.tippedAt
            : p.tippedAt,
        actual: base.actual ?? other.actual,
        resultNote: base.resultNote ?? other.resultNote,
        settledAt: base.settledAt ?? other.settledAt ?? null,
        costKr: base.costKr ?? other.costKr ?? null,
      });
    }
  }
  return prune([...byId.values()]).sort(
    (a, b) =>
      Date.parse(b.tippedAt) - Date.parse(a.tippedAt) ||
      a.product.localeCompare(b.product) ||
      (a.eventNumber ?? 0) - (b.eventNumber ?? 0)
  );
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(
    url,
    upstreamFetchInit({
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    })
  );
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function fetchDrawResults(
  product: Exclude<HistoryProduct, "oddset">,
  drawNumber: number
): Promise<Map<number, { outcome: Outcome; homeGoals: number | null; awayGoals: number | null }>> {
  const slug = PRODUCT_SLUG[product];
  const map = new Map<
    number,
    { outcome: Outcome; homeGoals: number | null; awayGoals: number | null }
  >();
  try {
    const [drawWrap, resWrap] = await Promise.all([
      fetchJson(
        `https://api.www.svenskaspel.se/draw/1/${slug}/draws/${drawNumber}`
      ) as Promise<{
        draw?: {
          drawState?: string;
          drawEvents?: Array<{
            eventNumber: number;
            match?: {
              result?: Array<{
                home?: string;
                away?: string;
                sportEventResultType?: string;
              }>;
            };
          }>;
        };
      }>,
      fetchJson(
        `https://api.www.svenskaspel.se/draw/1/${slug}/draws/${drawNumber}/result`
      ).catch(() => null) as Promise<{
        result?: {
          events?: Array<{ eventNumber: number; outcome?: string }>;
        };
      } | null>,
    ]);

    const draw = drawWrap.draw;
    if (!draw) return map;

    for (const e of resWrap?.result?.events || []) {
      const o = String(e.outcome || "").toUpperCase();
      if (o === "1" || o === "X" || o === "2") {
        map.set(e.eventNumber, {
          outcome: o as Outcome,
          homeGoals: null,
          awayGoals: null,
        });
      }
    }

    for (const ev of draw.drawEvents || []) {
      const ft = ev.match?.result?.find(
        (r) =>
          r.sportEventResultType === "Fulltime" ||
          r.sportEventResultType === "Current"
      );
      if (!ft) continue;
      const h = Number(ft.home);
      const a = Number(ft.away);
      if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
      const outcome: Outcome = h > a ? "1" : h < a ? "2" : "X";
      const prev = map.get(ev.eventNumber);
      map.set(ev.eventNumber, {
        outcome: prev?.outcome || outcome,
        homeGoals: h,
        awayGoals: a,
      });
    }

    // Om omgången inte är Finalized och vi saknar resultat: tomt är ok
    if (draw.drawState && draw.drawState !== "Finalized" && !map.size) {
      return map;
    }
  } catch {
    // ignore
  }
  return map;
}

async function settleOddsetPick(pick: HistoryPick): Promise<HistoryPick> {
  if (pick.status === "won" || pick.status === "lost") return pick;
  if (!pick.home || !pick.away || !pick.kickoff) return pick;
  const kick = Date.parse(pick.kickoff);
  if (Number.isFinite(kick) && Date.now() < kick + 5 * 60 * 1000) return pick;

  try {
    const score = await lookupMatchScore({
      home: pick.home,
      away: pick.away,
      kickoff: pick.kickoff,
    });
    if (!score) {
      return {
        ...pick,
        resultNote: pick.resultNote || "Väntar på slutresultat…",
      };
    }
    if (score.status === "live") {
      return {
        ...pick,
        status: "live",
        actual: `${score.homeGoals}-${score.awayGoals}`,
        resultNote: `Live ${score.homeGoals}–${score.awayGoals}`,
      };
    }
    if (pick.market === "1x2") {
      const actual =
        score.homeGoals > score.awayGoals
          ? "1"
          : score.homeGoals < score.awayGoals
            ? "2"
            : "X";
      const tipped = pick.pick[0] || "";
      const won = tipped === actual;
      return {
        ...pick,
        status: won ? "won" : "lost",
        actual: `${score.homeGoals}-${score.awayGoals}`,
        settledAt: pick.settledAt || new Date().toISOString(),
        resultNote: won
          ? `Rätt · ${score.homeGoals}–${score.awayGoals} (1X2 ${tipped})`
          : `Fel · ${score.homeGoals}–${score.awayGoals} (tippat ${tipped}, blev ${actual})`,
      };
    }
    const line = pick.market === "over_2_5" ? 2.5 : 1.5;
    const minGoals = line === 2.5 ? 3 : 2;
    const won = score.totalGoals >= minGoals;
    const label = line === 2.5 ? "2,5" : "1,5";
    return {
      ...pick,
      status: won ? "won" : "lost",
      actual: `${score.homeGoals}-${score.awayGoals}`,
      settledAt: pick.settledAt || new Date().toISOString(),
      resultNote: won
        ? `Rätt · ${score.homeGoals}–${score.awayGoals} (Över ${label})`
        : `Fel · ${score.homeGoals}–${score.awayGoals} (Under ${label})`,
    };
  } catch {
    return pick;
  }
}

async function settleDrawPicks(picks: HistoryPick[]): Promise<HistoryPick[]> {
  const groups = new Map<string, HistoryPick[]>();
  for (const p of picks) {
    if (p.product === "oddset") continue;
    if (p.drawNumber == null) continue;
    const key = `${p.product}:${p.drawNumber}`;
    const list = groups.get(key) || [];
    list.push(p);
    groups.set(key, list);
  }

  const resultsCache = new Map<
    string,
    Map<number, { outcome: Outcome; homeGoals: number | null; awayGoals: number | null }>
  >();

  const out: HistoryPick[] = [];
  for (const p of picks) {
    if (p.product === "oddset") {
      out.push(p);
      continue;
    }
    if (p.status === "won" || p.status === "lost") {
      out.push({
        ...p,
        settledAt:
          p.settledAt ||
          p.kickoff ||
          p.tippedAt ||
          new Date().toISOString(),
      });
      continue;
    }
    if (p.drawNumber == null || p.eventNumber == null) {
      out.push(p);
      continue;
    }

    const cacheKey = `${p.product}:${p.drawNumber}`;
    if (!resultsCache.has(cacheKey)) {
      resultsCache.set(
        cacheKey,
        await fetchDrawResults(p.product, p.drawNumber)
      );
    }
    const results = resultsCache.get(cacheKey)!;
    const res = results.get(p.eventNumber);
    if (!res) {
      out.push({
        ...p,
        resultNote: p.resultNote || "Väntar på slutsignal…",
      });
      continue;
    }

    const settledAt = new Date().toISOString();
    if (p.market === "1x2") {
      const hit = p.pick.includes(res.outcome);
      out.push({
        ...p,
        status: hit ? "won" : "lost",
        actual: res.outcome,
        settledAt,
        resultNote: hit
          ? `Rätt · tipset ${p.pick.join("")} träffade ${res.outcome}`
          : `Fel · tipset ${p.pick.join("")} · rätt blev ${res.outcome}`,
      });
      continue;
    }

    if (p.market === "mal") {
      if (res.homeGoals == null || res.awayGoals == null) {
        out.push({
          ...p,
          status: "pending",
          actual: res.outcome,
          resultNote: `Resultat ${res.outcome} · väntar på målantal`,
        });
        continue;
      }
      const total = res.homeGoals + res.awayGoals;
      const hit = total >= 3;
      out.push({
        ...p,
        status: hit ? "won" : "lost",
        actual: `${res.homeGoals}-${res.awayGoals}`,
        settledAt,
        resultNote: hit
          ? `Rätt · ${res.homeGoals}–${res.awayGoals} (≥3 mål)`
          : `Fel · ${res.homeGoals}–${res.awayGoals} (<3 mål)`,
      });
      continue;
    }

    out.push(p);
  }
  return out;
}

function summarize(picks: HistoryPick[]): {
  games: HistoryGameSummary[];
  totals: TipHistoryResponse["totals"];
} {
  const byGame = new Map<string, HistoryPick[]>();
  for (const p of picks) {
    const list = byGame.get(p.gameKey) || [];
    list.push(p);
    byGame.set(p.gameKey, list);
  }

  const games: HistoryGameSummary[] = [...byGame.entries()]
    .map(([gameKey, list]) => {
      const won = list.filter((x) => x.status === "won").length;
      const lost = list.filter((x) => x.status === "lost").length;
      const live = list.filter((x) => x.status === "live").length;
      const pending = list.filter((x) => x.status === "pending").length;
      const tippedAt = list
        .map((x) => x.tippedAt)
        .sort()[0] || new Date().toISOString();
      const costKr =
        list.find((x) => x.costKr != null)?.costKr ?? null;
      const settled = won + lost;
      // 8 matcher: vinst vid ≥7 rätt. Annars: alla rätt.
      const winThreshold =
        list.length >= 7 && list.length <= 9
          ? Math.max(1, list.length - 1)
          : list.length;
      let systemResult: "won" | "lost" | "pending" = "pending";
      if (settled === list.length && list.length > 0) {
        systemResult = won >= winThreshold ? "won" : "lost";
      }
      return {
        gameKey,
        product: list[0].product,
        label: list[0].gameLabel,
        tippedAt,
        total: list.length,
        settled,
        won,
        lost,
        pending,
        live,
        costKr,
        systemResult,
      };
    })
    .sort((a, b) => {
      const dt = Date.parse(b.tippedAt) - Date.parse(a.tippedAt);
      if (dt !== 0) return dt;
      return (a.costKr ?? 0) - (b.costKr ?? 0);
    });

  const won = picks.filter((x) => x.status === "won").length;
  const lost = picks.filter((x) => x.status === "lost").length;
  const live = picks.filter((x) => x.status === "live").length;
  const pending = picks.filter((x) => x.status === "pending").length;

  return {
    games,
    totals: {
      total: picks.length,
      settled: won + lost,
      won,
      lost,
      pending,
      live,
    },
  };
}

/** Settla och summera klientens sparade tips (24 h). */
export async function buildTipHistory(
  clientPicks: HistoryPick[]
): Promise<TipHistoryResponse> {
  // Dagligt Powerplay/Topptipset 192 kr från servern (sparat vid draws-build)
  let serverDaily192: HistoryPick[] = [];
  try {
    const { listDaily192Picks } = await import("./pp192History");
    serverDaily192 = await listDaily192Picks();
  } catch {
    serverDaily192 = [];
  }

  let picks = mergePicks([clientPicks, serverDaily192]);

  // Oddset först (ESPN), sedan SVS-omgångar
  const settledOddset: HistoryPick[] = [];
  for (const p of picks) {
    if (p.product === "oddset") {
      settledOddset.push(await settleOddsetPick(p));
    } else {
      settledOddset.push(p);
    }
  }
  picks = await settleDrawPicks(settledOddset);
  picks = prune(picks);

  // Skriv tillbaka settlade 192 kr till servern så resultat syns 24 h
  try {
    const { rememberDaily192Settled } = await import("./pp192History");
    await rememberDaily192Settled(
      picks.filter(
        (p) =>
          (p.product === "powerplay" || p.product === "topptipset") &&
          p.costKr === 192
      )
    );
  } catch {
    /* ignore */
  }

  const { games, totals } = summarize(picks);
  return {
    generatedAt: new Date().toISOString(),
    retentionHours: TIP_HISTORY_RETENTION_HOURS,
    picks,
    games,
    totals,
  };
}

export function productHistoryLabel(p: HistoryProduct): string {
  switch (p) {
    case "powerplay":
      return "Powerplay";
    case "topptipset":
      return "Topptipset";
    case "stryktipset":
      return "Stryktipset";
    case "maltipset":
      return "Måltipset";
    case "oddset":
      return "Oddset";
  }
}
