/**
 * Esports Battle (eSoccer Battle 8 min) – resultat från Bettrails
 * (officiell football.esportsbattle.com blockeras ofta av Cloudflare).
 */

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
};

export type EsportsBattleDay = {
  generatedAt: string;
  source: string;
  sourceUrl: string;
  playDateLabel: string;
  played: number | null;
  scheduled: number | null;
  goalsPerMatch: number | null;
  over65Pct: number | null;
  bttsPct: number | null;
  latestLabel: string | null;
  matches: EsportsBattleMatch[];
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BETTRAILS_URL =
  "https://bettrails.com/resultados/esportsbattle?lang=en";
const JINXBETS_URL = "https://jinxbets.com/esoccer-battle-results";

const STOCKHOLM = "Europe/Stockholm";

let cache: { at: number; day: EsportsBattleDay } | null = null;
const CACHE_TTL_MS = 45_000;

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

function parseBettrailsHtml(html: string): EsportsBattleDay | null {
  const matches: EsportsBattleMatch[] = [];
  const rowRe =
    /<tr[^>]*data-vk="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const vk = row[1];
    const body = row[2];
    const homePlayer =
      body.match(/<div class="home"[\s\S]*?<span class="pl">([^<]*)<\/span>/i)?.[1]?.trim() ||
      "";
    const homeTeam =
      body.match(/<div class="home"[\s\S]*?<span class="tm">([^<]*)<\/span>/i)?.[1]?.trim() ||
      "";
    const awayPlayer =
      body.match(/<div class="away"[\s\S]*?<span class="pl">([^<]*)<\/span>/i)?.[1]?.trim() ||
      "";
    const awayTeam =
      body.match(/<div class="away"[\s\S]*?<span class="tm">([^<]*)<\/span>/i)?.[1]?.trim() ||
      "";
    const scoreCell =
      body.match(/<td class="score"[^>]*>([\s\S]*?)<\/td>/i)?.[1] || "";
    const nums = [...scoreCell.matchAll(/>(\d+)</g)].map((x) => Number(x[1]));
    if (nums.length < 2) continue;
    const homeGoals = nums[0];
    const awayGoals = nums[1];
    const dateCell =
      body.match(/<td(?![^>]*class="(?:score|c)")[^>]*>([\s\S]*?)<\/td>/i)?.[1] ||
      "";
    // Prefer last td text (Date column)
    const tds = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      stripTags(m[1])
    );
    const dateText = tds[tds.length - 1] || stripTags(dateCell) || vk;
    const kickoff =
      parseBettrailsKickoff(dateText) ||
      parseBettrailsKickoff(vk.replace("@", " · ")) ||
      new Date().toISOString();
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
    });
  }

  if (!matches.length) return null;

  const plain = stripTags(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  );
  const playedM = plain.match(/(\d+)\s+of\s+(\d+)\s+played/i);
  const gpmM = plain.match(/Goals per match\s+([\d.]+)/i);
  const o65M = plain.match(/Over 6\.5 goals\s+(\d+)\s*%/i);
  const bttsM = plain.match(/Both teams score\s+(\d+)\s*%/i);
  const latestM = plain.match(/Latest result:\s*([^.]+)/i);

  return {
    generatedAt: new Date().toISOString(),
    source: "Bettrails",
    sourceUrl: BETTRAILS_URL,
    playDateLabel: stockholmDateLabel(),
    played: playedM ? Number(playedM[1]) : matches.length,
    scheduled: playedM ? Number(playedM[2]) : null,
    goalsPerMatch: gpmM ? Number(gpmM[1]) : null,
    over65Pct: o65M ? Number(o65M[1]) : null,
    bttsPct: bttsM ? Number(bttsM[1]) : null,
    latestLabel: latestM ? latestM[1].trim() : null,
    matches,
  };
}

function parseJinxbetsHtml(html: string): EsportsBattleDay | null {
  const matches: EsportsBattleMatch[] = [];
  const today = stockholmYmd();
  const [y, mo, d] = today.split("-").map(Number);
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
    });
  }
  if (!matches.length) return null;
  return {
    generatedAt: new Date().toISOString(),
    source: "Jinxbets",
    sourceUrl: JINXBETS_URL,
    playDateLabel: stockholmDateLabel(),
    played: matches.length,
    scheduled: null,
    goalsPerMatch:
      Math.round(
        (100 * matches.reduce((s, m) => s + m.totalGoals, 0)) / matches.length
      ) / 100,
    over65Pct: Math.round(
      (100 * matches.filter((m) => m.totalGoals > 6.5).length) / matches.length
    ),
    bttsPct: Math.round(
      (100 *
        matches.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length) /
        matches.length
    ),
    latestLabel: matches[0]
      ? `${matches[0].homePlayer} ${matches[0].homeGoals}-${matches[0].awayGoals} ${matches[0].awayPlayer}`
      : null,
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

  const betHtml = await fetchHtml(BETTRAILS_URL);
  let day = betHtml ? parseBettrailsHtml(betHtml) : null;
  if (!day) {
    const jinxHtml = await fetchHtml(JINXBETS_URL);
    day = jinxHtml ? parseJinxbetsHtml(jinxHtml) : null;
  }
  if (!day) {
    throw new Error("Kunde inte hämta Esports Battle-resultat");
  }

  // Nyast först
  day.matches.sort(
    (a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)
  );

  cache = { at: Date.now(), day };
  return day;
}
