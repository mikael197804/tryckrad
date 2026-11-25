"use client";

import { useEffect, useMemo, useState } from "react";

const SESSION_KEY = "mikaels-ghost-kasper-ok";
export const PLAY_MUSIC_EVENT = "mikaels-play-music";

type GhostKind = "sheet" | "boo" | "wisp";

const GHOSTS: Array<{ id: GhostKind; label: string }> = [
  { id: "sheet", label: "Lakan-spöket" },
  { id: "boo", label: "Busspöket" },
  { id: "wisp", label: "Dimspöket" },
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function GhostFigure({ kind }: { kind: GhostKind }) {
  if (kind === "boo") {
    return (
      <div className="ghost-figure ghost-boo" aria-hidden>
        <span className="ghost-boo-body">👻</span>
      </div>
    );
  }
  if (kind === "wisp") {
    return (
      <div className="ghost-figure ghost-wisp" aria-hidden>
        <span className="ghost-wisp-core" />
        <span className="ghost-wisp-eye left" />
        <span className="ghost-wisp-eye right" />
      </div>
    );
  }
  return (
    <div className="ghost-figure ghost-sheet" aria-hidden>
      <svg viewBox="0 0 120 140" width="120" height="140">
        <path
          d="M60 12c-24 0-42 18-42 44v58c0 4 3 6 6 4l10-6 10 8 10-8 10 8 10-8 10 6c3 2 6 0 6-4V56C102 30 84 12 60 12z"
          fill="rgba(232,244,250,0.92)"
        />
        <circle cx="44" cy="58" r="7" fill="#07131f" />
        <circle cx="76" cy="58" r="7" fill="#07131f" />
        <ellipse cx="60" cy="78" rx="10" ry="6" fill="#07131f" opacity="0.35" />
      </svg>
    </div>
  );
}

/**
 * Startvy: random spöke + quiz Kasper / Ghostbusters.
 * Rätt svar (Kasper) startar bakgrundsmusiken.
 */
export default function GhostWelcome() {
  const [open, setOpen] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [okFlash, setOkFlash] = useState(false);

  const ghost = useMemo(() => pickRandom(GHOSTS), []);
  const options = useMemo(() => {
    const base = [
      { id: "kasper" as const, label: "Kasper" },
      { id: "ghostbusters" as const, label: "Ghostbusters" },
    ];
    return Math.random() < 0.5 ? base : [...base].reverse();
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setOpen(true);
  }, []);

  if (!open) return null;

  function finishOk() {
    setOkFlash(true);
    setWrong(false);
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(PLAY_MUSIC_EVENT));
    window.setTimeout(() => setOpen(false), 900);
  }

  function onPick(id: "kasper" | "ghostbusters") {
    if (id === "kasper") {
      finishOk();
      return;
    }
    setWrong(true);
  }

  return (
    <div className="ghost-welcome" role="dialog" aria-modal="true" aria-labelledby="ghost-welcome-title">
      <div className={`ghost-welcome-card rise${wrong ? " ghost-shake" : ""}`}>
        <p className="ghost-welcome-kicker">Välkommen hem</p>
        <GhostFigure kind={ghost.id} />
        <h2 id="ghost-welcome-title">Vem är spöket?</h2>
        <p className="ghost-welcome-lead">
          Ett {ghost.label.toLowerCase()} dök upp. Välj rätt namn – då startar
          musiken.
        </p>
        <div className="ghost-welcome-choices">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`ghost-choice${o.id === "kasper" && okFlash ? " ghost-choice-ok" : ""}`}
              onClick={() => onPick(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {wrong && (
          <p className="ghost-welcome-wrong" role="status">
            Fel – det är Kasper, inte Ghostbusters. Försök igen.
          </p>
        )}
        {okFlash && (
          <p className="ghost-welcome-ok" role="status">
            Rätt! Kasper · musiken startar…
          </p>
        )}
      </div>
    </div>
  );
}
