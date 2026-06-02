# Incident Correctness Fixture Hardening Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Tasks marked `[PARENT-DIRECT]` are cross-cutting enough that the parent session should execute or supervise them directly.

**Goal:** Add adversarial worker fixtures that prove Nytt activates, links, resolves, and explains situations only when source provenance, place specificity, event identity, and official-feed rules justify it.

**Architecture:** Keep the existing boundary: `worker` classifies and activates situations, `server` persists/serves them, `frontend` explains them. This plan only hardens worker-side incident correctness fixtures and small pure helpers needed by those fixtures; UI changes are deferred to the Situation Room explanation plan and the post-implementation provenance audit.

**Tech Stack:** TypeScript, Node 22 via nvm, Vitest, PostgreSQL/PostGIS schema references, Nytt shared API types.

---

## Context read before writing this plan

Architecture and source docs:

- `docs/ARCHITECTURE.md`
- `docs/SOURCES.md`
- `apps/worker/src/clusters.ts`
- `apps/worker/src/classify.ts`
- `apps/server/src/db/schema.sql`
- `apps/worker/test/classify.test.ts`
- `apps/worker/test/clusters.test.ts`
- `apps/worker/test/politiloggen.test.ts`

Hermes planning references applied:

- `writing-plans/references/external-feed-ingestion-plan-checklist.md`
- `writing-plans/references/source-item-ledger-feed-ingestion-notes.md`
- `writing-plans/references/provenance-ui-post-implementation-audit.md`

## Current invariants from the architecture docs

- Broad `Trondheim` / `Trøndelag` mentions are feed relevance, not incident identity.
- Situation activation requires explicit incident type plus a shared specific place or event signature.
- New ordinary incidents need two independent sources within 12 hours.
- Resolved/dismissed history cannot absorb a later same-place event.
- High-impact official DATEX traffic events and active Trondheim Politiloggen threads are explicit official-source exceptions.
- MET/NVE warnings are context. They can enrich a located relevant situation but do not confirm or activate incidents alone.
- DATEX TravelTime, DATEX Weather, DATEX CCTV, Trafikkdata counters, and Entur vehicle positions are operations-only telemetry/context. They must not create `source_items`, `official_events`, `evidence_items`, or `situations`.
- Entur service alerts are official public-transport service alerts and may be ledger-visible, but are not automatic situation activators in this release.

## Runtime heartbeat and silent-degradation audit

Worker correctness chain touched by this plan:

```text
RSS/official collectors -> classify.ts -> clusters.ts -> repository/store -> situations/source_items/evidence
Politiloggen collector -> politiloggen.ts -> situations/source_items/evidence
DATEX situation collector -> officialTrafficSituationsFromEvents -> situations/evidence
```

Silent-degradation risks:

- A too-broad place match silently merges unrelated events instead of crashing.
- A context-only feed silently increments evidence or active-situation counts.
- A resolved/dismissed situation silently absorbs later reporting and hides a real event.
- A source-item/evidence SQL change silently treats telemetry as support evidence.
- Politiloggen inactive threads silently remain active if only the first active path is tested.

Every code task below therefore starts with a failing fixture, runs the targeted test to prove the failure, then applies a narrow implementation and reruns targeted plus full worker gates.

## Fixtures required by the portfolio review

This plan must implement all seven fixture classes:

1. same place, different event,
2. same event, different place names,
3. broad Trondheim mention that must not activate,
4. MET/NVE warning without incident,
5. official DATEX traffic event without article,
6. dismissed false positive followed by later real event,
7. Politiloggen active/inactive lifecycle.

---

### Task 1: Add reusable incident fixture builders

**Objective:** Remove noisy object literals so adversarial tests state the incident rule being tested.

**Files:**

- Create: `apps/worker/test/fixtures/incident-fixtures.ts`
- Modify: `apps/worker/test/classify.test.ts` to import the new helper and remove the existing local `incidentArticle` helper.

**Step 1: Create fixture helpers**

Create `apps/worker/test/fixtures/incident-fixtures.ts`:

```ts
import type { Article, OfficialEvent, Situation } from "@nytt/shared";

export function incidentArticle(
  id: string,
  source: Article["source"],
  publishedAt: string,
  overrides: Partial<Article> = {},
): Article {
  return {
    id,
    source,
    sourceLabel: source === "adressa" ? "Adresseavisen" : source === "nrk" ? "NRK" : source,
    title: "Brann i Bymarka",
    excerpt: "Røyk er observert i Bymarka.",
    url: `https://example.test/${id}`,
    publishedAt,
    scope: "trondheim",
    category: "Hendelser",
    places: ["Bymarka"],
    ...overrides,
  };
}

export function warningEvent(id: string, overrides: Partial<OfficialEvent> = {}): OfficialEvent {
  return {
    id,
    source: "met",
    eventType: "fire",
    state: "active",
    title: "Skogbrannfare i Trøndelag",
    detail: "MET varsler skogbrannfare som kontekst, ikke hendelsesbekreftelse.",
    areaLabel: "Trøndelag",
    sourceUrl: `https://example.test/warning/${id}`,
    publishedAt: "2026-06-02T08:00:00Z",
    validFrom: "2026-06-02T08:00:00Z",
    validTo: "2099-06-03T08:00:00Z",
    severity: "yellow",
    geometry: undefined,
    raw: { fixture: true },
    ...overrides,
  };
}

export function promotableDatexEvent(
  id: string,
  overrides: Partial<OfficialEvent> = {},
): OfficialEvent {
  return {
    id,
    source: "datex",
    eventType: "traffic",
    state: "active",
    title: "E6 stengt ved Sluppen",
    detail: "Offisiell trafikkhendelse fra Statens vegvesen.",
    areaLabel: "Sluppen",
    sourceUrl: `https://example.test/datex/${id}`,
    publishedAt: "2026-06-02T09:00:00Z",
    validFrom: "2026-06-02T09:00:00Z",
    validTo: "2026-06-02T12:00:00Z",
    geometry: { type: "Point", coordinates: [10.395, 63.397] },
    raw: {
      datex: {
        situationId: id,
        recordKind: "Accident",
        impact: "high",
        promoteToSituation: true,
      },
    },
    ...overrides,
  };
}

export function dismissedSituation(situation: Situation): Situation {
  return {
    ...situation,
    status: "dismissed",
    dismissalReason: "false_positive",
  };
}
```

**Step 2: Replace the local classify fixture helper**

`apps/worker/test/classify.test.ts` currently has a local three-argument `incidentArticle` helper. Replace it with an import from the new fixture file so later four-argument override calls use the intended helper:

```ts
import { incidentArticle } from "./fixtures/incident-fixtures.js";
```

Delete the old local `incidentArticle` function at the bottom of `classify.test.ts`. Existing three-argument calls should keep working because the new helper has `overrides: Partial<Article> = {}`.

**Step 3: Run current tests and typecheck to verify helper compiles**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- apps/worker/test/classify.test.ts
npm run typecheck
```

Expected: existing classify tests still pass. The fixture helper is compiled because `classify.test.ts` imports it.

**Step 4: Commit helper-only change**

```bash
git add apps/worker/test/fixtures/incident-fixtures.ts apps/worker/test/classify.test.ts
git commit -m "test: add incident correctness fixture builders"
```

---

### Task 2: Prove same-place different-event stories do not merge

**Objective:** Prevent two different same-place incidents from becoming one situation only because `type:place` matches.

**Files:**

- Modify: `apps/worker/test/classify.test.ts`
- Modify later: `apps/worker/src/clusters.ts`

**Step 1: Write the failing test**

Append this test near the other `detectPreliminarySituations` cases:

```ts
it("does not merge different events only because they mention the same place", () => {
  const situations = detectPreliminarySituations([
    incidentArticle("garage-one", "nrk", "2026-06-02T08:00:00Z", {
      title: "Garasjebrann på Tiller",
      excerpt: "Nødetatene rykket ut til brann i garasje ved Tonstad.",
      places: ["Tiller"],
    }),
    incidentArticle("garage-two", "adressa", "2026-06-02T08:05:00Z", {
      title: "Garasjebrann på Tiller",
      excerpt: "Brann i garasje ved Tonstad.",
      places: ["Tiller"],
    }),
    incidentArticle("shed-one", "vg", "2026-06-02T08:10:00Z", {
      title: "Bodbrann på Tiller",
      excerpt: "Brannvesenet melder om separat brann i bod ved City Syd.",
      places: ["Tiller"],
    }),
    incidentArticle("shed-two", "dagbladet", "2026-06-02T08:12:00Z", {
      title: "Bodbrann på Tiller",
      excerpt: "Politiet omtaler en annen brann i bod ved City Syd.",
      places: ["Tiller"],
    }),
  ]);

  expect(situations).toHaveLength(2);
  expect(situations.map((situation) => situation.relatedArticleIds.join(",")).sort()).toEqual([
    "garage-two,garage-one",
    "shed-two,shed-one",
  ]);
});
```

**Step 2: Verify failure**

```bash
npm test -- apps/worker/test/classify.test.ts -t "does not merge different events only because they mention the same place"
```

Expected: FAIL until `clusters.ts` distinguishes event signatures beyond `type:place`.

**Step 3: Implement a named event-signature seam**

Do not scatter one-off regexes through the grouping loop. In `apps/worker/src/clusters.ts`, replace the one-dimensional key:

```ts
const key = `${type}:${slug(place)}`;
```

with a small named helper and an explicit descriptor table. The table is intentionally deterministic and reviewable; it is not fuzzy matching and must grow only with tests:

```ts
const eventDescriptorRules: Array<{ descriptor: string; pattern: RegExp }> = [
  { descriptor: "garasjebrann", pattern: /\bgarasjebrann\b/i },
  { descriptor: "bodbrann", pattern: /\bbodbrann\b/i },
  { descriptor: "bilbrann", pattern: /\bbilbrann\b/i },
];

export function incidentEventDescriptor(article: Article): string | undefined {
  const text = `${article.title} ${article.excerpt}`;
  return eventDescriptorRules.find((rule) => rule.pattern.test(text))?.descriptor;
}

function incidentSignatureKey(type: Situation["type"], place: string, article: Article): string {
  const descriptor = incidentEventDescriptor(article);
  return descriptor ? `${type}:${slug(place)}:${descriptor}` : `${type}:${slug(place)}`;
}
```

Then group with:

```ts
const key = incidentSignatureKey(type, place, article);
```

Add a unit assertion for `incidentEventDescriptor` if it is exported; otherwise keep all coverage through `detectPreliminarySituations`. Do not add broad AI/LLM matching here.

**Step 4: Verify targeted pass**

```bash
npm test -- apps/worker/test/classify.test.ts -t "does not merge different events only because they mention the same place"
```

Expected: PASS.

**Step 5: Verify existing classification behavior**

```bash
npm test -- apps/worker/test/classify.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/clusters.ts apps/worker/test/classify.test.ts
git commit -m "test: separate same-place different-event incidents"
```

---

### Task 3: Prove explicit local aliases can merge the same event

**Objective:** Merge same-event reports that use explicitly-listed local aliases without relying on fuzzy free-text similarity.

**Files:**

- Modify: `apps/worker/test/classify.test.ts`
- Modify later: `apps/worker/src/classify.ts`
- Modify later: `apps/worker/src/clusters.ts`

**Step 1: Write failing helper tests**

Add to the classification describe block. This fixture must cover both extraction and canonicalization so it applies to real collected RSS text, not only to manually populated `Article.places` arrays:

```ts
it("canonicalizes only explicitly listed local place aliases", () => {
  expect(extractPlaces("Trafikkulykke på Kroppanbrua")).toEqual(["Kroppanbrua"]);
  expect(extractPlaces("Kollisjon på Kroppan bru")).toEqual(["Kroppan bru"]);
  expect(canonicalPlaceName("Kroppanbrua")).toBe("Kroppan Bru");
  expect(canonicalPlaceName("Kroppan bru")).toBe("Kroppan Bru");
  expect(canonicalPlaceName("Bymarka")).toBe("Bymarka");
  expect(canonicalPlaceName("Trondheim")).toBe("Trondheim");
});
```

Import the new helper:

```ts
import { canonicalPlaceName, categorize, detectScope, extractPlaces } from "../src/classify.js";
```

**Step 2: Write failing situation test**

```ts
it("merges the same event when articles use canonical local place aliases", () => {
  const situations = detectPreliminarySituations([
    incidentArticle("kroppan-one", "nrk", "2026-06-02T10:00:00Z", {
      title: "Trafikkulykke på Kroppanbrua",
      excerpt: "En kollisjon gir kø ved Kroppanbrua.",
      category: "Transport",
      places: ["Kroppanbrua"],
    }),
    incidentArticle("kroppan-two", "adressa", "2026-06-02T10:05:00Z", {
      title: "Kollisjon på Kroppan bru",
      excerpt: "Ulykken omtales ved Kroppan bru.",
      category: "Transport",
      places: ["Kroppan bru"],
    }),
  ]);

  expect(situations).toHaveLength(1);
  expect(situations[0]?.incidentSignature).toBe("traffic:kroppan-bru");
  expect(situations[0]?.locationLabel).toBe("Kroppan Bru");
});
```

**Step 3: Verify failure**

```bash
npm test -- apps/worker/test/classify.test.ts -t "canonicalizes only explicitly listed local place aliases"
npm test -- apps/worker/test/classify.test.ts -t "merges the same event when articles use canonical local place aliases"
```

Expected: FAIL because `canonicalPlaceName` does not exist and `clusters.ts` currently keys on raw place labels.

**Step 4: Implement the minimal alias seam**

In `apps/worker/src/classify.ts`, first add the two explicit alias terms to `trondheimTerms` so RSS text can produce the place labels:

```ts
const trondheimTerms = [
  "kroppanbrua",
  "kroppan bru",
  "midtbyen",
  // keep the existing terms below
];
```

Then add the canonical alias seam below the term lists:

```ts
const placeAliases = new Map<string, string>([
  ["kroppanbrua", "Kroppan Bru"],
  ["kroppan bru", "Kroppan Bru"],
]);

function normalizePlaceAliasKey(place: string): string {
  return place.trim().toLocaleLowerCase("nb").replaceAll(/\s+/g, " ");
}

export function canonicalPlaceName(place: string): string {
  const normalized = normalizePlaceAliasKey(place);
  return placeAliases.get(normalized) ?? place.trim();
}
```

In `apps/worker/src/clusters.ts`, import it and canonicalize `specificPlace`:

```ts
import { canonicalPlaceName } from "./classify.js";

function specificPlace(article: Article): string | undefined {
  const place = article.places.find(
    (candidate) => !genericPlaces.has(candidate.toLocaleLowerCase("nb")),
  );
  return place ? canonicalPlaceName(place) : undefined;
}
```

**Step 5: Verify targeted and full classify tests**

```bash
npm test -- apps/worker/test/classify.test.ts -t "canonicalizes only explicitly listed local place aliases"
npm test -- apps/worker/test/classify.test.ts -t "merges the same event when articles use canonical local place aliases"
npm test -- apps/worker/test/classify.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/classify.ts apps/worker/src/clusters.ts apps/worker/test/classify.test.ts
git commit -m "test: canonicalize explicit local place aliases"
```

---

### Task 4: Strengthen broad-place and warning-only negative fixtures

**Objective:** Freeze the rule that broad city/region mentions and MET/NVE warnings do not activate incidents by themselves.

**Files:**

- Modify: `apps/worker/test/classify.test.ts`
- Modify later only if tests fail: `apps/worker/src/clusters.ts`

**Step 1: Add broad Trondheim incident-language fixture**

If Task 1 imported only `incidentArticle`, extend that import before adding the warning tests:

```ts
import { incidentArticle, warningEvent } from "./fixtures/incident-fixtures.js";
```

```ts
it("does not activate from a broad Trondheim-only incident mention", () => {
  const situations = detectPreliminarySituations([
    incidentArticle("broad-one", "nrk", "2026-06-02T11:00:00Z", {
      title: "Ulykke i Trondheim",
      excerpt: "Politiet omtaler en ulykke i Trondheim uten mer presis stedfesting.",
      places: ["Trondheim"],
    }),
    incidentArticle("broad-two", "adressa", "2026-06-02T11:03:00Z", {
      title: "Ulykke i Trondheim",
      excerpt: "Nødetatene er varslet om ulykke i Trondheim, men stedet er ikke oppgitt.",
      places: ["Trondheim"],
    }),
  ]);

  expect(situations).toEqual([]);
});
```

**Step 2: Add MET/NVE warning-only fixture**

```ts
it("keeps MET and NVE warnings as context without article confirmation", () => {
  const met = warningEvent("met-fire", { source: "met", eventType: "fire" });
  const nve = warningEvent("nve-flood", {
    source: "nve",
    eventType: "flood",
    title: "Flomvarsel for Trondheim",
    areaLabel: "Trondheim kommune",
  });

  expect(detectPreliminarySituations([], [met, nve])).toEqual([]);
});
```

**Step 3: Add warning-context-with-reports fixture**

This freezes the boundary that MET/NVE can be context for an already qualifying reported situation, but cannot become activation evidence or official confirmation by itself. Current `clusters.ts` may include warning context as `EvidenceItem` with `claimType: "official_warning_context"`; if that remains, the test must prove the activation basis and verification status still come from the article reports, not the warning.

```ts
it("keeps a MET warning as context when attached to reported incidents", () => {
  const situation = detectPreliminarySituations(
    [
      incidentArticle("smoke-one", "nrk", "2026-06-02T11:30:00Z", {
        location: { lat: 63.41, lng: 10.26, label: "Bymarka" },
      }),
      incidentArticle("smoke-two", "adressa", "2026-06-02T11:35:00Z", {
        location: { lat: 63.41, lng: 10.26, label: "Bymarka" },
      }),
    ],
    [
      warningEvent("met-fire", {
        source: "met",
        eventType: "fire",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [10.2, 63.35],
              [10.35, 63.35],
              [10.35, 63.45],
              [10.2, 63.45],
              [10.2, 63.35],
            ],
          ],
        },
      }),
    ],
  )[0]!;

  expect(situation.activationBasis?.rule).toBe("two_independent_sources");
  expect(situation.activationBasis?.sourceIds.sort()).toEqual(["adressa", "nrk"]);
  expect(situation.verificationStatus).toBe("Foreløpig fra rapportering");
  expect(situation.evidence.find((item) => item.source === "met")?.claimType).toBe(
    "official_warning_context",
  );
});
```

The warning-only fixture above covers both MET and NVE no-activation. This attached-context fixture covers the current MET geometry path. Task 19 must decide whether warning context should continue to be `EvidenceItem` rows or should be represented as `situation_source_items.relationship = 'context'`. Do not let this fixture become proof that warnings are causal support evidence.

**Step 4: Verify targeted tests**

```bash
npm test -- apps/worker/test/classify.test.ts -t "does not activate from a broad Trondheim-only incident mention"
npm test -- apps/worker/test/classify.test.ts -t "keeps MET and NVE warnings as context without article confirmation"
npm test -- apps/worker/test/classify.test.ts -t "keeps a MET warning as context when attached to reported incidents"
```

Expected: PASS if current safeguards are correct; otherwise patch `specificPlace`/warning handling narrowly.

**Step 5: Commit**

```bash
git add apps/worker/test/classify.test.ts apps/worker/src/clusters.ts
git commit -m "test: freeze broad-place and warning-only non-activation"
```

---

### Task 5: Strengthen official DATEX without article fixture

**Objective:** Prove official high-impact DATEX can activate a traffic situation without articles while low-impact/planned DATEX remains non-promoted.

**Files:**

- Modify: `apps/worker/test/clusters.test.ts`
- Modify later only if tests fail: `apps/worker/src/clusters.ts`

**Step 1: Add explicit no-article DATEX test**

Import the shared DATEX fixture helper in `apps/worker/test/clusters.test.ts`:

```ts
import { promotableDatexEvent } from "./fixtures/incident-fixtures.js";
```

```ts
it("can promote high-impact official DATEX traffic without an article", () => {
  const situations = officialTrafficSituationsFromEvents([
    promotableDatexEvent("datex-high-impact"),
  ]);

  expect(situations).toHaveLength(1);
  expect(situations[0]).toMatchObject({
    status: "active",
    type: "traffic",
    verificationStatus: "Offentlig bekreftet",
    officialSource: "datex",
    officialEventId: "datex-high-impact",
    activationBasis: {
      rule: "official_source",
      sourceIds: ["datex"],
      articleIds: [],
    },
  });
  expect(situations[0]?.relatedArticleIds).toEqual([]);
  expect(situations[0]?.evidence[0]?.source).toBe("datex");
});
```

**Step 2: Preserve or add low-impact/planned non-promotion assertion**

Keep the existing `does not promote low-impact DATEX roadworks` test. If it is missing or weakened during implementation, add this assertion in the same file:

```ts
it("does not promote low-impact planned DATEX roadworks without articles", () => {
  const situations = officialTrafficSituationsFromEvents([
    promotableDatexEvent("datex-roadwork-low", {
      title: "Planlagt veiarbeid på lokalvei",
      raw: { datex: { situationId: "datex-roadwork-low", recordKind: "Roadworks", impact: "low" } },
    }),
  ]);

  expect(situations).toEqual([]);
});
```

**Step 3: Add DATEX TravelTime non-promotion note to the test block**

Do not create a TravelTime source item/evidence fixture here. Instead, assert in the test name/comment that this helper is for DATEX `OfficialEvent` records only, while `datex_travel_times` remains covered by `apps/worker/test/datex-travel-time.test.ts`.

**Step 4: Verify targeted tests**

```bash
npm test -- apps/worker/test/clusters.test.ts -t "can promote high-impact official DATEX traffic without an article"
npm test -- apps/worker/test/clusters.test.ts -t "does not promote low-impact"
npm test -- apps/worker/test/datex.test.ts -t "low-impact planned roadworks"
npm test -- apps/worker/test/datex-travel-time.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/test/clusters.test.ts apps/worker/test/fixtures/incident-fixtures.ts apps/worker/src/clusters.ts
git commit -m "test: cover official DATEX article-free activation"
```

---

### Task 6: Strengthen dismissed-false-positive lifecycle fixture

**Objective:** Prove a dismissed false positive preserves history but cannot block or absorb a later real same-place event.

**Files:**

- Modify: `apps/worker/test/classify.test.ts`
- Modify later only if tests fail: `apps/worker/src/clusters.ts`

**Step 1: Replace/strengthen the existing dismissed case**

If Task 1 imported only `incidentArticle`, extend that import before replacing the dismissed lifecycle test:

```ts
import { dismissedSituation, incidentArticle } from "./fixtures/incident-fixtures.js";
```

The repository already has a basic `allows a real incident after an earlier dismissed same-place candidate` test. Strengthen it with explicit activation-basis assertions:

```ts
it("allows a later real event after an earlier false positive was dismissed", () => {
  const dismissed = dismissedSituation(
    detectPreliminarySituations([
      incidentArticle("dismissed-one", "nrk", "2026-05-20T08:00:00Z"),
      incidentArticle("dismissed-two", "adressa", "2026-05-20T08:10:00Z"),
    ])[0]!,
  );

  const newCases = detectPreliminarySituations(
    [
      incidentArticle("fresh-one", "nrk", "2026-06-02T12:00:00Z"),
      incidentArticle("fresh-two", "adressa", "2026-06-02T12:05:00Z"),
    ],
    [],
    [dismissed],
  );

  expect(newCases).toHaveLength(1);
  expect(newCases[0]?.id).not.toBe(dismissed.id);
  expect(newCases[0]?.activationBasis?.articleIds).toEqual(["fresh-two", "fresh-one"]);
  expect(newCases[0]?.relatedArticleIds).toEqual(["fresh-two", "fresh-one"]);
});
```

**Step 2: Verify targeted test**

```bash
npm test -- apps/worker/test/classify.test.ts -t "allows a later real event after an earlier false positive was dismissed"
```

Expected: PASS after current or patched lifecycle logic.

**Step 3: Commit**

```bash
git add apps/worker/test/classify.test.ts apps/worker/src/clusters.ts
git commit -m "test: preserve dismissed false-positive lifecycle boundary"
```

---

### Task 7: Strengthen Politiloggen active/inactive lifecycle fixture

**Objective:** Prove active Politiloggen threads create official situations, inactive new threads do not create active situations, and inactive known threads resolve existing situations.

**Files:**

- Modify: `apps/worker/test/politiloggen.test.ts`
- Modify later only if tests fail: `apps/worker/src/politiloggen.ts`

**Step 1: Keep active promotion assertion**

The existing `promotes active Politiloggen threads to official situations` test should remain. Do not weaken it.

**Step 2: Add inactive-new-thread negative test**

```ts
it("does not create a new active situation for an inactive Politiloggen thread", () => {
  const inactiveThread = { ...activeThread, isActive: false };

  expect(politiloggenSituationsFromThreads([inactiveThread])).toEqual([]);
});
```

**Step 3: Strengthen existing inactive-known-thread resolution test**

Add assertions to the existing test:

```ts
expect(situations[0]?.id).toBe(existing.id);
expect(situations[0]?.officialSource).toBe("politiloggen");
expect(situations[0]?.officialEventId).toBe(activeThread.id);
expect(situations[0]?.status).toBe("resolved");
expect(situations[0]?.activationBasis?.rule).toBe("official_source");
```

**Step 4: Verify targeted Politiloggen tests**

```bash
npm test -- apps/worker/test/politiloggen.test.ts
```

Expected: PASS after current or patched lifecycle logic.

**Step 5: Commit**

```bash
git add apps/worker/test/politiloggen.test.ts apps/worker/src/politiloggen.ts
git commit -m "test: cover politiloggen inactive lifecycle"
```

---

### Task 8: Add source-item/evidence boundary fixture checks

**Objective:** Ensure the new incident fixtures do not accidentally promote operations-only telemetry or context-only warnings into evidence/support rows.

**Files:**

- Modify: `apps/worker/test/repository.test.ts`
- Modify: `apps/worker/test/source-items.test.ts` only for mapper-level assertions.
- Modify: `apps/server/src/db/schema.sql` only if Task 19 decides to add database constraints.

**Step 1: Read existing repository and source-item tests**

When executing inside Hermes, use:

```text
read_file("apps/worker/test/repository.test.ts", limit=240)
read_file("apps/worker/test/source-items.test.ts", limit=220)
```

The current repository harness mocks `pg.Pool.query` and asserts SQL calls. Use that harness; do not invent a stateful database fixture for this task.

**Step 2: Add repository SQL non-mirroring tests for operations-only telemetry**

Add a test in `apps/worker/test/repository.test.ts` that calls the operational upsert methods with minimal valid rows and asserts no SQL touches `source_items` or `situation_source_items`:

```ts
it("keeps operations-only telemetry out of source-item and situation support links", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const repository = new WorkerRepository({ query } as unknown as pg.Pool);

  await repository.upsertDatexTravelTimes([minimalTravelTimeCorridor()]);
  await repository.upsertRoadWeatherObservations([minimalRoadWeatherObservation()]);
  await repository.upsertRoadCameras([minimalRoadCamera()]);
  await repository.upsertTrafficCounterSnapshots([minimalTrafficCounterSnapshot()]);
  await repository.upsertPublicTransportVehicles(
    [minimalPublicTransportVehicle()],
    "2026-06-02T12:00:00.000Z",
  );

  const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");
  expect(sql).not.toContain("INSERT INTO source_items");
  expect(sql).not.toContain("UPDATE source_items");
  expect(sql).not.toContain("INSERT INTO situation_source_items");
  expect(sql).not.toContain("INSERT INTO official_events");
  expect(sql).not.toContain("INSERT INTO situations");
  expect(sql).not.toContain("INSERT INTO evidence_items");
});
```

Use existing minimal object patterns from `repository.test.ts`. The placeholder helper names above are not existing APIs; if equivalent helpers are absent, create local test helpers at the bottom of `repository.test.ts` with concrete shared-type objects. Do not export production helpers only for tests.

**Step 3: Add mapper-level allowlist assertions**

In `apps/worker/test/source-items.test.ts`, add a small allowlist assertion documenting which mappers are intentionally allowed to create ledger rows today:

```ts
it("documents the source-item mapper allowlist", () => {
  const allowedLedgerSources = [
    "articles",
    "official_events",
    "vegvesen_traffic_info",
    "entur_service_alerts",
  ];
  const operationsOnlySources = [
    "datex_travel_time",
    "datex_weather",
    "datex_cctv",
    "trafikkdata",
    "entur_vehicle_positions",
  ];

  expect(operationsOnlySources.every((source) => !allowedLedgerSources.includes(source))).toBe(
    true,
  );
});
```

This assertion is documentation, not the main guard. The main guard is the repository SQL test in Step 2.

**Step 4: Preserve Entur service-alert distinction**

Entur service alerts are allowed to be source-item ledger rows, but they are not automatic situation activators in this release. If `apps/worker/test/entur-service-alerts.test.ts` lacks this assertion, strengthen the existing concrete service-alert source-item test rather than pasting a standalone pseudo-object. The assertion shape should be:

```ts
expect(item.provider).toBe("entur");
expect(item.kind).toBe("official_event");
// No call to detectPreliminarySituations or upsertSituation should happen from vehicle telemetry.
```

**Step 5: Verify targeted tests**

```bash
npm test -- apps/worker/test/repository.test.ts
npm test -- apps/worker/test/source-items.test.ts
npm test -- apps/worker/test/entur-service-alerts.test.ts
```

Expected: PASS after any necessary narrow fixture/test updates.

**Step 6: Commit if files changed**

```bash
git add apps/worker/test/repository.test.ts apps/worker/test/source-items.test.ts apps/worker/test/entur-service-alerts.test.ts apps/server/src/db/schema.sql
git commit -m "test: guard telemetry against evidence promotion"
```

If no files change because existing tests already cover the rule, record that in the implementation notes instead of making an empty commit.

---

### Task 9: Run worker correctness gates

**Objective:** Prove the fixture hardening did not break worker correctness or type contracts.

**Files:**

- No source edits unless verification exposes failures.

**Step 1: Run targeted tests**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- apps/worker/test/classify.test.ts
npm test -- apps/worker/test/clusters.test.ts
npm test -- apps/worker/test/politiloggen.test.ts
npm test -- apps/worker/test/source-items.test.ts
```

Expected: PASS.

**Step 2: Run broader gates**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test -- apps/worker/test
```

Expected: PASS.

**Step 3: Commit fixes only if verification required changes**

```bash
git status --short
```

If dirty, stage only relevant files and commit with a specific message. Do not stage unrelated worktrees, screenshots, or local research files.

---

### Task 10: Run provenance-first post-implementation audit

**Objective:** Ensure the new correctness fixtures did not leave source confidence/freshness/layer semantics inconsistent with the UI/product contract.

**Files:**

- Read: `/Users/reidar/.hermes/skills/software-development/writing-plans/references/provenance-ui-post-implementation-audit.md`
- Create after implementation: `docs/audits/2026-06-02-incident-provenance-ui-post-implementation-audit.md`.
- Modify tests only if the audit finds missing assertions.

**Step 1: Read audit checklist**

Use Hermes `skill_view(name="writing-plans", file_path="references/provenance-ui-post-implementation-audit.md")` or read the file directly.

**Step 2: Audit changed files and affected UI contracts**

Verify at minimum:

- Context feeds are not incident evidence.
- MET/NVE warning context is not rendered as confirmation.
- DATEX TravelTime/Weather/CCTV, Trafikkdata counters, and Entur vehicles do not increment disruption/situation counts.
- Public-transport service alerts remain separate from vehicle telemetry.
- Estimated geocoded places remain marked as `reporting_estimate`.
- Dismissed false positives remain hidden from current situation surfaces while preserving history.
- External source URLs in any newly touched UI path use the shared sanitizer.

**Step 3: Write audit note**

Create `docs/audits/2026-06-02-incident-provenance-ui-post-implementation-audit.md` with:

```markdown
# Provenance UI Post-Implementation Audit

## Scope

Incident correctness fixture hardening from `docs/plans/2026-06-02-incident-correctness-fixtures.md`.

## Checks

- [ ] Context feeds are not incident evidence.
- [ ] Public transport vehicles do not count as disruptions.
- [ ] MET/NVE warnings are context only.
- [ ] Estimated places stay visibly estimated.
- [ ] Dismissed false positives are not current active situations.

## Findings

Record PASS/REQUEST_CHANGES with file paths and exact follow-up tests.
```

**Step 4: Commit audit note/fixes**

```bash
git add docs/audits/2026-06-02-incident-provenance-ui-post-implementation-audit.md
# If audit fixes were needed, add those exact test/source files too.
git commit -m "docs: audit incident provenance UI boundaries"
```

---

## Final verification for this plan

After all implementation tasks above:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Expected: all pass before any merge/deploy/live claim.

## Production verification after merge/deploy

Do not claim deployed correctness until the exact pushed SHA has GitHub Actions `status=completed` and `conclusion=success`, and production health/UI checks have run.

Suggested read-only checks after deployment:

```bash
HEAD_SHA=$(git rev-parse HEAD)
gh run list --repo Reedtrullz/Nytt-Trondheim --commit "$HEAD_SHA" --limit 10 --json databaseId,name,status,conclusion,headSha,url
curl -fsS https://nytt.reidar.tech/health
```

Authenticated/browser checks are required before claiming Situation Room UI behavior live.

## Plan review history

- 2026-06-02 initial parent review: plan written from current architecture docs, source docs, worker clustering/classification code, schema ledger boundaries, and Hermes external-feed/provenance planning references.
- 2026-06-02 quality review returned `REQUEST_CHANGES` for vague telemetry/source-item checks, under-specified MET/NVE context assertions, overfit event-descriptor implementation, alias extraction gaps, non-conventional audit output path, and a low-impact DATEX assertion gap.
- 2026-06-02 patch response: made telemetry checks concrete against `repository.test.ts` SQL calls, added warning-context activation/verification assertions, converted descriptor logic to a named explicit table, required alias extraction terms, moved audit output to `docs/audits/...`, and added explicit low-impact DATEX preservation.
- 2026-06-02 second quality review returned `REQUEST_CHANGES` for compound fire descriptors not matching current `detectType`, MET context fixtures lacking article location/covering geometry, time-dependent warning `validTo`, underpowered broad-Trondheim negative fixture, indirect DATEX parser verification, and two copyability nits.
- 2026-06-02 second patch response: added standalone `brann` text to same-place fixtures while preserving descriptor words, supplied article locations plus covering MET polygon, moved fixture `validTo` to 2099, made both broad-place articles detectable as `ulykke`, added `datex.test.ts` low-impact parser verification, and clarified placeholder helper/service-alert snippets.
- 2026-06-02 final quality review returned `REQUEST_CHANGES` for false helper typecheck coverage, missing fixture import/removal instructions, telemetry SQL guard not checking `official_events`/`situations`/`evidence_items`, and an MET/NVE wording nit.
- 2026-06-02 final patch response: Task 1 now imports the helper into `classify.test.ts` and removes the old local helper, later tasks name the exact fixture imports for classify/clusters tests, Task 8 guards all incident/evidence/promotion tables, and the attached warning fixture is explicitly MET-only while warning-only coverage remains MET+NVE.
- Before implementation, request one final spec-compliance review and one final code-quality/data-provenance review of this plan. Patch any remaining blocker before dispatching Task 17.
