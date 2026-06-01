import type { GeographicScope } from "@nytt/shared";

export const articleCategories = [
  "Alle",
  "Nyheter",
  "Hendelser",
  "Byutvikling",
  "Kultur",
  "Transport",
  "Politikk",
] as const;

export type ArticleCategoryFilter = (typeof articleCategories)[number];

export interface HomeFilters {
  q: string;
  scope: GeographicScope;
  category: ArticleCategoryFilter;
}

const categorySet = new Set<string>(articleCategories);

export function parseHomeFilters(search: string): HomeFilters {
  const parameters = new URLSearchParams(search);
  const requestedScope = parameters.get("scope");
  const requestedCategory = parameters.get("category");
  return {
    q: (parameters.get("q") ?? "").trim(),
    scope: requestedScope === "trondelag" ? "trondelag" : "trondheim",
    category: categorySet.has(requestedCategory ?? "")
      ? (requestedCategory as ArticleCategoryFilter)
      : "Alle",
  };
}

export function buildHomeSearch(filters: HomeFilters): string {
  const parameters = new URLSearchParams();
  const query = filters.q.trim();
  if (query) parameters.set("q", query);
  if (filters.scope !== "trondheim") parameters.set("scope", filters.scope);
  if (filters.category !== "Alle") parameters.set("category", filters.category);
  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}

export function searchSummary(filters: HomeFilters): string {
  const place = filters.scope === "trondheim" ? "Trondheim" : "Trøndelag";
  const parts: string[] = [];
  if (filters.q.trim()) parts.push(`"${filters.q.trim()}"`);
  if (filters.category !== "Alle") parts.push(filters.category);
  parts.push(`i ${place}`);
  return parts.join(" ");
}
