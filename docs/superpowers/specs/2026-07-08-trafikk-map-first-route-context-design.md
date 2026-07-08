# /trafikk Map-First Route Context Design

## Summary

Post-search `/trafikk` should stop repeating route-context information as large text boxes.
The page already has a map, so spatial route impacts should primarily live on the selected-route
map. The main result should answer what the traveller should do; the map should show where route
risks are; one compact fallback list should remain for accessibility, mobile scanning, map failure,
and copy/paste.

## Approved Direction

Use the map-first with compact fallback approach:

- `Reiseråd nå` stays short and human: "dra nå", "sjekk før avreise", "velg annen rute", etc.
- Location-heavy road and public-transport context becomes numbered map markers or highlighted
  route-adjacent items.
- The visible card copy says how many route-context points matter and whether any change the
  recommendation.
- A single collapsed text disclosure remains: for example, `4 kartpunkter langs valgt rute`.
- Full text cards appear only when an item changes the recommendation or blocks the selected
  route.

## Product Rules

- If an item has coordinates or route geometry, its primary surface is the map.
- If an item does not change the recommendation, it must not be a full-width card in the main
  result.
- If an item changes the recommendation, it can appear in the decision copy and still be linked to a
  map marker.
- The fallback list must be compact, collapsed by default, keyboard-accessible, and clear when the
  map is not loaded.
- Copy remains Bokmål and restrained.

## Technical Boundaries

- Reuse the existing `TravelPlanPayload.trafficImpacts` and
  `TravelPlanPayload.publicTransportSuggestions` fields.
- Reuse existing map layers where possible: `TrafficLayer`, `PublicTransportLayer`,
  `TravelPlanLayer`, and selection state in `TrafficMapPage.tsx`.
- No new database tables, providers, `source_items`, situation evidence, or Entur/AtB upstream
  calls.
- Entur, DATEX, Vegvesen, and public-transport context remain traveller context, not editorial
  provenance or situation evidence.

## Success Criteria

- After route search, route-context road names are no longer repeated as large text boxes above and
  below the map.
- The selected-route map visibly carries route-impact markers and is easy to open after search.
- The result panel shows a short count/severity summary and a collapsed fallback list.
- Clicking a fallback route-context row focuses the matching map item when possible.
- Mobile order remains traveller-first: planner, advice, route choices, selected route, departure
  context, traffic picture, map, then data/source fallback.
- Existing route-search, departure-board, traffic-map, and evidence/provenance behavior remains
  stable.

## Non-Goals

- Do not redesign the whole traffic page again.
- Do not add custom manual map drawing or new GIS persistence.
- Do not change route-ranking or Entur comparison logic.
- Do not remove accessible text alternatives.
