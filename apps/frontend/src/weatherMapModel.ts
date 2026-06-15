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

export function roadWeatherLevel(observation: RoadWeatherObservation): WeatherRiskLevel {
  const roadTemperature = observation.roadSurfaceTemperatureC;
  const precipitation = observation.precipitationMm ?? 0;
  const visibility = observation.visibilityMeters;
  const wind = observation.windSpeedMps ?? 0;
  const summary = observation.rawSummary?.toLocaleLowerCase("nb") ?? "";

  if (
    (typeof roadTemperature === "number" && roadTemperature <= 0 && precipitation > 0) ||
    (typeof visibility === "number" && visibility < 200) ||
    wind >= 17 ||
    /is|glatt|stengt|fare/.test(summary)
  ) {
    return "severe";
  }
  if (
    (typeof roadTemperature === "number" && roadTemperature <= 2) ||
    precipitation >= 1 ||
    (typeof visibility === "number" && visibility < 600) ||
    wind >= 10
  ) {
    return "warning";
  }
  if (precipitation > 0 || wind >= 7) return "watch";
  return "normal";
}

export function roadWeatherStatus(observation: RoadWeatherObservation): string {
  const level = roadWeatherLevel(observation);
  if (level === "severe") return "Krevende føre";
  if (level === "warning") return "Følg med på føre";
  if (level === "watch") return "Vær i endring";
  return "Normale målinger";
}

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
  payload: Pick<WeatherPreparednessPayload, "roadWeather" | "warnings">,
): LeafletBounds | undefined {
  return boundsFromLatLngs([
    ...payload.warnings.flatMap((warning) =>
      warning.geometry ? latLngsFromGeometry(warning.geometry) : [],
    ),
    ...weatherRoadStations(payload.roadWeather).map((station) => station.center),
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
