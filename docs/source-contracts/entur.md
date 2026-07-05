# Entur Contract

## Scope

- Sources: `entur`, `entur_vehicle_positions`, `entur_service_alerts`
- Upstream type: Entur real-time vehicle GraphQL, service-alert situation feeds, request-time Journey Planner v3 trip search and departure boards, and request-time Geocoder v3 autocomplete for route inputs.
- Purpose: public transport context for traffic maps, selected situation workspaces and `/trafikk` journey planning.

## Boundaries

- `entur_vehicle_positions` may write `public_transport_vehicles` and source health only. It is high-churn telemetry and must not create source items, official events or situations.
- `entur_service_alerts` may write `public_transport_service_alerts`, source health and official-event source items for traceability.
- Journey Planner trip patterns are fetched on demand by `/api/map/travel-plan` with short timeout/cache/rate-limit/failure-backoff behavior. Journey Planner departure boards are fetched on demand by `/api/map/public-transport/departures` with short timeout/cache/rate-limit/failure-backoff behavior. Geocoder autocomplete is fetched on demand by `/api/map/travel-suggestions` with short timeout/cache/rate-limit/failure-backoff behavior. These request-time traveller lookups are not persisted and must not create source items, official events or situations.
- Public transport data may appear as preparedness context in maps and timelines, not as private evidence.

## Identity and Retention

- Durable upstream identity: Entur codespace plus vehicle ID, or service-alert situation number.
- Raw payload retention: minimal public alert payloads for source-item traceability; vehicle rows keep normalized operational state only.
- Provenance: `preparedness_context`.

## Verification

- Tests must cover vehicle telemetry separation, service-alert source items, source health, stale handling after snapshots and request-time Journey Planner no-route/routingErrors, cancellation, replacement transport, walk-only trips, sparse optional fields, malformed partial trips, departure-board delays/cancellations/notices, Geocoder autocomplete filtering/outage, cache and backoff behavior.
