import type { Article } from "@nytt/shared";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { CoverageBundleConflictError, MemoryStore, PgStore } from "../src/store.js";

function articles(): Article[] {
  return [
    {
      id: "speed-a",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "  Kjørte   i nær 200  ",
      excerpt: "Politiet stanset bilen i Orkland.",
      url: "https://example.test/speed-a",
      publishedAt: "2026-07-12T20:00:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
    {
      id: "speed-b",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Høy fart i Orkland",
      excerpt: "Bilen ble stanset etter svært høy fart.",
      url: "https://example.test/speed-b",
      publishedAt: "2026-07-12T19:59:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
    {
      id: "threat",
      source: "selbyggen",
      sourceLabel: "Selbyggen",
      title: "Syntetisk støttesak som eieren avviser",
      excerpt: "Testdata med samme syntetiske hendelses-ID.",
      url: "https://example.test/threat",
      publishedAt: "2026-07-12T19:58:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
  ];
}

function storeFixture(): MemoryStore {
  const store = new MemoryStore();
  (store as unknown as { articles: Article[] }).articles = articles();
  return store;
}

describe("coverage correction store", () => {
  it("serves deterministic E2E fixture membership from one active generation", async () => {
    const store = new MemoryStore("normalized-active", { e2eCoverageFixtures: true });
    const initial = await store.listCityPulseStories({ scope: "trondelag", limit: 40 });
    expect(
      initial.items.find(({ primary }) => primary.title === "Korrigerbar hovedsak"),
    ).toBeUndefined();
    await store.resetE2ECoverageFixtures();

    const [stories, coverage] = await Promise.all([
      store.listCityPulseStories({ scope: "trondelag", limit: 40 }),
      store.listCoverageBundles({ projection: "active", limit: 30 }),
    ]);
    const largeStory = stories.items.find(({ primary }) => primary.title === "Stor gruppesak");
    const correctableStory = stories.items.find(
      ({ primary }) => primary.title === "Korrigerbar hovedsak",
    );
    const auditMembership = coverage.items.map(({ memberArticleIds }) =>
      [...memberArticleIds].sort(),
    );

    expect(largeStory).toMatchObject({ sourceCount: 5, updateCount: 7 });
    expect(correctableStory).toMatchObject({ sourceCount: 3, updateCount: 3 });
    expect(stories.projection).toMatchObject({
      mode: "normalized",
      matcherVersion: "v2",
      generationId: coverage.summary.generation?.id,
    });
    expect(auditMembership).toContainEqual([...largeStory!.articleIds].sort());
    expect(auditMembership).toContainEqual([...correctableStory!.articleIds].sort());
    expect(correctableStory?.coverageBundle?.correctionTarget).toEqual({
      originalBundleId: expect.any(String),
      projectionRevision: 0,
    });
    expect(
      coverage.items.find(({ memberArticleIds }) =>
        memberArticleIds.includes("e2e-correctable-rejectable"),
      )?.correctionTarget,
    ).toEqual({ originalBundleId: expect.any(String), projectionRevision: 0 });
  });

  it("advances and resets only the deterministic E2E coverage generation", async () => {
    const store = new MemoryStore("normalized-active", { e2eCoverageFixtures: true });
    await store.resetE2ECoverageFixtures();
    const before = await store.listCityPulseStories({ scope: "trondelag", limit: 40 });
    const staleStory = before.items.find(
      ({ primary }) => primary.title === "Korrigerbar hovedsak",
    )!;

    const advanced = await store.advanceE2ECoverageFixtureGeneration();
    const current = await store.listCityPulseStories({ scope: "trondelag", limit: 40 });
    const currentCorrectable = current.items.find(
      ({ primary }) => primary.title === "Korrigerbar hovedsak",
    )!;

    expect(advanced.generationId).not.toBe(before.projection?.generationId);
    expect(current.projection?.generationId).toBe(advanced.generationId);
    expect(currentCorrectable.articleIds).toHaveLength(2);
    await expect(
      store.splitCoverageBundle(
        staleStory.id,
        {
          expectedGeneratedAt: staleStory.coverageBundle!.generatedAt,
          anchorArticleId: staleStory.primaryArticleId,
          rejectedArticleIds: ["e2e-correctable-rejectable"],
        },
        "owner-user-id",
      ),
    ).rejects.toBeInstanceOf(CoverageBundleConflictError);

    const reset = await store.resetE2ECoverageFixtures();
    const restored = await store.listCityPulseStories({ scope: "trondelag", limit: 40 });
    expect(restored.projection?.generationId).toBe(reset.generationId);
    expect(
      restored.items.find(({ primary }) => primary.title === "Korrigerbar hovedsak")?.articleIds,
    ).toHaveLength(3);
  });

  it("supports two sequential splits, idempotent replay, and rejects a new stale pair", async () => {
    const store = new MemoryStore("normalized-active", { e2eCoverageFixtures: true });
    await store.resetE2ECoverageFixtures();
    const initial = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const original = initial.items.find(({ memberArticleIds }) =>
      memberArticleIds.includes("e2e-correctable-rejectable"),
    )!;

    await store.splitCoverageBundle(
      original.id,
      {
        expectedGeneratedAt: original.generatedAt,
        expectedProjectionRevision: original.correctionTarget!.projectionRevision,
        originalBundleId: original.correctionTarget!.originalBundleId,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds: ["e2e-correctable-rejectable"],
      },
      "owner-user-id",
    );
    const afterFirst = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const derived = afterFirst.items.find(
      ({ memberArticleIds }) =>
        memberArticleIds.includes("e2e-correctable-main") &&
        memberArticleIds.includes("e2e-correctable-support"),
    )!;
    expect(derived.correctionTarget).toEqual({
      originalBundleId: original.correctionTarget!.originalBundleId,
      projectionRevision: 1,
    });

    await store.splitCoverageBundle(
      derived.id,
      {
        expectedGeneratedAt: derived.generatedAt,
        expectedProjectionRevision: derived.correctionTarget!.projectionRevision,
        originalBundleId: derived.correctionTarget!.originalBundleId,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds: ["e2e-correctable-support"],
      },
      "owner-user-id",
    );
    const replay = await store.splitCoverageBundle(
      derived.id,
      {
        expectedGeneratedAt: derived.generatedAt,
        expectedProjectionRevision: derived.correctionTarget!.projectionRevision,
        originalBundleId: derived.correctionTarget!.originalBundleId,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds: ["e2e-correctable-support"],
      },
      "owner-user-id",
    );
    expect(replay.corrections).toHaveLength(1);
    expect(replay.corrections[0]?.rejectedArticleId).toBe("e2e-correctable-support");

    await expect(
      store.splitCoverageBundle(
        derived.id,
        {
          expectedGeneratedAt: derived.generatedAt,
          expectedProjectionRevision: derived.correctionTarget!.projectionRevision,
          originalBundleId: derived.correctionTarget!.originalBundleId,
          anchorArticleId: "e2e-correctable-support",
          rejectedArticleIds: ["e2e-correctable-rejectable"],
        },
        "owner-user-id",
      ),
    ).rejects.toBeInstanceOf(CoverageBundleConflictError);
  });

  it("handles a partial duplicate deterministically and bumps the revision only for the new pair", async () => {
    const store = new MemoryStore("normalized-active", { e2eCoverageFixtures: true });
    await store.resetE2ECoverageFixtures();
    const initial = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const original = initial.items.find(({ memberArticleIds }) =>
      memberArticleIds.includes("e2e-correctable-rejectable"),
    )!;
    const first = await store.splitCoverageBundle(
      original.id,
      {
        expectedGeneratedAt: original.generatedAt,
        expectedProjectionRevision: 0,
        originalBundleId: original.correctionTarget!.originalBundleId,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds: ["e2e-correctable-rejectable"],
      },
      "owner-user-id",
    );
    const afterFirst = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const derived = afterFirst.items.find(
      ({ memberArticleIds }) =>
        memberArticleIds.includes("e2e-correctable-main") &&
        memberArticleIds.includes("e2e-correctable-support"),
    )!;

    const partial = await store.splitCoverageBundle(
      derived.id,
      {
        expectedGeneratedAt: derived.generatedAt,
        expectedProjectionRevision: 1,
        originalBundleId: original.correctionTarget!.originalBundleId,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds: ["e2e-correctable-rejectable", "e2e-correctable-support"],
      },
      "owner-user-id",
    );
    const afterPartial = await store.listCoverageBundles({ projection: "active", limit: 30 });

    expect(partial.corrections.map(({ id }) => id)).toContain(first.corrections[0]!.id);
    expect(new Set(partial.corrections.map(({ rejectedArticleId }) => rejectedArticleId))).toEqual(
      new Set(["e2e-correctable-rejectable", "e2e-correctable-support"]),
    );
    expect(afterPartial.items[0]?.correctionTarget?.projectionRevision).toBe(2);
  });

  it("keeps an undoable audit tombstone after a full split of a small group", async () => {
    const store = new MemoryStore("normalized-active", { e2eCoverageFixtures: true });
    await store.resetE2ECoverageFixtures();
    const before = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const original = before.items.find(({ memberArticleIds }) =>
      memberArticleIds.includes("e2e-correctable-rejectable"),
    )!;
    const rejectedArticleIds = original.memberArticleIds.filter(
      (id) => id !== "e2e-correctable-main",
    );

    await store.splitCoverageBundle(
      original.id,
      {
        expectedGeneratedAt: original.generatedAt,
        expectedProjectionRevision: original.correctionTarget!.projectionRevision,
        originalBundleId: original.correctionTarget!.originalBundleId,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds,
      },
      "owner-user-id",
    );
    const intermediate = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const remainingPair = intermediate.items.find(
      ({ memberArticleIds }) =>
        memberArticleIds.length === 2 &&
        memberArticleIds.every((id) => id !== "e2e-correctable-main"),
    )!;
    const split = await store.splitCoverageBundle(
      remainingPair.id,
      {
        expectedGeneratedAt: remainingPair.generatedAt,
        expectedProjectionRevision: remainingPair.correctionTarget!.projectionRevision,
        originalBundleId: remainingPair.correctionTarget!.originalBundleId,
        anchorArticleId: remainingPair.primaryArticleId,
        rejectedArticleIds: remainingPair.memberArticleIds.filter(
          (id) => id !== remainingPair.primaryArticleId,
        ),
      },
      "owner-user-id",
    );
    const after = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const tombstone = after.items.find(({ correctionTombstone }) => correctionTombstone);

    expect(tombstone).toMatchObject({
      correctionTombstone: true,
      corrections: expect.arrayContaining([
        expect.objectContaining({ status: "active", applicability: "active" }),
      ]),
    });
    await expect(
      store.undoCoverageCorrection(split.corrections[0]!.id, "owner-user-id"),
    ).resolves.toMatchObject({ corrections: [expect.objectContaining({ status: "reverted" })] });
  });

  it("returns an exact PostgreSQL duplicate before current co-membership validation without bumping revision", async () => {
    const correction = {
      id: "correction-existing",
      generation_id: "11111111-1111-4111-8111-111111111111",
      original_bundle_id: "coverage:v2:speed",
      anchor_article_id: "speed-a",
      rejected_article_id: "threat",
      matcher_version: "v2" as const,
      evidence_fingerprint: "v2:test-edge",
      status: "active" as const,
      created_at: "2026-07-12T21:01:00.000Z",
      reverted_at: null,
    };
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("FROM coverage_projection_revisions revision")) {
          return {
            rows: [
              {
                id: correction.generation_id,
                matcher_version: "v2",
                completed_at: "2026-07-12T21:00:00.000Z",
                revision: 1,
                revision_at: "2026-07-12T21:01:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM coverage_generation_articles cga")) {
          return { rows: articles().map((payload) => ({ payload })) };
        }
        if (sql.includes("GROUP BY cbv.bundle_id")) {
          return {
            rows: [
              { id: "coverage:v2:speed", member_article_ids: ["speed-a", "speed-b", "threat"] },
            ],
          };
        }
        if (sql.includes("coverage_bundle_corrections")) return { rows: [correction], rowCount: 1 };
        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    } as unknown as pg.PoolClient;
    const store = new PgStore({ connect: vi.fn(async () => client) } as unknown as pg.Pool);

    const result = await store.splitCoverageBundle(
      "coverage:v2:speed",
      {
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        expectedProjectionRevision: 1,
        originalBundleId: "coverage:v2:speed",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
      },
      "owner-user-id",
    );

    expect(result.corrections).toEqual([expect.objectContaining({ id: "correction-existing" })]);
    expect(queries.some((sql) => sql.includes("INSERT INTO coverage_bundle_corrections"))).toBe(
      false,
    );
    expect(queries.some((sql) => sql.includes("UPDATE coverage_projection_revisions"))).toBe(false);
  });

  it("undoes against the new current generation and never returns historical replacements", async () => {
    const store = new MemoryStore("normalized-active", { e2eCoverageFixtures: true });
    await store.resetE2ECoverageFixtures();
    const initial = await store.listCoverageBundles({ projection: "active", limit: 30 });
    const original = initial.items.find(({ memberArticleIds }) =>
      memberArticleIds.includes("e2e-correctable-rejectable"),
    )!;
    const split = await store.splitCoverageBundle(
      original.id,
      {
        expectedGeneratedAt: original.generatedAt,
        expectedProjectionRevision: 0,
        originalBundleId: original.correctionTarget!.originalBundleId,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds: ["e2e-correctable-rejectable"],
      },
      "owner-user-id",
    );
    const advanced = await store.advanceE2ECoverageFixtureGeneration();

    const undone = await store.undoCoverageCorrection(split.corrections[0]!.id, "owner-user-id");

    expect(advanced.generationId).toBe("00000000-0000-4000-8000-000000000002");
    expect(
      undone.replacementStories.every((story) => story.latestAt >= "2026-07-13T06:48:00.000Z"),
    ).toBe(true);
    expect(
      undone.replacementStories.some(({ articleIds }) =>
        articleIds.includes("e2e-correctable-rejectable"),
      ),
    ).toBe(true);
  });

  it("commits PostgreSQL split rows in one transaction", async () => {
    const correction = {
      id: "correction-1",
      generation_id: "11111111-1111-4111-8111-111111111111",
      original_bundle_id: "coverage:v2:speed",
      anchor_article_id: "speed-a",
      rejected_article_id: "threat",
      matcher_version: "v2" as const,
      evidence_fingerprint: "v2:test-edge",
      status: "active" as const,
      created_at: "2026-07-12T21:01:00.000Z",
      reverted_at: null,
    };
    let activeCorrectionReads = 0;
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM coverage_projection_revisions revision")) {
          return {
            rows: [
              {
                id: correction.generation_id,
                matcher_version: "v2",
                completed_at: "2026-07-12T21:00:00.000Z",
                revision: 0,
                revision_at: "2026-07-12T21:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("GROUP BY cbv.bundle_id")) {
          return {
            rows: [
              {
                id: "coverage:v2:speed",
                member_article_ids: ["speed-a", "speed-b", "threat"],
              },
            ],
          };
        }
        if (sql.includes("FROM coverage_generation_articles cga")) {
          return { rows: articles().map((payload) => ({ payload })) };
        }
        if (sql.includes("FROM coverage_bundle_corrections cbc")) {
          activeCorrectionReads += 1;
          return { rows: activeCorrectionReads === 1 ? [] : [correction] };
        }
        if (sql.includes("FROM coverage_bundle_edges")) {
          return {
            rows: [
              {
                left_article_id: "speed-a",
                right_article_id: "threat",
                evidence_fingerprint: "v2:test-edge",
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO coverage_bundle_corrections")) {
          return { rows: [correction], rowCount: 1 };
        }
        if (sql.includes("UPDATE coverage_projection_revisions")) {
          return { rows: [{ revision: 1 }], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    } as unknown as pg.PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;

    const result = await new PgStore(pool).splitCoverageBundle(
      "coverage:v2:speed",
      {
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
      },
      "owner-user-id",
    );

    expect(result.corrections).toEqual([
      expect.objectContaining({ id: "correction-1", status: "active" }),
    ]);
    expect(queries[0]).toBe("BEGIN");
    expect(queries.at(-1)).toBe("COMMIT");
    expect(queries).not.toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("splits immediately, is idempotent, and undo restores regrouping", async () => {
    const store = storeFixture();
    const page = await store.listCoverageBundles({ projection: "shadow", limit: 30 });
    const bundle = page.items.find(({ memberArticleIds }) => memberArticleIds.includes("threat"));
    expect(bundle).toBeDefined();

    const split = await store.splitCoverageBundle(
      bundle!.id,
      {
        expectedGeneratedAt: bundle!.generatedAt,
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
        reason: "Ulik hendelse med sensitiv intern forklaring",
      },
      "owner-user-id",
    );
    expect(split.corrections).toEqual([
      expect.objectContaining({
        anchorArticleId: "speed-a",
        rejectedArticleId: "threat",
        status: "active",
      }),
    ]);
    expect(
      split.replacementStories.some(
        ({ articleIds }) => articleIds.includes("speed-a") && articleIds.includes("threat"),
      ),
    ).toBe(false);

    const shadowAfterCorrection = await store.listCoverageBundles({
      projection: "shadow",
      limit: 30,
    });
    expect(
      shadowAfterCorrection.items.some(
        ({ memberArticleIds }) =>
          memberArticleIds.includes("speed-a") && memberArticleIds.includes("threat"),
      ),
    ).toBe(true);
    expect(shadowAfterCorrection.summary.activeCorrectionCount).toBe(0);

    const duplicate = await store.splitCoverageBundle(
      bundle!.id,
      {
        expectedGeneratedAt: bundle!.generatedAt,
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
      },
      "owner-user-id",
    );
    expect(duplicate.corrections[0]?.id).toBe(split.corrections[0]?.id);

    const undone = await store.undoCoverageCorrection(split.corrections[0]!.id, "owner-user-id");
    expect(undone.corrections[0]).toMatchObject({ status: "reverted" });
    expect(new Set(undone.removedStoryIds)).toEqual(
      new Set(split.replacementStories.map(({ id }) => id)),
    );
    expect(
      undone.replacementStories.some(
        ({ articleIds }) => articleIds.includes("speed-a") && articleIds.includes("threat"),
      ),
    ).toBe(true);
  });

  it("returns a conflict with current stories for stale input", async () => {
    const store = storeFixture();
    const page = await store.listCoverageBundles({ projection: "shadow", limit: 30 });
    const bundle = page.items[0]!;
    await expect(
      store.splitCoverageBundle(
        bundle.id,
        {
          expectedGeneratedAt: "2026-07-12T20:00:00.000Z",
          anchorArticleId: bundle.primaryArticleId,
          rejectedArticleIds: [bundle.memberArticleIds[1]!],
        },
        "owner-user-id",
      ),
    ).rejects.toBeInstanceOf(CoverageBundleConflictError);
  });

  it("exports sanitized review rows without reasons or actors", async () => {
    const store = storeFixture();
    const page = await store.listCoverageBundles({ projection: "shadow", limit: 30 });
    const bundle = page.items[0]!;
    await store.splitCoverageBundle(
      bundle.id,
      {
        expectedGeneratedAt: bundle.generatedAt,
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
        reason: "Sensitiv forklaring må ikke eksporteres",
      },
      "owner-user-id",
    );

    const exported = await store.exportCoverageCorrections(30);
    expect(exported).toMatchObject({ schemaVersion: 1, rows: [{ label: "separate" }] });
    expect(exported.rows[0]?.normalizedTitles[0]).toBe("Kjørte i nær 200");
    expect(JSON.stringify(exported)).not.toMatch(/Sensitiv|owner-user-id|reason|createdBy/);
  });
});
