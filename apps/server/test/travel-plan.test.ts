import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  clearEnturDepartureBoardCache,
  enrichDepartureBoardWithServiceAlerts,
  publicTransportDepartureBoardFromEntur,
} from "../src/traffic/departure-board.js";
import {
  buildTravelPlanPayload,
  clearEnturJourneyCache,
  fetchEnturJourneyItineraries,
} from "../src/traffic/travel-plan.js";
import {
  clearEnturTravelSuggestionCache,
  travelPlaceSuggestionsFromEntur,
} from "../src/traffic/travel-suggestions.js";
import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  TrafficMapEvent,
  TravelPlanItinerary,
  TravelPlanRoute,
} from "@nytt/shared";

async function testApp() {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: true,
  });
  return { ...runtime, uploadDir };
}

function trafficEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "vegvesen-traffic-info:near-e6-roadwork",
    source: "vegvesen_traffic_info",
    sourceEventId: "near-e6-roadwork",
    category: "roadworks",
    severity: "high",
    state: "active",
    title: "Veiarbeid på E6 ved Leangen",
    description: "Ett felt er stengt i retning sentrum.",
    locationName: "Leangen",
    roadName: "E6",
    validFrom: "2026-06-01T08:00:00.000Z",
    validTo: "2026-06-01T16:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/near-e6-roadwork",
    geometry: { type: "Point", coordinates: [10.432, 63.432] },
    rawType: "roadworks",
    confidence: 0.98,
    ...overrides,
  };
}

const sourceHealth = [
  {
    source: "vegvesen_traffic_info",
    label: "Vegvesen TrafficInfo",
    state: "ok",
    detail: "Meldinger hentet",
    lastCheckedAt: "2026-06-01T09:05:00.000Z",
  },
  { source: "datex", label: "DATEX", state: "ok", detail: "DATEX ok" },
  { source: "entur_vehicle_positions", label: "Entur kjøretøy", state: "ok", detail: "1 buss" },
  { source: "entur_service_alerts", label: "Entur avvik", state: "ok", detail: "1 avvik" },
] satisfies SourceHealth[];

const line71Alert = {
  id: "entur-service-alert:ATB:line-71-delay",
  source: "entur_service_alerts",
  codespaceId: "ATB",
  situationNumber: "line-71-delay",
  severity: "severe",
  summary: "Forsinkelser på linje 71",
  description: "Forsinkelser etter trafikale problemer.",
  updatedAt: "2026-07-05T16:10:00.000Z",
  state: "active",
  affectedLineRefs: ["ATB:Line:71"],
  affectedLineNames: ["71"],
} satisfies PublicTransportServiceAlert;

const testRoute = {
  source: "direct",
  distanceMeters: 2520,
  detail: "Direkte korridor mellom punktene.",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.393742, 63.432883],
      [10.463, 63.433],
    ],
  },
} satisfies TravelPlanRoute;

const minimalItinerary = {
  id: "itinerary-bus-2",
  decision: "best",
  decisionReason: "Raskeste konkrete kollektivvalg.",
  labels: ["best_now"],
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T10:18:00.000Z",
  durationSeconds: 1080,
  transferCount: 0,
  walkTimeSeconds: 420,
  realtime: true,
  modes: ["bus"],
  legs: [],
  disruptionCount: 0,
  handoffUrl: "https://entur.no/reiseresultater",
} satisfies TravelPlanItinerary;

const walkOnlyItinerary = {
  ...minimalItinerary,
  id: "itinerary-walk-1",
  modes: ["walk"],
  legs: [],
} satisfies TravelPlanItinerary;

const avoidItinerary = {
  ...minimalItinerary,
  id: "itinerary-bus-avoid",
  decision: "avoid",
  decisionReason: "Minst én del av reisen er innstilt eller har kritisk trafikkpåvirkning.",
  legs: [
    {
      id: "leg-bus-cancelled",
      mode: "bus",
      from: {
        name: "Munkegata",
        coordinate: [10.393742, 63.432883],
        stopId: "NSR:StopPlace:63277",
        stopName: "Munkegata",
        stopCode: "M1",
      },
      to: {
        name: "Lade",
        coordinate: [10.463, 63.433],
        stopId: "NSR:StopPlace:65000",
        stopName: "Lade",
        stopCode: "L1",
      },
      aimedStartTime: "2026-06-01T10:00:00.000Z",
      expectedStartTime: "2026-06-01T10:00:00.000Z",
      aimedEndTime: "2026-06-01T10:18:00.000Z",
      expectedEndTime: "2026-06-01T10:18:00.000Z",
      durationSeconds: 1080,
      distanceMeters: 2520,
      realtime: true,
      cancelled: true,
      replacementTransport: false,
      lineId: "ATB:Line:3",
      publicCode: "3",
      lineName: "Lade - Hallset",
      serviceJourneyId: "ATB:ServiceJourney:3",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
      notices: [
        {
          id: "entur-cancelled",
          title: "Avgangen er innstilt",
          detail: "Finn alternativ avgang.",
          source: "Entur",
          severity: "critical",
        },
      ],
    },
  ],
} satisfies TravelPlanItinerary;

afterEach(() => {
  clearEnturJourneyCache();
  clearEnturDepartureBoardCache();
  clearEnturTravelSuggestionCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function enturTripResponse(
  overrides: {
    empty?: boolean;
    cancelled?: boolean;
    replacement?: boolean;
    walkOnly?: boolean;
    missingExpectedTimes?: boolean;
    malformedSecondLeg?: boolean;
    routingErrors?: boolean;
    patternCount?: number;
  } = {},
): Response {
  const leg = {
    id: overrides.walkOnly ? "leg-walk" : "leg-bus-3",
    mode: overrides.walkOnly ? "foot" : "bus",
    aimedStartTime: "2026-06-01T09:10:00+02:00",
    ...(overrides.missingExpectedTimes ? {} : { expectedStartTime: "2026-06-01T09:10:00+02:00" }),
    aimedEndTime: "2026-06-01T09:27:00+02:00",
    ...(overrides.missingExpectedTimes ? {} : { expectedEndTime: "2026-06-01T09:27:00+02:00" }),
    duration: 1020,
    distance: overrides.walkOnly ? 1200 : 4850,
    realtime: !overrides.walkOnly,
    fromPlace: {
      name: "Munkegata",
      latitude: 63.4305,
      longitude: 10.3951,
      quay: {
        id: "NSR:Quay:1",
        name: "Munkegata",
        publicCode: "M1",
      },
    },
    toPlace: {
      name: "Leangen",
      latitude: 63.433,
      longitude: 10.464,
      quay: {
        id: "NSR:Quay:2",
        name: "Leangen",
        publicCode: "L1",
      },
    },
    line: overrides.walkOnly
      ? null
      : {
          id: "ATB:Line:3",
          publicCode: "3",
          name: "Lade - Hallset",
          transportMode: "bus",
          isReplacement: overrides.replacement ?? false,
        },
    serviceJourney: overrides.walkOnly
      ? null
      : {
          id: "ATB:ServiceJourney:3",
          publicCode: "3",
          isReplacement: overrides.replacement ?? false,
        },
    fromEstimatedCall: {
      cancellation: overrides.cancelled ?? false,
      realtime: !overrides.walkOnly,
    },
    toEstimatedCall: {
      cancellation: overrides.cancelled ?? false,
      realtime: !overrides.walkOnly,
    },
    situations: overrides.cancelled
      ? [
          {
            id: "ATB:Situation:cancelled",
            summary: [{ value: "Avgangen er innstilt", language: "no" }],
            advice: [{ value: "Finn alternativ avgang.", language: "no" }],
            severity: "severe",
          },
        ]
      : [],
  };
  const malformedLeg = {
    id: "leg-malformed",
    mode: "bus",
    aimedStartTime: "ikke-en-dato",
    expectedStartTime: "ikke-en-dato",
    duration: 0,
    fromPlace: leg.fromPlace,
  };
  return Response.json({
    data: {
      trip: {
        tripPatterns: overrides.empty
          ? []
          : Array.from({ length: overrides.patternCount ?? 1 }, (_, index) => ({
              expectedStartTime: "2026-06-01T09:10:00+02:00",
              expectedEndTime: "2026-06-01T09:27:00+02:00",
              duration: 1020 + index,
              walkTime: 240,
              waitingTime: 120,
              distance: 4850,
              legs: overrides.malformedSecondLeg ? [leg, malformedLeg] : [leg],
            })),
        routingErrors: overrides.routingErrors
          ? [{ code: "NO_TRANSIT", description: "No transit found", inputField: "to" }]
          : [],
      },
    },
  });
}

function enturDepartureBoardResponse(
  overrides: {
    empty?: boolean;
    cancelled?: boolean;
    alert?: boolean;
    delayedSeconds?: number;
  } = {},
): Response {
  const aimedDeparture = "2026-07-05T18:24:00+02:00";
  const expectedDeparture = new Date(
    Date.parse("2026-07-05T16:24:00.000Z") + (overrides.delayedSeconds ?? 168) * 1000,
  ).toISOString();
  return Response.json({
    data: {
      nearest: {
        edges: [
          {
            node: {
              distance: 182.786,
              place: {
                __typename: "StopPlace",
                id: "NSR:StopPlace:41613",
                name: "Prinsens gate",
                latitude: 63.431034,
                longitude: 10.392007,
                transportMode: ["bus"],
                estimatedCalls: overrides.empty
                  ? []
                  : [
                      {
                        realtime: true,
                        aimedDepartureTime: aimedDeparture,
                        expectedDepartureTime: expectedDeparture,
                        cancellation: overrides.cancelled ?? false,
                        destinationDisplay: { frontText: "Dora" },
                        quay: {
                          id: "NSR:Quay:71181",
                          name: "Prinsens gate",
                          publicCode: "P2",
                        },
                        serviceJourney: {
                          id: "ATB:ServiceJourney:71",
                          journeyPattern: {
                            line: {
                              id: "ATB:Line:71",
                              name: "MelhusSkyss-Trondheim",
                              publicCode: "71",
                              transportMode: "bus",
                            },
                          },
                        },
                        situations: overrides.alert
                          ? [
                              {
                                id: "ATB:Situation:25576-line",
                                summary: [{ value: "Endret rute", language: null }],
                                description: [{ value: "Planlagt vegarbeid.", language: null }],
                                severity: "normal",
                              },
                            ]
                          : [],
                      },
                    ],
              },
            },
          },
        ],
      },
    },
  });
}

function enturGeocoderPayload() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [10.393742, 63.432883] },
        properties: {
          id: "NSR:StopPlace:63277",
          names: { default: "Munkegata", display: "Munkegata, Trondheim" },
          layer: "stopPlace",
          source: "nsr",
          address: { locality: "Trondheim", county: "Trøndelag", countryCode: "no" },
          transportModes: [{ mode: "bus" }],
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [10.394221, 63.431381] },
        properties: {
          id: "KVE:TopographicPlace:5001-Munkegata",
          names: { default: "Munkegata", display: "Munkegata, Trondheim" },
          layer: "address",
          source: "kartverket-matrikkelenadresse",
          address: { locality: "Trondheim", county: "Trøndelag", countryCode: "no" },
          categories: ["street"],
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [10.76794, 59.90834] },
        properties: {
          id: "NSR:StopPlace:62017",
          names: { default: "Munkegata", display: "Munkegata, Oslo" },
          layer: "stopPlace",
          source: "nsr",
          address: { locality: "Oslo", county: "Oslo", countryCode: "no" },
        },
      },
    ],
  };
}

function enturGeocoderResponse(): Response {
  return Response.json(enturGeocoderPayload());
}

describe("traffic travel planner API", () => {
  it("parses Entur Geocoder suggestions and filters places outside Trøndelag", () => {
    const payload = travelPlaceSuggestionsFromEntur({
      payload: enturGeocoderPayload(),
      query: "Munkegata",
      limit: 6,
      generatedAt: new Date("2026-07-05T18:00:00.000Z"),
    });

    expect(payload).toMatchObject({
      query: "Munkegata",
      status: "ok",
      detail: "Entur foreslår stopp og steder i Trøndelag.",
      generatedAt: "2026-07-05T18:00:00.000Z",
      suggestions: [
        expect.objectContaining({
          id: "NSR:StopPlace:63277",
          label: "Munkegata, Trondheim",
          kind: "stop",
          locality: "Trondheim",
          coordinate: [10.393742, 63.432883],
          source: "Entur Geocoder",
        }),
        expect.objectContaining({
          id: "KVE:TopographicPlace:5001-Munkegata",
          kind: "address",
          coordinate: [10.394221, 63.431381],
        }),
      ],
    });
    expect(payload.suggestions.map((suggestion) => suggestion.label)).not.toContain(
      "Munkegata, Oslo",
    );
  });

  it("returns cached Entur travel suggestions without persisting traveller context", async () => {
    let enturRequestCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      expect(url.href).toContain("/geocoder/v3/autocomplete");
      expect(url.searchParams.get("q")).toBe("Munkegata");
      expect(url.searchParams.get("limit")).toBe("18");
      expect(url.searchParams.get("bbox")).toBe("8,62.2,12.4,64.7");
      expect((init?.headers as Record<string, string>)["ET-Client-Name"]).toBe(
        "reidar-nytt-trondheim",
      );
      enturRequestCount += 1;
      return enturGeocoderResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    const listSourceItems = vi.spyOn(store, "listSourceItems");
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const first = await agent.get("/api/map/travel-suggestions?q=Munkegata").expect(200);
    const second = await agent.get("/api/map/travel-suggestions?q=Munkegata").expect(200);

    expect(first.body).toMatchObject({
      status: "ok",
      suggestions: expect.arrayContaining([
        expect.objectContaining({ label: "Munkegata, Trondheim" }),
      ]),
    });
    expect(second.body.suggestions).toEqual(first.body.suggestions);
    expect(enturRequestCount).toBe(1);
    expect(listSourceItems).not.toHaveBeenCalled();
  });

  it("keeps travel suggestions useful when Entur autocomplete fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ errors: [{ message: "rate limited" }] }, { status: 429 })),
    );
    const { app } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const response = await agent.get("/api/map/travel-suggestions?q=Munkegata").expect(200);

    expect(response.body).toMatchObject({
      query: "Munkegata",
      status: "unavailable",
      detail:
        "Entur stedsøk er ikke tilgjengelig akkurat nå. Skriv inn adresse, stopp eller koordinater.",
      suggestions: [],
    });
  });

  it("parses an Entur departure board with delays, cancellations and notices", () => {
    const payload = publicTransportDepartureBoardFromEntur({
      payload: {
        data: {
          nearest: {
            edges: [
              {
                node: {
                  distance: 180.5,
                  place: {
                    __typename: "StopPlace",
                    id: "NSR:StopPlace:41613",
                    name: "Prinsens gate",
                    latitude: 63.431034,
                    longitude: 10.392007,
                    transportMode: ["bus"],
                    estimatedCalls: [
                      {
                        realtime: true,
                        aimedDepartureTime: "2026-07-05T18:24:00+02:00",
                        expectedDepartureTime: "2026-07-05T18:27:00+02:00",
                        cancellation: true,
                        destinationDisplay: { frontText: "Dora" },
                        quay: { id: "NSR:Quay:71181", name: "Prinsens gate", publicCode: "P2" },
                        serviceJourney: {
                          id: "ATB:ServiceJourney:71",
                          journeyPattern: {
                            line: {
                              id: "ATB:Line:71",
                              name: "MelhusSkyss-Trondheim",
                              publicCode: "71",
                              transportMode: "bus",
                            },
                          },
                        },
                        situations: [
                          {
                            id: "ATB:Situation:25576-line",
                            summary: [{ value: "Endret rute", language: null }],
                            description: [{ value: "Planlagt vegarbeid.", language: null }],
                            severity: "normal",
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      center: { lat: 63.4305, lon: 10.3951 },
      generatedAt: new Date("2026-07-05T16:20:00.000Z"),
      departureLimit: 8,
    });

    expect(payload).toMatchObject({
      status: "ok",
      areaLabel: "Trondheim sentrum",
      departures: [
        expect.objectContaining({
          stopName: "Prinsens gate",
          publicCode: "71",
          serviceJourneyId: "ATB:ServiceJourney:71",
          destinationName: "Dora",
          delaySeconds: 180,
          realtime: true,
          cancelled: true,
          notices: expect.arrayContaining([
            expect.objectContaining({ title: "Endret rute", severity: "info" }),
            expect.objectContaining({ title: "Avgangen er innstilt", severity: "warning" }),
          ]),
        }),
      ],
    });

    const enriched = enrichDepartureBoardWithServiceAlerts(payload, [line71Alert]);
    expect(enriched.detail).toContain("Aktive Entur-avvik");
    expect(enriched.departures[0]?.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Forsinkelser på linje 71", severity: "warning" }),
      ]),
    );
    expect(enriched.stops[0]?.departures[0]?.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Forsinkelser på linje 71", severity: "warning" }),
      ]),
    );
  });

  it("returns a default Trondheim departure board without persisting Entur trip data", async () => {
    let enturRequestCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      expect(url.hostname).toBe("api.entur.io");
      enturRequestCount += 1;
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["ET-Client-Name"]).toBe(
        "reidar-nytt-trondheim",
      );
      const body = JSON.parse(String(init?.body)) as {
        variables: {
          lat: number;
          lon: number;
          stopLimit: number;
          departureLimit: number;
          startTime: string;
        };
      };
      expect(body.variables).toMatchObject({
        lat: 63.4305,
        lon: 10.3951,
        stopLimit: 4,
        departureLimit: 12,
      });
      expect(Date.parse(body.variables.startTime)).not.toBeNaN();
      return enturDepartureBoardResponse({ alert: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);
    vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([line71Alert]);
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const first = await agent.get("/api/map/public-transport/departures").expect(200);
    const second = await agent.get("/api/map/public-transport/departures").expect(200);

    expect(first.body).toMatchObject({
      status: "ok",
      detail:
        "Entur viser konkrete avganger nær valgt område. Aktive Entur-avvik er matchet mot relevante avganger.",
      areaLabel: "Trondheim sentrum",
      departures: [
        expect.objectContaining({
          stopName: "Prinsens gate",
          publicCode: "71",
          serviceJourneyId: "ATB:ServiceJourney:71",
          destinationName: "Dora",
          delaySeconds: 168,
          realtime: true,
          notices: [
            expect.objectContaining({ title: "Endret rute" }),
            expect.objectContaining({ title: "Forsinkelser på linje 71" }),
          ],
        }),
      ],
    });
    expect(second.body.departures).toEqual(first.body.departures);
    expect(first.body.sources.map((source: SourceHealth) => source.source)).toEqual([
      "entur_vehicle_positions",
      "entur_service_alerts",
    ]);
    expect(enturRequestCount).toBe(1);
  });

  it("forwards explicit departure-board start time to Entur", async () => {
    const requestedStartTime = "2026-07-05T08:30:00.000Z";
    let enturStartTime: string | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      expect(url.hostname).toBe("api.entur.io");
      enturStartTime = (
        JSON.parse(String(init?.body)) as {
          variables: { startTime: string };
        }
      ).variables.startTime;
      return enturDepartureBoardResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const response = await agent
      .get(
        `/api/map/public-transport/departures?lat=63.4305&lon=10.3951&startTime=${encodeURIComponent(requestedStartTime)}`,
      )
      .expect(200);

    expect(enturStartTime).toBe(requestedStartTime);
    expect(response.body.generatedAt).not.toBe(requestedStartTime);
  });

  it("keeps /trafikk useful when the Entur departure board fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ errors: [{ message: "rate limited" }] }, { status: 429 })),
    );
    const { app, store } = await testApp();
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const response = await agent.get("/api/map/public-transport/departures").expect(200);

    expect(response.body).toMatchObject({
      status: "unavailable",
      detail: "Entur avgangstavle er ikke tilgjengelig akkurat nå. Trafikkbildet vises fortsatt.",
      departures: [],
      stops: [],
    });
  });

  it("geocodes a from/to trip and returns traffic plus public transport suggestions near the route", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "nominatim.openstreetmap.org") {
        const query = url.searchParams.get("q") ?? "";
        if (query.includes("Munkegata")) {
          return Response.json([
            {
              display_name: "Munkegata, Midtbyen, Trondheim, Trøndelag, Norge",
              lat: "63.4305",
              lon: "10.3951",
            },
          ]);
        }
        if (query.includes("Leangen")) {
          return Response.json([
            {
              display_name: "Leangen, Trondheim, Trøndelag, Norge",
              lat: "63.4330",
              lon: "10.4640",
            },
          ]);
        }
      }
      if (url.hostname === "router.project-osrm.org") {
        return Response.json({
          routes: [
            {
              distance: 4_850,
              duration: 660,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.432, 63.432],
                  [10.464, 63.433],
                ],
              },
            },
          ],
        });
      }
      if (url.hostname === "api.entur.io") {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["ET-Client-Name"]).toBe(
          "reidar-nytt-trondheim",
        );
        const body = JSON.parse(String(init?.body)) as {
          variables: {
            from: { coordinates: unknown };
            to: { coordinates: unknown };
            dateTime: string;
          };
        };
        expect(body.variables.from.coordinates).toEqual({
          latitude: 63.4305,
          longitude: 10.3951,
        });
        expect(body.variables.to.coordinates).toEqual({
          latitude: 63.433,
          longitude: 10.464,
        });
        expect(body.variables.dateTime).toEqual(expect.any(String));
        return enturTripResponse();
      }
      throw new Error(`unexpected fetch ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([
      trafficEvent({
        validFrom: "2026-07-08T08:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
      }),
      trafficEvent({
        id: "vegvesen-traffic-info:far-roadwork",
        sourceEventId: "far-roadwork",
        title: "Veiarbeid langt unna ruten",
        validFrom: "2026-07-08T08:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        geometry: { type: "Point", coordinates: [10.8, 63.6] },
      }),
    ]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportVehicles").mockResolvedValue([
      {
        id: "entur-vehicle:ATB:3-1",
        source: "entur_vehicle_positions",
        codespaceId: "ATB",
        vehicleId: "3-1",
        mode: "bus",
        publicCode: "3",
        lineName: "Lade - Hallset",
        destinationName: "Lade",
        lastUpdated: "2026-06-01T09:04:00.000Z",
        geometry: { type: "Point", coordinates: [10.431, 63.4319] },
        stale: false,
      },
    ] satisfies PublicTransportVehicle[]);
    vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([
      {
        id: "entur-service-alert:ATB:line3",
        source: "entur_service_alerts",
        codespaceId: "ATB",
        situationNumber: "ATB:line3",
        state: "active",
        summary: "Forsinkelse på linje 3",
        advice: "Beregn ekstra tid.",
        updatedAt: "2026-06-01T09:03:00.000Z",
        affectedLineNames: ["Lade - Hallset"],
        geometry: { type: "Point", coordinates: [10.433, 63.432] },
      },
      {
        id: "entur-service-alert:ATB:line9",
        source: "entur_service_alerts",
        codespaceId: "ATB",
        situationNumber: "ATB:line9",
        state: "active",
        summary: "Stengt holdeplass for linje 9",
        advice: "Bruk alternativ holdeplass.",
        updatedAt: "2026-06-01T09:03:00.000Z",
        affectedLineNames: ["Linje 9"],
      },
    ] satisfies PublicTransportServiceAlert[]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent.get("/api/map/travel-plan?from=Munkegata&to=Leangen").expect(200);

    expect(response.body.origin).toMatchObject({
      query: "Munkegata",
      label: expect.stringContaining("Munkegata"),
      coordinate: [10.3951, 63.4305],
    });
    expect(response.body.destination).toMatchObject({
      query: "Leangen",
      label: expect.stringContaining("Leangen"),
      coordinate: [10.464, 63.433],
    });
    expect(response.body.route).toMatchObject({
      source: "osrm",
      distanceMeters: 4850,
      durationSeconds: 660,
    });
    expect(response.body.trafficImpacts).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ title: "Veiarbeid på E6 ved Leangen" }),
        distanceMeters: expect.any(Number),
      }),
    ]);
    expect(response.body.publicTransportSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "vehicle",
          title: "Buss 3 mot Lade",
          source: "Entur kjøretøyposisjoner",
        }),
        expect.objectContaining({
          kind: "alert",
          title: "Forsinkelse på linje 3",
          source: "Entur avvik",
        }),
        expect.objectContaining({
          kind: "planning_link",
          title: "Sjekk avganger hos AtB/Entur",
          detail:
            "Nytt viser trafikk- og avvikskontekst; bruk AtB/Entur for konkrete avganger og billetter.",
          source: "AtB/Entur",
          href: "https://www.atb.no/reiseplanlegger/",
        }),
      ]),
    );
    expect(
      response.body.publicTransportSuggestions.map(
        (suggestion: { title: string }) => suggestion.title,
      ),
    ).not.toContain("Stengt holdeplass for linje 9");
    expect(response.body.journeyPlanner).toMatchObject({
      status: "ok",
      source: "Entur Journey Planner",
    });
    expect(response.body.itineraries).toEqual([
      expect.objectContaining({
        decision: "watch",
        labels: expect.arrayContaining([
          "best_now",
          "fewest_transfers",
          "soonest_departure",
          "most_robust",
        ]),
        modes: ["bus"],
        realtime: true,
        legs: [
          expect.objectContaining({
            mode: "bus",
            publicCode: "3",
            notices: expect.arrayContaining([
              expect.objectContaining({
                title: "Forsinkelse på linje 3",
                source: "Entur avvik",
              }),
            ]),
          }),
        ],
      }),
    ]);
    expect(response.body.sources.map((source: SourceHealth) => source.source)).toEqual([
      "vegvesen_traffic_info",
      "datex",
      "entur_vehicle_positions",
      "entur_service_alerts",
    ]);
    expect(store.listTrafficMapEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        states: ["active", "planned"],
        bounds: expect.any(Object),
        limit: 120,
      }),
      "Reedtrullz",
    );
    expect(store.listOfficialEvents).toHaveBeenCalledWith(
      {
        source: "datex",
        states: ["active", "updated"],
        bounds: expect.objectContaining({
          north: expect.any(Number),
          south: expect.any(Number),
          east: expect.any(Number),
          west: expect.any(Number),
        }),
        limit: 200,
      },
      "Reedtrullz",
    );
    expect(store.listPublicTransportVehicles).toHaveBeenCalledWith(
      expect.objectContaining({
        modes: ["bus", "tram", "rail", "water"],
        bounds: expect.any(Object),
        limit: 80,
      }),
    );
    expect(store.listPublicTransportServiceAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        states: ["active"],
        bounds: expect.any(Object),
        limit: 80,
      }),
    );
  });

  it("accepts Trondheim coordinates in longitude/latitude order without routing outside the service area", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "api.entur.io") {
        return enturTripResponse({ empty: true, routingErrors: true });
      }
      expect(url.hostname).toBe("router.project-osrm.org");
      expect(url.pathname).toContain("10.3951,63.4305;10.464,63.433");
      return Response.json({
        routes: [
          {
            distance: 4_850,
            duration: 660,
            geometry: {
              type: "LineString",
              coordinates: [
                [10.3951, 63.4305],
                [10.464, 63.433],
              ],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { app, store } = await testApp();
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportVehicles").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get("/api/map/travel-plan?from=10.3951,63.4305&to=10.464,63.433")
      .expect(200);

    expect(response.body.origin.coordinate).toEqual([10.3951, 63.4305]);
    expect(response.body.destination.coordinate).toEqual([10.464, 63.433]);
    expect(response.body.journeyPlanner).toMatchObject({
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
    });
    expect(response.body.itineraries).toEqual([]);
  });

  it("accepts departure timestamps with explicit timezone offsets", async () => {
    const roundedFuture = new Date(Math.ceil((Date.now() + 60 * 60 * 1000) / 1000) * 1000);
    const offsetDeparture = new Date(roundedFuture.getTime() + 2 * 60 * 60 * 1000)
      .toISOString()
      .replace("Z", "+02:00");
    let enturDateTime: string | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "router.project-osrm.org") {
        return Response.json({
          routes: [
            {
              distance: 4_850,
              duration: 660,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.464, 63.433],
                ],
              },
            },
          ],
        });
      }
      if (url.hostname === "api.entur.io") {
        enturDateTime = (JSON.parse(String(init?.body)) as { variables: { dateTime: string } })
          .variables.dateTime;
        return enturTripResponse({ empty: true });
      }
      throw new Error(`unexpected fetch ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { app, store } = await testApp();
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportVehicles").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    await agent
      .get(
        `/api/map/travel-plan?from=10.3951,63.4305&to=10.464,63.433&departAt=${encodeURIComponent(offsetDeparture)}`,
      )
      .expect(200);

    expect(enturDateTime).toBe(roundedFuture.toISOString());
  });

  it("keeps the travel plan useful when Entur journey search is unavailable", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "nominatim.openstreetmap.org") {
        const query = url.searchParams.get("q") ?? "";
        return Response.json([
          {
            display_name: query.includes("Munkegata")
              ? "Munkegata, Midtbyen, Trondheim, Trøndelag, Norge"
              : "Leangen, Trondheim, Trøndelag, Norge",
            lat: query.includes("Munkegata") ? "63.4305" : "63.4330",
            lon: query.includes("Munkegata") ? "10.3951" : "10.4640",
          },
        ]);
      }
      if (url.hostname === "router.project-osrm.org") {
        return Response.json({
          routes: [
            {
              distance: 4_850,
              duration: 660,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.464, 63.433],
                ],
              },
            },
          ],
        });
      }
      if (url.hostname === "api.entur.io") {
        return Response.json({ errors: [{ message: "rate limited" }] }, { status: 429 });
      }
      throw new Error(`unexpected fetch ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportVehicles").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent.get("/api/map/travel-plan?from=Munkegata&to=Leangen").expect(200);

    expect(response.body.journeyPlanner).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("Entur reisesøk er ikke tilgjengelig"),
    });
    expect(response.body.itineraries).toEqual([]);
    expect(response.body.publicTransportSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "planning_link",
          title: "Sjekk avganger hos AtB/Entur",
        }),
      ]),
    );
  });

  it("caches identical Entur journey requests briefly to avoid hammering the upstream API", async () => {
    let enturRequestCount = 0;
    let geocodeRequestCount = 0;
    let routeRequestCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "nominatim.openstreetmap.org") {
        geocodeRequestCount += 1;
        const query = url.searchParams.get("q") ?? "";
        return Response.json([
          {
            display_name: query.includes("Munkegata")
              ? "Munkegata, Midtbyen, Trondheim, Trøndelag, Norge"
              : "Leangen, Trondheim, Trøndelag, Norge",
            lat: query.includes("Munkegata") ? "63.4305" : "63.4330",
            lon: query.includes("Munkegata") ? "10.3951" : "10.4640",
          },
        ]);
      }
      if (url.hostname === "router.project-osrm.org") {
        routeRequestCount += 1;
        return Response.json({
          routes: [
            {
              distance: 4_850,
              duration: 660,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.464, 63.433],
                ],
              },
            },
          ],
        });
      }
      if (url.hostname === "api.entur.io") {
        enturRequestCount += 1;
        return enturTripResponse({ empty: true });
      }
      throw new Error(`unexpected fetch ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportVehicles").mockResolvedValue([]);
    vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const departAt = encodeURIComponent(new Date(Date.now() + 10 * 60 * 1000).toISOString());
    const url = `/api/map/travel-plan?from=Munkegata&to=Leangen&departAt=${departAt}`;
    await agent.get(url).expect(200);
    await agent.get(url).expect(200);

    expect(enturRequestCount).toBe(1);
    expect(geocodeRequestCount).toBe(2);
    expect(routeRequestCount).toBe(1);
  });

  it("marks cancelled Entur legs as itinerary choices to avoid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => enturTripResponse({ cancelled: true })),
    );

    const itineraries = await fetchEnturJourneyItineraries({
      origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
      destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
      departureTime: new Date("2026-06-01T07:10:00.000Z"),
      clientName: "test-client",
      endpoint: "https://entur.test/graphql",
    });
    const payload = buildTravelPlanPayload({
      origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
      destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
      route: {
        source: "direct",
        distanceMeters: 4850,
        detail: "Test",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.3951, 63.4305],
            [10.464, 63.433],
          ],
        },
      },
      events: [],
      vehicles: [],
      alerts: [],
      itineraries,
      sourceHealth,
    });

    expect(payload.itineraries[0]).toMatchObject({
      decision: "avoid",
      disruptionCount: expect.any(Number),
      legs: [
        expect.objectContaining({
          cancelled: true,
          notices: expect.arrayContaining([
            expect.objectContaining({ title: "Avgangen er innstilt", source: "Entur" }),
          ]),
        }),
      ],
    });
    expect(payload.itineraries[0]?.decisionReason).toContain("innstilt");
  });

  it("marks replacement transport as a route choice to watch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => enturTripResponse({ replacement: true })),
    );

    const itineraries = await fetchEnturJourneyItineraries({
      origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
      destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
      departureTime: new Date("2026-06-01T07:10:00.000Z"),
      clientName: "test-client",
      endpoint: "https://entur.test/graphql",
    });
    const payload = buildTravelPlanPayload({
      origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
      destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
      route: {
        source: "direct",
        distanceMeters: 4850,
        detail: "Test",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.3951, 63.4305],
            [10.464, 63.433],
          ],
        },
      },
      events: [],
      vehicles: [],
      alerts: [],
      itineraries,
      sourceHealth,
    });

    expect(payload.itineraries[0]).toMatchObject({
      decision: "watch",
      decisionReason: expect.stringContaining("erstatningstransport"),
      legs: [
        expect.objectContaining({
          replacementTransport: true,
          notices: expect.arrayContaining([
            expect.objectContaining({ title: "Erstatningstransport", source: "Entur" }),
          ]),
        }),
      ],
    });
  });

  it("handles walk-only Entur trips with sparse optional fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => enturTripResponse({ walkOnly: true, missingExpectedTimes: true })),
    );

    const itineraries = await fetchEnturJourneyItineraries({
      origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
      destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
      departureTime: new Date("2026-06-01T07:10:00.000Z"),
      clientName: "test-client",
      endpoint: "https://entur.test/graphql",
    });

    expect(itineraries[0]).toMatchObject({
      modes: ["walk"],
      transferCount: 0,
      realtime: false,
      legs: [
        expect.objectContaining({
          mode: "walk",
          expectedStartTime: "2026-06-01T07:10:00.000Z",
          expectedEndTime: "2026-06-01T07:27:00.000Z",
        }),
      ],
    });
    expect(itineraries[0]?.legs[0]).not.toHaveProperty("lineName");
    expect(itineraries[0]?.legs[0]).not.toHaveProperty("publicCode");
  });

  it("drops malformed multi-leg Entur trips instead of ranking partial data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => enturTripResponse({ malformedSecondLeg: true })),
    );

    await expect(
      fetchEnturJourneyItineraries({
        origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
        destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
        departureTime: new Date("2026-06-01T07:10:00.000Z"),
        clientName: "test-client",
        endpoint: "https://entur.test/graphql",
      }),
    ).resolves.toEqual([]);
  });

  it("negative-caches Entur upstream failures briefly", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ errors: [{ message: "rate limited" }] }, { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
      destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
      departureTime: new Date("2026-06-01T07:10:00.000Z"),
      clientName: "test-client",
      endpoint: "https://entur.test/graphql",
    } satisfies Parameters<typeof fetchEnturJourneyItineraries>[0];

    await expect(fetchEnturJourneyItineraries(input)).rejects.toThrow("Entur svarte 429");
    await expect(fetchEnturJourneyItineraries(input)).rejects.toThrow("Entur svarte 429");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the Entur journey circuit after repeated network failures across route keys", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 0; index < 3; index += 1) {
      await expect(
        fetchEnturJourneyItineraries({
          origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
          destination: {
            query: `Mål ${index}`,
            label: `Mål ${index}`,
            coordinate: [10.464 + index / 1000, 63.433],
          },
          departureTime: new Date("2026-06-01T07:10:00.000Z"),
          clientName: "test-client",
          endpoint: "https://entur.test/graphql",
        }),
      ).rejects.toThrow("Kunne ikke hente reiser fra Entur");
    }

    await expect(
      fetchEnturJourneyItineraries({
        origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
        destination: { query: "Mål 4", label: "Mål 4", coordinate: [10.469, 63.433] },
        departureTime: new Date("2026-06-01T07:10:00.000Z"),
        clientName: "test-client",
        endpoint: "https://entur.test/graphql",
      }),
    ).rejects.toThrow("midlertidig satt på pause");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps oversized Entur journey pattern payloads before ranking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => enturTripResponse({ patternCount: 8 })),
    );

    const itineraries = await fetchEnturJourneyItineraries({
      origin: { query: "Munkegata", label: "Munkegata", coordinate: [10.3951, 63.4305] },
      destination: { query: "Leangen", label: "Leangen", coordinate: [10.464, 63.433] },
      departureTime: new Date("2026-06-01T07:10:00.000Z"),
      clientName: "test-client",
      endpoint: "https://entur.test/graphql",
    });

    expect(itineraries).toHaveLength(5);
  });

  it("returns a controlled dependency error when geocoding is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        expect(url.hostname).toBe("nominatim.openstreetmap.org");
        return Response.json({ error: "rate limited" }, { status: 503 });
      }),
    );
    const { app } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const response = await agent.get("/api/map/travel-plan?from=Munkegata&to=Leangen").expect(503);

    expect(response.body.error).toBe("Karttjenesten svarte ikke. Prøv igjen.");
  });

  it("returns safe route-planner validation messages for traveller input errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch should not be called for out-of-bounds coordinates");
      }),
    );
    const { app } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const outside = await agent.get("/api/map/travel-plan?from=0,0&to=10.464,63.433").expect(400);
    expect(outside.body.error).toBe("Koordinater må være i Trøndelag-området.");

    const staleDeparture = encodeURIComponent("2026-01-01T10:00:00.000Z");
    const stale = await agent
      .get(`/api/map/travel-plan?from=10.3951,63.4305&to=10.464,63.433&departAt=${staleDeparture}`)
      .expect(400);
    expect(stale.body.error).toBe("Avreisetid må være innen de neste sju dagene.");
  });

  it("treats a route inside a polygon event as a relevant traffic impact", () => {
    const payload = buildTravelPlanPayload({
      origin: { query: "A", label: "A", coordinate: [10.4, 63.43] },
      destination: { query: "B", label: "B", coordinate: [10.41, 63.43] },
      route: {
        source: "direct",
        distanceMeters: 500,
        detail: "Test route",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.4, 63.43],
            [10.41, 63.43],
          ],
        },
      },
      events: [
        trafficEvent({
          id: "vegvesen-traffic-info:polygon-closure",
          sourceEventId: "polygon-closure",
          title: "Større berørt område ved Lade",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [10.35, 63.4],
                [10.45, 63.4],
                [10.45, 63.46],
                [10.35, 63.46],
                [10.35, 63.4],
              ],
            ],
          },
        }),
      ],
      vehicles: [],
      alerts: [],
      sourceHealth,
      generatedAt: new Date("2026-06-01T09:05:00.000Z"),
    });

    expect(payload.trafficImpacts).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ title: "Større berørt område ved Lade" }),
        distanceMeters: 0,
        severity: "high",
      }),
    ]);
  });

  it("keeps future planned roadwork out of a travel plan for now", () => {
    const futureRoadwork = trafficEvent({
      id: "vegvesen-traffic-info:future-roadwork",
      sourceEventId: "future-roadwork",
      state: "planned",
      title: "Planlagt arbeid ved Lade",
      validFrom: "2026-06-03T08:00:00.000Z",
      validTo: "2026-06-03T12:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    });
    const payload = buildTravelPlanPayload({
      origin: { query: "A", label: "A", coordinate: [10.4, 63.43] },
      destination: { query: "B", label: "B", coordinate: [10.41, 63.43] },
      route: {
        source: "direct",
        distanceMeters: 500,
        detail: "Test route",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.4, 63.43],
            [10.41, 63.43],
          ],
        },
      },
      events: [futureRoadwork],
      vehicles: [],
      alerts: [],
      sourceHealth,
      journeyPlanner: {
        status: "empty",
        detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
        requestedDepartureTime: "2026-06-01T09:00:00.000Z",
      },
      generatedAt: new Date("2026-06-01T09:00:00.000Z"),
    });

    expect(payload.trafficImpacts).toEqual([]);
  });

  it("includes planned roadwork and service alerts when the travel window overlaps", () => {
    const plannedRoadwork = trafficEvent({
      id: "vegvesen-traffic-info:planned-roadwork",
      sourceEventId: "planned-roadwork",
      state: "planned",
      title: "Planlagt arbeid ved Lade",
      validFrom: "2026-06-03T08:00:00.000Z",
      validTo: "2026-06-03T12:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    });
    const plannedAlert = {
      id: "entur-service-alert:planned-line-3",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "planned-line-3",
      severity: "normal",
      summary: "Linje 3 kjører via Lerkendal",
      description: "Planlagt omlegging.",
      validFrom: "2026-06-03T08:00:00.000Z",
      validTo: "2026-06-03T12:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
      state: "active",
      geometry: { type: "Point", coordinates: [10.405, 63.43] },
      affectedLineNames: ["3"],
    } satisfies PublicTransportServiceAlert;
    const payload = buildTravelPlanPayload({
      origin: { query: "A", label: "A", coordinate: [10.4, 63.43] },
      destination: { query: "B", label: "B", coordinate: [10.41, 63.43] },
      route: {
        source: "direct",
        distanceMeters: 500,
        detail: "Test route",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.4, 63.43],
            [10.41, 63.43],
          ],
        },
      },
      events: [plannedRoadwork],
      vehicles: [],
      alerts: [plannedAlert],
      sourceHealth,
      journeyPlanner: {
        status: "empty",
        detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
        requestedDepartureTime: "2026-06-03T07:30:00.000Z",
      },
      generatedAt: new Date("2026-06-01T09:00:00.000Z"),
    });

    expect(payload.trafficImpacts).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ title: "Planlagt arbeid ved Lade" }),
      }),
    ]);
    expect(payload.publicTransportSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entur-service-alert:planned-line-3",
          kind: "alert",
          title: "Linje 3 kjører via Lerkendal",
        }),
      ]),
    );
  });

  it("keeps duration-unknown planned context when it started before the travel window", () => {
    const durationUnknownRoadwork = trafficEvent({
      id: "vegvesen-traffic-info:duration-unknown-roadwork",
      sourceEventId: "duration-unknown-roadwork",
      state: "planned",
      title: "Planlagt arbeid uten slutttid",
      validFrom: "2026-06-03T06:00:00.000Z",
      validTo: undefined,
      updatedAt: "2026-06-01T09:00:00.000Z",
    });
    const durationUnknownAlert = {
      id: "entur-service-alert:duration-unknown-line-3",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "duration-unknown-line-3",
      severity: "normal",
      summary: "Linje 3 har planlagt omlegging uten kjent slutttid",
      description: "Planlagt omlegging.",
      validFrom: "2026-06-03T06:00:00.000Z",
      validTo: undefined,
      updatedAt: "2026-06-01T09:00:00.000Z",
      state: "planned",
      geometry: { type: "Point", coordinates: [10.405, 63.43] },
      affectedLineNames: ["3"],
    } satisfies PublicTransportServiceAlert;
    const payload = buildTravelPlanPayload({
      origin: { query: "A", label: "A", coordinate: [10.4, 63.43] },
      destination: { query: "B", label: "B", coordinate: [10.41, 63.43] },
      route: {
        source: "direct",
        distanceMeters: 500,
        detail: "Test route",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.4, 63.43],
            [10.41, 63.43],
          ],
        },
      },
      events: [durationUnknownRoadwork],
      vehicles: [],
      alerts: [durationUnknownAlert],
      sourceHealth,
      journeyPlanner: {
        status: "empty",
        detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
        requestedDepartureTime: "2026-06-03T07:30:00.000Z",
      },
      generatedAt: new Date("2026-06-01T09:00:00.000Z"),
    });

    expect(payload.trafficImpacts).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ title: "Planlagt arbeid uten slutttid" }),
      }),
    ]);
    expect(payload.publicTransportSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entur-service-alert:duration-unknown-line-3",
          kind: "alert",
          title: "Linje 3 har planlagt omlegging uten kjent slutttid",
        }),
      ]),
    );
  });

  it("uses walking as primary mode when Entur has no usable itinerary and route geometry exists", () => {
    const payload = buildTravelPlanPayload({
      origin: { query: "Munkegata", label: "Munkegata, Trondheim", coordinate: [10.393742, 63.432883] },
      destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
      route: testRoute,
      events: [],
      vehicles: [],
      alerts: [],
      sourceHealth,
      itineraries: [],
      journeyPlanner: {
        status: "empty",
        detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
        requestedDepartureTime: "2026-06-01T23:30:00.000Z",
      },
      generatedAt: new Date("2026-06-01T23:30:00.000Z"),
    });

    expect(payload.primaryMode).toBe("walk");
    expect(payload.walkingRoute).toMatchObject({
      source: "direct",
      distanceMeters: 2520,
      durationSeconds: 1860,
      detail: expect.stringContaining("Gangtid estimert"),
    });
    expect(payload.nextTransitOption).toBeUndefined();
    expect(payload.journeyPlanner.status).toBe("empty");
  });

  it("uses transit as primary mode when Entur returns a usable itinerary", () => {
    const payload = buildTravelPlanPayload({
      origin: { query: "Munkegata", label: "Munkegata, Trondheim", coordinate: [10.393742, 63.432883] },
      destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
      route: testRoute,
      events: [],
      vehicles: [],
      alerts: [],
      sourceHealth,
      itineraries: [minimalItinerary],
      journeyPlanner: {
        status: "ok",
        detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
        requestedDepartureTime: "2026-06-01T10:00:00.000Z",
      },
      generatedAt: new Date("2026-06-01T09:55:00.000Z"),
    });

    expect(payload.primaryMode).toBe("transit");
    expect(payload.walkingRoute).toBeUndefined();
    expect(payload.itineraries).toHaveLength(1);
  });

  it("keeps walking as primary mode when the only itinerary is walk-only", () => {
    const payload = buildTravelPlanPayload({
      origin: {
        query: "Munkegata",
        label: "Munkegata, Trondheim",
        coordinate: [10.393742, 63.432883],
      },
      destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
      route: testRoute,
      events: [],
      vehicles: [],
      alerts: [],
      sourceHealth,
      itineraries: [walkOnlyItinerary],
      journeyPlanner: {
        status: "ok",
        detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
        requestedDepartureTime: "2026-06-01T10:00:00.000Z",
      },
      generatedAt: new Date("2026-06-01T09:55:00.000Z"),
    });

    expect(payload.primaryMode).toBe("walk");
    expect(payload.walkingRoute).toMatchObject({
      source: "direct",
      distanceMeters: 2520,
      durationSeconds: 1860,
    });
    expect(payload.itineraries).toHaveLength(1);
  });

  it("keeps walking as primary mode when the only itinerary is marked avoid", () => {
    const payload = buildTravelPlanPayload({
      origin: {
        query: "Munkegata",
        label: "Munkegata, Trondheim",
        coordinate: [10.393742, 63.432883],
      },
      destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
      route: testRoute,
      events: [],
      vehicles: [],
      alerts: [],
      sourceHealth,
      itineraries: [avoidItinerary],
      journeyPlanner: {
        status: "ok",
        detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
        requestedDepartureTime: "2026-06-01T10:00:00.000Z",
      },
      generatedAt: new Date("2026-06-01T09:55:00.000Z"),
    });

    expect(payload.primaryMode).toBe("walk");
    expect(payload.walkingRoute).toMatchObject({
      source: "direct",
      distanceMeters: 2520,
      durationSeconds: 1860,
    });
    expect(payload.itineraries).toHaveLength(1);
  });

  it("keeps walking as degraded primary mode when Entur fails but route geometry exists", () => {
    const payload = buildTravelPlanPayload({
      origin: { query: "Munkegata", label: "Munkegata, Trondheim", coordinate: [10.393742, 63.432883] },
      destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
      route: testRoute,
      events: [],
      vehicles: [],
      alerts: [],
      sourceHealth,
      itineraries: undefined,
      journeyPlanner: {
        status: "unavailable",
        detail: "Entur reisesøk er ikke tilgjengelig akkurat nå.",
        requestedDepartureTime: "2026-06-01T23:30:00.000Z",
      },
      generatedAt: new Date("2026-06-01T23:30:00.000Z"),
    });

    expect(payload.primaryMode).toBe("walk");
    expect(payload.walkingRoute?.durationSeconds).toBe(1860);
    expect(payload.journeyPlanner.status).toBe("unavailable");
  });

  it("uses fallback as primary mode when neither Entur nor route geometry can answer the trip", () => {
    const payload = buildTravelPlanPayload({
      origin: { query: "Munkegata", label: "Munkegata, Trondheim", coordinate: [10.393742, 63.432883] },
      destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
      route: {
        source: "direct",
        distanceMeters: 0,
        detail: "Kunne ikke beregne rute.",
        geometry: { type: "LineString", coordinates: [] },
      },
      events: [],
      vehicles: [],
      alerts: [],
      sourceHealth,
      itineraries: [],
      journeyPlanner: {
        status: "empty",
        detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
        requestedDepartureTime: "2026-06-01T23:30:00.000Z",
      },
      generatedAt: new Date("2026-06-01T23:30:00.000Z"),
    });

    expect(payload.primaryMode).toBe("fallback");
    expect(payload.walkingRoute).toBeUndefined();
  });
});
