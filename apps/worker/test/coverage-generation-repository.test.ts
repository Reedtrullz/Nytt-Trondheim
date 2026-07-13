import type pg from "pg";
import type { ArticleCoverageAnalysis } from "@nytt/shared";
import { describe, expect, it, vi } from "vitest";
import { reuseCoverageBundleIds, WorkerRepository } from "../src/repository.js";

interface RecordedQuery {
  sql: string;
  params?: unknown[];
}

function coverageAnalysisFixture(): ArticleCoverageAnalysis {
  const articles = [
    {
      id: "article-a",
      source: "nrk" as const,
      sourceLabel: "NRK Trøndelag",
      title: "Brann i anleggsbrakke",
      excerpt: "Byggeplass i Nærøysund",
      url: "https://example.test/article-a",
      publishedAt: "2026-07-12T20:00:00.000Z",
      scope: "trondelag" as const,
      category: "Hendelser" as const,
      places: ["Nærøysund"],
    },
    {
      id: "article-b",
      source: "adressa" as const,
      sourceLabel: "Adresseavisen",
      title: "Brakkebrann på byggeplass",
      excerpt: "Nødetatene rykket ut",
      url: "https://example.test/article-b",
      publishedAt: "2026-07-12T19:59:00.000Z",
      scope: "trondelag" as const,
      category: "Hendelser" as const,
      places: ["Nærøysund"],
    },
  ];
  return {
    articles,
    bundles: [
      {
        id: "coverage:v2:candidate",
        kind: "incident",
        confidence: "high",
        reason: "Samme hendelse",
        generatedAt: "2026-07-12T21:00:00.000Z",
        matcherVersion: "v2",
        matchConfidence: {
          tier: "strong",
          score: 0.9,
          rationale: "Sterkt direkte treff.",
        },
        primaryArticleId: "article-a",
        memberArticleIds: ["article-a", "article-b"],
        sourceIds: ["nrk", "adressa"],
        sourceLabels: ["NRK Trøndelag", "Adresseavisen"],
        signals: [],
        nearMisses: [],
      },
    ],
    nearMisses: [],
    edges: [
      {
        articleIds: ["article-a", "article-b"],
        tier: "strong",
        score: 0.9,
        kind: "incident",
        signals: [],
        conflicts: [],
        evidenceFingerprint: "v2:test-edge",
        reviewable: false,
        correctionConflict: false,
      },
    ],
  };
}

function transactionClient(options: { failOn?: string } = {}) {
  const queries: RecordedQuery[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (options.failOn && sql.includes(options.failOn)) throw new Error("member insert failed");
    if (sql.includes("INSERT INTO coverage_bundle_generations") && sql.includes("RETURNING id")) {
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }], rowCount: 1 };
    }
    if (sql.includes("SELECT id FROM articles")) {
      return { rows: [{ id: "article-a" }, { id: "article-b" }], rowCount: 2 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query, release, queries } as unknown as pg.PoolClient & {
    queries: RecordedQuery[];
    release: ReturnType<typeof vi.fn>;
  };
}

function poolReturning(client: pg.PoolClient): pg.Pool {
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as pg.Pool;
}

describe("coverage generation repository", () => {
  it("persists one completed shadow generation in a transaction", async () => {
    const client = transactionClient();
    const repository = new WorkerRepository(poolReturning(client));

    const id = await repository.persistCoverageGeneration({
      matcherVersion: "v2",
      mode: "shadow",
      startedAt: "2026-07-12T20:59:00.000Z",
      completedAt: "2026-07-12T21:00:00.000Z",
      analysis: coverageAnalysisFixture(),
    });

    expect(id).toBe("11111111-1111-4111-8111-111111111111");
    expect(client.queries[0]?.sql).toBe("BEGIN");
    expect(
      client.queries.some(({ sql }) => sql.includes("INSERT INTO coverage_bundle_members")),
    ).toBe(true);
    expect(
      client.queries.some(({ sql }) => sql.includes("INSERT INTO coverage_bundle_edges")),
    ).toBe(true);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and records failure without superseding the prior projection", async () => {
    const client = transactionClient({ failOn: "INSERT INTO coverage_bundle_members" });
    const pool = poolReturning(client);
    const repository = new WorkerRepository(pool);

    await expect(
      repository.persistCoverageGeneration({
        matcherVersion: "v2",
        mode: "shadow",
        startedAt: "2026-07-12T20:59:00.000Z",
        completedAt: "2026-07-12T21:00:00.000Z",
        analysis: coverageAnalysisFixture(),
      }),
    ).rejects.toThrow("member insert failed");

    expect(client.queries.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(client.queries.some(({ sql }) => sql.includes("state='superseded'"))).toBe(false);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO coverage_bundle_generations"),
      expect.arrayContaining(["v2", "shadow", "Error"]),
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("reuses stable ids one-to-one when at least half the smaller group overlaps", () => {
    const remapped = reuseCoverageBundleIds(
      [
        {
          id: "coverage:v2:new-a",
          kind: "incident" as const,
          memberArticleIds: ["a", "b", "c"],
        },
        {
          id: "coverage:v2:new-b",
          kind: "incident" as const,
          memberArticleIds: ["a", "b"],
        },
      ],
      [
        {
          id: "coverage:v2:stable",
          kind: "incident" as const,
          memberArticleIds: ["a", "b"],
        },
      ],
    );

    expect(remapped.map(({ id }) => id)).toEqual(["coverage:v2:stable", "coverage:v2:new-b"]);
  });
});
