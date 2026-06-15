# DATEX Suite Contract

## Scope

- Sources: `datex`, `datex_travel_time`, `datex_weather`, `datex_cctv`
- Upstream type: Statens vegvesen DATEX II v3.1 endpoints.
- Purpose: official road situations plus operational traffic context for Trondheim.

## Boundaries

- `datex` may create `official_events`, official traffic situations and official source items when DATEX situation records are relevant.
- `datex_travel_time` may write `datex_travel_times` and source health only. It must not create source items, official events or situations.
- `datex_weather` may write road-weather context and source health only.
- `datex_cctv` may write camera context and source health only.
- Travel time, weather and CCTV are telemetry/context and must not support situation activation.

## Identity and Retention

- Durable upstream identity: DATEX situation/record/predefined-location identifiers.
- Raw payload retention: public DATEX payload snippets only where needed for provenance; credentials are never logged, stored in payloads, exported or sent to the frontend.
- Provenance: `official` for qualifying DATEX situations; `preparedness_context` for telemetry/context.

## Verification

- Tests must prove credential redaction, endpoint allowlisting, telemetry separation and stale-row behavior.
- Migration checks must reject legacy telemetry evidence before adding stricter constraints.
