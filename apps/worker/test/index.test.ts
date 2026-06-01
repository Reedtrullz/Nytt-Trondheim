import type {
  RoadCamera,
  RoadWeatherObservation,
  TrafficCounterSnapshot,
  TrafficMapEvent,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
} from "@nytt/shared";
import { describe, expect, it, vi } from "vitest";
import {
  collectEnturServiceAlerts,
  collectEnturVehiclesForMap,
  collectEnturVehiclesForMapCodespaces,
  collectDatexCctvContext,
  collectDatexRoadWeatherContext,
  collectTrafikkdataCounters,
  collectTrafficInfoForMap,
  createCollectionGuard,
  normalizeDatexSituationEndpoint,
  shouldResolveMissingDatexSituations,
} from "../src/index.js";
import { normalizeDatexCredentialedEndpoint } from "../src/datex.js";

function trafficInfoEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "vegvesen-traffic-info:NPRA_HBT_1",
    source: "vegvesen_traffic_info",
    sourceEventId: "NPRA_HBT_1",
    category: "roadworks",
    severity: "medium",
    state: "active",
    title: "Fv. 6650 Vestre Kystad",
    description: "Lysregulering.",
    locationName: "Fv. 6650 Vestre Kystad, Trondheim",
    roadName: "Fv. 6650",
    validFrom: "2026-04-21T05:00:00.000Z",
    validTo: "2026-06-26T14:00:00.000Z",
    updatedAt: "2026-05-07T04:59:25.000Z",
    sourceUrl: "https://www.vegvesen.no/trafikk/hvaskjer?lat=63.38945&lng=10.345405&zoom=14",
    geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
    rawType: "roadworks",
    confidence: 1,
    ...overrides,
  };
}

function fakeTrafficInfoRepository() {
  return {
    upsertTrafficMapEvents: vi.fn().mockResolvedValue(undefined),
    upsertTrafficInfoSourceItems: vi.fn().mockResolvedValue(undefined),
    markMissingTrafficMapEventsExpired: vi.fn().mockResolvedValue(4),
    expireStaleOpenEndedTrafficMapEvents: vi.fn().mockResolvedValue(5),
    setCollectorState: vi.fn().mockResolvedValue(undefined),
    setHealth: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeRoadContextRepository() {
  return {
    upsertRoadWeatherObservations: vi.fn().mockResolvedValue(undefined),
    upsertRoadCameras: vi.fn().mockResolvedValue(undefined),
    setHealth: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeTrafikkdataRepository(lastSuccessfulPollAt?: string) {
  return {
    collectorState: vi.fn().mockResolvedValue(lastSuccessfulPollAt),
    setCollectorState: vi.fn().mockResolvedValue(undefined),
    upsertTrafficCounterSnapshots: vi.fn().mockResolvedValue(undefined),
    setHealth: vi.fn().mockResolvedValue(undefined),
  };
}

function trafikkdataCounter(
  overrides: Partial<TrafficCounterSnapshot> = {},
): TrafficCounterSnapshot {
  return {
    id: overrides.id ?? "trafikkdata:06970V72811",
    source: "trafikkdata",
    pointId: overrides.pointId ?? "06970V72811",
    name: overrides.name ?? "Kroppanbrua",
    updatedAt: overrides.updatedAt ?? "2026-05-29T10:00:00.000Z",
    geometry: overrides.geometry ?? { type: "Point", coordinates: [10.384529, 63.391793] },
    municipalityName: overrides.municipalityName ?? "Trondheim",
    volumeLastHour: overrides.volumeLastHour,
    coveragePercent: overrides.coveragePercent,
    baselineVolumeLastHour: overrides.baselineVolumeLastHour,
    anomalyRatio: overrides.anomalyRatio,
  };
}

function okXmlResponse(xml: string): Response {
  return new Response(xml, { status: 200 });
}

describe("worker lifecycle helpers", () => {
  it("enforces SRTI on configured DATEX situation endpoints", () => {
    const withoutSrti = normalizeDatexSituationEndpoint(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata?foo=bar",
    );
    expect(new URL(withoutSrti).searchParams.get("srti")).toBe("True");
    expect(new URL(withoutSrti).searchParams.get("foo")).toBe("bar");

    const overriddenSrti = normalizeDatexSituationEndpoint(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata?srti=false",
    );
    expect(new URL(overriddenSrti).searchParams.get("srti")).toBe("True");
  });

  it("rejects invalid DATEX situation endpoints", () => {
    expect(() => normalizeDatexSituationEndpoint("not a url")).toThrow(/DATEX_ENDPOINT/);
  });

  it("rejects non-HTTPS DATEX situation endpoints", () => {
    expect(() =>
      normalizeDatexSituationEndpoint(
        "http://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata",
      ),
    ).toThrow(/must use https/);
  });

  it("rejects non-Vegvesen DATEX situation endpoints before credentials are sent", () => {
    expect(() =>
      normalizeDatexSituationEndpoint(
        "https://attacker.example.test/datexapi/GetSituation/pullsnapshotdata",
      ),
    ).toThrow(/must use an allowed Vegvesen host/);
  });

  it("normalizes only allowed credentialed DATEX override endpoints", () => {
    expect(
      normalizeDatexCredentialedEndpoint(
        "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetTravelTimeData/pullsnapshotdata",
        "DATEX_TRAVEL_TIME_DATA_ENDPOINT",
      ),
    ).toContain("atlas.vegvesen.no");
    expect(() =>
      normalizeDatexCredentialedEndpoint(
        "https://evil.example.test/datex",
        "DATEX_TRAVEL_TIME_DATA_ENDPOINT",
      ),
    ).toThrow(/allowed Vegvesen host/);
    expect(() =>
      normalizeDatexCredentialedEndpoint(
        "https://svv:secret@datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetTravelTimeData/pullsnapshotdata",
        "DATEX_TRAVEL_TIME_DATA_ENDPOINT",
      ),
    ).toThrow(/must not include URL credentials/);
  });

  it("resolves missing DATEX situations only after a fresh snapshot", () => {
    expect(shouldResolveMissingDatexSituations(true)).toBe(true);
    expect(shouldResolveMissingDatexSituations(false)).toBe(false);
  });

  it("skips overlapping collection cycles while one is in flight", async () => {
    let finishFirstRun!: () => void;
    const firstCollection = new Promise<void>((resolve) => {
      finishFirstRun = resolve;
    });
    const collect = vi.fn(() =>
      collect.mock.calls.length === 1 ? firstCollection : Promise.resolve(),
    );
    const onSkip = vi.fn();
    const guarded = createCollectionGuard(collect, onSkip);

    const firstRun = guarded();
    await Promise.resolve();
    await guarded();

    expect(collect).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);

    finishFirstRun();
    await firstRun;
    await guarded();

    expect(collect).toHaveBeenCalledTimes(2);
  });
});

describe("Trafikkdata counter collection", () => {
  it("skips fetch when the last successful poll is less than 15 minutes old", async () => {
    const repository = fakeTrafikkdataRepository("2026-05-29T10:01:00.000Z");
    const collector = vi.fn().mockResolvedValue([trafikkdataCounter()]);

    await expect(
      collectTrafikkdataCounters({
        repository: repository as never,
        endpoint: "https://trafikkdata.example.test/graphql",
        nextPollAt: "2026-05-29T10:30:00.000Z",
        now: () => new Date("2026-05-29T10:15:00.000Z"),
        collector,
      }),
    ).resolves.toEqual({ skipped: true });

    expect(repository.collectorState).toHaveBeenCalledWith("trafikkdata:lastSuccessfulPollAt");
    expect(collector).not.toHaveBeenCalled();
    expect(repository.upsertTrafficCounterSnapshots).not.toHaveBeenCalled();
    expect(repository.setHealth).not.toHaveBeenCalled();
  });

  it("fetches after 15 minutes and writes ok health with counts and next poll", async () => {
    const checkedAt = "2026-05-29T10:16:00.000Z";
    const nextPollAt = "2026-05-29T10:31:00.000Z";
    const counters = [
      trafikkdataCounter({ volumeLastHour: 1234 }),
      trafikkdataCounter({
        id: "trafikkdata:TRD-METADATA",
        pointId: "TRD-METADATA",
        name: "Elgeseter bru",
      }),
    ];
    const repository = fakeTrafikkdataRepository("2026-05-29T10:01:00.000Z");
    const fetcher = vi.fn<typeof fetch>();
    const collector = vi.fn().mockResolvedValue(counters);

    await expect(
      collectTrafikkdataCounters({
        repository: repository as never,
        endpoint: "https://trafikkdata.example.test/graphql",
        nextPollAt,
        now: () => new Date(checkedAt),
        fetcher,
        collector,
      }),
    ).resolves.toEqual({ skipped: false });

    expect(collector).toHaveBeenCalledWith({
      endpoint: "https://trafikkdata.example.test/graphql",
      fetcher,
      now: expect.any(Function),
    });
    expect(repository.upsertTrafficCounterSnapshots).toHaveBeenCalledWith(counters);
    expect(repository.setCollectorState).toHaveBeenCalledWith(
      "trafikkdata:lastSuccessfulPollAt",
      checkedAt,
    );
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "trafikkdata",
      label: "Vegvesen Trafikkdata",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `2 Trafikkdata tellepunkter oppdatert (1 med timesvolum). Neste poll tidligst ${nextPollAt}`,
    });
  });

  it("writes degraded health when fetch, parse, or upsert fails", async () => {
    const checkedAt = "2026-05-29T10:20:00.000Z";
    const nextPollAt = "2026-05-29T10:35:00.000Z";
    const repository = fakeTrafikkdataRepository("2026-05-29T10:00:00.000Z");
    repository.upsertTrafficCounterSnapshots.mockRejectedValue(new Error("database unavailable"));
    const collector = vi.fn().mockResolvedValue([trafikkdataCounter({ volumeLastHour: 123 })]);

    await expect(
      collectTrafikkdataCounters({
        repository: repository as never,
        endpoint: "https://trafikkdata.example.test/graphql",
        nextPollAt,
        now: () => new Date(checkedAt),
        collector,
      }),
    ).resolves.toEqual({ skipped: false });

    expect(repository.setCollectorState).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "trafikkdata",
      label: "Vegvesen Trafikkdata",
      state: "degraded",
      lastCheckedAt: checkedAt,
      lastFailureAt: checkedAt,
      nextPollAt,
      detail: "Trafikkdata-innhenting feilet: Error: database unavailable",
    });
  });
});

describe("DATEX road context collection", () => {
  it("fetches, parses, persists weather observations and records ok health", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeRoadContextRepository();
    const observation: RoadWeatherObservation = {
      id: "datex-weather:SN123",
      source: "datex_weather",
      stationId: "SN123",
      stationName: "E6 Sluppen",
      observedAt: checkedAt,
      updatedAt: checkedAt,
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      airTemperatureC: 5,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okXmlResponse("<sites />"))
      .mockResolvedValueOnce(okXmlResponse("<measurements />"));
    const parser = vi.fn().mockReturnValue([observation]);

    await collectDatexRoadWeatherContext({
      repository: repository as never,
      sitesEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-sites",
      measurementsEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-measurements",
      username: " user ",
      password: " pass ",
      nextPollAt,
      now: () => new Date(checkedAt),
      fetcher,
      parser,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-sites",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-measurements",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech",
        Authorization: "Basic dXNlcjpwYXNz",
      }),
    });
    expect(parser).toHaveBeenCalledWith("<sites />", "<measurements />", {
      receivedAt: checkedAt,
    });
    expect(repository.upsertRoadWeatherObservations).toHaveBeenCalledWith([observation]);
    expect(repository.upsertRoadCameras).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "datex_weather",
      label: "Vegvesen værstasjoner",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: "1 DATEX værstasjonsobservasjoner oppdatert",
    });
  });

  it("marks weather context awaiting access without fetching when credentials are missing", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeRoadContextRepository();
    const fetcher = vi.fn<typeof fetch>();
    const parser = vi.fn();

    await collectDatexRoadWeatherContext({
      repository: repository as never,
      sitesEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-sites",
      measurementsEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-measurements",
      username: "",
      password: "pass",
      nextPollAt,
      now: () => new Date(checkedAt),
      fetcher,
      parser: parser as never,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(parser).not.toHaveBeenCalled();
    expect(repository.upsertRoadWeatherObservations).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "datex_weather",
      label: "Vegvesen værstasjoner",
      state: "awaiting_access",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: "DATEX Basic Auth mangler for værstasjonsdata",
    });
  });

  it("marks weather context degraded on fetch or parse failure", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeRoadContextRepository();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("weather unavailable"));

    await collectDatexRoadWeatherContext({
      repository: repository as never,
      sitesEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-sites",
      measurementsEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/weather-measurements",
      username: "user",
      password: "pass",
      nextPollAt,
      now: () => new Date(checkedAt),
      fetcher,
    });

    expect(repository.upsertRoadWeatherObservations).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "datex_weather",
      label: "Vegvesen værstasjoner",
      state: "degraded",
      lastCheckedAt: checkedAt,
      lastFailureAt: checkedAt,
      nextPollAt,
      detail: "DATEX værstasjonsinnhenting feilet: Error: weather unavailable",
    });
  });

  it("fetches, parses, persists CCTV cameras and records ok health", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeRoadContextRepository();
    const camera: RoadCamera = {
      id: "datex-cctv:CAM123",
      source: "datex_cctv",
      cameraId: "CAM123",
      name: "E6 Sluppen kamera",
      status: "ok",
      updatedAt: checkedAt,
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      imageUrl: "https://example.test/camera.jpg",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okXmlResponse("<sites />"))
      .mockResolvedValueOnce(okXmlResponse("<status />"));
    const parser = vi.fn().mockReturnValue([camera]);

    await collectDatexCctvContext({
      repository: repository as never,
      sitesEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/cctv-sites",
      statusEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/cctv-status",
      username: "user",
      password: "pass",
      nextPollAt,
      now: () => new Date(checkedAt),
      fetcher,
      parser,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(parser).toHaveBeenCalledWith("<sites />", "<status />", { receivedAt: checkedAt });
    expect(repository.upsertRoadCameras).toHaveBeenCalledWith([camera]);
    expect(repository.upsertRoadWeatherObservations).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "datex_cctv",
      label: "Vegvesen webkamera",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: "1 DATEX webkamera oppdatert",
    });
  });

  it("marks CCTV context awaiting access without fetching when credentials are missing", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeRoadContextRepository();
    const fetcher = vi.fn<typeof fetch>();

    await collectDatexCctvContext({
      repository: repository as never,
      sitesEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/cctv-sites",
      statusEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/cctv-status",
      username: "user",
      password: " ",
      nextPollAt,
      now: () => new Date(checkedAt),
      fetcher,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(repository.upsertRoadCameras).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "datex_cctv",
      label: "Vegvesen webkamera",
      state: "awaiting_access",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: "DATEX Basic Auth mangler for webkameradata",
    });
  });

  it("marks CCTV context degraded on fetch or parse failure", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeRoadContextRepository();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okXmlResponse("<sites />"))
      .mockResolvedValueOnce(okXmlResponse("<status />"));
    const parser = vi.fn(() => {
      throw new Error("bad cctv xml");
    });

    await collectDatexCctvContext({
      repository: repository as never,
      sitesEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/cctv-sites",
      statusEndpoint: "https://datex-server-get-v3-1.atlas.vegvesen.no/cctv-status",
      username: "user",
      password: "pass",
      nextPollAt,
      now: () => new Date(checkedAt),
      fetcher,
      parser,
    });

    expect(repository.upsertRoadCameras).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "datex_cctv",
      label: "Vegvesen webkamera",
      state: "degraded",
      lastCheckedAt: checkedAt,
      lastFailureAt: checkedAt,
      nextPollAt,
      detail: "DATEX webkamerainnhenting feilet: Error: bad cctv xml",
    });
  });
});

describe("TrafficInfo worker collection", () => {
  it("persists map events, mirrors source items, expires missing rows, stores hash and records ok health", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const activeEvent = trafficInfoEvent();
    const plannedEvent = trafficInfoEvent({
      id: "vegvesen-traffic-info:NPRA_HBT_2",
      sourceEventId: "NPRA_HBT_2",
      state: "planned",
      title: "E6 planlagt vegarbeid",
      updatedAt: "2026-05-29T10:59:00.000Z",
    });
    const rawActiveMessage = { id: "NPRA_HBT_1", publicCommentDescription: "Lysregulering." };
    const rawPlannedMessage = { id: "NPRA_HBT_2", publicCommentDescription: "Planlagt arbeid." };
    const repository = fakeTrafficInfoRepository();
    const collector = vi.fn().mockResolvedValue({
      events: [activeEvent, plannedEvent],
      rawMessagesById: new Map([
        ["NPRA_HBT_1", rawActiveMessage],
        ["NPRA_HBT_2", rawPlannedMessage],
      ]),
      sourcePayloadHash: "traffic-info-hash",
      totalMessages: 3,
      relevantMessages: 2,
    });

    await collectTrafficInfoForMap({
      repository: repository as never,
      endpoint: "https://traffic-info.example.test/messages",
      nextPollAt,
      now: () => new Date(checkedAt),
      collector,
    });

    expect(collector).toHaveBeenCalledWith({
      endpoint: "https://traffic-info.example.test/messages",
      now: expect.any(Function),
    });
    expect(repository.upsertTrafficMapEvents).toHaveBeenCalledWith([activeEvent, plannedEvent], {
      source: "vegvesen_traffic_info",
      fetchedAt: checkedAt,
    });
    expect(repository.upsertTrafficInfoSourceItems).toHaveBeenCalledTimes(1);
    const sourceItems = repository.upsertTrafficInfoSourceItems.mock.calls[0]?.[0];
    expect(sourceItems).toHaveLength(2);
    expect(sourceItems).toMatchObject([
      {
        provider: "vegvesen_traffic_info",
        kind: "official_event",
        externalId: "NPRA_HBT_1",
        normalizedPayload: activeEvent,
        rawPayload: rawActiveMessage,
        fetchedAt: checkedAt,
      },
      {
        provider: "vegvesen_traffic_info",
        kind: "official_event",
        externalId: "NPRA_HBT_2",
        normalizedPayload: plannedEvent,
        rawPayload: rawPlannedMessage,
        fetchedAt: checkedAt,
      },
    ]);
    expect(repository.markMissingTrafficMapEventsExpired).toHaveBeenCalledWith(
      "vegvesen_traffic_info",
      ["NPRA_HBT_1", "NPRA_HBT_2"],
      checkedAt,
    );
    expect(repository.expireStaleOpenEndedTrafficMapEvents).toHaveBeenCalledWith(
      "vegvesen_traffic_info",
      checkedAt,
      7 * 24,
    );
    expect(repository.setCollectorState).toHaveBeenCalledWith(
      "vegvesen_traffic_info:lastHash",
      "traffic-info-hash",
    );
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail:
        "2 relevante av 3 Vegvesen trafikkmeldinger hentet (1 aktive, 1 planlagte, 4 utløpt fra snapshot, 5 stale utløpt)",
    });
    expect(
      repository.markMissingTrafficMapEventsExpired.mock.invocationCallOrder[0],
    ).toBeGreaterThan(repository.upsertTrafficInfoSourceItems.mock.invocationCallOrder[0] ?? 0);
    expect(
      repository.expireStaleOpenEndedTrafficMapEvents.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      repository.markMissingTrafficMapEventsExpired.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("records degraded health and skips expiry when TrafficInfo collection fails", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeTrafficInfoRepository();
    const collector = vi.fn().mockRejectedValue(new Error("upstream unavailable"));

    await collectTrafficInfoForMap({
      repository: repository as never,
      endpoint: "https://traffic-info.example.test/messages",
      nextPollAt,
      now: () => new Date(checkedAt),
      collector,
    });

    expect(repository.upsertTrafficMapEvents).not.toHaveBeenCalled();
    expect(repository.upsertTrafficInfoSourceItems).not.toHaveBeenCalled();
    expect(repository.markMissingTrafficMapEventsExpired).not.toHaveBeenCalled();
    expect(repository.expireStaleOpenEndedTrafficMapEvents).not.toHaveBeenCalled();
    expect(repository.setCollectorState).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "degraded",
      lastCheckedAt: checkedAt,
      lastFailureAt: checkedAt,
      nextPollAt,
      detail: "TrafficInfo-innhenting feilet: Error: upstream unavailable",
    });
  });
});

describe("Entur worker collection", () => {
  it("collects Entur vehicle positions into telemetry only and writes source health", async () => {
    const repository = {
      upsertPublicTransportVehicles: vi.fn().mockResolvedValue(undefined),
      markMissingPublicTransportVehiclesStale: vi.fn().mockResolvedValue(2),
      setHealth: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi.fn().mockResolvedValue({
      vehicles: [enturVehicle()],
      activeVehicleIds: ["8790"],
    });

    await collectEnturVehiclesForMap({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceId: "ATB",
      bounds: { minLat: 63.3, minLon: 10.2, maxLat: 63.55, maxLon: 10.65 },
      nextPollAt: "2026-05-31T21:16:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.upsertPublicTransportVehicles).toHaveBeenCalledWith(
      expect.any(Array),
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.markMissingPublicTransportVehiclesStale).toHaveBeenCalledWith(
      "entur_vehicle_positions",
      "ATB",
      ["8790"],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({ source: "entur_vehicle_positions", state: "ok" }),
    );
  });

  it("aggregates Entur vehicle health across codespaces without hiding partial failures", async () => {
    const repository = {
      upsertPublicTransportVehicles: vi.fn().mockResolvedValue(undefined),
      markMissingPublicTransportVehiclesStale: vi.fn().mockResolvedValue(1),
      setHealth: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi
      .fn()
      .mockImplementation(async ({ codespaceId }: { codespaceId: string }) => {
        if (codespaceId === "SKY") throw new Error("SKY unavailable");
        return {
          vehicles: [enturVehicle({ codespaceId })],
          activeVehicleIds: ["8790"],
        };
      });

    await collectEnturVehiclesForMapCodespaces({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceIds: ["ATB", "SKY"],
      bounds: { minLat: 63.3, minLon: 10.2, maxLat: 63.55, maxLon: 10.65 },
      nextPollAt: "2026-05-31T21:16:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.upsertPublicTransportVehicles).toHaveBeenCalledTimes(1);
    expect(repository.markMissingPublicTransportVehiclesStale).toHaveBeenCalledWith(
      "entur_vehicle_positions",
      "ATB",
      ["8790"],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "entur_vehicle_positions",
        state: "degraded",
        detail: expect.stringContaining("SKY unavailable"),
      }),
    );
  });

  it("records degraded Entur vehicle health and skips stale expiry on failure", async () => {
    const repository = {
      upsertPublicTransportVehicles: vi.fn().mockResolvedValue(undefined),
      markMissingPublicTransportVehiclesStale: vi.fn().mockResolvedValue(0),
      setHealth: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi.fn().mockRejectedValue(new Error("Entur unavailable"));

    await collectEnturVehiclesForMap({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceId: "ATB",
      bounds: { minLat: 63.3, minLon: 10.2, maxLat: 63.55, maxLon: 10.65 },
      nextPollAt: "2026-05-31T21:16:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.upsertPublicTransportVehicles).not.toHaveBeenCalled();
    expect(repository.markMissingPublicTransportVehiclesStale).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({ source: "entur_vehicle_positions", state: "degraded" }),
    );
  });

  it("collects Entur service alerts as dedicated rows and source items without promotion", async () => {
    const alert = enturServiceAlert();
    const rawAlert = { situationNumber: alert.situationNumber };
    const repository = {
      upsertPublicTransportServiceAlerts: vi.fn().mockResolvedValue(undefined),
      upsertEnturServiceAlertSourceItems: vi.fn().mockResolvedValue(undefined),
      expireMissingPublicTransportServiceAlerts: vi.fn().mockResolvedValue(1),
      setHealth: vi.fn().mockResolvedValue(undefined),
      upsertOfficialEvents: vi.fn().mockResolvedValue(undefined),
      upsertSituation: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi.fn().mockResolvedValue({
      alerts: [alert],
      activeSituationNumbers: [alert.situationNumber],
      rawAlertsBySituationNumber: new Map([[alert.situationNumber, rawAlert]]),
    });

    await collectEnturServiceAlerts({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceIds: ["ATB"],
      nextPollAt: "2026-05-31T21:25:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.upsertPublicTransportServiceAlerts).toHaveBeenCalledWith(
      [alert],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.upsertEnturServiceAlertSourceItems).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: "entur",
        kind: "official_event",
        externalId: `${alert.codespaceId}:${alert.situationNumber}`,
        rawPayload: rawAlert,
      }),
    ]);
    expect(repository.expireMissingPublicTransportServiceAlerts).toHaveBeenCalledWith(
      "entur_service_alerts",
      "ATB",
      [alert.situationNumber],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.upsertOfficialEvents).not.toHaveBeenCalled();
    expect(repository.upsertSituation).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({ source: "entur_service_alerts", state: "ok" }),
    );
  });

  it("expires Entur service-alert codespaces that successfully return an empty snapshot", async () => {
    const repository = {
      upsertPublicTransportServiceAlerts: vi.fn().mockResolvedValue(undefined),
      upsertEnturServiceAlertSourceItems: vi.fn().mockResolvedValue(undefined),
      expireMissingPublicTransportServiceAlerts: vi.fn().mockResolvedValue(3),
      setHealth: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi.fn().mockResolvedValue({
      alerts: [],
      activeSituationNumbers: [],
      rawAlertsBySituationNumber: new Map(),
    });

    await collectEnturServiceAlerts({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceIds: ["ATB"],
      nextPollAt: "2026-05-31T21:25:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.upsertPublicTransportServiceAlerts).not.toHaveBeenCalled();
    expect(repository.upsertEnturServiceAlertSourceItems).not.toHaveBeenCalled();
    expect(repository.expireMissingPublicTransportServiceAlerts).toHaveBeenCalledWith(
      "entur_service_alerts",
      "ATB",
      [],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "entur_service_alerts",
        state: "ok",
        detail: expect.stringContaining("3 utløpt"),
      }),
    );
  });

  it("expires Entur service alerts separately for each configured codespace", async () => {
    const repository = {
      upsertPublicTransportServiceAlerts: vi.fn().mockResolvedValue(undefined),
      upsertEnturServiceAlertSourceItems: vi.fn().mockResolvedValue(undefined),
      expireMissingPublicTransportServiceAlerts: vi.fn().mockResolvedValue(1),
      setHealth: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi
      .fn()
      .mockImplementation(async ({ codespaceId }: { codespaceId: string }) => ({
        alerts: [
          enturServiceAlert({
            id: `entur-service-alert:${codespaceId}:shared-alert`,
            codespaceId,
            situationNumber: "shared-alert",
          }),
        ],
        activeSituationNumbers: ["shared-alert"],
        rawAlertsBySituationNumber: new Map([["shared-alert", { codespaceId }]]),
      }));

    await collectEnturServiceAlerts({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceIds: ["ATB", "SKY"],
      nextPollAt: "2026-05-31T21:25:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.expireMissingPublicTransportServiceAlerts).toHaveBeenNthCalledWith(
      1,
      "entur_service_alerts",
      "ATB",
      ["shared-alert"],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.expireMissingPublicTransportServiceAlerts).toHaveBeenNthCalledWith(
      2,
      "entur_service_alerts",
      "SKY",
      ["shared-alert"],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.upsertEnturServiceAlertSourceItems).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ externalId: "ATB:shared-alert" }),
        expect.objectContaining({ externalId: "SKY:shared-alert" }),
      ]),
    );
  });

  it("keeps successful Entur service-alert codespaces when another codespace fails", async () => {
    const alert = enturServiceAlert({ situationNumber: "shared-alert" });
    const repository = {
      upsertPublicTransportServiceAlerts: vi.fn().mockResolvedValue(undefined),
      upsertEnturServiceAlertSourceItems: vi.fn().mockResolvedValue(undefined),
      expireMissingPublicTransportServiceAlerts: vi.fn().mockResolvedValue(0),
      setHealth: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi
      .fn()
      .mockImplementation(async ({ codespaceId }: { codespaceId: string }) => {
        if (codespaceId === "SKY") throw new Error("Journey Planner SKY unavailable");
        return {
          alerts: [alert],
          activeSituationNumbers: [alert.situationNumber],
          rawAlertsBySituationNumber: new Map([[alert.situationNumber, { codespaceId }]]),
        };
      });

    await collectEnturServiceAlerts({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceIds: ["ATB", "SKY"],
      nextPollAt: "2026-05-31T21:25:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.upsertPublicTransportServiceAlerts).toHaveBeenCalledWith(
      [alert],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.expireMissingPublicTransportServiceAlerts).toHaveBeenCalledWith(
      "entur_service_alerts",
      "ATB",
      ["shared-alert"],
      "2026-05-31T21:15:00.000Z",
    );
    expect(repository.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "entur_service_alerts",
        state: "degraded",
        detail: expect.stringContaining("SKY unavailable"),
      }),
    );
  });

  it("records degraded Entur service-alert health and skips expiry on failure", async () => {
    const repository = {
      upsertPublicTransportServiceAlerts: vi.fn().mockResolvedValue(undefined),
      upsertEnturServiceAlertSourceItems: vi.fn().mockResolvedValue(undefined),
      expireMissingPublicTransportServiceAlerts: vi.fn().mockResolvedValue(0),
      setHealth: vi.fn().mockResolvedValue(undefined),
    };
    const collector = vi.fn().mockRejectedValue(new Error("Journey Planner unavailable"));

    await collectEnturServiceAlerts({
      repository: repository as never,
      clientName: "reidar-nytt-trondheim",
      codespaceIds: ["ATB"],
      nextPollAt: "2026-05-31T21:25:00.000Z",
      now: () => new Date("2026-05-31T21:15:00.000Z"),
      collector,
    });

    expect(repository.upsertPublicTransportServiceAlerts).not.toHaveBeenCalled();
    expect(repository.upsertEnturServiceAlertSourceItems).not.toHaveBeenCalled();
    expect(repository.expireMissingPublicTransportServiceAlerts).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({ source: "entur_service_alerts", state: "degraded" }),
    );
  });
});

function enturVehicle(overrides: Partial<PublicTransportVehicle> = {}): PublicTransportVehicle {
  return {
    id: "entur-vehicle:ATB:8790",
    source: "entur_vehicle_positions",
    codespaceId: "ATB",
    vehicleId: "8790",
    mode: "bus",
    lineRef: "ATB:Line:2_45",
    publicCode: "45",
    lineName: "Sjetnmarka- Tiller- Tillerringen- Sandmoen",
    lastUpdated: "2026-05-31T21:02:50.207Z",
    expiresAt: "2026-05-31T21:17:00.000Z",
    geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
    stale: false,
    ...overrides,
  };
}

function enturServiceAlert(
  overrides: Partial<PublicTransportServiceAlert> = {},
): PublicTransportServiceAlert {
  return {
    id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
    source: "entur_service_alerts",
    codespaceId: "ATB",
    situationNumber: "ATB:SituationNumber:24982-stopPoint",
    severity: "normal",
    reportType: "general",
    state: "active",
    summary: "Rota - bussholdeplassen er midlertidig flyttet",
    description: "Holdeplassen er midlertidig flyttet.",
    validFrom: "2026-05-31T20:00:00.000Z",
    updatedAt: "2026-05-31T21:00:00.000Z",
    geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
    affectedStopNames: ["Rota"],
    ...overrides,
  };
}
