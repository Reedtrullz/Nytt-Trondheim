import type { Article } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { nearbyStoryItems } from "./homeNearby.js";
import { clusterNearbyStoryItems } from "./newsMapClusters.js";

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

describe("news map marker clustering", () => {
  it("clusters nearby story positions into one count marker", () => {
    const items = nearbyStoryItems(
      [
        article({
          id: "torvet-1",
          title: "Sak ved Torvet",
          publishedAt: "2026-06-01T17:00:00.000Z",
          location: { lat: 63.4, lng: 10.4, label: "Torvet" },
        }),
        article({
          id: "torvet-2",
          title: "Oppdatering ved Torvet",
          publishedAt: "2026-06-01T16:00:00.000Z",
          location: { lat: 63.4007, lng: 10.4005, label: "Torvet" },
        }),
        article({
          id: "lade",
          title: "Sak fra Lade",
          publishedAt: "2026-06-01T15:00:00.000Z",
          location: { lat: 63.444, lng: 10.44, label: "Lade" },
        }),
      ],
      { limit: 3 },
    );

    const clusters = clusterNearbyStoryItems(items, { radiusMeters: 180 });

    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({
      markerLabel: "2",
      id: "cluster:torvet-1|torvet-2",
      selected: false,
    });
    expect(clusters[0]?.title).toContain("2 saker nær Torvet");
    expect(clusters[1]).toMatchObject({ markerLabel: "3", id: "lade" });
  });

  it("marks a cluster as selected when it contains the selected story", () => {
    const items = nearbyStoryItems(
      [
        article({ id: "one", title: "Første sak" }),
        article({
          id: "two",
          title: "Andre sak",
          location: { lat: 63.4004, lng: 10.4002, label: "Sluppen" },
        }),
      ],
      { limit: 2 },
    );

    const [cluster] = clusterNearbyStoryItems(items, { selectedId: "two" });

    expect(cluster).toMatchObject({
      markerLabel: "2",
      selected: true,
      kind: "local",
    });
  });

  it("keeps distant neighborhoods as separate markers", () => {
    const items = nearbyStoryItems(
      [
        article({ id: "sentrum", title: "Sak i sentrum" }),
        article({
          id: "tiller",
          title: "Sak på Tiller",
          location: { lat: 63.34, lng: 10.42, label: "Tiller" },
        }),
      ],
      { limit: 2 },
    );

    const clusters = clusterNearbyStoryItems(items, { radiusMeters: 500 });

    expect(clusters.map((cluster) => cluster.id)).toEqual(["sentrum", "tiller"]);
  });
});
