# DATEX Suite Contract

## Scope

- Sources: `datex`, `datex_travel_time`, `datex_weather`, `datex_cctv`
- Upstream type: Statens vegvesen DATEX II v3.1 endpoints.
- Purpose: official road situations plus operational traffic context for Trondheim.

## Boundaries

- `datex` may create `official_events` and official source items when DATEX situation records are relevant. It may create official traffic situations only for high-impact accidents, closures, congestion and road-blocking obstructions.
- Low-impact DATEX records, including planned roadworks and low-impact animal/environmental obstructions without closure or high severity, remain traffic context and must not activate a situation room.
- `datex_travel_time` may write latest-state rows in `datex_travel_times`, append/update observation rows in `datex_travel_time_history`, and source health only. It must not create source items, official events or situations.
- `datex_weather` may write road-weather context and source health only.
- `datex_cctv` may write camera context and source health only.
- Travel time, weather and CCTV are telemetry/context and must not support situation activation.

## Identity and Retention

- Durable upstream identity: DATEX situation/record/predefined-location identifiers; travel-time history uses predefined-location ID plus measurement window.
- Raw payload retention: public DATEX payload snippets only where needed for provenance; credentials are never logged, stored in payloads, exported or sent to the frontend.
- Provenance: `official` for qualifying DATEX situations; `preparedness_context` for telemetry/context.

## Verification

- Tests must prove credential redaction, endpoint allowlisting, telemetry separation, stale-row behavior and additive travel-time history writes.
- Migration checks must reject legacy telemetry evidence before adding stricter constraints.
