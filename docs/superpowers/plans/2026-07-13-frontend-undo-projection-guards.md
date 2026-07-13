# Frontend Undo and Projection Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent correction undo results from crossing feed or projection boundaries and make
superseded coverage copy describe the selected historical generation honestly.

**Architecture:** Build immutable feed/projection identity helpers in `HomePage.tsx`, bind every
undo toast to those identities, clear it reactively on mismatch, and revalidate before the undo
request and before returned stories are applied. Keep coverage-page copy projection-aware through
small label helpers, while forwarding backend-owned audit filters unchanged through the URL and
API query when their shared contract is available.

**Tech Stack:** React 19, TypeScript, Vitest, Playwright, Vite.

## Global Constraints

- Frontend, E2E, frontend plan/report, and Playwright files only.
- Write and observe a failing regression before changing production behavior.
- Do not stage, commit, push, deploy, or mutate production.
- Preserve Bokmål user-facing text and URL-stable audit state.

---

### Task 1: Immutable undo context

**Files:**

- Modify: `apps/frontend/src/pages/HomePage.tsx`
- Test: `apps/frontend/src/pages/HomePage.test.tsx`
- Test: `e2e/app.spec.ts`

**Interfaces:**

- Produces: `coverageFeedKey(query)` and `coverageProjectionKey(projection, stories)` stable string
  identities, and an undo state carrying both keys.
- Consumes: `CityPulseStoryProjection.projectionRevision` when supplied; otherwise derives the
  normalized revision only from a consistent `coverageBundle.correctionTarget` revision.

- [ ] **Step 1: Write failing identity and mismatch tests**

```ts
expect(coverageFeedKey({ scope: "trondheim", category: "Alle", q: "", from, to })).not.toBe(
  coverageFeedKey({ scope: "trondelag", category: "Alle", q: "", from, to }),
);
expect(coverageUndoContextMatches(undo, changedProjection)).toBe(false);
```

- [ ] **Step 2: Run the focused test and confirm the missing helper or mismatch assertion fails**

Run: `npx vitest run apps/frontend/src/pages/HomePage.test.tsx`

- [ ] **Step 3: Implement feed/projection keys and bind undo state**

```ts
interface CorrectionUndoState {
  correctionIds: string[];
  message: string;
  feedKey: string;
  projectionKey: string;
}
```

The live undo state is cleared when either current key changes. `handleCoverageUndo` checks the
captured state against both keys before requesting undo and again after each awaited response; a
mismatch clears the toast and returns without applying replacements or announcing success.

- [ ] **Step 4: Add a browser regression for scope/filter/generation changes**

The journey splits a group, changes feed scope or filter, changes the served projection identity,
and proves the undo control disappears, no undo request is sent, no old replacement merges, and no
`Grupperingen er gjenopprettet` announcement appears.

- [ ] **Step 5: Run focused Vitest and exact desktop/mobile Playwright until green**

Run:
`npx playwright test e2e/app.spec.ts --grep "undo context|stale correction|coverage audit"`

### Task 2: Projection-aware historical copy

**Files:**

- Modify: `apps/frontend/src/pages/CoverageBundlesPage.tsx`
- Test: `apps/frontend/src/pages/CoverageBundlesPage.test.tsx`

**Interfaces:**

- Produces: superseded-specific hero, summary, and group-list labels.

- [ ] **Step 1: Write a failing superseded render test**

```ts
expect(html).toContain("Valgt generering");
expect(html).toContain("Grupper i genereringen");
expect(html).not.toContain("siste vellykkede generering");
expect(html).not.toContain("Aktive grupper");
```

- [ ] **Step 2: Run the focused test and confirm the old active/latest copy fails it**

Run: `npx vitest run apps/frontend/src/pages/CoverageBundlesPage.test.tsx`

- [ ] **Step 3: Implement the smallest projection-aware label selection**

Use `selectedProjection === "superseded"` to select `Valgt generering`,
`Grupper i genereringen`, and `Grupper i valgt generering`; keep active/shadow/legacy wording
unchanged.

- [ ] **Step 4: Run focused tests until green**

Run: `npx vitest run apps/frontend/src/pages/CoverageBundlesPage.test.tsx`

### Task 3: Contract adaptation and final evidence

**Files:**

- Modify if required: `apps/frontend/src/pages/CoverageBundlesPage.tsx`
- Modify if required: `apps/frontend/src/api.ts`
- Test if required: `apps/frontend/src/pages/CoverageBundlesPage.test.tsx`
- Modify: `.superpowers/sdd/frontend-audit-remediation.md`

**Interfaces:**

- Consumes: backend canonical history/filter fields only when present in `@nytt/shared`.

- [ ] **Step 1: Reinspect shared audit query/page types after concurrent backend work**

If review filters are backend query fields, serialize them into `coverageQueryFromFilters`, keep
them in `coverageWorkspaceSearch`, render backend-returned items directly, and remove the
client-page-only caveat. If absent, record the explicit non-claim without inventing a contract.

- [ ] **Step 2: Run final verification**

Run frontend Vitest, exact desktop/mobile Playwright, frontend typecheck/build, scoped ESLint and
Prettier, and `git diff --check`.

- [ ] **Step 3: Update the SDD report and Obsidian project evidence**

Record exact counts, RED/GREEN evidence, and explicit no-stage/no-commit/no-deploy boundaries.

### Task 4: Immutable split-dialog context and live-region suppression

**Files:**

- Modify: `apps/frontend/src/pages/HomePage.tsx`
- Test: `apps/frontend/src/pages/HomePage.test.tsx`
- Test: `e2e/app.spec.ts`
- Modify: `.superpowers/sdd/frontend-audit-remediation.md`

**Interfaces:**

- Produces: a split dialog state that carries the selected `HomeStoryCard` together with the
  immutable `{ feedKey, projectionKey }` captured when the dialog opens.
- Consumes: `coverageUndoContextMatches(expected, current)` for feed/projection identity checks
  and the existing conflict-refresh helper only while the captured identity remains current.

- [x] **Step 1: Write failing unit regressions for dialog identity and raw undo suppression**

Add a pure `coverageCorrectionContextMatches` assertion covering scope, filter, generation, and
revision changes. Add an exact `coverageCorrectionLiveAnnouncement` assertion proving a raw undo
state suppresses the prior `Gruppen er splittet i 2 saker.` text even when that undo state is no
longer available in the current context.

- [x] **Step 2: Run the focused unit tests and observe RED**

Run: `npx vitest run apps/frontend/src/pages/HomePage.test.tsx`

Expected: FAIL because the new split-context/live-announcement exports do not exist yet.

- [x] **Step 3: Bind dialog state and split work to the captured context**

Replace the card-only dialog state with:

```ts
interface CoverageCorrectionDialogState extends CoverageUndoContext {
  card: HomeStoryCard;
}
```

Capture both keys in `openCoverageCorrection`. Keep the current context in one ref. Clear the raw
dialog state, pending error, and announcement on mismatch. In `handleCoverageSplit`, revalidate
before the request, after the split await, before catch/error handling, before starting a 409
refresh, and after that refresh await. A mismatch silently clears the stale dialog and must not
merge, refetch, focus, or announce.

- [x] **Step 4: Suppress the live region from raw undo state**

Render split/undo announcements through:

```ts
coverageCorrectionLiveAnnouncement(Boolean(undoState), correctionAnnouncement);
```

Do not derive suppression from context-valid `availableUndoState`; the invalidation render must
remain silent until the clearing effect removes both the raw undo state and old announcement.

- [x] **Step 5: Add exact browser regressions**

Add deterministic journeys for (a) changing route/filter/generation while the dialog is open,
(b) changing context while a successful split request is held in flight, and (c) changing context
while a held split returns 409. Prove the dialog closes, old replacements and success messages are
discarded, and the stale 409 path performs no old-feed refresh.

- [x] **Step 6: Run focused and full verification, then update evidence**

Run focused HomePage Vitest and exact desktop/mobile Playwright first, then all frontend Vitest,
frontend typecheck/build, scoped ESLint and Prettier, and `git diff --check`. Append exact RED/GREEN
evidence and the no-stage/no-commit/no-push boundary to the SDD report and Obsidian project note.

### Task 5: Canonical same-ID stale-refresh precedence

**Files:**

- Modify: `apps/frontend/src/pages/HomePage.tsx`
- Test: `apps/frontend/src/pages/HomePage.test.tsx`
- Test: `e2e/app.spec.ts`
- Modify: `.superpowers/sdd/frontend-audit-remediation.md`

**Interfaces:**

- Consumes: `coverageConflictRefreshState` inputs where `removedStoryId` may equal a canonical
  refreshed `page.items` story ID with changed membership.
- Produces: deterministic precedence in which stale current state is removed first, canonical page
  state overlays second, and conflict replacements remain subject to the existing article-overlap
  dedupe.

- [x] **Step 1: Write the same-ID changed-membership unit regression**

Construct a stale current story `{ id: stableId, articleIds: [anchor, rejected] }`, a refreshed page
story `{ id: stableId, articleIds: [anchor] }`, and a standalone replacement for `rejected`. Assert
that reconciliation retains both the canonical same-ID story and the standalone replacement, with
no stale membership.

- [x] **Step 2: Extend the deterministic stale later-page E2E**

Make the refreshed first page return the canonical same-ID target with changed membership and keep
the rejected article as the conflict replacement. Assert both visible outcomes survive while older
cards, cursor, scope, scroll and focus behavior remain intact.

- [x] **Step 3: Run unit and desktop E2E regressions and observe RED**

Run: `npx vitest run apps/frontend/src/pages/HomePage.test.tsx`

Run:
`npx playwright test e2e/app.spec.ts --project desktop-chromium --grep "stale correction on a later loaded page"`

Expected: the canonical same-ID story is absent because the helper currently deletes it after
overlaying `page.items`.

- [x] **Step 4: Move stale deletion before canonical overlay**

Delete `removedStoryId` from the filtered current-state map before iterating over `page.items`.
Leave refreshed-page article precedence and replacement overlap dedupe unchanged.

- [x] **Step 5: Run focused and final verification and update evidence**

Run focused HomePage Vitest, the exact relevant E2E on desktop and mobile, full frontend Vitest,
frontend typecheck/build, scoped ESLint and Prettier, and `git diff --check`. Append exact evidence
to the SDD report and the existing Obsidian project section. Do not stage, commit or push.

### Task 6: Authoritative split-replay projection revision

**Files:**

- Modify: `apps/frontend/src/pages/HomePage.tsx`
- Test: `apps/frontend/src/pages/HomePage.test.tsx`
- Test if feasible: `e2e/app.spec.ts`

**Interfaces:**

- Produces: `coverageSplitProjectionRevision(expectedProjectionRevision, replacementStories)`,
  returning the revision carried by replacement-story correction targets before using the bounded
  `expectedProjectionRevision + 1` fallback.
- Consumes: replay responses where a duplicate split returns the unchanged canonical revision.

- [x] **Step 1: Write the replay identity regression**

Create a replacement story carrying revision `7` and an expected request revision of `7`. Assert
that the derived post-split revision remains `7`, its projection key matches the next canonical
revision-`7` refresh, and `coverageUndoContextMatches` remains true. Also assert replacement stories
without revision metadata fall back to `8`.

- [x] **Step 2: Run focused HomePage Vitest and observe RED**

Run: `npx vitest run apps/frontend/src/pages/HomePage.test.tsx`

Expected: FAIL because the authoritative replay helper does not exist and the current handler
always advances an expected revision.

- [x] **Step 3: Implement response-first revision derivation**

Implement the helper as:

```ts
return (
  coverageProjectionRevision(undefined, replacementStories) ??
  (expectedProjectionRevision === undefined ? undefined : expectedProjectionRevision + 1)
);
```

Use it when building `nextProjection` after split success. Do not change undo, context-race, or
conflict-refresh behavior.

- [x] **Step 4: Add an exact replay browser regression if bounded route mocks remain practical**

Return a successful duplicate split whose replacement stories retain revision `7`, then return the
same canonical revision from manual refresh. Assert the undo toast remains available rather than
being invalidated by a fabricated local revision.

- [x] **Step 5: Run focused frontend/static verification**

Run focused HomePage Vitest, frontend typecheck, scoped ESLint/Prettier, `git diff --check`, and the
exact relevant E2E if added. Record no stage, commit or push.
