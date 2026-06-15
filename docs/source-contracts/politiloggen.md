# Politiloggen Contract

## Scope

- Source: `politiloggen`
- Upstream type: public Politiet message threads.
- Purpose: official incident discovery and updates for Trondheim/Trøndelag.

## Boundaries

- May create `articles`, `source_items` and official situations when records contain a concrete event and place.
- Must not write `official_events` in the current model; those rows are reserved for MET, NVE and DATEX.
- May resolve or update existing Politiloggen-derived situations through durable upstream identity.
- Must not infer extra facts from disappearance of upstream records.
- Must not expose sensitive personal details beyond the public Politiloggen text already published upstream.

## Identity and Retention

- Durable upstream identity: Politiloggen thread/message ID.
- Raw payload retention: public message-thread fields required for provenance and update detection.
- Provenance: `official`.

## Verification

- Tests must cover activation, update, resolved-state handling and place specificity.
