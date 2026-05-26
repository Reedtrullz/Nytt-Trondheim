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
    const result = await geocodeArticles([article], async () =>
      Response.json({
        navn: [{ skrivemåte: "Bymarka", representasjonspunkt: { nord: 63.4094, øst: 10.26072 } }],
      }),
    );
    expect(result[0]?.location).toEqual({ label: "Bymarka", lat: 63.4094, lng: 10.26072 });
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
});
