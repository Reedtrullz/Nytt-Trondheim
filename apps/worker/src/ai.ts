import OpenAI from "openai";
import { z } from "zod";
import type { Article } from "@nytt/shared";

const resultSchema = z.object({
  clusters: z.array(
    z.object({
      title: z.string(),
      type: z.enum([
        "fire",
        "missing_person",
        "traffic",
        "flood",
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

export interface SituationAnalyzer {
  cluster(articles: Article[]): Promise<z.infer<typeof resultSchema>>;
}

export class NoopAnalyzer implements SituationAnalyzer {
  async cluster() {
    return { clusters: [] };
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

  async cluster(articles: Article[]) {
    const publicInputs = articles.map(
      ({ id, title, excerpt, sourceLabel, publishedAt, places }) => ({
        id,
        title,
        excerpt,
        sourceLabel,
        publishedAt,
        places,
      }),
    );
    const response = await this.client.responses.create({
      model: this.model,
      input:
        "Group only developing public incidents described by two independent news sources. " +
        "Do not infer locations, responder actions, perimeters, identities, or private details. " +
        `Return JSON with clusters/title/type/articleIds/namedPlaces/citedClaims from these feed excerpts: ${JSON.stringify(publicInputs)}`,
    });
    return resultSchema.parse(JSON.parse(response.output_text));
  }
}

export function createAnalyzer(): SituationAnalyzer {
  return process.env.OPENAI_API_KEY
    ? new OpenAiAnalyzer(process.env.OPENAI_API_KEY)
    : new NoopAnalyzer();
}
