import { describe, expect, it } from "vitest";
import type { Article } from "@nytt/shared";
import { validateCitations } from "../src/ai.js";

const articles: Article[] = [
  {
    id: "one",
    source: "nrk",
    sourceLabel: "NRK",
    title: "Brann",
    excerpt: "Røyk er observert i Bymarka.",
    url: "https://example.test/one",
    publishedAt: "2026-05-26T10:00:00Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Bymarka"],
  },
  {
    id: "two",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Brann",
    excerpt: "Brannvesenet er varslet om røyk.",
    url: "https://example.test/two",
    publishedAt: "2026-05-26T10:10:00Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Bymarka"],
  },
];

describe("AI citation validation", () => {
  it("retains only two-source clusters supported by literal public excerpts", () => {
    const result = validateCitations(
      {
        clusters: [
          {
            title: "Brann i Bymarka",
            summary: "To kilder omtaler røyk.",
            type: "fire",
            articleIds: ["one", "two"],
            namedPlaces: ["Bymarka"],
            citedClaims: [
              { claim: "Røyk observert", articleId: "one", supportingSnippet: "Røyk er observert" },
              { claim: "Varslet", articleId: "two", supportingSnippet: "Brannvesenet er varslet" },
            ],
          },
        ],
      },
      articles,
    );
    expect(result.clusters).toHaveLength(1);
  });

  it("drops unsupported inferred citations", () => {
    const result = validateCitations(
      {
        clusters: [
          {
            title: "Brann",
            summary: "Påstand",
            type: "fire",
            articleIds: ["one", "two"],
            namedPlaces: ["Bymarka"],
            citedClaims: [
              {
                claim: "Presis perimeter",
                articleId: "one",
                supportingSnippet: "Brannen dekker 30 mål",
              },
              { claim: "Varslet", articleId: "two", supportingSnippet: "Brannvesenet er varslet" },
            ],
          },
        ],
      },
      articles,
    );
    expect(result.clusters).toEqual([]);
  });
});
