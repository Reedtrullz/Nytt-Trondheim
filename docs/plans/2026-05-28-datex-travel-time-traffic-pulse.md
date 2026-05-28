# DATEX TravelTime Traffic Pulse Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a low-noise DATEX TravelTime traffic pulse for Trondheim corridors so Nytt shows everyday traffic conditions without promoting delay data into emergency situations.

**Architecture:** Reuse Vegvesen DATEX Basic Auth credentials and worker/source-health patterns. Parse TravelTime location and measurement snapshots into compact normalized corridor rows, persist latest corridor state in Postgres, expose it through the owner operations API, and render a small traffic-pulse panel. Do not create or update `situations` from TravelTime alone.

**Tech Stack:** TypeScript, Vitest, fast-xml-parser, Postgres/PostGIS schema SQL, Express, React/Vite, GitHub Actions + Ansible deployment.

---

## Product Rules

- TravelTime is a traffic pulse/delay signal only.
- Do not infer accidents, closures, causes, or incident severity from TravelTime.
- Do not create `OfficialEvent` or `Situation` rows from TravelTime in this plan.
- Do not feed TravelTime into MET/NVE warning context or DATEX situation promotion logic.
- Use the existing DATEX Basic Auth env vars: `DATEX_USERNAME` and `DATEX_PASSWORD` at runtime, `NYTT_DATEX_USERNAME` and `NYTT_DATEX_PASSWORD` in GitHub Actions.
- Optional endpoint overrides:
  - `DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT`
  - `DATEX_TRAVEL_TIME_DATA_ENDPOINT`
- Defaults:
  - `https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetPredefinedTravelTimeLocations/pullsnapshotdata`
  - `https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetTravelTimeData/pullsnapshotdata`
- Live probe on 2026-05-28 showed no `Last-Modified` header for these TravelTime endpoints. Do not send conditional headers for TravelTime in this MVP; both location names and measurements are required to compute a correct current pulse. If Vegvesen adds cache validators later, implement a persisted body/cache design before using 304 paths.
- Representative live sizes on 2026-05-28: locations about 580 KB, measurements about 257 KB.
- Trondheim corridor names observed in the location table include IDs such as `100135` (`E6 Moholt - E6 Ranheim`), `100136` (`E6 Ranheim - E6 Moholt`), `100139` (`Rv706 Sluppen - E6 Sluppenrampene`), and related E6/Rv706/Fv66xx corridors.

## Data Model

Add shared type:

```ts
export interface TrafficPulseCorridor {
  id: string;
  name: string;
  state: "free_flow" | "slow" | "congested" | "stale";
  travelTimeSeconds?: number;
  freeFlowSeconds?: number;
  delaySeconds?: number;
  delayRatio?: number;
  trend?: string;
  measurementFrom?: string;
  measurementTo?: string;
  updatedAt: string;
  sourceUrl: string;
}
```

Persist latest rows in `datex_travel_times`:

```sql
CREATE TABLE IF NOT EXISTS datex_travel_times (
  id text PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL CHECK (state IN ('free_flow', 'slow', 'congested', 'stale')),
  travel_time_seconds real,
  free_flow_seconds real,
  delay_seconds real,
  delay_ratio real,
  trend text,
  measurement_from timestamptz,
  measurement_to timestamptz,
  source_url text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## Parser Rules

- XML parser options must mirror existing DATEX situation parser: namespace-agnostic, `processEntities: false`.
- Location identity: `predefinedLocationReference/@id` after namespace removal.
- Location name: first nested `value` under `predefinedLocationName`.
- Measurement identity: `predefinedLocationReference/@id` under the `pertinentLocation` / `LocationByReference` part of a `physicalQuantity` whose `basicData` is `TravelTimeData`.
- Measurement times: `startOfPeriod` and `endOfPeriod` under `measurementOrCalculationTime.period`.
- Current travel time: `travelTime.duration` seconds.
- Free-flow travel time: `freeFlowTravelTime.duration` seconds.
- Trend: `travelTimeTrendType` when present.
- Use only rows with a known location name and a current travel-time duration.
- Local filter: keep only known Trondheim TravelTime corridor IDs from the live predefined-location table, plus a conservative name fallback for future local additions. Initial allowlist:
  - `100071`, `100080`, `100135`, `100136`, `100137`, `100138`, `100139`, `100140`, `100141`, `100142`, `100208`, `100209`, `100210`, `100211`, `100222`, `100223`, `100228`, `100229`, `100230`, `100231`, `100322`, `100323`, `100348`, `100349`, `100350`, `100351`
- Name fallback must require at least one Trondheim-local place token: `trondheim`, `tiller`, `heimdal`, `moholt`, `ranheim`, `sluppen`, `okstad`, `ilevollen`, `iladalen`, `studentersamfunnet`, `havnegata`, `haakon vii`. Do not match bare `E6`, `Rv706`, or `Fv...` by itself; national road numbers alone over-include non-Trondheim corridors.
- Delay math:
  - `delaySeconds = max(0, travelTimeSeconds - freeFlowSeconds)` when free flow exists.
  - `delayRatio = travelTimeSeconds / freeFlowSeconds` when free flow is positive.
  - `congested` when `delayRatio >= 1.5` or `delaySeconds >= 300`.
  - `slow` when `delayRatio >= 1.15` or `delaySeconds >= 60`.
  - otherwise `free_flow`.
  - Missing free-flow values default to `free_flow` unless future data supplies another signal.
- Staleness:
  - A row missing from a successful complete TravelTime measurement snapshot is marked `stale`.
  - A row whose `measurementTo` is older than 20 minutes is displayed/read as `stale` even if its stored payload still has the previous speed state.
  - Failed fetches must not mark rows stale; source health degradation plus stale-age rendering covers upstream/worker outages.

---

### Task 1: Add shared TrafficPulse types

**Objective:** Add shared TypeScript types for TravelTime corridor rows and include a dedicated source-health ID.

**Files:**

- Modify: `packages/shared/src/types.ts`
- Test: `apps/worker/test/datex-travel-time.test.ts` (create compile-time guard only if the file does not exist)

**Step 1: Write failing compile/type test**

Create `apps/worker/test/datex-travel-time.test.ts` with a compile-time guard that imports `TrafficPulseCorridor` and verifies `SourceHealth.source` accepts `datex_travel_time`.

**Step 2: Run test/typecheck to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: FAIL because `TrafficPulseCorridor` and/or `datex_travel_time` do not exist.

**Step 3: Implement types**

In `packages/shared/src/types.ts`:

- Add `"datex_travel_time"` to `SourceId`.
- Add the `TrafficPulseCorridor` interface from the Data Model section.
- Add optional `trafficPulse?: TrafficPulseCorridor[]` to `OperationsStatus`.

**Step 4: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck && npm test -- apps/worker/test/datex-travel-time.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts apps/worker/test/datex-travel-time.test.ts
git commit -m "feat: add traffic pulse shared types"
```

---

### Task 2: Add TravelTime parser fixtures and failing parser tests

**Objective:** Capture representative DATEX TravelTime XML and expected normalized corridor behavior before implementing the parser.

**Files:**

- Create: `apps/worker/test/fixtures/datex-travel-time-locations.xml`
- Create: `apps/worker/test/fixtures/datex-travel-time-data.xml`
- Modify: `apps/worker/test/datex-travel-time.test.ts`

**Step 1: Add minimal fixtures**

Create two small XML files, not live full snapshots and not credentials:

Locations fixture must include:

- local allowlisted corridor `100135` named `E6 Moholt - E6 Ranheim`
- local allowlisted corridor `100139` named `Rv706 Sluppen - E6 Sluppenrampene`
- non-allowlisted but local-name fallback corridor `local-future-1` named `Trondheim sentrum - Lade`
- outside corridor `999999` named `Ring 3 Oslo - Sinsen`
- non-Trondheim national-road corridor `888888` named `E6 Lillehammer - Hamar` that must be rejected despite containing E6

Data fixture must include:

- `100135`: travel 360, free flow 240, trend `increasing`, period from `2026-05-28T18:15:00.010+02:00` to `2026-05-28T18:20:00.010+02:00`
- `100139`: travel 150, free flow 120, trend `stable`
- `local-future-1`: travel 180, free flow 180
- `999999`: travel 600, free flow 300
- `888888`: travel 1200, free flow 300
- one measurement with a missing unknown location ID that must be dropped
- one non-TravelTimeData `physicalQuantity` that must be ignored

**Step 2: Write failing parser tests**

In `apps/worker/test/datex-travel-time.test.ts`, import planned functions from `../src/datexTravelTime.js`:

- `parseDatexTravelTimeLocations`
- `parseDatexTravelTimeData`
- `trafficPulseFromDatexTravelTime`

Tests:

- parses location IDs/names from namespace-prefixed XML.
- parses TravelTimeData measurements and ignores non-TravelTimeData quantities.
- joins locations and measurements into only local Trondheim corridors: allowlisted IDs plus the conservative local-name fallback.
- computes `congested` for 100135 (`360/240 = 1.5`) and `slow` for 100139 (`150/120 = 1.25`).
- drops outside Oslo, unknown-location measurements, and non-Trondheim national-road names such as `E6 Lillehammer - Hamar`.

**Step 3: Verify RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/datex-travel-time.test.ts
```

Expected: FAIL because `../src/datexTravelTime.js` does not exist.

**Step 4: Commit?**

Do not commit this red-only task separately unless the implementer needs a checkpoint. It is acceptable for Task 3 to commit tests + implementation together after GREEN.

---

### Task 3: Implement TravelTime parser and local filter

**Objective:** Implement parser and normalization helpers for DATEX TravelTime snapshots.

**Files:**

- Create: `apps/worker/src/datexTravelTime.ts`
- Modify: `apps/worker/test/datex-travel-time.test.ts`

**Step 1: Implement minimal parser**

Create `apps/worker/src/datexTravelTime.ts` with:

- endpoint constants for locations/data.
- namespace-agnostic XML parsing with `processEntities: false`.
- exported `parseDatexTravelTimeLocations(xml)` returning `Map<string, { id: string; name: string }>` or a plain record if easier.
- exported `parseDatexTravelTimeData(xml)` returning measurements with `locationId`, times, durations and trend.
- exported `trafficPulseFromDatexTravelTime(locations, measurements, options)` returning `TrafficPulseCorridor[]`.

Reuse existing DATEX helpers if helpful, but do not change DATEX situation behavior except exported helper visibility if needed.

**Step 2: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/datex-travel-time.test.ts
```

Expected: PASS.

**Step 3: Verify no regressions**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/datex.test.ts apps/worker/test/datex-travel-time.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/worker/src/datexTravelTime.ts apps/worker/test/datex-travel-time.test.ts apps/worker/test/fixtures/datex-travel-time-locations.xml apps/worker/test/fixtures/datex-travel-time-data.xml
throwaway_status=$(git status --short)
printf '%s\n' "$throwaway_status"
git commit -m "feat: parse DATEX travel time snapshots"
```

---

### Task 4: Add authenticated TravelTime collection wrapper

**Objective:** Fetch both TravelTime snapshots with Basic Auth and parse them into traffic-pulse rows.

**Files:**

- Modify: `apps/worker/src/datexTravelTime.ts`
- Modify: `apps/worker/test/datex-travel-time.test.ts`

**Step 1: Write failing fetch tests**

Tests must verify:

- Both endpoints receive `Authorization: Basic ...` and `User-Agent` headers.
- No `If-Modified-Since` header is sent for TravelTime in this MVP because no persisted response-body cache exists and both bodies are required for correctness.
- A 200/200 response returns normalized corridors.
- An HTTP error throws a useful error without logging credentials.

**Step 2: Verify RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/datex-travel-time.test.ts
```

Expected: FAIL because collection wrapper is missing.

**Step 3: Implement**

Export:

```ts
export interface DatexTravelTimeCollectOptions {
  locationsEndpoint: string;
  dataEndpoint: string;
  username: string;
  password: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export interface DatexTravelTimeCollectResult {
  corridors: TrafficPulseCorridor[];
}
```

Always fetch both endpoint bodies. Do not implement 304 handling until a future plan adds persisted response-body caching for locations and measurements.

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/datex-travel-time.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/datexTravelTime.ts apps/worker/test/datex-travel-time.test.ts
git commit -m "feat: collect DATEX travel time snapshots"
```

---

### Task 5: Add TravelTime database schema and repository persistence

**Objective:** Persist latest TravelTime corridor rows and mark missing rows stale after successful snapshots.

**Files:**

- Modify: `apps/server/src/db/schema.sql`
- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/repository.test.ts`

**Step 1: Write failing repository tests**

Add tests for:

- `upsertDatexTravelTimes(corridors)` inserts with compact JSON payload and numeric fields.
- `markMissingDatexTravelTimesStale(activeIds)` sets `state='stale'` for rows not in active IDs after a successful complete measurement snapshot.
- `datexTravelTimes(now)` reads latest rows ordered by largest delay first, then name.
- `datexTravelTimes(now)` returns rows with `state: "stale"` when `measurementTo` is more than 20 minutes older than `now`, without requiring a failed fetch to mutate the DB.

**Step 2: Verify RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because methods/schema do not exist.

**Step 3: Implement schema and repository**

- Add `datex_travel_times` table from Data Model.
- Add WorkerRepository methods:
  - `upsertDatexTravelTimes(corridors: TrafficPulseCorridor[]): Promise<void>`
  - `markMissingDatexTravelTimesStale(activeIds: string[]): Promise<void>`
  - `datexTravelTimes(now?: Date): Promise<TrafficPulseCorridor[]>`
- Use parameterized SQL only.
- Persist `payload` as the corridor object.
- When marking missing rows stale, also update payload state with `jsonb_set` and `updated_at=now()`.
- When reading rows, overlay `state: "stale"` in returned payloads if `measurement_to` is older than 20 minutes relative to the provided/current time; do not rewrite the DB during reads.

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.sql apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: persist DATEX travel time pulse"
```

---

### Task 6: Wire TravelTime collection into the worker loop

**Objective:** Collect TravelTime rows every worker cycle, persist them, and expose source health without touching situation promotion.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/test/collectors.test.ts` only if environment handling needs coverage

**Step 1: Write failing worker-oriented test if feasible**

If direct `index.ts` testing is too invasive, add a narrow env/default test in `apps/worker/test/datex-travel-time.test.ts` for endpoint constants and collection wrapper. Do not create brittle tests that import `index.ts` and run the worker loop.

**Step 2: Implement worker wiring**

In `apps/worker/src/index.ts`:

- Read `DATEX_USERNAME` and `DATEX_PASSWORD` once and reuse for both DATEX situations and TravelTime.
- Read endpoint overrides:
  - `DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT`
  - `DATEX_TRAVEL_TIME_DATA_ENDPOINT`
- On missing DATEX credentials: set source health `source: "datex_travel_time"`, label `Vegvesen reisetid`, state `awaiting_access`, detail `DATEX Basic Auth mangler for reisetidsdata`, then skip collection.
- On success:
  - `repository.upsertDatexTravelTimes(result.corridors)`
  - `repository.markMissingDatexTravelTimesStale(result.corridors.map(c => c.id))`
  - set source health `source: "datex_travel_time"`, label `Vegvesen reisetid`, state `ok`, detail like `26 DATEX reisetidskorridorer oppdatert`.
- On failure: set source health `datex_travel_time` degraded with error text and do not mark existing corridors stale. Stale-age rendering handles old rows while source health explains failure.
- Do not push anything into `officialEvents`.
- Do not change `currentDatexEvents`, `officialTrafficSituations`, or MET/NVE warning context.

**Step 3: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/datex-travel-time.test.ts apps/worker/test/repository.test.ts && npm run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/test/datex-travel-time.test.ts apps/worker/test/collectors.test.ts
git commit -m "feat: collect DATEX travel time pulse"
```

---

### Task 7: Expose Traffic Pulse through operations API/store

**Objective:** Include latest TravelTime corridors in the owner operations status response.

**Files:**

- Modify: `apps/server/src/store.ts`
- Modify: `apps/server/test/api.test.ts`
- Modify: `packages/shared/src/types.ts` only if Task 1 needs adjustment

**Step 1: Write failing API/store tests**

Add or extend server API tests so `/api/operations/status` includes `trafficPulse` as an array. For the development MemoryStore, it can be an empty array. For PgStore, add a focused store test only if existing server tests can exercise a fake Pool cleanly; otherwise verify the SQL path by code review and typecheck.

**Step 2: Verify RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/api.test.ts
```

Expected: FAIL because `trafficPulse` is absent.

**Step 3: Implement**

- Add `trafficPulse: []` to MemoryStore operations status.
- In PgStore `getOperationsStatus`, query `datex_travel_times` and map rows/payloads to `TrafficPulseCorridor[]`, ordered by `delay_seconds DESC NULLS LAST, name ASC`, limit 30.
- Apply the same 20-minute stale-age overlay in the PgStore response so the Operations API never displays old rows as current traffic.
- Return `trafficPulse` in `OperationsStatus`.

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/api.test.ts && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/store.ts apps/server/test/api.test.ts packages/shared/src/types.ts
git commit -m "feat: expose DATEX travel time operations data"
```

---

### Task 8: Render traffic pulse in OperationsPage

**Objective:** Show latest corridor delay state in the owner-only operations page.

**Files:**

- Modify: `apps/frontend/src/pages/OperationsPage.tsx`
- Modify: frontend CSS file if needed (`apps/frontend/src/styles.css` or equivalent; inspect current path first)

**Step 1: Write UI expectation manually in code/test comments if no frontend tests exist**

There are currently no frontend unit tests. Keep this task small and verify with typecheck/build instead of introducing a test framework pattern just for this panel.

**Step 2: Implement UI**

Add a section under source health or near the operations summary:

- Heading: `Trafikkpuls fra Vegvesen`
- Empty state: `Ingen reisetidskorridorer registrert ennå.`
- For each corridor:
  - name
  - state label: `Fri flyt`, `Sakte`, `Kø`, `Utdatert`
  - delay in minutes when `delaySeconds` exists
  - travel/free-flow seconds rendered as minutes
  - timestamp from `measurementTo` or `updatedAt`
- Keep wording explicit: this is measured/estimated travel time, not incident cause.

**Step 3: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck && npm run build -w @nytt/frontend
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/frontend/src/pages/OperationsPage.tsx apps/frontend/src/*.css
git commit -m "feat: show DATEX travel time traffic pulse"
```

---

### Task 9: Update docs and env examples

**Objective:** Document TravelTime credentials, endpoints, product boundaries, and verification.

**Files:**

- Modify: `.env.example`
- Modify: `docs/SOURCES.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `README.md`

**Step 1: Update docs**

Document:

- TravelTime uses same DATEX Basic Auth credentials.
- Optional endpoint overrides are `DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT` and `DATEX_TRAVEL_TIME_DATA_ENDPOINT`.
- TravelTime is source-health/traffic-pulse only, not situation promotion.
- Verify production with:

```bash
curl -fsS https://nytt.reidar.tech/health
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,detail,last_checked_at,next_poll_at from source_health where source in ('datex','datex_travel_time') order by source;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select id,name,state,travel_time_seconds,free_flow_seconds,delay_seconds,measurement_to from datex_travel_times order by delay_seconds desc nulls last, name asc limit 10;\""
```

**Step 2: Verify docs formatting**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run format:check
```

Expected: PASS.

**Step 3: Commit**

```bash
git add .env.example README.md docs/SOURCES.md docs/ARCHITECTURE.md docs/DEPLOYMENT.md
git commit -m "docs: document DATEX travel time pulse"
```

---

### Task 10: Final local quality gates and integration review

**Objective:** Prove all tasks work together locally before pushing.

**Files:**

- No intended file changes unless fixing review issues.

**Step 1: Run full gates**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck && npm test && npm run lint && npm run format:check && npm run build
```

Expected: PASS.

**Step 2: Integration review**

Dispatch a final subagent reviewer with the full diff range and ask it to verify:

- TravelTime never creates `OfficialEvent` or `Situation` rows.
- No credentials are logged or exposed to frontend.
- Postgres schema and PgStore queries agree.
- SourceHealth source ID and shared union agree.
- Operations UI handles empty `trafficPulse`.
- Existing DATEX situation ingestion behavior remains unchanged.

**Step 3: Fix and re-run gates if needed**

If reviewer finds blockers, fix with a focused subagent or direct trivial patch, then re-run the gates.

---

### Task 11: Push, wait for CI, deploy, and verify production

**Objective:** Ship the TravelTime traffic pulse and verify it against live DATEX + production DB.

**Files:**

- No intended source changes.

**Step 1: Push**

```bash
git status --short
git push origin main
```

**Step 2: Wait for CI success**

Use `gh run list` and `gh run watch` for the pushed HEAD. Do not report success until CI shows `completed` + `success`.

**Step 3: Wait for Deploy to VPS success**

Use `gh run list` and `gh run watch` for `Deploy to VPS` on the same HEAD. Do not report deployed until it shows `completed` + `success`.

**Step 4: Verify production**

Run:

```bash
curl -fsS https://nytt.reidar.tech/health
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && git rev-parse HEAD"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production ps worker app postgres"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production logs --tail=80 worker"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,detail,last_checked_at,next_poll_at from source_health where source in ('datex','datex_travel_time') order by source;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from datex_travel_times;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select id,name,state,travel_time_seconds,free_flow_seconds,delay_seconds,measurement_to from datex_travel_times order by delay_seconds desc nulls last, name asc limit 10;\""
```

Expected:

- `/health` returns ok with Postgres.
- deployed git SHA matches pushed HEAD.
- worker is running without OOM.
- `source_health.datex_travel_time` is `ok` or a clearly explainable DATEX upstream issue.
- `datex_travel_times` contains Trondheim corridors when the live TravelTime endpoints return them.
- Existing `datex` source health remains healthy.

## Post-Implementation Audit Checklist

- [ ] TravelTime parser uses `processEntities: false`.
- [ ] TravelTime Basic Auth uses existing `DATEX_USERNAME`/`DATEX_PASSWORD` only server-side.
- [ ] No DATEX credentials in docs, fixtures, logs, frontend, or DB payloads.
- [ ] TravelTime rows do not create `official_events`.
- [ ] TravelTime rows do not create or update `situations`.
- [ ] TravelTime source health is separate from `datex` situation health.
- [ ] TravelTime endpoint overrides are optional and documented.
- [ ] TravelTime does not use conditional `If-Modified-Since` until a persisted response-body cache exists.
- [ ] Missing credentials produce `datex_travel_time` source health `awaiting_access`, not silent omission.
- [ ] Failed TravelTime fetches do not mark existing rows stale.
- [ ] Rows older than 20 minutes are rendered/returned as stale.
- [ ] The UI labels TravelTime as traffic pulse/estimated travel time, not incident cause.
- [ ] Production verification uses live DB/source health, not assumed deploy status.
