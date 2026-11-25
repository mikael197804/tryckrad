/**
 * Hämtar fria V75-tips från flera sajter och matchar hästar per avdelning.
 * Paywall/premium-sidor ger ofta bara rubriker – de används som svaga signaler.
 */

export type ExternalTipMention = {
  source: string;
  url: string;
  title: string;
  horseName: string;
  startNumber: number | null;
  leg: number | null;
  snippet: string;
  sentiment: "hot" | "value" | "fade" | "mention";
};

export type TipSourceReport = {
  source: string;
  url: string;
  ok: boolean;
  title: string | null;
  note: string | null;
};

const UA =
  "Mozilla/5.0 (compatible; MikaelsTips/1.0; +https://tryckrad.vercel.app)";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#8230;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(
  url: string,
  timeoutMs = 12000
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xml,application/rss+xml" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(t);
  }
}

function titleFromHtml(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)/i);
  return m ? stripHtml(m[1]).slice(0, 160) : null;
}

function sentimentFromSnippet(snippet: string): ExternalTipMention["sentiment"] {
  const s = snippet.toLowerCase();
  if (
    /överstreck|för mycket spel|missvisande|lita inte|undvik|överspel|procenten är ett skämt|skämt/.test(
      s
    )
  ) {
    return "fade";
  }
  if (
    /skräll|överodds|bortglömd|måste plockas|tidig gardering|värde|för lite spel/.test(
      s
    )
  ) {
    return "value";
  }
  if (
    /spik|pissvinner|svårslagen|bank|favorit|topphäst|streckas|klartecken/.test(s)
  ) {
    return "hot";
  }
  return "mention";
}

function normalizeHorse(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Matcha hästnamn i fri text; returnerar snuttar. */
export function findHorseMentionsInText(
  text: string,
  horses: Array<{ name: string; number: number; leg: number }>,
  source: string,
  url: string,
  title: string
): ExternalTipMention[] {
  const out: ExternalTipMention[] = [];
  const lower = text.toLowerCase();
  const sorted = [...horses].sort((a, b) => b.name.length - a.name.length);

  for (const h of sorted) {
    const needle = h.name.toLowerCase();
    if (needle.length < 5) continue;
    // Kräv ordgräns så korta/delnamn inte träffar överallt
    const re = new RegExp(
      `(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
      "i"
    );
    const m = re.exec(text);
    let idx = m ? m.index + (m[1] ? m[1].length : 0) : -1;
    if (idx < 0) continue;
    const snippet = text
      .slice(Math.max(0, idx - 70), Math.min(text.length, idx + h.name.length + 110))
      .replace(/\s+/g, " ")
      .trim();
    out.push({
      source,
      url,
      title,
      horseName: h.name,
      startNumber: h.number,
      leg: h.leg,
      snippet,
      sentiment: sentimentFromSnippet(snippet),
    });
  }
  return out;
}

/** Travcash: V75-N: M Horse … mönster. */
function parseTravcashLegTips(
  text: string,
  horses: Array<{ name: string; number: number; leg: number }>,
  url: string,
  title: string
): ExternalTipMention[] {
  const out: ExternalTipMention[] = [];
  const re =
    /V75-([1-7])\s*[:.]?\s*([\s\S]{10,400}?)(?=V75-[1-7]\s*[:.]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const leg = Number(m[1]);
    const block = m[2];
    const inLeg = horses.filter((h) => h.leg === leg);
    const mentions = findHorseMentionsInText(
      block,
      inLeg,
      "Travcash",
      url,
      title
    );
    // Numbered picks: "5 Fine Manners"
    for (const h of inLeg) {
      const numRe = new RegExp(
        `(?:^|[^0-9])${h.number}\\s+${h.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i"
      );
      if (numRe.test(block) && !mentions.some((x) => x.horseName === h.name)) {
        const snip = block.match(
          new RegExp(`.{0,40}${h.number}\\s+${h.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,80}`, "i")
        );
        mentions.push({
          source: "Travcash",
          url,
          title,
          horseName: h.name,
          startNumber: h.number,
          leg,
          snippet: (snip?.[0] || block.slice(0, 140)).replace(/\s+/g, " ").trim(),
          sentiment: sentimentFromSnippet(block),
        });
      }
    }
    out.push(...mentions);
  }
  return out;
}

async function discoverTravcashArticle(): Promise<string | null> {
  const hub = await fetchText("https://travcash.se/v75-tips/");
  if (!hub.ok) return null;
  const links = [...hub.text.matchAll(/href="(https:\/\/travcash\.se\/v75-tips\/[^"#]+)"/gi)].map(
    (m) => m[1]
  );
  const article = links.find((l) =>
    /v75-tips-lordag|solvalla|tidiga-tankar/i.test(l)
  );
  return article || links.find((l) => /\/v75-tips\/[^/]+\/?$/i.test(l) && !/page\//i.test(l)) || null;
}

async function scrapeTravcash(
  horses: Array<{ name: string; number: number; leg: number }>
): Promise<{ mentions: ExternalTipMention[]; report: TipSourceReport }> {
  const url =
    (await discoverTravcashArticle()) ||
    "https://travcash.se/v75-tips/";
  const page = await fetchText(url);
  const title = titleFromHtml(page.text) || "Travcash V75";
  if (!page.ok) {
    return {
      mentions: [],
      report: {
        source: "Travcash",
        url,
        ok: false,
        title: null,
        note: `HTTP ${page.status}`,
      },
    };
  }
  const text = stripHtml(page.text);
  const mentions = [
    ...parseTravcashLegTips(text, horses, url, title),
    ...findHorseMentionsInText(text, horses, "Travcash", url, title),
  ];
  // dedupe by horse+leg
  const seen = new Set<string>();
  const uniq = mentions.filter((m) => {
    const k = `${m.leg}:${normalizeHorse(m.horseName)}:${m.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    mentions: uniq,
    report: {
      source: "Travcash",
      url,
      ok: true,
      title,
      note: `${uniq.length} hästomnämnanden`,
    },
  };
}

async function scrapeAftonbladet(
  horses: Array<{ name: string; number: number; leg: number }>
): Promise<{ mentions: ExternalTipMention[]; report: TipSourceReport }> {
  const tagUrl = "https://www.aftonbladet.se/tagg/v75-tips";
  const tag = await fetchText(tagUrl);
  const articleLinks = [
    ...tag.text.matchAll(
      /href="(https:\/\/www\.aftonbladet\.se\/sportbladet\/[^"]+)"/gi
    ),
  ]
    .map((m) => m[1])
    .filter((u) => /v75|premiar|solvalla|klartecken|spikar/i.test(u));
  const uniqLinks = [...new Set(articleLinks)]
    .filter((u) => !/\/tagg\//i.test(u))
    .slice(0, 3);
  const mentions: ExternalTipMention[] = [];
  let lastTitle: string | null = null;
  let usedUrl = tagUrl;

  // Kräv längre namn (≥2 ord eller ≥10 tecken) för att minska falska träffar
  const strictHorses = horses.filter(
    (h) => h.name.trim().split(/\s+/).length >= 2 || h.name.length >= 10
  );

  // Bara artikelsidor – inte taggsidan (arkivlänkar ger brus)
  for (const url of uniqLinks) {
    const page = await fetchText(url);
    if (!page.ok) continue;
    usedUrl = url;
    lastTitle = titleFromHtml(page.text);
    const text = stripHtml(page.text);
    if (!/V75-\d|V75-[1-7]|avdelning/i.test(text) && !/Solvalla/i.test(text)) {
      continue;
    }
    mentions.push(
      ...findHorseMentionsInText(
        text,
        strictHorses,
        "Aftonbladet",
        url,
        lastTitle || "Aftonbladet V75"
      )
    );
  }

  const seen = new Set<string>();
  const uniq = mentions.filter((m) => {
    const k = `${m.leg}:${normalizeHorse(m.horseName)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    mentions: uniq,
    report: {
      source: "Aftonbladet",
      url: usedUrl,
      ok: tag.ok || uniq.length > 0,
      title: lastTitle,
      note: uniq.length
        ? `${uniq.length} hästomnämnanden`
        : tag.ok
          ? "Rubriker/översikt – begränsad fri text"
          : `HTTP ${tag.status}`,
    },
  };
}

async function scrapeExpressenHeadlines(): Promise<{
  mentions: ExternalTipMention[];
  report: TipSourceReport;
}> {
  const url = "https://www.expressen.se/sport/trav/";
  const page = await fetchText(url);
  const title = titleFromHtml(page.text);
  if (!page.ok) {
    return {
      mentions: [],
      report: {
        source: "Expressen",
        url,
        ok: false,
        title: null,
        note: `HTTP ${page.status}`,
      },
    };
  }
  const links = [
    ...page.text.matchAll(/href="(\/sport\/trav\/[^"]+)"/gi),
  ].map((m) => `https://www.expressen.se${m[1]}`);
  const v75 = [...new Set(links.filter((l) => /v75/i.test(l)))].slice(0, 6);
  const headlines: ExternalTipMention[] = [];
  for (const u of v75) {
    const slug = u.split("/").filter(Boolean).pop() || "";
    const nice = slug.replace(/-/g, " ");
    headlines.push({
      source: "Expressen",
      url: u,
      title: nice,
      horseName: "",
      startNumber: null,
      leg: null,
      snippet: nice,
      sentiment: sentimentFromSnippet(nice),
    });
  }
  return {
    mentions: headlines.filter((h) => h.snippet.length > 8),
    report: {
      source: "Expressen",
      url,
      ok: true,
      title: title,
      note: `${v75.length} V75-artiklar (ofta premium – rubriker jämförs)`,
    },
  };
}

async function scrapeSulkysport(): Promise<{
  mentions: ExternalTipMention[];
  report: TipSourceReport;
}> {
  const url = "https://sulkysport.se/tag/v75/";
  const page = await fetchText(url);
  const title = titleFromHtml(page.text);
  if (!page.ok) {
    return {
      mentions: [],
      report: {
        source: "Sulkysport",
        url,
        ok: false,
        title: null,
        note: `HTTP ${page.status}`,
      },
    };
  }
  const text = stripHtml(page.text);
  const snippets = [...text.matchAll(/.{0,20}V75.{0,80}/gi)]
    .slice(0, 5)
    .map((m) => m[0].replace(/\s+/g, " ").trim());
  return {
    mentions: snippets.map((s) => ({
      source: "Sulkysport",
      url,
      title: title || "Sulkysport V75",
      horseName: "",
      startNumber: null,
      leg: null,
      snippet: s,
      sentiment: sentimentFromSnippet(s),
    })),
    report: {
      source: "Sulkysport",
      url,
      ok: true,
      title,
      note: snippets.length
        ? "Tagg/översikt – mycket bakom prenumeration"
        : "Inga öppna V75-snuttar",
    },
  };
}

async function scrapeGoogleNewsHeadlinesFor(
  product: "V75" | "V64" = "V75"
): Promise<{
  mentions: ExternalTipMention[];
  report: TipSourceReport;
}> {
  const q =
    product === "V64"
      ? "V64+tips+ATG"
      : "V75+tips+Solvalla";
  const url = `https://news.google.com/rss/search?q=${q}&hl=sv&gl=SE&ceid=SE:sv`;
  const page = await fetchText(url);
  if (!page.ok) {
    return {
      mentions: [],
      report: {
        source: "Google News",
        url,
        ok: false,
        title: null,
        note: `HTTP ${page.status}`,
      },
    };
  }
  const items = [...page.text.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(
    0,
    12
  );
  const productRe = product === "V64" ? /v64/i : /v75/i;
  const mentions: ExternalTipMention[] = [];
  for (const it of items) {
    const block = it[1];
    const titleM =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
      block.match(/<title>(.*?)<\/title>/);
    const title = stripHtml(titleM?.[1] || "");
    const sourceM = block.match(/<source[^>]*>(.*?)<\/source>/);
    const source = stripHtml(sourceM?.[1] || "Nyhet");
    if (!title || !productRe.test(title)) continue;
    mentions.push({
      source: `Google News · ${source}`,
      url,
      title,
      horseName: "",
      startNumber: null,
      leg: null,
      snippet: title,
      sentiment: sentimentFromSnippet(title),
    });
  }
  return {
    mentions,
    report: {
      source: "Google News",
      url,
      ok: true,
      title: `${product} tips – RSS`,
      note: `${mentions.length} rubriker`,
    },
  };
}

async function scrapeGoogleNewsHeadlines(): Promise<{
  mentions: ExternalTipMention[];
  report: TipSourceReport;
}> {
  return scrapeGoogleNewsHeadlinesFor("V75");
}

/** Externa tips – samma sajter; V64 söker V64-sidor där det går. */
export async function collectExternalAtgTips(
  product: "V75" | "V64",
  horses: Array<{ name: string; number: number; leg: number }>
): Promise<{
  mentions: ExternalTipMention[];
  sources: TipSourceReport[];
}> {
  // Tipsscrapers är V75-orienterade; hästnamnsmatchning fungerar ändå för V64.
  // Google News anpassas till produkten.
  const tasks =
    product === "V64"
      ? [
          scrapeTravcash(horses),
          scrapeAftonbladet(horses),
          scrapeExpressenHeadlines(),
          scrapeSulkysport(),
          scrapeGoogleNewsHeadlinesFor("V64"),
        ]
      : [
          scrapeTravcash(horses),
          scrapeAftonbladet(horses),
          scrapeExpressenHeadlines(),
          scrapeSulkysport(),
          scrapeGoogleNewsHeadlines(),
        ];
  const settled = await Promise.allSettled(tasks);
  const mentions: ExternalTipMention[] = [];
  const sources: TipSourceReport[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") {
      mentions.push(...s.value.mentions);
      sources.push(s.value.report);
    } else {
      sources.push({
        source: "okänd",
        url: "",
        ok: false,
        title: null,
        note: String(s.reason || "fel"),
      });
    }
  }
  return { mentions, sources };
}

export async function collectExternalV75Tips(
  horses: Array<{ name: string; number: number; leg: number }>
): Promise<{
  mentions: ExternalTipMention[];
  sources: TipSourceReport[];
}> {
  return collectExternalAtgTips("V75", horses);
}
