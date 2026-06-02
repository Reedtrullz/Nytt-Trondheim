# Source Contract: Trondheim Notify / Resident Notifications

## Provider

- Name: Trondheim kommune resident notifications via Gemini Notify
- Candidate Source ID: `trondheim_notify` (not yet added to shared schemas)
- Authority level: `official` if terms/technical contract pass
- Candidate endpoint: `https://notify.geminisuite.com/trondheimvarsling/public`
- Auth: none observed
- Method/content type: observed `GET` returning HTML
- User-Agent: `NyttTrondheim/0.1 kontakt@reidar.tech`
- Rate/backoff: unknown; blocker before production polling.
- Conditional fetch support: unknown; blocker before production polling.
- Legal/robots/licensing notes: blocker before production collection.

## Identity and lifecycle

- Durable upstream identity: unknown; parser spike must identify a stable notice id or stable URL/time/location tuple.
- Version/revision/change marker: unknown.
- Duplicate snapshot behavior: unknown until identity is known.
- Disappearance behavior: unknown; successful snapshot disappearance must not imply resolution until feed completeness is proven.
- Open-ended/stale policy: unknown; parser spike must define treatment for ongoing water outages and resolved boil-water notices.

## Retention

- Retained fields: only after parser spike; likely title/summary, area/location text, valid-from/to, notice type, source URL.
- Explicitly not retained: no private resident targeting data, phone-number-specific data, or full hidden application state.
- Raw payload retention: only if public and legally allowed; preserve minimal raw notice object for provenance.
- Normalized payload shape: blocked until real HTML/API shape is known.

## Product boundaries

- May create `source_items`: only after a parser/source contract review.
- May create `official_events`: possible for active water outage / boil-water / service disruption records after parser proof.
- May create `traffic_map_events`: no in first parser spike.
- May create `situations`: only under a later explicit severe-service-disruption promotion rule.
- Promotion rules: none in this contract-only phase.
- Explicit no-promotion rules: ordinary planned maintenance, private-network work, vague notices, and missing-warning apology notices are context only.
- Geometry semantics: no geometry unless public source gives explicit address/area or a later geocoder maps a named place as reporting/context estimate.

## Source health and verification

- Health source ID: `trondheim_notify` only after shared schemas are extended.
- OK detail: not defined yet.
- Degraded detail: not defined yet.
- Production SQL checks: not applicable until implementation plan exists.
- Live endpoint verification command:
  - `curl -I -A 'NyttTrondheim/0.1 kontakt@reidar.tech' 'https://notify.geminisuite.com/trondheimvarsling/public'`

## Required spike before code

1. Identify whether the public HTML embeds a stable JSON/API endpoint.
2. Check robots/terms.
3. Capture a minimal fixture with one planned outage, one acute outage, one boil advisory, and one resolved notice.
4. Define identity, validity, disappearance, and stale semantics.
5. Add source-health-only probe before production ingestion.
