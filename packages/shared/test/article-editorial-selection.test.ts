import { describe, expect, it } from "vitest";
import { cityPulseEditorialSelection, selectEditorialArticle } from "../src/index.js";
import { articleEditorialSelectionGoldenCases } from "./fixtures/article-editorial-selection.js";

describe("article editorial selection golden corpus", () => {
  for (const fixture of articleEditorialSelectionGoldenCases) {
    it(`${fixture.id}: ${fixture.label}`, () => {
      for (const articles of [fixture.articles, [...fixture.articles].reverse()]) {
        expect(selectEditorialArticle(articles).id).toBe(fixture.expectedArticleId);
        expect(cityPulseEditorialSelection(articles)).toEqual({
          articleId: fixture.expectedArticleId,
          strategy: "best-source-v1",
          rationale: fixture.expectedRationale,
        });
      }
    });
  }
});
