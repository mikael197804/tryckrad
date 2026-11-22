/**
 * Utjämnarpress – gemensam analys för alla tips.
 *
 * Tanken: om det blir 0–1 ska laget bakom känna att det är fel
 * och göra allt för att det ska bli minst 1–1.
 */

export type EqualizerLevel = "strong" | "medium" | "weak";

export type EqualizerAssessment = {
  level: EqualizerLevel;
  /** Intern poäng (högre = starkare jakt på 1–1). */
  score: number;
  /** En tydlig mening till UI/motivering. */
  headline: string;
  /** Stödjande punkter (favorit, BTTS, målhunger …). */
  points: string[];
  /** Varningar (parkering, svag utjämning …). */
  warnings: string[];
  /**
   * True när pressen räcker för spel som Över 1,5
   * (annars risk att 0–1 blir stående).
   */
  okForOver15: boolean;
};

export type EqualizerInput = {
  homeOdds: number | null;
  awayOdds: number | null;
  drawOdds?: number | null;
  bttsYes?: number | null;
  bttsNo?: number | null;
  homeOver05?: number | null;
  awayOver05?: number | null;
  under25?: number | null;
  homeAttackNeed?: "low" | "medium" | "high";
  awayAttackNeed?: "low" | "medium" | "high";
  homeName?: string;
  awayName?: string;
};

function fmt(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/**
 * Bedöm om laget som ligger under jagar utjämning till 1–1.
 */
export function assessEqualizerPressure(
  input: EqualizerInput
): EqualizerAssessment {
  const points: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  const homeO = input.homeOdds;
  const awayO = input.awayOdds;
  const homeLabel = input.homeName || "hemma";
  const awayLabel = input.awayName || "borta";

  if (homeO != null && awayO != null && homeO > 1 && awayO > 1) {
    const favIsHome = homeO <= awayO;
    const favOdds = favIsHome ? homeO : awayO;
    const dogOdds = favIsHome ? awayO : homeO;
    const favName = favIsHome ? homeLabel : awayLabel;

    if (favOdds <= 1.9) {
      score += 2;
      points.push(
        `${favName} favorit @ ${fmt(favOdds)} – 0–1 bakunder känns fel, jagar 1–1`
      );
    } else if (favOdds <= 2.25 && favIsHome) {
      score += 1;
      points.push(
        `${homeLabel} @ ${fmt(homeO)} – hemmapress jagar utjämning vid 0–1`
      );
    }

    if (
      homeO >= 2.05 &&
      homeO <= 3.2 &&
      awayO >= 2.05 &&
      awayO <= 3.2 &&
      Math.abs(homeO - awayO) <= 0.55
    ) {
      score += 1;
      points.push("jämnt oddsbyte – båda lagen tar 0–1 personligt och jagar 1–1");
    }

    if (
      dogOdds >= 4.2 &&
      input.under25 != null &&
      input.under25 <= 1.85 &&
      (input.bttsNo == null ||
        input.bttsYes == null ||
        input.bttsNo <= input.bttsYes)
    ) {
      score -= 3;
      warnings.push(
        `stor underdog @ ${fmt(dogOdds)} + kort Under 2,5 – risk 0–1 och parkering`
      );
    }
  }

  if (
    input.bttsYes != null &&
    input.bttsNo != null &&
    input.bttsYes > 1 &&
    input.bttsNo > 1
  ) {
    if (input.bttsNo < input.bttsYes * 0.95) {
      score -= 1;
      warnings.push(
        `BTTS Nej @ ${fmt(input.bttsNo)} favorit – högre risk att 0–1 blir stående`
      );
    } else if (input.bttsYes <= 1.7 && input.bttsYes < input.bttsNo * 0.9) {
      score += 2;
      points.push(
        `BTTS Ja @ ${fmt(input.bttsYes)} – laget bakom förväntas kunna göra 1–1`
      );
    } else if (input.bttsYes < input.bttsNo * 0.92) {
      score += 1;
      points.push(
        `BTTS Ja @ ${fmt(input.bttsYes)} – stöd för att båda kan göra mål`
      );
    }
  }

  if (
    input.homeOver05 != null &&
    input.awayOver05 != null &&
    input.homeOver05 > 1 &&
    input.awayOver05 > 1
  ) {
    if (input.homeOver05 <= 1.28 && input.awayOver05 <= 1.28) {
      score += 2;
      points.push(
        `båda lagen Ö0,5 korta (${fmt(input.homeOver05)} / ${fmt(
          input.awayOver05
        )}) – utjämning trolig`
      );
    } else if (input.homeOver05 >= 1.55 || input.awayOver05 >= 1.55) {
      score -= 1;
      warnings.push(
        "ett lag har lång Ö0,5 – risk att 0–1 blir stående utan utjämning"
      );
    }
  }

  // Tabell/målhunger från matchanalys (Powerplay/Topptips m.fl.)
  const highHome = input.homeAttackNeed === "high";
  const highAway = input.awayAttackNeed === "high";
  if (highHome && highAway) {
    score += 2;
    points.push(
      "båda lagen jagar mål – vid 0–1 kastar den bakomvarande framåt mot 1–1"
    );
  } else if (highHome || highAway) {
    score += 1;
    const who = highHome ? homeLabel : awayLabel;
    points.push(
      `${who} har hög målhunger – bakunderläge 0–1 ger jakt på utjämning`
    );
  }
  if (input.homeAttackNeed === "low" && input.awayAttackNeed === "low") {
    score -= 1;
    warnings.push(
      "båda lagen har låg målhunger – större risk att 0–1 får stå"
    );
  }

  let level: EqualizerLevel = "weak";
  if (score >= 4 && warnings.length === 0) level = "strong";
  else if (score >= 2 && warnings.length <= 1) level = "medium";
  else level = "weak";

  const okForOver15 = score >= 2 && !warnings.some((w) => /parkering/i.test(w));

  let headline: string;
  if (level === "strong") {
    headline =
      "Stark utjämnarpress: vid 0–1 ska laget bakom känna att det är fel och jaga 1–1";
  } else if (level === "medium") {
    headline =
      "Medel utjämnarpress: laget bakom har skäl att jaga 1–1 vid 0–1";
  } else if (warnings.length) {
    headline =
      "Svag utjämnarpress: risk att 0–1 blir stående utan jakt på 1–1";
  } else {
    headline =
      "Svag utjämnarpress: oklart att laget bakom jagar 1–1 vid 0–1";
  }

  return {
    level,
    score,
    headline,
    points: points.slice(0, 4),
    warnings: warnings.slice(0, 3),
    okForOver15,
  };
}

/** Kort rad till pickReason / Oddset-motivering. */
export function equalizerReasonLine(eq: EqualizerAssessment): string {
  const extra = eq.points[0] || eq.warnings[0];
  return extra ? `${eq.headline}. ${extra}` : eq.headline;
}
