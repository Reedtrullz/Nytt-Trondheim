CREATE EXTENSION IF NOT EXISTS postgis;

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
  source text NOT NULL CHECK (source IN ('met', 'nve')),
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

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

INSERT INTO schema_migrations (version) VALUES ('001_safe_launch_schema') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('002_situation_trustworthiness') ON CONFLICT DO NOTHING;
