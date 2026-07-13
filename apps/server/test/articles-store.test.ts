import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { sampleSituation, type Article, type OfficialEvent, type Situation } from "@nytt/shared";
import { MemoryStore, PgStore } from "../src/store.js";

describe("article store", () => {
  function normalizedProjectionStore(pool: pg.Pool): PgStore {
    return new PgStore(pool, "normalized-active");
  }

  function normalizedActiveProjectionPool(options?: {
    noGeneration?: boolean;
    corrected?: boolean;
    integrityError?: boolean;
    matcherVersion?: "v1" | "v2";
    parityError?: boolean;
    directOfficialEdge?: boolean;
    emptyPositiveEvidence?: boolean;
    correctionRejectedArticleId?: "regional-b" | "regional-c";
    corruptAfterBuild?: "integrity" | "parity";
  }): pg.Pool {
    let healthReadCount = 0;
    const primary: Article = {
      id: "regional-a",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Regional hovedsak",
      excerpt: "Sanitert innhold.",
      url: "https://example.test/regional-a",
      publishedAt: "2026-07-12T21:00:00.000Z",
      scope: "trondelag",
      category: "Hendelser",
      places: ["Nærøysund"],
    };
    const articles: Article[] = [
      primary,
      {
        ...primary,
        id: "regional-b",
        source: options?.directOfficialEdge ? "politiloggen" : "adressa",
        sourceLabel: options?.directOfficialEdge ? "Politiloggen" : "Adresseavisen",
        url: "https://example.test/regional-b",
        publishedAt: "2026-07-12T20:59:00.000Z",
      },
      {
        ...primary,
        id: "regional-c",
        source: "nidaros",
        sourceLabel: "Nidaros",
        url: "https://example.test/regional-c",
        publishedAt: "2026-07-12T20:58:00.000Z",
      },
    ];
    const correctionRejectedArticleId = options?.correctionRejectedArticleId ?? "regional-c";
    const query = vi.fn(async (input: string | { text: string }) => {
      const sql = typeof input === "string" ? input : input.text;
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (
        normalized === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
        normalized.startsWith("SET LOCAL statement_timeout") ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("WITH current_generation AS")) {
        healthReadCount += 1;
        const generationValid = !options?.noGeneration && options?.matcherVersion !== "v1";
        const corrupted = healthReadCount > 2 ? options?.corruptAfterBuild : undefined;
        return {
          rows: [
            {
              generation_id: generationValid ? "11111111-1111-4111-8111-111111111111" : null,
              matcher_version: generationValid ? "v2" : null,
              mode: generationValid ? "active" : null,
              started_at: generationValid ? "2026-07-12T20:59:59.000Z" : null,
              completed_at: generationValid ? "2026-07-12T21:01:00.000Z" : null,
              article_count: generationValid ? 3 : 0,
              bundle_count: generationValid ? 1 : 0,
              edge_count: generationValid ? 2 : 0,
              correction_conflict_count: 0,
              correction_revision: options?.corrected ? 1 : 0,
              legacy_revision: 1,
              revision_updated_at: "2026-07-12T21:02:00.000Z",
              generation_valid: generationValid,
              parity_clean: generationValid && !options?.parityError && corrupted !== "parity",
              integrity_error_count: options?.integrityError || corrupted === "integrity" ? 1 : 0,
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.includes("FROM coverage_bundle_generations")) {
        expect(normalized).toContain("is_current");
        expect(normalized).toContain("matcher_version='v2'");
        if (options?.noGeneration || options?.matcherVersion === "v1") {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              matcher_version: "v2",
              mode: "active",
              started_at: "2026-07-12T20:59:59.000Z",
              completed_at: "2026-07-12T21:01:00.000Z",
              article_count: 3,
              bundle_count: 1,
              edge_count: 2,
              correction_conflict_count: 0,
              correction_revision: options?.corrected ? 1 : 0,
              legacy_revision: 1,
              correction_revision_at: "2026-07-12T21:02:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.includes("FROM coverage_bundle_versions cbv")) {
        expect(normalized).toContain(
          "cb.id = cbv.bundle_id AND cb.generation_id = cbv.generation_id",
        );
        expect(normalized).toContain("cb.state = $1");
        return {
          rows: [
            {
              id: "coverage:v2:regional",
              kind: "incident",
              confidence: "high",
              reason: "Samme hendelse",
              generated_at: "2026-07-12T21:00:00.000Z",
              last_seen_at: "2026-07-12T21:00:00.000Z",
              last_seen_at_cursor: "2026-07-12T21:00:00.000000Z",
              primary_article_id: "regional-a",
              member_article_ids: articles.map(({ id }) => id),
              member_articles: articles,
              source_ids: articles.map(({ source }) => source),
              source_labels: articles.map(({ sourceLabel }) => sourceLabel),
              match_tier: "strong",
              match_score: 0.9,
              match_rationale: "Sterkt direkte treff.",
              edges: options?.directOfficialEdge
                ? [
                    {
                      articleIds: ["regional-a", "regional-b"],
                      tier: "strong",
                      score: 0.95,
                      kind: "incident",
                      positiveIncidentEvidence: options?.emptyPositiveEvidence
                        ? []
                        : ["shared_named_entity"],
                      signals: [],
                      conflicts: [],
                      evidenceFingerprint: "v2:direct-official",
                      reviewable: false,
                      correctionConflict: false,
                    },
                  ]
                : [],
              corrections: options?.corrected
                ? [
                    {
                      id: "correction-1",
                      anchorArticleId: "regional-a",
                      rejectedArticleId: correctionRejectedArticleId,
                      status: "active",
                      createdAt: "2026-07-12T21:02:00.000Z",
                    },
                  ]
                : [],
              missing_article_ids: [],
              primary_count: options?.integrityError ? 0 : 1,
              updated_at: "2026-07-12T21:02:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.includes("FROM coverage_generation_articles cga")) {
        return { rows: articles.map((payload) => ({ payload })), rowCount: articles.length };
      }
      if (normalized.includes("FROM coverage_bundle_corrections cbc")) {
        return {
          rows: options?.corrected
            ? [
                {
                  id: "correction-1",
                  generation_id: "11111111-1111-4111-8111-111111111111",
                  original_bundle_id: "coverage:v2:regional",
                  anchor_article_id: "regional-a",
                  rejected_article_id: correctionRejectedArticleId,
                  matcher_version: "v2",
                  evidence_fingerprint: "v2:regional",
                  status: "active",
                  created_at: "2026-07-12T21:02:00.000Z",
                  reverted_at: null,
                },
              ]
            : [],
          rowCount: options?.corrected ? 1 : 0,
        };
      }
      if (normalized.startsWith("SELECT id, primary_article_id, member_article_ids")) {
        return {
          rows: [
            {
              id: "coverage:v1:regional",
              primary_article_id: "regional-a",
              member_article_ids: options?.parityError
                ? articles.slice(0, 2).map(({ id }) => id)
                : articles.map(({ id }) => id),
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.startsWith("SELECT article_id FROM saved_articles")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("FROM articles a LEFT JOIN saved_articles")) {
        return {
          rows: articles.map((payload) => ({ payload, saved: false })),
          rowCount: articles.length,
        };
      }
      if (normalized.includes("FROM situations")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${normalized}`);
    });
    const client = { query, release: vi.fn() };
    return { query, connect: vi.fn(async () => client) } as unknown as pg.Pool;
  }

  it("builds city pulse stories from the completed current active normalized generation", async () => {
    const store = normalizedProjectionStore(normalizedActiveProjectionPool());
    const page = await store.listCityPulseStories(
      { scope: "trondelag", limit: 40, sourceLimit: 1 },
      "Reedtrullz",
    );

    expect(page.projection).toMatchObject({
      mode: "normalized",
      generationId: "11111111-1111-4111-8111-111111111111",
      matcherVersion: "v2",
      parityClean: true,
      projectionRevision: 0,
    });
    expect(page.items.find((story) => story.id === "coverage:v2:regional")?.articles).toHaveLength(
      3,
    );
  });

  it("falls back atomically to legacy stories when no completed current active generation exists", async () => {
    const store = normalizedProjectionStore(normalizedActiveProjectionPool({ noGeneration: true }));
    const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");

    expect(page.projection).toMatchObject({
      mode: "legacy",
      matcherVersion: "v1",
      parityClean: false,
      fallbackReason: "no_completed_active_generation",
    });
    expect(page.items).toEqual(expect.any(Array));
  });

  it("treats a completed current active v1 generation as absent from feed and audit", async () => {
    const store = normalizedProjectionStore(
      normalizedActiveProjectionPool({ matcherVersion: "v1" }),
    );
    const [stories, coverage] = await Promise.all([
      store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz"),
      store.listCoverageBundles({ projection: "active", limit: 30 }, "Reedtrullz"),
    ]);

    expect(stories.projection).toMatchObject({
      mode: "legacy",
      fallbackReason: "no_completed_active_generation",
    });
    expect(coverage.items).toEqual([]);
    expect(coverage.summary.generation).toBeUndefined();
  });

  it("falls back atomically to legacy stories when normalized integrity validation fails", async () => {
    const store = normalizedProjectionStore(
      normalizedActiveProjectionPool({ integrityError: true }),
    );
    const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");

    expect(page.projection).toMatchObject({
      mode: "legacy",
      matcherVersion: "v1",
      parityClean: false,
      fallbackReason: "integrity_error",
    });
    expect(page.items.every((story) => story.articles.every(({ saved }) => saved === false))).toBe(
      true,
    );
  });

  it("falls back atomically when paired legacy parity is dirty", async () => {
    const store = normalizedProjectionStore(normalizedActiveProjectionPool({ parityError: true }));

    const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");

    expect(page.projection).toMatchObject({
      mode: "legacy",
      parityClean: false,
      fallbackReason: "parity_error",
    });
  });

  it("derives normalized verification only from an accepted strong incident edge", async () => {
    const store = normalizedProjectionStore(
      normalizedActiveProjectionPool({ directOfficialEdge: true }),
    );

    const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");

    expect(page.items[0]?.publicVerification).toMatchObject({
      officialSources: ["politiloggen"],
      reportingSources: ["nrk"],
    });
  });

  it("does not derive verification when the persisted direct edge has no positive evidence", async () => {
    const store = normalizedProjectionStore(
      normalizedActiveProjectionPool({
        directOfficialEdge: true,
        emptyPositiveEvidence: true,
      }),
    );

    const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");

    expect(page.items[0]?.publicVerification).toBeUndefined();
  });

  it("uses identical effective corrected membership for city pulse and active coverage", async () => {
    const store = normalizedProjectionStore(normalizedActiveProjectionPool({ corrected: true }));
    const [stories, coverage] = await Promise.all([
      store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz"),
      store.listCoverageBundles({ projection: "active", limit: 30 }, "Reedtrullz"),
    ]);
    const storyMembership = stories.items
      .map(({ articleIds }) => [...articleIds].sort())
      .filter((ids) => ids.length > 1);
    const coverageMembership = coverage.items
      .map(({ memberArticleIds }) => [...memberArticleIds].sort())
      .filter((ids) => ids.length > 1);

    expect(stories.projection?.generationId).toBe(coverage.summary.generation?.id);
    expect(storyMembership).toEqual(coverageMembership);
    expect(storyMembership).not.toContainEqual(["regional-a", "regional-b", "regional-c"]);
    expect(coverage.summary.activeCorrectionCount).toBe(1);
    const correctedAudit = coverage.items.find(({ memberArticleIds }) =>
      memberArticleIds.includes("regional-a"),
    );
    const correctedFeed = stories.items.find(({ articleIds }) => articleIds.includes("regional-a"));
    expect(correctedAudit?.matchConfidence).toMatchObject({ tier: "strong", score: 1 });
    expect(correctedFeed?.coverageBundle?.matchConfidence).toEqual(correctedAudit?.matchConfidence);
  });

  it("recomputes identical verification for a corrected active feed and audit group", async () => {
    const store = normalizedProjectionStore(
      normalizedActiveProjectionPool({ corrected: true, directOfficialEdge: true }),
    );
    const [stories, coverage] = await Promise.all([
      store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz"),
      store.listCoverageBundles({ projection: "active", limit: 30 }, "Reedtrullz"),
    ]);
    const correctedAudit = coverage.items.find(({ memberArticleIds }) =>
      memberArticleIds.includes("regional-a"),
    );
    const correctedFeed = stories.items.find(({ articleIds }) => articleIds.includes("regional-a"));

    expect(correctedAudit?.memberArticleIds).toEqual(["regional-a", "regional-b"]);
    expect(correctedAudit?.publicVerification).toMatchObject({
      officialSources: ["politiloggen"],
      reportingSources: ["nrk"],
    });
    expect(correctedFeed?.publicVerification).toEqual(correctedAudit?.publicVerification);
  });

  it("removes stale verification after correcting the official member out of the active group", async () => {
    const store = normalizedProjectionStore(
      normalizedActiveProjectionPool({
        corrected: true,
        directOfficialEdge: true,
        correctionRejectedArticleId: "regional-b",
      }),
    );
    const [stories, missingOfficialCoverage] = await Promise.all([
      store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz"),
      store.listCoverageBundles({
        projection: "active",
        review: ["missing_official"],
        limit: 30,
      }),
    ]);
    const correctedAudit = missingOfficialCoverage.items.find(({ memberArticleIds }) =>
      memberArticleIds.includes("regional-a"),
    );
    const correctedFeed = stories.items.find(({ articleIds }) => articleIds.includes("regional-a"));

    expect(correctedAudit?.memberArticleIds).toEqual(["regional-a", "regional-c"]);
    expect(correctedAudit?.publicVerification).toBeUndefined();
    expect(correctedFeed?.publicVerification).toBeUndefined();
  });

  it("reuses one bounded effective projection snapshot until generation or revision changes", async () => {
    const pool = normalizedActiveProjectionPool({ corrected: true });
    const store = normalizedProjectionStore(pool);

    await store.listCoverageBundles({ projection: "active", limit: 30 });
    await store.listCoverageBundles({ projection: "active", limit: 30 });

    const sqlCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map(([query]) =>
      (typeof query === "string" ? query : query.text).replace(/\s+/g, " ").trim(),
    );
    expect(
      sqlCalls.filter(
        (sql) =>
          sql.startsWith("SELECT cb.id") && sql.includes("FROM coverage_bundle_versions cbv"),
      ),
    ).toHaveLength(1);
    expect(sqlCalls.filter((sql) => sql.startsWith("SELECT a.payload"))).toHaveLength(1);
    expect(sqlCalls.filter((sql) => sql.startsWith("SELECT cbc.*"))).toHaveLength(1);
    expect(sqlCalls.filter((sql) => sql.startsWith("WITH current_generation AS"))).toHaveLength(3);
    expect(sqlCalls.filter((sql) => sql.startsWith("SELECT id, matcher_version"))).toHaveLength(1);
  });

  it("coalesces concurrent cold active projection materialization", async () => {
    const pool = normalizedActiveProjectionPool({ corrected: true });
    const store = normalizedProjectionStore(pool);

    await Promise.all([
      store.listCoverageBundles({ projection: "active", limit: 30 }),
      store.listCoverageBundles({ projection: "active", limit: 10 }),
      store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz"),
    ]);

    const sqlCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map(([query]) =>
      (typeof query === "string" ? query : query.text).replace(/\s+/g, " ").trim(),
    );
    expect(
      sqlCalls.filter(
        (sql) =>
          sql.startsWith("SELECT cb.id") && sql.includes("FROM coverage_bundle_versions cbv"),
      ),
    ).toHaveLength(1);
    expect(sqlCalls.filter((sql) => sql.startsWith("SELECT a.payload"))).toHaveLength(1);
  });

  it.each([
    ["stable-row corruption", "integrity", "integrity_error"],
    ["paired legacy marker mutation", "parity", "parity_error"],
  ] as const)("invalidates a warm cache immediately on %s", async (_label, corruption, reason) => {
    const store = normalizedProjectionStore(
      normalizedActiveProjectionPool({ corruptAfterBuild: corruption }),
    );
    await store.listCoverageBundles({ projection: "active", limit: 30 });

    const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");

    expect(page.projection).toMatchObject({ mode: "legacy", fallbackReason: reason });
  });

  it("filters in-memory articles by published time window like production", async () => {
    const store = new MemoryStore();

    const page = await store.listArticles({
      from: "2026-05-26T09:00:00.000Z",
      to: "2026-05-26T10:00:00.000Z",
      limit: 10,
    });

    expect(page.items.map((article) => article.id)).toEqual(["a-sluppen", "a-road"]);
  });

  it("hydrates bootstrap from the first story page so story pagination cannot skip clustered rows", async () => {
    const store = new MemoryStore();
    const coverageBundle = {
      id: "coverage:incident:story-native-bootstrap",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-09-03T09:15:00.000Z",
    };
    const clustered: Article[] = [
      {
        id: "story-native-cluster-adressa",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Story native bootstrap: Trafikkuhell ved Sluppen",
        excerpt: "To kilder omtaler samme trafikkuhell ved Sluppen.",
        url: "https://example.test/story-native-cluster-adressa",
        publishedAt: "2026-09-03T09:10:00.000Z",
        scope: "trondheim",
        category: "Transport",
        places: ["Sluppen"],
        coverageBundle,
      },
      {
        id: "story-native-cluster-politiloggen",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Story native bootstrap: Ulykke: Trondheim, Sluppen",
        excerpt: "Politiet melder om samme trafikkuhell ved Sluppen.",
        url: "https://example.test/story-native-cluster-politiloggen",
        publishedAt: "2026-09-03T09:09:00.000Z",
        scope: "trondheim",
        category: "Transport",
        places: ["Sluppen"],
        coverageBundle,
      },
    ];
    const standalone = Array.from({ length: 40 }, (_, index) => ({
      id: `story-native-single-${String(index).padStart(2, "0")}`,
      source: "nrk" as const,
      sourceLabel: "NRK Trøndelag",
      title: `Story native bootstrap enkeltsak ${index}`,
      excerpt: `Unik bypulsnotis nummer ${index} med eget innhold for sortering.`,
      url: `https://example.test/story-native-single-${index}`,
      publishedAt: new Date(Date.UTC(2026, 8, 2, 8 - index * 25, 0)).toISOString(),
      scope: "trondheim" as const,
      category: "Nyheter" as const,
      places: [`Teststed ${index}`],
    })) satisfies Article[];
    (store as unknown as { articles: Article[] }).articles.unshift(...clustered, ...standalone);

    const bootstrap = await store.getBootstrap();
    const articleIds = bootstrap.articles.map((article) => article.id);
    const storyIds = bootstrap.stories?.map((story) => story.id) ?? [];

    expect(bootstrap.storyNextCursor).toBeTruthy();
    expect(bootstrap).not.toHaveProperty("articleNextCursor");
    expect(storyIds).toContain("coverage:incident:story-native-bootstrap");
    expect(storyIds).toContain("article:story-native-single-18");
    expect(storyIds).not.toContain("article:story-native-single-19");
    expect(storyIds).toHaveLength(20);
    expect(articleIds).toContain("story-native-cluster-adressa");
    expect(articleIds).toContain("story-native-cluster-politiloggen");
    expect(articleIds).toContain("story-native-single-18");
    expect(articleIds).not.toContain("story-native-single-19");
    expect(articleIds).toHaveLength(21);
  });

  it("keeps stale traffic situations out of the public home lead without hiding active rescue", async () => {
    const store = new MemoryStore();
    const situations = (store as unknown as { situations: Map<string, Situation> }).situations;
    const now = new Date();
    const oldCreatedAt = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const recentCreatedAt = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const updatedAt = now.toISOString();
    situations.clear();
    situations.set("old-road", {
      ...sampleSituation,
      id: "old-road",
      type: "traffic",
      title: "Vegen er stengt",
      summary: "Gangåsvegen er fortsatt stengt, og omkjøring er skiltet.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      createdAt: oldCreatedAt,
      updatedAt,
      locationLabel: "Gangåsvegen",
      relatedArticleIds: [],
    });
    situations.set("missing-person", {
      ...sampleSituation,
      id: "missing-person",
      type: "missing_person",
      title: "Leteaksjon etter savnet mann i Meråker",
      summary: "Politiet leder fortsatt søket med letemannskap og redningshelikopter.",
      status: "active",
      verificationStatus: "Foreløpig fra rapportering",
      createdAt: recentCreatedAt,
      updatedAt,
      locationLabel: "Funnsjøen",
      officialSource: undefined,
      officialEventId: undefined,
      relatedArticleIds: [],
    });

    const bootstrap = await store.getBootstrap();

    expect(bootstrap.situations.map((situation) => situation.id)).toEqual(["missing-person"]);
  });

  it("does not promote articles with stale traffic situation links", async () => {
    const store = new MemoryStore();
    const article: Article = {
      id: "stale-road-linked-article",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Siste status for gammel veistenging",
      excerpt: "Vegen har vært stengt i lang tid, og saken er ikke lenger fersk.",
      url: "https://example.test/stale-road",
      publishedAt: new Date().toISOString(),
      scope: "trondheim",
      category: "Transport",
      places: ["Gangåsvegen"],
    };
    (store as unknown as { articles: Article[] }).articles.unshift(article);
    const situations = (store as unknown as { situations: Map<string, Situation> }).situations;
    const oldCreatedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    situations.set("old-road", {
      ...sampleSituation,
      id: "old-road",
      type: "traffic",
      title: "Vegen er stengt",
      summary: "Gangåsvegen er fortsatt stengt, og omkjøring er skiltet.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      createdAt: oldCreatedAt,
      updatedAt: new Date().toISOString(),
      locationLabel: "Gangåsvegen",
      officialSource: "datex",
      officialEventId: "datex-old-road",
      relatedArticleIds: [article.id],
    });

    const page = await store.listArticles({ q: "gammel veistenging", limit: 10 });

    expect(page.items[0]).toMatchObject({
      id: article.id,
    });
    expect(page.items[0]).not.toHaveProperty("situationId", "old-road");
    expect(page.items[0]).not.toHaveProperty("publicVerification");
  });

  it("promotes articles linked to fresh traffic situations", async () => {
    const store = new MemoryStore();
    const article: Article = {
      id: "fresh-road-linked-article",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Fersk veistenging etter ras",
      excerpt: "Vegen er stengt etter et ferskt ras, og omkjøring er skiltet.",
      url: "https://example.test/fresh-road",
      publishedAt: new Date().toISOString(),
      scope: "trondheim",
      category: "Transport",
      places: ["Gangåsvegen"],
    };
    (store as unknown as { articles: Article[] }).articles.unshift(article);
    const situations = (store as unknown as { situations: Map<string, Situation> }).situations;
    situations.set("fresh-road", {
      ...sampleSituation,
      id: "fresh-road",
      type: "traffic",
      title: "Vegen er stengt",
      summary: "Vegen er stengt etter et ferskt ras, og omkjøring er skiltet.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      locationLabel: "Gangåsvegen",
      officialSource: "datex",
      officialEventId: "datex-fresh-road",
      relatedArticleIds: [article.id],
    });

    const page = await store.listArticles({ q: "Fersk veistenging", limit: 10 });

    expect(page.items[0]).toMatchObject({
      id: article.id,
      situationId: "fresh-road",
    });
  });

  it("searches production articles by place metadata, source label, and category", async () => {
    const article: Article = {
      id: "flatåsen-smoke",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Rykka ut etter røykutvikling",
      excerpt: "Nødetatene undersøker røyk fra en bygning.",
      url: "https://example.test/flatåsen-smoke",
      publishedAt: "2026-06-18T10:50:00.000Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Flatåsen", "Trondheim"],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["flatåsen-smoke"]]);
        return { rows: [] };
      }
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).toContain("FROM articles a");
      expect(normalized).toContain("a.payload->>'title' ILIKE $2");
      expect(normalized).toContain("a.payload->>'excerpt' ILIKE $2");
      expect(normalized).toContain("a.payload->>'sourceLabel' ILIKE $2");
      expect(normalized).toContain("a.category ILIKE $2");
      expect(normalized).toContain("jsonb_array_elements_text");
      expect(params).toEqual(["Reedtrullz", "%Flatåsen%", 41]);
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ q: "Flatåsen" }, "Reedtrullz");

    expect(page.items).toEqual([{ ...article, saved: false }]);
    expect(page.nextCursor).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("filters production articles by Rosenborg topic without requiring a category migration", async () => {
    const article: Article = {
      id: "rosenborg-trener",
      source: "vg",
      sourceLabel: "VG",
      title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
      excerpt: "Han er presentert som Rosenborgs nye trener.",
      url: "https://example.test/rosenborg",
      publishedAt: "2026-06-18T09:34:00.000Z",
      scope: "trondheim",
      category: "Sport",
      topics: ["rosenborg"],
      places: ["Rosenborg"],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["rosenborg-trener"]]);
        return { rows: [] };
      }
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).toContain("COALESCE(a.payload->'topics', '[]'::jsonb) ? $3");
      expect(normalized).toContain("NOT (a.payload ? 'topics')");
      expect(normalized).toContain("a.category = 'Sport'");
      expect(normalized).toContain("a.payload->>'title' ILIKE '%rbk%'");
      expect(params).toEqual(["Reedtrullz", "Sport", "rosenborg", 41]);
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ category: "Sport", topic: "rosenborg" }, "Reedtrullz");

    expect(page.items).toEqual([{ ...article, saved: false }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("keeps legacy local match reports discoverable in the Sport filter", async () => {
    const store = new MemoryStore();
    const legacyMatchReport: Article = {
      id: "legacy-ranheim-match",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Ranheim tapte 0-3 borte mot Åsane",
      excerpt: "Kampen var målløs til pause før Ranheim gikk på sitt femte bortetap.",
      url: "https://example.test/ranheim-match",
      publishedAt: "2026-06-28T15:59:00.000Z",
      scope: "trondheim",
      category: "Nyheter",
      places: ["Ranheim", "Trondheim"],
    };
    const neighborhoodAward: Article = {
      ...legacyMatchReport,
      id: "ranheim-award",
      title: "Ranheim vant pris for ny møteplass",
      excerpt: "Prosjektet på Ranheim ble hedret av kommunen.",
      url: "https://example.test/ranheim-award",
      publishedAt: "2026-06-28T15:58:00.000Z",
    };
    (store as unknown as { articles: Article[] }).articles.unshift(
      legacyMatchReport,
      neighborhoodAward,
    );

    const page = await store.listArticles({ category: "Sport", limit: 20 });

    expect(page.items.map((item) => item.id)).toContain("legacy-ranheim-match");
    expect(page.items.map((item) => item.id)).not.toContain("ranheim-award");
  });

  it("filters production Sport articles with a conservative local-match fallback", async () => {
    const article: Article = {
      id: "legacy-ranheim-match",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Ranheim tapte 0-3 borte mot Åsane",
      excerpt: "Kampen var målløs til pause før Ranheim gikk på sitt femte bortetap.",
      url: "https://example.test/ranheim-match",
      publishedAt: "2026-06-28T15:59:00.000Z",
      scope: "trondheim",
      category: "Nyheter",
      places: ["Ranheim", "Trondheim"],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["legacy-ranheim-match"]]);
        return { rows: [] };
      }
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).toContain("a.category = $2");
      expect(normalized).toContain("a.category = 'Nyheter'");
      expect(normalized).toContain("a.payload->>'title' ILIKE '%ranheim%'");
      expect(normalized).toContain("a.payload->>'excerpt' ILIKE '%bortetap%'");
      expect(normalized).toContain("a.payload->>'title' ILIKE '%profil%'");
      expect(normalized).toContain("a.payload->>'title' ~* '\\d+\\s*[–-]\\s*\\d+'");
      expect(params).toEqual(["Reedtrullz", "Sport", 41]);
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ category: "Sport" }, "Reedtrullz");

    expect(page.items).toEqual([{ ...article, saved: false }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("filters production articles by published time window before pagination", async () => {
    const article: Article = {
      id: "recent-crash",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Trafikkuhell på E6",
      excerpt: "Et trafikkuhell skaper kø på E6.",
      url: "https://example.test/recent-crash",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["recent-crash"]]);
        return { rows: [] };
      }
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).toContain("a.published_at >= $2");
      expect(normalized).toContain("a.published_at <= $3");
      expect(normalized).toContain("ORDER BY a.published_at DESC, a.id DESC LIMIT $4");
      expect(params).toEqual([
        "Reedtrullz",
        "2026-07-02T07:00:00.000Z",
        "2026-07-02T10:00:00.000Z",
        11,
      ]);
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles(
      {
        from: "2026-07-02T07:00:00.000Z",
        to: "2026-07-02T10:00:00.000Z",
        limit: 10,
      },
      "Reedtrullz",
    );

    expect(page.items).toEqual([{ ...article, saved: false }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("adds DATEX public verification and situation links to related production articles", async () => {
    const freshSituationTimestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const article: Article = {
      id: "article-road",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6",
      excerpt: "En kollisjon gjør at E6 er stengt.",
      url: "https://example.test/e6",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const situation: Situation = {
      id: "datex-e6",
      type: "traffic",
      title: "Kollisjon på E6",
      summary: "DATEX melder om stengt veg.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      updatedAt: freshSituationTimestamp,
      createdAt: freshSituationTimestamp,
      locationLabel: "E6",
      officialSource: "datex",
      officialEventId: "datex-e6",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: freshSituationTimestamp,
      },
      relatedArticleIds: ["article-road"],
      evidence: [
        {
          id: "datex-evidence",
          situationId: "datex-e6",
          source: "datex",
          sourceLabel: "Statens vegvesen DATEX",
          sourceUrl: "https://example.test/datex",
          supportingSnippet: "Stengt veg",
          claim: "E6 er stengt",
          claimType: "official_traffic_status",
          provenance: "official",
          confidence: 1,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:20:00.000Z",
        },
        {
          id: "article-evidence",
          situationId: "datex-e6",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/e6",
          supportingSnippet: "En kollisjon gjør at E6 er stengt.",
          claim: "Kollisjon stenger E6",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:34:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["article-road"]]);
        return { rows: [{ payload: situation }] };
      }
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road",
      saved: false,
      situationId: "datex-e6",
      publicVerification: {
        status: "verified",
        label: "Verifisert",
        detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
        officialSources: ["datex"],
        reportingSources: ["adressa"],
        situationId: "datex-e6",
      },
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("adds Politiloggen public verification and situation links to related production articles", async () => {
    const article: Article = {
      id: "article-lade-violence",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Ung mann kritisk skadd på Lade",
      excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
      url: "https://example.test/lade-vold",
      publishedAt: "2026-07-02T18:59:00.000Z",
      scope: "trondheim",
      category: "Krim",
      places: ["Lade", "Trondheim"],
    };
    const situation: Situation = {
      id: "politiloggen-lade-vold",
      type: "other",
      title: "Voldshendelse på Lade",
      summary: "Politiloggen omtaler en voldshendelse på Lade.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "normal",
      updatedAt: "2026-07-02T19:05:00.000Z",
      createdAt: "2026-07-02T18:34:00.000Z",
      locationLabel: "Lade",
      officialSource: "politiloggen",
      officialEventId: "lade-vold",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["politiloggen"],
        articleIds: ["politiloggen-lade-vold"],
        activatedAt: "2026-07-02T18:34:00.000Z",
      },
      relatedArticleIds: ["politiloggen-lade-vold", "article-lade-violence"],
      evidence: [
        {
          id: "politiloggen-evidence",
          situationId: "politiloggen-lade-vold",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          sourceUrl: "https://example.test/politiloggen/lade-vold",
          supportingSnippet: "Voldshendelse: Trondheim, Lade",
          claim: "Politiet undersøker voldshendelse på Lade",
          claimType: "official_police_log",
          provenance: "official",
          confidence: 1,
          extractedAt: "2026-07-02T19:05:00.000Z",
          publishedAt: "2026-07-02T18:34:00.000Z",
        },
        {
          id: "article-lade-evidence",
          situationId: "politiloggen-lade-vold",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/lade-vold",
          supportingSnippet: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
          claim: "Ung mann kritisk skadd på Lade",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T19:05:00.000Z",
          publishedAt: "2026-07-02T18:59:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["article-lade-violence"]]);
        return { rows: [{ payload: situation }] };
      }
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-lade-violence",
      saved: false,
      situationId: "politiloggen-lade-vold",
      publicVerification: {
        status: "verified",
        label: "Verifisert",
        detail: "Bekreftet av Politiloggen og Adresseavisen.",
        officialSources: ["politiloggen"],
        reportingSources: ["adressa"],
        situationId: "politiloggen-lade-vold",
      },
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not derive verification from legacy bundle co-membership without direct edges", async () => {
    const coverageBundle = {
      id: "coverage:incident:lade-vold",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T18:59:00.000Z",
    } as const;
    const newsroomArticle: Article = {
      id: "adressa-lade-violence",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Ung mann kritisk skadd på Lade",
      excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
      url: "https://example.test/lade-vold",
      publishedAt: "2026-07-02T18:59:00.000Z",
      scope: "trondheim",
      category: "Krim",
      places: ["Lade", "Trondheim"],
      coverageBundle,
    };
    const officialArticle: Article = {
      id: "politiloggen-lade-violence",
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Voldshendelse: Trondheim, Lade",
      excerpt: "En person er kritisk skadet etter en voldshendelse på Lade.",
      url: "https://example.test/politiloggen/lade-vold",
      publishedAt: "2026-07-02T18:45:00.000Z",
      scope: "trondheim",
      category: "Krim",
      places: ["Lade", "Trondheim"],
      situationId: "politiloggen-lade-vold",
      coverageBundle,
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["adressa-lade-violence", "politiloggen-lade-violence"]]);
        return { rows: [] };
      }
      return {
        rows: [
          { payload: newsroomArticle, saved: false },
          { payload: officialArticle, saved: false },
        ],
      };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items).toHaveLength(2);
    for (const article of page.items) {
      expect(article.publicVerification).toBeUndefined();
    }
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not derive public verification from topical official-plus-news bundles", async () => {
    const coverageBundle = {
      id: "coverage:topic:politioppsummering",
      kind: "topic",
      confidence: "high",
      reason: "Samme tema over tid",
      generatedAt: "2026-07-02T18:59:00.000Z",
    } as const;
    const newsroomArticle: Article = {
      id: "nrk-politioppsummering",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Politiet melder om rolig natt",
      excerpt: "Flere medier omtaler politiets oppsummering av natta.",
      url: "https://example.test/politioppsummering",
      publishedAt: "2026-07-02T18:59:00.000Z",
      scope: "trondheim",
      category: "Nyheter",
      places: ["Trondheim"],
      coverageBundle,
    };
    const officialArticle: Article = {
      id: "politiloggen-politioppsummering",
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Oppsummering: Trondheim",
      excerpt: "Politiet oppsummerer nattens hendelser i Trondheim.",
      url: "https://example.test/politiloggen/oppsummering",
      publishedAt: "2026-07-02T18:45:00.000Z",
      scope: "trondheim",
      category: "Nyheter",
      places: ["Trondheim"],
      coverageBundle,
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["nrk-politioppsummering", "politiloggen-politioppsummering"]]);
        return { rows: [] };
      }
      return {
        rows: [
          { payload: newsroomArticle, saved: false },
          { payload: officialArticle, saved: false },
        ],
      };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items.map((article) => article.publicVerification)).toEqual([undefined, undefined]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("adds DATEX public verification to matching traffic articles without requiring a situation link", async () => {
    const article: Article = {
      id: "article-road-official-match",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6 ved Sluppen",
      excerpt: "En kollisjon gjør at E6 er stengt ved Sluppen.",
      url: "https://example.test/e6-sluppen",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6", "Sluppen"],
      location: { lat: 63.3978, lng: 10.3995, label: "Sluppen" },
    };
    const geometry: OfficialEvent["geometry"] = {
      type: "Point",
      coordinates: [10.3995, 63.3978],
    };
    const officialEvent: OfficialEvent = {
      id: "datex-e6-sluppen",
      source: "datex",
      eventType: "traffic",
      title: "Kollisjon på E6 ved Sluppen",
      detail: "E6 er stengt etter trafikkulykke.",
      sourceUrl: "https://example.test/datex/e6-sluppen",
      areaLabel: "Sluppen",
      state: "active",
      severity: "high",
      publishedAt: "2026-07-02T09:30:00.000Z",
      validFrom: "2026-07-02T09:20:00.000Z",
      validTo: "2026-07-02T12:00:00.000Z",
      geometry,
      raw: {
        datex: {
          recordKind: "Accident",
          roadName: "E6",
        },
      },
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM situations")) {
        expect(params).toEqual([["article-road-official-match"]]);
        return { rows: [] };
      }
      if (sql.includes("FROM official_events")) {
        expect(params).toEqual(["datex", 500]);
        return { rows: [{ payload: officialEvent, state: "active", geometry }] };
      }
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road-official-match",
      saved: false,
      publicVerification: {
        status: "verified",
        label: "Verifisert",
        detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
        officialSources: ["datex"],
        reportingSources: ["adressa"],
      },
    });
    expect(page.items[0]?.situationId).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not add a public verification badge without official DATEX evidence", async () => {
    const freshSituationTimestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const article: Article = {
      id: "article-road-unverified",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6",
      excerpt: "En kollisjon gjør at E6 er stengt.",
      url: "https://example.test/e6",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const situation: Situation = {
      id: "datex-e6-unverified",
      type: "traffic",
      title: "Kollisjon på E6",
      summary: "DATEX melder om stengt veg.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      updatedAt: freshSituationTimestamp,
      createdAt: freshSituationTimestamp,
      locationLabel: "E6",
      officialSource: "datex",
      officialEventId: "datex-e6-unverified",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: freshSituationTimestamp,
      },
      relatedArticleIds: ["article-road-unverified"],
      evidence: [
        {
          id: "article-evidence",
          situationId: "datex-e6-unverified",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/e6",
          supportingSnippet: "En kollisjon gjør at E6 er stengt.",
          claim: "Kollisjon stenger E6",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:34:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async () => {
      if (query.mock.calls.length > 1) return { rows: [{ payload: situation }] };
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road-unverified",
      situationId: "datex-e6-unverified",
    });
    expect(page.items[0]?.publicVerification).toBeUndefined();
  });

  it("does not add a public verification badge before the linked situation is officially verified", async () => {
    const freshSituationTimestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const article: Article = {
      id: "article-road-preliminary",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6",
      excerpt: "En kollisjon gjør at E6 er stengt.",
      url: "https://example.test/e6",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const situation: Situation = {
      id: "datex-e6-preliminary",
      type: "traffic",
      title: "Kollisjon på E6",
      summary: "DATEX melder om stengt veg.",
      status: "preliminary",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "medium",
      updatedAt: freshSituationTimestamp,
      createdAt: freshSituationTimestamp,
      locationLabel: "E6",
      officialSource: "datex",
      officialEventId: "datex-e6-preliminary",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: freshSituationTimestamp,
      },
      relatedArticleIds: ["article-road-preliminary"],
      evidence: [
        {
          id: "datex-evidence",
          situationId: "datex-e6-preliminary",
          source: "datex",
          sourceLabel: "Statens vegvesen DATEX",
          sourceUrl: "https://example.test/datex",
          supportingSnippet: "Stengt veg",
          claim: "E6 er stengt",
          claimType: "official_traffic_status",
          provenance: "official",
          confidence: 1,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:20:00.000Z",
        },
        {
          id: "article-evidence",
          situationId: "datex-e6-preliminary",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/e6",
          supportingSnippet: "En kollisjon gjør at E6 er stengt.",
          claim: "Kollisjon stenger E6",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:34:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async () => {
      if (query.mock.calls.length > 1) return { rows: [{ payload: situation }] };
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road-preliminary",
      situationId: "datex-e6-preliminary",
    });
    expect(page.items[0]?.publicVerification).toBeUndefined();
  });
});
