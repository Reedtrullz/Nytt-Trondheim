import { createHash } from "node:crypto";
import pg from "pg";
import type { Article, Situation, SourceHealth } from "@nytt/shared";

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
      `INSERT INTO source_health (source, label, state, last_checked_at, detail)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source) DO UPDATE SET label=EXCLUDED.label, state=EXCLUDED.state,
       last_checked_at=EXCLUDED.last_checked_at, detail=EXCLUDED.detail`,
      [health.source, health.label, health.state, health.lastCheckedAt ?? null, health.detail],
    );
  }

  async upsertSituation(situation: Situation): Promise<void> {
    await this.pool.query(
      `INSERT INTO situations (id, type, status, verification_status, importance, updated_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,
       verification_status=EXCLUDED.verification_status, importance=EXCLUDED.importance,
       updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
      [
        situation.id,
        situation.type,
        situation.status,
        situation.verificationStatus,
        situation.importance,
        situation.updatedAt,
        situation,
      ],
    );
    for (const evidence of situation.evidence) {
      await this.pool.query(
        `INSERT INTO evidence_items
         (id, situation_id, source, source_url, provenance, confidence, payload, extracted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET source_url=EXCLUDED.source_url,
         provenance=EXCLUDED.provenance, confidence=EXCLUDED.confidence,
         payload=EXCLUDED.payload, extracted_at=EXCLUDED.extracted_at`,
        [
          evidence.id,
          situation.id,
          evidence.source,
          evidence.sourceUrl,
          evidence.provenance,
          evidence.confidence,
          evidence,
          evidence.extractedAt,
        ],
      );
    }
    for (const feature of situation.features) {
      if (feature.properties.provenance === "private_annotation") continue;
      await this.pool.query(
        `INSERT INTO map_features (id, situation_id, provenance, geometry, properties)
         VALUES ($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326),$5)
         ON CONFLICT (id) DO UPDATE SET provenance=EXCLUDED.provenance,
         geometry=EXCLUDED.geometry, properties=EXCLUDED.properties`,
        [
          feature.id,
          situation.id,
          feature.properties.provenance,
          JSON.stringify(feature.geometry),
          feature.properties,
        ],
      );
    }
    for (const articleId of situation.relatedArticleIds) {
      await this.pool.query(
        `UPDATE articles
         SET payload = jsonb_set(payload, '{situationId}', to_jsonb($2::text), true)
         WHERE id = $1`,
        [articleId, situation.id],
      );
    }
  }
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
