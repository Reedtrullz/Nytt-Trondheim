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

  it("orders nearby items by distance when local focus is active", () => {
    const items = nearbyStoryItemsForGroups(
      [
        {
          id: "far",
          primary: article({
            id: "far",
            title: "Sak fra Orkanger",
            location: { lat: 63.312, lng: 9.853, label: "Orkanger" },
          }),
          articles: [],
          sourceLabels: ["NRK Trøndelag"],
        },
        {
          id: "near",
          primary: article({
            id: "near",
            title: "Sak fra Torvet",
            publishedAt: "2026-06-01T15:00:00.000Z",
            location: { lat: 63.4305, lng: 10.3951, label: "Torvet" },
          }),
          articles: [],
          sourceLabels: ["NRK Trøndelag"],
        },
      ],
      { limit: 2, localFocus: { lat: 63.4305, lng: 10.3951, radiusKm: 10 } },
    );

    expect(items.map((item) => item.id)).toEqual(["near", "far"]);
    expect(items[0]).toMatchObject({ withinLocalRadius: true, markerLabel: "1" });
    expect(items[1]?.distanceKm).toBeGreaterThan(20);
  });

  it("labels located crime stories separately from generic local news", () => {
    const items = nearbyStoryItems([
      article({
        id: "theft",
        title: "Tyveri på Solsiden",
        category: "Krim",
        location: { lat: 63.436, lng: 10.414, label: "Solsiden" },
      }),
      article({
        id: "meeting",
        title: "Åpent møte på biblioteket",
        category: "Nyheter",
        publishedAt: "2026-06-01T18:00:00.000Z",
        location: { lat: 63.43, lng: 10.39, label: "Midtbyen" },
      }),
    ]);

    expect(items[0]).toMatchObject({
      id: "theft",
      kind: "crime",
      relevanceLabel: "Politi og kriminalitet",
      locationLabel: "Solsiden",
    });
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
