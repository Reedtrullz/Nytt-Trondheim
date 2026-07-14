# Siste nytt quality audit and delivery record

**Status:** Wave 1 merged; bounded worker-readiness rollout follow-up active

**Started:** 2026-07-14

**Baseline:** `origin/main` at `e7b8f20dd20db1f7dc949c1c7f28143dea392e3b`

**Production:** `https://nytt.reidar.tech`

**Branch:** `codex/siste-nytt-quality-20260714`

## Release boundary

- Production remains on the legacy coverage projection.
- Matcher v2 remains shadow-only. Promotion requires explicit owner approval.
- Coverage corrections are disabled in production. This audit does not enable them implicitly.
- A passing unit suite is not production proof. Each released fix must be rechecked after a fresh
  worker generation where the original articles are still eligible.

## Ranked findings

### Critical — two independent theft events are one public story

Active legacy bundle `coverage:0g728te` combines nine articles from two events:

1. **Moholt storage-unit burglary, reported 09:13 local time**
   - `nidaros-d3ffe4c69406e89a`
   - `nidaros-1e8c4d35e9dedc7e`
   - `adressa-d48757f55079317a`
   - `nrk-d7e4a8c8eb035c94`
   - `politiloggen-26jxfg`
2. **Øya shop theft, reported 07:26 local time**
   - `nidaros-1ee18d78185a3df4`
   - `nrk-dcc277c9375e0999`
   - `adressa-c4a947e216f4ff40`
   - `politiloggen-262hgl`

Authenticated production inspection showed the public primary title
“Brøt seg inn og raserte flere boder i sameie: – Jeg er sjokkert” with eight supporting articles.
The owner audit exposed only legacy generic place-event `innbrudd` and `tyveri` edges, plus
within-event title/near-duplicate signals. It reported no normalized ingress edge and no direct
strong official verification edge. Low-overlap cross-event pairs were nevertheless connected by
the accepted topology.

The first captured fresh shadow generation was
`33a3813c-bd96-4a3f-a78c-84aa693bd04e`, generated from 427 articles with 27 groups and 522 edges
between `2026-07-14T16:11:20.551Z` and `2026-07-14T16:14:14.238Z`. A later authenticated read at
18:21 Europe/Oslo independently reproduced the same nine-member legacy group.

**Root cause:** legacy property-crime matching treats broad `innbrudd`/`tyveri` vocabulary as
event identity inside a permissive time/place rule. Transitive admission can then join two
independent events. Stale persisted membership is not the initiating match signal in a fresh
worker run, but it can preserve duplicate or misleading bundle identity in direct-analyzer and
legacy fallback paths unless identity is arbitrated globally.

**Required gate:** a production-shaped case must have zero cross-event bridge membership in both
legacy and v2, without widening generic time or place windows.

### Important — one Rotvoll collision is split into two cards

Four reports at 17:25 local time describe five people involved, no reported injuries, and the
Haakon VIIs gate/Rotvoll area:

- `nrk-95293370d71dbc53`
- `politiloggen-261sx6`
- `adressa-3d7b41fd5648af44`
- `nidaros-0696d7ebaf2d0293`

Legacy shows two adjacent two-source cards. Shadow v2 groups only Adressa and Nidaros; exact place
comparison blocks the Politiloggen article because its structured label is broader/different even
though the text names the precise location. Generic NRK copy remains a singleton.

**Required gate:** add positive high-information collision evidence and explicit place hierarchy;
do not weaken specific-place conflicts globally.

### Important — fresh 390 px Siste nytt overflows horizontally

On an authenticated fresh load at a true `390 × 844` viewport, the document measured about
`487 px`, roughly `97 px` wider than the viewport. `.home-grid` was 346 px wide, while its
single-column track and `.news-section` retained a roughly 465 px min-content width. Long grouped
content was clipped on the right.

**Root cause:** the responsive rule switches the grid to `1fr`, whose automatic minimum permits
min-content expansion. The content column also lacks an explicit zero minimum.

### Important — owner correction is unavailable for the live trust defect

The authenticated session reports coverage corrections disabled. The current wrong merge cannot
be split from Siste nytt or `/command/dekning`. Enabling corrections is separate from fixing the
matcher and from promoting v2; both require a dedicated release decision and proof.

### Important — ingestion, identity, and editorial provenance are not revision-safe

- Invalid or missing upstream timestamps can become collection time and reorder old items.
- Source + normalized title + published hour is treated as hard identity, so different URLs can be
  destructively collapsed.
- Media `rawPayload` stores the already normalized/geocoded article and is overwritten, so it is
  neither raw nor revision-safe.
- Newest article becomes the primary regardless of title/ingress quality.
- Several adapters admit encoded entities, blank excerpts, publisher suffixes, or legal boilerplate.
- Inactive Politiloggen threads disappear instead of contributing a supported lifecycle update.
- HTTP 200 with structurally empty source markup can remain healthy.

These require an expand-compatible capture/revision wave rather than ad-hoc matcher changes.

### Important — correction, error, stale, and saved UI states can contradict persistence

- Split/undo replacement stories can visually erase saved state until the next normal refresh.
- A failed filtered feed can show both an error and a false empty result.
- The 60-second refresh can interrupt an open or committed correction flow.
- Owner audit rows remain interactive while retained data is loading, stale, or failed.
- Owner correction lacks reliable focus restoration and live success announcements.
- A low-friction missed-group report does not exist.
- Expanded supporting headlines remain permanently ellipsized.

## Architecture decision

### A. Targeted evolution

Fastest and lowest migration risk. Suitable for the Critical property-crime policy and responsive
containment fix, but leaves legacy/v2 policy duplication and editorial provenance debt.

### B. Shared evidence and editorial policy — recommended

Move event evidence, conflicts, display-copy selection, and evaluation policy into shared,
versioned functions consumed consistently by legacy and v2. Deliver incrementally so each rule is
independently testable and reversible. This is the smallest approach capable of excellent quality
without requiring immediate projection promotion.

### C. Comprehensive article-to-story redesign

A future `CollectedArticleCapture → CanonicalArticleRevision → CoverageMembership →
StoryEditorial` pipeline would correctly separate raw evidence, identity, revisions, clocks,
membership, and display copy. It is justified as a direction, but too broad to be the first
response to an active public trust defect.

**Decision:** use B as the destination, delivered in A-sized release waves. Preserve C-compatible
boundaries when adding capture/revision and editorial fields.

## Delivery waves

1. **Critical bridge and mobile containment**
   - Add a sanitized production-shaped property-crime topology regression.
   - Model storage burglary and shop theft as diagnostic property-crime subtypes/fingerprints.
   - Fail closed for recognized property-crime pairs unless canonical, official, exact-event, or
     bounded cross-source event evidence supports one identity.
   - Preserve conservative within-event grouping without global threshold changes or generic
     commodity evidence.
   - Treat persisted membership only as a stable-ID hint after evidence grouping; arbitrate IDs
     one-to-one and keep all blocking conflicts authoritative during clustering.
   - Fix 390 px min-content containment and verify expanded/collapsed long titles.
2. **Rotvoll collision recall**
   - Add the four-article production-shaped fixture.
   - Recognize collision vocabulary consistently.
   - Add explicit locality hierarchy and high-information time/participant evidence.
3. **Capture, identity, extraction, and clocks**
   - Preserve raw captures and field provenance append-only.
   - Separate upstream identity from similarity hints and content revisions.
   - Separate published, updated, fetched, and first-seen clocks.
   - Add extraction normalization, structural source sentinels, and a title/ingress corpus.
4. **Story editorial and feedback integrity**
   - Select deterministic best-source title/ingress independently of `latestAt`.
   - Add display provenance and versioning before any generated copy.
   - Fix saved/error/stale/correction UI state and accessibility.
   - Add categorical corrections and a non-mutating missed-group report.
5. **Promotion readiness**
   - Prove legacy/v2 parity, correction durability, and fresh production behavior.
   - Request explicit owner approval before changing the active projection.

## Baseline gates and production proof

- Disk before long loops: 61 GiB free on `/System/Volumes/Data`.
- Coverage matcher gate: 54/54 passed.
- Focused shared/frontend suites: 87/87 passed.
- Focused frontend correction/state suites: 77/77 passed.
- Worker suite: 75/75 passed.
- Current labeled matcher corpus: 20 cases, 67 articles, 69 labeled pairs; aggregate metrics are
  1.0, but the production bridge proves the corpus is incomplete and the 100-pair threshold is not
  active.
- Baseline CI: run `29344113544`, success for exact SHA `e7b8f20d`.
- Baseline deploy: run `29344488989`, success for exact SHA `e7b8f20d`.
- Live `/health`, `/health/ready`, and `/health/live`: HTTP 200. Coverage mode remains `legacy`.

## Wave 1 candidate evidence

### RED

- Legacy produced one nine-member component instead of the expected five-member storage-burglary
  group and four-member shop-theft group.
- V2 left all 16 labeled within-event pairs split because both property-crime subtypes were
  `unknown`.
- The first implementation made the subtype token itself sufficient for a fingerprint; two
  unrelated generic shop thefts then received a moderate edge despite zero title similarity.
- An ASCII word-boundary implementation classified “Tyveri i Bodø” as a storage burglary.

### Candidate implementation

- Add explicit `storage_burglary` and `shop_theft` subtypes.
- Block direct automatic pairing for recognized property-crime reports unless they have the same
  canonical URL or official situation, a shared exact-event fingerprint, or bounded cross-source
  event evidence. Bounded mixed-angle evidence requires a reported clock or specific place/entity
  plus a shared semantic detail; details alone never admit a pair. Same-source, same-subtype updates
  without direct identity may join only through independently corroborated cross-source topology.
- Admit same-subtype city fingerprints only with bounded time, overlap, and secondary details such
  as `sykkel`/`sameie` or `frokost`/`ingrediens`; generic `matvare` and police boilerplate do not
  count.
- Use Unicode-aware storage-unit boundaries and retain negative controls for Bodø and unrelated
  same-subtype shop/storage thefts.
- Remove persisted bundle membership as pair evidence. Assign legacy and worker bundle IDs
  globally with deterministic exact-ID continuity, strongest-overlap fallback, collision re-keying,
  and uniqueness checks. Clear stale singleton and unbundled metadata.
- Retain every blocking v2 conflict for clustering even when owner-facing review edges are capped.
- Constrain the 390 px grid with `minmax(0, 1fr)` and `min-width: 0`; keep supporting headlines
  ellipsized while collapsed and wrap them only when expanded.

### Candidate verification

- Corpus: 24 cases, 83 articles, 109 labeled pairs.
- Pair precision `1.0`, pair recall `1.0`, group precision `1.0`, grouping coverage `1.0`.
- False-positive pairs `0`, false-negative pairs `0`, bridge errors `0`, critical failures `0`.
- Canonical matcher gate: 78/78 passed, including direct, bridge, cap-saturation, stale-metadata,
  canonical-URL, official-situation collision, and permutation regressions.
- Shared suite: 192/192 passed. Worker suite: 295/295 passed.
- Frozen root unit/integration suite: 132 files and 1,259 tests passed.
- Frozen root typecheck, ESLint, Prettier, production build, and `git diff --check`: passed.
- Frozen full Playwright suite: 147 passed across desktop and mobile in 3.9 minutes; one
  intentional project skip. The grouped-card phone regression passed in both projects and checks
  true 390 px containment, collapsed truncation, expanded wrapping, and keyboard correction flow.
- Independent read-only release review found no remaining code blocker after 13/13 focused
  identity/matcher regressions, the 78/78 canonical gate, 9/9 worker stable-ID tests, and the City
  Pulse stable-ID API regression passed.
- A stress run that executed the full unit suite concurrently with other gates produced one
  transient existing rate-limit test failure (`Parse Error`, then `404`). The focused retry and a
  serial full-suite rerun both passed; no matcher or UI failure was involved.

## Wave 1 release execution

- PR `#26` merged to `main` as `a6c104cb189f460d125190d8ae2df108d682b669`.
- PR CI run `29356539224` and exact-main CI run `29356936042` both passed typecheck, tests,
  matcher quality, build, audit, PostGIS migration smoke, Docker build, and the full browser and
  accessibility suite.
- Deploy run `29357270812` built the candidate, passed canary health, promoted API and worker, and
  passed production health plus worker stability. It then exhausted the bounded wait for a worker
  cycle started after promotion and restored the previous API and worker images. Rollback health
  passed; the Wave 1 code was therefore not left deployed.
- The authenticated operations dashboard subsequently showed a healthy completed worker cycle at
  20:31 with duration 343 seconds, zero parse failures, and worker freshness `OK`. The deploy guard
  allowed only 18 ten-second polls after its separate startup checks and expired at 20:31:45,
  seconds before or around that normal production-sized completion.
- Follow-up policy: retain all crash, restart, health, timestamp, and rollback assertions; widen
  only the completed-cycle poll budget from 18 to 30 bounded attempts. Do not weaken the required
  post-promotion cycle identity or source-health gates.

## Visual evidence

- Desktop baseline:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f6165-5b9c-7581-abf4-288ae4844c56/nytt-siste-nytt-baseline-desktop-2026-07-14.png`
- Fresh 390 px baseline:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f6165-5b9c-7581-abf4-288ae4844c56/nytt-siste-nytt-baseline-mobile-390-2026-07-14.png`
- Expanded wrong merge at 390 px:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f6165-5b9c-7581-abf4-288ae4844c56/nytt-wrong-merge-expanded-mobile-390-2026-07-14.png`
- After screenshots: pending deployed exact-SHA verification. Frozen local Playwright assertions
  prove the containment geometry and expanded/collapsed behavior before release.

## Explicit non-claims and unresolved risks

- The Critical group is reproduced and explained, not yet fixed in production.
- Deployed shadow v2 avoids that exact cross-event bridge but under-groups both underlying theft
  events. The Wave 1 candidate groups both expected components in the corpus.
- No projection-promotion claim is made.
- No correction-path readiness claim is made while production corrections are disabled.
- Green health endpoints do not contradict the visible wrong merge or mobile overflow.
- The expanded corpus includes the new theft topology but still does not cover extraction quality
  or editorial copy quality.
- The 109 labels are correlated examples from a small topology corpus, not 109 independent
  production events and not promotion evidence for matcher v2.
- The production worker strips incoming bundle metadata before analysis. Direct-analyzer ID tests
  prove deterministic one-to-one handling, but do not by themselves prove that a fresh deployed
  legacy generation will retain the historical `coverage:0g728te` ID.
- The original production articles may age out before a deployment; if so, a fresh generation can
  prove policy behavior on the stored corpus but not the original public card.

## Recommended next action

Open the focused Wave 1 PR. Merge and deploy only after clean CI, then repeat exact-SHA health,
fresh-generation, authenticated desktop, 390 px, keyboard, expanded, and collapsed checks.
