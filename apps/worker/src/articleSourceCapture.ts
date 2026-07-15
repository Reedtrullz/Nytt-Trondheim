import type { Article } from "@nytt/shared";

export interface ArticleSourceCapture {
  rawPayload: unknown;
  sourceUpdatedAt?: string;
}

// A symbol keeps collection-only evidence out of JSON/public article payloads while remaining
// attached through the object spreads used by geocoding and coverage preparation.
export const articleSourceCapture = Symbol("articleSourceCapture");

type ArticleWithSourceCapture = Article & {
  [articleSourceCapture]?: ArticleSourceCapture;
};

export function attachArticleSourceCapture(
  article: Article,
  capture: ArticleSourceCapture,
): Article {
  return Object.assign(article, { [articleSourceCapture]: capture });
}

export function sourceCaptureForArticle(article: Article): ArticleSourceCapture | undefined {
  return (article as ArticleWithSourceCapture)[articleSourceCapture];
}
