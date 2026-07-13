# Similar-Case Lifecycle and Immediate Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expand-compatible normalized coverage lifecycle, persist v2 shadow generations safely, make public and audit projections queryable from one source of truth, and provide owner-only transactional split/undo operations without promoting v2 publicly.

**Architecture:** Extend the existing `coverage_bundles` table with current-state metadata while adding immutable generation-scoped version, member and edge tables plus exact-pair correction records. Persist each candidate generation in one PostgreSQL transaction; only a completed generation may replace the previous normalized active projection. Correction APIs mutate exact rejected pairs and synchronously recompute replacement stories through the same server store boundary.

**Tech Stack:** PostgreSQL 16/PostGIS, Express 5, `pg`, Zod, TypeScript strict mode, Supertest, Vitest, npm workspaces, existing CSRF/owner middleware.

## Global Constraints

- Complete `docs/superpowers/plans/2026-07-13-similar-case-matching-trust-safety.md` first.
- Follow `/Users/reidar/Projectos/Nytt/AGENTS.md`; migrations must be expand/contract-compatible with the previous release.
- Run `df -h /System/Volumes/Data` before long test/build loops and stop below `30Gi` free.
- Do not rename or drop the legacy `coverage_bundles` table or columns in this plan.
- Do not remove embedded `Article.coverageBundle` reads or v1 writes.
- Failed candidate generations must preserve the last successful active normalized projection.
- All member and correction article references use foreign keys to `articles`.
- Corrections are owner-only, CSRF-protected, exact unordered article pairs, immediate, idempotent and reversible.
- Corrections never mutate articles, source items, situations or public evidence.
- Do not permit v2 public promotion in this plan; normalized data remains shadow/audit-only.
- User-facing error copy is Bokmål; logs must omit article bodies and correction reason text.
- Use TDD and commit only the files named by each task.

## File Map

- Modify `apps/server/src/db/schema.sql`: expand-only generation, immutable bundle-version, member, edge and correction schema plus current-state columns.
- Create `apps/worker/test/coverage-generation-repository.test.ts`: real/mocked transaction invariants.
- Modify `apps/worker/src/repository.ts`: transactional `persistCoverageGeneration()` and bounded retention.
- Modify `apps/worker/src/index.ts`: dual-write v1 legacy plus v2 normalized shadow generation.
- Modify `packages/shared/src/types.ts`: generation, edge, correction, parity and mutation response contracts.
- Modify `packages/shared/src/schemas.ts`: list filters, split request and undo validation.
- Modify `packages/shared/src/article-bundles.ts`: correction-aware synchronous recomputation input/output.
- Create `packages/shared/test/fixtures/article-coverage-corrections.ts`: synthetic correction/regrouping fixture.
- Modify `apps/server/src/store.ts`: normalized list/projection/parity reads and transactional split/undo methods.
- Create `apps/server/test/coverage-corrections-store.test.ts`: store-level mutation and conflict tests.
- Modify `apps/server/src/app.ts`: owner/CSRF-protected split and undo routes.
- Modify `apps/server/test/api.test.ts`: authorization, validation, idempotency and `409` behavior.
- Modify `apps/server/test/coverage-bundles-store.test.ts`: active-only counts, integrity and legacy fallback.
- Modify `.github/workflows/ci.yml`: twice-applied migration and normalized integrity smoke.
- Modify `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, and `docs/SOURCES.md`.

---

### Task 1: Add the expand-only normalized schema

**Files:**
- Modify: `apps/server/src/db/schema.sql:31-57,1361`
- Test: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing `articles`, `users`, and legacy `coverage_bundles` tables.
- Produces: `coverage_bundle_generations`, current-state bundle columns, generation-scoped `coverage_bundle_versions`, `coverage_bundle_members`, `coverage_bundle_edges`, and `coverage_bundle_corrections` for Tasks 2-6.

- [ ] **Step 1: Add a migration smoke assertion that currently fails**

In the PostGIS migration smoke section of `.github/workflows/ci.yml`, append this SQL after the second `npm run db:migrate`:

```yaml
      - name: Verify normalized coverage schema
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/nytt_test
        run: |
          psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
          SELECT to_regclass('public.coverage_bundle_generations') IS NOT NULL AS generations_exists;
          SELECT to_regclass('public.coverage_bundle_versions') IS NOT NULL AS versions_exists;
          SELECT to_regclass('public.coverage_bundle_members') IS NOT NULL AS members_exists;
          SELECT to_regclass('public.coverage_bundle_edges') IS NOT NULL AS edges_exists;
          SELECT to_regclass('public.coverage_bundle_corrections') IS NOT NULL AS corrections_exists;
          SELECT count(*) = 7 AS expected_columns
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='coverage_bundles'
            AND column_name IN ('generation_id','state','matcher_version','match_tier','match_score','match_rationale','first_seen_at');
          SQL
```

- [ ] **Step 2: Run the migration smoke locally and verify the missing-table failure**

Run against the repository's disposable PostgreSQL test service:

```bash
npm run db:migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.coverage_bundle_generations')"
```

Expected before the schema change: the query returns `NULL`.

- [ ] **Step 3: Add generation and current-state bundle columns**

Insert after the existing legacy coverage indexes in `schema.sql`:

```sql
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
  is_current boolean NOT NULL DEFAULT false,
  error_class text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'running' AND completed_at IS NULL) OR (status <> 'running' AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS coverage_bundle_generations_completed_idx
  ON coverage_bundle_generations (completed_at DESC, id DESC)
  WHERE status = 'completed';
CREATE UNIQUE INDEX IF NOT EXISTS coverage_bundle_generations_one_current_idx
  ON coverage_bundle_generations ((is_current))
  WHERE is_current AND status = 'completed';

ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS generation_id uuid REFERENCES coverage_bundle_generations(id) ON DELETE SET NULL;
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
```

The unique active-generation index is intentionally scoped to `mode='active'`. During this plan normalized v2 generations use `mode='shadow'`, so they do not displace any active projection.

- [ ] **Step 4: Add normalized member, edge and correction tables**

Append:

```sql
CREATE TABLE IF NOT EXISTS coverage_bundle_versions (
  generation_id uuid NOT NULL REFERENCES coverage_bundle_generations(id) ON DELETE CASCADE,
  bundle_id text NOT NULL REFERENCES coverage_bundles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('incident', 'topic', 'update')),
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
  CHECK (array_length(admitted_by_article_ids, 1) IS NULL OR array_length(admitted_by_article_ids, 1) <= 2)
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

CREATE TABLE IF NOT EXISTS coverage_bundle_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_bundle_id text NOT NULL,
  anchor_article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  rejected_article_id text NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  matcher_version text NOT NULL CHECK (matcher_version IN ('v1', 'v2')),
  evidence_fingerprint text NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  status text NOT NULL CHECK (status IN ('active', 'reverted')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (anchor_article_id <> rejected_article_id),
  CHECK ((status = 'active' AND reverted_at IS NULL AND reverted_by IS NULL) OR (status = 'reverted' AND reverted_at IS NOT NULL AND reverted_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS coverage_bundle_corrections_active_pair_idx
  ON coverage_bundle_corrections (
    LEAST(anchor_article_id, rejected_article_id),
    GREATEST(anchor_article_id, rejected_article_id)
  )
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS coverage_bundle_corrections_original_bundle_idx
  ON coverage_bundle_corrections (original_bundle_id, created_at DESC);
```

Preserve the semantic anchor and rejected columns. Treat the pair as unordered only for uniqueness, clustering lookup and evidence-edge lookup through `LEAST`/`GREATEST`.

- [ ] **Step 5: Register and verify the migration twice**

Append:

```sql
INSERT INTO schema_migrations (version) VALUES ('011_coverage_bundle_lifecycle') ON CONFLICT DO NOTHING;
```

Run:

```bash
npm run db:migrate
npm run db:migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) FROM coverage_bundle_generations;
SELECT count(*) FROM coverage_bundle_versions;
SELECT count(*) FROM coverage_bundle_members;
SELECT count(*) FROM coverage_bundle_edges;
SELECT count(*) FROM coverage_bundle_corrections;
SQL
```

Expected: both migrations exit `0`; all five normalized-table counts return `0` on a fresh database.

- [ ] **Step 6: Commit the expand-only schema**

```bash
git add apps/server/src/db/schema.sql .github/workflows/ci.yml
git commit -m "feat: add coverage lifecycle schema"
```

---

### Task 2: Persist v2 shadow generations transactionally

**Files:**
- Modify: `packages/shared/src/types.ts:1319-1327`
- Modify: `apps/worker/src/repository.ts:1-180`
- Create: `apps/worker/test/coverage-generation-repository.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `ArticleCoverageAnalysis.edges`, v2 bundle `matchConfidence`, and schema from Task 1.
- Produces: `persistCoverageGeneration(input): Promise<string>` and `failCoverageGeneration(input): Promise<void>`; Plan 3 reads these generations.

- [ ] **Step 1: Write repository transaction tests**

Create `apps/worker/test/coverage-generation-repository.test.ts` using a fake `pg.PoolClient` that records `BEGIN`, inserts and `COMMIT`. Include these cases:

```ts
import type pg from "pg";
import { vi } from "vitest";
import type { ArticleCoverageAnalysis } from "@nytt/shared";

interface RecordedQuery {
  sql: string;
  params?: unknown[];
}

function coverageAnalysisFixture(): ArticleCoverageAnalysis {
  const articles = [
    {
      id: "article-a",
      source: "nrk" as const,
      sourceLabel: "NRK Trøndelag",
      title: "Brann i anleggsbrakke",
      excerpt: "Byggeplass i Nærøysund",
      url: "https://example.test/article-a",
      publishedAt: "2026-07-12T20:00:00.000Z",
      scope: "trondelag" as const,
      category: "Hendelser" as const,
      places: ["Nærøysund"],
    },
    {
      id: "article-b",
      source: "adressa" as const,
      sourceLabel: "Adresseavisen",
      title: "Brakkebrann på byggeplass",
      excerpt: "Nødetatene rykket ut",
      url: "https://example.test/article-b",
      publishedAt: "2026-07-12T19:59:00.000Z",
      scope: "trondelag" as const,
      category: "Hendelser" as const,
      places: ["Nærøysund"],
    },
  ];
  return {
    articles,
    bundles: [{
      id: "coverage:v2:stable",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse",
      generatedAt: "2026-07-12T21:00:00.000Z",
      matcherVersion: "v2",
      matchConfidence: { tier: "strong", score: 0.9, rationale: "Sterkt direkte treff." },
      primaryArticleId: "article-a",
      memberArticleIds: ["article-a", "article-b"],
      sourceIds: ["nrk", "adressa"],
      sourceLabels: ["NRK Trøndelag", "Adresseavisen"],
      signals: [],
      nearMisses: [],
    }],
    nearMisses: [],
    edges: [{
      articleIds: ["article-a", "article-b"],
      tier: "strong",
      score: 0.9,
      kind: "incident",
      signals: [],
      conflicts: [],
      evidenceFingerprint: "v2:test-edge",
      reviewable: false,
      correctionConflict: false,
    }],
  };
}

function transactionClient(options: { failOn?: string } = {}) {
  const queries: RecordedQuery[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (options.failOn && sql.includes(options.failOn)) throw new Error("member insert failed");
    if (sql.includes("INSERT INTO coverage_bundle_generations") && sql.includes("RETURNING id")) {
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }], rowCount: 1 };
    }
    if (sql.includes("SELECT id FROM articles")) {
      return { rows: [{ id: "article-a" }, { id: "article-b" }], rowCount: 2 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query, release, queries } as unknown as pg.PoolClient & {
    queries: RecordedQuery[];
    release: ReturnType<typeof vi.fn>;
  };
}

function poolReturning(client: pg.PoolClient): pg.Pool {
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as pg.Pool;
}

it("persists one completed shadow generation in a transaction", async () => {
  const client = transactionClient();
  const repository = new WorkerRepository(poolReturning(client));
  const id = await repository.persistCoverageGeneration({
    matcherVersion: "v2",
    mode: "shadow",
    startedAt: "2026-07-12T20:59:00.000Z",
    completedAt: "2026-07-12T21:00:00.000Z",
    analysis: coverageAnalysisFixture(),
  });
  expect(id).toBe("11111111-1111-4111-8111-111111111111");
  expect(client.queries[0]?.sql).toBe("BEGIN");
  expect(client.queries.some((query) => query.sql.includes("INSERT INTO coverage_bundle_members"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("INSERT INTO coverage_bundle_edges"))).toBe(true);
  expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  expect(client.release).toHaveBeenCalledOnce();
});

it("rolls back and records failure without changing the prior projection", async () => {
  const client = transactionClient({ failOn: "INSERT INTO coverage_bundle_members" });
  const repository = new WorkerRepository(poolReturning(client));
  await expect(repository.persistCoverageGeneration({
    matcherVersion: "v2",
    mode: "shadow",
    startedAt: "2026-07-12T20:59:00.000Z",
    completedAt: "2026-07-12T21:00:00.000Z",
    analysis: coverageAnalysisFixture(),
  })).rejects.toThrow("member insert failed");
  expect(client.queries.some((query) => query.sql === "ROLLBACK")).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("state='superseded'"))).toBe(false);
  expect(client.release).toHaveBeenCalledOnce();
});

it("reuses the previous stable bundle id when most surviving membership overlaps", () => {
  const remapped = reuseCoverageBundleIds(
    [{ id: "coverage:v2:new-candidate", kind: "incident", memberArticleIds: ["a", "b", "c"] }],
    [{ id: "coverage:v2:stable", kind: "incident", memberArticleIds: ["a", "b"] }],
  );
  expect(remapped[0]?.id).toBe("coverage:v2:stable");
});
```

The helpers must return exact typed query rows; do not use `as any`.

- [ ] **Step 2: Run the repository test and verify failure**

```bash
npm test -- --run apps/worker/test/coverage-generation-repository.test.ts
```

Expected: FAIL because `persistCoverageGeneration` is missing.

- [ ] **Step 3: Add generation input and transactional persistence**

In `apps/worker/src/repository.ts`, add:

```ts
export interface PersistCoverageGenerationInput {
  matcherVersion: "v2";
  mode: "shadow" | "active";
  startedAt: string;
  completedAt: string;
  analysis: ArticleCoverageAnalysis;
}

export async function withTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

Implement `WorkerRepository.persistCoverageGeneration()` as one transaction:

1. Insert a `running` generation and return its UUID.
2. Validate every bundle has at least two members, one primary, `matchConfidence`, and all article IDs already exist using one `SELECT id FROM articles WHERE id = ANY($1::text[])`.
3. Load the latest completed generation in the same mode and its memberships. Run `reuseCoverageBundleIds()` before writes: candidates compete one-to-one for a previous bundle of the same kind, ordered by descending shared-member count then previous bundle ID; reuse only when the overlap is at least half of the smaller group. This preserves identity when the original ingestion-window anchor disappears without allowing one old ID to attach to two new groups.
4. For `mode='active'`, lock the current completed generation with `SELECT ... WHERE is_current FOR UPDATE`; for `shadow`, do not update the current active row.
5. Mark stable rows still pointing at the previous same-mode generation `superseded`, then upsert each candidate `coverage_bundles` stable/current-state row with `state='shadow'` (or `active` during promotion), generation ID, matcher version, match tier/score/rationale and `first_seen_at=COALESCE(existing.first_seen_at, EXCLUDED.first_seen_at)`.
6. Insert one immutable `coverage_bundle_versions` row per candidate with generation-specific kind, reason, primary, match confidence, source lists and timestamps.
7. Insert generation-scoped member rows with one `primary` role.
8. Insert edges with lexicographically ordered IDs; accepted edges carry a bundle ID, weak/reviewable edges may have `NULL` bundle ID.
9. Mark the generation `completed` with exact counts.
10. Only for `mode='active'`, set the previous generation `is_current=false`, supersede its bundle rows, set the new generation `is_current=true`, and promote new rows to `active` before commit.

Export and unit-test this exact helper contract:

```ts
export function reuseCoverageBundleIds<T extends { id: string; kind: ArticleCoverageBundleKind; memberArticleIds: string[] }>(
  candidates: T[],
  previous: T[],
): T[]
```

The helper returns cloned candidates and never mutates the analysis object supplied by the shared matcher.

Use this exact completion query:

```sql
UPDATE coverage_bundle_generations
SET status='completed', completed_at=$2, bundle_count=$3, edge_count=$4,
    correction_conflict_count=$5
WHERE id=$1 AND status='running'
```

On transaction failure, call a separate pool query after rollback:

```sql
INSERT INTO coverage_bundle_generations
  (matcher_version, mode, status, started_at, completed_at, article_count, error_class)
VALUES ($1,$2,'failed',$3,$4,$5,$6)
```

Store `error.constructor.name` or `"Error"`; never store the message or article content.

- [ ] **Step 4: Wire worker dual writes**

After legacy v1 `upsertArticles()` and `upsertCoverageBundles()`, persist the v2 shadow result:

```ts
await repository.persistCoverageGeneration({
  matcherVersion: "v2",
  mode: "shadow",
  startedAt: coverageStartedAt,
  completedAt: fetchedAt,
  analysis: coverageAnalyses.shadow.analysis,
});
```

If shadow persistence fails, record the failed generation and allow the worker cycle to fail so deployment freshness cannot claim a successful candidate cycle without coverage diagnostics. Legacy v1 rows remain transactionally untouched.

Extend `WorkerCycleMetrics` with an optional bounded coverage summary:

```ts
coverage?: {
  matcherVersion: "v2";
  generationId: string;
  mode: "shadow" | "active";
  analysisDurationMs: number;
  articleCount: number;
  bundleCountByTier: { strong: number; moderate: number };
  edgeCountByTier: { strong: number; moderate: number; weak: number };
  reviewCandidateCount: number;
  correctionConflictCount: number;
};
```

Have `persistCoverageGeneration()` return the generation ID and add this summary to `buildWorkerCycleMetrics()`. Tests assert exact numeric counts. Do not include titles, excerpts, URLs, correction reasons or article IDs in worker metrics.

- [ ] **Step 5: Run repository, worker and migration tests**

```bash
npm test -- --run apps/worker/test/coverage-generation-repository.test.ts apps/worker/test/index.test.ts
npm run typecheck -w @nytt/worker
npm run db:migrate
npm run db:migrate
```

Expected: tests/typecheck pass and schema remains idempotent.

- [ ] **Step 6: Commit transactional generation persistence**

```bash
git add packages/shared/src/types.ts apps/worker/src/repository.ts apps/worker/src/index.ts apps/worker/test/coverage-generation-repository.test.ts apps/worker/test/index.test.ts
git commit -m "feat: persist coverage shadow generations"
```

---

### Task 3: Add normalized list, parity and integrity contracts

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/article-bundles.ts`
- Modify: `apps/server/src/store.ts:300-350,1989-2120,5530-5665`
- Modify: `apps/server/test/coverage-bundles-store.test.ts`

**Interfaces:**
- Consumes: normalized tables from Tasks 1-2.
- Produces: `CoverageGenerationSummary`, expanded `CoverageBundlePage`, `CoverageProjectionParity`, and `listCoverageBundles()` active/shadow filters for Plan 3.

- [ ] **Step 1: Extend the store test with active-only and parity expectations**

Add a second test to `apps/server/test/coverage-bundles-store.test.ts` whose query mock expects:

```ts
expect(normalized).toContain("JOIN coverage_bundle_generations cg ON cg.id = cb.generation_id");
expect(normalized).toContain("coverage_bundle_versions cbv");
expect(normalized).toContain("cb.state = $1");
expect(normalized).toContain("cg.status = 'completed'");
expect(normalized).toContain("coverage_bundle_members cbm");
expect(normalized).toContain("coverage_bundle_edges cbe");
```

Return one normalized active group and assert:

```ts
expect(page.summary).toMatchObject({
  activeBundleCount: 1,
  byMatchTier: { strong: 1, moderate: 0 },
  reviewCandidateCount: 1,
  activeCorrectionCount: 0,
  integrityErrorCount: 0,
  matcherVersion: "v2",
  projectionState: "shadow",
});
expect(page.parity).toEqual({
  legacyBundleCount: 1,
  normalizedBundleCount: 1,
  membershipMismatchCount: 0,
  primaryMismatchCount: 0,
  clean: true,
});
```

- [ ] **Step 2: Run the store test and verify contract failure**

```bash
npm test -- --run apps/server/test/coverage-bundles-store.test.ts
```

Expected: FAIL because normalized summary/parity fields do not exist.

- [ ] **Step 3: Add shared normalized read contracts**

Add `CoverageProjectionState`, `CoverageGenerationSummary` and `CoverageProjectionParity` to `packages/shared/src/types.ts`:

```ts
export type CoverageProjectionState = "legacy" | "shadow" | "active" | "superseded";

export interface CoverageGenerationSummary {
  id: string;
  matcherVersion: "v1" | "v2";
  mode: "active" | "shadow";
  status: "completed";
  startedAt: string;
  completedAt: string;
  articleCount: number;
  bundleCount: number;
  edgeCount: number;
  correctionConflictCount: number;
}

export interface CoverageProjectionParity {
  legacyBundleCount: number;
  normalizedBundleCount: number;
  membershipMismatchCount: number;
  primaryMismatchCount: number;
  clean: boolean;
}
```

In `packages/shared/src/article-bundles.ts`, extend `CoverageBundleListItem` with `generation`, `state`, `matchConfidence`, `edges`, `corrections`, `integrityErrors`, and grouped `reviewCandidates`. Extend `CoverageBundleSummary` with the exact asserted fields while retaining legacy fields for one release. Extend `CoverageBundlePage` with optional `parity`.

Add list filters in `schemas.ts`:

```ts
projection: z.enum(["legacy", "shadow", "active", "superseded"]).default("shadow"),
matchTier: z.enum(["strong", "moderate"]).optional(),
corrected: z.coerce.boolean().optional(),
integrity: z.enum(["ok", "error"]).optional(),
```

- [ ] **Step 4: Read normalized groups without silently dropping members**

In `PgStore.listCoverageBundles()`, branch on `filters.projection`. Keep the legacy query for `legacy`. For normalized projections:

- select the latest completed generation for `shadow` or `active`;
- read generation-specific primary, reason, confidence, sources and timestamps from `coverage_bundle_versions` rather than the mutable stable bundle row;
- join `coverage_bundle_members` to `articles` and aggregate article payloads;
- join bounded accepted/reviewable edges;
- join active/reverted correction summaries;
- compute integrity errors when `count(cbm.article_id) < 2`, no primary exists, or a referenced article is absent;
- count only the selected completed generation in summary fields;
- cap review candidates at five per reason/tier in the response;
- compute parity against legacy rows by canonical sorted member IDs and primary ID.

Use SQL aggregation with `FILTER` and `jsonb_agg`, not one query per bundle. Never `flatMap` missing members away without adding an integrity error.

Expose a pure helper:

```ts
export function coverageProjectionParity(
  legacy: Array<{ id: string; primaryArticleId: string; memberArticleIds: string[] }>,
  normalized: Array<{ id: string; primaryArticleId: string; memberArticleIds: string[] }>,
): CoverageProjectionParity
```

and unit-test canonical ordering.

- [ ] **Step 5: Run store, schema and type tests**

```bash
npm test -- --run apps/server/test/coverage-bundles-store.test.ts
npm run typecheck -w @nytt/shared
npm run typecheck -w @nytt/server
```

Expected: tests and typechecks PASS.

- [ ] **Step 6: Commit normalized read/parity support**

```bash
git add packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/src/article-bundles.ts apps/server/src/store.ts apps/server/test/coverage-bundles-store.test.ts
git commit -m "feat: read normalized coverage projections"
```

---

### Task 4: Add split/undo contracts and correction-aware recomputation

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/article-bundles.ts`
- Create: `packages/shared/test/article-coverage-corrections.test.ts`

**Interfaces:**
- Consumes: `analyzeArticleCoverageV2(..., { rejectedPairs })` from Plan 1.
- Produces: validated `CoverageBundleSplitRequest`, `CoverageBundleCorrection`, `CoverageBundleCorrectionResult`, and `recomputeCoverageStories()` for Tasks 5-6 and Plan 3.

- [ ] **Step 1: Create the synthetic correction fixture**

Create `packages/shared/test/fixtures/article-coverage-corrections.ts`:

```ts
import type { Article } from "../../src/index.js";

export function correctionFixtureArticles(): Article[] {
  return [
    {
      id: "speed-a",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Kjørte i nær 200",
      excerpt: "Politiet stanset bilen i Orkland.",
      url: "https://example.test/speed-a",
      publishedAt: "2026-07-12T20:00:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
    {
      id: "speed-b",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Høy fart i Orkland",
      excerpt: "Bilen ble stanset etter svært høy fart.",
      url: "https://example.test/speed-b",
      publishedAt: "2026-07-12T19:59:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
    {
      id: "threat",
      source: "selbyggen",
      sourceLabel: "Selbyggen",
      title: "Syntetisk støttesak som eieren avviser",
      excerpt: "Testdata med samme syntetiske hendelses-ID.",
      url: "https://example.test/threat",
      publishedAt: "2026-07-12T19:58:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
  ];
}
```

- [ ] **Step 2: Write correction-aware cluster tests**

Create `packages/shared/test/article-coverage-corrections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeArticleCoverageV2 } from "../src/index.js";
import { correctionFixtureArticles } from "./fixtures/article-coverage-corrections.js";

describe("coverage corrections", () => {
  it("splits an exact rejected pair and prevents transitive regrouping", () => {
    const articles = correctionFixtureArticles();
    const analysis = analyzeArticleCoverageV2(articles, "2026-07-12T21:00:00.000Z", {
      rejectedPairs: [{ articleIds: ["speed-a", "threat"], correctionId: "correction-1" }],
    });
    const threatGroup = analysis.bundles.find((bundle) => bundle.memberArticleIds.includes("threat"));
    expect(threatGroup?.memberArticleIds).not.toContain("speed-a");
    expect(analysis.edges?.find((edge) => edge.articleIds.includes("speed-a") && edge.articleIds.includes("threat"))).toMatchObject({
      reviewable: true,
      correctionConflict: true,
    });
  });

  it("regroups after the rejection is removed", () => {
    const analysis = analyzeArticleCoverageV2(correctionFixtureArticles(), "2026-07-12T21:00:00.000Z", { rejectedPairs: [] });
    expect(analysis.bundles.some((bundle) => bundle.memberArticleIds.includes("speed-a") && bundle.memberArticleIds.includes("threat"))).toBe(true);
  });
});
```

The fixture intentionally creates a synthetic edge accepted without correction; do not reuse the critical false-positive corpus as a positive control.

- [ ] **Step 3: Run correction tests and verify `correctionConflict` failure**

```bash
npm test -- --run packages/shared/test/article-coverage-corrections.test.ts
```

Expected: FAIL because rejected edges are suppressed but not retained as correction-conflict review candidates.

- [ ] **Step 4: Add shared mutation contracts and schemas**

Add to `types.ts`:

```ts
export interface CoverageBundleSplitRequest {
  expectedGeneratedAt: string;
  anchorArticleId: string;
  rejectedArticleIds: string[];
  reason?: string;
}

export interface CoverageBundleCorrection {
  id: string;
  originalBundleId: string;
  anchorArticleId: string;
  rejectedArticleId: string;
  matcherVersion: "v1" | "v2";
  evidenceFingerprint: string;
  status: "active" | "reverted";
  createdAt: string;
  revertedAt?: string;
}

export interface CoverageBundleCorrectionResult {
  corrections: CoverageBundleCorrection[];
  removedStoryIds: string[];
  replacementStories: CityPulseStory[];
}

export interface CoverageCorrectionExportRow {
  correctionId: string;
  label: "separate";
  articleIds: [string, string];
  sources: [SourceId, SourceId];
  normalizedTitles: [string, string];
  normalizedExcerpts: [string, string];
  matcherVersion: "v1" | "v2";
  evidenceFingerprint: string;
  createdAt: string;
}

export interface CoverageCorrectionExport {
  schemaVersion: 1;
  generatedAt: string;
  rows: CoverageCorrectionExportRow[];
}
```

Add strict schemas:

```ts
export const coverageBundleSplitRequestSchema = z.object({
  expectedGeneratedAt: z.string().datetime(),
  anchorArticleId: z.string().trim().min(1).max(300),
  rejectedArticleIds: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict().transform((value) => ({
  ...value,
  rejectedArticleIds: [...new Set(value.rejectedArticleIds)].sort(),
}));

export const coverageCorrectionExportQuerySchema = z.object({
  sinceDays: z.coerce.number().int().min(1).max(365).default(30),
}).strict();
```

- [ ] **Step 5: Preserve corrected edges as review candidates**

In `analyzeArticleCoverageV2`, build a rejected-pair map. When an edge matches an active correction, return a copy with:

```ts
{
  ...edge,
  reviewable: true,
  correctionConflict: edge.tier === "strong" || edge.tier === "moderate",
}
```

Pass the rejected pair to clustering so no resulting group contains both IDs. Add `recomputeCoverageStories(articles, rejectedPairs, generatedAt)` that calls v2 analysis and converts groups through the existing `cityPulseStoryFromGroup()` semantics without database access.

- [ ] **Step 6: Run correction, clustering and schema tests**

```bash
npm test -- --run packages/shared/test/article-coverage-corrections.test.ts packages/shared/test/article-coverage-clustering.test.ts packages/shared/test/article-coverage-analysis.test.ts
npm run typecheck -w @nytt/shared
```

Expected: tests and shared typecheck PASS.

- [ ] **Step 7: Commit correction contracts**

```bash
git add packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/src/article-bundles.ts packages/shared/test/article-coverage-corrections.test.ts packages/shared/test/fixtures/article-coverage-corrections.ts
git commit -m "feat: add coverage correction contracts"
```

---

### Task 5: Implement transactional split and undo in the server store

**Files:**
- Modify: `apps/server/src/store.ts:280-350,5530-5665`
- Create: `apps/server/test/coverage-corrections-store.test.ts`

**Interfaces:**
- Consumes: split/correction contracts and normalized active/shadow projection.
- Produces: `Store.splitCoverageBundle(bundleId, input, actorId)` and `Store.undoCoverageCorrection(correctionId, actorId)` for Task 6 and Plan 3.

- [ ] **Step 1: Write store tests for immediate split, idempotency, stale conflict and undo**

Create `apps/server/test/coverage-corrections-store.test.ts` with a transaction-capable pool mock. Test exact outcomes:

```ts
import type pg from "pg";
import { vi } from "vitest";
import type { CoverageBundleSplitRequest } from "@nytt/shared";

function splitInput(): CoverageBundleSplitRequest {
  return {
    expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
    anchorArticleId: "speed-a",
    rejectedArticleIds: ["threat"],
    reason: "Ulik hendelse",
  };
}

type CorrectionScenario = "normal" | "duplicate" | "stale" | "undo";

function coverageCorrectionPool(scenario: CorrectionScenario): pg.Pool {
  const correction = {
    id: scenario === "duplicate" ? "existing-correction-id" : "correction-1",
    original_bundle_id: "coverage:v2:speed",
    anchor_article_id: "speed-a",
    rejected_article_id: "threat",
    matcher_version: "v2",
    evidence_fingerprint: "v2:test-edge",
    status: scenario === "undo" ? "reverted" : "active",
    created_at: "2026-07-12T21:01:00.000Z",
    reverted_at: scenario === "undo" ? "2026-07-12T21:02:00.000Z" : null,
  };
  const articles = [
    {
      id: "speed-a",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Kjørte i nær 200",
      excerpt: "Politiet stanset bilen.",
      url: "https://example.test/speed-a",
      publishedAt: "2026-07-12T20:00:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
    },
    {
      id: "speed-b",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Høy fart i Orkland",
      excerpt: "Bilen ble stanset.",
      url: "https://example.test/speed-b",
      publishedAt: "2026-07-12T19:59:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
    },
    {
      id: "threat",
      source: "selbyggen",
      sourceLabel: "Selbyggen",
      title: "Mann pågrepet etter trussel",
      excerpt: "Politiet pågrep mannen.",
      url: "https://example.test/threat",
      publishedAt: "2026-07-12T19:58:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Selbu"],
    },
  ];
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM coverage_bundles") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: "coverage:v2:speed",
            generated_at: scenario === "stale" ? "2026-07-12T21:05:00.000Z" : "2026-07-12T21:00:00.000Z",
            matcher_version: "v2",
            primary_article_id: "speed-a",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("coverage_bundle_members")) return { rows: articles.map((payload) => ({ payload })), rowCount: articles.length };
      if (sql.includes("coverage_bundle_edges")) {
        return { rows: [{ left_article_id: "speed-a", right_article_id: "threat", evidence_fingerprint: "v2:test-edge" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO coverage_bundle_corrections")) return { rows: scenario === "duplicate" ? [] : [correction], rowCount: scenario === "duplicate" ? 0 : 1 };
      if (sql.includes("UPDATE coverage_bundle_corrections")) return { rows: [{ ...correction, status: "reverted", reverted_at: "2026-07-12T21:02:00.000Z" }], rowCount: 1 };
      if (sql.includes("FROM coverage_bundle_corrections")) return { rows: [correction], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as pg.PoolClient;
  return { connect: vi.fn(async () => client), query: vi.fn() } as unknown as pg.Pool;
}

const correctionPoolFixture = () => coverageCorrectionPool("normal");
const duplicateCorrectionPoolFixture = () => coverageCorrectionPool("duplicate");
const staleGenerationPoolFixture = () => coverageCorrectionPool("stale");
const undoPoolFixture = () => coverageCorrectionPool("undo");

it("preserves anchor/rejected semantics and returns replacement stories", async () => {
  const store = new PgStore(correctionPoolFixture());
  const result = await store.splitCoverageBundle("coverage:v2:speed", {
    expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
    anchorArticleId: "speed-a",
    rejectedArticleIds: ["threat"],
    reason: "Ulik hendelse",
  }, "owner-user-id");
  expect(result.corrections).toEqual([
    expect.objectContaining({ anchorArticleId: "speed-a", rejectedArticleId: "threat", status: "active" }),
  ]);
  expect(result.removedStoryIds).toEqual(["coverage:v2:speed"]);
  expect(result.replacementStories.length).toBeGreaterThanOrEqual(2);
});

it("returns the existing active correction for a duplicate split", async () => {
  const store = new PgStore(duplicateCorrectionPoolFixture());
  const result = await store.splitCoverageBundle("coverage:v2:speed", splitInput(), "owner-user-id");
  expect(result.corrections).toHaveLength(1);
  expect(result.corrections[0]?.id).toBe("existing-correction-id");
});

it("throws CoverageBundleConflictError with current stories for stale generation", async () => {
  const store = new PgStore(staleGenerationPoolFixture());
  await expect(store.splitCoverageBundle("coverage:v2:speed", { ...splitInput(), expectedGeneratedAt: "2026-07-12T20:00:00.000Z" }, "owner-user-id"))
    .rejects.toMatchObject({ statusCode: 409, replacementStories: expect.any(Array) });
});

it("reverts all exact-pair effects for undo", async () => {
  const store = new PgStore(undoPoolFixture());
  const result = await store.undoCoverageCorrection("correction-1", "owner-user-id");
  expect(result.corrections[0]).toMatchObject({ id: "correction-1", status: "reverted" });
  expect(result.replacementStories).toEqual(expect.any(Array));
});
```

- [ ] **Step 2: Run store tests and verify missing-method failure**

```bash
npm test -- --run apps/server/test/coverage-corrections-store.test.ts
```

Expected: FAIL because store methods are missing.

- [ ] **Step 3: Add store interfaces and conflict error**

Add to `Store`:

```ts
splitCoverageBundle(bundleId: string, input: CoverageBundleSplitRequest, actorId: string): Promise<CoverageBundleCorrectionResult>;
undoCoverageCorrection(correctionId: string, actorId: string): Promise<CoverageBundleCorrectionResult>;
exportCoverageCorrections(sinceDays: number): Promise<CoverageCorrectionExport>;
```

Add:

```ts
export class CoverageBundleConflictError extends Error {
  readonly statusCode = 409;
  constructor(
    message: string,
    readonly replacementStories: CityPulseStory[],
  ) {
    super(message);
  }
}
```

MemoryStore uses an in-memory correction array and the same shared recomputation so dev mode matches production behavior. Its `exportCoverageCorrections()` applies the same title/excerpt normalization and excludes reason/actor fields, ensuring API tests cover both store implementations.

- [ ] **Step 4: Implement PostgreSQL split transaction**

`PgStore.splitCoverageBundle()` must:

1. `BEGIN` and lock the selected shadow/active bundle row plus generation with `FOR UPDATE`.
2. Load the selected bundle members for validation, then load every distinct article and active rejected pair in the same completed generation. The worker source window is bounded at 500 articles, so synchronous full-generation recomputation is deterministic and avoids missing an outside regrouping edge.
3. Compare `generated_at` with `expectedGeneratedAt`; on mismatch, rollback and throw `CoverageBundleConflictError` with current stories.
4. Verify anchor and all rejected IDs are current members; otherwise return the same `409` path.
5. Preserve the supplied anchor/rejected roles; use ordered IDs only to find the unordered edge and satisfy the active-pair uniqueness index.
6. Find the current pair edge and capture its evidence fingerprint; if no edge exists, sort the two IDs and use `` `v2:no-edge:${orderedIds.join(":")}` ``.
7. Insert each active correction with `ON CONFLICT (LEAST(anchor_article_id, rejected_article_id), GREATEST(anchor_article_id, rejected_article_id)) WHERE status='active' DO NOTHING`, then select the active row.
8. Recompute the full generation from all current articles plus every active rejected pair, then return only replacement stories that contain at least one original selected-bundle member.
9. `COMMIT` and return corrections, removed story ID and replacement stories.

Do not change generated bundle/member rows in the correction transaction. The effective story projection applies active corrections at read/recompute time, so undo is lossless.

- [ ] **Step 5: Implement undo transaction**

`undoCoverageCorrection()` must lock the active correction, set:

```sql
UPDATE coverage_bundle_corrections
SET status='reverted', reverted_at=now(), reverted_by=$2
WHERE id=$1 AND status='active'
RETURNING *
```

If already reverted, return the stored correction idempotently. Load the correction's generation, all its articles and remaining active pairs, recompute the full generation, filter replacements to the original affected members, and commit. A missing correction returns the existing store not-found error shape.

Add `exportCoverageCorrections()` as a read-only query over active and reverted corrections in the requested window. Join only the two referenced article payloads. Normalize whitespace, limit titles to 160 characters and excerpts to 280 characters, exclude the free-text correction reason and actor identity, sort rows by `createdAt` then correction ID, and return `schemaVersion: 1`. The export is review material and is never imported automatically.

- [ ] **Step 6: Run store and shared correction tests**

```bash
npm test -- --run apps/server/test/coverage-corrections-store.test.ts packages/shared/test/article-coverage-corrections.test.ts apps/server/test/coverage-bundles-store.test.ts
npm run typecheck -w @nytt/server
```

Expected: tests/typecheck PASS.

- [ ] **Step 7: Commit store mutations**

```bash
git add apps/server/src/store.ts apps/server/test/coverage-corrections-store.test.ts
git commit -m "feat: split and undo coverage groups"
```

---

### Task 6: Expose owner/CSRF-protected split and undo APIs

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/app.ts:1-115,2390-2420`
- Modify: `apps/server/test/config.test.ts`
- Modify: `apps/server/test/api.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: store methods from Task 5 and Zod schemas from Task 4.
- Produces: the two approved mutation endpoints plus the owner-only sanitized correction export for Plan 3.

- [ ] **Step 1: Add API tests for authorization, CSRF, validation and conflict**

Add an API test group near the current coverage route tests:

```ts
function splitInput(): CoverageBundleSplitRequest {
  return {
    expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
    anchorArticleId: "speed-a",
    rejectedArticleIds: ["threat"],
    reason: "Ulik hendelse",
  };
}

async function ownerAgentWithCoverageCorrections(enabled: boolean) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-coverage-corrections-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: false,
    coverageCorrectionsEnabled: enabled,
  });
  const agent = request.agent(runtime.app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

describe("coverage bundle corrections API", () => {
  it("fails closed while correction mutation is disabled", async () => {
    const { agent, csrf } = await ownerAgentWithCoverageCorrections(false);
    await agent
      .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
      .set("X-CSRF-Token", csrf)
      .send(splitInput())
      .expect(503, { error: "Korrigering av grupper er ikke aktivert." });
  });

  it("requires owner and CSRF for split", async () => {
    await request(app).post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split").send(splitInput()).expect(401);
    const { agent } = await ownerAgentWithCoverageCorrections(true);
    await agent.post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split").send(splitInput()).expect(403);
  });

  it("splits a current group and returns replacements", async () => {
    vi.spyOn(MemoryStore.prototype, "splitCoverageBundle").mockResolvedValue({
      corrections: [{
        id: "correction-1",
        originalBundleId: "coverage:v2:speed",
        anchorArticleId: "speed-a",
        rejectedArticleId: "threat",
        matcherVersion: "v2",
        evidenceFingerprint: "v2:test-edge",
        status: "active",
        createdAt: "2026-07-12T21:01:00.000Z",
      }],
      removedStoryIds: ["coverage:v2:speed"],
      replacementStories: [],
    });
    const { agent, csrf } = await ownerAgentWithCoverageCorrections(true);
    const response = await agent
      .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
      .set("X-CSRF-Token", csrf)
      .send(splitInput())
      .expect(200);
    expect(response.body).toMatchObject({ corrections: expect.any(Array), removedStoryIds: ["coverage:v2:speed"], replacementStories: expect.any(Array) });
  });

  it("returns current replacements for stale input", async () => {
    vi.spyOn(MemoryStore.prototype, "splitCoverageBundle").mockRejectedValue(
      new CoverageBundleConflictError("stale", []),
    );
    const { agent, csrf } = await ownerAgentWithCoverageCorrections(true);
    const response = await agent
      .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
      .set("X-CSRF-Token", csrf)
      .send({ ...splitInput(), expectedGeneratedAt: "2026-07-12T20:00:00.000Z" })
      .expect(409);
    expect(response.body).toMatchObject({ error: "Gruppen ble endret mens du vurderte den.", replacementStories: expect.any(Array) });
  });

  it("undoes an active correction", async () => {
    vi.spyOn(MemoryStore.prototype, "undoCoverageCorrection").mockResolvedValue({
      corrections: [{
        id: "correction-1",
        originalBundleId: "coverage:v2:speed",
        anchorArticleId: "speed-a",
        rejectedArticleId: "threat",
        matcherVersion: "v2",
        evidenceFingerprint: "v2:test-edge",
        status: "reverted",
        createdAt: "2026-07-12T21:01:00.000Z",
        revertedAt: "2026-07-12T21:02:00.000Z",
      }],
      removedStoryIds: ["coverage:v2:speed"],
      replacementStories: [],
    });
    const { agent, csrf } = await ownerAgentWithCoverageCorrections(true);
    const response = await agent.post("/api/coverage-bundle-corrections/correction-1/undo").set("X-CSRF-Token", csrf).expect(200);
    expect(response.body.corrections[0]).toMatchObject({ id: "correction-1", status: "reverted" });
  });

  it("exports sanitized correction labels without owner notes", async () => {
    vi.spyOn(MemoryStore.prototype, "exportCoverageCorrections").mockResolvedValue({
      schemaVersion: 1,
      generatedAt: "2026-07-12T21:05:00.000Z",
      rows: [],
    });
    const { agent } = await ownerAgentWithCoverageCorrections(true);
    const response = await agent.get("/api/operations/coverage-corrections/export?sinceDays=30").expect(200);
    expect(response.headers["content-disposition"]).toContain("coverage-corrections-v1.json");
    expect(response.body).toMatchObject({ schemaVersion: 1, rows: expect.any(Array) });
    expect(JSON.stringify(response.body)).not.toContain("Ulik hendelse");
    expect(JSON.stringify(response.body)).not.toContain("owner-user-id");
  });
});
```

Import `MemoryStore` and `CoverageBundleConflictError` beside the existing `PgStore` import. Restore all spies in the existing test cleanup hook so one API case cannot affect another.

- [ ] **Step 2: Run the API test and verify 404 failures**

```bash
npm test -- --run apps/server/test/api.test.ts -t "coverage bundle corrections API"
```

Expected: FAIL with `404` for the new routes.

- [ ] **Step 3: Register owner and CSRF routes**

Add optional `coverageCorrectionsEnabled?: boolean` to `AppConfig` so existing explicit test configurations remain source-compatible. Add this strict helper to `config.ts`:

```ts
function booleanEnvironmentValue(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}
```

`loadConfig()` sets `coverageCorrectionsEnabled: booleanEnvironmentValue("COVERAGE_CORRECTIONS_ENABLED", false)`. Route checks use `config.coverageCorrectionsEnabled === true`. Add `COVERAGE_CORRECTIONS_ENABLED=false` to `.env.example`.

Add config tests for the false default, `true`, `false`, and rejection of `yes`.

Extend `SessionPayload` with an optional capability block for rolling compatibility:

```ts
capabilities?: {
  coverageCorrections: boolean;
};
```

Return it from `/api/session` as `coverageCorrections: req.user?.role === "owner" && config.coverageCorrectionsEnabled === true`. Add API assertions that viewers and disabled owners receive `false` and enabled owners receive `true`.

Import `coverageBundleSplitRequestSchema`, `coverageCorrectionExportQuerySchema` and `CoverageBundleConflictError`. Add:

```ts
app.post(
  "/api/coverage-bundles/:bundleId/corrections/split",
  requireOwner,
  async (req, res, next) => {
    try {
      if (config.coverageCorrectionsEnabled !== true) {
        return void res.status(503).json({ error: "Korrigering av grupper er ikke aktivert." });
      }
      const input = coverageBundleSplitRequestSchema.parse(req.body);
      const result = await store.splitCoverageBundle(String(req.params.bundleId), input, req.user!.id);
      console.info(JSON.stringify({
        event: "coverage_correction",
        action: "split",
        bundleId: String(req.params.bundleId),
        correctionCount: result.corrections.length,
        replacementStoryCount: result.replacementStories.length,
      }));
      res.json(result);
    } catch (error) {
      if (error instanceof CoverageBundleConflictError) {
        console.info(JSON.stringify({
          event: "coverage_correction",
          action: "split_conflict",
          bundleId: String(req.params.bundleId),
          replacementStoryCount: error.replacementStories.length,
        }));
        return void res.status(409).json({
          error: "Gruppen ble endret mens du vurderte den.",
          replacementStories: error.replacementStories,
        });
      }
      next(error);
    }
  },
);

app.post(
  "/api/coverage-bundle-corrections/:correctionId/undo",
  requireOwner,
  async (req, res, next) => {
    try {
      if (config.coverageCorrectionsEnabled !== true) {
        return void res.status(503).json({ error: "Korrigering av grupper er ikke aktivert." });
      }
      const result = await store.undoCoverageCorrection(String(req.params.correctionId), req.user!.id);
      console.info(JSON.stringify({
        event: "coverage_correction",
        action: "undo",
        correctionId: String(req.params.correctionId),
        replacementStoryCount: result.replacementStories.length,
      }));
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/operations/coverage-corrections/export", async (req, res, next) => {
  try {
    const query = coverageCorrectionExportQuerySchema.parse(req.query);
    const payload = await store.exportCoverageCorrections(query.sinceDays);
    res.attachment("coverage-corrections-v1.json").json(payload);
  } catch (error) {
    next(error);
  }
});
```

Use `req.user!.id`, not login text, because the schema references `users(id)`. Do not add a second route-local CSRF middleware: `app.use("/api", requireCsrf(config))` already protects every unsafe `/api` method before these routes.
The `/api/operations` owner middleware already protects the export. It is read-only and therefore does not require CSRF.
API tests spy on `console.info` and assert the structured event contains counts and IDs but not `reason`, article title, excerpt, session data or credentials.

- [ ] **Step 4: Run API authorization and mutation tests**

```bash
npm test -- --run apps/server/test/config.test.ts apps/server/test/api.test.ts -t "coverage bundle corrections API|coverage corrections"
npm test -- --run apps/server/test/coverage-corrections-store.test.ts
npm run typecheck -w @nytt/server
```

Expected: all focused tests and typecheck PASS.

- [ ] **Step 5: Commit correction APIs**

```bash
git add apps/server/src/config.ts packages/shared/src/types.ts apps/server/src/app.ts apps/server/test/config.test.ts apps/server/test/api.test.ts .env.example
git commit -m "feat: expose owner coverage corrections"
```

---

### Task 7: Add retention, integrity gates and lifecycle documentation

**Files:**
- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/coverage-generation-repository.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/SOURCES.md`

**Interfaces:**
- Consumes: normalized schema and generation persistence.
- Produces: bounded historical retention, migration/integrity CI gates and the execution contract for Plan 3.

- [ ] **Step 1: Add a retention test**

Add to `coverage-generation-repository.test.ts`:

```ts
it("prunes completed superseded generations older than 30 days but preserves corrections", async () => {
  const client = transactionClient();
  const repository = new WorkerRepository(poolReturning(client));
  await repository.pruneCoverageGenerations("2026-07-12T21:00:00.000Z");
  const prune = client.queries.find((query) => query.sql.includes("DELETE FROM coverage_bundle_generations"));
  expect(prune?.sql).toContain("status = 'completed'");
  expect(prune?.sql).toContain("completed_at < $1::timestamptz - interval '30 days'");
  expect(prune?.sql).not.toContain("coverage_bundle_corrections");
});
```

- [ ] **Step 2: Implement bounded generation pruning**

Add:

```ts
async pruneCoverageGenerations(now: string): Promise<void> {
  await this.pool.query(
    `DELETE FROM coverage_bundle_generations
     WHERE status = 'completed'
       AND completed_at < $1::timestamptz - interval '30 days'
       AND id NOT IN (
         SELECT generation_id FROM coverage_bundles WHERE state IN ('active', 'shadow') AND generation_id IS NOT NULL
       )`,
    [now],
  );
}
```

Call it once after a successful generation. Cascades remove generation-scoped members/edges; stable bundle rows and corrections remain.

- [ ] **Step 3: Add CI integrity SQL**

Append to the normalized schema CI step:

```sql
SELECT count(*) = 0 AS no_dangling_members
FROM coverage_bundle_members cbm
LEFT JOIN articles a ON a.id = cbm.article_id
WHERE a.id IS NULL;

SELECT count(*) = 0 AS no_multi_primary
FROM (
  SELECT generation_id, bundle_id
  FROM coverage_bundle_members
  WHERE role='primary'
  GROUP BY generation_id, bundle_id
  HAVING count(*) <> 1
) invalid;

SELECT count(*) = 0 AS no_invalid_completed_generation
FROM coverage_bundle_generations
WHERE status='completed' AND completed_at IS NULL;
```

Wrap each assertion in a `DO` block that raises an exception when false so CI fails rather than printing `f`.

- [ ] **Step 4: Document lifecycle and security boundaries**

Update documentation with exact operational statements:

- `ARCHITECTURE.md`: one current stable bundle row plus immutable generation-scoped version/member/edge rows; corrections apply at projection time.
- `SECURITY.md`: owner+CSRF, internal actor ID, no reason text in logs, exact-pair scope, no upstream/situation mutation.
- `SOURCES.md`: normalized decisions and corrections remain derived and cannot become `source_items`.
- `DEPLOYMENT.md`: twice-applied migration, shadow generation count, integrity queries, parity query, failed-generation rollback, 30-day retention and explicit non-promotion.

Include these rollback commands in `DEPLOYMENT.md`:

```sql
UPDATE coverage_bundles SET state='superseded' WHERE state='shadow';
UPDATE coverage_bundle_generations
SET status='failed', completed_at=COALESCE(completed_at, now()), error_class='manual_shadow_disable'
WHERE mode='shadow' AND status='running';
```

State clearly that rollback does not delete corrections.

- [ ] **Step 5: Run the complete lifecycle verification**

```bash
df -h /System/Volumes/Data
npm run db:migrate
npm run db:migrate
npm run format:check
npm run lint
npm run typecheck
npm run check:coverage-matcher
npm test
npm run build
git diff --check
```

Expected: at least `30Gi` free and all commands exit `0`.

- [ ] **Step 6: Commit lifecycle hardening**

```bash
git add apps/worker/src/repository.ts apps/worker/test/coverage-generation-repository.test.ts .github/workflows/ci.yml docs/ARCHITECTURE.md docs/SECURITY.md docs/DEPLOYMENT.md docs/SOURCES.md
git commit -m "chore: gate coverage lifecycle integrity"
```

## Phase 2 Completion Gate

Before starting the UX/promotion plan, verify:

```bash
git status --short
npm run check:coverage-matcher
npm test -- --run apps/worker/test/coverage-generation-repository.test.ts apps/server/test/coverage-bundles-store.test.ts apps/server/test/coverage-corrections-store.test.ts apps/server/test/api.test.ts
```

Expected: only pre-existing untracked files remain; normalized shadow generations are transactionally writable; split/undo APIs pass owner/CSRF/stale tests; v1 remains the public projection.
