# Media RSS Contract

## Scope

- Sources: `nrk`, `adressa`, `vg`, `dagbladet`
- Upstream type: public editorial RSS/feed or public article metadata used by the worker collectors.
- Purpose: Trondheim/Trøndelag news discovery, candidate incident clustering and source-item provenance.

## Boundaries

- May create `articles`: yes, when the story is Trondheim/Trøndelag relevant.
- May create `source_items`: yes, as `provider=<media source>`, `kind=article`, after dedupe and relevance filtering.
- May create `situations`: only through clustering/activation rules that require place specificity and either two independent sources or a qualifying official source elsewhere.
- May create telemetry tables: no.
- Private notes, tasks, annotations and exports must never be sent to media adapters or prompts.

## Identity and Retention

- Durable upstream identity: canonical article URL plus source-local IDs when available.
- Raw payload retention: limited public feed/article fields only; never credentials, cookies or paywalled body text.
- Provenance: usually `reporting_estimate`.

## Verification

- Unit tests must cover relevance filtering, dedupe and non-Trondheim exclusion.
- Source audit should show source health and source-item counts without exposing raw payloads.
