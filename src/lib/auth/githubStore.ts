import type { AppUser } from "./types";

const OWNER = "mikael197804";
const REPO = "tryckrad";
const PATH = "data/users.json";
const BRANCH = "main";

type StoreFile = { users: AppUser[] };

function tokenCandidates(extra?: string | null): string[] {
  return [
    extra?.trim() || "",
    process.env.USER_STORE_TOKEN?.trim() || "",
    process.env.GITHUB_TOKEN?.trim() || "",
  ].filter(Boolean);
}

export async function fetchUsersFromGitHub(): Promise<AppUser[] | null> {
  // 1) API (works for private repos with token)
  for (const token of tokenCandidates()) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "tryckrad-access",
          },
          cache: "no-store",
        }
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { content?: string; encoding?: string };
      if (!json.content) continue;
      const raw = Buffer.from(json.content, "base64").toString("utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      if (Array.isArray(parsed?.users)) return parsed.users;
    } catch {
      /* try next */
    }
  }

  // 2) Public raw (only if repo is public)
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${PATH}?t=${Date.now()}`,
      { cache: "no-store", headers: { "User-Agent": "tryckrad-access" } }
    );
    if (!res.ok) return null;
    const parsed = (await res.json()) as StoreFile;
    if (Array.isArray(parsed?.users)) return parsed.users;
  } catch {
    /* ignore */
  }
  return null;
}

export async function pushUsersToGitHub(
  users: AppUser[],
  storeToken?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const tokens = tokenCandidates(storeToken);
  if (!tokens.length) {
    return { ok: false, error: "Saknar GitHub-token för att spara behöriga" };
  }

  const body = JSON.stringify({ users }, null, 2) + "\n";
  const content = Buffer.from(body, "utf8").toString("base64");

  for (const token of tokens) {
    try {
      // Get current sha
      const getRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "tryckrad-access",
          },
          cache: "no-store",
        }
      );
      if (!getRes.ok) {
        continue;
      }
      const existing = (await getRes.json()) as { sha?: string };
      const putRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`,
        {
          method: "PUT",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "tryckrad-access",
          },
          body: JSON.stringify({
            message: "Uppdatera behöriga användare",
            content,
            branch: BRANCH,
            sha: existing.sha,
          }),
        }
      );
      if (putRes.ok) return { ok: true };
      const err = (await putRes.json().catch(() => null)) as {
        message?: string;
      } | null;
      return {
        ok: false,
        error: err?.message || `GitHub svarade ${putRes.status}`,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "GitHub-fel",
      };
    }
  }

  return { ok: false, error: "Kunde inte spara till GitHub" };
}
