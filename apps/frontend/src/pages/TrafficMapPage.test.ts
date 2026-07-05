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

import {
  departureTimeForPreset,
  formatTravelDateTime,
  routePositions,
  timeWindowForPreset,
  travelPlanDecision,
} from "./TrafficMapPage.js";

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
  itineraries: [],
  journeyPlanner: {
    status: "empty",
    detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
    requestedDepartureTime: "2026-06-01T16:42:00.000Z",
    source: "Entur Journey Planner",
  },
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

  it("builds travel departure presets in Oslo time", () => {
    const base = new Date("2026-07-05T20:00:00.000Z");

    expect(departureTimeForPreset("now", base)).toBe("2026-07-05T20:00:00.000Z");
    expect(departureTimeForPreset("in30", base)).toBe("2026-07-05T20:30:00.000Z");
    expect(departureTimeForPreset("tomorrow_morning", base)).toBe("2026-07-06T05:30:00.000Z");
  });

  it("shows date context for future travel times outside the current Oslo day", () => {
    const base = new Date("2026-07-05T20:00:00.000Z");

    expect(formatTravelDateTime("2026-07-05T20:30:00.000Z", base)).toBe("22:30");
    expect(formatTravelDateTime("2026-07-06T05:30:00.000Z", base)).toBe("i morgen 07:30");
    expect(formatTravelDateTime("2026-07-08T05:30:00.000Z", base)).toBe("8. juli 07:30");
  });

  it("turns route impacts and transit alerts into a travel decision", () => {
    expect(travelPlanDecision()).toMatchObject({
      heading: "Planlegg reisen",
      severity: "watch",
    });

    expect(
      travelPlanDecision({
        ...plan,
        trafficImpacts: [
          {
            event: {
              id: "event-1",
              source: "vegvesen_traffic_info",
              sourceEventId: "event-1",
              category: "roadworks",
              severity: "high",
              state: "active",
              title: "Veiarbeid ved Leangen",
              updatedAt: "2026-06-01T16:42:00.000Z",
              geometry: { type: "Point", coordinates: [10.4, 63.4] },
            },
            distanceMeters: 80,
            severity: "high",
            summary: "80 m fra foreslått rute",
          },
        ],
        publicTransportSuggestions: [
          {
            id: "alert-1",
            kind: "alert",
            title: "Forsinkelse på linje 3",
            detail: "Beregn ekstra tid.",
            source: "Entur avvik",
          },
          {
            id: "vehicle-1",
            kind: "vehicle",
            title: "Buss 3 mot Lade",
            detail: "Sist sett nær ruten.",
            source: "Entur kjøretøyposisjoner",
          },
        ],
      }),
    ).toMatchObject({
      heading: "Sjekk ruten før du drar",
      roadImpactCount: 1,
      alertCount: 1,
      vehicleCount: 1,
      itineraryCount: 0,
      severity: "warning",
    });

    expect(
      travelPlanDecision({
        ...plan,
        journeyPlanner: {
          status: "unavailable",
          detail: "Entur reisesøk er ikke tilgjengelig akkurat nå.",
          requestedDepartureTime: "2026-06-01T16:42:00.000Z",
          source: "Entur Journey Planner",
        },
      }),
    ).toMatchObject({
      heading: "Sjekk AtB/Entur før du drar",
      detail: expect.stringContaining("Entur reisesøk er ikke tilgjengelig"),
      severity: "warning",
    });

    expect(travelPlanDecision(plan)).toMatchObject({
      heading: "Ingen konkrete Entur-reiser funnet",
      detail: expect.stringContaining("Sjekk AtB/Entur"),
      severity: "watch",
    });
  });

  it("treats disrupted Entur itineraries as route choices to watch", () => {
    expect(
      travelPlanDecision({
        ...plan,
        itineraries: [
          {
            id: "itinerary-1",
            decision: "watch",
            decisionReason: "Nytt fant avvik eller trafikkmeldinger som kan påvirke reisen.",
            labels: ["best_now"],
            departureTime: "2026-06-01T16:45:00.000Z",
            arrivalTime: "2026-06-01T17:02:00.000Z",
            durationSeconds: 1020,
            transferCount: 0,
            walkTimeSeconds: 240,
            realtime: true,
            modes: ["bus"],
            disruptionCount: 1,
            handoffUrl: "https://www.atb.no/reiseplanlegger/",
            legs: [
              {
                id: "leg-1",
                mode: "bus",
                from: { name: "Munkegata", coordinate: [10.39, 63.39] },
                to: { name: "Leangen", coordinate: [10.41, 63.4] },
                aimedStartTime: "2026-06-01T16:45:00.000Z",
                expectedStartTime: "2026-06-01T16:45:00.000Z",
                aimedEndTime: "2026-06-01T17:02:00.000Z",
                expectedEndTime: "2026-06-01T17:02:00.000Z",
                durationSeconds: 1020,
                realtime: true,
                cancelled: false,
                replacementTransport: false,
                publicCode: "3",
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [10.39, 63.39],
                    [10.41, 63.4],
                  ],
                },
                notices: [
                  {
                    id: "alert-1",
                    title: "Forsinkelse på linje 3",
                    source: "Entur avvik",
                    severity: "warning",
                  },
                ],
              },
            ],
          },
        ],
        journeyPlanner: {
          status: "ok",
          detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
          requestedDepartureTime: "2026-06-01T16:42:00.000Z",
          source: "Entur Journey Planner",
        },
      }),
    ).toMatchObject({
      heading: "Sjekk ruten før du drar",
      itineraryCount: 1,
      severity: "warning",
    });
  });
});
