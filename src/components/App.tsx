"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  HistoryPick,
  HistoryProduct,
  TipHistoryResponse,
} from "../lib/tipHistory";
import type { DrawBundle, GeneratedSystem, Outcome } from "../lib/types";

function productHistoryLabel(p: HistoryProduct): string {
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

const ODDSET_LS_KEY = "mikaels-oddset-tips-24h";
const ODDSET_LEARN_LS_KEY = "mikaels-oddset-lessons";
const HISTORY_LS_KEY = "mikaels-tips-history-24h";
const ODDSET_RETENTION_MS = 24 * 60 * 60 * 1000;
const ODDSET_LEARN_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

function loadOddsetLocalTips(): OddsetTrackedTip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ODDSET_LS_KEY);
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

function loadLocalHistoryPicks(): HistoryPick[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryPick[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((p) => {
      const at = historyKeepUntilMs(p);
      return Number.isFinite(at) && now - at <= HISTORY_RETENTION_MS;
    });
  } catch {
    return [];
  }
}

function saveLocalHistoryPicks(picks: HistoryPick[]): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const byId = new Map<string, HistoryPick>();
    for (const p of picks) {
      if (!p?.id) continue;
      const at = historyKeepUntilMs(p);
      if (!Number.isFinite(at) || now - at > HISTORY_RETENTION_MS) continue;
      const prev = byId.get(p.id);
      if (!prev) {
        byId.set(p.id, p);
        continue;
      }
      const rank = (s: HistoryPick["status"]) =>
        s === "won" || s === "lost" ? 3 : s === "live" ? 2 : 1;
      const next =
        rank(p.status) >= rank(prev.status)
          ? {
              ...p,
              tippedAt: prev.tippedAt,
              settledAt: p.settledAt ?? prev.settledAt ?? null,
            }
          : {
              ...prev,
              settledAt: prev.settledAt ?? p.settledAt ?? null,
            };
      byId.set(p.id, next);
    }
    window.localStorage.setItem(
      HISTORY_LS_KEY,
      JSON.stringify([...byId.values()])
    );
  } catch {
    // private mode / quota
  }
}

function oddsetToHistoryPicks(
  tips: OddsetTrackedTip[],
  tippedAtFallback: string
): HistoryPick[] {
  return tips.map((t) => {
    const tippedAt = t.tippedAt || tippedAtFallback;
    const status =
      t.outcome === "won" || t.outcome === "lost" || t.outcome === "live"
        ? t.outcome
        : "pending";
    return {
      id: `oddset:${t.eventId}`,
      product: "oddset" as const,
      gameKey: `oddset:${tippedAt.slice(0, 10)}`,
      gameLabel: `Oddset · Över 1,5 · ${tippedAt.slice(0, 10)}`,
      tippedAt,
      description: `${t.home} – ${t.away}`,
      home: t.home,
      away: t.away,
      market: "over_1_5" as const,
      pick: ["over_1_5"],
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
    };
  });
}

function drawToHistoryPicks(
  draw: DrawBundle,
  tippedAt: string
): HistoryPick[] {
  const product = draw.productKind as HistoryProduct;
  const systems = (draw.systems || []).filter(
    (s) => s.costKr >= 48 && s.costKr <= 720
  );
  if (!systems.length) return [];

  const baseLabel = `${productHistoryLabel(product)} #${draw.drawNumber}`;
  const out: HistoryPick[] = [];

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

function outcomeRank(o: OddsetTrackedTip["outcome"] | undefined): number {
  if (o === "won" || o === "lost") return 3;
  if (o === "live") return 2;
  return 1;
}

function mergeOddsetTracked(
  ...groups: Array<OddsetTrackedTip[] | undefined>
): OddsetTrackedTip[] {
  const byId = new Map<number, OddsetTrackedTip>();
  for (const group of groups) {
    for (const t of group || []) {
      if (!t?.eventId) continue;
      const prev = byId.get(t.eventId);
      if (!prev) {
        byId.set(t.eventId, t);
        continue;
      }
      const tippedAt =
        Date.parse(prev.tippedAt) <= Date.parse(t.tippedAt)
          ? prev.tippedAt
          : t.tippedAt;
      const preferNew = outcomeRank(t.outcome) >= outcomeRank(prev.outcome);
      const base = preferNew ? t : prev;
      const other = preferNew ? prev : t;
      byId.set(t.eventId, {
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
  | "maltipset"
  | "oddset";

const DRAW_PRODUCTS: Array<Exclude<ProductKind, "oddset">> = [
  "topptipset",
  "stryktipset",
  "maltipset",
  "powerplay",
];

function productLabel(p: ProductKind): string {
  switch (p) {
    case "stryktipset":
      return "Stryktipset";
    case "maltipset":
      return "Måltipset";
    case "topptipset":
      return "Topptipset";
    case "powerplay":
      return "Powerplay";
    case "oddset":
      return "Oddset";
  }
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
  product: Exclude<ProductKind, "oddset">;
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
  product: Exclude<ProductKind, "oddset">;
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
          {system.rows} rader × {String(rowPrice).replace(".", ",")} kr
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
  if (traps.length || overs.length || adminPill || safePill) {
    return (
      <>
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
  const lines = valueOdds?.explanations?.filter(Boolean) ?? [];
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
          ) : (
            <span className="pick-cell on">{c.over25ProbPct.toFixed(0)}%</span>
          )}
        </div>
      </div>
      {resultNote && (
        <div className="oddset-result-note">{resultNote}</div>
      )}
      <div className="oddset-pick-line">
        <span className="ctx-pill table-comfortable">Över 1,5 mål</span>
        <span className="odds">
          Odds {fmtOdds(c.odds)} · xG≈
          {c.expectedGoals != null
            ? c.expectedGoals.toFixed(2).replace(".", ",")
            : "–"}
        </span>
      </div>
      <div className="match-card-meta">
        <span className="odds">Ö2,5 {fmtOdds(c.odds25)}</span>
        <span className="odds">Ö3,5 {fmtOdds(c.odds35)}</span>
      </div>
      <div className="match-card-flags">
        <RivalryPill level={c.rivalry.level} note={c.rivalry.note} />
        <RedCardPill
          level={c.redCard.level}
          note={c.redCard.note}
          probabilityPct={c.redCard.probabilityPct}
        />
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

function HistoryView({
  history,
  loading,
  onClose,
  onRefresh,
}: {
  history: TipHistoryResponse | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="history-overlay" role="dialog" aria-modal="true">
      <div className="history-panel rise">
        <div className="history-panel-top">
          <h2>Gamla resultat · 24 h</h2>
          <div className="history-actions">
            <button type="button" className="history-btn ghost" onClick={onRefresh}>
              Uppdatera resultat
            </button>
            <button type="button" className="history-btn" onClick={onClose}>
              Stäng
            </button>
          </div>
        </div>
        <p className="panel-lead">
          System 48–720 kr: varje match visar grönt (rätt) eller rött (fel).
          Resultaten ligger kvar {history?.retentionHours ?? 24} timmar efter
          färdigt spel.
        </p>

        {loading && <div className="loading">Hämtar resultat…</div>}

        {history && !loading && (
          <>
            <div className="history-totals">
              <div>
                <strong>{history.totals.won}</strong>
                <span>rätt</span>
              </div>
              <div>
                <strong>{history.totals.lost}</strong>
                <span>fel</span>
              </div>
              <div>
                <strong>{history.totals.pending + history.totals.live}</strong>
                <span>väntar</span>
              </div>
              <div>
                <strong>
                  {history.totals.settled > 0
                    ? `${Math.round(
                        (100 * history.totals.won) / history.totals.settled
                      )}%`
                    : "–"}
                </strong>
                <span>träffsäkerhet</span>
              </div>
            </div>

            {history.games.length === 0 ? (
              <p className="panel-lead">
                Inga resultat ännu. När du öppnar ett spel sparas tipset
                (48–720 kr), och när det är färdigt syns grönt/rött här i 24
                timmar.
              </p>
            ) : (
              history.games.map((g) => {
                const picks = history.picks.filter(
                  (p) => p.gameKey === g.gameKey
                );
                const systemResult = g.systemResult || "pending";
                return (
                  <section
                    key={g.gameKey}
                    className={`panel history-game system-${systemResult}`}
                  >
                    <h3>
                      {g.label}{" "}
                      <span className="history-score">
                        {g.won} rätt / {g.lost} fel
                        {g.pending + g.live > 0
                          ? ` · ${g.pending + g.live} väntar`
                          : ""}
                      </span>
                      {g.costKr != null && (
                        <span className="history-cost-pill">
                          {g.costKr} kr
                        </span>
                      )}
                      {systemResult === "won" && (
                        <span className="oddset-result-badge won">
                          System grönt
                        </span>
                      )}
                      {systemResult === "lost" && (
                        <span className="oddset-result-badge lost">
                          System rött
                        </span>
                      )}
                    </h3>
                    <ul className="history-pick-list">
                      {picks.map((p) => (
                        <li
                          key={p.id}
                          className={`history-pick ${p.status}`}
                        >
                          <div>
                            <strong>
                              {p.eventNumber != null
                                ? `${p.eventNumber}. `
                                : ""}
                              {p.description}
                            </strong>
                            <div className="history-1x2-marks" aria-label="Tips">
                              {p.market === "1x2"
                                ? (["1", "X", "2"] as const).map((o) => (
                                    <span
                                      key={o}
                                      className={`history-mark ${
                                        p.pick.includes(o) ? "on" : ""
                                      } ${
                                        p.status === "won" &&
                                        p.actual === o
                                          ? "hit"
                                          : p.status === "lost" &&
                                              p.pick.includes(o)
                                            ? "miss"
                                            : ""
                                      }`}
                                    >
                                      {o}
                                    </span>
                                  ))
                                : null}
                              {(p.market === "over_1_5" ||
                                p.market === "over_2_5") && (
                                <span
                                  className={`history-mark on ${
                                    p.status === "won"
                                      ? "hit"
                                      : p.status === "lost"
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
                                    p.status === "won"
                                      ? "hit"
                                      : p.status === "lost"
                                        ? "miss"
                                        : ""
                                  }`}
                                >
                                  M
                                </span>
                              )}
                            </div>
                            <div className="reason">
                              Tipset:{" "}
                              {p.market === "over_1_5" || p.market === "over_2_5"
                                ? (p.market === "over_2_5" ? "Över 2,5" : "Över 1,5")
                                : p.market === "mal"
                                  ? "Målmatch"
                                  : p.pick.join("")}
                              {p.actual ? ` · resultat ${p.actual}` : ""}
                            </div>
                            {p.resultNote && (
                              <div className="oddset-result-note">
                                {p.resultNote}
                              </div>
                            )}
                          </div>
                          <span
                            className={`oddset-result-badge ${
                              p.status === "won"
                                ? "won"
                                : p.status === "lost"
                                  ? "lost"
                                  : p.status === "live"
                                    ? "live"
                                    : ""
                            }`}
                          >
                            {p.status === "won"
                              ? "Rätt"
                              : p.status === "lost"
                                ? "Fel"
                                : p.status === "live"
                                  ? "Live"
                                  : "Väntar"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OddsetView({ tip }: { tip: OddsetDayTip }) {
  const picks = tip.selected;
  const picksPerDay = tip.picksPerDay ?? 5;
  const tracked = tip.tracked || [];
  const trackedById = new Map(tracked.map((t) => [t.eventId, t]));
  const openIds = new Set(picks.map((p) => p.eventId));
  const history = tracked.filter((t) => !openIds.has(t.eventId));
  const retention = tip.retentionHours ?? 24;
  const won = tracked.filter((t) => t.outcome === "won").length;
  const lost = tracked.filter((t) => t.outcome === "lost").length;
  const learning = tip.learning;
  const missLessons = (learning?.lessons || []).filter((l) => !l.hit).slice(0, 6);
  const hitLessons = (learning?.lessons || []).filter((l) => l.hit).slice(0, 3);

  return (
    <div className="rise">
      <section className="panel">
        <h2>Öppna Oddset nu · {tip.playDateLabel}</h2>
        <p className="panel-lead">
          {picksPerDay} <strong>unika</strong> tips på matcher som går att
          spela nu. Tipsen ligger kvar <strong>{retention} timmar</strong> –
          grönt/rött efter slutsignal. Efter varje tips lär sig analysen
          automatiskt och justerar nästa urval. Analyserat {tip.analyzedCount}{" "}
          · {tip.eligibleCount} klarade filtret
          {tracked.length > 0 ? ` · 24h: ${won} rätt / ${lost} fel` : ""}.
        </p>
        <ul className="alert-list table-alerts">
          {tip.rules.map((r) => (
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
                key={c.eventId}
                c={c}
                index={i + 1}
                tracked={trackedById.get(c.eventId)}
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
                key={`hist-${c.eventId}`}
                c={c}
                index={i + 1}
                tracked={c}
              />
            ))}
          </div>
        </section>
      )}

      {tip.candidates.length > picks.length && (
        <section className="panel">
          <h2>Fler godkända</h2>
          <p className="panel-lead">
            Extra kandidater utöver dagens {picksPerDay} unika tips.
          </p>
          <div className="match-cards">
            {tip.candidates.slice(picks.length).map((c, i) => (
              <OddsetPickCard
                key={c.eventId}
                c={c}
                index={picks.length + i + 1}
                tracked={trackedById.get(c.eventId)}
              />
            ))}
          </div>
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
          Bara du är huvudperson. Ge andra egna konton (de betalar per dag),
          sparka ut dem om de missbrukar, eller öppna{" "}
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
                  {u.role === "admin" ? "admin" : "får titta"}
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
  selectedDrawRef.current = selectedDraw;

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
      try {
        if (!silent) {
          setLoading(true);
          setError(null);
          setData(null);
          setOddset(null);
          if (opts.resetSelection !== false) setSelectedDraw(null);
        } else {
          setRefreshing(true);
        }

        if (product === "oddset") {
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
          const json = (await res.json()) as OddsetDayTip & {
            error?: string;
            fresh?: boolean;
          };
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
          setOddset({ ...json, tracked: merged });
          if (fresh || json.fresh) setLastFreshAt(json.generatedAt);
        } else {
          const res = await fetch(
            `/api/draws?product=${product}${fresh ? "&fresh=1" : ""}`,
            { cache: "no-store" }
          );
          const json = (await res.json()) as ApiResponse;
          if (!res.ok) throw new Error(json.error || "Kunde inte hämta data");
          const keep = selectedDrawRef.current;
          setData({ ...json, product });
          if (opts.resetSelection === false && keep != null) {
            const still =
              json.draws.some((d) => d.drawNumber === keep) ? keep : json.draws[0]?.drawNumber ?? null;
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
        if (!silent) {
          setError(e instanceof Error ? e.message : "Nätverksfel");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [product]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadProduct({ resetSelection: true });
    })();
    return () => {
      cancelled = true;
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

    const id = setInterval(() => {
      void loadProduct({ fresh: true, silent: true, resetSelection: false });
    }, 6 * 60 * 1000);
    return () => clearInterval(id);
  }, [product, oddset, loadProduct]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const local = loadLocalHistoryPicks();
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
      saveLocalHistoryPicks(json.picks || []);
      setHistory(json);
    } catch {
      const picks = loadLocalHistoryPicks();
      const won = picks.filter((p) => p.status === "won").length;
      const lost = picks.filter((p) => p.status === "lost").length;
      const live = picks.filter((p) => p.status === "live").length;
      const pending = picks.filter((p) => p.status === "pending").length;
      const byGame = new Map<string, HistoryPick[]>();
      for (const p of picks) {
        const list = byGame.get(p.gameKey) || [];
        list.push(p);
        byGame.set(p.gameKey, list);
      }
      setHistory({
        generatedAt: new Date().toISOString(),
        retentionHours: 24,
        picks,
        games: [...byGame.entries()].map(([gameKey, list]) => {
          const w = list.filter((x) => x.status === "won").length;
          const l = list.filter((x) => x.status === "lost").length;
          const settled = w + l;
          const winThreshold =
            list.length >= 7 && list.length <= 9
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
          };
        }),
        totals: {
          total: picks.length,
          settled: won + lost,
          won,
          lost,
          pending,
          live,
        },
      });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = useCallback(() => {
    setShowHistory(true);
    void loadHistory();
  }, [loadHistory]);

  const draw = useMemo(() => {
    if (!data || data.product !== product) return null;
    return (
      data.draws.find((d) => d.drawNumber === selectedDraw) ??
      data.draws[0] ??
      null
    );
  }, [data, selectedDraw, product]);

  const closeTimes = useMemo(() => {
    if (product === "oddset" && oddset) {
      const list = oddset.selected?.length
        ? oddset.selected
        : oddset.candidates || [];
      return list.map((c) => c.kickoff).filter(Boolean);
    }
    return (data?.draws || []).map((d) => d.closeTime).filter(Boolean);
  }, [product, data, oddset]);

  // Schemalägg uppdatering 12 min före spelstopp (alla produkter)
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
      if (product !== "oddset" && draw?.closeTime) return draw.closeTime;
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
          void loadProduct({ fresh: true, silent: true, resetSelection: false });
        }
        poll = setInterval(() => {
          if (cancelled) return;
          const still = closeTimes.some((t) => isInPreCloseWindow(t));
          if (!still) {
            preCloseStartedRef.current = false;
            arm();
            return;
          }
          void loadProduct({ fresh: true, silent: true, resetSelection: false });
        }, 90_000);
        return;
      }

      preCloseStartedRef.current = false;
      const nextAt = nextPreCloseRefreshAt(closeTimes, now);
      if (nextAt == null) return;
      const delay = Math.max(1_000, Math.min(nextAt - now, 2_147_000_000));
      timer = setTimeout(() => {
        if (cancelled) return;
        preCloseStartedRef.current = false;
        void loadProduct({ fresh: true, silent: true, resetSelection: false }).then(
          () => {
            if (!cancelled) arm();
          }
        );
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
            title="Gamla resultat – tips med rätt/fel i 24 timmar efter färdigt spel"
          >
            <span className="btn-label-full">Gamla resultat</span>
            <span className="btn-label-short">Resultat</span>
          </button>
          <button
            type="button"
            className="product-btn tips-launch"
            onClick={scrollToAnalysisTips}
            disabled={product === "oddset"}
            title="Hoppa till 1X2-tips från analys"
          >
            1X2
          </button>
          {DRAW_PRODUCTS.map((p) => (
            <button
              key={p}
              type="button"
              className={`product-btn ${product === p ? "active" : ""}`}
              onClick={() => setProduct(p)}
            >
              <span className="btn-label-full">{productLabel(p)}</span>
              <span className="btn-label-short">
                {p === "topptipset"
                  ? "Topp"
                  : p === "powerplay"
                    ? "PP"
                    : p === "stryktipset"
                      ? "Stryk"
                      : "Mål"}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`product-btn ${product === "oddset" ? "active" : ""}`}
            onClick={() => setProduct("oddset")}
          >
            Oddset
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
            Alla spel uppdateras 12 min före spelstopp. Tryck på Gamla resultat
            för rätt/fel – syns 24 h efter att spelet är färdigt.
            Powerplay/Topptipset lär av missar. Stryk/Mål: lagnyheter ca 15 min
            före avspark.
          </p>
        </div>
        <div className="meta-chip">
          {authUser && (
            <span className="user-chip">
              Inloggad: <strong>{authUser.name}</strong>
              {authUser.role === "admin" ? " · admin" : ""}
            </span>
          )}{" "}
          {product === "oddset"
            ? oddset
              ? `Uppdaterad ${fmtTime(oddset.generatedAt)} · spel ${oddset.playDate}`
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
          loading={historyLoading}
          onClose={() => setShowHistory(false)}
          onRefresh={() => void loadHistory()}
        />
      )}

      {showUsers && (
        <UsersAdminPanel onClose={() => setShowUsers(false)} />
      )}

      {preCloseNote && (
        <div className="preclose-banner" role="status">
          {preCloseNote}
        </div>
      )}

      {loading && (
        <div className="loading">
          {product === "oddset"
            ? "Analyserar öppna Oddset-matcher…"
            : `Läser in öppna ${productLabel(product)}-omgångar…`}
        </div>
      )}
      {error && <div className="status-banner error">{error}</div>}

      {!loading && !error && product === "oddset" && oddset && (
        <OddsetView tip={oddset} />
      )}

      {data && data.product === product && product !== "oddset" && (
        <>
          <nav className="draw-tabs" aria-label="Speltillfällen">
            {data.draws.map((d) => (
              <button
                key={d.drawNumber}
                type="button"
                className={`draw-tab ${
                  (selectedDraw ?? data.draws[0]?.drawNumber) === d.drawNumber
                    ? "active"
                    : ""
                }`}
                onClick={() => setSelectedDraw(d.drawNumber)}
              >
                <span className="label">{fmtCloseLabel(d.closeTime)}</span>
                <span className="sub">
                  #{d.drawNumber} · stänger {fmtTime(d.closeTime)}
                  <br />
                  {d.leagueSummary || d.sport}
                </span>
              </button>
            ))}
          </nav>

          {draw && (
            <div className="rise">
              <section className="panel">
                <h2>{draw.closeDescription || `Omgång #${draw.drawNumber}`}</h2>
                <p className="panel-lead">
                  Öppen omgång · {fmtCloseLabel(draw.closeTime)} · #
                  {draw.drawNumber} · {draw.matches.length} matcher ·{" "}
                  {draw.leagueSummary} · stänger {fmtTime(draw.closeTime)}
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
                {(product === "stryktipset" || product === "maltipset") &&
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
                {(product === "stryktipset" || product === "maltipset") &&
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
                      : "System 48–720 kr"}
                  </h2>
                  <p className="panel-lead">
                    {product === "powerplay" || product === "topptipset"
                      ? "48 kr är ett säkerhetssystem: gardering där det skakar, enkel bara vid stark odds/folk-konsensus. Siffran ~% är uppskattad vinstnivå (≥7 rätt) – inte garanti. "
                      : ""}
                    Kupongen speglar {productLabel(product)}-raden på Svenska
                    Spel. Kostnad = antal kombinationer ×{" "}
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
                        {String(s.costKr).replace(".", ",")} kr
                        {s.estimatedWinPct != null
                          ? ` · ~${Math.round(s.estimatedWinPct)}%`
                          : s.estimatedHitPct != null
                            ? ` · ~${Math.round(s.estimatedHitPct)}%`
                            : ` · ${s.risk}`}
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
                            : product === "stryktipset"
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
                        {(product === "powerplay" ||
                          product === "maltipset") &&
                          m.goals && (
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
                          (product === "stryktipset" ||
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
                          {(product === "powerplay" ||
                            product === "maltipset") &&
                            m.goals && (
                            <>
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
                          {(product === "stryktipset" ||
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
                                {(product === "powerplay" ||
                                  product === "maltipset") &&
                                  m.goals && (
                                  <>
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
                                {(product === "stryktipset" ||
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
                              {(product === "powerplay" ||
                                product === "maltipset") &&
                                m.goals && (
                                <GoalBlock
                                  goals={m.goals}
                                  malSelected={m.malSelected}
                                  goalRank={m.goalRank}
                                />
                              )}
                              {(product === "stryktipset" ||
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
    </div>
  );
}
