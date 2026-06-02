# Nytt Source Contracts

Every new external source must have a source contract before adapter code.

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
