# /trafikk Traveller-First UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/trafikk` feel like a traveller journey tool: one clear travel answer first, the map as route proof immediately after, and disruption/context details only where they help the decision.

**Architecture:** Keep the existing server payload and Entur/DATEX boundaries. Add a richer pure frontend journey view model in `trafficJourneyView.ts`, render it through focused React components, and make `TrafficMapPage.tsx` use the map as the primary evidence surface after a route search. Do not turn traveller context into situation-room evidence or `source_items`.

**Tech Stack:** React 19 + Vite frontend, TypeScript strict mode, Leaflet map components, shared TypeScript contracts from `@nytt/shared`, Vitest static-render tests, Playwright e2e.

## Global Constraints

- Use Node 22 before verification: `source ~/.nvm/nvm.sh && nvm use 22`.
- All user-facing text must be Bokmål.
- Keep Entur and AtB as ticket/operator authority; Nytt only gives traveller risk/context.
- Do not add new persisted source/evidence models for journey planning.
- Do not create situations or `source_items` from traveller journey data.
- Keep `/trafikk` public/viewer-safe; owner-only raw investigation remains in command/drift surfaces.
- Do not add a new design system or component library.
- Keep cards at 8px radius or less, consistent with the current UI.
- Avoid adding more visible explanatory chrome; remove or demote internal-system wording when possible.
- Preserve existing route-search, departure-board, saved-route, and map-layer behavior unless a task explicitly narrows it.

---

## File Structure

- Modify `apps/frontend/src/pages/trafficJourneyView.ts`
  - Pure traveller answer model: main instruction, route steps, route map summary, visible context counts, and disclosure labels.
  - No React imports.
- Modify `apps/frontend/src/pages/trafficJourneyView.test.ts`
  - Pure model tests for bus, tram, walking fallback, operator handoff, cancelled legs, and context demotion.
- Create `apps/frontend/src/pages/TrafficJourneyAnswer.tsx`
  - Presentational component for the first result card: instruction, meta, route steps, compact alternatives, handoff.
  - Receives pure model objects and callbacks; no fetching.
- Modify `apps/frontend/src/pages/TrafficMapPage.tsx`
  - Use `TrafficJourneyAnswer`.
  - Simplify `TravelPlanCard`.
  - Make map and route context placement follow the new model.
  - Keep the existing exported helpers needed by tests.
- Modify `apps/frontend/src/pages/TrafficMapPage.test.ts`
  - Static-render tests for the answer card, route-step list, map-first context, and hidden noisy context.
- Modify `apps/frontend/src/styles.css`
  - Traveller-first layout, mobile order, map height, compact disclosures, and less bulky context.
- Modify `e2e/app.spec.ts`
  - Browser acceptance for transit, walking fallback, no-route handoff, route context map proof, and mobile first viewport.
- No server files should change unless a frontend test proves an existing payload field is missing. If a server change becomes necessary, stop and add a short amendment to this plan before implementation.

---

### Task 1: Pure Traveller Answer Model

**Files:**

- Modify: `apps/frontend/src/pages/trafficJourneyView.ts`
- Modify: `apps/frontend/src/pages/trafficJourneyView.test.ts`

**Interfaces:**

- Consumes: `TravelPlanPayload`, `TravelPlanItinerary`, `TravelPlanLeg` from `@nytt/shared`.
- Produces:
  - `JourneyStepView`
  - `JourneyMapSummaryView`
  - `JourneyTravellerAnswerView`
  - `buildJourneyTravellerAnswer(plan?: TravelPlanPayload, selectedItineraryId?: string): JourneyTravellerAnswerView`

- [ ] **Step 1: Add failing pure-model tests**

Append these tests to `apps/frontend/src/pages/trafficJourneyView.test.ts`:

```ts
import { buildJourneyTravellerAnswer } from "./trafficJourneyView";

it("builds a traveller-first bus answer with concrete steps", () => {
  const answer = buildJourneyTravellerAnswer(planWithItinerary, "itinerary-1");

  expect(answer.mode).toBe("transit");
  expect(answer.headline).toBe("Ta Buss 2 fra Søndre gate");
  expect(answer.primaryMeta).toBe("11:10 → 11:28 · 18 min · Direkte");
  expect(answer.steps.map((step) => step.label)).toEqual([
    "Gå til Søndre gate",
    "Ta Buss 2 mot Lade",
    "Gå til Lade gård",
  ]);
  expect(answer.mapSummary.heading).toBe("Ruten vises på kartet");
  expect(answer.context.primaryTextItems).toEqual([]);
});

it("builds a walking answer when walkingRoute is the primary fallback", () => {
  const answer = buildJourneyTravellerAnswer({
    ...plan,
    primaryMode: "walk",
    walkingRoute: {
      source: "direct",
      distanceMeters: 3500,
      durationSeconds: 2580,
      detail: "Gangtid estimert fra luftlinjekorridor.",
      confidence: "corridor",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
    },
    itineraries: [],
    journeyPlanner: {
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
      requestedDepartureTime: "2026-06-01T23:30:00.000Z",
      source: "Entur Journey Planner",
    },
  });

  expect(answer.mode).toBe("walk");
  expect(answer.headline).toBe("Gå til Lade gård");
  expect(answer.primaryMeta).toBe("43 min · 3,5 km");
  expect(answer.steps.map((step) => step.label)).toEqual(["Gå til Lade gård"]);
  expect(answer.handoff.label).toBe("Sjekk AtB/Entur");
});

it("uses operator handoff when no concrete journey or walking route exists", () => {
  const answer = buildJourneyTravellerAnswer({
    ...planWithItinerary,
    primaryMode: "fallback",
    walkingRoute: undefined,
    itineraries: [],
    journeyPlanner: {
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
      requestedDepartureTime: "2026-06-01T23:30:00.000Z",
      source: "Entur Journey Planner",
    },
  });

  expect(answer.mode).toBe("handoff");
  expect(answer.headline).toBe("Sjekk AtB/Entur");
  expect(answer.steps).toEqual([]);
  expect(answer.handoff.label).toBe("Åpne AtB/Entur");
});

it("keeps map-point traffic out of primary text items", () => {
  const answer = buildJourneyTravellerAnswer({
    ...planWithItinerary,
    trafficImpacts: [
      {
        event: {
          id: "roadwork-1",
          source: "vegvesen_traffic_info",
          sourceEventId: "roadwork-1",
          category: "roadworks",
          severity: "medium",
          state: "active",
          title: "Vegarbeid ved Bakklandet",
          updatedAt: "2026-06-01T09:00:00.000Z",
          geometry: { type: "Point", coordinates: [10.4, 63.43] },
        },
        distanceMeters: 121,
        severity: "medium",
        summary: "121 m fra foreslått rute.",
      },
    ],
    publicTransportSuggestions: [
      {
        id: "line-alert",
        kind: "alert",
        title: "Endret rute",
        detail: "Linje 3 kjører via Lerkendal.",
        source: "Entur avvik",
      },
    ],
  });

  expect(answer.context.mapPointCount).toBe(1);
  expect(answer.context.primaryTextItems.map((item) => item.title)).toEqual(["Endret rute"]);
  expect(answer.context.disclosureLabel).toBe("1 linjevarsel");
});
```

- [ ] **Step 2: Run the model tests and verify they fail**

Run:

```bash
npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Expected: fail because `buildJourneyTravellerAnswer`, `JourneyStepView`, and the richer context fields do not exist.

- [ ] **Step 3: Add the pure model types and helpers**

Add these exports near the existing `JourneyAnswerView` interfaces in `apps/frontend/src/pages/trafficJourneyView.ts`:

```ts
export type JourneyTravellerMode = "transit" | "walk" | "handoff" | "idle";

export interface JourneyStepView {
  id: string;
  kind: "walk" | "ride" | "handoff";
  label: string;
  detail: string;
  meta?: string;
  lineLabel?: string;
  fromLabel?: string;
  toLabel?: string;
  severity: JourneyAnswerSeverity;
}

export interface JourneyMapSummaryView {
  placement: JourneyMapPlacement;
  heading: string;
  detail: string;
  routeVisible: boolean;
  mapPointCount: number;
}

export interface JourneyContextTextItemView {
  id: string;
  title: string;
  detail: string;
  source: string;
  severity: JourneyAnswerSeverity;
  href?: string;
}

export interface JourneyTravellerAnswerView {
  mode: JourneyTravellerMode;
  headline: string;
  primaryMeta: string;
  supportingText: string;
  severity: JourneyAnswerSeverity;
  primaryItineraryId?: string;
  handoff: {
    label?: string;
    url?: string;
  };
  steps: JourneyStepView[];
  routeOptions: JourneyRouteOptionView[];
  mapSummary: JourneyMapSummaryView;
  context: {
    mapPointCount: number;
    primaryTextItems: JourneyContextTextItemView[];
    disclosureLabel: string;
  };
}
```

Add these helper functions below `buildJourneyAnswerView`:

```ts
function cleanStepPlace(label?: string): string {
  return shortPlaceLabel(label ?? "");
}

function stepTime(value?: string): string | undefined {
  return value ? formatTravelDateTime(value) : undefined;
}

function walkStepFromLeg(leg: TravelPlanLeg, index: number): JourneyStepView {
  const destination = cleanStepPlace(leg.to.stopName ?? leg.to.name);
  return {
    id: `step:${leg.id || index}:walk`,
    kind: "walk",
    label: `Gå til ${destination}`,
    detail: [formatDuration(leg.durationSeconds), formatDistance(leg.distanceMeters)]
      .filter(Boolean)
      .join(" · "),
    fromLabel: cleanStepPlace(leg.from.stopName ?? leg.from.name),
    toLabel: destination,
    severity: "ok",
  };
}

function rideStepFromLeg(leg: TravelPlanLeg, index: number): JourneyStepView {
  const line = lineLabel(leg);
  const destination = cleanStepPlace(leg.to.stopName ?? leg.to.name);
  const start = stepTime(leg.expectedStartTime ?? leg.aimedStartTime);
  const end = stepTime(leg.expectedEndTime ?? leg.aimedEndTime);
  return {
    id: `step:${leg.id || index}:ride`,
    kind: "ride",
    label: `Ta ${line} mot ${destination}`,
    detail: [start && end ? `${start} → ${end}` : undefined, formatDuration(leg.durationSeconds)]
      .filter(Boolean)
      .join(" · "),
    lineLabel: line,
    fromLabel: cleanStepPlace(leg.from.stopName ?? leg.from.name),
    toLabel: destination,
    severity: leg.cancelled ? "warning" : "ok",
  };
}

function stepsForItinerary(itinerary: TravelPlanItinerary): JourneyStepView[] {
  return itinerary.legs
    .filter((leg) => !leg.cancelled)
    .map((leg, index) =>
      leg.mode === "walk" ? walkStepFromLeg(leg, index) : rideStepFromLeg(leg, index),
    )
    .filter((step) => step.detail || step.kind === "ride");
}

function stepsForWalkingRoute(plan: TravelPlanPayload): JourneyStepView[] {
  if (!plan.walkingRoute) return [];
  return [
    {
      id: "step:walking-route",
      kind: "walk",
      label: `Gå til ${shortPlaceLabel(plan.destination.label)}`,
      detail: [
        formatDuration(plan.walkingRoute.durationSeconds),
        formatDistance(plan.walkingRoute.distanceMeters),
      ]
        .filter(Boolean)
        .join(" · "),
      fromLabel: shortPlaceLabel(plan.origin.label),
      toLabel: shortPlaceLabel(plan.destination.label),
      severity: "ok",
    },
  ];
}
```

- [ ] **Step 4: Implement `buildJourneyTravellerAnswer`**

Add this export below the helpers from Step 3:

```ts
function mapSummaryForPlan(
  plan: TravelPlanPayload | undefined,
  selectedItineraryId?: string,
): JourneyMapSummaryView {
  const placement = getJourneyMapPlacement(plan, selectedItineraryId);
  const context = buildJourneyContextView(plan);
  return {
    placement,
    heading: placement === "primary" ? "Ruten vises på kartet" : "Kart brukes som støtte",
    detail:
      placement === "primary"
        ? "Kartet viser valgt reise, stopp, gangetapper og relevante trafikkpunkt."
        : "Kartet viser trafikkgrunnlaget når det finnes rute- eller kartkontekst.",
    routeVisible: placement === "primary",
    mapPointCount: context.mapPointCount,
  };
}

function primaryContextItems(plan?: TravelPlanPayload): JourneyContextTextItemView[] {
  return (plan?.publicTransportSuggestions ?? [])
    .filter((suggestion) => suggestion.kind === "alert" && suggestion.distanceMeters === undefined)
    .slice(0, 3)
    .map((suggestion) => ({
      id: suggestion.id,
      title: suggestion.title,
      detail: suggestion.detail,
      source: sourceLabel(suggestion.source),
      severity: transitSuggestionSeverity(suggestion),
      href: suggestion.href,
    }));
}

function contextDisclosureLabel(plan?: TravelPlanPayload): string {
  const mapPointCount = buildJourneyContextView(plan).mapPointCount;
  const textCount = primaryContextItems(plan).length;
  const parts = [
    mapPointCount ? `${mapPointCount} kartpunkt${mapPointCount === 1 ? "" : "er"}` : undefined,
    textCount ? `${textCount} linjevarsel${textCount === 1 ? "" : "er"}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Ingen kjente hindringer";
}

export function buildJourneyTravellerAnswer(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): JourneyTravellerAnswerView {
  const baseAnswer = buildJourneyAnswerView(plan, selectedItineraryId);
  if (!plan) {
    return {
      mode: "idle",
      headline: baseAnswer.heading,
      primaryMeta: "",
      supportingText: baseAnswer.detail,
      severity: baseAnswer.severity,
      handoff: {},
      steps: [],
      routeOptions: [],
      mapSummary: mapSummaryForPlan(undefined),
      context: {
        mapPointCount: 0,
        primaryTextItems: [],
        disclosureLabel: "Ingen valgt rute",
      },
    };
  }

  const itinerary = selectedItinerary(plan, selectedItineraryId);
  const steps =
    baseAnswer.kind === "transit" && itinerary
      ? stepsForItinerary(itinerary)
      : baseAnswer.kind === "walk" && plan.walkingRoute
        ? stepsForWalkingRoute(plan)
        : isWalkOnlyItinerary(itinerary)
          ? stepsForItinerary(itinerary)
          : [];

  return {
    mode: baseAnswer.kind,
    headline: baseAnswer.heading,
    primaryMeta: baseAnswer.meta,
    supportingText: baseAnswer.detail,
    severity: baseAnswer.severity,
    primaryItineraryId: baseAnswer.primaryItineraryId,
    handoff: {
      label: baseAnswer.handoffLabel,
      url: baseAnswer.handoffUrl,
    },
    steps,
    routeOptions: baseAnswer.routeOptions,
    mapSummary: mapSummaryForPlan(plan, selectedItineraryId),
    context: {
      mapPointCount: buildJourneyContextView(plan).mapPointCount,
      primaryTextItems: primaryContextItems(plan),
      disclosureLabel: contextDisclosureLabel(plan),
    },
  };
}
```

- [ ] **Step 5: Run the pure model tests**

Run:

```bash
npm test -- apps/frontend/src/pages/trafficJourneyView.test.ts
```

Expected: pass all tests in `trafficJourneyView.test.ts`.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/frontend/src/pages/trafficJourneyView.ts apps/frontend/src/pages/trafficJourneyView.test.ts
git commit -m "feat: model traveller-first traffic answers"
```

---

### Task 2: Traveller Answer Component

**Files:**

- Create: `apps/frontend/src/pages/TrafficJourneyAnswer.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`

**Interfaces:**

- Consumes: `JourneyTravellerAnswerView`, `JourneyRouteOptionView` from `trafficJourneyView.ts`.
- Produces: `TrafficJourneyAnswer` React component.
- `TrafficMapPage.tsx` continues exporting `TravelPlanCard`.

- [ ] **Step 1: Add failing static-render tests**

In `apps/frontend/src/pages/TrafficMapPage.test.ts`, add:

```ts
describe("TrafficJourneyAnswer", () => {
  it("renders instruction, steps, alternatives, and handoff without bulky diagnostics", () => {
    const html = renderToStaticMarkup(
      createElement(TravelPlanCard, {
        plan: planWithItinerary,
        loading: false,
        routeChoiceModel: buildRouteChoiceModel({
          plan: planWithItinerary,
          selectedItineraryId: "itinerary-1",
        }),
        selectedItineraryId: "itinerary-1",
        onSelectItinerary: () => undefined,
      }),
    );

    expect(html).toContain("Ta Buss 2 fra Søndre gate");
    expect(html).toContain("Gå til Søndre gate");
    expect(html).toContain("Ta Buss 2 mot Lade");
    expect(html).toContain("Gå til Lade gård");
    expect(html).toContain("Åpne hos AtB/Entur");
    expect(html).not.toContain("Kollektivvalg");
    expect(html).not.toContain("Valgt reiseforslag ser best ut");
  });

  it("renders walking as the primary answer without pretending there is transit", () => {
    const walkingPlan: TravelPlanPayload = {
      ...plan,
      primaryMode: "walk",
      itineraries: [],
      walkingRoute: {
        source: "direct",
        distanceMeters: 3500,
        durationSeconds: 2580,
        detail: "Gangtid estimert fra luftlinjekorridor.",
        confidence: "corridor",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.393742, 63.432883],
            [10.463, 63.433],
          ],
        },
      },
    };

    const html = renderToStaticMarkup(
      createElement(TravelPlanCard, {
        plan: walkingPlan,
        loading: false,
        onSelectItinerary: () => undefined,
      }),
    );

    expect(html).toContain("Gå til Lade gård");
    expect(html).toContain("43 min");
    expect(html).not.toContain("Start med Buss");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t TrafficJourneyAnswer
```

Expected: fail because the component and simplified rendering do not exist yet.

- [ ] **Step 3: Create the presentational component**

Create `apps/frontend/src/pages/TrafficJourneyAnswer.tsx`:

```tsx
import type { JourneyTravellerAnswerView } from "./trafficJourneyView";

export function TrafficJourneyAnswer({
  answer,
  onSelectItinerary,
}: {
  answer: JourneyTravellerAnswerView;
  onSelectItinerary?: (itineraryId: string) => void;
}) {
  return (
    <article
      className={`traffic-journey-answer traffic-journey-answer-${answer.severity}`}
      aria-live="polite"
    >
      <header className="traffic-journey-answer-header">
        <p className="label">Reiseråd nå</p>
        <h2>{answer.headline}</h2>
        {answer.primaryMeta ? (
          <p className="traffic-journey-answer-meta">{answer.primaryMeta}</p>
        ) : null}
        <p>{answer.supportingText}</p>
        {answer.handoff.url && answer.handoff.label ? (
          <a
            className="traffic-journey-answer-handoff"
            href={answer.handoff.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {answer.handoff.label}
          </a>
        ) : null}
      </header>

      {answer.steps.length ? (
        <ol className="traffic-journey-steps" aria-label="Reisesteg">
          {answer.steps.map((step) => (
            <li key={step.id} className={`traffic-journey-step traffic-journey-step-${step.kind}`}>
              <span className="traffic-journey-step-icon" aria-hidden="true">
                {step.kind === "ride" ? "◇" : "•"}
              </span>
              <div>
                <strong>{step.label}</strong>
                {step.detail ? <span>{step.detail}</span> : null}
                {step.meta ? <small>{step.meta}</small> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {answer.routeOptions.length > 1 ? (
        <section className="traffic-journey-alternatives" aria-label="Andre reiseforslag">
          <h3>Andre valg</h3>
          <div>
            {answer.routeOptions.map((option) => (
              <button
                key={`${option.label}:${option.itineraryId}`}
                type="button"
                className={option.selected ? "selected" : undefined}
                aria-pressed={option.selected}
                onClick={() => onSelectItinerary?.(option.itineraryId)}
              >
                <strong>{option.label}</strong>
                <span>{option.summary}</span>
                <small>{option.meta}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {answer.context.primaryTextItems.length ? (
        <details className="traffic-journey-context-disclosure">
          <summary>Hva påvirker reisen? {answer.context.disclosureLabel}</summary>
          <ul>
            {answer.context.primaryTextItems.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span>
                  {item.detail} · {item.source}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer>Nytt vurderer reiserisiko, ikke billetter eller garanti.</footer>
    </article>
  );
}
```

- [ ] **Step 4: Wire `TrafficJourneyAnswer` into `TravelPlanCard`**

In `apps/frontend/src/pages/TrafficMapPage.tsx`:

1. Add imports:

```ts
import { TrafficJourneyAnswer } from "./TrafficJourneyAnswer";
import { buildJourneyTravellerAnswer } from "./trafficJourneyView";
```

2. In `TravelPlanCard`, replace the existing `<article className=...>` body with this structure:

```tsx
const travellerAnswer = buildJourneyTravellerAnswer(plan, selectedItineraryId);

return (
  <section id="travel-plan-result" className="travel-plan-result" aria-live="polite">
    <TrafficJourneyAnswer answer={travellerAnswer} onSelectItinerary={onSelectItinerary} />
  </section>
);
```

3. Preserve the existing error, loading, and no-plan branches exactly as they are.

- [ ] **Step 5: Remove dead local variables after the refactor**

In `TravelPlanCard`, remove these variables if they are no longer referenced:

```ts
const answer = buildJourneyAnswerView(plan, selectedItineraryId);
const answerHandoffUrl = safeExternalUrl(answer.handoffUrl);
const selectedItinerary = selectedItineraryForPlan(plan, selectedItineraryId);
const showFallbackSuggestions =
  plan.primaryMode !== "transit" && plan.publicTransportSuggestions.length > 0;
```

Run:

```bash
npm run lint
```

Expected: no unused import or unused variable errors.

- [ ] **Step 6: Run focused component tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "TravelPlanCard journey answer|TrafficJourneyAnswer"
```

Expected: pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/frontend/src/pages/TrafficJourneyAnswer.tsx apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts
git commit -m "feat: render traveller-first traffic answer"
```

---

### Task 3: Map As Route Proof

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`
- Modify: `e2e/app.spec.ts`

**Interfaces:**

- Consumes: `travelMapDisplayMode(plan, selectedItineraryId)`.
- Produces: same exported helper, but the rendered map section becomes the canonical post-search route proof.

- [ ] **Step 1: Add failing static tests for map proof copy**

In `apps/frontend/src/pages/TrafficMapPage.test.ts`, add:

```ts
describe("traffic map route proof", () => {
  it("uses route-proof copy instead of route diagnostics copy after a transit search", () => {
    const mode = travelMapDisplayMode(planWithItinerary, "itinerary-1");
    expect(mode).toBe("primary");

    const html = renderToStaticMarkup(
      createElement(RouteContextFallback, {
        summary: buildRouteContextSummary(planWithItinerary),
        plan: planWithItinerary,
      }),
    );

    expect(html).not.toContain("Ruteoppsummering");
    expect(html).not.toContain("Tekstfallback");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify failure if old copy still leaks**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "traffic map route proof"
```

Expected: fail if old diagnostic copy appears, pass if current code already satisfies part of the requirement. If it passes, continue; this test still pins the desired behavior.

- [ ] **Step 3: Simplify the primary map section copy**

In `TrafficMapPage.tsx`, find the primary map section:

```tsx
<section
  className="traffic-primary-map-section"
  aria-labelledby="traffic-primary-map-heading"
>
```

Change the header to:

```tsx
<header className="traffic-primary-map-header">
  <p className="label">Kart for reisen</p>
  <h2 id="traffic-primary-map-heading">Kartet viser ruten</h2>
  <p>Stopp, gangetapper og trafikkpunkt vises her. Varsler uten kartpunkt ligger under reisen.</p>
</header>
```

- [ ] **Step 4: Add explicit boarding and destination map markers**

In `TravelPlanLayer`, add a helper near `selectedItineraryPositions`:

```ts
function selectedBoardingLegForMap(
  plan?: TravelPlanPayload,
  selectedItineraryId?: string,
): TravelPlanLeg | undefined {
  return firstTransitLeg(selectedItineraryForPlan(plan, selectedItineraryId));
}
```

Inside `TravelPlanLayer`, after `const selectedItinerary = ...`, add:

```ts
const boardingLeg = selectedBoardingLegForMap(plan, selectedItineraryId);
const boardingPosition = latLngFromGeoJsonPosition(boardingLeg?.from.coordinate);
```

Then render this marker before the destination marker:

```tsx
{
  boardingPosition ? (
    <CircleMarker
      center={boardingPosition}
      radius={8}
      pathOptions={{ color: "#19549a", fillOpacity: 0.9 }}
    >
      <Popup>
        <article className="traffic-popup">
          <strong>
            {boardingLeg?.publicCode
              ? `Ta ${modeLabel(boardingLeg.mode)} ${boardingLeg.publicCode}`
              : "Start kollektivreisen"}
          </strong>
          <p>{boardingLeg?.from.stopName ?? boardingLeg?.from.name}</p>
        </article>
      </Popup>
    </CircleMarker>
  ) : null;
}
```

- [ ] **Step 5: Add e2e map proof assertions**

In `e2e/app.spec.ts`, inside `traffic map travel planner shows route-specific traffic and public transport advice`, replace the existing primary-map text assertion with:

```ts
await expect(page.locator(".traffic-primary-map-section")).toContainText("Kartet viser ruten");
await expect(page.locator(".traffic-primary-map-section")).toContainText("Stopp, gangetapper");
await expect(page.locator("details.traffic-map-disclosure")).toHaveCount(0);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "traffic map route proof"
npm run test:e2e -- --grep "traffic map travel planner shows route-specific traffic"
```

Expected: both pass on desktop and mobile e2e projects.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts e2e/app.spec.ts
git commit -m "feat: make traffic map the route proof"
```

---

### Task 4: Demote Sloppy Context Panels

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`
- Modify: `e2e/app.spec.ts`

**Interfaces:**

- Consumes: `buildRouteContextSummary(plan)` and `buildJourneyTravellerAnswer(plan)`.
- Produces: compact context disclosure only for non-map line alerts and explicit user-opened detail.

- [ ] **Step 1: Add failing tests that map-point context is not repeated above the map**

In `apps/frontend/src/pages/TrafficMapPage.test.ts`, add:

```ts
describe("route context demotion", () => {
  it("does not repeat map-point traffic as bulky text before the map", () => {
    const planWithMapPoint: TravelPlanPayload = {
      ...planWithItinerary,
      trafficImpacts: [
        {
          event: {
            id: "roadwork-1",
            source: "vegvesen_traffic_info",
            sourceEventId: "roadwork-1",
            category: "roadworks",
            severity: "medium",
            state: "active",
            title: "Vegarbeid ved Bakklandet",
            updatedAt: "2026-06-01T09:00:00.000Z",
            geometry: { type: "Point", coordinates: [10.4, 63.43] },
          },
          distanceMeters: 121,
          severity: "medium",
          summary: "121 m fra foreslått rute.",
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(TravelPlanCard, {
        plan: planWithMapPoint,
        loading: false,
        routeChoiceModel: buildRouteChoiceModel({
          plan: planWithMapPoint,
          selectedItineraryId: "itinerary-1",
        }),
        selectedItineraryId: "itinerary-1",
        onSelectItinerary: () => undefined,
      }),
    );

    expect(html).not.toContain("Vegarbeid ved Bakklandet");
    expect(html).not.toContain("Kartpunkter langs valgt rute");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails if context still leaks**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "route context demotion"
```

Expected: fail if `JourneyContextChips` or the answer card still repeats map-point traffic in the first answer area.

- [ ] **Step 3: Replace top-level `JourneyContextChips` with a compact non-map disclosure**

In `TrafficMapPage.tsx`, find:

```tsx
{
  travelPlan ? (
    <JourneyContextChips
      plan={travelPlan}
      routeContextSummary={routeContextSummary}
      selectedEventId={selectedEventId}
      onFocusItem={handleRouteContextFocus}
    />
  ) : null;
}
```

Replace it with:

```tsx
{
  travelPlan && routeContextSummary.items.some((item) => !item.focusable) ? (
    <details className="traffic-support-disclosure traffic-line-alert-disclosure">
      <summary>Varsler uten kartpunkt</summary>
      <RouteContextFallback
        summary={{
          ...routeContextSummary,
          items: routeContextSummary.items.filter((item) => !item.focusable),
          count: routeContextSummary.items.filter((item) => !item.focusable).length,
          mapPointCount: 0,
          heading: routeContextSummary.items.filter((item) => !item.focusable).length
            ? `${routeContextSummary.items.filter((item) => !item.focusable).length} linjevarsel`
            : "Ingen linjevarsler",
          detail: "Varsler uten kartpunkt vises her. Trafikkpunkt med plassering vises på kartet.",
        }}
        plan={travelPlan}
        title="Varsler uten kartpunkt"
      />
    </details>
  ) : null;
}
```

Keep `JourneyContextChips` exported for any existing tests until all references are removed. Do not delete it in this task.

- [ ] **Step 4: Update e2e expectations**

In `e2e/app.spec.ts`, in the traffic planner test, replace:

```ts
await expect(page.getByLabel("Trafikk langs reisen")).toContainText("Veiarbeid på E6 ved Leangen");
await expect(page.getByLabel("Trafikk langs reisen")).toContainText("Forsinkelse på linje 3");
```

with:

```ts
await expect(page.getByLabel("Trafikk langs reisen")).toHaveCount(0);
await expect(page.locator(".traffic-primary-map-section")).toContainText("Kartet viser ruten");
await expect(page.getByText("Forsinkelse på linje 3")).toBeVisible();
```

If the line alert is hidden in a closed disclosure, open it first:

```ts
await openTrafficDisclosure(page, "Varsler uten kartpunkt");
await expect(page.getByText("Forsinkelse på linje 3")).toBeVisible();
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
npm test -- apps/frontend/src/pages/TrafficMapPage.test.ts -t "route context demotion|TravelPlanCard journey answer"
npm run test:e2e -- --grep "traffic map travel planner shows route-specific traffic"
```

Expected: pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/pages/TrafficMapPage.test.ts e2e/app.spec.ts
git commit -m "fix: demote traffic context text on trafikk"
```

---

### Task 5: Traveller-First Layout And Mobile Polish

**Files:**

- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pages/TrafficMapPage.test.ts`
- Modify: `e2e/app.spec.ts`

**Interfaces:**

- Consumes existing class names:
  - `.traffic-page-shell`
  - `.travel-planner-panel`
  - `.traffic-journey-answer`
  - `.traffic-primary-map-section`
  - `.traffic-support-disclosure`
- Produces a first viewport order: planner, answer, map, route steps, alternatives, then context.

- [ ] **Step 1: Add e2e assertions for first-viewport order**

In `e2e/app.spec.ts`, update `mobile traffic page prioritizes travel planning before map summaries and filters` with these assertions after a successful route search:

```ts
const answerBox = page.locator(".traffic-journey-answer").first();
const routeMap = page.locator(".traffic-primary-map-section").first();
const trafficNow = page.getByText("Trafikkbildet nå", { exact: true });

await expect(answerBox).toBeVisible();
await expect(routeMap).toBeVisible();
await expect(trafficNow).toBeVisible();

const answerTop = await answerBox.boundingBox();
const mapTop = await routeMap.boundingBox();
const trafficTop = await trafficNow.boundingBox();

expect(answerTop?.y ?? 0).toBeLessThan(mapTop?.y ?? 0);
expect(mapTop?.y ?? 0).toBeLessThan(trafficTop?.y ?? 0);
```

- [ ] **Step 2: Run the mobile e2e test and verify failure if layout is wrong**

Run:

```bash
npm run test:e2e -- --grep "mobile traffic page prioritizes travel planning"
```

Expected: fail if `Trafikkbildet nå`, departure boards, or disclosures appear before the journey answer/map.

- [ ] **Step 3: Add CSS for the new answer card and route steps**

In `apps/frontend/src/styles.css`, add near the existing `.travel-plan-card` styles:

```css
.traffic-journey-answer {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-left: 5px solid var(--green);
  background: var(--page);
}

.traffic-journey-answer-watch {
  border-left-color: var(--rust);
}

.traffic-journey-answer-warning {
  border-left-color: var(--red);
}

.traffic-journey-answer-header {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.traffic-journey-answer-header h2 {
  margin: 0;
  font: 34px/1.05 var(--serif);
}

.traffic-journey-answer-header p {
  margin: 0;
  color: var(--muted);
  line-height: 1.4;
}

.traffic-journey-answer-meta {
  color: var(--ink) !important;
  font-weight: 800;
}

.traffic-journey-answer-handoff {
  width: fit-content;
  color: var(--blue);
  font-weight: 850;
}

.traffic-journey-steps {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--line);
  background: #fff;
}

.traffic-journey-step {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.traffic-journey-step:last-child {
  border-bottom: 0;
}

.traffic-journey-step-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: #fff;
  background: var(--green);
  font-weight: 900;
}

.traffic-journey-step-walk .traffic-journey-step-icon {
  background: var(--muted);
}

.traffic-journey-step strong,
.traffic-journey-step span,
.traffic-journey-step small {
  display: block;
  min-width: 0;
}

.traffic-journey-step span,
.traffic-journey-step small {
  color: var(--muted);
}

.traffic-journey-alternatives {
  display: grid;
  gap: 8px;
}

.traffic-journey-alternatives h3 {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.traffic-journey-alternatives > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.traffic-journey-alternatives button {
  display: grid;
  gap: 2px;
  min-width: 130px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.traffic-journey-alternatives button.selected {
  border-color: color-mix(in srgb, var(--green) 48%, var(--line));
  background: var(--green-soft);
}
```

- [ ] **Step 4: Tighten mobile order and map sizing**

Inside the existing mobile media block in `styles.css`, ensure these rules exist:

```css
.travel-planner-panel {
  order: 1;
}

.traffic-primary-map-section {
  order: 2;
  padding: 12px;
}

.traffic-primary-map-section .traffic-workspace {
  min-height: 360px;
}

.traffic-support-disclosure {
  order: 5;
}

.traffic-data-disclosure {
  order: 7;
}

.traffic-bottom-panel {
  order: 8;
}

.traffic-journey-answer {
  padding: 14px;
}

.traffic-journey-answer-header h2 {
  font-size: 30px;
}

.traffic-journey-alternatives > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
```

- [ ] **Step 5: Run focused browser and style-sensitive checks**

Run:

```bash
npm run test:e2e -- --grep "mobile traffic page prioritizes travel planning|traffic map travel planner shows route-specific traffic|trafikk shows walking route"
npm run lint
```

Expected: e2e passes on mobile and desktop projects; lint passes.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/frontend/src/styles.css e2e/app.spec.ts apps/frontend/src/pages/TrafficMapPage.test.ts
git commit -m "style: polish traveller-first traffic layout"
```

---

### Task 6: Full Verification, Visual Review, And Release Prep

**Files:**

- Modify: `docs/superpowers/plans/2026-07-09-trafikk-traveller-first-ui-polish.md` only if implementation discoveries require a plan note.
- No production code changes in this task unless verification reveals a bug; if so, create a focused fix commit before continuing.

**Interfaces:**

- Consumes the commits from Tasks 1-5.
- Produces release-ready branch evidence.

- [ ] **Step 1: Run the standard local gates**

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

- `format:check`: no formatting errors.
- `lint`: no ESLint errors.
- `typecheck`: all workspaces pass.
- `npm test`: all Vitest files pass.
- `build`: shared, frontend, server, worker build.
- `test:e2e`: Playwright passes with only existing intentional skips.
- `audit`: zero high-severity production vulnerabilities.
- `git diff --check`: no whitespace errors.

- [ ] **Step 2: Start local dev server for visual review**

Run:

```bash
npm run dev
```

Expected: frontend and server start locally. If the default port is occupied, use the URL printed by Vite.

- [ ] **Step 3: Visual smoke the three critical `/trafikk` states**

Use Playwright or the browser plugin to check:

1. Transit route:
   - Origin: `Munkegata`
   - Destination: `Lade`
   - Expected: first answer tells which bus/tram to take; map is directly below answer.
2. Walking fallback:
   - Use fixture/e2e state if live Entur returns transit.
   - Expected: first answer says walking duration and route; no bus instruction appears.
3. No concrete route:
   - Simulate Entur unavailable fixture.
   - Expected: first answer says to check AtB/Entur and still shows road/context support without a blank page.

Capture screenshots into Playwright output or temporary files, inspect them, then delete manual temp files.

- [ ] **Step 4: Confirm git scope**

Run:

```bash
git status -sb
git diff --stat
git diff --name-only
```

Expected: only intended tracked files from this plan are modified. Unrelated untracked local artifacts stay unstaged.

- [ ] **Step 5: Commit final verification note if needed**

If no code changes were made during verification, do not create an empty commit. If a small fix was required, commit it:

```bash
git add <fixed-files>
git commit -m "fix: tighten traffic traveller UI"
```

- [ ] **Step 6: Prepare yeet handoff**

Use this PR body:

```markdown
## Summary

- Makes `/trafikk` answer the traveller question first with concrete bus/tram/walk instructions.
- Moves route proof into the map and demotes traffic context that already has map geometry.
- Keeps AtB/Entur as final operator authority while preserving Nytt disruption context.

## Verification

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `npm audit --omit=dev --audit-level=high`
- `git diff --check`

## Notes

- No new source/evidence model.
- No journey data promoted to situations or `source_items`.
```

---

## Autonomous `/goal` Prompt

Use this if running the work autonomously:

```text
/goal Improve Nytt Trondheim `/trafikk` so it behaves like a traveller-first journey tool: the first result must give a concrete travel instruction, the map must sit directly under the answer as route proof, walking must be shown as the primary route when Entur has no current trip, and traffic/roadwork/service-alert context must be demoted into map markers or compact disclosures. Follow `/Users/reidar/Projectos/Nytt/docs/superpowers/plans/2026-07-09-trafikk-traveller-first-ui-polish.md` task by task. Preserve Entur/AtB authority, do not create situations/source_items from traveller data, keep Bokmål copy, run the full release gates, and stop before merge/deploy unless explicitly told to yeet.
```

---

## Self-Review

- Spec coverage: The plan covers the requested experience: clear primary answer, map as proof, walking fallback, less context slop, mobile order, and tests.
- Placeholder scan: The plan contains no unresolved placeholders or open-ended implementation steps.
- Type consistency: New model types are defined in Task 1 and consumed by Task 2. Existing `TravelPlanPayload`, `TravelPlanItinerary`, `TravelPlanLeg`, `travelMapDisplayMode`, and `buildRouteContextSummary` names match current code.
- Scope check: This is one frontend-focused product slice. Server changes are explicitly out of scope unless an implementation test proves a missing payload field.
