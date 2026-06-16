import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
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
import { buildTrafficViewModel, visibleByDefault } from "../trafficViewModel.js";

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
  return (
    <article className="travel-plan-card">
      <header>
        <p className="label">Reiseråd</p>
        <h2>Reiseråd for ruten</h2>
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
      }),
    [data, publicTransportDisplayData, visibleContextLayers.showAll],
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

  const visibleTrafficEvents = useMemo(() => {
    const events = data?.events ?? [];
    return events.filter((event) => {
      const isRoadwork = event.category === "roadworks";
      if (isRoadwork && !visibleContextLayers.roadworks) return false;
      if (!isRoadwork && !visibleContextLayers.incidents) return false;
      if (!visibleContextLayers.showAll && !visibleByDefault(event)) return false;
      return true;
    });
  }, [
    data?.events,
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
          <form
            className="route-planner-form"
            onSubmit={(event) => void handleTravelPlanSubmit(event)}
          >
            <div>
              <label htmlFor="travel-origin">Hvor er du?</label>
              <input
                id="travel-origin"
                value={originInput}
                onChange={(event) => handleTravelInputChange(event.target.value, setOriginInput)}
                placeholder="F.eks. Munkegata eller 63.43, 10.39"
              />
            </div>
            <div>
              <label htmlFor="travel-destination">Hvor skal du?</label>
              <input
                id="travel-destination"
                value={destinationInput}
                onChange={(event) =>
                  handleTravelInputChange(event.target.value, setDestinationInput)
                }
                placeholder="F.eks. Leangen"
              />
            </div>
            <button type="submit" disabled={travelPlanLoading}>
              {travelPlanLoading ? "Henter reiseråd ..." : "Finn reiseråd"}
            </button>
          </form>
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
          <TravelPlanCard plan={travelPlan} loading={travelPlanLoading} error={travelPlanError} />
          {!data ? (
            <section className="traffic-event-list-card">
              <header>
                <div>
                  <h2>Aktive trafikksituasjoner</h2>
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
          {visibleContextLayers.publicTransportDisruptions ? (
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
