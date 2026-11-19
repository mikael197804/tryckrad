"use client";

import { useEffect, useMemo, useState } from "react";
import type { DrawBundle, GeneratedSystem, Outcome } from "../lib/types";

type ApiResponse = {
  generatedAt: string;
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

function CouponView({ system }: { system: GeneratedSystem }) {
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
        <span>Powerplay-kupong</span>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDraw, setSelectedDraw] = useState<number | null>(null);
  const [selectedSystem, setSelectedSystem] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/draws", { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;
        if (!res.ok) throw new Error(json.error || "Kunde inte hämta data");
        if (cancelled) return;
        setData(json);
        setSelectedDraw(json.draws[0]?.drawNumber ?? null);
        setError(null);
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
  }, []);

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
            Tryck<span>Rad</span>
          </h1>
          <p className="brand-tag">
            Analyserar varje Powerplay-speltillfälle för sig – odds, svenska
            folket, artiklar och om lagen har kört tufft schema och kanske inte
            orkar.
          </p>
        </div>
        <div className="meta-chip">
          {data
            ? `Uppdaterad ${fmtTime(data.generatedAt)} · ${data.draws.length} speltillfällen`
            : "Hämtar Svenska Spel…"}
        </div>
      </header>

      {loading && <div className="loading">Läser in öppna Powerplay-omgångar…</div>}
      {error && <div className="status-banner error">{error}</div>}

      {data && (
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
              </section>

              <div className="grid-2 mobile-stack">
                <section className="panel panel-systems">
                  <h2>System 48–720 kr</h2>
                  <p className="panel-lead">
                    Kupongen speglar Powerplay-raden på Svenska Spel. Kostnad =
                    antal kombinationer × 1 kr.
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
                    <CouponView system={draw.systems[selectedSystem]} />
                  )}
                </section>

                <section className="panel">
                  <h2>Matcher & tipsläge</h2>
                  <p className="panel-lead">
                    Baserat på odds, svenska folket och schema. Garderingar
                    läggs där osäkerhet eller trötthet är högst.
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
