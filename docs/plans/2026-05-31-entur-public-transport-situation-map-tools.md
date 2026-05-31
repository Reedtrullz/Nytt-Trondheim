# Entur Public Transport And Situation Map Tools Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add Entur public-transport tracking and richer private Situation Room map tools for forest-fire and search-and-rescue reasoning without turning telemetry or speculation into official incident evidence.

**Architecture:** Keep Entur high-churn vehicle positions as operations-only map telemetry in dedicated tables/source-health, and mirror only Entur service-alert/situation records into `source_items` as official evidence candidates. Expose authenticated map-context APIs from the server, render transport layers on `/trafikk` and selected Situation Room maps, and extend private annotations with typed scenario metadata while the server continues forcing `provenance="private_annotation"` for all user-created map features. No Entur vehicle row, departure prediction, private drawing, buffer, wind cone, or search-sector sketch may create `official_events` or activate/update `situations` in this plan.

**Tech Stack:** TypeScript, Node 22, React/Vite, Leaflet/react-leaflet, Express, PostgreSQL/PostGIS, Vitest, Playwright, Entur GraphQL Vehicle Positions, Entur Journey Planner v3 situations, existing Nytt worker/source-health/source-item architecture.

---

## Current codebase and research notes

Docs and references read before writing this plan:

- `docs/ARCHITECTURE.md`
- `docs/SOURCES.md`
- `docs/DEPLOYMENT.md`
- `writing-plans/references/external-feed-ingestion-plan-checklist.md`
- `writing-plans/references/source-item-ledger-feed-ingestion-notes.md`
- `subagent-driven-development/references/traffic-map-implementation-audit.md`
- Entur docs: Vehicle Positions, Real-Time API Reference, Journey Planner v3, Authentication, National Stop Register.
- MET docs: MetAlerts 2.0 and CAP v2 profile for forest-fire warnings.
- NASA FIRMS and Copernicus EFFIS docs were reviewed as future optional active-fire context sources, not as first implementation dependencies.

Live Entur API checks performed on 2026-05-31 with `ET-Client-Name: reidar-nytt-trondheim`:

```text
POST https://api.entur.io/realtime/v2/vehicles/graphql
query { vehicles(codespaceId:"ATB") { lastUpdated location { latitude longitude } } }
Result: 146 ATB vehicles, first location around Trondheim/Trøndelag.

POST https://api.entur.io/realtime/v2/vehicles/graphql
query vehicles(codespaceId:"ATB", boundingBox:{minLat:63.30,maxLat:63.55,minLon:10.20,maxLon:10.65})
Result: 120 vehicles in Trondheim-region bounds. Useful fields confirmed: vehicleId, mode, line { lineRef publicCode lineName }, operator, originName, destinationName, lastUpdated, expiration, location, speed, bearing, delay, inCongestion, occupancyStatus, vehicleStatus, monitoredCall, progressBetweenStops.

POST https://api.entur.io/journey-planner/v3/graphql
query { situations(codespaces:["ATB"]) { situationNumber severity reportType validityPeriod summary description affects ... } }
Result: 32 current ATB situations/service alerts, including temporary moved-stop alerts with quay coordinates.
```

Entur contract facts:

- Open data under NLOD, but every request must identify with `ET-Client-Name` or Entur may strictly rate-limit/block the consumer.
- Vehicle GraphQL endpoint: `https://api.entur.io/realtime/v2/vehicles/graphql`.
- Journey Planner v3 endpoint: `https://api.entur.io/journey-planner/v3/graphql`.
- SIRI Lite REST endpoints are limited to 4 requests/minute; this plan uses GraphQL and still rate-limits worker polling deliberately.
- Primary Trondheim/Trøndelag operator/codespace for this feature is `ATB`; keep codespaces configurable so rail/ferry can be added later without schema churn.

Existing Nytt constraints to preserve:

- `frontend` consumes authenticated API resources only.
- `server` owns identity, persistence, exports, access control and API-safe payloads.
- `worker` is the scheduled ingestion/analysis process.
- `source_items` is an evidence ledger; telemetry-only feeds must stay out.
- Map provenance classes are strict: official/reporting estimate/preparedness/private. User map features must stay private annotations regardless of client payload.
- Situation activation requires explicit incident type and independent/public official rules. Entur vehicle movement and private speculation are not activation sources.
- Existing DATEX TravelTime rule remains unchanged: operations-only, no `source_items`, no `official_events`, no `situations`.

## Runtime dependency chain and silent-degradation audit

```text
worker container
  apps/worker/src/index.ts
    -> collectEnturVehiclesForMap()                 [new, fast guarded interval]
      -> apps/worker/src/enturVehicles.ts           [new, GraphQL + parser]
      -> WorkerRepository.upsertPublicTransportVehicles()
      -> WorkerRepository.markMissingPublicTransportVehiclesStale()
      -> source_health('entur_vehicle_positions')
    -> collectEnturServiceAlerts()                  [new, normal 10-min collectAll path]
      -> apps/worker/src/enturServiceAlerts.ts      [new, GraphQL + parser]
      -> WorkerRepository.upsertPublicTransportServiceAlerts()
      -> WorkerRepository.upsertEnturServiceAlertSourceItems() [alerts only]
      -> WorkerRepository.expireMissingPublicTransportServiceAlerts()
      -> source_health('entur_service_alerts')
server container
  apps/server/src/app.ts
    -> GET /api/map/public-transport                [new]
      -> PgStore.listPublicTransportVehicles()
      -> PgStore.listPublicTransportServiceAlerts()
    -> existing GET /api/map/traffic-events         [unchanged road-focused payload]
    -> POST/PATCH /api/situations/:id/features      [extend typed private metadata]
frontend
  apps/frontend/src/hooks/usePublicTransportMap.ts   [new, abort-safe hook]
  apps/frontend/src/components/map/PublicTransportLayer.tsx [new]
  apps/frontend/src/components/MapViews.tsx          [extend SituationMap tools]
```

Silent-degradation risks and required plan defenses:

1. Worker collectors are caught and represented through `source_health`; parser/import failures can otherwise look like “no buses”. Every worker task below has targeted tests plus an import check after build.
2. Entur vehicles are high-churn telemetry. They must not be mirrored to `source_items`; a vehicle row disappearing from a successful snapshot means stale/expired telemetry, not an incident resolution.
3. Entur service alerts are ledger-worthy official transport notices, but not situation activators in this plan. Tests must assert zero `official_events` and zero `situations` promotion for Entur sources.
4. Private map tools invite speculation. Their UI and exported metadata must label confidence and analysis type, but the server must still overwrite provenance to `private_annotation` and never accept official/preparedness/reporting provenance from clients.
5. Geospatial helpers must be segment-aware where they compare proximity to lines/polygons. The map-tools phase includes explicit line-segment tests so route/search-area interactions do not regress to vertex-only matching.
6. Frontend polling hooks must invalidate request IDs on unmount, not merely call `AbortController.abort()`, following the existing `useTrafficMap` pattern.

## Feed semantics and lifecycle rules

### Entur Vehicle Positions

- Durable-ish telemetry identity: `entur_vehicle_positions:${codespaceId}:${vehicleId}`.
- Revision/change signal: `lastUpdated`, `expiration`, payload hash.
- Geography: request bounded Trondheim-region box first (`minLat=63.30, maxLat=63.55, minLon=10.20, maxLon=10.65`), then server still filters by current map bounds.
- Polling: worker fast interval every 60 seconds for vehicles only; keep normal collection tick at 10 minutes.
- Missing from successful snapshot: mark stale if not seen and `expiration` passed or `last_seen_at` older than 5 minutes; hide from default frontend after stale/expired.
- Failed snapshot: do not expire existing rows; source health becomes degraded.
- Store/promotion: store in `public_transport_vehicles`; no `source_items`, no `official_events`, no `situations`.

### Entur Service Alerts / Journey Planner Situations

- Durable identity: `situationNumber` when present; fallback to GraphQL `id` only if `situationNumber` is missing.
- Local id: `entur-service-alert:${codespaceId}:${situationNumberOrId}`.
- Version/change signal: `version`, `versionedAtTime`, `creationTime`, normalized payload hash.
- Geography: derive `Point` or `MultiPoint` geometry from affected stop places/quays when Entur supplies coordinates; keep unlocated alerts stored but out of map-bounds results. Do not collapse multiple affected stops to a single point unless a test explicitly documents that lossy choice.
- Successful snapshot disappearance: mark active alerts absent from the new snapshot as `expired`.
- Failed snapshot: retain prior active alerts and mark source health degraded.
- Open-ended alerts: if still present, keep active; if absent after successful snapshot, expire; if source is degraded, do not infer disappearance.
- Store/promotion: store in `public_transport_service_alerts` and mirror to `source_items` with provider `entur`, kind `official_event`, reliability `official`; do not create `official_events` or `situations` in this plan.

### Situation Room map tools

- All user-created analysis shapes remain `private_annotation`.
- New metadata is allowed only under whitelisted fields: `analysisType`, `confidence`, `scenario`, `measurement`, `styleKey`, and `sourceItemIds`.
- Confidence labels are owner-facing only: `observed_by_owner`, `reported_unverified`, `speculative`.
- Tool presets are templates over private annotations, not distinct provenance classes.
- Export should include the typed metadata and a warning that private analysis layers are not public evidence.

## Product scope and non-goals

In scope now:

1. Live-ish public transport vehicle layer for ATB buses/trams/ferries/trains inside Trondheim-region bounds.
2. Entur service-alert layer for moved stops, cancellations, line disruptions and other public-transport situations.
3. Public transport source health in Drift and map source-status panels.
4. Traffic map toggle for public transport vehicles/alerts.
5. Situation Room optional context layer for nearby public transport disruption and vehicles.
6. Private fire/SAR planning tools: typed labels, measurements, radius circles, smoke/wind cones, route/line sketches, search sectors, last-known-position markers.
7. Manual evidence linking from Entur service-alert source items to a situation.

Non-goals for this implementation:

- No journey-planning/routing product and no passenger-trip recommendations.
- No GraphQL websocket subscriptions yet.
- No automatic promotion of Entur disruptions into Nytt `situations`.
- No automatic SAR inference from private drawings or news speculation.
- No authenticated DSB skogbrann resource functions.
- No NASA FIRMS/EFFIS ingestion in the first implementation; document as a follow-up because FIRMS requires API key setup and satellite false-positive handling.

## Acceptance criteria

1. `source_health` includes `entur_vehicle_positions` and `entur_service_alerts` with last checked time, next poll time, counts and degraded state on failure.
2. Worker stores ATB vehicle positions in `public_transport_vehicles` and stale/expired rows disappear from default map results without deleting history immediately.
3. Worker stores Entur service alerts in `public_transport_service_alerts` and mirrors them into `source_items` provider `entur`, kind `official_event`, preserving raw payload.
4. Production DB checks prove Entur vehicles have zero `source_items`, zero `official_events`, and zero `situations` promotion.
5. `/api/map/public-transport` returns authenticated, bounds-filtered vehicles and alerts.
6. `/api/map/public-transport` remains the Entur payload boundary; `/trafikk` combines it client-side with the existing road-focused `/api/map/traffic-events` payload.
7. `/trafikk` exposes layer toggles for buses/trams/ferries/trains and service alerts with source freshness labels.
8. Situation Room map can enable/disable public transport context without mixing it into evidence/provenance layers.
9. Private map tool shapes have typed analysis labels and confidence labels, but the server still forces provenance to `private_annotation`.
10. Fire presets cover fire perimeter, hotspot, smoke/wind direction cone, risk radius, water/access point and evacuation/closure line.
11. SAR presets cover last-known position, witness observation, probable route, search sector, search grid/segment and command/resource point.
12. Measurement helpers report distance, area and bearing with tests that include segment-aware line cases.
13. Full gate passes: `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run test:e2e`.
14. Deployment is reported only after CI and deploy workflow runs for the pushed SHA complete with `status=completed, conclusion=success`, and live `curl`/DB checks verify data and non-promotion invariants.

---

## Phase 1: Shared contracts and configuration

### Task 1: Add shared public transport source IDs and payload types

**Objective:** Define API-safe Entur/public-transport contracts before worker/server/frontend implementation.

**Files:**
- Create: `packages/shared/src/public-transport.ts`
- Modify: `packages/shared/src/types.ts:3-19`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/worker/test/entur-types.test.ts`

**Step 1: Write failing compile-time test**

Create `apps/worker/test/entur-types.test.ts`:

```ts
import type {
  PublicTransportMapPayload,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  SourceItemInput,
} from "@nytt/shared";

const _vehicle: PublicTransportVehicle = {
  id: "entur-vehicle:ATB:8790",
  source: "entur_vehicle_positions",
  codespaceId: "ATB",
  vehicleId: "8790",
  mode: "bus",
  lineRef: "ATB:Line:2_45",
  publicCode: "45",
  lineName: "Sjetnmarka- Tiller- Tillerringen- Sandmoen",
  destinationName: "Hagen",
  lastUpdated: "2026-05-31T21:02:50.207Z",
  expiresAt: "2026-05-31T21:17:00.000Z",
  geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
  delaySeconds: 59,
  bearing: 206,
  speedMps: 0,
  occupancyStatus: "noData",
  vehicleStatus: "IN_PROGRESS",
  stale: false,
};

const _alert: PublicTransportServiceAlert = {
  id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
  source: "entur_service_alerts",
  codespaceId: "ATB",
  situationNumber: "ATB:SituationNumber:24982-stopPoint",
  severity: "noImpact",
  reportType: "incident",
  summary: "Rota - bussholdeplassen er midlertidig flyttet",
  description: "Rota - bussholdeplassen er midlertidig flyttet",
  validFrom: "2026-05-29T06:24:00.000Z",
  validTo: "2026-06-02T21:59:00.000Z",
  updatedAt: "2026-05-29T06:24:44.256Z",
  geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
  state: "active",
  affectedStopNames: ["Rota"],
};

const _health: SourceHealth = {
  source: "entur_vehicle_positions",
  label: "Entur kjøretøyposisjoner",
  state: "ok",
  detail: "120 kjøretøy oppdatert",
};

const _sourceItem: SourceItemInput = {
  id: "source:entur-alert",
  provider: "entur",
  kind: "official_event",
  externalId: "ATB:SituationNumber:24982-stopPoint",
  title: _alert.summary,
  fetchedAt: "2026-05-31T21:15:00.000Z",
  rawPayload: { situationNumber: _alert.situationNumber },
  normalizedPayload: _alert,
  captureHash: "hash",
  reliabilityTier: "official",
  geoHint: _alert.geometry,
};

const _payload: PublicTransportMapPayload = {
  vehicles: [_vehicle],
  alerts: [_alert],
  sources: [_health],
  generatedAt: "2026-05-31T21:15:00.000Z",
};

void _payload;
void _sourceItem;
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/entur-types.test.ts
```

Expected: FAIL because public transport types and source IDs do not exist.

**Step 3: Add shared types**

Create `packages/shared/src/public-transport.ts`:

```ts
import type { MultiPoint, Point } from "geojson";
import type { SourceHealth } from "./types.js";

export type PublicTransportVehicleMode = "bus" | "tram" | "rail" | "water" | "metro" | "unknown";
export type PublicTransportAlertState = "active" | "expired" | "cancelled";

export interface PublicTransportVehicle {
  id: string;
  source: "entur_vehicle_positions";
  codespaceId: string;
  vehicleId: string;
  mode: PublicTransportVehicleMode;
  lineRef?: string;
  publicCode?: string;
  lineName?: string;
  operatorRef?: string;
  operatorName?: string;
  originName?: string;
  destinationName?: string;
  lastUpdated: string;
  expiresAt?: string;
  geometry: Point;
  speedMps?: number;
  bearing?: number;
  delaySeconds?: number;
  inCongestion?: boolean;
  occupancyStatus?: string;
  vehicleStatus?: string;
  monitored?: boolean;
  currentStopPointRef?: string;
  currentStopOrder?: number;
  vehicleAtStop?: boolean;
  progressPercent?: number;
  stale: boolean;
}

export interface PublicTransportServiceAlert {
  id: string;
  source: "entur_service_alerts";
  codespaceId: string;
  situationNumber: string;
  severity?: string;
  reportType?: string;
  summary: string;
  description?: string;
  advice?: string;
  validFrom?: string;
  validTo?: string;
  createdAt?: string;
  updatedAt: string;
  version?: number;
  state: PublicTransportAlertState;
  geometry?: Point | MultiPoint;
  affectedLineRefs?: string[];
  affectedLineNames?: string[];
  affectedStopIds?: string[];
  affectedStopNames?: string[];
  infoLinks?: Array<{ uri: string; label?: string }>;
}

export interface PublicTransportMapPayload {
  vehicles: PublicTransportVehicle[];
  alerts: PublicTransportServiceAlert[];
  sources: SourceHealth[];
  generatedAt: string;
}
```

Modify `packages/shared/src/types.ts` source union:

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
  | "datex_weather"
  | "datex_cctv"
  | "trafikkdata"
  | "vegvesen_traffic_info"
  | "entur"
  | "entur_vehicle_positions"
  | "entur_service_alerts"
  | "dsb"
  | "politiloggen"
  | "deepseek";
```

Modify `packages/shared/src/index.ts` to export the new module:

```ts
export * from "./public-transport.js";
```

**Step 4: Verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/entur-types.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/public-transport.ts packages/shared/src/types.ts packages/shared/src/index.ts apps/worker/test/entur-types.test.ts
git commit -m "feat: add Entur public transport shared types"
```

### Task 2: Add shared query and private map-tool schemas

**Objective:** Validate public transport map bounds and typed private map-tool metadata at the API boundary.

**Files:**
- Modify: `packages/shared/src/schemas.ts:38-55`
- Test: `packages/shared/test/public-transport-schemas.test.ts`

**Step 1: Write failing tests**

Create `packages/shared/test/public-transport-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { privateMapFeatureInputSchema, publicTransportMapQuerySchema } from "../src/schemas.js";

describe("public transport and map tool schemas", () => {
  it("requires complete public transport bounds when any bound is provided", () => {
    expect(() => publicTransportMapQuerySchema.parse({ north: "63.5" })).toThrow(/north, south, east og west/);
    expect(
      publicTransportMapQuerySchema.parse({
        north: "63.5",
        south: "63.3",
        east: "10.6",
        west: "10.2",
        modes: "bus,tram",
      }),
    ).toMatchObject({ modes: ["bus", "tram"], north: 63.5, south: 63.3 });
  });

  it("accepts typed private analysis metadata but no client provenance", () => {
    const parsed = privateMapFeatureInputSchema.parse({
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
      properties: {
        label: "Sist sett",
        provenance: "official",
        analysisType: "last_known_position",
        confidence: "reported_unverified",
        scenario: "sar",
        measurement: { radiusMeters: 500 },
      },
    });

    expect(parsed.properties).toMatchObject({
      label: "Sist sett",
      analysisType: "last_known_position",
      confidence: "reported_unverified",
      scenario: "sar",
      measurement: { radiusMeters: 500 },
    });
    expect(parsed.properties).not.toHaveProperty("provenance");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- packages/shared/test/public-transport-schemas.test.ts
```

Expected: FAIL because `publicTransportMapQuerySchema` and map-tool metadata fields do not exist.

**Step 3: Add schemas**

In `packages/shared/src/schemas.ts`, add new source IDs to `sourceIdSchema`. Then add `publicTransportMapQuerySchema` **after** the existing `csvListSchema` and `coordinateParamSchema` declarations, not directly after `sourceIdSchema`; `coordinateParamSchema` is a `const` and will otherwise be used before initialization at module load.

```ts
const publicTransportModeSchema = z.enum(["bus", "tram", "rail", "water", "metro", "unknown"]);
const publicTransportLatitudeParamSchema = z.preprocess(
  (value) => (value === "" ? Number.NaN : value),
  z.coerce.number().min(-90).max(90).finite().optional(),
);
const publicTransportLongitudeParamSchema = z.preprocess(
  (value) => (value === "" ? Number.NaN : value),
  z.coerce.number().min(-180).max(180).finite().optional(),
);

export const publicTransportMapQuerySchema = z
  .object({
    modes: csvListSchema(publicTransportModeSchema),
    includeAlerts: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    north: publicTransportLatitudeParamSchema,
    south: publicTransportLatitudeParamSchema,
    east: publicTransportLongitudeParamSchema,
    west: publicTransportLongitudeParamSchema,
  })
  .superRefine((value, context) => {
    const bounds = [value.north, value.south, value.east, value.west];
    const providedBounds = bounds.filter((entry) => entry !== undefined).length;
    if (providedBounds > 0 && providedBounds < bounds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Kartutsnitt krever north, south, east og west.",
        path: ["bounds"],
      });
      return;
    }
    if (providedBounds === 0) return;
    if (value.north! < value.south!) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "north må være større enn eller lik south.", path: ["north"] });
    }
    if (value.east! < value.west!) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "east må være større enn eller lik west.", path: ["east"] });
    }
  });

const privateMapAnalysisTypeSchema = z.enum([
  "freehand_note",
  "fire_perimeter",
  "hotspot",
  "smoke_wind_cone",
  "risk_radius",
  "water_access",
  "evacuation_line",
  "last_known_position",
  "witness_observation",
  "probable_route",
  "search_sector",
  "search_grid",
  "command_point",
  "resource_point",
]);

const privateMapConfidenceSchema = z.enum(["observed_by_owner", "reported_unverified", "speculative"]);
const privateMapScenarioSchema = z.enum(["general", "fire", "sar", "traffic", "weather"]);

const privateMapMeasurementSchema = z
  .object({
    distanceMeters: z.number().nonnegative().optional(),
    areaSquareMeters: z.number().nonnegative().optional(),
    bearingDegrees: z.number().min(0).max(360).optional(),
    radiusMeters: z.number().positive().max(50_000).optional(),
  })
  .strict();
```

Update `privateMapFeatureInputSchema.properties`:

```ts
properties: z.object({
  label: z.string().trim().min(1).max(160),
  note: z.string().trim().max(2000).optional(),
  analysisType: privateMapAnalysisTypeSchema.default("freehand_note"),
  confidence: privateMapConfidenceSchema.default("speculative"),
  scenario: privateMapScenarioSchema.default("general"),
  measurement: privateMapMeasurementSchema.optional(),
  styleKey: z.string().trim().max(40).optional(),
  sourceItemIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
}),
```

Do not allow `provenance` in the schema; the server owns it.

**Step 4: Verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- packages/shared/test/public-transport-schemas.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/test/public-transport-schemas.test.ts
git commit -m "feat: validate public transport map and private tool metadata"
```

### Task 3: Add Entur configuration documentation

**Objective:** Make Entur client identification explicit and non-secret across local and production runtime configuration.

**Files:**
- Modify: `.env.example`
- Modify: `docs/SOURCES.md:18-31`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `ansible-playbook.yml:104-118`
- Modify: `.github/workflows/deploy.yml:19-35`

**Step 1: Add config text**

In `.env.example`, add after `POLITILOGGEN_ENABLED=true`:

```dotenv
# Entur open-data APIs require identifying every request; this is not a secret.
ENTUR_CLIENT_NAME=reidar-nytt-trondheim
ENTUR_CODESPACES=ATB
ENTUR_VEHICLE_BOUNDS=63.30,10.20,63.55,10.65
```

In `ansible-playbook.yml` environment file block, add:

```yaml
          ENTUR_CLIENT_NAME={{ lookup('env', 'NYTT_ENTUR_CLIENT_NAME') | default('reidar-nytt-trondheim', true) }}
          ENTUR_CODESPACES={{ lookup('env', 'NYTT_ENTUR_CODESPACES') | default('ATB', true) }}
          ENTUR_VEHICLE_BOUNDS={{ lookup('env', 'NYTT_ENTUR_VEHICLE_BOUNDS') | default('63.30,10.20,63.55,10.65', true) }}
```

In `.github/workflows/deploy.yml`, add optional variable env entries:

```yaml
      NYTT_ENTUR_CLIENT_NAME: ${{ vars.NYTT_ENTUR_CLIENT_NAME }}
      NYTT_ENTUR_CODESPACES: ${{ vars.NYTT_ENTUR_CODESPACES }}
      NYTT_ENTUR_VEHICLE_BOUNDS: ${{ vars.NYTT_ENTUR_VEHICLE_BOUNDS }}
```

Do not add these to the required secrets list; they have safe defaults.

Add to `docs/SOURCES.md`:

```md
- Entur Vehicle Positions GraphQL (`https://api.entur.io/realtime/v2/vehicles/graphql`) supplies ATB vehicle positions in the Trondheim-region bounds. It is operations-only telemetry, stored in `public_transport_vehicles`, visible as a map layer, and never mirrored to `source_items`, `official_events` or `situations`.
- Entur Journey Planner v3 `situations(codespaces:["ATB"])` supplies official public-transport service alerts. These alerts are stored in `public_transport_service_alerts` and mirrored to `source_items` provider `entur`, kind `official_event`; they are not automatic situation activators in this release.
```

Add to `docs/DEPLOYMENT.md` a short Entur verification subsection with the SQL checks from the final task.

**Step 2: Verify docs/config syntax**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && ruby -ryaml -e "YAML.load_file('.github/workflows/deploy.yml'); YAML.load_file('ansible-playbook.yml'); puts 'yaml ok'"
source ~/.nvm/nvm.sh && nvm use 22 && npm run format:check -- .env.example docs/SOURCES.md docs/DEPLOYMENT.md .github/workflows/deploy.yml ansible-playbook.yml
```

Expected: `yaml ok`; format check passes or reports only files to format.

**Step 3: Commit**

```bash
git add .env.example docs/SOURCES.md docs/DEPLOYMENT.md ansible-playbook.yml .github/workflows/deploy.yml
git commit -m "docs: document Entur public transport configuration"
```

---

## Phase 2: Persistence and worker ingestion

### Task 4: Add public transport tables

**Objective:** Create dedicated PostGIS-backed storage for Entur vehicles and service alerts.

**Files:**
- Modify: `apps/server/src/db/schema.sql:460-490`
- Test: covered by repository SQL tests in following tasks.

**Step 1: Add schema blocks before `source_health`**

```sql
CREATE TABLE IF NOT EXISTS public_transport_vehicles (
  id text PRIMARY KEY,
  source text NOT NULL,
  codespace_id text NOT NULL,
  vehicle_id text NOT NULL,
  mode text NOT NULL,
  line_ref text,
  public_code text,
  line_name text,
  operator_ref text,
  operator_name text,
  last_updated timestamptz NOT NULL,
  expires_at timestamptz,
  geometry geometry(Point, 4326) NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codespace_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS public_transport_vehicles_source_seen_idx
  ON public_transport_vehicles (source, stale, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS public_transport_vehicles_geometry_idx
  ON public_transport_vehicles USING gist (geometry);

CREATE TABLE IF NOT EXISTS public_transport_service_alerts (
  id text PRIMARY KEY,
  source text NOT NULL,
  codespace_id text NOT NULL,
  situation_number text NOT NULL,
  severity text,
  report_type text,
  state text NOT NULL CHECK (state IN ('active', 'expired', 'cancelled')),
  summary text NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  updated_at timestamptz NOT NULL,
  geometry geometry(Geometry, 4326),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codespace_id, situation_number)
);
CREATE INDEX IF NOT EXISTS public_transport_service_alerts_state_idx
  ON public_transport_service_alerts (source, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS public_transport_service_alerts_geometry_idx
  ON public_transport_service_alerts USING gist (geometry);
```

At the bottom add:

```sql
INSERT INTO schema_migrations (version) VALUES ('007_entur_public_transport') ON CONFLICT DO NOTHING;
```

**Step 2: Verify compile gate**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: PASS. SQL execution is verified by deploy migration and repository tests below.

**Step 3: Commit**

```bash
git add apps/server/src/db/schema.sql
git commit -m "feat: add public transport persistence tables"
```

### Task 5: Add repository tests for vehicle lifecycle

**Objective:** Prove Entur vehicle upsert, bounds read and stale lifecycle before implementation.

**Files:**
- Modify: `apps/worker/test/repository.test.ts`
- Modify later: `apps/worker/src/repository.ts`

**Step 1: Add failing tests**

Add a helper:

```ts
function enturVehicle(overrides: Partial<PublicTransportVehicle> = {}): PublicTransportVehicle {
  return {
    id: "entur-vehicle:ATB:8790",
    source: "entur_vehicle_positions",
    codespaceId: "ATB",
    vehicleId: "8790",
    mode: "bus",
    lineRef: "ATB:Line:2_45",
    publicCode: "45",
    lineName: "Sjetnmarka- Tiller- Tillerringen- Sandmoen",
    lastUpdated: "2026-05-31T21:02:50.207Z",
    expiresAt: "2026-05-31T21:17:00.000Z",
    geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
    stale: false,
    ...overrides,
  };
}
```

Add tests asserting:

```ts
await repository.upsertPublicTransportVehicles([enturVehicle()], "2026-05-31T21:03:00.000Z");
expect(String(query.mock.calls[0]?.[0])).toContain("INSERT INTO public_transport_vehicles");
expect(query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["ATB", "8790", "bus"]));

await repository.markMissingPublicTransportVehiclesStale(
  "entur_vehicle_positions",
  ["8790"],
  "2026-05-31T21:20:00.000Z",
);
expect(String(query.mock.calls.at(-1)?.[0])).toContain("UPDATE public_transport_vehicles");
expect(String(query.mock.calls.at(-1)?.[0])).toContain("last_seen_at < $3::timestamptz - interval '5 minutes'");
```

Add a second stale test with a missing vehicle whose `expires_at` is `NULL` and `last_seen_at` is newer than the five-minute cutoff; expected SQL still runs but fixture/assertion documents that the WHERE clause does not immediately stale open-ended vehicles.

Add a read test for bounds:

```ts
query.mockResolvedValueOnce({ rows: [{ payload: enturVehicle(), stale: false }] });
const vehicles = await repository.listPublicTransportVehicles({
  modes: ["bus"],
  bounds: { north: 63.5, south: 63.3, east: 10.6, west: 10.2 },
});
expect(vehicles[0]?.id).toBe("entur-vehicle:ATB:8790");
expect(String(query.mock.calls[0]?.[0])).toContain("ST_MakeEnvelope");
```

**Step 2: Run to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because methods do not exist.

**Step 3: Do not commit red tests alone**

Continue to Task 6 and commit tests + implementation together.

### Task 6: Implement vehicle repository methods

**Objective:** Persist/list/stale Entur vehicle rows idempotently.

**Files:**
- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/repository.test.ts`
- Modify: `apps/server/src/store.ts` (read interface and PgStore read method)

**Step 1: Add repository methods**

In `WorkerRepository`:

```ts
async upsertPublicTransportVehicles(
  vehicles: PublicTransportVehicle[],
  fetchedAt: string,
): Promise<void> {
  for (const vehicle of vehicles) {
    const payloadHash = createHash("sha256").update(JSON.stringify(vehicle)).digest("hex");
    await this.pool.query(
      `INSERT INTO public_transport_vehicles
       (id, source, codespace_id, vehicle_id, mode, line_ref, public_code, line_name,
        operator_ref, operator_name, last_updated, expires_at, geometry, payload,
        payload_hash, last_seen_at, stale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        ST_SetSRID(ST_GeomFromGeoJSON($13),4326),$14,$15,$16,false)
       ON CONFLICT (codespace_id, vehicle_id) DO UPDATE SET
        id=EXCLUDED.id,
        source=EXCLUDED.source,
        mode=EXCLUDED.mode,
        line_ref=EXCLUDED.line_ref,
        public_code=EXCLUDED.public_code,
        line_name=EXCLUDED.line_name,
        operator_ref=EXCLUDED.operator_ref,
        operator_name=EXCLUDED.operator_name,
        last_updated=EXCLUDED.last_updated,
        expires_at=EXCLUDED.expires_at,
        geometry=EXCLUDED.geometry,
        payload=EXCLUDED.payload,
        payload_hash=EXCLUDED.payload_hash,
        last_seen_at=EXCLUDED.last_seen_at,
        stale=false`,
      [
        vehicle.id,
        vehicle.source,
        vehicle.codespaceId,
        vehicle.vehicleId,
        vehicle.mode,
        vehicle.lineRef ?? null,
        vehicle.publicCode ?? null,
        vehicle.lineName ?? null,
        vehicle.operatorRef ?? null,
        vehicle.operatorName ?? null,
        vehicle.lastUpdated,
        vehicle.expiresAt ?? null,
        JSON.stringify(vehicle.geometry),
        vehicle,
        payloadHash,
        fetchedAt,
      ],
    );
  }
}

async markMissingPublicTransportVehiclesStale(
  source: PublicTransportVehicle["source"],
  activeVehicleIds: string[],
  checkedAt: string,
): Promise<number> {
  const result = await this.pool.query(
    `UPDATE public_transport_vehicles
     SET stale=true,
         payload=jsonb_set(payload, '{stale}', 'true'::jsonb, true)
     WHERE source=$1
       AND stale=false
       AND (
         (expires_at IS NOT NULL AND expires_at <= $3::timestamptz)
         OR last_seen_at < $3::timestamptz - interval '5 minutes'
       )
       AND NOT (vehicle_id = ANY($2::text[]))`,
    [source, activeVehicleIds, checkedAt],
  );
  return result.rowCount ?? 0;
}
```

Add `WorkerRepository.listPublicTransportVehicles` so the worker repository test above has a real target. It should apply `modes`, `stale=false` by default and bounds via `ST_MakeEnvelope`, returning `{ ...row.payload, stale: row.stale }`. In `PgStore`, add the same read behavior for the server API in Task 12; do not leave the bounds-read test pointing at a method that only exists in the server store.

**Step 2: Verify tests and import chain**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run build -w @nytt/worker
source ~/.nvm/nvm.sh && nvm use 22 && node -e "import('./apps/worker/dist/repository.js').then(() => console.log('repository import ok'))"
```

Expected: repository tests PASS and `repository import ok`.

**Step 3: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts apps/server/src/store.ts
git commit -m "feat: persist Entur vehicle positions"
```

### Task 7: Add Entur vehicle parser fixture and tests

**Objective:** Normalize Entur GraphQL vehicle positions into map-safe vehicle payloads.

**Files:**
- Create: `apps/worker/test/fixtures/entur-vehicles-atb.json`
- Create: `apps/worker/test/entur-vehicles.test.ts`
- Modify later: `apps/worker/src/enturVehicles.ts`

**Step 1: Add fixture**

Use a minimal scrubbed fixture based on the verified live response:

```json
{
  "data": {
    "vehicles": [
      {
        "vehicleId": "8790",
        "mode": "BUS",
        "line": { "lineRef": "ATB:Line:2_45", "publicCode": "45", "lineName": "Sjetnmarka- Tiller- Tillerringen- Sandmoen" },
        "operator": { "operatorRef": "ATB:Operator:171", "name": "Tide Buss" },
        "originName": "Sandmoen",
        "destinationName": "Hagen",
        "lastUpdated": "2026-05-31T21:02:50.207Z",
        "expiration": "2026-05-31T21:17:00Z",
        "location": { "latitude": 63.3708205, "longitude": 10.4045538 },
        "speed": 0,
        "bearing": 206,
        "delay": 59,
        "inCongestion": null,
        "occupancyStatus": "noData",
        "vehicleStatus": "IN_PROGRESS",
        "monitored": true,
        "monitoredCall": { "stopPointRef": "NSR:Quay:72486", "order": 21, "vehicleAtStop": true },
        "progressBetweenStops": { "linkDistance": 454, "percentage": 100 }
      }
    ]
  }
}
```

**Step 2: Add failing parser tests**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { enturHeaders, parseEnturVehicles } from "../src/enturVehicles.js";

const fixturePath = new URL("./fixtures/entur-vehicles-atb.json", import.meta.url);

describe("Entur vehicle positions", () => {
  it("identifies Entur requests with ET-Client-Name", () => {
    expect(enturHeaders("reidar-nytt-trondheim")).toMatchObject({
      "Content-Type": "application/json",
      "ET-Client-Name": "reidar-nytt-trondheim",
    });
  });

  it("normalizes ATB vehicles into public transport vehicle rows", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturVehicles(payload, { codespaceId: "ATB" });
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({
      id: "entur-vehicle:ATB:8790",
      source: "entur_vehicle_positions",
      codespaceId: "ATB",
      vehicleId: "8790",
      mode: "bus",
      publicCode: "45",
      destinationName: "Hagen",
      delaySeconds: 59,
      geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
      stale: false,
    });
    expect(result.activeVehicleIds).toEqual(["8790"]);
  });

  it("skips vehicles with missing id or invalid coordinates", () => {
    const result = parseEnturVehicles(
      JSON.stringify({ data: { vehicles: [{ vehicleId: "", location: { latitude: 63.4, longitude: 10.4 } }, { vehicleId: "bad", location: { latitude: 200, longitude: 10.4 } }] } }),
      { codespaceId: "ATB" },
    );
    expect(result.vehicles).toEqual([]);
  });
});
```

**Step 3: Run to verify failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/entur-vehicles.test.ts
```

Expected: FAIL because `enturVehicles.ts` does not exist.

### Task 8: Implement Entur vehicle collector module

**Objective:** Fetch and parse Entur vehicle GraphQL responses through a testable seam.

**Files:**
- Create: `apps/worker/src/enturVehicles.ts`
- Modify: `apps/worker/test/entur-vehicles.test.ts`

**Step 1: Implement module**

```ts
import type { PublicTransportVehicle, PublicTransportVehicleMode } from "@nytt/shared";

export const enturVehiclesEndpoint = "https://api.entur.io/realtime/v2/vehicles/graphql";

export interface EnturVehicleBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function enturHeaders(clientName: string): Record<string, string> {
  return { "Content-Type": "application/json", "ET-Client-Name": clientName };
}

function modeFromEntur(value: unknown): PublicTransportVehicleMode {
  switch (String(value ?? "").toUpperCase()) {
    case "BUS": return "bus";
    case "TRAM": return "tram";
    case "RAIL": return "rail";
    case "WATER": return "water";
    case "METRO": return "metro";
    default: return "unknown";
  }
}

function iso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validLatLon(location: { latitude?: unknown; longitude?: unknown } | undefined): { lat: number; lon: number } | undefined {
  const lat = finite(location?.latitude);
  const lon = finite(location?.longitude);
  if (lat === undefined || lon === undefined) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return { lat, lon };
}

export function parseEnturVehicles(
  payload: string,
  options: { codespaceId: string },
): { vehicles: PublicTransportVehicle[]; activeVehicleIds: string[] } {
  const parsed = JSON.parse(payload) as { data?: { vehicles?: Array<Record<string, unknown>> }; errors?: unknown };
  if (parsed.errors) throw new Error(`Entur vehicle GraphQL returned errors: ${JSON.stringify(parsed.errors)}`);
  const vehicles: PublicTransportVehicle[] = [];
  for (const item of parsed.data?.vehicles ?? []) {
    const vehicleId = typeof item.vehicleId === "string" ? item.vehicleId.trim() : "";
    const location = item.location as { latitude?: unknown; longitude?: unknown } | undefined;
    const coordinates = validLatLon(location);
    if (!vehicleId || !coordinates) continue;
    const line = item.line as Record<string, unknown> | undefined;
    const operator = item.operator as Record<string, unknown> | undefined;
    const monitoredCall = item.monitoredCall as Record<string, unknown> | undefined;
    const progress = item.progressBetweenStops as Record<string, unknown> | undefined;
    const lastUpdated = iso(item.lastUpdated) ?? new Date(0).toISOString();
    vehicles.push({
      id: `entur-vehicle:${options.codespaceId}:${vehicleId}`,
      source: "entur_vehicle_positions",
      codespaceId: options.codespaceId,
      vehicleId,
      mode: modeFromEntur(item.mode),
      lineRef: typeof line?.lineRef === "string" ? line.lineRef : undefined,
      publicCode: typeof line?.publicCode === "string" ? line.publicCode : undefined,
      lineName: typeof line?.lineName === "string" ? line.lineName : undefined,
      operatorRef: typeof operator?.operatorRef === "string" ? operator.operatorRef : undefined,
      operatorName: typeof operator?.name === "string" ? operator.name : undefined,
      originName: typeof item.originName === "string" ? item.originName : undefined,
      destinationName: typeof item.destinationName === "string" ? item.destinationName : undefined,
      lastUpdated,
      expiresAt: iso(item.expiration),
      geometry: { type: "Point", coordinates: [coordinates.lon, coordinates.lat] },
      speedMps: finite(item.speed),
      bearing: finite(item.bearing),
      delaySeconds: finite(item.delay),
      inCongestion: typeof item.inCongestion === "boolean" ? item.inCongestion : undefined,
      occupancyStatus: typeof item.occupancyStatus === "string" ? item.occupancyStatus : undefined,
      vehicleStatus: typeof item.vehicleStatus === "string" ? item.vehicleStatus : undefined,
      monitored: typeof item.monitored === "boolean" ? item.monitored : undefined,
      currentStopPointRef: typeof monitoredCall?.stopPointRef === "string" ? monitoredCall.stopPointRef : undefined,
      currentStopOrder: finite(monitoredCall?.order),
      vehicleAtStop: typeof monitoredCall?.vehicleAtStop === "boolean" ? monitoredCall.vehicleAtStop : undefined,
      progressPercent: finite(progress?.percentage),
      stale: false,
    });
  }
  return { vehicles, activeVehicleIds: vehicles.map((vehicle) => vehicle.vehicleId) };
}

export async function fetchEnturVehicles({
  endpoint = enturVehiclesEndpoint,
  clientName,
  codespaceId,
  bounds,
  fetcher = fetch,
}: {
  endpoint?: string;
  clientName: string;
  codespaceId: string;
  bounds: EnturVehicleBounds;
  fetcher?: typeof fetch;
}): Promise<ReturnType<typeof parseEnturVehicles>> {
  const query = `query EnturVehicles($codespaceId: String!, $bounds: BoundingBox) {
    vehicles(codespaceId: $codespaceId, boundingBox: $bounds) {
      vehicleId mode originName destinationName lastUpdated expiration speed bearing delay inCongestion occupancyStatus vehicleStatus monitored
      location { latitude longitude }
      line { lineRef publicCode lineName }
      operator { operatorRef name }
      monitoredCall { stopPointRef order vehicleAtStop }
      progressBetweenStops { percentage }
    }
  }`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: enturHeaders(clientName),
    body: JSON.stringify({ query, variables: { codespaceId, bounds } }),
  });
  if (!response.ok) throw new Error(`Entur vehicle fetch failed ${response.status}`);
  return parseEnturVehicles(await response.text(), { codespaceId });
}
```

**Step 2: Verify pass and live contract manually**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/entur-vehicles.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/worker
```

Expected: PASS.

Optional live smoke test from a local shell:

```bash
curl -sS -X POST 'https://api.entur.io/realtime/v2/vehicles/graphql' \
  -H 'Content-Type: application/json' \
  -H 'ET-Client-Name: reidar-nytt-trondheim' \
  --data '{"query":"query { vehicles(codespaceId: \"ATB\") { vehicleId location { latitude longitude } } }"}'
```

Expected: JSON with `data.vehicles` array. Do not commit live output.

**Step 3: Commit**

```bash
git add apps/worker/src/enturVehicles.ts apps/worker/test/entur-vehicles.test.ts apps/worker/test/fixtures/entur-vehicles-atb.json
git commit -m "feat: collect Entur vehicle positions"
```

### Task 9: Wire vehicle collection into worker with a fast guarded interval

**Objective:** Poll Entur vehicles every 60 seconds without making all other collectors run every minute.

**Files:**
- Modify: `apps/worker/src/index.ts:58-88,701-719`
- Modify: `apps/worker/test/index.test.ts`

**Step 1: Add failing lifecycle tests**

In `apps/worker/test/index.test.ts`, add repository fake methods and test:

```ts
it("collects Entur vehicle positions into telemetry only and writes source health", async () => {
  const repository = {
    upsertPublicTransportVehicles: vi.fn().mockResolvedValue(undefined),
    markMissingPublicTransportVehiclesStale: vi.fn().mockResolvedValue(2),
    setHealth: vi.fn().mockResolvedValue(undefined),
  };
  const collector = vi.fn().mockResolvedValue({
    vehicles: [enturVehicle()],
    activeVehicleIds: ["8790"],
  });

  await collectEnturVehiclesForMap({
    repository: repository as never,
    clientName: "reidar-nytt-trondheim",
    codespaceId: "ATB",
    bounds: { minLat: 63.3, minLon: 10.2, maxLat: 63.55, maxLon: 10.65 },
    nextPollAt: "2026-05-31T21:16:00.000Z",
    now: () => new Date("2026-05-31T21:15:00.000Z"),
    collector,
  });

  expect(repository.upsertPublicTransportVehicles).toHaveBeenCalledWith(expect.any(Array), "2026-05-31T21:15:00.000Z");
  expect(repository.markMissingPublicTransportVehiclesStale).toHaveBeenCalledWith("entur_vehicle_positions", ["8790"], "2026-05-31T21:15:00.000Z");
  expect(repository.setHealth).toHaveBeenCalledWith(expect.objectContaining({ source: "entur_vehicle_positions", state: "ok" }));
});
```

Add a failure-path test asserting `setHealth({ source:"entur_vehicle_positions", state:"degraded" })` and no stale expiry on collector failure.

**Step 2: Run to verify failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/index.test.ts
```

Expected: FAIL because `collectEnturVehiclesForMap` does not exist.

**Step 3: Implement helper and interval**

In `apps/worker/src/index.ts`, import `fetchEnturVehicles` and add:

```ts
function enturBoundsFromEnv(value: string | undefined): EnturVehicleBounds {
  const fallback = { minLat: 63.3, minLon: 10.2, maxLat: 63.55, maxLon: 10.65 };
  if (!value) return fallback;
  const [minLat, minLon, maxLat, maxLon] = value.split(",").map(Number);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return fallback;
  return { minLat: minLat!, minLon: minLon!, maxLat: maxLat!, maxLon: maxLon! };
}

export async function collectEnturVehiclesForMap({
  repository,
  clientName,
  codespaceId,
  bounds,
  nextPollAt,
  now = () => new Date(),
  collector = fetchEnturVehicles,
}: {
  repository: Pick<WorkerRepository, "upsertPublicTransportVehicles" | "markMissingPublicTransportVehiclesStale" | "setHealth">;
  clientName: string;
  codespaceId: string;
  bounds: EnturVehicleBounds;
  nextPollAt: string;
  now?: () => Date;
  collector?: typeof fetchEnturVehicles;
}): Promise<void> {
  const checkedAt = now().toISOString();
  try {
    const result = await collector({ clientName, codespaceId, bounds });
    await repository.upsertPublicTransportVehicles(result.vehicles, checkedAt);
    const staleCount = await repository.markMissingPublicTransportVehiclesStale(
      "entur_vehicle_positions",
      result.activeVehicleIds,
      checkedAt,
    );
    await repository.setHealth({
      source: "entur_vehicle_positions",
      label: "Entur kjøretøyposisjoner",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${result.vehicles.length} ATB-kjøretøy oppdatert (${staleCount} markert stale)`,
    });
  } catch (error) {
    await repository.setHealth({
      source: "entur_vehicle_positions",
      label: "Entur kjøretøyposisjoner",
      state: "degraded",
      lastCheckedAt: checkedAt,
      lastFailureAt: checkedAt,
      nextPollAt,
      detail: `Entur kjøretøyinnhenting feilet: ${String(error)}`,
    });
  }
}
```

In `runWorker`, after `guardedCollectAll`, add a separate guarded fast collector when `!once`:

```ts
const enturClientName = process.env.ENTUR_CLIENT_NAME?.trim() || "reidar-nytt-trondheim";
const enturCodespaceId = (process.env.ENTUR_CODESPACES?.split(",")[0] ?? "ATB").trim() || "ATB";
const enturVehicleBounds = enturBoundsFromEnv(process.env.ENTUR_VEHICLE_BOUNDS);
const enturVehicleIntervalMs = 60 * 1000;
const guardedEnturVehicles = createCollectionGuard(() =>
  collectEnturVehiclesForMap({
    repository,
    clientName: enturClientName,
    codespaceId: enturCodespaceId,
    bounds: enturVehicleBounds,
    nextPollAt: new Date(Date.now() + enturVehicleIntervalMs).toISOString(),
  }),
  () => console.warn("[worker] skipping Entur vehicle tick; previous cycle still running"),
);
```

Call `await guardedEnturVehicles()` once in `runWorker()` before/after `guardedCollectAll()`, and add `setInterval(() => void guardedEnturVehicles().catch(console.error), enturVehicleIntervalMs);` only when `!once`.

**Step 4: Verify pass and import chain**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/index.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run build -w @nytt/worker
source ~/.nvm/nvm.sh && nvm use 22 && node -e "import('./apps/worker/dist/index.js').then(() => console.log('worker import ok'))"
```

Expected: PASS and `worker import ok`.

**Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/test/index.test.ts
git commit -m "feat: poll Entur vehicles on fast worker interval"
```

### Task 10: Add Entur service-alert parser and source-item mirror tests

**Objective:** Normalize Entur Journey Planner situations, preserve raw payload, and classify alerts as official source items without promotion.

**Files:**
- Create: `apps/worker/test/fixtures/entur-service-alerts-atb.json`
- Create: `apps/worker/test/entur-service-alerts.test.ts`
- Modify later: `apps/worker/src/enturServiceAlerts.ts`

**Step 1: Add fixture**

Use the verified response shape with one moved-stop alert, one multi-stop line alert with two quay/stop coordinates, and one unlocated line alert. Keep it minimal. The multi-stop alert is mandatory because the parser must preserve multiple affected coordinates as `MultiPoint`, not silently collapse them to the first stop.

**Step 2: Add failing tests**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseEnturServiceAlerts, enturServiceAlertSourceItemInput } from "../src/enturServiceAlerts.js";

const fixturePath = new URL("./fixtures/entur-service-alerts-atb.json", import.meta.url);

describe("Entur service alerts", () => {
  it("normalizes service alerts with stable identity and affected stop geometry", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturServiceAlerts(payload, { codespaceId: "ATB", receivedAt: "2026-05-31T21:15:00.000Z" });
    expect(result.alerts[0]).toMatchObject({
      id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
      source: "entur_service_alerts",
      situationNumber: "ATB:SituationNumber:24982-stopPoint",
      state: "active",
      summary: "Rota - bussholdeplassen er midlertidig flyttet",
      geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
      affectedStopNames: ["Rota"],
    });
    expect(result.rawAlertsBySituationNumber.get("ATB:SituationNumber:24982-stopPoint")).toBeTruthy();
  });

  it("preserves multiple affected stop coordinates as MultiPoint", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturServiceAlerts(payload, { codespaceId: "ATB", receivedAt: "2026-05-31T21:15:00.000Z" });
    const multiStopAlert = result.alerts.find((alert) => alert.situationNumber === "ATB:SituationNumber:multi-stop-test");
    expect(multiStopAlert?.geometry).toEqual({
      type: "MultiPoint",
      coordinates: [
        [10.3951, 63.4305],
        [10.4046, 63.3708],
      ],
    });
  });

  it("mirrors service alerts to source_items with raw upstream payload", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturServiceAlerts(payload, { codespaceId: "ATB", receivedAt: "2026-05-31T21:15:00.000Z" });
    const alert = result.alerts[0]!;
    const item = enturServiceAlertSourceItemInput(alert, {
      fetchedAt: "2026-05-31T21:15:00.000Z",
      rawAlert: result.rawAlertsBySituationNumber.get(alert.situationNumber)!,
    });

    expect(item).toMatchObject({
      provider: "entur",
      kind: "official_event",
      externalId: alert.situationNumber,
      title: alert.summary,
      reliabilityTier: "official",
      geoHint: alert.geometry,
    });
    expect(item.rawPayload).toEqual(result.rawAlertsBySituationNumber.get(alert.situationNumber));
  });
});
```

**Step 3: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/entur-service-alerts.test.ts
```

Expected: FAIL because module does not exist.

### Task 11: Implement Entur service-alert collector and repository lifecycle

**Objective:** Store alert snapshot rows, mirror source items, and expire disappeared alerts only after successful snapshots.

**Files:**
- Create: `apps/worker/src/enturServiceAlerts.ts`
- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/test/repository.test.ts`
- Modify: `apps/worker/test/index.test.ts`

**Step 1: Implement parser module**

Mirror the vehicle module structure. Key implementation requirements:

```ts
export const enturJourneyPlannerEndpoint = "https://api.entur.io/journey-planner/v3/graphql";

export function parseEnturServiceAlerts(
  payload: string,
  options: { codespaceId: string; receivedAt: string },
): {
  alerts: PublicTransportServiceAlert[];
  activeSituationNumbers: string[];
  rawAlertsBySituationNumber: Map<string, unknown>;
} {
  // Parse data.situations.
  // situationNumber fallback: id.
  // summary/description/advice: first Norwegian/null language value.
  // geometry: collect unique affected quay/stopPlace coordinates with valid lat/lon.
  //   0 coords => undefined, 1 coord => Point, >1 coords => MultiPoint.
  // state: active unless severity/report indicates cancellation; disappearance handles expiry.
}

export function enturServiceAlertSourceItemInput(
  alert: PublicTransportServiceAlert,
  options: { fetchedAt: string; rawAlert: unknown },
): SourceItemInput {
  return {
    id: sourceItemId("entur", "official_event", alert.situationNumber),
    provider: "entur",
    kind: "official_event",
    externalId: alert.situationNumber,
    title: alert.summary,
    summary: alert.description,
    fetchedAt: options.fetchedAt,
    publishedAt: alert.createdAt,
    rawPayload: options.rawAlert,
    normalizedPayload: alert,
    captureHash: sha256(JSON.stringify(["entur", "official_event", alert.situationNumber, alert.version ?? alert.updatedAt])),
    geoHint: alert.geometry,
    reliabilityTier: "official",
  };
}
```

Use local `sha256`/`sourceItemId` helpers as done in `vegvesenTrafficInfo.ts`, do not import private helpers from `store.ts`.

**Step 2: Add repository methods**

Add:

```ts
upsertPublicTransportServiceAlerts(alerts, fetchedAt)
upsertEnturServiceAlertSourceItems(items)
expireMissingPublicTransportServiceAlerts(source, activeSituationNumbers, fetchedAt)
listPublicTransportServiceAlerts(filters)
```

Implement the source-item mirror helper explicitly because `upsertSourceItem` is private and provider-specific helpers are the public repository seam:

```ts
async upsertEnturServiceAlertSourceItems(items: SourceItemInput[]): Promise<void> {
  for (const item of items) {
    if (item.provider !== "entur" || item.kind !== "official_event") {
      throw new Error("upsertEnturServiceAlertSourceItems only accepts Entur official_event items");
    }
  }
  for (const item of items) await this.upsertSourceItem(item);
}
```

`expireMissingPublicTransportServiceAlerts` must update the dedicated table and mirrored `source_items.normalized_payload.state` to `expired`, similar to DATEX official expiry patterns. Do not attempt to call private `upsertSourceItem` from outside `WorkerRepository`.

**Step 3: Wire collection in `collectAll`**

After official source collection and before AI/situation activation, add:

```ts
await collectEnturServiceAlerts({
  repository,
  clientName: process.env.ENTUR_CLIENT_NAME?.trim() || "reidar-nytt-trondheim",
  codespaceIds: (process.env.ENTUR_CODESPACES ?? "ATB").split(",").map((value) => value.trim()).filter(Boolean),
  nextPollAt,
});
```

The helper must call repository methods, convert parser output through `enturServiceAlertSourceItemInput`, call `repository.upsertEnturServiceAlertSourceItems(items)`, expire missing only after successful snapshots, and write source health. Expected upstream fetch/parse failures should be caught inside `collectEnturServiceAlerts` and recorded as degraded `source_health`; unexpected implementation/import errors must not be swallowed by an empty `collectAll` catch.

**Step 4: Add non-promotion regression test**

In worker index tests or clusters tests, assert Entur service alerts are not included in `officialEvents` and do not call `repository.upsertSituation` by themselves. A pragmatic test can spy on `repository.upsertOfficialEvents` and ensure only `met/nve/datex` events are passed; Entur service alerts go through the dedicated repository methods.

**Step 5: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/entur-service-alerts.test.ts apps/worker/test/repository.test.ts apps/worker/test/index.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/worker
source ~/.nvm/nvm.sh && nvm use 22 && npm run build -w @nytt/worker
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/enturServiceAlerts.ts apps/worker/src/repository.ts apps/worker/src/index.ts apps/worker/test/entur-service-alerts.test.ts apps/worker/test/repository.test.ts apps/worker/test/index.test.ts apps/worker/test/fixtures/entur-service-alerts-atb.json
git commit -m "feat: ingest Entur service alerts"
```

---

## Phase 3: Server API and traffic map UI

### Task 12: Add authenticated public transport map API

**Objective:** Serve Entur vehicle and alert overlays through Nytt's authenticated API with bounds/mode filtering.

**Files:**
- Modify: `apps/server/src/store.ts`
- Modify: `apps/server/src/app.ts:10-27,290-367`
- Modify: `apps/server/test/api.test.ts`

**Step 1: Write failing API test**

Add to `apps/server/test/api.test.ts`:

```ts
it("returns bounds-filtered public transport vehicles and alerts", async () => {
  const { app, store } = await testApp();
  vi.spyOn(store, "listPublicTransportVehicles").mockResolvedValue([
    {
      id: "entur-vehicle:ATB:8790",
      source: "entur_vehicle_positions",
      codespaceId: "ATB",
      vehicleId: "8790",
      mode: "bus",
      publicCode: "45",
      destinationName: "Hagen",
      lastUpdated: "2026-05-31T21:02:50.207Z",
      geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
      stale: false,
    },
  ]);
  vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([
    {
      id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "ATB:SituationNumber:24982-stopPoint",
      state: "active",
      summary: "Rota flyttet",
      updatedAt: "2026-05-31T21:00:00.000Z",
      geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
    },
  ]);
  vi.spyOn(store, "listSourceHealth").mockResolvedValue([
    { source: "entur_vehicle_positions", label: "Entur kjøretøyposisjoner", state: "ok", detail: "1" },
    { source: "entur_service_alerts", label: "Entur avvik", state: "ok", detail: "1" },
  ]);

  const agent = request.agent(app);
  await agent.get("/api/session").expect(200);
  const response = await agent
    .get("/api/map/public-transport?modes=bus&includeAlerts=true&north=63.6&south=63.3&east=10.8&west=10.2")
    .expect(200);

  expect(response.body.vehicles).toHaveLength(1);
  expect(response.body.alerts).toHaveLength(1);
  expect(response.body.sources.map((source: SourceHealth) => source.source)).toEqual([
    "entur_vehicle_positions",
    "entur_service_alerts",
  ]);
});
```

**Step 2: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts -t "public transport"
```

Expected: FAIL because route/store methods do not exist.

**Step 3: Implement route and store interface**

Import `publicTransportMapQuerySchema` and add store interface methods:

```ts
listPublicTransportVehicles(filters: { modes?: PublicTransportVehicle["mode"][]; bounds: Bounds }): Promise<PublicTransportVehicle[]>;
listPublicTransportServiceAlerts(filters: { states?: PublicTransportServiceAlert["state"][]; bounds: Bounds }): Promise<PublicTransportServiceAlert[]>;
```

Update both store implementations:

- `MemoryStore.listPublicTransportVehicles()` and `MemoryStore.listPublicTransportServiceAlerts()` return `[]` so the in-memory/dev server still satisfies the `Store` interface.
- `PgStore` implements the real PostGIS queries with mandatory `bounds`, non-stale vehicles, active/default alert state filtering, `geometry IS NOT NULL` for alerts, and `ST_Intersects(...ST_MakeEnvelope(...))` for both tables.

Add Express route. It must always pass bounds to the store: use explicit query bounds when supplied, otherwise the fixed Trondheim-region fallback matching `ENTUR_VEHICLE_BOUNDS`. This prevents accidental unbounded reads and keeps unlocated alerts out of map results.

```ts
const defaultPublicTransportBounds: Bounds = { north: 63.55, south: 63.30, east: 10.65, west: 10.20 };

app.get("/api/map/public-transport", async (req, res, next) => {
  try {
    const query = publicTransportMapQuerySchema.parse(req.query);
    const bounds = typeof query.north === "number" && typeof query.south === "number" && typeof query.east === "number" && typeof query.west === "number"
      ? { north: query.north, south: query.south, east: query.east, west: query.west }
      : defaultPublicTransportBounds;
    const [vehicles, alerts, sourceHealth] = await Promise.all([
      store.listPublicTransportVehicles({ modes: query.modes, bounds }),
      query.includeAlerts === false ? Promise.resolve([]) : store.listPublicTransportServiceAlerts({ states: ["active"], bounds }),
      store.listSourceHealth(),
    ]);
    res.json({
      vehicles,
      alerts,
      sources: sourceHealth.filter((source) => source.source === "entur_vehicle_positions" || source.source === "entur_service_alerts"),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
```

The `PgStore.listPublicTransportServiceAlerts` SQL must include `geometry IS NOT NULL` whenever it serves map results, and with bounds it must use `ST_Intersects(geometry, ST_MakeEnvelope(...))`; unlocated service alerts remain stored/ledger-visible but not map-visible.

**Step 4: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts -t "public transport"
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/server
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/store.ts apps/server/test/api.test.ts
git commit -m "feat: expose Entur public transport map API"
```

### Task 13: Add frontend public transport fetch hook

**Objective:** Fetch public transport map data with the same abort-safe request pattern as `useTrafficMap`.

**Files:**
- Create: `apps/frontend/src/api/publicTransportMap.ts`
- Create: `apps/frontend/src/hooks/usePublicTransportMap.ts`
- Test: pure hook behavior via e2e in later task; typecheck now.

**Step 1: Add API client**

```ts
import type { PublicTransportMapPayload, PublicTransportVehicleMode } from "@nytt/shared";

export interface PublicTransportMapRequest {
  modes?: PublicTransportVehicleMode[];
  includeAlerts?: boolean;
  bounds?: { north: number; south: number; east: number; west: number };
}

export async function fetchPublicTransportMap(
  request: PublicTransportMapRequest = {},
  options: { signal?: AbortSignal } = {},
): Promise<PublicTransportMapPayload> {
  const params = new URLSearchParams();
  if (request.modes?.length) params.set("modes", request.modes.join(","));
  if (request.includeAlerts !== undefined) params.set("includeAlerts", String(request.includeAlerts));
  if (request.bounds) {
    params.set("north", String(request.bounds.north));
    params.set("south", String(request.bounds.south));
    params.set("east", String(request.bounds.east));
    params.set("west", String(request.bounds.west));
  }
  const suffix = params.toString();
  const response = await fetch(`/api/map/public-transport${suffix ? `?${suffix}` : ""}`, {
    credentials: "include",
    signal: options.signal,
  });
  if (response.status === 401) {
    window.location.href = "/auth/github";
    throw new Error("Innlogging kreves");
  }
  if (!response.ok) throw new Error("Kunne ikke hente kollektivtrafikk.");
  return (await response.json()) as PublicTransportMapPayload;
}
```

**Step 2: Add hook**

Copy the `useTrafficMap` request-id + abort pattern and use a 60-second refresh interval. On unmount, increment `requestIdRef.current` before aborting.

**Step 3: Verify typecheck**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/frontend/src/api/publicTransportMap.ts apps/frontend/src/hooks/usePublicTransportMap.ts
git commit -m "feat: add public transport map hook"
```

### Task 14: Render public transport layer on `/trafikk`

**Objective:** Add map toggles and markers for Entur vehicles/service alerts without cluttering road event layers.

**Files:**
- Create: `apps/frontend/src/components/map/PublicTransportLayer.tsx`
- Modify: `apps/frontend/src/components/map/TrafficFilterPanel.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Test: `e2e/app.spec.ts`

**Step 1: Add e2e test first**

In `e2e/app.spec.ts`, route `/api/map/public-transport` and assert toggle/markers:

```ts
test("traffic map can show Entur public transport context", async ({ page }) => {
  await page.route("**/api/map/public-transport**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-05-31T21:15:00.000Z",
        vehicles: [{
          id: "entur-vehicle:ATB:8790",
          source: "entur_vehicle_positions",
          codespaceId: "ATB",
          vehicleId: "8790",
          mode: "bus",
          publicCode: "45",
          destinationName: "Hagen",
          lastUpdated: "2026-05-31T21:02:50.207Z",
          geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
          stale: false,
        }],
        alerts: [{
          id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
          source: "entur_service_alerts",
          codespaceId: "ATB",
          situationNumber: "ATB:SituationNumber:24982-stopPoint",
          state: "active",
          summary: "Rota flyttet",
          updatedAt: "2026-05-31T21:00:00.000Z",
          geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
        }],
        sources: [{ source: "entur_vehicle_positions", label: "Entur kjøretøyposisjoner", state: "ok", detail: "1" }],
      }),
    });
  });
  await page.goto("/trafikk");
  await expect(page.getByText("Kollektivtrafikk")).toBeVisible();
  await page.getByLabel("Vis busser og trikk").check();
  await expect(page.getByText("45 → Hagen")).toBeVisible();
  await expect(page.getByText("Rota flyttet")).toBeVisible();
});
```

**Step 2: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run test:e2e -- e2e/app.spec.ts -g "Entur public transport"
```

Expected: FAIL because UI does not exist.

**Step 3: Implement layer component**

`PublicTransportLayer.tsx` should import `Point` from `geojson`, import `PublicTransportMapPayload` and `PublicTransportServiceAlert`, then render `CircleMarker`/`Marker` for vehicles and alerts, with accessible popups/list text:

```tsx
function pointToLatLng(point: Point): [number, number] | undefined {
  const [lon, lat] = point.coordinates;
  return typeof lon === "number" && typeof lat === "number" ? [lat, lon] : undefined;
}

function alertPositions(alert: PublicTransportServiceAlert): Array<[number, number]> {
  if (!alert.geometry) return [];
  if (alert.geometry.type === "Point") {
    const [lon, lat] = alert.geometry.coordinates;
    return typeof lon === "number" && typeof lat === "number" ? [[lat, lon]] : [];
  }
  return alert.geometry.coordinates.flatMap(([lon, lat]) =>
    typeof lon === "number" && typeof lat === "number" ? ([[lat, lon]] as Array<[number, number]>) : [],
  );
}

export function PublicTransportLayer({ payload, visible }: { payload?: PublicTransportMapPayload; visible: boolean }) {
  if (!visible || !payload) return null;
  return (
    <>
      {payload.vehicles.flatMap((vehicle) => {
        const center = pointToLatLng(vehicle.geometry);
        if (!center) return [];
        return [
          <CircleMarker
            key={vehicle.id}
            center={center}
            radius={vehicle.mode === "bus" ? 5 : 6}
            pathOptions={{ color: vehicle.stale ? "#64748b" : "#7c3aed", fillOpacity: 0.8 }}
          >
            <Popup>
              <strong>{vehicle.publicCode ? `${vehicle.publicCode} → ${vehicle.destinationName ?? "ukjent"}` : vehicle.lineName ?? vehicle.vehicleId}</strong>
              <span>Entur · oppdatert {new Date(vehicle.lastUpdated).toLocaleTimeString("nb-NO")}</span>
            </Popup>
          </CircleMarker>,
        ];
      })}
      {payload.alerts.flatMap((alert) =>
        alertPositions(alert).map((center, index) => (
          <CircleMarker key={`${alert.id}:${index}`} center={center} radius={8} pathOptions={{ color: "#f97316", fillOpacity: 0.65 }}>
            <Popup><strong>{alert.summary}</strong><span>Entur avvik</span></Popup>
          </CircleMarker>
        )),
      )}
    </>
  );
}
```

Also render a sidebar card/list so the e2e test does not depend on Leaflet popup interaction.

**Step 4: Wire toggles**

Add `publicTransport` visibility state in `TrafficMapPage`, call `usePublicTransportMap({ modes:["bus","tram","rail","water"], includeAlerts:true, bounds: stableBounds })`, and add controls to `TrafficFilterPanel`.

**Step 5: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run test:e2e -- e2e/app.spec.ts -g "Entur public transport"
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/frontend/src/components/map/PublicTransportLayer.tsx apps/frontend/src/components/map/TrafficFilterPanel.tsx apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/styles.css e2e/app.spec.ts
git commit -m "feat: show Entur public transport on traffic map"
```

---

## Phase 4: Situation Room map context and private analysis tools

### Task 15: Extend MapFeature metadata safely

**Objective:** Let private annotations carry scenario/tool metadata while server-side provenance remains private.

**Files:**
- Modify: `packages/shared/src/types.ts:81-91`
- Modify: `apps/server/src/app.ts:532-559`
- Modify: `apps/server/src/store.ts:575-585,1305-1318`
- Modify: `apps/frontend/src/api.ts:1-17,119-123`
- Modify: `apps/server/test/api.test.ts:94-105`

**Step 1: Add failing API test**

Extend existing `forces user map drawings into the private layer` test:

```ts
expect(response.body.properties).toMatchObject({
  provenance: "private_annotation",
  analysisType: "last_known_position",
  confidence: "reported_unverified",
  scenario: "sar",
});
expect(response.body.properties.measurement).toEqual({ radiusMeters: 500 });
```

Send those fields in the request body. Then PATCH the created feature label and assert the response still includes `analysisType`, `confidence`, `scenario`, `measurement`, `styleKey` and `sourceItemIds`; this locks the server against dropping typed metadata during edits.

**Step 2: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts -t "private layer"
```

Expected: FAIL until MapFeature properties and route preservation are updated.

**Step 3: Update type and route**

In `MapFeature.properties`, add optional fields:

```ts
analysisType?: "freehand_note" | "fire_perimeter" | "hotspot" | "smoke_wind_cone" | "risk_radius" | "water_access" | "evacuation_line" | "last_known_position" | "witness_observation" | "probable_route" | "search_sector" | "search_grid" | "command_point" | "resource_point";
confidence?: "observed_by_owner" | "reported_unverified" | "speculative";
scenario?: "general" | "fire" | "sar" | "traffic" | "weather";
measurement?: { distanceMeters?: number; areaSquareMeters?: number; bearingDegrees?: number; radiusMeters?: number };
styleKey?: string;
sourceItemIds?: string[];
}

export type PrivateMapFeatureInput = {
  geometry: MapFeature["geometry"];
  properties: Pick<
    MapFeature["properties"],
    "label" | "note" | "analysisType" | "confidence" | "scenario" | "measurement" | "styleKey" | "sourceItemIds"
  >;
};
```

In the POST route, keep spreading schema-validated input properties but overwrite provenance last:

```ts
properties: {
  ...input.properties,
  provenance: "private_annotation",
  updatedAt: new Date().toISOString(),
},
```

This is already the POST pattern; the key is schema now strips client provenance.

In `apps/frontend/src/api.ts`, import `PrivateMapFeatureInput` from `@nytt/shared` and change:

```ts
addFeature: (id: string, feature: PrivateMapFeatureInput) =>
  request<MapFeature>(`${situationPath(id)}/features`, {
    method: "POST",
    body: JSON.stringify({ geometry: feature.geometry, properties: feature.properties }),
  }),
```

In `MemoryStore.updatePrivateFeature`, keep the existing spread/merge behavior. In `PgStore.updatePrivateFeature`, do not replace the whole properties object with only label/note. Fetch/merge via SQL so existing typed metadata survives label edits:

```ts
const patch = { label, note, provenance: "private_annotation", updatedAt: new Date().toISOString() };
const result = await this.pool.query<MapFeature>(
  `UPDATE map_features
   SET properties = properties || $3::jsonb
   WHERE id=$1 AND situation_id=$2 AND provenance='private_annotation'
   RETURNING id, 'Feature' AS type, ST_AsGeoJSON(geometry)::json AS geometry, properties`,
  [featureId, situationId, patch],
);
```

**Step 4: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts -t "private layer"
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts apps/server/src/app.ts apps/server/src/store.ts apps/frontend/src/api.ts apps/server/test/api.test.ts
git commit -m "feat: preserve typed private map analysis metadata"
```

### Task 16: Add pure geospatial map-tool helpers

**Objective:** Compute distance, area, bearing, radius circles and sector polygons for private map tools with deterministic tests.

**Files:**
- Create: `apps/frontend/src/mapTools/geometry.ts`
- Create: `apps/frontend/src/mapTools/geometry.test.ts`

**Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { bearingDegrees, circlePolygon, lineDistanceMeters, pointToLineDistanceMeters, polygonAreaSquareMeters, sectorPolygon } from "./geometry.js";

describe("map tool geometry helpers", () => {
  it("measures a line distance in meters", () => {
    expect(lineDistanceMeters([[10.3951, 63.4305], [10.4051, 63.4305]])).toBeGreaterThan(490);
    expect(lineDistanceMeters([[10.3951, 63.4305], [10.4051, 63.4305]])).toBeLessThan(510);
  });

  it("calculates bearing from west to east", () => {
    expect(bearingDegrees([10.3951, 63.4305], [10.4051, 63.4305])).toBeGreaterThan(85);
    expect(bearingDegrees([10.3951, 63.4305], [10.4051, 63.4305])).toBeLessThan(95);
  });

  it("measures distance to the middle of a line segment, not just vertices", () => {
    const line: Array<[number, number]> = [[10.0, 63.43], [10.8, 63.43]];
    const point: [number, number] = [10.4, 63.431];
    const segmentDistance = pointToLineDistanceMeters(point, line);
    const vertexDistance = Math.min(lineDistanceMeters([point, line[0]!]), lineDistanceMeters([point, line[1]!]));
    expect(segmentDistance).toBeLessThan(150);
    expect(vertexDistance).toBeGreaterThan(19_000);
  });

  it("creates closed circle and sector polygons", () => {
    const circle = circlePolygon([10.3951, 63.4305], 500, 16);
    expect(circle.type).toBe("Polygon");
    expect(circle.coordinates[0][0]).toEqual(circle.coordinates[0].at(-1));
    const sector = sectorPolygon([10.3951, 63.4305], 1000, 45, 135, 8);
    expect(sector.coordinates[0][0]).toEqual([10.3951, 63.4305]);
    expect(sector.coordinates[0].at(-1)).toEqual([10.3951, 63.4305]);
  });

  it("estimates polygon area for a search sector", () => {
    const circle = circlePolygon([10.3951, 63.4305], 1000, 64);
    expect(polygonAreaSquareMeters(circle.coordinates[0])).toBeGreaterThan(2_800_000);
    expect(polygonAreaSquareMeters(circle.coordinates[0])).toBeLessThan(3_400_000);
  });
});
```

**Step 2: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/frontend/src/mapTools/geometry.test.ts
```

Expected: FAIL because helpers do not exist.

**Step 3: Implement helpers**

Use Haversine/destination formulas without adding a dependency:

```ts
import type { Polygon } from "geojson";

const earthRadiusMeters = 6_371_000;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;
export type LonLat = [number, number];

export function distanceMeters(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

export function lineDistanceMeters(coordinates: LonLat[]): number {
  return coordinates.slice(1).reduce((total, point, index) => total + distanceMeters(coordinates[index]!, point), 0);
}

function projectMeters(point: LonLat, origin: LonLat): [number, number] {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.cos(toRad(origin[1])) * 111_320;
  return [(point[0] - origin[0]) * metersPerDegreeLon, (point[1] - origin[1]) * metersPerDegreeLat];
}

function pointToSegmentDistanceMeters(point: LonLat, a: LonLat, b: LonLat): number {
  const [px, py] = projectMeters(point, point);
  const [ax, ay] = projectMeters(a, point);
  const [bx, by] = projectMeters(b, point);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointToLineDistanceMeters(point: LonLat, line: LonLat[]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return distanceMeters(point, line[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < line.length - 1; index += 1) {
    best = Math.min(best, pointToSegmentDistanceMeters(point, line[index]!, line[index + 1]!));
  }
  return best;
}

export function bearingDegrees(a: LonLat, b: LonLat): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destination(center: LonLat, distance: number, bearing: number): LonLat {
  const angularDistance = distance / earthRadiusMeters;
  const brng = toRad(bearing);
  const lat1 = toRad(center[1]);
  const lon1 = toRad(center[0]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return [toDeg(lon2), toDeg(lat2)];
}

export function circlePolygon(center: LonLat, radiusMeters: number, steps = 48): Polygon {
  const ring = Array.from({ length: steps }, (_, index) => destination(center, radiusMeters, (360 * index) / steps));
  ring.push(ring[0]!);
  return { type: "Polygon", coordinates: [ring] };
}

export function sectorPolygon(center: LonLat, radiusMeters: number, startBearing: number, endBearing: number, steps = 16): Polygon {
  const span = ((endBearing - startBearing + 360) % 360) || 360;
  const ring: LonLat[] = [center];
  for (let index = 0; index <= steps; index += 1) ring.push(destination(center, radiusMeters, startBearing + (span * index) / steps));
  ring.push(center);
  return { type: "Polygon", coordinates: [ring] };
}

export function polygonAreaSquareMeters(ring: LonLat[]): number {
  const origin: LonLat = ring[0] ?? [0, 0];
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.cos(toRad(origin[1])) * 111_320;
  const projected: Array<[number, number]> = ring.map(([lon, lat]) => [(lon - origin[0]) * metersPerDegreeLon, (lat - origin[1]) * metersPerDegreeLat]);
  let sum = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const [x1, y1] = projected[index]!;
    const [x2, y2] = projected[index + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}
```

**Step 4: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/frontend/src/mapTools/geometry.test.ts
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/mapTools/geometry.ts apps/frontend/src/mapTools/geometry.test.ts
git commit -m "feat: add situation map geometry helpers"
```

### Task 17: Add fire and SAR private tool presets to SituationMap

**Objective:** Replace generic point/line/area-only drawing with explicit private tools for forest-fire and SAR analysis.

**Files:**
- Create: `apps/frontend/src/mapTools/presets.ts`
- Modify: `apps/frontend/src/components/MapViews.tsx:42-283`
- Modify: `apps/frontend/src/pages/SituationPage.tsx:118-143`
- Modify: `apps/frontend/src/styles.css`
- Test: `e2e/app.spec.ts`

**Step 1: Add e2e test first**

```ts
test("situation map exposes private fire and SAR planning tools", async ({ page }) => {
  await page.goto("/situasjoner/skogbrann-bymarka");
  await expect(page.getByRole("heading", { name: "Kart og berørte områder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brannfront" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hotspot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Røyk/vind" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Risikoring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Evakuering/stengt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sist sett" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vitneobs." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Søksområde" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Søkerute/grid" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ressurs" })).toBeVisible();
  await expect(page.getByText("Private analyser – ikke offentlig verifisert")).toBeVisible();
});
```

**Step 2: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run test:e2e -- e2e/app.spec.ts -g "fire and SAR planning tools"
```

Expected: FAIL because buttons do not exist.

**Step 3: Add presets**

Create `apps/frontend/src/mapTools/presets.ts`:

```ts
import type { MapFeature } from "@nytt/shared";

export interface MapToolPreset {
  id: NonNullable<MapFeature["properties"]["analysisType"]>;
  label: string;
  scenario: NonNullable<MapFeature["properties"]["scenario"]>;
  geometryMode: "point" | "line" | "area" | "circle" | "sector";
  defaultConfidence: NonNullable<MapFeature["properties"]["confidence"]>;
  defaultLabel: string;
  styleKey: string;
}

export const mapToolPresets: MapToolPreset[] = [
  { id: "fire_perimeter", label: "Brannfront", scenario: "fire", geometryMode: "line", defaultConfidence: "reported_unverified", defaultLabel: "Brannfront - privat anslag", styleKey: "fire-front" },
  { id: "hotspot", label: "Hotspot", scenario: "fire", geometryMode: "point", defaultConfidence: "reported_unverified", defaultLabel: "Mulig hotspot", styleKey: "fire-hotspot" },
  { id: "smoke_wind_cone", label: "Røyk/vind", scenario: "fire", geometryMode: "sector", defaultConfidence: "speculative", defaultLabel: "Mulig røyk-/vindretning", styleKey: "smoke-cone" },
  { id: "risk_radius", label: "Risikoring", scenario: "fire", geometryMode: "circle", defaultConfidence: "speculative", defaultLabel: "Mulig risikosone", styleKey: "risk-radius" },
  { id: "water_access", label: "Vann/tilkomst", scenario: "fire", geometryMode: "point", defaultConfidence: "observed_by_owner", defaultLabel: "Vann/tilkomst", styleKey: "resource" },
  { id: "evacuation_line", label: "Evakuering/stengt", scenario: "fire", geometryMode: "line", defaultConfidence: "reported_unverified", defaultLabel: "Evakuering/stengt linje", styleKey: "evacuation-line" },
  { id: "last_known_position", label: "Sist sett", scenario: "sar", geometryMode: "point", defaultConfidence: "reported_unverified", defaultLabel: "Sist sett", styleKey: "last-seen" },
  { id: "witness_observation", label: "Vitneobs.", scenario: "sar", geometryMode: "point", defaultConfidence: "reported_unverified", defaultLabel: "Vitneobservasjon", styleKey: "witness" },
  { id: "probable_route", label: "Mulig rute", scenario: "sar", geometryMode: "line", defaultConfidence: "speculative", defaultLabel: "Mulig rute", styleKey: "sar-route" },
  { id: "search_sector", label: "Søksområde", scenario: "sar", geometryMode: "sector", defaultConfidence: "speculative", defaultLabel: "Søksområde", styleKey: "search-sector" },
  { id: "search_grid", label: "Søkerute/grid", scenario: "sar", geometryMode: "area", defaultConfidence: "speculative", defaultLabel: "Søkerute/grid", styleKey: "search-grid" },
  { id: "command_point", label: "KO", scenario: "sar", geometryMode: "point", defaultConfidence: "observed_by_owner", defaultLabel: "KO", styleKey: "command" },
  { id: "resource_point", label: "Ressurs", scenario: "sar", geometryMode: "point", defaultConfidence: "observed_by_owner", defaultLabel: "Ressurs", styleKey: "resource" },
];
```

**Step 4: Wire SituationMap**

Update `onCreateFeature` signature to accept properties metadata:

```ts
onCreateFeature: (
  geometry: MapFeature["geometry"],
  properties: Pick<MapFeature["properties"], "label" | "note" | "analysisType" | "confidence" | "scenario" | "measurement" | "styleKey">,
) => Promise<void>;
```

In `SituationPage.createFeature`, send those properties to `api.addFeature`; do not set provenance on the client.

Add preset buttons, radius/bearing inputs for circle/sector, and a visible warning:

```tsx
<p className="private-analysis-warning">Private analyser – ikke offentlig verifisert</p>
```

For circle/sector tools, use `circlePolygon`/`sectorPolygon` after a point click and include `measurement.radiusMeters` and `bearingDegrees`.

**Step 5: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run test:e2e -- e2e/app.spec.ts -g "fire and SAR planning tools"
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/frontend/src/mapTools/presets.ts apps/frontend/src/components/MapViews.tsx apps/frontend/src/pages/SituationPage.tsx apps/frontend/src/styles.css e2e/app.spec.ts
git commit -m "feat: add private fire and SAR map tool presets"
```

### Task 18: Add public transport context to Situation Room map

**Objective:** Let a situation map show nearby Entur vehicles/alerts as optional context without linking them as evidence automatically.

**Files:**
- Modify: `apps/frontend/src/components/MapViews.tsx`
- Modify: `apps/frontend/src/pages/SituationPage.tsx`
- Modify: `apps/frontend/src/hooks/usePublicTransportMap.ts`
- Test: `e2e/app.spec.ts`

**Step 1: Add e2e test**

Route `/api/map/public-transport` in a situation page test and assert:

```ts
await expect(page.getByLabel("Kollektivtrafikk-kontekst")).toBeVisible();
await page.getByLabel("Kollektivtrafikk-kontekst").check();
await expect(page.getByText("Entur kjøretøyposisjoner")).toBeVisible();
await expect(page.getByText("Kontekstlag – ikke bevis for aktiv hendelse")).toBeVisible();
```

**Step 2: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run test:e2e -- e2e/app.spec.ts -g "Kollektivtrafikk-kontekst"
```

Expected: FAIL.

**Step 3: Implement context layer**

Use the existing `MapBoundsWatcher` or fixed bounds around situation features. Preferred first implementation: use current Leaflet map bounds after load; fetch public transport only when the layer is enabled.

Add layer control text:

```tsx
<label>
  <input type="checkbox" checked={layers.publicTransport} onChange={...} /> Kollektivtrafikk-kontekst
</label>
<small>Kontekstlag – ikke bevis for aktiv hendelse</small>
```

Render `PublicTransportLayer` with subtle context styling and no source-item linking by default.

**Step 4: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run test:e2e -- e2e/app.spec.ts -g "Kollektivtrafikk-kontekst"
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/components/MapViews.tsx apps/frontend/src/pages/SituationPage.tsx apps/frontend/src/hooks/usePublicTransportMap.ts e2e/app.spec.ts
git commit -m "feat: add Entur context layer to situation maps"
```

### Task 19: Improve export labeling for private analysis layers

**Objective:** Make exported workspace GeoJSON/manifest clearly distinguish private speculation from official/provenance evidence.

**Files:**
- Modify: `apps/server/src/export.ts`
- Modify: `apps/server/test/api.test.ts`

**Step 1: Add failing export test**

Extend the workspace export test to create one private SAR feature, export, inspect ZIP entries or manifest content, and assert text includes:

```text
Private analyser er ikke offentlig verifisert og må ikke leses som operativ sannhet.
```

If ZIP inspection is awkward in existing tests, add a pure test for `buildWorkspaceExport`.

**Step 2: Run failure**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts -t "workspace zip"
```

Expected: FAIL until export includes the warning.

**Step 3: Implement warning**

Add the warning to exported README/manifest and include each feature's `analysisType`, `confidence`, `scenario`, `measurement`, `styleKey` in GeoJSON properties.

**Step 4: Verify**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/server/test/api.test.ts -t "workspace zip"
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck -w @nytt/server
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/export.ts apps/server/test/api.test.ts
git commit -m "feat: label private map analysis in exports"
```

---

## Phase 5: Operations verification and post-implementation audit

### Task 20: Add production verification checks for Entur invariants

**Objective:** Prevent “data exists” from being confused with correct provenance separation.

**Files:**
- Modify: `docs/DEPLOYMENT.md`
- Modify: `ansible-playbook.yml` deployment validation block if present near existing source-health checks.

**Step 1: Add deployment verification commands**

Add to `docs/DEPLOYMENT.md`:

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

Expected:

- Entur source health rows are present; `entur_vehicle_positions` should normally be `ok` with non-zero row count when Entur is reachable.
- `source_items WHERE provider='entur'` can be non-zero for service alerts.
- `accidental_vehicle_source_items` must be zero; this proves vehicle telemetry did not enter `source_items` either under `entur_vehicle_positions` or disguised as `provider='entur'` rows.
- `official_events` for Entur sources must be zero in this plan.
- `accidental_entur_situations` must be zero; this checks `officialSource`, `activationBasis.sourceIds`, and embedded evidence sources, not just one field.

**Step 2: Verify docs format**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run format:check -- docs/DEPLOYMENT.md ansible-playbook.yml
```

Expected: PASS.

**Step 3: Commit**

```bash
git add docs/DEPLOYMENT.md ansible-playbook.yml
git commit -m "docs: add Entur production verification checks"
```

### Task 21: Run full local gate

**Objective:** Verify the full repository after all tasks.

**Files:** none.

**Step 1: Run full gate**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
source ~/.nvm/nvm.sh && nvm use 22 && npm test
source ~/.nvm/nvm.sh && nvm use 22 && npm run lint
source ~/.nvm/nvm.sh && nvm use 22 && npm run format:check
source ~/.nvm/nvm.sh && nvm use 22 && npm run build
source ~/.nvm/nvm.sh && nvm use 22 && npm run test:e2e
```

Expected: all PASS. If formatting fails, run `npm run format`, inspect diffs, commit one mechanical formatting commit, then re-run the failed gate.

**Step 2: Commit any gate fixes**

```bash
git status --short
git add -A
git commit -m "chore: satisfy Entur map gate checks"
```

Only commit if gate fixes changed files.

### Task 22: Post-implementation audit

**Objective:** Audit the implementation beyond test pass/fail, especially provenance and geospatial correctness.

**Files:** read-only unless issues found.

**Step 1: Read audit checklist**

Use Hermes tool action:

```text
skill_view(name="subagent-driven-development", file_path="references/post-implementation-audit.md")
```

**Step 2: Manual audit checklist**

Read every changed file and verify:

- Entur vehicle rows do not call any source-item, official-event or situation upsert path.
- Entur service alerts preserve raw upstream payload in source items.
- Failed Entur fetches never expire prior snapshots.
- Successful alert disappearance expires service alerts and mirrored source items.
- Public transport API requires authenticated session like other `/api` routes.
- Frontend context labels say “context” and private tools say “private/not verified”.
- Geometry calculations use `[lon, lat]` internally and Leaflet receives `[lat, lon]` only at rendering boundary.
- Segment/proximity logic in any added geo helpers is not vertex-only where line/polygon proximity matters.
- CSP `imgSrc/connectSrc` changes are not needed for Entur because frontend calls only same-origin APIs; if external images/tiles are added later, update Helmet explicitly.

**Step 3: Fix audit findings with TDD**

For every bug found, write a failing regression test, watch it fail, implement fix, watch it pass, then rerun the relevant gate.

**Step 4: Final integrated review**

Dispatch a review subagent with:

```text
Review origin/main..HEAD for Entur public transport and Situation Room map-tool implementation. Check source/provenance separation, external feed lifecycle, private annotation security, geospatial correctness, and deployment verification. Return Critical/Important/Minor/Verdict.
```

Fix Critical/Important findings and re-review until approved.

### Task 23: Deploy and verify live production

**Objective:** Deploy only after CI/deploy success for the exact SHA and prove live invariants.

**Files:** none unless fixes required.

**Step 1: Push and watch CI/deploy**

```bash
HEAD_SHA=$(git rev-parse HEAD)
git push origin main
gh run list --branch main --limit 10 --json databaseId,headSha,status,conclusion,workflowName,event,url
```

Watch the CI run whose `headSha` is `$HEAD_SHA` until `status=completed` and `conclusion=success`. Then watch the `Deploy to VPS` workflow_run for the same SHA until it also completes successfully. Do not report success before both are completed successfully.

**Step 2: Verify live site and DB**

```bash
curl -fsS https://nytt.reidar.tech/health
curl -sS -o /tmp/trafikk.html -w '%{http_code}\n' https://nytt.reidar.tech/trafikk
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production ps worker"
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production logs --tail=120 worker"
```

Run the SQL block from Task 20. Expected live invariants:

- `/health` returns `200` with Postgres-backed `status: ok`.
- `/trafikk` returns `200` and built frontend contains public transport UI strings.
- `source_health` has Entur rows.
- `public_transport_vehicles` non-stale count is non-zero when Entur returns ATB vehicles.
- `source_items provider='entur'` may be non-zero for service alerts.
- `source_items provider='entur_vehicle_positions'` is zero.
- `official_events` and `situations` for Entur sources are zero.

**Step 3: Report honestly**

Only after all checks pass, report the actual CI/deploy run IDs and live verification outputs. If Entur upstream is down or returns zero vehicles, report source-health/log evidence and do not claim the layer is live with vehicles.

---

## Future follow-ups deliberately excluded from this plan

1. Entur websocket subscriptions for true real-time vehicle streaming. This should be a separate worker-supervision plan with reconnection/backoff tests.
2. On-demand stop-place departure board around a selected situation feature. Use Journey Planner `nearest`/`stopPlace.estimatedCalls`, cache server-side, and keep it out of persistent telemetry unless product value is proven.
3. NASA FIRMS/EFFIS active-fire ingestion. Requires API key/licensing review, satellite false-positive/stale policies, and very explicit non-promotion rules; should use the external-feed checklist separately.
4. DSB authenticated forest-fire operational resource layers. Not public and not appropriate without explicit credentials/authorization.
5. Automatic situation activation from Entur service alerts. Revisit only after manual linking/UI value is established.

## Plan review checklist before execution

- [ ] Architecture docs were read and runtime dependency chain audited.
- [ ] Entur `ET-Client-Name` is configured and never exposed as a secret requirement.
- [ ] Vehicle telemetry is operations-only: no source item, official event, or situation promotion.
- [ ] Service alerts are ledger-worthy source items with raw payload preserved.
- [ ] Snapshot disappearance and failed-fetch retention are tested separately.
- [ ] Public transport and private tool API routes remain authenticated and CSRF-protected where mutating.
- [ ] Private map tools force server-side `private_annotation` provenance.
- [ ] Map labels clearly separate context, official evidence candidates and private speculation.
- [ ] Geospatial helpers have lon/lat tests and segment-aware proximity tests where relevant.
- [ ] Frontend hooks invalidate request IDs on unmount.
- [ ] Production checks separately count raw telemetry rows, ledger rows, official rows and promoted situations.

## Plan review history

- Draft created 2026-05-31 after reading Nytt architecture/source/deployment docs and live-checking Entur vehicle and service-alert APIs.
- Review pass 1 found blockers around source-item repository seams, MultiPoint service-alert geometry, API boundary separation, stale lifecycle, strict TypeScript narrowing, MemoryStore stubs, private-feature metadata preservation, and empty catch/silent degradation. Patched the plan to address each class.
- Review pass 2 found remaining blockers around strict TS Leaflet coordinates, strict TS projected tuples, missing fire/SAR presets, missing segment-aware proximity tests, and insufficient production non-promotion SQL. Patched the plan with guarded helpers, complete presets, segment-distance tests, and stronger DB invariants.
- Final blocking-only re-review returned: no blocking issues.
