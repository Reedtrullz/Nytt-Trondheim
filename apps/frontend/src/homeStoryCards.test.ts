import type { Article, ArticleCoverageEdge, CityPulseStory } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { groupHomeArticles } from "./homeArticleGroups.js";
import {
  coverageMatchExplanation,
  homeArticleGroupForStory,
  homeStoryCardForGroup,
  homeStoryCardForStory,
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

function directStrongIncidentEdge(left: string, right: string): ArticleCoverageEdge {
  return {
    articleIds: [left, right].sort() as [string, string],
    tier: "strong",
    score: 0.95,
    kind: "incident",
    positiveIncidentEvidence: [],
    signals: [],
    conflicts: [],
    evidenceFingerprint: `v2:${left}:${right}`,
    reviewable: false,
    correctionConflict: false,
  };
}

describe("home story cards", () => {
  it("keeps article count, unique source count, and match rationale distinct", () => {
    const coverageBundle = {
      id: "coverage:v2:counted-group",
      kind: "incident",
      confidence: "medium",
      reason: "Samme hendelse",
      generatedAt: "2026-07-12T21:00:00.000Z",
      matcherVersion: "v2",
      matchConfidence: {
        tier: "moderate",
        score: 0.76,
        rationale: "Felles sted og hendelsestype",
      },
    } as const;
    const group = groupHomeArticles([
      article({ id: "nrk-a", coverageBundle }),
      article({ id: "nrk-b", url: "https://example.test/nrk-b", coverageBundle }),
      article({
        id: "adressa-a",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        url: "https://example.test/adressa-a",
        coverageBundle,
      }),
    ])[0]!;

    const card = homeStoryCardForGroup(group);

    expect(card.articleCount).toBe(3);
    expect(card.sourceCount).toBe(2);
    expect(card.matchRationale).toBe("Felles sted og hendelsestype");
    expect(coverageMatchExplanation(card)).toBe("Felles sted og hendelsestype");
  });

  it("keeps moderate match confidence separate from newsroom source trust", () => {
    const coverageBundle = {
      id: "coverage:v2:construction-fire",
      kind: "incident",
      confidence: "medium",
      reason: "Samme hendelse",
      generatedAt: "2026-07-12T21:00:00.000Z",
      matcherVersion: "v2",
      matchConfidence: {
        tier: "moderate",
        score: 0.72,
        rationale: "Støttesaken er tatt inn gjennom hovedsak eller flertallstreff.",
      },
    } as const;
    const group = groupHomeArticles([
      article({
        id: "nrk-fire",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        coverageBundle,
      }),
      article({
        id: "adressa-fire",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        url: "https://example.test/adressa-fire",
        coverageBundle,
      }),
    ])[0]!;
    const card = homeStoryCardForGroup(group);

    expect(card.matchConfidence).toMatchObject({ tier: "moderate", score: 0.72 });
    expect(card.sourceConfidence.level).toBe("likely");
  });

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
    group.acceptedEdges = [directStrongIncidentEdge("nrk-antibac", "politiloggen-antibac")];

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
    expect(card.sourceConfidence).toMatchObject({
      level: "confirmed",
      label: "Bekreftet",
      score: 0.98,
      sourceCount: 2,
    });
    expect(card.sourceConfidence.rationale).toContain("Offisielle kilder");
    expect(card.verification).toEqual({
      label: "Verifisert",
      detail: "Bekreftet av Politiloggen og NRK.",
      sourceSummary: "Politiloggen + NRK",
    });
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
    expect(card.sourceConfidence).toMatchObject({
      level: "confirmed",
      label: "Bekreftet",
      sourceCount: 2,
    });
  });

  it("adds a public verification badge when Politiloggen and newsroom evidence back the story", () => {
    const group = groupHomeArticles([
      article({
        id: "adressa-lade",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Ung mann kritisk skadd på Lade",
        excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
        category: "Krim",
        publicVerification: {
          status: "verified",
          label: "Verifisert",
          detail: "Bekreftet av Politiloggen og Adresseavisen.",
          officialSources: ["politiloggen"],
          reportingSources: ["adressa"],
          situationId: "politiloggen-lade-vold",
        },
      }),
    ])[0]!;

    const card = homeStoryCardForGroup(group);

    expect(card.verification).toEqual({
      label: "Verifisert",
      detail: "Bekreftet av Politiloggen og Adresseavisen.",
      sourceSummary: "Politiloggen + Adresseavisen",
      situationId: "politiloggen-lade-vold",
    });
    expect(card.sourceConfidence).toMatchObject({
      level: "confirmed",
      label: "Bekreftet",
      sourceCount: 2,
    });
  });

  it("derives a public verification badge for official-plus-news incident clusters", () => {
    const coverageBundle = {
      id: "coverage:incident:lade-vold",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-15T18:13:00.000Z",
    } as const;
    const group = groupHomeArticles([
      article({
        id: "adressa-lade-vold",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Ung mann kritisk skadd på Lade",
        excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
        category: "Krim",
        coverageBundle,
      }),
      article({
        id: "politiloggen-lade-vold",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Voldshendelse: Trondheim, Lade",
        excerpt: "En person er kritisk skadet etter en voldshendelse på Lade.",
        category: "Krim",
        publishedAt: "2026-06-15T20:08:00.000Z",
        situationId: "politiloggen-lade-vold",
        coverageBundle,
      }),
    ])[0]!;
    group.acceptedEdges = [directStrongIncidentEdge("adressa-lade-vold", "politiloggen-lade-vold")];

    const card = homeStoryCardForGroup(group);

    expect(card.verification).toEqual({
      label: "Verifisert",
      detail: "Bekreftet av Politiloggen og Adresseavisen.",
      sourceSummary: "Politiloggen + Adresseavisen",
      situationId: "politiloggen-lade-vold",
    });
    expect(card.sourceConfidence).toMatchObject({
      level: "confirmed",
      label: "Bekreftet",
      sourceCount: 2,
    });
  });

  it("does not derive public verification badges for topical official-plus-news bundles", () => {
    const coverageBundle = {
      id: "coverage:topic:politiet-statistikk",
      kind: "topic",
      confidence: "high",
      reason: "Samme tema over tid",
      generatedAt: "2026-06-15T18:13:00.000Z",
    } as const;
    const group = groupHomeArticles([
      article({
        id: "nrk-statistikk",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Politiet melder om rolig natt",
        excerpt: "Flere medier omtaler politiets oppsummering av natta.",
        category: "Nyheter",
        coverageBundle,
      }),
      article({
        id: "politiloggen-statistikk",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Oppsummering: Trondheim",
        excerpt: "Politiet oppsummerer nattens hendelser i Trondheim.",
        category: "Nyheter",
        publishedAt: "2026-06-15T20:08:00.000Z",
        coverageBundle,
      }),
    ])[0]!;

    expect(homeStoryCardForGroup(group).verification).toBeUndefined();
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

  it("does not show multiple distant place pills for a single unlocated regional story", () => {
    const group = groupHomeArticles([
      article({
        id: "regional-roundup",
        title: "To tatt for promillekjøring",
        excerpt: "I Namsos og Melhus kan to bilførere bli uten førerkort etter kontroller i natt.",
        scope: "trondelag",
        places: ["Melhus", "Namsos"],
        location: undefined,
      }),
    ])[0]!;

    const card = homeStoryCardForGroup(group);

    expect(card.locationLabel).toBe("Flere steder");
    expect(card.neighborhoodLabels).toEqual(["Flere steder"]);
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
    expect(card.sourceConfidence).toMatchObject({
      level: "uncertain",
      label: "Usikker",
      sourceCount: 1,
    });
  });

  it("surfaces RBK as a local football club topic on Sport story cards", () => {
    const group = groupHomeArticles([
      article({
        id: "rbk-profile",
        source: "nidaros",
        sourceLabel: "Nidaros",
        title: "Ukas eiendomsoverdragelser: RBK-profil har kjøpt seg ny bolig",
        excerpt: "Det har vært stor aktivitet i eiendomsmarkedet i Trondheim den siste uken.",
        category: "Sport",
        topics: ["rosenborg"],
        places: ["Trondheim"],
        location: undefined,
      }),
    ])[0]!;

    const card = homeStoryCardForGroup(group);

    expect(card.channelLabel).toBe("Sport");
    expect(card.topicLabels).toEqual(["RBK"]);
  });

  it("builds public story cards directly from City Pulse story objects", () => {
    const coverageBundle = {
      id: "coverage:incident:city-pulse-story-card",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-15T18:13:00.000Z",
    } as const;
    const publicVerification: NonNullable<Article["publicVerification"]> = {
      status: "verified",
      label: "Verifisert",
      detail: "Bekreftet av Politiloggen og Adresseavisen.",
      officialSources: ["politiloggen"],
      reportingSources: ["adressa"],
      situationId: "politiloggen-torvet-antibac",
    };
    const story: CityPulseStory = {
      id: "coverage:incident:city-pulse-story-card",
      primaryArticleId: "adressa-antibac",
      articleIds: ["adressa-antibac", "politiloggen-antibac"],
      primary: article({
        id: "adressa-antibac",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Mann tente på antibac på Torvet",
      }),
      articles: [
        article({
          id: "adressa-antibac",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Mann tente på antibac på Torvet",
        }),
        article({
          id: "politiloggen-antibac",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Ro og orden: Trondheim, Torvet",
          publishedAt: "2026-06-15T20:00:00.000Z",
        }),
      ],
      sourceLabels: ["Adresseavisen", "Politiloggen"],
      sourceCount: 2,
      updateCount: 2,
      latestAt: "2026-06-15T20:12:00.000Z",
      category: "Hendelser",
      coverageBundle,
      publicVerification,
    };

    const group = homeArticleGroupForStory(story);
    const card = homeStoryCardForStory(story);

    expect(group.bundle).toBe(coverageBundle);
    expect(group.articles.every((item) => item.coverageBundle === coverageBundle)).toBe(true);
    expect(group.articles.every((item) => item.publicVerification === publicVerification)).toBe(
      true,
    );
    expect(card.id).toBe(story.id);
    expect(card.sourceCount).toBe(2);
    expect(card.updateCount).toBe(2);
    expect(card.clusterLabel).toBe("2 kilder · samme hendelse på tvers av kilder");
    expect(card.cardKind).toBe("hendelse");
    expect(card.verification).toEqual({
      label: "Verifisert",
      detail: "Bekreftet av Politiloggen og Adresseavisen.",
      sourceSummary: "Politiloggen + Adresseavisen",
      situationId: "politiloggen-torvet-antibac",
    });
  });

  it("shows selected editorial copy while preserving the newest story timestamp", () => {
    const newsroom = article({
      id: "nrk-editorial",
      title: "Politiet rykket ut etter slagsmål på Saupstad",
      excerpt:
        "Flere patruljer rykket til Saupstad etter melding om slagsmål. Ingen ble alvorlig skadet.",
      publishedAt: "2026-07-15T02:50:00.000Z",
      category: "Nyheter",
    });
    const newest = article({
      id: "politiloggen-newest",
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Ro og orden: Saupstad",
      excerpt: "Politiet har kontroll på stedet.",
      publishedAt: "2026-07-15T03:00:00.000Z",
    });
    const story: CityPulseStory = {
      id: "coverage:incident:editorial-card",
      primaryArticleId: newest.id,
      articleIds: [newest.id, newsroom.id],
      primary: newest,
      articles: [newest, newsroom],
      sourceLabels: ["Politiloggen", "NRK Trøndelag"],
      sourceCount: 2,
      updateCount: 2,
      latestAt: newest.publishedAt,
      category: newsroom.category,
      editorialSelection: {
        articleId: newsroom.id,
        strategy: "best-source-v1",
        rationale: "newsroom_complete",
      },
    };

    const card = homeStoryCardForStory(story);

    expect(card.primary.id).toBe(newsroom.id);
    expect(card.title).toBe(newsroom.title);
    expect(card.excerpt).toBe(newsroom.excerpt);
    expect(card.category).toBe("Nyheter");
    expect(card.latestAt).toBe(newest.publishedAt);
  });

  it("can use a title and ingress from different supported source articles", () => {
    const titleArticle = article({
      id: "adressa-specific-title",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Beboere evakuert etter brann i leilighet på Heimdal",
      excerpt: "Adresseavisen arbeider etter Vær Varsom-plakaten og Redaktøransvar.",
      category: "Nyheter",
    });
    const ingressArticle = article({
      id: "politiloggen-useful-ingress",
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Brann: Trondheim, Heimdal",
      excerpt: "Nødetatene er på Heimdal etter melding om røyk fra en leilighet.",
      publishedAt: "2026-07-15T03:10:00.000Z",
    });
    const story: CityPulseStory = {
      id: "coverage:incident:independent-copy",
      primaryArticleId: ingressArticle.id,
      articleIds: [ingressArticle.id, titleArticle.id],
      primary: ingressArticle,
      articles: [ingressArticle, titleArticle],
      sourceLabels: ["Politiloggen", "Adresseavisen"],
      sourceCount: 2,
      updateCount: 2,
      latestAt: ingressArticle.publishedAt,
      category: titleArticle.category,
    };

    const card = homeStoryCardForStory(story);

    expect(card.primary.id).toBe(titleArticle.id);
    expect(card.title).toBe(titleArticle.title);
    expect(card.excerpt).toBe(ingressArticle.excerpt);
    expect(card.category).toBe(titleArticle.category);
    expect(card.editorialCopy).toMatchObject({
      version: 1,
      title: { articleId: titleArticle.id },
      ingress: { articleId: ingressArticle.id },
    });
  });
});
