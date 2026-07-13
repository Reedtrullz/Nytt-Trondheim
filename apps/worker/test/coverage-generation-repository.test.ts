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
    if (sql.includes("SET legacy_generation_id")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("AS parity_clean") && sql.includes("AS integrity_error_count")) {
      return {
        rows: [{ parity_clean: true, integrity_error_count: 0 }],
        rowCount: 1,
      };
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
  it("loads active rejected pairs with the correction revision snapshot", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: "correction-1",
          anchor_article_id: "article-a",
          rejected_article_id: "article-b",
          revision: "7",
        },
      ],
    }));
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await expect(repository.activeCoverageRejectedPairs()).resolves.toEqual({
      revision: 7,
      pairs: [{ articleIds: ["article-a", "article-b"], correctionId: "correction-1" }],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("cbc.status='active'"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("coverage_projection_revisions"));
  });

  it("persists one completed shadow generation in a transaction", async () => {
    const client = transactionClient();
    const pool = poolReturning(client);
    const repository = new WorkerRepository(pool);

    const id = await repository.persistCoverageGeneration({
      matcherVersion: "v2",
      mode: "shadow",
      startedAt: "2026-07-12T20:59:00.000Z",
      completedAt: "2026-07-12T21:00:00.000Z",
      analysis: coverageAnalysisFixture(),
      correctionRevisionSnapshot: 7,
      correctionConflictCount: 1,
      legacyBundles: coverageAnalysisFixture().bundles.map((bundle) => ({
        ...bundle,
        id: "coverage:v1:paired",
        matcherVersion: "v1" as const,
        matchConfidence: undefined,
      })),
    });

    expect(id).toBe("11111111-1111-4111-8111-111111111111");
    expect(client.queries[0]?.sql).toBe("BEGIN");
    expect(client.queries[1]?.sql).toContain("pg_advisory_xact_lock");
    expect(
      client.queries.some(({ sql }) => sql.includes("INSERT INTO coverage_bundle_members")),
    ).toBe(true);
    expect(
      client.queries.filter(({ sql }) => sql.includes("INSERT INTO coverage_generation_articles")),
    ).toHaveLength(2);
    expect(
      client.queries.some(({ sql }) => sql.includes("INSERT INTO coverage_bundle_edges")),
    ).toBe(true);
    const storedEdge = client.queries.find(({ sql }) =>
      sql.includes("INSERT INTO coverage_bundle_edges"),
    );
    expect(storedEdge?.sql).toContain("positive_incident_evidence");
    expect(storedEdge?.params?.[12]).toEqual(
      expect.arrayContaining(["shared_specific_place", "compatible_incident_subtype"]),
    );
    const completedGeneration = client.queries.find(({ sql }) =>
      sql.includes("SET status='completed'"),
    );
    expect(completedGeneration?.sql).toContain("correction_revision_snapshot");
    expect(completedGeneration?.sql).toContain("health_outcome='healthy'");
    expect(completedGeneration?.params).toEqual(expect.arrayContaining([7, 1]));
    const lockIndex = client.queries.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"));
    const legacyIndex = client.queries.findIndex(
      ({ sql, params }) =>
        sql.includes("INSERT INTO coverage_bundles") &&
        sql.includes("legacy_generation_id") &&
        params?.includes("11111111-1111-4111-8111-111111111111"),
    );
    expect(legacyIndex).toBeGreaterThan(lockIndex);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM coverage_bundle_generations"),
      ["2026-07-12T21:00:00.000Z"],
    );
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
        legacyBundles: coverageAnalysisFixture().bundles.map((bundle) => ({
          ...bundle,
          id: "coverage:v1:paired",
          matcherVersion: "v1" as const,
          matchConfidence: undefined,
        })),
      }),
    ).rejects.toThrow("member insert failed");

    expect(client.queries.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(
      client.queries.some(
        ({ sql }) =>
          sql.includes("INSERT INTO coverage_bundles") && sql.includes("legacy_generation_id"),
      ),
    ).toBe(true);
    expect(client.queries.some(({ sql }) => sql.includes("state='superseded'"))).toBe(false);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO coverage_bundle_generations"),
      expect.arrayContaining(["v2", "shadow", "Error"]),
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("quarantines a dirty active candidate before changing the current projection", async () => {
    const client = transactionClient();
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      client.queries.push({ sql, params });
      if (sql.includes("INSERT INTO coverage_bundle_generations") && sql.includes("RETURNING id")) {
        return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM articles")) {
        return { rows: [{ id: "article-a" }, { id: "article-b" }], rowCount: 2 };
      }
      if (sql.includes("AS parity_clean") && sql.includes("AS integrity_error_count")) {
        return { rows: [{ parity_clean: false, integrity_error_count: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = poolReturning(client);
    const repository = new WorkerRepository(pool);

    await expect(
      repository.persistCoverageGeneration({
        matcherVersion: "v2",
        mode: "active",
        startedAt: "2026-07-12T20:59:00.000Z",
        completedAt: "2026-07-12T21:00:00.000Z",
        analysis: coverageAnalysisFixture(),
        legacyBundles: coverageAnalysisFixture().bundles.map((bundle) => ({
          ...bundle,
          id: "coverage:v1:paired",
          matcherVersion: "v1" as const,
          matchConfidence: undefined,
        })),
      }),
    ).rejects.toThrow("Coverage generation candidate failed parity or integrity validation");

    const validationIndex = client.queries.findIndex(({ sql }) => sql.includes("AS parity_clean"));
    const currentMutationIndex = client.queries.findIndex(({ sql }) =>
      sql.includes("SET is_current"),
    );
    expect(validationIndex).toBeGreaterThan(0);
    expect(currentMutationIndex).toBe(-1);
    expect(client.queries.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO coverage_bundle_generations"),
      expect.arrayContaining(["v2", "active", "Error"]),
    );
  });

  it("quarantines empty and large-drop active candidates unless the explicit override is set", async () => {
    const previousCurrent = { id: "previous", article_count: 100 };
    for (const [articleCount, override] of [
      [0, false],
      [20, false],
    ] as const) {
      const client = transactionClient();
      client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        client.queries.push({ sql, params });
        if (
          sql.includes("INSERT INTO coverage_bundle_generations") &&
          sql.includes("RETURNING id")
        ) {
          return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }], rowCount: 1 };
        }
        if (sql.includes("WHERE is_current") && sql.includes("FOR UPDATE")) {
          return { rows: [previousCurrent], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
      const pool = poolReturning(client);
      const analysis = {
        ...coverageAnalysisFixture(),
        articles: coverageAnalysisFixture().articles.slice(0, articleCount),
      };
      await expect(
        new WorkerRepository(pool).persistCoverageGeneration({
          matcherVersion: "v2",
          mode: "active",
          startedAt: "2026-07-12T20:59:00.000Z",
          completedAt: "2026-07-12T21:00:00.000Z",
          analysis,
          legacyBundles: [],
          activeVolumeGuard: {
            minimumArticleCount: 1,
            minimumPreviousRatio: 0.5,
            allowUnsafeOverride: override,
          },
        }),
      ).rejects.toThrow("active candidate volume guard");
      expect(client.queries.some(({ sql }) => sql.includes("SET is_current"))).toBe(false);
    }
  });

  it("prunes old superseded generations while preserving correction-referenced history", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new WorkerRepository({ query } as unknown as pg.Pool);

    await repository.pruneCoverageGenerations("2026-07-12T21:00:00.000Z");

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("DELETE FROM coverage_bundle_generations");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("completed_at < $1::timestamptz - interval '30 days'");
    expect(sql).toContain("state IN ('active', 'shadow')");
    expect(sql).toContain("SELECT generation_id FROM coverage_bundle_corrections");
    expect(params).toEqual(["2026-07-12T21:00:00.000Z"]);
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
