import type { Article, TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { roadClosingArticleTrafficEvents } from "../src/traffic/article-events.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-e6-crash",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Trafikkulykke stenger E6 ved Tiller",
    excerpt: "Politiet melder at veien er stengt etter en kollisjon.",
    url: "https://example.test/e6-crash",
    publishedAt: "2026-06-20T10:00:00.000Z",
    scope: "trondheim",
    category: "Transport",
    places: ["Tiller"],
    location: { lat: 63.39, lng: 10.39, label: "Tiller" },
    ...overrides,
  };
}

function officialEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "datex:e6-crash",
    source: "datex",
    sourceEventId: "datex-e6-crash",
    category: "accident",
    severity: "high",
    state: "active",
    title: "Ulykke på E6 ved Tiller",
    locationName: "Tiller",
    roadName: "E6",
    updatedAt: "2026-06-20T10:05:00.000Z",
    geometry: { type: "Point", coordinates: [10.3901, 63.3901] },
    ...overrides,
  };
}

describe("article-derived traffic map events", () => {
  it("creates an estimated closure event for road-closing crash news", () => {
    const [event] = roadClosingArticleTrafficEvents([article()], {
      now: new Date("2026-06-20T11:00:00.000Z"),
    });

    expect(event).toMatchObject({
      id: "news-traffic:article-e6-crash",
      source: "news_article",
      sourceEventId: "article-e6-crash",
      category: "closure",
      severity: "high",
      state: "active",
      title: "Trafikkulykke stenger E6 ved Tiller",
      locationName: "Tiller",
      roadName: "E6",
      confidence: 0.62,
      relatedArticles: [
        {
          id: "article-e6-crash",
          distanceMeters: 0,
          location: { lat: 63.39, lng: 10.39, label: "Tiller" },
        },
      ],
    });
    expect(event?.geometry).toEqual({ type: "Point", coordinates: [10.39, 63.39] });
  });

  it("skips transport articles without an active road closure signal", () => {
    expect(
      roadClosingArticleTrafficEvents([
        article({
          title: "Trafikkulykke på E6 ved Tiller",
          excerpt: "Trafikken går som normalt etter hendelsen.",
        }),
      ]),
    ).toEqual([]);
    expect(
      roadClosingArticleTrafficEvents([
        article({ category: "Hendelser", title: "Ulykke i Trondheim sentrum" }),
      ]),
    ).toEqual([]);
  });

  it("marks stale article estimates expired instead of keeping them active forever", () => {
    expect(
      roadClosingArticleTrafficEvents([article()], {
        now: new Date("2026-06-20T18:01:00.000Z"),
      })[0],
    ).toMatchObject({ state: "expired" });
  });

  it("does not duplicate a matching official traffic event", () => {
    expect(
      roadClosingArticleTrafficEvents([article()], {
        officialEvents: [officialEvent()],
        now: new Date("2026-06-20T11:00:00.000Z"),
      }),
    ).toEqual([]);
  });
});
