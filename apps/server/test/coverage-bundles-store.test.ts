import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Article } from "@nytt/shared";
import { PgStore } from "../src/store.js";

describe("coverage bundle store", () => {
  it("lists persisted coverage bundle decisions without reading the source item ledger", async () => {
    const memberArticles: Article[] = [
      {
        id: "nrk-flatåsen-smoke",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Rykka til Flatåsen etter røykutvikling",
        excerpt: "Nødetatene har rykka til Flatåsen i Trondheim etter meldinger om røyk.",
        url: "https://example.test/nrk-flatåsen-smoke",
        publishedAt: "2026-06-18T10:50:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Flatåsen", "Trondheim"],
      },
      {
        id: "politiloggen-flatåsen-smoke",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Brann: Trondheim",
        excerpt: "Nødetatene rykker til Øvre Flatåsveg etter melding om røyk fra bygning.",
        url: "https://example.test/politiloggen-flatåsen-smoke",
        publishedAt: "2026-06-18T10:48:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Flatåsen", "Trondheim"],
      },
      {
        id: "adressa-other-smoke",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Røykmelding ved Heimdal",
        excerpt: "Nødetatene undersøker røyk ved Heimdal i Trondheim.",
        url: "https://example.test/adressa-other-smoke",
        publishedAt: "2026-06-18T10:49:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Heimdal", "Trondheim"],
      },
    ];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).not.toContain("source_items");
      if (normalized.startsWith("SELECT cb.id")) {
        expect(normalized).toContain("FROM coverage_bundles cb");
        expect(normalized).toContain("cb.state='legacy'");
        expect(normalized).toContain("cb.matcher_version='v1'");
        expect(normalized).toContain("cb.kind = $1");
        expect(normalized).toContain("cb.confidence = $2");
        expect(normalized).toContain("cb.id ILIKE $3");
        expect(normalized).toContain("ORDER BY cb.last_seen_at DESC, cb.id DESC");
        expect(params).toEqual(["incident", "high", "%Flatåsen%", 2]);
        return {
          rows: [
            {
              id: "coverage:flatåsen-smoke",
              kind: "incident",
              confidence: "high",
              reason: "Samme hendelse på tvers av kilder",
              generated_at: "2026-06-18T10:55:00.000Z",
              last_seen_at: "2026-06-18T10:55:00.000Z",
              last_seen_at_cursor: "2026-06-18T10:55:00.000000Z",
              primary_article_id: "nrk-flatåsen-smoke",
              member_article_ids: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
              source_ids: ["nrk", "politiloggen"],
              source_labels: ["NRK Trøndelag", "Politiloggen"],
              signals: [
                {
                  kind: "generic_place_incident",
                  articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
                  detail: "brann",
                },
              ],
              near_misses: [
                {
                  articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
                  reason: "conflicting_specific_places",
                },
              ],
              updated_at: "2026-06-18T10:55:30.000Z",
            },
          ],
        };
      }
      if (normalized === "SELECT payload FROM articles WHERE id = ANY($1::text[])") {
        expect(params).toEqual([
          ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke", "adressa-other-smoke"],
        ]);
        return { rows: memberArticles.map((payload) => ({ payload })) };
      }
      if (normalized.startsWith("SELECT count(*)::text AS total")) {
        expect(normalized).toContain("FROM coverage_bundles cb");
        expect(normalized).toContain("cb.state='legacy'");
        expect(normalized).toContain("cb.matcher_version='v1'");
        expect(params).toEqual(["incident", "high", "%Flatåsen%"]);
        return {
          rows: [
            {
              total: "1",
              incident: "1",
              topic: "0",
              update: "0",
              high: "1",
              medium: "0",
              latest_generated_at: "2026-06-18T10:55:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listCoverageBundles(
      { kind: "incident", confidence: "high", q: "Flatåsen", limit: 1 },
      "Reedtrullz",
    );

    expect(page.items).toEqual([
      expect.objectContaining({
        id: "coverage:flatåsen-smoke",
        kind: "incident",
        confidence: "high",
        memberArticles: expect.arrayContaining([
          expect.objectContaining({ id: "nrk-flatåsen-smoke", sourceLabel: "NRK Trøndelag" }),
          expect.objectContaining({
            id: "politiloggen-flatåsen-smoke",
            sourceLabel: "Politiloggen",
          }),
        ]),
        nearMissArticles: expect.arrayContaining([
          expect.objectContaining({
            id: "adressa-other-smoke",
            sourceLabel: "Adresseavisen",
            title: "Røykmelding ved Heimdal",
          }),
        ]),
        signals: expect.arrayContaining([
          expect.objectContaining({ kind: "generic_place_incident" }),
        ]),
        nearMisses: expect.arrayContaining([
          expect.objectContaining({ reason: "conflicting_specific_places" }),
        ]),
      }),
    ]);
    expect(page.items[0]).not.toHaveProperty("payload");
    expect(page.summary).toMatchObject({
      recentBundleCount: 1,
      byKind: { incident: 1, topic: 0, update: 0 },
      byConfidence: { high: 1, medium: 0 },
      latestGeneratedAt: "2026-06-18T10:55:00.000Z",
    });
    expect(page.nextCursor).toBeUndefined();
  });

  it("reads one completed normalized shadow generation with parity and integrity metadata", async () => {
    let generationChanged = true;
    let bundleKind: "incident" | "topic" | "update" = "incident";
    const article = {
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
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT id, matcher_version")) {
        expect(normalized).toContain("status='completed'");
        expect(params).toEqual(["shadow"]);
        return {
          rows: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              matcher_version: "v2",
              mode: "shadow",
              started_at: "2026-07-12T20:59:59.000Z",
              completed_at: "2026-07-12T21:00:00.000Z",
              article_count: 2,
              bundle_count: 1,
              edge_count: 2,
              correction_conflict_count: 0,
            },
          ],
        };
      }
      if (normalized.includes("FROM coverage_bundle_versions cbv")) {
        expect(normalized).toContain(
          "JOIN coverage_bundle_generations cg ON cg.id = cbv.generation_id",
        );
        expect(normalized).toContain("JOIN coverage_bundles cb ON cb.id = cbv.bundle_id");
        expect(normalized).toContain("cb.state = $1");
        expect(normalized).toContain("cg.status = 'completed'");
        expect(normalized).toContain("coverage_bundle_members cbm");
        expect(normalized).toContain("coverage_bundle_edges cbe");
        expect(normalized).toContain("positiveIncidentEvidence");
        expect(normalized).toContain("cbe.positive_incident_evidence");
        expect(normalized).toContain("'generationId', cbc.generation_id");
        expect(normalized).toContain("THEN 'active' ELSE 'history' END");
        expect(normalized).toContain("CASE WHEN $1='active' AND");
        expect(params).toEqual(["shadow", "11111111-1111-4111-8111-111111111111"]);
        return {
          rows: [
            {
              id: "coverage:v2:brann",
              kind: bundleKind,
              confidence: "high",
              reason: "Samme hendelse",
              generated_at: "2026-07-12T21:00:00.000Z",
              last_seen_at: "2026-07-12T21:00:00.000Z",
              last_seen_at_cursor: "2026-07-12T21:00:00.000000Z",
              primary_article_id: "article-a",
              member_article_ids: ["article-a", "article-b"],
              member_articles: [
                article,
                {
                  ...article,
                  id: "article-b",
                  source: "politiloggen",
                  sourceLabel: "Politiloggen",
                },
              ],
              source_ids: ["nrk", "politiloggen"],
              source_labels: ["NRK Trøndelag", "Politiloggen"],
              match_tier: "strong",
              match_score: 0.9,
              match_rationale: "Sterkt direkte treff.",
              edges: [
                {
                  articleIds: ["article-a", "article-b"],
                  tier: "strong",
                  score: 0.95,
                  kind: "incident",
                  signals: [],
                  conflicts: [],
                  positiveIncidentEvidence: ["shared_specific_place"],
                  evidenceFingerprint: "v2:accepted",
                  reviewable: false,
                  correctionConflict: false,
                },
                {
                  articleIds: ["article-a", "outside"],
                  tier: "weak",
                  score: 0.3,
                  kind: "incident",
                  signals: [],
                  conflicts: [],
                  evidenceFingerprint: "v2:review",
                  reviewable: true,
                  correctionConflict: false,
                },
              ],
              corrections: [
                {
                  id: "historical-correction",
                  generationId: "00000000-0000-4000-8000-000000000099",
                  anchorArticleId: "article-a",
                  rejectedArticleId: "article-b",
                  status: "active",
                  applicability: "history",
                  createdAt: "2026-07-11T21:00:00.000Z",
                },
              ],
              generation_changed: generationChanged,
              missing_article_ids: [],
              primary_count: 1,
              updated_at: "2026-07-12T21:00:00.000Z",
            },
          ],
        };
      }
      if (normalized.startsWith("SELECT id, primary_article_id, member_article_ids")) {
        expect(normalized).toContain("legacy_generation_id=$1");
        expect(params).toEqual(["11111111-1111-4111-8111-111111111111"]);
        return {
          rows: [
            {
              id: "coverage:v1:brann",
              primary_article_id: "article-a",
              member_article_ids: ["article-b", "article-a"],
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listCoverageBundles({
      projection: "shadow",
      review: ["reviewable", "missing_entity"],
      limit: 30,
    });

    expect(page.summary).toMatchObject({
      activeBundleCount: 1,
      byMatchTier: { strong: 1, moderate: 0 },
      reviewCandidateCount: 1,
      activeCorrectionCount: 0,
      integrityErrorCount: 0,
      matcherVersion: "v2",
      projectionState: "shadow",
    });
    expect(page.parity).toEqual({
      legacyBundleCount: 1,
      normalizedBundleCount: 1,
      membershipMismatchCount: 0,
      primaryMismatchCount: 0,
      clean: true,
    });
    expect(page.items[0]).toMatchObject({
      state: "shadow",
      integrityErrors: [],
      reviewCandidates: [{ evidenceFingerprint: "v2:review" }],
    });
    await expect(
      store.listCoverageBundles({ projection: "shadow", review: ["missing_place"], limit: 30 }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      store.listCoverageBundles({ projection: "shadow", review: ["missing_official"], limit: 30 }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      store.listCoverageBundles({ projection: "shadow", review: ["generation_change"], limit: 30 }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: "coverage:v2:brann" })] });
    generationChanged = false;
    await expect(
      store.listCoverageBundles({ projection: "shadow", review: ["generation_change"], limit: 30 }),
    ).resolves.toMatchObject({ items: [] });
    for (const nonIncidentKind of ["topic", "update"] as const) {
      bundleKind = nonIncidentKind;
      for (const review of ["missing_place", "missing_entity", "missing_official"] as const) {
        await expect(
          store.listCoverageBundles({ projection: "shadow", review: [review], limit: 30 }),
        ).resolves.toMatchObject({ items: [] });
      }
    }
  });

  it("reconstructs a superseded reused bundle id from immutable version rows", async () => {
    const oldGenerationId = "11111111-1111-4111-8111-111111111110";
    const oldArticles: Article[] = [
      {
        id: "article-old-a",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Eldre hendelse A",
        excerpt: "Første immutable medlem",
        url: "https://example.test/article-old-a",
        publishedAt: "2026-07-12T20:00:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
      },
      {
        id: "article-old-b",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Eldre hendelse B",
        excerpt: "Andre immutable medlem",
        url: "https://example.test/article-old-b",
        publishedAt: "2026-07-12T19:59:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
      },
    ];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT id, matcher_version")) {
        expect(normalized).not.toContain("OFFSET");
        expect(normalized).toContain("LIMIT 1");
        expect(normalized).toContain("matcher_version='v2'");
        expect(normalized).toContain("NOT is_current");
        expect(normalized).toContain("AND id=$1");
        expect(params).toEqual([oldGenerationId]);
        return {
          rows: [
            {
              id: oldGenerationId,
              matcher_version: "v2",
              mode: "active",
              started_at: "2026-07-12T19:58:00.000Z",
              completed_at: "2026-07-12T20:01:00.000Z",
              article_count: 2,
              bundle_count: 1,
              edge_count: 1,
              correction_conflict_count: 0,
            },
          ],
        };
      }
      if (normalized.includes("FROM coverage_bundle_versions cbv")) {
        expect(normalized).toContain("cbv.bundle_id AS id");
        expect(normalized).toContain("COALESCE(cbv.last_seen_at, cbv.generated_at) AS updated_at");
        expect(normalized).not.toContain("JOIN coverage_bundles cb");
        expect(normalized).not.toContain("cb.updated_at");
        expect(params).toEqual(["superseded", oldGenerationId]);
        return {
          rows: [
            {
              id: "coverage:v2:reused",
              kind: "incident",
              confidence: "high",
              reason: "Immutable old version",
              generated_at: "2026-07-12T20:00:00.000Z",
              last_seen_at: "2026-07-12T20:01:00.000Z",
              last_seen_at_cursor: "2026-07-12T20:01:00.000000Z",
              primary_article_id: oldArticles[0]!.id,
              member_article_ids: oldArticles.map(({ id }) => id),
              member_articles: oldArticles,
              source_ids: ["nrk", "adressa"],
              source_labels: ["NRK Trøndelag", "Adresseavisen"],
              match_tier: "strong",
              match_score: 0.9,
              match_rationale: "Immutable historical match",
              edges: [],
              corrections: [],
              missing_article_ids: [],
              primary_count: 1,
              updated_at: "2026-07-12T20:01:00.000Z",
            },
          ],
        };
      }
      if (normalized.startsWith("SELECT id, primary_article_id, member_article_ids")) {
        expect(params).toEqual([oldGenerationId]);
        return {
          rows: [
            {
              id: "coverage:v1:old",
              primary_article_id: oldArticles[0]!.id,
              member_article_ids: oldArticles.map(({ id }) => id),
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });

    const page = await new PgStore({ query } as unknown as pg.Pool).listCoverageBundles({
      projection: "superseded",
      generationId: oldGenerationId,
      limit: 30,
    });

    expect(page.items[0]).toMatchObject({
      id: "coverage:v2:reused",
      state: "superseded",
      primaryArticleId: "article-old-a",
      memberArticleIds: ["article-old-a", "article-old-b"],
      updatedAt: "2026-07-12T20:01:00.000Z",
    });
    expect(page.selectedGenerationId).toBe(oldGenerationId);
    expect(page.historyNextCursor).toBeUndefined();
  });

  it("selects normalized history by generation id or keyset cursor without OFFSET", async () => {
    const generationId = "11111111-1111-4111-8111-111111111110";
    const historyCursor = Buffer.from(
      JSON.stringify(["2026-07-12T20:01:00.000Z", generationId]),
    ).toString("base64url");
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).not.toContain("OFFSET");
      if (params?.includes(generationId) && params.length === 1) {
        expect(normalized).toContain("AND id=$1");
        expect(normalized).toContain("LIMIT 1");
        expect(params).toEqual([generationId]);
      } else {
        expect(normalized).toContain("AND (completed_at, id) < ($1::timestamptz, $2)");
        expect(normalized).toContain("LIMIT 2");
        expect(params).toEqual(["2026-07-12T20:01:00.000Z", generationId]);
      }
      return { rows: [] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    await expect(
      store.listCoverageBundles({ projection: "superseded", generationId, limit: 30 }),
    ).resolves.toMatchObject({ items: [], selectedProjection: "superseded" });
    await expect(
      store.listCoverageBundles({ projection: "superseded", historyCursor, limit: 30 }),
    ).resolves.toMatchObject({ items: [], selectedProjection: "superseded" });
  });

  it("uses one bounded paired-snapshot query for normalized readiness", async () => {
    const client = {
      query: vi.fn(async (config: { text: string; values?: unknown[]; query_timeout?: number }) => {
        expect(config.query_timeout).toBeGreaterThan(0);
        expect(config.query_timeout).toBeLessThanOrEqual(1_500);
        const normalized = config.text.replace(/\s+/g, " ").trim();
        if (!normalized.startsWith("WITH current_generation")) return { rows: [] };
        expect(normalized).toContain("legacy_generation_id = cg.id");
        expect(normalized).toContain("cg.is_current");
        expect(normalized).toContain("cg.matcher_version='v2'");
        expect(normalized).toContain("stable.state='active'");
        expect(normalized).toContain("stable.generation_id=cg.id");
        expect(normalized).toContain("stable.matcher_version='v2'");
        expect(normalized).toContain("stable.member_article_ids");
        expect(normalized).toContain("cg.bundle_count");
        expect(normalized).not.toContain("coverage_bundle_corrections");
        return {
          rows: [{ generation_valid: true, parity_clean: true, integrity_error_count: 0 }],
        };
      }),
      release: vi.fn(),
    };
    const connect = vi.fn(async () => client);
    const store = new PgStore({ connect } as unknown as pg.Pool);

    await expect(store.coverageProjectionReadiness()).resolves.toEqual({
      generationValid: true,
      parityClean: true,
      integrityErrorCount: 0,
    });
    expect(
      client.query.mock.calls.map(([query]) => query.text.replace(/\s+/g, " ").trim()),
    ).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SET LOCAL statement_timeout = '1000ms'",
      expect.stringContaining("WITH current_generation"),
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("keeps dropped historical legacy rows out while detecting paired mismatches", async () => {
    const cleanQuery = vi.fn(async () => ({
      rows: [{ generation_valid: true, parity_clean: true, integrity_error_count: 0 }],
    }));
    const dirtyQuery = vi.fn(async () => ({
      rows: [{ generation_valid: true, parity_clean: false, integrity_error_count: 0 }],
    }));

    await expect(
      new PgStore({
        connect: async () => ({ query: cleanQuery, release: vi.fn() }),
      } as unknown as pg.Pool).coverageProjectionReadiness(),
    ).resolves.toMatchObject({ parityClean: true });
    await expect(
      new PgStore({
        connect: async () => ({ query: dirtyQuery, release: vi.fn() }),
      } as unknown as pg.Pool).coverageProjectionReadiness(),
    ).resolves.toMatchObject({ parityClean: false });
    expect(String((cleanQuery.mock.calls[0] as unknown[])[0])).not.toContain("state='legacy' OR");
  });

  it("fails readiness closed when the bounded projection query errors", async () => {
    const failure = new Error("canceling statement due to query timeout");
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const store = new PgStore({ connect: async () => ({ query, release }) } as unknown as pg.Pool);

    await expect(store.coverageProjectionReadiness()).rejects.toThrow(failure.message);
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "ROLLBACK", query_timeout: expect.any(Number) }),
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("destroys the readiness client when rollback fails", async () => {
    const failure = new Error("projection query failed");
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(new Error("rollback failed"));
    const release = vi.fn();
    const store = new PgStore({ connect: async () => ({ query, release }) } as unknown as pg.Pool);

    await expect(store.coverageProjectionReadiness()).rejects.toThrow(failure.message);

    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(true);
  });

  it("destroys the readiness client when rollback does not finish within cleanup grace", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("projection query failed");
      const query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(failure)
        .mockImplementationOnce(() => new Promise(() => undefined));
      const release = vi.fn();
      const readiness = new PgStore({
        connect: async () => ({ query, release }),
      } as unknown as pg.Pool).coverageProjectionReadiness();
      const rejection = expect(readiness).rejects.toThrow(failure.message);

      await vi.advanceTimersByTimeAsync(250);
      await rejection;

      expect(release).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the checkout deadline after prompt readiness acquisition", async () => {
    vi.useFakeTimers();
    try {
      const query = vi.fn(async (config: pg.QueryConfig) =>
        config.text.includes("WITH current_generation")
          ? { rows: [{ generation_valid: true, parity_clean: true, integrity_error_count: 0 }] }
          : { rows: [] },
      );
      const release = vi.fn();
      const store = new PgStore({
        connect: vi.fn(async () => ({ query, release })),
      } as unknown as pg.Pool);

      await expect(store.coverageProjectionReadiness()).resolves.toMatchObject({
        generationValid: true,
      });
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(1_500);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled readiness pool checkout within the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      const store = new PgStore({
        connect: vi.fn(() => new Promise<never>(() => undefined)),
      } as unknown as pg.Pool);

      const readiness = store.coverageProjectionReadiness();
      const rejection = expect(readiness).rejects.toThrow(
        "Coverage readiness pool checkout timed out",
      );
      await vi.advanceTimersByTimeAsync(1_500);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a readiness client that arrives after checkout timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolveClient:
        | ((client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) => void)
        | undefined;
      const release = vi.fn();
      const lateClient = { query: vi.fn(), release };
      const connect = vi.fn(
        () =>
          new Promise<typeof lateClient>((resolve) => {
            resolveClient = resolve;
          }),
      );
      const readiness = new PgStore({
        connect,
      } as unknown as pg.Pool).coverageProjectionReadiness();
      const rejection = expect(readiness).rejects.toThrow(
        "Coverage readiness pool checkout timed out",
      );
      await vi.advanceTimersByTimeAsync(1_500);
      await rejection;

      resolveClient?.(lateClient);
      await Promise.resolve();
      await Promise.resolve();

      expect(release).toHaveBeenCalledOnce();
      expect(lateClient.query).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
