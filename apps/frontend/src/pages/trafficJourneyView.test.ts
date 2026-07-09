import type {
  TrafficMapEvent,
  TravelPlanItinerary,
  TravelPlanLeg,
  TravelPlanPayload,
} from "@nytt/shared";
import { describe, expect, it } from "vitest";
import {
  buildJourneyAnswerView,
  buildJourneyContextView,
  shouldShowJourneyMap,
} from "./trafficJourneyView.js";

const generatedAt = "2026-07-09T10:00:00.000Z";

function trafficEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "traffic:roadwork",
    sourceEventId: "datex:roadwork",
    title: "Vegarbeid ved Bakklandet",
    description: "Ett felt er stengt.",
    category: "roadworks",
    severity: "medium",
    state: "active",
    source: "datex",
    validFrom: "2026-07-09T09:00:00.000Z",
    updatedAt: "2026-07-09T09:30:00.000Z",
    locationName: "Bakklandet",
    geometry: {
      type: "Point",
      coordinates: [10.412, 63.429],
    },
    ...overrides,
  };
}

function leg(overrides: Partial<TravelPlanLeg> = {}): TravelPlanLeg {
  return {
    id: "leg-bus-2",
    mode: "bus",
    from: {
      name: "Søndre gate",
      stopName: "Søndre gate",
      stopId: "NSR:Quay:1",
      coordinate: [10.395, 63.431],
    },
    to: {
      name: "Lade gård",
      stopName: "Lade gård",
      coordinate: [10.463, 63.433],
    },
    aimedStartTime: "2026-07-09T10:28:00.000Z",
    expectedStartTime: "2026-07-09T10:28:00.000Z",
    aimedEndTime: "2026-07-09T10:46:00.000Z",
    expectedEndTime: "2026-07-09T10:46:00.000Z",
    durationSeconds: 1080,
    distanceMeters: 3100,
    realtime: true,
    cancelled: false,
    replacementTransport: false,
    lineId: "ATB:Line:2",
    publicCode: "2",
    lineName: "Strindheim-Lade-sentrum",
    serviceJourneyId: "ATB:ServiceJourney:2",
    geometry: {
      type: "LineString",
      coordinates: [
        [10.395, 63.431],
        [10.463, 63.433],
      ],
    },
    notices: [],
    ...overrides,
  };
}

function itinerary(overrides: Partial<TravelPlanItinerary> = {}): TravelPlanItinerary {
  const legs = overrides.legs ?? [leg()];
  return {
    id: "itinerary-1",
    decision: "best",
    decisionReason: "Direkte reiseforslag uten kjente avvik.",
    labels: ["best_now", "fewest_transfers", "most_robust"],
    departureTime: "2026-07-09T10:28:00.000Z",
    arrivalTime: "2026-07-09T10:46:00.000Z",
    durationSeconds: 1080,
    transferCount: 0,
    walkTimeSeconds: 480,
    realtime: true,
    modes: ["bus"],
    legs,
    disruptionCount: 0,
    handoffUrl: "https://www.atb.no/reiseplanlegger/",
    ...overrides,
  };
}

function plan(overrides: Partial<TravelPlanPayload> = {}): TravelPlanPayload {
  return {
    origin: {
      query: "Munkegata",
      label: "Munkegata, Trondheim",
      coordinate: [10.393742, 63.432883],
    },
    destination: {
      query: "Lade",
      label: "Lade gård, Trondheim",
      coordinate: [10.463, 63.433],
    },
    route: {
      source: "osrm",
      detail: "Rute beregnet med OSRM.",
      distanceMeters: 3500,
      durationSeconds: 360,
      geometry: {
        type: "LineString",
        coordinates: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
    },
    trafficImpacts: [],
    publicTransportSuggestions: [],
    itineraries: [],
    journeyPlanner: {
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet.",
      requestedDepartureTime: generatedAt,
      source: "Entur Journey Planner",
    },
    sources: [],
    generatedAt,
    ...overrides,
  };
}

describe("traffic journey answer view", () => {
  it("answers with the concrete first transit leg when a usable itinerary exists", () => {
    const answer = buildJourneyAnswerView(
      plan({
        itineraries: [itinerary()],
        journeyPlanner: {
          status: "ok",
          detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
          requestedDepartureTime: generatedAt,
          source: "Entur Journey Planner",
        },
      }),
      "itinerary-1",
    );

    expect(answer.kind).toBe("transit");
    expect(answer.heading).toBe("Ta Buss 2 fra Søndre gate");
    expect(answer.meta).toBe("12:28 → 12:46 · 18 min · Direkte · 8 min gange");
    expect(answer.primaryItineraryId).toBe("itinerary-1");
    expect(answer.handoffLabel).toBe("Åpne hos AtB/Entur");
    expect(answer.routeOptions.map((option) => option.label)).toEqual(["Anbefalt"]);
  });

  it("uses walking as the first answer when Entur returns a walk-only itinerary", () => {
    const walkingLeg = leg({
      id: "leg-walk",
      mode: "walk",
      from: {
        name: "Munkegata",
        coordinate: [10.393742, 63.432883],
      },
      to: {
        name: "Lade gård",
        coordinate: [10.463, 63.433],
      },
      durationSeconds: 2520,
      distanceMeters: 3500,
      publicCode: undefined,
      lineId: undefined,
      lineName: undefined,
      serviceJourneyId: undefined,
      geometry: {
        type: "LineString",
        coordinates: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
    });
    const answer = buildJourneyAnswerView(
      plan({
        itineraries: [
          itinerary({
            id: "walk-itinerary",
            decision: "good",
            decisionReason: "Entur foreslår gange hele veien.",
            labels: [],
            departureTime: "2026-07-09T10:28:00.000Z",
            arrivalTime: "2026-07-09T11:10:00.000Z",
            durationSeconds: 2520,
            transferCount: 0,
            walkTimeSeconds: 2520,
            modes: ["walk"],
            legs: [walkingLeg],
          }),
        ],
        journeyPlanner: {
          status: "ok",
          detail: "Entur Journey Planner returnerte et gangforslag.",
          requestedDepartureTime: generatedAt,
          source: "Entur Journey Planner",
        },
      }),
    );

    expect(answer.kind).toBe("walk");
    expect(answer.heading).toBe("Gå til Lade gård, Trondheim");
    expect(answer.meta).toBe("3,5 km · ca. 42 min");
    expect(answer.primaryItineraryId).toBe("walk-itinerary");
    expect(answer.detail).toContain("Entur foreslår gange");
  });

  it("does not call the driving traffic corridor a walking route", () => {
    const answer = buildJourneyAnswerView(plan());

    expect(answer.kind).toBe("handoff");
    expect(answer.heading).toBe("Sjekk AtB/Entur");
    expect(answer.detail).toContain("Ingen konkrete Entur-reiser funnet");
  });

  it("falls back to operator handoff when neither transit nor walking route is useful", () => {
    const answer = buildJourneyAnswerView(
      plan({
        route: {
          source: "direct",
          detail: "Rute kunne ikke beregnes.",
          distanceMeters: 0,
          geometry: {
            type: "LineString",
            coordinates: [],
          },
        },
        journeyPlanner: {
          status: "unavailable",
          detail: "Entur svarte ikke innen fristen.",
          requestedDepartureTime: generatedAt,
          source: "Entur Journey Planner",
        },
      }),
    );

    expect(answer.kind).toBe("handoff");
    expect(answer.heading).toBe("Sjekk AtB/Entur");
    expect(answer.detail).toContain("Entur svarte ikke innen fristen");
    expect(answer.handoffUrl).toBe("https://www.atb.no/reiseplanlegger/");
  });

  it("keeps route context compact and map-first", () => {
    const context = buildJourneyContextView(
      plan({
        trafficImpacts: [
          {
            event: trafficEvent({ id: "traffic:near", severity: "high" }),
            distanceMeters: 121,
            severity: "high",
            summary: "121 m fra foreslått rute.",
          },
        ],
        publicTransportSuggestions: [
          {
            id: "alert:line-2",
            kind: "alert",
            title: "Endret rute",
            detail: "Linje 2 kjører via Lerkendal.",
            source: "Entur avvik",
          },
        ],
      }),
    );

    expect(context.heading).toBe("1 kartpunkt · 1 linjevarsel");
    expect(context.mapCallouts).toHaveLength(1);
    expect(context.compactItems.map((item) => item.title)).toEqual([
      "Vegarbeid ved Bakklandet",
      "Endret rute",
    ]);
  });

  it("shows the map whenever a useful route geometry exists", () => {
    expect(shouldShowJourneyMap(plan())).toBe(true);
    expect(
      shouldShowJourneyMap(
        plan({
          route: {
            source: "direct",
            detail: "Rute kunne ikke beregnes.",
            distanceMeters: 0,
            geometry: { type: "LineString", coordinates: [] },
          },
        }),
      ),
    ).toBe(false);
  });
});
