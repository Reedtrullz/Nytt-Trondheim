import { describe, expect, it, vi } from "vitest";
import type { Article, Situation } from "@nytt/shared";
import { applySituationUpdateHints, DeepSeekAnalyzer, validateCitations } from "../src/ai.js";

const articles: Article[] = [
  {
    id: "one",
    source: "nrk",
    sourceLabel: "NRK",
    title: "Brann",
    excerpt: "Røyk er observert i Bymarka.",
    url: "https://example.test/one",
    publishedAt: "2026-05-26T10:00:00Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Bymarka"],
  },
  {
    id: "two",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Brann",
    excerpt: "Brannvesenet er varslet om røyk.",
    url: "https://example.test/two",
    publishedAt: "2026-05-26T10:10:00Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Bymarka"],
  },
];

describe("AI citation validation", () => {
  it("retains only two-source clusters supported by literal public excerpts", () => {
    const result = validateCitations(
      {
        clusters: [
          {
            title: "Brann i Bymarka",
            summary: "To kilder omtaler røyk.",
            type: "fire",
            articleIds: ["one", "two"],
            namedPlaces: ["Bymarka"],
            citedClaims: [
              { claim: "Røyk observert", articleId: "one", supportingSnippet: "Røyk er observert" },
              { claim: "Varslet", articleId: "two", supportingSnippet: "Brannvesenet er varslet" },
            ],
          },
        ],
      },
      articles,
    );
    expect(result.clusters).toHaveLength(1);
  });

  it("drops unsupported inferred citations", () => {
    const result = validateCitations(
      {
        clusters: [
          {
            title: "Brann",
            summary: "Påstand",
            type: "fire",
            articleIds: ["one", "two"],
            namedPlaces: ["Bymarka"],
            citedClaims: [
              {
                claim: "Presis perimeter",
                articleId: "one",
                supportingSnippet: "Brannen dekker 30 mål",
              },
              { claim: "Varslet", articleId: "two", supportingSnippet: "Brannvesenet er varslet" },
            ],
          },
        ],
      },
      articles,
    );
    expect(result.clusters).toEqual([]);
  });

  it("retries a malformed DeepSeek JSON completion once", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"clusters":[' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"clusters":[]}' } }] });
    const analyzer = new DeepSeekAnalyzer("test-key", "test-model");
    Object.assign(analyzer, { client: { chat: { completions: { create } } } });

    const outcome = await analyzer.cluster(articles);

    expect(create).toHaveBeenCalledTimes(2);
    expect(outcome.run.status).toBe("ok");
    expect(outcome.result).toEqual({
      clusters: [],
      situationUpdates: [],
      bundleHints: [],
      categoryHints: [],
      relevanceHints: [],
      operationsNotes: [],
    });
  });

  it("sends only open situation summaries as DeepSeek context", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ choices: [{ message: { content: '{"clusters":[]}' } }] });
    const analyzer = new DeepSeekAnalyzer("test-key", "test-model");
    Object.assign(analyzer, { client: { chat: { completions: { create } } } });
    const openSituation: Situation = {
      id: "open-one",
      type: "fire",
      title: "Røyk i Bymarka",
      summary: "Foreløpig melding.",
      status: "active",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "normal",
      updatedAt: "2026-05-26T09:30:00Z",
      createdAt: "2026-05-26T09:00:00Z",
      locationLabel: "Bymarka",
      relatedArticleIds: ["one"],
      evidence: [],
      features: [],
      timeline: [],
    };
    const resolvedSituation: Situation = {
      ...openSituation,
      id: "resolved-one",
      status: "resolved",
      relatedArticleIds: ["two"],
    };

    await analyzer.cluster(articles, { situations: [resolvedSituation, openSituation] });

    const request = create.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = request.messages.find((message) => message.role === "user");
    const payloadPrefix =
      "Analyze these public feed excerpts and active situations and output JSON: ";
    const payload = JSON.parse(userMessage?.content.replace(payloadPrefix, "") ?? "{}") as {
      articles: Array<{ id: string }>;
      situations: Array<{ id: string; relatedArticleIds: string[] }>;
    };

    expect(payload.articles.map((article) => article.id)).toEqual(["one", "two"]);
    expect(payload.situations).toEqual([
      expect.objectContaining({ id: "open-one", relatedArticleIds: ["one"] }),
    ]);
  });

  it("validates optional AI hints against literal public excerpts", () => {
    const result = validateCitations(
      {
        clusters: [],
        situationUpdates: [
          {
            situationId: "situation-one",
            articleIds: ["one", "two"],
            summary: "Røykmeldingen er oppdatert.",
            citedClaims: [
              { claim: "Røyk observert", articleId: "one", supportingSnippet: "Røyk er observert" },
              { claim: "Oppdiktet", articleId: "two", supportingSnippet: "Ikke i teksten" },
            ],
          },
        ],
        bundleHints: [
          {
            title: "Brann i Bymarka",
            articleIds: ["one", "two"],
            reason: "Begge omtaler røyk/brann.",
            citedClaims: [
              { claim: "Røyk observert", articleId: "one", supportingSnippet: "Røyk er observert" },
              { claim: "Varslet", articleId: "two", supportingSnippet: "Brannvesenet er varslet" },
            ],
          },
        ],
        categoryHints: [
          {
            articleId: "one",
            category: "Hendelser",
            reason: "Omtaler røyk.",
            supportingSnippet: "Røyk er observert",
          },
          {
            articleId: "two",
            category: "Sport",
            reason: "Unsupported.",
            supportingSnippet: "Fotballkamp",
          },
        ],
        relevanceHints: [
          {
            articleId: "one",
            scope: "trondheim",
            reason: "Bymarka er i Trondheim.",
            supportingSnippet: "Røyk er observert",
          },
        ],
        operationsNotes: [
          {
            kind: "bundle_candidate",
            summary: "Mulig samme røykhendelse.",
            citedClaims: [
              { claim: "Røyk observert", articleId: "one", supportingSnippet: "Røyk er observert" },
            ],
          },
        ],
      },
      articles,
    );

    expect(result.situationUpdates).toEqual([
      expect.objectContaining({
        situationId: "situation-one",
        articleIds: ["one"],
        citedClaims: [expect.objectContaining({ articleId: "one" })],
      }),
    ]);
    expect(result.bundleHints).toHaveLength(1);
    expect(result.categoryHints).toEqual([
      expect.objectContaining({ articleId: "one", category: "Hendelser" }),
    ]);
    expect(result.relevanceHints).toHaveLength(1);
    expect(result.operationsNotes).toHaveLength(1);
  });

  it("adds cited AI situation update hints without creating new situations", () => {
    const situation: Situation = {
      id: "situation-one",
      type: "fire",
      title: "Røyk i Bymarka",
      summary: "Foreløpig melding.",
      status: "active",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "normal",
      updatedAt: "2026-05-26T09:30:00Z",
      createdAt: "2026-05-26T09:00:00Z",
      locationLabel: "Bymarka",
      relatedArticleIds: ["one"],
      evidence: [],
      features: [],
      timeline: [],
    };
    const analysis = validateCitations(
      {
        clusters: [],
        situationUpdates: [
          {
            situationId: "situation-one",
            articleIds: ["two"],
            summary: "Brannvesenet er varslet om røyk.",
            citedClaims: [
              { claim: "Varslet", articleId: "two", supportingSnippet: "Brannvesenet er varslet" },
            ],
          },
        ],
        bundleHints: [],
        categoryHints: [],
        relevanceHints: [],
        operationsNotes: [],
      },
      articles,
    );

    const updates = applySituationUpdateHints(
      [situation],
      analysis,
      articles,
      "2026-05-26T10:20:00Z",
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "situation-one",
      relatedArticleIds: ["one", "two"],
      updatedAt: "2026-05-26T10:10:00Z",
    });
    expect(updates[0]?.evidence).toEqual([
      expect.objectContaining({
        source: "adressa",
        claimType: "ai_situation_update",
        supportingSnippet: "Brannvesenet er varslet",
      }),
    ]);
    expect(updates[0]?.timeline).toEqual([
      expect.objectContaining({
        kind: "context_update",
        source: "deepseek",
        detail: "Brannvesenet er varslet om røyk.",
      }),
    ]);
  });

  it("does not apply AI update hints to resolved situations", () => {
    const resolved: Situation = {
      id: "resolved-one",
      type: "fire",
      title: "Avsluttet",
      summary: "Ferdig.",
      status: "resolved",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "normal",
      updatedAt: "2026-05-26T09:30:00Z",
      createdAt: "2026-05-26T09:00:00Z",
      locationLabel: "Bymarka",
      relatedArticleIds: [],
      evidence: [],
      features: [],
      timeline: [],
    };

    expect(
      applySituationUpdateHints(
        [resolved],
        {
          clusters: [],
          situationUpdates: [
            {
              situationId: "resolved-one",
              articleIds: ["one"],
              summary: "Røyk observert.",
              citedClaims: [
                {
                  claim: "Røyk observert",
                  articleId: "one",
                  supportingSnippet: "Røyk er observert",
                },
              ],
            },
          ],
          bundleHints: [],
          categoryHints: [],
          relevanceHints: [],
          operationsNotes: [],
        },
        articles,
      ),
    ).toEqual([]);
  });
});
