import { createHash } from "node:crypto";
import type { Point } from "geojson";
import type {
  SourceItemInput,
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficEventState,
  TrafficMapEvent,
} from "@nytt/shared";
import { fetchWithSourcePolicy } from "./fetchPolicy.js";

export type TrafficInfoObject = Record<string, unknown>;

export const defaultTrafficInfoEndpoint =
  "https://traffic-info.atlas.vegvesen.no/traffic-information/messages?sort=priorityScore&lang=no";

const trondheimRegion = { south: 62.9, north: 63.75, west: 9.6, east: 11.3 };

export function trafficInfoRequestHeaders(): Record<string, string> {
  return {
    accept: "application/vnd.svv.v2+json; charset=utf-8",
    "X-System-ID": "vvtraf",
    "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech",
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isObject(value: unknown): value is TrafficInfoObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
  }
  if (isObject(value) && "#text" in value) return text(value["#text"]);
  return undefined;
}

export function iso(value: unknown, fallback?: string): string | undefined {
  const input = text(value) ?? fallback;
  if (!input) return undefined;
  const time = Date.parse(input);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function pointGeometry(message: TrafficInfoObject): Point | undefined {
  const position =
    isObject(message.icon) && isObject(message.icon.position) ? message.icon.position : undefined;
  const coordinates = Array.isArray(position?.coordinates) ? position.coordinates : undefined;
  if (!coordinates || coordinates.length < 2) return undefined;

  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

  return { type: "Point", coordinates: [lng, lat] };
}

export function trafficInfoSourceItemInput(
  event: TrafficMapEvent,
  options: { fetchedAt: string; rawMessage: unknown },
): SourceItemInput {
  const captureHash = sha256(
    JSON.stringify([
      event.source,
      event.sourceEventId,
      event.updatedAt,
      event.state,
      event.validTo,
    ]),
  );
  return {
    id: `source:${sha256(JSON.stringify([event.source, "official_event", event.sourceEventId]))}`,
    provider: "vegvesen_traffic_info",
    kind: "official_event",
    externalId: event.sourceEventId,
    originalUrl: event.sourceUrl,
    title: event.title,
    summary: event.description,
    publishedAt: event.updatedAt,
    fetchedAt: options.fetchedAt,
    rawPayload: options.rawMessage,
    normalizedPayload: event,
    captureHash,
    geoHint: event.geometry,
    reliabilityTier: "official",
  };
}

function stateFromActivityStatus(status: unknown): TrafficEventState {
  switch (text(status)?.toLocaleLowerCase("en")) {
    case "future":
      return "planned";
    case "inactive":
      return "expired";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "active":
    default:
      return "active";
  }
}

function categoryHaystack(message: TrafficInfoObject): string {
  const trafficEvent = isObject(message.trafficEvent) ? message.trafficEvent : {};
  const status = isObject(message.trafficStatus) ? message.trafficStatus : {};
  return [
    message.trafficEventCategory,
    trafficEvent.trafficEventType,
    trafficEvent.trafficEventDescription,
    status.type,
    status.description,
    message.publicCommentDescription,
  ]
    .map((part) => text(part) ?? "")
    .join(" ")
    .toLocaleLowerCase("nb");
}

function categoryFromMessage(message: TrafficInfoObject): TrafficEventCategory {
  const haystack = categoryHaystack(message);

  if (/roadworks|road\s*works|veiarbeid|vegarbeid|mobile\s*roadworks/.test(haystack)) {
    return "roadworks";
  }
  if (/accident|ulykke|collision|kollisjon/.test(haystack)) return "accident";
  if (/roadclosed|road\s*closed|closed|closure|stengt|sperret/.test(haystack)) return "closure";
  if (/congestion|queue|kø|koe|forsinkelse|saktekjøring/.test(haystack)) return "congestion";
  if (/weather|vær|vaer|føre|fore|glatt|snø|sno|is\b|ice\b|vind/.test(haystack)) return "weather";
  if (/restriction|weight|height|width|length|restriksjon|begrensning|kolonne/.test(haystack)) {
    return "restriction";
  }
  if (/obstruction|hindring|debris|gjenstand|dyr|animal|stein|ras/.test(haystack))
    return "obstruction";
  return "other";
}

function severityFromMessage(
  message: TrafficInfoObject,
  category: TrafficEventCategory,
): TrafficEventSeverity {
  const status = isObject(message.trafficStatus) ? message.trafficStatus : {};
  const impact = text(message.trafficImpact)?.toLocaleLowerCase("en") ?? "";
  const statusType = text(status.type)?.toLocaleLowerCase("en") ?? "";
  const haystack = categoryHaystack(message);

  if (impact === "very_large" || impact === "verylarge") return "critical";
  if (
    impact === "large" ||
    statusType.includes("roadclosed") ||
    /roadclosed|road\s*closed|stengt|sperret/.test(haystack) ||
    category === "accident"
  ) {
    return "high";
  }
  if (
    impact === "small" ||
    impact === "roadworks" ||
    impact === "congestion" ||
    category === "roadworks" ||
    category === "congestion"
  ) {
    return "medium";
  }
  return "low";
}

function isTrondelagMessage(message: TrafficInfoObject): boolean {
  const location = isObject(message.location) ? message.location : {};
  const counties = Array.isArray(location.counties) ? location.counties : [];
  return counties.some(
    (county) => isObject(county) && /trøndelag|trondelag/i.test(text(county.name) ?? ""),
  );
}

function pointInTrondheimRegion(geometry: Point | undefined): boolean {
  if (!geometry || geometry.type !== "Point") return false;
  const [lng, lat] = geometry.coordinates;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= trondheimRegion.south &&
    lat <= trondheimRegion.north &&
    lng >= trondheimRegion.west &&
    lng <= trondheimRegion.east
  );
}

function roadNameForMessage(message: TrafficInfoObject): string | undefined {
  const location = isObject(message.location) ? message.location : {};
  const roads = Array.isArray(location.roads) ? location.roads.filter(isObject) : [];
  return roads
    .map((road) => text(road.number) ?? text(road.name))
    .find((road) => road !== undefined);
}

export interface TrafficInfoParseOptions {
  endpoint: string;
  receivedAt: string;
}

export interface TrafficInfoParseResult {
  events: TrafficMapEvent[];
  rawMessagesById: Map<string, TrafficInfoObject>;
  sourcePayloadHash: string;
  totalMessages: number;
  relevantMessages: number;
}

export function parseTrafficInfoMessages(
  rawJson: string,
  options: TrafficInfoParseOptions,
): TrafficInfoParseResult {
  const parsed = JSON.parse(rawJson) as unknown;
  if (!isObject(parsed) || !Array.isArray(parsed.trafficMessages)) {
    throw new Error("TrafficInfo payload mangler trafficMessages[]");
  }

  const events: TrafficMapEvent[] = [];
  const rawMessagesById = new Map<string, TrafficInfoObject>();

  for (const message of parsed.trafficMessages) {
    if (!isObject(message)) continue;

    const sourceEventId = text(message.id);
    if (!sourceEventId) continue;

    const geometry = pointGeometry(message);
    if (!geometry) continue;

    if (!isTrondelagMessage(message) && !pointInTrondheimRegion(geometry)) continue;

    const details = isObject(message.locationDescriptionDetails)
      ? message.locationDescriptionDetails
      : {};
    const title =
      text(details.simpleLocationDescription) ??
      text(message.publicCommentDescription) ??
      "Trafikkmelding";
    const category = categoryFromMessage(message);
    const severity = severityFromMessage(message, category);
    const [lng, lat] = geometry.coordinates as [number, number];
    const publicationTime = iso(message.publicationTime, options.receivedAt) ?? options.receivedAt;

    rawMessagesById.set(sourceEventId, message);
    events.push({
      id: `vegvesen-traffic-info:${sourceEventId}`,
      source: "vegvesen_traffic_info",
      sourceEventId,
      category,
      severity,
      state: stateFromActivityStatus(message.activityStatus),
      title,
      description: text(message.publicCommentDescription),
      locationName: text(details.simpleLocationDescription),
      roadName: roadNameForMessage(message),
      validFrom: iso(message.startTime),
      validTo: iso(message.estimatedEndTime),
      updatedAt: iso(message.updatedTime, publicationTime) ?? publicationTime,
      sourceUrl: `https://www.vegvesen.no/trafikk/hvaskjer?lat=${lat}&lng=${lng}&zoom=14`,
      geometry,
      rawType: text(message.trafficEventCategory),
      confidence: 1,
    });
  }

  return {
    events,
    rawMessagesById,
    sourcePayloadHash: sha256(rawJson),
    totalMessages: parsed.trafficMessages.length,
    relevantMessages: events.length,
  };
}

export interface TrafficInfoCollectOptions {
  endpoint: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export async function collectTrafficInfoMessages({
  endpoint,
  fetcher = fetch,
  now = () => new Date(),
}: TrafficInfoCollectOptions): Promise<TrafficInfoParseResult> {
  const response = await fetchWithSourcePolicy(fetcher, endpoint, {
    headers: trafficInfoRequestHeaders(),
  });
  if (!response.ok) throw new Error(`TrafficInfo returned HTTP ${response.status}`);
  return parseTrafficInfoMessages(await response.text(), {
    endpoint,
    receivedAt: now().toISOString(),
  });
}
