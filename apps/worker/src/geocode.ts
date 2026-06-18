import type { Article } from "@nytt/shared";
import { fetchWithSourcePolicy } from "./fetchPolicy.js";

interface PlaceResult {
  navn?: Array<{
    skrivemåte: string;
    kommuner?: Array<{ kommunenavn?: string; kommunenummer?: string }>;
    representasjonspunkt: { nord: number; øst: number };
  }>;
}

const trondheimMunicipalityNumber = "5001";
const trondheimPlaceQueries = new Map<string, string[]>([
  ["sentrum", ["Trondheim sentrum", "Midtbyen"]],
]);

function normalizePlace(place: string): string {
  return place.trim().toLocaleLowerCase("nb").replaceAll(/\s+/g, " ");
}

function searchTermsForPlace(place: string): string[] {
  return [...new Set([...(trondheimPlaceQueries.get(normalizePlace(place)) ?? []), place])];
}

function isTrondheimMatch(match: NonNullable<PlaceResult["navn"]>[number]): boolean {
  return (match.kommuner ?? []).some(
    (kommune) =>
      kommune.kommunenummer === trondheimMunicipalityNumber ||
      kommune.kommunenavn?.toLocaleLowerCase("nb") === "trondheim",
  );
}

function validMatch(
  match: NonNullable<PlaceResult["navn"]>[number],
): Article["location"] | undefined {
  const lat = match.representasjonspunkt.nord;
  const lng = match.representasjonspunkt.øst;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  if (!isTrondheimMatch(match)) return undefined;
  return { lat, lng, label: match.skrivemåte };
}

export async function geocodeArticles(
  articles: Article[],
  fetcher: typeof fetch = fetch,
): Promise<Article[]> {
  const locations = new Map<string, Article["location"]>();
  const placeNames = [
    ...new Set(
      articles
        .filter((article) => article.scope === "trondheim" && article.places[0])
        .map((article) => article.places[0]!),
    ),
  ];

  for (const place of placeNames) {
    for (const searchTerm of searchTermsForPlace(place)) {
      const endpoint = new URL("https://api.kartverket.no/stedsnavn/v1/navn");
      endpoint.searchParams.set("sok", searchTerm);
      endpoint.searchParams.set("kommunenummer", trondheimMunicipalityNumber);
      endpoint.searchParams.set("treffPerSide", "10");
      try {
        const response = await fetchWithSourcePolicy(fetcher, endpoint);
        if (!response.ok) continue;
        const match = ((await response.json()) as PlaceResult).navn
          ?.map((item) => validMatch(item))
          .find((item) => item !== undefined);
        if (match) {
          locations.set(place, match);
          break;
        }
      } catch {
        // Optional lookup failures must not stop source collection.
      }
    }
  }

  return articles.map((article) => ({
    ...article,
    location: article.location ?? locations.get(article.places[0] ?? ""),
  }));
}
