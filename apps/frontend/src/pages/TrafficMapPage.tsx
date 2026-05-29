import { useCallback, useMemo, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { TrafficEventCategory, TrafficEventSeverity, TrafficEventState } from "@nytt/shared";
import { CorridorImpactCard } from "../components/map/CorridorImpactCard.js";
import { MapBoundsWatcher } from "../components/map/MapBoundsWatcher.js";
import { TrafficBriefCard } from "../components/map/TrafficBriefCard.js";
import { TrafficEventList } from "../components/map/TrafficEventList.js";
import { TrafficFilterPanel, type TrafficMapPreset } from "../components/map/TrafficFilterPanel.js";
import { TrafficLayer } from "../components/map/TrafficLayer.js";
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

  const highlightedEventIds = useMemo(() => {
    const highlightedIds = new Set<string>();
    if (selectedEventId) highlightedIds.add(selectedEventId);
    if (selectedCorridorId) {
      const affectedEventIds =
        data?.corridorImpacts?.find((impact) => impact.id === selectedCorridorId)?.affectedEventIds ??
        [];
      affectedEventIds.forEach((eventId) => highlightedIds.add(eventId));
    }
    return Array.from(highlightedIds);
  }, [data?.corridorImpacts, selectedCorridorId, selectedEventId]);

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

  return (
    <main className="traffic-map-page">
      <div className="traffic-map-sidebar">
        <div className="traffic-map-heading">
          <p className="label">Trafikkdata fra Statens vegvesen</p>
          <h1>Trafikkart</h1>
          <p>Live trafikkhendelser, veiarbeid og påvirkning rundt Trondheim.</p>
        </div>
        <TrafficFilterPanel
          selectedCategories={selectedCategories}
          selectedSeverities={selectedSeverities}
          selectedPreset={selectedPreset}
          onCategoriesChange={handleCategoriesChange}
          onSeveritiesChange={handleSeveritiesChange}
          onPresetChange={applyPreset}
        />
        {data?.brief ? (
          <TrafficBriefCard brief={data.brief} loading={loading} error={error} onReload={reload} />
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
        {data?.corridorImpacts ? (
          <CorridorImpactCard
            impacts={data.corridorImpacts}
            events={data.events}
            selectedImpactId={selectedCorridorId}
            onSelectImpact={setSelectedCorridorId}
          />
        ) : null}
      </div>
      <MapContainer center={trondheimCenter} zoom={12} className="traffic-map">
        <TileLayer attribution="© Kartverket" url={tiles} />
        <MapBoundsWatcher onBoundsChange={handleBoundsChange} />
        {data?.events ? (
          <TrafficLayer events={data.events} highlightedEventIds={highlightedEventIds} />
        ) : null}
      </MapContainer>
    </main>
  );
}
