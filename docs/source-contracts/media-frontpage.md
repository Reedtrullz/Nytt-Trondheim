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

- Durable upstream identity: source plus canonical public article URL, represented by the versioned
  `article-url-v2` dedupe key. Different canonical URLs remain distinct even when teaser titles and
  publication hours match.
- Legacy normalized-title/publication-hour hashes are compatibility-only migration or similarity
  metadata and must not collapse different canonical URLs. Stable ID or canonical URL remains the
  only old-row identity bridge.
- Every admitted article must have a parseable upstream timestamp from the listing, structured
  metadata, or bounded public detail fetch. Missing or invalid values are not replaced with
  collection time.
- Raw payload retention: public teaser headline, public excerpt/description, URL, timestamp,
  source label, categories/tags and derived classification metadata.
- Article detail fetches are bounded and only read public metadata such as `og:title`,
  `og:description`, `article:published_time` and public tags. Full article bodies are not retained.
- Provenance: usually `reporting_estimate`.

## Verification

- Unit tests must cover public frontpage extraction, stable timestamp extraction, malformed or empty
  front pages, dedupe and non-Trondheim handling.
- A successful HTTP response with no recognizable public article candidates, or with candidates
  whose timestamps are all unusable after bounded detail fetches, must fail the collection so source
  health degrades. Mixed pages skip the unusable candidates and retain valid ones.
- Source audit should show source health and source-item counts without exposing full upstream page
  HTML.
