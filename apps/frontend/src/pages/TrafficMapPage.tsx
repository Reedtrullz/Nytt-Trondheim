import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type {
  TrafficCorridorImpact,
  TrafficEventCategory,
  TrafficEventState,
  TrafficEventSeverity,
  TrafficMapEvent,
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

const trondheimCenter: [number, number] = [63.4305, 10.3951];
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

export function routePositions(plan: TravelPlanPayload): [number, number][] {
  return latLngsFromLineString(plan.route.geometry);
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

export function travelPlanDecision(plan?: TravelPlanPayload): {
  heading: string;
  detail: string;
  roadImpactCount: number;
  vehicleCount: number;
  alertCount: number;
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
  const strongestRoadImpact = strongestRouteImpact(plan);
  const hasHighRoadImpact = strongestRoadImpact === "critical" || strongestRoadImpact === "high";

  if (hasHighRoadImpact || alertCount > 0) {
    return {
      heading: "Sjekk ruten før du drar",
      detail: `${roadImpactCount} vegmelding${roadImpactCount === 1 ? "" : "er"} og ${alertCount} kollektivavvik kan påvirke reisen.`,
      roadImpactCount,
      vehicleCount,
      alertCount,
      severity: "warning",
    };
  }

  if (roadImpactCount > 0 || vehicleCount > 0) {
    return {
      heading: "Følg med på ruten",
      detail: `${roadImpactCount} vegmelding${roadImpactCount === 1 ? "" : "er"} og ${vehicleCount} kollektivkjøretøy er funnet nær korridoren.`,
      roadImpactCount,
      vehicleCount,
      alertCount,
      severity: "watch",
    };
  }

  return {
    heading: "Ingen kjente hindringer langs ruten",
    detail: "Nytt fant ingen aktive vegmeldinger eller kollektivavvik langs korridoren akkurat nå.",
    roadImpactCount,
    vehicleCount,
    alertCount,
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

function TravelPlanLayer({ plan }: { plan?: TravelPlanPayload }) {
  if (!plan) return null;
  const positions = routePositions(plan);
  const origin = latLngFromGeoJsonPosition(plan.origin.coordinate);
  const destination = latLngFromGeoJsonPosition(plan.destination.coordinate);
  const routeSeverity = strongestRouteImpact(plan);
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
}: {
  selectedEvent?: TrafficMapEvent;
  travelPlan?: TravelPlanPayload;
}) {
  const map = useMap();
  const selectedEventFocusKey = selectedEvent?.id;
  const selectedEventGeometryKey = selectedEvent ? JSON.stringify(selectedEvent.geometry) : "";
  const selectedEventBounds = useMemo(
    () => (selectedEvent ? boundsFromGeometry(selectedEvent.geometry) : undefined),
    [selectedEventFocusKey, selectedEventGeometryKey],
  );
  const travelPlanFocusKey = travelPlan
    ? `${travelPlan.generatedAt}:${travelPlan.origin.label}:${travelPlan.destination.label}`
    : undefined;
  const travelPlanRouteKey = travelPlan
    ? routePositions(travelPlan)
        .map((position) => position.join(","))
        .join("|")
    : "";
  const travelPlanBounds = useMemo(
    () => (travelPlan ? boundsFromLatLngs(routePositions(travelPlan)) : undefined),
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

function TravelPlanCard({
  plan,
  loading,
  error,
}: {
  plan?: TravelPlanPayload;
  loading: boolean;
  error?: string;
}) {
  if (error) {
    return (
      <p className="route-planner-status error" role="alert">
        {error}
      </p>
    );
  }
  if (loading) return <p className="route-planner-status">Henter reiseråd ...</p>;
  if (!plan) {
    return (
      <p className="route-planner-status">
        Skriv inn start og mål for å se trafikkhendelser og kollektivkontekst langs ruten.
      </p>
    );
  }
  const duration = formatDuration(plan.route.durationSeconds);
  const decision = travelPlanDecision(plan);
  return (
    <article className={`travel-plan-card travel-plan-card-${decision.severity}`}>
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
      <section>
        <h3>Kollektivforslag</h3>
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
    </article>
  );
}

function TravelPlannerPanel({
  originInput,
  destinationInput,
  travelPlan,
  travelPlanLoading,
  travelPlanError,
  publicTransportDisruptionsVisible,
  publicTransportVehiclesVisible,
  onOriginChange,
  onDestinationChange,
  onSubmit,
  onShowDisruptions,
  onShowVehicles,
}: {
  originInput: string;
  destinationInput: string;
  travelPlan?: TravelPlanPayload;
  travelPlanLoading: boolean;
  travelPlanError?: string;
  publicTransportDisruptionsVisible: boolean;
  publicTransportVehiclesVisible: boolean;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onShowDisruptions: () => void;
  onShowVehicles: () => void;
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
            onClick={onShowDisruptions}
          >
            Vis kollektivavvik
          </button>
          <button
            type="button"
            className={publicTransportVehiclesVisible ? "selected" : undefined}
            aria-pressed={publicTransportVehiclesVisible}
            onClick={onShowVehicles}
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
            />
          </div>
          <div>
            <label htmlFor="travel-destination">Hvor skal du?</label>
            <input
              id="travel-destination"
              value={destinationInput}
              onChange={(event) => onDestinationChange(event.target.value)}
              placeholder="F.eks. Leangen"
            />
          </div>
          <button type="submit" disabled={travelPlanLoading}>
            {travelPlanLoading ? "Henter reiseråd ..." : "Finn reiseråd"}
          </button>
        </form>
        <TravelPlanCard plan={travelPlan} loading={travelPlanLoading} error={travelPlanError} />
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
  const [travelPlan, setTravelPlan] = useState<TravelPlanPayload>();
  const [travelPlanLoading, setTravelPlanLoading] = useState(false);
  const [travelPlanError, setTravelPlanError] = useState<string>();
  const travelPlanRequestIdRef = useRef(0);
  const travelPlanAbortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => travelPlanAbortRef.current?.abort(), []);

  useEffect(() => {
    setSelectedPreset(trafficFilters.preset);
    setSelectedCategories(trafficFilters.categories);
    setSelectedSeverities(trafficFilters.severities);
    setVisibleContextLayers(trafficFilters.layers);
    setSelectedCorridorId(undefined);
    setSelectedEventId(undefined);
  }, [trafficFilters]);

  function invalidateTravelPlan(): number {
    const requestId = travelPlanRequestIdRef.current + 1;
    travelPlanRequestIdRef.current = requestId;
    travelPlanAbortRef.current?.abort();
    travelPlanAbortRef.current = undefined;
    setTravelPlan(undefined);
    setTravelPlanLoading(false);
    return requestId;
  }

  function handleTravelInputChange(value: string, setter: (nextValue: string) => void): void {
    setter(value);
    setTravelPlanError(undefined);
    if (travelPlanLoading || travelPlan) {
      invalidateTravelPlan();
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

  const showPublicTransportVehicles = useCallback(() => {
    handleContextLayersChange({
      ...visibleContextLayers,
      publicTransportVehicles: true,
    });
  }, [handleContextLayersChange, visibleContextLayers]);

  async function handleTravelPlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = invalidateTravelPlan();

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
      const payload = await fetchTravelPlan({ from, to }, { signal: controller.signal });
      if (travelPlanRequestIdRef.current !== requestId) return;
      setTravelPlan(payload);
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
        travelPlan={travelPlan}
        travelPlanLoading={travelPlanLoading}
        travelPlanError={travelPlanError}
        publicTransportDisruptionsVisible={visibleContextLayers.publicTransportDisruptions}
        publicTransportVehiclesVisible={visibleContextLayers.publicTransportVehicles}
        onOriginChange={(value) => handleTravelInputChange(value, setOriginInput)}
        onDestinationChange={(value) => handleTravelInputChange(value, setDestinationInput)}
        onSubmit={(event) => void handleTravelPlanSubmit(event)}
        onShowDisruptions={showPublicTransportDisruptions}
        onShowVehicles={showPublicTransportVehicles}
      />
      <TrafficNowSummary cards={summaryCardsForDisplay} />

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
          <TrafficMapFocus selectedEvent={selectedEvent} travelPlan={travelPlan} />
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
          <TravelPlanLayer plan={travelPlan} />
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
