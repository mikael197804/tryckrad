const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit = 8,
  windowMs = 60_000,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (row.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((row.resetAt - now) / 1000),
    };
  }
  row.count += 1;
  return { ok: true, retryAfterSec: 0 };
}
