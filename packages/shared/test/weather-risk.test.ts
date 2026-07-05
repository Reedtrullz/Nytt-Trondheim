import { describe, expect, it } from "vitest";
import type { RoadWeatherObservation } from "../src/index.js";
import {
  isFreshRoadWeatherObservation,
  moreSevereWeatherRiskLevel,
  roadWeatherObservationLevel,
  roadWeatherObservationStatus,
} from "../src/index.js";

const baseObservation: RoadWeatherObservation = {
  id: "datex-weather:e6-test",
  source: "datex_weather",
  stationId: "e6-test",
  stationName: "E6 test",
  observedAt: "2026-07-05T10:00:00.000Z",
  updatedAt: "2026-07-05T10:01:00.000Z",
  geometry: { type: "Point", coordinates: [10.39, 63.36] },
};

describe("weather risk engine", () => {
  it("keeps deterministic severity ordering for shared weather surfaces", () => {
    expect(moreSevereWeatherRiskLevel("normal", "watch")).toBe("watch");
    expect(moreSevereWeatherRiskLevel("warning", "watch")).toBe("warning");
    expect(moreSevereWeatherRiskLevel("severe", "normal")).toBe("severe");
  });

  it("classifies road-weather observations from deterministic thresholds", () => {
    expect(roadWeatherObservationLevel({ ...baseObservation, windSpeedMps: 7 })).toBe("watch");
    expect(roadWeatherObservationLevel({ ...baseObservation, precipitationMm: 1 })).toBe("warning");
    expect(
      roadWeatherObservationLevel({
        ...baseObservation,
        precipitationMm: 0.2,
        roadSurfaceTemperatureC: -0.4,
      }),
    ).toBe("severe");
    expect(roadWeatherObservationStatus({ ...baseObservation, visibilityMeters: 150 })).toBe(
      "Krevende føre",
    );
  });

  it("rejects stale, invalid, and future road-weather timestamps", () => {
    const now = new Date("2026-07-05T12:00:00.000Z");

    expect(isFreshRoadWeatherObservation(baseObservation, now)).toBe(true);
    expect(
      isFreshRoadWeatherObservation(
        { ...baseObservation, updatedAt: "2026-07-05T09:59:59.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isFreshRoadWeatherObservation(
        { ...baseObservation, updatedAt: "2026-07-05T12:00:01.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isFreshRoadWeatherObservation({ ...baseObservation, updatedAt: "not-a-date" }, now),
    ).toBe(false);
  });
});
