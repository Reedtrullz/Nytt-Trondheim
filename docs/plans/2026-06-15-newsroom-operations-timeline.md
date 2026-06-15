# Newsroom Operations Timeline Plan

**Goal:** Add an authenticated internal timeline for active and recently changed newsroom
situations, source updates, collector runs, reviewer actions and stale-source warnings.

**Source-contract decision:** No new source contract is needed for this slice. The timeline composes
existing Nytt data from `situations`, `timeline_entries`, `source_items`,
`situation_source_items`, `map_features`, workspace tasks/notes, `source_health` and
`collector_runs`. It does not poll a new upstream endpoint, introduce a new `SourceId`, write a new
`source_items.provider`/`kind` pair, or retain raw upstream payloads.

If a later version adds live provider probes, external manual submissions, or a first-class
append-only operation event stream for new upstream material, write or update the relevant
`docs/source-contracts/` contract before adapter or persistence code.

## Internal Data Contract

- `/api/operations/timeline` returns a safe event envelope with timestamps, event kind, source,
  provenance, role, situation link, source-audit link and bounded non-secret metadata.
- Event kinds cover situation/source updates, collector runs, reviewer actions, status changes,
  severity markers, merge/split decisions, stale warnings and private annotations.
- Private notes and tasks appear only as private reviewer-action metadata. Note/task bodies are not
  included in the timeline response.
- Collector runs and stale warnings are operations context. They do not become evidence and do not
  alter situation activation rules.
- Telemetry-only sources may appear with role `telemetry` for stale warnings or collector runs, but
  they must not appear as `supports` links, evidence rows or activation basis.
- Responses must not expose `rawPayload`, `normalizedPayload`, credentials, auth headers,
  environment values, signed URLs, attachment storage paths or raw XML/JSON.

## Known Fidelity Limits

Existing data supports most requested events, but not every manual action has historical before/after
state yet:

- Status changes are visible from current state and timeline text, but PATCH status does not append a
  dedicated timeline row yet.
- Severity changes are represented by current high-priority markings and explicit timeline entries
  when present.
- Merge/split decisions are inferred from existing timeline entry kind/text unless a future
  append-only operations table is added.
- Private annotation deletes are not retained after deletion.

A high-fidelity v2 can add an expand/contract-compatible `operations_events` table with append-only
events for reviewer actions, actor login, before/after values and delete records while keeping this
read model as fallback.

## Verification

Target local gates:

```bash
npm test -- packages/shared/test/workspace-contracts.test.ts apps/server/test/api.test.ts apps/frontend/src/operationsTimelineFilters.test.ts apps/frontend/src/operationsTimelineRows.test.ts apps/frontend/src/pages/OperationsTimelinePage.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Browser QA should open `/drift/tidslinje`, verify URL filters, grouped Oslo dates, row selection,
drawer links, private-event hiding and source-audit/situation navigation.
