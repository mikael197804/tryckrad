import { NextRequest, NextResponse } from "next/server";
import {
  buildTipHistory,
  type HistoryPick,
} from "../../../lib/tipHistory";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await buildTipHistory([]);
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid tipshistorik";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let clientPicks: HistoryPick[] = [];
    try {
      const body = (await req.json()) as { picks?: HistoryPick[] };
      if (Array.isArray(body?.picks)) clientPicks = body.picks;
    } catch {
      clientPicks = [];
    }
    const payload = await buildTipHistory(clientPicks);
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid tipshistorik";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
