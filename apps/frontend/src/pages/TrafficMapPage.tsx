import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type {
  PublicTransportDeparture,
  PublicTransportDepartureBoardPayload,
  TrafficCorridorImpact,
  TrafficEventCategory,
  TrafficEventState,
  TrafficEventSeverity,
  TrafficMapEvent,
  TravelPlaceSuggestion,
  TravelPlanComparisonPreset,
  TravelPlanComparisonSource,
  TravelPlanItinerary,
  TravelPlanLeg,
  TravelPlanLegMode,
  TravelPlanPayload,
} from "@nytt/shared";
import { CorridorImpactCard } from "../components/map/CorridorImpactCard.js";
import { MapBoundsWatcher } from "../components/map/MapBoundsWatcher.js";
import {
  PublicTransportLayer,
  PublicTransportSummary,
} from "../components/map/PublicTransportLayer.js";
import { MapAccessibility } from "../components/map/MapAccessibility.js";
import { RoadContextLayer } from "../components/map/RoadContextLayer.js";
import { TrafficDetailDrawer } from "../components/map/TrafficDetailDrawer.js";
import { TrafficEventList } from "../components/map/TrafficEventList.js";
import {
  TrafficFilterPanel,
  type TrafficLayerVisibility,
  type TrafficMapPreset,
} from "../components/map/TrafficFilterPanel.js";
import { TrafficLayer } from "../components/map/TrafficLayer.js";
import { TrafficLegend } from "../components/map/TrafficLegend.js";
import { TrafficNowSummary } from "../components/map/TrafficNowSummary.js";
import { fetchPublicTransportDepartureBoard } from "../api/publicTransportDepartures.js";
import {
  fetchTravelPlaceSuggestions,
  fetchTravelPlan,
  fetchTravelPlanComparison,
} from "../api/travelPlan.js";
import { usePublicTransportMap } from "../hooks/usePublicTransportMap.js";
import { useTrafficMap } from "../hooks/useTrafficMap.js";
import {
  boundsFromGeometry,
  boundsFromLatLngs,
  latLngFromGeoJsonPosition,
  latLngsFromLineString,
} from "../mapCoordinates.js";
import { safeExternalUrl } from "../safeExternalUrl.js";
import { compactTrafficEventRow } from "../trafficEventRows.js";
import {
  buildTrafficMapSearch,
  parseTrafficMapFilters,
  trafficFiltersForPreset,
  type TrafficMapFilters,
} from "../trafficMapFilters.js";
import {
  buildTrafficViewModel,
  formatTrafficFreshness,
  visibleByDefault,
  visibleInTrafficLayers,
} from "../trafficViewModel.js";

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface TrafficTimeWindow {
  states: TrafficEventState[];
  from?: string;
  to?: string;
}

type DepartureBoardScope = "default" | "origin";
type LocationRequestStatus = "idle" | "loading" | "success" | "error";

interface DepartureBoardContext {
  scope: DepartureBoardScope;
  label: string;
  center?: { lat: number; lon: number };
  startTime?: string;
}

interface SelectedDepartureMatch {
  leg: TravelPlanLeg;
  departure?: PublicTransportDeparture;
}

type SelectedDepartureStatusSeverity = "ok" | "watch" | "warning";

interface SelectedDepartureStatus {
  label: string;
  detail: string;
  severity: SelectedDepartureStatusSeverity;
}

export type RouteDepartureBoardStatus = "idle" | "loading" | "ready" | "partial" | "error";

export interface RouteDepartureCheckpoint {
  id: string;
  leg: TravelPlanLeg;
  index: number;
  label: string;
  context: DepartureBoardContext;
}

export interface RouteDepartureBoardResult {
  checkpointId: string;
  board?: PublicTransportDepartureBoardPayload;
  error?: string;
}

export interface RouteDepartureConfidenceItem {
  checkpoint: RouteDepartureCheckpoint;
  departure?: PublicTransportDeparture;
  status: SelectedDepartureStatus;
  board?: PublicTransportDepartureBoardPayload;
}

export interface RouteDepartureConfidenceSummary {
  heading: string;
  detail: string;
  severity: SelectedDepartureStatusSeverity;
}

export interface SelectedRouteWatchItem {
  id: string;
  label: string;
  detail: string;
  severity: SelectedDepartureStatusSeverity;
  source: string;
}

export interface SelectedRouteWatchSummary {
  heading: string;
  detail: string;
  severity: SelectedDepartureStatusSeverity;
  items: SelectedRouteWatchItem[];
}

export interface DepartureLineFilterOption {
  key: string;
  label: string;
  count: number;
  severity: SelectedDepartureStatusSeverity;
}

type RouteInputKind = "origin" | "destination";

const trondheimCenter: [number, number] = [63.4305, 10.3951];
const defaultDepartureBoardContext: DepartureBoardContext = {
  scope: "default",
  label: "Trondheim sentrum",
};
const tiles = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";
const severityRank: Record<TrafficEventSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function formatCoordinateInput(input: { lat: number; lon: number }): string {
  return `${input.lat.toFixed(5)}, ${input.lon.toFixed(5)}`;
}

export function timeWindowForPreset(preset: TrafficMapPreset): TrafficTimeWindow {
  const now = new Date();
  switch (preset) {
    case "next24h":
      return {
        states: ["active", "planned"],
        from: now.toISOString(),
        to: addHours(now, 24).toISOString(),
      };
    case "next7d":
      return {
        states: ["active", "planned"],
        from: now.toISOString(),
        to: addHours(now, 24 * 7).toISOString(),
      };
    case "planned":
      return { states: ["planned"], from: now.toISOString() };
    case "severe":
      return { states: ["active", "planned"] };
    case "custom":
      return { states: ["active", "planned"] };
    case "now":
    default:
      return { states: ["active"] };
  }
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds?: number): string | undefined {
  if (seconds === undefined) return undefined;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} t ${remainder} min` : `${hours} t`;
}

const timeFormatter = new Intl.DateTimeFormat("nb-NO", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Oslo",
});

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ukjent";
  return timeFormatter.format(date);
}

const osloDateFormatter = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Oslo",
});

const osloDateTimePartsFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Oslo",
  year: "numeric",
});

interface OsloDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

type OsloCivilDate = Pick<OsloDateTimeParts, "year" | "month" | "day">;

function osloDateTimeParts(value: Date): OsloDateTimeParts {
  const parts = osloDateTimePartsFormatter.formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function osloDateKey(value: Date): string {
  const { year, month, day } = osloDateTimeParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCivilDays(date: OsloCivilDate, days: number): OsloCivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function osloLocalTimeToInstant(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): Date {
  const target = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
  let instant = new Date(target);
  for (let index = 0; index < 2; index += 1) {
    const observed = osloDateTimeParts(instant);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    instant = new Date(instant.getTime() - (observedAsUtc - target));
  }
  return instant;
}

export function formatTravelDateTime(value: string, base = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ukjent";
  const clock = formatClock(value);
  if (osloDateKey(date) === osloDateKey(base)) return clock;
  const tomorrow = addCivilDays(osloDateTimeParts(base), 1);
  const tomorrowInstant = osloLocalTimeToInstant({ ...tomorrow, hour: 12, minute: 0 });
  if (osloDateKey(date) === osloDateKey(tomorrowInstant)) return `i morgen ${clock}`;
  return `${osloDateFormatter.format(date)} ${clock}`;
}

type TravelTimePreset = "now" | "in30" | "in60" | "in120" | "tomorrow_morning";

interface DestinationPreset {
  label: string;
  query: string;
}

interface TravelPlannerSearchState {
  originInput: string;
  destinationInput: string;
  timePreset: TravelTimePreset;
  shouldAutoSubmit: boolean;
}

export interface RememberedTravelRoute {
  id: string;
  originInput: string;
  destinationInput: string;
  originQuery: string;
  destinationQuery: string;
  originLabel?: string;
  destinationLabel?: string;
  timePreset: TravelTimePreset;
  pinned: boolean;
  useCount: number;
  createdAt: string;
  lastUsedAt: string;
}

export interface RememberedTravelRouteCandidate {
  originInput: string;
  destinationInput: string;
  originQuery: string;
  destinationQuery: string;
  originLabel?: string;
  destinationLabel?: string;
  timePreset: TravelTimePreset;
}

export interface RememberedDepartureBoard {
  id: string;
  label: string;
  center: { lat: number; lon: number };
  preferredLineFilterKey?: string;
  preferredLineFilterLabel?: string;
  useCount: number;
  createdAt: string;
  lastUsedAt: string;
}

export interface RememberedDepartureBoardCandidate {
  label: string;
  center: { lat: number; lon: number };
  preferredLineFilterKey?: string;
  preferredLineFilterLabel?: string;
}

interface RememberedTravelRouteQueryOverride {
  from: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
}

type TravelTimeComparisonStatus = "idle" | "loading" | "ready" | "partial" | "error";

export interface TravelTimeComparisonOption {
  preset: TravelPlanComparisonPreset;
  label: string;
  status: "available" | "empty" | "unavailable" | "error";
  severity: "ok" | "watch" | "warning";
  score: number;
  recommended: boolean;
  active: boolean;
  departureLabel: string;
  arrivalLabel?: string;
  durationLabel?: string;
  transferLabel?: string;
  lineSummary: string;
  summary: string;
  detail: string;
}

export interface TravelTimeComparisonModel {
  status: Exclude<TravelTimeComparisonStatus, "idle" | "loading">;
  heading: string;
  detail: string;
  recommendedPreset?: TravelPlanComparisonPreset;
  options: TravelTimeComparisonOption[];
}

export interface TravelTimeComparisonLiveCheck {
  severity: SelectedDepartureStatusSeverity;
  heading: string;
  detail: string;
}

interface TravelTimeComparisonState {
  status: TravelTimeComparisonStatus;
  model?: TravelTimeComparisonModel;
  sources?: TravelPlanComparisonSource[];
  activePreset?: TravelPlanComparisonPreset;
}

export type RouteChoiceKind = "recommended" | "fastest" | "fewest_transfers" | "robust";

export interface RouteChoiceOption {
  kind: RouteChoiceKind;
  label: string;
  itineraryId: string;
  selected: boolean;
  recommended: boolean;
  severity: SelectedDepartureStatusSeverity;
  score: number;
  summary: string;
  lineSummary: string;
  detail: string;
  meta: string;
}

export interface RouteChoiceModel {
  heading: string;
  detail: string;
  recommendedItineraryId: string;
  options: RouteChoiceOption[];
}

export function compactRouteChoiceOptions(
  model?: RouteChoiceModel,
  limit = 3,
): RouteChoiceOption[] {
  if (!model) return [];
  const merged = model.options.reduce<RouteChoiceOption[]>((items, option) => {
    const existing = items.find((item) => item.itineraryId === option.itineraryId);
    if (!existing) {
      items.push({ ...option });
      return items;
    }
    const labels = new Set([...existing.label.split(" · "), option.label]);
    existing.label = [...labels].join(" · ");
    existing.recommended = existing.recommended || option.recommended;
    existing.selected = existing.selected || option.selected;
    existing.severity = strongestDepartureSeverity(existing.severity, option.severity);
    existing.score = Math.min(existing.score, option.score);
    return items;
  }, []);
  if (merged.length <= limit) return merged;

  const selected = merged.find((option) => option.selected);
  const visible = merged.slice(0, limit);
  if (selected && !visible.some((option) => option.itineraryId === selected.itineraryId)) {
    visible[visible.length - 1] = selected;
  }
  return visible;
}

const destinationPresets: DestinationPreset[] = [
  { label: "Trondheim S", query: "Trondheim S" },
  { label: "St. Olavs", query: "St. Olavs hospital" },
  { label: "NTNU Gløshaugen", query: "NTNU Gløshaugen" },
  { label: "Lerkendal", query: "Lerkendal stadion" },
  { label: "Lade", query: "Lade Arena" },
  { label: "Heimdal", query: "Heimdal stasjon" },
  { label: "Værnes", query: "Trondheim lufthavn Værnes" },
];

const travelTimePresets: TravelTimePreset[] = ["now", "in30", "in60", "in120", "tomorrow_morning"];
const travelTimeComparisonPresets: TravelPlanComparisonPreset[] = ["now", "in30", "in60", "in120"];
const travelTimePresetSet = new Set<string>(travelTimePresets);
const travelTimeComparisonPresetSet = new Set<string>(travelTimeComparisonPresets);
const trafficFilterSearchKeys = ["preset", "category", "severity", "layers"] as const;
const travelPlannerSearchKeys = ["fra", "til", "tid"] as const;
const rememberedTravelRoutesStorageKey = "nytt:traffic:remembered-routes:v1";
const rememberedTravelRouteLimit = 8;
const rememberedDepartureBoardsStorageKey = "nytt:traffic:remembered-departure-boards:v1";
const rememberedDepartureBoardLimit = 6;

function isTravelTimeComparisonPreset(
  preset: TravelTimePreset,
): preset is TravelPlanComparisonPreset {
  return travelTimeComparisonPresetSet.has(preset);
}

function cleanTravelSearchText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function canonicalTravelPlannerQuery(value: string | null): string {
  const cleaned = cleanTravelSearchText(value);
  if (!cleaned || looksLikeCoordinateQuery(cleaned)) return cleaned;
  const normalized = cleaned.toLocaleLowerCase("nb");
  const preset = destinationPresets.find(
    (candidate) =>
      candidate.label.toLocaleLowerCase("nb") === normalized ||
      candidate.query.toLocaleLowerCase("nb") === normalized,
  );
  return preset?.query ?? cleaned;
}

function looksLikeCoordinateQuery(value: string): boolean {
  return /^-?\d{1,2}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?$/.test(cleanTravelSearchText(value));
}

function normalizedRememberedRouteKey(value: string): string {
  return cleanTravelSearchText(value).toLocaleLowerCase("nb");
}

function rememberedTravelRouteId(
  candidate: Pick<RememberedTravelRouteCandidate, "originQuery" | "destinationQuery">,
): string {
  return `${normalizedRememberedRouteKey(candidate.originQuery)} -> ${normalizedRememberedRouteKey(candidate.destinationQuery)}`;
}

function cleanOptionalRouteLabel(value: string | undefined): string | undefined {
  const cleaned = cleanTravelSearchText(value ?? null);
  return cleaned || undefined;
}

function cleanRememberedRoute(
  route: Partial<RememberedTravelRoute>,
): RememberedTravelRoute | undefined {
  const originInput = cleanTravelSearchText(route.originInput ?? null);
  const destinationInput = cleanTravelSearchText(route.destinationInput ?? null);
  const originQuery = cleanTravelSearchText(route.originQuery ?? null);
  const destinationQuery = cleanTravelSearchText(route.destinationQuery ?? null);
  if (!originInput || !destinationInput || !originQuery || !destinationQuery) return undefined;
  const timePreset = travelTimePresetSet.has(route.timePreset ?? "")
    ? (route.timePreset as TravelTimePreset)
    : "now";
  const now = new Date().toISOString();
  return {
    id: rememberedTravelRouteId({ originQuery, destinationQuery }),
    originInput,
    destinationInput,
    originQuery,
    destinationQuery,
    ...(cleanOptionalRouteLabel(route.originLabel)
      ? { originLabel: cleanOptionalRouteLabel(route.originLabel) }
      : {}),
    ...(cleanOptionalRouteLabel(route.destinationLabel)
      ? { destinationLabel: cleanOptionalRouteLabel(route.destinationLabel) }
      : {}),
    timePreset,
    pinned: Boolean(route.pinned),
    useCount: Math.max(1, Math.floor(route.useCount ?? 1)),
    createdAt:
      route.createdAt && Number.isFinite(Date.parse(route.createdAt)) ? route.createdAt : now,
    lastUsedAt:
      route.lastUsedAt && Number.isFinite(Date.parse(route.lastUsedAt)) ? route.lastUsedAt : now,
  };
}

export function sortRememberedTravelRoutes(
  routes: RememberedTravelRoute[],
): RememberedTravelRoute[] {
  return [...routes].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const lastUsedDelta = Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt);
    if (Number.isFinite(lastUsedDelta) && lastUsedDelta !== 0) return lastUsedDelta;
    return right.useCount - left.useCount;
  });
}

export function upsertRememberedTravelRoute(
  routes: RememberedTravelRoute[],
  candidate: RememberedTravelRouteCandidate,
  now = new Date().toISOString(),
): RememberedTravelRoute[] {
  const cleaned = cleanRememberedRoute({
    ...candidate,
    createdAt: now,
    lastUsedAt: now,
    useCount: 1,
  });
  if (!cleaned) return sortRememberedTravelRoutes(routes).slice(0, rememberedTravelRouteLimit);
  const existing = routes.find((route) => route.id === cleaned.id);
  const nextRoute: RememberedTravelRoute = existing
    ? {
        id: existing.id,
        originInput: cleaned.originInput,
        destinationInput: cleaned.destinationInput,
        originQuery: cleaned.originQuery,
        destinationQuery: cleaned.destinationQuery,
        ...(cleaned.originLabel ? { originLabel: cleaned.originLabel } : {}),
        ...(cleaned.destinationLabel ? { destinationLabel: cleaned.destinationLabel } : {}),
        timePreset: cleaned.timePreset,
        pinned: existing.pinned,
        useCount: existing.useCount + 1,
        createdAt: existing.createdAt,
        lastUsedAt: now,
      }
    : { ...cleaned, lastUsedAt: now, createdAt: now };
  const rest = routes.filter((route) => route.id !== nextRoute.id);
  return sortRememberedTravelRoutes([nextRoute, ...rest]).slice(0, rememberedTravelRouteLimit);
}

export function toggleRememberedTravelRoutePinned(
  routes: RememberedTravelRoute[],
  routeId: string,
  now = new Date().toISOString(),
): RememberedTravelRoute[] {
  return sortRememberedTravelRoutes(
    routes.map((route) =>
      route.id === routeId ? { ...route, pinned: !route.pinned, lastUsedAt: now } : route,
    ),
  ).slice(0, rememberedTravelRouteLimit);
}

export function removeRememberedTravelRoute(
  routes: RememberedTravelRoute[],
  routeId: string,
): RememberedTravelRoute[] {
  return sortRememberedTravelRoutes(routes.filter((route) => route.id !== routeId)).slice(
    0,
    rememberedTravelRouteLimit,
  );
}

export function readRememberedTravelRoutes(storage: Storage | undefined): RememberedTravelRoute[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(rememberedTravelRoutesStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sortRememberedTravelRoutes(
      parsed
        .map((entry) => cleanRememberedRoute(entry as Partial<RememberedTravelRoute>))
        .filter((entry): entry is RememberedTravelRoute => Boolean(entry)),
    ).slice(0, rememberedTravelRouteLimit);
  } catch {
    return [];
  }
}

function cleanDepartureLineFilterText(value: string | undefined): string | undefined {
  const cleaned = cleanTravelSearchText(value ?? null);
  return cleaned || undefined;
}

function rememberedDepartureBoardId(input: {
  center: { lat: number; lon: number };
  preferredLineFilterKey?: string;
}): string {
  const base = `${input.center.lat.toFixed(5)},${input.center.lon.toFixed(5)}`;
  const lineKey = cleanDepartureLineFilterText(input.preferredLineFilterKey);
  return lineKey ? `${base}|line:${lineKey.toLocaleLowerCase("nb")}` : base;
}

function cleanRememberedDepartureBoard(
  board: Partial<RememberedDepartureBoard>,
): RememberedDepartureBoard | undefined {
  const label = cleanTravelSearchText(board.label ?? null);
  const lat = board.center?.lat;
  const lon = board.center?.lon;
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const center = { lat: Number(lat), lon: Number(lon) };
  if (center.lat < -90 || center.lat > 90 || center.lon < -180 || center.lon > 180) {
    return undefined;
  }
  const now = new Date().toISOString();
  const preferredLineFilterKey = cleanDepartureLineFilterText(board.preferredLineFilterKey);
  const preferredLineFilterLabel = preferredLineFilterKey
    ? cleanDepartureLineFilterText(board.preferredLineFilterLabel)
    : undefined;
  return {
    id: rememberedDepartureBoardId({ center, preferredLineFilterKey }),
    label,
    center,
    ...(preferredLineFilterKey ? { preferredLineFilterKey } : {}),
    ...(preferredLineFilterLabel ? { preferredLineFilterLabel } : {}),
    useCount: Math.max(1, Math.floor(board.useCount ?? 1)),
    createdAt:
      board.createdAt && Number.isFinite(Date.parse(board.createdAt)) ? board.createdAt : now,
    lastUsedAt:
      board.lastUsedAt && Number.isFinite(Date.parse(board.lastUsedAt)) ? board.lastUsedAt : now,
  };
}

export function sortRememberedDepartureBoards(
  boards: RememberedDepartureBoard[],
): RememberedDepartureBoard[] {
  return [...boards].sort((left, right) => {
    const lastUsedDelta = Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt);
    if (Number.isFinite(lastUsedDelta) && lastUsedDelta !== 0) return lastUsedDelta;
    if (right.useCount !== left.useCount) return right.useCount - left.useCount;
    return left.label.localeCompare(right.label, "nb");
  });
}

export function upsertRememberedDepartureBoard(
  boards: RememberedDepartureBoard[],
  candidate: RememberedDepartureBoardCandidate,
  now = new Date().toISOString(),
): RememberedDepartureBoard[] {
  const cleaned = cleanRememberedDepartureBoard({
    ...candidate,
    createdAt: now,
    lastUsedAt: now,
    useCount: 1,
  });
  if (!cleaned)
    return sortRememberedDepartureBoards(boards).slice(0, rememberedDepartureBoardLimit);
  const existing = boards.find((board) => board.id === cleaned.id);
  const nextBoard: RememberedDepartureBoard = existing
    ? {
        ...cleaned,
        useCount: existing.useCount + 1,
        createdAt: existing.createdAt,
        lastUsedAt: now,
      }
    : { ...cleaned, createdAt: now, lastUsedAt: now };
  const rest = boards.filter((board) => board.id !== nextBoard.id);
  return sortRememberedDepartureBoards([nextBoard, ...rest]).slice(
    0,
    rememberedDepartureBoardLimit,
  );
}

export function removeRememberedDepartureBoard(
  boards: RememberedDepartureBoard[],
  boardId: string,
): RememberedDepartureBoard[] {
  return sortRememberedDepartureBoards(boards.filter((board) => board.id !== boardId)).slice(
    0,
    rememberedDepartureBoardLimit,
  );
}

export function readRememberedDepartureBoards(
  storage: Storage | undefined,
): RememberedDepartureBoard[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(rememberedDepartureBoardsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sortRememberedDepartureBoards(
      parsed
        .map((entry) => cleanRememberedDepartureBoard(entry as Partial<RememberedDepartureBoard>))
        .filter((entry): entry is RememberedDepartureBoard => Boolean(entry)),
    ).slice(0, rememberedDepartureBoardLimit);
  } catch {
    return [];
  }
}

function writeRememberedTravelRoutes(
  storage: Storage | undefined,
  routes: RememberedTravelRoute[],
): void {
  if (!storage) return;
  try {
    storage.setItem(rememberedTravelRoutesStorageKey, JSON.stringify(routes));
  } catch {
    // Local route memory is a convenience only. Ignore quota/private-mode failures.
  }
}

function writeRememberedDepartureBoards(
  storage: Storage | undefined,
  boards: RememberedDepartureBoard[],
): void {
  if (!storage) return;
  try {
    storage.setItem(rememberedDepartureBoardsStorageKey, JSON.stringify(boards));
  } catch {
    // Local departure-board memory is a convenience only.
  }
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function travelTimePresetFromSearch(value: string | null): TravelTimePreset {
  return travelTimePresetSet.has(value ?? "") ? (value as TravelTimePreset) : "now";
}

export function parseTravelPlannerSearch(search: string): TravelPlannerSearchState {
  const params = new URLSearchParams(search);
  const originInput = cleanTravelSearchText(params.get("fra"));
  const destinationInput = cleanTravelSearchText(params.get("til"));
  return {
    originInput,
    destinationInput,
    timePreset: travelTimePresetFromSearch(params.get("tid")),
    shouldAutoSubmit: Boolean(originInput && destinationInput),
  };
}

export function mergeTrafficFilterSearch(search: string, filters: TrafficMapFilters): string {
  const next = new URLSearchParams(search);
  trafficFilterSearchKeys.forEach((key) => next.delete(key));
  const filterParams = new URLSearchParams(buildTrafficMapSearch(filters));
  for (const [key, value] of filterParams.entries()) {
    next.set(key, value);
  }
  return next.toString();
}

export function mergeTravelPlannerSearch(
  search: string,
  input?: {
    originInput: string;
    destinationInput: string;
    timePreset: TravelTimePreset;
  },
): string {
  const next = new URLSearchParams(search);
  travelPlannerSearchKeys.forEach((key) => next.delete(key));
  const originInput = cleanTravelSearchText(input?.originInput ?? null);
  const destinationInput = cleanTravelSearchText(input?.destinationInput ?? null);
  if (originInput && destinationInput) {
    next.set("fra", originInput);
    next.set("til", destinationInput);
    if (input?.timePreset && input.timePreset !== "now") {
      next.set("tid", input.timePreset);
    }
  }
  return next.toString();
}

function currentSearchString(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.location.search;
}

export function departureTimeForPreset(preset: TravelTimePreset, base = new Date()): string {
  if (preset === "in30") return new Date(base.getTime() + 30 * 60 * 1000).toISOString();
  if (preset === "in60") return new Date(base.getTime() + 60 * 60 * 1000).toISOString();
  if (preset === "in120") return new Date(base.getTime() + 120 * 60 * 1000).toISOString();
  if (preset === "tomorrow_morning") {
    const tomorrow = addCivilDays(osloDateTimeParts(base), 1);
    return osloLocalTimeToInstant({ ...tomorrow, hour: 7, minute: 30 }).toISOString();
  }
  return base.toISOString();
}

function travelTimePresetLabel(preset: TravelTimePreset): string {
  switch (preset) {
    case "in30":
      return "Om 30 min";
    case "in60":
      return "Om 1 time";
    case "in120":
      return "Om 2 timer";
    case "tomorrow_morning":
      return "I morgen tidlig";
    case "now":
    default:
      return "Nå";
  }
}

function comparisonStatusLabel(status: TravelTimeComparisonOption["status"]): string {
  switch (status) {
    case "available":
      return "Reiseforslag";
    case "empty":
      return "Ingen treff";
    case "unavailable":
      return "Sjekk Entur";
    case "error":
      return "Feilet";
  }
}

function comparisonSeverityLabel(severity: TravelTimeComparisonOption["severity"]): string {
  switch (severity) {
    case "ok":
      return "Rolig";
    case "watch":
      return "Følg med";
    case "warning":
      return "Sjekk";
  }
}

function modeLabel(mode: TravelPlanLegMode): string {
  switch (mode) {
    case "walk":
      return "Gange";
    case "bus":
      return "Buss";
    case "tram":
      return "Trikk";
    case "rail":
      return "Tog";
    case "water":
      return "Båt";
    case "metro":
      return "T-bane";
    default:
      return "Kollektiv";
  }
}

function itineraryDecisionLabel(decision: TravelPlanItinerary["decision"]): string {
  switch (decision) {
    case "best":
      return "Best";
    case "good":
      return "Normal";
    case "watch":
      return "Følg med";
    case "avoid":
      return "Unngå";
  }
}

export function routePositions(plan: TravelPlanPayload): [number, number][] {
  return latLngsFromLineString(plan.route.geometry);
}

function selectedItineraryForPlan(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): TravelPlanItinerary | undefined {
  return (
    plan?.itineraries.find((itinerary) => itinerary.id === selectedItineraryId) ??
    plan?.itineraries[0]
  );
}

export function departureBoardContextFromPlan(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): DepartureBoardContext | undefined {
  if (!plan) return undefined;
  const boardingLeg = firstBoardingLeg(selectedItineraryForPlan(plan, selectedItineraryId));
  const [lon, lat] = boardingLeg?.from.coordinate ?? plan.origin.coordinate;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return {
    scope: "origin",
    label:
      boardingLeg?.from.stopName ??
      boardingLeg?.from.name ??
      plan.origin.label ??
      plan.origin.query ??
      "Valgt startpunkt",
    center: { lat, lon },
    ...(boardingLeg?.expectedStartTime || boardingLeg?.aimedStartTime
      ? { startTime: boardingLeg.expectedStartTime || boardingLeg.aimedStartTime }
      : {}),
  };
}

export function departureBoardContextFromSuggestion(
  suggestion?: TravelPlaceSuggestion,
): DepartureBoardContext | undefined {
  if (!suggestion) return undefined;
  const [lon, lat] = suggestion.coordinate;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return {
    scope: "origin",
    label: suggestion.label,
    center: { lat, lon },
  };
}

function selectedItineraryPositions(
  plan: TravelPlanPayload,
  selectedItineraryId?: string,
): [number, number][] {
  const positions =
    selectedItineraryForPlan(plan, selectedItineraryId)?.legs.flatMap((leg) =>
      latLngsFromLineString(leg.geometry),
    ) ?? [];
  return positions.length >= 2 ? positions : routePositions(plan);
}

function severityColor(severity: TrafficEventSeverity): string {
  switch (severity) {
    case "critical":
      return "#7f1d1d";
    case "high":
      return "#dc2626";
    case "medium":
      return "#d97706";
    default:
      return "#64748b";
  }
}

function strongestRouteImpact(plan: TravelPlanPayload): TrafficEventSeverity | undefined {
  return [...plan.trafficImpacts].sort(
    (left, right) => severityRank[right.severity] - severityRank[left.severity],
  )[0]?.severity;
}

function normaliseTransitText(value?: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function transitTextMatches(left?: string, right?: string): boolean {
  const normalisedLeft = normaliseTransitText(left);
  const normalisedRight = normaliseTransitText(right);
  if (!normalisedLeft || !normalisedRight) return false;
  return normalisedLeft === normalisedRight || normalisedLeft.includes(normalisedRight);
}

function isBoardingLeg(leg: TravelPlanLeg): boolean {
  if (leg.mode === "walk") return false;
  return Boolean(leg.publicCode || leg.lineId || leg.from.stopId || leg.from.stopName);
}

function boardingLegsForItinerary(itinerary?: TravelPlanItinerary): TravelPlanLeg[] {
  return itinerary?.legs.filter(isBoardingLeg) ?? [];
}

function firstBoardingLeg(itinerary?: TravelPlanItinerary): TravelPlanLeg | undefined {
  return boardingLegsForItinerary(itinerary)[0];
}

function legDepartureTime(leg?: TravelPlanLeg): string | undefined {
  return leg?.expectedStartTime || leg?.aimedStartTime;
}

function legLineLabel(leg?: TravelPlanLeg): string {
  if (!leg) return "Valgt avgang";
  const mode = modeLabel(leg.mode);
  return leg.publicCode ? `${mode} ${leg.publicCode}` : mode;
}

function legStopLabel(leg?: TravelPlanLeg): string {
  return leg?.from.stopName ?? leg?.from.name ?? "valgt startpunkt";
}

function scoreDepartureForLeg(departure: PublicTransportDeparture, leg: TravelPlanLeg): number {
  let score = 0;
  if (leg.serviceJourneyId && departure.serviceJourneyId === leg.serviceJourneyId) score += 12;
  if (departure.mode === leg.mode) score += 1;
  if (leg.lineId && departure.lineId === leg.lineId) score += 5;
  if (leg.publicCode && departure.publicCode === leg.publicCode) score += 4;
  if (leg.from.stopId && departure.stopId === leg.from.stopId) score += 5;
  if (
    transitTextMatches(departure.stopName, leg.from.stopName) ||
    transitTextMatches(departure.stopName, leg.from.name)
  ) {
    score += 3;
  }
  if (
    transitTextMatches(departure.destinationName, leg.to.stopName) ||
    transitTextMatches(departure.destinationName, leg.to.name)
  ) {
    score += 2;
  }

  const legStart = Date.parse(leg.expectedStartTime || leg.aimedStartTime);
  const departureStart = Date.parse(departure.expectedDepartureTime);
  if (Number.isFinite(legStart) && Number.isFinite(departureStart)) {
    const diffSeconds = Math.abs(departureStart - legStart) / 1000;
    if (diffSeconds <= 10 * 60) score += 4;
    else if (diffSeconds <= 20 * 60) score += 2;
    else if (diffSeconds > 45 * 60) score -= 3;
  }

  return score;
}

function selectedDepartureForLeg(
  leg: TravelPlanLeg,
  board?: PublicTransportDepartureBoardPayload,
): PublicTransportDeparture | undefined {
  let best: PublicTransportDeparture | undefined;
  let bestScore = 0;
  for (const departure of board?.departures ?? []) {
    const score = scoreDepartureForLeg(departure, leg);
    if (score > bestScore) {
      best = departure;
      bestScore = score;
    }
  }
  return bestScore >= 7 ? best : undefined;
}

export function selectedDepartureMatch(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
  board?: PublicTransportDepartureBoardPayload,
): SelectedDepartureMatch | undefined {
  const leg = firstBoardingLeg(selectedItineraryForPlan(plan, selectedItineraryId));
  if (!leg) return undefined;
  return {
    leg,
    departure: selectedDepartureForLeg(leg, board),
  };
}

export function routeDepartureCheckpoints(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
  limit = 3,
): RouteDepartureCheckpoint[] {
  const itinerary = selectedItineraryForPlan(plan, selectedItineraryId);
  if (!itinerary) return [];
  return boardingLegsForItinerary(itinerary)
    .slice(0, limit)
    .flatMap((leg, index) => {
      const [lon, lat] = leg.from.coordinate;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const stopLabel = legStopLabel(leg);
      return [
        {
          id: `${itinerary.id}:${leg.id}:${index}`,
          leg,
          index,
          label: index === 0 ? `Start: ${stopLabel}` : `Bytte ${index}: ${stopLabel}`,
          context: {
            scope: "origin",
            label: stopLabel,
            center: { lat, lon },
            ...(legDepartureTime(leg) ? { startTime: legDepartureTime(leg) } : {}),
          },
        },
      ];
    });
}

export function routeDepartureConfidenceItems(
  checkpoints: RouteDepartureCheckpoint[],
  results: RouteDepartureBoardResult[],
): RouteDepartureConfidenceItem[] {
  const resultByCheckpoint = new Map(results.map((result) => [result.checkpointId, result]));
  return checkpoints.map((checkpoint) => {
    const result = resultByCheckpoint.get(checkpoint.id);
    if (result?.error) {
      return {
        checkpoint,
        status: {
          label: "Sjekk AtB/Entur",
          detail: `Klarte ikke hente live-tavla for ${checkpoint.label.toLowerCase()}. Sjekk avgang og plattform hos AtB/Entur.`,
          severity: "warning",
        },
        board: result.board,
      };
    }
    const departure = selectedDepartureForLeg(checkpoint.leg, result?.board);
    return {
      checkpoint,
      departure,
      status: selectedDepartureStatus(departure, checkpoint.leg, result?.board),
      board: result?.board,
    };
  });
}

export function routeDepartureConfidenceSummary(
  items: RouteDepartureConfidenceItem[],
  fetchStatus: RouteDepartureBoardStatus,
): RouteDepartureConfidenceSummary {
  if (!items.length) {
    return {
      heading: "Reisekontroll",
      detail: "Ingen kollektivbein valgt ennå.",
      severity: "watch",
    };
  }
  if (fetchStatus === "loading") {
    return {
      heading: "Sjekker bytter",
      detail: "Henter live-tavler for start og byttepunkter i valgt reiseforslag.",
      severity: "watch",
    };
  }
  const warningCount = items.filter((item) => item.status.severity === "warning").length;
  const watchCount = items.filter((item) => item.status.severity === "watch").length;
  if (fetchStatus === "error" || warningCount > 0) {
    return {
      heading: "Sjekk byttene før du drar",
      detail: `${warningCount || items.length} av ${items.length} boardingpunkt trenger kontroll hos AtB/Entur før avreise.`,
      severity: "warning",
    };
  }
  if (fetchStatus === "partial" || watchCount > 0) {
    return {
      heading: "Følg med på byttene",
      detail: `${watchCount || 1} av ${items.length} boardingpunkt er ikke entydig live-bekreftet.`,
      severity: "watch",
    };
  }
  return {
    heading: "Reisen er live-sjekket",
    detail: `Alle ${items.length} boardingpunkt matcher live- eller rutetavla akkurat nå.`,
    severity: "ok",
  };
}

export function travelTimeComparisonLiveCheckFromRouteDepartureConfidence(
  items: RouteDepartureConfidenceItem[],
  fetchStatus: RouteDepartureBoardStatus,
): TravelTimeComparisonLiveCheck | undefined {
  if (fetchStatus === "idle" || fetchStatus === "loading" || !items.length) return undefined;
  const summary = routeDepartureConfidenceSummary(items, fetchStatus);
  if (summary.severity === "ok") return undefined;
  return summary;
}

function routeWatchSeverityFromNotice(
  severity?: TrafficEventSeverity | "info" | "warning",
): SelectedDepartureStatusSeverity {
  if (severity === "critical" || severity === "high" || severity === "warning") {
    return "warning";
  }
  if (severity === "medium") return "watch";
  return "watch";
}

function strongestRouteWatchSeverity(
  items: SelectedRouteWatchItem[],
): SelectedDepartureStatusSeverity {
  if (items.some((item) => item.severity === "warning")) return "warning";
  if (items.some((item) => item.severity === "watch")) return "watch";
  return "ok";
}

export function selectedRouteWatchSummary(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
  confidenceItems: RouteDepartureConfidenceItem[] = [],
  fetchStatus: RouteDepartureBoardStatus = "idle",
): SelectedRouteWatchSummary | undefined {
  const itinerary = selectedItineraryForPlan(plan, selectedItineraryId);
  if (!itinerary) return undefined;

  const watchItems: SelectedRouteWatchItem[] = [];
  for (const leg of itinerary.legs) {
    const lineLabel = legLineLabel(leg);
    if (leg.cancelled) {
      watchItems.push({
        id: `${leg.id}:cancelled`,
        label: `${lineLabel} er innstilt`,
        detail: `${legStopLabel(leg)} kl. ${formatTravelDateTime(leg.expectedStartTime)} må sjekkes hos AtB/Entur.`,
        severity: "warning",
        source: "Entur",
      });
    }
    if (leg.replacementTransport) {
      watchItems.push({
        id: `${leg.id}:replacement`,
        label: `${lineLabel}: alternativ transport`,
        detail: "Reiseforslaget inneholder alternativ transport. Beregn ekstra margin.",
        severity: "watch",
        source: "Entur",
      });
    }
    for (const notice of leg.notices) {
      watchItems.push({
        id: `${leg.id}:notice:${notice.id}`,
        label: `${lineLabel}: ${notice.title}`,
        detail: notice.detail ?? `Varsel fra ${notice.source}. Sjekk detaljene hos AtB/Entur.`,
        severity: routeWatchSeverityFromNotice(notice.severity),
        source: notice.source,
      });
    }
  }

  for (const item of confidenceItems) {
    if (item.status.severity === "ok") continue;
    watchItems.push({
      id: `${item.checkpoint.id}:live-board`,
      label: `${item.checkpoint.label}: ${item.status.label}`,
      detail: item.status.detail,
      severity: item.status.severity,
      source: "Live-tavle",
    });
  }

  if (fetchStatus === "loading") {
    return {
      heading: "Sjekker valgt reise",
      detail: "Nytt henter live-tavler for start og eventuelle bytter.",
      severity: "watch",
      items: watchItems.slice(0, 4),
    };
  }

  if (fetchStatus === "error" && confidenceItems.length === 0) {
    watchItems.push({
      id: `${itinerary.id}:live-board-error`,
      label: "Live-sjekk mangler",
      detail:
        "Klarte ikke sjekke live-tavler for valgt reise. Kontroller avgang og plattform hos AtB/Entur.",
      severity: "warning",
      source: "Live-tavle",
    });
  } else if (
    fetchStatus === "partial" &&
    !watchItems.some((item) => item.source === "Live-tavle")
  ) {
    watchItems.push({
      id: `${itinerary.id}:live-board-partial`,
      label: "Noen live-tavler mangler",
      detail: "Ikke alle boardingpunkt kunne live-sjekkes. Sjekk bytter hos AtB/Entur før du drar.",
      severity: "watch",
      source: "Live-tavle",
    });
  }

  if (!watchItems.length && (itinerary.decision === "watch" || itinerary.decision === "avoid")) {
    watchItems.push({
      id: `${itinerary.id}:decision`,
      label: itineraryDecisionLabel(itinerary.decision),
      detail: itinerary.decisionReason,
      severity: itinerary.decision === "avoid" ? "warning" : "watch",
      source: "Entur",
    });
  }

  if (!watchItems.length) {
    return {
      heading: "Valgt reise ser rolig ut",
      detail: `${formatTravelDateTime(itinerary.departureTime)} til ${formatTravelDateTime(
        itinerary.arrivalTime,
      )}. Nytt fant ingen konkrete avvik på valgt reiseforslag akkurat nå.`,
      severity: "ok",
      items: [],
    };
  }

  watchItems.sort(
    (left, right) =>
      departureStatusRank[right.severity] - departureStatusRank[left.severity] ||
      left.label.localeCompare(right.label, "nb"),
  );
  const severity = strongestRouteWatchSeverity(watchItems);
  return {
    heading: severity === "warning" ? "Sjekk dette før avreise" : "Følg med på valgt reise",
    detail: `${watchItems.length} ${watchItems.length === 1 ? "punkt" : "punkter"} kan påvirke reiseforslaget.`,
    severity,
    items: watchItems.slice(0, 4),
  };
}

const comparisonDecisionPenalty: Record<TravelPlanItinerary["decision"], number> = {
  best: 0,
  good: 4,
  watch: 26,
  avoid: 90,
};

const comparisonSeverityPenalty: Record<SelectedDepartureStatusSeverity, number> = {
  ok: 0,
  watch: 22,
  warning: 70,
};

function strongestDepartureSeverity(
  left: SelectedDepartureStatusSeverity,
  right?: SelectedDepartureStatusSeverity,
): SelectedDepartureStatusSeverity {
  if (!right) return left;
  return departureStatusRank[right] > departureStatusRank[left] ? right : left;
}

function comparisonBestItinerary(plan?: TravelPlanPayload): TravelPlanItinerary | undefined {
  return (
    plan?.itineraries.find((itinerary) => itinerary.labels.includes("best_now")) ??
    plan?.itineraries[0]
  );
}

function comparisonLineSummary(itinerary?: TravelPlanItinerary): string {
  if (!itinerary) return "Sjekk AtB/Entur";
  const labels = boardingLegsForItinerary(itinerary).map(legLineLabel);
  if (labels.length) {
    const visible = labels.slice(0, 3).join(" + ");
    return labels.length > 3 ? `${visible} + ${labels.length - 3} til` : visible;
  }
  return itinerary.modes.includes("walk") ? "Gange" : "Kollektiv";
}

function comparisonOptionSeverity(
  plan: TravelPlanPayload,
  itinerary?: TravelPlanItinerary,
): SelectedDepartureStatusSeverity {
  const roadImpact = strongestRouteImpact(plan);
  const hasTransitAlert = plan.publicTransportSuggestions.some(
    (suggestion) => suggestion.kind === "alert",
  );
  const routeSeverity: SelectedDepartureStatusSeverity =
    plan.journeyPlanner.status === "unavailable" ||
    roadImpact === "critical" ||
    roadImpact === "high" ||
    itinerary?.decision === "avoid"
      ? "warning"
      : plan.journeyPlanner.status === "empty" ||
          roadImpact === "medium" ||
          hasTransitAlert ||
          itinerary?.decision === "watch"
        ? "watch"
        : "ok";
  const watchSeverity = selectedRouteWatchSummary(plan, itinerary?.id)?.severity ?? "watch";
  if (routeSeverity === "warning" || watchSeverity === "warning") return "warning";
  if (routeSeverity === "watch" || watchSeverity === "watch") return "watch";
  return "ok";
}

function comparisonOptionScore(
  source: TravelPlanComparisonSource,
  severity: SelectedDepartureStatusSeverity,
  itinerary?: TravelPlanItinerary,
): number {
  if (source.error) return 100_000;
  if (!source.plan) return 99_000;
  const noItineraryPenalty = itinerary ? 0 : 1_000;
  const journeyStatusPenalty =
    source.plan.journeyPlanner.status === "unavailable"
      ? 4_000
      : source.plan.journeyPlanner.status === "empty"
        ? 1_800
        : 0;
  const durationMinutes = itinerary ? Math.round(itinerary.durationSeconds / 60) : 180;
  const transferPenalty = (itinerary?.transferCount ?? 3) * 8;
  const disruptionPenalty = (itinerary?.disruptionCount ?? 0) * 9;
  const decisionPenalty = itinerary ? comparisonDecisionPenalty[itinerary.decision] : 0;
  return (
    comparisonSeverityPenalty[severity] +
    noItineraryPenalty +
    journeyStatusPenalty +
    durationMinutes +
    transferPenalty +
    disruptionPenalty +
    decisionPenalty
  );
}

function comparisonOptionFromSource(
  source: TravelPlanComparisonSource,
  activePreset: TravelPlanComparisonPreset,
  liveCheck?: TravelTimeComparisonLiveCheck,
): TravelTimeComparisonOption {
  const label = travelTimePresetLabel(source.preset);
  const liveCheckApplies = source.preset === activePreset && liveCheck?.severity !== "ok";
  if (source.error || !source.plan) {
    const error = source.error ?? "Reisesøket svarte ikke.";
    return {
      preset: source.preset,
      label,
      status: "error",
      severity: "warning",
      score: comparisonOptionScore(source, "warning"),
      recommended: false,
      active: source.preset === activePreset,
      departureLabel: label,
      lineSummary: "Sjekk AtB/Entur",
      summary: "Kunne ikke sammenligne",
      detail: error,
    };
  }

  const itinerary = comparisonBestItinerary(source.plan);
  const routeSeverity = comparisonOptionSeverity(source.plan, itinerary);
  const severity = liveCheckApplies
    ? strongestDepartureSeverity(routeSeverity, liveCheck?.severity)
    : routeSeverity;
  const status =
    source.plan.journeyPlanner.status === "unavailable"
      ? "unavailable"
      : itinerary
        ? "available"
        : "empty";
  const routeDecision = travelPlanDecision(source.plan);
  const watchSummary = itinerary ? selectedRouteWatchSummary(source.plan, itinerary.id) : undefined;
  const departureLabel = itinerary
    ? formatTravelDateTime(itinerary.departureTime)
    : travelTimePresetLabel(source.preset);
  const arrivalLabel = itinerary ? formatTravelDateTime(itinerary.arrivalTime) : undefined;
  const durationLabel = itinerary ? formatDuration(itinerary.durationSeconds) : undefined;
  const transferCount = itinerary?.transferCount ?? 0;
  const transferLabel = itinerary
    ? transferCount === 0
      ? "Direkte"
      : `${transferCount} ${transferCount === 1 ? "bytte" : "bytter"}`
    : undefined;

  return {
    preset: source.preset,
    label,
    status,
    severity,
    score: comparisonOptionScore(source, severity, itinerary),
    recommended: false,
    active: source.preset === activePreset,
    departureLabel,
    arrivalLabel,
    durationLabel,
    transferLabel,
    lineSummary: comparisonLineSummary(itinerary),
    summary:
      status === "available"
        ? `${departureLabel}${arrivalLabel ? `-${arrivalLabel}` : ""}`
        : routeDecision.heading,
    detail:
      liveCheckApplies && liveCheck
        ? `Live-sjekk av valgt avreise: ${liveCheck.detail}`
        : watchSummary && watchSummary.severity !== "ok"
          ? watchSummary.detail
          : itinerary
            ? itinerary.decisionReason
            : routeDecision.detail,
  };
}

export function buildTravelTimeComparisonModel(
  sources: TravelPlanComparisonSource[],
  activePreset: TravelPlanComparisonPreset,
  liveCheck?: TravelTimeComparisonLiveCheck,
): TravelTimeComparisonModel {
  const byPreset = new Map(sources.map((source) => [source.preset, source]));
  const options = travelTimeComparisonPresets.map((preset) =>
    comparisonOptionFromSource(
      byPreset.get(preset) ?? {
        preset,
        error: "Reisesøket er ikke hentet ennå.",
      },
      activePreset,
      liveCheck,
    ),
  );
  const activeOption = options.find((option) => option.preset === activePreset);
  const bestOption = [...options].sort((left, right) => {
    const scoreDelta = left.score - right.score;
    if (scoreDelta !== 0) return scoreDelta;
    return (
      travelTimeComparisonPresets.indexOf(left.preset) -
      travelTimeComparisonPresets.indexOf(right.preset)
    );
  })[0];
  const scoreMargin = activeOption
    ? activeOption.score - (bestOption?.score ?? activeOption.score)
    : 0;
  const recommendedOption =
    bestOption && (!activeOption || bestOption.preset === activePreset || scoreMargin >= 8)
      ? bestOption
      : activeOption;
  if (recommendedOption) {
    recommendedOption.recommended = true;
  }

  const allFailed = options.every((option) => option.status === "error");
  const activeLiveNeedsCheck = liveCheck && liveCheck.severity !== "ok";
  const recommendedLater = recommendedOption?.preset && recommendedOption.preset !== activePreset;
  return {
    status: allFailed
      ? "error"
      : options.some((option) => option.status === "error")
        ? "partial"
        : "ready",
    heading:
      activeLiveNeedsCheck && !recommendedLater
        ? "Sjekk valgt avreise"
        : recommendedLater
          ? `Vent til ${travelTimePresetLabel(recommendedOption.preset).toLowerCase()} kan være bedre`
          : activePreset === "now"
            ? "Dra nå ser best ut"
            : "Valgt avreise ser best ut",
    detail:
      activeLiveNeedsCheck && recommendedLater
        ? "Live-sjekken for valgt reise gir usikkerhet. En senere Entur-sammenligning kan gi bedre margin, men sjekk AtB/Entur før avreise."
        : activeLiveNeedsCheck
          ? "Valgt reise trenger ekstra sjekk i live-tavla. Andre tider er lett Entur-sammenligning, ikke full live-bekreftelse."
          : recommendedLater
            ? "Sammenligningen fant et senere reiseforslag med bedre margin eller mindre usikkerhet."
            : "Nytt fant ikke et senere alternativ som tydelig slår valgt avreise.",
    recommendedPreset: recommendedOption?.preset,
    options,
  };
}

const routeChoiceKindOrder: RouteChoiceKind[] = [
  "recommended",
  "fastest",
  "fewest_transfers",
  "robust",
];

const routeChoiceKindLabel: Record<RouteChoiceKind, string> = {
  recommended: "Anbefalt",
  fastest: "Raskest",
  fewest_transfers: "Færrest bytter",
  robust: "Mest robust",
};

function itineraryTransferLabel(itinerary: TravelPlanItinerary): string {
  return itinerary.transferCount === 0
    ? "Direkte"
    : `${itinerary.transferCount} ${itinerary.transferCount === 1 ? "bytte" : "bytter"}`;
}

function itineraryChoiceSeverity(input: {
  plan: TravelPlanPayload;
  itinerary: TravelPlanItinerary;
  selectedItineraryId?: string;
  departureBoard?: PublicTransportDepartureBoardPayload;
  confidenceItems?: RouteDepartureConfidenceItem[];
  fetchStatus?: RouteDepartureBoardStatus;
  liveStatuses?: Record<string, SelectedDepartureStatus>;
}): { severity: SelectedDepartureStatusSeverity; detail: string } {
  const selected = input.itinerary.id === input.selectedItineraryId;
  const watchSummary = selectedRouteWatchSummary(
    input.plan,
    input.itinerary.id,
    selected ? (input.confidenceItems ?? []) : [],
    selected ? (input.fetchStatus ?? "idle") : "idle",
  );
  let severity = watchSummary?.severity ?? "ok";
  let detail =
    watchSummary && watchSummary.severity !== "ok"
      ? watchSummary.detail
      : selected
        ? input.itinerary.decisionReason
        : "Velg for live-sjekk av start og eventuelle bytter.";

  const knownLiveStatus = input.liveStatuses?.[input.itinerary.id];
  if (knownLiveStatus) {
    severity = strongestDepartureSeverity(severity, knownLiveStatus.severity);
    if (knownLiveStatus.severity !== "ok") {
      detail = `Live-tavle: ${knownLiveStatus.detail}`;
    } else if (selected && watchSummary?.severity === "ok") {
      detail = `Live-tavle: ${knownLiveStatus.detail}`;
    }
  }

  if (selected && input.departureBoard) {
    const departureMatch = selectedDepartureMatch(
      input.plan,
      input.itinerary.id,
      input.departureBoard,
    );
    if (departureMatch) {
      const departureStatus = selectedDepartureStatus(
        departureMatch.departure,
        departureMatch.leg,
        input.departureBoard,
      );
      severity = strongestDepartureSeverity(severity, departureStatus.severity);
      detail =
        departureStatus.severity === "ok" && watchSummary?.severity === "ok"
          ? `Live-tavle: ${departureStatus.detail}`
          : departureStatus.severity !== "ok"
            ? `Live-tavle: ${departureStatus.detail}`
            : detail;
    }
  }

  return { severity, detail };
}

function routeChoiceScore(
  itinerary: TravelPlanItinerary,
  severity: SelectedDepartureStatusSeverity,
): number {
  return (
    Math.round(itinerary.durationSeconds / 60) +
    Math.round(itinerary.walkTimeSeconds / 300) +
    itinerary.transferCount * 8 +
    itinerary.disruptionCount * 14 +
    comparisonDecisionPenalty[itinerary.decision] +
    comparisonSeverityPenalty[severity] +
    (itinerary.realtime ? 0 : 4)
  );
}

function routeChoiceRobustScore(
  itinerary: TravelPlanItinerary,
  severity: SelectedDepartureStatusSeverity,
): number {
  return (
    comparisonSeverityPenalty[severity] * 2 +
    comparisonDecisionPenalty[itinerary.decision] * 2 +
    itinerary.transferCount * 18 +
    itinerary.disruptionCount * 24 +
    Math.round(itinerary.durationSeconds / 240) +
    Math.round(itinerary.walkTimeSeconds / 300) +
    (itinerary.realtime ? 0 : 8)
  );
}

function sortedItineraries(
  itineraries: TravelPlanItinerary[],
  scoreFor: (itinerary: TravelPlanItinerary) => number,
): TravelPlanItinerary[] {
  return [...itineraries].sort((left, right) => {
    const scoreDelta = scoreFor(left) - scoreFor(right);
    if (scoreDelta !== 0) return scoreDelta;
    return (
      Date.parse(left.departureTime) - Date.parse(right.departureTime) ||
      left.id.localeCompare(right.id, "nb")
    );
  });
}

export function buildRouteChoiceModel(input: {
  plan?: TravelPlanPayload;
  selectedItineraryId?: string;
  departureBoard?: PublicTransportDepartureBoardPayload;
  confidenceItems?: RouteDepartureConfidenceItem[];
  fetchStatus?: RouteDepartureBoardStatus;
  liveStatuses?: Record<string, SelectedDepartureStatus>;
}): RouteChoiceModel | undefined {
  const plan = input.plan;
  const itineraries = plan?.itineraries ?? [];
  if (!plan || !itineraries.length) return undefined;

  const evaluated = new Map(
    itineraries.map((itinerary) => {
      const choice = itineraryChoiceSeverity({
        plan,
        itinerary,
        selectedItineraryId: input.selectedItineraryId,
        departureBoard: input.departureBoard,
        confidenceItems: input.confidenceItems,
        fetchStatus: input.fetchStatus,
        liveStatuses: input.liveStatuses,
      });
      return [
        itinerary.id,
        {
          itinerary,
          severity: choice.severity,
          detail: choice.detail,
          score: routeChoiceScore(itinerary, choice.severity),
          robustScore: routeChoiceRobustScore(itinerary, choice.severity),
        },
      ];
    }),
  );
  const evaluatedFor = (itinerary: TravelPlanItinerary) => evaluated.get(itinerary.id)!;
  const recommendedItinerary = sortedItineraries(itineraries, (itinerary) => {
    const item = evaluatedFor(itinerary);
    return item.score;
  })[0]!;
  const fastestItinerary = sortedItineraries(itineraries, (itinerary) =>
    Math.round(itinerary.durationSeconds / 60),
  )[0]!;
  const fewestTransfersItinerary =
    itineraries.find((itinerary) => itinerary.labels.includes("fewest_transfers")) ??
    sortedItineraries(
      itineraries,
      (itinerary) => itinerary.transferCount * 30 + Math.round(itinerary.durationSeconds / 60),
    )[0]!;
  const robustItinerary =
    itineraries.find((itinerary) => itinerary.labels.includes("most_robust")) ??
    sortedItineraries(itineraries, (itinerary) => evaluatedFor(itinerary).robustScore)[0]!;
  const itineraryByKind: Record<RouteChoiceKind, TravelPlanItinerary> = {
    recommended: recommendedItinerary,
    fastest: fastestItinerary,
    fewest_transfers: fewestTransfersItinerary,
    robust: robustItinerary,
  };

  const recommendedId = recommendedItinerary.id;
  const options = routeChoiceKindOrder.map((kind): RouteChoiceOption => {
    const itinerary = itineraryByKind[kind];
    const item = evaluatedFor(itinerary);
    return {
      kind,
      label: routeChoiceKindLabel[kind],
      itineraryId: itinerary.id,
      selected: itinerary.id === input.selectedItineraryId,
      recommended: itinerary.id === recommendedId,
      severity: item.severity,
      score: item.score,
      summary: `${formatTravelDateTime(itinerary.departureTime)}-${formatTravelDateTime(
        itinerary.arrivalTime,
      )}`,
      lineSummary: comparisonLineSummary(itinerary),
      detail: item.detail,
      meta: [
        formatDuration(itinerary.durationSeconds),
        itineraryTransferLabel(itinerary),
        `${formatDuration(itinerary.walkTimeSeconds)} gange`,
        comparisonSeverityLabel(item.severity),
      ].join(" · "),
    };
  });

  const selectedOption = options.find((option) => option.selected);
  const recommendedOption = options.find((option) => option.kind === "recommended") ?? options[0];
  return {
    heading:
      recommendedOption?.itineraryId === input.selectedItineraryId
        ? "Valgt reiseforslag ser best ut"
        : "Et annet reiseforslag ser tryggere ut",
    detail: selectedOption?.selected
      ? selectedOption.detail
      : "Nytt sammenligner reiseforslagene med varsel, bytter, reisetid og live-tavla for valgt avreise.",
    recommendedItineraryId: recommendedId,
    options,
  };
}

export function travelPlanDecision(plan?: TravelPlanPayload): {
  heading: string;
  detail: string;
  roadImpactCount: number;
  vehicleCount: number;
  alertCount: number;
  itineraryCount: number;
  severity: "ok" | "watch" | "warning";
} {
  if (!plan) {
    return {
      heading: "Planlegg reisen",
      detail:
        "Skriv start og mål for å se vegmeldinger, reisetidskorridorer og kollektivavvik langs ruten.",
      roadImpactCount: 0,
      vehicleCount: 0,
      alertCount: 0,
      itineraryCount: 0,
      severity: "watch",
    };
  }

  const roadImpactCount = plan.trafficImpacts.length;
  const vehicleCount = plan.publicTransportSuggestions.filter(
    (suggestion) => suggestion.kind === "vehicle",
  ).length;
  const alertCount = plan.publicTransportSuggestions.filter(
    (suggestion) => suggestion.kind === "alert",
  ).length;
  const itineraryCount = plan.itineraries.length;
  const strongestRoadImpact = strongestRouteImpact(plan);
  const hasHighRoadImpact = strongestRoadImpact === "critical" || strongestRoadImpact === "high";
  const avoidCount = plan.itineraries.filter((itinerary) => itinerary.decision === "avoid").length;
  const watchCount = plan.itineraries.filter((itinerary) => itinerary.decision === "watch").length;

  if (plan.journeyPlanner.status === "unavailable") {
    return {
      heading: "Sjekk AtB/Entur før du drar",
      detail: `${plan.journeyPlanner.detail} Nytt viser fortsatt vegmeldinger og kjente kollektivavvik langs ruten.`,
      roadImpactCount,
      vehicleCount,
      alertCount,
      itineraryCount,
      severity: "warning",
    };
  }

  if (
    plan.journeyPlanner.status === "empty" &&
    itineraryCount === 0 &&
    roadImpactCount === 0 &&
    alertCount === 0
  ) {
    return {
      heading: "Ingen konkrete Entur-reiser funnet",
      detail:
        "Nytt fant ingen Entur-forslag for valgt tidspunkt. Sjekk AtB/Entur for alternativer før avreise.",
      roadImpactCount,
      vehicleCount,
      alertCount,
      itineraryCount,
      severity: roadImpactCount > 0 || alertCount > 0 ? "warning" : "watch",
    };
  }

  if (avoidCount > 0 || hasHighRoadImpact || alertCount > 0 || watchCount > 0) {
    return {
      heading: "Sjekk ruten før du drar",
      detail:
        itineraryCount > 0
          ? `${itineraryCount} reiseforslag funnet. ${avoidCount + watchCount} bør sjekkes ekstra før avreise.`
          : `${roadImpactCount} vegmelding${roadImpactCount === 1 ? "" : "er"} og ${alertCount} kollektivavvik kan påvirke reisen.`,
      roadImpactCount,
      vehicleCount,
      alertCount,
      itineraryCount,
      severity: "warning",
    };
  }

  if (roadImpactCount > 0 || vehicleCount > 0 || itineraryCount > 0) {
    return {
      heading: "Følg med på ruten",
      detail:
        itineraryCount > 0
          ? `${itineraryCount} reiseforslag fra Entur. Nytt fant ingen alvorlige avvik på de beste alternativene.`
          : `${roadImpactCount} vegmelding${roadImpactCount === 1 ? "" : "er"} og ${vehicleCount} kollektivkjøretøy er funnet nær korridoren.`,
      roadImpactCount,
      vehicleCount,
      alertCount,
      itineraryCount,
      severity: "watch",
    };
  }

  return {
    heading: "Ingen kjente hindringer langs ruten",
    detail: "Nytt fant ingen aktive vegmeldinger eller kollektivavvik langs korridoren akkurat nå.",
    roadImpactCount,
    vehicleCount,
    alertCount,
    itineraryCount,
    severity: "ok",
  };
}

export type RouteContextItem = {
  id: string;
  kind: "traffic" | "transit_alert";
  title: string;
  detail: string;
  source: string;
  severity: "ok" | "watch" | "warning";
  distanceLabel?: string;
  eventId?: string;
  suggestionId?: string;
  href?: string;
  focusable: boolean;
};

export type RouteContextSummary = {
  count: number;
  mapPointCount: number;
  blockingCount: number;
  heading: string;
  detail: string;
  items: RouteContextItem[];
};

function routeContextSeverityFromTraffic(severity?: string): RouteContextItem["severity"] {
  if (severity === "high" || severity === "critical") return "warning";
  if (severity === "medium") return "watch";
  return "ok";
}

function routeContextSourceLabel(source: string): string {
  const normalized = source.toLocaleLowerCase("nb");
  if (normalized === "datex" || normalized.includes("datex")) return "DATEX";
  if (normalized.includes("vegvesen")) return "Statens vegvesen";
  if (normalized.includes("entur")) return "Entur";
  return source;
}

function routeContextDistanceLabel(distanceMeters?: number): string | undefined {
  if (distanceMeters === undefined) return undefined;
  return `${formatDistance(distanceMeters)} fra ruten`;
}

function routeContextCountLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "er"}`;
}

export function eventIdForRouteContextItem(item: RouteContextItem): string | undefined {
  return item.kind === "traffic" && item.focusable ? item.eventId : undefined;
}

export function buildRouteContextSummary(plan?: TravelPlanPayload): RouteContextSummary {
  const trafficItems: RouteContextItem[] = (plan?.trafficImpacts ?? []).map((impact) => ({
    id: `traffic:${impact.event.id}`,
    kind: "traffic",
    title: impact.event.title,
    detail:
      impact.summary ||
      impact.event.description ||
      impact.event.roadName ||
      "Trafikkhendelse langs valgt rute.",
    source: routeContextSourceLabel(impact.event.source),
    severity: routeContextSeverityFromTraffic(impact.severity),
    distanceLabel: routeContextDistanceLabel(impact.distanceMeters),
    eventId: impact.event.id,
    focusable: true,
  }));

  const alertItems: RouteContextItem[] = (plan?.publicTransportSuggestions ?? [])
    .filter((suggestion) => suggestion.kind === "alert")
    .map((suggestion) => ({
      id: `transit_alert:${suggestion.id}`,
      kind: "transit_alert",
      title: suggestion.title,
      detail: suggestion.detail,
      source: routeContextSourceLabel(suggestion.source),
      severity: "watch",
      distanceLabel: routeContextDistanceLabel(suggestion.distanceMeters),
      suggestionId: suggestion.id,
      href: suggestion.href,
      focusable: false,
    }));

  const items = [...trafficItems, ...alertItems];
  const count = items.length;
  const mapPointCount = items.filter((item) => item.focusable).length;
  const blockingCount = items.filter((item) => item.severity === "warning").length;

  if (!count) {
    return {
      count: 0,
      mapPointCount: 0,
      blockingCount: 0,
      heading: "Ingen kartpunkter langs valgt rute",
      detail: "Nytt fant ingen trafikkpunkter langs valgt rute akkurat nå.",
      items: [],
    };
  }

  const textFallbackCount = count - mapPointCount;
  return {
    count,
    mapPointCount,
    blockingCount,
    heading:
      mapPointCount > 0
        ? `${routeContextCountLabel(count, "punkt")} langs valgt rute`
        : `${routeContextCountLabel(count, "tekstpunkt")} i kompakt fallback`,
    detail:
      mapPointCount > 0
        ? textFallbackCount > 0
          ? `Kartet viser plassering av ${routeContextCountLabel(mapPointCount, "kartpunkt")}. ${routeContextCountLabel(textFallbackCount, "punkt")} vises som kompakt tekstfallback uten kartpunkter.`
          : `Kartet viser plassering av ${routeContextCountLabel(mapPointCount, "kartpunkt")} som bør vurderes underveis.`
        : "Dette er en kompakt tekstfallback uten kartpunkter.",
    items,
  };
}

export function RouteContextFallback({
  summary,
  onFocusItem,
  selectedEventId,
}: {
  summary: RouteContextSummary;
  onFocusItem?: (item: RouteContextItem) => void;
  selectedEventId?: string;
}) {
  if (summary.count === 0) {
    return (
      <p className="route-context-empty">
        Ingen aktive trafikkpunkter funnet langs valgt rute akkurat nå.
      </p>
    );
  }

  return (
    <details className="route-context-fallback">
      <summary>
        <span>{summary.mapPointCount > 0 ? "Kartpunkter langs valgt rute" : "Tekstfallback for valgt rute"}</span>
        <strong>{summary.heading}</strong>
      </summary>
      <p>{summary.detail}</p>
      <ol>
        {summary.items.map((item, index) => (
          <li
            key={item.id}
            className={`route-context-fallback-item route-context-${item.severity}`}
          >
            {(() => {
              const meta = [item.distanceLabel, item.source].filter(Boolean).join(" · ");
              if (item.focusable) {
                return (
                  <button
                    type="button"
                    aria-pressed={item.eventId && selectedEventId === item.eventId ? "true" : undefined}
                    onClick={() => onFocusItem?.(item)}
                  >
                    <span>{index + 1}</span>
                    <strong>{item.title}</strong>
                    <small>{meta}</small>
                  </button>
                );
              }
              const safeHref = item.href ? safeExternalUrl(item.href) : undefined;
              if (safeHref) {
                return (
                  <a href={safeHref} target="_blank" rel="noreferrer noopener">
                    <span>{index + 1}</span>
                    <strong>{item.title}</strong>
                    <small>{meta}</small>
                  </a>
                );
              }
              return (
                <div className="route-context-fallback-static">
                  <span>{index + 1}</span>
                  <strong>{item.title}</strong>
                  <small>{meta}</small>
                </div>
              );
            })()}
          </li>
        ))}
      </ol>
    </details>
  );
}

function trafficEventListCopy(
  selectedPreset: TrafficMapPreset,
  showAll: boolean,
): { heading: string; emptyMessage: string } {
  if (selectedPreset === "planned") {
    return {
      heading: "Planlagte trafikksituasjoner",
      emptyMessage: "Ingen planlagte hendelser i valgt kartutsnitt.",
    };
  }
  if (showAll) {
    return {
      heading: "Alle trafikkmeldinger",
      emptyMessage: "Ingen trafikkmeldinger i valgt kartutsnitt.",
    };
  }
  return {
    heading: "Aktive trafikksituasjoner",
    emptyMessage:
      "Ingen aktive hendelser i valgt kartutsnitt. Prøv å zoome ut eller slå på “Vis alle”.",
  };
}

function TravelPlanLayer({
  plan,
  selectedItineraryId,
}: {
  plan?: TravelPlanPayload;
  selectedItineraryId?: string;
}) {
  if (!plan) return null;
  const positions = routePositions(plan);
  const origin = latLngFromGeoJsonPosition(plan.origin.coordinate);
  const destination = latLngFromGeoJsonPosition(plan.destination.coordinate);
  const routeSeverity = strongestRouteImpact(plan);
  const selectedItinerary =
    plan.itineraries.find((itinerary) => itinerary.id === selectedItineraryId) ??
    plan.itineraries[0];
  return (
    <>
      {positions.length >= 2 ? (
        <Polyline
          positions={positions}
          pathOptions={{
            color: routeSeverity ? severityColor(routeSeverity) : "#2563eb",
            weight: routeSeverity ? 7 : 5,
            opacity: routeSeverity ? 0.88 : 0.78,
            dashArray: routeSeverity ? "10 4" : "8 8",
            className: `travel-plan-route${routeSeverity ? ` travel-plan-route-${routeSeverity}` : ""}`,
          }}
        >
          <Popup>
            <article className="traffic-popup">
              <strong>
                Rute: {plan.origin.label} → {plan.destination.label}
              </strong>
              <p>
                {plan.trafficImpacts.length
                  ? `${plan.trafficImpacts.length} trafikkhendelser langs korridoren.`
                  : "Ingen trafikkhendelser langs ruten akkurat nå."}
              </p>
            </article>
          </Popup>
        </Polyline>
      ) : null}
      {selectedItinerary?.legs.map((leg) => {
        const legPositions = latLngsFromLineString(leg.geometry);
        if (legPositions.length < 2) return null;
        return (
          <Polyline
            key={leg.id}
            positions={legPositions}
            pathOptions={{
              color: leg.mode === "walk" ? "#64748b" : "#0f766e",
              weight: leg.mode === "walk" ? 3 : 6,
              opacity: leg.mode === "walk" ? 0.55 : 0.82,
              dashArray: leg.mode === "walk" ? "3 6" : undefined,
            }}
          />
        );
      })}
      {origin ? (
        <CircleMarker center={origin} radius={7} pathOptions={{ color: "#16a34a" }}>
          <Popup>{plan.origin.label}</Popup>
        </CircleMarker>
      ) : null}
      {destination ? (
        <CircleMarker center={destination} radius={7} pathOptions={{ color: "#dc2626" }}>
          <Popup>{plan.destination.label}</Popup>
        </CircleMarker>
      ) : null}
    </>
  );
}

function CorridorImpactLayer({
  impacts = [],
  selectedImpactId,
  onSelectImpact,
}: {
  impacts?: TrafficCorridorImpact[];
  selectedImpactId?: string;
  onSelectImpact: (impactId?: string) => void;
}) {
  return (
    <>
      {impacts.flatMap((impact) => {
        const positions = latLngsFromLineString(impact.geometry);
        if (positions.length < 2) return [];
        const selected = impact.id === selectedImpactId;
        const delayed = (impact.travelTime?.delaySeconds ?? 0) > 0;
        return [
          <Polyline
            key={impact.id}
            positions={positions}
            pathOptions={{
              color: selected ? "#19549a" : severityColor(impact.highestSeverity),
              weight: selected ? 8 : delayed || impact.eventCount > 0 ? 6 : 4,
              opacity: selected ? 0.95 : delayed || impact.eventCount > 0 ? 0.72 : 0.38,
              dashArray: impact.eventCount > 0 || delayed ? undefined : "7 7",
              className: `traffic-corridor traffic-corridor-${impact.highestSeverity}${selected ? " selected" : ""}`,
            }}
            eventHandlers={{ click: () => onSelectImpact(selected ? undefined : impact.id) }}
          >
            <Popup>
              <article className="traffic-popup">
                <strong>{impact.name}</strong>
                <p>
                  {impact.eventCount} hendelser · {impact.bufferMeters} m korridorbuffer
                </p>
                {impact.travelTime?.delaySeconds ? (
                  <p>
                    {Math.max(1, Math.round(impact.travelTime.delaySeconds / 60))} min forsinkelse
                  </p>
                ) : null}
              </article>
            </Popup>
          </Polyline>,
        ];
      })}
    </>
  );
}

function TrafficMapFocus({
  selectedEvent,
  travelPlan,
  selectedItineraryId,
}: {
  selectedEvent?: TrafficMapEvent;
  travelPlan?: TravelPlanPayload;
  selectedItineraryId?: string;
}) {
  const map = useMap();
  const selectedEventFocusKey = selectedEvent?.id;
  const selectedEventGeometryKey = selectedEvent ? JSON.stringify(selectedEvent.geometry) : "";
  const selectedEventBounds = useMemo(
    () => (selectedEvent ? boundsFromGeometry(selectedEvent.geometry) : undefined),
    [selectedEventFocusKey, selectedEventGeometryKey],
  );
  const travelPlanFocusKey = travelPlan
    ? `${travelPlan.generatedAt}:${travelPlan.origin.label}:${travelPlan.destination.label}:${selectedItineraryId ?? ""}`
    : undefined;
  const travelPlanRouteKey = travelPlan
    ? selectedItineraryPositions(travelPlan, selectedItineraryId)
        .map((position) => position.join(","))
        .join("|")
    : "";
  const travelPlanBounds = useMemo(
    () =>
      travelPlan
        ? boundsFromLatLngs(selectedItineraryPositions(travelPlan, selectedItineraryId))
        : undefined,
    [travelPlanFocusKey, travelPlanRouteKey],
  );

  useEffect(() => {
    if (selectedEventBounds) {
      if (
        selectedEventBounds[0][0] === selectedEventBounds[1][0] &&
        selectedEventBounds[0][1] === selectedEventBounds[1][1]
      ) {
        map.flyTo(selectedEventBounds[0], Math.max(map.getZoom(), 13), { duration: 0.35 });
      } else {
        map.fitBounds(selectedEventBounds, { padding: [32, 32], maxZoom: 15 });
      }
      return;
    }
    if (travelPlanBounds) {
      map.fitBounds(travelPlanBounds, { padding: [32, 32], maxZoom: 14 });
    }
  }, [map, selectedEventBounds, selectedEventFocusKey, travelPlanBounds, travelPlanFocusKey]);

  return null;
}

function SelectedRouteWatchPanel({ summary }: { summary?: SelectedRouteWatchSummary }) {
  if (!summary) return null;
  return (
    <section
      className={`selected-route-watch selected-route-watch-${summary.severity}`}
      aria-label="Dette kan påvirke valgt reise"
    >
      <header>
        <div>
          <p className="label">Valgt reise</p>
          <h3>{summary.heading}</h3>
          <p>{summary.detail}</p>
        </div>
        <span>{summary.items.length ? `${summary.items.length} punkt` : "OK"}</span>
      </header>
      {summary.items.length ? (
        <ul>
          {summary.items.map((item) => (
            <li key={item.id} className={`selected-route-watch-item-${item.severity}`}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
              <small>{item.source}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="selected-route-watch-clear">
          Fortsett likevel å sjekke AtB/Entur rett før avreise.
        </p>
      )}
    </section>
  );
}

function TravelTimeComparisonPanel({
  state,
  activePreset,
  onSelectPreset,
}: {
  state: TravelTimeComparisonState;
  activePreset: TravelTimePreset;
  onSelectPreset: (preset: TravelTimePreset) => void;
}) {
  if (state.status === "idle" || (!state.model && state.status !== "loading")) return null;
  const model = state.model;
  return (
    <section
      className={`travel-time-comparison travel-time-comparison-${model?.status ?? state.status}`}
      aria-label="Dra nå eller vent"
    >
      <header>
        <div>
          <p className="label">Tidsvalg</p>
          <h3>Dra nå eller vent?</h3>
          <p>
            {model
              ? model.detail
              : "Nytt sammenligner de neste avgangsvinduene uten å endre valgt reise."}
          </p>
        </div>
        <span>{state.status === "loading" ? "Sjekker" : model?.heading}</span>
      </header>
      {model ? (
        <div className="travel-time-comparison-grid">
          {model.options.map((option) => (
            <button
              key={option.preset}
              type="button"
              className={`travel-time-option travel-time-option-${option.severity}${
                option.recommended ? " recommended" : ""
              }${option.active ? " active" : ""}`}
              aria-pressed={option.preset === activePreset}
              onClick={() => onSelectPreset(option.preset)}
              disabled={option.status === "error" || option.preset === activePreset}
            >
              <span>
                {option.label}
                {option.recommended ? " · anbefalt" : ""}
              </span>
              <strong>{option.summary}</strong>
              <small>{option.lineSummary}</small>
              <em>
                {[
                  option.durationLabel,
                  option.transferLabel,
                  comparisonStatusLabel(option.status),
                  comparisonSeverityLabel(option.severity),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </em>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="route-planner-status" role="status" aria-live="polite">
          Henter sammenligning ...
        </p>
      )}
      <footer>
        Valgt reise live-sjekkes mer detaljert. Andre tider er en lett Entur-sammenligning.
      </footer>
    </section>
  );
}

function RouteChoicePanel({
  model,
  onSelectItinerary,
}: {
  model?: RouteChoiceModel;
  onSelectItinerary: (itineraryId: string) => void;
}) {
  if (!model) return null;
  const displayOptions = compactRouteChoiceOptions(model);
  return (
    <section className="route-choice-panel" aria-label="Velg reiseforslag">
      <header>
        <div>
          <p className="label">Reisevalg</p>
          <h3>{model.heading}</h3>
          <p>{model.detail}</p>
        </div>
        <span>{displayOptions.length} valg</span>
      </header>
      <div className="route-choice-list">
        {displayOptions.map((option) => (
          <button
            key={option.itineraryId}
            type="button"
            className={`route-choice-option route-choice-option-${option.severity}${
              option.recommended ? " recommended" : ""
            }${option.selected ? " selected" : ""}`}
            aria-pressed={option.selected}
            aria-current={option.selected ? "true" : undefined}
            onClick={() => {
              if (!option.selected) {
                onSelectItinerary(option.itineraryId);
              }
            }}
          >
            <span>{option.label}</span>
            <strong>{option.summary}</strong>
            <small className="route-choice-lines">{option.lineSummary}</small>
            <em>{option.meta}</em>
            <small>{option.detail}</small>
          </button>
        ))}
      </div>
      <footer>
        Live-tavla vektes for valgt reiseforslag. Velg et annet forslag for å sjekke start og
        eventuelle bytter.
      </footer>
    </section>
  );
}

function SelectedItineraryPanel({ itinerary }: { itinerary?: TravelPlanItinerary }) {
  if (!itinerary) return null;
  const boardingLeg = firstBoardingLeg(itinerary);
  const safeHandoff = safeExternalUrl(itinerary.handoffUrl);
  const noticeCount = itinerary.legs.reduce((count, leg) => count + leg.notices.length, 0);
  return (
    <section className="selected-itinerary-panel" aria-label="Valgt reiseforslag">
      <header>
        <div>
          <p className="label">Valgt reiseforslag</p>
          <h3>
            {formatTravelDateTime(itinerary.departureTime)} →{" "}
            {formatTravelDateTime(itinerary.arrivalTime)}
          </h3>
          <p>
            {formatDuration(itinerary.durationSeconds)} · {itineraryTransferLabel(itinerary)} ·{" "}
            {formatDuration(itinerary.walkTimeSeconds)} gange
          </p>
        </div>
        <span>{comparisonLineSummary(itinerary)}</span>
      </header>
      {boardingLeg ? (
        <div className="selected-itinerary-boarding">
          <strong>
            Start med {legLineLabel(boardingLeg)} fra {legStopLabel(boardingLeg)}
          </strong>
          <span>
            {formatTravelDateTime(legDepartureTime(boardingLeg) ?? itinerary.departureTime)}
          </span>
        </div>
      ) : null}
      <ol className="selected-itinerary-timeline">
        {itinerary.legs.map((leg) => (
          <li key={leg.id} className={`selected-itinerary-leg selected-itinerary-leg-${leg.mode}`}>
            <div className="selected-itinerary-leg-time">
              <strong>{formatTravelDateTime(leg.expectedStartTime)}</strong>
              <span>{formatTravelDateTime(leg.expectedEndTime)}</span>
            </div>
            <div className="selected-itinerary-leg-body">
              <strong>
                {leg.publicCode ? `${modeLabel(leg.mode)} ${leg.publicCode}` : modeLabel(leg.mode)}
              </strong>
              <span>
                {leg.from.stopName ?? leg.from.name} → {leg.to.stopName ?? leg.to.name}
              </span>
              {leg.lineName ? <small>{leg.lineName}</small> : null}
              {leg.notices.length ? (
                <div className="itinerary-leg-notices">
                  {leg.notices.slice(0, 3).map((notice) => (
                    <span key={notice.id}>{notice.title}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <footer className="selected-itinerary-footer">
        <span>
          {itinerary.realtime ? "Sanntid inkludert" : "Rutetid"} · {noticeCount} varsel
          {noticeCount === 1 ? "" : "er"}
        </span>
        {safeHandoff ? (
          <a href={safeHandoff} target="_blank" rel="noreferrer noopener">
            Åpne hos AtB/Entur
          </a>
        ) : null}
      </footer>
    </section>
  );
}

function TravelPlanCard({
  plan,
  loading,
  error,
  selectedItineraryId,
  selectedEventId,
  routeChoiceModel,
  routeWatchSummary,
  routeContextSummary,
  onSelectItinerary,
  onFocusRouteContextItem,
}: {
  plan?: TravelPlanPayload;
  loading: boolean;
  error?: string;
  selectedItineraryId?: string;
  selectedEventId?: string;
  routeChoiceModel?: RouteChoiceModel;
  routeWatchSummary?: SelectedRouteWatchSummary;
  routeContextSummary: RouteContextSummary;
  onSelectItinerary: (itineraryId: string) => void;
  onFocusRouteContextItem?: (item: RouteContextItem) => void;
}) {
  if (error) {
    return (
      <p className="route-planner-status error" role="alert" aria-live="assertive">
        {error}
      </p>
    );
  }
  if (loading) {
    return (
      <p className="route-planner-status" role="status" aria-live="polite">
        Henter reiseråd ...
      </p>
    );
  }
  if (!plan) {
    return (
      <p className="route-planner-status" role="status" aria-live="polite">
        Skriv inn start og mål for å se trafikkhendelser og kollektivkontekst langs ruten.
      </p>
    );
  }
  const duration = formatDuration(plan.route.durationSeconds);
  const decision = travelPlanDecision(plan);
  const selectedItinerary = selectedItineraryForPlan(plan, selectedItineraryId);
  const showFallbackSuggestions =
    plan.itineraries.length === 0 && plan.publicTransportSuggestions.length > 0;
  return (
    <article
      className={`travel-plan-card travel-plan-card-${decision.severity}`}
      aria-live="polite"
    >
      <header>
        <p className="label">Reiseråd nå</p>
        <h2>{decision.heading}</h2>
        <p>{decision.detail}</p>
        <div className="travel-plan-route-summary" aria-label="Ruteoppsummering">
          <strong>
            {plan.origin.label} → {plan.destination.label}
          </strong>
          <span>
            {formatDistance(plan.route.distanceMeters)}
            {duration ? ` · ${duration}` : ""} · {plan.route.detail}
          </span>
          <small>
            {decision.itineraryCount} reiseforslag · {routeContextSummary.heading}
          </small>
        </div>
      </header>
      <section className="travel-plan-journey-section">
        <h3>Kollektivvalg</h3>
        {plan.journeyPlanner.status === "unavailable" ? (
          <p className="route-planner-status warning">{plan.journeyPlanner.detail}</p>
        ) : null}
        {plan.journeyPlanner.status === "empty" ? (
          <p className="route-planner-status">Ingen konkrete Entur-reiser funnet for valgt tid.</p>
        ) : null}
        {plan.itineraries.length ? (
          <div className="travel-plan-result-workspace">
            <RouteChoicePanel model={routeChoiceModel} onSelectItinerary={onSelectItinerary} />
            <div className="travel-plan-selected-workspace">
              <SelectedItineraryPanel itinerary={selectedItinerary} />
              <SelectedRouteWatchPanel summary={routeWatchSummary} />
            </div>
          </div>
        ) : null}
      </section>
      <RouteContextFallback
        summary={routeContextSummary}
        onFocusItem={onFocusRouteContextItem}
        selectedEventId={selectedEventId}
      />
      {showFallbackSuggestions ? (
        <details className="travel-secondary-disclosure">
          <summary>Kollektivkontekst</summary>
          <p>
            Nytt viser trafikk- og avvikskontekst; bruk AtB/Entur for billetter og endelig
            reisevalg.
          </p>
          <ul>
            {plan.publicTransportSuggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <strong>{suggestion.title}</strong>
                <span>
                  {suggestion.detail} · {suggestion.source}
                  {suggestion.distanceMeters !== undefined
                    ? ` · ${formatDistance(suggestion.distanceMeters)} fra ruten`
                    : ""}
                </span>
                {(() => {
                  const safeHref = safeExternalUrl(suggestion.href);
                  return safeHref ? (
                    <a href={safeHref} target="_blank" rel="noreferrer noopener">
                      Åpne reiseplanlegger
                    </a>
                  ) : null;
                })()}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <footer className="travel-plan-disclaimer">
        Nytt vurderer reiserisiko, ikke billetter eller garanti. Sjekk alltid AtB/Entur før du drar.
      </footer>
    </article>
  );
}

function departureLineLabel(departure: PublicTransportDeparture): string {
  const mode = modeLabel(departure.mode);
  return departure.publicCode ? `${mode} ${departure.publicCode}` : mode;
}

function departureStatusLabel(departure: PublicTransportDeparture): string {
  if (departure.cancelled) return "Innstilt";
  if (departure.delaySeconds >= 60) {
    const minutes = Math.max(1, Math.round(departure.delaySeconds / 60));
    return `${minutes} min forsinket`;
  }
  if (departure.delaySeconds <= -60) {
    const minutes = Math.max(1, Math.round(Math.abs(departure.delaySeconds) / 60));
    return `${minutes} min tidlig`;
  }
  return departure.realtime ? "Sanntid" : "Planlagt";
}

function departureStatusClass(departure: PublicTransportDeparture): string {
  if (departure.cancelled || departure.delaySeconds >= 180) return "warning";
  if (departure.delaySeconds >= 60 || departure.notices.length) return "watch";
  return "ok";
}

const departureStatusRank: Record<SelectedDepartureStatusSeverity, number> = {
  ok: 0,
  watch: 1,
  warning: 2,
};

export function departureLineFilterKey(departure: PublicTransportDeparture): string {
  const line = departure.publicCode ?? departure.lineId ?? departure.lineName ?? departure.mode;
  return [departure.mode, line, departure.destinationName].join("|");
}

function departureLineFilterLabel(departure: PublicTransportDeparture): string {
  return `${departureLineLabel(departure)} mot ${departure.destinationName}`;
}

export function departureLineFilterOptions(
  departures: PublicTransportDeparture[],
): DepartureLineFilterOption[] {
  const options = new Map<string, DepartureLineFilterOption>();
  for (const departure of departures) {
    const key = departureLineFilterKey(departure);
    const severity = departureStatusClass(departure) as SelectedDepartureStatusSeverity;
    const existing = options.get(key);
    if (!existing) {
      options.set(key, {
        key,
        label: departureLineFilterLabel(departure),
        count: 1,
        severity,
      });
      continue;
    }
    existing.count += 1;
    if (departureStatusRank[severity] > departureStatusRank[existing.severity]) {
      existing.severity = severity;
    }
  }
  return [...options.values()].sort(
    (left, right) =>
      departureStatusRank[right.severity] - departureStatusRank[left.severity] ||
      right.count - left.count ||
      left.label.localeCompare(right.label, "nb"),
  );
}

export function displayDepartureRows(input: {
  departures: PublicTransportDeparture[];
  activeFilterKey: string;
  matchedDeparture?: PublicTransportDeparture;
  limit?: number;
}): PublicTransportDeparture[] {
  const limit = input.limit ?? 8;
  const filtered =
    input.activeFilterKey === "all"
      ? input.departures
      : input.departures.filter(
          (departure) => departureLineFilterKey(departure) === input.activeFilterKey,
        );
  const rows = filtered.slice(0, limit);
  if (!input.matchedDeparture || input.activeFilterKey !== "all") return rows;
  if (rows.some((departure) => departure.id === input.matchedDeparture?.id)) return rows;
  const matched = input.departures.find((departure) => departure.id === input.matchedDeparture?.id);
  if (!matched) return rows;
  return [matched, ...rows].slice(0, limit);
}

export function selectedDepartureStatus(
  departure?: PublicTransportDeparture,
  leg?: TravelPlanLeg,
  board?: PublicTransportDepartureBoardPayload,
): SelectedDepartureStatus {
  if (!departure) {
    const plannedTime = legDepartureTime(leg);
    const plannedPart = plannedTime
      ? `${legLineLabel(leg)} fra ${legStopLabel(leg)} kl. ${formatTravelDateTime(plannedTime)}`
      : `${legLineLabel(leg)} fra ${legStopLabel(leg)}`;
    if (board?.status === "unavailable") {
      return {
        label: "Sjekk AtB/Entur",
        detail: `Avgangstavla er utilgjengelig akkurat nå. Reiserådet bruker fortsatt ${plannedPart}, men avgang, plattform og avvik må sjekkes hos AtB/Entur.`,
        severity: "warning",
      };
    }
    if (board?.status === "empty") {
      return {
        label: "Ingen tavletreff",
        detail: `Avgangstavla for ${board.areaLabel} har ingen avganger for valgt tidsrom. Reiserådet bruker ${plannedPart}; sjekk AtB/Entur før du drar.`,
        severity: "watch",
      };
    }
    if (board?.departures.length) {
      return {
        label: "Ikke i tavla",
        detail: `Reiserådet bruker ${plannedPart}, men Nytt fant ikke samme avgang i live-tavla. Sjekk holdeplass, plattform og avvik hos AtB/Entur.`,
        severity: "watch",
      };
    }
    return {
      label: "Sjekk",
      detail: `Reiserådet bruker ${plannedPart}. Live-tavla er ikke lastet inn, så sjekk linje og holdeplass hos AtB/Entur.`,
      severity: "watch",
    };
  }
  if (departure.cancelled) {
    return {
      label: "Innstilt",
      detail: `Avgangen mot ${departure.destinationName} er innstilt. Velg et annet reiseforslag hos AtB/Entur.`,
      severity: "warning",
    };
  }
  if (departure.delaySeconds >= 60) {
    const minutes = Math.max(1, Math.round(departure.delaySeconds / 60));
    return {
      label: `${minutes} min forsinket`,
      detail: `Matcher avgang mot ${departure.destinationName}, men den er ${minutes} min forsinket.`,
      severity: departure.delaySeconds >= 180 ? "warning" : "watch",
    };
  }
  if (departure.delaySeconds <= -60) {
    const minutes = Math.max(1, Math.round(Math.abs(departure.delaySeconds) / 60));
    return {
      label: `${minutes} min tidlig`,
      detail: `Matcher avgang mot ${departure.destinationName}, men den går ${minutes} min tidligere enn planlagt.`,
      severity: "watch",
    };
  }
  if (departure.notices.length) {
    return {
      label: "Avvik",
      detail: `Matcher avgang mot ${departure.destinationName}. ${departure.notices[0]?.title ?? "Sjekk avvik hos AtB/Entur."}`,
      severity: "watch",
    };
  }
  return {
    label: departure.realtime ? "Sanntid" : "Planlagt",
    detail: departure.realtime
      ? `Matcher sanntidsavgang mot ${departure.destinationName}.`
      : `Matcher planlagt avgang mot ${departure.destinationName}.`,
    severity: "ok",
  };
}

function departureBoardHeading(context: DepartureBoardContext): string {
  return context.startTime
    ? `Avganger rundt ${formatTravelDateTime(context.startTime)}`
    : "Avganger nå";
}

function rememberedDepartureBoardFromContext(
  context: DepartureBoardContext,
  lineFilter?: DepartureLineFilterOption,
): RememberedDepartureBoardCandidate | undefined {
  if (!context.center) return undefined;
  if (context.label === "Din posisjon" || looksLikeCoordinateQuery(context.label)) return undefined;
  return {
    label: context.label,
    center: context.center,
    ...(lineFilter
      ? {
          preferredLineFilterKey: lineFilter.key,
          preferredLineFilterLabel: lineFilter.label,
        }
      : {}),
  };
}

function rememberedDepartureBoardContext(board: RememberedDepartureBoard): DepartureBoardContext {
  return {
    scope: "origin",
    label: board.label,
    center: board.center,
  };
}

function rememberedDepartureBoardDisplayLabel(board: RememberedDepartureBoard): string {
  return board.preferredLineFilterLabel
    ? `${board.label} · ${board.preferredLineFilterLabel}`
    : board.label;
}

function RouteDepartureConfidencePanel({
  checkpoints,
  results,
  fetchStatus,
}: {
  checkpoints: RouteDepartureCheckpoint[];
  results: RouteDepartureBoardResult[];
  fetchStatus: RouteDepartureBoardStatus;
}) {
  if (checkpoints.length <= 1) return null;
  const items = routeDepartureConfidenceItems(checkpoints, results);
  const summary = routeDepartureConfidenceSummary(items, fetchStatus);
  return (
    <section
      className={`route-departure-confidence route-departure-confidence-${summary.severity}`}
      aria-labelledby="route-departure-confidence-heading"
    >
      <header>
        <div>
          <p className="label">Reisekontroll</p>
          <h2 id="route-departure-confidence-heading">{summary.heading}</h2>
          <p>{summary.detail}</p>
        </div>
        <span>{fetchStatus === "loading" ? "Henter" : `${items.length} stopp`}</span>
      </header>
      <div className="route-departure-checks">
        {items.map((item) => {
          const plannedTime = legDepartureTime(item.checkpoint.leg);
          return (
            <article
              key={item.checkpoint.id}
              className={`route-departure-check route-departure-check-${item.status.severity}`}
            >
              <div>
                <strong>{item.checkpoint.label}</strong>
                <span>
                  {legLineLabel(item.checkpoint.leg)}
                  {plannedTime ? ` · ${formatTravelDateTime(plannedTime)}` : ""}
                </span>
              </div>
              <div>
                <span className="route-departure-check-state">{item.status.label}</span>
                {item.departure ? (
                  <time dateTime={item.departure.expectedDepartureTime}>
                    {formatTravelDateTime(item.departure.expectedDepartureTime)}
                  </time>
                ) : null}
              </div>
              <p>{item.status.detail}</p>
            </article>
          );
        })}
      </div>
      <footer>
        Nytt sjekker start og bytter mot live-tavler. AtB/Entur er fortsatt fasit for avgang og
        plattform.
      </footer>
    </section>
  );
}

function DepartureBoardPanel({
  board,
  loading,
  error,
  context,
  routeOriginContext,
  rememberedBoards,
  requestedLineFilterKey,
  selectedDeparture,
  onReload,
  onContextChange,
  onClearRequestedLineFilter,
  onRememberCurrentBoard,
  onSelectRememberedBoard,
  onRemoveRememberedBoard,
}: {
  board?: PublicTransportDepartureBoardPayload;
  loading: boolean;
  error?: string;
  context: DepartureBoardContext;
  routeOriginContext?: DepartureBoardContext;
  rememberedBoards: RememberedDepartureBoard[];
  requestedLineFilterKey?: string;
  selectedDeparture?: SelectedDepartureMatch;
  onReload: () => void;
  onContextChange: (context: DepartureBoardContext) => void;
  onClearRequestedLineFilter: () => void;
  onRememberCurrentBoard: (candidate: RememberedDepartureBoardCandidate) => void;
  onSelectRememberedBoard: (board: RememberedDepartureBoard) => void;
  onRemoveRememberedBoard: (boardId: string) => void;
}) {
  const [activeDepartureFilterKey, setActiveDepartureFilterKey] = useState("all");
  const safeHandoff = safeExternalUrl(board?.handoffUrl ?? "https://www.atb.no/reiseplanlegger/");
  const departures = Array.isArray(board?.departures) ? board.departures : [];
  const departureFilters = useMemo(() => departureLineFilterOptions(departures), [departures]);
  const activeLineFilter =
    activeDepartureFilterKey === "all"
      ? undefined
      : departureFilters.find((option) => option.key === activeDepartureFilterKey);
  const currentRememberedBoard = rememberedDepartureBoardFromContext(context, activeLineFilter);
  const currentRememberedBoardId = currentRememberedBoard
    ? rememberedDepartureBoardId(currentRememberedBoard)
    : undefined;
  const currentBoardSaved = Boolean(
    currentRememberedBoardId &&
    rememberedBoards.some((rememberedBoard) => rememberedBoard.id === currentRememberedBoardId),
  );
  const contextDescription =
    context.scope === "origin"
      ? `${context.label}: neste avganger fra holdeplasser ved startpunktet.`
      : board
        ? `${board.areaLabel}: neste avganger fra holdeplasser i nærheten.`
        : "Neste avganger fra Trondheim sentrum lastes inn.";
  const matchedDeparture = selectedDeparture?.departure;
  const selectedLeg = selectedDeparture?.leg;
  const selectedStatus = selectedDepartureStatus(matchedDeparture, selectedLeg, board);
  const selectedPlannedTime = legDepartureTime(selectedLeg);
  const displayedDepartures = useMemo(
    () =>
      displayDepartureRows({
        departures,
        activeFilterKey: activeDepartureFilterKey,
        matchedDeparture,
      }),
    [activeDepartureFilterKey, departures, matchedDeparture],
  );
  const contextKey = context.center
    ? `${context.scope}:${context.label}:${context.center.lat.toFixed(5)},${context.center.lon.toFixed(5)}`
    : `${context.scope}:${context.label}`;
  const saveBoardLabel = activeLineFilter ? "Lagre linje" : "Lagre tavle";
  const savedBoardLabel = activeLineFilter ? "Linje lagret" : "Tavle lagret";
  const visibleDepartureFilters = useMemo(() => {
    const visible = departureFilters.slice(0, 8);
    if (
      activeDepartureFilterKey === "all" ||
      visible.some((option) => option.key === activeDepartureFilterKey)
    ) {
      return visible;
    }
    const activeOption = departureFilters.find((option) => option.key === activeDepartureFilterKey);
    return activeOption ? [activeOption, ...visible.slice(0, 7)] : visible;
  }, [activeDepartureFilterKey, departureFilters]);

  useEffect(() => {
    if (activeDepartureFilterKey === "all") return;
    if (departureFilters.some((option) => option.key === activeDepartureFilterKey)) return;
    setActiveDepartureFilterKey("all");
  }, [activeDepartureFilterKey, departureFilters]);

  useEffect(() => {
    if (requestedLineFilterKey) return;
    setActiveDepartureFilterKey("all");
  }, [contextKey, requestedLineFilterKey]);

  useEffect(() => {
    if (!requestedLineFilterKey) return;
    if (departureFilters.some((option) => option.key === requestedLineFilterKey)) {
      setActiveDepartureFilterKey(requestedLineFilterKey);
      return;
    }
    if (!loading && board) {
      setActiveDepartureFilterKey("all");
    }
  }, [board, departureFilters, loading, requestedLineFilterKey]);

  return (
    <section className="departure-board-panel" aria-labelledby="departure-board-heading">
      <header>
        <div>
          <p className="label">Kollektiv nå</p>
          <h2 id="departure-board-heading">{departureBoardHeading(context)}</h2>
          <p>{contextDescription}</p>
        </div>
        <div className="departure-board-actions">
          <div className="departure-board-scope" aria-label="Velg avgangsområde">
            <button
              type="button"
              className={context.scope === "default" ? "selected" : undefined}
              aria-pressed={context.scope === "default"}
              onClick={() => onContextChange(defaultDepartureBoardContext)}
              disabled={loading && context.scope === "default"}
            >
              Sentrum
            </button>
            {routeOriginContext ? (
              <button
                type="button"
                className={context.scope === "origin" ? "selected" : undefined}
                aria-pressed={context.scope === "origin"}
                onClick={() => onContextChange(routeOriginContext)}
                disabled={loading && context.scope === "origin"}
              >
                Startpunkt
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => currentRememberedBoard && onRememberCurrentBoard(currentRememberedBoard)}
            disabled={loading || !currentRememberedBoard || currentBoardSaved}
          >
            {currentBoardSaved ? savedBoardLabel : saveBoardLabel}
          </button>
          <button type="button" onClick={onReload} disabled={loading}>
            {loading ? "Oppdaterer ..." : "Oppdater"}
          </button>
          {safeHandoff ? (
            <a href={safeHandoff} target="_blank" rel="noreferrer noopener">
              AtB/Entur
            </a>
          ) : null}
        </div>
        {rememberedBoards.length ? (
          <div className="departure-board-favorites" aria-label="Lagrede avgangstavler">
            <span>Lagrede tavler</span>
            {rememberedBoards.map((rememberedBoard) => {
              const label = rememberedDepartureBoardDisplayLabel(rememberedBoard);
              return (
                <div key={rememberedBoard.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRememberedBoard(rememberedBoard)}
                    disabled={loading && currentRememberedBoardId === rememberedBoard.id}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRememberedBoard(rememberedBoard.id)}
                    aria-label={`Fjern ${label} fra lagrede avgangstavler`}
                  >
                    Fjern
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </header>
      {error ? <p className="route-planner-status error">{error}</p> : null}
      {!board && loading ? (
        <p className="route-planner-status" role="status" aria-live="polite">
          Henter avganger ...
        </p>
      ) : null}
      {board?.status === "unavailable" ? (
        <p className="route-planner-status warning">{board.detail}</p>
      ) : null}
      {board?.status === "empty" ? <p className="route-planner-status">{board.detail}</p> : null}
      {selectedDeparture ? (
        <article
          className={`selected-departure-callout selected-departure-${selectedStatus.severity}${
            matchedDeparture ? " matched" : ""
          }`}
          aria-label="Valgt reiseforslag"
        >
          <div>
            <p className="label">Valgt reiseforslag</p>
            <strong>
              {legLineLabel(selectedDeparture.leg)} fra {legStopLabel(selectedDeparture.leg)}
            </strong>
            <span>{selectedStatus.detail}</span>
          </div>
          <div className="selected-departure-state">
            <span>{selectedStatus.label}</span>
            {matchedDeparture ? (
              <time dateTime={matchedDeparture.expectedDepartureTime}>
                {formatTravelDateTime(matchedDeparture.expectedDepartureTime)}
              </time>
            ) : selectedPlannedTime ? (
              <time dateTime={selectedPlannedTime}>
                Planlagt {formatTravelDateTime(selectedPlannedTime)}
              </time>
            ) : null}
          </div>
        </article>
      ) : null}
      {departureFilters.length > 1 ? (
        <div className="departure-line-filters" aria-label="Filtrer avganger etter linje">
          <button
            type="button"
            className={activeDepartureFilterKey === "all" ? "selected" : undefined}
            aria-pressed={activeDepartureFilterKey === "all"}
            onClick={() => {
              onClearRequestedLineFilter();
              setActiveDepartureFilterKey("all");
            }}
          >
            Alle <span>{departures.length}</span>
          </button>
          {visibleDepartureFilters.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`${option.severity}${activeDepartureFilterKey === option.key ? " selected" : ""}`}
              aria-pressed={activeDepartureFilterKey === option.key}
              onClick={() => {
                onClearRequestedLineFilter();
                setActiveDepartureFilterKey(option.key);
              }}
            >
              {option.label} <span>{option.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      {displayedDepartures.length ? (
        <div className="departure-board-grid">
          {displayedDepartures.map((departure) => {
            const selected = matchedDeparture?.id === departure.id;
            return (
              <article key={departure.id} className={`departure-row${selected ? " matched" : ""}`}>
                <div className="departure-row-main">
                  <span className="departure-line">{departureLineLabel(departure)}</span>
                  <strong>{departure.destinationName}</strong>
                  <small>
                    {departure.stopName}
                    {departure.quayPublicCode ? ` · ${departure.quayPublicCode}` : ""}
                    {departure.stopDistanceMeters !== undefined
                      ? ` · ${formatDistance(departure.stopDistanceMeters)} unna`
                      : ""}
                  </small>
                  {selected ? (
                    <span className="departure-row-marker">Valgt reiseforslag</span>
                  ) : null}
                </div>
                <div className="departure-row-time">
                  <time dateTime={departure.expectedDepartureTime}>
                    {formatTravelDateTime(departure.expectedDepartureTime)}
                  </time>
                  <span className={`departure-status ${departureStatusClass(departure)}`}>
                    {departureStatusLabel(departure)}
                  </span>
                </div>
                {departure.notices.length ? (
                  <div className="departure-notices" aria-label="Avvik for avgangen">
                    {departure.notices.slice(0, 2).map((notice) => (
                      <span key={notice.id} className={`departure-notice ${notice.severity}`}>
                        {notice.title}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      <footer>
        <span>
          Nytt viser avgangs- og avvikskontekst. AtB/Entur er fasit for avgang, billett og
          operatørvalg.
        </span>
      </footer>
    </section>
  );
}

function TrafficDataDisclosure({
  sources,
}: {
  sources: Array<{
    source: string;
    label: string;
    state: string;
    detail: string;
    lastCheckedAt?: string;
  }>;
}) {
  const uniqueSources = Array.from(
    new Map(sources.map((source) => [source.source, source])).values(),
  );
  if (!uniqueSources.length) return null;
  return (
    <details className="traffic-data-disclosure">
      <summary>Se datagrunnlag</summary>
      <div>
        {uniqueSources.map((source) => (
          <article key={source.source}>
            <strong>{source.label}</strong>
            <span>
              {source.state} · {source.detail}
              {source.lastCheckedAt
                ? ` · oppdatert ${formatTrafficFreshness(source.lastCheckedAt)}`
                : ""}
            </span>
          </article>
        ))}
      </div>
    </details>
  );
}

function suggestionKindLabel(kind: TravelPlaceSuggestion["kind"]): string {
  switch (kind) {
    case "stop":
      return "Holdeplass";
    case "stop_group":
      return "Stoppområde";
    case "address":
      return "Adresse";
    case "street":
      return "Gate";
    case "poi":
      return "Sted";
    case "place":
      return "Område";
    default:
      return "Forslag";
  }
}

function travelSuggestionQuery(suggestion: TravelPlaceSuggestion): string {
  const [lon, lat] = suggestion.coordinate;
  return formatCoordinateInput({ lat, lon });
}

function RoutePlaceInput({
  id,
  label,
  value,
  placeholder,
  describedBy,
  hasError,
  selectedSuggestion,
  resetToken,
  onChange,
  onSelectSuggestion,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  describedBy: string;
  hasError: boolean;
  selectedSuggestion?: TravelPlaceSuggestion;
  resetToken: number;
  onChange: (value: string) => void;
  onSelectSuggestion: (suggestion: TravelPlaceSuggestion) => void;
}) {
  const [suggestions, setSuggestions] = useState<TravelPlaceSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const requestRef = useRef(0);
  const listId = `${id}-suggestions`;
  const trimmedValue = value.trim();
  const selectedIsCurrent = selectedSuggestion?.label === value;

  useEffect(() => {
    requestRef.current += 1;
    setSuggestions([]);
    setStatus("idle");
  }, [resetToken]);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (trimmedValue.length < 2 || selectedIsCurrent) {
      setSuggestions([]);
      setStatus("idle");
      return undefined;
    }

    setStatus("loading");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetchTravelPlaceSuggestions({ q: trimmedValue, limit: 6 }, { signal: controller.signal })
        .then((payload) => {
          if (requestRef.current !== requestId) return;
          setSuggestions(payload.suggestions);
          setStatus(payload.suggestions.length ? "idle" : "empty");
        })
        .catch(() => {
          if (requestRef.current !== requestId || controller.signal.aborted) return;
          setSuggestions([]);
          setStatus("error");
        });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [selectedIsCurrent, trimmedValue]);

  return (
    <div className="route-place-input">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-describedby={describedBy}
        aria-invalid={hasError}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={suggestions.length > 0}
        role="combobox"
      />
      {selectedSuggestion ? (
        <p className="route-suggestion-selected">
          Bruker {suggestionKindLabel(selectedSuggestion.kind).toLowerCase()} fra Entur
        </p>
      ) : null}
      {status === "loading" ? (
        <p className="route-suggestion-status" role="status">
          Henter stedsforslag ...
        </p>
      ) : null}
      {status === "empty" ? (
        <p className="route-suggestion-status">Ingen Entur-forslag i Trøndelag.</p>
      ) : null}
      {status === "error" ? (
        <p className="route-suggestion-status warning">
          Stedsforslag er utilgjengelige. Du kan fortsatt skrive manuelt.
        </p>
      ) : null}
      {suggestions.length ? (
        <div id={listId} className="route-suggestion-list" role="listbox">
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.id}:${suggestion.coordinate.join(",")}`}
              type="button"
              role="option"
              aria-selected={selectedSuggestion?.id === suggestion.id}
              onClick={() => onSelectSuggestion(suggestion)}
            >
              <span>
                <strong>{suggestion.label}</strong>
                {suggestion.locality && !suggestion.label.includes(suggestion.locality)
                  ? ` · ${suggestion.locality}`
                  : ""}
              </span>
              <small>{suggestionKindLabel(suggestion.kind)}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RememberedTravelRoutesPanel({
  routes,
  loading,
  onSelectRoute,
  onToggleRoutePinned,
  onRemoveRoute,
}: {
  routes: RememberedTravelRoute[];
  loading: boolean;
  onSelectRoute: (route: RememberedTravelRoute) => void;
  onToggleRoutePinned: (routeId: string) => void;
  onRemoveRoute: (routeId: string) => void;
}) {
  if (!routes.length) return null;
  return (
    <section className="remembered-routes" aria-labelledby="remembered-routes-heading">
      <div className="remembered-routes-header">
        <div>
          <h2 id="remembered-routes-heading">Ruter</h2>
          <p>Lagres bare i denne nettleseren.</p>
        </div>
      </div>
      <div className="remembered-route-list">
        {routes.map((route) => (
          <article
            key={route.id}
            className={route.pinned ? "remembered-route pinned" : "remembered-route"}
          >
            <button
              type="button"
              className="remembered-route-main"
              onClick={() => onSelectRoute(route)}
              disabled={loading}
            >
              <strong>
                {route.originInput} → {route.destinationInput}
              </strong>
              <span>
                {travelTimePresetLabel(route.timePreset)} · brukt {route.useCount}{" "}
                {route.useCount === 1 ? "gang" : "ganger"}
              </span>
            </button>
            <div className="remembered-route-actions">
              {route.pinned ? <span>Festet</span> : null}
              <button
                type="button"
                onClick={() => onToggleRoutePinned(route.id)}
                aria-label={
                  route.pinned
                    ? `Fjern festing av ${route.originInput} til ${route.destinationInput}`
                    : `Fest ${route.originInput} til ${route.destinationInput}`
                }
              >
                {route.pinned ? "Løsne" : "Fest"}
              </button>
              <button
                type="button"
                onClick={() => onRemoveRoute(route.id)}
                aria-label={`Fjern ${route.originInput} til ${route.destinationInput} fra ruter`}
              >
                Fjern
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TravelPlannerPanel({
  originInput,
  destinationInput,
  timePreset,
  travelPlan,
  travelPlanLoading,
  travelPlanError,
  selectedItineraryId,
  selectedEventId,
  routeChoiceModel,
  routeWatchSummary,
  routeContextSummary,
  onFocusRouteContextItem,
  travelTimeComparison,
  selectedOriginSuggestion,
  selectedDestinationSuggestion,
  suggestionResetToken,
  publicTransportDisruptionsVisible,
  publicTransportVehiclesVisible,
  locationStatus,
  locationMessage,
  rememberedRoutes,
  onOriginChange,
  onDestinationChange,
  onSuggestionSelect,
  onDestinationPresetSelect,
  onSwapRoute,
  onTimePresetChange,
  onUseCurrentLocation,
  onSelectItinerary,
  onSelectComparisonPreset,
  onSelectRememberedRoute,
  onToggleRememberedRoutePinned,
  onRemoveRememberedRoute,
  onSubmit,
  onToggleDisruptions,
  onToggleVehicles,
}: {
  originInput: string;
  destinationInput: string;
  timePreset: TravelTimePreset;
  travelPlan?: TravelPlanPayload;
  travelPlanLoading: boolean;
  travelPlanError?: string;
  selectedItineraryId?: string;
  selectedEventId?: string;
  routeChoiceModel?: RouteChoiceModel;
  routeWatchSummary?: SelectedRouteWatchSummary;
  routeContextSummary: RouteContextSummary;
  onFocusRouteContextItem?: (item: RouteContextItem) => void;
  travelTimeComparison: TravelTimeComparisonState;
  selectedOriginSuggestion?: TravelPlaceSuggestion;
  selectedDestinationSuggestion?: TravelPlaceSuggestion;
  suggestionResetToken: number;
  publicTransportDisruptionsVisible: boolean;
  publicTransportVehiclesVisible: boolean;
  locationStatus: LocationRequestStatus;
  locationMessage?: string;
  rememberedRoutes: RememberedTravelRoute[];
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSuggestionSelect: (kind: RouteInputKind, suggestion: TravelPlaceSuggestion) => void;
  onDestinationPresetSelect: (preset: DestinationPreset) => void;
  onSwapRoute: () => void;
  onTimePresetChange: (value: TravelTimePreset) => void;
  onUseCurrentLocation: () => void;
  onSelectItinerary: (itineraryId: string) => void;
  onSelectComparisonPreset: (preset: TravelTimePreset) => void;
  onSelectRememberedRoute: (route: RememberedTravelRoute) => void;
  onToggleRememberedRoutePinned: (routeId: string) => void;
  onRemoveRememberedRoute: (routeId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleDisruptions: () => void;
  onToggleVehicles: () => void;
}) {
  const hasTravelResult = Boolean(travelPlan || travelPlanLoading || travelPlanError);
  const panelClassName = `travel-planner-panel ${
    hasTravelResult ? "travel-planner-panel-post-search" : "travel-planner-panel-pre-search"
  }`;
  const controlsClassName = `route-planner-controls${
    hasTravelResult ? " route-planner-controls-compact" : ""
  }`;
  const formClassName = `route-planner-form route-planner-form-primary${
    hasTravelResult ? " route-planner-form-compact" : ""
  }`;
  return (
    <section className={panelClassName} aria-labelledby="travel-planner-heading">
      {hasTravelResult ? (
        <header className="travel-planner-post-heading">
          <div>
            <p className="label">Reise og trafikk</p>
            <h1 id="travel-planner-heading">Planlegg reisen</h1>
          </div>
          <div className="travel-planner-actions" aria-label="Kollektivvalg">
            <button
              type="button"
              className={publicTransportDisruptionsVisible ? "selected" : undefined}
              aria-pressed={publicTransportDisruptionsVisible}
              onClick={onToggleDisruptions}
            >
              Vis kollektivavvik
            </button>
            <button
              type="button"
              className={publicTransportVehiclesVisible ? "selected" : undefined}
              aria-pressed={publicTransportVehiclesVisible}
              onClick={onToggleVehicles}
            >
              Vis kjøretøy
            </button>
          </div>
        </header>
      ) : (
        <div className="travel-planner-copy">
          <p className="label">Reise og trafikk</p>
          <h1 id="travel-planner-heading">Planlegg reisen</h1>
          <p>
            Sjekk vegmeldinger, reisetid og kollektivavvik langs ruten. Nytt viser kontekst; bruk
            AtB/Entur for avgangstid, billetter og endelig reisevalg.
          </p>
          <div className="travel-planner-actions" aria-label="Kollektivvalg">
            <button
              type="button"
              className={publicTransportDisruptionsVisible ? "selected" : undefined}
              aria-pressed={publicTransportDisruptionsVisible}
              onClick={onToggleDisruptions}
            >
              Vis kollektivavvik
            </button>
            <button
              type="button"
              className={publicTransportVehiclesVisible ? "selected" : undefined}
              aria-pressed={publicTransportVehiclesVisible}
              onClick={onToggleVehicles}
            >
              Vis kjøretøy
            </button>
          </div>
        </div>
      )}
      <div className="travel-planner-workbench">
        <div className={controlsClassName}>
          <form className={formClassName} onSubmit={onSubmit}>
            <div>
              <RoutePlaceInput
                id="travel-origin"
                label="Hvor er du?"
                value={originInput}
                placeholder="F.eks. Munkegata eller 63.43, 10.39"
                describedBy="travel-plan-result"
                hasError={Boolean(travelPlanError)}
                selectedSuggestion={selectedOriginSuggestion}
                resetToken={suggestionResetToken}
                onChange={onOriginChange}
                onSelectSuggestion={(suggestion) => onSuggestionSelect("origin", suggestion)}
              />
              <div className="route-input-tools">
                <button
                  type="button"
                  className="route-location-button"
                  onClick={onUseCurrentLocation}
                  disabled={travelPlanLoading || locationStatus === "loading"}
                >
                  {locationStatus === "loading" ? "Henter posisjon ..." : "Bruk min posisjon"}
                </button>
                {locationMessage ? (
                  <small className={`route-location-status ${locationStatus}`}>
                    {locationMessage}
                  </small>
                ) : null}
              </div>
            </div>
            <div>
              <RoutePlaceInput
                id="travel-destination"
                label="Hvor skal du?"
                value={destinationInput}
                placeholder="F.eks. Leangen"
                describedBy="travel-plan-result"
                hasError={Boolean(travelPlanError)}
                selectedSuggestion={selectedDestinationSuggestion}
                resetToken={suggestionResetToken}
                onChange={onDestinationChange}
                onSelectSuggestion={(suggestion) => onSuggestionSelect("destination", suggestion)}
              />
              {!hasTravelResult ? (
                <div
                  className="route-destination-presets"
                  role="group"
                  aria-label="Vanlige reisemål"
                >
                  <span className="route-destination-presets-title">Vanlige mål</span>
                  {destinationPresets.map((preset) => (
                    <button
                      key={preset.query}
                      type="button"
                      className={destinationInput === preset.query ? "selected" : undefined}
                      aria-pressed={destinationInput === preset.query}
                      onClick={() => onDestinationPresetSelect(preset)}
                      disabled={travelPlanLoading}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="route-swap-button"
              onClick={onSwapRoute}
              disabled={travelPlanLoading || (!originInput.trim() && !destinationInput.trim())}
            >
              Bytt retning
            </button>
            <div>
              <label htmlFor="travel-time">Når?</label>
              <select
                id="travel-time"
                value={timePreset}
                onChange={(event) => onTimePresetChange(event.target.value as TravelTimePreset)}
              >
                {travelTimePresets.map((preset) => (
                  <option key={preset} value={preset}>
                    {travelTimePresetLabel(preset)}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={travelPlanLoading}>
              {travelPlanLoading ? "Henter reiseråd ..." : "Finn reiseråd"}
            </button>
          </form>
          {!hasTravelResult ? (
            <RememberedTravelRoutesPanel
              routes={rememberedRoutes}
              loading={travelPlanLoading}
              onSelectRoute={onSelectRememberedRoute}
              onToggleRoutePinned={onToggleRememberedRoutePinned}
              onRemoveRoute={onRemoveRememberedRoute}
            />
          ) : null}
        </div>
        <div id="travel-plan-result" className="travel-planner-result">
          <TravelPlanCard
            plan={travelPlan}
            loading={travelPlanLoading}
            error={travelPlanError}
            selectedItineraryId={selectedItineraryId}
            selectedEventId={selectedEventId}
            routeChoiceModel={routeChoiceModel}
            routeWatchSummary={routeWatchSummary}
            routeContextSummary={routeContextSummary}
            onSelectItinerary={onSelectItinerary}
            onFocusRouteContextItem={onFocusRouteContextItem}
          />
          {travelTimeComparison.status !== "idle" ? (
            <details className="travel-secondary-disclosure travel-time-disclosure">
              <summary>Dra nå eller vent?</summary>
              <TravelTimeComparisonPanel
                state={travelTimeComparison}
                activePreset={timePreset}
                onSelectPreset={onSelectComparisonPreset}
              />
            </details>
          ) : null}
        </div>
      </div>
      {hasTravelResult && rememberedRoutes.length ? (
        <details className="remembered-routes-disclosure">
          <summary>Lagrede ruter ({rememberedRoutes.length})</summary>
          <RememberedTravelRoutesPanel
            routes={rememberedRoutes}
            loading={travelPlanLoading}
            onSelectRoute={onSelectRememberedRoute}
            onToggleRoutePinned={onToggleRememberedRoutePinned}
            onRemoveRoute={onRemoveRememberedRoute}
          />
        </details>
      ) : null}
    </section>
  );
}

export function TrafficMapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const trafficSearch = searchParams.toString();
  const trafficFilters = useMemo(() => parseTrafficMapFilters(trafficSearch), [trafficSearch]);
  const initialTravelSearchRef = useRef<TravelPlannerSearchState | undefined>(undefined);
  if (!initialTravelSearchRef.current) {
    initialTravelSearchRef.current = parseTravelPlannerSearch(trafficSearch);
  }
  const initialTravelSearch = initialTravelSearchRef.current;
  const [autoTravelSearchPending, setAutoTravelSearchPending] = useState(
    () => initialTravelSearch.shouldAutoSubmit,
  );
  const [bounds, setBounds] = useState<MapBounds>();
  const [selectedPreset, setSelectedPreset] = useState<TrafficMapPreset>(
    () => trafficFilters.preset,
  );
  const [selectedCategories, setSelectedCategories] = useState<TrafficEventCategory[]>(
    trafficFilters.categories,
  );
  const [selectedSeverities, setSelectedSeverities] = useState(() => trafficFilters.severities);
  const [selectedCorridorId, setSelectedCorridorId] = useState<string | undefined>();
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
  const [visibleContextLayers, setVisibleContextLayers] = useState<TrafficLayerVisibility>(
    trafficFilters.layers,
  );
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [originInput, setOriginInput] = useState(() => initialTravelSearch.originInput);
  const [destinationInput, setDestinationInput] = useState(
    () => initialTravelSearch.destinationInput,
  );
  const [selectedOriginSuggestion, setSelectedOriginSuggestion] = useState<TravelPlaceSuggestion>();
  const [selectedDestinationSuggestion, setSelectedDestinationSuggestion] =
    useState<TravelPlaceSuggestion>();
  const [suggestionResetToken, setSuggestionResetToken] = useState(0);
  const [activeTravelRouteQueryOverride, setActiveTravelRouteQueryOverride] =
    useState<RememberedTravelRouteQueryOverride>();
  const [timePreset, setTimePreset] = useState<TravelTimePreset>(
    () => initialTravelSearch.timePreset,
  );
  const [rememberedRoutes, setRememberedRoutes] = useState<RememberedTravelRoute[]>(() =>
    readRememberedTravelRoutes(browserStorage()),
  );
  const [rememberedDepartureBoards, setRememberedDepartureBoards] = useState<
    RememberedDepartureBoard[]
  >(() => readRememberedDepartureBoards(browserStorage()));
  const [locationStatus, setLocationStatus] = useState<LocationRequestStatus>("idle");
  const [locationMessage, setLocationMessage] = useState<string>();
  const [travelPlan, setTravelPlan] = useState<TravelPlanPayload>();
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | undefined>();
  const [travelPlanLoading, setTravelPlanLoading] = useState(false);
  const [travelPlanError, setTravelPlanError] = useState<string>();
  const [travelTimeComparison, setTravelTimeComparison] = useState<TravelTimeComparisonState>({
    status: "idle",
  });
  const [departureBoard, setDepartureBoard] = useState<PublicTransportDepartureBoardPayload>();
  const [departureBoardContext, setDepartureBoardContext] = useState<DepartureBoardContext>(
    defaultDepartureBoardContext,
  );
  const [requestedDepartureLineFilterKey, setRequestedDepartureLineFilterKey] = useState<string>();
  const [departureBoardLoading, setDepartureBoardLoading] = useState(false);
  const [departureBoardError, setDepartureBoardError] = useState<string>();
  const [routeDepartureBoards, setRouteDepartureBoards] = useState<RouteDepartureBoardResult[]>([]);
  const [routeDepartureBoardStatus, setRouteDepartureBoardStatus] =
    useState<RouteDepartureBoardStatus>("idle");
  const [itineraryLiveStatuses, setItineraryLiveStatuses] = useState<
    Record<string, SelectedDepartureStatus>
  >({});
  const travelPlanRequestIdRef = useRef(0);
  const travelPlanAbortRef = useRef<AbortController | undefined>(undefined);
  const departureBoardAbortRef = useRef<AbortController | undefined>(undefined);
  const routeDepartureBoardsAbortRef = useRef<AbortController | undefined>(undefined);

  const updateRememberedRoutes = useCallback(
    (updater: (routes: RememberedTravelRoute[]) => RememberedTravelRoute[]) => {
      setRememberedRoutes((current) => {
        const next = updater(current);
        writeRememberedTravelRoutes(browserStorage(), next);
        return next;
      });
    },
    [],
  );

  const updateRememberedDepartureBoards = useCallback(
    (updater: (boards: RememberedDepartureBoard[]) => RememberedDepartureBoard[]) => {
      setRememberedDepartureBoards((current) => {
        const next = updater(current);
        writeRememberedDepartureBoards(browserStorage(), next);
        return next;
      });
    },
    [],
  );

  const loadDepartureBoard = useCallback(
    (
      context: DepartureBoardContext,
      options: { preferredLineFilterKey?: string; preserveLineFilter?: boolean } = {},
    ) => {
      departureBoardAbortRef.current?.abort();
      const controller = new AbortController();
      departureBoardAbortRef.current = controller;
      if (!options.preserveLineFilter) {
        setRequestedDepartureLineFilterKey(options.preferredLineFilterKey);
      }
      setDepartureBoardContext(context);
      setDepartureBoard(undefined);
      setDepartureBoardLoading(true);
      setDepartureBoardError(undefined);
      fetchPublicTransportDepartureBoard(
        {
          center: context.center,
          radiusMeters: 1_200,
          stopLimit: 4,
          departureLimit: 12,
          startTime: context.startTime,
        },
        { signal: controller.signal },
      )
        .then((payload) => {
          if (departureBoardAbortRef.current !== controller) return;
          setDepartureBoard(payload);
        })
        .catch((reason) => {
          if (controller.signal.aborted || departureBoardAbortRef.current !== controller) return;
          setDepartureBoardError(
            reason instanceof Error ? reason.message : "Kunne ikke hente avganger.",
          );
        })
        .finally(() => {
          if (departureBoardAbortRef.current === controller) {
            setDepartureBoardLoading(false);
            departureBoardAbortRef.current = undefined;
          }
        });
    },
    [],
  );

  const reloadDepartureBoard = useCallback(() => {
    loadDepartureBoard(departureBoardContext, { preserveLineFilter: true });
  }, [departureBoardContext, loadDepartureBoard]);

  const loadRouteDepartureBoards = useCallback((checkpoints: RouteDepartureCheckpoint[]) => {
    routeDepartureBoardsAbortRef.current?.abort();
    if (checkpoints.length <= 1) {
      routeDepartureBoardsAbortRef.current = undefined;
      setRouteDepartureBoards([]);
      setRouteDepartureBoardStatus("idle");
      return;
    }

    const controller = new AbortController();
    routeDepartureBoardsAbortRef.current = controller;
    setRouteDepartureBoards([]);
    setRouteDepartureBoardStatus("loading");
    Promise.allSettled(
      checkpoints.map(async (checkpoint) => ({
        checkpointId: checkpoint.id,
        board: await fetchPublicTransportDepartureBoard(
          {
            center: checkpoint.context.center,
            radiusMeters: 900,
            stopLimit: 3,
            departureLimit: 8,
            startTime: checkpoint.context.startTime,
          },
          { signal: controller.signal },
        ),
      })),
    )
      .then((settled) => {
        if (routeDepartureBoardsAbortRef.current !== controller) return;
        const results: RouteDepartureBoardResult[] = settled.map((result, index) => {
          const checkpoint = checkpoints[index];
          if (!checkpoint) {
            return {
              checkpointId: `unknown:${index}`,
              error: "Ukjent byttepunkt.",
            };
          }
          if (result.status === "fulfilled") return result.value;
          return {
            checkpointId: checkpoint.id,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Kunne ikke hente live-tavla.",
          };
        });
        const failures = results.filter((result) => result.error).length;
        setRouteDepartureBoards(results);
        setRouteDepartureBoardStatus(
          failures === 0 ? "ready" : failures === results.length ? "error" : "partial",
        );
      })
      .finally(() => {
        if (routeDepartureBoardsAbortRef.current === controller) {
          routeDepartureBoardsAbortRef.current = undefined;
        }
      });
  }, []);

  useEffect(() => {
    loadDepartureBoard(defaultDepartureBoardContext);
    return () => {
      travelPlanAbortRef.current?.abort();
      departureBoardAbortRef.current?.abort();
      routeDepartureBoardsAbortRef.current?.abort();
    };
  }, [loadDepartureBoard]);

  useEffect(() => {
    setSelectedPreset(trafficFilters.preset);
    setSelectedCategories(trafficFilters.categories);
    setSelectedSeverities(trafficFilters.severities);
    setVisibleContextLayers(trafficFilters.layers);
    setSelectedCorridorId(undefined);
    setSelectedEventId(undefined);
  }, [trafficFilters]);

  function invalidateTravelPlan(options: { resetDepartureBoard?: boolean } = {}): number {
    const requestId = travelPlanRequestIdRef.current + 1;
    travelPlanRequestIdRef.current = requestId;
    travelPlanAbortRef.current?.abort();
    travelPlanAbortRef.current = undefined;
    routeDepartureBoardsAbortRef.current?.abort();
    routeDepartureBoardsAbortRef.current = undefined;
    setTravelPlan(undefined);
    setSelectedItineraryId(undefined);
    setTravelTimeComparison({ status: "idle" });
    setRouteDepartureBoards([]);
    setRouteDepartureBoardStatus("idle");
    setItineraryLiveStatuses({});
    setTravelPlanLoading(false);
    if (options.resetDepartureBoard) {
      loadDepartureBoard(defaultDepartureBoardContext);
    }
    return requestId;
  }

  function updateTravelSearchParams(input?: {
    originInput: string;
    destinationInput: string;
    timePreset: TravelTimePreset;
  }): void {
    const next = mergeTravelPlannerSearch(currentSearchString(searchParams.toString()), input);
    setSearchParams(next, { replace: true });
  }

  function handleTravelInputChange(value: string, setter: (nextValue: string) => void): void {
    setter(value);
    setTravelPlanError(undefined);
    if (travelPlanLoading || travelPlan) {
      invalidateTravelPlan({ resetDepartureBoard: true });
      updateTravelSearchParams();
    }
  }

  function handleOriginInputChange(value: string): void {
    setLocationStatus("idle");
    setLocationMessage(undefined);
    setSelectedOriginSuggestion(undefined);
    setActiveTravelRouteQueryOverride(undefined);
    handleTravelInputChange(value, setOriginInput);
  }

  function handleDestinationInputChange(value: string): void {
    setSelectedDestinationSuggestion(undefined);
    setActiveTravelRouteQueryOverride(undefined);
    handleTravelInputChange(value, setDestinationInput);
  }

  function handleTravelSuggestionSelect(
    kind: RouteInputKind,
    suggestion: TravelPlaceSuggestion,
  ): void {
    setTravelPlanError(undefined);
    if (kind === "origin") {
      setLocationStatus("idle");
      setLocationMessage(undefined);
      setSelectedOriginSuggestion(suggestion);
      setActiveTravelRouteQueryOverride(undefined);
      setOriginInput(suggestion.label);
      setSuggestionResetToken((token) => token + 1);
      if (travelPlanLoading || travelPlan) {
        invalidateTravelPlan();
        updateTravelSearchParams();
      }
      const context = departureBoardContextFromSuggestion(suggestion);
      if (context) {
        loadDepartureBoard(context);
      }
    } else {
      setSelectedDestinationSuggestion(suggestion);
      setActiveTravelRouteQueryOverride(undefined);
      setDestinationInput(suggestion.label);
      setSuggestionResetToken((token) => token + 1);
      if (travelPlanLoading || travelPlan) {
        invalidateTravelPlan({ resetDepartureBoard: true });
        updateTravelSearchParams();
      }
    }
  }

  function handleDestinationPresetSelect(preset: DestinationPreset): void {
    setSelectedDestinationSuggestion(undefined);
    setActiveTravelRouteQueryOverride(undefined);
    handleTravelInputChange(preset.query, setDestinationInput);
  }

  function handleSwapRouteInputs(): void {
    setLocationStatus("idle");
    setLocationMessage(undefined);
    setTravelPlanError(undefined);
    setActiveTravelRouteQueryOverride(undefined);
    setOriginInput(destinationInput);
    setDestinationInput(originInput);
    setSelectedOriginSuggestion(selectedDestinationSuggestion);
    setSelectedDestinationSuggestion(selectedOriginSuggestion);
    if (travelPlanLoading || travelPlan) {
      invalidateTravelPlan({ resetDepartureBoard: true });
      updateTravelSearchParams();
    }
  }

  function handleTravelTimePresetChange(value: TravelTimePreset): void {
    setTimePreset(value);
    setTravelPlanError(undefined);
    const hasCompleteRoute = Boolean(
      cleanTravelSearchText(originInput) && cleanTravelSearchText(destinationInput),
    );
    if ((travelPlanLoading || travelPlan) && hasCompleteRoute) {
      void loadTravelPlanForInput({
        originInput,
        destinationInput,
        timePreset: value,
        updateSearch: true,
        routeQueryOverride: activeTravelRouteQueryOverride,
      });
      return;
    }
    if (travelPlanLoading || travelPlan || !hasCompleteRoute) {
      invalidateTravelPlan({ resetDepartureBoard: true });
      updateTravelSearchParams(
        hasCompleteRoute
          ? {
              originInput,
              destinationInput,
              timePreset: value,
            }
          : undefined,
      );
    }
  }

  function handleSelectRememberedRoute(route: RememberedTravelRoute): void {
    setLocationStatus("idle");
    setLocationMessage(undefined);
    setTravelPlanError(undefined);
    setSelectedOriginSuggestion(undefined);
    setSelectedDestinationSuggestion(undefined);
    setOriginInput(route.originInput);
    setDestinationInput(route.destinationInput);
    setTimePreset(route.timePreset);
    const routeQueryOverride: RememberedTravelRouteQueryOverride = {
      from: route.originQuery,
      to: route.destinationQuery,
      ...(route.originLabel ? { fromLabel: route.originLabel } : {}),
      ...(route.destinationLabel ? { toLabel: route.destinationLabel } : {}),
    };
    setActiveTravelRouteQueryOverride(routeQueryOverride);
    void loadTravelPlanForInput({
      originInput: route.originInput,
      destinationInput: route.destinationInput,
      timePreset: route.timePreset,
      updateSearch: true,
      routeQueryOverride,
    });
  }

  function handleToggleRememberedRoutePinned(routeId: string): void {
    updateRememberedRoutes((routes) => toggleRememberedTravelRoutePinned(routes, routeId));
  }

  function handleRemoveRememberedRoute(routeId: string): void {
    updateRememberedRoutes((routes) => removeRememberedTravelRoute(routes, routeId));
  }

  function handleDepartureBoardContextChange(context: DepartureBoardContext): void {
    loadDepartureBoard(context);
  }

  function handleRememberCurrentDepartureBoard(candidate: RememberedDepartureBoardCandidate): void {
    updateRememberedDepartureBoards((boards) => upsertRememberedDepartureBoard(boards, candidate));
  }

  function handleSelectRememberedDepartureBoard(board: RememberedDepartureBoard): void {
    updateRememberedDepartureBoards((boards) =>
      upsertRememberedDepartureBoard(boards, {
        label: board.label,
        center: board.center,
        ...(board.preferredLineFilterKey
          ? {
              preferredLineFilterKey: board.preferredLineFilterKey,
              ...(board.preferredLineFilterLabel
                ? { preferredLineFilterLabel: board.preferredLineFilterLabel }
                : {}),
            }
          : {}),
      }),
    );
    loadDepartureBoard(rememberedDepartureBoardContext(board), {
      preferredLineFilterKey: board.preferredLineFilterKey,
    });
  }

  function handleRemoveRememberedDepartureBoard(boardId: string): void {
    updateRememberedDepartureBoards((boards) => removeRememberedDepartureBoard(boards, boardId));
  }

  const stableBounds = useMemo(
    () => bounds,
    [bounds?.east, bounds?.north, bounds?.south, bounds?.west],
  );
  const timeWindow = useMemo(() => timeWindowForPreset(selectedPreset), [selectedPreset]);
  const requestedTrafficStates: TrafficEventState[] = visibleContextLayers.showAll
    ? ["active", "planned", "expired", "cancelled"]
    : timeWindow.states;
  const { data, loading, error, reload } = useTrafficMap({
    categories: selectedCategories,
    severities: selectedSeverities,
    states: requestedTrafficStates,
    estimatedNews: visibleContextLayers.estimatedNews,
    from: timeWindow.from,
    to: timeWindow.to,
    bounds: stableBounds,
  });
  const publicTransportVisible =
    visibleContextLayers.publicTransportDisruptions || visibleContextLayers.publicTransportVehicles;
  const {
    data: publicTransportData,
    loading: publicTransportLoading,
    error: publicTransportError,
    reload: reloadPublicTransport,
  } = usePublicTransportMap({
    modes: visibleContextLayers.publicTransportVehicles ? ["bus", "tram", "rail", "water"] : [],
    includeAlerts: visibleContextLayers.publicTransportDisruptions,
    bounds: stableBounds,
    enabled: publicTransportVisible,
  });

  const publicTransportDisplayData = useMemo(() => {
    if (!publicTransportVisible || !publicTransportData) return undefined;
    return {
      ...publicTransportData,
      alerts: visibleContextLayers.publicTransportDisruptions ? publicTransportData.alerts : [],
      vehicles: visibleContextLayers.publicTransportVehicles ? publicTransportData.vehicles : [],
    };
  }, [
    publicTransportData,
    publicTransportVisible,
    visibleContextLayers.publicTransportDisruptions,
    visibleContextLayers.publicTransportVehicles,
  ]);

  const trafficViewModel = useMemo(
    () =>
      buildTrafficViewModel({
        traffic: data,
        publicTransport: publicTransportDisplayData,
        showAll: visibleContextLayers.showAll,
        visibleLayers: visibleContextLayers,
      }),
    [data, publicTransportDisplayData, visibleContextLayers],
  );

  const summaryCardsForDisplay = data
    ? trafficViewModel.summaryCards
    : trafficViewModel.summaryCards.map((card) => ({
        ...card,
        title: card.id === "updated" ? "Oppdatert" : "Henter",
        count: 0,
        detail: error ?? (loading ? "Henter trafikkdata ..." : "Ingen trafikkdata hentet ennå."),
        severity: "low" as const,
      }));
  const trafficListCopy = trafficEventListCopy(selectedPreset, visibleContextLayers.showAll);
  const travelPlanSources = useMemo(
    () =>
      travelPlan
        ? [
            {
              source: "entur_journey_planner",
              label: travelPlan.journeyPlanner.source,
              state: travelPlan.journeyPlanner.status === "unavailable" ? "degraded" : "ok",
              detail: `${travelPlan.journeyPlanner.detail} Avreise ${formatTravelDateTime(
                travelPlan.journeyPlanner.requestedDepartureTime,
              )}.`,
            },
          ]
        : [],
    [travelPlan],
  );

  const visibleTrafficEvents = useMemo(() => {
    const events = data?.events ?? [];
    return events.filter((event) => {
      if (!visibleInTrafficLayers(event, visibleContextLayers)) return false;
      if (!visibleContextLayers.showAll && !visibleByDefault(event)) return false;
      return true;
    });
  }, [
    data?.events,
    visibleContextLayers.estimatedNews,
    visibleContextLayers.incidents,
    visibleContextLayers.roadworks,
    visibleContextLayers.showAll,
  ]);

  const visibleEventIds = useMemo(
    () => new Set(visibleTrafficEvents.map((event) => event.id)),
    [visibleTrafficEvents],
  );

  const selectedEvent = useMemo(
    () => visibleTrafficEvents.find((event) => event.id === selectedEventId),
    [visibleTrafficEvents, selectedEventId],
  );

  const rankedEventsForList = useMemo(
    () =>
      trafficViewModel.rankedEvents
        .filter((row) => visibleEventIds.has(row.id))
        .map((row) => ({
          ...row,
          ...compactTrafficEventRow(row.event, data?.corridorImpacts ?? []),
        })),
    [trafficViewModel.rankedEvents, visibleEventIds, data?.corridorImpacts],
  );
  const routeOriginDepartureBoardContext = useMemo(
    () => departureBoardContextFromPlan(travelPlan, selectedItineraryId),
    [selectedItineraryId, travelPlan],
  );
  const routeDepartureCheckpointsForSelection = useMemo(
    () => routeDepartureCheckpoints(travelPlan, selectedItineraryId),
    [selectedItineraryId, travelPlan],
  );
  const selectedDeparture = useMemo(
    () => selectedDepartureMatch(travelPlan, selectedItineraryId, departureBoard),
    [departureBoard, selectedItineraryId, travelPlan],
  );
  useEffect(() => {
    if (!selectedItineraryId || !selectedDeparture) return;
    const status = selectedDepartureStatus(
      selectedDeparture.departure,
      selectedDeparture.leg,
      departureBoard,
    );
    setItineraryLiveStatuses((current) => {
      const existing = current[selectedItineraryId];
      if (
        existing?.label === status.label &&
        existing.detail === status.detail &&
        existing.severity === status.severity
      ) {
        return current;
      }
      return { ...current, [selectedItineraryId]: status };
    });
  }, [departureBoard, selectedDeparture, selectedItineraryId]);
  const routeDepartureConfidenceItemsForSelection = useMemo(
    () =>
      routeDepartureBoardStatus === "idle"
        ? []
        : routeDepartureConfidenceItems(
            routeDepartureCheckpointsForSelection,
            routeDepartureBoards,
          ),
    [routeDepartureBoardStatus, routeDepartureBoards, routeDepartureCheckpointsForSelection],
  );
  const routeWatchSummary = useMemo(
    () =>
      selectedRouteWatchSummary(
        travelPlan,
        selectedItineraryId,
        routeDepartureConfidenceItemsForSelection,
        routeDepartureBoardStatus,
      ),
    [
      routeDepartureBoardStatus,
      routeDepartureConfidenceItemsForSelection,
      selectedItineraryId,
      travelPlan,
    ],
  );
  const routeContextSummary = useMemo(() => buildRouteContextSummary(travelPlan), [travelPlan]);
  const routeChoiceModel = useMemo(
    () =>
      buildRouteChoiceModel({
        plan: travelPlan,
        selectedItineraryId,
        departureBoard,
        confidenceItems: routeDepartureConfidenceItemsForSelection,
        fetchStatus: routeDepartureBoardStatus,
        liveStatuses: itineraryLiveStatuses,
      }),
    [
      departureBoard,
      itineraryLiveStatuses,
      routeDepartureBoardStatus,
      routeDepartureConfidenceItemsForSelection,
      selectedItineraryId,
      travelPlan,
    ],
  );
  const travelTimeComparisonLiveCheck = useMemo(
    () =>
      travelTimeComparisonLiveCheckFromRouteDepartureConfidence(
        routeDepartureConfidenceItemsForSelection,
        routeDepartureBoardStatus,
      ),
    [routeDepartureBoardStatus, routeDepartureConfidenceItemsForSelection],
  );

  useEffect(() => {
    loadRouteDepartureBoards(routeDepartureCheckpointsForSelection);
  }, [loadRouteDepartureBoards, routeDepartureCheckpointsForSelection]);

  useEffect(() => {
    setTravelTimeComparison((current) => {
      if (!current.sources || !current.activePreset) return current;
      const model = buildTravelTimeComparisonModel(
        current.sources,
        current.activePreset,
        travelTimeComparisonLiveCheck,
      );
      return { ...current, status: model.status, model };
    });
  }, [travelTimeComparisonLiveCheck]);

  const highlightedEventIds = useMemo(() => {
    const highlightedIds = new Set<string>();
    if (selectedEventId) highlightedIds.add(selectedEventId);
    if (selectedCorridorId) {
      const affectedEventIds =
        data?.corridorImpacts?.find((impact) => impact.id === selectedCorridorId)
          ?.affectedEventIds ?? [];
      affectedEventIds.forEach((eventId) => highlightedIds.add(eventId));
    }
    if (travelPlan) {
      travelPlan.trafficImpacts.forEach((impact) => highlightedIds.add(impact.event.id));
    }
    return Array.from(highlightedIds);
  }, [data?.corridorImpacts, selectedCorridorId, selectedEventId, travelPlan]);

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds(nextBounds);
  }, []);

  const handleRouteContextFocus = useCallback((item: RouteContextItem) => {
    const eventId = eventIdForRouteContextItem(item);
    if (!eventId) return;
    setSelectedEventId(eventId);
  }, []);

  const applyTrafficFilters = useCallback(
    (filters: TrafficMapFilters) => {
      setSelectedPreset(filters.preset);
      setSelectedCategories(filters.categories);
      setSelectedSeverities(filters.severities);
      setVisibleContextLayers(filters.layers);
      setSearchParams(mergeTrafficFilterSearch(currentSearchString(trafficSearch), filters), {
        replace: true,
      });
      setSelectedCorridorId(undefined);
      setSelectedEventId(undefined);
    },
    [setSearchParams, trafficSearch],
  );

  const applyPreset = useCallback(
    (preset: Exclude<TrafficMapPreset, "custom">) => {
      applyTrafficFilters(trafficFiltersForPreset(preset, visibleContextLayers));
    },
    [applyTrafficFilters, visibleContextLayers],
  );

  const handleCategoriesChange = useCallback(
    (categories: TrafficEventCategory[]) => {
      applyTrafficFilters({
        preset: "custom",
        categories,
        severities: selectedSeverities,
        layers: visibleContextLayers,
      });
    },
    [applyTrafficFilters, selectedSeverities, visibleContextLayers],
  );

  const handleSeveritiesChange = useCallback(
    (severities: TrafficMapFilters["severities"]) => {
      applyTrafficFilters({
        preset: "custom",
        categories: selectedCategories,
        severities,
        layers: visibleContextLayers,
      });
    },
    [applyTrafficFilters, selectedCategories, visibleContextLayers],
  );

  const handleContextLayersChange = useCallback(
    (layers: TrafficLayerVisibility) => {
      applyTrafficFilters({
        preset: selectedPreset,
        categories: selectedCategories,
        severities: selectedSeverities,
        layers,
      });
    },
    [applyTrafficFilters, selectedCategories, selectedPreset, selectedSeverities],
  );

  const handleShowAllChange = useCallback(
    (showAll: boolean) => {
      handleContextLayersChange({ ...visibleContextLayers, showAll });
    },
    [handleContextLayersChange, visibleContextLayers],
  );

  const showPublicTransportDisruptions = useCallback(() => {
    handleContextLayersChange({
      ...visibleContextLayers,
      publicTransportDisruptions: true,
    });
  }, [handleContextLayersChange, visibleContextLayers]);

  const togglePublicTransportDisruptions = useCallback(() => {
    handleContextLayersChange({
      ...visibleContextLayers,
      publicTransportDisruptions: !visibleContextLayers.publicTransportDisruptions,
    });
  }, [handleContextLayersChange, visibleContextLayers]);

  const togglePublicTransportVehicles = useCallback(() => {
    handleContextLayersChange({
      ...visibleContextLayers,
      publicTransportVehicles: !visibleContextLayers.publicTransportVehicles,
    });
  }, [handleContextLayersChange, visibleContextLayers]);

  function handleUseCurrentLocation(): void {
    if (!("geolocation" in navigator)) {
      setLocationStatus("error");
      setLocationMessage("Nettleseren støtter ikke posisjon. Skriv inn adresse eller koordinater.");
      return;
    }

    setLocationStatus("loading");
    setLocationMessage("Henter posisjon fra nettleseren ...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          setLocationStatus("error");
          setLocationMessage("Nettleseren ga ikke en gyldig posisjon. Skriv inn adresse manuelt.");
          return;
        }

        const nextOrigin = formatCoordinateInput({ lat, lon });
        setOriginInput(nextOrigin);
        setSelectedOriginSuggestion(undefined);
        setActiveTravelRouteQueryOverride(undefined);
        setTravelPlanError(undefined);
        if (travelPlanLoading || travelPlan) {
          invalidateTravelPlan();
        }
        loadDepartureBoard({
          scope: "origin",
          label: "Din posisjon",
          center: { lat, lon },
        });
        setLocationStatus("success");
        setLocationMessage("Posisjonen brukes bare i nettleseren og lagres ikke av Nytt.");
      },
      (error) => {
        setLocationStatus("error");
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Posisjon ble ikke delt. Du kan fortsatt skrive inn adresse eller koordinater."
            : "Klarte ikke hente posisjon nå. Prøv igjen eller skriv inn startpunkt.",
        );
      },
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 },
    );
  }

  function handleSelectItinerary(itineraryId: string): void {
    setSelectedItineraryId(itineraryId);
    const context = departureBoardContextFromPlan(travelPlan, itineraryId);
    if (context) {
      loadDepartureBoard(context);
    }
  }

  function setTravelTimeComparisonFromSources(
    sources: TravelPlanComparisonSource[],
    activePreset: TravelPlanComparisonPreset,
  ): void {
    const model = buildTravelTimeComparisonModel(
      sources,
      activePreset,
      travelTimeComparisonLiveCheck,
    );
    setTravelTimeComparison({ status: model.status, model, sources, activePreset });
  }

  async function loadTravelPlanForInput(input: {
    originInput: string;
    destinationInput: string;
    timePreset: TravelTimePreset;
    updateSearch: boolean;
    routeQueryOverride?: RememberedTravelRouteQueryOverride;
    onAbort?: () => void;
  }) {
    setSuggestionResetToken((token) => token + 1);
    const requestId = invalidateTravelPlan({
      resetDepartureBoard: Boolean(
        travelPlanLoading || travelPlan || departureBoardContext.scope === "origin",
      ),
    });

    const originSuggestion =
      selectedOriginSuggestion?.label === input.originInput ? selectedOriginSuggestion : undefined;
    const destinationSuggestion =
      selectedDestinationSuggestion?.label === input.destinationInput
        ? selectedDestinationSuggestion
        : undefined;
    const from =
      input.routeQueryOverride?.from ??
      (originSuggestion
        ? travelSuggestionQuery(originSuggestion)
        : canonicalTravelPlannerQuery(input.originInput));
    const to =
      input.routeQueryOverride?.to ??
      (destinationSuggestion
        ? travelSuggestionQuery(destinationSuggestion)
        : canonicalTravelPlannerQuery(input.destinationInput));
    const fromLabel = input.routeQueryOverride?.fromLabel ?? originSuggestion?.label;
    const toLabel = input.routeQueryOverride?.toLabel ?? destinationSuggestion?.label;
    if (!from || !to) {
      setTravelPlanError("Skriv inn både start og mål.");
      if (input.updateSearch) updateTravelSearchParams();
      return;
    }
    if (input.updateSearch) {
      updateTravelSearchParams({
        originInput: input.originInput,
        destinationInput: input.destinationInput,
        timePreset: input.timePreset,
      });
    }

    const controller = new AbortController();
    travelPlanAbortRef.current = controller;
    setTravelPlanLoading(true);
    setTravelPlanError(undefined);
    if (isTravelTimeComparisonPreset(input.timePreset)) {
      const loadingModel = buildTravelTimeComparisonModel(
        [{ preset: input.timePreset, error: "Reisesøket hentes." }],
        input.timePreset,
      );
      setTravelTimeComparison({ status: "loading", model: loadingModel });
    } else {
      setTravelTimeComparison({ status: "idle" });
    }
    try {
      const request = {
        from,
        to,
        ...(fromLabel ? { fromLabel } : {}),
        ...(toLabel ? { toLabel } : {}),
        departAt: departureTimeForPreset(input.timePreset),
      };
      const comparisonPreset = isTravelTimeComparisonPreset(input.timePreset)
        ? input.timePreset
        : undefined;
      const comparisonPayload = comparisonPreset
        ? await fetchTravelPlanComparison(
            {
              ...request,
              preset: comparisonPreset,
            },
            { signal: controller.signal },
          )
        : undefined;
      const payload =
        comparisonPayload?.selectedPlan ??
        (await fetchTravelPlan(request, { signal: controller.signal }));
      if (travelPlanRequestIdRef.current !== requestId) return;
      setTravelPlan(payload);
      setSelectedItineraryId(payload.itineraries[0]?.id);
      if (comparisonPayload && comparisonPreset) {
        setTravelTimeComparisonFromSources(comparisonPayload.sources, comparisonPreset);
      } else {
        setTravelTimeComparison({ status: "idle" });
      }
      const originContext = departureBoardContextFromPlan(payload, payload.itineraries[0]?.id);
      if (originContext) {
        loadDepartureBoard(originContext);
      }
      const rememberedOriginLabel = fromLabel ?? payload.origin.label;
      const rememberedDestinationLabel = toLabel ?? payload.destination.label;
      const shouldRememberRoute = !(
        looksLikeCoordinateQuery(from) &&
        !originSuggestion &&
        !input.routeQueryOverride?.fromLabel
      );
      if (shouldRememberRoute) {
        updateRememberedRoutes((routes) =>
          upsertRememberedTravelRoute(routes, {
            originInput: input.originInput,
            destinationInput: input.destinationInput,
            originQuery: from,
            destinationQuery: to,
            ...(rememberedOriginLabel ? { originLabel: rememberedOriginLabel } : {}),
            ...(rememberedDestinationLabel ? { destinationLabel: rememberedDestinationLabel } : {}),
            timePreset: input.timePreset,
          }),
        );
      }
      showPublicTransportDisruptions();
    } catch (reason) {
      if (controller.signal.aborted) {
        input.onAbort?.();
        return;
      }
      if (travelPlanRequestIdRef.current === requestId) {
        setTravelPlanError(reason instanceof Error ? reason.message : "Kunne ikke hente reiseråd.");
      }
    } finally {
      if (travelPlanRequestIdRef.current === requestId) {
        setTravelPlanLoading(false);
        if (travelPlanAbortRef.current === controller) travelPlanAbortRef.current = undefined;
      }
    }
  }

  function handleTravelPlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadTravelPlanForInput({
      originInput,
      destinationInput,
      timePreset,
      updateSearch: true,
      routeQueryOverride: activeTravelRouteQueryOverride,
    });
  }

  useEffect(() => {
    if (!autoTravelSearchPending || !initialTravelSearch.shouldAutoSubmit) return;
    setAutoTravelSearchPending(false);
    void loadTravelPlanForInput({
      originInput: initialTravelSearch.originInput,
      destinationInput: initialTravelSearch.destinationInput,
      timePreset: initialTravelSearch.timePreset,
      updateSearch: false,
      onAbort: () => setAutoTravelSearchPending(true),
    });
  }, [autoTravelSearchPending]);

  return (
    <main className="traffic-page-shell">
      <TravelPlannerPanel
        originInput={originInput}
        destinationInput={destinationInput}
        timePreset={timePreset}
        travelPlan={travelPlan}
        travelPlanLoading={travelPlanLoading}
        travelPlanError={travelPlanError}
        selectedItineraryId={selectedItineraryId}
        selectedEventId={selectedEventId}
        routeChoiceModel={routeChoiceModel}
        routeWatchSummary={routeWatchSummary}
        routeContextSummary={routeContextSummary}
        onFocusRouteContextItem={handleRouteContextFocus}
        travelTimeComparison={travelTimeComparison}
        selectedOriginSuggestion={selectedOriginSuggestion}
        selectedDestinationSuggestion={selectedDestinationSuggestion}
        suggestionResetToken={suggestionResetToken}
        publicTransportDisruptionsVisible={visibleContextLayers.publicTransportDisruptions}
        publicTransportVehiclesVisible={visibleContextLayers.publicTransportVehicles}
        locationStatus={locationStatus}
        locationMessage={locationMessage}
        rememberedRoutes={rememberedRoutes}
        onOriginChange={handleOriginInputChange}
        onDestinationChange={handleDestinationInputChange}
        onSuggestionSelect={handleTravelSuggestionSelect}
        onDestinationPresetSelect={handleDestinationPresetSelect}
        onSwapRoute={handleSwapRouteInputs}
        onTimePresetChange={handleTravelTimePresetChange}
        onUseCurrentLocation={handleUseCurrentLocation}
        onSelectItinerary={handleSelectItinerary}
        onSelectComparisonPreset={handleTravelTimePresetChange}
        onSelectRememberedRoute={handleSelectRememberedRoute}
        onToggleRememberedRoutePinned={handleToggleRememberedRoutePinned}
        onRemoveRememberedRoute={handleRemoveRememberedRoute}
        onSubmit={(event) => void handleTravelPlanSubmit(event)}
        onToggleDisruptions={togglePublicTransportDisruptions}
        onToggleVehicles={togglePublicTransportVehicles}
      />
      {routeDepartureCheckpointsForSelection.length > 1 ? (
        <details className="traffic-support-disclosure">
          <summary>Live-sjekk av bytter</summary>
          <RouteDepartureConfidencePanel
            checkpoints={routeDepartureCheckpointsForSelection}
            results={routeDepartureBoards}
            fetchStatus={routeDepartureBoardStatus}
          />
        </details>
      ) : null}
      <details className="traffic-support-disclosure" open={!travelPlan}>
        <summary>{travelPlan ? "Avganger for valgt reise" : "Avganger nå"}</summary>
        <DepartureBoardPanel
          board={departureBoard}
          loading={departureBoardLoading}
          error={departureBoardError}
          context={departureBoardContext}
          routeOriginContext={routeOriginDepartureBoardContext}
          rememberedBoards={rememberedDepartureBoards}
          requestedLineFilterKey={requestedDepartureLineFilterKey}
          selectedDeparture={selectedDeparture}
          onReload={reloadDepartureBoard}
          onContextChange={handleDepartureBoardContextChange}
          onClearRequestedLineFilter={() => setRequestedDepartureLineFilterKey(undefined)}
          onRememberCurrentBoard={handleRememberCurrentDepartureBoard}
          onSelectRememberedBoard={handleSelectRememberedDepartureBoard}
          onRemoveRememberedBoard={handleRemoveRememberedDepartureBoard}
        />
      </details>
      <details className="traffic-support-disclosure">
        <summary>Trafikkbildet nå</summary>
        <TrafficNowSummary cards={summaryCardsForDisplay} />
      </details>
      <TrafficDataDisclosure
        sources={[
          ...(data?.sources ?? []),
          ...(publicTransportDisplayData?.sources ?? []),
          ...travelPlanSources,
        ]}
      />

      <details
        className="traffic-support-disclosure traffic-map-disclosure"
        open={!travelPlan || routeContextSummary.count > 0}
      >
        <summary>Kart og trafikkgrunnlag</summary>
        <section className="traffic-workspace" aria-label="Trafikkart og kartlag">
          <button
            type="button"
            className="traffic-mobile-layers-button"
            aria-expanded={mobileLayersOpen}
            aria-controls="traffic-workspace-sidebar"
            onClick={() => setMobileLayersOpen((open) => !open)}
          >
            Kartlag og filtre
          </button>
          <div
            id="traffic-workspace-sidebar"
            className={`traffic-workspace-sidebar${mobileLayersOpen ? " open" : ""}`}
          >
            <TrafficFilterPanel
              selectedCategories={selectedCategories}
              selectedSeverities={selectedSeverities}
              selectedPreset={selectedPreset}
              visibleContextLayers={visibleContextLayers}
              onCategoriesChange={handleCategoriesChange}
              onSeveritiesChange={handleSeveritiesChange}
              onPresetChange={applyPreset}
              onContextLayersChange={handleContextLayersChange}
            />
            <TrafficLegend />
            {loading || error ? (
              <section className="traffic-status-card">
                <h2>Datastatus</h2>
                <button type="button" onClick={reload} disabled={loading}>
                  {loading ? "Oppdaterer ..." : "Oppdater"}
                </button>
                {error ? <p role="alert">{error}</p> : <p>Henter trafikkdata ...</p>}
              </section>
            ) : null}
          </div>
          <MapContainer center={trondheimCenter} zoom={12} className="traffic-map">
            <TileLayer attribution="© Kartverket" url={tiles} />
            <MapAccessibility label="Trafikkart for Trondheim" />
            <MapBoundsWatcher onBoundsChange={handleBoundsChange} />
            <TrafficMapFocus
              selectedEvent={selectedEvent}
              travelPlan={travelPlan}
              selectedItineraryId={selectedItineraryId}
            />
            {visibleContextLayers.travelTime ? (
              <CorridorImpactLayer
                impacts={data?.corridorImpacts}
                selectedImpactId={selectedCorridorId}
                onSelectImpact={setSelectedCorridorId}
              />
            ) : null}
            {data?.events ? (
              <TrafficLayer
                events={visibleTrafficEvents}
                highlightedEventIds={highlightedEventIds}
                showEstimatedNews={visibleContextLayers.estimatedNews}
                onSelectEvent={setSelectedEventId}
              />
            ) : null}
            {data ? (
              <RoadContextLayer
                weather={visibleContextLayers.weatherRisk ? data.weather : []}
                cameras={visibleContextLayers.weatherRisk ? data.cameras : []}
                counters={visibleContextLayers.weatherRisk ? data.counters : []}
              />
            ) : null}
            <PublicTransportLayer
              payload={publicTransportDisplayData}
              visible={publicTransportVisible}
            />
            <TravelPlanLayer plan={travelPlan} selectedItineraryId={selectedItineraryId} />
          </MapContainer>
        </section>
      </details>

      <section className="traffic-bottom-panel" aria-label="Trafikkdetaljer">
        <div className="traffic-bottom-list">
          {!data ? (
            <section className="traffic-event-list-card">
              <header>
                <div>
                  <h2>{trafficListCopy.heading}</h2>
                  <span>0</span>
                </div>
                <button type="button" onClick={reload} disabled={loading}>
                  {loading ? "Oppdaterer ..." : "Oppdater"}
                </button>
              </header>
              {error ? (
                <p role="alert">{error}</p>
              ) : loading ? (
                <p>Henter trafikkdata ...</p>
              ) : (
                <p>Venter på første trafikkhenting ...</p>
              )}
            </section>
          ) : (
            <TrafficEventList
              rankedEvents={rankedEventsForList}
              selectedEventId={selectedEventId}
              showAll={visibleContextLayers.showAll}
              heading={trafficListCopy.heading}
              emptyMessage={trafficListCopy.emptyMessage}
              onShowAllChange={handleShowAllChange}
              onSelectEvent={setSelectedEventId}
            />
          )}
          {visibleContextLayers.travelTime && data?.corridorImpacts ? (
            <CorridorImpactCard
              impacts={data.corridorImpacts}
              events={visibleTrafficEvents}
              selectedImpactId={selectedCorridorId}
              onSelectImpact={setSelectedCorridorId}
            />
          ) : null}
          {publicTransportVisible ? (
            <PublicTransportSummary
              payload={publicTransportDisplayData}
              loading={publicTransportLoading}
              error={publicTransportError}
              onReload={reloadPublicTransport}
            />
          ) : null}
        </div>
        <TrafficDetailDrawer
          event={selectedEvent}
          corridorImpacts={data?.corridorImpacts ?? []}
          onClose={() => setSelectedEventId(undefined)}
        />
      </section>
    </main>
  );
}
