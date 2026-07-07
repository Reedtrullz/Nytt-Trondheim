import type { TravelPlaceSuggestion, TravelPlaceSuggestionPayload } from "@nytt/shared";
import type { Bounds, Coordinate } from "./geo.js";
import { runtimeHealth } from "../runtime-health.js";

const ENTUR_GEOCODER_ENDPOINT = "https://api.entur.io/geocoder/v3/autocomplete";
const ENTUR_GEOCODER_TIMEOUT_MS = 2_500;
const ENTUR_GEOCODER_CACHE_MS = 5 * 60_000;
const ENTUR_GEOCODER_FAILURE_CACHE_MS = 15_000;
const ENTUR_GEOCODER_CACHE_MAX = 120;
const ENTUR_GEOCODER_RATE_WINDOW_MS = 60_000;
const ENTUR_GEOCODER_RATE_MAX = 120;
const TRONDELAG_TRAVEL_BOUNDS = {
  north: 64.7,
  south: 62.2,
  east: 12.4,
  west: 8.0,
} satisfies Bounds;

type TimedPromiseCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

type TimedFailureEntry = {
  expiresAt: number;
  message: string;
};

export class EnturTravelSuggestionError extends Error {}

const suggestionCache = new Map<string, TimedPromiseCacheEntry<TravelPlaceSuggestionPayload>>();
const suggestionFailures = new Map<string, TimedFailureEntry>();
const suggestionRequestTimestamps: number[] = [];

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function coordinateFromFeature(feature: Record<string, unknown>): Coordinate | undefined {
  const coordinates = object(feature.geometry)?.coordinates;
  if (!Array.isArray(coordinates)) return undefined;
  const [lon, lat] = coordinates;
  if (typeof lon !== "number" || typeof lat !== "number") return undefined;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return [lon, lat];
}

function coordinateInBounds(coordinate: Coordinate, bounds: Bounds): boolean {
  const [lon, lat] = coordinate;
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

function suggestionKind(properties: Record<string, unknown>): TravelPlaceSuggestion["kind"] {
  const layer = text(properties.layer)?.toLocaleLowerCase("nb");
  const id = text(properties.id) ?? "";
  if (layer === "stopplace" || id.startsWith("NSR:StopPlace")) return "stop";
  if (layer === "groupofstopplaces" || id.startsWith("NSR:GroupOfStopPlaces")) {
    return "stop_group";
  }
  if (layer === "address") return "address";
  if (layer === "street") return "street";
  if (layer === "poi") return "poi";
  if (layer === "place") return "place";
  return "unknown";
}

function suggestionSortScore(suggestion: TravelPlaceSuggestion, query: string): number {
  const normalizedQuery = query.toLocaleLowerCase("nb");
  const normalizedLabel = suggestion.label.toLocaleLowerCase("nb");
  let score = 0;
  if (normalizedLabel.startsWith(normalizedQuery)) score += 20;
  if (suggestion.locality?.toLocaleLowerCase("nb") === "trondheim") score += 10;
  if (suggestion.kind === "stop") score += 6;
  if (suggestion.kind === "address") score += 4;
  if (suggestion.kind === "poi" || suggestion.kind === "stop_group") score += 2;
  return score;
}

function suggestionFromFeature(
  feature: Record<string, unknown>,
): TravelPlaceSuggestion | undefined {
  const properties = object(feature.properties);
  const coordinate = coordinateFromFeature(feature);
  if (!properties || !coordinate || !coordinateInBounds(coordinate, TRONDELAG_TRAVEL_BOUNDS)) {
    return undefined;
  }
  const names = object(properties.names);
  const address = object(properties.address);
  const label =
    text(names?.display) ??
    [text(names?.default), text(address?.locality)].filter(Boolean).join(", ");
  const id = text(properties.id) ?? label;
  if (!label || !id) return undefined;
  return {
    id,
    label,
    query: label,
    kind: suggestionKind(properties),
    coordinate,
    ...(text(address?.locality) ? { locality: text(address?.locality) } : {}),
    source: "Entur Geocoder",
  };
}

export function travelPlaceSuggestionsFromEntur(input: {
  payload: unknown;
  query: string;
  limit: number;
  generatedAt?: Date;
}): TravelPlaceSuggestionPayload {
  const generatedAt = input.generatedAt ?? new Date();
  const features = Array.isArray(object(input.payload)?.features)
    ? (object(input.payload)?.features as unknown[])
        .map(object)
        .filter((feature): feature is Record<string, unknown> => Boolean(feature))
    : [];
  const seen = new Set<string>();
  const suggestions = features
    .map((feature) => suggestionFromFeature(feature))
    .filter((suggestion): suggestion is TravelPlaceSuggestion => Boolean(suggestion))
    .filter((suggestion) => {
      const key = `${suggestion.id}:${suggestion.coordinate.join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        suggestionSortScore(right, input.query) - suggestionSortScore(left, input.query),
    )
    .slice(0, input.limit);

  return {
    query: input.query,
    status: suggestions.length ? "ok" : "empty",
    detail: suggestions.length
      ? "Entur foreslår stopp og steder i Trøndelag."
      : "Ingen Entur-steder funnet i Trøndelag for søket.",
    suggestions,
    generatedAt: generatedAt.toISOString(),
  };
}

export function unavailableTravelPlaceSuggestions(input: {
  query: string;
  generatedAt?: Date;
  detail?: string;
}): TravelPlaceSuggestionPayload {
  const generatedAt = input.generatedAt ?? new Date();
  return {
    query: input.query,
    status: "unavailable",
    detail:
      input.detail ??
      "Entur stedsøk er ikke tilgjengelig akkurat nå. Skriv inn adresse, stopp eller koordinater.",
    suggestions: [],
    generatedAt: generatedAt.toISOString(),
  };
}

function pruneSuggestionState(nowMs: number): void {
  for (const [key, entry] of suggestionCache.entries()) {
    if (entry.expiresAt <= nowMs) suggestionCache.delete(key);
  }
  for (const [key, entry] of suggestionFailures.entries()) {
    if (entry.expiresAt <= nowMs) suggestionFailures.delete(key);
  }
  while (
    suggestionRequestTimestamps.length &&
    (suggestionRequestTimestamps[0] ?? 0) <= nowMs - ENTUR_GEOCODER_RATE_WINDOW_MS
  ) {
    suggestionRequestTimestamps.shift();
  }
  while (suggestionCache.size > ENTUR_GEOCODER_CACHE_MAX) {
    const oldest = suggestionCache.keys().next().value as string | undefined;
    if (!oldest) break;
    suggestionCache.delete(oldest);
  }
}

function consumeSuggestionSlot(nowMs: number): void {
  if (suggestionRequestTimestamps.length >= ENTUR_GEOCODER_RATE_MAX) {
    runtimeHealth.recordDependency(
      "entur_geocoder",
      "rate_limited",
      "Entur stedsøk er midlertidig begrenset av lokal budsjettvakt.",
      { retryAfterSeconds: 30 },
    );
    throw new EnturTravelSuggestionError("Entur stedsøk er midlertidig begrenset.");
  }
  suggestionRequestTimestamps.push(nowMs);
}

function suggestionCacheKey(input: {
  query: string;
  limit: number;
  clientName: string;
  endpoint?: string;
}): string {
  return JSON.stringify([
    input.endpoint ?? ENTUR_GEOCODER_ENDPOINT,
    input.clientName,
    input.query.toLocaleLowerCase("nb"),
    input.limit,
  ]);
}

export function clearEnturTravelSuggestionCache(): void {
  suggestionCache.clear();
  suggestionFailures.clear();
  suggestionRequestTimestamps.length = 0;
}

export async function fetchEnturTravelPlaceSuggestions(input: {
  query: string;
  limit: number;
  clientName: string;
  endpoint?: string;
}): Promise<TravelPlaceSuggestionPayload> {
  const nowMs = Date.now();
  pruneSuggestionState(nowMs);
  const normalizedQuery = input.query.trim();
  const cacheKey = suggestionCacheKey({ ...input, query: normalizedQuery });
  const cached = suggestionCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.promise;
  const cachedFailure = suggestionFailures.get(cacheKey);
  if (cachedFailure && cachedFailure.expiresAt > nowMs) {
    throw new EnturTravelSuggestionError(cachedFailure.message);
  }

  consumeSuggestionSlot(nowMs);

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENTUR_GEOCODER_TIMEOUT_MS);
    const startedAt = Date.now();
    let dependencyState: "rate_limited" | "unavailable" | undefined;
    try {
      const url = new URL(input.endpoint ?? ENTUR_GEOCODER_ENDPOINT);
      url.searchParams.set("q", normalizedQuery);
      url.searchParams.set("lang", "no");
      url.searchParams.set("countries", "NO");
      url.searchParams.set(
        "bbox",
        [
          TRONDELAG_TRAVEL_BOUNDS.west,
          TRONDELAG_TRAVEL_BOUNDS.south,
          TRONDELAG_TRAVEL_BOUNDS.east,
          TRONDELAG_TRAVEL_BOUNDS.north,
        ].join(","),
      );
      url.searchParams.set("layers", "stopPlace,groupOfStopPlaces,street,place,poi,address");
      url.searchParams.set("limit", String(Math.min(Math.max(input.limit * 3, 8), 20)));
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "ET-Client-Name": input.clientName,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        dependencyState = response.status === 429 ? "rate_limited" : "unavailable";
        throw new EnturTravelSuggestionError(`Entur svarte ${response.status}.`);
      }
      const payload = travelPlaceSuggestionsFromEntur({
        payload: await response.json(),
        query: normalizedQuery,
        limit: input.limit,
      });
      runtimeHealth.recordDependency(
        "entur_geocoder",
        "ok",
        payload.suggestions.length
          ? "Entur stedsøk returnerte forslag."
          : "Entur stedsøk svarte uten forslag.",
        { latencyMs: Date.now() - startedAt },
      );
      return payload;
    } catch (error) {
      runtimeHealth.recordDependency(
        "entur_geocoder",
        dependencyState ??
          (error instanceof Error && error.name === "AbortError" ? "timeout" : "unavailable"),
        error instanceof EnturTravelSuggestionError
          ? error.message
          : "Entur stedsøk er ikke tilgjengelig akkurat nå.",
        { latencyMs: Date.now() - startedAt },
      );
      if (error instanceof EnturTravelSuggestionError) throw error;
      throw new EnturTravelSuggestionError("Entur stedsøk er ikke tilgjengelig akkurat nå.");
    } finally {
      clearTimeout(timeout);
    }
  })().catch((error) => {
    suggestionCache.delete(cacheKey);
    suggestionFailures.set(cacheKey, {
      expiresAt: Date.now() + ENTUR_GEOCODER_FAILURE_CACHE_MS,
      message:
        error instanceof Error ? error.message : "Entur stedsøk er ikke tilgjengelig akkurat nå.",
    });
    throw error;
  });

  suggestionCache.set(cacheKey, { expiresAt: nowMs + ENTUR_GEOCODER_CACHE_MS, promise });
  return promise;
}
