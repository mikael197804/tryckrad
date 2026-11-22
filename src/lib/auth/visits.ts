import { promises as fs } from "node:fs";
import path from "node:path";

export type VisitEntry = {
  id: string;
  at: string;
  ip: string;
  userName: string | null;
  userId: string | null;
  path: string;
  kind: "login" | "view" | "login_fail";
  userAgent: string | null;
};

type Store = { visits: VisitEntry[] };

const FILE = path.join("/tmp", "tryckrad-visits.json");
const MAX = 250;

declare global {
  // eslint-disable-next-line no-var
  var __tryckradVisits: Store | undefined;
}

function store(): Store {
  if (!globalThis.__tryckradVisits) {
    globalThis.__tryckradVisits = { visits: [] };
  }
  return globalThis.__tryckradVisits;
}

async function hydrate(): Promise<Store> {
  const s = store();
  if (s.visits.length > 0) return s;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (Array.isArray(parsed?.visits)) {
      s.visits = parsed.visits;
    }
  } catch {
    /* empty */
  }
  return s;
}

async function persist(s: Store): Promise<void> {
  try {
    await fs.writeFile(FILE, JSON.stringify(s), "utf8");
  } catch {
    /* ignore */
  }
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first;
  }
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return "okänd";
}

export async function recordVisit(input: {
  ip: string;
  userName?: string | null;
  userId?: string | null;
  path: string;
  kind: VisitEntry["kind"];
  userAgent?: string | null;
}): Promise<VisitEntry> {
  const s = await hydrate();
  const entry: VisitEntry = {
    id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ip: input.ip || "okänd",
    userName: input.userName || null,
    userId: input.userId || null,
    path: input.path || "/",
    kind: input.kind,
    userAgent: input.userAgent?.slice(0, 180) || null,
  };

  // Undvik spam: samma IP+user+kind inom 2 min → uppdatera senaste
  const cutoff = Date.now() - 2 * 60 * 1000;
  const prev = s.visits.find(
    (v) =>
      v.ip === entry.ip &&
      v.userName === entry.userName &&
      v.kind === entry.kind &&
      Date.parse(v.at) >= cutoff
  );
  if (prev && entry.kind === "view") {
    prev.at = entry.at;
    prev.path = entry.path;
    await persist(s);
    return prev;
  }

  s.visits.unshift(entry);
  if (s.visits.length > MAX) s.visits.length = MAX;
  await persist(s);
  return entry;
}

export async function listVisits(limit = 100): Promise<VisitEntry[]> {
  const s = await hydrate();
  return s.visits.slice(0, limit);
}
