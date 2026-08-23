# Media RSS Contract

## Scope

- Sources: `nrk`, `adressa`, `avisa_st`, `ytringen`, `innherred`, `malviknytt`,
  `hitra_froya`, `tronderbladet`, `vg`, `dagbladet`
- Upstream type: public editorial RSS/feed or public article metadata used by the worker collectors.
- Purpose: Trondheim/Trøndelag news discovery, candidate incident clustering and source-item provenance.

## Boundaries

- May create `articles`: yes, when the story is Trondheim/Trøndelag relevant.
- May create `source_items`: yes, as `provider=<media source>`, `kind=article`, after dedupe and relevance filtering.
- May create `situations`: only through clustering/activation rules that require place specificity and either two independent sources or a qualifying official source elsewhere.
- May create telemetry tables: no.
- Private notes, tasks, annotations and exports must never be sent to media adapters or prompts.

## Identity and Retention

- Durable upstream identity: source plus canonical article URL, represented by the versioned
  `article-url-v2` dedupe key. Different canonical URLs are different stored articles even when
  their normalized titles and publication hours are identical.
- Legacy normalized-title/publication-hour hashes may be retained as migration or similarity
  metadata for old rows, but must never be a destructive identity match across different canonical
  URLs. Existing rows are migrated opportunistically when they are encountered by stable article
  ID or canonical URL; this wave does not rewrite the whole table.
- Every admitted article must have a parseable upstream publication timestamp. Missing or invalid
  timestamps are not replaced with collection time; unusable items are skipped, and a feed whose
  candidate items are all unusable must degrade source health.
- Raw payload retention: limited public feed/article fields only; never credentials, cookies or paywalled body text.
- Avisa Sør-Trøndelag uses RSS `https://www.avisa-st.no/rss`; public feed categories may be used for Trondheim/Trøndelag relevance and place hints, but full article bodies are not retained.
- Ytringen uses public Atom `https://ytringen.no/atom.xml`.
- Innherred, Malviknytt, Hitra-Frøya and Trønderbladet use public RSS frontpage/news feeds.
- Provenance: usually `reporting_estimate`.

## Verification

- Unit tests must cover relevance filtering, canonical-URL identity, same-title/same-hour negative
  controls and non-Trondheim exclusion.
- A successful HTTP response with no RSS/Atom entries, the wrong document structure, or no usable
  candidate timestamp must fail the collection so source health cannot report it as healthy.
- Mixed feeds skip individual malformed items while retaining valid, independently timestamped
  items.
- Source audit should show source health and source-item counts without exposing raw payloads.
