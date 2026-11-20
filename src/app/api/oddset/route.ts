import { NextResponse } from "next/server";
import { buildOddsetDayTip } from "../../../lib/oddset";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET() {
  try {
    const tip = await buildOddsetDayTip();
    return NextResponse.json(tip);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid Oddset-analys";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
