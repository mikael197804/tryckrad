"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        initData?: string;
        initDataUnsafe?: {
          user?: {
            username?: string;
            first_name?: string;
          };
        };
        themeParams?: Record<string, string>;
        openTelegramLink?: (url: string) => void;
        openLink?: (url: string) => void;
        platform?: string;
      };
    };
  }
}

function isInsideTelegram(): boolean {
  const tg = window.Telegram?.WebApp;
  if (!tg) return false;
  if (tg.initData && tg.initData.length > 0) return true;
  const platform = tg.platform;
  return Boolean(platform && platform !== "unknown");
}

export function getTelegramInitData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData ?? "";
}

export function getTelegramUsername(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initDataUnsafe?.user?.username ?? "";
}

export function TelegramBoot() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg || !isInsideTelegram()) return;
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor?.("#e8eef4");
      tg.setBackgroundColor?.("#e8eef4");
    } catch {
      // Older Telegram clients reject theme helpers.
    }
  }, []);

  return null;
}
