import type { PublicTransportVehicle, PublicTransportVehicleMode } from "@nytt/shared";
import { fetchWithSourcePolicy } from "./fetchPolicy.js";

export const enturVehiclesEndpoint = "https://api.entur.io/realtime/v2/vehicles/graphql";

export interface EnturVehicleBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function enturHeaders(clientName: string): Record<string, string> {
  return { "Content-Type": "application/json", "ET-Client-Name": clientName };
}

function modeFromEntur(value: unknown): PublicTransportVehicleMode {
  switch (String(value ?? "").toUpperCase()) {
    case "BUS":
      return "bus";
    case "TRAM":
      return "tram";
    case "RAIL":
      return "rail";
    case "WATER":
      return "water";
    case "METRO":
      return "metro";
    default:
      return "unknown";
  }
}

function iso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validLatLon(
  location: Record<string, unknown> | undefined,
): { lat: number; lon: number } | undefined {
  const lat = finite(location?.latitude);
  const lon = finite(location?.longitude);
  if (lat === undefined || lon === undefined) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return { lat, lon };
}

export function parseEnturVehicles(
  payload: string,
  options: { codespaceId: string },
): { vehicles: PublicTransportVehicle[]; activeVehicleIds: string[] } {
  const parsed = JSON.parse(payload) as {
    data?: { vehicles?: Array<Record<string, unknown>> };
    errors?: unknown;
  };
  if (parsed.errors) {
    throw new Error(`Entur vehicle GraphQL returned errors: ${JSON.stringify(parsed.errors)}`);
  }

  const vehicles: PublicTransportVehicle[] = [];
  for (const item of parsed.data?.vehicles ?? []) {
    const vehicleId = typeof item.vehicleId === "string" ? item.vehicleId.trim() : "";
    const coordinates = validLatLon(object(item.location));
    if (!vehicleId || !coordinates) continue;

    const line = object(item.line);
    const operator = object(item.operator);
    const monitoredCall = object(item.monitoredCall);
    const progress = object(item.progressBetweenStops);
    const lastUpdated = iso(item.lastUpdated) ?? new Date(0).toISOString();

    vehicles.push({
      id: `entur-vehicle:${options.codespaceId}:${vehicleId}`,
      source: "entur_vehicle_positions",
      codespaceId: options.codespaceId,
      vehicleId,
      mode: modeFromEntur(item.mode),
      lineRef: typeof line?.lineRef === "string" ? line.lineRef : undefined,
      publicCode: typeof line?.publicCode === "string" ? line.publicCode : undefined,
      lineName: typeof line?.lineName === "string" ? line.lineName : undefined,
      operatorRef: typeof operator?.operatorRef === "string" ? operator.operatorRef : undefined,
      operatorName: typeof operator?.name === "string" ? operator.name : undefined,
      originName: typeof item.originName === "string" ? item.originName : undefined,
      destinationName: typeof item.destinationName === "string" ? item.destinationName : undefined,
      lastUpdated,
      expiresAt: iso(item.expiration),
      geometry: { type: "Point", coordinates: [coordinates.lon, coordinates.lat] },
      speedMps: finite(item.speed),
      bearing: finite(item.bearing),
      delaySeconds: finite(item.delay),
      inCongestion: typeof item.inCongestion === "boolean" ? item.inCongestion : undefined,
      occupancyStatus: typeof item.occupancyStatus === "string" ? item.occupancyStatus : undefined,
      vehicleStatus: typeof item.vehicleStatus === "string" ? item.vehicleStatus : undefined,
      monitored: typeof item.monitored === "boolean" ? item.monitored : undefined,
      currentStopPointRef:
        typeof monitoredCall?.stopPointRef === "string" ? monitoredCall.stopPointRef : undefined,
      currentStopOrder: finite(monitoredCall?.order),
      vehicleAtStop:
        typeof monitoredCall?.vehicleAtStop === "boolean" ? monitoredCall.vehicleAtStop : undefined,
      progressPercent: finite(progress?.percentage),
      stale: false,
    });
  }

  return { vehicles, activeVehicleIds: vehicles.map((vehicle) => vehicle.vehicleId) };
}

export async function fetchEnturVehicles({
  endpoint = enturVehiclesEndpoint,
  clientName,
  codespaceId,
  bounds,
  fetcher = fetch,
}: {
  endpoint?: string;
  clientName: string;
  codespaceId: string;
  bounds: EnturVehicleBounds;
  fetcher?: typeof fetch;
}): Promise<ReturnType<typeof parseEnturVehicles>> {
  const query = `query EnturVehicles($codespaceId: String!, $bounds: BoundingBox) {
    vehicles(codespaceId: $codespaceId, boundingBox: $bounds) {
      vehicleId mode originName destinationName lastUpdated expiration speed bearing delay inCongestion occupancyStatus vehicleStatus monitored
      location { latitude longitude }
      line { lineRef publicCode lineName }
      operator { operatorRef name }
      monitoredCall { stopPointRef order vehicleAtStop }
      progressBetweenStops { percentage }
    }
  }`;
  const response = await fetchWithSourcePolicy(fetcher, endpoint, {
    method: "POST",
    headers: enturHeaders(clientName),
    body: JSON.stringify({ query, variables: { codespaceId, bounds } }),
  });
  if (!response.ok) throw new Error(`Entur vehicle fetch failed ${response.status}`);
  return parseEnturVehicles(await response.text(), { codespaceId });
}
