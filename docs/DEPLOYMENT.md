# Deployment

The repository follows the RFMC release pattern:

1. Pull requests and pushes to `main` run `CI`: typecheck, lint/format checks, tests, browser checks, production build, audit and Docker builds.
2. When repository variable `NYTT_DEPLOY_ENABLED=true` is configured, a successful `CI` workflow on `main` triggers `Deploy to VPS`; manual dispatch remains available for an intentional first release.
3. For a new or repaired origin, the manual `Provision Origin` workflow connects with the existing VPS key, installs the dedicated Actions key and repository-scoped read-only checkout key, and provisions the Caddy hostname.
4. GitHub Actions connects to the VPS as `deploy` and runs `ansible-playbook.yml`; the VPS uses its own repository-scoped read-only deploy key at `~/.ssh/nytt_github_deploy` to clone this private repository.
5. Ansible checks out the exact CI-verified commit, installs/configures backup tooling, pulls/builds fresh Docker images, verifies an encrypted pre-migration backup, applies locked transactional migrations, health-checks a canary API container on a separate localhost port, promotes API/worker only after the canary is healthy, validates and reloads Caddy, then runs production health, worker, source-health and source-item sanity checks. The current production API/worker stay up through backup and canary, but migrations run before canary against the production database, so application migrations must be expand/contract-compatible with the previous release; destructive schema changes must be split into a later deploy or paired with an explicit restore/rollback procedure.

The deploy workflow fails before SSH/Ansible if any required SSH, application, GitHub authentication, SMTP, DATEX or backup secret is absent; the playbook repeats the required-value check before writing runtime secrets. DeepSeek is not a required production secret because production deploys force deterministic analysis. Automatic deploys set `NYTT_DEPLOY_REF` from the successful CI workflow run SHA so the VPS checkout matches the commit CI verified; manual dispatch falls back to the dispatch SHA. Origin TLS is provisioned before the first application release because the new Caddy hostname must exist before Cloudflare can reach it.

## Production Services

`docker-compose.yml` runs:

- `postgres`: private PostGIS storage volume.
- `migrate`: one-shot schema migration image.
- `app`: authenticated API and built web interface, exposed only on VPS localhost for Caddy.
- `worker`: scheduled ingestion and analysis process.

PostgreSQL runs only on the internal `nytt_database` network. The playbook provisions the external `nytt_outbound` egress network before canary startup; `app` and `worker` join it so GitHub authorization, RSS, Kartverket, MET/NVE, Nominatim/OpenStreetMap and OSRM requests can reach external services. Optional local DeepSeek experiments also use outbound access, but production deploys do not configure provider calls. The API remains bound only to VPS localhost for Caddy.

The playbook also normalizes persisted upload-volume ownership for the non-root API container before promotion, so private attachments and protected ZIP exports remain writable after initial volume creation or restore.

## Backups

Ansible installs a nightly `nytt-backup.timer` and weekly `nytt-restore-check.timer`. Database dumps and uploaded files are encrypted offsite with restic using its `rclone` backend to a dedicated Google Drive folder. Deploy-time safety backups are created and restore-verified without running retention pruning; the scheduled nightly backup applies the retention policy and prune step. Restore verification now restores both `nytt.dump` and `uploads.tar.gz` to a temporary directory, runs `pg_restore --list` against the database dump and runs `tar -tzf` against the uploads archive before reporting success. The backup environment runs rclone with conservative Google Drive request pacing, single-transfer concurrency and expanded retries to reduce release-time quota bursts. Configure `NYTT_RESTIC_REPOSITORY`, `NYTT_RESTIC_PASSWORD` and the restricted Google Drive `NYTT_RCLONE_CONFIG` in GitHub deployment secrets before first production deployment.

If Google Drive still reports `rateLimitExceeded` while backups recover after retries, the remaining cause is usually the shared default rclone Google API project rather than Nytt Trondheim traffic volume. Create a dedicated Google Cloud OAuth client for this backup remote, reauthorize the rclone Drive config with its `client_id` and `client_secret`, then update the `NYTT_RCLONE_CONFIG` GitHub secret.

The weekly restore check validates archive readability only. Run [Full Restore Rehearsal Drill](./RESTORE_DRILL.md) when backup confidence must include a complete scratch restore: retrieve the latest restic snapshot, restore the Postgres dump and uploads archive into scratch Docker resources, run migrations, start app/worker against the scratch database and verify `/health`, source-health rows and `/trafikk` read paths. The drill must never write to the production database or production volumes.

## First Deployment Prerequisites

- Create a GitHub App with callback `https://nytt.reidar.tech/auth/github/callback`, generate a Client Secret, and configure its Client ID and Client Secret as `NYTT_GITHUB_CLIENT_ID` and `NYTT_GITHUB_CLIENT_SECRET`. The App ID and downloaded private key are not required for the user-login flow.
- The public `/logg-inn` and `/registrer` pages support restricted-beta access: request access, verify email, wait for owner approval, then log in with a one-time email link as a read-only viewer.
- Configure SMTP secrets as described in [SMTP Email Auth](#smtp-email-auth). Production refuses to start email auth without `NYTT_SMTP_HOST` and `NYTT_SMTP_FROM`.
- Add the listed repository secrets, including `NYTT_REPO_DEPLOY_KEY` for the repository-scoped read-only checkout key.
- Authorize an `rclone` Google Drive remote for the dedicated encrypted backup folder and configure `NYTT_RESTIC_REPOSITORY=rclone:nytt_drive:nytt-trondheim/restic`.
- Run `Provision Origin` once using an already-authorized VPS SSH key; it installs the dedicated Actions and repository checkout keys and configures the Caddy hostname. After it succeeds, rotate `SSH_PRIVATE_KEY` to the dedicated Actions key.
- After manual release acceptance succeeds, set repository variable `NYTT_DEPLOY_ENABLED=true` to permit automatic promotions from `main`.
- Confirm DNS for `nytt.reidar.tech` resolves to the VPS.
- Run origin provisioning to repair TLS/Cloudflare routing before release; the endpoint returned HTTP `525` before the `nytt.reidar.tech` Caddy hostname existed.
- Confirm Docker, Caddy and the `deploy` SSH key are available on the same VPS used by RFMC.
- Configure DATEX Basic Auth secrets as described in [DATEX Credentials](#datex-credentials). Production currently treats `NYTT_DATEX_USERNAME` and `NYTT_DATEX_PASSWORD` as required deployment secrets because the Command Center source-health and traffic-pulse surfaces depend on Vegvesen access.

## SMTP Email Auth

Restricted-beta viewer login depends on one-time email links. Store SMTP settings as GitHub Actions secrets:

```bash
gh secret set NYTT_SMTP_HOST --repo Reedtrullz/Nytt-Trondheim
gh secret set NYTT_SMTP_FROM --repo Reedtrullz/Nytt-Trondheim
gh secret set NYTT_SMTP_API_KEY --repo Reedtrullz/Nytt-Trondheim
```

Optional SMTP settings:

```bash
gh secret set NYTT_SMTP_PORT --repo Reedtrullz/Nytt-Trondheim
gh secret set NYTT_SMTP_SECURE --repo Reedtrullz/Nytt-Trondheim
gh secret set NYTT_SMTP_USER --repo Reedtrullz/Nytt-Trondheim
```

`NYTT_SMTP_PORT` defaults to `465`. Set `NYTT_SMTP_SECURE=false` when using STARTTLS on port `587`. `NYTT_SMTP_API_KEY` is written to the runtime `SMTP_PASSWORD` environment variable. If `NYTT_SMTP_USER` is configured, `NYTT_SMTP_API_KEY` must also be configured. Local development may omit SMTP; the server logs email links to the console instead.

## DeepSeek Analysis

Production deploys intentionally force DeepSeek off. The GitHub Actions deploy job no longer forwards a DeepSeek API key or enablement variable, and Ansible writes `DEEPSEEK_ANALYSIS_ENABLED=false` plus an empty `DEEPSEEK_API_KEY` into `.env.production`. The worker records a deterministic disabled analysis run and keeps coverage grouping, situation detection and morning briefs running without provider calls.

The DeepSeek analyzer remains in the codebase for local experiments only. To test it locally, set `DEEPSEEK_ANALYSIS_ENABLED=true` and `DEEPSEEK_API_KEY` in a local environment, then verify that malformed, empty or truncated responses degrade only the optional AI enrichment path.

## DATEX Credentials

Vegvesen DATEX II v3.1 access is Basic Auth. Store the issued username/password as GitHub Actions repository secrets only; do not write real values into `.env.example`, docs, fixtures, screenshots, shell history or frontend build-time variables.

```bash
gh secret set NYTT_DATEX_USERNAME --repo Reedtrullz/Nytt-Trondheim
gh secret set NYTT_DATEX_PASSWORD --repo Reedtrullz/Nytt-Trondheim
```

`NYTT_DATEX_ENDPOINT` is optional. Leave it unset/blank for the application's SRTI-filtered default:

```text
https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata?srti=True
```

Only set an endpoint override when Vegvesen explicitly provides a different one or when deliberately testing another DATEX publication:

```bash
printf '%s' 'https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata?srti=True' \
  | gh secret set NYTT_DATEX_ENDPOINT --repo Reedtrullz/Nytt-Trondheim
```

The deploy workflow exposes `NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD` and optional `NYTT_DATEX_ENDPOINT` to Ansible. The playbook writes them into `.env.production` as runtime-only `DATEX_USERNAME`, `DATEX_PASSWORD` and `DATEX_ENDPOINT`; both DATEX Situation and DATEX TravelTime collectors use the same Basic Auth credentials. Changing GitHub secrets does not update a running worker by itself: run `Deploy to VPS` manually or push a verified `main` commit and wait for both `CI` and `Deploy to VPS` to complete successfully.

For local development, copy `.env.example` to `.env.production` and set `DATEX_USERNAME` / `DATEX_PASSWORD` there. Leave `DATEX_ENDPOINT`, `DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT` and `DATEX_TRAVEL_TIME_DATA_ENDPOINT` blank unless intentionally overriding the defaults. Local `.env*` files must stay untracked.

## Entur Configuration

Entur open-data APIs require every request to identify the client, but the identifier is not a secret. Local defaults are documented in `.env.example`, and production can optionally override them with repository variables:

- `NYTT_ENTUR_CLIENT_NAME`, defaulting to `reidar-nytt-trondheim`.
- `NYTT_ENTUR_CODESPACES`, defaulting to `ATB`.
- `NYTT_ENTUR_VEHICLE_BOUNDS`, defaulting to `63.30,10.20,63.55,10.65`.

Do not add these values to the required deployment secrets list; the playbook writes safe defaults into `.env.production` when repository variables are unset.

## DATEX Verification

The deployment playbook now automatically verifies live health, promoted worker container state, a `worker_cycle_metrics.latest` cycle that both started and completed after candidate promotion began, `state='ok'` traffic, DATEX/datex_travel_time and Entur `source_health` rows checked inside that same candidate window, source-item query sanity and the invariant that TravelTime traffic-pulse rows are not written to `source_items`. This prevents a candidate from passing on rows left by the previous worker. Cooldown-gated collectors must still write an honest fresh health check for the skipped poll; Trafikkdata already records that state. For manual follow-up after deploying DATEX ingestion, verify source status, worker stability, source-health timestamps, persisted official traffic rows and TravelTime traffic-pulse rows:

```bash
curl -fsS https://nytt.reidar.tech/health
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production ps worker"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production logs --tail=80 worker"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,detail,last_checked_at,next_poll_at from source_health where source='datex';\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,detail,last_checked_at,next_poll_at from source_health where source in ('datex','datex_travel_time') order by source;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from official_events where source='datex';\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from situations where payload->>'officialSource'='datex';\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select provider, kind, count(*) from source_items group by provider, kind order by provider, kind;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from source_items where provider='datex_travel_time' or kind='travel_time';\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select id,name,state,travel_time_seconds,free_flow_seconds,delay_seconds,measurement_to from datex_travel_times order by delay_seconds desc nulls last, name asc limit 10;\""
```

A zero DATEX event count can be healthy when the current SRTI snapshot has no Trondheim/Trøndelag matches; rely on `source_health.state='ok'`, worker logs and source-health timestamps to distinguish that from collector failure. TravelTime source health appears as `datex_travel_time`; rows in `datex_travel_times` are measured/estimated travel time and delay pulse data only. They do not create `official_events`, do not promote or create `OfficialEvent` rows, and do not create or update `situations`. Use the compose service name `postgres` from `docker-compose.yml`; do not assume a literal container name such as `nytt-postgres` exists.

## Entur Verification

After Entur ingestion is deployed for a CI-verified SHA, verify source health, stored public transport rows and provenance separation:

```bash
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -v ON_ERROR_STOP=1 -P pager=off -F ' | ' -At" <<'SQL'
SELECT source, state, detail, last_checked_at, next_poll_at
FROM source_health
WHERE source IN ('entur_vehicle_positions','entur_service_alerts')
ORDER BY source;
SELECT count(*) FROM public_transport_vehicles WHERE stale=false;
SELECT state, count(*) FROM public_transport_service_alerts GROUP BY state ORDER BY state;
SELECT provider, kind, count(*) FROM source_items WHERE provider='entur' GROUP BY provider, kind;
SELECT count(*) AS accidental_vehicle_source_items
FROM source_items
WHERE provider='entur_vehicle_positions'
   OR (
     provider='entur'
     AND (
       external_id LIKE 'entur-vehicle:%'
       OR normalized_payload->>'source' = 'entur_vehicle_positions'
       OR normalized_payload ? 'vehicleId'
     )
   );
SELECT count(*) FROM official_events WHERE source IN ('entur','entur_vehicle_positions','entur_service_alerts');
SELECT count(*) AS accidental_entur_situations
FROM situations
WHERE payload->>'officialSource' IN ('entur','entur_vehicle_positions','entur_service_alerts')
   OR payload->'activationBasis'->'sourceIds' ?| array['entur','entur_vehicle_positions','entur_service_alerts']
   OR EXISTS (
     SELECT 1
     FROM jsonb_array_elements(COALESCE(payload->'evidence', '[]'::jsonb)) evidence
     WHERE evidence->>'source' IN ('entur','entur_vehicle_positions','entur_service_alerts')
   );
SQL
```

Expected results:

- Entur source health rows are present and `state='ok'`; the deploy playbook retries this row/state check so transient worker startup lag does not create a false red deploy. `entur_vehicle_positions` may legitimately report zero vehicles when Entur has none inside the configured bounds.
- `source_items WHERE provider='entur'` can be non-zero for service alerts.
- `accidental_vehicle_source_items` must be zero; this proves vehicle telemetry did not enter `source_items` either under `entur_vehicle_positions` or disguised as `provider='entur'` rows.
- `official_events` for Entur sources must be zero in this plan.
- `accidental_entur_situations` must be zero; this checks `officialSource`, `activationBasis.sourceIds`, and embedded evidence sources, not just one field.

## Bane NOR Verification

Bane NOR RSS is deployed as phase-1 rail/mobility context only. After a CI-verified SHA deploys, verify fresh source health, source-item retention and no accidental promotion:

```bash
curl -fsS https://nytt.reidar.tech/health
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && git rev-parse HEAD"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production ps app worker postgres"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production logs --tail=120 worker"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -v ON_ERROR_STOP=1 -P pager=off -F ' | ' -At" <<'SQL'
SELECT source, state, detail, last_checked_at, next_poll_at
FROM source_health
WHERE source='bane_nor';
SELECT provider, kind, count(*)
FROM source_items
WHERE provider='bane_nor'
GROUP BY provider, kind;
SELECT count(*) AS raw_payload_non_null
FROM source_items
WHERE provider='bane_nor' AND raw_payload IS NOT NULL;
SELECT normalized_payload->>'state', count(*)
FROM source_items
WHERE provider='bane_nor'
GROUP BY normalized_payload->>'state'
ORDER BY normalized_payload->>'state';
SELECT count(*) FROM official_events WHERE source='bane_nor';
SELECT count(*) FROM traffic_map_events WHERE source='bane_nor';
SELECT count(*) AS accidental_bane_situations
FROM situations
WHERE payload->>'officialSource'='bane_nor'
   OR payload->'activationBasis'->'sourceIds' ? 'bane_nor'
   OR EXISTS (
     SELECT 1
     FROM jsonb_array_elements(COALESCE(payload->'evidence', '[]'::jsonb)) evidence
     WHERE evidence->>'source'='bane_nor'
   );
SQL
```

Expected phase-1 results:

- `source_health.source='bane_nor'` exists and is fresh; it may be `ok` or honestly `degraded`, but it must not be silently absent after the worker has run.
- `source_items WHERE provider='bane_nor'` may be non-zero and must use `kind='official_event'` with raw RSS payloads retained.
- `official_events`, `traffic_map_events`, and `situations` counts for Bane NOR must be zero until a separate promotion/map-layer plan is written.
- The public frontend bundle does not need to contain the literal string `Bane NOR`; this phase is ingestion/source-health/provenance only, not a UI feature.

## Traffic Map Production Verification

Do not call the traffic map deployed from CI alone. Verify the same pushed SHA through both workflows, then prove the live VPS has traffic/context data and that map-only/context-only telemetry stayed out of editorial incident promotion.

```bash
HEAD_SHA=$(git rev-parse HEAD)
git push origin main
gh run list --branch main --limit 10 --json databaseId,headSha,status,conclusion,workflowName,event,url
# Watch the CI run whose headSha is $HEAD_SHA until status=completed and conclusion=success.
# Then watch the Deploy to VPS workflow_run whose headSha is $HEAD_SHA until it also completes successfully.
```

After the deploy workflow for that SHA succeeds, run the live checks:

```bash
curl -fsS https://nytt.reidar.tech/health
curl -sS -o /tmp/trafikk.html -w '%{http_code}\n' https://nytt.reidar.tech/trafikk
ASSET=$(grep -oE '/assets/[^"]+\.js' /tmp/trafikk.html | head -n 1)
curl -fsSL "https://nytt.reidar.tech${ASSET}" -o /tmp/trafikk.js
grep -Eq 'Trafikkbildet nå|Finn reiseråd|Beste nå|Åpne hos AtB/Entur|Nytt vurderer reiserisiko' /tmp/trafikk.js
curl -fsS -o /tmp/traffic-api-unauth.json -w '%{http_code}\n' 'https://nytt.reidar.tech/api/map/traffic-events?north=63.5&south=63.3&east=10.6&west=10.1' || true
# Protected `/api` traffic endpoints should return 401 without a session. For a full smoke, paste an authenticated browser cookie:
NYTT_COOKIE='connect.sid=...'
curl -fsS -H "Cookie: ${NYTT_COOKIE}" -o /tmp/traffic-api.json 'https://nytt.reidar.tech/api/map/traffic-events?north=63.5&south=63.3&east=10.6&west=10.1'
curl -fsS -H "Cookie: ${NYTT_COOKIE}" -o /tmp/travel-plan-api.json 'https://nytt.reidar.tech/api/map/travel-plan?from=Munkegata&to=Leangen'
node -e "const fs=require('fs'); for (const file of ['/tmp/traffic-api.json','/tmp/travel-plan-api.json']) { const body=JSON.parse(fs.readFileSync(file,'utf8')); if (!body || typeof body !== 'object') process.exit(1); }"

ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -v ON_ERROR_STOP=1 -P pager=off -F ' | ' -At" <<'SQL'
SELECT source, state, detail, last_checked_at
FROM source_health
WHERE source IN ('vegvesen_traffic_info','datex','datex_travel_time','datex_weather','datex_cctv','trafikkdata')
ORDER BY source;
SELECT source, state, count(*) FROM traffic_map_events GROUP BY source, state ORDER BY source, state;
SELECT source, count(*) FROM traffic_map_events WHERE source <> 'vegvesen_traffic_info' GROUP BY source ORDER BY source;
SELECT provider, kind, count(*) FROM source_items WHERE provider='vegvesen_traffic_info' GROUP BY provider, kind;
SELECT count(*) FROM traffic_map_events WHERE source='vegvesen_traffic_info' AND state IN ('active','planned');
SELECT count(*) FROM datex_travel_times WHERE state <> 'stale';
SELECT count(*) FROM road_weather_observations;
SELECT count(*) FROM road_cameras;
SELECT count(*) FROM traffic_counter_snapshots;
SELECT count(*) FROM official_events WHERE source='datex';
SELECT source, count(*) FROM official_events WHERE source IN ('vegvesen_traffic_info','datex_weather','datex_cctv','trafikkdata','datex_travel_time') GROUP BY source;
SELECT count(*) FROM source_items WHERE provider IN ('datex_weather','datex_cctv','trafikkdata','datex_travel_time');
SELECT count(*) FROM situations WHERE payload->>'officialSource' IN ('vegvesen_traffic_info','datex_weather','datex_cctv','trafikkdata','datex_travel_time');
SQL
```

Expected live results:

- `/health` returns `200` with Postgres-backed `status: ok`.
- `/trafikk` returns `200` and the built asset contains the current traffic-map UI strings, including the route planner controls.
- Anonymous `/api/map/traffic-events` and `/api/map/travel-plan` return `401`; this is expected for protected map APIs and is not a zero-event or route-planner failure.
- `source_health.source='vegvesen_traffic_info'` is `ok`, `traffic_map_events` has non-zero `vegvesen_traffic_info` rows, and active/planned count is non-zero when Vegvesen has visible Trøndelag messages.
- `traffic_map_events WHERE source <> 'vegvesen_traffic_info'` returns zero rows. DATEX and news-derived map objects are read-time API composition, not persisted table rows.
- `datex_travel_times` and `traffic_counter_snapshots` are non-zero when the upstream feeds are available. DATEX weather/CCTV rows may legitimately be zero if the current bounded endpoints have no matching observations/status updates; rely on `source_health` and freshness labels rather than treating zero rows as an automatic deployment failure.
- `source_items` has `vegvesen_traffic_info | official_event` provenance rows, but context telemetry providers (`datex_weather`, `datex_cctv`, `trafikkdata`, `datex_travel_time`) have zero `source_items` rows.
- `official_events` and `situations` have no rows promoted from map-only or context-only sources.

## Restricted-Beta Auth Production Verification

After a CI-verified SHA deploys, verify the auth schema, anonymous boundaries and owner/viewer flow:

```bash
curl -fsS https://nytt.reidar.tech/health
curl -sS -o /tmp/bootstrap.json -w '%{http_code}\n' https://nytt.reidar.tech/api/bootstrap

ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -v ON_ERROR_STOP=1 -P pager=off -F ' | ' -At" <<'SQL'
SELECT status, count(*) FROM access_requests GROUP BY status ORDER BY status;
SELECT role, status, count(*) FROM users GROUP BY role, status ORDER BY role, status;
SELECT kind, count(*) FROM auth_tokens GROUP BY kind ORDER BY kind;
SELECT count(*) AS accidental_auth_source_items
FROM source_items
WHERE provider IN ('access_requests','users','auth_tokens')
   OR kind IN ('access_request','auth_token','user');
SQL
```

Expected results:

- `/health` returns `200` with Postgres-backed `status: ok`.
- Anonymous `/api/bootstrap` returns `401`.
- `accidental_auth_source_items` is zero. Auth and access-review data are administrative application data, not upstream evidence.
- In an authenticated owner browser session, verify `/command/tilgang` shows unverified/pending/approved/rejected filters and user controls. Approving a verified request should create/reactivate a viewer and send an invite/login email.
- In a viewer browser session, verify `/` and public situation pages load, while `/command`, `/lagret`, source audit/linking, private workspace mutations, attachments and exports return an owner-only 403.

## Coverage Bundle Production Verification

Coverage bundles are derived article-analysis rows for the owner-only Command Center surface. After a CI-verified SHA deploys and the worker has completed at least one cycle, verify live health, authentication behavior, persisted decisions and the browser surface:

```bash
HEAD_SHA=$(git rev-parse HEAD)
gh run list --branch main --limit 10 --json databaseId,headSha,status,conclusion,workflowName,event,url
# Confirm CI and Deploy to VPS both completed with conclusion=success for HEAD_SHA.

curl -fsS https://nytt.reidar.tech/health
curl -sS -o /tmp/bootstrap.json -w '%{http_code}\n' https://nytt.reidar.tech/api/bootstrap

ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -v ON_ERROR_STOP=1 -P pager=off -F ' | ' -At" <<'SQL'
SELECT count(*) AS recent_coverage_bundles
FROM coverage_bundles
WHERE last_seen_at >= now() - interval '48 hours';
SELECT kind, confidence, count(*)
FROM coverage_bundles
WHERE last_seen_at >= now() - interval '48 hours'
GROUP BY kind, confidence
ORDER BY kind, confidence;
SELECT id, kind, confidence, reason, array_length(member_article_ids, 1) AS members, source_labels, generated_at, last_seen_at
FROM coverage_bundles
ORDER BY last_seen_at DESC
LIMIT 10;
SELECT count(*) AS accidental_coverage_source_items
FROM source_items
WHERE provider='coverage_bundles'
   OR kind='coverage_bundle'
   OR normalized_payload ? 'coverageBundleDecision';
SQL
```

Expected results:

- `/health` returns `200` with Postgres-backed `status: ok`.
- Anonymous `/api/bootstrap` returns `401`; the coverage endpoint is under the same authenticated `/api` boundary.
- `recent_coverage_bundles` may be zero immediately after deploy if the worker has not yet ingested matching stories, but the query must succeed and `/command/dekning` must show either live rows or an honest empty state.
- `accidental_coverage_source_items` must be zero. Coverage grouping explains feed bundling; it is not upstream provenance.
- In an authenticated browser session, verify `/`, `/command`, and `/command/dekning`. The home feed should still show existing bundle labels, `/command` should link to `Dekningsgrupper`, and `/command/dekning` should show bundle rows with member stories, signals, near misses and timestamps, or the empty state.

## Rollback

The deployment preserves the prior API and worker images as `:previous` before building candidates and does not promote containers if backup verification, migration or canary health fails. If post-promotion validation fails, re-tag `:previous` as `:latest`, restart `app` and `worker`, and restore the latest verified restic snapshot before attempting any incompatible migration recovery.

## Current Provisioning State

The application is live at `https://nytt.reidar.tech`; `/health` returns healthy Postgres-backed status through Caddy and Cloudflare. Production is promoted from successful `main` CI through `Deploy to VPS`; verify the current commit with `git ls-remote origin refs/heads/main`, the latest successful GitHub Actions runs, and the VPS checkout under `/home/deploy/nytt-trondheim` rather than relying on a commit SHA embedded in this document.

- DATEX Basic Auth credentials are configured as GitHub repository secrets `NYTT_DATEX_USERNAME` and `NYTT_DATEX_PASSWORD`, mapped to runtime `DATEX_USERNAME` and `DATEX_PASSWORD` by the deploy workflow/playbook. DATEX TravelTime uses the same credentials. Leave `NYTT_DATEX_ENDPOINT` blank unless intentionally overriding the SRTI-filtered default; leave `DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT` and `DATEX_TRAVEL_TIME_DATA_ENDPOINT` blank unless intentionally overriding the Vegvesen TravelTime defaults.
- DATEX TravelTime production verification should check `source_health.source='datex_travel_time'` and the `datex_travel_times` table. Treat the data as Command Center source-health traffic pulse only, not as incident cause or situation activation evidence.
- Production DATEX source health can legitimately report `0 relevante DATEX trafikkhendelser hentet`; that means the current SRTI snapshot had no relevant Trondheim/Trøndelag events when credentials, worker logs and source health are otherwise OK.
- The incident-correctness release was manually verified and `NYTT_DEPLOY_ENABLED=true`; successful `main` CI runs now trigger production promotion.
- The `Provision Origin` workflow succeeded; the repository-scoped read-only checkout key is installed and verified on the VPS, and GitHub Actions now connects using its dedicated deployment key.
- `NYTT_POSTGRES_PASSWORD` and `NYTT_SESSION_SECRET` are configured in GitHub Actions.
- The `nytt-trondheim` GitHub App credentials and restricted Google Drive/rclone backup target are configured. DeepSeek is not part of the production deploy path; local experiments must configure `DEEPSEEK_ANALYSIS_ENABLED=true` outside the playbook.
- Caddy serves the application from localhost port `8090` with valid TLS at `https://nytt.reidar.tech`.
- The Nytt canary uses localhost port `8092`, avoiding the existing Hermes proposals service on `8091`.
- Encrypted Google Drive/restic backups and restore verification are active. Runtime status files expose only successful completion timestamps to the owner-only operations view.
- Persisted false-positive situations have been dismissed with retained audit history; new automatic incidents require explicit event type and a specific matching place, except for high-impact official DATEX traffic records.
- The source-contract/Bane NOR release was verified on 2026-06-02 at SHA `6a2a79331900d38bbcf9d6d9c30de03074a451ee`: `CI` run `26835662258` and `Deploy to VPS` run `26835764423` were both `completed/success`; `/health` returned Postgres-backed `ok`; the VPS checkout matched the SHA; `source_health.bane_nor` was `ok`; 11 Bane NOR source items were present with raw payloads; and Bane NOR had zero rows in `official_events`, `traffic_map_events`, and `situations`.
