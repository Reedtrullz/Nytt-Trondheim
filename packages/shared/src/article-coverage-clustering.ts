import type { HomeArticleGroup } from "./article-bundles.js";
import {
  isTrafficCollisionArticle,
  trafficCollisionEvidenceConflicts,
  type ArticleCoverageEdge,
} from "./article-coverage-evidence.js";
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
  const edgeByPair = new Map(edges.map((edge) => [pairKey(...edge.articleIds), edge]));
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

  const containsBlockingPair = (candidate: string[]): boolean => {
    const candidateSet = new Set(candidate);
    const hasExactTrafficBridge = acceptedEdges.some(
      (edge) =>
        edge.signals.some(
          (signal) => signal.detail === "traffic_collision:road_clock_participants",
        ) && edge.articleIds.every((id) => candidateSet.has(id)),
    );
    const allTrafficCollisions = candidate.every((id) =>
      isTrafficCollisionArticle(articlesById.get(id)!),
    );
    return candidate.some((left, index) =>
      candidate.slice(index + 1).some((right) => {
        const key = pairKey(left, right);
        if (rejected.has(key)) return true;
        const edge = edgeByPair.get(key);
        if (!edge || edge.conflicts.length === 0) return false;
        if (
          hasExactTrafficBridge &&
          allTrafficCollisions &&
          edge.conflicts.every(({ kind }) => kind === "specific_place") &&
          !trafficCollisionEvidenceConflicts(articlesById.get(left)!, articlesById.get(right)!)
        ) {
          return false;
        }
        return true;
      }),
    );
  };

  for (const edge of acceptedEdges.filter((item) => item.tier === "strong")) {
    const matching = groups.filter((group) => edge.articleIds.some((id) => group.includes(id)));
    const candidate = [...new Set([...edge.articleIds, ...matching.flat()])];
    if (containsBlockingPair(candidate)) continue;
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
      if (!containsBlockingPair(candidate)) candidates[0]!.push(article.id);
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
