import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type {
  Article,
  BootstrapPayload,
  CityPulseStory,
  CityPulseStoryPage,
  MorningBrief,
  SourceHealth,
} from "@nytt/shared";
import {
  articlesFromCityPulseStoryPage,
  articlesFromCityPulseStories,
  CityPulseDashboard,
  ChannelContextPanel,
  CityPulseRefreshStatus,
  CityPulseSignalPanel,
  CoverageMergeReportAction,
  LocalFocusRadiusControl,
  LocalFocusSummaryPanel,
  LeadStory,
  MapClusterSummary,
  MapTimeSlider,
  MorningBriefPanel,
  PublicSourceStatusPanel,
  StoryConfidenceBadge,
  StoryCard,
  StoryEventBundleSummary,
  StoryFeedTrustStrip,
  StoryVerificationProof,
  channelStoryCountsForCards,
  cityPulseDataForCurrentFeed,
  cityPulseLatestTimestamp,
  coverageConflictRefreshState,
  coverageConflictState,
  coverageCorrectionContextMatches,
  coverageCorrectionLiveAnnouncement,
  coverageFeedKey,
  coverageProjectionKey,
  coverageSplitAnnouncement,
  coverageSplitProjectionRevision,
  coverageSplitState,
  coverageUndoContextMatches,
  coverageUndoAnnouncement,
  loadCoverageConflictRefreshState,
  mergeCityPulseStoryLists,
  morningBriefFreshness,
  rankHomeStoryCardsForPublicFeed,
  shouldShowStoryConfidenceBadge,
  storyFeedSummary,
  storyFeedTrustStats,
} from "./HomePage.js";
import { groupHomeArticles } from "../homeArticleGroups.js";
import type { HomeFilters } from "../homeFilters.js";
import { homeStoryCardsForGroups } from "../homeStoryCards.js";

const brief: MorningBrief = {
  generatedAt: "2026-07-02T07:30:00.000Z",
  title: "Morgenbrief",
  mode: "ai_assisted",
  sourceLine: "AI-assistert · 5/6 kilder OK",
  paragraphs: [
    "Morgenbildet dekker 12 ferske saker.",
    "Trafikktrøbbel sør i byen: Flere meldinger peker mot saktegående trafikk.",
    "1 situasjonsrom følges nå.",
  ],
  highlights: [
    { label: "Saker", value: "12", detail: "Transport leder bildet" },
    { label: "Situasjoner", value: "1", detail: "Aktive eller til vurdering" },
    { label: "Kilder", value: "5/6", detail: "Rapporterer OK" },
  ],
  articleIds: ["article-one"],
  situationIds: ["situation-one"],
  aiRun: {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    status: "ok",
    completedAt: "2026-07-02T07:25:00.000Z",
  },
};

const article = {
  id: "article-one",
  source: "adressa",
  sourceLabel: "Adresseavisen",
  title: "Kø ved Sluppen",
  excerpt: "Trafikken står sør i byen.",
  url: "https://example.test/sluppen",
  publishedAt: "2026-07-02T07:05:00.000Z",
  scope: "trondheim",
  category: "Transport",
  places: ["Sluppen"],
} satisfies Article;

const situation = {
  id: "situation-one",
  title: "Steinsprang, vegen er stengt",
  summary: "Gangåsvegen er stengt.",
  status: "active",
  verificationStatus: "Offentlig bekreftet",
  updatedAt: "2026-07-02T07:10:00.000Z",
  createdAt: "2026-07-02T07:00:00.000Z",
  locationLabel: "Gangåsvegen",
  sourceConfidence: {
    level: "confirmed",
    label: "Bekreftet",
    score: 0.91,
    sourceCount: 2,
    rationale: "Offisielle kilder og redaksjonelle kilder peker mot samme område.",
  },
} satisfies BootstrapPayload["situations"][number];

const bootstrapStory = {
  id: "story-one",
  primaryArticleId: article.id,
  articleIds: [article.id],
  primary: article,
  articles: [article],
  sourceLabels: ["Adresseavisen"],
  sourceCount: 1,
  updateCount: 1,
  latestAt: article.publishedAt,
  category: article.category,
} satisfies CityPulseStory;

const bootstrap = {
  articles: [article],
  stories: [bootstrapStory],
  storyNextCursor: "next-stories",
  situations: [situation],
  sourceHealth: [],
  morningBrief: brief,
} satisfies BootstrapPayload;

const sourceHealth: SourceHealth[] = [
  {
    source: "nrk",
    label: "NRK Trøndelag",
    state: "ok",
    detail: "RSS",
    lastCheckedAt: "2026-07-02T07:24:00.000Z",
  },
  {
    source: "datex",
    label: "Vegvesen DATEX",
    state: "awaiting_access",
    detail: "Venter på DATEX Basic Auth-brukernavn og passord",
    lastCheckedAt: "2026-07-02T07:22:00.000Z",
  },
  {
    source: "deepseek",
    label: "AI-analyse",
    state: "degraded",
    detail: "DeepSeek bruker deterministisk reserveanalyse.",
    lastCheckedAt: "2026-07-02T07:25:00.000Z",
  },
  {
    source: "web_push",
    label: "Web Push",
    state: "disabled",
    detail: "Intern varslingskanal.",
  },
];

describe("CoverageMergeReportAction", () => {
  const [card] = homeStoryCardsForGroups(groupHomeArticles([article]));

  it("keeps missed-group feedback owner-only and exposes the two-step selection state", () => {
    const hidden = renderToStaticMarkup(
      <CoverageMergeReportAction
        card={card!}
        canReport={false}
        pending={false}
        onReport={() => undefined}
      />,
    );
    const initial = renderToStaticMarkup(
      <CoverageMergeReportAction
        card={card!}
        canReport
        pending={false}
        onReport={() => undefined}
      />,
    );
    const selected = renderToStaticMarkup(
      <CoverageMergeReportAction
        card={card!}
        canReport
        anchorId={card!.id}
        pending={false}
        onReport={() => undefined}
      />,
    );
    const candidate = renderToStaticMarkup(
      <CoverageMergeReportAction
        card={card!}
        canReport
        anchorId="another-story"
        pending={false}
        onReport={() => undefined}
      />,
    );

    expect(hidden).toBe("");
    expect(initial).toContain("Mangler samling?");
    expect(selected).toContain("Avbryt valg");
    expect(selected).toContain('aria-pressed="true"');
    expect(candidate).toContain("Denne hører sammen");
  });
});

describe("MorningBriefPanel", () => {
  it("renders the pinned public briefing with mode and highlights", () => {
    const html = renderToStaticMarkup(
      <MorningBriefPanel
        articles={[article]}
        brief={brief}
        now={new Date("2026-07-02T12:00:00.000Z")}
        situations={[situation]}
      />,
    );

    expect(html).toContain("Analysert brief");
    expect(html).toContain("Morgenbrief");
    expect(html).toContain("Morgenbrief-ferskhet");
    expect(html).toContain("Oppdatert i dag");
    expect(html).toContain("Trafikktrøbbel sør i byen");
    expect(html).toContain("Automatisk analyse · 5/6 kilder OK");
    expect(html).not.toContain("AI-assistert · 5/6 kilder OK");
    expect(html).toContain("Analysespor");
    expect(html).toContain("Automatisk analyse");
    expect(html).toContain("OK");
    expect(html).not.toContain("DeepSeek");
    expect(html).not.toContain("deepseek-v4-flash");
    expect(html).toContain("Morgenbrief-nøkkeltall");
    expect(html).toContain("Transport leder bildet");
    expect(html).toContain("Morgenbrief-grunnlag");
    expect(html).toContain("Kø ved Sluppen");
    expect(html).toContain("https://example.test/sluppen");
    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("/situasjoner/situation-one");
  });

  it("renders nothing when bootstrap has no brief yet", () => {
    expect(renderToStaticMarkup(<MorningBriefPanel />)).toBe("");
  });

  it("labels older stored briefings as stale instead of silently looking fresh", () => {
    const html = renderToStaticMarkup(
      <MorningBriefPanel
        brief={{ ...brief, generatedAt: "2026-06-30T07:30:00.000Z" }}
        now={new Date("2026-07-03T12:00:00.000Z")}
      />,
    );

    expect(html).toContain("Eldre brief");
    expect(html).toContain("Oppdatert 30. juni");
    expect(html).toContain("morning-brief-freshness-stale");
  });

  it("calculates Oslo-date freshness for today, yesterday and stale briefings", () => {
    expect(
      morningBriefFreshness("2026-07-02T17:30:00.000Z", new Date("2026-07-02T20:15:00.000Z")),
    ).toEqual({ label: "Oppdatert i dag", tone: "fresh" });
    expect(
      morningBriefFreshness("2026-07-01T07:30:00.000Z", new Date("2026-07-02T12:00:00.000Z")),
    ).toMatchObject({ label: "Oppdatert i går", tone: "watch" });
    expect(
      morningBriefFreshness("2026-06-29T07:30:00.000Z", new Date("2026-07-02T12:00:00.000Z")),
    ).toMatchObject({ label: "Eldre brief", tone: "stale" });
  });
});

describe("CityPulseDashboard", () => {
  it("keeps public prime space focused on actionable situations", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseDashboard data={bootstrap} />
      </MemoryRouter>,
    );

    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("Kildetillit: Bekreftet");
    expect(html).toContain("91 %");
    expect(html).toContain("Åpne situasjonsrom");
    expect(html).toContain("/situasjoner");
    expect(html).not.toContain("city-pulse-summary");
    expect(html).not.toContain("Bypuls");
    expect(html).not.toContain("Kort oversikt");
    expect(html).not.toContain("Morgenbrief");
    expect(html).not.toContain("dashboard-layout-city-pulse");
    expect(html).not.toContain("dashboard-widget-full");
    expect(html).not.toContain("Høyeffekt-signaler");
    expect(html).not.toContain("Høyeffektsaker fanget av varselreglene");
    expect(html).not.toContain("Slik vurderes høyeffekt-signaler");
    expect(html).not.toContain("Åpne varsler");
    expect(html).not.toContain("/varsler");
    expect(html).not.toContain("Liv og helse");
    expect(html).not.toContain("Stengte hovedårer");
    expect(html).not.toContain("Situasjonsrommet er offentlig bekreftet.");
    expect(html).not.toContain("Trafikktrøbbel sør i byen");
    expect(html).not.toContain("1 situasjonsrom følges nå");
    expect(html).not.toContain("Morgenbrief-grunnlag");
    expect(html).not.toContain("Flytt Morgenbrief senere");
    expect(html).not.toContain("Tilpass oppsett");
    expect(html).not.toContain("Tilbakestill");
    expect(html).not.toContain("Dashboard-oppsett");
  });

  it("renders nothing when there are no active or preliminary situations", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseDashboard data={{ articles: [], situations: [], sourceHealth: [] }} />
      </MemoryRouter>,
    );

    expect(html).toBe("");
  });
});

describe("CityPulseRefreshStatus", () => {
  it("uses story freshness before older flattened article timestamps", () => {
    expect(
      cityPulseLatestTimestamp({
        ...bootstrap,
        stories: [
          {
            ...bootstrapStory,
            latestAt: "2026-07-02T09:15:00.000Z",
            primary: { ...article, publishedAt: "2026-07-02T08:00:00.000Z" },
            articles: [{ ...article, publishedAt: "2026-07-02T08:00:00.000Z" }],
          },
        ],
        articles: [{ ...article, publishedAt: "2026-07-02T08:00:00.000Z" }],
        situations: [],
        sourceHealth: [],
      }),
    ).toBe("2026-07-02T09:15:00.000Z");
  });

  it("uses the newest public feed timestamp for live City Pulse status", () => {
    expect(
      cityPulseLatestTimestamp({
        ...bootstrap,
        morningBrief: { ...brief, generatedAt: "2026-07-02T07:30:00.000Z" },
        articles: [{ ...article, publishedAt: "2026-07-02T08:30:00.000Z" }],
        situations: [
          {
            ...situation,
            updatedAt: "2026-07-02T09:05:00.000Z",
          },
        ],
        sourceHealth: [
          {
            source: "nrk",
            label: "NRK",
            state: "ok",
            detail: "RSS",
            lastCheckedAt: "2026-07-02T08:55:00.000Z",
          },
        ],
      }),
    ).toBe("2026-07-02T09:05:00.000Z");
  });

  it("renders a compact manual refresh control with status and errors", () => {
    const html = renderToStaticMarkup(
      <CityPulseRefreshStatus
        error="Kunne ikke oppdatere bypulsen"
        lastUpdatedAt="2026-07-02T09:05:00.000Z"
        refreshing
      />,
    );

    expect(html).toContain("city-pulse-refresh has-error");
    expect(html).toContain("Bypuls");
    expect(html).toContain("11:05");
    expect(html).toContain("Oppdaterer");
    expect(html).toContain("Kunne ikke oppdatere bypulsen");
  });
});

describe("articlesFromCityPulseStoryPage", () => {
  it("flattens story members once in story order and keeps story metadata", () => {
    const secondArticle = {
      ...article,
      id: "article-two",
      title: "Oppdatering om kø ved Sluppen",
      publishedAt: "2026-07-02T07:10:00.000Z",
    } satisfies Article;
    const coverageBundle = {
      id: "coverage:incident:sluppen-traffic",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T07:12:00.000Z",
    };
    const publicVerification = {
      status: "verified" as const,
      label: "Verifisert",
      detail: "Bekreftet av Vegvesen DATEX og Adresseavisen.",
      officialSources: ["datex" as const],
      reportingSources: ["adressa" as const],
    };
    const page = {
      items: [
        {
          id: "story-one",
          primaryArticleId: article.id,
          articleIds: [article.id, secondArticle.id],
          primary: article,
          articles: [article, secondArticle],
          sourceLabels: ["Adresseavisen", "NRK Trøndelag"],
          sourceCount: 2,
          updateCount: 2,
          latestAt: article.publishedAt,
          category: article.category,
          coverageBundle,
          publicVerification,
        },
        {
          id: "story-two",
          primaryArticleId: secondArticle.id,
          articleIds: [secondArticle.id],
          primary: secondArticle,
          articles: [secondArticle],
          sourceLabels: ["NRK Trøndelag"],
          sourceCount: 1,
          updateCount: 1,
          latestAt: secondArticle.publishedAt,
          category: secondArticle.category,
        },
      ],
      nextCursor: "next-stories",
    } satisfies CityPulseStoryPage;

    expect(articlesFromCityPulseStoryPage(page).map((item) => item.id)).toEqual([
      "article-one",
      "article-two",
    ]);
    expect(articlesFromCityPulseStoryPage(page)[0]).toMatchObject({
      coverageBundle,
      publicVerification,
    });
    expect(articlesFromCityPulseStories(page.items).map((item) => item.id)).toEqual([
      "article-one",
      "article-two",
    ]);
  });

  it("merges later members into an already-rendered story", () => {
    const laterArticle = {
      ...article,
      id: "article-two",
      title: "Oppdatering om samme hendelse",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      publishedAt: "2026-07-02T09:15:00.000Z",
    } satisfies Article;
    const current = {
      id: "story-one",
      primaryArticleId: article.id,
      articleIds: [article.id],
      primary: article,
      articles: [article],
      sourceLabels: ["Adresseavisen"],
      sourceCount: 1,
      updateCount: 1,
      latestAt: article.publishedAt,
      category: article.category,
    } satisfies CityPulseStory;
    const incoming = {
      ...current,
      articleIds: [laterArticle.id],
      primaryArticleId: laterArticle.id,
      primary: laterArticle,
      articles: [laterArticle],
      sourceLabels: ["NRK Trøndelag"],
      latestAt: laterArticle.publishedAt,
    } satisfies CityPulseStory;

    expect(mergeCityPulseStoryLists([current], [incoming])).toEqual([
      {
        ...current,
        articleIds: [article.id, laterArticle.id],
        articles: [laterArticle, article],
        sourceLabels: ["Adresseavisen", "NRK Trøndelag"],
        sourceCount: 2,
        updateCount: 2,
        latestAt: laterArticle.publishedAt,
        coverageBundle: undefined,
        publicVerification: undefined,
        editorialSelection: {
          articleId: laterArticle.id,
          strategy: "best-source-v1",
          rationale: "newsroom_complete",
        },
        editorialCopy: {
          version: 1,
          strategy: "independent-source-v1",
          title: {
            text: laterArticle.title,
            mode: "source",
            articleId: laterArticle.id,
            field: "title",
            rationale: "specific_source_title",
          },
          ingress: {
            text: article.excerpt,
            mode: "source",
            articleId: article.id,
            field: "excerpt",
            rationale: "newsroom_complete",
          },
        },
      },
    ]);
  });

  it("replaces only the affected story after split or stale refresh", () => {
    const replacement = {
      ...bootstrapStory,
      id: "story-split",
      latestAt: "2026-07-02T07:06:00.000Z",
    } satisfies CityPulseStory;
    const untouched = {
      ...bootstrapStory,
      id: "story-untouched",
      latestAt: "2026-07-02T06:00:00.000Z",
    } satisfies CityPulseStory;

    expect(
      coverageSplitState([bootstrapStory, untouched], {
        corrections: [],
        removedStoryIds: [bootstrapStory.id],
        replacementStories: [replacement],
      }).map(({ id }) => id),
    ).toEqual(["story-split", "story-untouched"]);
    expect(
      coverageConflictState([bootstrapStory, untouched], bootstrapStory.id, [replacement]).map(
        ({ id }) => id,
      ),
    ).toEqual(["story-split", "story-untouched"]);
  });

  it("reconciles a stale later-page card without dropping loaded older cards or its cursor", async () => {
    const storyWithArticle = (id: string, articleId: string, latestAt: string) => ({
      ...bootstrapStory,
      id,
      primaryArticleId: articleId,
      articleIds: [articleId],
      primary: { ...bootstrapStory.primary, id: articleId },
      articles: [{ ...bootstrapStory.primary, id: articleId }],
      latestAt,
    });
    const replacement = storyWithArticle(
      "story-refreshed",
      "later-target-article",
      "2026-07-02T07:07:00.000Z",
    ) satisfies CityPulseStory;
    const refreshedFirstPage = storyWithArticle(
      "story-first-refreshed",
      "first-page-article",
      "2026-07-02T08:07:00.000Z",
    ) satisfies CityPulseStory;
    const laterTarget = storyWithArticle(
      "story-later-target",
      "later-target-article",
      "2026-07-02T06:07:00.000Z",
    ) satisfies CityPulseStory;
    const unaffectedOlder = storyWithArticle(
      "story-unaffected-older",
      "unaffected-older-article",
      "2026-07-02T05:07:00.000Z",
    ) satisfies CityPulseStory;
    const unrelatedConflictPayload = {
      ...bootstrapStory,
      id: "story-unrelated-conflict-payload",
      latestAt: "2026-07-02T04:07:00.000Z",
      primaryArticleId: "unrelated-conflict-article",
      articleIds: ["unrelated-conflict-article"],
      primary: { ...bootstrapStory.primary, id: "unrelated-conflict-article" },
      articles: [{ ...bootstrapStory.primary, id: "unrelated-conflict-article" }],
    } satisfies CityPulseStory;
    const page = {
      items: [refreshedFirstPage],
      nextCursor: "page-one-cursor",
      projection: {
        mode: "normalized",
        generationId: "coverage-generation-2",
        matcherVersion: "v2",
        parityClean: true,
      },
    } satisfies CityPulseStoryPage;
    const reconciled = coverageConflictRefreshState({
      currentStories: [bootstrapStory, laterTarget, unaffectedOlder],
      currentNextCursor: "later-page-cursor",
      page,
      removedStoryId: laterTarget.id,
      targetArticleIds: laterTarget.articleIds,
      replacementStories: [replacement, unrelatedConflictPayload],
      preserveCurrentCursor: true,
    });
    expect(reconciled).toMatchObject({
      storyProjection: { generationId: "coverage-generation-2" },
      nextCursor: "later-page-cursor",
    });
    expect(reconciled.stories.map(({ id }) => id)).toEqual([
      "story-first-refreshed",
      "story-refreshed",
      bootstrapStory.id,
      "story-unaffected-older",
    ]);
    expect(reconciled.articles.map(({ id }) => id)).toContain(unaffectedOlder.primary.id);
    await expect(
      loadCoverageConflictRefreshState({
        loadPage: async () => {
          throw new Error("refresh unavailable");
        },
        currentStories: [bootstrapStory, laterTarget, unaffectedOlder],
        currentNextCursor: "later-page-cursor",
        removedStoryId: laterTarget.id,
        targetArticleIds: laterTarget.articleIds,
        replacementStories: [replacement],
        preserveCurrentCursor: true,
      }),
    ).rejects.toThrow("refresh unavailable");
  });

  it("keeps refreshed page membership authoritative over duplicate conflict replacements", () => {
    const articleId = "already-refreshed-article";
    const refreshedStory = {
      ...bootstrapStory,
      id: "story-from-refreshed-page",
      primaryArticleId: articleId,
      articleIds: [articleId],
      primary: { ...bootstrapStory.primary, id: articleId },
      articles: [{ ...bootstrapStory.primary, id: articleId }],
    } satisfies CityPulseStory;
    const staleTarget = {
      ...refreshedStory,
      id: "story-stale-target",
    } satisfies CityPulseStory;
    const duplicateReplacement = {
      ...refreshedStory,
      id: "story-duplicate-conflict-payload",
    } satisfies CityPulseStory;

    const refreshed = coverageConflictRefreshState({
      currentStories: [staleTarget],
      page: { items: [refreshedStory] },
      removedStoryId: staleTarget.id,
      targetArticleIds: [articleId],
      replacementStories: [duplicateReplacement],
      preserveCurrentCursor: false,
    });

    expect(refreshed.stories.map(({ id }) => id)).toEqual([refreshedStory.id]);
    expect(refreshed.articles.map(({ id }) => id)).toEqual([articleId]);
  });

  it("preserves a canonical same-ID story after its stale membership is removed", () => {
    const stableStoryId = "coverage:stable-story";
    const anchor = { ...bootstrapStory.primary, id: "same-id-anchor" };
    const rejected = { ...bootstrapStory.primary, id: "same-id-rejected" };
    const staleTarget = {
      ...bootstrapStory,
      id: stableStoryId,
      primaryArticleId: anchor.id,
      articleIds: [anchor.id, rejected.id],
      primary: anchor,
      articles: [anchor, rejected],
      sourceCount: 2,
      updateCount: 2,
    } satisfies CityPulseStory;
    const canonicalTarget = {
      ...staleTarget,
      articleIds: [anchor.id],
      articles: [anchor],
      sourceCount: 1,
      updateCount: 1,
    } satisfies CityPulseStory;
    const rejectedReplacement = {
      ...bootstrapStory,
      id: `article:${rejected.id}`,
      primaryArticleId: rejected.id,
      articleIds: [rejected.id],
      primary: rejected,
      articles: [rejected],
      latestAt: "2026-07-02T07:04:00.000Z",
    } satisfies CityPulseStory;

    const refreshed = coverageConflictRefreshState({
      currentStories: [staleTarget],
      page: { items: [canonicalTarget] },
      removedStoryId: stableStoryId,
      targetArticleIds: staleTarget.articleIds,
      replacementStories: [rejectedReplacement],
      preserveCurrentCursor: false,
    });

    expect(refreshed.stories.map(({ id }) => id)).toEqual([
      canonicalTarget.id,
      rejectedReplacement.id,
    ]);
    expect(refreshed.stories.find(({ id }) => id === stableStoryId)?.articleIds).toEqual([
      anchor.id,
    ]);
  });

  it("uses concise live-region announcements for split and undo", () => {
    expect(coverageSplitAnnouncement(2)).toBe("Gruppen er splittet i 2 saker.");
    expect(coverageUndoAnnouncement).toBe("Grupperingen er gjenopprettet.");
  });

  it("keeps replayed split projection identity aligned with the unchanged canonical revision", () => {
    const replayReplacement = {
      ...bootstrapStory,
      id: "story-replayed-split",
      coverageBundle: {
        id: "coverage:replayed-split",
        kind: "incident" as const,
        confidence: "high" as const,
        reason: "Eksakt replay",
        generatedAt: "2026-07-13T10:00:00.000Z",
        correctionTarget: {
          originalBundleId: "coverage:stable-replayed-split",
          projectionRevision: 7,
        },
      },
    } satisfies CityPulseStory;
    const projection = {
      mode: "normalized" as const,
      generationId: "coverage-generation-1",
      matcherVersion: "v2" as const,
      parityClean: true,
    };
    const replayRevision = coverageSplitProjectionRevision(7, [replayReplacement]);
    const replayContext = {
      feedKey: "same-feed",
      projectionKey: coverageProjectionKey({ ...projection, projectionRevision: replayRevision }, [
        replayReplacement,
      ]),
    };
    const canonicalContext = {
      feedKey: "same-feed",
      projectionKey: coverageProjectionKey({ ...projection, projectionRevision: 7 }, [
        replayReplacement,
      ]),
    };

    expect(replayRevision).toBe(7);
    expect(coverageUndoContextMatches(replayContext, canonicalContext)).toBe(true);
    expect(coverageSplitProjectionRevision(7, [bootstrapStory])).toBe(8);
  });

  it("keeps split-dialog work bound to the feed and projection captured on open", () => {
    const captured = {
      feedKey: coverageFeedKey({
        scope: "trondheim",
        category: "Alle",
        q: "",
        from: "2026-07-13T08:00:00.000Z",
      }),
      projectionKey: coverageProjectionKey(
        {
          mode: "normalized",
          generationId: "coverage-generation-1",
          matcherVersion: "v2",
          parityClean: true,
          projectionRevision: 7,
        },
        [],
      ),
    };

    expect(coverageCorrectionContextMatches(captured, captured)).toBe(true);
    expect(
      coverageCorrectionContextMatches(captured, {
        ...captured,
        feedKey: coverageFeedKey({
          scope: "trondelag",
          category: "Krim",
          q: "",
          from: "2026-07-13T08:00:00.000Z",
        }),
      }),
    ).toBe(false);
    expect(
      coverageCorrectionContextMatches(captured, {
        ...captured,
        projectionKey: coverageProjectionKey(
          {
            mode: "normalized",
            generationId: "coverage-generation-2",
            matcherVersion: "v2",
            parityClean: true,
            projectionRevision: 8,
          },
          [],
        ),
      }),
    ).toBe(false);
  });

  it("suppresses the prior split success from the live region while raw undo state exists", () => {
    const previousSplitSuccess = "Gruppen er splittet i 2 saker.";

    expect(coverageCorrectionLiveAnnouncement(true, previousSplitSuccess)).toBe("");
    expect(coverageCorrectionLiveAnnouncement(false, previousSplitSuccess)).toBe(
      previousSplitSuccess,
    );
  });

  it("invalidates undo across every feed and projection identity boundary", () => {
    const baseFeed = {
      scope: "trondheim",
      category: "Alle",
      topic: undefined,
      q: "",
      from: "2026-07-13T08:00:00.000Z",
      to: "2026-07-13T10:00:00.000Z",
    } as const;
    const feedKey = coverageFeedKey(baseFeed);
    const projectionKey = coverageProjectionKey(
      {
        mode: "normalized",
        generationId: "coverage-generation-1",
        matcherVersion: "v2",
        parityClean: true,
        projectionRevision: 7,
      },
      [],
    );
    const undoContext = { feedKey, projectionKey };

    expect(coverageUndoContextMatches(undoContext, undoContext)).toBe(true);
    for (const changedFeed of [
      { ...baseFeed, scope: "trondelag" as const },
      { ...baseFeed, category: "Sport" as const },
      { ...baseFeed, topic: "rosenborg" as const },
      { ...baseFeed, q: "Byåsen" },
      { ...baseFeed, from: "2026-07-13T07:00:00.000Z" },
      { ...baseFeed, to: "2026-07-13T11:00:00.000Z" },
    ]) {
      expect(
        coverageUndoContextMatches(undoContext, {
          feedKey: coverageFeedKey(changedFeed),
          projectionKey,
        }),
      ).toBe(false);
    }
    expect(
      coverageUndoContextMatches(undoContext, {
        feedKey,
        projectionKey: coverageProjectionKey(
          {
            mode: "normalized",
            generationId: "coverage-generation-2",
            matcherVersion: "v2",
            parityClean: true,
            projectionRevision: 7,
          },
          [],
        ),
      }),
    ).toBe(false);
    expect(
      coverageUndoContextMatches(undoContext, {
        feedKey,
        projectionKey: coverageProjectionKey(
          {
            mode: "normalized",
            generationId: "coverage-generation-1",
            matcherVersion: "v2",
            parityClean: true,
            projectionRevision: 8,
          },
          [],
        ),
      }),
    ).toBe(false);
  });

  it("uses bundle correction revisions only as a projection-key fallback", () => {
    const storyAtRevision = (revision: number) => ({
      ...bootstrapStory,
      id: `story-revision-${revision}`,
      coverageBundle: {
        id: `coverage:revision-${revision}`,
        kind: "incident" as const,
        confidence: "high" as const,
        reason: "Revisjonsbevis",
        generatedAt: "2026-07-13T10:00:00.000Z",
        correctionTarget: {
          originalBundleId: `coverage:stable-${revision}`,
          projectionRevision: revision,
        },
      },
    });
    const projection = {
      mode: "normalized" as const,
      generationId: "coverage-generation-1",
      matcherVersion: "v2" as const,
      parityClean: true,
    };

    expect(coverageProjectionKey(projection, [storyAtRevision(7), storyAtRevision(8)])).toContain(
      '"revision":8',
    );
    expect(
      coverageProjectionKey({ ...projection, projectionRevision: 9 }, [storyAtRevision(8)]),
    ).toContain('"revision":9');
  });
});

describe("cityPulseDataForCurrentFeed", () => {
  it("keeps the stored morning brief and standalone situations on the default view", () => {
    const filters = {
      q: "",
      scope: "trondheim",
      category: "Alle",
      timeWindow: "all",
    } satisfies HomeFilters;

    const data = cityPulseDataForCurrentFeed({
      articles: bootstrap.articles,
      filters,
      initialData: bootstrap,
    });

    expect(data.morningBrief).toBe(brief);
    expect(data.stories).toBe(bootstrap.stories);
    expect(data.storyNextCursor).toBe(bootstrap.storyNextCursor);
    expect(data.situations).toEqual([situation]);
  });

  it("drops stale default brief and unrelated standalone situations for filtered views", () => {
    const filteredArticle = {
      ...article,
      id: "article-two",
      title: "Trafikken åpner ved Sluppen",
    } satisfies Article;
    const filters = {
      q: "",
      scope: "trondheim",
      category: "Transport",
      timeWindow: "24h",
    } satisfies HomeFilters;

    const data = cityPulseDataForCurrentFeed({
      articles: [filteredArticle],
      filters,
      initialData: bootstrap,
      timeWindowFrom: "2026-07-02T08:00:00.000Z",
    });

    expect(data.articles).toEqual([filteredArticle]);
    expect(data.stories).toBeUndefined();
    expect(data.morningBrief).toBeUndefined();
    expect(data.storyNextCursor).toBeUndefined();
    expect(data.situations).toEqual([]);
  });

  it("keeps linked situations in filtered views when the current stories point to them", () => {
    const linkedArticle = {
      ...article,
      id: "article-linked",
      situationId: situation.id,
    } satisfies Article;
    const filters = {
      q: "",
      scope: "trondheim",
      category: "Transport",
      timeWindow: "24h",
    } satisfies HomeFilters;

    const data = cityPulseDataForCurrentFeed({
      articles: [linkedArticle],
      filters,
      initialData: bootstrap,
      timeWindowFrom: "2026-07-02T06:00:00.000Z",
    });

    expect(data.situations).toEqual([situation]);
  });
});

describe("CityPulseSignalPanel", () => {
  it("renders public alert guidance and analysis trace status without private delivery details", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseSignalPanel brief={brief} now={new Date("2026-07-02T12:00:00.000Z")} />
      </MemoryRouter>,
    );

    expect(html).toContain("Varsel og analysespor");
    expect(html).toContain("Analysert brief");
    expect(html).toContain("09:25");
    expect(html).toContain("Brief-ferskhet");
    expect(html).toContain("Oppdatert i dag");
    expect(html).toContain("4 offentlige kategorier");
    expect(html).toContain("Liv og helse");
    expect(html).toContain("Viktige bortfall");
    expect(html).toContain("/varsler");
    expect(html).toContain("Akkurat nå");
    expect(html).toContain("Rolig");
    expect(html).toContain(
      "Ingen åpne saker i gjeldende bypulsdata krysser varselterskelen akkurat nå.",
    );
    expect(html).not.toContain("triggerId");
    expect(html).not.toContain("endpoint");
    expect(html).not.toContain("Abonnementer");
    expect(html).not.toContain("DeepSeek");
  });

  it("renders public-safe active signal highlights from current City Pulse data", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseSignalPanel
          articles={[
            {
              ...article,
              id: "article-road",
              title: "Ti meter stort ras kan bli stengt i flere uker",
              excerpt: "Veien er stengt ved Gangåsvegen.",
              category: "Transport",
              situationId: "situation-one",
            },
          ]}
          brief={brief}
          now={new Date("2026-07-02T12:00:00.000Z")}
          situations={[situation]}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Høyeffektsaker fanget av varselreglene");
    expect(html).toContain("1 aktive");
    expect(html).toContain("Trafikk · Kritisk · Oppdatert nå");
    expect(html).toContain("Sjekk rute nå");
    expect(html).toContain("Hendelsen kan påvirke reisevei eller framkommelighet.");
    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("Kildetillit: Bekreftet");
    expect(html).toContain("Offentlig bekreftet");
    expect(html).toContain("Treff:");
    expect(html).toContain("stengt");
    expect(html).toContain("/situasjoner/situation-one");
    expect(html).not.toContain("deliveryState");
    expect(html).not.toContain("subscription");
  });

  it("carries stale morning brief status into the public analysis signal module", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseSignalPanel
          brief={{ ...brief, generatedAt: "2026-06-30T07:30:00.000Z" }}
          now={new Date("2026-07-03T12:00:00.000Z")}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Eldre brief");
    expect(html).toContain("Oppdatert 30. juni");
    expect(html).toContain("freshness-tone-stale");
  });
});

describe("MapTimeSlider", () => {
  it("renders a compact age slider for the public nearby map", () => {
    const html = renderToStaticMarkup(<MapTimeSlider value="24h" />);

    expect(html).toContain("Kartperiode");
    expect(html).toContain("24 timer");
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Filtrer kart etter alder"');
    expect(html).toContain('aria-valuetext="24 timer"');
  });
});

describe("MapClusterSummary", () => {
  it("explains when the public map has compressed stories into fewer markers", () => {
    const html = renderToStaticMarkup(
      <MapClusterSummary
        summary={{ storyCount: 8, markerCount: 5, clusterCount: 2, compressedStoryCount: 3 }}
      />,
    );

    expect(html).toContain("Kartet viser 8 stedsfestede saker som 5 markører.");
    expect(html).toContain("2 klynger samler 3 ekstra saker.");
    expect(html).toContain('aria-live="polite"');
  });

  it("keeps unclustered map summaries honest", () => {
    const html = renderToStaticMarkup(
      <MapClusterSummary
        summary={{ storyCount: 1, markerCount: 1, clusterCount: 0, compressedStoryCount: 0 }}
      />,
    );

    expect(html).toContain("Kartet viser 1 stedsfestet sak som 1 markør.");
    expect(html).toContain("Ingen punkter er slått sammen.");
  });
});

describe("PublicSourceStatusPanel", () => {
  it("summarizes public source status without exposing private collector details", () => {
    const html = renderToStaticMarkup(<PublicSourceStatusPanel sources={sourceHealth} />);

    expect(html).toContain("Kilder");
    expect(html).toContain("Delvis kildegrunnlag");
    expect(html).toContain("1 kilde trenger tilsyn blant 2 åpne kilder.");
    expect(html).toContain("NRK Trøndelag");
    expect(html).toContain("Vegvesen DATEX");
    expect(html).toContain("Avventer");
    expect(html).toContain("2 interne kontroller vises bare i Command Center.");
    expect(html).not.toContain("Basic Auth");
    expect(html).not.toContain("AI-analyse");
    expect(html).not.toContain("DeepSeek bruker");
    expect(html).not.toContain("Web Push");
  });
});

describe("LocalFocusSummaryPanel", () => {
  it("explains how many located stories are inside the chosen neighborhood radius", () => {
    const html = renderToStaticMarkup(
      <LocalFocusSummaryPanel
        label="Elgeseter"
        radiusKm={4}
        summary={{
          locatedCount: 3,
          withinRadiusCount: 2,
          closestItems: [
            {
              id: "story-one",
              title: "Fallulykke i Trondheim",
              locationLabel: "Elgeseter",
              distanceKm: 0.4,
              withinRadius: true,
            },
            {
              id: "story-two",
              title: "Trafikk ved Sluppen",
              locationLabel: "Sluppen",
              distanceKm: 2.25,
              withinRadius: true,
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Lokalt fokus");
    expect(html).toContain("Nær Elgeseter");
    expect(html).toContain("2 av 3 stedsfestede saker er innen 4 km.");
    expect(html).toContain("Fallulykke i Trondheim");
    expect(html).toContain("under 1 km unna");
    expect(html).toContain("2,3 km unna");
  });
});

describe("LocalFocusRadiusControl", () => {
  it("renders a compact radius slider for active local focus", () => {
    const html = renderToStaticMarkup(<LocalFocusRadiusControl value={10} />);

    expect(html).toContain("Radius");
    expect(html).toContain("10 km");
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Velg lokal radius"');
    expect(html).toContain('aria-valuetext="10 km"');
  });
});

describe("StoryVerificationProof", () => {
  it("renders visible verification sources with accessible detail", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StoryVerificationProof
          verification={{
            label: "Verifisert",
            detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
            sourceSummary: "Statens vegvesen DATEX + Adresseavisen",
            situationId: "datex-e6",
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Verifisert");
    expect(html).toContain("Statens vegvesen DATEX + Adresseavisen");
    expect(html).toContain("Åpne situasjonsrom");
    expect(html).toContain("/situasjoner/datex-e6");
    expect(html).toContain("Bekreftet av Statens vegvesen DATEX og Adresseavisen.");
    expect(html).toContain("sr-only");
  });

  it("renders nothing without verification data", () => {
    expect(renderToStaticMarkup(<StoryVerificationProof />)).toBe("");
  });
});

describe("StoryConfidenceBadge", () => {
  it("renders a compact confidence label with score and rationale", () => {
    const html = renderToStaticMarkup(
      <StoryConfidenceBadge
        confidence={{
          level: "confirmed",
          label: "Bekreftet",
          score: 0.98,
          sourceCount: 2,
          rationale: "Offisielle kilder og redaksjonelle kilder peker mot samme område.",
        }}
      />,
    );

    expect(html).toContain("Kildetillit: Bekreftet");
    expect(html).toContain("98 %");
    expect(html).toContain("story-confidence-confirmed");
    expect(html).toContain("Offisielle kilder og redaksjonelle kilder peker mot samme område.");
  });
});

describe("mixed free and paid story links", () => {
  it("renders paid-derived editorial copy with the free source as the main link", () => {
    const coverageBundle = {
      id: "coverage:incident:heimdal-fire",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-16T18:00:00.000Z",
    } as const;
    const paidArticle = {
      ...article,
      id: "adressa-paid-editorial",
      title: "Beboere evakuert etter brann i leilighet på Heimdal",
      excerpt:
        "Tre beboere ble evakuert etter at det begynte å brenne i en leilighet på Heimdal natt til torsdag.",
      url: "https://example.test/adressa-paid",
      access: "paid",
      category: "Nyheter",
      imageUrl: "https://example.test/adressa-editorial.jpg",
      coverageBundle,
    } satisfies Article;
    const freeArticle = {
      ...article,
      id: "nrk-free-click-target",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Brann på Heimdal",
      excerpt: "Nødetatene rykket ut til Heimdal.",
      url: "https://example.test/nrk-free",
      category: "Hendelser",
      coverageBundle,
    } satisfies Article;
    const [card] = homeStoryCardsForGroups(groupHomeArticles([paidArticle, freeArticle]));
    const render = (Component: typeof LeadStory | typeof StoryCard) =>
      renderToStaticMarkup(
        <MemoryRouter>
          <Component
            card={card!}
            saving={false}
            onSave={async () => undefined}
            canSave={false}
            canCorrect={false}
            onCorrect={() => undefined}
            canReportMissed={false}
            mergeReportPending={false}
            onReportMissed={() => undefined}
          />
        </MemoryRouter>,
      );

    for (const Component of [LeadStory, StoryCard]) {
      const html = render(Component);
      const mainMetadata = html.match(/(?:story-kicker|story-card-kicker)[^>]*>(.*?)<\/div>/s)?.[1];

      expect(html).toContain(paidArticle.title);
      expect(html).toContain(paidArticle.excerpt);
      expect(html).toContain(`href="${freeArticle.url}"`);
      if (Component === LeadStory) {
        expect(html).toContain(`src="${paidArticle.imageUrl}"`);
        expect(html).not.toContain("lead-story text-only");
      }
      expect(mainMetadata).not.toContain("Pluss");
      expect(html).toContain("Pluss");
      expect(html).toContain(`href="${paidArticle.url}"`);
    }
  });
});

describe("shouldShowStoryConfidenceBadge", () => {
  it("hides source trust noise for ordinary single-source trusted newsroom stories", () => {
    const [adressaCard] = homeStoryCardsForGroups(groupHomeArticles([article]));
    const [nrkCard] = homeStoryCardsForGroups(
      groupHomeArticles([
        {
          ...article,
          id: "nrk-story",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Nyhet fra Trondheim",
          url: "https://example.test/nrk",
        },
      ]),
    );

    expect(adressaCard?.sourceConfidence).toMatchObject({ label: "Usikker", score: 0.64 });
    expect(nrkCard?.sourceConfidence).toMatchObject({ label: "Usikker", score: 0.64 });
    expect(adressaCard ? shouldShowStoryConfidenceBadge(adressaCard) : true).toBe(false);
    expect(nrkCard ? shouldShowStoryConfidenceBadge(nrkCard) : true).toBe(false);
  });

  it("keeps source trust visible when cross-source or official verification adds signal", () => {
    const coverageBundle = {
      id: "coverage:incident:sluppen",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T07:20:00.000Z",
    } as const;
    const [clusteredCard] = homeStoryCardsForGroups(
      groupHomeArticles([
        {
          ...article,
          id: "adressa-sluppen",
          coverageBundle,
        },
        {
          ...article,
          id: "nrk-sluppen",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          coverageBundle,
        },
      ]),
    );
    const [verifiedCard] = homeStoryCardsForGroups(
      groupHomeArticles([
        {
          ...article,
          id: "verified-road",
          title: "Kollisjon stenger E6",
          publicVerification: {
            status: "verified",
            label: "Verifisert",
            detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
            officialSources: ["datex"],
            reportingSources: ["adressa"],
          },
        },
      ]),
    );

    expect(clusteredCard ? shouldShowStoryConfidenceBadge(clusteredCard) : false).toBe(true);
    expect(verifiedCard ? shouldShowStoryConfidenceBadge(verifiedCard) : false).toBe(true);
  });
});

describe("StoryEventBundleSummary", () => {
  it("makes clustered story cards read as event bundles before source articles", () => {
    const coverageBundle = {
      id: "coverage:incident:sluppen",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T07:30:00.000Z",
    } as const;
    const [card] = homeStoryCardsForGroups(
      groupHomeArticles([
        { ...article, id: "nrk-sluppen", source: "nrk", sourceLabel: "NRK", coverageBundle },
        {
          ...article,
          id: "adressa-sluppen",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          coverageBundle,
        },
      ]),
    );

    const html = renderToStaticMarkup(<StoryEventBundleSummary card={card!} />);

    expect(html).toContain("story-event-summary-hendelse");
    expect(html).toContain("Samlet hendelse");
    expect(html).toContain("2 kilder · samme hendelse på tvers av kilder");
    expect(html).toContain("Samlet bypulskort");
  });

  it("keeps single-source story cards visually quiet", () => {
    const [card] = homeStoryCardsForGroups(groupHomeArticles([article]));

    expect(renderToStaticMarkup(<StoryEventBundleSummary card={card!} />)).toBe("");
  });
});

describe("storyFeedSummary", () => {
  it("explains that City Pulse shows clustered stories, not a raw article list", () => {
    const coverageBundle = {
      id: "coverage:incident:sluppen",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T07:30:00.000Z",
    } as const;
    const storyArticle = (overrides: Partial<Article> = {}) =>
      ({
        ...article,
        ...overrides,
      }) satisfies Article;
    const cards = homeStoryCardsForGroups(
      groupHomeArticles([
        storyArticle({
          id: "nrk-sluppen",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          coverageBundle,
        }),
        storyArticle({
          id: "adressa-sluppen",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Kø ved Sluppen",
          coverageBundle,
        }),
        storyArticle({
          id: "single-culture",
          source: "vg",
          sourceLabel: "VG",
          title: "Konsert på Byscenen",
          category: "Kultur",
          url: "https://example.test/kultur",
        }),
      ]),
    );

    expect(storyFeedSummary(cards)).toBe(
      "Viser 2 bypulssaker samlet fra 3 artikler og 3 kilder. 1 kort samler flere kilder eller oppdateringer.",
    );
  });

  it("keeps empty feed summaries honest", () => {
    expect(storyFeedSummary([])).toBe("Ingen bypulssaker i denne visningen.");
  });
});

describe("StoryFeedTrustStrip", () => {
  it("summarizes verification, clustering and source confidence for visible story cards", () => {
    const coverageBundle = {
      id: "coverage:incident:e6",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T07:30:00.000Z",
    } as const;
    const storyArticle = (overrides: Partial<Article> = {}) =>
      ({
        ...article,
        ...overrides,
      }) satisfies Article;
    const cards = homeStoryCardsForGroups(
      groupHomeArticles([
        storyArticle({
          id: "adressa-e6",
          publicVerification: {
            status: "verified",
            label: "Verifisert",
            detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
            officialSources: ["datex"],
            reportingSources: ["adressa"],
            situationId: "datex-e6",
          },
          coverageBundle,
        }),
        storyArticle({
          id: "nrk-e6",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          coverageBundle,
        }),
        storyArticle({
          id: "culture",
          source: "vg",
          sourceLabel: "VG",
          title: "Konsert på Byscenen",
          category: "Kultur",
          url: "https://example.test/kultur",
        }),
      ]),
    );

    const stats = storyFeedTrustStats(cards);
    const html = renderToStaticMarkup(<StoryFeedTrustStrip cards={cards} />);

    expect(stats).toMatchObject({
      articleCount: 3,
      clusteredCount: 1,
      sourceCount: 3,
      storyCount: 2,
      verifiedCount: 1,
    });
    expect(html).toContain("Kildebilde for bypulssaker");
    expect(html).toContain("Verifisert");
    expect(html).toContain("1/2");
    expect(html).toContain("Samlet");
    expect(html).toContain("3 artikler · 3 kilder");
    expect(html).toContain("Kildetillit");
    expect(html).toContain("bekreftet eller sannsynlig");
  });

  it("renders nothing for an empty story view", () => {
    expect(renderToStaticMarkup(<StoryFeedTrustStrip cards={[]} />)).toBe("");
  });
});

describe("channelStoryCountsForCards", () => {
  it("counts clustered story cards per public channel instead of raw articles", () => {
    const storyArticle = (overrides: Partial<Article> = {}) =>
      ({
        ...article,
        ...overrides,
      }) satisfies Article;
    const cards = homeStoryCardsForGroups(
      groupHomeArticles([
        storyArticle({
          id: "nrk-traffic",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          coverageBundle: {
            id: "coverage:traffic:sluppen",
            kind: "incident",
            confidence: "high",
            reason: "Samme hendelse på tvers av kilder",
            generatedAt: "2026-07-02T07:30:00.000Z",
          },
        }),
        storyArticle({
          id: "adressa-traffic",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          coverageBundle: {
            id: "coverage:traffic:sluppen",
            kind: "incident",
            confidence: "high",
            reason: "Samme hendelse på tvers av kilder",
            generatedAt: "2026-07-02T07:30:00.000Z",
          },
        }),
        storyArticle({
          id: "culture",
          title: "Konsert på Byscenen",
          category: "Kultur",
          url: "https://example.test/culture-channel",
        }),
      ]),
    );

    expect(channelStoryCountsForCards(cards)).toMatchObject({
      Alle: 2,
      Transport: 1,
      Kultur: 1,
      Krim: 0,
    });
  });
});

describe("rankHomeStoryCardsForPublicFeed", () => {
  it("lifts high-signal story bundles inside the same freshness band without hiding newer material", () => {
    const incidentBundle = {
      id: "coverage:incident:elgeseter-fall",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T09:50:00.000Z",
    } as const;
    const publicVerification = {
      status: "verified",
      label: "Verifisert",
      detail: "Bekreftet av nødetater og redaksjonelle kilder.",
      officialSources: ["politiloggen"],
      reportingSources: ["nrk", "adressa"],
    } satisfies NonNullable<Article["publicVerification"]>;
    const storyArticle = (overrides: Partial<Article> = {}) =>
      ({
        ...article,
        ...overrides,
      }) satisfies Article;
    const cards = homeStoryCardsForGroups(
      groupHomeArticles([
        storyArticle({
          id: "culture-single",
          title: "Sommerkonsert i sentrum",
          excerpt: "Et kulturarrangement fyller byen.",
          category: "Kultur",
          source: "vg",
          sourceLabel: "VG",
          publishedAt: "2026-07-02T10:00:00.000Z",
          url: "https://example.test/culture",
        }),
        storyArticle({
          id: "nrk-fall",
          title: "Fallulykke i Trondheim",
          excerpt: "Nødetatene har rykket ut til Elgeseter.",
          category: "Hendelser",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          publishedAt: "2026-07-02T09:45:00.000Z",
          coverageBundle: incidentBundle,
          publicVerification,
          places: ["Elgeseter"],
        }),
        storyArticle({
          id: "adressa-fall",
          title: "Person skadet etter fallulykke",
          excerpt: "En person er fraktet til sykehus.",
          category: "Hendelser",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          publishedAt: "2026-07-02T09:42:00.000Z",
          coverageBundle: incidentBundle,
          places: ["Elgeseter"],
        }),
        storyArticle({
          id: "old-incident",
          title: "Tidligere utrykning på Tiller",
          excerpt: "Politiet rykket ut i morgentimene.",
          category: "Hendelser",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          publishedAt: "2026-07-02T06:20:00.000Z",
          coverageBundle: {
            id: "coverage:incident:tiller",
            kind: "incident",
            confidence: "high",
            reason: "Samme hendelse på tvers av kilder",
            generatedAt: "2026-07-02T06:30:00.000Z",
          },
          places: ["Tiller"],
        }),
      ]),
    );

    const ranked = rankHomeStoryCardsForPublicFeed(cards, { enabled: true });

    expect(ranked.map((card) => card.title)).toEqual([
      "Person skadet etter fallulykke",
      "Sommerkonsert i sentrum",
      "Tidligere utrykning på Tiller",
    ]);
    expect(rankHomeStoryCardsForPublicFeed(cards, { enabled: false })).toBe(cards);
  });
});

describe("ChannelContextPanel", () => {
  it("explains the selected public thematic channel and current view count", () => {
    const html = renderToStaticMarkup(
      <ChannelContextPanel
        category="Transport"
        count={3}
        onClear={() => undefined}
        scope="trondheim"
        timeWindow="24h"
      />,
    );

    expect(html).toContain("Tematisk kanal");
    expect(html).toContain("Trafikk");
    expect(html).toContain("Trafikk, kollektiv, vegmeldinger og framkommelighet.");
    expect(html).toContain("3 bypulssaker i gjeldende visning · Trondheim · siste 24 timer");
    expect(html).toContain("Vis alle kanaler");
    expect(html).toContain('aria-label="Valgt tematisk kanal"');
  });

  it("does not offer a redundant clear action on the all-channel view", () => {
    const html = renderToStaticMarkup(
      <ChannelContextPanel category="Alle" count={7} scope="trondelag" timeWindow="all" />,
    );

    expect(html).toContain("Alle");
    expect(html).toContain("7 bypulssaker i gjeldende visning · Trøndelag · hele tidslinjen");
    expect(html).not.toContain("Vis alle kanaler");
  });
});
