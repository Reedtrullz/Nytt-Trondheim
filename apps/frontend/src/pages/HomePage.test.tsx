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
  LocalFocusRadiusControl,
  LocalFocusSummaryPanel,
  MapClusterSummary,
  MapTimeSlider,
  MorningBriefPanel,
  PublicSourceStatusPanel,
  StoryConfidenceBadge,
  StoryEventBundleSummary,
  StoryFeedTrustStrip,
  StoryVerificationProof,
  channelStoryCountsForCards,
  cityPulseDataForCurrentFeed,
  cityPulseLatestTimestamp,
  mergeCityPulseStoryLists,
  morningBriefFreshness,
  rankHomeStoryCardsForPublicFeed,
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
  it("uses the shared dashboard layout for public briefing and situation modules", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseDashboard data={bootstrap} />
      </MemoryRouter>,
    );

    expect(html).toContain("Bypulsmoduler");
    expect(html).toContain("City Pulse");
    expect(html).toContain("Dagens oversikt");
    expect(html).toContain("dashboard-layout-city-pulse");
    expect(html).toContain("dashboard-widget-full");
    expect(html).toContain("Morgenbrief");
    expect(html).toContain("Varsel og analysespor");
    expect(html).toContain("Slik vurderes høyeffekt-signaler");
    expect(html).toContain("Liv og helse");
    expect(html).toContain("Stengte hovedårer");
    expect(html).toContain("Høyeffektsaker fanget av varselreglene");
    expect(html).toContain("1 aktive");
    expect(html).toContain("Situasjonsrommet er offentlig bekreftet.");
    expect(html).not.toContain("Flytt Morgenbrief senere");
    expect(html).toContain("Tilpass oppsett");
    expect(html).not.toContain("Tilbakestill");
    expect(html).not.toContain("Dashboard-oppsett");
    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("Kildetillit: Bekreftet");
    expect(html).toContain("91 %");
  });

  it("renders a deterministic morning brief fallback when no stored brief exists", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseDashboard data={{ articles: [], situations: [], sourceHealth: [] }} />
      </MemoryRouter>,
    );

    expect(html).toContain("Reservebrief");
    expect(html).toContain("Morgenbildet er rolig");
    expect(html).toContain("dashboard-layout-city-pulse");
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
      },
    ]);
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
      "Fallulykke i Trondheim",
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
