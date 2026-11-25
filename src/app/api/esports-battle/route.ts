import { NextRequest, NextResponse } from "next/server";
import { buildEsportsBattleDay } from "../../../lib/esportsBattle";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const fresh =
      req.nextUrl.searchParams.get("fresh") === "1" ||
      req.nextUrl.searchParams.get("fresh") === "true";
    const payload = await buildEsportsBattleDay(fresh);
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Okänt fel vid Esports Battle-resultat";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
