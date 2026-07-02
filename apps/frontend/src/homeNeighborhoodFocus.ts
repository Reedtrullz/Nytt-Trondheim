import type { HomeLocalFocusPoint } from "./homeLocalFocus.js";

export interface HomeNeighborhoodFocusOption {
  id: string;
  label: string;
  point: HomeLocalFocusPoint;
  postalCodes?: string[];
  aliases?: string[];
}

export const homeNeighborhoodFocusStorageKey = "nytt.home.neighborhoodFocus.v1";

export const homeNeighborhoodFocusOptions: HomeNeighborhoodFocusOption[] = [
  {
    id: "midtbyen",
    label: "Midtbyen",
    point: { lat: 63.4305, lng: 10.3951, radiusKm: 5 },
    postalCodes: ["7010", "7011", "7012", "7013"],
    aliases: ["sentrum", "trondheim sentrum"],
  },
  {
    id: "lade",
    label: "Lade",
    point: { lat: 63.445, lng: 10.447, radiusKm: 5 },
    postalCodes: ["7040", "7041", "7042", "7043"],
  },
  {
    id: "ranheim",
    label: "Ranheim",
    point: { lat: 63.4271, lng: 10.539, radiusKm: 6 },
    postalCodes: ["7054", "7055", "7056"],
  },
  {
    id: "byasen",
    label: "Byåsen",
    point: { lat: 63.4147, lng: 10.356, radiusKm: 6 },
    postalCodes: ["7020", "7021", "7022", "7024", "7025"],
    aliases: ["byasen"],
  },
  {
    id: "saupstad",
    label: "Saupstad",
    point: { lat: 63.3727, lng: 10.3573, radiusKm: 5 },
    postalCodes: ["7078"],
  },
  {
    id: "heimdal",
    label: "Heimdal",
    point: { lat: 63.3504, lng: 10.3585, radiusKm: 6 },
    postalCodes: ["7080", "7088", "7089"],
  },
  {
    id: "tiller",
    label: "Tiller",
    point: { lat: 63.3544, lng: 10.379, radiusKm: 6 },
    postalCodes: ["7091", "7092", "7093"],
  },
  {
    id: "flatasen",
    label: "Flatåsen",
    point: { lat: 63.3749, lng: 10.3455, radiusKm: 5 },
    postalCodes: ["7079", "7081"],
    aliases: ["flatasen"],
  },
];

const focusIds = new Set(homeNeighborhoodFocusOptions.map((option) => option.id));

function normalizeFocusQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

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

export function homeNeighborhoodFocusOptionForQuery(
  query: string | null | undefined,
): HomeNeighborhoodFocusOption | undefined {
  const normalized = normalizeFocusQuery(query ?? "");
  if (!normalized) return undefined;
  const numeric = normalized.replace(/\D/g, "");
  return homeNeighborhoodFocusOptions.find((option) => {
    const labels = [option.id, option.label, ...(option.aliases ?? [])].map(normalizeFocusQuery);
    return (
      labels.includes(normalized) ||
      labels.some((label) => label.startsWith(normalized)) ||
      Boolean(numeric && option.postalCodes?.includes(numeric))
    );
  });
}
