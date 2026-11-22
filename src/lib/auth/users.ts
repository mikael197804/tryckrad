import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword } from "./password";
import type { AppUser, UserRole } from "./types";
import seedJson from "../../../data/users.json";
import {
  fetchUsersFromGitHub,
  pushUsersToGitHub,
} from "./githubStore";
import { OWNER_ID, OWNER_NAME, assertNotOwnerName } from "./owner";

type StoreFile = { users: AppUser[] };

const REL_PATH = path.join("data", "users.json");

declare global {
  // eslint-disable-next-line no-var
  var __tryckradUsersCache: StoreFile | undefined;
  // eslint-disable-next-line no-var
  var __tryckradUsersCacheAt: number | undefined;
}

const CACHE_MS = 15_000;

function cache(): StoreFile | undefined {
  const at = globalThis.__tryckradUsersCacheAt || 0;
  if (Date.now() - at > CACHE_MS) return undefined;
  return globalThis.__tryckradUsersCache;
}

function setCache(store: StoreFile) {
  globalThis.__tryckradUsersCache = store;
  globalThis.__tryckradUsersCacheAt = Date.now();
}

function clearCache() {
  globalThis.__tryckradUsersCache = undefined;
  globalThis.__tryckradUsersCacheAt = undefined;
}

function seedStore(): StoreFile {
  const users = (seedJson as StoreFile)?.users;
  if (Array.isArray(users) && users.length > 0) {
    return { users: users.map((u) => ({ ...u })) };
  }
  return {
    users: [
      {
        id: "usr_mikael",
        name: "Mikael",
        role: "admin",
        active: true,
        passwordHash:
          "pbkdf2$100000$hd4Xf97rvk0aaqK0ytl+NA==$zbs+AnlNoJl4sOiqBF87NR5viW84jB9InqRUqOzrenI=",
        createdAt: "2026-11-22T11:00:00.000Z",
      },
    ],
  };
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

async function readFromDisk(): Promise<StoreFile | null> {
  const candidates = [
    path.join(process.cwd(), REL_PATH),
    path.join("/tmp", "tryckrad-users.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      if (Array.isArray(parsed?.users)) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function writeToDisk(store: StoreFile): Promise<boolean> {
  const payloads = JSON.stringify(store, null, 2) + "\n";
  const targets = [
    path.join(process.cwd(), REL_PATH),
    path.join("/tmp", "tryckrad-users.json"),
  ];
  let ok = false;
  for (const file of targets) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, payloads, "utf8");
      ok = true;
    } catch {
      /* read-only fs on some hosts */
    }
  }
  return ok;
}

function usersFromEnv(): AppUser[] {
  const raw = process.env.APP_USERS?.trim();
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Array<{
      name?: string;
      password?: string;
      passwordHash?: string;
      role?: UserRole;
      id?: string;
      active?: boolean;
    }>;
    if (!Array.isArray(list)) return [];
    return list
      .filter((u) => u?.name && (u.password || u.passwordHash))
      .map((u) => ({
        id: u.id || `usr_env_${normalizeName(u.name!).toLowerCase()}`,
        name: normalizeName(u.name!),
        role: u.role === "admin" ? "admin" : "user",
        active: u.active !== false,
        passwordHash: u.passwordHash || hashPassword(u.password!),
        createdAt: new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function mergeUsers(base: AppUser[], extra: AppUser[]): AppUser[] {
  const byName = new Map<string, AppUser>();
  for (const u of [...base, ...extra]) {
    byName.set(u.name.toLowerCase(), u);
  }
  return [...byName.values()];
}

export async function loadUsers(): Promise<AppUser[]> {
  const hit = cache();
  if (hit) return mergeUsers(hit.users, usersFromEnv());

  const fromGh = await fetchUsersFromGitHub();
  if (fromGh?.length) {
    const store = { users: fromGh };
    setCache(store);
    return mergeUsers(store.users, usersFromEnv());
  }

  const disk = await readFromDisk();
  const store = disk?.users?.length ? disk : seedStore();
  setCache(store);
  return mergeUsers(store.users, usersFromEnv());
}

async function saveUsers(
  users: AppUser[],
  storeToken?: string | null
): Promise<{ persisted: boolean; error?: string }> {
  const store = { users };
  setCache(store);
  await writeToDisk(store);
  const gh = await pushUsersToGitHub(users, storeToken);
  if (!gh.ok) {
    return { persisted: false, error: gh.error };
  }
  clearCache();
  setCache(store);
  return { persisted: true };
}

export async function findUserByName(name: string): Promise<AppUser | null> {
  const n = normalizeName(name).toLowerCase();
  const users = await loadUsers();
  return users.find((u) => u.name.toLowerCase() === n) || null;
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const users = await loadUsers();
  return users.find((u) => u.id === id) || null;
}

export async function listUsers(): Promise<AppUser[]> {
  return loadUsers();
}

export type SaveResult = {
  user: AppUser;
  persisted: boolean;
  persistError?: string;
  password?: string;
};

async function currentDiskUsers(): Promise<AppUser[]> {
  // Använd cache först så nyss skapade konton går att sparka/uppdatera
  // även när GitHub-push saknas (vanligt på Vercel utan token).
  const hit = cache();
  if (hit?.users?.length) return hit.users.map((u) => ({ ...u }));

  const disk = await readFromDisk();
  if (disk?.users?.length) return disk.users;

  const fromGh = await fetchUsersFromGitHub();
  if (fromGh?.length) return fromGh;

  return seedStore().users;
}

export async function createUser(
  input: {
    name: string;
    password: string;
    role?: UserRole;
    /** Antal dagar spelaccess vid skapande (standard 7). Alltid role=user. */
    accessDays?: number;
  },
  storeToken?: string | null
): Promise<SaveResult> {
  const name = normalizeName(input.name);
  if (!name || name.length < 2) {
    throw new Error("Namnet måste vara minst 2 tecken");
  }
  assertNotOwnerName(name);
  if (!input.password || input.password.length < 6) {
    throw new Error("Lösenordet måste vara minst 6 tecken");
  }
  const existing = await findUserByName(name);
  if (existing) throw new Error("Namnet är redan upptaget");

  const daysRaw = input.accessDays ?? 7;
  const days = Math.floor(Number(daysRaw));
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new Error("Ange 1–365 dagar spelaccess");
  }
  const accessUntil = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000
  ).toISOString();

  // Bara Mikael är huvudperson – inbjudna blir alltid vanliga spelare
  const user: AppUser = {
    id: `usr_${randomBytes(6).toString("hex")}`,
    name,
    role: "user",
    active: true,
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString(),
    sessionVersion: 0,
    accessUntil,
  };

  const base = await currentDiskUsers();
  const next = mergeUsers(base, [user]);
  const saved = await saveUsers(next, storeToken);
  return {
    user,
    persisted: saved.persisted,
    persistError: saved.error,
  };
}

export async function setUserActive(
  id: string,
  active: boolean,
  storeToken?: string | null
): Promise<SaveResult> {
  const base = await currentDiskUsers();
  const idx = base.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("Användaren hittades inte");
  if (
    (base[idx]!.id === OWNER_ID || base[idx]!.name === OWNER_NAME) &&
    !active
  ) {
    throw new Error("Kan inte stänga av huvudkontot");
  }
  const next = base.map((u, i) => (i === idx ? { ...u, active } : u));
  const saved = await saveUsers(next, storeToken);
  return {
    user: next[idx]!,
    persisted: saved.persisted,
    persistError: saved.error,
  };
}

export async function removeUser(
  id: string,
  storeToken?: string | null
): Promise<{ persisted: boolean; persistError?: string }> {
  const base = await currentDiskUsers();
  const target = base.find((u) => u.id === id);
  if (!target) throw new Error("Användaren hittades inte");
  if (target.id === OWNER_ID || target.name === OWNER_NAME) {
    throw new Error("Kan inte ta bort huvudkontot");
  }
  const next = base.filter((u) => u.id !== id);
  const saved = await saveUsers(next, storeToken);
  return { persisted: saved.persisted, persistError: saved.error };
}

export async function resetUserPassword(
  id: string,
  password: string,
  storeToken?: string | null
): Promise<SaveResult> {
  if (!password || password.length < 6) {
    throw new Error("Lösenordet måste vara minst 6 tecken");
  }
  const base = await currentDiskUsers();
  const idx = base.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("Användaren hittades inte");
  const next = base.map((u, i) =>
    i === idx ? { ...u, passwordHash: hashPassword(password) } : u
  );
  const saved = await saveUsers(next, storeToken);
  return {
    user: next[idx]!,
    persisted: saved.persisted,
    persistError: saved.error,
  };
}

/** Sparka ut – ogiltigförklarar alla aktiva inloggningar för användaren. */
export async function kickUserSession(
  id: string,
  storeToken?: string | null
): Promise<SaveResult> {
  const base = await currentDiskUsers();
  const idx = base.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("Användaren hittades inte");
  if (base[idx]!.id === OWNER_ID || base[idx]!.name === OWNER_NAME) {
    throw new Error("Kan inte sparka ut huvudkontot");
  }
  const cur = base[idx]!;
  const next = base.map((u, i) =>
    i === idx
      ? { ...u, sessionVersion: (cur.sessionVersion ?? 0) + 1 }
      : u
  );
  const saved = await saveUsers(next, storeToken);
  return {
    user: next[idx]!,
    persisted: saved.persisted,
    persistError: saved.error,
  };
}

/** Sparka ut och stäng av access. */
export async function kickAndBan(
  id: string,
  storeToken?: string | null
): Promise<SaveResult> {
  const kicked = await kickUserSession(id, storeToken);
  return setUserActive(id, false, storeToken).catch(() => kicked);
}

export async function setUserAccessUntil(
  id: string,
  accessUntil: string,
  storeToken?: string | null
): Promise<SaveResult> {
  const base = await currentDiskUsers();
  const idx = base.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("Användaren hittades inte");
  if (base[idx]!.id === OWNER_ID || base[idx]!.name === OWNER_NAME) {
    throw new Error("Huvudkontot behöver ingen dagsbetalning");
  }
  const next = base.map((u, i) =>
    i === idx ? { ...u, accessUntil } : u
  );
  const saved = await saveUsers(next, storeToken);
  return {
    user: next[idx]!,
    persisted: saved.persisted,
    persistError: saved.error,
  };
}
