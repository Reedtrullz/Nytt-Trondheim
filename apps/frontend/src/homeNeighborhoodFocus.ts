import type { HomeLocalFocusPoint } from "./homeLocalFocus.js";

export interface HomeNeighborhoodFocusOption {
  id: string;
  label: string;
  point: HomeLocalFocusPoint;
}

export const homeNeighborhoodFocusStorageKey = "nytt.home.neighborhoodFocus.v1";

export const homeNeighborhoodFocusOptions: HomeNeighborhoodFocusOption[] = [
  { id: "midtbyen", label: "Midtbyen", point: { lat: 63.4305, lng: 10.3951, radiusKm: 5 } },
  { id: "lade", label: "Lade", point: { lat: 63.445, lng: 10.447, radiusKm: 5 } },
  { id: "ranheim", label: "Ranheim", point: { lat: 63.4271, lng: 10.539, radiusKm: 6 } },
  { id: "byasen", label: "Byåsen", point: { lat: 63.4147, lng: 10.356, radiusKm: 6 } },
  { id: "saupstad", label: "Saupstad", point: { lat: 63.3727, lng: 10.3573, radiusKm: 5 } },
  { id: "heimdal", label: "Heimdal", point: { lat: 63.3504, lng: 10.3585, radiusKm: 6 } },
  { id: "tiller", label: "Tiller", point: { lat: 63.3544, lng: 10.379, radiusKm: 6 } },
  { id: "flatasen", label: "Flatåsen", point: { lat: 63.3749, lng: 10.3455, radiusKm: 5 } },
];

const focusIds = new Set(homeNeighborhoodFocusOptions.map((option) => option.id));

export function parseHomeNeighborhoodFocusId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && focusIds.has(trimmed) ? trimmed : undefined;
}

export function homeNeighborhoodFocusOption(
  id: string | null | undefined,
): HomeNeighborhoodFocusOption | undefined {
  const parsed = parseHomeNeighborhoodFocusId(id);
  return homeNeighborhoodFocusOptions.find((option) => option.id === parsed);
}
