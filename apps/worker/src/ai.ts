import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { AiProcessingRun, Article, EvidenceItem, Situation } from "@nytt/shared";

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
      citedClaims: z.array(
        z.object({ claim: z.string(), articleId: z.string(), supportingSnippet: z.string() }),
      ),
    }),
  ),
});

type AnalysisResult = z.infer<typeof resultSchema>;

export interface AnalysisOutcome {
  result: AnalysisResult;
  run: AiProcessingRun;
}

export interface SituationAnalyzer {
  cluster(articles: Article[]): Promise<AnalysisOutcome>;
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
    const result = { clusters: [] };
    return { result, run: run("deterministic", "none", "disabled", startedAt, articles, result) };
  }
}

export class OpenAiAnalyzer implements SituationAnalyzer {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async cluster(articles: Article[]): Promise<AnalysisOutcome> {
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
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        input: [
          {
            role: "system",
            content:
              "Identify developing public incidents only. Group an incident only when at least two independent source labels discuss the same event type and place. Cite literal supporting excerpts. Do not infer locations, perimeters, responder activity, identities or private facts.",
          },
          {
            role: "user",
            content: `Analyze these public feed excerpts as JSON: ${JSON.stringify(publicInputs)}`,
          },
        ],
        text: { format: zodTextFormat(resultSchema, "public_incident_clusters") },
      });
      const parsed = resultSchema.parse(response.output_parsed);
      const validated = validateCitations(parsed, articles);
      return {
        result: validated,
        run: run("openai", this.model, "ok", startedAt, articles, validated),
      };
    } catch (error) {
      const result = { clusters: [] };
      return {
        result,
        run: run("openai", this.model, "degraded", startedAt, articles, result, String(error)),
      };
    }
  }
}

export function validateCitations(result: AnalysisResult, articles: Article[]): AnalysisResult {
  const inputs = new Map(articles.map((article) => [article.id, article]));
  return {
    clusters: result.clusters.flatMap((cluster) => {
      const claims = cluster.citedClaims.filter((claim) => {
        const article = inputs.get(claim.articleId);
        return Boolean(
          article &&
          claim.supportingSnippet.trim() &&
          article.excerpt.includes(claim.supportingSnippet.trim()),
        );
      });
      const articleIds = [...new Set(claims.map((claim) => claim.articleId))];
      const sources = new Set(articleIds.map((id) => inputs.get(id)?.source).filter(Boolean));
      return sources.size >= 2 ? [{ ...cluster, citedClaims: claims, articleIds }] : [];
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

export function createAnalyzer(): SituationAnalyzer {
  return process.env.OPENAI_API_KEY
    ? new OpenAiAnalyzer(process.env.OPENAI_API_KEY)
    : new NoopAnalyzer();
}
