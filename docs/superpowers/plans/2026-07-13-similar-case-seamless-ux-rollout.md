# Similar-Case Seamless UX and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver compact, understandable grouped Siste nytt cards with immediate owner split/undo, make `/command/dekning` an actionable quality workspace, and promote the normalized v2 projection only after automated parity and authenticated desktop/mobile proof.

**Architecture:** Add focused source-cluster and correction components around the existing `HomePage` story state, with mutation responses replacing only affected stories. Make server feed assembly read a configurable normalized projection shared with the audit page, then gate promotion through parity, golden-corpus, worker-generation and browser evidence while retaining legacy fallback for one release.

**Tech Stack:** React 19, React Router, TypeScript strict mode, Vite, existing CSS system, Vitest static-render tests, Playwright, Express/PostgreSQL APIs from the lifecycle plan, GitHub Actions, Ansible and Docker Compose.

## Global Constraints

- Complete both earlier similar-case plans first.
- Follow `/Users/reidar/Projectos/Nytt/AGENTS.md` and preserve existing untracked files.
- Run `df -h /System/Volumes/Data` before long test/build loops and stop below `30Gi` free.
- Public grouping must read the same latest successful active projection as `/command/dekning` after promotion.
- The UI must say `N saker fra M kilder`; article count and unique-source count may not be conflated.
- Collapsed cards show at most two supporting rows at all widths.
- `Kildetillit` describes source mix only; match rationale uses separate copy; `Verifisert` requires the direct-edge rule from Plan 1.
- `Feil gruppering?` is owner-only, secondary, keyboard accessible, immediate and reversible.
- Split/undo preserves scroll position, restores useful focus and announces changes through an ARIA live region.
- A stale correction response replaces the affected story state without applying the requested mutation.
- Do not add public/anonymous reporting, manual force-grouping or automatic correction generalization.
- Retain legacy reads and writes for one complete release after v2 promotion.
- All user-facing copy is Bokmål and all time formatting remains `Europe/Oslo` / `nb-NO`.
- Use TDD and commit only the files named by each task.

## File Map

- Modify `apps/frontend/src/api.ts`: split/undo clients with typed `409` payloads.
- Create `apps/frontend/src/coverageStoryUpdates.ts`: pure affected-story replacement and feed-count helpers.
- Create `apps/frontend/src/coverageStoryUpdates.test.ts`: deterministic replacement/idempotency tests.
- Create `apps/frontend/src/components/news/CoverageSourceCluster.tsx`: compact two-row disclosure and explicit counts/rationale.
- Create `apps/frontend/src/components/news/CoverageSourceCluster.test.tsx`: static rendering and accessibility assertions.
- Create `apps/frontend/src/test-fixtures/homeStoryCards.ts`: reusable grouped-card factory for component tests.
- Create `apps/frontend/src/components/news/CoverageCorrectionDialog.tsx`: owner split selection and stale/error states.
- Create `apps/frontend/src/components/news/CoverageCorrectionDialog.test.tsx`: markup and interaction helper tests.
- Modify `apps/frontend/src/pages/HomePage.tsx`: integrate compact cluster, correction state, immediate replacement, focus/live region and undo.
- Modify `apps/frontend/src/App.tsx`: pass owner-only correction capability separately from save capability.
- Modify `apps/frontend/src/pages/HomePage.test.tsx`: grouped-card and mutation-state regressions.
- Modify `apps/frontend/src/homeStoryCards.ts`: explicit article/source counts, match rationale and trust separation.
- Modify `apps/frontend/src/homeStoryCards.test.ts`: derived card contract tests.
- Modify `apps/frontend/src/pages/CoverageBundlesPage.tsx`: active-first filters, bounded candidates, edges, corrections and split/undo controls.
- Modify `apps/frontend/src/pages/CoverageBundlesPage.test.tsx`: audit summary/filter/detail regressions.
- Modify `apps/frontend/src/styles.css`: compact card, dialog, toast/live-state and audit styles at desktop/390px.
- Modify `apps/server/src/config.ts`: validated coverage projection flags.
- Modify `apps/server/src/store.ts`: normalized active story projection and legacy fallback.
- Modify `apps/server/src/app.ts`: expose projection metadata in bootstrap/story responses.
- Modify `apps/server/test/articles-store.test.ts` and `apps/server/test/api.test.ts`: feed/audit parity and fallback.
- Modify `e2e/app.spec.ts`: authenticated desktop/390px split/undo, keyboard and regional parity scenarios.
- Modify `.env.example`, `docker-compose.yml`, `ansible-playbook.yml`, `.github/workflows/ci.yml`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, and `docs/SECURITY.md`.

---

### Task 1: Add typed correction clients and pure story replacement

**Files:**

- Modify: `apps/frontend/src/api.ts:1-110,250-280`
- Create: `apps/frontend/src/coverageStoryUpdates.ts`
- Create: `apps/frontend/src/coverageStoryUpdates.test.ts`

**Interfaces:**

- Consumes: `CoverageBundleSplitRequest`, `CoverageBundleCorrectionResult`, `CityPulseStory`, and existing CSRF-aware `request()`.
- Produces: `api.splitCoverageBundle()`, `api.undoCoverageCorrection()`, `CoverageCorrectionConflictError`, and `replaceCoverageStories()` for Tasks 3-4.

- [ ] **Step 1: Write pure replacement tests**

Create `apps/frontend/src/coverageStoryUpdates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CityPulseStory } from "@nytt/shared";
import { replaceCoverageStories } from "./coverageStoryUpdates.js";

function story(id: string, latestAt: string): CityPulseStory {
  const primary = {
    id: `${id}-article`,
    source: "nrk" as const,
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: id,
    url: `https://example.test/${id}`,
    publishedAt: latestAt,
    scope: "trondheim" as const,
    category: "Hendelser" as const,
    places: ["Trondheim"],
  };
  return {
    id,
    primaryArticleId: primary.id,
    primary,
    articles: [primary],
    sourceLabels: [primary.sourceLabel],
    latestAt,
  };
}

describe("replaceCoverageStories", () => {
  it("replaces only removed stories and preserves deterministic order", () => {
    const result = replaceCoverageStories(
      [
        story("newest", "2026-07-12T21:00:00.000Z"),
        story("group", "2026-07-12T20:00:00.000Z"),
        story("old", "2026-07-12T19:00:00.000Z"),
      ],
      ["group"],
      [story("split-a", "2026-07-12T20:00:00.000Z"), story("split-b", "2026-07-12T19:59:00.000Z")],
    );
    expect(result.map((item) => item.id)).toEqual(["newest", "split-a", "split-b", "old"]);
  });

  it("is idempotent when a replacement is replayed", () => {
    const first = replaceCoverageStories(
      [story("group", "2026-07-12T20:00:00.000Z")],
      ["group"],
      [story("split", "2026-07-12T20:00:00.000Z")],
    );
    const second = replaceCoverageStories(
      first,
      ["group"],
      [story("split", "2026-07-12T20:00:00.000Z")],
    );
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

```bash
npm test -- --run apps/frontend/src/coverageStoryUpdates.test.ts
```

Expected: FAIL because `coverageStoryUpdates.ts` does not exist.

- [ ] **Step 3: Implement deterministic replacement**

Create `apps/frontend/src/coverageStoryUpdates.ts`:

```ts
import type { CityPulseStory } from "@nytt/shared";

function storyOrder(left: CityPulseStory, right: CityPulseStory): number {
  return right.latestAt.localeCompare(left.latestAt) || right.id.localeCompare(left.id);
}

export function replaceCoverageStories(
  current: CityPulseStory[],
  removedStoryIds: string[],
  replacementStories: CityPulseStory[],
): CityPulseStory[] {
  const removed = new Set(removedStoryIds);
  const byId = new Map<string, CityPulseStory>();
  for (const story of current) {
    if (!removed.has(story.id)) byId.set(story.id, story);
  }
  for (const story of replacementStories) byId.set(story.id, story);
  return [...byId.values()].sort(storyOrder);
}
```

- [ ] **Step 4: Add typed API methods and `409` payload handling**

Extend `ApiError` with optional typed data:

```ts
export class CoverageCorrectionConflictError extends ApiError {
  constructor(readonly replacementStories: CityPulseStory[]) {
    super("Gruppen ble endret mens du vurderte den.", 409);
    this.name = "CoverageCorrectionConflictError";
  }
}
```

Before generic `apiErrorFromResponse`, detect the correction route's `409` response inside the two methods:

```ts
splitCoverageBundle: async (bundleId: string, input: CoverageBundleSplitRequest) => {
  const response = await requestRaw(
    `/api/coverage-bundles/${encodeURIComponent(bundleId)}/corrections/split`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (response.status === 409) {
    const body = (await response.json()) as { replacementStories: CityPulseStory[] };
    throw new CoverageCorrectionConflictError(body.replacementStories);
  }
  return responseJson<CoverageBundleCorrectionResult>(response);
},
undoCoverageCorrection: (correctionId: string) =>
  request<CoverageBundleCorrectionResult>(
    `/api/coverage-bundle-corrections/${encodeURIComponent(correctionId)}/undo`,
    { method: "POST" },
  ),
```

Refactor the current private request path without changing callers or CSRF behavior:

```ts
async function requestRaw(url: string, init?: RequestInit): Promise<Response> {
  const unsafe = init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method);
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(unsafe ? { "X-CSRF-Token": await csrfToken() } : {}),
      ...init?.headers,
    },
    ...init,
  });
  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError("Innlogging kreves", 401);
  }
  return response;
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return responseJson<T>(await requestRaw(url, init));
}
```

Add API tests proving the CSRF header remains present for both mutation methods.

- [ ] **Step 5: Run frontend API and replacement tests**

```bash
npm test -- --run apps/frontend/src/api.test.ts apps/frontend/src/coverageStoryUpdates.test.ts
npm run typecheck -w @nytt/frontend
```

Expected: tests and typecheck PASS.

- [ ] **Step 6: Commit typed correction plumbing**

```bash
git add apps/frontend/src/api.ts apps/frontend/src/api.test.ts apps/frontend/src/coverageStoryUpdates.ts apps/frontend/src/coverageStoryUpdates.test.ts
git commit -m "feat: add coverage correction client"
```

---

### Task 2: Build the compact grouped-source component

**Files:**

- Create: `apps/frontend/src/components/news/CoverageSourceCluster.tsx`
- Create: `apps/frontend/src/components/news/CoverageSourceCluster.test.tsx`
- Create: `apps/frontend/src/test-fixtures/homeStoryCards.ts`
- Modify: `apps/frontend/src/homeStoryCards.ts`
- Modify: `apps/frontend/src/homeStoryCards.test.ts`
- Modify: `apps/frontend/src/pages/HomePage.tsx:532-568,697-723,861-935`
- Modify: `apps/frontend/src/App.tsx:225-245,325-340`
- Modify: `apps/frontend/src/styles.css:1802-1845,1969-1990,14000-14030`

**Interfaces:**

- Consumes: `HomeStoryCard.group`, `matchConfidence`, safe external URLs and existing time formatting.
- Produces: `CoverageSourceCluster({ card, canCorrect, onCorrect })`, explicit `articleCount`, `sourceCount`, and `matchRationale` card fields for Task 3.

- [ ] **Step 1: Create the reusable grouped-card fixture**

Create `apps/frontend/src/test-fixtures/homeStoryCards.ts`:

```ts
import type { Article, HomeArticleGroup } from "@nytt/shared";
import { homeStoryCardForGroup, type HomeStoryCard } from "../homeStoryCards.js";

export function clusteredHomeStoryCard({
  articleCount,
  sourceCount,
}: {
  articleCount: number;
  sourceCount: number;
}): HomeStoryCard {
  const sources = ["nrk", "adressa", "nidaros", "t_a", "vg"] as const;
  const articles: Article[] = Array.from({ length: articleCount }, (_, index) => ({
    id: `cluster-article-${index + 1}`,
    source: sources[index % Math.min(sourceCount, sources.length)]!,
    sourceLabel: `Kilde ${(index % Math.max(1, sourceCount)) + 1}`,
    title: index === 0 ? "Stor gruppesak" : `Støttesak ${index}`,
    excerpt: "Sanitert testinnhold.",
    url: `https://example.test/cluster-${index + 1}`,
    publishedAt: new Date(Date.parse("2026-07-12T21:00:00.000Z") - index * 60_000).toISOString(),
    scope: "trondheim",
    category: "Sport",
    places: ["Lerkendal", "Trondheim"],
  }));
  const primary = articles[0]!;
  const group: HomeArticleGroup = {
    id: "coverage:v2:test-group",
    primary,
    articles,
    sourceLabels: [...new Set(articles.map((article) => article.sourceLabel))],
    bundle: {
      id: "coverage:v2:test-group",
      kind: "topic",
      confidence: "medium",
      reason: "Samme nyhetstema",
      generatedAt: "2026-07-12T21:00:00.000Z",
      matcherVersion: "v2",
      matchConfidence: {
        tier: "moderate",
        score: 0.76,
        rationale: "Felles tema og kamp",
      },
    },
    acceptedEdges: [],
  };
  return homeStoryCardForGroup(group);
}
```

- [ ] **Step 2: Write compact rendering tests**

Create `CoverageSourceCluster.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageSourceCluster } from "./CoverageSourceCluster.js";
import { clusteredHomeStoryCard } from "../../test-fixtures/homeStoryCards.js";

describe("CoverageSourceCluster", () => {
  it("shows explicit article/source counts and only two supporting rows by default", () => {
    const card = clusteredHomeStoryCard({ articleCount: 7, sourceCount: 5 });
    const html = renderToStaticMarkup(
      <CoverageSourceCluster card={card} canCorrect onCorrect={vi.fn()} />,
    );
    expect(html).toContain("7 saker fra 5 kilder");
    expect(html).toContain("Vis alle 7 saker fra 5 kilder");
    expect((html.match(/class=\"coverage-source-row/g) ?? []).length).toBe(2);
    expect(html).toContain("Felles tema og kamp");
    expect(html).toContain("Feil gruppering?");
  });

  it("does not expose the correction action without owner capability", () => {
    const html = renderToStaticMarkup(
      <CoverageSourceCluster
        card={clusteredHomeStoryCard({ articleCount: 3, sourceCount: 3 })}
        canCorrect={false}
        onCorrect={vi.fn()}
      />,
    );
    expect(html).not.toContain("Feil gruppering?");
  });
});
```

- [ ] **Step 3: Run the component test and verify failure**

```bash
npm test -- --run apps/frontend/src/components/news/CoverageSourceCluster.test.tsx
```

Expected: FAIL because the component and fixture do not exist.

- [ ] **Step 4: Add explicit card counts and rationale**

In `homeStoryCards.ts`, add to `HomeStoryCard`:

```ts
articleCount: number;
sourceCount: number;
matchRationale?: string;
```

Populate them with:

```ts
articleCount: group.articles.length,
sourceCount: new Set(group.articles.map((article) => article.source)).size,
matchRationale: group.bundle?.matchConfidence?.rationale,
```

Add a pure display mapper:

```ts
export function coverageMatchExplanation(card: HomeStoryCard): string {
  const signals = card.group.acceptedEdges?.flatMap((edge) => edge.signals) ?? [];
  if (card.cardKind === "tema") return "Felles tema og kamp";
  if (signals.some((signal) => signal.kind === "situation_id")) return "Samme offisielle hendelse";
  if (
    signals.some(
      (signal) => signal.kind === "shared_place" || signal.kind === "generic_place_incident",
    )
  )
    return "Felles sted og hendelsestype";
  if (signals.some((signal) => signal.kind === "near_duplicate")) return "Samme publiserte sak";
  return card.matchRationale ?? "Sammenfallende dekning";
}
```

- [ ] **Step 5: Implement the compact component**

Create `CoverageSourceCluster.tsx` with local `expanded` state. Exclude the primary article from supporting rows, render `supporting.slice(0, expanded ? supporting.length : 2)`, use a real `<button aria-expanded>` for disclosure, safe external links, and a secondary correction button. The component root must have:

```tsx
import { useState } from "react";
import type { HomeStoryCard } from "../../homeStoryCards.js";
import { coverageMatchExplanation } from "../../homeStoryCards.js";
import { safeExternalUrl } from "../../safeExternalUrl.js";

function sourceTime(value: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CoverageSourceCluster({
  card,
  canCorrect,
  onCorrect,
}: {
  card: HomeStoryCard;
  canCorrect: boolean;
  onCorrect: (card: HomeStoryCard) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const supporting = card.group.articles.filter((article) => article.id !== card.primary.id);
  if (supporting.length === 0) return null;
  const visible = expanded ? supporting : supporting.slice(0, 2);
  const countLabel = `${card.articleCount} saker fra ${card.sourceCount} kilder`;
  return (
    <section className="coverage-source-cluster" aria-label={countLabel}>
      <div className="coverage-source-heading">
        <strong>{countLabel}</strong>
        <span>{coverageMatchExplanation(card)}</span>
      </div>
      <div className="coverage-source-list" data-expanded={expanded}>
        {visible.map((article) => {
          const href = safeExternalUrl(article.url);
          const content = (
            <>
              <b>
                {article.sourceLabel} · {sourceTime(article.publishedAt)}
              </b>
              <small>{article.title}</small>
            </>
          );
          return href ? (
            <a
              className="coverage-source-row"
              href={href}
              key={article.id}
              target="_blank"
              rel="noreferrer noopener"
            >
              {content}
            </a>
          ) : (
            <span className="coverage-source-row" key={article.id}>
              {content}
            </span>
          );
        })}
      </div>
      <div className="coverage-source-actions">
        {supporting.length > 2 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Vis færre saker" : `Vis alle ${countLabel}`}
          </button>
        ) : null}
        {canCorrect ? (
          <button
            type="button"
            className="coverage-correction-open"
            onClick={() => onCorrect(card)}
          >
            Feil gruppering?
          </button>
        ) : null}
      </div>
    </section>
  );
}
```

Render match explanation separately from `StoryConfidenceBadge`; never label it `Kildetillit`.

- [ ] **Step 6: Replace both inline `SourceCluster` usages**

Delete the private `SourceCluster` from `HomePage.tsx`. Import the new component for lead and ordinary cards. Add a separate `canCorrect?: boolean` prop to `HomePage`, thread `canCorrect` and `onCorrect` through `LeadStory`, `StoryCard` and their callers, and leave save behavior unchanged. In `App.tsx`, keep `canSave={isOwner}` and pass `canCorrect={isOwner && session?.capabilities?.coverageCorrections === true}`; do not infer correction authority from `canSave` inside `HomePage`.

- [ ] **Step 7: Add compact responsive styles**

Use CSS grid for rows, preserve existing editorial colors, and add:

```css
.coverage-source-list:not([data-expanded="true"]) .coverage-source-row:nth-child(n + 3) {
  display: none;
}

.coverage-source-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

@media (max-width: 520px) {
  .coverage-source-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .coverage-source-row small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
```

The render logic, not CSS alone, must limit the default DOM rows to two so screen readers do not encounter hidden extra links.

- [ ] **Step 8: Run component, card and Home tests**

```bash
npm test -- --run apps/frontend/src/components/news/CoverageSourceCluster.test.tsx apps/frontend/src/homeStoryCards.test.ts apps/frontend/src/pages/HomePage.test.tsx
npm run typecheck -w @nytt/frontend
```

Expected: tests/typecheck PASS; snapshots contain explicit article/source counts and no old all-expanded cluster.

- [ ] **Step 9: Commit compact grouped cards**

```bash
git add apps/frontend/src/components/news/CoverageSourceCluster.tsx apps/frontend/src/components/news/CoverageSourceCluster.test.tsx apps/frontend/src/test-fixtures/homeStoryCards.ts apps/frontend/src/homeStoryCards.ts apps/frontend/src/homeStoryCards.test.ts apps/frontend/src/pages/HomePage.tsx apps/frontend/src/pages/HomePage.test.tsx apps/frontend/src/App.tsx apps/frontend/src/styles.css
git commit -m "feat: compact grouped news cards"
```

---

### Task 3: Add immediate split, stale refresh and undo on Siste nytt

**Files:**

- Create: `apps/frontend/src/components/news/CoverageCorrectionDialog.tsx`
- Create: `apps/frontend/src/components/news/CoverageCorrectionDialog.test.tsx`
- Modify: `apps/frontend/src/pages/HomePage.tsx:1627-2110,2200-2320`
- Modify: `apps/frontend/src/pages/HomePage.test.tsx`
- Modify: `apps/frontend/src/styles.css`

**Interfaces:**

- Consumes: API and replacement helper from Task 1; compact component callback from Task 2.
- Produces: immediate owner split/undo with `CorrectionUndoState`, preserved scroll/focus and ARIA announcements.

- [ ] **Step 1: Write correction-dialog render and selection tests**

Create `CoverageCorrectionDialog.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageCorrectionDialog } from "./CoverageCorrectionDialog.js";
import { clusteredHomeStoryCard } from "../../test-fixtures/homeStoryCards.js";

describe("CoverageCorrectionDialog", () => {
  it("renders anchor, selectable supporting stories and bounded reason", () => {
    const html = renderToStaticMarkup(
      <CoverageCorrectionDialog
        card={clusteredHomeStoryCard({ articleCount: 3, sourceCount: 3 })}
        pending={false}
        error={undefined}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Behold som hovedsak");
    expect((html.match(/type=\"checkbox\"/g) ?? []).length).toBe(2);
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("Splitt nå");
  });

  it("disables confirmation while pending", () => {
    const html = renderToStaticMarkup(
      <CoverageCorrectionDialog
        card={clusteredHomeStoryCard({ articleCount: 2, sourceCount: 2 })}
        pending
        error={undefined}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain("Splitter…");
    expect(html).toContain("disabled");
  });
});
```

- [ ] **Step 2: Run the dialog test and verify failure**

```bash
npm test -- --run apps/frontend/src/components/news/CoverageCorrectionDialog.test.tsx
```

Expected: FAIL because the dialog is missing.

- [ ] **Step 3: Implement the accessible correction dialog**

Build the controlled dialog exactly as follows:

```tsx
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CoverageBundleSplitRequest } from "@nytt/shared";
import type { HomeStoryCard } from "../../homeStoryCards.js";

export function CoverageCorrectionDialog({
  card,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  card: HomeStoryCard;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (input: CoverageBundleSplitRequest) => void;
}) {
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [reason, setReason] = useState("");
  const supporting = card.group.articles.filter((article) => article.id !== card.primary.id);

  useEffect(() => {
    firstCheckboxRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
      ) ?? []),
    ];
    if (controls.length === 0) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || selectedIds.size === 0 || !card.group.bundle) return;
    onConfirm({
      expectedGeneratedAt: card.group.bundle.generatedAt,
      anchorArticleId: card.primary.id,
      rejectedArticleIds: [...selectedIds].sort(),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  }

  return (
    <div className="coverage-correction-backdrop">
      <div
        ref={dialogRef}
        className="coverage-correction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${descriptionId}-title`}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <form onSubmit={submit}>
          <h2 id={`${descriptionId}-title`}>Feil gruppering?</h2>
          <p id={descriptionId}>Velg sakene som ikke hører sammen med hovedsaken.</p>
          <div className="coverage-correction-anchor">
            <span>Behold som hovedsak</span>
            <strong>
              {card.primary.sourceLabel}: {card.primary.title}
            </strong>
          </div>
          <fieldset disabled={pending}>
            <legend>Skill ut</legend>
            {supporting.map((article, index) => (
              <label key={article.id}>
                <input
                  ref={index === 0 ? firstCheckboxRef : undefined}
                  type="checkbox"
                  checked={selectedIds.has(article.id)}
                  onChange={(event) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(article.id);
                      else next.delete(article.id);
                      return next;
                    })
                  }
                />
                <span>{article.sourceLabel}</span>
                <strong>{article.title}</strong>
              </label>
            ))}
          </fieldset>
          <label>
            Årsak (valgfritt)
            <textarea
              maxLength={500}
              value={reason}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div className="coverage-correction-actions">
            <button type="button" disabled={pending} onClick={onCancel}>
              Avbryt
            </button>
            <button type="submit" disabled={pending || selectedIds.size === 0}>
              {pending ? "Splitter…" : "Splitt nå"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

Do not allow selecting the primary as rejected in the first release.

- [ ] **Step 4: Add HomePage correction and undo state**

Add:

```ts
interface CorrectionUndoState {
  correctionIds: string[];
  beforeStories: CityPulseStory[];
  message: string;
}
```

Maintain `correctingCard`, `correctionPending`, `correctionError`, `correctionAnnouncement`, and `undoState`. `handleCoverageSplit()` must:

1. Capture only affected pre-split stories for undo fallback display.
2. Call `api.splitCoverageBundle`.
3. Replace stories through `replaceCoverageStories`.
4. Close the dialog.
5. Set an undo state containing every returned correction ID.
6. Set the live announcement to `Gruppen er splittet i ${replacementStories.length} saker.`
7. On `CoverageCorrectionConflictError`, replace the stale story with the error's current stories, close the dialog, and announce `Gruppen ble oppdatert før endringen kunne lagres.`

`handleCoverageUndo()` calls every correction ID sequentially, applies the final response, clears undo state, and announces `Grupperingen er gjenopprettet.` If one undo fails, retain the toast with `Kunne ikke angre hele endringen. Oppdater siden.` and refresh the feed.

- [ ] **Step 5: Preserve focus and scroll**

Give each story card `id={`story-${card.id}`}` and `tabIndex={-1}`. Record `window.scrollY` before mutation. After state commit, `requestAnimationFrame()` restores scroll and focuses the first replacement card with `{ preventScroll: true }`. When the dialog closes without mutation, return focus to the originating `Feil gruppering?` button.

Render one page-level live region:

```tsx
<p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {correctionAnnouncement}
</p>
```

Render the undo toast as `role="status"` with a real `Angre` button.

- [ ] **Step 6: Add HomePage helper-level tests**

Because the project uses static rendering, export pure reducers:

```ts
export function coverageSplitState(
  current: CityPulseStory[],
  result: CoverageBundleCorrectionResult,
): CityPulseStory[];
export function coverageConflictState(
  current: CityPulseStory[],
  removedStoryId: string,
  replacements: CityPulseStory[],
): CityPulseStory[];
```

Test immediate replacement, stale replacement, undo replacement, explicit announcement strings, owner-only action and no change to save state.

- [ ] **Step 7: Run correction UI tests**

```bash
npm test -- --run apps/frontend/src/components/news/CoverageCorrectionDialog.test.tsx apps/frontend/src/pages/HomePage.test.tsx apps/frontend/src/coverageStoryUpdates.test.ts apps/frontend/src/api.test.ts
npm run typecheck -w @nytt/frontend
```

Expected: all tests/typecheck PASS.

- [ ] **Step 8: Commit immediate correction UX**

```bash
git add apps/frontend/src/components/news/CoverageCorrectionDialog.tsx apps/frontend/src/components/news/CoverageCorrectionDialog.test.tsx apps/frontend/src/pages/HomePage.tsx apps/frontend/src/pages/HomePage.test.tsx apps/frontend/src/styles.css
git commit -m "feat: split grouped stories immediately"
```

---

### Task 4: Turn `/command/dekning` into an actionable quality workspace

**Files:**

- Modify: `packages/shared/src/article-bundles.ts`
- Modify: `apps/frontend/src/pages/CoverageBundlesPage.tsx`
- Modify: `apps/frontend/src/pages/CoverageBundlesPage.test.tsx`
- Modify: `apps/frontend/src/styles.css:5015-5335,13017-13590`

**Interfaces:**

- Consumes: normalized `CoverageBundlePage`, parity, edges, corrections and split/undo APIs.
- Produces: active-first filters, bounded candidate disclosure, integrity/parity warnings, split/undo controls and owner review explanations.

- [ ] **Step 1: Extend page fixtures and failing assertions**

Update the page fixture with a completed v2 shadow generation, match confidence, one weak review candidate, one active correction and clean parity. Add assertions:

```ts
expect(html).toContain("Aktive grupper");
expect(html).toContain("Sterke treff");
expect(html).toContain("Moderate treff");
expect(html).toContain("Til vurdering");
expect(html).toContain("Aktive korrigeringer");
expect(html).toContain("Dataintegritet");
expect(html).toContain("Offentlig projeksjon samsvarer");
expect(html).toContain("Svakeste godkjente treff");
expect(html).toContain("Vis 1 nesten-treff");
expect(html).toContain("Splitt gruppe");
expect(html).toContain("Eksporter korrigeringer");
```

Add an error fixture with `integrityErrorCount: 1` and parity mismatch; assert a `role="alert"` banner and no promotion-ready copy.

Add optional `correctionsEnabled?: boolean` to `CoverageBundlePage`, set it to `true` in the actionable fixture, and assert a second fixture with `false` omits `Splitt gruppe` and `Angre` while retaining read-only correction history.

- [ ] **Step 2: Run the page test and verify failures**

```bash
npm test -- --run apps/frontend/src/pages/CoverageBundlesPage.test.tsx
```

Expected: FAIL on the new summary/filter/detail copy.

- [ ] **Step 3: Replace legacy confidence filters with projection/match filters**

Keep legacy filters available only when `projection=legacy`. Default query:

```ts
{ projection: "shadow", limit: 30 }
```

Add controls for projection, match tier, corrected state and integrity. Preserve filter state in URL search params. Summary cards use normalized fields; show matcher version and latest successful generation time.

- [ ] **Step 4: Bound and group review candidates**

Create a pure helper:

```ts
export function groupedCoverageReviewCandidates(bundle: CoverageBundleListItem) {
  const grouped = new Map<string, CoverageBundleListItem["reviewCandidates"]>();
  for (const candidate of bundle.reviewCandidates) {
    const reason = candidate.correctionConflict
      ? "correction_conflict"
      : (candidate.conflicts[0]?.kind ?? candidate.tier);
    grouped.set(reason, [...(grouped.get(reason) ?? []), candidate]);
  }
  return [...grouped.entries()].map(([reason, candidates]) => ({
    reason,
    total: candidates.length,
    visible: [...candidates].sort((left, right) => right.score - left.score).slice(0, 5),
  }));
}
```

Render five rows per reason initially with a disclosure button. Do not render the legacy unbounded `nearMisses.map()` path for normalized projections.

- [ ] **Step 5: Add detail evidence and correction controls**

Show anchor/member roles, admission edge, weakest accepted edge, match score/rationale, source trust, direct verification edge and correction history. Reuse `CoverageCorrectionDialog` for split only when `page.correctionsEnabled === true`. Active correction rows expose `Angre` under the same capability; do not expose correction reason on public pages.

Add an owner-only download link to `/api/operations/coverage-corrections/export?sinceDays=30` labelled `Eksporter korrigeringer`. Adjacent copy must say `Gjennomgå og anonymiser eksporten før den legges i testkorpuset.` The browser download is never submitted or imported automatically.

If integrity errors exist, show IDs and error classes without fabricating missing article titles. If parity is not clean, display `Skyggevisningen avviker fra dagens publiserte grupper` and keep promotion copy absent.

- [ ] **Step 6: Run audit page tests and typecheck**

```bash
npm test -- --run apps/frontend/src/pages/CoverageBundlesPage.test.tsx apps/frontend/src/components/news/CoverageCorrectionDialog.test.tsx
npm run typecheck -w @nytt/frontend
```

Expected: tests/typecheck PASS.

- [ ] **Step 7: Commit the audit workspace**

```bash
git add packages/shared/src/article-bundles.ts apps/frontend/src/pages/CoverageBundlesPage.tsx apps/frontend/src/pages/CoverageBundlesPage.test.tsx apps/frontend/src/styles.css
git commit -m "feat: make coverage audit actionable"
```

---

### Task 5: Serve the normalized active projection with fail-safe fallback

**Files:**

- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/test/config.test.ts`
- Modify: `apps/server/src/store.ts:1294-1335,5518-5528`
- Modify: `apps/server/src/app.ts:1310-1340`
- Modify: `apps/server/test/articles-store.test.ts`
- Modify: `apps/server/test/api.test.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: normalized generation/member/edge tables and correction projection from Plan 2.
- Produces: validated `coverageProjectionMode`, normalized `listCityPulseStories()`, projection metadata and legacy fallback for rollout.

- [ ] **Step 1: Write feed/audit parity and fallback tests**

Add store tests:

```ts
import type pg from "pg";
import { vi } from "vitest";

function normalizedActiveProjectionPool(): pg.Pool {
  const primary = {
    id: "regional-a",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Regional hovedsak",
    excerpt: "Sanitert innhold.",
    url: "https://example.test/regional-a",
    publishedAt: "2026-07-12T21:00:00.000Z",
    scope: "trondelag",
    category: "Hendelser",
    places: ["Nærøysund"],
  };
  const articles = [
    primary,
    {
      ...primary,
      id: "regional-b",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      url: "https://example.test/regional-b",
      publishedAt: "2026-07-12T20:59:00.000Z",
    },
    {
      ...primary,
      id: "regional-c",
      source: "nidaros",
      sourceLabel: "Nidaros",
      url: "https://example.test/regional-c",
      publishedAt: "2026-07-12T20:58:00.000Z",
    },
  ];
  return {
    query: vi.fn(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (
        normalized.includes("FROM coverage_bundle_generations") &&
        normalized.includes("is_current")
      ) {
        return {
          rows: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              matcher_version: "v2",
              completed_at: "2026-07-12T21:01:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.includes("FROM coverage_bundle_members")) {
        return {
          rows: articles.map((payload, index) => ({
            bundle_id: "coverage:v2:regional",
            role: index === 0 ? "primary" : "supporting",
            payload,
          })),
          rowCount: 3,
        };
      }
      if (normalized.includes("FROM coverage_bundle_edges")) return { rows: [], rowCount: 0 };
      if (normalized.includes("FROM coverage_bundle_corrections")) return { rows: [], rowCount: 0 };
      if (normalized.includes("FROM coverage_bundles")) {
        return {
          rows: [
            {
              id: "coverage:v2:regional",
              kind: "incident",
              primary_article_id: "regional-a",
              generated_at: "2026-07-12T21:00:00.000Z",
              match_tier: "strong",
              match_score: 0.9,
              match_rationale: "Sterkt direkte treff.",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as pg.Pool;
}

function noActiveGenerationPool(): pg.Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("coverage_bundle_generations")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as pg.Pool;
}

it("builds city pulse stories from the latest completed active normalized generation", async () => {
  const store = new PgStore(normalizedActiveProjectionPool());
  const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");
  expect(page.projection).toMatchObject({
    mode: "normalized",
    matcherVersion: "v2",
    parityClean: true,
  });
  expect(page.items.find((story) => story.id === "coverage:v2:regional")?.articles).toHaveLength(3);
});

it("falls back to legacy stories when no completed active normalized generation exists", async () => {
  const store = new PgStore(noActiveGenerationPool());
  const page = await store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz");
  expect(page.projection).toMatchObject({
    mode: "legacy",
    fallbackReason: "no_completed_active_generation",
  });
  expect(page.items).toEqual(expect.any(Array));
});

it("uses the same generation for city pulse and command coverage", async () => {
  const store = new PgStore(normalizedActiveProjectionPool());
  const [stories, coverage] = await Promise.all([
    store.listCityPulseStories({ scope: "trondelag", limit: 40 }, "Reedtrullz"),
    store.listCoverageBundles({ projection: "active", limit: 30 }, "Reedtrullz"),
  ]);
  expect(stories.projection?.generationId).toBe(coverage.summary.generation?.id);
});
```

- [ ] **Step 2: Run tests and verify projection failure**

```bash
npm test -- --run apps/server/test/articles-store.test.ts apps/server/test/coverage-bundles-store.test.ts
```

Expected: FAIL because story pages have no projection metadata and still derive groups from fetched article pages.

- [ ] **Step 3: Add validated projection configuration**

Add to `AppConfig`:

```ts
coverageProjectionMode?: "legacy" | "normalized-shadow" | "normalized-active";
coverageCorrectionsEnabled?: boolean;
```

`coverageCorrectionsEnabled` already exists from the lifecycle plan. Parse the projection mode in `loadConfig()` and use `config.coverageProjectionMode ?? "legacy"` at runtime:

```ts
function coverageProjectionModeFromEnvironment():
  | "legacy"
  | "normalized-shadow"
  | "normalized-active" {
  const value = process.env.COVERAGE_PROJECTION_MODE?.trim() ?? "legacy";
  if (value === "legacy" || value === "normalized-shadow" || value === "normalized-active")
    return value;
  throw new Error(
    "COVERAGE_PROJECTION_MODE must be legacy, normalized-shadow or normalized-active",
  );
}
```

`loadConfig()` sets `coverageProjectionMode: coverageProjectionModeFromEnvironment()`. Keep the lifecycle plan's strict boolean parser for `coverageCorrectionsEnabled`.

Add config tests for all three accepted values, the `legacy` default, and rejection of `active` and other unsupported strings.

Add to `.env.example`:

```text
COVERAGE_PROJECTION_MODE=legacy
COVERAGE_CORRECTIONS_ENABLED=false
```

The server must reject `normalized-active` when correction writes are enabled but no completed active v2 generation exists; it may start and fall back to legacy while readiness exposes the degraded projection state.

- [ ] **Step 4: Build stories from normalized active membership**

When configured `normalized-active`, query the latest completed current active generation, load all matching-scope members needed for `sourceLimit`, apply active corrections through shared recomputation, and construct `CityPulseStory` directly from stored bundle membership/edges. Apply story pagination only after grouping.

Do not first slice to 40 articles. Fetch bundle membership for the article source window so regional groups cannot disappear because one member fell outside the displayed page.

Extend `CityPulseStoryPage`:

```ts
projection?: {
  mode: "legacy" | "normalized";
  generationId?: string;
  matcherVersion: "v1" | "v2";
  parityClean: boolean;
  fallbackReason?: "disabled" | "no_completed_active_generation" | "integrity_error";
};
```

If normalized integrity validation fails, log IDs/counts only and fall back to legacy. Never partially combine projections.

- [ ] **Step 5: Expose projection metadata through bootstrap/story APIs**

Return the page metadata unchanged from `/api/city-pulse/stories` and include `storyProjection` in `BootstrapPayload`. The frontend audit may display it owner-only; public card copy does not expose operational fallback text.

In `/api/operations/coverage-bundles`, return `{ ...page, correctionsEnabled: config.coverageCorrectionsEnabled === true }` so the owner audit never renders dead mutation controls.

- [ ] **Step 6: Run server parity/fallback/API tests**

```bash
npm test -- --run apps/server/test/articles-store.test.ts apps/server/test/coverage-bundles-store.test.ts apps/server/test/api.test.ts
npm run typecheck -w @nytt/server
npm run typecheck -w @nytt/shared
```

Expected: tests/typechecks PASS and the same generation ID appears in story/audit reads.

- [ ] **Step 7: Commit normalized feed projection**

```bash
git add apps/server/src/config.ts apps/server/test/config.test.ts apps/server/src/store.ts apps/server/src/app.ts apps/server/test/articles-store.test.ts apps/server/test/api.test.ts packages/shared/src/types.ts .env.example
git commit -m "feat: serve normalized coverage projection"
```

---

### Task 6: Add authenticated desktop, phone and keyboard end-to-end coverage

**Files:**

- Modify: `e2e/app.spec.ts`
- Modify: `playwright.config.ts` only if the existing project lacks a 390px project.

**Interfaces:**

- Consumes: correction UI, owner dev-auth bypass and normalized fixture data.
- Produces: automated acceptance proof for compact cards, split, stale conflict, undo, keyboard access and regional parity.

- [ ] **Step 1: Add deterministic coverage fixtures to the existing E2E server setup**

Seed one seven-article/five-source group and one three-article group containing a deliberately rejectable member. Expose test-only data through the existing development in-memory store; do not add a production-only route or bypass authorization.

- [ ] **Step 2: Write desktop split/undo E2E**

Add:

```ts
test("owner splits and restores a grouped Siste nytt card", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  await expect(card.getByText("3 saker fra 3 kilder")).toBeVisible();
  await card.getByRole("button", { name: "Feil gruppering?" }).click();
  await page.getByRole("checkbox", { name: /Urelatert støttesak/ }).check();
  await page.getByRole("button", { name: "Splitt nå" }).click();
  await expect(page.getByRole("status")).toContainText("Gruppen er splittet");
  await expect(page.getByRole("heading", { name: "Urelatert støttesak" })).toBeVisible();
  await page.getByRole("button", { name: "Angre" }).click();
  await expect(page.getByRole("status")).toContainText("Grupperingen er gjenopprettet");
  await expect(
    page.locator("article", { hasText: "Korrigerbar hovedsak" }).getByText("3 saker fra 3 kilder"),
  ).toBeVisible();
});
```

- [ ] **Step 3: Write 390px compact-card and keyboard E2E**

```ts
test("grouped cards remain compact and correctable by keyboard at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const card = page.locator("article", { hasText: "Stor gruppesak" });
  await expect(card.locator(".coverage-source-row")).toHaveCount(2);
  await expect(card.getByRole("button", { name: "Vis alle 7 saker fra 5 kilder" })).toBeVisible();
  await card.getByRole("button", { name: "Feil gruppering?" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Gruppen er splittet");
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
```

- [ ] **Step 4: Add regional feed/audit parity E2E**

Open `/?scope=trondelag`, capture the grouped story count and article/source count, then open `/command/dekning?projection=active`, select the matching bundle and assert identical membership and generation ID. Do not compare display ordering of sources; compare normalized article IDs exposed as `data-article-id`.

- [ ] **Step 5: Add stale conflict E2E**

Use the existing test fixture control to advance the generation after opening the dialog and before confirmation. Assert `409` copy, no correction toast, and refreshed current story membership.

- [ ] **Step 6: Run focused E2E and accessibility checks**

```bash
npm run test:e2e -- --grep "grouped|splits|coverage|phone width"
```

Expected: all new cases PASS in desktop and 390px paths with no accessibility violation from the existing axe checks.

- [ ] **Step 7: Commit browser acceptance coverage**

```bash
git add e2e/app.spec.ts playwright.config.ts
git commit -m "test: cover grouped story corrections"
```

---

### Task 7: Gate shadow review, promotion and rollback

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/test/index.test.ts`
- Modify: `docker-compose.yml`
- Modify: `ansible-playbook.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/SOURCES.md`

**Interfaces:**

- Consumes: `COVERAGE_PROJECTION_MODE`, generation/parity/integrity queries, matcher quality command and E2E proof.
- Produces: fail-closed promotion/rollback gates and one-release legacy retention contract.

- [ ] **Step 1: Pass projection flags explicitly through deployment**

Add server container variables with safe defaults:

```yaml
COVERAGE_PROJECTION_MODE: ${COVERAGE_PROJECTION_MODE:-legacy}
COVERAGE_CORRECTIONS_ENABLED: ${COVERAGE_CORRECTIONS_ENABLED:-false}
```

Add the worker-only selector:

```yaml
COVERAGE_MATCHER_VERSION: ${COVERAGE_MATCHER_VERSION:-v1}
COVERAGE_GENERATION_MODE: ${COVERAGE_GENERATION_MODE:-shadow}
```

Shadow rollout sets matcher `v2` and generation mode `shadow` while the server remains `COVERAGE_PROJECTION_MODE=legacy`; the worker still writes v1 legacy output and adds normalized v2 shadow generations. After explicit promotion, generation mode becomes `active` so later successful worker cycles transactionally replace the current normalized projection.

In `apps/worker/src/index.ts`, validate and pass the mode:

```ts
export function coverageGenerationMode(env: NodeJS.ProcessEnv = process.env): "shadow" | "active" {
  const value = env.COVERAGE_GENERATION_MODE ?? "shadow";
  if (value !== "shadow" && value !== "active") {
    throw new Error("COVERAGE_GENERATION_MODE must be shadow or active");
  }
  if (value === "active" && env.COVERAGE_MATCHER_VERSION !== "v2") {
    throw new Error("active coverage generations require COVERAGE_MATCHER_VERSION=v2");
  }
  return value;
}
```

Replace the lifecycle-plan hardcoded `mode: "shadow"` with `mode: coverageGenerationMode()`. Add worker tests for the safe default, invalid value and forbidden `active`+`v1` combination.

Do not expose these variables to the Vite build or frontend bundle.

- [ ] **Step 2: Add pre-promotion database gates to Ansible**

Before canary promotion, query the candidate database through stdin-based `psql` heredocs and fail unless:

```sql
WITH recent AS (
  SELECT * FROM coverage_bundle_generations
  WHERE matcher_version='v2' AND mode='shadow' AND status='completed'
  ORDER BY completed_at DESC LIMIT 7
)
SELECT count(*) = 7
  AND bool_and(correction_conflict_count >= 0)
  AND min(completed_at) > now() - interval '24 hours'
FROM recent;
```

Also fail when parity is dirty, integrity errors are nonzero, the golden-corpus command failed in exact-SHA CI, or the latest generation matcher version is not `v2`.

Because owner review cannot be inferred from bundle counts, add an explicit deployment variable `coverage_v2_owner_reviewed_generation_id`. Require it to equal the latest shadow generation ID before `normalized-active` promotion. Store only the UUID, never review notes.

Source the value from the non-secret GitHub production-environment variable `COVERAGE_V2_OWNER_REVIEWED_GENERATION_ID` and pass it as an Ansible extra variable. The deploy workflow must reject an empty or malformed UUID only when transitioning a reviewed shadow generation to active; ordinary legacy deploys and later already-active v2 deploys do not require a new value.

Promote the exact reviewed shadow generation in one transaction before switching the server projection:

```sql
BEGIN;
SELECT id
FROM coverage_bundle_generations
WHERE id = :'reviewed_generation_id'
  AND matcher_version='v2'
  AND mode='shadow'
  AND status='completed'
FOR UPDATE;

UPDATE coverage_bundle_generations SET is_current=false WHERE is_current;
UPDATE coverage_bundle_generations
SET mode='active', is_current=true
WHERE id = :'reviewed_generation_id'
  AND matcher_version='v2'
  AND mode='shadow'
  AND status='completed';

UPDATE coverage_bundles
SET state='active'
WHERE generation_id = :'reviewed_generation_id';
COMMIT;
```

The Ansible task must fail unless the guarded generation update affects exactly one row. Only after this transaction succeeds may candidate configuration use `COVERAGE_PROJECTION_MODE=normalized-active`, `COVERAGE_CORRECTIONS_ENABLED=true`, and `COVERAGE_GENERATION_MODE=active`.

- [ ] **Step 3: Add normalized-active readiness semantics**

When configured `normalized-active`, `/health/ready` returns `503` if no completed current active v2 generation exists or integrity/parity is dirty. `/health/live` remains process-only. Legacy mode readiness remains unchanged.

Parity compares generated base membership before owner corrections. Effective public membership may intentionally differ after a split; active corrections are validated separately and must not make readiness fail merely because they changed the projected cards.

Add API tests and Ansible assertions for both modes. Rollback changes projection mode to `legacy`; it does not delete generations or corrections.

- [ ] **Step 4: Add exact CI gates**

Ensure CI runs:

```yaml
- run: npm run check:coverage-matcher
- run: npm test
- run: npm run build
- run: npm run test:e2e
```

Keep twice-applied migration and Docker API/worker builds. Add a PostgreSQL smoke that promotes a fixture shadow generation to active, reads identical story/audit membership, applies a split, applies undo, and confirms the previous projection remains readable.

- [ ] **Step 5: Document the three-stage operator procedure**

In `docs/DEPLOYMENT.md`, specify:

1. Deploy matcher/lifecycle with server projection `legacy`, matcher `v2`, generation mode `shadow`, and corrections disabled.
2. Observe seven successful v2 shadow generations, zero integrity errors, clean parity, golden gate, and review every changed bundle.
3. Record the reviewed generation UUID, promote that exact shadow generation transactionally, and deploy `normalized-active` with corrections enabled and worker generation mode `active`.
4. Run authenticated `/`, `/?scope=trondelag`, `/command/dekning`, split and undo at desktop and 390px.
5. Retain legacy reads/writes for one release.
6. Roll back by setting `COVERAGE_PROJECTION_MODE=legacy`, `COVERAGE_CORRECTIONS_ENABLED=false`, and `COVERAGE_GENERATION_MODE=shadow`; preserve active-generation and correction rows for diagnosis.

Include explicit SQL readbacks for current generation, active bundle/member counts, correction conflicts, dangling members and parity.

- [ ] **Step 6: Update architecture/security/source documentation**

- `ARCHITECTURE.md`: normalized active projection is shared by feed/audit; legacy is fail-safe fallback.
- `SECURITY.md`: owner-only UI/API, CSRF, reason privacy, exact-pair correction, audit log fields.
- `SOURCES.md`: correction and grouping remain derived and cannot activate situations.

- [ ] **Step 7: Run the complete pre-ship verification**

```bash
df -h /System/Volumes/Data
npm run format:check
npm run lint
npm run typecheck
npm run check:coverage-matcher
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
ansible-playbook --syntax-check ansible-playbook.yml
git diff --check
```

Expected: at least `30Gi` free; every command exits `0`; Playwright reports only the project's intentional skips; production audit reports zero high-severity vulnerabilities.

- [ ] **Step 8: Commit rollout gates**

```bash
git add apps/worker/src/index.ts apps/worker/test/index.test.ts docker-compose.yml ansible-playbook.yml .github/workflows/ci.yml .github/workflows/deploy.yml docs/DEPLOYMENT.md docs/ARCHITECTURE.md docs/SECURITY.md docs/SOURCES.md
git commit -m "chore: gate coverage projection promotion"
```

## Phase 3 Completion and Ship Gate

Before creating a PR:

```bash
git status --short
git log -7 --oneline
git diff main...HEAD --check
npm run check:coverage-matcher
```

Expected: only pre-existing untracked files remain, seven focused commits are present, diff hygiene passes and the matcher quality gate is green.

Before production promotion, record exact evidence for:

- PR-head CI and exact-main CI run IDs;
- twice-applied migration and PostgreSQL correction smoke;
- seven completed v2 shadow generation IDs;
- clean parity/integrity readback;
- owner-reviewed latest generation UUID;
- canary readiness and candidate worker freshness;
- authenticated desktop and 390px Siste nytt split/undo;
- regional feed/audit generation and membership parity;
- rollback-mode readiness without deleting corrections;
- exact deployed Git SHA and image digest.
