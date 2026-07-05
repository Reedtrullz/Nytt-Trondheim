import type { PublicTransportDepartureBoardPayload, TravelPlanPayload } from "@nytt/shared";
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
  departureBoardContextFromPlan,
  departureBoardContextFromSuggestion,
  departureTimeForPreset,
  formatTravelDateTime,
  routePositions,
  selectedDepartureMatch,
  selectedDepartureStatus,
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

const planWithItinerary: TravelPlanPayload = {
  ...plan,
  itineraries: [
    {
      id: "itinerary-1",
      decision: "good",
      decisionReason: "Normal reise.",
      labels: ["best_now"],
      departureTime: "2026-06-01T09:10:00.000Z",
      arrivalTime: "2026-06-01T09:27:00.000Z",
      durationSeconds: 1020,
      transferCount: 0,
      walkTimeSeconds: 180,
      realtime: true,
      modes: ["bus"],
      disruptionCount: 0,
      handoffUrl: "https://www.atb.no/reiseplanlegger/",
      legs: [
        {
          id: "leg-bus-3",
          mode: "bus",
          from: {
            name: "Munkegata",
            stopName: "Munkegata",
            stopId: "NSR:StopPlace:41613",
            coordinate: [10.3951, 63.4305],
          },
          to: {
            name: "Leangen",
            stopName: "Leangen",
            coordinate: [10.464, 63.433],
          },
          aimedStartTime: "2026-06-01T09:10:00.000Z",
          expectedStartTime: "2026-06-01T09:10:00.000Z",
          aimedEndTime: "2026-06-01T09:27:00.000Z",
          expectedEndTime: "2026-06-01T09:27:00.000Z",
          durationSeconds: 1020,
          distanceMeters: 4850,
          realtime: true,
          cancelled: false,
          replacementTransport: false,
          lineId: "ATB:Line:3",
          publicCode: "3",
          lineName: "Lade - Hallset",
          serviceJourneyId: "ATB:ServiceJourney:3",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.3951, 63.4305],
              [10.464, 63.433],
            ],
          },
          notices: [],
        },
      ],
    },
  ],
  journeyPlanner: {
    status: "ok",
    detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
    requestedDepartureTime: "2026-06-01T09:05:00.000Z",
    source: "Entur Journey Planner",
  },
};

const departureBoard: PublicTransportDepartureBoardPayload = {
  status: "ok",
  detail: "Entur viser konkrete avganger nær valgt område.",
  areaLabel: "Valgt område",
  center: { lat: 63.4305, lon: 10.3951 },
  stops: [],
  departures: [
    {
      id: "departure:3",
      stopId: "NSR:StopPlace:41613",
      stopName: "Munkegata",
      stopDistanceMeters: 80,
      mode: "bus",
      lineId: "ATB:Line:3",
      publicCode: "3",
      lineName: "Lade - Hallset",
      serviceJourneyId: "ATB:ServiceJourney:3",
      destinationName: "Leangen",
      aimedDepartureTime: "2026-06-01T09:10:00.000Z",
      expectedDepartureTime: "2026-06-01T09:10:00.000Z",
      delaySeconds: 0,
      realtime: true,
      cancelled: false,
      notices: [],
      handoffUrl: "https://www.atb.no/reiseplanlegger/",
    },
    {
      id: "departure:71",
      stopId: "NSR:StopPlace:99999",
      stopName: "Prinsens gate",
      stopDistanceMeters: 180,
      mode: "bus",
      lineId: "ATB:Line:71",
      publicCode: "71",
      lineName: "MelhusSkyss-Trondheim",
      serviceJourneyId: "ATB:ServiceJourney:71",
      destinationName: "Dora",
      aimedDepartureTime: "2026-06-01T09:11:00.000Z",
      expectedDepartureTime: "2026-06-01T09:11:00.000Z",
      delaySeconds: 0,
      realtime: true,
      cancelled: false,
      notices: [],
      handoffUrl: "https://www.atb.no/reiseplanlegger/",
    },
  ],
  sources: [],
  generatedAt: "2026-06-01T09:06:00.000Z",
  handoffUrl: "https://www.atb.no/reiseplanlegger/",
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

  it("uses the travel plan origin as an explicit departure-board center", () => {
    expect(departureBoardContextFromPlan(plan)).toEqual({
      scope: "origin",
      label: "Start",
      center: { lat: 63.39, lon: 10.39 },
    });
  });

  it("uses an Entur origin suggestion as an explicit departure-board center", () => {
    expect(
      departureBoardContextFromSuggestion({
        id: "NSR:StopPlace:63277",
        label: "Munkegata, Trondheim",
        query: "Munkegata, Trondheim",
        kind: "stop",
        coordinate: [10.393742, 63.432883],
        locality: "Trondheim",
        source: "Entur Geocoder",
      }),
    ).toEqual({
      scope: "origin",
      label: "Munkegata, Trondheim",
      center: { lat: 63.432883, lon: 10.393742 },
    });
  });

  it("uses the selected itinerary boarding stop when building a departure-board center", () => {
    expect(departureBoardContextFromPlan(planWithItinerary, "itinerary-1")).toEqual({
      scope: "origin",
      label: "Munkegata",
      center: { lat: 63.4305, lon: 10.3951 },
      startTime: "2026-06-01T09:10:00.000Z",
    });
  });

  it("matches a selected itinerary to the concrete nearby departure row", () => {
    expect(selectedDepartureMatch(planWithItinerary, "itinerary-1", departureBoard)).toMatchObject({
      leg: { id: "leg-bus-3" },
      departure: { id: "departure:3" },
    });
  });

  it("prefers exact Entur service journey matches before generic line and stop scoring", () => {
    expect(
      selectedDepartureMatch(planWithItinerary, "itinerary-1", {
        ...departureBoard,
        departures: [
          {
            ...departureBoard.departures[0]!,
            id: "departure:same-line-wrong-journey",
            serviceJourneyId: "ATB:ServiceJourney:other",
          },
          {
            ...departureBoard.departures[0]!,
            id: "departure:exact-journey",
            stopId: "NSR:StopPlace:99999",
            stopName: "Prinsens gate",
            stopDistanceMeters: 180,
            serviceJourneyId: "ATB:ServiceJourney:3",
          },
        ],
      }),
    ).toMatchObject({
      leg: { id: "leg-bus-3" },
      departure: { id: "departure:exact-journey" },
    });
  });

  it("keeps the selected itinerary callout conservative when no departure row matches", () => {
    expect(
      selectedDepartureMatch(planWithItinerary, "itinerary-1", {
        ...departureBoard,
        departures: [departureBoard.departures[1]!],
      }),
    ).toMatchObject({
      leg: { id: "leg-bus-3" },
      departure: undefined,
    });
  });

  it("describes selected departure realtime state without overclaiming", () => {
    expect(selectedDepartureStatus(departureBoard.departures[0])).toEqual({
      label: "Sanntid",
      detail: "Matcher sanntidsavgang mot Leangen.",
      severity: "ok",
    });

    expect(
      selectedDepartureStatus({
        ...departureBoard.departures[0]!,
        delaySeconds: 240,
        expectedDepartureTime: "2026-06-01T09:14:00.000Z",
      }),
    ).toEqual({
      label: "4 min forsinket",
      detail: "Matcher avgang mot Leangen, men den er 4 min forsinket.",
      severity: "warning",
    });

    expect(
      selectedDepartureStatus({
        ...departureBoard.departures[0]!,
        cancelled: true,
      }),
    ).toEqual({
      label: "Innstilt",
      detail: "Avgangen mot Leangen er innstilt. Velg et annet reiseforslag hos AtB/Entur.",
      severity: "warning",
    });

    expect(
      selectedDepartureStatus(undefined, planWithItinerary.itineraries[0]?.legs[0], {
        ...departureBoard,
        departures: [departureBoard.departures[1]!],
      }),
    ).toEqual({
      label: "Ikke i tavla",
      detail:
        "Reiserådet bruker Buss 3 fra Munkegata kl. 1. juni 11:10, men Nytt fant ikke samme avgang i live-tavla. Sjekk holdeplass, plattform og avvik hos AtB/Entur.",
      severity: "watch",
    });

    expect(selectedDepartureStatus(undefined, planWithItinerary.itineraries[0]?.legs[0])).toEqual({
      label: "Sjekk",
      detail:
        "Reiserådet bruker Buss 3 fra Munkegata kl. 1. juni 11:10. Live-tavla er ikke lastet inn, så sjekk linje og holdeplass hos AtB/Entur.",
      severity: "watch",
    });
  });

  it("distinguishes unavailable and empty departure boards for selected route fallbacks", () => {
    expect(
      selectedDepartureStatus(undefined, planWithItinerary.itineraries[0]?.legs[0], {
        ...departureBoard,
        status: "unavailable",
        detail: "Entur avgangstavle svarer ikke akkurat nå.",
        departures: [],
      }),
    ).toEqual({
      label: "Sjekk AtB/Entur",
      detail:
        "Avgangstavla er utilgjengelig akkurat nå. Reiserådet bruker fortsatt Buss 3 fra Munkegata kl. 1. juni 11:10, men avgang, plattform og avvik må sjekkes hos AtB/Entur.",
      severity: "warning",
    });

    expect(
      selectedDepartureStatus(undefined, planWithItinerary.itineraries[0]?.legs[0], {
        ...departureBoard,
        status: "empty",
        detail: "Ingen avganger funnet nær valgt område.",
        departures: [],
      }),
    ).toEqual({
      label: "Ingen tavletreff",
      detail:
        "Avgangstavla for Valgt område har ingen avganger for valgt tidsrom. Reiserådet bruker Buss 3 fra Munkegata kl. 1. juni 11:10; sjekk AtB/Entur før du drar.",
      severity: "watch",
    });
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
