import type { Article } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { groupHomeArticles } from "./homeArticleGroups.js";
import {
  homeStoryCardForGroup,
  homeStoryCardsForGroups,
  sourceClusterLabelForGroup,
} from "./homeStoryCards.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Tente på antibac i Trondheim",
    excerpt: "En mann i 50-åra spruta antibac på bakken og tente på det på Torvet i Trondheim.",
    url: "https://example.test/article",
    publishedAt: "2026-06-15T20:12:00.000Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Trondheim", "Torvet"],
    location: { lat: 63.4305, lng: 10.3951, label: "Torvet" },
    ...overrides,
  };
}

describe("home story cards", () => {
  it("summarizes clustered cross-source coverage as one public story card", () => {
    const coverageBundle = {
      id: "coverage:incident:torvet-antibac",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-15T18:13:00.000Z",
    } as const;
    const group = groupHomeArticles([
      article({ id: "nrk-antibac", coverageBundle }),
      article({
        id: "politiloggen-antibac",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Ro og orden: Trondheim, Torvet",
        excerpt:
          "Klokken 1846 fikk politiet inn en melding om en mann som sprutet antibac på bakken og tente på.",
        publishedAt: "2026-06-15T20:00:00.000Z",
        coverageBundle,
      }),
    ])[0]!;

    const card = homeStoryCardForGroup(group);

    expect(card.title).toBe("Tente på antibac i Trondheim");
    expect(card.sourceCount).toBe(2);
    expect(card.updateCount).toBe(2);
    expect(card.sourceSummary).toBe("2 kilder");
    expect(card.clusterLabel).toBe("2 kilder · samme hendelse på tvers av kilder");
    expect(card.cardKind).toBe("hendelse");
    expect(card.locationLabel).toBe("Torvet");
    expect(card.neighborhoodLabels).toEqual(["Torvet"]);
    expect(card.isClustered).toBe(true);
    expect(card.verification).toBeUndefined();
  });

  it("adds a public verification badge when DATEX and newsroom evidence back the story", () => {
    const group = groupHomeArticles([
      article({
        id: "adressa-e6",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kollisjon stenger E6",
        excerpt: "En kollisjon gjør at E6 er stengt.",
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
    ])[0]!;

    const card = homeStoryCardForGroup(group);

    expect(card.verification).toEqual({
      label: "Verifisert",
      detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
      sourceSummary: "Statens vegvesen DATEX + Adresseavisen",
      situationId: "datex-e6",
    });
  });

  it("uses specific places before broad geography labels", () => {
    const [card] = homeStoryCardsForGroups(
      groupHomeArticles([
        article({
          id: "sentrum",
          title: "Tyveri i Trondheim sentrum",
          places: ["Trondheim", "Sentrum"],
          location: { lat: 63.43209, lng: 10.3991, label: "Trondheim sentrum" },
        }),
      ]),
    );

    expect(card?.locationLabel).toBe("Trondheim sentrum");
    expect(card?.neighborhoodLabels).toEqual(["Trondheim sentrum", "Sentrum"]);
  });

  it("keeps single-source stories compact and unclustered", () => {
    const group = groupHomeArticles([
      article({
        id: "single",
        sourceLabel: "Adresseavisen",
        category: "Kultur",
        title: "Ny konsert på Byscenen",
        places: ["Trondheim"],
        location: undefined,
      }),
    ])[0]!;

    const card = homeStoryCardForGroup(group);

    expect(card.channelLabel).toBe("Kultur");
    expect(card.sourceSummary).toBe("Adresseavisen");
    expect(card.clusterLabel).toBeUndefined();
    expect(sourceClusterLabelForGroup(group)).toBeUndefined();
    expect(card.cardKind).toBe("sak");
    expect(card.isClustered).toBe(false);
  });
});
