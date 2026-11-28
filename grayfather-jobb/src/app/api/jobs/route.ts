import { NextRequest, NextResponse } from "next/server";
import { createJob, jobInputSchema, listJobs } from "@/lib/jobs";
import { rateLimit } from "@/lib/rate-limit";
import { verifyTelegramInitData } from "@/lib/telegram";
import { formatJobWithOffersForTelegram } from "@/lib/telegram-text";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobs = await listJobs({
    q: searchParams.get("q") ?? undefined,
    segment: searchParams.get("segment") ?? undefined,
    location: searchParams.get("location") ?? undefined,
  });
  return NextResponse.json({
    jobs,
    sample: jobs.length > 0 && jobs.every((j) => j.sample),
    filters: {
      q: searchParams.get("q") ?? "",
      segment: searchParams.get("segment") ?? "Alla",
      location: searchParams.get("location") ?? "Hela Sverige",
    },
  });
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  const limited = rateLimit(`job-post:${ip}`);
  if (!limited.ok) {
    return NextResponse.json(
      { error: `För många försök. Vänta ${limited.retryAfterSec}s.` },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ogiltig JSON" }, { status: 400 });
  }

  const parsed = jobInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Kontrollera fälten och försök igen.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const initData =
    request.headers.get("x-telegram-init-data")?.trim() ||
    (typeof body === "object" &&
    body &&
    "initData" in body &&
    typeof (body as { initData?: unknown }).initData === "string"
      ? (body as { initData: string }).initData
      : "");

  let telegramUserName = parsed.data.telegramUser || "";
  if (botToken) {
    const user = verifyTelegramInitData(initData, botToken);
    if (!user) {
      return NextResponse.json(
        {
          error:
            "Öppna appen via Telegram-boten för att lägga ut jobb när bot-token är aktiv.",
        },
        { status: 401 },
      );
    }
    if (user.username) telegramUserName = user.username;
  }

  try {
    const job = await createJob({
      ...parsed.data,
      telegramUser: telegramUserName,
    });
    return NextResponse.json({
      job,
      telegramText: formatJobWithOffersForTelegram(job),
    });
  } catch (error) {
    console.error("createJob failed", error);
    return NextResponse.json(
      { error: "Kunde inte spara annonsen just nu." },
      { status: 500 },
    );
  }
}
