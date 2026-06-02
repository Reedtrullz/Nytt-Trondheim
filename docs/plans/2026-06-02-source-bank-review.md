# Nytt Trondheim source-bank review — 2026-06-02

This note reviews an external source-bank analysis for Nytt Trondheim and turns it into implementation guidance. It is not itself proof that a source may legally or technically be ingested; every new adapter still needs a source contract and live probe.

## Bottom line

The analysis is useful, but its main recommendation is already Nytt's core architecture: do not build a pure RSS reader. Nytt already separates:

- editorial signals (`nrk`, `adressa`, `vg`, `dagbladet`, `trondheim_kommune` articles);
- official incident/event sources (`datex`, `politiloggen`);
- warning context (`met`, `nve`);
- operations/context telemetry (`datex_travel_time`, `datex_weather`, `datex_cctv`, `trafikkdata`, `entur_vehicle_positions`);
- official public-transport alerts (`entur_service_alerts`);
- reporting estimates and private annotations.

The useful new work is not “add everything.” It is to expand the source-contract backlog, improve national-feed relevance filters, and add only sources whose authority and legal/technical boundaries are explicit.

## What was already covered

| Suggested source/theme        | Nytt status                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| NRK Trøndelag                 | Already RSS core source.                                                                                                                              |
| Adresseavisen                 | Already RSS core source; continue to keep excerpt/link-only retention.                                                                                |
| VG / Dagbladet national feeds | Already collected with Trondheim/Trøndelag relevance filtering.                                                                                       |
| Trondheim kommune Aktuelt     | Already HTML collector.                                                                                                                               |
| MET MetAlerts                 | Already official warning context via RSS + CAP. Verified public endpoint returned HTTP 200.                                                           |
| NVE/Varsom flood/landslide    | Already official textual warning context for Trondheim/Trøndelag. Verified public endpoints returned HTTP 200.                                        |
| DATEX / Vegvesen              | Already central traffic official/context stack.                                                                                                       |
| Entur/AtB                     | Already Entur vehicles and ATB service alerts. Entur vehicle endpoint correctly requires POST GraphQL; GET probe returned 405 as expected.            |
| Kartverket Stedsnavn          | Already geocoding concept in docs; current official API is `https://api.kartverket.no/stedsnavn/v1`, with old `ws.geonorge.no` proxy still available. |
| Politiloggen                  | Already public API adapter. Verified Trondheim message-thread probe returned HTTP 200.                                                                |

## Useful immediate code change implemented

The pasted analysis exposed that Nytt's national-feed geofilter was too narrow compared with the actual local-interest surface.

Implemented on branch `review/nytt-source-bank`:

- Expanded `apps/worker/src/classify.ts` with high-signal Trondheim terms:
  - NTNU, SINTEF, Gløshaugen, Dragvoll, St. Olavs, Samfundet, Rosenborg/Lerkendal, Trondheim S, Omkjøringsvegen, Stavne-Leangen and more districts.
- Expanded regional terms:
  - AtB, Metrobuss, Værnes, Dovrebanen, Nordlandsbanen, Meråkerbanen, Trønderbanen, Rørosbanen, Fosen, Hitra/Frøya, Gauldalen, Innherred, Namdalen, Levanger, Verdal, Steinkjer, Namsos, Røros, Skaun and more.
- Kept overbroad road-number-only matches out of scope: e.g. `E6 stengt etter ulykke i Gudbrandsdalen` still does not pass `detectScope` without a local/regional anchor.
- Added display-label mapping for acronyms and institutions (`NTNU`, `SINTEF`, `AtB`, `St. Olavs`, `Trondheim S`).
- Added regression tests in `apps/worker/test/classify.test.ts`.

Verification run:

```text
npm test -- apps/worker/test/classify.test.ts
# 18 tests passed

npm run lint
# exit 0

npm run typecheck
# exit 0
```

Full `npm test` was also run and failed in pre-existing/unrelated `apps/server/test/weather-preparedness.test.ts` assertions about MET/NVE risk aggregation. The classifier suite itself passed and the failures are not caused by this source-bank change.

## Source status and next candidates

### 1. Trondheim resident/service notifications (`trondheimvarsling` / Gemini Notify) — next candidate

Candidate URL:

- `https://notify.geminisuite.com/trondheimvarsling/public`

Raw probe returned HTTP 200 HTML. This appears useful for water outages, boil-water advisories, emergency shutoffs, missing notifications and operational municipal service disruptions.

Recommended handling:

- Treat as `official` municipal service-disruption context only after source contract.
- Do not scrape aggressively until terms/technical shape are checked.
- First implementation should be a live probe and parser spike, not production ingestion.
- Promotion rule: water outage / boil-water / service disruption can create official event or service-disruption context, but should not become emergency/situation feed noise unless severity and geography are clear.

### 2. Bane NOR traffic messages — delivered phase-1 rail context

Source URLs:

- `https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/`
- `https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true`

Raw RSS probe returned HTTP 200 `application/rss+xml`.

Implementation status: delivered and production-verified by `docs/plans/2026-06-02-source-contracts-and-rail-context.md`. Phase 1 is source-items/source-health only: production on 2026-06-02 showed `source_health.bane_nor=ok`, 11 `bane_nor | official_event` source items with raw payloads, and zero Bane NOR rows in `official_events`, `traffic_map_events` or `situations`.

Why useful:

- Dovrebanen, Nordlandsbanen, Meråkerbanen, Trønderbanen and Trondheim S closures have high practical value for Trondheim users.

Recommended handling:

- Keep `bane_nor` as a rail context source under the existing source contract.
- Store in `source_items` and `source_health`; a future transport-context table or map layer needs a separate plan.
- Do not auto-activate situations by default; future UI should show Bane NOR as mobility/traffic context and route impact only after a promotion/display plan is written.
- Prefer line/station matching: Trondheim S, Leangen, Støren, Hell, Steinkjer, Storlien, Dombås, Levanger, Åsen, Ronglan.

### 3. Trøndelag fylkeskommune — next candidate

Candidate page:

- `https://www.trondelagfylke.no/vare-tjenester/veg/fylkesveg/`

Extracted official page says the county owns more than 6,400 km of roads and links to fylkesveg news and project maps, while traffic messages are centralized through Vegvesen.

Recommended handling:

- Add as official/regional context, not a primary incident source.
- Best initial target: fylkesveg news and project map metadata for planned work context.
- Continue using Vegvesen/DATEX/TrafficInfo for operational road state.

### 4. NTNU / SINTEF / Universitetsavisa / St. Olavs / Helse Midt-Norge

Why useful:

- Trondheim-specific institutional importance: campus, research, student life, hospital operations, Helseplattformen and preparedness.

Recommended handling:

- Add as thematic editorial/context sources after source contracts.
- These should enrich local relevance and “what is happening in the city,” not override official incident confirmation.
- Helse sources need stricter privacy/sensitivity handling.

### 5. Statsforvalteren / DSB / Sivilforsvaret

Why useful:

- High-authority low-frequency preparedness and crisis context.

Recommended handling:

- Prefer explicit preparedness/warning/context layers.
- Do not create incidents unless there is an explicit current event and location/scope.

### 6. Regional local newspapers

Candidates from the analysis:

- Trønder-Avisa, Namdalsavisa, Innherred, Stjørdals-Nytt/Bladet, Malviknytt/Malvikbladet, Trønderbladet, Gaula, Opdalingen, Hitra-Frøya, Fosna-Folket, Arbeidets Rett.

Recommended handling:

- Good signal sources for Trøndelag depth, but not P0.
- Each needs robots/paywall/RSS/licensing review.
- Use excerpt/link-only retention if permitted.
- Keep them as `trusted_media`, not `official`.

### 7. SSB, Kartverket/Geonorge, data.norge.no

Recommended handling:

- Context, baselines and lookup data only.
- Useful for municipality metadata, population/context cards, boundaries, road/place metadata and long-term dashboards.
- Never use statistical/background data as evidence of a live incident.

## Source contract template for every new adapter

Before adding a source, write a short source contract with:

1. Provider name and authority level.
2. Endpoint(s), method, auth, rate/backoff, user-agent, caching and conditional requests.
3. Legal/robots/licensing notes.
4. Retained fields and explicit non-retained fields.
5. `SourceId`, `SourceItemKind`, reliability tier and source-health state.
6. Whether it can create:
   - article only;
   - `source_items` only;
   - `official_events`;
   - `traffic_map_events`;
   - `situations`.
7. Promotion rules and explicit no-promotion rules.
8. Geometry semantics: official geometry, reporting estimate, municipality-scope only, or none.
9. Staleness/freshness rules.
10. Fixtures and tests required before enabling production polling.

## Recommended implementation order

1. Keep trust-hardening first: incident correctness fixtures, DB/source invariants, observability, restore drill.
2. Land the relevance-filter expansion from this review.
3. Treat Bane NOR RSS as completed phase-1 rail context: no map layer or situation activation without a new explicit source-contract/promotion plan.
4. Create/maintain source contracts before any additional adapters; Trondheim Notify and Trøndelag fylkeskommune remain contract/spike candidates.
5. Spike Trondheim Notify only after inspecting the real HTML/API shape and terms.
6. Add institutional/thematic feeds only after the core trust model is boringly green.

## Do not change

- Do not collapse official, warning, telemetry and editorial feeds into one “news” stream.
- Do not let MET/NVE warnings confirm incidents; they remain context unless a future explicit rule is implemented.
- Do not let TrafficInfo roadworks or DATEX TravelTime create situations.
- Do not use Facebook/nabolagsgrupper as confirming sources. They can only be unverified tips if manually entered.
- Do not add paywalled/local newspapers as critical dependencies without a source contract.
