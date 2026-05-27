import type pg from "pg";
import type { AiProcessingRun } from "@nytt/shared";
import { describe, expect, it, vi } from "vitest";
import { WorkerRepository } from "../src/repository.js";

describe("WorkerRepository", () => {
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
});
