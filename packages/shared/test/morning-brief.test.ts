import type { Article, HomeSituationSummary, SourceHealth } from "../src/index.js";
import { buildMorningBrief } from "../src/index.js";
import { describe, expect, it } from "vitest";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-one",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Kø på E6 ved Sluppen",
    excerpt: "Trafikken står sakte sør for Trondheim.",
    url: "https://example.test/article-one",
    publishedAt: "2026-07-02T07:20:00.000Z",
    scope: "trondheim",
    category: "Transport",
    places: ["Sluppen", "Trondheim"],
    location: { lat: 63.39, lng: 10.39, label: "Sluppen" },
    ...overrides,
  };
}

const situations: HomeSituationSummary[] = [
  {
    id: "situation-one",
    title: "Steinsprang, vegen er stengt",
    summary: "Vegen er stengt ved Gangåsvegen.",
    status: "active",
    verificationStatus: "Offentlig bekreftet",
    updatedAt: "2026-07-02T07:10:00.000Z",
    createdAt: "2026-07-02T06:00:00.000Z",
    locationLabel: "Gangåsvegen",
  },
];

const sourceHealth: SourceHealth[] = [
  { source: "nrk", label: "NRK Trøndelag", state: "ok", detail: "RSS" },
  { source: "deepseek", label: "AI-analyse", state: "ok", detail: "Siste kjøring OK" },
];

describe("buildMorningBrief", () => {
  it("uses public DeepSeek clusters as the automatic-analysis second paragraph", () => {
    const brief = buildMorningBrief({
      articles: [article()],
      situations,
      sourceHealth,
      latestAiRun: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "ok",
        completedAt: "2026-07-02T07:25:00.000Z",
        result: {
          clusters: [
            {
              title: "Trafikktrøbbel sør i byen",
              summary: "Flere meldinger peker mot saktegående trafikk på E6 ved Sluppen.",
              articleIds: ["article-one"],
            },
          ],
        },
      },
      generatedAt: "2026-07-02T07:30:00.000Z",
    });

    expect(brief.mode).toBe("ai_assisted");
    expect(brief.paragraphs).toHaveLength(3);
    expect(brief.paragraphs[1]).toContain("Trafikktrøbbel sør i byen");
    expect(brief.sourceLine).toContain("Automatisk analyse");
    expect(brief.aiRun).toMatchObject({ provider: "deepseek", status: "ok" });
  });

  it("prefers generated DeepSeek morning brief paragraphs when available", () => {
    const brief = buildMorningBrief({
      articles: [article()],
      situations,
      sourceHealth,
      latestAiRun: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "ok",
        completedAt: "2026-07-02T07:25:00.000Z",
        result: {
          morningBrief: {
            paragraphs: [
              "Trondheim starter dagen med trafikk og noen få hendelser i feeden.",
              "E6 ved Sluppen peker seg ut som den mest praktiske saken å følge.",
              "Situasjonsrommet for steinsprang er fortsatt øverst i beredskapsbildet.",
            ],
          },
          clusters: [],
        },
      },
      generatedAt: "2026-07-02T07:30:00.000Z",
    });

    expect(brief.mode).toBe("ai_assisted");
    expect(brief.paragraphs).toEqual([
      "Trondheim starter dagen med trafikk og noen få hendelser i feeden.",
      "E6 ved Sluppen peker seg ut som den mest praktiske saken å følge.",
      "Situasjonsrommet for steinsprang er fortsatt øverst i beredskapsbildet.",
    ]);
  });

  it("falls back to deterministic copy when AI output is missing or degraded", () => {
    const brief = buildMorningBrief({
      articles: [
        article(),
        article({
          id: "article-two",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ny trafikkmelding ved Sluppen",
          publishedAt: "2026-07-02T07:10:00.000Z",
        }),
      ],
      situations,
      sourceHealth,
      latestAiRun: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "degraded",
        completedAt: "2026-07-02T07:25:00.000Z",
        result: { clusters: [] },
      },
      generatedAt: "2026-07-02T07:30:00.000Z",
    });

    expect(brief.mode).toBe("deterministic");
    expect(brief.paragraphs).toHaveLength(3);
    expect(brief.sourceLine).toContain("Deterministisk reserve");
    expect(brief.highlights).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Saker", value: "2" })]),
    );
  });
});
