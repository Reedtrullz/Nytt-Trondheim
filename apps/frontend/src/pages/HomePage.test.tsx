import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Article, BootstrapPayload, MorningBrief } from "@nytt/shared";
import {
  CityPulseDashboard,
  CityPulseSignalPanel,
  LocalFocusSummaryPanel,
  MapTimeSlider,
  MorningBriefPanel,
  StoryConfidenceBadge,
  StoryVerificationProof,
  cityPulseDataForCurrentFeed,
  morningBriefFreshness,
  storyFeedSummary,
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

const bootstrap = {
  articles: [article],
  articleNextCursor: "next-page",
  situations: [situation],
  sourceHealth: [],
  morningBrief: brief,
} satisfies BootstrapPayload;

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

    expect(html).toContain("AI-assistert");
    expect(html).toContain("Morgenbrief");
    expect(html).toContain("Morgenbrief-ferskhet");
    expect(html).toContain("Oppdatert i dag");
    expect(html).toContain("Trafikktrøbbel sør i byen");
    expect(html).toContain("AI-assistert · 5/6 kilder OK");
    expect(html).toContain("AI-spor");
    expect(html).toContain("DeepSeek");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain("OK");
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
    expect(html).toContain("Varsel og AI-spor");
    expect(html).toContain("Slik vurderes høyeffekt-signaler");
    expect(html).toContain("Liv og helse");
    expect(html).toContain("Stengte hovedårer");
    expect(html).not.toContain("Flytt Morgenbrief senere");
    expect(html).not.toContain("Tilbakestill");
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
    expect(data.articleNextCursor).toBe(bootstrap.articleNextCursor);
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
    expect(data.morningBrief).toBeUndefined();
    expect(data.articleNextCursor).toBeUndefined();
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
  it("renders public alert guidance and AI trace status without private delivery details", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CityPulseSignalPanel brief={brief} now={new Date("2026-07-02T12:00:00.000Z")} />
      </MemoryRouter>,
    );

    expect(html).toContain("Varsel og AI-spor");
    expect(html).toContain("AI-assistert");
    expect(html).toContain("09:25");
    expect(html).toContain("Brief-ferskhet");
    expect(html).toContain("Oppdatert i dag");
    expect(html).toContain("4 offentlige kategorier");
    expect(html).toContain("Liv og helse");
    expect(html).toContain("Viktige bortfall");
    expect(html).toContain("/varsler");
    expect(html).not.toContain("triggerId");
    expect(html).not.toContain("endpoint");
    expect(html).not.toContain("Abonnementer");
  });

  it("carries stale morning brief status into the public AI signal module", () => {
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
