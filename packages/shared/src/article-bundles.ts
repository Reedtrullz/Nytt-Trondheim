import type {
  Article,
  ArticleCoverageBundle,
  ArticleCoverageBundleConfidence,
  ArticleCoverageBundleKind,
} from "./types.js";
import { isFootballClubBrannContext } from "./incident-text.js";

export interface HomeArticleGroup {
  id: string;
  primary: Article;
  articles: Article[];
  sourceLabels: string[];
  bundle?: ArticleCoverageBundle;
}

const maxGroupAgeMs = 24 * 60 * 60 * 1000;
const crossSourceIncidentWindowMs = 8 * 60 * 60 * 1000;
const nearDuplicateTextWindowMs = 2 * 60 * 60 * 1000;
const topicalThreadWindowMs = 12 * 60 * 60 * 1000;
const genericPlaceIncidentSignalRules = new Map<
  string,
  { windowMs: number; minBodyOverlap: number; minDistinctiveOverlap: number }
>([
  ["slagsmal", { windowMs: 60 * 60 * 1000, minBodyOverlap: 1, minDistinctiveOverlap: 1 }],
  [
    "water_rescue",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 2, minDistinctiveOverlap: 1 },
  ],
  ["brann", { windowMs: nearDuplicateTextWindowMs, minBodyOverlap: 3, minDistinctiveOverlap: 1 }],
  [
    "innbrudd",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 3, minDistinctiveOverlap: 2 },
  ],
  ["tyveri", { windowMs: nearDuplicateTextWindowMs, minBodyOverlap: 4, minDistinctiveOverlap: 2 }],
]);
const genericPlaceTokens = new Set(["trondheim", "trøndelag", "trondelag"]);
const genericIncidentTokens = new Set([
  ...genericPlaceTokens,
  "badeulykke",
  "brann",
  "innbrudd",
  "innbruddsforsøk",
  "melding",
  "meldinger",
  "nødetatene",
  "politiet",
  "redningsaksjon",
  "rykka",
  "rykket",
  "rykker",
  "røyk",
  "røykutvikling",
  "slagsmål",
  "sloss",
  "slåss",
  "slåssing",
  "tyveri",
  "ulykke",
]);
const stopWords = new Set([
  "alle",
  "and",
  "av",
  "ble",
  "blir",
  "da",
  "de",
  "den",
  "der",
  "det",
  "dette",
  "din",
  "eller",
  "en",
  "er",
  "et",
  "etter",
  "for",
  "fra",
  "han",
  "har",
  "hun",
  "hva",
  "i",
  "ikke",
  "med",
  "mot",
  "og",
  "om",
  "opp",
  "på",
  "seg",
  "som",
  "til",
  "var",
  "ved",
]);
const incidentSignals: Array<[string, RegExp]> = [
  [
    "innbrudd",
    /\b(innbrudd\w*|brekkjern\w*|br[øo]t\s+seg\s+inn|brutt\s+seg\s+inn|bryt(?:e|er)?\s+seg\s+inn)\b/iu,
  ],
  ["tyveri", /\b(tyveri|tyvgods|tyv\w*|tjuv\w*|stj(?:e|å|a)l\w*)\b/iu],
  ["brann", /\b(brann\w*|røyk\w*|slukk\w*)\b/iu],
  ["trafikk", /\b(trafikk|kollisjon|ulykke|påkjør\w*|bilstans)\b/iu],
  ["orden", /\b(ro og orden|ordensforstyrrelse)\b/iu],
  ["slagsmal", /\b(slagsm[åa]l\w*|sl[åa]ss\w*|sloss\w*)\b/iu],
  [
    "water_rescue",
    /\b(badeulykke\w*|drukn\w*|livl[øo]s\s+under\s+vann|hav(?:net|na)\s+under\s+vann|g[åa]tt\s+under\s+vann|under\s+vann|bading|hjerte\s*-?\s*og\s*lungeredning|redningsaksjon\b(?=.*\b(vann|bading|kyvannet)\b))/iu,
  ],
];
const topicSignals: Array<[string, (text: string) => boolean]> = [
  [
    "rosenborg_trener",
    (text) =>
      /\b(rosenborg\w*|rbk)\b/iu.test(text) &&
      /\b(hovedtrener\w*|trenerjobb\w*|trener\w*|ansatt\w*|presentert\w*)\b/iu.test(text),
  ],
];

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("nb")
    .replace(/[«»"'’`´]/g, "")
    .replace(/[^0-9a-zæøå]+/gi, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function distinctiveIncidentTokens(value: string): Set<string> {
  const result = tokens(value);
  genericIncidentTokens.forEach((token) => result.delete(token));
  return result;
}

function tokenSimilarity(
  left: Set<string>,
  right: Set<string>,
): { overlap: number; score: number } {
  if (left.size === 0 || right.size === 0) return { overlap: 0, score: 0 };
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) overlap += 1;
  });
  return { overlap, score: overlap / (left.size + right.size - overlap) };
}

function articlePlaceTokens(article: Article): Set<string> {
  const placeValues = [article.location?.label, ...article.places].filter(
    (place): place is string => Boolean(place),
  );
  const placeTokens = tokens(placeValues.join(" "));
  placeValues.forEach((place) => {
    const normalized = normalizeText(place);
    if (normalized === "kroppanbrua" || normalized === "kroppan bru") {
      placeTokens.add("kroppan-bru");
    }
    if (normalized === "trondheim s") {
      placeTokens.add("trondheim-s");
    }
  });
  genericPlaceTokens.forEach((token) => placeTokens.delete(token));
  return placeTokens;
}

function publishedDistanceMs(left: Article, right: Article): number {
  const leftTime = Date.parse(left.publishedAt);
  const rightTime = Date.parse(right.publishedAt);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime);
}

function hasSharedPlace(left: Article, right: Article): boolean {
  const leftPlaces = articlePlaceTokens(left);
  const rightPlaces = articlePlaceTokens(right);
  return tokenSimilarity(leftPlaces, rightPlaces).overlap > 0;
}

function hasConflictingSpecificPlaces(left: Article, right: Article): boolean {
  const leftPlaces = articlePlaceTokens(left);
  const rightPlaces = articlePlaceTokens(right);
  if (leftPlaces.size === 0 || rightPlaces.size === 0) return false;
  return tokenSimilarity(leftPlaces, rightPlaces).overlap === 0;
}

function sameBroadCategory(left: Article, right: Article): boolean {
  if (left.category === right.category) return true;
  const eventLike = new Set(["Hendelser", "Nyheter"]);
  return eventLike.has(left.category) && eventLike.has(right.category);
}

function sameCanonicalUrl(left: Article, right: Article): boolean {
  return left.url.length > 0 && left.url === right.url;
}

function articleText(article: Article): string {
  return [article.title, article.excerpt, article.location?.label, ...article.places]
    .filter(Boolean)
    .join(" ");
}

function articleIncidentSignals(article: Article): Set<string> {
  const text = articleText(article);
  const signals = new Set(
    incidentSignals.flatMap(([signal, pattern]) => (pattern.test(text) ? [signal] : [])),
  );
  if (signals.has("brann") && isFootballClubBrannContext(article)) signals.delete("brann");
  return signals;
}

function articleTopicSignals(article: Article): Set<string> {
  const text = articleText(article);
  return new Set(topicSignals.flatMap(([signal, matches]) => (matches(text) ? [signal] : [])));
}

function sharedIncidentSignals(left: Article, right: Article): Set<string> {
  const leftSignals = articleIncidentSignals(left);
  if (leftSignals.size === 0) return new Set();
  return new Set([...articleIncidentSignals(right)].filter((signal) => leftSignals.has(signal)));
}

function sharedTopicSignals(left: Article, right: Article): Set<string> {
  const leftSignals = articleTopicSignals(left);
  if (leftSignals.size === 0) return new Set();
  return new Set([...articleTopicSignals(right)].filter((signal) => leftSignals.has(signal)));
}

function hasSharedIncidentSignal(left: Article, right: Article): boolean {
  return sharedIncidentSignals(left, right).size > 0;
}

function articlesConflict(left: Article, right: Article): boolean {
  if (left.situationId && right.situationId && left.situationId !== right.situationId) {
    return true;
  }
  return hasConflictingSpecificPlaces(left, right) && hasSharedIncidentSignal(left, right);
}

function hasGenericPlaceIncidentMatch(
  left: Article,
  right: Article,
  body: { overlap: number; score: number },
): boolean {
  if (hasConflictingSpecificPlaces(left, right)) return false;
  if (!sameBroadCategory(left, right)) return false;
  const distance = publishedDistanceMs(left, right);
  const distinctive = tokenSimilarity(
    distinctiveIncidentTokens(articleText(left)),
    distinctiveIncidentTokens(articleText(right)),
  );
  return [...sharedIncidentSignals(left, right)].some((signal) => {
    const rule = genericPlaceIncidentSignalRules.get(signal);
    return Boolean(
      rule &&
      distance <= rule.windowMs &&
      body.overlap >= rule.minBodyOverlap &&
      distinctive.overlap >= rule.minDistinctiveOverlap,
    );
  });
}

function hasTopicalThreadMatch(
  left: Article,
  right: Article,
  body: { overlap: number; score: number },
): boolean {
  if (publishedDistanceMs(left, right) > topicalThreadWindowMs) return false;
  if (sharedTopicSignals(left, right).size === 0) return false;
  return body.overlap >= 2;
}

function articlesSimilar(left: Article, right: Article): boolean {
  if (left.id === right.id) return true;
  if (left.situationId && left.situationId === right.situationId) return true;
  if (left.situationId && right.situationId) return false;
  if (hasConflictingSpecificPlaces(left, right) && !sameCanonicalUrl(left, right)) return false;
  if (coverageBundlesCompatible(left, right)) return true;
  if (publishedDistanceMs(left, right) > maxGroupAgeMs) return false;

  const title = tokenSimilarity(tokens(left.title), tokens(right.title));
  if (title.overlap >= 3 && title.score >= 0.56) return true;
  if (normalizeText(left.title) === normalizeText(right.title)) return true;

  const body = tokenSimilarity(tokens(articleText(left)), tokens(articleText(right)));
  if (
    publishedDistanceMs(left, right) <= nearDuplicateTextWindowMs &&
    body.overlap >= 10 &&
    body.score >= 0.5 &&
    sameBroadCategory(left, right)
  ) {
    return true;
  }
  if (hasGenericPlaceIncidentMatch(left, right, body)) {
    return true;
  }
  if (hasTopicalThreadMatch(left, right, body)) {
    return true;
  }

  const sharedPlace = hasSharedPlace(left, right);
  if (
    left.source !== right.source &&
    publishedDistanceMs(left, right) <= crossSourceIncidentWindowMs &&
    body.overlap >= 4 &&
    sharedPlace &&
    hasSharedIncidentSignal(left, right)
  ) {
    return true;
  }
  if (body.overlap >= 5 && body.score >= 0.38 && sameBroadCategory(left, right) && sharedPlace) {
    return true;
  }
  if (body.overlap >= 4 && body.score >= 0.28 && sameBroadCategory(left, right) && sharedPlace) {
    return true;
  }

  return false;
}

function sortArticles(left: Article, right: Article): number {
  return right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id);
}

function groupId(article: Article): string {
  if (article.coverageBundle?.id) return article.coverageBundle.id;
  if (article.situationId) return `situation:${article.situationId}`;
  return `article:${article.id}`;
}

function uniqueGroupId(article: Article, groups: HomeArticleGroup[]): string {
  const baseId = groupId(article);
  if (!groups.some((group) => group.id === baseId)) return baseId;
  return `${baseId}:article:${article.id}`;
}

function sourceLabelsFor(articles: Article[]): string[] {
  return [...new Set(articles.map((article) => article.sourceLabel))];
}

function bundleFor(articles: Article[]): ArticleCoverageBundle | undefined {
  return articles.find((article) => article.coverageBundle)?.coverageBundle;
}

function articleFitsGroup(article: Article, group: HomeArticleGroup): boolean {
  if (group.articles.some((existing) => articlesConflict(article, existing))) return false;
  return group.articles.some((existing) => articlesSimilar(article, existing));
}

export function groupHomeArticles(articles: Article[]): HomeArticleGroup[] {
  const groups: HomeArticleGroup[] = [];
  const sorted = [...articles].sort(sortArticles);

  sorted.forEach((article) => {
    const group = groups.find((candidate) => articleFitsGroup(article, candidate));
    if (group) {
      group.articles = [...group.articles, article].sort(sortArticles);
      group.primary = group.articles[0]!;
      group.sourceLabels = sourceLabelsFor(group.articles);
      group.bundle = bundleFor(group.articles);
      return;
    }
    groups.push({
      id: uniqueGroupId(article, groups),
      primary: article,
      articles: [article],
      sourceLabels: [article.sourceLabel],
      bundle: article.coverageBundle,
    });
  });

  return groups.sort((left, right) => sortArticles(left.primary, right.primary));
}

function coverageBundlesCompatible(left: Article, right: Article): boolean {
  const bundleId = left.coverageBundle?.id;
  if (!bundleId || bundleId !== right.coverageBundle?.id) return false;
  if (bundleId.startsWith("coverage:situation:")) return true;
  if (publishedDistanceMs(left, right) > maxGroupAgeMs) return false;
  return sameBroadCategory(left, right) || left.coverageBundle?.kind === right.coverageBundle?.kind;
}

function stableBundleArticleId(articles: Article[]): string {
  return [...articles].sort(
    (left, right) =>
      left.publishedAt.localeCompare(right.publishedAt) || left.id.localeCompare(right.id),
  )[0]!.id;
}

function hashBundleParts(parts: string[]): string {
  const value = parts.join("|");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function groupKind(articles: Article[]): ArticleCoverageBundleKind {
  const hasTopic = articles.some((article) => articleTopicSignals(article).size > 0);
  const hasIncident = articles.some((article) => articleIncidentSignals(article).size > 0);
  if (hasTopic && !hasIncident) return "topic";
  if (hasIncident) return "incident";
  return "update";
}

function groupConfidence(articles: Article[]): ArticleCoverageBundleConfidence {
  const distinctSources = new Set(articles.map((article) => article.source));
  if (articles.some((article) => article.situationId) || distinctSources.size > 1) return "high";
  return "medium";
}

function groupReason(kind: ArticleCoverageBundleKind, articles: Article[]): string {
  const distinctSources = new Set(articles.map((article) => article.source));
  if (kind === "topic") return "Samme nyhetstema";
  if (kind === "incident" && articles.some((article) => article.situationId)) {
    return "Samme hendelse med offisiell tråd";
  }
  if (kind === "incident" && distinctSources.size > 1) return "Samme hendelse på tvers av kilder";
  if (kind === "incident") return "Samme hendelse i oppdateringer";
  if (distinctSources.size > 1) return "Samme sak på tvers av kilder";
  return "Oppdateringer fra samme kilde";
}

function coverageBundleId(articles: Article[]): string {
  const situationId = articles.find((article) => article.situationId)?.situationId;
  if (situationId) return `coverage:situation:${situationId}`;
  const anchor = stableBundleArticleId(articles);
  return `coverage:${hashBundleParts([anchor])}`;
}

function coverageBundleForGroup(
  articles: Article[],
  generatedAt: string,
): ArticleCoverageBundle | undefined {
  if (articles.length < 2) return undefined;
  const kind = groupKind(articles);
  return {
    id: coverageBundleId(articles),
    kind,
    confidence: groupConfidence(articles),
    reason: groupReason(kind, articles),
    generatedAt,
  };
}

export function annotateArticleCoverageBundles(
  articles: Article[],
  generatedAt = new Date().toISOString(),
): Article[] {
  const groups = groupHomeArticles(articles);
  const bundleByArticleId = new Map<string, ArticleCoverageBundle>();

  groups.forEach((group) => {
    const bundle = coverageBundleForGroup(group.articles, generatedAt);
    if (!bundle) return;
    group.articles.forEach((article) => bundleByArticleId.set(article.id, bundle));
  });

  return articles.map((article) => ({
    ...article,
    coverageBundle: bundleByArticleId.get(article.id),
  }));
}
