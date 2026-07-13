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
