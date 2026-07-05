import type { MapFeature, SourceHealth } from "./types.js";
import type { RoadWeatherObservation } from "./traffic-map.js";

export type WeatherRiskLevel = "normal" | "watch" | "warning" | "severe";
export type WeatherDataStatus = "ok" | "partial" | "stale" | "unavailable";
export type WeatherCacheStatus = "hit" | "miss" | "fallback";
export type WeatherForecastProduct = "locationforecast" | "nowcast";

export type WeatherRiskKey =
  | "precipitation"
  | "wind"
  | "floodLandslide"
  | "roadConditions"
  | "powerTelecom"
  | "health";

export interface WeatherCurrentSummary {
  summary: string;
  updatedAt: string;
  airTemperatureC?: number;
  windSpeedMps?: number;
  windDirectionDeg?: number;
  precipitationNextHourMm?: number;
  symbolCode?: string;
  dataStatus?: WeatherDataStatus;
  sourceLabel?: string;
}

export interface WeatherHourlyPoint {
  time: string;
  airTemperatureC?: number;
  windSpeedMps?: number;
  windDirectionDeg?: number;
  precipitationMm?: number;
  symbolCode?: string;
  sourceProduct?: WeatherForecastProduct;
}

export interface WeatherRiskItem {
  key: WeatherRiskKey;
  label: string;
  status: string;
  level: WeatherRiskLevel;
  source: string;
  confidence: string;
  nextChange: string;
  detail: string;
  dataStatus?: WeatherDataStatus;
  freshness?: string;
}

export interface WeatherPreparednessAction {
  id: string;
  title: string;
  detail: string;
  source: string;
  level: WeatherRiskLevel;
}

export interface WeatherAuthorityLink {
  label: string;
  url: string;
  source: string;
}

export interface WeatherAuthorityStatus {
  emergencyAlertStatus: string;
  civilDefenceDetail: string;
  links: WeatherAuthorityLink[];
}

export interface WeatherImpactGroup {
  group: "Innbyggere" | "Transport" | "Helse" | "Skole/arrangement" | "Beredskap";
  status: string;
  level: WeatherRiskLevel;
  detail: string;
  source: string;
}

export interface WeatherWarningSummary {
  id: string;
  source: "met" | "nve";
  sourceLabel: string;
  title: string;
  area: string;
  level: string;
  severityRank?: number;
  eventType?: string;
  state?: string;
  validFrom?: string;
  validUntil: string;
  url: string;
  geometry?: MapFeature["geometry"];
}

export interface WeatherMapLayer {
  id: string;
  title: string;
  source: string;
  status: "available" | "planned" | "context";
  detail: string;
}

export interface WeatherForecastLocation {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  description: string;
}

export interface WeatherForecastMetadata {
  source: "met";
  product: WeatherForecastProduct;
  locationId: string;
  fetchedAt: string;
  updatedAt?: string;
  expiresAt?: string;
  cacheStatus: WeatherCacheStatus;
  dataStatus: WeatherDataStatus;
  detail: string;
}

export interface WeatherForecastZone {
  location: WeatherForecastLocation;
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
  nowcast: WeatherHourlyPoint[];
  metadata: WeatherForecastMetadata[];
  dataStatus: WeatherDataStatus;
  summary: string;
}

export interface WeatherForecastOverview {
  primaryLocationId: string;
  generatedAt: string;
  zones: WeatherForecastZone[];
  sourceDetail: string;
}

export interface WeatherQualitySummary {
  dataStatus: WeatherDataStatus;
  cacheStatus: WeatherCacheStatus;
  fetchedAt: string;
  expiresAt?: string;
  detail: string;
  products: WeatherForecastMetadata[];
  roadWeatherFreshCount: number;
  roadWeatherStaleCount: number;
}

export interface WeatherPreparednessPayload {
  generatedAt: string;
  location?: WeatherForecastLocation;
  forecast?: WeatherForecastOverview;
  quality?: WeatherQualitySummary;
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
  risks: WeatherRiskItem[];
  actions: WeatherPreparednessAction[];
  authority: WeatherAuthorityStatus;
  impactGroups: WeatherImpactGroup[];
  warnings: WeatherWarningSummary[];
  roadWeather: RoadWeatherObservation[];
  mapLayers: WeatherMapLayer[];
  sources: SourceHealth[];
}
