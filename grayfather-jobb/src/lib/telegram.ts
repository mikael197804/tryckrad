import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

function parseInitData(initData: string): URLSearchParams {
  return new URLSearchParams(initData);
}

/** Validates Telegram WebApp initData when TELEGRAM_BOT_TOKEN is set. */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400,
): TelegramUser | null {
  if (!initData || !botToken) return null;
  const params = parseInitData(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  try {
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;
  try {
    return JSON.parse(rawUser) as TelegramUser;
  } catch {
    return null;
  }
}

export function channelDisplayName(): string {
  return "*+:｡.｡-𝖌𝐫áվꊰ𝑎Եħℯ𝐫-｡.｡:+*";
}

export function channelUrl(): string {
  return (
    process.env.TELEGRAM_CHANNEL_URL?.trim() ||
    "https://t.me/"
  );
}
