import type { Article } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { groupHomeArticles } from "./homeArticleGroups.js";
import { homeStoryCardsForGroups } from "./homeStoryCards.js";
import {
  distanceKmBetween,
  localFocusMetaForCard,
  rankHomeStoryCardsByLocalFocus,
  summarizeHomeStoryCardsByLocalFocus,
} from "./homeLocalFocus.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Nyhet fra Trondheim",
    excerpt: "Kort nyhet.",
    url: "https://example.test/article",
    publishedAt: "2026-07-02T10:00:00.000Z",
    scope: "trondheim",
    category: "Nyheter",
    places: ["Trondheim"],
    ...overrides,
  };
}

describe("home local focus", () => {
  it("calculates short Trondheim distances in kilometers", () => {
    const torvet = { lat: 63.4305, lng: 10.3951 };
    const lade = { lat: 63.445, lng: 10.447 };

    expect(distanceKmBetween(torvet, lade)).toBeGreaterThan(2);
    expect(distanceKmBetween(torvet, lade)).toBeLessThan(4);
  });

  it("prioritizes located story cards inside the local radius", () => {
    const cards = homeStoryCardsForGroups(
      groupHomeArticles([
        article({
          id: "far",
          title: "Sak fra Orkanger",
          publishedAt: "2026-07-02T10:02:00.000Z",
          location: { lat: 63.312, lng: 9.853, label: "Orkanger" },
          places: ["Orkanger"],
        }),
        article({
          id: "near",
          title: "Sak fra Torvet",
          publishedAt: "2026-07-02T09:58:00.000Z",
          location: { lat: 63.4305, lng: 10.3951, label: "Torvet" },
          places: ["Torvet"],
        }),
        article({
          id: "unlocated",
          title: "Sak uten sted",
          publishedAt: "2026-07-02T09:59:00.000Z",
          location: undefined,
          places: [],
        }),
      ]),
    );

    const ranked = rankHomeStoryCardsByLocalFocus(cards, {
      lat: 63.4305,
      lng: 10.3951,
      radiusKm: 10,
    });

    expect(ranked.map((card) => card.primary.id)).toEqual(["near", "far", "unlocated"]);
    expect(localFocusMetaForCard(ranked[0]!, { lat: 63.4305, lng: 10.3951 }).withinRadius).toBe(
      true,
    );
  });

  it("keeps published order when local focus is inactive", () => {
    const cards = homeStoryCardsForGroups(
      groupHomeArticles([
        article({ id: "newer", publishedAt: "2026-07-02T10:02:00.000Z" }),
        article({ id: "older", publishedAt: "2026-07-02T09:58:00.000Z" }),
      ]),
    );

    expect(rankHomeStoryCardsByLocalFocus(cards, undefined)).toBe(cards);
  });

  it("summarizes local-focus coverage and closest story cards", () => {
    const cards = homeStoryCardsForGroups(
      groupHomeArticles([
        article({
          id: "far",
          title: "Sak fra Orkanger",
          location: { lat: 63.312, lng: 9.853, label: "Orkanger" },
          places: ["Orkanger"],
        }),
        article({
          id: "near",
          title: "Sak fra Elgeseter",
          location: { lat: 63.4166, lng: 10.3966, label: "Elgeseter" },
          places: ["Elgeseter"],
        }),
        article({ id: "unlocated", title: "Sak uten sted", location: undefined, places: [] }),
      ]),
    );

    const summary = summarizeHomeStoryCardsByLocalFocus(
      cards,
      { lat: 63.4166, lng: 10.3966, radiusKm: 4 },
      2,
    );

    expect(summary.locatedCount).toBe(2);
    expect(summary.withinRadiusCount).toBe(1);
    expect(summary.closestItems.map((item) => item.id)).toEqual(["article:near", "article:far"]);
    expect(summary.closestItems[0]).toMatchObject({
      title: "Sak fra Elgeseter",
      locationLabel: "Elgeseter",
      withinRadius: true,
    });
  });
});
