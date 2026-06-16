import { createHash } from "node:crypto";
import type { Geometry } from "geojson";
import type { OfficialEvent, SituationType } from "@nytt/shared";
import { XMLParser } from "fast-xml-parser";
import { fetchWithSourcePolicy, sourceUserAgent } from "./fetchPolicy.js";

const userAgent = { "User-Agent": sourceUserAgent };
const metRssUrl =
  "https://api.met.no/weatherapi/metalerts/2.0/current.rss?county=50&geographicDomain=land&lang=no";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function iso(value: unknown, fallback = new Date().toISOString()): string {
  const date = new Date(string(value));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function officialId(source: "met" | "nve", key: string): string {
  return `${source}-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function metEventType(event: string): SituationType {
  const normalized = event.toLocaleLowerCase("nb");
  if (normalized.includes("forestfire") || normalized.includes("skogbrann")) return "fire";
  if (normalized.includes("rainflood") || normalized.includes("flom")) return "flood";
  if (normalized.includes("landslide") || normalized.includes("jordskred")) return "landslide";
  return "weather";
}

function xmlText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return string(object(value)["#text"]);
}

function parsePolygon(value: unknown): Geometry | undefined {
  const coordinates = xmlText(value).trim().split(/\s+/).map(Number);
  if (coordinates.length < 6 || coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
    return undefined;
  }
  const ring: [number, number][] = [];
  for (let i = 0; i < coordinates.length - 1; i += 2) {
    ring.push([coordinates[i + 1]!, coordinates[i]!]);
  }
  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last) return undefined;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return { type: "Polygon", coordinates: [ring] };
}

function capReferences(value: unknown): string[] {
  return xmlText(value)
    .trim()
    .split(/\s+/)
    .flatMap((reference) => {
      const fields = reference.split(",");
      return fields[1] ? [officialId("met", fields[1])] : [];
    });
}

export async function collectMetWarnings(
  fetcher: typeof fetch = fetch,
  _knownIds?: Set<string>,
): Promise<OfficialEvent[]> {
  void _knownIds;
  const response = await fetchWithSourcePolicy(fetcher, metRssUrl, { headers: userAgent });
  if (!response.ok) throw new Error(`MET MetAlerts returned ${response.status}`);
  const rss = object(
    new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(await response.text()),
  );
  const channel = object(object(rss.rss).channel);
  const rawItems = channel.item
    ? Array.isArray(channel.item)
      ? channel.item
      : [channel.item]
    : [];
  const events: OfficialEvent[] = [];
  for (const rawItem of rawItems) {
    const item = object(rawItem);
    const identifier = xmlText(item.guid);
    const id = officialId("met", identifier);
    const sourceUrl = xmlText(item.link);
    const geometry = parsePolygon(item["georss:polygon"]);
    if (!identifier || !sourceUrl) continue;
    const capResponse = await fetchWithSourcePolicy(fetcher, sourceUrl, { headers: userAgent });
    if (!capResponse.ok) throw new Error(`MET CAP document returned ${capResponse.status}`);
    const parsedCap = object(
      new XMLParser({
        ignoreAttributes: false,
        processEntities: false,
        removeNSPrefix: true,
      }).parse(await capResponse.text()),
    );
    const cap = object(parsedCap.alert);
    const info = object(cap.info);
    const title = xmlText(info.headline) || xmlText(item.title) || "Farevarsel fra MET";
    const event = xmlText(info.event) || title;
    const publishedAt = iso(xmlText(cap.sent) || xmlText(item.pubDate));
    const validFrom = iso(xmlText(info.onset) || xmlText(info.effective), publishedAt);
    const validTo = iso(xmlText(info.expires), validFrom);
    const msgType = xmlText(cap.msgType).toLocaleLowerCase("en");
    events.push({
      id,
      source: "met",
      eventType: metEventType(event),
      title,
      detail: xmlText(info.description) || xmlText(item.description) || title,
      sourceUrl,
      areaLabel: xmlText(object(info.area).areaDesc) || "Trøndelag",
      state: msgType === "cancel" ? "cancelled" : msgType === "update" ? "updated" : "active",
      severity: xmlText(info.severity),
      publishedAt,
      validFrom,
      validTo,
      geometry,
      replacesIds: capReferences(cap.references),
      raw: { rss: rawItem, cap },
    });
  }
  return events;
}

interface NveEndpoint {
  url: string;
  type: SituationType;
  label: string;
  scopeLabel: string;
}

const nveEndpoints: NveEndpoint[] = [
  {
    url: "https://api01.nve.no/hydrology/forecast/flood/v1.0.10/api/Warning/Municipality/5001/1/",
    type: "flood",
    label: "Varsler fra Flomvarslingen i Norge og www.varsom.no",
    scopeLabel: "Trondheim",
  },
  {
    url: "https://api01.nve.no/hydrology/forecast/flood/v1.0.10/api/Warning/County/50/1/",
    type: "flood",
    label: "Varsler fra Flomvarslingen i Norge og www.varsom.no",
    scopeLabel: "Trøndelag",
  },
  {
    url: "https://api01.nve.no/hydrology/forecast/landslide/v1.0.6/api/Warning/Municipality/5001/1/",
    type: "landslide",
    label: "Varsler fra Jordskredvarslingen i Norge og www.varsom.no",
    scopeLabel: "Trondheim",
  },
  {
    url: "https://api01.nve.no/hydrology/forecast/landslide/v1.0.6/api/Warning/County/50/1/",
    type: "landslide",
    label: "Varsler fra Jordskredvarslingen i Norge og www.varsom.no",
    scopeLabel: "Trøndelag",
  },
];

function nveAreaLabel(warning: JsonObject, scopeLabel: string): string {
  const municipalities = Array.isArray(warning.MunicipalityList)
    ? warning.MunicipalityList.map((municipality) => string(object(municipality).Name)).filter(
        Boolean,
      )
    : [];
  return string(warning.Area) || municipalities.join(", ") || scopeLabel;
}

export async function collectNveWarnings(fetcher: typeof fetch = fetch): Promise<OfficialEvent[]> {
  const eventSets = await Promise.all(
    nveEndpoints.map(async ({ url, type, label, scopeLabel }) => {
      const response = await fetchWithSourcePolicy(fetcher, url, {
        headers: { ...userAgent, Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`${label} returned ${response.status}`);
      const warnings = (await response.json()) as unknown;
      return (Array.isArray(warnings) ? warnings : []).flatMap((rawWarning) => {
        const warning = object(rawWarning);
        const level = Number(warning.ActivityLevel ?? 0);
        if (level < 2) return [];
        const identity = `${label}:${string(warning.MasterId)}:${string(warning.Id)}:${string(warning.ValidFrom)}`;
        const title = string(warning.MainText, label);
        return [
          {
            id: officialId("nve", identity),
            source: "nve",
            eventType: type,
            title,
            detail: [string(warning.WarningText), string(warning.ConsequenceText)]
              .filter(Boolean)
              .join(" "),
            sourceUrl: url,
            areaLabel: nveAreaLabel(warning, scopeLabel),
            state:
              string(warning.CapStatus).toLocaleLowerCase("en") === "cancel"
                ? "cancelled"
                : "active",
            severity: `Nivå ${level}`,
            publishedAt: iso(warning.PublishTime || warning.CreatedTime),
            validFrom: iso(warning.ValidFrom),
            validTo: iso(warning.ValidTo),
            raw: rawWarning,
          } satisfies OfficialEvent,
        ];
      });
    }),
  );
  const uniqueEvents = new Map<string, OfficialEvent>();
  for (const event of eventSets.flat()) {
    if (!uniqueEvents.has(event.id)) uniqueEvents.set(event.id, event);
  }
  return [...uniqueEvents.values()];
}
