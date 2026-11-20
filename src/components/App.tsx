"use client";

import { useEffect, useMemo, useState } from "react";
import type { OddsetCandidate, OddsetDayTip } from "../lib/oddset";
import type { DrawBundle, GeneratedSystem, Outcome } from "../lib/types";

type ProductKind = "powerplay" | "topptipset" | "oddset";

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

function CouponView({
  system,
  product,
}: {
  system: GeneratedSystem;
  product: "powerplay" | "topptipset";
}) {
  return (
    <div className="coupon rise">
      <div className="coupon-head">
        <div>
          <h3>{system.name}</h3>
          <div style={{ color: "rgba(223,247,234,0.75)", fontSize: "0.85rem" }}>
            {system.summary} · risk {system.risk}
          </div>
        </div>
        <div className="coupon-cost">{system.costKr} kr</div>
      </div>
      {system.picks.map((p) => (
        <div className="coupon-row" key={p.eventNumber}>
          <strong>{p.eventNumber}</strong>
          <div>
            <div>{p.description}</div>
            <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>{p.reason}</div>
          </div>
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
        <span>{system.rows} rader × 1 kr</span>
        <span>
          {product === "topptipset" ? "Topptipset-kupong" : "Powerplay-kupong"}
        </span>
      </div>
    </div>
  );
}

function marketLabel(c: OddsetCandidate): string {
  return c.line === 1.5 ? "Över 1,5 mål" : "Över 2,5 mål";
}

function OddsetView({ tip }: { tip: OddsetDayTip }) {
  const selected = tip.selected;
  return (
    <div className="rise">
      <section className="panel">
        <h2>Dagens Oddset · {tip.playDateLabel}</h2>
        <p className="panel-lead">
          En match per svenskt dygn. Tipset gäller{" "}
          <strong>dagen efter</strong> så det inte krockar med innevarande
          svenska kalenderdag. Analyserat {tip.analyzedCount} matcher ·{" "}
          {tip.eligibleCount} inom oddskraven.
        </p>
        <ul className="alert-list table-alerts">
          {tip.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section className="panel panel-systems">
        <h2>Spela denna</h2>
        {!selected ? (
          <p className="panel-lead">
            Ingen match klarade oddskraven för Över 1,5 (≥ 1,80) eller Över 2,5
            (&gt; 2,00) just nu.
          </p>
        ) : (
          <div className="coupon rise">
            <div className="coupon-head">
              <div>
                <h3>
                  {selected.home} – {selected.away}
                </h3>
                <div
                  style={{
                    color: "rgba(223,247,234,0.75)",
                    fontSize: "0.85rem",
                  }}
                >
                  {selected.league}
                  {selected.country ? ` · ${selected.country}` : ""} ·{" "}
                  {fmtTime(selected.kickoff)}
                </div>
              </div>
              <div className="coupon-cost">{fmtOdds(selected.odds)}</div>
            </div>
            <div className="oddset-pick-line">
              <span className="ctx-pill table-comfortable">
                {marketLabel(selected)}
              </span>
              <span className="odds">
                Ö1,5 {fmtOdds(selected.odds15)} · Ö2,5{" "}
                {fmtOdds(selected.odds25)}
              </span>
            </div>
            <div className="reason" style={{ marginTop: "0.65rem" }}>
              {selected.reason}
            </div>
            <a
              className="oddset-link"
              href={selected.url}
              target="_blank"
              rel="noreferrer"
            >
              Öppna på Oddset
            </a>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Övriga kandidater</h2>
        <p className="panel-lead">
          Rankade efter analysscore. Endast den översta ska spelas i dag.
        </p>
        <div className="match-cards">
          {tip.candidates.map((c, i) => (
            <article className="match-card" key={c.eventId}>
              <div className="match-card-top">
                <span className="match-num">{i + 1}</span>
                <div>
                  <strong>
                    {c.home} – {c.away}
                  </strong>
                  <div className="reason">
                    {fmtTime(c.kickoff)} · {c.league}
                  </div>
                </div>
                <div className="pick-cells">
                  <span className="pick-cell on">
                    {c.line === 1.5 ? "Ö1,5" : "Ö2,5"}
                  </span>
                </div>
              </div>
              <div className="match-card-meta">
                <span className="odds">Odds {fmtOdds(c.odds)}</span>
                <span className="odds">
                  Ö1,5 {fmtOdds(c.odds15)} / Ö2,5 {fmtOdds(c.odds25)}
                </span>
              </div>
              <div className="reason">{c.reason}</div>
            </article>
          ))}
        </div>
      </section>

      <p className="disclaimer">{tip.disclaimer}</p>
    </div>
  );
}

export default function App() {
  const [product, setProduct] = useState<ProductKind>("oddset");
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
        if (product === "oddset") {
          const res = await fetch("/api/oddset", { cache: "no-store" });
          const json = (await res.json()) as OddsetDayTip & { error?: string };
          if (!res.ok) throw new Error(json.error || "Kunde inte hämta Oddset");
          if (cancelled) return;
          setOddset(json);
          setData(null);
        } else {
          const res = await fetch(`/api/draws?product=${product}`, {
            cache: "no-store",
          });
          const json = (await res.json()) as ApiResponse;
          if (!res.ok) throw new Error(json.error || "Kunde inte hämta data");
          if (cancelled) return;
          setData(json);
          setOddset(null);
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

  const draw = useMemo(
    () => data?.draws.find((d) => d.drawNumber === selectedDraw) ?? null,
    [data, selectedDraw]
  );

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
            Powerplay, Topptipset och Oddset – en målmatch per svenskt dygn
            plus omgångstips med tabell, vila och schema.
          </p>
          <div className="product-switch" role="tablist" aria-label="Produkt">
            <button
              type="button"
              className={`product-btn ${product === "oddset" ? "active" : ""}`}
              onClick={() => setProduct("oddset")}
            >
              Oddset
            </button>
            <button
              type="button"
              className={`product-btn ${product === "topptipset" ? "active" : ""}`}
              onClick={() => setProduct("topptipset")}
            >
              Topptipset
            </button>
            <button
              type="button"
              className={`product-btn ${product === "powerplay" ? "active" : ""}`}
              onClick={() => setProduct("powerplay")}
            >
              Powerplay
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
            : `Läser in öppna ${product === "topptipset" ? "Topptipset" : "Powerplay"}-omgångar…`}
        </div>
      )}
      {error && <div className="status-banner error">{error}</div>}

      {!loading && !error && product === "oddset" && oddset && (
        <OddsetView tip={oddset} />
      )}

      {data && product !== "oddset" && (
        <>
          <nav className="draw-tabs" aria-label="Speltillfällen">
            {data.draws.map((d) => (
              <button
                key={d.drawNumber}
                type="button"
                className={`draw-tab ${d.drawNumber === selectedDraw ? "active" : ""}`}
                onClick={() => setSelectedDraw(d.drawNumber)}
              >
                <span className="label">#{d.drawNumber}</span>
                <span className="sub">
                  Stänger {fmtTime(d.closeTime)}
                  <br />
                  {d.leagueSummary || d.sport}
                </span>
              </button>
            ))}
          </nav>

          {draw && (
            <div className="rise">
              <section className="panel">
                <h2>{draw.closeDescription}</h2>
                <p className="panel-lead">
                  Speltillfälle {draw.drawNumber} · {draw.matches.length} matcher ·{" "}
                  {draw.leagueSummary} · stänger {fmtTime(draw.closeTime)}
                  {draw.netSale ? ` · omsättning ${draw.netSale} kr` : ""}
                </p>

                {draw.fatigueAlerts.length > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>Matchbelastning</h2>
                    <ul className="alert-list">
                      {draw.fatigueAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {draw.tableAlerts.length > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>Tabell & poängställning</h2>
                    <ul className="alert-list table-alerts">
                      {draw.tableAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {draw.restAlerts.length > 0 && (
                  <>
                    <h2 style={{ fontSize: "1.05rem" }}>Vila inför viktigare match</h2>
                    <ul className="alert-list rest-alerts">
                      {draw.restAlerts.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <div className="grid-2 mobile-stack">
                <section className="panel panel-systems">
                  <h2>System 48–720 kr</h2>
                  <p className="panel-lead">
                    Kupongen speglar{" "}
                    {product === "topptipset" ? "Topptipset" : "Powerplay"}-raden
                    på Svenska Spel. Kostnad = antal kombinationer × 1 kr.
                  </p>
                  <div className="system-switch">
                    {draw.systems.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        className={`system-btn ${selectedSystem === i ? "active" : ""}`}
                        onClick={() => setSelectedSystem(i)}
                      >
                        {s.costKr} kr · {s.risk}
                      </button>
                    ))}
                  </div>
                  {draw.systems[selectedSystem] && (
                    <CouponView
                      system={draw.systems[selectedSystem]}
                      product={product}
                    />
                  )}
                </section>

                <section className="panel">
                  <h2>Matcher & tipsläge</h2>
                  <p className="panel-lead">
                    Baserat på odds, svenska folket, tabelläge, vilomotiv och
                    schema. Garderingar läggs där osäkerhet, trygg tabell eller
                    trötthet är högst.
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
                            {(["1", "X", "2"] as Outcome[]).map((o) => (
                              <span
                                key={o}
                                className={`pick-cell ${m.pick.includes(o) ? "on" : ""}`}
                              >
                                {o}
                              </span>
                            ))}
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
                              </div>
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
                                {(["1", "X", "2"] as Outcome[]).map((o) => (
                                  <span
                                    key={o}
                                    className={`pick-cell ${m.pick.includes(o) ? "on" : ""}`}
                                  >
                                    {o}
                                  </span>
                                ))}
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
