import {
  assessEqualizerPressure,
  equalizerReasonLine,
  type EqualizerAssessment,
} from "./equalizerPressure";
import { upstreamFetchInit } from "./fetch-mode";
import {
  isMidUnderdogOdds,
  isSafeWinnerTwoOdds,
  VALUE_ODDS_INSIGHTS,
} from "./valueOdds";
import {
  importOddsetTips,
  listTrackedOddsetTips,
  ODDSET_TIP_RETENTION_HOURS,
  rememberOddsetTips,
  settleOddsetTips,
  type OddsetTrackedTip,
} from "./oddsetHistory";
import {
  importOddsetLessons,
  loadOddsetLearning,
  oddsetLearningAdjust,
  type OddsetLearningMemory,
  type OddsetLesson,
} from "./oddsetLearning";
import { overMarketValue } from "./valueOdds";

export type { OddsetTrackedTip } from "./oddsetHistory";
export type { OddsetLearningMemory, OddsetLesson } from "./oddsetLearning";
export type { EqualizerAssessment } from "./equalizerPressure";
export type OddsetMarket = "over_1_5" | "over_2_5" | "1x2";
export type Oddset1x2Pick = "1" | "X" | "2";

export type RivalryInfo = {
  level: "none" | "possible" | "likely";
  note: string;
};

export type RedCardInfo = {
  level: "low" | "medium" | "high";
  probabilityPct: number | null;
  oddsYes: number | null;
  totalCardsLine: number | null;
  totalCardsOverOdds: number | null;
  note: string;
};

export type OddsetCandidate = {
  eventId: number;
  home: string;
  away: string;
  league: string;
  country: string;
  kickoff: string;
  market: OddsetMarket;
  line: 1.5 | 2.5 | null;
  /** 1X2-utgång när market === "1x2". */
  pick1x2?: Oddset1x2Pick | null;
  odds: number;
  odds15: number | null;
  odds25: number | null;
  odds35: number | null;
  under15?: number | null;
  homeOdds?: number | null;
  awayOdds?: number | null;
  drawOdds?: number | null;
  /**
   * Över 1,5: modell-p för ≥2 mål.
   * 1X2: konfidens (%) för tippad utgång.
   */
  over25ProbPct: number;
  expectedGoals: number | null;
  rivalry: RivalryInfo;
  redCard: RedCardInfo;
  /** Utjämnarpress – samma analys som övriga tips (jakt på 1–1 vid 0–1). */
  equalizer?: EqualizerAssessment;
  score: number;
  reason: string;
  url: string;
  /** Lärdomar som påverkat just detta tips. */
  learningNotes?: string[];
};

export type OddsetDayTip = {
  playDate: string;
  playDateLabel: string;
  generatedAt: string;
  /** Upp till 5 Över 1,5-tips. */
  selected: OddsetCandidate[];
  candidates: OddsetCandidate[];
  /** Upp till 5 1X2-tips med samma analysram. */
  selected1x2: OddsetCandidate[];
  candidates1x2: OddsetCandidate[];
  /** Tips som sparats senaste 4 h, med grönt/rött när resultatet är klart. */
  tracked: OddsetTrackedTip[];
  retentionHours: number;
  analyzedCount: number;
  eligibleCount: number;
  eligible1x2Count: number;
  picksPerDay: number;
  rules: string[];
  disclaimer: string;
  /** Efteranalys + aspekter till nästa tips (uppdateras automatiskt). */
  learning: {
    updatedAt: string;
    summary: string[];
    biasesNote: string;
    lessons: OddsetLesson[];
  };
};

const PICKS_PER_DAY = 5;

const KAMBI_BASE =
  "https://eu.offering-api.kambicdn.com/offering/v2018/svenskaspel";

const STOCKHOLM = "Europe/Stockholm";

/** Oddset-linje: Över 1,5 (vinst vid ≥2 mål). */
export const ODDSET_GOAL_LINE = 1.5;
export const ODDSET_MIN_GOALS_TO_WIN = 2;
/**
 * Visa bara matcher där modellen tror Över 1,5 är sannolikt.
 * Högt golv: Ö1,5-matcher blir ofta 0–0 / 1 mål utan extra stege-check.
 */
const MIN_OVER15_PROB = 0.7;
/** Minsta xG innan Ö1,5 får tippas (annars 0–1-fälla). */
const MIN_LAMBDA_FOR_OVER15 = 2.2;
/** Max tillåten Poisson-sannolikhet för ≤1 mål. */
const MAX_P01_PCT = 32;

type KambiEvent = {
  id: number;
  name: string;
  homeName?: string;
  awayName?: string;
  start: string;
  group?: string;
  path?: Array<{ name?: string; englishName?: string; termKey?: string }>;
};

type KambiOutcome = {
  label?: string;
  odds?: number;
  line?: number;
};

type KambiBetOffer = {
  eventId?: number;
  criterion?: { label?: string; englishLabel?: string };
  betOfferType?: { id?: number; englishName?: string };
  outcomes?: KambiOutcome[];
};

type MatchMarkets = {
  odds15: number | null;
  odds25: number | null;
  odds35: number | null;
  /** Över 4,5 – signal för riktigt målrik match. */
  odds45: number | null;
  under15: number | null;
  under25: number | null;
  /** Båda lagen gör mål – Ja. */
  bttsYes: number | null;
  /** Båda lagen gör mål – Nej (lågmålssignal). */
  bttsNo: number | null;
  /** 1X2 hemma / borta / kryss. */
  homeOdds: number | null;
  awayOdds: number | null;
  /** 1X2-kryss (kort X + låg målbild ≈ 0–0-risk). */
  drawOdds: number | null;
  /** Lagets Över 0,5 – kort odds ≈ laget förväntas göra mål (utjämnarpress). */
  homeOver05: number | null;
  awayOver05: number | null;
  redCardYes: number | null;
  redCardNo: number | null;
  totalCardsOver: { line: number; odds: number } | null;
};

function stockholmDateIso(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCKHOLM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Dagens svenska kalenderdag (öppna Oddset-spel nu). */
export function todaySwedishPlayDate(now = new Date()): {
  isoDate: string;
  label: string;
} {
  const isoDate = stockholmDateIso(now);
  const label = new Intl.DateTimeFormat("sv-SE", {
    timeZone: STOCKHOLM,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  return { isoDate, label };
}

/** Morgondagens svenska kalenderdag (fallback om få öppna matcher idag). */
export function nextSwedishPlayDate(now = new Date()): {
  isoDate: string;
  label: string;
} {
  const today = stockholmDateIso(now);
  let probe = new Date(now.getTime());
  let isoDate = today;
  for (let i = 0; i < 50; i++) {
    probe = new Date(probe.getTime() + 60 * 60 * 1000);
    isoDate = stockholmDateIso(probe);
    if (isoDate !== today) break;
  }

  const label = new Intl.DateTimeFormat("sv-SE", {
    timeZone: STOCKHOLM,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(probe);

  return { isoDate, label };
}

async function kambiFetch(path: string, tries = 4): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(
        `${KAMBI_BASE}${path}`,
        upstreamFetchInit({
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (compatible; MikaelsTips/1.0; +https://tryckrad.vercel.app)",
            Origin: "https://www.svenskaspel.se",
            Referer: "https://www.svenskaspel.se/oddset/fotboll",
          },
          next: { revalidate: 120 },
        })
      );
      if (res.status === 410 || res.status === 429 || res.status >= 500) {
        last = new Error(`Kambi ${res.status}`);
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Kambi ${res.status} för ${path}`);
      return res.json();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("Kambi-fel");
}

function parseOdds(raw?: number): number | null {
  if (raw == null || raw <= 0) return null;
  return Math.round((raw / 1000) * 1000) / 1000;
}

function parseLine(raw?: number): number | null {
  if (raw == null) return null;
  return Math.round((raw / 1000) * 10) / 10;
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonCdfAtLeast(lambda: number, minGoals: number): number {
  if (lambda <= 0) return 0;
  let pLess = 0;
  for (let k = 0; k < minGoals; k++) {
    pLess += (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  }
  return Math.max(0, Math.min(1, 1 - pLess));
}

function poissonPExact(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

type OpenGameCheck = {
  ok: boolean;
  p01Pct: number | null;
  green: string[];
  red: string[];
  equalizer: EqualizerAssessment;
};

/**
 * Extra läsning runt matchen för Över 1,5:
 * Ö1,5-odds ensamt räcker inte – många “billiga” Ö1,5 blir 0–0 eller 1–0.
 * Kräver Ö/U-stege + öppet-spel-signaler (xG, Under 2,5, BTTS, kryss)
 * + utjämnarpress: vid 0–1 ska laget bakom känna att det är fel och jaga 1–1.
 */
function assessOpenGameForOver15(args: {
  odds15: number;
  under15: number | null;
  odds25: number | null;
  under25: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
  homeOdds: number | null;
  awayOdds: number | null;
  drawOdds: number | null;
  homeOver05: number | null;
  awayOver05: number | null;
  homeName?: string;
  awayName?: string;
  lambda: number | null;
  p15: number;
}): OpenGameCheck {
  const green: string[] = [];
  const red: string[] = [];
  let p01Pct: number | null = null;
  let fatal = false;

  const hasLadder =
    (args.under15 != null && args.under15 > 1) ||
    (args.odds25 != null &&
      args.odds25 > 1 &&
      args.under25 != null &&
      args.under25 > 1);
  if (!hasLadder) {
    red.push("saknar Ö/U-stege – kan inte utesluta 0–0/1-mål");
    return {
      ok: false,
      p01Pct,
      green,
      red,
      equalizer: assessEqualizerPressure({
        homeOdds: args.homeOdds,
        awayOdds: args.awayOdds,
        bttsYes: args.bttsYes,
        bttsNo: args.bttsNo,
        homeOver05: args.homeOver05,
        awayOver05: args.awayOver05,
        under25: args.under25,
      }),
    };
  }

  if (args.lambda != null) {
    const p0 = poissonPExact(args.lambda, 0);
    const p1 = poissonPExact(args.lambda, 1);
    p01Pct = Math.round((p0 + p1) * 1000) / 10;
    if (args.lambda < MIN_LAMBDA_FOR_OVER15) {
      red.push(
        `xG≈${args.lambda.toFixed(2).replace(".", ",")} för lågt (0–1-mål-risk)`
      );
      fatal = true;
    } else if (args.lambda >= 2.55) {
      green.push(
        `xG≈${args.lambda.toFixed(2).replace(".", ",")} stödjer öppet spel`
      );
    }

    if (p01Pct >= MAX_P01_PCT) {
      red.push(
        `Poisson P(≤1 mål) ≈ ${p01Pct.toFixed(0)}% – klassisk 0–0/1-0-fälla`
      );
      fatal = true;
    } else if (p01Pct <= 26) {
      green.push(`P(≤1 mål) ≈ ${p01Pct.toFixed(0)}% – låg lågmålsrisk`);
    }
  } else {
    red.push("kunde inte uppskatta xG från oddsstegen");
    fatal = true;
  }

  if (args.under15 != null && args.under15 > 1) {
    const a = 1 / args.odds15;
    const b = 1 / args.under15;
    const pUnder15 = b / (a + b);
    if (pUnder15 >= 0.36) {
      red.push(
        `marknad ger Under 1,5 ~${Math.round(pUnder15 * 100)}% – undvik`
      );
      fatal = true;
    } else if (args.under15 >= 3.1) {
      green.push(
        `Under 1,5 @ ${args.under15.toFixed(2).replace(".", ",")} – marknaden tror på mål`
      );
    }
  }

  if (args.under25 != null && args.odds25 != null) {
    if (args.under25 <= 1.68 && args.odds25 >= 2.05) {
      red.push(
        `Under 2,5 @ ${args.under25.toFixed(2).replace(".", ",")} / Ö2,5 @ ${args.odds25
          .toFixed(2)
          .replace(".", ",")} – lågmålsprofil`
      );
      fatal = true;
    } else if (args.odds25 <= 1.82 && args.under25 >= 1.9) {
      green.push(
        `Ö2,5 @ ${args.odds25.toFixed(2).replace(".", ",")} stödjer mer än ett mål`
      );
    } else if (args.under25 <= 1.72) {
      red.push(
        `kort Under 2,5 @ ${args.under25.toFixed(2).replace(".", ",")} – ofta 0–1 mål`
      );
    }
  }

  if (args.bttsYes != null && args.bttsNo != null) {
    if (args.bttsNo < args.bttsYes * 0.95) {
      red.push(
        `BTTS Nej @ ${args.bttsNo.toFixed(2).replace(".", ",")} favorit – 0–0/1–0-risk`
      );
    }
    // Positiv BTTS räknas under utjämnarpress längre ner (jakt på 1–1).
  }

  if (args.drawOdds != null) {
    const lowGoals =
      (args.under25 != null && args.under25 <= 1.85) ||
      (args.lambda != null && args.lambda < 2.45);
    if (args.drawOdds <= 2.95 && lowGoals) {
      red.push(
        `kort kryss @ ${args.drawOdds.toFixed(2).replace(".", ",")} + låg målbild`
      );
    } else if (args.drawOdds >= 3.5) {
      green.push(
        `kryss @ ${args.drawOdds.toFixed(2).replace(".", ",")} – mindre 0–0-favorit`
      );
    }
  }

  if (
    args.odds15 >= 1.4 &&
    args.under25 != null &&
    args.under25 <= 1.7
  ) {
    red.push(
      `Ö1,5 @ ${args.odds15.toFixed(2).replace(".", ",")} men Under 2,5 kort – ofta exakt 1 mål`
    );
    fatal = true;
  }

  if (args.p15 >= 0.78) {
    green.push(`modell ${Math.round(args.p15 * 100)}% på ≥2 mål`);
  } else if (args.p15 < MIN_OVER15_PROB) {
    red.push(`modell bara ${Math.round(args.p15 * 100)}% – för tunt`);
    fatal = true;
  }

  // --- Utjämnarpress (samma modul som Powerplay/Topptips/Måltipset) ---
  const equalizer = assessEqualizerPressure({
    homeOdds: args.homeOdds,
    awayOdds: args.awayOdds,
    drawOdds: args.drawOdds,
    bttsYes: args.bttsYes,
    bttsNo: args.bttsNo,
    homeOver05: args.homeOver05,
    awayOver05: args.awayOver05,
    under25: args.under25,
    homeName: args.homeName,
    awayName: args.awayName,
  });
  for (const p of equalizer.points) green.push(p);
  for (const w of equalizer.warnings) red.push(w);
  if (!equalizer.okForOver15 || equalizer.level === "weak") {
    red.push(equalizer.headline);
    fatal = true;
  }

  // Minst två positiva signaler och inga fatala lågmålsflaggor.
  // En mild röd tillåts bara om det finns tydligt överskott av gröna.
  const ok =
    !fatal &&
    green.length >= 2 &&
    equalizer.okForOver15 &&
    (red.length === 0 || (red.length === 1 && green.length >= 4));

  if (!ok && !fatal && green.length < 2) {
    red.push("för få öppet-spel-signaler runt matchen");
  }

  return { ok, p01Pct, green, red, equalizer };
}

/** Uppskatta λ (förväntade mål) från Ö/U-stegen. */
function estimateExpectedGoals(
  odds15: number | null,
  odds25: number | null,
  odds35: number | null,
  under15: number | null,
  under25: number | null,
  odds45: number | null = null
): number | null {
  const points: Array<{ line: number; pOver: number }> = [];

  const add = (line: number, over: number | null, under: number | null) => {
    if (over == null || over <= 1) return;
    let pOver = 1 / over;
    if (under != null && under > 1) {
      const invOver = 1 / over;
      const invUnder = 1 / under;
      const sum = invOver + invUnder;
      if (sum > 0) pOver = invOver / sum;
    }
    points.push({ line, pOver });
  };

  add(1.5, odds15, under15);
  add(2.5, odds25, under25);
  add(3.5, odds35, null);
  add(4.5, odds45, null);

  if (!points.length) return null;

  // Sök λ som bäst matchar P(X > line) ≈ poisson
  let bestL = 2.5;
  let bestErr = Infinity;
  for (let l = 1.2; l <= 5.5; l += 0.05) {
    let err = 0;
    for (const p of points) {
      const model = poissonCdfAtLeast(l, Math.floor(p.line) + 1);
      err += (model - p.pOver) ** 2;
    }
    if (err < bestErr) {
      bestErr = err;
      bestL = l;
    }
  }
  return Math.round(bestL * 100) / 100;
}

/**
 * Notis när matchen ser ut att kunna gå över 4,5 mål –
 * samma stil som övriga reason-rader i Oddset-tipsen.
 */
function over45GoalsNotice(
  lambda: number | null,
  odds45: number | null
): string | null {
  const pOver45 =
    lambda != null ? poissonCdfAtLeast(lambda, 5) : null; // ≥5 mål = över 4,5
  const marketSaysHigh = odds45 != null && odds45 > 1 && odds45 <= 2.25;
  const modelSaysHigh =
    (lambda != null && lambda >= 4.5) ||
    (pOver45 != null && pOver45 >= 0.42);

  if (!marketSaysHigh && !modelSaysHigh) return null;

  const parts: string[] = [
    "Notis: hög målförväntan – matchen kan gå över 4,5 mål",
  ];
  if (lambda != null) {
    parts.push(`xG≈${lambda.toFixed(2).replace(".", ",")}`);
  }
  if (pOver45 != null) {
    parts.push(
      `P(≥5 mål)≈${Math.round(pOver45 * 100)}%`
    );
  }
  if (odds45 != null && odds45 > 1) {
    parts.push(`Ö4,5 @ ${odds45.toFixed(2).replace(".", ",")}`);
  }
  return parts.join(" · ");
}

/** P(totalt mål ≥ 2) = Över 1,5. */
function estimateOver15Probability(
  lambda: number | null,
  odds15: number | null,
  under15: number | null
): number | null {
  const fromPoisson =
    lambda != null ? poissonCdfAtLeast(lambda, 2) : null;

  let fromOdds: number | null = null;
  if (odds15 != null && odds15 > 1) {
    if (under15 != null && under15 > 1) {
      const a = 1 / odds15;
      const b = 1 / under15;
      fromOdds = a / (a + b);
    } else {
      // grov de-vig ~3%
      fromOdds = Math.min(0.95, (1 / odds15) * 1.03);
    }
  }

  if (fromPoisson == null && fromOdds == null) return null;
  if (fromPoisson == null) return fromOdds;
  if (fromOdds == null) return fromPoisson;
  return fromPoisson * 0.65 + fromOdds * 0.35;
}

function extractMarkets(
  betOffers: KambiBetOffer[],
  homeName?: string,
  awayName?: string
): MatchMarkets {
  let odds15: number | null = null;
  let odds25: number | null = null;
  let odds35: number | null = null;
  let odds45: number | null = null;
  let under15: number | null = null;
  let under25: number | null = null;
  let bttsYes: number | null = null;
  let bttsNo: number | null = null;
  let homeOdds: number | null = null;
  let awayOdds: number | null = null;
  let drawOdds: number | null = null;
  let homeOver05: number | null = null;
  let awayOver05: number | null = null;
  let redCardYes: number | null = null;
  let redCardNo: number | null = null;
  let totalCardsOver: { line: number; odds: number } | null = null;

  const homeN = homeName ? normalizeName(homeName) : "";
  const awayN = awayName ? normalizeName(awayName) : "";

  for (const bo of betOffers) {
    const label = bo.criterion?.englishLabel || bo.criterion?.label || "";

    if (label === "Total Goals" || label === "Antal mål") {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const line = parseLine(o.line);
        const odds = parseOdds(o.odds);
        if (odds == null || line == null) continue;
        if (side === "över" || side === "over") {
          if (line === 1.5) odds15 = odds;
          if (line === 2.5) odds25 = odds;
          if (line === 3.5) odds35 = odds;
          if (line === 4.5) odds45 = odds;
        }
        if (side === "under") {
          if (line === 1.5) under15 = odds;
          if (line === 2.5) under25 = odds;
        }
      }
    }

    if (
      label === "Both Teams To Score" ||
      label === "Båda lagen gör mål"
    ) {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const odds = parseOdds(o.odds);
        if (odds == null) continue;
        if (side === "ja" || side === "yes") bttsYes = odds;
        if (side === "nej" || side === "no") bttsNo = odds;
      }
    }

    if (label === "Full Time" || label === "Match Odds" || label === "Matchodds") {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const odds = parseOdds(o.odds);
        if (odds == null) continue;
        if (side === "1" || side === "home") homeOdds = odds;
        if (side === "2" || side === "away") awayOdds = odds;
        if (side === "x" || side === "draw") drawOdds = odds;
      }
    }

    // Lagets antal mål – Över 0,5 signalerar att laget förväntas kunna göra mål
    if (
      /^Total Goals by /i.test(label) ||
      /^Antal mål (av|för) /i.test(label)
    ) {
      const teamRaw = label
        .replace(/^Total Goals by /i, "")
        .replace(/^Antal mål (av|för) /i, "");
      const teamN = normalizeName(teamRaw);
      const isHome =
        homeN &&
        (teamN.includes(homeN) ||
          homeN.includes(teamN) ||
          teamNameScoreLoose(homeN, teamN) >= 0.72);
      const isAway =
        awayN &&
        (teamN.includes(awayN) ||
          awayN.includes(teamN) ||
          teamNameScoreLoose(awayN, teamN) >= 0.72);
      if (!isHome && !isAway) {
        // fallthrough – namn matchade inte
      } else {
        for (const o of bo.outcomes || []) {
          const side = (o.label || "").toLowerCase();
          const line = parseLine(o.line);
          const odds = parseOdds(o.odds);
          if (odds == null || line == null) continue;
          if (line !== 0.5) continue;
          if (side !== "över" && side !== "over") continue;
          if (isHome) homeOver05 = odds;
          if (isAway) awayOver05 = odds;
        }
      }
    }

    if (label === "Red Card given" || label === "Rött kort i matchen") {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const odds = parseOdds(o.odds);
        if (odds == null) continue;
        if (side === "ja" || side === "yes") redCardYes = odds;
        if (side === "nej" || side === "no") redCardNo = odds;
      }
    }

    if (label === "Total Cards" || label === "Antal kort") {
      for (const o of bo.outcomes || []) {
        const side = (o.label || "").toLowerCase();
        const line = parseLine(o.line);
        const odds = parseOdds(o.odds);
        if (odds == null || line == null) continue;
        if (side !== "över" && side !== "over") continue;
        // Prefer main line around 3.5–4.5
        if (
          !totalCardsOver ||
          Math.abs(line - 4) < Math.abs(totalCardsOver.line - 4)
        ) {
          totalCardsOver = { line, odds };
        }
      }
    }
  }

  return {
    odds15,
    odds25,
    odds35,
    odds45,
    under15,
    under25,
    bttsYes,
    bttsNo,
    homeOdds,
    awayOdds,
    drawOdds,
    homeOver05,
    awayOver05,
    redCardYes,
    redCardNo,
    totalCardsOver,
  };
}

/** Enkel namnlikhet för att koppla “Total Goals by X” till hemma/borta. */
function teamNameScoreLoose(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(" ").filter((t) => t.length > 2));
  const tb = new Set(b.split(" ").filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits / Math.min(ta.size, tb.size);
}

function eventUrl(eventId: number): string {
  return `https://www.svenskaspel.se/oddset/event/${eventId}`;
}

function countryOf(event: KambiEvent): string {
  return event.path?.[1]?.name || event.path?.[1]?.englishName || "";
}

function isSeniorMensMatch(event: KambiEvent): boolean {
  const blob = [
    event.name,
    event.homeName,
    event.awayName,
    event.group,
    ...(event.path || []).map((p) => p.name || p.englishName || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    /\(d\)|\(w\)|women|woman|dames|damer|dam |female|u18|u19|u20|u21|u23|youth|ungdom|reserves| reserve|junior|academy|amateur|\(mani\)|\(sena\)/.test(
      blob
    )
  ) {
    return false;
  }
  return true;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Kända derbyn / rivalpar (normaliserade namnfragment). */
const RIVALRY_PAIRS: Array<[string, string, string]> = [
  ["sevilla", "betis", "Sevilla-derby"],
  ["real madrid", "barcelona", "El Clásico"],
  ["atletico", "real madrid", "Madrid-derby"],
  ["inter", "milan", "Milano-derby"],
  ["juventus", "torino", "Derby della Mole"],
  ["roma", "lazio", "Rom-derby"],
  ["liverpool", "everton", "Merseyside-derby"],
  ["manchester united", "manchester city", "Manchester-derby"],
  ["arsenal", "tottenham", "North London-derby"],
  ["celtic", "rangers", "Old Firm"],
  ["ajax", "feyenoord", "De Klassieker"],
  ["benfica", "porto", "O Clássico"],
  ["galatasaray", "fenerbahce", "Istanbul-derby"],
  ["boca", "river", "Superclásico"],
  ["flamengo", "fluminense", "Fla-Flu"],
  ["aik", "djurgarden", "Stockholmsderby"],
  ["aik", "hammarby", "Stockholmsderby"],
  ["hammarby", "djurgarden", "Stockholmsderby"],
  ["ifk goteborg", "malmo", "Klassikermöte"],
  ["porto", "sporting", "Lisboa-rivalitet"],
  ["olympiacos", "panathinaikos", "Athensderby"],
  ["celtic", "hearts", "Skotsk rivalitet"],
];

function analyzeRivalry(home: string, away: string, league: string): RivalryInfo {
  const h = normalizeName(home);
  const a = normalizeName(away);

  for (const [x, y, label] of RIVALRY_PAIRS) {
    const hit =
      (h.includes(x) && a.includes(y)) || (h.includes(y) && a.includes(x));
    if (hit) {
      return {
        level: "likely",
        note: `${label} – hög rivalitet, ofta hetsigare matchbild`,
      };
    }
  }

  // Samma stadsnamn i båda lagnamnen
  const cityHints = [
    "madrid",
    "milan",
    "manchester",
    "london",
    "glasgow",
    "lisboa",
    "lisbon",
    "stockholm",
    "goteborg",
    "malmo",
    "roma",
    "rome",
    "istanbul",
    "athens",
    "athen",
  ];
  for (const city of cityHints) {
    if (h.includes(city) && a.includes(city)) {
      return {
        level: "possible",
        note: `Möjligt lokalderby (${city})`,
      };
    }
  }

  if (/derby|klassiker|clásico|clasico/i.test(league)) {
    return { level: "possible", note: "Ligans derby-/klassikerprofil" };
  }

  return { level: "none", note: "Ingen tydlig derby-/bråksignal" };
}

function analyzeRedCard(
  markets: MatchMarkets,
  rivalry: RivalryInfo
): RedCardInfo {
  const notes: string[] = [];
  let level: RedCardInfo["level"] = "low";
  let probabilityPct: number | null = null;

  if (markets.redCardYes != null && markets.redCardYes > 1) {
    if (markets.redCardNo != null && markets.redCardNo > 1) {
      const y = 1 / markets.redCardYes;
      const n = 1 / markets.redCardNo;
      probabilityPct = Math.round((100 * y) / (y + n));
    } else {
      probabilityPct = Math.round(Math.min(90, (100 / markets.redCardYes) * 1.05));
    }
    notes.push(
      `Marknad rött kort Ja @ ${markets.redCardYes.toFixed(2).replace(".", ",")} (~${probabilityPct}%)`
    );
  }

  if (markets.totalCardsOver) {
    notes.push(
      `Kort Över ${markets.totalCardsOver.line.toFixed(1).replace(".", ",")} @ ${markets.totalCardsOver.odds.toFixed(2).replace(".", ",")}`
    );
    // Kort över 4.5 till lågt odds ≈ fysiskt
    if (
      markets.totalCardsOver.line >= 4 &&
      markets.totalCardsOver.odds <= 1.85
    ) {
      level = "medium";
      notes.push("hög kortlinje tyder på fysisk match");
    }
  }

  if (probabilityPct != null) {
    if (probabilityPct >= 32) level = "high";
    else if (probabilityPct >= 22) level = level === "low" ? "medium" : level;
  }

  if (rivalry.level === "likely") {
    if (level === "low") level = "medium";
    else if (level === "medium") level = "high";
    notes.push("rivalitet höjer risken för heta situationer/rött kort");
  } else if (rivalry.level === "possible" && level === "low") {
    level = "medium";
    notes.push("möjlig lokal rivalitet kan ge kort");
  }

  return {
    level,
    probabilityPct,
    oddsYes: markets.redCardYes,
    totalCardsLine: markets.totalCardsOver?.line ?? null,
    totalCardsOverOdds: markets.totalCardsOver?.odds ?? null,
    note: notes.join(" · ") || "ingen tydlig rött-kort-signal",
  };
}

function buildCandidate(
  event: KambiEvent,
  markets: MatchMarkets
): OddsetCandidate | null {
  const home = event.homeName || event.name.split(" - ")[0] || event.name;
  const away =
    event.awayName || event.name.split(" - ").slice(1).join(" - ") || "";
  const league = event.group || "";
  const country = countryOf(event);

  if (markets.odds15 == null || markets.odds15 <= 1) return null;
  // För öppna spel: undvik nästan avgjorda/live-lika korta Över-odds
  if (markets.odds15 < 1.12) return null;
  // För “mjuka” Ö1,5 (≥1,48) krävs ännu tydligare öppet spel – annars 1-målsmatcher
  if (markets.odds15 > 1.55) return null;

  const lambda = estimateExpectedGoals(
    markets.odds15,
    markets.odds25,
    markets.odds35,
    markets.under15,
    markets.under25,
    markets.odds45
  );
  const p15 = estimateOver15Probability(
    lambda,
    markets.odds15,
    markets.under15
  );
  if (p15 == null || p15 < MIN_OVER15_PROB) return null;

  const openCheck = assessOpenGameForOver15({
    odds15: markets.odds15,
    under15: markets.under15,
    odds25: markets.odds25,
    under25: markets.under25,
    bttsYes: markets.bttsYes,
    bttsNo: markets.bttsNo,
    homeOdds: markets.homeOdds,
    awayOdds: markets.awayOdds,
    drawOdds: markets.drawOdds,
    homeOver05: markets.homeOver05,
    awayOver05: markets.awayOver05,
    homeName: home,
    awayName: away,
    lambda,
    p15,
  });
  if (!openCheck.ok) return null;

  const rivalry = analyzeRivalry(home, away, league);
  const redCard = analyzeRedCard(markets, rivalry);

  const over25ProbPct = Math.round(p15 * 1000) / 10;
  const equalizer = openCheck.equalizer;
  const reasons: string[] = [];
  reasons.push(equalizerReasonLine(equalizer));
  reasons.push(
    `Modell: ${over25ProbPct.toFixed(1).replace(".", ",")}% chans till minst 2 mål`
  );
  if (openCheck.p01Pct != null) {
    reasons.push(
      `lågmålskontroll: P(≤1 mål) ≈ ${openCheck.p01Pct
        .toFixed(0)
        .replace(".", ",")}%`
    );
  }
  if (lambda != null) {
    reasons.push(`förväntade mål ≈ ${lambda.toFixed(2).replace(".", ",")}`);
  }
  const over45Note = over45GoalsNotice(lambda, markets.odds45);
  if (over45Note) reasons.push(over45Note);
  reasons.push(
    `Över 1,5 @ ${markets.odds15.toFixed(2).replace(".", ",")}`
  );
  if (markets.odds25 != null) {
    reasons.push(`Ö2,5 @ ${markets.odds25.toFixed(2).replace(".", ",")}`);
  }
  if (markets.under25 != null) {
    reasons.push(
      `U2,5 @ ${markets.under25.toFixed(2).replace(".", ",")}`
    );
  }
  if (markets.bttsYes != null) {
    reasons.push(
      `BTTS Ja @ ${markets.bttsYes.toFixed(2).replace(".", ",")}`
    );
  }
  for (const g of equalizer.points.slice(0, 2)) {
    if (!reasons.includes(g)) reasons.push(g);
  }
  if (rivalry.level !== "none") reasons.push(rivalry.note);
  if (redCard.level !== "low") reasons.push(`rött kort: ${redCard.note}`);

  // Score: sannolikhet först, sedan liga, öppet-spel, rivalitet/kort
  let score = over25ProbPct * 1.2;
  if (lambda != null) score += Math.min(14, (lambda - 2.0) * 10);
  if (openCheck.p01Pct != null) {
    score += Math.max(0, (28 - openCheck.p01Pct) * 0.6);
  }
  score += equalizer.score * 4;
  score += openCheck.green.length * 2;
  score -= openCheck.red.length * 6;

  const topCountry =
    /england|spanien|spain|italien|italy|tyskland|germany|frankrike|france|nederländerna|netherlands|portugal|sverige|sweden|skottland|scotland/i.test(
      country
    );
  if (
    topCountry &&
    /premier league|la liga|serie a|bundesliga|ligue 1|championship|eredivisie|primeira|allsvenskan|liga portugal/i.test(
      league
    )
  ) {
    score += 6;
  }

  // Liten bonus för derby (underhållning/hets) men inte krav
  if (rivalry.level === "likely") score += 2;
  if (redCard.level === "high") score += 1;

  // Preferera rimliga Över 1,5-odds (ca 1,22–1,40) – inte ultrakorta och inte mjuka
  score += Math.max(0, 14 - Math.abs(markets.odds15 - 1.3) * 12);

  // Överodds/värde: modellens p högre än oddsimplicit
  const ov = overMarketValue({
    overOdds: markets.odds15,
    modelProb: p15,
  });
  if (ov.isValue) {
    score += 8;
    if (ov.note) reasons.push(ov.note);
  } else if (ov.edgePct != null && ov.edgePct < -5) {
    score -= 4;
    if (ov.note) reasons.push(ov.note);
  }

  return {
    eventId: event.id,
    home,
    away,
    league,
    country,
    kickoff: event.start,
    market: "over_1_5",
    line: 1.5,
    odds: markets.odds15,
    odds15: markets.odds15,
    odds25: markets.odds25,
    odds35: markets.odds35,
    under15: markets.under15,
    over25ProbPct,
    expectedGoals: lambda,
    rivalry,
    redCard,
    equalizer,
    homeOdds: markets.homeOdds,
    awayOdds: markets.awayOdds,
    drawOdds: markets.drawOdds,
    pick1x2: null,
    score,
    reason: reasons.join(". "),
    url: eventUrl(event.id),
  };
}

/**
 * Oddset 1X2 med samma analysram: utjämnarpress, rivalitet, rött kort,
 * mittfält-underdog / säker vinnare 2 @ ca 2,00.
 */
function build1x2Candidate(
  event: KambiEvent,
  markets: MatchMarkets
): OddsetCandidate | null {
  const home = event.homeName || event.name.split(" - ")[0] || event.name;
  const away =
    event.awayName || event.name.split(" - ").slice(1).join(" - ") || "";
  const league = event.group || "";
  const country = countryOf(event);

  const o1 = markets.homeOdds;
  const oX = markets.drawOdds;
  const o2 = markets.awayOdds;
  if (o1 == null || oX == null || o2 == null || o1 <= 1 || oX <= 1 || o2 <= 1) {
    return null;
  }

  const equalizer = assessEqualizerPressure({
    homeOdds: o1,
    awayOdds: o2,
    drawOdds: oX,
    bttsYes: markets.bttsYes,
    bttsNo: markets.bttsNo,
    homeOver05: markets.homeOver05,
    awayOver05: markets.awayOver05,
    under25: markets.under25,
    homeName: home,
    awayName: away,
  });

  const rivalry = analyzeRivalry(home, away, league);
  const redCard = analyzeRedCard(markets, rivalry);

  const favIsHome = o1 <= o2;
  const fav: Oddset1x2Pick = favIsHome ? "1" : "2";
  const dog: Oddset1x2Pick = favIsHome ? "2" : "1";
  const favOdds = favIsHome ? o1 : o2;
  const dogOdds = favIsHome ? o2 : o1;

  let pick: Oddset1x2Pick | null = null;
  let confidence = 0;
  const reasons: string[] = [];
  let kind = "";

  // 1) Säker vinnare: utgång 2 @ ca 2,00 (samma regel som övriga tips)
  if (isSafeWinnerTwoOdds(o2) && equalizer.level !== "weak") {
    pick = "2";
    confidence = 78;
    kind = "säker vinnare";
    reasons.push(
      `Säker vinnare 2 @ ${o2.toFixed(2).replace(".", ",")} (band ca 2,00)`
    );
  }

  // 2) Mittfält-underdog mot kort favorit (4,xx-mönster)
  if (
    !pick &&
    isMidUnderdogOdds(dogOdds) &&
    favOdds <= VALUE_ODDS_INSIGHTS.shortFavMax &&
    favOdds >= 1.45
  ) {
    pick = dog;
    confidence = 72;
    kind = "mittfält-underdog";
    reasons.push(
      `Mittfält-underdog ${dog} @ ${dogOdds
        .toFixed(2)
        .replace(".", ",")} mot favorit ${fav} @ ${favOdds
        .toFixed(2)
        .replace(".", ",")} – samma 4,xx-mönster som övrig analys`
    );
  }

  // 3) Tydlig favorit med utjämnarpress (bakunder jagar – matchen “lever”)
  if (
    !pick &&
    favOdds >= 1.35 &&
    favOdds <= 1.9 &&
    equalizer.okForOver15 &&
    equalizer.level !== "weak"
  ) {
    pick = fav;
    confidence = equalizer.level === "strong" ? 76 : 70;
    kind = "favorit + utjämnarpress";
    reasons.push(
      `Favorit ${fav} @ ${favOdds
        .toFixed(2)
        .replace(".", ",")} med ${equalizer.level} utjämnarpress`
    );
  }

  // 4) Kort kryss + svag utjämnarpress / lågmål = X
  if (
    !pick &&
    oX <= 3.15 &&
    oX >= 2.7 &&
    (equalizer.level === "weak" ||
      (markets.under25 != null && markets.under25 <= 1.75))
  ) {
    pick = "X";
    confidence = 66;
    kind = "kryss / stängt läge";
    reasons.push(
      `Kryss X @ ${oX
        .toFixed(2)
        .replace(".", ",")} – stängt läge / svag jakt på mål`
    );
  }

  if (!pick) return null;

  // Undvik ultrakorta / longshots som huvudtips
  const pickOdds = pick === "1" ? o1 : pick === "2" ? o2 : oX;
  if (pickOdds < 1.28 || pickOdds > 5.5) return null;

  reasons.unshift(equalizerReasonLine(equalizer));
  reasons.push(`1X2 ${pick} @ ${pickOdds.toFixed(2).replace(".", ",")}`);
  reasons.push(`1 @ ${o1.toFixed(2).replace(".", ",")} · X @ ${oX
    .toFixed(2)
    .replace(".", ",")} · 2 @ ${o2.toFixed(2).replace(".", ",")}`);
  for (const p of equalizer.points.slice(0, 2)) {
    if (!reasons.includes(p)) reasons.push(p);
  }
  if (rivalry.level !== "none") reasons.push(rivalry.note);
  if (redCard.level !== "low") reasons.push(`rött kort: ${redCard.note}`);

  let score = confidence * 1.15 + equalizer.score * 3;
  if (kind === "säker vinnare") score += 10;
  if (kind === "mittfält-underdog") score += 12;
  if (kind === "favorit + utjämnarpress") score += 6;
  if (equalizer.level === "strong" && pick !== "X") score += 4;
  if (equalizer.warnings.length) score -= equalizer.warnings.length * 5;

  const topCountry =
    /england|spanien|spain|italien|italy|tyskland|germany|frankrike|france|nederländerna|netherlands|portugal|sverige|sweden|skottland|scotland/i.test(
      country
    );
  if (
    topCountry &&
    /premier league|la liga|serie a|bundesliga|ligue 1|championship|eredivisie|primeira|allsvenskan|liga portugal/i.test(
      league
    )
  ) {
    score += 5;
  }

  // xG från målstege som extrakontext (samma data som Ö1,5)
  const lambda = estimateExpectedGoals(
    markets.odds15,
    markets.odds25,
    markets.odds35,
    markets.under15,
    markets.under25,
    markets.odds45
  );
  if (lambda != null) {
    reasons.push(`förväntade mål ≈ ${lambda.toFixed(2).replace(".", ",")}`);
  }
  const over45Note = over45GoalsNotice(lambda, markets.odds45);
  if (over45Note) reasons.push(over45Note);

  return {
    eventId: event.id,
    home,
    away,
    league,
    country,
    kickoff: event.start,
    market: "1x2",
    line: null,
    pick1x2: pick,
    odds: pickOdds,
    odds15: markets.odds15,
    odds25: markets.odds25,
    odds35: markets.odds35,
    under15: markets.under15,
    homeOdds: o1,
    awayOdds: o2,
    drawOdds: oX,
    over25ProbPct: confidence,
    expectedGoals: lambda,
    rivalry,
    redCard,
    equalizer,
    score,
    reason: reasons.join(". "),
    url: eventUrl(event.id),
  };
}

async function fetchMarketsForEvents(
  events: KambiEvent[]
): Promise<Map<number, MatchMarkets>> {
  const map = new Map<number, MatchMarkets>();
  const concurrency = 6;
  for (let i = 0; i < events.length; i += concurrency) {
    const slice = events.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (ev) => {
        try {
          const data = (await kambiFetch(
            `/betoffer/event/${ev.id}.json?lang=sv_SE&market=SE`
          )) as { betOffers?: KambiBetOffer[] };
          const home =
            ev.homeName || ev.name.split(" - ")[0] || ev.name;
          const away =
            ev.awayName ||
            ev.name.split(" - ").slice(1).join(" - ") ||
            "";
          map.set(
            ev.id,
            extractMarkets(data.betOffers || [], home, away)
          );
        } catch {
          map.set(ev.id, {
            odds15: null,
            odds25: null,
            odds35: null,
            odds45: null,
            under15: null,
            under25: null,
            bttsYes: null,
            bttsNo: null,
            homeOdds: null,
            awayOdds: null,
            drawOdds: null,
            homeOver05: null,
            awayOver05: null,
            redCardYes: null,
            redCardNo: null,
            totalCardsOver: null,
          });
        }
      })
    );
  }
  return map;
}

function selectUniquePicks(
  ranked: OddsetCandidate[],
  limit: number
): OddsetCandidate[] {
  const picked: OddsetCandidate[] = [];
  const usedTeams = new Set<string>();
  const usedLeagues = new Map<string, number>();

  const teamKey = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  for (const c of ranked) {
    if (picked.length >= limit) break;
    const h = teamKey(c.home);
    const a = teamKey(c.away);
    if (usedTeams.has(h) || usedTeams.has(a)) continue;
    const leagueCount = usedLeagues.get(c.league) || 0;
    // Max 2 tips per liga i samma batch → mer unika tips
    if (c.league && leagueCount >= 2) continue;
    picked.push(c);
    usedTeams.add(h);
    usedTeams.add(a);
    if (c.league) usedLeagues.set(c.league, leagueCount + 1);
  }

  // Fyll på om filtret blev för hårt
  if (picked.length < limit) {
    for (const c of ranked) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.eventId === c.eventId)) continue;
      picked.push(c);
    }
  }
  return picked;
}

export async function buildOddsetDayTip(opts?: {
  clientTips?: Array<OddsetCandidate & { tippedAt?: string }>;
  clientLessons?: OddsetLesson[];
}): Promise<OddsetDayTip> {
  const now = new Date();
  const today = todaySwedishPlayDate(now);
  const tomorrow = nextSwedishPlayDate(now);

  if (opts?.clientLessons?.length) {
    await importOddsetLessons(opts.clientLessons);
  }
  // Importera + settla tidigare tips först så lärdomar finns innan nytt urval
  if (opts?.clientTips?.length) {
    await importOddsetTips(opts.clientTips);
  }
  await settleOddsetTips();
  const learning = await loadOddsetLearning();
  const recentTracked = await listTrackedOddsetTips();
  const recentEventIds = new Set(recentTracked.map((t) => t.eventId));
  const recentTeams = new Set<string>();
  const recentLeagues = new Set<string>();
  for (const t of recentTracked) {
    recentTeams.add(t.home);
    recentTeams.add(t.away);
    if (t.league) recentLeagues.add(t.league);
  }
  const list = (await kambiFetch(
    "/listView/football.json?lang=sv_SE&market=SE"
  )) as { events?: Array<{ event: KambiEvent; betOffers?: KambiBetOffer[] }> };

  // Öppna spel nu: avspark minst ~12 min framåt, i första hand idag (svensk tid)
  const minStart = now.getTime() + 12 * 60 * 1000;
  const openEvents: KambiEvent[] = [];
  for (const wrap of list.events || []) {
    const ev = wrap.event;
    if (!ev?.start || !ev.id) continue;
    const start = new Date(ev.start);
    if (start.getTime() < minStart) continue;
    if (!isSeniorMensMatch(ev)) continue;
    openEvents.push(ev);
  }

  const todayEvents = openEvents.filter(
    (ev) => stockholmDateIso(new Date(ev.start)) === today.isoDate
  );
  const tomorrowEvents = openEvents.filter(
    (ev) => stockholmDateIso(new Date(ev.start)) === tomorrow.isoDate
  );

  // Prioritera dagens öppna matcher; ta alltid med imorgon som backup-pool
  let dayEvents = [...todayEvents, ...tomorrowEvents];
  let play = today;
  let windowNote = "öppna matcher idag (svensk tid)";
  if (!todayEvents.length && tomorrowEvents.length) {
    play = tomorrow;
    windowNote = "öppna matcher imorgon (inga kvar idag)";
  } else if (todayEvents.length && tomorrowEvents.length) {
    windowNote = "öppna matcher idag + imorgon";
  } else if (!dayEvents.length) {
    windowNote = "inga öppna fotbollsmatcher just nu";
  }

  // Rangordna: dagens matcher före imorgon vid lika liga-kvalitet
  const isToday = (ev: KambiEvent) =>
    stockholmDateIso(new Date(ev.start)) === today.isoDate;

  const leagueRank = (ev: KambiEvent) => {
    const league = ev.group || "";
    const country = countryOf(ev);
    const topCountry =
      /england|spanien|spain|italien|italy|tyskland|germany|frankrike|france|nederländerna|netherlands|portugal|sverige|sweden|skottland|scotland/i.test(
        country
      );
    if (
      topCountry &&
      /premier league|la liga|serie a|bundesliga|ligue 1/i.test(league)
    )
      return 0;
    if (
      topCountry &&
      /championship|eredivisie|primeira|liga portugal|allsvenskan|la liga 2|serie b/i.test(
        league
      )
    )
      return 1;
    if (/champions league|europa league/i.test(league)) return 1;
    if (/superliga|pro league|liga profesional|mls/i.test(league)) return 2;
    return 3;
  };
  dayEvents.sort(
    (a, b) =>
      Number(isToday(b)) - Number(isToday(a)) ||
      leagueRank(a) - leagueRank(b) ||
      new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  const maxAnalyze = 100;
  const toAnalyze = dayEvents.slice(0, maxAnalyze);
  const markets = await fetchMarketsForEvents(toAnalyze);

  const floorBump = learning.biases.raiseProbFloor;
  const minProb = MIN_OVER15_PROB + floorBump;

  const candidates: OddsetCandidate[] = [];
  const candidates1x2: OddsetCandidate[] = [];
  for (const ev of toAnalyze) {
    const m = markets.get(ev.id);
    if (!m) continue;
    const c = buildCandidate(ev, m);
    if (c) {
      // Dynamisk ribba från missar (övertygade fel → höj golvet)
      if (c.over25ProbPct / 100 >= minProb) {
        const adj = oddsetLearningAdjust({
          memory: learning,
          candidate: c,
          recentEventIds,
          recentTeams,
          recentLeagues,
        });
        c.score += adj.scoreDelta;
        if (adj.notes.length) {
          c.learningNotes = adj.notes;
          c.reason = `${c.reason}. ${adj.notes[0]}`;
        }
        candidates.push(c);
      }
    }

    const c1 = build1x2Candidate(ev, m);
    if (c1) {
      const adj = oddsetLearningAdjust({
        memory: learning,
        candidate: c1,
        recentEventIds,
        recentTeams,
        recentLeagues,
      });
      c1.score += adj.scoreDelta * 0.5;
      if (adj.notes.length) {
        c1.learningNotes = adj.notes;
        c1.reason = `${c1.reason}. ${adj.notes[0]}`;
      }
      candidates1x2.push(c1);
    }
  }

  const todayIso = today.isoDate;
  const sortCandidates = (list: OddsetCandidate[]) => {
    list.sort((a, b) => {
      const aToday = stockholmDateIso(new Date(a.kickoff)) === todayIso ? 1 : 0;
      const bToday = stockholmDateIso(new Date(b.kickoff)) === todayIso ? 1 : 0;
      if (Math.abs(a.score - b.score) < 8 && aToday !== bToday) {
        return bToday - aToday;
      }
      return (
        b.score - a.score ||
        b.over25ProbPct - a.over25ProbPct ||
        new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
      );
    });
  };
  sortCandidates(candidates);
  sortCandidates(candidates1x2);
  const selected = selectUniquePicks(candidates, PICKS_PER_DAY);
  const selected1x2 = selectUniquePicks(candidates1x2, PICKS_PER_DAY);

  await rememberOddsetTips([...selected, ...selected1x2]);
  const tracked = await settleOddsetTips();
  const learningAfter = await loadOddsetLearning();

  return {
    playDate: play.isoDate,
    playDateLabel: play.label,
    generatedAt: new Date().toISOString(),
    selected,
    candidates: candidates.slice(0, 12),
    selected1x2,
    candidates1x2: candidates1x2.slice(0, 12),
    tracked,
    retentionHours: ODDSET_TIP_RETENTION_HOURS,
    analyzedCount: toAnalyze.length,
    eligibleCount: candidates.length,
    eligible1x2Count: candidates1x2.length,
    picksPerDay: PICKS_PER_DAY,
    learning: {
      updatedAt: learningAfter.updatedAt,
      summary: learningAfter.lastSummary,
      biasesNote: learningAfter.biases.note,
      lessons: learningAfter.lessons.slice(0, 12),
    },
    rules: [
      `${PICKS_PER_DAY} unika Oddset Över 1,5 + ${PICKS_PER_DAY} unika 1X2 som går att spela nu.`,
      `Fönster: ${windowNote}.`,
      "Bara matcher som inte startat ännu (för nya tips).",
      `Tipsen ligger kvar på sidan ${ODDSET_TIP_RETENTION_HOURS} timmar.`,
      "Efter slutsignal: Över 1,5 = ≥2 mål; 1X2 = tippad utgång rätt.",
      "1X2 använder samma analys: utjämnarpress, säker vinnare 2 @ ca 2,00, mittfält-underdog (4,xx), favorit med jakt på 1–1.",
      "Lågmålskontroll: Ö1,5 ensamt räcker inte – Ö/U-stege, xG, P(≤1 mål), Under 2,5, BTTS och kryss måste stödja öppet spel.",
      "Utjämnarpress: vid 0–1 ska laget bakom känna att det är fel och jaga 1–1.",
      "Efter varje avgjort tips lär sig analysen varför det gick rätt/fel och justerar nästa urval automatiskt.",
      `Sannolikhetsgolv Ö1,5: ≥${Math.round(minProb * 100)}% (höjs efter övertygade missar).`,
      "Rivalitet/derby och rött-kort-marknad analyseras som extrakontext.",
      "Uppdateras automatiskt 12 min före avspark och när resultat kommer in.",
    ],
    disclaimer:
      "Oddset-tips är analys, ingen garanti. Odds från Svenska Spel/Kambi kan ändras. 18+ spela ansvarsfullt.",
  };
}

/** Enbart settlement av sparade/klienttips (lättare anrop). */
export async function settleStoredOddsetTips(
  clientTips?: Array<OddsetCandidate & { tippedAt?: string }>
): Promise<OddsetTrackedTip[]> {
  if (clientTips?.length) await importOddsetTips(clientTips);
  return settleOddsetTips();
}

export async function getTrackedOddsetTips(): Promise<OddsetTrackedTip[]> {
  return listTrackedOddsetTips();
}
