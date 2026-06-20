import type { TrafficEventCategory, TrafficEventSeverity } from "@nytt/shared";
import type {
  TrafficLayerVisibility,
  TrafficMapPreset,
} from "./components/map/TrafficFilterPanel.js";

export const allTrafficCategories: TrafficEventCategory[] = [
  "roadworks",
  "accident",
  "closure",
  "congestion",
  "weather",
  "restriction",
  "obstruction",
  "other",
];

export const allTrafficSeverities: TrafficEventSeverity[] = ["low", "medium", "high", "critical"];

export const defaultTrafficLayers: TrafficLayerVisibility = {
  incidents: true,
  roadworks: true,
  travelTime: true,
  publicTransportDisruptions: true,
  publicTransportVehicles: false,
  weatherRisk: false,
  estimatedNews: true,
  privateNotes: false,
  showAll: false,
};

export interface TrafficMapFilters {
  preset: TrafficMapPreset;
  categories: TrafficEventCategory[];
  severities: TrafficEventSeverity[];
  layers: TrafficLayerVisibility;
}

const presetValues: TrafficMapPreset[] = [
  "now",
  "next24h",
  "next7d",
  "planned",
  "severe",
  "custom",
];

const trafficLayerKeys: Array<keyof TrafficLayerVisibility> = [
  "incidents",
  "roadworks",
  "travelTime",
  "publicTransportDisruptions",
  "publicTransportVehicles",
  "weatherRisk",
  "estimatedNews",
  "showAll",
];

const categorySet = new Set<TrafficEventCategory>(allTrafficCategories);
const severitySet = new Set<TrafficEventSeverity>(allTrafficSeverities);
const presetSet = new Set<TrafficMapPreset>(presetValues);
const layerSet = new Set<keyof TrafficLayerVisibility>(trafficLayerKeys);

function parseCsv<T extends string>(value: string | null, allowed: Set<T>, ordered: T[]): T[] {
  if (value === null || value === "") return [];
  const requested = new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item): item is T => allowed.has(item as T)),
  );
  return ordered.filter((item) => requested.has(item));
}

function sameSet<T extends string>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function sameLayers(left: TrafficLayerVisibility, right: TrafficLayerVisibility): boolean {
  return trafficLayerKeys.every((key) => left[key] === right[key]);
}

function parseLayers(value: string | null): TrafficLayerVisibility {
  if (value === null) return defaultTrafficLayers;
  const enabled = parseCsv(value, layerSet, trafficLayerKeys);
  return {
    incidents: enabled.includes("incidents"),
    roadworks: enabled.includes("roadworks"),
    travelTime: enabled.includes("travelTime"),
    publicTransportDisruptions: enabled.includes("publicTransportDisruptions"),
    publicTransportVehicles: enabled.includes("publicTransportVehicles"),
    weatherRisk: enabled.includes("weatherRisk"),
    estimatedNews: enabled.includes("estimatedNews"),
    privateNotes: false,
    showAll: enabled.includes("showAll"),
  };
}

export function trafficFiltersForPreset(
  preset: TrafficMapPreset,
  layers: TrafficLayerVisibility = defaultTrafficLayers,
): TrafficMapFilters {
  if (preset === "planned") {
    return {
      preset,
      categories: ["roadworks"],
      severities: allTrafficSeverities,
      layers,
    };
  }
  if (preset === "severe") {
    return {
      preset,
      categories: allTrafficCategories,
      severities: ["high", "critical"],
      layers,
    };
  }
  return {
    preset,
    categories: allTrafficCategories,
    severities: allTrafficSeverities,
    layers,
  };
}

export function parseTrafficMapFilters(search: string): TrafficMapFilters {
  const params = new URLSearchParams(search);
  const presetParameter = params.get("preset") ?? "now";
  const requestedPreset = presetSet.has(presetParameter as TrafficMapPreset)
    ? (presetParameter as TrafficMapPreset)
    : "now";
  const base = trafficFiltersForPreset(requestedPreset, parseLayers(params.get("layers")));
  const categoryParameter = params.get("category");
  const severityParameter = params.get("severity");
  const categories = parseCsv(categoryParameter, categorySet, allTrafficCategories);
  const severities = parseCsv(severityParameter, severitySet, allTrafficSeverities);
  const next = {
    ...base,
    categories:
      categoryParameter === ""
        ? []
        : categoryParameter && categories.length
          ? categories
          : base.categories,
    severities:
      severityParameter === ""
        ? []
        : severityParameter && severities.length
          ? severities
          : base.severities,
  };

  if (
    requestedPreset !== "custom" &&
    (!sameSet(next.categories, base.categories) || !sameSet(next.severities, base.severities))
  ) {
    return { ...next, preset: "custom" };
  }
  return next;
}

export function buildTrafficMapSearch(filters: TrafficMapFilters): string {
  const params = new URLSearchParams();
  const base = trafficFiltersForPreset(filters.preset);
  if (filters.preset !== "now") params.set("preset", filters.preset);
  if (!sameSet(filters.categories, base.categories)) {
    params.set("category", filters.categories.join(","));
  }
  if (!sameSet(filters.severities, base.severities)) {
    params.set("severity", filters.severities.join(","));
  }
  if (!sameLayers(filters.layers, defaultTrafficLayers)) {
    params.set("layers", trafficLayerKeys.filter((key) => filters.layers[key]).join(","));
  }
  return params.toString();
}
