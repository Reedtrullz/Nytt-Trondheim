BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_check_violation(
  label text,
  stmt text,
  expected_constraint text,
  expected_message_like text
) RETURNS void AS $$
DECLARE
  got_constraint text;
  got_message text;
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE EXCEPTION 'expected % to fail with check_violation', label;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS
      got_constraint = CONSTRAINT_NAME,
      got_message = MESSAGE_TEXT;
    IF expected_constraint IS NOT NULL AND got_constraint IS DISTINCT FROM expected_constraint THEN
      RAISE EXCEPTION '% failed on %, expected %: %',
        label, got_constraint, expected_constraint, got_message;
    END IF;
    IF expected_message_like IS NOT NULL AND got_message NOT LIKE expected_message_like THEN
      RAISE EXCEPTION '% failed with %, expected LIKE %',
        label, got_message, expected_message_like;
    END IF;
  END;
END;
$$ LANGUAGE plpgsql;

INSERT INTO situations (id, type, status, verification_status, importance, updated_at, payload)
VALUES ('ci-guardrail-situation', 'ci', 'active', 'unverified', 'low', now(), '{}'::jsonb);

INSERT INTO coverage_bundles (
  id,
  kind,
  confidence,
  reason,
  generated_at,
  last_seen_at,
  primary_article_id,
  member_article_ids,
  source_ids,
  source_labels,
  signals,
  near_misses,
  payload
) VALUES (
  'ci-coverage-derived-bundle',
  'incident',
  'high',
  'Derived analysis must stay outside source_items',
  now(),
  now(),
  'ci-article-primary',
  ARRAY['ci-article-primary', 'ci-article-secondary'],
  ARRAY['nrk', 'politiloggen'],
  ARRAY['NRK Trøndelag', 'Politiloggen'],
  '[{"kind":"generic_place_incident","articleIds":["ci-article-primary","ci-article-secondary"]}]'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb
);

DO $$
DECLARE
  coverage_source_item_count integer;
BEGIN
  SELECT count(*) INTO coverage_source_item_count
  FROM source_items
  WHERE provider = 'coverage_bundles'
     OR kind = 'coverage_bundle'
     OR external_id = 'ci-coverage-derived-bundle';

  IF coverage_source_item_count <> 0 THEN
    RAISE EXCEPTION 'coverage_bundles must not create source_items rows';
  END IF;
END;
$$;

SELECT pg_temp.expect_check_violation(
  'Entur must not be officialSource for situations',
  $$INSERT INTO situations (
      id, type, status, verification_status, importance, updated_at, payload
    ) VALUES (
      'ci-invalid-official-source',
      'ci',
      'active',
      'unverified',
      'low',
      now(),
      '{"officialSource":"entur"}'::jsonb
    )$$,
  'situations_official_source_check',
  NULL
);

SELECT pg_temp.expect_check_violation(
  'MET must not activate situations via activationBasis',
  $$INSERT INTO situations (
      id, type, status, verification_status, importance, updated_at, payload
    ) VALUES (
      'ci-invalid-activation-source',
      'ci',
      'active',
      'unverified',
      'low',
      now(),
      '{"activationBasis":{"rule":"two_independent_sources","sourceIds":["met"],"articleIds":["ci-met"],"activatedAt":"2026-06-18T00:00:00.000Z"}}'::jsonb
    )$$,
  'situations_activation_sources_no_context_source_check',
  NULL
);

SELECT pg_temp.expect_check_violation(
  'DATEX context sources must not enter situation_activations',
  $$INSERT INTO situation_activations (
      situation_id, incident_signature, detection_version, source_ids, article_ids, activated_at
    ) VALUES (
      'ci-guardrail-situation',
      'ci-invalid-datex-weather',
      'ci',
      '["datex_weather"]'::jsonb,
      '["ci-datex-weather"]'::jsonb,
      now()
    )$$,
  'situation_activations_source_ids_no_context_source_check',
  NULL
);

SELECT pg_temp.expect_check_violation(
  'DSB must stay out of evidence_items',
  $$INSERT INTO evidence_items (
      id, situation_id, source, source_url, provenance, confidence, payload, extracted_at
    ) VALUES (
      'ci-evidence-dsb',
      'ci-guardrail-situation',
      'dsb',
      'https://example.invalid/ci',
      'official',
      0.1,
      '{}'::jsonb,
      now()
    )$$,
  'evidence_items_no_health_only_source_check',
  NULL
);

SELECT pg_temp.expect_check_violation(
  'telemetry evidence ' || source_id,
  format(
    $stmt$INSERT INTO evidence_items (
        id, situation_id, source, source_url, provenance, confidence, payload, extracted_at
      ) VALUES (
        %L,
        'ci-guardrail-situation',
        %L,
        'https://example.invalid/ci',
        'preparedness_context',
        0.1,
        '{}'::jsonb,
        now()
      )$stmt$,
    'ci-evidence-' || source_id,
    source_id
  ),
  'evidence_items_no_telemetry_source_check',
  NULL
)
FROM unnest(ARRAY[
  'datex_travel_time',
  'datex_weather',
  'datex_cctv',
  'trafikkdata',
  'entur_vehicle_positions'
]::text[]) AS forbidden(source_id);

SELECT pg_temp.expect_check_violation(
  'DSB must stay out of source_items',
  $$INSERT INTO source_items (
      id, provider, kind, fetched_at, raw_payload, normalized_payload, capture_hash, reliability_tier
    ) VALUES (
      'ci-source-dsb',
      'dsb',
      'warning',
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      'ci-hash-dsb',
      'official'
    )$$,
  'source_items_no_health_only_provider_check',
  NULL
);

SELECT pg_temp.expect_check_violation(
  'Entur vehicle positions cannot masquerade as official_event',
  $$INSERT INTO source_items (
      id, provider, kind, fetched_at, raw_payload, normalized_payload, capture_hash, reliability_tier
    ) VALUES (
      'ci-source-entur-vehicle-official',
      'entur_vehicle_positions',
      'official_event',
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      'ci-hash-entur-vehicle-official',
      'official'
    )$$,
  'source_items_entur_vehicle_positions_kind_check',
  NULL
);

SELECT pg_temp.expect_check_violation(
  'Entur official_event source_items must be service alerts',
  $$INSERT INTO source_items (
      id, provider, kind, fetched_at, raw_payload, normalized_payload, capture_hash, reliability_tier
    ) VALUES (
      'ci-source-entur-non-service-official',
      'entur',
      'official_event',
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      'ci-hash-entur-non-service-official',
      'official'
    )$$,
  'source_items_entur_official_event_service_alert_check',
  NULL
);

CREATE TEMP TABLE ci_context_provider(provider text PRIMARY KEY);
INSERT INTO ci_context_provider(provider)
VALUES
  ('met'),
  ('nve'),
  ('datex_travel_time'),
  ('datex_weather'),
  ('datex_cctv'),
  ('trafikkdata'),
  ('vegvesen_traffic_info'),
  ('entur_vehicle_positions'),
  ('entur_service_alerts'),
  ('bane_nor');

INSERT INTO source_items (
  id,
  provider,
  kind,
  fetched_at,
  raw_payload,
  normalized_payload,
  capture_hash,
  reliability_tier
)
SELECT
  'ci-source-' || provider,
  provider,
  'warning',
  now(),
  jsonb_build_object('provider', provider),
  jsonb_build_object('provider', provider),
  'ci-hash-' || provider,
  'official'
FROM ci_context_provider;

INSERT INTO source_items (
  id,
  provider,
  kind,
  fetched_at,
  raw_payload,
  normalized_payload,
  capture_hash,
  reliability_tier
) VALUES (
  'ci-source-entur-official',
  'entur',
  'official_event',
  now(),
  '{}'::jsonb,
  '{"source":"entur_service_alerts"}'::jsonb,
  'ci-hash-entur-official',
  'official'
);

SELECT pg_temp.expect_check_violation(
  'supporting link from context source_item ' || source_item_id,
  format(
    $stmt$INSERT INTO situation_source_items (
        situation_id, source_item_id, relationship, linked_by
      ) VALUES (
        'ci-guardrail-situation',
        %L,
        'supports',
        'ci-migration-smoke'
      )$stmt$,
    source_item_id
  ),
  NULL,
  'source item provider % must be linked as context, not supports'
)
FROM (
  SELECT 'ci-source-' || provider AS source_item_id FROM ci_context_provider
  UNION ALL
  SELECT 'ci-source-entur-official'
) AS forbidden_support;

INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_by)
SELECT 'ci-guardrail-situation', source_item_id, 'context', 'ci-migration-smoke'
FROM (
  SELECT 'ci-source-' || provider AS source_item_id FROM ci_context_provider
  UNION ALL
  SELECT 'ci-source-entur-official'
) AS allowed_context;

SELECT pg_temp.expect_check_violation(
  'derived news traffic events must not be persisted in traffic_map_events',
  $$INSERT INTO traffic_map_events (
      id,
      source,
      source_event_id,
      category,
      severity,
      state,
      title,
      updated_at,
      geometry,
      payload,
      source_payload_hash
    ) VALUES (
      'ci-news-traffic-event',
      'news_article',
      'ci-news-traffic-event',
      'closure',
      'high',
      'active',
      'Nyhetsbasert estimert trafikkhendelse',
      now(),
      ST_SetSRID(ST_MakePoint(10.4, 63.4), 4326),
      '{"source":"news_article"}'::jsonb,
      'ci-news-traffic-hash'
    )$$,
  'traffic_map_events_source_check',
  NULL
);

ROLLBACK;
