import type { Article } from "@nytt/shared";

export interface HomeArticleGroup {
  id: string;
  primary: Article;
  articles: Article[];
  sourceLabels: string[];
}

const maxGroupAgeMs = 24 * 60 * 60 * 1000;
const crossSourceIncidentWindowMs = 8 * 60 * 60 * 1000;
const genericPlaceTokens = new Set(["trondheim", "trøndelag", "trondelag"]);
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
  ["innbrudd", /\binnbrudd\w*/iu],
  ["tyveri", /\b(tyveri|tyvgods|stj(?:å|a)l\w*)\b/iu],
  ["brann", /\b(brann|røykutvikling)\b/iu],
  ["trafikk", /\b(trafikk|kollisjon|ulykke|påkjør\w*|bilstans)\b/iu],
  ["orden", /\b(ro og orden|ordensforstyrrelse)\b/iu],
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
  const placeTokens = tokens(
    [article.location?.label, ...article.places].filter(Boolean).join(" "),
  );
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

function sameBroadCategory(left: Article, right: Article): boolean {
  if (left.category === right.category) return true;
  const eventLike = new Set(["Hendelser", "Nyheter"]);
  return eventLike.has(left.category) && eventLike.has(right.category);
}

function articleText(article: Article): string {
  return [article.title, article.excerpt, article.location?.label, ...article.places]
    .filter(Boolean)
    .join(" ");
}

function articleIncidentSignals(article: Article): Set<string> {
  const text = articleText(article);
  return new Set(
    incidentSignals.flatMap(([signal, pattern]) => (pattern.test(text) ? [signal] : [])),
  );
}

function hasSharedIncidentSignal(left: Article, right: Article): boolean {
  const leftSignals = articleIncidentSignals(left);
  if (leftSignals.size === 0) return false;
  return [...articleIncidentSignals(right)].some((signal) => leftSignals.has(signal));
}

function articlesSimilar(left: Article, right: Article): boolean {
  if (left.id === right.id) return true;
  if (left.situationId && left.situationId === right.situationId) return true;
  if (publishedDistanceMs(left, right) > maxGroupAgeMs) return false;

  const title = tokenSimilarity(tokens(left.title), tokens(right.title));
  if (title.overlap >= 3 && title.score >= 0.56) return true;
  if (normalizeText(left.title) === normalizeText(right.title)) return true;

  const body = tokenSimilarity(tokens(articleText(left)), tokens(articleText(right)));
  const sharedPlace = hasSharedPlace(left, right);
  if (
    left.source !== right.source &&
    publishedDistanceMs(left, right) <= crossSourceIncidentWindowMs &&
    body.overlap >= 4 &&
    sameBroadCategory(left, right) &&
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
  if (article.situationId) return `situation:${article.situationId}`;
  return `article:${article.id}`;
}

function sourceLabelsFor(articles: Article[]): string[] {
  return [...new Set(articles.map((article) => article.sourceLabel))];
}

export function groupHomeArticles(articles: Article[]): HomeArticleGroup[] {
  const groups: HomeArticleGroup[] = [];
  const sorted = [...articles].sort(sortArticles);

  sorted.forEach((article) => {
    const group = groups.find((candidate) =>
      candidate.articles.some((existing) => articlesSimilar(article, existing)),
    );
    if (group) {
      group.articles = [...group.articles, article].sort(sortArticles);
      group.primary = group.articles[0]!;
      group.sourceLabels = sourceLabelsFor(group.articles);
      return;
    }
    groups.push({
      id: groupId(article),
      primary: article,
      articles: [article],
      sourceLabels: [article.sourceLabel],
    });
  });

  return groups.sort((left, right) => sortArticles(left.primary, right.primary));
}
