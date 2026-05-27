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

## AI Boundary

The worker defines a provider interface and initially implements DeepSeek-based structured clustering only when `DEEPSEEK_API_KEY` is configured. Only public feed excerpts and public official data may enter that process. Private annotations, attachments, tasks and notes are excluded.

AI clusters are accepted only after each cited snippet matches an input excerpt and at least two independent sources remain. Deterministic multi-source detection remains available when AI is disabled or degraded.

Incident identity is lifecycle-aware: an open case may receive timely matching reports or a later official closure, while resolved or dismissed history cannot absorb a later same-place event. A later qualifying event receives a distinct activation identity and preserved provenance.

## Situation Activation

Automatic Situation Room activation requires an explicit incident type and a shared specific place or event signature; broad references such as `Trondheim` alone never activate a situation. New incidents require two independent sources within 12 hours. Later matching reporting or municipal updates may update an already activated signature without reopening that activation rule.

Owner-dismissed false positives retain evidence, timelines and activation audit records under the `dismissed` lifecycle state, but are excluded from current-situation surfaces.
