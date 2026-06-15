# Trafikkdata Contract

## Scope

- Source: `trafikkdata`
- Upstream type: Statens vegvesen traffic counter snapshots.
- Purpose: operational traffic-volume context and anomaly signals.

## Boundaries

- May write `traffic_counter_snapshots` and source health only.
- Must not create `source_items`, `official_events`, `traffic_map_events` or situations.
- Must not infer an incident from missing, delayed or anomalous counter values alone.

## Identity and Retention

- Durable upstream identity: traffic point ID plus measurement interval.
- Raw payload retention: normalized counter snapshot only unless a future explicit contract revision allows raw public payload retention.
- Provenance: `preparedness_context`.

## Verification

- Tests must cover poll throttling, stale/failure source health and non-promotion into incident evidence.
