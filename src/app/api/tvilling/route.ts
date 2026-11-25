import { NextRequest, NextResponse } from "next/server";
import { runWithFreshFetch } from "../../../lib/fetch-mode";
import { PRE_CLOSE_REFRESH_MS } from "../../../lib/refresh";
import { buildTvillingDayTip } from "../../../lib/tvilling";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function runTvilling(fresh: boolean) {
  const tip = fresh
    ? await runWithFreshFetch(() => buildTvillingDayTip())
    : await buildTvillingDayTip();
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
    const payload = await runTvilling(fresh);
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid Tvilling-analys";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
