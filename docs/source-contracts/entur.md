# Entur Contract

## Scope

- Sources: `entur`, `entur_vehicle_positions`, `entur_service_alerts`
- Upstream type: Entur real-time vehicle GraphQL and service-alert situation feeds.
- Purpose: public transport context for traffic maps and selected situation workspaces.

## Boundaries

- `entur_vehicle_positions` may write `public_transport_vehicles` and source health only. It is high-churn telemetry and must not create source items, official events or situations.
- `entur_service_alerts` may write `public_transport_service_alerts`, source health and official-event source items for traceability.
- Public transport data may appear as preparedness context in maps and timelines, not as private evidence.

## Identity and Retention

- Durable upstream identity: Entur codespace plus vehicle ID, or service-alert situation number.
- Raw payload retention: minimal public alert payloads for source-item traceability; vehicle rows keep normalized operational state only.
- Provenance: `preparedness_context`.

## Verification

- Tests must cover vehicle telemetry separation, service-alert source items, source health and stale handling after snapshots.
