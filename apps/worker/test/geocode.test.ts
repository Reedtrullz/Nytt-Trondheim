import { describe, expect, it } from "vitest";
import type { Article } from "@nytt/shared";
import { geocodeArticles } from "../src/geocode.js";

const article: Article = {
  id: "a",
  source: "nrk",
  sourceLabel: "NRK Trøndelag",
  title: "Brann i Bymarka",
  excerpt: "",
  url: "https://example.test/a",
  publishedAt: "2026-05-26T12:00:00Z",
  scope: "trondheim",
  category: "Hendelser",
  places: ["Bymarka"],
};

describe("Kartverket place enrichment", () => {
  it("maps a source-mentioned Trondheim place to an estimated marker location", async () => {
    let requestInit: RequestInit | undefined;
    const result = await geocodeArticles([article], async (_url, init) => {
      requestInit = init;
      return Response.json({
        navn: [
          {
            skrivemåte: "Bymarka",
            kommuner: [{ kommunenavn: "Trondheim", kommunenummer: "5001" }],
            representasjonspunkt: { nord: 63.4094, øst: 10.26072 },
          },
        ],
      });
    });
    expect(result[0]?.location).toEqual({ label: "Bymarka", lat: 63.4094, lng: 10.26072 });
    expect(requestInit?.signal).toBeTruthy();
    expect(new Headers(requestInit?.headers).get("User-Agent")).toContain("NyttTrondheim");
  });

  it("does not map broader regional reporting into Trondheim", async () => {
    let requested = false;
    const result = await geocodeArticles([{ ...article, scope: "trondelag" }], async () => {
      requested = true;
      return Response.json({ navn: [] });
    });
    expect(requested).toBe(false);
    expect(result[0]?.location).toBeUndefined();
  });

  it("ignores Kartverket hits outside Trondheim before storing marker coordinates", async () => {
    const result = await geocodeArticles([{ ...article, places: ["Lade"] }], async () =>
      Response.json({
        navn: [
          {
            skrivemåte: "Lade",
            kommuner: [{ kommunenavn: "Sykkylven", kommunenummer: "1528" }],
            representasjonspunkt: { nord: 62.30988, øst: 6.71691 },
          },
          {
            skrivemåte: "Lade",
            kommuner: [{ kommunenavn: "Trondheim", kommunenummer: "5001" }],
            representasjonspunkt: { nord: 63.44626, øst: 10.44344 },
          },
        ],
      }),
    );

    expect(result[0]?.location).toEqual({ label: "Lade", lat: 63.44626, lng: 10.44344 });
  });

  it("geocodes bare Sentrum as Trondheim sentrum instead of the first national Sentrum hit", async () => {
    const requestedTerms: string[] = [];
    const result = await geocodeArticles([{ ...article, places: ["Sentrum"] }], async (url) => {
      const endpoint = new URL(String(url));
      requestedTerms.push(endpoint.searchParams.get("sok") ?? "");
      if (endpoint.searchParams.get("sok") === "Trondheim sentrum") {
        return Response.json({
          navn: [
            {
              skrivemåte: "Trondheim sentrum",
              kommuner: [{ kommunenavn: "Trondheim", kommunenummer: "5001" }],
              representasjonspunkt: { nord: 63.43209, øst: 10.3991 },
            },
          ],
        });
      }
      return Response.json({
        navn: [
          {
            skrivemåte: "Sentrum",
            kommuner: [{ kommunenavn: "Trysil", kommunenummer: "3421" }],
            representasjonspunkt: { nord: 61.24959, øst: 12.0361 },
          },
        ],
      });
    });

    expect(requestedTerms[0]).toBe("Trondheim sentrum");
    expect(result[0]?.location).toEqual({
      label: "Trondheim sentrum",
      lat: 63.43209,
      lng: 10.3991,
    });
  });
});
