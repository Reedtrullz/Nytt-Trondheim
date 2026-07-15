# Siste nytt quality audit and delivery record

**Status:** Ingestion-integrity and UI-state waves deployed; independent editorial-copy wave active

**Started:** 2026-07-14

**Baseline:** `origin/main` at `e7b8f20dd20db1f7dc949c1c7f28143dea392e3b`

**Current deployed baseline:** `95ed5d9efa01b73cd3af3302aed475782c9aa3ab`

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

### Resolved Important — one Rotvoll collision was split into two cards

Four reports at 17:25 local time describe five people involved, no reported injuries, and the
Haakon VIIs gate/Rotvoll area:

- `nrk-95293370d71dbc53`
- `politiloggen-261sx6`
- `adressa-3d7b41fd5648af44`
- `nidaros-0696d7ebaf2d0293`

Legacy shows two adjacent two-source cards. Shadow v2 groups only Adressa and Nidaros; exact place
comparison blocks the Politiloggen article because its structured label is broader/different even
though the text names the precise location. Generic NRK copy remains a singleton.

**Release proof:** PR `#31` merged as exact main `2c4a35bc3c2d74f90cbb946761790648a6fd1915`.
PR CI `29371289064`, exact-main CI `29371578900`, and deploy `29371880892` passed. After the
fresh promoted worker cycle, authenticated production showed one Rotvoll card containing the four
exact production records from NRK, Politiloggen, and Adresseavisen, with no duplicate card.

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

- Saved overrides now survive split/undo replacement, failed filtered feeds do not claim a false
  empty result, and refresh work is bound to the current feed/projection context.
- Correction focus restoration and concise live announcements are covered by browser regressions;
  expanded supporting headlines wrap while collapsed rows remain intentionally truncated.
- The non-mutating missed-group report is deployed below.
- The retained-data loading/stale/error candidate below locks owner audit decisions until the
  selected server view is fresh and gives failed refreshes an explicit retry path.

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
- PR `#27` merged the bounded worker-cycle wait as
  `ad2b4f4aa4c90466f5935f27c6fc0e408d314609`. Exact-main CI run `29359223701` and deploy run
  `29359579775` passed. Authenticated production readback at 21:16 Europe/Oslo showed the former
  nine-article theft bridge split into a five-article Moholt burglary story, and a fresh 390 px
  load measured `390/390` document/body/main width with no horizontal overflow. Public `/health`,
  `/health/live`, and `/health/ready` returned PostgreSQL-backed HTTP 200 while coverage remained
  `legacy`.

## UI failure-state integrity candidate

- A filtered `/api/city-pulse/stories` HTTP 503 rendered both “Kunne ikke hente saker” and the
  contradictory “Ingen saker samsvarer” empty result.
- The browser regression failed on exact `origin/main` because the false empty claim remained
  visible, then passed on desktop and mobile after the empty-state branch was made conditional on
  the absence of `feedError`.
- Verification: focused browser `2/2`, focused HomePage `48/48`, root unit/integration `1,259/1,259`,
  full browser/accessibility `149` passed with `1` intentional skip, typecheck, ESLint, Prettier,
  production build, `git diff --check`, and production dependency audit with `0` vulnerabilities.

## UI failure-state release execution

- PR `#28` merged to `main` as `9c803933e627112ccb86965620e98b7fc9b5f607`.
- Exact-main CI run `29362326016` and deploy run `29362672278` passed.
- Authenticated 390 px production fault injection proved the filtered-feed HTTP failure renders the
  error state without an empty-result claim or loading residue; document and body widths were both
  `390` px. The test changed browser network behavior only and did not mutate production data.

## Wave 2 candidate — Rotvoll collision recall

Status: release candidate on exact `origin/main`; no active projection or correction setting is
changed.

- Add a cross-source high-information traffic-collision fingerprint with a two-hour publication
  window. Both reports must independently contain collision language, the same normalized exact
  road, the same explicit reported incident clock, and the same explicit involved-person count.
- Normalize the observed `Haakon VIIs gate` / `Håkon VIIs gate` spelling inside road evidence; do
  not equate `Lade` and `Rotvoll`. Only the complete fingerprint can override their otherwise
  blocking structured-place conflict.
- Make any mutually present but mismatching road, clock, or participant evidence blocking even
  when another fingerprint field is absent. This prevents a sparse contradictory report from
  entering through generic similarity paths.
- Align v2 collision vocabulary with legacy for `trafikkuhell` and contextual `sammenstøt` or bare
  `ulykke`. Bare `ulykke` requires transport, vehicle, road, or traffic context; an identically
  timed workplace accident does not satisfy the fingerprint.
- Keep the rule cross-source and fail closed when a road, clock, participant count, compatible
  category, publication bound, or situation identity is missing or incompatible.
- RED provenance: the production-shaped fixture initially had six false-negative within-event
  pairs and three false-positive control pairs. The candidate groups the four sanitized NRK,
  Politiloggen, Adresseavisen, and Nidaros reports while keeping different-road, different-clock,
  different-count, same-source, and workplace-accident controls separate.
- Fresh exact-main release gates: focused Rotvoll `1/1`, canonical matcher `79/79`, root
  unit/integration `132` files and `1,260/1,260` tests, full browser/accessibility `149` passed with
  `1` intentional skip, root typecheck, ESLint, Prettier, production build, `git diff --check`, and
  production dependency audit with `0` vulnerabilities.

## Wave 2 release readback and apostrophe hotfix

- PR `#29` merged to `main` as `dff03160f139fa690abe9af61096011e2b95cf9f`. PR CI run
  `29364889915`, exact-main CI run `29365238141`, and deploy run `29365557315` passed. The deploy
  retained `legacy` projection, disabled corrections, promoted API and worker, and accepted a fresh
  completed worker cycle after 25 bounded retries.
- Authenticated production readback after that fresh cycle still showed the Rotvoll collision as
  two adjacent cards. This blocks a production-fix claim despite the green deploy.
- The visible Adresseavisen ingress uses the real spelling `Haakon VII’s gate` with a typographic
  apostrophe. The candidate fixture had simplified it to `Haakon VIIs gate`, and the road extractor
  therefore omitted the production road token and the Politiloggen-to-Adresseavisen bridge.
- Replacing the fixture value with the exact production spelling reproduced RED on deployed main:
  the focused test lost `shared_high_information_traffic_collision`. The hotfix accepts ASCII or
  typographic apostrophes only between a Roman road-name numeral and genitive `s`; all existing
  exact-road, clock, participant, source, and incident controls remain unchanged.
- Hotfix gates: focused Rotvoll `1/1`, canonical matcher `79/79`, root unit/integration `132` files
  and `1,260/1,260` tests, full browser/accessibility `149` passed with `1` intentional skip, root
  typecheck, ESLint, Prettier, production build, `git diff --check`, and production dependency audit
  with `0` vulnerabilities.

### Exact-payload follow-up after PR #30

- PR `#30` merged as `721c6a7b1d7d6a7b63a4206cb6367ec1a6b4395d`. PR CI run
  `29367614193`, exact-main CI run `29368042871`, and deploy run `29368385596` all passed. The
  deploy kept `legacy`, corrections disabled, matcher `v2` in shadow, passed canary and production
  health, accepted a fresh worker cycle with `8` retries left, and ended with
  `ok=53 changed=11 unreachable=0 failed=0 skipped=2`.
- A fresh authenticated production tab still showed the same two Rotvoll cards after that worker
  cycle. The authenticated `scope=trondheim` story payload then proved that the stored
  Politiloggen excerpt is `Haakon VII,s gate` and contains no textual clock. Its authoritative
  `17:25` is represented by the Politiloggen publication timestamp. The previous sanitized fixture
  had incorrectly supplied both a conventional genitive and an explicit clock.
- The corrected production-shaped fixture now contains the four exact topology roles: sparse NRK
  copy with explicit `17.25` and five people at Lade; official Politiloggen copy with
  `Haakon VII,s gate`, five people, a Politiloggen situation ID, and publication minute `17:25`;
  the Adresseavisen news-studio report with `Haakon VII’s gate`; and the sparse Adresseavisen
  follow-up sharing publisher story key `/i/7pBg7v/`.
- The follow-up candidate accepts the observed comma-genitive road spelling, uses the Oslo-local
  publication minute only for official Politiloggen situation records when their text has no
  clock, and adds an official collision-companion edge only when clock, participant count, place,
  category, source, and publication window agree. An exact road+clock+count bridge may resolve a
  group-level Lade/Rotvoll label conflict only when every member is a traffic-collision report and
  no pair has a road, clock, participant, property-crime, or situation-ID conflict.
- RED reproduced with the exact stored payload. GREEN is focused Rotvoll `1/1`, the full golden
  file `18/18`, and root unit/integration `132` files and `1,260/1,260` tests. Root typecheck,
  ESLint, Prettier, production build, `git diff --check`, and production dependency audit with
  `0` vulnerabilities also pass. Full browser/accessibility E2E passed `149` tests with `1`
  intentional skip in `3.9m` across desktop and mobile projects.
- Separate ingestion-integrity finding: an authenticated unscoped `limit=50` story payload grouped
  the later NRK Namdalseid collision `nrk-f31a5b03caaf7b65` with
  `politiloggen-261sx6` under the Rotvoll situation bundle, while the Trondheim-scoped payload
  returned the expected NRK Trondheim article. This scope-dependent cross-event merge is not
  claimed fixed by the Rotvoll candidate and remains a Critical follow-up.

### Exact-identity candidate for the scope-dependent Namdalseid false merge

- The destructive boundary precedes the matcher: `articleDedupeKey` used source, normalized title,
  and published hour as hard identity. Two distinct URLs could therefore resolve to one stored ID;
  the later record could inherit the older article's URL and situation linkage before legacy/v2
  analysis. Scope filtering then hid or exposed the contaminating record, producing different
  public grouping topology for the same event.
- Alternatives considered: hardcode the Namdalseid pair, tighten the title/time tuple, or separate
  durable identity from similarity. The candidate uses the smallest safe part of the third option:
  source + canonical URL is hard identity, matching the existing media source contracts. Headline
  and time remain matcher evidence rather than destructive storage identity.
- TDD RED used production IDs `nrk-95293370d71dbc53` and `nrk-f31a5b03caaf7b65` with the same
  generic source/title/hour but different canonical URLs, scopes, places, and ingresses. Baseline
  retained only the first ID (`1` failed, `45` passed). GREEN retains both and still collapses
  duplicate snapshot rows sharing one canonical URL (`47/47`).
- The critical Rotvoll corpus now includes the Namdalseid record as a strict negative against all
  four Rotvoll members. Legacy/v2 golden and permutation proof passes; the complete matcher gate is
  `79/79`. Full worker proof is `26/26` files and `296/296` tests after a local shared build. Full
  repository Vitest is `132/132` files and `1261/1261` tests; full Playwright/accessibility is `149`
  passed with `1` intentional skip. Typecheck, lint, format, production build, diff check, and the
  production dependency audit with `0` vulnerabilities pass.
- This changes no matcher threshold, time window, place hierarchy, situation activation rule,
  projection mode, correction capability, or database schema. Existing rows migrate lazily as the
  successful source cycle re-ingests their canonical URLs.

### Exact-identity release and live readback

- PR `#32` merged to `main` as `acac3f63ac98e07c0566a4a491740abac95f978d`. PR CI run
  `29374304051`, exact-main CI run `29374630748`, and deploy run `29374911886` passed.
- The deploy retained `legacy` projection, disabled corrections, ran matcher `v2` in shadow,
  passed canary and health checks, accepted a fresh worker cycle with `7` retries left, and ended
  with `ok=53 changed=11 unreachable=0 failed=0 skipped=2`.
- Authenticated production readback after the fresh generation showed the Rotvoll bundle as the
  expected four articles from three sources. The unscoped `limit=50` response separately returned
  Namdalseid as singleton `article:nrk-f31a5b03caaf7b65`, with its own canonical NRK URL,
  `trondelag` scope, no situation ID, and no Rotvoll member IDs. The scope-dependent cross-event
  contamination is therefore live-closed.

## Source-clock and structural-health candidate

- Baseline collectors replaced invalid RSS, municipal, and Politiloggen publication timestamps
  with collection time. That can reorder old records as new and lets untimestamped Politiloggen
  corrections change the latest lifecycle state. Several structurally empty HTTP `200` responses
  also returned an empty success and could report a broken source shape as healthy.
- TDD RED reproduced ten failures across RSS, public front pages, Trondheim kommune, and
  Politiloggen: invented current clocks, retained untimestamped records, accepted empty or malformed
  successful payloads, and applied an untimestamped resolution message.
- The candidate admits only parseable upstream timestamps. Mixed responses skip individual
  unusable records while preserving independently valid records. A source degrades only when a
  successful response has no recognizable candidates or no usable timestamp. Politiloggen HTTP
  `204` remains the explicit empty-snapshot success; a `200` must contain a non-empty
  `messageThreads` array with at least one usable timestamped thread.
- GREEN proof: focused collector/Politiloggen `40/40`, complete worker `26/26` files and `307/307`
  tests, matcher gate `79/79`, and full repository Vitest `132/132` files and `1272/1272` tests.
  Full browser/accessibility E2E passed `149` tests with `1` intentional skip across desktop and
  mobile in `3.8m`. Root typecheck, ESLint, Prettier, production build, `git diff --check`, and
  production dependency audit with `0` vulnerabilities pass. This candidate changes no matcher,
  activation, schema, projection, correction, or disappearance semantics.

### Append-only capture-history candidate

- The current `source_items` row is an operational projection: a new capture with the same stable
  source identity updates `raw_payload`, `normalized_payload`, `capture_hash`, and `fetched_at`.
  Before this candidate, that destroyed the prior revision and made transformation changes
  impossible to reconstruct.
- The candidate adds expand-compatible `source_item_captures` storage. Every distinct provider +
  capture hash is inserted once with the stable current source-item link, first-seen, upstream
  publication, optional upstream-update, and collection clocks plus the raw and normalized payloads
  present at ingestion. Existing current rows are idempotently backfilled as their first retained
  capture; current projection updates remain unchanged for existing readers.
- TDD RED proved the schema and repository had no append-only capture path (`2` focused failures).
  GREEN is `77/77` focused schema/repository/deploy-contract tests, `1273/1273` repository-wide
  tests, `149` Playwright scenarios passed with `1` intentional desktop-only skip, typecheck, lint,
  formatting, production build, and diff checks. The candidate also updates the lockfile to patched
  in-range toolchain and transitive releases after newly published advisories made the dependency
  gate fail; the production dependency audit returns `0` vulnerabilities.
- Non-claim: media adapters still supply the already cleaned article as their `rawPayload`; this
  foundation makes revisions append-only but does not yet claim faithful RSS/JSON-LD/OpenGraph raw
  field retention. The next adapter wave must populate that boundary without exposing raw payloads
  through article or list APIs.
- The first production attempt (`Deploy to VPS` run `29379681932`) applied the migration and passed
  API health, but the candidate worker restarted during the stability window. Rollback restored the
  previous API/worker images and production health. A real PostGIS reproduction exposed PostgreSQL
  `42P18`: the capture insert supplied unused bind positions that the unit mock could not type.
  The hotfix uses ten contiguous referenced parameters and adds a regression requiring every supplied
  bind position to occur in the SQL. Two identical real-repository article upserts now retain exactly
  one capture without error.

### Faithful media adapter captures candidate

- RSS/Atom articles now carry the exact parsed public feed item, explicit extraction field names,
  and bounded public paragraph evidence when Adresseavisen Nyhetsstudio enrichment is used.
- Public-frontpage articles retain the exact JSON-LD `NewsArticle` object or anchor href/text that
  produced the candidate, matched Amedia `articleLastModified` evidence, and individual public
  OpenGraph/article metadata fields used by a bounded detail fetch. Trondheim kommune retains the
  exact card href/text and public `article:published_time` value.
- Politiloggen articles retain the exact public message-thread object. A parseable latest upstream
  thread/message clock becomes `sourceUpdatedAt`; RSS/Atom `updated`, JSON-LD `dateModified`,
  OpenGraph `article:modified_time`, and Amedia `articleLastModified` populate the same capture-only
  clock when present.
- Collection evidence is attached under a JavaScript Symbol so geocoding spreads preserve it while
  article JSON, coverage payloads and public APIs cannot serialize it. The repository consumes it
  before canonicalization and falls back to the prior normalized-article payload for callers that
  do not supply capture evidence.
- Article capture hashes now include retained raw evidence and the source revision clock. Upstream
  edits that normalize to the same title/excerpt no longer collapse into one historical capture.
- Proof: worker typecheck and `88/88` focused collector, Politiloggen and repository tests pass;
  full serial Vitest passes `1274/1274` across `132/132` files; root format, lint, typecheck,
  production build, diff check and production audit with `0` vulnerabilities pass. A disposable
  real PostGIS 16 database applied the schema twice and proved one current source item retains two
  raw upstream revisions with distinct `sourceUpdatedAt` clocks and shared current-item FK. The
  same real-database smoke is now part of the CI migration job. Browser/accessibility E2E passes
  `149` scenarios with `1` intentional desktop-only skip.
- Release readback: PR `#36` merged as `a2fdc8c14456cb6a9cc947274973fc7790149bd1` with green
  PR and exact-main CI. The first deploy lost SSH during image build; the second created and
  verified encrypted snapshot `7f081dff` but a later Google Drive/rclone restore read timed out
  before migration or promotion. PR `#37` added one bounded whole-operation retry while retaining
  the fail-closed archive checks and merged as `5144bb49848a5d7159555bdf0190967e0e3cbc8e`.
  Exact-main CI `29384288768` and deploy `29384507987` passed. The deploy verified backup/restore,
  migration, canary, production health, 45-second worker stability, a fresh completed worker cycle,
  source health, append-only capture coverage and TravelTime exclusion; recap was
  `ok=54 changed=12 unreachable=0 failed=0 skipped=2 rescued=0`. Public health/live/ready returned
  `200`; authenticated source-clock/capture inspection remains unclaimed because the existing
  Chrome session was unavailable.

### Deterministic editorial-copy candidate

- Matcher/persistence `primaryArticleId` remains the coverage anchor. The story contract now adds
  optional, versioned `editorialSelection` provenance (`best-source-v1`) so copy selection can
  evolve without redefining matcher identity or breaking older clients.
- Selection is deterministic and excludes publication time: useful non-boilerplate ingress first,
  newsroom then official source tier, ingress/title information, and stable source/URL/ID
  tie-breaks. Known press-ethics/legal boilerplate is not treated as a useful ingress.
- `latestAt` is independently the maximum member publication clock. Public cards use the selected
  article for title, ingress and category while retaining the newest story timestamp. Polling and
  pagination recompute selection when story members merge. The card separately retains its
  coverage anchor for corrections, so choosing better display copy cannot change split semantics.
- A five-case labeled golden corpus covers newsroom-over-newer-official, useful-official-over-
  boilerplate, richer newsroom copy, best available title without ingresses, and a timestamp-
  independent tie. Forward/reverse ordering plus direct story, card, merge and correction-anchor
  tests pass. Full Vitest is `1283/1283` across `133/133` files; format, lint, full typecheck,
  production build, dependency audit (`0` vulnerabilities), diff check, and the complete desktop/
  mobile Playwright suite (`149` passed, `1` intentional skip) pass.
- Release proof: PR `#38` merged as exact `main`
  `75b12872f76fe689a29237baf1533f9df2f1739f`. PR CI `29399970544`, exact-main CI
  `29400322546`, and deploy `29400651370` passed. The deploy verified encrypted backup/restore,
  migration, canary, production health, 45-second worker stability, a fresh completed cycle,
  traffic/DATEX/Entur/source-item checks, append-only captures and TravelTime exclusion; recap was
  `ok=54 changed=11 unreachable=0 failed=0 skipped=2 rescued=0`. Public health/live/ready returned
  `200`, bootstrap returned `401`, and the rollout remained `legacy`, corrections disabled,
  matcher `v2`, generation shadow.

### Non-mutating missed-group feedback candidate

- The owner can choose one visible story and then a second story through a quiet two-step
  “Mangler samling?” flow. Selection, cancellation, submission success and failure are announced
  without adding a second competing live region.
- Submission records an idempotent, owner-only `together` label. It snapshots both story IDs,
  stable coverage anchors, complete member article IDs, projection mode, matcher version and the
  normalized generation ID when applicable. It does not merge cards or change a projection.
- The report remains available while coverage corrections are disabled. A sanitized 30-day export
  sits beside the existing split-correction export in `/command/dekning`; private reason and actor
  fields are excluded from the evaluation payload.
- The schema is additive and expand-compatible. Article anchors are protected by foreign keys,
  normalized reports retain their generation foreign key, memberships cannot overlap, and the
  unordered anchor pair is unique so retries cannot multiply labels.
- Current proof: full Vitest passes `1289/1289` across `134/134` files; root typecheck, lint,
  format, production build, dependency audit (`0` vulnerabilities), and diff check pass. Focused
  API/store/UI/migration proof passes `190/190`; full desktop/mobile Playwright passes `151` with
  `1` intentional desktop-only skip. A disposable PostGIS 16 database applied the schema twice and
  the real PgStore lifecycle smoke proved idempotent reports, sanitized export, unchanged public
  projection membership, current-generation corrections and one bounded projection materialization.
- Release proof: PR `#39` merged as exact `main`
  `202af513988fba0aa53f2a9690e9e98f9f9bac92`. PR CI `29403207781`, exact-main CI
  `29403620850`, and deploy `29403957710` passed. The deploy verified encrypted backup/restore,
  migration, canary and production health, 45-second worker stability, a fresh completed worker
  cycle, traffic/DATEX/Entur/source-item checks, append-only capture coverage and TravelTime
  exclusion; recap was `ok=54 changed=11 unreachable=0 failed=0 skipped=2 rescued=0`.
  Public health/live/ready returned `200`, bootstrap returned `401`, and the root returned `200`.
  The rollout remained `legacy`, corrections disabled, matcher `v2`, generation shadow.
- Non-claim: authenticated production feedback submission and sanitized export have not been
  visually exercised because the existing authenticated Chrome connection is unavailable.

### Coverage audit retained-data integrity candidate

- A filter change kept the previous server page visible under the new URL while the replacement
  request was pending. A failed request then retained those rows indefinitely. Neither state said
  that the data belonged to the previous query, and row selection, split, undo and pagination
  remained available against that retained snapshot.
- The candidate tracks initial load, fresh data, retained-data refresh and stale failure separately.
  Retained rows stay visible for orientation, but the workspace announces the refresh with
  `aria-busy`, labels failed data as last fetched, and locks row selection, pagination, split and
  undo until a fresh response arrives. Failed refreshes expose one explicit “Prøv igjen” action.
- Request IDs still prevent older responses from replacing newer filter state. Mutation refreshes
  use the same freshness boundary, and server-side authorization, CSRF and correction semantics are
  unchanged.
- Current proof: focused dashboard unit/render tests pass `24/24`; the combined keyboard,
  accessibility, retained-refresh and stale-failure Playwright flow passes on desktop and 390 px
  mobile (`2/2`). Full Vitest passes `1291/1291` across `134/134` files; full desktop/mobile
  Playwright passes `151` with `1` intentional desktop-only skip. Root typecheck, ESLint, Prettier,
  production build, dependency audit (`0` vulnerabilities) and diff checks pass.
- Release proof: PR `#40` merged as exact `main`
  `95ed5d9efa01b73cd3af3302aed475782c9aa3ab`. PR CI `29405774110`, exact-main CI
  `29406139390`, and deploy `29406468852` passed. The deploy verified encrypted backup/restore,
  migration, canary and production health, worker stability, a fresh completed worker cycle,
  source checks, append-only capture coverage and TravelTime exclusion; recap was
  `ok=54 changed=11 unreachable=0 failed=0 skipped=2 rescued=0`. Public health/live/ready and the
  root returned `200`, bootstrap returned `401`, and the rollout remained `legacy`, corrections
  disabled, matcher `v2`, generation shadow.

### Independent title/ingress provenance candidate

- The deployed `best-source-v1` selection chooses one article for title, ingress and category. A
  source with the best title can therefore lose to an article with a better ingress, and choosing
  the title article also forces its empty, duplicated or boilerplate ingress onto the public card.
- Alternatives considered: keep one selected article, generate new prose, or independently select
  source-backed title and ingress. The candidate chooses independent selection as the smallest
  reversible step. It does not introduce free-form generation without authenticated evidence and
  a stronger claim-support contract.
- The additive `editorialCopy` contract is versioned as `independent-source-v1`. Each field carries
  exact source article ID, source field and rationale. If no supported ingress exists, the story
  records `insufficient_supported_source_text` and renders no invented fallback sentence.
- Title policy rejects generic labels, quote-led or colloquial risk, headlines over 110 characters,
  and repeated three-word phrases before comparing source tier and information content. Ingress
  policy rejects legal boilerplate and headline duplicates after punctuation-insensitive
  normalization. Publication time is never a copy-quality tie-breaker; `latestAt` remains the
  newest member clock and matcher `primaryArticleId` remains the coverage/correction anchor.
- The labeled copy corpus covers independent source fields, unsupported-ingress forbidden claims,
  deterministic ordering, Dora neutral wording, the E.C. Dahls regulatory follow-up, long mobile
  headlines and repeated phrases. RED reproduced missing provenance plus promotion of the repeated
  support headline; GREEN is `7/7` copy cases, `1,299/1,299` repository Vitest tests, and the full
  desktop/mobile Playwright suite with `151` passed and `1` intentional desktop-only skip. Root
  typecheck, ESLint, Prettier, production build, dependency audit (`0` vulnerabilities), and diff
  checks pass. Release proof is pending.
- Non-claim: no generated editorial sentence is emitted. Authenticated production title/ingress
  readback remains blocked by the unavailable existing Chrome connection, and no fresh browser is
  opened without owner permission.

## Visual evidence

- Desktop baseline:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f6165-5b9c-7581-abf4-288ae4844c56/nytt-siste-nytt-baseline-desktop-2026-07-14.png`
- Fresh 390 px baseline:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f6165-5b9c-7581-abf4-288ae4844c56/nytt-siste-nytt-baseline-mobile-390-2026-07-14.png`
- Expanded wrong merge at 390 px:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f6165-5b9c-7581-abf4-288ae4844c56/nytt-wrong-merge-expanded-mobile-390-2026-07-14.png`
- Deployed desktop readback after PR `#27`:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f620c-0f41-7060-ad3d-d78d5aca86df/nytt-siste-nytt-desktop-ad2b4f4a-baseline.png`
- Deployed fresh 390 px readback after PR `#27`:
  `/Users/reidar/.codex/visualizations/2026/07/14/019f620c-0f41-7060-ad3d-d78d5aca86df/nytt-siste-nytt-mobile-390-loaded-ad2b4f4a.png`

## Explicit non-claims and unresolved risks

- The original Critical theft bridge and 390 px overflow are fixed in the authenticated deployed
  readback. This does not prove every property-crime topology or responsive state is correct.
- The Rotvoll collision and unscoped Namdalseid contamination are fixed on authenticated deployed
  readback. This does not prove every same-title or same-hour topology is correct.
- No projection-promotion claim is made.
- No correction-path readiness claim is made while production corrections are disabled.
- Green health endpoints do not contradict the visible wrong merge or mobile overflow.
- The editorial golden corpus is deliberately small and policy-oriented. It does not yet prove
  every adapter's extraction quality or every live title/ingress shape.
- The 127 Wave 2 labels are correlated examples from a small topology corpus, not 127 independent
  production events and not promotion evidence for matcher v2.
- The production worker strips incoming bundle metadata before analysis. Direct-analyzer ID tests
  prove deterministic one-to-one handling, but do not by themselves prove that a fresh deployed
  legacy generation will retain the historical `coverage:0g728te` ID.
- The original production articles may age out before a deployment; if so, a fresh generation can
  prove policy behavior on the stored corpus but not the original public card.

## Recommended next action

Finish the coverage-audit retained-data candidate through the full browser gate, signed PR,
exact-main CI, deploy and public readback. Verify authenticated editorial cards and feedback UX
when the existing Chrome session is available. Keep v2 projection promotion and corrections
disabled until their separate owner-review gate is satisfied.
