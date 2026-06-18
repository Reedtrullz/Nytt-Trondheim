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
  situationId?: string;
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

interface NearbyArticleGroup {
  id: string;
  primary: Article;
  articles: Article[];
  sourceLabels: string[];
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

function locatedArticle(group: NearbyArticleGroup): Article | undefined {
  const located = [
    group.primary,
    ...group.articles.filter((article) => article.id !== group.primary.id),
  ].filter((article) => latLngFromLonLat(article.location?.lng, article.location?.lat));
  return located[0];
}

function sourceLabelFor(group: NearbyArticleGroup): string {
  if (group.sourceLabels.length < 2) return group.primary.sourceLabel;
  return `${group.sourceLabels.length} kilder`;
}

function situationIdFor(group: NearbyArticleGroup): string | undefined {
  return group.articles.find((article) => article.situationId)?.situationId;
}

export function nearbyStoryItemsForGroups(
  groups: NearbyArticleGroup[],
  { limit = 4 }: { limit?: number } = {},
): NearbyStoryItem[] {
  return groups
    .flatMap((group) => {
      const locationArticle = locatedArticle(group);
      const position = latLngFromLonLat(
        locationArticle?.location?.lng,
        locationArticle?.location?.lat,
      );
      if (!position || !locationArticle?.location) return [];
      const representative = group.articles.find((article) => article.situationId) ?? group.primary;
      const kind = nearbyKind(representative);
      const copy = relevanceCopy(kind);
      return [
        {
          id: group.id,
          article: group.primary,
          situationId: situationIdFor(group),
          position,
          markerLabel: "",
          title: group.primary.title,
          locationLabel: locationArticle.location.label,
          sourceLabel: sourceLabelFor(group),
          category: group.primary.category,
          publishedAt: group.primary.publishedAt,
          kind,
          score: Math.max(
            ...group.articles.map((article) => nearbyScore(article, nearbyKind(article))),
          ),
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

export function nearbyStoryItems(
  articles: Article[],
  { limit = 4 }: { limit?: number } = {},
): NearbyStoryItem[] {
  return nearbyStoryItemsForGroups(
    articles.map((article) => ({
      id: article.id,
      primary: article,
      articles: [article],
      sourceLabels: [article.sourceLabel],
    })),
    { limit },
  );
}

export function nearbyStorySummary(items: NearbyStoryItem[], locatedCount: number): string {
  if (locatedCount === 0) return "Ingen stedsfestede saker i denne visningen.";
  const shown = items.length;
  const suffix = locatedCount > shown ? ` av ${locatedCount}` : "";
  return `${shown}${suffix} stedsfestede saker fra nyhetslisten.`;
}
