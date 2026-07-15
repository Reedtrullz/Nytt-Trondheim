import { describe, expect, it } from "vitest";
import {
  analyzeArticleCoverageV2,
  coverageBundleSplitRequestSchema,
  coverageCorrectionExportQuerySchema,
  recomputeCoverageStories,
} from "../src/index.js";
import { correctionFixtureArticles } from "./fixtures/article-coverage-corrections.js";

describe("coverage corrections", () => {
  it("deduplicates rejected ids and rejects anchor overlap or extra fields", () => {
    expect(
      coverageBundleSplitRequestSchema.parse({
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat", "speed-b", "threat"],
      }).rejectedArticleIds,
    ).toEqual(["speed-b", "threat"]);
    expect(() =>
      coverageBundleSplitRequestSchema.parse({
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["speed-a"],
      }),
    ).toThrow();
    expect(() =>
      coverageBundleSplitRequestSchema.parse({
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
        unexpected: true,
      }),
    ).toThrow();
    expect(coverageCorrectionExportQuerySchema.parse({ sinceDays: "30" })).toEqual({
      sinceDays: 30,
    });
  });

  it("accepts a stable correction target and projection revision for derived cards", () => {
    expect(
      coverageBundleSplitRequestSchema.parse({
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        expectedProjectionRevision: 7,
        originalBundleId: "coverage:v2:stable",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
      }),
    ).toMatchObject({
      expectedProjectionRevision: 7,
      originalBundleId: "coverage:v2:stable",
    });
    expect(() =>
      coverageBundleSplitRequestSchema.parse({
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        expectedProjectionRevision: -1,
        originalBundleId: "coverage:v2:stable",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
      }),
    ).toThrow();
  });

  it("accepts only bounded correction reason categories", () => {
    expect(
      coverageBundleSplitRequestSchema.parse({
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
        reasonCategory: "different_place",
        reason: "  To ulike steder  ",
      }),
    ).toMatchObject({ reasonCategory: "different_place", reason: "To ulike steder" });
    expect(() =>
      coverageBundleSplitRequestSchema.parse({
        expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
        anchorArticleId: "speed-a",
        rejectedArticleIds: ["threat"],
        reasonCategory: "private_guess",
      }),
    ).toThrow();
  });

  it("splits an exact rejected pair and retains it as a correction conflict", () => {
    const analysis = analyzeArticleCoverageV2(
      correctionFixtureArticles(),
      "2026-07-12T21:00:00.000Z",
      {
        rejectedPairs: [{ articleIds: ["speed-a", "threat"], correctionId: "correction-1" }],
      },
    );
    expect(
      analysis.bundles.some(
        ({ memberArticleIds }) =>
          memberArticleIds.includes("threat") && memberArticleIds.includes("speed-a"),
      ),
    ).toBe(false);
    expect(
      analysis.edges?.find(
        (edge) => edge.articleIds.includes("speed-a") && edge.articleIds.includes("threat"),
      ),
    ).toMatchObject({ reviewable: true, correctionConflict: true });
  });

  it("regroups after the rejection is removed", () => {
    const analysis = analyzeArticleCoverageV2(
      correctionFixtureArticles(),
      "2026-07-12T21:00:00.000Z",
      { rejectedPairs: [] },
    );
    expect(
      analysis.bundles.some(
        (bundle) =>
          bundle.memberArticleIds.includes("speed-a") && bundle.memberArticleIds.includes("threat"),
      ),
    ).toBe(true);
  });

  it("recomputes replacement stories without database state", () => {
    const stories = recomputeCoverageStories(
      correctionFixtureArticles(),
      [{ articleIds: ["speed-a", "threat"], correctionId: "correction-1" }],
      "2026-07-12T21:00:00.000Z",
    );
    expect(stories.flatMap(({ articleIds }) => articleIds)).toEqual(
      expect.arrayContaining(["speed-a", "speed-b", "threat"]),
    );
    expect(
      stories.some(
        ({ articleIds }) => articleIds.includes("speed-a") && articleIds.includes("threat"),
      ),
    ).toBe(false);
  });
});
