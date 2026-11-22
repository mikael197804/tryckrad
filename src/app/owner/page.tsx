"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type PublicUser = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  isOwner?: boolean;
  accessUntil?: string | null;
  accessActive?: boolean;
};

type VisitRow = {
  id: string;
  at: string;
  ip: string;
  userName: string | null;
  kind: string;
};

type Payment = {
  id: string;
  userId: string;
  userName: string;
  days: number;
  amountKr: number;
  accessUntil: string;
  at: string;
  note: string;
};

type Summary = {
  pricePerDayKr: number;
  payments: Payment[];
  totals: {
    paidKr: number;
    daysSold: number;
    count: number;
  };
};

const STORE_TOKEN_KEY = "mikaels-tips-user-store-token";

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    const t = window.localStorage.getItem(STORE_TOKEN_KEY)?.trim();
    if (t) h["x-user-store-token"] = t;
  }
  return h;
}

function fmtTime(iso: string) {
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

export default function OwnerPage() {
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [created, setCreated] = useState<{
    name: string;
    password: string;
  } | null>(null);
  const [payUserId, setPayUserId] = useState("");
  const [days, setDays] = useState("1");
  const [amountKr, setAmountKr] = useState("");
  const [payNote, setPayNote] = useState("");
  const [price, setPrice] = useState("29");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/owner", {
        cache: "no-store",
        headers: headers(),
      });
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const json = (await res.json()) as {
        users?: PublicUser[];
        summary?: Summary;
        visits?: VisitRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Kunde inte ladda");
      setUsers(json.users || []);
      setSummary(json.summary || null);
      setVisits(json.visits || []);
      if (json.summary) {
        setPrice(String(json.summary.pricePerDayKr));
        setAmountKr((prev) =>
          prev || String(json.summary!.pricePerDayKr)
        );
      }
      setPayUserId((prev) => prev || json.users?.[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/owner", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action, ...body }),
      });
      const json = (await res.json()) as {
        error?: string;
        message?: string;
        summary?: Summary;
      };
      if (!res.ok) throw new Error(json.error || "Fel");
      if (json.summary) setSummary(json.summary);
      if (json.message) setInfo(json.message);
      await load();
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fel");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name: newName, autoPassword: true }),
      });
      const json = (await res.json()) as {
        user?: PublicUser;
        password?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Kunde inte skapa");
      setCreated({
        name: json.user?.name || newName,
        password: json.password || "",
      });
      setNewName("");
      setInfo(
        "Konto skapat. Lägg till betalda dagar nedan innan personen kan logga in."
      );
      if (json.user?.id) setPayUserId(json.user.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fel");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1>Endast Mikael</h1>
          <p className="login-lead">
            Den här sidan styr huvudkontot och syns bara för dig.
          </p>
          <Link
            href="/"
            className="login-submit"
            style={{ display: "block", textAlign: "center" }}
          >
            Till tipset
          </Link>
        </div>
      </div>
    );
  }

  const payUser = users.find((u) => u.id === payUserId);
  const dayCount = Math.max(1, Math.floor(Number(days) || 1));
  const suggested =
    summary != null
      ? Math.round(dayCount * summary.pricePerDayKr * 100) / 100
      : null;

  return (
    <div className="app-shell owner-shell">
      <header className="brand-bar">
        <div>
          <p className="login-kicker">Huvudkonto</p>
          <h1 className="brand-mark">
            Mikael’s <span>kontroll</span>
          </h1>
          <p className="brand-tag">
            Andra betalar per dag för att få in. Du sparkar ut missbruk och
            styr alla konton – ingen annan är huvudperson.
          </p>
        </div>
        <div className="owner-top-actions">
          <Link href="/" className="product-btn">
            Till tipset
          </Link>
          <button
            type="button"
            className="product-btn"
            onClick={() => void load()}
            disabled={busy || loading}
          >
            Uppdatera
          </button>
        </div>
      </header>

      {loading && <div className="loading">Laddar ägarkontroll…</div>}
      {error && <div className="status-banner error">{error}</div>}
      {info && <div className="status-banner ok">{info}</div>}

      {summary && (
        <section className="panel rise">
          <h2>Betalning per dag</h2>
          <p className="panel-lead">
            Pris just nu: <strong>{summary.pricePerDayKr} kr/dag</strong>.
            När någon betalat registrerar du dagarna – då kan de logga in.
          </p>
          <div className="history-totals">
            <div>
              <strong>{summary.pricePerDayKr}</strong>
              <span>kr per dag</span>
            </div>
            <div>
              <strong>{summary.totals.paidKr}</strong>
              <span>kr inkommet</span>
            </div>
            <div>
              <strong>{summary.totals.daysSold}</strong>
              <span>dagar sålda</span>
            </div>
            <div>
              <strong>{summary.totals.count}</strong>
              <span>betalningar</span>
            </div>
          </div>

          <form
            className="users-admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              void post("set_price", { pricePerDayKr: Number(price) });
            }}
          >
            <label>
              Pris per dag (kr)
              <input
                type="number"
                min={0}
                max={5000}
                step={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              Spara pris
            </button>
          </form>

          <form
            className="users-admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!payUser) return;
              void post("register_days", {
                userId: payUser.id,
                userName: payUser.name,
                days: dayCount,
                amountKr: amountKr
                  ? Number(amountKr.replace(",", "."))
                  : undefined,
                note: payNote,
              }).then((r) => {
                if (r) {
                  setDays("1");
                  setPayNote("");
                }
              });
            }}
          >
            <label>
              Vem har betalat
              <select
                value={payUserId}
                onChange={(e) => setPayUserId(e.target.value)}
              >
                {users.length === 0 && (
                  <option value="">Inga användare ännu</option>
                )}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.accessActive ? " · aktiv" : " · ingen dag kvar"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Antal dagar
              <input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => {
                  setDays(e.target.value);
                  if (summary) {
                    const d = Math.max(1, Math.floor(Number(e.target.value) || 1));
                    setAmountKr(String(Math.round(d * summary.pricePerDayKr * 100) / 100));
                  }
                }}
              />
            </label>
            <label>
              Betalt belopp (kr)
              <input
                value={amountKr}
                onChange={(e) => setAmountKr(e.target.value)}
                placeholder={suggested != null ? String(suggested) : "29"}
              />
            </label>
            <label>
              Anteckning
              <input
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="valfritt"
              />
            </label>
            <button type="submit" disabled={busy || !payUserId}>
              Registrera betalning
            </button>
          </form>

          {summary.payments.length > 0 && (
            <ul className="users-list">
              {summary.payments.slice(0, 40).map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{p.userName}</strong> · {p.days} dag
                    {p.days === 1 ? "" : "ar"} · {p.amountKr} kr
                    <div className="reason">
                      {fmtTime(p.at)} · giltig t.o.m. {fmtTime(p.accessUntil)}
                      {p.note ? ` · ${p.note}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="panel rise">
        <h2>Konton du styr</h2>
        <p className="panel-lead">
          Skapa konto, ta betalt per dag, sedan kan de logga in. Sparka ut om
          de missbrukar.
        </p>

        <form className="users-admin-form" onSubmit={createAccount}>
          <label>
            Nytt namn
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="t.ex. Anna"
              minLength={2}
              required
            />
          </label>
          <button type="submit" disabled={busy || newName.trim().length < 2}>
            Skapa konto
          </button>
        </form>

        {created && (
          <div className="created-creds">
            Skicka till <strong>{created.name}</strong>:
            <br />
            Namn: <code>{created.name}</code>
            <br />
            Lösenord: <code>{created.password}</code>
            <br />
            (Fungerar efter att du registrerat betalda dagar)
          </div>
        )}

        <ul className="users-list">
          {users.map((u) => (
            <li key={u.id} className={u.active && u.accessActive ? "" : "inactive"}>
              <div>
                <strong>{u.name}</strong>{" "}
                <span className="history-score">
                  {!u.active
                    ? "avstängd"
                    : u.accessActive
                      ? `betald t.o.m. ${fmtTime(u.accessUntil || "")}`
                      : "ingen dag kvar"}
                </span>
              </div>
              <div className="users-row-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPayUserId(u.id);
                    setInfo(`Valde ${u.name} för dagsbetalning ovan.`);
                  }}
                >
                  Lägg dagar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void post("kick", { userId: u.id }).then(() =>
                      setInfo(`${u.name} är utsparkad nu.`)
                    )
                  }
                >
                  Sparka ut
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void post("kick_ban", { userId: u.id }).then(() =>
                      setInfo(`${u.name} utsparkad och avstängd.`)
                    )
                  }
                >
                  Sparka + stäng av
                </button>
              </div>
            </li>
          ))}
          {users.length === 0 && (
            <li>
              <div>Inga andra konton ännu.</div>
            </li>
          )}
        </ul>
      </section>

      <section className="panel rise">
        <h2>IP – vem som tittat</h2>
        <p className="panel-lead">Bara synligt för dig.</p>
        <ul className="users-list visit-list">
          {visits.slice(0, 40).map((v) => (
            <li key={v.id}>
              <div>
                <strong className="visit-ip">{v.ip}</strong>
                <span className="history-score">
                  {" "}
                  · {v.userName || "okänd"} · {v.kind}
                </span>
                <div className="reason">{fmtTime(v.at)}</div>
              </div>
            </li>
          ))}
          {visits.length === 0 && (
            <li>
              <div>Inga besök loggade ännu.</div>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
