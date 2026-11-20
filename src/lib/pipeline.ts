import { analyzeDraw } from "./analyze";
import { fetchArticlesForMatches } from "./articles";
import { generateMaltipsetSystems, generateSystems } from "./systems";
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

function defaultSport(product: ProductKind): string {
  if (product === "powerplay") return "Ishockey";
  return "Fotboll";
}

export async function buildAllDrawBundles(
  product: ProductKind = "powerplay"
): Promise<DrawBundle[]> {
  const draws = (await fetchDrawsForProduct(product)).filter((d) =>
    isStillOpen(d.regCloseTime)
  );

  const bundles = await Promise.all(
    draws.map(async (draw) => {
      try {
        const {
          matches,
          fatigueAlerts,
          tableAlerts,
          restAlerts,
          goalAlerts,
          lineupAlerts,
          malTip,
          leagueSummary,
        } = await analyzeDraw(draw, draws, product);
        const rowPrice = parseRowPrice(draw.rowPrice);
        const [articles, systems] = await Promise.all([
          fetchArticlesForMatches(matches, draw.drawNumber, product).catch(
            () => []
          ),
          Promise.resolve(
            product === "maltipset"
              ? generateMaltipsetSystems(matches, rowPrice)
              : generateSystems(matches)
          ),
        ]);

        return {
          drawNumber: draw.drawNumber,
          productName: draw.productName,
          productKind: product,
          closeDescription: draw.regCloseDescription,
          closeTime: draw.regCloseTime,
          openTime: draw.regOpenTime,
          rowPrice,
          netSale: draw.currentNetSale ?? null,
          sport: draw.sport?.name ?? defaultSport(product),
          leagueSummary,
          matches,
          articles,
          systems,
          fatigueAlerts: fatigueAlerts ?? [],
          tableAlerts: tableAlerts ?? [],
          restAlerts: restAlerts ?? [],
          goalAlerts: goalAlerts ?? [],
          lineupAlerts: lineupAlerts ?? [],
          malTip: malTip ?? [],
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
