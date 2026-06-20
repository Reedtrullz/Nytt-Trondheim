import type { Article, TrafficMapEvent } from "@nytt/shared";
import {
  coordinatesFromGeometry,
  coordinateSegmentsFromGeometry,
  distanceMeters,
  distancePointToSegmentMeters,
  type Coordinate,
} from "./geo.js";

const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
const VERY_CLOSE_OFFICIAL_MATCH_METERS = 200;
const SHARED_HINT_OFFICIAL_MATCH_METERS = 1500;
const GENERIC_OFFICIAL_MATCH_TOKENS = new Set([
  "etter",
  "hendelse",
  "hendelsen",
  "i",
  "med",
  "melding",
  "og",
  "på",
  "stengt",
  "stenger",
  "til",
  "trafikk",
  "trafikken",
  "trafikkhendelse",
  "trondheim",
  "ulykke",
  "ulykken",
  "ved",
  "vei",
  "veien",
]);

const accidentSignal =
  /\b(?:bilulykke|kollisjon\w*|p[åa]kj[øo]r\w*|sammenst[øo]t\w*|trafikkuhell\w*|trafikkulykke\w*)\b/u;
const genericAccidentSignal = /\bulykke\w*\b/u;
const closureSignal = /\b(?:omkj[øo]ring\w*|sperr\w*|steng\w*|stengt|trafikken\s+dirigeres)\b/u;
const roadSignal =
  /\b(?:bru(?:a|en)?|e\s*\d+[a-z]?|felt(?:et|ene)?|fylkesvei\w*|fv\s*\d+[a-z]?|kj[øo]refelt\w*|omkj[øo]ringsvegen|riksvei\w*|rv\s*\d+[a-z]?|tunnel\w*|veg(?:en|er|ene)?|vei(?:en|er|ene)?)\b/u;
const reopenedSignal =
  /\b(?:normal\s+trafikk|trafikken\s+g[åa]r\s+som\s+normalt|ve(?:g|i)en\s+(?:er\s+)?[åa]pnet|[åa]pnet\s+igjen|ryddet)\b/u;

function normalizedArticleText(article: Article): string {
  return `${article.title} ${article.excerpt} ${article.places.join(" ")} ${article.location?.label ?? ""}`
    .toLocaleLowerCase("nb")
    .normalize("NFC");
}

function extractRoadName(text: string): string | undefined {
  const roadNumber = text.match(/\b(?:e|rv|fv)\s*\d+[a-z]?\b/iu)?.[0];
  if (roadNumber) return roadNumber.replace(/\s+/gu, "").toLocaleUpperCase("nb");
  const namedRoad = text.match(/\bomkj[øo]ringsvegen\b/iu)?.[0];
  return namedRoad ? "Omkjøringsvegen" : undefined;
}

function hasRoadClosingAccidentSignal(article: Article): boolean {
  if (article.category !== "Transport" || !article.location) return false;
  const text = normalizedArticleText(article);
  if (reopenedSignal.test(text)) return false;
  if (!closureSignal.test(text) || !roadSignal.test(text)) return false;
  return accidentSignal.test(text) || (genericAccidentSignal.test(text) && roadSignal.test(text));
}

function eventState(publishedAt: string, nowMs: number): TrafficMapEvent["state"] {
  const publishedAtMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedAtMs)) return "expired";
  return publishedAtMs + ACTIVE_WINDOW_MS >= nowMs ? "active" : "expired";
}

function isCurrentOfficialEvent(event: TrafficMapEvent, nowMs: number): boolean {
  if (event.state === "cancelled" || event.state === "expired") return false;
  const validToMs = Date.parse(event.validTo ?? "");
  if (Number.isFinite(validToMs) && validToMs < nowMs) return false;
  return true;
}

function articleCoordinate(article: Article): Coordinate | undefined {
  return article.location ? [article.location.lng, article.location.lat] : undefined;
}

function nearestOfficialDistanceMeters(
  event: TrafficMapEvent,
  article: Article,
): number | undefined {
  const articlePoint = articleCoordinate(article);
  if (!articlePoint) return undefined;

  const distances: number[] = [];
  distances.push(
    ...coordinatesFromGeometry(event.geometry).map((coordinate) =>
      distanceMeters(coordinate, articlePoint),
    ),
  );
  distances.push(
    ...coordinateSegmentsFromGeometry(event.geometry).map((segment) =>
      distancePointToSegmentMeters(articlePoint, segment[0], segment[1]),
    ),
  );

  return distances.length > 0 ? Math.min(...distances) : undefined;
}

function normalizedSpecificTokens(parts: Array<string | undefined>): Set<string> {
  const text = parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLocaleLowerCase("nb")
    .normalize("NFC");
  const tokens = new Set<string>();

  for (const match of text.matchAll(/\b(?:e|rv|fv)\s*\d+[a-z]?\b/giu)) {
    tokens.add(match[0].replace(/\s+/gu, ""));
  }
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length >= 3 && !GENERIC_OFFICIAL_MATCH_TOKENS.has(token)) {
      tokens.add(token);
    }
  }

  return tokens;
}

function hasSharedOfficialHint(event: TrafficMapEvent, article: Article): boolean {
  const eventTokens = normalizedSpecificTokens([event.title, event.locationName, event.roadName]);
  if (eventTokens.size === 0) return false;
  const articleTokens = normalizedSpecificTokens([
    article.title,
    article.excerpt,
    ...article.places,
    article.location?.label,
  ]);

  for (const token of articleTokens) {
    if (eventTokens.has(token)) return true;
  }
  return false;
}

function hasOfficialTrafficMatch(
  article: Article,
  officialEvents: TrafficMapEvent[],
  nowMs: number,
): boolean {
  return officialEvents
    .filter((event) => isCurrentOfficialEvent(event, nowMs))
    .some((event) => {
      const distance = nearestOfficialDistanceMeters(event, article);
      if (distance === undefined) return false;
      if (distance <= VERY_CLOSE_OFFICIAL_MATCH_METERS) return true;
      return distance <= SHARED_HINT_OFFICIAL_MATCH_METERS && hasSharedOfficialHint(event, article);
    });
}

function bundleKey(article: Article): string {
  return article.coverageBundle?.id
    ? `bundle:${article.coverageBundle.id}`
    : `article:${article.id}`;
}

function publishedAtMs(article: Article): number {
  const parsed = Date.parse(article.publishedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortedByPublishedAt(articles: Article[]): Article[] {
  return [...articles].sort((left, right) => publishedAtMs(right) - publishedAtMs(left));
}

function trafficEventStateForGroup(articles: Article[], nowMs: number): TrafficMapEvent["state"] {
  const newest = sortedByPublishedAt(articles)[0];
  return newest ? eventState(newest.publishedAt, nowMs) : "expired";
}

export function roadClosingArticleTrafficEvents(
  articles: Article[],
  options: { officialEvents?: TrafficMapEvent[]; now?: Date } = {},
): TrafficMapEvent[] {
  const nowMs = options.now?.getTime() ?? Date.now();
  const officialEvents = options.officialEvents ?? [];
  const groups = new Map<string, Article[]>();

  for (const article of articles.filter(hasRoadClosingAccidentSignal)) {
    const key = bundleKey(article);
    groups.set(key, [...(groups.get(key) ?? []), article]);
  }

  return [...groups.values()]
    .filter(
      (group) => !group.some((article) => hasOfficialTrafficMatch(article, officialEvents, nowMs)),
    )
    .map((group) => {
      const sorted = sortedByPublishedAt(group);
      const primary = sorted[0]!;
      const newestMs = publishedAtMs(primary);
      const oldest = sorted.at(-1) ?? primary;
      const validTo =
        newestMs > 0 ? new Date(newestMs + ACTIVE_WINDOW_MS).toISOString() : primary.publishedAt;
      const sourceEventId = primary.coverageBundle?.id ?? primary.id;
      const sourceCount = new Set(sorted.map((article) => article.source)).size;
      return {
        id: `news-traffic:${sourceEventId}`,
        source: "news_article",
        sourceEventId,
        category: "closure",
        severity: "high",
        state: trafficEventStateForGroup(sorted, nowMs),
        title: primary.title,
        description:
          sourceCount > 1
            ? "Nyhetsrapportering fra flere kilder tyder på trafikkulykke med stengt eller sperret vei. Plasseringen er estimert fra sakene."
            : "Nyhetsrapportering tyder på trafikkulykke med stengt eller sperret vei. Plasseringen er estimert fra saken.",
        locationName: primary.location?.label,
        roadName: extractRoadName(`${primary.title} ${primary.excerpt}`),
        validFrom: oldest.publishedAt,
        validTo,
        updatedAt: primary.publishedAt,
        sourceUrl: primary.url,
        geometry: {
          type: "Point" as const,
          coordinates: [primary.location!.lng, primary.location!.lat],
        },
        rawType: "news-road-closing-accident",
        confidence: 0.62,
        relatedArticles: sorted.map((article) => ({
          id: article.id,
          title: article.title,
          url: article.url,
          distanceMeters: 0,
          location: {
            lat: article.location!.lat,
            lng: article.location!.lng,
            label: article.location!.label,
          },
        })),
      } satisfies TrafficMapEvent;
    });
}
