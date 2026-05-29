import type { Geometry, Point } from "geojson";
import type { TrafficPulseCorridor } from "./types.js";

export type TrafficEventCategory =
  | "roadworks"
  | "accident"
  | "closure"
  | "congestion"
  | "weather"
  | "restriction"
  | "obstruction"
  | "other";

export type TrafficEventSeverity = "low" | "medium" | "high" | "critical";
export type TrafficEventState = "planned" | "active" | "expired" | "cancelled";

export interface RelatedTrafficArticle {
  id: string;
  title: string;
  url: string;
  distanceMeters: number;
}

export interface TrafficMapEvent {
  id: string;
  source: "datex" | "vegvesen_traffic_info";
  sourceEventId: string;
  category: TrafficEventCategory;
  severity: TrafficEventSeverity;
  state: TrafficEventState;
  title: string;
  description?: string;
  locationName?: string;
  roadName?: string;
  validFrom?: string;
  validTo?: string;
  updatedAt: string;
  sourceUrl?: string;
  geometry: Geometry;
  rawType?: string;
  confidence?: number;
  relatedArticles?: RelatedTrafficArticle[];
}

export interface TrafficMapFilters {
  categories?: TrafficEventCategory[];
  severities?: TrafficEventSeverity[];
  states?: TrafficEventState[];
  from?: string;
  to?: string;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface TrafficBrief {
  headline: string;
  severity: TrafficEventSeverity;
  freshness: "fresh" | "stale" | "unknown";
  generatedAt: string;
  bullets: string[];
  primaryEventIds: string[];
  counts: {
    total: number;
    byCategory: Partial<Record<TrafficEventCategory, number>>;
    bySeverity: Partial<Record<TrafficEventSeverity, number>>;
  };
}

export interface TrafficCorridorImpact {
  id: string;
  name: string;
  eventCount: number;
  affectedEventIds: string[];
  highestSeverity: TrafficEventSeverity;
  travelTime?: Pick<
    TrafficPulseCorridor,
    | "id"
    | "name"
    | "state"
    | "travelTimeSeconds"
    | "freeFlowSeconds"
    | "delaySeconds"
    | "delayRatio"
    | "trend"
    | "measurementFrom"
    | "measurementTo"
    | "updatedAt"
    | "sourceUrl"
  >;
}

export interface RoadWeatherObservation {
  id: string;
  source: "datex_weather";
  stationId: string;
  stationName: string;
  observedAt: string;
  updatedAt: string;
  geometry: Point;
  airTemperatureC?: number;
  roadSurfaceTemperatureC?: number;
  precipitationMm?: number;
  windSpeedMps?: number;
  visibilityMeters?: number;
  rawSummary?: string;
}

export interface RoadCamera {
  id: string;
  source: "datex_cctv";
  cameraId: string;
  name: string;
  status: "ok" | "offline" | "unknown";
  updatedAt: string;
  geometry: Point;
  imageUrl?: string;
  sourceUrl?: string;
}

export interface TrafficCounterSnapshot {
  id: string;
  source: "trafikkdata";
  pointId: string;
  name: string;
  updatedAt: string;
  geometry: Point;
  volumeLastHour?: number;
  coveragePercent?: number;
  baselineVolumeLastHour?: number;
  anomalyRatio?: number;
}

export interface TrafficMapSourceStatus {
  source:
    | "datex"
    | "datex_travel_time"
    | "datex_weather"
    | "datex_cctv"
    | "trafikkdata"
    | "vegvesen_traffic_info";
  label: string;
  state: "ok" | "degraded" | "disabled" | "awaiting_access";
  detail: string;
  lastCheckedAt?: string;
}

export interface TrafficMapPayload {
  events: TrafficMapEvent[];
  brief: TrafficBrief;
  corridorImpacts?: TrafficCorridorImpact[];
  weather?: RoadWeatherObservation[];
  cameras?: RoadCamera[];
  counters?: TrafficCounterSnapshot[];
  sources?: TrafficMapSourceStatus[];
}
