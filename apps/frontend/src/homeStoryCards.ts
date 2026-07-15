import {
  sourceIdLabel,
  sourceMixConfidenceSummary,
  cityPulseEditorialCopy,
  derivePublicVerificationForArticleGroup,
  type Article,
  type ArticleTopic,
  type CityPulseEditorialCopy,
  type CityPulseStory,
  type CoverageMatchConfidence,
  type SourceConfidenceSummary,
} from "@nytt/shared";
import { articleCategoryLabels, articleTopicLabels } from "./homeFilters.js";
import type { HomeArticleGroup } from "./homeArticleGroups.js";

export interface HomeStoryCard {
  id: string;
  group: HomeArticleGroup;
  primary: Article;
  coverageAnchor: Article;
  title: string;
  excerpt: string;
  category: Article["category"];
  channelLabel: string;
  topicLabels: string[];
  articleCount: number;
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
  matchConfidence?: CoverageMatchConfidence;
  matchRationale?: string;
  verification?: HomeStoryVerification;
  editorialCopy: CityPulseEditorialCopy;
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
  const updatedAt = group.articles.reduce(
    (latest, article) => (article.publishedAt > latest ? article.publishedAt : latest),
    group.articles[0]?.publishedAt ?? group.primary.publishedAt,
  );
  return sourceMixConfidenceSummary([...sources], { updatedAt });
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
  const editorialCopy = cityPulseEditorialCopy(group.articles);
  const editorialArticle = group.articles.find(({ id }) => id === editorialCopy.title.articleId)!;
  const places = storyPlaces(group);
  const latestAt = group.articles.reduce(
    (latest, article) => (article.publishedAt > latest ? article.publishedAt : latest),
    group.articles[0]?.publishedAt ?? editorialArticle.publishedAt,
  );
  return {
    id: group.id,
    group,
    primary: editorialArticle,
    coverageAnchor: group.primary,
    title: editorialCopy.title.text,
    excerpt: editorialCopy.ingress?.text ?? "",
    category: editorialArticle.category,
    channelLabel: articleCategoryLabels[editorialArticle.category],
    topicLabels: storyTopicLabels(group),
    articleCount: group.articles.length,
    sourceCount: new Set(group.articles.map((article) => article.source)).size,
    updateCount: group.articles.length,
    sourceSummary: sourceSummary(group),
    clusterLabel: sourceClusterLabelForGroup(group),
    locationLabel: places[0],
    neighborhoodLabels: places.slice(0, 3),
    latestAt,
    isClustered: group.articles.length > 1,
    cardKind: cardKindFor(group),
    sourceConfidence: storySourceConfidence(group),
    matchConfidence: group.bundle?.matchConfidence,
    matchRationale: group.bundle?.matchConfidence?.rationale,
    verification: storyVerification(group),
    editorialCopy,
  };
}

export function coverageMatchExplanation(card: HomeStoryCard): string {
  const signals = card.group.acceptedEdges?.flatMap((edge) => edge.signals) ?? [];
  if (card.cardKind === "tema") return "Felles tema og kamp";
  if (signals.some((signal) => signal.kind === "situation_id")) {
    return "Samme offisielle hendelse";
  }
  if (
    signals.some(
      (signal) => signal.kind === "shared_place" || signal.kind === "generic_place_incident",
    )
  ) {
    return "Felles sted og hendelsestype";
  }
  if (signals.some((signal) => signal.kind === "near_duplicate")) {
    return "Samme publiserte sak";
  }
  return card.matchRationale ?? "Sammenfallende dekning";
}

export function homeStoryCardForStory(story: CityPulseStory): HomeStoryCard {
  const card = homeStoryCardForGroup(homeArticleGroupForStory(story));
  return {
    ...card,
    category: story.category,
    channelLabel: articleCategoryLabels[story.category],
    articleCount: story.articleIds.length,
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
