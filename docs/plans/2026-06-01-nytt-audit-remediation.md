# Nytt Audit Remediation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Remediate the read-only audit findings for Nytt Trondheim: deployment rollback safety, production session-secret fail-closed behavior, external-link safety, DATEX/Entur freshness correctness, workspace 404 semantics, worker/source-health validation, and the Weather filter e2e drift.

**Architecture:** Preserve the existing boundaries: `frontend` renders authenticated owner UI, `server` owns auth/API/persistence, `worker` is the only ingestion process, and `shared` owns API-safe contracts. Keep telemetry/context feeds out of incident promotion unless the architecture docs explicitly allow it. Fix high-risk deployment automation first, then security input validation, then feed lifecycle correctness, then workspace semantics and UI test drift.

**Tech Stack:** TypeScript, Node 22 via nvm, React/Vite, Express, PostgreSQL/PostGIS, Vitest, Playwright, Docker Compose, Ansible, GitHub Actions.

---

## Context and audit evidence

Docs read before writing this plan:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/SOURCES.md`
- `docs/DEPLOYMENT.md`
- `docs/plans/2026-05-28-datex-travel-time-traffic-pulse.md`
- `docs/plans/2026-05-31-entur-public-transport-situation-map-tools.md`
- Hermes skill reference: `/Users/reidar/.hermes/skills/software-development/writing-plans/references/external-feed-ingestion-plan-checklist.md`
- Hermes skill reference: `/Users/reidar/.hermes/skills/software-development/writing-plans/references/external-feed-map-plan-review-blockers.md`
- Hermes skill reference: `/Users/reidar/.hermes/skills/software-development/code-review/references/deployment-availability-review.md`

Checklist summary applied from the Hermes skill references:

- Feed identity/lifecycle: do not infer active state from stale ledger rows; successful snapshots may expire missing items, failed snapshots must not.
- Feed promotion boundaries: TravelTime, weather, CCTV, counters and vehicles remain operations-only/context-only; service alerts stay stored/ledger-visible but do not activate situations in this plan.
- Map/API boundaries: map responses must be bounded and must not convert unlocated or stale ledger records into active map overlays.
- Deployment availability: old production must either stay live until proven candidate promotion or failed candidate validation must trigger explicit rollback/restart of previous images.

Audit findings to fix:

1. Failed post-promotion production validation leaves candidate containers live.
2. Database migrations run before canary, so canary failure can leave old production on a changed schema.
3. RSS/feed article URLs are rendered without `http:`/`https:` scheme validation.
4. Production can boot with `development-only-session-secret`.
5. DATEX credentialed endpoint overrides can send Basic Auth to arbitrary hosts.
6. Future Entur service alerts are query-visible as active.
7. DATEX TravelTime rows without `measurementTo` do not stale out from `updated_at`.
8. DATEX source-item fallback can resurrect stale/expired source items as active traffic-map events.
9. Workspace create endpoints do not explicitly 404 missing situations.
10. Worker/DATEX deployment verification is too weak.
11. Playwright e2e expects `Vær` as a home category button, but current UI renders it as a `/vaer` link.

Current verified gates before this plan:

```text
npm ci --ignore-scripts                         PASS
npm run typecheck                              PASS
npm run lint                                   PASS
npm run format:check                           PASS
npm test                                       PASS (37 files, 239 tests)
npm run build                                  PASS
npm audit --omit=dev --audit-level=high        PASS (0 vulnerabilities)
npm run test:e2e                               FAIL (4 Weather-filter button drift failures)
```

## Architecture and runtime dependency audit

Runtime heartbeat chains touched by this plan:

```text
server startup
  apps/server/src/config.ts -> apps/server/src/auth.ts -> express-session cookie integrity

owner API
  apps/server/src/app.ts -> Store interface -> MemoryStore/PgStore -> workspace task/note/feature rows

worker ingestion
  apps/worker/src/index.ts -> collectors/datex/entur modules -> WorkerRepository -> source_health + feed tables

traffic map
  apps/server/src/app.ts -> PgStore listTrafficMapEvents/listSourceItems/listOfficialEvents -> frontend map layers

deployment
  GitHub CI success -> ansible-playbook.yml -> Docker image tag/build -> DB migration -> canary -> app/worker promotion -> production validation

frontend links
  Article/source payloads from worker/server -> React anchor hrefs -> browser navigation
```

Silent-degradation risks and defenses:

- `worker` collector failures often surface only through `source_health`; every worker/feed task below includes a narrow unit test and a build/typecheck command.
- Deployment failures after promotion are loud in Ansible but silent from a user availability perspective; deployment tasks must add rescue rollback tests before editing the playbook.
- `source_items` and `traffic_map_events` have different provenance meanings. Tasks touching DATEX fallback must not route telemetry or stale source ledger rows into active map state.
- The frontend can render unsafe external navigation without type errors. Link tasks must add helper-level tests plus update every direct article/source URL anchor found by grep.
- `MemoryStore` and `PgStore` must stay behaviorally aligned; workspace 404 tasks must update route guards rather than relying on one store's FK behavior.

## Product and safety rules

- Do not expose DATEX credentials to frontend, logs, fixtures, screenshots, exported workspaces, or docs.
- DATEX TravelTime, DATEX Weather, DATEX CCTV, Trafikkdata counters and Entur vehicles remain operations-only/context-only telemetry.
- Entur service alerts remain stored/ledger-visible but are not automatic `official_events` or `situations` in this plan.
- `source_items` is a provenance ledger, not a fallback active-state source for expired DATEX events.
- User-created map features remain `private_annotation`; this plan must not loosen provenance validation.
- All code changes use TDD: failing test first, verify failure, minimal implementation, verify pass.
- Use Node 22 for all commands:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
```

---

### Task 1: Add production session-secret fail-closed tests

**Objective:** Prove production config refuses to boot without a strong `SESSION_SECRET`.

**Files:**

- Create: `apps/server/test/config.test.ts`
- Modify later: `apps/server/src/config.ts:19-35`

**Step 1: Write failing tests**

Create `apps/server/test/config.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalEnv = { ...process.env };

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  process.env = { ...originalEnv };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    process.env = { ...originalEnv };
  }
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig session secret policy", () => {
  it("keeps a development-only fallback outside production", () => {
    withEnv({ NODE_ENV: "development", SESSION_SECRET: undefined }, () => {
      expect(loadConfig().sessionSecret).toBe("development-only-session-secret");
    });
  });

  it("requires SESSION_SECRET in production", () => {
    withEnv({ NODE_ENV: "production", SESSION_SECRET: undefined }, () => {
      expect(() => loadConfig()).toThrow(/SESSION_SECRET is required in production/);
    });
  });

  it("requires a high-entropy SESSION_SECRET in production", () => {
    withEnv({ NODE_ENV: "production", SESSION_SECRET: "short" }, () => {
      expect(() => loadConfig()).toThrow(/SESSION_SECRET must be at least 32 characters/);
    });
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/config.test.ts
```

Expected: FAIL because production currently falls back to `development-only-session-secret` and accepts short secrets.

**Step 3: Commit failing test only**

Do not commit yet if the repository policy does not allow red tests. Otherwise use:

```bash
git add apps/server/test/config.test.ts
git commit -m "test: cover production session secret policy"
```

---

### Task 2: Implement production session-secret validation

**Objective:** Make production startup fail closed when `SESSION_SECRET` is missing or weak.

**Files:**

- Modify: `apps/server/src/config.ts:19-35`
- Test: `apps/server/test/config.test.ts`

**Step 1: Implement minimal helper**

In `apps/server/src/config.ts`, add above `loadConfig()`:

```ts
function sessionSecretForEnvironment(nodeEnv: string): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (nodeEnv !== "production") return configured || "development-only-session-secret";
  if (!configured) throw new Error("SESSION_SECRET is required in production");
  if (configured.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }
  return configured;
}
```

Change the returned config field:

```ts
sessionSecret: sessionSecretForEnvironment(nodeEnv),
```

**Step 2: Run targeted tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/config.test.ts apps/server/test/api.test.ts
```

Expected: PASS.

**Step 3: Run typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server/src/config.ts apps/server/test/config.test.ts
git commit -m "fix: require production session secret"
```

---

### Task 3: Create a shared frontend safe external URL helper

**Objective:** Centralize `http:`/`https:` validation for all external anchors.

**Files:**

- Create: `apps/frontend/src/safeExternalUrl.ts`
- Create: `apps/frontend/src/safeExternalUrl.test.ts`
- Modify later: `apps/frontend/src/pages/SituationPage.tsx:18-26`

**Step 1: Write failing helper tests**

Create `apps/frontend/src/safeExternalUrl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./safeExternalUrl.js";

describe("safeExternalUrl", () => {
  it("allows http and https URLs", () => {
    expect(safeExternalUrl("https://example.test/a?b=1")).toBe("https://example.test/a?b=1");
    expect(safeExternalUrl("http://example.test/a")).toBe("http://example.test/a");
  });

  it("rejects browser-executable or local schemes", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalUrl("file:///etc/passwd")).toBeUndefined();
  });

  it("rejects malformed or blank values", () => {
    expect(safeExternalUrl("not a url")).toBeUndefined();
    expect(safeExternalUrl("   ")).toBeUndefined();
    expect(safeExternalUrl(undefined)).toBeUndefined();
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/safeExternalUrl.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement helper**

Create `apps/frontend/src/safeExternalUrl.ts`:

```ts
export function safeExternalUrl(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
```

**Step 4: Run targeted tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/safeExternalUrl.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/safeExternalUrl.ts apps/frontend/src/safeExternalUrl.test.ts
git commit -m "feat: add safe external URL helper"
```

---

### Task 4: Use safeExternalUrl on all frontend external-link surfaces

**Objective:** Prevent feed/source-controlled non-http(s) URLs from being rendered as clickable anchors.

**Files:**

- Modify: `apps/frontend/src/pages/HomePage.tsx:116,140,184`
- Modify: `apps/frontend/src/pages/SavedPage.tsx:63`
- Modify: `apps/frontend/src/components/map/TrafficLayer.tsx:120,130`
- Modify: `apps/frontend/src/components/map/RoadContextLayer.tsx:107`
- Modify: `apps/frontend/src/pages/SituationPage.tsx:18-26`
- Test: `apps/frontend/src/safeExternalUrl.test.ts`

**Step 1: Replace local helper in SituationPage**

In `apps/frontend/src/pages/SituationPage.tsx`:

```ts
import { safeExternalUrl } from "../safeExternalUrl.js";
```

Delete the local `safeExternalUrl` function at lines 18-26.

**Step 2: Guard article links in HomePage**

Use local variables before each anchor. Example for `LeadArticle`:

```tsx
const articleUrl = safeExternalUrl(article.url);
```

Render only when safe:

<!-- prettier-ignore -->
```tsx
{articleUrl ? (
  <a href={articleUrl} target="_blank" rel="noreferrer noopener">
    Les mer <ArrowIcon />
  </a>
) : null}
```

Apply the same pattern to the other `article.url` anchors in `HomePage.tsx`.

**Step 3: Guard links in SavedPage and map layers**

Use `safeExternalUrl(article.url)`, `safeExternalUrl(event.sourceUrl)`, and `safeExternalUrl(camera.sourceUrl)` before rendering anchors. Use `rel="noreferrer noopener"` for every external anchor.

**Step 4: Grep for remaining unsafe direct anchors**

Run:

```bash
search_files pattern='href=\{.*url\}|href=\{.*sourceUrl\}' target='content' path='apps/frontend/src' file_glob='*.tsx'
```

Expected: Any remaining matches are either already wrapped by `safeExternalUrl(...)` or intentionally internal `Link` components. If this command is run outside Hermes tools, use `rg 'href=\{.*url\}|href=\{.*sourceUrl\}' apps/frontend/src -g '*.tsx'`.

**Step 5: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/safeExternalUrl.test.ts && npm run typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/frontend/src
git commit -m "fix: guard frontend external links"
```

---

### Task 5: Reject unsafe RSS article URLs at ingestion

**Objective:** Prevent dangerous article URLs from being persisted, not only hidden at render time.

**Files:**

- Modify: `apps/worker/test/collectors.test.ts:39-95`
- Modify: `apps/worker/src/collectors.ts:56-88`

**Step 1: Write failing ingestion tests**

Add to `describe("RSS collection policy", ...)` in `apps/worker/test/collectors.test.ts`:

```ts
it("rejects non-http article URLs from feeds", async () => {
  const unsafeRss = `<?xml version="1.0"?><rss><channel>
    <item><title>Brann i Trondheim sentrum</title><description>Nødetatene er varslet.</description>
    <link>javascript:alert(1)</link><pubDate>Tue, 26 May 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const articles = await collectRss(
    { id: "nrk", label: "NRK Trøndelag", url: "https://example.test/rss" },
    async () => new Response(unsafeRss, { status: 200 }),
  );

  expect(articles).toEqual([]);
});

it("canonicalUrl allows only http and https schemes", () => {
  expect(canonicalUrl("https://example.test/news?utm_source=rss&id=3#top")).toBe(
    "https://example.test/news?id=3",
  );
  expect(() => canonicalUrl("javascript:alert(1)")).toThrow(/http or https/);
  expect(() => canonicalUrl("data:text/html,hello")).toThrow(/http or https/);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/collectors.test.ts
```

Expected: FAIL because `canonicalUrl` accepts non-http(s), or because collectRss throws instead of skipping.

**Step 3: Implement minimal validation**

In `apps/worker/src/collectors.ts`, update `canonicalUrl`:

```ts
export function canonicalUrl(rawUrl: string, base?: string): string {
  const url = new URL(rawUrl, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Article URL must use http or https");
  }
  url.hash = "";
  for (const parameter of [...url.searchParams.keys()]) {
    if (parameter.startsWith("utm_") || parameter === "fbclid") {
      url.searchParams.delete(parameter);
    }
  }
  return url.toString();
}
```

In `collectRss`, wrap canonicalization so one bad item does not fail the whole feed:

```ts
let url: string;
try {
  url = canonicalUrl(link);
} catch {
  return [];
}
```

**Step 4: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/collectors.test.ts && npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/collectors.ts apps/worker/test/collectors.test.ts
git commit -m "fix: reject unsafe feed article URLs"
```

---

### Task 6: Add DATEX credentialed endpoint allowlist tests

**Objective:** Prove DATEX Basic Auth is only sent to HTTPS Vegvesen endpoints.

**Files:**

- Modify: `apps/worker/test/index.test.ts:106-112`
- Modify later: `apps/worker/src/datex.ts:12-20`
- Modify later: `apps/worker/src/index.ts:713-726`

**Step 1: Write failing endpoint tests**

In `apps/worker/test/index.test.ts`, extend the DATEX endpoint tests:

```ts
it("rejects non-HTTPS DATEX situation endpoints", () => {
  expect(() =>
    normalizeDatexSituationEndpoint(
      "http://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata",
    ),
  ).toThrow(/must use https/);
});

it("rejects non-Vegvesen DATEX situation endpoints before credentials are sent", () => {
  expect(() =>
    normalizeDatexSituationEndpoint(
      "https://attacker.example.test/datexapi/GetSituation/pullsnapshotdata",
    ),
  ).toThrow(/must use an allowed Vegvesen host/);
});
```

Also add tests for generic credentialed DATEX overrides once the helper exists:

```ts
import { normalizeDatexCredentialedEndpoint } from "../src/datex.js";

it("normalizes only allowed credentialed DATEX override endpoints", () => {
  expect(
    normalizeDatexCredentialedEndpoint(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetTravelTimeData/pullsnapshotdata",
      "DATEX_TRAVEL_TIME_DATA_ENDPOINT",
    ),
  ).toContain("atlas.vegvesen.no");
  expect(() =>
    normalizeDatexCredentialedEndpoint(
      "https://evil.example.test/datex",
      "DATEX_TRAVEL_TIME_DATA_ENDPOINT",
    ),
  ).toThrow(/allowed Vegvesen host/);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/index.test.ts
```

Expected: FAIL because non-HTTPS/non-Vegvesen endpoints are currently accepted and the generic helper does not exist.

---

### Task 7: Implement DATEX endpoint validation and wire every credentialed fetch

**Objective:** Ensure all DATEX Basic Auth fetches use only HTTPS Vegvesen endpoints.

**Files:**

- Modify: `apps/worker/src/datex.ts:9-20`
- Modify: `apps/worker/src/index.ts:713-726`
- Test: `apps/worker/test/index.test.ts`

**Step 1: Implement helper in datex.ts**

Add to `apps/worker/src/datex.ts`:

```ts
const allowedDatexCredentialHosts = new Set(["datex-server-get-v3-1.atlas.vegvesen.no"]);

export function normalizeDatexCredentialedEndpoint(
  endpoint: string,
  envName = "DATEX_ENDPOINT",
): string {
  const trimmed = endpoint.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${envName} must be an absolute URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${envName} must use https`);
  if (url.username || url.password) throw new Error(`${envName} must not include URL credentials`);
  if (!allowedDatexCredentialHosts.has(url.hostname)) {
    throw new Error(`${envName} must use an allowed Vegvesen host`);
  }
  return url.toString();
}
```

Update `normalizeDatexSituationEndpoint`:

```ts
export function normalizeDatexSituationEndpoint(endpoint: string): string {
  const normalized = normalizeDatexCredentialedEndpoint(endpoint, "DATEX_ENDPOINT");
  const url = new URL(normalized);
  url.searchParams.set("srti", "True");
  return url.toString();
}
```

**Step 2: Validate all DATEX override endpoints in index.ts**

Where `datexTravelTimeLocationsEndpoint`, `datexTravelTimeDataEndpoint`, `datexWeatherSitesEndpoint`, `datexWeatherMeasurementsEndpoint`, `datexCctvSitesEndpoint`, and `datexCctvStatusEndpoint` are read from env, wrap each resolved value:

```ts
const datexTravelTimeLocationsEndpoint = normalizeDatexCredentialedEndpoint(
  process.env.DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT?.trim() ||
    defaultDatexTravelTimeLocationsEndpoint,
  "DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT",
);
```

Repeat for each credentialed endpoint name. Do not apply this helper to non-DATEX/non-credentialed sources.

**Step 3: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/index.test.ts apps/worker/test/collectors.test.ts && npm run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/src/index.ts apps/worker/test/index.test.ts
git commit -m "fix: restrict DATEX credential endpoints"
```

---

### Task 8: Exclude future Entur service alerts from active map queries

**Objective:** Keep future `validFrom` alerts stored/ledger-visible but out of active map payloads until they start.

**Files:**

- Modify: `apps/server/test/api.test.ts:1039-1077`
- Modify: `apps/worker/test/repository.test.ts:925-940`
- Modify later: `apps/server/src/store.ts:1041-1077`
- Modify later: `apps/worker/src/repository.ts:594-630`

**Step 1: Write failing PgStore SQL test**

In `apps/server/test/api.test.ts`, extend `PgStore keeps line-only active public transport alerts eligible...` or add a new test:

```ts
it("PgStore excludes future public transport alerts from active map queries", async () => {
  let capturedSql = "";
  const fakePool = {
    async query(sql: string) {
      capturedSql = sql.replace(/\s+/g, " ").trim();
      return { rows: [] };
    },
  };
  const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

  await store.listPublicTransportServiceAlerts({
    states: ["active"],
    bounds: { north: 63.6, south: 63.3, east: 10.8, west: 10.2 },
  });

  expect(capturedSql).toContain("(valid_from IS NULL OR valid_from <= now())");
});
```

**Step 2: Write failing WorkerRepository SQL test**

In `apps/worker/test/repository.test.ts`, add near existing public-transport repository tests:

```ts
it("excludes future public transport service alerts from worker active map reads", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const repository = new WorkerRepository({ query } as unknown as pg.Pool);

  await repository.listPublicTransportServiceAlerts({
    states: ["active"],
    bounds: { north: 63.6, south: 63.3, east: 10.8, west: 10.2 },
  });

  const sql = String(query.mock.calls[0]?.[0]).replace(/\s+/g, " ");
  expect(sql).toContain("(valid_from IS NULL OR valid_from <= now())");
});
```

**Step 3: Run tests to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/api.test.ts apps/worker/test/repository.test.ts
```

Expected: FAIL because queries only check `valid_to` and state.

**Step 4: Implement query filters**

In both `PgStore.listPublicTransportServiceAlerts` and `WorkerRepository.listPublicTransportServiceAlerts`, change:

```ts
const where = ["(valid_to IS NULL OR valid_to >= now())"];
```

to:

```ts
const where = [
  "(valid_to IS NULL OR valid_to >= now())",
  "(valid_from IS NULL OR valid_from <= now())",
];
```

Do not change parser state to a new enum value in this task; shared `PublicTransportAlertState` has no `planned` value and map-read filtering is enough for this bug.

**Step 5: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/api.test.ts apps/worker/test/repository.test.ts && npm run typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/store.ts apps/server/test/api.test.ts apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "fix: hide future Entur alerts from active maps"
```

---

### Task 9: Add DATEX TravelTime stale fallback tests using updated_at

**Objective:** Prove stale overlay uses `updated_at` when `measurementTo` is missing.

**Files:**

- Modify: `apps/worker/test/repository.test.ts:313-411`
- Modify: `apps/server/test/api.test.ts:1147-1230`
- Modify later: `apps/worker/src/repository.ts:791-803,961-980`
- Modify later: `apps/server/src/store.ts:1567-1581`

**Step 1: Add WorkerRepository failing test**

In `apps/worker/test/repository.test.ts`:

```ts
it("overlays DATEX travel time stale state from updated_at when measurementTo is missing", async () => {
  const openEnded: TrafficPulseCorridor = {
    ...travelTimeCorridor({
      id: "e6-open-ended",
      name: "E6 open ended",
      state: "slow",
    }),
    measurementTo: undefined,
  };
  const query = vi.fn().mockResolvedValue({
    rows: [
      {
        payload: openEnded,
        measurement_to: null,
        updated_at: new Date("2026-05-28T09:39:59.000Z"),
      },
    ],
  });
  const repository = new WorkerRepository({ query } as unknown as pg.Pool);

  await expect(repository.datexTravelTimes(new Date("2026-05-28T10:00:00.000Z"))).resolves.toEqual([
    { ...openEnded, state: "stale" },
  ]);

  expect(String(query.mock.calls[0]?.[0])).toContain("updated_at");
});
```

**Step 2: Add PgStore/server failing test**

In `apps/server/test/api.test.ts`, near the traffic pulse PgStore test, add the same expectation for `PgStore.listTrafficPulseCorridors()`:

```ts
it("PgStore overlays DATEX traffic pulse stale state from updated_at fallback", async () => {
  const corridor: TrafficPulseCorridor = {
    id: "e6-open-ended",
    name: "E6 open ended",
    state: "slow",
    updatedAt: "2026-05-28T09:39:59.000Z",
    sourceUrl: "https://example.test/datex/travel-time/e6-open-ended",
  };
  const fakePool = {
    async query(sql: string) {
      expect(sql).toContain("updated_at");
      return {
        rows: [
          {
            payload: corridor,
            measurementTo: null,
            updatedAt: new Date("2026-05-28T09:39:59.000Z"),
          },
        ],
      };
    },
  };
  const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

  await expect(store.listTrafficPulseCorridors()).resolves.toEqual([
    { ...corridor, state: "stale" },
  ]);
});
```

**Step 3: Run tests to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts apps/server/test/api.test.ts
```

Expected: FAIL because updated_at is not selected or considered.

---

### Task 10: Implement DATEX TravelTime updated_at stale fallback

**Objective:** Use `measurement_to ?? payload.measurementTo ?? updated_at ?? payload.updatedAt` for stale overlay.

**Files:**

- Modify: `apps/worker/src/repository.ts:791-803,961-980`
- Modify: `apps/server/src/store.ts:302-311,1567-1581`
- Test: `apps/worker/test/repository.test.ts`
- Test: `apps/server/test/api.test.ts`

**Step 1: Update WorkerRepository row shape and SQL**

In `apps/worker/src/repository.ts`, select `updated_at`:

```ts
const result = await this.pool.query<{
  payload: TrafficPulseCorridor;
  measurement_to: Date | string | null;
  updated_at: Date | string | null;
}>(
  `SELECT payload, measurement_to, updated_at
   FROM datex_travel_times
   ORDER BY delay_seconds DESC NULLS LAST, name ASC`,
);
```

Update the stale helper signature:

```ts
function isStaleDatexTravelTime(
  corridor: TrafficPulseCorridor,
  measurementToColumn: Date | string | null,
  updatedAtColumn: Date | string | null,
  now: Date,
): boolean {
  const staleBefore = now.getTime() - datexTravelTimeStaleAfterMs;
  return (
    isOldDatexMeasurementTo(measurementToColumn, staleBefore) ||
    isOldDatexMeasurementTo(corridor.measurementTo, staleBefore) ||
    (!measurementToColumn &&
      !corridor.measurementTo &&
      (isOldDatexMeasurementTo(updatedAtColumn, staleBefore) ||
        isOldDatexMeasurementTo(corridor.updatedAt, staleBefore)))
  );
}
```

Call it with `row.updated_at`.

**Step 2: Update PgStore selection and overlay helper**

In `apps/server/src/store.ts`, include updatedAt:

```ts
const result = await this.pool.query<{
  payload: TrafficPulseCorridor;
  measurementTo?: Date | string | null;
  updatedAt?: Date | string | null;
}>(
  `SELECT payload, measurement_to AS "measurementTo", updated_at AS "updatedAt"
   FROM datex_travel_times
   ORDER BY delay_seconds DESC NULLS LAST, name ASC
   LIMIT $1`,
  [limit],
);
```

Update `withTrafficPulseStaleOverlay` to accept `updatedAt` and apply the same fallback when no measurement timestamp exists.

**Step 3: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/worker/test/repository.test.ts apps/server/test/api.test.ts && npm run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts apps/server/src/store.ts apps/server/test/api.test.ts
git commit -m "fix: stale DATEX travel time without measurement end"
```

---

### Task 11: Add a regression test that DATEX source_items do not become active map events

**Objective:** Prove source ledger rows cannot resurrect stale/expired DATEX traffic as active events.

**Files:**

- Modify: `apps/server/test/api.test.ts:531-625`
- Modify later: `apps/server/src/app.ts:348-354`
- Possibly modify: `apps/server/src/traffic/datex-normalizer.ts:100-120`

**Step 1: Write failing API test**

In `apps/server/test/api.test.ts`, add after the dedicated `traffic_map_events` test:

```ts
it("does not fall back from DATEX source_items into active traffic map events", async () => {
  const { app, store } = await testApp();
  vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
  vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
  vi.spyOn(store, "listSourceItems").mockResolvedValue({
    items: [
      {
        id: "datex-source-expired",
        provider: "datex",
        kind: "official_event",
        externalId: "expired-accident",
        title: "Gammel ulykke på E6",
        summary: "Skal ikke vises som aktiv fordi source_items er ledger, ikke state table.",
        originalUrl: "https://example.test/datex/expired-accident",
        publishedAt: "2026-05-28T08:00:00.000Z",
        fetchedAt: "2026-05-28T08:00:00.000Z",
        captureHash: "sha256:test-expired-datex-source-item",
        geoHint: { type: "Point", coordinates: [10.39, 63.39] },
        reliabilityTier: "official",
        linkedSituationIds: [],
      },
    ],
  });
  vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });
  vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([]);
  vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue([]);
  vi.spyOn(store, "listRoadCameras").mockResolvedValue([]);
  vi.spyOn(store, "listTrafficCounterSnapshots").mockResolvedValue([]);
  vi.spyOn(store, "listSourceHealth").mockResolvedValue([]);

  const agent = request.agent(app);
  await agent.get("/api/session").expect(200);
  const response = await agent
    .get("/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2")
    .expect(200);

  expect(response.body.events).toEqual([]);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/api.test.ts
```

Expected: FAIL because `sourceItemToTrafficMapEvent` currently hard-codes `state: "active"` for DATEX source items.

---

### Task 12: Remove the DATEX source-item active fallback from traffic map

**Objective:** Make `traffic_map_events` and `official_events` the only active traffic-map event sources.

**Files:**

- Modify: `apps/server/src/app.ts:348-354`
- Modify: `apps/server/src/traffic/datex-normalizer.ts:100-120` only if dead export removal is desired
- Test: `apps/server/test/api.test.ts`

**Step 1: Remove fallback loop**

In `apps/server/src/app.ts`, remove this block from the traffic events endpoint:

```ts
for (const item of sourceItems) {
  const trafficEvent = sourceItemToTrafficMapEvent(item);
  if (trafficEvent && !eventsBySourceKey.has(sourceKey(trafficEvent))) {
    eventsBySourceKey.set(sourceKey(trafficEvent), trafficEvent);
  }
}
```

Keep `sourceItems` only if still needed for related evidence/source panels. If it is now unused in the endpoint, remove `listAllDatexSourceItems(...)` and the `sourceItemToTrafficMapEvent` import in the same commit.

**Step 2: Verify no stale import/dead export issues**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck && npm test -- apps/server/test/api.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/traffic/datex-normalizer.ts apps/server/test/api.test.ts
git commit -m "fix: stop promoting DATEX source items as active map events"
```

---

### Task 13: Add explicit 404 tests for missing situation workspace creates

**Objective:** Ensure feature/task/note create endpoints return 404 for missing situations in both MemoryStore/dev and PgStore-like paths.

**Files:**

- Modify: `apps/server/test/api.test.ts:570-675`
- Modify later: `apps/server/src/app.ts:570-675,700-712`

**Step 1: Write failing API tests**

Add to `describe("private situation API", ...)`:

```ts
it("returns 404 when creating workspace records for a missing situation", async () => {
  const { agent, csrf } = await ownerAgent();
  const missingId = "missing-situation-id";

  await agent
    .post(`/api/situations/${missingId}/tasks`)
    .set("X-CSRF-Token", csrf)
    .send({ text: "Call innsatsleder" })
    .expect(404);

  await agent
    .post(`/api/situations/${missingId}/notes`)
    .set("X-CSRF-Token", csrf)
    .send({ text: "Notat" })
    .expect(404);

  await agent
    .post(`/api/situations/${missingId}/features`)
    .set("X-CSRF-Token", csrf)
    .send({
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      properties: { label: "Markering" },
    })
    .expect(404);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/api.test.ts
```

Expected: FAIL because MemoryStore can create orphan tasks/notes or the feature route does not use the existing guard.

---

### Task 14: Apply ensureSituationExists to feature/task/note create routes

**Objective:** Reuse the attachment guard before every workspace create mutation.

**Files:**

- Modify: `apps/server/src/app.ts:570-675,700-712`
- Test: `apps/server/test/api.test.ts`

**Step 1: Move guard before workspace routes**

Move the existing `ensureSituationExists` definition from `apps/server/src/app.ts:700-712` above the first workspace create route (`POST /api/situations/:id/features`). Keep the body unchanged:

```ts
const ensureSituationExists: express.RequestHandler = async (req, res, next) => {
  try {
    const situationId = String(req.params.id);
    const workspace = await store.getWorkspace(situationId, currentLogin(req));
    if (!workspace) {
      res.status(404).json({ error: "Situasjonen finnes ikke." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
```

**Step 2: Add guard to create routes**

Apply it to:

```ts
app.post("/api/situations/:id/features", ensureSituationExists, async (req, res, next) => { ... });
app.post("/api/situations/:id/tasks", ensureSituationExists, async (req, res, next) => { ... });
app.post("/api/situations/:id/notes", ensureSituationExists, async (req, res, next) => { ... });
```

Leave PATCH/DELETE routes as-is unless their current 404 behavior changes; they already return 404 when row-specific operations fail.

**Step 3: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/api.test.ts && npm run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/api.test.ts
git commit -m "fix: 404 missing situation workspace creates"
```

---

### Task 15: Add deployment rollback rescue test

**Objective:** Lock the desired Ansible rollback behavior before editing the playbook.

**Files:**

- Modify: `apps/server/test/deployment-playbook.test.ts`
- Modify later: `ansible-playbook.yml:319-430`

**Step 1: Add failing rollback rescue test**

Extend `apps/server/test/deployment-playbook.test.ts`:

```ts
it("rolls back previous app and worker images when post-promotion validation fails", () => {
  const blockStart = playbook.indexOf("- name: Promote candidate and validate production");
  expect(blockStart).toBeGreaterThan(-1);
  const rescueStart = playbook.indexOf("rescue:", blockStart);
  expect(rescueStart).toBeGreaterThan(blockStart);

  const validationBlock = playbook.slice(blockStart, rescueStart);
  expect(validationBlock).toContain("- name: Promote API and worker");
  expect(validationBlock).toContain("- name: Verify production health");
  expect(validationBlock).toMatch(/- name: Verify worker/);
  expect(validationBlock).toContain(
    "- name: Verify DATEX source health rows when DATEX is enabled",
  );
  expect(validationBlock).toContain("- name: Verify Entur source health");
  expect(validationBlock).toContain("- name: Verify source item query sanity");

  const alwaysStart = playbook.indexOf("always:", rescueStart);
  const rescueBlock = playbook.slice(
    rescueStart,
    alwaysStart > rescueStart ? alwaysStart : undefined,
  );
  expect(rescueBlock).toContain("nytt-trondheim-api:previous");
  expect(rescueBlock).toContain("nytt-trondheim-api:latest");
  expect(rescueBlock).toContain("nytt-trondheim-worker:previous");
  expect(rescueBlock).toContain("nytt-trondheim-worker:latest");
  expect(rescueBlock).toContain("docker compose --env-file .env.production up -d app worker");
});
```

This test intentionally checks structure instead of character windows so a long, correct validation block does not fail the test.

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/deployment-playbook.test.ts
```

Expected: FAIL because the playbook has no `Promote candidate and validate production` block and no rescue rollback.

---

### Task 16: Implement deployment rescue rollback around promotion and validation

**Objective:** Ensure failed post-promotion checks restore the previous app/worker images.

**Files:**

- Modify: `ansible-playbook.yml:319-430`
- Test: `apps/server/test/deployment-playbook.test.ts`

**Step 1: Wrap promotion and validation in block/rescue**

In `ansible-playbook.yml`, convert the promotion and post-promotion checks to a block:

<!-- prettier-ignore -->
```yaml
    - name: Promote candidate and validate production
      block:
        - name: Promote API and worker
          ansible.builtin.command: docker compose --env-file .env.production up -d app worker
          args:
            chdir: "{{ app_dir }}"
          changed_when: true

        - name: Remove healthy canary
          community.docker.docker_container:
            name: nytt-trondheim-canary
            state: absent

        # Keep existing Caddy validation/reload and production/source checks here.
      rescue:
        - name: Restore previous API image after failed candidate validation
          ansible.builtin.shell: docker image tag nytt-trondheim-api:previous nytt-trondheim-api:latest
          changed_when: true
          ignore_errors: true

        - name: Restore previous worker image after failed candidate validation
          ansible.builtin.shell: docker image tag nytt-trondheim-worker:previous nytt-trondheim-worker:latest
          changed_when: true
          ignore_errors: true

        - name: Restart previous API and worker after failed candidate validation
          ansible.builtin.command: docker compose --env-file .env.production up -d app worker
          args:
            chdir: "{{ app_dir }}"
          changed_when: true

        - name: Verify previous production health after rollback
          ansible.builtin.uri:
            url: "https://nytt.reidar.tech/health"
            return_content: true
          register: rollback_health
          until: rollback_health.json.status == "ok"
          retries: 6
          delay: 5

        - name: Fail deployment after rollback
          ansible.builtin.fail:
            msg: "Candidate validation failed; previous app/worker images were restored. Inspect logs for the failed candidate."
      always:
        - name: Remove canary container after deploy attempt
          community.docker.docker_container:
            name: nytt-trondheim-canary
            state: absent
```

Do not hide rollback failures completely. Only `ignore_errors` the image re-tag if `:previous` is absent; the restart/health/fail steps should remain visible.

**Step 2: Verify targeted test**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/deployment-playbook.test.ts
```

Expected: PASS for the rollback rescue test and the pre-existing deployment-playbook tests.

**Step 3: Commit**

```bash
git add ansible-playbook.yml apps/server/test/deployment-playbook.test.ts
git commit -m "fix: rollback failed production candidate deploys"
```

---

### Task 17: Make migration/canary ordering explicit and honest

**Objective:** Prevent silent schema split-brain by documenting/enforcing expand-contract migration assumptions before canary.

**Files:**

- Modify: `docs/DEPLOYMENT.md:9`
- Modify: `apps/server/test/deployment-playbook.test.ts`
- Optionally modify: `ansible-playbook.yml:264-294`

**Step 1: Add doc/test for expand-contract contract**

In `apps/server/test/deployment-playbook.test.ts`:

```ts
it("documents that migrations before canary must be expand-contract compatible", () => {
  expect(playbook).toContain("Create and verify encrypted pre-migration backup");
  expect(playbook.indexOf("- name: Apply database migrations")).toBeLessThan(
    playbook.indexOf("- name: Start API canary with production database"),
  );
  const deploymentDoc = readFileSync(
    new URL("../../../docs/DEPLOYMENT.md", import.meta.url),
    "utf8",
  );
  expect(deploymentDoc).toMatch(/expand\/contract|backward-compatible schema/i);
  expect(deploymentDoc).not.toMatch(
    /failed backup, migration or canary does not leave the site offline/i,
  );
});
```

Remember to import `readFileSync` already exists in this file.

**Step 2: Update docs honestly**

Change `docs/DEPLOYMENT.md:9` so it no longer overclaims that failed migration/canary cannot affect live old code. Use wording like:

```md
Ansible verifies an encrypted pre-migration backup, applies locked transactional migrations, health-checks a canary API container, and promotes API/worker only after canary success. Because migrations run before canary against the production database, application migrations must be expand/contract-compatible with the previous release; destructive schema changes must be split into a later deploy or paired with an explicit restore/rollback procedure.
```

**Step 3: Run test**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/deployment-playbook.test.ts
```

Expected: PASS for this documentation invariant.

**Step 4: Commit**

```bash
git add docs/DEPLOYMENT.md apps/server/test/deployment-playbook.test.ts
git commit -m "docs: clarify migration canary safety contract"
```

---

### Task 18: Strengthen DATEX and worker deployment verification

**Objective:** Require fresh `state='ok'` source-health rows and worker ingestion freshness, not just row existence/container state.

**Files:**

- Modify: `ansible-playbook.yml:416-430`
- Modify: `apps/server/test/deployment-playbook.test.ts`
- Modify: `docs/DEPLOYMENT.md:80-97`

**Step 1: Add failing DATEX freshness test**

In `apps/server/test/deployment-playbook.test.ts`:

```ts
it("requires DATEX source health rows to be ok and fresh", () => {
  const taskStart = playbook.indexOf(
    "- name: Verify DATEX source health rows when DATEX is enabled",
  );
  const taskEnd = playbook.indexOf("- name: Verify Entur source health", taskStart);
  const task = playbook.slice(taskStart, taskEnd);

  expect(taskStart).toBeGreaterThan(-1);
  expect(task).toContain("state='ok'");
  expect(task).toMatch(/last_checked_at\s*>\s*now\(\)\s*-\s*interval/);
  expect(task).toContain("until:");
  expect(task).toMatch(/retries:\s*\d+/);
});
```

**Step 2: Add failing worker health semantics test**

```ts
it("verifies worker freshness instead of only running container state", () => {
  const workerTaskStart = playbook.indexOf("- name: Verify worker");
  const workerTaskEnd = playbook.indexOf("- name: Verify DATEX source health", workerTaskStart);
  const task = playbook.slice(workerTaskStart, workerTaskEnd);

  expect(workerTaskStart).toBeGreaterThan(-1);
  expect(task).not.toContain("ps --services --filter status=running worker | grep -qx worker");
  expect(task).toMatch(/source_health|runtime-status|last_checked_at/);
});
```

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/deployment-playbook.test.ts
```

Expected: FAIL because the playbook still accepts DATEX row presence and worker container status.

**Step 3: Replace worker running check with freshness-oriented check**

Replace the existing `Verify worker container is running` task with a SQL/source-health check that proves at least one worker-owned source has checked in recently. Keep a separate `docker compose ps worker` only as diagnostic output if desired.

Example Ansible task:

<!-- prettier-ignore -->
```yaml
    - name: Verify worker source health freshness
      ansible.builtin.shell: |
        set -euo pipefail
        docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -v ON_ERROR_STOP=1 -Atqc "
          SELECT count(*)
          FROM source_health
          WHERE state='ok'
            AND last_checked_at > now() - interval '20 minutes'
            AND source IN ('datex','datex_travel_time','entur_vehicle_positions','entur_service_alerts','vegvesen_traffic_info','trafikkdata');
        " | grep -Eq '^[1-9][0-9]*$'
      args:
        chdir: "{{ app_dir }}"
        executable: /bin/bash
      register: worker_freshness
      until: worker_freshness.rc == 0
      retries: 12
      delay: 10
      changed_when: false
```

**Step 4: Strengthen DATEX check**

Change the DATEX task to require both rows, `state='ok'`, and fresh `last_checked_at`:

```sql
SELECT count(*)
FROM source_health
WHERE source IN ('datex','datex_travel_time')
  AND state='ok'
  AND last_checked_at > now() - interval '30 minutes';
```

Assert the count is `2`, with retries after worker promotion.

**Step 5: Update deployment docs**

In `docs/DEPLOYMENT.md:80-97`, update the verification description to say DATEX deploy verification requires fresh `state='ok'` source-health rows, not merely row presence.

**Step 6: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/deployment-playbook.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add ansible-playbook.yml docs/DEPLOYMENT.md apps/server/test/deployment-playbook.test.ts
git commit -m "fix: verify fresh worker and DATEX health in deploy"
```

---

### Task 19: Restore Vær as a home category filter button

**Objective:** Make Playwright e2e match product behavior: `Vær` is a selectable home category filter while `/vaer` remains available from top navigation.

**Files:**

- Modify: `apps/frontend/src/pages/HomePage.tsx:365-380`
- Test: `e2e/app.spec.ts:111-115,265-348`

**Step 1: Run failing e2e slice to confirm current failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx playwright test e2e/app.spec.ts -g "home filter URL|load more response" --project=desktop-chromium
```

Expected: FAIL because `getByRole("button", { name: "Vær" })` is not found.

**Step 2: Remove Weather special-case link from HomePage filters**

Change `apps/frontend/src/pages/HomePage.tsx:365-380` from special-casing `item === "Vær"` to rendering every category as a button:

```tsx
<div className="filters" aria-label="Filtrer saker">
  {articleCategories.map((item: ArticleCategoryFilter) => (
    <button
      className={category === item ? "selected" : ""}
      key={item}
      onClick={() => updateFilters({ category: item })}
    >
      {item}
    </button>
  ))}
</div>
```

Do not remove the existing top navigation link to `/vaer` in `apps/frontend/src/App.tsx`; that remains the entry point to the dedicated Weather page.

**Step 3: Verify targeted e2e**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx playwright test e2e/app.spec.ts -g "home filter URL|load more response" --project=desktop-chromium
```

Expected: PASS.

**Step 4: Verify both projects for the fixed cases**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx playwright test e2e/app.spec.ts -g "home filter URL|load more response"
```

Expected: PASS for desktop and mobile.

**Step 5: Commit**

```bash
git add apps/frontend/src/pages/HomePage.tsx
git commit -m "fix: restore weather category filter button"
```

---

### Task 20: Run full local verification gates

**Objective:** Prove the complete remediation passes the same safe gates plus Playwright e2e.

**Files:**

- No code changes unless a gate fails.

**Step 1: Run core gates**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && \
  npm run typecheck && \
  npm run lint && \
  npm run format:check && \
  npm test && \
  npm run build && \
  npm audit --omit=dev --audit-level=high
```

Expected: PASS. Unit test summary should still be at least 37 files / 239 tests, plus new tests added by this plan.

**Step 2: Run Playwright e2e**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run test:e2e
```

Expected: PASS. If a test fails due to a real app bug, fix with a focused TDD task before proceeding. If a test fails due to a test contract drift, patch the test only after proving the product behavior is intentional.

**Step 3: Inspect git diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no whitespace errors; diff only touches files named in this plan.

**Step 4: Commit verification-only fixes if needed**

If fixes were needed after full gates:

```bash
git add <changed files>
git commit -m "fix: satisfy audit remediation verification"
```

---

### Task 21: Post-implementation audit

**Objective:** Read the touched code after green tests and catch tests-green/runtime-wrong issues.

**Files:**

- Read: all files changed by Tasks 1-20.
- Optional modify: only if audit finds a real bug.

**Step 1: Inspect changed files manually**

Run:

```bash
git diff --name-only main...HEAD
```

For each changed file, read the final code. Check specifically:

- `apps/server/src/config.ts`: production-only session validation; development/test helpers still work.
- `apps/frontend/src/*`: every external URL is `safeExternalUrl(...)`; internal React Router `Link` routes are not accidentally converted to anchors.
- `apps/worker/src/datex.ts` and `apps/worker/src/index.ts`: DATEX credentials are sent only to HTTPS Vegvesen host; no logs include credentials.
- `apps/server/src/store.ts` and `apps/worker/src/repository.ts`: future Entur alert filter preserves line-only/no-geometry active alerts whose valid window has started.
- `apps/server/src/store.ts` and `apps/worker/src/repository.ts`: TravelTime stale fallback does not mark fresh open-ended rows stale immediately.
- `apps/server/src/app.ts`: source_items are not active traffic-map fallback; workspace create guards use current owner login.
- `ansible-playbook.yml`: rescue block actually encloses promotion and validation; rollback re-starts previous app/worker and fails visibly after rollback.
- `docs/DEPLOYMENT.md`: no overclaim that migration/canary failures are harmless without expand/contract compatibility.

**Step 2: Run final gates again if any audit fix was made**

Run the Task 20 commands again.

**Step 3: Record final verification in PR/commit message**

Include:

```text
Verification:
- npm run typecheck
- npm run lint
- npm run format:check
- npm test
- npm run build
- npm audit --omit=dev --audit-level=high
- npm run test:e2e
```

Expected: all PASS before reporting completion.

---

## Plan review history

- 2026-06-01 draft created after read-only code review and architecture-doc audit.
- 2026-06-01 plan-review pass found blockers: `travelTimeCorridor` defaulted `measurementTo`, the DATEX `SourceItem` test literal used invalid `kind`/missing `captureHash`, deployment-playbook tests were batched in a way that would leave known-red tests across tasks, rollback test used brittle character windows, and Hermes skill references were not repo-local paths.
- 2026-06-01 blockers patched: open-ended TravelTime test now explicitly overrides `measurementTo`, DATEX `SourceItem` literal uses valid `official_event` plus `captureHash`, deployment tests are staged task-by-task, rollback assertions are structural, and the external-feed/deployment checklist is summarized with absolute Hermes skill reference paths.
- 2026-06-01 focused re-review verdict: approved. The five prior blockers were verified fixed; proceed with implementation task-by-task.

## Final verification checklist

- [ ] Architecture docs were read and runtime dependency chains identified.
- [ ] Deployment rollback/rescue behavior is tested and implemented.
- [ ] Migration/canary safety contract is honest and enforced/documented.
- [ ] Production `SESSION_SECRET` fails closed.
- [ ] Frontend and worker both reject unsafe external URL schemes.
- [ ] DATEX Basic Auth endpoints are HTTPS and allowlisted.
- [ ] Future Entur alerts do not appear as active map alerts before `validFrom`.
- [ ] DATEX TravelTime stale overlay falls back to `updated_at`.
- [ ] DATEX source ledger rows cannot resurrect active map events.
- [ ] Missing-situation workspace creates return 404 consistently.
- [ ] DATEX/worker deploy checks require fresh `state='ok'` rows.
- [ ] `Vær` home filter e2e tests pass on desktop and mobile.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, production `npm audit`, and `npm run test:e2e` pass.
