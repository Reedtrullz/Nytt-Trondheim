import type { HomeStoryCard } from "./homeStoryCards.js";

export interface HomeLocalFocusPoint {
  lat: number;
  lng: number;
  radiusKm?: number;
}

export interface HomeLocalFocusMeta {
  distanceKm?: number;
  withinRadius: boolean;
}

const defaultRadiusKm = 10;
const earthRadiusKm = 6371;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function validCoordinate(lat: number | undefined, lng: number | undefined): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function distanceKmBetween(
  left: Pick<HomeLocalFocusPoint, "lat" | "lng">,
  right: Pick<HomeLocalFocusPoint, "lat" | "lng">,
): number {
  const deltaLat = radians(right.lat - left.lat);
  const deltaLng = radians(right.lng - left.lng);
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cardPoint(card: HomeStoryCard): Pick<HomeLocalFocusPoint, "lat" | "lng"> | undefined {
  const located = [card.primary, ...card.group.articles].find((article) =>
    validCoordinate(article.location?.lat, article.location?.lng),
  );
  if (!located?.location) return undefined;
  return { lat: located.location.lat, lng: located.location.lng };
}

export function localFocusMetaForCard(
  card: HomeStoryCard,
  focus: HomeLocalFocusPoint,
): HomeLocalFocusMeta {
  const point = cardPoint(card);
  if (!point) return { withinRadius: false };
  const distanceKm = distanceKmBetween(focus, point);
  return {
    distanceKm,
    withinRadius: distanceKm <= (focus.radiusKm ?? defaultRadiusKm),
  };
}

export function rankHomeStoryCardsByLocalFocus(
  cards: HomeStoryCard[],
  focus: HomeLocalFocusPoint | undefined,
): HomeStoryCard[] {
  if (!focus) return cards;
  return [...cards]
    .map((card, index) => ({ card, index, meta: localFocusMetaForCard(card, focus) }))
    .sort((left, right) => {
      const leftRank = left.meta.distanceKm === undefined ? 2 : left.meta.withinRadius ? 0 : 1;
      const rightRank = right.meta.distanceKm === undefined ? 2 : right.meta.withinRadius ? 0 : 1;
      return (
        leftRank - rightRank ||
        (left.meta.distanceKm ?? Number.POSITIVE_INFINITY) -
          (right.meta.distanceKm ?? Number.POSITIVE_INFINITY) ||
        left.index - right.index
      );
    })
    .map((item) => item.card);
}
