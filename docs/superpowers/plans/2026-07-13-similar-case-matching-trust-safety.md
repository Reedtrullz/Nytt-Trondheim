# Similar-Case Matching and Trust Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic v2 coverage matcher that preserves reasonable grouping, blocks weak bridge contamination, separates match confidence from source trust and factual verification, and can be measured against a labelled corpus without changing the active public projection.

**Architecture:** Extract pair evidence into a focused shared module, score each pair as strong, moderate or weak, and build clusters through strong components plus anchor/quorum admission. Keep the current v1 matcher as the active path while the worker computes v2 as an in-memory shadow result; the normalized persistence and promotion controls arrive in the next plan.

**Tech Stack:** TypeScript strict mode, npm workspaces, Vitest, Node.js ESM, React-independent shared modules, existing `@nytt/shared` barrel exports.

## Global Constraints

- Follow `/Users/reidar/Projectos/Nytt/AGENTS.md` and preserve all existing untracked files.
- Run `df -h /System/Volumes/Data` before long test/build loops and stop below `30Gi` free.
- Do not add an external AI, embedding service, queue or dependency.
- Coverage analysis must never create situations, source items or causal evidence.
- Strong evidence groups automatically; moderate evidence requires anchor or quorum agreement; weak evidence is review-only.
- Generic `brann` and `street_order` matching requires positive place, entity, official-event or compatible subtype evidence.
- Match confidence, source trust and factual verification are independent.
- Verification requires a direct strong official-to-newsroom incident edge.
- Keep v1 public grouping active throughout this plan.
- All user-facing copy is Bokmål and all time handling remains `Europe/Oslo` / `nb-NO`.
- Use TDD and commit only the files named by each task.

## File Map

- Create `packages/shared/src/article-coverage-evidence.ts`: pair evidence, conflicts, subtype/place gates, scoring and fingerprints.
- Create `packages/shared/src/article-coverage-clustering.ts`: deterministic strong-component and anchor/quorum clustering.
- Create `packages/shared/src/article-coverage-evaluator.ts`: labelled-corpus metrics and hard-gate evaluation.
- Create `packages/shared/test/fixtures/article-coverage-golden.ts`: sanitized true/false production-shaped fixtures.
- Create `packages/shared/test/article-coverage-evidence.test.ts`: focused pair evidence regressions.
- Create `packages/shared/test/article-coverage-clustering.test.ts`: bridge, rejection and permutation regressions.
- Create `packages/shared/test/article-coverage-evaluator.test.ts`: metric and hard-gate behavior.
- Modify `packages/shared/src/article-bundles.ts`: keep v1 exports, add v2 orchestration and attach accepted edges to groups/decisions.
- Modify `packages/shared/src/types.ts`: add match-confidence metadata without removing legacy `confidence`.
- Modify `packages/shared/src/public-verification.ts`: require a direct strong incident edge.
- Modify `packages/shared/src/index.ts`: export the new modules.
- Modify `packages/shared/test/article-coverage-analysis.test.ts`: protect existing v1 behavior and add v2 integration assertions.
- Modify `packages/shared/test/public-verification.test.ts`: replace co-membership verification with direct-edge verification.
- Modify `apps/worker/src/index.ts`: compute v2 shadow analysis while retaining v1 writes.
- Modify `apps/worker/test/index.test.ts`: prove shadow computation cannot change persisted v1 articles/bundles.
- Modify `package.json`: add the deterministic corpus check command.
- Modify `docs/ARCHITECTURE.md` and `docs/SOURCES.md`: document the shadow matcher and trust boundary.

---

### Task 1: Add the labelled corpus and evaluator contracts

**Files:**
- Create: `packages/shared/test/fixtures/article-coverage-golden.ts`
- Create: `packages/shared/src/article-coverage-evaluator.ts`
- Create: `packages/shared/test/article-coverage-evaluator.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: existing `Article`, `ArticleCoverageBundleDecision`, and `ArticlePublicVerification` types.
- Produces: `ArticleCoverageGoldenCase`, `ArticleCoverageEvaluation`, and `evaluateArticleCoverageCorpus(cases, analyze)` for Tasks 3, 4 and 6.

- [ ] **Step 1: Write the failing evaluator test**

Create `packages/shared/test/article-coverage-evaluator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ArticleCoverageGoldenCase } from "../src/index.js";
import { evaluateArticleCoverageCorpus } from "../src/index.js";

const cases: ArticleCoverageGoldenCase[] = [
  {
    id: "same-case",
    articles: [
      {
        id: "news-a",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Brann på byggeplass i Nærøysund",
        excerpt: "Nødetatene rykket ut til en brann i ei brakke på byggeplassen.",
        url: "https://example.test/news-a",
        publishedAt: "2026-07-12T20:00:00.000Z",
        scope: "trondelag",
        category: "Hendelser",
        places: ["Nærøysund"],
      },
      {
        id: "news-b",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Brakke brant på byggeplass i Nærøysund",
        excerpt: "Brannvesenet fikk kontroll på brannen i anleggsbrakka.",
        url: "https://example.test/news-b",
        publishedAt: "2026-07-12T20:05:00.000Z",
        scope: "trondelag",
        category: "Hendelser",
        places: ["Nærøysund"],
      },
    ],
    expectedSamePairs: [["news-a", "news-b"]],
    expectedSeparatePairs: [],
    expectedGroups: [["news-a", "news-b"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
];

describe("article coverage evaluator", () => {
  it("reports deterministic pair and group metrics", () => {
    const result = evaluateArticleCoverageCorpus(cases, (articles) => ({
      articles,
      bundles: [
        {
          id: "coverage:test",
          kind: "incident",
          confidence: "high",
          reason: "Samme hendelse",
          generatedAt: "2026-07-12T21:00:00.000Z",
          primaryArticleId: "news-b",
          memberArticleIds: ["news-b", "news-a"],
          sourceIds: ["adressa", "nrk"],
          sourceLabels: ["Adresseavisen", "NRK Trøndelag"],
          signals: [],
          nearMisses: [],
        },
      ],
      nearMisses: [],
    }));

    expect(result).toMatchObject({
      labelledPairCount: 1,
      truePositivePairs: 1,
      falsePositivePairs: 0,
      falseNegativePairs: 0,
      pairPrecision: 1,
      pairRecall: 1,
      groupPrecision: 1,
      bridgeErrorCount: 0,
      criticalFailures: [],
    });
    expect(result.groupingCoverage).toBe(1);
  });
});
```

- [ ] **Step 2: Run the evaluator test and verify the missing-export failure**

Run:

```bash
npm test -- --run packages/shared/test/article-coverage-evaluator.test.ts
```

Expected: FAIL because `ArticleCoverageGoldenCase` and `evaluateArticleCoverageCorpus` are not exported.

- [ ] **Step 3: Implement the evaluator contracts and deterministic pair helpers**

Create `packages/shared/src/article-coverage-evaluator.ts`:

```ts
import type { Article, ArticlePublicVerification } from "./types.js";
import type { ArticleCoverageAnalysis } from "./article-bundles.js";

export interface ArticleCoverageGoldenCase {
  id: string;
  articles: Article[];
  expectedSamePairs: Array<[string, string]>;
  expectedSeparatePairs: Array<[string, string]>;
  expectedGroups: string[][];
  expectedVerifiedGroups: string[][];
  critical: boolean;
  provenance: "synthetic" | "sanitized-production-shape" | "owner-correction";
}

export interface ArticleCoverageEvaluation {
  labelledPairCount: number;
  truePositivePairs: number;
  falsePositivePairs: number;
  falseNegativePairs: number;
  pairPrecision: number;
  pairRecall: number;
  groupPrecision: number;
  groupingCoverage: number;
  bridgeErrorCount: number;
  criticalFailures: string[];
}

type Analyzer = (articles: Article[]) => ArticleCoverageAnalysis;

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function groupKey(articleIds: string[]): string {
  return [...articleIds].sort().join("\u0000");
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function verifiedGroupKeys(analysis: ArticleCoverageAnalysis): Set<string> {
  const verificationByBundle = new Map<string, ArticlePublicVerification>();
  for (const article of analysis.articles) {
    if (article.coverageBundle && article.publicVerification) {
      verificationByBundle.set(article.coverageBundle.id, article.publicVerification);
    }
  }
  return new Set(
    analysis.bundles
      .filter((bundle) => verificationByBundle.has(bundle.id))
      .map((bundle) => groupKey(bundle.memberArticleIds)),
  );
}

export function evaluateArticleCoverageCorpus(
  cases: ArticleCoverageGoldenCase[],
  analyze: Analyzer,
): ArticleCoverageEvaluation {
  let truePositivePairs = 0;
  let falsePositivePairs = 0;
  let falseNegativePairs = 0;
  let labelledPairCount = 0;
  let expectedGroupedArticles = 0;
  let observedGroupedArticles = 0;
  let truePositiveGroups = 0;
  let falsePositiveGroups = 0;
  let bridgeErrorCount = 0;
  const criticalFailures: string[] = [];

  for (const fixture of cases) {
    labelledPairCount += fixture.expectedSamePairs.length + fixture.expectedSeparatePairs.length;
    const first = analyze(fixture.articles);
    const second = analyze([...fixture.articles]);
    const observedPairs = new Set(
      first.bundles.flatMap((bundle) =>
        bundle.memberArticleIds.flatMap((left, index) =>
          bundle.memberArticleIds.slice(index + 1).map((right) => pairKey(left, right)),
        ),
      ),
    );
    const repeatedGroups = second.bundles.map((bundle) => groupKey(bundle.memberArticleIds));
    const observedGroups = first.bundles.map((bundle) => groupKey(bundle.memberArticleIds));
    const expectedGroups = new Set(fixture.expectedGroups.map(groupKey));
    for (const observedGroup of observedGroups) {
      if (expectedGroups.has(observedGroup)) truePositiveGroups += 1;
      else falsePositiveGroups += 1;
    }
    if (JSON.stringify(observedGroups) !== JSON.stringify(repeatedGroups)) {
      criticalFailures.push(`${fixture.id}: nondeterministic output`);
    }

    for (const [left, right] of fixture.expectedSamePairs) {
      if (observedPairs.has(pairKey(left, right))) truePositivePairs += 1;
      else {
        falseNegativePairs += 1;
        if (fixture.critical) criticalFailures.push(`${fixture.id}: split ${left}/${right}`);
      }
    }
    for (const [left, right] of fixture.expectedSeparatePairs) {
      if (!observedPairs.has(pairKey(left, right))) continue;
      falsePositivePairs += 1;
      bridgeErrorCount += 1;
      if (fixture.critical) criticalFailures.push(`${fixture.id}: grouped ${left}/${right}`);
    }

    expectedGroupedArticles += new Set(fixture.expectedGroups.flat()).size;
    observedGroupedArticles += new Set(first.bundles.flatMap((bundle) => bundle.memberArticleIds)).size;

    const observedVerified = verifiedGroupKeys(first);
    const expectedVerified = new Set(fixture.expectedVerifiedGroups.map(groupKey));
    for (const verified of observedVerified) {
      if (!expectedVerified.has(verified)) {
        criticalFailures.push(`${fixture.id}: unexpected verification ${verified}`);
      }
    }
    for (const expected of expectedVerified) {
      if (!observedVerified.has(expected)) {
        criticalFailures.push(`${fixture.id}: missing verification ${expected}`);
      }
    }
  }

  return {
    labelledPairCount,
    truePositivePairs,
    falsePositivePairs,
    falseNegativePairs,
    pairPrecision: safeRatio(truePositivePairs, truePositivePairs + falsePositivePairs),
    pairRecall: safeRatio(truePositivePairs, truePositivePairs + falseNegativePairs),
    groupPrecision: safeRatio(truePositiveGroups, truePositiveGroups + falsePositiveGroups),
    groupingCoverage: safeRatio(observedGroupedArticles, expectedGroupedArticles),
    bridgeErrorCount,
    criticalFailures,
  };
}
```

Add this export to `packages/shared/src/index.ts`:

```ts
export * from "./article-coverage-evaluator.js";
```

- [ ] **Step 4: Add the production-shaped corpus fixture**

Create `packages/shared/test/fixtures/article-coverage-golden.ts` with an `article()` factory and four exported cases. Use the exact shape below and keep excerpts sanitized:

```ts
import type { Article, ArticleCoverageGoldenCase } from "../../src/index.js";

function article(id: string, overrides: Partial<Article>): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: "",
    url: `https://example.test/${id}`,
    publishedAt: "2026-07-12T20:00:00.000Z",
    scope: "trondelag",
    category: "Hendelser",
    places: ["Trøndelag"],
    ...overrides,
  };
}

export const articleCoverageGoldenCases: ArticleCoverageGoldenCase[] = [
  {
    id: "rbk-match-coverage",
    articles: [
      article("rbk-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Har begynt å kalle ham Zlatan",
        excerpt: "RBK-spissen scoret et praktfullt mål i seieren mot Kristiansund.",
        category: "Sport",
        places: ["Lerkendal", "Trondheim"],
      }),
      article("rbk-nrk", {
        title: "Seier på Lerkendal",
        excerpt: "Rosenborg slo Kristiansund 3-0 på Lerkendal.",
        category: "Sport",
        places: ["Lerkendal", "Trondheim"],
        publishedAt: "2026-07-12T19:09:00.000Z",
      }),
    ],
    expectedSamePairs: [["rbk-adressa", "rbk-nrk"]],
    expectedSeparatePairs: [],
    expectedGroups: [["rbk-adressa", "rbk-nrk"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
  {
    id: "syndicated-profile",
    articles: [
      article("profile-ta", {
        source: "t_a",
        sourceLabel: "Trønder-Avisa",
        title: "Mistet foreldrene med ett års mellomrom: Det var tøft",
        excerpt: "Nå ønsker Heidi å videreføre det foreldrene lærte henne.",
        category: "Nyheter",
        places: ["Trondheim"],
      }),
      article("profile-nidaros", {
        source: "nidaros",
        sourceLabel: "Nidaros",
        title: "Senterlederen mistet begge foreldrene med ett års mellomrom",
        excerpt: "Nå ønsker Heidi å videreføre det foreldrene lærte henne.",
        category: "Nyheter",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T05:14:00.000Z",
      }),
    ],
    expectedSamePairs: [["profile-ta", "profile-nidaros"]],
    expectedSeparatePairs: [],
    expectedGroups: [["profile-ta", "profile-nidaros"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
  {
    id: "speeding-versus-threat",
    articles: [
      article("speed-a", {
        source: "avisa_st",
        sourceLabel: "Avisa Sør-Trøndelag",
        title: "Ungdommer kjørte i nær 200 kilometer i timen",
        excerpt: "Politiet fikk kontroll på bilen etter svært høy fart.",
        category: "Krim",
        places: ["Orkland"],
      }),
      article("speed-b", {
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Stanset ungdommer etter kjøring i 200",
        excerpt: "Politiet har kontroll på ungdommene etter kjøringen.",
        category: "Krim",
        places: ["Orkland"],
        publishedAt: "2026-07-12T19:55:00.000Z",
      }),
      article("threat-selbyggen", {
        source: "selbyggen",
        sourceLabel: "Selbyggen",
        title: "Mann pågrepet etter en trussel- og voldssituasjon",
        excerpt: "Politiet har kontroll på mannen etter at ungdom tok kontakt.",
        category: "Krim",
        places: ["Selbu"],
        publishedAt: "2026-07-12T19:50:00.000Z",
      }),
    ],
    expectedSamePairs: [["speed-a", "speed-b"]],
    expectedSeparatePairs: [
      ["speed-a", "threat-selbyggen"],
      ["speed-b", "threat-selbyggen"],
    ],
    expectedGroups: [["speed-a", "speed-b"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
  {
    id: "construction-fire-versus-cooking",
    articles: [
      article("fire-nrk", {
        title: "Brann i brakke på byggeplass",
        excerpt: "Nødetatene rykket til en anleggsbrakke i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("fire-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Brakke brant på byggeplass i Nærøysund",
        excerpt: "Brannvesenet fikk kontroll på brannen i anleggsbrakka.",
        places: ["Nærøysund"],
        publishedAt: "2026-07-12T19:55:00.000Z",
      }),
      article("cooking-nrk", {
        title: "Stekte Fjordland med plasten på",
        excerpt: "Matlagingen førte til røyk i en bolig på Møllenberg.",
        places: ["Møllenberg", "Trondheim"],
        publishedAt: "2026-07-12T19:50:00.000Z",
      }),
    ],
    expectedSamePairs: [["fire-nrk", "fire-adressa"]],
    expectedSeparatePairs: [
      ["fire-nrk", "cooking-nrk"],
      ["fire-adressa", "cooking-nrk"],
    ],
    expectedGroups: [["fire-nrk", "fire-adressa"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
];
```

- [ ] **Step 5: Run the evaluator test and typecheck shared**

Run:

```bash
npm test -- --run packages/shared/test/article-coverage-evaluator.test.ts
npm run typecheck -w @nytt/shared
```

Expected: evaluator test PASS and shared typecheck PASS.

- [ ] **Step 6: Commit the evaluator foundation**

```bash
git add packages/shared/src/article-coverage-evaluator.ts packages/shared/src/index.ts packages/shared/test/article-coverage-evaluator.test.ts packages/shared/test/fixtures/article-coverage-golden.ts
git commit -m "test: add coverage matching golden corpus"
```

---

### Task 2: Extract positive incident evidence and conflict signals

**Files:**
- Create: `packages/shared/src/article-coverage-evidence.ts`
- Create: `packages/shared/test/article-coverage-evidence.test.ts`
- Modify: `packages/shared/src/article-bundles.ts:100-705`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: existing token, place, topic and incident helpers moved from `article-bundles.ts` without behavior changes for v1.
- Produces: `articleCoverageEvidence(left, right, matcherVersion): ArticleCoveragePairEvidence`, `ArticleCoverageConflictSignal`, `ArticleIncidentSubtype`, and positive-evidence predicates for Task 3.

- [ ] **Step 1: Write false-positive and positive-control evidence tests**

Create `packages/shared/test/article-coverage-evidence.test.ts` with the shared fixture factory and these assertions:

```ts
import { describe, expect, it } from "vitest";
import type { Article } from "../src/index.js";
import { articleCoverageEvidence } from "../src/index.js";

function article(id: string, overrides: Partial<Article>): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: "",
    url: `https://example.test/${id}`,
    publishedAt: "2026-07-12T20:00:00.000Z",
    scope: "trondelag",
    category: "Hendelser",
    places: ["Trøndelag"],
    ...overrides,
  };
}

describe("v2 pair evidence", () => {
  it("does not treat generic order words as positive place or entity evidence", () => {
    const evidence = articleCoverageEvidence(
      article("speed", {
        title: "Ungdommer kjørte i nær 200",
        excerpt: "Politiet har kontroll på ungdommene.",
        places: ["Orkland"],
      }),
      article("threat", {
        title: "Mann pågrepet etter trusselsituasjon",
        excerpt: "Politiet har kontroll etter at ungdom tok kontakt.",
        places: ["Selbu"],
      }),
      "v2",
    );
    expect(evidence.positiveIncidentEvidence).toEqual([]);
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "specific_place" })]),
    );
  });

  it("distinguishes construction fire from cooking smoke", () => {
    const evidence = articleCoverageEvidence(
      article("construction", {
        title: "Brann i brakke på byggeplass",
        excerpt: "En anleggsbrakke brant i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("cooking", {
        title: "Stekte middag med plasten på",
        excerpt: "Matlaging førte til røyk i en bolig.",
        places: ["Møllenberg", "Trondheim"],
      }),
      "v2",
    );
    expect(evidence.incidentSubtypes).toEqual(["construction_fire", "cooking_smoke"]);
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
  });

  it("accepts shared specific place plus compatible construction-fire subtype", () => {
    const evidence = articleCoverageEvidence(
      article("left", {
        title: "Brann i brakke på byggeplass",
        excerpt: "Anleggsbrakka brant i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("right", {
        title: "Nødetatene til brakkebrann",
        excerpt: "Brannvesenet fikk kontroll på byggeplassen i Nærøysund.",
        places: ["Nærøysund"],
      }),
      "v2",
    );
    expect(evidence.positiveIncidentEvidence).toEqual(
      expect.arrayContaining(["shared_specific_place", "compatible_incident_subtype"]),
    );
    expect(evidence.conflicts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the evidence test and verify it fails**

Run:

```bash
npm test -- --run packages/shared/test/article-coverage-evidence.test.ts
```

Expected: FAIL because `articleCoverageEvidence` does not exist.

- [ ] **Step 3: Add explicit evidence and subtype contracts**

Create `packages/shared/src/article-coverage-evidence.ts` with these public contracts and subtype classifier:

```ts
import type { Article } from "./types.js";

export type CoverageMatcherVersion = "v1" | "v2";
export type ArticleIncidentSubtype =
  | "building_fire"
  | "vehicle_fire"
  | "vegetation_fire"
  | "construction_fire"
  | "cooking_smoke"
  | "traffic_collision"
  | "public_order"
  | "threat_or_violence"
  | "unknown";

export type ArticleCoverageConflictKind =
  | "specific_place"
  | "incident_subtype"
  | "situation_id"
  | "topic_opponent";

export type ArticleCoverageDecisionSignalKind =
  | "persisted_bundle"
  | "situation_id"
  | "title_similarity"
  | "near_duplicate"
  | "generic_place_incident"
  | "topical_thread"
  | "cross_source_incident"
  | "shared_place";

export interface ArticleCoverageDecisionSignal {
  kind: ArticleCoverageDecisionSignalKind;
  articleIds: string[];
  detail?: string;
  overlap?: number;
  score?: number;
}

export interface ArticleCoverageConflictSignal {
  kind: ArticleCoverageConflictKind;
  articleIds: [string, string];
  detail: string;
}

export type PositiveIncidentEvidence =
  | "same_situation_id"
  | "shared_specific_place"
  | "mentioned_specific_place"
  | "shared_named_entity"
  | "compatible_incident_subtype";

export interface ArticleCoveragePairEvidence {
  articleIds: [string, string];
  positiveIncidentEvidence: PositiveIncidentEvidence[];
  incidentSubtypes: [ArticleIncidentSubtype, ArticleIncidentSubtype];
  sharedBodyTokenCount: number;
  sharedDistinctiveTokenCount: number;
  titleScore: number;
  timeDistanceMs: number;
  conflicts: ArticleCoverageConflictSignal[];
  evidenceFingerprint: string;
}

function normalizedText(article: Article): string {
  return `${article.title} ${article.excerpt}`.toLocaleLowerCase("nb");
}

export function articleIncidentSubtype(article: Article): ArticleIncidentSubtype {
  const text = normalizedText(article);
  if (/\b(byggeplass|anleggsbrakke|brakke(?:brann|n)?|anlegg)\b/u.test(text)) return "construction_fire";
  if (/\b(matlag\w*|stekt\w*|komfyr\w*|middag|fjordland|plast(?:en)?)\b/u.test(text)) return "cooking_smoke";
  if (/\b(bilbrann|kjøretøy\w*\s+br(?:ann|enner)|bil\w*\s+br(?:ann|enner))\b/u.test(text)) return "vehicle_fire";
  if (/\b(skogbrann|gressbrann|lyngbrann|vegetasjon\w*\s+br(?:ann|enner))\b/u.test(text)) return "vegetation_fire";
  if (/\b(bygningsbrann|husbrann|leilighet\w*\s+br(?:ann|enner)|garasjebrann)\b/u.test(text)) return "building_fire";
  if (/\b(kollisjon|trafikkulykke|påkjør\w*|kjørte\s+(?:av|ut))\b/u.test(text)) return "traffic_collision";
  if (/\b(trussel\w*|vold\w*|pågrepet)\b/u.test(text)) return "threat_or_violence";
  if (/\b(ordensforstyrrelse|bortvis\w*|slagsm[åa]l\w*)\b/u.test(text)) return "public_order";
  return "unknown";
}

const incompatibleSubtypes = new Set([
  "construction_fire\u0000cooking_smoke",
  "building_fire\u0000cooking_smoke",
  "vehicle_fire\u0000construction_fire",
  "vehicle_fire\u0000building_fire",
  "vegetation_fire\u0000construction_fire",
  "public_order\u0000threat_or_violence",
]);

const namedEntityStopTokens = new Set([
  "politiet",
  "trondheim",
  "trøndelag",
  "nødetatene",
  "brann",
  "mann",
  "kvinne",
  "ungdom",
  "person",
  "norge",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
  "søndag",
]);

function hasSharedSpecificPlace(left: Article, right: Article): boolean {
  const rightPlaces = new Set(articlePlaceTokens(right).filter((token) => !genericPlaceTokens.has(token)));
  return articlePlaceTokens(left).some((token) => !genericPlaceTokens.has(token) && rightPlaces.has(token));
}

function hasSharedNamedEntity(left: Article, right: Article): boolean {
  const rightEntities = new Set(articleNamedEntityTokens(right));
  return articleNamedEntityTokens(left).some((token) => rightEntities.has(token));
}

function articleNamedEntityTokens(article: Article): string[] {
  const text = `${article.title} ${article.excerpt}`;
  const candidates = text.match(/\b[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}(?:\s+[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}){0,2}\b/gu) ?? [];
  return [...new Set(candidates.map(normalizeToken))].filter(
    (token) => token.length >= 4 && !genericPlaceTokens.has(token) && !namedEntityStopTokens.has(token),
  );
}

function subtypesCompatible(left: ArticleIncidentSubtype, right: ArticleIncidentSubtype): boolean {
  return left !== "unknown" && left === right;
}

function bodyTokenSimilarity(left: Article, right: Article) {
  return tokenSimilarity(articleBodyTokens(left), articleBodyTokens(right));
}

function distinctiveTokenSimilarity(left: Article, right: Article) {
  return tokenSimilarity(articleDistinctiveIncidentTokens(left), articleDistinctiveIncidentTokens(right));
}

function titleTokenSimilarity(left: Article, right: Article) {
  return tokenSimilarity(articleTitleTokens(left), articleTitleTokens(right));
}

function subtypePair(left: ArticleIncidentSubtype, right: ArticleIncidentSubtype): string {
  return [left, right].sort().join("\u0000");
}

function fingerprintHash(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  return `v2:${fingerprintHash(serialized, 2166136261)}${fingerprintHash(serialized, 3335557771)}`;
}
```

Then move the existing private token/place/title calculations from `article-bundles.ts` into this module as named internal helpers and implement `articleCoverageEvidence()` so it:

```ts
export function articleCoverageEvidence(
  left: Article,
  right: Article,
  matcherVersion: CoverageMatcherVersion,
): ArticleCoveragePairEvidence {
  const articleIds = [left.id, right.id].sort() as [string, string];
  const leftSubtype = articleIncidentSubtype(left);
  const rightSubtype = articleIncidentSubtype(right);
  const conflicts: ArticleCoverageConflictSignal[] = [];
  if (hasConflictingSpecificPlaces(left, right)) {
    conflicts.push({ kind: "specific_place", articleIds, detail: "Ulike spesifikke steder" });
  }
  if (incompatibleSubtypes.has(subtypePair(leftSubtype, rightSubtype))) {
    conflicts.push({ kind: "incident_subtype", articleIds, detail: `${leftSubtype}/${rightSubtype}` });
  }
  if (left.situationId && right.situationId && left.situationId !== right.situationId) {
    conflicts.push({ kind: "situation_id", articleIds, detail: `${left.situationId}/${right.situationId}` });
  }

  const positiveIncidentEvidence: PositiveIncidentEvidence[] = [];
  if (left.situationId && left.situationId === right.situationId) positiveIncidentEvidence.push("same_situation_id");
  if (hasSharedSpecificPlace(left, right)) positiveIncidentEvidence.push("shared_specific_place");
  if (hasSpecificPlaceMention(left, right)) positiveIncidentEvidence.push("mentioned_specific_place");
  if (hasSharedNamedEntity(left, right)) positiveIncidentEvidence.push("shared_named_entity");
  if (subtypesCompatible(leftSubtype, rightSubtype)) positiveIncidentEvidence.push("compatible_incident_subtype");

  const body = bodyTokenSimilarity(left, right);
  const distinctive = distinctiveTokenSimilarity(left, right);
  const titleScore = titleTokenSimilarity(left, right).score;
  const timeDistanceMs = Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  return {
    articleIds,
    positiveIncidentEvidence,
    incidentSubtypes: [leftSubtype, rightSubtype],
    sharedBodyTokenCount: body.overlap,
    sharedDistinctiveTokenCount: distinctive.overlap,
    titleScore,
    timeDistanceMs,
    conflicts,
    evidenceFingerprint: fingerprint({
      matcherVersion,
      positiveIncidentEvidence: [...positiveIncidentEvidence].sort(),
      incidentSubtypes: [leftSubtype, rightSubtype].sort(),
      conflicts: conflicts.map((item) => item.kind).sort(),
      bodyBucket: Math.min(body.overlap, 8),
      distinctiveBucket: Math.min(distinctive.overlap, 5),
      titleBucket: Math.round(titleScore * 20) / 20,
      timeBucketMinutes: Math.floor(timeDistanceMs / 300_000) * 5,
    }),
  };
}
```

Export the module from `packages/shared/src/index.ts`. Preserve the v1 wrappers in `article-bundles.ts` by delegating to the moved helpers so existing v1 tests remain unchanged.

- [ ] **Step 4: Run evidence and v1 regression tests**

Run:

```bash
npm test -- --run packages/shared/test/article-coverage-evidence.test.ts packages/shared/test/article-coverage-analysis.test.ts apps/frontend/src/homeArticleGroups.test.ts
```

Expected: all tests PASS; existing v1 bundle IDs and decisions remain unchanged.

- [ ] **Step 5: Commit the evidence extraction**

```bash
git add packages/shared/src/article-coverage-evidence.ts packages/shared/src/article-bundles.ts packages/shared/src/index.ts packages/shared/test/article-coverage-evidence.test.ts
git commit -m "refactor: extract coverage pair evidence"
```

---

### Task 3: Score strong, moderate and weak v2 edges

**Files:**
- Modify: `packages/shared/src/article-coverage-evidence.ts`
- Modify: `packages/shared/test/article-coverage-evidence.test.ts`
- Modify: `packages/shared/src/article-bundles.ts:1-95`

**Interfaces:**
- Consumes: `ArticleCoveragePairEvidence` from Task 2.
- Produces: `ArticleCoverageEdge`, `ArticleCoverageMatchTier`, `articleCoverageEdge(left, right)`, and `ArticleCoverageAnalysis.edges` for Tasks 4-6 and Plan 2.

- [ ] **Step 1: Add edge-tier tests for strong, moderate and weak evidence**

Append to `packages/shared/test/article-coverage-evidence.test.ts`:

```ts
import { articleCoverageEdge } from "../src/index.js";

it("scores a shared official situation as strong", () => {
  const edge = articleCoverageEdge(
    article("official", { source: "politiloggen", sourceLabel: "Politiloggen", situationId: "incident-1", places: ["Lade"] }),
    article("news", { source: "adressa", sourceLabel: "Adresseavisen", situationId: "incident-1", places: ["Lade"] }),
  );
  expect(edge).toMatchObject({ tier: "strong", kind: "incident" });
  expect(edge?.score).toBeGreaterThanOrEqual(0.85);
});

it("scores compatible shared-place coverage as moderate", () => {
  const edge = articleCoverageEdge(
    article("fire-a", { title: "Brann i anleggsbrakke", excerpt: "Brakke brant i Nærøysund", places: ["Nærøysund"] }),
    article("fire-b", { title: "Nødetatene til brakkebrann", excerpt: "Byggeplassen i Nærøysund", places: ["Nærøysund"] }),
  );
  expect(edge).toMatchObject({ tier: "moderate", kind: "incident" });
  expect(edge?.score).toBeGreaterThanOrEqual(0.6);
});

it("keeps text-only generic incident overlap weak", () => {
  const edge = articleCoverageEdge(
    article("generic-a", { title: "Politiet har kontroll", excerpt: "Ungdom var involvert", places: ["Trøndelag"] }),
    article("generic-b", { title: "Politiet fikk kontroll", excerpt: "Ungdom tok kontakt", places: ["Trøndelag"] }),
  );
  expect(edge?.tier).toBe("weak");
});
```

- [ ] **Step 2: Run the tests and verify the missing edge API failure**

Run:

```bash
npm test -- --run packages/shared/test/article-coverage-evidence.test.ts
```

Expected: FAIL because `articleCoverageEdge` is not exported.

- [ ] **Step 3: Implement edge scoring with explicit accepted/reviewable status**

Add to `article-coverage-evidence.ts`:

```ts
export type ArticleCoverageMatchTier = "strong" | "moderate" | "weak";
export type ArticleCoverageEdgeKind = "incident" | "topic" | "update";

export interface ArticleCoverageEdge {
  articleIds: [string, string];
  tier: ArticleCoverageMatchTier;
  score: number;
  kind: ArticleCoverageEdgeKind;
  signals: ArticleCoverageDecisionSignal[];
  conflicts: ArticleCoverageConflictSignal[];
  evidenceFingerprint: string;
  reviewable: boolean;
  correctionConflict: boolean;
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

export function articleCoverageEdge(left: Article, right: Article): ArticleCoverageEdge | undefined {
  const evidence = articleCoverageEvidence(left, right, "v2");
  const signals = articlePairSignalsForV2(left, right);
  const kind = coverageKindForPair(left, right, signals);
  const positiveCount = evidence.positiveIncidentEvidence.length;
  const hasBlockingConflict = evidence.conflicts.length > 0;
  const textScore = Math.min(0.25, evidence.titleScore * 0.15 + evidence.sharedDistinctiveTokenCount * 0.025);
  const situationScore = evidence.positiveIncidentEvidence.includes("same_situation_id") ? 0.7 : 0;
  const placeScore = evidence.positiveIncidentEvidence.some((item) => item === "shared_specific_place" || item === "mentioned_specific_place") ? 0.3 : 0;
  const entityScore = evidence.positiveIncidentEvidence.includes("shared_named_entity") ? 0.2 : 0;
  const subtypeScore = evidence.positiveIncidentEvidence.includes("compatible_incident_subtype") ? 0.15 : 0;
  const topicScore = kind === "topic" && signals.some((signal) => signal.kind === "topical_thread") ? 0.65 : 0;
  const duplicateScore = signals.some((signal) => signal.kind === "near_duplicate" || signal.kind === "title_similarity") ? 0.55 : 0;
  const score = boundedScore(situationScore + placeScore + entityScore + subtypeScore + topicScore + duplicateScore + textScore);

  if (signals.length === 0 && score < 0.35) return undefined;
  let tier: ArticleCoverageMatchTier = "weak";
  if (!hasBlockingConflict && score >= 0.85 && (situationScore > 0 || topicScore > 0 || duplicateScore > 0)) tier = "strong";
  else if (!hasBlockingConflict && score >= 0.6 && (kind !== "incident" || positiveCount > 0)) tier = "moderate";

  return {
    articleIds: evidence.articleIds,
    tier,
    score,
    kind,
    signals,
    conflicts: evidence.conflicts,
    evidenceFingerprint: evidence.evidenceFingerprint,
    reviewable: tier === "weak" || hasBlockingConflict,
    correctionConflict: false,
  };
}
```

Move the existing signal type definitions from `article-bundles.ts` into this module and re-export them from `article-bundles.ts` so current imports remain valid. Move the pair-signal helpers here as well; both v1 and v2 call the same extracted pure helpers. Implement:

```ts
function articlePairSignalsForV2(left: Article, right: Article): ArticleCoverageDecisionSignal[] {
  return articlePairSignals(left, right).filter((signal) => signal.kind !== "persisted_bundle");
}

function coverageKindForPair(
  _left: Article,
  _right: Article,
  signals: ArticleCoverageDecisionSignal[],
): ArticleCoverageEdgeKind {
  const hasIncident = signals.some((signal) =>
    ["situation_id", "generic_place_incident", "cross_source_incident", "shared_place"].includes(signal.kind),
  );
  const hasTopic = signals.some((signal) => signal.kind === "topical_thread");
  if (hasTopic && !hasIncident) return "topic";
  if (hasIncident) return "incident";
  return "update";
}
```

`articlePlaceTokens`, `genericPlaceTokens`, `articleNamedEntityTokens`, body/title/distinctive token helpers, `tokenSimilarity`, `hasConflictingSpecificPlaces`, `hasSpecificPlaceMention` and `articlePairSignals` are moved from the current monolith into this module in the same commit. `articleNamedEntityTokens` extracts normalized capitalized multiword names and street names while excluding the existing Norwegian stopword and generic-place sets. V1 delegates to the moved functions so its regression output remains byte-for-byte stable.

Extend `ArticleCoverageAnalysis` in `article-bundles.ts`:

```ts
export interface ArticleCoverageAnalysis {
  articles: Article[];
  bundles: ArticleCoverageBundleDecision[];
  nearMisses: ArticleCoverageNearMiss[];
  edges?: ArticleCoverageEdge[];
}
```

- [ ] **Step 4: Run evidence, evaluator and v1 regression tests**

```bash
npm test -- --run packages/shared/test/article-coverage-evidence.test.ts packages/shared/test/article-coverage-evaluator.test.ts packages/shared/test/article-coverage-analysis.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit edge scoring**

```bash
git add packages/shared/src/article-coverage-evidence.ts packages/shared/src/article-bundles.ts packages/shared/test/article-coverage-evidence.test.ts
git commit -m "feat: score coverage match edges"
```

---

### Task 4: Replace single-link v2 grouping with constrained clustering

**Files:**
- Create: `packages/shared/src/article-coverage-clustering.ts`
- Create: `packages/shared/test/article-coverage-clustering.test.ts`
- Modify: `packages/shared/src/types.ts:143-155`
- Modify: `packages/shared/src/article-bundles.ts:920-1225`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `ArticleCoverageEdge` and deterministic article ordering from Tasks 2-3.
- Produces: `clusterArticlesByCoverageEdges(articles, edges, options)`, `CoverageRejectedPair`, `analyzeArticleCoverageV2()`, and group match confidence for Plans 2-3.

- [ ] **Step 1: Write bridge, quorum, rejection and permutation tests**

Create `packages/shared/test/article-coverage-clustering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Article, ArticleCoverageEdge } from "../src/index.js";
import { clusterArticlesByCoverageEdges } from "../src/index.js";

function article(id: string, publishedAt: string): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: id,
    url: `https://example.test/${id}`,
    publishedAt,
    scope: "trondheim",
    category: "Hendelser",
    places: ["Trondheim"],
  };
}

function edge(left: string, right: string, tier: "strong" | "moderate" | "weak", score: number): ArticleCoverageEdge {
  return {
    articleIds: [left, right].sort() as [string, string],
    tier,
    score,
    kind: "incident",
    signals: [],
    conflicts: [],
    evidenceFingerprint: `v2:${left}:${right}`,
    reviewable: tier === "weak",
    correctionConflict: false,
  };
}

const articles = [
  article("a", "2026-07-12T20:03:00.000Z"),
  article("b", "2026-07-12T20:02:00.000Z"),
  article("c", "2026-07-12T20:01:00.000Z"),
  article("bridge", "2026-07-12T20:00:00.000Z"),
];

describe("constrained coverage clustering", () => {
  it("does not merge components through one moderate bridge", () => {
    const groups = clusterArticlesByCoverageEdges(
      articles,
      [edge("a", "b", "strong", 0.9), edge("c", "bridge", "strong", 0.9), edge("b", "bridge", "moderate", 0.65)],
      { rejectedPairs: [] },
    );
    expect(groups.map((group) => group.articles.map((item) => item.id).sort())).toEqual([
      ["a", "b"],
      ["bridge", "c"],
    ]);
  });

  it("admits a moderate member with two-member quorum", () => {
    const groups = clusterArticlesByCoverageEdges(
      articles.slice(0, 3),
      [edge("a", "b", "strong", 0.9), edge("a", "c", "moderate", 0.64), edge("b", "c", "moderate", 0.62)],
      { rejectedPairs: [] },
    );
    expect(groups[0]?.articles.map((item) => item.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("prevents transitive grouping of an active rejected pair", () => {
    const groups = clusterArticlesByCoverageEdges(
      articles.slice(0, 3),
      [edge("a", "b", "strong", 0.9), edge("b", "c", "strong", 0.9)],
      { rejectedPairs: [{ articleIds: ["a", "c"], correctionId: "correction-1" }] },
    );
    expect(groups.every((group) => !(group.articles.some((item) => item.id === "a") && group.articles.some((item) => item.id === "c")))).toBe(true);
  });

  it("is invariant to input order", () => {
    const edges = [edge("a", "b", "strong", 0.9), edge("a", "c", "moderate", 0.7), edge("b", "c", "moderate", 0.68)];
    const forward = clusterArticlesByCoverageEdges(articles.slice(0, 3), edges, { rejectedPairs: [] });
    const reverse = clusterArticlesByCoverageEdges([...articles.slice(0, 3)].reverse(), [...edges].reverse(), { rejectedPairs: [] });
    expect(forward.map((group) => group.id)).toEqual(reverse.map((group) => group.id));
    expect(forward.map((group) => group.articles.map((item) => item.id))).toEqual(reverse.map((group) => group.articles.map((item) => item.id)));
  });
});
```

- [ ] **Step 2: Run clustering tests and verify failure**

```bash
npm test -- --run packages/shared/test/article-coverage-clustering.test.ts
```

Expected: FAIL because `clusterArticlesByCoverageEdges` is missing.

- [ ] **Step 3: Implement deterministic constrained clustering**

Create `packages/shared/src/article-coverage-clustering.ts`. Implement the exported contracts exactly:

```ts
import type { Article } from "./types.js";
import type { ArticleCoverageEdge } from "./article-coverage-evidence.js";
import type { HomeArticleGroup } from "./article-bundles.js";

export interface CoverageRejectedPair {
  articleIds: [string, string];
  correctionId: string;
}

export interface CoverageClusteringOptions {
  rejectedPairs: CoverageRejectedPair[];
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function articleOrder(left: Article, right: Article): number {
  return right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id);
}

function stableGroupId(articles: Article[]): string {
  const oldest = [...articles].sort(
    (left, right) => left.publishedAt.localeCompare(right.publishedAt) || left.id.localeCompare(right.id),
  )[0]!;
  let hash = 2166136261;
  for (const char of oldest.id) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `coverage:v2:${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

export function clusterArticlesByCoverageEdges(
  articles: Article[],
  edges: ArticleCoverageEdge[],
  options: CoverageClusteringOptions,
): HomeArticleGroup[] {
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const rejected = new Set(options.rejectedPairs.map((pair) => pairKey(...pair.articleIds)));
  const blocked = new Set(
    edges.filter((edge) => edge.conflicts.length > 0).map((edge) => pairKey(...edge.articleIds)),
  );
  const acceptedEdges = edges
    .filter((edge) => edge.tier !== "weak" && edge.conflicts.length === 0 && !rejected.has(pairKey(...edge.articleIds)))
    .sort((left, right) => right.score - left.score || pairKey(...left.articleIds).localeCompare(pairKey(...right.articleIds)));
  const groups: string[][] = [];

  for (const edge of acceptedEdges.filter((item) => item.tier === "strong")) {
    const matching = groups.filter((group) => edge.articleIds.some((id) => group.includes(id)));
    const candidate = [...new Set([...edge.articleIds, ...matching.flat()])];
    const containsBlockedPair = candidate.some((left, index) =>
      candidate.slice(index + 1).some((right) => rejected.has(pairKey(left, right)) || blocked.has(pairKey(left, right))),
    );
    if (containsBlockedPair) continue;
    for (const group of matching) groups.splice(groups.indexOf(group), 1);
    groups.push(candidate);
  }

  for (const article of [...articles].sort(articleOrder)) {
    if (groups.some((group) => group.includes(article.id))) continue;
    const candidates = groups.filter((group) => {
      const sortedMembers = group.map((id) => articlesById.get(id)!).sort(articleOrder);
      const anchor = sortedMembers[0]!;
      const connecting = acceptedEdges.filter((edge) => edge.articleIds.includes(article.id) && edge.articleIds.some((id) => group.includes(id)));
      const anchorMatch = connecting.some((edge) => edge.articleIds.includes(anchor.id));
      return anchorMatch || connecting.length >= 2;
    });
    if (candidates.length === 1) {
      const candidate = [...candidates[0]!, article.id];
      const conflict = candidate.some((left, index) =>
        candidate.slice(index + 1).some((right) => rejected.has(pairKey(left, right)) || blocked.has(pairKey(left, right))),
      );
      if (!conflict) candidates[0]!.push(article.id);
    } else {
      groups.push([article.id]);
    }
  }

  return groups
    .map((ids) => ids.map((id) => articlesById.get(id)!).sort(articleOrder))
    .map((members) => ({
      id: stableGroupId(members),
      primary: members[0]!,
      articles: members,
      sourceLabels: [...new Set(members.map((item) => item.sourceLabel))],
      acceptedEdges: acceptedEdges.filter((edge) => edge.articleIds.every((id) => members.some((item) => item.id === id))),
    }))
    .sort((left, right) => articleOrder(left.primary, right.primary));
}
```

Extend `HomeArticleGroup` with optional `acceptedEdges?: ArticleCoverageEdge[]` so v1 call sites remain source-compatible. Add the barrel export.

- [ ] **Step 4: Add `analyzeArticleCoverageV2` orchestration**

First add the backward-compatible v2 metadata contract to `types.ts`:

```ts
export interface CoverageMatchConfidence {
  tier: "strong" | "moderate";
  score: number;
  rationale: string;
}

export interface ArticleCoverageBundle {
  id: string;
  kind: ArticleCoverageBundleKind;
  confidence: ArticleCoverageBundleConfidence;
  reason: string;
  generatedAt: string;
  matchConfidence?: CoverageMatchConfidence;
  matcherVersion?: "v1" | "v2";
}
```

In `article-bundles.ts`, add:

```ts
export interface AnalyzeArticleCoverageV2Options {
  rejectedPairs?: CoverageRejectedPair[];
}

export function analyzeArticleCoverageV2(
  articles: Article[],
  generatedAt = new Date().toISOString(),
  options: AnalyzeArticleCoverageV2Options = {},
): ArticleCoverageAnalysis {
  const evaluatedEdges = articles.flatMap((left, index) =>
    articles.slice(index + 1).flatMap((right) => articleCoverageEdge(left, right) ?? []),
  );
  const acceptedEdges = evaluatedEdges.filter(
    (edge) => edge.tier !== "weak" && edge.conflicts.length === 0 && !edge.reviewable,
  );
  const reviewCounts = new Map<string, number>();
  const reviewableEdges = evaluatedEdges
    .filter((edge) => edge.reviewable)
    .sort((left, right) => right.score - left.score || left.articleIds.join("\u0000").localeCompare(right.articleIds.join("\u0000")))
    .filter((edge) => {
      if (edge.articleIds.some((id) => (reviewCounts.get(id) ?? 0) >= 5)) return false;
      for (const id of edge.articleIds) reviewCounts.set(id, (reviewCounts.get(id) ?? 0) + 1);
      return true;
    })
    .slice(0, 500);
  const edges = [...acceptedEdges, ...reviewableEdges];
  const groups = clusterArticlesByCoverageEdges(articles, edges, {
    rejectedPairs: options.rejectedPairs ?? [],
  });
  const bundles = groups.flatMap((group) => coverageDecisionForV2Group(group, generatedAt, edges) ?? []);
  const bundleByArticleId = new Map(bundles.flatMap((bundle) => bundle.memberArticleIds.map((id) => [id, bundle] as const)));
  return {
    articles: articles.map((article) => {
      const bundle = bundleByArticleId.get(article.id);
      return bundle ? { ...article, coverageBundle: coverageBundleMetadata(bundle) } : article;
    }),
    bundles,
    nearMisses: [],
    edges,
  };
}
```

Add a clustering-analysis test with 20 unrelated weak candidates for one article and assert at most five reviewable edges touch that article. Accepted edges are never removed by this cap. Task 4's correction-aware extension must retain every `correctionConflict` edge before applying the ordinary weak-edge cap.

Add the orchestration helpers in the same module:

```ts
function preliminaryV2MatchConfidence(group: HomeArticleGroup): CoverageMatchConfidence {
  const accepted = group.acceptedEdges ?? [];
  const anchorEdges = group.articles
    .filter((article) => article.id !== group.primary.id)
    .map((article) => accepted.find((edge) => edge.articleIds.includes(group.primary.id) && edge.articleIds.includes(article.id)))
    .filter((edge): edge is ArticleCoverageEdge => Boolean(edge));
  const strong = anchorEdges.length === group.articles.length - 1 && anchorEdges.every((edge) => edge.tier === "strong");
  const score = Math.min(...anchorEdges.map((edge) => edge.score));
  return {
    tier: strong ? "strong" : "moderate",
    score,
    rationale: strong
      ? "Alle støttesakene har et sterkt direkte treff med hovedsaken."
      : "Støttesakene er tatt inn gjennom hovedsak eller flertallstreff.",
  };
}

function coverageDecisionForV2Group(
  group: HomeArticleGroup,
  generatedAt: string,
  allEdges: ArticleCoverageEdge[],
): ArticleCoverageBundleDecision | undefined {
  if (group.articles.length < 2) return undefined;
  const memberIds = new Set(group.articles.map((article) => article.id));
  const groupEdges = allEdges.filter((edge) => edge.articleIds.every((id) => memberIds.has(id)));
  const accepted = groupEdges.filter((edge) => edge.tier !== "weak" && edge.conflicts.length === 0);
  const matchConfidence = preliminaryV2MatchConfidence({ ...group, acceptedEdges: accepted });
  const kind = accepted.some((edge) => edge.kind === "incident")
    ? "incident"
    : accepted.some((edge) => edge.kind === "topic")
      ? "topic"
      : "update";
  return {
    id: group.id,
    kind,
    confidence: matchConfidence.tier === "strong" ? "high" : "medium",
    reason: kind === "incident" ? "Samme hendelse" : kind === "topic" ? "Samme nyhetstema" : "Samme publiserte sak",
    generatedAt,
    matcherVersion: "v2",
    matchConfidence,
    primaryArticleId: group.primary.id,
    memberArticleIds: group.articles.map((article) => article.id),
    sourceIds: [...new Set(group.articles.map((article) => article.source))],
    sourceLabels: [...new Set(group.articles.map((article) => article.sourceLabel))],
    signals: uniqueSignals(accepted.flatMap((edge) => edge.signals)),
    nearMisses: groupEdges
      .filter((edge) => edge.reviewable)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map((edge) => ({
        articleIds: edge.articleIds,
        reason: edge.conflicts.some((conflict) => conflict.kind === "specific_place")
          ? "conflicting_specific_places"
          : "low_text_overlap",
        score: edge.score,
      })),
  };
}

function coverageBundleMetadata(bundle: ArticleCoverageBundleDecision): ArticleCoverageBundle {
  return {
    id: bundle.id,
    kind: bundle.kind,
    confidence: bundle.confidence,
    reason: bundle.reason,
    generatedAt: bundle.generatedAt,
    matcherVersion: "v2",
    matchConfidence: bundle.matchConfidence,
  };
}
```

Task 5 replaces `preliminaryV2MatchConfidence()` with the final cohesion-penalized implementation. Until then, strong maps to legacy `high` and moderate to legacy `medium` only for backward-compatible metadata.

- [ ] **Step 5: Run clustering, golden corpus and v1 regression tests**

```bash
npm test -- --run packages/shared/test/article-coverage-clustering.test.ts packages/shared/test/article-coverage-evidence.test.ts packages/shared/test/article-coverage-analysis.test.ts packages/shared/test/article-coverage-evaluator.test.ts
```

Expected: all tests PASS, including bridge and permutation tests.

- [ ] **Step 6: Commit constrained clustering**

```bash
git add packages/shared/src/article-coverage-clustering.ts packages/shared/src/types.ts packages/shared/src/article-bundles.ts packages/shared/src/index.ts packages/shared/test/article-coverage-clustering.test.ts
git commit -m "feat: constrain coverage clustering"
```

---

### Task 5: Separate match confidence, source trust and direct verification

**Files:**
- Modify: `packages/shared/src/types.ts:130-160`
- Modify: `packages/shared/src/article-bundles.ts:1094-1215`
- Modify: `packages/shared/src/public-verification.ts:46-78`
- Modify: `packages/shared/src/article-coverage-evaluator.ts`
- Modify: `packages/shared/test/article-coverage-analysis.test.ts`
- Modify: `packages/shared/test/public-verification.test.ts`
- Modify: `apps/frontend/src/homeStoryCards.ts:111-151`
- Modify: `apps/frontend/src/homeStoryCards.test.ts`

**Interfaces:**
- Consumes: accepted group edges from Task 4 and existing `SourceConfidenceSummary`.
- Produces: `CoverageMatchConfidence`, `CoverageTrustSummary`, `ArticleCoverageBundle.matchConfidence`, and edge-aware `derivePublicVerificationForArticleGroup(group)` for Plans 2-3.

- [ ] **Step 1: Write tests proving source diversity cannot create strong match confidence or verification**

Add to `packages/shared/test/article-coverage-analysis.test.ts`:

```ts
it("keeps multi-source moderate groups distinct from strong match confidence", () => {
  const analysis = analyzeArticleCoverageV2([
    article({ id: "left", source: "nrk", sourceLabel: "NRK Trøndelag", places: ["Nærøysund"], title: "Brann i anleggsbrakke", excerpt: "Byggeplass i Nærøysund" }),
    article({ id: "right", source: "adressa", sourceLabel: "Adresseavisen", places: ["Nærøysund"], title: "Brakkebrann på byggeplass", excerpt: "Nødetatene rykket ut" }),
  ]);
  expect(analysis.bundles[0]?.matchConfidence).toMatchObject({ tier: "moderate" });
  expect(analysis.bundles[0]?.confidence).toBe("medium");
});
```

Replace the first verification test in `packages/shared/test/public-verification.test.ts` with two tests:

```ts
it("derives verification only from a direct strong official-to-newsroom incident edge", () => {
  const articles = [
    article({ id: "news", source: "adressa", sourceLabel: "Adresseavisen" }),
    article({ id: "official", source: "politiloggen", sourceLabel: "Politiloggen", situationId: "incident-1" }),
  ];
  const verification = derivePublicVerificationForArticleGroup({
    ...group(articles),
    acceptedEdges: [{
      articleIds: ["news", "official"],
      tier: "strong",
      score: 0.95,
      kind: "incident",
      signals: [],
      conflicts: [],
      evidenceFingerprint: "v2:direct",
      reviewable: false,
      correctionConflict: false,
    }],
  });
  expect(verification?.label).toBe("Verifisert");
});

it("does not verify official and newsroom co-members connected only through another article", () => {
  const articles = [
    article({ id: "news", source: "adressa", sourceLabel: "Adresseavisen" }),
    article({ id: "bridge", source: "nrk", sourceLabel: "NRK Trøndelag" }),
    article({ id: "official", source: "politiloggen", sourceLabel: "Politiloggen" }),
  ];
  const verification = derivePublicVerificationForArticleGroup({
    ...group(articles),
    acceptedEdges: [{
      articleIds: ["news", "bridge"],
      tier: "strong",
      score: 0.9,
      kind: "incident",
      signals: [],
      conflicts: [],
      evidenceFingerprint: "v2:bridge",
      reviewable: false,
      correctionConflict: false,
    }],
  });
  expect(verification).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused tests and verify failures**

```bash
npm test -- --run packages/shared/test/article-coverage-analysis.test.ts packages/shared/test/public-verification.test.ts
```

Expected: FAIL because `matchConfidence` is missing and verification still uses co-membership.

- [ ] **Step 3: Add the combined trust-summary type**

The backward-compatible `CoverageMatchConfidence` and `ArticleCoverageBundle` fields already exist from Task 4. Add the combined summary contract to `packages/shared/src/types.ts`:

```ts
export interface CoverageTrustSummary {
  match: CoverageMatchConfidence;
  source: SourceConfidenceSummary;
  verification?: ArticlePublicVerification;
}
```

Keep legacy `confidence` until the contract migration in Plan 3.

- [ ] **Step 4: Derive group confidence from accepted admission edges**

Replace v2 group confidence with:

```ts
function v2GroupMatchConfidence(group: HomeArticleGroup): CoverageMatchConfidence {
  const edges = group.acceptedEdges ?? [];
  const anchorId = group.primary.id;
  const memberAdmissions = group.articles
    .filter((article) => article.id !== anchorId)
    .map((article) => {
      const connecting = edges
        .filter((edge) => edge.articleIds.includes(article.id))
        .sort((left, right) => right.score - left.score);
      const anchorEdge = connecting.find((edge) => edge.articleIds.includes(anchorId));
      if (anchorEdge) return { score: anchorEdge.score, directStrong: anchorEdge.tier === "strong" };
      const quorumEdge = connecting[1];
      return { score: quorumEdge?.score ?? 0, directStrong: false };
    });
  const minimum = Math.min(...memberAdmissions.map((admission) => admission.score));
  const allStrong = memberAdmissions.every((admission) => admission.directStrong);
  const cohesionPenalty = allStrong ? 0 : 0.05;
  return {
    tier: allStrong ? "strong" : "moderate",
    score: Math.max(0, Math.round((minimum - cohesionPenalty) * 1000) / 1000),
    rationale: allStrong
      ? "Alle støttesakene har et sterkt direkte treff med hovedsaken."
      : "Støttesakene er tatt inn gjennom hovedsak eller flertallstreff.",
  };
}
```

Store this on v2 bundle metadata, and map `strong` to legacy `high`, `moderate` to legacy `medium`.

- [ ] **Step 5: Require a direct strong verification edge**

In `public-verification.ts`, after collecting official and newsroom sources, find a direct edge:

```ts
const directStrongEdge = group.acceptedEdges?.find((edge) => {
  if (edge.kind !== "incident" || edge.tier !== "strong" || edge.conflicts.length > 0) return false;
  const members = edge.articleIds.map((id) => group.articles.find((article) => article.id === id));
  if (members.some((article) => !article)) return false;
  const [left, right] = members as [Article, Article];
  return (
    (isOfficialPublicVerificationSource(left.source) && isNewsroomPublicVerificationSource(right.source)) ||
    (isOfficialPublicVerificationSource(right.source) && isNewsroomPublicVerificationSource(left.source))
  );
});
if (!directStrongEdge) return undefined;
```

Derive `officialSources` and `reportingSources` from the two directly connected members rather than every group member.

- [ ] **Step 6: Keep frontend source trust independent**

In `homeStoryCards.ts`, retain `storySourceConfidence()` exactly as a source-mix calculation, expose `matchConfidence: group.bundle?.matchConfidence` on `HomeStoryCard`, and update tests to assert that a moderate match can still have `sourceConfidence.level === "likely"` without changing its match tier.

Update `verifiedGroupKeys()` in `article-coverage-evaluator.ts` to build each group from bundle members plus accepted analysis edges and call `derivePublicVerificationForArticleGroup()`. This makes `expectedVerifiedGroups` exercise the same direct-edge rule as production instead of trusting pre-attached article metadata:

```ts
function verifiedGroupKeys(analysis: ArticleCoverageAnalysis): Set<string> {
  const articlesById = new Map(analysis.articles.map((article) => [article.id, article]));
  return new Set(analysis.bundles.flatMap((bundle) => {
    const articles = bundle.memberArticleIds.flatMap((id) => articlesById.get(id) ?? []);
    if (articles.length !== bundle.memberArticleIds.length) return [];
    const memberIds = new Set(bundle.memberArticleIds);
    const group = {
      id: bundle.id,
      primary: articlesById.get(bundle.primaryArticleId)!,
      articles,
      sourceLabels: bundle.sourceLabels,
      bundle,
      acceptedEdges: (analysis.edges ?? []).filter(
        (edge) => edge.tier !== "weak" && edge.articleIds.every((id) => memberIds.has(id)),
      ),
    };
    return derivePublicVerificationForArticleGroup(group)
      ? [groupKey(bundle.memberArticleIds)]
      : [];
  }));
}
```

- [ ] **Step 7: Run shared and frontend trust tests**

```bash
npm test -- --run packages/shared/test/article-coverage-analysis.test.ts packages/shared/test/public-verification.test.ts apps/frontend/src/homeStoryCards.test.ts apps/frontend/src/homeArticleGroups.test.ts
npm run typecheck -w @nytt/shared
npm run typecheck -w @nytt/frontend
```

Expected: all focused tests and both typechecks PASS.

- [ ] **Step 8: Commit trust separation**

```bash
git add packages/shared/src/types.ts packages/shared/src/article-bundles.ts packages/shared/src/public-verification.ts packages/shared/src/article-coverage-evaluator.ts packages/shared/test/article-coverage-analysis.test.ts packages/shared/test/public-verification.test.ts apps/frontend/src/homeStoryCards.ts apps/frontend/src/homeStoryCards.test.ts
git commit -m "fix: separate coverage match and source trust"
```

---

### Task 6: Compute v2 shadow analysis without changing v1 persistence

**Files:**
- Modify: `apps/worker/src/index.ts:100-145,1260-1310`
- Modify: `apps/worker/test/index.test.ts`
- Modify: `.env.example`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SOURCES.md`

**Interfaces:**
- Consumes: `analyzeArticleCoverageV2()` and v1 `prepareArticleCoverageAnalysis()`.
- Produces: `prepareArticleCoverageAnalyses()` returning `{ active, shadow? }`; no repository signature changes in this plan.

- [ ] **Step 1: Write a worker test proving v2 is shadow-only**

Add to `apps/worker/test/index.test.ts`:

```ts
it("computes v2 shadow coverage without changing persisted v1 decisions", async () => {
  const articles = [
    newsArticle({ id: "coverage-a", title: "Brann i anleggsbrakke", excerpt: "Byggeplass i Nærøysund", places: ["Nærøysund"] }),
    newsArticle({ id: "coverage-b", source: "adressa", sourceLabel: "Adresseavisen", title: "Brakkebrann på byggeplass", excerpt: "Nødetatene rykket ut", places: ["Nærøysund"] }),
  ];
  const analyses = await prepareArticleCoverageAnalyses(
    articles,
    async (items) => items,
    "2026-07-12T21:00:00.000Z",
    "v2",
  );
  expect(analyses.active.matcherVersion).toBe("v1");
  expect(analyses.shadow?.matcherVersion).toBe("v2");
  expect(analyses.shadow).toBeDefined();
  const shadow = analyses.shadow!;
  expect(analyses.active.analysis.bundles).not.toBe(shadow.analysis.bundles);

  const repository = {
    upsertArticles: vi.fn(async () => undefined),
    upsertCoverageBundles: vi.fn(async () => undefined),
  };
  await persistPreparedCoverage(repository, analyses);
  expect(repository.upsertArticles).toHaveBeenCalledWith(analyses.active.analysis.articles, expect.any(String));
  expect(repository.upsertCoverageBundles).toHaveBeenCalledWith(analyses.active.analysis.bundles, expect.any(String));
  expect(repository.upsertCoverageBundles).not.toHaveBeenCalledWith(shadow.analysis.bundles, expect.any(String));
});
```

- [ ] **Step 2: Run the worker test and verify failure**

```bash
npm test -- --run apps/worker/test/index.test.ts
```

Expected: FAIL because the dual-analysis helpers do not exist.

- [ ] **Step 3: Add explicit active/shadow preparation**

In `apps/worker/src/index.ts`, export:

```ts
export interface PreparedCoverageAnalysis {
  matcherVersion: "v1" | "v2";
  analysis: ArticleCoverageAnalysis;
}

export interface PreparedCoverageAnalyses {
  active: PreparedCoverageAnalysis;
  shadow?: PreparedCoverageAnalysis;
}

export interface CoverageLegacyWriter {
  upsertArticles(articles: Article[], fetchedAt: string): Promise<void>;
  upsertCoverageBundles(bundles: ArticleCoverageBundleDecision[], seenAt: string): Promise<void>;
}

export async function prepareArticleCoverageAnalyses(
  articles: Article[],
  geocoder: (articles: Article[]) => Promise<Article[]>,
  generatedAt = new Date().toISOString(),
  matcherVersion: "v1" | "v2" = "v1",
): Promise<PreparedCoverageAnalyses> {
  const geocoded = await geocoder(articles.map(stripArticleCoverageBundle));
  const clean = geocoded.map(stripArticleCoverageBundle);
  return {
    active: { matcherVersion: "v1", analysis: analyzeArticleCoverage(clean, generatedAt) },
    ...(matcherVersion === "v2"
      ? { shadow: { matcherVersion: "v2" as const, analysis: analyzeArticleCoverageV2(clean, generatedAt) } }
      : {}),
  };
}

export async function persistPreparedCoverage(
  repository: CoverageLegacyWriter,
  analyses: PreparedCoverageAnalyses,
  seenAt = new Date().toISOString(),
): Promise<void> {
  await repository.upsertArticles(analyses.active.analysis.articles, seenAt);
  await repository.upsertCoverageBundles(analyses.active.analysis.bundles, seenAt);
}
```

Replace the current active call site with these helpers. Log only bounded numeric shadow deltas: active/shadow bundle counts, changed membership count, strong/moderate/weak edge counts and evaluation failures. Do not log titles, excerpts or reasons.

Add to `.env.example`:

```text
# `v2` enables shadow computation only; v1 remains persisted and public until Phase 3.
COVERAGE_MATCHER_VERSION=v1
```

Reject any runtime value other than `v1` or `v2`. In this plan `v2` enables shadow computation only; it does not authorize v2 persistence as active or public promotion.

- [ ] **Step 4: Document the shadow boundary**

Add to `docs/ARCHITECTURE.md`:

```markdown
### Coverage matcher shadow lane

The worker computes deterministic v1 and v2 coverage analyses from the same geocoded article snapshot. Until normalized generation persistence and parity gates ship, only v1 article metadata and legacy bundle rows are written. V2 contributes bounded comparison metrics only; it cannot create situations, source items, verification or public grouping.
```

Add to `docs/SOURCES.md`:

```markdown
Matcher versions and owner corrections are derived decisions, not collected sources. Shadow edges, evaluation labels and bundle corrections must never be written to `source_items` or used as automatic situation evidence.
```

- [ ] **Step 5: Run worker and shared tests**

```bash
npm test -- --run apps/worker/test/index.test.ts packages/shared/test/article-coverage-analysis.test.ts packages/shared/test/article-coverage-clustering.test.ts packages/shared/test/article-coverage-evidence.test.ts
npm run typecheck -w @nytt/worker
```

Expected: tests and worker typecheck PASS; repository mocks prove v1-only writes.

- [ ] **Step 6: Commit shadow computation**

```bash
git add apps/worker/src/index.ts apps/worker/test/index.test.ts .env.example docs/ARCHITECTURE.md docs/SOURCES.md
git commit -m "feat: run coverage matcher v2 in shadow"
```

---

### Task 7: Add the corpus command and complete the Phase 1 gate

**Files:**
- Create: `packages/shared/test/article-coverage-golden.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: golden corpus and `analyzeArticleCoverageV2()`.
- Produces: `npm run check:coverage-matcher`, a deterministic CI gate required by Plans 2-3.

- [ ] **Step 1: Add the golden-corpus gate test**

Create `packages/shared/test/article-coverage-golden.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeArticleCoverageV2, evaluateArticleCoverageCorpus } from "../src/index.js";
import { articleCoverageGoldenCases } from "./fixtures/article-coverage-golden.js";

describe("coverage matcher golden corpus", () => {
  it("passes all critical expectations deterministically", () => {
    const result = evaluateArticleCoverageCorpus(articleCoverageGoldenCases, (articles) =>
      analyzeArticleCoverageV2(articles, "2026-07-12T21:00:00.000Z"),
    );
    expect(result.criticalFailures).toEqual([]);
    expect(result.falsePositivePairs).toBe(0);
    expect(result.falseNegativePairs).toBe(0);
    expect(result.pairPrecision).toBe(1);
    expect(result.pairRecall).toBe(1);
    expect(result.groupPrecision).toBe(1);
    expect(result.bridgeErrorCount).toBe(0);
    if (result.labelledPairCount >= 100) {
      expect(result.pairPrecision).toBeGreaterThanOrEqual(0.98);
      expect(result.pairRecall).toBeGreaterThanOrEqual(0.9);
      expect(result.groupingCoverage).toBeGreaterThanOrEqual(0.9);
    }
  });
});
```

- [ ] **Step 2: Run the corpus test and tune only explicit evidence rules until it passes**

```bash
npm test -- --run packages/shared/test/article-coverage-golden.test.ts
```

Expected: PASS with zero critical failures. If it fails, change only scoring constants or explicit subtype/place/entity predicates in `article-coverage-evidence.ts`; do not special-case fixture IDs, titles or sources.

- [ ] **Step 3: Add the root command and CI step**

Add to root `package.json` scripts:

```json
"check:coverage-matcher": "vitest run packages/shared/test/article-coverage-golden.test.ts packages/shared/test/article-coverage-evidence.test.ts packages/shared/test/article-coverage-clustering.test.ts packages/shared/test/public-verification.test.ts"
```

Add after the unit-test step in `.github/workflows/ci.yml`:

```yaml
      - name: Check coverage matcher quality
        run: npm run check:coverage-matcher
```

- [ ] **Step 4: Document the Phase 1 promotion non-claim**

Add to `docs/DEPLOYMENT.md`:

```markdown
### Coverage matcher v2 Phase 1

`npm run check:coverage-matcher` is a mandatory deterministic quality gate. Passing it does not promote v2. Phase 1 keeps v1 as the only persisted/public matcher and records v2 comparison metrics without article text. Normalized shadow generations, seven-cycle parity and owner review are delivered by the lifecycle plan before promotion is possible.
```

- [ ] **Step 5: Run the complete Phase 1 verification**

```bash
df -h /System/Volumes/Data
npm run format:check
npm run lint
npm run typecheck
npm run check:coverage-matcher
npm test
npm run build
git diff --check
```

Expected: at least `30Gi` free and every command exits `0`.

- [ ] **Step 6: Commit the Phase 1 gate**

```bash
git add packages/shared/test/article-coverage-golden.test.ts package.json .github/workflows/ci.yml docs/DEPLOYMENT.md packages/shared/src/article-coverage-evidence.ts
git commit -m "test: gate coverage matcher quality"
```

## Phase 1 Completion Gate

Before starting the lifecycle plan, confirm:

```bash
git status --short
git log -7 --oneline
npm run check:coverage-matcher
```

Expected: only pre-existing untracked files remain; seven focused commits are present; the quality gate passes; v1 remains the only persisted/public matcher.
