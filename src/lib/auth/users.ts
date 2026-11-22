import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword } from "./password";
import type { AppUser, UserRole } from "./types";
import seedJson from "../../../data/users.json";

type StoreFile = { users: AppUser[] };

const REL_PATH = path.join("data", "users.json");

declare global {
  // eslint-disable-next-line no-var
  var __tryckradUsersCache: StoreFile | undefined;
}

function cache(): StoreFile | undefined {
  return globalThis.__tryckradUsersCache;
}

function setCache(store: StoreFile) {
  globalThis.__tryckradUsersCache = store;
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

/** Extra users from env: APP_USERS='[{"name":"Anna","password":"hemligt","role":"user"}]' */
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

  const disk = await readFromDisk();
  const store = disk?.users?.length ? disk : seedStore();
  setCache(store);
  return mergeUsers(store.users, usersFromEnv());
}

async function saveUsers(users: AppUser[]): Promise<void> {
  const store = { users };
  setCache(store);
  await writeToDisk(store);
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

export async function createUser(input: {
  name: string;
  password: string;
  role?: UserRole;
}): Promise<AppUser> {
  const name = normalizeName(input.name);
  if (!name || name.length < 2) {
    throw new Error("Namnet måste vara minst 2 tecken");
  }
  if (!input.password || input.password.length < 6) {
    throw new Error("Lösenordet måste vara minst 6 tecken");
  }
  const existing = await findUserByName(name);
  if (existing) throw new Error("Namnet är redan upptaget");

  const user: AppUser = {
    id: `usr_${randomBytes(6).toString("hex")}`,
    name,
    role: input.role === "admin" ? "admin" : "user",
    active: true,
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };

  const users = await loadUsers();
  // Persist only file-backed users (not env-only ghosts)
  const disk = (await readFromDisk()) || seedStore();
  const next = mergeUsers(disk.users, [user]);
  await saveUsers(next);
  // refresh cache with env merge later via loadUsers
  setCache({ users: next });
  return user;
}

export async function setUserActive(id: string, active: boolean): Promise<AppUser> {
  const disk = (await readFromDisk()) || seedStore();
  const idx = disk.users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("Användaren hittades inte");
  if (disk.users[idx]!.name === "Mikael" && !active) {
    throw new Error("Kan inte inaktivera huvudkontot Mikael");
  }
  disk.users[idx] = { ...disk.users[idx]!, active };
  await saveUsers(disk.users);
  return disk.users[idx]!;
}

export async function resetUserPassword(
  id: string,
  password: string
): Promise<AppUser> {
  if (!password || password.length < 6) {
    throw new Error("Lösenordet måste vara minst 6 tecken");
  }
  const disk = (await readFromDisk()) || seedStore();
  const idx = disk.users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("Användaren hittades inte");
  disk.users[idx] = {
    ...disk.users[idx]!,
    passwordHash: hashPassword(password),
  };
  await saveUsers(disk.users);
  return disk.users[idx]!;
}
