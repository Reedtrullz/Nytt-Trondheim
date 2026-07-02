import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type { AiProcessingRun, Article, EvidenceItem, Situation } from "@nytt/shared";

const citedClaimSchema = z.object({
  claim: z.string(),
  articleId: z.string(),
  supportingSnippet: z.string(),
});

const optionalCategoryTopicSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    return normalized ? normalized : undefined;
  },
  z.enum(["rosenborg"]).optional(),
);

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
        topic: optionalCategoryTopicSchema,
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

interface DeepSeekAnalyzerOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

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

const DEFAULT_DEEPSEEK_TIMEOUT_MS = 25_000;
const DEFAULT_DEEPSEEK_MAX_RETRIES = 0;
const MAX_DEEPSEEK_ARTICLES = 12;
const MAX_DEEPSEEK_SITUATIONS = 12;
const MAX_TITLE_LENGTH = 180;
const MAX_EXCERPT_LENGTH = 900;
const MAX_PLACE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 700;
const EMPTY_ANALYSIS_JSON =
  '{"clusters":[],"situationUpdates":[],"bundleHints":[],"categoryHints":[],"relevanceHints":[],"operationsNotes":[]}';

function integerFromEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function compactString(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function parseAnalysisContent(content: string): AnalysisResult {
  const normalized = stripJsonFence(content);
  if (!normalized) throw new Error("DeepSeek returned empty JSON content.");
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("DeepSeek returned no JSON object.");
  }
  return resultSchema.parse(JSON.parse(normalized.slice(firstBrace, lastBrace + 1)));
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
    options: DeepSeekAnalyzerOptions = {},
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
      timeout:
        options.timeoutMs ??
        integerFromEnv("DEEPSEEK_TIMEOUT_MS", DEFAULT_DEEPSEEK_TIMEOUT_MS, 1_000),
      maxRetries:
        options.maxRetries ??
        integerFromEnv("DEEPSEEK_MAX_RETRIES", DEFAULT_DEEPSEEK_MAX_RETRIES, 0),
    });
  }

  async cluster(articles: Article[], context: AnalysisContext = {}): Promise<AnalysisOutcome> {
    const startedAt = new Date().toISOString();
    const publicInputs = articles
      .slice(0, MAX_DEEPSEEK_ARTICLES)
      .map(({ id, title, excerpt, source, sourceLabel, publishedAt, places }) => ({
        id,
        title: compactString(title, MAX_TITLE_LENGTH),
        excerpt: compactString(excerpt, MAX_EXCERPT_LENGTH),
        source,
        sourceLabel,
        publishedAt,
        places: places.map((place) => compactString(place, MAX_PLACE_LENGTH)).filter(Boolean),
      }));
    const situationInputs = (context.situations ?? [])
      .filter((situation) => situation.status === "preliminary" || situation.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_DEEPSEEK_SITUATIONS)
      .map(({ id, type, title, summary, status, updatedAt, locationLabel, relatedArticleIds }) => ({
        id,
        type,
        title: compactString(title, MAX_TITLE_LENGTH),
        summary: compactString(summary, MAX_SUMMARY_LENGTH),
        status,
        updatedAt,
        locationLabel: compactString(locationLabel, MAX_PLACE_LENGTH),
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
              content: `Return one compact JSON object only. Use only public article excerpts and supplied situation summaries. Identify developing public incidents only. Group an incident only when at least two independent source labels discuss the same event type and place. Situation update hints must only link supplied articles to supplied active/preliminary situations when article text is clearly progress or a direct update for the same incident. Bundle/category/relevance hints are suggestions only, not evidence. Return at most 5 clusters, 5 situationUpdates, 8 bundleHints, 12 categoryHints, 12 relevanceHints and 6 operationsNotes. Keep title, summary, reason, claim and supportingSnippet strings short; supportingSnippet must be a literal article excerpt substring no longer than 160 characters. Do not infer locations, perimeters, responder activity, identities or private facts. JSON shape: {"clusters":[{"title":"string","summary":"string","type":"fire|missing_person|traffic|flood|landslide|weather|rescue|service_disruption|other","articleIds":["string"],"namedPlaces":["string"],"citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}],"situationUpdates":[{"situationId":"string","articleIds":["string"],"summary":"string","citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}],"bundleHints":[{"title":"string","articleIds":["string"],"reason":"string","citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}],"categoryHints":[{"articleId":"string","category":"Nyheter|Hendelser|Krim|Byutvikling|Kultur|Sport|Transport|Politikk|Vær","topic":"rosenborg","reason":"string","supportingSnippet":"string"}],"relevanceHints":[{"articleId":"string","scope":"trondheim|trondelag|ignore","reason":"string","supportingSnippet":"string"}],"operationsNotes":[{"kind":"situation_progress|bundle_candidate|category_relevance|source_quality|other","subjectId":"string","summary":"string","citedClaims":[{"claim":"string","articleId":"string","supportingSnippet":"string"}]}]}. Use ${EMPTY_ANALYSIS_JSON} when uncertain.`,
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
                    content: `The previous completion was not valid structured output. Return one compact, syntactically valid JSON object only. Use ${EMPTY_ANALYSIS_JSON} when uncertain.`,
                  },
                ]
              : []),
          ],
          response_format: { type: "json_object" },
          max_tokens: 4096,
        });
        const choice = response.choices[0];
        const content = choice?.message.content;
        if (choice?.finish_reason === "length") {
          throw new Error("DeepSeek JSON response was truncated by token limit.");
        }
        if (!content) throw new Error("DeepSeek returned empty JSON content.");
        const parsed = parseAnalysisContent(content);
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
