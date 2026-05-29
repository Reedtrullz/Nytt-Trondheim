import type { TrafficEventCategory, TrafficEventSeverity } from "@nytt/shared";

export type TrafficMapPreset = "now" | "next24h" | "next7d" | "planned" | "severe" | "custom";

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
  onCategoriesChange: (categories: TrafficEventCategory[]) => void;
  onSeveritiesChange: (severities: TrafficEventSeverity[]) => void;
  onPresetChange: (preset: Exclude<TrafficMapPreset, "custom">) => void;
}

function toggle<T extends string>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

export function TrafficFilterPanel({
  selectedCategories,
  selectedSeverities,
  selectedPreset,
  onCategoriesChange,
  onSeveritiesChange,
  onPresetChange,
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
    </aside>
  );
}
