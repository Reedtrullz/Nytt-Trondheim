# Backend Projection Integrity Remediation Implementation Plan

> **For agentic workers:** Execute inline as one test-driven backend wave. Do not stage, commit,
> push, deploy, or edit frontend-owned files.

**Goal:** Make the persisted normalized base exactly match paired v1 output while corrections remain
a current-generation server overlay, and make public cache health identical to readiness.

**Architecture:** Worker persistence receives an uncorrected v2 analysis plus separately computed
correction diagnostics and revision snapshot. PgStore builds active projections through one bounded
repeatable-read snapshot using shared health SQL, rechecks the key before cache publication, and
coalesces concurrent builds. Correction mutations operate on stable pair identity independently of
current co-membership for exact duplicates and preserve audit tombstones/history.

**Tech Stack:** TypeScript, Vitest, Express 5, PostgreSQL/PostGIS, Zod, SQL smoke scripts.

## Global Constraints

- Persisted v1 and v2 base membership and primary identity must have exact parity.
- Corrections never mutate generated base membership or public evidence.
- Active projection publication fails closed on parity, stable-row, primary, membership, count, or
  bounded-resource failure.
- Preserve unrelated worktree changes. Do not stage, commit, push, deploy, or access production.

---

### Task 1: Uncorrected worker base and candidate quarantine

**Files:** `apps/worker/src/index.ts`, `apps/worker/src/repository.ts`,
`apps/worker/test/index.test.ts`, `apps/worker/test/coverage-generation-repository.test.ts`,
`apps/server/src/db/schema.sql`, `.env.example`.

- [x] Add RED tests proving rejected pairs produce diagnostics but do not alter persisted v2 groups.
- [x] Add RED repository tests for correction revision diagnostics, empty active candidates, relative
      large drops, explicit override, and persisted health outcomes.
- [x] Implement separate base/diagnostic analyses, revision snapshot persistence, and documented
      active-volume guards.
- [x] Run focused worker and migration tests GREEN.

### Task 2: Shared repeatable-read health and coalesced active cache

**Files:** `apps/server/src/store.ts`, `apps/server/test/articles-store.test.ts`,
`apps/server/test/coverage-bundles-store.test.ts`, `apps/server/test/readiness.test.ts`.

- [x] Add RED tests for warm-cache stable corruption, legacy marker/revision mutation, exact
      readiness parity, concurrent cold-read coalescing, key recheck, and resource guards.
- [x] Extract one health/key SQL contract and use it from readiness and active materialization.
- [x] Build active cache through one repeatable-read client transaction, recheck before publication,
      and coalesce by generation/correction/legacy revision key.
- [x] Require nonempty persisted positive evidence before direct verification.

### Task 3: Correction identity, API status, tombstones, and projection revision

**Files:** `apps/server/src/store.ts`, `apps/server/src/app.ts`,
`apps/server/test/coverage-corrections-store.test.ts`, `apps/server/test/api.test.ts`,
`packages/shared/src/types.ts`, `packages/shared/src/article-bundles.ts`,
`packages/shared/src/schemas.ts`, shared schema tests.

- [x] Add RED tests for undo 404/409 response mapping and bounded replacements.
- [x] Add RED tests for exact duplicate no-op before co-membership validation, deterministic partial
      duplicates, no revision bump, and recomputed kind/confidence.
- [x] Add RED tests for two-member full-split tombstones, applicability labels, undo access, and
      normalized feed `projectionRevision`.
- [x] Implement minimal contract/store/app changes and run focused tests GREEN.

### Task 4: Canonical audit filters and explicit generation history

**Files:** `packages/shared/src/schemas.ts`, `packages/shared/src/article-bundles.ts`,
`apps/server/src/store.ts`, `apps/server/test/coverage-bundles-store.test.ts`.

- [x] Add RED schema/store tests for reviewable, weak, missing place/entity/official evidence,
      correction conflict, generation change, generation ID selection, and history cursor pagination.
- [x] Implement canonical server predicates over full unbounded edge/correction facts.
- [x] Compute summary counts from the fully filtered set before cursor/limit pagination.
- [x] Remove `OFFSET 1` history selection and use explicit generation ID/cursor selection.

### Task 5: Promotion and executable PostgreSQL lifecycle

**Files:** `scripts/promote-coverage-generation.sql`,
`scripts/coverage-promotion-control-flow.sql`, `scripts/coverage-lifecycle-smoke.ts`.

- [x] Extend smoke RED assertions for generation→split→real worker generation→effective carryover→
      undo→later regroup, duplicate no-op, tombstone, cache corruption and concurrent cold reads.
- [x] Make promotion supersede every other active v2 stable row and assert only candidate rows remain
      active; require persisted healthy recent generations.
- [x] Run schema twice, lifecycle, and production promotion SQL in CI order on fresh disposable
      PostGIS.

### Task 6: Documentation and final evidence

**Files:** `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/SOURCES.md`,
`.superpowers/sdd/backend-final-remediation.md`.

- [x] Document immutable uncorrected base, overlay diagnostics/revision, shared cache/readiness
      snapshot, guards, filters/history, tombstones, and promotion pruning.
- [x] Run focused suites, full Vitest, typecheck, lint, format, matcher, build, audit, Ansible syntax,
      workflow YAML parse, and diff hygiene.
- [x] Confirm the four untracked critical files remain present and referenced.
- [x] Remove disposable resources and append evidence/non-claims to the Nytt project and daily notes.

---

## Final re-review closure (13:35)

The following tasks supersede the earlier completion state. This worktree remains uncommitted by
explicit instruction; every task ends in fresh tests rather than a commit.

### Task 7: Upgrade-safe persisted health and deploy promotion gate

**Files:** `apps/server/src/db/schema.sql`, `ansible-playbook.yml`,
`apps/server/test/migration-invariants.test.ts`, `apps/server/test/deployment-playbook.test.ts`,
`scripts/coverage-promotion-control-flow.sql`.

- [x] Add RED assertions that migration leaves an old active v2 row `unchecked`, the deploy query
      recognizes only a healthy current active v2 row, and an unchecked current row therefore
      requires an exact reviewed healthy shadow promotion.
- [x] Change the playbook precheck to require `health_outcome='healthy'`; retain the hard stop before
      target flags when no valid reviewed UUID is supplied.
- [x] Extend disposable PostGIS control flow from an unchecked old active row through guarded healthy
      shadow promotion, exact current readback, and no readiness `503` trap.
- [x] Run migration/playbook/control tests GREEN.

### Task 8: Recomputed correction confidence

**Files:** `apps/server/src/store.ts`, `apps/server/test/coverage-corrections-store.test.ts`,
`apps/server/test/articles-store.test.ts`.

- [x] Add a RED correction fixture where the effective regrouped bundle confidence differs from the
      stored base confidence and assert feed/audit use the recomputed `matchConfidence`.
- [x] Prefer `story.coverageBundle.matchConfidence` over the overlapping stored base value.
- [x] Run correction/feed tests GREEN.

### Task 9: Canonical review predicates and adjacent-generation changes

**Files:** `packages/shared/src/article-bundles.ts`, `apps/server/src/store.ts`,
`apps/server/test/coverage-bundles-store.test.ts`.

- [x] Add RED tests that multiple review filters use AND; missing place/entity inspect accepted group
      evidence; missing official uses derived public verification; correction generation mismatch is
      not a generation change; adjacent membership/primary/stable identity change is.
- [x] Add explicit item facts for derived public verification and adjacent-generation change, then
      implement one predicate per canonical review value and combine selected predicates with AND.
- [x] Run normalized audit tests GREEN with false-positive and false-negative cases.

### Task 10: Mode-independent superseded history

**Files:** `apps/server/src/store.ts`, `apps/server/test/coverage-bundles-store.test.ts`,
`scripts/coverage-lifecycle-smoke.ts`.

- [x] Add RED query tests proving superseded history selects all non-current completed v2 generations
      across prior active/shadow modes, accepts an explicit older active UUID, and keyset-paginates by
      `(completed_at,id)` deterministically.
- [x] Replace the shadow-mode history predicate with `matcher_version='v2' AND NOT is_current`, while
      preserving active and shadow current selectors.
- [x] Run audit tests and disposable PostGIS history lifecycle GREEN.

### Task 11: Historical-only corrections outside active projection

**Files:** `apps/server/src/store.ts`, `apps/server/test/coverage-bundles-store.test.ts`,
`apps/server/test/coverage-corrections-store.test.ts`.

- [x] Add RED shadow/superseded tests proving endpoint presence alone cannot make a correction active,
      affect corrected filters, or increment active-correction summaries.
- [x] Emit `applicability='active'` only for the active projection with both current endpoints;
      non-active projections emit history unless a future explicit temporal proof is added.
- [x] Run correction/audit tests GREEN, then execute the full repository and PostGIS verification
      matrix and refresh docs/report/Obsidian with exact evidence and non-claims.
