import type { Article, HomeArticleGroup } from "@nytt/shared";
import { homeStoryCardForGroup, type HomeStoryCard } from "../homeStoryCards.js";

export function clusteredHomeStoryCard({
  articleCount,
  sourceCount,
}: {
  articleCount: number;
  sourceCount: number;
}): HomeStoryCard {
  const sources = ["nrk", "adressa", "nidaros", "t_a", "vg"] as const;
  const articles: Article[] = Array.from({ length: articleCount }, (_, index) => ({
    id: `cluster-article-${index + 1}`,
    source: sources[index % Math.min(sourceCount, sources.length)]!,
    sourceLabel: `Kilde ${(index % Math.max(1, sourceCount)) + 1}`,
    title: index === 0 ? "Stor gruppesak" : `Støttesak ${index}`,
    excerpt: "Sanitert testinnhold.",
    url: `https://example.test/cluster-${index + 1}`,
    publishedAt: new Date(Date.parse("2026-07-12T21:00:00.000Z") - index * 60_000).toISOString(),
    scope: "trondheim",
    category: "Sport",
    places: ["Lerkendal", "Trondheim"],
  }));
  const primary = articles[0]!;
  const group: HomeArticleGroup = {
    id: "coverage:v2:test-group",
    primary,
    articles,
    sourceLabels: [...new Set(articles.map((article) => article.sourceLabel))],
    bundle: {
      id: "coverage:v2:test-group",
      kind: "topic",
      confidence: "medium",
      reason: "Samme nyhetstema",
      generatedAt: "2026-07-12T21:00:00.000Z",
      matcherVersion: "v2",
      matchConfidence: {
        tier: "moderate",
        score: 0.76,
        rationale: "Felles tema og kamp",
      },
    },
    acceptedEdges: [],
  };
  return homeStoryCardForGroup(group);
}
