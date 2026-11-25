import type { NextRequest } from "next/server";

/** ISO landskod för Sverige. */
export const SWEDEN_COUNTRY = "SE";

/**
 * Land från Vercel edge (`req.geo` / `x-vercel-ip-country`).
 * Tom sträng om okänt (t.ex. lokal dev).
 */
export function requestCountry(req: NextRequest): string {
  const fromGeo = (req as NextRequest & { geo?: { country?: string } }).geo
    ?.country;
  const header = req.headers.get("x-vercel-ip-country");
  return String(fromGeo || header || "")
    .trim()
    .toUpperCase();
}

/** Lokal/utveckling utan Vercel-geo – får passera låset. */
export function isLocalDevHost(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  if (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  ) {
    return true;
  }
  // Next/Vercel non-production (lokal `next dev`, cloud agent)
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) return false;
  return process.env.NODE_ENV !== "production";
}

/** true om begäran får öppna sajten (Sverige, eller lokal dev). */
export function isSwedenAllowed(req: NextRequest): boolean {
  if (isLocalDevHost(req)) return true;
  return requestCountry(req) === SWEDEN_COUNTRY;
}
