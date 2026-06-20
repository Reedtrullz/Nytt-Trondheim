import type { ArticleCategory, ArticleTopic, GeographicScope } from "@nytt/shared";

export const articleCategories = [
  "Alle",
  "Hendelser",
  "Krim",
  "Transport",
  "Sport",
  "Politikk",
  "Byutvikling",
  "Kultur",
  "Nyheter",
] as const;

export type ArticleCategoryFilter = (typeof articleCategories)[number];

export const articleCategoryLabels = {
  Alle: "Alle",
  Nyheter: "Nyheter",
  Hendelser: "Hendelser",
  Krim: "Krim",
  Byutvikling: "Byutvikling",
  Kultur: "Kultur",
  Sport: "Sport",
  Transport: "Trafikk",
  Politikk: "Politikk",
  Vær: "Vær",
} as const satisfies Record<ArticleCategory | "Alle", string>;

export const articleTopicLabels = {
  rosenborg: "Rosenborg",
} as const satisfies Record<ArticleTopic, string>;

export interface HomeFilters {
  q: string;
  scope: GeographicScope;
  category: ArticleCategoryFilter;
  topic?: ArticleTopic;
}

const categorySet = new Set<string>(articleCategories);
const topicSet = new Set<string>(Object.keys(articleTopicLabels));

export function parseHomeFilters(search: string): HomeFilters {
  const parameters = new URLSearchParams(search);
  const requestedScope = parameters.get("scope");
  const requestedCategory = parameters.get("category");
  const requestedTopic = parameters.get("topic");
  const category = categorySet.has(requestedCategory ?? "")
    ? (requestedCategory as ArticleCategoryFilter)
    : "Alle";
  const topic =
    category === "Sport" && topicSet.has(requestedTopic ?? "")
      ? (requestedTopic as ArticleTopic)
      : undefined;
  return {
    q: (parameters.get("q") ?? "").trim(),
    scope: requestedScope === "trondelag" ? "trondelag" : "trondheim",
    category,
    ...(topic ? { topic } : {}),
  };
}

export function buildHomeSearch(filters: HomeFilters): string {
  const parameters = new URLSearchParams();
  const query = filters.q.trim();
  if (query) parameters.set("q", query);
  if (filters.scope !== "trondheim") parameters.set("scope", filters.scope);
  if (filters.category !== "Alle") parameters.set("category", filters.category);
  if (filters.category === "Sport" && filters.topic) parameters.set("topic", filters.topic);
  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}

export function searchSummary(filters: HomeFilters): string {
  const place = filters.scope === "trondheim" ? "Trondheim" : "Trøndelag";
  const parts: string[] = [];
  if (filters.q.trim()) parts.push(`"${filters.q.trim()}"`);
  if (filters.category === "Sport" && filters.topic) parts.push(articleTopicLabels[filters.topic]);
  if (filters.category !== "Alle") parts.push(articleCategoryLabels[filters.category]);
  parts.push(`i ${place}`);
  return parts.join(" ");
}
