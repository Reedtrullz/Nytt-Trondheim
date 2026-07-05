import {
  sourceIdLabel,
  sourceMixConfidenceSummary,
  derivePublicVerificationForArticleGroup,
  type Article,
  type ArticleTopic,
  type CityPulseStory,
  type SourceConfidenceSummary,
} from "@nytt/shared";
import { articleCategoryLabels, articleTopicLabels } from "./homeFilters.js";
import type { HomeArticleGroup } from "./homeArticleGroups.js";

export interface HomeStoryCard {
  id: string;
  group: HomeArticleGroup;
  primary: Article;
  title: string;
  excerpt: string;
  category: Article["category"];
  channelLabel: string;
  topicLabels: string[];
  sourceCount: number;
  updateCount: number;
  sourceSummary: string;
  clusterLabel?: string;
  locationLabel?: string;
  neighborhoodLabels: string[];
  latestAt: string;
  isClustered: boolean;
  cardKind: "situasjon" | "hendelse" | "tema" | "oppdatering" | "sak";
  sourceConfidence: SourceConfidenceSummary;
  verification?: HomeStoryVerification;
}

export interface HomeStoryVerification {
  label: string;
  detail: string;
  sourceSummary: string;
  situationId?: string;
}

const genericPlaces = new Set(["norge", "trondheim", "trondelag", "trøndelag"]);
const multiplePlacesLabel = "Flere steder";

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
  const places = specific.length > 0 ? specific : labels;
  const hasPreciseLocation = group.articles.some((article) => article.location);
  const singleUnlocatedStory = group.articles.length === 1 && !hasPreciseLocation;
  if (singleUnlocatedStory && places.length > 1) return [multiplePlacesLabel];
  return places;
}

function storyTopicLabels(group: HomeArticleGroup): string[] {
  const topics = new Set<ArticleTopic>();
  for (const article of group.articles) {
    for (const topic of article.topics ?? []) topics.add(topic);
  }
  return [...topics].map((topic) => articleTopicLabels[topic]);
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

function derivedGroupVerification(group: HomeArticleGroup): HomeStoryVerification | undefined {
  const verification = derivePublicVerificationForArticleGroup(group);
  if (!verification) return undefined;
  return {
    label: verification.label,
    detail: verification.detail,
    sourceSummary: [
      ...verification.officialSources.map((source) => sourceIdLabel(source)),
      ...verification.reportingSources.map((source) => sourceIdLabel(source)),
    ].join(" + "),
    ...(verification.situationId ? { situationId: verification.situationId } : {}),
  };
}

function storyVerification(group: HomeArticleGroup): HomeStoryVerification | undefined {
  const verification =
    group.primary.publicVerification ??
    group.articles.find((article) => article.publicVerification)?.publicVerification;
  if (!verification) return derivedGroupVerification(group);
  return {
    label: verification.label,
    detail: verification.detail,
    sourceSummary: [
      ...verification.officialSources.map((source) => sourceIdLabel(source)),
      ...verification.reportingSources.map((source) => sourceIdLabel(source)),
    ].join(" + "),
    situationId: verification.situationId,
  };
}

function storySourceConfidence(group: HomeArticleGroup): SourceConfidenceSummary {
  const sources = new Set<string>();
  for (const article of group.articles) {
    sources.add(article.source);
    const verification = article.publicVerification;
    if (!verification) continue;
    for (const source of verification.officialSources) sources.add(source);
    for (const source of verification.reportingSources) sources.add(source);
  }
  return sourceMixConfidenceSummary([...sources], { updatedAt: group.primary.publishedAt });
}

function articleWithStoryMetadata(article: Article, story: CityPulseStory): Article {
  return {
    ...article,
    ...(story.coverageBundle && !article.coverageBundle
      ? { coverageBundle: story.coverageBundle }
      : {}),
    ...(story.publicVerification && !article.publicVerification
      ? { publicVerification: story.publicVerification }
      : {}),
  };
}

export function homeArticleGroupForStory(story: CityPulseStory): HomeArticleGroup {
  const storyArticles = story.articles.length > 0 ? story.articles : [story.primary];
  const articles = storyArticles.map((article) => articleWithStoryMetadata(article, story));
  const fallbackPrimary = articleWithStoryMetadata(story.primary, story);
  const primary =
    articles.find((article) => article.id === story.primaryArticleId) ?? fallbackPrimary;
  return {
    id: story.id,
    primary,
    articles,
    sourceLabels: story.sourceLabels,
    bundle: story.coverageBundle ?? primary.coverageBundle,
  };
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
    topicLabels: storyTopicLabels(group),
    sourceCount: group.sourceLabels.length,
    updateCount: group.articles.length,
    sourceSummary: sourceSummary(group),
    clusterLabel: sourceClusterLabelForGroup(group),
    locationLabel: places[0],
    neighborhoodLabels: places.slice(0, 3),
    latestAt: group.primary.publishedAt,
    isClustered: group.articles.length > 1,
    cardKind: cardKindFor(group),
    sourceConfidence: storySourceConfidence(group),
    verification: storyVerification(group),
  };
}

export function homeStoryCardForStory(story: CityPulseStory): HomeStoryCard {
  const card = homeStoryCardForGroup(homeArticleGroupForStory(story));
  return {
    ...card,
    category: story.category,
    channelLabel: articleCategoryLabels[story.category],
    sourceCount: story.sourceCount,
    updateCount: story.updateCount,
    latestAt: story.latestAt,
    isClustered: story.updateCount > 1,
  };
}

export function homeStoryCardsForGroups(groups: HomeArticleGroup[]): HomeStoryCard[] {
  return groups.map(homeStoryCardForGroup);
}

export function homeStoryCardsForStories(stories: CityPulseStory[]): HomeStoryCard[] {
  return stories.map(homeStoryCardForStory);
}
