import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import type { Article, SourceId } from "@nytt/shared";
import { categorize, detectScope, extractPlaces } from "./classify.js";

interface FeedSource {
  id: SourceId;
  label: string;
  url: string;
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
  { id: "vg", label: "VG", url: "https://www.vg.no/rss/feed/" },
  { id: "dagbladet", label: "Dagbladet", url: "https://www.dagbladet.no/rss/nyheter.xml" },
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

export async function collectRss(
  source: FeedSource,
  fetcher: typeof fetch = fetch,
): Promise<Article[]> {
  const response = await fetcher(source.url, {
    headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
  });
  if (!response.ok) throw new Error(`${source.label} returned ${response.status}`);
  const xml = await response.text();
  const feed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
    rss?: { channel?: { item?: Array<Record<string, unknown>> | Record<string, unknown> } };
  };
  return asArray(feed.rss?.channel?.item).flatMap((item) => {
    const title = textValue(item.title).trim();
    const excerpt = textValue(item.description)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const url = textValue(item.link).trim();
    if (!title || !url) return [];
    const scope = detectScope(`${title} ${excerpt}`);
    if (!scope && !source.retainRegionalUnmatched) return [];
    return [
      {
        id: stableId(source.id, url),
        source: source.id,
        sourceLabel: source.label,
        title,
        excerpt: excerpt.slice(0, 300),
        url,
        publishedAt: new Date(textValue(item.pubDate) || Date.now()).toISOString(),
        scope: scope ?? "trondelag",
        category: categorize(`${title} ${excerpt}`),
        places: extractPlaces(`${title} ${excerpt}`),
      },
    ];
  });
}

export async function collectMunicipality(fetcher: typeof fetch = fetch): Promise<Article[]> {
  const url = "https://www.trondheim.kommune.no/aktuelt/nyheter/";
  const response = await fetcher(url, {
    headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
  });
  if (!response.ok) throw new Error(`Trondheim kommune returned ${response.status}`);
  const $ = cheerio.load(await response.text());
  const articles: Article[] = [];
  $("article.card").each((_index, element) => {
    const link = $(element).find("a[href]").first();
    const title = link.text().replace(/\s+/g, " ").trim();
    const href = link.attr("href");
    if (!title || !href) return;
    const canonical = new URL(href, url).toString();
    const excerpt = $(element).text().replace(title, "").replace(/\s+/g, " ").trim();
    articles.push({
      id: stableId("trondheim_kommune", canonical),
      source: "trondheim_kommune",
      sourceLabel: "Trondheim kommune",
      title,
      excerpt: excerpt.slice(0, 300),
      url: canonical,
      publishedAt: new Date().toISOString(),
      scope: "trondheim",
      category: categorize(`${title} ${excerpt}`),
      places: extractPlaces(`${title} ${excerpt}`),
    });
  });
  return articles;
}

export interface OfficialProbeResult {
  source: SourceId;
  label: string;
  state: "ok" | "degraded" | "disabled" | "awaiting_access";
  detail: string;
}

export async function probeOfficialSources(
  fetcher: typeof fetch = fetch,
): Promise<OfficialProbeResult[]> {
  const results: OfficialProbeResult[] = [];
  const probes: Array<[SourceId, string, string]> = [
    ["met", "MET farevarsel", "https://api.met.no/weatherapi/metalerts/2.0/current.json?county=50"],
    [
      "nve",
      "NVE Varsom",
      "https://api01.nve.no/hydrology/forecast/flood/v1.0.10/api/Warning/Current",
    ],
    [
      "dsb",
      "DSB beredskap",
      "https://ogc.dsb.no/wms.ashx?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0",
    ],
  ];
  for (const [source, label, url] of probes) {
    try {
      const response = await fetcher(url, {
        headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
      });
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
  results.push({
    source: "datex",
    label: "Vegvesen DATEX",
    state: process.env.DATEX_API_KEY ? "ok" : "awaiting_access",
    detail: process.env.DATEX_API_KEY ? "Tilgang konfigurert" : "Venter på registrert tilgang",
  });
  results.push({
    source: "politiloggen",
    label: "Politiloggen",
    state: process.env.POLITILOGGEN_ENABLED === "true" ? "degraded" : "disabled",
    detail:
      process.env.POLITILOGGEN_ENABLED === "true"
        ? "Eksperimentell adapter; endepunktet er endrings- og policyfølsomt"
        : "Eksperimentell adapter er slått av",
  });
  return results;
}

export async function collectPolitiloggenPersonalUse(
  fetcher: typeof fetch = fetch,
): Promise<unknown[]> {
  if (process.env.POLITILOGGEN_ENABLED !== "true") return [];
  const response = await fetcher("https://www.politiet.no/politiloggen/api/messagethreads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "NyttTrondheim/0.1 personlig bruk",
    },
    body: JSON.stringify({ skip: 0, take: 10, districts: ["Trøndelag"], category: [] }),
  });
  if (!response.ok) throw new Error(`Politiloggen returned ${response.status}`);
  const result = (await response.json()) as { messageThreads?: unknown[] };
  return result.messageThreads ?? [];
}
