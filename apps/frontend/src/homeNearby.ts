import type { Article, HomeSituationSummary } from "@nytt/shared";
import { distanceKmBetween, type HomeLocalFocusPoint } from "./homeLocalFocus.js";
import { latLngFromLonLat } from "./mapCoordinates.js";

export type NearbyStoryKind =
  | "situation"
  | "crime"
  | "traffic"
  | "weather"
  | "municipal"
  | "development"
  | "local";

export interface NearbyStoryItem {
  id: string;
  article?: Article;
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
  distanceKm?: number;
  withinLocalRadius?: boolean;
}

interface NearbyArticleGroup {
  id: string;
  primary: Article;
  articles: Article[];
  sourceLabels: string[];
}

const categoryPriority = {
  Hendelser: 60,
  Krim: 54,
  Transport: 48,
  Vær: 44,
  Byutvikling: 34,
  Politikk: 28,
  Nyheter: 24,
  Sport: 20,
  Kultur: 18,
} as const satisfies Record<Article["category"], number>;

function nearbyKind(article: Article): NearbyStoryKind {
  if (article.situationId) return "situation";
  if (article.source === "trondheim_kommune") return "municipal";
  if (article.category === "Krim") return "crime";
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
    case "crime":
      return {
        relevanceLabel: "Politi og kriminalitet",
        relevanceDetail: "Stedsfestet politi- eller kriminalitetssak fra nyhetslisten.",
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

function situationItem(
  situation: HomeSituationSummary,
  localFocus?: HomeLocalFocusPoint,
): NearbyStoryItem | undefined {
  const location = situation.primaryLocation;
  const position = latLngFromLonLat(location?.lng, location?.lat);
  if (!location || !position) return undefined;
  const copy = relevanceCopy("situation");
  const distanceKm = localFocus
    ? distanceKmBetween(localFocus, {
        lat: location.lat,
        lng: location.lng,
      })
    : undefined;
  return {
    id: `situation:${situation.id}`,
    situationId: situation.id,
    position,
    markerLabel: "",
    title: situation.title,
    locationLabel: location.label || situation.locationLabel,
    sourceLabel:
      situation.verificationStatus === "Offentlig bekreftet"
        ? "Offentlig bekreftet"
        : "Situasjonsrom",
    category: "Hendelser",
    publishedAt: situation.updatedAt,
    kind: "situation",
    score: 92,
    ...(distanceKm !== undefined
      ? {
          distanceKm,
          withinLocalRadius: distanceKm <= (localFocus?.radiusKm ?? 10),
        }
      : {}),
    ...copy,
  };
}

function rankNearbyItems(
  items: NearbyStoryItem[],
  { limit, localFocus }: { limit: number; localFocus?: HomeLocalFocusPoint },
): NearbyStoryItem[] {
  return items
    .sort((left, right) => {
      if (localFocus) {
        const leftRank = left.distanceKm === undefined ? 2 : left.withinLocalRadius ? 0 : 1;
        const rightRank = right.distanceKm === undefined ? 2 : right.withinLocalRadius ? 0 : 1;
        const localResult =
          leftRank - rightRank ||
          (left.distanceKm ?? Number.POSITIVE_INFINITY) -
            (right.distanceKm ?? Number.POSITIVE_INFINITY);
        if (localResult !== 0) return localResult;
      }
      return (
        right.score - left.score ||
        right.publishedAt.localeCompare(left.publishedAt) ||
        left.title.localeCompare(right.title, "nb")
      );
    })
    .slice(0, limit)
    .map((item, index) => ({ ...item, markerLabel: String(index + 1) }));
}

export function nearbyStoryItemsForGroups(
  groups: NearbyArticleGroup[],
  { limit = 4, localFocus }: { limit?: number; localFocus?: HomeLocalFocusPoint } = {},
): NearbyStoryItem[] {
  const items = groups.flatMap((group) => {
    const locationArticle = locatedArticle(group);
    const position = latLngFromLonLat(
      locationArticle?.location?.lng,
      locationArticle?.location?.lat,
    );
    if (!position || !locationArticle?.location) return [];
    const representative = group.articles.find((article) => article.situationId) ?? group.primary;
    const kind = nearbyKind(representative);
    const copy = relevanceCopy(kind);
    const distanceKm = localFocus
      ? distanceKmBetween(localFocus, {
          lat: locationArticle.location.lat,
          lng: locationArticle.location.lng,
        })
      : undefined;
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
        ...(distanceKm !== undefined
          ? {
              distanceKm,
              withinLocalRadius: distanceKm <= (localFocus?.radiusKm ?? 10),
            }
          : {}),
        ...copy,
      },
    ];
  });
  return rankNearbyItems(items, { limit, localFocus });
}

export function nearbyStoryItemsForGroupsAndSituations(
  groups: NearbyArticleGroup[],
  situations: HomeSituationSummary[] = [],
  { limit = 4, localFocus }: { limit?: number; localFocus?: HomeLocalFocusPoint } = {},
): NearbyStoryItem[] {
  const articleItems = nearbyStoryItemsForGroups(groups, {
    limit: Number.MAX_SAFE_INTEGER,
    localFocus,
  });
  const coveredSituationIds = new Set(
    articleItems.flatMap((item) => (item.situationId ? [item.situationId] : [])),
  );
  const situationItems = situations.flatMap((situation) => {
    if (situation.status !== "preliminary" && situation.status !== "active") return [];
    if (coveredSituationIds.has(situation.id)) return [];
    const item = situationItem(situation, localFocus);
    return item ? [item] : [];
  });
  return rankNearbyItems([...articleItems, ...situationItems], { limit, localFocus });
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
  return `${shown}${suffix} stedsfestede saker og situasjoner.`;
}

export function nearbyDistanceLabel(distanceKm: number | undefined): string | undefined {
  if (distanceKm === undefined || !Number.isFinite(distanceKm)) return undefined;
  if (distanceKm < 1) return "under 1 km unna";
  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1).replace(".", ",")} km unna`;
  }
  return `${Math.round(distanceKm)} km unna`;
}
