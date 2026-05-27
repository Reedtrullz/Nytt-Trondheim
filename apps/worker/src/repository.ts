import { createHash } from "node:crypto";
import pg from "pg";
import type {
  AiProcessingRun,
  Article,
  OfficialEvent,
  Situation,
  SourceHealth,
} from "@nytt/shared";

export class WorkerRepository {
  constructor(private readonly pool: pg.Pool) {}

  async upsertArticles(articles: Article[]): Promise<void> {
    for (const article of articles) {
      await this.pool.query(
        `INSERT INTO articles (id, canonical_url, dedupe_key, source, published_at, scope, category, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [
          article.id,
          article.url,
          articleDedupeKey(article),
          article.source,
          article.publishedAt,
          article.scope,
          article.category,
          article,
        ],
      );
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

  async recentArticles(hours: number): Promise<Article[]> {
    const result = await this.pool.query<{ payload: Article }>(
      "SELECT payload FROM articles WHERE published_at >= now() - ($1 * interval '1 hour') ORDER BY published_at DESC",
      [hours],
    );
    return result.rows.map((row) => row.payload);
  }

  async trackedSituations(): Promise<Situation[]> {
    const result = await this.pool.query<{ payload: Situation }>(
      "SELECT payload FROM situations WHERE payload->>'incidentSignature' IS NOT NULL",
    );
    return result.rows.map((row) => row.payload);
  }

  async upsertOfficialEvents(events: OfficialEvent[]): Promise<void> {
    for (const event of events) {
      await this.pool.query(
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
      if ((event.state === "updated" || event.state === "cancelled") && event.replacesIds?.length) {
        await this.pool.query(
          `UPDATE official_events
           SET state='cancelled',
               payload=jsonb_set(payload, '{state}', to_jsonb('cancelled'::text), true),
               updated_at=now()
           WHERE id = ANY($1::text[])`,
          [event.replacesIds],
        );
      }
    }
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
    const previous = await this.pool.query<{ payload: Situation }>(
      "SELECT payload FROM situations WHERE id=$1",
      [situation.id],
    );
    const merged = mergeSituation(previous.rows[0]?.payload, situation);
    await this.pool.query(
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
      await this.pool.query(
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
      await this.pool.query(
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
    await this.pool.query(
      `DELETE FROM map_features
       WHERE situation_id=$1 AND properties->>'layer'='warning'
       AND NOT (id = ANY($2::text[]))`,
      [merged.id, currentWarningIds],
    );
    for (const feature of merged.features) {
      if (feature.properties.provenance === "private_annotation") continue;
      await this.pool.query(
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
      await this.pool.query(
        `INSERT INTO timeline_entries (id, situation_id, occurred_at, payload)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET occurred_at=EXCLUDED.occurred_at, payload=EXCLUDED.payload`,
        [timeline.id, merged.id, timeline.timestamp, timeline],
      );
    }
    for (const articleId of merged.relatedArticleIds) {
      await this.pool.query(
        `INSERT INTO situation_articles (situation_id, article_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [merged.id, articleId],
      );
      await this.pool.query(
        `UPDATE articles
         SET payload = jsonb_set(payload, '{situationId}', to_jsonb($2::text), true)
         WHERE id = $1`,
        [articleId, merged.id],
      );
    }
  }
}

function mergeSituation(existing: Situation | undefined, incoming: Situation): Situation {
  if (!existing) return incoming;
  const lifecycle =
    existing.status === "dismissed"
      ? "dismissed"
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
  const normalizedTitle = article.title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("nb")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
  const publishedHour = article.publishedAt.slice(0, 13);
  return createHash("sha256")
    .update(`${article.source}:${normalizedTitle}:${publishedHour}`)
    .digest("hex");
}
