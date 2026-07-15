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
- Article admission requires a parseable upstream thread or published-message creation timestamp.
  Invalid or missing timestamps are never replaced with collection time. Unusable threads are
  skipped; if a non-empty response contains no usable thread, collection fails and source health
  degrades.
- Raw payload retention: the exact public message-thread object returned for each admitted active
  article, wrapped with endpoint/format metadata. Payload-level count and unrelated threads are not
  duplicated into each capture.
- `sourceUpdatedAt` is the latest parseable public thread/message update or creation clock. It is
  retained on the append-only capture and is never replaced with collection time.
- Capture identity includes the retained thread object and revision clock so message corrections or
  additions remain distinct even when the normalized article projection is unchanged.
- Provenance: `official`.

## Verification

- Tests must cover activation, update, resolved-state handling and place specificity.
- HTTP `204` is the only explicit empty-snapshot success. A `200` response must contain a non-empty
  `messageThreads` array with at least one structurally usable, timestamped thread; malformed or
  empty `200` payloads fail the collection so they cannot report healthy source status.
- Mixed payloads skip malformed or untimestamped threads while preserving valid threads.
- Tests must prove public fields not used by normalization remain in raw capture evidence and that
  the latest valid upstream revision clock is retained.
