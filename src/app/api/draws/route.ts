import { NextRequest, NextResponse } from "next/server";
import { buildAllDrawBundles } from "../../../lib/pipeline";
import type { ProductKind } from "../../../lib/svenskaspel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("product") ?? "powerplay";
    const product: ProductKind =
      raw === "topptipset" ? "topptipset" : "powerplay";
    const draws = await buildAllDrawBundles(product);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      product,
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
