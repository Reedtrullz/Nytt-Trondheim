# Architecture

## Boundaries

`frontend` consumes authenticated API resources except the public access-request and email-login request endpoints. `server` owns identity, persistence, exports and access control. `worker` is the only scheduled ingestion/analysis process. `shared` defines API-safe types and validation.

PostgreSQL/PostGIS stores articles, situations, workspace content and geometry. Production attachments are stored on a persisted Docker volume with metadata and SHA-256 checksums in PostgreSQL.

Restricted-beta auth is administrative application data, not upstream evidence. `access_requests` stores request state (`unverified`, `pending`, `approved`, `rejected`) and email verification timestamps. `users` stores owner/viewer accounts, `user_identities` maps GitHub and email identities, and `auth_tokens` stores hashed one-time verification, invite and login tokens. None of these tables may create `source_items`, evidence, situations or coverage bundles.

GitHub remains the owner/admin login. Approved non-GitHub accounts are `viewer` users: they can read the main dashboard, situation, traffic and weather surfaces, but the Command Center, saved items, source audit/source linking, private workspace mutations, notes, drawings, attachments and exports require owner role.

The public City Pulse surface is rooted at `/`. The private Command Center surface is rooted at `/command`; older `/drift` owner URLs are compatibility redirects that preserve query strings and should not be used for new navigation, documentation or tests except redirect coverage.

Normalized incident records are authoritative: situation/article associations, evidence, timeline entries, official events, AI processing runs, saved situations and export manifests are stored separately from the summary payload returned for the dashboard.

The World Cup sport dashboard is authenticated read-only context. `/api/sport/world-cup` fetches ESPN scoreboard/standings JSON through a short server-side cache, normalizes compact match/table fields into `WorldCupDashboardPayload`, and returns a shared curated fallback when the live feed is unavailable. It does not persist raw sports payloads, create `source_items`, write source health, or participate in situation activation.

## Provenance Model

Map features carry one required provenance classification:

- `official`: explicitly published official coordinates or geometries.
- `reporting_estimate`: a place or bounded area extracted from public reporting; never treated as operational truth.
- `preparedness_context`: optional DSB infrastructure, such as fire stations or a 110-sentral; not evidence of active response.
- `private_annotation`: owner drawings and notes; never exposed as public evidence.

The API ignores any client attempt to create an annotation under another provenance class.

Inbound public records enter the `source_items` ledger before editorial linking or verification. `source_items` stores provider, kind, durable upstream identity, fetched time, raw/normalized payload, capture hash, optional geo hint and reliability tier. `situation_source_items` links those records to situations without making verification claims by itself.

Article coverage grouping is derived analysis, not upstream evidence. The worker writes the latest observable grouping decisions to `coverage_bundles` after article geocoding and article upsert. Those rows keep bundle kind, confidence, reason, member article ids, source labels, matched signals and near-miss diagnostics for `/command/dekning`; they must never create a `source_items` provider/kind or act as causal situation evidence.

The public City Pulse story feed is exposed through `/api/city-pulse/stories`. It reuses the same article filters as `/api/articles`, but returns grouped story cards with member article ids, source labels, bundle metadata and public verification so public pagination and counts can become story-native without duplicating coverage logic in every frontend surface.

Source contracts define what each upstream may write before adapter code is enabled. Bane NOR RSS is a phase-1 rail/mobility context source: it may write `source_items` provider `bane_nor`, kind `official_event`, and `source_health` source `bane_nor`, but it must not create `official_events`, `traffic_map_events` or `situations` without a separate promotion plan.

The deterministic situation-activation contract lives in `docs/situation-activation-framework.md`.
That framework is the source of truth for source roles, DATEX promotion classes, activation rule
IDs, fixture coverage, audit fields and user-facing provenance copy. Adapter code may summarize or
enrich after those rules pass, but it must not replace the deterministic evidence checks.

## AI Boundary

The worker defines a provider interface and implements deterministic analysis by default. Production deploys force `DEEPSEEK_ANALYSIS_ENABLED=false` and leave `DEEPSEEK_API_KEY` blank, so live clustering, situation detection, morning briefs and coverage bundles do not depend on an LLM provider. DeepSeek-based structured clustering remains local/experimental code only when `DEEPSEEK_ANALYSIS_ENABLED=true` and `DEEPSEEK_API_KEY` are configured outside the production playbook. Only bounded public feed excerpts, public official data and compact summaries of open (`preliminary`/`active`) situations may enter that process. Private annotations, attachments, tasks and notes are excluded. Malformed, empty or truncated model output degrades only the optional AI enrichment path while deterministic grouping continues.

AI clusters are accepted only after each cited snippet matches an input excerpt and at least two independent sources remain. Deterministic multi-source detection remains available when AI is disabled or degraded.

DeepSeek may also return structured hints for situation progress, likely same-story bundles, category/topic suggestions, Trondheim/Trøndelag relevance and owner-facing operations notes. Those hints are derived analysis, not upstream provenance: they stay in `ai_processing_runs.result` unless deterministic code explicitly consumes them. In v1 only cited situation-progress hints can attach public articles to existing open situations, and they do so as low-confidence reporting estimates. They cannot create new situations, reopen resolved/dismissed situations, write `source_items`, override categories, or replace deterministic coverage-bundle decisions.

Incident identity is lifecycle-aware: an open case may receive timely matching reports or a later official closure, while resolved or dismissed history cannot absorb a later same-place event. A later qualifying event receives a distinct activation identity and preserved provenance.

## Situation Activation

Automatic Situation Room activation requires an explicit incident type and a shared specific place or event signature; broad references such as `Trondheim` alone never activate a situation. New incidents require two independent sources within 12 hours. Later matching reporting or municipal updates may update an already activated signature without reopening that activation rule.

High-impact official DATEX traffic records and active Trondheim Politiloggen threads are explicit exceptions to the two-independent-source activation rule. They may create active official situations with `activationBasis.rule="official_source"`; DATEX uses `sourceIds=["datex"]`, `officialSource="datex"`, and its official event id, while Politiloggen uses `sourceIds=["politiloggen"]`, `officialSource="politiloggen"`, and the Politiloggen thread id. DATEX situation reuse is limited to existing DATEX-owned situations so official traffic evidence cannot accidentally attach to a news-created case. Low-impact/planned roadworks remain `official_events` only and do not activate the main situation feed.

DATEX TravelTime is intentionally outside situation activation. Current corridor rows are persisted in `datex_travel_times` for source health and Command Center traffic-pulse display, separate from `official_events` and `situations`. TravelTime values describe measured or estimated travel time, free-flow comparison and delay only; the worker must not infer incident cause, create `OfficialEvent` rows, promote official traffic events, or create/update `Situation` rows from TravelTime alone. Significant TravelTime delays may create owner-only Web Push candidates and `/command/varsler` rows as spatial analysis, but those candidates remain private operator signals rather than public evidence.

Traffic map overlays are operational map state. `traffic_map_events` is the persisted map-ready table for TrafficInfo rows; `source_items` is the provenance ledger; `situations` remains the incident feed. Derived DATEX and news traffic map objects are composed at API read time from `official_events` and articles rather than written to `traffic_map_events`. TrafficInfo roadworks can be shown richly on `/trafikk` without activating the Situation Room. DATEX TravelTime, DATEX Weather, DATEX CCTV and Trafikkdata counters are context overlays/telemetry and must not create `source_items`, `official_events`, or `situations` without a future explicit promotion rule.

The `/api/map/travel-plan` endpoint is an authenticated read-only composition endpoint. It geocodes user-supplied origin/destination strings server-side, derives a route corridor, queries already-persisted map/context tables in the route bounds, ranks nearby traffic events by severity and distance, and returns a UI payload with source-health summaries. It may call Nominatim/OpenStreetMap and OSRM for geocoding/routing, but those results are transient request context; the route planner does not write new ingestion rows, source items, official events or situations. Public-transport advice is contextual only: Entur vehicle positions and service alerts can be shown near the corridor, while concrete departure planning is handed off to AtB/Entur.

DATEX traffic events stay separate from MET/NVE warning context: weather and hazard warnings can enrich or contextualize a situation, but they are not fed into DATEX promotion logic. Conversely, DATEX records can confirm road state but are not treated as broader emergency confirmation outside the traffic layer without corroborating sources.

Owner-dismissed false positives retain evidence, timelines and activation audit records under the `dismissed` lifecycle state, but are excluded from current-situation surfaces.
