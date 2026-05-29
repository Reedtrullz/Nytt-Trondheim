import type { Article, RelatedTrafficArticle, TrafficMapEvent } from "@nytt/shared";
import {
  coordinatesFromGeometry,
  coordinateSegmentsFromGeometry,
  distanceMeters,
  distancePointToSegmentMeters,
} from "./geo.js";
import type { Coordinate } from "./geo.js";

const RELATED_ARTICLE_RADIUS_METERS = 1_000;
const RELATED_ARTICLE_LIMIT = 5;

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
    ...eventSegments.map((segment) => distancePointToSegmentMeters(articlePoint, segment[0], segment[1])),
  );

  return distances.length > 0 ? Math.min(...distances) : undefined;
}

export function findRelatedTrafficArticles(
  event: TrafficMapEvent,
  articles: Article[],
): RelatedTrafficArticleMatch[] {
  return articles
    .map((article) => {
      const distance = nearestDistanceMeters(event, article);
      return distance === undefined ? undefined : { article, distance };
    })
    .filter((match): match is RelatedTrafficArticleMatch => Boolean(match))
    .filter((match) => match.distance <= RELATED_ARTICLE_RADIUS_METERS)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, RELATED_ARTICLE_LIMIT);
}

export function relatedTrafficArticlesForEvent(
  event: TrafficMapEvent,
  articles: Article[],
): RelatedTrafficArticle[] {
  return findRelatedTrafficArticles(event, articles).map((match) => ({
    id: match.article.id,
    title: match.article.title,
    url: match.article.url,
    distanceMeters: Math.round(match.distance),
  }));
}
