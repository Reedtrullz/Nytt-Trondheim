import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  TrafficEventSeverity,
  TrafficMapEvent,
  TrafficMapSourceStatus,
  TravelPlanItinerary,
  TravelPlanItineraryLabel,
  TravelPlanLeg,
  TravelPlanLegMode,
  TravelPlanLegNotice,
  TravelPlanLegPlace,
  TravelPlanNextTransitOption,
  TravelPlanPayload,
  TravelPlanPlace,
  TravelPlanRoute,
  TravelPlanTrafficImpact,
  TravelPlanTransitSuggestion,
  TravelPlanComparisonPreset,
  TravelPlanComparisonSource,
} from "@nytt/shared";
import type { Geometry, LineString } from "geojson";
import type { Bounds, Coordinate, CoordinateSegment } from "./geo.js";
import {
  coordinateSegmentsFromGeometry,
  coordinatesFromGeometry,
  distanceMeters,
  distancePointToSegmentMeters,
  distanceSegmentToSegmentMeters,
} from "./geo.js";

const USER_AGENT = "NyttTrondheim/0.1 (traffic travel planner; contact reidar.tech)";
const GEOCODE_TIMEOUT_MS = 4_000;
const ROUTE_TIMEOUT_MS = 4_000;
const ENTUR_JOURNEY_TIMEOUT_MS = 4_000;
const GEOCODE_CACHE_MS = 5 * 60_000;
const GEOCODE_CACHE_MAX = 200;
const ROUTE_CACHE_MS = 2 * 60_000;
const ROUTE_CACHE_MAX = 200;
const ENTUR_JOURNEY_CACHE_MS = 45_000;
const ENTUR_JOURNEY_FAILURE_CACHE_MS = 15_000;
const ENTUR_JOURNEY_CACHE_MAX = 100;
const ENTUR_JOURNEY_RATE_WINDOW_MS = 60_000;
const ENTUR_JOURNEY_RATE_MAX = 60;
const ENTUR_JOURNEY_CIRCUIT_WINDOW_MS = 60_000;
const ENTUR_JOURNEY_CIRCUIT_FAILURES = 3;
const ENTUR_JOURNEY_CIRCUIT_OPEN_MS = 30_000;
const ENTUR_JOURNEY_MAX_PATTERNS = 5;
const ENTUR_JOURNEY_MAX_LEGS = 12;
const ENTUR_JOURNEY_MAX_POLYLINE_CHARS = 12_000;
const ENTUR_JOURNEY_MAX_POLYLINE_POINTS = 600;
const ROUTE_PADDING_METERS = 2_500;
const ROUTE_TRAFFIC_BUFFER_METERS = 1_500;
const ROUTE_TRANSIT_BUFFER_METERS = 1_200;
const ROUTE_CONTEXT_LOOK_BEHIND_MS = 15 * 60_000;
const ROUTE_CONTEXT_MIN_LOOK_AHEAD_MS = 2 * 60 * 60_000;
const ROUTE_CONTEXT_AFTER_ROUTE_PADDING_MS = 60 * 60_000;
const WALKING_SPEED_METERS_PER_SECOND = 1.35;
const ENTUR_JOURNEY_PLANNER_ENDPOINT = "https://api.entur.io/journey-planner/v3/graphql";
const TRONDELAG_TRAVEL_BOUNDS = {
  north: 64.7,
  south: 62.2,
  east: 12.4,
  west: 8.0,
} satisfies Bounds;

const sourceIds = new Set<TrafficMapSourceStatus["source"]>([
  "datex",
  "datex_travel_time",
  "datex_weather",
  "datex_cctv",
  "trafikkdata",
  "vegvesen_traffic_info",
  "entur_vehicle_positions",
  "entur_service_alerts",
]);

const severityRank: Record<TrafficEventSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

type TravelPlanContextWindow = {
  fromMs: number;
  toMs: number;
};

function timestampMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function travelPlanContextWindow(
  route: TravelPlanRoute,
  requestedDepartureTime: string,
  generatedAt: Date,
): TravelPlanContextWindow {
  const requestedMs = timestampMs(requestedDepartureTime) ?? generatedAt.getTime();
  const routeDurationMs =
    route.durationSeconds !== undefined && route.durationSeconds > 0
      ? route.durationSeconds * 1000
      : 0;
  const lookAheadMs = Math.max(
    ROUTE_CONTEXT_MIN_LOOK_AHEAD_MS,
    routeDurationMs + ROUTE_CONTEXT_AFTER_ROUTE_PADDING_MS,
  );
  return {
    fromMs: requestedMs - ROUTE_CONTEXT_LOOK_BEHIND_MS,
    toMs: requestedMs + lookAheadMs,
  };
}

function intervalIntersectsTravelPlanWindow(input: {
  validFrom?: string;
  validTo?: string;
  fallbackStart?: string;
  openEnded?: boolean;
  window: TravelPlanContextWindow;
}): boolean {
  const validFromMs = timestampMs(input.validFrom);
  const fallbackStartMs = timestampMs(input.fallbackStart);
  const startMs = validFromMs ?? fallbackStartMs;
  const endMs = input.validTo
    ? (timestampMs(input.validTo) ?? Number.POSITIVE_INFINITY)
    : input.openEnded || validFromMs !== undefined
      ? Number.POSITIVE_INFINITY
      : (fallbackStartMs ?? Number.POSITIVE_INFINITY);

  if (Number.isFinite(endMs) && endMs < input.window.fromMs) return false;
  if (startMs !== undefined && startMs > input.window.toMs) return false;
  return true;
}

function trafficEventIntersectsTravelPlanWindow(
  event: TrafficMapEvent,
  window: TravelPlanContextWindow,
): boolean {
  return intervalIntersectsTravelPlanWindow({
    validFrom: event.validFrom,
    validTo: event.validTo,
    fallbackStart: event.updatedAt,
    openEnded: event.state === "active" && !event.validTo,
    window,
  });
}

function serviceAlertIntersectsTravelPlanWindow(
  alert: PublicTransportServiceAlert,
  window: TravelPlanContextWindow,
): boolean {
  return intervalIntersectsTravelPlanWindow({
    validFrom: alert.validFrom,
    validTo: alert.validTo,
    fallbackStart: alert.updatedAt,
    openEnded: alert.state === "active" && !alert.validTo,
    window,
  });
}

export class TravelPlanRequestError extends Error {
  status = 400;
}

class TravelPlanDependencyError extends Error {
  status = 503;
}

class EnturJourneyPlannerError extends Error {
  countsForCircuit: boolean;

  constructor(message: string, options: { countsForCircuit?: boolean } = {}) {
    super(message);
    this.countsForCircuit = options.countsForCircuit ?? false;
  }
}

type TimedPromiseCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const geocodeCache = new Map<string, TimedPromiseCacheEntry<TravelPlanPlace>>();
const routeCache = new Map<string, TimedPromiseCacheEntry<TravelPlanRoute>>();

function pruneTimedCache<T>(
  cache: Map<string, TimedPromiseCacheEntry<T>>,
  nowMs: number,
  maxEntries: number,
): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= nowMs) cache.delete(key);
  }
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function finiteCoordinate(lng: number, lat: number): Coordinate | undefined {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return [lng, lat];
}

function coordinateFromUnknown(value: unknown): Coordinate | undefined {
  if (!Array.isArray(value)) return undefined;
  const [lng, lat] = value;
  if (typeof lng !== "number" || typeof lat !== "number") return undefined;
  return finiteCoordinate(lng, lat);
}

function coordinateInBounds(coordinate: Coordinate, bounds: Bounds): boolean {
  const [lng, lat] = coordinate;
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

function parseCoordinateInput(query: string): Coordinate | undefined {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const candidates = [finiteCoordinate(second, first), finiteCoordinate(first, second)].filter(
    (coordinate): coordinate is Coordinate => Boolean(coordinate),
  );
  const inServiceArea = candidates.filter((coordinate) =>
    coordinateInBounds(coordinate, TRONDELAG_TRAVEL_BOUNDS),
  );
  if (inServiceArea.length === 1) return inServiceArea[0];
  if (candidates.length > 0) {
    throw new TravelPlanRequestError("Koordinater må være i Trøndelag-området.");
  }
  return undefined;
}

async function fetchJsonWithTimeout(url: URL, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new TravelPlanDependencyError(`Klarte ikke å hente ${url.hostname}.`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof TravelPlanDependencyError) throw error;
    throw new TravelPlanDependencyError(`Klarte ikke å hente ${url.hostname}.`);
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeTravelPlanPlaceUncached(query: string): Promise<TravelPlanPlace> {
  const coordinate = parseCoordinateInput(query);
  if (coordinate) {
    return { query, label: query.trim(), coordinate };
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", "nb");
  url.searchParams.set("countrycodes", "no");
  url.searchParams.set(
    "viewbox",
    `${TRONDELAG_TRAVEL_BOUNDS.west},${TRONDELAG_TRAVEL_BOUNDS.north},${TRONDELAG_TRAVEL_BOUNDS.east},${TRONDELAG_TRAVEL_BOUNDS.south}`,
  );
  url.searchParams.set("bounded", "1");
  url.searchParams.set("q", `${query.trim()}, Trondheim, Norway`);

  const payload = await fetchJsonWithTimeout(url, GEOCODE_TIMEOUT_MS);
  const first = Array.isArray(payload)
    ? (payload[0] as Record<string, unknown> | undefined)
    : undefined;
  const lat = typeof first?.lat === "string" ? Number(first.lat) : Number(first?.lat);
  const lon = typeof first?.lon === "string" ? Number(first.lon) : Number(first?.lon);
  const resolved = finiteCoordinate(lon, lat);
  if (!first || !resolved) {
    throw new TravelPlanRequestError(`Fant ikke "${query}" i Trøndelag-området.`);
  }
  return {
    query,
    label: typeof first.display_name === "string" ? first.display_name : query.trim(),
    coordinate: resolved,
  };
}

export async function geocodeTravelPlanPlace(query: string): Promise<TravelPlanPlace> {
  const coordinate = parseCoordinateInput(query);
  if (coordinate) {
    return { query, label: query.trim(), coordinate };
  }

  const nowMs = Date.now();
  pruneTimedCache(geocodeCache, nowMs, GEOCODE_CACHE_MAX);
  const cacheKey = query.trim().toLocaleLowerCase("nb");
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.promise;

  const promise = geocodeTravelPlanPlaceUncached(query).catch((error) => {
    geocodeCache.delete(cacheKey);
    throw error;
  });
  geocodeCache.set(cacheKey, { expiresAt: nowMs + GEOCODE_CACHE_MS, promise });
  return promise;
}

function directRoute(origin: TravelPlanPlace, destination: TravelPlanPlace): TravelPlanRoute {
  const distance = Math.round(distanceMeters(origin.coordinate, destination.coordinate));
  return {
    source: "direct",
    geometry: { type: "LineString", coordinates: [origin.coordinate, destination.coordinate] },
    distanceMeters: distance,
    detail: "Ruten er vist som rett korridor fordi veiruting ikke var tilgjengelig.",
  };
}

function isLineString(value: unknown): value is LineString {
  const record = value as Partial<LineString> | undefined;
  return (
    record?.type === "LineString" &&
    Array.isArray(record.coordinates) &&
    record.coordinates.length >= 2 &&
    record.coordinates.every((coordinate) => coordinateFromUnknown(coordinate))
  );
}

async function resolveTravelPlanRouteUncached(
  origin: TravelPlanPlace,
  destination: TravelPlanPlace,
): Promise<TravelPlanRoute> {
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${origin.coordinate[0]},${origin.coordinate[1]};${destination.coordinate[0]},${destination.coordinate[1]}`,
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("steps", "false");

  try {
    const payload = (await fetchJsonWithTimeout(url, ROUTE_TIMEOUT_MS)) as {
      routes?: Array<{ distance?: unknown; duration?: unknown; geometry?: unknown }>;
    };
    const route = payload.routes?.[0];
    if (!route || !isLineString(route.geometry)) return directRoute(origin, destination);
    const distance =
      typeof route.distance === "number" && Number.isFinite(route.distance)
        ? Math.round(route.distance)
        : Math.round(distanceMeters(origin.coordinate, destination.coordinate));
    const duration =
      typeof route.duration === "number" && Number.isFinite(route.duration)
        ? Math.round(route.duration)
        : undefined;
    return {
      source: "osrm",
      geometry: route.geometry,
      distanceMeters: distance,
      ...(duration !== undefined ? { durationSeconds: duration } : {}),
      detail: "Rute beregnet med OSRM og brukt som korridor for trafikk- og kollektivdata.",
    };
  } catch {
    return directRoute(origin, destination);
  }
}

export async function resolveTravelPlanRoute(
  origin: TravelPlanPlace,
  destination: TravelPlanPlace,
): Promise<TravelPlanRoute> {
  const nowMs = Date.now();
  pruneTimedCache(routeCache, nowMs, ROUTE_CACHE_MAX);
  const cacheKey = JSON.stringify([
    origin.coordinate.map((value) => value.toFixed(5)),
    destination.coordinate.map((value) => value.toFixed(5)),
  ]);
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.promise;

  const promise = resolveTravelPlanRouteUncached(origin, destination);
  routeCache.set(cacheKey, { expiresAt: nowMs + ROUTE_CACHE_MS, promise });
  return promise;
}

function routeCoordinates(route: TravelPlanRoute): Coordinate[] {
  return route.geometry.coordinates
    .map((coordinate) => coordinateFromUnknown(coordinate))
    .filter((coordinate): coordinate is Coordinate => Boolean(coordinate));
}

function routeSegments(route: TravelPlanRoute): CoordinateSegment[] {
  const coordinates = routeCoordinates(route);
  const segments: CoordinateSegment[] = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    if (start && end) segments.push([start, end]);
  }
  return segments;
}

function pointInRing(point: Coordinate, ring: Coordinate[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const [xi, yi] = currentPoint;
    const [xj, yj] = previousPoint;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Coordinate, polygon: LineString["coordinates"][]): boolean {
  const [outerRing, ...holes] = polygon.map((ring) =>
    ring
      .map((coordinate) => coordinateFromUnknown(coordinate))
      .filter((entry): entry is Coordinate => Boolean(entry)),
  );
  if (!outerRing || !pointInRing(point, outerRing)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

function pointInsideGeometry(point: Coordinate, geometry: Geometry): boolean {
  switch (geometry.type) {
    case "Polygon":
      return pointInPolygon(point, geometry.coordinates);
    case "MultiPolygon":
      return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
    case "GeometryCollection":
      return geometry.geometries.some((entry) => pointInsideGeometry(point, entry));
    default:
      return false;
  }
}

function routeInsideAreaGeometry(geometry: Geometry, route: TravelPlanRoute): boolean {
  return routeCoordinates(route).some((coordinate) => pointInsideGeometry(coordinate, geometry));
}

export function routeBounds(route: TravelPlanRoute, paddingMeters = ROUTE_PADDING_METERS): Bounds {
  const coordinates = routeCoordinates(route);
  const lngs = coordinates.map(([lng]) => lng);
  const lats = coordinates.map(([, lat]) => lat);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const centerLat = (minLat + maxLat) / 2;
  const latPadding = paddingMeters / 111_320;
  const lonPadding =
    paddingMeters / (111_320 * Math.max(0.25, Math.cos((centerLat * Math.PI) / 180)));
  return {
    north: Math.min(90, maxLat + latPadding),
    south: Math.max(-90, minLat - latPadding),
    east: Math.min(180, maxLng + lonPadding),
    west: Math.max(-180, minLng - lonPadding),
  };
}

function geometryDistanceToRouteMeters(
  geometry: Geometry | undefined,
  route: TravelPlanRoute,
): number {
  if (!geometry) return Number.POSITIVE_INFINITY;
  if (routeInsideAreaGeometry(geometry, route)) return 0;
  const segments = routeSegments(route);
  const coordinates = coordinatesFromGeometry(geometry);
  if (!segments.length) {
    const [origin] = routeCoordinates(route);
    if (!origin) return Number.POSITIVE_INFINITY;
    return Math.min(...coordinates.map((coordinate) => distanceMeters(coordinate, origin)));
  }
  const pointDistances = coordinates.flatMap((coordinate) =>
    segments.map((segment) => distancePointToSegmentMeters(coordinate, segment[0], segment[1])),
  );
  const eventSegments = coordinateSegmentsFromGeometry(geometry);
  const segmentDistances = eventSegments.flatMap((eventSegment) =>
    segments.map((routeSegment) => distanceSegmentToSegmentMeters(eventSegment, routeSegment)),
  );
  return Math.min(...pointDistances, ...segmentDistances, Number.POSITIVE_INFINITY);
}

function trafficImpacts(
  events: TrafficMapEvent[],
  route: TravelPlanRoute,
): TravelPlanTrafficImpact[] {
  return events
    .map((event) => ({
      event,
      distanceMeters: Math.round(geometryDistanceToRouteMeters(event.geometry, route)),
    }))
    .filter((impact) => impact.distanceMeters <= ROUTE_TRAFFIC_BUFFER_METERS)
    .sort(
      (left, right) =>
        severityRank[right.event.severity] - severityRank[left.event.severity] ||
        left.distanceMeters - right.distanceMeters ||
        left.event.title.localeCompare(right.event.title, "nb"),
    )
    .slice(0, 8)
    .map((impact) => ({
      ...impact,
      severity: impact.event.severity,
      summary: `${impact.distanceMeters} m fra foreslått rute`,
    }));
}

function vehicleTitle(vehicle: PublicTransportVehicle): string {
  const mode = vehicle.mode === "tram" ? "Trikk" : vehicle.mode === "rail" ? "Tog" : "Buss";
  const line = vehicle.publicCode ?? vehicle.lineName ?? vehicle.lineRef ?? "";
  const destination = vehicle.destinationName ? ` mot ${vehicle.destinationName}` : " nær ruten";
  return `${mode}${line ? ` ${line}` : ""}${destination}`;
}

function normalizedLineTokens(value: string | undefined): string[] {
  if (!value) return [];
  const normalized = value.toLocaleLowerCase("nb").replace(/\s+/g, " ").trim();
  const numeric = normalized.match(/\b\d+[a-z]?\b/g) ?? [];
  return [normalized, ...numeric];
}

function transitSuggestions(
  vehicles: PublicTransportVehicle[],
  alerts: PublicTransportServiceAlert[],
  route: TravelPlanRoute,
): TravelPlanTransitSuggestion[] {
  const vehicleSuggestions = vehicles
    .filter((vehicle) => !vehicle.stale)
    .map((vehicle) => ({
      vehicle,
      distanceMeters: Math.round(geometryDistanceToRouteMeters(vehicle.geometry, route)),
    }))
    .filter((candidate) => candidate.distanceMeters <= ROUTE_TRANSIT_BUFFER_METERS)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, 5)
    .map(
      ({ vehicle, distanceMeters }): TravelPlanTransitSuggestion => ({
        id: vehicle.id,
        kind: "vehicle",
        title: vehicleTitle(vehicle),
        detail: "Sist sett nær ruten. Sjekk avgangstid hos AtB/Entur.",
        source: "Entur kjøretøyposisjoner",
        distanceMeters,
        lineName: vehicle.lineName,
        publicCode: vehicle.publicCode,
        mode: vehicle.mode,
      }),
    );

  const nearbyLineTokens = new Set(
    vehicles
      .filter((vehicle) => !vehicle.stale)
      .filter(
        (vehicle) =>
          Math.round(geometryDistanceToRouteMeters(vehicle.geometry, route)) <=
          ROUTE_TRANSIT_BUFFER_METERS,
      )
      .flatMap((vehicle) => [
        ...normalizedLineTokens(vehicle.publicCode),
        ...normalizedLineTokens(vehicle.lineName),
        ...normalizedLineTokens(vehicle.lineRef),
      ]),
  );

  const alertSuggestions = alerts
    .map((alert) => ({
      alert,
      distanceMeters: alert.geometry
        ? Math.round(geometryDistanceToRouteMeters(alert.geometry, route))
        : undefined,
    }))
    .filter((candidate) => {
      if (candidate.distanceMeters !== undefined) {
        return candidate.distanceMeters <= ROUTE_TRANSIT_BUFFER_METERS;
      }
      const alertLineTokens =
        candidate.alert.affectedLineNames?.flatMap(normalizedLineTokens) ?? [];
      return alertLineTokens.some((token) => nearbyLineTokens.has(token));
    })
    .sort((left, right) => (left.distanceMeters ?? 0) - (right.distanceMeters ?? 0))
    .slice(0, 5)
    .map(
      ({ alert, distanceMeters }): TravelPlanTransitSuggestion => ({
        id: alert.id,
        kind: "alert",
        title: alert.summary,
        detail: alert.advice ?? alert.description ?? "Aktivt kollektivavvik langs eller nær ruten.",
        source: "Entur avvik",
        ...(distanceMeters !== undefined ? { distanceMeters } : {}),
        lineName: alert.affectedLineNames?.join(", "),
      }),
    );

  return [
    ...vehicleSuggestions,
    ...alertSuggestions,
    {
      id: "atb-entur-planner",
      kind: "planning_link",
      title: "Sjekk avganger hos AtB/Entur",
      detail:
        "Nytt viser trafikk- og avvikskontekst; bruk AtB/Entur for konkrete avganger og billetter.",
      source: "AtB/Entur",
      href: "https://www.atb.no/reiseplanlegger/",
    },
  ];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
  }
  const record = object(value);
  if (record && "value" in record) return text(record.value);
  return undefined;
}

function localizedText(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    const entries = value
      .map(object)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const norwegian = entries.find((entry) =>
      /^(no|nb|nn)$/i.test(text(entry.language) ?? text(entry.lang) ?? ""),
    );
    return (
      text(norwegian?.value) ??
      text(entries.find((entry) => text(entry.language) === undefined)?.value) ??
      text(entries[0]?.value)
    );
  }
  return text(value);
}

function iso(value: unknown): string | undefined {
  const input = text(value);
  if (!input) return undefined;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function seconds(value: unknown): number | undefined {
  const numeric = finite(value);
  return numeric !== undefined && numeric >= 0 ? Math.round(numeric) : undefined;
}

function secondsBetween(startIso: string, endIso: string): number | undefined {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  return Math.round((end - start) / 1000);
}

function travelPlanLegMode(value: unknown): TravelPlanLegMode {
  switch (String(value ?? "").toLocaleLowerCase("nb")) {
    case "foot":
    case "walk":
      return "walk";
    case "bus":
      return "bus";
    case "tram":
      return "tram";
    case "rail":
      return "rail";
    case "water":
      return "water";
    case "metro":
      return "metro";
    default:
      return "unknown";
  }
}

function lineStringForCoordinates(coordinates: Coordinate[]): LineString {
  return { type: "LineString", coordinates };
}

function legPlace(value: unknown, fallbackName: string): TravelPlanLegPlace | undefined {
  const place = object(value);
  const lat = finite(place?.latitude);
  const lon = finite(place?.longitude);
  const coordinate =
    lat !== undefined && lon !== undefined ? finiteCoordinate(lon, lat) : undefined;
  if (!place || !coordinate) return undefined;
  const quay = object(place.quay);
  return {
    name: text(place.name) ?? text(quay?.name) ?? fallbackName,
    coordinate,
    ...(text(quay?.id) ? { stopId: text(quay?.id) } : {}),
    ...(text(quay?.name) ? { stopName: text(quay?.name) } : {}),
    ...(text(quay?.publicCode) ? { stopCode: text(quay?.publicCode) } : {}),
  };
}

function decodePolyline(value: string | undefined): Coordinate[] {
  if (!value || value.length > ENTUR_JOURNEY_MAX_POLYLINE_CHARS) return [];
  const coordinates: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < value.length && coordinates.length < ENTUR_JOURNEY_MAX_POLYLINE_POINTS) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = value.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < value.length);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = value.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < value.length);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    const coordinate = finiteCoordinate(lng / 100_000, lat / 100_000);
    if (coordinate) coordinates.push(coordinate);
  }

  return coordinates;
}

function legGeometry(
  leg: Record<string, unknown>,
  from: TravelPlanLegPlace,
  to: TravelPlanLegPlace,
) {
  const points = text(object(leg.pointsOnLink)?.points);
  const decoded = decodePolyline(points).filter((coordinate) =>
    coordinateInBounds(coordinate, TRONDELAG_TRAVEL_BOUNDS),
  );
  return lineStringForCoordinates(decoded.length >= 2 ? decoded : [from.coordinate, to.coordinate]);
}

function legLineTokens(leg: Pick<TravelPlanLeg, "publicCode" | "lineName" | "lineId">): string[] {
  return [
    ...normalizedLineTokens(leg.publicCode),
    ...normalizedLineTokens(leg.lineName),
    ...normalizedLineTokens(leg.lineId),
  ];
}

function alertMatchesLeg(alert: PublicTransportServiceAlert, leg: TravelPlanLeg): boolean {
  const tokens = new Set(legLineTokens(leg));
  const alertTokens = [
    ...(alert.affectedLineNames?.flatMap(normalizedLineTokens) ?? []),
    ...(alert.affectedLineRefs?.flatMap(normalizedLineTokens) ?? []),
  ];
  if (alertTokens.some((token) => tokens.has(token))) return true;
  if (!alert.geometry) return false;
  return (
    geometryDistanceToRouteMeters(alert.geometry, {
      source: "direct",
      geometry: leg.geometry,
      distanceMeters: leg.distanceMeters ?? 0,
      detail: "",
    }) <= ROUTE_TRANSIT_BUFFER_METERS
  );
}

function vehicleMatchesLeg(vehicle: PublicTransportVehicle, leg: TravelPlanLeg): boolean {
  if (vehicle.stale) return false;
  const tokens = new Set(legLineTokens(leg));
  const vehicleTokens = [
    ...normalizedLineTokens(vehicle.publicCode),
    ...normalizedLineTokens(vehicle.lineName),
    ...normalizedLineTokens(vehicle.lineRef),
  ];
  if (vehicleTokens.some((token) => tokens.has(token))) return true;
  return (
    geometryDistanceToRouteMeters(vehicle.geometry, {
      source: "direct",
      geometry: leg.geometry,
      distanceMeters: leg.distanceMeters ?? 0,
      detail: "",
    }) <= ROUTE_TRANSIT_BUFFER_METERS
  );
}

function trafficImpactMatchesLeg(impact: TravelPlanTrafficImpact, leg: TravelPlanLeg): boolean {
  if (leg.mode === "walk") return false;
  return (
    geometryDistanceToRouteMeters(impact.event.geometry, {
      source: "direct",
      geometry: leg.geometry,
      distanceMeters: leg.distanceMeters ?? 0,
      detail: "",
    }) <= ROUTE_TRAFFIC_BUFFER_METERS
  );
}

function enturSituationNotice(value: unknown): TravelPlanLegNotice | undefined {
  const situation = object(value);
  const id = text(situation?.id) ?? text(situation?.situationNumber);
  const title = localizedText(situation?.summary);
  if (!id || !title) return undefined;
  const severityText = text(situation?.severity)?.toLocaleLowerCase("nb");
  const severity =
    severityText === "severe" || severityText === "verysevere"
      ? "warning"
      : severityText
        ? "info"
        : undefined;
  return {
    id: `entur-situation:${id}`,
    title,
    detail: localizedText(situation?.advice) ?? localizedText(situation?.description),
    source: "Entur",
    ...(severity ? { severity } : {}),
  };
}

function enturLegFromRaw(rawLeg: unknown, index: number): TravelPlanLeg | undefined {
  const leg = object(rawLeg);
  if (!leg) return undefined;
  const from = legPlace(leg.fromPlace, "Start");
  const to = legPlace(leg.toPlace, "Mål");
  if (!from || !to) return undefined;
  const line = object(leg.line);
  const serviceJourney = object(leg.serviceJourney);
  const fromCall = object(leg.fromEstimatedCall);
  const toCall = object(leg.toEstimatedCall);
  const mode = travelPlanLegMode(leg.mode);
  const expectedStartTime = iso(leg.expectedStartTime) ?? iso(leg.aimedStartTime);
  const expectedEndTime = iso(leg.expectedEndTime) ?? iso(leg.aimedEndTime);
  if (!expectedStartTime || !expectedEndTime) return undefined;
  const aimedStartTime = iso(leg.aimedStartTime) ?? expectedStartTime;
  const aimedEndTime = iso(leg.aimedEndTime) ?? expectedEndTime;
  const durationSeconds =
    seconds(leg.duration) ?? secondsBetween(expectedStartTime, expectedEndTime);
  if (durationSeconds === undefined || durationSeconds <= 0) return undefined;
  const cancelled = Boolean(fromCall?.cancellation) || Boolean(toCall?.cancellation);
  const replacementTransport =
    Boolean(line?.isReplacement) || Boolean(serviceJourney?.isReplacement);
  const notices = (Array.isArray(leg.situations) ? leg.situations : [])
    .map(enturSituationNotice)
    .filter((notice): notice is TravelPlanLegNotice => Boolean(notice));
  if (cancelled) {
    notices.push({
      id: `entur-cancellation:${text(leg.id) ?? index}`,
      title: "Avgangen er innstilt",
      source: "Entur",
      severity: "warning",
    });
  }
  if (replacementTransport) {
    notices.push({
      id: `entur-replacement:${text(leg.id) ?? index}`,
      title: "Erstatningstransport",
      detail: "Entur markerer denne delen som erstatningstransport.",
      source: "Entur",
      severity: "warning",
    });
  }
  const lineName = text(line?.name);
  const publicCode = text(line?.publicCode) ?? text(serviceJourney?.publicCode);
  return {
    id: text(leg.id) ?? `leg:${index}`,
    mode,
    from,
    to,
    aimedStartTime,
    expectedStartTime,
    aimedEndTime,
    expectedEndTime,
    durationSeconds,
    ...(finite(leg.distance) !== undefined
      ? { distanceMeters: Math.round(finite(leg.distance)!) }
      : {}),
    realtime: Boolean(leg.realtime) || Boolean(fromCall?.realtime) || Boolean(toCall?.realtime),
    cancelled,
    replacementTransport,
    ...(text(line?.id) ? { lineId: text(line?.id) } : {}),
    ...(publicCode ? { publicCode } : {}),
    ...(lineName ? { lineName } : {}),
    ...(text(serviceJourney?.id) ? { serviceJourneyId: text(serviceJourney?.id) } : {}),
    geometry: legGeometry(leg, from, to),
    notices,
  };
}

function uniqueModes(legs: TravelPlanLeg[]): TravelPlanLegMode[] {
  const modes = legs.map((leg) => leg.mode).filter((mode) => mode !== "walk");
  const unique = [...new Set(modes)];
  return unique.length ? unique : ["walk"];
}

function transitTransferCount(legs: TravelPlanLeg[]): number {
  return Math.max(0, legs.filter((leg) => leg.mode !== "walk").length - 1);
}

function itineraryFromRaw(rawPattern: unknown, index: number): TravelPlanItinerary | undefined {
  const pattern = object(rawPattern);
  if (!pattern) return undefined;
  const rawLegs = Array.isArray(pattern.legs) ? pattern.legs : [];
  if (!rawLegs.length || rawLegs.length > ENTUR_JOURNEY_MAX_LEGS) return undefined;
  const parsedLegs = rawLegs.map((leg, legIndex) => enturLegFromRaw(leg, legIndex));
  if (parsedLegs.some((leg) => !leg)) return undefined;
  const legs = parsedLegs as TravelPlanLeg[];
  if (!legs.length) return undefined;
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  if (!firstLeg || !lastLeg) return undefined;
  const departureTime =
    iso(pattern.expectedStartTime) ?? iso(pattern.aimedStartTime) ?? firstLeg.expectedStartTime;
  const arrivalTime =
    iso(pattern.expectedEndTime) ?? iso(pattern.aimedEndTime) ?? lastLeg.expectedEndTime;
  const durationSeconds = seconds(pattern.duration) ?? secondsBetween(departureTime, arrivalTime);
  if (durationSeconds === undefined || durationSeconds <= 0) return undefined;
  const lineKey = legs.map((leg) => leg.publicCode ?? leg.lineName ?? leg.mode).join("-");
  return {
    id: `itinerary:${departureTime}:${arrivalTime}:${lineKey}:${index}`,
    decision: "good",
    decisionReason: "Entur foreslår reisen uten kjente avvik i Nytt.",
    labels: [],
    departureTime,
    arrivalTime,
    durationSeconds,
    transferCount: transitTransferCount(legs),
    walkTimeSeconds:
      seconds(pattern.walkTime) ??
      legs
        .filter((leg) => leg.mode === "walk")
        .reduce((total, leg) => total + leg.durationSeconds, 0),
    ...(finite(pattern.waitingTime) !== undefined
      ? { waitingTimeSeconds: Math.round(finite(pattern.waitingTime)!) }
      : {}),
    ...(finite(pattern.distance) !== undefined
      ? { distanceMeters: Math.round(finite(pattern.distance)!) }
      : {}),
    realtime: legs.some((leg) => leg.realtime),
    modes: uniqueModes(legs),
    legs,
    disruptionCount: 0,
    handoffUrl: "https://www.atb.no/reiseplanlegger/",
  };
}

function addUniqueNotice(leg: TravelPlanLeg, notice: TravelPlanLegNotice): void {
  if (leg.notices.some((entry) => entry.id === notice.id)) return;
  leg.notices.push(notice);
}

function enrichItineraries(
  itineraries: TravelPlanItinerary[],
  trafficImpactsForRoute: TravelPlanTrafficImpact[],
  vehicles: PublicTransportVehicle[],
  alerts: PublicTransportServiceAlert[],
): TravelPlanItinerary[] {
  return itineraries.map((itinerary) => {
    const legs = itinerary.legs.map((leg) => ({ ...leg, notices: [...leg.notices] }));
    for (const leg of legs) {
      for (const alert of alerts
        .filter((candidate) => alertMatchesLeg(candidate, leg))
        .slice(0, 3)) {
        addUniqueNotice(leg, {
          id: `alert:${alert.id}`,
          title: alert.summary,
          detail: alert.advice ?? alert.description,
          source: "Entur avvik",
          severity: "warning",
        });
      }
      for (const impact of trafficImpactsForRoute
        .filter((candidate) => trafficImpactMatchesLeg(candidate, leg))
        .slice(0, 3)) {
        addUniqueNotice(leg, {
          id: `traffic:${impact.event.id}`,
          title: impact.event.title,
          detail: impact.summary,
          source: impact.event.source === "datex" ? "DATEX" : "Vegvesen",
          severity: impact.event.severity,
        });
      }
      for (const vehicle of vehicles
        .filter((candidate) => vehicleMatchesLeg(candidate, leg))
        .slice(0, 2)) {
        addUniqueNotice(leg, {
          id: `vehicle:${vehicle.id}`,
          title: vehicleTitle(vehicle),
          detail: "Kjøretøyposisjon observert nær denne delen av reisen.",
          source: "Entur kjøretøyposisjoner",
          severity: "info",
        });
      }
    }

    const flatNotices = legs.flatMap((leg) => leg.notices);
    const hasCancellation = legs.some((leg) => leg.cancelled);
    const hasReplacementTransport = legs.some((leg) => leg.replacementTransport);
    const hasCriticalRoad = flatNotices.some(
      (notice) =>
        notice.severity === "critical" || notice.title.toLocaleLowerCase("nb").includes("innstilt"),
    );
    const hasDisruption = flatNotices.some(
      (notice) => notice.source !== "Entur kjøretøyposisjoner",
    );
    const disruptionCount = flatNotices.filter(
      (notice) => notice.source !== "Entur kjøretøyposisjoner",
    ).length;
    const decision =
      hasCancellation || hasCriticalRoad
        ? "avoid"
        : hasDisruption || hasReplacementTransport
          ? "watch"
          : "good";
    const decisionReason =
      decision === "avoid"
        ? "Minst én del av reisen er innstilt eller har kritisk trafikkpåvirkning."
        : decision === "watch"
          ? hasReplacementTransport
            ? "Entur markerer erstatningstransport eller avvik som kan påvirke reisen."
            : "Nytt fant avvik eller trafikkmeldinger som kan påvirke reisen."
          : "Entur foreslår reisen uten kjente avvik i Nytt.";

    return {
      ...itinerary,
      legs,
      disruptionCount,
      decision,
      decisionReason,
    };
  });
}

function decisionRank(decision: TravelPlanItinerary["decision"]): number {
  switch (decision) {
    case "best":
      return 0;
    case "good":
      return 1;
    case "watch":
      return 2;
    case "avoid":
      return 3;
  }
}

function addItineraryLabel(
  labels: Map<string, Set<TravelPlanItineraryLabel>>,
  itinerary: TravelPlanItinerary | undefined,
  label: TravelPlanItineraryLabel,
): void {
  if (!itinerary) return;
  const existing = labels.get(itinerary.id) ?? new Set<TravelPlanItineraryLabel>();
  existing.add(label);
  labels.set(itinerary.id, existing);
}

function rankItineraries(itineraries: TravelPlanItinerary[]): TravelPlanItinerary[] {
  if (!itineraries.length) return [];
  const ranked = [...itineraries].sort(
    (left, right) =>
      decisionRank(left.decision) - decisionRank(right.decision) ||
      left.durationSeconds - right.durationSeconds ||
      Date.parse(left.departureTime) - Date.parse(right.departureTime),
  );
  const labels = new Map<string, Set<TravelPlanItineraryLabel>>();
  addItineraryLabel(labels, ranked[0], "best_now");
  addItineraryLabel(
    labels,
    [...itineraries].sort(
      (left, right) => Date.parse(left.departureTime) - Date.parse(right.departureTime),
    )[0],
    "soonest_departure",
  );
  addItineraryLabel(
    labels,
    [...itineraries].sort(
      (left, right) =>
        left.transferCount - right.transferCount ||
        left.durationSeconds - right.durationSeconds ||
        decisionRank(left.decision) - decisionRank(right.decision),
    )[0],
    "fewest_transfers",
  );
  addItineraryLabel(
    labels,
    [...itineraries].sort(
      (left, right) =>
        left.disruptionCount - right.disruptionCount ||
        decisionRank(left.decision) - decisionRank(right.decision) ||
        left.transferCount - right.transferCount ||
        left.durationSeconds - right.durationSeconds,
    )[0],
    "most_robust",
  );

  return ranked.map((itinerary) => {
    const itineraryLabels = Array.from(labels.get(itinerary.id) ?? []);
    return {
      ...itinerary,
      labels: itineraryLabels,
      decision:
        itinerary.decision === "good" && itineraryLabels.includes("best_now")
          ? "best"
          : itinerary.decision,
      decisionReason:
        itinerary.decision === "good" && itineraryLabels.includes("best_now")
          ? "Beste kombinasjon av reisetid, avvik og bytter akkurat nå."
          : itinerary.decisionReason,
    };
  });
}

const enturTripQuery = `query NyttTrip($from: Location!, $to: Location!, $dateTime: DateTime!) {
  trip(
    from: $from
    to: $to
    dateTime: $dateTime
    numTripPatterns: 5
    includePlannedCancellations: true
    includeRealtimeCancellations: true
    modes: {
      accessMode: foot
      egressMode: foot
      directMode: foot
      transportModes: [
        { transportMode: bus }
        { transportMode: tram }
        { transportMode: rail }
        { transportMode: water }
      ]
    }
  ) {
    tripPatterns {
      aimedStartTime
      expectedStartTime
      aimedEndTime
      expectedEndTime
      duration
      walkTime
      waitingTime
      distance
      legs {
        id
        mode
        transportSubmode
        aimedStartTime
        expectedStartTime
        aimedEndTime
        expectedEndTime
        duration
        distance
        realtime
        pointsOnLink { points }
        fromPlace { name latitude longitude quay { id name publicCode } }
        toPlace { name latitude longitude quay { id name publicCode } }
        line { id publicCode name transportMode transportSubmode isReplacement }
        serviceJourney { id publicCode isReplacement }
        fromEstimatedCall { cancellation realtime realtimeState occupancyStatus }
        toEstimatedCall { cancellation realtime realtimeState occupancyStatus }
        situations {
          id
          situationNumber
          summary { value language }
          description { value language }
          advice { value language }
          severity
          reportType
        }
      }
    }
    routingErrors { code description inputField }
  }
}`;

type EnturJourneyCacheEntry = {
  expiresAt: number;
  promise: Promise<TravelPlanItinerary[]>;
};

type EnturJourneyFailureEntry = {
  expiresAt: number;
  message: string;
};

const enturJourneyCache = new Map<string, EnturJourneyCacheEntry>();
const enturJourneyFailures = new Map<string, EnturJourneyFailureEntry>();
const enturJourneyRequestTimestamps: number[] = [];
const enturJourneyFailureTimestamps: number[] = [];
let enturJourneyCircuitOpenUntil = 0;

export function clearEnturJourneyCache(): void {
  enturJourneyCache.clear();
  enturJourneyFailures.clear();
  enturJourneyRequestTimestamps.length = 0;
  enturJourneyFailureTimestamps.length = 0;
  enturJourneyCircuitOpenUntil = 0;
  geocodeCache.clear();
  routeCache.clear();
}

function enturJourneyCacheKey(input: {
  origin: TravelPlanPlace;
  destination: TravelPlanPlace;
  departureTime: Date;
  clientName: string;
  endpoint?: string;
}): string {
  const minuteBucket = Math.floor(input.departureTime.getTime() / 60_000);
  return JSON.stringify([
    input.endpoint ?? ENTUR_JOURNEY_PLANNER_ENDPOINT,
    input.clientName,
    input.origin.coordinate.map((value) => value.toFixed(5)),
    input.destination.coordinate.map((value) => value.toFixed(5)),
    minuteBucket,
  ]);
}

function pruneEnturJourneyCache(nowMs: number): void {
  for (const [key, entry] of enturJourneyCache.entries()) {
    if (entry.expiresAt <= nowMs) enturJourneyCache.delete(key);
  }
  for (const [key, entry] of enturJourneyFailures.entries()) {
    if (entry.expiresAt <= nowMs) enturJourneyFailures.delete(key);
  }
  while (
    enturJourneyRequestTimestamps.length &&
    (enturJourneyRequestTimestamps[0] ?? 0) <= nowMs - ENTUR_JOURNEY_RATE_WINDOW_MS
  ) {
    enturJourneyRequestTimestamps.shift();
  }
  while (
    enturJourneyFailureTimestamps.length &&
    (enturJourneyFailureTimestamps[0] ?? 0) <= nowMs - ENTUR_JOURNEY_CIRCUIT_WINDOW_MS
  ) {
    enturJourneyFailureTimestamps.shift();
  }
  while (enturJourneyCache.size > ENTUR_JOURNEY_CACHE_MAX) {
    const oldest = enturJourneyCache.keys().next().value as string | undefined;
    if (!oldest) break;
    enturJourneyCache.delete(oldest);
  }
}

function recordEnturJourneyFailure(nowMs: number): void {
  enturJourneyFailureTimestamps.push(nowMs);
  if (enturJourneyFailureTimestamps.length >= ENTUR_JOURNEY_CIRCUIT_FAILURES) {
    enturJourneyCircuitOpenUntil = Math.max(
      enturJourneyCircuitOpenUntil,
      nowMs + ENTUR_JOURNEY_CIRCUIT_OPEN_MS,
    );
  }
}

function consumeEnturJourneyRequestSlot(nowMs: number): void {
  if (enturJourneyCircuitOpenUntil > nowMs) {
    throw new EnturJourneyPlannerError(
      "Entur reisesøk er midlertidig satt på pause etter upstream-feil.",
    );
  }
  if (enturJourneyRequestTimestamps.length >= ENTUR_JOURNEY_RATE_MAX) {
    throw new EnturJourneyPlannerError("Entur reisesøk er midlertidig begrenset.");
  }
  enturJourneyRequestTimestamps.push(nowMs);
}

export async function fetchEnturJourneyItineraries(input: {
  origin: TravelPlanPlace;
  destination: TravelPlanPlace;
  departureTime: Date;
  clientName: string;
  endpoint?: string;
}): Promise<TravelPlanItinerary[]> {
  const nowMs = Date.now();
  pruneEnturJourneyCache(nowMs);
  const cacheKey = enturJourneyCacheKey(input);
  const cached = enturJourneyCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.promise;
  const cachedFailure = enturJourneyFailures.get(cacheKey);
  if (cachedFailure && cachedFailure.expiresAt > nowMs) {
    throw new EnturJourneyPlannerError(cachedFailure.message);
  }

  consumeEnturJourneyRequestSlot(nowMs);

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENTUR_JOURNEY_TIMEOUT_MS);
    try {
      const response = await fetch(input.endpoint ?? ENTUR_JOURNEY_PLANNER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ET-Client-Name": input.clientName,
        },
        body: JSON.stringify({
          query: enturTripQuery,
          variables: {
            from: {
              name: input.origin.label,
              coordinates: {
                latitude: input.origin.coordinate[1],
                longitude: input.origin.coordinate[0],
              },
            },
            to: {
              name: input.destination.label,
              coordinates: {
                latitude: input.destination.coordinate[1],
                longitude: input.destination.coordinate[0],
              },
            },
            dateTime: input.departureTime.toISOString(),
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new EnturJourneyPlannerError(`Entur svarte ${response.status}.`, {
          countsForCircuit: response.status === 429 || response.status >= 500,
        });
      }
      const payload = (await response.json()) as {
        data?: { trip?: { tripPatterns?: unknown[]; routingErrors?: unknown[] } };
        errors?: unknown;
      };
      if (payload.errors) {
        throw new EnturJourneyPlannerError("Entur returnerte ikke et gyldig reisesøk.", {
          countsForCircuit: true,
        });
      }
      return (payload.data?.trip?.tripPatterns ?? [])
        .slice(0, ENTUR_JOURNEY_MAX_PATTERNS)
        .map(itineraryFromRaw)
        .filter((itinerary): itinerary is TravelPlanItinerary => Boolean(itinerary));
    } catch (error) {
      enturJourneyCache.delete(cacheKey);
      if (
        (error instanceof EnturJourneyPlannerError && error.countsForCircuit) ||
        !(error instanceof EnturJourneyPlannerError)
      ) {
        recordEnturJourneyFailure(Date.now());
      }
      const message =
        error instanceof EnturJourneyPlannerError
          ? error.message
          : "Kunne ikke hente reiser fra Entur.";
      enturJourneyFailures.set(cacheKey, {
        expiresAt: Date.now() + ENTUR_JOURNEY_FAILURE_CACHE_MS,
        message,
      });
      if (error instanceof EnturJourneyPlannerError) throw error;
      throw new EnturJourneyPlannerError(message);
    } finally {
      clearTimeout(timeout);
    }
  })();

  enturJourneyCache.set(cacheKey, {
    expiresAt: nowMs + ENTUR_JOURNEY_CACHE_MS,
    promise,
  });
  return promise;
}

function sourceStatuses(sourceHealth: SourceHealth[]): TrafficMapSourceStatus[] {
  return sourceHealth
    .filter((source): source is SourceHealth & { source: TrafficMapSourceStatus["source"] } =>
      sourceIds.has(source.source as TrafficMapSourceStatus["source"]),
    )
    .map((source) => ({
      source: source.source,
      label: source.label,
      state: source.state,
      detail: source.detail,
      ...(source.lastCheckedAt ? { lastCheckedAt: source.lastCheckedAt } : {}),
    }));
}

export function estimateWalkingDurationSeconds(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  return Math.max(60, Math.round(distanceMeters / WALKING_SPEED_METERS_PER_SECOND / 60) * 60);
}

function walkingRouteFromTravelRoute(
  route: TravelPlanRoute,
  hasUsableTransitItinerary: boolean,
): TravelPlanPayload["walkingRoute"] {
  if (hasUsableTransitItinerary) return undefined;
  if (!Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0) return undefined;
  if (route.geometry.type !== "LineString" || route.geometry.coordinates.length < 2) {
    return undefined;
  }
  const confidence = route.source === "osrm" ? "route" : "corridor";
  return {
    source: route.source,
    geometry: route.geometry,
    distanceMeters: route.distanceMeters,
    durationSeconds: estimateWalkingDurationSeconds(route.distanceMeters),
    detail:
      confidence === "route"
        ? "Gangtid estimert fra rutelengde. Ruten vises som OSRM-korridor."
        : "Gangtid estimert fra luftlinjekorridor fordi rutetjenesten ikke ga detaljert gangrute.",
    confidence,
  };
}

function isUsableTransitItinerary(itinerary: TravelPlanItinerary): boolean {
  return itinerary.decision !== "avoid" && itinerary.modes.some((mode) => mode !== "walk");
}

function firstTransitLeg(itinerary: TravelPlanItinerary): TravelPlanLeg | undefined {
  return itinerary.legs.find((leg) => leg.mode !== "walk" && !leg.cancelled);
}

function transitModeLabel(mode: TravelPlanLegMode): string {
  switch (mode) {
    case "bus":
      return "Buss";
    case "tram":
      return "Trikk";
    case "rail":
      return "Tog";
    case "water":
      return "Båt";
    case "metro":
      return "T-bane";
    default:
      return "Kollektiv";
  }
}

function nextTransitOptionFromItinerary(
  itinerary?: TravelPlanItinerary,
): TravelPlanNextTransitOption | undefined {
  if (!itinerary || !isUsableTransitItinerary(itinerary)) return undefined;
  const leg = firstTransitLeg(itinerary);
  if (!leg) return undefined;
  return {
    departureTime: itinerary.departureTime,
    arrivalTime: itinerary.arrivalTime,
    lineLabel: leg.publicCode
      ? `${transitModeLabel(leg.mode)} ${leg.publicCode}`
      : transitModeLabel(leg.mode),
    boardingStopName: leg.from.stopName ?? leg.from.name,
    durationSeconds: itinerary.durationSeconds,
    transferCount: itinerary.transferCount,
    handoffUrl: itinerary.handoffUrl,
  };
}

const comparisonPresetOrder: TravelPlanComparisonPreset[] = ["now", "in30", "in60", "in120"];

export function withNextTransitOptionFromComparisonSources(
  selectedPlan: TravelPlanPayload,
  sources: TravelPlanComparisonSource[],
  activePreset: TravelPlanComparisonPreset,
): TravelPlanPayload {
  if (selectedPlan.primaryMode === "transit" || selectedPlan.nextTransitOption) {
    return selectedPlan;
  }
  const activeIndex = comparisonPresetOrder.indexOf(activePreset);
  const candidateSources = sources.filter((source) => {
    if (!source.plan) return false;
    if (source.preset === activePreset) return false;
    const presetIndex = comparisonPresetOrder.indexOf(source.preset);
    return presetIndex > activeIndex;
  });
  const nextTransitOption = candidateSources
    .map((source) =>
      nextTransitOptionFromItinerary(source.plan?.itineraries.find(isUsableTransitItinerary)),
    )
    .find((option) => option !== undefined);
  return nextTransitOption ? { ...selectedPlan, nextTransitOption } : selectedPlan;
}

function primaryModeForTravelPlan(
  itineraries: TravelPlanItinerary[],
  walkingRoute: TravelPlanPayload["walkingRoute"],
): TravelPlanPayload["primaryMode"] {
  if (itineraries.some(isUsableTransitItinerary)) return "transit";
  if (walkingRoute) return "walk";
  return "fallback";
}

export function buildTravelPlanPayload(input: {
  origin: TravelPlanPlace;
  destination: TravelPlanPlace;
  route: TravelPlanRoute;
  events: TrafficMapEvent[];
  vehicles: PublicTransportVehicle[];
  alerts: PublicTransportServiceAlert[];
  sourceHealth: SourceHealth[];
  itineraries?: TravelPlanItinerary[];
  journeyPlanner?: {
    status: TravelPlanPayload["journeyPlanner"]["status"];
    detail: string;
    requestedDepartureTime: string;
  };
  generatedAt?: Date;
}): TravelPlanPayload {
  const generatedAt = input.generatedAt ?? new Date();
  const requestedDepartureTime =
    input.journeyPlanner?.requestedDepartureTime ?? generatedAt.toISOString();
  const contextWindow = travelPlanContextWindow(input.route, requestedDepartureTime, generatedAt);
  const contextEvents = input.events.filter((event) =>
    trafficEventIntersectsTravelPlanWindow(event, contextWindow),
  );
  const contextAlerts = input.alerts.filter((alert) =>
    serviceAlertIntersectsTravelPlanWindow(alert, contextWindow),
  );
  const trafficImpactsForRoute = trafficImpacts(contextEvents, input.route);
  const itineraries = rankItineraries(
    enrichItineraries(
      input.itineraries ?? [],
      trafficImpactsForRoute,
      input.vehicles,
      contextAlerts,
    ),
  );
  const hasUsableTransitItinerary = itineraries.some(isUsableTransitItinerary);
  const walkingRoute = walkingRouteFromTravelRoute(input.route, hasUsableTransitItinerary);
  const primaryMode = primaryModeForTravelPlan(itineraries, walkingRoute);
  return {
    origin: input.origin,
    destination: input.destination,
    route: input.route,
    primaryMode,
    ...(walkingRoute ? { walkingRoute } : {}),
    trafficImpacts: trafficImpactsForRoute,
    publicTransportSuggestions: transitSuggestions(input.vehicles, contextAlerts, input.route),
    itineraries,
    journeyPlanner: {
      status:
        input.journeyPlanner?.status ??
        (input.itineraries === undefined ? "unavailable" : itineraries.length ? "ok" : "empty"),
      detail:
        input.journeyPlanner?.detail ??
        (itineraries.length
          ? "Entur Journey Planner returnerte konkrete reiseforslag."
          : "Ingen konkrete Entur-reiser funnet for valgt tidspunkt."),
      requestedDepartureTime,
      source: "Entur Journey Planner",
    },
    sources: sourceStatuses(input.sourceHealth),
    generatedAt: generatedAt.toISOString(),
  };
}

export async function resolveTravelPlanPlacesAndRoute(
  from: string,
  to: string,
): Promise<{
  origin: TravelPlanPlace;
  destination: TravelPlanPlace;
  route: TravelPlanRoute;
}> {
  const [origin, destination] = await Promise.all([
    geocodeTravelPlanPlace(from),
    geocodeTravelPlanPlace(to),
  ]);
  const route = await resolveTravelPlanRoute(origin, destination);
  return { origin, destination, route };
}

export function resolveTravelPlanDepartureTime(value: string | undefined, now = new Date()): Date {
  if (!value) return now;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TravelPlanRequestError("Ugyldig avreisetid.");
  }
  const earliest = now.getTime() - 5 * 60 * 1000;
  const latest = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < earliest || parsed.getTime() > latest) {
    throw new TravelPlanRequestError("Avreisetid må være innen de neste sju dagene.");
  }
  return parsed;
}
