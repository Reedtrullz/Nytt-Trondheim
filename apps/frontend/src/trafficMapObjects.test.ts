import type { TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { trafficMapObjectsForEvent } from "./trafficMapObjects.js";

const event: TrafficMapEvent = {
  id: "traffic-event-1",
  source: "vegvesen_traffic_info",
  sourceEventId: "1",
  category: "roadworks",
  severity: "medium",
  state: "active",
  title: "Veiarbeid på E6",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.39, 63.39],
      [10.41, 63.4],
    ],
  },
  relatedArticles: [
    {
      id: "article-1",
      title: "Kø ved E6",
      url: "https://example.test/article",
      distanceMeters: 120,
      location: { lat: 63.395, lng: 10.4, label: "E6" },
    },
  ],
};

describe("traffic map objects", () => {
  it("keeps official road geometry separate from estimated news points", () => {
    expect(trafficMapObjectsForEvent(event, { estimatedNews: true })).toEqual([
      expect.objectContaining({ kind: "official-road-event", eventId: "traffic-event-1" }),
      expect.objectContaining({
        kind: "estimated-news-location",
        eventId: "traffic-event-1",
        articleId: "article-1",
        center: [63.395, 10.4],
      }),
    ]);
  });

  it("omits estimated news points unless the layer is enabled", () => {
    expect(trafficMapObjectsForEvent(event, { estimatedNews: false })).toEqual([
      expect.objectContaining({ kind: "official-road-event" }),
    ]);
  });

  it("does not duplicate article-derived news events as related estimated points", () => {
    expect(
      trafficMapObjectsForEvent(
        {
          ...event,
          source: "news_article",
          sourceEventId: "article-1",
        },
        { estimatedNews: true },
      ),
    ).toEqual([expect.objectContaining({ kind: "official-road-event" })]);
  });

  it("ignores invalid estimated article coordinates", () => {
    const objects = trafficMapObjectsForEvent(
      {
        ...event,
        relatedArticles: [
          {
            id: "invalid-article",
            title: "Invalid",
            url: "https://example.test/invalid",
            distanceMeters: 50,
            location: { lat: 99, lng: 10.4, label: "Outside latitude range" },
          },
        ],
      },
      { estimatedNews: true },
    );

    expect(objects).toEqual([expect.objectContaining({ kind: "official-road-event" })]);
  });
});
