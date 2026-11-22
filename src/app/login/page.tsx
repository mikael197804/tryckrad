"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [name, setName] = useState("Mikael");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Inloggning misslyckades");
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nätverksfel");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card rise" onSubmit={onSubmit}>
        <p className="login-kicker">Mikael’s tips</p>
        <h1>Logga in</h1>
        <p className="login-lead">
          Ange ditt namn och lösenord för att öppna tipset.
        </p>

        <label className="login-field">
          <span>Namn</span>
          <input
            name="name"
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
        </label>

        <label className="login-field">
          <span>Lösenord</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>

        {error && <div className="status-banner error">{error}</div>}

        <button type="submit" className="login-submit" disabled={loading}>
          {loading ? "Loggar in…" : "Logga in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-shell">
          <div className="login-card">Laddar…</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
