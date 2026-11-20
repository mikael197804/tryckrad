import { NextRequest, NextResponse } from "next/server";
import { runWithFreshFetch } from "../../../lib/fetch-mode";
import { buildOddsetDayTip } from "../../../lib/oddset";
import { PRE_CLOSE_REFRESH_MS } from "../../../lib/refresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const fresh =
      req.nextUrl.searchParams.get("fresh") === "1" ||
      req.nextUrl.searchParams.get("fresh") === "true";
    const tip = fresh
      ? await runWithFreshFetch(() => buildOddsetDayTip())
      : await buildOddsetDayTip();
    return NextResponse.json({
      ...tip,
      preCloseRefreshMinutes: PRE_CLOSE_REFRESH_MS / 60000,
      fresh,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid Oddset-analys";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
