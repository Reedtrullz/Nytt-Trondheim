import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { CommandCenterBriefingPayload } from "@nytt/shared";
import { CommandBriefingDashboard } from "./CommandBriefingPage.js";

const briefing: CommandCenterBriefingPayload = {
  generatedAt: "2026-07-02T07:00:00.000Z",
  morningBrief: {
    generatedAt: "2026-07-02T07:00:00.000Z",
    title: "Morgenbrief",
    mode: "ai_assisted",
    sourceLine: "AI-assistert · 1/2 kilder OK",
    paragraphs: [
      "Trafikken er rolig, men beredskap følger lokale hendelser.",
      "En sak om Lade følges av flere redaksjoner.",
      "Ingen nye offentlige farevarsler dominerer bildet.",
    ],
    highlights: [
      { label: "Saker", value: "12", detail: "Hendelser leder bildet" },
      { label: "Situasjoner", value: "2", detail: "Aktive eller til vurdering" },
      { label: "Kilder", value: "1/2", detail: "Rapporterer OK" },
    ],
    articleIds: ["article:one"],
    situationIds: ["situation:one"],
    aiRun: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      status: "ok",
      completedAt: "2026-07-02T07:00:01.000Z",
    },
  },
  latestAiRun: {
    id: "ai:one",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    status: "ok",
    startedAt: "2026-07-02T06:59:00.000Z",
    completedAt: "2026-07-02T07:00:01.000Z",
    articleCount: 24,
    diagnostics: {
      profile: "brief_only_recovery",
      attempts: [
        {
          profile: "standard",
          status: "failed",
          maxTokens: 4096,
          articleCount: 12,
          situationCount: 12,
          error: "DeepSeek JSON response was truncated by token limit.",
        },
        {
          profile: "compact_recovery",
          status: "failed",
          maxTokens: 2048,
          articleCount: 8,
          situationCount: 6,
          error: "DeepSeek returned empty JSON content.",
        },
        {
          profile: "brief_only_recovery",
          status: "ok",
          maxTokens: 900,
          articleCount: 6,
          situationCount: 3,
        },
      ],
    },
  },
  operationsNotes: [
    {
      kind: "bundle_candidate",
      subjectId: "bundle:lade",
      summary: "Flere kilder omtaler samme hendelse på Lade.",
      citedClaims: [
        {
          claim: "Samme hendelse",
          articleId: "article:one",
          supportingSnippet: "hendelse på Lade",
        },
      ],
    },
  ],
  supportingArticles: [
    {
      id: "article:one",
      title: "Hendelse på Lade",
      sourceLabel: "NRK Trøndelag",
      publishedAt: "2026-07-02T06:55:00.000Z",
      category: "Hendelser",
      excerpt: "Politiet følger en hendelse på Lade.",
      url: "https://example.test/article",
    },
  ],
  supportingSituations: [
    {
      id: "situation:one",
      title: "Hendelse på Lade",
      summary: "Offentlig bekreftet hendelse.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      createdAt: "2026-07-02T06:50:00.000Z",
      updatedAt: "2026-07-02T06:59:00.000Z",
      locationLabel: "Lade",
    },
  ],
  sourceHealthSummary: {
    total: 2,
    ok: 1,
    attention: 1,
    degraded: 1,
    disabled: 0,
    staleAlerts: 0,
  },
  attentionSources: [
    {
      source: "deepseek",
      label: "AI-analyse",
      state: "degraded",
      detail: "Siste kjøring degraderte.",
      lastCheckedAt: "2026-07-02T07:00:01.000Z",
    },
  ],
};

describe("CommandBriefingDashboard", () => {
  it("renders the owner briefing review with AI traceability and support context", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CommandBriefingDashboard briefing={briefing} />
      </MemoryRouter>,
    );

    expect(html).toContain("Brief-revisjon");
    expect(html).toContain("AI-assistert");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain("Kun morgenbrief");
    expect(html).toContain("Kompakt gjenoppretting feilet");
    expect(html).toContain("/command/radata?run=ai%3Aone");
    expect(html).toContain("Hendelse på Lade");
    expect(html).toContain("Flere kilder omtaler samme hendelse");
    expect(html).toContain("AI-analyse");
    expect(html).not.toContain("Slå sammen");
    expect(html).not.toContain("Godkjenn brief");
  });
});
