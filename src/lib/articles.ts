import type { Article, MatchAnalysis } from "./types";

type FeedItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
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
  const noTags = once.replace(/<[^>]+>/g, " ");
  return decodeEntities(noTags).replace(/\s+/g, " ").trim();
}

function parseRssItems(xml: string, source: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks.slice(0, 40)) {
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
    const pub =
      block.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] ?? null;
    if (!title || !link) continue;
    items.push({
      title: stripHtml(title),
      url: link.startsWith("http") ? link : `https://${link}`,
      source,
      publishedAt: pub,
      snippet: stripHtml(desc).slice(0, 220),
    });
  }
  return items;
}

const textCache = new Map<string, Promise<string | null>>();

async function fetchText(url: string): Promise<string | null> {
  const cached = textCache.get(url);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "TryckRad/1.0 (nyhetsanalys)",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        next: { revalidate: 300 },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  })();
  textCache.set(url, pending);
  return pending;
}

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const TEAM_ALIASES: Record<string, string[]> = {
  brynas: ["brynas", "brynäs"],
  lulea: ["lulea", "luleå"],
  djurgarden: ["djurgarden", "djurgården", "dif"],
  skelleftea: ["skelleftea", "skellefteå"],
  malmo: ["malmo", "malmö", "mif"],
  rogle: ["rogle", "röglen", "röglen"],
  vaxjo: ["vaxjo", "växjö"],
  bjorkloven: ["bjorkloven", "björklöven"],
  linkoping: ["linkoping", "linköping", "lhc"],
  hv71: ["hv71", "hv 71"],
  timra: ["timra", "timrå"],
  orebro: ["orebro", "örebro"],
  farjestad: ["farjestad", "färjestad", "fbk"],
  frolunda: ["frolunda", "frölunda"],
  aik: ["aik"],
  sodertalje: ["sodertalje", "södertälje"],
  moda: ["modo", "modo hockey"],
  toronto: ["toronto", "maple leafs"],
  carolina: ["carolina", "hurricanes"],
  pittsburgh: ["pittsburgh", "penguins"],
};

function aliasKeysFor(name: string): string[] {
  const n = normalizeTeam(name);
  const keys = [n, name.toLowerCase()];
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some((a) => normalizeTeam(a) === n || n.includes(key))) {
      keys.push(key, ...aliases.map(normalizeTeam));
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

function articleMatchesTeams(
  item: FeedItem,
  matches: MatchAnalysis[]
): { teams: string[]; draws: number[] } {
  const hay = normalizeTeam(`${item.title} ${item.snippet}`);
  const teams: string[] = [];
  const draws = new Set<number>();

  for (const m of matches) {
    const homeKeys = aliasKeysFor(m.home.name);
    const awayKeys = aliasKeysFor(m.away.name);
    const hitHome = homeKeys.some((k) => k.length > 3 && hay.includes(k));
    const hitAway = awayKeys.some((k) => k.length > 3 && hay.includes(k));
    if (hitHome || hitAway) {
      if (hitHome) teams.push(m.home.name);
      if (hitAway) teams.push(m.away.name);
    }
  }
  return { teams: [...new Set(teams)], draws: [...draws] };
}

export async function fetchArticlesForMatches(
  matches: MatchAnalysis[],
  drawNumber: number,
  product: "powerplay" | "topptipset" = "powerplay"
): Promise<Article[]> {
  const teamQuery = [
    ...new Set(matches.flatMap((m) => [m.home.name, m.away.name])),
  ]
    .slice(0, 6)
    .join(" OR ");

  const feeds: { url: string; source: string }[] =
    product === "topptipset"
      ? [
          {
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(
              `fotboll (${teamQuery || "Premier League"})`
            )}&hl=sv&gl=SE&ceid=SE:sv`,
            source: "Google Nyheter",
          },
          {
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(
              "Topptipset tips Svenska Spel"
            )}&hl=sv&gl=SE&ceid=SE:sv`,
            source: "Topptipset-tips",
          },
          {
            url: "https://www.fotbollskanalen.se/rss/",
            source: "Fotbollskanalen",
          },
        ]
      : [
          { url: "https://hockeysverige.se/feed/", source: "Hockeysverige" },
          {
            url: "https://www.shl.se/api/articles?take=20",
            source: "SHL",
          },
          {
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(
              `ishockey (${teamQuery || "SHL"})`
            )}&hl=sv&gl=SE&ceid=SE:sv`,
            source: "Google Nyheter",
          },
          {
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(
              "Powerplay tips ishockey Svenska Spel"
            )}&hl=sv&gl=SE&ceid=SE:sv`,
            source: "Powerplay-tips",
          },
        ];

  const collected: FeedItem[] = [];

  await Promise.all(
    feeds.map(async (feed) => {
      const text = await fetchText(feed.url);
      if (!text) return;
      if (feed.source === "SHL" && text.trim().startsWith("[")) {
        try {
          const json = JSON.parse(text) as Array<{
            title?: string;
            url?: string;
            publishedAt?: string;
            preamble?: string;
          }>;
          for (const row of json.slice(0, 20)) {
            if (!row.title || !row.url) continue;
            collected.push({
              title: row.title,
              url: row.url.startsWith("http")
                ? row.url
                : `https://www.shl.se${row.url}`,
              source: "SHL",
              publishedAt: row.publishedAt ?? null,
              snippet: row.preamble ?? "",
            });
          }
        } catch {
          /* ignore */
        }
        return;
      }
      collected.push(...parseRssItems(text, feed.source));
    })
  );

  const articles: Article[] = [];
  const seen = new Set<string>();

  for (const item of collected) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { teams } = articleMatchesTeams(item, matches);
    // Keep general hockey/powerplay articles too, but prioritize match hits
    if (teams.length === 0) {
      const general =
        (product === "topptipset"
          ? /topptipset|premier|champions|allsvenskan|tips|match/i.test(
              item.title
            ) || /topptipset|tips/i.test(item.snippet)
          : /powerplay|shl|hockeyallsvenskan|nhl|tips|match/i.test(
              item.title
            ) || /powerplay|shl|tips/i.test(item.snippet));
      if (!general) continue;
    }
    articles.push({
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
      snippet: item.snippet,
      matchedTeams: teams,
      drawNumbers: [drawNumber],
    });
  }

  articles.sort((a, b) => {
    if (b.matchedTeams.length !== a.matchedTeams.length) {
      return b.matchedTeams.length - a.matchedTeams.length;
    }
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  return articles.slice(0, 12);
}
