import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type CommissionEntry = {
  id: string;
  userId: string;
  userName: string;
  /** Användarens vinst i kr (bara vinster registreras). */
  winKr: number;
  /** Ägarens andel i kr. */
  commissionKr: number;
  percent: number;
  at: string;
  note: string;
  paid: boolean;
};

export type OwnerSettings = {
  /** Provision i % på andras vinster (inte förluster). */
  commissionPercent: number;
  entries: CommissionEntry[];
};

const FILE = path.join(process.cwd(), "data", "owner.json");
const TMP = path.join("/tmp", "tryckrad-owner.json");

declare global {
  // eslint-disable-next-line no-var
  var __tryckradOwner: OwnerSettings | undefined;
}

function defaultSettings(): OwnerSettings {
  return { commissionPercent: 10, entries: [] };
}

async function readFile(p: string): Promise<OwnerSettings | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as OwnerSettings;
    if (typeof parsed?.commissionPercent !== "number") return null;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadOwnerSettings(): Promise<OwnerSettings> {
  if (globalThis.__tryckradOwner) return globalThis.__tryckradOwner;
  const fromDisk =
    (await readFile(TMP)) || (await readFile(FILE)) || defaultSettings();
  globalThis.__tryckradOwner = fromDisk;
  return fromDisk;
}

async function saveOwnerSettings(settings: OwnerSettings): Promise<void> {
  globalThis.__tryckradOwner = settings;
  const body = JSON.stringify(settings, null, 2) + "\n";
  for (const p of [TMP, FILE]) {
    try {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body, "utf8");
    } catch {
      /* ignore */
    }
  }
}

export async function setCommissionPercent(percent: number): Promise<OwnerSettings> {
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
    throw new Error("Provision måste vara 0–50 %");
  }
  const s = await loadOwnerSettings();
  s.commissionPercent = Math.round(percent * 10) / 10;
  await saveOwnerSettings(s);
  return s;
}

/**
 * Registrera en vinst för en användare.
 * Provision tas bara på vinst (> 0). Förlust → ingen post.
 */
export async function registerWin(input: {
  userId: string;
  userName: string;
  winKr: number;
  note?: string;
}): Promise<CommissionEntry> {
  const winKr = Number(input.winKr);
  if (!Number.isFinite(winKr) || winKr <= 0) {
    throw new Error("Ange en vinst över 0 kr (förluster ger ingen provision)");
  }
  const s = await loadOwnerSettings();
  const commissionKr =
    Math.round(((winKr * s.commissionPercent) / 100) * 100) / 100;
  const entry: CommissionEntry = {
    id: `win_${randomBytes(5).toString("hex")}`,
    userId: input.userId,
    userName: input.userName,
    winKr,
    commissionKr,
    percent: s.commissionPercent,
    at: new Date().toISOString(),
    note: (input.note || "").trim().slice(0, 200),
    paid: false,
  };
  s.entries.unshift(entry);
  if (s.entries.length > 500) s.entries.length = 500;
  await saveOwnerSettings(s);
  return entry;
}

export async function markCommissionPaid(id: string, paid: boolean) {
  const s = await loadOwnerSettings();
  const idx = s.entries.findIndex((e) => e.id === id);
  if (idx < 0) throw new Error("Posten hittades inte");
  s.entries[idx] = { ...s.entries[idx]!, paid };
  await saveOwnerSettings(s);
  return s.entries[idx]!;
}

export async function ownerSummary() {
  const s = await loadOwnerSettings();
  const unpaid = s.entries.filter((e) => !e.paid);
  const paid = s.entries.filter((e) => e.paid);
  const sum = (list: CommissionEntry[]) =>
    Math.round(list.reduce((a, e) => a + e.commissionKr, 0) * 100) / 100;
  const winSum = (list: CommissionEntry[]) =>
    Math.round(list.reduce((a, e) => a + e.winKr, 0) * 100) / 100;
  return {
    commissionPercent: s.commissionPercent,
    entries: s.entries,
    totals: {
      winsKr: winSum(s.entries),
      commissionKr: sum(s.entries),
      unpaidKr: sum(unpaid),
      paidKr: sum(paid),
      count: s.entries.length,
    },
  };
}
