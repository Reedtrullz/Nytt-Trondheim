import { afterEach, describe, expect, it, vi } from "vitest";
import type { Article, Situation } from "@nytt/shared";
import {
  applySituationUpdateHints,
  createAnalyzer,
  DeepSeekAnalyzer,
  deepSeekAnalysisEnabled,
  NoopAnalyzer,
  validateCitations,
} from "../src/ai.js";

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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI citation validation", () => {
  it("keeps DeepSeek opt-in even when an API key is configured", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_ANALYSIS_ENABLED", "false");

    expect(deepSeekAnalysisEnabled()).toBe(false);
    expect(createAnalyzer()).toBeInstanceOf(NoopAnalyzer);
  });

  it("creates DeepSeek analyzer only when explicitly enabled and keyed", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_ANALYSIS_ENABLED", "true");

    expect(deepSeekAnalysisEnabled()).toBe(true);
    expect(createAnalyzer()).toBeInstanceOf(DeepSeekAnalyzer);
  });

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
    expect(outcome.result).toMatchObject({
      clusters: [],
      situationUpdates: [],
      bundleHints: [],
      categoryHints: [],
      relevanceHints: [],
      operationsNotes: [],
      diagnostics: {
        profile: "compact_recovery",
        attempts: [
          expect.objectContaining({ profile: "standard", status: "failed" }),
          expect.objectContaining({ profile: "compact_recovery", status: "ok" }),
        ],
      },
    });
  });

  it("retries truncated DeepSeek completions and accepts fenced JSON", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "length", message: { content: '{"clusters":[]}' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '```json\n{"clusters":[]}\n```' } }],
      });
    const analyzer = new DeepSeekAnalyzer("test-key", "test-model");
    Object.assign(analyzer, { client: { chat: { completions: { create } } } });

    const outcome = await analyzer.cluster(articles);

    expect(create).toHaveBeenCalledTimes(2);
    expect(outcome.run.status).toBe("ok");
    const firstRequest = create.mock.calls[0]?.[0] as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    const retryRequest = create.mock.calls[1]?.[0] as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(firstRequest.max_tokens).toBe(4096);
    expect(retryRequest.max_tokens).toBe(2048);
    expect(retryRequest.messages[0]?.content).toContain("compact recovery pass");
    expect(retryRequest.messages[0]?.content).toContain("at most 2 clusters");
    expect(outcome.result.diagnostics).toMatchObject({
      profile: "compact_recovery",
      attempts: [
        { profile: "standard", status: "failed", maxTokens: 4096 },
        { profile: "compact_recovery", status: "ok", maxTokens: 2048 },
      ],
    });
  });

  it("treats blank optional category topics as omitted", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              clusters: [],
              categoryHints: [
                {
                  articleId: "one",
                  category: "Sport",
                  topic: "",
                  reason: "Artikkelen omtaler Rosenborg.",
                  supportingSnippet: "Røyk er observert",
                },
              ],
            }),
          },
        },
      ],
    });
    const analyzer = new DeepSeekAnalyzer("test-key", "test-model");
    Object.assign(analyzer, { client: { chat: { completions: { create } } } });

    const outcome = await analyzer.cluster(articles);

    expect(outcome.run.status).toBe("ok");
    expect(outcome.result.categoryHints).toHaveLength(1);
    expect(outcome.result.categoryHints[0]).toMatchObject({
      articleId: "one",
      category: "Sport",
    });
    expect(outcome.result.categoryHints[0]?.topic).toBeUndefined();
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

  it("bounds DeepSeek request payloads before sending public context", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ choices: [{ message: { content: '{"clusters":[]}' } }] });
    const analyzer = new DeepSeekAnalyzer("test-key", "test-model");
    Object.assign(analyzer, { client: { chat: { completions: { create } } } });
    const manyArticles = Array.from({ length: 14 }, (_, index) => ({
      ...articles[0]!,
      id: `article-${index}`,
      title: `Lang tittel ${index} ${"x".repeat(400)}`,
      excerpt: `Lang ingress ${index} ${"y".repeat(1600)}`,
      places: [`${"z".repeat(160)}`],
    }));
    const manySituations: Situation[] = Array.from({ length: 14 }, (_, index) => ({
      id: `situation-${index}`,
      type: "fire",
      title: `Lang situasjon ${index} ${"t".repeat(400)}`,
      summary: `Lang oppsummering ${index} ${"s".repeat(1600)}`,
      status: "active",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "normal",
      updatedAt: `2026-05-26T${String(index).padStart(2, "0")}:30:00Z`,
      createdAt: "2026-05-26T09:00:00Z",
      locationLabel: `${"p".repeat(160)}`,
      relatedArticleIds: [],
      evidence: [],
      features: [],
      timeline: [],
    }));

    await analyzer.cluster(manyArticles, { situations: manySituations });

    const request = create.mock.calls[0]?.[0] as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = request.messages.find((message) => message.role === "user");
    const payloadPrefix =
      "Analyze these public feed excerpts and active situations and output JSON: ";
    const payload = JSON.parse(userMessage?.content.replace(payloadPrefix, "") ?? "{}") as {
      articles: Array<{ title: string; excerpt: string; places: string[] }>;
      situations: Array<{ title: string; summary: string; locationLabel: string }>;
    };

    expect(request.max_tokens).toBe(4096);
    expect(payload.articles).toHaveLength(12);
    expect(payload.situations).toHaveLength(12);
    expect(payload.articles[0]?.title.length).toBeLessThanOrEqual(180);
    expect(payload.articles[0]?.excerpt.length).toBeLessThanOrEqual(900);
    expect(payload.articles[0]?.places[0]?.length).toBeLessThanOrEqual(80);
    expect(payload.situations[0]?.summary.length).toBeLessThanOrEqual(700);
    expect(payload.situations[0]?.locationLabel.length).toBeLessThanOrEqual(80);
  });

  it("shrinks retry payloads after output-format failures", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "length", message: { content: '{"clusters":[]}' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '{"clusters":[]}' } }],
      });
    const analyzer = new DeepSeekAnalyzer("test-key", "test-model");
    Object.assign(analyzer, { client: { chat: { completions: { create } } } });
    const manyArticles = Array.from({ length: 14 }, (_, index) => ({
      ...articles[0]!,
      id: `article-${index}`,
      title: `Lang tittel ${index} ${"x".repeat(400)}`,
      excerpt: `Lang ingress ${index} ${"y".repeat(1600)}`,
      places: [`${"z".repeat(160)}`],
    }));
    const manySituations: Situation[] = Array.from({ length: 14 }, (_, index) => ({
      id: `situation-${index}`,
      type: "fire",
      title: `Lang situasjon ${index} ${"t".repeat(400)}`,
      summary: `Lang oppsummering ${index} ${"s".repeat(1600)}`,
      status: "active",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "normal",
      updatedAt: `2026-05-26T${String(index).padStart(2, "0")}:30:00Z`,
      createdAt: "2026-05-26T09:00:00Z",
      locationLabel: `${"p".repeat(160)}`,
      relatedArticleIds: [],
      evidence: [],
      features: [],
      timeline: [],
    }));

    await analyzer.cluster(manyArticles, { situations: manySituations });

    const firstRequest = create.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const retryRequest = create.mock.calls[1]?.[0] as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    const payloadPrefix =
      "Analyze these public feed excerpts and active situations and output JSON: ";
    const firstPayload = JSON.parse(
      firstRequest.messages
        .find((message) => message.role === "user")
        ?.content.replace(payloadPrefix, "") ?? "{}",
    ) as { articles: unknown[]; situations: unknown[] };
    const retryPayload = JSON.parse(
      retryRequest.messages
        .find((message) => message.role === "user")
        ?.content.replace(payloadPrefix, "") ?? "{}",
    ) as {
      articles: Array<{ title: string; excerpt: string; places: string[] }>;
      situations: Array<{ summary: string; locationLabel: string }>;
    };

    expect(firstPayload.articles).toHaveLength(12);
    expect(firstPayload.situations).toHaveLength(12);
    expect(retryRequest.max_tokens).toBe(2048);
    expect(retryPayload.articles).toHaveLength(8);
    expect(retryPayload.situations).toHaveLength(6);
    expect(retryPayload.articles[0]?.title.length).toBeLessThanOrEqual(140);
    expect(retryPayload.articles[0]?.excerpt.length).toBeLessThanOrEqual(520);
    expect(retryPayload.articles[0]?.places[0]?.length).toBeLessThanOrEqual(60);
    expect(retryPayload.situations[0]?.summary.length).toBeLessThanOrEqual(420);
    expect(retryPayload.situations[0]?.locationLabel.length).toBeLessThanOrEqual(60);
  });

  it("falls back to a brief-only DeepSeek pass after repeated structured output failures", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "length", message: { content: '{"clusters":[]}' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "length", message: { content: '{"clusters":[]}' } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                morningBrief: {
                  paragraphs: [
                    "Morgenbildet er rolig, men følges tett.",
                    "Flere kilder omtaler røyk og beredskap.",
                    "Nytt oppdaterer når sikre kilder gir mer.",
                  ],
                },
                clusters: [],
                situationUpdates: [],
                bundleHints: [],
                categoryHints: [],
                relevanceHints: [],
                operationsNotes: [],
              }),
            },
          },
        ],
      });
    const analyzer = new DeepSeekAnalyzer("test-key", "test-model");
    Object.assign(analyzer, { client: { chat: { completions: { create } } } });
    const manyArticles = Array.from({ length: 14 }, (_, index) => ({
      ...articles[0]!,
      id: `article-${index}`,
      title: `Lang tittel ${index} ${"x".repeat(400)}`,
      excerpt: `Lang ingress ${index} ${"y".repeat(1600)}`,
      places: [`${"z".repeat(160)}`],
    }));
    const manySituations: Situation[] = Array.from({ length: 14 }, (_, index) => ({
      id: `situation-${index}`,
      type: "fire",
      title: `Lang situasjon ${index} ${"t".repeat(400)}`,
      summary: `Lang oppsummering ${index} ${"s".repeat(1600)}`,
      status: "active",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "normal",
      updatedAt: `2026-05-26T${String(index).padStart(2, "0")}:30:00Z`,
      createdAt: "2026-05-26T09:00:00Z",
      locationLabel: `${"p".repeat(160)}`,
      relatedArticleIds: [],
      evidence: [],
      features: [],
      timeline: [],
    }));

    const outcome = await analyzer.cluster(manyArticles, { situations: manySituations });

    const briefRequest = create.mock.calls[2]?.[0] as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    const payloadPrefix =
      "Analyze these public feed excerpts and active situations and output JSON: ";
    const briefPayload = JSON.parse(
      briefRequest.messages
        .find((message) => message.role === "user")
        ?.content.replace(payloadPrefix, "") ?? "{}",
    ) as {
      articles: Array<{ title: string; excerpt: string; places: string[] }>;
      situations: Array<{ summary: string; locationLabel: string }>;
    };

    expect(create).toHaveBeenCalledTimes(3);
    expect(briefRequest.max_tokens).toBe(900);
    expect(briefRequest.messages[0]?.content).toContain("final morning-brief recovery pass");
    expect(briefRequest.messages[0]?.content).toContain("Do not produce clusters");
    expect(briefPayload.articles).toHaveLength(6);
    expect(briefPayload.situations).toHaveLength(3);
    expect(briefPayload.articles[0]?.title.length).toBeLessThanOrEqual(120);
    expect(briefPayload.articles[0]?.excerpt.length).toBeLessThanOrEqual(360);
    expect(briefPayload.articles[0]?.places[0]?.length).toBeLessThanOrEqual(50);
    expect(briefPayload.situations[0]?.summary.length).toBeLessThanOrEqual(260);
    expect(briefPayload.situations[0]?.locationLabel.length).toBeLessThanOrEqual(50);
    expect(outcome.run.status).toBe("ok");
    expect(outcome.result.diagnostics).toMatchObject({
      profile: "brief_only_recovery",
      attempts: [
        { profile: "standard", status: "failed", maxTokens: 4096 },
        { profile: "compact_recovery", status: "failed", maxTokens: 2048 },
        { profile: "brief_only_recovery", status: "ok", maxTokens: 900 },
      ],
    });
    expect(outcome.result.morningBrief?.paragraphs).toEqual([
      "Morgenbildet er rolig, men følges tett.",
      "Flere kilder omtaler røyk og beredskap.",
      "Nytt oppdaterer når sikre kilder gir mer.",
    ]);
    expect(outcome.result.clusters).toEqual([]);
    expect(outcome.result.bundleHints).toEqual([]);
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
