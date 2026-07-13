import { describe, expect, it } from "vitest";
import {
  analyzeArticleCoverage,
  analyzeArticleCoverageV2,
  articleCoverageEvidence,
  evaluateArticleCoverageCorpus,
  highDetailNearDuplicatePolicy,
  isHighDetailCrossSourceNearDuplicate,
} from "../src/index.js";
import { articleCoverageGoldenCases } from "./fixtures/article-coverage-golden.js";

describe("coverage matcher golden corpus", () => {
  it("passes all critical expectations deterministically", () => {
    const result = evaluateArticleCoverageCorpus(articleCoverageGoldenCases, (articles, fixture) =>
      analyzeArticleCoverageV2(articles, "2026-07-12T21:00:00.000Z", {
        rejectedPairs: fixture.rejectedPairs ?? [],
      }),
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

  it("groups the Dora reporting in both the live legacy and v2 matchers", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "dora-boat-high-detail-near-duplicate",
    );
    expect(fixture).toBeDefined();
    const expectedMembers = ["dora-adressa", "dora-nrk", "dora-police"];

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const analysis = analyze(fixture!.articles, "2026-07-13T20:00:00.000Z");
      expect(
        analysis.bundles.map(({ memberArticleIds }) => [...memberArticleIds].sort()),
      ).toContainEqual(expectedMembers);
      expect(
        analysis.bundles.some(({ memberArticleIds }) =>
          memberArticleIds.includes("other-boat-control"),
        ),
      ).toBe(false);
    }

    const police = fixture!.articles.find(({ id }) => id === "dora-police")!;
    const newsroom = fixture!.articles.find(({ id }) => id === "dora-nrk")!;
    const unrelated = fixture!.articles.find(({ id }) => id === "other-boat-control")!;
    expect(isHighDetailCrossSourceNearDuplicate(police, newsroom)).toBe(true);
    expect(isHighDetailCrossSourceNearDuplicate(police, unrelated)).toBe(false);
    expect(
      isHighDetailCrossSourceNearDuplicate(police, {
        ...newsroom,
        source: "politiloggen",
      }),
    ).toBe(false);
    expect(
      isHighDetailCrossSourceNearDuplicate(police, {
        ...newsroom,
        publishedAt: "2026-07-13T19:35:00.000Z",
      }),
    ).toBe(false);

    const corrected = analyzeArticleCoverageV2(fixture!.articles, "2026-07-13T20:00:00.000Z", {
      rejectedPairs: [
        {
          articleIds: ["dora-police", "dora-nrk"],
          correctionId: "sanitized-dora-split",
        },
      ],
    });
    expect(
      corrected.bundles.some(
        ({ memberArticleIds }) =>
          memberArticleIds.includes("dora-police") && memberArticleIds.includes("dora-nrk"),
      ),
    ).toBe(false);
  });

  it("keeps generic cross-source boilerplate outside the high-detail policy", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "generic-boilerplate-is-not-high-detail",
    );
    expect(fixture).toBeDefined();
    const [left, right] = fixture!.articles;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    const evidence = articleCoverageEvidence(left!, right!, "v2");
    expect(evidence.sharedBodyTokenCount).toBeGreaterThanOrEqual(
      highDetailNearDuplicatePolicy.minBodyOverlap,
    );
    expect(evidence.bodyScore).toBeGreaterThanOrEqual(highDetailNearDuplicatePolicy.minBodyScore);
    expect(evidence.bodyScore).toBeLessThan(0.5);
    expect(evidence.sharedDistinctiveTokenCount).toBeLessThan(
      highDetailNearDuplicatePolicy.minDistinctiveOverlap,
    );
    expect(isHighDetailCrossSourceNearDuplicate(left!, right!)).toBe(false);

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const analysis = analyze(fixture!.articles, "2026-07-13T20:10:00.000Z");
      expect(
        analysis.bundles.some(({ memberArticleIds }) =>
          [left!.id, right!.id].every((id) => memberArticleIds.includes(id)),
        ),
      ).toBe(false);
    }
  });
});
