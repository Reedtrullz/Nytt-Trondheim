# DATEX Situation Ingestion Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the newly configured Statens vegvesen DATEX II v3.1 access from a health check into official traffic situation ingestion for Nytt, creating map-backed official road-disruption situations for Trondheim/Trøndelag while preserving source provenance and avoiding noisy roadwork spam.

**Architecture:** Add a dedicated worker module, `apps/worker/src/datex.ts`, that owns DATEX Basic Auth, `If-Modified-Since`, XML parsing, Trondheim/Trøndelag relevance filtering, and `OfficialEvent` conversion. The worker persists parsed DATEX events into `official_events`, records collector state, expires missing snapshot events, and promotes only high-impact DATEX traffic events into normal `situations` using official evidence and official map geometry. Existing server/frontend APIs can surface the result through the current situation, evidence, timeline, source-health, and map-feature paths.

**Tech Stack:** TypeScript, Node 22, fast-xml-parser, Vitest, PostgreSQL/PostGIS, React/Leaflet, GitHub Actions + Ansible + GHCR deployment.

---

## Scope

Build the first DATEX product layer: `GetSituation/pullsnapshotdata` ingestion.

In scope:

- Basic Auth reuse through `DATEX_USERNAME` / `DATEX_PASSWORD`.
- `If-Modified-Since` request header and `Last-Modified` persistence.
- DATEX XML parsing with namespace removal.
- Relevant Trondheim/Trøndelag official traffic events stored as `OfficialEvent` rows.
- Direct promotion of high-impact official traffic events into `situations`.
- Official map features when DATEX publishes coordinates.
- Source health showing parsed/active event counts.
- Docs updated so future work knows TravelTime/weather/CCTV are follow-up data products.

Out of scope for this plan:

- Travel-time dashboard (`GetTravelTimeData`) — follow-up after situation ingestion.
- Road weather enrichment (`GetMeasuredWeatherData`) — follow-up, parser-isolated because Vegvesen changed weather publications in 2025.
- CCTV thumbnails — follow-up with explicit freshness/privacy UI.
- New dedicated `/api/traffic` endpoint — existing situation/feed/map surfaces are enough for MVP.

## Architecture Audit

Architecture docs read:

- `docs/ARCHITECTURE.md`
- `docs/SOURCES.md`

Runtime dependency chain:

```text
worker entrypoint
  apps/worker/src/index.ts
    -> collect/probe sources
    -> collect official warnings/events
    -> WorkerRepository.upsertOfficialEvents()
    -> WorkerRepository.currentOfficialEvents()
    -> detectPreliminarySituations()/enhanceSituations()
    -> WorkerRepository.upsertSituation()
server API
  apps/server/src/app.ts
    -> PostgresStore.getBootstrap()/listSituations()/getWorkspace()
frontend
  HomePage/SituationsPage/SituationPage + SituationMap
```

Failure behavior:

- Worker collector failures are caught per official source in `apps/worker/src/index.ts`; this is intentional degraded-state behavior, not silent import swallowing.
- Import/type errors in `datex.ts`, `official.ts`, `clusters.ts`, or shared types should fail `npm run typecheck` or worker startup loudly.
- Parser errors during one DATEX poll must degrade only DATEX health and must not prevent RSS, MET, NVE, or AI processing.

Plan safety decisions:

- Keep DATEX parsing isolated in `apps/worker/src/datex.ts`; do not add DATEX schema probing logic to generic RSS collectors.
- Do not put DATEX credentials in frontend code or test fixtures.
- Store raw parsed DATEX fragments in `OfficialEvent.raw` for debugging, but do not expose raw credential-bearing request metadata.
- DATEX can confirm road state, but DATEX by itself should only create/promote traffic situations for high-impact records. Low-impact/planned maintenance can remain in `official_events` for later traffic-layer UI.
- Every task that changes the worker chain includes `npm run typecheck` or a targeted Vitest command using Node 22.

## Commands

Use Node 22 locally; default Node may be too old.

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- apps/worker/test/datex.test.ts
npm test -- apps/worker/test/official.test.ts apps/worker/test/collectors.test.ts
npm run typecheck
npm test
npm run lint
```

Deployment verification discipline:

- Do not report CI/CD success until `gh run list --json status,conclusion` shows the relevant run as completed success.
- Do not report production deployed until `curl https://nytt.reidar.tech/health` and a DB/source-health check verify the live container.

---

### Task 1: Add DATEX to shared official event types

**Objective:** Allow `OfficialEvent` and `Situation.activationBasis` to represent DATEX-origin official traffic situations.

**Files:**

- Modify: `packages/shared/src/types.ts`
- Test: Typecheck through later DATEX tests and `npm run typecheck`

**Step 1: Write a failing compile-time usage in the next test file**

Do not create production code first. In Task 2's test, include an object like this so TypeScript fails until this task is complete:

```ts
import type { OfficialEvent, Situation } from "@nytt/shared";

const event = {
  id: "datex-test",
  source: "datex",
  eventType: "traffic",
  title: "E6 stengt",
  detail: "Stengt ved Tiller",
  sourceUrl:
    "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata",
  areaLabel: "Tiller",
  state: "active",
  publishedAt: "2026-05-28T10:00:00.000Z",
  validFrom: "2026-05-28T10:00:00.000Z",
  validTo: "2026-05-28T12:00:00.000Z",
  raw: {},
} satisfies OfficialEvent;

const situation = {
  activationBasis: {
    rule: "official_source",
    sourceIds: ["datex"],
    articleIds: [],
    activatedAt: "2026-05-28T10:00:00.000Z",
  },
} satisfies Pick<Situation, "activationBasis">;
```

Expected before this task: `source: "datex"` and `rule: "official_source"` are type errors.

**Step 2: Modify shared types**

In `packages/shared/src/types.ts`:

```ts
export interface Situation {
  // ...existing fields...
  officialSource?: Extract<SourceId, "datex">;
  officialEventId?: string;
  activationBasis?: {
    rule: "two_independent_sources" | "official_source";
    sourceIds: SourceId[];
    articleIds: string[];
    activatedAt: string;
  };
  // ...existing fields...
}

export interface OfficialEvent {
  id: string;
  source: "met" | "nve" | "datex";
  // unchanged fields...
}
```

**Step 3: Verify typecheck reaches the intended next failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected after Task 1 only: shared type errors for DATEX source/rule are gone; later missing `datex.ts` imports may still fail once Task 2 tests exist.

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: allow DATEX official traffic event types"
```

---

### Task 2: Add a DATEX parser fixture and first failing parser test

**Objective:** Establish a local DATEX XML fixture and verify a collector can parse one active accident into an `OfficialEvent`.

**Files:**

- Create: `apps/worker/test/fixtures/datex-situation-snapshot.xml`
- Create: `apps/worker/test/datex.test.ts`
- Create: `apps/worker/src/datex.ts` as an empty/skeleton module only after the RED test is written

**Step 1: Write the XML fixture**

Create `apps/worker/test/fixtures/datex-situation-snapshot.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<d2LogicalModel xmlns="http://datex2.eu/schema/3/d2Payload" modelBaseVersion="3">
  <payloadPublication xsi:type="SituationPublication" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" lang="no">
    <publicationTime>2026-05-28T10:00:00Z</publicationTime>
    <publicationCreator><country>no</country><nationalIdentifier>NPRA</nationalIdentifier></publicationCreator>
    <situation id="NO-SVV-1" version="3">
      <overallSeverity>high</overallSeverity>
      <headerInformation><confidentiality>noRestriction</confidentiality></headerInformation>
      <situationRecord xsi:type="Accident" id="NO-SVV-1-R1" version="3">
        <situationRecordCreationTime>2026-05-28T09:55:00Z</situationRecordCreationTime>
        <situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime>
        <probabilityOfOccurrence>certain</probabilityOfOccurrence>
        <severity>high</severity>
        <validity>
          <validityStatus>active</validityStatus>
          <validityTimeSpecification>
            <overallStartTime>2026-05-28T09:55:00Z</overallStartTime>
            <overallEndTime>2026-05-28T12:00:00Z</overallEndTime>
          </validityTimeSpecification>
        </validity>
        <groupOfLocations>
          <locationForDisplay>
            <latitude>63.361</latitude>
            <longitude>10.376</longitude>
          </locationForDisplay>
        </groupOfLocations>
        <generalPublicComment>
          <comment><values><value lang="no">Trafikkulykke på E6 ved Tiller. Ett felt stengt.</value></values></comment>
        </generalPublicComment>
        <roadInformation>
          <roadNumber>E6</roadNumber>
          <roadName>E6 Tiller</roadName>
        </roadInformation>
      </situationRecord>
    </situation>
  </payloadPublication>
</d2LogicalModel>
```

**Step 2: Write the failing parser test**

Create `apps/worker/test/datex.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { OfficialEvent, Situation } from "@nytt/shared";
import { parseDatexSituationPublication } from "../src/datex.js";

const fixturePath = new URL("./fixtures/datex-situation-snapshot.xml", import.meta.url);

// Compile-time guard from Task 1.
const _datexEventTypeCheck = {
  id: "datex-test",
  source: "datex",
  eventType: "traffic",
  title: "E6 stengt",
  detail: "Stengt ved Tiller",
  sourceUrl:
    "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata",
  areaLabel: "Tiller",
  state: "active",
  publishedAt: "2026-05-28T10:00:00.000Z",
  validFrom: "2026-05-28T10:00:00.000Z",
  validTo: "2026-05-28T12:00:00.000Z",
  raw: {},
} satisfies OfficialEvent;

const _officialActivationTypeCheck = {
  activationBasis: {
    rule: "official_source",
    sourceIds: ["datex"],
    articleIds: [],
    activatedAt: "2026-05-28T10:00:00.000Z",
  },
} satisfies Pick<Situation, "activationBasis">;

describe("DATEX situation parsing", () => {
  it("converts a relevant active accident into an official traffic event", async () => {
    const xml = await readFile(fixturePath, "utf8");

    const result = parseDatexSituationPublication(xml, {
      endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
      receivedAt: "2026-05-28T10:05:00.000Z",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "datex",
      eventType: "traffic",
      title: "Trafikkulykke på E6 ved Tiller",
      state: "active",
      areaLabel: "E6 Tiller",
      severity: "high",
      publishedAt: "2026-05-28T10:00:00.000Z",
      validFrom: "2026-05-28T09:55:00.000Z",
      validTo: "2026-05-28T12:00:00.000Z",
    });
    expect(result.events[0]?.geometry).toEqual({ type: "Point", coordinates: [10.376, 63.361] });
    expect(result.events[0]?.raw).toMatchObject({
      datex: { situationId: "NO-SVV-1", recordId: "NO-SVV-1-R1", roadNumber: "E6" },
    });
  });
});
```

**Step 3: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: FAIL because `../src/datex.js` / `parseDatexSituationPublication` does not exist.

**Step 4: Create only a skeleton implementation**

Create `apps/worker/src/datex.ts`:

```ts
import type { OfficialEvent } from "@nytt/shared";

export interface DatexParseOptions {
  endpoint: string;
  receivedAt: string;
}

export interface DatexParseResult {
  events: OfficialEvent[];
}

export function parseDatexSituationPublication(
  _xml: string,
  _options: DatexParseOptions,
): DatexParseResult {
  return { events: [] };
}
```

**Step 5: Re-run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: FAIL with assertion `expected [] to have a length of 1`. This confirms the test is testing missing behavior, not only missing imports.

**Step 6: Commit RED fixture/test/skeleton**

```bash
git add apps/worker/test/fixtures/datex-situation-snapshot.xml apps/worker/test/datex.test.ts apps/worker/src/datex.ts
git commit -m "test: define DATEX situation parser expectations"
```

---

### Task 3: Implement tolerant DATEX object helpers

**Objective:** Add low-level XML/object helpers in `datex.ts` without yet completing full event conversion.

**Files:**

- Modify: `apps/worker/src/datex.ts`
- Test: `apps/worker/test/datex.test.ts`

**Step 1: Add helper-focused tests**

Append to `apps/worker/test/datex.test.ts`:

```ts
import { asDatexArray, datexText, findDatexObjectsWithKey } from "../src/datex.js";

it("normalizes DATEX singleton arrays and text wrappers", () => {
  expect(asDatexArray(undefined)).toEqual([]);
  expect(asDatexArray("one")).toEqual(["one"]);
  expect(asDatexArray(["one", "two"])).toEqual(["one", "two"]);
  expect(datexText({ "#text": "Tiller" })).toBe("Tiller");
  expect(datexText(63.361)).toBe("63.361");
});

it("finds nested DATEX objects by key after namespace removal", () => {
  const tree = { root: { payloadPublication: { situation: [{ id: "one" }] } } };
  expect(findDatexObjectsWithKey(tree, "situation")).toEqual([{ situation: [{ id: "one" }] }]);
});
```

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: FAIL because helper exports do not exist.

**Step 3: Implement helpers**

Add to `apps/worker/src/datex.ts`:

```ts
import { XMLParser } from "fast-xml-parser";

type DatexObject = Record<string, unknown>;

function isObject(value: unknown): value is DatexObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function asDatexArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function datexText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isObject(value) && "#text" in value) return datexText(value["#text"]);
  return "";
}

export function findDatexObjectsWithKey(value: unknown, key: string): DatexObject[] {
  if (Array.isArray(value)) return value.flatMap((item) => findDatexObjectsWithKey(item, key));
  if (!isObject(value)) return [];
  const nested = Object.values(value).flatMap((item) => findDatexObjectsWithKey(item, key));
  return key in value ? [value, ...nested] : nested;
}

function parseXml(xml: string): DatexObject {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    processEntities: false,
  }).parse(xml) as DatexObject;
}
```

**Step 4: Verify GREEN for helper tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: helper tests pass; first parser test may still fail until Task 4.

**Step 5: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/test/datex.test.ts
git commit -m "feat: add DATEX XML traversal helpers"
```

---

### Task 4: Parse DATEX situation records into official events

**Objective:** Make the first fixture test pass by extracting situation IDs, timestamps, validity, comments, coordinates, road fields, and severity.

**Files:**

- Modify: `apps/worker/src/datex.ts`
- Test: `apps/worker/test/datex.test.ts`

**Step 1: Confirm RED still targets event conversion**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: FAIL with the first parser test expecting one event and receiving zero or incomplete fields.

**Step 2: Add version-stability and open-ended-validity regression tests**

Append these tests before implementation so Task 4 covers update/lifecycle edge cases from the start:

```ts
it("keeps the same official event id across DATEX record version updates", async () => {
  const xml = await readFile(fixturePath, "utf8");
  const updated = xml.replaceAll('version="3"', 'version="4"');

  const first = parseDatexSituationPublication(xml, {
    endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
    receivedAt: "2026-05-28T10:05:00.000Z",
  });
  const second = parseDatexSituationPublication(updated, {
    endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
    receivedAt: "2026-05-28T10:10:00.000Z",
  });

  expect(second.events[0]?.id).toBe(first.events[0]?.id);
  expect(second.events[0]?.raw).toMatchObject({ datex: { version: "4" } });
});

it("uses receivedAt as fallback expiry for open-ended active records", () => {
  const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-28T10:00:00Z</publicationTime><situation id="NO-SVV-OPEN" version="1"><situationRecord xsi:type="Accident" id="R1" version="1"><situationRecordCreationTime>2026-05-26T09:55:00Z</situationRecordCreationTime><situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime><validity><validityStatus>active</validityStatus><validityTimeSpecification><overallStartTime>2026-05-26T09:55:00Z</overallStartTime></validityTimeSpecification></validity><groupOfLocations><locationForDisplay><latitude>63.361</latitude><longitude>10.376</longitude></locationForDisplay></groupOfLocations><generalPublicComment><comment><values><value>Ulykke på E6 ved Tiller.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;
  const result = parseDatexSituationPublication(xml, {
    endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
    receivedAt: "2026-05-28T10:05:00.000Z",
  });

  expect(new Date(result.events[0]!.validTo).getTime()).toBeGreaterThan(
    new Date("2026-05-28T10:05:00.000Z").getTime(),
  );
});
```

**Step 3: Implement minimal conversion**

In `apps/worker/src/datex.ts`, implement these helpers and replace `parseDatexSituationPublication`:

```ts
import { createHash } from "node:crypto";
import type { Geometry } from "geojson";
import type { OfficialEvent } from "@nytt/shared";

const defaultSituationValidHours = 24;

function attr(value: unknown, name: string): string {
  return isObject(value) ? datexText(value[`@${name}`] ?? value[name]) : "";
}

function firstText(value: unknown, keys: string[]): string {
  if (!isObject(value)) return "";
  for (const key of keys) {
    const text = datexText(value[key]);
    if (text) return text;
  }
  return "";
}

function recursiveTexts(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(recursiveTexts);
  if (!isObject(value)) return datexText(value) ? [datexText(value)] : [];
  return Object.values(value).flatMap(recursiveTexts).filter(Boolean);
}

function iso(value: unknown, fallback: string): string {
  const date = new Date(datexText(value));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function fallbackValidTo(anchorIso: string): string {
  // Use receivedAt/publication time as the fallback anchor, not overallStartTime.
  // DATEX snapshots may keep open-ended incidents active for days; using the
  // original start time would make currentOfficialEvents drop still-active rows.
  return new Date(
    new Date(anchorIso).getTime() + defaultSituationValidHours * 60 * 60 * 1000,
  ).toISOString();
}

function pointGeometry(record: Record<string, unknown>): Geometry | undefined {
  const groups = findDatexObjectsWithKey(record, "locationForDisplay");
  for (const group of groups) {
    const location = group.locationForDisplay;
    const candidates = asDatexArray(location);
    for (const candidate of candidates) {
      if (!isObject(candidate)) continue;
      const lat = Number(datexText(candidate.latitude));
      const lng = Number(datexText(candidate.longitude));
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { type: "Point", coordinates: [lng, lat] };
      }
    }
  }
  return undefined;
}

function datexId(key: string): string {
  return `datex-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function validityStatus(record: Record<string, unknown>): string {
  const validity = findDatexObjectsWithKey(record, "validityStatus")[0];
  return datexText(validity?.validityStatus).toLocaleLowerCase("en");
}

function eventState(record: Record<string, unknown>): OfficialEvent["state"] {
  const status = validityStatus(record);
  if (["suspended", "cancelled", "definedbyvaliditytimeperiod"].includes(status))
    return "cancelled";
  return "active";
}

function roadNumber(record: Record<string, unknown>): string {
  return firstText(record.roadInformation, ["roadNumber", "roadName"]);
}

function roadName(record: Record<string, unknown>): string {
  return firstText(record.roadInformation, ["roadName", "roadNumber"]);
}

function commentText(record: Record<string, unknown>): string {
  const comments = findDatexObjectsWithKey(record, "generalPublicComment");
  return (
    comments.flatMap((comment) => recursiveTexts(comment.generalPublicComment)).find(Boolean) ?? ""
  );
}

function recordKind(record: Record<string, unknown>): string {
  return attr(record, "type") || attr(record, "xsi:type") || "SituationRecord";
}

function titleForRecord(record: Record<string, unknown>, road: string): string {
  const comment = commentText(record);
  const firstSentence = comment.split(/[.!?]/)[0]?.trim();
  if (firstSentence) return firstSentence;
  const kind = recordKind(record).replace(/([a-z])([A-Z])/g, "$1 $2");
  return road ? `${kind} på ${road}` : kind;
}

export function parseDatexSituationPublication(
  xml: string,
  options: DatexParseOptions,
): DatexParseResult {
  const parsed = parseXml(xml);
  const publication = findDatexObjectsWithKey(parsed, "publicationTime")[0];
  const publicationTime = iso(publication?.publicationTime, options.receivedAt);
  const situations = findDatexObjectsWithKey(parsed, "situation").flatMap((container) =>
    asDatexArray(container.situation),
  );
  const events: OfficialEvent[] = [];

  for (const situation of situations) {
    if (!isObject(situation)) continue;
    const situationId = attr(situation, "id");
    for (const rawRecord of asDatexArray(situation.situationRecord)) {
      if (!isObject(rawRecord)) continue;
      const recordId = attr(rawRecord, "id") || situationId;
      const version = attr(rawRecord, "version") || attr(situation, "version");
      const validFrom = iso(
        findDatexObjectsWithKey(rawRecord, "overallStartTime")[0]?.overallStartTime,
        iso(rawRecord.situationRecordCreationTime, publicationTime),
      );
      const validTo = iso(
        findDatexObjectsWithKey(rawRecord, "overallEndTime")[0]?.overallEndTime,
        fallbackValidTo(options.receivedAt),
      );
      const publishedAt = iso(rawRecord.situationRecordVersionTime, publicationTime);
      const geometry = pointGeometry(rawRecord);
      const road = roadName(rawRecord);
      const title = titleForRecord(rawRecord, road);
      const detail = commentText(rawRecord) || title;
      const severity =
        firstText(rawRecord, ["severity"]) || firstText(situation, ["overallSeverity"]);

      events.push({
        id: datexId(`${situationId}:${recordId}`),
        source: "datex",
        eventType: "traffic",
        title,
        detail,
        sourceUrl: options.endpoint,
        areaLabel: road || "Vegtrafikk",
        state: eventState(rawRecord),
        severity: severity || undefined,
        publishedAt,
        validFrom,
        validTo,
        geometry,
        raw: {
          datex: {
            situationId,
            recordId,
            version,
            recordKind: recordKind(rawRecord),
            roadNumber: roadNumber(rawRecord),
            roadName: roadName(rawRecord),
            receivedAt: options.receivedAt,
          },
          situation,
          record: rawRecord,
        },
      });
    }
  }

  return { events };
}
```

Adjust names if TypeScript complains, but do not broaden behavior beyond the fixture yet.

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: all current DATEX tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/test/datex.test.ts
git commit -m "feat: parse DATEX situation records"
```

---

### Task 5: Add Trondheim/Trøndelag relevance filtering

**Objective:** Prevent national DATEX noise from entering Nytt by retaining only events with coordinates in a rough Trøndelag bounding box or explicit local text.

**Files:**

- Modify: `apps/worker/src/datex.ts`
- Modify: `apps/worker/test/datex.test.ts`

**Step 1: Write failing relevance tests**

Append:

```ts
it("drops DATEX events outside Trøndelag when no local text is present", () => {
  const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-28T10:00:00Z</publicationTime><situation id="NO-SVV-OSLO" version="1"><situationRecord id="R1" version="1"><situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime><validity><validityStatus>active</validityStatus></validity><groupOfLocations><locationForDisplay><latitude>59.91</latitude><longitude>10.75</longitude></locationForDisplay></groupOfLocations><generalPublicComment><comment><values><value>Ulykke på Ring 3.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;

  const result = parseDatexSituationPublication(xml, {
    endpoint: "https://datex.example.test",
    receivedAt: "2026-05-28T10:05:00.000Z",
  });

  expect(result.events).toEqual([]);
});

it("keeps DATEX events with local Trondheim text even when coordinates are missing", () => {
  const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-28T10:00:00Z</publicationTime><situation id="NO-SVV-TRD" version="1"><situationRecord id="R1" version="1"><situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime><validity><validityStatus>active</validityStatus></validity><generalPublicComment><comment><values><value>Vegarbeid i Trondheim sentrum.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;

  const result = parseDatexSituationPublication(xml, {
    endpoint: "https://datex.example.test",
    receivedAt: "2026-05-28T10:05:00.000Z",
  });

  expect(result.events).toHaveLength(1);
  expect(result.events[0]?.areaLabel).toBe("Vegtrafikk");
});
```

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: Oslo event is currently retained, so the first new test fails.

**Step 3: Implement relevance filter**

Add in `apps/worker/src/datex.ts`:

```ts
const trondelagBounds = { minLat: 62.0, maxLat: 65.6, minLng: 8.0, maxLng: 14.8 };
const localTextPattern =
  /\b(trondheim|trøndelag|trondelag|tiller|heimdal|ranheim|lade|byåsen|bymarka|sjetnemarka|e6\s+(ved\s+)?(tiller|heimdal|trondheim)|omkjøringsvegen|stavne|singsaker)\b/i;

function pointInTrondelag(geometry: Geometry | undefined): boolean {
  if (!geometry || geometry.type !== "Point") return false;
  const [lng, lat] = geometry.coordinates;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= trondelagBounds.minLat &&
    lat <= trondelagBounds.maxLat &&
    lng >= trondelagBounds.minLng &&
    lng <= trondelagBounds.maxLng
  );
}

function isRelevantToNytt(event: OfficialEvent): boolean {
  return (
    pointInTrondelag(event.geometry) ||
    localTextPattern.test(`${event.title} ${event.detail} ${event.areaLabel}`)
  );
}
```

Then filter before returning:

```ts
return { events: events.filter(isRelevantToNytt) };
```

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: all DATEX tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/test/datex.test.ts
git commit -m "feat: filter DATEX events for Trondheim relevance"
```

---

### Task 6: Classify high-impact DATEX records for situation promotion

**Objective:** Mark which DATEX events should create visible situations now, while keeping lower-impact roadworks available as official events for future traffic-layer UI.

**Files:**

- Modify: `apps/worker/src/datex.ts`
- Modify: `apps/worker/test/datex.test.ts`

**Step 1: Write failing tests**

Append:

```ts
it("marks accidents and closures as promotable traffic situations", async () => {
  const xml = await readFile(fixturePath, "utf8");
  const result = parseDatexSituationPublication(xml, {
    endpoint: "https://datex.example.test",
    receivedAt: "2026-05-28T10:05:00.000Z",
  });

  expect(result.events[0]?.raw).toMatchObject({
    datex: { promoteToSituation: true, impact: "high" },
  });
});

it("keeps low-impact planned roadworks as official events without promotion", () => {
  const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-28T10:00:00Z</publicationTime><situation id="NO-SVV-WORK" version="1"><situationRecord xsi:type="MaintenanceWorks" id="R1" version="1"><situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime><severity>low</severity><validity><validityStatus>active</validityStatus></validity><generalPublicComment><comment><values><value>Planlagt kantklipp i Trondheim.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;
  const result = parseDatexSituationPublication(xml, {
    endpoint: "https://datex.example.test",
    receivedAt: "2026-05-28T10:05:00.000Z",
  });

  expect(result.events).toHaveLength(1);
  expect(result.events[0]?.raw).toMatchObject({ datex: { promoteToSituation: false } });
});
```

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: raw payload lacks `promoteToSituation` / `impact`.

**Step 3: Implement impact helper**

Add in `apps/worker/src/datex.ts`:

```ts
function datexImpact(
  kind: string,
  severity: string,
  detail: string,
): { impact: "high" | "normal"; promoteToSituation: boolean } {
  const text = `${kind} ${severity} ${detail}`.toLocaleLowerCase("nb");
  const high =
    /accident|ulykke|closed|closure|stengt|blockage|obstruction|hindring|kø|queue|congestion|srti/.test(
      text,
    ) || severity.toLocaleLowerCase("en") === "high";
  const lowMaintenance = /maintenanceworks|roadworks|vegarbeid|kantklipp/.test(text) && !high;
  return { impact: high ? "high" : "normal", promoteToSituation: high && !lowMaintenance };
}
```

When building `raw.datex`, compute:

```ts
const kind = recordKind(rawRecord);
const impact = datexImpact(kind, severity, detail);
```

and include:

```ts
recordKind: kind,
impact: impact.impact,
promoteToSituation: impact.promoteToSituation,
```

Set `importance` later from `impact`, not here.

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: all DATEX tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/test/datex.test.ts
git commit -m "feat: tag high impact DATEX situations"
```

---

### Task 7: Add DATEX authenticated fetch with If-Modified-Since

**Objective:** Fetch DATEX snapshots with Basic Auth and conditional requests without exposing credentials to tests or frontend code.

**Files:**

- Modify: `apps/worker/src/datex.ts`
- Modify: `apps/worker/test/datex.test.ts`

**Step 1: Write failing fetch tests**

Append:

```ts
import { collectDatexSituationEvents } from "../src/datex.js";

it("fetches DATEX with Basic Auth and If-Modified-Since", async () => {
  const xml = await readFile(fixturePath, "utf8");
  let capturedHeaders: Headers | undefined;

  const result = await collectDatexSituationEvents({
    endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
    username: "svv-user",
    password: "svv-pass",
    lastModified: "Wed, 27 May 2026 10:00:00 GMT",
    fetcher: async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(xml, {
        status: 200,
        headers: { "Last-Modified": "Thu, 28 May 2026 10:00:00 GMT" },
      });
    },
    now: () => new Date("2026-05-28T10:05:00.000Z"),
  });

  expect(capturedHeaders?.get("Authorization")).toBe("Basic c3Z2LXVzZXI6c3Z2LXBhc3M=");
  expect(capturedHeaders?.get("If-Modified-Since")).toBe("Wed, 27 May 2026 10:00:00 GMT");
  expect(result.notModified).toBe(false);
  expect(result.lastModified).toBe("Thu, 28 May 2026 10:00:00 GMT");
  expect(result.events).toHaveLength(1);
});

it("returns notModified without parsing a 304 DATEX response", async () => {
  const result = await collectDatexSituationEvents({
    endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
    username: "svv-user",
    password: "svv-pass",
    lastModified: "Wed, 27 May 2026 10:00:00 GMT",
    fetcher: async () => new Response(null, { status: 304 }),
    now: () => new Date("2026-05-28T10:05:00.000Z"),
  });

  expect(result).toMatchObject({ events: [], notModified: true });
});
```

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: FAIL because `collectDatexSituationEvents` does not exist.

**Step 3: Implement fetch wrapper**

In `apps/worker/src/datex.ts`:

```ts
import { Buffer } from "node:buffer";

export interface DatexCollectOptions {
  endpoint: string;
  username: string;
  password: string;
  lastModified?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export interface DatexCollectResult extends DatexParseResult {
  notModified: boolean;
  lastModified?: string;
}

export function datexBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export async function collectDatexSituationEvents({
  endpoint,
  username,
  password,
  lastModified,
  fetcher = fetch,
  now = () => new Date(),
}: DatexCollectOptions): Promise<DatexCollectResult> {
  const headers: Record<string, string> = {
    "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech",
    Authorization: datexBasicAuthHeader(username, password),
  };
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  const response = await fetcher(endpoint, { headers });
  if (response.status === 304) return { events: [], notModified: true, lastModified };
  if (!response.ok) throw new Error(`DATEX returned HTTP ${response.status}`);

  const parsed = parseDatexSituationPublication(await response.text(), {
    endpoint,
    receivedAt: now().toISOString(),
  });
  return {
    ...parsed,
    notModified: false,
    lastModified: response.headers.get("Last-Modified") ?? lastModified,
  };
}
```

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts
```

Expected: all DATEX tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/test/datex.test.ts
git commit -m "feat: fetch DATEX snapshots conditionally"
```

---

### Task 8: Reuse DATEX fetch logic for source health probing

**Objective:** Remove duplicate Basic Auth code from `collectors.ts` and ensure health probing uses the same DATEX credentials/header behavior as ingestion.

**Files:**

- Modify: `apps/worker/src/datex.ts`
- Modify: `apps/worker/src/collectors.ts`
- Modify: `apps/worker/test/collectors.test.ts`
- Test: `apps/worker/test/collectors.test.ts`, `apps/worker/test/datex.test.ts`

**Step 1: Write failing probe detail test**

In `apps/worker/test/collectors.test.ts`, update the successful DATEX probe expectation from:

```ts
detail: "Tilgang konfigurert og testet",
```

to:

```ts
detail: "Tilgang konfigurert og testet mot DATEX GetSituation",
```

This should fail until the shared probe function is wired.

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/collectors.test.ts
```

Expected: FAIL on detail mismatch only.

**Step 3: Export a probe helper from `datex.ts`**

Add:

```ts
export async function probeDatexAccess(options: {
  endpoint: string;
  username: string;
  password: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  const response = await (options.fetcher ?? fetch)(options.endpoint, {
    headers: {
      "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech",
      Authorization: datexBasicAuthHeader(options.username, options.password),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
```

**Step 4: Modify `collectors.ts`**

Remove the local `Buffer` import and local `datexBasicAuthHeader` function. Import:

```ts
import { probeDatexAccess } from "./datex.js";
```

Then change `probeDatex` internals:

```ts
try {
  await probeDatexAccess({ endpoint, username, password, fetcher });
  return {
    source: "datex",
    label: "Vegvesen DATEX",
    state: "ok",
    detail: "Tilgang konfigurert og testet mot DATEX GetSituation",
  };
} catch (error) {
  return { source: "datex", label: "Vegvesen DATEX", state: "degraded", detail: String(error) };
}
```

**Step 5: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/collectors.test.ts apps/worker/test/datex.test.ts
```

Expected: both test files pass.

**Step 6: Commit**

```bash
git add apps/worker/src/datex.ts apps/worker/src/collectors.ts apps/worker/test/collectors.test.ts
git commit -m "refactor: share DATEX auth probe logic"
```

---

### Task 9: Add collector state persistence for Last-Modified

**Objective:** Persist `Last-Modified` per collector so the worker can send `If-Modified-Since` across restarts.

**Files:**

- Modify: `apps/server/src/db/schema.sql`
- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/repository.test.ts`

**Step 1: Write failing repository tests**

Append to `apps/worker/test/repository.test.ts`:

```ts
it("loads and stores collector state values", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ value: "Thu, 28 May 2026 10:00:00 GMT" }] })
    .mockResolvedValueOnce({ rows: [] });
  const repository = new WorkerRepository({ query } as unknown as pg.Pool);

  await expect(repository.collectorState("datex:lastModified")).resolves.toBe(
    "Thu, 28 May 2026 10:00:00 GMT",
  );
  await repository.setCollectorState("datex:lastModified", "Thu, 28 May 2026 10:10:00 GMT");

  expect(query.mock.calls[0]?.[0]).toContain("SELECT value FROM collector_state");
  expect(query.mock.calls[1]?.[0]).toContain("INSERT INTO collector_state");
  expect(query.mock.calls[1]?.[1]).toEqual(["datex:lastModified", "Thu, 28 May 2026 10:10:00 GMT"]);
});
```

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because repository methods do not exist.

**Step 3: Add schema table**

In `apps/server/src/db/schema.sql`, after `source_health`:

```sql
CREATE TABLE IF NOT EXISTS collector_state (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('003_collector_state') ON CONFLICT DO NOTHING;
```

Keep the existing migration insert lines; do not remove old versions.

**Step 4: Add repository methods**

In `apps/worker/src/repository.ts` inside `WorkerRepository`:

```ts
  async collectorState(key: string): Promise<string | undefined> {
    const result = await this.pool.query<{ value: string }>(
      "SELECT value FROM collector_state WHERE key=$1",
      [key],
    );
    return result.rows[0]?.value;
  }

  async setCollectorState(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO collector_state (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [key, value],
    );
  }
```

**Step 5: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
```

Expected: repository tests pass.

**Step 6: Commit**

```bash
git add apps/server/src/db/schema.sql apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: persist collector state"
```

---

### Task 10: Allow DATEX rows in the official_events database constraint

**Objective:** Ensure production Postgres accepts `official_events.source='datex'` even when the table already exists with the old check constraint.

**Files:**

- Modify: `apps/server/src/db/schema.sql`
- Test: `npm run typecheck` plus schema inspection

**Step 1: Add constraint migration SQL**

In `apps/server/src/db/schema.sql`, directly after `CREATE TABLE IF NOT EXISTS official_events (...)`:

```sql
ALTER TABLE official_events DROP CONSTRAINT IF EXISTS official_events_source_check;
ALTER TABLE official_events ADD CONSTRAINT official_events_source_check
  CHECK (source IN ('met', 'nve', 'datex'));
```

Also change the inline table definition from:

```sql
source text NOT NULL CHECK (source IN ('met', 'nve')),
```

to:

```sql
source text NOT NULL,
```

This avoids duplicate anonymous and named check constraints.

**Step 2: Verify schema text**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
schema = Path('apps/server/src/db/schema.sql').read_text()
assert "CHECK (source IN ('met', 'nve', 'datex'))" in schema
assert "source text NOT NULL CHECK (source IN ('met', 'nve'))" not in schema
print('schema ok')
PY
```

Expected: `schema ok`.

**Step 3: Typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: typecheck passes or only fails on tasks not yet implemented. Do not commit if there are unexpected type errors in completed files.

**Step 4: Commit**

```bash
git add apps/server/src/db/schema.sql
git commit -m "fix: allow DATEX official event rows"
```

---

### Task 11: Add repository expiration for missing DATEX snapshot rows

**Objective:** When a successful DATEX snapshot no longer contains an earlier DATEX event ID, mark that `official_events` row expired instead of leaving stale road closures active forever.

**Files:**

- Modify: `apps/worker/src/repository.ts`
- Modify: `apps/worker/test/repository.test.ts`

**Step 1: Write failing repository test**

Append to `apps/worker/test/repository.test.ts`:

```ts
it("expires DATEX official events missing from a successful snapshot", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const repository = new WorkerRepository({ query } as unknown as pg.Pool);

  await repository.expireMissingOfficialEvents("datex", ["datex-keep-one", "datex-keep-two"]);

  expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE official_events"), [
    "datex",
    ["datex-keep-one", "datex-keep-two"],
  ]);
  expect(query.mock.calls[0]?.[0]).toContain("state='expired'");
  expect(query.mock.calls[0]?.[0]).toContain("payload=jsonb_set");
});
```

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
```

Expected: FAIL because `expireMissingOfficialEvents` does not exist.

**Step 3: Implement repository method**

In `WorkerRepository`:

```ts
  async expireMissingOfficialEvents(source: OfficialEvent["source"], activeIds: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE official_events
       SET state='expired',
           payload=jsonb_set(payload, '{state}', to_jsonb('expired'::text), true),
           updated_at=now()
       WHERE source=$1
       AND state IN ('active', 'updated')
       AND NOT (id = ANY($2::text[]))`,
      [source, activeIds],
    );
  }
```

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/repository.test.ts
```

Expected: repository tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/test/repository.test.ts
git commit -m "feat: expire missing official snapshot events"
```

---

### Task 12: Wire DATEX collection into the worker loop

**Objective:** On each worker poll, collect DATEX situation events, persist them, update health, update Last-Modified, and expire missing DATEX official events only after a successful non-304 snapshot.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Test: `npm run typecheck`, `npm test -- apps/worker/test/datex.test.ts apps/worker/test/repository.test.ts apps/worker/test/collectors.test.ts`

**Step 1: Refactor `officialEvents` collection code carefully**

In `apps/worker/src/index.ts`, import:

```ts
import { collectDatexSituationEvents } from "./datex.js";
```

Near `const officialEvents = [];`, add DATEX after MET/NVE collection but before `upsertOfficialEvents`:

```ts
const datexUsername = process.env.DATEX_USERNAME?.trim();
const datexPassword = process.env.DATEX_PASSWORD;
const datexEndpoint =
  process.env.DATEX_ENDPOINT?.trim() ||
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata";

if (datexUsername && datexPassword) {
  try {
    const lastModified = await repository.collectorState("datex:lastModified");
    const result = await collectDatexSituationEvents({
      endpoint: datexEndpoint,
      username: datexUsername,
      password: datexPassword,
      lastModified,
    });
    officialEvents.push(...result.events);
    if (result.lastModified)
      await repository.setCollectorState("datex:lastModified", result.lastModified);
    if (!result.notModified) {
      await repository.expireMissingOfficialEvents(
        "datex",
        result.events.map((event) => event.id),
      );
    }
    await repository.setHealth({
      source: "datex",
      label: "Vegvesen DATEX",
      state: "ok",
      lastCheckedAt: new Date().toISOString(),
      nextPollAt,
      detail: result.notModified
        ? "Ingen endringer siden forrige DATEX-snapshot"
        : `${result.events.length} relevante DATEX trafikkhendelser hentet`,
    });
  } catch (error) {
    await repository.setHealth({
      source: "datex",
      label: "Vegvesen DATEX",
      state: "degraded",
      lastCheckedAt: new Date().toISOString(),
      lastFailureAt: new Date().toISOString(),
      nextPollAt,
      detail: `DATEX-innhenting feilet: ${String(error)}`,
    });
  }
}
```

Important:

- Do not remove the earlier `probeOfficialSources()` call yet unless you deliberately replace its DATEX health behavior. The simplest MVP will set DATEX health twice; the later DATEX collection health should win because it runs later. If this feels noisy, patch `probeOfficialSources` later to skip DATEX when ingestion is enabled.
- Never call `expireMissingOfficialEvents` on `304` or failed DATEX requests.

**Step 2: Typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: pass. If it fails because `officialEvents` inferred as `never[]`, type it:

```ts
import type { OfficialEvent } from "@nytt/shared";
const officialEvents: OfficialEvent[] = [];
```

**Step 3: Run targeted tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts apps/worker/test/repository.test.ts apps/worker/test/collectors.test.ts
```

Expected: all pass.

**Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: collect DATEX official traffic events"
```

---

### Task 13: Create official traffic situations from promotable DATEX events

**Objective:** Convert active high-impact DATEX official events into normal Nytt `Situation` records with official evidence, timeline entries, and official map features.

**Files:**

- Modify: `apps/worker/src/clusters.ts`
- Create or modify: `apps/worker/test/clusters.test.ts` if it exists; otherwise create it

**Step 1: Write failing situation-builder test**

Create `apps/worker/test/clusters.test.ts` if missing:

```ts
import { describe, expect, it } from "vitest";
import type { OfficialEvent } from "@nytt/shared";
import {
  officialTrafficSituationsFromEvents,
  resolvedOfficialTrafficSituationsForMissingDatex,
} from "../src/clusters.js";

const datexEvent: OfficialEvent = {
  id: "datex-e6-tiller",
  source: "datex",
  eventType: "traffic",
  title: "Trafikkulykke på E6 ved Tiller",
  detail: "Trafikkulykke på E6 ved Tiller. Ett felt stengt.",
  sourceUrl: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
  areaLabel: "E6 Tiller",
  state: "active",
  severity: "high",
  publishedAt: "2026-05-28T10:00:00.000Z",
  validFrom: "2026-05-28T09:55:00.000Z",
  validTo: "2026-05-28T12:00:00.000Z",
  geometry: { type: "Point", coordinates: [10.376, 63.361] },
  raw: { datex: { promoteToSituation: true, impact: "high", roadNumber: "E6" } },
};

describe("official traffic situation promotion", () => {
  it("creates an official active traffic situation from a promotable DATEX event", () => {
    const [situation] = officialTrafficSituationsFromEvents([datexEvent], []);

    expect(situation).toMatchObject({
      type: "traffic",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      locationLabel: "E6 Tiller",
      officialSource: "datex",
      officialEventId: "datex-e6-tiller",
      activationBasis: { rule: "official_source", sourceIds: ["datex"], articleIds: [] },
    });
    expect(situation?.evidence[0]).toMatchObject({
      source: "datex",
      sourceLabel: "Statens vegvesen DATEX",
      provenance: "official",
      confidence: 1,
    });
    expect(situation?.features[0]).toMatchObject({
      geometry: { type: "Point", coordinates: [10.376, 63.361] },
      properties: { provenance: "official", sourceLabel: "Statens vegvesen DATEX" },
    });
  });

  it("does not promote low-impact DATEX roadworks", () => {
    const low = { ...datexEvent, id: "datex-low", raw: { datex: { promoteToSituation: false } } };
    expect(officialTrafficSituationsFromEvents([low], [])).toEqual([]);
  });

  it("resolves active DATEX situations whose official event is missing from the latest snapshot", () => {
    const [existing] = officialTrafficSituationsFromEvents([datexEvent], []);
    const [resolved] = resolvedOfficialTrafficSituationsForMissingDatex(
      [existing!],
      new Set<string>(),
      "2026-05-28T10:30:00.000Z",
    );

    expect(resolved).toMatchObject({
      id: existing?.id,
      status: "resolved",
      updatedAt: "2026-05-28T10:30:00.000Z",
    });
    expect(resolved?.timeline.at(-1)).toMatchObject({
      title: "DATEX-hendelsen er ikke lenger aktiv",
      official: true,
    });
  });
});
```

**Step 2: Run RED**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/clusters.test.ts
```

Expected: FAIL because `officialTrafficSituationsFromEvents` does not exist.

**Step 3: Implement builder in `clusters.ts`**

Add near the top-level functions:

```ts
function rawDatex(event: OfficialEvent): Record<string, unknown> {
  return event.raw && typeof event.raw === "object" && "datex" in event.raw
    ? ((event.raw as { datex?: Record<string, unknown> }).datex ?? {})
    : {};
}

function shouldPromoteDatex(event: OfficialEvent): boolean {
  return (
    event.source === "datex" &&
    event.state !== "cancelled" &&
    rawDatex(event).promoteToSituation === true
  );
}

export function officialTrafficSituationsFromEvents(
  events: OfficialEvent[],
  existingSituations: Situation[] = [],
): Situation[] {
  const openByEventId = new Map(
    existingSituations
      .filter((situation) => situation.officialSource === "datex" && situation.officialEventId)
      .map((situation) => [situation.officialEventId!, situation]),
  );

  return events.filter(shouldPromoteDatex).map((event) => {
    const existing = openByEventId.get(event.id);
    const id =
      existing?.id ?? `datex-${createHash("sha1").update(event.id).digest("hex").slice(0, 12)}`;
    const updatedAt = event.publishedAt;
    const feature: MapFeature[] = event.geometry
      ? [
          {
            id: createHash("sha1")
              .update(`${id}:official-feature:${event.id}`)
              .digest("hex")
              .slice(0, 18),
            type: "Feature",
            geometry: event.geometry,
            properties: {
              label: event.title,
              provenance: "official",
              sourceLabel: "Statens vegvesen DATEX",
              sourceUrl: event.sourceUrl,
              updatedAt,
              layer: "traffic",
            },
          },
        ]
      : [];

    return {
      id,
      type: "traffic",
      title: event.title,
      summary: event.detail,
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: rawDatex(event).impact === "high" ? "high" : "normal",
      updatedAt,
      createdAt: existing?.createdAt ?? event.validFrom,
      locationLabel: event.areaLabel,
      incidentSignature: `datex:${event.id}`,
      detectionVersion: "datex-1",
      officialSource: "datex",
      officialEventId: event.id,
      activationBasis: existing?.activationBasis ?? {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: event.publishedAt,
      },
      relatedArticleIds: existing?.relatedArticleIds ?? [],
      evidence: [
        {
          id: createHash("sha1").update(`${id}:datex:${event.id}`).digest("hex").slice(0, 18),
          situationId: id,
          source: "datex",
          sourceLabel: "Statens vegvesen DATEX",
          sourceUrl: event.sourceUrl,
          supportingSnippet: event.detail,
          claim: event.title,
          claimType: "official_traffic_status",
          provenance: "official",
          confidence: 1,
          extractedAt: new Date().toISOString(),
          publishedAt: event.publishedAt,
        },
      ],
      features: feature,
      timeline: [
        {
          id: `timeline-${event.id}`,
          situationId: id,
          timestamp: event.publishedAt,
          title: event.title,
          detail: event.detail,
          sourceLabel: "Statens vegvesen DATEX",
          sourceUrl: event.sourceUrl,
          official: true,
        },
      ],
    } satisfies Situation;
  });
}

export function resolvedOfficialTrafficSituationsForMissingDatex(
  existingSituations: Situation[],
  activeDatexEventIds: Set<string>,
  resolvedAt: string,
): Situation[] {
  return existingSituations
    .filter(
      (situation) =>
        situation.officialSource === "datex" &&
        situation.officialEventId &&
        situation.status === "active" &&
        !activeDatexEventIds.has(situation.officialEventId),
    )
    .map((situation) => ({
      ...situation,
      status: "resolved",
      updatedAt: resolvedAt,
      timeline: [
        ...situation.timeline,
        {
          id: `timeline-datex-resolved-${situation.officialEventId}`,
          situationId: situation.id,
          timestamp: resolvedAt,
          title: "DATEX-hendelsen er ikke lenger aktiv",
          detail: "Statens vegvesen DATEX-snapshot inneholder ikke lenger denne hendelsen.",
          sourceLabel: "Statens vegvesen DATEX",
          sourceUrl: situation.evidence.find((item) => item.source === "datex")?.sourceUrl ?? "",
          official: true,
        },
      ],
    }));
}
```

**Step 4: Verify GREEN**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/clusters.test.ts
```

Expected: new cluster tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/clusters.ts apps/worker/test/clusters.test.ts
git commit -m "feat: promote official DATEX traffic situations"
```

---

### Task 14: Wire official DATEX traffic situations into persistence

**Objective:** Persist DATEX-created traffic situations in the normal situation table after deterministic news-derived situations are built, while keeping DATEX out of the MET/NVE warning-context path.

**Files:**

- Modify: `apps/worker/src/index.ts`
- Test: `npm run typecheck`, worker targeted tests

**Step 1: Modify imports**

In `apps/worker/src/index.ts`, change:

```ts
import { detectPreliminarySituations } from "./clusters.js";
```

to:

```ts
import {
  detectPreliminarySituations,
  officialTrafficSituationsFromEvents,
  resolvedOfficialTrafficSituationsForMissingDatex,
} from "./clusters.js";
```

**Step 2: Split warning context from DATEX traffic truth**

First replace the current official-event load in `apps/worker/src/index.ts`:

```ts
const currentWarnings = await repository.currentOfficialEvents();
```

with:

```ts
const currentOfficialEvents = await repository.currentOfficialEvents();
const currentWarnings = currentOfficialEvents.filter(
  (event) => event.source === "met" || event.source === "nve",
);
const currentDatexEvents = currentOfficialEvents.filter((event) => event.source === "datex");
```

Use `currentWarnings` only in `detectPreliminarySituations(...)`. DATEX must not enter `warningEventsForSituation(...)` because that path is MET/NVE danger-warning context and `warningFeature()` currently labels non-NVE geometry as MET.

After `const deterministicSituations = enhanceSituations(...);`, add:

```ts
const trackedSituations = await repository.trackedSituations();
const officialTrafficSituations = officialTrafficSituationsFromEvents(
  currentDatexEvents,
  trackedSituations,
);
const resolvedDatexSituations = resolvedOfficialTrafficSituationsForMissingDatex(
  trackedSituations,
  new Set(currentDatexEvents.map((event) => event.id)),
  new Date().toISOString(),
);
const situationsToPersist = [
  ...deterministicSituations,
  ...officialTrafficSituations,
  ...resolvedDatexSituations,
];
```

Then replace:

```ts
    deterministicSituations.map((situation) => repository.upsertSituation(situation)),
```

with:

```ts
    situationsToPersist.map((situation) => repository.upsertSituation(situation)),
```

And update log text:

```ts
`[worker] stored ${articles.length} articles; persisted ${situationsToPersist.length} situations (${officialTrafficSituations.length} from DATEX); AI identified ${analysis.result.clusters.length} validated candidates`;
```

**Step 3: Add/verify separation test**

Before typecheck, add or keep a `clusters.test.ts` assertion that `detectPreliminarySituations(...)` receives only MET/NVE warning context. A DATEX event must not become a `layer: "warning"` feature or `official_warning_context` evidence on a news-derived situation; DATEX should enter through `officialTrafficSituationsFromEvents(...)` only.

**Step 4: Run typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: pass.

**Step 5: Run worker tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm test -- apps/worker/test/datex.test.ts apps/worker/test/clusters.test.ts apps/worker/test/repository.test.ts apps/worker/test/official.test.ts apps/worker/test/collectors.test.ts
```

Expected: pass.

**Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/test/clusters.test.ts
git commit -m "feat: persist official DATEX traffic situations"
```

---

### Task 15: Update map labels for official traffic layer

**Objective:** Make existing map UI label DATEX traffic features distinctly without building a new traffic dashboard yet.

**Files:**

- Modify: `apps/frontend/src/components/MapViews.tsx`
- Test: `npm run typecheck`

**Step 1: Write minimal style update**

In `featureStyle`, before the warning branch or after it, add traffic handling:

```ts
if (feature?.properties.layer === "traffic") {
  return { color: "#1f6feb", weight: 3, fillColor: "#1f6feb", fillOpacity: 0.18 };
}
```

In the layer controls, add a traffic label only if needed later. For MVP, always show official traffic features with the normal `Hendelser` layer, but update legend:

```tsx
<span className="legend official">Offentlig oppgitt / DATEX trafikk</span>
```

Do not add new local state unless there is an actual UI requirement to hide/show traffic separately.

**Step 2: Verify typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
```

Expected: pass.

**Step 3: Commit**

```bash
git add apps/frontend/src/components/MapViews.tsx
git commit -m "feat: distinguish official DATEX map features"
```

---

### Task 16: Update source and security documentation

**Objective:** Document how Nytt now uses DATEX, what remains deferred, and how credentials remain protected.

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SOURCES.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/DEPLOYMENT.md`

**Step 1: Update `docs/ARCHITECTURE.md`**

Under `## Situation Activation`, add the explicit official-source exception:

```md
High-impact official DATEX traffic records are the explicit exception to the two-independent-source activation rule. They may create active traffic situations with `activationBasis.rule="official_source"`, `sourceIds=["datex"]`, and `officialEventId` set. Low-impact/planned roadworks remain `official_events` only and do not activate the main situation feed.
```

**Step 2: Update `docs/SOURCES.md`**

Replace the current DATEX deferred sentence with:

```md
- Statens vegvesen DATEX II v3.1 `GetSituation/pullsnapshotdata` is collected with Basic Auth when `DATEX_USERNAME` and `DATEX_PASSWORD` are configured. The worker sends `If-Modified-Since` when a previous `Last-Modified` value exists, stores relevant Trondheim/Trøndelag traffic situations as official events, and promotes high-impact accidents/closures/obstructions into official traffic situations. Low-impact/planned roadworks are retained as official events for future traffic-layer UI, but do not currently spam the main situation feed.
```

Add follow-up paragraph:

```md
DATEX TravelTime, measured road weather, forecast points and CCTV site tables are intentionally separate follow-up integrations. TravelTime should be used as a traffic-pulse/delay signal, weather as road-context enrichment, and CCTV only with explicit freshness/staleness labeling.
```

**Step 3: Update `docs/SECURITY.md`**

Add:

```md
DATEX credentials are server-side worker secrets only. They are stored as GitHub Actions repository secrets (`NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`), mapped to container runtime variables (`DATEX_USERNAME`, `DATEX_PASSWORD`) by the deploy workflow/playbook, and must never be exposed to the frontend bundle, logs, raw fixtures, or exported workspaces.
```

**Step 4: Update `docs/DEPLOYMENT.md`**

Add a verification command section:

After deploying DATEX ingestion, verify production source health and event persistence:

```bash
curl -s https://nytt.reidar.tech/health
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,detail,last_checked_at from source_health where source='datex';\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select count(*) from official_events where source='datex';\""
```

Use the compose service name `postgres` from `docker-compose.yml`; do not assume a literal container name such as `nytt-postgres` exists.

**Step 5: Verify format check**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run format:check
```

Expected: pass, or run `npm run format` and include formatting changes.

**Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md docs/SOURCES.md docs/SECURITY.md docs/DEPLOYMENT.md
git commit -m "docs: describe DATEX traffic ingestion"
```

---

### Task 17: Run full local quality gates

**Objective:** Prove the full implementation is internally consistent before pushing.

**Files:**

- No code changes expected unless gates uncover issues.

**Step 1: Run all gates**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run typecheck
source ~/.nvm/nvm.sh && nvm use 22 && npm test
source ~/.nvm/nvm.sh && nvm use 22 && npm run lint
source ~/.nvm/nvm.sh && nvm use 22 && npm run format:check
```

Expected:

- Typecheck passes.
- Vitest passes.
- ESLint passes.
- Prettier check passes.

**Step 2: Inspect diff**

Run:

```bash
git status --short
git log --oneline -5
git diff --stat HEAD~17..HEAD
```

Expected:

- Working tree clean.
- Recent commits match tasks.
- Diff touches only planned files.

**Step 3: If fixes were needed, commit them**

```bash
git add <fixed-files>
git commit -m "fix: stabilize DATEX ingestion gates"
```

---

### Task 18: Push, wait for CI, deploy, and verify production

**Objective:** Ship DATEX ingestion safely and prove it works live before claiming success.

**Files:**

- No source changes expected.

**Step 1: Push**

Run:

```bash
git push origin main
```

**Step 2: Wait for CI completion**

Run repeatedly until completed:

```bash
gh run list --repo Reedtrullz/Nytt --branch main --limit 5 --json databaseId,workflowName,status,conclusion,headSha,createdAt
```

Expected: relevant run for the pushed SHA shows `status: completed` and `conclusion: success`.

**Step 3: Trigger deploy if not automatic**

Run the existing deploy workflow according to repo docs, for example:

```bash
gh workflow run deploy.yml --repo Reedtrullz/Nytt --ref main
```

Then wait:

```bash
gh run list --repo Reedtrullz/Nytt --workflow deploy.yml --limit 3 --json databaseId,status,conclusion,headSha,createdAt
```

Expected: deploy run shows `completed` + `success`.

**Step 4: Verify live health**

Run:

```bash
curl -s https://nytt.reidar.tech/health
```

Expected:

```json
{ "status": "ok", "storage": "postgres" }
```

**Step 5: Verify DATEX production state**

Run an SSH/psql check using the existing deployment container names:

```bash
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,detail,last_checked_at from source_health where source='datex';\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select source,state,count(*) from official_events where source='datex' group by source,state;\""
ssh Racknerd-Deploy "cd /home/deploy/nytt-trondheim && docker compose --env-file .env.production exec -T postgres psql -U nytt -d nytt -c \"select id,status,verification_status,payload->>'officialEventId' as datex_event from situations where payload->>'officialSource'='datex' order by updated_at desc limit 5;\""
```

Expected:

- `source_health.datex` is `ok` or `ok` with `Ingen endringer...` detail.
- `official_events` contains DATEX rows if current relevant events exist; zero rows is acceptable only if source health says zero relevant DATEX traffic events were fetched.
- `situations` contains DATEX rows only for high-impact/promotable events.

**Step 6: Final user report**

Report only after all checks complete. Include:

- CI run status/conclusion.
- Deploy run status/conclusion.
- Live health result.
- DATEX source_health row.
- Counts of DATEX official events and promoted situations.
- Explicit caveat if no current relevant/promotable DATEX events exist at verification time.

---

## Post-Implementation Audit Checklist

After Task 18, run this review before finalizing:

- [ ] `apps/worker/src/datex.ts` never logs credentials.
- [ ] `If-Modified-Since` is sent only when a stored `Last-Modified` exists.
- [ ] Missing DATEX events expire only after a successful non-304 snapshot.
- [ ] Existing DATEX-created situations resolve when their `officialEventId` is absent from the latest active DATEX snapshot.
- [ ] DATEX parser handles singleton vs array XML nodes.
- [ ] Parser uses `processEntities: false`.
- [ ] `official_events.source` accepts `datex` on fresh and existing DBs.
- [ ] Low-impact roadworks do not create main situations.
- [ ] High-impact accidents/closures produce `verificationStatus: "Offentlig bekreftet"`.
- [ ] DATEX map features use `provenance: "official"`, never `reporting_estimate`.
- [ ] RSS/news-derived two-source activation behavior is unchanged.
- [ ] Operations page/source health still works when DATEX credentials are absent.
- [ ] Full local gates and CI pass.
- [ ] Production verification is from live endpoint/database, not assumed from deploy logs.

## Follow-Up Plans After This MVP

1. DATEX TravelTime traffic pulse:
   - `GetPredefinedTravelTimeLocations/pullsnapshotdata`
   - `GetTravelTimeData/pullsnapshotdata`
   - show Trondheim corridors and delay trends; do not infer incident causes.
2. DATEX road weather enrichment:
   - `GetMeasurementWeatherSiteTable`
   - `GetMeasuredWeatherData`
   - attach nearby observations to active traffic/weather/flood/landslide situations.
3. DATEX CCTV context:
   - `GetCCTVSiteTable`
   - nearest-camera links/images with timestamp and stale-image warning.
4. Dedicated traffic map/filter UI:
   - accidents, closures, roadworks, congestion, weather/føre.
   - powered by `official_events`, not raw XML.
