"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUDIO_SRC = "/audio/mama-robot-telling-me.mp3";
const TRACK_TITLE = "Mama robot telling me";
const SUNO_URL = "https://suno.com/s/a4A0wO1qWefAXv1O";
/** Svag bakgrundsvolym (0–1). */
const QUIET_VOLUME = 0.12;
const STORAGE_KEY = "mikaels-bg-music-on";

function createAudio(): HTMLAudioElement {
  const audio = new Audio(AUDIO_SRC);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = QUIET_VOLUME;
  return audio;
}

/**
 * Bakgrundsmusik från Suno – loopas svagt efter första klicket.
 */
export default function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [playing, setPlaying] = useState(false);

  const bindEvents = useCallback((audio: HTMLAudioElement) => {
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "1") return;
      setEnabled(true);
      const audio = createAudio();
      audioRef.current = audio;
      const unbind = bindEvents(audio);
      void audio.play().catch(() => undefined);
      return () => {
        unbind();
        audio.pause();
        audioRef.current = null;
      };
    } catch {
      // ignore
    }
  }, [bindEvents]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const enableAndPlay = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setEnabled(true);
    let audio = audioRef.current;
    if (!audio) {
      audio = createAudio();
      audioRef.current = audio;
      bindEvents(audio);
    }
    audio.volume = QUIET_VOLUME;
    void audio.play().catch(() => undefined);
  }, [bindEvents]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      enableAndPlay();
      return;
    }
    if (audio.paused) {
      audio.volume = QUIET_VOLUME;
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [enableAndPlay]);

  const disable = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setEnabled(false);
    try {
      localStorage.setItem(STORAGE_KEY, "0");
    } catch {
      // ignore
    }
  }, []);

  if (!enabled) {
    return (
      <div className="bg-music bg-music-collapsed">
        <button
          type="button"
          className="bg-music-toggle"
          onClick={enableAndPlay}
          title={`${TRACK_TITLE} – svag bakgrund`}
        >
          Musik · svag
        </button>
      </div>
    );
  }

  return (
    <div className="bg-music bg-music-open" role="region" aria-label="Bakgrundsmusik">
      <div className="bg-music-head">
        <div className="bg-music-meta">
          <strong>Bakgrund · {Math.round(QUIET_VOLUME * 100)}%</strong>
          <span>{TRACK_TITLE}</span>
          <span className="bg-music-hint">Suno · loopas svagt</span>
        </div>
        <div className="bg-music-actions">
          <button type="button" className="bg-music-btn" onClick={toggle}>
            {playing ? "Pausa" : "Spela"}
          </button>
          <button type="button" className="bg-music-btn ghost" onClick={disable}>
            Stäng
          </button>
        </div>
      </div>
      <a className="bg-music-link" href={SUNO_URL} target="_blank" rel="noreferrer">
        Öppna på Suno
      </a>
    </div>
  );
}
