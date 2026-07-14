import { describe, expect, it } from "vitest";
import {
  analyzeArticleCoverage,
  analyzeArticleCoverageV2,
  articleCoverageEvidence,
  entityBackedNotificationFollowUpPolicy,
  evaluateArticleCoverageCorpus,
  fatalTrafficFollowUpPolicy,
  highDetailNearDuplicatePolicy,
  isFatalTrafficIncidentFollowUp,
  isEntityBackedNotificationFailureFollowUp,
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

  it("groups a fatal traffic follow-up despite victim-home and crash-place angles", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "fatal-traffic-follow-up-across-place-angles",
    );
    expect(fixture).toBeDefined();
    const expectedMembers = ["grong-follow-up", "grong-primary"];

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const analysis = analyze(fixture!.articles, "2026-07-13T12:30:00.000Z");
      expect(
        analysis.bundles.map(({ memberArticleIds }) => [...memberArticleIds].sort()),
      ).toContainEqual(expectedMembers);
      expect(
        analysis.bundles.some(({ memberArticleIds }) =>
          memberArticleIds.includes("other-e6-fatality"),
        ),
      ).toBe(false);
    }

    const primary = fixture!.articles.find(({ id }) => id === "grong-primary")!;
    const followUp = fixture!.articles.find(({ id }) => id === "grong-follow-up")!;
    const unrelated = fixture!.articles.find(({ id }) => id === "other-e6-fatality")!;
    expect(isFatalTrafficIncidentFollowUp(primary, followUp)).toBe(true);
    expect(isFatalTrafficIncidentFollowUp(primary, unrelated)).toBe(false);
    expect(
      isFatalTrafficIncidentFollowUp(primary, {
        ...followUp,
        source: "t_a",
      }),
    ).toBe(false);
    expect(
      isFatalTrafficIncidentFollowUp(primary, {
        ...followUp,
        publishedAt: new Date(
          Date.parse(primary.publishedAt) + fatalTrafficFollowUpPolicy.windowMs + 1,
        ).toISOString(),
      }),
    ).toBe(false);
  });

  it("groups the current sparse production reports in both legacy and v2", () => {
    const expectations = new Map([
      [
        "road-animal-hazard-across-sparse-headlines",
        [
          "elk-police",
          "elk-nidaros",
          "elk-adressa-brief",
          "elk-adressa-feature",
          "elk-tronderbladet",
          "elk-nrk",
        ],
      ],
      ["vehicle-damage-with-axe-across-sparse-reports", ["axe-adressa", "axe-nidaros", "axe-nrk"]],
      ["impaired-driving-through-complementary-details", ["dui-adressa", "dui-nrk", "dui-nidaros"]],
    ]);

    for (const [fixtureId, expectedMembers] of expectations) {
      const fixture = articleCoverageGoldenCases.find(({ id }) => id === fixtureId);
      expect(fixture).toBeDefined();
      for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
        const groups = analyze(fixture!.articles, "2026-07-14T11:00:00.000Z").bundles.map(
          ({ memberArticleIds }) => [...memberArticleIds].sort(),
        );
        expect(groups).toContainEqual([...expectedMembers].sort());
      }
    }
  });

  it("groups a delayed regulatory follow-up without grouping unrelated company news", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "delayed-regulatory-follow-up-with-dotted-organization",
    );
    expect(fixture).toBeDefined();

    const regulatoryPair = fixture!.articles.filter(({ id }) => id !== "dahls-product-news");
    const evidence = articleCoverageEvidence(regulatoryPair[0]!, regulatoryPair[1]!, "v2");
    expect(evidence.positiveIncidentEvidence).toContain("shared_named_entity");
    expect(isEntityBackedNotificationFailureFollowUp(regulatoryPair[0]!, regulatoryPair[1]!)).toBe(
      true,
    );
    expect(
      isEntityBackedNotificationFailureFollowUp(regulatoryPair[0]!, {
        ...regulatoryPair[1]!,
        source: regulatoryPair[0]!.source,
      }),
    ).toBe(false);
    expect(
      isEntityBackedNotificationFailureFollowUp(regulatoryPair[0]!, {
        ...regulatoryPair[1]!,
        publishedAt: new Date(
          Date.parse(regulatoryPair[0]!.publishedAt) +
            entityBackedNotificationFollowUpPolicy.windowMs +
            1,
        ).toISOString(),
      }),
    ).toBe(false);

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const groups = analyze(fixture!.articles, "2026-07-14T11:00:00.000Z").bundles.map(
        ({ memberArticleIds }) => [...memberArticleIds].sort(),
      );
      expect(groups).toContainEqual(["dahls-adressa", "dahls-nidaros"]);
      expect(groups.some((ids) => ids.includes("dahls-product-news"))).toBe(false);
    }
  });
});
