import { describe, expect, it } from "vitest";
import type { Article, ArticleCoverageAnalysis, ArticleCoverageGoldenCase } from "../src/index.js";
import { analyzeArticleCoverageV2 } from "../src/index.js";
import { articleCoverageGoldenCases } from "./fixtures/article-coverage-golden.js";

const generatedAt = "2026-07-12T21:00:00.000Z";

function allPermutations<T>(values: T[]): T[][] {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    allPermutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [
      value,
      ...rest,
    ]),
  );
}

function seededPermutation<T>(values: T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function practicalOrderings<T>(values: T[]): T[][] {
  if (values.length <= 5) return allPermutations(values);
  const candidates = [
    [...values],
    [...values].reverse(),
    ...Array.from({ length: 30 }, (_, index) => seededPermutation(values, 0xc0_76_13 + index)),
  ];
  const unique = new Map(candidates.map((items) => [JSON.stringify(items), items]));
  return [...unique.values()].slice(0, 32);
}

function canonicalAnalysis(analysis: ArticleCoverageAnalysis) {
  const edges = (analysis.edges ?? []).map((edge) => ({
    articleIds: edge.articleIds,
    tier: edge.tier,
    score: edge.score,
    kind: edge.kind,
    positiveIncidentEvidence: edge.positiveIncidentEvidence,
    signals: edge.signals
      .map(({ kind, detail, overlap, score }) => ({ kind, detail, overlap, score }))
      .sort((left, right) =>
        `${left.kind}\0${left.detail ?? ""}`.localeCompare(`${right.kind}\0${right.detail ?? ""}`),
      ),
    conflicts: edge.conflicts
      .map(({ kind, detail }) => ({ kind, detail }))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    evidenceFingerprint: edge.evidenceFingerprint,
    reviewable: edge.reviewable,
    correctionConflict: edge.correctionConflict,
  }));
  const bundles = analysis.bundles.map((bundle) => ({
    id: bundle.id,
    primaryArticleId: bundle.primaryArticleId,
    memberArticleIds: bundle.memberArticleIds,
    kind: bundle.kind,
    matchConfidence: bundle.matchConfidence,
  }));
  return {
    edges,
    bundles,
    counts: {
      edges: edges.length,
      acceptedEdges: edges.filter((edge) => edge.tier !== "weak" && !edge.reviewable).length,
      reviewableEdges: edges.filter((edge) => edge.reviewable).length,
      bundles: bundles.length,
      groupedArticles: new Set(bundles.flatMap((bundle) => bundle.memberArticleIds)).size,
    },
  };
}

function analyzeFixture(fixture: ArticleCoverageGoldenCase, articles: Article[]) {
  return analyzeArticleCoverageV2(articles, generatedAt, {
    rejectedPairs: fixture.rejectedPairs ?? [],
  });
}

describe("coverage matcher permutation properties", () => {
  it("keeps edges, groups, primary articles, stable IDs and counts invariant", () => {
    for (const fixture of articleCoverageGoldenCases) {
      const baselineAnalysis = analyzeFixture(fixture, fixture.articles);
      expect(
        (baselineAnalysis.edges ?? []).every((edge) =>
          Array.isArray(edge.positiveIncidentEvidence),
        ),
        `${fixture.id}: every v2 edge exposes its positive evidence`,
      ).toBe(true);
      const baseline = canonicalAnalysis(baselineAnalysis);
      const orderings = practicalOrderings(fixture.articles);
      if (fixture.articles.length > 5) {
        expect(orderings, `${fixture.id}: capped sampled matcher orderings`).toHaveLength(32);
      }

      for (const [index, ordering] of orderings.entries()) {
        expect(
          canonicalAnalysis(analyzeFixture(fixture, ordering)),
          `${fixture.id} ordering ${index}`,
        ).toEqual(baseline);
      }
    }
  });

  it("caps deterministic sampling for larger article sets", () => {
    const values = Array.from({ length: 12 }, (_, index) => index);
    const first = practicalOrderings(values);
    const second = practicalOrderings(values);
    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
  });
});
