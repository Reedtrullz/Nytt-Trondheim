# Trondheim Kommune Aktuelt Contract

## Scope

- Source: `trondheim_kommune`
- Upstream type: public Trondheim kommune news listing and public article metadata.
- Endpoint: `https://www.trondheim.kommune.no/aktuelt/nyheter/`
- Purpose: official municipal notices and civic context for Trondheim news discovery and situation corroboration.

## Boundaries

- May create `articles`: yes, when public Aktuelt cards are parsed from the municipal news listing.
- May create `source_items`: yes, as official municipal article provenance derived from the stored article rows.
- May corroborate situations as an official municipal source when place and incident clustering rules are otherwise satisfied.
- Must not create private annotations, private tasks, notes, attachments or exports.
- Must not infer resolution from disappearance on the listing; article disappearance alone is not evidence that an incident ended.
- Must not scrape private resident notification systems under this source ID. `trondheim_notify` remains a separate candidate contract.

## Identity and Retention

- Durable upstream identity: canonical public article URL.
- Version marker: public article title, excerpt and `article:published_time` metadata when available.
- Admission requires a parseable upstream `article:published_time`. A missing, malformed or
  unavailable detail timestamp is never replaced by collection time. Individual unusable cards are
  skipped; if every listing candidate is unusable, collection fails and source health degrades.
- Raw payload retention: limited public card/article metadata only; no cookies, hidden state or private resident-targeted data.
- Normalized payload: Nytt article fields with source `trondheim_kommune`, official reliability tier and Trondheim scope.
- Provenance: `official` for public municipal statements, otherwise civic context in situation explanations.

## Verification

- Tests must prove the source-audit contract path points to this contract, not to candidate resident notifications.
- Collector tests must prove public listing parsing, URL canonicalization, timestamp rejection and
  graceful degraded source health on fetch/structure failure.
- Situation activation must still require place specificity and the existing independent-source or official-source promotion rules.
