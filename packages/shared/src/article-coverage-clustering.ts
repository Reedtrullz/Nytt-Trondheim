import type { HomeArticleGroup } from "./article-bundles.js";
import type { ArticleCoverageEdge } from "./article-coverage-evidence.js";
import type { Article } from "./types.js";

export interface CoverageRejectedPair {
  articleIds: [string, string];
  correctionId: string;
}

export interface CoverageClusteringOptions {
  rejectedPairs: CoverageRejectedPair[];
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function articleOrder(left: Article, right: Article): number {
  return right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id);
}

function stableGroupId(articles: Article[]): string {
  const oldest = [...articles].sort(
    (left, right) =>
      left.publishedAt.localeCompare(right.publishedAt) || left.id.localeCompare(right.id),
  )[0]!;
  let hash = 2166136261;
  for (const char of oldest.id) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `coverage:v2:${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

export function clusterArticlesByCoverageEdges(
  articles: Article[],
  edges: ArticleCoverageEdge[],
  options: CoverageClusteringOptions,
): HomeArticleGroup[] {
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const rejected = new Set(options.rejectedPairs.map((pair) => pairKey(...pair.articleIds)));
  const blocked = new Set(
    edges.filter((edge) => edge.conflicts.length > 0).map((edge) => pairKey(...edge.articleIds)),
  );
  const acceptedEdges = edges
    .filter(
      (edge) =>
        edge.tier !== "weak" &&
        edge.conflicts.length === 0 &&
        !rejected.has(pairKey(...edge.articleIds)),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        pairKey(...left.articleIds).localeCompare(pairKey(...right.articleIds)),
    );
  const groups: string[][] = [];

  for (const edge of acceptedEdges.filter((item) => item.tier === "strong")) {
    const matching = groups.filter((group) => edge.articleIds.some((id) => group.includes(id)));
    const candidate = [...new Set([...edge.articleIds, ...matching.flat()])];
    const containsBlockedPair = candidate.some((left, index) =>
      candidate
        .slice(index + 1)
        .some((right) => rejected.has(pairKey(left, right)) || blocked.has(pairKey(left, right))),
    );
    if (containsBlockedPair) continue;
    for (const group of matching) groups.splice(groups.indexOf(group), 1);
    groups.push(candidate);
  }

  for (const article of [...articles].sort(articleOrder)) {
    if (groups.some((group) => group.includes(article.id))) continue;
    const candidates = groups.filter((group) => {
      const sortedMembers = group.map((id) => articlesById.get(id)!).sort(articleOrder);
      const anchor = sortedMembers[0]!;
      const connecting = acceptedEdges.filter(
        (edge) =>
          edge.articleIds.includes(article.id) && edge.articleIds.some((id) => group.includes(id)),
      );
      const anchorMatch = connecting.some((edge) => edge.articleIds.includes(anchor.id));
      return anchorMatch || connecting.length >= 2;
    });
    if (candidates.length === 1) {
      const candidate = [...candidates[0]!, article.id];
      const conflict = candidate.some((left, index) =>
        candidate
          .slice(index + 1)
          .some((right) => rejected.has(pairKey(left, right)) || blocked.has(pairKey(left, right))),
      );
      if (!conflict) candidates[0]!.push(article.id);
    } else {
      groups.push([article.id]);
    }
  }

  return groups
    .map((ids) => ids.map((id) => articlesById.get(id)!).sort(articleOrder))
    .map((members) => ({
      id: stableGroupId(members),
      primary: members[0]!,
      articles: members,
      sourceLabels: [...new Set(members.map((item) => item.sourceLabel))],
      acceptedEdges: acceptedEdges.filter((edge) =>
        edge.articleIds.every((id) => members.some((item) => item.id === id)),
      ),
    }))
    .sort((left, right) => articleOrder(left.primary, right.primary));
}
