import { createHash } from "node:crypto";
import type pg from "pg";
import type {
  AiProcessingRun,
  Article,
  OfficialEvent,
  RoadCamera,
  RoadWeatherObservation,
  Situation,
  SourceItemInput,
  TrafficMapEvent,
  TrafficPulseCorridor,
} from "@nytt/shared";
import { describe, expect, it, vi } from "vitest";
import { WorkerRepository } from "../src/repository.js";
import { trafficInfoSourceItemInput } from "../src/vegvesenTrafficInfo.js";

describe("WorkerRepository", () => {
  it("refreshes stored article metadata without replacing situation linkage", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
    const article: Article = {
      id: "article-one",
      source: "nrk",
      sourceLabel: "NRK",
      title: "Ny oppdatering",
      excerpt: "Brann i Bymarka i Trondheim.",
      url: "https://example.test/one",
      publishedAt: "2026-05-27T07:00:00Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Bymarka", "Trondheim"],
    };

    await repository.upsertArticles([article]);

    expect(query.mock.calls[0]?.[0]).toContain("payload ? 'situationId'");
    expect(query.mock.calls[0]?.[0]).toContain("NOT EXISTS");
    expect(query.mock.calls[0]?.[1]?.[7]).toBe(article);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO source_items"),
      expect.any(Array),
    );
    const sourceItemCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO source_items"),
    );
    expect(sourceItemCall).toBeTruthy();
    expect(String(sourceItemCall?.[0])).toContain("ON CONFLICT (provider, kind, external_id)");
    expect(String(sourceItemCall?.[0])).toContain("WHERE external_id IS NOT NULL");
    expect(sourceItemCall?.[1]).toEqual(
      expect.arrayContaining([article.source, "article", article.id, article.url, article.title]),
    );
  });

  it("serializes AI processing arrays and results for jsonb columns", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
    const run: AiProcessingRun = {
      id: "run-1",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      status: "ok",
      startedAt: "2026-05-27T07:00:00Z",
      completedAt: "2026-05-27T07:00:01Z",
      articleIds: ["article-one", "article-two"],
      result: { clusters: [] },
    };

    await repository.saveAiRun(run);

    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(parameters[6]).toBe(JSON.stringify(run.articleIds));
    expect(parameters[7]).toBe(JSON.stringify(run.result));
  });

  it("loads and stores collector state values", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ value: "Thu, 28 May 2026 10:00:00 GMT" }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await expect(repository.collectorState("datex:lastModified")).resolves.toBe(
      "Thu, 28 May 2026 10:00:00 GMT",
    );
    await repository.setCollectorState("datex:lastModified", "Thu, 28 May 2026 10:10:00 GMT");

    expect(query.mock.calls[0]?.[0]).toContain("SELECT value FROM collector_state");
    expect(query.mock.calls[1]?.[0]).toContain("INSERT INTO collector_state");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "datex:lastModified",
      "Thu, 28 May 2026 10:10:00 GMT",
    ]);
  });

  it("expires DATEX official events missing from a successful snapshot", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "datex-expired" }] });
    const repository = new WorkerRepository(transactionalPool(query));

    await repository.expireMissingOfficialEvents("datex", ["datex-keep-one", "datex-keep-two"]);

    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls[0]).toBe("BEGIN");
    expect(sqlCalls.at(-1)).toBe("COMMIT");
    const officialUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE official_events"),
    );
    expect(officialUpdate?.[1]).toEqual(["datex", ["datex-keep-one", "datex-keep-two"]]);
    expect(String(officialUpdate?.[0])).toContain("state='expired'");
    expect(String(officialUpdate?.[0])).toContain("payload=jsonb_set");
    expect(String(officialUpdate?.[0])).toContain("RETURNING id");
    const sourceItemUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE source_items"),
    );
    expect(sourceItemUpdate?.[1]).toEqual(["datex", ["datex-expired"], "expired"]);
    expect(String(sourceItemUpdate?.[0])).toContain("normalized_payload=jsonb_set");
    expect(String(sourceItemUpdate?.[0])).toContain("raw_payload=CASE");
  });

  it("mirrors official events into source item rows", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository(transactionalPool(query));
    const event = {
      id: "datex-event-one",
      source: "datex",
      eventType: "traffic",
      title: "E6 stengt",
      detail: "Stengt ved Sluppen.",
      sourceUrl: "https://datex.example.test/situation",
      areaLabel: "Sluppen",
      state: "active",
      publishedAt: "2026-05-28T10:00:00.000Z",
      validFrom: "2026-05-28T10:00:00.000Z",
      validTo: "2026-05-28T11:00:00.000Z",
      raw: { compact: true },
    } as const;

    await repository.upsertOfficialEvents([event]);

    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls[0]).toBe("BEGIN");
    expect(sqlCalls.at(-1)).toBe("COMMIT");
    expect(
      sqlCalls.indexOf(sqlCalls.find((sql) => sql.includes("INSERT INTO official_events"))!),
    ).toBeLessThan(
      sqlCalls.indexOf(sqlCalls.find((sql) => sql.includes("INSERT INTO source_items"))!),
    );
    const sourceItemCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO source_items"),
    );
    expect(sourceItemCall).toBeTruthy();
    expect(sourceItemCall?.[1]).toEqual(
      expect.arrayContaining([
        "datex",
        "official_event",
        "datex-event-one",
        event.sourceUrl,
        event.title,
      ]),
    );
  });

  it("links source items for situation article and official event relationships", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository(transactionalPool(query));
    const situation: Situation = {
      id: "traffic-datex-one",
      type: "traffic",
      title: "E6 stengt",
      summary: "E6 er stengt.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      updatedAt: "2026-05-28T10:00:00.000Z",
      createdAt: "2026-05-28T10:00:00.000Z",
      locationLabel: "Sluppen",
      officialSource: "datex",
      officialEventId: "datex-event-one",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: ["article-one"],
        activatedAt: "2026-05-28T10:00:00.000Z",
      },
      relatedArticleIds: ["article-one"],
      evidence: [],
      features: [],
      timeline: [],
    };

    await repository.upsertSituation(situation);

    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls[0]).toBe("BEGIN");
    expect(sqlCalls.at(-1)).toBe("COMMIT");
    const linkCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO situation_source_items"),
    );
    expect(linkCalls.length).toBeGreaterThanOrEqual(2);
    expect(String(linkCalls[0]?.[0])).toContain("SELECT $1, id, 'supports'");
    expect(String(linkCalls[0]?.[0])).toContain("FROM source_items");
    expect(String(linkCalls[0]?.[0])).toContain("kind='article'");
    expect(String(linkCalls[1]?.[0])).toContain("kind='official_event'");
  });

  it("cancels replaced official events before mirroring the source item", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository(transactionalPool(query));
    const event: OfficialEvent = {
      id: "datex-event-new",
      source: "datex",
      eventType: "traffic",
      title: "E6 fortsatt stengt",
      detail: "Oppdatert stenging ved Sluppen.",
      sourceUrl: "https://datex.example.test/situation/new",
      areaLabel: "Sluppen",
      state: "updated",
      publishedAt: "2026-05-28T10:05:00.000Z",
      validFrom: "2026-05-28T10:05:00.000Z",
      validTo: "2026-05-28T11:05:00.000Z",
      replacesIds: ["old-event"],
      raw: { compact: true },
    };

    await repository.upsertOfficialEvents([event]);

    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));

    expect(sqlCalls).toHaveLength(6);
    expect(sqlCalls[0]).toBe("BEGIN");
    expect(sqlCalls[1]).toContain("INSERT INTO official_events");
    expect(sqlCalls[2]).toContain("UPDATE official_events");
    expect(sqlCalls[2]).toContain("state='cancelled'");
    expect(sqlCalls[3]).toContain("UPDATE source_items");
    expect(sqlCalls[3]).toContain("normalized_payload=jsonb_set");
    expect(sqlCalls[3]).toContain("raw_payload=CASE");
    expect(sqlCalls[4]).toContain("INSERT INTO source_items");
    expect(sqlCalls[5]).toBe("COMMIT");
    expect(query.mock.calls[2]?.[1]).toEqual([["old-event"]]);
    expect(query.mock.calls[3]?.[1]).toEqual(["datex", ["old-event"], "cancelled"]);
    expect(query.mock.calls[4]?.[1]).toEqual(
      expect.arrayContaining([
        "datex",
        "official_event",
        "datex-event-new",
        event.sourceUrl,
        event.title,
      ]),
    );
  });

  it("upserts DATEX travel time corridors with compact payload and numeric columns", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
    const corridor = travelTimeCorridor({
      id: "e6-sluppen-sandmoen",
      name: "E6 Sluppen–Sandmoen",
      state: "slow",
      travelTimeSeconds: 720,
      freeFlowSeconds: 540,
      delaySeconds: 180,
      delayRatio: 1.33,
      trend: "increasing",
    });

    await repository.upsertDatexTravelTimes([corridor]);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO datex_travel_times");
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(sql).toContain("updated_at=now()");
    expect(sql).not.toContain("source_items");
    expect(sql).not.toContain("situation_source_items");
    expect(parameters).toEqual([
      corridor.id,
      corridor.name,
      corridor.state,
      corridor.travelTimeSeconds,
      corridor.freeFlowSeconds,
      corridor.delaySeconds,
      corridor.delayRatio,
      corridor.trend,
      corridor.measurementFrom,
      corridor.measurementTo,
      corridor.sourceUrl,
      corridor,
    ]);
  });

  it("marks DATEX travel time rows missing from a successful complete snapshot stale", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.markMissingDatexTravelTimesStale(["datex-keep-one", "datex-keep-two"]);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE datex_travel_times"), [
      ["datex-keep-one", "datex-keep-two"],
    ]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("state='stale'");
    expect(sql).toContain("payload=jsonb_set");
    expect(sql).toContain("to_jsonb('stale'::text)");
    expect(sql).toContain("NOT (id = ANY($1::text[]))");
    expect(sql).toContain("updated_at=now()");
    expect(sql).not.toContain("source_items");
    expect(sql).not.toContain("situation_source_items");
  });

  it("reads DATEX travel time rows ordered by largest delay first, then name", async () => {
    const sluppen = travelTimeCorridor({
      id: "e6-sluppen-sandmoen",
      name: "E6 Sluppen–Sandmoen",
      state: "slow",
      delaySeconds: 180,
    });
    const omkjoringsvegen = travelTimeCorridor({
      id: "rv706-omkjoringsvegen",
      name: "Rv706 Omkjøringsvegen",
      state: "free_flow",
      delaySeconds: 0,
    });
    const query = vi.fn().mockResolvedValue({
      rows: [
        { payload: sluppen, measurement_to: sluppen.measurementTo },
        { payload: omkjoringsvegen, measurement_to: omkjoringsvegen.measurementTo },
      ],
    });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await expect(
      repository.datexTravelTimes(new Date("2026-05-28T10:10:00.000Z")),
    ).resolves.toEqual([sluppen, omkjoringsvegen]);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("FROM datex_travel_times");
    expect(sql).toContain("ORDER BY delay_seconds DESC NULLS LAST, name ASC");
  });

  it("overlays stale state for old DATEX travel time measurements without rewriting rows", async () => {
    const staleFromColumn = travelTimeCorridor({
      id: "e6-old-column",
      name: "E6 old column",
      state: "slow",
      measurementTo: "2026-05-28T09:50:00.000Z",
    });
    const staleFromPayload = travelTimeCorridor({
      id: "e6-old-payload",
      name: "E6 old payload",
      state: "congested",
      measurementTo: "2026-05-28T09:39:59.000Z",
    });
    const fresh = travelTimeCorridor({
      id: "e6-fresh",
      name: "E6 fresh",
      state: "free_flow",
      measurementTo: "2026-05-28T09:45:00.000Z",
    });
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          payload: staleFromColumn,
          measurement_to: new Date("2026-05-28T09:39:59.000Z"),
        },
        { payload: staleFromPayload, measurement_to: null },
        { payload: fresh, measurement_to: new Date("2026-05-28T09:45:00.000Z") },
      ],
    });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await expect(
      repository.datexTravelTimes(new Date("2026-05-28T10:00:00.000Z")),
    ).resolves.toEqual([
      { ...staleFromColumn, state: "stale" },
      { ...staleFromPayload, state: "stale" },
      fresh,
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("SELECT");
    expect(query.mock.calls[0]?.[0]).not.toContain("UPDATE datex_travel_times");
    expect(staleFromColumn.state).toBe("slow");
    expect(staleFromPayload.state).toBe("congested");
  });

  it("overlays stale state when payload measurementTo is old even if measurement_to column is fresh", async () => {
    const payloadOldColumnFresh = travelTimeCorridor({
      id: "e6-old-payload-fresh-column",
      name: "E6 old payload fresh column",
      state: "slow",
      measurementTo: "2026-05-28T09:39:59.000Z",
    });
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          payload: payloadOldColumnFresh,
          measurement_to: new Date("2026-05-28T09:55:00.000Z"),
        },
      ],
    });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await expect(
      repository.datexTravelTimes(new Date("2026-05-28T10:00:00.000Z")),
    ).resolves.toEqual([{ ...payloadOldColumnFresh, state: "stale" }]);

    expect(payloadOldColumnFresh.state).toBe("slow");
  });

  it("upserts one latest road weather observation row per station without source item promotion", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
    const first: RoadWeatherObservation = roadWeatherObservation({
      stationId: "SN123",
      observedAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:01:00.000Z",
      airTemperatureC: 4.2,
    });
    const latest: RoadWeatherObservation = roadWeatherObservation({
      stationId: "SN123",
      observedAt: "2026-05-29T10:05:00.000Z",
      updatedAt: "2026-05-29T10:06:00.000Z",
      airTemperatureC: 4.8,
    });

    await repository.upsertRoadWeatherObservations([first, latest]);

    expect(query).toHaveBeenCalledTimes(2);
    const [sql, firstParams] = query.mock.calls[0] as [string, unknown[]];
    const [, latestParams] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO road_weather_observations");
    expect(sql).toContain("ON CONFLICT (station_id) DO UPDATE");
    expect(sql).toContain("observed_at=EXCLUDED.observed_at");
    expect(sql).toContain("ST_SetSRID(ST_GeomFromGeoJSON($5),4326)");
    expect(firstParams).toEqual([
      "SN123",
      first,
      first.observedAt,
      first.updatedAt,
      JSON.stringify(first.geometry),
    ]);
    expect(latestParams).toEqual([
      "SN123",
      latest,
      latest.observedAt,
      latest.updatedAt,
      JSON.stringify(latest.geometry),
    ]);
    const sqlCalls = query.mock.calls.map(([statement]) => String(statement));
    expect(sqlCalls.some((statement) => statement.includes("INSERT INTO source_items"))).toBe(false);
    expect(sqlCalls.some((statement) => statement.includes("INSERT INTO official_events"))).toBe(false);
    expect(sqlCalls.some((statement) => statement.includes("INSERT INTO situations"))).toBe(false);
  });

  it("upserts one latest road camera row per camera without source item promotion", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
    const first: RoadCamera = roadCamera({
      cameraId: "CAM123",
      updatedAt: "2026-05-29T10:01:00.000Z",
      status: "unknown",
    });
    const latest: RoadCamera = roadCamera({
      cameraId: "CAM123",
      updatedAt: "2026-05-29T10:06:00.000Z",
      status: "ok",
    });

    await repository.upsertRoadCameras([first, latest]);

    expect(query).toHaveBeenCalledTimes(2);
    const [sql, firstParams] = query.mock.calls[0] as [string, unknown[]];
    const [, latestParams] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO road_cameras");
    expect(sql).toContain("ON CONFLICT (camera_id) DO UPDATE");
    expect(sql).toContain("updated_at=EXCLUDED.updated_at");
    expect(sql).toContain("ST_SetSRID(ST_GeomFromGeoJSON($4),4326)");
    expect(firstParams).toEqual([
      "CAM123",
      first,
      first.updatedAt,
      JSON.stringify(first.geometry),
    ]);
    expect(latestParams).toEqual([
      "CAM123",
      latest,
      latest.updatedAt,
      JSON.stringify(latest.geometry),
    ]);
    const sqlCalls = query.mock.calls.map(([statement]) => String(statement));
    expect(sqlCalls.some((statement) => statement.includes("INSERT INTO source_items"))).toBe(false);
    expect(sqlCalls.some((statement) => statement.includes("INSERT INTO official_events"))).toBe(false);
    expect(sqlCalls.some((statement) => statement.includes("INSERT INTO situations"))).toBe(false);
  });

  it("upserts TrafficInfo source items without promoting them to official events or situations", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
    const event = trafficMapEvent();
    const item = trafficInfoSourceItemInput(event, {
      fetchedAt: "2026-05-29T11:15:00.000Z",
      rawMessage: { id: event.sourceEventId },
    });

    await repository.upsertTrafficInfoSourceItems([item]);
    await expect(repository.currentOfficialEvents()).resolves.toEqual([]);

    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls[0]).toContain("INSERT INTO source_items");
    expect(sqlCalls[0]).toContain("ON CONFLICT (provider, kind, external_id)");
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "vegvesen_traffic_info",
        "official_event",
        event.sourceEventId,
        event.sourceUrl,
        event.title,
      ]),
    );
    expect(sqlCalls[1]).toContain("SELECT payload FROM official_events");
    expect(sqlCalls.some((sql) => sql.includes("INSERT INTO official_events"))).toBe(false);
    expect(sqlCalls.some((sql) => sql.includes("INSERT INTO situations"))).toBe(false);
    expect(sqlCalls.some((sql) => sql.includes("INSERT INTO situation_source_items"))).toBe(false);
  });

  it("rejects non-TrafficInfo official event source items in the TrafficInfo bulk upsert", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
    const item = trafficInfoSourceItemInput(trafficMapEvent(), {
      fetchedAt: "2026-05-29T11:15:00.000Z",
      rawMessage: { id: "NPRA_HBT_1" },
    });
    const wrongProviderItem = { ...item, provider: "datex" };
    const wrongKindItem = { ...item, kind: "article" } as SourceItemInput;

    await expect(
      repository.upsertTrafficInfoSourceItems([wrongProviderItem]),
    ).rejects.toThrow("only accepts Vegvesen TrafficInfo official_event items");
    await expect(
      repository.upsertTrafficInfoSourceItems([wrongKindItem]),
    ).rejects.toThrow("only accepts Vegvesen TrafficInfo official_event items");
    await expect(
      repository.upsertTrafficInfoSourceItems([item, wrongProviderItem]),
    ).rejects.toThrow("only accepts Vegvesen TrafficInfo official_event items");
    await expect(
      repository.upsertTrafficInfoSourceItems([item, wrongKindItem]),
    ).rejects.toThrow("only accepts Vegvesen TrafficInfo official_event items");
    expect(query).not.toHaveBeenCalled();
  });

  it("upserts and lists traffic map events through the dedicated table", async () => {
    const event = trafficMapEvent();
    const updatedEvent = { ...event, title: "Oppdatert tittel" };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: updatedEvent, state: "active" }] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.upsertTrafficMapEvents([event], {
      source: "vegvesen_traffic_info",
      fetchedAt: "2026-05-29T11:00:00.000Z",
    });
    await repository.upsertTrafficMapEvents([updatedEvent], {
      source: "vegvesen_traffic_info",
      fetchedAt: "2026-05-29T11:10:00.000Z",
    });
    const rows = await repository.listTrafficMapEvents({ source: "vegvesen_traffic_info" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Oppdatert tittel", state: "active" });

    const insertCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO traffic_map_events"),
    );
    expect(insertCalls).toHaveLength(2);
    expect(String(insertCalls[0]?.[0])).toContain("ON CONFLICT (source, source_event_id)");
    expect(String(insertCalls[0]?.[0])).toContain("last_seen_at");
    expect(insertCalls[0]?.[1]).toEqual(
      trafficMapEventParameters(event, "2026-05-29T11:00:00.000Z"),
    );
    expect(insertCalls[1]?.[1]).toEqual(
      trafficMapEventParameters(updatedEvent, "2026-05-29T11:10:00.000Z"),
    );
    expect(query.mock.calls[2]?.[0]).toContain("SELECT payload, state FROM traffic_map_events");
    expect(query.mock.calls[2]?.[1]).toEqual(["vegvesen_traffic_info"]);
  });

  it("expires traffic map events missing from a successful snapshot", async () => {
    const event = trafficMapEvent();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: event, state: "expired" }] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.markMissingTrafficMapEventsExpired(
      "vegvesen_traffic_info",
      [],
      "2026-05-29T11:20:00.000Z",
    );
    const rows = await repository.listTrafficMapEvents({ source: "vegvesen_traffic_info" });

    expect(rows[0]?.state).toBe("expired");
    expect(query.mock.calls[0]?.[0]).toContain("UPDATE traffic_map_events");
    expect(query.mock.calls[0]?.[0]).toContain("state='expired'");
    expect(query.mock.calls[0]?.[0]).toContain("payload=jsonb_set");
    expect(query.mock.calls[0]?.[0]).toContain("NOT (source_event_id = ANY($2::text[]))");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "vegvesen_traffic_info",
      [],
      "2026-05-29T11:20:00.000Z",
    ]);
  });

  it("keeps duplicate unchanged traffic map snapshots as one row while refreshing last_seen_at", async () => {
    const event = trafficMapEvent();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: event, state: "active" }] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.upsertTrafficMapEvents([event], {
      source: "vegvesen_traffic_info",
      fetchedAt: "2026-05-29T11:00:00.000Z",
    });
    await repository.upsertTrafficMapEvents([event], {
      source: "vegvesen_traffic_info",
      fetchedAt: "2026-05-29T11:10:00.000Z",
    });
    const rows = await repository.listTrafficMapEvents({ source: "vegvesen_traffic_info" });

    expect(rows).toEqual([event]);
    const insertCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO traffic_map_events"),
    );
    expect(insertCalls).toHaveLength(2);
    expect(String(insertCalls[1]?.[0])).toContain("last_seen_at=EXCLUDED.last_seen_at");
    expect((insertCalls[0]?.[1] as unknown[])?.[18]).toBe((insertCalls[1]?.[1] as unknown[])?.[18]);
    expect((insertCalls[0]?.[1] as unknown[])?.[19]).toBe("2026-05-29T11:00:00.000Z");
    expect((insertCalls[1]?.[1] as unknown[])?.[19]).toBe("2026-05-29T11:10:00.000Z");
  });

  it("reactivates a previously expired traffic map event when it reappears", async () => {
    const activeEvent = trafficMapEvent({ state: "active", updatedAt: "2026-05-29T11:25:00.000Z" });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: activeEvent, state: "active" }] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.markMissingTrafficMapEventsExpired(
      "vegvesen_traffic_info",
      [],
      "2026-05-29T11:20:00.000Z",
    );
    await repository.upsertTrafficMapEvents([activeEvent], {
      source: "vegvesen_traffic_info",
      fetchedAt: "2026-05-29T11:30:00.000Z",
    });
    const rows = await repository.listTrafficMapEvents({ source: "vegvesen_traffic_info" });

    expect(rows[0]?.state).toBe("active");
    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO traffic_map_events"),
    );
    expect(String(insertCall?.[0])).toContain("state=EXCLUDED.state");
    expect((insertCall?.[1] as unknown[])?.[5]).toBe("active");
    expect((insertCall?.[1] as unknown[])?.[19]).toBe("2026-05-29T11:30:00.000Z");
  });

  it("does not expire traffic map events after a failed snapshot", async () => {
    const event = trafficMapEvent();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: event, state: "active" }] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.upsertTrafficMapEvents([event], {
      source: "vegvesen_traffic_info",
      fetchedAt: "2026-05-29T11:00:00.000Z",
    });
    const rows = await repository.listTrafficMapEvents({ source: "vegvesen_traffic_info" });

    expect(rows[0]?.state).toBe("active");
    expect(
      query.mock.calls.some(([sql]) => String(sql).trimStart().startsWith("UPDATE traffic_map_events")),
    ).toBe(false);
  });

  it("expires stale open-ended active and planned traffic map events", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 2 });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await expect(
      repository.expireStaleOpenEndedTrafficMapEvents(
        "vegvesen_traffic_info",
        "2026-05-29T11:30:00.000Z",
        7 * 24,
      ),
    ).resolves.toBe(2);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE traffic_map_events"), [
      "vegvesen_traffic_info",
      "2026-05-29T11:30:00.000Z",
      7 * 24,
    ]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("state='expired'");
    expect(sql).toContain("payload=jsonb_set");
    expect(sql).toContain("state IN ('active', 'planned')");
    expect(sql).toContain("valid_to IS NULL");
    expect(sql).toContain("last_seen_at < ($2::timestamptz - ($3 * interval '1 hour'))");
  });

  it("does not insert traffic map rows when upstream parsing produced no valid events", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.upsertTrafficMapEvents([], {
      source: "vegvesen_traffic_info",
      fetchedAt: "2026-05-29T11:00:00.000Z",
    });

    expect(query).not.toHaveBeenCalled();
  });
});

function transactionalPool(query: ReturnType<typeof vi.fn>): pg.Pool {
  const client = { query, release: vi.fn() };
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
}

function roadWeatherObservation(
  overrides: Partial<RoadWeatherObservation> & Pick<RoadWeatherObservation, "stationId">,
): RoadWeatherObservation {
  return {
    id: `datex-weather:${overrides.stationId}`,
    source: "datex_weather",
    stationId: overrides.stationId,
    stationName: overrides.stationName ?? "E6 Sluppen værstasjon",
    observedAt: overrides.observedAt ?? "2026-05-29T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-29T10:01:00.000Z",
    geometry: overrides.geometry ?? { type: "Point", coordinates: [10.39, 63.39] },
    airTemperatureC: overrides.airTemperatureC ?? 4.2,
    roadSurfaceTemperatureC: overrides.roadSurfaceTemperatureC,
    precipitationMm: overrides.precipitationMm,
    windSpeedMps: overrides.windSpeedMps,
    visibilityMeters: overrides.visibilityMeters,
    rawSummary: overrides.rawSummary,
  };
}

function roadCamera(
  overrides: Partial<RoadCamera> & Pick<RoadCamera, "cameraId">,
): RoadCamera {
  return {
    id: `datex-cctv:${overrides.cameraId}`,
    source: "datex_cctv",
    cameraId: overrides.cameraId,
    name: overrides.name ?? "E6 Sluppen kamera",
    status: overrides.status ?? "ok",
    updatedAt: overrides.updatedAt ?? "2026-05-29T10:01:00.000Z",
    geometry: overrides.geometry ?? { type: "Point", coordinates: [10.39, 63.39] },
    imageUrl: overrides.imageUrl,
    sourceUrl: overrides.sourceUrl,
  };
}

function trafficMapEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
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
    ...overrides,
  };
}

function trafficMapEventParameters(event: TrafficMapEvent, fetchedAt: string): unknown[] {
  return [
    event.id,
    event.source,
    event.sourceEventId,
    event.category,
    event.severity,
    event.state,
    event.title,
    event.description ?? null,
    event.locationName ?? null,
    event.roadName ?? null,
    event.validFrom ?? null,
    event.validTo ?? null,
    event.updatedAt,
    event.sourceUrl ?? null,
    JSON.stringify(event.geometry),
    event.rawType ?? null,
    event.confidence ?? null,
    event,
    createHash("sha256").update(JSON.stringify(event)).digest("hex"),
    fetchedAt,
  ];
}

function travelTimeCorridor(
  overrides: Partial<TrafficPulseCorridor> & Pick<TrafficPulseCorridor, "id" | "name">,
): TrafficPulseCorridor {
  return {
    id: overrides.id,
    name: overrides.name,
    state: overrides.state ?? "free_flow",
    travelTimeSeconds: overrides.travelTimeSeconds ?? 600,
    freeFlowSeconds: overrides.freeFlowSeconds ?? 540,
    delaySeconds: overrides.delaySeconds ?? 60,
    delayRatio: overrides.delayRatio ?? 1.11,
    trend: overrides.trend ?? "stable",
    measurementFrom: overrides.measurementFrom ?? "2026-05-28T09:55:00.000Z",
    measurementTo: overrides.measurementTo ?? "2026-05-28T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-28T10:00:00.000Z",
    sourceUrl:
      overrides.sourceUrl ??
      "https://datex.example.test/datexapi/GetTravelTimeData/pullsnapshotdata",
  };
}
