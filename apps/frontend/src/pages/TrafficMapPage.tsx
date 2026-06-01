import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";
import type {
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficEventState,
  TravelPlanPayload,
} from "@nytt/shared";
import { CorridorImpactCard } from "../components/map/CorridorImpactCard.js";
import { MapBoundsWatcher } from "../components/map/MapBoundsWatcher.js";
import {
  PublicTransportLayer,
  PublicTransportSummary,
} from "../components/map/PublicTransportLayer.js";
import { RoadContextLayer } from "../components/map/RoadContextLayer.js";
import { TrafficBriefCard } from "../components/map/TrafficBriefCard.js";
import { TrafficEventList } from "../components/map/TrafficEventList.js";
import {
  TrafficFilterPanel,
  type RoadContextLayerVisibility,
  type TrafficMapPreset,
} from "../components/map/TrafficFilterPanel.js";
import { TrafficLayer } from "../components/map/TrafficLayer.js";
import { fetchTravelPlan } from "../api/travelPlan.js";
import { usePublicTransportMap } from "../hooks/usePublicTransportMap.js";
import { useTrafficMap } from "../hooks/useTrafficMap.js";

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
const allCategories: TrafficEventCategory[] = [
  "roadworks",
  "accident",
  "closure",
  "congestion",
  "weather",
  "restriction",
  "obstruction",
  "other",
];
const allSeverities: TrafficEventSeverity[] = ["low", "medium", "high", "critical"];
const defaultContextLayers: RoadContextLayerVisibility = {
  weather: true,
  cameras: false,
  counters: false,
  publicTransport: false,
};

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function timeWindowForPreset(preset: TrafficMapPreset): TrafficTimeWindow {
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

function routePositions(plan: TravelPlanPayload): [number, number][] {
  return plan.route.geometry.coordinates
    .map((coordinate): [number, number] | undefined => {
      const [lng, lat] = coordinate;
      if (typeof lat !== "number" || typeof lng !== "number") return undefined;
      return [lat, lng];
    })
    .filter((position): position is [number, number] => Boolean(position));
}

function TravelPlanLayer({ plan }: { plan?: TravelPlanPayload }) {
  if (!plan) return null;
  const positions = routePositions(plan);
  const [originLat, originLng] = [plan.origin.coordinate[1], plan.origin.coordinate[0]];
  const [destinationLat, destinationLng] = [
    plan.destination.coordinate[1],
    plan.destination.coordinate[0],
  ];
  return (
    <>
      <Polyline
        positions={positions}
        pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8, dashArray: "8 8" }}
      />
      <CircleMarker center={[originLat, originLng]} radius={7} pathOptions={{ color: "#16a34a" }}>
        <Popup>{plan.origin.label}</Popup>
      </CircleMarker>
      <CircleMarker
        center={[destinationLat, destinationLng]}
        radius={7}
        pathOptions={{ color: "#dc2626" }}
      >
        <Popup>{plan.destination.label}</Popup>
      </CircleMarker>
    </>
  );
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
              {suggestion.href ? (
                <a href={suggestion.href} target="_blank" rel="noreferrer noopener">
                  Åpne reiseplanlegger
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

export function TrafficMapPage() {
  const [bounds, setBounds] = useState<MapBounds>();
  const [selectedPreset, setSelectedPreset] = useState<TrafficMapPreset>("now");
  const [timeWindow, setTimeWindow] = useState<TrafficTimeWindow>(() => timeWindowForPreset("now"));
  const [selectedCategories, setSelectedCategories] =
    useState<TrafficEventCategory[]>(allCategories);
  const [selectedSeverities, setSelectedSeverities] =
    useState<TrafficEventSeverity[]>(allSeverities);
  const [selectedCorridorId, setSelectedCorridorId] = useState<string | undefined>();
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
  const [visibleContextLayers, setVisibleContextLayers] =
    useState<RoadContextLayerVisibility>(defaultContextLayers);
  const [originInput, setOriginInput] = useState("");
  const [destinationInput, setDestinationInput] = useState("");
  const [travelPlan, setTravelPlan] = useState<TravelPlanPayload>();
  const [travelPlanLoading, setTravelPlanLoading] = useState(false);
  const [travelPlanError, setTravelPlanError] = useState<string>();
  const travelPlanRequestIdRef = useRef(0);
  const travelPlanAbortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => travelPlanAbortRef.current?.abort(), []);

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
  const { data, loading, error, reload } = useTrafficMap({
    categories: selectedCategories,
    severities: selectedSeverities,
    states: timeWindow.states,
    from: timeWindow.from,
    to: timeWindow.to,
    bounds: stableBounds,
  });
  const {
    data: publicTransportData,
    loading: publicTransportLoading,
    error: publicTransportError,
    reload: reloadPublicTransport,
  } = usePublicTransportMap({
    modes: ["bus", "tram", "rail", "water"],
    includeAlerts: true,
    bounds: stableBounds,
    enabled: visibleContextLayers.publicTransport,
  });

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

  const applyPreset = useCallback((preset: Exclude<TrafficMapPreset, "custom">) => {
    setSelectedPreset(preset);
    setTimeWindow(timeWindowForPreset(preset));
    setSelectedCorridorId(undefined);
    setSelectedEventId(undefined);
    if (preset === "planned") {
      setSelectedCategories(["roadworks"]);
      setSelectedSeverities(allSeverities);
      return;
    }
    if (preset === "severe") {
      setSelectedCategories(allCategories);
      setSelectedSeverities(["high", "critical"]);
      return;
    }
    setSelectedCategories(allCategories);
    setSelectedSeverities(allSeverities);
  }, []);

  const handleCategoriesChange = useCallback((categories: TrafficEventCategory[]) => {
    setSelectedPreset("custom");
    setSelectedCorridorId(undefined);
    setSelectedEventId(undefined);
    setSelectedCategories(categories);
  }, []);

  const handleSeveritiesChange = useCallback((severities: TrafficEventSeverity[]) => {
    setSelectedPreset("custom");
    setSelectedCorridorId(undefined);
    setSelectedEventId(undefined);
    setSelectedSeverities(severities);
  }, []);

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
      setVisibleContextLayers((current) => ({ ...current, publicTransport: true }));
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
    <main className="traffic-map-page">
      <section className="traffic-map-controls" aria-label="Trafikkartvalg">
        <div className="traffic-map-heading">
          <p className="label">Trafikkdata fra Statens vegvesen</p>
          <h1>Trafikkart</h1>
          <p>Live trafikkhendelser, veiarbeid og påvirkning rundt Trondheim.</p>
        </div>
        <TrafficFilterPanel
          selectedCategories={selectedCategories}
          selectedSeverities={selectedSeverities}
          selectedPreset={selectedPreset}
          visibleContextLayers={visibleContextLayers}
          onCategoriesChange={handleCategoriesChange}
          onSeveritiesChange={handleSeveritiesChange}
          onPresetChange={applyPreset}
          onContextLayersChange={setVisibleContextLayers}
        />
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
              onChange={(event) => handleTravelInputChange(event.target.value, setDestinationInput)}
              placeholder="F.eks. Leangen"
            />
          </div>
          <button type="submit" disabled={travelPlanLoading}>
            {travelPlanLoading ? "Henter reiseråd ..." : "Finn reiseråd"}
          </button>
        </form>
      </section>
      <MapContainer center={trondheimCenter} zoom={12} className="traffic-map">
        <TileLayer attribution="© Kartverket" url={tiles} />
        <MapBoundsWatcher onBoundsChange={handleBoundsChange} />
        {data?.events ? (
          <TrafficLayer events={data.events} highlightedEventIds={highlightedEventIds} />
        ) : null}
        {data ? (
          <RoadContextLayer
            weather={visibleContextLayers.weather ? data.weather : []}
            cameras={visibleContextLayers.cameras ? data.cameras : []}
            counters={visibleContextLayers.counters ? data.counters : []}
          />
        ) : null}
        <PublicTransportLayer
          payload={publicTransportData}
          visible={visibleContextLayers.publicTransport}
        />
        <TravelPlanLayer plan={travelPlan} />
      </MapContainer>
      <section className="traffic-map-details" aria-label="Trafikkdetaljer">
        <TravelPlanCard plan={travelPlan} loading={travelPlanLoading} error={travelPlanError} />
        {data?.brief ? (
          <TrafficBriefCard
            brief={data.brief}
            sources={data.sources}
            loading={loading}
            error={error}
            onReload={reload}
          />
        ) : (
          <section className="traffic-brief-card">
            <header>
              <h2>Trafikk akkurat nå</h2>
              <button type="button" onClick={reload} disabled={loading}>
                {loading ? "Oppdaterer ..." : "Oppdater"}
              </button>
            </header>
            {error ? (
              <p role="alert">{error}</p>
            ) : loading ? (
              <p>Henter trafikkdata ...</p>
            ) : (
              <p>Velg et kartutsnitt eller trykk Oppdater for å hente trafikkdata.</p>
            )}
          </section>
        )}
        {data?.events ? (
          <TrafficEventList
            events={data.events}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
          />
        ) : null}
        {visibleContextLayers.publicTransport ? (
          <PublicTransportSummary
            payload={publicTransportData}
            loading={publicTransportLoading}
            error={publicTransportError}
            onReload={reloadPublicTransport}
          />
        ) : null}
        {data?.corridorImpacts ? (
          <CorridorImpactCard
            impacts={data.corridorImpacts}
            events={data.events}
            selectedImpactId={selectedCorridorId}
            onSelectImpact={setSelectedCorridorId}
          />
        ) : null}
      </section>
    </main>
  );
}
