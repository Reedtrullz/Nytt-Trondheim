import type { Article, TrafficCorridorImpact, UnexplainedDelayCandidate } from "@nytt/shared";

const defaultMinDelaySeconds = 180;
const trafficKeywordPattern =
  /\b(?:bilk[øo]|forsink\w*|kork\w*|k[øo]\w*|omkj[øo]ring\w*|sakte|sperr\w*|steng\w*|trafikk\w*)\b/iu;

function articleText(article: Article): string {
  return `${article.title} ${article.excerpt} ${article.places.join(" ")} ${article.location?.label ?? ""}`
    .normalize("NFC")
    .toLocaleLowerCase("nb");
}

function corridorTokens(corridorName: string): string[] {
  const normalized = corridorName.normalize("NFC").toLocaleLowerCase("nb");
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/\b(?:e|rv|fv)\s*\d+[a-z]?\b/giu)) {
    tokens.add(match[0].replace(/\s+/gu, ""));
  }
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length >= 4) tokens.add(token);
  }
  return [...tokens];
}

function likelyMatchesCorridor(article: Article, corridorName: string): boolean {
  const text = articleText(article);
  if (!trafficKeywordPattern.test(text)) return false;
  const tokens = corridorTokens(corridorName);
  return tokens.length === 0 || tokens.some((token) => text.includes(token));
}

function confidenceForDelay(delaySeconds: number | undefined, state: string) {
  if (state === "congested" || (delaySeconds ?? 0) >= 600) return "critical" as const;
  if ((delaySeconds ?? 0) >= 300) return "warning" as const;
  return "watch" as const;
}

function delayMinutes(delaySeconds: number | undefined): number | undefined {
  if (delaySeconds === undefined) return undefined;
  return Math.max(1, Math.round(delaySeconds / 60));
}

export function buildUnexplainedDelayCandidates(
  impacts: TrafficCorridorImpact[],
  articles: Article[],
  options: { minDelaySeconds?: number } = {},
): UnexplainedDelayCandidate[] {
  const minDelaySeconds = options.minDelaySeconds ?? defaultMinDelaySeconds;

  return impacts
    .flatMap((impact): UnexplainedDelayCandidate[] => {
      const travelTime = impact.travelTime;
      if (!travelTime) return [];
      const delaySeconds = travelTime.delaySeconds ?? 0;
      if (delaySeconds < minDelaySeconds && travelTime.state !== "congested") return [];
      if (impact.affectedEventIds.length > 0) return [];

      const matchedArticleIds = articles
        .filter((article) => likelyMatchesCorridor(article, impact.name))
        .slice(0, 8)
        .map((article) => article.id);
      const minutes = delayMinutes(travelTime.delaySeconds);
      const confidence = confidenceForDelay(travelTime.delaySeconds, travelTime.state);
      const reason = matchedArticleIds.length
        ? `DATEX viser${minutes ? ` ca. ${minutes} min` : ""} forsinkelse uten romlig koblet hendelse. Trafikkord finnes i nyhetsstrømmen, men ingen sak er knyttet til korridoren.`
        : `DATEX viser${minutes ? ` ca. ${minutes} min` : ""} forsinkelse uten koblet trafikkhendelse eller tydelig nyhetsforklaring.`;

      return [
        {
          id: `delay:${impact.id}:${travelTime.id}`,
          corridorId: impact.id,
          corridorName: impact.name,
          geometry: impact.geometry,
          state: travelTime.state,
          ...(travelTime.delaySeconds !== undefined
            ? { delaySeconds: travelTime.delaySeconds }
            : {}),
          ...(travelTime.delayRatio !== undefined ? { delayRatio: travelTime.delayRatio } : {}),
          updatedAt: travelTime.measurementTo ?? travelTime.updatedAt,
          sourceUrl: travelTime.sourceUrl,
          matchedArticleIds,
          affectedEventIds: impact.affectedEventIds,
          confidence,
          reason,
        },
      ];
    })
    .sort((left, right) => {
      const confidenceRank = { critical: 3, warning: 2, watch: 1 };
      return (
        confidenceRank[right.confidence] - confidenceRank[left.confidence] ||
        (right.delaySeconds ?? 0) - (left.delaySeconds ?? 0) ||
        right.updatedAt.localeCompare(left.updatedAt)
      );
    });
}
