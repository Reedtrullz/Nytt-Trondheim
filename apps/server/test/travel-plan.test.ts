import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { buildTravelPlanPayload } from "../src/traffic/travel-plan.js";
import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  TrafficMapEvent,
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("traffic travel planner API", () => {
  it("geocodes a from/to trip and returns traffic plus public transport suggestions near the route", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
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
      throw new Error(`unexpected fetch ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([
      trafficEvent(),
      trafficEvent({
        id: "vegvesen-traffic-info:far-roadwork",
        sourceEventId: "far-roadwork",
        title: "Veiarbeid langt unna ruten",
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
        limit: null,
      }),
      "Reedtrullz",
    );
    expect(store.listPublicTransportVehicles).toHaveBeenCalledWith(
      expect.objectContaining({
        modes: ["bus", "tram", "rail", "water"],
        bounds: expect.any(Object),
        limit: null,
      }),
    );
    expect(store.listPublicTransportServiceAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        states: ["active"],
        bounds: expect.any(Object),
        limit: null,
      }),
    );
  });

  it("accepts Trondheim coordinates in longitude/latitude order without routing outside the service area", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
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
});
