"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUDIO_SRC = "/audio/mama-robot-telling-me.mp3";
const TRACK_TITLE = "Mama robot telling me";
const TRACK_ARTIST = "Mikael nyman";
const SUNO_URL = "https://suno.com/s/a4A0wO1qWefAXv1O";
/** Svag men hörbar bakgrundsvolym (0–1). */
const QUIET_VOLUME = 0.22;
const STORAGE_KEY = "mikaels-bg-music-on";

/**
 * Bakgrundsmusik från Suno – startas med knapp (krävs av webbläsaren).
 */
export default function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = QUIET_VOLUME;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () =>
      setError("Kunde inte ladda ljudfilen – ladda om sidan");

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") {
        setEnabled(true);
        // Autoplay blockeras ofta – användaren får trycka Spela
      }
    } catch {
      // ignore
    }

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
  }, []);

  const playNow = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) {
      setError("Ljudspelaren är inte redo");
      return;
    }
    audio.volume = QUIET_VOLUME;
    try {
      await audio.play();
      setPlaying(true);
      setError(null);
      setEnabled(true);
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // ignore
      }
    } catch {
      setPlaying(false);
      setEnabled(true);
      setError("Tryck Spela igen (webbläsaren blockerade ljud)");
    }
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void playNow();
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [playNow]);

  const disable = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setEnabled(false);
    setError(null);
    try {
      localStorage.setItem(STORAGE_KEY, "0");
    } catch {
      // ignore
    }
  }, []);

  return (
    <div
      className={`bg-music ${enabled ? "bg-music-open" : "bg-music-collapsed"}`}
      role="region"
      aria-label="Bakgrundsmusik"
    >
      <audio
        ref={audioRef}
        src={AUDIO_SRC}
        loop
        preload="auto"
        playsInline
      />

      {!enabled ? (
        <button
          type="button"
          className="bg-music-toggle"
          onClick={() => void playNow()}
          title={`${TRACK_TITLE} – svag bakgrund`}
        >
          ▶ Musik
        </button>
      ) : (
        <>
          <div className="bg-music-head">
            <div className="bg-music-meta">
              <strong>Bakgrund · {Math.round(QUIET_VOLUME * 100)}%</strong>
              <span>
                {TRACK_TITLE} · {TRACK_ARTIST}
              </span>
              <span className="bg-music-hint">
                {error || (playing ? "Spelar svagt…" : "Pausad – tryck Spela")}
              </span>
            </div>
            <div className="bg-music-actions">
              <button type="button" className="bg-music-btn" onClick={toggle}>
                {playing ? "Pausa" : "Spela"}
              </button>
              <button
                type="button"
                className="bg-music-btn ghost"
                onClick={disable}
              >
                Stäng
              </button>
            </div>
          </div>
          <a
            className="bg-music-link"
            href={SUNO_URL}
            target="_blank"
            rel="noreferrer"
          >
            Öppna på Suno
          </a>
        </>
      )}
    </div>
  );
}
