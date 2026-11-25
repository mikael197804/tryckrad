/**
 * Lagbloggar / klubbnyheter / lokala vloggar för Powerplay (särskilt HockeyEttan).
 * Läses in tillsammans med övriga artiklar och ger formsignaler till tipplogiken.
 */

import type { Article, MatchAnalysis, Outcome } from "./types";
import { upstreamFetchInit } from "./fetch-mode";

export type TeamMediaSignal = {
  team: string;
  /** Positiv form (segrar, bra citat) → högre score för laget. */
  form: "hot" | "cold" | "mixed" | "unknown";
  note: string;
  sources: string[];
};

type FeedItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
  matchedTeams: string[];
};

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&");
}

function stripHtml(html: string): string {
  const once = decodeEntities(html);
  const noTags = once
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(noTags).replace(/\s+/g, " ").trim();
}

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Klubbsidor / bloggar – utökas vid behov. */
const CLUB_SITES: Array<{
  keys: string[];
  name: string;
  home: string;
  newsPaths?: string[];
}> = [
  {
    keys: ["mjolby", "mjölby"],
    name: "Mjölby",
    home: "https://www.mhc.se/",
    newsPaths: ["/nyheter", "/mhc-mhcherr"],
  },
  {
    keys: ["boro", "vetlanda", "borovetlanda"],
    name: "Boro/Vetlanda HC",
    home: "https://borovhc.se/",
    newsPaths: ["/nyheter/?ID=460671", "/start/?ID=460817"],
  },
  {
    keys: ["kalmar"],
    name: "Kalmar",
    home: "https://www.kalmarhockey.com/",
  },
  {
    keys: ["sodertalje", "södertälje"],
    name: "Södertälje",
    home: "https://www.sodertaljesk.se/",
  },
  {
    keys: ["mora"],
    name: "Mora",
    home: "https://www.moraik.se/",
  },
  {
    keys: ["vasteras", "västerås"],
    name: "Västerås",
    home: "https://www.vik.se/",
  },
  {
    keys: ["nybro"],
    name: "Nybro",
    home: "https://www.nybrovikings.com/",
  },
  {
    keys: ["vimmerby"],
    name: "Vimmerby",
    home: "https://www.vimmerbyhockey.se/",
  },
  {
    keys: ["almtuna"],
    name: "Almtuna",
    home: "https://www.almtuna.com/",
  },
  {
    keys: ["vita hasten", "vitahasten", "vita hästen"],
    name: "Vita Hästen",
    home: "https://www.hcvitahasten.se/",
  },
  {
    keys: ["boras", "borås"],
    name: "Borås",
    home: "https://www.borashockey.se/",
  },
];

const textCache = new Map<string, Promise<string | null>>();

async function fetchText(url: string): Promise<string | null> {
  const cached = textCache.get(url);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const res = await fetch(
        url,
        upstreamFetchInit({
          headers: {
            "User-Agent": "TryckRad/1.0 (lagblogg-analys)",
            Accept: "text/html, application/rss+xml, application/xml, */*",
          },
          next: { revalidate: 300 },
        })
      );
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  })();
  textCache.set(url, pending);
  return pending;
}

function parseRssItems(xml: string, source: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks.slice(0, 25)) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ??
      block.match(/<title>(.*?)<\/title>/i)?.[1] ??
      "";
    const link =
      block.match(/<link>(.*?)<\/link>/i)?.[1]?.trim() ??
      block.match(/<guid[^>]*>(.*?)<\/guid>/i)?.[1]?.trim() ??
      "";
    const desc =
      block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/is)?.[1] ??
      block.match(/<description>(.*?)<\/description>/is)?.[1] ??
      "";
    const pub = block.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] ?? null;
    if (!title || !link) continue;
    items.push({
      title: stripHtml(title),
      url: link.startsWith("http") ? link : `https://${link}`,
      source,
      publishedAt: pub,
      snippet: stripHtml(desc).slice(0, 280),
      matchedTeams: [],
    });
  }
  return items;
}

function clubForTeam(teamName: string) {
  const n = normalizeTeam(teamName);
  return (
    CLUB_SITES.find((c) =>
      c.keys.some((k) => n.includes(normalizeTeam(k)) || normalizeTeam(k).includes(n))
    ) || null
  );
}

function absoluteUrl(base: string, href: string): string | null {
  if (!href || href.startsWith("javascript:") || href.startsWith("#")) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Plocka nyhetslänkar från klubbsida. */
function extractNewsLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const re = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (!/nyhet|news|blogg|vlogg|artikel|match|seger|forlust|förlust/i.test(href)) {
      continue;
    }
    const abs = absoluteUrl(baseUrl, href);
    if (!abs) continue;
    if (!abs.includes(new URL(baseUrl).hostname) && !/sportadmin\.se/i.test(abs)) {
      continue;
    }
    links.push(abs.split("#")[0]);
  }
  return [...new Set(links)].slice(0, 8);
}

function titleFromHtml(html: string): string {
  return stripHtml(
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      ""
  ).slice(0, 160);
}

function snippetFromHtml(html: string): string {
  const body =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    html;
  return stripHtml(body).slice(0, 320);
}

function sentimentForm(
  text: string
): { form: TeamMediaSignal["form"]; note: string } {
  const t = text.toLowerCase();
  const win =
    /(seger|vann|vinst|storseger|bortaseger|hemmaseger|tog tre poäng|3 poäng)/i.test(
      t
    );
  const loss =
    /(förlust|föll|förlorade|tappade|underläge|tung förlust|nollade)/i.test(t);
  const injury =
    /(skadad|skada|missar match|borta skada|avstängd|sjukdom)/i.test(t);
  const hotForm =
    /(andra raka|raka segrar|formtopp|stabil match|aldrig tvivlat|stärkt)/i.test(
      t
    );

  if (injury && loss) {
    return { form: "cold", note: "blogg: skada/förlust nämns" };
  }
  if (win && hotForm) {
    return { form: "hot", note: "blogg: stark form / raka segrar" };
  }
  if (win && !loss) {
    return { form: "hot", note: "blogg: seger rapporterad" };
  }
  if (loss && !win) {
    return { form: "cold", note: "blogg: förlust rapporterad" };
  }
  if (win && loss) {
    return { form: "mixed", note: "blogg: blandad form" };
  }
  if (injury) {
    return { form: "cold", note: "blogg: skadenytt" };
  }
  return { form: "unknown", note: "blogg läst" };
}

async function scrapeClubSite(
  teamName: string
): Promise<{ items: FeedItem[]; signal: TeamMediaSignal | null }> {
  const club = clubForTeam(teamName);
  if (!club) return { items: [], signal: null };

  const homeHtml = await fetchText(club.home);
  if (!homeHtml) return { items: [], signal: null };

  const paths = club.newsPaths || [];
  const pageUrls = [
    club.home,
    ...paths.map((p) => absoluteUrl(club.home, p)).filter(Boolean) as string[],
  ];
  const linkSet = new Set<string>();
  for (const page of pageUrls.slice(0, 3)) {
    const html = page === club.home ? homeHtml : await fetchText(page);
    if (!html) continue;
    for (const link of extractNewsLinks(html, page)) linkSet.add(link);
  }

  const items: FeedItem[] = [];
  const texts: string[] = [stripHtml(homeHtml).slice(0, 800)];
  for (const url of [...linkSet].slice(0, 4)) {
    const html = await fetchText(url);
    if (!html) continue;
    const title = titleFromHtml(html);
    const snippet = snippetFromHtml(html);
    if (!title || title.length < 8) continue;
    items.push({
      title,
      url,
      source: `Lagblogg · ${club.name}`,
      publishedAt: null,
      snippet,
      matchedTeams: [teamName],
    });
    texts.push(`${title} ${snippet}`);
  }

  // Fallback: startsida som artikel om inga djuplänkar
  if (!items.length) {
    items.push({
      title: `${club.name} – klubbsida`,
      url: club.home,
      source: `Lagblogg · ${club.name}`,
      publishedAt: null,
      snippet: stripHtml(homeHtml).slice(0, 280),
      matchedTeams: [teamName],
    });
  }

  const joined = texts.join(" · ");
  const { form, note } = sentimentForm(joined);
  return {
    items,
    signal: {
      team: teamName,
      form,
      note: `${note} (${club.name})`,
      sources: items.map((i) => i.source),
    },
  };
}

async function googleTeamBlogFeed(
  teamName: string
): Promise<FeedItem[]> {
  const q = `${teamName} (ishockey OR hockey) (blogg OR vlogg OR nyheter OR matchrapport)`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    q
  )}&hl=sv&gl=SE&ceid=SE:sv`;
  const xml = await fetchText(url);
  if (!xml) return [];
  return parseRssItems(xml, `Vlogg/blogg · ${teamName}`).map((item) => ({
    ...item,
    matchedTeams: [teamName],
  }));
}

export async function collectTeamBlogMedia(
  matches: MatchAnalysis[]
): Promise<{ articles: Article[]; signals: TeamMediaSignal[] }> {
  const teams = [
    ...new Set(matches.flatMap((m) => [m.home.name, m.away.name])),
  ].slice(0, 12);

  const articles: Article[] = [];
  const signals: TeamMediaSignal[] = [];
  const seen = new Set<string>();

  await Promise.all(
    teams.map(async (team) => {
      const [club, gnews] = await Promise.all([
        scrapeClubSite(team),
        googleTeamBlogFeed(team),
      ]);
      if (club.signal && club.signal.form !== "unknown") {
        signals.push(club.signal);
      } else if (club.signal) {
        signals.push(club.signal);
      }
      for (const item of [...club.items, ...gnews.slice(0, 4)]) {
        const key = `${item.source}|${item.title.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        articles.push({
          title: item.title,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
          snippet: item.snippet,
          matchedTeams: item.matchedTeams.length
            ? item.matchedTeams
            : [team],
          drawNumbers: [],
        });
      }
    })
  );

  return { articles, signals };
}

/**
 * Justera 1X2-scores utifrån lagbloggar (form/skador).
 * Returnerar nya score-värden + ev. tippjustering.
 */
export function applyTeamMediaToMatch(
  m: MatchAnalysis,
  signals: TeamMediaSignal[]
): {
  score1: number;
  scoreX: number;
  score2: number;
  notes: string[];
  forceCoverAway?: boolean;
} {
  const notes: string[] = [];
  let s1 = m.score1;
  let sX = m.scoreX;
  let s2 = m.score2;
  let forceCoverAway = false;

  const homeSig = signals.find(
    (s) => normalizeTeam(s.team) === normalizeTeam(m.home.name)
  );
  const awaySig = signals.find(
    (s) => normalizeTeam(s.team) === normalizeTeam(m.away.name)
  );

  if (homeSig) {
    notes.push(`${m.home.name}: ${homeSig.note}`);
    if (homeSig.form === "hot") {
      s1 += 0.035;
    } else if (homeSig.form === "cold") {
      s1 -= 0.05;
      s2 += 0.035;
      forceCoverAway = true;
    }
  }
  if (awaySig) {
    notes.push(`${m.away.name}: ${awaySig.note}`);
    if (awaySig.form === "hot") {
      s2 += 0.05;
      s1 -= 0.03;
      forceCoverAway = true;
    } else if (awaySig.form === "cold") {
      s2 -= 0.04;
      s1 += 0.025;
    }
  }

  // Blogg: hemma “het” men borta också het / kall hemma → täck 2
  if (homeSig?.form === "hot" && awaySig?.form === "hot") {
    forceCoverAway = true;
    notes.push("båda lagen heta enligt blogg – täck bortasegern");
  }

  const sum = Math.max(s1 + sX + s2, 0.01);
  return {
    score1: s1 / sum,
    scoreX: sX / sum,
    score2: s2 / sum,
    notes,
    forceCoverAway,
  };
}

export function mergeMediaIntoPick(
  pick: Outcome[],
  forceCoverAway: boolean | undefined
): Outcome[] {
  if (!forceCoverAway) return pick;
  const next = new Set(pick);
  next.add("2");
  if (next.size === 1 && next.has("1")) {
    next.add("2");
  }
  // Föredra 12 framför 1X när bortatäckning krävs
  if (next.has("1") && next.has("X") && next.has("2") === false) {
    next.delete("X");
    next.add("2");
  }
  return (["1", "X", "2"] as Outcome[]).filter((o) => next.has(o));
}
