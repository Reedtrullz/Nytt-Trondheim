import { createHash } from "node:crypto";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { authorizeGitHubProfile } from "../src/auth.js";
import { safeFilename } from "../src/export.js";
import { PgStore } from "../src/store.js";
import type {
  Article,
  OfficialEvent,
  RoadCamera,
  RoadWeatherObservation,
  SourceHealth,
  TrafficMapEvent,
  TrafficPulseCorridor,
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
  });
  return { ...runtime, uploadDir };
}

async function ownerAgent() {
  const { app } = await testApp();
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

describe("private situation API", () => {
  it("accepts only the configured GitHub owner account", () => {
    expect(
      authorizeGitHubProfile({ username: "someone-else", displayName: "Other" }, "Reedtrullz"),
    ).toBe(false);
    expect(
      authorizeGitHubProfile({ username: "Reedtrullz", displayName: "Reidar" }, "Reedtrullz"),
    ).toMatchObject({ login: "Reedtrullz" });
  });

  it("rejects incident data requests without an authenticated owner session", async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
    const { app } = await createApp({
      port: 0,
      nodeEnv: "development",
      publicOrigin: "http://localhost",
      seedDemo: true,
      devAuthBypass: false,
      githubClientId: "test-client",
      githubClientSecret: "test-secret",
      githubAllowedLogin: "Reedtrullz",
      sessionSecret: "test-only-secret",
      uploadDir,
      runtimeStatusDir: uploadDir,
    });
    await request(app).get("/api/bootstrap").expect(401);
  });

  it("starts GitHub OAuth with a session-backed state nonce", async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
    const { app } = await createApp({
      port: 0,
      nodeEnv: "development",
      publicOrigin: "http://localhost",
      seedDemo: true,
      devAuthBypass: false,
      githubClientId: "test-client",
      githubClientSecret: "test-secret",
      githubAllowedLogin: "Reedtrullz",
      sessionSecret: "test-only-secret",
      uploadDir,
      runtimeStatusDir: uploadDir,
    });
    const response = await request.agent(app).get("/auth/github").expect(302);
    const target = new URL(response.headers.location as string);
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("scope")).toBeNull();
  });

  it("forces user map drawings into the private layer", async () => {
    const { agent, csrf } = await ownerAgent();
    const response = await agent
      .post("/api/situations/skogbrann-bymarka/features")
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.3, 63.4] },
        properties: { label: "Mitt punkt", provenance: "official" },
      })
      .expect(201);
    expect(response.body.properties.provenance).toBe("private_annotation");
  });

  it("provides owner data and exports a protected workspace zip", async () => {
    const { agent, csrf } = await ownerAgent();
    await agent
      .get("/api/articles?scope=trondheim&limit=2")
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toHaveLength(2);
      });
    await agent
      .get("/api/situations")
      .expect(200)
      .expect((response) => {
        expect(response.body.items.length).toBeGreaterThan(0);
      });
    await agent
      .get("/api/operations/status")
      .expect(200)
      .expect((response) => {
        expect(response.body.articleCount).toBeGreaterThan(0);
        expect(response.body.trafficPulse).toEqual([]);
      });
    await agent
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.articles.length).toBeGreaterThan(0);
      });
    const created = await agent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", csrf)
      .expect("Content-Type", /zip/)
      .expect(200);
    await agent
      .get(created.headers.location as string)
      .expect("Content-Type", /zip/)
      .expect(200);
  });

  it("returns normalized and filtered DATEX traffic map events", async () => {
    const { app, store } = await testApp();
    const datexEvents: OfficialEvent[] = [
      {
        id: "datex-roadwork-e6",
        source: "datex",
        eventType: "traffic",
        title: "Veiarbeid på E6 ved Tiller",
        detail: "Ett felt er stengt i forbindelse med veiarbeid.",
        sourceUrl: "https://example.test/datex/e6",
        areaLabel: "E6 Tiller",
        state: "active",
        severity: "medium",
        publishedAt: "2026-05-28T10:00:00.000Z",
        validFrom: "2026-05-28T09:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        geometry: { type: "Point", coordinates: [10.39, 63.39] },
        raw: { datex: { recordKind: "MaintenanceWorks", roadName: "E6" } },
      },
      {
        id: "datex-accident-outside-bounds",
        source: "datex",
        eventType: "traffic",
        title: "Ulykke på E6",
        detail: "Utenfor valgt kartutsnitt.",
        sourceUrl: "https://example.test/datex/outside",
        areaLabel: "E6 Oppdal",
        state: "active",
        severity: "high",
        publishedAt: "2026-05-28T10:05:00.000Z",
        validFrom: "2026-05-28T10:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        geometry: { type: "Point", coordinates: [9.69, 62.59] },
        raw: { datex: { recordKind: "Accident", roadName: "E6" } },
      },
    ];
    const relatedArticles: Article[] = [
      {
        id: "article-near-e6",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kø ved Tiller etter veiarbeid",
        excerpt: "Trafikken går sakte ved Tiller.",
        url: "https://example.test/articles/e6",
        publishedAt: "2026-05-28T10:10:00.000Z",
        scope: "trondheim",
        category: "Transport",
        places: ["Tiller"],
        location: { lat: 63.3902, lng: 10.3902, label: "Tiller" },
      },
      {
        id: "article-far-away",
        source: "nrk",
        sourceLabel: "NRK",
        title: "Annen trafikknyhet",
        excerpt: "Ikke i nærheten av hendelsen.",
        url: "https://example.test/articles/far",
        publishedAt: "2026-05-28T10:20:00.000Z",
        scope: "trondheim",
        category: "Transport",
        places: ["Ranheim"],
        location: { lat: 63.43, lng: 10.55, label: "Ranheim" },
      },
    ];
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue(datexEvents);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: relatedArticles });
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "datex",
        label: "Vegvesen DATEX",
        state: "ok",
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
        detail: "Sist hentet nå",
      },
      {
        source: "datex_travel_time",
        label: "DATEX reisetid",
        state: "degraded",
        detail: "Mangler oppdaterte reisetider",
      },
      {
        source: "vegvesen_traffic_info",
        label: "Vegvesen TrafficInfo",
        state: "ok",
        detail: "Meldinger hentet",
      },
      { source: "nrk", label: "NRK Trøndelag", state: "ok", detail: "RSS" },
    ] satisfies SourceHealth[]);
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([
      {
        id: "100141",
        name: "E6 Okstadbakken - E6 Sluppenrampene",
        state: "slow",
        travelTimeSeconds: 720,
        freeFlowSeconds: 540,
        delaySeconds: 180,
        delayRatio: 1.33,
        measurementTo: "2026-05-28T10:05:00.000Z",
        updatedAt: "2026-05-28T10:05:30.000Z",
        sourceUrl: "https://example.test/datex/travel-time/100141",
      },
    ] satisfies TrafficPulseCorridor[]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/traffic-events?categories=roadworks&severities=medium&north=63.5&south=63.3&east=10.5&west=10.2",
      )
      .expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      id: "datex:datex-roadwork-e6",
      category: "roadworks",
      severity: "medium",
      state: "active",
      roadName: "E6",
      relatedArticles: [
        {
          id: "article-near-e6",
          title: "Kø ved Tiller etter veiarbeid",
          url: "https://example.test/articles/e6",
        },
      ],
    });
    expect(response.body.events[0].relatedArticles[0].distanceMeters).toBeLessThan(100);
    expect(response.body.brief).toMatchObject({
      headline: "1 trafikkhendelser i valgt kartutsnitt akkurat nå.",
      freshness: expect.any(String),
      counts: {
        total: 1,
        byCategory: { roadworks: 1 },
        bySeverity: { medium: 1 },
      },
    });
    expect(response.body.corridorImpacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "e6-south",
          eventCount: 1,
          affectedEventIds: ["datex:datex-roadwork-e6"],
          highestSeverity: "medium",
          travelTime: expect.objectContaining({
            id: "100141",
            state: "slow",
            delaySeconds: 180,
          }),
        }),
      ]),
    );
    expect(response.body.sources).toEqual([
      {
        source: "datex",
        label: "Vegvesen DATEX",
        state: "ok",
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
        detail: "Sist hentet nå",
      },
      {
        source: "datex_travel_time",
        label: "DATEX reisetid",
        state: "degraded",
        detail: "Mangler oppdaterte reisetider",
      },
      {
        source: "vegvesen_traffic_info",
        label: "Vegvesen TrafficInfo",
        state: "ok",
        detail: "Meldinger hentet",
      },
    ]);

    const emptyCategoryResponse = await agent
      .get("/api/map/traffic-events?categories=&north=63.5&south=63.3&east=10.5&west=10.2")
      .expect(200);
    expect(emptyCategoryResponse.body.events).toEqual([]);
    expect(emptyCategoryResponse.body.brief).toMatchObject({
      headline:
        "Ingen trafikkhendelser i valgt kartutsnitt og filter. Prøv å zoome ut eller slå på planlagte veiarbeid.",
      counts: { total: 0 },
    });
    expect(emptyCategoryResponse.body.corridorImpacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "e6-south",
          eventCount: 0,
          affectedEventIds: [],
          travelTime: expect.objectContaining({ id: "100141", delaySeconds: 180 }),
        }),
      ]),
    );

    await agent.get("/api/map/traffic-events?states=not-a-state").expect(400);
  });

  it("returns dedicated traffic_map_events rows with bounds and state filters", async () => {
    const { app, store } = await testApp();
    const insideEvent: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_HBT_1",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_1",
      category: "roadworks",
      severity: "medium",
      state: "active",
      title: "Veiarbeid ved Trondheim sentrum",
      description: "Ett felt er stengt innenfor valgt kartutsnitt.",
      locationName: "Trondheim sentrum",
      roadName: "E6",
      validFrom: "2026-05-29T08:00:00.000Z",
      validTo: "2099-01-01T00:00:00.000Z",
      updatedAt: "2026-05-29T08:05:00.000Z",
      sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/NPRA_HBT_1",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      rawType: "roadworks",
      confidence: 0.98,
    };
    const outsideEvent: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_HBT_2",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_2",
      category: "roadworks",
      severity: "medium",
      state: "active",
      title: "Veiarbeid utenfor Trondheim",
      description: "Skal filtreres bort av bounds.",
      locationName: "Utenfor Trondheim",
      roadName: "E6",
      validFrom: "2026-05-29T08:00:00.000Z",
      validTo: "2099-01-01T00:00:00.000Z",
      updatedAt: "2026-05-29T08:05:00.000Z",
      sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/NPRA_HBT_2",
      geometry: { type: "Point", coordinates: [9.69, 62.59] },
      rawType: "roadworks",
      confidence: 0.98,
    };
    type ListTrafficMapEvents = (
      filters: {
        bounds?: { north: number; south: number; east: number; west: number };
        categories?: TrafficMapEvent["category"][];
        severities?: TrafficMapEvent["severity"][];
        states?: TrafficMapEvent["state"][];
        from?: string;
        to?: string;
      },
      login: string,
    ) => Promise<TrafficMapEvent[]>;
    const listTrafficMapEvents = vi.fn<ListTrafficMapEvents>(async (filters) => {
      return [insideEvent, outsideEvent].filter((event) => {
        if (filters.states && !filters.states.includes(event.state)) return false;
        if (filters.categories && !filters.categories.includes(event.category)) return false;
        if (filters.severities && !filters.severities.includes(event.severity)) return false;
        if (!filters.bounds || event.geometry.type !== "Point") return true;
        const [lng, lat] = event.geometry.coordinates;
        return (
          lat <= filters.bounds.north &&
          lat >= filters.bounds.south &&
          lng <= filters.bounds.east &&
          lng >= filters.bounds.west
        );
      });
    });
    (store as unknown as { listTrafficMapEvents: ListTrafficMapEvents }).listTrafficMapEvents =
      listTrafficMapEvents;
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2&states=active,planned&categories=roadworks&severities=medium",
      )
      .expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_1",
    });
    expect(listTrafficMapEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
        categories: ["roadworks"],
        severities: ["medium"],
        states: ["active", "planned"],
      }),
      "Reedtrullz",
    );
  });

  it("returns road weather and camera context inside traffic map bounds", async () => {
    const { app, store } = await testApp();
    const insideWeather: RoadWeatherObservation = {
      id: "datex-weather:SN123",
      source: "datex_weather",
      stationId: "SN123",
      stationName: "E6 Sluppen værstasjon",
      observedAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      airTemperatureC: 5,
    };
    const outsideWeather: RoadWeatherObservation = {
      ...insideWeather,
      id: "datex-weather:SN999",
      stationId: "SN999",
      stationName: "Oppdal værstasjon",
      geometry: { type: "Point", coordinates: [9.69, 62.59] },
    };
    const insideCamera: RoadCamera = {
      id: "datex-cctv:CAM123",
      source: "datex_cctv",
      cameraId: "CAM123",
      name: "E6 Sluppen kamera",
      status: "ok",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.38, 63.38] },
      imageUrl: "https://example.test/camera.jpg",
    };
    const outsideCamera: RoadCamera = {
      ...insideCamera,
      id: "datex-cctv:CAM999",
      cameraId: "CAM999",
      name: "Oppdal kamera",
      geometry: { type: "Point", coordinates: [9.7, 62.58] },
    };
    const inBounds = (
      point: { coordinates: number[] },
      bounds?: { north: number; south: number; east: number; west: number },
    ) => {
      if (!bounds) return true;
      const [lng, lat] = point.coordinates;
      return lat <= bounds.north && lat >= bounds.south && lng <= bounds.east && lng >= bounds.west;
    };
    const listRoadWeatherObservations = vi.fn(async (bounds) =>
      [insideWeather, outsideWeather].filter((item) => inBounds(item.geometry, bounds)),
    );
    const listRoadCameras = vi.fn(async (bounds) =>
      [insideCamera, outsideCamera].filter((item) => inBounds(item.geometry, bounds)),
    );
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "datex_weather",
        label: "Vegvesen værstasjoner",
        state: "ok",
        lastCheckedAt: "2026-05-29T10:01:00.000Z",
        detail: "2 stasjoner oppdatert",
      },
      {
        source: "datex_cctv",
        label: "Vegvesen webkamera",
        state: "degraded",
        detail: "Kamerastatus mangler",
      },
      { source: "nrk", label: "NRK", state: "ok", detail: "RSS" },
    ] satisfies SourceHealth[]);
    vi.spyOn(store, "listRoadWeatherObservations").mockImplementation(listRoadWeatherObservations);
    vi.spyOn(store, "listRoadCameras").mockImplementation(listRoadCameras);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get("/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2")
      .expect(200);

    expect(response.body.events).toEqual([]);
    expect(response.body.weather).toEqual([insideWeather]);
    expect(response.body.cameras).toEqual([insideCamera]);
    expect(listRoadWeatherObservations).toHaveBeenCalledWith({
      north: 63.5,
      south: 63.3,
      east: 10.5,
      west: 10.2,
    });
    expect(listRoadCameras).toHaveBeenCalledWith({
      north: 63.5,
      south: 63.3,
      east: 10.5,
      west: 10.2,
    });
    expect(response.body.sources).toEqual([
      {
        source: "datex_weather",
        label: "Vegvesen værstasjoner",
        state: "ok",
        lastCheckedAt: "2026-05-29T10:01:00.000Z",
        detail: "2 stasjoner oppdatert",
      },
      {
        source: "datex_cctv",
        label: "Vegvesen webkamera",
        state: "degraded",
        detail: "Kamerastatus mangler",
      },
    ]);
  });

   it("supports planned roadwork timeline queries", async () => {
    const { app, store } = await testApp();
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([
      {
        id: "datex-planned-roadwork",
        source: "datex",
        eventType: "traffic",
        title: "Planlagt veiarbeid på Omkjøringsveien",
        detail: "Nattarbeid med redusert framkommelighet.",
        sourceUrl: "https://example.test/datex/planned",
        areaLabel: "Omkjøringsveien",
        state: "active",
        severity: "medium",
        publishedAt: "2026-05-28T11:00:00.000Z",
        validFrom: "2099-01-02T18:00:00.000Z",
        validTo: "2099-01-03T05:00:00.000Z",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.33, 63.395],
            [10.435, 63.405],
          ],
        },
        raw: { datex: { recordKind: "MaintenanceWorks", roadName: "Omkjøringsveien" } },
      },
      {
        id: "datex-active-accident",
        source: "datex",
        eventType: "traffic",
        title: "Ulykke på E6",
        detail: "Aktiv hendelse skal ikke vises i planlagt-modus.",
        sourceUrl: "https://example.test/datex/active",
        areaLabel: "E6",
        state: "active",
        severity: "high",
        publishedAt: "2026-05-28T12:00:00.000Z",
        validFrom: "2026-05-28T12:00:00.000Z",
        validTo: "2099-01-03T05:00:00.000Z",
        geometry: { type: "Point", coordinates: [10.39, 63.39] },
        raw: { datex: { recordKind: "Accident", roadName: "E6" } },
      },
    ]);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({
      items: [
        {
          id: "article-near-planned-line",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Nattarbeid på Omkjøringsveien",
          excerpt: "Arbeidet skjer langs traseen.",
          url: "https://example.test/articles/omkjoringsveien",
          publishedAt: "2026-05-28T12:30:00.000Z",
          scope: "trondheim",
          category: "Transport",
          places: ["Omkjøringsveien"],
          location: { lat: 63.4001, lng: 10.382, label: "Omkjøringsveien" },
        },
      ],
    });

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/traffic-events?states=planned&categories=roadworks&from=2099-01-01T00%3A00%3A00.000Z&to=2099-01-04T00%3A00%3A00.000Z",
      )
      .expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      id: "datex:datex-planned-roadwork",
      state: "planned",
      category: "roadworks",
      roadName: "Omkjøringsveien",
      relatedArticles: [
        {
          id: "article-near-planned-line",
          title: "Nattarbeid på Omkjøringsveien",
        },
      ],
    });
    expect(response.body.events[0].relatedArticles[0].distanceMeters).toBeLessThan(300);
    expect(response.body.corridorImpacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "omkjoringsveien",
          eventCount: 1,
          affectedEventIds: ["datex:datex-planned-roadwork"],
        }),
      ]),
    );
  });

  it("uses opaque cursor pagination without repeating feed items", async () => {
    const { agent } = await ownerAgent();
    const first = await agent.get("/api/articles?limit=1").expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await agent
      .get(`/api/articles?limit=1&cursor=${encodeURIComponent(first.body.nextCursor as string)}`)
      .expect(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    await agent.get("/api/articles?cursor=not-a-valid-cursor").expect(400);
  });

  it("stores uploaded private attachment metadata with a content checksum", async () => {
    const { agent, csrf } = await ownerAgent();
    const bytes = Buffer.from("privat vedlegg");
    const response = await agent
      .post("/api/situations/skogbrann-bymarka/attachments")
      .set("X-CSRF-Token", csrf)
      .attach("file", bytes, "notat.txt")
      .expect(201);
    expect(response.body.filename).toBe("notat.txt");
    expect(response.body.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("PgStore lists traffic map events with SQL filters and overlays row state", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const payload: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_HBT_1",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_1",
      category: "roadworks",
      severity: "medium",
      state: "planned",
      title: "Veiarbeid ved Trondheim sentrum",
      description: "Ett felt er stengt innenfor valgt kartutsnitt.",
      locationName: "Trondheim sentrum",
      roadName: "E6",
      validFrom: "2026-05-29T08:00:00.000Z",
      validTo: "2026-05-29T12:00:00.000Z",
      updatedAt: "2026-05-29T08:05:00.000Z",
      sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/NPRA_HBT_1",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      rawType: "roadworks",
      confidence: 0.98,
    };
    const fakePool = {
      async query(sql: string, params: unknown[]) {
        capturedSql = sql.replace(/\s+/g, " ").trim();
        capturedParams = params;
        return { rows: [{ payload, state: "active" as TrafficMapEvent["state"] }] };
      },
    };

    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
    const events = await store.listTrafficMapEvents({
      sources: ["vegvesen_traffic_info"],
      states: ["active", "planned"],
      categories: ["roadworks", "closure"],
      severities: ["medium", "high"],
      bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
      from: "2026-05-29T00:00:00.000Z",
      to: "2026-05-30T00:00:00.000Z",
    });

    expect(capturedSql).toContain("FROM traffic_map_events");
    expect(capturedSql).toContain("source = ANY($1::text[])");
    expect(capturedSql).toContain("state = ANY($2::text[])");
    expect(capturedSql).toContain("category = ANY($3::text[])");
    expect(capturedSql).toContain("severity = ANY($4::text[])");
    expect(capturedSql).toContain("geometry && ST_MakeEnvelope($5, $6, $7, $8, 4326)");
    expect(capturedSql).toContain("COALESCE(valid_to, updated_at) >= $9");
    expect(capturedSql).toContain("COALESCE(valid_from, updated_at) <= $10");
    expect(capturedSql).toContain("ORDER BY updated_at DESC LIMIT 1000");
    expect(capturedSql.indexOf("category = ANY($3::text[])")).toBeLessThan(
      capturedSql.indexOf("ORDER BY updated_at DESC LIMIT 1000"),
    );
    expect(capturedSql.indexOf("severity = ANY($4::text[])")).toBeLessThan(
      capturedSql.indexOf("ORDER BY updated_at DESC LIMIT 1000"),
    );
    expect(capturedParams).toEqual([
      ["vegvesen_traffic_info"],
      ["active", "planned"],
      ["roadworks", "closure"],
      ["medium", "high"],
      10.2,
      63.3,
      10.5,
      63.5,
      "2026-05-29T00:00:00.000Z",
      "2026-05-30T00:00:00.000Z",
    ]);
    expect(events).toEqual([{ ...payload, state: "active" }]);
  });

  it("PgStore lists road weather and camera rows with bounds SQL filters", async () => {
    const weatherPayload: RoadWeatherObservation = {
      id: "datex-weather:SN123",
      source: "datex_weather",
      stationId: "SN123",
      stationName: "E6 Sluppen værstasjon",
      observedAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      airTemperatureC: 5,
    };
    const cameraPayload: RoadCamera = {
      id: "datex-cctv:CAM123",
      source: "datex_cctv",
      cameraId: "CAM123",
      name: "E6 Sluppen kamera",
      status: "ok",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.38, 63.38] },
    };
    const captured: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        captured.push({ sql: normalizedSql, params });
        if (normalizedSql.includes("FROM road_weather_observations")) {
          return { rows: [{ payload: weatherPayload }] };
        }
        if (normalizedSql.includes("FROM road_cameras")) {
          return { rows: [{ payload: cameraPayload }] };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
    const bounds = { north: 63.5, south: 63.3, east: 10.5, west: 10.2 };

    await expect(store.listRoadWeatherObservations(bounds)).resolves.toEqual([weatherPayload]);
    await expect(store.listRoadCameras(bounds)).resolves.toEqual([cameraPayload]);

    expect(captured[0]?.sql).toContain("FROM road_weather_observations");
    expect(captured[0]?.sql).toContain("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(captured[0]?.sql).toContain("ORDER BY updated_at DESC, station_id ASC");
    expect(captured[0]?.params).toEqual([10.2, 63.3, 10.5, 63.5]);
    expect(captured[1]?.sql).toContain("FROM road_cameras");
    expect(captured[1]?.sql).toContain("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(captured[1]?.sql).toContain("ORDER BY updated_at DESC, camera_id ASC");
    expect(captured[1]?.params).toEqual([10.2, 63.3, 10.5, 63.5]);
  });

  it("includes DATEX traffic pulse rows in PgStore operations status with stale overlay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));

    const queries: string[] = [];
    let trafficPulseParams: unknown[] | undefined;
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        queries.push(normalizedSql);

        if (normalizedSql.includes("FROM source_health")) return { rows: [] };
        if (normalizedSql.includes("FROM articles")) return { rows: [{ count: "7" }] };
        if (normalizedSql.includes("FROM situations GROUP BY status")) {
          return { rows: [{ status: "active", count: "2" }] };
        }
        if (normalizedSql.includes("FROM ai_processing_runs")) return { rows: [] };
        if (normalizedSql.includes("FROM datex_travel_times")) {
          trafficPulseParams = params;
          expect(normalizedSql).toContain(
            "FROM datex_travel_times ORDER BY delay_seconds DESC NULLS LAST, name ASC LIMIT $1",
          );
          return {
            rows: [
              {
                measurementTo: "not-a-date",
                payload: {
                  id: "e6-omkjoring",
                  name: "E6 Omkjøring",
                  state: "slow",
                  travelTimeSeconds: 900,
                  freeFlowSeconds: 780,
                  delaySeconds: 120,
                  measurementTo: "2026-05-28T11:30:00.000Z",
                  updatedAt: "2026-05-28T11:59:00.000Z",
                  sourceUrl: "https://example.test/datex",
                },
              },
              {
                measurementTo: "2026-05-28T11:35:00.000Z",
                payload: {
                  id: "e6-sluppen",
                  name: "E6 Sluppen",
                  state: "congested",
                  travelTimeSeconds: 700,
                  freeFlowSeconds: 600,
                  delaySeconds: 100,
                  measurementTo: "2026-05-28T11:59:00.000Z",
                  updatedAt: "2026-05-28T11:59:00.000Z",
                  sourceUrl: "https://example.test/datex",
                },
              },
              {
                measurementTo: "2026-05-28T11:58:00.000Z",
                payload: {
                  id: "rv706-stavne",
                  name: "Rv706 Stavne",
                  state: "free_flow",
                  travelTimeSeconds: 300,
                  freeFlowSeconds: 300,
                  delaySeconds: 0,
                  measurementTo: "2026-05-28T11:58:00.000Z",
                  updatedAt: "2026-05-28T11:58:00.000Z",
                  sourceUrl: "https://example.test/datex",
                },
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };

    try {
      const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
      const status = await store.getOperationsStatus();

      expect(status.articleCount).toBe(7);
      expect(status.situationCounts.active).toBe(2);
      expect(status.trafficPulse?.map((corridor) => corridor.name)).toEqual([
        "E6 Omkjøring",
        "E6 Sluppen",
        "Rv706 Stavne",
      ]);
      expect(status.trafficPulse?.map((corridor) => corridor.state)).toEqual([
        "stale",
        "stale",
        "free_flow",
      ]);
      expect(trafficPulseParams).toEqual([30]);
      expect(queries.some((sql) => sql.includes("FROM datex_travel_times"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sanitizes private filenames before they enter downloads and export paths", () => {
    expect(safeFilename('../rapport\r\n".txt')).toBe("rapport___.txt");
    expect(safeFilename("../../")).toBe("vedlegg");
  });

  it("rejects state-changing requests without a CSRF token", async () => {
    const { app } = await testApp();
    await request(app)
      .post("/api/situations/skogbrann-bymarka/tasks")
      .send({ text: "Test" })
      .expect(403);
  });

  it("returns JSON 404 responses for unknown API routes", async () => {
    const { agent } = await ownerAgent();
    const response = await agent
      .get("/api/does-not-exist")
      .expect("Content-Type", /json/)
      .expect(404);
    expect(response.body.error).toBe("API-ruten finnes ikke.");
  });

  it("sanitizes unexpected internal errors while logging server-side detail", async () => {
    const { app, store } = await testApp();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(store, "getBootstrap").mockRejectedValue(new Error("database password leaked"));

    try {
      const response = await request.agent(app).get("/api/bootstrap").expect(500);
      expect(response.body).toEqual({ error: "Intern serverfeil." });
      expect(JSON.stringify(response.body)).not.toContain("database password leaked");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not persist uploaded files when the situation is missing", async () => {
    const { app, uploadDir } = await testApp();
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);

    await agent
      .post("/api/situations/missing-situation/attachments")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .attach("file", Buffer.from("skal ikke lagres"), "missing.txt")
      .expect(404);

    await expect(readdir(uploadDir)).resolves.toEqual([]);
  });

  it("rejects workspace exports that exceed the attachment quota before building a zip", async () => {
    const { app, store } = await testApp();
    await store.addAttachment({
      id: "oversized-export-attachment",
      situationId: "skogbrann-bymarka",
      filename: "huge.bin",
      storagePath: path.join(os.tmpdir(), "does-not-need-to-exist.bin"),
      contentType: "application/octet-stream",
      size: 51 * 1024 * 1024,
      sha256: "0".repeat(64),
      createdAt: new Date().toISOString(),
    });
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);

    const response = await agent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .expect(413);

    expect(response.body.error).toBe("Arbeidsmappen er for stor til eksport.");
  });

  it("treats PostgreSQL bigint attachment sizes as numbers when enforcing export quotas", async () => {
    const { app, store, uploadDir } = await testApp();
    const paths = [
      path.join(uploadDir, "pg-size-one.txt"),
      path.join(uploadDir, "pg-size-two.txt"),
    ];
    await Promise.all(paths.map((filePath, index) => writeFile(filePath, `attachment ${index}`)));
    for (const [index, storagePath] of paths.entries()) {
      await store.addAttachment({
        id: `pg-size-${index}`,
        situationId: "skogbrann-bymarka",
        filename: `pg-size-${index}.txt`,
        storagePath,
        contentType: "text/plain",
        size: String(1024 * 1024) as unknown as number,
        sha256: createHash("sha256").update(`attachment ${index}`).digest("hex"),
        createdAt: new Date().toISOString(),
      });
    }
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);

    await agent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .expect("Content-Type", /zip/)
      .expect(200);
  });

  it("rate limits abusive write bursts", async () => {
    const { agent, csrf } = await ownerAgent();
    let limited = false;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await agent
        .post("/api/situations/skogbrann-bymarka/tasks")
        .set("X-CSRF-Token", csrf)
        .send({ text: `Oppgave ${attempt}` });
      if (response.status === 429) {
        limited = true;
        expect(response.body.error).toBe("For mange forespørsler. Prøv igjen senere.");
        break;
      }
      expect(response.status).toBe(201);
    }

    expect(limited).toBe(true);
  });

  it("supports saved situation and private workspace deletion operations", async () => {
    const { agent, csrf } = await ownerAgent();
    await agent
      .put("/api/situations/skogbrann-bymarka/saved")
      .set("X-CSRF-Token", csrf)
      .expect(204);
    const workspace = await agent.get("/api/situations/skogbrann-bymarka").expect(200);
    expect(workspace.body.situation.saved).toBe(true);
    const task = await agent
      .post("/api/situations/skogbrann-bymarka/tasks")
      .set("X-CSRF-Token", csrf)
      .send({ text: "Fjern meg" })
      .expect(201);
    await agent
      .delete(`/api/situations/skogbrann-bymarka/tasks/${task.body.id}`)
      .set("X-CSRF-Token", csrf)
      .expect(204);
  });

  it("dismisses a false-positive situation while keeping it visible in history", async () => {
    const { agent, csrf } = await ownerAgent();
    const dismissed = await agent
      .patch("/api/situations/skogbrann-bymarka/status")
      .set("X-CSRF-Token", csrf)
      .send({ status: "dismissed", dismissalReason: "false_positive" })
      .expect(200);
    expect(dismissed.body.status).toBe("dismissed");
    expect(dismissed.body.dismissalReason).toBe("false_positive");
    const active = await agent.get("/api/situations").expect(200);
    expect(active.body.items).toHaveLength(0);
    const history = await agent.get("/api/situations?status=dismissed").expect(200);
    expect(history.body.items[0].id).toBe("skogbrann-bymarka");
  });
});
