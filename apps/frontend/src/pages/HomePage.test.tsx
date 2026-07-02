import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Article, BootstrapPayload, MorningBrief } from "@nytt/shared";
import {
  CityPulseDashboard,
  LocalFocusSummaryPanel,
  MapTimeSlider,
  MorningBriefPanel,
  StoryConfidenceBadge,
  StoryVerificationProof,
} from "./HomePage.js";

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
} satisfies BootstrapPayload["situations"][number];

const bootstrap = {
  articles: [article],
  situations: [situation],
  sourceHealth: [],
  morningBrief: brief,
} satisfies BootstrapPayload;

describe("MorningBriefPanel", () => {
  it("renders the pinned public briefing with mode and highlights", () => {
    const html = renderToStaticMarkup(
      <MorningBriefPanel articles={[article]} brief={brief} situations={[situation]} />,
    );

    expect(html).toContain("AI-assistert");
    expect(html).toContain("Morgenbrief");
    expect(html).toContain("Trafikktrøbbel sør i byen");
    expect(html).toContain("AI-assistert · 5/6 kilder OK");
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
    expect(html).not.toContain("Flytt Morgenbrief senere");
    expect(html).not.toContain("Tilbakestill");
    expect(html).toContain("Steinsprang, vegen er stengt");
  });

  it("renders a deterministic morning brief fallback when no stored brief exists", () => {
    const html = renderToStaticMarkup(
      <CityPulseDashboard data={{ articles: [], situations: [], sourceHealth: [] }} />,
    );

    expect(html).toContain("Reservebrief");
    expect(html).toContain("Morgenbildet er rolig");
    expect(html).toContain("dashboard-layout-city-pulse");
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
      <StoryVerificationProof
        verification={{
          label: "Verifisert",
          detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
          sourceSummary: "Statens vegvesen DATEX + Adresseavisen",
          situationId: "datex-e6",
        }}
      />,
    );

    expect(html).toContain("Verifisert");
    expect(html).toContain("Statens vegvesen DATEX + Adresseavisen");
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
