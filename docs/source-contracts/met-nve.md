# MET and NVE Contract

## Scope

- Sources: `met`, `nve`
- Upstream type: public weather, warning and preparedness feeds.
- Purpose: weather and natural-hazard context for Trondheim situation work.

## Boundaries

- May create preparedness context and source health rows.
- May appear in map overlays, weather preparedness views and situation explanations.
- Must not create private annotations.
- Must not activate situations alone unless a future explicit official-source promotion rule is written and tested.

## Identity and Retention

- Durable upstream identity: upstream warning/event identifiers when available; otherwise hash of public warning geometry/time/type.
- Raw payload retention: public warning metadata only.
- Provenance: `official` for official warning facts, otherwise `preparedness_context`.

## Verification

- Tests must cover source-labeled weather guidance and prevent weak context from becoming incident evidence.
