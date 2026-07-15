import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import type { Article, SourceId } from "@nytt/shared";
import { articleTopics, categorize, detectScope, extractPlaces } from "./classify.js";
import { attachArticleSourceCapture } from "./articleSourceCapture.js";
import {
  defaultDatexSituationEndpoint,
  normalizeDatexSituationEndpoint,
  probeDatexAccess,
} from "./datex.js";
import { fetchWithSourcePolicy } from "./fetchPolicy.js";
import { defaultPolitiloggenEndpoint, isPolitiloggenEnabled } from "./politiloggen.js";

interface FeedSource {
  id: SourceId;
  label: string;
  url: string;
  format?: "rss" | "atom";
  maxItems?: number;
  retainRegionalUnmatched?: boolean;
}

interface FrontpageSource {
  id: SourceId;
  label: string;
  url: string;
  maxArticles?: number;
  detailFetchLimit?: number;
  retainRegionalUnmatched?: boolean;
}

export const rssSources: FeedSource[] = [
  {
    id: "nrk",
    label: "NRK Trøndelag",
    url: "https://www.nrk.no/trondelag/siste.rss",
    retainRegionalUnmatched: true,
  },
  {
    id: "adressa",
    label: "Adresseavisen",
    url: "https://www.adressa.no/rss/nyheter",
    retainRegionalUnmatched: true,
  },
  {
    id: "avisa_st",
    label: "Avisa Sør-Trøndelag",
    url: "https://www.avisa-st.no/rss",
    maxItems: 50,
    retainRegionalUnmatched: true,
  },
  {
    id: "ytringen",
    label: "Ytringen",
    url: "https://ytringen.no/atom.xml",
    format: "atom",
    maxItems: 40,
    retainRegionalUnmatched: true,
  },
  {
    id: "innherred",
    label: "Innherred",
    url: "https://www.innherred.no/rss",
    maxItems: 40,
    retainRegionalUnmatched: true,
  },
  {
    id: "malviknytt",
    label: "Malviknytt",
    url: "https://www.malviknytt.no/rss",
    retainRegionalUnmatched: true,
  },
  {
    id: "hitra_froya",
    label: "Hitra-Frøya",
    url: "https://www.hitra-froya.no/rss",
    maxItems: 40,
    retainRegionalUnmatched: true,
  },
  {
    id: "tronderbladet",
    label: "Trønderbladet",
    url: "https://www.tronderbladet.no/rss",
    maxItems: 40,
    retainRegionalUnmatched: true,
  },
  { id: "vg", label: "VG", url: "https://www.vg.no/rss/feed/" },
  { id: "dagbladet", label: "Dagbladet", url: "https://www.dagbladet.no/rss/nyheter.xml" },
];

export const frontpageSources: FrontpageSource[] = [
  {
    id: "snasningen",
    label: "Snåsningen",
    url: "https://www.snasningen.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "merakerposten",
    label: "Meråkerposten",
    url: "https://www.merakerposten.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "frostingen",
    label: "Frostingen",
    url: "https://www.frostingen.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "steinkjer_avisa",
    label: "Steinkjer-Avisa",
    url: "https://www.steinkjer-avisa.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "namdalsavisa",
    label: "Namdalsavisa",
    url: "https://www.namdalsavisa.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "retten",
    label: "Arbeidets Rett",
    url: "https://www.retten.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "nidaros",
    label: "Nidaros",
    url: "https://www.nidaros.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "t_a",
    label: "Trønder-Avisa",
    url: "https://www.t-a.no/",
    retainRegionalUnmatched: true,
  },
  {
    id: "selbyggen",
    label: "Selbyggen",
    url: "https://www.selbyggen.no/",
    maxArticles: 12,
    detailFetchLimit: 12,
    retainRegionalUnmatched: true,
  },
  {
    id: "fjell_ljom",
    label: "Fjell-Ljom",
    url: "https://www.fjell-ljom.no/",
    maxArticles: 12,
    detailFetchLimit: 12,
    retainRegionalUnmatched: true,
  },
];

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value) return String(value["#text"]);
  return "";
}

function stableId(source: SourceId, url: string): string {
  return `${source}-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function canonicalUrl(rawUrl: string, base?: string): string {
  const url = new URL(rawUrl, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Article URL must use http or https");
  }
  url.hash = "";
  for (const parameter of [...url.searchParams.keys()]) {
    if (parameter.startsWith("utm_") || parameter === "fbclid") {
      url.searchParams.delete(parameter);
    }
  }
  return url.toString();
}

function parsePublishedAt(value: unknown): string | undefined {
  const rawValue = textValue(value).trim();
  if (!rawValue) return undefined;
  const normalized = rawValue.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function itemCategories(item: Record<string, unknown>): string[] {
  return asArray(item.category)
    .map((category) => textValue(category).trim())
    .filter(Boolean);
}

function atomLink(value: unknown, base: string): string {
  const candidates = asArray(value as Record<string, unknown> | Record<string, unknown>[] | string);
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
    if (!candidate || typeof candidate !== "object") continue;
    const rel = textValue(candidate["@_rel"]).trim();
    const href = textValue(candidate["@_href"]).trim();
    if (href && (!rel || rel === "alternate")) return canonicalUrl(href, base);
  }
  return "";
}

function atomCategories(item: Record<string, unknown>): string[] {
  return asArray(item.category)
    .map((category) => {
      if (typeof category === "string") return category;
      if (category && typeof category === "object") {
        const record = category as Record<string, unknown>;
        return textValue(record["@_label"]) || textValue(record["@_term"]);
      }
      return "";
    })
    .map((category) => category.trim())
    .filter(Boolean);
}

function shouldFetchArticleExcerpt(
  source: FeedSource,
  url: string,
  categories: string[],
  excerpt: string,
): boolean {
  if (source.id !== "adressa") return false;
  if (!url.includes("/nyhetsstudio/")) return false;
  if (excerpt.length >= 80) return false;
  return categories.some((category) => category.toLocaleLowerCase("nb") === "nyhetsstudio");
}

interface ArticlePageExcerptEvidence {
  excerpt: string;
  rawPayload: {
    url: string;
    paragraphs: string[];
  };
}

async function articlePageExcerpt(
  url: string,
  fetcher: typeof fetch,
): Promise<ArticlePageExcerptEvidence | undefined> {
  try {
    const response = await fetchWithSourcePolicy(fetcher, url);
    if (!response.ok) return undefined;
    const $ = cheerio.load(await response.text());
    const paragraphs = $("p")
      .toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim())
      .filter((text) => text.length >= 40 && !/^foto:/i.test(text))
      .slice(0, 4);
    const excerpt = paragraphs.join(" ").replace(/\s+/g, " ").trim();
    return excerpt
      ? {
          excerpt: excerpt.slice(0, 600),
          rawPayload: { url, paragraphs },
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function collectRss(
  source: FeedSource,
  fetcher: typeof fetch = fetch,
): Promise<Article[]> {
  const response = await fetchWithSourcePolicy(fetcher, source.url);
  if (!response.ok) throw new Error(`${source.label} returned ${response.status}`);
  const xml = await response.text();
  const feed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
    rss?: { channel?: { item?: Array<Record<string, unknown>> | Record<string, unknown> } };
    feed?: { entry?: Array<Record<string, unknown>> | Record<string, unknown> };
  };
  if ((source.format ?? "rss") === "rss" && !feed.rss?.channel) {
    throw new Error(`${source.label} RSS-format mangler kanal`);
  }
  if (source.format === "atom" && !feed.feed) {
    throw new Error(`${source.label} Atom-format mangler feed`);
  }
  const articles: Article[] = [];
  let detailFetches = 0;
  const maxDetailFetches = source.id === "adressa" ? 12 : 0;
  const items = (
    source.format === "atom" ? asArray(feed.feed?.entry) : asArray(feed.rss?.channel?.item)
  ).slice(0, source.maxItems ?? 60);
  if (items.length === 0) {
    throw new Error(
      `${source.label} ${source.format === "atom" ? "Atom" : "RSS"} har ingen oppføringer`,
    );
  }
  let articleCandidates = 0;
  let timestampedCandidates = 0;
  for (const item of items) {
    const title = textValue(item.title).trim();
    let excerpt = textValue(item.description || item.summary || item.content)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const link =
      source.format === "atom" ? atomLink(item.link, source.url) : textValue(item.link).trim();
    if (!title || !link) continue;
    let url: string;
    try {
      url = canonicalUrl(link, source.url);
    } catch {
      continue;
    }
    articleCandidates += 1;
    const publicationField = item.pubDate ? "pubDate" : item.published ? "published" : "updated";
    const publishedAt = parsePublishedAt(item[publicationField]);
    if (!publishedAt) continue;
    timestampedCandidates += 1;
    const categories = source.format === "atom" ? atomCategories(item) : itemCategories(item);
    let detailPageEvidence: ArticlePageExcerptEvidence["rawPayload"] | undefined;
    if (
      detailFetches < maxDetailFetches &&
      shouldFetchArticleExcerpt(source, url, categories, excerpt)
    ) {
      detailFetches += 1;
      const detail = await articlePageExcerpt(url, fetcher);
      excerpt = detail?.excerpt ?? excerpt;
      detailPageEvidence = detail?.rawPayload;
    }
    const articleText = `${title} ${excerpt} ${categories.join(" ")}`;
    const scope = detectScope(articleText);
    if (!scope && !source.retainRegionalUnmatched) continue;
    const category = categorize(articleText);
    articles.push(
      attachArticleSourceCapture(
        {
          id: stableId(source.id, url),
          source: source.id,
          sourceLabel: source.label,
          title,
          excerpt: excerpt.slice(0, 300),
          url,
          publishedAt,
          scope: scope ?? "trondelag",
          category,
          topics: articleTopics(articleText, category),
          places: extractPlaces(articleText),
        },
        {
          rawPayload: {
            schemaVersion: 1,
            transport: {
              kind: source.format === "atom" ? "atom" : "rss",
              endpoint: source.url,
            },
            feedItem: item,
            extraction: {
              publicationField,
              linkField: "link",
              titleField: "title",
              excerptField: item.description ? "description" : item.summary ? "summary" : "content",
            },
            ...(detailPageEvidence ? { detailPage: detailPageEvidence } : {}),
          },
          sourceUpdatedAt: parsePublishedAt(item.updated),
        },
      ),
    );
  }
  if (articleCandidates === 0) {
    throw new Error(`${source.label} har ingen brukbare artikkelkandidater i feeden`);
  }
  if (timestampedCandidates === 0) {
    throw new Error(`${source.label} har ingen brukbare tidsstempler i feeden`);
  }
  return articles;
}

interface FrontpageCandidate {
  title: string;
  excerpt: string;
  url: string;
  categories: string[];
  publishedAt?: string;
  sourceUpdatedAt?: string;
  sourceEvidence: {
    kind: "json_ld_news_article" | "html_anchor";
    payload: unknown;
  };
}

interface ArticlePageMetadata {
  title?: string;
  excerpt?: string;
  categories: string[];
  publishedAt?: string;
  sourceUpdatedAt?: string;
  rawPayload: Record<string, unknown>;
}

function normalizeArticleText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFrontpageTitle(value: string): string {
  return normalizeArticleText(value)
    .replace(/\bArtikkelen er for abonnenter\b/gi, " ")
    .replace(/\bNyhetsvarsel\b/gi, " ")
    .replace(/\bVideoartikkel\b/gi, " ")
    .replace(/\bBildeserie\b/gi, " ")
    .replace(/\bVideo\s+\d{1,2}:\d{2}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function samePublicHostname(left: string, right: string): boolean {
  const normalize = (value: string) => new URL(value).hostname.replace(/^www\./, "");
  return normalize(left) === normalize(right);
}

function frontpageStoryId(url: string): string | undefined {
  return /(?:^|\/)(\d+-\d+-\d+)(?:$|[/?#])/.exec(new URL(url).pathname)?.[1];
}

interface AmediaTimestampEvidence {
  rawValue: string;
  timestamp: string;
}

function amediaTimestampMap(html: string): Map<string, AmediaTimestampEvidence> {
  const timestamps = new Map<string, AmediaTimestampEvidence>();
  for (const match of html.matchAll(
    /"id":"(\d+-\d+-\d+)"[\s\S]{0,700}?"articleLastModified":"([^"]+)"/g,
  )) {
    const [, id, timestamp] = match;
    const publishedAt = parsePublishedAt(timestamp);
    if (id && timestamp && publishedAt) {
      timestamps.set(id, { rawValue: timestamp, timestamp: publishedAt });
    }
  }
  return timestamps;
}

function frontpageJsonLdCandidates($: cheerio.CheerioAPI, source: FrontpageSource) {
  const candidates: FrontpageCandidate[] = [];
  const addNewsArticle = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const type = record["@type"];
    const typeValues = Array.isArray(type) ? type : [type];
    if (!typeValues.includes("NewsArticle")) return;
    const headline = normalizeArticleText(textValue(record.headline));
    const rawUrl = textValue(record.url);
    if (!headline || !rawUrl) return;
    try {
      const url = canonicalUrl(rawUrl, source.url);
      if (!samePublicHostname(url, source.url)) return;
      candidates.push({
        title: headline.slice(0, 180),
        excerpt: normalizeArticleText(textValue(record.description)).slice(0, 300),
        url,
        categories: [],
        publishedAt: parsePublishedAt(record.datePublished || record.dateModified),
        sourceUpdatedAt: parsePublishedAt(record.dateModified),
        sourceEvidence: {
          kind: "json_ld_news_article",
          payload: record,
        },
      });
    } catch {
      return;
    }
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    addNewsArticle(record);
    for (const nested of Object.values(record)) walk(nested);
  };
  $("script[type='application/ld+json']").each((_index, element) => {
    try {
      walk(JSON.parse($(element).text()));
    } catch {
      return;
    }
  });
  return candidates;
}

function frontpageAnchorCandidates(
  $: cheerio.CheerioAPI,
  source: FrontpageSource,
): FrontpageCandidate[] {
  const candidates: FrontpageCandidate[] = [];
  $("a[href]").each((_index, element) => {
    const rawText = $(element).text();
    const rawTitle = cleanFrontpageTitle(rawText);
    if (rawTitle.length < 20) return;
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = canonicalUrl(href, source.url);
      if (!samePublicHostname(url, source.url)) return;
      const path = new URL(url).pathname;
      if (
        path === "/" ||
        path.startsWith("/vis/") ||
        path.startsWith("/tilgang/") ||
        path.includes("annonse")
      ) {
        return;
      }
      candidates.push({
        title: rawTitle,
        excerpt: "",
        url,
        categories: [],
        sourceEvidence: {
          kind: "html_anchor",
          payload: { href, text: rawText },
        },
      });
    } catch {
      return;
    }
  });
  return candidates;
}

async function articlePageMetadata(
  url: string,
  fetcher: typeof fetch,
): Promise<ArticlePageMetadata | undefined> {
  try {
    const response = await fetchWithSourcePolicy(fetcher, url);
    if (!response.ok) return undefined;
    const $ = cheerio.load(await response.text());
    const rawOgTitle = $("meta[property='og:title']").attr("content");
    const rawH1 = $("h1").first().text();
    const rawOgDescription = $("meta[property='og:description']").attr("content");
    const rawDescription = $("meta[name='description']").attr("content");
    const rawCategories = $("meta[property='article:tag']")
      .toArray()
      .map((element) => $(element).attr("content") ?? "")
      .filter(Boolean);
    const rawPublishedTime = $("meta[property='article:published_time']").attr("content");
    const rawTimeDatetime = $("time[datetime]").first().attr("datetime");
    const rawModifiedTime = $("meta[property='article:modified_time']").attr("content");
    const title = normalizeArticleText(rawOgTitle ?? rawH1);
    const excerpt = normalizeArticleText(rawOgDescription ?? rawDescription ?? "").slice(0, 300);
    const categories = rawCategories.map(normalizeArticleText).filter(Boolean);
    const publishedAt = parsePublishedAt(rawPublishedTime ?? rawTimeDatetime ?? "");
    return {
      ...(title ? { title: title.slice(0, 180) } : {}),
      ...(excerpt ? { excerpt } : {}),
      categories,
      ...(publishedAt ? { publishedAt } : {}),
      ...(parsePublishedAt(rawModifiedTime)
        ? { sourceUpdatedAt: parsePublishedAt(rawModifiedTime) }
        : {}),
      rawPayload: {
        url,
        ogTitle: rawOgTitle ?? null,
        h1: rawH1 || null,
        ogDescription: rawOgDescription ?? null,
        description: rawDescription ?? null,
        articleTags: rawCategories,
        articlePublishedTime: rawPublishedTime ?? null,
        timeDatetime: rawTimeDatetime ?? null,
        articleModifiedTime: rawModifiedTime ?? null,
      },
    };
  } catch {
    return undefined;
  }
}

export async function collectFrontpage(
  source: FrontpageSource,
  fetcher: typeof fetch = fetch,
): Promise<Article[]> {
  const response = await fetchWithSourcePolicy(fetcher, source.url);
  if (!response.ok) throw new Error(`${source.label} returned ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const timestampByStoryId = amediaTimestampMap(html);
  const byUrl = new Map<string, FrontpageCandidate>();
  for (const candidate of [
    ...frontpageJsonLdCandidates($, source),
    ...frontpageAnchorCandidates($, source),
  ]) {
    if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate);
  }
  if (byUrl.size === 0) {
    throw new Error(`${source.label} har ingen artikkelkandidater på forsiden`);
  }

  const articles: Article[] = [];
  let detailFetches = 0;
  let timestampedCandidates = 0;
  for (const candidate of [...byUrl.values()].slice(0, source.maxArticles ?? 24)) {
    const storyId = frontpageStoryId(candidate.url);
    const embeddedTimestamp = storyId ? timestampByStoryId.get(storyId) : undefined;
    let publishedAt = candidate.publishedAt ?? embeddedTimestamp?.timestamp;
    let title = candidate.title;
    let excerpt = candidate.excerpt;
    let categories = candidate.categories;
    let detailEvidence: ArticlePageMetadata | undefined;
    if (!publishedAt && detailFetches < (source.detailFetchLimit ?? 8)) {
      detailFetches += 1;
      const detail = await articlePageMetadata(candidate.url, fetcher);
      detailEvidence = detail;
      publishedAt = detail?.publishedAt ?? publishedAt;
      title = detail?.title ?? title;
      excerpt = detail?.excerpt ?? excerpt;
      categories = [...new Set([...categories, ...(detail?.categories ?? [])])];
    }
    if (!publishedAt) continue;
    timestampedCandidates += 1;
    const articleText = `${title} ${excerpt} ${categories.join(" ")}`;
    const scope = detectScope(articleText);
    if (!scope && !source.retainRegionalUnmatched) continue;
    const category = categorize(articleText);
    articles.push(
      attachArticleSourceCapture(
        {
          id: stableId(source.id, candidate.url),
          source: source.id,
          sourceLabel: source.label,
          title,
          excerpt: excerpt.slice(0, 300),
          url: candidate.url,
          publishedAt,
          scope: scope ?? "trondelag",
          category,
          topics: articleTopics(articleText, category),
          places: extractPlaces(articleText),
        },
        {
          rawPayload: {
            schemaVersion: 1,
            transport: { kind: "html_frontpage", endpoint: source.url },
            candidate: candidate.sourceEvidence,
            ...(embeddedTimestamp
              ? { embeddedArticleLastModified: { storyId, ...embeddedTimestamp } }
              : {}),
            ...(detailEvidence ? { detailPage: detailEvidence.rawPayload } : {}),
          },
          sourceUpdatedAt:
            detailEvidence?.sourceUpdatedAt ??
            candidate.sourceUpdatedAt ??
            embeddedTimestamp?.timestamp,
        },
      ),
    );
  }
  if (timestampedCandidates === 0) {
    throw new Error(`${source.label} har ingen brukbare tidsstempler på forsiden`);
  }
  return articles;
}

function parseNorwegianDate(value: string): string | undefined {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const [, day, month, year, hours, minutes, seconds = "00"] = match;
  const wallClockUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  const offsetName = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Oslo",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(wallClockUtc))
    .find((part) => part.type === "timeZoneName")?.value;
  const offsetMatch = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offsetMatch) return undefined;
  const [, direction, offsetHours, offsetMinutes = "0"] = offsetMatch;
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * (direction === "+" ? 1 : -1);
  return new Date(wallClockUtc - offset * 60_000).toISOString();
}

interface MunicipalPublicationEvidence {
  publishedAt: string;
  rawPayload: {
    url: string;
    articlePublishedTime: string;
  };
}

async function municipalPublicationEvidence(
  url: string,
  fetcher: typeof fetch,
): Promise<MunicipalPublicationEvidence | undefined> {
  try {
    const response = await fetchWithSourcePolicy(fetcher, url);
    if (!response.ok) return undefined;
    const detail = cheerio.load(await response.text());
    const value = detail('meta[property="article:published_time"]').attr("content") ?? "";
    const publishedAt = parseNorwegianDate(value);
    return publishedAt
      ? { publishedAt, rawPayload: { url, articlePublishedTime: value } }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function collectMunicipality(fetcher: typeof fetch = fetch): Promise<Article[]> {
  const url = "https://www.trondheim.kommune.no/aktuelt/nyheter/";
  const response = await fetchWithSourcePolicy(fetcher, url);
  if (!response.ok) throw new Error(`Trondheim kommune returned ${response.status}`);
  const $ = cheerio.load(await response.text());
  if ($("article.card").length === 0) {
    throw new Error("Trondheim kommune nyhetsliste mangler forventede artikkelkort");
  }
  const candidates: Array<{
    article: Omit<Article, "publishedAt">;
    rawPayload: { href: string; text: string; title: string; excerpt: string };
  }> = [];
  $("article.card").each((_index, element) => {
    const link = $(element).find("a[href]").first();
    const title = link.text().replace(/\s+/g, " ").trim();
    const href = link.attr("href");
    if (!title || !href) return;
    let canonical: string;
    try {
      canonical = canonicalUrl(href, url);
    } catch {
      return;
    }
    const rawText = $(element).text();
    const excerpt = rawText.replace(title, "").replace(/\s+/g, " ").trim();
    const category = categorize(`${title} ${excerpt}`);
    candidates.push({
      article: {
        id: stableId("trondheim_kommune", canonical),
        source: "trondheim_kommune",
        sourceLabel: "Trondheim kommune",
        title,
        excerpt: excerpt.slice(0, 300),
        url: canonical,
        scope: "trondheim",
        category,
        topics: articleTopics(`${title} ${excerpt}`, category),
        places: extractPlaces(`${title} ${excerpt}`),
      },
      rawPayload: { href, text: rawText, title, excerpt },
    });
  });
  if (candidates.length === 0) {
    throw new Error("Trondheim kommune nyhetsliste har ingen brukbare artikkelkandidater");
  }
  const timestamped = (
    await Promise.all(
      candidates.map(async ({ article, rawPayload }) => ({
        article,
        rawPayload,
        publication: await municipalPublicationEvidence(article.url, fetcher),
      })),
    )
  ).flatMap(({ article, rawPayload, publication }) =>
    publication
      ? [
          attachArticleSourceCapture(
            { ...article, publishedAt: publication.publishedAt },
            {
              rawPayload: {
                schemaVersion: 1,
                transport: { kind: "html_listing", endpoint: url },
                card: rawPayload,
                detailPage: publication.rawPayload,
              },
            },
          ),
        ]
      : [],
  );
  if (timestamped.length === 0) {
    throw new Error("Trondheim kommune har ingen brukbare tidsstempler i nyhetslisten");
  }
  return timestamped;
}

export interface OfficialProbeResult {
  source: SourceId;
  label: string;
  state: "ok" | "degraded" | "disabled" | "awaiting_access";
  detail: string;
}

async function probeDatex(fetcher: typeof fetch): Promise<OfficialProbeResult> {
  const username = nonEmptyEnv(process.env.DATEX_USERNAME);
  const password = process.env.DATEX_PASSWORD;
  if (!username || !password) {
    return {
      source: "datex",
      label: "Vegvesen DATEX",
      state: "awaiting_access",
      detail: "Venter på DATEX Basic Auth-brukernavn og passord",
    };
  }

  try {
    const endpoint = normalizeDatexSituationEndpoint(
      nonEmptyEnv(process.env.DATEX_ENDPOINT) ?? defaultDatexSituationEndpoint,
    );
    await probeDatexAccess({ endpoint, username, password, fetcher });
    return {
      source: "datex",
      label: "Vegvesen DATEX",
      state: "ok",
      detail: "Tilgang konfigurert og testet mot DATEX GetSituation",
    };
  } catch (error) {
    return { source: "datex", label: "Vegvesen DATEX", state: "degraded", detail: String(error) };
  }
}

async function probePolitiloggen(fetcher: typeof fetch): Promise<OfficialProbeResult> {
  if (!isPolitiloggenEnabled()) {
    return {
      source: "politiloggen",
      label: "Politiloggen",
      state: "disabled",
      detail: "Politiloggen-adapter er slått av med POLITILOGGEN_ENABLED=false",
    };
  }
  const url = new URL(process.env.POLITILOGGEN_ENDPOINT?.trim() || defaultPolitiloggenEndpoint);
  url.searchParams.set("Municipalities", "Trondheim");
  url.searchParams.set("Take", "1");
  url.searchParams.set("Skip", "0");
  try {
    const response = await fetchWithSourcePolicy(fetcher, url);
    return {
      source: "politiloggen",
      label: "Politiloggen",
      state: response.ok || response.status === 204 ? "ok" : "degraded",
      detail:
        response.ok || response.status === 204
          ? "Offentlig Politiloggen API tilgjengelig"
          : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      source: "politiloggen",
      label: "Politiloggen",
      state: "degraded",
      detail: String(error),
    };
  }
}

export async function probeOfficialSources(
  fetcher: typeof fetch = fetch,
): Promise<OfficialProbeResult[]> {
  const results: OfficialProbeResult[] = [];
  const probes: Array<[SourceId, string, string]> = [
    [
      "met",
      "MET farevarsel",
      "https://api.met.no/weatherapi/metalerts/2.0/current.rss?county=50&geographicDomain=land&lang=no",
    ],
    [
      "nve",
      "NVE Varsom",
      "https://api01.nve.no/hydrology/forecast/flood/v1.0.10/api/Warning/Municipality/5001/1/",
    ],
    [
      "dsb",
      "DSB beredskap",
      "https://ogc.dsb.no/wms.ashx?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0",
    ],
  ];
  for (const [source, label, url] of probes) {
    try {
      const response = await fetchWithSourcePolicy(fetcher, url);
      results.push({
        source,
        label,
        state: response.ok ? "ok" : "degraded",
        detail: response.ok ? "Offentlig datakilde tilgjengelig" : `HTTP ${response.status}`,
      });
    } catch (error) {
      results.push({ source, label, state: "degraded", detail: String(error) });
    }
  }
  results.push(await probeDatex(fetcher));
  results.push(await probePolitiloggen(fetcher));
  return results;
}
