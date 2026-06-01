import type { TrafficEventCategory, TrafficEventSeverity } from "@nytt/shared";

export type TrafficMapPreset = "now" | "next24h" | "next7d" | "planned" | "severe" | "custom";
export interface TrafficLayerVisibility {
  incidents: boolean;
  roadworks: boolean;
  travelTime: boolean;
  publicTransportDisruptions: boolean;
  publicTransportVehicles: boolean;
  weatherRisk: boolean;
  estimatedNews: boolean;
  privateNotes: boolean;
  showAll: boolean;
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

const layerControls: Array<{
  key: keyof TrafficLayerVisibility;
  label: string;
  disabled?: boolean;
  helper?: string;
}> = [
  { key: "incidents", label: "Hendelser" },
  { key: "roadworks", label: "Veiarbeid" },
  { key: "travelTime", label: "Reisetidskorridorer" },
  { key: "publicTransportDisruptions", label: "Kollektivavvik" },
  { key: "publicTransportVehicles", label: "Kjøretøyposisjoner" },
  { key: "weatherRisk", label: "Vær/risiko-kontekst" },
  {
    key: "estimatedNews",
    label: "Estimerte nyhetssteder",
    disabled: true,
    helper: "Aktiveres når estimerte nyhetssteder tegnes i kartet.",
  },
  {
    key: "privateNotes",
    label: "Private notater/tegninger",
    disabled: true,
    helper: "Ikke aktivt på /trafikk ennå",
  },
  { key: "showAll", label: "Vis alle mindre/stale meldinger" },
];

interface TrafficFilterPanelProps {
  selectedCategories: TrafficEventCategory[];
  selectedSeverities: TrafficEventSeverity[];
  selectedPreset: TrafficMapPreset;
  visibleContextLayers: TrafficLayerVisibility;
  onCategoriesChange: (categories: TrafficEventCategory[]) => void;
  onSeveritiesChange: (severities: TrafficEventSeverity[]) => void;
  onPresetChange: (preset: Exclude<TrafficMapPreset, "custom">) => void;
  onContextLayersChange: (visible: TrafficLayerVisibility) => void;
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
        <h3>Kartlag</h3>
        {layerControls.map((layer) => (
          <label key={layer.key} className={layer.disabled ? "disabled" : undefined}>
            <input
              type="checkbox"
              checked={visibleContextLayers[layer.key]}
              disabled={layer.disabled}
              onChange={() =>
                onContextLayersChange({
                  ...visibleContextLayers,
                  [layer.key]: !visibleContextLayers[layer.key],
                })
              }
            />
            {layer.label}
            {layer.helper ? <small>{layer.helper}</small> : null}
          </label>
        ))}
      </section>
      <details>
        <summary>Avanserte filtre</summary>
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
      </details>
    </aside>
  );
}
