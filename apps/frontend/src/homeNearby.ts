import type { Article } from "@nytt/shared";
import { latLngFromLonLat } from "./mapCoordinates.js";

export type NearbyStoryKind =
  | "situation"
  | "traffic"
  | "weather"
  | "municipal"
  | "development"
  | "local";

export interface NearbyStoryItem {
  id: string;
  article: Article;
  position: [number, number];
  markerLabel: string;
  title: string;
  locationLabel: string;
  sourceLabel: string;
  category: Article["category"];
  publishedAt: string;
  kind: NearbyStoryKind;
  relevanceLabel: string;
  relevanceDetail: string;
  score: number;
}

const categoryPriority = {
  Hendelser: 60,
  Transport: 48,
  Vær: 44,
  Byutvikling: 34,
  Politikk: 28,
  Nyheter: 24,
  Kultur: 18,
} as const satisfies Record<Article["category"], number>;

function nearbyKind(article: Article): NearbyStoryKind {
  if (article.situationId) return "situation";
  if (article.source === "trondheim_kommune") return "municipal";
  if (article.category === "Transport") return "traffic";
  if (article.category === "Vær") return "weather";
  if (article.category === "Byutvikling") return "development";
  return "local";
}

function relevanceCopy(
  kind: NearbyStoryKind,
): Pick<NearbyStoryItem, "relevanceDetail" | "relevanceLabel"> {
  switch (kind) {
    case "situation":
      return {
        relevanceLabel: "Tilknyttet situasjon",
        relevanceDetail: "Koblet til et åpent situasjonsrom med kilde- og kartkontekst.",
      };
    case "traffic":
      return {
        relevanceLabel: "Påvirker ferdsel",
        relevanceDetail: "Stedsfestet transport- eller framkommelighetssak i nyhetslisten.",
      };
    case "weather":
      return {
        relevanceLabel: "Vær og konsekvens",
        relevanceDetail: "Værrelatert sak med omtalt sted eller område.",
      };
    case "municipal":
      return {
        relevanceLabel: "Kommunalt varsel",
        relevanceDetail: "Publisert av Trondheim kommune og knyttet til et konkret sted.",
      };
    case "development":
      return {
        relevanceLabel: "Byutvikling",
        relevanceDetail: "Stedsfestet byutviklingssak som kan påvirke nærmiljøet.",
      };
    case "local":
      return {
        relevanceLabel: "Stedsfestet sak",
        relevanceDetail: "Nyhetssak med omtalt sted fra kildematerialet.",
      };
  }
}

function nearbyScore(article: Article, kind: NearbyStoryKind): number {
  const situationBoost = kind === "situation" ? 30 : 0;
  const municipalBoost = kind === "municipal" ? 8 : 0;
  const trondheimBoost = article.scope === "trondheim" ? 4 : 0;
  const placeBoost = Math.min(article.places.length, 3) * 2;
  return (
    categoryPriority[article.category] +
    situationBoost +
    municipalBoost +
    trondheimBoost +
    placeBoost
  );
}

export function nearbyStoryItems(
  articles: Article[],
  { limit = 4 }: { limit?: number } = {},
): NearbyStoryItem[] {
  return articles
    .flatMap((article) => {
      const position = latLngFromLonLat(article.location?.lng, article.location?.lat);
      if (!position || !article.location) return [];
      const kind = nearbyKind(article);
      const copy = relevanceCopy(kind);
      return [
        {
          id: article.id,
          article,
          position,
          markerLabel: "",
          title: article.title,
          locationLabel: article.location.label,
          sourceLabel: article.sourceLabel,
          category: article.category,
          publishedAt: article.publishedAt,
          kind,
          score: nearbyScore(article, kind),
          ...copy,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.publishedAt.localeCompare(left.publishedAt) ||
        left.title.localeCompare(right.title, "nb"),
    )
    .slice(0, limit)
    .map((item, index) => ({ ...item, markerLabel: String(index + 1) }));
}

export function nearbyStorySummary(items: NearbyStoryItem[], locatedCount: number): string {
  if (locatedCount === 0) return "Ingen stedsfestede saker i denne visningen.";
  const shown = items.length;
  const suffix = locatedCount > shown ? ` av ${locatedCount}` : "";
  return `${shown}${suffix} stedsfestede saker fra nyhetslisten.`;
}
