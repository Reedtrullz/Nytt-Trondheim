import type { RoadWeatherObservation, WeatherPreparednessPayload } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import {
  groupWeatherMapLayers,
  roadWeatherLevel,
  weatherMapBounds,
  weatherRoadStations,
} from "./weatherMapModel.js";

const observation: RoadWeatherObservation = {
  id: "road-weather-1",
  source: "datex_weather",
  stationId: "station-1",
  stationName: "E6 Tonstad",
  observedAt: "2026-06-01T08:03:00.000Z",
  updatedAt: "2026-06-01T08:04:00.000Z",
  geometry: { type: "Point", coordinates: [10.39, 63.36] },
  airTemperatureC: 7,
  roadSurfaceTemperatureC: 1.5,
  precipitationMm: 1.8,
  windSpeedMps: 6,
};

const payload = {
  roadWeather: [observation],
  warnings: [
    {
      id: "met-warning",
      source: "met",
      sourceLabel: "MET farevarsel",
      title: "Kraftig regn",
      area: "Trøndelag",
      level: "Gult",
      validUntil: "2099-06-02T09:00:00.000Z",
      url: "https://example.test/met",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [10.2, 63.3],
            [10.6, 63.3],
            [10.6, 63.5],
            [10.2, 63.3],
          ],
        ],
      },
    },
  ],
  mapLayers: [
    { id: "datex", title: "Vegvær", source: "DATEX", status: "available", detail: "Aktiv" },
    { id: "nve", title: "NVE", source: "NVE", status: "planned", detail: "Neste lag" },
  ],
} as WeatherPreparednessPayload;

describe("weather map model", () => {
  it("keeps only road-weather stations with valid Leaflet coordinates", () => {
    expect(
      weatherRoadStations([
        observation,
        {
          ...observation,
          id: "bad",
          geometry: { type: "Point", coordinates: [999, 999] },
        },
      ]).map((station) => station.center),
    ).toEqual([[63.36, 10.39]]);
  });

  it("classifies risky road-weather observations", () => {
    expect(roadWeatherLevel(observation)).toBe("warning");
    expect(roadWeatherLevel({ ...observation, rawSummary: "Fare for glatt føre" })).toBe("severe");
  });

  it("builds map bounds from warning geometry and road-weather stations", () => {
    expect(weatherMapBounds(payload)).toEqual([
      [63.3, 10.2],
      [63.5, 10.6],
    ]);
  });

  it("builds map bounds from the supplied visible weather layers only", () => {
    expect(weatherMapBounds({ warnings: [], roadWeather: [observation] })).toEqual([
      [63.36, 10.39],
      [63.36, 10.39],
    ]);
  });

  it("groups layer metadata by operational status", () => {
    expect(groupWeatherMapLayers(payload.mapLayers)).toMatchObject({
      available: [expect.objectContaining({ id: "datex" })],
      planned: [expect.objectContaining({ id: "nve" })],
    });
  });
});
