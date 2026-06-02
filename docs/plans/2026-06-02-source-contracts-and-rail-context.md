# Nytt Source Contracts and Rail Context Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Restore green local gates, formalize source-contract work for the new source candidates, and add Bane NOR RSS as a non-promoting official rail/mobility context source.

**Architecture:** Keep Nytt provenance-first: source contracts come before adapters; official/ledger records remain separate from promoted situations; high-churn telemetry remains out of `source_items`. Bane NOR RSS will be stored as source-item ledger evidence and source-health state only in this phase, not as `official_events`, `traffic_map_events`, or `situations`.

**Tech Stack:** TypeScript, Node 22, npm workspaces, Vitest, Express, PostgreSQL/PostGIS schema, fast-xml-parser, existing `WorkerRepository` source-item and source-health helpers.

---

## Scope and non-goals

In scope:

- Fix the current full-suite blocker in `apps/server/test/weather-preparedness.test.ts` caused by date fixture drift.
- Add concrete source-contract docs for:
  - Bane NOR RSS.
  - Trondheim Notify / `trondheimvarsling`.
  - Trøndelag fylkeskommune.
- Add Bane NOR RSS as a source-health-visible, ledger-only rail context source.
- Preserve raw upstream RSS item payloads in `source_items.rawPayload`.
- Add regression tests proving Bane NOR rows do not promote situations or map incidents.
- Update repo docs and Obsidian after implementation.

Out of scope for this plan:

- No Trondheim Notify parser/collector yet; only source contract and spike notes.
- No Trøndelag fylkeskommune parser/collector yet; only source contract and spike notes.
- No Bane NOR map layer yet.
- No automatic Situation Room activation from Bane NOR RSS.
- No live deploy or CI claim unless executed later and verified by `gh run` plus live endpoint checks.

## Architecture audit before implementation

Read before coding:

- `docs/ARCHITECTURE.md`
- `docs/SOURCES.md`
- `docs/plans/2026-06-02-source-bank-review.md`
- `apps/server/src/app.ts`
- `apps/server/src/weather/preparedness.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/repository.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`

Runtime heartbeat chains:

1. Weather endpoint:
   `apps/server/src/app.ts /api/weather/preparedness -> store.listOfficialEvents + store.listRoadWeatherObservations + store.listSourceHealth -> loadWeatherPreparedness -> buildWeatherPreparednessPayload`.

   Risk: test failures can be silent date drift rather than bad warning logic. Use explicit fixtures or injected `now`; do not loosen MET/NVE filtering to make tests pass.

2. Worker ingestion:
   `apps/worker/src/index.ts main -> createCollectionGuard -> collectAll -> per-source collector -> WorkerRepository -> source_health/source_items`.

   Risk: `collectAll` catches per-source errors and writes degraded source health. New Bane NOR code must put fetch/parse errors inside a source-specific block that writes `source_health`; do not add an empty catch that swallows implementation/import errors before health is visible.

3. Source ledger:
   `parser -> SourceItemInput -> WorkerRepository.upsertSourceItem private helper -> source_items`.

   Risk: adding a new `SourceId` touches shared schema/types, API filtering, repository guards, and tests. Update every shared enum together.

## Live endpoint facts gathered before planning

Bane NOR RSS probe:

```text
GET https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true
HTTP 200 application/rss+xml; charset=utf-8
Last-Modified: none observed
ETag: none observed
item_count: 42
example durable field: <guid>ad45c3b0-4321-4240-a997-768cbefb8ce1</guid>
Trondheim-relevant matches included Trondheim S, Trondheim S-Hell, Hell-Storlien, Hell-Steinkjer, Støren-Trondheim S, Dombås-Støren, Nordlandsbanen Åsen-Ronglan.
```

Because no `ETag`/`Last-Modified` was observed, the first implementation should do a normal low-frequency RSS fetch and use GUID/version/content hash for idempotency. Do not implement disappearance-based expiration until we know whether the RSS feed is complete/stable enough for lifecycle semantics.

---

### Task 1: Fix weather-preparedness date-fixture drift

**Objective:** Make the existing weather-preparedness tests deterministic so the full suite is green before adding new source work.

**Files:**

- Modify: `apps/server/test/weather-preparedness.test.ts:50-66`
- Optional modify only if needed: `apps/server/src/weather/preparedness.ts:39-44`

**Step 1: Verify the current failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- apps/server/test/weather-preparedness.test.ts
```

Expected before fix: FAIL in assertions where MET/NVE official warnings are filtered out and risks fall back to Locationforecast-only values.

**Step 2: Patch the test fixture, not the production warning filter**

In `apps/server/test/weather-preparedness.test.ts`, change the default helper so warnings stay valid regardless of wall-clock date:

```ts
function officialEvent(overrides: Partial<OfficialEvent>): OfficialEvent {
  return {
    id: "met-rain",
    source: "met",
    eventType: "weather",
    title: "Kraftig regn",
    detail: "Lokalt mye regn. Overvann kan forekomme.",
    sourceUrl: "https://api.met.no/weatherapi/metalerts/2.0/current.rss",
    areaLabel: "Trøndelag",
    state: "active",
    severity: "yellow",
    publishedAt: "2026-06-01T06:00:00.000Z",
    validFrom: "2026-06-01T07:00:00.000Z",
    validTo: "2099-06-02T09:00:00.000Z",
    raw: {},
    ...overrides,
  };
}
```

If a later test requires an expired warning, set `validTo` explicitly in that test rather than relying on real time.

**Step 3: Run the weather test**

Run:

```bash
npm test -- apps/server/test/weather-preparedness.test.ts
```

Expected: PASS, 5 tests passed.

**Step 4: Run the existing classifier/source-bank tests**

Run:

```bash
npm test -- apps/worker/test/classify.test.ts
```

Expected: PASS, 18 tests passed.

**Step 5: Commit**

```bash
git add apps/server/test/weather-preparedness.test.ts
git commit -m "test: stabilize weather preparedness fixtures"
```

---

### Task 2: Add source-contract directory and template

**Objective:** Give every future source adapter a concrete contract format before code is written.

**Files:**

- Create: `docs/source-contracts/README.md`

**Step 1: Create the template file**

Create `docs/source-contracts/README.md`:

```md
# Nytt Source Contracts

Every new external source must have a source contract before adapter code.

## Contract template

### Provider

- Name:
- Source ID:
- Authority level: `official` / `trusted_media` / `internal` / `unverified`
- Endpoint(s):
- Auth:
- Method and expected content type:
- User-Agent:
- Rate/backoff:
- Conditional fetch support:
- Legal/robots/licensing notes:

### Identity and lifecycle

- Durable upstream identity:
- Version/revision/change marker:
- Duplicate snapshot behavior:
- Disappearance behavior:
- Open-ended/stale policy:

### Retention

- Retained fields:
- Explicitly not retained:
- Raw payload retention:
- Normalized payload shape:

### Product boundaries

- May create `source_items`:
- May create `official_events`:
- May create `traffic_map_events`:
- May create `situations`:
- Promotion rules:
- Explicit no-promotion rules:
- Geometry semantics:

### Source health and verification

- Health source ID:
- OK detail:
- Degraded detail:
- Production SQL checks:
- Live endpoint verification command:
```

**Step 2: Verify file exists**

Run:

```bash
test -f docs/source-contracts/README.md && grep -n "Every new external source" docs/source-contracts/README.md
```

Expected: one matching line.

**Step 3: Commit**

```bash
git add docs/source-contracts/README.md
git commit -m "docs: add source contract template"
```

---

### Task 3: Write Bane NOR RSS source contract

**Objective:** Define exactly how Bane NOR RSS may be ingested before adapter code is added.

**Files:**

- Create: `docs/source-contracts/bane-nor-rss.md`

**Step 1: Write the contract**

Create `docs/source-contracts/bane-nor-rss.md`:

```md
# Source Contract: Bane NOR RSS

## Provider

- Name: Bane NOR trafikkmeldinger
- Source ID: `bane_nor`
- Authority level: `official`
- Endpoint: `https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true`
- Auth: none
- Method/content type: `GET`, observed `application/rss+xml; charset=utf-8`
- User-Agent: `NyttTrondheim/0.1 kontakt@reidar.tech`
- Rate/backoff: max once per 10 minutes initially; degraded source health on fetch/parse failure.
- Conditional fetch support: none observed (`ETag` and `Last-Modified` absent in 2026-06-02 probe). Re-check before optimizing.
- Legal/robots/licensing notes: blocker before production enablement. Check `robots.txt`, visible terms, and whether summary/link-only retention is acceptable before wiring into `collectAll`.

## Identity and lifecycle

- Durable upstream identity: RSS `<guid>`.
- Version marker: first implementation uses `pubDate`, normalized title, normalized description, and parsed validity window in `captureHash`. Bane NOR did not expose revision metadata in the observed RSS.
- Duplicate snapshot behavior: same GUID/content hash is idempotent.
- Disappearance behavior: do not expire solely on RSS disappearance in the first implementation, because completeness/window semantics are not proven.
- Open-ended/stale policy: derive active/planned from parsed date phrases when possible. Past or unparseable validity windows remain context with `unknown` state in phase 1; do not expire solely on RSS disappearance because completeness/window semantics are not proven.

## Retention

- Retain: GUID, title, description excerpt, link, pubDate, matched rail terms, parsed validity if available.
- Do not retain: no full web page scrape in phase 1.
- Raw payload: preserve raw RSS item object in `source_items.rawPayload`.
- Normalized payload: preserve normalized rail context object.

## Product boundaries

- May create `source_items`: yes, provider `bane_nor`, kind `official_event`, reliability `official`.
- May update `source_health`: yes, source `bane_nor`, including degraded state on fetch/parse/persist failures when health persistence itself succeeds.
- May create `official_events`: no in phase 1.
- May create `traffic_map_events`: no in phase 1.
- May create `situations`: no in phase 1.
- Promotion rules: none in phase 1.
- Explicit no-promotion rules: every Bane NOR RSS item is ledger/context only until a separate promotion plan is written.
- Geometry semantics: no geometry unless a future station/line geocoder plan is added; matched station/line names are textual context only.

## Source health and verification

- Health source ID: `bane_nor`
- OK detail: `{n} relevante Bane NOR trafikkmeldinger hentet`
- Degraded detail: `Bane NOR RSS feilet: ...`
- Production SQL checks:
  - `SELECT count(*) FROM source_items WHERE provider='bane_nor';`
  - `SELECT count(*) FROM official_events WHERE source='bane_nor';` must be `0` in this phase.
  - `SELECT count(*) FROM traffic_map_events WHERE source='bane_nor';` must be `0` in this phase.
  - `SELECT count(*) FROM situations WHERE payload::text ILIKE '%bane_nor%';` must be `0` in this phase.
- Live endpoint verification:
  - `curl -I -A 'NyttTrondheim/0.1 kontakt@reidar.tech' 'https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true'`
```

**Step 2: Verify contract contains boundary statements**

Run:

```bash
grep -n "May create \`situations\`: no" docs/source-contracts/bane-nor-rss.md
grep -n "Raw payload" docs/source-contracts/bane-nor-rss.md
grep -n "traffic_map_events.*0" docs/source-contracts/bane-nor-rss.md
```

Expected: all commands print a matching line.

**Step 3: Check robots/terms before enabling code**

Run:

```bash
python3 - <<'PY'
import urllib.request

headers = {'User-Agent': 'NyttTrondheim/0.1 kontakt@reidar.tech'}

robots_url = 'https://www.banenor.no/robots.txt'
req = urllib.request.Request(robots_url, headers=headers)
with urllib.request.urlopen(req, timeout=20) as r:
    body = r.read().decode('utf-8', errors='replace')
    print(robots_url, r.status, r.getheader('content-type'))
    print(body[:4000])

rss_url = 'https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true'
req = urllib.request.Request(rss_url, headers=headers)
with urllib.request.urlopen(req, timeout=20) as r:
    print(rss_url, r.status, r.getheader('content-type'))
PY
```

Expected: both URLs are reachable. Then manually inspect `robots.txt` output and the Bane NOR site terms. If collection is not allowed or unclear, stop this plan before Task 7 and leave Bane NOR as contract-only.

Add one of these lines to `docs/source-contracts/bane-nor-rss.md` before committing:

```md
- Enablement decision: allowed for phase-1 summary/link RSS collection as of YYYY-MM-DD.
```

or:

```md
- Enablement decision: blocked/pending; do not wire into `collectAll`.
```

**Step 5: Commit**

```bash
git add docs/source-contracts/bane-nor-rss.md
git commit -m "docs: add Bane NOR RSS source contract"
```

---

### Task 4: Write Trondheim Notify source contract

**Objective:** Capture the high-value municipal service-disruption source without implementing a scraper prematurely.

**Files:**

- Create: `docs/source-contracts/trondheim-notify.md`

**Step 1: Write the contract**

Create `docs/source-contracts/trondheim-notify.md`:

```md
# Source Contract: Trondheim Notify / Resident Notifications

## Provider

- Name: Trondheim kommune resident notifications via Gemini Notify
- Candidate Source ID: `trondheim_notify` (not yet added to shared schemas)
- Authority level: `official` if terms/technical contract pass
- Candidate endpoint: `https://notify.geminisuite.com/trondheimvarsling/public`
- Auth: none observed
- Method/content type: observed `GET` returning HTML
- User-Agent: `NyttTrondheim/0.1 kontakt@reidar.tech`
- Rate/backoff: unknown; blocker before production polling.
- Conditional fetch support: unknown; blocker before production polling.
- Legal/robots/licensing notes: blocker before production collection.

## Identity and lifecycle

- Durable upstream identity: unknown; parser spike must identify a stable notice id or stable URL/time/location tuple.
- Version/revision/change marker: unknown.
- Duplicate snapshot behavior: unknown until identity is known.
- Disappearance behavior: unknown; successful snapshot disappearance must not imply resolution until feed completeness is proven.
- Open-ended/stale policy: unknown; parser spike must define treatment for ongoing water outages and resolved boil-water notices.

## Retention

- Retained fields: only after parser spike; likely title/summary, area/location text, valid-from/to, notice type, source URL.
- Explicitly not retained: no private resident targeting data, phone-number-specific data, or full hidden application state.
- Raw payload retention: only if public and legally allowed; preserve minimal raw notice object for provenance.
- Normalized payload shape: blocked until real HTML/API shape is known.

## Product boundaries

- May create `source_items`: only after a parser/source contract review.
- May create `official_events`: possible for active water outage / boil-water / service disruption records after parser proof.
- May create `traffic_map_events`: no in first parser spike.
- May create `situations`: only under a later explicit severe-service-disruption promotion rule.
- Promotion rules: none in this contract-only phase.
- Explicit no-promotion rules: ordinary planned maintenance, private-network work, vague notices, and missing-warning apology notices are context only.
- Geometry semantics: no geometry unless public source gives explicit address/area or a later geocoder maps a named place as reporting/context estimate.

## Source health and verification

- Health source ID: `trondheim_notify` only after shared schemas are extended.
- OK detail: not defined yet.
- Degraded detail: not defined yet.
- Production SQL checks: not applicable until implementation plan exists.
- Live endpoint verification command:
  - `curl -I -A 'NyttTrondheim/0.1 kontakt@reidar.tech' 'https://notify.geminisuite.com/trondheimvarsling/public'`

## Required spike before code

1. Identify whether the public HTML embeds a stable JSON/API endpoint.
2. Check robots/terms.
3. Capture a minimal fixture with one planned outage, one acute outage, one boil advisory, and one resolved notice.
4. Define identity, validity, disappearance, and stale semantics.
5. Add source-health-only probe before production ingestion.
```

**Step 2: Verify it is contract-only and complete enough**

Run:

```bash
grep -n "not yet added" docs/source-contracts/trondheim-notify.md
grep -n "Durable upstream identity: unknown" docs/source-contracts/trondheim-notify.md
grep -n "Raw payload retention" docs/source-contracts/trondheim-notify.md
grep -n "blocker before production" docs/source-contracts/trondheim-notify.md
```

Expected: all commands print a matching line.

**Step 3: Commit**

```bash
git add docs/source-contracts/trondheim-notify.md
git commit -m "docs: add Trondheim Notify source contract"
```

---

### Task 5: Write Trøndelag fylkeskommune source contract

**Objective:** Capture Trøndelag fylkeskommune as planned-work/context source, not as a duplicate traffic authority.

**Files:**

- Create: `docs/source-contracts/trondelag-fylke.md`

**Step 1: Write the contract**

Create `docs/source-contracts/trondelag-fylke.md`:

```md
# Source Contract: Trøndelag fylkeskommune

## Provider

- Name: Trøndelag fylkeskommune
- Candidate Source ID: `trondelag_fylke` (not yet added to shared schemas)
- Authority level: `official`
- Candidate pages:
  - `https://www.trondelagfylke.no/vare-tjenester/veg/fylkesveg/`
  - fylkesveg news/project-map links discovered from that page
- Auth: none for public pages
- Method/content type: HTML/page or future feed if found
- User-Agent: `NyttTrondheim/0.1 kontakt@reidar.tech`
- Rate/backoff: unknown until feed/API route is identified.
- Conditional fetch support: unknown.
- Legal/robots/licensing notes: verify before collection.

## Identity and lifecycle

- Durable upstream identity: unknown until the specific news/feed/project-map route is chosen.
- Version/revision/change marker: unknown.
- Duplicate snapshot behavior: unknown.
- Disappearance behavior: do not infer completion from disappearance until the upstream listing/window semantics are known.
- Open-ended/stale policy: planned-work items need explicit validity dates or a conservative stale policy before map/context use.

## Retention

- Retained fields: title, summary/excerpt, URL, published/updated time, project/road labels, validity if available.
- Explicitly not retained: full page scrape in first phase, unrelated county services unless a later contract adds them.
- Raw payload retention: preserve minimal raw public item/object if allowed.
- Normalized payload shape: blocked until source route is selected.

## Product boundaries

- May create `source_items`: yes after source contract review.
- May create `official_events`: maybe for explicit planned road/project notices only.
- May create `traffic_map_events`: no until map/project data shape is proven.
- May create `situations`: no.
- Promotion rules: none in contract-only phase.
- Explicit no-promotion rules: Vegvesen/DATEX/TrafficInfo remains the operational traffic authority. Fylkeskommunen is context/planned-work, not live traffic confirmation.
- Geometry semantics: no geometry until official project geometry or a tested geocoder/map source is used.

## Source health and verification

- Health source ID: `trondelag_fylke` only after shared schemas are extended.
- OK detail: not defined yet.
- Degraded detail: not defined yet.
- Production SQL checks: not applicable until implementation plan exists. If implemented later, require `situations` count `0` unless a separate promotion plan exists.
- Live endpoint verification command:
  - `curl -I -A 'NyttTrondheim/0.1 kontakt@reidar.tech' 'https://www.trondelagfylke.no/vare-tjenester/veg/fylkesveg/'`

## Required spike before code

1. Find whether fylkesveg news has RSS or stable structured metadata.
2. Check whether ArcGIS project map has permitted API access.
3. Define whether records belong in `source_items`, `traffic_map_events`, or docs only.
4. Add negative tests that fylkesveg project context does not activate situations.
```

**Step 2: Verify no-promotion and unknown-lifecycle language**

Run:

```bash
grep -n "Vegvesen/DATEX/TrafficInfo remains" docs/source-contracts/trondelag-fylke.md
grep -n "May create \`situations\`: no" docs/source-contracts/trondelag-fylke.md
grep -n "Durable upstream identity: unknown" docs/source-contracts/trondelag-fylke.md
grep -n "Raw payload retention" docs/source-contracts/trondelag-fylke.md
```

Expected: all commands print a matching line.

**Step 3: Commit**

```bash
git add docs/source-contracts/trondelag-fylke.md
git commit -m "docs: add Trøndelag fylke source contract"
```

---

### Task 6: Add `bane_nor` to shared source IDs

**Objective:** Make Bane NOR a valid provider in shared types and API filter schemas.

**Files:**

- Modify: `packages/shared/src/types.ts:3-22`
- Modify: `packages/shared/src/schemas.ts:77-97`
- Modify: `packages/shared/test/source-items.test.ts:10-25`

**Step 1: Write failing schema test**

Patch `packages/shared/test/source-items.test.ts` so the parser explicitly accepts Bane NOR:

```ts
import {
  sourceIdSchema,
  sourceItemKindSchema,
  sourceItemLinkInputSchema,
  sourceItemQuerySchema,
  sourceItemRelationshipSchema,
  sourceReliabilityTierSchema,
} from "../src/schemas.js";

// inside the existing test:
expect(sourceIdSchema.parse("bane_nor")).toBe("bane_nor");
expect(
  sourceItemQuerySchema.parse({
    provider: "bane_nor",
    kind: "official_event",
    limit: "5",
  }),
).toMatchObject({ provider: "bane_nor", kind: "official_event", limit: 5 });
```

**Step 2: Run to verify failure**

Run:

```bash
npm test -- packages/shared/test/source-items.test.ts
```

Expected before implementation: FAIL because `bane_nor` is not in `sourceIdSchema`.

**Step 3: Add `bane_nor` to shared definitions**

Patch `packages/shared/src/types.ts`:

```ts
export type SourceId =
  | "nrk"
  | "adressa"
  | "vg"
  | "dagbladet"
  | "trondheim_kommune"
  | "bane_nor"
  | "met"
  | "nve"
  | "datex";
// rest unchanged
```

Patch `packages/shared/src/schemas.ts`:

```ts
export const sourceIdSchema = z.enum([
  "nrk",
  "adressa",
  "vg",
  "dagbladet",
  "trondheim_kommune",
  "bane_nor",
  "met",
  "nve",
  "datex",
  // rest unchanged
]);
```

**Step 4: Run tests**

Run:

```bash
npm test -- packages/shared/test/source-items.test.ts
npm run typecheck
```

Expected: PASS and typecheck exit 0.

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/test/source-items.test.ts
git commit -m "feat: add Bane NOR source identifier"
```

---

### Task 7: Add Bane NOR RSS parser fixtures and parser

**Objective:** Parse Bane NOR RSS into normalized rail-context records with stable identity and raw item retention.

**Files:**

- Create: `apps/worker/test/fixtures/bane-nor-rss.xml`
- Create: `apps/worker/test/bane-nor.test.ts`
- Create: `apps/worker/src/baneNor.ts`

**Step 1: Create minimal fixture**

Create `apps/worker/test/fixtures/bane-nor-rss.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Trafikkmeldinger</title>
    <item>
      <title>Trondheim S-Hell</title>
      <link>https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/</link>
      <guid>04ef7d8f-f6cf-40b8-915c-e14c1fad3708</guid>
      <pubDate>Tue, 02 Jun 2026 09:10:00 +0200</pubDate>
      <description>Fra lørdag 20. juni kl. 04:20 til mandag 22. juni kl. 06:00 utfører vi arbeid mellom Trondheim S og Hell. Strekningen blir stengt for trafikk.</description>
    </item>
    <item>
      <title>Egersund-Stavanger</title>
      <link>https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/</link>
      <guid>bb195bf8-cf29-405a-a7b0-c012c1a08a12</guid>
      <pubDate>Tue, 02 Jun 2026 09:33:33 +0200</pubDate>
      <description>Fra lørdag 5. september kl. 12:10 til lørdag 5. september kl. 22:00 utfører vi arbeid mellom Egersund og Stavanger.</description>
    </item>
  </channel>
</rss>
```

**Step 2: Write failing parser test**

Create `apps/worker/test/bane-nor.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { baneNorSourceItemInput, parseBaneNorRss } from "../src/baneNor.js";

const fixturePath = new URL("./fixtures/bane-nor-rss.xml", import.meta.url);

describe("Bane NOR RSS", () => {
  it("keeps Trondheim/Trøndelag rail messages and filters unrelated routes", async () => {
    const xml = await readFile(fixturePath, "utf8");
    const result = parseBaneNorRss(xml, { receivedAt: "2026-06-02T07:15:00.000Z" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: "bane-nor:04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
      source: "bane_nor",
      guid: "04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
      title: "Trondheim S-Hell",
      matchedTerms: ["Hell", "Trondheim S"],
      state: "planned",
      validFrom: "2026-06-20T02:20:00.000Z",
      validTo: "2026-06-22T04:00:00.000Z",
    });
    expect(result.rawItemsByGuid.get("04ef7d8f-f6cf-40b8-915c-e14c1fad3708")).toBeTruthy();
  });

  it("mirrors rail messages to source_items without promotion metadata", async () => {
    const xml = await readFile(fixturePath, "utf8");
    const result = parseBaneNorRss(xml, { receivedAt: "2026-06-02T07:15:00.000Z" });
    const message = result.messages[0]!;
    const item = baneNorSourceItemInput(message, {
      fetchedAt: "2026-06-02T07:15:00.000Z",
      rawItem: result.rawItemsByGuid.get(message.guid)!,
    });

    expect(item).toMatchObject({
      provider: "bane_nor",
      kind: "official_event",
      externalId: message.guid,
      title: "Trondheim S-Hell",
      reliabilityTier: "official",
    });
    expect(item.rawPayload).toEqual(result.rawItemsByGuid.get(message.guid));
    expect(item.normalizedPayload).toMatchObject({ promotion: "none" });
  });
});
```

**Step 3: Run to verify failure**

Run:

```bash
npm test -- apps/worker/test/bane-nor.test.ts
```

Expected before implementation: FAIL because `../src/baneNor.js` does not exist.

**Step 4: Implement parser and source-item mapper**

Create `apps/worker/src/baneNor.ts`:

```ts
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { SourceItemInput } from "@nytt/shared";

export const baneNorRssEndpoint =
  "https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true";

export interface BaneNorRailMessage {
  id: string;
  source: "bane_nor";
  guid: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  receivedAt: string;
  state: "active" | "planned" | "unknown";
  validFrom?: string;
  validTo?: string;
  matchedTerms: string[];
  promotion: "none";
}

const railTerms = [
  "Trondheim S",
  "Leangen",
  "Marienborg",
  "Støren",
  "Hell",
  "Steinkjer",
  "Storlien",
  "Dombås",
  "Levanger",
  "Åsen",
  "Ronglan",
  "Nordlandsbanen",
  "Dovrebanen",
  "Meråkerbanen",
  "Trønderbanen",
  "Rørosbanen",
];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sha256(JSON.stringify([provider, kind, stableKey]))}`;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) return String(value["#text"]).trim();
  return "";
}

function canonicalUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Invalid Bane NOR URL");
  url.hash = "";
  return url.toString();
}

function matchedRailTerms(text: string): string[] {
  const normalized = text.toLocaleLowerCase("nb");
  return railTerms.filter((term) => normalized.includes(term.toLocaleLowerCase("nb"))).sort();
}

const monthIndex: Record<string, number> = {
  januar: 0,
  februar: 1,
  mars: 2,
  april: 3,
  mai: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  desember: 11,
};

function osloWallClockIso(
  year: number,
  monthName: string,
  day: string,
  hour: string,
  minute: string,
): string | undefined {
  const month = monthIndex[monthName.toLocaleLowerCase("nb")];
  if (month === undefined) return undefined;
  const wallClockUtc = Date.UTC(year, month, Number(day), Number(hour), Number(minute));
  const offsetName = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Oslo",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(wallClockUtc))
    .find((part) => part.type === "timeZoneName")?.value;
  const offsetMatch = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offsetMatch) return undefined;
  const [, direction, offsetHours, offsetMinutes = "0"] = offsetMatch;
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * (direction === "+" ? 1 : -1);
  return new Date(wallClockUtc - offset * 60_000).toISOString();
}

function parseValidityWindow(
  text: string,
  receivedAt: string,
): { validFrom?: string; validTo?: string } {
  const year = new Date(receivedAt).getFullYear();
  const match =
    /fra\s+\w+\s+(\d{1,2})\.\s+(\w+)\s+kl\.\s+(\d{2}):(\d{2})\s+til\s+\w+\s+(\d{1,2})\.\s+(\w+)\s+kl\.\s+(\d{2}):(\d{2})/i.exec(
      text,
    );
  if (!match) return {};
  const [, fromDay, fromMonth, fromHour, fromMinute, toDay, toMonth, toHour, toMinute] = match;
  return {
    validFrom: osloWallClockIso(year, fromMonth!, fromDay!, fromHour!, fromMinute!),
    validTo: osloWallClockIso(year, toMonth!, toDay!, toHour!, toMinute!),
  };
}

function stateFromValidity(
  text: string,
  receivedAt: string,
  validFrom?: string,
  validTo?: string,
): BaneNorRailMessage["state"] {
  const receivedMs = Date.parse(receivedAt);
  const fromMs = validFrom ? Date.parse(validFrom) : Number.NaN;
  const toMs = validTo ? Date.parse(validTo) : Number.NaN;
  if (Number.isFinite(toMs) && toMs < receivedMs) return "unknown";
  if (Number.isFinite(fromMs) && fromMs > receivedMs) return "planned";
  if (/stengt|closed|buss for tog/i.test(text)) return "active";
  if (Number.isFinite(fromMs)) return "planned";
  return "unknown";
}

export function parseBaneNorRss(
  xml: string,
  options: { receivedAt: string },
): { messages: BaneNorRailMessage[]; seenGuids: string[]; rawItemsByGuid: Map<string, unknown> } {
  const feed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(xml) as {
    rss?: { channel?: { item?: Array<Record<string, unknown>> | Record<string, unknown> } };
  };
  const messages: BaneNorRailMessage[] = [];
  const rawItemsByGuid = new Map<string, unknown>();

  for (const item of asArray(feed.rss?.channel?.item)) {
    const title = textValue(item.title);
    const description = textValue(item.description)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const guid = textValue(item.guid);
    const link = textValue(item.link);
    if (!title || !description || !guid || !link) continue;
    const terms = matchedRailTerms(`${title} ${description}`);
    if (!terms.length) continue;
    let url: string;
    try {
      url = canonicalUrl(link);
    } catch {
      continue;
    }
    const parsedPublishedAt = new Date(textValue(item.pubDate) || options.receivedAt);
    const publishedAt = Number.isNaN(parsedPublishedAt.getTime())
      ? options.receivedAt
      : parsedPublishedAt.toISOString();
    const validity = parseValidityWindow(`${title} ${description}`, options.receivedAt);
    const message: BaneNorRailMessage = {
      id: `bane-nor:${guid}`,
      source: "bane_nor",
      guid,
      title,
      description: description.slice(0, 500),
      url,
      publishedAt,
      receivedAt: options.receivedAt,
      state: stateFromValidity(
        `${title} ${description}`,
        options.receivedAt,
        validity.validFrom,
        validity.validTo,
      ),
      ...(validity.validFrom ? { validFrom: validity.validFrom } : {}),
      ...(validity.validTo ? { validTo: validity.validTo } : {}),
      matchedTerms: terms,
      promotion: "none",
    };
    messages.push(message);
    rawItemsByGuid.set(guid, item);
  }

  return { messages, seenGuids: messages.map((message) => message.guid), rawItemsByGuid };
}

export function baneNorSourceItemInput(
  message: BaneNorRailMessage,
  options: { fetchedAt: string; rawItem: unknown },
): SourceItemInput {
  return {
    id: sourceItemId("bane_nor", "official_event", message.guid),
    provider: "bane_nor",
    kind: "official_event",
    externalId: message.guid,
    originalUrl: message.url,
    title: message.title,
    summary: message.description,
    publishedAt: message.publishedAt,
    fetchedAt: options.fetchedAt,
    rawPayload: options.rawItem,
    normalizedPayload: message,
    captureHash: sha256(
      JSON.stringify([
        "bane_nor",
        "official_event",
        message.guid,
        message.title,
        message.publishedAt,
        message.description,
        message.validFrom,
        message.validTo,
      ]),
    ),
    reliabilityTier: "official",
  };
}

export async function fetchBaneNorRailMessages({
  endpoint = baneNorRssEndpoint,
  receivedAt = new Date().toISOString(),
  fetcher = fetch,
}: {
  endpoint?: string;
  receivedAt?: string;
  fetcher?: typeof fetch;
} = {}): Promise<ReturnType<typeof parseBaneNorRss>> {
  const response = await fetcher(endpoint, {
    headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
  });
  if (!response.ok) throw new Error(`Bane NOR RSS fetch failed ${response.status}`);
  return parseBaneNorRss(await response.text(), { receivedAt });
}
```

**Step 5: Run parser tests**

Run:

```bash
npm test -- apps/worker/test/bane-nor.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/baneNor.ts apps/worker/test/bane-nor.test.ts apps/worker/test/fixtures/bane-nor-rss.xml
git commit -m "feat: parse Bane NOR rail context RSS"
```

---

### Task 8: Add repository guard for Bane NOR source items

**Objective:** Let the worker persist Bane NOR ledger rows through a narrow repository method that rejects wrong providers/kinds.

**Files:**

- Modify: `apps/worker/src/repository.ts:141-167`
- Modify: `apps/worker/test/repository.test.ts`

**Step 1: Write failing repository test**

In `apps/worker/test/repository.test.ts`, add a test near existing source-item/repository tests:

```ts
it("upserts only Bane NOR official-event source items through the Bane NOR guard", async () => {
  const repository = new WorkerRepository(pool);
  const valid = {
    id: "source:bane-nor-test",
    provider: "bane_nor" as const,
    kind: "official_event" as const,
    externalId: "guid-1",
    originalUrl: "https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/",
    title: "Trondheim S-Hell",
    summary: "Stengt for trafikk.",
    publishedAt: "2026-06-02T07:10:00.000Z",
    fetchedAt: "2026-06-02T07:15:00.000Z",
    rawPayload: { guid: "guid-1" },
    normalizedPayload: { promotion: "none" },
    captureHash: "bane-nor-capture-hash",
    reliabilityTier: "official" as const,
  };

  await repository.upsertBaneNorSourceItems([valid]);
  await expect(
    repository.upsertBaneNorSourceItems([{ ...valid, provider: "entur" as const }]),
  ).rejects.toThrow(/Bane NOR/);
});
```

Adjust the test harness names (`pool`, setup helpers) to match the existing `repository.test.ts` structure.

**Step 2: Run to verify failure**

Run:

```bash
npm test -- apps/worker/test/repository.test.ts -t "Bane NOR"
```

Expected before implementation: FAIL because `upsertBaneNorSourceItems` does not exist.

**Step 3: Implement the guard**

Add to `WorkerRepository` after `upsertEnturServiceAlertSourceItems`:

```ts
async upsertBaneNorSourceItems(items: SourceItemInput[]): Promise<void> {
  for (const item of items) {
    if (item.provider !== "bane_nor" || item.kind !== "official_event") {
      throw new Error("upsertBaneNorSourceItems only accepts Bane NOR official_event items");
    }
  }

  for (const item of items) {
    await this.upsertSourceItem(item);
  }
}
```

**Step 4: Add repository SQL non-promotion assertion**

In the same test, inspect `query.mock.calls` after `upsertBaneNorSourceItems([valid])`:

```ts
const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
const joinedSql = sqlCalls.join("\n");
expect(sqlCalls.some((sql) => sql.includes("INSERT INTO source_items"))).toBe(true);
expect(joinedSql).not.toContain("INSERT INTO official_events");
expect(joinedSql).not.toContain("INSERT INTO traffic_map_events");
expect(joinedSql).not.toContain("INSERT INTO situations");
expect(joinedSql).not.toContain("INSERT INTO situation_source_items");
```

This matches the current mocked-`pg.Pool.query` repository test harness.

**Step 5: Run repository test**

Run:

```bash
npm test -- apps/worker/test/repository.test.ts -t "Bane NOR"
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: persist Bane NOR source items"
```

---

### Task 9: Add Bane NOR worker collection helper with source health

**Objective:** Add a narrow, injectable worker helper that fetches Bane NOR RSS, persists source items, and records source health without touching situations.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/test/index.test.ts` or create `apps/worker/test/bane-nor-collection.test.ts`

**Step 1: Write failing helper test**

Create `apps/worker/test/bane-nor-collection.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SourceHealth, SourceItemInput } from "@nytt/shared";
import { collectBaneNorRailContext } from "../src/index.js";

function repositoryStub() {
  const sourceItems: SourceItemInput[] = [];
  const health: SourceHealth[] = [];
  return {
    sourceItems,
    health,
    repository: {
      upsertBaneNorSourceItems: vi.fn(async (items: SourceItemInput[]) =>
        sourceItems.push(...items),
      ),
      setHealth: vi.fn(async (item: SourceHealth) => health.push(item)),
    },
  };
}

describe("Bane NOR worker collection", () => {
  it("stores Bane NOR source items and writes ok source health", async () => {
    const { repository, sourceItems, health } = repositoryStub();
    const parserResult = {
      messages: [
        {
          id: "bane-nor:guid-1",
          source: "bane_nor" as const,
          guid: "guid-1",
          title: "Trondheim S-Hell",
          description: "Strekningen blir stengt for trafikk.",
          url: "https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/",
          publishedAt: "2026-06-02T07:10:00.000Z",
          receivedAt: "2026-06-02T07:15:00.000Z",
          state: "planned" as const,
          matchedTerms: ["Hell", "Trondheim S"],
          promotion: "none" as const,
        },
      ],
      seenGuids: ["guid-1"],
      rawItemsByGuid: new Map<string, unknown>([["guid-1", { guid: "guid-1" }]]),
    };

    await collectBaneNorRailContext({
      repository: repository as never,
      nextPollAt: "2026-06-02T07:25:00.000Z",
      now: () => new Date("2026-06-02T07:15:00.000Z"),
      collector: async () => parserResult,
    });

    expect(sourceItems).toHaveLength(1);
    expect(sourceItems[0]).toMatchObject({ provider: "bane_nor", kind: "official_event" });
    expect(health[0]).toMatchObject({ source: "bane_nor", state: "ok" });
  });

  it("records degraded health when Bane NOR fetch fails", async () => {
    const { repository, health } = repositoryStub();

    await collectBaneNorRailContext({
      repository: repository as never,
      nextPollAt: "2026-06-02T07:25:00.000Z",
      now: () => new Date("2026-06-02T07:15:00.000Z"),
      collector: async () => {
        throw new Error("rss unavailable");
      },
    });

    expect(health[0]).toMatchObject({ source: "bane_nor", state: "degraded" });
    expect(health[0]?.detail).toContain("rss unavailable");
  });
});
```

**Step 2: Run to verify failure**

Run:

```bash
npm test -- apps/worker/test/bane-nor-collection.test.ts
```

Expected before implementation: FAIL because `collectBaneNorRailContext` is not exported.

**Step 3: Implement helper**

In `apps/worker/src/index.ts`, import:

```ts
import { baneNorSourceItemInput, fetchBaneNorRailMessages } from "./baneNor.js";
```

Add an exported helper before `collectAll`:

```ts
export async function collectBaneNorRailContext({
  repository,
  nextPollAt,
  now = () => new Date(),
  collector = fetchBaneNorRailMessages,
}: {
  repository: Pick<WorkerRepository, "upsertBaneNorSourceItems" | "setHealth">;
  nextPollAt: string;
  now?: () => Date;
  collector?: typeof fetchBaneNorRailMessages;
}): Promise<void> {
  const checkedAt = now().toISOString();
  try {
    const result = await collector({ receivedAt: checkedAt });
    const items = result.messages.map((message) =>
      baneNorSourceItemInput(message, {
        fetchedAt: checkedAt,
        rawItem: result.rawItemsByGuid.get(message.guid) ?? message,
      }),
    );
    await repository.upsertBaneNorSourceItems(items);
    await repository.setHealth({
      source: "bane_nor",
      label: "Bane NOR trafikkmeldinger",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${items.length} relevante Bane NOR trafikkmeldinger hentet`,
    });
  } catch (error) {
    const failedAt = now().toISOString();
    await repository.setHealth({
      source: "bane_nor",
      label: "Bane NOR trafikkmeldinger",
      state: "degraded",
      lastCheckedAt: failedAt,
      lastFailureAt: failedAt,
      nextPollAt,
      detail: `Bane NOR RSS feilet: ${String(error)}`,
    });
  }
}
```

**Step 4: Run helper test**

Run:

```bash
npm test -- apps/worker/test/bane-nor-collection.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/test/bane-nor-collection.test.ts
git commit -m "feat: collect Bane NOR rail source health"
```

---

### Task 10: Wire Bane NOR into `collectAll`

**Objective:** Make the worker call the Bane NOR helper once per collection cycle while preserving source-health visibility.

**Files:**

- Modify: `apps/worker/src/index.ts:599-720`
- Modify: `apps/worker/test/index.test.ts` if it asserts worker source order/health.

**Step 1: Confirm Bane NOR contract enablement**

Before wiring, re-open `docs/source-contracts/bane-nor-rss.md` and confirm it contains:

```md
- Enablement decision: allowed for phase-1 summary/link RSS collection as of
```

If the contract says blocked/pending, stop here and do not wire the collector.

**Step 2: Add the call**

In `collectAll`, after `collectEnturServiceAlerts(...)` or near the other transport context collectors, add:

```ts
await collectBaneNorRailContext({ repository, nextPollAt });
```

Do not wrap this in another empty catch; the helper already writes degraded source health.

**Step 3: Run targeted worker tests**

Run:

```bash
npm test -- apps/worker/test/index.test.ts apps/worker/test/bane-nor-collection.test.ts
```

Expected: PASS.

**Step 4: Verify no accidental situation/official-event wiring strings**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('apps/worker/src/index.ts').read_text()
assert 'collectBaneNorRailContext' in text and 'nextPollAt' in text
assert 'official_events' not in Path('apps/worker/src/baneNor.ts').read_text()
assert 'situations' not in Path('apps/worker/src/baneNor.ts').read_text()
print('Bane NOR helper is source-item/source-health only')
PY
```

Expected: `Bane NOR helper is source-item/source-health only`.

**Step 4: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/test/index.test.ts apps/worker/test/bane-nor-collection.test.ts
git commit -m "feat: wire Bane NOR rail context collection"
```

---

### Task 11: Add non-promotion regression checks

**Objective:** Prove Bane NOR RSS cannot silently enter `official_events`, `traffic_map_events`, or `situations` in this phase.

**Files:**

- Modify: `apps/worker/test/bane-nor-collection.test.ts`
- Modify: `apps/worker/test/repository.test.ts` if Task 8 did not already include the SQL assertions.

**Step 1: Add explicit helper-level negative assertions with the Bane NOR parser fixture**

Extend `apps/worker/test/bane-nor-collection.test.ts` with imports and a non-promotion test that uses the real parser path:

```ts
import { readFile } from "node:fs/promises";
import { parseBaneNorRss } from "../src/baneNor.js";

const fixturePath = new URL("./fixtures/bane-nor-rss.xml", import.meta.url);
```

Then add:

```ts
it("does not promote Bane NOR RSS into official events, map events, or situations", async () => {
  const forbidden = {
    upsertOfficialEvents: vi.fn(),
    upsertTrafficMapEvents: vi.fn(),
    upsertSituation: vi.fn(),
  };
  const { repository, sourceItems } = repositoryStub();
  const xml = await readFile(fixturePath, "utf8");
  const parserResult = parseBaneNorRss(xml, {
    receivedAt: "2026-06-02T07:15:00.000Z",
  });

  expect(parserResult.messages).toHaveLength(1);
  expect(parserResult.messages[0]).toMatchObject({
    guid: "04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
    title: "Trondheim S-Hell",
    state: "planned",
    validFrom: "2026-06-20T02:20:00.000Z",
    validTo: "2026-06-22T04:00:00.000Z",
  });

  await collectBaneNorRailContext({
    repository: { ...repository, ...forbidden } as never,
    nextPollAt: "2026-06-02T07:25:00.000Z",
    now: () => new Date("2026-06-02T07:15:00.000Z"),
    collector: async () => parserResult,
  });

  expect(sourceItems).toHaveLength(1);
  expect(sourceItems[0]).toMatchObject({
    provider: "bane_nor",
    kind: "official_event",
    externalId: "04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
  });
  expect(forbidden.upsertOfficialEvents).not.toHaveBeenCalled();
  expect(forbidden.upsertTrafficMapEvents).not.toHaveBeenCalled();
  expect(forbidden.upsertSituation).not.toHaveBeenCalled();
});
```

**Step 2: Ensure repository SQL assertions exist**

If Task 8 did not add the SQL-level assertion, add it now in `apps/worker/test/repository.test.ts`:

```ts
const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
expect(sqlCalls.some((sql) => sql.includes("INSERT INTO source_items"))).toBe(true);
expect(sqlCalls.join("\n")).not.toContain("INSERT INTO official_events");
expect(sqlCalls.join("\n")).not.toContain("INSERT INTO traffic_map_events");
expect(sqlCalls.join("\n")).not.toContain("INSERT INTO situations");
expect(sqlCalls.join("\n")).not.toContain("INSERT INTO situation_source_items");
```

**Step 3: Run targeted tests**

Run:

```bash
npm test -- apps/worker/test/bane-nor-collection.test.ts apps/worker/test/bane-nor.test.ts apps/worker/test/repository.test.ts -t "Bane NOR|WorkerRepository"
```

Expected: PASS. If the `-t` filter accidentally excludes needed tests, rerun the three files without `-t`.

**Step 4: Commit**

```bash
git add apps/worker/test/bane-nor-collection.test.ts apps/worker/test/repository.test.ts
git commit -m "test: keep Bane NOR out of incident promotion"
```

---

### Task 12: Update docs for Bane NOR and future source order

**Objective:** Keep repo docs aligned with the new source contract and adapter boundary.

**Files:**

- Modify: `docs/SOURCES.md`
- Modify: `docs/plans/2026-06-02-source-bank-review.md`
- Optional modify: `README.md` if it lists source types.

**Step 1: Update `docs/SOURCES.md`**

Add under `Official And Geographic Layers`:

```md
- Bane NOR RSS `https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true` is collected as official rail/mobility context after its source contract. It is mirrored to `source_items` provider `bane_nor`, kind `official_event`, but does not create `official_events`, `traffic_map_events`, or `situations` in this phase.
```

**Step 2: Update source-bank review status**

In `docs/plans/2026-06-02-source-bank-review.md`, add a status line under Bane NOR:

```md
Implementation status: planned in `docs/plans/2026-06-02-source-contracts-and-rail-context.md`; first implementation is source-items/source-health only.
```

**Step 3: Verify docs mention no-promotion**

Run:

```bash
grep -n "provider \`bane_nor\`" docs/SOURCES.md
grep -n "source-items/source-health only" docs/plans/2026-06-02-source-bank-review.md
```

Expected: both commands print a matching line.

**Step 4: Commit**

```bash
git add docs/SOURCES.md docs/plans/2026-06-02-source-bank-review.md README.md
git commit -m "docs: document Bane NOR source boundary"
```

If `README.md` was not changed, omit it from `git add`.

---

### Task 13: Update Obsidian Nytt knowledge bank

**Objective:** Make Obsidian the project info bank for the implemented plan and source contracts.

**Files:**

- Modify: `/Users/reidar/Obsidian/Hvelvet/01_Projects/Nytt_Trondheim/15-Kildebank-og-kildekontrakter.md`
- Modify: `/Users/reidar/Obsidian/Hvelvet/01_Projects/Nytt_Trondheim/03-Dataflyt-og-kilder.md`
- Modify: `/Users/reidar/Obsidian/Hvelvet/01_Projects/Nytt_Trondheim/12-Anbefalt-roadmap.md`

**Step 1: Update `15-Kildebank-og-kildekontrakter.md`**

Add a section:

```md
## Implementeringsplan: source contracts + Bane NOR

Repo-plan: `/Users/reidar/Projectos/Nytt/docs/plans/2026-06-02-source-contracts-and-rail-context.md`.

Planen gjør tre ting i riktig rekkefølge:

1. Fikser eksisterende værberedskapstest som feilet på datodrift.
2. Legger kildekontrakter for Bane NOR, Trondheim Notify og Trøndelag fylkeskommune.
3. Implementerer kun Bane NOR som `source_items` + `source_health`, uten situasjonspromotering.
```

After execution, update the section with final commit SHAs.

**Step 2: Update `03-Dataflyt-og-kilder.md`**

If Bane NOR is implemented, add it to official/geographic sources as rail context and explicitly state no auto-promotion.

**Step 3: Update roadmap**

In `12-Anbefalt-roadmap.md`, mark Bane NOR source contract/phase-1 rail context as done only after code/tests pass.

**Step 4: Verify Obsidian backlinks**

Run:

```bash
grep -R "source-contracts-and-rail-context" "/Users/reidar/Obsidian/Hvelvet/01_Projects/Nytt_Trondheim"
grep -R "Bane NOR" "/Users/reidar/Obsidian/Hvelvet/01_Projects/Nytt_Trondheim"
```

Expected: both commands print matching lines.

**Step 5: No git commit for Obsidian**

The Obsidian vault is not currently a git repo. Do not claim a notes commit unless that changes.

---

### Task 14: Run full local gates and final audit

**Objective:** Prove the implementation is locally green and did not violate source/provenance boundaries.

**Files:**

- No code changes expected unless gates find a bug.

**Step 1: Run full gates**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm run lint
npm run typecheck
npm test
npm run format:check
```

Expected:

```text
LINT: exit 0
TYPECHECK: exit 0
TEST: all test files passed
FORMAT: all matched files use Prettier code style
```

**Step 2: Run boundary grep checks**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
bane = Path('apps/worker/src/baneNor.ts').read_text()
assert 'official_events' not in bane
assert 'traffic_map_events' not in bane
assert 'situations' not in bane
shared = Path('packages/shared/src/types.ts').read_text()
assert '"bane_nor"' in shared
print('Bane NOR boundary checks passed')
PY
```

Expected: `Bane NOR boundary checks passed`.

**Step 3: Review git diff/log**

Run:

```bash
git status -sb
git log --oneline --decorate -8
git diff --stat origin/main..HEAD || true
```

Expected:

- Only expected untracked pre-existing artifacts remain: `.hcodex-swarm/`, `HJZyzpGaEAEz4P3.jpeg`, `nytt-trondheim-consolidated-research.md` unless separately cleaned.
- Task commits are visible and descriptive.

**Step 4: Post-implementation review**

Dispatch a read-only review subagent with this prompt:

```text
Review the Bane NOR implementation against docs/ARCHITECTURE.md, docs/SOURCES.md, docs/source-contracts/bane-nor-rss.md, and docs/plans/2026-06-02-source-contracts-and-rail-context.md.

Check:
- Source contract obeyed.
- Raw RSS item payload preserved.
- Bane NOR rows are source_items/source_health only.
- No official_events, traffic_map_events, or situations are created.
- Source health reports degraded on fetch/parse failure.
- Tests and docs match actual behavior.

Output PASS or specific blockers.
```

If blockers are found, patch and re-review before final summary.

**Step 5: Production verification commands for later deploy only**

Do not run or claim deploy in this plan. After a future verified deploy, run:

```sql
SELECT count(*) FROM source_items WHERE provider='bane_nor';
SELECT count(*) FROM official_events WHERE source='bane_nor';
SELECT count(*) FROM traffic_map_events WHERE source='bane_nor';
SELECT count(*) FROM situations WHERE payload::text ILIKE '%bane_nor%';
SELECT source, state, detail, last_checked_at FROM source_health WHERE source='bane_nor';
```

Expected for phase 1:

- `source_items` count can be `> 0`.
- `official_events`, `traffic_map_events`, and `situations` counts must be `0`.
- `source_health` should be `ok` or honestly `degraded`, never silently absent after worker run.

---

## Execution and production verification ledger

This plan was implemented and then promoted after the original local-only scope. Keep the evidence here so later source-contract work has a concrete precedent for local gates, CI/deploy evidence and production invariants.

### Final implementation commits

- `4d1fa67` test: stabilize weather preparedness fixtures
- `85ea36e` docs: add source contract template
- `a8705b4` docs: add Bane NOR RSS source contract
- `c5cdcf1` docs: add Trondheim Notify source contract
- `84a2fd1` docs: add Trøndelag fylke source contract
- `cfd0018` feat: add Bane NOR source identifier
- `f4a5c5f` feat: parse Bane NOR rail context RSS
- `8757d5e` fix: harden Bane NOR validity parsing
- `bafddd0` feat: persist Bane NOR source items
- `b2e82f5` feat: collect Bane NOR rail source health
- `03c0744` feat: wire Bane NOR rail context collection
- `bbe2383` test: keep Bane NOR out of incident promotion
- `d4243ef` docs: document Bane NOR source boundary
- `c74981c` style: format Bane NOR source-contract work
- `5a7ba7f` docs: align Bane NOR validity contract
- `b418e28` merge: integrate main into Nytt source bank branch
- `6a2a793` docs: state Bane NOR source health boundary

### Local verification after merging `origin/main`

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 58 test files and 340 tests.
- `npm run format:check`: passed.
- Bane NOR boundary check passed: parser code does not write `official_events`, `traffic_map_events` or `situations`, and shared types include `"bane_nor"`.
- Spec-compliance review: PASS.
- Code-quality review: APPROVED.

### GitHub and production evidence

- Final promoted SHA: `6a2a79331900d38bbcf9d6d9c30de03074a451ee`.
- `origin/main` and `origin/review/nytt-source-bank` both resolved to that SHA after promotion.
- Main `CI` run `26835662258`: `status=completed`, `conclusion=success`, `event=push`, `headSha=6a2a79331900d38bbcf9d6d9c30de03074a451ee`.
- `Deploy to VPS` run `26835764423`: `status=completed`, `conclusion=success`, `event=workflow_run`, `headSha=6a2a79331900d38bbcf9d6d9c30de03074a451ee`.
- Public `https://nytt.reidar.tech/health` returned `{"status":"ok","storage":"postgres"}`.
- Public `https://nytt.reidar.tech/trafikk` returned `200 text/html`.
- VPS checkout `/home/deploy/nytt-trondheim` matched the final SHA; `app` and `postgres` were healthy and `worker` was running.
- Deploy-time runtime status files showed `backup.json` and `restore-check.json` with `status="ok"`.
- The worker completed a post-deploy collection cycle after promotion.

### Production source-boundary evidence

Post-deploy source-health and invariants on 2026-06-02 showed:

- `source_health | bane_nor | ok | 11 relevante Bane NOR trafikkmeldinger hentet`.
- `source_items | bane_nor | official_event | 11`.
- `raw_payload_non_null | 11` for Bane NOR source items.
- Bane NOR normalized state counts: `active | 4`, `planned | 7`.
- Sample Bane NOR row: provider `bane_nor`, kind `official_event`, reliability `official`, promotion `none`, raw payload present.
- `official_events WHERE source='bane_nor'`: `0`.
- `traffic_map_events WHERE source='bane_nor'`: `0`.
- `situations WHERE payload->>'officialSource'='bane_nor'`: `0`.
- Broader source-boundary checks also confirmed no Entur vehicle telemetry or context telemetry leaked into `source_items`, and no Bane NOR/Entur/context telemetry source accidentally activated situations.

Frontend caveat: this release does not expose Bane NOR as a public UI feature. The built frontend bundle does not need the literal string `Bane NOR`; the verified phase-1 contract is source-health/source-items ingestion plus non-promotion.

---

## Plan review checklist

- [x] Architecture docs read: `docs/ARCHITECTURE.md`, `docs/SOURCES.md`.
- [x] External feed ingestion checklist applied.
- [x] Source-item ledger checklist applied.
- [x] External feed/map blocker checklist considered; no map layer is added in this phase.
- [x] Runtime heartbeat dependency chains identified.
- [x] Source-health degradation path included.
- [x] Raw upstream RSS item preservation included.
- [x] No-promotion rules included and tested.
- [x] Production SQL checks included for later deploy.
- [x] Obsidian update included.

## Plan review history

- 2026-06-02 initial draft: created after reading architecture/source docs, weather test failures, worker/repository/source schemas, external feed ingestion checklist, source-item ledger notes, and external feed/map blockers.
- 2026-06-02 independent review: REQUEST_CHANGES. Blockers: validity-aware Bane NOR state, legal/robots enablement gate, incomplete Notify/Fylke contracts, weak non-promotion test, inconsistent capture hash, and wrong `upsertSituations` method name.
- 2026-06-02 patch: added Bane NOR enablement gate, expanded Notify/Fylke contract sections, made Bane NOR parser plan validity-aware with `seenGuids`, included title/validity in capture hash, added repository SQL non-promotion checks, and corrected non-promotion method names to `upsertSituation`.
- 2026-06-02 focused re-review: REQUEST_CHANGES. Remaining blockers: invalid `sqlCalls.join` snippet, non-promotion helper test still used synthetic message, and robots command did not print `robots.txt` body.
- 2026-06-02 second patch: replaced SQL snippet with `joinedSql`, changed non-promotion test to use the Bane NOR XML fixture plus `parseBaneNorRss`, and changed robots probe to print the first 4000 characters of `robots.txt`.
- 2026-06-02 second focused re-review: PASS. Reviewer verified the SQL snippet, fixture-backed non-promotion test, and robots body output; no new blockers found.
