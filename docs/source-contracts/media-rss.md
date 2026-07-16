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

- Durable upstream identity: canonical article URL plus source-local IDs when available. NRK's
  explicit trailing publication ID (for example `1.17960432`) remains authoritative across public
  slug/title updates. Amedia aliases with the same stable ID and publication time represent one
  published record even when route, slug or title changes; a later publication time remains a
  distinct revision.
- Every admitted article must have a parseable upstream publication timestamp. Missing or invalid
  timestamps are not replaced with collection time; unusable items are skipped, and a feed whose
  candidate items are all unusable must degrade source health.
- Raw payload retention: the exact parsed public RSS/Atom item, the extraction field names, and any
  bounded public paragraph evidence evaluated to enrich a sparse feed excerpt. Detail enrichment
  prefers an explicit `article` container, then `main`; generic page-level paragraphs never become
  article copy. Retain at most twelve normalized candidate paragraphs with selected/rejected
  decisions and bounded reason codes, not full HTML. Reject headline duplicates, login,
  subscription, cookie, navigation, photo-credit and legal boilerplate. When no supported detail
  paragraph remains, preserve the feed excerpt and record the fail-closed fallback. Bounded generic
  page paragraphs may be retained only as explicitly rejected `unscoped_container` evidence. Never
  retain credentials, cookies, response headers, full page HTML or paywalled body text.
- Cleaned title and excerpt fields decode HTML markup and named or numeric entities before
  whitespace normalization. The exact parsed feed fields remain unchanged in the raw capture so
  the mechanical transformation stays explainable and reversible.
- Explicit subscriber text, exact paid categories, or public JSON-LD
  `isAccessibleForFree=false` may mark an article as `paid`; missing evidence remains unknown rather
  than free. Adresseavisen detail inspection has a hard twelve-page-per-cycle budget shared by
  access detection, empty-description metadata and existing Nyhetsstudio enrichment. It never
  crosses authentication or retains full article bodies.
- `sourceUpdatedAt` uses a parseable public Atom/RSS `updated` value when present. It is a source
  revision clock, not collection time, and is retained only on the append-only capture.
- Capture identity includes the raw retained evidence and source revision clock as well as the
  normalized article. An upstream revision therefore remains distinct even when the public article
  projection does not change.
- Avisa Sør-Trøndelag uses RSS `https://www.avisa-st.no/rss`; public feed categories may be used for Trondheim/Trøndelag relevance and place hints, but full article bodies are not retained.
- Ytringen uses public Atom `https://ytringen.no/atom.xml`.
- Innherred, Malviknytt, Hitra-Frøya and Trønderbladet use public RSS frontpage/news feeds.
- Provenance: usually `reporting_estimate`.

## Verification

- Unit tests must cover relevance filtering, dedupe and non-Trondheim exclusion.
- A successful HTTP response with no RSS/Atom entries, the wrong document structure, or no usable
  candidate timestamp must fail the collection so source health cannot report it as healthy.
- Mixed feeds skip individual malformed items while retaining valid, independently timestamped
  items.
- Tests must prove raw feed fields and revision clocks reach the source-item capture while the
  collection-only evidence is absent from serialized article JSON.
- Production-shaped tests must prove sparse Nyhetsstudio pages cannot promote interstitial or
  headline-duplicate paragraphs, and that missing article/main containment falls back to the feed
  excerpt while preserving bounded decision evidence.
- Source audit should show source health and source-item counts without exposing raw payloads.
