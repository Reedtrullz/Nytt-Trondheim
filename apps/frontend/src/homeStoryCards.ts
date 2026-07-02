import type { Article } from "@nytt/shared";
import { articleCategoryLabels } from "./homeFilters.js";
import type { HomeArticleGroup } from "./homeArticleGroups.js";

export interface HomeStoryCard {
  id: string;
  group: HomeArticleGroup;
  primary: Article;
  title: string;
  excerpt: string;
  category: Article["category"];
  channelLabel: string;
  sourceCount: number;
  updateCount: number;
  sourceSummary: string;
  clusterLabel?: string;
  locationLabel?: string;
  neighborhoodLabels: string[];
  latestAt: string;
  isClustered: boolean;
  cardKind: "situasjon" | "hendelse" | "tema" | "oppdatering" | "sak";
}

const genericPlaces = new Set(["norge", "trondheim", "trondelag", "trøndelag"]);

function normalizePlace(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("nb")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function uniqueLabels(labels: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  return labels.flatMap((label) => {
    const trimmed = label?.trim();
    if (!trimmed) return [];
    const key = normalizePlace(trimmed);
    if (seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

function storyPlaces(group: HomeArticleGroup): string[] {
  const labels = uniqueLabels(
    group.articles.flatMap((article) => [article.location?.label, ...article.places]),
  );
  const specific = labels.filter((label) => !genericPlaces.has(normalizePlace(label)));
  return specific.length > 0 ? specific : labels;
}

export function sourceClusterLabelForGroup(group: HomeArticleGroup): string | undefined {
  if (group.articles.length < 2) return undefined;
  if (group.bundle?.reason) {
    return group.sourceLabels.length > 1
      ? `${group.sourceLabels.length} kilder · ${group.bundle.reason.toLocaleLowerCase("nb")}`
      : `${group.articles.length} oppdateringer · ${group.bundle.reason.toLocaleLowerCase("nb")}`;
  }
  if (group.sourceLabels.length > 1) return `${group.sourceLabels.length} kilder dekker samme sak`;
  return `${group.articles.length} oppdateringer samlet`;
}

function sourceSummary(group: HomeArticleGroup): string {
  if (group.sourceLabels.length > 1) return `${group.sourceLabels.length} kilder`;
  if (group.articles.length > 1) return `${group.articles.length} oppdateringer`;
  return group.primary.sourceLabel;
}

function cardKindFor(group: HomeArticleGroup): HomeStoryCard["cardKind"] {
  if (group.articles.some((article) => article.situationId)) return "situasjon";
  if (group.bundle?.kind === "topic") return "tema";
  if (group.bundle?.kind === "update") return "oppdatering";
  if (group.bundle?.kind === "incident") return "hendelse";
  if (group.articles.length > 1) return "oppdatering";
  return "sak";
}

export function homeStoryCardForGroup(group: HomeArticleGroup): HomeStoryCard {
  const places = storyPlaces(group);
  return {
    id: group.id,
    group,
    primary: group.primary,
    title: group.primary.title,
    excerpt: group.primary.excerpt,
    category: group.primary.category,
    channelLabel: articleCategoryLabels[group.primary.category],
    sourceCount: group.sourceLabels.length,
    updateCount: group.articles.length,
    sourceSummary: sourceSummary(group),
    clusterLabel: sourceClusterLabelForGroup(group),
    locationLabel: places[0],
    neighborhoodLabels: places.slice(0, 3),
    latestAt: group.primary.publishedAt,
    isClustered: group.articles.length > 1,
    cardKind: cardKindFor(group),
  };
}

export function homeStoryCardsForGroups(groups: HomeArticleGroup[]): HomeStoryCard[] {
  return groups.map(homeStoryCardForGroup);
}
