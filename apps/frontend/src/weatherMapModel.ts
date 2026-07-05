import { roadWeatherObservationLevel, roadWeatherObservationStatus } from "@nytt/shared";
import type {
  RoadWeatherObservation,
  WeatherImpactGroup,
  WeatherMapLayer,
  WeatherPreparednessPayload,
  WeatherRiskLevel,
  WeatherWarningSummary,
} from "@nytt/shared";
import {
  boundsFromLatLngs,
  latLngFromPoint,
  latLngsFromGeometry,
  type LeafletBounds,
  type LeafletLatLng,
} from "./mapCoordinates.js";

export interface WeatherRoadStation {
  observation: RoadWeatherObservation;
  center: LeafletLatLng;
  level: WeatherRiskLevel;
  status: string;
}

export interface WeatherLayerGroups {
  available: WeatherMapLayer[];
  context: WeatherMapLayer[];
  planned: WeatherMapLayer[];
}

export interface WeatherConsequenceZone {
  group: WeatherImpactGroup;
  center: LeafletLatLng;
  radiusMeters: number;
  note: string;
}

const consequenceAnchors: Record<WeatherImpactGroup["group"], LeafletLatLng> = {
  Innbyggere: [63.4305, 10.3951],
  Transport: [63.403, 10.392],
  Helse: [63.421, 10.395],
  "Skole/arrangement": [63.428, 10.404],
  Beredskap: [63.437, 10.386],
};

const consequenceRadiusMeters: Record<WeatherRiskLevel, number> = {
  normal: 900,
  watch: 1_300,
  warning: 1_800,
  severe: 2_300,
};

export const roadWeatherLevel = roadWeatherObservationLevel;
export const roadWeatherStatus = roadWeatherObservationStatus;

export function weatherRoadStations(
  roadWeather: RoadWeatherObservation[] = [],
): WeatherRoadStation[] {
  return roadWeather.flatMap((observation) => {
    const center = latLngFromPoint(observation.geometry);
    if (!center) return [];
    return [
      {
        observation,
        center,
        level: roadWeatherLevel(observation),
        status: roadWeatherStatus(observation),
      },
    ];
  });
}

export function weatherMapBounds(
  payload: Pick<WeatherPreparednessPayload, "roadWeather" | "warnings"> & {
    impactGroups?: WeatherImpactGroup[];
  },
): LeafletBounds | undefined {
  return boundsFromLatLngs([
    ...payload.warnings.flatMap((warning) =>
      warning.geometry ? latLngsFromGeometry(warning.geometry) : [],
    ),
    ...weatherRoadStations(payload.roadWeather).map((station) => station.center),
    ...weatherConsequenceZones(payload.impactGroups ?? []).map((zone) => zone.center),
  ]);
}

export function groupWeatherMapLayers(layers: WeatherMapLayer[] = []): WeatherLayerGroups {
  return {
    available: layers.filter((layer) => layer.status === "available"),
    context: layers.filter((layer) => layer.status === "context"),
    planned: layers.filter((layer) => layer.status === "planned"),
  };
}

export function visibleWeatherWarnings(
  warnings: WeatherWarningSummary[] = [],
): WeatherWarningSummary[] {
  return warnings.slice(0, 4);
}

export function visibleWeatherImpacts(groups: WeatherImpactGroup[] = []): WeatherImpactGroup[] {
  const active = groups.filter((group) => group.level !== "normal");
  return (active.length ? active : groups).slice(0, 4);
}

export function weatherConsequenceZones(
  groups: WeatherImpactGroup[] = [],
): WeatherConsequenceZone[] {
  return visibleWeatherImpacts(groups).map((group) => ({
    group,
    center: consequenceAnchors[group.group],
    radiusMeters: consequenceRadiusMeters[group.level],
    note: "Lokal konsekvensflate i Nytt, ikke et offisielt varselpolygon.",
  }));
}
