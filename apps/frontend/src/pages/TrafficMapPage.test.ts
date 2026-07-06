import type {
  PublicTransportDeparture,
  PublicTransportDepartureBoardPayload,
  TravelPlanPayload,
} from "@nytt/shared";
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
  buildTravelTimeComparisonModel,
  departureBoardContextFromPlan,
  departureBoardContextFromSuggestion,
  departureLineFilterKey,
  departureLineFilterOptions,
  departureTimeForPreset,
  displayDepartureRows,
  formatTravelDateTime,
  mergeTrafficFilterSearch,
  mergeTravelPlannerSearch,
  parseTravelPlannerSearch,
  readRememberedDepartureBoards,
  readRememberedTravelRoutes,
  removeRememberedDepartureBoard,
  removeRememberedTravelRoute,
  routeDepartureCheckpoints,
  routeDepartureConfidenceItems,
  routeDepartureConfidenceSummary,
  routePositions,
  selectedDepartureMatch,
  selectedDepartureStatus,
  selectedRouteWatchSummary,
  sortRememberedDepartureBoards,
  sortRememberedTravelRoutes,
  timeWindowForPreset,
  toggleRememberedTravelRoutePinned,
  travelTimeComparisonLiveCheckFromRouteDepartureConfidence,
  upsertRememberedDepartureBoard,
  travelPlanDecision,
  type RememberedDepartureBoard,
  upsertRememberedTravelRoute,
  type RememberedTravelRoute,
} from "./TrafficMapPage.js";

function storageReturning(raw: string | null): Storage {
  return {
    getItem: () => raw,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: raw ? 1 : 0,
  } as Storage;
}

describe("remembered travel routes", () => {
  it("deduplicates routes by actual query and preserves pinning", () => {
    const first = upsertRememberedTravelRoute(
      [],
      {
        originInput: "Munkegata",
        destinationInput: "Lade",
        originQuery: "63.43288, 10.39374",
        destinationQuery: "63.43300, 10.46400",
        originLabel: "Munkegata, Trondheim",
        destinationLabel: "Leangen, Trondheim",
        timePreset: "now",
      },
      "2026-07-07T08:00:00.000Z",
    );

    const pinned = toggleRememberedTravelRoutePinned(
      first,
      first[0]?.id ?? "",
      "2026-07-07T08:01:00.000Z",
    );
    const next = upsertRememberedTravelRoute(
      pinned,
      {
        originInput: "Munkegata",
        destinationInput: "Lade Arena",
        originQuery: "63.43288, 10.39374",
        destinationQuery: "63.43300, 10.46400",
        originLabel: "Munkegata, Trondheim",
        destinationLabel: "Leangen, Trondheim",
        timePreset: "in30",
      },
      "2026-07-07T08:02:00.000Z",
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      destinationInput: "Lade Arena",
      timePreset: "in30",
      pinned: true,
      useCount: 2,
      lastUsedAt: "2026-07-07T08:02:00.000Z",
    });
  });

  it("sorts pinned routes before recent routes", () => {
    const routes: RememberedTravelRoute[] = [
      {
        id: "a",
        originInput: "A",
        destinationInput: "B",
        originQuery: "A",
        destinationQuery: "B",
        timePreset: "now",
        pinned: false,
        useCount: 3,
        createdAt: "2026-07-07T07:00:00.000Z",
        lastUsedAt: "2026-07-07T09:00:00.000Z",
      },
      {
        id: "c",
        originInput: "C",
        destinationInput: "D",
        originQuery: "C",
        destinationQuery: "D",
        timePreset: "now",
        pinned: true,
        useCount: 1,
        createdAt: "2026-07-07T07:00:00.000Z",
        lastUsedAt: "2026-07-07T08:00:00.000Z",
      },
    ];

    expect(sortRememberedTravelRoutes(routes).map((route) => route.id)).toEqual(["c", "a"]);
  });

  it("drops invalid storage rows and survives corrupt or blocked storage", () => {
    const raw = JSON.stringify([
      {
        originInput: "Munkegata",
        destinationInput: "Leangen",
        originQuery: "63.43288, 10.39374",
        destinationQuery: "63.43300, 10.46400",
        timePreset: "later",
      },
      { originInput: "", destinationInput: "Leangen" },
    ]);
    expect(readRememberedTravelRoutes(storageReturning(raw))).toHaveLength(1);
    expect(readRememberedTravelRoutes(storageReturning("{"))).toEqual([]);
    expect(
      readRememberedTravelRoutes({
        getItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage),
    ).toEqual([]);
  });

  it("removes routes by id", () => {
    const routes = upsertRememberedTravelRoute(
      [],
      {
        originInput: "Munkegata",
        destinationInput: "Leangen",
        originQuery: "Munkegata",
        destinationQuery: "Leangen",
        timePreset: "now",
      },
      "2026-07-07T08:00:00.000Z",
    );

    expect(removeRememberedTravelRoute(routes, routes[0]?.id ?? "")).toEqual([]);
  });
});

describe("remembered departure boards", () => {
  it("deduplicates boards by coordinates and keeps recent boards first", () => {
    const first = upsertRememberedDepartureBoard(
      [],
      {
        label: "Munkegata, Trondheim",
        center: { lat: 63.432883, lon: 10.393742 },
      },
      "2026-07-07T08:00:00.000Z",
    );
    const second = upsertRememberedDepartureBoard(
      first,
      {
        label: "Munkegata",
        center: { lat: 63.432884, lon: 10.393743 },
      },
      "2026-07-07T08:02:00.000Z",
    );
    const third = upsertRememberedDepartureBoard(
      second,
      {
        label: "Leangen, Trondheim",
        center: { lat: 63.433, lon: 10.464 },
      },
      "2026-07-07T08:03:00.000Z",
    );

    expect(third).toHaveLength(2);
    expect(third.map((board) => board.label)).toEqual(["Leangen, Trondheim", "Munkegata"]);
    expect(third[1]).toMatchObject({
      useCount: 2,
      createdAt: "2026-07-07T08:00:00.000Z",
      lastUsedAt: "2026-07-07T08:02:00.000Z",
    });
  });

  it("sorts boards by recency, use count, then label", () => {
    const boards: RememberedDepartureBoard[] = [
      {
        id: "old",
        label: "Solsiden",
        center: { lat: 63.435, lon: 10.41 },
        useCount: 5,
        createdAt: "2026-07-07T07:00:00.000Z",
        lastUsedAt: "2026-07-07T08:00:00.000Z",
      },
      {
        id: "recent",
        label: "Munkegata",
        center: { lat: 63.432883, lon: 10.393742 },
        useCount: 1,
        createdAt: "2026-07-07T07:00:00.000Z",
        lastUsedAt: "2026-07-07T09:00:00.000Z",
      },
    ];

    expect(sortRememberedDepartureBoards(boards).map((board) => board.id)).toEqual([
      "recent",
      "old",
    ]);
  });

  it("drops invalid storage rows and survives corrupt or blocked storage", () => {
    const raw = JSON.stringify([
      {
        label: "Munkegata",
        center: { lat: 63.432883, lon: 10.393742 },
        useCount: 2,
        createdAt: "2026-07-07T07:00:00.000Z",
        lastUsedAt: "2026-07-07T08:00:00.000Z",
      },
      { label: "Uten koordinat" },
      { label: "Feil koordinat", center: { lat: 999, lon: 10.4 } },
    ]);

    expect(readRememberedDepartureBoards(storageReturning(raw))).toHaveLength(1);
    expect(readRememberedDepartureBoards(storageReturning("{"))).toEqual([]);
    expect(
      readRememberedDepartureBoards({
        getItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage),
    ).toEqual([]);
  });

  it("removes boards by id", () => {
    const boards = upsertRememberedDepartureBoard(
      [],
      {
        label: "Munkegata",
        center: { lat: 63.432883, lon: 10.393742 },
      },
      "2026-07-07T08:00:00.000Z",
    );

    expect(removeRememberedDepartureBoard(boards, boards[0]?.id ?? "")).toEqual([]);
  });
});

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

const planWithTransfer: TravelPlanPayload = {
  ...planWithItinerary,
  itineraries: [
    {
      ...planWithItinerary.itineraries[0]!,
      id: "itinerary-transfer",
      arrivalTime: "2026-06-01T09:34:00.000Z",
      durationSeconds: 1440,
      transferCount: 1,
      legs: [
        planWithItinerary.itineraries[0]!.legs[0]!,
        {
          ...planWithItinerary.itineraries[0]!.legs[0]!,
          id: "leg-bus-4",
          from: {
            name: "Strindheim",
            stopName: "Strindheim",
            stopId: "NSR:StopPlace:41000",
            coordinate: [10.447, 63.433],
          },
          to: {
            name: "Lade",
            stopName: "Lade",
            coordinate: [10.465, 63.444],
          },
          aimedStartTime: "2026-06-01T09:20:00.000Z",
          expectedStartTime: "2026-06-01T09:20:00.000Z",
          aimedEndTime: "2026-06-01T09:34:00.000Z",
          expectedEndTime: "2026-06-01T09:34:00.000Z",
          lineId: "ATB:Line:4",
          publicCode: "4",
          lineName: "Strindheim - Lade",
          serviceJourneyId: "ATB:ServiceJourney:4",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.447, 63.433],
              [10.465, 63.444],
            ],
          },
        },
      ],
    },
  ],
};

function planWithTravelDuration(input: {
  id: string;
  departureTime: string;
  arrivalTime: string;
  durationSeconds: number;
  decision?: TravelPlanPayload["itineraries"][number]["decision"];
  transferCount?: number;
  disruptionCount?: number;
}): TravelPlanPayload {
  const baseItinerary = planWithItinerary.itineraries[0]!;
  const baseLeg = baseItinerary.legs[0]!;
  return {
    ...planWithItinerary,
    itineraries: [
      {
        ...baseItinerary,
        id: input.id,
        decision: input.decision ?? "good",
        decisionReason:
          input.decision === "watch" ? "Nytt fant avvik som kan påvirke reisen." : "Normal reise.",
        departureTime: input.departureTime,
        arrivalTime: input.arrivalTime,
        durationSeconds: input.durationSeconds,
        transferCount: input.transferCount ?? 0,
        disruptionCount: input.disruptionCount ?? 0,
        legs: [
          {
            ...baseLeg,
            id: `${input.id}:leg`,
            aimedStartTime: input.departureTime,
            expectedStartTime: input.departureTime,
            aimedEndTime: input.arrivalTime,
            expectedEndTime: input.arrivalTime,
            durationSeconds: input.durationSeconds,
            notices:
              input.decision === "watch"
                ? [
                    {
                      id: `${input.id}:notice`,
                      title: "Forsinkelse på linja",
                      detail: "Beregn ekstra tid.",
                      source: "Entur avvik",
                      severity: "medium",
                    },
                  ]
                : [],
          },
        ],
      },
    ],
    journeyPlanner: {
      ...planWithItinerary.journeyPlanner,
      requestedDepartureTime: input.departureTime,
    },
  };
}

function departureFixture(
  override: Partial<PublicTransportDeparture> = {},
): PublicTransportDeparture {
  return {
    ...departureBoard.departures[0]!,
    ...override,
  };
}

describe("TrafficMapPage route overlay helpers", () => {
  it("restores a submitted travel plan from the URL", () => {
    expect(
      parseTravelPlannerSearch("preset=next24h&fra=%20Munkegata%20&til=Lade+Arena&tid=in30"),
    ).toEqual({
      originInput: "Munkegata",
      destinationInput: "Lade Arena",
      timePreset: "in30",
      shouldAutoSubmit: true,
    });

    expect(parseTravelPlannerSearch("fra=Munkegata&til=Lade&tid=in60").timePreset).toBe("in60");
    expect(parseTravelPlannerSearch("fra=Munkegata&til=Lade&tid=in120").timePreset).toBe("in120");
    expect(parseTravelPlannerSearch("fra=Munkegata&til=Lade&tid=weekend").timePreset).toBe("now");
  });

  it("keeps map filters and submitted travel plan params separate", () => {
    const withTravel = mergeTravelPlannerSearch("preset=next24h", {
      originInput: "Munkegata",
      destinationInput: "Lade Arena",
      timePreset: "tomorrow_morning",
    });

    expect(withTravel).toBe("preset=next24h&fra=Munkegata&til=Lade+Arena&tid=tomorrow_morning");

    const withSevereFilter = mergeTrafficFilterSearch(withTravel, {
      preset: "severe",
      categories: [
        "roadworks",
        "accident",
        "closure",
        "congestion",
        "weather",
        "restriction",
        "obstruction",
        "other",
      ],
      severities: ["high", "critical"],
      layers: {
        incidents: true,
        roadworks: true,
        travelTime: true,
        publicTransportDisruptions: true,
        publicTransportVehicles: false,
        weatherRisk: false,
        estimatedNews: true,
        privateNotes: false,
        showAll: false,
      },
    });
    const params = new URLSearchParams(withSevereFilter);

    expect(params.get("fra")).toBe("Munkegata");
    expect(params.get("til")).toBe("Lade Arena");
    expect(params.get("tid")).toBe("tomorrow_morning");
    expect(params.get("preset")).toBe("severe");

    expect(
      mergeTravelPlannerSearch("preset=next24h", {
        originInput: "Munkegata",
        destinationInput: "Lade Arena",
        timePreset: "now",
      }),
    ).toBe("preset=next24h&fra=Munkegata&til=Lade+Arena");
  });

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

  it("builds compact line filters by line and direction with disruption severity", () => {
    const delayedDeparture = departureFixture({
      id: "departure:3-delayed",
      expectedDepartureTime: "2026-06-01T09:18:00.000Z",
      delaySeconds: 240,
    });
    const options = departureLineFilterOptions([
      departureBoard.departures[0]!,
      delayedDeparture,
      departureBoard.departures[1]!,
    ]);

    expect(options[0]).toMatchObject({
      key: departureLineFilterKey(delayedDeparture),
      label: "Buss 3 mot Leangen",
      count: 2,
      severity: "warning",
    });
    expect(options[1]).toMatchObject({
      label: "Buss 71 mot Dora",
      count: 1,
      severity: "ok",
    });
  });

  it("filters departure rows by selected line and direction", () => {
    const lineKey = departureLineFilterKey(departureBoard.departures[0]!);

    expect(
      displayDepartureRows({
        departures: departureBoard.departures,
        activeFilterKey: lineKey,
      }).map((departure) => departure.id),
    ).toEqual(["departure:3"]);
  });

  it("builds route departure checkpoints for start and transfer boardings", () => {
    expect(routeDepartureCheckpoints(planWithTransfer, "itinerary-transfer")).toMatchObject([
      {
        id: "itinerary-transfer:leg-bus-3:0",
        index: 0,
        label: "Start: Munkegata",
        context: {
          scope: "origin",
          label: "Munkegata",
          center: { lat: 63.4305, lon: 10.3951 },
          startTime: "2026-06-01T09:10:00.000Z",
        },
      },
      {
        id: "itinerary-transfer:leg-bus-4:1",
        index: 1,
        label: "Bytte 1: Strindheim",
        context: {
          scope: "origin",
          label: "Strindheim",
          center: { lat: 63.433, lon: 10.447 },
          startTime: "2026-06-01T09:20:00.000Z",
        },
      },
    ]);
  });

  it("summarizes transfer confidence when a later boarding is cancelled", () => {
    const checkpoints = routeDepartureCheckpoints(planWithTransfer, "itinerary-transfer");
    const items = routeDepartureConfidenceItems(checkpoints, [
      { checkpointId: checkpoints[0]!.id, board: departureBoard },
      {
        checkpointId: checkpoints[1]!.id,
        board: {
          ...departureBoard,
          areaLabel: "Strindheim",
          center: { lat: 63.433, lon: 10.447 },
          departures: [
            departureFixture({
              id: "departure:4",
              stopId: "NSR:StopPlace:41000",
              stopName: "Strindheim",
              lineId: "ATB:Line:4",
              publicCode: "4",
              lineName: "Strindheim - Lade",
              serviceJourneyId: "ATB:ServiceJourney:4",
              destinationName: "Lade",
              aimedDepartureTime: "2026-06-01T09:20:00.000Z",
              expectedDepartureTime: "2026-06-01T09:20:00.000Z",
              cancelled: true,
            }),
          ],
        },
      },
    ]);

    expect(items.map((item) => item.status.label)).toEqual(["Sanntid", "Innstilt"]);
    expect(routeDepartureConfidenceSummary(items, "ready")).toEqual({
      heading: "Sjekk byttene før du drar",
      detail: "1 av 2 boardingpunkt trenger kontroll hos AtB/Entur før avreise.",
      severity: "warning",
    });
  });

  it("treats failed transfer-board reads as check-before-leaving states", () => {
    const checkpoints = routeDepartureCheckpoints(planWithTransfer, "itinerary-transfer");
    const items = routeDepartureConfidenceItems(checkpoints, [
      { checkpointId: checkpoints[0]!.id, board: departureBoard },
      { checkpointId: checkpoints[1]!.id, error: "Entur svarte ikke." },
    ]);

    expect(items[1]?.status).toEqual({
      label: "Sjekk AtB/Entur",
      detail:
        "Klarte ikke hente live-tavla for bytte 1: strindheim. Sjekk avgang og plattform hos AtB/Entur.",
      severity: "warning",
    });
    expect(routeDepartureConfidenceSummary(items, "partial")).toMatchObject({
      heading: "Sjekk byttene før du drar",
      severity: "warning",
    });
  });

  it("summarizes a clean selected route as calm but still points to AtB/Entur", () => {
    const checkpoints = routeDepartureCheckpoints(planWithItinerary, "itinerary-1");
    const items = routeDepartureConfidenceItems(checkpoints, [
      { checkpointId: checkpoints[0]!.id, board: departureBoard },
    ]);

    expect(
      selectedRouteWatchSummary(planWithItinerary, "itinerary-1", items, "ready"),
    ).toMatchObject({
      heading: "Valgt reise ser rolig ut",
      severity: "ok",
      items: [],
    });
  });

  it("lifts selected itinerary notices into a route watch summary", () => {
    const planWithNotice: TravelPlanPayload = {
      ...planWithItinerary,
      itineraries: [
        {
          ...planWithItinerary.itineraries[0]!,
          decision: "watch",
          decisionReason: "Holdeplassendring på ruten.",
          legs: [
            {
              ...planWithItinerary.itineraries[0]!.legs[0]!,
              notices: [
                {
                  id: "notice-stop-moved",
                  title: "Holdeplass flyttet",
                  detail: "Bruk midlertidig holdeplass ved Munkegata.",
                  source: "Entur avvik",
                  severity: "warning",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(selectedRouteWatchSummary(planWithNotice, "itinerary-1", [], "idle")).toMatchObject({
      heading: "Sjekk dette før avreise",
      severity: "warning",
      items: [
        {
          label: "Buss 3: Holdeplass flyttet",
          detail: "Bruk midlertidig holdeplass ved Munkegata.",
          source: "Entur avvik",
        },
      ],
    });
  });

  it("uses route live-board uncertainty as selected-route advice", () => {
    const checkpoints = routeDepartureCheckpoints(planWithTransfer, "itinerary-transfer");
    const items = routeDepartureConfidenceItems(checkpoints, [
      { checkpointId: checkpoints[0]!.id, board: departureBoard },
      { checkpointId: checkpoints[1]!.id, error: "Entur svarte ikke." },
    ]);

    expect(
      selectedRouteWatchSummary(planWithTransfer, "itinerary-transfer", items, "partial"),
    ).toMatchObject({
      heading: "Sjekk dette før avreise",
      severity: "warning",
      items: [
        {
          label: "Bytte 1: Strindheim: Sjekk AtB/Entur",
          source: "Live-tavle",
        },
      ],
    });
  });

  it("feeds selected-route live-board uncertainty into the travel-time comparison", () => {
    const nowPlan = planWithTravelDuration({
      id: "now",
      departureTime: "2026-06-01T09:10:00.000Z",
      arrivalTime: "2026-06-01T09:28:00.000Z",
      durationSeconds: 1080,
    });
    const laterPlan = planWithTravelDuration({
      id: "in30",
      departureTime: "2026-06-01T09:40:00.000Z",
      arrivalTime: "2026-06-01T09:58:00.000Z",
      durationSeconds: 1080,
    });

    const model = buildTravelTimeComparisonModel(
      [
        { preset: "now", plan: nowPlan },
        { preset: "in30", plan: laterPlan },
      ],
      "now",
      {
        heading: "Sjekk byttene før du drar",
        detail: "1 av 2 boardingpunkt trenger kontroll hos AtB/Entur før avreise.",
        severity: "warning",
      },
    );

    expect(model.recommendedPreset).toBe("in30");
    expect(model.heading).toContain("Vent til om 30 min");
    expect(model.detail).toContain("Live-sjekken for valgt reise gir usikkerhet");
    expect(model.options.find((option) => option.preset === "now")).toMatchObject({
      active: true,
      recommended: false,
      severity: "warning",
      detail:
        "Live-sjekk av valgt avreise: 1 av 2 boardingpunkt trenger kontroll hos AtB/Entur før avreise.",
    });
  });

  it("marks the active travel window as check-needed when later options are not usable", () => {
    const nowPlan = planWithTravelDuration({
      id: "now",
      departureTime: "2026-06-01T09:10:00.000Z",
      arrivalTime: "2026-06-01T09:28:00.000Z",
      durationSeconds: 1080,
    });

    const model = buildTravelTimeComparisonModel(
      [
        { preset: "now", plan: nowPlan },
        { preset: "in30", error: "Entur svarte ikke." },
      ],
      "now",
      {
        heading: "Følg med på byttene",
        detail: "1 av 2 boardingpunkt er ikke entydig live-bekreftet.",
        severity: "watch",
      },
    );

    expect(model.recommendedPreset).toBe("now");
    expect(model.heading).toBe("Sjekk valgt avreise");
    expect(model.detail).toContain("Valgt reise trenger ekstra sjekk");
    expect(model.options.find((option) => option.preset === "now")).toMatchObject({
      active: true,
      recommended: true,
      severity: "watch",
    });
  });

  it("only exports comparison live checks after live-board reads settle with uncertainty", () => {
    const checkpoints = routeDepartureCheckpoints(planWithTransfer, "itinerary-transfer");
    const items = routeDepartureConfidenceItems(checkpoints, [
      { checkpointId: checkpoints[0]!.id, board: departureBoard },
      { checkpointId: checkpoints[1]!.id, error: "Entur svarte ikke." },
    ]);

    expect(
      travelTimeComparisonLiveCheckFromRouteDepartureConfidence(items, "loading"),
    ).toBeUndefined();
    expect(
      travelTimeComparisonLiveCheckFromRouteDepartureConfidence(items, "partial"),
    ).toMatchObject({
      heading: "Sjekk byttene før du drar",
      severity: "warning",
    });
    expect(
      travelTimeComparisonLiveCheckFromRouteDepartureConfidence(
        routeDepartureConfidenceItems(routeDepartureCheckpoints(planWithItinerary, "itinerary-1"), [
          { checkpointId: "itinerary-1:leg-bus-3:0", board: departureBoard },
        ]),
        "ready",
      ),
    ).toBeUndefined();
  });

  it("keeps the matched itinerary departure visible when it falls outside the first rows", () => {
    const genericRows = Array.from({ length: 9 }, (_, index) =>
      departureFixture({
        id: `departure:generic-${index}`,
        lineId: `ATB:Line:${index + 20}`,
        publicCode: String(index + 20),
        destinationName: `Rute ${index + 20}`,
        expectedDepartureTime: `2026-06-01T09:${String(index + 1).padStart(2, "0")}:00.000Z`,
      }),
    );
    const matchedDeparture = departureFixture({
      id: "departure:matched-late",
      expectedDepartureTime: "2026-06-01T09:30:00.000Z",
    });

    const displayed = displayDepartureRows({
      departures: [...genericRows, matchedDeparture],
      activeFilterKey: "all",
      matchedDeparture,
      limit: 8,
    });

    expect(displayed.map((departure) => departure.id)).toContain("departure:matched-late");
    expect(displayed[0]?.id).toBe("departure:matched-late");
    expect(displayed).toHaveLength(8);
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
    expect(departureTimeForPreset("in60", base)).toBe("2026-07-05T21:00:00.000Z");
    expect(departureTimeForPreset("in120", base)).toBe("2026-07-05T22:00:00.000Z");
    expect(departureTimeForPreset("tomorrow_morning", base)).toBe("2026-07-06T05:30:00.000Z");
  });

  it("shows date context for future travel times outside the current Oslo day", () => {
    const base = new Date("2026-07-05T20:00:00.000Z");

    expect(formatTravelDateTime("2026-07-05T20:30:00.000Z", base)).toBe("22:30");
    expect(formatTravelDateTime("2026-07-06T05:30:00.000Z", base)).toBe("i morgen 07:30");
    expect(formatTravelDateTime("2026-07-08T05:30:00.000Z", base)).toBe("8. juli 07:30");
  });

  it("recommends waiting only when a later travel window is meaningfully better", () => {
    const nowPlan = planWithTravelDuration({
      id: "now",
      departureTime: "2026-06-01T09:10:00.000Z",
      arrivalTime: "2026-06-01T09:52:00.000Z",
      durationSeconds: 2520,
      decision: "watch",
      disruptionCount: 1,
    });
    const laterPlan = planWithTravelDuration({
      id: "in30",
      departureTime: "2026-06-01T09:40:00.000Z",
      arrivalTime: "2026-06-01T09:58:00.000Z",
      durationSeconds: 1080,
    });

    const model = buildTravelTimeComparisonModel(
      [
        { preset: "now", plan: nowPlan },
        { preset: "in30", plan: laterPlan },
      ],
      "now",
    );

    expect(model.recommendedPreset).toBe("in30");
    expect(model.heading).toContain("Vent til om 30 min");
    expect(model.options.find((option) => option.preset === "in30")).toMatchObject({
      recommended: true,
      severity: "ok",
      durationLabel: "18 min",
    });
  });

  it("keeps the chosen travel window when later options are only marginally different", () => {
    const nowPlan = planWithTravelDuration({
      id: "now",
      departureTime: "2026-06-01T09:10:00.000Z",
      arrivalTime: "2026-06-01T09:29:00.000Z",
      durationSeconds: 1140,
    });
    const laterPlan = planWithTravelDuration({
      id: "in30",
      departureTime: "2026-06-01T09:40:00.000Z",
      arrivalTime: "2026-06-01T09:56:00.000Z",
      durationSeconds: 960,
    });

    const model = buildTravelTimeComparisonModel(
      [
        { preset: "now", plan: nowPlan },
        { preset: "in30", plan: laterPlan },
      ],
      "now",
    );

    expect(model.recommendedPreset).toBe("now");
    expect(model.heading).toBe("Dra nå ser best ut");
    expect(model.options.find((option) => option.preset === "now")).toMatchObject({
      recommended: true,
      active: true,
    });
  });

  it("keeps partial comparison rows when one travel window fails", () => {
    const model = buildTravelTimeComparisonModel(
      [
        { preset: "now", plan: planWithItinerary },
        { preset: "in30", error: "Entur svarte ikke." },
      ],
      "now",
    );

    expect(model.status).toBe("partial");
    expect(model.options.find((option) => option.preset === "in30")).toMatchObject({
      status: "error",
      severity: "warning",
      detail: "Entur svarte ikke.",
    });
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
