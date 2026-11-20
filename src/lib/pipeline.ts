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

function isStillOpen(closeTime: string, graceMs = 2 * 60 * 1000): boolean {
  return new Date(closeTime).getTime() + graceMs >= Date.now();
}

export async function buildAllDrawBundles(
  product: ProductKind = "powerplay"
): Promise<DrawBundle[]> {
  const draws = (await fetchDrawsForProduct(product)).filter((d) =>
    isStillOpen(d.regCloseTime)
  );
  const defaultSport = product === "topptipset" ? "Fotboll" : "Ishockey";

  const bundles = await Promise.all(
    draws.map(async (draw) => {
      try {
        const {
          matches,
          fatigueAlerts,
          tableAlerts,
          restAlerts,
          goalAlerts,
          leagueSummary,
        } = await analyzeDraw(draw, draws);
        const [articles, systems] = await Promise.all([
          fetchArticlesForMatches(matches, draw.drawNumber, product).catch(
            () => []
          ),
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
          fatigueAlerts: fatigueAlerts ?? [],
          tableAlerts: tableAlerts ?? [],
          restAlerts: restAlerts ?? [],
          goalAlerts: goalAlerts ?? [],
        } satisfies DrawBundle;
      } catch (error) {
        console.error(
          `Hoppar omgång ${draw.drawNumber}:`,
          error instanceof Error ? error.message : error
        );
        return null;
      }
    })
  );

  return bundles
    .filter((b): b is DrawBundle => b != null && b.matches.length > 0)
    .sort(
      (a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime()
    );
}
