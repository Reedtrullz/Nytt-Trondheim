import type pg from "pg";
import type { AiProcessingRun, Article } from "@nytt/shared";
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

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("payload ? 'situationId'");
    expect(query.mock.calls[0]?.[0]).toContain("NOT EXISTS");
    expect(query.mock.calls[0]?.[1]?.[7]).toBe(article);
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
});
