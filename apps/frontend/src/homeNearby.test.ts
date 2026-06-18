import type { Article } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { nearbyStoryItems, nearbyStoryItemsForGroups, nearbyStorySummary } from "./homeNearby.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Hendelse ved Sluppen",
    excerpt: "Kort sammendrag.",
    url: "https://example.test/article",
    publishedAt: "2026-06-01T16:42:00.000Z",
    scope: "trondheim",
    category: "Nyheter",
    places: ["Sluppen"],
    location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
    ...overrides,
  };
}

describe("home nearby story model", () => {
  it("ranks situation and operational local stories ahead of ordinary located stories", () => {
    const items = nearbyStoryItems(
      [
        article({
          id: "culture",
          title: "Konsert i Midtbyen",
          category: "Kultur",
          publishedAt: "2026-06-01T18:00:00.000Z",
          location: { lat: 63.43, lng: 10.39, label: "Midtbyen" },
        }),
        article({
          id: "traffic",
          title: "Trafikkulykke ved Omkjøringsvegen",
          category: "Transport",
          publishedAt: "2026-06-01T17:00:00.000Z",
          location: { lat: 63.39, lng: 10.4, label: "Sluppen" },
        }),
        article({
          id: "situation",
          title: "Skogbrann ved Bymarka",
          category: "Hendelser",
          publishedAt: "2026-06-01T15:00:00.000Z",
          location: { lat: 63.4, lng: 10.3, label: "Bymarka" },
          situationId: "skogbrann-bymarka",
        }),
      ],
      { limit: 3 },
    );

    expect(items.map((item) => item.id)).toEqual(["situation", "traffic", "culture"]);
    expect(items.map((item) => item.markerLabel)).toEqual(["1", "2", "3"]);
    expect(items[0]).toMatchObject({
      kind: "situation",
      relevanceLabel: "Tilknyttet situasjon",
      locationLabel: "Bymarka",
    });
  });

  it("omits unlocated and malformed article coordinates", () => {
    const items = nearbyStoryItems([
      article({ id: "valid" }),
      article({ id: "unlocated", location: undefined }),
      article({
        id: "malformed",
        location: { lat: 999, lng: 10.4, label: "Ugyldig breddegrad" },
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("valid");
    expect(items[0]?.position).toEqual([63.4, 10.4]);
  });

  it("summarizes shown versus available located stories honestly", () => {
    expect(nearbyStorySummary([], 0)).toBe("Ingen stedsfestede saker i denne visningen.");
    expect(nearbyStorySummary([nearbyStoryItems([article()])[0]!], 3)).toBe(
      "1 av 3 stedsfestede saker fra nyhetslisten.",
    );
  });

  it("uses one nearby marker for a grouped case covered by multiple providers", () => {
    const primary = article({
      id: "nrk-tiller",
      sourceLabel: "NRK Trøndelag",
      title: "Innbruddsalarm på Tiller",
      publishedAt: "2026-06-18T03:31:00.000Z",
      location: { lat: 63.33974, lng: 10.4203, label: "Tiller" },
    });
    const official = article({
      id: "politiloggen-tiller",
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Innbrudd: Trondheim, Tiller",
      publishedAt: "2026-06-17T22:57:00.000Z",
      location: { lat: 63.33974, lng: 10.4203, label: "Tiller" },
      situationId: "politiloggen-tiller",
    });

    const items = nearbyStoryItemsForGroups(
      [
        {
          id: "article:nrk-tiller",
          primary,
          articles: [primary, official],
          sourceLabels: ["NRK Trøndelag", "Politiloggen"],
        },
      ],
      { limit: 4 },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "article:nrk-tiller",
      markerLabel: "1",
      title: "Innbruddsalarm på Tiller",
      sourceLabel: "2 kilder",
      situationId: "politiloggen-tiller",
      kind: "situation",
    });
  });
});
