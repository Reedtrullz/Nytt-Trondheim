import { describe, expect, it } from "vitest";
import { coverageProjectionParity } from "../src/article-bundles.js";
import { coverageBundleQuerySchema } from "../src/schemas.js";

describe("coverage projection parity", () => {
  it("defaults an omitted projection to shadow and parses corrected=false without truthiness coercion", () => {
    expect(coverageBundleQuerySchema.parse({ corrected: "false" })).toEqual({
      projection: "shadow",
      corrected: false,
      limit: 30,
    });
  });

  it("parses canonical review filters and explicit generation history selection", () => {
    expect(
      coverageBundleQuerySchema.parse({
        review:
          "reviewable,weak,missing_place,missing_entity,missing_official,correction_conflict,generation_change",
        generationId: "11111111-1111-4111-8111-111111111111",
        historyCursor: "cursor",
      }),
    ).toMatchObject({
      review: [
        "reviewable",
        "weak",
        "missing_place",
        "missing_entity",
        "missing_official",
        "correction_conflict",
        "generation_change",
      ],
      generationId: "11111111-1111-4111-8111-111111111111",
      historyCursor: "cursor",
    });
  });
  it("compares canonical member sets independently of order and bundle id", () => {
    expect(
      coverageProjectionParity(
        [{ id: "legacy", primaryArticleId: "a", memberArticleIds: ["b", "a"] }],
        [{ id: "normalized", primaryArticleId: "a", memberArticleIds: ["a", "b"] }],
      ),
    ).toEqual({
      legacyBundleCount: 1,
      normalizedBundleCount: 1,
      membershipMismatchCount: 0,
      primaryMismatchCount: 0,
      clean: true,
    });
  });

  it("counts unmatched membership and primary projections", () => {
    expect(
      coverageProjectionParity(
        [{ id: "legacy", primaryArticleId: "a", memberArticleIds: ["a", "b"] }],
        [{ id: "normalized", primaryArticleId: "c", memberArticleIds: ["a", "c"] }],
      ),
    ).toMatchObject({
      membershipMismatchCount: 2,
      primaryMismatchCount: 0,
      clean: false,
    });
  });

  it("detects duplicate groups with the same canonical membership", () => {
    expect(
      coverageProjectionParity(
        [{ id: "legacy", primaryArticleId: "a", memberArticleIds: ["a", "b"] }],
        [
          { id: "normalized-a", primaryArticleId: "a", memberArticleIds: ["a", "b"] },
          { id: "normalized-b", primaryArticleId: "a", memberArticleIds: ["b", "a"] },
        ],
      ),
    ).toMatchObject({ membershipMismatchCount: 1, clean: false });
  });
});
