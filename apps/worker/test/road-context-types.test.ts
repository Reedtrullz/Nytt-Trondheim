import type {
  RoadCamera,
  RoadWeatherObservation,
  SourceHealth,
  TrafficCounterSnapshot,
  TrafficMapPayload,
} from "@nytt/shared";
import { describe, expect, it } from "vitest";

const weather = {
  id: "datex-weather:SN70690",
  source: "datex_weather",
  stationId: "SN70690",
  stationName: "Klett",
  observedAt: "2026-05-29T11:40:00.000Z",
  updatedAt: "2026-05-29T11:45:00.000Z",
  geometry: { type: "Point", coordinates: [10.3001, 63.324] },
  airTemperatureC: 7.2,
  roadSurfaceTemperatureC: 5.1,
} satisfies RoadWeatherObservation;

const camera = {
  id: "datex-cctv:CCTV_1",
  source: "datex_cctv",
  cameraId: "CCTV_1",
  name: "Kroppanbrua",
  status: "ok",
  updatedAt: "2026-05-29T11:45:00.000Z",
  geometry: { type: "Point", coordinates: [10.3845, 63.3918] },
  imageUrl: "https://example.test/camera.jpg",
} satisfies RoadCamera;

const counter = {
  id: "trafikkdata:06970V72811",
  source: "trafikkdata",
  pointId: "06970V72811",
  name: "Kroppanbrua",
  updatedAt: "2026-05-29T11:00:00.000Z",
  geometry: { type: "Point", coordinates: [10.384529, 63.391793] },
  volumeLastHour: 1234,
} satisfies TrafficCounterSnapshot;

const payload = {
  events: [],
  brief: {
    headline: "",
    severity: "low",
    freshness: "fresh",
    generatedAt: "",
    bullets: [],
    primaryEventIds: [],
    counts: { total: 0, byCategory: {}, bySeverity: {} },
  },
  weather: [weather],
  cameras: [camera],
  counters: [counter],
} satisfies TrafficMapPayload;

const health = {
  source: "trafikkdata",
  label: "Trafikkdata",
  state: "ok",
  detail: "52 punkt",
} satisfies SourceHealth;

void payload;
void health;

describe("road context shared source types", () => {
  it("accepts weather, camera and counter traffic-map payload context", () => {
    expect(true).toBe(true);
  });
});
