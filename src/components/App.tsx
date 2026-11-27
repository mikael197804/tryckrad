"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BackgroundMusic from "./BackgroundMusic";
import GhostWelcome from "./GhostWelcome";
import type {
  OddsetCandidate,
  OddsetDayTip,
  OddsetLesson,
  OddsetTrackedTip,
} from "../lib/oddset";
import {
  formatPreCloseLabel,
  isInPreCloseWindow,
  nextPreCloseRefreshAt,
} from "../lib/refresh";
import type {
  EsportsBattleDay,
  EsportsBattleMatch,
} from "../lib/esportsBattleShared";
import {
  ESPORTS_BATTLE_RETENTION_HOURS,
  ESPORTS_BATTLE_RETENTION_MS,
  mergeEsportsBattleMatches,
} from "../lib/esportsBattleShared";
import type {
  HistoryPick,
  HistoryProduct,
  TipHistoryResponse,
} from "../lib/tipHistoryShared";
import {
  isFutureHistoryPick,
  TIP_HISTORY_RETENTION_HOURS,
  TIP_HISTORY_RETENTION_MS,
} from "../lib/tipHistoryShared";
import type { DrawBundle, GeneratedSystem, Outcome } from "../lib/types";
import type {
  V75DayTip,
  V75HorseTip,
  V75LegAnalysis,
} from "../lib/v75";
import type {
  TvillingDayTip,
  TvillingRaceTip,
} from "../lib/tvilling";

function productHistoryLabel(p: HistoryProduct): string {
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
    case "v75":
      return "V75";
    case "v64":
      return "V64";
    case "tvilling":
      return "Tvilling";
    case "hockey_1x2":
      return "Hockey 9";
    case "esports_battle":
      return "Esports Battle";
  }
}

/** Stryk + Europa: samma system (R 4-4-144) och sen laganalys. */
function isStrykFamily(p: string): boolean {
  return p === "stryktipset" || p === "europatipset";
}

const ODDSET_LS_KEY = "mikaels-oddset-tips-8h";
const ODDSET_LEARN_LS_KEY = "mikaels-oddset-lessons";
const HISTORY_LS_KEY = "mikaels-tips-history-8h";
const ESPORTS_BATTLE_LS_KEY = "mikaels-esports-battle-3h";
const ODDSET_RETENTION_MS = TIP_HISTORY_RETENTION_MS;
const ODDSET_LEARN_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
const HISTORY_RETENTION_MS = TIP_HISTORY_RETENTION_MS;

function loadEsportsBattleLocal(): EsportsBattleMatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ESPORTS_BATTLE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { matches?: EsportsBattleMatch[] };
    const list = Array.isArray(parsed?.matches)
      ? parsed.matches
      : Array.isArray(parsed)
        ? (parsed as EsportsBattleMatch[])
        : [];
    return mergeEsportsBattleMatches(list);
  } catch {
    return [];
  }
}

function saveEsportsBattleLocal(matches: EsportsBattleMatch[]): void {
  if (typeof window === "undefined") return;
  try {
    const pruned = mergeEsportsBattleMatches(matches);
    window.localStorage.setItem(
      ESPORTS_BATTLE_LS_KEY,
      JSON.stringify({
        matches: pruned,
        savedAt: new Date().toISOString(),
        retentionHours: ESPORTS_BATTLE_RETENTION_HOURS,
      })
    );
  } catch {
    /* private mode / quota */
  }
}

function loadOddsetLocalTips(): OddsetTrackedTip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(ODDSET_LS_KEY) ||
      window.localStorage.getItem("mikaels-oddset-tips-24h");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OddsetTrackedTip[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((t) => {
      const at = Date.parse(t.tippedAt || t.kickoff);
      return Number.isFinite(at) && now - at <= ODDSET_RETENTION_MS;
    });
  } catch {
    return [];
  }
}

function saveOddsetLocalTips(tips: OddsetTrackedTip[]): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const pruned = tips.filter((t) => {
      const at = Date.parse(t.tippedAt || t.kickoff);
      return Number.isFinite(at) && now - at <= ODDSET_RETENTION_MS;
    });
    window.localStorage.setItem(ODDSET_LS_KEY, JSON.stringify(pruned));
  } catch {
    // private mode / quota
  }
}

function loadOddsetLocalLessons(): OddsetLesson[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ODDSET_LEARN_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OddsetLesson[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((l) => {
      const at = Date.parse(l.settledAt || l.tippedAt);
      return Number.isFinite(at) && now - at <= ODDSET_LEARN_RETENTION_MS;
    });
  } catch {
    return [];
  }
}

function saveOddsetLocalLessons(lessons: OddsetLesson[]): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const byId = new Map<number, OddsetLesson>();
    for (const l of lessons) {
      if (!l?.eventId) continue;
      const at = Date.parse(l.settledAt || l.tippedAt);
      if (!Number.isFinite(at) || now - at > ODDSET_LEARN_RETENTION_MS) continue;
      byId.set(l.eventId, l);
    }
    window.localStorage.setItem(
      ODDSET_LEARN_LS_KEY,
      JSON.stringify([...byId.values()].slice(0, 80))
    );
  } catch {
    // private mode / quota
  }
}

function historyKeepUntilMs(p: HistoryPick): number {
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

/** Flytta gamla Oddset-hockeyrader till egen kolumn. */
function normalizeHistoryPick(p: HistoryPick): HistoryPick {
  if (
    p.product === "oddset" &&
    (p.gameKey?.startsWith("oddset:hockey1x2:") ||
      p.gameKey?.startsWith("hockey_1x2:") ||
      /hockey\s*1x2/i.test(p.gameLabel || ""))
  ) {
    const dayKey =
      p.gameKey?.replace(/^oddset:hockey1x2:/, "").replace(/^hockey_1x2:/, "") ||
      (p.kickoff || p.tippedAt || "").slice(0, 10);
    return {
      ...p,
      product: "hockey_1x2",
      gameKey: `hockey_1x2:${dayKey}`,
      gameLabel: p.gameLabel
        ?.replace(/^Oddset · Hockey 1X2/, "Hockey 9")
        ?.replace(/^Hockey 1X2/, "Hockey 9")
        || `Hockey 9 · ${dayKey}`,
    };
  }
  return p;
}

function loadLocalHistoryPicks(): HistoryPick[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(HISTORY_LS_KEY) ||
      window.localStorage.getItem("mikaels-tips-history-24h");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryPick[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.map(normalizeHistoryPick).filter((p) => {
      if (isFutureHistoryPick(p, now)) return false;
      const at = historyKeepUntilMs(p);
      return Number.isFinite(at) && now - at <= HISTORY_RETENTION_MS;
    });
  } catch {
    return [];
  }
}

function historyStatusRank(s: HistoryPick["status"]): number {
  if (s === "won" || s === "lost") return 3;
  if (s === "live") return 2;
  return 1;
}

/** Slå ihop tipprader utan att tappa t.ex. #4826.
 *  Väntande tips: senaste omställda tipset (sista kollen) vinner pick. */
function mergeHistoryPickLists(...groups: HistoryPick[][]): HistoryPick[] {
  const byId = new Map<string, HistoryPick>();
  const now = Date.now();
  for (const group of groups) {
    for (const raw of group) {
      const p = normalizeHistoryPick(raw);
      if (!p?.id) continue;
      if (isFutureHistoryPick(p, now)) continue;
      const at = historyKeepUntilMs(p);
      if (!Number.isFinite(at) || now - at > HISTORY_RETENTION_MS) continue;
      const prev = byId.get(p.id);
      if (!prev) {
        byId.set(p.id, p);
        continue;
      }
      const prevSettled = prev.status === "won" || prev.status === "lost";
      const pSettled = p.status === "won" || p.status === "lost";
      // Avgjorda tips låses; annars ta senaste tipp (sista kollen 10 min före)
      let base: HistoryPick;
      let other: HistoryPick;
      if (prevSettled && !pSettled) {
        base = prev;
        other = p;
      } else if (pSettled && !prevSettled) {
        base = p;
        other = prev;
      } else if (
        historyStatusRank(p.status) !== historyStatusRank(prev.status)
      ) {
        const preferNew =
          historyStatusRank(p.status) > historyStatusRank(prev.status);
        base = preferNew ? p : prev;
        other = preferNew ? prev : p;
      } else {
        const pAt = Date.parse(p.tippedAt);
        const prevAt = Date.parse(prev.tippedAt);
        const preferP =
          Number.isFinite(pAt) && Number.isFinite(prevAt)
            ? pAt >= prevAt
            : true;
        base = preferP ? p : prev;
        other = preferP ? prev : p;
      }
      byId.set(p.id, {
        ...base,
        tippedAt:
          Date.parse(prev.tippedAt) <= Date.parse(p.tippedAt)
            ? prev.tippedAt
            : p.tippedAt,
        pick: base.pick,
        actual: base.actual ?? other.actual,
        resultNote: base.resultNote ?? other.resultNote,
        settledAt: base.settledAt ?? other.settledAt ?? null,
        costKr: base.costKr ?? other.costKr ?? null,
        gameLabel:
          (base.gameLabel || "").length >= (other.gameLabel || "").length
            ? base.gameLabel
            : other.gameLabel,
      });
    }
  }
  return [...byId.values()];
}

function saveLocalHistoryPicks(picks: HistoryPick[]): void {
  if (typeof window === "undefined") return;
  try {
    const merged = mergeHistoryPickLists(picks);
    window.localStorage.setItem(HISTORY_LS_KEY, JSON.stringify(merged));
  } catch {
    // private mode / quota
  }
}

/** Tolka 1X2 från "2" eller målstringen "1-2". */
function outcomeFromActual(actual: string | null | undefined): "1" | "X" | "2" | null {
  if (!actual) return null;
  const s = String(actual).trim().toUpperCase();
  if (s === "1" || s === "X" || s === "2") return s;
  const m = s.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  if (h > a) return "1";
  if (h < a) return "2";
  return "X";
}

/** Rätta 1X2-status mot målresultat (1X mot 2 = fel). */
function correctHistoryPickStatus(p: HistoryPick): HistoryPick {
  if (p.market !== "1x2") return p;
  const result1x2 = outcomeFromActual(p.actual);
  if (!result1x2) return p;
  const hit = p.pick.includes(result1x2);
  const status: HistoryPick["status"] = hit ? "won" : "lost";
  if (status === p.status) return p;
  return {
    ...p,
    status,
    resultNote: hit
      ? `Rätt · ${p.actual} (tipset ${p.pick.join("")} → ${result1x2})`
      : `Fel · ${p.actual} (tipset ${p.pick.join("")}, blev ${result1x2})`,
  };
}

function buildHistoryViewModel(
  picks: HistoryPick[],
  prevGames?: TipHistoryResponse["games"]
): TipHistoryResponse {
  const now = Date.now();
  const corrected = picks
    .filter((p) => {
      if (isFutureHistoryPick(p, now)) return false;
      const at = Date.parse(p.settledAt || p.kickoff || p.tippedAt);
      return Number.isFinite(at) && now - at <= HISTORY_RETENTION_MS;
    })
    .map(correctHistoryPickStatus);
  const won = corrected.filter((p) => p.status === "won").length;
  const lost = corrected.filter((p) => p.status === "lost").length;
  const live = corrected.filter((p) => p.status === "live").length;
  const pending = corrected.filter((p) => p.status === "pending").length;
  const payoutByKey = new Map(
    (prevGames || [])
      .filter((g) => g.payoutLabel)
      .map((g) => [g.gameKey, g.payoutLabel as string])
  );
  const byGame = new Map<string, HistoryPick[]>();
  for (const p of corrected) {
    const list = byGame.get(p.gameKey) || [];
    list.push(p);
    byGame.set(p.gameKey, list);
  }
  const games = [...byGame.entries()].map(([gameKey, list]) => {
    const w = list.filter((x) => x.status === "won").length;
    const l = list.filter((x) => x.status === "lost").length;
    const settled = w + l;
    const product = list[0].product;
    // PP/Topp: 8 rätt. V75≈5/7, V64≈4/6. Övriga: en miss ok på 8.
    const winThreshold =
      product === "powerplay" || product === "topptipset"
        ? list.length
        : product === "v75" || product === "v64"
          ? Math.max(1, list.length - 2)
          : product === "tvilling"
            ? Math.max(1, Math.ceil(list.length * 0.6))
          : product === "hockey_1x2"
            ? Math.max(1, list.length - 1)
          : list.length >= 7 && list.length <= 9
            ? Math.max(1, list.length - 1)
            : list.length;
    const systemResult: "won" | "lost" | "pending" =
      settled === list.length && list.length > 0
        ? w >= winThreshold
          ? "won"
          : "lost"
        : "pending";
    return {
      gameKey,
      product: list[0].product,
      label: list[0].gameLabel,
      tippedAt: list[0].tippedAt,
      total: list.length,
      settled,
      won: w,
      lost: l,
      pending: list.filter((x) => x.status === "pending").length,
      live: list.filter((x) => x.status === "live").length,
      costKr: list.find((x) => x.costKr != null)?.costKr ?? null,
      systemResult,
      drawNumber: list.find((x) => x.drawNumber != null)?.drawNumber ?? null,
      payoutLabel:
        systemResult === "won" ? payoutByKey.get(gameKey) || null : null,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    retentionHours: TIP_HISTORY_RETENTION_HOURS,
    picks: corrected,
    games,
    totals: {
      total: corrected.length,
      settled: won + lost,
      won,
      lost,
      pending,
      live,
    },
  };
}

function oddsetToHistoryPicks(
  tips: OddsetTrackedTip[],
  tippedAtFallback: string
): HistoryPick[] {
  const now = Date.now();
  return tips.flatMap((t) => {
    const tippedAt = t.tippedAt || tippedAtFallback;
    const kickMs = t.kickoff ? Date.parse(t.kickoff) : NaN;
    // Resultat: inga framtida matcher som “väntar”
    if (Number.isFinite(kickMs) && kickMs > now) return [];
    const status =
      t.outcome === "won" || t.outcome === "lost" || t.outcome === "live"
        ? t.outcome
        : "pending";
    const is1x2 = t.market === "1x2";
    const isHockey1x2 = is1x2 && t.sport === "hockey";
    const pick1 = t.pick1x2 || "1";
    const kickIso = t.kickoff || tippedAt;
    let dayKey = tippedAt.slice(0, 10);
    try {
      dayKey = stockholmYmd(new Date(kickIso));
    } catch {
      /* keep tippedAt */
    }
    const dayLabel = fmtHistoryDate(kickIso);
    return [{
      id: is1x2
        ? `oddset:${t.eventId}:1x2:${pick1}`
        : `oddset:${t.eventId}:over`,
      product: (isHockey1x2 ? "hockey_1x2" : "oddset") as HistoryProduct,
      // Gruppera per speldatum (Stockholm) + marknad
      gameKey: isHockey1x2
        ? `hockey_1x2:${dayKey}`
        : is1x2
          ? `oddset:1x2:${dayKey}`
          : `oddset:over:${dayKey}`,
      gameLabel: isHockey1x2
        ? `Hockey 9 · ${dayLabel}`
        : is1x2
          ? `Oddset · 1X2 · ${dayLabel}`
          : `Oddset · Över 1,5 · ${dayLabel}`,
      tippedAt,
      description: `${t.home} – ${t.away}`,
      home: t.home,
      away: t.away,
      market: is1x2 ? ("1x2" as const) : ("over_1_5" as const),
      pick: is1x2 ? [pick1] : ["over_1_5"],
      kickoff: t.kickoff || null,
      drawNumber: null,
      eventNumber: null,
      eventId: t.eventId,
      status,
      actual:
        t.homeGoals != null && t.awayGoals != null
          ? `${t.homeGoals}-${t.awayGoals}`
          : null,
      resultNote: t.resultNote,
    }];
  });
}

function drawToHistoryPicks(
  draw: DrawBundle,
  tippedAt: string
): HistoryPick[] {
  const product = draw.productKind as HistoryProduct;
  if (
    product !== "powerplay" &&
    product !== "topptipset" &&
    product !== "stryktipset" &&
    product !== "europatipset" &&
    product !== "maltipset"
  ) {
    return [];
  }

  // Resultat: bara omgångar som stängt / spelas nu – inte framtida tipp
  const state = String(draw.drawState || "");
  const closeMs = Date.parse(draw.closeTime);
  const started =
    state === "Closed" ||
    state === "Finalized" ||
    (Number.isFinite(closeMs) && closeMs <= Date.now());
  if (!started) return [];

  let systems = (draw.systems || []).filter(
    (s) => s.costKr >= 48 && s.costKr <= 720
  );
  // Powerplay + Topptipset: se till att 192 kr alltid sparas i resultat 8 h
  if (product === "powerplay" || product === "topptipset") {
    const has192 = systems.some((s) => s.costKr === 192);
    if (!has192) {
      const forced = (draw.systems || []).find((s) => s.costKr === 192);
      if (forced) systems = [...systems, forced];
    }
    // I resultat: visa främst 192 kr (dagligt) + ev. 48 kr – inte alla system
    systems = systems.filter(
      (s) => s.costKr === 192 || s.costKr === 48
    );
  }
  if (!systems.length) return [];

  const first = draw.matches[0];
  const firstLabel = first
    ? `${first.home.name}–${first.away.name}`
    : null;
  const playing =
    state === "Closed" ||
    (state !== "Finalized" &&
      Number.isFinite(closeMs) &&
      closeMs <= Date.now());
  const baseLabel = [
    `${productHistoryLabel(product)} #${draw.drawNumber}`,
    playing ? "Spelas nu" : null,
    firstLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const out: HistoryPick[] = [];
  const now = Date.now();

  for (const system of systems) {
    const costKr = system.costKr;
    const gameKey = `${product}:${draw.drawNumber}:${costKr}`;
    const gameLabel = `${baseLabel} · ${costKr} kr`;

    if (system.kind === "mal" || product === "maltipset") {
      const malNums = new Set(
        system.malEventNumbers?.length
          ? system.malEventNumbers
          : draw.malTip || []
      );
      for (const m of draw.matches) {
        if (!malNums.has(m.eventNumber) && !m.malSelected) continue;
        const kick = m.matchStart ? Date.parse(m.matchStart) : NaN;
        if (Number.isFinite(kick) && kick > now) continue;
        out.push({
          id: `${product}:${draw.drawNumber}:${costKr}:${m.eventNumber}`,
          product,
          gameKey,
          gameLabel: `${gameLabel} · Mål`,
          tippedAt,
          description: m.description,
          home: m.home.name,
          away: m.away.name,
          market: "mal",
          pick: ["mal"],
          kickoff: m.matchStart || null,
          drawNumber: draw.drawNumber,
          eventNumber: m.eventNumber,
          eventId: null,
          status: "pending",
          actual: null,
          resultNote: null,
          costKr,
        });
      }
      continue;
    }

    for (const p of system.picks) {
      const match = draw.matches.find((m) => m.eventNumber === p.eventNumber);
      const kick = match?.matchStart ? Date.parse(match.matchStart) : NaN;
      if (Number.isFinite(kick) && kick > now) continue;
      out.push({
        id: `${product}:${draw.drawNumber}:${costKr}:${p.eventNumber}`,
        product,
        gameKey,
        gameLabel,
        tippedAt,
        description:
          p.description || match?.description || `Match ${p.eventNumber}`,
        home: match?.home.name || "",
        away: match?.away.name || "",
        market: "1x2",
        pick: p.outcomes,
        kickoff: match?.matchStart || null,
        drawNumber: draw.drawNumber,
        eventNumber: p.eventNumber,
        eventId: null,
        status: "pending",
        actual: null,
        resultNote: null,
        costKr,
      });
    }
  }

  return out;
}

/** V75/V64 tipprad → resultatbibliotek (en rad per avdelning). */
function atgTipToHistoryPicks(tip: V75DayTip): HistoryPick[] {
  const product = tip.product === "V64" ? "v64" : "v75";
  const label = product === "v64" ? "V64" : "V75";
  // Endast när omgången startat / tips aktiverats – inga framtida förhands
  const firstStart = tip.legs
    .map((l) => (l.startTime ? Date.parse(l.startTime) : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)[0];
  const started =
    tip.tipsActivated === true ||
    (firstStart != null && firstStart <= Date.now());
  if (!started) return [];
  if (!tip.legs?.length) return [];

  const tippedAt = tip.generatedAt || new Date().toISOString();
  const costKr = tip.tipCostKr ?? null;
  const tracks = tip.trackNames?.length
    ? tip.trackNames.join("/")
    : "";
  const gameKey = `${product}:${tip.playDate}:${tip.gameId || "tip"}`;
  const gameLabel = [
    `${label} · ${tip.playDateLabel || tip.playDate}`,
    tracks || null,
    tip.tipsStreckLabel || null,
    costKr != null ? `${Math.round(costKr)} kr` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const out: HistoryPick[] = [];
  for (const leg of tip.legs) {
    const nums = (leg.pickNumbers || []).filter((n) => Number.isFinite(n));
    if (!nums.length) continue;
    const kick = leg.startTime ? Date.parse(leg.startTime) : NaN;
    if (Number.isFinite(kick) && kick > Date.now()) continue;
    out.push({
      id: `${product}:${tip.gameId || tip.playDate}:leg:${leg.leg}`,
      product,
      gameKey,
      gameLabel,
      tippedAt,
      description:
        leg.raceName ||
        `${label}-${leg.leg}${leg.trackName ? ` · ${leg.trackName}` : ""}`,
      home: leg.trackName || label,
      away: leg.pickLabel || nums.join(","),
      market: "atg_win",
      pick: nums.map(String),
      kickoff: leg.startTime || tip.startTime || null,
      drawNumber: null,
      eventNumber: leg.leg,
      eventId: null,
      raceId: leg.raceId || null,
      status: "pending",
      actual: null,
      resultNote: null,
      costKr,
    });
  }
  return out;
}


/** Tvilling tipprad → resultatbibliotek (en rad per lopp). */
function tvillingTipToHistoryPicks(tip: TvillingDayTip): HistoryPick[] {
  if (!tip.races?.length) return [];
  const firstStart = tip.races
    .map((r) => (r.startTime ? Date.parse(r.startTime) : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)[0];
  const started =
    tip.tipsActivated === true ||
    (firstStart != null && firstStart <= Date.now());
  if (!started) return [];

  const tippedAt = tip.generatedAt || new Date().toISOString();
  const costKr = tip.tipCostKr ?? null;
  const tracks = tip.trackNames?.length ? tip.trackNames.join("/") : "";
  const gameKey = `tvilling:${tip.playDate}:tip`;
  const gameLabel = [
    `Tvilling · ${tip.playDateLabel || tip.playDate}`,
    tracks || null,
    tip.tipsStreckLabel || null,
    costKr != null ? `${Math.round(costKr)} kr` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const out: HistoryPick[] = [];
  for (const race of tip.races) {
    const nums = (race.pickNumbers || []).filter((n) => Number.isFinite(n));
    if (!nums.length) continue;
    const kick = race.startTime ? Date.parse(race.startTime) : NaN;
    if (Number.isFinite(kick) && kick > Date.now()) continue;
    out.push({
      id: `tvilling:${tip.playDate}:race:${race.raceId}`,
      product: "tvilling",
      gameKey,
      gameLabel,
      tippedAt,
      description:
        race.raceName ||
        `L${race.raceNumber}${race.trackName ? ` · ${race.trackName}` : ""}`,
      home: race.trackName || "Tvilling",
      away: race.pickLabel || nums.join(","),
      market: "atg_twin",
      pick: nums.map(String),
      kickoff: race.startTime || tip.startTime || null,
      drawNumber: null,
      eventNumber: race.raceNumber,
      eventId: null,
      raceId: race.raceId || null,
      status: "pending",
      actual: null,
      resultNote: null,
      costKr,
    });
  }
  return out;
}

function TvillingRaceCard({
  race,
  open,
  onToggle,
}: {
  race: TvillingRaceTip;
  open: boolean;
  onToggle: () => void;
}) {
  const shown = race.horses.filter(
    (h) =>
      h.inTip ||
      h.inBestPair ||
      h.misleading ||
      h.classDrop?.dropped ||
      h.highWinRate ||
      h.lowOddsReview?.isLowOdds ||
      h.dualDriverLongshot ||
      (h.valueEdgePct != null && h.valueEdgePct >= 6) ||
      (h.tipMentions.length > 0 && h.tipConsensus !== "none")
  );
  const list = (shown.length ? shown : race.horses.slice(0, 4)).sort(
    (a, b) => a.startNumber - b.startNumber
  );
  const shortName =
    race.raceName.length > 48
      ? `${race.raceName.slice(0, 46)}…`
      : race.raceName;

  return (
    <article
      className={`match-card v75-leg-card history-game-collapsible${
        open ? " is-open" : " is-collapsed"
      }`}
    >
      <button
        type="button"
        className="history-game-toggle v75-leg-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="history-game-toggle-main">
          <span className="history-game-toggle-title">
            <span className="match-num v75-toggle-num">L{race.raceNumber}</span>{" "}
            {shortName}
          </span>
          <span className="reason">
            {race.trackName}
            {race.distance != null ? ` · ${race.distance} m` : ""}
            {race.startTime ? ` · ${fmtTime(race.startTime)}` : ""}
            {` · ${race.summary}`}
          </span>
        </span>
        <span className="history-game-toggle-meta">
          <span className="pick-cell on">{race.pickLabel || "–"}</span>
          <span className="history-game-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>

      {open && (
        <div className="v75-leg-body">
          <div className="v75-horse-list">
            {list.map((h) => (
              <div key={h.startNumber}>
                <V75HorseRow h={h} />
                {(h.inBestPair || h.inTip) && (
                  <div className="reason" style={{ marginLeft: "2.5rem" }}>
                    {h.inBestPair ? "★ bästa tvillingpar" : "i tipset"}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="panel-lead" style={{ marginTop: "0.6rem" }}>
            Bästa par {race.bestPairLabel}
            {race.bestPairOdds != null
              ? ` · odds ca ${String(race.bestPairOdds).replace(".", ",")}`
              : ""}
            {" · "}
            {race.tipCombinations} komb · {fmtKr(race.tipCostKr)} kr
          </p>
          {race.alerts.length > 0 && (
            <ul
              className="alert-list table-alerts"
              style={{ marginTop: "0.6rem" }}
            >
              {race.alerts.slice(0, 4).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function TvillingView({ tip }: { tip: TvillingDayTip }) {
  const product = "Tvilling";
  const [openRaces, setOpenRaces] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => openRaces[id] === true;
  const toggleRace = (id: string) =>
    setOpenRaces((prev) => ({ ...prev, [id]: !prev[id] }));
  const expandAll = () =>
    setOpenRaces(
      Object.fromEntries(tip.races.map((r) => [r.raceId, true])) as Record<
        string,
        boolean
      >
    );
  const collapseAll = () => setOpenRaces({});
  const tipsActive = tip.tipsActivated !== false;
  const strategies = tip.driverStrategies || [];
  const preRaces = tip.preRaces || [];

  return (
    <div className="rise">
      <section className="panel">
        <h2>
          {product} · {tip.playDateLabel}
          {tip.trackNames.length ? ` · ${tip.trackNames.join("/")}` : ""}
        </h2>
        <p className="panel-lead">
          ATG {tip.status}
          {tip.startTime ? ` · start ${fmtTime(tip.startTime)}` : ""}
          {" · "}
          radpris {String(tip.rowPriceKr).replace(".", ",")} kr
        </p>
        <p className="panel-lead">
          <a
            href={tip.atgUrl}
            target="_blank"
            rel="noreferrer"
            className="oddset-link"
          >
            Öppna Tvilling på ATG
          </a>
        </p>
      </section>

      {(strategies.length > 0 ||
        tip.dualDriverSignals.length > 0 ||
        preRaces.length > 0) && (
        <section className="panel">
          <h2>Kuskanalys · före tippraden</h2>
          <p className="panel-lead">
            Samma kusklogik som V75/V64: lågodds först, högodds om den missar.
          </p>
          {preRaces.length > 0 && (
            <>
              <h3>Förelopp</h3>
              <p className="panel-lead">
                {tip.tipsPhaseNote ||
                  (tipsActive
                    ? "Förelopp klara – riktiga tips aktiva."
                    : "Väntar på förelopp innan riktiga tips aktiveras.")}
              </p>
              <ul className="alert-list table-alerts">
                {preRaces.map((r) => (
                  <li key={r.raceId}>
                    {r.trackName} lopp {r.raceNumber}
                    {r.startTime ? ` · ${fmtTime(r.startTime)}` : ""}
                    {" · "}
                    {r.finished ? "klart" : r.status || "väntar"}
                  </li>
                ))}
              </ul>
            </>
          )}
          {strategies.length > 0 && (
            <>
              <h3>Lågodds → högodds</h3>
              <ul className="alert-list learning-alerts">
                {strategies.map((s) => (
                  <li key={`${s.driver}-${s.lowMount?.leg}-${s.highMount?.leg}`}>
                    <strong>{s.driver}</strong>
                    {s.lowBeforeHigh ? " · klassiskt mönster" : " · omvänt"}
                    <div className="reason" style={{ marginTop: "0.2rem" }}>
                      {s.strategy}
                    </div>
                    {s.focusIfLowMisses && (
                      <div className="reason" style={{ marginTop: "0.15rem" }}>
                        Om lågodds missar → L{s.focusIfLowMisses.leg} #
                        {s.focusIfLowMisses.startNumber}{" "}
                        {s.focusIfLowMisses.horseName}
                        {s.focusIfLowMisses.winOdds != null
                          ? ` @ ${String(s.focusIfLowMisses.winOdds).replace(".", ",")}`
                          : ""}
                      </div>
                    )}
                    {s.preRaceNote && (
                      <div className="reason" style={{ marginTop: "0.15rem" }}>
                        {s.preRaceNote}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {tip.dualDriverSignals.length > 0 && (
            <>
              <h3>Dubbelkuskar (2 lopp) · högst odds</h3>
              <ul className="alert-list table-alerts">
                {tip.dualDriverSignals.map((s) => (
                  <li key={`${s.driver}-${s.focusLeg}-${s.focusStartNumber}`}>
                    <strong>{s.driver}</strong>: fokusera L{s.focusLeg} #
                    {s.focusStartNumber} {s.focusHorse}
                    {s.focusOdds != null
                      ? ` @ ${String(s.focusOdds).replace(".", ",")}`
                      : ""}{" "}
                    (högst odds av två)
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h2>
          Tvilling tipprad · {tip.tipsStreckLabel}
          {!tipsActive ? " · förhands" : ""}
        </h2>
        {!tipsActive && (
          <p className="panel-lead">
            {tip.tipsPhaseNote ||
              "Riktiga tippboostar aktiveras när föreloppen är klara."}
          </p>
        )}
        <div className="tip-strip" aria-label="Tvilling tipsstreck">
          <strong>
            {tip.tipsStreckLabel}
            {" · "}
            {fmtKr(tip.tipCostKr)} kr
            <span style={{ fontWeight: 500, opacity: 0.85 }}>
              {" "}
              ({tip.tipRows} komb ×{" "}
              {String(tip.rowPriceKr).replace(".", ",")} kr)
              {!tipsActive ? " · förhandstips" : ""}
            </span>
          </strong>
          <div className="tip-strip-picks">
            {tip.races.map((r) => (
              <span key={r.raceId} className="tip-strip-pick">
                <em>L{r.raceNumber}</em>
                {r.pickLabel || "–"}
                <span style={{ opacity: 0.65, marginLeft: "0.25rem" }}>
                  (par {r.bestPair[0]}-{r.bestPair[1]})
                </span>
              </span>
            ))}
          </div>
        </div>
        <p className="panel-lead" style={{ marginTop: "0.75rem" }}>
          <strong style={{ fontWeight: 650 }}>{tip.tipsStreckLabel}</strong>
          {" · "}
          {tip.couponLine}
        </p>
        <ul className="alert-list table-alerts">
          {tip.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      {(tip.misleadingFavorites.length > 0 ||
        tip.valueHorses.length > 0 ||
        tip.homeTrackHorses.length > 0 ||
        tip.classDropHorses.length > 0 ||
        tip.highWinRateHorses.length > 0 ||
        tip.lowOddsReviews.length > 0) && (
        <section className="panel">
          <h2>Signaler · klass, seger%, lågodds &amp; värde</h2>
          <div className="grid-2 mobile-stack">
            {tip.classDropHorses.length > 0 && (
              <div>
                <h3>Nergraderade</h3>
                <ul className="alert-list table-alerts">
                  {tip.classDropHorses.map((m) => (
                    <li key={`cd-${m.leg}-${m.startNumber}`}>
                      L{m.leg} #{m.startNumber} {m.name}: {m.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tip.highWinRateHorses.length > 0 && (
              <div>
                <h3>Högre seger% än fältet</h3>
                <ul className="alert-list table-alerts">
                  {tip.highWinRateHorses.map((m) => (
                    <li key={`wr-${m.leg}-${m.startNumber}`}>
                      L{m.leg} #{m.startNumber} {m.name}:{" "}
                      {String(m.winRatePct).replace(".", ",")}% (+
                      {String(m.edgePct).replace(".", ",")}%-enh.)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {tip.lowOddsReviews.length > 0 && (
            <>
              <h3>Lågoddsare granskade</h3>
              <ul className="alert-list table-alerts">
                {tip.lowOddsReviews.map((m) => (
                  <li key={`lo-${m.leg}-${m.startNumber}`}>
                    L{m.leg} #{m.startNumber} {m.name} @{" "}
                    {String(m.winOdds).replace(".", ",")}
                    {m.supported === true
                      ? " · stödd"
                      : m.supported === false
                        ? " · svag"
                        : ""}
                    {m.note ? ` – ${m.note}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="grid-2 mobile-stack">
            {tip.misleadingFavorites.length > 0 && (
              <div>
                <h3>Missvisande favoriter</h3>
                <ul className="alert-list table-alerts">
                  {tip.misleadingFavorites.map((m) => (
                    <li key={`${m.leg}-${m.startNumber}`}>
                      L{m.leg} #{m.startNumber} {m.name}: {m.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tip.valueHorses.length > 0 && (
              <div>
                <h3>Överodds / värde</h3>
                <ul className="alert-list table-alerts">
                  {tip.valueHorses.map((v) => (
                    <li key={`${v.leg}-${v.startNumber}`}>
                      L{v.leg} #{v.startNumber} {v.name} (+
                      {String(v.edgePct).replace(".", ",")}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {tip.homeTrackHorses.length > 0 && (
            <>
              <h3>Hästar som trivs hemma</h3>
              <p className="panel-lead">
                {tip.homeTrackHorses
                  .slice(0, 10)
                  .map((h) => `L${h.leg} #${h.startNumber} ${h.name}`)
                  .join(" · ")}
              </p>
            </>
          )}
        </section>
      )}

      <section className="panel panel-systems">
        <h2>Lopp</h2>
        <p className="panel-lead">
          Samma analys som V75/V64. Tippa 2–3 hästar – rätt om 1:a och 2:a ingår
          (valfri ordning).
        </p>
        <div className="v75-leg-toolbar">
          <button type="button" className="system-btn" onClick={expandAll}>
            Öppna alla
          </button>
          <button type="button" className="system-btn" onClick={collapseAll}>
            Stäng alla
          </button>
        </div>
        <div className="match-cards v75-leg-list">
          {tip.races.map((race) => (
            <TvillingRaceCard
              key={race.raceId}
              race={race}
              open={isOpen(race.raceId)}
              onToggle={() => toggleRace(race.raceId)}
            />
          ))}
        </div>
      </section>

      <section className="panel panel-articles">
        <h2>Tips från webben</h2>
        <p className="panel-lead">
          Källor som lästs in nu
          {tip.externalSources.filter((s) => s.ok).length
            ? ` (${tip.externalSources.filter((s) => s.ok).length} ok)`
            : ""}
          .
        </p>
        <ul className="alert-list table-alerts">
          {tip.externalSources.map((s) => (
            <li key={s.source}>
              {s.ok ? "✓" : "✗"}{" "}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.source}
                </a>
              ) : (
                s.source
              )}
              {s.note ? ` – ${s.note}` : ""}
            </li>
          ))}
        </ul>
        {tip.headlineSignals.length > 0 && (
          <>
            <h3>Rubriker / signaler</h3>
            <ul className="alert-list learning-alerts">
              {tip.headlineSignals.slice(0, 8).map((h, i) => (
                <li key={`${h.source}-${i}`}>
                  <strong>{h.source}</strong>: {h.snippet || h.title}
                  {h.sentiment !== "mention" ? ` · ${h.sentiment}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="panel-lead">{tip.disclaimer}</p>
      </section>
    </div>
  );
}

function outcomeRank(o: OddsetTrackedTip["outcome"] | undefined): number {
  if (o === "won" || o === "lost") return 3;
  if (o === "live") return 2;
  return 1;
}

function oddsetTrackKey(t: OddsetTrackedTip | OddsetCandidate): string {
  if (t.market === "1x2") return `${t.eventId}:1x2:${t.pick1x2 || "?"}`;
  return `${t.eventId}:${t.market || "over_1_5"}`;
}

function mergeOddsetTracked(
  ...groups: Array<OddsetTrackedTip[] | undefined>
): OddsetTrackedTip[] {
  const byId = new Map<string, OddsetTrackedTip>();
  for (const group of groups) {
    for (const t of group || []) {
      if (!t?.eventId) continue;
      const key = oddsetTrackKey(t);
      const prev = byId.get(key);
      if (!prev) {
        byId.set(key, t);
        continue;
      }
      const tippedAt =
        Date.parse(prev.tippedAt) <= Date.parse(t.tippedAt)
          ? prev.tippedAt
          : t.tippedAt;
      const preferNew = outcomeRank(t.outcome) >= outcomeRank(prev.outcome);
      const base = preferNew ? t : prev;
      const other = preferNew ? prev : t;
      byId.set(key, {
        ...base,
        tippedAt,
        homeGoals: base.homeGoals ?? other.homeGoals,
        awayGoals: base.awayGoals ?? other.awayGoals,
        totalGoals: base.totalGoals ?? other.totalGoals,
        settledAt: base.settledAt ?? other.settledAt,
        resultNote: base.resultNote ?? other.resultNote,
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(b.tippedAt) - Date.parse(a.tippedAt) ||
      Date.parse(a.kickoff) - Date.parse(b.kickoff)
  );
}

type ProductKind =
  | "powerplay"
  | "topptipset"
  | "stryktipset"
  | "europatipset"
  | "maltipset"
  | "oddset"
  | "hockey9"
  | "v75"
  | "v64"
  | "tvilling";

const DRAW_PRODUCTS: Array<Exclude<ProductKind, "oddset" | "hockey9" | "v75" | "v64" | "tvilling">> = [
  "topptipset",
  "powerplay",
  "stryktipset",
  "europatipset",
  "maltipset",
];

const HISTORY_PRODUCT_COLUMNS: Array<{
  id: HistoryProduct;
  label: string;
}> = [
  { id: "powerplay", label: "Powerplay" },
  { id: "topptipset", label: "Topptipset" },
  { id: "stryktipset", label: "Stryktipset" },
  { id: "europatipset", label: "Europatipset" },
  { id: "maltipset", label: "Måltipset" },
  { id: "v75", label: "V75" },
  { id: "v64", label: "V64" },
  { id: "tvilling", label: "Tvilling" },
  { id: "oddset", label: "Oddset" },
  { id: "hockey_1x2", label: "Hockey 9" },
  { id: "esports_battle", label: "Esports Battle" },
];

function productLabel(p: ProductKind): string {
  switch (p) {
    case "stryktipset":
      return "Stryktipset";
    case "europatipset":
      return "Europatipset";
    case "maltipset":
      return "Måltipset";
    case "topptipset":
      return "Topptipset";
    case "powerplay":
      return "Powerplay";
    case "oddset":
      return "Oddset";
    case "hockey9":
      return "Hockey 9";
    case "v75":
      return "V75";
    case "v64":
      return "V64";
    case "tvilling":
      return "Tvilling";
  }
}

function fmtKr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return Math.round(n).toLocaleString("sv-SE");
}

function V75HorseRow({ h }: { h: V75HorseTip }) {
  const roleClass =
    h.role === "spik"
      ? "v75-role-spik"
      : h.role === "skräll"
        ? "v75-role-skrall"
        : h.role === "gardering"
          ? "v75-role-gard"
          : "";
  return (
    <div className={`v75-horse ${roleClass}${h.misleading ? " v75-warn" : ""}`}>
      <div className="v75-horse-num">
        <strong>{h.startNumber}</strong>
        {h.postPosition != null && h.postPosition !== h.startNumber ? (
          <span className="v75-post">spår {h.postPosition}</span>
        ) : null}
      </div>
      <div className="v75-horse-main">
        <div className="v75-horse-name">
          {h.name}
          {h.role !== "skip" && (
            <span className={`v75-role-tag ${roleClass}`}>{h.role}</span>
          )}
          {h.isHomeTrack && <span className="v75-home-tag">hemma</span>}
          {h.classDrop?.dropped && (
            <span className="v75-home-tag">nergraderad</span>
          )}
          {h.highWinRate && (
            <span className="v75-home-tag">hög seger%</span>
          )}
          {h.lowOddsReview?.isLowOdds && (
            <span
              className={`v75-home-tag${
                h.lowOddsReview.supported === false ? " v75-tag-warn" : ""
              }`}
            >
              lågodds
              {h.lowOddsReview.supported === true
                ? " ✓"
                : h.lowOddsReview.supported === false
                  ? " !"
                  : ""}
            </span>
          )}
          {h.dualDriverLongshot && (
            <span className="v75-home-tag">dubbelkusk</span>
          )}
        </div>
        <div className="reason">
          {h.driver ? `kusk ${h.driver}` : ""}
          {h.trainer ? `${h.driver ? " · " : ""}tr ${h.trainer}` : ""}
          {h.winOdds != null
            ? ` · vinnare ${String(h.winOdds).replace(".", ",")}`
            : ""}
          {h.v75Pct != null
            ? ` · streck ${String(h.v75Pct).replace(".", ",")}%`
            : ""}
          {h.winRatePct != null
            ? ` · seger% ${String(h.winRatePct).replace(".", ",")}`
            : ""}
          {h.valueEdgePct != null && h.valueEdgePct >= 2
            ? ` · värde +${String(h.valueEdgePct).replace(".", ",")}%`
            : ""}
        </div>
        <div className="reason">{h.reason}</div>
        {h.misleading && (
          <div className="v75-misleading">{h.misleading}</div>
        )}
        {h.tipMentions.length > 0 && (
          <div className="v75-tip-mentions">
            {h.tipMentions.slice(0, 2).map((m, i) => (
              <a
                key={`${m.source}-${i}`}
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="v75-tip-link"
              >
                {m.source}: {m.snippet.slice(0, 110)}
                {m.snippet.length > 110 ? "…" : ""}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function V75LegCard({
  leg,
  open,
  onToggle,
  productLabel = "V75",
}: {
  leg: V75LegAnalysis;
  open: boolean;
  onToggle: () => void;
  productLabel?: string;
}) {
  const shown = leg.horses.filter(
    (h) =>
      leg.pickNumbers.includes(h.startNumber) ||
      h.misleading ||
      h.classDrop?.dropped ||
      h.highWinRate ||
      h.lowOddsReview?.isLowOdds ||
      h.dualDriverLongshot ||
      (h.valueEdgePct != null && h.valueEdgePct >= 6) ||
      (h.tipMentions.length > 0 && h.tipConsensus !== "none")
  );
  const list = (shown.length ? shown : leg.horses.slice(0, 4)).sort(
    (a, b) => a.startNumber - b.startNumber
  );
  const shortName =
    leg.raceName.length > 48
      ? `${leg.raceName.slice(0, 46)}…`
      : leg.raceName;

  return (
    <article
      className={`match-card v75-leg-card history-game-collapsible${
        open ? " is-open" : " is-collapsed"
      }`}
    >
      <button
        type="button"
        className="history-game-toggle v75-leg-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="history-game-toggle-main">
          <span className="history-game-toggle-title">
            <span className="match-num v75-toggle-num">
              {productLabel}-{leg.leg}
            </span>{" "}
            {shortName}
          </span>
          <span className="reason">
            {leg.trackName}
            {leg.distance != null ? ` · ${leg.distance} m` : ""}
            {leg.startTime ? ` · ${fmtTime(leg.startTime)}` : ""}
            {` · ${leg.summary}`}
          </span>
        </span>
        <span className="history-game-toggle-meta">
          <span className="pick-cell on">{leg.pickLabel || "–"}</span>
          <span className="history-game-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>

      {open && (
        <div className="v75-leg-body">
          <div className="v75-horse-list">
            {list.map((h) => (
              <V75HorseRow key={h.startNumber} h={h} />
            ))}
          </div>
          {leg.alerts.length > 0 && (
            <ul
              className="alert-list table-alerts"
              style={{ marginTop: "0.6rem" }}
            >
              {leg.alerts.slice(0, 4).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function V75View({ tip }: { tip: V75DayTip }) {
  const product = tip.product || "V75";
  const [openLegs, setOpenLegs] = useState<Record<number, boolean>>({});
  const isOpen = (leg: number) => openLegs[leg] === true;
  const toggleLeg = (leg: number) =>
    setOpenLegs((prev) => ({ ...prev, [leg]: !prev[leg] }));
  const expandAll = () =>
    setOpenLegs(
      Object.fromEntries(tip.legs.map((l) => [l.leg, true])) as Record<
        number,
        boolean
      >
    );
  const collapseAll = () => setOpenLegs({});
  const tipsActive = tip.tipsActivated !== false;
  const strategies = tip.driverStrategies || [];
  const preRaces = tip.preRaces || [];

  return (
    <div className="rise">
      <section className="panel">
        <h2>
          {product} · {tip.playDateLabel}
          {tip.trackNames.length ? ` · ${tip.trackNames.join("/")}` : ""}
        </h2>
        <p className="panel-lead">
          ATG {tip.status}
          {tip.startTime ? ` · start ${fmtTime(tip.startTime)}` : ""}
          {tip.jackpotKr != null
            ? ` · jackpot ${fmtKr(tip.jackpotKr)} kr`
            : tip.estimatedJackpotKr != null
              ? ` · ber. jackpot ${fmtKr(tip.estimatedJackpotKr)} kr`
              : ""}
          {tip.turnoverKr != null
            ? ` · omsättning ${fmtKr(tip.turnoverKr)} kr`
            : ""}
          {" · "}
          radpris {String(tip.rowPriceKr).replace(".", ",")} kr
        </p>
        <p className="panel-lead">
          <a href={tip.atgUrl} target="_blank" rel="noreferrer" className="oddset-link">
            Öppna {product} på ATG
          </a>
        </p>
      </section>

      {(strategies.length > 0 ||
        tip.dualDriverSignals.length > 0 ||
        preRaces.length > 0) && (
        <section className="panel">
          <h2>Kuskanalys · före tippraden</h2>
          <p className="panel-lead">
            Tänker kusken vinna med högoddsaren om lågoddsaren missar? Analysen
            ligger före spelformeln.
          </p>
          {preRaces.length > 0 && (
            <>
              <h3>Förelopp</h3>
              <p className="panel-lead">
                {tip.tipsPhaseNote ||
                  (tipsActive
                    ? "Förelopp klara – riktiga tips aktiva."
                    : "Väntar på förelopp innan riktiga tips aktiveras.")}
              </p>
              <ul className="alert-list table-alerts">
                {preRaces.map((r) => (
                  <li key={r.raceId}>
                    {r.trackName} lopp {r.raceNumber}
                    {r.startTime ? ` · ${fmtTime(r.startTime)}` : ""}
                    {" · "}
                    {r.finished ? "klart" : r.status || "väntar"}
                  </li>
                ))}
              </ul>
            </>
          )}
          {strategies.length > 0 && (
            <>
              <h3>Lågodds → högodds</h3>
              <ul className="alert-list learning-alerts">
                {strategies.map((s) => (
                  <li key={`${s.driver}-${s.lowMount?.leg}-${s.highMount?.leg}`}>
                    <strong>{s.driver}</strong>
                    {s.lowBeforeHigh ? " · klassiskt mönster" : " · omvänt"}
                    <div className="reason" style={{ marginTop: "0.2rem" }}>
                      {s.strategy}
                    </div>
                    {s.focusIfLowMisses && (
                      <div className="reason" style={{ marginTop: "0.15rem" }}>
                        Om lågodds missar → {product}-
                        {s.focusIfLowMisses.leg} #
                        {s.focusIfLowMisses.startNumber}{" "}
                        {s.focusIfLowMisses.horseName}
                        {s.focusIfLowMisses.winOdds != null
                          ? ` @ ${String(s.focusIfLowMisses.winOdds).replace(".", ",")}`
                          : ""}
                      </div>
                    )}
                    {s.preRaceNote && (
                      <div className="reason" style={{ marginTop: "0.15rem" }}>
                        {s.preRaceNote}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {tip.dualDriverSignals.length > 0 && (
            <>
              <h3>Dubbelkuskar (2 lopp) · högst odds</h3>
              <p className="panel-lead">
                Kuskar i exakt två {product}-avdelningar brukar ofta vinna ett
                lopp – ofta med den dyraste hästen.
              </p>
              <ul className="alert-list table-alerts">
                {tip.dualDriverSignals.map((s) => (
                  <li key={`${s.driver}-${s.focusLeg}-${s.focusStartNumber}`}>
                    <strong>{s.driver}</strong>: fokusera {product}-
                    {s.focusLeg} #{s.focusStartNumber} {s.focusHorse}
                    {s.focusOdds != null
                      ? ` @ ${String(s.focusOdds).replace(".", ",")}`
                      : ""}{" "}
                    (högst odds av två)
                    <div className="reason" style={{ marginTop: "0.2rem" }}>
                      {s.mounts
                        .map(
                          (m) =>
                            `${product}-${m.leg} #${m.startNumber} ${m.horseName}${
                              m.winOdds != null
                                ? ` @ ${String(m.winOdds).replace(".", ",")}`
                                : ""
                            }${m.isHighestOdds ? " ★" : ""}`
                        )
                        .join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h2>
          {product} tipprad ·{" "}
          {tip.tipsStreckLabel ||
            `TS ${tip.legs.map((l) => l.pickNumbers?.length || 0).join("-")}`}
          {!tipsActive ? " · förhands" : ""}
        </h2>
        {!tipsActive && (
          <p className="panel-lead">
            {tip.tipsPhaseNote ||
              "Riktiga tippboostar aktiveras när föreloppen före omgången är klara – TS/tipprad visas redan nu."}
          </p>
        )}
        <div className="tip-strip" aria-label={`${product} tipsstreck`}>
          <strong>
            {tip.tipsStreckLabel ||
              `TS ${tip.legs.map((l) => l.pickNumbers?.length || 0).join("-")}`}
            {" · "}
            {fmtKr(tip.tipCostKr)} kr
            <span style={{ fontWeight: 500, opacity: 0.85 }}>
              {" "}
              ({tip.tipRows} rader ×{" "}
              {String(tip.rowPriceKr).replace(".", ",")} kr · budget{" "}
              {tip.tipBudgetMinKr}–{tip.tipBudgetMaxKr} kr)
              {!tipsActive ? " · förhandstips" : ""}
            </span>
          </strong>
          <div className="tip-strip-picks">
            {tip.legs.map((l) => (
              <span key={l.leg} className="tip-strip-pick">
                <em>
                  {product === "V64" ? "V64-" : "V75-"}
                  {l.leg}
                </em>
                {l.pickLabel || "–"}
                <span style={{ opacity: 0.65, marginLeft: "0.25rem" }}>
                  ({l.pickNumbers?.length || 0})
                </span>
              </span>
            ))}
          </div>
        </div>
        <p className="panel-lead" style={{ marginTop: "0.75rem" }}>
          <strong style={{ fontWeight: 650 }}>
            {tip.tipsStreckLabel || "TS"}
          </strong>
          {" · "}
          {tip.couponLine}
        </p>
        <ul className="alert-list table-alerts">
          {tip.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      {(tip.misleadingFavorites.length > 0 ||
        tip.valueHorses.length > 0 ||
        tip.homeTrackHorses.length > 0 ||
        tip.classDropHorses.length > 0 ||
        tip.highWinRateHorses.length > 0 ||
        tip.lowOddsReviews.length > 0) && (
        <section className="panel">
          <h2>Signaler · klass, seger%, lågodds &amp; värde</h2>
          <div className="grid-2 mobile-stack">
            {tip.classDropHorses.length > 0 && (
              <div>
                <h3>Nergraderade (bättre liga → hit)</h3>
                <ul className="alert-list table-alerts">
                  {tip.classDropHorses.map((m) => (
                    <li key={`cd-${m.leg}-${m.startNumber}`}>
                      {product}-{m.leg} #{m.startNumber} {m.name}: {m.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tip.highWinRateHorses.length > 0 && (
              <div>
                <h3>Högre seger% än fältet</h3>
                <ul className="alert-list table-alerts">
                  {tip.highWinRateHorses.map((m) => (
                    <li key={`wr-${m.leg}-${m.startNumber}`}>
                      {product}-{m.leg} #{m.startNumber} {m.name}:{" "}
                      {String(m.winRatePct).replace(".", ",")}% (+
                      {String(m.edgePct).replace(".", ",")}%-enh.)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {tip.lowOddsReviews.length > 0 && (
            <>
              <h3>Lågoddsare – grundlig koll</h3>
              <ul className="alert-list learning-alerts">
                {tip.lowOddsReviews.map((m) => (
                  <li key={`lo-${m.leg}-${m.startNumber}`}>
                    {product}-{m.leg} #{m.startNumber} {m.name} @{" "}
                    {String(m.winOdds).replace(".", ",")}
                    {m.supported === true
                      ? " · stödd"
                      : m.supported === false
                        ? " · svag / ifrågasatt"
                        : ""}
                    : {m.note}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="grid-2 mobile-stack">
            {tip.misleadingFavorites.length > 0 && (
              <div>
                <h3>Missvisande favoriter</h3>
                <ul className="alert-list learning-alerts">
                  {tip.misleadingFavorites.map((m) => (
                    <li key={`${m.leg}-${m.startNumber}`}>
                      {product}-{m.leg} #{m.startNumber} {m.name}: {m.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tip.valueHorses.length > 0 && (
              <div>
                <h3>Överodds / värde</h3>
                <ul className="alert-list table-alerts">
                  {tip.valueHorses.map((v) => (
                    <li key={`${v.leg}-${v.startNumber}`}>
                      {product}-{v.leg} #{v.startNumber} {v.name} (+
                      {String(v.edgePct).replace(".", ",")}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {tip.homeTrackHorses.length > 0 && (
            <>
              <h3>Hästar som trivs hemma</h3>
              <p className="panel-lead">
                {tip.homeTrackHorses
                  .slice(0, 10)
                  .map(
                    (h) =>
                      `${product}-${h.leg} #${h.startNumber} ${h.name}`
                  )
                  .join(" · ")}
              </p>
            </>
          )}
        </section>
      )}

      <section className="panel panel-systems">
        <h2>Avdelningar</h2>
        <p className="panel-lead">
          Jämför ATG-odds med {product}-streck och tips från flera sajter.
          Klicka på ett lopp för att öppna/stänga – samma som i resultat.
        </p>
        <div className="v75-leg-toolbar">
          <button type="button" className="system-btn" onClick={expandAll}>
            Öppna alla
          </button>
          <button type="button" className="system-btn" onClick={collapseAll}>
            Stäng alla
          </button>
        </div>
        <div className="match-cards v75-leg-list">
          {tip.legs.map((leg) => (
            <V75LegCard
              key={leg.leg}
              leg={leg}
              open={isOpen(leg.leg)}
              onToggle={() => toggleLeg(leg.leg)}
              productLabel={product}
            />
          ))}
        </div>
      </section>

      <section className="panel panel-articles">
        <h2>Tips från webben</h2>
        <p className="panel-lead">
          Källor som lästs in nu
          {tip.externalSources.filter((s) => s.ok).length
            ? ` (${tip.externalSources.filter((s) => s.ok).length} ok)`
            : ""}
          . Premium/paywall ger ofta bara rubriker.
        </p>
        <ul className="alert-list table-alerts">
          {tip.externalSources.map((s) => (
            <li key={s.source}>
              {s.ok ? "✓" : "✗"}{" "}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.source}
                </a>
              ) : (
                s.source
              )}
              {s.note ? ` – ${s.note}` : ""}
            </li>
          ))}
        </ul>
        {tip.headlineSignals.length > 0 && (
          <>
            <h3>Rubriker / signaler</h3>
            <ul className="alert-list learning-alerts">
              {tip.headlineSignals.slice(0, 8).map((h, i) => (
                <li key={`${h.source}-${i}`}>
                  <strong>{h.source}</strong>: {h.snippet || h.title}
                  {h.sentiment !== "mention" ? ` · ${h.sentiment}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="panel-lead">{tip.disclaimer}</p>
      </section>
    </div>
  );
}

type ApiResponse = {
  generatedAt: string;
  product?: ProductKind;
  draws: DrawBundle[];
  disclaimer: string;
  error?: string;
  preCloseRefreshMinutes?: number;
  fresh?: boolean;
};

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Datum utan klockslag, t.ex. "tis 24 nov" (Stockholm). */
function fmtHistoryDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Bara klockslag, t.ex. "19:00". */
function fmtClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function stockholmYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** T.ex. "Imorgon 00:59" / "Idag 20:29" för tydliga omgångsflikar. */
function fmtCloseLabel(iso: string): string {
  try {
    const target = new Date(iso);
    const now = new Date();
    const today = stockholmYmd(now);
    // mer exakt morgondag: stega tills datum byts
    let probe = new Date(now.getTime());
    let tomorrowIso = today;
    for (let i = 0; i < 48; i++) {
      probe = new Date(probe.getTime() + 60 * 60 * 1000);
      const ymd = stockholmYmd(probe);
      if (ymd !== today) {
        tomorrowIso = ymd;
        break;
      }
    }
    const ymd = stockholmYmd(target);
    const clock = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      hour: "2-digit",
      minute: "2-digit",
    }).format(target);
    if (ymd === today) return `Idag ${clock}`;
    if (ymd === tomorrowIso) return `Imorgon ${clock}`;
    return fmtTime(iso);
  } catch {
    return fmtTime(iso);
  }
}

function fmtOdds(n: number | null): string {
  if (n == null) return "–";
  return n.toFixed(2).replace(".", ",");
}

function Fatigue({
  level,
  label,
}: {
  level: "low" | "medium" | "high";
  label: string;
}) {
  if (level === "low") return null;
  return (
    <span className={`fat-pill ${level}`} title={label}>
      {level === "high" ? "tufft schema" : "belastning"} · {label}
    </span>
  );
}

function TablePill({
  comfort,
  note,
  label,
}: {
  comfort: "fighting" | "mid" | "comfortable" | "unknown";
  note: string;
  label: string;
}) {
  if (comfort === "unknown" || comfort === "mid") return null;
  return (
    <span className={`ctx-pill table-${comfort}`} title={note}>
      {comfort === "comfortable" ? "trygg tabell" : "poängjakt"} · {label}
    </span>
  );
}

function RestPill({
  level,
  note,
  label,
}: {
  level: "none" | "possible" | "likely";
  note: string;
  label: string;
}) {
  if (level === "none") return null;
  return (
    <span className={`ctx-pill rest-${level}`} title={note}>
      {level === "likely" ? "vila trolig" : "vila möjlig"} · {label}
    </span>
  );
}

function GoalNeedPill({
  need,
  note,
  label,
}: {
  need: "low" | "medium" | "high";
  note: string;
  label: string;
}) {
  if (need === "medium") return null;
  return (
    <span className={`ctx-pill goal-${need}`} title={note}>
      {need === "high" ? "jagar mål" : "mindre målhunger"} · {label}
    </span>
  );
}

type AnalysisTipRow = {
  eventNumber: number;
  description: string;
  outcomes: Outcome[];
  oddsLabel: string;
  kind: "safe" | "over" | "admin" | "trap";
  kindLabel: string;
  note: string;
};

function buildAnalysisTips(
  matches: DrawBundle["matches"]
): AnalysisTipRow[] {
  const rows: AnalysisTipRow[] = [];
  for (const m of matches) {
    const v = m.valueOdds;
    if (!v) continue;
    const admin = v.admin;
    const safe = admin?.safeWinner;
    if (safe) {
      rows.push({
        eventNumber: m.eventNumber,
        description: m.description,
        outcomes: ["2"],
        oddsLabel: `2 @ ${fmtOdds(safe.odds)}`,
        kind: "safe",
        kindLabel: "Säker vinnare",
        note: safe.note,
      });
      continue;
    }
    const traps = v.trapOverOddsOutcomes || [];
    const overs = v.overOddsOutcomes || [];
    const rec = admin?.recommended;
    if (rec && admin && admin.confidence !== "low") {
      const ov = v.outcomes.find((x) => x.outcome === rec);
      const coverFav =
        /Gardera gärna favoriten|mittfält-underdog/i.test(admin.verdict || "") &&
        m.favourite &&
        m.favourite !== rec;
      const outcomes: Outcome[] = coverFav
        ? (["1", "X", "2"] as Outcome[]).filter(
            (o) => o === rec || o === m.favourite
          )
        : [rec];
      rows.push({
        eventNumber: m.eventNumber,
        description: m.description,
        outcomes,
        oddsLabel: `${outcomes.join("")}${ov?.odds != null ? ` · ${rec} @ ${fmtOdds(ov.odds)}` : ""}`,
        kind: overs.includes(rec) ? "over" : "admin",
        kindLabel: overs.includes(rec) ? "Överodds-tips" : "1X2-tips",
        note: admin.verdict,
      });
      continue;
    }
    if (overs.length) {
      const outcomes = overs.filter((o) => !traps.includes(o));
      if (!outcomes.length) continue;
      const labels = outcomes
        .map((o) => {
          const ov = v.outcomes.find((x) => x.outcome === o);
          return `${o} @ ${fmtOdds(ov?.odds ?? null)}`;
        })
        .join(" · ");
      rows.push({
        eventNumber: m.eventNumber,
        description: m.description,
        outcomes,
        oddsLabel: labels,
        kind: "over",
        kindLabel: "Överodds-tips",
        note: v.explanations?.[0] || v.note,
      });
    }
  }
  return rows.sort((a, b) => a.eventNumber - b.eventNumber);
}

function AnalysisTipsCoupon({
  matches,
  product,
}: {
  matches: DrawBundle["matches"];
  product: Exclude<ProductKind, "oddset" | "hockey9">;
}) {
  const tips = buildAnalysisTips(matches);
  if (!tips.length) return null;
  const safeCount = tips.filter((t) => t.kind === "safe").length;
  return (
    <div className="coupon analysis-tips-coupon rise">
      <div className="coupon-head">
        <div>
          <h3>1X2-tips från analys</h3>
          <div style={{ color: "rgba(223,247,234,0.75)", fontSize: "0.85rem" }}>
            Säker vinnare, överodds och administrerad 1X2 – som tipprad
            {safeCount > 0 ? ` · ${safeCount} säker vinnare (2)` : ""}
          </div>
        </div>
        <div className="coupon-cost">{tips.length}</div>
      </div>
      {tips.map((t) => (
        <div
          className={`coupon-row tip-kind-${t.kind}`}
          key={`atip-${t.eventNumber}-${t.kind}`}
        >
          <strong>{t.eventNumber}</strong>
          <div>
            <div className="tip-row-title">
              <span className={`tip-kind-tag ${t.kind}`}>{t.kindLabel}</span>{" "}
              {t.description}
            </div>
            <div className="tip-row-odds">{t.oddsLabel}</div>
            <div style={{ fontSize: "0.75rem", opacity: 0.75 }}>{t.note}</div>
          </div>
          <div className="coupon-marks">
            {(["1", "X", "2"] as Outcome[]).map((o) => (
              <span
                key={o}
                className={`mark ${t.outcomes.includes(o) ? "filled" : ""}`}
              >
                {o}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div
        style={{
          marginTop: "0.85rem",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.85rem",
          color: "rgba(223,247,234,0.8)",
        }}
      >
        <span>{tips.length} tips</span>
        <span>{productLabel(product)} · analyskupong</span>
      </div>
    </div>
  );
}

function CouponView({
  system,
  product,
  rowPrice = 1,
}: {
  system: GeneratedSystem;
  product: Exclude<ProductKind, "oddset" | "hockey9">;
  rowPrice?: number;
}) {
  const isMal = system.kind === "mal" || product === "maltipset";
  return (
    <div className="coupon rise">
      <div className="coupon-head">
        <div>
          <h3>{system.name}</h3>
          <div style={{ color: "rgba(223,247,234,0.75)", fontSize: "0.85rem" }}>
            {system.summary} · risk {system.risk}
            {system.estimatedWinPct != null
              ? ` · vinstnivå ~${String(system.estimatedWinPct).replace(".", ",")}%`
              : system.estimatedHitPct != null
                ? ` · modell ~${String(system.estimatedHitPct).replace(".", ",")}%`
                : ""}
          </div>
        </div>
        <div className="coupon-cost">
          {String(system.costKr).replace(".", ",")} kr
          {(system.estimatedWinPct ?? system.estimatedHitPct) != null && (
            <div className="coupon-hit">
              ~{String(system.estimatedWinPct ?? system.estimatedHitPct).replace(".", ",")}%
            </div>
          )}
          {system.estimatedMaxPayoutKr != null && (
            <div
              className="coupon-hit"
              style={{
                color: system.payoutMeetsMin
                  ? "rgba(120, 220, 160, 0.95)"
                  : "rgba(240, 180, 100, 0.95)",
              }}
              title={system.payoutNote || "Beräknad utdelning vid fullträff (golv 3 000 kr, ingen tak)"}
            >
              utd. ~{Math.round(system.estimatedMaxPayoutKr).toLocaleString("sv-SE")} kr
            </div>
          )}
        </div>
      </div>
      {!isMal &&
        (system.undecidedEventNumbers?.length ?? 0) > 0 && (
          <div className="undecided-banner" role="status">
            Kan inte avgöras:{" "}
            {system.picks
              .filter((p) => p.undecided)
              .map((p) => `match ${p.eventNumber} (${p.description})`)
              .join(" · ")}
            . Helgarderas (1/X/2).
          </div>
        )}
      {system.picks.map((p) => {
        const malOn =
          isMal &&
          (system.malEventNumbers?.includes(p.eventNumber) ||
            p.outcomes.length > 0);
        return (
          <div
            className={`coupon-row ${p.undecided ? "undecided" : ""}`}
            key={p.eventNumber}
          >
            <strong>{p.eventNumber}</strong>
            <div>
              <div>
                {p.description}
                {p.undecided && (
                  <span className="undecided-tag"> Kan inte avgöras</span>
                )}
              </div>
              <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                {p.undecidedNote || p.reason}
              </div>
            </div>
            {isMal ? (
              <div className="coupon-marks">
                <span className={`mark ${malOn ? "filled" : ""}`}>
                  {malOn ? "M" : "·"}
                </span>
              </div>
            ) : (
              <div className="coupon-marks">
                {(["1", "X", "2"] as Outcome[]).map((o) => (
                  <span
                    key={o}
                    className={`mark ${p.outcomes.includes(o) ? "filled" : ""}`}
                  >
                    {o}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div
        style={{
          marginTop: "0.85rem",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.85rem",
          color: "rgba(223,247,234,0.8)",
        }}
      >
        <span>
          {system.kind === "r" && system.rSystem
            ? `${system.rSystem}: ${system.rows} rader × ${String(rowPrice).replace(".", ",")} kr`
            : `${system.rows} rader × ${String(rowPrice).replace(".", ",")} kr`}
          {system.kind === "r" && system.guaranteeRights != null
            ? ` · garanti ${system.guaranteeRights} rätt`
            : ""}
        </span>
        <span>{productLabel(product)}-kupong</span>
      </div>
    </div>
  );
}

function LineupPill({
  impact,
  label,
  note,
}: {
  impact: "better" | "worse" | "neutral" | "unknown";
  label: string;
  note: string;
}) {
  if (impact === "unknown" || impact === "neutral") return null;
  return (
    <span className={`ctx-pill lineup-${impact}`} title={note}>
      {impact === "worse" ? "sämre (borta)" : "bättre (lag)"} · {label}
    </span>
  );
}

function oddsForOutcome(
  valueOdds: DrawBundle["matches"][number]["valueOdds"] | null | undefined,
  o: Outcome
): string {
  const hit = valueOdds?.outcomes?.find((x) => x.outcome === o);
  return hit?.odds != null ? fmtOdds(hit.odds) : "";
}

function ValueOddsPill({
  valueOdds,
}: {
  valueOdds?: DrawBundle["matches"][number]["valueOdds"] | null;
}) {
  if (!valueOdds) return null;
  const traps = valueOdds.trapOverOddsOutcomes || [];
  const overs = valueOdds.overOddsOutcomes || [];
  const admin = valueOdds.admin;
  const safePill = admin?.safeWinner ? (
    <span
      className="ctx-pill value-safe"
      title={admin.safeWinner.note}
    >
      säker vinnare 2 @ {fmtOdds(admin.safeWinner.odds)}
    </span>
  ) : null;
  const adminPill =
    admin?.recommended && admin.confidence !== "low" && !admin.safeWinner ? (
      <span
        className={`ctx-pill value-admin${
          admin.confidence === "high" ? " high" : ""
        }`}
        title={admin.verdict}
      >
        rätt: {admin.recommended}
      </span>
    ) : null;
  const ryckPill = valueOdds.ryck?.toward ? (
    <span
      className="ctx-pill value-admin high"
      title={valueOdds.ryck.note}
    >
      oddsryck {valueOdds.ryck.toward}
      {valueOdds.ryck.allProvidersSync ? " · synk" : ""}
    </span>
  ) : null;
  if (traps.length || overs.length || adminPill || safePill || ryckPill) {
    return (
      <>
        {ryckPill}
        {safePill}
        {adminPill}
        {traps.map((o) => (
          <span
            key={`trap-${o}`}
            className="ctx-pill value-trap"
            title={
              valueOdds.outcomes.find((x) => x.outcome === o)?.explain ||
              valueOdds.note
            }
          >
            överodds-fälla {o}
            {oddsForOutcome(valueOdds, o)
              ? ` @ ${oddsForOutcome(valueOdds, o)}`
              : ""}
          </span>
        ))}
        {overs.map((o) => (
          <span
            key={`over-${o}`}
            className="ctx-pill value-over"
            title={
              valueOdds.outcomes.find((x) => x.outcome === o)?.explain ||
              valueOdds.note
            }
          >
            överodds {o}
            {oddsForOutcome(valueOdds, o)
              ? ` @ ${oddsForOutcome(valueOdds, o)}`
              : ""}
          </span>
        ))}
      </>
    );
  }
  if (valueOdds.folkOddsDisagree) {
    return (
      <span className="ctx-pill value-disagree" title={valueOdds.note}>
        folk ≠ odds
      </span>
    );
  }
  if (valueOdds.bestValue) {
    return (
      <span className="ctx-pill value-over" title={valueOdds.note}>
        värde {valueOdds.bestValue}
        {oddsForOutcome(valueOdds, valueOdds.bestValue)
          ? ` @ ${oddsForOutcome(valueOdds, valueOdds.bestValue)}`
          : ""}
      </span>
    );
  }
  return null;
}

function OverOddsExplain({
  valueOdds,
}: {
  valueOdds?: DrawBundle["matches"][number]["valueOdds"] | null;
}) {
  const safe = valueOdds?.admin?.safeWinner || null;
  const verdict = valueOdds?.admin?.verdict || null;
  const conf = valueOdds?.admin?.confidence;
  const recommended = valueOdds?.admin?.recommended;
  const ryckLine = valueOdds?.ryck?.note || null;
  const lines = [
    ...(ryckLine ? [ryckLine] : []),
    ...(valueOdds?.explanations?.filter(Boolean) ?? []),
  ];
  if (!safe && !verdict && !lines.length) return null;
  return (
    <div className="overodds-explain">
      {safe && (
        <div className="overodds-safe">
          <span className="overodds-admin-pick">2</span> {safe.note}
        </div>
      )}
      {verdict && (
        <div
          className={`overodds-admin${
            conf === "high" ? " high" : conf === "medium" ? " medium" : ""
          }`}
        >
          {recommended ? (
            <span className="overodds-admin-pick">{recommended}</span>
          ) : null}{" "}
          {verdict}
        </div>
      )}
      {lines.map((line) => (
        <div key={line} className="overodds-explain-line">
          {line}
        </div>
      ))}
    </div>
  );
}

function Odds1x2Marked({
  odds,
  valueOdds,
}: {
  odds: DrawBundle["matches"][number]["odds"];
  valueOdds?: DrawBundle["matches"][number]["valueOdds"] | null;
}) {
  const marked = new Set([
    ...(valueOdds?.overOddsOutcomes || []),
    ...(valueOdds?.trapOverOddsOutcomes || []),
  ]);
  const trap = new Set(valueOdds?.trapOverOddsOutcomes || []);
  const parts: Array<{ o: Outcome; v: number | null }> = [
    { o: "1", v: odds.one },
    { o: "X", v: odds.x },
    { o: "2", v: odds.two },
  ];
  return (
    <span className="odds odds-1x2">
      {parts.map((p, i) => (
        <span key={p.o}>
          {i > 0 ? " / " : null}
          <span
            className={
              marked.has(p.o)
                ? trap.has(p.o)
                  ? "odds-mark trap"
                  : "odds-mark over"
                : undefined
            }
            title={
              valueOdds?.outcomes.find((x) => x.outcome === p.o)?.explain ||
              undefined
            }
          >
            <span className="odds-side">{p.o}</span> {fmtOdds(p.v)}
          </span>
        </span>
      ))}
    </span>
  );
}

function EqualizerBlock({
  equalizer,
}: {
  equalizer: NonNullable<
    DrawBundle["matches"][number]["goals"]
  >["equalizer"];
}) {
  return (
    <div className={`equalizer-block eq-${equalizer.level}`}>
      <div className="equalizer-line">
        <strong>
          Utjämnarpress
          {equalizer.level === "strong"
            ? " · stark"
            : equalizer.level === "medium"
              ? " · medel"
              : " · svag"}
        </strong>
        <span>{equalizer.headline}</span>
      </div>
      {equalizer.points.length > 0 && (
        <div className="equalizer-points">
          {equalizer.points.map((p) => (
            <div key={p} className="equalizer-point">
              {p}
            </div>
          ))}
        </div>
      )}
      {equalizer.warnings.length > 0 && (
        <div className="equalizer-warnings">
          {equalizer.warnings.map((w) => (
            <div key={w} className="equalizer-warn">
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GoalBlock({
  goals,
  malSelected,
  goalRank,
}: {
  goals: NonNullable<DrawBundle["matches"][number]["goals"]>;
  malSelected?: boolean;
  goalRank?: number | null;
}) {
  const football = goals.sport === "football";
  return (
    <div className={`goal-block ${malSelected ? "mal-on" : ""}`}>
      {goals.equalizer && <EqualizerBlock equalizer={goals.equalizer} />}
      <div className="goal-line">
        <strong>
          Mål
          {goalRank != null ? ` · #${goalRank}` : ""}
          {malSelected ? " · tippas" : ""}
        </strong>
        {goals.expectedGoals != null ? (
          <span>
            ca {goals.expectedGoals.toFixed(1).replace(".", ",")} totalt ·{" "}
            {goals.likelyRange}
            {football && goals.over25ProbPct != null
              ? ` · Ö2,5 ${String(goals.over25ProbPct).replace(".", ",")}%`
              : ""}
            {football && goals.over35ProbPct != null
              ? ` · Ö3,5 ${String(goals.over35ProbPct).replace(".", ",")}%`
              : ""}
            {!football && goals.over45ProbPct != null
              ? ` · Ö4,5 ${String(goals.over45ProbPct).replace(".", ",")}%`
              : ""}
            {!football && goals.over55ProbPct != null
              ? ` · Ö5,5 ${String(goals.over55ProbPct).replace(".", ",")}%`
              : ""}
          </span>
        ) : (
          <span>{goals.note || "målanalys saknas"}</span>
        )}
      </div>
      {(goals.homeNeedNote || goals.awayNeedNote) && (
        <div className="goal-need">
          {[goals.homeNeedNote, goals.awayNeedNote]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function RivalryPill({ level, note }: { level: string; note: string }) {
  if (level === "none") return null;
  return (
    <span
      className={`ctx-pill ${level === "likely" ? "rest-likely" : "rest-possible"}`}
      title={note}
    >
      {level === "likely" ? "derby/bråk" : "möjlig rivalitet"}
    </span>
  );
}

function RedCardPill({
  level,
  note,
  probabilityPct,
}: {
  level: string;
  note: string;
  probabilityPct: number | null;
}) {
  if (level === "low") return null;
  return (
    <span
      className={`ctx-pill ${level === "high" ? "rest-likely" : "rest-possible"}`}
      title={note}
    >
      rött kort {level === "high" ? "hög" : "medel"}
      {probabilityPct != null ? ` · ${probabilityPct}%` : ""}
    </span>
  );
}

function outcomeClass(outcome?: OddsetTrackedTip["outcome"]): string {
  if (outcome === "won") return "oddset-card oddset-won";
  if (outcome === "lost") return "oddset-card oddset-lost";
  if (outcome === "live") return "oddset-card oddset-live";
  return "oddset-card";
}

function OddsetPickCard({
  c,
  index,
  tracked,
}: {
  c: OddsetCandidate | OddsetTrackedTip;
  index: number;
  tracked?: OddsetTrackedTip;
}) {
  const outcome = tracked?.outcome;
  const resultNote = tracked?.resultNote;
  const is1x2 = c.market === "1x2";
  const isHockey = c.sport === "hockey";
  const cover = c.pickCover?.length
    ? c.pickCover
    : is1x2 && c.pick1x2
      ? [c.pick1x2]
      : [];
  const pickLabel = is1x2
    ? `${isHockey ? "Hockey · " : ""}1X2 · ${
        cover.length ? cover.join("") : c.pick1x2 || "?"
      }`
    : "Över 1,5 mål";
  const oddsObj = {
    one: c.homeOdds ?? null,
    x: c.drawOdds ?? null,
    two: c.awayOdds ?? null,
  };
  return (
    <article className={`match-card ${outcomeClass(outcome)}`}>
      <div className="match-card-top">
        <span className="match-num">{index}</span>
        <div>
          <strong>
            {c.home} – {c.away}
          </strong>
          <div className="reason">
            {fmtTime(c.kickoff)} · {c.league}
            {c.country ? ` · ${c.country}` : ""}
            {isHockey ? " · ishockey · Powerplay-analys" : ""}
          </div>
        </div>
        <div className="pick-cells">
          {outcome === "won" || outcome === "lost" ? (
            <span
              className={`oddset-result-badge ${
                outcome === "won" ? "won" : "lost"
              }`}
            >
              {outcome === "won" ? "Rätt" : "Fel"}
            </span>
          ) : outcome === "live" ? (
            <span className="oddset-result-badge live">Live</span>
          ) : is1x2 ? (
            cover.length > 0 ? (
              (["1", "X", "2"] as const).map((o) => (
                <span
                  key={o}
                  className={`pick-cell${cover.includes(o) ? " on" : ""}`}
                >
                  {o}
                </span>
              ))
            ) : (
              <span className="pick-cell on">{c.pick1x2}</span>
            )
          ) : (
            <span className="pick-cell on">{c.over25ProbPct.toFixed(0)}%</span>
          )}
        </div>
      </div>
      {resultNote && (
        <div className="oddset-result-note">{resultNote}</div>
      )}
      <div className="oddset-pick-line">
        <span
          className={`ctx-pill ${
            is1x2 ? "value-admin high" : "table-comfortable"
          }`}
        >
          {pickLabel}
        </span>
        <span className="odds">
          Odds {fmtOdds(c.odds)}
          {!is1x2 && (
            <>
              {" "}
              · xG≈
              {c.expectedGoals != null
                ? c.expectedGoals.toFixed(2).replace(".", ",")
                : "–"}
            </>
          )}
          {is1x2 && <> · konf. {c.over25ProbPct.toFixed(0)}%</>}
        </span>
      </div>
      {isHockey && c.valueOdds ? (
        <Odds1x2Marked odds={oddsObj} valueOdds={c.valueOdds} />
      ) : null}
      {isHockey && c.goals ? (
        <GoalBlock goals={c.goals} />
      ) : c.equalizer ? (
        <EqualizerBlock equalizer={c.equalizer} />
      ) : null}
      {isHockey && (
        <div className="match-card-meta">
          {c.homeFatigue && (
            <Fatigue level={c.homeFatigue.level} label={c.home} />
          )}
          {c.awayFatigue && (
            <Fatigue level={c.awayFatigue.level} label={c.away} />
          )}
          {c.homeTable && (
            <TablePill
              comfort={c.homeTable.comfort}
              note={c.homeTable.note}
              label={c.home}
            />
          )}
          {c.awayTable && (
            <TablePill
              comfort={c.awayTable.comfort}
              note={c.awayTable.note}
              label={c.away}
            />
          )}
          {c.homeRest && (
            <RestPill
              level={c.homeRest.level}
              note={c.homeRest.note}
              label={c.home}
            />
          )}
          {c.awayRest && (
            <RestPill
              level={c.awayRest.level}
              note={c.awayRest.note}
              label={c.away}
            />
          )}
          <ValueOddsPill valueOdds={c.valueOdds} />
        </div>
      )}
      {isHockey && c.valueOdds ? <OverOddsExplain valueOdds={c.valueOdds} /> : null}
      <div className="match-card-meta">
        {is1x2 ? (
          <>
            <span className="odds">1 {fmtOdds(c.homeOdds ?? null)}</span>
            <span className="odds">X {fmtOdds(c.drawOdds ?? null)}</span>
            <span className="odds">2 {fmtOdds(c.awayOdds ?? null)}</span>
          </>
        ) : (
          <>
            <span className="odds">Ö2,5 {fmtOdds(c.odds25)}</span>
            <span className="odds">Ö3,5 {fmtOdds(c.odds35)}</span>
          </>
        )}
      </div>
      <div className="match-card-flags">
        <RivalryPill level={c.rivalry.level} note={c.rivalry.note} />
        <RedCardPill
          level={c.redCard.level}
          note={c.redCard.note}
          probabilityPct={c.redCard.probabilityPct}
        />
        {c.equalizer && (
          <span
            className={`ctx-pill eq-pill eq-${c.equalizer.level}`}
            title={c.equalizer.headline}
          >
            utjämnarpress{" "}
            {c.equalizer.level === "strong"
              ? "stark"
              : c.equalizer.level === "medium"
                ? "medel"
                : "svag"}
          </span>
        )}
      </div>
      <div className="reason">{c.reason}</div>
      {"learningNotes" in c &&
        Array.isArray(c.learningNotes) &&
        c.learningNotes.length > 0 && (
          <div className="learning-note">{c.learningNotes.join(" · ")}</div>
        )}
      <a
        className="oddset-link"
        href={c.url}
        target="_blank"
        rel="noreferrer"
      >
        Öppna på Oddset
      </a>
    </article>
  );
}

function HistoryGameCard({
  game,
  picks,
  collapsible = false,
}: {
  game: TipHistoryResponse["games"][number];
  picks: TipHistoryResponse["picks"];
  /** Powerplay/Topptipset: hopfälld ruta som öppnas vid klick. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const systemResult = game.systemResult || "pending";
  const waiting = game.pending + game.live;
  const scoreLabel = `${game.won} rätt / ${game.lost} fel${
    waiting > 0 ? ` · ${waiting} väntar` : ""
  }`;

  return (
    <section
      className={`panel history-game system-${systemResult}${
        collapsible ? " history-game-collapsible" : ""
      }${collapsible && open ? " is-open" : ""}${
        collapsible && !open ? " is-collapsed" : ""
      }`}
    >
      {collapsible ? (
        <button
          type="button"
          className="history-game-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="history-game-toggle-main">
            <span className="history-game-toggle-title">{game.label}</span>
            <span className="history-score">{scoreLabel}</span>
          </span>
          <span className="history-game-toggle-meta">
            {game.costKr != null && (
              <span className="history-cost-pill">{game.costKr} kr</span>
            )}
            {systemResult === "won" && (
              <span className="oddset-result-badge won">System grönt</span>
            )}
            {systemResult === "won" && game.payoutLabel && (
              <span className="history-payout-pill" title="Officiell utdelning">
                Utdelning {game.payoutLabel}
              </span>
            )}
            {systemResult === "lost" && (
              <span className="oddset-result-badge lost">System rött</span>
            )}
            {systemResult === "pending" && waiting > 0 && (
              <span className="oddset-result-badge live">Pågår</span>
            )}
            <span className="history-game-chevron" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
          </span>
        </button>
      ) : (
        <h3>
          {game.label}{" "}
          <span className="history-score">{scoreLabel}</span>
          {game.costKr != null && (
            <span className="history-cost-pill">{game.costKr} kr</span>
          )}
          {systemResult === "won" && (
            <span className="oddset-result-badge won">System grönt</span>
          )}
          {systemResult === "won" && game.payoutLabel && (
            <span className="history-payout-pill" title="Officiell utdelning">
              Utdelning {game.payoutLabel}
            </span>
          )}
          {systemResult === "lost" && (
            <span className="oddset-result-badge lost">System rött</span>
          )}
        </h3>
      )}

      {open && (
      <ul className="history-pick-list">
        {[...picks]
          .sort((a, b) => {
            const ak = a.kickoff ? Date.parse(a.kickoff) : 0;
            const bk = b.kickoff ? Date.parse(b.kickoff) : 0;
            return ak - bk || (a.eventNumber ?? 0) - (b.eventNumber ?? 0);
          })
          .map((p) => {
            const result1x2 =
              p.market === "1x2" ? outcomeFromActual(p.actual) : null;
            // Rätt/fel utifrån tipset mot slutsignal – inte bara sparad status
            // (1X mot 2 ska alltid bli Fel även om status felaktigt sagt Rätt).
            const displayStatus: HistoryPick["status"] =
              p.market === "1x2" && result1x2
                ? p.pick.includes(result1x2)
                  ? "won"
                  : "lost"
                : p.status;
            return (
          <li key={p.id} className={`history-pick ${displayStatus}`}>
            <div>
              <strong>
                {p.eventNumber != null ? `${p.eventNumber}. ` : ""}
                {p.description}
              </strong>
              {p.kickoff && (
                <div className="history-pick-date">
                  {p.product === "oddset" || p.product === "hockey_1x2"
                    ? `${fmtHistoryDate(p.kickoff)} · ${fmtClock(p.kickoff)}`
                    : fmtTime(p.kickoff)}
                </div>
              )}
              <div className="history-1x2-marks" aria-label="Tips">
                {p.market === "1x2"
                  ? (["1", "X", "2"] as const).map((o) => (
                      <span
                        key={o}
                        className={`history-mark ${
                          p.pick.includes(o) || result1x2 === o ? "on" : ""
                        } ${
                          result1x2 === o
                            ? p.pick.includes(o)
                              ? "hit"
                              : "miss"
                            : displayStatus === "lost" && p.pick.includes(o)
                              ? "miss"
                              : ""
                        }`}
                      >
                        {o}
                      </span>
                    ))
                  : null}
                {(p.market === "over_1_5" || p.market === "over_2_5") && (
                  <span
                    className={`history-mark on ${
                      displayStatus === "won"
                        ? "hit"
                        : displayStatus === "lost"
                          ? "miss"
                          : ""
                    }`}
                  >
                    {p.market === "over_2_5" ? "Ö2,5" : "Ö1,5"}
                  </span>
                )}
                {p.market === "mal" && (
                  <span
                    className={`history-mark on ${
                      displayStatus === "won"
                        ? "hit"
                        : displayStatus === "lost"
                          ? "miss"
                          : ""
                    }`}
                  >
                    M
                  </span>
                )}
                {(p.market === "atg_win" || p.market === "atg_twin") &&
                  p.pick.map((n) => (
                    <span
                      key={n}
                      className={`history-mark on ${
                        displayStatus === "won"
                          ? "hit"
                          : displayStatus === "lost"
                            ? "miss"
                            : ""
                      }`}
                    >
                      #{n}
                    </span>
                  ))}
              </div>
              <div className="reason">
                Tipset:{" "}
                {p.market === "over_1_5" || p.market === "over_2_5"
                  ? p.market === "over_2_5"
                    ? "Över 2,5"
                    : "Över 1,5"
                  : p.market === "mal"
                    ? "Målmatch"
                    : p.market === "atg_win"
                      ? `${p.product === "v64" ? "V64" : "V75"}-${p.eventNumber}: ${p.pick.join(",")}`
                      : p.market === "atg_twin"
                        ? `Tvilling L${p.eventNumber}: ${p.pick.join(",")}`
                      : p.pick.join("")}
                {p.actual
                  ? ` · resultat ${p.actual}${
                      result1x2 ? ` (1X2 ${result1x2})` : ""
                    }`
                  : ""}
              </div>
              {p.resultNote && (
                <div className="oddset-result-note">{p.resultNote}</div>
              )}
            </div>
            <span
              className={`oddset-result-badge ${
                displayStatus === "won"
                  ? "won"
                  : displayStatus === "lost"
                    ? "lost"
                    : displayStatus === "live"
                      ? "live"
                      : ""
              }`}
            >
              {displayStatus === "won"
                ? "Rätt"
                : displayStatus === "lost"
                  ? "Fel"
                  : displayStatus === "live"
                    ? "Live"
                    : "Väntar"}
            </span>
          </li>
            );
          })}
      </ul>
      )}
    </section>
  );
}

function fmtEsportsClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function EsportsBattleResultsPanel({
  refreshToken,
}: {
  /** Ökas när användaren trycker Uppdatera. */
  refreshToken: number;
}) {
  const [day, setDay] = useState<EsportsBattleDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (fresh: boolean) => {
    const local = loadEsportsBattleLocal();
    try {
      const res = await fetch(
        `/api/esports-battle${fresh ? "?fresh=1" : ""}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as EsportsBattleDay & { error?: string };
      if (!res.ok) throw new Error(json.error || "Kunde inte hämta resultat");
      const merged = mergeEsportsBattleMatches(local, json.matches || []);
      saveEsportsBattleLocal(merged);
      setDay({
        ...json,
        retentionHours: ESPORTS_BATTLE_RETENTION_HOURS,
        matches: merged,
        played: merged.length,
        latestLabel: merged[0]
          ? `${merged[0].homePlayer} ${merged[0].homeGoals}-${merged[0].awayGoals} ${merged[0].awayPlayer}`
          : json.latestLabel,
      });
      setError(null);
    } catch (e) {
      if (local.length) {
        saveEsportsBattleLocal(local);
        setDay({
          generatedAt: new Date().toISOString(),
          source: "Sparat lokalt",
          sourceUrl: "https://bettrails.com/resultados/esportsbattle?lang=en",
          playDateLabel: new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Europe/Stockholm",
            weekday: "short",
            day: "numeric",
            month: "short",
          }).format(new Date()),
          retentionHours: ESPORTS_BATTLE_RETENTION_HOURS,
          played: local.length,
          scheduled: null,
          goalsPerMatch: null,
          over65Pct: null,
          bttsPct: null,
          latestLabel: local[0]
            ? `${local[0].homePlayer} ${local[0].homeGoals}-${local[0].awayGoals} ${local[0].awayPlayer}`
            : null,
          matches: local,
        });
      }
      setError(e instanceof Error ? e.message : "Nätverksfel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(true);
  }, [load, refreshToken]);

  // Auto-uppdatera + rensa äldre än 3 h
  useEffect(() => {
    const id = setInterval(() => {
      void load(true);
    }, 90_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !day) {
    return <div className="loading">Hämtar Esports Battle…</div>;
  }
  if (error && !day) {
    return <p className="history-col-empty">{error}</p>;
  }
  if (!day) return null;

  const hours = day.retentionHours ?? ESPORTS_BATTLE_RETENTION_HOURS;

  return (
    <div className="esports-battle-results">
      <p className="panel-lead">
        Resultat sparas <strong>{hours} h</strong>, sedan bort ·{" "}
        {day.playDateLabel}
        {day.matches.length
          ? ` · ${day.matches.length} match${day.matches.length === 1 ? "" : "er"}`
          : ""}
        {day.goalsPerMatch != null
          ? ` · ${day.goalsPerMatch.toLocaleString("sv-SE")} mål/match`
          : ""}
        . Uppdateras automatiskt
        {day.latestLabel ? ` · senaste ${day.latestLabel}` : ""}.
      </p>
      {error && <p className="esports-battle-warn">{error}</p>}
      {day.matches.length === 0 ? (
        <p className="history-col-empty">
          Inga Esports Battle-resultat inom senaste {hours} h.
        </p>
      ) : (
        <ul className="esports-battle-list">
          {day.matches.map((m) => {
            const ageMs = Date.now() - Date.parse(m.kickoff);
            const leftMs = ESPORTS_BATTLE_RETENTION_MS - ageMs;
            const leftMin =
              Number.isFinite(leftMs) && leftMs > 0
                ? Math.max(1, Math.round(leftMs / 60_000))
                : 0;
            return (
              <li key={m.id} className="esports-battle-row">
                <span className="esports-battle-time">
                  {fmtEsportsClock(m.kickoff)}
                </span>
                <span className="esports-battle-match">
                  <span className="esports-battle-side">
                    <strong>{m.homePlayer}</strong>
                    {m.homeTeam ? (
                      <span className="esports-battle-team">{m.homeTeam}</span>
                    ) : null}
                  </span>
                  <span className="esports-battle-score">
                    {m.homeGoals}–{m.awayGoals}
                  </span>
                  <span className="esports-battle-side away">
                    <strong>{m.awayPlayer}</strong>
                    {m.awayTeam ? (
                      <span className="esports-battle-team">{m.awayTeam}</span>
                    ) : null}
                  </span>
                </span>
                <span
                  className="esports-battle-goals"
                  title={
                    leftMin > 0
                      ? `Bort om ca ${leftMin} min`
                      : "Tas bort snart"
                  }
                >
                  {m.totalGoals} mål
                  {leftMin > 0 && leftMin <= 60
                    ? ` · ${leftMin} min kvar`
                    : leftMin > 60
                      ? ` · ${Math.round(leftMin / 60)} h kvar`
                      : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="esports-battle-source">
        Källa: {day.source}
        {" · "}
        <a href={day.sourceUrl} target="_blank" rel="noreferrer">
          öppna
        </a>
        {` · sparas ${hours} h`}
      </p>
    </div>
  );
}

function HistoryView({
  history,
  seedPicks,
  initialLibrary,
  loading,
  onClose,
  onRefresh,
  onOpenProduct,
}: {
  history: TipHistoryResponse | null;
  /** Tips från aktuell tippvy (t.ex. Powerplay #4826) – alltid med i biblioteket. */
  seedPicks?: HistoryPick[];
  initialLibrary?: HistoryProduct | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOpenProduct?: (product: ProductKind) => void;
}) {
  const [library, setLibrary] = useState<HistoryProduct | null>(
    initialLibrary ?? null
  );
  const [esportsRefreshToken, setEsportsRefreshToken] = useState(0);
  const [esportsMeta, setEsportsMeta] = useState<{
    played: number | null;
    latest: string | null;
  } | null>(null);

  const displayHistory = useMemo(() => {
    const seeded = seedPicks || [];
    if (!history && !seeded.length) return null;
    if (!seeded.length) return history;
    const merged = mergeHistoryPickLists(history?.picks || [], seeded);
    return buildHistoryViewModel(merged, history?.games);
  }, [history, seedPicks]);

  const libraryMeta = HISTORY_PRODUCT_COLUMNS.find((c) => c.id === library);
  const libraryGames = useMemo(() => {
    if (!displayHistory || !library || library === "esports_battle") return [];
    return displayHistory.games
      .filter((g) => g.product === library)
      .sort((a, b) => {
        if (library === "powerplay" || library === "topptipset") {
          // Spelas-nu / ofärdiga 192 kr-omgångar först (t.ex. #4826)
          const aLive = a.pending + a.live > 0 ? 1 : 0;
          const bLive = b.pending + b.live > 0 ? 1 : 0;
          if (aLive !== bLive) return bLive - aLive;
          if (a.costKr === 192 && b.costKr !== 192) return -1;
          if (b.costKr === 192 && a.costKr !== 192) return 1;
          // Högre omgångsnummer (= nyare) först bland 192
          const aNum = Number(String(a.gameKey).split(":")[1] || 0);
          const bNum = Number(String(b.gameKey).split(":")[1] || 0);
          if (aNum !== bNum) return bNum - aNum;
        }
        return Date.parse(b.tippedAt) - Date.parse(a.tippedAt);
      });
  }, [displayHistory, library]);

  const libraryStats = useMemo(() => {
    if (!displayHistory || !library || library === "esports_battle") return null;
    const picks = displayHistory.picks.filter((p) => p.product === library);
    const won = picks.filter((p) => p.status === "won").length;
    const lost = picks.filter((p) => p.status === "lost").length;
    const pending = picks.filter(
      (p) => p.status === "pending" || p.status === "live"
    ).length;
    return { won, lost, pending, games: libraryGames.length };
  }, [displayHistory, library, libraryGames.length]);

  // Förhandsmeta till bibliotekskortet (antal inom 3 h)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const local = loadEsportsBattleLocal();
        const res = await fetch("/api/esports-battle", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled && local.length) {
            setEsportsMeta({
              played: local.length,
              latest: local[0]
                ? `${local[0].homePlayer} ${local[0].homeGoals}-${local[0].awayGoals} ${local[0].awayPlayer}`
                : null,
            });
          }
          return;
        }
        const json = (await res.json()) as EsportsBattleDay;
        const merged = mergeEsportsBattleMatches(local, json.matches || []);
        saveEsportsBattleLocal(merged);
        if (cancelled) return;
        setEsportsMeta({
          played: merged.length,
          latest: merged[0]
            ? `${merged[0].homePlayer} ${merged[0].homeGoals}-${merged[0].awayGoals} ${merged[0].awayPlayer}`
            : json.latestLabel,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [esportsRefreshToken]);

  const handleRefresh = () => {
    if (library === "esports_battle") {
      setEsportsRefreshToken((n) => n + 1);
    }
    onRefresh();
  };

  return (
    <div className="history-overlay" role="dialog" aria-modal="true">
      <div className="history-panel history-panel-wide rise">
        <div className="history-panel-top">
          <h2>
            {libraryMeta
              ? `${libraryMeta.label} · resultat`
              : "Resultat · bibliotek"}
          </h2>
          <div className="history-actions">
            {library && (
              <button
                type="button"
                className="history-btn ghost"
                onClick={() => setLibrary(null)}
              >
                Alla bibliotek
              </button>
            )}
            <button
              type="button"
              className="history-btn ghost"
              onClick={handleRefresh}
            >
              Uppdatera
            </button>
            <button type="button" className="history-btn" onClick={onClose}>
              Stäng
            </button>
          </div>
        </div>

        {!library && (
          <p className="panel-lead">
            Välj ett bibliotek per spelform. Bara matcher som startat eller är
            klara (8 h), inga framtida som “väntar”. 192 kr-system live via
            Flashscore. Esports Battle uppdateras automatiskt.
          </p>
        )}

        {loading && library !== "esports_battle" && (
          <div className="loading">Hämtar resultat…</div>
        )}

        {displayHistory && !loading && !library && (
          <>
            <div className="history-totals">
              <div>
                <strong>{displayHistory.totals.won}</strong>
                <span>rätt</span>
              </div>
              <div>
                <strong>{displayHistory.totals.lost}</strong>
                <span>fel</span>
              </div>
              <div>
                <strong>
                  {displayHistory.totals.pending + displayHistory.totals.live}
                </strong>
                <span>väntar</span>
              </div>
              <div>
                <strong>
                  {displayHistory.totals.settled > 0
                    ? `${Math.round(
                        (100 * displayHistory.totals.won) /
                          displayHistory.totals.settled
                      )}%`
                    : "–"}
                </strong>
                <span>träffsäkerhet</span>
              </div>
            </div>

            <div className="history-libraries" role="list">
              {HISTORY_PRODUCT_COLUMNS.map((col) => {
                if (col.id === "esports_battle") {
                  return (
                    <button
                      key={col.id}
                      type="button"
                      role="listitem"
                      className="history-library-card"
                      onClick={() => setLibrary(col.id)}
                    >
                      <span className="history-library-name">{col.label}</span>
                      <span className="history-library-meta">
                        {esportsMeta?.played != null
                          ? `${esportsMeta.played} inom 3 h`
                          : "Senaste 3 h"}
                        {esportsMeta?.latest
                          ? ` · ${esportsMeta.latest}`
                          : " · auto"}
                      </span>
                      <span className="history-library-open">
                        Öppna bibliotek →
                      </span>
                    </button>
                  );
                }
                const games = displayHistory.games.filter(
                  (g) => g.product === col.id
                );
                const picks = displayHistory.picks.filter(
                  (p) => p.product === col.id
                );
                const won = picks.filter((p) => p.status === "won").length;
                const lost = picks.filter((p) => p.status === "lost").length;
                const pending = picks.filter(
                  (p) => p.status === "pending" || p.status === "live"
                ).length;
                return (
                  <button
                    key={col.id}
                    type="button"
                    role="listitem"
                    className="history-library-card"
                    onClick={() => setLibrary(col.id)}
                  >
                    <span className="history-library-name">{col.label}</span>
                    <span className="history-library-meta">
                      {games.length} tipp{games.length === 1 ? "" : "ar"}
                      {picks.length > 0
                        ? ` · ${won} rätt · ${lost} fel${
                            pending > 0 ? ` · ${pending} väntar` : ""
                          }`
                        : " · tomt"}
                    </span>
                    <span className="history-library-open">Öppna bibliotek →</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {!library && !displayHistory && !loading && (
          <div className="history-libraries" role="list">
            <button
              type="button"
              role="listitem"
              className="history-library-card"
              onClick={() => setLibrary("esports_battle")}
            >
              <span className="history-library-name">Esports Battle</span>
              <span className="history-library-meta">
                {esportsMeta?.played != null
                  ? `${esportsMeta.played} inom 3 h`
                  : "Sparas 3 h · sedan bort"}
              </span>
              <span className="history-library-open">Öppna bibliotek →</span>
            </button>
          </div>
        )}

        {library === "esports_battle" && libraryMeta && (
          <div className="history-library-view">
            <div className="history-library-toolbar">
              <p className="panel-lead">
                Bibliotek: <strong>{libraryMeta.label}</strong> · sparas{" "}
                {ESPORTS_BATTLE_RETENTION_HOURS} h efter match, sedan bort ·
                uppdateras auto.
              </p>
            </div>
            <EsportsBattleResultsPanel refreshToken={esportsRefreshToken} />
          </div>
        )}

        {displayHistory &&
          !loading &&
          library &&
          libraryMeta &&
          library !== "esports_battle" && (
          <div className="history-library-view">
            <div className="history-library-toolbar">
              <p className="panel-lead">
                Bibliotek: <strong>{libraryMeta.label}</strong>
                {libraryStats
                  ? ` · ${libraryStats.games} tipp${
                      libraryStats.games === 1 ? "" : "ar"
                    } · ${libraryStats.won} rätt · ${libraryStats.lost} fel`
                  : ""}
                . Grönt = rätt, rött = fel
                {library === "powerplay" || library === "topptipset"
                  ? " · tryck på en ruta för att öppna/stänga"
                  : ""}
                .
              </p>
              {onOpenProduct && (
                <button
                  type="button"
                  className="history-btn"
                  onClick={() => {
                    onOpenProduct(
                      library === "hockey_1x2"
                        ? "hockey9"
                        : (library as ProductKind)
                    );
                    onClose();
                  }}
                >
                  Till {libraryMeta.label}
                </button>
              )}
            </div>

            {libraryGames.length === 0 ? (
              <p className="history-col-empty">
                Inga resultat i {libraryMeta.label} ännu.
                {library === "powerplay"
                  ? " Öppna Powerplay i menyn – tipset sparas automatiskt (192 kr)."
                  : library === "topptipset"
                    ? " Öppna Topptipset – 192 kr sparas i det här biblioteket."
                    : library === "hockey_1x2"
                      ? " Öppna Hockey 9 i menyn – tipset sparas här automatiskt."
                      : ""}
              </p>
            ) : (
              <div
                className={`history-library-list${
                  library === "powerplay" || library === "topptipset"
                    ? " history-library-list-compact"
                    : ""
                }`}
              >
                {libraryGames.map((g) => (
                  <HistoryGameCard
                    key={g.gameKey}
                    game={g}
                    collapsible={
                      library === "powerplay" || library === "topptipset"
                    }
                    picks={displayHistory.picks.filter(
                      (p) => p.gameKey === g.gameKey
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Hockey9View({ tip }: { tip: OddsetDayTip }) {
  const picksHockey1x2 = tip.selectedHockey1x2 || [];
  const picksHockey = tip.picksHockey1x2 ?? 9;
  const tracked = (tip.tracked || []).filter(
    (t) => t.sport === "hockey" || (t.market === "1x2" && /hockey/i.test(t.league || ""))
  );
  const trackedByKey = new Map(tracked.map((x) => [oddsetTrackKey(x), x]));
  const openKeys = new Set(picksHockey1x2.map((p) => oddsetTrackKey(p)));
  const history = tracked.filter((x) => !openKeys.has(oddsetTrackKey(x)));
  const retention = tip.retentionHours ?? TIP_HISTORY_RETENTION_HOURS;
  const won = tracked.filter((x) => x.outcome === "won").length;
  const lost = tracked.filter((x) => x.outcome === "lost").length;
  const extraHockey1x2 = (tip.candidatesHockey1x2 || []).slice(
    picksHockey1x2.length
  );

  return (
    <div className="rise">
      <section className="panel">
        <h2>Hockey 9 · {tip.playDateLabel}</h2>
        <p className="panel-lead">
          <strong>{picksHockey} tips</strong> ishockey · 1X2 (regulation, X
          efter 60 min) – samma analyslager som Powerplay: tabell,
          matchbelastning, vila, multi-book/överodds och målanalys. Tipsen
          ligger kvar <strong>{retention} timmar</strong>.
          {tip.eligibleHockey1x2Count != null
            ? ` Analyserat · ${tip.eligibleHockey1x2Count} klarade filtret`
            : ""}
          {tracked.length > 0
            ? ` · ${retention}h: ${won} rätt / ${lost} fel`
            : ""}
          .
        </p>
        <ul className="alert-list table-alerts">
          <li>
            Hockey 9 = nio 1X2-tips på ishockey med Powerplay-analys (inte
            Oddset Ö1,5/fotboll).
          </li>
          <li>
            {tip.hockey9PayoutNote ||
              "Beräknad utdelning (100 kr-rad × oddsprodukt): minst 3 000 kr, ingen övre gräns."}
            {tip.hockey9EstimatedPayoutKr != null
              ? ` Nu ~${Math.round(tip.hockey9EstimatedPayoutKr).toLocaleString("sv-SE")} kr${
                  tip.hockey9PayoutMeetsMin ? " ✓" : ""
                }.`
              : ""}
          </li>
          <li>
            Resultat syns i egen kolumn <strong>Hockey 9</strong> under Gamla
            resultat.
          </li>
        </ul>
      </section>

      <section className="panel panel-systems">
        <h2>
          Spela dessa · Hockey 9 ({picksHockey1x2.length}/{picksHockey})
        </h2>
        <p className="panel-lead">
          Tipprad med samma kort som Powerplay (målblock, oddsryck,
          tabell/vila).
        </p>
        {picksHockey1x2.length > 0 && (
          <div className="tip-strip" aria-label="Hockey 9 tipprad">
            <strong>Tipprad · Hockey 9</strong>
            <div className="tip-strip-picks">
              {picksHockey1x2.map((c, i) => (
                <span key={oddsetTrackKey(c)} className="tip-strip-pick">
                  <em>{i + 1}</em>
                  {(c.pickCover?.length
                    ? c.pickCover
                    : c.pick1x2
                      ? [c.pick1x2]
                      : []
                  ).join("") || "–"}
                </span>
              ))}
            </div>
          </div>
        )}
        {tip.hockeyAlerts &&
          (tip.hockeyAlerts.fatigueAlerts.length > 0 ||
            tip.hockeyAlerts.tableAlerts.length > 0 ||
            tip.hockeyAlerts.restAlerts.length > 0 ||
            tip.hockeyAlerts.goalAlerts.length > 0 ||
            tip.hockeyAlerts.valueAlerts.length > 0) && (
            <div className="oddset-hockey-alerts">
              {tip.hockeyAlerts.fatigueAlerts.length > 0 && (
                <>
                  <h3>Matchbelastning</h3>
                  <ul className="alert-list table-alerts">
                    {tip.hockeyAlerts.fatigueAlerts.slice(0, 8).map((a) => (
                      <li key={`hf-${a}`}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              {tip.hockeyAlerts.tableAlerts.length > 0 && (
                <>
                  <h3>Tabell & poängställning</h3>
                  <ul className="alert-list table-alerts">
                    {tip.hockeyAlerts.tableAlerts.slice(0, 8).map((a) => (
                      <li key={`ht-${a}`}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              {tip.hockeyAlerts.restAlerts.length > 0 && (
                <>
                  <h3>Vila</h3>
                  <ul className="alert-list table-alerts">
                    {tip.hockeyAlerts.restAlerts.slice(0, 8).map((a) => (
                      <li key={`hr-${a}`}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              {tip.hockeyAlerts.goalAlerts.length > 0 && (
                <>
                  <h3>Mål per match</h3>
                  <ul className="alert-list table-alerts">
                    {tip.hockeyAlerts.goalAlerts.slice(0, 8).map((a) => (
                      <li key={`hg-${a}`}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              {tip.hockeyAlerts.valueAlerts.length > 0 && (
                <>
                  <h3>Överodds & 1X2</h3>
                  <ul className="alert-list table-alerts">
                    {tip.hockeyAlerts.valueAlerts.slice(0, 8).map((a) => (
                      <li key={`hv-${a}`}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        {picksHockey1x2.length === 0 ? (
          <p className="panel-lead">
            Ingen ishockeymatch klarade 1X2-filtret just nu.
          </p>
        ) : (
          <div className="match-cards">
            {picksHockey1x2.map((c, i) => (
              <OddsetPickCard
                key={oddsetTrackKey(c)}
                c={c}
                index={i + 1}
                tracked={trackedByKey.get(oddsetTrackKey(c))}
              />
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="panel">
          <h2>Hockey-tips senaste {retention} h ({history.length})</h2>
          <div className="match-cards">
            {history.map((c, i) => (
              <OddsetPickCard
                key={`hist-${oddsetTrackKey(c)}`}
                c={c}
                index={i + 1}
                tracked={c}
              />
            ))}
          </div>
        </section>
      )}

      {extraHockey1x2.length > 0 && (
        <section className="panel">
          <h2>Fler godkända</h2>
          <div className="match-cards">
            {extraHockey1x2.map((c, i) => (
              <OddsetPickCard
                key={`h-${oddsetTrackKey(c)}`}
                c={c}
                index={picksHockey1x2.length + i + 1}
                tracked={trackedByKey.get(oddsetTrackKey(c))}
              />
            ))}
          </div>
        </section>
      )}

      <p className="disclaimer">{tip.disclaimer}</p>
    </div>
  );
}

function OddsetView({ tip }: { tip: OddsetDayTip }) {
  const picks = tip.selected || [];
  const picks1x2 = tip.selected1x2 || [];
  const picksPerDay = tip.picksPerDay ?? 5;
  const tracked = (tip.tracked || []).filter((t) => t.sport !== "hockey");
  const trackedByKey = new Map(tracked.map((x) => [oddsetTrackKey(x), x]));
  const openKeys = new Set(
    [...picks, ...picks1x2].map((p) => oddsetTrackKey(p))
  );
  const history = tracked.filter((x) => !openKeys.has(oddsetTrackKey(x)));
  const retention = tip.retentionHours ?? TIP_HISTORY_RETENTION_HOURS;
  const won = tracked.filter((x) => x.outcome === "won").length;
  const lost = tracked.filter((x) => x.outcome === "lost").length;
  const learning = tip.learning;
  const missLessons = (learning?.lessons || []).filter((l) => !l.hit).slice(0, 6);
  const hitLessons = (learning?.lessons || []).filter((l) => l.hit).slice(0, 3);
  const extraOver = (tip.candidates || []).slice(picks.length);
  const extra1x2 = (tip.candidates1x2 || []).slice(picks1x2.length);

  return (
    <div className="rise">
      <section className="panel">
        <h2>Öppna Oddset nu · {tip.playDateLabel}</h2>
        <p className="panel-lead">
          {picksPerDay} Över 1,5 + {picksPerDay} fotboll-<strong>1X2</strong>.
          Ishockey ligger under <strong>Hockey 9</strong>. Tipsen ligger kvar{" "}
          <strong>{retention} timmar</strong> – grönt/rött via Flashscore.
          Analyserat {tip.analyzedCount} · Ö1,5 {tip.eligibleCount}
          {tip.eligible1x2Count != null
            ? ` · 1X2 ${tip.eligible1x2Count}`
            : ""}{" "}
          klarade filtret
          {tracked.length > 0
            ? ` · ${retention}h: ${won} rätt / ${lost} fel`
            : ""}
          .
        </p>
        <ul className="alert-list table-alerts">
          {tip.rules
            .filter((r) => !/hockey/i.test(r))
            .map((r) => (
              <li key={r}>{r}</li>
            ))}
        </ul>
      </section>

      {learning && learning.summary.length > 0 && (
        <section className="panel">
          <h2>Lärdomar till nästa tips</h2>
          <p className="panel-lead">
            Uppdateras automatiskt när tips avgörs
            {learning.biasesNote ? ` · ${learning.biasesNote}` : ""}.
          </p>
          <ul className="alert-list learning-alerts">
            {learning.summary.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          {missLessons.length > 0 && (
            <div className="oddset-lesson-list">
              <h3>Varför det gick fel</h3>
              {missLessons.map((l) => (
                <div key={`miss-${l.eventId}`} className="oddset-lesson miss">
                  <strong>
                    {l.home}–{l.away} {l.homeGoals}–{l.awayGoals}
                  </strong>
                  <div className="reason">{l.whyWrong}</div>
                  <div className="oddset-next-aspect">→ {l.nextAspect}</div>
                </div>
              ))}
            </div>
          )}
          {hitLessons.length > 0 && (
            <div className="oddset-lesson-list">
              <h3>Vad som fungerade</h3>
              {hitLessons.map((l) => (
                <div key={`hit-${l.eventId}`} className="oddset-lesson hit">
                  <strong>
                    {l.home}–{l.away} {l.homeGoals}–{l.awayGoals}
                  </strong>
                  <div className="reason">
                    {l.whyRight || "Över 1,5 rätt"}
                  </div>
                  <div className="oddset-next-aspect">→ {l.nextAspect}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="panel panel-systems">
        <h2>Spela dessa · 1X2 fotboll ({picks1x2.length}/{picksPerDay})</h2>
        <p className="panel-lead">
          Samma analys som övriga tips: utjämnarpress, säker vinnare 2 @ ca
          2,00, mittfält-underdog och favorit med jakt på 1–1.
        </p>
        {picks1x2.length === 0 ? (
          <p className="panel-lead">
            Ingen match klarade 1X2-filtret just nu.
          </p>
        ) : (
          <div className="match-cards">
            {picks1x2.map((c, i) => (
              <OddsetPickCard
                key={oddsetTrackKey(c)}
                c={c}
                index={i + 1}
                tracked={trackedByKey.get(oddsetTrackKey(c))}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel panel-systems">
        <h2>Spela dessa · Över 1,5 ({picks.length}/{picksPerDay})</h2>
        {picks.length === 0 ? (
          <p className="panel-lead">
            Ingen match klarade lågmåls- och utjämnarkontrollen för Över
            1,5 just nu (0–0/1-mål eller svag jakt på 1–1).
          </p>
        ) : (
          <div className="match-cards">
            {picks.map((c, i) => (
              <OddsetPickCard
                key={oddsetTrackKey(c)}
                c={c}
                index={i + 1}
                tracked={trackedByKey.get(oddsetTrackKey(c))}
              />
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="panel">
          <h2>Tips senaste {retention} h ({history.length})</h2>
          <p className="panel-lead">
            Sparade tips markeras grönt (rätt) eller rött (fel) när matchen är
            avgjord – och matar nästa analys.
          </p>
          <div className="match-cards">
            {history.map((c, i) => (
              <OddsetPickCard
                key={`hist-${oddsetTrackKey(c)}`}
                c={c}
                index={i + 1}
                tracked={c}
              />
            ))}
          </div>
        </section>
      )}

      {(extra1x2.length > 0 || extraOver.length > 0) && (
        <section className="panel">
          <h2>Fler godkända</h2>
          <p className="panel-lead">
            Extra kandidater utöver dagens tips per marknad.
          </p>
          {extra1x2.length > 0 && (
            <>
              <h3>1X2 fotboll</h3>
              <div className="match-cards">
                {extra1x2.map((c, i) => (
                  <OddsetPickCard
                    key={`x-${oddsetTrackKey(c)}`}
                    c={c}
                    index={picks1x2.length + i + 1}
                    tracked={trackedByKey.get(oddsetTrackKey(c))}
                  />
                ))}
              </div>
            </>
          )}
          {extraOver.length > 0 && (
            <>
              <h3>Över 1,5</h3>
              <div className="match-cards">
                {extraOver.map((c, i) => (
                  <OddsetPickCard
                    key={`o-${oddsetTrackKey(c)}`}
                    c={c}
                    index={picks.length + i + 1}
                    tracked={trackedByKey.get(oddsetTrackKey(c))}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <p className="disclaimer">{tip.disclaimer}</p>
    </div>
  );
}


type AuthUser = {
  id: string;
  name: string;
  role: "admin" | "user";
  active: boolean;
  createdAt: string;
  isOwner?: boolean;
};

const STORE_TOKEN_KEY = "mikaels-tips-user-store-token";

function storeHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (typeof window !== "undefined") {
    const t = window.localStorage.getItem(STORE_TOKEN_KEY)?.trim();
    if (t) headers["x-user-store-token"] = t;
  }
  return headers;
}

type VisitRow = {
  id: string;
  at: string;
  ip: string;
  userName: string | null;
  path: string;
  kind: "login" | "view" | "login_fail";
};

function formatVisitTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function visitKindLabel(kind: VisitRow["kind"]): string {
  if (kind === "login") return "inloggning";
  if (kind === "login_fail") return "fel lösenord";
  return "tittade";
}

function UsersAdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    name: string;
    password: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [storeToken, setStoreToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    const t = window.localStorage.getItem(STORE_TOKEN_KEY) || "";
    setStoreToken(t);
    if (!t) setShowToken(true);
  }, []);

  const load = useCallback(async () => {
    const [usersRes, visitsRes] = await Promise.all([
      fetch("/api/auth/users", { cache: "no-store", headers: storeHeaders() }),
      fetch("/api/auth/visits", { cache: "no-store", headers: storeHeaders() }),
    ]);
    const usersJson = (await usersRes.json()) as {
      users?: AuthUser[];
      error?: string;
    };
    if (!usersRes.ok) {
      throw new Error(usersJson.error || "Kunde inte hämta behöriga");
    }
    setUsers(usersJson.users || []);
    if (visitsRes.ok) {
      const visitsJson = (await visitsRes.json()) as { visits?: VisitRow[] };
      setVisits(visitsJson.visits || []);
    }
  }, []);

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Fel")
    );
  }, [load]);

  function saveStoreToken() {
    const t = storeToken.trim();
    if (t) window.localStorage.setItem(STORE_TOKEN_KEY, t);
    else window.localStorage.removeItem(STORE_TOKEN_KEY);
    setInfo(
      t
        ? "Token sparad i din webbläsare – behöriga sparas permanent."
        : "Token borttagen."
    );
  }

  async function createUser() {
    setBusy(true);
    setError(null);
    setInfo(null);
    setCreated(null);
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: storeHeaders(),
        body: JSON.stringify({ name, autoPassword: true }),
      });
      const json = (await res.json()) as {
        user?: AuthUser;
        password?: string;
        persisted?: boolean;
        persistError?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Kunde inte ge access");
      setCreated({
        name: json.user?.name || name,
        password: json.password || "",
      });
      if (!json.persisted) {
        setInfo(
          "Access given nu, men spara en GitHub-token nedan så behörigheten ligger kvar permanent."
        );
        setShowToken(true);
      } else {
        setInfo("Personen har nu access och är sparad.");
      }
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fel");
    } finally {
      setBusy(false);
    }
  }

  async function kickUser(u: AuthUser, ban: boolean) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: storeHeaders(),
        body: JSON.stringify({
          action: ban ? "kick_ban" : "kick",
          id: u.id,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Kunde inte sparka ut");
      setInfo(
        ban
          ? `${u.name} är utsparkad och avstängd.`
          : `${u.name} är utsparkad (måste logga in igen).`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fel");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: AuthUser) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/users", {
        method: "PATCH",
        headers: storeHeaders(),
        body: JSON.stringify({ id: u.id, active: !u.active }),
      });
      const json = (await res.json()) as {
        error?: string;
        persisted?: boolean;
      };
      if (!res.ok) throw new Error(json.error || "Kunde inte uppdatera");
      setInfo(
        u.active
          ? `${u.name} har inte längre access.`
          : `${u.name} har access igen.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fel");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccess(u: AuthUser) {
    if (!window.confirm(`Ta bort ${u.name} helt? Personen kan då inte logga in.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/users", {
        method: "DELETE",
        headers: storeHeaders(),
        body: JSON.stringify({ id: u.id }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Kunde inte ta bort");
      setInfo(`${u.name} är borttagen – ingen access.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fel");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(u: AuthUser) {
    setBusy(true);
    setError(null);
    setInfo(null);
    setCreated(null);
    try {
      const res = await fetch("/api/auth/users", {
        method: "PATCH",
        headers: storeHeaders(),
        body: JSON.stringify({ id: u.id, resetPassword: true }),
      });
      const json = (await res.json()) as {
        user?: AuthUser;
        password?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Kunde inte återställa");
      setCreated({
        name: json.user?.name || u.name,
        password: json.password || "",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fel");
    } finally {
      setBusy(false);
    }
  }

  const allowed = users.filter((u) => u.active);
  const blocked = users.filter((u) => !u.active);

  return (
    <div className="history-overlay" role="dialog" aria-modal="true">
      <div className="history-panel rise">
        <div className="history-panel-top">
          <h2>Behörighet</h2>
          <div className="history-actions">
            <button type="button" className="history-btn" onClick={onClose}>
              Stäng
            </button>
          </div>
        </div>
        <p className="panel-lead">
          Bara du (Mikael) kan ändra Mikael’s tips. Inbjudna får endast spela –
          inte medlemmar, behörighet eller kontroll. De betalar per dag. Öppna{" "}
          <a href="/owner">Mikael’s kontroll</a>.
        </p>

        <div className="users-admin-form">
          <label>
            Namn på personen
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="t.ex. Anna"
              minLength={2}
            />
          </label>
          <button
            type="button"
            disabled={busy || name.trim().length < 2}
            onClick={() => void createUser()}
          >
            Ge access
          </button>
        </div>

        {error && <div className="status-banner error">{error}</div>}
        {info && <div className="status-banner ok">{info}</div>}
        {created && (
          <div className="created-creds">
            Skicka detta till <strong>{created.name}</strong>:
            <br />
            Namn: <code>{created.name}</code>
            <br />
            Lösenord: <code>{created.password}</code>
            <br />
            Länk: <code>https://tryckrad.vercel.app</code>
          </div>
        )}

        <h3 className="access-subhead">
          Har access ({allowed.length})
        </h3>
        <ul className="users-list">
          {allowed.map((u) => (
            <li key={u.id}>
              <div>
                <strong>{u.name}</strong>{" "}
                <span className="history-score">
                  {u.isOwner ? "huvudkonto" : "bara spel"}
                </span>
              </div>
              <div className="users-row-actions">
                <button
                  type="button"
                  disabled={busy || !!u.isOwner}
                  onClick={() => void kickUser(u, false)}
                >
                  Sparka ut
                </button>
                <button
                  type="button"
                  disabled={busy || !!u.isOwner}
                  onClick={() => void kickUser(u, true)}
                >
                  Sparka + stäng av
                </button>
                <button
                  type="button"
                  disabled={busy || !!u.isOwner}
                  onClick={() => void resetPassword(u)}
                >
                  Nytt lösenord
                </button>
                <button
                  type="button"
                  disabled={busy || !!u.isOwner}
                  onClick={() => void toggleActive(u)}
                >
                  Stäng av
                </button>
                <button
                  type="button"
                  disabled={busy || !!u.isOwner}
                  onClick={() => void removeAccess(u)}
                >
                  Ta bort
                </button>
              </div>
            </li>
          ))}
        </ul>

        {blocked.length > 0 && (
          <>
            <h3 className="access-subhead">
              Avstängda ({blocked.length})
            </h3>
            <ul className="users-list">
              {blocked.map((u) => (
                <li key={u.id} className="inactive">
                  <div>
                    <strong>{u.name}</strong>
                  </div>
                  <div className="users-row-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleActive(u)}
                    >
                      Ge access igen
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeAccess(u)}
                    >
                      Ta bort
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="access-subhead">
          IP på dem som tittar (bara du)
        </h3>
        <p className="panel-lead">
          Senaste inloggningar och besök. Syns bara för admin.
        </p>
        {visits.length === 0 ? (
          <p className="panel-lead">Inga besök loggade ännu.</p>
        ) : (
          <ul className="users-list visit-list">
            {visits.slice(0, 80).map((v) => (
              <li key={v.id}>
                <div>
                  <strong className="visit-ip">{v.ip}</strong>
                  <span className="history-score">
                    {" "}
                    · {v.userName || "okänd"} · {visitKindLabel(v.kind)}
                  </span>
                  <div className="reason">{formatVisitTime(v.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="access-token-box">
          <button
            type="button"
            className="history-btn ghost"
            onClick={() => setShowToken((v) => !v)}
          >
            {showToken ? "Dölj" : "Visa"} permanent sparning
          </button>
          {showToken && (
            <div className="access-token-fields">
              <p className="panel-lead">
                En gång: skapa en GitHub-token med rättighet{" "}
                <strong>repo</strong> och klistra in den här. Då sparas vilka
                som får titta så det håller mellan uppdateringar.{" "}
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=tryckrad-behorighet"
                  target="_blank"
                  rel="noreferrer"
                >
                  Skapa token
                </a>
              </p>
              <label>
                GitHub-token
                <input
                  type="password"
                  value={storeToken}
                  onChange={(e) => setStoreToken(e.target.value)}
                  placeholder="ghp_…"
                  autoComplete="off"
                />
              </label>
              <button type="button" onClick={saveStoreToken}>
                Spara token i webbläsaren
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [product, setProduct] = useState<ProductKind>("topptipset");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [oddset, setOddset] = useState<OddsetDayTip | null>(null);
  const [v75, setV75] = useState<V75DayTip | null>(null);
  const [tvilling, setTvilling] = useState<TvillingDayTip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDraw, setSelectedDraw] = useState<number | null>(null);
  const [selectedSystem, setSelectedSystem] = useState(0);
  const [preCloseNote, setPreCloseNote] = useState<string | null>(null);
  const [lastFreshAt, setLastFreshAt] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TipHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [showUsers, setShowUsers] = useState(false);
  const selectedDrawRef = useRef<number | null>(null);
  const preCloseStartedRef = useRef(false);
  /** Ökar vid produktbyte / ny hämtning – ogiltigförklarar in-flight svar. */
  const loadGenRef = useRef(0);
  selectedDrawRef.current = selectedDraw;

  const switchProduct = useCallback((next: ProductKind) => {
    if (next === product) return;
    loadGenRef.current += 1;
    setProduct(next);
    setLoading(true);
    setError(null);
    setPreCloseNote(null);
    preCloseStartedRef.current = false;
    // Rensa fel produkt så tippet inte “försvinner” / visar fel omgång
    if (next === "oddset" || next === "hockey9") {
      setOddset(null);
      setData(null);
      setV75(null);
      setTvilling(null);
    } else if (next === "v75" || next === "v64") {
      setV75(null);
      setData(null);
      setOddset(null);
      setTvilling(null);
    } else if (next === "tvilling") {
      setTvilling(null);
      setData(null);
      setOddset(null);
      setV75(null);
    } else {
      setData(null);
      setOddset(null);
      setV75(null);
      setTvilling(null);
    }
    setSelectedDraw(null);
    setSelectedSystem(0);
  }, [product]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 401) {
            const j = (await res.json().catch(() => null)) as {
              code?: string;
            } | null;
            if (j?.code === "kicked") {
              window.location.href = "/login";
            }
          }
          return;
        }
        const json = (await res.json()) as { user?: AuthUser | null };
        if (json.user) setAuthUser(json.user);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Om ägaren sparkar ut dig → utloggning
  useEffect(() => {
    if (!authUser) return;
    const id = window.setInterval(() => {
      void fetch("/api/auth/me", { cache: "no-store" }).then(async (res) => {
        if (res.status === 401) {
          const j = (await res.json().catch(() => null)) as {
            code?: string;
          } | null;
          if (j?.code === "kicked") window.location.href = "/login";
        }
      });
    }, 20_000);
    return () => window.clearInterval(id);
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    void fetch("/api/auth/visits", {
      method: "POST",
      headers: storeHeaders(),
      body: JSON.stringify({ path: window.location.pathname || "/" }),
    }).catch(() => {
      /* ignore */
    });
  }, [authUser]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const loadProduct = useCallback(
    async (opts: { fresh?: boolean; silent?: boolean; resetSelection?: boolean }) => {
      const fresh = opts.fresh === true;
      const silent = opts.silent === true;
      const forProduct = product;
      const gen = ++loadGenRef.current;
      const isCurrent = () => gen === loadGenRef.current;

      try {
        if (!silent) {
          setLoading(true);
          setError(null);
          if (opts.resetSelection !== false) setSelectedDraw(null);
        } else {
          setRefreshing(true);
        }

        if (forProduct === "v75" || forProduct === "v64") {
          const label = forProduct === "v64" ? "V64" : "V75";
          const res = await fetch(
            `/api/${forProduct}${fresh ? "?fresh=1" : ""}`,
            { cache: "no-store" }
          );
          if (!isCurrent()) return;
          const json = (await res.json()) as V75DayTip & {
            error?: string;
            fresh?: boolean;
          };
          if (!isCurrent()) return;
          if (!res.ok)
            throw new Error(json.error || `Kunde inte hämta ${label}`);
          const tip = { ...json, product: json.product || label };
          setV75(tip);
          const atgPicks = atgTipToHistoryPicks(tip);
          if (atgPicks.length) {
            saveLocalHistoryPicks([
              ...loadLocalHistoryPicks(),
              ...atgPicks,
            ]);
          }
          if (fresh || json.fresh) setLastFreshAt(json.generatedAt);
        } else if (forProduct === "tvilling") {
          const res = await fetch(
            `/api/tvilling${fresh ? "?fresh=1" : ""}`,
            { cache: "no-store" }
          );
          if (!isCurrent()) return;
          const json = (await res.json()) as TvillingDayTip & {
            error?: string;
            fresh?: boolean;
          };
          if (!isCurrent()) return;
          if (!res.ok)
            throw new Error(json.error || "Kunde inte hämta Tvilling");
          setTvilling(json);
          const twinPicks = tvillingTipToHistoryPicks(json);
          if (twinPicks.length) {
            saveLocalHistoryPicks([
              ...loadLocalHistoryPicks(),
              ...twinPicks,
            ]);
          }
          if (fresh || json.fresh) setLastFreshAt(json.generatedAt);
        } else if (forProduct === "oddset" || forProduct === "hockey9") {
          const localTips = loadOddsetLocalTips();
          const localLessons = loadOddsetLocalLessons();
          const res = await fetch(
            `/api/oddset${fresh ? "?fresh=1" : ""}`,
            {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientTips: localTips.map((t) => ({
                  ...t,
                  tippedAt: t.tippedAt,
                })),
                clientLessons: localLessons,
              }),
            }
          );
          if (!isCurrent()) return;
          const json = (await res.json()) as OddsetDayTip & {
            error?: string;
            fresh?: boolean;
          };
          if (!isCurrent()) return;
          if (!res.ok) throw new Error(json.error || "Kunde inte hämta Oddset");
          const tippedAt = json.generatedAt || new Date().toISOString();
          const fromSelected: OddsetTrackedTip[] = (json.selected || []).map(
            (c) => ({
              ...c,
              tippedAt,
              outcome: "pending" as const,
              homeGoals: null,
              awayGoals: null,
              totalGoals: null,
              settledAt: null,
              resultNote: null,
            })
          );
          const merged = mergeOddsetTracked(
            localTips,
            fromSelected,
            json.tracked
          );
          saveOddsetLocalTips(merged);
          saveOddsetLocalLessons([
            ...localLessons,
            ...(json.learning?.lessons || []),
          ]);
          saveLocalHistoryPicks([
            ...loadLocalHistoryPicks(),
            ...oddsetToHistoryPicks(merged, tippedAt),
          ]);
          if (!isCurrent()) return;
          setOddset({ ...json, tracked: merged });
          if (fresh || json.fresh) setLastFreshAt(json.generatedAt);
        } else {
          const res = await fetch(
            `/api/draws?product=${forProduct}${fresh ? "&fresh=1" : ""}`,
            { cache: "no-store" }
          );
          if (!isCurrent()) return;
          const json = (await res.json()) as ApiResponse;
          if (!isCurrent()) return;
          if (!res.ok) throw new Error(json.error || "Kunde inte hämta data");
          const keep = selectedDrawRef.current;
          setData({ ...json, product: forProduct });
          if (opts.resetSelection === false && keep != null) {
            const still =
              json.draws.some((d) => d.drawNumber === keep)
                ? keep
                : json.draws[0]?.drawNumber ?? null;
            setSelectedDraw(still);
          } else {
            setSelectedDraw(json.draws[0]?.drawNumber ?? null);
            setSelectedSystem(0);
          }
          const tippedAt = json.generatedAt || new Date().toISOString();
          const drawPicks = (json.draws || []).flatMap((d) =>
            drawToHistoryPicks(d, tippedAt)
          );
          saveLocalHistoryPicks([
            ...loadLocalHistoryPicks(),
            ...drawPicks,
          ]);
          if (fresh || json.fresh) setLastFreshAt(json.generatedAt);
        }
      } catch (e) {
        if (!isCurrent()) return;
        if (!silent) {
          setError(e instanceof Error ? e.message : "Nätverksfel");
        }
      } finally {
        if (!isCurrent()) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [product]
  );

  useEffect(() => {
    void loadProduct({ resetSelection: true });
    return () => {
      // Avbryt state-uppdateringar från föregående produkts hämtning
      loadGenRef.current += 1;
    };
  }, [loadProduct]);

  // Oddset: polla resultat + lärdomar automatiskt medan tips väntar på slutsignal
  useEffect(() => {
    if (product !== "oddset" || !oddset) return;
    const needsSettle = (oddset.tracked || []).some((t) => {
      if (t.outcome === "won" || t.outcome === "lost") return false;
      const kick = Date.parse(t.kickoff);
      return Number.isFinite(kick) && Date.now() >= kick + 5 * 60 * 1000;
    });
    if (!needsSettle) return;

    // Snabbare poll medan matcher pågår så Resultat/Oddset uppdateras
    const id = setInterval(() => {
      void loadProduct({ fresh: true, silent: true, resetSelection: false });
    }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [product, oddset, loadProduct]);

  /** Tipprader från tippvyn – Powerplay #4826, Oddset, V75/V64 m.m. */
  const historySeedPicks = useMemo(() => {
    const out: HistoryPick[] = [];
    if (data?.draws?.length) {
      const at = data.generatedAt || new Date().toISOString();
      for (const d of data.draws) {
        out.push(...drawToHistoryPicks(d, at));
      }
    }
    const oddsetLocal = loadOddsetLocalTips();
    if (oddsetLocal.length) {
      out.push(
        ...oddsetToHistoryPicks(
          oddsetLocal,
          oddset?.generatedAt || new Date().toISOString()
        )
      );
    } else if (oddset?.tracked?.length) {
      out.push(
        ...oddsetToHistoryPicks(
          oddset.tracked,
          oddset.generatedAt || new Date().toISOString()
        )
      );
    }
    if (v75) {
      out.push(...atgTipToHistoryPicks(v75));
    }
    if (tvilling) {
      out.push(...tvillingTipToHistoryPicks(tvilling));
    }
    return out;
  }, [data, oddset, v75, tvilling]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      // Tippen som syns i tippvyn måste följa med till resultatbiblioteket
      const fromDraws =
        data?.draws?.length
          ? data.draws.flatMap((d) =>
              drawToHistoryPicks(d, data.generatedAt || new Date().toISOString())
            )
          : [];
      const fromOddset = oddsetToHistoryPicks(
        mergeOddsetTracked(loadOddsetLocalTips(), oddset?.tracked),
        oddset?.generatedAt || new Date().toISOString()
      );
      const fromAtg = v75 ? atgTipToHistoryPicks(v75) : [];
      const fromTvilling = tvilling ? tvillingTipToHistoryPicks(tvilling) : [];
      const local = mergeHistoryPickLists(
        loadLocalHistoryPicks(),
        fromDraws,
        fromOddset,
        fromAtg,
        fromTvilling,
        historySeedPicks
      );
      if (local.length) saveLocalHistoryPicks(local);

      const res = await fetch("/api/history", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks: local }),
      });
      const json = (await res.json()) as TipHistoryResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Kunde inte hämta historik");
      // Merga – skriv aldrig över lokala/tipp-rader (t.ex. #4826)
      const merged = mergeHistoryPickLists(
        local,
        json.picks || [],
        fromDraws,
        fromOddset,
        fromAtg,
        fromTvilling,
        historySeedPicks
      );
      saveLocalHistoryPicks(merged);

      // Spegla settlade Oddset-rader tillbaka till Oddset-localStorage
      const settledOddset = merged.filter(
        (p) => p.product === "oddset" || p.product === "hockey_1x2"
      );
      if (settledOddset.length) {
        const byEvent = new Map(
          settledOddset.map((p) => [
            p.id,
            p,
          ])
        );
        const tips = loadOddsetLocalTips().map((t) => {
          const id =
            t.market === "1x2"
              ? `oddset:${t.eventId}:1x2:${t.pick1x2 || "1"}`
              : `oddset:${t.eventId}:over`;
          const h = byEvent.get(id);
          if (!h) return t;
          if (h.status !== "won" && h.status !== "lost" && h.status !== "live") {
            return t;
          }
          const [hg, ag] = (h.actual || "").split("-").map(Number);
          return {
            ...t,
            outcome: h.status,
            homeGoals: Number.isFinite(hg) ? hg : t.homeGoals,
            awayGoals: Number.isFinite(ag) ? ag : t.awayGoals,
            totalGoals:
              Number.isFinite(hg) && Number.isFinite(ag)
                ? hg + ag
                : t.totalGoals,
            settledAt:
              h.status === "won" || h.status === "lost"
                ? h.settledAt || t.settledAt || new Date().toISOString()
                : null,
            resultNote: h.resultNote || t.resultNote,
          };
        });
        saveOddsetLocalTips(tips);
        if (oddset) {
          setOddset({
            ...oddset,
            tracked: mergeOddsetTracked(tips, oddset.tracked),
          });
        }
      }

      setHistory(buildHistoryViewModel(merged, json.games));
    } catch {
      const picks = mergeHistoryPickLists(
        loadLocalHistoryPicks(),
        historySeedPicks
      );
      setHistory(buildHistoryViewModel(picks));
    } finally {
      setHistoryLoading(false);
    }
  }, [data, oddset, v75, tvilling, historySeedPicks]);

  const openHistory = useCallback(() => {
    setShowHistory(true);
    setHistoryLoading(true);
    // Värm PP/Topp + settla Oddset (färdigspelade via Flashscore)
    // innan resultatbiblioteket byggs.
    void (async () => {
      try {
        const tippedAt = new Date().toISOString();
        if (historySeedPicks.length) {
          saveLocalHistoryPicks([
            ...loadLocalHistoryPicks(),
            ...historySeedPicks,
          ]);
        }

        // Oddset: tvinga settlement av väntande tips innan Resultat visas
        const localOddset = loadOddsetLocalTips();
        if (localOddset.length) {
          try {
            const oddRes = await fetch("/api/oddset?fresh=1", {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientTips: localOddset,
                clientLessons: loadOddsetLocalLessons(),
              }),
            });
            if (oddRes.ok) {
              const oddJson = (await oddRes.json()) as OddsetDayTip;
              const mergedTips = mergeOddsetTracked(
                localOddset,
                oddJson.tracked
              );
              saveOddsetLocalTips(mergedTips);
              saveLocalHistoryPicks([
                ...loadLocalHistoryPicks(),
                ...oddsetToHistoryPicks(
                  mergedTips,
                  oddJson.generatedAt || tippedAt
                ),
              ]);
              if (oddset || product === "oddset" || product === "hockey9") {
                setOddset({
                  ...(oddJson as OddsetDayTip),
                  tracked: mergedTips,
                });
              }
            }
          } catch {
            /* ignore */
          }
        }

        const [ppRes, toppRes, v75Res, v64Res, twinRes] = await Promise.all([
          fetch("/api/draws?product=powerplay", { cache: "no-store" }),
          fetch("/api/draws?product=topptipset", { cache: "no-store" }),
          fetch("/api/v75", { cache: "no-store" }),
          fetch("/api/v64", { cache: "no-store" }),
          fetch("/api/tvilling", { cache: "no-store" }),
        ]);
        const extra: HistoryPick[] = [];
        for (const res of [ppRes, toppRes]) {
          if (!res.ok) continue;
          const json = (await res.json()) as {
            generatedAt?: string;
            draws?: DrawBundle[];
          };
          const at = json.generatedAt || tippedAt;
          for (const d of json.draws || []) {
            extra.push(...drawToHistoryPicks(d, at));
          }
        }
        for (const res of [v75Res, v64Res]) {
          if (!res.ok) continue;
          try {
            const json = (await res.json()) as V75DayTip;
            extra.push(...atgTipToHistoryPicks(json));
          } catch {
            /* ignore */
          }
        }
        if (twinRes.ok) {
          try {
            const json = (await twinRes.json()) as TvillingDayTip;
            extra.push(...tvillingTipToHistoryPicks(json));
          } catch {
            /* ignore */
          }
        }
        if (extra.length) {
          saveLocalHistoryPicks([...loadLocalHistoryPicks(), ...extra]);
        }
      } catch {
        /* ignore */
      }
      await loadHistory();
    })();
  }, [loadHistory, historySeedPicks, oddset, product]);

  const draw = useMemo(() => {
    if (!data || data.product !== product) return null;
    return (
      data.draws.find((d) => d.drawNumber === selectedDraw) ??
      data.draws[0] ??
      null
    );
  }, [data, selectedDraw, product]);

  const closeTimes = useMemo(() => {
    if ((product === "v75" || product === "v64") && v75) {
      const want = product === "v64" ? "V64" : "V75";
      if (v75.product && v75.product !== want) return [];
      return (v75.legs || [])
        .map((l) => l.startTime)
        .filter((t): t is string => Boolean(t));
    }
    if (product === "tvilling" && tvilling) {
      return (tvilling.races || [])
        .map((r) => r.startTime)
        .filter((t): t is string => Boolean(t));
    }
    if ((product === "oddset" || product === "hockey9") && oddset) {
      if (product === "hockey9") {
        const list = oddset.selectedHockey1x2?.length
          ? oddset.selectedHockey1x2
          : oddset.candidatesHockey1x2 || [];
        return list.map((c) => c.kickoff).filter(Boolean);
      }
      const list = oddset.selected?.length
        ? oddset.selected
        : oddset.candidates || [];
      return list.map((c) => c.kickoff).filter(Boolean);
    }
    if (!data || data.product !== product) return [];
    return (data.draws || []).map((d) => d.closeTime).filter(Boolean);
  }, [product, data, oddset, v75, tvilling]);

  const v75Matches =
    !!v75 &&
    (product === "v75" || product === "v64") &&
    (!v75.product || v75.product === (product === "v64" ? "V64" : "V75"));
  const tvillingMatches = !!tvilling && product === "tvilling";
  const drawsMatch = !!data && data.product === product;
  const contentPending =
    !error &&
    (loading ||
      ((product === "oddset" || product === "hockey9") && !oddset) ||
      ((product === "v75" || product === "v64") && !v75Matches) ||
      (product === "tvilling" && !tvillingMatches) ||
      (product !== "oddset" &&
        product !== "hockey9" &&
        product !== "v75" &&
        product !== "v64" &&
        product !== "tvilling" &&
        !drawsMatch));

  // Sista kollen 10 min före spelstopp: hämta färska odds/omsättning och ställ om tips
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let noteTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const clear = () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (noteTimer) clearInterval(noteTimer);
      timer = null;
      poll = null;
      noteTimer = null;
    };

    if (!closeTimes.length) {
      setPreCloseNote(null);
      preCloseStartedRef.current = false;
      return;
    }

    const activeClose = () => {
      const now = Date.now();
      if (
        product !== "oddset" &&
        product !== "hockey9" &&
        draw?.closeTime
      ) {
        return draw.closeTime;
      }
      return (
        closeTimes
          .map((t) => ({ t, ms: new Date(t).getTime() }))
          .filter((x) => Number.isFinite(x.ms) && x.ms > now - 60_000)
          .sort((a, b) => a.ms - b.ms)[0]?.t ?? null
      );
    };

    const updateNote = () => {
      const c = activeClose();
      setPreCloseNote(c ? formatPreCloseLabel(c) : null);
    };
    updateNote();
    noteTimer = setInterval(updateNote, 30_000);

    /** Färsk analys + tips omställda efter odds/omsättning (golv 3 000 kr). */
    const runFinalCheck = () =>
      loadProduct({ fresh: true, silent: true, resetSelection: false }).then(
        () => {
          if (cancelled) return;
          // Visa bästa omställda systemet (högst utdelning över golvet först)
          setSelectedSystem(0);
        }
      );

    const arm = () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      timer = null;
      poll = null;

      const now = Date.now();
      const inWindow = closeTimes.some((t) => isInPreCloseWindow(t, now));
      if (inWindow) {
        if (!preCloseStartedRef.current) {
          preCloseStartedRef.current = true;
          void runFinalCheck();
        }
        poll = setInterval(() => {
          if (cancelled) return;
          const still = closeTimes.some((t) => isInPreCloseWindow(t));
          if (!still) {
            preCloseStartedRef.current = false;
            arm();
            return;
          }
          void runFinalCheck();
        }, 60_000);
        return;
      }

      preCloseStartedRef.current = false;
      const nextAt = nextPreCloseRefreshAt(closeTimes, now);
      if (nextAt == null) return;
      const delay = Math.max(1_000, Math.min(nextAt - now, 2_147_000_000));
      timer = setTimeout(() => {
        if (cancelled) return;
        preCloseStartedRef.current = false;
        void runFinalCheck().then(() => {
          if (!cancelled) arm();
        });
      }, delay);
    };

    arm();
    return () => {
      cancelled = true;
      clear();
    };
  }, [product, closeTimes, draw?.closeTime, loadProduct]);

  useEffect(() => {
    setSelectedSystem(0);
  }, [selectedDraw]);

  const scrollToAnalysisTips = () => {
    const el = document.getElementById("analysis-tips");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // Tips visas per omgång – se till att draw-vyn är synlig
    document
      .querySelector(".analysis-tips-coupon")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app-shell">
      <div className="top-menu-fixed" role="navigation" aria-label="Huvudmeny">
        <div className="product-switch top-menu-row" role="tablist" aria-label="Produkt">
          <button
            type="button"
            className="product-btn history-launch"
            onClick={openHistory}
            title="Gamla resultat – tips med rätt/fel i 8 timmar efter färdigt spel"
          >
            <span className="btn-label-full">Gamla resultat</span>
            <span className="btn-label-short">Resultat</span>
          </button>
          <button
            type="button"
            className="product-btn tips-launch"
            onClick={scrollToAnalysisTips}
            disabled={
              product === "oddset" ||
              product === "hockey9" ||
              product === "v75" ||
              product === "v64" ||
              product === "tvilling"
            }
            title="Hoppa till 1X2-tips från analys"
          >
            1X2
          </button>
          {DRAW_PRODUCTS.map((p) => (
            <button
              key={p}
              type="button"
              className={`product-btn ${product === p ? "active" : ""}`}
              onClick={() => switchProduct(p)}
            >
              <span className="btn-label-full">{productLabel(p)}</span>
              <span className="btn-label-short">
                {p === "topptipset"
                  ? "Topp"
                  : p === "powerplay"
                    ? "PP"
                    : p === "stryktipset"
                      ? "Stryk"
                      : p === "europatipset"
                        ? "Europa"
                        : "Mål"}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`product-btn ${product === "oddset" ? "active" : ""}`}
            onClick={() => switchProduct("oddset")}
          >
            Oddset
          </button>
          <button
            type="button"
            className={`product-btn ${product === "hockey9" ? "active" : ""}`}
            onClick={() => switchProduct("hockey9")}
          >
            <span className="btn-label-full">Hockey 9</span>
            <span className="btn-label-short">H9</span>
          </button>
          <button
            type="button"
            className={`product-btn ${product === "v75" ? "active" : ""}`}
            onClick={() => switchProduct("v75")}
          >
            V75
          </button>
          <button
            type="button"
            className={`product-btn ${product === "v64" ? "active" : ""}`}
            onClick={() => switchProduct("v64")}
          >
            V64
          </button>
          <button
            type="button"
            className={`product-btn ${product === "tvilling" ? "active" : ""}`}
            onClick={() => switchProduct("tvilling")}
          >
            <span className="btn-label-full">Tvilling</span>
            <span className="btn-label-short">Tvil</span>
          </button>
          {authUser?.isOwner && (
            <a
              className="product-btn"
              href="/owner"
              title="Din kontrollsida – konton, kick & provision"
            >
              <span className="btn-label-full">Min kontroll</span>
              <span className="btn-label-short">Kontroll</span>
            </a>
          )}
          {authUser?.isOwner && (
            <button
              type="button"
              className="product-btn"
              onClick={() => setShowUsers(true)}
              title="Styr vilka som får öppna appen"
            >
              <span className="btn-label-full">Behörighet</span>
              <span className="btn-label-short">Access</span>
            </button>
          )}
          {authUser && (
            <button
              type="button"
              className="product-btn menu-logout"
              onClick={() => void logout()}
              title={`Inloggad som ${authUser.name}`}
            >
              <span className="btn-label-full">Logga ut</span>
              <span className="btn-label-short">Ut</span>
            </button>
          )}
        </div>
      </div>

      <header className="brand-bar">
        <div>
          <h1 className="brand-mark">
            Mikael’s <span>tips</span>
          </h1>
          <p className="brand-tag">
            Sista kollen 10 min före spelstopp: tips ställs om efter färska
            odds/omsättning (golv 3 000 kr). Tryck på Gamla resultat för
            rätt/fel – syns 8 h efter start/klart (inga framtida matcher).
            Powerplay/Topptipset lär av missar. Stryk/Mål: lagnyheter ca 15 min
            före avspark.
          </p>
        </div>
        <div className="meta-chip">
          {authUser && (
            <span className="user-chip">
              Inloggad: <strong>{authUser.name}</strong>
              {authUser.isOwner ? " · huvudkonto" : ""}
            </span>
          )}{" "}
          {product === "v75" || product === "v64"
            ? v75
              ? `Uppdaterad ${fmtTime(v75.generatedAt)} · ${
                  v75.product || (product === "v64" ? "V64" : "V75")
                } ${v75.playDate}`
              : `Hämtar ${product === "v64" ? "V64" : "V75"}…`
            : product === "tvilling"
              ? tvilling
                ? `Uppdaterad ${fmtTime(tvilling.generatedAt)} · Tvilling ${tvilling.playDate}`
                : "Hämtar Tvilling…"
              : product === "oddset" || product === "hockey9"
                ? oddset
                  ? `Uppdaterad ${fmtTime(oddset.generatedAt)} · ${
                      product === "hockey9" ? "Hockey 9" : "Oddset"
                    } ${oddset.playDate}`
                  : product === "hockey9"
                    ? "Hämtar Hockey 9…"
                    : "Hämtar Oddset…"
                : data
                  ? `Uppdaterad ${fmtTime(data.generatedAt)} · ${data.draws.length} omgångar`
                  : "Hämtar Svenska Spel…"}
          {refreshing ? " · uppdaterar…" : ""}
          {lastFreshAt ? ` · färsk före stopp ${fmtTime(lastFreshAt)}` : ""}
        </div>
      </header>

      {showHistory && (
        <HistoryView
          history={history}
          seedPicks={historySeedPicks}
          initialLibrary={
            product === "powerplay" ||
            product === "topptipset" ||
            product === "stryktipset" ||
            product === "europatipset" ||
            product === "maltipset" ||
            product === "oddset"
              ? product
              : product === "hockey9"
                ? "hockey_1x2"
                : null
          }
          loading={historyLoading}
          onClose={() => setShowHistory(false)}
          onRefresh={() => void loadHistory()}
          onOpenProduct={(p) => switchProduct(p)}
        />
      )}

      {showUsers && authUser?.isOwner && (
        <UsersAdminPanel onClose={() => setShowUsers(false)} />
      )}

      {preCloseNote && (
        <div className="preclose-banner" role="status">
          {preCloseNote}
        </div>
      )}

      {contentPending && (
        <div className="loading">
          {product === "v75" || product === "v64"
            ? `Hämtar ${
                product === "v64" ? "V64" : "V75"
              } från ATG och jämför tips/odds…`
            : product === "tvilling"
              ? "Hämtar Tvilling från ATG…"
              : product === "oddset"
                ? "Analyserar öppna Oddset-matcher…"
                : product === "hockey9"
                  ? "Analyserar ishockey · Hockey 9…"
                  : `Läser in öppna ${productLabel(product)}-omgångar…`}
        </div>
      )}
      {error && <div className="status-banner error">{error}</div>}

      {!contentPending && !error && product === "oddset" && oddset && (
        <OddsetView tip={oddset} />
      )}

      {!contentPending && !error && product === "hockey9" && oddset && (
        <Hockey9View tip={oddset} />
      )}

      {!contentPending &&
        !error &&
        (product === "v75" || product === "v64") &&
        v75Matches &&
        v75 && <V75View tip={v75} />}

      {!contentPending &&
        !error &&
        product === "tvilling" &&
        tvillingMatches &&
        tvilling && <TvillingView tip={tvilling} />}

      {!contentPending &&
        !error &&
        drawsMatch &&
        product !== "oddset" &&
        product !== "hockey9" &&
        product !== "v75" &&
        product !== "v64" &&
        product !== "tvilling" && (
        <>
          <nav className="draw-tabs" aria-label="Speltillfällen">
            {data.draws.map((d, idx) => {
              const closeMs = Date.parse(d.closeTime);
              const hoursLeft =
                Number.isFinite(closeMs)
                  ? (closeMs - Date.now()) / (60 * 60 * 1000)
                  : Infinity;
              const state = String(d.drawState || "");
              const isPlaying =
                state === "Closed" ||
                (state !== "Finalized" && hoursLeft <= 0);
              const isOpenTip =
                state !== "Closed" && state !== "Finalized";
              const firstOpenIdx = data.draws.findIndex((x) => {
                const s = String(x.drawState || "");
                return s !== "Closed" && s !== "Finalized";
              });
              const isNextOpen = isOpenTip && idx === firstOpenIdx;
              const isNextUp =
                isPlaying || isNextOpen || (isOpenTip && hoursLeft <= 12);
              const firstMatch = d.matches?.[0];
              const firstLabel = firstMatch
                ? `${firstMatch.home.name}–${firstMatch.away.name}`
                : null;
              return (
                <button
                  key={d.drawNumber}
                  type="button"
                  className={`draw-tab ${
                    (selectedDraw ?? data.draws[0]?.drawNumber) === d.drawNumber
                      ? "active"
                      : ""
                  } ${isNextUp ? "draw-tab-now" : ""}`}
                  onClick={() => setSelectedDraw(d.drawNumber)}
                >
                  <span className="label">
                    {fmtCloseLabel(d.closeTime)}
                    {isPlaying ? (
                      <em className="draw-now-badge">Spelas nu</em>
                    ) : isNextOpen ? (
                      <em className="draw-now-badge">Nästa</em>
                    ) : null}
                  </span>
                  <span className="sub">
                    #{d.drawNumber} ·{" "}
                    {isPlaying
                      ? "stängd · pågår"
                      : `stänger ${fmtTime(d.closeTime)}`}
                    <br />
                    {firstLabel || d.leagueSummary || d.sport}
                    {product === "powerplay" &&
                      d.systems?.some((s) => s.costKr === 192) && (
                        <>
                          <br />
                          192 kr sparas i resultat
                        </>
                      )}
                  </span>
                </button>
              );
            })}
          </nav>

          {draw && (
            <div className="rise">
              <section className="panel">
                <h2>{draw.closeDescription || `Omgång #${draw.drawNumber}`}</h2>
                <p className="panel-lead">
                  {String(draw.drawState || "") === "Closed"
                    ? "Spelas nu"
                    : String(draw.drawState || "") === "Finalized"
                      ? "Färdigspelad"
                      : "Öppen omgång"}{" "}
                  · {fmtCloseLabel(draw.closeTime)} · #{draw.drawNumber} ·{" "}
                  {draw.matches.length} matcher · {draw.leagueSummary}
                  {String(draw.drawState || "") === "Closed" ||
                  String(draw.drawState || "") === "Finalized"
                    ? " · stängd"
                    : ` · stänger ${fmtTime(draw.closeTime)}`}
                  {draw.netSale ? ` · omsättning ${draw.netSale} kr` : ""}
                </p>

                <div className="tip-strip" aria-label="Tipprad">
                  <strong>
                    {product === "maltipset" ? "Måltips (8)" : "Tipprad"}
                  </strong>
                  <div className="tip-strip-picks">
                    {product === "maltipset"
                      ? (draw.malTip?.length
                          ? draw.malTip
                          : draw.matches
                              .filter((m) => m.malSelected)
                              .map((m) => m.eventNumber)
                        ).map((n) => (
                          <span key={n} className="tip-strip-pick">
                            <em>{n}</em>M
                          </span>
                        ))
                      : draw.matches.map((m) => (
                          <span key={m.eventNumber} className="tip-strip-pick">
                            <em>{m.eventNumber}</em>
                            {m.pick.join("")}
                          </span>
                        ))}
                  </div>
                </div>

                {(draw.fatigueAlerts?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>Matchbelastning</h2>
                    <ul className="alert-list">
                      {draw.fatigueAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(draw.tableAlerts?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>Tabell & poängställning</h2>
                    <ul className="alert-list table-alerts">
                      {draw.tableAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(draw.restAlerts?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>Vila inför viktigare match</h2>
                    <ul className="alert-list rest-alerts">
                      {draw.restAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(product === "powerplay" || product === "maltipset") &&
                  (draw.goalAlerts?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>
                      {product === "maltipset"
                        ? "Förväntat målantal (rangordning)"
                        : "Mål per match"}
                    </h2>
                    <ul className="alert-list goal-alerts">
                      {draw.goalAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(isStrykFamily(product) || product === "maltipset") &&
                  (draw.lineupAlerts?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>
                      Laguppställning / sen analys
                    </h2>
                    <ul className="alert-list lineup-alerts">
                      {draw.lineupAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(isStrykFamily(product) || product === "maltipset") &&
                  (draw.lineupAlerts?.length ?? 0) === 0 && (
                  <p className="panel-lead" style={{ marginTop: "0.75rem" }}>
                    Sen analys aktiveras automatiskt ca 15 minuter före varje
                    matchstart: spelare borta och oddsrörelse vägs in som bättre
                    eller sämre för laget.
                  </p>
                )}
                {(buildAnalysisTips(draw.matches).length > 0 ||
                  (draw.safeWinners?.length ?? 0) > 0 ||
                  (draw.valueAlerts?.length ?? 0) > 0) && (
                  <div id="analysis-tips">
                    <h2 style={{ fontSize: "1.05rem" }}>
                      Överodds & 1X2-tips
                    </h2>
                    <p className="panel-lead">
                      Analysen läggs ut som tipprad med 1/X/2-markering.
                      Säker vinnare = enkel 2 @ ca 2,00. Överodds och
                      bedömningar visas som tips, inte bara text.
                    </p>
                    <AnalysisTipsCoupon
                      matches={draw.matches}
                      product={product}
                    />
                  </div>
                )}
                {(product === "powerplay" || product === "topptipset") &&
                  (draw.learningAlerts?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>
                      Lärdomar från förra omgången
                    </h2>
                    <p className="panel-lead">
                      Efter varje avslutad omgång analyseras missar automatiskt
                      och vägs in i nästa tipprad (unikt per omgång).
                    </p>
                    <ul className="alert-list learning-alerts">
                      {draw.learningAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <div className="grid-2 mobile-stack">
                <section className="panel panel-systems">
                  <h2>
                    {product === "maltipset"
                      ? "M-system (8 målrikaste)"
                      : isStrykFamily(product)
                        ? "Systemspel (6) · R 4-4-144"
                        : "System 48–720 kr"}
                  </h2>
                  <p className="panel-lead">
                    {product === "powerplay" || product === "topptipset"
                      ? "48 kr är ett säkerhetssystem: gardering där det skakar, enkel bara vid stark odds/folk-konsensus. Siffran ~% är uppskattad chans till 8 rätt – inte garanti. "
                      : isStrykFamily(product)
                        ? "Sex systemspel: matematiska kuponger plus reducerat R 4-4-144 (4 hel · 4 halv · 5 spik, garanti 12 rätt om tecknen sitter). "
                        : ""}
                    Beräknad utdelning (odds × omsättning) har golv minst 3 000
                    kr – ingen max-tak. Kupongen speglar{" "}
                    {productLabel(product)}-raden på Svenska Spel. Kostnad =
                    antal kombinationer ×{" "}
                    {String(draw.rowPrice).replace(".", ",")} kr
                    {product === "maltipset" ? " (M8–M12)" : ""}.
                  </p>
                  <div className="system-switch">
                    {draw.systems.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        className={`system-btn ${selectedSystem === i ? "active" : ""}`}
                        onClick={() => setSelectedSystem(i)}
                      >
                        {s.kind === "r" && s.rSystem
                          ? `${s.rSystem.replace(/\s+/g, "")} · ${String(s.costKr).replace(".", ",")} kr`
                          : `${String(s.costKr).replace(".", ",")} kr`}
                        {s.kind === "r" && s.guaranteeRights != null
                          ? ` · G${s.guaranteeRights}`
                          : s.estimatedWinPct != null
                            ? ` · ~${Math.round(s.estimatedWinPct)}%`
                            : s.estimatedHitPct != null
                              ? ` · ~${Math.round(s.estimatedHitPct)}%`
                              : ` · ${s.risk}`}
                        {s.estimatedMaxPayoutKr != null
                          ? ` · ~${Math.round(s.estimatedMaxPayoutKr / 1000)}k`
                          : ""}
                      </button>
                    ))}
                  </div>
                  {draw.systems[selectedSystem] && (
                    <CouponView
                      system={draw.systems[selectedSystem]}
                      product={product}
                      rowPrice={draw.rowPrice}
                    />
                  )}
                </section>

                <section className="panel">
                  <h2>Matcher & tipsläge</h2>
                  <p className="panel-lead">
                    {product === "maltipset"
                      ? "Rangordnar de 30 matcherna efter förväntat målantal (Kambi + motivation/lagnyheter). Tippa de 8 målrikaste."
                      : `Baserat på odds, svenska folket, tabelläge, vilomotiv och schema${
                          product === "powerplay"
                            ? ", plus förväntat antal mål"
                            : isStrykFamily(product)
                              ? ", plus sen laganalys 15 min före avspark"
                              : ""
                        }. Garderingar läggs där osäkerhet, trygg tabell eller trötthet är högst.`}
                  </p>

                  <div className="match-cards">
                    {draw.matches.map((m) => {
                      const undecided =
                        draw.systems[selectedSystem]?.undecidedEventNumbers?.includes(
                          m.eventNumber
                        ) ||
                        draw.systems[selectedSystem]?.picks.find(
                          (p) => p.eventNumber === m.eventNumber
                        )?.undecided;
                      const undecidedNote = draw.systems[
                        selectedSystem
                      ]?.picks.find(
                        (p) => p.eventNumber === m.eventNumber
                      )?.undecidedNote;
                      return (
                      <article
                        className={`match-card ${undecided ? "undecided-match" : ""}`}
                        key={m.eventNumber}
                      >
                        <div className="match-card-top">
                          <span className="match-num">{m.eventNumber}</span>
                          <div>
                            <strong>
                              {m.description}
                              {undecided && (
                                <span className="undecided-tag">
                                  {" "}
                                  Kan inte avgöras
                                </span>
                              )}
                            </strong>
                            <div className="reason">
                              {fmtTime(m.matchStart)} · {m.league}
                              {undecidedNote ? ` · ${undecidedNote}` : ""}
                            </div>
                          </div>
                          <div className="pick-cells">
                            {product === "maltipset" ? (
                              <span
                                className={`pick-cell ${m.malSelected ? "on" : ""}`}
                              >
                                {m.malSelected ? "M" : "·"}
                              </span>
                            ) : (
                              (["1", "X", "2"] as Outcome[]).map((o) => (
                                <span
                                  key={o}
                                  className={`pick-cell ${m.pick.includes(o) ? "on" : ""}`}
                                >
                                  {o}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="match-card-meta">
                          <span className="odds">
                            Odds{" "}
                            <Odds1x2Marked
                              odds={m.odds}
                              valueOdds={m.valueOdds}
                            />
                          </span>
                          <span className="odds">
                            Folk {m.svenskaFolket.one}-{m.svenskaFolket.x}-
                            {m.svenskaFolket.two}
                          </span>
                        </div>
                        {m.goals && (
                          <GoalBlock
                            goals={m.goals}
                            malSelected={m.malSelected}
                            goalRank={m.goalRank}
                          />
                        )}
                        {m.lineup?.windowActive && (
                          <div className="lineup-block late">
                            <strong>Sen analys</strong> {m.lineup.note}
                          </div>
                        )}
                        {!m.lineup?.windowActive &&
                          (isStrykFamily(product) ||
                            product === "maltipset") &&
                          (m.lineup?.items?.length ?? 0) > 0 && (
                          <div className="lineup-block">
                            <strong>Lag</strong> {m.lineup.note}
                          </div>
                        )}
                        <div className="match-card-flags">
                          <Fatigue
                            level={m.homeFatigue.level}
                            label={m.home.name}
                          />
                          <Fatigue
                            level={m.awayFatigue.level}
                            label={m.away.name}
                          />
                          <TablePill
                            comfort={m.homeTable.comfort}
                            note={m.homeTable.note}
                            label={m.home.name}
                          />
                          <TablePill
                            comfort={m.awayTable.comfort}
                            note={m.awayTable.note}
                            label={m.away.name}
                          />
                          <RestPill
                            level={m.homeRest.level}
                            note={m.homeRest.note}
                            label={m.home.name}
                          />
                          <RestPill
                            level={m.awayRest.level}
                            note={m.awayRest.note}
                            label={m.away.name}
                          />
                          <ValueOddsPill valueOdds={m.valueOdds} />
                          {m.goals && (
                            <>
                              {m.goals.equalizer && (
                                <span
                                  className={`ctx-pill eq-pill eq-${m.goals.equalizer.level}`}
                                  title={m.goals.equalizer.headline}
                                >
                                  utjämnarpress{" "}
                                  {m.goals.equalizer.level === "strong"
                                    ? "stark"
                                    : m.goals.equalizer.level === "medium"
                                      ? "medel"
                                      : "svag"}
                                </span>
                              )}
                              <GoalNeedPill
                                need={m.goals.homeAttackNeed}
                                note={m.goals.homeNeedNote}
                                label={m.home.name}
                              />
                              <GoalNeedPill
                                need={m.goals.awayAttackNeed}
                                note={m.goals.awayNeedNote}
                                label={m.away.name}
                              />
                            </>
                          )}
                          {(isStrykFamily(product) ||
                            product === "maltipset") &&
                            m.lineup && (
                            <>
                              <LineupPill
                                impact={m.lineup.homeImpact}
                                label={m.home.name}
                                note={m.lineup.note}
                              />
                              <LineupPill
                                impact={m.lineup.awayImpact}
                                label={m.away.name}
                                note={m.lineup.note}
                              />
                            </>
                          )}
                        </div>
                        <OverOddsExplain valueOdds={m.valueOdds} />
                        <div className="reason">{m.pickReason}</div>
                        {(m.learningNotes?.length ?? 0) > 0 && (
                          <div className="learning-note">
                            {m.learningNotes.join(" · ")}
                          </div>
                        )}
                      </article>
                      );
                    })}
                  </div>

                  <div className="match-table-wrap">
                    <table className="match-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Match</th>
                          <th>Odds 1/X/2</th>
                          <th>Folk</th>
                          <th>Pick</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draw.matches.map((m) => (
                          <tr key={m.eventNumber}>
                            <td>{m.eventNumber}</td>
                            <td>
                              <strong>{m.description}</strong>
                              <div className="reason">
                                {fmtTime(m.matchStart)} · {m.league}
                              </div>
                              <div style={{ marginTop: "0.35rem" }}>
                                <Fatigue
                                  level={m.homeFatigue.level}
                                  label={m.home.name}
                                />
                                <Fatigue
                                  level={m.awayFatigue.level}
                                  label={m.away.name}
                                />
                                <TablePill
                                  comfort={m.homeTable.comfort}
                                  note={m.homeTable.note}
                                  label={m.home.name}
                                />
                                <TablePill
                                  comfort={m.awayTable.comfort}
                                  note={m.awayTable.note}
                                  label={m.away.name}
                                />
                                <RestPill
                                  level={m.homeRest.level}
                                  note={m.homeRest.note}
                                  label={m.home.name}
                                />
                                <RestPill
                                  level={m.awayRest.level}
                                  note={m.awayRest.note}
                                  label={m.away.name}
                                />
                                <ValueOddsPill valueOdds={m.valueOdds} />
                                <OverOddsExplain valueOdds={m.valueOdds} />
                                {m.goals && (
                                  <>
                                    {m.goals.equalizer && (
                                      <span
                                        className={`ctx-pill eq-pill eq-${m.goals.equalizer.level}`}
                                        title={m.goals.equalizer.headline}
                                      >
                                        utjämnarpress{" "}
                                        {m.goals.equalizer.level === "strong"
                                          ? "stark"
                                          : m.goals.equalizer.level === "medium"
                                            ? "medel"
                                            : "svag"}
                                      </span>
                                    )}
                                    <GoalNeedPill
                                      need={m.goals.homeAttackNeed}
                                      note={m.goals.homeNeedNote}
                                      label={m.home.name}
                                    />
                                    <GoalNeedPill
                                      need={m.goals.awayAttackNeed}
                                      note={m.goals.awayNeedNote}
                                      label={m.away.name}
                                    />
                                  </>
                                )}
                                {(isStrykFamily(product) ||
                                  product === "maltipset") &&
                                  m.lineup && (
                                  <>
                                    <LineupPill
                                      impact={m.lineup.homeImpact}
                                      label={m.home.name}
                                      note={m.lineup.note}
                                    />
                                    <LineupPill
                                      impact={m.lineup.awayImpact}
                                      label={m.away.name}
                                      note={m.lineup.note}
                                    />
                                  </>
                                )}
                              </div>
                              {m.goals && (
                                <GoalBlock
                                  goals={m.goals}
                                  malSelected={m.malSelected}
                                  goalRank={m.goalRank}
                                />
                              )}
                              {(isStrykFamily(product) ||
                                product === "maltipset") &&
                                m.lineup &&
                                (m.lineup.windowActive ||
                                  m.lineup.items.length > 0 ||
                                  m.lineup.oddsDriftNote) && (
                                <div
                                  className={`lineup-block ${m.lineup.windowActive ? "late" : ""}`}
                                >
                                  <strong>
                                    {m.lineup.windowActive
                                      ? "Sen analys"
                                      : "Lag"}
                                  </strong>{" "}
                                  {m.lineup.note}
                                </div>
                              )}
                              <div className="reason">{m.pickReason}</div>
                              {(m.learningNotes?.length ?? 0) > 0 && (
                                <div className="learning-note">
                                  {m.learningNotes.join(" · ")}
                                </div>
                              )}
                            </td>
                            <td className="odds">
                              <Odds1x2Marked
                                odds={m.odds}
                                valueOdds={m.valueOdds}
                              />
                            </td>
                            <td className="odds">
                              {m.svenskaFolket.one}-{m.svenskaFolket.x}-
                              {m.svenskaFolket.two}
                            </td>
                            <td>
                              <div className="pick-cells">
                                {product === "maltipset" ? (
                                  <span
                                    className={`pick-cell ${m.malSelected ? "on" : ""}`}
                                  >
                                    {m.malSelected ? "M" : "·"}
                                  </span>
                                ) : (
                                  (["1", "X", "2"] as Outcome[]).map((o) => (
                                    <span
                                      key={o}
                                      className={`pick-cell ${m.pick.includes(o) ? "on" : ""}`}
                                    >
                                      {o}
                                    </span>
                                  ))
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="panel panel-articles">
                  <h2>Artiklar & tips</h2>
                  <p className="panel-lead">
                    Nyheter kopplade till lagen i just det här speltillfället.
                  </p>
                  {draw.articles.length === 0 ? (
                    <p className="panel-lead">Inga träffar just nu.</p>
                  ) : (
                    <ul className="article-list">
                      {draw.articles.map((a) => (
                        <li key={a.url + a.title}>
                          <span className="source">
                            {a.source}
                            {a.publishedAt
                              ? ` · ${fmtTime(a.publishedAt)}`
                              : ""}
                          </span>
                          <a
                            className="title"
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {a.title}
                          </a>
                          {a.snippet && (
                            <div className="snippet">{a.snippet}</div>
                          )}
                          {a.matchedTeams.length > 0 && (
                            <div className="tags">
                              {a.matchedTeams.map((t) => (
                                <span className="tag" key={t}>
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <p className="disclaimer">{data.disclaimer}</p>
            </div>
          )}
        </>
      )}
      <GhostWelcome />
      <BackgroundMusic />
    </div>
  );
}
