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
        if (sql.includes("FOR UPDATE OF cb, cg")) {
          return {
            rows: [
              {
                id: "coverage:v2:speed",
                generation_id: correction.generation_id,
                generated_at: "2026-07-12T21:00:00.000Z",
                matcher_version: "v2",
              },
            ],
          };
        }
        if (sql.includes("FROM coverage_bundle_members")) {
          return {
            rows: ["speed-a", "speed-b", "threat"].map((article_id) => ({ article_id })),
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
