# Source Contract: Trøndelag fylkeskommune

## Provider

- Name: Trøndelag fylkeskommune
- Candidate Source ID: `trondelag_fylke` (not yet added to shared schemas)
- Authority level: `official`
- Candidate pages:
  - `https://www.trondelagfylke.no/vare-tjenester/veg/fylkesveg/`
  - fylkesveg news/project-map links discovered from that page
- Auth: none for public pages
- Method/content type: HTML/page or future feed if found
- User-Agent: `NyttTrondheim/0.1 kontakt@reidar.tech`
- Rate/backoff: unknown until feed/API route is identified.
- Conditional fetch support: unknown.
- Legal/robots/licensing notes: verify before collection.

## Identity and lifecycle

- Durable upstream identity: unknown until the specific news/feed/project-map route is chosen.
- Version/revision/change marker: unknown.
- Duplicate snapshot behavior: unknown.
- Disappearance behavior: do not infer completion from disappearance until the upstream listing/window semantics are known.
- Open-ended/stale policy: planned-work items need explicit validity dates or a conservative stale policy before map/context use.

## Retention

- Retained fields: title, summary/excerpt, URL, published/updated time, project/road labels, validity if available.
- Explicitly not retained: full page scrape in first phase, unrelated county services unless a later contract adds them.
- Raw payload retention: preserve minimal raw public item/object if allowed.
- Normalized payload shape: blocked until source route is selected.

## Product boundaries

- May create `source_items`: yes after source contract review.
- May create `official_events`: maybe for explicit planned road/project notices only.
- May create `traffic_map_events`: no until map/project data shape is proven.
- May create `situations`: no.
- Promotion rules: none in contract-only phase.
- Explicit no-promotion rules: Vegvesen/DATEX/TrafficInfo remains the operational traffic authority. Fylkeskommunen is context/planned-work, not live traffic confirmation.
- Geometry semantics: no geometry until official project geometry or a tested geocoder/map source is used.

## Source health and verification

- Health source ID: `trondelag_fylke` only after shared schemas are extended.
- OK detail: not defined yet.
- Degraded detail: not defined yet.
- Production SQL checks: not applicable until implementation plan exists. If implemented later, require `situations` count `0` unless a separate promotion plan exists.
- Live endpoint verification command:
  - `curl -I -A 'NyttTrondheim/0.1 kontakt@reidar.tech' 'https://www.trondelagfylke.no/vare-tjenester/veg/fylkesveg/'`

## Required spike before code

1. Find whether fylkesveg news has RSS or stable structured metadata.
2. Check whether ArcGIS project map has permitted API access.
3. Define whether records belong in `source_items`, `traffic_map_events`, or docs only.
4. Add negative tests that fylkesveg project context does not activate situations.
