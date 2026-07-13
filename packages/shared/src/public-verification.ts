import type { Article, SourceId } from "./types.js";
import type { HomeArticleGroup } from "./article-bundles.js";
import { sourceIdLabel } from "./source-labels.js";

const officialArticleVerificationSources = new Set<SourceId>([
  "datex",
  "vegvesen_traffic_info",
  "politiloggen",
]);

const newsroomArticleVerificationSources = new Set<SourceId>([
  "nrk",
  "adressa",
  "avisa_st",
  "snasningen",
  "merakerposten",
  "frostingen",
  "ytringen",
  "steinkjer_avisa",
  "innherred",
  "namdalsavisa",
  "malviknytt",
  "selbyggen",
  "fjell_ljom",
  "retten",
  "hitra_froya",
  "tronderbladet",
  "nidaros",
  "t_a",
  "vg",
  "dagbladet",
]);

function sourceLabelsForIds(sources: SourceId[]): string {
  return sources.map((source) => sourceIdLabel(source)).join(", ");
}

export function isOfficialPublicVerificationSource(source: SourceId): boolean {
  return officialArticleVerificationSources.has(source);
}

export function isNewsroomPublicVerificationSource(source: SourceId): boolean {
  return newsroomArticleVerificationSources.has(source);
}

export function derivePublicVerificationForArticleGroup(
  group: HomeArticleGroup,
): Article["publicVerification"] | undefined {
  if (group.bundle?.kind === "topic") return undefined;
  if (group.articles.length < 2) return undefined;

  const directStrongEdge = group.acceptedEdges?.find((edge) => {
    if (edge.kind !== "incident" || edge.tier !== "strong" || edge.conflicts.length > 0) {
      return false;
    }
    const members = edge.articleIds.map((id) =>
      group.articles.find((article) => article.id === id),
    );
    if (members.some((article) => !article)) return false;
    const [left, right] = members as [Article, Article];
    return (
      (isOfficialPublicVerificationSource(left.source) &&
        isNewsroomPublicVerificationSource(right.source)) ||
      (isOfficialPublicVerificationSource(right.source) &&
        isNewsroomPublicVerificationSource(left.source))
    );
  });
  if (!directStrongEdge) return undefined;

  const [left, right] = directStrongEdge.articleIds.map((id) =>
    group.articles.find((article) => article.id === id),
  ) as [Article, Article];
  const officialArticle = isOfficialPublicVerificationSource(left.source) ? left : right;
  const reportingArticle = isNewsroomPublicVerificationSource(left.source) ? left : right;
  const officialSources = [officialArticle.source];
  const reportingSources = [reportingArticle.source];

  const situationId = officialArticle.situationId ?? reportingArticle.situationId;
  return {
    status: "verified",
    label: "Verifisert",
    detail: `Bekreftet av ${sourceLabelsForIds(officialSources)} og ${sourceLabelsForIds(
      reportingSources,
    )}.`,
    officialSources,
    reportingSources,
    ...(situationId ? { situationId } : {}),
  };
}
