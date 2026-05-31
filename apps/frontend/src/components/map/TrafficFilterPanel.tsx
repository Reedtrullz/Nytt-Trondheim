import type { TrafficEventCategory, TrafficEventSeverity } from "@nytt/shared";

export type TrafficMapPreset = "now" | "next24h" | "next7d" | "planned" | "severe" | "custom";
export interface RoadContextLayerVisibility {
  weather: boolean;
  cameras: boolean;
  counters: boolean;
  publicTransport: boolean;
}

const presets: Array<{ value: Exclude<TrafficMapPreset, "custom">; label: string }> = [
  { value: "now", label: "Nå" },
  { value: "next24h", label: "Neste 24 timer" },
  { value: "next7d", label: "Neste 7 dager" },
  { value: "planned", label: "Kun planlagt" },
  { value: "severe", label: "Kun alvorlig" },
];

const categories: Array<{ value: TrafficEventCategory; label: string }> = [
  { value: "roadworks", label: "Veiarbeid" },
  { value: "accident", label: "Ulykker" },
  { value: "closure", label: "Stengte veier" },
  { value: "congestion", label: "Kø" },
  { value: "weather", label: "Vær/føre" },
  { value: "restriction", label: "Restriksjoner" },
  { value: "obstruction", label: "Hindringer" },
  { value: "other", label: "Annet" },
];

const severities: Array<{ value: TrafficEventSeverity; label: string }> = [
  { value: "low", label: "Lav" },
  { value: "medium", label: "Middels" },
  { value: "high", label: "Høy" },
  { value: "critical", label: "Kritisk" },
];

interface TrafficFilterPanelProps {
  selectedCategories: TrafficEventCategory[];
  selectedSeverities: TrafficEventSeverity[];
  selectedPreset: TrafficMapPreset;
  visibleContextLayers: RoadContextLayerVisibility;
  onCategoriesChange: (categories: TrafficEventCategory[]) => void;
  onSeveritiesChange: (severities: TrafficEventSeverity[]) => void;
  onPresetChange: (preset: Exclude<TrafficMapPreset, "custom">) => void;
  onContextLayersChange: (visible: RoadContextLayerVisibility) => void;
}

function toggle<T extends string>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

export function TrafficFilterPanel({
  selectedCategories,
  selectedSeverities,
  selectedPreset,
  visibleContextLayers,
  onCategoriesChange,
  onSeveritiesChange,
  onPresetChange,
  onContextLayersChange,
}: TrafficFilterPanelProps) {
  return (
    <aside className="traffic-filter-panel">
      <h2>Trafikk</h2>
      <section>
        <h3>Visning</h3>
        <div className="traffic-preset-list">
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={selectedPreset === preset.value ? "selected" : undefined}
              onClick={() => onPresetChange(preset.value)}
            >
              {preset.label}
            </button>
          ))}
          {selectedPreset === "custom" ? <small>Egendefinert filter</small> : null}
        </div>
      </section>
      <section>
        <h3>Type</h3>
        {categories.map((category) => (
          <label key={category.value}>
            <input
              type="checkbox"
              checked={selectedCategories.includes(category.value)}
              onChange={() => onCategoriesChange(toggle(selectedCategories, category.value))}
            />
            {category.label}
          </label>
        ))}
      </section>
      <section>
        <h3>Alvorlighet</h3>
        {severities.map((severity) => (
          <label key={severity.value}>
            <input
              type="checkbox"
              checked={selectedSeverities.includes(severity.value)}
              onChange={() => onSeveritiesChange(toggle(selectedSeverities, severity.value))}
            />
            {severity.label}
          </label>
        ))}
      </section>
      <section>
        <h3>Kartlag</h3>
        <label>
          <input
            type="checkbox"
            checked={visibleContextLayers.weather}
            onChange={() =>
              onContextLayersChange({
                ...visibleContextLayers,
                weather: !visibleContextLayers.weather,
              })
            }
          />
          Værstasjoner
        </label>
        <label>
          <input
            type="checkbox"
            checked={visibleContextLayers.cameras}
            onChange={() =>
              onContextLayersChange({
                ...visibleContextLayers,
                cameras: !visibleContextLayers.cameras,
              })
            }
          />
          Webkamera
        </label>
        <label>
          <input
            type="checkbox"
            checked={visibleContextLayers.counters}
            onChange={() =>
              onContextLayersChange({
                ...visibleContextLayers,
                counters: !visibleContextLayers.counters,
              })
            }
          />
          Trafikktelling
        </label>
        <h3>Kollektivtrafikk</h3>
        <label>
          <input
            type="checkbox"
            aria-label="Vis busser og trikk"
            checked={visibleContextLayers.publicTransport}
            onChange={() =>
              onContextLayersChange({
                ...visibleContextLayers,
                publicTransport: !visibleContextLayers.publicTransport,
              })
            }
          />
          Vis busser og trikk
        </label>
      </section>
    </aside>
  );
}
