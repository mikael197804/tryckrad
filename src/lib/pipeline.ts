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

  const bundles = await Promise.all(
    draws.map(async (draw) => {
      const { matches, fatigueAlerts, leagueSummary } = analyzeDraw(
        draw,
        draws
      );
      const [articles, systems] = await Promise.all([
        fetchArticlesForMatches(matches, draw.drawNumber),
        Promise.resolve(generateSystems(matches)),
      ]);

      return {
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
      } satisfies DrawBundle;
    })
  );

  return bundles.sort(
    (a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime()
  );
}

export async function buildDrawBundle(
  drawNumber: number
): Promise<DrawBundle | null> {
  const all = await buildAllDrawBundles();
  return all.find((d) => d.drawNumber === drawNumber) ?? null;
}
