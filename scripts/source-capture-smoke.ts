import assert from "node:assert/strict";
import pg from "pg";
import type { Article } from "@nytt/shared";
import { attachArticleSourceCapture } from "../apps/worker/src/articleSourceCapture.js";
import { WorkerRepository } from "../apps/worker/src/repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const externalId = "ci-faithful-source-capture";
const baseArticle: Article = {
  id: externalId,
  source: "nrk",
  sourceLabel: "NRK Trøndelag",
  title: "Brann i Trondheim",
  excerpt: "Nødetatene er varslet.",
  url: "https://example.test/ci-faithful-source-capture",
  publishedAt: "2026-07-15T01:00:00.000Z",
  scope: "trondheim",
  category: "Hendelser",
  places: ["Trondheim"],
};

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const repository = new WorkerRepository(pool);
  for (const revision of [1, 2]) {
    await repository.recordArticleSourceItems([
      attachArticleSourceCapture(
        { ...baseArticle },
        {
          rawPayload: {
            schemaVersion: 1,
            transport: { kind: "rss", endpoint: "https://example.test/feed.xml" },
            feedItem: {
              guid: externalId,
              title: baseArticle.title,
              upstreamRevision: revision,
            },
          },
          sourceUpdatedAt: `2026-07-15T01:0${revision}:00.000Z`,
        },
      ),
    ]);
  }

  const current = await pool.query<{
    id: string;
    capture_hash: string;
    raw_revision: number;
  }>(
    `SELECT id, capture_hash, (raw_payload->'feedItem'->>'upstreamRevision')::integer AS raw_revision
     FROM source_items
     WHERE provider='nrk' AND kind='article' AND external_id=$1`,
    [externalId],
  );
  assert.equal(current.rowCount, 1, "expected one current source-item projection");
  assert.equal(current.rows[0]?.raw_revision, 2, "expected current projection at revision two");

  const captures = await pool.query<{
    source_item_id: string;
    source_updated_at: Date;
    raw_revision: number;
  }>(
    `SELECT source_item_id, source_updated_at,
            (raw_payload->'feedItem'->>'upstreamRevision')::integer AS raw_revision
     FROM source_item_captures
     WHERE provider='nrk' AND kind='article' AND external_id=$1
     ORDER BY source_updated_at`,
    [externalId],
  );
  assert.equal(captures.rowCount, 2, "expected two append-only raw revisions");
  assert.deepEqual(
    captures.rows.map(({ raw_revision }) => raw_revision),
    [1, 2],
  );
  assert.ok(
    captures.rows.every(({ source_item_id }) => source_item_id === current.rows[0]?.id),
    "expected both captures to reference the one current source item",
  );
  assert.deepEqual(
    captures.rows.map(({ source_updated_at }) => source_updated_at.toISOString()),
    ["2026-07-15T01:01:00.000Z", "2026-07-15T01:02:00.000Z"],
  );

  console.log("source capture smoke passed: one current item, two faithful revisions");
} finally {
  await pool.query(
    "DELETE FROM source_items WHERE provider='nrk' AND kind='article' AND external_id=$1",
    [externalId],
  );
  await pool.end();
}
