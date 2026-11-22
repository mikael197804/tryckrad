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
const TOKEN_FILE = path.join("/tmp", "tryckrad-store-token.txt");
const MAX = 250;
const OWNER = "mikael197804";
const REPO = "tryckrad";
const GH_PATH = "visits.json";
const GH_BRANCH = "logs";

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

export async function rememberStoreToken(token: string | null | undefined) {
  const t = token?.trim();
  if (!t) return;
  try {
    await fs.writeFile(TOKEN_FILE, t, "utf8");
  } catch {
    /* ignore */
  }
}

async function resolvedTokens(extra?: string | null): Promise<string[]> {
  const out: string[] = [];
  const add = (v?: string | null) => {
    const t = v?.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(extra);
  add(process.env.USER_STORE_TOKEN);
  add(process.env.GITHUB_TOKEN);
  try {
    add(await fs.readFile(TOKEN_FILE, "utf8"));
  } catch {
    /* none */
  }
  return out;
}

async function readDisk(): Promise<VisitEntry[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    return Array.isArray(parsed?.visits) ? parsed.visits : [];
  } catch {
    return [];
  }
}

async function writeDisk(visits: VisitEntry[]): Promise<void> {
  try {
    await fs.writeFile(FILE, JSON.stringify({ visits }), "utf8");
  } catch {
    /* ignore */
  }
}

async function fetchFromGitHub(extraToken?: string | null): Promise<VisitEntry[]> {
  for (const token of await resolvedTokens(extraToken)) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "tryckrad-visits",
          },
          cache: "no-store",
        }
      );
      if (res.status === 404) return [];
      if (!res.ok) continue;
      const json = (await res.json()) as { content?: string };
      if (!json.content) continue;
      const raw = Buffer.from(json.content, "base64").toString("utf8");
      const parsed = JSON.parse(raw) as Store;
      return Array.isArray(parsed?.visits) ? parsed.visits : [];
    } catch {
      /* try next */
    }
  }
  return [];
}

async function pushToGitHub(
  visits: VisitEntry[],
  extraToken?: string | null
): Promise<void> {
  const body = JSON.stringify({ visits }, null, 2) + "\n";
  const content = Buffer.from(body, "utf8").toString("base64");

  for (const token of await resolvedTokens(extraToken)) {
    try {
      const getRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "tryckrad-visits",
          },
          cache: "no-store",
        }
      );
      let sha: string | undefined;
      if (getRes.ok) {
        sha = ((await getRes.json()) as { sha?: string }).sha;
      } else if (getRes.status !== 404) {
        continue;
      }

      const putRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${GH_PATH}`,
        {
          method: "PUT",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "tryckrad-visits",
          },
          body: JSON.stringify({
            message: "Uppdatera besökslog (IP)",
            content,
            branch: GH_BRANCH,
            ...(sha ? { sha } : {}),
          }),
        }
      );
      if (putRes.ok) return;
    } catch {
      /* try next */
    }
  }
}

function mergeById(a: VisitEntry[], b: VisitEntry[]): VisitEntry[] {
  const map = new Map<string, VisitEntry>();
  for (const v of [...a, ...b]) map.set(v.id, v);
  return [...map.values()]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, MAX);
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
  storeToken?: string | null;
}): Promise<VisitEntry> {
  if (input.storeToken) await rememberStoreToken(input.storeToken);

  const s = store();
  const disk = await readDisk();
  const remote = await fetchFromGitHub(input.storeToken);
  s.visits = mergeById(s.visits, mergeById(disk, remote));

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
    await writeDisk(s.visits);
    void pushToGitHub(s.visits, input.storeToken);
    return prev;
  }

  s.visits.unshift(entry);
  if (s.visits.length > MAX) s.visits.length = MAX;
  await writeDisk(s.visits);
  void pushToGitHub(s.visits, input.storeToken);
  return entry;
}

export async function listVisits(
  limit = 100,
  storeToken?: string | null
): Promise<VisitEntry[]> {
  if (storeToken) await rememberStoreToken(storeToken);
  const s = store();
  const disk = await readDisk();
  const remote = await fetchFromGitHub(storeToken);
  s.visits = mergeById(s.visits, mergeById(disk, remote));
  await writeDisk(s.visits);
  return s.visits.slice(0, limit);
}
