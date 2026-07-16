# RSS entity integrity wave

**Date:** 2026-07-15
**Baseline:** `origin/main` `d6ff02969bcda6f7bbd2c2eda4a5122a8e64744b`
**Branch:** `codex/rss-entity-integrity`

## Important finding

The generic RSS/Atom collector stripped markup and normalized whitespace but did not decode HTML
entities. A current read-only cross-source audit found literal numeric entities in cleaned
Malviknytt excerpts. Those strings can reach both reader-visible copy and matcher input even though
the source published the intended punctuation or spacing.

The current Malviknytt feed supplied raw `&#38;`, `&#160;`, and `&#8230;` evidence. Nine of ten
admitted items contained at least one encoded entity in the retained raw feed item. This is a
general mechanical extraction defect, not a publisher-, article-, or token-specific special case.

## Options and decision

1. Decode only the three observed numeric codes with replacements. Smallest diff, but fails the
   next valid named or numeric entity and turns current examples into policy.
2. Decode cleaned RSS/Atom title and excerpt fragments with the collector's existing Cheerio HTML
   parser while retaining the exact parsed feed item. This handles named and numeric entities and
   keeps the transformation reversible.
3. Redesign all source normalization behind a new cross-adapter representation. Broader future
   value, but unnecessary for this bounded mechanical defect and unsafe to mix with other staged
   extraction work.

Choose option 2. Markup is first replaced with spaces, preserving the previous separation between
adjacent block elements. Cheerio then decodes entities, after which whitespace is normalized. Raw
feed fields and extraction field names remain unchanged in the source capture.

## TDD evidence

- RED: a production-shaped CDATA fixture retained `&#38;`, `&nbsp;`, and `&#8230;` in the
  normalized article while all 26 pre-existing collector tests passed.
- Second RED: the initial decoder joined adjacent `<p>` elements without a space. The fixture was
  extended before completion, and the helper now preserves the previous tag boundary.
- GREEN: the focused collector suite passes `27/27`, including decoded title/excerpt assertions
  and exact raw-field retention.

## Public read-only verification

The branch collector was run against the current public Malviknytt RSS feed without writing to the
application database or retaining article bodies. It admitted ten articles. Nine raw feed items
contained entity evidence; all ten cleaned titles and excerpts contained zero entity tokens.
Evidence was limited to public URLs, lengths/counts, and twelve-character SHA-256 prefixes.

This proves the branch transforms current upstream shapes as intended. It does not prove the
deployed feed is corrected until a signed commit, PR, clean CI, merge, deploy, fresh worker cycle,
exact-SHA readback, and authenticated Siste nytt inspection have completed.

## Complete verification

- Focused collector suite: `27/27`.
- Full Vitest: `1300/1300` across `135/135` files.
- Full Playwright on isolated ports `5276`/`19080`: `151` passed and `1` intentional desktop-only
  skip.
- Typecheck, lint, Prettier, production build, `git diff --check`, and production dependency audit
  passed; the audit reported `0` vulnerabilities.

The first default-port Playwright run had one unrelated redirect to `/logg-inn`. A repeat on the
same ports then produced a shared `/api/session` setup cascade. The exact parity test passed `2/2`,
and all six affected correction journeys passed `12/12` across desktop and mobile. The complete
suite was therefore rerun on unique frontend/API ports rather than treating partial reruns as the
gate; that isolated run passed cleanly.

## Remaining boundary

Several current Amedia RSS feeds publish no description for a meaningful share of items. That is a
separate source-enrichment problem: it may require bounded public metadata/detail-page extraction,
new evidence retention, rate-limit decisions, and source-shaped fixtures. It is intentionally not
hidden behind this mechanical entity fix or mixed into the staged Nyhetsstudio wave.

A bounded follow-up inspected ten empty-description items from each of Avisa Sør-Trøndelag,
Innherred, Hitra-Frøya, and Trønderbladet. All `40/40` article URLs returned HTTP 200, but only
`12/40` exposed non-empty OpenGraph/meta descriptions. Those twelve values collapsed to two hashes:
one shared across the Avisa Sør-Trøndelag/Innherred samples and one identical across all ten
Trønderbladet samples. Only `6/40` exposed paragraphs under an article/main container. Feed-item
field-shape inspection found no unused structured description field.

The available metadata is therefore generic publisher copy, while paragraph fallback would begin
sampling article or paywall content with weak coverage. Preserving an empty ingress remains the
trust-safe behavior: the independent editorial selector records insufficient supported source text
instead of inventing a claim. Broader Amedia detail enrichment is an Important product/source
policy decision, not an entity-decoding fix. It needs explicit authority for request budget,
paywall/public-text boundaries, selector contracts, and bounded evidence retention before code.

No database schema, feature flag, matcher, projection, generation mode, correction behavior, or
reader UI changes in this wave.

## Release status and non-claims

Signed candidate `638bca701c807d28347dfdb4c53c554b252bf9bb` merged in PR `#42` as exact main
`53a7dcef343411210997268c8deec3c04724f3b5`. PR CI `29457729693`, exact-main CI
`29458079339`, and deploy `29458348446` passed, including a fresh worker cycle and source/capture
invariants. Public root/live/ready readback returned `200`; protected bootstrap returned `401`.
The owner-authenticated 16 July completion pass subsequently confirmed decoded reader-visible copy
on the current populated feed and exposed a separate publisher path-alias duplicate. That identity
repair is documented in the main Siste nytt audit and released through PR `#45`; it does not change
the entity-decoding policy here. Production flags remain projection `legacy`, corrections disabled,
matcher `v2`, and generation shadow.
