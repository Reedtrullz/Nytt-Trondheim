# Siste nytt Similar-Case Redesign

**Status:** Approved design
**Date:** 2026-07-13
**Repository:** `/Users/reidar/Projectos/Nytt`
**Production surface:** `Siste nytt` and owner-only `/command/dekning`

## Problem

Nytt Trondheim's coverage-bundle feature can turn several reports about the same case into one useful Siste nytt card. Correct groups, such as the current Rosenborg match coverage and syndicated profile coverage, reduce repetition and make source diversity visible.

The current implementation also creates authoritative-looking false groups. Production review found fresh `high`-confidence bundles that combined unrelated public-order and fire stories. The matcher accepts broad generic incident terms without positive shared-place evidence, clustering admits a member that matches only one existing member, and every multi-source group receives high confidence. Public `Kildetillit` and `Verifisert` presentation can then amplify a match error.

The owner audit and public feed also disagree about current grouping, persisted bundle rows accumulate dangling article references, near-miss diagnostics overwhelm the review surface, and a grouped phone-width card expands every article inline.

## Goal

Group the greatest reasonable amount of related coverage while making incorrect grouping immediately reversible, keeping match confidence separate from source trust and factual verification, and turning owner corrections into durable evaluation evidence.

## Non-goals

- Do not add anonymous or public mutation. Correction actions remain owner-only.
- Do not use an external AI or embedding service in the first redesign.
- Do not allow coverage bundles or corrections to create situations or count as upstream evidence.
- Do not infer incidents from disappearance of articles or bundles.
- Do not build a general-purpose moderation platform.
- Do not automatically generalize one correction into a rule that suppresses unrelated future article pairs.
- Do not remove the legacy bundle representation until dual-read parity is proven in production.

## Product Policy

The system is balanced rather than maximally conservative:

- Strong evidence groups automatically.
- Moderate evidence groups when it agrees with the anchor or a quorum of existing members.
- Weak evidence remains an owner-review candidate and cannot bridge clusters.
- An active owner rejection always prevents the rejected article pair from sharing a group, even if a later matcher version would accept it. Stronger later evidence appears as a review candidate; it never silently overrides the owner.
- Uncertain articles remain separate public cards.
- The owner may immediately split a bad group and immediately undo that correction.

This policy prefers useful recall while ensuring one weak bridge cannot contaminate a cluster.

## Architecture and Subprojects

The redesign is split into three independently shippable subprojects. Each receives its own implementation plan after this specification is approved.

1. **Matching and trust safety:** pairwise evidence, constrained clustering, independent match/source/verification semantics, and a labelled evaluation harness.
2. **Durable lifecycle and corrections:** normalized generation/member/edge/correction storage, active projection, immediate split/undo APIs, expiry, and audit diagnostics.
3. **Seamless public and owner UX:** compact grouped cards, grouping explanations, split/undo interaction, actionable audit filters, accessibility, and shadow-to-production rollout.

Subproject 1 can ship with the existing persistence representation. Subproject 2 adds the new source of truth behind dual reads. Subproject 3 switches user-facing surfaces only after parity and safety gates pass.

## Domain Model

### Match evidence

Every evaluated article pair produces an `ArticleCoverageEdge` when it has accepted or reviewable evidence:

```ts
export type ArticleCoverageMatchTier = "strong" | "moderate" | "weak";

export interface ArticleCoverageEdge {
  articleIds: [string, string];
  tier: ArticleCoverageMatchTier;
  score: number; // inclusive 0..1
  kind: "incident" | "topic" | "update";
  signals: ArticleCoverageDecisionSignal[];
  conflicts: ArticleCoverageConflictSignal[];
  evidenceFingerprint: string;
}
```

The evidence fingerprint is a deterministic versioned digest of normalized signal kinds, place/entity/subtype evidence, time bucket, category relationship, and matcher version. It supports audit comparison; it does not create a generalized suppression rule.

`ArticleCoverageConflictSignal` explicitly represents conflicting specific places, incident subtypes, official situation IDs, opponents or other domain conflicts. Absence of a conflict is not positive match evidence.

### Independent trust dimensions

The system exposes three independent concepts:

```ts
export interface CoverageMatchConfidence {
  tier: "strong" | "moderate";
  score: number;
  rationale: string;
}

export interface CoverageTrustSummary {
  match: CoverageMatchConfidence;
  source: SourceConfidenceSummary;
  verification?: Article["publicVerification"];
}
```

- `match` describes whether the articles are the same case.
- `source` describes publisher quality and diversity.
- `verification` exists only when official evidence has a direct strong incident edge to at least one newsroom member in the same group.

No UI copy may use source diversity as a synonym for match confidence. A multi-source group is not automatically a high-confidence match.

### Generated lifecycle

The durable model uses these records:

- `coverage_bundle_generations`: one worker analysis cycle, matcher version, start/completion time, status, counts, and optional error summary.
- `coverage_bundles`: stable bundle identity, generation identity, kind, match tier/score/rationale, active or superseded state, primary article, first/last seen time, and timestamps.
- `coverage_bundle_members`: bundle-to-article membership with `primary` or `supporting` role and the edge path that justified admission.
- `coverage_bundle_edges`: accepted or reviewable pairwise evidence, score, tier, signals, conflicts, and evidence fingerprint.
- `coverage_bundle_corrections`: owner split decision, original bundle, anchor article, rejected article, matcher version, captured evidence fingerprint, optional reason, active/reverted state, actor, and timestamps.

Bundle membership and correction article IDs use foreign keys to `articles`. Generation completion and active-projection replacement occur in one transaction. A failed generation never replaces the last successful active projection.

Legacy `member_article_ids`, `signals`, `near_misses`, and embedded `Article.coverageBundle` remain readable during the expand/contract window. New normalized writes become authoritative only after parity checks pass.

## Matching Design

### Generic incident requirements

`brann`, `street_order`, and other generic incident families require positive evidence. A pair may not match solely because it has no conflicting place.

An incident edge requires at least one of:

- the same official situation ID;
- a shared specific structured place;
- one article's text explicitly mentioning the other's specific place;
- a shared named entity plus compatible incident subtype;
- a subtype fingerprint whose rule explicitly permits city-level location.

`street_order` terms such as `ungdom`, `kontroll på`, `har kontroll`, and `ruset` are supporting tokens only. They cannot satisfy the positive-evidence requirement. Fire matching distinguishes building, vehicle, vegetation, construction-site and cooking/appliance subtypes when the text provides them.

Topic grouping remains separate from incident grouping. Rosenborg topic coverage may group across different article angles around one match or announcement, but ordinary unrelated club coverage does not group merely because it mentions RBK.

### Deterministic constrained clustering

Clustering processes articles in the existing deterministic publication order:

1. Build strong, moderate and weak pairwise edges.
2. Seed components using strong edges, provided no active rejected pair or conflict exists inside the component.
3. Select the newest strongly connected article as anchor, falling back to the existing deterministic primary ordering.
4. Admit a moderate-edge article only when it has a moderate-or-strong edge to the anchor or to at least two existing members.
5. Reject any admission that introduces an active rejected pair or explicit conflict.
6. Retain weak edges and rejected moderate admissions as review candidates.
7. Never merge two existing components through one moderate or weak bridge.

Group match score is the minimum of the anchor-to-member admission scores, with a cohesion penalty when not every member has a moderate edge to the anchor. Group tier is `strong` only when every member has a strong anchor edge; otherwise an accepted group is `moderate`.

### Corrections in clustering

An active correction binds an exact unordered pair of article IDs. It survives bundle-ID and matcher-version changes and prevents those articles from sharing a generated group. The clusterer must also avoid a transitive group containing the pair.

If a later matcher produces a strong edge for a corrected pair, the edge is stored as `reviewable` with a `correction_conflict` flag. It appears in `/command/dekning` but does not change the public grouping. Undoing the correction makes the pair eligible during the next synchronous recomputation and later worker cycles.

## Correction Interaction

Every grouped Siste nytt card and bundle detail exposes `Feil gruppering?` to the authenticated owner.

1. Opening the control shows each article's source, title, publication time, and primary/supporting role.
2. The current primary is the anchor. The owner selects one or more articles that do not belong.
3. `Splitt nå` sends the expected bundle generation timestamp, anchor ID, rejected IDs, and an optional reason.
4. The server verifies authentication, owner authorization, CSRF, current active membership, and optimistic-concurrency timestamp.
5. The server writes one active correction per anchor/rejected pair and recomputes affected story components in a transaction.
6. The response contains the correction IDs and replacement stories. The frontend updates only the affected feed region, preserves scroll position, announces the result through an ARIA live region, and shows `Angre`.
7. Undo marks the corrections reverted and recomputes the affected stories immediately.

If membership changed after the panel opened, the API returns HTTP `409` with the current replacement stories. The UI explains that the group changed, closes the stale selection, and renders the current cards. Duplicate active corrections are idempotent. Missing/deleted articles produce a non-mutating `409`, not a partial correction.

The initial APIs are:

```text
POST /api/coverage-bundles/:bundleId/corrections/split
POST /api/coverage-bundle-corrections/:correctionId/undo
```

The split request and response are shared Zod-validated contracts. Split requests contain `expectedGeneratedAt`, `anchorArticleId`, `rejectedArticleIds`, and optional `reason` limited to 500 characters. Responses contain `corrections`, `removedStoryIds`, and `replacementStories`.

## Public Siste nytt UX

A grouped card renders:

- the primary headline and excerpt;
- `N saker fra M kilder`, keeping article count and unique-source count explicit;
- a kind label such as `Samme hendelse`, `Samme tema`, or `Samme oppdatering`;
- a concise evidence explanation such as `Felles sted og hendelsestype`;
- at most two supporting article rows by default;
- `Vis alle N saker fra M kilder` when more rows exist;
- source trust and verification labels with their existing accessible explanations;
- the secondary owner action `Feil gruppering?`.

Expanding a card does not navigate or alter grouping. The state is local to the card. On phone widths, the collapsed card must not exceed the equivalent of the primary content plus two compact source rows. Keyboard users can open, select, confirm, cancel, expand and undo without pointer input.

Immediate split replaces the affected card with two or more cards without a full-page reload. Focus moves to the first replacement card, the live region announces the split, and the undo control remains reachable. Feed article, story and source totals recompute from the replacement story list.

## Owner Audit UX

`/command/dekning` defaults to active bundles from the latest successful generation. Historical and superseded groups require an explicit filter.

The summary distinguishes:

- active groups;
- strong and moderate match groups;
- review candidates;
- active owner corrections;
- dangling-member integrity errors;
- matcher version and latest successful generation.

Bundle detail shows the anchor, members, admission edges, weakest accepted edge, conflicts, source trust, direct verification edge, and correction history. Filters cover weak accepted edges, missing positive place/entity evidence, corrected groups, correction conflicts, generation changes and integrity errors.

Near misses are grouped by reason with counts. The UI initially shows at most five actionable pairs per reason, ordered by score descending, and lets the owner expand a reason. It never renders every unrelated near miss in one unbounded list.

The first correction release supports split and undo. An explicit approve action may label a reviewed group without changing grouping. Manual `group these together` is deferred to a later independently reviewed change because it introduces stronger evidence-authority and conflict semantics.

## Evaluation Harness

A versioned fixture corpus stores articles, expected pair labels, expected groups, critical verification expectations, and provenance notes. It includes:

- the current correct Rosenborg group;
- the correct syndicated parent-loss profile;
- the 200 km/h reports separated from the unrelated threat/violence arrest;
- the Nærøysund construction-site fire separated from the Møllenberg cooking story;
- existing downtown order, fire subtype, collision, specific-place conflict, official-situation and stale-bundle fixtures;
- sanitized owner corrections promoted through code review.

The evaluator reports pair precision, pair recall, group precision, grouping coverage, bridge-error count, critical verification errors, and differences from the current matcher. CI fails when any critical false-positive fixture groups, any critical true-positive fixture splits, any false verification appears, or deterministic output changes between two identical runs.

Once the corpus contains at least 100 independently labelled pairs, the promotion threshold is at least 98% pair precision, at least 90% pair recall, zero critical verification errors, and grouping coverage of at least 90% of the current production matcher. Before 100 pairs, all curated expectations are hard gates and metrics are informational.

Corrections are never copied automatically into source-controlled fixtures. The owner audit offers a sanitized export containing article IDs, normalized titles/excerpts, matcher evidence and labels; adding it to the corpus requires review to prevent private or copyrighted payload leakage.

## Rollout

### Phase 1: matcher safety and shadow evaluation

- Add pair edges, constrained clustering and independent confidence dimensions behind `COVERAGE_MATCHER_VERSION=v2`.
- Keep v1 public grouping active while the worker computes v2 shadow generations.
- Compare changed bundles in `/command/dekning` and run the golden corpus in CI.
- Require seven consecutive successful worker cycles, zero critical fixture failures, and owner review of every v1/v2 changed active group before promotion.

### Phase 2: normalized lifecycle and corrections

- Apply expand-only schema changes compatible with the previous release.
- Dual-write v1 rows and normalized v2 generations.
- Compare bundle membership, primary selection and active counts for every completed generation.
- Enable split/undo only against normalized shadow data in owner QA, then enable normalized active projection after parity is clean for seven consecutive cycles.

### Phase 3: public UX promotion

- Serve public stories from the normalized active projection.
- Enable compact disclosure and owner correction controls.
- Verify authenticated desktop and 390px flows, keyboard operation, stale correction conflict, undo, totals and regional feed parity.
- Retain legacy reads for one release. Remove legacy writes and embedded bundle dependence only in a later contract migration after rollback evidence is complete.

Rollback disables v2 promotion and correction mutation, keeps correction records intact, and serves the last successful normalized projection or legacy v1 projection. A failed or partial generation cannot replace active data.

## Security, Privacy and Trust Boundaries

- All correction endpoints require the current owner role and existing CSRF protection.
- Corrections never alter upstream article content, source items, situations or public evidence.
- Actor identity uses the internal user ID; API responses expose only display-safe owner information.
- Reasons are plain text, length-limited, escaped by React, and absent from public cards.
- Logs contain correction IDs, bundle IDs and article IDs but not article bodies, session data or credentials.
- Golden-corpus exports must be sanitized and manually reviewed before commit.
- DATEX and other source credentials remain worker/server-only and never enter bundle diagnostics.

## Error Handling and Observability

- Invalid or unauthorized corrections return `400`, `401`, `403` or `409` without partial writes.
- Generation transactions record `failed` status and error class while preserving the previous active projection.
- Foreign-key or integrity failures increment an owner-visible integrity count and fail the candidate generation closed.
- Worker metrics record analysis duration, article count, accepted edge count by tier, groups by kind/tier, weak candidates, correction conflicts and generation status.
- Server metrics record split/undo success, conflict and error counts without reason text.
- The owner dashboard shows the latest successful generation, matcher version and whether the public projection matches it.

## Testing Strategy

- Shared unit tests cover signal extraction, incident subtypes, edge tiers, evidence fingerprints, corrections, constrained clustering, deterministic grouping, group confidence and verification edges.
- Property tests generate article order permutations and assert identical groups and IDs.
- Worker repository tests use PostgreSQL to prove transactional generation replacement, dual writes, foreign keys, correction persistence, expiry and failed-generation rollback.
- Server integration tests prove owner/CSRF enforcement, split, multi-split, idempotency, undo, stale `409`, missing article behavior, feed/audit parity and legacy fallback.
- Frontend render tests cover compact counts, evidence explanation, disclosure, correction selection, optimistic replacement, stale refresh, undo and ARIA announcements.
- Playwright covers authenticated desktop and 390px split/undo, keyboard-only interaction, scroll/focus preservation, regional feed parity and owner audit filters.
- Migration smoke runs schema application twice and exercises previous-release reads against the expanded schema.
- Deployment verification requires a successful worker generation, active-projection parity, exact matcher version, public health/readiness, and authenticated Siste nytt/audit smoke.

## Documentation

Update:

- `docs/ARCHITECTURE.md` with pair edges, constrained clusters, corrections and active projections.
- `docs/SECURITY.md` with correction authorization, CSRF and audit boundaries.
- `docs/DEPLOYMENT.md` with shadow/parity/promotion/rollback queries.
- `docs/SOURCES.md` to reaffirm that coverage analysis and corrections are derived decisions, never upstream evidence.
- The owner audit help copy with confidence definitions and correction semantics.

## Acceptance Criteria

The redesign is complete when:

1. Both known production false positives remain separated and both known true positives remain grouped.
2. Generic fire/order matches cannot group without positive place, entity, official-event or compatible subtype evidence.
3. One weak or moderate bridge cannot merge two otherwise separate clusters.
4. Match confidence, source trust and verification are independently computed and displayed.
5. Verification requires a direct strong official-to-newsroom incident edge.
6. Public and owner surfaces read the same latest successful active projection.
7. The owner can split one or multiple members immediately and undo the correction without reloading the page.
8. Active corrections survive bundle-ID and matcher-version changes and prevent transitive regrouping of rejected pairs.
9. Current counts exclude superseded generations, and no active bundle has a dangling article member.
10. Grouped phone-width cards show no more than two supporting rows until expanded.
11. CI enforces the golden-corpus safety gates and deterministic output.
12. Shadow, migration, rollback and authenticated desktop/mobile evidence are recorded before legacy removal.
