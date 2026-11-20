/** Alla spel uppdateras 12 minuter före spelstopp. */
export const PRE_CLOSE_REFRESH_MS = 12 * 60 * 1000;

export function closeMs(iso: string): number | null {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Tidpunkt då förhands-uppdateringen ska köras (close − 12 min). */
export function preCloseAt(closeTimeIso: string): number | null {
  const t = closeMs(closeTimeIso);
  return t == null ? null : t - PRE_CLOSE_REFRESH_MS;
}

export function isInPreCloseWindow(
  closeTimeIso: string,
  now = Date.now()
): boolean {
  const close = closeMs(closeTimeIso);
  if (close == null) return false;
  return now >= close - PRE_CLOSE_REFRESH_MS && now < close + 60 * 1000;
}

/** Nästa schemalagda uppdatering bland flera stopptider (ms absolut). */
export function nextPreCloseRefreshAt(
  closeTimes: string[],
  now = Date.now()
): number | null {
  let best: number | null = null;
  for (const iso of closeTimes) {
    const at = preCloseAt(iso);
    const close = closeMs(iso);
    if (at == null || close == null) continue;
    if (close <= now) continue;
    // Om vi redan är i fönstret: uppdatera snart (om 0–15 s)
    if (now >= at && now < close) {
      const soon = now + 5_000;
      if (best == null || soon < best) best = soon;
      continue;
    }
    if (at > now && (best == null || at < best)) best = at;
  }
  return best;
}

export function formatPreCloseLabel(closeTimeIso: string, now = Date.now()): string {
  const close = closeMs(closeTimeIso);
  if (close == null) return "";
  const minsToClose = Math.round((close - now) / 60000);
  if (minsToClose > 12) {
    return `Uppdateras automatiskt 12 min före spelstopp (om ${minsToClose - 12} min)`;
  }
  if (minsToClose >= 0) {
    return `Sen uppdatering före spelstopp aktiv · ${minsToClose} min kvar till stopp`;
  }
  return "Spelstopp har passerat";
}
