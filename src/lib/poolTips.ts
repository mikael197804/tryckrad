/**
 * Hämtar öppna tippsajter (Hurbra, RekatOchKlart, Expressen, Tipshunter, Betii)
 * och matchar spikar/varningar mot kupongens lag – samma idé som v75Tips.
 */

import type { MatchAnalysis, Outcome } from "./types";

export type ExpertTipMention = {
  source: string;
  url: string;
  title: string;
  team: string;
  eventNumber: number | null;
  outcome: Outcome | null;
  kind: "spik" | "fade" | "cover" | "mention" | "open";
  snippet: string;
  /** Om open: spelarnamn eller kort hint från snutten */
  playerHint?: string | null;
};

export type ExpertTipSourceReport = {
  source: string;
  url: string;
  ok: boolean;
  title: string | null;
  note: string | null;
};

export type ExpertSpikeConsensus = {
  eventNumber: number;
  description: string;
  outcome: Outcome;
  sources: string[];
  voteCount: number;
  kind: "spik" | "fade" | "cover" | "open";
  note: string;
  playerHint?: string | null;
};

export type PoolExpertTipsResult = {
  mentions: ExpertTipMention[];
  consensus: ExpertSpikeConsensus[];
  sources: ExpertTipSourceReport[];
  summary: string[];
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

function titleFromHtml(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)/i);
  return m ? stripHtml(m[1]).slice(0, 160) : null;
}

async function fetchText(
  url: string,
  timeoutMs = 12000
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
      },
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

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TEAM_ALIASES: Record<string, string[]> = {
  brynas: ["brynas", "bif"],
  orebro: ["orebro"],
  hv71: ["hv71", "hv 71", "hv"],
  bjorkloven: ["bjorkloven", "loven"],
  skelleftea: ["skelleftea", "saik"],
  farjestad: ["farjestad", "fbk"],
  malmo: ["malmo", "redhawks", "mif"],
  djurgarden: ["djurgarden", "dif"],
  timra: ["timra"],
  linkoping: ["linkoping", "lhc"],
  vaxjo: ["vaxjo", "lakers"],
  frolunda: ["frolunda"],
  lulea: ["lulea"],
  rogle: ["rogle"],
  mjolby: ["mjolby"],
  "vita hasten": ["vita hasten", "vh"],
  "aston villa": ["aston villa", "villa"],
  ipswich: ["ipswich"],
  leeds: ["leeds"],
  coventry: ["coventry"],
  orebrosk: ["orebro", "enkoping"],
};

function teamNeedles(name: string): string[] {
  const n = normalizeTeam(name);
  const out = new Set<string>([n]);
  // Första ordet om det är ≥4 tecken (Brynäs, Malmö …)
  const first = n.split(" ")[0];
  if (first && first.length >= 4) out.add(first);
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    if (n.includes(key) || aliases.some((a) => n.includes(a))) {
      out.add(key);
      for (const a of aliases) out.add(a);
    }
  }
  return [...out].filter((x) => x.length >= 3);
}

function dateSlugs(now = new Date()): {
  day: number;
  month: number;
  year: number;
  monthNameSv: string;
  ddmmyy: string;
  ddmm: string;
} {
  const day = now.getUTCDate();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const names = [
    "januari",
    "februari",
    "mars",
    "april",
    "maj",
    "juni",
    "juli",
    "augusti",
    "september",
    "oktober",
    "november",
    "december",
  ];
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return {
    day,
    month,
    year,
    monthNameSv: names[month - 1]!,
    ddmmyy: `${dd}/${mm}`,
    ddmm: `${dd}-${mm}`,
  };
}

/** Tung frånvaro-narrativ: nyckelspelare borta → matchen kan gå hur som helst. */
function isKeyPlayerOutOpenNarrative(snippet: string): {
  hit: boolean;
  playerHint: string | null;
} {
  const s = snippet.toLowerCase();
  const absence =
    /\b(missar|borta|skadad|saknas|utesluten|avstängd|out|ruled out|sidelined|injured|unavailable|won't play|will miss)\b/.test(
      s
    );
  const doom =
    /\b(utan honom|utan henne|utan sin|kan inte vinna|svårt att vinna|omöjligt att vinna|beroende av|nyckelspelare|stjärnan|avgörande spelare|ryggraden|hjärtat i|saknar sin|tung frånvaro|kännbart|kännbar frånvaro|stor frånvaro|saknar .+ i truppen)\b/.test(
      s
    ) ||
    /\b(utan|without)\b.{0,40}\b(vinna|win|seger)\b/.test(s) ||
    /\b(can't|cannot|hard to)\b.{0,30}\bwin\b/.test(s);
  if (!(absence && doom) && !(absence && /\b(stjärn|nyckel|första\s*center|första\s*back|målvakt|kapten)\b/.test(s) && /\b(tung|stor|kännbar|avgörande)\b/.test(s))) {
    // Enkel variant: tippare säger uttryckligen att det kan gå hur som helst p.g.a. frånvaro
    if (
      absence &&
      /\b(hur som helst|öppet kort|svårbedömt|oförutsägbar|lotteri|allt kan hända)\b/.test(s)
    ) {
      const player =
        snippet.match(
          /\b([A-ZÅÄÖ][\w'’-]+(?:\s+[A-ZÅÄÖ][\w'’-]+)?)\b(?:\s+(?:missar|borta|skadad|saknas))/
        )?.[1] ?? null;
      return { hit: true, playerHint: player };
    }
    return { hit: false, playerHint: null };
  }
  const player =
    snippet.match(
      /\b([A-ZÅÄÖ][\w'’-]+(?:\s+[A-ZÅÄÖ][\w'’-]+)?)\b(?:\s+(?:missar|borta|skadad|saknas|out|ruled))/i
    )?.[1] ??
    snippet.match(
      /(?:utan|without)\s+([A-ZÅÄÖ][\w'’-]+(?:\s+[A-ZÅÄÖ][\w'’-]+)?)/i
    )?.[1] ??
    null;
  return { hit: true, playerHint: player };
}

function classifySnippet(
  snippet: string
): { kind: ExpertTipMention["kind"]; outcome: Outcome | null } {
  if (isKeyPlayerOutOpenNarrative(snippet).hit) {
    return { kind: "open", outcome: null };
  }
  const s = snippet.toLowerCase();
  let outcome: Outcome | null = null;
  // Tecken i närheten: "tips: 1", "spikar 1", "singeletta", "tvåan"
  if (
    /\b(tips|spel|spik|tecken)\s*[:\-]?\s*1\b/.test(s) ||
    /\bsingelet+a\b/.test(s) ||
    /\bettan\b/.test(s) ||
    /\bhemma(seger|laget)\b/.test(s)
  ) {
    outcome = "1";
  } else if (
    /\b(tips|spel|spik|tecken)\s*[:\-]?\s*2\b/.test(s) ||
    /\bsingeltv[aå]an\b/.test(s) ||
    /\btv[aå]an\b/.test(s) ||
    /\bborta(seger|laget)\b/.test(s)
  ) {
    outcome = "2";
  } else if (
    /\b(tips|spel|spik|tecken)\s*[:\-]?\s*x\b/.test(s) ||
    /\bkryss(et)?\b/.test(s)
  ) {
    outcome = "X";
  }

  if (
    /överstreck|varning|fälla|lämnar?\s+ettan|undvik|inte\s+spika|helgarder|1x2|x2\b|12\b/.test(
      s
    ) &&
    /överstreck|varning|fälla|lämnar?\s+ettan|undvik|helgarder/.test(s)
  ) {
    return { kind: "fade", outcome };
  }
  if (
    /spik|kassask[aå]p|bankare|klar\s+favorit|främsta\s+spik|dagens\s+bästa|all\s+in|förtroendet\s+som\s+spik|singlad|spelvärd\s+singel/.test(
      s
    )
  ) {
    return { kind: "spik", outcome: outcome ?? null };
  }
  if (/halvgarder|helgarder|1x\b|x2\b|12\b|1x2/.test(s)) {
    return { kind: "cover", outcome };
  }
  return { kind: "mention", outcome };
}

/** Rubrik-mönster: "kassaskåp - Brynäs", "1. Skellefteå - Färjestad 1", m.m. */
function extractHeadlineSpikes(
  text: string,
  matches: MatchAnalysis[],
  source: string,
  url: string,
  title: string
): ExpertTipMention[] {
  const out: ExpertTipMention[] = [];
  const patterns = [
    /kassask[aå]p[^a-z0-9]{0,12}([a-zåäöéü0-9][a-zåäöéü0-9\s\/\-]{1,28})/gi,
    /bästa\s+spik[^a-z0-9]{0,20}([a-zåäöéü0-9][a-zåäöéü0-9\s\/\-]{1,28})/gi,
    /främsta\s+spik(?:bud)?[^a-z0-9]{0,20}([a-zåäöéü0-9][a-zåäöéü0-9\s\/\-]{1,28})/gi,
    /all\s+in[^a-z0-9]{0,8}([a-zåäöéü0-9][a-zåäöéü0-9\s\/\-]{1,28})/gi,
    /spikad\s+etta[^.]{0,40}/gi,
    /singelet+a[^.]{0,60}/gi,
    /dagens\s+bästa[^.!]{0,80}/gi,
  ];

  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const snippet = m[0].replace(/\s+/g, " ").trim();
      for (const match of matches) {
        for (const side of [match.home.name, match.away.name] as const) {
          const needles = teamNeedles(side);
          if (!needles.some((n) => normalizeTeam(snippet).includes(n))) {
            continue;
          }
          const outcome = side === match.home.name ? "1" : "2";
          out.push({
            source,
            url,
            title,
            team: side,
            eventNumber: match.eventNumber,
            outcome,
            kind: "spik",
            snippet: snippet.slice(0, 180),
          });
        }
      }
    }
  }

  // "1. Skellefteå - Färjestad 1" / "3. Brynäs – Örebro 1" i tipptabeller
  for (const match of matches) {
    const homeN = teamNeedles(match.home.name)[0];
    const awayN = teamNeedles(match.away.name)[0];
    if (!homeN || !awayN) continue;
    const rowRe = new RegExp(
      `${homeN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,40}${awayN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,24}\\b(1|x|2|1x2|12|1x|x2)\\b`,
      "i"
    );
    const row = rowRe.exec(text);
    if (!row) continue;
    const mark = row[1]!.toUpperCase();
    const snippet = row[0].replace(/\s+/g, " ").trim().slice(0, 180);
    if (mark === "1" || mark === "2" || mark === "X") {
      out.push({
        source,
        url,
        title,
        team: mark === "2" ? match.away.name : match.home.name,
        eventNumber: match.eventNumber,
        outcome: mark as Outcome,
        kind: "spik",
        snippet,
      });
    } else {
      out.push({
        source,
        url,
        title,
        team: match.home.name,
        eventNumber: match.eventNumber,
        outcome: null,
        kind: "cover",
        snippet,
      });
    }
  }

  return out;
}

/** Extra sweep: frånvaro + "kan inte vinna" nära lag/spelare i hela artikeln. */
function extractOpenFromAbsence(
  text: string,
  matches: MatchAnalysis[],
  source: string,
  url: string,
  title: string
): ExpertTipMention[] {
  const out: ExpertTipMention[] = [];
  const patterns = [
    /.{0,80}\b(?:missar|borta|skadad|saknas|utesluten|avstängd)\b.{0,100}\b(?:utan honom|utan henne|kan inte vinna|svårt att vinna|tung frånvaro|kännbar frånvaro|hur som helst|öppet kort)\b.{0,60}/gi,
    /.{0,80}\b(?:utan honom|utan henne|kan inte vinna|svårt att vinna|tung frånvaro|kännbar frånvaro)\b.{0,100}\b(?:missar|borta|skadad|saknas)\b.{0,60}/gi,
    /.{0,60}\b(?:stjärnan|nyckelspelaren|kaptenen|första\s*centern|målvakten)\b.{0,40}\b(?:missar|borta|skadad|saknas)\b.{0,80}/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const snippet = m[0].replace(/\s+/g, " ").trim();
      const open = isKeyPlayerOutOpenNarrative(snippet);
      if (!open.hit && !/\b(missar|borta|skadad|saknas)\b/i.test(snippet)) {
        continue;
      }
      for (const match of matches) {
        for (const side of [match.home.name, match.away.name] as const) {
          const needles = teamNeedles(side);
          if (!needles.some((n) => normalizeTeam(snippet).includes(n))) {
            continue;
          }
          out.push({
            source,
            url,
            title,
            team: side,
            eventNumber: match.eventNumber,
            outcome: null,
            kind: "open",
            snippet: snippet.slice(0, 200),
            playerHint: open.playerHint,
          });
        }
      }
    }
  }
  return out;
}

function findTeamMentions(
  text: string,
  matches: MatchAnalysis[],
  source: string,
  url: string,
  title: string
): ExpertTipMention[] {
  const out: ExpertTipMention[] = [
    ...extractHeadlineSpikes(text, matches, source, url, title),
    ...extractOpenFromAbsence(text, matches, source, url, title),
  ];
  const lower = text.toLowerCase();

  for (const m of matches) {
    for (const side of [m.home.name, m.away.name] as const) {
      const needles = teamNeedles(side);
      for (const needle of needles) {
        const re = new RegExp(
          `(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
          "i"
        );
        let searchFrom = 0;
        let hit = 0;
        while (hit < 4) {
          const slice = lower.slice(searchFrom);
          const found = re.exec(slice);
          if (!found || found.index == null) break;
          const abs = searchFrom + found.index;
          const start = Math.max(0, abs - 160);
          const end = Math.min(text.length, abs + needle.length + 180);
          const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
          const openInfo = isKeyPlayerOutOpenNarrative(snippet);
          const { kind, outcome } = openInfo.hit
            ? { kind: "open" as const, outcome: null }
            : classifySnippet(snippet);
          let resolved = outcome;
          if (kind === "spik" && !resolved) {
            resolved = side === m.home.name ? "1" : "2";
          } else if (kind === "spik" && resolved) {
            if (resolved === "1" && side === m.away.name) {
              searchFrom = abs + needle.length;
              hit++;
              continue;
            }
            if (resolved === "2" && side === m.home.name) {
              searchFrom = abs + needle.length;
              hit++;
              continue;
            }
          }
          // "Tips: 1" nära laget → spik även utan spik-ord
          if (
            kind === "mention" &&
            /\btips\s*[:\-]?\s*[12x]\b/i.test(snippet)
          ) {
            const tipM = snippet.match(/\btips\s*[:\-]?\s*([12x])\b/i);
            const tipO = (tipM?.[1]?.toUpperCase() === "X"
              ? "X"
              : tipM?.[1]) as Outcome | undefined;
            if (tipO === "1" || tipO === "2" || tipO === "X") {
              const asHome = tipO === "1" && side === m.home.name;
              const asAway = tipO === "2" && side === m.away.name;
              if (asHome || asAway || tipO === "X") {
                out.push({
                  source,
                  url,
                  title,
                  team: side,
                  eventNumber: m.eventNumber,
                  outcome: tipO,
                  kind: "spik",
                  snippet: snippet.slice(0, 180),
                });
                searchFrom = abs + needle.length;
                hit++;
                continue;
              }
            }
          }
          out.push({
            source,
            url,
            title,
            team: side,
            eventNumber: m.eventNumber,
            outcome: resolved,
            kind,
            snippet: snippet.slice(0, 180),
            playerHint: kind === "open" ? openInfo.playerHint : null,
          });
          searchFrom = abs + needle.length;
          hit++;
        }
      }
    }
  }

  const seen = new Set<string>();
  return out.filter((x) => {
    const k = `${x.source}|${x.eventNumber}|${x.kind}|${x.outcome}|${normalizeTeam(x.team)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function scrapeFirstOk(
  urls: string[],
  source: string,
  matches: MatchAnalysis[]
): Promise<{ mentions: ExpertTipMention[]; report: ExpertTipSourceReport }> {
  for (const url of urls) {
    const page = await fetchText(url);
    if (!page.ok || page.text.length < 400) continue;
    const title = titleFromHtml(page.text) || source;
    const text = stripHtml(page.text);
    const mentions = findTeamMentions(text, matches, source, url, title);
    return {
      mentions,
      report: {
        source,
        url,
        ok: true,
        title,
        note: `${mentions.length} lagträffar`,
      },
    };
  }
  return {
    mentions: [],
    report: {
      source,
      url: urls[0] || "",
      ok: false,
      title: null,
      note: "Ingen öppen sida hittades",
    },
  };
}

function powerplayUrls(d: ReturnType<typeof dateSlugs>): string[] {
  return [
    `https://hurbra.se/powerplay-${d.day}-${d.monthNameSv}-${d.year}/`,
    `https://www.rekatochklart.com/tips/powerplay/powerplay-tips-${String(d.day).padStart(2, "0")}-${String(d.month).padStart(2, "0")}/`,
    `https://www.expressen.se/sport/hockey/tips/`,
    "https://betii.se/powerplay-tips",
  ];
}

function topptipsetUrls(d: ReturnType<typeof dateSlugs>): string[] {
  return [
    `https://www.rekatochklart.com/tips/topptipset/topptipset-tips-${String(d.day).padStart(2, "0")}-${String(d.month).padStart(2, "0")}/`,
    `https://hurbra.se/topptipset-${d.day}-${d.monthNameSv}-${d.year}/`,
    "https://tipshunter.com/tag/topptipset/",
    "https://betii.se/topptipset-tips",
  ];
}

async function scrapeExpressenHockey(
  matches: MatchAnalysis[]
): Promise<{ mentions: ExpertTipMention[]; report: ExpertTipSourceReport }> {
  const hub = "https://www.expressen.se/sport/hockey/tips/";
  const page = await fetchText(hub);
  if (!page.ok) {
    return {
      mentions: [],
      report: {
        source: "Expressen",
        url: hub,
        ok: false,
        title: null,
        note: `HTTP ${page.status}`,
      },
    };
  }
  const links = [
    ...page.text.matchAll(
      /href="((?:https:\/\/www\.expressen\.se)?\/sport\/hockey\/tips\/[^"#?]+)"/gi
    ),
  ]
    .map((m) =>
      m[1]!.startsWith("http")
        ? m[1]!
        : `https://www.expressen.se${m[1]!}`
    )
    .filter((u) => !/\/tips\/?$/i.test(u));
  // Prefer today's teams in slug
  const teamSlug = matches
    .flatMap((m) => [m.home.name, m.away.name])
    .map((n) =>
      n
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
    );
  const ranked = [...new Set(links)].sort((a, b) => {
    const score = (u: string) =>
      teamSlug.some((t) => t.length > 3 && u.includes(t)) ? 1 : 0;
    return score(b) - score(a);
  });
  const uniq = ranked.slice(0, 5);
  const mentions: ExpertTipMention[] = [];
  let lastTitle: string | null = null;
  let used = hub;
  for (const url of uniq) {
    const art = await fetchText(url);
    if (!art.ok) continue;
    used = url;
    lastTitle = titleFromHtml(art.text);
    mentions.push(
      ...findTeamMentions(
        stripHtml(art.text),
        matches,
        "Expressen",
        url,
        lastTitle || "Expressen"
      )
    );
  }
  return {
    mentions,
    report: {
      source: "Expressen",
      url: used,
      ok: mentions.length > 0 || page.ok,
      title: lastTitle,
      note: mentions.length
        ? `${mentions.length} lagträffar i ${uniq.length} artiklar`
        : "Inga lagträffar",
    },
  };
}

function buildConsensus(
  mentions: ExpertTipMention[],
  matches: MatchAnalysis[]
): ExpertSpikeConsensus[] {
  const byEvent = new Map<
    number,
    { outcome: Outcome; sources: Set<string>; kinds: Set<string> }
  >();

  for (const m of mentions) {
    if (m.eventNumber == null || !m.outcome) continue;
    if (m.kind !== "spik" && m.kind !== "fade") continue;
    // Spikar väger; fade mot samma tecken räknas separat via kind
    if (m.kind === "fade") continue;
    const cur = byEvent.get(m.eventNumber) ?? {
      outcome: m.outcome,
      sources: new Set<string>(),
      kinds: new Set<string>(),
    };
    // Om flera outcomes: behåll det med flest källor (räknas efter)
    if (cur.sources.size === 0) cur.outcome = m.outcome;
    if (cur.outcome === m.outcome) {
      cur.sources.add(m.source);
      cur.kinds.add(m.kind);
      byEvent.set(m.eventNumber, cur);
    } else {
      // rival outcome – bara byt om fler källor samlas senare
      const key = `${m.eventNumber}:${m.outcome}`;
      void key;
      const altSources = new Set(
        mentions
          .filter(
            (x) =>
              x.eventNumber === m.eventNumber &&
              x.outcome === m.outcome &&
              x.kind === "spik"
          )
          .map((x) => x.source)
      );
      if (altSources.size > cur.sources.size) {
        byEvent.set(m.eventNumber, {
          outcome: m.outcome,
          sources: altSources,
          kinds: new Set(["spik"]),
        });
      }
    }
  }

  // Om samma källa också har cover/fade på matchen → spiken är svagare
  const coverOrFade = new Set<string>();
  for (const m of mentions) {
    if (
      (m.kind === "cover" || m.kind === "fade") &&
      m.eventNumber != null
    ) {
      coverOrFade.add(`${m.source}|${m.eventNumber}`);
    }
  }

  const out: ExpertSpikeConsensus[] = [];
  for (const [eventNumber, data] of byEvent) {
    if (data.sources.size < 1) continue;
    const match = matches.find((m) => m.eventNumber === eventNumber);
    if (!match) continue;
    const solidSources = [...data.sources].filter(
      (s) => !coverOrFade.has(`${s}|${eventNumber}`)
    );
    // Behåll bara källor som inte samtidigt garderar samma match
    const useSources = solidSources.length ? solidSources : [...data.sources];
    if (useSources.length < 1) continue;
    out.push({
      eventNumber,
      description: match.description,
      outcome: data.outcome,
      sources: useSources,
      voteCount: useSources.length,
      kind: "spik",
      note:
        useSources.length >= 2
          ? `Expertkonsensus ${data.outcome} (${useSources.join(", ")})`
          : `Öppen tippsajt: ${useSources[0]} → ${data.outcome}`,
    });
  }

  // Fade-varningar (överstreckade) – minst 1 källa
  const fades = new Map<number, Set<string>>();
  for (const m of mentions) {
    if (m.kind !== "fade" || m.eventNumber == null) continue;
    const set = fades.get(m.eventNumber) ?? new Set();
    set.add(m.source);
    fades.set(m.eventNumber, set);
  }
  for (const [eventNumber, sources] of fades) {
    if (byEvent.has(eventNumber)) continue; // redan spik
    const match = matches.find((m) => m.eventNumber === eventNumber);
    if (!match) continue;
    out.push({
      eventNumber,
      description: match.description,
      outcome: match.favourite,
      sources: [...sources],
      voteCount: sources.size,
      kind: "fade",
      note: `Varning från öppna källor (${[...sources].join(", ")}): gardera / undvik torrspik`,
    });
  }

  // Nyckelspelare borta → öppet kort (slår spik på samma match)
  const opens = new Map<
    number,
    { sources: Set<string>; playerHint: string | null }
  >();
  for (const m of mentions) {
    if (m.kind !== "open" || m.eventNumber == null) continue;
    const cur = opens.get(m.eventNumber) ?? {
      sources: new Set<string>(),
      playerHint: null as string | null,
    };
    cur.sources.add(m.source);
    if (!cur.playerHint && m.playerHint) cur.playerHint = m.playerHint;
    opens.set(m.eventNumber, cur);
  }
  for (const [eventNumber, data] of opens) {
    const match = matches.find((m) => m.eventNumber === eventNumber);
    if (!match) continue;
    // Ta bort spik/fade på samma match – frånvaro gör kortet öppet
    const filtered = out.filter((c) => c.eventNumber !== eventNumber);
    out.length = 0;
    out.push(...filtered);
    const who = data.playerHint ? ` (${data.playerHint})` : "";
    out.push({
      eventNumber,
      description: match.description,
      outcome: match.favourite,
      sources: [...data.sources],
      voteCount: data.sources.size,
      kind: "open",
      playerHint: data.playerHint,
      note: `Nyckelspelare borta${who} – tippsajter säger att laget tappar mycket; matchen kan gå hur som helst (${[...data.sources].join(", ")})`,
    });
  }

  out.sort((a, b) => {
    const rank = (k: ExpertSpikeConsensus["kind"]) =>
      k === "open" ? 3 : k === "spik" ? 2 : 1;
    return (
      rank(b.kind) - rank(a.kind) ||
      b.voteCount - a.voteCount ||
      a.eventNumber - b.eventNumber
    );
  });
  return out;
}

/** Justera matchscores efter expertkonsensus från öppna tippsajter. */
export function applyExpertTipsToMatches(
  matches: MatchAnalysis[],
  consensus: ExpertSpikeConsensus[]
): { matches: MatchAnalysis[]; alerts: string[] } {
  if (!consensus.length) return { matches, alerts: [] };
  const openEvents = new Set(
    consensus.filter((c) => c.kind === "open").map((c) => c.eventNumber)
  );
  // Lås högst de 3 starkaste spikarna (flest källor) – aldrig på öppna kort
  const lockable = new Set(
    consensus
      .filter(
        (c) =>
          c.kind === "spik" &&
          c.voteCount >= 2 &&
          !openEvents.has(c.eventNumber)
      )
      .sort((a, b) => b.voteCount - a.voteCount)
      .slice(0, 3)
      .map((c) => c.eventNumber)
  );
  const byEvent = new Map(consensus.map((c) => [c.eventNumber, c]));
  const alerts: string[] = [];

  const next = matches.map((m) => {
    const tip = byEvent.get(m.eventNumber);
    if (!tip) return m;

    let { score1, scoreX, score2 } = m;
    let tipOpenMatch: MatchAnalysis["tipOpenMatch"] = m.tipOpenMatch ?? null;
    const boost =
      tip.kind === "spik" ? (tip.voteCount >= 2 ? 0.12 : 0.05) : 0;
    if (tip.kind === "open") {
      // Platta ut – matchen kan gå hur som helst
      score1 = score1 * 0.4 + 1 / 3;
      scoreX = scoreX * 0.4 + 1 / 3;
      score2 = score2 * 0.4 + 1 / 3;
      tipOpenMatch = {
        reason: tip.note,
        sources: tip.sources,
        playerHint: tip.playerHint ?? null,
      };
      alerts.push(`Match ${m.eventNumber}: ${tip.note} – garderas`);
    } else if (tip.kind === "spik") {
      if (tip.outcome === "1") score1 += boost;
      if (tip.outcome === "X") scoreX += boost;
      if (tip.outcome === "2") score2 += boost;
      alerts.push(
        `Match ${m.eventNumber}: ${tip.note} – vägs in som starkare enkel`
      );
    } else if (tip.kind === "fade") {
      scoreX += 0.05;
      if (m.favourite === "1") score1 -= 0.04;
      if (m.favourite === "2") score2 -= 0.04;
      alerts.push(`Match ${m.eventNumber}: ${tip.note}`);
    }

    const sum = Math.max(score1 + scoreX + score2, 0.01);
    score1 /= sum;
    scoreX /= sum;
    score2 /= sum;

    let pick = m.pick;
    let pickReason = m.pickReason;
    if (tip.kind === "open") {
      pick = ["1", "X", "2"];
      pickReason = `${tip.note}. ${m.pickReason}`;
    } else if (tip.kind === "spik" && lockable.has(m.eventNumber)) {
      pick = [tip.outcome];
      pickReason = `${tip.note}. ${m.pickReason}`;
    } else {
      pickReason = `${tip.note}. ${m.pickReason}`;
    }

    return {
      ...m,
      score1,
      scoreX,
      score2,
      pick,
      pickReason,
      tipOpenMatch,
    };
  });

  return { matches: next, alerts };
}

export async function fetchPoolExpertTips(
  product: string,
  matches: MatchAnalysis[]
): Promise<PoolExpertTipsResult> {
  if (
    product !== "powerplay" &&
    product !== "topptipset" &&
    product !== "stryktipset" &&
    product !== "europatipset"
  ) {
    return { mentions: [], consensus: [], sources: [], summary: [] };
  }
  if (!matches.length) {
    return { mentions: [], consensus: [], sources: [], summary: [] };
  }

  const d = dateSlugs();
  const jobs: Array<
    Promise<{ mentions: ExpertTipMention[]; report: ExpertTipSourceReport }>
  > = [];

  if (product === "powerplay") {
    jobs.push(
      scrapeFirstOk(
        powerplayUrls(d).filter((u) => u.includes("hurbra")),
        "Hurbra",
        matches
      )
    );
    jobs.push(
      scrapeFirstOk(
        powerplayUrls(d).filter((u) => u.includes("rekatochklart")),
        "RekatOchKlart",
        matches
      )
    );
    jobs.push(scrapeExpressenHockey(matches));
    jobs.push(
      scrapeFirstOk(
        ["https://betii.se/powerplay-tips"],
        "Betii",
        matches
      )
    );
  } else {
    // Fotbollspooler
    jobs.push(
      scrapeFirstOk(
        topptipsetUrls(d).filter((u) => u.includes("rekatochklart")),
        "RekatOchKlart",
        matches
      )
    );
    jobs.push(
      scrapeFirstOk(
        [
          `https://hurbra.se/topptipset-${d.day}-${d.monthNameSv}-${d.year}/`,
          `https://hurbra.se/stryktipset-${d.day}-${d.monthNameSv}-${d.year}/`,
        ],
        "Hurbra",
        matches
      )
    );
    jobs.push(
      scrapeFirstOk(
        ["https://tipshunter.com/tag/topptipset/", "https://tipshunter.com/"],
        "Tipshunter",
        matches
      )
    );
    jobs.push(
      scrapeFirstOk(
        [
          product === "europatipset"
            ? "https://betii.se/europatipset-tips"
            : product === "stryktipset"
              ? "https://betii.se/stryktipset-tips"
              : "https://betii.se/topptipset-tips",
        ],
        "Betii",
        matches
      )
    );
  }

  const results = await Promise.all(jobs);
  const mentions = results.flatMap((r) => r.mentions);
  const sources = results.map((r) => r.report);
  const consensus = buildConsensus(mentions, matches);

  const topSpikes = consensus
    .filter((c) => c.kind === "spik")
    .slice(0, 3)
    .map(
      (c) =>
        `${c.description.split("–")[0]?.trim() || c.description}: ${c.outcome} (${c.sources.join("+")})`
    );

  const summary: string[] = [];
  if (topSpikes.length) {
    summary.push(
      `Öppna tippsajter – starkaste spikar: ${topSpikes.join(" · ")}`
    );
  }
  const opens = consensus.filter((c) => c.kind === "open").slice(0, 3);
  for (const o of opens) {
    summary.push(o.note);
  }
  const fades = consensus.filter((c) => c.kind === "fade").slice(0, 2);
  for (const f of fades) {
    summary.push(f.note);
  }
  if (!summary.length) {
    const okSources = sources.filter((s) => s.ok).map((s) => s.source);
    summary.push(
      okSources.length
        ? `Öppna källor lästa (${okSources.join(", ")}) – ingen tydlig spikkonsensus just nu`
        : "Kunde inte nå öppna tippsajter just nu"
    );
  }

  return { mentions, consensus, sources, summary };
}
