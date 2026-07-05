import type {
  PublicTransportDeparture,
  PublicTransportDepartureBoardPayload,
  PublicTransportDepartureNotice,
  PublicTransportDepartureStop,
  PublicTransportVehicleMode,
  SourceHealth,
} from "@nytt/shared";

const ENTUR_JOURNEY_PLANNER_ENDPOINT = "https://api.entur.io/journey-planner/v3/graphql";
const ENTUR_DEPARTURE_TIMEOUT_MS = 3_500;
const ENTUR_DEPARTURE_CACHE_MS = 25_000;
const ENTUR_DEPARTURE_FAILURE_CACHE_MS = 10_000;
const ENTUR_DEPARTURE_CACHE_MAX = 80;
const ENTUR_DEPARTURE_RATE_WINDOW_MS = 60_000;
const ENTUR_DEPARTURE_RATE_MAX = 120;
const DEFAULT_DEPARTURE_LIMIT = 12;
const DEFAULT_STOP_LIMIT = 4;
const DEFAULT_RADIUS_METERS = 1_200;
const DEFAULT_CENTER = { lat: 63.4305, lon: 10.3951 };
const DEFAULT_AREA_LABEL = "Trondheim sentrum";
const ATB_HANDOFF_URL = "https://www.atb.no/reiseplanlegger/";

type TimedPromiseCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

type TimedFailureEntry = {
  expiresAt: number;
  message: string;
};

export class EnturDepartureBoardError extends Error {}

const departureBoardCache = new Map<
  string,
  TimedPromiseCacheEntry<PublicTransportDepartureBoardPayload>
>();
const departureBoardFailures = new Map<string, TimedFailureEntry>();
const departureBoardRequestTimestamps: number[] = [];

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function finite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function iso(value: unknown): string | undefined {
  const input = text(value);
  if (!input) return undefined;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function localizedText(value: unknown): string | undefined {
  const entries = Array.isArray(value)
    ? value.map(object).filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  if (entries.length) {
    const norwegian = entries.find((entry) =>
      /^(no|nb|nn)$/i.test(text(entry.language) ?? text(entry.lang) ?? ""),
    );
    const firstEntry = entries[0];
    return (
      text(norwegian?.value) ??
      text(entries.find((entry) => text(entry.language) === undefined)?.value) ??
      text(firstEntry?.value)
    );
  }
  return text(value);
}

function modeFromEntur(value: unknown): PublicTransportVehicleMode {
  switch (String(value ?? "").toLocaleLowerCase("nb")) {
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

function departureNoticeFromSituation(value: unknown): PublicTransportDepartureNotice | undefined {
  const situation = object(value);
  const id = text(situation?.id) ?? text(situation?.situationNumber);
  const title = localizedText(situation?.summary);
  if (!id || !title) return undefined;
  const severityText = text(situation?.severity)?.toLocaleLowerCase("nb");
  const severity =
    severityText === "severe" || severityText === "verysevere" || severityText === "critical"
      ? "warning"
      : "info";
  return {
    id: `entur-situation:${id}`,
    title,
    detail: localizedText(situation?.advice) ?? localizedText(situation?.description),
    severity,
  };
}

function delaySeconds(aimedDepartureTime: string, expectedDepartureTime: string): number {
  const aimed = Date.parse(aimedDepartureTime);
  const expected = Date.parse(expectedDepartureTime);
  if (!Number.isFinite(aimed) || !Number.isFinite(expected)) return 0;
  return Math.round((expected - aimed) / 1000);
}

function departureFromRaw(
  rawCall: unknown,
  stop: Pick<PublicTransportDepartureStop, "id" | "name" | "distanceMeters">,
  index: number,
): PublicTransportDeparture | undefined {
  const call = object(rawCall);
  if (!call) return undefined;
  const aimedDepartureTime = iso(call.aimedDepartureTime);
  const expectedDepartureTime = iso(call.expectedDepartureTime) ?? aimedDepartureTime;
  if (!aimedDepartureTime || !expectedDepartureTime) return undefined;
  const destinationName = text(object(call.destinationDisplay)?.frontText);
  if (!destinationName) return undefined;
  const quay = object(call.quay);
  const serviceJourney = object(call.serviceJourney);
  const line = object(object(serviceJourney?.journeyPattern)?.line);
  const lineId = text(line?.id);
  const publicCode = text(line?.publicCode);
  const lineName = text(line?.name);
  const notices = (Array.isArray(call.situations) ? call.situations : [])
    .map(departureNoticeFromSituation)
    .filter((notice): notice is PublicTransportDepartureNotice => Boolean(notice));
  const cancelled = Boolean(call.cancellation);
  if (cancelled) {
    notices.push({
      id: `entur-cancellation:${text(serviceJourney?.id) ?? stop.id}:${index}`,
      title: "Avgangen er innstilt",
      severity: "warning",
    });
  }
  const id = [
    stop.id,
    text(serviceJourney?.id) ?? lineId ?? publicCode ?? "avgang",
    expectedDepartureTime,
    text(quay?.id) ?? index,
  ].join(":");
  return {
    id,
    stopId: stop.id,
    stopName: stop.name,
    ...(stop.distanceMeters !== undefined ? { stopDistanceMeters: stop.distanceMeters } : {}),
    ...(text(quay?.id) ? { quayId: text(quay?.id) } : {}),
    ...(text(quay?.name) ? { quayName: text(quay?.name) } : {}),
    ...(text(quay?.publicCode) ? { quayPublicCode: text(quay?.publicCode) } : {}),
    mode: modeFromEntur(line?.transportMode),
    ...(lineId ? { lineId } : {}),
    ...(publicCode ? { publicCode } : {}),
    ...(lineName ? { lineName } : {}),
    destinationName,
    aimedDepartureTime,
    expectedDepartureTime,
    delaySeconds: delaySeconds(aimedDepartureTime, expectedDepartureTime),
    realtime: Boolean(call.realtime),
    cancelled,
    notices,
    handoffUrl: ATB_HANDOFF_URL,
  };
}

function stopFromRaw(
  rawNode: unknown,
  stopIndex: number,
): PublicTransportDepartureStop | undefined {
  const node = object(rawNode);
  if (!node) return undefined;
  const place = object(node?.place);
  if (!place || text(place.__typename) !== "StopPlace") return undefined;
  const id = text(place.id);
  const name = text(place.name);
  const lat = finite(place.latitude);
  const lon = finite(place.longitude);
  if (!id || !name || lat === undefined || lon === undefined) return undefined;
  const distance = finite(node.distance);
  const distanceMeters = distance !== undefined ? Math.round(distance) : undefined;
  const rawModes = Array.isArray(place.transportMode) ? place.transportMode : [];
  const modes = [...new Set(rawModes.map(modeFromEntur).filter((mode) => mode !== "unknown"))];
  const stop: PublicTransportDepartureStop = {
    id,
    name,
    coordinate: [lon, lat],
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    modes: modes.length ? modes : ["unknown"],
    departures: [],
  };
  const departures = (Array.isArray(place.estimatedCalls) ? place.estimatedCalls : [])
    .map((call, departureIndex) => departureFromRaw(call, stop, stopIndex * 100 + departureIndex))
    .filter((departure): departure is PublicTransportDeparture => Boolean(departure));
  return { ...stop, departures };
}

export function publicTransportDepartureBoardFromEntur(input: {
  payload: unknown;
  center?: { lat: number; lon: number };
  areaLabel?: string;
  generatedAt?: Date;
  sources?: SourceHealth[];
  departureLimit?: number;
}): PublicTransportDepartureBoardPayload {
  const generatedAt = input.generatedAt ?? new Date();
  const center = input.center ?? DEFAULT_CENTER;
  const nearest = object(object(object(input.payload)?.data)?.nearest);
  const edges: unknown[] = Array.isArray(nearest?.edges) ? nearest.edges : [];
  const stops = edges
    .map((edge, index) => stopFromRaw(object(edge)?.node, index))
    .filter((stop): stop is PublicTransportDepartureStop => Boolean(stop));
  const departureLimit = input.departureLimit ?? DEFAULT_DEPARTURE_LIMIT;
  const departures = stops
    .flatMap((stop) => stop.departures)
    .sort(
      (left, right) =>
        Date.parse(left.expectedDepartureTime) - Date.parse(right.expectedDepartureTime) ||
        (left.stopDistanceMeters ?? Number.MAX_SAFE_INTEGER) -
          (right.stopDistanceMeters ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, departureLimit);
  const departureIds = new Set(departures.map((departure) => departure.id));
  const stopsWithDisplayedDepartures = stops
    .map((stop) => ({
      ...stop,
      departures: stop.departures.filter((departure) => departureIds.has(departure.id)),
    }))
    .filter((stop) => stop.departures.length > 0);
  return {
    status: departures.length ? "ok" : "empty",
    detail: departures.length
      ? "Entur viser konkrete avganger nær valgt område."
      : "Ingen avganger funnet nær valgt område akkurat nå.",
    areaLabel: input.areaLabel ?? DEFAULT_AREA_LABEL,
    center,
    stops: stopsWithDisplayedDepartures,
    departures,
    sources: input.sources ?? [],
    generatedAt: generatedAt.toISOString(),
    handoffUrl: ATB_HANDOFF_URL,
  };
}

export function unavailableDepartureBoard(input: {
  center?: { lat: number; lon: number };
  areaLabel?: string;
  generatedAt?: Date;
  sources?: SourceHealth[];
  detail?: string;
}): PublicTransportDepartureBoardPayload {
  const generatedAt = input.generatedAt ?? new Date();
  return {
    status: "unavailable",
    detail:
      input.detail ??
      "Entur avgangstavle er ikke tilgjengelig akkurat nå. Trafikkbildet vises fortsatt.",
    areaLabel: input.areaLabel ?? DEFAULT_AREA_LABEL,
    center: input.center ?? DEFAULT_CENTER,
    stops: [],
    departures: [],
    sources: input.sources ?? [],
    generatedAt: generatedAt.toISOString(),
    handoffUrl: ATB_HANDOFF_URL,
  };
}

const departureBoardQuery = `query NyttDepartureBoard(
  $lat: Float!
  $lon: Float!
  $radiusMeters: Float!
  $stopLimit: Int!
  $departureLimit: Int!
  $startTime: DateTime!
) {
  nearest(
    latitude: $lat
    longitude: $lon
    maximumDistance: $radiusMeters
    maximumResults: $stopLimit
    filterByPlaceTypes: [stopPlace]
  ) {
    edges {
      node {
        distance
        place {
          __typename
          ... on StopPlace {
            id
            name
            latitude
            longitude
            transportMode
            estimatedCalls(
              startTime: $startTime
              timeRange: 7200
              numberOfDepartures: $departureLimit
              includeCancelledTrips: true
            ) {
              realtime
              aimedDepartureTime
              expectedDepartureTime
              cancellation
              destinationDisplay { frontText }
              quay { id name publicCode }
              serviceJourney {
                id
                journeyPattern {
                  line { id name publicCode transportMode }
                }
              }
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
        }
      }
    }
  }
}`;

function pruneDepartureBoardState(nowMs: number): void {
  for (const [key, entry] of departureBoardCache.entries()) {
    if (entry.expiresAt <= nowMs) departureBoardCache.delete(key);
  }
  for (const [key, entry] of departureBoardFailures.entries()) {
    if (entry.expiresAt <= nowMs) departureBoardFailures.delete(key);
  }
  while (
    departureBoardRequestTimestamps.length &&
    (departureBoardRequestTimestamps[0] ?? 0) <= nowMs - ENTUR_DEPARTURE_RATE_WINDOW_MS
  ) {
    departureBoardRequestTimestamps.shift();
  }
  while (departureBoardCache.size > ENTUR_DEPARTURE_CACHE_MAX) {
    const oldest = departureBoardCache.keys().next().value as string | undefined;
    if (!oldest) break;
    departureBoardCache.delete(oldest);
  }
}

function consumeDepartureBoardSlot(nowMs: number): void {
  if (departureBoardRequestTimestamps.length >= ENTUR_DEPARTURE_RATE_MAX) {
    throw new EnturDepartureBoardError("Entur avgangstavle er midlertidig begrenset.");
  }
  departureBoardRequestTimestamps.push(nowMs);
}

function departureBoardCacheKey(input: {
  center: { lat: number; lon: number };
  radiusMeters: number;
  stopLimit: number;
  departureLimit: number;
  clientName: string;
  endpoint?: string;
  startTime: Date;
}): string {
  const halfMinuteBucket = Math.floor(input.startTime.getTime() / 30_000);
  return JSON.stringify([
    input.endpoint ?? ENTUR_JOURNEY_PLANNER_ENDPOINT,
    input.clientName,
    input.center.lat.toFixed(5),
    input.center.lon.toFixed(5),
    input.radiusMeters,
    input.stopLimit,
    input.departureLimit,
    halfMinuteBucket,
  ]);
}

export function clearEnturDepartureBoardCache(): void {
  departureBoardCache.clear();
  departureBoardFailures.clear();
  departureBoardRequestTimestamps.length = 0;
}

export async function fetchEnturDepartureBoard(input: {
  clientName: string;
  endpoint?: string;
  center?: { lat: number; lon: number };
  areaLabel?: string;
  radiusMeters?: number;
  stopLimit?: number;
  departureLimit?: number;
  startTime?: Date;
  sources?: SourceHealth[];
}): Promise<PublicTransportDepartureBoardPayload> {
  const center = input.center ?? DEFAULT_CENTER;
  const startTime = input.startTime ?? new Date();
  const radiusMeters = input.radiusMeters ?? DEFAULT_RADIUS_METERS;
  const stopLimit = input.stopLimit ?? DEFAULT_STOP_LIMIT;
  const departureLimit = input.departureLimit ?? DEFAULT_DEPARTURE_LIMIT;
  const nowMs = Date.now();
  pruneDepartureBoardState(nowMs);
  const cacheKey = departureBoardCacheKey({
    center,
    radiusMeters,
    stopLimit,
    departureLimit,
    clientName: input.clientName,
    endpoint: input.endpoint,
    startTime,
  });
  const cached = departureBoardCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.promise;
  const cachedFailure = departureBoardFailures.get(cacheKey);
  if (cachedFailure && cachedFailure.expiresAt > nowMs) {
    throw new EnturDepartureBoardError(cachedFailure.message);
  }

  consumeDepartureBoardSlot(nowMs);

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENTUR_DEPARTURE_TIMEOUT_MS);
    try {
      const response = await fetch(input.endpoint ?? ENTUR_JOURNEY_PLANNER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ET-Client-Name": input.clientName,
        },
        body: JSON.stringify({
          query: departureBoardQuery,
          variables: {
            lat: center.lat,
            lon: center.lon,
            radiusMeters,
            stopLimit,
            departureLimit,
            startTime: startTime.toISOString(),
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new EnturDepartureBoardError(`Entur svarte ${response.status}.`);
      }
      const payload = (await response.json()) as { data?: unknown; errors?: unknown };
      if (payload.errors) {
        throw new EnturDepartureBoardError("Entur returnerte ikke en gyldig avgangstavle.");
      }
      return publicTransportDepartureBoardFromEntur({
        payload,
        center,
        areaLabel: input.areaLabel,
        generatedAt: new Date(nowMs),
        sources: input.sources,
        departureLimit,
      });
    } catch (error) {
      departureBoardCache.delete(cacheKey);
      const message =
        error instanceof EnturDepartureBoardError
          ? error.message
          : "Kunne ikke hente avganger fra Entur.";
      departureBoardFailures.set(cacheKey, {
        expiresAt: Date.now() + ENTUR_DEPARTURE_FAILURE_CACHE_MS,
        message,
      });
      throw new EnturDepartureBoardError(message);
    } finally {
      clearTimeout(timeout);
    }
  })();

  departureBoardCache.set(cacheKey, {
    expiresAt: nowMs + ENTUR_DEPARTURE_CACHE_MS,
    promise,
  });
  return promise;
}
