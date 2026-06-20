import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import type { Article, SourceId } from "@nytt/shared";
import { articleTopics, categorize, detectScope, extractPlaces } from "./classify.js";
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

function feedPublishedAt(value: unknown): string {
  const parsed = Date.parse(textValue(value));
  return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
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
  };
  if (!feed.rss?.channel) {
    throw new Error(`${source.label} RSS-format mangler kanal`);
  }
  return asArray(feed.rss?.channel?.item).flatMap((item) => {
    const title = textValue(item.title).trim();
    const excerpt = textValue(item.description)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const link = textValue(item.link).trim();
    if (!title || !link) return [];
    let url: string;
    try {
      url = canonicalUrl(link, source.url);
    } catch {
      return [];
    }
    const scope = detectScope(`${title} ${excerpt}`);
    if (!scope && !source.retainRegionalUnmatched) return [];
    const category = categorize(`${title} ${excerpt}`);
    return [
      {
        id: stableId(source.id, url),
        source: source.id,
        sourceLabel: source.label,
        title,
        excerpt: excerpt.slice(0, 300),
        url,
        publishedAt: feedPublishedAt(item.pubDate),
        scope: scope ?? "trondelag",
        category,
        topics: articleTopics(`${title} ${excerpt}`, category),
        places: extractPlaces(`${title} ${excerpt}`),
      },
    ];
  });
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

async function municipalPublishedAt(url: string, fetcher: typeof fetch): Promise<string> {
  try {
    const response = await fetchWithSourcePolicy(fetcher, url);
    if (!response.ok) return new Date().toISOString();
    const detail = cheerio.load(await response.text());
    const value = detail('meta[property="article:published_time"]').attr("content") ?? "";
    return parseNorwegianDate(value) ?? new Date().toISOString();
  } catch {
    return new Date().toISOString();
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
  const candidates: Array<Omit<Article, "publishedAt">> = [];
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
    const excerpt = $(element).text().replace(title, "").replace(/\s+/g, " ").trim();
    const category = categorize(`${title} ${excerpt}`);
    candidates.push({
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
    });
  });
  return Promise.all(
    candidates.map(async (article) => ({
      ...article,
      publishedAt: await municipalPublishedAt(article.url, fetcher),
    })),
  );
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
