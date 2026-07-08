# /trafikk Map-First Route Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move selected-route traffic context out of duplicated text boxes and into the map as the primary spatial surface, while keeping one compact accessible fallback list.

**Architecture:** This is a frontend-only presentation refactor. `TrafficMapPage.tsx` will derive a small route-context view model from existing `TravelPlanPayload` fields, render a compact summary/fallback in `TravelPlanCard`, and reuse existing map selection state to focus matching map items where possible.

**Tech Stack:** React 19, TypeScript, Vite, Leaflet/react-leaflet, Vitest render/helper tests, Playwright E2E, existing `@nytt/shared` contracts.

## Global Constraints

- All user-facing copy is Bokmål.
- No new database tables, providers, `source_items`, situation evidence, or upstream Entur/AtB calls.
- Entur, DATEX, Vegvesen, and public-transport context remain traveller context, not editorial provenance or situation evidence.
- Keep `/trafikk` public/viewer-safe; do not introduce owner-only controls into the traveller result.
- Keep mobile order traveller-first: planner, advice, route choices, selected route, departure context, traffic picture, map, then data/source fallback.
- Do not stage or commit untracked local support files such as `AGENTS.md`, `apps/*/AGENTS.md`, `HJZyzpGaEAEz4P3.jpeg`, `nytt-trondheim-consolidated-research.md`, or `.superpowers/`.

---

## File Structure

- Modify `apps/frontend/src/pages/TrafficMapPage.tsx`
  - Add route-context view-model helpers.
  - Simplify `TravelPlanCard` route-context rendering.
  - Wire fallback-row clicks to existing map selection state.
  - Keep map disclosure open after route search when selected route has context.
- Modify `apps/frontend/src/pages/TrafficMapPage.test.tsx`
  - Unit-test route-context helper behavior and compact fallback rendering inputs.
- Modify `apps/frontend/src/styles.css`
  - Remove large route-context card/grid styling from the journey result.
  - Add compact route-context summary and fallback list styling.
  - Ensure map-first mobile order remains stable.
- Modify `e2e/app.spec.ts`
  - Assert post-search route-context text is compact, map is reachable, fallback can focus an item, and no horizontal overflow appears on mobile.

No backend files are expected to change.

---

### Task 1: Derive Compact Route Context View Model

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Test: `apps/frontend/src/pages/TrafficMapPage.test.tsx`

**Interfaces:**

- Consumes: `TravelPlanPayload`, `TravelPlanPayload["trafficImpacts"]`, `TravelPlanPayload["publicTransportSuggestions"]`
- Produces:
  - `export type RouteContextItem = { id: string; kind: "traffic" | "transit_alert"; title: string; detail: string; source: string; severity: "ok" | "watch" | "warning"; distanceLabel?: string; eventId?: string; suggestionId?: string; focusable: boolean; }`
  - `export type RouteContextSummary = { count: number; mapPointCount: number; blockingCount: number; heading: string; detail: string; items: RouteContextItem[]; }`
  - `export function buildRouteContextSummary(plan?: TravelPlanPayload): RouteContextSummary`

- [ ] **Step 1: Add failing unit tests for summary shape**

Append this test block to `apps/frontend/src/pages/TrafficMapPage.test.tsx` after the existing travel-plan helper tests:

```ts
describe("route context summary", () => {
  const basePlan = (overrides: Partial<TravelPlanPayload> = {}): TravelPlanPayload =>
    ({
      origin: {
        label: "Munkegata, Trondheim",
        query: "Munkegata",
        coordinate: [10.393742, 63.432883],
      },
      destination: {
        label: "Lade gård, Trondheim",
        query: "Lade",
        coordinate: [10.463, 63.433],
      },
      route: {
        status: "ok",
        detail: "Rute beregnet med OSRM.",
        distanceMeters: 3700,
        durationSeconds: 420,
        polyline: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
      decision: {
        action: "check_operator",
        headline: "Sjekk ruten før du drar",
        reason: "Nytt fant punkter langs ruten.",
        severity: "watch",
        confidence: "medium",
        updatedAt: "2026-07-08T10:00:00.000Z",
      },
      trafficImpacts: [
        {
          event: {
            id: "traffic:f6650",
            title: "Fv. 6650 Ilevolen",
            summary: "Vegarbeid ved foreslått rute.",
            category: "roadwork",
            severity: "medium",
            status: "active",
            source: "vegvesen",
            updatedAt: "2026-07-08T09:55:00.000Z",
            locationLabel: "Ilevolen",
            geometry: {
              type: "Point",
              coordinates: [10.3901, 63.4301],
            },
          },
          distanceMeters: 121,
          summary: "121 m fra foreslått rute",
        },
      ],
      publicTransportSuggestions: [
        {
          id: "alert:line-3",
          kind: "alert",
          title: "Endret rute",
          detail: "Linje 3 kjører via Lerkendal.",
          source: "Entur",
          distanceMeters: 220,
          href: "https://www.atb.no/reise/",
        },
      ],
      vehicles: [],
      weather: [],
      journeyPlanner: {
        status: "ok",
        detail: "Entur fant reiseforslag.",
      },
      itineraries: [],
      dependencies: [],
      generatedAt: "2026-07-08T10:00:00.000Z",
      ...overrides,
    }) as TravelPlanPayload;

  it("summarizes traffic and alert context without exposing full text grids", () => {
    const summary = buildRouteContextSummary(basePlan());

    expect(summary).toMatchObject({
      count: 2,
      mapPointCount: 1,
      blockingCount: 0,
      heading: "2 punkt langs valgt rute",
    });
    expect(summary.detail).toContain("Kartet viser plassering");
    expect(summary.items).toEqual([
      expect.objectContaining({
        id: "traffic:traffic:f6650",
        kind: "traffic",
        title: "Fv. 6650 Ilevolen",
        distanceLabel: "121 m fra ruten",
        source: "Vegvesen",
        eventId: "traffic:f6650",
        focusable: true,
      }),
      expect.objectContaining({
        id: "transit_alert:alert:line-3",
        kind: "transit_alert",
        title: "Endret rute",
        distanceLabel: "220 m fra ruten",
        source: "Entur",
        focusable: false,
      }),
    ]);
  });

  it("returns an empty calm summary when no route context exists", () => {
    const summary = buildRouteContextSummary(
      basePlan({ trafficImpacts: [], publicTransportSuggestions: [] }),
    );

    expect(summary).toMatchObject({
      count: 0,
      mapPointCount: 0,
      heading: "Ingen kartpunkter langs valgt rute",
      items: [],
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- TrafficMapPage.test.tsx -t "route context summary"
```

Expected: FAIL because `buildRouteContextSummary` is not exported.

- [ ] **Step 3: Add minimal implementation and exports**

In `apps/frontend/src/pages/TrafficMapPage.tsx`, add these helpers near the existing travel-plan helper exports, before `function TravelPlanCard`:

```ts
export type RouteContextItem = {
  id: string;
  kind: "traffic" | "transit_alert";
  title: string;
  detail: string;
  source: string;
  severity: "ok" | "watch" | "warning";
  distanceLabel?: string;
  eventId?: string;
  suggestionId?: string;
  focusable: boolean;
};

export type RouteContextSummary = {
  count: number;
  mapPointCount: number;
  blockingCount: number;
  heading: string;
  detail: string;
  items: RouteContextItem[];
};

function routeContextSeverityFromTraffic(severity?: string): RouteContextItem["severity"] {
  if (severity === "high" || severity === "critical") return "warning";
  if (severity === "medium") return "watch";
  return "ok";
}

function routeContextSourceLabel(source: string): string {
  const normalized = source.toLocaleLowerCase("nb");
  if (normalized.includes("vegvesen") || normalized === "datex") return "Vegvesen";
  if (normalized.includes("entur")) return "Entur";
  return source;
}

function routeContextDistanceLabel(distanceMeters?: number): string | undefined {
  if (distanceMeters === undefined) return undefined;
  return `${formatDistance(distanceMeters)} fra ruten`;
}

export function buildRouteContextSummary(plan?: TravelPlanPayload): RouteContextSummary {
  const trafficItems: RouteContextItem[] = (plan?.trafficImpacts ?? []).map((impact) => ({
    id: `traffic:${impact.event.id}`,
    kind: "traffic",
    title: impact.event.title,
    detail: impact.summary || impact.event.summary,
    source: routeContextSourceLabel(impact.event.source),
    severity: routeContextSeverityFromTraffic(impact.event.severity),
    distanceLabel: routeContextDistanceLabel(impact.distanceMeters),
    eventId: impact.event.id,
    focusable: true,
  }));

  const alertItems: RouteContextItem[] = (plan?.publicTransportSuggestions ?? [])
    .filter((suggestion) => suggestion.kind === "alert")
    .map((suggestion) => ({
      id: `transit_alert:${suggestion.id}`,
      kind: "transit_alert",
      title: suggestion.title,
      detail: suggestion.detail,
      source: routeContextSourceLabel(suggestion.source),
      severity: "watch",
      distanceLabel: routeContextDistanceLabel(suggestion.distanceMeters),
      suggestionId: suggestion.id,
      focusable: false,
    }));

  const items = [...trafficItems, ...alertItems];
  const blockingCount = items.filter((item) => item.severity === "warning").length;
  const mapPointCount = items.filter((item) => item.focusable).length;

  if (!items.length) {
    return {
      count: 0,
      mapPointCount: 0,
      blockingCount: 0,
      heading: "Ingen kartpunkter langs valgt rute",
      detail: "Nytt fant ingen aktive trafikkpunkter langs valgt rute akkurat nå.",
      items: [],
    };
  }

  return {
    count: items.length,
    mapPointCount,
    blockingCount,
    heading: `${items.length} ${items.length === 1 ? "punkt" : "punkter"} langs valgt rute`,
    detail:
      blockingCount > 0
        ? `${blockingCount} punkt bør sjekkes før avreise. Kartet viser plassering langs valgt rute.`
        : "Kartet viser plassering langs valgt rute. Tekstlisten er kun en kompakt fallback.",
    items,
  };
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- TrafficMapPage.test.tsx -t "route context summary"
```

Expected: PASS for the new route-context tests.

- [ ] **Step 5: Run the full page helper test file**

Run:

```bash
npm test -- TrafficMapPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit task 1**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.tsx
git commit -m "Add traffic route context summary model"
```

Expected: commit contains only the helper and tests.

---

### Task 2: Replace Duplicated Route Context Boxes With Compact Fallback

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Test: `apps/frontend/src/pages/TrafficMapPage.test.tsx`

**Interfaces:**

- Consumes: `buildRouteContextSummary(plan)`, `RouteContextSummary`, `RouteContextItem`
- Produces:
  - `function RouteContextFallback({ summary, onFocusItem }: { summary: RouteContextSummary; onFocusItem?: (item: RouteContextItem) => void }): JSX.Element | null`
  - `TravelPlanCard` no longer renders `plan.trafficImpacts` as full list boxes in the main result.

- [ ] **Step 1: Add failing render-helper tests for compact fallback copy**

In `apps/frontend/src/pages/TrafficMapPage.test.tsx`, add this import:

```ts
import { renderToStaticMarkup } from "react-dom/server";
```

Then add this test block after the route-context summary tests:

```ts
describe("route context fallback markup", () => {
  it("renders compact collapsed fallback language without full route-impact card grids", () => {
    const summary = {
      count: 2,
      mapPointCount: 1,
      blockingCount: 0,
      heading: "2 punkter langs valgt rute",
      detail: "Kartet viser plassering langs valgt rute. Tekstlisten er kun en kompakt fallback.",
      items: [
        {
          id: "traffic:one",
          kind: "traffic" as const,
          title: "Fv. 6650 Ilevolen",
          detail: "121 m fra foreslått rute",
          source: "Vegvesen",
          severity: "watch" as const,
          distanceLabel: "121 m fra ruten",
          eventId: "one",
          focusable: true,
        },
        {
          id: "transit_alert:two",
          kind: "transit_alert" as const,
          title: "Endret rute",
          detail: "Linje 3 kjører via Lerkendal.",
          source: "Entur",
          severity: "watch" as const,
          distanceLabel: "220 m fra ruten",
          suggestionId: "two",
          focusable: false,
        },
      ],
    };

    const html = renderToStaticMarkup(<RouteContextFallback summary={summary} />);

    expect(html).toContain("Kartpunkter langs valgt rute");
    expect(html).toContain("2 punkter langs valgt rute");
    expect(html).toContain("Fv. 6650 Ilevolen");
    expect(html).toContain("Endret rute");
    expect(html).not.toContain("Se trafikk langs ruten");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- TrafficMapPage.test.tsx -t "route context fallback markup"
```

Expected: FAIL because `RouteContextFallback` is not exported.

- [ ] **Step 3: Implement compact fallback component**

In `apps/frontend/src/pages/TrafficMapPage.tsx`, add this exported component after `buildRouteContextSummary`:

```tsx
export function RouteContextFallback({
  summary,
  onFocusItem,
}: {
  summary: RouteContextSummary;
  onFocusItem?: (item: RouteContextItem) => void;
}) {
  if (summary.count === 0) {
    return (
      <p className="route-context-empty">
        Ingen aktive trafikkpunkter funnet langs valgt rute akkurat nå.
      </p>
    );
  }

  return (
    <details className="route-context-fallback">
      <summary>
        <span>Kartpunkter langs valgt rute</span>
        <strong>{summary.heading}</strong>
      </summary>
      <p>{summary.detail}</p>
      <ol>
        {summary.items.map((item, index) => (
          <li
            key={item.id}
            className={`route-context-fallback-item route-context-${item.severity}`}
          >
            <button
              type="button"
              disabled={!item.focusable || !onFocusItem}
              onClick={() => onFocusItem?.(item)}
            >
              <span>{index + 1}</span>
              <strong>{item.title}</strong>
              <small>{[item.distanceLabel, item.source].filter(Boolean).join(" · ")}</small>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}
```

- [ ] **Step 4: Replace `TravelPlanCard` duplicated lists**

Change the `TravelPlanCard` props in `apps/frontend/src/pages/TrafficMapPage.tsx`:

```ts
function TravelPlanCard({
  plan,
  loading,
  error,
  selectedItineraryId,
  routeChoiceModel,
  routeWatchSummary,
  onSelectItinerary,
  onFocusRouteContextItem,
}: {
  plan?: TravelPlanPayload;
  loading: boolean;
  error?: string;
  selectedItineraryId?: string;
  routeChoiceModel?: RouteChoiceModel;
  routeWatchSummary?: SelectedRouteWatchSummary;
  onSelectItinerary: (itineraryId: string) => void;
  onFocusRouteContextItem?: (item: RouteContextItem) => void;
}) {
```

Inside `TravelPlanCard`, replace the old `routeContextCount` calculation and remove the `details` block with summary `Se trafikk langs ruten`. Use:

```ts
const routeContextSummary = buildRouteContextSummary(plan);
```

Update the route summary `<small>` line to:

```tsx
<small>
  {decision.itineraryCount} reiseforslag · {routeContextSummary.heading}
</small>
```

After the selected journey section, render:

```tsx
<RouteContextFallback summary={routeContextSummary} onFocusItem={onFocusRouteContextItem} />
```

Keep the existing fallback `Kollektivkontekst` disclosure for the no-itinerary fallback case, but ensure it is shown only when `showFallbackSuggestions` is true.

- [ ] **Step 5: Add compact CSS**

In `apps/frontend/src/styles.css`, add these rules near the existing travel-plan styles:

```css
.route-context-empty {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 14px;
}

.route-context-fallback {
  margin-top: 12px;
  border: 1px solid var(--line);
  background: var(--paper);
}

.route-context-fallback summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  color: var(--blue);
  cursor: pointer;
  font-weight: 700;
}

.route-context-fallback summary span {
  font-size: 13px;
}

.route-context-fallback summary strong {
  color: var(--muted);
  font-size: 12px;
}

.route-context-fallback p {
  margin: 0;
  padding: 0 12px 10px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.route-context-fallback ol {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}

.route-context-fallback-item button {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 8px 10px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: inherit;
  text-align: left;
}

.route-context-fallback-item button:not(:disabled) {
  cursor: pointer;
}

.route-context-fallback-item button:not(:disabled):hover,
.route-context-fallback-item button:not(:disabled):focus-visible {
  background: #eef4f8;
}

.route-context-fallback-item span {
  grid-row: span 2;
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.route-context-fallback-item strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
}

.route-context-fallback-item small {
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- TrafficMapPage.test.tsx -t "route context"
```

Expected: PASS.

- [ ] **Step 7: Commit task 2**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.tsx apps/frontend/src/styles.css
git commit -m "Compact traffic route context fallback"
```

Expected: commit contains the compact fallback component, card changes, styles, and tests.

---

### Task 3: Wire Fallback Rows To Map Focus

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Test: `apps/frontend/src/pages/TrafficMapPage.test.tsx`

**Interfaces:**

- Consumes: `RouteContextItem.eventId`, existing `selectedEventId`, existing `setSelectedEventId`, existing `TrafficMapFocus`
- Produces:
  - `export function eventIdForRouteContextItem(item: RouteContextItem): string | undefined`
  - `TrafficMapPage` passes `onFocusRouteContextItem` into `TravelPlanCard`.

- [ ] **Step 1: Add failing helper test**

Add this test to `apps/frontend/src/pages/TrafficMapPage.test.tsx`:

```ts
describe("route context map focus", () => {
  it("returns traffic event ids for focusable route context items only", () => {
    expect(
      eventIdForRouteContextItem({
        id: "traffic:one",
        kind: "traffic",
        title: "Fv. 6650",
        detail: "121 m fra ruten",
        source: "Vegvesen",
        severity: "watch",
        eventId: "one",
        focusable: true,
      }),
    ).toBe("one");

    expect(
      eventIdForRouteContextItem({
        id: "transit_alert:two",
        kind: "transit_alert",
        title: "Endret rute",
        detail: "Linje 3",
        source: "Entur",
        severity: "watch",
        suggestionId: "two",
        focusable: false,
      }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- TrafficMapPage.test.tsx -t "route context map focus"
```

Expected: FAIL because `eventIdForRouteContextItem` is not exported.

- [ ] **Step 3: Implement the helper**

In `apps/frontend/src/pages/TrafficMapPage.tsx`, add this near the route-context helpers:

```ts
export function eventIdForRouteContextItem(item: RouteContextItem): string | undefined {
  return item.kind === "traffic" && item.focusable ? item.eventId : undefined;
}
```

- [ ] **Step 4: Wire the page state**

In the main `TrafficMapPage` component, add this callback near the other handlers:

```ts
const handleFocusRouteContextItem = useCallback((item: RouteContextItem) => {
  const eventId = eventIdForRouteContextItem(item);
  if (!eventId) return;
  setSelectedEventId(eventId);
}, []);
```

Update the `TravelPlanCard` call site to pass:

```tsx
onFocusRouteContextItem = { handleFocusRouteContextItem };
```

If the existing `TravelPlanCard` call is:

```tsx
<TravelPlanCard
  plan={travelPlan}
  loading={travelPlanLoading}
  error={travelPlanError}
  selectedItineraryId={selectedItineraryId}
  routeChoiceModel={routeChoiceModel}
  routeWatchSummary={routeWatchSummary}
  onSelectItinerary={setSelectedItineraryId}
/>
```

change it to:

```tsx
<TravelPlanCard
  plan={travelPlan}
  loading={travelPlanLoading}
  error={travelPlanError}
  selectedItineraryId={selectedItineraryId}
  routeChoiceModel={routeChoiceModel}
  routeWatchSummary={routeWatchSummary}
  onSelectItinerary={setSelectedItineraryId}
  onFocusRouteContextItem={handleFocusRouteContextItem}
/>
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- TrafficMapPage.test.tsx -t "route context map focus"
npm test -- TrafficMapPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit task 3**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.tsx
git commit -m "Focus traffic map from route context fallback"
```

Expected: commit contains only focus helper/wiring and tests.

---

### Task 4: Make Map The Primary Post-Search Route Context Surface

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Test: `e2e/app.spec.ts`

**Interfaces:**

- Consumes: existing `travelPlan`, existing `traffic-map-disclosure`, existing `TrafficLayer`, existing `TravelPlanLayer`
- Produces: post-search map disclosure is visually reachable and no longer buried behind duplicated text lists.

- [ ] **Step 1: Add failing E2E assertions for map-first route context**

In `e2e/app.spec.ts`, find the existing `/trafikk` post-search E2E test that submits `Munkegata` to `Lade` and asserts route choices. Add these assertions after the travel result is visible:

```ts
await expect(page.getByText("Kartpunkter langs valgt rute")).toBeVisible();
await expect(page.getByText("Se trafikk langs ruten")).toHaveCount(0);

const mapDisclosure = page.locator("details.traffic-map-disclosure").first();
await expect(mapDisclosure).toHaveCount(1);
await mapDisclosure.evaluate((node) => {
  (node as HTMLDetailsElement).open = true;
});
await expect(page.locator(".traffic-map")).toBeVisible();

const fallback = page.locator("details.route-context-fallback").first();
await fallback.evaluate((node) => {
  (node as HTMLDetailsElement).open = true;
});
await expect(fallback.getByRole("button", { name: /Fv\. 6650|Ilevolen|Vegvesen/ })).toBeVisible();
```

- [ ] **Step 2: Run focused E2E to verify it fails before final UI wiring**

Run:

```bash
npm run test:e2e -- -g "traffic"
```

Expected: FAIL if the old `Se trafikk langs ruten` text is still present or fallback selectors are not wired.

- [ ] **Step 3: Keep map disclosure easy to reach after search**

In `apps/frontend/src/pages/TrafficMapPage.tsx`, change the map disclosure `open` expression from:

```tsx
<details className="traffic-support-disclosure traffic-map-disclosure" open={!travelPlan}>
```

to:

```tsx
<details
  className="traffic-support-disclosure traffic-map-disclosure"
  open={!travelPlan || Boolean(travelPlan && buildRouteContextSummary(travelPlan).count > 0)}
>
```

If this recomputes too much inline, introduce:

```ts
const activeRouteContextSummary = useMemo(() => buildRouteContextSummary(travelPlan), [travelPlan]);
```

near the other `useMemo` values and use:

```tsx
open={!travelPlan || activeRouteContextSummary.count > 0}
```

- [ ] **Step 4: Adjust mobile order only if current CSS regresses**

Check `apps/frontend/src/styles.css` for the existing mobile order:

```css
.traffic-map-disclosure {
  order: 5;
}

.traffic-data-disclosure {
  order: 6;
}
```

Keep this order. If new fallback styling pushes the map down, add:

```css
.travel-plan-card .route-context-fallback {
  margin-bottom: 0;
}
```

Do not move `traffic-data-disclosure` above the map.

- [ ] **Step 5: Run focused E2E**

Run:

```bash
npm run test:e2e -- -g "traffic"
```

Expected: PASS. The traffic route-search test should show compact route context and visible map.

- [ ] **Step 6: Commit task 4**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/styles.css e2e/app.spec.ts
git commit -m "Make traffic map primary route context"
```

Expected: commit contains map disclosure behavior, final CSS adjustment, and E2E coverage.

---

### Task 5: Final Verification And Release Readiness

**Files:**

- Modify only if previous tasks exposed formatting or test drift.

**Interfaces:**

- Consumes: all previous task commits.
- Produces: a verified, ready-to-ship branch.

- [ ] **Step 1: Format touched files**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npx prettier --write apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/styles.css e2e/app.spec.ts docs/superpowers/specs/2026-07-08-trafikk-map-first-route-context-design.md docs/superpowers/plans/2026-07-08-trafikk-map-first-route-context.md
```

Expected: Prettier writes or confirms the touched files.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- TrafficMapPage.test.tsx
npm run test:e2e -- -g "traffic"
```

Expected: PASS.

- [ ] **Step 3: Run standard gates**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected:

- Format, lint, typecheck, unit/integration tests, build, E2E, audit, and whitespace check all pass.
- No command reports secrets or modifies production state.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --stat HEAD
git diff -- apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.tsx apps/frontend/src/styles.css e2e/app.spec.ts
git status --short
```

Expected:

- Diff is limited to `/trafikk` frontend/test files and docs.
- `.superpowers/` and unrelated untracked files are not staged.

- [ ] **Step 5: Commit verification cleanup if needed**

If formatting or tiny test adjustments changed files after Task 4, run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.tsx apps/frontend/src/styles.css e2e/app.spec.ts docs/superpowers/specs/2026-07-08-trafikk-map-first-route-context-design.md docs/superpowers/plans/2026-07-08-trafikk-map-first-route-context.md
git commit -m "Polish traffic map-first route context"
```

Expected: commit is created only if there are tracked changes.

- [ ] **Step 6: Prepare ship handoff**

Run:

```bash
git log --oneline -5
git status --short --branch
```

Expected:

- Branch contains the task commits.
- Worktree has no unintended staged files.
- Remaining untracked support artifacts are explicitly called out in the handoff.

---

## Self-Review Checklist

- Spec coverage: covered map-first hierarchy, compact fallback, map focus, mobile order, and no backend/provenance changes.
- Placeholder scan: no forbidden placeholder markers or vague test-only steps remain.
- Type consistency: `RouteContextItem`, `RouteContextSummary`, `buildRouteContextSummary`, `RouteContextFallback`, and `eventIdForRouteContextItem` are named consistently across tasks.
- Scope check: this is a single frontend presentation slice; broader `/trafikk` ranking, Entur fanout, and traffic-source semantics are intentionally out of scope.
