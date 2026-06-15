import type { TravelPlanPayload } from "@nytt/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  CircleMarker: () => null,
  MapContainer: () => null,
  Polyline: () => null,
  Popup: () => null,
  TileLayer: () => null,
  useMap: () => ({
    fitBounds: () => undefined,
    flyTo: () => undefined,
    getZoom: () => 12,
  }),
  useMapEvents: () => ({
    getBounds: () => ({
      getNorth: () => 63.5,
      getSouth: () => 63.3,
      getEast: () => 10.6,
      getWest: () => 10.2,
    }),
  }),
}));

import { routePositions, timeWindowForPreset } from "./TrafficMapPage.js";

const plan: TravelPlanPayload = {
  origin: { query: "start", label: "Start", coordinate: [10.39, 63.39] },
  destination: { query: "mål", label: "Mål", coordinate: [10.41, 63.4] },
  route: {
    source: "direct",
    geometry: {
      type: "LineString",
      coordinates: [
        [10.39, 63.39],
        [999, 999],
        [10.41, 63.4],
      ],
    },
    distanceMeters: 1200,
    detail: "Direkterute",
  },
  trafficImpacts: [],
  publicTransportSuggestions: [],
  sources: [],
  generatedAt: "2026-06-01T16:42:00.000Z",
};

describe("TrafficMapPage route overlay helpers", () => {
  it("keeps the default now preset scoped to active incidents", () => {
    expect(timeWindowForPreset("now")).toEqual({ states: ["active"] });
  });

  it("filters malformed route coordinates before rendering a Leaflet route", () => {
    expect(routePositions(plan)).toEqual([
      [63.39, 10.39],
      [63.4, 10.41],
    ]);
  });
});
