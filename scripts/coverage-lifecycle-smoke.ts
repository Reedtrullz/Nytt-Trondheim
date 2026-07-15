import assert from "node:assert/strict";
import pg from "pg";
import {
  analyzeArticleCoverage,
  analyzeArticleCoverageV2,
  type Article,
  type ArticleCoverageAnalysis,
  type ArticleCoverageBundleDecision,
} from "@nytt/shared";
import { PgStore } from "../apps/server/src/store.js";
import { WorkerRepository } from "../apps/worker/src/repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const generationId = "00000000-0000-4000-8000-000000000801";
const ownerId = "ci-coverage-pgstore-owner";
const articleA: Article = {
  id: "ci-pgstore-coverage-a",
  source: "nrk",
  sourceLabel: "NRK Trøndelag",
  title: "Brann i lagerbygning på Tiller",
  excerpt: "Nødetatene har rykket ut til samme lagerbygning på Tiller.",
  url: "https://example.test/ci-pgstore-coverage-a",
  publishedAt: "2026-07-13T08:01:00.000Z",
  scope: "trondheim",
  category: "Hendelser",
  places: ["Tiller", "Trondheim"],
  situationId: "ci-pgstore-lifecycle-incident",
};
const articleB: Article = {
  ...articleA,
  id: "ci-pgstore-coverage-b",
  source: "adressa",
  sourceLabel: "Adresseavisen",
  title: "Røyk fra lager på Tiller",
  excerpt: "Brannvesenet arbeider ved den samme lagerbygningen på Tiller.",
  url: "https://example.test/ci-pgstore-coverage-b",
  publishedAt: "2026-07-13T08:00:00.000Z",
};
const articleC: Article = {
  ...articleA,
  id: "ci-pgstore-coverage-c",
  source: "nidaros",
  sourceLabel: "Nidaros",
  title: "Ny oppfølging fra Tiller",
  excerpt: "Et senere medlem for den gjenbrukte stabile identiteten.",
  url: "https://example.test/ci-pgstore-coverage-c",
  publishedAt: "2026-07-13T08:04:00.000Z",
};

const pool = new pg.Pool({ connectionString: databaseUrl });

async function persistActiveGeneration(input: {
  completedAt: string;
  articles: Article[];
}): Promise<string> {
  const analysis = analyzeArticleCoverageV2(input.articles, input.completedAt);
  const legacyBundles = analyzeArticleCoverage(input.articles, input.completedAt).bundles;
  assert.equal(analysis.bundles.length, 1);
  assert.equal(legacyBundles.length, 1);
  return new WorkerRepository(pool).persistCoverageGeneration({
    matcherVersion: "v2",
    mode: "active",
    startedAt: new Date(Date.parse(input.completedAt) - 1_000).toISOString(),
    completedAt: input.completedAt,
    analysis,
    publicLegacyBundles: legacyBundles,
    activeVolumeGuard: {
      minimumArticleCount: 1,
      minimumPreviousRatio: 0.5,
      allowUnsafeOverride: false,
    },
  });
}

try {
  await pool.query(
    `INSERT INTO articles
       (id, canonical_url, dedupe_key, source, published_at, scope, category, payload)
     VALUES ($1,$2,$1,$3,$4,$5,$6,$7), ($8,$9,$8,$10,$11,$12,$13,$14)`,
    [
      articleA.id,
      articleA.url,
      articleA.source,
      articleA.publishedAt,
      articleA.scope,
      articleA.category,
      articleA,
      articleB.id,
      articleB.url,
      articleB.source,
      articleB.publishedAt,
      articleB.scope,
      articleB.category,
      articleB,
    ],
  );
  await pool.query(
    `INSERT INTO users (id, display_name, role, status)
     VALUES ($1, 'CI coverage owner', 'owner', 'active')`,
    [ownerId],
  );
  await pool.query(
    `INSERT INTO articles
       (id, canonical_url, dedupe_key, source, published_at, scope, category, payload)
     VALUES ($1,$2,$1,$3,$4,$5,$6,$7)`,
    [
      articleC.id,
      articleC.url,
      articleC.source,
      articleC.publishedAt,
      articleC.scope,
      articleC.category,
      articleC,
    ],
  );
  await pool.query(
    `INSERT INTO coverage_bundle_generations
       (id, matcher_version, mode, status, started_at, completed_at, article_count,
        bundle_count, edge_count, correction_conflict_count)
     VALUES ($1,'v2','shadow','completed',$2,$3,2,1,1,0)`,
    [generationId, "2026-07-13T08:00:00.000Z", "2026-07-13T08:02:00.000Z"],
  );
  await pool.query(`UPDATE coverage_bundle_generations SET health_outcome='healthy' WHERE id=$1`, [
    generationId,
  ]);
  await pool.query(
    `INSERT INTO coverage_generation_articles (generation_id, article_id)
     VALUES ($1,$2),($1,$3)`,
    [generationId, articleA.id, articleB.id],
  );
  await pool.query(
    `INSERT INTO coverage_bundles
       (id, kind, confidence, reason, generated_at, last_seen_at, primary_article_id,
        member_article_ids, source_ids, source_labels, payload, state, matcher_version,
        legacy_generation_id)
     VALUES
       ('ci-pgstore-legacy','incident','high','Paired legacy snapshot',$2,$2,$3,$4,$5,$6,
        '{}'::jsonb,'superseded','v1',$1)`,
    [
      generationId,
      "2026-07-13T08:02:00.000Z",
      articleA.id,
      [articleA.id, articleB.id],
      [articleA.source, articleB.source],
      [articleA.sourceLabel, articleB.sourceLabel],
    ],
  );

  const legacyMutation: ArticleCoverageBundleDecision = {
    id: "ci-pgstore-legacy",
    kind: "incident",
    confidence: "high",
    reason: "Uncommitted replacement legacy snapshot",
    generatedAt: "2026-07-13T08:03:00.000Z",
    matcherVersion: "v1",
    primaryArticleId: articleB.id,
    memberArticleIds: [articleA.id, articleB.id],
    sourceIds: [articleA.source, articleB.source],
    sourceLabels: [articleA.sourceLabel, articleB.sourceLabel],
    signals: [],
    nearMisses: [],
  };
  const invalidV2Analysis: ArticleCoverageAnalysis = {
    articles: [articleA, articleB],
    bundles: [
      {
        ...legacyMutation,
        id: "ci-pgstore-invalid-v2",
        matcherVersion: "v2",
        memberArticleIds: [articleA.id],
        primaryArticleId: articleA.id,
        matchConfidence: { tier: "strong", score: 1, rationale: "Atomicity failure fixture" },
      },
    ],
    nearMisses: [],
    edges: [],
  };
  const legacyBeforeFailure = await pool.query<{
    reason: string;
    primary_article_id: string;
    legacy_generation_id: string;
  }>(
    `SELECT reason,primary_article_id,legacy_generation_id::text
     FROM coverage_bundles WHERE id='ci-pgstore-legacy'`,
  );
  await assert.rejects(
    new WorkerRepository(pool).persistCoverageGeneration({
      matcherVersion: "v2",
      mode: "shadow",
      startedAt: "2026-07-13T08:02:30.000Z",
      completedAt: "2026-07-13T08:03:00.000Z",
      analysis: invalidV2Analysis,
      publicLegacyBundles: [legacyMutation],
    }),
    /fewer than two members/,
  );
  const legacyAfterFailure = await pool.query<{
    reason: string;
    primary_article_id: string;
    legacy_generation_id: string;
  }>(
    `SELECT reason,primary_article_id,legacy_generation_id::text
     FROM coverage_bundles WHERE id='ci-pgstore-legacy'`,
  );
  assert.deepEqual(legacyAfterFailure.rows, legacyBeforeFailure.rows);

  const writerClient = await pool.connect();
  const competingPromotionClient = await pool.connect();
  try {
    await writerClient.query("BEGIN");
    await writerClient.query("SELECT pg_advisory_xact_lock(20260713, 7)");
    const pendingGeneration = await writerClient.query<{ id: string }>(
      `INSERT INTO coverage_bundle_generations
         (matcher_version,mode,status,started_at,article_count)
       VALUES ('v2','shadow','running',now(),2) RETURNING id`,
    );
    await writerClient.query(
      `UPDATE coverage_bundles
       SET reason='mid-cycle mutation',primary_article_id=$1,legacy_generation_id=$2
       WHERE id='ci-pgstore-legacy'`,
      [articleB.id, pendingGeneration.rows[0]!.id],
    );

    await competingPromotionClient.query("BEGIN");
    await competingPromotionClient.query("SET LOCAL statement_timeout = '200ms'");
    await assert.rejects(
      competingPromotionClient.query("SELECT pg_advisory_xact_lock(20260713, 7)"),
      /statement timeout/,
    );
    await competingPromotionClient.query("ROLLBACK");
    const externallyVisibleLegacy = await pool.query<{
      reason: string;
      primary_article_id: string;
      legacy_generation_id: string;
    }>(
      `SELECT reason,primary_article_id,legacy_generation_id::text
       FROM coverage_bundles WHERE id='ci-pgstore-legacy'`,
    );
    assert.deepEqual(externallyVisibleLegacy.rows, legacyBeforeFailure.rows);
    await writerClient.query("ROLLBACK");
  } finally {
    competingPromotionClient.release();
    writerClient.release();
  }
  await pool.query(
    `INSERT INTO coverage_bundles
       (id, kind, confidence, reason, generated_at, last_seen_at, primary_article_id,
        member_article_ids, source_ids, source_labels, payload, state, matcher_version,
        legacy_generation_id)
     VALUES
       ('ci-pgstore-v2','incident','high','Paired normalized snapshot',$1,$1,$2,$3,$4,$5,
        '{}'::jsonb,'shadow','v2',NULL)`,
    [
      "2026-07-13T08:02:00.000Z",
      articleA.id,
      [articleA.id, articleB.id],
      [articleA.source, articleB.source],
      [articleA.sourceLabel, articleB.sourceLabel],
    ],
  );
  await pool.query(
    `UPDATE coverage_bundles
     SET generation_id=$1, match_tier='strong', match_score=0.95,
         match_rationale='CI PgStore lifecycle smoke', first_seen_at=$2
     WHERE id='ci-pgstore-v2'`,
    [generationId, "2026-07-13T08:02:00.000Z"],
  );
  await pool.query(
    `INSERT INTO coverage_bundle_versions
       (generation_id,bundle_id,kind,confidence,reason,primary_article_id,match_tier,
        match_score,match_rationale,generated_at,last_seen_at,source_ids,source_labels)
     VALUES ($1,'ci-pgstore-v2','incident','high','Paired normalized snapshot',$2,'strong',
             0.95,'CI PgStore lifecycle smoke',$3,$3,$4,$5)`,
    [
      generationId,
      articleA.id,
      "2026-07-13T08:02:00.000Z",
      [articleA.source, articleB.source],
      [articleA.sourceLabel, articleB.sourceLabel],
    ],
  );
  await pool.query(
    `INSERT INTO coverage_bundle_members (generation_id,bundle_id,article_id,role)
     VALUES ($1,'ci-pgstore-v2',$2,'primary'),($1,'ci-pgstore-v2',$3,'supporting')`,
    [generationId, articleA.id, articleB.id],
  );
  await pool.query(
    `INSERT INTO coverage_bundle_edges
       (generation_id,bundle_id,left_article_id,right_article_id,tier,score,kind,status,
        evidence_fingerprint)
     VALUES ($1,'ci-pgstore-v2',$2,$3,'strong',0.95,'incident','accepted','ci-pgstore-edge')`,
    [generationId, articleA.id, articleB.id],
  );
  const promotionClient = await pool.connect();
  try {
    await promotionClient.query("BEGIN");
    await promotionClient.query("SELECT pg_advisory_xact_lock(20260713, 7)");
    await promotionClient.query(
      "UPDATE coverage_bundle_generations SET is_current=false WHERE is_current",
    );
    const promoted = await promotionClient.query(
      `UPDATE coverage_bundle_generations SET mode='active', is_current=true
       WHERE id=$1 AND matcher_version='v2' AND mode='shadow' AND status='completed'`,
      [generationId],
    );
    assert.equal(promoted.rowCount, 1);
    await promotionClient.query(
      "UPDATE coverage_bundles SET state='active' WHERE generation_id=$1",
      [generationId],
    );
    await promotionClient.query("COMMIT");
  } catch (error) {
    await promotionClient.query("ROLLBACK");
    throw error;
  } finally {
    promotionClient.release();
  }

  const store = new PgStore(pool, "normalized-active");
  assert.deepEqual(await store.coverageProjectionReadiness(), {
    generationValid: true,
    parityClean: true,
    integrityErrorCount: 0,
  });
  const membershipCountBeforeReport = await pool.query<{ count: string }>(
    `SELECT count(*)::text FROM coverage_bundle_members WHERE generation_id=$1`,
    [generationId],
  );
  const mergeReportInput = {
    anchorArticleId: articleA.id,
    candidateArticleId: articleB.id,
    anchorArticleIds: [articleA.id],
    candidateArticleIds: [articleB.id],
    anchorStoryId: "ci-pgstore-story-a",
    candidateStoryId: "ci-pgstore-story-b",
    projectionMode: "normalized" as const,
    matcherVersion: "v2" as const,
    generationId,
  };
  const mergeReport = await store.createCoverageMergeReport(mergeReportInput, ownerId);
  const mergeReportReplay = await store.createCoverageMergeReport(
    {
      ...mergeReportInput,
      anchorArticleId: articleB.id,
      candidateArticleId: articleA.id,
      anchorArticleIds: [articleB.id],
      candidateArticleIds: [articleA.id],
    },
    ownerId,
  );
  assert.equal(mergeReportReplay.id, mergeReport.id);
  const mergeReportExport = await store.exportCoverageMergeReports(30);
  assert.equal(
    mergeReportExport.rows.some(({ reportId }) => reportId === mergeReport.id),
    true,
  );
  const membershipCountAfterReport = await pool.query<{ count: string }>(
    `SELECT count(*)::text FROM coverage_bundle_members WHERE generation_id=$1`,
    [generationId],
  );
  assert.deepEqual(membershipCountAfterReport.rows, membershipCountBeforeReport.rows);
  await pool.query(
    `UPDATE coverage_bundles SET member_article_ids=ARRAY[$2,$2]::text[]
     WHERE id='ci-pgstore-v2' AND generation_id=$1`,
    [generationId, articleA.id],
  );
  assert.equal((await store.coverageProjectionReadiness()).integrityErrorCount > 0, true);
  await pool.query(
    `UPDATE coverage_bundles SET member_article_ids=ARRAY[$2,$3]::text[]
     WHERE id='ci-pgstore-v2' AND generation_id=$1`,
    [generationId, articleA.id, articleB.id],
  );

  const supersededGenerationId = "00000000-0000-4000-8000-000000000802";
  const currentShadowGenerationId = "00000000-0000-4000-8000-000000000803";
  await pool.query(
    `INSERT INTO coverage_bundle_generations
       (id,matcher_version,mode,status,started_at,completed_at,article_count,bundle_count,
        edge_count,correction_conflict_count)
     VALUES
       ($1,'v2','shadow','completed',$3,$4,2,1,0,0),
       ($2,'v2','shadow','completed',$4,$5,2,1,0,0)`,
    [
      supersededGenerationId,
      currentShadowGenerationId,
      "2026-07-13T08:02:00.000Z",
      "2026-07-13T08:03:00.000Z",
      "2026-07-13T08:05:00.000Z",
    ],
  );
  await pool.query(
    `INSERT INTO coverage_generation_articles (generation_id,article_id)
     VALUES ($1,$3),($1,$4),($2,$3),($2,$5)`,
    [supersededGenerationId, currentShadowGenerationId, articleA.id, articleB.id, articleC.id],
  );
  await pool.query(
    `INSERT INTO coverage_bundles
       (id,kind,confidence,reason,generated_at,last_seen_at,primary_article_id,
        member_article_ids,source_ids,source_labels,payload,generation_id,state,matcher_version,
        match_tier,match_score,match_rationale,first_seen_at,legacy_generation_id)
     VALUES
       ('ci-pgstore-reused','incident','high','Current reused stable row',$2,$2,$3,$4,$5,$6,
        '{}'::jsonb,$1,'shadow','v2','strong',0.9,'Current reused stable row',$2,NULL),
       ('ci-pgstore-reused-legacy-old','incident','high','Old paired legacy',$7,$7,$3,$8,$9,$10,
        '{}'::jsonb,NULL,'superseded','v1',NULL,NULL,NULL,NULL,$11)`,
    [
      currentShadowGenerationId,
      "2026-07-13T08:05:00.000Z",
      articleA.id,
      [articleA.id, articleC.id],
      [articleA.source, articleC.source],
      [articleA.sourceLabel, articleC.sourceLabel],
      "2026-07-13T08:03:00.000Z",
      [articleA.id, articleB.id],
      [articleA.source, articleB.source],
      [articleA.sourceLabel, articleB.sourceLabel],
      supersededGenerationId,
    ],
  );
  await pool.query(
    `INSERT INTO coverage_bundle_versions
       (generation_id,bundle_id,kind,confidence,reason,primary_article_id,match_tier,match_score,
        match_rationale,generated_at,last_seen_at,source_ids,source_labels)
     VALUES
       ($1,'ci-pgstore-reused','incident','high','Immutable old reused version',$3,'strong',0.9,
        'Immutable old reused version',$5,$5,$6,$7),
       ($2,'ci-pgstore-reused','incident','high','Current reused version',$3,'strong',0.9,
        'Current reused version',$4,$4,$8,$9)`,
    [
      supersededGenerationId,
      currentShadowGenerationId,
      articleA.id,
      "2026-07-13T08:05:00.000Z",
      "2026-07-13T08:03:00.000Z",
      [articleA.source, articleB.source],
      [articleA.sourceLabel, articleB.sourceLabel],
      [articleA.source, articleC.source],
      [articleA.sourceLabel, articleC.sourceLabel],
    ],
  );
  await pool.query(
    `INSERT INTO coverage_bundle_members (generation_id,bundle_id,article_id,role)
     VALUES
       ($1,'ci-pgstore-reused',$3,'primary'),($1,'ci-pgstore-reused',$4,'supporting'),
       ($2,'ci-pgstore-reused',$3,'primary'),($2,'ci-pgstore-reused',$5,'supporting')`,
    [supersededGenerationId, currentShadowGenerationId, articleA.id, articleB.id, articleC.id],
  );
  const superseded = await store.listCoverageBundles({
    projection: "superseded",
    generationId: supersededGenerationId,
    limit: 20,
  });
  const oldReusedBundle = superseded.items.find(({ id }) => id === "ci-pgstore-reused");
  assert.equal(superseded.summary.generation?.id, supersededGenerationId);
  assert.deepEqual(oldReusedBundle?.memberArticleIds.sort(), [articleA.id, articleB.id].sort());
  assert.equal(oldReusedBundle?.updatedAt, "2026-07-13T08:03:00.000Z");

  const exactActive = await store.listCoverageBundles({ projection: "active", limit: 20 });
  assert.deepEqual(
    exactActive.items.find(({ id }) => id === "ci-pgstore-v2")?.memberArticleIds.sort(),
    [articleA.id, articleB.id].sort(),
  );
  assert.equal(
    exactActive.items.some(({ id }) => id === "ci-pgstore-reused"),
    false,
  );
  const beforeFeed = await store.listCityPulseStories({ scope: "trondheim", limit: 20 });
  const beforeStory = beforeFeed.items.find(({ articleIds }) => articleIds.includes(articleA.id));
  assert.deepEqual(beforeStory?.articleIds.sort(), [articleA.id, articleB.id].sort());
  const beforeAudit = await store.listCoverageBundles({ projection: "active", limit: 20 });
  const beforeBundle = beforeAudit.items.find(({ id }) => id === "ci-pgstore-v2");
  assert.deepEqual(beforeBundle?.memberArticleIds.sort(), [articleA.id, articleB.id].sort());

  const split = await store.splitCoverageBundle(
    "ci-pgstore-v2",
    {
      expectedGeneratedAt: beforeBundle!.generatedAt,
      anchorArticleId: articleA.id,
      rejectedArticleIds: [articleB.id],
      reason: "CI actual PgStore split",
    },
    ownerId,
  );
  assert.equal(split.corrections.length, 1);
  const splitFeed = await store.listCityPulseStories({ scope: "trondheim", limit: 20 });
  assert.equal(
    splitFeed.items.some(
      ({ articleIds }) => articleIds.includes(articleA.id) && articleIds.includes(articleB.id),
    ),
    false,
  );
  const splitAudit = await store.listCoverageBundles({ projection: "active", limit: 20 });
  assert.equal(splitAudit.summary.activeCorrectionCount, 1);
  assert.equal(
    splitAudit.items.some(
      ({ correctionTombstone, memberArticleIds }) =>
        correctionTombstone === true &&
        memberArticleIds.includes(articleA.id) &&
        memberArticleIds.includes(articleB.id),
    ),
    true,
  );

  await store.undoCoverageCorrection(split.corrections[0]!.id, ownerId);
  const restoredFeed = await store.listCityPulseStories({ scope: "trondheim", limit: 20 });
  assert.equal(
    restoredFeed.items.some(
      ({ articleIds }) => articleIds.includes(articleA.id) && articleIds.includes(articleB.id),
    ),
    true,
  );
  const restoredAudit = await store.listCoverageBundles({ projection: "active", limit: 20 });
  assert.equal(
    restoredAudit.items.some(
      ({ memberArticleIds }) =>
        memberArticleIds.includes(articleA.id) && memberArticleIds.includes(articleB.id),
    ),
    true,
  );

  const currentBeforeDirtyCandidate = await pool.query<{ id: string }>(
    `SELECT id::text FROM coverage_bundle_generations WHERE is_current`,
  );
  const dirtyAnalysis: ArticleCoverageAnalysis = {
    // The duplicate snapshot identity forces the generation/article count integrity guard to fail
    // without conflating an intentional v1/v2 matcher difference with storage parity.
    articles: [articleA, articleB, articleA],
    bundles: [
      {
        id: "ci-dirty-candidate-v2",
        kind: "incident",
        confidence: "high",
        reason: "Dirty candidate normalized",
        generatedAt: "2026-07-13T08:07:00.000Z",
        matcherVersion: "v2",
        matchConfidence: { tier: "strong", score: 0.95, rationale: "Dirty candidate" },
        primaryArticleId: articleA.id,
        memberArticleIds: [articleA.id, articleB.id],
        sourceIds: [articleA.source, articleB.source],
        sourceLabels: [articleA.sourceLabel, articleB.sourceLabel],
        signals: [],
        nearMisses: [],
      },
    ],
    nearMisses: [],
    edges: [
      {
        articleIds: [articleA.id, articleB.id],
        tier: "strong",
        score: 0.95,
        kind: "incident",
        positiveIncidentEvidence: ["shared_specific_place"],
        signals: [],
        conflicts: [],
        evidenceFingerprint: "ci-dirty-edge",
        reviewable: false,
        correctionConflict: false,
      },
    ],
  };
  const dirtyLegacy: ArticleCoverageBundleDecision = {
    ...dirtyAnalysis.bundles[0]!,
    id: "ci-dirty-candidate-legacy",
    matcherVersion: "v1",
    matchConfidence: undefined,
    primaryArticleId: articleB.id,
  };
  await assert.rejects(
    new WorkerRepository(pool).persistCoverageGeneration({
      matcherVersion: "v2",
      mode: "active",
      startedAt: "2026-07-13T08:06:59.000Z",
      completedAt: "2026-07-13T08:07:00.000Z",
      analysis: dirtyAnalysis,
      publicLegacyBundles: [dirtyLegacy],
    }),
    /failed parity or integrity validation/,
  );
  assert.deepEqual(
    (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM coverage_bundle_generations WHERE is_current`,
      )
    ).rows,
    currentBeforeDirtyCandidate.rows,
  );

  const splitBeforeAdvanceBundle = restoredAudit.items.find(
    ({ memberArticleIds }) =>
      memberArticleIds.includes(articleA.id) && memberArticleIds.includes(articleB.id),
  )!;
  const splitBeforeAdvance = await store.splitCoverageBundle(
    splitBeforeAdvanceBundle.id,
    {
      expectedGeneratedAt: splitBeforeAdvanceBundle.generatedAt,
      expectedProjectionRevision: splitBeforeAdvanceBundle.correctionTarget!.projectionRevision,
      originalBundleId: splitBeforeAdvanceBundle.correctionTarget!.originalBundleId,
      anchorArticleId: articleA.id,
      rejectedArticleIds: [articleB.id],
    },
    ownerId,
  );
  const advancedGenerationId = await persistActiveGeneration({
    completedAt: "2026-07-13T08:08:00.000Z",
    articles: [articleA, articleB],
  });
  const advancedSplitAudit = await store.listCoverageBundles({ projection: "active", limit: 20 });
  assert.equal(advancedSplitAudit.summary.generation?.id, advancedGenerationId);
  assert.equal(advancedSplitAudit.summary.activeCorrectionCount, 1);
  const undoAfterAdvance = await store.undoCoverageCorrection(
    splitBeforeAdvance.corrections[0]!.id,
    ownerId,
  );
  assert.equal(
    undoAfterAdvance.replacementStories[0]?.coverageBundle?.generatedAt,
    "2026-07-13T08:08:00.000Z",
  );
  assert.equal(
    undoAfterAdvance.replacementStories.some(
      ({ articleIds }) => articleIds.includes(articleA.id) && articleIds.includes(articleB.id),
    ),
    true,
  );

  const articleCGrouped: Article = {
    ...articleC,
    title: "Tredje melding om brann i lagerbygning på Tiller",
    excerpt: "Samme lagerbygning og samme nødetatshendelse på Tiller.",
    situationId: "ci-pgstore-three-way",
  };
  const articleAGrouped = { ...articleA, situationId: "ci-pgstore-three-way" };
  const articleBGrouped = { ...articleB, situationId: "ci-pgstore-three-way" };
  for (const article of [articleAGrouped, articleBGrouped, articleCGrouped]) {
    await pool.query(`UPDATE articles SET payload=$2 WHERE id=$1`, [article.id, article]);
  }
  const sequentialGenerationId = await persistActiveGeneration({
    completedAt: "2026-07-13T08:09:00.000Z",
    articles: [articleAGrouped, articleBGrouped, articleCGrouped],
  });
  const sequentialBase = (
    await store.listCoverageBundles({ projection: "active", limit: 20 })
  ).items.find(
    ({ memberArticleIds }) =>
      memberArticleIds.includes(articleA.id) &&
      memberArticleIds.includes(articleB.id) &&
      memberArticleIds.includes(articleC.id),
  )!;
  await store.splitCoverageBundle(
    sequentialBase.id,
    {
      expectedGeneratedAt: sequentialBase.generatedAt,
      expectedProjectionRevision: sequentialBase.correctionTarget!.projectionRevision,
      originalBundleId: sequentialBase.correctionTarget!.originalBundleId,
      anchorArticleId: articleA.id,
      rejectedArticleIds: [articleC.id],
    },
    ownerId,
  );
  const afterFirstSequential = await store.listCoverageBundles({
    projection: "active",
    limit: 20,
  });
  const derivedPair = afterFirstSequential.items.find(
    ({ memberArticleIds }) =>
      memberArticleIds.includes(articleA.id) && memberArticleIds.includes(articleB.id),
  )!;
  assert.equal(
    derivedPair.correctionTarget?.originalBundleId,
    sequentialBase.correctionTarget?.originalBundleId,
  );
  const staleDerivedInput = {
    expectedGeneratedAt: derivedPair.generatedAt,
    expectedProjectionRevision: derivedPair.correctionTarget!.projectionRevision,
    originalBundleId: derivedPair.correctionTarget!.originalBundleId,
    anchorArticleId: articleA.id,
    rejectedArticleIds: [articleB.id],
  };
  const secondSequential = await store.splitCoverageBundle(
    derivedPair.id,
    staleDerivedInput,
    ownerId,
  );
  const replaySequential = await store.splitCoverageBundle(
    derivedPair.id,
    staleDerivedInput,
    ownerId,
  );
  assert.equal(replaySequential.corrections[0]?.id, secondSequential.corrections[0]?.id);

  await pool.query(
    `INSERT INTO articles
       (id,canonical_url,dedupe_key,source,published_at,scope,category,payload)
     SELECT 'ci-perf-'||value,
            'https://example.test/ci-perf-'||value,
            'ci-perf-'||value,
            'nrk',
            '2026-07-10T00:00:00Z'::timestamptz-(value||' minutes')::interval,
            'trondheim','Nyheter',
            jsonb_build_object(
              'id','ci-perf-'||value,'source','nrk','sourceLabel','NRK Trøndelag',
              'title','Unik ytelsessak '||value,'excerpt','Isolert sanitert innhold '||value,
              'url','https://example.test/ci-perf-'||value,
              'publishedAt',to_char('2026-07-10T00:00:00Z'::timestamptz-(value||' minutes')::interval,
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'scope','trondheim','category','Nyheter','places',jsonb_build_array('Sted '||value)
            )
     FROM generate_series(1,250) value`,
  );
  await pool.query(
    `INSERT INTO coverage_generation_articles (generation_id,article_id)
     SELECT $1,id FROM articles WHERE id LIKE 'ci-perf-%'`,
    [sequentialGenerationId],
  );
  await pool.query(
    `UPDATE coverage_bundle_generations
     SET article_count=(SELECT count(*) FROM coverage_generation_articles WHERE generation_id=$1)
     WHERE id=$1`,
    [sequentialGenerationId],
  );
  let queryCount = 0;
  let materializationCount = 0;
  const recordQuery = (query: string | pg.QueryConfig) => {
    queryCount += 1;
    const sql = typeof query === "string" ? query : query.text;
    if (sql.includes("AS member_articles") && sql.includes("FROM coverage_bundle_versions cbv")) {
      materializationCount += 1;
    }
  };
  const countingPool = {
    query: (...args: Parameters<pg.Pool["query"]>) => {
      recordQuery(args[0]);
      return (
        pool.query as (...queryArgs: Parameters<pg.Pool["query"]>) => ReturnType<pg.Pool["query"]>
      )(...args);
    },
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (...args: Parameters<pg.PoolClient["query"]>) => {
          recordQuery(args[0]);
          return (
            client.query as (
              ...queryArgs: Parameters<pg.PoolClient["query"]>
            ) => ReturnType<pg.PoolClient["query"]>
          )(...args);
        },
        release: (destroy?: boolean) => client.release(destroy),
      };
    },
  } as unknown as pg.Pool;
  const performanceStore = new PgStore(countingPool, "normalized-active");
  const performanceStartedAt = performance.now();
  await Promise.all(
    Array.from({ length: 5 }, () =>
      performanceStore.listCoverageBundles({ projection: "active", limit: 30 }),
    ),
  );
  const coldQueryCount = queryCount;
  assert.equal(materializationCount, 1);
  await performanceStore.listCoverageBundles({ projection: "active", limit: 30 });
  const elapsedMs = performance.now() - performanceStartedAt;
  assert.equal(materializationCount, 1);
  assert.equal(queryCount > coldQueryCount, true);
  assert.equal(elapsedMs < 5_000, true);

  const legacy = await store.listCoverageBundles({ projection: "legacy", limit: 20 });
  assert.equal(
    legacy.items.some(({ id }) => id === "ci-pgstore-legacy"),
    false,
  );
  assert.equal(legacy.items.length > 0, true);
  console.log(
    `coverage worker atomicity, dirty-candidate quarantine, non-mutating merge reports, ` +
      `current-generation corrections, ` +
      `and bounded projection performance smoke passed (${Math.round(elapsedMs)}ms, ` +
      `${coldQueryCount} cold queries, one materialization)`,
  );
} finally {
  await pool.end();
}
