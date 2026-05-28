import { createHash } from "node:crypto";
import pg from "pg";
import type {
  AiProcessingRun,
  Article,
  OfficialEvent,
  Situation,
  SourceItemInput,
  SourceHealth,
  TrafficPulseCorridor,
} from "@nytt/shared";

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

export class WorkerRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
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

  async upsertArticles(articles: Article[]): Promise<void> {
    const fetchedAt = new Date().toISOString();
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
         payload=CASE WHEN payload ? 'situationId'
           THEN $8::jsonb || jsonb_build_object('situationId', payload->'situationId')
           ELSE $8::jsonb END
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
      await this.upsertSourceItem(articleSourceItemInput(article, fetchedAt));
    }
  }

  private async upsertSourceItem(
    item: SourceItemInput,
    client: Queryable = this.pool,
  ): Promise<void> {
    await client.query(
      `INSERT INTO source_items
        (id, provider, kind, external_id, original_url, title, summary, author, published_at,
         fetched_at, raw_payload, normalized_payload, capture_hash, geo_hint, reliability_tier)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
         CASE WHEN $14::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($14),4326) END,
         $15)
       ON CONFLICT (provider, kind, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET
         original_url=EXCLUDED.original_url,
         title=EXCLUDED.title,
         summary=EXCLUDED.summary,
         author=EXCLUDED.author,
         published_at=EXCLUDED.published_at,
         fetched_at=EXCLUDED.fetched_at,
         raw_payload=EXCLUDED.raw_payload,
         normalized_payload=EXCLUDED.normalized_payload,
         capture_hash=EXCLUDED.capture_hash,
         geo_hint=EXCLUDED.geo_hint,
         reliability_tier=EXCLUDED.reliability_tier,
         updated_at=now()`,
      [
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
      ],
    );
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

  async upsertDatexTravelTimes(corridors: TrafficPulseCorridor[]): Promise<void> {
    for (const corridor of corridors) {
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
    }>(
      `SELECT payload, measurement_to
       FROM datex_travel_times
       ORDER BY delay_seconds DESC NULLS LAST, name ASC`,
    );
    return result.rows.map((row) =>
      isStaleDatexTravelTime(row.payload, row.measurement_to, now)
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
  now: Date,
): boolean {
  const staleBefore = now.getTime() - datexTravelTimeStaleAfterMs;
  return (
    isOldDatexMeasurementTo(measurementToColumn, staleBefore) ||
    isOldDatexMeasurementTo(corridor.measurementTo, staleBefore)
  );
}

function isOldDatexMeasurementTo(
  measurementTo: Date | string | null | undefined,
  staleBefore: number,
): boolean {
  if (!measurementTo) return false;
  const measuredAt =
    measurementTo instanceof Date ? measurementTo.getTime() : Date.parse(measurementTo);
  if (Number.isNaN(measuredAt)) return false;
  return measuredAt < staleBefore;
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

function sourceItemHash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sourceItemHash([provider, kind, stableKey])}`;
}

export function articleSourceItemInput(article: Article, fetchedAt: string): SourceItemInput {
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
    rawPayload: article,
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
    reliabilityTier: article.source === "trondheim_kommune" ? "official" : "trusted_media",
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
