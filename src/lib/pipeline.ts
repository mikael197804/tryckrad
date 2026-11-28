import { analyzeDraw } from "./analyze";
import { fetchArticlesForMatches } from "./articles";
import { loadLearningMemory } from "./learning";
import {
  applyExpertTipsToMatches,
  fetchPoolExpertTips,
} from "./poolTips";
import { rememberDaily192 } from "./pp192History";
import { generateMaltipsetSystems, generateSystems } from "./systems";
import {
  drawApiSlug,
  fetchDrawsForProduct,
  type ProductKind,
} from "./svenskaspel";
import type { DrawBundle } from "./types";

function parseRowPrice(value: string): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const RESULT_KEEP_MS = 8 * 60 * 60 * 1000;

/**
 * Visa omgångar som fortfarande går att tippa, eller nyligen stängda
 * ("Spelas nu" / resultat 8 h) – t.ex. Powerplay Örebro–Frölunda.
 */
function shouldIncludeDraw(
  closeTime: string,
  drawState?: string,
  graceMs = 2 * 60 * 1000
): boolean {
  const close = new Date(closeTime).getTime();
  if (!Number.isFinite(close)) return false;
  const now = Date.now();
  const state = String(drawState || "");
  if (state === "Closed" || state === "Finalized") {
    return now - close <= RESULT_KEEP_MS;
  }
  // Open / okänd status
  return close + graceMs >= now;
}

function defaultSport(product: ProductKind): string {
  if (product === "powerplay") return "Ishockey";
  return "Fotboll";
}

export async function buildAllDrawBundles(
  product: ProductKind = "powerplay"
): Promise<DrawBundle[]> {
  const [draws, learning] = await Promise.all([
    fetchDrawsForProduct(product).then((d) =>
      d.filter((x) => shouldIncludeDraw(x.regCloseTime, x.drawState))
    ),
    loadLearningMemory(product),
  ]);

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
          valueAlerts,
          learningAlerts,
          safeWinners,
          malTip,
          leagueSummary,
        } = await analyzeDraw(draw, draws, product, learning);
        const rowPrice = parseRowPrice(draw.rowPrice);

        // Öppna tippsajter → konsensus-spikar innan system byggs
        let tippedMatches = matches;
        let expertTips: DrawBundle["expertTips"] = [];
        let expertTipAlerts: string[] = [];
        if (product !== "maltipset") {
          const expert = await fetchPoolExpertTips(product, matches).catch(
            () => null
          );
          if (expert) {
            expertTips = expert.consensus;
            expertTipAlerts = expert.summary;
            const applied = applyExpertTipsToMatches(
              matches,
              expert.consensus
            );
            tippedMatches = applied.matches;
            expertTipAlerts = [...expertTipAlerts, ...applied.alerts];
          }
        }

        const [articles, systems] = await Promise.all([
          fetchArticlesForMatches(
            tippedMatches,
            draw.drawNumber,
            product
          ).catch(() => []),
          Promise.resolve(
            product === "maltipset"
              ? generateMaltipsetSystems(tippedMatches, rowPrice)
              : generateSystems(tippedMatches, {
                  product,
                  netSale: draw.currentNetSale ?? null,
                  rowPrice,
                })
          ),
        ]);

        const bundle: DrawBundle = {
          drawNumber: draw.drawNumber,
          productName: draw.productName,
          productKind: product,
          apiSlug: drawApiSlug(draw),
          closeDescription: draw.regCloseDescription,
          closeTime: draw.regCloseTime,
          openTime: draw.regOpenTime,
          drawState: draw.drawState,
          rowPrice,
          netSale: draw.currentNetSale ?? null,
          sport: draw.sport?.name ?? defaultSport(product),
          leagueSummary,
          matches: tippedMatches,
          articles,
          systems,
          fatigueAlerts: fatigueAlerts ?? [],
          tableAlerts: tableAlerts ?? [],
          restAlerts: restAlerts ?? [],
          goalAlerts: goalAlerts ?? [],
          lineupAlerts: lineupAlerts ?? [],
          valueAlerts: valueAlerts ?? [],
          learningAlerts: learningAlerts ?? [],
          safeWinners: safeWinners ?? [],
          malTip: malTip ?? [],
          expertTips,
          expertTipAlerts,
        };
        return bundle;
      } catch (error) {
        console.error(
          `Hoppar omgång ${draw.drawNumber}:`,
          error instanceof Error ? error.message : error
        );
        return null;
      }
    })
  );

  const open = bundles
    .filter((b): b is DrawBundle => b != null && b.matches.length > 0)
    .sort((a, b) => {
      // Öppna (nästa tipp) först, sedan Closed (spelas/har spelats), sist finaliserade
      const rank = (d: DrawBundle) => {
        const s = String(d.drawState || "");
        if (s === "Closed") return 1;
        if (s === "Finalized") return 2;
        return 0; // Open / övrigt tippbart
      };
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime();
    });

  // Powerplay + Topptipset 192 kr sparas varje dag till resultat (8 h)
  if ((product === "powerplay" || product === "topptipset") && open.length) {
    await rememberDaily192(open).catch(() => null);
  }

  return open;
}
