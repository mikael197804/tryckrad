"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import {
  getTelegramInitData,
  getTelegramUsername,
} from "@/components/TelegramBoot";
import type { Job } from "@/lib/jobs";

type JobsResponse = { jobs: Job[]; sample: boolean };

const TYPES = [
  "Heltid",
  "Deltid",
  "Timanställning",
  "Konsult",
  "Praktik",
] as const;

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      dateStyle: "medium",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function JobBoard({ channelUrl }: { channelUrl: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sample, setSample] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [telegramText, setTelegramText] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    company: "",
    title: "",
    location: "",
    employmentType: "Heltid",
    description: "",
    contact: "",
    telegramUser: "",
  });

  async function refresh() {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    if (!res.ok) throw new Error("Kunde inte hämta jobb");
    const data = (await res.json()) as JobsResponse;
    setJobs(data.jobs);
    setSample(Boolean(data.sample));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();
      } catch {
        if (alive) setError("Kunde inte ladda annonser just nu.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const username = getTelegramUsername();
    if (username) {
      setForm((prev) =>
        prev.telegramUser ? prev : { ...prev, telegramUser: username },
      );
    }
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setTelegramText("");
    setCopied(false);

    startTransition(async () => {
      try {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-init-data": getTelegramInitData(),
          },
          body: JSON.stringify({
            ...form,
            initData: getTelegramInitData(),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          telegramText?: string;
        };
        if (!res.ok) {
          setError(data.error || "Kunde inte spara annonsen.");
          return;
        }
        setSuccess("Annonsen är publicerad.");
        setTelegramText(data.telegramText || "");
        setForm({
          company: "",
          title: "",
          location: "",
          employmentType: "Heltid",
          description: "",
          contact: "",
          telegramUser: getTelegramUsername(),
        });
        await refresh();
        requestAnimationFrame(() => {
          document.getElementById("dela-telegram")?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
      } catch {
        setError("Nätverksfel. Försök igen.");
      }
    });
  }

  async function copyTelegram() {
    if (!telegramText) return;
    try {
      await navigator.clipboard.writeText(telegramText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function openChannel() {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink && channelUrl.startsWith("https://t.me/")) {
      tg.openTelegramLink(channelUrl);
      return;
    }
    window.open(channelUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <section className="section" id="annonser">
        <div className="section-inner">
          <p className="eyebrow">Lediga jobb</p>
          <h2>Annonser från arbetsgivare</h2>
          <p className="lede">
            {sample
              ? "Exempelannonser visas tills första riktiga jobbet sparas."
              : "Senaste annonserna från arbetsgivare i communityn."}
          </p>

          {loading ? (
            <p className="muted">Laddar annonser…</p>
          ) : (
            <ul className="job-list">
              {jobs.map((job, index) => (
                <li
                  key={job.id}
                  className="job-item"
                  style={{ animationDelay: `${0.05 * index}s` }}
                >
                  <div className="job-meta">
                    <span>{job.employment_type}</span>
                    <span>{job.location}</span>
                    {job.sample ? <span className="sample">Exempel</span> : null}
                  </div>
                  <h3>{job.title}</h3>
                  <p className="company">{job.company}</p>
                  <p>{job.description}</p>
                  <p className="contact">
                    Kontakt: {job.contact}
                    {job.telegram_user
                      ? ` · @${job.telegram_user.replace(/^@/, "")}`
                      : ""}
                  </p>
                  <time dateTime={job.created_at}>
                    {formatDate(job.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="section form-section" id="lagg-ut">
        <div className="section-inner">
          <p className="eyebrow">För arbetsgivare</p>
          <h2>Lägg ut ett jobb</h2>
          <p className="lede">
            Fyll i annonsen. Kopiera sedan texten och dela den i Telegram-sidan.
          </p>

          <form className="job-form" onSubmit={onSubmit}>
            <label>
              Företag
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.company}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, company: e.target.value }))
                }
              />
            </label>
            <label>
              Roll
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
              />
            </label>
            <div className="row">
              <label>
                Ort
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.location}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, location: e.target.value }))
                  }
                />
              </label>
              <label>
                Anställningsform
                <select
                  value={form.employmentType}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      employmentType: e.target.value,
                    }))
                  }
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Beskrivning
              <textarea
                required
                minLength={20}
                maxLength={4000}
                rows={6}
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
              />
            </label>
            <div className="row">
              <label>
                Kontakt (mejl eller telefon)
                <input
                  required
                  minLength={3}
                  maxLength={200}
                  value={form.contact}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, contact: e.target.value }))
                  }
                />
              </label>
              <label>
                Telegram-användarnamn
                <input
                  maxLength={64}
                  placeholder="valfritt"
                  value={form.telegramUser}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      telegramUser: e.target.value,
                    }))
                  }
                />
              </label>
            </div>

            {error ? <p className="form-error">{error}</p> : null}
            {success ? <p className="form-success">{success}</p> : null}

            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={pending}>
                {pending ? "Publicerar…" : "Publicera annons"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={openChannel}
              >
                Öppna Telegram-sidan
              </button>
            </div>
          </form>

          {telegramText ? (
            <div className="telegram-box" id="dela-telegram">
              <p className="eyebrow">Dela i Telegram</p>
              <pre>{telegramText}</pre>
              <button type="button" className="btn primary" onClick={copyTelegram}>
                {copied ? "Kopierad" : "Kopiera text"}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
