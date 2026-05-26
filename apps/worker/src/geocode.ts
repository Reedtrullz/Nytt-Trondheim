import type { Article } from "@nytt/shared";

interface PlaceResult {
  navn?: Array<{
    skrivemåte: string;
    representasjonspunkt: { nord: number; øst: number };
  }>;
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
    const endpoint = new URL("https://api.kartverket.no/stedsnavn/v1/navn");
    endpoint.searchParams.set("sok", place);
    endpoint.searchParams.set("kommunenummer", "5001");
    endpoint.searchParams.set("treffPerSide", "1");
    try {
      const response = await fetcher(endpoint, {
        headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
      });
      if (!response.ok) continue;
      const match = ((await response.json()) as PlaceResult).navn?.[0];
      if (match) {
        locations.set(place, {
          lat: match.representasjonspunkt.nord,
          lng: match.representasjonspunkt.øst,
          label: match.skrivemåte,
        });
      }
    } catch {
      // Optional lookup failures must not stop source collection.
    }
  }

  return articles.map((article) => ({
    ...article,
    location: article.location ?? locations.get(article.places[0] ?? ""),
  }));
}
