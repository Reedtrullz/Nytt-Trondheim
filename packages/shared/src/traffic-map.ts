import type { Geometry } from "geojson";

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
}

export interface TrafficMapPayload {
  events: TrafficMapEvent[];
  brief: TrafficBrief;
  corridorImpacts?: TrafficCorridorImpact[];
}
