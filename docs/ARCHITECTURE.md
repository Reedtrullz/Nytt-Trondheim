# Architecture

## Boundaries

`frontend` consumes authenticated API resources only. `server` owns identity, persistence, exports and access control. `worker` is the only scheduled ingestion/analysis process. `shared` defines API-safe types and validation.

PostgreSQL/PostGIS stores articles, situations, workspace content and geometry. Production attachments are stored on a persisted Docker volume with metadata and SHA-256 checksums in PostgreSQL.

Normalized incident records are authoritative: situation/article associations, evidence, timeline entries, official events, AI processing runs, saved situations and export manifests are stored separately from the summary payload returned for the dashboard.

## Provenance Model

Map features carry one required provenance classification:

- `official`: explicitly published official coordinates or geometries.
- `reporting_estimate`: a place or bounded area extracted from public reporting; never treated as operational truth.
- `preparedness_context`: optional DSB infrastructure, such as fire stations or a 110-sentral; not evidence of active response.
- `private_annotation`: owner drawings and notes; never exposed as public evidence.

The API ignores any client attempt to create an annotation under another provenance class.

Inbound public records enter the `source_items` ledger before editorial linking or verification. `source_items` stores provider, kind, durable upstream identity, fetched time, raw/normalized payload, capture hash, optional geo hint and reliability tier. `situation_source_items` links those records to situations without making verification claims by itself.

## AI Boundary

The worker defines a provider interface and initially implements DeepSeek-based structured clustering only when `DEEPSEEK_API_KEY` is configured. Only public feed excerpts and public official data may enter that process. Private annotations, attachments, tasks and notes are excluded.

AI clusters are accepted only after each cited snippet matches an input excerpt and at least two independent sources remain. Deterministic multi-source detection remains available when AI is disabled or degraded.

Incident identity is lifecycle-aware: an open case may receive timely matching reports or a later official closure, while resolved or dismissed history cannot absorb a later same-place event. A later qualifying event receives a distinct activation identity and preserved provenance.

## Situation Activation

Automatic Situation Room activation requires an explicit incident type and a shared specific place or event signature; broad references such as `Trondheim` alone never activate a situation. New incidents require two independent sources within 12 hours. Later matching reporting or municipal updates may update an already activated signature without reopening that activation rule.

High-impact official DATEX traffic records are the explicit exception to the two-independent-source activation rule. They may create active traffic situations with `activationBasis.rule="official_source"`, `sourceIds=["datex"]`, `officialSource="datex"`, and `officialEventId` set. DATEX situation reuse is limited to existing DATEX-owned situations so official traffic evidence cannot accidentally attach to a news-created case. Low-impact/planned roadworks remain `official_events` only and do not activate the main situation feed.

DATEX TravelTime is intentionally outside situation activation. Current corridor rows are persisted in `datex_travel_times` for source health and Drift traffic-pulse display, separate from `official_events` and `situations`. TravelTime values describe measured or estimated travel time, free-flow comparison and delay only; the worker must not infer incident cause, create `OfficialEvent` rows, promote official traffic events, or create/update `Situation` rows from TravelTime alone.

DATEX traffic events stay separate from MET/NVE warning context: weather and hazard warnings can enrich or contextualize a situation, but they are not fed into DATEX promotion logic. Conversely, DATEX records can confirm road state but are not treated as broader emergency confirmation outside the traffic layer without corroborating sources.

Owner-dismissed false positives retain evidence, timelines and activation audit records under the `dismissed` lifecycle state, but are excluded from current-situation surfaces.
