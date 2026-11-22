import type { NextRequest } from "next/server";
import type { SessionPayload, UserRole } from "./types";

export const SESSION_COOKIE = "tr_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 dagar

function secret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.AUTH_PASSWORD?.trim() ||
    "tryckrad-session-v1-mikael-tips"
  );
}

function b64urlFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]!);
  const b64 =
    typeof btoa === "function"
      ? btoa(s)
      : Buffer.from(arr).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlFromString(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return b64urlFromBytes(bytes);
}

function bytesFromB64url(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function hmacSign(payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return b64urlFromBytes(sig);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(user: {
  id: string;
  name: string;
  role: UserRole;
}): Promise<string> {
  const payload: SessionPayload = {
    uid: user.id,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const payloadB64 = b64urlFromString(JSON.stringify(payload));
  const sig = await hmacSign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = await hmacSign(payloadB64);
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const json = new TextDecoder().decode(bytesFromB64url(payloadB64));
    const raw = JSON.parse(json) as SessionPayload;
    if (!raw?.uid || !raw.name || !raw.role || !raw.exp) return null;
    if (raw.exp * 1000 < Date.now()) return null;
    if (raw.role !== "admin" && raw.role !== "user") return null;
    return raw;
  } catch {
    return null;
  }
}

export async function readSessionFromRequest(
  req: NextRequest | Request
): Promise<SessionPayload | null> {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`)
  );
  if (!match?.[1]) return null;
  return verifySessionToken(decodeURIComponent(match[1]));
}

export function sessionCookieHeader(token: string): string {
  const secure =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SEC}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookieHeader(): string {
  const secure =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
