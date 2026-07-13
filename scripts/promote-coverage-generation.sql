\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE coverage_promotion_request (
  reviewed_generation_id uuid NOT NULL
) ON COMMIT DROP;
INSERT INTO coverage_promotion_request VALUES (:'reviewed_generation_id'::uuid);

DO $$
DECLARE
  reviewed_generation_id uuid;
  candidate_generation_id uuid;
  candidate_bundle_count integer;
  latest_shadow_id uuid;
  recent_clean boolean;
  parity_dirty integer;
  integrity_dirty integer;
  promoted_count integer;
  activated_bundle_count integer;
  current_count integer;
BEGIN
  -- Shared with WorkerRepository.persistCoverageGeneration.
  PERFORM pg_advisory_xact_lock(20260713, 7);
  SELECT request.reviewed_generation_id INTO STRICT reviewed_generation_id
  FROM coverage_promotion_request request;

  SELECT id, bundle_count INTO candidate_generation_id, candidate_bundle_count
  FROM coverage_bundle_generations
  WHERE id=reviewed_generation_id
    AND matcher_version='v2' AND mode='shadow' AND status='completed'
  FOR UPDATE;
  IF candidate_generation_id IS NULL THEN
    RAISE EXCEPTION 'reviewed completed v2 shadow generation is missing';
  END IF;

  SELECT id INTO latest_shadow_id
  FROM coverage_bundle_generations
  WHERE matcher_version='v2' AND mode='shadow' AND status='completed'
  ORDER BY completed_at DESC, id DESC
  LIMIT 1;
  IF latest_shadow_id IS DISTINCT FROM reviewed_generation_id THEN
    RAISE EXCEPTION 'reviewed generation is not the latest completed v2 shadow';
  END IF;

  WITH recent AS (
    SELECT * FROM coverage_bundle_generations
    WHERE matcher_version='v2' AND mode='shadow' AND status='completed'
    ORDER BY completed_at DESC LIMIT 7
  )
  SELECT count(*) = 7
    AND bool_and(health_outcome = 'healthy')
    AND min(completed_at) > now() - interval '24 hours'
  INTO recent_clean FROM recent;
  IF NOT COALESCE(recent_clean, false) THEN
    RAISE EXCEPTION 'seven recent completed v2 shadow generations are required';
  END IF;

  WITH legacy AS (
    SELECT ARRAY(SELECT DISTINCT unnest(member_article_ids) ORDER BY 1) AS members,
           primary_article_id
    FROM coverage_bundles
    WHERE legacy_generation_id=reviewed_generation_id
      AND state='legacy' AND matcher_version='v1'
  ), normalized AS (
    SELECT array_agg(DISTINCT cbm.article_id ORDER BY cbm.article_id) AS members,
           cbv.primary_article_id
    FROM coverage_bundle_versions cbv
    JOIN coverage_bundle_members cbm
      ON cbm.generation_id=cbv.generation_id AND cbm.bundle_id=cbv.bundle_id
    WHERE cbv.generation_id=reviewed_generation_id
    GROUP BY cbv.bundle_id, cbv.primary_article_id
  ), mismatches AS (
    (SELECT * FROM legacy EXCEPT ALL SELECT * FROM normalized)
    UNION ALL
    (SELECT * FROM normalized EXCEPT ALL SELECT * FROM legacy)
  )
  SELECT count(*) INTO parity_dirty FROM mismatches;

  SELECT
    (SELECT count(*) FROM coverage_bundle_members cbm
     LEFT JOIN articles a ON a.id=cbm.article_id
     WHERE cbm.generation_id=reviewed_generation_id AND a.id IS NULL)
    +
    (SELECT count(*) FROM (
       SELECT cbv.bundle_id
       FROM coverage_bundle_versions cbv
       LEFT JOIN coverage_bundle_members cbm
         ON cbm.generation_id=cbv.generation_id
        AND cbm.bundle_id=cbv.bundle_id AND cbm.role='primary'
       WHERE cbv.generation_id=reviewed_generation_id
       GROUP BY cbv.bundle_id
       HAVING count(cbm.article_id) <> 1
     ) invalid_primary)
    +
    (SELECT CASE WHEN
       cg.article_count = (SELECT count(*) FROM coverage_generation_articles cga
                           WHERE cga.generation_id=cg.id)
       AND cg.bundle_count = (SELECT count(*) FROM coverage_bundle_versions cbv
                              WHERE cbv.generation_id=cg.id)
     THEN 0 ELSE 1 END
     FROM coverage_bundle_generations cg WHERE cg.id=reviewed_generation_id)
  INTO integrity_dirty;
  IF parity_dirty <> 0 THEN
    RAISE EXCEPTION 'v2 shadow paired base parity is dirty';
  END IF;
  IF integrity_dirty <> 0 THEN
    RAISE EXCEPTION 'v2 shadow integrity is dirty';
  END IF;

  UPDATE coverage_bundle_generations
  SET mode='active'
  WHERE id=reviewed_generation_id
    AND matcher_version='v2' AND mode='shadow' AND status='completed';
  GET DIAGNOSTICS promoted_count = ROW_COUNT;
  IF promoted_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one guarded coverage promotion, got %', promoted_count;
  END IF;

  UPDATE coverage_bundles SET state='superseded'
  WHERE matcher_version='v2' AND state='active'
    AND generation_id IS DISTINCT FROM reviewed_generation_id;

  UPDATE coverage_bundles SET state='active'
  WHERE generation_id=reviewed_generation_id AND matcher_version='v2';
  GET DIAGNOSTICS activated_bundle_count = ROW_COUNT;
  IF activated_bundle_count <> candidate_bundle_count THEN
    RAISE EXCEPTION 'stable bundle activation mismatch: expected %, got %',
      candidate_bundle_count, activated_bundle_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM coverage_bundles
    WHERE matcher_version='v2' AND state='active'
      AND generation_id IS DISTINCT FROM reviewed_generation_id
  ) THEN
    RAISE EXCEPTION 'another active v2 stable projection remains after promotion';
  END IF;

  UPDATE coverage_bundle_generations
  SET is_current=false WHERE is_current AND id<>reviewed_generation_id;
  UPDATE coverage_bundle_generations
  SET is_current=true WHERE id=reviewed_generation_id AND mode='active';
  GET DIAGNOSTICS current_count = ROW_COUNT;
  IF current_count <> 1 THEN
    RAISE EXCEPTION 'promoted generation did not become current';
  END IF;
END
$$;
COMMIT;
