import { describe, expect, it } from "vitest";
import type { Article } from "../src/index.js";
import {
  analyzeArticleCoverage,
  analyzeArticleCoverageV2,
  articleCoverageEdge,
  articleCoverageEvidence,
  buildCityPulseStories,
  entityBackedNotificationFollowUpPolicy,
  evaluateArticleCoverageCorpus,
  fatalTrafficFollowUpPolicy,
  groupHomeArticles,
  highDetailNearDuplicatePolicy,
  isFatalTrafficIncidentFollowUp,
  isHighInformationTrafficCollisionMatch,
  isEntityBackedNotificationFailureFollowUp,
  isHighDetailCrossSourceNearDuplicate,
} from "../src/index.js";
import { articleCoverageGoldenCases } from "./fixtures/article-coverage-golden.js";

function regressionArticle(id: string, overrides: Partial<Article>): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: "",
    url: `https://example.test/${id}`,
    publishedAt: "2026-07-14T10:00:00.000Z",
    scope: "trondheim",
    category: "Krim",
    places: ["Trondheim"],
    ...overrides,
  };
}

function noSignalPropertyBridgeArticles(prefix = "no-signal"): [Article, Article, Article] {
  const storageExcerpt =
    "Gjerdet var klippet og hengelåsen knust. Blå sykkel, hjelm, verktøy, batteri og lader forsvant fra sameiet i kjelleren.";
  const shopExcerpt =
    "Gjerningspersonen tok frokostblanding, kaffe, ost, brød, melk, yoghurt, juice og kjøtt fra kassen ved en handlevogn.";
  return [
    regressionArticle(`${prefix}-storage`, {
      source: "nrk",
      title: "Brøt seg inn i bod",
      excerpt: storageExcerpt,
      publishedAt: "2026-07-14T10:01:00.000Z",
    }),
    regressionArticle(`${prefix}-shop`, {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Stjal fra butikk",
      excerpt: shopExcerpt,
      publishedAt: "2026-07-14T10:00:00.000Z",
    }),
    regressionArticle(`${prefix}-unknown`, {
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Melding fra Trondheim",
      excerpt: `${storageExcerpt} ${shopExcerpt}`,
      category: "Hendelser",
      publishedAt: "2026-07-14T10:02:00.000Z",
    }),
  ];
}

describe("coverage matcher golden corpus", () => {
  it("passes all critical expectations deterministically", () => {
    const result = evaluateArticleCoverageCorpus(articleCoverageGoldenCases, (articles, fixture) =>
      analyzeArticleCoverageV2(articles, "2026-07-12T21:00:00.000Z", {
        rejectedPairs: fixture.rejectedPairs ?? [],
      }),
    );
    expect(result.criticalFailures).toEqual([]);
    expect(result.falsePositivePairs).toBe(0);
    expect(result.falseNegativePairs).toBe(0);
    expect(result.pairPrecision).toBe(1);
    expect(result.pairRecall).toBe(1);
    expect(result.groupPrecision).toBe(1);
    expect(result.bridgeErrorCount).toBe(0);
    if (result.labelledPairCount >= 100) {
      expect(result.pairPrecision).toBeGreaterThanOrEqual(0.98);
      expect(result.pairRecall).toBeGreaterThanOrEqual(0.9);
      expect(result.groupingCoverage).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("groups the Dora reporting in both the live legacy and v2 matchers", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "dora-boat-high-detail-near-duplicate",
    );
    expect(fixture).toBeDefined();
    const expectedMembers = ["dora-adressa", "dora-nrk", "dora-police"];

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const analysis = analyze(fixture!.articles, "2026-07-13T20:00:00.000Z");
      expect(
        analysis.bundles.map(({ memberArticleIds }) => [...memberArticleIds].sort()),
      ).toContainEqual(expectedMembers);
      expect(
        analysis.bundles.some(({ memberArticleIds }) =>
          memberArticleIds.includes("other-boat-control"),
        ),
      ).toBe(false);
    }

    const police = fixture!.articles.find(({ id }) => id === "dora-police")!;
    const newsroom = fixture!.articles.find(({ id }) => id === "dora-nrk")!;
    const unrelated = fixture!.articles.find(({ id }) => id === "other-boat-control")!;
    expect(isHighDetailCrossSourceNearDuplicate(police, newsroom)).toBe(true);
    expect(isHighDetailCrossSourceNearDuplicate(police, unrelated)).toBe(false);
    expect(
      isHighDetailCrossSourceNearDuplicate(police, {
        ...newsroom,
        source: "politiloggen",
      }),
    ).toBe(false);
    expect(
      isHighDetailCrossSourceNearDuplicate(police, {
        ...newsroom,
        publishedAt: "2026-07-13T19:35:00.000Z",
      }),
    ).toBe(false);

    const corrected = analyzeArticleCoverageV2(fixture!.articles, "2026-07-13T20:00:00.000Z", {
      rejectedPairs: [
        {
          articleIds: ["dora-police", "dora-nrk"],
          correctionId: "sanitized-dora-split",
        },
      ],
    });
    expect(
      corrected.bundles.some(
        ({ memberArticleIds }) =>
          memberArticleIds.includes("dora-police") && memberArticleIds.includes("dora-nrk"),
      ),
    ).toBe(false);
  });

  it("keeps generic cross-source boilerplate outside the high-detail policy", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "generic-boilerplate-is-not-high-detail",
    );
    expect(fixture).toBeDefined();
    const [left, right] = fixture!.articles;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    const evidence = articleCoverageEvidence(left!, right!, "v2");
    expect(evidence.sharedBodyTokenCount).toBeGreaterThanOrEqual(
      highDetailNearDuplicatePolicy.minBodyOverlap,
    );
    expect(evidence.bodyScore).toBeGreaterThanOrEqual(highDetailNearDuplicatePolicy.minBodyScore);
    expect(evidence.bodyScore).toBeLessThan(0.5);
    expect(evidence.sharedDistinctiveTokenCount).toBeLessThan(
      highDetailNearDuplicatePolicy.minDistinctiveOverlap,
    );
    expect(isHighDetailCrossSourceNearDuplicate(left!, right!)).toBe(false);

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const analysis = analyze(fixture!.articles, "2026-07-13T20:10:00.000Z");
      expect(
        analysis.bundles.some(({ memberArticleIds }) =>
          [left!.id, right!.id].every((id) => memberArticleIds.includes(id)),
        ),
      ).toBe(false);
    }
  });

  it("groups a fatal traffic follow-up despite victim-home and crash-place angles", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "fatal-traffic-follow-up-across-place-angles",
    );
    expect(fixture).toBeDefined();
    const expectedMembers = ["grong-follow-up", "grong-primary"];

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const analysis = analyze(fixture!.articles, "2026-07-13T12:30:00.000Z");
      expect(
        analysis.bundles.map(({ memberArticleIds }) => [...memberArticleIds].sort()),
      ).toContainEqual(expectedMembers);
      expect(
        analysis.bundles.some(({ memberArticleIds }) =>
          memberArticleIds.includes("other-e6-fatality"),
        ),
      ).toBe(false);
    }

    const primary = fixture!.articles.find(({ id }) => id === "grong-primary")!;
    const followUp = fixture!.articles.find(({ id }) => id === "grong-follow-up")!;
    const unrelated = fixture!.articles.find(({ id }) => id === "other-e6-fatality")!;
    expect(isFatalTrafficIncidentFollowUp(primary, followUp)).toBe(true);
    expect(isFatalTrafficIncidentFollowUp(primary, unrelated)).toBe(false);
    expect(
      isFatalTrafficIncidentFollowUp(primary, {
        ...followUp,
        source: "t_a",
      }),
    ).toBe(false);
    expect(
      isFatalTrafficIncidentFollowUp(primary, {
        ...followUp,
        publishedAt: new Date(
          Date.parse(primary.publishedAt) + fatalTrafficFollowUpPolicy.windowMs + 1,
        ).toISOString(),
      }),
    ).toBe(false);
  });

  it("groups the Rotvoll collision only on the exact street, clock and participant fingerprint", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "rotvoll-collision-exact-street-clock-and-participants",
    );
    expect(fixture).toBeDefined();
    const expectedMembers = ["rotvoll-adressa", "rotvoll-nidaros", "rotvoll-nrk", "rotvoll-police"];
    const permutations = [
      fixture!.articles,
      [...fixture!.articles].reverse(),
      [...fixture!.articles.slice(3), ...fixture!.articles.slice(0, 3)],
    ];

    const articlesById = new Map(fixture!.articles.map((article) => [article.id, article]));
    const conflictingLocalities = articleCoverageEvidence(
      articlesById.get("rotvoll-police")!,
      articlesById.get("rotvoll-adressa")!,
      "v2",
    );
    expect(conflictingLocalities.positiveIncidentEvidence).toContain(
      "shared_high_information_traffic_collision",
    );
    expect(conflictingLocalities.conflicts).not.toContainEqual(
      expect.objectContaining({ kind: "specific_place" }),
    );

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      for (const articles of permutations) {
        const bundles = analyze(articles, "2026-07-14T17:00:00.000Z").bundles;
        expect(bundles.map(({ memberArticleIds }) => [...memberArticleIds].sort())).toContainEqual(
          expectedMembers,
        );
      }
    }

    const newsroom = articlesById.get("rotvoll-nrk")!;
    const police = articlesById.get("rotvoll-police")!;
    const adressa = articlesById.get("rotvoll-adressa")!;
    expect(isHighInformationTrafficCollisionMatch(newsroom, police)).toBe(false);
    expect(isHighInformationTrafficCollisionMatch(police, adressa)).toBe(true);
    expect(
      isHighInformationTrafficCollisionMatch(
        { ...police, publishedAt: "2026-07-14T15:26:00.000Z" },
        adressa,
      ),
    ).toBe(false);
    expect(
      isHighInformationTrafficCollisionMatch(
        { ...police, source: "nrk", situationId: null },
        adressa,
      ),
    ).toBe(false);
    expect(
      isHighInformationTrafficCollisionMatch(
        { ...police, excerpt: `${police.excerpt} Meldingen kom kl. 17.26.` },
        adressa,
      ),
    ).toBe(false);
    expect(
      isHighInformationTrafficCollisionMatch(police, {
        ...adressa,
        title: "Fire personer involvert i ulykke",
        excerpt: adressa.excerpt.replaceAll("Fem personer", "Fire personer"),
      }),
    ).toBe(false);
    expect(
      isHighInformationTrafficCollisionMatch(newsroom, { ...police, source: newsroom.source }),
    ).toBe(false);
    expect(
      isHighInformationTrafficCollisionMatch(newsroom, {
        ...police,
        title: "Fem personer involvert i ulykke på arbeidsplass",
        excerpt:
          "Arbeidsulykken i Haakon VIIs gate ble meldt klokken 17.25. Fem personer var involvert i arbeidet.",
        category: "Nyheter",
      }),
    ).toBe(false);

    const sparseDifferentRoad = articleCoverageEvidence(
      adressa,
      {
        ...police,
        excerpt:
          "Melding om sammenstøt mellom to biler i Innherredsveien kl. 17:25. Ingen er meldt skadet.",
      },
      "v2",
    );
    expect(sparseDifferentRoad.positiveIncidentEvidence).not.toContain(
      "shared_high_information_traffic_collision",
    );
    expect(sparseDifferentRoad.conflicts).toContainEqual(
      expect.objectContaining({
        kind: "incident_subtype",
        detail: "traffic_collision_fingerprint",
      }),
    );
  });

  it("groups the current sparse production reports in both legacy and v2", () => {
    const expectations = new Map([
      [
        "road-animal-hazard-across-sparse-headlines",
        [
          "elk-police",
          "elk-nidaros",
          "elk-adressa-brief",
          "elk-adressa-feature",
          "elk-tronderbladet",
          "elk-nrk",
        ],
      ],
      ["vehicle-damage-with-axe-across-sparse-reports", ["axe-adressa", "axe-nidaros", "axe-nrk"]],
      ["impaired-driving-through-complementary-details", ["dui-adressa", "dui-nrk", "dui-nidaros"]],
    ]);

    for (const [fixtureId, expectedMembers] of expectations) {
      const fixture = articleCoverageGoldenCases.find(({ id }) => id === fixtureId);
      expect(fixture).toBeDefined();
      for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
        const groups = analyze(fixture!.articles, "2026-07-14T11:00:00.000Z").bundles.map(
          ({ memberArticleIds }) => [...memberArticleIds].sort(),
        );
        expect(groups).toContainEqual([...expectedMembers].sort());
      }
    }
  });

  it("separates the Moholt storage burglary from the Øya shop theft in both matchers", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "moholt-storage-burglary-versus-oya-shop-theft",
    );
    expect(fixture).toBeDefined();

    const articlesById = new Map(fixture!.articles.map((article) => [article.id, article]));
    const crossEventEvidence = articleCoverageEvidence(
      articlesById.get("storage-police")!,
      articlesById.get("shop-police")!,
      "v2",
    );
    expect(crossEventEvidence.incidentSubtypes).toEqual(["storage_burglary", "shop_theft"]);
    expect(crossEventEvidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
    expect(crossEventEvidence.positiveIncidentEvidence).not.toContain(
      "shared_property_crime_event",
    );
    expect(
      articleCoverageEvidence(
        articlesById.get("storage-nidaros-follow-up")!,
        articlesById.get("storage-adressa")!,
        "v2",
      ).sharedCityIncidentFingerprint,
    ).toBe("property:storage-burglary");
    expect(
      articleCoverageEvidence(
        articlesById.get("shop-nidaros")!,
        articlesById.get("shop-nrk")!,
        "v2",
      ).sharedCityIncidentFingerprint,
    ).toBe("property:shop-theft");

    const expectedGroups = fixture!.expectedGroups
      .map((ids) => [...ids].sort())
      .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
    const permutations = [
      fixture!.articles,
      [...fixture!.articles].reverse(),
      [...fixture!.articles.slice(3), ...fixture!.articles.slice(0, 3)],
    ];
    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      let stableIdsByMembers: Map<string, string> | undefined;
      for (const articles of permutations) {
        const analysis = analyze(articles, "2026-07-14T16:11:20.551Z");
        const groups = analysis.bundles
          .map(({ memberArticleIds }) => [...memberArticleIds].sort())
          .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
        expect(groups).toEqual(expectedGroups);

        const ids = analysis.bundles.map(({ id }) => id);
        expect(new Set(ids).size).toBe(ids.length);
        if (analyze === analyzeArticleCoverage) {
          expect(ids.filter((id) => id === "coverage:0g728te")).toHaveLength(1);
          expect(
            analysis.bundles.find(({ id }) => id === "coverage:0g728te")?.memberArticleIds,
          ).toEqual(
            expect.arrayContaining(expectedGroups.find((ids) => ids[0]?.startsWith("storage-"))!),
          );
          expect(
            analysis.bundles.find(({ memberArticleIds }) =>
              memberArticleIds.some((id) => id.startsWith("shop-")),
            )?.id,
          ).toBe("coverage:0ffmu4a");
        } else {
          expect(ids).not.toContain("coverage:0g728te");
        }
        expect(
          analysis.bundles.flatMap(({ signals }) => signals.map(({ kind }) => kind)),
        ).not.toContain("persisted_bundle");

        const currentIdsByMembers = new Map(
          analysis.bundles.map(({ id, memberArticleIds }) => [
            [...memberArticleIds].sort().join("\0"),
            id,
          ]),
        );
        if (stableIdsByMembers) {
          expect(currentIdsByMembers).toEqual(stableIdsByMembers);
        } else {
          stableIdsByMembers = currentIdsByMembers;
        }
      }
    }
  });

  it("serves the corrected Moholt and Øya bundle identities directly", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "moholt-storage-burglary-versus-oya-shop-theft",
    );
    expect(fixture).toBeDefined();
    const expectedGroups = fixture!.expectedGroups
      .map((ids) => [...ids].sort())
      .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
    const permutations = [
      fixture!.articles,
      [...fixture!.articles].reverse(),
      [...fixture!.articles.slice(3), ...fixture!.articles.slice(0, 3)],
    ];
    let stableIdsByMembers: Map<string, string> | undefined;

    for (const articles of permutations) {
      const groups = groupHomeArticles(articles);
      expect(
        groups
          .map(({ articles }) => articles.map(({ id }) => id).sort())
          .sort((left, right) => left.join("\0").localeCompare(right.join("\0"))),
      ).toEqual(expectedGroups);
      expect(new Set(groups.map(({ id }) => id)).size).toBe(groups.length);
      expect(
        groups.find(({ id }) => id === "coverage:0g728te")?.articles.map(({ id }) => id),
      ).toEqual(
        expect.arrayContaining(expectedGroups.find((ids) => ids[0]?.startsWith("storage-"))!),
      );
      expect(
        groups.find(({ articles }) => articles.some(({ id }) => id.startsWith("shop-")))?.id,
      ).toBe("coverage:0ffmu4a");
      for (const group of groups) {
        expect(group.bundle?.id).toBe(group.id);
        expect(group.articles.every(({ coverageBundle }) => coverageBundle?.id === group.id)).toBe(
          true,
        );
      }

      const stories = buildCityPulseStories(articles);
      expect(
        stories
          .map(({ articleIds }) => [...articleIds].sort())
          .sort((left, right) => left.join("\0").localeCompare(right.join("\0"))),
      ).toEqual(expectedGroups);
      expect(new Set(stories.map(({ id }) => id)).size).toBe(stories.length);
      for (const story of stories) expect(story.coverageBundle?.id).toBe(story.id);

      const currentIdsByMembers = new Map(
        groups.map(({ id, articles }) => [
          articles
            .map((article) => article.id)
            .sort()
            .join("\0"),
          id,
        ]),
      );
      if (stableIdsByMembers) expect(currentIdsByMembers).toEqual(stableIdsByMembers);
      else stableIdsByMembers = currentIdsByMembers;
    }
  });

  it("preserves an uncontested persisted bundle identity in direct serving", () => {
    const persistedBundle = {
      id: "coverage:incident:stable-direct-serving",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-14T09:00:00.000Z",
    } as const;
    const articles = [
      regressionArticle("stable-direct-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Ung mann kritisk skadd på Lade",
        excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
        places: ["Lade", "Trondheim"],
        coverageBundle: persistedBundle,
      }),
      regressionArticle("stable-direct-police", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Voldshendelse på Lade",
        excerpt: "En person er kritisk skadet etter en voldshendelse på Lade.",
        places: ["Lade", "Trondheim"],
        situationId: "stable-direct-situation",
        publishedAt: "2026-07-14T09:56:00.000Z",
        coverageBundle: persistedBundle,
      }),
    ];

    for (const ordered of [articles, [...articles].reverse()]) {
      const groups = groupHomeArticles(ordered);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.id).toBe(persistedBundle.id);
      expect(groups[0]?.bundle?.id).toBe(persistedBundle.id);
      expect(
        groups[0]?.articles.every(
          ({ coverageBundle }) => coverageBundle?.id === persistedBundle.id,
        ),
      ).toBe(true);
      expect(buildCityPulseStories(ordered)[0]?.id).toBe(persistedBundle.id);
    }
  });

  it("normalizes multiple persisted identities inside one direct-serving group", () => {
    const persistedBundle = (id: string) =>
      ({
        id,
        kind: "incident",
        confidence: "high",
        reason: "Tidligere hendelsesidentitet",
        generatedAt: "2026-07-14T09:00:00.000Z",
      }) as const;
    const articles = [
      regressionArticle("merged-old-a", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Ung mann kritisk skadd på Lade",
        excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
        places: ["Lade", "Trondheim"],
        coverageBundle: persistedBundle("coverage:old:a"),
      }),
      regressionArticle("merged-old-b", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Voldshendelse på Lade",
        excerpt: "En person er kritisk skadet etter en voldshendelse på Lade.",
        places: ["Lade", "Trondheim"],
        publishedAt: "2026-07-14T09:56:00.000Z",
        coverageBundle: persistedBundle("coverage:old:b"),
      }),
    ];
    let stableId: string | undefined;

    for (const ordered of [articles, [...articles].reverse()]) {
      const groups = groupHomeArticles(ordered);
      expect(groups).toHaveLength(1);
      const group = groups[0]!;
      expect(group.bundle?.id).toBe(group.id);
      expect(group.articles.every(({ coverageBundle }) => coverageBundle?.id === group.id)).toBe(
        true,
      );
      const story = buildCityPulseStories(ordered)[0]!;
      expect(story.id).toBe(group.id);
      expect(story.coverageBundle?.id).toBe(group.id);
      expect(story.articles.every(({ coverageBundle }) => coverageBundle?.id === group.id)).toBe(
        true,
      );
      if (stableId) expect(group.id).toBe(stableId);
      else stableId = group.id;
    }
  });

  it("reserves a fresh official-situation identity against a stale claim from another group", () => {
    const staleSituationBundle = {
      id: "coverage:situation:official-x",
      kind: "topic",
      confidence: "high",
      reason: "Tidligere feilaktig situasjonskobling",
      generatedAt: "2026-07-14T09:00:00.000Z",
    } as const;
    const sharedSportUrl = "https://example.test/rbk-treneroppdatering";
    const articles = [
      regressionArticle("official-x-police", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Voldshendelse på Lade",
        excerpt: "En person er skadet etter en voldshendelse på Lade.",
        places: ["Lade", "Trondheim"],
        situationId: "official-x",
      }),
      regressionArticle("official-x-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Person skadd på Lade",
        excerpt: "Politiet rykket ut etter en voldshendelse på Lade.",
        places: ["Lade", "Trondheim"],
        situationId: "official-x",
        publishedAt: "2026-07-14T09:59:00.000Z",
      }),
      regressionArticle("stale-sport-nrk", {
        source: "nrk",
        title: "RBK presenterer ny trener",
        excerpt: "Rosenborg presenterer sin nye hovedtrener på Lerkendal.",
        category: "Sport",
        url: sharedSportUrl,
        coverageBundle: staleSituationBundle,
      }),
      regressionArticle("stale-sport-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "RBK presenterer ny trener",
        excerpt: "Rosenborg presenterer sin nye hovedtrener på Lerkendal.",
        category: "Sport",
        url: sharedSportUrl,
        publishedAt: "2026-07-14T09:58:00.000Z",
        coverageBundle: staleSituationBundle,
      }),
    ];

    for (const ordered of [articles, [...articles].reverse()]) {
      const directGroups = groupHomeArticles(ordered);
      expect(directGroups).toHaveLength(2);
      expect(new Set(directGroups.map(({ id }) => id)).size).toBe(2);
      expect(new Set(buildCityPulseStories(ordered).map(({ id }) => id)).size).toBe(2);

      for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
        const analysis = analyze(ordered, "2026-07-14T11:00:00.000Z");
        expect(analysis.bundles).toHaveLength(2);
        expect(new Set(analysis.bundles.map(({ id }) => id)).size).toBe(2);
      }
      expect(
        analyzeArticleCoverage(ordered, "2026-07-14T11:00:00.000Z").bundles.some(
          ({ id }) => id === "coverage:situation:official-x",
        ),
      ).toBe(true);
    }
  });

  it("clears a stale bundle identity from unmatched singleton stories", () => {
    const staleBundle = {
      id: "coverage:stale-singletons",
      kind: "incident",
      confidence: "high",
      reason: "Tidligere feilgruppering",
      generatedAt: "2026-07-14T09:00:00.000Z",
    } as const;
    const articles = [
      regressionArticle("stale-single-a", {
        title: "Kommunen vedtok ny arealplan",
        excerpt: "Bystyret behandlet planen etter en lang høring.",
        category: "Nyheter",
        coverageBundle: staleBundle,
      }),
      regressionArticle("stale-single-b", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "RBK vant treningskampen",
        excerpt: "Laget scoret to mål etter pause på Lerkendal.",
        category: "Sport",
        coverageBundle: staleBundle,
      }),
    ];

    for (const ordered of [articles, [...articles].reverse()]) {
      const groups = groupHomeArticles(ordered);
      expect(groups.map(({ id }) => id).sort()).toEqual([
        "article:stale-single-a",
        "article:stale-single-b",
      ]);
      expect(groups.every(({ bundle }) => bundle === undefined)).toBe(true);
      expect(
        groups.every(({ articles: members }) =>
          members.every(({ coverageBundle }) => coverageBundle === undefined),
        ),
      ).toBe(true);
      expect(
        buildCityPulseStories(ordered).every(
          ({ coverageBundle, articles: members }) =>
            coverageBundle === undefined &&
            members.every(({ coverageBundle }) => coverageBundle === undefined),
        ),
      ).toBe(true);
      for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
        const analysis = analyze(ordered, "2026-07-14T11:00:00.000Z");
        expect(analysis.bundles).toEqual([]);
        expect(analysis.articles.every(({ coverageBundle }) => coverageBundle === undefined)).toBe(
          true,
        );
      }
    }
  });

  it("keeps same-minute same-place shop and storage angles in one event", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "mixed-shop-storage-angle-one-event",
    );
    expect(fixture).toBeDefined();
    const [shopAngle, storageAngle] = fixture!.articles;
    expect(shopAngle).toBeDefined();
    expect(storageAngle).toBeDefined();

    const evidence = articleCoverageEvidence(shopAngle!, storageAngle!, "v2");
    expect(evidence.incidentSubtypes).toEqual(["shop_theft", "storage_burglary"]);
    expect(evidence.conflicts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
    expect(evidence.positiveIncidentEvidence).toContain("shared_property_crime_event");
    expect(evidence.positiveIncidentEvidence).toContain("compatible_incident_subtype");

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      expect(
        analyze(fixture!.articles, "2026-07-14T04:00:00.000Z").bundles.map(({ memberArticleIds }) =>
          [...memberArticleIds].sort(),
        ),
      ).toContainEqual(["mixed-shop-angle", "mixed-storage-angle"]);
    }
  });

  it("keeps same-minute mixed property-crime angles at different places separate", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "mixed-shop-storage-different-places",
    );
    expect(fixture).toBeDefined();
    const [shopAngle, storageAngle] = fixture!.articles;
    const evidence = articleCoverageEvidence(shopAngle!, storageAngle!, "v2");
    expect(evidence.positiveIncidentEvidence).not.toContain("shared_property_crime_event");
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "specific_place" })]),
    );

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      expect(analyze(fixture!.articles, "2026-07-14T04:00:00.000Z").bundles).toEqual([]);
    }
  });

  it("blocks an unknown article from bridging unmatched mixed property crimes", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "mixed-property-transitive-bridge",
    );
    expect(fixture).toBeDefined();
    const [storage, shop, unknown] = fixture!.articles;
    const permutations = [
      [storage!, shop!, unknown!],
      [storage!, unknown!, shop!],
      [shop!, storage!, unknown!],
      [shop!, unknown!, storage!],
      [unknown!, storage!, shop!],
      [unknown!, shop!, storage!],
    ];

    const evidence = articleCoverageEvidence(storage!, shop!, "v2");
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      for (const articles of permutations) {
        const bundles = analyze(articles, "2026-07-14T11:00:00.000Z").bundles;
        expect(
          bundles.some(
            ({ memberArticleIds }) =>
              memberArticleIds.includes("bridge-storage") &&
              memberArticleIds.includes("bridge-shop"),
          ),
        ).toBe(false);
      }
    }
  });

  it("retains a zero-signal mixed-property conflict against a newest bridge", () => {
    const [storage, shop, unknown] = noSignalPropertyBridgeArticles();
    const evidence = articleCoverageEvidence(storage, shop, "v2");
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
    expect(articleCoverageEdge(storage, shop)).toMatchObject({
      signals: [],
      conflicts: expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    });

    const permutations = [
      [storage, shop, unknown],
      [storage, unknown, shop],
      [shop, storage, unknown],
      [shop, unknown, storage],
      [unknown, storage, shop],
      [unknown, shop, storage],
    ];
    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      for (const articles of permutations) {
        expect(
          analyze(articles, "2026-07-14T11:00:00.000Z").bundles.some(
            ({ memberArticleIds }) =>
              memberArticleIds.includes(storage.id) && memberArticleIds.includes(shop.id),
          ),
        ).toBe(false);
      }
    }
  });

  it("keeps hidden blocking conflicts authoritative after review-edge caps", () => {
    const [baseStorage, shop, unknown] = noSignalPropertyBridgeArticles("capped");
    const storage = { ...baseStorage, situationId: "capped-storage-thread" };
    const decoys = Array.from({ length: 6 }, (_, index) =>
      regressionArticle(`capped-review-decoy-${index}`, {
        source: "nidaros",
        sourceLabel: "Nidaros",
        title: storage.title,
        excerpt: storage.excerpt,
        situationId: "capped-decoy-thread",
        publishedAt: `2026-07-14T09:5${index}:00.000Z`,
      }),
    );
    const inputs = [
      [storage, shop, unknown, ...decoys],
      [storage, shop, unknown, ...decoys].reverse(),
    ];

    for (const articles of inputs) {
      const analysis = analyzeArticleCoverageV2(articles, "2026-07-14T11:00:00.000Z");
      expect(
        analysis.edges?.some(
          ({ articleIds }) => articleIds.includes(storage.id) && articleIds.includes(shop.id),
        ),
      ).toBe(false);
      expect(
        analysis.bundles.some(
          ({ memberArticleIds }) =>
            memberArticleIds.includes(storage.id) && memberArticleIds.includes(shop.id),
        ),
      ).toBe(false);
    }
  });

  it("groups a delayed regulatory follow-up without grouping unrelated company news", () => {
    const fixture = articleCoverageGoldenCases.find(
      ({ id }) => id === "delayed-regulatory-follow-up-with-dotted-organization",
    );
    expect(fixture).toBeDefined();

    const regulatoryPair = fixture!.articles.filter(({ id }) => id !== "dahls-product-news");
    const evidence = articleCoverageEvidence(regulatoryPair[0]!, regulatoryPair[1]!, "v2");
    expect(evidence.positiveIncidentEvidence).toContain("shared_named_entity");
    expect(isEntityBackedNotificationFailureFollowUp(regulatoryPair[0]!, regulatoryPair[1]!)).toBe(
      true,
    );
    expect(
      isEntityBackedNotificationFailureFollowUp(regulatoryPair[0]!, {
        ...regulatoryPair[1]!,
        source: regulatoryPair[0]!.source,
      }),
    ).toBe(false);
    expect(
      isEntityBackedNotificationFailureFollowUp(regulatoryPair[0]!, {
        ...regulatoryPair[1]!,
        publishedAt: new Date(
          Date.parse(regulatoryPair[0]!.publishedAt) +
            entityBackedNotificationFollowUpPolicy.windowMs +
            1,
        ).toISOString(),
      }),
    ).toBe(false);

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      const groups = analyze(fixture!.articles, "2026-07-14T11:00:00.000Z").bundles.map(
        ({ memberArticleIds }) => [...memberArticleIds].sort(),
      );
      expect(groups).toContainEqual(["dahls-adressa", "dahls-nidaros"]);
      expect(groups.some((ids) => ids.includes("dahls-product-news"))).toBe(false);
    }
  });
});
