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
- Every admitted article must have a parseable upstream timestamp from the listing, structured
  metadata, or bounded public detail fetch. Missing or invalid values are not replaced with
  collection time.
- Raw payload retention: the exact public JSON-LD `NewsArticle` object or public anchor href/text
  used as the candidate, the matched public Amedia `articleLastModified` value when applicable, and
  the individual OpenGraph/article metadata values used by a bounded detail fetch. Full page HTML,
  cookies, sessions and hidden application state are not retained.
- Parseable public `dateModified`, `article:modified_time`, or Amedia `articleLastModified` is stored
  as the append-only capture's `sourceUpdatedAt`; it is not substituted with collection time.
- Capture identity includes raw retained evidence and the source revision clock, so upstream teaser
  or metadata revisions remain inspectable even if normalization yields the same article fields.
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
- Tests must cover JSON-LD/anchor field provenance and detail metadata retention without exposing
  collection-only evidence in article JSON.
