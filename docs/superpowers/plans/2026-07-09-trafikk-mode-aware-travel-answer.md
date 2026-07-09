# /trafikk Mode-Aware Travel Answer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/trafikk` answer the traveller with either a concrete transit journey or a concrete walking route before it shows route-context counts.

**Architecture:** Keep `/api/map/travel-plan` as the single response contract and add mode-aware fields to that payload. The server decides whether the top answer is transit, walk, or handoff; the frontend renders that decision and moves the existing map surface into the post-search answer flow without adding new upstream providers.

**Tech Stack:** TypeScript, React 19, Vite, Express 5, Vitest, Playwright, Leaflet/react-leaflet, existing Entur Journey Planner and OSRM corridor lookup, `@nytt/shared` contracts.

## Global Constraints

- Public transport is primary only when Entur returns at least one usable itinerary for the selected time.
- Walking becomes the primary result when no usable public-transport itinerary exists and OSRM can produce a route.
- A later public-transport option may appear as secondary context, not as the main answer, when the selected time is a dead transit window.
- Roadworks and traffic points appear as route context on the map and in one compact fallback disclosure.
- The map must be visible near the first result after a search, especially when the page recommends walking.
- `0 reiseforslag` must not appear as the key result without a replacement answer.
- If walking is recommended, roadworks along the corridor should be described as "langs gangruta", not as generic traffic audit output.
- Bokmål copy should stay practical and low-drama.
- Keep Entur as public-transport authority and OSRM as route-shape/duration context.
- If route geometry already exists for OSRM, reuse it for the walking map instead of adding another external dependency.
- Do not create source items, situations, or editorial evidence from walking fallback data.
- Do not add persisted user commutes or server-side location storage.
- Keep `/trafikk` public/viewer-safe and keep AtB/Entur handoff copy.
- Preserve the existing request-id plus abort-cleanup pattern for travel-plan fetches.
- Do not stage or commit unrelated untracked local support files such as `AGENTS.md`, `apps/*/AGENTS.md`, `HJZyzpGaEAEz4P3.jpeg`, `docs/superpowers/plans/2026-07-09-next-high-impact-slices.md`, `nytt-trondheim-consolidated-research.md`, or `.superpowers/`.

---

## File Structure

- Modify `packages/shared/src/traffic-map.ts`
  - Add the additive travel-answer contract: `TravelPlanPrimaryMode`, `TravelPlanWalkingRoute`, `TravelPlanNextTransitOption`, and new optional fields on `TravelPlanPayload`.
  - Keep existing fields unchanged so old clients still work.
- Modify `apps/server/src/traffic/travel-plan.ts`
  - Derive `primaryMode`.
  - Build a walking route from the already resolved route geometry when Entur returns no usable itinerary.
  - Estimate walking duration from distance instead of using OSRM driving duration.
- Modify `apps/server/test/travel-plan.test.ts`
  - Add focused tests for transit-primary, walking-primary, degraded walking, and handoff states.
- Modify `apps/frontend/src/pages/TrafficMapPage.tsx`
  - Update `travelPlanDecision`.
  - Render a walking-answer block when `primaryMode === "walk"`.
  - Stop making `Ingen konkrete Entur-reiser funnet` the visible primary answer when walking is available.
  - Move the existing map disclosure into the immediate post-search answer flow.
- Modify `apps/frontend/src/pages/TrafficMapPage.test.ts`
  - Add helper and render tests for walking-primary copy, transit-primary copy, and no prominent `0 reiseforslag`.
- Modify `apps/frontend/src/styles.css`
  - Add compact mode-aware answer styling.
  - Make the post-search map visually part of the result on desktop and mobile.
- Modify `e2e/app.spec.ts`
  - Update existing `/trafikk` e2e expectations for the new walking fallback and transit answer hierarchy.

No database migrations, new source contracts, new upstream providers, or worker changes are part of this slice.

---

### Task 1: Add Mode-Aware Travel Plan Contract And Server Decision

**Files:**

- Modify: `packages/shared/src/traffic-map.ts`
- Modify: `apps/server/src/traffic/travel-plan.ts`
- Test: `apps/server/test/travel-plan.test.ts`

**Interfaces:**

- Consumes:
  - `TravelPlanRoute`
  - `TravelPlanItinerary[]`
  - `TravelPlanJourneyStatusPayload`
- Produces:
  - `export type TravelPlanPrimaryMode = "transit" | "walk" | "fallback";`
  - `export interface TravelPlanWalkingRoute`
  - `export interface TravelPlanNextTransitOption`
  - `TravelPlanPayload.primaryMode`
  - `TravelPlanPayload.walkingRoute?`
  - `TravelPlanPayload.nextTransitOption?`
  - `export function estimateWalkingDurationSeconds(distanceMeters: number): number`

- [ ] **Step 1: Write failing shared/server tests**

In `apps/server/test/travel-plan.test.ts`, extend the `@nytt/shared` type import:

```ts
import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  TrafficMapEvent,
  TravelPlanItinerary,
  TravelPlanRoute,
} from "@nytt/shared";
```

Append these tests inside the existing travel-plan payload `describe` block that already covers `buildTravelPlanPayload` context windows:

```ts
const testRoute = {
  source: "direct",
  distanceMeters: 2520,
  detail: "Direkte korridor mellom punktene.",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.393742, 63.432883],
      [10.463, 63.433],
    ],
  },
} satisfies TravelPlanRoute;

const minimalItinerary = {
  id: "itinerary-bus-2",
  decision: "best",
  decisionReason: "Raskeste konkrete kollektivvalg.",
  labels: ["best_now"],
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T10:18:00.000Z",
  durationSeconds: 1080,
  transferCount: 0,
  walkTimeSeconds: 420,
  realtime: true,
  modes: ["bus"],
  legs: [],
  disruptionCount: 0,
  handoffUrl: "https://entur.no/reiseresultater",
} satisfies TravelPlanItinerary;

it("uses walking as primary mode when Entur has no usable itinerary and route geometry exists", () => {
  const payload = buildTravelPlanPayload({
    origin: {
      query: "Munkegata",
      label: "Munkegata, Trondheim",
      coordinate: [10.393742, 63.432883],
    },
    destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
    route: testRoute,
    events: [],
    vehicles: [],
    alerts: [],
    sourceHealth,
    itineraries: [],
    journeyPlanner: {
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
      requestedDepartureTime: "2026-06-01T23:30:00.000Z",
    },
    generatedAt: new Date("2026-06-01T23:30:00.000Z"),
  });

  expect(payload.primaryMode).toBe("walk");
  expect(payload.walkingRoute).toMatchObject({
    source: "direct",
    distanceMeters: 2520,
    durationSeconds: 1860,
    detail: expect.stringContaining("Gangtid estimert"),
  });
  expect(payload.nextTransitOption).toBeUndefined();
  expect(payload.journeyPlanner.status).toBe("empty");
});

it("uses transit as primary mode when Entur returns a usable itinerary", () => {
  const payload = buildTravelPlanPayload({
    origin: {
      query: "Munkegata",
      label: "Munkegata, Trondheim",
      coordinate: [10.393742, 63.432883],
    },
    destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
    route: testRoute,
    events: [],
    vehicles: [],
    alerts: [],
    sourceHealth,
    itineraries: [minimalItinerary],
    journeyPlanner: {
      status: "ok",
      detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
      requestedDepartureTime: "2026-06-01T10:00:00.000Z",
    },
    generatedAt: new Date("2026-06-01T09:55:00.000Z"),
  });

  expect(payload.primaryMode).toBe("transit");
  expect(payload.walkingRoute).toBeUndefined();
  expect(payload.itineraries).toHaveLength(1);
});

it("keeps walking as degraded primary mode when Entur fails but route geometry exists", () => {
  const payload = buildTravelPlanPayload({
    origin: {
      query: "Munkegata",
      label: "Munkegata, Trondheim",
      coordinate: [10.393742, 63.432883],
    },
    destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
    route: testRoute,
    events: [],
    vehicles: [],
    alerts: [],
    sourceHealth,
    itineraries: undefined,
    journeyPlanner: {
      status: "unavailable",
      detail: "Entur reisesøk er ikke tilgjengelig akkurat nå.",
      requestedDepartureTime: "2026-06-01T23:30:00.000Z",
    },
    generatedAt: new Date("2026-06-01T23:30:00.000Z"),
  });

  expect(payload.primaryMode).toBe("walk");
  expect(payload.walkingRoute?.durationSeconds).toBe(1860);
  expect(payload.journeyPlanner.status).toBe("unavailable");
});

it("uses handoff fallback when neither Entur nor route geometry can answer the trip", () => {
  const payload = buildTravelPlanPayload({
    origin: {
      query: "Munkegata",
      label: "Munkegata, Trondheim",
      coordinate: [10.393742, 63.432883],
    },
    destination: { query: "Lade", label: "Lade gård, Trondheim", coordinate: [10.463, 63.433] },
    route: {
      source: "direct",
      distanceMeters: 0,
      detail: "Kunne ikke beregne rute.",
      geometry: { type: "LineString", coordinates: [] },
    },
    events: [],
    vehicles: [],
    alerts: [],
    sourceHealth,
    itineraries: [],
    journeyPlanner: {
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
      requestedDepartureTime: "2026-06-01T23:30:00.000Z",
    },
    generatedAt: new Date("2026-06-01T23:30:00.000Z"),
  });

  expect(payload.primaryMode).toBe("fallback");
  expect(payload.walkingRoute).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused tests and confirm the contract is missing**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- travel-plan.test.ts -t "primary mode"
```

Expected: FAIL with TypeScript or assertion errors because `primaryMode`, `walkingRoute`, and `TravelPlanItinerary` import usage are not wired yet.

- [ ] **Step 3: Add shared payload fields**

In `packages/shared/src/traffic-map.ts`, insert these definitions after `TravelPlanJourneyStatusPayload`:

```ts
export type TravelPlanPrimaryMode = "transit" | "walk" | "fallback";

export interface TravelPlanWalkingRoute {
  source: TravelPlanRoute["source"];
  geometry: LineString;
  distanceMeters: number;
  durationSeconds: number;
  detail: string;
  confidence: "route" | "corridor";
}

export interface TravelPlanNextTransitOption {
  departureTime: string;
  arrivalTime: string;
  lineLabel: string;
  boardingStopName: string;
  durationSeconds: number;
  transferCount: number;
  handoffUrl: string;
}
```

Then extend `TravelPlanPayload`:

```ts
export interface TravelPlanPayload {
  origin: TravelPlanPlace;
  destination: TravelPlanPlace;
  route: TravelPlanRoute;
  primaryMode: TravelPlanPrimaryMode;
  walkingRoute?: TravelPlanWalkingRoute;
  nextTransitOption?: TravelPlanNextTransitOption;
  trafficImpacts: TravelPlanTrafficImpact[];
  publicTransportSuggestions: TravelPlanTransitSuggestion[];
  itineraries: TravelPlanItinerary[];
  journeyPlanner: TravelPlanJourneyStatusPayload;
  sources: TrafficMapSourceStatus[];
  generatedAt: string;
}
```

- [ ] **Step 4: Implement server mode selection**

In `apps/server/src/traffic/travel-plan.ts`, add these helpers before `buildTravelPlanPayload`:

```ts
const WALKING_SPEED_METERS_PER_SECOND = 1.35;

export function estimateWalkingDurationSeconds(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  return Math.max(60, Math.round(distanceMeters / WALKING_SPEED_METERS_PER_SECOND / 60) * 60);
}

function walkingRouteFromTravelRoute(
  route: TravelPlanRoute,
  hasTransitItinerary: boolean,
): TravelPlanPayload["walkingRoute"] {
  if (hasTransitItinerary) return undefined;
  if (!Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0) return undefined;
  if (route.geometry.type !== "LineString" || route.geometry.coordinates.length < 2) {
    return undefined;
  }
  const confidence = route.source === "osrm" ? "route" : "corridor";
  return {
    source: route.source,
    geometry: route.geometry,
    distanceMeters: route.distanceMeters,
    durationSeconds: estimateWalkingDurationSeconds(route.distanceMeters),
    detail:
      confidence === "route"
        ? "Gangtid estimert fra rutelengde. Ruten vises som OSRM-korridor."
        : "Gangtid estimert fra luftlinjekorridor fordi rutetjenesten ikke ga detaljert gangrute.",
    confidence,
  };
}

function primaryModeForTravelPlan(
  itineraries: TravelPlanItinerary[],
  walkingRoute: TravelPlanPayload["walkingRoute"],
): TravelPlanPayload["primaryMode"] {
  if (itineraries.length > 0) return "transit";
  if (walkingRoute) return "walk";
  return "fallback";
}
```

Make sure the imports at the top include `TravelPlanItinerary` and `TravelPlanRoute` from `@nytt/shared` if they are not already imported:

```ts
import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  TrafficMapEvent,
  TravelPlanItinerary,
  TravelPlanPayload,
  TravelPlanPlace,
  TravelPlanRoute,
} from "@nytt/shared";
```

In `buildTravelPlanPayload`, compute and return the new fields:

```ts
  const itineraries = rankItineraries(
    enrichItineraries(
      input.itineraries ?? [],
      trafficImpactsForRoute,
      input.vehicles,
      contextAlerts,
    ),
  );
  const walkingRoute = walkingRouteFromTravelRoute(input.route, itineraries.length > 0);
  const primaryMode = primaryModeForTravelPlan(itineraries, walkingRoute);
  return {
    origin: input.origin,
    destination: input.destination,
    route: input.route,
    primaryMode,
    ...(walkingRoute ? { walkingRoute } : {}),
    trafficImpacts: trafficImpactsForRoute,
    publicTransportSuggestions: transitSuggestions(input.vehicles, contextAlerts, input.route),
    itineraries,
```

- [ ] **Step 5: Run focused server tests**

Run:

```bash
npm test -- travel-plan.test.ts -t "primary mode"
```

Expected: PASS for the new primary-mode tests.

- [ ] **Step 6: Run shared/server typecheck slice**

Run:

```bash
npm run typecheck -w @nytt/shared
npm run typecheck -w @nytt/server
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add packages/shared/src/traffic-map.ts apps/server/src/traffic/travel-plan.ts apps/server/test/travel-plan.test.ts
git commit -m "feat: add mode-aware travel-plan answers"
```

Expected: commit succeeds and does not include unrelated untracked files.

---

### Task 2: Render Walking And Transit Answers Without Dead-End Copy

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Test: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes:
  - `TravelPlanPayload.primaryMode`
  - `TravelPlanPayload.walkingRoute`
  - `TravelPlanPayload.itineraries`
  - existing `buildRouteContextSummary(plan?: TravelPlanPayload)`
- Produces:
  - updated `travelPlanDecision(plan?: TravelPlanPayload)`
  - `export function travelPlanModeSummary(plan: TravelPlanPayload): { label: string; detail: string; contextLabel: string; }`
  - mode-aware `TravelPlanCard` markup

- [ ] **Step 1: Write failing frontend decision tests**

In `apps/frontend/src/pages/TrafficMapPage.test.ts`, update the import from `TrafficMapPage.tsx` to include `travelPlanModeSummary`:

```ts
  travelPlanDecision,
  travelPlanModeSummary,
```

In the base `plan` fixture, add the new fields:

```ts
  primaryMode: "walk",
  walkingRoute: {
    source: "direct",
    geometry: {
      type: "LineString",
      coordinates: [
        [10.39, 63.39],
        [10.41, 63.4],
      ],
    },
    distanceMeters: 1200,
    durationSeconds: 900,
    detail: "Gangtid estimert fra luftlinjekorridor.",
    confidence: "corridor",
  },
```

In `planWithItinerary`, override the new fields:

```ts
  primaryMode: "transit",
  walkingRoute: undefined,
```

Append this test block near the existing `travelPlanDecision` tests:

```ts
describe("mode-aware travel answer", () => {
  it("turns no-transit plans into a walking answer", () => {
    expect(travelPlanDecision(plan)).toMatchObject({
      heading: "Gå til Mål",
      detail: "Ingen kollektivreise akkurat nå. Gangruta tar ca. 15 min og er 1,2 km.",
      itineraryCount: 0,
      severity: "watch",
    });

    expect(travelPlanModeSummary(plan)).toEqual({
      label: "Gange",
      detail: "15 min · 1,2 km · Mål",
      contextLabel: "Trafikk langs gangruta",
    });
  });

  it("keeps transit plans focused on the selected line and boarding stop", () => {
    expect(travelPlanDecision(planWithItinerary)).toMatchObject({
      heading: "Ta Buss 2 fra Søndre gate",
      detail: expect.stringContaining("18 min"),
      itineraryCount: 1,
      severity: "ok",
    });

    expect(travelPlanModeSummary(planWithItinerary)).toMatchObject({
      label: "Kollektiv",
      contextLabel: "Trafikk langs ruten",
    });
  });

  it("uses a clear handoff when no transit or walking answer is available", () => {
    const noAnswer: TravelPlanPayload = {
      ...plan,
      primaryMode: "fallback",
      walkingRoute: undefined,
      journeyPlanner: {
        ...plan.journeyPlanner,
        status: "unavailable",
        detail: "Entur reisesøk er ikke tilgjengelig akkurat nå.",
      },
    };

    expect(travelPlanDecision(noAnswer)).toMatchObject({
      heading: "Sjekk AtB/Entur",
      detail: expect.stringContaining("Entur reisesøk er ikke tilgjengelig"),
      severity: "warning",
    });
  });
});
```

- [ ] **Step 2: Run the focused frontend tests and confirm the helpers are missing**

Run:

```bash
npm test -- TrafficMapPage.test.ts -t "mode-aware travel answer"
```

Expected: FAIL because `travelPlanModeSummary` is not exported and `travelPlanDecision` still leads with the empty Entur state.

- [ ] **Step 3: Add frontend helper functions**

In `apps/frontend/src/pages/TrafficMapPage.tsx`, add these helpers near `travelPlanDecision`:

```ts
function shortPlaceLabel(label: string): string {
  return label.split(",")[0]?.trim() || label;
}

function firstTransitLeg(itinerary?: TravelPlanItinerary): TravelPlanLeg | undefined {
  return itinerary?.legs.find((leg) => leg.mode !== "walk" && !leg.cancelled);
}

function transitHeadingForItinerary(itinerary?: TravelPlanItinerary): string | undefined {
  const leg = firstTransitLeg(itinerary);
  if (!leg) return undefined;
  const mode = modeLabel(leg.mode);
  const line = leg.publicCode ?? leg.lineName;
  const stop = leg.from.stopName ?? leg.from.name;
  if (line && stop) return `Ta ${mode} ${line} fra ${shortPlaceLabel(stop)}`;
  if (line) return `Ta ${mode} ${line}`;
  if (stop) return `Ta ${mode} fra ${shortPlaceLabel(stop)}`;
  return `Ta ${mode}`;
}

export function travelPlanModeSummary(plan: TravelPlanPayload): {
  label: string;
  detail: string;
  contextLabel: string;
} {
  const selectedItinerary = selectedItineraryForPlan(plan);
  if (plan.primaryMode === "transit" && selectedItinerary) {
    const leg = firstTransitLeg(selectedItinerary);
    return {
      label: "Kollektiv",
      detail: [
        leg?.publicCode ? `${modeLabel(leg.mode)} ${leg.publicCode}` : undefined,
        formatDuration(selectedItinerary.durationSeconds),
        selectedItinerary.transferCount === 0
          ? "Direkte"
          : `${selectedItinerary.transferCount} bytte`,
      ]
        .filter(Boolean)
        .join(" · "),
      contextLabel: "Trafikk langs ruten",
    };
  }
  if (plan.primaryMode === "walk" && plan.walkingRoute) {
    return {
      label: "Gange",
      detail: [
        formatDuration(plan.walkingRoute.durationSeconds),
        formatDistance(plan.walkingRoute.distanceMeters),
        shortPlaceLabel(plan.destination.label),
      ]
        .filter(Boolean)
        .join(" · "),
      contextLabel: "Trafikk langs gangruta",
    };
  }
  return {
    label: "Sjekk operatør",
    detail: "Bruk AtB/Entur for endelig reisevalg.",
    contextLabel: "Lokal trafikkontekst",
  };
}
```

- [ ] **Step 4: Update `travelPlanDecision`**

In `travelPlanDecision`, after the count variables and before the existing unavailable/empty branches, add:

```ts
const selectedItinerary = selectedItineraryForPlan(plan);
if (plan.primaryMode === "transit" && selectedItinerary) {
  const heading = transitHeadingForItinerary(selectedItinerary) ?? "Ta valgt kollektivreise";
  const duration = formatDuration(selectedItinerary.durationSeconds);
  const departure = formatTravelTime(selectedItinerary.departureTime);
  const arrival = formatTravelTime(selectedItinerary.arrivalTime);
  return {
    heading,
    detail: [
      departure && arrival ? `${departure}–${arrival}` : undefined,
      duration,
      selectedItinerary.transferCount === 0
        ? "direkte"
        : `${selectedItinerary.transferCount} bytte${selectedItinerary.transferCount === 1 ? "" : "r"}`,
      `${formatDuration(selectedItinerary.walkTimeSeconds)} gange`,
    ]
      .filter(Boolean)
      .join(" · "),
    roadImpactCount,
    vehicleCount,
    alertCount,
    itineraryCount,
    severity:
      selectedItinerary.decision === "avoid"
        ? "warning"
        : selectedItinerary.decision === "watch" || alertCount > 0 || hasHighRoadImpact
          ? "watch"
          : "ok",
  };
}

if (plan.primaryMode === "walk" && plan.walkingRoute) {
  const duration = formatDuration(plan.walkingRoute.durationSeconds) ?? "ukjent tid";
  const distance = formatDistance(plan.walkingRoute.distanceMeters);
  return {
    heading: `Gå til ${shortPlaceLabel(plan.destination.label)}`,
    detail:
      plan.journeyPlanner.status === "unavailable"
        ? `Kollektivsøket feilet akkurat nå. Gangruta tar ca. ${duration} og er ${distance}.`
        : `Ingen kollektivreise akkurat nå. Gangruta tar ca. ${duration} og er ${distance}.`,
    roadImpactCount,
    vehicleCount,
    alertCount,
    itineraryCount,
    severity:
      plan.journeyPlanner.status === "unavailable" || hasHighRoadImpact ? "warning" : "watch",
  };
}

if (plan.primaryMode === "fallback") {
  return {
    heading: "Sjekk AtB/Entur",
    detail: `${plan.journeyPlanner.detail} Nytt klarte ikke å lage en trygg gangrute for valgt søk.`,
    roadImpactCount,
    vehicleCount,
    alertCount,
    itineraryCount,
    severity: "warning",
  };
}
```

If `formatTravelTime` does not exist, add this helper next to `formatTravelDateTime` or the other local time helpers:

```ts
function formatTravelTime(value: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(value));
}
```

- [ ] **Step 5: Update `TravelPlanCard` markup**

Inside `TravelPlanCard`, replace the route-summary block and journey-section conditional with mode-aware copy:

```tsx
const duration = formatDuration(plan.route.durationSeconds);
const decision = travelPlanDecision(plan);
const modeSummary = travelPlanModeSummary(plan);
const selectedItinerary = selectedItineraryForPlan(plan, selectedItineraryId);
const showFallbackSuggestions =
  plan.primaryMode !== "transit" && plan.publicTransportSuggestions.length > 0;
```

Replace the `<small>` inside `.travel-plan-route-summary` with:

```tsx
<small>
  {modeSummary.label} · {modeSummary.detail}
  {routeContextSummary.count > 0 ? ` · ${routeContextSummary.heading}` : ""}
</small>
```

Replace the empty journey status paragraph with:

```tsx
{
  plan.journeyPlanner.status === "unavailable" ? (
    <p className="route-planner-status warning">{plan.journeyPlanner.detail}</p>
  ) : null;
}
{
  plan.primaryMode === "walk" && plan.walkingRoute ? (
    <section className="walking-answer-card" aria-label="Anbefalt gangrute">
      <strong>Gangrute</strong>
      <span>
        {formatDuration(plan.walkingRoute.durationSeconds)} ·{" "}
        {formatDistance(plan.walkingRoute.distanceMeters)}
      </span>
      <small>{plan.walkingRoute.detail}</small>
    </section>
  ) : null;
}
{
  plan.primaryMode === "fallback" && plan.journeyPlanner.status === "empty" ? (
    <p className="route-planner-status warning">
      Ingen konkrete Entur-reiser funnet, og Nytt klarte ikke å lage en trygg gangrute.
    </p>
  ) : null;
}
```

Keep the existing itinerary workspace, but guard it with transit:

```tsx
{
  plan.primaryMode === "transit" && plan.itineraries.length ? (
    <div className="travel-plan-result-workspace">
      <RouteChoicePanel model={routeChoiceModel} onSelectItinerary={onSelectItinerary} />
      <div className="travel-plan-selected-workspace">
        <SelectedItineraryPanel itinerary={selectedItinerary} />
        <SelectedRouteWatchPanel summary={routeWatchSummary} />
      </div>
    </div>
  ) : null;
}
```

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
npm test -- TrafficMapPage.test.ts -t "mode-aware travel answer"
```

Expected: PASS.

- [ ] **Step 7: Run existing travel-plan helper tests**

Run:

```bash
npm test -- TrafficMapPage.test.ts -t "travelPlanDecision|walk-only itinerary|RouteContextFallback"
```

Expected: PASS. Existing walk-only Entur itinerary behavior should remain calm.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts
git commit -m "feat: render walking answers on traffic searches"
```

Expected: commit succeeds with only Task 2 files.

---

### Task 3: Move The Existing Map Into The Immediate Post-Search Result

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Test: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes:
  - existing `TrafficMapFocus`
  - existing `TravelPlanLayer`
  - existing `TrafficLayer`
  - existing `RouteContextFallback`
- Produces:
  - `export function shouldOpenPostSearchMap(plan?: TravelPlanPayload): boolean`
  - post-search map disclosure open and placed before secondary panels
  - walking copy that says `langs gangruta`

- [ ] **Step 1: Write failing layout helper tests**

In `apps/frontend/src/pages/TrafficMapPage.test.ts`, add `shouldOpenPostSearchMap` to the import from `TrafficMapPage.tsx`:

```ts
  shouldOpenPostSearchMap,
```

Append this test block near route-context summary tests:

```ts
describe("post-search map placement", () => {
  it("opens the map immediately for walking answers", () => {
    expect(shouldOpenPostSearchMap(plan)).toBe(true);
  });

  it("opens the map for transit answers with route context", () => {
    expect(
      shouldOpenPostSearchMap({
        ...planWithItinerary,
        trafficImpacts: [
          {
            event: {
              id: "traffic-point-1",
              source: "vegvesen_traffic_info",
              sourceEventId: "traffic-point-1",
              category: "roadworks",
              severity: "medium",
              state: "active",
              title: "Vegarbeid langs ruten",
              updatedAt: "2026-06-01T09:00:00.000Z",
              geometry: { type: "Point", coordinates: [10.4, 63.4] },
            },
            distanceMeters: 80,
            severity: "medium",
            summary: "80 m fra foreslått rute",
          },
        ],
      }),
    ).toBe(true);
  });

  it("keeps the map closed before a search", () => {
    expect(shouldOpenPostSearchMap()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm helper is missing**

Run:

```bash
npm test -- TrafficMapPage.test.ts -t "post-search map placement"
```

Expected: FAIL because `shouldOpenPostSearchMap` is not exported.

- [ ] **Step 3: Add the map-open helper**

In `apps/frontend/src/pages/TrafficMapPage.tsx`, add this helper near `buildRouteContextSummary`:

```ts
export function shouldOpenPostSearchMap(plan?: TravelPlanPayload): boolean {
  if (!plan) return false;
  if (plan.primaryMode === "walk" && plan.walkingRoute) return true;
  if (plan.primaryMode === "transit" && plan.itineraries.length > 0) return true;
  return plan.trafficImpacts.length > 0;
}
```

- [ ] **Step 4: Move the map disclosure before secondary panels**

In `TrafficMapPage`, move the entire existing `<details className="traffic-support-disclosure traffic-map-disclosure" ...>` block so it appears immediately after `<TravelPlannerPanel ... />` and before `routeDepartureCheckpointsForSelection.length > 1`.

Change the `open` prop:

```tsx
        open={!travelPlan || shouldOpenPostSearchMap(travelPlan)}
```

Change the summary text:

```tsx
<summary>{travelPlan ? "Kart for valgt reise" : "Kart og trafikkgrunnlag"}</summary>
```

The map body stays the existing `traffic-workspace` with `MapContainer`, `TrafficMapFocus`, `TrafficLayer`, `PublicTransportLayer`, and `TravelPlanLayer`.

- [ ] **Step 5: Make route context label mode-aware**

In `TravelPlanCard`, before rendering `RouteContextFallback`, compute:

```ts
const modeSummary = travelPlanModeSummary(plan);
const contextIntro =
  routeContextSummary.count > 0
    ? `${routeContextSummary.heading} · ${modeSummary.contextLabel}`
    : modeSummary.contextLabel;
```

Render a compact paragraph above `RouteContextFallback` only when there is context:

```tsx
{
  routeContextSummary.count > 0 ? <p className="travel-plan-context-note">{contextIntro}</p> : null;
}
```

- [ ] **Step 6: Add CSS for post-search map and walking answer**

In `apps/frontend/src/styles.css`, add this near the existing travel-plan styles:

```css
.walking-answer-card {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--green) 35%, var(--line));
  border-left: 4px solid var(--green);
  background: #f8fbf6;
}

.walking-answer-card strong {
  color: var(--green);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.walking-answer-card span {
  color: var(--ink);
  font-weight: 700;
}

.walking-answer-card small,
.travel-plan-context-note {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.35;
}

.travel-plan-context-note {
  margin: 12px 0 0;
}

.traffic-map-disclosure[open] {
  order: 2;
}

.traffic-map-disclosure[open] .traffic-workspace {
  min-height: 520px;
}
```

In the existing mobile block that orders `.traffic-support-disclosure`, update map ordering:

```css
.traffic-map-disclosure {
  order: 2;
}

.traffic-map-disclosure[open] .traffic-workspace {
  min-height: 460px;
}

.route-departure-confidence {
  order: 3;
}

.departure-board-panel {
  order: 4;
}
```

Keep `.traffic-data-disclosure` and `.traffic-bottom-panel` after the map and departure sections.

- [ ] **Step 7: Run focused layout tests**

Run:

```bash
npm test -- TrafficMapPage.test.ts -t "post-search map placement"
```

Expected: PASS.

- [ ] **Step 8: Run frontend typecheck**

Run:

```bash
npm run typecheck -w @nytt/frontend
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts apps/frontend/src/styles.css
git commit -m "feat: show traffic map with selected travel answer"
```

Expected: commit succeeds with only Task 3 files.

---

### Task 4: Update E2E Coverage And Run Release Gates

**Files:**

- Modify: `e2e/app.spec.ts`

**Interfaces:**

- Consumes:
  - `/api/map/travel-plan` mocked payloads with `primaryMode`
  - `/trafikk` UI route-search flow
- Produces:
  - E2E coverage for walking fallback
  - E2E coverage for transit top answer
  - full local verification result

- [ ] **Step 1: Update existing mocked travel-plan payloads**

In `e2e/app.spec.ts`, every mocked `/api/map/travel-plan` payload must include:

```ts
primaryMode: "transit",
```

when `itineraries` is non-empty, and:

```ts
primaryMode: "walk",
walkingRoute: {
  source: "direct",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.393742, 63.432883],
      [10.463, 63.433],
    ],
  },
  distanceMeters: 3500,
  durationSeconds: 2580,
  detail: "Gangtid estimert fra luftlinjekorridor.",
  confidence: "corridor",
},
```

when the mocked payload has no itineraries and a usable route.

- [ ] **Step 2: Add walking fallback e2e route**

Append this test near the existing `/trafikk` route-search tests:

```ts
test("trafikk shows walking route and map when Entur has no current trip", async ({ page }) => {
  await page.route("**/api/map/travel-plan**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
          source: "direct",
          distanceMeters: 3500,
          detail: "Direkte korridor mellom punktene.",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.393742, 63.432883],
              [10.463, 63.433],
            ],
          },
        },
        primaryMode: "walk",
        walkingRoute: {
          source: "direct",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.393742, 63.432883],
              [10.463, 63.433],
            ],
          },
          distanceMeters: 3500,
          durationSeconds: 2580,
          detail: "Gangtid estimert fra luftlinjekorridor.",
          confidence: "corridor",
        },
        trafficImpacts: [],
        publicTransportSuggestions: [],
        itineraries: [],
        journeyPlanner: {
          status: "empty",
          detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
          requestedDepartureTime: "2026-06-01T23:30:00.000Z",
          source: "Entur Journey Planner",
        },
        sources: [],
        generatedAt: "2026-06-01T23:30:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Lade gård");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.getByRole("heading", { name: "Gå til Lade gård" })).toBeVisible();
  await expect(page.getByLabel("Anbefalt gangrute")).toContainText("43 min");
  await expect(page.getByText("Ingen konkrete Entur-reiser funnet for valgt tid.")).toHaveCount(0);
  await expect(page.locator(".traffic-map-disclosure")).toContainText("Kart for valgt reise");
  await expect(page.locator(".traffic-map")).toBeVisible();
});
```

- [ ] **Step 3: Update transit e2e assertion**

In the existing e2e test that currently checks post-search transit layout around `.travel-plan-card`, replace the generic result assertion with:

```ts
await expect(page.getByRole("heading", { name: /Ta Buss 2 fra/ })).toBeVisible();
await expect(page.locator(".traffic-map-disclosure")).toContainText("Kart for valgt reise");
await expect(page.locator(".traffic-map")).toBeVisible();
await expect(page.getByLabel("Valgt reiseforslag")).toContainText("Buss 2");
```

- [ ] **Step 4: Run focused e2e tests**

Run:

```bash
npm run test:e2e -- --grep "trafikk"
```

Expected: PASS for `/trafikk` specs. If unrelated e2e tests outside `/trafikk` fail, keep their failure logs separate and do not mask `/trafikk` regressions.

- [ ] **Step 5: Run standard local gates**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all commands PASS. If `npm audit --omit=dev --audit-level=high` reports known advisory noise unrelated to this slice, capture the exact advisory and keep the code changes ready without claiming a clean audit.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add e2e/app.spec.ts
git commit -m "test: cover mode-aware traffic travel answers"
```

Expected: commit succeeds with only e2e test updates if the first three tasks were already committed.

---

## Self-Review

**Spec coverage**

- Transit available: Task 1 sets `primaryMode: "transit"`; Task 2 renders the transit line/stop/time answer before context.
- No transit and route available: Task 1 builds `walkingRoute`; Task 2 renders `Gå til ...`; Task 3 makes the map visible near that answer.
- Transit/route planner failure: Task 1 returns `primaryMode: "fallback"` when no usable route exists; Task 2 renders the AtB/Entur handoff.
- Road/context points: Task 3 keeps route context secondary and mode-aware with `langs gangruta`.
- No new provenance or situations: the plan changes only shared payload, server transform, frontend rendering, and tests.
- Mobile and desktop hierarchy: Task 3 reorders the existing map disclosure and CSS; Task 4 verifies the visible behavior.

**Placeholder scan**

- The plan contains exact paths, commands, expected outcomes, and code snippets for each code change.
- The plan contains exact, actionable steps rather than placeholder marker words or instruction-only test steps without code.

**Type consistency**

- `TravelPlanPrimaryMode`, `TravelPlanWalkingRoute`, and `TravelPlanNextTransitOption` are defined in `packages/shared/src/traffic-map.ts` before they are consumed.
- `travelPlanModeSummary` and `shouldOpenPostSearchMap` are exported before frontend tests import them.
- Server helpers use existing shared names: `TravelPlanRoute`, `TravelPlanItinerary`, and `TravelPlanPayload`.

---

## Execution Notes

- The implementation should start from the committed spec `docs/superpowers/specs/2026-07-09-trafikk-mode-aware-travel-answer-design.md`.
- The current branch is `main` and is ahead of `origin/main` by the spec commit. Keep task commits narrow and do not sweep unrelated untracked files into Git.
- If a task discovers that the public OSRM route is too car-shaped for a specific walking case, keep the UI copy honest by using `Gangtid estimert fra ... korridor` and do not claim sidewalk-level routing.
