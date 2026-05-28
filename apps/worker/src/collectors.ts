import { Buffer } from "node:buffer";
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

const defaultDatexSituationEndpoint =
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata";

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function datexBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function canonicalUrl(rawUrl: string, base?: string): string {
  const url = new URL(rawUrl, base);
  url.hash = "";
  for (const parameter of [...url.searchParams.keys()]) {
    if (parameter.startsWith("utm_") || parameter === "fbclid") {
      url.searchParams.delete(parameter);
    }
  }
  return url.toString();
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
    const link = textValue(item.link).trim();
    if (!title || !link) return [];
    const url = canonicalUrl(link);
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
    const response = await fetcher(url, {
      headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
    });
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
  const response = await fetcher(url, {
    headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
  });
  if (!response.ok) throw new Error(`Trondheim kommune returned ${response.status}`);
  const $ = cheerio.load(await response.text());
  const candidates: Array<Omit<Article, "publishedAt">> = [];
  $("article.card").each((_index, element) => {
    const link = $(element).find("a[href]").first();
    const title = link.text().replace(/\s+/g, " ").trim();
    const href = link.attr("href");
    if (!title || !href) return;
    const canonical = canonicalUrl(href, url);
    const excerpt = $(element).text().replace(title, "").replace(/\s+/g, " ").trim();
    candidates.push({
      id: stableId("trondheim_kommune", canonical),
      source: "trondheim_kommune",
      sourceLabel: "Trondheim kommune",
      title,
      excerpt: excerpt.slice(0, 300),
      url: canonical,
      scope: "trondheim",
      category: categorize(`${title} ${excerpt}`),
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

  const endpoint = nonEmptyEnv(process.env.DATEX_ENDPOINT) ?? defaultDatexSituationEndpoint;
  try {
    const response = await fetcher(endpoint, {
      headers: {
        "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech",
        Authorization: datexBasicAuthHeader(username, password),
      },
    });
    return {
      source: "datex",
      label: "Vegvesen DATEX",
      state: response.ok ? "ok" : "degraded",
      detail: response.ok ? "Tilgang konfigurert og testet" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { source: "datex", label: "Vegvesen DATEX", state: "degraded", detail: String(error) };
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
  results.push(await probeDatex(fetcher));
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
