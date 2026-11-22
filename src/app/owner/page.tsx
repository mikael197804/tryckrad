"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type PublicUser = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  isOwner?: boolean;
};

type VisitRow = {
  id: string;
  at: string;
  ip: string;
  userName: string | null;
  kind: string;
};

type Entry = {
  id: string;
  userId: string;
  userName: string;
  winKr: number;
  commissionKr: number;
  percent: number;
  at: string;
  note: string;
  paid: boolean;
};

type Summary = {
  commissionPercent: number;
  entries: Entry[];
  totals: {
    winsKr: number;
    commissionKr: number;
    unpaidKr: number;
    paidKr: number;
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
  const [created, setCreated] = useState<{ name: string; password: string } | null>(
    null
  );
  const [winUserId, setWinUserId] = useState("");
  const [winKr, setWinKr] = useState("");
  const [winNote, setWinNote] = useState("");
  const [percent, setPercent] = useState("10");

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
      if (json.summary) setPercent(String(json.summary.commissionPercent));
      setWinUserId((prev) => prev || json.users?.[0]?.id || "");
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
      setInfo("Konto skapat – skicka uppgifterna till personen.");
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
          <Link href="/" className="login-submit" style={{ display: "block", textAlign: "center" }}>
            Till tipset
          </Link>
        </div>
      </div>
    );
  }

  const winUser = users.find((u) => u.id === winUserId);

  return (
    <div className="app-shell owner-shell">
      <header className="brand-bar">
        <div>
          <p className="login-kicker">Huvudkonto</p>
          <h1 className="brand-mark">
            Mikael’s <span>kontroll</span>
          </h1>
          <p className="brand-tag">
            Här styr du vem som får in, sparkar ut missbruk och tar provision
            bara på andras vinster – aldrig på förluster.
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
          <h2>Provision på vinster</h2>
          <p className="panel-lead">
            Du tjänar {summary.commissionPercent} % när någon annan vinner.
            Förluster ger 0 kr till dig.
          </p>
          <div className="history-totals">
            <div>
              <strong>{summary.totals.winsKr}</strong>
              <span>kr vinster totalt</span>
            </div>
            <div>
              <strong>{summary.totals.commissionKr}</strong>
              <span>kr din provision</span>
            </div>
            <div>
              <strong>{summary.totals.unpaidKr}</strong>
              <span>kr att få in</span>
            </div>
            <div>
              <strong>{summary.totals.paidKr}</strong>
              <span>kr mottaget</span>
            </div>
          </div>

          <form
            className="users-admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              void post("set_percent", { percent: Number(percent) });
            }}
          >
            <label>
              Din % på vinster
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              Spara %
            </button>
          </form>

          <form
            className="users-admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!winUser) return;
              void post("register_win", {
                userId: winUser.id,
                userName: winUser.name,
                winKr: Number(winKr.replace(",", ".")),
                note: winNote,
              }).then((r) => {
                if (r) {
                  setWinKr("");
                  setWinNote("");
                  setInfo(
                    `Vinst registrerad – din andel syns under provision.`
                  );
                }
              });
            }}
          >
            <label>
              Användare som vann
              <select
                value={winUserId}
                onChange={(e) => setWinUserId(e.target.value)}
              >
                {users.length === 0 && (
                  <option value="">Inga användare ännu</option>
                )}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {!u.active ? " (avstängd)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vinst (kr)
              <input
                value={winKr}
                onChange={(e) => setWinKr(e.target.value)}
                placeholder="t.ex. 1200"
                required
              />
            </label>
            <label>
              Anteckning
              <input
                value={winNote}
                onChange={(e) => setWinNote(e.target.value)}
                placeholder="valfritt"
              />
            </label>
            <button type="submit" disabled={busy || !winUserId || !winKr}>
              Registrera vinst
            </button>
          </form>

          {summary.entries.length > 0 && (
            <ul className="users-list">
              {summary.entries.slice(0, 40).map((e) => (
                <li key={e.id} className={e.paid ? "inactive" : ""}>
                  <div>
                    <strong>{e.userName}</strong> vann {e.winKr} kr → dig{" "}
                    <strong>{e.commissionKr} kr</strong> ({e.percent} %)
                    <div className="reason">
                      {fmtTime(e.at)}
                      {e.note ? ` · ${e.note}` : ""}
                      {e.paid ? " · mottaget" : " · väntar"}
                    </div>
                  </div>
                  <div className="users-row-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void post("mark_paid", {
                          entryId: e.id,
                          paid: !e.paid,
                        })
                      }
                    >
                      {e.paid ? "Markera obetald" : "Markera mottagen"}
                    </button>
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
          Bara du är huvudperson. Andra får egna konton – du kan sparka ut dem
          direkt om de missbrukar.
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
          </div>
        )}

        <ul className="users-list">
          {users.map((u) => (
            <li key={u.id} className={u.active ? "" : "inactive"}>
              <div>
                <strong>{u.name}</strong>{" "}
                <span className="history-score">
                  {u.active ? "inloggning tillåten" : "avstängd"}
                </span>
              </div>
              <div className="users-row-actions">
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
