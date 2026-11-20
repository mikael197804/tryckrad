"use client";

import { useEffect, useMemo, useState } from "react";
import type { OddsetCandidate, OddsetDayTip } from "../lib/oddset";
import type { DrawBundle, GeneratedSystem, Outcome } from "../lib/types";

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

function OddsetPickCard({
  c,
  index,
}: {
  c: OddsetCandidate;
  index: number;
}) {
  return (
    <article className="match-card">
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
          <span className="pick-cell on">{c.over25ProbPct.toFixed(0)}%</span>
        </div>
      </div>
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
  return (
    <div className="rise">
      <section className="panel">
        <h2>Dagens Oddset · {tip.playDateLabel}</h2>
        <p className="panel-lead">
          {picksPerDay} matcher per svenskt dygn. Tipset gäller{" "}
          <strong>dagen efter</strong>. Matcher visas bara om modellen bedömer
          minst 55% chans till Över 2,5 mål. Analyserat {tip.analyzedCount} ·{" "}
          {tip.eligibleCount} klarade sannolikhetsfiltret.
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
              <OddsetPickCard key={c.eventId} c={c} index={i + 1} />
            ))}
          </div>
        )}
      </section>

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
  const [selectedDraw, setSelectedDraw] = useState<number | null>(null);
  const [selectedSystem, setSelectedSystem] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        // Rensa gammal produkt så tipset inte blir blankt vid byte
        setData(null);
        setOddset(null);
        setSelectedDraw(null);
        if (product === "oddset") {
          const res = await fetch("/api/oddset", { cache: "no-store" });
          const json = (await res.json()) as OddsetDayTip & { error?: string };
          if (!res.ok) throw new Error(json.error || "Kunde inte hämta Oddset");
          if (cancelled) return;
          setOddset(json);
        } else {
          const res = await fetch(`/api/draws?product=${product}`, {
            cache: "no-store",
          });
          const json = (await res.json()) as ApiResponse;
          if (!res.ok) throw new Error(json.error || "Kunde inte hämta data");
          if (cancelled) return;
          setData({ ...json, product });
          setSelectedDraw(json.draws[0]?.drawNumber ?? null);
          setSelectedSystem(0);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nätverksfel");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product]);

  const draw = useMemo(() => {
    if (!data || data.product !== product) return null;
    return (
      data.draws.find((d) => d.drawNumber === selectedDraw) ??
      data.draws[0] ??
      null
    );
  }, [data, selectedDraw, product]);

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
            Öppna omgångar för Topptipset, Stryktipset, Måltipset och Powerplay.
            Stryk/Mål får sen laganalys ca 15 min före avspark. Oddset: fem Över
            2,5 för dagen efter.
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
        </div>
      </header>

      {loading && (
        <div className="loading">
          {product === "oddset"
            ? "Analyserar morgondagens Oddset-matcher…"
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
