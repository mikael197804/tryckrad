import { upstreamFetchInit } from "./fetch-mode";
import { lookupMatchScore } from "./oddsetSettle";
import type { Outcome } from "./types";

export type HistoryProduct =
  | "oddset"
  | "powerplay"
  | "topptipset"
  | "stryktipset"
  | "europatipset"
  | "maltipset"
  | "esports_battle";

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
  /** När spelet settlades (färdigt) – resultat visas 8 h efter detta. */
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
   * Powerplay/Topptipset = endast 8 rätt (annars ingen utdelning).
   * Övriga: ≈ ≥7 rätt på 8 matcher (eller alla rätt på färre).
   */
  systemResult: "won" | "lost" | "pending";
  /** Officiell utdelning från Svenska Spel, t.ex. "8 rätt · 601,18". */
  payoutLabel?: string | null;
  drawNumber?: number | null;
};

/** PP/Topp kräver fullträff (8 rätt). Övriga: en miss ok på 8-matcher. */
export function systemWinThreshold(
  product: HistoryProduct,
  total: number
): number {
  if (product === "powerplay" || product === "topptipset") {
    return total;
  }
  if (total >= 7 && total <= 9) {
    return Math.max(1, total - 1);
  }
  return total;
}

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

export const TIP_HISTORY_RETENTION_MS = 8 * 60 * 60 * 1000;
export const TIP_HISTORY_RETENTION_HOURS = 8;

const PRODUCT_SLUG: Record<
  Exclude<HistoryProduct, "oddset" | "esports_battle">,
  string
> = {
  powerplay: "powerplay",
  topptipset: "topptipset",
  stryktipset: "stryktipset",
  europatipset: "europatipset",
  maltipset: "maltipset",
};

/**
 * Behåll tips 8 h efter att spelet är färdigt / startat.
 * Framtida matcher (kickoff > nu) hör inte hemma i resultat.
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

/** true om matchen/tippet fortfarande ligger i framtiden. */
export function isFutureHistoryPick(
  p: HistoryPick,
  now = Date.now()
): boolean {
  const kick = p.kickoff ? Date.parse(p.kickoff) : NaN;
  if (Number.isFinite(kick) && kick > now) return true;
  return false;
}

function prune(picks: HistoryPick[], now = Date.now()): HistoryPick[] {
  return picks.filter((p) => {
    if (isFutureHistoryPick(p, now)) return false;
    const at = historyRetentionAnchorMs(p);
    return Number.isFinite(at) && now - at <= TIP_HISTORY_RETENTION_MS;
  });
}

/** Tolka 1X2 från "2" eller "1-2". */
function outcomeFromActual(actual: string | null | undefined): Outcome | null {
  if (!actual) return null;
  const s = String(actual).trim().toUpperCase();
  if (s === "1" || s === "X" || s === "2") return s as Outcome;
  const m = s.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  if (h > a) return "1";
  if (h < a) return "2";
  return "X";
}

/** 1X mot slutsignal 2 ska alltid bli fel – rätta motstridig status. */
function correctOneXTwoStatus(p: HistoryPick): HistoryPick {
  if (p.market !== "1x2") return p;
  const result = outcomeFromActual(p.actual);
  if (!result) return p;
  const hit = p.pick.includes(result);
  const status: HistoryPickStatus = hit ? "won" : "lost";
  if (status === p.status) return p;
  return {
    ...p,
    status,
    settledAt: p.settledAt || new Date().toISOString(),
    resultNote: hit
      ? `Rätt · ${p.actual} (tipset ${p.pick.join("")} → ${result})`
      : `Fel · ${p.actual} (tipset ${p.pick.join("")}, blev ${result})`,
  };
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
  product: Exclude<HistoryProduct, "oddset" | "esports_battle">,
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
          events?: Array<{
            eventNumber: number;
            outcome?: string;
            participantType?: string;
            outcomeScore?: { home?: number; away?: number };
          }>;
        };
      } | null>,
    ]);

    const draw = drawWrap.draw;
    if (!draw) return map;

    // Result-API: officiellt utfall + mål (gäller även spelarspecialer)
    const playerEvents = new Set<number>();
    for (const e of resWrap?.result?.events || []) {
      const o = String(e.outcome || "").toUpperCase();
      if (o !== "1" && o !== "X" && o !== "2") continue;
      const hs = e.outcomeScore?.home;
      const as = e.outcomeScore?.away;
      const homeGoals =
        hs != null && Number.isFinite(Number(hs)) ? Number(hs) : null;
      const awayGoals =
        as != null && Number.isFinite(Number(as)) ? Number(as) : null;
      if (String(e.participantType || "").toLowerCase() === "player") {
        playerEvents.add(e.eventNumber);
      }
      map.set(e.eventNumber, {
        outcome: o as Outcome,
        homeGoals,
        awayGoals,
      });
    }

    // Draw-events FT/Current som komplement – skriv inte över result-API:s mål
    // (spelarspecialer kan felaktigt ärva lagmatchens FT, t.ex. 2–5).
    for (const ev of draw.drawEvents || []) {
      if (playerEvents.has(ev.eventNumber)) continue;
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
        homeGoals: prev?.homeGoals ?? h,
        awayGoals: prev?.awayGoals ?? a,
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

/** Spelarspecial (t.ex. Stenberg–Kaprizov) finns inte på Flashscore. */
function looksLikePlayerSpecial(pick: HistoryPick): boolean {
  const blob = `${pick.home} ${pick.away} ${pick.description}`.toLowerCase();
  // Lagmarkörer som NHL/SHL-lag brukar ha – saknas ofta på personnamn
  if (
    /\b(fc|if|bk|sk|hc|hk|ik|aik|ifk|jets|ducks|devils|kings|flames|leafs|kraken|sharks|wild|oilers|bruins|sabres|rangers|senators|canadiens|mammoth)\b/i.test(
      blob
    )
  ) {
    return false;
  }
  // Två personnamn utan lag-suffix
  const homeParts = pick.home.trim().split(/\s+/);
  const awayParts = pick.away.trim().split(/\s+/);
  return homeParts.length >= 2 && awayParts.length >= 2;
}

/** Settla ett tips via Flashscore (mål + 1X2 / över / måltips). */
async function settlePickViaFlashscore(
  pick: HistoryPick
): Promise<HistoryPick | null> {
  if (!pick.home || !pick.away || !pick.kickoff) return null;
  if (looksLikePlayerSpecial(pick)) return null;
  const kick = Date.parse(pick.kickoff);
  if (Number.isFinite(kick) && Date.now() < kick + 5 * 60 * 1000) return null;

  try {
    const score = await lookupMatchScore({
      home: pick.home,
      away: pick.away,
      kickoff: pick.kickoff,
    });
    if (!score) return null;

    const via =
      score.sourceName?.startsWith("Flashscore") ? "Flashscore" : "resultat";

    if (score.status === "live") {
      return {
        ...pick,
        status: "live",
        actual: `${score.homeGoals}-${score.awayGoals}`,
        resultNote: `Live ${score.homeGoals}–${score.awayGoals} · ${via}`,
      };
    }

    if (pick.market === "1x2") {
      const actual =
        score.homeGoals > score.awayGoals
          ? "1"
          : score.homeGoals < score.awayGoals
            ? "2"
            : "X";
      const hit = pick.pick.includes(actual);
      return {
        ...pick,
        status: hit ? "won" : "lost",
        actual: `${score.homeGoals}-${score.awayGoals}`,
        settledAt: pick.settledAt || new Date().toISOString(),
        resultNote: hit
          ? `Rätt · ${score.homeGoals}–${score.awayGoals} (1X2 ${pick.pick.join("")}) · ${via}`
          : `Fel · ${score.homeGoals}–${score.awayGoals} (tippat ${pick.pick.join("")}, blev ${actual}) · ${via}`,
      };
    }

    if (pick.market === "mal") {
      const hit = score.totalGoals >= 3;
      return {
        ...pick,
        status: hit ? "won" : "lost",
        actual: `${score.homeGoals}-${score.awayGoals}`,
        settledAt: pick.settledAt || new Date().toISOString(),
        resultNote: hit
          ? `Rätt · ${score.homeGoals}–${score.awayGoals} (≥3 mål) · ${via}`
          : `Fel · ${score.homeGoals}–${score.awayGoals} (<3 mål) · ${via}`,
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
        ? `Rätt · ${score.homeGoals}–${score.awayGoals} (Över ${label}) · ${via}`
        : `Fel · ${score.homeGoals}–${score.awayGoals} (Under ${label}) · ${via}`,
    };
  } catch {
    return null;
  }
}

async function settleOddsetPick(pick: HistoryPick): Promise<HistoryPick> {
  if (pick.status === "won" || pick.status === "lost") return pick;
  const settled = await settlePickViaFlashscore(pick);
  if (settled) return settled;
  if (!pick.home || !pick.away || !pick.kickoff) return pick;
  return {
    ...pick,
    resultNote: pick.resultNote || "Väntar på Flashscore…",
  };
}

async function settleDrawPicks(picks: HistoryPick[]): Promise<HistoryPick[]> {
  const resultsCache = new Map<
    string,
    Map<number, { outcome: Outcome; homeGoals: number | null; awayGoals: number | null }>
  >();

  const out: HistoryPick[] = [];
  for (const p of picks) {
    if (p.product === "oddset" || p.product === "esports_battle") {
      out.push(p);
      continue;
    }
    const alreadySettled = p.status === "won" || p.status === "lost";
    // Spelarspecialer: tillåt rättning av fel måltal även om redan settlat
    const needsPlayerScoreFix =
      alreadySettled && looksLikePlayerSpecial(p);

    if (alreadySettled && !needsPlayerScoreFix) {
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

    // Primärt: Flashscore via lagnamn + kickoff (alla spelformer)
    if (!alreadySettled) {
      const viaFs = await settlePickViaFlashscore(p);
      if (viaFs) {
        out.push(viaFs);
        continue;
      }
    }

    // Backup: Svenska Spels omgångsresultat
    if (p.drawNumber == null || p.eventNumber == null) {
      out.push({
        ...p,
        resultNote: p.resultNote || "Väntar på Flashscore…",
      });
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
        settledAt: p.settledAt || new Date().toISOString(),
        resultNote: p.resultNote || "Väntar på Flashscore…",
      });
      continue;
    }

    const settledAt = p.settledAt || new Date().toISOString();
    if (p.market === "1x2") {
      const hit = p.pick.includes(res.outcome);
      const actual =
        res.homeGoals != null && res.awayGoals != null
          ? `${res.homeGoals}-${res.awayGoals}`
          : res.outcome;
      out.push({
        ...p,
        status: hit ? "won" : "lost",
        actual,
        settledAt,
        resultNote: hit
          ? `Rätt · ${actual} (tipset ${p.pick.join("")} → ${res.outcome}) · Svenska Spel`
          : `Fel · ${actual} (tipset ${p.pick.join("")}, blev ${res.outcome}) · Svenska Spel`,
      });
      continue;
    }

    if (p.market === "mal") {
      if (res.homeGoals == null || res.awayGoals == null) {
        out.push({
          ...p,
          status: "pending",
          actual: res.outcome,
          resultNote: `Resultat ${res.outcome} · väntar på målantal (Flashscore)`,
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

type PayoutTier = Array<{
  name: string;
  amount?: string | null;
  odds?: string | null;
  winners?: number;
}>;

const payoutCache = new Map<string, { at: number; tiers: PayoutTier }>();

async function fetchDrawPayoutTiers(
  product: Exclude<HistoryProduct, "oddset" | "esports_battle">,
  drawNumber: number
): Promise<PayoutTier> {
  const key = `${product}:${drawNumber}`;
  const cached = payoutCache.get(key);
  if (cached && Date.now() - cached.at < 120_000) return cached.tiers;
  const slug = PRODUCT_SLUG[product];
  try {
    const wrap = (await fetchJson(
      `https://api.www.svenskaspel.se/draw/1/${slug}/draws/${drawNumber}/result`
    )) as {
      result?: {
        distribution?: Array<{
          name?: string;
          amount?: string;
          odds?: string;
          winners?: number;
        }>;
      };
    };
    const tiers = (wrap.result?.distribution || [])
      .filter((d) => d?.name)
      .map((d) => ({
        name: String(d.name),
        amount: d.amount ?? null,
        odds: d.odds ?? null,
        winners: d.winners,
      }));
    payoutCache.set(key, { at: Date.now(), tiers });
    return tiers;
  } catch {
    payoutCache.set(key, { at: Date.now(), tiers: [] });
    return [];
  }
}

function formatPayoutLabel(
  tiers: PayoutTier,
  correctCount: number
): string | null {
  if (!tiers.length) return null;
  const exact =
    tiers.find((t) => {
      const m = t.name.match(/(\d+)\s*rätt/i);
      return m && Number(m[1]) === correctCount;
    }) || null;
  // Bara visa utdelning för exakt rätt nivå (PP/Topp = 8 rätt)
  if (!exact) return null;
  const value = exact.amount || exact.odds;
  if (!value || value === "0" || value === "0,00") return null;
  const suffix = exact.amount ? " kr" : "";
  return `${exact.name} · ${value}${suffix}`;
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
      const drawNumber =
        list.find((x) => x.drawNumber != null)?.drawNumber ?? null;
      const settled = won + lost;
      const winThreshold = systemWinThreshold(list[0].product, list.length);
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
        payoutLabel: null,
        drawNumber,
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

async function attachPayouts(
  games: HistoryGameSummary[]
): Promise<HistoryGameSummary[]> {
  return Promise.all(
    games.map(async (g) => {
      if (g.systemResult !== "won") return g;
      if (g.product === "oddset" || g.product === "esports_battle") return g;
      if (g.drawNumber == null) return g;
      try {
        const tiers = await fetchDrawPayoutTiers(g.product, g.drawNumber);
        const payoutLabel = formatPayoutLabel(tiers, g.won);
        return { ...g, payoutLabel };
      } catch {
        return g;
      }
    })
  );
}

/** Settla och summera klientens sparade tips (8 h). */
export async function buildTipHistory(
  clientPicks: HistoryPick[]
): Promise<TipHistoryResponse> {
  // Dagligt Powerplay/Topptipset 192 kr från servern (sparat vid draws-build).
  // Klienten skickar tippvyns omgångar (t.ex. #4826) i POST-bodyn – ingen
  // tung warm här (timeout på Vercel tömde annars resultatbiblioteket).
  let serverDaily192: HistoryPick[] = [];
  try {
    const { listDaily192Picks } = await import("./pp192History");
    serverDaily192 = await listDaily192Picks();
  } catch {
    serverDaily192 = [];
  }

  let picks = mergePicks([clientPicks, serverDaily192]);

  // Oddset + omgångsspel: Flashscore först (ESPN/SVS som backup)
  const settledOddset: HistoryPick[] = [];
  for (const p of picks) {
    if (p.product === "oddset") {
      settledOddset.push(await settleOddsetPick(p));
    } else {
      settledOddset.push(p);
    }
  }
  picks = await settleDrawPicks(settledOddset);
  picks = prune(picks).map(correctOneXTwoStatus);

  // Skriv tillbaka settlade 192 kr till servern så resultat syns 8 h
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
  const gamesWithPayout = await attachPayouts(games);
  return {
    generatedAt: new Date().toISOString(),
    retentionHours: TIP_HISTORY_RETENTION_HOURS,
    picks,
    games: gamesWithPayout,
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
    case "europatipset":
      return "Europatipset";
    case "maltipset":
      return "Måltipset";
    case "oddset":
      return "Oddset";
    case "esports_battle":
      return "Esports Battle";
  }
}
