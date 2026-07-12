# Nytt Trondheim Audit Findings Remediation Plan

**Date:** 2026-07-12

**Base:** `main` at `7a5edee1a015464f963e632ba92b372ace0b6911`

**Goal:** Close the five confirmed audit findings without weakening viewer privacy, source-trust rules, authentication, deployment rollback, or existing Entur/DATEX separation.

## Delivery strategy

Use one branch and five focused implementation commits, followed by one release-proof pass. Do not mix unrelated untracked files into any commit.

Recommended branch:

```bash
git switch -c codex/audit-findings-remediation
```

Before long test/build loops:

```bash
df -h /System/Volumes/Data
```

Stop if free space is below `30 GiB`.

## Task 1 — Close the viewer workspace-map privacy boundary

**Priority:** P0

**Primary files:**

- `apps/server/src/app.ts`
- `apps/server/test/api.test.ts`

### Required behavior

- Viewer responses from `/api/situations/workspace-map` must apply the same private-timeline predicate used by `/api/situations/:id` and `/timeline`.
- Treat an entry as private if any of these is true:
  - `kind === "private_annotation"`
  - `provenance === "private_annotation"`
  - `privateAnnotationId` is present
- Build both the per-situation preview and top-level timeline from the viewer-safe timeline.
- Audit viewer map aggregation for linked private source-item metadata. Viewer payloads must not expose private source-item IDs, roles, providers, confidence summaries, or filter inference paths.

### TDD sequence

1. Add a viewer regression with three private entries, one for each private marker above, plus one public entry.
2. Assert that neither the top-level timeline, timeline preview, serialized JSON, provenance summary, nor source filters expose private markers or details.
3. Run the focused test and confirm RED against current `main`.
4. Sanitize before aggregation, preferably by reusing `viewerSafeTimeline()` rather than adding another privacy predicate.
5. Run the focused test and the full server API suite.

### Acceptance

- Viewer receives only the public entry.
- Owner behavior remains unchanged.
- A future entry with omitted provenance cannot cross the viewer boundary.

### Commit

```text
fix: close viewer workspace timeline boundary
```

## Task 2 — Make viewer revocation immediate and durable

**Priority:** P0

**Primary files:**

- `apps/server/src/auth.ts`
- `apps/server/src/store.ts`
- `apps/server/src/db/schema.sql` only if a session lookup/index migration is justified
- `apps/server/test/api.test.ts`
- focused store/auth tests as needed

### Required behavior

- Passport sessions must serialize a stable user ID, not a complete cached authorization object.
- Deserialization must load the current user role and status from the account store.
- A revoked user must receive `403` on the next request from an already-authenticated session.
- Revocation must delete that user's persisted session rows so reactivation does not resurrect an old browser session.
- Owner GitHub identity reconstruction must preserve the configured GitHub login; viewer identities must preserve their email login.

### Design

1. Extend `AuthAccountStore` with a read method that reconstructs `AuthUser` from a stable user ID and current identities.
2. Implement it in both `MemoryStore` and `PgStore`.
3. Serialize only `user.id`; deserialize through the new store method and return `false` when missing or revoked.
4. When `updateUser(..., { status: "revoked" })` succeeds in Postgres, remove matching `connect-pg-simple` session rows in the same transaction or an equally atomic revocation boundary.
5. Keep `requireUser` as the final fail-closed guard.

### TDD sequence

1. Reproduce login → successful session → owner revocation → same session request.
2. Confirm current RED: request still returns `200` with cached active status.
3. Add owner/viewer identity reconstruction tests.
4. Add a Postgres-query contract test proving session deletion targets only the revoked user.
5. Implement and confirm the same browser session receives `403`; a new login token is also unavailable while revoked.

### Acceptance

- Revocation is effective on the next request.
- Reactivation requires a new login.
- No other viewer or owner sessions are deleted.

### Commit

```text
fix: enforce live viewer revocation
```

## Task 3 — Stop resolving incidents from DATEX disappearance

**Priority:** P0

**Primary files:**

- `apps/worker/src/clusters.ts`
- `apps/worker/src/index.ts`
- `apps/worker/test/clusters.test.ts`
- `apps/worker/test/index.test.ts`
- `docs/SOURCES.md` or the DATEX source contract if policy wording needs clarification

### Required behavior

- Absence from a successful DATEX snapshot must not change an active situation to `resolved`.
- Absence may make the underlying source record stale/expired for map freshness, but must not assert that the real incident ended.
- Situation resolution requires an explicit terminal DATEX state or a separately documented, approved confirmation policy.
- No timeline entry may claim “not active” solely because an upstream item disappeared.

### TDD sequence

1. Replace the existing disappearance-resolution test with a regression asserting no situation update is produced.
2. Add a separate explicit-terminal-state test if current DATEX payloads expose cancelled/expired records to the situation layer.
3. Confirm RED against the current `resolvedOfficialTrafficSituationsForMissingDatex()` path.
4. Remove the missing-snapshot resolution call and dead helper if it has no remaining valid use.
5. Verify `expireMissingOfficialEvents()` and traffic-map freshness remain context-only and cannot feed situation resolution indirectly.

### Acceptance

- A missing event leaves the situation's status unchanged.
- Explicit terminal evidence can still resolve a situation through a named, tested path.
- Telemetry/context disappearance never becomes incident evidence.

### Commit

```text
fix: require explicit DATEX resolution evidence
```

## Task 4 — Make email login links scanner-safe

**Priority:** P1

**Primary files:**

- `apps/server/src/app.ts`
- `apps/server/src/store.ts`
- `apps/server/test/api.test.ts`
- `apps/frontend/src/pages/AccessPage.tsx` and its tests only if confirmation is frontend-owned

### Required behavior

- A GET from an email scanner must not consume an invite/login token or create an authenticated session.
- Consumption must require an explicit same-origin confirmation action.
- Tokens remain single-use, short-lived, hashed at rest, and generic on failure.
- Confirmation must not introduce login-CSRF/session-swapping behavior.

### Preferred flow

1. GET validates only enough to show a generic confirmation page and does not mark the token consumed.
2. The user's explicit confirmation sends a same-origin POST.
3. POST atomically consumes the token, regenerates/authenticates the session, removes token material from the URL, and redirects to `/`.
4. Invalid, expired, replayed, and revoked-user tokens return the existing generic invalid flow.

Do not auto-submit the POST with JavaScript; that would recreate scanner sensitivity.

### TDD sequence

1. Assert repeated GETs do not consume the token and do not authenticate either agent.
2. Assert one explicit POST authenticates exactly one agent.
3. Assert replay POST fails.
4. Assert cross-origin POST fails.
5. Assert revoked viewers cannot complete confirmation.

### Acceptance

- Scanner GET cannot invalidate a user's link.
- Only explicit confirmation consumes the token.
- No token value is logged or persisted in client storage.

### Commit

```text
fix: require confirmation for email login
```

## Task 5 — Require candidate-generated worker evidence during deploy

**Priority:** P1

**Primary files:**

- `ansible-playbook.yml`
- `apps/server/test/deployment-playbook.test.ts`
- `docs/DEPLOYMENT.md`

### Required behavior

- Deployment must not pass using a worker cycle or critical source-health row produced before candidate promotion.
- Capture the promoted worker container `StartedAt` or an equivalent candidate-validation timestamp.
- Require `worker_cycle_metrics.latest.cycle_completed_at` to be newer than that boundary.
- Require critical source-health checks to be newer than the candidate cycle/start boundary when those sources are enabled.
- Preserve the existing API canary, backup, migration, rollback, and provenance-invariant checks.

### Implementation shape

1. Capture and validate the promoted worker container ID and `StartedAt` after promotion.
2. Poll for a completed cycle whose start and completion timestamps postdate the candidate boundary.
3. Use that cycle as the freshness boundary for traffic, DATEX, and Entur source-health checks.
4. Increase the bounded wait to cover one real startup cycle instead of accepting old rows.
5. Fail into the existing rollback/rescue block if candidate evidence never arrives.

### TDD sequence

1. Update the deployment-playbook contract tests to require timestamp coupling.
2. Confirm RED because current tests explicitly reject candidate timestamp coupling.
3. Implement the playbook changes.
4. Run the focused deployment tests and Ansible syntax check.

### Acceptance

- Old healthy rows cannot satisfy candidate validation.
- A slow but healthy first cycle has a bounded opportunity to complete.
- Failure still restores both previous images and verifies production health.

### Commit

```text
fix: require fresh worker deploy evidence
```

## Task 6 — Full verification and release

### Local gate

Install the Playwright revision matching the lockfile if it is still absent, then run:

```bash
npx playwright install chromium
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml
bash -n scripts/backup.sh scripts/restore-check.sh
git diff --check
```

If auth/session persistence or schema changes require Postgres proof, run migrations twice plus `scripts/migration-invariants.sql` against a disposable PostGIS instance before release.

### Release gate

1. Rebase or merge current `origin/main` without dropping unrelated work.
2. Review the exact branch diff and confirm only intended files are staged.
3. Push the remediation branch and open a focused PR.
4. Require all CI jobs, including Playwright, migration smoke, dependency audit, and Docker builds.
5. Merge only when CI is green.
6. Verify deploy success for the exact merge SHA.
7. Verify live health/readiness, viewer privacy, revocation, and candidate worker-cycle freshness without exposing private data.
8. Record exact SHA, CI run, deploy run, and explicit non-claims in Obsidian.

## Final acceptance checklist

- [x] Viewer workspace-map discloses no private timeline or source-item metadata.
- [x] Viewer revocation is effective on the next request and invalidates persisted sessions.
- [x] DATEX disappearance cannot resolve an incident.
- [x] Email scanner GETs cannot consume login/invite tokens.
- [x] Deploy validation requires evidence produced by the promoted worker.
- [x] `1034+` unit/integration tests pass with all new regressions (`1035` passed).
- [x] Full desktop/mobile Playwright suite passes (`123` passed, `1` intentionally skipped).
- [x] Existing migration-invariant tests pass; no schema migration was introduced.
- [ ] CI, deploy, and live proof are tied to the exact merge SHA.

Local verification completed 2026-07-12: typecheck, lint, format check, `1035` Vitest tests,
production build, `123` Playwright tests, production dependency audit (`0` vulnerabilities),
Ansible syntax check, shell syntax checks, and `git diff --check` all passed.

## Separate release obligation — do not mix into Nytt commits

The Vifty plan file below is currently untracked on `codex/v1.3-operator-clarity` and still needs its own review, commit, and push flow:

```text
/Users/reidar/Projectos/Vifty/docs/superpowers/plans/2026-07-12-vifty-v1.3-completion-and-hardening.md
```

Handle it in the Vifty repository/thread as a separate “yeet” after verifying its intended branch and relationship to the stacked v1.3 PRs. Never stage it from the Nytt release flow.
