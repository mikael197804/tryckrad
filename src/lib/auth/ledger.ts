import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type DayPayment = {
  id: string;
  userId: string;
  userName: string;
  /** Antal dagar som betalats. */
  days: number;
  /** Belopp i kr. */
  amountKr: number;
  /** Access giltig t.o.m. denna tidpunkt (ISO). */
  accessUntil: string;
  at: string;
  note: string;
};

export type OwnerSettings = {
  /** Pris per dag i kr. */
  pricePerDayKr: number;
  payments: DayPayment[];
};

const FILE = path.join(process.cwd(), "data", "owner.json");
const TMP = path.join("/tmp", "tryckrad-owner.json");

declare global {
  // eslint-disable-next-line no-var
  var __tryckradOwner: OwnerSettings | undefined;
}

function defaultSettings(): OwnerSettings {
  return { pricePerDayKr: 29, payments: [] };
}

function normalizeSettings(raw: unknown): OwnerSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // Migrera bort gammal provision-modell
  const price =
    typeof o.pricePerDayKr === "number"
      ? o.pricePerDayKr
      : defaultSettings().pricePerDayKr;
  const payments = Array.isArray(o.payments)
    ? (o.payments as DayPayment[])
    : [];
  return {
    pricePerDayKr: price,
    payments: payments.filter(
      (p) => p && typeof p.id === "string" && typeof p.userId === "string"
    ),
  };
}

async function readFile(p: string): Promise<OwnerSettings | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return normalizeSettings(JSON.parse(raw));
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

export async function setPricePerDay(kr: number): Promise<OwnerSettings> {
  if (!Number.isFinite(kr) || kr < 0 || kr > 5000) {
    throw new Error("Dygnspris måste vara 0–5000 kr");
  }
  const s = await loadOwnerSettings();
  s.pricePerDayKr = Math.round(kr * 100) / 100;
  await saveOwnerSettings(s);
  return s;
}

/** Förlänger access med N dagar från max(nu, nuvarande accessUntil). */
export function extendAccessUntil(
  currentUntil: string | null | undefined,
  days: number
): string {
  const now = Date.now();
  const cur = currentUntil ? Date.parse(currentUntil) : NaN;
  const base = Number.isFinite(cur) && cur > now ? cur : now;
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

export function hasPaidAccess(accessUntil: string | null | undefined): boolean {
  if (!accessUntil) return false;
  const t = Date.parse(accessUntil);
  return Number.isFinite(t) && t > Date.now();
}

export async function registerDayPayment(input: {
  userId: string;
  userName: string;
  days: number;
  /** Om utelämnad: days * pricePerDayKr */
  amountKr?: number;
  currentAccessUntil?: string | null;
  note?: string;
}): Promise<{ payment: DayPayment; accessUntil: string }> {
  const days = Math.floor(Number(input.days));
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new Error("Ange 1–365 dagar");
  }
  const s = await loadOwnerSettings();
  const amountKr =
    input.amountKr != null && Number.isFinite(Number(input.amountKr))
      ? Math.round(Number(input.amountKr) * 100) / 100
      : Math.round(days * s.pricePerDayKr * 100) / 100;
  if (amountKr < 0) throw new Error("Belopp kan inte vara negativt");

  const accessUntil = extendAccessUntil(input.currentAccessUntil, days);
  const payment: DayPayment = {
    id: `day_${randomBytes(5).toString("hex")}`,
    userId: input.userId,
    userName: input.userName,
    days,
    amountKr,
    accessUntil,
    at: new Date().toISOString(),
    note: (input.note || "").trim().slice(0, 200),
  };
  s.payments.unshift(payment);
  if (s.payments.length > 500) s.payments.length = 500;
  await saveOwnerSettings(s);
  return { payment, accessUntil };
}

export async function ownerSummary() {
  const s = await loadOwnerSettings();
  const totalKr = Math.round(
    s.payments.reduce((a, p) => a + p.amountKr, 0) * 100
  ) / 100;
  const totalDays = s.payments.reduce((a, p) => a + p.days, 0);
  return {
    pricePerDayKr: s.pricePerDayKr,
    payments: s.payments,
    totals: {
      paidKr: totalKr,
      daysSold: totalDays,
      count: s.payments.length,
    },
  };
}
