import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  articleCoverageEvidence,
  comparePublicHomeSituations,
  publicLeadLongRunningSituationAgeMs,
  shouldFeaturePublicHomeSituation,
} from "@nytt/shared";
import type {
  AiProcessingRun,
  Article,
  ArticleCoverageAnalysis,
  ArticleCoverageBundleDecision,
  ArticleCoverageBundleKind,
  CoverageRejectedPair,
  HomeSituationSummary,
  MorningBrief,
  NotificationTriggerCandidate,
  NotificationTriggerKind,
  NotificationTriggerSeverity,
  OfficialEvent,
  PersistedTrafficMapEvent,
  PersistedTrafficMapEventSource,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  RoadCamera,
  RoadWeatherObservation,
  Situation,
  SourceItemInput,
  SourceHealth,
  SourceCollectorRun,
  TrafficCounterSnapshot,
  TrafficMapEvent,
  TrafficPulseCorridor,
  UserRole,
  WorkerCycleMetrics,
} from "@nytt/shared";

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

export interface PersistCoverageGenerationInput {
  matcherVersion: "v2";
  mode: "shadow" | "active";
  startedAt: string;
  completedAt: string;
  analysis: ArticleCoverageAnalysis;
  publicLegacyBundles: ArticleCoverageBundleDecision[];
  correctionRevisionSnapshot?: number;
  correctionConflictCount?: number;
  activeVolumeGuard?: {
    minimumArticleCount: number;
    minimumPreviousRatio: number;
    allowUnsafeOverride: boolean;
  };
}

interface StoredArticleIdentity {
  incomingId: string;
  storedId: string;
  canonicalUrl: string;
  situationId?: string;
}

// Shared with the deployment promotion transaction. Both paths serialize changes to the current
// coverage generation with PostgreSQL transaction-scoped advisory lock (20260713, 7).
export const coverageGenerationAdvisoryLockKey = [20260713, 7] as const;

export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertLegacyCoverageBundles(
  queryable: Queryable,
  bundles: ArticleCoverageBundleDecision[],
  seenAt: string,
  legacyGenerationId: string | null,
): Promise<void> {
  for (const bundle of bundles) {
    await queryable.query(
      `INSERT INTO coverage_bundles
        (id, kind, confidence, reason, generated_at, last_seen_at, primary_article_id,
         member_article_ids, source_ids, source_labels, signals, near_misses, payload,
         generation_id, state, matcher_version, legacy_generation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,'legacy','v1',$14)
       ON CONFLICT (id) DO UPDATE SET
         kind=EXCLUDED.kind,
         confidence=EXCLUDED.confidence,
         reason=EXCLUDED.reason,
         generated_at=EXCLUDED.generated_at,
         last_seen_at=EXCLUDED.last_seen_at,
         primary_article_id=EXCLUDED.primary_article_id,
         member_article_ids=EXCLUDED.member_article_ids,
         source_ids=EXCLUDED.source_ids,
         source_labels=EXCLUDED.source_labels,
         signals=EXCLUDED.signals,
         near_misses=EXCLUDED.near_misses,
         payload=EXCLUDED.payload,
         generation_id=NULL,
         state='legacy',
         matcher_version='v1',
         legacy_generation_id=EXCLUDED.legacy_generation_id,
         updated_at=now()`,
      [
        bundle.id,
        bundle.kind,
        bundle.confidence,
        bundle.reason,
        bundle.generatedAt,
        seenAt,
        bundle.primaryArticleId,
        bundle.memberArticleIds,
        bundle.sourceIds,
        bundle.sourceLabels,
        JSON.stringify(bundle.signals),
        JSON.stringify(bundle.nearMisses),
        JSON.stringify(bundle),
        legacyGenerationId,
      ],
    );
  }
  await queryable.query(
    `UPDATE coverage_projection_revisions
     SET legacy_revision=legacy_revision+1, updated_at=now()
     WHERE projection='active'`,
  );
}

async function insertPairedLegacyCoverageBundles(
  queryable: Queryable,
  bundles: ArticleCoverageBundleDecision[],
  seenAt: string,
  generationId: string,
): Promise<void> {
  for (const bundle of bundles) {
    await queryable.query(
      `INSERT INTO coverage_bundles
        (id, kind, confidence, reason, generated_at, last_seen_at, primary_article_id,
         member_article_ids, source_ids, source_labels, signals, near_misses, payload,
         generation_id, state, matcher_version, legacy_generation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,'superseded','v1',$14)`,
      [
        `coverage:paired:${generationId}:${bundle.id}`,
        bundle.kind,
        bundle.confidence,
        bundle.reason,
        bundle.generatedAt,
        seenAt,
        bundle.primaryArticleId,
        bundle.memberArticleIds,
        bundle.sourceIds,
        bundle.sourceLabels,
        JSON.stringify(bundle.signals),
        JSON.stringify(bundle.nearMisses),
        JSON.stringify(bundle),
        generationId,
      ],
    );
  }
}

type CoverageBundleIdentity = {
  id: string;
  kind: ArticleCoverageBundleKind;
  memberArticleIds: string[];
};

function coverageBundleIdentityKey(bundle: CoverageBundleIdentity): string {
  return `${bundle.id}\u0000${bundle.kind}\u0000${[...bundle.memberArticleIds].sort().join("\u0000")}`;
}

function remappedCoverageBundleId(bundle: CoverageBundleIdentity, attempt: number): string {
  const value = `split\u0000${coverageBundleIdentityKey(bundle)}\u0000${attempt}`;
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `coverage:v2:${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

export function reuseCoverageBundleIds<T extends CoverageBundleIdentity>(
  candidates: T[],
  previous: CoverageBundleIdentity[],
): T[];
export function reuseCoverageBundleIds<T extends CoverageBundleIdentity>(
  candidates: T[],
  previous: T[],
): T[];
export function reuseCoverageBundleIds<T extends CoverageBundleIdentity>(
  candidates: T[],
  previous: CoverageBundleIdentity[],
): T[] {
  const previousIds = new Set(previous.map(({ id }) => id));
  const candidateKeys = candidates.map(coverageBundleIdentityKey);
  const availablePrevious = new Set(previousIds);
  const assignments = new Map<number, string>();
  const options = candidates
    .flatMap((candidate, candidateIndex) =>
      previous.flatMap((prior) => {
        if (candidate.kind !== prior.kind) return [];
        const priorMembers = new Set(prior.memberArticleIds);
        const sharedCount = candidate.memberArticleIds.filter((id) => priorMembers.has(id)).length;
        const threshold = Math.ceil(
          Math.min(candidate.memberArticleIds.length, prior.memberArticleIds.length) / 2,
        );
        return sharedCount >= threshold
          ? [
              {
                candidateIndex,
                candidateKey: candidateKeys[candidateIndex]!,
                previousId: prior.id,
                sharedCount,
              },
            ]
          : [];
      }),
    )
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));

  for (const option of options.filter(
    ({ candidateIndex, previousId }) => candidates[candidateIndex]!.id === previousId,
  )) {
    if (assignments.has(option.candidateIndex) || !availablePrevious.has(option.previousId)) {
      continue;
    }
    assignments.set(option.candidateIndex, option.previousId);
    availablePrevious.delete(option.previousId);
  }

  for (const option of [...options].sort(
    (left, right) =>
      right.sharedCount - left.sharedCount ||
      left.previousId.localeCompare(right.previousId) ||
      left.candidateKey.localeCompare(right.candidateKey),
  )) {
    if (assignments.has(option.candidateIndex) || !availablePrevious.has(option.previousId))
      continue;
    assignments.set(option.candidateIndex, option.previousId);
    availablePrevious.delete(option.previousId);
  }

  const finalIds = new Map<number, string>();
  const usedIds = new Set<string>();
  [...assignments]
    .sort(([leftIndex], [rightIndex]) =>
      candidateKeys[leftIndex]!.localeCompare(candidateKeys[rightIndex]!),
    )
    .forEach(([candidateIndex, id]) => {
      finalIds.set(candidateIndex, id);
      usedIds.add(id);
    });

  candidates
    .map((candidate, candidateIndex) => ({
      candidate,
      candidateIndex,
      candidateKey: candidateKeys[candidateIndex]!,
    }))
    .filter(({ candidateIndex }) => !finalIds.has(candidateIndex))
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey))
    .forEach(({ candidate, candidateIndex }) => {
      let id = candidate.id;
      let attempt = 0;
      while (usedIds.has(id) || previousIds.has(id)) {
        id = remappedCoverageBundleId(candidate, attempt);
        attempt += 1;
      }
      finalIds.set(candidateIndex, id);
      usedIds.add(id);
    });

  const remapped = candidates.map((candidate, index) => ({
    ...candidate,
    memberArticleIds: [...candidate.memberArticleIds],
    id: finalIds.get(index)!,
  }));
  if (new Set(remapped.map(({ id }) => id)).size !== remapped.length) {
    throw new Error("Coverage bundle ID remapping produced duplicate IDs");
  }
  return remapped;
}

function morningBriefStorageId(generatedAt: string): string {
  const osloDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(generatedAt));
  return `morning:${osloDate}`;
}

export interface TrafficMapEventUpsertOptions {
  source: PersistedTrafficMapEventSource;
  fetchedAt: string;
}

export interface TrafficMapEventListFilters {
  source?: PersistedTrafficMapEventSource;
  states?: TrafficMapEvent["state"][];
}

export interface PublicTransportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface PushDeliveryTarget {
  id: string;
  userId: string;
  role: UserRole;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  minSeverity: NotificationTriggerSeverity;
  kinds: NotificationTriggerKind[];
}

export interface PushDeliveryClaim {
  id: string;
}

export class WorkerRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, work);
  }

  async upsertCoverageArticles(articles: Article[]): Promise<void> {
    for (const article of articles) {
      const values = [
        article.id,
        article.url,
        articleDedupeKey(article),
        article.source,
        article.publishedAt,
        article.scope,
        article.category,
        article,
      ];
      const updated = await this.pool.query(
        `UPDATE articles SET canonical_url=$2, dedupe_key=$3, source=$4, published_at=$5,
         scope=$6, category=$7,
         payload=$8::jsonb
           || CASE WHEN payload ? 'situationId'
             THEN jsonb_build_object('situationId', payload->'situationId')
             ELSE '{}'::jsonb END
         WHERE id=$1
         AND NOT EXISTS (
           SELECT 1 FROM articles duplicate
           WHERE duplicate.id <> $1
           AND (duplicate.canonical_url=$2 OR duplicate.dedupe_key=$3)
         )`,
        values,
      );
      if ((updated.rowCount ?? 0) === 0) {
        await this.pool.query(
          `INSERT INTO articles (id, canonical_url, dedupe_key, source, published_at, scope, category, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT DO NOTHING`,
          values,
        );
      }
    }
  }

  async recordArticleSourceItems(articles: Article[]): Promise<void> {
    const fetchedAt = new Date().toISOString();
    for (const article of articles) {
      await this.upsertSourceItem(articleSourceItemInput(article, fetchedAt));
    }
  }

  async upsertArticles(articles: Article[]): Promise<void> {
    await this.upsertCoverageArticles(articles);
    await this.recordArticleSourceItems(articles);
  }

  async canonicalizeCoverageArticles(articles: Article[]): Promise<Article[]> {
    if (articles.length === 0) return [];
    const dedupeKeys = articles.map(articleDedupeKey);
    const result = await this.pool.query<StoredArticleIdentity>(
      `WITH incoming AS (
         SELECT *
         FROM unnest($1::text[], $2::text[], $3::text[])
           AS item(id, canonical_url, dedupe_key)
       )
       SELECT incoming.id AS "incomingId",
              stored.id AS "storedId",
              stored.canonical_url AS "canonicalUrl",
              stored.payload->>'situationId' AS "situationId"
       FROM incoming
       JOIN LATERAL (
         SELECT article.id, article.canonical_url, article.payload
         FROM articles article
         WHERE article.id=incoming.id
            OR article.canonical_url=incoming.canonical_url
            OR article.dedupe_key=incoming.dedupe_key
         ORDER BY (article.id=incoming.id) DESC,
                  (article.canonical_url=incoming.canonical_url) DESC,
                  article.id
         LIMIT 1
       ) stored ON true`,
      [articles.map(({ id }) => id), articles.map(({ url }) => url), dedupeKeys],
    );
    const storedByIncomingId = new Map(result.rows.map((row) => [row.incomingId, row]));
    const ranked = articles
      .map((article, index) => {
        const stored = storedByIncomingId.get(article.id);
        return {
          article,
          index,
          dedupeKey: dedupeKeys[index]!,
          stored,
          resolved: stored
            ? {
                ...article,
                id: stored.storedId,
                url: stored.storedId === article.id ? article.url : stored.canonicalUrl,
                situationId: article.situationId ?? stored.situationId,
              }
            : article,
        };
      })
      .sort(
        (left, right) =>
          Number(Boolean(right.stored)) - Number(Boolean(left.stored)) ||
          Number(right.stored?.storedId === right.article.id) -
            Number(left.stored?.storedId === left.article.id) ||
          left.resolved.id.localeCompare(right.resolved.id) ||
          left.article.id.localeCompare(right.article.id),
      );
    const claimed = new Set<string>();
    const canonical = ranked.flatMap((candidate) => {
      const keys = [
        `id:${candidate.resolved.id}`,
        `url:${candidate.resolved.url}`,
        `dedupe:${candidate.dedupeKey}`,
      ];
      if (keys.some((key) => claimed.has(key))) return [];
      keys.forEach((key) => claimed.add(key));
      return [candidate];
    });
    return canonical
      .sort((left, right) => left.index - right.index)
      .map(({ resolved }) => resolved);
  }

  async upsertCoverageBundles(
    bundles: ArticleCoverageBundleDecision[],
    seenAt = new Date().toISOString(),
  ): Promise<void> {
    await upsertLegacyCoverageBundles(this.pool, bundles, seenAt, null);
  }

  async activeCoverageRejectedPairs(): Promise<{
    revision: number;
    pairs: CoverageRejectedPair[];
  }> {
    const result = await this.pool.query<{
      id: string;
      anchor_article_id: string;
      rejected_article_id: string;
      revision: number | string;
    }>(
      `SELECT cbc.id, cbc.anchor_article_id, cbc.rejected_article_id, revision.revision
       FROM coverage_projection_revisions revision
       LEFT JOIN coverage_bundle_corrections cbc ON cbc.status='active'
       WHERE revision.projection='active'
       ORDER BY cbc.created_at, cbc.id`,
    );
    return {
      revision: Number(result.rows[0]?.revision ?? 0),
      pairs: result.rows.flatMap((row) =>
        row.id
          ? [
              {
                articleIds: [row.anchor_article_id, row.rejected_article_id] as [string, string],
                correctionId: row.id,
              },
            ]
          : [],
      ),
    };
  }

  async persistCoverageGeneration(input: PersistCoverageGenerationInput): Promise<string> {
    let generationId: string;
    try {
      generationId = await withTransaction(this.pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1,$2)", [
          coverageGenerationAdvisoryLockKey[0],
          coverageGenerationAdvisoryLockKey[1],
        ]);
        if (input.mode === "active") {
          const currentResult = await client.query<{ id: string; article_count: number | string }>(
            `SELECT id, article_count
             FROM coverage_bundle_generations
             WHERE is_current AND status='completed' AND mode='active'
             FOR UPDATE`,
          );
          const guard = input.activeVolumeGuard ?? {
            minimumArticleCount: 1,
            minimumPreviousRatio: 0.5,
            allowUnsafeOverride: false,
          };
          const previousCount = Number(currentResult.rows[0]?.article_count ?? 0);
          const currentCount = input.analysis.articles.length;
          if (
            !guard.allowUnsafeOverride &&
            (currentCount < guard.minimumArticleCount ||
              (previousCount > 0 && currentCount / previousCount < guard.minimumPreviousRatio))
          ) {
            throw new Error("Coverage active candidate volume guard rejected the generation");
          }
        }
        const generation = await client.query<{ id: string }>(
          `INSERT INTO coverage_bundle_generations
            (matcher_version, mode, status, started_at, article_count)
           VALUES ($1,$2,'running',$3,$4)
           RETURNING id`,
          [input.matcherVersion, input.mode, input.startedAt, input.analysis.articles.length],
        );
        const generationId = generation.rows[0]?.id;
        if (!generationId) throw new Error("Coverage generation insert returned no id");

        for (const bundle of input.analysis.bundles) {
          if (bundle.memberArticleIds.length < 2) {
            throw new Error(`Coverage bundle ${bundle.id} has fewer than two members`);
          }
          if (!bundle.memberArticleIds.includes(bundle.primaryArticleId)) {
            throw new Error(`Coverage bundle ${bundle.id} has no primary member`);
          }
          if (!bundle.matchConfidence) {
            throw new Error(`Coverage bundle ${bundle.id} has no match confidence`);
          }
        }

        // Keep the user-facing v1 projection independent from the legacy-shaped serialization
        // used to prove that the normalized v2 rows round-trip without loss. Matcher changes are
        // owner-review diagnostics, not storage-parity failures.
        await upsertLegacyCoverageBundles(
          client,
          input.publicLegacyBundles,
          input.completedAt,
          null,
        );
        await insertPairedLegacyCoverageBundles(
          client,
          input.analysis.bundles,
          input.completedAt,
          generationId,
        );

        const articleIds = [...new Set(input.analysis.articles.map(({ id }) => id))];
        const storedArticles = await client.query<{ id: string }>(
          "SELECT id FROM articles WHERE id = ANY($1::text[])",
          [articleIds],
        );
        const storedIds = new Set(storedArticles.rows.map(({ id }) => id));
        if (articleIds.some((id) => !storedIds.has(id))) {
          throw new Error("Coverage generation references articles that are not stored");
        }
        for (const articleId of articleIds) {
          await client.query(
            `INSERT INTO coverage_generation_articles (generation_id, article_id)
             VALUES ($1,$2)`,
            [generationId, articleId],
          );
        }
        for (const bundle of input.analysis.bundles) {
          if (bundle.memberArticleIds.some((id) => !storedIds.has(id))) {
            throw new Error(`Coverage bundle ${bundle.id} references an unstored article`);
          }
        }

        const previousRows = await client.query<{
          id: string;
          kind: ArticleCoverageBundleKind;
          memberArticleIds: string[];
          generationId: string;
        }>(
          `WITH previous_generation AS (
             SELECT id
             FROM coverage_bundle_generations
             WHERE mode=$1 AND status='completed'
             ORDER BY completed_at DESC, id DESC
             LIMIT 1
           )
           SELECT cbv.bundle_id AS id, cbv.kind,
                  array_agg(cbm.article_id ORDER BY cbm.article_id) AS "memberArticleIds",
                  cbv.generation_id AS "generationId"
           FROM previous_generation pg
           JOIN coverage_bundle_versions cbv ON cbv.generation_id=pg.id
           JOIN coverage_bundle_members cbm
             ON cbm.generation_id=cbv.generation_id AND cbm.bundle_id=cbv.bundle_id
           GROUP BY cbv.generation_id, cbv.bundle_id, cbv.kind
           ORDER BY cbv.bundle_id`,
          [input.mode],
        );
        const previousGenerationId = previousRows.rows[0]?.generationId;
        const bundles = reuseCoverageBundleIds(
          input.analysis.bundles,
          previousRows.rows.map(({ id, kind, memberArticleIds }) => ({
            id,
            kind,
            memberArticleIds,
          })),
        );
        if (new Set(bundles.map(({ id }) => id)).size !== bundles.length) {
          throw new Error(
            "Coverage generation contains duplicate bundle IDs after stable-ID reuse",
          );
        }

        if (previousGenerationId) {
          await client.query(
            `UPDATE coverage_bundles
             SET state = 'superseded', updated_at=now()
             WHERE generation_id=$1`,
            [previousGenerationId],
          );
        }

        const bundleByArticle = new Map<string, string>();
        for (const bundle of bundles) {
          for (const articleId of bundle.memberArticleIds)
            bundleByArticle.set(articleId, bundle.id);
          const match = bundle.matchConfidence;
          if (!match) throw new Error(`Coverage bundle ${bundle.id} has no match confidence`);
          const state = input.mode === "active" ? "active" : "shadow";
          await client.query(
            `INSERT INTO coverage_bundles
              (id, kind, confidence, reason, generated_at, last_seen_at, primary_article_id,
               member_article_ids, source_ids, source_labels, signals, near_misses, payload,
               generation_id, state, matcher_version, match_tier, match_score, match_rationale,
               first_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$5)
             ON CONFLICT (id) DO UPDATE SET
               kind=EXCLUDED.kind, confidence=EXCLUDED.confidence, reason=EXCLUDED.reason,
               generated_at=EXCLUDED.generated_at, last_seen_at=EXCLUDED.last_seen_at,
               primary_article_id=EXCLUDED.primary_article_id,
               member_article_ids=EXCLUDED.member_article_ids, source_ids=EXCLUDED.source_ids,
               source_labels=EXCLUDED.source_labels, signals=EXCLUDED.signals,
               near_misses=EXCLUDED.near_misses, payload=EXCLUDED.payload,
               generation_id=EXCLUDED.generation_id, state=EXCLUDED.state,
               matcher_version=EXCLUDED.matcher_version, match_tier=EXCLUDED.match_tier,
               match_score=EXCLUDED.match_score, match_rationale=EXCLUDED.match_rationale,
               first_seen_at=COALESCE(coverage_bundles.first_seen_at, EXCLUDED.first_seen_at),
               updated_at=now()`,
            [
              bundle.id,
              bundle.kind,
              bundle.confidence,
              bundle.reason,
              bundle.generatedAt,
              input.completedAt,
              bundle.primaryArticleId,
              bundle.memberArticleIds,
              bundle.sourceIds,
              bundle.sourceLabels,
              JSON.stringify(bundle.signals),
              JSON.stringify(bundle.nearMisses),
              JSON.stringify(bundle),
              generationId,
              state,
              input.matcherVersion,
              match.tier,
              match.score,
              match.rationale,
            ],
          );
          await client.query(
            `INSERT INTO coverage_bundle_versions
              (generation_id, bundle_id, kind, confidence, reason, primary_article_id, match_tier,
               match_score, match_rationale, generated_at, last_seen_at, source_ids, source_labels)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              generationId,
              bundle.id,
              bundle.kind,
              bundle.confidence,
              bundle.reason,
              bundle.primaryArticleId,
              match.tier,
              match.score,
              match.rationale,
              bundle.generatedAt,
              input.completedAt,
              bundle.sourceIds,
              bundle.sourceLabels,
            ],
          );
          for (const articleId of bundle.memberArticleIds) {
            const admittedByArticleIds = (input.analysis.edges ?? [])
              .filter(
                (edge) =>
                  !edge.reviewable &&
                  edge.tier !== "weak" &&
                  edge.articleIds.includes(articleId) &&
                  edge.articleIds.every((id) => bundle.memberArticleIds.includes(id)),
              )
              .map((edge) => edge.articleIds.find((id) => id !== articleId))
              .filter((id): id is string => Boolean(id))
              .sort()
              .slice(0, 2);
            await client.query(
              `INSERT INTO coverage_bundle_members
                (generation_id, bundle_id, article_id, role, admitted_by_article_ids)
               VALUES ($1,$2,$3,$4,$5)`,
              [
                generationId,
                bundle.id,
                articleId,
                articleId === bundle.primaryArticleId ? "primary" : "supporting",
                admittedByArticleIds,
              ],
            );
          }
        }

        for (const edge of input.analysis.edges ?? []) {
          const [leftArticleId, rightArticleId] = [...edge.articleIds].sort() as [string, string];
          const leftArticle = input.analysis.articles.find(({ id }) => id === leftArticleId);
          const rightArticle = input.analysis.articles.find(({ id }) => id === rightArticleId);
          if (!leftArticle || !rightArticle) {
            throw new Error("Coverage edge references an article outside the generation snapshot");
          }
          const pairEvidence = articleCoverageEvidence(leftArticle, rightArticle, "v2");
          const leftBundleId = bundleByArticle.get(leftArticleId);
          const accepted = !edge.reviewable && edge.tier !== "weak" && edge.conflicts.length === 0;
          const bundleId =
            accepted && leftBundleId === bundleByArticle.get(rightArticleId)
              ? (leftBundleId ?? null)
              : null;
          await client.query(
            `INSERT INTO coverage_bundle_edges
              (generation_id, bundle_id, left_article_id, right_article_id, tier, score, kind,
               status, signals, conflicts, evidence_fingerprint, correction_conflict,
               positive_incident_evidence)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              generationId,
              bundleId,
              leftArticleId,
              rightArticleId,
              edge.tier,
              edge.score,
              edge.kind,
              accepted ? "accepted" : "reviewable",
              JSON.stringify(edge.signals),
              JSON.stringify(edge.conflicts),
              edge.evidenceFingerprint,
              edge.correctionConflict,
              pairEvidence.positiveIncidentEvidence,
            ],
          );
        }

        const candidateHealth = await client.query<{
          parity_clean: boolean;
          integrity_error_count: number | string;
        }>(
          `WITH legacy AS (
             SELECT ARRAY(SELECT DISTINCT unnest(cb.member_article_ids) ORDER BY 1) AS members,
                    cb.primary_article_id
             FROM coverage_bundles cb
             WHERE cb.legacy_generation_id=$1 AND cb.state='superseded'
               AND cb.matcher_version='v1'
           ), normalized AS (
             SELECT array_agg(DISTINCT cbm.article_id ORDER BY cbm.article_id) AS members,
                    cbv.primary_article_id
             FROM coverage_bundle_versions cbv
             JOIN coverage_bundle_members cbm
               ON cbm.generation_id=cbv.generation_id AND cbm.bundle_id=cbv.bundle_id
             WHERE cbv.generation_id=$1
             GROUP BY cbv.bundle_id, cbv.primary_article_id
           ), parity_mismatches AS (
             (SELECT * FROM legacy EXCEPT ALL SELECT * FROM normalized)
             UNION ALL
             (SELECT * FROM normalized EXCEPT ALL SELECT * FROM legacy)
           ), invalid_primary AS (
             SELECT cbv.bundle_id
             FROM coverage_bundle_versions cbv
             LEFT JOIN coverage_bundle_members cbm
               ON cbm.generation_id=cbv.generation_id AND cbm.bundle_id=cbv.bundle_id
              AND cbm.role='primary'
             WHERE cbv.generation_id=$1
             GROUP BY cbv.bundle_id
             HAVING count(cbm.article_id) <> 1
           ), stable_mismatches AS (
             SELECT cbv.bundle_id
             FROM coverage_bundle_versions cbv
             LEFT JOIN coverage_bundles stable
               ON stable.id=cbv.bundle_id AND stable.generation_id=cbv.generation_id
              AND stable.matcher_version='v2'
              AND stable.state=CASE WHEN $2='active' THEN 'active' ELSE 'shadow' END
             WHERE cbv.generation_id=$1
               AND (stable.id IS NULL
                 OR stable.primary_article_id IS DISTINCT FROM cbv.primary_article_id
                 OR ARRAY(SELECT DISTINCT unnest(stable.member_article_ids) ORDER BY 1)
                    IS DISTINCT FROM ARRAY(
                      SELECT DISTINCT member.article_id
                      FROM coverage_bundle_members member
                      WHERE member.generation_id=cbv.generation_id
                        AND member.bundle_id=cbv.bundle_id
                      ORDER BY member.article_id
                    ))
           )
           SELECT NOT EXISTS(SELECT 1 FROM parity_mismatches) AS parity_clean,
             (SELECT count(*) FROM coverage_bundle_members cbm
              LEFT JOIN articles a ON a.id=cbm.article_id
              WHERE cbm.generation_id=$1 AND a.id IS NULL)
             + (SELECT count(*) FROM invalid_primary)
             + (SELECT count(*) FROM stable_mismatches)
             + CASE WHEN $3::int = (SELECT count(*) FROM coverage_generation_articles
                                    WHERE generation_id=$1)
                       AND $4::int = (SELECT count(*) FROM coverage_bundle_versions
                                     WHERE generation_id=$1)
               THEN 0 ELSE 1 END AS integrity_error_count`,
          [generationId, input.mode, input.analysis.articles.length, bundles.length],
        );
        const health = candidateHealth.rows[0];
        if (health?.parity_clean !== true || Number(health.integrity_error_count) !== 0) {
          throw new Error("Coverage generation candidate failed parity or integrity validation");
        }
        await client.query(
          `UPDATE coverage_bundle_generations
           SET status='completed', completed_at=$2, bundle_count=$3, edge_count=$4,
               correction_conflict_count=$5, correction_revision_snapshot=$6,
               health_outcome='healthy'
           WHERE id=$1 AND status='running'`,
          [
            generationId,
            input.completedAt,
            bundles.length,
            input.analysis.edges?.length ?? 0,
            input.correctionConflictCount ?? 0,
            input.correctionRevisionSnapshot ?? 0,
          ],
        );
        if (input.mode === "active") {
          await client.query(
            `UPDATE coverage_bundles
             SET state='superseded', updated_at=now()
             WHERE matcher_version='v2' AND state='active'
               AND generation_id IS DISTINCT FROM $1`,
            [generationId],
          );
          await client.query(
            `UPDATE coverage_bundle_generations
             SET is_current=false
             WHERE is_current AND mode='active' AND id<>$1`,
            [generationId],
          );
          await client.query(`UPDATE coverage_bundle_generations SET is_current=true WHERE id=$1`, [
            generationId,
          ]);
        }
        return generationId;
      });
    } catch (error) {
      const errorClass =
        typeof error === "object" && error !== null && "constructor" in error
          ? error.constructor.name
          : "Error";
      await this.pool.query(
        `INSERT INTO coverage_bundle_generations
          (matcher_version, mode, status, started_at, completed_at, article_count, error_class)
         VALUES ($1,$2,'failed',$3,$4,$5,$6)`,
        [
          input.matcherVersion,
          input.mode,
          input.startedAt,
          input.completedAt,
          input.analysis.articles.length,
          errorClass || "Error",
        ],
      );
      throw error;
    }
    await this.pruneCoverageGenerations(input.completedAt);
    return generationId;
  }

  async pruneCoverageGenerations(now: string): Promise<void> {
    await this.pool.query(
      `WITH prunable AS MATERIALIZED (
         SELECT id
         FROM coverage_bundle_generations
         WHERE status = 'completed'
           AND completed_at < $1::timestamptz - interval '30 days'
           AND id NOT IN (
             SELECT generation_id
             FROM coverage_bundles
             WHERE state IN ('active', 'shadow') AND generation_id IS NOT NULL
           )
           AND id NOT IN (
             SELECT generation_id FROM coverage_bundle_corrections
           )
       ), deleted_paired AS (
         DELETE FROM coverage_bundles paired
         USING prunable
         WHERE paired.state='superseded' AND paired.matcher_version='v1'
           AND paired.legacy_generation_id=prunable.id
       )
       DELETE FROM coverage_bundle_generations generation
       USING prunable
       WHERE generation.id=prunable.id`,
      [now],
    );
  }

  async upsertMorningBrief(brief: MorningBrief): Promise<void> {
    await this.pool.query(
      `INSERT INTO morning_briefs
        (id, generated_at, mode, title, source_line, paragraphs, highlights,
         article_ids, situation_ids, ai_run_provider, ai_run_status, ai_run_completed_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         generated_at=EXCLUDED.generated_at,
         mode=EXCLUDED.mode,
         title=EXCLUDED.title,
         source_line=EXCLUDED.source_line,
         paragraphs=EXCLUDED.paragraphs,
         highlights=EXCLUDED.highlights,
         article_ids=EXCLUDED.article_ids,
         situation_ids=EXCLUDED.situation_ids,
         ai_run_provider=EXCLUDED.ai_run_provider,
         ai_run_status=EXCLUDED.ai_run_status,
         ai_run_completed_at=EXCLUDED.ai_run_completed_at,
         payload=EXCLUDED.payload,
         updated_at=now()`,
      [
        morningBriefStorageId(brief.generatedAt),
        brief.generatedAt,
        brief.mode,
        brief.title,
        brief.sourceLine,
        JSON.stringify(brief.paragraphs),
        JSON.stringify(brief.highlights),
        brief.articleIds,
        brief.situationIds,
        brief.aiRun?.provider ?? null,
        brief.aiRun?.status ?? null,
        brief.aiRun?.completedAt ?? null,
        JSON.stringify(brief),
      ],
    );
  }

  async activePushSubscriptions(): Promise<PushDeliveryTarget[]> {
    const result = await this.pool.query<{
      id: string;
      userId: string;
      role: UserRole;
      endpoint: string;
      p256dh: string;
      auth: string;
      minSeverity: NotificationTriggerSeverity;
      kinds: NotificationTriggerKind[];
    }>(
      `SELECT
         ps.id,
         ps.user_id AS "userId",
         COALESCE(u.role, 'viewer') AS role,
         ps.endpoint,
         ps.p256dh,
         ps.auth,
         ps.min_severity AS "minSeverity",
         ps.kinds
       FROM push_subscriptions ps
       LEFT JOIN users u ON u.id=ps.user_id
       WHERE ps.enabled=true AND ps.revoked_at IS NULL
         AND COALESCE(u.status, 'active') = 'active'
       ORDER BY ps.last_seen_at DESC, ps.id DESC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: row.role === "owner" ? "owner" : "viewer",
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
      minSeverity: row.minSeverity,
      kinds: row.kinds ?? [],
    }));
  }

  async claimPushDelivery(
    candidate: NotificationTriggerCandidate,
    subscription: Pick<PushDeliveryTarget, "id" | "userId">,
  ): Promise<PushDeliveryClaim | undefined> {
    const id = randomUUID();
    const targetUrl = candidate.links[0]?.href;
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO push_notification_deliveries
        (id, trigger_id, subscription_id, user_id, status, kind, severity, title, body, target_url, payload)
       VALUES ($1,$2,$3,$4,'claimed',$5,$6,$7,$8,$9,$10)
       ON CONFLICT (trigger_id, subscription_id) DO NOTHING
       RETURNING id`,
      [
        id,
        candidate.id,
        subscription.id,
        subscription.userId,
        candidate.kind,
        candidate.severity,
        candidate.title,
        candidate.body,
        targetUrl ?? null,
        JSON.stringify({
          id: candidate.id,
          kind: candidate.kind,
          severity: candidate.severity,
          title: candidate.title,
          body: candidate.body,
          score: candidate.score,
          confidence: candidate.confidence,
          eventUpdatedAt: candidate.eventUpdatedAt,
          situationId: candidate.situationId,
          articleIds: candidate.articleIds,
          sourceIds: candidate.sourceIds,
          sourceLabels: candidate.sourceLabels,
          matchedKeywords: candidate.matchedKeywords,
          reasons: candidate.reasons,
          links: candidate.links,
        }),
      ],
    );
    const row = result.rows[0];
    return row ? { id: row.id } : undefined;
  }

  async markPushDeliverySent(claimId: string, subscriptionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE push_notification_deliveries
       SET status='sent', sent_at=now(), error_message=NULL
       WHERE id=$1`,
      [claimId],
    );
    await this.pool.query(
      `UPDATE push_subscriptions
       SET last_success_at=now(), last_failure_at=NULL, failure_count=0, updated_at=now()
       WHERE id=$1`,
      [subscriptionId],
    );
  }

  async markPushDeliveryFailed(
    claimId: string,
    subscriptionId: string,
    errorMessage: string,
    disableSubscription = false,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE push_notification_deliveries
       SET status='failed', error_message=$2
       WHERE id=$1`,
      [claimId, errorMessage.slice(0, 1000)],
    );
    await this.pool.query(
      `UPDATE push_subscriptions
       SET
         enabled=CASE WHEN $2 THEN false ELSE enabled END,
         revoked_at=CASE WHEN $2 THEN now() ELSE revoked_at END,
         last_failure_at=now(),
         failure_count=failure_count + 1,
         updated_at=now()
       WHERE id=$1`,
      [subscriptionId, disableSubscription],
    );
  }

  private async upsertSourceItem(
    item: SourceItemInput,
    client: Queryable = this.pool,
  ): Promise<void> {
    const values = [
      item.id,
      item.provider,
      item.kind,
      item.externalId ?? null,
      item.originalUrl ?? null,
      item.title ?? null,
      item.summary ?? null,
      item.author ?? null,
      item.publishedAt ?? null,
      item.fetchedAt,
      item.rawPayload,
      item.normalizedPayload,
      item.captureHash,
      item.geoHint ? JSON.stringify(item.geoHint) : null,
      item.reliabilityTier,
    ];
    await client.query(
      `INSERT INTO source_items
        (id, provider, kind, external_id, original_url, title, summary, author, published_at,
         fetched_at, raw_payload, normalized_payload, capture_hash, geo_hint, reliability_tier)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
         CASE WHEN $14::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($14),4326) END,
         $15)
       ON CONFLICT DO NOTHING`,
      values,
    );
    await client.query(
      `UPDATE source_items
       SET
         original_url=$5,
         title=$6,
         summary=$7,
         author=$8,
         published_at=$9,
         fetched_at=$10,
         raw_payload=$11,
         normalized_payload=$12,
         capture_hash=$13,
         geo_hint=CASE WHEN $14::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($14),4326) END,
         reliability_tier=$15,
         updated_at=now()
       WHERE id = COALESCE(
         (SELECT id FROM source_items WHERE id=$1),
         (SELECT id FROM source_items WHERE capture_hash=$13),
         (SELECT id FROM source_items WHERE $4::text IS NOT NULL AND provider=$2 AND kind=$3 AND external_id=$4)
       )`,
      values,
    );
    const captureId = `capture:${sourceItemHash([item.provider, item.kind, item.captureHash])}`;
    const captureValues = [
      captureId,
      item.id,
      item.provider,
      item.kind,
      item.externalId ?? null,
      item.publishedAt ?? null,
      item.fetchedAt,
      item.captureHash,
      item.rawPayload,
      item.normalizedPayload,
    ];
    await client.query(
      `INSERT INTO source_item_captures
        (id, source_item_id, provider, kind, external_id, first_seen_at, published_at,
         source_updated_at, captured_at, capture_hash, raw_payload, normalized_payload)
       SELECT
         $1, current.id, $3, $4, $5, current.created_at, $6, NULL, $7, $8, $9, $10
       FROM source_items current
       WHERE current.id = COALESCE(
         (SELECT id FROM source_items WHERE id=$2),
         (SELECT id FROM source_items WHERE capture_hash=$8),
         (SELECT id FROM source_items WHERE $5::text IS NOT NULL AND provider=$3 AND kind=$4 AND external_id=$5)
       )
       ON CONFLICT (provider, capture_hash) DO NOTHING`,
      captureValues,
    );
  }

  async upsertTrafficInfoSourceItems(items: SourceItemInput[]): Promise<void> {
    for (const item of items) {
      if (item.provider !== "vegvesen_traffic_info" || item.kind !== "official_event") {
        throw new Error(
          "upsertTrafficInfoSourceItems only accepts Vegvesen TrafficInfo official_event items",
        );
      }
    }

    for (const item of items) {
      await this.upsertSourceItem(item);
    }
  }

  async upsertEnturServiceAlertSourceItems(items: SourceItemInput[]): Promise<void> {
    for (const item of items) {
      if (item.provider !== "entur" || item.kind !== "official_event") {
        throw new Error(
          "upsertEnturServiceAlertSourceItems only accepts Entur official_event items",
        );
      }
    }

    for (const item of items) {
      await this.upsertSourceItem(item);
    }
  }

  async upsertBaneNorSourceItems(items: SourceItemInput[]): Promise<void> {
    for (const item of items) {
      if (item.provider !== "bane_nor" || item.kind !== "official_event") {
        throw new Error("upsertBaneNorSourceItems only accepts Bane NOR official_event items");
      }
    }

    for (const item of items) {
      await this.upsertSourceItem(item);
    }
  }

  async setHealth(health: SourceHealth): Promise<void> {
    await this.pool.query(
      `INSERT INTO source_health (source, label, state, last_checked_at, last_failure_at, next_poll_at, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (source) DO UPDATE SET label=EXCLUDED.label, state=EXCLUDED.state,
       last_checked_at=EXCLUDED.last_checked_at, last_failure_at=EXCLUDED.last_failure_at,
       next_poll_at=EXCLUDED.next_poll_at, detail=EXCLUDED.detail`,
      [
        health.source,
        health.label,
        health.state,
        health.lastCheckedAt ?? null,
        health.lastFailureAt ?? null,
        health.nextPollAt ?? null,
        health.detail,
      ],
    );
  }

  async collectorState(key: string): Promise<string | undefined> {
    const result = await this.pool.query<{ value: string }>(
      "SELECT value FROM collector_state WHERE key=$1",
      [key],
    );
    return result.rows[0]?.value;
  }

  async setCollectorState(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO collector_state (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [key, value],
    );
  }

  async saveWorkerCycleMetrics(metrics: WorkerCycleMetrics): Promise<void> {
    await this.pool.query(
      `INSERT INTO worker_cycle_metrics
        (id, cycle_started_at, cycle_completed_at, cycle_duration_ms, payload)
       VALUES ('latest', $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         cycle_started_at=EXCLUDED.cycle_started_at,
         cycle_completed_at=EXCLUDED.cycle_completed_at,
         cycle_duration_ms=EXCLUDED.cycle_duration_ms,
         payload=EXCLUDED.payload,
         updated_at=now()`,
      [metrics.cycleStartedAt, metrics.cycleCompletedAt, metrics.cycleDurationMs, metrics],
    );
  }

  async recordCollectorRun(run: SourceCollectorRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO collector_runs
        (id, source, collector, status, started_at, completed_at, duration_ms,
         records_seen, records_accepted, records_rejected, error_code, error_message, diagnostics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        run.id,
        run.source,
        run.collector,
        run.status,
        run.startedAt,
        run.completedAt ?? null,
        run.durationMs ?? null,
        run.recordsSeen,
        run.recordsAccepted,
        run.recordsRejected,
        run.errorCode ?? null,
        run.errorMessage ?? null,
        run.diagnostics ? JSON.stringify(run.diagnostics) : null,
      ],
    );
  }

  async recentArticles(hours: number): Promise<Article[]> {
    const result = await this.pool.query<{ payload: Article }>(
      "SELECT payload FROM articles WHERE published_at >= now() - ($1 * interval '1 hour') ORDER BY published_at DESC",
      [hours],
    );
    return result.rows.map((row) => row.payload);
  }

  async sourceHealth(): Promise<SourceHealth[]> {
    const result = await this.pool.query<SourceHealth>(
      `SELECT source, label, state, last_checked_at AS "lastCheckedAt",
       last_failure_at AS "lastFailureAt", next_poll_at AS "nextPollAt", detail
       FROM source_health ORDER BY label`,
    );
    return result.rows;
  }

  async homeSituationSummaries(limit = 3): Promise<HomeSituationSummary[]> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - publicLeadLongRunningSituationAgeMs).toISOString();
    const candidateLimit = Math.max(limit * 30, 100);
    const result = await this.pool.query<{ payload: Situation }>(
      `SELECT payload
       FROM situations
       WHERE status IN ('preliminary', 'active')
         AND COALESCE(payload->>'publicVisibility', 'public') = 'public'
         AND NOT (
           COALESCE(payload->>'createdAt', '') <> ''
           AND payload->>'createdAt' < $1
           AND (
             payload->>'type' IN ('traffic', 'landslide', 'weather')
             OR LOWER(CONCAT_WS(' ', payload->>'title', payload->>'summary', payload->>'locationLabel'))
               ~ '(^|[^[:alnum:]_])(omkjøring|omkjoring|ras|skred|stengt|trafikk|veg|vegen|vei|veien)([^[:alnum:]_]|$)'
           )
         )
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      [staleCutoff, candidateLimit],
    );
    return result.rows
      .map((row) => row.payload)
      .filter((situation) => shouldFeaturePublicHomeSituation(situation, now))
      .sort(comparePublicHomeSituations)
      .slice(0, limit)
      .map((situation) => ({
        id: situation.id,
        title: situation.title,
        summary: situation.summary,
        status: situation.status,
        verificationStatus: situation.verificationStatus,
        updatedAt: situation.updatedAt,
        createdAt: situation.createdAt,
        locationLabel: situation.locationLabel,
        ...(situation.sourceConfidence ? { sourceConfidence: situation.sourceConfidence } : {}),
      }));
  }

  async trackedSituations(): Promise<Situation[]> {
    const result = await this.pool.query<{ payload: Situation }>(
      "SELECT payload FROM situations WHERE payload->>'incidentSignature' IS NOT NULL",
    );
    return result.rows.map((row) => row.payload);
  }

  async upsertOfficialEvents(events: OfficialEvent[]): Promise<void> {
    const fetchedAt = new Date().toISOString();
    await this.withTransaction(async (client) => {
      for (const event of events) {
        await client.query(
          `INSERT INTO official_events
           (id, source, event_type, state, source_url, published_at, valid_from, valid_to, geometry, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
             CASE WHEN $9::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($9),4326) END,
             $10)
           ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, source_url=EXCLUDED.source_url,
             published_at=EXCLUDED.published_at, valid_from=EXCLUDED.valid_from,
             valid_to=EXCLUDED.valid_to, geometry=EXCLUDED.geometry, payload=EXCLUDED.payload,
             updated_at=now()`,
          [
            event.id,
            event.source,
            event.eventType,
            event.state,
            event.sourceUrl,
            event.publishedAt,
            event.validFrom,
            event.validTo,
            event.geometry ? JSON.stringify(event.geometry) : null,
            event,
          ],
        );
        if (
          (event.state === "updated" || event.state === "cancelled") &&
          event.replacesIds?.length
        ) {
          await client.query(
            `UPDATE official_events
             SET state='cancelled',
                 payload=jsonb_set(payload, '{state}', to_jsonb('cancelled'::text), true),
                 updated_at=now()
             WHERE id = ANY($1::text[])`,
            [event.replacesIds],
          );
          await this.updateOfficialEventSourceItemState(
            client,
            event.source,
            event.replacesIds,
            "cancelled",
          );
        }
        await this.upsertSourceItem(officialEventSourceItemInput(event, fetchedAt), client);
      }
    });
  }

  async expireMissingOfficialEvents(
    source: OfficialEvent["source"],
    activeIds: string[],
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      const expired = await client.query<{ id: string }>(
        `UPDATE official_events
         SET state='expired',
             payload=jsonb_set(payload, '{state}', to_jsonb('expired'::text), true),
             updated_at=now()
         WHERE source=$1
         AND state IN ('active', 'updated')
         AND NOT (id = ANY($2::text[]))
         RETURNING id`,
        [source, activeIds],
      );
      await this.updateOfficialEventSourceItemState(
        client,
        source,
        expired.rows.map((row) => row.id),
        "expired",
      );
    });
  }

  private async updateOfficialEventSourceItemState(
    client: Queryable,
    source: OfficialEvent["source"],
    eventIds: string[],
    state: "cancelled" | "expired",
  ): Promise<void> {
    if (eventIds.length === 0) return;
    await client.query(
      `UPDATE source_items
       SET normalized_payload=jsonb_set(normalized_payload, '{state}', to_jsonb($3::text), true),
           raw_payload=CASE
             WHEN jsonb_typeof(raw_payload)='object'
             THEN jsonb_set(raw_payload, '{state}', to_jsonb($3::text), true)
             ELSE raw_payload
           END,
           updated_at=now()
       WHERE provider=$1
       AND kind='official_event'
       AND external_id = ANY($2::text[])`,
      [source, eventIds, state],
    );
  }

  async knownOfficialEventIds(source: OfficialEvent["source"]): Promise<Set<string>> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM official_events WHERE source=$1",
      [source],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  async currentOfficialEvents(): Promise<OfficialEvent[]> {
    const result = await this.pool.query<{ payload: OfficialEvent }>(
      "SELECT payload FROM official_events WHERE state IN ('active', 'updated') AND valid_to >= now() ORDER BY published_at DESC",
    );
    return result.rows.map((row) => row.payload);
  }

  async upsertTrafficMapEvents(
    events: PersistedTrafficMapEvent[],
    options: TrafficMapEventUpsertOptions,
  ): Promise<void> {
    if (events.length === 0) return;
    for (const event of events) {
      if (event.source !== options.source) {
        throw new Error(
          `Traffic map event source mismatch: expected ${options.source}, got ${event.source}`,
        );
      }
    }

    for (const event of events) {
      const eventPayloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
      await this.pool.query(
        `INSERT INTO traffic_map_events
         (id, source, source_event_id, category, severity, state, title, description,
          location_name, road_name, valid_from, valid_to, updated_at, source_url,
          geometry, raw_type, confidence, payload, source_payload_hash, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          ST_SetSRID(ST_GeomFromGeoJSON($15),4326),$16,$17,$18,$19,$20)
         ON CONFLICT (source, source_event_id) DO UPDATE SET
          id=EXCLUDED.id,
          category=EXCLUDED.category,
          severity=EXCLUDED.severity,
          state=EXCLUDED.state,
          title=EXCLUDED.title,
          description=EXCLUDED.description,
          location_name=EXCLUDED.location_name,
          road_name=EXCLUDED.road_name,
          valid_from=EXCLUDED.valid_from,
          valid_to=EXCLUDED.valid_to,
          updated_at=EXCLUDED.updated_at,
          source_url=EXCLUDED.source_url,
          geometry=EXCLUDED.geometry,
          raw_type=EXCLUDED.raw_type,
          confidence=EXCLUDED.confidence,
          payload=EXCLUDED.payload,
          source_payload_hash=EXCLUDED.source_payload_hash,
          last_seen_at=EXCLUDED.last_seen_at`,
        [
          event.id,
          event.source,
          event.sourceEventId,
          event.category,
          event.severity,
          event.state,
          event.title,
          event.description ?? null,
          event.locationName ?? null,
          event.roadName ?? null,
          event.validFrom ?? null,
          event.validTo ?? null,
          event.updatedAt,
          event.sourceUrl ?? null,
          JSON.stringify(event.geometry),
          event.rawType ?? null,
          event.confidence ?? null,
          event,
          eventPayloadHash,
          options.fetchedAt,
        ],
      );
    }
  }

  async upsertPublicTransportVehicles(
    vehicles: PublicTransportVehicle[],
    fetchedAt: string,
  ): Promise<void> {
    for (const vehicle of vehicles) {
      const payloadHash = createHash("sha256").update(JSON.stringify(vehicle)).digest("hex");
      await this.pool.query(
        `INSERT INTO public_transport_vehicles
         (id, source, codespace_id, vehicle_id, mode, line_ref, public_code, line_name,
          operator_ref, operator_name, last_updated, expires_at, geometry, payload,
          payload_hash, last_seen_at, stale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          ST_SetSRID(ST_GeomFromGeoJSON($13),4326),$14,$15,$16,false)
         ON CONFLICT (codespace_id, vehicle_id) DO UPDATE SET
          id=EXCLUDED.id,
          source=EXCLUDED.source,
          mode=EXCLUDED.mode,
          line_ref=EXCLUDED.line_ref,
          public_code=EXCLUDED.public_code,
          line_name=EXCLUDED.line_name,
          operator_ref=EXCLUDED.operator_ref,
          operator_name=EXCLUDED.operator_name,
          last_updated=EXCLUDED.last_updated,
          expires_at=EXCLUDED.expires_at,
          geometry=EXCLUDED.geometry,
          payload=EXCLUDED.payload,
          payload_hash=EXCLUDED.payload_hash,
          last_seen_at=EXCLUDED.last_seen_at,
          stale=false`,
        [
          vehicle.id,
          vehicle.source,
          vehicle.codespaceId,
          vehicle.vehicleId,
          vehicle.mode,
          vehicle.lineRef ?? null,
          vehicle.publicCode ?? null,
          vehicle.lineName ?? null,
          vehicle.operatorRef ?? null,
          vehicle.operatorName ?? null,
          vehicle.lastUpdated,
          vehicle.expiresAt ?? null,
          JSON.stringify(vehicle.geometry),
          vehicle,
          payloadHash,
          fetchedAt,
        ],
      );
    }
  }

  async markMissingPublicTransportVehiclesStale(
    source: PublicTransportVehicle["source"],
    codespaceId: string,
    activeVehicleIds: string[],
    checkedAt: string,
  ): Promise<number> {
    const result = await this.pool.query(
      `UPDATE public_transport_vehicles
       SET stale=true,
           payload=jsonb_set(payload, '{stale}', 'true'::jsonb, true)
       WHERE source=$1
         AND codespace_id=$2
         AND stale=false
         AND (
           (expires_at IS NOT NULL AND expires_at <= $4::timestamptz)
           OR last_seen_at < $4::timestamptz - interval '5 minutes'
         )
         AND NOT (vehicle_id = ANY($3::text[]))`,
      [source, codespaceId, activeVehicleIds, checkedAt],
    );
    return result.rowCount ?? 0;
  }

  async listPublicTransportVehicles(filters: {
    modes?: PublicTransportVehicle["mode"][];
    bounds: PublicTransportBounds;
  }): Promise<PublicTransportVehicle[]> {
    const params: unknown[] = [];
    const where = [
      "stale=false",
      "(expires_at IS NULL OR expires_at > now())",
      "last_seen_at >= now() - interval '5 minutes'",
    ];
    if (filters.modes?.length) {
      params.push(filters.modes);
      where.push(`mode = ANY($${params.length}::text[])`);
    }
    params.push(
      filters.bounds.west,
      filters.bounds.south,
      filters.bounds.east,
      filters.bounds.north,
    );
    const westIndex = params.length - 3;
    const southIndex = params.length - 2;
    const eastIndex = params.length - 1;
    const northIndex = params.length;
    where.push(
      `ST_Intersects(geometry, ST_MakeEnvelope($${westIndex}, $${southIndex}, $${eastIndex}, $${northIndex}, 4326))`,
    );

    const result = await this.pool.query<{
      payload: PublicTransportVehicle;
      stale: boolean;
    }>(
      `SELECT payload, stale
       FROM public_transport_vehicles
       WHERE ${where.join(" AND ")}
       ORDER BY last_updated DESC, vehicle_id ASC
       LIMIT 1000`,
      params,
    );
    return result.rows.map((row) => ({ ...row.payload, stale: row.stale }));
  }

  async upsertPublicTransportServiceAlerts(
    alerts: PublicTransportServiceAlert[],
    fetchedAt: string,
  ): Promise<void> {
    for (const alert of alerts) {
      const payloadHash = createHash("sha256").update(JSON.stringify(alert)).digest("hex");
      await this.pool.query(
        `INSERT INTO public_transport_service_alerts
         (id, source, codespace_id, situation_number, severity, report_type, state, summary,
          valid_from, valid_to, updated_at, geometry, payload, payload_hash, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          CASE WHEN $12::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($12),4326) END,
          $13,$14,$15)
         ON CONFLICT (codespace_id, situation_number) DO UPDATE SET
          id=EXCLUDED.id,
          source=EXCLUDED.source,
          severity=EXCLUDED.severity,
          report_type=EXCLUDED.report_type,
          state=EXCLUDED.state,
          summary=EXCLUDED.summary,
          valid_from=EXCLUDED.valid_from,
          valid_to=EXCLUDED.valid_to,
          updated_at=EXCLUDED.updated_at,
          geometry=EXCLUDED.geometry,
          payload=EXCLUDED.payload,
          payload_hash=EXCLUDED.payload_hash,
          last_seen_at=EXCLUDED.last_seen_at`,
        [
          alert.id,
          alert.source,
          alert.codespaceId,
          alert.situationNumber,
          alert.severity ?? null,
          alert.reportType ?? null,
          alert.state,
          alert.summary,
          alert.validFrom ?? null,
          alert.validTo ?? null,
          alert.updatedAt,
          alert.geometry ? JSON.stringify(alert.geometry) : null,
          alert,
          payloadHash,
          fetchedAt,
        ],
      );
    }
  }

  async expireMissingPublicTransportServiceAlerts(
    source: PublicTransportServiceAlert["source"],
    codespaceId: string,
    activeSituationNumbers: string[],
    fetchedAt: string,
  ): Promise<number> {
    return this.withTransaction(async (client) => {
      const expired = await client.query<{ codespace_id: string; situation_number: string }>(
        `UPDATE public_transport_service_alerts
         SET state='expired',
             payload=jsonb_set(payload, '{state}', to_jsonb('expired'::text), true),
             last_seen_at=$4
         WHERE source=$1
         AND codespace_id=$2
         AND state='active'
         AND NOT (situation_number = ANY($3::text[]))
         RETURNING codespace_id, situation_number`,
        [source, codespaceId, activeSituationNumbers, fetchedAt],
      );
      const expiredExternalIds = expired.rows.map(
        (row) => `${row.codespace_id}:${row.situation_number}`,
      );
      if (expiredExternalIds.length) {
        await client.query(
          `UPDATE source_items
           SET normalized_payload=jsonb_set(normalized_payload, '{state}', to_jsonb('expired'::text), true),
               updated_at=now()
           WHERE provider='entur'
           AND kind='official_event'
           AND external_id = ANY($1::text[])`,
          [expiredExternalIds],
        );
      }
      return expired.rowCount ?? 0;
    });
  }

  async listPublicTransportServiceAlerts(filters: {
    states?: PublicTransportServiceAlert["state"][];
    bounds: PublicTransportBounds;
  }): Promise<PublicTransportServiceAlert[]> {
    const params: unknown[] = [];
    const where = [
      "(valid_to IS NULL OR valid_to >= now())",
      "(valid_from IS NULL OR valid_from <= now())",
    ];
    const states: PublicTransportServiceAlert["state"][] = filters.states?.length
      ? filters.states
      : ["active"];
    params.push(states);
    where.push(`state = ANY($${params.length}::text[])`);
    params.push(
      filters.bounds.west,
      filters.bounds.south,
      filters.bounds.east,
      filters.bounds.north,
    );
    const westIndex = params.length - 3;
    const southIndex = params.length - 2;
    const eastIndex = params.length - 1;
    const northIndex = params.length;
    where.push(
      `(geometry IS NULL OR ST_Intersects(geometry, ST_MakeEnvelope($${westIndex}, $${southIndex}, $${eastIndex}, $${northIndex}, 4326)))`,
    );

    const result = await this.pool.query<{
      payload: PublicTransportServiceAlert;
      state: PublicTransportServiceAlert["state"];
    }>(
      `SELECT payload, state
       FROM public_transport_service_alerts
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, situation_number ASC
       LIMIT 500`,
      params,
    );
    return result.rows.map((row) => ({ ...row.payload, state: row.state }));
  }

  async upsertRoadWeatherObservations(observations: RoadWeatherObservation[]): Promise<void> {
    for (const observation of observations) {
      await this.pool.query(
        `INSERT INTO road_weather_observations
         (station_id, payload, observed_at, updated_at, geometry)
         VALUES ($1,$2,$3,$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326))
         ON CONFLICT (station_id) DO UPDATE SET
           payload=EXCLUDED.payload,
           observed_at=EXCLUDED.observed_at,
           updated_at=EXCLUDED.updated_at,
           geometry=EXCLUDED.geometry`,
        [
          observation.stationId,
          observation,
          observation.observedAt,
          observation.updatedAt,
          JSON.stringify(observation.geometry),
        ],
      );
    }
  }

  async upsertRoadCameras(cameras: RoadCamera[]): Promise<void> {
    for (const camera of cameras) {
      await this.pool.query(
        `INSERT INTO road_cameras
         (camera_id, payload, updated_at, geometry)
         VALUES ($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326))
         ON CONFLICT (camera_id) DO UPDATE SET
           payload=EXCLUDED.payload,
           updated_at=EXCLUDED.updated_at,
           geometry=EXCLUDED.geometry`,
        [camera.cameraId, camera, camera.updatedAt, JSON.stringify(camera.geometry)],
      );
    }
  }

  async upsertTrafficCounterSnapshots(counters: TrafficCounterSnapshot[]): Promise<void> {
    for (const counter of counters) {
      await this.pool.query(
        `INSERT INTO traffic_counter_snapshots
         (point_id, payload, updated_at, geometry)
         VALUES ($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326))
         ON CONFLICT (point_id) DO UPDATE SET
           payload=EXCLUDED.payload,
           updated_at=EXCLUDED.updated_at,
           geometry=EXCLUDED.geometry`,
        [counter.pointId, counter, counter.updatedAt, JSON.stringify(counter.geometry)],
      );
      await this.pool.query(
        `INSERT INTO traffic_counter_snapshot_history
         (point_id, observed_at, payload, volume_last_hour, baseline_volume_last_hour,
          anomaly_ratio, coverage_percent, geometry)
         VALUES ($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_GeomFromGeoJSON($8),4326))
         ON CONFLICT (point_id, observed_at) DO UPDATE SET
           payload=EXCLUDED.payload,
           volume_last_hour=EXCLUDED.volume_last_hour,
           baseline_volume_last_hour=EXCLUDED.baseline_volume_last_hour,
           anomaly_ratio=EXCLUDED.anomaly_ratio,
           coverage_percent=EXCLUDED.coverage_percent,
           geometry=EXCLUDED.geometry`,
        [
          counter.pointId,
          counter.updatedAt,
          counter,
          counter.volumeLastHour ?? null,
          counter.baselineVolumeLastHour ?? null,
          counter.anomalyRatio ?? null,
          counter.coveragePercent ?? null,
          JSON.stringify(counter.geometry),
        ],
      );
    }
  }

  async listTrafficMapEvents(
    filters: TrafficMapEventListFilters = {},
  ): Promise<PersistedTrafficMapEvent[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.source) {
      params.push(filters.source);
      where.push(`source=$${params.length}`);
    }
    if (filters.states?.length) {
      params.push(filters.states);
      where.push(`state = ANY($${params.length}::text[])`);
    }

    const result = await this.pool.query<{
      payload: PersistedTrafficMapEvent;
      state: TrafficMapEvent["state"];
    }>(
      `SELECT payload, state FROM traffic_map_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`,
      params,
    );
    return result.rows.map((row) => ({ ...row.payload, state: row.state }));
  }

  async markMissingTrafficMapEventsExpired(
    source: PersistedTrafficMapEventSource,
    activeSourceEventIds: string[],
    fetchedAt: string,
  ): Promise<number> {
    const result = await this.pool.query(
      `UPDATE traffic_map_events
       SET state='expired',
           payload=jsonb_set(payload, '{state}', to_jsonb('expired'::text), true),
           last_seen_at=$3
       WHERE source=$1
       AND state IN ('active', 'planned')
       AND NOT (source_event_id = ANY($2::text[]))`,
      [source, activeSourceEventIds, fetchedAt],
    );
    return result.rowCount ?? 0;
  }

  async expireStaleOpenEndedTrafficMapEvents(
    source: PersistedTrafficMapEventSource,
    now: string,
    maxAgeHours: number,
  ): Promise<number> {
    const result = await this.pool.query(
      `UPDATE traffic_map_events
       SET state='expired',
           payload=jsonb_set(payload, '{state}', to_jsonb('expired'::text), true)
       WHERE source=$1
       AND state IN ('active', 'planned')
       AND valid_to IS NULL
       AND last_seen_at < ($2::timestamptz - ($3 * interval '1 hour'))`,
      [source, now, maxAgeHours],
    );
    return result.rowCount ?? 0;
  }

  async upsertDatexTravelTimes(corridors: TrafficPulseCorridor[]): Promise<void> {
    for (const corridor of corridors) {
      const observedAt = corridor.measurementTo ?? corridor.updatedAt;
      await this.pool.query(
        `INSERT INTO datex_travel_times
         (id, name, state, travel_time_seconds, free_flow_seconds, delay_seconds, delay_ratio,
          trend, measurement_from, measurement_to, source_url, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, state=EXCLUDED.state,
           travel_time_seconds=EXCLUDED.travel_time_seconds,
           free_flow_seconds=EXCLUDED.free_flow_seconds,
           delay_seconds=EXCLUDED.delay_seconds,
           delay_ratio=EXCLUDED.delay_ratio,
           trend=EXCLUDED.trend,
           measurement_from=EXCLUDED.measurement_from,
           measurement_to=EXCLUDED.measurement_to,
           source_url=EXCLUDED.source_url,
           payload=EXCLUDED.payload,
           updated_at=now()`,
        [
          corridor.id,
          corridor.name,
          corridor.state,
          corridor.travelTimeSeconds ?? null,
          corridor.freeFlowSeconds ?? null,
          corridor.delaySeconds ?? null,
          corridor.delayRatio ?? null,
          corridor.trend ?? null,
          corridor.measurementFrom ?? null,
          corridor.measurementTo ?? null,
          corridor.sourceUrl,
          corridor,
        ],
      );
      await this.pool.query(
        `INSERT INTO datex_travel_time_history
         (corridor_id, observed_at, name, state, travel_time_seconds, free_flow_seconds,
          delay_seconds, delay_ratio, trend, measurement_from, measurement_to, source_url, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (corridor_id, observed_at) DO UPDATE SET
           name=EXCLUDED.name,
           state=EXCLUDED.state,
           travel_time_seconds=EXCLUDED.travel_time_seconds,
           free_flow_seconds=EXCLUDED.free_flow_seconds,
           delay_seconds=EXCLUDED.delay_seconds,
           delay_ratio=EXCLUDED.delay_ratio,
           trend=EXCLUDED.trend,
           measurement_from=EXCLUDED.measurement_from,
           measurement_to=EXCLUDED.measurement_to,
           source_url=EXCLUDED.source_url,
           payload=EXCLUDED.payload`,
        [
          corridor.id,
          observedAt,
          corridor.name,
          corridor.state,
          corridor.travelTimeSeconds ?? null,
          corridor.freeFlowSeconds ?? null,
          corridor.delaySeconds ?? null,
          corridor.delayRatio ?? null,
          corridor.trend ?? null,
          corridor.measurementFrom ?? null,
          corridor.measurementTo ?? null,
          corridor.sourceUrl,
          corridor,
        ],
      );
    }
  }

  async markMissingDatexTravelTimesStale(activeIds: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE datex_travel_times
       SET state='stale',
           payload=jsonb_set(payload, '{state}', to_jsonb('stale'::text), true),
           updated_at=now()
       WHERE NOT (id = ANY($1::text[]))`,
      [activeIds],
    );
  }

  async datexTravelTimes(now: Date = new Date()): Promise<TrafficPulseCorridor[]> {
    const result = await this.pool.query<{
      payload: TrafficPulseCorridor;
      measurement_to: Date | string | null;
      updated_at: Date | string | null;
    }>(
      `SELECT payload, measurement_to, updated_at
       FROM datex_travel_times
       ORDER BY delay_seconds DESC NULLS LAST, name ASC`,
    );
    return result.rows.map((row) =>
      isStaleDatexTravelTime(row.payload, row.measurement_to, row.updated_at, now)
        ? { ...row.payload, state: "stale" }
        : row.payload,
    );
  }

  async saveAiRun(run: AiProcessingRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai_processing_runs
       (id, provider, model, status, started_at, completed_at, article_ids, result, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        run.id,
        run.provider,
        run.model,
        run.status,
        run.startedAt,
        run.completedAt,
        JSON.stringify(run.articleIds),
        JSON.stringify(run.result),
        run.error ?? null,
      ],
    );
  }

  async upsertSituation(situation: Situation): Promise<void> {
    await this.withTransaction(async (client) => {
      const previous = await client.query<{ payload: Situation }>(
        "SELECT payload FROM situations WHERE id=$1",
        [situation.id],
      );
      const merged = mergeSituation(previous.rows[0]?.payload, situation);
      await client.query(
        `INSERT INTO situations (id, type, status, verification_status, importance, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,
         verification_status=EXCLUDED.verification_status, importance=EXCLUDED.importance,
         updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
        [
          merged.id,
          merged.type,
          merged.status,
          merged.verificationStatus,
          merged.importance,
          merged.updatedAt,
          merged,
        ],
      );
      if (merged.incidentSignature && merged.activationBasis) {
        await client.query(
          `INSERT INTO situation_activations
           (situation_id, incident_signature, detection_version, source_ids, article_ids, activated_at,
            dismissed_at, dismissal_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (situation_id) DO UPDATE SET incident_signature=EXCLUDED.incident_signature,
           detection_version=EXCLUDED.detection_version, source_ids=EXCLUDED.source_ids,
           article_ids=EXCLUDED.article_ids, activated_at=EXCLUDED.activated_at,
           dismissed_at=EXCLUDED.dismissed_at, dismissal_reason=EXCLUDED.dismissal_reason`,
          [
            merged.id,
            merged.incidentSignature,
            merged.detectionVersion ?? "2",
            JSON.stringify(merged.activationBasis.sourceIds),
            JSON.stringify(merged.activationBasis.articleIds),
            merged.activationBasis.activatedAt,
            merged.dismissedAt ?? null,
            merged.dismissalReason ?? null,
          ],
        );
      }
      for (const evidence of merged.evidence) {
        await client.query(
          `INSERT INTO evidence_items
           (id, situation_id, source, source_url, provenance, confidence, payload, extracted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET source_url=EXCLUDED.source_url,
           provenance=EXCLUDED.provenance, confidence=EXCLUDED.confidence,
           payload=EXCLUDED.payload, extracted_at=EXCLUDED.extracted_at`,
          [
            evidence.id,
            merged.id,
            evidence.source,
            evidence.sourceUrl,
            evidence.provenance,
            evidence.confidence,
            evidence,
            evidence.extractedAt,
          ],
        );
      }
      const currentWarningIds = merged.features
        .filter((feature) => feature.properties.layer === "warning")
        .map((feature) => feature.id);
      await client.query(
        `DELETE FROM map_features
         WHERE situation_id=$1 AND properties->>'layer'='warning'
         AND NOT (id = ANY($2::text[]))`,
        [merged.id, currentWarningIds],
      );
      for (const feature of merged.features) {
        if (feature.properties.provenance === "private_annotation") continue;
        await client.query(
          `INSERT INTO map_features (id, situation_id, provenance, geometry, properties)
           VALUES ($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326),$5)
           ON CONFLICT (id) DO UPDATE SET provenance=EXCLUDED.provenance,
           geometry=EXCLUDED.geometry, properties=EXCLUDED.properties`,
          [
            feature.id,
            merged.id,
            feature.properties.provenance,
            JSON.stringify(feature.geometry),
            feature.properties,
          ],
        );
      }
      for (const timeline of merged.timeline) {
        await client.query(
          `INSERT INTO timeline_entries (id, situation_id, occurred_at, payload)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET occurred_at=EXCLUDED.occurred_at, payload=EXCLUDED.payload`,
          [timeline.id, merged.id, timeline.timestamp, timeline],
        );
      }
      for (const articleId of merged.relatedArticleIds) {
        await client.query(
          `INSERT INTO situation_articles (situation_id, article_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [merged.id, articleId],
        );
        await client.query(
          `UPDATE articles
           SET payload = jsonb_set(payload, '{situationId}', to_jsonb($2::text), true)
           WHERE id = $1`,
          [articleId, merged.id],
        );
        await client.query(
          `INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_by)
           SELECT $1, id, 'supports', 'worker'
           FROM source_items
           WHERE kind='article' AND external_id=$2
           ON CONFLICT (situation_id, source_item_id) DO NOTHING`,
          [merged.id, articleId],
        );
      }
      if (merged.officialEventId && merged.officialSource) {
        await client.query(
          `INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_by)
           SELECT $1, id, 'supports', 'worker'
           FROM source_items
           WHERE provider=$2 AND kind='official_event' AND external_id=$3
           ON CONFLICT (situation_id, source_item_id) DO NOTHING`,
          [merged.id, merged.officialSource, merged.officialEventId],
        );
      }
    });
  }
}

const datexTravelTimeStaleAfterMs = 20 * 60 * 1000;

function isStaleDatexTravelTime(
  corridor: TrafficPulseCorridor,
  measurementToColumn: Date | string | null,
  updatedAtColumn: Date | string | null,
  now: Date,
): boolean {
  const staleBefore = now.getTime() - datexTravelTimeStaleAfterMs;
  const measuredAt = firstValidTimestamp(
    measurementToColumn,
    corridor.measurementTo,
    updatedAtColumn,
    corridor.updatedAt,
  );
  return measuredAt !== undefined && measuredAt < staleBefore;
}

function firstValidTimestamp(
  ...values: Array<Date | string | null | undefined>
): number | undefined {
  for (const value of values) {
    const timestamp = timestampMs(value);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
}

function timestampMs(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isNewerOfficialActiveUpdate(existing: Situation, incoming: Situation): boolean {
  if (existing.status !== "resolved" || incoming.status !== "active") return false;
  if (incoming.verificationStatus !== "Offentlig bekreftet") return false;
  if (
    !incoming.officialSource &&
    !incoming.evidence.some((item) => item.provenance === "official")
  ) {
    return false;
  }
  const existingTime = timestampMs(existing.updatedAt);
  const incomingTime = timestampMs(incoming.updatedAt);
  return incomingTime !== undefined && (existingTime === undefined || incomingTime > existingTime);
}

function mergeSituation(existing: Situation | undefined, incoming: Situation): Situation {
  if (!existing) return incoming;
  const officialReopen = isNewerOfficialActiveUpdate(existing, incoming);
  const lifecycle =
    existing.status === "dismissed"
      ? "dismissed"
      : officialReopen
        ? "active"
        : existing.status === "resolved"
          ? "resolved"
          : incoming.status === "resolved"
            ? "resolved"
            : existing.status === "active" || incoming.status === "active"
              ? "active"
              : "preliminary";
  return {
    ...existing,
    ...incoming,
    status: lifecycle,
    verificationStatus:
      existing.verificationStatus === "Offentlig bekreftet" ||
      incoming.verificationStatus === "Offentlig bekreftet"
        ? "Offentlig bekreftet"
        : "Foreløpig fra rapportering",
    importance:
      existing.importance === "high" || incoming.importance === "high" ? "high" : "normal",
    relatedArticleIds: [...new Set([...existing.relatedArticleIds, ...incoming.relatedArticleIds])],
    evidence: [
      ...new Map(
        [...existing.evidence, ...incoming.evidence].map((evidence) => [evidence.id, evidence]),
      ).values(),
    ],
    features: [
      ...new Map(
        [
          ...existing.features.filter((feature) => feature.properties.layer !== "warning"),
          ...incoming.features,
        ].map((feature) => [feature.id, feature]),
      ).values(),
    ],
    timeline: [
      ...new Map(
        [...existing.timeline, ...incoming.timeline].map((entry) => [entry.id, entry]),
      ).values(),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  };
}

export function articleDedupeKey(article: Article): string {
  // Headlines and publication hours are similarity evidence, not durable identity: publishers
  // routinely reuse generic headlines for unrelated incidents in the same hour.
  const digest = createHash("sha256")
    .update(`article-url-v2\0${article.source}\0${article.url}`)
    .digest("hex");
  return `article-url-v2:${digest}`;
}

function sourceItemHash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sourceItemHash([provider, kind, stableKey])}`;
}

export function articleSourceItemInput(article: Article, fetchedAt: string): SourceItemInput {
  const rawPayload = { ...article };
  delete rawPayload.coverageBundle;
  const normalizedPayload = {
    id: article.id,
    source: article.source,
    sourceLabel: article.sourceLabel,
    title: article.title,
    excerpt: article.excerpt,
    url: article.url,
    publishedAt: article.publishedAt,
    scope: article.scope,
    category: article.category,
    places: article.places,
    location: article.location,
  };
  return {
    id: sourceItemId(article.source, "article", article.id),
    provider: article.source,
    kind: "article",
    externalId: article.id,
    originalUrl: article.url,
    title: article.title,
    summary: article.excerpt,
    publishedAt: article.publishedAt,
    fetchedAt,
    rawPayload,
    normalizedPayload,
    captureHash: sourceItemHash([
      article.source,
      "article",
      article.id,
      article.url,
      article.publishedAt,
      normalizedPayload,
    ]),
    geoHint: article.location
      ? { type: "Point", coordinates: [article.location.lng, article.location.lat] }
      : undefined,
    reliabilityTier:
      article.source === "trondheim_kommune" || article.source === "politiloggen"
        ? "official"
        : "trusted_media",
  };
}

export function officialEventSourceItemInput(
  event: OfficialEvent,
  fetchedAt: string,
): SourceItemInput {
  const normalizedPayload = {
    id: event.id,
    source: event.source,
    eventType: event.eventType,
    title: event.title,
    detail: event.detail,
    sourceUrl: event.sourceUrl,
    areaLabel: event.areaLabel,
    state: event.state,
    severity: event.severity,
    publishedAt: event.publishedAt,
    validFrom: event.validFrom,
    validTo: event.validTo,
    geometry: event.geometry,
    replacesIds: event.replacesIds,
  };
  const publishedAt = event.publishedAt ?? event.validFrom ?? fetchedAt;
  return {
    id: sourceItemId(event.source, "official_event", event.id),
    provider: event.source,
    kind: "official_event",
    externalId: event.id,
    originalUrl: event.sourceUrl,
    title: event.title,
    summary: event.detail,
    publishedAt,
    fetchedAt,
    rawPayload: event.raw ?? event,
    normalizedPayload,
    captureHash: sourceItemHash([
      event.source,
      "official_event",
      event.id,
      event.sourceUrl,
      publishedAt,
      normalizedPayload,
    ]),
    geoHint: event.geometry,
    reliabilityTier: "official",
  };
}
