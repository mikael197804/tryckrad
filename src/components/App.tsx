"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  OddsetCandidate,
  OddsetDayTip,
  OddsetTrackedTip,
} from "../lib/oddset";
import {
  formatPreCloseLabel,
  isInPreCloseWindow,
  nextPreCloseRefreshAt,
} from "../lib/refresh";
import type { DrawBundle, GeneratedSystem, Outcome } from "../lib/types";

const ODDSET_LS_KEY = "mikaels-oddset-tips-24h";
const ODDSET_RETENTION_MS = 24 * 60 * 60 * 1000;

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
          </div>
        </div>
        <div className="coupon-cost">
          {String(system.costKr).replace(".", ",")} kr
        </div>
      </div>
      {system.picks.map((p) => {
        const malOn =
          isMal &&
          (system.malEventNumbers?.includes(p.eventNumber) ||
            p.outcomes.length > 0);
        return (
          <div className="coupon-row" key={p.eventNumber}>
            <strong>{p.eventNumber}</strong>
            <div>
              <div>{p.description}</div>
              <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>{p.reason}</div>
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

function ValueOddsPill({
  valueOdds,
}: {
  valueOdds?: DrawBundle["matches"][number]["valueOdds"] | null;
}) {
  if (!valueOdds) return null;
  if (valueOdds.overOddsOutcomes?.length) {
    return (
      <span className="ctx-pill value-over" title={valueOdds.note}>
        överodds {valueOdds.overOddsOutcomes.join("/")}
      </span>
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
      </span>
    );
  }
  return null;
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
        <span className="ctx-pill table-comfortable">Över 2,5 mål</span>
        <span className="odds">
          Odds {fmtOdds(c.odds)} · xG≈
          {c.expectedGoals != null
            ? c.expectedGoals.toFixed(2).replace(".", ",")
            : "–"}
        </span>
      </div>
      <div className="match-card-meta">
        <span className="odds">Ö1,5 {fmtOdds(c.odds15)}</span>
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

  return (
    <div className="rise">
      <section className="panel">
        <h2>Öppna Oddset nu · {tip.playDateLabel}</h2>
        <p className="panel-lead">
          {picksPerDay} tips på matcher som <strong>går att spela nu</strong>{" "}
          (öppna, ej startade). Tipsen ligger kvar{" "}
          <strong>{retention} timmar</strong> – grönt när Över 2,5 går in,
          rött när det missar. Analyserat {tip.analyzedCount} ·{" "}
          {tip.eligibleCount} klarade sannolikhetsfiltret
          {tracked.length > 0
            ? ` · 24h: ${won} rätt / ${lost} fel`
            : ""}
          .
        </p>
        <ul className="alert-list table-alerts">
          {tip.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section className="panel panel-systems">
        <h2>Spela dessa · Över 2,5 ({picks.length}/{picksPerDay})</h2>
        {picks.length === 0 ? (
          <p className="panel-lead">
            Ingen match nådde 55% modell-sannolikhet för Över 2,5 just nu.
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
            avgjord.
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
          <h2>Fler godkända (≥55%)</h2>
          <p className="panel-lead">
            Extra kandidater utöver dagens {picksPerDay} tips.
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
  const selectedDrawRef = useRef<number | null>(null);
  const preCloseStartedRef = useRef(false);
  selectedDrawRef.current = selectedDraw;

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

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div>
          <h1 className="brand-mark">
            Mikael’s <span>tips</span>
          </h1>
          <p className="brand-tag">
            Alla spel uppdateras 12 min före spelstopp. Powerplay/Topptipset lär
            av förra omgångens missar automatiskt. Stryk/Mål: lagnyheter ca 15
            min före avspark. Oddset: fem Över 2,5-tips som sparas 24 h
            (grönt/rött).
          </p>
          <div className="product-switch" role="tablist" aria-label="Produkt">
            {DRAW_PRODUCTS.map((p) => (
              <button
                key={p}
                type="button"
                className={`product-btn ${product === p ? "active" : ""}`}
                onClick={() => setProduct(p)}
              >
                {productLabel(p)}
              </button>
            ))}
            <button
              type="button"
              className={`product-btn ${product === "oddset" ? "active" : ""}`}
              onClick={() => setProduct("oddset")}
            >
              Oddset
            </button>
          </div>
        </div>
        <div className="meta-chip">
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
                {(draw.valueAlerts?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>
                      Överodds & värde
                    </h2>
                    <p className="panel-lead">
                      Historik: överodds mot svenska folket har haft positiv EV
                      (~+5–13%). Extremodds 8+ undviks.
                    </p>
                    <ul className="alert-list value-alerts">
                      {draw.valueAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
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
                    Kupongen speglar {productLabel(product)}-raden på Svenska
                    Spel. Kostnad = antal kombinationer ×{" "}
                    {String(draw.rowPrice).replace(".", ",")} kr
                    {product === "maltipset"
                      ? " (M8–M12)"
                      : ""}
                    .
                  </p>
                  <div className="system-switch">
                    {draw.systems.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        className={`system-btn ${selectedSystem === i ? "active" : ""}`}
                        onClick={() => setSelectedSystem(i)}
                      >
                        {String(s.costKr).replace(".", ",")} kr · {s.risk}
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
                    {draw.matches.map((m) => (
                      <article className="match-card" key={m.eventNumber}>
                        <div className="match-card-top">
                          <span className="match-num">{m.eventNumber}</span>
                          <div>
                            <strong>{m.description}</strong>
                            <div className="reason">
                              {fmtTime(m.matchStart)} · {m.league}
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
                            Odds {fmtOdds(m.odds.one)} / {fmtOdds(m.odds.x)} /{" "}
                            {fmtOdds(m.odds.two)}
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
                        <div className="reason">{m.pickReason}</div>
                        {(m.learningNotes?.length ?? 0) > 0 && (
                          <div className="learning-note">
                            {m.learningNotes.join(" · ")}
                          </div>
                        )}
                      </article>
                    ))}
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
                              {fmtOdds(m.odds.one)} / {fmtOdds(m.odds.x)} /{" "}
                              {fmtOdds(m.odds.two)}
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
