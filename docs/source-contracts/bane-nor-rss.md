# Source Contract: Bane NOR RSS

## Provider

- Name: Bane NOR trafikkmeldinger
- Source ID: `bane_nor`
- Authority level: `official`
- Endpoint: `https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true`
- Auth: none
- Method/content type: `GET`, observed `application/rss+xml; charset=utf-8`
- User-Agent: `NyttTrondheim/0.1 kontakt@reidar.tech`
- Rate/backoff: max once per 10 minutes initially; degraded source health on fetch/parse failure.
- Conditional fetch support: none observed (`ETag` and `Last-Modified` absent in 2026-06-02 probe). Re-check before optimizing.
- Legal/robots/licensing notes: `robots.txt` allows `User-agent: *` for `/`; RSS endpoint is reachable and returns RSS XML; visible footer terms found during review were privacy/cookies pages only, with no general reuse restriction found. No full web page scrape in phase 1.
- Enablement decision: allowed for phase-1 summary/link RSS collection as of 2026-06-02.

## Identity and lifecycle

- Durable upstream identity: RSS `<guid>`.
- Version marker: first implementation uses `pubDate`, normalized title, normalized description, and parsed validity window in `captureHash`. Bane NOR did not expose revision metadata in the observed RSS.
- Duplicate snapshot behavior: same GUID/content hash is idempotent.
- Disappearance behavior: do not expire solely on RSS disappearance in the first implementation, because completeness/window semantics are not proven.
- Open-ended/stale policy: derive active/planned from parsed date phrases when possible. Past or unparseable validity windows remain context with `unknown` state in phase 1; do not expire solely on RSS disappearance because completeness/window semantics are not proven.

## Retention

- Retain: GUID, title, description excerpt, link, pubDate, matched rail terms, parsed validity if available.
- Do not retain: no full web page scrape in phase 1.
- Raw payload: preserve raw RSS item object in `source_items.rawPayload`.
- Normalized payload: preserve normalized rail context object.

## Product boundaries

- May create `source_items`: yes, provider `bane_nor`, kind `official_event`, reliability `official`.
- May create `official_events`: no in phase 1.
- May create `traffic_map_events`: no in phase 1.
- May create `situations`: no in phase 1.
- Promotion rules: none in phase 1.
- Explicit no-promotion rules: every Bane NOR RSS item is ledger/context only until a separate promotion plan is written.
- Geometry semantics: no geometry unless a future station/line geocoder plan is added; matched station/line names are textual context only.

## Source health and verification

- Health source ID: `bane_nor`
- OK detail: `{n} relevante Bane NOR trafikkmeldinger hentet`
- Degraded detail: `Bane NOR RSS feilet: ...`
- Production SQL checks:
  - `SELECT count(*) FROM source_items WHERE provider='bane_nor';`
  - `SELECT count(*) FROM official_events WHERE source='bane_nor';` must be `0` in this phase.
  - `SELECT count(*) FROM traffic_map_events WHERE source='bane_nor';` must be `0` in this phase.
  - `SELECT count(*) FROM situations WHERE payload::text ILIKE '%bane_nor%';` must be `0` in this phase.
- Live endpoint verification:
  - `curl -I -A 'NyttTrondheim/0.1 kontakt@reidar.tech' 'https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true'`
