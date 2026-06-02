# Worker Observability Metrics Implementation Plan

> **For Hermes:** Execute directly as a parent-coordinated task because the worker/server/shared/frontend contract is cross-cutting. Use two-stage review after implementation: spec compliance first, code quality second.

**Goal:** Surface latest worker-cycle metrics in Operations so collection health is visible beyond per-source health rows.

**Architecture:** Keep raw worker telemetry out of `source_items`. The worker builds a typed `WorkerCycleMetrics` payload with a pure helper, persists only the latest row in a dedicated DB table through `WorkerRepository`, the server maps it into `OperationsStatus`, and the frontend renders summary cards on `OperationsPage`.

**Tech Stack:** TypeScript, Vitest, Express, PostgreSQL/PostGIS schema SQL, React, shared `@nytt/shared` types.

---

### Task 20.1: Define the shared worker metrics contract

**Objective:** Add a shared `WorkerCycleMetrics` type and include it in `OperationsStatus`.

**Files:**

- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/test/worker-metrics.test.ts`

**Steps:**

1. Add `WorkerCycleMetrics` with:
   - `cycleStartedAt: string`
   - `cycleCompletedAt: string`
   - `cycleDurationMs: number`
   - `sourceDurationsMs: Record<string, number>`
   - `sourceItemCounts: Record<string, number>`
   - `parseFailures: Record<string, number>`
2. Add `workerCycleMetrics?: WorkerCycleMetrics` to `OperationsStatus`.
3. Add a shared test proving the shape can be assigned and carries source count/failure maps.

**Verification:**
`npm test -- packages/shared/test/worker-metrics.test.ts && npm run typecheck`

---

### Task 20.2: Add pure worker metrics helper

**Objective:** Make worker cycle metric calculation testable without a real DB or network.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/index.test.ts`

**Steps:**

1. Export a narrow helper that accepts injected clock/source results, for example `buildWorkerCycleMetrics(input)`.
2. It must clamp negative durations to zero and aggregate:
   - source durations,
   - source item counts,
   - parse failures.
3. Add tests with an injected clock and synthetic source results.

**Verification:**
`npm test -- apps/worker/test/index.test.ts`

---

### Task 20.3: Persist latest metrics outside the source ledger

**Objective:** Store latest worker metrics in a dedicated operational table, never in `source_items`.

**Files:**

- Modify: `apps/server/src/db/schema.sql`
- Modify: `apps/worker/src/repository.ts`
- Test: `apps/server/test/source-item-schema.test.ts`
- Test: `apps/worker/test/repository.test.ts` or `apps/worker/test/index.test.ts`

**Steps:**

1. Add `worker_cycle_metrics` table with a singleton `id`, `cycle_started_at`, `cycle_completed_at`, `cycle_duration_ms`, `payload`, and `updated_at`.
2. Add `WorkerRepository.saveWorkerCycleMetrics(metrics)`.
3. Add tests/checks that the table exists and no worker telemetry is routed through `source_items`.

**Verification:**
`npm test -- apps/server/test/source-item-schema.test.ts apps/worker/test/index.test.ts`

---

### Task 20.4: Map metrics into Operations API

**Objective:** Return the latest persisted worker metrics from `/api/operations/status`.

**Files:**

- Modify: `apps/server/src/store.ts`
- Test: `apps/server/test/api.test.ts`

**Steps:**

1. Add `getLatestWorkerCycleMetrics()` to the store interface.
2. MemoryStore may return a deterministic sample metric for demo/development.
3. PgStore reads the latest singleton row from `worker_cycle_metrics`.
4. `getOperationsStatus()` includes `workerCycleMetrics`.
5. API test proves the Operations payload includes duration, slowest source input, failures, and counts.

**Verification:**
`npm test -- apps/server/test/api.test.ts`

---

### Task 20.5: Render metrics on OperationsPage

**Objective:** Show useful worker-health summaries in Operations.

**Files:**

- Modify: `apps/frontend/src/pages/OperationsPage.tsx`
- Create: `apps/frontend/src/pages/OperationsPage.test.tsx`
- Modify: `apps/frontend/src/styles.css` if needed.

**Steps:**

1. Render cards for:
   - last cycle duration,
   - slowest source,
   - parse failures,
   - stale source count,
   - backup/restore status if available.
2. Keep Norwegian copy clear and provenance-safe: metrics are operational telemetry, not incident evidence.
3. Add SSR/static-render test for representative metrics.

**Verification:**
`npm test -- apps/frontend/src/pages/OperationsPage.test.tsx`

---

### Task 20.6: Wire worker cycle recording and run gates

**Objective:** Record metrics at the end of each full worker collection cycle and verify the stack.

**Files:**

- Modify: `apps/worker/src/index.ts`

**Steps:**

1. Track high-level collection steps with small helper calls around network/source sections.
2. Save metrics in `finally` or at the end of successful collection so Operations reflects the latest completed cycle.
3. Do not let metrics persistence failure hide source-health errors; log and continue only after collection work has completed.

**Verification:**

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- apps/worker apps/server apps/frontend packages/shared
npm run typecheck
npm run lint
npm run format:check
```

---

## Plan review history

- Initial parent review: Task is intentionally parent-direct because the shared type, worker, DB, store, and frontend all share one contract. GPT-5.5 swarm was considered and `status` was checked, but worktree-isolated implementation was not launched because the task has overlapping hotspot files and one contract owner is safer.
