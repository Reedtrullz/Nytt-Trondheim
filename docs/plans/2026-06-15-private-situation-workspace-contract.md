# Private Situation Workspace Contract And Verification Plan

**Goal:** Document the private Trondheim situation workspace as an internal API/data contract, not
as a new external source. Keep future implementation work inside the existing provenance, privacy
and telemetry boundaries.

**Source-contract decision:** No new source contract is needed for this feature as scoped. The
workspace does not poll a new provider, add a `SourceId`, define a new upstream identity, or write
new ingestion rows. It composes existing `situations`, `source_items`, evidence, map features,
workspace tasks, notes, attachments and export manifests through authenticated server APIs.

If a later workspace change ingests a new public feed, imports owner/reporter submissions into
`source_items`, or assigns a new provider/kind pair, write a `docs/source-contracts/` contract before
adapter or persistence code.

## Internal API/data contract

All `/api/*` routes require the authenticated owner session. State-changing routes also require the
CSRF token returned by `GET /api/session`.

| Endpoint                                                   | Contract                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/situations`                                      | Lists `SituationPage` with validated `status`, `saved`, `includeDismissed`, `cursor` and `limit` filters. Dismissed situations stay queryable as history, not current feed items.                        |
| `GET /api/situations/:id`                                  | Returns `SituationWorkspace`: the situation, provenance explanation, related articles, tasks, notes and attachment metadata. Source item raw/normalized payloads are not returned.                       |
| `GET /api/situations/:id/timeline` and `/articles`         | Read-only projections from the workspace aggregate.                                                                                                                                                      |
| `GET/POST/DELETE /api/situations/:id/source-items`         | Links existing source ledger rows to a situation as `supports`, `contradicts`, `context` or `duplicate`. Linkage is provenance metadata; it must not create new upstream records.                        |
| `POST/PATCH/DELETE /api/situations/:id/features`           | Creates and edits private map annotations only. The server stamps `provenance="private_annotation"` and only allows `sourceItemIds` that are already linked to the same situation.                       |
| `PUT/DELETE /api/situations/:id/saved`                     | Stores owner-specific saved state in `saved_situations`.                                                                                                                                                 |
| `PATCH /api/situations/:id/status`                         | Allows `active`, `resolved` or `dismissed`; dismissed requires `dismissalReason` and keeps audit/history visible.                                                                                        |
| `POST/PATCH/DELETE /api/situations/:id/tasks` and `/notes` | Stores private owner workspace text only. These records are not evidence and are not source items.                                                                                                       |
| `POST/GET/DELETE /api/situations/:id/attachments`          | Stores private uploads outside the web root with metadata and SHA-256 checksums. Uploads are size-limited and scoped to the situation id.                                                                |
| `POST/GET /api/situations/:id/exports`                     | Builds an authenticated private ZIP with PDF brief, evidence/timeline JSON, private notes, GeoJSON layers, attachment checksums and sanitized attachment paths. Treat generated exports as confidential. |

## Privacy and provenance rules

- Private tasks, notes, attachments, exports and `private_annotation` map features are owner
  workspace material. They are never public evidence and are excluded from AI processing.
- Client-supplied map-feature provenance is not trusted. Private feature writes always persist as
  `private_annotation`; official/reporting/preparedness map features are worker/server-owned.
- `EvidenceItem.provenance` excludes `private_annotation`; private annotations may explain owner
  reasoning but must not become `evidence_items`.
- `source_items` are the public/provenance ledger. Workspace APIs may link existing rows but should
  not expose `rawPayload` or `normalizedPayload` through owner-facing list responses.
- Attachment filenames are sanitized for downloads and ZIP paths. The stored checksum, manifest and
  export README are part of the privacy/audit contract.

## Telemetry-source constraints

Telemetry and context feeds remain non-causal even when shown inside a workspace explanation:

- `datex_travel_time`, `datex_weather`, `datex_cctv`, `trafikkdata` and
  `entur_vehicle_positions` are telemetry/context only.
- Entur service alerts are public-transport context in this release, not automatic situation
  activation evidence.
- MET/NVE warning context can explain risk around an already located situation, but does not confirm
  the incident by itself.
- Source item links for telemetry/context providers must not use `supports`; use `context`,
  `contradicts` or `duplicate` as appropriate.
- Private annotations remain private even when they cite linked source item ids.

## Verification plan

Existing coverage to preserve:

- `apps/server/test/api.test.ts` covers authenticated workspace reads, provenance explanation,
  context/telemetry roles, private annotation stamping, rejection of unlinked `sourceItemIds`,
  CSRF enforcement, private attachment checksums, missing-situation upload cleanup, export quotas,
  ZIP contents, rate limiting, deletion operations and dismissed-history visibility.
- `apps/server/test/source-items-api.test.ts` covers owner-only source item access, omission of raw
  payloads, relationship validation and link/unlink behavior.
- `apps/server/test/source-item-schema.test.ts` covers source ledger tables and schema-level
  telemetry/context guards.

Run this targeted slice after workspace API or privacy/provenance changes:

```bash
npm test -- apps/server/test/api.test.ts apps/server/test/source-items-api.test.ts apps/server/test/source-item-schema.test.ts
npm run typecheck
npm run lint
```

Add new tests before changing behavior in any of these areas:

- a worker/AI prompt test proving private notes, attachments and private map annotations cannot enter
  clustering prompts;
- a database-backed trigger test if telemetry/context source-link rules move beyond schema-string
  assertions;
- an API regression test for any new workspace export file, attachment metadata field or source item
  relationship value;
- an activation regression test for any change that lets workspace/private material influence
  `Situation.activationBasis`, `evidence_items` or automatic status promotion.
