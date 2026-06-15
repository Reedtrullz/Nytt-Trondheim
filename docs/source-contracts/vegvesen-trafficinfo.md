# Vegvesen TrafficInfo Contract

## Scope

- Source: `vegvesen_traffic_info`
- Upstream type: Statens vegvesen TrafficInfo public messages.
- Purpose: roadwork, closure and traffic-message map context with source-item traceability.

## Boundaries

- May write `traffic_map_events` for active/planned map overlays.
- May mirror relevant public messages into `source_items` as official-event traceability.
- Must not automatically create or activate situations from every TrafficInfo row; promotion requires a future explicit activation rule.
- Expiration must follow successful snapshots; failed snapshots must not erase current map state.

## Identity and Retention

- Durable upstream identity: TrafficInfo message ID.
- Raw payload retention: public message fields needed to reconstruct source-item provenance.
- Provenance: `official` for public road message facts, surfaced as operational traffic context unless promoted by an explicit rule.

## Verification

- Tests must cover map-event upsert/expiration, source-item mirroring, stale source health and safe external links.
