import type {
  AiProcessingRun,
  Article,
  BootstrapPayload,
  HomeSituationSummary,
  MorningBrief,
  SourceHealth,
} from "./types.js";

interface PublicAiCluster {
  title: string;
  summary: string;
  articleIds: string[];
}

export interface MorningBriefInput {
  articles: Article[];
  situations: HomeSituationSummary[];
  sourceHealth: SourceHealth[];
  latestAiRun?: Pick<AiProcessingRun, "provider" | "model" | "status" | "completedAt" | "result">;
  generatedAt?: string;
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function categoryCounts(articles: Article[]): Array<[Article["category"], number]> {
  const counts = new Map<Article["category"], number>();
  for (const article of articles)
    counts.set(article.category, (counts.get(article.category) ?? 0) + 1);
  return [...counts.entries()].sort(
    ([leftCategory, leftCount], [rightCategory, rightCount]) =>
      rightCount - leftCount || leftCategory.localeCompare(rightCategory, "nb"),
  );
}

function placeCounts(articles: Article[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const article of articles) {
    const label = article.location?.label ?? article.places.find((place) => place !== "Trondheim");
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    ([leftPlace, leftCount], [rightPlace, rightCount]) =>
      rightCount - leftCount || leftPlace.localeCompare(rightPlace, "nb"),
  );
}

function publicAiClusters(result: unknown): PublicAiCluster[] {
  if (!result || typeof result !== "object" || !("clusters" in result)) return [];
  const clusters = (result as { clusters?: unknown }).clusters;
  if (!Array.isArray(clusters)) return [];
  return clusters
    .map((cluster): PublicAiCluster | undefined => {
      if (!cluster || typeof cluster !== "object") return undefined;
      const candidate = cluster as { title?: unknown; summary?: unknown; articleIds?: unknown };
      if (typeof candidate.title !== "string" || typeof candidate.summary !== "string") {
        return undefined;
      }
      const articleIds = Array.isArray(candidate.articleIds)
        ? candidate.articleIds.filter((item): item is string => typeof item === "string")
        : [];
      return {
        title: compact(candidate.title, 100),
        summary: compact(candidate.summary, 220),
        articleIds,
      };
    })
    .filter((cluster): cluster is PublicAiCluster => Boolean(cluster));
}

function latestArticleLead(articles: Article[]): string {
  const [first, second] = articles;
  if (!first) return "Det er foreløpig ingen ferske saker i Trondheim-utvalget.";
  if (!second) return `${first.sourceLabel} følger ${first.title.toLocaleLowerCase("nb")}.`;
  return `${first.sourceLabel} og ${second.sourceLabel} preger nyhetsbildet med ${first.title.toLocaleLowerCase("nb")} og ${second.title.toLocaleLowerCase("nb")}.`;
}

function situationSentence(situations: HomeSituationSummary[]): string {
  const active = situations.filter(
    (situation) => situation.status === "active" || situation.status === "preliminary",
  );
  if (active.length === 0) return "Ingen aktive situasjonsrom ligger øverst akkurat nå.";
  const [first] = active;
  return `${active.length} situasjonsrom følges nå, med ${first!.title.toLocaleLowerCase("nb")} som øverste prioritet.`;
}

function sourceLine(sourceHealth: SourceHealth[], mode: MorningBrief["mode"]): string {
  const okCount = sourceHealth.filter((source) => source.state === "ok").length;
  const total = sourceHealth.length;
  const modeText = mode === "ai_assisted" ? "AI-assistert" : "Deterministisk reserve";
  return `${modeText} · ${okCount}/${total} kilder OK`;
}

export function buildMorningBrief({
  articles,
  situations,
  sourceHealth,
  latestAiRun,
  generatedAt = new Date().toISOString(),
}: MorningBriefInput): MorningBrief {
  const sortedArticles = [...articles].sort(
    (left, right) =>
      right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id),
  );
  const aiClusters =
    latestAiRun?.provider === "deepseek" && latestAiRun.status === "ok"
      ? publicAiClusters(latestAiRun.result)
      : [];
  const mode: MorningBrief["mode"] = aiClusters.length > 0 ? "ai_assisted" : "deterministic";
  const [topCategory, topCategoryCount] = categoryCounts(sortedArticles)[0] ?? ["Nyheter", 0];
  const [topPlace] = placeCounts(sortedArticles)[0] ?? ["Trondheim", 0];
  const clusteredArticles = sortedArticles.filter((article) => article.coverageBundle).length;
  const aiLead = aiClusters[0];

  const firstParagraph =
    sortedArticles.length > 0
      ? `Morgenbildet dekker ${sortedArticles.length} ferske saker, særlig innen ${topCategory.toLocaleLowerCase("nb")} (${topCategoryCount}) og med mest aktivitet rundt ${topPlace}.`
      : "Morgenbildet er rolig i de åpne kildene Nytt følger akkurat nå.";
  const secondParagraph = aiLead
    ? `${aiLead.title}: ${aiLead.summary}`
    : latestArticleLead(sortedArticles);
  const thirdParagraph = `${situationSentence(situations)} ${clusteredArticles > 0 ? `${clusteredArticles} saker er samlet i dekningsgrupper for å redusere duplikater.` : "Ingen dekningsgrupper dominerer forsiden akkurat nå."}`;

  return {
    generatedAt,
    title: "Morgenbrief",
    mode,
    sourceLine: sourceLine(sourceHealth, mode),
    paragraphs: [
      compact(firstParagraph, 260),
      compact(secondParagraph, 260),
      compact(thirdParagraph, 260),
    ],
    highlights: [
      {
        label: "Saker",
        value: String(sortedArticles.length),
        detail: `${topCategory} leder bildet`,
      },
      {
        label: "Situasjoner",
        value: String(
          situations.filter(
            (situation) => situation.status === "active" || situation.status === "preliminary",
          ).length,
        ),
        detail: "Aktive eller til vurdering",
      },
      {
        label: "Kilder",
        value: `${sourceHealth.filter((source) => source.state === "ok").length}/${sourceHealth.length}`,
        detail: "Rapporterer OK",
      },
    ],
    articleIds: sortedArticles.slice(0, 8).map((article) => article.id),
    situationIds: situations.map((situation) => situation.id),
    ...(latestAiRun
      ? {
          aiRun: {
            provider: latestAiRun.provider,
            model: latestAiRun.model,
            status: latestAiRun.status,
            completedAt: latestAiRun.completedAt,
          },
        }
      : {}),
  };
}

export function bootstrapWithMorningBrief(
  payload: Omit<BootstrapPayload, "morningBrief">,
  latestAiRun?: MorningBriefInput["latestAiRun"],
  generatedAt?: string,
): BootstrapPayload {
  return {
    ...payload,
    morningBrief: buildMorningBrief({
      articles: payload.articles,
      situations: payload.situations,
      sourceHealth: payload.sourceHealth,
      latestAiRun,
      generatedAt,
    }),
  };
}
