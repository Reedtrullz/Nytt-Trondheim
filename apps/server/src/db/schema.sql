CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id text PRIMARY KEY,
  canonical_url text UNIQUE NOT NULL,
  dedupe_key text,
  source text NOT NULL,
  published_at timestamptz NOT NULL,
  scope text NOT NULL,
  category text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS dedupe_key text;
UPDATE articles SET dedupe_key = id WHERE dedupe_key IS NULL;
ALTER TABLE articles ALTER COLUMN dedupe_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS articles_dedupe_key_idx ON articles (dedupe_key);

CREATE TABLE IF NOT EXISTS situations (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL,
  verification_status text NOT NULL,
  importance text NOT NULL,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS situation_activations (
  situation_id text PRIMARY KEY REFERENCES situations(id) ON DELETE CASCADE,
  incident_signature text NOT NULL,
  detection_version text NOT NULL,
  source_ids jsonb NOT NULL,
  article_ids jsonb NOT NULL,
  activated_at timestamptz NOT NULL,
  dismissed_at timestamptz,
  dismissal_reason text
);
CREATE INDEX IF NOT EXISTS situation_activations_signature_idx
  ON situation_activations (incident_signature);

CREATE TABLE IF NOT EXISTS situation_articles (
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (situation_id, article_id)
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id text PRIMARY KEY,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_url text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('official', 'reporting_estimate', 'preparedness_context')),
  confidence real NOT NULL,
  payload jsonb NOT NULL,
  extracted_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id text PRIMARY KEY,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS official_events (
  id text PRIMARY KEY,
  source text NOT NULL,
  event_type text NOT NULL,
  state text NOT NULL,
  source_url text NOT NULL,
  published_at timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  geometry geometry(Geometry, 4326),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE official_events DROP CONSTRAINT IF EXISTS official_events_source_check;
ALTER TABLE official_events ADD CONSTRAINT official_events_source_check
  CHECK (source IN ('met', 'nve', 'datex'));

CREATE TABLE IF NOT EXISTS source_items (
  id text PRIMARY KEY,
  provider text NOT NULL,
  kind text NOT NULL,
  external_id text,
  original_url text,
  title text,
  summary text,
  author text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb NOT NULL,
  capture_hash text NOT NULL,
  geo_hint geometry(Geometry, 4326),
  reliability_tier text NOT NULL CHECK (reliability_tier IN ('official', 'trusted_media', 'internal', 'unverified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('article', 'official_event', 'warning', 'reporter_note', 'reader_tip', 'media_asset'))
);

CREATE UNIQUE INDEX IF NOT EXISTS source_items_provider_kind_external_id_unique
  ON source_items (provider, kind, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS source_items_capture_hash_unique
  ON source_items (capture_hash);
CREATE INDEX IF NOT EXISTS source_items_provider_kind_idx ON source_items (provider, kind);
CREATE INDEX IF NOT EXISTS source_items_fetched_at_idx ON source_items (fetched_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS source_items_geo_hint_idx ON source_items USING gist (geo_hint);

CREATE TABLE IF NOT EXISTS situation_source_items (
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  source_item_id text NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'supports'
    CHECK (relationship IN ('supports', 'contradicts', 'context', 'duplicate')),
  confidence_contribution real,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by text,
  PRIMARY KEY (situation_id, source_item_id)
);
CREATE INDEX IF NOT EXISTS situation_source_items_source_item_idx
  ON situation_source_items (source_item_id);
CREATE INDEX IF NOT EXISTS situation_source_items_situation_idx
  ON situation_source_items (situation_id);

-- Backfill existing articles into the source item ledger.
INSERT INTO source_items (
  id,
  provider,
  kind,
  external_id,
  original_url,
  title,
  summary,
  published_at,
  fetched_at,
  raw_payload,
  normalized_payload,
  capture_hash,
  geo_hint,
  reliability_tier
)
SELECT
  'source:' || encode(
    digest(
      format('[%s,%s,%s]', to_jsonb(a.source)::text, to_jsonb('article'::text)::text, to_jsonb(a.id)::text),
      'sha256'
    ),
    'hex'
  ) AS id,
  a.source AS provider,
  'article' AS kind,
  a.id AS external_id,
  COALESCE(a.payload->>'url', a.canonical_url) AS original_url,
  a.payload->>'title' AS title,
  a.payload->>'excerpt' AS summary,
  a.published_at AS published_at,
  COALESCE(a.created_at, a.published_at) AS fetched_at,
  a.payload AS raw_payload,
  jsonb_strip_nulls(
    jsonb_build_object(
      'id', a.id,
      'source', a.source,
      'sourceLabel', a.payload->>'sourceLabel',
      'title', a.payload->>'title',
      'excerpt', a.payload->>'excerpt',
      'url', COALESCE(a.payload->>'url', a.canonical_url),
      'publishedAt', a.payload->>'publishedAt',
      'scope', a.scope,
      'category', a.category,
      'places', a.payload->'places',
      'location', a.payload->'location'
    )
  ) AS normalized_payload,
  encode(
    digest(jsonb_build_array(a.source, 'article', a.id)::text, 'sha256'),
    'hex'
  ) AS capture_hash,
  CASE
    WHEN jsonb_typeof(a.payload->'location'->'lng') = 'number'
      AND jsonb_typeof(a.payload->'location'->'lat') = 'number'
    THEN ST_SetSRID(
      ST_MakePoint(
        (a.payload->'location'->>'lng')::double precision,
        (a.payload->'location'->>'lat')::double precision
      ),
      4326
    )
    ELSE NULL
  END AS geo_hint,
  CASE WHEN a.source = 'trondheim_kommune' THEN 'official' ELSE 'trusted_media' END AS reliability_tier
FROM articles a
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  kind = EXCLUDED.kind,
  external_id = EXCLUDED.external_id,
  original_url = EXCLUDED.original_url,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  published_at = EXCLUDED.published_at,
  fetched_at = EXCLUDED.fetched_at,
  raw_payload = EXCLUDED.raw_payload,
  normalized_payload = EXCLUDED.normalized_payload,
  capture_hash = EXCLUDED.capture_hash,
  geo_hint = EXCLUDED.geo_hint,
  reliability_tier = EXCLUDED.reliability_tier,
  updated_at = now();

-- Backfill existing official events into the source item ledger.
INSERT INTO source_items (
  id,
  provider,
  kind,
  external_id,
  original_url,
  title,
  summary,
  published_at,
  fetched_at,
  raw_payload,
  normalized_payload,
  capture_hash,
  geo_hint,
  reliability_tier
)
SELECT
  'source:' || encode(
    digest(
      format('[%s,%s,%s]', to_jsonb(oe.source)::text, to_jsonb('official_event'::text)::text, to_jsonb(oe.id)::text),
      'sha256'
    ),
    'hex'
  ) AS id,
  oe.source AS provider,
  'official_event' AS kind,
  oe.id AS external_id,
  oe.source_url AS original_url,
  oe.payload->>'title' AS title,
  oe.payload->>'detail' AS summary,
  oe.published_at AS published_at,
  COALESCE(oe.updated_at, oe.published_at) AS fetched_at,
  COALESCE(oe.payload->'raw', oe.payload) AS raw_payload,
  jsonb_strip_nulls(
    jsonb_build_object(
      'id', oe.id,
      'source', oe.source,
      'eventType', oe.event_type,
      'title', oe.payload->>'title',
      'detail', oe.payload->>'detail',
      'sourceUrl', oe.source_url,
      'areaLabel', oe.payload->>'areaLabel',
      'state', oe.state,
      'severity', oe.payload->>'severity',
      'publishedAt', oe.payload->>'publishedAt',
      'validFrom', oe.payload->>'validFrom',
      'validTo', oe.payload->>'validTo',
      'geometry', oe.payload->'geometry',
      'replacesIds', oe.payload->'replacesIds'
    )
  ) AS normalized_payload,
  encode(
    digest(jsonb_build_array(oe.source, 'official_event', oe.id)::text, 'sha256'),
    'hex'
  ) AS capture_hash,
  oe.geometry AS geo_hint,
  'official' AS reliability_tier
FROM official_events oe
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  kind = EXCLUDED.kind,
  external_id = EXCLUDED.external_id,
  original_url = EXCLUDED.original_url,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  published_at = EXCLUDED.published_at,
  fetched_at = EXCLUDED.fetched_at,
  raw_payload = EXCLUDED.raw_payload,
  normalized_payload = EXCLUDED.normalized_payload,
  capture_hash = EXCLUDED.capture_hash,
  geo_hint = EXCLUDED.geo_hint,
  reliability_tier = EXCLUDED.reliability_tier,
  updated_at = now();

-- Backfill source-item links for legacy situation/article joins.
INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_at, linked_by)
SELECT sa.situation_id, si.id, 'supports', COALESCE(sa.created_at, now()), 'backfill'
FROM situation_articles sa
JOIN source_items si ON si.external_id = sa.article_id
WHERE si.kind = 'article'
ON CONFLICT (situation_id, source_item_id) DO NOTHING;

-- Backfill source-item links for situations created directly from official events.
INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_at, linked_by)
SELECT s.id, si.id, 'supports', COALESCE(s.updated_at, now()), 'backfill'
FROM situations s
JOIN source_items si
  ON si.provider = s.payload->>'officialSource'
  AND si.external_id = s.payload->>'officialEventId'
WHERE si.kind = 'official_event'
  AND s.payload->>'officialSource' IS NOT NULL
  AND s.payload->>'officialEventId' IS NOT NULL
ON CONFLICT (situation_id, source_item_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS datex_travel_times (
  id text PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL CHECK (state IN ('free_flow', 'slow', 'congested', 'stale')),
  travel_time_seconds real,
  free_flow_seconds real,
  delay_seconds real,
  delay_ratio real,
  trend text,
  measurement_from timestamptz,
  measurement_to timestamptz,
  source_url text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_processing_runs (
  id text PRIMARY KEY,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  article_ids jsonb NOT NULL,
  result jsonb NOT NULL,
  error text
);

CREATE TABLE IF NOT EXISTS map_features (
  id text PRIMARY KEY,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  provenance text NOT NULL CHECK (provenance IN ('official', 'reporting_estimate', 'preparedness_context', 'private_annotation')),
  geometry geometry(Geometry, 4326) NOT NULL,
  properties jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_tasks (
  id text PRIMARY KEY,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  text text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_notes (
  id text PRIMARY KEY,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  filename text NOT NULL,
  storage_path text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_articles (
  github_login text NOT NULL,
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_login, article_id)
);

CREATE TABLE IF NOT EXISTS saved_situations (
  github_login text NOT NULL,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_login, situation_id)
);

CREATE TABLE IF NOT EXISTS export_manifests (
  id text PRIMARY KEY,
  situation_id text NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  github_login text NOT NULL,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
ALTER TABLE export_manifests ADD COLUMN IF NOT EXISTS storage_path text;

CREATE TABLE IF NOT EXISTS source_health (
  source text PRIMARY KEY,
  label text NOT NULL,
  state text NOT NULL,
  last_checked_at timestamptz,
  last_failure_at timestamptz,
  next_poll_at timestamptz,
  detail text NOT NULL
);
ALTER TABLE source_health ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;
ALTER TABLE source_health ADD COLUMN IF NOT EXISTS next_poll_at timestamptz;

CREATE TABLE IF NOT EXISTS collector_state (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

INSERT INTO schema_migrations (version) VALUES ('001_safe_launch_schema') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('002_situation_trustworthiness') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('003_collector_state') ON CONFLICT DO NOTHING;
