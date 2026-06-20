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

  it("groups same-bundle road-closing crash articles into one estimated traffic event", () => {
    const coverageBundle = {
      id: "coverage:e6-tiller-crash",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-20T10:15:00.000Z",
    };
    const first = article({ coverageBundle });
    const second = article({
      id: "article-e6-crash-nrk",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Kollisjon stenger E6 ved Tiller",
      excerpt: "Trafikken dirigeres etter trafikkulykke på E6.",
      url: "https://example.test/e6-crash-nrk",
      publishedAt: "2026-06-20T10:12:00.000Z",
      coverageBundle,
    });

    const [event] = roadClosingArticleTrafficEvents([first, second], {
      now: new Date("2026-06-20T11:00:00.000Z"),
    });

    expect(event).toMatchObject({
      id: "news-traffic:coverage:e6-tiller-crash",
      sourceEventId: "coverage:e6-tiller-crash",
      title: "Kollisjon stenger E6 ved Tiller",
      description:
        "Nyhetsrapportering fra flere kilder tyder på trafikkulykke med stengt eller sperret vei. Plasseringen er estimert fra sakene.",
      validFrom: "2026-06-20T10:00:00.000Z",
      updatedAt: "2026-06-20T10:12:00.000Z",
      relatedArticles: [
        expect.objectContaining({ id: "article-e6-crash-nrk" }),
        expect.objectContaining({ id: "article-e6-crash" }),
      ],
    });
    expect(roadClosingArticleTrafficEvents([first, second])).toHaveLength(1);
  });

  it("does not duplicate a matching official traffic event", () => {
    expect(
      roadClosingArticleTrafficEvents([article()], {
        officialEvents: [officialEvent()],
        now: new Date("2026-06-20T11:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  it("does not let expired official events suppress fresh estimated news events", () => {
    expect(
      roadClosingArticleTrafficEvents([article()], {
        officialEvents: [
          officialEvent({
            state: "expired",
            validTo: "2026-06-20T09:00:00.000Z",
          }),
        ],
        now: new Date("2026-06-20T11:00:00.000Z"),
      }),
    ).toHaveLength(1);
  });

  it("does not let a nearby unrelated high-impact official event suppress estimated news", () => {
    expect(
      roadClosingArticleTrafficEvents([article()], {
        officialEvents: [
          officialEvent({
            title: "Uhell ved Heimdal",
            locationName: "Heimdal",
            roadName: "Rv706",
            geometry: { type: "Point", coordinates: [10.4, 63.394] },
          }),
        ],
        now: new Date("2026-06-20T11:00:00.000Z"),
      }),
    ).toHaveLength(1);
  });

  it("suppresses estimated news when a close official event shares a road or place", () => {
    expect(
      roadClosingArticleTrafficEvents([article()], {
        officialEvents: [
          officialEvent({
            title: "Hendelse på E6",
            locationName: "Sluppen",
            roadName: "E6",
            geometry: { type: "Point", coordinates: [10.4, 63.394] },
          }),
        ],
        now: new Date("2026-06-20T11:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  it("skips a bundled estimate when one member already matches an official traffic event", () => {
    const coverageBundle = {
      id: "coverage:e6-tiller-crash",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-20T10:15:00.000Z",
    };

    expect(
      roadClosingArticleTrafficEvents(
        [
          article({ coverageBundle }),
          article({
            id: "article-e6-crash-nrk",
            source: "nrk",
            sourceLabel: "NRK Trøndelag",
            url: "https://example.test/e6-crash-nrk",
            coverageBundle,
          }),
        ],
        {
          officialEvents: [officialEvent()],
          now: new Date("2026-06-20T11:00:00.000Z"),
        },
      ),
    ).toEqual([]);
  });

  it("does not suppress a bundled estimate from one loosely nearby unrelated official event", () => {
    const coverageBundle = {
      id: "coverage:e6-tiller-crash",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-20T10:15:00.000Z",
    };

    expect(
      roadClosingArticleTrafficEvents(
        [
          article({ coverageBundle }),
          article({
            id: "article-e6-crash-nrk",
            source: "nrk",
            sourceLabel: "NRK Trøndelag",
            title: "Kollisjon stenger E6 ved Tiller",
            excerpt: "Trafikken dirigeres etter trafikkulykke på E6.",
            url: "https://example.test/e6-crash-nrk",
            publishedAt: "2026-06-20T10:12:00.000Z",
            coverageBundle,
          }),
        ],
        {
          officialEvents: [
            officialEvent({
              title: "Uhell ved Heimdal",
              locationName: "Heimdal",
              roadName: "Rv706",
              geometry: { type: "Point", coordinates: [10.4, 63.394] },
            }),
          ],
          now: new Date("2026-06-20T11:00:00.000Z"),
        },
      ),
    ).toHaveLength(1);
  });
});
