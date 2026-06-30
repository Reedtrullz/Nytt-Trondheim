import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type { AiProcessingRun, Article, EvidenceItem, Situation } from "@nytt/shared";

const citedClaimSchema = z.object({
  claim: z.string(),
  articleId: z.string(),
  supportingSnippet: z.string(),
});

const resultSchema = z.object({
  clusters: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      type: z.enum([
        "fire",
        "missing_person",
        "traffic",
        "flood",
        "landslide",
        "weather",
        "rescue",
        "service_disruption",
        "other",
      ]),
      articleIds: z.array(z.string()),
      namedPlaces: z.array(z.string()),
      citedClaims: z.array(citedClaimSchema),
    }),
  ),
  situationUpdates: z
    .array(
      z.object({
        situationId: z.string(),
        articleIds: z.array(z.string()),
        summary: z.string(),
        citedClaims: z.array(citedClaimSchema),
      }),
    )
    .default([]),
  bundleHints: z
    .array(
      z.object({
        title: z.string(),
        articleIds: z.array(z.string()),
        reason: z.string(),
        citedClaims: z.array(citedClaimSchema),
      }),
    )
    .default([]),
  categoryHints: z
    .array(
      z.object({
        articleId: z.string(),
        category: z.enum([
          "Nyheter",
          "Hendelser",
          "Krim",
          "Byutvikling",
          "Kultur",
          "Sport",
          "Transport",
          "Politikk",
          "Vær",
        ]),
        topic: z.enum(["rosenborg"]).optional(),
        reason: z.string(),
        supportingSnippet: z.string(),
      }),
    )
    .default([]),
  relevanceHints: z
    .array(
      z.object({
        articleId: z.string(),
        scope: z.enum(["trondheim", "trondelag", "ignore"]),
        reason: z.string(),
        supportingSnippet: z.string(),
      }),
    )
    .default([]),
  operationsNotes: z
    .array(
      z.object({
        kind: z.enum([
          "situation_progress",
          "bundle_candidate",
          "category_relevance",
          "source_quality",
          "other",
        ]),
        subjectId: z.string().optional(),
        summary: z.string(),
        citedClaims: z.array(citedClaimSchema),
      }),
    )
    .default([]),
});

type AnalysisResult = z.infer<typeof resultSchema>;

export type DeepSeekAnalysisResult = AnalysisResult;

export interface AnalysisContext {
  situations?: Situation[];
}

export interface AnalysisOutcome {
  result: AnalysisResult;
  run: AiProcessingRun;
}

export interface SituationAnalyzer {
  cluster(articles: Article[], context?: AnalysisContext): Promise<AnalysisOutcome>;
}

function run(
  provider: AiProcessingRun["provider"],
  model: string,
  status: AiProcessingRun["status"],
  startedAt: string,
  articles: Article[],
  result: unknown,
  error?: string,
): AiProcessingRun {
  return {
    id: randomUUID(),
    provider,
    model,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    articleIds: articles.map((article) => article.id),
    result,
    error,
  };
}

export class NoopAnalyzer implements SituationAnalyzer {
  async cluster(articles: Article[]) {
    const startedAt = new Date().toISOString();
    const result = emptyAnalysisResult();
    return { result, run: run("deterministic", "none", "disabled", startedAt, articles, result) };
  }
}

export class DeepSeekAnalyzer implements SituationAnalyzer {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  ) {
    this.client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
  }

  async cluster(articles: Article[], context: AnalysisContext = {}): Promise<AnalysisOutcome> {
    const startedAt = new Date().toISOString();
    const publicInputs = articles.map(
      ({ id, title, excerpt, source, sourceLabel, publishedAt, places }) => ({
        id,
        title,
        excerpt,
        source,
        sourceLabel,
        publishedAt,
        places,
      }),
    );
    const situationInputs = (context.situations ?? [])
      .filter((situation) => situation.status === "preliminary" || situation.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 30)
      .map(({ id, type, title, summary, status, updatedAt, locationLabel, relatedArticleIds }) => ({
        id,
        type,
        title,
        summary,
        status,
        updatedAt,
        locationLabel,
        relatedArticleIds,
      }));
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content:
                'Return JSON only in the supplied shape. Use only public article excerpts and the supplied situation summaries. Identify developing public incidents only. Group an incident only when at least two independent source labels discuss the same event type and place. Situation update hints must only link supplied articles to supplied active/preliminary situations when the article text is clearly progress or a direct update for the same incident. Bundle hints are suggestions for same-story rows, not evidence. Category and relevance hints are suggestions only. Return at most 8 clusters, 8 situationUpdates, 12 bundleHints, 20 categoryHints, 20 relevanceHints and 12 operationsNotes. Cite literal supporting excerpts for every claim. Do not infer locations, perimeters, responder activity, identities or private facts. JSON shape: {"clusters":[{"title":"string","summary":"string","type":"fire|missing_person|traffic|flood|landslide|weather|rescue|service_disruption|other","articleIds":["string"],"namedPlaces":["string"],"citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}],"situationUpdates":[{"situationId":"string","articleIds":["string"],"summary":"string","citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}],"bundleHints":[{"title":"string","articleIds":["string"],"reason":"string","citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}],"categoryHints":[{"articleId":"string","category":"Nyheter|Hendelser|Krim|Byutvikling|Kultur|Sport|Transport|Politikk|Vær","topic":"rosenborg","reason":"string","supportingSnippet":"string"}],"relevanceHints":[{"articleId":"string","scope":"trondheim|trondelag|ignore","reason":"string","supportingSnippet":"string"}],"operationsNotes":[{"kind":"situation_progress|bundle_candidate|category_relevance|source_quality|other","subjectId":"string","summary":"string","citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}]}. Use empty arrays when uncertain.',
            },
            {
              role: "user",
              content: `Analyze these public feed excerpts and active situations and output JSON: ${JSON.stringify(
                {
                  articles: publicInputs,
                  situations: situationInputs,
                },
              )}`,
            },
            ...(attempt === 1
              ? [
                  {
                    role: "system" as const,
                    content:
                      'The previous completion was not valid structured output. Return one compact, syntactically valid JSON object only. Use {"clusters":[],"situationUpdates":[],"bundleHints":[],"categoryHints":[],"relevanceHints":[],"operationsNotes":[]} when uncertain.',
                  },
                ]
              : []),
          ],
          response_format: { type: "json_object" },
          max_tokens: 8192,
        });
        const content = response.choices[0]?.message.content;
        if (!content) throw new Error("DeepSeek returned empty JSON content.");
        const parsed = resultSchema.parse(JSON.parse(content));
        const validated = validateCitations(parsed, articles);
        return {
          result: validated,
          run: run("deepseek", this.model, "ok", startedAt, articles, validated),
        };
      } catch (error) {
        lastError = error;
      }
    }
    const result: AnalysisResult = emptyAnalysisResult();
    return {
      result,
      run: run("deepseek", this.model, "degraded", startedAt, articles, result, String(lastError)),
    };
  }
}

function emptyAnalysisResult(): AnalysisResult {
  return {
    clusters: [],
    situationUpdates: [],
    bundleHints: [],
    categoryHints: [],
    relevanceHints: [],
    operationsNotes: [],
  };
}

function articleById(articles: Article[]): Map<string, Article> {
  return new Map(articles.map((article) => [article.id, article]));
}

function supportedClaims<T extends { articleId: string; supportingSnippet: string }>(
  claims: T[],
  articles: Map<string, Article>,
): T[] {
  return claims.filter((claim) => {
    const article = articles.get(claim.articleId);
    return Boolean(
      article &&
      claim.supportingSnippet.trim() &&
      article.excerpt.includes(claim.supportingSnippet.trim()),
    );
  });
}

function uniqueClaimArticleIds(
  claims: Array<{ articleId: string }>,
  availableArticleIds?: Set<string>,
): string[] {
  const ids = claims.map((claim) => claim.articleId);
  return [...new Set(availableArticleIds ? ids.filter((id) => availableArticleIds.has(id)) : ids)];
}

export function validateCitations(
  result: AnalysisResult | ({ clusters: AnalysisResult["clusters"] } & Partial<AnalysisResult>),
  articles: Article[],
): AnalysisResult {
  const completeResult = { ...emptyAnalysisResult(), ...result };
  const inputs = articleById(articles);
  return {
    clusters: completeResult.clusters.flatMap((cluster) => {
      const claims = supportedClaims(cluster.citedClaims, inputs);
      const articleIds = [...new Set(claims.map((claim) => claim.articleId))];
      const sources = new Set(articleIds.map((id) => inputs.get(id)?.source).filter(Boolean));
      return sources.size >= 2 ? [{ ...cluster, citedClaims: claims, articleIds }] : [];
    }),
    situationUpdates: completeResult.situationUpdates.flatMap((hint) => {
      const claims = supportedClaims(hint.citedClaims, inputs);
      const articleIds = uniqueClaimArticleIds(claims, new Set(hint.articleIds));
      return articleIds.length > 0 ? [{ ...hint, citedClaims: claims, articleIds }] : [];
    }),
    bundleHints: completeResult.bundleHints.flatMap((hint) => {
      const claims = supportedClaims(hint.citedClaims, inputs);
      const articleIds = uniqueClaimArticleIds(claims, new Set(hint.articleIds));
      return articleIds.length >= 2 ? [{ ...hint, citedClaims: claims, articleIds }] : [];
    }),
    categoryHints: completeResult.categoryHints.filter((hint) => {
      const article = inputs.get(hint.articleId);
      return Boolean(
        article &&
        hint.supportingSnippet.trim() &&
        article.excerpt.includes(hint.supportingSnippet.trim()),
      );
    }),
    relevanceHints: completeResult.relevanceHints.filter((hint) => {
      const article = inputs.get(hint.articleId);
      return Boolean(
        article &&
        hint.supportingSnippet.trim() &&
        article.excerpt.includes(hint.supportingSnippet.trim()),
      );
    }),
    operationsNotes: completeResult.operationsNotes.flatMap((note) => {
      const claims = supportedClaims(note.citedClaims, inputs);
      return claims.length > 0 ? [{ ...note, citedClaims: claims }] : [];
    }),
  };
}

export function enhanceSituations(
  situations: Situation[],
  analysis: AnalysisResult,
  articles: Article[],
): Situation[] {
  const inputs = new Map(articles.map((article) => [article.id, article]));
  return situations.map((situation) => {
    const candidate = analysis.clusters.find(
      (cluster) =>
        cluster.type === situation.type &&
        cluster.articleIds.filter((id) => situation.relatedArticleIds.includes(id)).length >= 2,
    );
    if (!candidate) return situation;
    const aiEvidence: EvidenceItem[] = candidate.citedClaims.map((claim) => {
      const article = inputs.get(claim.articleId)!;
      return {
        id: `ai-${situation.id}-${claim.articleId}`,
        situationId: situation.id,
        source: article.source,
        sourceLabel: article.sourceLabel,
        sourceUrl: article.url,
        supportingSnippet: claim.supportingSnippet,
        claim: claim.claim,
        claimType: "ai_cited_summary",
        provenance: "reporting_estimate",
        confidence: 0.7,
        extractedAt: new Date().toISOString(),
        publishedAt: article.publishedAt,
      };
    });
    return {
      ...situation,
      title: candidate.title,
      summary: candidate.summary,
      evidence: [
        ...new Map(
          [...situation.evidence, ...aiEvidence].map((evidence) => [evidence.id, evidence]),
        ).values(),
      ],
    };
  });
}

function hashId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 18);
}

function laterTimestamp(left: string, right: string): string {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

export function applySituationUpdateHints(
  situations: Situation[],
  analysis: AnalysisResult,
  articles: Article[],
  extractedAt = new Date().toISOString(),
): Situation[] {
  const inputs = articleById(articles);
  const situationsById = new Map(situations.map((situation) => [situation.id, situation]));
  return analysis.situationUpdates.flatMap((hint) => {
    const situation = situationsById.get(hint.situationId);
    if (!situation || situation.status === "resolved" || situation.status === "dismissed")
      return [];
    const hintedArticles = hint.articleIds.flatMap((articleId) => {
      const article = inputs.get(articleId);
      return article ? [article] : [];
    });
    if (hintedArticles.length === 0 || hint.citedClaims.length === 0) return [];
    const relatedArticleIds = [...new Set([...situation.relatedArticleIds, ...hint.articleIds])];
    const evidence: EvidenceItem[] = hint.citedClaims.flatMap((claim) => {
      const article = inputs.get(claim.articleId);
      if (!article) return [];
      return [
        {
          id: `ai-update-${hashId(`${situation.id}:${article.id}:${claim.supportingSnippet}`)}`,
          situationId: situation.id,
          source: article.source,
          sourceLabel: article.sourceLabel,
          sourceUrl: article.url,
          supportingSnippet: claim.supportingSnippet,
          claim: claim.claim,
          claimType: "ai_situation_update",
          provenance: "reporting_estimate" as const,
          confidence: 0.55,
          extractedAt,
          publishedAt: article.publishedAt,
        },
      ];
    });
    const latestArticle = hintedArticles.sort((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt),
    )[0]!;
    const timelineId = `timeline-ai-update-${hashId(
      `${situation.id}:${hint.articleIds.slice().sort().join(":")}:${hint.summary}`,
    )}`;
    return [
      {
        ...situation,
        updatedAt: laterTimestamp(situation.updatedAt, latestArticle.publishedAt),
        relatedArticleIds,
        evidence: [
          ...new Map([...situation.evidence, ...evidence].map((item) => [item.id, item])).values(),
        ],
        timeline: [
          ...new Map(
            [
              ...situation.timeline,
              {
                id: timelineId,
                situationId: situation.id,
                timestamp: latestArticle.publishedAt,
                kind: "context_update" as const,
                title: "Mulig relevant oppdatering",
                detail: hint.summary,
                sourceLabel: "Privat AI-analyse",
                source: "deepseek" as const,
                sourceUrl: latestArticle.url,
                official: false,
                provenance: "reporting_estimate" as const,
              },
            ].map((entry) => [entry.id, entry]),
          ).values(),
        ].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
      },
    ];
  });
}

export function createAnalyzer(): SituationAnalyzer {
  return process.env.DEEPSEEK_API_KEY
    ? new DeepSeekAnalyzer(process.env.DEEPSEEK_API_KEY)
    : new NoopAnalyzer();
}
