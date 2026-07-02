import type { Geometry, LineString, Point } from "geojson";
import type {
  SourceConfidenceLevel,
  SourceConfidenceSummary,
  SourceId,
  TrafficPulseCorridor,
} from "./types.js";

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
  location?: {
    lat: number;
    lng: number;
    label?: string;
  };
}

export type TrafficMapEventSource = "datex" | "vegvesen_traffic_info" | "news_article";
export type PersistedTrafficMapEventSource = "vegvesen_traffic_info";

export interface TrafficMapEvent {
  id: string;
  source: TrafficMapEventSource;
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

export type PersistedTrafficMapEvent = TrafficMapEvent & {
  source: PersistedTrafficMapEventSource;
};

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
  geometry: LineString;
  bufferMeters: number;
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
  municipalityName?: string;
  roadCategory?: string;
  roadNumber?: string;
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
    | "vegvesen_traffic_info"
    | "entur_vehicle_positions"
    | "entur_service_alerts";
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

export interface TravelPlanPlace {
  query: string;
  label: string;
  coordinate: [number, number];
}

export interface TravelPlanRoute {
  source: "osrm" | "direct";
  geometry: LineString;
  distanceMeters: number;
  durationSeconds?: number;
  detail: string;
}

export interface TravelPlanTrafficImpact {
  event: TrafficMapEvent;
  distanceMeters: number;
  severity: TrafficEventSeverity;
  summary: string;
}

export interface TravelPlanTransitSuggestion {
  id: string;
  kind: "vehicle" | "alert" | "planning_link";
  title: string;
  detail: string;
  source: "Entur kjøretøyposisjoner" | "Entur avvik" | "AtB/Entur";
  distanceMeters?: number;
  lineName?: string;
  publicCode?: string;
  mode?: string;
  href?: string;
}

export interface TravelPlanPayload {
  origin: TravelPlanPlace;
  destination: TravelPlanPlace;
  route: TravelPlanRoute;
  trafficImpacts: TravelPlanTrafficImpact[];
  publicTransportSuggestions: TravelPlanTransitSuggestion[];
  sources: TrafficMapSourceStatus[];
  generatedAt: string;
}

export interface SpatialHeatmapCell {
  id: string;
  center: {
    lat: number;
    lng: number;
  };
  radiusMeters: number;
  count: number;
  sourceItemCount: number;
  sourceItemIds?: string[];
  articleCount: number;
  trafficEventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  activeDayCount: number;
  sourceIds: Array<SourceId | TrafficMapEventSource>;
  maxSeverity?: TrafficEventSeverity;
  sourceConfidence?: SourceConfidenceSummary;
}

export interface UnexplainedDelayCandidate {
  id: string;
  corridorId: string;
  corridorName: string;
  geometry: LineString;
  state: TrafficPulseCorridor["state"];
  delaySeconds?: number;
  delayRatio?: number;
  updatedAt: string;
  sourceUrl: string;
  matchedArticleIds: string[];
  affectedEventIds: string[];
  confidence: "watch" | "warning" | "critical";
  reason: string;
  sourceConfidence?: SourceConfidenceSummary;
}

export interface SpatialInvestigationQueueItem {
  id: string;
  kind: "unexplained_delay" | "hotspot" | "traffic_counter_anomaly";
  priority: "critical" | "high" | "watch";
  title: string;
  summary: string;
  reason: string;
  updatedAt: string;
  evidence: string[];
  articleIds: string[];
  sourceItemIds: string[];
  sourceConfidence?: SourceConfidenceSummary;
  targetUrl?: string;
}

export interface CommandCenterSpatialAnalyticsPayload {
  generatedAt: string;
  window: {
    from?: string;
    to?: string;
  };
  summary: {
    heatmapCells: number;
    observations: number;
    unexplainedDelays: number;
    criticalDelays: number;
    bySourceConfidence: Record<SourceConfidenceLevel, number>;
  };
  investigationQueue: SpatialInvestigationQueueItem[];
  heatmapCells: SpatialHeatmapCell[];
  unexplainedDelays: UnexplainedDelayCandidate[];
}
