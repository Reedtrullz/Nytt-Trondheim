import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  TrafficEventSeverity,
  TrafficMapEvent,
  TrafficMapSourceStatus,
  TravelPlanPayload,
  TravelPlanPlace,
  TravelPlanRoute,
  TravelPlanTrafficImpact,
  TravelPlanTransitSuggestion,
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
const ROUTE_PADDING_METERS = 2_500;
const ROUTE_TRAFFIC_BUFFER_METERS = 1_500;
const ROUTE_TRANSIT_BUFFER_METERS = 1_200;
const TRONDHEIM_SERVICE_BOUNDS = {
  north: 63.62,
  south: 63.25,
  east: 10.85,
  west: 10.05,
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

class TravelPlanRequestError extends Error {
  status = 400;
}

class TravelPlanDependencyError extends Error {
  status = 503;
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
    coordinateInBounds(coordinate, TRONDHEIM_SERVICE_BOUNDS),
  );
  if (inServiceArea.length === 1) return inServiceArea[0];
  if (candidates.length > 0) {
    throw new TravelPlanRequestError("Koordinater må være i Trondheim-området.");
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

export async function geocodeTravelPlanPlace(query: string): Promise<TravelPlanPlace> {
  const coordinate = parseCoordinateInput(query);
  if (coordinate) {
    return { query, label: query.trim(), coordinate };
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", "nb");
  url.searchParams.set("countrycodes", "no");
  url.searchParams.set("viewbox", "10.05,63.62,10.85,63.25");
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
    throw new TravelPlanRequestError(`Fant ikke "${query}" i Trondheim-området.`);
  }
  return {
    query,
    label: typeof first.display_name === "string" ? first.display_name : query.trim(),
    coordinate: resolved,
  };
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

export async function resolveTravelPlanRoute(
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

export function buildTravelPlanPayload(input: {
  origin: TravelPlanPlace;
  destination: TravelPlanPlace;
  route: TravelPlanRoute;
  events: TrafficMapEvent[];
  vehicles: PublicTransportVehicle[];
  alerts: PublicTransportServiceAlert[];
  sourceHealth: SourceHealth[];
  generatedAt?: Date;
}): TravelPlanPayload {
  return {
    origin: input.origin,
    destination: input.destination,
    route: input.route,
    trafficImpacts: trafficImpacts(input.events, input.route),
    publicTransportSuggestions: transitSuggestions(input.vehicles, input.alerts, input.route),
    sources: sourceStatuses(input.sourceHealth),
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
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
