import type { RoadWeatherObservation } from "./traffic-map.js";
import type { WeatherRiskLevel } from "./weather.js";

export const weatherRiskLevelRank: Record<WeatherRiskLevel, number> = {
  normal: 0,
  watch: 1,
  warning: 2,
  severe: 3,
};

export function moreSevereWeatherRiskLevel(
  current: WeatherRiskLevel,
  next: WeatherRiskLevel,
): WeatherRiskLevel {
  return weatherRiskLevelRank[next] > weatherRiskLevelRank[current] ? next : current;
}

export function roadWeatherObservationLevel(observation: RoadWeatherObservation): WeatherRiskLevel {
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

export function roadWeatherObservationStatus(observation: RoadWeatherObservation): string {
  const level = roadWeatherObservationLevel(observation);
  if (level === "severe") return "Krevende føre";
  if (level === "warning") return "Følg med på føre";
  if (level === "watch") return "Vær i endring";
  return "Normale målinger";
}

export function isFreshRoadWeatherObservation(
  observation: RoadWeatherObservation,
  now: Date,
  staleAfterMs = 2 * 60 * 60 * 1000,
): boolean {
  const updated = Date.parse(observation.updatedAt || observation.observedAt);
  if (!Number.isFinite(updated)) return false;
  const ageMs = now.getTime() - updated;
  return ageMs >= 0 && ageMs <= staleAfterMs;
}
