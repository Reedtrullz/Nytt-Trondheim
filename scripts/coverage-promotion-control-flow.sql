\set ON_ERROR_STOP on
BEGIN;

UPDATE coverage_bundle_generations SET is_current=false WHERE is_current;

INSERT INTO articles (id, canonical_url, dedupe_key, source, published_at, scope, category, payload)
VALUES
  ('ci-promotion-a','https://example.test/ci-promotion-a','ci-promotion-a','nrk',now(),'trondheim','Hendelser','{}'),
  ('ci-promotion-b','https://example.test/ci-promotion-b','ci-promotion-b','adressa',now(),'trondheim','Hendelser','{}');

INSERT INTO coverage_bundle_generations
  (id,matcher_version,mode,status,started_at,completed_at,article_count,bundle_count,edge_count,
   correction_conflict_count,is_current)
VALUES
  ('00000000-0000-4000-8000-000000000810','v2','active','completed',now()-interval '3 hours',now()-interval '3 hours',0,0,0,0,true),
  ('00000000-0000-4000-8000-000000000811','v2','shadow','completed',now()-interval '7 minutes',now()-interval '7 minutes',0,0,0,0,false),
  ('00000000-0000-4000-8000-000000000812','v2','shadow','completed',now()-interval '6 minutes',now()-interval '6 minutes',0,0,0,0,false),
  ('00000000-0000-4000-8000-000000000813','v2','shadow','completed',now()-interval '5 minutes',now()-interval '5 minutes',0,0,0,0,false),
  ('00000000-0000-4000-8000-000000000814','v2','shadow','completed',now()-interval '4 minutes',now()-interval '4 minutes',0,0,0,0,false),
  ('00000000-0000-4000-8000-000000000815','v2','shadow','completed',now()-interval '3 minutes',now()-interval '3 minutes',0,0,0,0,false),
  ('00000000-0000-4000-8000-000000000816','v2','shadow','completed',now()-interval '2 minutes',now()-interval '2 minutes',0,0,0,0,false),
  ('00000000-0000-4000-8000-000000000817','v2','shadow','completed',now()-interval '1 minute',now()-interval '1 minute',2,1,0,0,false);

UPDATE coverage_bundle_generations
SET health_outcome='healthy'
WHERE id BETWEEN '00000000-0000-4000-8000-000000000811'::uuid
             AND '00000000-0000-4000-8000-000000000817'::uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM coverage_bundle_generations
    WHERE matcher_version='v2' AND mode='active' AND status='completed' AND is_current
      AND health_outcome='healthy'
  ) THEN
    RAISE EXCEPTION 'unchecked active v2 generation bypassed promotion';
  END IF;
END
$$;

INSERT INTO coverage_generation_articles (generation_id,article_id)
VALUES
  ('00000000-0000-4000-8000-000000000817','ci-promotion-a'),
  ('00000000-0000-4000-8000-000000000817','ci-promotion-b');

INSERT INTO coverage_bundles
  (id,kind,confidence,reason,generated_at,last_seen_at,primary_article_id,member_article_ids,
   source_ids,source_labels,payload,state,matcher_version,legacy_generation_id,generation_id,
   match_tier,match_score,match_rationale,first_seen_at)
VALUES
  ('ci-promotion-dropped-history','incident','high','Historical only',now(),now(),
   'ci-promotion-a',ARRAY['ci-promotion-a','ci-promotion-b'],ARRAY['nrk','adressa'],
   ARRAY['NRK','Adresseavisen'],'{}','superseded','v1','00000000-0000-4000-8000-000000000811',
   NULL,NULL,NULL,NULL,NULL),
  ('ci-promotion-paired-legacy','incident','high','Paired current',now(),now(),
   'ci-promotion-a',ARRAY['ci-promotion-a','ci-promotion-b'],ARRAY['nrk','adressa'],
   ARRAY['NRK','Adresseavisen'],'{}','superseded','v1','00000000-0000-4000-8000-000000000817',
   NULL,NULL,NULL,NULL,NULL),
  ('ci-promotion-normalized','incident','high','Paired current',now(),now(),
   'ci-promotion-a',ARRAY['ci-promotion-a','ci-promotion-b'],ARRAY['nrk','adressa'],
   ARRAY['NRK','Adresseavisen'],'{}','shadow','v2',NULL,
   '00000000-0000-4000-8000-000000000817','strong',1,'CI promotion control flow',now());

INSERT INTO coverage_bundles
  (id,kind,confidence,reason,generated_at,last_seen_at,primary_article_id,member_article_ids,
   source_ids,source_labels,payload,state,matcher_version,generation_id,
   match_tier,match_score,match_rationale,first_seen_at)
VALUES
  ('ci-promotion-stale-active','incident','high','Must be pruned',now(),now(),
   'ci-promotion-a',ARRAY['ci-promotion-a','ci-promotion-b'],ARRAY['nrk','adressa'],
   ARRAY['NRK','Adresseavisen'],'{}','active','v2','00000000-0000-4000-8000-000000000810',
   'strong',1,'Stale active stable row',now());

INSERT INTO coverage_bundle_versions
  (generation_id,bundle_id,kind,confidence,reason,primary_article_id,match_tier,match_score,
   match_rationale,generated_at,last_seen_at,source_ids,source_labels)
VALUES
  ('00000000-0000-4000-8000-000000000817','ci-promotion-normalized','incident','high',
   'Paired current','ci-promotion-a','strong',1,'CI promotion control flow',now(),now(),
   ARRAY['nrk','adressa'],ARRAY['NRK','Adresseavisen']);
INSERT INTO coverage_bundle_members (generation_id,bundle_id,article_id,role)
VALUES
  ('00000000-0000-4000-8000-000000000817','ci-promotion-normalized','ci-promotion-a','primary'),
  ('00000000-0000-4000-8000-000000000817','ci-promotion-normalized','ci-promotion-b','supporting');

CREATE FUNCTION pg_temp.promote_coverage(reviewed_generation_id uuid, force_zero boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  candidate_generation_id uuid;
  candidate_bundle_count integer;
  latest_shadow_id uuid;
  recent_clean boolean;
  parity_dirty integer;
  integrity_dirty integer;
  promoted_count integer;
  activated_bundle_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(20260713, 7);
  SELECT id,bundle_count INTO candidate_generation_id,candidate_bundle_count
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
  ORDER BY completed_at DESC,id DESC LIMIT 1;
  IF latest_shadow_id IS DISTINCT FROM reviewed_generation_id THEN
    RAISE EXCEPTION 'reviewed generation is not latest';
  END IF;
  WITH recent AS (
    SELECT * FROM coverage_bundle_generations
    WHERE matcher_version='v2' AND mode='shadow' AND status='completed'
    ORDER BY completed_at DESC LIMIT 7
  )
  SELECT count(*)=7 AND bool_and(health_outcome='healthy')
    AND min(completed_at)>now()-interval '24 hours'
  INTO recent_clean FROM recent;
  IF NOT COALESCE(recent_clean,false) THEN RAISE EXCEPTION 'recent history failed'; END IF;
  WITH legacy AS (
    SELECT ARRAY(SELECT DISTINCT unnest(member_article_ids) ORDER BY 1) members,
           primary_article_id
    FROM coverage_bundles
    WHERE legacy_generation_id=reviewed_generation_id
      AND state='superseded' AND matcher_version='v1'
  ), normalized AS (
    SELECT array_agg(DISTINCT cbm.article_id ORDER BY cbm.article_id) members,
           cbv.primary_article_id
    FROM coverage_bundle_versions cbv
    JOIN coverage_bundle_members cbm
      ON cbm.generation_id=cbv.generation_id AND cbm.bundle_id=cbv.bundle_id
    WHERE cbv.generation_id=reviewed_generation_id
    GROUP BY cbv.bundle_id,cbv.primary_article_id
  ), mismatches AS (
    (SELECT * FROM legacy EXCEPT ALL SELECT * FROM normalized)
    UNION ALL
    (SELECT * FROM normalized EXCEPT ALL SELECT * FROM legacy)
  ) SELECT count(*) INTO parity_dirty FROM mismatches;
  IF parity_dirty<>0 THEN RAISE EXCEPTION 'paired parity failed'; END IF;
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
       cg.article_count=(SELECT count(*) FROM coverage_generation_articles cga
                         WHERE cga.generation_id=cg.id)
       AND cg.bundle_count=(SELECT count(*) FROM coverage_bundle_versions cbv
                            WHERE cbv.generation_id=cg.id)
     THEN 0 ELSE 1 END
     FROM coverage_bundle_generations cg WHERE cg.id=reviewed_generation_id)
  INTO integrity_dirty;
  IF integrity_dirty<>0 THEN RAISE EXCEPTION 'v2 shadow integrity is dirty'; END IF;
  UPDATE coverage_bundle_generations SET mode='active'
  WHERE id=reviewed_generation_id AND matcher_version='v2' AND mode='shadow'
    AND status='completed' AND NOT force_zero;
  GET DIAGNOSTICS promoted_count = ROW_COUNT;
  IF promoted_count<>1 THEN RAISE EXCEPTION 'guarded update affected % rows',promoted_count; END IF;
  UPDATE coverage_bundles SET state='superseded'
  WHERE matcher_version='v2' AND state='active'
    AND generation_id IS DISTINCT FROM reviewed_generation_id;
  UPDATE coverage_bundles SET state='active'
  WHERE generation_id=reviewed_generation_id AND matcher_version='v2';
  GET DIAGNOSTICS activated_bundle_count = ROW_COUNT;
  IF activated_bundle_count<>candidate_bundle_count THEN
    RAISE EXCEPTION 'stable bundle activation mismatch: expected %, got %',
      candidate_bundle_count,activated_bundle_count;
  END IF;
  IF EXISTS (SELECT 1 FROM coverage_bundles
             WHERE matcher_version='v2' AND state='active'
               AND generation_id IS DISTINCT FROM reviewed_generation_id) THEN
    RAISE EXCEPTION 'another active v2 stable projection remains';
  END IF;
  UPDATE coverage_bundle_generations SET is_current=false
  WHERE is_current AND id<>reviewed_generation_id;
  UPDATE coverage_bundle_generations SET is_current=true WHERE id=reviewed_generation_id;
END
$$;

DO $$
BEGIN
  BEGIN
    PERFORM pg_temp.promote_coverage('00000000-0000-4000-8000-000000000816',false);
    RAISE EXCEPTION 'older reviewed UUID was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not latest%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM coverage_bundle_generations
                 WHERE id='00000000-0000-4000-8000-000000000810' AND is_current) THEN
    RAISE EXCEPTION 'older UUID rejection changed previous current';
  END IF;

  UPDATE coverage_bundle_generations SET health_outcome='unchecked'
  WHERE id='00000000-0000-4000-8000-000000000817';
  BEGIN
    PERFORM pg_temp.promote_coverage('00000000-0000-4000-8000-000000000817',false);
    RAISE EXCEPTION 'unchecked candidate health was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%recent history failed%' THEN RAISE; END IF;
  END;
  UPDATE coverage_bundle_generations SET health_outcome='healthy'
  WHERE id='00000000-0000-4000-8000-000000000817';

  -- The dropped historical legacy row is ignored because its marker belongs to generation 811.
  BEGIN
    PERFORM pg_temp.promote_coverage('00000000-0000-4000-8000-000000000817',true);
    RAISE EXCEPTION 'forced zero-row promotion was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%guarded update affected 0 rows%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM coverage_bundle_generations
                 WHERE id='00000000-0000-4000-8000-000000000810' AND is_current) THEN
    RAISE EXCEPTION 'zero-row guarded update changed previous current';
  END IF;

  UPDATE coverage_bundles SET generation_id=NULL,state='superseded'
  WHERE id='ci-promotion-normalized';
  BEGIN
    PERFORM pg_temp.promote_coverage('00000000-0000-4000-8000-000000000817',false);
    RAISE EXCEPTION 'stable bundle count mismatch was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%stable bundle activation mismatch%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM coverage_bundle_generations
                 WHERE id='00000000-0000-4000-8000-000000000810' AND is_current) THEN
    RAISE EXCEPTION 'stable bundle mismatch changed previous current';
  END IF;
  UPDATE coverage_bundles
  SET generation_id='00000000-0000-4000-8000-000000000817',state='shadow'
  WHERE id='ci-promotion-normalized';

  UPDATE coverage_bundles SET primary_article_id='ci-promotion-b'
  WHERE id='ci-promotion-paired-legacy';
  BEGIN
    PERFORM pg_temp.promote_coverage('00000000-0000-4000-8000-000000000817',false);
    RAISE EXCEPTION 'paired mismatch was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%paired parity failed%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM coverage_bundle_generations
                 WHERE id='00000000-0000-4000-8000-000000000810' AND is_current) THEN
    RAISE EXCEPTION 'paired mismatch changed previous current';
  END IF;
  UPDATE coverage_bundles SET primary_article_id='ci-promotion-a'
  WHERE id='ci-promotion-paired-legacy';
END
$$;

COMMIT;

\set reviewed_generation_id '00000000-0000-4000-8000-000000000817'
\ir promote-coverage-generation.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM coverage_bundle_generations
    WHERE id='00000000-0000-4000-8000-000000000817'
      AND mode='active' AND is_current AND status='completed' AND health_outcome='healthy'
  ) THEN
    RAISE EXCEPTION 'promoted generation is not the only healthy current v2';
  END IF;
  IF (SELECT count(*) FROM coverage_bundles
      WHERE generation_id='00000000-0000-4000-8000-000000000817' AND state='active') <> 1 THEN
    RAISE EXCEPTION 'production promotion SQL did not activate the exact stable bundle count';
  END IF;
  IF EXISTS (SELECT 1 FROM coverage_bundles
             WHERE matcher_version='v2' AND state='active'
               AND generation_id<>'00000000-0000-4000-8000-000000000817') THEN
    RAISE EXCEPTION 'promotion left another active v2 stable row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM coverage_bundles
                 WHERE id='ci-promotion-stale-active' AND state='superseded') THEN
    RAISE EXCEPTION 'promotion did not prune the stale active v2 stable row';
  END IF;
END
$$;
