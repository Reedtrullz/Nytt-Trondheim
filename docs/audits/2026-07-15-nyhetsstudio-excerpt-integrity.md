# Nyhetsstudio excerpt integrity wave

**Baseline:** `origin/main` `d6ff02969bcda6f7bbd2c2eda4a5122a8e64744b`

**Branch:** `codex/nyhetsstudio-excerpt-integrity`

## Important finding

Sparse Adresseavisen Nyhetsstudio feed items are enriched from the public detail page. The
deployed collector takes the first four page-wide `<p>` elements that are at least 40 characters
and do not begin with `Foto:`. Login, subscription, cookie, navigation, legal, headline-duplicate,
header, and footer paragraphs can therefore replace a valid feed excerpt and become clustering,
notification, and public display input.

Authenticated production source-item readback is unavailable because the existing Chrome
connection is unavailable. The defect is proven directly in the deployed extraction path and by a
production-shaped page fixture; this wave does not claim which current live article is affected.

Read-only public verification on 15 July used the current Adresseavisen RSS feed and six current
Nyhetsstudio URLs. Two inspected pages returned HTTP `200` and exposed `7/7` and `5/5` paragraph
elements inside `main article`; the page-wide counts were only one paragraph higher in each case.
The candidate collector admitted 60 feed articles and evaluated all six current Nyhetsstudio items
through `main article p`. It selected supported paragraphs, bounded later paragraphs with
`selection_limit`, and rejected one short candidate. Only URLs, selector counts, lengths, decision
codes, and content hashes were retained in the audit output; no article body was copied here.

## Root cause and decision

Options considered:

1. Add more exclusions to the existing page-wide selector.
2. Require an explicit article/main container and centralize editorial-text rejection.
3. Build a new per-publisher article-body parser.

Option 2 is the smallest coherent boundary. It fails closed without hardcoding a headline,
location, or publisher-specific event, and it lets extraction and bundle-copy selection share one
policy. A per-publisher body parser is not justified by the current evidence.

## Candidate behavior

- Prefer the first `main article`, then the first `article`, then the first `main`; never promote
  generic page-level paragraphs.
- Evaluate at most twelve normalized public paragraph candidates. Select at most four.
- Reject short text, punctuation-equivalent headline duplicates, login/subscription/cookie/
  navigation/photo/legal boilerplate, duplicate paragraphs, and candidates beyond the selection
  limit with bounded reason codes.
- Preserve selected and rejected candidate decisions in collection-only raw capture evidence.
  Generic page paragraphs may be retained only as rejected `unscoped_container` evidence.
- If no supported container or paragraph remains, retain the original feed excerpt. Do not invent
  a sentence.
- Reuse the same shared editorial-text policy for bundle ingress selection so extraction and public
  display cannot disagree about boilerplate.

## TDD and verification

RED reproduced both trust failures: interstitial/headline text replaced supported reporting, and
an unscoped body replaced the feed fallback. The new shared module was initially absent.

Current GREEN proof:

- Focused shared editorial, collector, source-item, and repository suites: `89/89`.
- Full Vitest: `1304/1304` across `136/136` files.
- Full desktop/mobile Playwright: `151` passed with `1` intentional desktop-only skip.
- Root typecheck, ESLint, Prettier, production build, dependency audit (`0` vulnerabilities), and
  `git diff --check`: passed.
- The source-capture PostGIS smoke now asserts that bounded paragraph decisions survive the real
  current-item and append-only capture path. A disposable PostGIS 16 database applied the schema
  twice, then proved one current item, two append-only raw revisions, and retained paragraph
  decision evidence. The first invocation raced the image's temporary initialization server; a
  retry against the confirmed-running same container passed. No application or schema failure was
  involved.
- A live read-only collector pass over the current public feed produced six explainable
  Nyhetsstudio detail decisions without falling back to page-wide paragraphs.

## Release and non-claims

- Signed candidate `6281c0f6d8f3a7f7a6ac4cfed9939353c82d58c6` merged in PR `#44` as exact main
  `b885844fc9d61bf9fc24e67c3472eaff81fcc3e4`. Rebased PR CI `29459258316`, exact-main CI
  `29460092199`, and deploy `29460330082` passed. The deploy observed a stable recent completed
  worker cycle and passed source/capture invariants with `failed=0`.
- Public root/live/ready readback returned `200`; protected bootstrap returned `401`; readiness
  reported PostgreSQL and projection `legacy`.
- Current authenticated source-item/card inspection remains unclaimed because Chrome was not
  running and launching it requires explicit owner permission.
- No schema, matcher, situation activation, projection, correction, or feature-flag behavior
  changes.
- Production must remain projection `legacy`, corrections disabled, matcher `v2`, and generation
  shadow.
