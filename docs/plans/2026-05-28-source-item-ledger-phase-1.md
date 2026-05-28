# Source Item Ledger Phase 1 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Dispatch one implementer subagent per task, then run spec-compliance review and code-quality review before moving on. Do not run implementation subagents in parallel if they commit to this repo.

**Goal:** Add a first-class source item ledger so every collected article and official event can be stored, listed, linked to situations, and used later for claims/verification without changing current situation activation behavior.

**Architecture:** Keep the current React/Vite + Express + PostgreSQL/PostGIS + worker architecture. Add shared API-safe source-item types and Zod schemas, add `source_items` and `situation_source_items` tables, expose read/link APIs through the existing authenticated Express server, and mirror existing worker-collected articles/official events into the ledger. DATEX TravelTime remains operations-only in `datex_travel_times` and must not write source-item rows.

**Tech Stack:** TypeScript, Zod, Express, PostgreSQL/PostGIS SQL, Vitest/Supertest, React/Vite, Playwright, Node 22, GitHub Actions + Ansible deployment.

---

## Scope and non-goals

This is the implementation-ready Phase 1 slice from the broader Situation Room roadmap. It supersedes the earlier Phase 1 section in `.hermes/plans/2026-05-28_204350-nytt-situation-room-working-plan.md`.

In scope:

- Shared source-item domain types and validation schemas.
- Postgres schema for inbound source records and situation links.
- MemoryStore and PgStore support for listing/linking source items.
- Authenticated API endpoints for source stream and situation-linked source items.
- Frontend API helpers and a minimal linked-source display in `SituationPage`.
- Worker mirroring for existing `Article` and `OfficialEvent` records.
- Automatic link rows for existing situation/article and DATEX official-event situation relationships.
- Tests for identity, idempotency, cursor behavior, auth/CSRF, and DATEX TravelTime non-promotion.

Out of scope:

- Claims and verification decisions.
- Public derived incident briefs.
- RBAC/collaboration.
- Raw RSS/CAP/XML payload retention beyond what the current collectors already retain.
- Any DATEX TravelTime promotion or source stream entry.
- Any broad rename from `Situation` to `Incident`.

---

## Architecture audit

Architecture docs read before writing this plan:

- `docs/ARCHITECTURE.md`
- `docs/SOURCES.md`
- `docs/DEPLOYMENT.md`
- Existing DATEX implementation plans under `docs/plans/`

Runtime dependency chains touched:

```text
worker ingestion heartbeat
  apps/worker/src/index.ts
    -> collectRss()/collectMunicipality()/collectMetWarnings()/collectNveWarnings()/collectDatexSituationEvents()
    -> WorkerRepository.upsertArticles()
    -> WorkerRepository.upsertOfficialEvents()
    -> WorkerRepository.upsertSituation()
    -> existing source_health / collector_state / datex_travel_times behavior

server API heartbeat
  apps/server/src/app.ts
    -> configureAuth()/requireUser()/requireCsrf()
    -> Store interface
    -> MemoryStore for tests/dev without DATABASE_URL
    -> PgStore for production

frontend API heartbeat
  apps/frontend/src/api.ts
    -> CSRF-aware request() helper
    -> SituationPage rendering
```

Failure behavior and safety decisions:

- Worker collector failures are caught per source in `apps/worker/src/index.ts`; source-item mirroring inside repository methods must not be hidden behind a new broad `try/catch`. SQL/import failures should fail tests or degrade the relevant existing collection path loudly.
- `DATEX_USERNAME` and `DATEX_PASSWORD` are never exposed to frontend/API responses. Source items store payloads from already-collected records only; they do not store request headers or credentials.
- `rawPayload` remains server-side. The minimal UI shows title/summary/provider/timestamps only.
- `datex_travel_times` is the only TravelTime persistence path. Add a regression guard that `upsertDatexTravelTimes()` and `markMissingDatexTravelTimesStale()` do not touch `source_items`.
- Every task touching `WorkerRepository` runs targeted worker tests plus typecheck before commit.
- Every task touching `Store` implements both `MemoryStore` and `PgStore`; current API tests use MemoryStore by default, and production uses PgStore.

---

## External feed ingestion decisions

Identity and deduplication:

- Article source item identity: `(provider = article.source, kind = 'article', external_id = article.id)`.
- Official event source item identity: `(provider = event.source, kind = 'official_event', external_id = event.id)`.
- `source_items.capture_hash` is a deterministic SHA-256 over `provider`, `kind`, `externalId` when present, `originalUrl`, `publishedAt`, and normalized payload. It is unique, so feeds without external IDs can still dedupe in later phases.
- Use a deterministic source item `id`, e.g. `source:${sha256(provider + ':' + kind + ':' + stableKey)}`. Do not use random UUIDs for mirrored feed rows.

Version/update semantics:

- Repeated article/official-event collection updates the existing source item row rather than inserting a duplicate.
- For official events, `raw_payload = event.raw` and `normalized_payload = event` with `raw` omitted.
- For legacy articles, `raw_payload = article` in Phase 1 because current RSS/HTML collectors do not retain raw feed items. Add raw collector payload retention only as a later explicit task.

Snapshot lifecycle:

- `source_items` is an append/update ledger, not the lifecycle authority for open/closed incidents.
- Existing `official_events` expiration and `datex_travel_times` staleness rules remain authoritative.
- A successful snapshot that causes `official_events` expiration must not delete source items.
- Failed snapshots must not mark source items new, stale, resolved, or deleted.

Store vs promote:

- Writing a source item does not create a situation.
- Existing situation activation rules remain unchanged.
- Linking a source item to a situation is evidence/provenance bookkeeping, not verification.
- DATEX TravelTime is not a source item in Phase 1.

Geography:

- Article `location` becomes optional `geo_hint` as a Point `[lng, lat]`.
- Official event `geometry` becomes optional `geo_hint`.
- Missing geometry is allowed.

Operations/verification:

- Source-health rows remain in `source_health`.
- After deploy, verify counts by provider/kind and verify that `datex_travel_times` exists separately from `source_items`.

---

## Commands

Use Node 22 locally. The user's default Node may be too old.

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
```

Targeted commands used below:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- packages/shared/test/source-items.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-item-schema.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-store.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-api.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/api.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/source-items.test.ts apps/worker/test/repository.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run lint
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run format:check
```

Production verification after deployment:

```bash
curl -fsS https://nytt.reidar.tech/health
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production ps worker"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production logs --tail=80 worker"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select provider, kind, count(*) from source_items group by provider, kind order by provider, kind;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from source_items where provider='datex_travel_time' or kind='travel_time';\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from datex_travel_times;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,detail,last_checked_at,next_poll_at from source_health order by source;\""
```

Do not report CI/CD success until `gh run list --json status,conclusion` shows the relevant runs as `completed` with `conclusion=success`. Do not report production deployed until the live health endpoint and DB checks above have been run.

---

## Task 1: Add source item enums and shared types

**Objective:** Introduce API-safe public source-item types plus internal storage input types without changing runtime behavior.

**Files:**

- Create: `packages/shared/test/source-items.typecheck.ts`
- Modify: `packages/shared/src/types.ts`

**Step 1: Write failing compile-time contract**

Create `packages/shared/test/source-items.typecheck.ts`. This file is not a Vitest runtime test; it is compiled directly with `tsc` because current package tsconfigs include only `src/**/*.ts` and do not typecheck test files.

```ts
import type {
  SourceItem,
  SourceItemInput,
  SourceItemKind,
  SourceItemRecord,
  SourceItemRelationship,
  SourceReliabilityTier,
} from "../src/types.js";

const kind: SourceItemKind = "article";
const relationship: SourceItemRelationship = "supports";
const reliability: SourceReliabilityTier = "trusted_media";

const publicItem: SourceItem = {
  id: "source:article:nrk:one",
  provider: "nrk",
  kind,
  externalId: "article-one",
  originalUrl: "https://example.test/article-one",
  title: "Brann i Bymarka",
  summary: "Røyk observert ved Bymarka.",
  publishedAt: "2026-05-28T10:00:00.000Z",
  fetchedAt: "2026-05-28T10:01:00.000Z",
  captureHash: "a".repeat(64),
  geoHint: { type: "Point", coordinates: [10.3, 63.4] },
  reliabilityTier: reliability,
  linkedSituationIds: ["skogbrann-bymarka"],
};

const internalRecord: SourceItemRecord = {
  ...publicItem,
  rawPayload: { id: "article-one" },
  normalizedPayload: { title: "Brann i Bymarka" },
};

const input: SourceItemInput = {
  id: internalRecord.id,
  provider: internalRecord.provider,
  kind: internalRecord.kind,
  externalId: internalRecord.externalId,
  originalUrl: internalRecord.originalUrl,
  title: internalRecord.title,
  summary: internalRecord.summary,
  publishedAt: internalRecord.publishedAt,
  fetchedAt: internalRecord.fetchedAt,
  rawPayload: internalRecord.rawPayload,
  normalizedPayload: internalRecord.normalizedPayload,
  captureHash: internalRecord.captureHash,
  geoHint: internalRecord.geoHint,
  reliabilityTier: internalRecord.reliabilityTier,
};

void relationship;
void input;
```

**Step 2: Run direct typecheck to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck packages/shared/test/source-items.typecheck.ts
```

Expected: FAIL because `SourceItem`, `SourceItemRecord`, `SourceItemInput`, `SourceItemKind`, `SourceItemRelationship`, and `SourceReliabilityTier` do not exist.

**Step 3: Add minimal shared types**

In `packages/shared/src/types.ts`, after `TimelineEntry`, add:

```ts
export type SourceItemKind =
  | "article"
  | "official_event"
  | "warning"
  | "reporter_note"
  | "reader_tip"
  | "media_asset";

export type SourceReliabilityTier = "official" | "trusted_media" | "internal" | "unverified";
export type SourceItemRelationship = "supports" | "contradicts" | "context" | "duplicate";

export interface SourceItem {
  id: string;
  provider: SourceId;
  kind: SourceItemKind;
  externalId?: string;
  originalUrl?: string;
  title?: string;
  summary?: string;
  author?: string;
  publishedAt?: string;
  fetchedAt: string;
  captureHash: string;
  geoHint?: MapFeature["geometry"];
  reliabilityTier: SourceReliabilityTier;
  linkedSituationIds: string[];
}

export interface SourceItemRecord extends SourceItem {
  rawPayload: unknown;
  normalizedPayload: unknown;
}

export type SourceItemInput = Omit<SourceItemRecord, "linkedSituationIds">;

export interface SourceItemPage {
  items: SourceItem[];
  nextCursor?: string;
}

export interface SourceItemFilters {
  provider?: SourceId;
  kind?: SourceItemKind;
  unlinked?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface SituationSourceItemLink {
  situationId: string;
  sourceItemId: string;
  relationship: SourceItemRelationship;
  confidenceContribution?: number;
  linkedAt: string;
  linkedBy?: string;
}
```

`SourceItem` is API-safe and must not contain `rawPayload` or `normalizedPayload`. `SourceItemRecord`/`SourceItemInput` are internal server/worker shapes. Do not add `"travel_time"` to `SourceItemKind` in this phase.

**Step 4: Run typecheck to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck packages/shared/test/source-items.typecheck.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/test/source-items.typecheck.ts
git commit -m "feat: add source item shared types"
```

---

## Task 2: Add source item validation schemas

**Objective:** Add Zod schemas for source item filters and link requests.

**Files:**

- Create: `packages/shared/test/source-items.test.ts`
- Modify: `packages/shared/src/schemas.ts`

**Step 1: Write failing schema tests**

Create `packages/shared/test/source-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  sourceItemKindSchema,
  sourceItemLinkInputSchema,
  sourceItemQuerySchema,
  sourceItemRelationshipSchema,
  sourceReliabilityTierSchema,
} from "../src/schemas.js";

describe("source item validation schemas", () => {
  it("validates source item filters and link input", () => {
    expect(sourceItemKindSchema.parse("official_event")).toBe("official_event");
    expect(sourceReliabilityTierSchema.parse("official")).toBe("official");
    expect(sourceItemRelationshipSchema.parse("context")).toBe("context");
    expect(
      sourceItemQuerySchema.parse({ provider: "nrk", kind: "article", unlinked: "true", limit: "5" }),
    ).toMatchObject({ provider: "nrk", kind: "article", unlinked: true, limit: 5 });
    expect(sourceItemLinkInputSchema.parse({})).toEqual({ relationship: "supports" });
    expect(() => sourceItemLinkInputSchema.parse({ relationship: "travel_time" })).toThrow();
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- packages/shared/test/source-items.test.ts
```

Expected: FAIL because the schema exports do not exist.

**Step 3: Add schemas**

In `packages/shared/src/schemas.ts`, add exports near the query schemas:

```ts
export const sourceIdSchema = z.enum([
  "nrk",
  "adressa",
  "vg",
  "dagbladet",
  "trondheim_kommune",
  "met",
  "nve",
  "datex",
  "datex_travel_time",
  "dsb",
  "politiloggen",
  "deepseek",
]);

export const sourceItemKindSchema = z.enum([
  "article",
  "official_event",
  "warning",
  "reporter_note",
  "reader_tip",
  "media_asset",
]);

export const sourceReliabilityTierSchema = z.enum([
  "official",
  "trusted_media",
  "internal",
  "unverified",
]);

export const sourceItemRelationshipSchema = z.enum([
  "supports",
  "contradicts",
  "context",
  "duplicate",
]);

export const sourceItemQuerySchema = z.object({
  provider: sourceIdSchema.optional(),
  kind: sourceItemKindSchema.optional(),
  unlinked: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().max(160).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const sourceItemLinkInputSchema = z.object({
  relationship: sourceItemRelationshipSchema.default("supports"),
});
```

Leave the existing `geometrySchema` private for now; public geo validation can wait until source-item creation is exposed to users.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- packages/shared/test/source-items.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/test/source-items.test.ts
git commit -m "feat: add source item validation schemas"
```

---

## Task 3: Add source item database schema

**Objective:** Persist inbound source items and source-to-situation links with safe deduplication semantics.

**Files:**

- Create: `apps/server/test/source-item-schema.test.ts`
- Modify: `apps/server/src/db/schema.sql`

**Step 1: Write failing schema text test**

Create `apps/server/test/source-item-schema.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(new URL("../src/db/schema.sql", import.meta.url));

describe("source item schema", () => {
  it("defines source_items with safe dedupe indexes and situation links", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS source_items");
    expect(schema).toContain("raw_payload jsonb NOT NULL");
    expect(schema).toContain("normalized_payload jsonb NOT NULL");
    expect(schema).toContain("geo_hint geometry(Geometry, 4326)");
    expect(schema).toContain("source_items_provider_kind_external_id_unique");
    expect(schema).toContain("WHERE external_id IS NOT NULL");
    expect(schema).toContain("source_items_capture_hash_unique");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS situation_source_items");
    expect(schema).toContain("relationship text NOT NULL DEFAULT 'supports'");
    expect(schema).toContain("situation_source_items_source_item_idx");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-item-schema.test.ts
```

Expected: FAIL because `source_items` is not in `schema.sql`.

**Step 3: Add DDL**

In `apps/server/src/db/schema.sql`, insert after `official_events` and before `datex_travel_times`:

```sql
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

CREATE UNIQUE INDEX IF NOT EXISTS source_items_provider_kind_external_id_unique
  ON source_items (provider, kind, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS source_items_capture_hash_unique
  ON source_items (capture_hash);
CREATE INDEX IF NOT EXISTS source_items_provider_kind_idx ON source_items (provider, kind);
CREATE INDEX IF NOT EXISTS source_items_fetched_at_idx ON source_items (fetched_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS source_items_geo_hint_idx ON source_items USING gist (geo_hint);

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
```

Do not use `UNIQUE (provider, kind, external_id)` as a table constraint; PostgreSQL allows multiple NULL `external_id` rows.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-item-schema.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.sql apps/server/test/source-item-schema.test.ts
git commit -m "feat: add source item ledger schema"
```

---

## Task 4: Add source item listing to Store, MemoryStore, and PgStore

**Objective:** List source items with stable cursor pagination and filters.

**Files:**

- Create: `apps/server/test/source-items-store.test.ts`
- Modify: `apps/server/src/store.ts`

**Step 1: Write failing store tests**

Create `apps/server/test/source-items-store.test.ts` with the first listing tests:

```ts
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { MemoryStore, PgStore } from "../src/store.js";

describe("source item store", () => {
  it("lists seeded MemoryStore source items with unlinked filtering", async () => {
    const store = new MemoryStore();

    const page = await store.listSourceItems({ unlinked: true, limit: 5 }, "Reedtrullz");

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]).toMatchObject({ kind: "article", reliabilityTier: expect.any(String) });
    expect(page.items[0]?.linkedSituationIds).toEqual([]);
  });

  it("queries PgStore source items by fetched_at desc cursor order", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "source:one",
          provider: "nrk",
          kind: "article",
          external_id: "article-one",
          original_url: "https://example.test/one",
          title: "Brann i Bymarka",
          summary: "Røyk observert.",
          author: null,
          published_at: new Date("2026-05-28T10:00:00.000Z"),
          fetched_at: new Date("2026-05-28T10:01:00.000Z"),
          capture_hash: "a".repeat(64),
          geo_hint: { type: "Point", coordinates: [10.3, 63.4] },
          reliability_tier: "trusted_media",
          linked_situation_ids: [],
        },
      ],
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listSourceItems({ provider: "nrk", kind: "article", q: "Brann", limit: 1 }, "Reedtrullz");

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: "source:one", externalId: "article-one" });
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("FROM source_items si");
    expect(sql).toContain("ST_AsGeoJSON(si.geo_hint)::json AS geo_hint");
    expect(sql).toContain("ORDER BY si.fetched_at DESC, si.id DESC");
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("si.provider =");
    expect(sql).toContain("si.kind =");
    expect(sql).toContain("ILIKE");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-store.test.ts
```

Expected: FAIL because `listSourceItems` does not exist.

**Step 3: Implement listing**

In `apps/server/src/store.ts`:

- Import `createHash` alongside `randomUUID` if needed for MemoryStore sample source IDs.
- Import shared types: `SourceItem`, `SourceItemFilters`, `SourceItemPage`.
- Add to `Store`:

```ts
listSourceItems(filters: SourceItemFilters, login: string): Promise<SourceItemPage>;
```

- Add MemoryStore state:

```ts
private sourceItems = new Map<string, SourceItem>(
  sampleArticles.map((article) => {
    const item = memorySourceItemFromArticle(article);
    return [item.id, item];
  }),
);
private sourceLinks = new Map<string, { situationId: string; sourceItemId: string; relationship: string }>();
```

- Add `MemoryStore.listSourceItems()` with provider/kind/q/unlinked filters, existing `decodeCursor` / `beforeCursor`, order `fetchedAt DESC, id DESC`, and `linkedSituationIds` derived from `sourceLinks`.
- Add `PgStore.listSourceItems()` using this behavior:
  - provider exact match.
  - kind exact match.
  - q searches `title`, `summary`, and `original_url`.
  - unlinked uses `NOT EXISTS` against `situation_source_items`.
  - cursor uses existing `[timestamp, id]` base64url format against `si.fetched_at DESC, si.id DESC`.
  - query `LIMIT (limit + 1)` and return `nextCursor` using `encodeCursor(last.fetchedAt, last.id)`.
  - select geometry as `ST_AsGeoJSON(si.geo_hint)::json AS geo_hint`; never return raw PostGIS geometry directly.
  - do not select or return `raw_payload` / `normalized_payload` from API listing queries.
  - map snake_case rows to API-safe camelCase `SourceItem`.

Mapper shape:

```ts
function sourceItemFromRow(row: SourceItemRow): SourceItem {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    externalId: row.external_id ?? undefined,
    originalUrl: row.original_url ?? undefined,
    title: row.title ?? undefined,
    summary: row.summary ?? undefined,
    author: row.author ?? undefined,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    fetchedAt: new Date(row.fetched_at).toISOString(),
    captureHash: row.capture_hash,
    geoHint: row.geo_hint ?? undefined,
    reliabilityTier: row.reliability_tier,
    linkedSituationIds: row.linked_situation_ids ?? [],
  };
}
```

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-store.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/store.ts apps/server/test/source-items-store.test.ts
git commit -m "feat: list source items from store"
```

---

## Task 5: Add source item link methods to Store, MemoryStore, and PgStore

**Objective:** Link and unlink source items to situations idempotently.

**Files:**

- Modify: `apps/server/test/source-items-store.test.ts`
- Modify: `apps/server/src/store.ts`

**Step 1: Write failing link tests**

Append to `apps/server/test/source-items-store.test.ts`:

```ts
it("links and unlinks source items in MemoryStore", async () => {
  const store = new MemoryStore();
  const [item] = (await store.listSourceItems({ limit: 1 }, "Reedtrullz")).items;
  expect(item).toBeTruthy();

  const linked = await store.linkSourceItem(
    "skogbrann-bymarka",
    item.id,
    "supports",
    "Reedtrullz",
  );
  expect(linked?.linkedSituationIds).toContain("skogbrann-bymarka");

  const situationItems = await store.listSituationSourceItems("skogbrann-bymarka", "Reedtrullz");
  expect(situationItems.map((source) => source.id)).toContain(item.id);

  await expect(
    store.unlinkSourceItem("skogbrann-bymarka", item.id, "Reedtrullz"),
  ).resolves.toBe(true);
  await expect(store.listSituationSourceItems("skogbrann-bymarka", "Reedtrullz")).resolves.toEqual([]);
});

it("uses idempotent PgStore SQL for source item links", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: "source:one" }] })
    .mockResolvedValueOnce({ rows: [pgSourceItemRow({ linked_situation_ids: ["skogbrann-bymarka"] })] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });
  const store = new PgStore({ query } as unknown as pg.Pool);

  const linked = await store.linkSourceItem("skogbrann-bymarka", "source:one", "supports", "Reedtrullz");
  expect(linked?.linkedSituationIds).toEqual(["skogbrann-bymarka"]);
  expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO situation_source_items");
  expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT");

  await expect(store.unlinkSourceItem("skogbrann-bymarka", "source:one", "Reedtrullz")).resolves.toBe(true);
  expect(query.mock.calls[2]?.[0]).toContain("DELETE FROM situation_source_items");
});
```

Add a small `pgSourceItemRow()` helper in the test file to avoid duplicating the row fixture from Task 4.

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-store.test.ts
```

Expected: FAIL because link methods do not exist.

**Step 3: Implement link methods**

In `apps/server/src/store.ts`, add to `Store`:

```ts
listSituationSourceItems(situationId: string, login: string): Promise<SourceItem[]>;
linkSourceItem(
  situationId: string,
  sourceItemId: string,
  relationship: SourceItemRelationship,
  login: string,
): Promise<SourceItem | undefined>;
unlinkSourceItem(situationId: string, sourceItemId: string, login: string): Promise<boolean>;
```

MemoryStore rules:

- Return `undefined` if the situation or source item does not exist.
- Link key is `${situationId}:${sourceItemId}`.
- Re-linking updates relationship/linkedBy but does not duplicate.
- `listSituationSourceItems()` returns linked items with `linkedSituationIds` populated.

PgStore rules:

- `linkSourceItem()` inserts into `situation_source_items` with `ON CONFLICT (situation_id, source_item_id) DO UPDATE SET relationship=EXCLUDED.relationship, linked_by=EXCLUDED.linked_by, linked_at=now()`.
- It then returns the linked source item using a private `getSourceItem(id)` helper.
- `getSourceItem()` and `listSituationSourceItems()` use the same API-safe mapper as `listSourceItems()` and select `ST_AsGeoJSON(si.geo_hint)::json AS geo_hint`; they must not select or return `raw_payload` / `normalized_payload`.
- `unlinkSourceItem()` deletes exactly that link and returns `rowCount > 0`.
- `listSituationSourceItems()` selects source items joined through `situation_source_items`, ordered by `linked_at DESC, source_item_id DESC`.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-store.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/store.ts apps/server/test/source-items-store.test.ts
git commit -m "feat: link source items to situations"
```

---

## Task 6: Add `GET /api/source-items`

**Objective:** Expose the owner-only source stream.

**Files:**

- Create: `apps/server/test/source-items-api.test.ts`
- Modify: `apps/server/src/app.ts`

**Step 1: Write failing API tests**

Create `apps/server/test/source-items-api.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

async function testApp(devAuthBypass = true) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-source-items-"));
  return createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass,
    githubClientId: devAuthBypass ? undefined : "test-client",
    githubClientSecret: devAuthBypass ? undefined : "test-secret",
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
  });
}

describe("source item API", () => {
  it("rejects source item listing without an authenticated owner", async () => {
    const { app } = await testApp(false);
    await request(app).get("/api/source-items").expect(401);
  });

  it("lists source items for the owner with validated filters", async () => {
    const { app } = await testApp();
    await request(app)
      .get("/api/source-items?kind=article&unlinked=true&limit=5")
      .expect(200)
      .expect((response) => {
        expect(response.body.items.length).toBeGreaterThan(0);
        expect(response.body.items[0]).toMatchObject({ kind: "article" });
        expect(response.body.items[0]).not.toHaveProperty("rawPayload");
        expect(response.body.items[0]).not.toHaveProperty("normalizedPayload");
      });

    await request(app).get("/api/source-items?kind=travel_time").expect(400);
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-api.test.ts
```

Expected: FAIL with 404 for `/api/source-items`.

**Step 3: Implement route**

In `apps/server/src/app.ts`:

- Import `sourceItemQuerySchema` from `@nytt/shared`.
- Add this route after `/api/articles` and before `/api/situations`:

```ts
app.get("/api/source-items", async (req, res, next) => {
  try {
    const query = sourceItemQuerySchema.parse(req.query);
    res.json(await store.listSourceItems(query, currentLogin(req)));
  } catch (error) {
    next(error);
  }
});
```

No extra CSRF handling is needed; the existing `/api` CSRF middleware bypasses safe GET requests.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-api.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/source-items-api.test.ts
git commit -m "feat: expose source item stream API"
```

---

## Task 7: Add situation source item list API

**Objective:** Let a situation show the source items linked to it.

**Files:**

- Modify: `apps/server/test/source-items-api.test.ts`
- Modify: `apps/server/src/app.ts`

**Step 1: Write failing API test**

Append this Task 7-only test. Do not use POST here; POST is Task 8.

```ts
it("returns an empty linked-source list for a situation with no linked items", async () => {
  const { app } = await testApp();
  await request(app).get("/api/situations/skogbrann-bymarka/source-items").expect(200, []);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-api.test.ts
```

Expected: FAIL with 404 because the GET route does not exist.

**Step 3: Implement GET route**

In `apps/server/src/app.ts`, after `GET /api/situations/:id/articles`:

```ts
app.get("/api/situations/:id/source-items", async (req, res, next) => {
  try {
    const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
    if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
    res.json(await store.listSituationSourceItems(req.params.id, currentLogin(req)));
  } catch (error) {
    next(error);
  }
});
```

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-api.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS for the Task 7-only test.

**Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/source-items-api.test.ts
git commit -m "feat: expose situation source item list API"
```

---

## Task 8: Add source item link and unlink API routes

**Objective:** Allow the owner to link/unlink source items from a situation with CSRF protection.

**Files:**

- Modify: `apps/server/test/source-items-api.test.ts`
- Modify: `apps/server/src/app.ts`

**Step 1: Write failing mutation tests**

Append this integration test:

```ts
it("links and unlinks source items with CSRF and relationship validation", async () => {
  const { app } = await testApp();
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  const csrf = session.body.csrfToken as string;
  const sourceItems = await agent.get("/api/source-items?limit=1").expect(200);
  const sourceItemId = sourceItems.body.items[0].id as string;
  const encoded = encodeURIComponent(sourceItemId);

  await agent
    .post(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
    .send({ relationship: "supports" })
    .expect(403);

  await agent
    .post(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
    .set("X-CSRF-Token", csrf)
    .send({ relationship: "bad" })
    .expect(400);

  await agent
    .post(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
    .set("X-CSRF-Token", csrf)
    .send({ relationship: "supports" })
    .expect(201)
    .expect((response) => {
      expect(response.body.id).toBe(sourceItemId);
      expect(response.body.linkedSituationIds).toContain("skogbrann-bymarka");
    });

  await agent
    .delete(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
    .set("X-CSRF-Token", csrf)
    .expect(204);

  await agent.get("/api/situations/skogbrann-bymarka/source-items").expect(200, []);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-api.test.ts
```

Expected: FAIL because POST/DELETE routes do not exist.

**Step 3: Implement routes**

In `apps/server/src/app.ts`:

- Import `sourceItemLinkInputSchema` from `@nytt/shared`.
- Add after the situation source item GET route:

```ts
app.post("/api/situations/:id/source-items/:sourceItemId", async (req, res, next) => {
  try {
    const { relationship } = sourceItemLinkInputSchema.parse(req.body ?? {});
    const linked = await store.linkSourceItem(
      req.params.id,
      req.params.sourceItemId,
      relationship,
      currentLogin(req),
    );
    if (!linked) {
      res.status(404).json({ error: "Situasjon eller kildeelement finnes ikke." });
      return;
    }
    res.status(201).json(linked);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/situations/:id/source-items/:sourceItemId", async (req, res, next) => {
  try {
    await store.unlinkSourceItem(req.params.id, req.params.sourceItemId, currentLogin(req));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
```

The existing `/api` CSRF middleware handles POST/DELETE.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/source-items-api.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/source-items-api.test.ts
git commit -m "feat: link source items through API"
```

---

## Task 9: Add frontend source item API helpers

**Objective:** Add typed frontend wrappers for the source item endpoints using the existing CSRF-aware request helper.

**Files:**

- Create: `apps/frontend/src/api.test.ts`
- Modify: `apps/frontend/src/api.ts`

**Step 1: Write failing frontend API tests**

Create `apps/frontend/src/api.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

describe("frontend source item API helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests source item pages with filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: undefined }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.sourceItems({ provider: "nrk", kind: "article", unlinked: true, limit: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/source-items?provider=nrk&kind=article&unlinked=true&limit=5",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/api.test.ts
```

Expected: FAIL because `api.sourceItems` does not exist.

**Step 3: Implement helpers**

In `apps/frontend/src/api.ts`:

- Import `SourceItem`, `SourceItemFilters`, `SourceItemPage`, and `SourceItemRelationship`.
- Add to `api`:

```ts
sourceItems: (query: SourceItemFilters = {}) => {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  return request<SourceItemPage>(`/api/source-items?${parameters.toString()}`);
},
situationSourceItems: (id: string) => request<SourceItem[]>(`/api/situations/${id}/source-items`),
linkSourceItem: (
  id: string,
  sourceItemId: string,
  relationship: SourceItemRelationship = "supports",
) =>
  request<SourceItem>(`/api/situations/${id}/source-items/${encodeURIComponent(sourceItemId)}`, {
    method: "POST",
    body: JSON.stringify({ relationship }),
  }),
unlinkSourceItem: (id: string, sourceItemId: string) =>
  request<void>(`/api/situations/${id}/source-items/${encodeURIComponent(sourceItemId)}`, {
    method: "DELETE",
  }),
```

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/api.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/api.ts apps/frontend/src/api.test.ts
git commit -m "feat: add frontend source item API helpers"
```

---

## Task 10: Add worker source item mapping helpers

**Objective:** Create deterministic source-item inputs from existing `Article` and `OfficialEvent` records.

**Files:**

- Create: `apps/worker/test/source-items.test.ts`
- Modify: `apps/worker/src/repository.ts`

**Step 1: Write failing helper tests**

Create `apps/worker/test/source-items.test.ts`:

```ts
import type { Article, OfficialEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { articleSourceItemInput, officialEventSourceItemInput } from "../src/repository.js";

describe("worker source item mapping", () => {
  it("maps articles into trusted or official source item inputs", () => {
    const article: Article = {
      id: "article-one",
      source: "nrk",
      sourceLabel: "NRK",
      title: "Brann i Bymarka",
      excerpt: "Røyk observert ved Bymarka.",
      url: "https://example.test/one",
      publishedAt: "2026-05-28T10:00:00.000Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Bymarka"],
      location: { lat: 63.4, lng: 10.3, label: "Bymarka" },
    };

    const item = articleSourceItemInput(article, "2026-05-28T10:01:00.000Z");

    expect(item).toMatchObject({
      provider: "nrk",
      kind: "article",
      externalId: "article-one",
      originalUrl: "https://example.test/one",
      title: "Brann i Bymarka",
      summary: "Røyk observert ved Bymarka.",
      reliabilityTier: "trusted_media",
      geoHint: { type: "Point", coordinates: [10.3, 63.4] },
    });
    expect(item.id).toMatch(/^source:/);
    expect(item.captureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps official events using raw payload and official reliability", () => {
    const event: OfficialEvent = {
      id: "datex-event-one",
      source: "datex",
      eventType: "traffic",
      title: "E6 stengt",
      detail: "E6 er stengt ved Sluppen.",
      sourceUrl: "https://datex.example.test/situation",
      areaLabel: "Sluppen",
      state: "active",
      publishedAt: "2026-05-28T10:00:00.000Z",
      validFrom: "2026-05-28T10:00:00.000Z",
      validTo: "2026-05-28T11:00:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      raw: { upstream: "compact-datex" },
    };

    const item = officialEventSourceItemInput(event, "2026-05-28T10:01:00.000Z");

    expect(item).toMatchObject({
      provider: "datex",
      kind: "official_event",
      externalId: "datex-event-one",
      originalUrl: "https://datex.example.test/situation",
      title: "E6 stengt",
      summary: "E6 er stengt ved Sluppen.",
      rawPayload: { upstream: "compact-datex" },
      reliabilityTier: "official",
      geoHint: { type: "Point", coordinates: [10.39, 63.39] },
    });
    expect(item.normalizedPayload).not.toHaveProperty("raw");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/source-items.test.ts
```

Expected: FAIL because mapping helpers are missing.

**Step 3: Implement helpers**

In `apps/worker/src/repository.ts`:

- Import `SourceItemInput`.
- Add deterministic helper functions after `articleDedupeKey()` or near the bottom:

```ts
function sourceItemHash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sourceItemHash([provider, kind, stableKey])}`;
}

export function articleSourceItemInput(article: Article, fetchedAt: string): SourceItemInput {
  const normalizedPayload = {
    id: article.id,
    source: article.source,
    sourceLabel: article.sourceLabel,
    title: article.title,
    excerpt: article.excerpt,
    url: article.url,
    publishedAt: article.publishedAt,
    scope: article.scope,
    category: article.category,
    places: article.places,
    location: article.location,
  };
  return {
    id: sourceItemId(article.source, "article", article.id),
    provider: article.source,
    kind: "article",
    externalId: article.id,
    originalUrl: article.url,
    title: article.title,
    summary: article.excerpt,
    publishedAt: article.publishedAt,
    fetchedAt,
    rawPayload: article,
    normalizedPayload,
    captureHash: sourceItemHash([article.source, "article", article.id, article.url, article.publishedAt, normalizedPayload]),
    geoHint: article.location
      ? { type: "Point", coordinates: [article.location.lng, article.location.lat] }
      : undefined,
    reliabilityTier: article.source === "trondheim_kommune" ? "official" : "trusted_media",
  };
}
```

Add `officialEventSourceItemInput()` similarly. Build `normalizedPayload` explicitly so it omits `raw` without introducing an unused `raw` binding that would fail ESLint:

```ts
const normalizedPayload = {
  id: event.id,
  source: event.source,
  eventType: event.eventType,
  title: event.title,
  detail: event.detail,
  sourceUrl: event.sourceUrl,
  areaLabel: event.areaLabel,
  state: event.state,
  severity: event.severity,
  publishedAt: event.publishedAt,
  validFrom: event.validFrom,
  validTo: event.validTo,
  geometry: event.geometry,
  replacesIds: event.replacesIds,
};
```

Do not create a TravelTime mapper.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/source-items.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/source-items.test.ts
git commit -m "feat: map collected records to source items"
```

---

## Task 11: Mirror articles into `source_items`

**Objective:** When worker stores articles, it also upserts matching source item rows idempotently.

**Files:**

- Modify: `apps/worker/test/repository.test.ts`
- Modify: `apps/worker/src/repository.ts`

**Step 1: Write failing repository test**

Update the existing `refreshes stored article metadata without replacing situation linkage` test so it no longer expects exactly one query. Add assertions:

```ts
expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO source_items"), expect.any(Array));
const sourceItemCall = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO source_items"));
expect(sourceItemCall).toBeTruthy();
expect(String(sourceItemCall?.[0])).toContain("ON CONFLICT (provider, kind, external_id)");
expect(String(sourceItemCall?.[0])).toContain("WHERE external_id IS NOT NULL");
expect(sourceItemCall?.[1]).toEqual(
  expect.arrayContaining([article.source, "article", article.id, article.url, article.title]),
);
```

Also assert the first article update still preserves situation linkage:

```ts
expect(query.mock.calls[0]?.[0]).toContain("payload ? 'situationId'");
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because `upsertArticles()` does not write `source_items`.

**Step 3: Implement article mirroring**

In `WorkerRepository.upsertArticles()`:

- Compute one `fetchedAt` timestamp per method call.
- After the article update/insert path for each article, call a private `upsertSourceItem(item: SourceItemInput)` helper.
- Implement SQL:

```sql
INSERT INTO source_items
  (id, provider, kind, external_id, original_url, title, summary, author, published_at,
   fetched_at, raw_payload, normalized_payload, capture_hash, geo_hint, reliability_tier)
VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
   CASE WHEN $14::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($14),4326) END,
   $15)
ON CONFLICT (provider, kind, external_id) WHERE external_id IS NOT NULL
DO UPDATE SET
  original_url=EXCLUDED.original_url,
  title=EXCLUDED.title,
  summary=EXCLUDED.summary,
  author=EXCLUDED.author,
  published_at=EXCLUDED.published_at,
  fetched_at=EXCLUDED.fetched_at,
  raw_payload=EXCLUDED.raw_payload,
  normalized_payload=EXCLUDED.normalized_payload,
  capture_hash=EXCLUDED.capture_hash,
  geo_hint=EXCLUDED.geo_hint,
  reliability_tier=EXCLUDED.reliability_tier,
  updated_at=now()
```

If a future item has no external ID, add a second helper path using `ON CONFLICT (capture_hash)`. Phase 1 article/official-event writers always have external IDs.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: mirror articles into source item ledger"
```

---

## Task 12: Mirror official events into `source_items`

**Objective:** When worker stores MET/NVE/DATEX situation events, it also upserts official source item rows idempotently.

**Files:**

- Modify: `apps/worker/test/repository.test.ts`
- Modify: `apps/worker/src/repository.ts`

**Step 1: Write failing repository test**

Add a test to `apps/worker/test/repository.test.ts`:

```ts
it("mirrors official events into source item rows", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const repository = new WorkerRepository({ query } as unknown as pg.Pool);
  const event = {
    id: "datex-event-one",
    source: "datex",
    eventType: "traffic",
    title: "E6 stengt",
    detail: "Stengt ved Sluppen.",
    sourceUrl: "https://datex.example.test/situation",
    areaLabel: "Sluppen",
    state: "active",
    publishedAt: "2026-05-28T10:00:00.000Z",
    validFrom: "2026-05-28T10:00:00.000Z",
    validTo: "2026-05-28T11:00:00.000Z",
    raw: { compact: true },
  } as const;

  await repository.upsertOfficialEvents([event]);

  const sourceItemCall = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO source_items"));
  expect(sourceItemCall).toBeTruthy();
  expect(sourceItemCall?.[1]).toEqual(
    expect.arrayContaining(["datex", "official_event", "datex-event-one", event.sourceUrl, event.title]),
  );
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because `upsertOfficialEvents()` does not write source items.

**Step 3: Implement official-event mirroring**

In `WorkerRepository.upsertOfficialEvents()`:

- Compute `fetchedAt` once per method call.
- After inserting/updating each `official_events` row, call the same private `upsertSourceItem(officialEventSourceItemInput(event, fetchedAt))` helper.
- Preserve existing `replacesIds` cancellation behavior exactly.
- Do not duplicate full parsed DATEX XML nodes beyond the compact `event.raw` already retained by the DATEX parser.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: mirror official events into source item ledger"
```

---

## Task 13: Auto-link source items when situations reference articles or official events

**Objective:** Preserve existing relationships in the new ledger by linking related articles and DATEX official events to their situations.

**Files:**

- Modify: `apps/worker/test/repository.test.ts`
- Modify: `apps/worker/src/repository.ts`

**Step 1: Write failing auto-link test**

Add to `apps/worker/test/repository.test.ts`:

```ts
it("links source items for situation article and official event relationships", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] }) // previous situation
    .mockResolvedValue({ rows: [] });
  const repository = new WorkerRepository({ query } as unknown as pg.Pool);
  const situation = {
    id: "traffic-datex-one",
    type: "traffic",
    title: "E6 stengt",
    summary: "E6 er stengt.",
    status: "active",
    verificationStatus: "Offentlig bekreftet",
    importance: "high",
    updatedAt: "2026-05-28T10:00:00.000Z",
    createdAt: "2026-05-28T10:00:00.000Z",
    locationLabel: "Sluppen",
    officialSource: "datex",
    officialEventId: "datex-event-one",
    activationBasis: {
      rule: "official_source",
      sourceIds: ["datex"],
      articleIds: ["article-one"],
      activatedAt: "2026-05-28T10:00:00.000Z",
    },
    relatedArticleIds: ["article-one"],
    evidence: [],
    features: [],
    timeline: [],
  } as const;

  await repository.upsertSituation(situation);

  const linkCalls = query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO situation_source_items"));
  expect(linkCalls.length).toBeGreaterThanOrEqual(2);
  expect(String(linkCalls[0]?.[0])).toContain("SELECT $1, id, 'supports'");
  expect(String(linkCalls[0]?.[0])).toContain("FROM source_items");
  expect(String(linkCalls[0]?.[0])).toContain("kind='article'");
  expect(String(linkCalls[1]?.[0])).toContain("kind='official_event'");
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because `upsertSituation()` only writes `situation_articles`, not `situation_source_items`.

**Step 3: Implement auto-linking**

In `WorkerRepository.upsertSituation()`:

- After inserting each `situation_articles` row and updating article payload, add:

```sql
INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_by)
SELECT $1, id, 'supports', 'worker'
FROM source_items
WHERE kind='article' AND external_id=$2
ON CONFLICT (situation_id, source_item_id) DO NOTHING
```

- After handling `merged.officialEventId`, if `merged.officialSource` is present, add:

```sql
INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_by)
SELECT $1, id, 'supports', 'worker'
FROM source_items
WHERE provider=$2 AND kind='official_event' AND external_id=$3
ON CONFLICT (situation_id, source_item_id) DO NOTHING
```

Do not auto-link DATEX TravelTime corridors.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: link source items to worker situations"
```

---

## Task 14: Add DATEX TravelTime source-item boundary regression tests

**Objective:** Prove TravelTime remains operations-only after source-item mirroring exists.

**Files:**

- Modify: `apps/worker/test/repository.test.ts`

**Step 1: Add test-only guard**

This is a safety regression guard around existing correct behavior. It may pass immediately; that is acceptable because no production code is expected in this task.

Add assertions to the existing DATEX TravelTime repository tests:

```ts
expect(String(query.mock.calls[0]?.[0])).not.toContain("source_items");
expect(String(query.mock.calls[0]?.[0])).not.toContain("situation_source_items");
```

Specifically add them to:

- `upserts DATEX travel time corridors with compact payload and numeric columns`
- `marks DATEX travel time rows missing from a successful complete snapshot stale`

**Step 2: Run tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
```

Expected: PASS. If it fails, remove the accidental source-item write from TravelTime code.

**Step 3: Commit**

```bash
git add apps/worker/test/repository.test.ts
git commit -m "test: guard DATEX travel time source item boundary"
```

---

## Task 15: Render linked source items in `SituationPage`

**Objective:** Show linked source items as a small internal provenance panel without exposing raw payloads.

**Files:**

- Modify: `e2e/app.spec.ts`
- Modify: `apps/frontend/src/pages/SituationPage.tsx`
- Modify: `apps/frontend/src/styles.css`

**Step 1: Write failing Playwright test**

In `e2e/app.spec.ts`, extend the first situation test:

```ts
await expect(page.getByRole("heading", { name: "Kildegrunnlag" })).toBeVisible();
await expect(page.getByText(/Ingen kildeelementer er koblet ennå|NRK|Adresseavisen|Vegvesen/)).toBeVisible();
```

Expected before implementation: FAIL because the heading is missing.

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run test:e2e -- e2e/app.spec.ts
```

Expected: FAIL on missing `Kildegrunnlag` heading.

**Step 3: Implement minimal UI**

In `apps/frontend/src/pages/SituationPage.tsx`:

- Import `SourceItem` type.
- Add state:

```ts
const [sourceItems, setSourceItems] = useState<SourceItem[]>([]);
```

- In the existing `useEffect`, after loading workspace, also load source items:

```ts
void Promise.all([api.workspace(id), api.situationSourceItems(id)])
  .then(([workspaceResult, sourceItemResult]) => {
    setWorkspace(workspaceResult);
    setSourceItems(sourceItemResult);
  })
  .catch((reason: Error) => setError(reason.message));
```

- Render a panel near evidence/timeline:

```tsx
<section className="source-items-panel">
  <h2>Kildegrunnlag</h2>
  {sourceItems.length === 0 ? (
    <p>Ingen kildeelementer er koblet ennå.</p>
  ) : (
    <ul>
      {sourceItems.map((item) => (
        <li key={item.id}>
          <strong>{item.title ?? item.externalId ?? item.id}</strong>
          <span>{item.provider} · {item.kind} · {item.reliabilityTier}</span>
          {item.summary ? <p>{item.summary}</p> : null}
          {item.originalUrl ? <a href={item.originalUrl}>Åpne kilde</a> : null}
        </li>
      ))}
    </ul>
  )}
</section>
```

Do not render `rawPayload` or `normalizedPayload`.

Add minimal CSS in `apps/frontend/src/styles.css` for `.source-items-panel` consistent with existing cards.

**Step 4: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run test:e2e -- e2e/app.spec.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/pages/SituationPage.tsx apps/frontend/src/styles.css e2e/app.spec.ts
git commit -m "feat: show linked source items in situation workspace"
```

---

## Task 16: Document source item ledger and production verification

**Objective:** Record the source ledger rules so future feed work does not violate provenance or TravelTime boundaries.

**Files:**

- Modify: `docs/SOURCES.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOYMENT.md`

**Step 1: Update docs**

Add to `docs/ARCHITECTURE.md` under Provenance Model:

```md
Inbound public records enter the `source_items` ledger before editorial linking or verification. `source_items` stores provider, kind, durable upstream identity, fetched time, raw/normalized payload, capture hash, optional geo hint and reliability tier. `situation_source_items` links those records to situations without making verification claims by itself.
```

Add to `docs/SOURCES.md` near data source limits:

```md
Articles and official MET/NVE/DATEX situation events are mirrored into the internal `source_items` ledger. DATEX TravelTime is explicitly excluded from the editorial source stream and remains `datex_travel_times` plus `source_health` only.
```

Add to `docs/DEPLOYMENT.md` under DATEX Verification:

```bash
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select provider, kind, count(*) from source_items group by provider, kind order by provider, kind;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from source_items where provider='datex_travel_time' or kind='travel_time';\""
```

**Step 2: Verify docs formatting and no type regressions**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run format:check
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 3: Commit**

```bash
git add docs/SOURCES.md docs/ARCHITECTURE.md docs/DEPLOYMENT.md
git commit -m "docs: document source item ledger rules"
```

---

## Final local verification gate

After Task 16 and before pushing:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run lint
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run format:check
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run test:e2e
```

Expected: all pass.

Then inspect changes:

```bash
git status --short
git log --oneline -8
git diff --stat origin/main...HEAD
```

---

## Final post-implementation audit

Before declaring implementation complete, run a file-by-file audit using `subagent-driven-development/references/post-implementation-audit.md` adapted for this project:

- Read every modified file.
- Confirm no source item API leaks credentials or raw request metadata.
- Confirm raw/normalized payloads are not rendered in frontend.
- Confirm `datex_travel_times` remains separate and no source item has `provider='datex_travel_time'` or `kind='travel_time'`.
- Confirm source item upserts are idempotent for repeated article and official-event collection.
- Confirm cursor pagination does not repeat rows.
- Confirm MemoryStore and PgStore behavior match.
- Confirm existing situation activation rules are unchanged.

---

## Deployment handoff

When the implementation is committed locally:

```bash
git push origin main
gh run list --branch main --limit 5 --json databaseId,workflowName,status,conclusion,headSha,createdAt
```

Wait until CI and Deploy complete successfully. Then run production verification commands from the Commands section. Only report deployed when both GitHub Actions and live production checks have succeeded.
