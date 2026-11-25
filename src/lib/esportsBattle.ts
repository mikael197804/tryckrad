/**
 * Esports Battle (eSoccer Battle 8 min) – resultat från Bettrails
 * (officiell football.esportsbattle.com blockeras ofta av Cloudflare).
 *
 * Resultat sparas 3 timmar efter kickoff, sedan bort.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type EsportsBattleMatch = {
  id: string;
  kickoff: string;
  homePlayer: string;
  homeTeam: string;
  awayPlayer: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  /** När resultatet först sparades hos oss. */
  savedAt?: string;
};

export type EsportsBattleDay = {
  generatedAt: string;
  source: string;
  sourceUrl: string;
  playDateLabel: string;
  retentionHours: number;
  played: number | null;
  scheduled: number | null;
  goalsPerMatch: number | null;
  over65Pct: number | null;
  bttsPct: number | null;
  latestLabel: string | null;
  matches: EsportsBattleMatch[];
};

export const ESPORTS_BATTLE_RETENTION_MS = 3 * 60 * 60 * 1000;
export const ESPORTS_BATTLE_RETENTION_HOURS = 3;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BETTRAILS_URL =
  "https://bettrails.com/resultados/esportsbattle?lang=en";
const JINXBETS_URL = "https://jinxbets.com/esoccer-battle-results";

const STOCKHOLM = "Europe/Stockholm";
const STORE_PATH = path.join("/tmp", "mikaels-esports-battle-history.json");

let cache: { at: number; day: EsportsBattleDay } | null = null;
const CACHE_TTL_MS = 45_000;

type GlobalStore = {
  matches: EsportsBattleMatch[];
  loaded: boolean;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & {
    __mikaelsEsportsBattleHistory?: GlobalStore;
  };
  if (!g.__mikaelsEsportsBattleHistory) {
    g.__mikaelsEsportsBattleHistory = { matches: [], loaded: false };
  }
  return g.__mikaelsEsportsBattleHistory;
}

/** Retention efter kickoff (matchtid). */
export function esportsBattleAnchorMs(m: EsportsBattleMatch): number {
  const kick = Date.parse(m.kickoff);
  if (Number.isFinite(kick)) return kick;
  const saved = m.savedAt ? Date.parse(m.savedAt) : NaN;
  return Number.isFinite(saved) ? saved : Date.now();
}

export function pruneEsportsBattleMatches(
  matches: EsportsBattleMatch[],
  now = Date.now()
): EsportsBattleMatch[] {
  return matches.filter((m) => {
    const at = esportsBattleAnchorMs(m);
    return Number.isFinite(at) && now - at <= ESPORTS_BATTLE_RETENTION_MS;
  });
}

export function mergeEsportsBattleMatches(
  ...groups: EsportsBattleMatch[][]
): EsportsBattleMatch[] {
  const byId = new Map<string, EsportsBattleMatch>();
  for (const group of groups) {
    for (const m of group) {
      if (!m?.id) continue;
      const prev = byId.get(m.id);
      if (!prev) {
        byId.set(m.id, {
          ...m,
          savedAt: m.savedAt || new Date().toISOString(),
        });
        continue;
      }
      byId.set(m.id, {
        ...prev,
        ...m,
        savedAt: prev.savedAt || m.savedAt || new Date().toISOString(),
        homeGoals: m.homeGoals ?? prev.homeGoals,
        awayGoals: m.awayGoals ?? prev.awayGoals,
        totalGoals:
          (m.homeGoals ?? prev.homeGoals) + (m.awayGoals ?? prev.awayGoals),
      });
    }
  }
  return pruneEsportsBattleMatches([...byId.values()]).sort(
    (a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)
  );
}

function summarizeFromMatches(
  matches: EsportsBattleMatch[],
  meta: Partial<EsportsBattleDay> & { source: string; sourceUrl: string }
): EsportsBattleDay {
  const goals = matches.map((m) => m.totalGoals);
  const gpm =
    goals.length > 0
      ? Math.round((100 * goals.reduce((s, n) => s + n, 0)) / goals.length) /
        100
      : null;
  const over65 =
    goals.length > 0
      ? Math.round((100 * goals.filter((g) => g > 6.5).length) / goals.length)
      : null;
  const btts =
    matches.length > 0
      ? Math.round(
          (100 *
            matches.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length) /
            matches.length
        )
      : null;
  const latest = matches[0]
    ? `${matches[0].homePlayer} ${matches[0].homeGoals}-${matches[0].awayGoals} ${matches[0].awayPlayer}`
    : null;

  return {
    generatedAt: new Date().toISOString(),
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    playDateLabel: stockholmDateLabel(),
    retentionHours: ESPORTS_BATTLE_RETENTION_HOURS,
    played: meta.played ?? matches.length,
    scheduled: meta.scheduled ?? null,
    goalsPerMatch: meta.goalsPerMatch ?? gpm,
    over65Pct: meta.over65Pct ?? over65,
    bttsPct: meta.bttsPct ?? btts,
    latestLabel: meta.latestLabel ?? latest,
    matches,
  };
}

async function ensureLoaded(): Promise<void> {
  const s = store();
  if (s.loaded) return;
  s.loaded = true;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { matches?: EsportsBattleMatch[] };
    if (Array.isArray(parsed.matches)) {
      s.matches = pruneEsportsBattleMatches(parsed.matches);
    }
  } catch {
    /* ingen fil ännu */
  }
}

async function persist(): Promise<void> {
  const s = store();
  s.matches = pruneEsportsBattleMatches(s.matches);
  try {
    await mkdir(path.dirname(STORE_PATH), { recursive: true });
    await writeFile(
      STORE_PATH,
      JSON.stringify({
        matches: s.matches,
        savedAt: new Date().toISOString(),
        retentionHours: ESPORTS_BATTLE_RETENTION_HOURS,
      }),
      "utf8"
    );
  } catch {
    /* /tmp kan faila – minnet räcker för warm instances */
  }
}

function stockholmYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCKHOLM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function stockholmDateLabel(d = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: STOCKHOLM,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

function parseBettrailsKickoff(raw: string): string | null {
  // "25/11/2026 · 08:55" or "2026-11-25 08:55"
  const m = raw.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s*[·.]\s*(\d{1,2}):(\d{2})/
  );
  if (m) {
    const [, dd, mm, yyyy, hh, mi] = m;
    // Tolka som Stockholm (CET/CEST) – Bettrails visar lokal europeisk tid
    const isoGuess = `${yyyy}-${mm}-${dd}T${hh.padStart(2, "0")}:${mi}:00`;
    const asUtc = Date.parse(isoGuess + "+01:00");
    if (Number.isFinite(asUtc)) return new Date(asUtc).toISOString();
  }
  const m2 = raw.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (m2) {
    const [, yyyy, mm, dd, hh, mi] = m2;
    const asUtc = Date.parse(
      `${yyyy}-${mm}-${dd}T${hh.padStart(2, "0")}:${mi}:00+01:00`
    );
    if (Number.isFinite(asUtc)) return new Date(asUtc).toISOString();
  }
  return null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

type ScrapedDay = {
  source: string;
  sourceUrl: string;
  played: number | null;
  scheduled: number | null;
  goalsPerMatch: number | null;
  over65Pct: number | null;
  bttsPct: number | null;
  latestLabel: string | null;
  matches: EsportsBattleMatch[];
};

function parseBettrailsHtml(html: string): ScrapedDay | null {
  const matches: EsportsBattleMatch[] = [];
  const rowRe = /<tr[^>]*data-vk="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  const nowIso = new Date().toISOString();
  while ((row = rowRe.exec(html))) {
    const vk = row[1];
    const body = row[2];
    const homePlayer =
      body.match(
        /<div class="home"[\s\S]*?<span class="pl">([^<]*)<\/span>/i
      )?.[1]?.trim() || "";
    const homeTeam =
      body.match(
        /<div class="home"[\s\S]*?<span class="tm">([^<]*)<\/span>/i
      )?.[1]?.trim() || "";
    const awayPlayer =
      body.match(
        /<div class="away"[\s\S]*?<span class="pl">([^<]*)<\/span>/i
      )?.[1]?.trim() || "";
    const awayTeam =
      body.match(
        /<div class="away"[\s\S]*?<span class="tm">([^<]*)<\/span>/i
      )?.[1]?.trim() || "";
    const scoreCell =
      body.match(/<td class="score"[^>]*>([\s\S]*?)<\/td>/i)?.[1] || "";
    const nums = [...scoreCell.matchAll(/>(\d+)</g)].map((x) => Number(x[1]));
    if (nums.length < 2) continue;
    const homeGoals = nums[0];
    const awayGoals = nums[1];
    const tds = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      stripTags(m[1])
    );
    const dateText = tds[tds.length - 1] || vk;
    const kickoff =
      parseBettrailsKickoff(dateText) ||
      parseBettrailsKickoff(vk.replace("@", " · ")) ||
      nowIso;
    if (!homePlayer && !awayPlayer) continue;
    matches.push({
      id: `eb:${vk}`,
      kickoff,
      homePlayer,
      homeTeam,
      awayPlayer,
      awayTeam,
      homeGoals,
      awayGoals,
      totalGoals: homeGoals + awayGoals,
      savedAt: nowIso,
    });
  }

  if (!matches.length) return null;

  const plain = stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
  );
  const playedM = plain.match(/(\d+)\s+of\s+(\d+)\s+played/i);
  const gpmM = plain.match(/Goals per match\s+([\d.]+)/i);
  const o65M = plain.match(/Over 6\.5 goals\s+(\d+)\s*%/i);
  const bttsM = plain.match(/Both teams score\s+(\d+)\s*%/i);
  const latestM = plain.match(/Latest result:\s*([^.]+)/i);

  return {
    source: "Bettrails",
    sourceUrl: BETTRAILS_URL,
    played: playedM ? Number(playedM[1]) : matches.length,
    scheduled: playedM ? Number(playedM[2]) : null,
    goalsPerMatch: gpmM ? Number(gpmM[1]) : null,
    over65Pct: o65M ? Number(o65M[1]) : null,
    bttsPct: bttsM ? Number(bttsM[1]) : null,
    latestLabel: latestM ? latestM[1].trim() : null,
    matches,
  };
}

function parseJinxbetsHtml(html: string): ScrapedDay | null {
  const matches: EsportsBattleMatch[] = [];
  const today = stockholmYmd();
  const [y, mo, d] = today.split("-").map(Number);
  const nowIso = new Date().toISOString();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (c) => stripTags(c[1])
    );
    if (cells.length < 3) continue;
    const timeCell = cells.find((c) => /^\d{1,2}:\d{2}$/.test(c));
    const matchCell = cells.find((c) => /\bvs\b/i.test(c));
    const scoreCell = cells.find((c) => /^\d+[–\-]\d+$/.test(c));
    if (!timeCell || !matchCell || !scoreCell) continue;
    const mm = matchCell.match(
      /^(.+?)\s*\(([^)]+)\)\s+vs\s+(.+?)\s*\(([^)]+)\)\s*$/i
    );
    if (!mm) continue;
    const [, hp, ht, ap, at] = mm;
    const [hg, ag] = scoreCell.split(/[–\-]/).map(Number);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    const [hh, mi] = timeCell.split(":").map(Number);
    const kickoff = new Date(
      Date.parse(
        `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00+01:00`
      )
    ).toISOString();
    const id = `eb:jinx:${hp}-${ap}@${today} ${timeCell}`.toLowerCase();
    matches.push({
      id,
      kickoff,
      homePlayer: hp.trim(),
      homeTeam: ht.trim(),
      awayPlayer: ap.trim(),
      awayTeam: at.trim(),
      homeGoals: hg,
      awayGoals: ag,
      totalGoals: hg + ag,
      savedAt: nowIso,
    });
  }
  if (!matches.length) return null;
  return {
    source: "Jinxbets",
    sourceUrl: JINXBETS_URL,
    played: matches.length,
    scheduled: null,
    goalsPerMatch: null,
    over65Pct: null,
    bttsPct: null,
    latestLabel: null,
    matches,
  };
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": UA,
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function buildEsportsBattleDay(
  fresh = false
): Promise<EsportsBattleDay> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.day;
  }

  await ensureLoaded();
  const s = store();

  const betHtml = await fetchHtml(BETTRAILS_URL);
  let scraped = betHtml ? parseBettrailsHtml(betHtml) : null;
  if (!scraped) {
    const jinxHtml = await fetchHtml(JINXBETS_URL);
    scraped = jinxHtml ? parseJinxbetsHtml(jinxHtml) : null;
  }

  if (scraped?.matches?.length) {
    s.matches = mergeEsportsBattleMatches(s.matches, scraped.matches);
    await persist();
  } else {
    s.matches = pruneEsportsBattleMatches(s.matches);
  }

  if (!s.matches.length && !scraped) {
    throw new Error("Kunde inte hämta Esports Battle-resultat");
  }

  // `played` = antal sparade inom 3 h (inte hela dagens Bettrails-total)
  const day = summarizeFromMatches(s.matches, {
    source: scraped?.source || "Esports Battle",
    sourceUrl: scraped?.sourceUrl || BETTRAILS_URL,
    played: s.matches.length,
    scheduled: null,
    goalsPerMatch: null,
    over65Pct: null,
    bttsPct: null,
    latestLabel: null,
  });

  cache = { at: Date.now(), day };
  return day;
}
