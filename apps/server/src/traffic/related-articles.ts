import type { Article, RelatedTrafficArticle, TrafficMapEvent } from "@nytt/shared";
import {
  coordinatesFromGeometry,
  coordinateSegmentsFromGeometry,
  distanceMeters,
  distancePointToSegmentMeters,
} from "./geo.js";
import type { Coordinate } from "./geo.js";

const RELATED_ARTICLE_LIMIT = 5;
const GENERIC_TRAFFIC_TOKENS = new Set([
  "a",
  "av",
  "den",
  "det",
  "eitt",
  "en",
  "er",
  "et",
  "etter",
  "for",
  "fra",
  "hendelse",
  "hendelsen",
  "hendelser",
  "i",
  "ikke",
  "med",
  "mot",
  "norge",
  "og",
  "om",
  "opp",
  "pa",
  "på",
  "stengt",
  "stengte",
  "til",
  "trafikk",
  "trafikken",
  "trafikkhendelse",
  "trafikkhendelsen",
  "trondelag",
  "trøndelag",
  "trondheim",
  "ulykke",
  "ulykken",
  "under",
  "ved",
  "veg",
  "vegarbeid",
  "vegen",
  "vegvesen",
  "vei",
  "veiarbeid",
  "veien",
]);

interface RelatedTrafficArticleMatch {
  article: Article;
  distance: number;
}

function articleCoordinate(article: Article): Coordinate | undefined {
  return article.location ? [article.location.lng, article.location.lat] : undefined;
}

function nearestDistanceMeters(event: TrafficMapEvent, article: Article): number | undefined {
  const articlePoint = articleCoordinate(article);
  if (!articlePoint) return undefined;

  const distances: number[] = [];
  const eventCoordinates = coordinatesFromGeometry(event.geometry);
  distances.push(...eventCoordinates.map((coordinate) => distanceMeters(coordinate, articlePoint)));

  const eventSegments = coordinateSegmentsFromGeometry(event.geometry);
  distances.push(
    ...eventSegments.map((segment) =>
      distancePointToSegmentMeters(articlePoint, segment[0], segment[1]),
    ),
  );

  return distances.length > 0 ? Math.min(...distances) : undefined;
}

function isRoadToken(token: string): boolean {
  return /^(?:e|rv|fv)\d+[a-z]?$/u.test(token);
}

function normalizedTextParts(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLocaleLowerCase("nb-NO")
    .normalize("NFC");
}

function roadTokensFromText(text: string): string[] {
  return Array.from(text.matchAll(/\b(?:e|rv|fv)\s*\d+[a-z]?\b/giu), ([match]) =>
    match.replace(/\s+/gu, ""),
  );
}

function placeTokensFromText(text: string): string[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), ([match]) => match);
}

function relevantTokens(parts: Array<string | undefined>): Set<string> {
  const text = normalizedTextParts(parts);
  const tokens = new Set<string>();

  for (const token of [...roadTokensFromText(text), ...placeTokensFromText(text)]) {
    if (isRoadToken(token) || (token.length >= 3 && !GENERIC_TRAFFIC_TOKENS.has(token))) {
      tokens.add(token);
    }
  }

  return tokens;
}

function eventTextHints(event: TrafficMapEvent): Set<string> {
  return relevantTokens([event.title, event.locationName, event.roadName]);
}

function articleTextHints(article: Article): Set<string> {
  return relevantTokens([article.title, ...article.places, article.location?.label]);
}

function hasSharedTextHint(event: TrafficMapEvent, article: Article): boolean {
  const eventTokens = eventTextHints(event);
  if (eventTokens.size === 0) return false;

  for (const token of articleTextHints(article)) {
    if (eventTokens.has(token)) return true;
  }

  return false;
}

function isHighImpact(event: TrafficMapEvent): boolean {
  return event.severity === "high" || event.severity === "critical";
}

export function findRelatedTrafficArticles(
  event: TrafficMapEvent,
  articles: Article[],
): RelatedTrafficArticleMatch[] {
  const maxDistanceMeters = event.category === "roadworks" ? 750 : 1500;

  return articles
    .map((article) => {
      const distance = nearestDistanceMeters(event, article);
      return distance === undefined ? undefined : { article, distance };
    })
    .filter((match): match is RelatedTrafficArticleMatch => Boolean(match))
    .filter(
      (match) =>
        match.distance <= maxDistanceMeters &&
        (isHighImpact(event) || hasSharedTextHint(event, match.article)),
    )
    .sort((left, right) => left.distance - right.distance)
    .slice(0, RELATED_ARTICLE_LIMIT);
}

export function relatedTrafficArticlesForEvent(
  event: TrafficMapEvent,
  articles: Article[],
): RelatedTrafficArticle[] {
  return findRelatedTrafficArticles(event, articles).map((match) => {
    const location = match.article.location;
    return {
      id: match.article.id,
      title: match.article.title,
      url: match.article.url,
      distanceMeters: Math.round(match.distance),
      ...(location
        ? { location: { lat: location.lat, lng: location.lng, label: location.label } }
        : {}),
    };
  });
}
