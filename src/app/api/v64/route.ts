import { NextRequest, NextResponse } from "next/server";
import { runWithFreshFetch } from "../../../lib/fetch-mode";
import { PRE_CLOSE_REFRESH_MS } from "../../../lib/refresh";
import { buildV64DayTip } from "../../../lib/v75";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function runV64(fresh: boolean) {
  const tip = fresh
    ? await runWithFreshFetch(() => buildV64DayTip())
    : await buildV64DayTip();
  return {
    ...tip,
    preCloseRefreshMinutes: PRE_CLOSE_REFRESH_MS / 60000,
    fresh,
  };
}

export async function GET(req: NextRequest) {
  try {
    const fresh =
      req.nextUrl.searchParams.get("fresh") === "1" ||
      req.nextUrl.searchParams.get("fresh") === "true";
    const payload = await runV64(fresh);
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid V64-analys";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
