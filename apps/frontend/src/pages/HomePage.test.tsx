import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Article, BootstrapPayload, MorningBrief } from "@nytt/shared";
import {
  CityPulseDashboard,
  MapTimeSlider,
  MorningBriefPanel,
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

  it("renders nothing when there are no public dashboard modules", () => {
    expect(
      renderToStaticMarkup(
        <CityPulseDashboard data={{ articles: [], situations: [], sourceHealth: [] }} />,
      ),
    ).toBe("");
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
