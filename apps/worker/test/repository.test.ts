import type pg from "pg";
import type {
  AiProcessingRun,
  Article,
  OfficialEvent,
  Situation,
  TrafficPulseCorridor,
} from "@nytt/shared";
import { describe, expect, it, vi } from "vitest";
import { WorkerRepository } from "../src/repository.js";

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
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.expireMissingOfficialEvents("datex", ["datex-keep-one", "datex-keep-two"]);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE official_events"), [
      "datex",
      ["datex-keep-one", "datex-keep-two"],
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("state='expired'");
    expect(query.mock.calls[0]?.[0]).toContain("payload=jsonb_set");
  });

  it("mirrors official events into source item rows", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
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

    const sourceItemCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO source_items"),
    );
    expect(sourceItemCall).toBeTruthy();
    expect(sourceItemCall?.[1]).toEqual(
      expect.arrayContaining(["datex", "official_event", "datex-event-one", event.sourceUrl, event.title]),
    );
  });

  it("links source items for situation article and official event relationships", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // previous situation
      .mockResolvedValue({ rows: [] });
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
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
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);
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

    expect(sqlCalls).toHaveLength(3);
    expect(sqlCalls[0]).toContain("INSERT INTO official_events");
    expect(sqlCalls[1]).toContain("UPDATE official_events");
    expect(sqlCalls[1]).toContain("state='cancelled'");
    expect(sqlCalls[2]).toContain("INSERT INTO source_items");
    expect(query.mock.calls[1]?.[1]).toEqual([["old-event"]]);
    expect(query.mock.calls[2]?.[1]).toEqual(
      expect.arrayContaining(["datex", "official_event", "datex-event-new", event.sourceUrl, event.title]),
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
});

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
