import type { Article, HomeSituationSummary } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import {
  nearbyDistanceLabel,
  nearbyStoryItems,
  nearbyStoryItemsForGroupsAndSituations,
  nearbyStoryItemsForGroups,
  nearbyStorySummary,
} from "./homeNearby.js";

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

function situation(overrides: Partial<HomeSituationSummary> = {}): HomeSituationSummary {
  return {
    id: "datex-gangasvegen",
    title: "Steinsprang/steinsprang, vegen er stengt",
    summary: "Gangåsvegen er stengt.",
    status: "active",
    verificationStatus: "Offentlig bekreftet",
    updatedAt: "2026-07-02T09:00:00.000Z",
    createdAt: "2026-07-02T08:30:00.000Z",
    locationLabel: "Gangåsvegen",
    primaryLocation: { lat: 63.311, lng: 10.21, label: "Gangåsvegen" },
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
      "1 av 3 stedsfestede saker og situasjoner.",
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

  it("formats nearby distance labels for local-focus explanations", () => {
    expect(nearbyDistanceLabel(undefined)).toBeUndefined();
    expect(nearbyDistanceLabel(Number.NaN)).toBeUndefined();
    expect(nearbyDistanceLabel(0.4)).toBe("under 1 km unna");
    expect(nearbyDistanceLabel(2.25)).toBe("2,3 km unna");
    expect(nearbyDistanceLabel(14.6)).toBe("15 km unna");
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

  it("carries public verification and source confidence into nearby map items", () => {
    const items = nearbyStoryItems([
      article({
        id: "adressa-e6",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kollisjon stenger E6",
        category: "Transport",
        publicVerification: {
          status: "verified",
          label: "Verifisert",
          detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
          officialSources: ["datex"],
          reportingSources: ["adressa"],
          situationId: "datex-e6",
        },
      }),
    ]);

    expect(items[0]).toMatchObject({
      verification: {
        label: "Verifisert",
        sourceSummary: "Statens vegvesen DATEX + Adresseavisen",
        situationId: "datex-e6",
      },
      sourceConfidence: {
        level: "confirmed",
        label: "Bekreftet",
        sourceCount: 2,
      },
    });
  });

  it("adds official active situations to the nearby map even without matching articles", () => {
    const items = nearbyStoryItemsForGroupsAndSituations([], [situation()], { limit: 4 });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "situation:datex-gangasvegen",
      situationId: "datex-gangasvegen",
      markerLabel: "1",
      title: "Steinsprang/steinsprang, vegen er stengt",
      locationLabel: "Gangåsvegen",
      sourceLabel: "Offentlig bekreftet",
      category: "Hendelser",
      kind: "situation",
      relevanceLabel: "Tilknyttet situasjon",
      verification: {
        label: "Bekreftet",
        sourceSummary: "Offentlig bekreftet situasjon",
      },
      sourceConfidence: {
        level: "confirmed",
        label: "Bekreftet",
      },
    });
  });

  it("does not duplicate a situation when a nearby article already links to it", () => {
    const linkedArticle = article({
      id: "article-gangasvegen",
      title: "Ras kan stenge vegen i flere uker",
      category: "Transport",
      location: { lat: 63.311, lng: 10.21, label: "Gangåsvegen" },
      situationId: "datex-gangasvegen",
    });

    const items = nearbyStoryItemsForGroupsAndSituations(
      [
        {
          id: "article-gangasvegen",
          primary: linkedArticle,
          articles: [linkedArticle],
          sourceLabels: ["Adresseavisen"],
        },
      ],
      [situation()],
      { limit: 4 },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "article-gangasvegen",
      situationId: "datex-gangasvegen",
      title: "Ras kan stenge vegen i flere uker",
    });
  });

  it("filters public map items by latest article or situation update time", () => {
    const freshArticle = article({
      id: "fresh-article",
      title: "Fersk trafikkhendelse ved Sluppen",
      category: "Transport",
      publishedAt: "2026-07-02T09:45:00.000Z",
      location: { lat: 63.39, lng: 10.4, label: "Sluppen" },
    });
    const staleArticle = article({
      id: "stale-article",
      title: "Gammel hendelse på Lade",
      publishedAt: "2026-07-01T07:00:00.000Z",
      location: { lat: 63.443, lng: 10.447, label: "Lade" },
    });
    const stalePrimaryFreshUpdate = article({
      id: "stale-primary",
      title: "Oppdatert sak ved Moholt",
      publishedAt: "2026-07-01T06:00:00.000Z",
      location: { lat: 63.413, lng: 10.433, label: "Moholt" },
    });
    const freshUpdate = article({
      id: "fresh-update",
      title: "Ny oppdatering ved Moholt",
      publishedAt: "2026-07-02T09:30:00.000Z",
      location: { lat: 63.413, lng: 10.433, label: "Moholt" },
    });

    const items = nearbyStoryItemsForGroupsAndSituations(
      [
        {
          id: "fresh-group",
          primary: freshArticle,
          articles: [freshArticle],
          sourceLabels: ["NRK Trøndelag"],
        },
        {
          id: "stale-group",
          primary: staleArticle,
          articles: [staleArticle],
          sourceLabels: ["Adresseavisen"],
        },
        {
          id: "updated-group",
          primary: stalePrimaryFreshUpdate,
          articles: [stalePrimaryFreshUpdate, freshUpdate],
          sourceLabels: ["Adresseavisen", "NRK Trøndelag"],
        },
      ],
      [
        situation({
          id: "fresh-situation",
          updatedAt: "2026-07-02T09:15:00.000Z",
          createdAt: "2026-07-01T08:00:00.000Z",
        }),
        situation({
          id: "stale-situation",
          updatedAt: "2026-07-01T07:30:00.000Z",
          createdAt: "2026-07-01T06:00:00.000Z",
        }),
      ],
      { limit: 10, from: "2026-07-02T08:00:00.000Z" },
    );

    expect(items.map((item) => item.id)).toEqual([
      "situation:fresh-situation",
      "fresh-group",
      "updated-group",
    ]);
    expect(items.map((item) => item.markerLabel)).toEqual(["1", "2", "3"]);
  });
});
