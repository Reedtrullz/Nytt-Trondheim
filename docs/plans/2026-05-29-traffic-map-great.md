# Great Traffic Map Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Nytt-Trondheim's traffic map feel as useful as Vegvesen's own map by ingesting the same TrafficInfo message feed, showing live official roadwork/closure/restriction events in the map, and keeping high-impact DATEX/SRTI situation logic separate from map-only traffic overlays.

**Architecture:** Add a dedicated `traffic_map_events` operational table for map-ready traffic overlays, fed primarily by Vegvesen TrafficInfo JSON and optionally by existing DATEX/SRTI official events. Mirror TrafficInfo messages into `source_items` as official evidence records, but do not promote ordinary roadworks into the main `situations` feed. The Express map API reads the dedicated table plus legacy DATEX fallbacks and returns the existing shared `TrafficMapPayload` contract.

**Tech Stack:** TypeScript, Node 22, Express, PostgreSQL/PostGIS, Vitest, React/Vite, Leaflet/react-leaflet, Vegvesen TrafficInfo JSON API, existing DATEX Basic Auth collectors.

---

## Current root cause and product target

Observed in production on 2026-05-29:

- Nytt `/api/map/traffic-events` currently renders zero because production has zero DATEX `official_events` rows and zero DATEX `source_items` rows.
- Vegvesen's own map uses `https://traffic-info.atlas.vegvesen.no/traffic-information/messages?sort=priorityScore&lang=no` with headers:
  - `accept: application/vnd.svv.v2+json; charset=utf-8`
  - `X-System-ID: vvtraf`
- That endpoint returned 1228 national messages during inspection, with 82 messages within 60 km of `lat=63.39073&lng=10.33082` and 129 messages in Trøndelag county. Most local records are roadworks; many are active or future low-impact/planned messages.
- Existing Nytt DATEX collector intentionally uses `GetSituation/pullsnapshotdata?srti=True`, a much smaller high-signal safety feed. It should remain the high-impact official-situation source, not become the only traffic map source.
- Existing DATEX parser also misses SRTI records that publish `coordinatesForDisplay` instead of `locationForDisplay`; fix that as a correctness patch, but it will not by itself make the map match Vegvesen.

## Architecture audit

Docs read before writing this plan:

- `docs/ARCHITECTURE.md`
- `docs/SOURCES.md`
- `writing-plans/references/external-feed-ingestion-plan-checklist.md`
- `writing-plans/references/source-item-ledger-feed-ingestion-notes.md`
- `subagent-driven-development/references/traffic-map-implementation-audit.md`

Runtime dependency chain:

```text
worker container
  apps/worker/src/index.ts
    -> collectTrafficInfoMessages()     [new, TrafficInfo JSON, no DATEX credentials]
    -> WorkerRepository.upsertTrafficMapEvents() [new operational table]
    -> WorkerRepository.upsertTrafficInfoSourceItems() [new ledger mirror]
    -> WorkerRepository.markMissingTrafficMapEventsExpired() [snapshot lifecycle]
server container
  apps/server/src/app.ts
    -> store.listTrafficMapEvents()     [new dedicated read path]
    -> existing DATEX official_events/source_items fallback
frontend
  apps/frontend/src/pages/TrafficMapPage.tsx
    -> useTrafficMap()
    -> TrafficLayer / filter panel / brief / list
```

Silent-degradation risks:

- Worker collectors are wrapped in `try/catch` and write `source_health`. Any import/runtime failure in a new TrafficInfo module can silently degrade only that source. Every worker task below includes a targeted import/test command.
- The map API is authenticated and CSRF-protected like the rest of `/api`; live unauthenticated curl will return 401. Verify production map data through DB/source-health or with an authenticated browser session, not by treating anonymous 401 JSON as a zero-event payload.
- Do not let TrafficInfo ordinary roadworks enter main `situations`. They are map overlays and source-items, not incident activations, unless a later explicit promotion rule is added.
- Do not change DATEX TravelTime rules: it remains `datex_travel_times` only and must not create official events/source items/situations.

## Feed semantics and product rules

TrafficInfo durable identity:

- Upstream durable ID: `trafficMessage.id`, examples like `NPRA_HBT_21-04-2026.66010`.
- Local map ID: `vegvesen-traffic-info:${message.id}`.
- Local source-item ID: existing source-item hash helper over provider/kind/externalId.
- Revision/change fields: `updatedTime`, `publicationTime`, `trafficImpact`, `activityStatus`, and a per-message normalized payload hash. The full snapshot hash is stored only in `collector_state` for observability.

Snapshot lifecycle:

- A successful TrafficInfo snapshot defines the currently known set for this source.
- Messages in the last successful snapshot are upserted with `last_seen_at=fetchedAt`.
- Previously active/planned TrafficInfo map events absent from a successful snapshot become `expired`.
- Failed fetch/parse does not expire prior records.
- If upstream has no `ETag` or `Last-Modified`, persist a snapshot hash in `collector_state` for observability only; still process successful snapshots because message state can be time-sensitive.
- Open-ended events with no `estimatedEndTime` expire when a successful later snapshot omits them. If TrafficInfo is degraded, keep existing events visible but mark the source stale in the payload. After a later successful snapshot, expire any open-ended TrafficInfo event not seen for 7 days with `expireStaleOpenEndedTrafficMapEvents`; this prevents permanently active rows without using failed fetches as evidence of disappearance.

Store vs promote:

- Store TrafficInfo messages in `traffic_map_events` for the map.
- Mirror TrafficInfo messages to `source_items` with provider `vegvesen_traffic_info`, kind `official_event`, reliability `official`.
- Do not create `official_events` or `situations` from TrafficInfo roadworks in this plan.
- Keep existing DATEX/SRTI collector for high-impact `official_events` and `situations`.

Geography:

- Store only messages relevant to Nytt: county `Trøndelag` OR point inside a configurable Trondheim-region bounding box.
- Server still filters by visible map bounds using PostGIS/geometry helpers so the frontend receives only visible events.

## Acceptance criteria

1. Worker source-health includes `vegvesen_traffic_info` with counts for fetched/relevant/active/planned/expired/stale-expired messages.
2. Production DB has `traffic_map_events` rows after the worker runs; Trøndelag count is non-zero when Vegvesen has messages.
3. `GET /api/map/traffic-events` returns active/planned TrafficInfo events in visible Trondheim bounds, not zero when Vegvesen's own map shows local roadwork messages.
4. Existing DATEX/SRTI official situation behavior still passes tests and does not spam `situations` with low-impact roadworks.
5. Frontend popup no longer hardcodes `DATEX`; it shows `Statens vegvesen`, source freshness, state, category, severity, validity and source link.
6. Sidebar shows a useful brief, count-by-category/severity, visible event list, presets, and a clear empty/stale state.
7. Full gate passes: `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`.
8. Deployment is not reported complete until GitHub Actions and deployment for the pushed SHA complete successfully and live DB/source-health/API checks verify real traffic events.

---

## Phase 1: Shared contracts and persistence

### Task 1: Add TrafficInfo source IDs to shared types

**Objective:** Allow the API, source health and source-item ledger to represent Vegvesen TrafficInfo without pretending it is DATEX/SRTI.

**Files:**

- Modify: `packages/shared/src/types.ts:3-15`
- Modify: `packages/shared/src/schemas.ts:38-51`
- Modify: `packages/shared/src/traffic-map.ts:23-25`
- Test: compile-time via `npm run typecheck`

**Step 1: Write the failing compile-time expectation**

Add this temporary compile-time guard near the existing type guards in `apps/worker/test/source-items.test.ts` or a new small `apps/worker/test/traffic-info-types.test.ts`:

```ts
import type { SourceHealth, SourceItemInput, TrafficMapEvent } from "@nytt/shared";

const _trafficInfoHealth = {
  source: "vegvesen_traffic_info",
  label: "Vegvesen trafikkmeldinger",
  state: "ok",
  detail: "1 trafikkmelding hentet",
} satisfies SourceHealth;

const _trafficInfoSourceItem = {
  id: "source:test",
  provider: "vegvesen_traffic_info",
  kind: "official_event",
  externalId: "NPRA_HBT_1",
  title: "Fv. 6650 Vestre Kystad",
  fetchedAt: "2026-05-29T11:00:00.000Z",
  captureHash: "abc",
  rawPayload: {},
  normalizedPayload: {},
  reliabilityTier: "official",
} satisfies SourceItemInput;

const _trafficInfoMapEvent = {
  id: "vegvesen-traffic-info:NPRA_HBT_1",
  source: "vegvesen_traffic_info",
  sourceEventId: "NPRA_HBT_1",
  category: "roadworks",
  severity: "medium",
  state: "active",
  title: "Fv. 6650 Vestre Kystad",
  updatedAt: "2026-05-29T11:00:00.000Z",
  geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
} satisfies TrafficMapEvent;

void _trafficInfoHealth;
void _trafficInfoSourceItem;
void _trafficInfoMapEvent;
```

**Step 2: Run the type test to verify failure**

The worker package's normal `tsconfig.json` only includes `src/**/*.ts`, so use Vitest to compile this test file:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/traffic-info-types.test.ts
```

Expected: FAIL because `vegvesen_traffic_info` is not in `SourceId` and `TrafficMapEvent.source` only accepts `datex`.

**Step 3: Update shared source unions**

In `packages/shared/src/types.ts`, add the source:

```ts
export type SourceId =
  | "nrk"
  | "adressa"
  | "vg"
  | "dagbladet"
  | "trondheim_kommune"
  | "met"
  | "nve"
  | "datex"
  | "datex_travel_time"
  | "vegvesen_traffic_info"
  | "dsb"
  | "politiloggen"
  | "deepseek";
```

In `packages/shared/src/schemas.ts`, add it to `sourceIdSchema` immediately after `datex_travel_time`.

In `packages/shared/src/traffic-map.ts`, change:

```ts
source: "datex";
```

to:

```ts
source: "datex" | "vegvesen_traffic_info";
```

**Step 4: Run typecheck to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/traffic-info-types.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: both PASS for the new source type.

**Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/src/traffic-map.ts apps/worker/test/traffic-info-types.test.ts
git commit -m "feat: add Vegvesen TrafficInfo shared source types"
```

### Task 2: Add the traffic_map_events table

**Objective:** Create a dedicated PostGIS-backed table for map-ready traffic overlays so the map does not depend on DATEX/SRTI official situation rows.

**Files:**

- Modify: `apps/server/src/db/schema.sql`
- Test: `npm run db:migrate` locally if a dev database is configured; otherwise covered by repository tests in later tasks.

**Step 1: Add schema block after `datex_travel_times`**

Add:

```sql
CREATE TABLE IF NOT EXISTS traffic_map_events (
  id text PRIMARY KEY,
  source text NOT NULL,
  source_event_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('roadworks', 'accident', 'closure', 'congestion', 'weather', 'restriction', 'obstruction', 'other')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  state text NOT NULL CHECK (state IN ('planned', 'active', 'expired', 'cancelled')),
  title text NOT NULL,
  description text,
  location_name text,
  road_name text,
  valid_from timestamptz,
  valid_to timestamptz,
  updated_at timestamptz NOT NULL,
  source_url text,
  geometry geometry(Geometry, 4326) NOT NULL,
  raw_type text,
  confidence real,
  payload jsonb NOT NULL,
  source_payload_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS traffic_map_events_source_state_idx
  ON traffic_map_events (source, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS traffic_map_events_validity_idx
  ON traffic_map_events (valid_from, valid_to);
CREATE INDEX IF NOT EXISTS traffic_map_events_geometry_idx
  ON traffic_map_events USING gist (geometry);
```

Do not add a hard CHECK on `source`; `SourceId` is already type-checked, and leaving DB source flexible avoids destructive migrations if another map-only traffic source is added later.

**Step 2: Add schema migration marker**

At the bottom of `schema.sql`, add:

```sql
INSERT INTO schema_migrations (version) VALUES ('004_traffic_map_events') ON CONFLICT DO NOTHING;
```

**Step 3: Verify schema text and compile gates**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: PASS. This does not parse SQL; Task 25 includes a production migration/DB verification, and Task 3/4 repository tests verify the SQL strings issued by the repository mock pool. If a local PostGIS dev DB is configured, also run `npm run db:migrate`.

**Step 4: Commit**

```bash
git add apps/server/src/db/schema.sql
git commit -m "feat: add traffic map events table"
```

### Task 3: Add repository tests for traffic_map_events lifecycle

**Objective:** Prove first insert, update, snapshot disappearance and failed-snapshot non-expiry behavior before implementing repository methods.

**Files:**

- Modify: `apps/worker/test/repository.test.ts`
- Modify later: `apps/worker/src/repository.ts`

**Step 1: Add failing tests**

`apps/worker/test/repository.test.ts` currently uses a mocked `pg.Pool`/`query` pattern rather than a real PostGIS database. Follow the existing mock helper style: assert the repository issues the expected `INSERT INTO traffic_map_events`, `SELECT payload, state FROM traffic_map_events`, and `UPDATE traffic_map_events` calls with the right parameters.

Required behavior examples:

```ts
const event = {
  id: "vegvesen-traffic-info:NPRA_HBT_1",
  source: "vegvesen_traffic_info",
  sourceEventId: "NPRA_HBT_1",
  category: "roadworks",
  severity: "medium",
  state: "active",
  title: "Fv. 6650 Vestre Kystad",
  description: "Lysregulering.",
  locationName: "Fv. 6650 Vestre Kystad, Trondheim",
  roadName: "Fv. 6650",
  validFrom: "2026-04-21T05:00:00.000Z",
  validTo: "2026-06-26T14:00:00.000Z",
  updatedAt: "2026-05-07T04:59:25.000Z",
  sourceUrl: "https://www.vegvesen.no/trafikk/hvaskjer?lat=63.38945&lng=10.345405&zoom=14",
  geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
  rawType: "roadworks",
} satisfies TrafficMapEvent;

await repository.upsertTrafficMapEvents([event], {
  source: "vegvesen_traffic_info",
  fetchedAt: "2026-05-29T11:00:00.000Z",
});

await repository.upsertTrafficMapEvents([{ ...event, title: "Oppdatert tittel" }], {
  source: "vegvesen_traffic_info",
  fetchedAt: "2026-05-29T11:10:00.000Z",
});

const rows = await repository.listTrafficMapEvents({ source: "vegvesen_traffic_info" });
expect(rows).toHaveLength(1);
expect(rows[0]).toMatchObject({ title: "Oppdatert tittel", state: "active" });
```

Add a second test:

```ts
await repository.markMissingTrafficMapEventsExpired(
  "vegvesen_traffic_info",
  [],
  "2026-05-29T11:20:00.000Z",
);
const rows = await repository.listTrafficMapEvents({ source: "vegvesen_traffic_info" });
expect(rows[0]?.state).toBe("expired");
```

Add additional lifecycle tests:

- Duplicate unchanged snapshot: second upsert updates `last_seen_at` but still leaves one row.
- Missing/partial ID and malformed/missing geometry are skipped by the parser before repository upsert.
- Reappearing event: an expired row becomes active again when upserted from a later successful snapshot.
- Failed snapshot non-expiry: simply do not call `markMissingTrafficMapEventsExpired` after an insert and assert no expiry update query is issued.
- Open-ended stale policy: `expireStaleOpenEndedTrafficMapEvents("vegvesen_traffic_info", now, 7 * 24)` expires open-ended active/planned rows whose `last_seen_at` is older than 7 days.

**Step 2: Run tests to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because repository methods do not exist.

**Step 3: Commit only if tests are intentionally red?**

Do not commit red tests separately in this repo unless the controller explicitly wants TDD history. Continue to Task 4, then commit tests and implementation together.

### Task 4: Implement traffic_map_events repository methods

**Objective:** Make the lifecycle tests pass with idempotent upsert/list/expire operations.

**Files:**

- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/repository.test.ts`

**Step 1: Add public methods to `WorkerRepository`**

Add near the TravelTime methods:

```ts
import type { TrafficMapEvent } from "@nytt/shared";

export interface TrafficMapEventUpsertOptions {
  source: TrafficMapEvent["source"];
  fetchedAt: string;
}

export interface TrafficMapEventListFilters {
  source?: TrafficMapEvent["source"];
  states?: TrafficMapEvent["state"][];
}
```

Implementation shape:

```ts
async upsertTrafficMapEvents(
  events: TrafficMapEvent[],
  options: TrafficMapEventUpsertOptions,
): Promise<void> {
  for (const event of events) {
    const eventPayloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    await this.pool.query(
      `INSERT INTO traffic_map_events
       (id, source, source_event_id, category, severity, state, title, description,
        location_name, road_name, valid_from, valid_to, updated_at, source_url,
        geometry, raw_type, confidence, payload, source_payload_hash, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        ST_SetSRID(ST_GeomFromGeoJSON($15),4326),$16,$17,$18,$19,$20)
       ON CONFLICT (source, source_event_id) DO UPDATE SET
        id=EXCLUDED.id,
        category=EXCLUDED.category,
        severity=EXCLUDED.severity,
        state=EXCLUDED.state,
        title=EXCLUDED.title,
        description=EXCLUDED.description,
        location_name=EXCLUDED.location_name,
        road_name=EXCLUDED.road_name,
        valid_from=EXCLUDED.valid_from,
        valid_to=EXCLUDED.valid_to,
        updated_at=EXCLUDED.updated_at,
        source_url=EXCLUDED.source_url,
        geometry=EXCLUDED.geometry,
        raw_type=EXCLUDED.raw_type,
        confidence=EXCLUDED.confidence,
        payload=EXCLUDED.payload,
        source_payload_hash=EXCLUDED.source_payload_hash,
        last_seen_at=EXCLUDED.last_seen_at`,
      [
        event.id,
        event.source,
        event.sourceEventId,
        event.category,
        event.severity,
        event.state,
        event.title,
        event.description ?? null,
        event.locationName ?? null,
        event.roadName ?? null,
        event.validFrom ?? null,
        event.validTo ?? null,
        event.updatedAt,
        event.sourceUrl ?? null,
        JSON.stringify(event.geometry),
        event.rawType ?? null,
        event.confidence ?? null,
        event,
        eventPayloadHash,
        options.fetchedAt,
      ],
    );
  }
}
```

Add `listTrafficMapEvents` and `markMissingTrafficMapEventsExpired`:

```ts
async markMissingTrafficMapEventsExpired(
  source: TrafficMapEvent["source"],
  activeSourceEventIds: string[],
  fetchedAt: string,
): Promise<number> {
  const result = await this.pool.query(
    `UPDATE traffic_map_events
     SET state='expired',
         payload=jsonb_set(payload, '{state}', to_jsonb('expired'::text), true),
         last_seen_at=$3
     WHERE source=$1
     AND state IN ('active', 'planned')
     AND NOT (source_event_id = ANY($2::text[]))`,
    [source, activeSourceEventIds, fetchedAt],
  );
  return result.rowCount ?? 0;
}
```

Add the stale open-ended policy method:

```ts
async expireStaleOpenEndedTrafficMapEvents(
  source: TrafficMapEvent["source"],
  now: string,
  maxAgeHours: number,
): Promise<number> {
  const result = await this.pool.query(
    `UPDATE traffic_map_events
     SET state='expired',
         payload=jsonb_set(payload, '{state}', to_jsonb('expired'::text), true)
     WHERE source=$1
     AND state IN ('active', 'planned')
     AND valid_to IS NULL
     AND last_seen_at < ($2::timestamptz - ($3 * interval '1 hour'))`,
    [source, now, maxAgeHours],
  );
  return result.rowCount ?? 0;
}
```

`listTrafficMapEvents` should select `payload` and merge DB state back in case expiry changed payload:

```ts
const result = await this.pool.query<{ payload: TrafficMapEvent; state: TrafficMapEvent["state"] }>(...);
return result.rows.map((row) => ({ ...row.payload, state: row.state }));
```

**Step 2: Run targeted repository tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
```

Expected: PASS.

**Step 3: Run import-chain safety check**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && node -e "import('./apps/worker/dist/repository.js').then(() => console.log('repository import ok'))"
```

If `dist` is stale, first run `npm run build -w @nytt/worker`.

Expected: `repository import ok`.

**Step 4: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: persist traffic map events"
```

---

## Phase 2: Vegvesen TrafficInfo collector

### Task 5: Add a minimal TrafficInfo fixture

**Objective:** Capture representative real TrafficInfo messages without depending on live network in tests.

**Files:**

- Create: `apps/worker/test/fixtures/vegvesen-traffic-info-messages.json`
- Create later: `apps/worker/test/traffic-info.test.ts`

**Step 1: Create fixture**

Create a small JSON fixture with 3 messages:

1. Active Trondheim roadwork with point geometry.
2. Future Trondheim roadwork with point geometry.
3. Outside-Trøndelag message that should be filtered out.

Use this shape:

```json
{
  "metadata": {
    "overallDataStatus": "ok",
    "pagination": { "totalElements": 3, "matchedElements": 3 }
  },
  "trafficMessages": [
    {
      "dataFetchStatus": "ok",
      "publicationTime": "2026-05-29T13:12:04+02:00",
      "id": "NPRA_HBT_21-04-2026.66010",
      "icon": { "position": { "type": "Point", "coordinates": [10.345405, 63.38945] } },
      "locationDescriptionDetails": {
        "simpleLocationDescription": "Fv. 6650 Vestre Kystad - avkjøringsveg Kystad helse- og velferdssenter, Trondheim, Trøndelag"
      },
      "publicCommentDescription": "Lysregulering.",
      "activityStatus": "active",
      "trafficImpact": "small",
      "trafficStatus": { "description": "Lysregulering", "type": "Regulation" },
      "trafficEvent": { "trafficEventDescription": "Veiarbeid", "trafficEventType": "roadworks" },
      "trafficEventCategory": "roadworks",
      "startTime": "2026-04-21T07:00:00+02:00",
      "estimatedEndTime": "2026-06-26T16:00:00+02:00",
      "updatedTime": "2026-05-07T06:59:25+02:00",
      "location": { "counties": [{ "name": "Trøndelag", "code": 50 }], "roads": [{ "name": "", "number": "F6650", "category": "F" }] },
      "priorityScore": 500
    },
    {
      "dataFetchStatus": "ok",
      "publicationTime": "2026-05-29T13:12:04+02:00",
      "id": "NPRA_HBT_19-05-2026.80670",
      "icon": { "position": { "type": "Point", "coordinates": [10.318883, 63.383823] } },
      "locationDescriptionDetails": { "simpleLocationDescription": "Kv. 4295 Leirbrumyran, Trondheim, Trøndelag" },
      "activityStatus": "future",
      "trafficImpact": "none",
      "trafficStatus": { "description": "Åpen vei", "type": "RoadOpen" },
      "trafficEvent": { "trafficEventDescription": "Veiarbeid", "trafficEventType": "roadworks" },
      "trafficEventCategory": "roadworks",
      "startTime": "2026-06-01T07:00:00+02:00",
      "estimatedEndTime": "2026-06-05T15:00:00+02:00",
      "updatedTime": "2026-05-26T14:28:35+02:00",
      "location": { "counties": [{ "name": "Trøndelag", "code": 50 }], "roads": [{ "name": "", "number": "K4295", "category": "K" }] },
      "priorityScore": 100
    },
    {
      "dataFetchStatus": "ok",
      "publicationTime": "2026-05-29T13:12:04+02:00",
      "id": "NPRA_HBT_OSLO",
      "icon": { "position": { "type": "Point", "coordinates": [10.75, 59.91] } },
      "locationDescriptionDetails": { "simpleLocationDescription": "Ring 3, Oslo" },
      "activityStatus": "active",
      "trafficImpact": "large",
      "trafficEventCategory": "warning",
      "updatedTime": "2026-05-29T10:00:00+02:00",
      "location": { "counties": [{ "name": "Oslo", "code": 3 }], "roads": [{ "number": "R150", "category": "R" }] }
    }
  ]
}
```

**Step 2: Commit?**

Do not commit fixture alone unless needed. Continue to Task 6.

### Task 6: Write failing TrafficInfo parser tests

**Objective:** Define exact TrafficInfo normalization behavior before implementation.

**Files:**

- Create: `apps/worker/test/traffic-info.test.ts`
- Create later: `apps/worker/src/vegvesenTrafficInfo.ts`

**Step 1: Add parser tests**

Test requirements:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  defaultTrafficInfoEndpoint,
  parseTrafficInfoMessages,
  trafficInfoRequestHeaders,
} from "../src/vegvesenTrafficInfo.js";

const fixturePath = new URL("./fixtures/vegvesen-traffic-info-messages.json", import.meta.url);

describe("Vegvesen TrafficInfo", () => {
  it("uses the TrafficInfo API contract Vegvesen's map uses", () => {
    expect(defaultTrafficInfoEndpoint).toBe(
      "https://traffic-info.atlas.vegvesen.no/traffic-information/messages?sort=priorityScore&lang=no",
    );
    expect(trafficInfoRequestHeaders()).toMatchObject({
      accept: "application/vnd.svv.v2+json; charset=utf-8",
      "X-System-ID": "vvtraf",
    });
  });

  it("normalizes relevant Trondheim messages into traffic map events", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseTrafficInfoMessages(payload, {
      endpoint: defaultTrafficInfoEndpoint,
      receivedAt: "2026-05-29T11:15:00.000Z",
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      id: "vegvesen-traffic-info:NPRA_HBT_21-04-2026.66010",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_21-04-2026.66010",
      category: "roadworks",
      severity: "medium",
      state: "active",
      title: "Fv. 6650 Vestre Kystad - avkjøringsveg Kystad helse- og velferdssenter, Trondheim, Trøndelag",
      description: "Lysregulering.",
      roadName: "F6650",
      validFrom: "2026-04-21T05:00:00.000Z",
      validTo: "2026-06-26T14:00:00.000Z",
      updatedAt: "2026-05-07T04:59:25.000Z",
      geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
      rawType: "roadworks",
    });
    expect(result.events[1]?.state).toBe("planned");
    expect(result.sourcePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rawMessagesById.get("NPRA_HBT_21-04-2026.66010")).toMatchObject({
      id: "NPRA_HBT_21-04-2026.66010",
      trafficEventCategory: "roadworks",
    });
  });

  it("skips messages with missing IDs or malformed geometry and keeps outside-region messages out of Nytt's traffic map table", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseTrafficInfoMessages(payload, {
      endpoint: defaultTrafficInfoEndpoint,
      receivedAt: "2026-05-29T11:15:00.000Z",
    });
    expect(result.events.map((event) => event.sourceEventId)).not.toContain("NPRA_HBT_OSLO");
  });
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/traffic-info.test.ts
```

Expected: FAIL because `vegvesenTrafficInfo.ts` does not exist.

### Task 7: Implement TrafficInfo parser and collector

**Objective:** Convert the TrafficInfo JSON snapshot into `TrafficMapEvent[]` and expose a network collector.

**Files:**

- Create: `apps/worker/src/vegvesenTrafficInfo.ts`
- Modify: `apps/worker/test/traffic-info.test.ts`

**Step 1: Implement the module**

Create `apps/worker/src/vegvesenTrafficInfo.ts` with these exported functions:

```ts
import { createHash } from "node:crypto";
import type { Point } from "geojson";
import type { TrafficEventCategory, TrafficEventSeverity, TrafficEventState, TrafficMapEvent } from "@nytt/shared";

type TrafficInfoObject = Record<string, unknown>;

export const defaultTrafficInfoEndpoint =
  "https://traffic-info.atlas.vegvesen.no/traffic-information/messages?sort=priorityScore&lang=no";

export function trafficInfoRequestHeaders(): Record<string, string> {
  return {
    accept: "application/vnd.svv.v2+json; charset=utf-8",
    "X-System-ID": "vvtraf",
    "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech",
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value: unknown): value is TrafficInfoObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function iso(value: unknown, fallback?: string): string | undefined {
  const input = text(value) ?? fallback;
  if (!input) return undefined;
  const time = Date.parse(input);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function pointGeometry(message: TrafficInfoObject): Point | undefined {
  const position = isObject(message.icon) && isObject(message.icon.position) ? message.icon.position : undefined;
  const coordinates = Array.isArray(position?.coordinates) ? position.coordinates : undefined;
  if (!coordinates || coordinates.length < 2) return undefined;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { type: "Point", coordinates: [lng, lat] };
}
```

Add mapping helpers:

```ts
function stateFromActivityStatus(status: unknown): TrafficEventState {
  switch (text(status)?.toLowerCase()) {
    case "future":
      return "planned";
    case "inactive":
      return "expired";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "active":
    default:
      return "active";
  }
}

function categoryFromMessage(message: TrafficInfoObject): TrafficEventCategory {
  const trafficEvent = isObject(message.trafficEvent) ? message.trafficEvent : {};
  const status = isObject(message.trafficStatus) ? message.trafficStatus : {};
  const haystack = [
    message.trafficEventCategory,
    trafficEvent.trafficEventType,
    trafficEvent.trafficEventDescription,
    status.type,
    status.description,
    message.publicCommentDescription,
  ]
    .map((part) => text(part) ?? "")
    .join(" ")
    .toLocaleLowerCase("nb");

  if (/roadworks|veiarbeid|vegarbeid|mobileRoadworks/i.test(haystack)) return "roadworks";
  if (/accident|ulykke|collision|kollisjon/i.test(haystack)) return "accident";
  if (/closed|closure|stengt|roadclosed/i.test(haystack)) return "closure";
  if (/congestion|queue|kø|forsinkelse/i.test(haystack)) return "congestion";
  if (/weather|vær|føre|glatt|snø|is/i.test(haystack)) return "weather";
  if (/restriction|weight|height|width|restriksjon|begrensning/i.test(haystack)) return "restriction";
  if (/obstruction|hindring|debris|dyr|animal/i.test(haystack)) return "obstruction";
  return "other";
}

function severityFromMessage(message: TrafficInfoObject, category: TrafficEventCategory): TrafficEventSeverity {
  const status = isObject(message.trafficStatus) ? message.trafficStatus : {};
  const impact = text(message.trafficImpact)?.toLowerCase();
  const statusType = text(status.type)?.toLowerCase() ?? "";
  if (impact === "very_large") return "critical";
  if (impact === "large" || statusType.includes("roadclosed") || category === "accident") return "high";
  if (impact === "small" || category === "roadworks" || category === "congestion") return "medium";
  return "low";
}
```

Add relevance helpers:

```ts
const trondheimRegion = { south: 62.9, north: 63.75, west: 9.6, east: 11.3 };

function isTrondelagMessage(message: TrafficInfoObject): boolean {
  const location = isObject(message.location) ? message.location : {};
  const counties = Array.isArray(location.counties) ? location.counties : [];
  return counties.some((county) => isObject(county) && /trøndelag|trondelag/i.test(text(county.name) ?? ""));
}

function pointInTrondheimRegion(geometry: Point | undefined): boolean {
  if (!geometry || geometry.type !== "Point") return false;
  const lng = geometry.coordinates[0];
  const lat = geometry.coordinates[1];
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return lat >= trondheimRegion.south && lat <= trondheimRegion.north && lng >= trondheimRegion.west && lng <= trondheimRegion.east;
}
```

Add parser:

```ts
export interface TrafficInfoParseOptions {
  endpoint: string;
  receivedAt: string;
}

export interface TrafficInfoParseResult {
  events: TrafficMapEvent[];
  rawMessagesById: Map<string, TrafficInfoObject>;
  sourcePayloadHash: string;
  totalMessages: number;
  relevantMessages: number;
}

export function parseTrafficInfoMessages(rawJson: string, options: TrafficInfoParseOptions): TrafficInfoParseResult {
  const parsed = JSON.parse(rawJson) as unknown;
  if (!isObject(parsed) || !Array.isArray(parsed.trafficMessages)) {
    throw new Error("TrafficInfo payload mangler trafficMessages[]");
  }

  const events: TrafficMapEvent[] = [];
  const rawMessagesById = new Map<string, TrafficInfoObject>();
  for (const message of parsed.trafficMessages) {
    if (!isObject(message)) continue;
    const sourceEventId = text(message.id);
    const geometry = pointGeometry(message);
    if (!sourceEventId || !geometry) continue;
    if (!isTrondelagMessage(message) && !pointInTrondheimRegion(geometry)) continue;

    const location = isObject(message.location) ? message.location : {};
    const roads = Array.isArray(location.roads) ? location.roads.filter(isObject) : [];
    const roadName = roads
      .map((road) => text(road.number) ?? text(road.name))
      .find(Boolean);
    const details = isObject(message.locationDescriptionDetails) ? message.locationDescriptionDetails : {};
    const category = categoryFromMessage(message);
    const severity = severityFromMessage(message, category);
    const [lng, lat] = geometry.coordinates as [number, number];

    rawMessagesById.set(sourceEventId, message);
    events.push({
      id: `vegvesen-traffic-info:${sourceEventId}`,
      source: "vegvesen_traffic_info",
      sourceEventId,
      category,
      severity,
      state: stateFromActivityStatus(message.activityStatus),
      title: text(details.simpleLocationDescription) ?? text(message.publicCommentDescription) ?? "Trafikkmelding",
      description: text(message.publicCommentDescription),
      locationName: text(details.simpleLocationDescription),
      roadName,
      validFrom: iso(message.startTime),
      validTo: iso(message.estimatedEndTime),
      updatedAt: iso(message.updatedTime, iso(message.publicationTime, options.receivedAt)) ?? options.receivedAt,
      sourceUrl: `https://www.vegvesen.no/trafikk/hvaskjer?lat=${lat}&lng=${lng}&zoom=14`,
      geometry,
      rawType: text(message.trafficEventCategory),
      confidence: 1,
    });
  }

  return {
    events,
    rawMessagesById,
    sourcePayloadHash: sha256(rawJson),
    totalMessages: parsed.trafficMessages.length,
    relevantMessages: events.length,
  };
}
```

Add collector:

```ts
export interface TrafficInfoCollectOptions {
  endpoint: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export async function collectTrafficInfoMessages({
  endpoint,
  fetcher = fetch,
  now = () => new Date(),
}: TrafficInfoCollectOptions): Promise<TrafficInfoParseResult> {
  const response = await fetcher(endpoint, { headers: trafficInfoRequestHeaders() });
  if (!response.ok) throw new Error(`TrafficInfo returned HTTP ${response.status}`);
  return parseTrafficInfoMessages(await response.text(), {
    endpoint,
    receivedAt: now().toISOString(),
  });
}
```

**Step 2: Run targeted tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/traffic-info.test.ts
```

Expected: PASS.

**Step 3: Run import-chain safety check**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run build -w @nytt/worker && node -e "import('./apps/worker/dist/vegvesenTrafficInfo.js').then(() => console.log('traffic info import ok'))"
```

Expected: `traffic info import ok`.

**Step 4: Commit**

```bash
git add apps/worker/src/vegvesenTrafficInfo.ts apps/worker/test/traffic-info.test.ts apps/worker/test/fixtures/vegvesen-traffic-info-messages.json
git commit -m "feat: normalize Vegvesen TrafficInfo messages"
```

### Task 8: Add TrafficInfo source-item mirror tests

**Objective:** Prove TrafficInfo messages are ledger-worthy official evidence records, while still not promoted to `situations`.

**Files:**

- Modify: `apps/worker/test/traffic-info.test.ts`
- Modify later: `apps/worker/src/vegvesenTrafficInfo.ts`

**Step 1: Add failing source-item conversion test**

Add:

```ts
import { trafficInfoSourceItemInput } from "../src/vegvesenTrafficInfo.js";

it("mirrors TrafficInfo map events into official source items", async () => {
  const payload = await readFile(fixturePath, "utf8");
  const result = parseTrafficInfoMessages(payload, {
    endpoint: defaultTrafficInfoEndpoint,
    receivedAt: "2026-05-29T11:15:00.000Z",
  });

  const item = trafficInfoSourceItemInput(result.events[0]!, {
    fetchedAt: "2026-05-29T11:15:00.000Z",
    rawMessage: { id: "NPRA_HBT_21-04-2026.66010" },
  });

  expect(item).toMatchObject({
    provider: "vegvesen_traffic_info",
    kind: "official_event",
    externalId: "NPRA_HBT_21-04-2026.66010",
    title: "Fv. 6650 Vestre Kystad - avkjøringsveg Kystad helse- og velferdssenter, Trondheim, Trøndelag",
    reliabilityTier: "official",
    geoHint: { type: "Point", coordinates: [10.345405, 63.38945] },
  });
  expect(item.rawPayload).toEqual({ id: "NPRA_HBT_21-04-2026.66010" });
  expect(item.normalizedPayload).toMatchObject({ state: "active", category: "roadworks" });
});
```

**Step 3: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/traffic-info.test.ts
```

Expected: FAIL because `trafficInfoSourceItemInput` is missing.

### Task 9: Implement TrafficInfo source-item conversion and repository bulk upsert

**Objective:** Mirror map events into source_items so editors can trace official provenance without promoting them to incidents.

**Files:**

- Modify: `apps/worker/src/vegvesenTrafficInfo.ts`
- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/source-items.test.ts`
- Modify: `apps/worker/test/traffic-info.test.ts`

**Step 1: Export source-item converter**

In `vegvesenTrafficInfo.ts`:

```ts
import type { SourceItemInput } from "@nytt/shared";

export function trafficInfoSourceItemInput(
  event: TrafficMapEvent,
  options: { fetchedAt: string; rawMessage: unknown },
): SourceItemInput {
  const captureHash = sha256(JSON.stringify([event.source, event.sourceEventId, event.updatedAt, event.state, event.validTo]));
  return {
    id: `source:${sha256(JSON.stringify([event.source, "official_event", event.sourceEventId]))}`,
    provider: "vegvesen_traffic_info",
    kind: "official_event",
    externalId: event.sourceEventId,
    originalUrl: event.sourceUrl,
    title: event.title,
    summary: event.description,
    publishedAt: event.updatedAt,
    fetchedAt: options.fetchedAt,
    rawPayload: options.rawMessage,
    normalizedPayload: event,
    captureHash,
    geoHint: event.geometry,
    reliabilityTier: "official",
  };
}
```

**Step 2: Add repository bulk upsert method**

`upsertSourceItem` is private. Add a narrow public method rather than making everything public:

```ts
async upsertTrafficInfoSourceItems(items: SourceItemInput[]): Promise<void> {
  for (const item of items) {
    if (item.provider !== "vegvesen_traffic_info" || item.kind !== "official_event") {
      throw new Error("upsertTrafficInfoSourceItems only accepts Vegvesen TrafficInfo official_event items");
    }
    await this.upsertSourceItem(item);
  }
}
```

**Step 3: Add negative non-promotion test**

In `apps/worker/test/source-items.test.ts` or `apps/worker/test/index.test.ts`, assert TrafficInfo source items are not `official_events` rows and do not create situations by themselves. If full worker integration is too heavy, use repository-level assertion:

```ts
await repository.upsertTrafficInfoSourceItems([trafficInfoItem]);
expect(await repository.currentOfficialEvents()).toEqual([]);
```

**Step 4: Run targeted tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/traffic-info.test.ts apps/worker/test/source-items.test.ts apps/worker/test/repository.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/vegvesenTrafficInfo.ts apps/worker/src/repository.ts apps/worker/test/traffic-info.test.ts apps/worker/test/source-items.test.ts apps/worker/test/repository.test.ts
git commit -m "feat: mirror TrafficInfo events into source items"
```

### Task 10: Wire TrafficInfo collection into the worker

**Objective:** Make the scheduled worker collect TrafficInfo messages, persist map rows, mirror source items and update source health.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/test/index.test.ts`

**Step 1: Add a testable TrafficInfo collection seam**

Before writing the orchestration test, plan to export a focused helper from `apps/worker/src/index.ts`:

```ts
export async function collectTrafficInfoForMap(options: {
  repository: WorkerRepository;
  endpoint: string;
  nextPollAt: string;
  now?: () => Date;
  collector?: typeof collectTrafficInfoMessages;
}): Promise<void> {
  // implementation added in Step 4
}
```

`collectAll` should call this helper. Tests should target `collectTrafficInfoForMap` directly with a fake repository and fake collector, avoiding a brittle full `collectAll` integration test.

**Step 2: Add failing worker orchestration test**

In `apps/worker/test/index.test.ts`, add tests for `collectTrafficInfoForMap`. Required expectations:

- `repository.upsertTrafficMapEvents` called with relevant events.
- `repository.upsertTrafficInfoSourceItems` called with matching source items.
- `repository.markMissingTrafficMapEventsExpired` called only after successful collection.
- `repository.setHealth` called for `vegvesen_traffic_info` with `state: "ok"` and detail containing total/relevant/active/planned/snapshot-expired/stale-expired counts.
- On collector error, health becomes `degraded` and expiry is not called.

**Step 3: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/index.test.ts
```

Expected: FAIL because worker does not collect TrafficInfo yet.

**Step 4: Modify `apps/worker/src/index.ts`**

Add imports:

```ts
import {
  collectTrafficInfoMessages,
  defaultTrafficInfoEndpoint,
  trafficInfoSourceItemInput,
} from "./vegvesenTrafficInfo.js";
```

Implement `collectTrafficInfoForMap` with the helper seam, then call it from `collectAll` after RSS/geocoding and before DATEX/SRTI:

```ts
export async function collectTrafficInfoForMap({
  repository,
  endpoint,
  nextPollAt,
  now = () => new Date(),
  collector = collectTrafficInfoMessages,
}: {
  repository: WorkerRepository;
  endpoint: string;
  nextPollAt: string;
  now?: () => Date;
  collector?: typeof collectTrafficInfoMessages;
}): Promise<void> {
  try {
    const checkedAt = now().toISOString();
    const fetchedAt = checkedAt;
    const result = await collector({ endpoint, now });
    await repository.upsertTrafficMapEvents(result.events, {
      source: "vegvesen_traffic_info",
      fetchedAt,
    });
    await repository.upsertTrafficInfoSourceItems(
      result.events.map((event) =>
        trafficInfoSourceItemInput(event, {
          fetchedAt,
          rawMessage: result.rawMessagesById.get(event.sourceEventId) ?? event,
        }),
      ),
    );
    const expiredCount = await repository.markMissingTrafficMapEventsExpired(
      "vegvesen_traffic_info",
      result.events.map((event) => event.sourceEventId),
      fetchedAt,
    );
    const staleExpiredCount = await repository.expireStaleOpenEndedTrafficMapEvents(
      "vegvesen_traffic_info",
      fetchedAt,
      7 * 24,
    );
    await repository.setCollectorState("vegvesen_traffic_info:lastHash", result.sourcePayloadHash);
    await repository.setHealth({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${result.relevantMessages} relevante av ${result.totalMessages} Vegvesen trafikkmeldinger hentet (${result.events.filter((event) => event.state === "active").length} aktive, ${result.events.filter((event) => event.state === "planned").length} planlagte, ${expiredCount} utløpt fra snapshot, ${staleExpiredCount} stale utløpt)`,
    });
  } catch (error) {
    await repository.setHealth({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "degraded",
      lastCheckedAt: now().toISOString(),
      lastFailureAt: now().toISOString(),
      nextPollAt,
      detail: `TrafficInfo-innhenting feilet: ${String(error)}`,
    });
  }
}
```

Then in `collectAll` call:

```ts
await collectTrafficInfoForMap({
  repository,
  endpoint: process.env.TRAFFIC_INFO_ENDPOINT?.trim() || defaultTrafficInfoEndpoint,
  nextPollAt,
});
```

**Step 5: Run tests and import check**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/index.test.ts apps/worker/test/traffic-info.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run build -w @nytt/worker
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/test/index.test.ts apps/worker/src/vegvesenTrafficInfo.ts
git commit -m "feat: collect Vegvesen TrafficInfo for traffic map"
```

---

## Phase 3: DATEX/SRTI correctness patch

### Task 11: Add coordinatesForDisplay DATEX regression test

**Objective:** Ensure existing DATEX/SRTI parser does not drop valid Trøndelag records when coordinates are published under `coordinatesForDisplay`.

**Files:**

- Modify: `apps/worker/test/datex.test.ts`
- Modify later: `apps/worker/src/datex.ts`

**Step 1: Add failing test**

Add:

```ts
it("reads DATEX coordinatesForDisplay points used by SRTI payloads", () => {
  const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-29T10:00:00Z</publicationTime><situation id="NO-SVV-COORDS" version="1"><situationRecord xsi:type="EnvironmentalObstruction" id="R1" version="1"><situationRecordVersionTime>2026-05-29T10:00:00Z</situationRecordVersionTime><severity>low</severity><validity><validityStatus>active</validityStatus></validity><groupOfLocations><locationContainedInGroup xsi:type="PointLocation"><coordinatesForDisplay><latitude>63.279343</latitude><longitude>9.641987</longitude></coordinatesForDisplay><supplementaryPositionalDescription><locationDescription><values><value lang="no">Kv. 1810 Gangåsen i Orkland, Trøndelag</value></values></locationDescription><roadInformation><roadName>Gangåsvegen</roadName><roadNumber>K1810</roadNumber></roadInformation></supplementaryPositionalDescription></locationContainedInGroup></groupOfLocations><generalPublicComment><comment><values><value>Hindring i vegbanen.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;

  const result = parseDatexSituationPublication(xml, {
    endpoint: "https://datex.example.test",
    receivedAt: "2026-05-29T10:05:00.000Z",
  });

  expect(result.events).toHaveLength(1);
  expect(result.events[0]?.geometry).toEqual({ type: "Point", coordinates: [9.641987, 63.279343] });
  expect(result.events[0]?.areaLabel).toBe("Gangåsvegen");
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: FAIL because `pointGeometry` only checks `locationForDisplay`.

### Task 12: Patch DATEX geometry extraction

**Objective:** Support both DATEX coordinate styles without changing DATEX promotion rules.

**Files:**

- Modify: `apps/worker/src/datex.ts`
- Modify: `apps/worker/test/datex.test.ts`

**Step 1: Implement coordinate helper**

Replace `pointGeometry` internals with a helper:

```ts
function pointFromLatLngObject(value: unknown): Geometry | undefined {
  if (!isObject(value)) return undefined;
  const latitude = Number(datexText(value.latitude));
  const longitude = Number(datexText(value.longitude));
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { type: "Point", coordinates: [longitude, latitude] };
  }
  return undefined;
}

function pointGeometry(record: DatexObject): Geometry | undefined {
  for (const object of findDatexObjectsWithKey(record, "locationForDisplay")) {
    const point = pointFromLatLngObject(object.locationForDisplay);
    if (point) return point;
  }
  for (const object of findDatexObjectsWithKey(record, "coordinatesForDisplay")) {
    const point = pointFromLatLngObject(object.coordinatesForDisplay);
    if (point) return point;
  }
  return undefined;
}
```

Do not change `defaultDatexSituationEndpoint`; it must stay SRTI-filtered.

**Step 2: Run targeted tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/test/datex.test.ts
git commit -m "fix: parse DATEX coordinatesForDisplay geometry"
```

---

## Phase 4: Server API reads real map events

### Task 13: Add Store interface and PgStore tests for traffic map event reads

**Objective:** Make the server route able to read `traffic_map_events` directly, with bounds/state/time filters.

**Files:**

- Modify: `apps/server/src/store.ts`
- Modify: `apps/server/test/api.test.ts` or create `apps/server/test/traffic-map-api.test.ts`

**Step 1: Add failing API/store test**

Create a test that seeds one `traffic_map_events` row inside Trondheim and one outside bounds, then calls the map API through the existing authenticated supertest helper.

Expected request:

```ts
await request(app)
  .get("/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2&states=active,planned")
  .set(authHeaders)
  .expect(200)
  .expect((res) => {
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({ source: "vegvesen_traffic_info", sourceEventId: "NPRA_HBT_1" });
  });
```

If the existing test harness does not expose direct DB seeding, test `PgStore.listTrafficMapEvents` directly.

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts
```

Expected: FAIL because `Store` has no `listTrafficMapEvents` method and route does not read the table.

### Task 14: Implement `listTrafficMapEvents` in server stores

**Objective:** Expose the dedicated traffic map table through the server store abstraction.

**Files:**

- Modify: `apps/server/src/store.ts`
- Modify: `apps/server/test/api.test.ts`

**Step 1: Add Store method signature**

```ts
export interface TrafficMapEventFilters {
  sources?: TrafficMapEvent["source"][];
  states?: TrafficMapEvent["state"][];
  from?: string;
  to?: string;
  bounds?: { north: number; south: number; east: number; west: number };
}

export interface Store {
  // existing methods
  listTrafficMapEvents(filters: TrafficMapEventFilters, login: string): Promise<TrafficMapEvent[]>;
}
```

**Step 2: Implement `MemoryStore`**

Return an empty array for now unless sample data is present:

```ts
async listTrafficMapEvents(): Promise<TrafficMapEvent[]> {
  return [];
}
```

**Step 3: Implement `PgStore`**

Use SQL filters, especially PostGIS bounds:

```ts
async listTrafficMapEvents(filters: TrafficMapEventFilters): Promise<TrafficMapEvent[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.sources?.length) {
    params.push(filters.sources);
    where.push(`source = ANY($${params.length}::text[])`);
  }
  if (filters.states?.length) {
    params.push(filters.states);
    where.push(`state = ANY($${params.length}::text[])`);
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`COALESCE(valid_to, updated_at) >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`COALESCE(valid_from, updated_at) <= $${params.length}`);
  }
  if (filters.bounds) {
    params.push(filters.bounds.west, filters.bounds.south, filters.bounds.east, filters.bounds.north);
    const west = params.length - 3;
    const south = params.length - 2;
    const east = params.length - 1;
    const north = params.length;
    where.push(`geometry && ST_MakeEnvelope($${west}, $${south}, $${east}, $${north}, 4326)`);
  }
  const result = await this.pool.query<{ payload: TrafficMapEvent; state: TrafficMapEvent["state"] }>(
    `SELECT payload, state FROM traffic_map_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 1000`,
    params,
  );
  return result.rows.map((row) => ({ ...row.payload, state: row.state }));
}
```

**Step 4: Run targeted tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts
```

Expected: Store tests pass if route is not yet wired; route test may still fail until Task 15.

### Task 15: Wire `/api/map/traffic-events` to dedicated map rows

**Objective:** Return TrafficInfo map events from the API while preserving existing DATEX fallback and filtering semantics.

**Files:**

- Modify: `apps/server/src/app.ts:257-291`
- Modify: `apps/server/test/api.test.ts`

**Step 1: Update route data flow**

In `/api/map/traffic-events`:

1. Parse query as today.
2. Build `bounds` object if all four query coordinates are present.
3. Call `store.listTrafficMapEvents` with:
   - `sources: ["vegvesen_traffic_info"]`
   - `states`: query states or default active/planned
   - `from`, `to`, `bounds`
4. Keep existing DATEX official/source-item fallback for `datex` events until DATEX map events are also written to the table.
5. Deduplicate by `source + sourceEventId`, not just `sourceEventId`.

Sketch:

```ts
const requestedStates = query.states ?? ["active", "planned"];
const bounds =
  typeof query.north === "number" &&
  typeof query.south === "number" &&
  typeof query.east === "number" &&
  typeof query.west === "number"
    ? { north: query.north, south: query.south, east: query.east, west: query.west }
    : undefined;

const trafficInfoEvents = await store.listTrafficMapEvents(
  {
    sources: ["vegvesen_traffic_info"],
    states: requestedStates,
    from: query.from,
    to: query.to,
    bounds,
  },
  login,
);

const eventsBySourceKey = new Map<string, TrafficMapEvent>();
for (const event of trafficInfoEvents) {
  eventsBySourceKey.set(`${event.source}:${event.sourceEventId}`, event);
}
// Add existing DATEX fallback, then filterTrafficMapEvents([...], query)
```

**Step 2: Fix source item fallback**

Rename `listAllDatexSourceItems` to `listAllSourceItemsForProvider` only if needed. For now, leave DATEX-specific helper as-is and keep it for DATEX fallback only.

**Step 3: Run targeted API tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts
```

Expected: PASS and API returns `vegvesen_traffic_info` seeded event.

**Step 4: Commit**

```bash
git add apps/server/src/store.ts apps/server/src/app.ts apps/server/test/api.test.ts
git commit -m "feat: serve persisted traffic map events"
```

---

## Phase 5: Frontend map becomes useful, not just technically correct

### Task 16: Stop hardcoding DATEX in popups

**Objective:** Show the correct source label for TrafficInfo and DATEX events.

**Files:**

- Modify: `apps/frontend/src/components/map/TrafficLayer.tsx`
- Test: `apps/frontend/src/api.test.ts` or create a component test if the project already has React component test setup.

**Step 1: Add helper and update popup line**

Add:

```ts
function sourceLabel(source: TrafficMapEvent["source"]) {
  switch (source) {
    case "vegvesen_traffic_info":
      return "Statens vegvesen";
    case "datex":
    default:
      return "DATEX";
  }
}
```

Change:

```tsx
{categoryLabel(event.category)} · {severityLabel(event.severity)} · DATEX
```

to:

```tsx
{categoryLabel(event.category)} · {severityLabel(event.severity)} · {sourceLabel(event.source)}
```

**Step 2: Run frontend typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/frontend/src/components/map/TrafficLayer.tsx
git commit -m "fix: show traffic event source labels"
```

### Task 17: Add a visible event list beside the map

**Objective:** Let users scan events like Vegvesen's own list and click a list item to highlight the map event.

**Files:**

- Create: `apps/frontend/src/components/map/TrafficEventList.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css` or the existing CSS file containing traffic map styles

**Step 1: Create component**

```tsx
import type { TrafficMapEvent } from "@nytt/shared";

interface TrafficEventListProps {
  events: TrafficMapEvent[];
  selectedEventId?: string;
  onSelectEvent: (eventId: string) => void;
}

function formatEventTime(event: TrafficMapEvent) {
  const value = event.validFrom ?? event.updatedAt;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Ukjent tid";
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function TrafficEventList({ events, selectedEventId, onSelectEvent }: TrafficEventListProps) {
  return (
    <section className="traffic-event-list-card">
      <header>
        <h2>Hendelser i kartet</h2>
        <span>{events.length}</span>
      </header>
      {events.length === 0 ? <p>Ingen hendelser i valgt kartutsnitt og filter.</p> : null}
      <ol className="traffic-event-list">
        {events.slice(0, 80).map((event) => (
          <li key={event.id}>
            <button
              type="button"
              className={event.id === selectedEventId ? "selected" : undefined}
              onClick={() => onSelectEvent(event.id)}
            >
              <strong>{event.title}</strong>
              <span>{event.category} · {event.severity} · {event.state}</span>
              <small>{formatEventTime(event)}</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

**Step 2: Wire state in page**

Import the component:

```ts
import { TrafficEventList } from "../components/map/TrafficEventList.js";
```

In `TrafficMapPage.tsx`, replace `selectedCorridorId`-only highlighting with a combined highlighted event ID list:

```ts
const [selectedEventId, setSelectedEventId] = useState<string | undefined>();

const highlightedEventIds = useMemo(() => {
  const ids = new Set<string>();
  if (selectedEventId) ids.add(selectedEventId);
  if (selectedCorridorId) {
    for (const id of data?.corridorImpacts?.find((impact) => impact.id === selectedCorridorId)?.affectedEventIds ?? []) {
      ids.add(id);
    }
  }
  return [...ids];
}, [data?.corridorImpacts, selectedCorridorId, selectedEventId]);
```

Render after `TrafficBriefCard`:

```tsx
{data?.events ? (
  <TrafficEventList
    events={data.events}
    selectedEventId={selectedEventId}
    onSelectEvent={setSelectedEventId}
  />
) : null}
```

**Step 3: Add minimal CSS**

```css
.traffic-event-list-card {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 12px;
  padding: 1rem;
  background: var(--surface-color, #fff);
}

.traffic-event-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.5rem;
}

.traffic-event-list button {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 0.65rem;
  background: transparent;
}

.traffic-event-list button.selected,
.traffic-event-list button:hover {
  border-color: var(--accent-color, #2563eb);
  background: color-mix(in srgb, var(--accent-color, #2563eb) 8%, transparent);
}
```

**Step 4: Run frontend checks**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/frontend && npm run build -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/components/map/TrafficEventList.tsx apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/*.css
git commit -m "feat: add traffic event list sidebar"
```

### Task 18: Improve empty and stale states

**Objective:** Make zero events actionable instead of looking broken.

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/components/map/TrafficBriefCard.tsx`
- Modify: `apps/server/src/traffic/traffic-brief.ts`

**Step 1: Server brief text**

In `buildTrafficBrief`, distinguish no events from stale source:

```ts
headline:
  activeEvents.length === 0
    ? "Ingen trafikkhendelser i valgt kartutsnitt og filter. Prøv å zoome ut eller slå på planlagte veiarbeid."
    : `${activeEvents.length} trafikkhendelser i valgt kartutsnitt akkurat nå.`
```

**Step 2: Frontend brief card freshness**

In `TrafficBriefCard`, add:

```tsx
{brief.freshness === "stale" ? (
  <p role="status">Trafikkdata kan være eldre enn 30 minutter.</p>
) : null}
```

**Step 3: Page error/empty text**

Change fallback text from `Ingen trafikkdata lastet ennå` to separate loading/error/empty wording.

**Step 4: Run checks**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck && npm test -- apps/server/test/api.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/traffic/traffic-brief.ts apps/frontend/src/components/map/TrafficBriefCard.tsx apps/frontend/src/pages/TrafficMapPage.tsx
git commit -m "feat: clarify traffic map empty and stale states"
```

### Task 19: Add severity/category visual polish without inline colors

**Objective:** Make events quickly scannable while preserving theme consistency.

**Files:**

- Modify: `apps/frontend/src/components/map/TrafficLayer.tsx`
- Modify: existing traffic CSS file

**Step 1: Ensure class names cover source/category/severity/state**

In `TrafficLayer`, include category and source classes:

```ts
className: `traffic-event traffic-event-${event.source} traffic-event-${event.category} traffic-event-${event.severity} traffic-event-${event.state}${highlighted ? " traffic-event-highlighted" : ""}`,
```

**Step 2: Add CSS variables/classes**

```css
.traffic-event-low { stroke: var(--traffic-low, #64748b); fill: var(--traffic-low, #64748b); }
.traffic-event-medium { stroke: var(--traffic-medium, #d97706); fill: var(--traffic-medium, #d97706); }
.traffic-event-high { stroke: var(--traffic-high, #dc2626); fill: var(--traffic-high, #dc2626); }
.traffic-event-critical { stroke: var(--traffic-critical, #7f1d1d); fill: var(--traffic-critical, #7f1d1d); }
.traffic-event-planned { stroke-dasharray: 6 5; }
.traffic-event-highlighted { filter: drop-shadow(0 0 6px rgba(37, 99, 235, 0.7)); }
```

The fallback literals are contained in CSS custom properties only; if the app has design tokens, replace the fallback values with token references.

**Step 3: Run frontend build**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run build -w @nytt/frontend
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/frontend/src/components/map/TrafficLayer.tsx apps/frontend/src/*.css
git commit -m "style: improve traffic map event styling"
```

---

## Phase 6: Make intelligence useful

### Task 20: Make corridor impact segment-aware

**Objective:** Fix corridor matching so line/polygon events crossing a corridor are detected even when no vertex is near the corridor.

**Files:**

- Modify: `apps/server/src/traffic/corridor-impact.ts`
- Modify or create: `apps/server/test/traffic-geo.test.ts`

**Step 1: Add failing segment test**

Create a test where a `LineString` crosses a corridor between vertices, with both vertices outside the old point buffer, and assert it affects the corridor.

**Step 2: Implement segment-aware geometry helpers**

Use the audit reference pattern:

- Extract points for Point/MultiPoint.
- Extract segments for LineString/Polygon/MultiLineString/MultiPolygon/GeometryCollection.
- Use point-to-segment and segment-to-segment distance.
- Treat segment intersection as zero distance.

Do not add Turf.js unless implementation becomes too complex; a local haversine/equirectangular approximation is enough for Trondheim-scale buffers.

**Step 3: Run tests**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/traffic-geo.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server/src/traffic/corridor-impact.ts apps/server/test/traffic-geo.test.ts
git commit -m "fix: make corridor traffic impact segment-aware"
```

### Task 21: Improve related-news matching labels and thresholds

**Objective:** Make related articles helpful without false-positive spam.

**Files:**

- Modify: `apps/server/src/traffic/related-articles.ts`
- Modify or create: `apps/server/test/traffic-related-articles.test.ts`

**Step 1: Add tests**

Test:

- Article within 1000 m of a point event is related.
- Article 2500 m away is not related.
- Roadwork event with title `Ila` does not match unrelated article just because both mention Trondheim.
- LineString event near article via segment distance matches.

**Step 2: Implement improvements**

Use both distance and text hints:

```ts
const maxDistanceMeters = event.category === "roadworks" ? 750 : 1500;
```

Only include article if:

- distance threshold passes; and
- either article place/title shares a road/place token with event title/location OR event severity is high/critical.

**Step 3: Run tests**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/traffic-related-articles.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server/src/traffic/related-articles.ts apps/server/test/traffic-related-articles.test.ts
git commit -m "feat: improve traffic news matching"
```

### Task 22: Add source health to traffic map payload

**Objective:** Let the frontend explain whether zero events means no events, stale data, or source failure.

**Files:**

- Modify: `packages/shared/src/traffic-map.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/frontend/src/api/trafficMap.ts`
- Modify: `apps/frontend/src/components/map/TrafficBriefCard.tsx`

**Step 1: Extend shared payload**

```ts
export interface TrafficMapSourceStatus {
  source: "datex" | "datex_travel_time" | "vegvesen_traffic_info";
  label: string;
  state: "ok" | "degraded" | "disabled" | "awaiting_access";
  detail: string;
  lastCheckedAt?: string;
}

export interface TrafficMapPayload {
  events: TrafficMapEvent[];
  brief: TrafficBrief;
  corridorImpacts?: TrafficCorridorImpact[];
  sources?: TrafficMapSourceStatus[];
}
```

**Step 2: Server fills sources from `store.listSourceHealth()`**

Filter to `datex`, `datex_travel_time`, `vegvesen_traffic_info`.

**Step 3: Frontend prop wiring and degraded warning**

Update `TrafficBriefCardProps`:

```ts
import type { TrafficBrief, TrafficMapSourceStatus } from "@nytt/shared";

interface TrafficBriefCardProps {
  brief: TrafficBrief;
  sources?: TrafficMapSourceStatus[];
  loading?: boolean;
  error?: string;
  onReload?: () => void;
}
```

Pass `sources={data.sources}` from `TrafficMapPage.tsx`.

In `TrafficBriefCard`, if any source state is `degraded`, show a warning line with `detail`.

**Step 4: Run typecheck**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/traffic-map.ts apps/server/src/app.ts apps/frontend/src/api/trafficMap.ts apps/frontend/src/components/map/TrafficBriefCard.tsx
git commit -m "feat: expose traffic source health in map payload"
```

---

## Phase 7: Docs, operations and verification

### Task 23: Update source documentation

**Objective:** Document that TrafficInfo is the map overlay source and DATEX/SRTI remains high-signal incident source.

**Files:**

- Modify: `docs/SOURCES.md`
- Modify: `docs/ARCHITECTURE.md`

**Step 1: Update `docs/SOURCES.md`**

Add a bullet after DATEX/SRTI:

```md
- Statens vegvesen TrafficInfo `traffic-information/messages` is collected without exposing credentials and with `X-System-ID: vvtraf`. It powers the live traffic map overlay for roadworks, closures, restrictions and warnings around Trondheim/Trøndelag. TrafficInfo rows are stored in `traffic_map_events` and mirrored to `source_items` as official evidence, but ordinary roadworks do not create `official_events` or promote `situations`.
```

**Step 2: Update `docs/ARCHITECTURE.md`**

Add:

```md
Traffic map overlays are operational map state. `traffic_map_events` is the map-ready table; `source_items` is the provenance ledger; `situations` remains the incident feed. TrafficInfo roadworks can be shown richly on `/trafikk` without activating the Situation Room.
```

**Step 3: Commit**

```bash
git add docs/SOURCES.md docs/ARCHITECTURE.md
git commit -m "docs: document TrafficInfo traffic map source"
```

### Task 24: Run the full local quality gate

**Objective:** Prove the implementation is coherent before push.

**Files:** none.

**Step 1: Run full gate**

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
```

Expected: all commands PASS.

**Step 2: If format fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run format
source ~/.nvm/nvm.sh && nvm use 22 && npm run format:check
```

Commit formatting separately:

```bash
git add -A
git commit -m "style: format traffic map improvements"
```

### Task 25: Production verification runbook

**Objective:** Verify the live site with real data after deployment; never report success from CI alone.

**Files:** none, unless deployment docs need patching.

**Step 1: Push and watch CI**

```bash
git push origin main
gh run list --branch main --limit 5 --json databaseId,headSha,status,conclusion,name,createdAt
```

Watch the run for the pushed SHA until it shows `status=completed` and `conclusion=success`.

**Step 2: Watch deployment for the same SHA**

Use the repo's existing GitHub Actions names. Do not report deployed until deployment for the same SHA is completed success.

**Step 3: Verify live DB/source health on VPS**

```bash
ssh deploy@198.23.137.16 <<'REMOTE'
docker exec -i nytt-trondheim-postgres-1 sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -F " | " -At' <<'SQL'
SELECT source, state, detail, last_checked_at FROM source_health WHERE source IN ('vegvesen_traffic_info','datex','datex_travel_time') ORDER BY source;
SELECT source, state, count(*) FROM traffic_map_events GROUP BY source, state ORDER BY source, state;
SELECT provider, kind, count(*) FROM source_items WHERE provider='vegvesen_traffic_info' GROUP BY provider, kind;
SELECT count(*) FROM traffic_map_events WHERE source='vegvesen_traffic_info' AND state IN ('active','planned');
SELECT count(*) FROM official_events WHERE source='datex';
SELECT count(*) FROM situations WHERE payload->>'officialSource'='vegvesen_traffic_info';
SQL
REMOTE
```

Expected:

- `vegvesen_traffic_info | ok | ... relevante ...`
- `traffic_map_events` has non-zero `vegvesen_traffic_info` rows.
- `source_items` has non-zero `vegvesen_traffic_info | official_event` rows.
- Active/planned count is non-zero when Vegvesen's own map shows local events.
- `situations` count for `officialSource='vegvesen_traffic_info'` is 0; TrafficInfo roadworks did not promote incidents.

**Step 4: Verify live page shell and authenticated API behavior**

Anonymous curl should show page shell and API 401:

```bash
curl -sS -o /tmp/trafikk.html -w '%{http_code}\n' https://nytt.reidar.tech/trafikk
curl -sS -o /tmp/traffic-api.json -w '%{http_code}\n' 'https://nytt.reidar.tech/api/map/traffic-events?north=63.5&south=63.3&east=10.6&west=10.1'
```

Expected:

- `/trafikk` returns `200`.
- `/api/map/traffic-events` returns `401` without auth; this is not a zero-event result.

Then verify with an authenticated browser session or temporary server-side DB query. If using browser, open `/trafikk` and check Network response for `/api/map/traffic-events` includes `events.length > 0` around Trondheim.

**Step 5: Commit any docs/runbook corrections**

If production verification reveals a missing operational note, patch docs and commit:

```bash
git add docs/DEPLOYMENT.md docs/SOURCES.md docs/ARCHITECTURE.md
git commit -m "docs: clarify traffic map production verification"
```

---

## Non-goals for this plan

- Do not ingest full unfiltered DATEX Situation XML as the primary map source; it was previously large enough to risk worker memory pressure.
- Do not create `situations` from ordinary TrafficInfo roadworks.
- Do not add a new map library; keep Leaflet/react-leaflet.
- Do not expose DATEX credentials to the frontend.
- Do not add push alerts in this phase; first make the map data-rich and trustworthy.
- Do not infer causes from DATEX TravelTime measurements.

## Follow-up ideas after this plan ships

- User-configurable alert subscriptions for selected corridors/roads.
- Dedicated planned-roadworks calendar view.
- Road weather/CCTV enrichment with explicit freshness labels.
- More precise line geometries if Vegvesen TrafficInfo exposes route geometry beyond icon points.
- Editorial workflow to promote selected TrafficInfo events into Situation Room entries when corroborated by news or severe impact.

## Plan review checklist

Before implementation, reviewer must verify:

- [ ] TrafficInfo `id` is treated as durable source identity.
- [ ] Failed TrafficInfo fetches do not expire old events.
- [ ] Successful snapshots expire disappeared active/planned TrafficInfo events.
- [ ] TrafficInfo source items do not create `official_events` or `situations`.
- [ ] DATEX TravelTime remains operations-only.
- [ ] API bounds filtering uses geometry and does not rely only on frontend filtering.
- [ ] Frontend source labels are not hardcoded to DATEX.
- [ ] Segment-aware corridor/news matching tests include line geometries where vertices are not near the target.
- [ ] Production verification checks DB/source-health and authenticated API behavior, not anonymous 401 JSON.
- [ ] Full local gate is listed and uses Node 22.

## Execution recommendation

Execute in this order with subagent-driven-development:

1. Phase 1 + Phase 2 as PR/commit stack: data parity with Vegvesen's map.
2. Phase 3 as a small correctness patch, safe to ship independently.
3. Phase 4 server route integration.
4. Phase 5 frontend UX.
5. Phase 6 intelligence improvements.
6. Phase 7 full gate and production verification.

For execution, dispatch one implementer subagent per task, then a spec compliance reviewer, then a code-quality reviewer. Do not run implementation subagents in parallel when they touch git commits or shared files (`repository.ts`, `app.ts`, `store.ts`, `TrafficMapPage.tsx`).
