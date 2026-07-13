import { describe, expect, it } from "vitest";
import type { Article, ArticleCoverageEdge } from "../src/index.js";
import { analyzeArticleCoverageV2, clusterArticlesByCoverageEdges } from "../src/index.js";

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

function edge(
  left: string,
  right: string,
  tier: "strong" | "moderate" | "weak",
  score: number,
): ArticleCoverageEdge {
  return {
    articleIds: [left, right].sort() as [string, string],
    tier,
    score,
    kind: "incident",
    positiveIncidentEvidence: [],
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
      [
        edge("a", "b", "strong", 0.9),
        edge("c", "bridge", "strong", 0.9),
        edge("b", "bridge", "moderate", 0.65),
      ],
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
      [
        edge("a", "b", "strong", 0.9),
        edge("a", "c", "moderate", 0.64),
        edge("b", "c", "moderate", 0.62),
      ],
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
    expect(
      groups.every(
        (group) =>
          !(
            group.articles.some((item) => item.id === "a") &&
            group.articles.some((item) => item.id === "c")
          ),
      ),
    ).toBe(true);
  });

  it("is invariant to input order", () => {
    const edges = [
      edge("a", "b", "strong", 0.9),
      edge("a", "c", "moderate", 0.7),
      edge("b", "c", "moderate", 0.68),
    ];
    const forward = clusterArticlesByCoverageEdges(articles.slice(0, 3), edges, {
      rejectedPairs: [],
    });
    const reverse = clusterArticlesByCoverageEdges(
      [...articles.slice(0, 3)].reverse(),
      [...edges].reverse(),
      { rejectedPairs: [] },
    );
    expect(forward.map((group) => group.id)).toEqual(reverse.map((group) => group.id));
    expect(forward.map((group) => group.articles.map((item) => item.id))).toEqual(
      reverse.map((group) => group.articles.map((item) => item.id)),
    );
  });

  it("builds v2 bundle metadata from accepted edges", () => {
    const analysis = analyzeArticleCoverageV2(
      [
        {
          ...article("official", "2026-07-12T20:03:00.000Z"),
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          situationId: "incident-1",
          places: ["Lade"],
        },
        {
          ...article("news", "2026-07-12T20:02:00.000Z"),
          source: "adressa",
          sourceLabel: "Adresseavisen",
          situationId: "incident-1",
          places: ["Lade"],
        },
      ],
      "2026-07-12T21:00:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      matcherVersion: "v2",
      matchConfidence: { tier: "strong" },
      memberArticleIds: ["official", "news"],
    });
    expect(analysis.edges).toHaveLength(1);
    expect(analysis.articles.every((item) => item.coverageBundle?.matcherVersion === "v2")).toBe(
      true,
    );
  });

  it("bounds ordinary reviewable edges to five per article", () => {
    const hub = {
      ...article("hub", "2026-07-12T20:30:00.000Z"),
      title: "Politiet har kontroll",
      excerpt: "Ungdom var involvert",
      places: ["Trøndelag"],
    };
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      ...article(`candidate-${index}`, `2026-07-12T20:${String(index).padStart(2, "0")}:00.000Z`),
      title: "Politiet fikk kontroll",
      excerpt: `Ungdom tok kontakt nummer ${index}`,
      places: ["Trøndelag"],
    }));

    const analysis = analyzeArticleCoverageV2([hub, ...candidates]);
    const touchingHub = (analysis.edges ?? []).filter(
      (item) => item.reviewable && item.articleIds.includes("hub"),
    );
    expect(touchingHub.length).toBeLessThanOrEqual(5);
  });
});
