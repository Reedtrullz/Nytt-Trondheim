import type { Article, ArticlePublicVerification } from "./types.js";
import type { ArticleCoverageAnalysis } from "./article-bundles.js";

export interface ArticleCoverageGoldenCase {
  id: string;
  articles: Article[];
  expectedSamePairs: Array<[string, string]>;
  expectedSeparatePairs: Array<[string, string]>;
  expectedGroups: string[][];
  expectedVerifiedGroups: string[][];
  critical: boolean;
  provenance: "synthetic" | "sanitized-production-shape" | "owner-correction";
}

export interface ArticleCoverageEvaluation {
  labelledPairCount: number;
  truePositivePairs: number;
  falsePositivePairs: number;
  falseNegativePairs: number;
  pairPrecision: number;
  pairRecall: number;
  groupPrecision: number;
  groupingCoverage: number;
  bridgeErrorCount: number;
  criticalFailures: string[];
}

type Analyzer = (articles: Article[]) => ArticleCoverageAnalysis;

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function groupKey(articleIds: string[]): string {
  return [...articleIds].sort().join("\u0000");
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function verifiedGroupKeys(analysis: ArticleCoverageAnalysis): Set<string> {
  const verificationByBundle = new Map<string, ArticlePublicVerification>();
  for (const article of analysis.articles) {
    if (article.coverageBundle && article.publicVerification) {
      verificationByBundle.set(article.coverageBundle.id, article.publicVerification);
    }
  }
  return new Set(
    analysis.bundles
      .filter((bundle) => verificationByBundle.has(bundle.id))
      .map((bundle) => groupKey(bundle.memberArticleIds)),
  );
}

export function evaluateArticleCoverageCorpus(
  cases: ArticleCoverageGoldenCase[],
  analyze: Analyzer,
): ArticleCoverageEvaluation {
  let truePositivePairs = 0;
  let falsePositivePairs = 0;
  let falseNegativePairs = 0;
  let labelledPairCount = 0;
  let expectedGroupedArticles = 0;
  let observedGroupedArticles = 0;
  let truePositiveGroups = 0;
  let falsePositiveGroups = 0;
  let bridgeErrorCount = 0;
  const criticalFailures: string[] = [];

  for (const fixture of cases) {
    labelledPairCount += fixture.expectedSamePairs.length + fixture.expectedSeparatePairs.length;
    const first = analyze(fixture.articles);
    const second = analyze([...fixture.articles]);
    const observedPairs = new Set(
      first.bundles.flatMap((bundle) =>
        bundle.memberArticleIds.flatMap((left, index) =>
          bundle.memberArticleIds.slice(index + 1).map((right) => pairKey(left, right)),
        ),
      ),
    );
    const repeatedGroups = second.bundles.map((bundle) => groupKey(bundle.memberArticleIds));
    const observedGroups = first.bundles.map((bundle) => groupKey(bundle.memberArticleIds));
    const expectedGroups = new Set(fixture.expectedGroups.map(groupKey));
    for (const observedGroup of observedGroups) {
      if (expectedGroups.has(observedGroup)) truePositiveGroups += 1;
      else falsePositiveGroups += 1;
    }
    if (JSON.stringify(observedGroups) !== JSON.stringify(repeatedGroups)) {
      criticalFailures.push(`${fixture.id}: nondeterministic output`);
    }

    for (const [left, right] of fixture.expectedSamePairs) {
      if (observedPairs.has(pairKey(left, right))) truePositivePairs += 1;
      else {
        falseNegativePairs += 1;
        if (fixture.critical) criticalFailures.push(`${fixture.id}: split ${left}/${right}`);
      }
    }
    for (const [left, right] of fixture.expectedSeparatePairs) {
      if (!observedPairs.has(pairKey(left, right))) continue;
      falsePositivePairs += 1;
      bridgeErrorCount += 1;
      if (fixture.critical) criticalFailures.push(`${fixture.id}: grouped ${left}/${right}`);
    }

    expectedGroupedArticles += new Set(fixture.expectedGroups.flat()).size;
    observedGroupedArticles += new Set(
      first.bundles.flatMap((bundle) => bundle.memberArticleIds),
    ).size;

    const observedVerified = verifiedGroupKeys(first);
    const expectedVerified = new Set(fixture.expectedVerifiedGroups.map(groupKey));
    for (const verified of observedVerified) {
      if (!expectedVerified.has(verified)) {
        criticalFailures.push(`${fixture.id}: unexpected verification ${verified}`);
      }
    }
    for (const expected of expectedVerified) {
      if (!observedVerified.has(expected)) {
        criticalFailures.push(`${fixture.id}: missing verification ${expected}`);
      }
    }
  }

  return {
    labelledPairCount,
    truePositivePairs,
    falsePositivePairs,
    falseNegativePairs,
    pairPrecision: safeRatio(truePositivePairs, truePositivePairs + falsePositivePairs),
    pairRecall: safeRatio(truePositivePairs, truePositivePairs + falseNegativePairs),
    groupPrecision: safeRatio(truePositiveGroups, truePositiveGroups + falsePositiveGroups),
    groupingCoverage: safeRatio(observedGroupedArticles, expectedGroupedArticles),
    bridgeErrorCount,
    criticalFailures,
  };
}
