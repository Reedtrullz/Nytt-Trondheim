# DSB OGC/WMS source contract

### Provider

- Name: Direktoratet for samfunnssikkerhet og beredskap OGC/WMS
- Source ID: `dsb`
- Authority level: `official`
- Endpoint(s): `https://ogc.dsb.no/wms.ashx?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`
- Auth: none
- Method and expected content type: `GET`; XML WMS capabilities document
- User-Agent: worker default fetch user agent
- Rate/backoff: probe only during worker official-source health checks; no high-frequency polling
- Conditional fetch support: not used
- Legal/robots/licensing notes: official DSB map capability endpoint; use only for availability/status context unless a separate data-layer contract is added

### Identity and lifecycle

- Durable upstream identity: DSB WMS service capabilities endpoint
- Version/revision/change marker: WMS capabilities document timestamp/version when exposed upstream
- Duplicate snapshot behavior: repeated successful probes update `source_health` only
- Disappearance behavior: failed/unreachable capabilities probe degrades `source_health`; it must not create incidents or imply a local emergency
- Open-ended/stale policy: stale/missing health is operations context for the dashboard

### Retention

- Retained fields: source health label, state, last checked/failure/next-poll timestamps and non-secret detail
- Explicitly not retained: WMS layer payloads, map tiles, emergency-alert content or raw XML response bodies
- Raw payload retention: none in this phase
- Normalized payload shape: none in this phase

### Product boundaries

- May create `source_items`: no
- May create `official_events`: no
- May create `traffic_map_events`: no
- May create `situations`: no
- Promotion rules: none in this phase
- Explicit no-promotion rules: DSB availability checks are preparedness context only and must not become incident evidence, situation activation, or supporting source-item links
- Geometry semantics: no geometry is persisted from this probe

### Source health and verification

- Health source ID: `dsb`
- OK detail: capabilities endpoint responded successfully
- Degraded detail: capabilities endpoint failed, timed out or returned a non-OK response
- Production SQL checks:

```sql
SELECT source, state, detail, last_checked_at
FROM source_health
WHERE source='dsb';

SELECT count(*) AS accidental_dsb_source_items
FROM source_items
WHERE provider='dsb';
```

- Live endpoint verification command:

```bash
curl -fsS 'https://ogc.dsb.no/wms.ashx?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0' >/dev/null
```
