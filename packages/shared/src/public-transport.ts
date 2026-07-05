import type { MultiPoint, Point } from "geojson";
import type { SourceHealth } from "./types.js";

export type PublicTransportVehicleMode = "bus" | "tram" | "rail" | "water" | "metro" | "unknown";
export type PublicTransportAlertState = "active" | "expired" | "cancelled";

export interface PublicTransportVehicle {
  id: string;
  source: "entur_vehicle_positions";
  codespaceId: string;
  vehicleId: string;
  mode: PublicTransportVehicleMode;
  lineRef?: string;
  publicCode?: string;
  lineName?: string;
  operatorRef?: string;
  operatorName?: string;
  originName?: string;
  destinationName?: string;
  lastUpdated: string;
  expiresAt?: string;
  geometry: Point;
  speedMps?: number;
  bearing?: number;
  delaySeconds?: number;
  inCongestion?: boolean;
  occupancyStatus?: string;
  vehicleStatus?: string;
  monitored?: boolean;
  currentStopPointRef?: string;
  currentStopOrder?: number;
  vehicleAtStop?: boolean;
  progressPercent?: number;
  stale: boolean;
}

export interface PublicTransportServiceAlert {
  id: string;
  source: "entur_service_alerts";
  codespaceId: string;
  situationNumber: string;
  severity?: string;
  reportType?: string;
  summary: string;
  description?: string;
  advice?: string;
  validFrom?: string;
  validTo?: string;
  createdAt?: string;
  updatedAt: string;
  version?: number;
  state: PublicTransportAlertState;
  geometry?: Point | MultiPoint;
  affectedLineRefs?: string[];
  affectedLineNames?: string[];
  affectedStopIds?: string[];
  affectedStopNames?: string[];
  infoLinks?: Array<{ uri: string; label?: string }>;
}

export interface PublicTransportMapPayload {
  vehicles: PublicTransportVehicle[];
  alerts: PublicTransportServiceAlert[];
  sources: SourceHealth[];
  generatedAt: string;
}

export type PublicTransportDepartureBoardStatus = "ok" | "empty" | "unavailable";
export type PublicTransportDepartureNoticeSeverity = "info" | "warning";

export interface PublicTransportDepartureNotice {
  id: string;
  title: string;
  detail?: string;
  severity: PublicTransportDepartureNoticeSeverity;
}

export interface PublicTransportDeparture {
  id: string;
  stopId: string;
  stopName: string;
  stopDistanceMeters?: number;
  quayId?: string;
  quayName?: string;
  quayPublicCode?: string;
  mode: PublicTransportVehicleMode;
  lineId?: string;
  publicCode?: string;
  lineName?: string;
  serviceJourneyId?: string;
  destinationName: string;
  aimedDepartureTime: string;
  expectedDepartureTime: string;
  delaySeconds: number;
  realtime: boolean;
  cancelled: boolean;
  notices: PublicTransportDepartureNotice[];
  handoffUrl: string;
}

export interface PublicTransportDepartureStop {
  id: string;
  name: string;
  coordinate: [number, number];
  distanceMeters?: number;
  modes: PublicTransportVehicleMode[];
  departures: PublicTransportDeparture[];
}

export interface PublicTransportDepartureBoardPayload {
  status: PublicTransportDepartureBoardStatus;
  detail: string;
  areaLabel: string;
  center: { lat: number; lon: number };
  stops: PublicTransportDepartureStop[];
  departures: PublicTransportDeparture[];
  sources: SourceHealth[];
  generatedAt: string;
  handoffUrl: string;
}
