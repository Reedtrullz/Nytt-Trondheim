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
CREATE INDEX IF NOT EXISTS articles_published_idx
  ON articles (published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS articles_scope_published_idx
  ON articles (scope, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS articles_scope_category_published_idx
  ON articles (scope, category, published_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS coverage_bundle_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matcher_version text NOT NULL CHECK (matcher_version IN ('v1', 'v2')),
  mode text NOT NULL CHECK (mode IN ('active', 'shadow')),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  article_count integer NOT NULL CHECK (article_count >= 0),
  bundle_count integer NOT NULL DEFAULT 0 CHECK (bundle_count >= 0),
  edge_count integer NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
  correction_conflict_count integer NOT NULL DEFAULT 0 CHECK (correction_conflict_count >= 0),
  correction_revision_snapshot bigint NOT NULL DEFAULT 0 CHECK (correction_revision_snapshot >= 0),
  health_outcome text NOT NULL DEFAULT 'unchecked'
    CHECK (health_outcome IN ('unchecked', 'healthy')),
  is_current boolean NOT NULL DEFAULT false,
  error_class text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  )
);
ALTER TABLE coverage_bundle_generations
  ADD COLUMN IF NOT EXISTS correction_revision_snapshot bigint NOT NULL DEFAULT 0
  CHECK (correction_revision_snapshot >= 0);
ALTER TABLE coverage_bundle_generations
  ADD COLUMN IF NOT EXISTS health_outcome text NOT NULL DEFAULT 'unchecked'
  CHECK (health_outcome IN ('unchecked', 'healthy'));
CREATE INDEX IF NOT EXISTS coverage_bundle_generations_completed_idx
  ON coverage_bundle_generations (completed_at DESC, id DESC)
  WHERE status = 'completed';
CREATE UNIQUE INDEX IF NOT EXISTS coverage_bundle_generations_one_current_idx
  ON coverage_bundle_generations ((is_current))
  WHERE is_current AND status = 'completed' AND mode = 'active';

CREATE TABLE IF NOT EXISTS coverage_generation_articles (
  generation_id uuid NOT NULL REFERENCES coverage_bundle_generations(id) ON DELETE CASCADE,
  article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, article_id)
);
CREATE INDEX IF NOT EXISTS coverage_generation_articles_article_idx
  ON coverage_generation_articles (article_id, generation_id);

CREATE TABLE IF NOT EXISTS coverage_bundles (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('incident', 'topic', 'update')),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium')),
  reason text NOT NULL,
  generated_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  primary_article_id text NOT NULL,
  member_article_ids text[] NOT NULL,
  source_ids text[] NOT NULL,
  source_labels text[] NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  near_misses jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (array_length(member_article_ids, 1) >= 2),
  CHECK (jsonb_typeof(signals) = 'array'),
  CHECK (jsonb_typeof(near_misses) = 'array')
);
CREATE INDEX IF NOT EXISTS coverage_bundles_generated_at_idx
  ON coverage_bundles (generated_at DESC);
CREATE INDEX IF NOT EXISTS coverage_bundles_last_seen_at_idx
  ON coverage_bundles (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS coverage_bundles_kind_idx ON coverage_bundles (kind);
CREATE INDEX IF NOT EXISTS coverage_bundles_confidence_idx ON coverage_bundles (confidence);
CREATE INDEX IF NOT EXISTS coverage_bundles_member_article_ids_gin_idx
  ON coverage_bundles USING gin (member_article_ids);
ALTER TABLE coverage_bundles
  ADD COLUMN IF NOT EXISTS generation_id uuid REFERENCES coverage_bundle_generations(id) ON DELETE SET NULL;
ALTER TABLE coverage_bundles
  ADD COLUMN IF NOT EXISTS legacy_generation_id uuid REFERENCES coverage_bundle_generations(id) ON DELETE SET NULL;
ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'legacy';
ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS matcher_version text NOT NULL DEFAULT 'v1';
ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS match_tier text;
ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS match_score real;
ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS match_rationale text;
ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS first_seen_at timestamptz;
ALTER TABLE coverage_bundles DROP CONSTRAINT IF EXISTS coverage_bundles_state_check;
ALTER TABLE coverage_bundles ADD CONSTRAINT coverage_bundles_state_check
  CHECK (state IN ('legacy', 'active', 'shadow', 'superseded'));
ALTER TABLE coverage_bundles DROP CONSTRAINT IF EXISTS coverage_bundles_matcher_version_check;
ALTER TABLE coverage_bundles ADD CONSTRAINT coverage_bundles_matcher_version_check
  CHECK (matcher_version IN ('v1', 'v2'));
ALTER TABLE coverage_bundles DROP CONSTRAINT IF EXISTS coverage_bundles_match_tier_check;
ALTER TABLE coverage_bundles ADD CONSTRAINT coverage_bundles_match_tier_check
  CHECK (match_tier IS NULL OR match_tier IN ('strong', 'moderate'));
ALTER TABLE coverage_bundles DROP CONSTRAINT IF EXISTS coverage_bundles_match_score_check;
ALTER TABLE coverage_bundles ADD CONSTRAINT coverage_bundles_match_score_check
  CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 1));
CREATE INDEX IF NOT EXISTS coverage_bundles_state_generation_idx
  ON coverage_bundles (state, generation_id, last_seen_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS coverage_bundles_legacy_generation_idx
  ON coverage_bundles (legacy_generation_id, id)
  WHERE legacy_generation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS coverage_bundle_versions (
  generation_id uuid NOT NULL REFERENCES coverage_bundle_generations(id) ON DELETE CASCADE,
  bundle_id text NOT NULL REFERENCES coverage_bundles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('incident', 'topic', 'update')),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium')),
  reason text NOT NULL,
  primary_article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  match_tier text NOT NULL CHECK (match_tier IN ('strong', 'moderate')),
  match_score real NOT NULL CHECK (match_score >= 0 AND match_score <= 1),
  match_rationale text NOT NULL,
  generated_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  source_ids text[] NOT NULL,
  source_labels text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, bundle_id)
);
ALTER TABLE coverage_bundle_versions ADD COLUMN IF NOT EXISTS confidence text;
UPDATE coverage_bundle_versions cbv
SET confidence = cb.confidence
FROM coverage_bundles cb
WHERE cb.id = cbv.bundle_id AND cbv.confidence IS NULL;
ALTER TABLE coverage_bundle_versions ALTER COLUMN confidence SET NOT NULL;
ALTER TABLE coverage_bundle_versions DROP CONSTRAINT IF EXISTS coverage_bundle_versions_confidence_check;
ALTER TABLE coverage_bundle_versions ADD CONSTRAINT coverage_bundle_versions_confidence_check
  CHECK (confidence IN ('high', 'medium'));
CREATE INDEX IF NOT EXISTS coverage_bundle_versions_last_seen_idx
  ON coverage_bundle_versions (generation_id, last_seen_at DESC, bundle_id DESC);

CREATE TABLE IF NOT EXISTS coverage_bundle_members (
  generation_id uuid NOT NULL,
  bundle_id text NOT NULL,
  article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('primary', 'supporting')),
  admitted_by_article_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, bundle_id, article_id),
  FOREIGN KEY (generation_id, bundle_id)
    REFERENCES coverage_bundle_versions(generation_id, bundle_id) ON DELETE CASCADE,
  CHECK (
    array_length(admitted_by_article_ids, 1) IS NULL
    OR array_length(admitted_by_article_ids, 1) <= 2
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS coverage_bundle_members_one_primary_idx
  ON coverage_bundle_members (generation_id, bundle_id)
  WHERE role = 'primary';
CREATE INDEX IF NOT EXISTS coverage_bundle_members_article_idx
  ON coverage_bundle_members (article_id, generation_id);

CREATE TABLE IF NOT EXISTS coverage_bundle_edges (
  generation_id uuid NOT NULL REFERENCES coverage_bundle_generations(id) ON DELETE CASCADE,
  bundle_id text,
  left_article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  right_article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  tier text NOT NULL CHECK (tier IN ('strong', 'moderate', 'weak')),
  score real NOT NULL CHECK (score >= 0 AND score <= 1),
  kind text NOT NULL CHECK (kind IN ('incident', 'topic', 'update')),
  status text NOT NULL CHECK (status IN ('accepted', 'reviewable')),
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_fingerprint text NOT NULL,
  correction_conflict boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, left_article_id, right_article_id),
  FOREIGN KEY (generation_id, bundle_id)
    REFERENCES coverage_bundle_versions(generation_id, bundle_id) ON DELETE CASCADE,
  CHECK (left_article_id < right_article_id),
  CHECK (jsonb_typeof(signals) = 'array'),
  CHECK (jsonb_typeof(conflicts) = 'array')
);
CREATE INDEX IF NOT EXISTS coverage_bundle_edges_bundle_idx
  ON coverage_bundle_edges (generation_id, bundle_id, tier, score DESC);
CREATE INDEX IF NOT EXISTS coverage_bundle_edges_review_idx
  ON coverage_bundle_edges (generation_id, correction_conflict, tier, score DESC)
  WHERE status = 'reviewable';
ALTER TABLE coverage_bundle_edges
  ADD COLUMN IF NOT EXISTS positive_incident_evidence text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS situations (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL,
  verification_status text NOT NULL,
  importance text NOT NULL,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS situations_public_status_updated_idx
  ON situations (status, updated_at DESC, id DESC)
  WHERE COALESCE(payload->>'publicVisibility', 'public') = 'public';
CREATE INDEX IF NOT EXISTS situations_related_article_ids_public_gin_idx
  ON situations USING gin ((COALESCE(payload->'relatedArticleIds', '[]'::jsonb)))
  WHERE status IN ('preliminary', 'active')
    AND COALESCE(payload->>'publicVisibility', 'public') = 'public';
ALTER TABLE situations ADD COLUMN IF NOT EXISTS confidence_score real;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS activation_rule_id text;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS resolved_by text;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS dismissed_reason text;
ALTER TABLE situations DROP CONSTRAINT IF EXISTS situations_confidence_score_check;
ALTER TABLE situations ADD CONSTRAINT situations_confidence_score_check
  CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));
ALTER TABLE situations DROP CONSTRAINT IF EXISTS situations_activation_rule_id_check;
ALTER TABLE situations ADD CONSTRAINT situations_activation_rule_id_check
  CHECK (
    activation_rule_id IS NULL
    OR activation_rule_id IN (
      'two_independent_reporting_sources',
      'official_high_impact_exception',
      'official_corroboration',
      'official_resolution',
      'context_only_source',
      'telemetry_only_source',
      'place_too_generic',
      'place_outside_aoi',
      'stale_or_duplicate',
      'official_denial',
      'private_not_causal',
      'ai_not_causal',
      'source_health_only'
    )
  );
ALTER TABLE situations DROP CONSTRAINT IF EXISTS situations_resolved_by_check;
ALTER TABLE situations ADD CONSTRAINT situations_resolved_by_check
  CHECK (
    resolved_by IS NULL
    OR resolved_by IN (
      'official_update',
      'fresh_snapshot_missing',
      'timeout',
      'manual_review',
      'merged_duplicate'
    )
  );
ALTER TABLE situations DROP CONSTRAINT IF EXISTS situations_dismissed_reason_column_check;
ALTER TABLE situations ADD CONSTRAINT situations_dismissed_reason_column_check
  CHECK (
    dismissed_reason IS NULL
    OR dismissed_reason IN (
      'false_positive',
      'owner_dismissed',
      'official_denial',
      'place_ambiguous',
      'stale_or_duplicate',
      'outside_aoi'
    )
  );
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM situations
    WHERE payload->>'officialSource' IS NOT NULL
      AND payload->>'officialSource' NOT IN ('datex', 'politiloggen')
  ) THEN
    RAISE EXCEPTION 'situations contain unsupported officialSource values';
  END IF;
  IF EXISTS (
    SELECT 1 FROM situations
    WHERE COALESCE(payload->'activationBasis'->'sourceIds', '[]'::jsonb) ?| ARRAY[
      'bane_nor',
      'datex_cctv',
      'datex_travel_time',
      'datex_weather',
      'dsb',
      'entur',
      'entur_service_alerts',
      'entur_vehicle_positions',
      'met',
      'nve',
      'trafikkdata',
      'vegvesen_traffic_info'
    ]
  ) THEN
    RAISE EXCEPTION 'situations contain context-only activation source ids';
  END IF;
END;
$$;
ALTER TABLE situations DROP CONSTRAINT IF EXISTS situations_official_source_check;
ALTER TABLE situations ADD CONSTRAINT situations_official_source_check
  CHECK (payload->>'officialSource' IS NULL OR payload->>'officialSource' IN ('datex', 'politiloggen'));
ALTER TABLE situations DROP CONSTRAINT IF EXISTS situations_activation_source_ids_array_check;
ALTER TABLE situations ADD CONSTRAINT situations_activation_source_ids_array_check
  CHECK (
    payload->'activationBasis'->'sourceIds' IS NULL
    OR jsonb_typeof(payload->'activationBasis'->'sourceIds') IN ('array', 'null')
  );
ALTER TABLE situations DROP CONSTRAINT IF EXISTS situations_activation_sources_no_context_source_check;
ALTER TABLE situations ADD CONSTRAINT situations_activation_sources_no_context_source_check
  CHECK (
    NOT (COALESCE(payload->'activationBasis'->'sourceIds', '[]'::jsonb) ?| ARRAY[
      'bane_nor',
      'datex_cctv',
      'datex_travel_time',
      'datex_weather',
      'dsb',
      'entur',
      'entur_service_alerts',
      'entur_vehicle_positions',
      'met',
      'nve',
      'trafikkdata',
      'vegvesen_traffic_info'
    ])
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
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM situation_activations
    WHERE source_ids ?| ARRAY[
      'bane_nor',
      'datex_cctv',
      'datex_travel_time',
      'datex_weather',
      'dsb',
      'entur',
      'entur_service_alerts',
      'entur_vehicle_positions',
      'met',
      'nve',
      'trafikkdata',
      'vegvesen_traffic_info'
    ]
  ) THEN
    RAISE EXCEPTION 'situation_activations contain context-only activation source ids';
  END IF;
END;
$$;
ALTER TABLE situation_activations DROP CONSTRAINT IF EXISTS situation_activations_source_ids_array_check;
ALTER TABLE situation_activations ADD CONSTRAINT situation_activations_source_ids_array_check
  CHECK (jsonb_typeof(source_ids) = 'array');
ALTER TABLE situation_activations DROP CONSTRAINT IF EXISTS situation_activations_source_ids_no_context_source_check;
ALTER TABLE situation_activations ADD CONSTRAINT situation_activations_source_ids_no_context_source_check
  CHECK (
    NOT (source_ids ?| ARRAY[
      'bane_nor',
      'datex_cctv',
      'datex_travel_time',
      'datex_weather',
      'dsb',
      'entur',
      'entur_service_alerts',
      'entur_vehicle_positions',
      'met',
      'nve',
      'trafikkdata',
      'vegvesen_traffic_info'
    ])
  );

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
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS input_hash text;
UPDATE evidence_items
SET role = CASE
    WHEN provenance = 'official' THEN 'official'
    WHEN provenance = 'reporting_estimate' THEN 'reporting'
    WHEN provenance = 'preparedness_context' THEN 'context'
    ELSE role
  END,
  input_hash = COALESCE(input_hash, encode(digest(jsonb_build_array(source, source_url, payload)::text, 'sha256'), 'hex'))
WHERE role IS NULL OR input_hash IS NULL;
ALTER TABLE evidence_items DROP CONSTRAINT IF EXISTS evidence_items_role_check;
ALTER TABLE evidence_items ADD CONSTRAINT evidence_items_role_check
  CHECK (role IS NULL OR role IN ('official', 'reporting', 'context', 'private', 'ai_summary'));
CREATE UNIQUE INDEX IF NOT EXISTS evidence_items_input_hash_unique
  ON evidence_items (input_hash)
  WHERE input_hash IS NOT NULL;
CREATE OR REPLACE FUNCTION fill_evidence_item_decision_metadata()
RETURNS trigger AS $$
BEGIN
  NEW.role = COALESCE(
    NEW.role,
    CASE
      WHEN NEW.provenance = 'official' THEN 'official'
      WHEN NEW.provenance = 'reporting_estimate' THEN 'reporting'
      WHEN NEW.provenance = 'preparedness_context' THEN 'context'
      ELSE NULL
    END
  );
  NEW.input_hash = COALESCE(
    NEW.input_hash,
    encode(digest(jsonb_build_array(NEW.source, NEW.source_url, NEW.payload)::text, 'sha256'), 'hex')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS evidence_items_decision_metadata_fill ON evidence_items;
CREATE TRIGGER evidence_items_decision_metadata_fill
  BEFORE INSERT OR UPDATE OF source, source_url, provenance, payload, role, input_hash ON evidence_items
  FOR EACH ROW EXECUTE FUNCTION fill_evidence_item_decision_metadata();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evidence_items
    WHERE source IN (
      'datex_travel_time',
      'datex_weather',
      'datex_cctv',
      'trafikkdata',
      'entur_vehicle_positions'
    )
  ) THEN
    RAISE EXCEPTION 'telemetry-only sources already exist in evidence_items';
  END IF;
END;
$$;
ALTER TABLE evidence_items DROP CONSTRAINT IF EXISTS evidence_items_no_telemetry_source_check;
ALTER TABLE evidence_items ADD CONSTRAINT evidence_items_no_telemetry_source_check
  CHECK (source NOT IN (
    'datex_travel_time',
    'datex_weather',
    'datex_cctv',
    'trafikkdata',
    'entur_vehicle_positions'
  ));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM evidence_items WHERE source IN ('dsb','web_push')) THEN
    RAISE EXCEPTION 'health-only source must not exist in evidence_items';
  END IF;
END;
$$;
ALTER TABLE evidence_items DROP CONSTRAINT IF EXISTS evidence_items_no_health_only_source_check;
ALTER TABLE evidence_items ADD CONSTRAINT evidence_items_no_health_only_source_check
  CHECK (source NOT IN ('dsb','web_push'));
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evidence_items
    WHERE source NOT IN (
      'nrk','adressa','avisa_st','vg','dagbladet','trondheim_kommune','bane_nor','met','nve','datex',
      'snasningen','merakerposten','frostingen','ytringen','steinkjer_avisa','innherred',
      'namdalsavisa','malviknytt','selbyggen','fjell_ljom','retten','hitra_froya',
      'tronderbladet','nidaros','t_a',
      'datex_travel_time','datex_weather','datex_cctv','trafikkdata','vegvesen_traffic_info',
      'entur','entur_vehicle_positions','entur_service_alerts','dsb','politiloggen','internal',
      'private_annotations','deepseek','web_push'
    )
  ) THEN
    RAISE EXCEPTION 'unknown source exists in evidence_items';
  END IF;
END;
$$;
ALTER TABLE evidence_items DROP CONSTRAINT IF EXISTS evidence_items_source_id_check;
ALTER TABLE evidence_items ADD CONSTRAINT evidence_items_source_id_check
  CHECK (source IN (
    'nrk','adressa','avisa_st','vg','dagbladet','trondheim_kommune','bane_nor','met','nve','datex',
    'snasningen','merakerposten','frostingen','ytringen','steinkjer_avisa','innherred',
    'namdalsavisa','malviknytt','selbyggen','fjell_ljom','retten','hitra_froya',
    'tronderbladet','nidaros','t_a',
    'datex_travel_time','datex_weather','datex_cctv','trafikkdata','vegvesen_traffic_info',
    'entur','entur_vehicle_positions','entur_service_alerts','dsb','politiloggen','internal',
    'private_annotations','deepseek','web_push'
  ));

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
CREATE INDEX IF NOT EXISTS official_events_source_published_idx
  ON official_events (source, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS official_events_source_state_published_idx
  ON official_events (source, state, published_at DESC, id DESC);

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
ALTER TABLE source_items ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE source_items ADD COLUMN IF NOT EXISTS input_hash text;
UPDATE source_items
SET role = CASE
    WHEN provider IN ('datex', 'politiloggen') THEN 'official'
    WHEN provider IN (
      'nrk', 'adressa', 'avisa_st', 'vg', 'dagbladet',
      'snasningen', 'merakerposten', 'frostingen', 'ytringen', 'steinkjer_avisa',
      'innherred', 'namdalsavisa', 'malviknytt', 'selbyggen', 'fjell_ljom',
      'retten', 'hitra_froya', 'tronderbladet', 'nidaros', 't_a'
    ) THEN 'reporting'
    WHEN provider IN (
      'trondheim_kommune',
      'met',
      'nve',
      'vegvesen_traffic_info',
      'entur',
      'entur_service_alerts',
      'bane_nor'
    ) THEN 'context'
    WHEN provider IN (
      'datex_travel_time',
      'datex_weather',
      'datex_cctv',
      'trafikkdata',
      'entur_vehicle_positions',
      'dsb'
    ) THEN 'telemetry'
    WHEN provider = 'private_annotations' THEN 'private'
    WHEN provider = 'deepseek' THEN 'ai_summary'
    ELSE role
  END,
  input_hash = COALESCE(input_hash, capture_hash)
WHERE role IS NULL OR input_hash IS NULL;
ALTER TABLE source_items DROP CONSTRAINT IF EXISTS source_items_role_check;
ALTER TABLE source_items ADD CONSTRAINT source_items_role_check
  CHECK (role IS NULL OR role IN ('official', 'reporting', 'context', 'telemetry', 'private', 'ai_summary', 'ignored'));
CREATE UNIQUE INDEX IF NOT EXISTS source_items_provider_input_hash_unique
  ON source_items (provider, input_hash)
  WHERE input_hash IS NOT NULL;
CREATE OR REPLACE FUNCTION fill_source_item_decision_metadata()
RETURNS trigger AS $$
BEGIN
  NEW.role = COALESCE(
    NEW.role,
    CASE
      WHEN NEW.provider IN ('datex', 'politiloggen') THEN 'official'
      WHEN NEW.provider IN (
        'nrk', 'adressa', 'avisa_st', 'vg', 'dagbladet',
        'snasningen', 'merakerposten', 'frostingen', 'ytringen', 'steinkjer_avisa',
        'innherred', 'namdalsavisa', 'malviknytt', 'selbyggen', 'fjell_ljom',
        'retten', 'hitra_froya', 'tronderbladet', 'nidaros', 't_a'
      ) THEN 'reporting'
      WHEN NEW.provider IN (
        'trondheim_kommune',
        'met',
        'nve',
        'vegvesen_traffic_info',
        'entur',
        'entur_service_alerts',
        'bane_nor'
      ) THEN 'context'
      WHEN NEW.provider IN (
        'datex_travel_time',
        'datex_weather',
        'datex_cctv',
        'trafikkdata',
        'entur_vehicle_positions',
        'dsb'
      ) THEN 'telemetry'
      WHEN NEW.provider = 'private_annotations' THEN 'private'
      WHEN NEW.provider = 'deepseek' THEN 'ai_summary'
      ELSE 'ignored'
    END
  );
  NEW.input_hash = COALESCE(NEW.input_hash, NEW.capture_hash);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS source_items_decision_metadata_fill ON source_items;
CREATE TRIGGER source_items_decision_metadata_fill
  BEFORE INSERT OR UPDATE OF provider, capture_hash, role, input_hash ON source_items
  FOR EACH ROW EXECUTE FUNCTION fill_source_item_decision_metadata();
ALTER TABLE source_items DROP CONSTRAINT IF EXISTS source_items_entur_vehicle_positions_kind_check;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM source_items
    WHERE provider = 'entur_vehicle_positions' AND kind = 'official_event'
  ) THEN
    RAISE EXCEPTION 'Entur vehicle-position telemetry already exists as source_items official_event';
  END IF;
  IF EXISTS (
    SELECT 1 FROM source_items
    WHERE provider = 'entur'
      AND kind = 'official_event'
      AND normalized_payload->>'source' IS DISTINCT FROM 'entur_service_alerts'
  ) THEN
    RAISE EXCEPTION 'Entur official_event source_items must be service alerts';
  END IF;
END;
$$;
ALTER TABLE source_items ADD CONSTRAINT source_items_entur_vehicle_positions_kind_check
  CHECK (provider <> 'entur_vehicle_positions' OR kind <> 'official_event');
ALTER TABLE source_items DROP CONSTRAINT IF EXISTS source_items_entur_official_event_service_alert_check;
ALTER TABLE source_items ADD CONSTRAINT source_items_entur_official_event_service_alert_check
  CHECK (
    provider <> 'entur'
    OR kind <> 'official_event'
    OR (normalized_payload->>'source') IS NOT DISTINCT FROM 'entur_service_alerts'
  );
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM source_items
    WHERE provider NOT IN (
      'nrk','adressa','avisa_st','vg','dagbladet','trondheim_kommune','bane_nor','met','nve','datex',
      'snasningen','merakerposten','frostingen','ytringen','steinkjer_avisa','innherred',
      'namdalsavisa','malviknytt','selbyggen','fjell_ljom','retten','hitra_froya',
      'tronderbladet','nidaros','t_a',
      'datex_travel_time','datex_weather','datex_cctv','trafikkdata','vegvesen_traffic_info',
      'entur','entur_vehicle_positions','entur_service_alerts','dsb','politiloggen','internal',
      'private_annotations','deepseek','web_push'
    )
  ) THEN
    RAISE EXCEPTION 'unknown provider exists in source_items';
  END IF;
END;
$$;
ALTER TABLE source_items DROP CONSTRAINT IF EXISTS source_items_provider_source_id_check;
ALTER TABLE source_items ADD CONSTRAINT source_items_provider_source_id_check
  CHECK (provider IN (
    'nrk','adressa','avisa_st','vg','dagbladet','trondheim_kommune','bane_nor','met','nve','datex',
    'snasningen','merakerposten','frostingen','ytringen','steinkjer_avisa','innherred',
    'namdalsavisa','malviknytt','selbyggen','fjell_ljom','retten','hitra_froya',
    'tronderbladet','nidaros','t_a',
    'datex_travel_time','datex_weather','datex_cctv','trafikkdata','vegvesen_traffic_info',
    'entur','entur_vehicle_positions','entur_service_alerts','dsb','politiloggen','internal',
    'private_annotations','deepseek','web_push'
  ));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM source_items WHERE provider IN ('dsb','web_push')) THEN
    RAISE EXCEPTION 'health-only provider must not exist in source_items';
  END IF;
END;
$$;
ALTER TABLE source_items DROP CONSTRAINT IF EXISTS source_items_no_health_only_provider_check;
ALTER TABLE source_items ADD CONSTRAINT source_items_no_health_only_provider_check
  CHECK (provider NOT IN ('dsb','web_push'));

CREATE UNIQUE INDEX IF NOT EXISTS source_items_provider_kind_external_id_unique
  ON source_items (provider, kind, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS source_items_capture_hash_unique
  ON source_items (capture_hash);
CREATE INDEX IF NOT EXISTS source_items_provider_kind_idx ON source_items (provider, kind);
CREATE INDEX IF NOT EXISTS source_items_fetched_at_idx ON source_items (fetched_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS source_items_geo_hint_idx ON source_items USING gist (geo_hint);

CREATE TABLE IF NOT EXISTS source_item_captures (
  id text PRIMARY KEY,
  source_item_id text NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  provider text NOT NULL,
  kind text NOT NULL,
  external_id text,
  first_seen_at timestamptz NOT NULL,
  published_at timestamptz,
  source_updated_at timestamptz,
  captured_at timestamptz NOT NULL,
  capture_hash text NOT NULL,
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS source_item_captures_provider_capture_hash_unique
  ON source_item_captures (provider, capture_hash);
CREATE INDEX IF NOT EXISTS source_item_captures_item_captured_idx
  ON source_item_captures (source_item_id, captured_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS source_item_captures_provider_captured_idx
  ON source_item_captures (provider, captured_at DESC, id DESC);

-- Backfill the current source projection as its first retained capture.
INSERT INTO source_item_captures (
  id, source_item_id, provider, kind, external_id, first_seen_at, published_at,
  source_updated_at, captured_at, capture_hash, raw_payload, normalized_payload
)
SELECT
  'capture:' || encode(
    digest(jsonb_build_array(si.provider, si.kind, si.capture_hash)::text, 'sha256'),
    'hex'
  ),
  si.id,
  si.provider,
  si.kind,
  si.external_id,
  si.created_at,
  si.published_at,
  NULL,
  si.fetched_at,
  si.capture_hash,
  si.raw_payload,
  si.normalized_payload
FROM source_items si
ON CONFLICT (provider, capture_hash) DO NOTHING;

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

CREATE TABLE IF NOT EXISTS situation_decision_audit (
  id text PRIMARY KEY,
  situation_id text REFERENCES situations(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'candidate_seen',
    'activated',
    'dismissed',
    'resolved',
    'merged',
    'split',
    'context_attached',
    'source_health_changed',
    'ai_summary_generated'
  )),
  activation_rule_id text,
  source_item_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence_item_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  actor text NOT NULL DEFAULT 'system',
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS situation_decision_audit_situation_created_idx
  ON situation_decision_audit (situation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS situation_decision_audit_action_created_idx
  ON situation_decision_audit (action, created_at DESC);
CREATE INDEX IF NOT EXISTS situation_decision_audit_source_item_ids_gin_idx
  ON situation_decision_audit USING gin (source_item_ids);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM situation_source_items ssi
    JOIN source_items si ON si.id = ssi.source_item_id
    WHERE ssi.relationship = 'supports'
      AND (
        si.provider IN (
          'met',
          'nve',
          'datex_travel_time',
          'datex_weather',
          'datex_cctv',
          'trafikkdata',
          'vegvesen_traffic_info',
          'entur_vehicle_positions',
          'entur_service_alerts',
          'bane_nor',
          'dsb'
        )
        OR (si.provider = 'entur' AND si.kind = 'official_event')
      )
  ) THEN
    RAISE EXCEPTION 'telemetry/context source_items are already linked as supports';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_situation_source_item_relationship()
RETURNS trigger AS $$
DECLARE
  source_provider text;
  source_kind text;
BEGIN
  SELECT provider, kind INTO source_provider, source_kind FROM source_items WHERE id = NEW.source_item_id;
  IF NEW.relationship = 'supports'
    AND (
      source_provider IN (
        'met',
        'nve',
        'datex_travel_time',
        'datex_weather',
        'datex_cctv',
        'trafikkdata',
        'vegvesen_traffic_info',
        'entur_vehicle_positions',
        'entur_service_alerts',
        'bane_nor',
        'dsb'
      )
      OR (source_provider = 'entur' AND source_kind = 'official_event')
    )
  THEN
    RAISE EXCEPTION 'source item provider % must be linked as context, not supports', source_provider
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS situation_source_items_relationship_guard ON situation_source_items;
CREATE TRIGGER situation_source_items_relationship_guard
  BEFORE INSERT OR UPDATE OF relationship, source_item_id ON situation_source_items
  FOR EACH ROW EXECUTE FUNCTION enforce_situation_source_item_relationship();

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

CREATE TABLE IF NOT EXISTS datex_travel_time_history (
  corridor_id text NOT NULL,
  observed_at timestamptz NOT NULL,
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
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corridor_id, observed_at)
);
CREATE INDEX IF NOT EXISTS datex_travel_time_history_observed_at_idx
  ON datex_travel_time_history (observed_at DESC);
CREATE INDEX IF NOT EXISTS datex_travel_time_history_corridor_observed_idx
  ON datex_travel_time_history (corridor_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS datex_travel_time_history_delay_idx
  ON datex_travel_time_history (delay_seconds DESC NULLS LAST, observed_at DESC);

CREATE TABLE IF NOT EXISTS road_weather_observations (
  station_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  geometry geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS road_weather_observations_geometry_idx
  ON road_weather_observations USING gist (geometry);

CREATE TABLE IF NOT EXISTS road_cameras (
  camera_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  geometry geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS road_cameras_geometry_idx ON road_cameras USING gist (geometry);

CREATE TABLE IF NOT EXISTS traffic_counter_snapshots (
  point_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  geometry geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS traffic_counter_snapshots_geometry_idx
  ON traffic_counter_snapshots USING gist (geometry);

CREATE TABLE IF NOT EXISTS traffic_counter_snapshot_history (
  point_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  volume_last_hour integer,
  baseline_volume_last_hour integer,
  anomaly_ratio real,
  coverage_percent real,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  geometry geometry(Point, 4326) NOT NULL,
  PRIMARY KEY (point_id, observed_at)
);
CREATE INDEX IF NOT EXISTS traffic_counter_snapshot_history_observed_at_idx
  ON traffic_counter_snapshot_history (observed_at DESC);
CREATE INDEX IF NOT EXISTS traffic_counter_snapshot_history_point_observed_idx
  ON traffic_counter_snapshot_history (point_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS traffic_counter_snapshot_history_anomaly_idx
  ON traffic_counter_snapshot_history (anomaly_ratio DESC NULLS LAST, observed_at DESC);
CREATE INDEX IF NOT EXISTS traffic_counter_snapshot_history_geometry_idx
  ON traffic_counter_snapshot_history USING gist (geometry);

CREATE TABLE IF NOT EXISTS traffic_map_events (
  id text PRIMARY KEY,
  source text NOT NULL,
  source_event_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('roadworks', 'accident', 'closure', 'congestion', 'weather', 'restriction', 'obstruction', 'other')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  state text NOT NULL CHECK (state IN ('planned', 'active', 'expired', 'cancelled')),
  title text NOT NULL,
  description text,
  location_name text,
  road_name text,
  valid_from timestamptz,
  valid_to timestamptz,
  updated_at timestamptz NOT NULL,
  source_url text,
  geometry geometry(Geometry, 4326) NOT NULL,
  raw_type text,
  confidence real,
  payload jsonb NOT NULL,
  source_payload_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_event_id)
);
ALTER TABLE traffic_map_events DROP CONSTRAINT IF EXISTS traffic_map_events_source_check;
ALTER TABLE traffic_map_events ADD CONSTRAINT traffic_map_events_source_check
  CHECK (source IN ('vegvesen_traffic_info'));

CREATE INDEX IF NOT EXISTS traffic_map_events_source_state_idx
  ON traffic_map_events (source, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS traffic_map_events_validity_idx
  ON traffic_map_events (valid_from, valid_to);
CREATE INDEX IF NOT EXISTS traffic_map_events_geometry_idx
  ON traffic_map_events USING gist (geometry);

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

CREATE TABLE IF NOT EXISTS morning_briefs (
  id text PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('ai_assisted', 'deterministic')),
  title text NOT NULL,
  source_line text NOT NULL,
  paragraphs jsonb NOT NULL,
  highlights jsonb NOT NULL,
  article_ids text[] NOT NULL,
  situation_ids text[] NOT NULL,
  ai_run_provider text,
  ai_run_status text,
  ai_run_completed_at timestamptz,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(paragraphs) = 'array'),
  CHECK (jsonb_array_length(paragraphs) = 3),
  CHECK (jsonb_typeof(highlights) = 'array')
);
CREATE INDEX IF NOT EXISTS morning_briefs_generated_at_idx
  ON morning_briefs (generated_at DESC);
CREATE INDEX IF NOT EXISTS morning_briefs_mode_idx ON morning_briefs (mode);

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

CREATE TABLE IF NOT EXISTS public_transport_vehicles (
  id text PRIMARY KEY,
  source text NOT NULL,
  codespace_id text NOT NULL,
  vehicle_id text NOT NULL,
  mode text NOT NULL,
  line_ref text,
  public_code text,
  line_name text,
  operator_ref text,
  operator_name text,
  last_updated timestamptz NOT NULL,
  expires_at timestamptz,
  geometry geometry(Point, 4326) NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codespace_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS public_transport_vehicles_source_seen_idx
  ON public_transport_vehicles (source, stale, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS public_transport_vehicles_geometry_idx
  ON public_transport_vehicles USING gist (geometry);

CREATE TABLE IF NOT EXISTS public_transport_service_alerts (
  id text PRIMARY KEY,
  source text NOT NULL,
  codespace_id text NOT NULL,
  situation_number text NOT NULL,
  severity text,
  report_type text,
  state text NOT NULL CHECK (state IN ('active', 'expired', 'cancelled')),
  summary text NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  updated_at timestamptz NOT NULL,
  geometry geometry(Geometry, 4326),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codespace_id, situation_number)
);
CREATE INDEX IF NOT EXISTS public_transport_service_alerts_state_idx
  ON public_transport_service_alerts (source, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS public_transport_service_alerts_geometry_idx
  ON public_transport_service_alerts USING gist (geometry);

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
ALTER TABLE source_health DROP CONSTRAINT IF EXISTS source_health_source_id_check;
ALTER TABLE source_health ADD CONSTRAINT source_health_source_id_check
  CHECK (source IN (
    'nrk','adressa','avisa_st','vg','dagbladet','trondheim_kommune','bane_nor','met','nve','datex',
    'snasningen','merakerposten','frostingen','ytringen','steinkjer_avisa','innherred',
    'namdalsavisa','malviknytt','selbyggen','fjell_ljom','retten','hitra_froya',
    'tronderbladet','nidaros','t_a',
    'datex_travel_time','datex_weather','datex_cctv','trafikkdata','vegvesen_traffic_info',
    'entur','entur_vehicle_positions','entur_service_alerts','dsb','politiloggen','internal',
    'private_annotations','deepseek','web_push'
  ));
ALTER TABLE source_health DROP CONSTRAINT IF EXISTS source_health_state_check;
ALTER TABLE source_health ADD CONSTRAINT source_health_state_check
  CHECK (state IN ('ok', 'degraded', 'disabled', 'awaiting_access'));

CREATE TABLE IF NOT EXISTS collector_state (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_cycle_metrics (
  id text PRIMARY KEY CHECK (id = 'latest'),
  cycle_started_at timestamptz NOT NULL,
  cycle_completed_at timestamptz NOT NULL,
  cycle_duration_ms integer NOT NULL CHECK (cycle_duration_ms >= 0),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collector_runs (
  id text PRIMARY KEY,
  source text NOT NULL,
  collector text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'partial', 'failed', 'skipped', 'running')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  records_seen integer NOT NULL DEFAULT 0 CHECK (records_seen >= 0),
  records_accepted integer NOT NULL DEFAULT 0 CHECK (records_accepted >= 0),
  records_rejected integer NOT NULL DEFAULT 0 CHECK (records_rejected >= 0),
  error_code text,
  error_message text,
  diagnostics jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collector_runs_source_started_idx
  ON collector_runs (source, started_at DESC);
CREATE INDEX IF NOT EXISTS collector_runs_started_idx
  ON collector_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS access_requests (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_normalized text NOT NULL,
  display_name text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  email_verified_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  reviewer_note text,
  CHECK (length(trim(email)) > 3),
  CHECK (length(trim(email_normalized)) > 3),
  CHECK (length(trim(display_name)) >= 2)
);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_email_normalized_unique
  ON access_requests (email_normalized);
CREATE INDEX IF NOT EXISTS access_requests_status_requested_idx
  ON access_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_requested_idx
  ON access_requests (requested_at DESC);

ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE access_requests ALTER COLUMN status SET DEFAULT 'unverified';
DO $$
BEGIN
  ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS access_requests_status_check;
  ALTER TABLE access_requests
    ADD CONSTRAINT access_requests_status_check
    CHECK (status IN ('unverified', 'pending', 'approved', 'rejected'));
END $$;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text,
  email_normalized text,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CHECK (role = 'owner' OR length(trim(coalesce(email_normalized, ''))) > 3),
  CHECK (length(trim(display_name)) >= 2)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique
  ON users (email_normalized)
  WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_role_status_idx
  ON users (role, status);

CREATE TABLE IF NOT EXISTS coverage_bundle_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES coverage_bundle_generations(id) ON DELETE RESTRICT,
  original_bundle_id text NOT NULL,
  anchor_article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  rejected_article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  matcher_version text NOT NULL CHECK (matcher_version IN ('v1', 'v2')),
  evidence_fingerprint text NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  status text NOT NULL CHECK (status IN ('active', 'reverted')),
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by text REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (anchor_article_id <> rejected_article_id),
  CHECK (
    (status = 'active' AND reverted_at IS NULL AND reverted_by IS NULL)
    OR (status = 'reverted' AND reverted_at IS NOT NULL AND reverted_by IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS coverage_bundle_corrections_active_pair_idx
  ON coverage_bundle_corrections (
    LEAST(anchor_article_id, rejected_article_id),
    GREATEST(anchor_article_id, rejected_article_id)
  )
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS coverage_bundle_corrections_original_bundle_idx
  ON coverage_bundle_corrections (original_bundle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coverage_bundle_corrections_generation_idx
  ON coverage_bundle_corrections (generation_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS coverage_projection_revisions (
  projection text PRIMARY KEY CHECK (projection = 'active'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  legacy_revision bigint NOT NULL DEFAULT 0 CHECK (legacy_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coverage_projection_revisions
  ADD COLUMN IF NOT EXISTS legacy_revision bigint NOT NULL DEFAULT 0 CHECK (legacy_revision >= 0);
INSERT INTO coverage_projection_revisions (projection, revision)
VALUES ('active', 0)
ON CONFLICT (projection) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_identities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github', 'email')),
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS user_identities_user_idx
  ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('access_verify', 'invite', 'login')),
  access_request_id text REFERENCES access_requests(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  email text,
  email_normalized text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CHECK (
    (kind = 'access_verify' AND access_request_id IS NOT NULL) OR
    (kind IN ('invite', 'login') AND user_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS auth_tokens_kind_expires_idx
  ON auth_tokens (kind, expires_at DESC);
CREATE INDEX IF NOT EXISTS auth_tokens_access_request_idx
  ON auth_tokens (access_request_id);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx
  ON auth_tokens (user_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  endpoint text NOT NULL,
  endpoint_hash text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  enabled boolean NOT NULL DEFAULT true,
  min_severity text NOT NULL DEFAULT 'warning' CHECK (min_severity IN ('critical', 'warning', 'watch')),
  kinds text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  revoked_at timestamptz,
  CHECK (length(trim(endpoint)) > 20),
  CHECK (length(trim(endpoint_hash)) >= 16),
  CHECK (length(trim(p256dh)) >= 20),
  CHECK (length(trim(auth)) >= 8),
  CHECK (
    kinds <@ ARRAY[
      'public_safety',
      'traffic_disruption',
      'weather_hazard',
      'service_disruption'
    ]::text[]
  )
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id, enabled);
CREATE INDEX IF NOT EXISTS push_subscriptions_last_seen_idx
  ON push_subscriptions (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS push_notification_deliveries (
  id text PRIMARY KEY,
  trigger_id text NOT NULL,
  subscription_id text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'sent', 'failed', 'skipped')),
  kind text NOT NULL CHECK (kind IN ('public_safety', 'traffic_disruption', 'weather_hazard', 'service_disruption')),
  severity text NOT NULL CHECK (severity IN ('critical', 'warning', 'watch')),
  title text NOT NULL,
  body text NOT NULL,
  target_url text,
  error_message text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (trigger_id, subscription_id),
  CHECK (length(trim(trigger_id)) > 0),
  CHECK (length(trim(subscription_id)) > 0),
  CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS push_notification_deliveries_created_idx
  ON push_notification_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS push_notification_deliveries_trigger_idx
  ON push_notification_deliveries (trigger_id);
CREATE INDEX IF NOT EXISTS push_notification_deliveries_subscription_idx
  ON push_notification_deliveries (subscription_id);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

INSERT INTO schema_migrations (version) VALUES ('001_safe_launch_schema') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('002_situation_trustworthiness') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('003_collector_state') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('004_traffic_map_events') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('005_road_context') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('006_trafikkdata_counters') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('007_entur_public_transport') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('008_worker_cycle_metrics') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('009_collector_runs') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('010_coverage_bundles') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('011_access_requests') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('012_restricted_beta_auth') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('013_morning_briefs') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('014_web_push_notifications') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('015_home_feed_read_indexes') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('016_coverage_bundle_lifecycle') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('017_coverage_legacy_snapshot') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('018_coverage_effective_projection') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('019_coverage_projection_integrity') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('020_source_item_capture_history') ON CONFLICT DO NOTHING;
