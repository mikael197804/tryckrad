import { createHash } from "crypto";
import { isFreshFetch } from "./fetch-mode";

/** Tippsignal från Sharps-tippare (strukturerad, ej fullständig foruminläggstext). */
export type SharpsTipSignal = {
  tipster: string;
  postedAt: string | null;
  home: string | null;
  away: string | null;
  market: string;
  selection: string;
  odds: number | null;
  summary: string;
  threadTitle: string | null;
  sourceUrl: string | null;
};

export type SharpsTipsterFeed = {
  tipster: string;
  profileUrl: string;
  fetchedAt: string;
  configured: boolean;
  ok: boolean;
  error: string | null;
  tips: SharpsTipSignal[];
  note: string;
};

const TIPSTER_SLUG = "forbidden_closet";
const TIPSTER_USER_ID = "14930";
const PROFILE_URL = `https://www.sharps.se/forums/members/${TIPSTER_SLUG}/`;
const BASE = "https://www.sharps.se/forums";

type CacheEntry = { at: number; feed: SharpsTipsterFeed };
let feedCache: CacheEntry | null = null;
const CACHE_MS = 8 * 60 * 1000;

function md5(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&aring;/g, "å")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Aring;/g, "Å")
    .replace(/\s+/g, " ")
    .trim();
}

function credentials(): { user: string; pass: string } | null {
  const user =
    process.env.SHARPS_USERNAME?.trim() ||
    process.env.SHARPS_USER?.trim() ||
    "";
  const pass =
    process.env.SHARPS_PASSWORD?.trim() ||
    process.env.SHARPS_PASS?.trim() ||
    "";
  if (!user || !pass) return null;
  return { user, pass };
}

type CookieJar = Map<string, string>;

function parseSetCookie(jar: CookieJar, res: Response): void {
  const anyHeaders = res.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const lines =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : [];
  const single = res.headers.get("set-cookie");
  const all = lines.length ? lines : single ? [single] : [];
  for (const line of all) {
    const part = line.split(";")[0];
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function sharpsFetch(
  jar: CookieJar,
  pathOrUrl: string,
  init?: RequestInit
): Promise<{ res: Response; text: string }> {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${BASE}/${pathOrUrl.replace(/^\//, "")}`;
  const headers = new Headers(init?.headers || {});
  headers.set(
    "User-Agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  headers.set(
    "Accept",
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  );
  headers.set("Accept-Language", "sv-SE,sv;q=0.9,en;q=0.8");
  if (jar.size) headers.set("Cookie", cookieHeader(jar));
  const res = await fetch(url, {
    ...init,
    headers,
    redirect: "manual",
    cache: "no-store",
  });
  parseSetCookie(jar, res);
  // Follow a few redirects manually to keep cookies
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get("location");
    if (loc) {
      const next = loc.startsWith("http")
        ? loc
        : `https://www.sharps.se${loc.startsWith("/") ? "" : "/"}${loc}`;
      return sharpsFetch(jar, next, { method: "GET" });
    }
  }
  const text = await res.text();
  return { res, text };
}

async function loginSharps(
  jar: CookieJar,
  user: string,
  pass: string
): Promise<{ ok: boolean; error: string | null }> {
  // Warm cookies / guest token
  await sharpsFetch(jar, "login.php?do=login");

  const body = new URLSearchParams();
  body.set("vb_login_username", user);
  body.set("vb_login_password", "");
  body.set("vb_login_md5password", md5(pass));
  body.set("vb_login_md5password_utf", md5(pass));
  body.set("cookieuser", "1");
  body.set("do", "login");
  body.set("url", `/forums/members/${TIPSTER_SLUG}/`);

  const { text } = await sharpsFetch(jar, "login.php?do=login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://www.sharps.se",
      Referer: "https://www.sharps.se/forums/login.php",
    },
    body: body.toString(),
  });

  const lower = text.toLowerCase();
  if (
    lower.includes("felaktigt lösenord") ||
    lower.includes("felaktigt losenord") ||
    lower.includes("invalid password") ||
    lower.includes("wrong password") ||
    (lower.includes("permission error") && !jar.has("bbuserid") && !jar.has("bbsessionhash"))
  ) {
    // soft check – vB cookie names vary
  }

  const loggedIn =
    jar.has("bbuserid") ||
    jar.has("bbsessionhash") ||
    jar.has("vbseo_loggedin") ||
    /logga ut|logout/i.test(text);

  if (!loggedIn) {
    return {
      ok: false,
      error:
        "Kunde inte logga in på Sharps (kontrollera SHARPS_USERNAME/SHARPS_PASSWORD).",
    };
  }
  return { ok: true, error: null };
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Extrahera tippliknande rader från foruminlägg (kort sammanfattning). */
export function parseSharpsTipsFromHtml(html: string): SharpsTipSignal[] {
  const tips: SharpsTipSignal[] = [];
  const blocks: Array<{ title: string | null; body: string; url: string | null; date: string | null }> =
    [];

  // Vanliga vB-postblock
  const postRe =
    /<li[^>]*class="[^"]*postbit[^"]*"[^>]*>([\s\S]*?)<\/li>|<div[^>]*class="[^"]*postcontainer[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*postcontainer|<\/ol>|<\/div>\s*<div class="[^"]*footer)/gi;
  let m: RegExpExecArray | null;
  const rawPosts: string[] = [];
  while ((m = postRe.exec(html))) {
    rawPosts.push(m[1] || m[2] || "");
  }
  if (!rawPosts.length) {
    // Fallback: search result rows
    const rowRe =
      /<li[^>]*class="[^"]*threadbit[^"]*"[^>]*>([\s\S]*?)<\/li>|<tr[^>]*>([\s\S]*?forbidden_closet[\s\S]*?)<\/tr>/gi;
    while ((m = rowRe.exec(html))) {
      rawPosts.push(m[1] || m[2] || "");
    }
  }
  if (!rawPosts.length) {
    // Sista utväg: hela sidan som en blob uppdelad på "Över"/"spela"
    rawPosts.push(html);
  }

  for (const raw of rawPosts.slice(0, 40)) {
    const titleMatch =
      raw.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      raw.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i);
    const title = titleMatch
      ? stripTags(titleMatch[1]).slice(0, 160)
      : null;
    const urlMatch = raw.match(
      /href="((?:https:\/\/www\.sharps\.se)?\/forums\/[^"]+showthread[^"]+)"/i
    ) || raw.match(/href="((?:https:\/\/www\.sharps\.se)?\/forums\/[^"]+\.html)"/i);
    const url = urlMatch
      ? decodeBasicEntities(
          urlMatch[1].startsWith("http")
            ? urlMatch[1]
            : `https://www.sharps.se${urlMatch[1]}`
        )
      : null;
    const dateMatch =
      raw.match(/datetime="([^"]+)"/i) ||
      raw.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
    const body = stripTags(
      raw.match(
        /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i
      )?.[1] ||
        raw.match(
          /<blockquote[^>]*class="[^"]*postcontent[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i
        )?.[1] ||
        raw
    ).slice(0, 1200);

    blocks.push({
      title,
      body,
      url,
      date: dateMatch?.[1] || null,
    });
  }

  for (const b of blocks) {
    const text = `${b.title || ""} ${b.body}`;
    if (!/(över\s*2[,.]?\s*5|over\s*2[,.]?\s*5|ö2[,.]?5|o2[,.]?5|antal mål|totals)/i.test(text) &&
        !/(spela|tips|rek|oddset|1x2|\b1\b.*\bx\b|\bbtts\b)/i.test(text)) {
      continue;
    }

    const teams =
      text.match(
        /([A-ZÅÄÖ][\wÅÄÖåäö.'\- ]{1,40})\s*(?:-|–|vs\.?|mot)\s*([A-ZÅÄÖ][\wÅÄÖåäö.'\- ]{1,40})/
      ) ||
      (b.title || "").match(
        /([A-ZÅÄÖ][\wÅÄÖåäö.'\- ]{1,40})\s*(?:-|–|vs\.?|mot)\s*([A-ZÅÄÖ][\wÅÄÖåäö.'\- ]{1,40})/
      );

    let market = "övrigt";
    let selection = "tips";
    if (/över\s*2[,.]?\s*5|over\s*2[,.]?\s*5|ö2[,.]?5|o2[,.]?5/i.test(text)) {
      market = "over_2_5";
      selection = "Över 2,5";
    } else if (/under\s*2[,.]?\s*5|u2[,.]?5/i.test(text)) {
      market = "under_2_5";
      selection = "Under 2,5";
    } else if (/\bbtts\sboth\s*teams|båda\slag\små/i.test(text)) {
      market = "btts";
      selection = "BTTS";
    } else if (/\b1x2\b|\bheltid\b/i.test(text)) {
      market = "1x2";
      selection = "1X2";
    }

    const oddsMatch = text.match(
      /(?:@|odds[:\s]*)(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*(?:i\s)?(?:snitt|odds)?/i
    );
    const oddsRaw = oddsMatch?.[1] || oddsMatch?.[2] || null;
    const odds = oddsRaw
      ? Number(String(oddsRaw).replace(",", "."))
      : null;

    const summary = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);

    // Undvik brus utan tippsignal
    if (market === "övrigt" && !teams) continue;

    tips.push({
      tipster: TIPSTER_SLUG,
      postedAt: b.date,
      home: teams?.[1]?.trim() || null,
      away: teams?.[2]?.trim() || null,
      market,
      selection,
      odds: odds != null && odds > 1 && odds < 50 ? odds : null,
      summary,
      threadTitle: b.title,
      sourceUrl: b.url || PROFILE_URL,
    });
  }

  // Dedup
  const seen = new Set<string>();
  return tips.filter((t) => {
    const key = `${t.home}|${t.away}|${t.market}|${t.summary.slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 25);
}

async function fetchTipsterHtml(jar: CookieJar): Promise<string> {
  // Senaste inlägg av tipparen
  const urls = [
    `search.php?do=finduser&userid=${TIPSTER_USER_ID}`,
    `search.php?do=process&searchuser=${TIPSTER_SLUG}&exactname=1&showposts=1&titleonly=0`,
    `member.php?u=${TIPSTER_USER_ID}`,
    `members/${TIPSTER_SLUG}/`,
  ];
  let best = "";
  for (const u of urls) {
    const { text, res } = await sharpsFetch(jar, u);
    if (!res.ok && res.status !== 200) continue;
    if (/permission error|inte inloggad/i.test(text) && text.length < best.length) {
      continue;
    }
    if (text.length > best.length) best = text;
    // finduser räcker ofta
    if (/postbit|postcontent|showthread/i.test(text) && text.length > 5000) {
      return text;
    }
  }
  return best;
}

function emptyFeed(
  partial: Partial<SharpsTipsterFeed> & Pick<SharpsTipsterFeed, "configured" | "ok" | "note">
): SharpsTipsterFeed {
  return {
    tipster: TIPSTER_SLUG,
    profileUrl: PROFILE_URL,
    fetchedAt: new Date().toISOString(),
    error: null,
    tips: [],
    ...partial,
  };
}

/**
 * Hämta senaste tippsignaler från Sharps-medlemmen forbidden_closet.
 * Kräver SHARPS_USERNAME + SHARPS_PASSWORD (forumet är inloggningsväggat).
 */
export async function fetchForbiddenClosetTips(): Promise<SharpsTipsterFeed> {
  if (
    feedCache &&
    Date.now() - feedCache.at < CACHE_MS &&
    !isFreshFetch()
  ) {
    return feedCache.feed;
  }

  const creds = credentials();
  if (!creds) {
    const feed = emptyFeed({
      configured: false,
      ok: false,
      error: "missing_credentials",
      note:
        "Sharps-profilen kräver inloggning. Lägg SHARPS_USERNAME och SHARPS_PASSWORD som hemligheter (Vercel/Cursor) för att hämta forbidden_closet automatiskt.",
    });
    feedCache = { at: Date.now(), feed };
    return feed;
  }

  try {
    const jar: CookieJar = new Map();
    const login = await loginSharps(jar, creds.user, creds.pass);
    if (!login.ok) {
      const feed = emptyFeed({
        configured: true,
        ok: false,
        error: login.error,
        note: login.error || "Inloggning misslyckades",
      });
      feedCache = { at: Date.now(), feed };
      return feed;
    }

    const html = await fetchTipsterHtml(jar);
    if (!html || /permission error|inte inloggad/i.test(html)) {
      const feed = emptyFeed({
        configured: true,
        ok: false,
        error: "forbidden",
        note: "Inloggad men saknar behörighet till tipparens inlägg.",
      });
      feedCache = { at: Date.now(), feed };
      return feed;
    }

    const tips = parseSharpsTipsFromHtml(html);
    const feed = emptyFeed({
      configured: true,
      ok: true,
      tips,
      note: tips.length
        ? `${tips.length} tippsignaler från ${TIPSTER_SLUG} (sammanfattade).`
        : `Inloggad, men inga tydliga tipprader hittades just nu från ${TIPSTER_SLUG}.`,
    });
    feedCache = { at: Date.now(), feed };
    return feed;
  } catch (e) {
    const feed = emptyFeed({
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "Sharps-fel",
      note: "Kunde inte hämta Sharps just nu.",
    });
    feedCache = { at: Date.now(), feed };
    return feed;
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamHit(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter((t) => t.length > 2));
  const tb = new Set(nb.split(" ").filter((t) => t.length > 2));
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits >= 1 && hits >= Math.min(ta.size, tb.size) * 0.5;
}

/** Matcha tippars Över 2,5-signaler mot en kandidatmatch. */
export function sharpsAdjustForMatch(args: {
  feed: SharpsTipsterFeed | null;
  home: string;
  away: string;
}): { scoreDelta: number; notes: string[]; matched: SharpsTipSignal[] } {
  if (!args.feed?.tips?.length) {
    return { scoreDelta: 0, notes: [], matched: [] };
  }
  const matched: SharpsTipSignal[] = [];
  for (const tip of args.feed.tips) {
    if (tip.market !== "over_2_5") continue;
    if (!tip.home || !tip.away) continue;
    const direct =
      teamHit(tip.home, args.home) && teamHit(tip.away, args.away);
    const flip =
      teamHit(tip.home, args.away) && teamHit(tip.away, args.home);
    if (direct || flip) matched.push(tip);
  }
  if (!matched.length) return { scoreDelta: 0, notes: [], matched: [] };

  const scoreDelta = 14 + Math.min(8, matched.length * 3);
  const notes = [
    `Sharps/${TIPSTER_SLUG}: tippar ${matched[0].selection}${
      matched[0].odds != null
        ? ` @ ${matched[0].odds.toFixed(2).replace(".", ",")}`
        : ""
    }`,
  ];
  return { scoreDelta, notes, matched };
}

export const SHARPS_TIPSTER = {
  slug: TIPSTER_SLUG,
  userId: TIPSTER_USER_ID,
  profileUrl: PROFILE_URL,
};
