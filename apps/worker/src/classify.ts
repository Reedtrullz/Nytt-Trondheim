import type { ArticleCategory, GeographicScope } from "@nytt/shared";

const trondheimTerms = [
  "midtbyen",
  "lade",
  "sluppen",
  "bymarka",
  "granåsen",
  "nidelva",
  "innherredsveien",
  "estenstadmarka",
  "møllenberg",
  "klett",
  "tiller",
  "heimdal",
  "byåsen",
  "moholt",
  "ranheim",
  "nardo",
  "leangen",
  "singsaker",
  "sverresborg",
  "trondheim",
];
const regionalTerms = ["malvik", "stjørdal", "orkland", "melhus", "oppdal", "trøndelag"];

const categoryRules: Array<[ArticleCategory, string[]]> = [
  ["Hendelser", ["brann", "savnet", "ulykke", "redning", "evaku", "politi"]],
  ["Transport", ["vei", "trafikk", "buss", "bru", "sykkel", "tog", "e6"]],
  ["Byutvikling", ["bygg", "bolig", "regulering", "utbygg", "plan"]],
  ["Kultur", ["festival", "konsert", "olavsfest", "kultur", "museum"]],
  ["Politikk", ["byråd", "budsjett", "politikk", "kommunestyre"]],
  ["Vær", ["vær", "regn", "flom", "farevarsel", "vind"]],
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPlaceTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

export function detectScope(text: string): GeographicScope | undefined {
  const normalized = text.toLocaleLowerCase("nb");
  if (trondheimTerms.some((term) => containsPlaceTerm(normalized, term))) return "trondheim";
  if (regionalTerms.some((term) => containsPlaceTerm(normalized, term))) return "trondelag";
  return undefined;
}

export function categorize(text: string): ArticleCategory {
  const normalized = text.toLocaleLowerCase("nb");
  return (
    categoryRules.find(([, terms]) => terms.some((term) => normalized.includes(term)))?.[0] ??
    "Nyheter"
  );
}

export function extractPlaces(text: string): string[] {
  const normalized = text.toLocaleLowerCase("nb");
  return [...trondheimTerms, ...regionalTerms]
    .filter((term) => containsPlaceTerm(normalized, term))
    .map((term) => term.charAt(0).toLocaleUpperCase("nb") + term.slice(1));
}
