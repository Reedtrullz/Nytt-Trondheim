import type { Article, TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { relatedTrafficArticlesForEvent } from "../src/traffic/related-articles.js";

function trafficEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "traffic-event-1",
    source: "vegvesen_traffic_info",
    sourceEventId: "NPRA_HBT_1",
    category: "accident",
    severity: "medium",
    state: "active",
    title: "Trafikkhendelse på E6 ved Tiller",
    locationName: "Tiller",
    roadName: "E6",
    updatedAt: "2026-05-29T12:00:00.000Z",
    geometry: { type: "Point", coordinates: [10.4, 63.4] },
    ...overrides,
  };
}

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Kø på E6 ved Tiller",
    excerpt: "Trafikken går sakte.",
    url: "https://example.test/articles/1",
    publishedAt: "2026-05-29T12:05:00.000Z",
    scope: "trondheim",
    category: "Transport",
    places: ["Tiller"],
    location: { lat: 63.406, lng: 10.4, label: "Tiller" },
    ...overrides,
  };
}

describe("relatedTrafficArticlesForEvent", () => {
  it("relates an article within 1000 meters of a point event when text hints overlap", () => {
    const related = relatedTrafficArticlesForEvent(trafficEvent(), [article()]);

    expect(related).toHaveLength(1);
    expect(related[0]).toMatchObject({
      id: "article-1",
      title: "Kø på E6 ved Tiller",
      url: "https://example.test/articles/1",
    });
    expect(related[0]?.distanceMeters).toBeLessThan(1_000);
  });

  it("does not relate an article 2500 meters away", () => {
    const related = relatedTrafficArticlesForEvent(trafficEvent(), [
      article({ location: { lat: 63.425, lng: 10.4, label: "Tiller" } }),
    ]);

    expect(related).toEqual([]);
  });

  it("does not match unrelated roadworks just because both mention Trondheim", () => {
    const event = trafficEvent({
      category: "roadworks",
      severity: "medium",
      title: "Veiarbeid ved Ila i Trondheim",
      locationName: "Ila, Trondheim",
      roadName: undefined,
      geometry: { type: "Point", coordinates: [10.381, 63.431] },
    });
    const unrelated = article({
      id: "article-trondheim",
      title: "Ny trafikkplan for Trondheim sentrum",
      places: ["Trondheim"],
      location: { lat: 63.432, lng: 10.382, label: "Trondheim sentrum" },
    });

    expect(relatedTrafficArticlesForEvent(event, [unrelated])).toEqual([]);
  });

  it("relates a LineString event to a nearby article using segment distance", () => {
    const event = trafficEvent({
      category: "roadworks",
      severity: "medium",
      title: "Veiarbeid på rv706 ved Ila",
      locationName: "Ila",
      roadName: "Rv706",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.37, 63.43],
          [10.41, 63.43],
        ],
      },
    });
    const nearby = article({
      id: "article-line",
      title: "Forsinkelser på Rv706 ved Ila",
      places: ["Ila"],
      location: { lat: 63.4315, lng: 10.39, label: "Ila" },
    });

    const related = relatedTrafficArticlesForEvent(event, [nearby]);

    expect(related).toHaveLength(1);
    expect(related[0]).toMatchObject({ id: "article-line" });
    expect(related[0]?.distanceMeters).toBeLessThan(750);
  });
});
