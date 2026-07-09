import type {
  TrafficEventSeverity,
  TravelPlanItinerary,
  TravelPlanLeg,
  TravelPlanPayload,
  TravelPlanTransitSuggestion,
} from "@nytt/shared";

export type JourneyAnswerKind = "transit" | "walk" | "handoff" | "idle";
export type JourneyAnswerSeverity = "ok" | "watch" | "warning";
export type JourneyMapPlacement = "primary" | "context" | "hidden";

export interface JourneyRouteOptionView {
  itineraryId: string;
  label: string;
  summary: string;
  meta: string;
  selected: boolean;
  severity: JourneyAnswerSeverity;
}

export interface JourneyAnswerView {
  kind: JourneyAnswerKind;
  heading: string;
  detail: string;
  meta: string;
  severity: JourneyAnswerSeverity;
  primaryItineraryId?: string;
  handoffUrl?: string;
  handoffLabel?: string;
  routeOptions: JourneyRouteOptionView[];
}

export interface JourneyContextItemView {
  id: string;
  title: string;
  detail: string;
  source: string;
  severity: JourneyAnswerSeverity;
  distanceLabel?: string;
  mapEventId?: string;
  href?: string;
}

export interface JourneyContextView {
  count: number;
  mapPointCount: number;
  heading: string;
  detail: string;
  mapCallouts: JourneyContextItemView[];
  compactItems: JourneyContextItemView[];
}

const operatorHandoffUrl = "https://www.atb.no/reiseplanlegger/";

function formatTravelDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function formatDuration(seconds?: number): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const roundedMinutes = Math.max(1, Math.round(seconds / 60));
  if (roundedMinutes < 60) return `${roundedMinutes} min`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes ? `${hours} t ${minutes} min` : `${hours} t`;
}

function formatDistance(meters?: number): string | undefined {
  if (meters === undefined || !Number.isFinite(meters)) return undefined;
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`;
  return `${(meters / 1000).toLocaleString("nb-NO", {
    maximumFractionDigits: meters < 10_000 ? 1 : 0,
  })} km`;
}

function modeLabel(mode: TravelPlanLeg["mode"]): string {
  switch (mode) {
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
    case "walk":
      return "Gå";
    default:
      return "Kollektiv";
  }
}

function itineraryTransferLabel(itinerary: TravelPlanItinerary): string {
  if (itinerary.transferCount === 0) return "Direkte";
  if (itinerary.transferCount === 1) return "1 bytte";
  return `${itinerary.transferCount} bytter`;
}

function lineLabel(leg: TravelPlanLeg): string {
  const mode = modeLabel(leg.mode);
  return leg.publicCode ? `${mode} ${leg.publicCode}` : mode;
}

function stopLabel(leg: TravelPlanLeg): string {
  return leg.from.stopName ?? leg.from.name;
}

function isBoardingLeg(leg: TravelPlanLeg): boolean {
  if (leg.cancelled) return false;
  if (leg.mode === "walk") return false;
  return Boolean(leg.publicCode || leg.lineId || leg.from.stopId || leg.from.stopName);
}

function firstBoardingLeg(itinerary?: TravelPlanItinerary): TravelPlanLeg | undefined {
  return itinerary?.legs.find(isBoardingLeg);
}

function selectedItinerary(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): TravelPlanItinerary | undefined {
  return (
    plan?.itineraries.find((itinerary) => itinerary.id === selectedItineraryId) ??
    plan?.itineraries[0]
  );
}

function itinerarySeverity(itinerary: TravelPlanItinerary): JourneyAnswerSeverity {
  if (itinerary.decision === "avoid") return "warning";
  if (itinerary.decision === "watch" || itinerary.disruptionCount > 0) return "watch";
  return "ok";
}

function itineraryPrimaryLabel(itinerary: TravelPlanItinerary): string {
  if (itinerary.labels.includes("best_now") || itinerary.decision === "best") return "Anbefalt";
  if (itinerary.labels.includes("fewest_transfers")) return "Færrest bytter";
  if (itinerary.labels.includes("soonest_departure")) return "Snarest";
  if (itinerary.labels.includes("most_robust")) return "Mest robust";
  if (itinerary.decision === "avoid") return "Unngå";
  if (itinerary.decision === "watch") return "Følg med";
  return "Alternativ";
}

function itinerarySummary(itinerary: TravelPlanItinerary): string {
  const boarding = firstBoardingLeg(itinerary);
  return boarding ? lineLabel(boarding) : "Gange";
}

function itineraryMeta(itinerary: TravelPlanItinerary): string {
  return [
    `${formatTravelDateTime(itinerary.departureTime)} → ${formatTravelDateTime(
      itinerary.arrivalTime,
    )}`,
    formatDuration(itinerary.durationSeconds),
    itineraryTransferLabel(itinerary),
    `${formatDuration(itinerary.walkTimeSeconds)} gange`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function isWalkOnlyItinerary(itinerary?: TravelPlanItinerary): itinerary is TravelPlanItinerary {
  return Boolean(itinerary?.legs.length) && itinerary!.legs.every((leg) => leg.mode === "walk");
}

function hasActionableJourney(itinerary?: TravelPlanItinerary): boolean {
  return Boolean(firstBoardingLeg(itinerary) || isWalkOnlyItinerary(itinerary));
}

function itineraryDistance(itinerary: TravelPlanItinerary): number | undefined {
  if (itinerary.distanceMeters !== undefined) return itinerary.distanceMeters;
  const distances = itinerary.legs
    .map((leg) => leg.distanceMeters)
    .filter((value) => value !== undefined);
  if (!distances.length) return undefined;
  return distances.reduce((sum, value) => sum + value, 0);
}

function routeOptions(
  plan: TravelPlanPayload,
  selectedItineraryId?: string,
): JourneyRouteOptionView[] {
  const selected = selectedItinerary(plan, selectedItineraryId);
  return plan.itineraries
    .filter(hasActionableJourney)
    .slice(0, 5)
    .map((itinerary) => ({
      itineraryId: itinerary.id,
      label: itineraryPrimaryLabel(itinerary),
      summary: itinerarySummary(itinerary),
      meta: itineraryMeta(itinerary),
      selected: itinerary.id === selected?.id,
      severity: itinerarySeverity(itinerary),
    }));
}

function hasUsefulRouteGeometry(plan?: TravelPlanPayload): boolean {
  return (
    (plan?.route.geometry.coordinates.length ?? 0) >= 2 && (plan?.route.distanceMeters ?? 0) > 0
  );
}

function hasUsefulLegGeometry(itinerary?: TravelPlanItinerary): boolean {
  return Boolean(itinerary?.legs.some((leg) => (leg.geometry?.coordinates.length ?? 0) >= 2));
}

function hasTrafficMapContext(plan?: TravelPlanPayload): boolean {
  return Boolean(plan?.trafficImpacts.some((impact) => impact.event.geometry));
}

function transitAnswer(
  plan: TravelPlanPayload,
  itinerary: TravelPlanItinerary,
  boardingLeg: TravelPlanLeg,
  selectedItineraryId?: string,
): JourneyAnswerView {
  return {
    kind: "transit",
    heading: `Ta ${lineLabel(boardingLeg)} fra ${stopLabel(boardingLeg)}`,
    detail: itinerary.decisionReason,
    meta: itineraryMeta(itinerary),
    severity: itinerarySeverity(itinerary),
    primaryItineraryId: itinerary.id,
    handoffUrl: itinerary.handoffUrl || operatorHandoffUrl,
    handoffLabel: "Åpne hos AtB/Entur",
    routeOptions: routeOptions(plan, selectedItineraryId),
  };
}

function walkingAnswer(plan: TravelPlanPayload, itinerary: TravelPlanItinerary): JourneyAnswerView {
  const distance = formatDistance(itineraryDistance(itinerary));
  const duration = formatDuration(itinerary.durationSeconds);
  return {
    kind: "walk",
    heading: `Gå til ${plan.destination.label}`,
    detail:
      itinerary.decisionReason ||
      "Entur foreslår gange hele veien. Nytt viser relevant trafikk langs ruten.",
    meta: [distance, duration ? `ca. ${duration}` : undefined].filter(Boolean).join(" · "),
    severity: plan.trafficImpacts.length ? "watch" : "ok",
    primaryItineraryId: itinerary.id,
    handoffUrl: operatorHandoffUrl,
    handoffLabel: "Sjekk AtB/Entur",
    routeOptions: routeOptions(plan, itinerary.id),
  };
}

function handoffAnswer(plan?: TravelPlanPayload): JourneyAnswerView {
  return {
    kind: plan ? "handoff" : "idle",
    heading: plan ? "Sjekk AtB/Entur" : "Planlegg reisen",
    detail: plan
      ? `${plan.journeyPlanner.detail} Nytt klarte ikke å finne en trygg reise akkurat nå.`
      : "Skriv start og mål for å se konkrete reisevalg.",
    meta: plan ? "AtB/Entur er fasit for avgang, billett og operatørvalg." : "",
    severity: plan ? "warning" : "watch",
    handoffUrl: operatorHandoffUrl,
    handoffLabel: plan ? "Åpne AtB/Entur" : undefined,
    routeOptions: plan ? routeOptions(plan) : [],
  };
}

export function buildJourneyAnswerView(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): JourneyAnswerView {
  if (!plan) return handoffAnswer();

  const itinerary = selectedItinerary(plan, selectedItineraryId);
  const boardingLeg = firstBoardingLeg(itinerary);
  if (itinerary && boardingLeg)
    return transitAnswer(plan, itinerary, boardingLeg, selectedItineraryId);

  if (isWalkOnlyItinerary(itinerary)) {
    return walkingAnswer(plan, itinerary);
  }

  return handoffAnswer(plan);
}

function sourceLabel(source: string): string {
  const normalized = source.toLocaleLowerCase("nb");
  if (normalized.includes("datex")) return "DATEX";
  if (normalized.includes("vegvesen")) return "Statens vegvesen";
  if (normalized.includes("entur")) return "Entur";
  return source;
}

function severityFromTraffic(
  severity?: TrafficEventSeverity | "info" | "warning",
): JourneyAnswerSeverity {
  if (severity === "critical" || severity === "high" || severity === "warning") return "warning";
  if (severity === "medium") return "watch";
  return "ok";
}

function distanceLabel(distanceMeters?: number): string | undefined {
  const distance = formatDistance(distanceMeters);
  return distance ? `${distance} fra foreslått rute` : undefined;
}

function transitSuggestionSeverity(suggestion: TravelPlanTransitSuggestion): JourneyAnswerSeverity {
  if (suggestion.kind === "alert") return "watch";
  return "ok";
}

export function buildJourneyContextView(plan?: TravelPlanPayload): JourneyContextView {
  const trafficItems: JourneyContextItemView[] = (plan?.trafficImpacts ?? []).map((impact) => ({
    id: `traffic:${impact.event.id}`,
    title: impact.event.title,
    detail:
      impact.summary ||
      impact.event.description ||
      impact.event.roadName ||
      "Trafikkhendelse langs valgt rute.",
    source: sourceLabel(impact.event.source),
    severity: severityFromTraffic(impact.severity),
    distanceLabel: distanceLabel(impact.distanceMeters),
    mapEventId: impact.event.id,
  }));

  const transitItems: JourneyContextItemView[] = (plan?.publicTransportSuggestions ?? [])
    .filter((suggestion) => suggestion.kind === "alert")
    .map((suggestion) => ({
      id: `transit:${suggestion.id}`,
      title: suggestion.title,
      detail: suggestion.detail,
      source: sourceLabel(suggestion.source),
      severity: transitSuggestionSeverity(suggestion),
      distanceLabel: distanceLabel(suggestion.distanceMeters),
      href: suggestion.href,
    }));

  const compactItems = [...trafficItems, ...transitItems].slice(0, 6);
  const mapCallouts = trafficItems;
  const mapPart = mapCallouts.length
    ? `${mapCallouts.length} kartpunkt${mapCallouts.length === 1 ? "" : "er"}`
    : undefined;
  const lineAlertCount = transitItems.filter((item) => !item.mapEventId).length;
  const alertPart = lineAlertCount
    ? `${lineAlertCount} linjevarsel${lineAlertCount === 1 ? "" : "er"}`
    : undefined;
  const heading = [mapPart, alertPart].filter(Boolean).join(" · ");

  if (!compactItems.length) {
    return {
      count: 0,
      mapPointCount: 0,
      heading: "Ingen kjente hindringer",
      detail: "Nytt fant ingen trafikkpunkter eller kollektivvarsel langs valgt rute.",
      mapCallouts: [],
      compactItems: [],
    };
  }

  return {
    count: compactItems.length,
    mapPointCount: mapCallouts.length,
    heading,
    detail: mapCallouts.length
      ? "Kartet viser punktene langs ruten. Varsler uten kartpunkt holdes kompakt."
      : "Varslene har ikke egne kartpunkter og vises kompakt.",
    mapCallouts,
    compactItems,
  };
}

export function shouldShowJourneyMap(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): boolean {
  return getJourneyMapPlacement(plan, selectedItineraryId) !== "hidden";
}

export function getJourneyMapPlacement(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): JourneyMapPlacement {
  if (!plan) return "hidden";

  const itinerary = selectedItinerary(plan, selectedItineraryId);
  if (hasActionableJourney(itinerary) && hasUsefulLegGeometry(itinerary)) {
    return "primary";
  }

  if (hasUsefulRouteGeometry(plan) || hasTrafficMapContext(plan)) return "context";

  return "hidden";
}
