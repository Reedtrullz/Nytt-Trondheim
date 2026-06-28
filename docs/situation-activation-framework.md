# Situation Activation Framework

This document is the owner-facing contract for when Nytt Trondheim may open, update, dismiss,
or resolve a situation. The implementation anchor is
`packages/shared/src/situation-activation-policy.ts`; the database anchor is
`apps/server/src/db/schema.sql`; the worker runtime still applies the concrete rules in
`apps/worker/src/clusters.ts`, `apps/worker/src/datex.ts`, and `apps/worker/src/politiloggen.ts`.

AI may summarize already-qualified material. AI must not activate, dismiss, resolve, or invent
source evidence.

## Implementation Plan

| Epic                       | Milestone                                                                                   | Complexity | Status                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| Activation policy contract | Shared source-role policy, DATEX matrix, 60+ fixture manifest                               | Medium     | Implemented in shared package                                                   |
| Runtime activation rules   | Two independent reporting sources, official exceptions, place specificity, lifecycle guards | High       | Existing worker rules, now covered by policy tests and adversarial worker tests |
| DB invariants and audit    | Activation fields, role/input hashes, append-only decision audit, migration smoke           | Medium     | Implemented as expand-compatible schema additions                               |
| Source contracts           | Table template and per-source activation role                                               | Low        | Template in shared policy; source docs link to this framework                   |
| UI provenance              | Bokmal microcopy for "Hvorfor ser jeg dette?" and source roles                              | Medium     | Contract text defined; product surfaces can reuse it incrementally              |
| Operations observability   | Decision audit rows, source health, coverage-bundle observability                           | Medium     | DB foundation present; richer operations views can follow                       |

## Source-Contract Table Template

Every new source contract should include these columns before adapter code lands:

| Column           | Required | Guidance                                                                                                       |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| SourceId         | Yes      | Stable internal source ID from the shared `SourceId` union.                                                    |
| Endpoint / URL   | Yes      | Public endpoint, RSS, API URL, or internal derived source. No secrets.                                         |
| Kind             | Yes      | RSS, JSON API, XML/DATEX, GraphQL, OGC, or internal derived analysis.                                          |
| Lisens / vilkar  | Yes      | NLOD, CC BY, editorial terms, or internal-only limitation.                                                     |
| Kan aktivere?    | Yes      | Yes/no/official exception, with exact threshold.                                                               |
| Aktiveringsrolle | Yes      | `activating_official`, `corroborating_official`, `reporting`, `context`, `telemetry`, `private`, or `ignored`. |
| Polling          | Yes      | Interval, ETag/If-Modified-Since behavior, and backoff.                                                        |
| Retensjon        | Yes      | Metadata, raw payload, normalized payload, and audit retention.                                                |
| Forbudte felt    | Yes      | Full article text, images, PII, license plates, private notes, or anything disallowed by contract.             |
| Testfiksturer    | Yes      | Normal payload, empty/stale payload, duplicate payload, and malformed payload.                                 |

## DATEX Promotion Matrix

| DATEX record                                | Action                        | Rule                                                                                                          |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Accident`                                  | Official situation            | Promote when impact is high or text indicates closed road/lane, injuries, or comparable public-safety impact. |
| `Obstruction`                               | Official situation            | Promote only when road/lane is blocked or impact is high.                                                     |
| `EnvironmentalObstruction`                  | Official situation or context | Landslide/flood with closure promotes; animal/low-impact obstruction remains context.                         |
| `RoadOrCarriagewayOrLaneManagement`         | Official situation or context | Acute closure promotes; scheduled management remains context.                                                 |
| `MaintenanceWorks` / `Roadworks`            | Context only                  | Planned work belongs in traffic context and source items, not situation rooms.                                |
| `NetworkManagement` / `ReroutingManagement` | Context only                  | May attach to the primary DATEX situation via upstream `situationId`; never a separate room.                  |
| `TravelTimeMeasurement`                     | Ignore for activation         | Telemetry only. It stays out of `source_items`, `official_events`, and `situations`.                          |
| Unknown/unparsed                            | Ignore for activation         | Log parser/source-health detail and require contract update before use.                                       |

## Regression Fixture Surface

The shared fixture manifest contains 62 named regression cases. It covers:

- single-source media non-activation,
- two independent reporting sources,
- place aliases and broad-place rejection,
- DATEX high-impact, low-impact, duplicate, stale, and missing-snapshot cases,
- Politiloggen official exceptions and inactive lifecycle,
- MET/NVE warnings as context only,
- TravelTime/weather/CCTV/Trafikkdata/Entur positions as telemetry only,
- private annotations and AI summaries as non-causal,
- source-health-only failures,
- stale reposts, duplicate articles, resolved/dismissed history, and restore idempotence,
- Rosenborg/Brann sports disambiguation.

The executable guard is `packages/shared/test/situation-activation-policy.test.ts`, with worker
adversarial coverage in `apps/worker/test/classify.test.ts`, `apps/worker/test/clusters.test.ts`,
`apps/worker/test/datex.test.ts`, and `apps/worker/test/politiloggen.test.ts`.

## DB Fields and Invariants

The schema now exposes first-class decision metadata:

- `situations.confidence_score`: optional 0..1 score for derived confidence.
- `situations.activation_rule_id`: deterministic policy rule ID.
- `situations.resolved_by`: official update, timeout, fresh missing snapshot, manual review, or merge.
- `situations.dismissed_reason`: explicit coded dismissal reason.
- `source_items.role` / `evidence_items.role`: official, reporting, context, telemetry, private, AI summary, or ignored role depending on table.
- `source_items.input_hash` / `evidence_items.input_hash`: stable dedupe/audit hashes.
- `situation_decision_audit`: append-only decision log with action, actor, reason, source item IDs, evidence item IDs, and structured payload.

Migration smoke rejects:

- context/telemetry sources in `activationBasis.sourceIds`,
- context/telemetry source IDs in `situation_activations`,
- telemetry and health-only evidence rows,
- invalid source/evidence roles,
- invalid confidence scores,
- invalid activation rule IDs,
- free-form audit actions,
- accidental `coverage_bundles` source-item rows.

## Worker Pseudocode and Assertions

```ts
for each collected source item:
  policy = activationPolicyForSource(source)

  if policy.role in ["telemetry", "context", "private", "ignored"]:
    store context or source health according to source contract
    audit("candidate_seen", reason = policy.rule)
    continue

  normalized = normalizeAndDedupe(sourceItem)
  if normalized.inputHash already exists:
    link duplicate and audit("candidate_seen", reason = "stale_or_duplicate")
    continue

  place = resolveSpecificPlace(normalized)
  if place is missing, outside AOI, or only Trondheim/Trondelag:
    audit("candidate_seen", reason = "place_too_generic")
    continue

  existing = findOpenSituationByIncidentSignature(place, type, eventDescriptor)
  evidence = collectFreshEvidence(existing, normalized, 12h window)

  if source is datex or politiloggen and officialHighImpactException(normalized):
    activate(rule = "official_high_impact_exception")
  else if hasTwoIndependentReportingSources(evidence):
    activate(rule = "two_independent_reporting_sources")
  else if officialSourceCorroborates(evidence):
    activate(rule = "official_corroboration")
  else:
    audit("candidate_seen", reason = "waiting_for_independent_source")

  issues = assertSituationActivationBasis(candidate)
  if issues.length > 0:
    reject and audit("dismissed", reason = issues.join("; "))
```

Required worker assertions:

- An active/preliminary situation must have `activationBasis`.
- `two_independent_sources` needs at least two distinct non-context source IDs and at least two article IDs.
- `official_source` permits only `datex` and `politiloggen`.
- Resolved/dismissed situations cannot absorb later same-place events without a new qualifying activation.
- AI output can only attach after deterministic activation.
- Context-only providers may link as `context`, never `supports`.

## Bokmal UI Microcopy

- `Hvorfor ser jeg dette?`
- `Saken vises fordi minst to uavhengige kilder omtaler samme hendelse på et spesifikt sted.`
- `Saken er offentlig bekreftet av politiet eller Statens vegvesen etter en eksplisitt aktiveringsregel.`
- `Dette er kontekst. Det beskriver varsel, målinger eller trafikkstatus, men bekrefter ikke en lokal hendelse alene.`
- `Dette er et målepunkt eller en sensorverdi. Det kan forklare situasjonen, men kan ikke opprette en situasjon.`
- `Private notater er bare synlige for deg og brukes ikke som offentlig kildebevis.`
- `Stedsangivelsen er estimert fra rapportering og kan være upresis.`
- `Kandidaten ble ikke aktivert fordi kildene var for gamle eller ikke uavhengige.`
- `Saken er avvist fordi en offisiell kilde avkreftet eller korrigerte grunnlaget.`

## Audit and Logging Requirements

- Log every candidate, activation, dismissal, resolve, merge, split, context attach, source-health change, and AI summary.
- Preserve actor, timestamp, source item IDs, evidence IDs, rule ID, and coded reason.
- Keep audit payloads structured and minimal; do not store full article text or images.
- Keep source-health history separate from source evidence.
- Use source contract retention windows for raw payloads.
- Ensure every user-visible situation can reconstruct "why this exists" from evidence and audit rows.

## Edge Cases and Mitigations

- Broad `Trondheim`/`Trondelag` mentions: feed-relevant but not incident identity.
- Same place and type, different concrete event: split by event descriptor, text, time, and source details.
- Same event, local aliases: merge only through explicit alias/geocode confidence.
- MET/NVE warning overlap: attach as context, do not count as evidence.
- DATEX multi-record situation: group by upstream `situationId`.
- DATEX stale flags: recompute impact from current record text/severity before promotion.
- TrafficInfo, TravelTime, road weather, cameras, counters, and vehicle positions: context/telemetry only.
- Sports `Brann`: never fire without emergency wording and non-sports category context.
- Source format drift: degrade source health and pause activation use.
- AI unavailable: skip summaries; deterministic ingestion continues.
