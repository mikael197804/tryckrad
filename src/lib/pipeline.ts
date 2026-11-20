import { analyzeDraw } from "./analyze";
import { fetchArticlesForMatches } from "./articles";
import { generateSystems } from "./systems";
import {
  fetchDrawsForProduct,
  type ProductKind,
} from "./svenskaspel";
import type { DrawBundle } from "./types";

function parseRowPrice(value: string): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function buildAllDrawBundles(
  product: ProductKind = "powerplay"
): Promise<DrawBundle[]> {
  const draws = await fetchDrawsForProduct(product);
  const defaultSport = product === "topptipset" ? "Fotboll" : "Ishockey";

  const bundles = await Promise.all(
    draws.map(async (draw) => {
      const { matches, fatigueAlerts, leagueSummary } = analyzeDraw(
        draw,
        draws
      );
      const [articles, systems] = await Promise.all([
        fetchArticlesForMatches(matches, draw.drawNumber, product),
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
        sport: draw.sport?.name ?? defaultSport,
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
