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
  TravelPlanItinerary,
  TravelPlanItineraryLabel,
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
import { fetchTravelPlan } from "../api/travelPlan.js";
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

type TravelTimePreset = "now" | "in30" | "tomorrow_morning";

export function departureTimeForPreset(preset: TravelTimePreset, base = new Date()): string {
  if (preset === "in30") return new Date(base.getTime() + 30 * 60 * 1000).toISOString();
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
    case "tomorrow_morning":
      return "I morgen tidlig";
    case "now":
    default:
      return "Nå";
  }
}

function itineraryLabel(label: TravelPlanItineraryLabel): string {
  switch (label) {
    case "best_now":
      return "Beste nå";
    case "fewest_transfers":
      return "Færrest bytter";
    case "soonest_departure":
      return "Snarest avgang";
    case "most_robust":
      return "Mest robust";
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

function firstBoardingLeg(itinerary?: TravelPlanItinerary): TravelPlanLeg | undefined {
  return itinerary?.legs.find((leg) => {
    if (leg.mode === "walk") return false;
    return Boolean(leg.publicCode || leg.lineId || leg.from.stopId || leg.from.stopName);
  });
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

export function selectedDepartureMatch(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
  board?: PublicTransportDepartureBoardPayload,
): SelectedDepartureMatch | undefined {
  const leg = firstBoardingLeg(selectedItineraryForPlan(plan, selectedItineraryId));
  if (!leg) return undefined;
  let best: PublicTransportDeparture | undefined;
  let bestScore = 0;
  for (const departure of board?.departures ?? []) {
    const score = scoreDepartureForLeg(departure, leg);
    if (score > bestScore) {
      best = departure;
      bestScore = score;
    }
  }
  return {
    leg,
    departure: bestScore >= 7 ? best : undefined,
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

function ItineraryCard({
  itinerary,
  selected,
  onSelect,
}: {
  itinerary: TravelPlanItinerary;
  selected: boolean;
  onSelect: () => void;
}) {
  const safeHandoff = safeExternalUrl(itinerary.handoffUrl);
  const noticeCount = itinerary.legs.reduce((count, leg) => count + leg.notices.length, 0);
  const itineraryTimeLabel = `${formatTravelDateTime(itinerary.departureTime)} til ${formatTravelDateTime(
    itinerary.arrivalTime,
  )}`;
  return (
    <article
      className={`itinerary-card itinerary-card-${itinerary.decision}${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <header>
        <div className="itinerary-card-labels">
          {itinerary.labels.map((label) => (
            <span key={label}>{itineraryLabel(label)}</span>
          ))}
          <strong>{itineraryDecisionLabel(itinerary.decision)}</strong>
        </div>
        <h3>
          {formatTravelDateTime(itinerary.departureTime)} →{" "}
          {formatTravelDateTime(itinerary.arrivalTime)}
        </h3>
        <p>
          {formatDuration(itinerary.durationSeconds)} ·{" "}
          {itinerary.transferCount === 0
            ? "Direkte"
            : `${itinerary.transferCount} bytte${itinerary.transferCount === 1 ? "" : "r"}`}{" "}
          · {formatDuration(itinerary.walkTimeSeconds)} gange
        </p>
        <small>{itinerary.decisionReason}</small>
      </header>
      <ol className="itinerary-leg-list">
        {itinerary.legs.map((leg) => (
          <li key={leg.id}>
            <div>
              <strong>
                {leg.publicCode ? `${modeLabel(leg.mode)} ${leg.publicCode}` : modeLabel(leg.mode)}
              </strong>
              <span>
                {formatTravelDateTime(leg.expectedStartTime)} {leg.from.stopName ?? leg.from.name} →{" "}
                {formatTravelDateTime(leg.expectedEndTime)} {leg.to.stopName ?? leg.to.name}
              </span>
            </div>
            {leg.lineName ? <small>{leg.lineName}</small> : null}
            {leg.notices.length ? (
              <div className="itinerary-leg-notices">
                {leg.notices.slice(0, 3).map((notice) => (
                  <span key={notice.id}>{notice.title}</span>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <footer>
        <span>
          {itinerary.realtime ? "Sanntid inkludert" : "Rutetid"} · {noticeCount} varsel
          {noticeCount === 1 ? "" : "er"}
        </span>
        <button
          type="button"
          className="itinerary-card-select"
          aria-pressed={selected}
          aria-label={
            selected
              ? `Reiseforslag ${itineraryTimeLabel} vises på kart`
              : `Vis reiseforslag ${itineraryTimeLabel} på kart`
          }
          onClick={onSelect}
        >
          {selected ? "Vises på kart" : "Vis på kart"}
        </button>
        {safeHandoff ? (
          <a
            href={safeHandoff}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Åpne reiseforslag ${itineraryTimeLabel} hos AtB/Entur`}
          >
            Åpne hos AtB/Entur
          </a>
        ) : null}
      </footer>
    </article>
  );
}

function TravelPlanCard({
  plan,
  loading,
  error,
  selectedItineraryId,
  onSelectItinerary,
}: {
  plan?: TravelPlanPayload;
  loading: boolean;
  error?: string;
  selectedItineraryId?: string;
  onSelectItinerary: (itineraryId: string) => void;
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
  const showFallbackSuggestions =
    plan.itineraries.length === 0 && plan.publicTransportSuggestions.length > 0;
  return (
    <article
      className={`travel-plan-card travel-plan-card-${decision.severity}`}
      aria-live="polite"
    >
      <header>
        <p className="label">Reiseråd</p>
        <h2>{decision.heading}</h2>
        <p>{decision.detail}</p>
        <div className="travel-plan-decision-grid" aria-label="Rutevurdering">
          <article>
            <span>{decision.roadImpactCount}</span>
            <strong>Vegmeldinger</strong>
            <small>langs korridoren</small>
          </article>
          <article>
            <span>{decision.alertCount}</span>
            <strong>Kollektivavvik</strong>
            <small>fra Entur/AtB</small>
          </article>
          <article>
            <span>{decision.vehicleCount}</span>
            <strong>Kjøretøy nær ruten</strong>
            <small>buss, trikk, tog eller båt</small>
          </article>
          <article>
            <span>{decision.itineraryCount}</span>
            <strong>Reiseforslag</strong>
            <small>fra Entur</small>
          </article>
        </div>
        <h3>Rute</h3>
        <p>
          {plan.origin.label} → {plan.destination.label}
        </p>
        <small>
          {formatDistance(plan.route.distanceMeters)}
          {duration ? ` · ${duration}` : ""} · {plan.route.detail}
        </small>
      </header>
      <section>
        <h3>Kollektivvalg</h3>
        {plan.journeyPlanner.status === "unavailable" ? (
          <p className="route-planner-status warning">{plan.journeyPlanner.detail}</p>
        ) : null}
        {plan.journeyPlanner.status === "empty" ? (
          <p className="route-planner-status">Ingen konkrete Entur-reiser funnet for valgt tid.</p>
        ) : null}
        {plan.itineraries.length ? (
          <div className="itinerary-grid">
            {plan.itineraries.map((itinerary) => (
              <ItineraryCard
                key={itinerary.id}
                itinerary={itinerary}
                selected={itinerary.id === selectedItineraryId}
                onSelect={() => onSelectItinerary(itinerary.id)}
              />
            ))}
          </div>
        ) : null}
      </section>
      <section>
        <h3>Trafikk langs ruten</h3>
        {plan.trafficImpacts.length ? (
          <ul>
            {plan.trafficImpacts.map((impact) => (
              <li key={impact.event.id}>
                <strong>{impact.event.title}</strong>
                <span>{impact.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Ingen aktive trafikkhendelser funnet langs ruten akkurat nå.</p>
        )}
      </section>
      {showFallbackSuggestions ? (
        <section>
          <h3>Kollektivkontekst</h3>
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
        </section>
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

function DepartureBoardPanel({
  board,
  loading,
  error,
  context,
  routeOriginContext,
  selectedDeparture,
  onReload,
  onContextChange,
}: {
  board?: PublicTransportDepartureBoardPayload;
  loading: boolean;
  error?: string;
  context: DepartureBoardContext;
  routeOriginContext?: DepartureBoardContext;
  selectedDeparture?: SelectedDepartureMatch;
  onReload: () => void;
  onContextChange: (context: DepartureBoardContext) => void;
}) {
  const safeHandoff = safeExternalUrl(board?.handoffUrl ?? "https://www.atb.no/reiseplanlegger/");
  const displayedDepartures = Array.isArray(board?.departures) ? board.departures.slice(0, 8) : [];
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
          <button type="button" onClick={onReload} disabled={loading}>
            {loading ? "Oppdaterer ..." : "Oppdater"}
          </button>
          {safeHandoff ? (
            <a href={safeHandoff} target="_blank" rel="noreferrer noopener">
              AtB/Entur
            </a>
          ) : null}
        </div>
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

function TravelPlannerPanel({
  originInput,
  destinationInput,
  timePreset,
  travelPlan,
  travelPlanLoading,
  travelPlanError,
  selectedItineraryId,
  publicTransportDisruptionsVisible,
  publicTransportVehiclesVisible,
  locationStatus,
  locationMessage,
  onOriginChange,
  onDestinationChange,
  onTimePresetChange,
  onUseCurrentLocation,
  onSelectItinerary,
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
  publicTransportDisruptionsVisible: boolean;
  publicTransportVehiclesVisible: boolean;
  locationStatus: LocationRequestStatus;
  locationMessage?: string;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onTimePresetChange: (value: TravelTimePreset) => void;
  onUseCurrentLocation: () => void;
  onSelectItinerary: (itineraryId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleDisruptions: () => void;
  onToggleVehicles: () => void;
}) {
  return (
    <section className="travel-planner-panel" aria-labelledby="travel-planner-heading">
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
      <div className="travel-planner-workbench">
        <form className="route-planner-form route-planner-form-primary" onSubmit={onSubmit}>
          <div>
            <label htmlFor="travel-origin">Hvor er du?</label>
            <input
              id="travel-origin"
              value={originInput}
              onChange={(event) => onOriginChange(event.target.value)}
              placeholder="F.eks. Munkegata eller 63.43, 10.39"
              aria-describedby="travel-plan-result"
              aria-invalid={Boolean(travelPlanError)}
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
            <label htmlFor="travel-destination">Hvor skal du?</label>
            <input
              id="travel-destination"
              value={destinationInput}
              onChange={(event) => onDestinationChange(event.target.value)}
              placeholder="F.eks. Leangen"
              aria-describedby="travel-plan-result"
              aria-invalid={Boolean(travelPlanError)}
            />
          </div>
          <div>
            <label htmlFor="travel-time">Når?</label>
            <select
              id="travel-time"
              value={timePreset}
              onChange={(event) => onTimePresetChange(event.target.value as TravelTimePreset)}
            >
              <option value="now">{travelTimePresetLabel("now")}</option>
              <option value="in30">{travelTimePresetLabel("in30")}</option>
              <option value="tomorrow_morning">{travelTimePresetLabel("tomorrow_morning")}</option>
            </select>
          </div>
          <button type="submit" disabled={travelPlanLoading}>
            {travelPlanLoading ? "Henter reiseråd ..." : "Finn reiseråd"}
          </button>
        </form>
        <div id="travel-plan-result" className="travel-planner-result">
          <TravelPlanCard
            plan={travelPlan}
            loading={travelPlanLoading}
            error={travelPlanError}
            selectedItineraryId={selectedItineraryId}
            onSelectItinerary={onSelectItinerary}
          />
        </div>
      </div>
    </section>
  );
}

export function TrafficMapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const trafficSearch = searchParams.toString();
  const trafficFilters = useMemo(() => parseTrafficMapFilters(trafficSearch), [trafficSearch]);
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
  const [originInput, setOriginInput] = useState("");
  const [destinationInput, setDestinationInput] = useState("");
  const [timePreset, setTimePreset] = useState<TravelTimePreset>("now");
  const [locationStatus, setLocationStatus] = useState<LocationRequestStatus>("idle");
  const [locationMessage, setLocationMessage] = useState<string>();
  const [travelPlan, setTravelPlan] = useState<TravelPlanPayload>();
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | undefined>();
  const [travelPlanLoading, setTravelPlanLoading] = useState(false);
  const [travelPlanError, setTravelPlanError] = useState<string>();
  const [departureBoard, setDepartureBoard] = useState<PublicTransportDepartureBoardPayload>();
  const [departureBoardContext, setDepartureBoardContext] = useState<DepartureBoardContext>(
    defaultDepartureBoardContext,
  );
  const [departureBoardLoading, setDepartureBoardLoading] = useState(false);
  const [departureBoardError, setDepartureBoardError] = useState<string>();
  const travelPlanRequestIdRef = useRef(0);
  const travelPlanAbortRef = useRef<AbortController | undefined>(undefined);
  const departureBoardAbortRef = useRef<AbortController | undefined>(undefined);

  const loadDepartureBoard = useCallback((context: DepartureBoardContext) => {
    departureBoardAbortRef.current?.abort();
    const controller = new AbortController();
    departureBoardAbortRef.current = controller;
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
  }, []);

  const reloadDepartureBoard = useCallback(() => {
    loadDepartureBoard(departureBoardContext);
  }, [departureBoardContext, loadDepartureBoard]);

  useEffect(() => {
    loadDepartureBoard(defaultDepartureBoardContext);
    return () => {
      travelPlanAbortRef.current?.abort();
      departureBoardAbortRef.current?.abort();
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
    setTravelPlan(undefined);
    setSelectedItineraryId(undefined);
    setTravelPlanLoading(false);
    if (options.resetDepartureBoard) {
      loadDepartureBoard(defaultDepartureBoardContext);
    }
    return requestId;
  }

  function handleTravelInputChange(value: string, setter: (nextValue: string) => void): void {
    setter(value);
    setTravelPlanError(undefined);
    if (travelPlanLoading || travelPlan) {
      invalidateTravelPlan({ resetDepartureBoard: true });
    }
  }

  function handleOriginInputChange(value: string): void {
    setLocationStatus("idle");
    setLocationMessage(undefined);
    handleTravelInputChange(value, setOriginInput);
  }

  function handleTravelTimePresetChange(value: TravelTimePreset): void {
    setTimePreset(value);
    setTravelPlanError(undefined);
    if (travelPlanLoading || travelPlan) {
      invalidateTravelPlan({ resetDepartureBoard: true });
    }
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
  const selectedDeparture = useMemo(
    () => selectedDepartureMatch(travelPlan, selectedItineraryId, departureBoard),
    [departureBoard, selectedItineraryId, travelPlan],
  );

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

  const applyTrafficFilters = useCallback(
    (filters: TrafficMapFilters) => {
      setSelectedPreset(filters.preset);
      setSelectedCategories(filters.categories);
      setSelectedSeverities(filters.severities);
      setVisibleContextLayers(filters.layers);
      setSearchParams(buildTrafficMapSearch(filters), { replace: true });
      setSelectedCorridorId(undefined);
      setSelectedEventId(undefined);
    },
    [setSearchParams],
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

  async function handleTravelPlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = invalidateTravelPlan({
      resetDepartureBoard: Boolean(
        travelPlanLoading || travelPlan || departureBoardContext.scope === "origin",
      ),
    });

    const from = originInput.trim();
    const to = destinationInput.trim();
    if (!from || !to) {
      setTravelPlanError("Skriv inn både start og mål.");
      return;
    }

    const controller = new AbortController();
    travelPlanAbortRef.current = controller;
    setTravelPlanLoading(true);
    setTravelPlanError(undefined);
    try {
      const payload = await fetchTravelPlan(
        { from, to, departAt: departureTimeForPreset(timePreset) },
        { signal: controller.signal },
      );
      if (travelPlanRequestIdRef.current !== requestId) return;
      setTravelPlan(payload);
      setSelectedItineraryId(payload.itineraries[0]?.id);
      const originContext = departureBoardContextFromPlan(payload, payload.itineraries[0]?.id);
      if (originContext) {
        loadDepartureBoard(originContext);
      }
      showPublicTransportDisruptions();
    } catch (reason) {
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
        publicTransportDisruptionsVisible={visibleContextLayers.publicTransportDisruptions}
        publicTransportVehiclesVisible={visibleContextLayers.publicTransportVehicles}
        locationStatus={locationStatus}
        locationMessage={locationMessage}
        onOriginChange={handleOriginInputChange}
        onDestinationChange={(value) => handleTravelInputChange(value, setDestinationInput)}
        onTimePresetChange={handleTravelTimePresetChange}
        onUseCurrentLocation={handleUseCurrentLocation}
        onSelectItinerary={handleSelectItinerary}
        onSubmit={(event) => void handleTravelPlanSubmit(event)}
        onToggleDisruptions={togglePublicTransportDisruptions}
        onToggleVehicles={togglePublicTransportVehicles}
      />
      <DepartureBoardPanel
        board={departureBoard}
        loading={departureBoardLoading}
        error={departureBoardError}
        context={departureBoardContext}
        routeOriginContext={routeOriginDepartureBoardContext}
        selectedDeparture={selectedDeparture}
        onReload={reloadDepartureBoard}
        onContextChange={loadDepartureBoard}
      />
      <TrafficNowSummary cards={summaryCardsForDisplay} />
      <TrafficDataDisclosure
        sources={[
          ...(data?.sources ?? []),
          ...(publicTransportDisplayData?.sources ?? []),
          ...travelPlanSources,
        ]}
      />

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
