import { NextResponse } from "next/server";
import { buildAllDrawBundles } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const draws = await buildAllDrawBundles();
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      count: draws.length,
      draws,
      disclaimer:
        "Analysverktyg – inga spelråd med garanti. Spela ansvarsfullt (18+).",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt fel vid hämtning";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
