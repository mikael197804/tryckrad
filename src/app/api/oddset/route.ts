import { NextRequest, NextResponse } from "next/server";
import { runWithFreshFetch } from "../../../lib/fetch-mode";
import {
  buildOddsetDayTip,
  type OddsetCandidate,
} from "../../../lib/oddset";
import { PRE_CLOSE_REFRESH_MS } from "../../../lib/refresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type ClientTip = OddsetCandidate & { tippedAt?: string };

async function runOddset(opts: {
  fresh: boolean;
  clientTips?: ClientTip[];
}) {
  const tip = opts.fresh
    ? await runWithFreshFetch(() =>
        buildOddsetDayTip({ clientTips: opts.clientTips })
      )
    : await buildOddsetDayTip({ clientTips: opts.clientTips });
  return {
    ...tip,
    preCloseRefreshMinutes: PRE_CLOSE_REFRESH_MS / 60000,
    fresh: opts.fresh,
  };
}

export async function GET(req: NextRequest) {
  try {
    const fresh =
      req.nextUrl.searchParams.get("fresh") === "1" ||
      req.nextUrl.searchParams.get("fresh") === "true";
    const payload = await runOddset({ fresh });
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid Oddset-analys";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const fresh =
      req.nextUrl.searchParams.get("fresh") === "1" ||
      req.nextUrl.searchParams.get("fresh") === "true";
    let clientTips: ClientTip[] | undefined;
    try {
      const body = (await req.json()) as { clientTips?: ClientTip[] };
      if (Array.isArray(body?.clientTips)) clientTips = body.clientTips;
    } catch {
      clientTips = undefined;
    }
    const payload = await runOddset({ fresh, clientTips });
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid Oddset-analys";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
