import { analyzeDraw } from "./analyze";
import { fetchArticlesForMatches } from "./articles";
import { generateSystems } from "./systems";
import { fetchPowerplayDraws } from "./svenskaspel";
import type { DrawBundle } from "./types";

function parseRowPrice(value: string): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function buildAllDrawBundles(): Promise<DrawBundle[]> {
  const draws = await fetchPowerplayDraws();
  const bundles: DrawBundle[] = [];

  for (const draw of draws) {
    const { matches, fatigueAlerts, leagueSummary } = analyzeDraw(draw, draws);
    const articles = await fetchArticlesForMatches(matches, draw.drawNumber);
    const systems = generateSystems(matches);

    bundles.push({
      drawNumber: draw.drawNumber,
      productName: draw.productName,
      closeDescription: draw.regCloseDescription,
      closeTime: draw.regCloseTime,
      openTime: draw.regOpenTime,
      rowPrice: parseRowPrice(draw.rowPrice),
      netSale: draw.currentNetSale ?? null,
      sport: draw.sport?.name ?? "Ishockey",
      leagueSummary,
      matches,
      articles,
      systems,
      fatigueAlerts,
    });
  }

  return bundles;
}

export async function buildDrawBundle(
  drawNumber: number
): Promise<DrawBundle | null> {
  const all = await buildAllDrawBundles();
  return all.find((d) => d.drawNumber === drawNumber) ?? null;
}
