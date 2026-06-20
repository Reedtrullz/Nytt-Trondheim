import type { Article, TrafficMapEvent } from "@nytt/shared";
import { relatedTrafficArticlesForEvent } from "./related-articles.js";

const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

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

function hasOfficialTrafficMatch(article: Article, officialEvents: TrafficMapEvent[]): boolean {
  return officialEvents.some(
    (event) => relatedTrafficArticlesForEvent(event, [article]).length > 0,
  );
}

export function roadClosingArticleTrafficEvents(
  articles: Article[],
  options: { officialEvents?: TrafficMapEvent[]; now?: Date } = {},
): TrafficMapEvent[] {
  const nowMs = options.now?.getTime() ?? Date.now();
  const officialEvents = options.officialEvents ?? [];

  return articles
    .filter(hasRoadClosingAccidentSignal)
    .filter((article) => !hasOfficialTrafficMatch(article, officialEvents))
    .map((article) => {
      const publishedAtMs = Date.parse(article.publishedAt);
      const validTo = Number.isFinite(publishedAtMs)
        ? new Date(publishedAtMs + ACTIVE_WINDOW_MS).toISOString()
        : article.publishedAt;
      return {
        id: `news-traffic:${article.id}`,
        source: "news_article",
        sourceEventId: article.id,
        category: "closure",
        severity: "high",
        state: eventState(article.publishedAt, nowMs),
        title: article.title,
        description:
          "Nyhetsrapportering tyder på trafikkulykke med stengt eller sperret vei. Plasseringen er estimert fra saken.",
        locationName: article.location?.label,
        roadName: extractRoadName(`${article.title} ${article.excerpt}`),
        validFrom: article.publishedAt,
        validTo,
        updatedAt: article.publishedAt,
        sourceUrl: article.url,
        geometry: {
          type: "Point",
          coordinates: [article.location!.lng, article.location!.lat],
        },
        rawType: "news-road-closing-accident",
        confidence: 0.62,
        relatedArticles: [
          {
            id: article.id,
            title: article.title,
            url: article.url,
            distanceMeters: 0,
            location: {
              lat: article.location!.lat,
              lng: article.location!.lng,
              label: article.location!.label,
            },
          },
        ],
      } satisfies TrafficMapEvent;
    });
}
