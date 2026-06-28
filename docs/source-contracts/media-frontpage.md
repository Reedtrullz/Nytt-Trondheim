# Media Frontpage Contract

## Scope

- Sources: `snasningen`, `merakerposten`, `frostingen`, `steinkjer_avisa`,
  `namdalsavisa`, `selbyggen`, `fjell_ljom`, `retten`, `nidaros`, `t_a`
- Upstream type: public newspaper front pages and public article metadata.
- Purpose: Trondheim/Trøndelag news discovery, candidate incident clustering and source-item
  provenance when no suitable RSS/Atom feed is exposed.

## Boundaries

- May create `articles`: yes, from public teaser metadata and article metadata.
- May create `source_items`: yes, as `provider=<media source>`, `kind=article`, after dedupe and
  relevance filtering.
- May create `situations`: only through the shared activation rules that require place specificity
  and either two independent sources or a qualifying official source elsewhere.
- May create telemetry tables: no.
- Private notes, tasks, annotations, cookies, sessions and exports must never be sent to media
  adapters or prompts.

## Identity And Retention

- Durable upstream identity: canonical public article URL.
- Raw payload retention: public teaser headline, public excerpt/description, URL, timestamp,
  source label, categories/tags and derived classification metadata.
- Article detail fetches are bounded and only read public metadata such as `og:title`,
  `og:description`, `article:published_time` and public tags. Full article bodies are not retained.
- Provenance: usually `reporting_estimate`.

## Verification

- Unit tests must cover public frontpage extraction, stable timestamp extraction, malformed or empty
  front pages, dedupe and non-Trondheim handling.
- Source audit should show source health and source-item counts without exposing full upstream page
  HTML.
