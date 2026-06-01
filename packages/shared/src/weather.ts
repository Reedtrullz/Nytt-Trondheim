import type { SourceHealth } from "./types.js";
import type { RoadWeatherObservation } from "./traffic-map.js";

export type WeatherRiskLevel = "normal" | "watch" | "warning" | "severe";

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
}

export interface WeatherHourlyPoint {
  time: string;
  airTemperatureC?: number;
  windSpeedMps?: number;
  precipitationMm?: number;
  symbolCode?: string;
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
  sourceLabel: string;
  title: string;
  area: string;
  level: string;
  validUntil: string;
  url: string;
}

export interface WeatherMapLayer {
  id: string;
  title: string;
  source: string;
  status: "available" | "planned" | "context";
  detail: string;
}

export interface WeatherPreparednessPayload {
  generatedAt: string;
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
