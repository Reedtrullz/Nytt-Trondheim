# Source Health And Provenance Audit Console Plan

**Goal:** Add an authenticated internal console that explains source freshness, collector behavior,
contract compliance and incident-to-source traceability without changing source ingestion
boundaries.

**Source-contract decision:** No new source contract is needed as scoped. The console reads existing
Nytt operational and provenance data: `source_health`, `collector_state`, `worker_cycle_metrics`,
`source_items`, `situation_source_items`, `evidence_items`, `official_events`, `traffic_map_events`,
`situations` and activation history. It does not poll a new upstream endpoint, add a `SourceId`,
write new provider/kind pairs into `source_items`, or retain new upstream payloads.

If a later version performs live provider probes beyond existing collectors, imports manual/source
submissions as ledger rows, or adds a provider/kind boundary, write or update the relevant
`docs/source-contracts/` contract before adapter or persistence code.

## Internal Data Contract

The console should live behind the existing owner-only session and use Bokmal UI copy. State-changing
routes are not required for the first slice; if refresh/retry controls are added later, they need the
normal CSRF protection and a separate safety plan.

- Source freshness comes from `source_health.state`, `last_checked_at`, `last_failure_at`,
  `next_poll_at` and `detail`. Show explicit `fresh`, `stale`, `degraded`, `awaiting_access` and
  `unknown` states derived from timestamps and each source's expected cadence.
- Collector run history comes from `worker_cycle_metrics` for the latest cycle. If historical runs
  are needed, add a bounded operational history table such as `worker_cycle_runs` outside
  `source_items`; keep raw upstream payloads out of it.
- Contract compliance is a read-only comparison between registered source expectations and persisted
  rows: provider/kind pairs, reliability tier, permitted target tables, source-health id and
  non-promotion rules.
- Non-secret diagnostics may include sanitized health detail, last checked/failure times, next poll,
  source item counts, row counts by target table, parse failure counts and collector duration. Do not
  expose credentials, auth headers, environment values, signed URLs, full raw payloads, attachment
  paths or screenshots that could contain secrets.
- Incident-to-source traceability should show how a situation is connected to source records through
  `situation_source_items.relationship`, `evidence_items`, official event ids and activation
  `source_ids`. It should distinguish `supports`, `context`, `contradicts` and `duplicate` without
  treating the link table as a verification claim by itself.
- Privacy/provenance constraints remain unchanged: private notes, tasks, attachments, exports and
  `private_annotation` map features are owner workspace material, not public evidence. Telemetry and
  context sources must stay context-only and must not be shown as automatic incident cause.

## Compliance Checks

Implement the first slice as deterministic checks that can be rendered in the console and exercised
in tests:

1. Every persisted `source_health.source` used by the worker has a display label and a documented
   owner: existing source contract, `docs/SOURCES.md` entry, or internal operations plan.
2. Every `source_items.provider`/`kind` pair is allowed by source-contract docs or historical ledger
   migration rules.
3. Telemetry-only providers (`datex_travel_time`, `datex_weather`, `datex_cctv`, `trafikkdata`,
   `entur_vehicle_positions`) have zero `source_items`, `official_events` and `situations` rows.
4. Context providers such as Entur service alerts and Bane NOR may appear in `source_items` only
   under their documented provider/kind rules and must not auto-activate situations in this release.
5. Situation traceability views must never display private annotation text or attachment content as
   official/public evidence.

## Implementation Steps

1. Define a shared read model for the audit console with source health summaries, optional latest
   worker metrics, contract-compliance rows and per-situation provenance traces.
2. Add an authenticated read-only API, for example `/api/operations/source-audit`, that composes the
   model from existing store methods or narrow new read methods.
3. Render an Operations subview with source freshness, run diagnostics, contract warnings and a
   searchable incident-to-source trace. Keep dense operational layout; this is an internal console,
   not a public status page.
4. Add server tests for source freshness derivation, no raw payload exposure, telemetry non-promotion
   checks and authenticated access.
5. Add frontend static-render tests for degraded, stale, awaiting-access, compliant and warning
   states.
6. Add deployment/manual verification SQL for production source-health freshness, provider/kind
   counts, telemetry exclusion and sample situation traceability.

## Verification

Targeted local gates for the implementation slice:

```bash
npm test -- packages/shared/test/worker-metrics.test.ts apps/server/test/api.test.ts apps/server/test/source-item-schema.test.ts
npm test -- apps/frontend/src/pages/OperationsPage.test.tsx
npm run typecheck
npm run lint
npm run format:check
```

Production/manual checks after deploy should verify fresh `source_health` rows, current worker
metrics, expected `source_items` provider/kind counts, zero telemetry leakage into source items or
situations, and at least one active/resolved situation trace that links evidence back to source
records without exposing private workspace material.
