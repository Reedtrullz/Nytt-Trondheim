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

  const officialSources = [
    ...new Set(
      group.articles
        .map((article) => article.source)
        .filter((source): source is SourceId => isOfficialPublicVerificationSource(source)),
    ),
  ];
  const reportingSources = [
    ...new Set(
      group.articles
        .map((article) => article.source)
        .filter((source): source is SourceId => isNewsroomPublicVerificationSource(source)),
    ),
  ];
  if (officialSources.length === 0 || reportingSources.length === 0) return undefined;

  const situationId = group.articles.find((article) => article.situationId)?.situationId;
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
