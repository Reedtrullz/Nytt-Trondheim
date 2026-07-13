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
