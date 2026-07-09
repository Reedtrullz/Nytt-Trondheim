# /trafikk Mode-Aware Travel Answer Design

## Summary

`/trafikk` should answer the traveller's actual question before it explains road context. If there
is a usable bus, tram, train, or boat journey, the first result should show that journey: line,
boarding stop, departure, arrival, and map. If there is no usable public-transport journey for the
selected time, the page should not lead with roadwork counts. It should switch modes and show a
walking route: how long it takes, where to walk, and what to watch along the way.

This is a follow-up to `2026-07-08-trafikk-map-first-route-context-design.md`. That spec moved route
context toward the map. This spec defines which travel mode owns the top answer.

## Design Goal

After a route search, the first screen should make one of these answers obvious:

- Take this public-transport option now.
- Walk this route instead.
- Leave later because there is no useful trip now.
- Planning failed; use AtB/Entur while Nytt shows only local context.

Distance, OSRM route details, roadworks, DATEX points, and generic context are supporting evidence.
They must not become the primary answer unless they materially change the travel decision.

## Approaches Considered

### Approach A: Map-First Fallback Only

When Entur returns no journey, immediately show the route map and nearby traffic points. This makes
spatial context visible, but it still does not answer whether the user should walk, wait, or try
another mode.

### Approach B: Next Transit Window First

When Entur returns no journey, search later presets and lead with the next available bus/tram/train
option. This is helpful for planning, but it fails the immediate traveller need when the answer is
"just walk there".

### Approach C: Mode-Aware Answer First

Rank the result by usable travel mode. If transit exists, show transit first. If transit does not
exist, show walking first. If walking is impractical or the route service fails, show a clear failure
state and hand off to AtB/Entur. This is the recommended approach because it answers the user's
question in the fewest steps while still keeping the map and traffic context available.

## Approved Direction

Use the mode-aware answer-first approach:

- Public transport is primary only when Entur returns at least one usable itinerary for the selected
  time.
- Walking becomes the primary result when no usable public-transport itinerary exists and OSRM can
  produce a route.
- A later public-transport option may appear as secondary context, not as the main answer, when the
  selected time is a dead transit window.
- Roadworks and traffic points appear as route context on the map and in one compact fallback
  disclosure.
- The map must be visible near the first result after a search, especially when the page recommends
  walking.

## Product Rules

- The top card title must describe the recommended action, not the data source:
  - `Ta buss 2 fra Prinsens gate`
  - `Gå til Lade gård`
  - `Vent til i morgen 07:40`
  - `Sjekk AtB/Entur`
- The top card must include mode-specific facts:
  - Transit: line, boarding stop, departure time, arrival time, transfer count, walk time.
  - Walking: walking duration, distance, origin, destination, and route map.
  - Failure: what failed and the external handoff.
- `0 reiseforslag` must not appear as the key result without a replacement answer.
- Route-context counts like `8 kartpunkter` or `8 vegmeldinger` can appear only as secondary chips or
  collapsed details.
- If walking is recommended, roadworks along the corridor should be described as "langs gangruta",
  not as generic traffic audit output.
- If the user selected `Nå` during a late-night dead window, the page should say that directly:
  `Ingen kollektivreise akkurat nå. Gangruta tar ca. 42 min.`
- Bokmål copy should stay practical and low-drama.

## Proposed Result Hierarchy

### Transit Available

1. Compact planner form.
2. `Reiseråd nå`: selected transit journey with line and boarding stop.
3. Selected journey timeline.
4. Map with route, stops, vehicle/service-alert context, and route-adjacent traffic points.
5. Collapsed context: route points, source data, saved routes, comparisons.

### No Transit Available, Walking Available

1. Compact planner form.
2. `Reiseråd nå`: walking answer with duration and distance.
3. Map with walking route visible without opening a disclosure.
4. Secondary note: next useful transit option if a cheap comparison already found one.
5. Collapsed context: roadworks/traffic points along the walking route, source data, saved routes.

### Transit/Route Planner Failure

1. Compact planner form.
2. Failure card with AtB/Entur handoff.
3. Minimal map if coordinates are known.
4. Collapsed source/dependency state.

## Data Flow

- Keep the existing `/api/map/travel-plan` contract as the main response.
- Additive shared fields are acceptable if needed:
  - `primaryMode`: `transit | walk | fallback`
  - `walkingRoute`: distance, duration, polyline/geometry reference, and route detail.
  - `nextTransitOption`: optional lightweight summary for a later usable Entur journey.
- Do not create source items, situations, or editorial evidence from walking fallback data.
- Keep Entur as public-transport authority and OSRM as route-shape/duration context.
- If route geometry already exists for OSRM, reuse it for the walking map instead of adding another
  external dependency.

## UI Boundaries

- This should not re-expand all the route-context panels that were just collapsed.
- The map should move up for post-search states, but the planner form must remain easy to edit.
- On mobile, the order should be:
  1. planner form
  2. answer card
  3. map
  4. selected transit/walking details
  5. collapsed context
- On desktop, the result can use a two-column layout only if both columns are filled with meaningful
  content. Avoid a busy right column with an empty left column or vice versa.

## Error Handling

- Entur empty response is not an error. It is a no-transit state and should fall through to walking.
- Entur timeout/upstream failure is a degraded state. It can still show walking if OSRM succeeds,
  but it must say transit could not be checked.
- OSRM failure with Entur empty response becomes a clear handoff state.
- Late-night no-transit results should be fast. The UI should not wait on broad route-context fan-out
  before showing the walking answer.

## Tests

- Shared/server:
  - No Entur itineraries plus OSRM route returns a walking primary answer.
  - Entur itineraries return transit as the primary answer.
  - Entur failure plus OSRM route returns degraded walking with a clear warning.
  - Entur empty plus OSRM failure returns an AtB/Entur handoff state.
  - Road/context points stay context-only and do not override the primary mode.
- Frontend:
  - No-transit state renders `Gå ...` with duration and route map above collapsed context.
  - Transit state renders line, boarding stop, departure, and selected journey before context.
  - `0 reiseforslag` is not the most prominent text when walking is available.
  - Desktop and mobile have no horizontal overflow.
  - Map remains visible and usable in the walking fallback state.
- E2E:
  - Munkegata to Lade gård at a dead transit time shows a walking recommendation and map.
  - Munkegata to Lade gård at a morning preset shows a bus recommendation.

## Non-Goals

- Do not build a full AtB clone or ticketing flow.
- Do not add persisted user commutes or server-side location storage.
- Do not infer traffic incidents from travel planning.
- Do not redesign `/trafikk` source-health, departure-board, or traffic-map internals beyond what
  is needed to make the top travel answer coherent.
- Do not remove the AtB/Entur handoff copy.
