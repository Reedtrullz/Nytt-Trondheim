# /trafikk Journey Answer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/trafikk` from a diagnostics-heavy traffic report into a traveller-first journey answer: clear route instruction, selected bus/walk timeline, route map, and only the warnings that affect the trip.

**Architecture:** Keep the existing server payloads and map data model. Refactor the frontend around one post-search journey workspace that reuses current `TravelPlanPayload`, `TrafficMapEvent`, departure-board, and Leaflet layers, while demoting broad traffic/source diagnostics into secondary disclosures.

**Tech Stack:** React 19, TypeScript, Vite, Leaflet/react-leaflet, existing `/api/map/travel-plan` and `/api/map/travel-plan/compare`, Vitest render/static-markup tests, Playwright E2E, Bokmål UI copy.

## Global Constraints

- Use Node 22 for verification: `source ~/.nvm/nvm.sh && nvm use 22`.
- All user-facing copy is Bokmål.
- `/trafikk` remains public/viewer-safe.
- Do not add new database tables, upstream providers, `source_items`, source contracts, situation evidence, or worker ingestion paths.
- Entur, DATEX, Vegvesen, public-transport vehicles, and service alerts remain traveller context, not editorial provenance or situation-room evidence.
- Keep AtB/Entur as the final authority for tickets, exact platforms, operator changes, and final route confirmation.
- Do not stage unrelated local artifacts: `.superpowers/`, `AGENTS.md`, `apps/*/AGENTS.md`, `HJZyzpGaEAEz4P3.jpeg`, `nytt-trondheim-consolidated-research.md`, or unrelated plan files.
- Keep the previous fetch hygiene: new polling/hooks must use request-id invalidation plus abort cleanup, matching `useTrafficMap` rather than relying on `AbortController` alone.
- Keep page performance visible: avoid additional request fan-out during a route search, and do not introduce new default-open panels below the main answer.

---

## File Structure

- Create `apps/frontend/src/pages/trafficJourneyView.ts`
  - Pure traveller-facing view model for route answer, route options, compact context, section labels, and map placement decisions.
  - No React, no DOM, no network.
- Create `apps/frontend/src/pages/trafficJourneyView.test.ts`
  - Unit tests for transit, walking, fallback, context prioritization, route-option labels, and map-first section state.
- Modify `apps/frontend/src/pages/TrafficMapPage.tsx`
  - Replace the current post-search stack with a single journey workspace.
  - Keep the current pre-search planner behavior.
  - Reuse existing map layers and focus logic.
  - Move map-layer toggles into the map workspace.
- Modify `apps/frontend/src/pages/TrafficMapPage.test.ts`
  - Render-level tests for the new journey answer markup.
  - Guard against duplicate diagnostic panel rendering.
- Modify `apps/frontend/src/styles.css`
  - Add map-first journey workspace layout.
  - Remove or neutralize large route-choice/route-watch text-card dominance.
  - Ensure mobile ordering and no horizontal overflow.
- Modify `e2e/app.spec.ts`
  - Update `/trafikk` route-search expectations around answer-first UI, visible map, walking fallback, and compact diagnostics.

No server or worker files should change unless a failing test proves the current payload cannot represent the intended UI.

---

## Target User Experience

### Pre-Search

The page remains a compact planner:

1. Route form: from, to, time, reverse, current position.
2. Quick destination presets.
3. Optional saved local routes.
4. A small “Trafikkbildet nå” strip below, not above, the route planner.

### Post-Search With Transit

The first screen should say something like:

```text
Ta Buss 2 fra Søndre gate
14:28 → 14:46 · 18 min · Direkte · 8 min gange
```

Immediately below, show:

1. compact route-option chips or cards;
2. selected itinerary timeline;
3. map beside or below the selected itinerary;
4. top route warnings as chips/callouts;
5. one AtB/Entur handoff.

### Post-Search With No Transit But Walkable Route

The first screen should say something like:

```text
Gå til Lade
3,5 km · ca. 42 min
```

Then show the walking route on the map and route-relevant warnings. Do not lead with “8 vegmeldinger” or “0 reiseforslag”.

### Post-Search With Neither Transit Nor Walking Route

The first screen should say:

```text
Sjekk AtB/Entur
Nytt klarte ikke å finne en trygg reise akkurat nå.
```

Then show a compact external handoff and any available road/traffic context below.

---

## Task 1: Add A Pure Journey View Model

**Files:**

- Create: `apps/frontend/src/pages/trafficJourneyView.ts`
- Create: `apps/frontend/src/pages/trafficJourneyView.test.ts`

**Interfaces:**

- Consumes:
  - `TravelPlanPayload`
  - `TravelPlanItinerary`
  - `TravelPlanLeg`
  - `PublicTransportDepartureBoardPayload`
- Produces:
  - `JourneyAnswerView`
  - `JourneyRouteOptionView`
  - `JourneyContextView`
  - `buildJourneyAnswerView(plan?: TravelPlanPayload, selectedItineraryId?: string): JourneyAnswerView`
  - `buildJourneyContextView(plan?: TravelPlanPayload): JourneyContextView`
  - `shouldShowJourneyMap(plan?: TravelPlanPayload): boolean`

- [ ] **Step 1: Write failing tests for the three primary answer modes**

Create `apps/frontend/src/pages/trafficJourneyView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TravelPlanPayload } from "@nytt/shared";
import {
  buildJourneyAnswerView,
  buildJourneyContextView,
  shouldShowJourneyMap,
} from "./trafficJourneyView.js";

const basePlan = (overrides: Partial<TravelPlanPayload> = {}): TravelPlanPayload =>
  ({
    origin: {
      query: "Munkegata",
      label: "Munkegata, Trondheim",
      coordinate: [10.393742, 63.432883],
    },
    destination: {
      query: "Lade",
      label: "Lade gård, Trondheim",
      coordinate: [10.463, 63.433],
    },
    route: {
      source: "osrm",
      detail: "Rute beregnet med OSRM.",
      distanceMeters: 3500,
      durationSeconds: 360,
      geometry: {
        type: "LineString",
        coordinates: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
    },
    trafficImpacts: [],
    publicTransportSuggestions: [],
    itineraries: [],
    primaryMode: "fallback",
    journeyPlanner: {
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet.",
      requestedDepartureTime: "2026-07-09T10:00:00.000Z",
      source: "Entur Journey Planner",
    },
    sources: [],
    generatedAt: "2026-07-09T10:00:00.000Z",
    ...overrides,
  }) as TravelPlanPayload;

describe("traffic journey view model", () => {
  it("answers with the concrete first transit leg when transit is primary", () => {
    const plan = basePlan({
      primaryMode: "transit",
      itineraries: [
        {
          id: "itinerary-1",
          decision: "best",
          decisionReason: "Direkte reiseforslag uten kjente avvik.",
          labels: ["best_now", "fewest_transfers", "most_robust"],
          departureTime: "2026-07-09T10:28:00.000Z",
          arrivalTime: "2026-07-09T10:46:00.000Z",
          durationSeconds: 1080,
          transferCount: 0,
          walkTimeSeconds: 480,
          realtime: true,
          modes: ["bus"],
          disruptionCount: 0,
          handoffUrl: "https://www.atb.no/reiseplanlegger/",
          legs: [
            {
              id: "walk-to-stop",
              mode: "walk",
              from: { name: "Munkegata", coordinate: [10.393742, 63.432883] },
              to: {
                name: "Søndre gate",
                stopName: "Søndre gate",
                coordinate: [10.396, 63.431],
              },
              aimedStartTime: "2026-07-09T10:20:00.000Z",
              expectedStartTime: "2026-07-09T10:20:00.000Z",
              aimedEndTime: "2026-07-09T10:28:00.000Z",
              expectedEndTime: "2026-07-09T10:28:00.000Z",
              durationSeconds: 480,
              distanceMeters: 600,
              realtime: false,
              cancelled: false,
              replacementTransport: false,
              notices: [],
            },
            {
              id: "bus-2",
              mode: "bus",
              from: {
                name: "Søndre gate",
                stopName: "Søndre gate",
                coordinate: [10.396, 63.431],
              },
              to: {
                name: "Lade gård",
                stopName: "Lade gård",
                coordinate: [10.463, 63.433],
              },
              aimedStartTime: "2026-07-09T10:28:00.000Z",
              expectedStartTime: "2026-07-09T10:28:00.000Z",
              aimedEndTime: "2026-07-09T10:46:00.000Z",
              expectedEndTime: "2026-07-09T10:46:00.000Z",
              durationSeconds: 1080,
              distanceMeters: 4200,
              realtime: true,
              cancelled: false,
              replacementTransport: false,
              publicCode: "2",
              lineName: "Strindheim - Lade",
              serviceJourneyId: "ATB:ServiceJourney:2",
              notices: [],
            },
          ],
        },
      ],
    });

    const view = buildJourneyAnswerView(plan, "itinerary-1");

    expect(view).toMatchObject({
      mode: "transit",
      eyebrow: "Reiseråd nå",
      headline: "Ta Buss 2 fra Søndre gate",
      subline: "10:28 → 10:46 · 18 min · Direkte · 8 min gange",
      primaryActionLabel: "Åpne hos AtB/Entur",
      selectedItineraryId: "itinerary-1",
    });
    expect(view.routeOptions[0]).toMatchObject({
      id: "itinerary-1",
      label: "Anbefalt",
      lineSummary: "Buss 2",
      selected: true,
    });
    expect(shouldShowJourneyMap(plan)).toBe(true);
  });

  it("answers with a walking route when no usable transit exists", () => {
    const plan = basePlan({
      primaryMode: "walk",
      walkingRoute: {
        source: "osrm",
        detail: "Gangrute beregnet med OSRM.",
        distanceMeters: 3500,
        durationSeconds: 2520,
        geometry: {
          type: "LineString",
          coordinates: [
            [10.393742, 63.432883],
            [10.463, 63.433],
          ],
        },
      },
    });

    const view = buildJourneyAnswerView(plan);

    expect(view).toMatchObject({
      mode: "walk",
      headline: "Gå til Lade gård",
      subline: "3,5 km · ca. 42 min",
      selectedItineraryId: undefined,
    });
    expect(view.routeOptions).toEqual([]);
    expect(shouldShowJourneyMap(plan)).toBe(true);
  });

  it("answers with operator handoff when neither transit nor walking can be trusted", () => {
    const plan = basePlan({
      primaryMode: "fallback",
      journeyPlanner: {
        status: "unavailable",
        detail: "Entur svarte ikke innen tidsfristen.",
        requestedDepartureTime: "2026-07-09T10:00:00.000Z",
        source: "Entur Journey Planner",
      },
    });

    const view = buildJourneyAnswerView(plan);

    expect(view).toMatchObject({
      mode: "fallback",
      headline: "Sjekk AtB/Entur",
      subline: "Entur svarte ikke innen tidsfristen.",
      primaryActionLabel: "Åpne AtB/Entur",
    });
    expect(shouldShowJourneyMap(plan)).toBe(false);
  });

  it("prioritizes compact context over full diagnostic lists", () => {
    const plan = basePlan({
      trafficImpacts: [
        {
          event: {
            id: "traffic-1",
            source: "vegvesen_traffic_info",
            sourceEventId: "traffic-1",
            category: "roadworks",
            severity: "medium",
            state: "active",
            title: "Vegarbeid ved Bakklandet",
            updatedAt: "2026-07-09T09:58:00.000Z",
            geometry: { type: "Point", coordinates: [10.401, 63.428] },
          },
          distanceMeters: 220,
          severity: "medium",
          summary: "220 m fra foreslått rute",
        },
      ],
      publicTransportSuggestions: [
        {
          id: "alert-1",
          kind: "alert",
          title: "Endret rute",
          detail: "Linje 3 kjører via Lerkendal.",
          source: "Entur",
        },
      ],
    });

    const context = buildJourneyContextView(plan);

    expect(context).toMatchObject({
      count: 2,
      mapPointCount: 1,
      headline: "2 ting å sjekke langs reisen",
    });
    expect(context.primaryItems).toHaveLength(2);
    expect(context.primaryItems[0]).toMatchObject({
      title: "Vegarbeid ved Bakklandet",
      placement: "Nær ruten · 220 m",
      focusable: true,
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Expected: the test runner fails because `apps/frontend/src/pages/trafficJourneyView.ts` does not exist.

- [ ] **Step 3: Implement the pure view model**

Create `apps/frontend/src/pages/trafficJourneyView.ts`:

```ts
import type {
  TrafficCorridorImpact,
  TrafficMapEvent,
  TravelPlanItinerary,
  TravelPlanLeg,
  TravelPlanPayload,
} from "@nytt/shared";

type JourneyMode = "transit" | "walk" | "fallback";
type JourneySeverity = "ok" | "watch" | "warning";

export type JourneyRouteOptionView = {
  id: string;
  label: string;
  lineSummary: string;
  timeSummary: string;
  meta: string;
  selected: boolean;
  severity: JourneySeverity;
};

export type JourneyContextItemView = {
  id: string;
  title: string;
  detail: string;
  source: string;
  severity: JourneySeverity;
  placement: string;
  focusable: boolean;
  eventId?: string;
  href?: string;
};

export type JourneyContextView = {
  count: number;
  mapPointCount: number;
  headline: string;
  detail: string;
  primaryItems: JourneyContextItemView[];
  overflowItems: JourneyContextItemView[];
};

export type JourneyAnswerView = {
  mode: JourneyMode;
  eyebrow: string;
  headline: string;
  subline: string;
  statusLabel: string;
  severity: JourneySeverity;
  selectedItineraryId?: string;
  primaryActionHref?: string;
  primaryActionLabel?: string;
  routeOptions: JourneyRouteOptionView[];
  context: JourneyContextView;
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(value));
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds < 60) return "under 1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} t ${rest} min` : `${hours} t`;
}

function formatApproxDuration(seconds?: number): string {
  return `ca. ${formatDuration(seconds)}`;
}

function formatDistance(meters?: number): string {
  if (meters === undefined) return "ukjent avstand";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toLocaleString("nb-NO", {
    maximumFractionDigits: 1,
    minimumFractionDigits: meters < 10_000 ? 1 : 0,
  })} km`;
}

function shortPlaceLabel(label: string): string {
  return label.split(",")[0]?.trim() || label;
}

function modeLabel(mode: string): string {
  if (mode === "bus") return "Buss";
  if (mode === "tram") return "Trikk";
  if (mode === "rail") return "Tog";
  if (mode === "water") return "Båt";
  if (mode === "walk") return "Gange";
  return mode;
}

function firstUsableTransitLeg(itinerary?: TravelPlanItinerary): TravelPlanLeg | undefined {
  return itinerary?.legs.find((leg) => leg.mode !== "walk" && !leg.cancelled);
}

function itineraryLineSummary(itinerary: TravelPlanItinerary): string {
  const transitLegs = itinerary.legs.filter((leg) => leg.mode !== "walk" && !leg.cancelled);
  if (!transitLegs.length) return "Gange";
  return transitLegs
    .map((leg) => {
      const line = leg.publicCode ?? leg.lineName;
      return line ? `${modeLabel(leg.mode)} ${line}` : modeLabel(leg.mode);
    })
    .filter(Boolean)
    .join(" + ");
}

function itinerarySeverity(itinerary: TravelPlanItinerary): JourneySeverity {
  if (itinerary.decision === "avoid") return "warning";
  if (itinerary.decision === "watch" || itinerary.disruptionCount > 0) return "watch";
  return "ok";
}

function selectedItinerary(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): TravelPlanItinerary | undefined {
  if (plan?.primaryMode !== "transit") return undefined;
  const usable = plan.itineraries.filter((itinerary) => firstUsableTransitLeg(itinerary));
  return usable.find((itinerary) => itinerary.id === selectedItineraryId) ?? usable[0];
}

function routeOptionLabel(itinerary: TravelPlanItinerary, index: number): string {
  if (itinerary.labels.includes("best_now")) return "Anbefalt";
  if (itinerary.labels.includes("fewest_transfers")) return "Færrest bytter";
  if (itinerary.labels.includes("most_robust")) return "Mest robust";
  if (itinerary.labels.includes("soonest_departure")) return "Snarest";
  return `Valg ${index + 1}`;
}

function buildRouteOptions(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): JourneyRouteOptionView[] {
  if (plan?.primaryMode !== "transit") return [];
  const selected = selectedItinerary(plan, selectedItineraryId);
  return plan.itineraries
    .filter((itinerary) => firstUsableTransitLeg(itinerary))
    .slice(0, 4)
    .map((itinerary, index) => ({
      id: itinerary.id,
      label: routeOptionLabel(itinerary, index),
      lineSummary: itineraryLineSummary(itinerary),
      timeSummary: `${formatTime(itinerary.departureTime)} → ${formatTime(itinerary.arrivalTime)}`,
      meta: [
        formatDuration(itinerary.durationSeconds),
        itinerary.transferCount === 0 ? "Direkte" : `${itinerary.transferCount} bytte`,
        `${formatDuration(itinerary.walkTimeSeconds)} gange`,
      ].join(" · "),
      selected: itinerary.id === selected?.id,
      severity: itinerarySeverity(itinerary),
    }));
}

function sourceLabel(source: string): string {
  const normalized = source.toLocaleLowerCase("nb");
  if (normalized.includes("vegvesen") || normalized.includes("datex")) return "Vegvesen";
  if (normalized.includes("entur")) return "Entur";
  return source;
}

function trafficSeverity(severity?: string): JourneySeverity {
  if (severity === "critical" || severity === "high") return "warning";
  if (severity === "medium") return "watch";
  return "ok";
}

function placementForDistance(distanceMeters?: number, isWalk = false): string {
  const target = isWalk ? "gangruta" : "ruten";
  if (distanceMeters === undefined) return `Linjevarsel`;
  if (distanceMeters === 0) return `På ${target}`;
  return `Nær ${target} · ${formatDistance(distanceMeters)}`;
}

export function buildJourneyContextView(plan?: TravelPlanPayload): JourneyContextView {
  const isWalk = plan?.primaryMode === "walk";
  const trafficItems: JourneyContextItemView[] = (plan?.trafficImpacts ?? []).map((impact) => ({
    id: `traffic:${impact.event.id}`,
    title: impact.event.title,
    detail: impact.summary || impact.event.description || impact.event.roadName || "",
    source: sourceLabel(impact.event.source),
    severity: trafficSeverity(impact.severity),
    placement: placementForDistance(impact.distanceMeters, isWalk),
    focusable: true,
    eventId: impact.event.id,
  }));

  const alertItems: JourneyContextItemView[] = (plan?.publicTransportSuggestions ?? [])
    .filter((suggestion) => suggestion.kind === "alert")
    .map((suggestion) => ({
      id: `alert:${suggestion.id}`,
      title: suggestion.title,
      detail: suggestion.detail,
      source: sourceLabel(suggestion.source),
      severity: "watch",
      placement: placementForDistance(suggestion.distanceMeters, isWalk),
      focusable: false,
      href: suggestion.href,
    }));

  const allItems = [...trafficItems, ...alertItems].sort((left, right) => {
    const severityOrder: Record<JourneySeverity, number> = { warning: 0, watch: 1, ok: 2 };
    return severityOrder[left.severity] - severityOrder[right.severity];
  });
  const mapPointCount = allItems.filter((item) => item.focusable).length;
  const target = isWalk ? "reisen" : "reisen";
  return {
    count: allItems.length,
    mapPointCount,
    headline: allItems.length
      ? `${allItems.length} ting å sjekke langs ${target}`
      : "Ingen kjente hindringer langs reisen",
    detail: allItems.length
      ? mapPointCount
        ? "Kartet viser punktene som har plassering. Linjevarsler uten punkt ligger i listen."
        : "Varslene mangler kartpunkt og vises som kompakt tekst."
      : "Nytt fant ingen kjente trafikk- eller kollektivavvik for valgt reise.",
    primaryItems: allItems.slice(0, 3),
    overflowItems: allItems.slice(3),
  };
}

export function shouldShowJourneyMap(plan?: TravelPlanPayload): boolean {
  if (!plan) return false;
  if (plan.primaryMode === "transit" && selectedItinerary(plan)) return true;
  if (plan.primaryMode === "walk" && plan.walkingRoute) return true;
  return plan.trafficImpacts.length > 0;
}

function safeExternalUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function buildJourneyAnswerView(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): JourneyAnswerView {
  const context = buildJourneyContextView(plan);
  if (!plan) {
    return {
      mode: "fallback",
      eyebrow: "Reise og trafikk",
      headline: "Planlegg reisen",
      subline: "Skriv start og mål for å se beste reisemåte akkurat nå.",
      statusLabel: "Klar",
      severity: "ok",
      routeOptions: [],
      context,
    };
  }

  const selected = selectedItinerary(plan, selectedItineraryId);
  if (plan.primaryMode === "transit" && selected) {
    const leg = firstUsableTransitLeg(selected);
    const mode = leg ? modeLabel(leg.mode) : "Kollektiv";
    const line = leg?.publicCode ?? leg?.lineName;
    const stop = leg?.from.stopName ?? leg?.from.name;
    return {
      mode: "transit",
      eyebrow: "Reiseråd nå",
      headline: line && stop ? `Ta ${mode} ${line} fra ${shortPlaceLabel(stop)}` : `Ta ${mode}`,
      subline: [
        `${formatTime(selected.departureTime)} → ${formatTime(selected.arrivalTime)}`,
        formatDuration(selected.durationSeconds),
        selected.transferCount === 0 ? "Direkte" : `${selected.transferCount} bytte`,
        `${formatDuration(selected.walkTimeSeconds)} gange`,
      ].join(" · "),
      statusLabel: selected.realtime ? "Sanntid" : "Rutetid",
      severity: itinerarySeverity(selected),
      selectedItineraryId: selected.id,
      primaryActionHref: safeExternalUrl(selected.handoffUrl),
      primaryActionLabel: "Åpne hos AtB/Entur",
      routeOptions: buildRouteOptions(plan, selected.id),
      context,
    };
  }

  if (plan.primaryMode === "walk" && plan.walkingRoute) {
    return {
      mode: "walk",
      eyebrow: "Reiseråd nå",
      headline: `Gå til ${shortPlaceLabel(plan.destination.label)}`,
      subline: `${formatDistance(plan.walkingRoute.distanceMeters)} · ${formatApproxDuration(
        plan.walkingRoute.durationSeconds,
      )}`,
      statusLabel: "Gangrute",
      severity: context.count ? "watch" : "ok",
      primaryActionLabel: plan.nextTransitOption ? "Sjekk neste kollektivmulighet" : undefined,
      routeOptions: [],
      context,
    };
  }

  return {
    mode: "fallback",
    eyebrow: "Reiseråd nå",
    headline: "Sjekk AtB/Entur",
    subline: plan.journeyPlanner.detail,
    statusLabel: "Mangler trygg reise",
    severity: "warning",
    primaryActionHref: "https://www.atb.no/reiseplanlegger/",
    primaryActionLabel: "Åpne AtB/Entur",
    routeOptions: [],
    context,
  };
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/frontend/src/pages/trafficJourneyView.ts apps/frontend/src/pages/trafficJourneyView.test.ts
git commit -m "feat: derive traffic journey answer view"
```

---

## Task 2: Replace Diagnostic Post-Search Header With Journey Answer

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes:
  - `buildJourneyAnswerView(plan, selectedItineraryId)`
  - `JourneyAnswerView`
- Produces:
  - `JourneyAnswerHeader` React component inside `TrafficMapPage.tsx`
  - Post-search H1 that uses `view.headline`, not static `Planlegg reisen`

- [ ] **Step 1: Write failing render tests for answer-first copy**

Append to `apps/frontend/src/pages/TrafficMapPage.test.ts`:

```ts
describe("TravelPlannerPanel answer-first post-search layout", () => {
  it("uses the selected transit instruction as the post-search headline", () => {
    const plan = planWithItinerary;
    const html = renderToStaticMarkup(
      createElement(TravelPlanCard, {
        plan,
        loading: false,
        selectedItineraryId: plan.itineraries[0]?.id,
        routeContextSummary: buildRouteContextSummary(plan),
        onSelectItinerary: () => undefined,
      }),
    );

    expect(html).toContain("Ta Buss");
    expect(html).toContain("Åpne hos AtB/Entur");
    expect(html).not.toContain("Rute beregnet med OSRM og brukt som korridor");
  });
});
```

- [ ] **Step 2: Run the focused render test and confirm it fails**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "answer-first"
```

Expected: FAIL because current rendering still exposes diagnostic route-summary copy and does not import the new view model.

- [ ] **Step 3: Import the view model and replace `travelPlanDecision` dependency in `TravelPlanCard`**

In `apps/frontend/src/pages/TrafficMapPage.tsx`, import:

```ts
import {
  buildJourneyAnswerView,
  buildJourneyContextView,
  shouldShowJourneyMap,
  type JourneyAnswerView,
  type JourneyContextItemView,
} from "./trafficJourneyView.js";
```

In `TravelPlanCard`, compute:

```ts
const journeyView = buildJourneyAnswerView(plan, selectedItineraryId);
const selectedItinerary = selectedItineraryForPlan(plan, selectedItineraryId);
```

Replace the current card header with:

```tsx
<header className="journey-answer-header">
  <div>
    <p className="label">{journeyView.eyebrow}</p>
    <h2>{journeyView.headline}</h2>
    <p>{journeyView.subline}</p>
  </div>
  <span className={`journey-answer-status journey-answer-status-${journeyView.severity}`}>
    {journeyView.statusLabel}
  </span>
</header>
```

Add the handoff link under the selected route/walking card:

```tsx
{
  journeyView.primaryActionHref && journeyView.primaryActionLabel ? (
    <a
      className="journey-answer-handoff"
      href={journeyView.primaryActionHref}
      target="_blank"
      rel="noreferrer noopener"
    >
      {journeyView.primaryActionLabel}
    </a>
  ) : null;
}
```

Remove the visible `travel-plan-route-summary` from the main answer. Keep source/detail information available later in `TrafficDataDisclosure`.

- [ ] **Step 4: Rename post-search page heading**

In `TravelPlannerPanel`, replace:

```tsx
<h1 id="travel-planner-heading">Planlegg reisen</h1>
```

with:

```tsx
<h1 id="travel-planner-heading">
  {travelPlan
    ? buildJourneyAnswerView(travelPlan, selectedItineraryId).headline
    : "Planlegg reisen"}
</h1>
```

Keep the pre-search H1 unchanged.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "answer-first|mode-aware travel answer|RouteContextFallback"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts
git commit -m "feat: make traffic search answer-first"
```

---

## Task 3: Make The Map A Primary Journey Surface

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes:
  - `shouldShowJourneyMap(plan)`
  - existing `TrafficMapFocus`
  - existing `TravelPlanLayer`
  - existing `TrafficLayer`
- Produces:
  - `TrafficJourneyMapPanel` component inside `TrafficMapPage.tsx`
  - Post-search DOM where map appears inside the journey workspace rather than as a generic support disclosure

- [ ] **Step 1: Write failing render/layout tests for map placement**

Add to `TrafficMapPage.test.ts`:

```ts
describe("traffic journey map placement", () => {
  it("opens the selected journey map for transit and walking answers", () => {
    expect(shouldShowJourneyMap(planWithItinerary)).toBe(true);
    expect(
      shouldShowJourneyMap({
        ...planWithItinerary,
        primaryMode: "walk",
        itineraries: [],
        walkingRoute: {
          source: "osrm",
          detail: "Gangrute beregnet med OSRM.",
          distanceMeters: 3000,
          durationSeconds: 2160,
          geometry: planWithItinerary.route.geometry,
        },
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run focused tests and confirm failure if imports are missing**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "traffic journey map placement"
```

Expected: PASS if Task 1 exports are already wired, otherwise FAIL on missing import. Fix imports before continuing.

- [ ] **Step 3: Extract existing map block into a component**

Inside `TrafficMapPage.tsx`, create `TrafficJourneyMapPanel` near the current map render code. It should accept all currently inline map dependencies:

```ts
type TrafficJourneyMapPanelProps = {
  travelPlan?: TravelPlanPayload;
  selectedItineraryId?: string;
  selectedEvent?: TrafficMapEvent;
  selectedEventId?: string;
  highlightedEventIds: Set<string>;
  visibleTrafficEvents: TrafficMapEvent[];
  data?: TrafficMapPayload;
  publicTransportData?: PublicTransportMapPayload;
  visibleContextLayers: TrafficLayerVisibility;
  selectedCorridorId?: string;
  mobileLayersOpen: boolean;
  loading: boolean;
  error?: string;
  onBoundsChange: (bounds: TrafficMapBounds) => void;
  onSelectEvent: (eventId?: string) => void;
  onSelectCorridor: (corridorId?: string) => void;
  onMobileLayersToggle: () => void;
  onReload: () => void;
  onCategoriesChange: (categories: TrafficMapCategory[]) => void;
  onSeveritiesChange: (severities: TrafficMapSeverity[]) => void;
  onPresetChange: (preset: TrafficMapPreset) => void;
  onContextLayersChange: (layers: TrafficLayerVisibility) => void;
};
```

Move the existing `<section className="traffic-workspace">...</section>` body into that component with no behavior changes.

- [ ] **Step 4: Render the map immediately after `TravelPlannerPanel` when a route is present**

Replace the existing map disclosure block with:

```tsx
{travelPlan && shouldShowJourneyMap(travelPlan) ? (
  <section className="traffic-journey-map-card" aria-label="Kart for valgt reise">
    <header>
      <div>
        <p className="label">Kart</p>
        <h2>Kart for valgt reise</h2>
      </div>
      <span>{routeContextSummary.mapPointCount} kartpunkt</span>
    </header>
    <TrafficJourneyMapPanel ... />
  </section>
) : (
  <details className="traffic-support-disclosure traffic-map-disclosure" open={!travelPlan}>
    <summary>Kart og trafikkgrunnlag</summary>
    <TrafficJourneyMapPanel ... />
  </details>
)}
```

Keep the same prop values the old inline map block used.

- [ ] **Step 5: Style the map-first workspace**

Add to `apps/frontend/src/styles.css`:

```css
.traffic-journey-map-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--line);
  border-left: 5px solid var(--blue);
  background: var(--page);
}

.traffic-journey-map-card > header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.traffic-journey-map-card > header h2 {
  margin: 0;
  font: 28px/1.1 var(--serif);
}

.traffic-journey-map-card > header span {
  flex: 0 0 auto;
  padding: 4px 8px;
  border: 1px solid var(--line);
  color: var(--green);
  background: #fff;
  font-size: 12px;
  font-weight: 850;
}

.traffic-journey-map-card .traffic-workspace {
  min-height: 520px;
}

@media (max-width: 720px) {
  .traffic-journey-map-card {
    order: 2;
    padding: 14px;
  }

  .traffic-journey-map-card .traffic-workspace {
    min-height: 430px;
  }
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "post-search map placement|traffic journey map placement"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts apps/frontend/src/styles.css
git commit -m "feat: promote traffic journey map"
```

---

## Task 4: Collapse Route Context Text Into Map Callouts And A Compact Fallback Drawer

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes:
  - `buildJourneyContextView(plan)`
  - existing `handleRouteContextFocus(item)`
- Produces:
  - `JourneyContextStrip`
  - `JourneyContextDrawer`

- [ ] **Step 1: Write failing render tests**

Add:

```ts
describe("journey context strip", () => {
  it("renders a compact route context strip instead of a large diagnostic list", () => {
    const plan = planWithItinerary;
    const html = renderToStaticMarkup(
      createElement(TravelPlanCard, {
        plan,
        loading: false,
        selectedItineraryId: plan.itineraries[0]?.id,
        routeContextSummary: buildRouteContextSummary(plan),
        onSelectItinerary: () => undefined,
      }),
    );

    expect(html).toContain("Sjekk langs reisen");
    expect(html).not.toContain("Tekstfallback for valgt rute");
    expect(html).not.toContain("<ol");
  });
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "journey context strip"
```

Expected: FAIL because `RouteContextFallback` still renders the large details list inside the answer.

- [ ] **Step 3: Add compact components**

In `TrafficMapPage.tsx`, add:

```tsx
function JourneyContextStrip({
  context,
  onFocusItem,
}: {
  context: JourneyContextView;
  onFocusItem?: (item: JourneyContextItemView) => void;
}) {
  if (!context.count) {
    return <p className="journey-context-clear">Ingen kjente hindringer langs reisen.</p>;
  }
  return (
    <section className="journey-context-strip" aria-label="Sjekk langs reisen">
      <header>
        <p className="label">Sjekk langs reisen</p>
        <strong>{context.headline}</strong>
      </header>
      <div className="journey-context-chips">
        {context.primaryItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`journey-context-chip journey-context-chip-${item.severity}`}
            disabled={!item.focusable}
            onClick={() => onFocusItem?.(item)}
          >
            <span>{item.title}</span>
            <small>
              {item.placement} · {item.source}
            </small>
          </button>
        ))}
      </div>
      {context.overflowItems.length ? (
        <details className="journey-context-overflow">
          <summary>{context.overflowItems.length} flere punkt</summary>
          <ul>
            {context.overflowItems.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span>
                  {item.placement} · {item.source}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
```

Update `handleRouteContextFocus` adapter if needed so it accepts the new item shape:

```ts
function handleJourneyContextFocus(item: JourneyContextItemView): void {
  if (!item.eventId) return;
  setSelectedEventId(item.eventId);
}
```

- [ ] **Step 4: Replace `RouteContextFallback` inside `TravelPlanCard`**

Remove the `RouteContextFallback` call from the main answer card. Render:

```tsx
<JourneyContextStrip
  context={journeyView.context}
  onFocusItem={(item) => {
    if (item.eventId)
      onFocusRouteContextItem?.({
        id: item.id,
        kind: "traffic",
        title: item.title,
        detail: item.detail,
        source: item.source,
        severity: item.severity,
        placement: "near_route",
        placementLabel: item.placement,
        eventId: item.eventId,
        focusable: true,
      });
  }}
/>
```

- [ ] **Step 5: Add compact styles**

Add:

```css
.journey-context-strip {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.journey-context-strip header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}

.journey-context-strip header strong,
.journey-context-clear {
  color: var(--muted);
  font-size: 13px;
}

.journey-context-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.journey-context-chip {
  display: grid;
  gap: 2px;
  max-width: min(100%, 320px);
  padding: 7px 9px;
  border: 1px solid var(--line);
  background: #fff;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.journey-context-chip:disabled {
  cursor: default;
}

.journey-context-chip span,
.journey-context-chip small {
  min-width: 0;
  overflow-wrap: anywhere;
}

.journey-context-chip span {
  color: var(--ink);
  font-size: 12px;
  font-weight: 850;
}

.journey-context-chip small {
  color: var(--muted);
  font-size: 11px;
}

.journey-context-chip-warning {
  border-left: 3px solid var(--terracotta);
}

.journey-context-chip-watch {
  border-left: 3px solid var(--amber);
}

.journey-context-overflow summary {
  color: var(--blue);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "journey context strip|RouteContextFallback"
```

Expected: PASS. Existing `RouteContextFallback` tests may remain if the component is still used for non-map fallback; if not used anywhere, remove the component and its tests in the same commit.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts apps/frontend/src/styles.css
git commit -m "feat: compact route context on traffic page"
```

---

## Task 5: Merge Route Choice And Selected Itinerary Into One Journey Result

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes:
  - `JourneyAnswerView.routeOptions`
  - existing `SelectedItineraryPanel`
- Produces:
  - `JourneyRouteOptions`
  - `JourneySelectedTimeline`

- [ ] **Step 1: Write failing render test for reduced panel count**

Add:

```ts
describe("journey result panel density", () => {
  it("does not render separate full panels for route choices and selected route", () => {
    const plan = planWithItinerary;
    const html = renderToStaticMarkup(
      createElement(TravelPlanCard, {
        plan,
        loading: false,
        selectedItineraryId: plan.itineraries[0]?.id,
        routeContextSummary: buildRouteContextSummary(plan),
        onSelectItinerary: () => undefined,
      }),
    );

    expect(html).toContain("Reisevalg");
    expect(html).toContain("Valgt reise");
    expect(html).not.toContain('class="route-choice-panel"');
    expect(html).not.toContain('class="selected-itinerary-panel"');
  });
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "journey result panel density"
```

Expected: FAIL because the old full panel classes still render.

- [ ] **Step 3: Replace route choice panel markup**

Add:

```tsx
function JourneyRouteOptions({
  options,
  onSelectItinerary,
}: {
  options: JourneyRouteOptionView[];
  onSelectItinerary: (itineraryId: string) => void;
}) {
  if (!options.length) return null;
  return (
    <section className="journey-route-options" aria-label="Reisevalg">
      <p className="label">Reisevalg</p>
      <div>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`journey-route-option journey-route-option-${option.severity}${
              option.selected ? " selected" : ""
            }`}
            aria-pressed={option.selected}
            onClick={() => {
              if (!option.selected) onSelectItinerary(option.id);
            }}
          >
            <strong>{option.label}</strong>
            <span>{option.lineSummary}</span>
            <small>
              {option.timeSummary} · {option.meta}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
```

Keep `SelectedItineraryPanel` behavior but rename its CSS classes or create a smaller component:

```tsx
function JourneySelectedTimeline({ itinerary }: { itinerary?: TravelPlanItinerary }) {
  if (!itinerary) return null;
  return (
    <section className="journey-selected-timeline" aria-label="Valgt reise">
      <SelectedItineraryPanel itinerary={itinerary} />
    </section>
  );
}
```

Then replace old:

```tsx
<RouteChoicePanel ... />
<SelectedItineraryPanel ... />
<SelectedRouteWatchPanel ... />
```

with:

```tsx
<JourneyRouteOptions
  options={journeyView.routeOptions}
  onSelectItinerary={onSelectItinerary}
/>
<JourneySelectedTimeline itinerary={selectedItinerary} />
```

Move the old route-watch details into `JourneyContextStrip`.

- [ ] **Step 4: Add compact styles**

Add:

```css
.journey-route-options {
  display: grid;
  gap: 8px;
}

.journey-route-options > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.journey-route-option {
  display: grid;
  gap: 2px;
  min-width: min(180px, 100%);
  max-width: min(260px, 100%);
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: #fff;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.journey-route-option.selected {
  border-color: color-mix(in srgb, var(--green) 45%, var(--line));
  background: color-mix(in srgb, #fff 88%, var(--green) 12%);
}

.journey-route-option strong {
  color: var(--green);
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.journey-route-option span {
  color: var(--ink);
  font-size: 13px;
  font-weight: 850;
}

.journey-route-option small {
  color: var(--muted);
  font-size: 11px;
}

.journey-selected-timeline .selected-itinerary-panel {
  padding: 0;
  border: 0;
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "journey result panel density|answer-first"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts apps/frontend/src/styles.css
git commit -m "feat: simplify traffic route choices"
```

---

## Task 6: Make Departure Board A Selected-Route Detail, Not A Competing Page Section

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`
- Modify: `e2e/app.spec.ts`

**Interfaces:**

- Consumes:
  - `selectedDeparture`
  - `departureBoard`
  - `routeOriginDepartureBoardContext`
- Produces:
  - `SelectedDepartureInline`
  - Full departure board collapsed under “Avganger for valgt holdeplass”

- [ ] **Step 1: Add render test for inline departure status**

Add:

```ts
describe("selected route departure status", () => {
  it("keeps departure board context attached to selected journey", () => {
    const html = renderToStaticMarkup(
      createElement(SelectedDepartureInline, {
        status: {
          label: "Sanntid",
          detail: "Matcher sanntidsavgang mot Lade.",
          severity: "ok",
        },
      }),
    );

    expect(html).toContain("Sanntid");
    expect(html).toContain("Matcher sanntidsavgang mot Lade.");
  });
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "selected route departure status"
```

Expected: FAIL because `SelectedDepartureInline` does not exist.

- [ ] **Step 3: Add the inline component**

In `TrafficMapPage.tsx`:

```tsx
export function SelectedDepartureInline({ status }: { status?: SelectedDepartureStatus }) {
  if (!status) return null;
  return (
    <aside
      className={`selected-departure-inline selected-departure-inline-${status.severity}`}
      aria-label="Live-status for valgt avgang"
    >
      <strong>{status.label}</strong>
      <span>{status.detail}</span>
    </aside>
  );
}
```

Render it inside the journey selected timeline area:

```tsx
<SelectedDepartureInline
  status={selectedDepartureStatus(
    selectedDeparture,
    firstBoardingLeg(selectedItinerary),
    departureBoard,
  )}
/>
```

Pass the needed props from `TrafficMapPage` into `TravelPlannerPanel` and `TravelPlanCard`.

- [ ] **Step 4: Collapse full board below the journey workspace**

Change the current departure board disclosure summary from a broad section to:

```tsx
<details className="traffic-support-disclosure departure-board-disclosure">
  <summary>Avganger for valgt holdeplass</summary>
  <DepartureBoardPanel ... />
</details>
```

Do not render this disclosure above the map on mobile. It should sit after the map and compact journey answer.

- [ ] **Step 5: Add styles**

```css
.selected-departure-inline {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, #fff 92%, var(--green) 8%);
}

.selected-departure-inline-warning {
  background: #fff8f3;
  border-left: 3px solid var(--terracotta);
}

.selected-departure-inline-watch {
  background: #fff8e8;
  border-left: 3px solid var(--amber);
}

.selected-departure-inline strong {
  color: var(--ink);
  font-size: 12px;
}

.selected-departure-inline span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}
```

- [ ] **Step 6: Update E2E expectations**

In `e2e/app.spec.ts`, update `/trafikk` tests so they assert:

```ts
await expect(page.getByLabel("Live-status for valgt avgang")).toBeVisible();
await expect(page.locator("details.departure-board-disclosure")).toContainText(
  "Avganger for valgt holdeplass",
);
```

Remove expectations that require the full departure board to appear before the map.

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "selected route departure status"
npm run test:e2e -- --grep "trafikk"
```

Expected: focused unit test passes; `/trafikk` e2e passes.

- [ ] **Step 8: Commit Task 6**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts apps/frontend/src/styles.css e2e/app.spec.ts
git commit -m "feat: attach departures to traffic journey"
```

---

## Task 7: Simplify Time Choice Into Compact Option Chips

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes:
  - `TravelTimeComparisonState`
  - `TravelTimeComparisonModel`
- Produces:
  - `JourneyTimeOptions`

- [ ] **Step 1: Add render test for compact time chips**

Add:

```ts
describe("journey time options", () => {
  it("uses compact time chips instead of a full comparison panel", () => {
    const state: TravelTimeComparisonState = {
      status: "ready",
      activePreset: "now",
      sources: [],
      model: {
        status: "ready",
        heading: "Dra nå",
        detail: "Nå ser best ut.",
        options: [
          {
            preset: "now",
            label: "Nå",
            summary: "Best",
            lineSummary: "Buss 2",
            durationLabel: "18 min",
            transferLabel: "Direkte",
            status: "ok",
            severity: "ok",
            detail: "Beste alternativ.",
            active: true,
            recommended: true,
          },
        ],
      },
    };

    const html = renderToStaticMarkup(
      createElement(JourneyTimeOptions, {
        state,
        activePreset: "now",
        onSelectPreset: () => undefined,
      }),
    );

    expect(html).toContain("Nå");
    expect(html).not.toContain("Valgt reise live-sjekkes mer detaljert");
  });
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "journey time options"
```

Expected: FAIL because `JourneyTimeOptions` does not exist.

- [ ] **Step 3: Add compact time option component**

```tsx
export function JourneyTimeOptions({
  state,
  activePreset,
  onSelectPreset,
}: {
  state: TravelTimeComparisonState;
  activePreset: TravelTimePreset;
  onSelectPreset: (preset: TravelTimePreset) => void;
}) {
  if (state.status === "idle" || !state.model) return null;
  return (
    <section className="journey-time-options" aria-label="Dra nå eller vent">
      <p className="label">Tid</p>
      <div>
        {state.model.options.map((option) => (
          <button
            key={option.preset}
            type="button"
            className={`journey-time-option journey-time-option-${option.severity}${
              option.active ? " selected" : ""
            }`}
            aria-pressed={option.preset === activePreset}
            disabled={option.status === "error" || option.preset === activePreset}
            onClick={() => onSelectPreset(option.preset)}
          >
            <strong>{option.label}</strong>
            <span>{option.summary}</span>
            <small>
              {[option.lineSummary, option.durationLabel, option.transferLabel]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
```

Replace the `travel-time-disclosure` block inside `TravelPlannerPanel` with this compact component under the main answer card.

- [ ] **Step 4: Add styles**

```css
.journey-time-options {
  display: grid;
  gap: 7px;
  margin-top: 10px;
}

.journey-time-options > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.journey-time-option {
  display: grid;
  gap: 2px;
  max-width: min(190px, 100%);
  padding: 7px 9px;
  border: 1px solid var(--line);
  background: #fff;
  color: inherit;
  text-align: left;
}

.journey-time-option.selected {
  border-color: color-mix(in srgb, var(--green) 44%, var(--line));
  background: color-mix(in srgb, #fff 90%, var(--green) 10%);
}

.journey-time-option strong {
  color: var(--green);
  font-size: 11px;
}

.journey-time-option span {
  color: var(--ink);
  font-size: 12px;
  font-weight: 850;
}

.journey-time-option small {
  color: var(--muted);
  font-size: 11px;
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "journey time options|answer-first"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

Run:

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts apps/frontend/src/styles.css
git commit -m "feat: compact traffic time choices"
```

---

## Task 8: Mobile And Desktop Visual Hierarchy Hardening

**Files:**

- Modify: `apps/frontend/src/styles.css`
- Modify: `e2e/app.spec.ts`

**Interfaces:**

- Consumes:
  - final component DOM from Tasks 2-7
- Produces:
  - stable mobile order and desktop split layout

- [ ] **Step 1: Add E2E order assertions**

In the mobile `/trafikk` test, assert the vertical order:

```ts
const answer = page.getByLabel("Reiseråd nå").or(page.locator(".travel-plan-card")).first();
const map = page.getByLabel("Kart for valgt reise").first();
const trafficPicture = page.locator("details.traffic-support-disclosure", {
  hasText: "Trafikkbildet nå",
});
const sourceData = page.locator(".traffic-data-disclosure");

const answerBox = await answer.boundingBox();
const mapBox = await map.boundingBox();
const trafficPictureBox = await trafficPicture.boundingBox();
const sourceDataBox = await sourceData.boundingBox();

expect(answerBox?.y ?? 0).toBeLessThan(mapBox?.y ?? 0);
expect(mapBox?.y ?? 0).toBeLessThan(trafficPictureBox?.y ?? Number.POSITIVE_INFINITY);
expect(trafficPictureBox?.y ?? 0).toBeLessThan(sourceDataBox?.y ?? Number.POSITIVE_INFINITY);
```

Also keep the existing no-horizontal-overflow assertion:

```ts
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
expect(overflow).toBeLessThanOrEqual(1);
```

- [ ] **Step 2: Add desktop assertion**

Add a desktop e2e assertion that the selected map is visible without opening a disclosure:

```ts
await expect(page.getByLabel("Kart for valgt reise")).toBeVisible();
await expect(page.locator("details.traffic-map-disclosure")).toHaveCount(0);
```

Use this only for post-search states where `shouldShowJourneyMap(plan)` is true.

- [ ] **Step 3: Update CSS ordering**

In `apps/frontend/src/styles.css`, ensure mobile order:

```css
@media (max-width: 720px) {
  .travel-planner-panel {
    order: 1;
  }

  .traffic-journey-map-card {
    order: 2;
  }

  .departure-board-disclosure {
    order: 3;
  }

  .traffic-support-disclosure:not(.traffic-map-disclosure):not(.departure-board-disclosure) {
    order: 4;
  }

  .traffic-data-disclosure {
    order: 5;
  }

  .traffic-bottom-panel {
    order: 6;
  }
}
```

Avoid applying `order` to nested children inside the journey card unless a test requires it.

- [ ] **Step 4: Run focused e2e**

Run:

```bash
npm run test:e2e -- --grep "trafikk"
```

Expected: all `/trafikk` tests pass on desktop and mobile projects.

- [ ] **Step 5: Commit Task 8**

Run:

```bash
git add apps/frontend/src/styles.css e2e/app.spec.ts
git commit -m "test: harden traffic journey layout"
```

---

## Task 9: Final Verification, Review, And Release Prep

**Files:**

- No expected source edits unless verification finds a defect.

**Interfaces:**

- Consumes: all previous task commits.
- Produces: verified branch ready for review/ship.

- [ ] **Step 1: Run disk guardrail**

Run:

```bash
df -h /System/Volumes/Data
```

Expected: at least `50Gi` free. Stop and report if lower.

- [ ] **Step 2: Run local gates**

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

Expected:

- formatting passes;
- lint passes;
- typecheck passes;
- unit tests pass;
- production build passes;
- Playwright passes;
- audit reports `0` high vulnerabilities;
- `git diff --check` passes.

- [ ] **Step 3: Run local visual smoke**

Start the app:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm run dev
```

In a browser, verify:

- `/trafikk` pre-search shows planner first and does not look like a traffic audit page.
- Munkegata -> Lade with `Nå` either shows transit, walking, or a clear operator handoff.
- When transit exists, the answer names line and boarding stop.
- When transit does not exist, walking route and walking ETA are the first useful answer.
- The selected route map is visible without opening a generic support disclosure.
- Roadwork/context appears as map pins/chips, not a wall of boxes.
- Mobile viewport has no horizontal scroll and the map is not buried below broad traffic/source panels.

- [ ] **Step 4: Request review**

Use `superpowers:requesting-code-review` and ask the reviewer to focus on:

- traveller-first hierarchy;
- no new provenance/source/evidence semantics;
- no additional network fan-out;
- mobile layout;
- route-context accessibility after removing large text lists;
- preserved AtB/Entur authority copy.

- [ ] **Step 5: Fix review findings**

For each true finding:

1. write a focused failing test when possible;
2. implement the smallest fix;
3. rerun the focused test and relevant gates;
4. commit with a narrow message.

- [ ] **Step 6: Final commit hygiene check**

Run:

```bash
git status --short
git log --oneline --decorate -10
```

Expected:

- only intentional tracked changes are staged/committed;
- unrelated untracked artifacts remain unstaged;
- commit stack is readable and task-scoped.

---

## Acceptance Criteria

- A user who searches Munkegata -> Lade immediately sees either the concrete bus/tram/train/walk instruction or a clear AtB/Entur handoff.
- The selected route map is visible as part of the primary result when a route exists.
- Text boxes listing roadwork are replaced by map pins plus a compact chip/drawer fallback.
- Post-search H1 does not remain generic `Planlegg reisen`.
- The full departure board no longer competes with the primary journey answer.
- Broad `Trafikkbildet nå`, sources, layer internals, and data diagnostics are below the main answer.
- Mobile order is: planner/answer, map, selected-departure context, compact warnings, broad diagnostics.
- No new upstream calls, source items, situations, source contracts, database migrations, or worker changes.
- `/trafikk` e2e tests verify visible map, concrete journey answer, walking fallback, compact context, and no horizontal overflow.

---

## Autonomous `/goal` Prompt

Use this as the autonomous work goal:

```text
/goal Redesign Nytt Trondheim `/trafikk` into a traveller-first journey answer page using the plan at `/Users/reidar/Projectos/Nytt/docs/superpowers/plans/2026-07-09-trafikk-journey-answer-redesign.md`.

Intent:
- Make `/trafikk` answer “what should I do now?” before it shows diagnostics.
- After a route search, show the concrete travel instruction first: transit line + boarding stop when available, otherwise walking route + walking ETA, otherwise a clear AtB/Entur handoff.
- Make the selected route map a primary visible workspace, not a generic support disclosure.
- Move roadwork/context from duplicated text boxes onto the map with compact chips/fallback drawer.
- Collapse route choice, selected itinerary, route warnings, departure board, time comparison, traffic picture, and data/source details into a cleaner hierarchy.

Hard constraints:
- Do not add new providers, database tables, source contracts, `source_items`, situations, worker ingestion, or situation evidence.
- Entur/DATEX/Vegvesen/public-transport data remains traveller context only.
- Keep `/trafikk` public/viewer-safe and Bokmål-only.
- Use Node 22.
- Preserve request-id invalidation plus abort cleanup patterns for any new polling/request hooks.
- Do not stage unrelated local artifacts.

Execution method:
- Use `superpowers:subagent-driven-development` task-by-task from the saved plan.
- Follow TDD where the plan asks for failing tests first.
- Commit after each task with narrow commits.
- Run focused tests after each task and full gates at the end:
  `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm audit --omit=dev --audit-level=high`, `git diff --check`.
- Request code review before final ship.

Definition of done:
- `/trafikk` route search shows a concrete journey answer and visible map without user digging through disclosures.
- Walking fallback is first-class when no transit is available.
- Road/context text no longer dominates the result.
- Mobile has no horizontal overflow and shows answer/map before broad diagnostics.
- Full local verification passes.
- Obsidian is logged with evidence and non-claims.
```
