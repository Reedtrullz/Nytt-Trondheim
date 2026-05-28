# Codebase Gap Remediation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Close the concrete gaps found in the May 29 full-codebase audit after Source Item Ledger Phase 1.

**Architecture:** Keep the existing React/Vite + Express + PostgreSQL/PostGIS + worker architecture. Fix release blockers first: safe deployment/migrations, API hardening, worker lifecycle correctness, and source-item ledger backfill/link parity. Keep DATEX TravelTime operations-only and keep raw source payloads off public API/UI.

**Tech Stack:** TypeScript, Express, React/Vite, Vitest, Playwright, PostgreSQL/PostGIS, Docker Compose, Ansible, GitHub Actions.

---

## Audit Findings

### Confirmed release-blocking / high-impact gaps

1. **Deploy checkout not pinned to the CI-verified SHA**: `deploy.yml` triggers on a successful `workflow_run`, but `ansible-playbook.yml` checks out `main`.
2. **Secret-rendering Ansible tasks are too verbose**: `.env.production` and backup env copy tasks render secret-derived values and deploy runs with `-vv`.
3. **Old app/worker can write during backup + migration**: playbook backs up and migrates before stopping the previous app/worker.
4. **Migration runner has no advisory lock/transaction guard**: concurrent deploys or mid-file failures can leave partial state.
5. **CI does not run migrations against real PostGIS**: DDL idempotency is only checked at deploy time.
6. **Worker DATEX conditional state can advance before persistence**: `datex:lastModified` can be written before official events/source items are durable.
7. **Worker can falsely resolve DATEX situations on 304 + artificial validity expiry**: missing DATEX resolution should require a fresh complete snapshot.
8. **Worker collection cycles can overlap**: `setInterval` can race a long-running `collectAll()`.
9. **Multi-table worker writes are not atomic** for official events and situations.
10. **Source item ledger has no idempotent backfill for existing Postgres rows**.

### Confirmed medium / UX / API gaps

11. Unknown authenticated `/api/*` routes fall through to the SPA HTML 200.
12. Error handler exposes arbitrary error messages as HTTP 400.
13. Attachment upload accepts the file before validating situation existence.
14. Workspace exports are fully buffered and have no attachment count/total-byte ceiling.
15. No lightweight abuse throttling on auth/API/export/upload routes.
16. Source-item external links do not use the app's external-link safety pattern.
17. Frontend API interpolates situation IDs without URL encoding in several routes.
18. Source-item panel shows an empty state while still loading and has no announced retryable error state.
19. MET same-id warning updates/cancellations are skipped by `knownIds` filtering.
20. Official-event cancellation/expiry does not mirror the changed state back into source items.
21. SRTI is a default, not an enforced DATEX endpoint invariant.
22. MemoryStore dev source-item links do not mirror sample article/situation relationships.
23. MemoryStore source-item IDs diverge from worker IDs.
24. DATEX credentials are configured but not required by deployment even though this environment now has access.
25. Restore check validates only dump existence, not `pg_restore --list` nor upload archive integrity.
26. Post-deploy verification only checks `/health`, not source health / source-item / worker sanity.

### False-positive / constrained finding

- The audit output displayed `***` in database URLs. Direct safe checks showed these are secret placeholders/templates, not literal stars and not printed secrets. Still, the remediation removes duplicate Compose overrides and keeps one secret-derived `DATABASE_URL` source to reduce drift.

---

## Task 1: Harden deployment checkout, secret logging, and runtime env source

**Objective:** Deploy exactly the CI-verified commit, stop logging secret-rendering task details, remove duplicate DB URL overrides, and require DATEX secrets.

**Files:**

- Modify: `.github/workflows/deploy.yml`
- Modify: `ansible-playbook.yml`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Test: local YAML parse + grep checks

**Steps:**

1. In `deploy.yml`, set `NYTT_DEPLOY_REF` to `${{ github.event.workflow_run.head_sha || github.sha }}` and run `ansible-playbook` without `-vv`.
2. Add `NYTT_DATEX_USERNAME` and `NYTT_DATEX_PASSWORD` to required deployment values in workflow and Ansible pre_tasks.
3. In Ansible git checkout, use `version: "{{ lookup('env', 'NYTT_DEPLOY_REF') | default('main', true) }}"`.
4. Add `no_log: true` to application secret and backup env copy tasks.
5. Write one `DATABASE_URL` in `.env.production` from URL-encoded `NYTT_POSTGRES_PASSWORD`; remove Compose `DATABASE_URL` overrides for app/worker and canary.
6. Verify with `python3` YAML parse and searches for `ansible-playbook .* -vv` and duplicate DB overrides.
7. Commit: `fix: harden deployment checkout and env handling`.

## Task 2: Quiesce deploy writes, improve migration safety, and add migration CI

**Objective:** Prevent concurrent writes during backups/migrations and prove schema idempotency before deploy.

**Files:**

- Modify: `ansible-playbook.yml`
- Modify: `apps/server/src/db/migrate.ts`
- Modify: `.github/workflows/ci.yml`
- Test: `npm run build -w @nytt/server`, local typecheck; CI will run PostGIS migration smoke after push

**Steps:**

1. Add an Ansible task before backup/migration to stop `app` and `worker` if present.
2. In `migrate.ts`, acquire a transaction-scoped advisory lock, run schema inside `BEGIN`/`COMMIT`, rollback on failure, and release the client.
3. Add a CI `migration-smoke` job with a `postgis/postgis:16-3.4` service, build server/shared, run `npm run db:migrate` twice, and query `source_items`/`schema_migrations`.
4. Commit: `fix: guard migrations and verify schema in CI`.

## Task 3: Backfill source-item ledger and align development store parity

**Objective:** Existing production rows and dev/sample state should have source items and links without waiting for future ingestion.

**Files:**

- Modify: `apps/server/src/db/schema.sql`
- Modify: `apps/server/test/source-item-schema.test.ts`
- Modify: `apps/server/src/store.ts`
- Modify: `apps/server/test/source-items-store.test.ts`
- Test: focused server source-item schema/store tests

**Steps:**

1. Add idempotent SQL backfill for `articles` and `official_events` into `source_items` using existing payloads and `ON CONFLICT DO NOTHING/UPDATE`.
2. Add idempotent SQL backfill for `situation_source_items` from `situation_articles` and from situations with `officialSource`/`officialEventId`.
3. Update schema tests to assert backfill SQL exists and TravelTime is not backfilled.
4. Update MemoryStore source item ID helper to match worker JSON-array hashing.
5. Seed MemoryStore `sourceLinks` from sample article/situation relationships.
6. Add store tests proving sample situation source items are linked.
7. Commit: `fix: backfill source items and align memory store`.

## Task 4: Harden server API errors, 404s, uploads, exports, and abuse limits

**Objective:** API failures should be JSON/sanitized, uploads should not persist for missing situations, exports should be bounded, and abusive bursts should be throttled.

**Files:**

- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/test/api.test.ts`
- Test: focused server API tests

**Steps:**

1. Add a small in-memory rate limiter middleware with stricter buckets for auth/write/export/upload paths.
2. Validate situation existence before multer persists an attachment; return 404 without writing arbitrary files.
3. Add export count/byte ceilings before calling `buildWorkspaceExport`.
4. Add `/api` JSON 404 handler before static frontend serving.
5. Sanitize error handler: validation errors return 400 with safe detail; unexpected errors log server-side and return generic 500.
6. Add regression tests for unknown API route JSON 404, sanitized internal 500, missing-situation upload behavior, export quota, and rate-limit 429.
7. Commit: `fix: harden server API boundaries`.

## Task 5: Fix frontend source-item UX and route encoding

**Objective:** Source item UI should be safe, accessible, retryable, and robust for reserved route characters.

**Files:**

- Modify: `apps/frontend/src/api.ts`
- Modify: `apps/frontend/src/api.test.ts`
- Modify: `apps/frontend/src/pages/SituationPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `e2e/app.spec.ts`
- Test: frontend API unit test + e2e

**Steps:**

1. Encode situation IDs in all `/api/situations/:id` API helpers.
2. Add tests for reserved characters in situation/source item API paths.
3. Add `sourceItemsLoading`, retry state, `role="alert"`/`aria-live`, and a retry button.
4. Render source-item links through the same safe external-link pattern (`target="_blank" rel="noreferrer noopener"`) and only for http(s) URLs.
5. Add e2e coverage for loading/empty/error source-item panel behavior where practical.
6. Commit: `fix: improve source item frontend robustness`.

## Task 6: Fix worker DATEX lifecycle and scheduler safety

**Objective:** DATEX snapshot state and situation resolution should only advance after durable processing, and worker cycles should not overlap.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/test/datex.test.ts` or a new focused test if import side effects make `index.ts` unsuitable
- Test: worker tests + typecheck

**Steps:**

1. Normalize/validate DATEX endpoint so configured endpoints keep `srti=True`.
2. Track whether the DATEX snapshot was fresh (`!notModified`) and only resolve missing DATEX situations after a fresh complete snapshot.
3. Defer `datex:lastModified` update until after `upsertOfficialEvents` succeeds.
4. Add an in-process collection guard so interval ticks skip when a prior cycle is still running.
5. Add testable helper functions for endpoint normalization / resolution decision if direct index testing is impractical.
6. Commit: `fix: guard DATEX lifecycle processing`.

## Task 7: Make worker official-event/situation persistence atomic and mirror state changes

**Objective:** Official event/source item and situation child-row persistence should commit or rollback together.

**Files:**

- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/repository.test.ts`
- Test: worker repository tests

**Steps:**

1. Add a `withTransaction` helper using a `pg.PoolClient` and `BEGIN`/`COMMIT`/`ROLLBACK`.
2. Make `upsertOfficialEvents` transactional per batch; let source-item upserts use the same client.
3. When replacement/cancellation/expiry updates official event state, update matching `source_items.normalized_payload` and `raw_payload` state as well.
4. Make `upsertSituation` transactional so situation rows, child rows, article links, and source links are atomic.
5. Add tests that query order includes transaction boundaries and source-item state mirror updates.
6. Commit: `fix: make worker persistence atomic`.

## Task 8: Refresh MET update handling and remove stale dead export

**Objective:** MET warning updates/cancellations should not be skipped solely because the ID is already known.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/official.ts`
- Modify: `apps/worker/test/official.test.ts`
- Test: worker official tests

**Steps:**

1. Remove known-ID skipping for current MET RSS items and rely on idempotent repository upserts.
2. Remove dead `collectOfficialWarnings` export unless tests prove it is still useful.
3. Add a regression test that a known same-ID MET item still fetches CAP and returns updated/cancelled state.
4. Commit: `fix: refresh repeated MET warning IDs`.

## Task 9: Improve restore and post-deploy production verification

**Objective:** Backup checks and deploy verification should validate real restore structure and source-ingestion health.

**Files:**

- Modify: `scripts/restore-check.sh`
- Modify: `ansible-playbook.yml`
- Modify: `docs/DEPLOYMENT.md`
- Test: shell syntax check, grep checks

**Steps:**

1. Restore both `nytt.dump` and `uploads.tar.gz` in restore check.
2. Run `pg_restore --list` against the restored dump and `tar -tzf` against uploads archive.
3. Add Ansible post-deploy checks for worker container status, source_health presence for DATEX/datex_travel_time when DATEX is enabled, source_items query sanity, and TravelTime source-item exclusion.
4. Update deployment docs to describe the now-automated checks.
5. Commit: `fix: verify backups and source ingestion after deploy`.

## Final Verification

Run locally before push:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
npm run test:e2e
python3 - <<'PY'
import yaml, pathlib
for path in ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']:
    yaml.safe_load(pathlib.Path(path).read_text())
print('YAML OK')
PY
bash -n scripts/backup.sh scripts/restore-check.sh
```

Then push, wait for CI `completed success`, wait for `Deploy to VPS` `completed success`, and verify live `/health`, frontend bundle, source_health, source_items, `datex_travel_times`, and zero TravelTime source items.
