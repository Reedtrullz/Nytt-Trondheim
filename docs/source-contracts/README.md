# Nytt Source Contracts

Every new external source must have a source contract before adapter code.

Internal API/workspace features that only compose existing persisted Nytt data do not need a
source contract; document their data contract, privacy boundaries and verification plan in
`docs/ARCHITECTURE.md` or a dated `docs/plans/` note instead. If an internal feature starts
polling a new endpoint or writing a new provider/kind pair into `source_items`, add the source
contract first.

Source-health/provenance audit consoles are internal operations features under this rule when they
only read `source_health`, `collector_state`, `worker_cycle_metrics`, `source_items`,
`situation_source_items`, situations, evidence and related operational tables. They need a source
contract only if they add live upstream probes, persist new upstream records or introduce a new
`source_items.provider`/`kind` boundary.

Newsroom operations timelines follow the same rule when they only compose existing situation
timelines, source-item links, collector runs, source-health freshness, private workspace metadata
and map annotations. They must document privacy and telemetry boundaries in `docs/plans/`, but do
not need a source contract unless they start polling a new endpoint or writing a new provider/kind
boundary.

## Contract template

### Provider

- Name:
- Source ID:
- Authority level: `official` / `trusted_media` / `internal` / `unverified`
- Endpoint(s):
- Auth:
- Method and expected content type:
- User-Agent:
- Rate/backoff:
- Conditional fetch support:
- Legal/robots/licensing notes:

### Identity and lifecycle

- Durable upstream identity:
- Version/revision/change marker:
- Duplicate snapshot behavior:
- Disappearance behavior:
- Open-ended/stale policy:

### Retention

- Retained fields:
- Explicitly not retained:
- Raw payload retention:
- Normalized payload shape:

### Product boundaries

- May create `source_items`:
- May create `official_events`:
- May create `traffic_map_events`:
- May create `situations`:
- Promotion rules:
- Explicit no-promotion rules:
- Geometry semantics:

### Source health and verification

- Health source ID:
- OK detail:
- Degraded detail:
- Production SQL checks:
- Live endpoint verification command:
