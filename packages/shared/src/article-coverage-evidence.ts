import type { Article } from "./types.js";

export type CoverageMatcherVersion = "v1" | "v2";

export type ArticleIncidentSubtype =
  | "building_fire"
  | "vehicle_fire"
  | "vegetation_fire"
  | "construction_fire"
  | "cooking_smoke"
  | "traffic_collision"
  | "public_order"
  | "threat_or_violence"
  | "unknown";

export type ArticleCoverageConflictKind =
  | "specific_place"
  | "incident_subtype"
  | "situation_id"
  | "topic_opponent";

export type ArticleCoverageDecisionSignalKind =
  | "persisted_bundle"
  | "situation_id"
  | "title_similarity"
  | "near_duplicate"
  | "generic_place_incident"
  | "topical_thread"
  | "cross_source_incident"
  | "shared_place";

export interface ArticleCoverageDecisionSignal {
  kind: ArticleCoverageDecisionSignalKind;
  articleIds: string[];
  detail?: string;
  overlap?: number;
  score?: number;
}

export interface ArticleCoverageConflictSignal {
  kind: ArticleCoverageConflictKind;
  articleIds: [string, string];
  detail: string;
}

export type PositiveIncidentEvidence =
  | "same_situation_id"
  | "shared_specific_place"
  | "mentioned_specific_place"
  | "shared_named_entity"
  | "compatible_incident_subtype";

export interface ArticleCoveragePairEvidence {
  articleIds: [string, string];
  positiveIncidentEvidence: PositiveIncidentEvidence[];
  incidentSubtypes: [ArticleIncidentSubtype, ArticleIncidentSubtype];
  sharedBodyTokenCount: number;
  sharedDistinctiveTokenCount: number;
  titleScore: number;
  timeDistanceMs: number;
  conflicts: ArticleCoverageConflictSignal[];
  evidenceFingerprint: string;
}

export type ArticleCoverageMatchTier = "strong" | "moderate" | "weak";
export type ArticleCoverageEdgeKind = "incident" | "topic" | "update";

export interface ArticleCoverageEdge {
  articleIds: [string, string];
  tier: ArticleCoverageMatchTier;
  score: number;
  kind: ArticleCoverageEdgeKind;
  signals: ArticleCoverageDecisionSignal[];
  conflicts: ArticleCoverageConflictSignal[];
  evidenceFingerprint: string;
  reviewable: boolean;
  correctionConflict: boolean;
}

const stopWords = new Set([
  "alle",
  "and",
  "av",
  "ble",
  "blir",
  "da",
  "de",
  "den",
  "der",
  "det",
  "dette",
  "din",
  "eller",
  "en",
  "er",
  "et",
  "etter",
  "for",
  "fra",
  "han",
  "har",
  "hun",
  "hva",
  "i",
  "ikke",
  "med",
  "mot",
  "og",
  "om",
  "opp",
  "på",
  "seg",
  "som",
  "til",
  "var",
  "ved",
]);

const genericPlaceTokens = new Set(["trondheim", "trøndelag", "trondelag"]);
const nonIncidentPlaceTokens = new Set(["olavs"]);
const genericIncidentTokens = new Set([
  ...genericPlaceTokens,
  "brann",
  "melding",
  "meldinger",
  "nødetatene",
  "politiet",
  "røyk",
  "røykutvikling",
  "trafikk",
  "ulykke",
]);
const namedEntityStopTokens = new Set([
  "politiet",
  "trondheim",
  "trøndelag",
  "nødetatene",
  "brann",
  "mann",
  "kvinne",
  "ungdom",
  "ungdommer",
  "person",
  "norge",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
  "søndag",
]);
const incompatibleSubtypes = new Set([
  "construction_fire\u0000cooking_smoke",
  "building_fire\u0000cooking_smoke",
  "building_fire\u0000vehicle_fire",
  "construction_fire\u0000vehicle_fire",
  "construction_fire\u0000vegetation_fire",
  "public_order\u0000threat_or_violence",
]);

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("nb")
    .replace(/[«»"'’`´]/g, "")
    .replace(/[^0-9a-zæøå]+/gi, " ")
    .trim();
}

function normalizeToken(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function tokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  return new Set(
    normalized.split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function tokenSimilarity(
  left: Set<string>,
  right: Set<string>,
): { overlap: number; score: number } {
  if (left.size === 0 || right.size === 0) return { overlap: 0, score: 0 };
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return { overlap, score: overlap / (left.size + right.size - overlap) };
}

function normalizedText(article: Article): string {
  return `${article.title} ${article.excerpt}`.toLocaleLowerCase("nb");
}

function articleBodyTokens(article: Article): Set<string> {
  return tokens(
    [article.title, article.excerpt, article.location?.label, ...article.places].join(" "),
  );
}

function articleTitleTokens(article: Article): Set<string> {
  return tokens(article.title);
}

function articleDistinctiveIncidentTokens(article: Article): Set<string> {
  const result = articleBodyTokens(article);
  for (const token of genericIncidentTokens) result.delete(token);
  return result;
}

function canonicalPlace(value: string): string {
  const normalized = normalizeToken(value);
  if (["fanrem", "orkdal", "orkland"].includes(normalized)) return "orkland-area";
  if (["kroppanbrua", "kroppan bru"].includes(normalized)) return "kroppan-bru";
  if (
    [
      "midtbyen",
      "sentrum",
      "trondheim sentrum",
      "prinsengate",
      "prinsen gate",
      "prinsensgate",
      "prinsens gate",
      "elgeseter",
      "elgeseter gate",
      "elgesetergate",
      "elgesetergata",
      "elgesetergaten",
    ].includes(normalized)
  ) {
    return "trondheim-sentrum";
  }
  return normalized;
}

function articlePlaceTokens(article: Article): string[] {
  const values = [article.location?.label, ...article.places].filter((place): place is string =>
    Boolean(place),
  );
  return [
    ...new Set(
      values
        .map(canonicalPlace)
        .filter(
          (place) =>
            place.length > 0 &&
            !genericPlaceTokens.has(place) &&
            !nonIncidentPlaceTokens.has(place),
        ),
    ),
  ];
}

function hasSharedSpecificPlace(left: Article, right: Article): boolean {
  const rightPlaces = new Set(articlePlaceTokens(right));
  return articlePlaceTokens(left).some((token) => rightPlaces.has(token));
}

function hasSpecificPlaceMention(left: Article, right: Article): boolean {
  const leftText = normalizeText(`${left.title} ${left.excerpt}`);
  const rightText = normalizeText(`${right.title} ${right.excerpt}`);
  return (
    articlePlaceTokens(left).some((place) => rightText.includes(place.replaceAll("-", " "))) ||
    articlePlaceTokens(right).some((place) => leftText.includes(place.replaceAll("-", " ")))
  );
}

function hasConflictingSpecificPlaces(left: Article, right: Article): boolean {
  const leftPlaces = articlePlaceTokens(left);
  const rightPlaces = articlePlaceTokens(right);
  if (leftPlaces.length === 0 || rightPlaces.length === 0) return false;
  return !leftPlaces.some((place) => rightPlaces.includes(place));
}

function articleNamedEntityTokens(article: Article): string[] {
  const text = `${article.title} ${article.excerpt}`;
  const candidates =
    text.match(/\b[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}(?:\s+[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}){0,2}\b/gu) ??
    [];
  return [...new Set(candidates.map(normalizeToken))].filter(
    (token) =>
      token.length >= 4 && !genericPlaceTokens.has(token) && !namedEntityStopTokens.has(token),
  );
}

function hasSharedNamedEntity(left: Article, right: Article): boolean {
  const rightEntities = new Set(articleNamedEntityTokens(right));
  return articleNamedEntityTokens(left).some((token) => rightEntities.has(token));
}

export function articleIncidentSubtype(article: Article): ArticleIncidentSubtype {
  const text = normalizedText(article);
  if (/\b(byggeplass|anleggsbrakke|brakke(?:brann|n)?|anlegg)\b/u.test(text)) {
    return "construction_fire";
  }
  if (/\b(matlag\w*|stekt\w*|komfyr\w*|middag|fjordland|plast(?:en)?)\b/u.test(text)) {
    return "cooking_smoke";
  }
  if (/\b(bilbrann|kjøretøy\w*\s+br(?:ann|enner)|bil\w*\s+br(?:ann|enner))\b/u.test(text)) {
    return "vehicle_fire";
  }
  if (/\b(skogbrann|gressbrann|lyngbrann|vegetasjon\w*\s+br(?:ann|enner))\b/u.test(text)) {
    return "vegetation_fire";
  }
  if (/\b(bygningsbrann|husbrann|leilighet\w*\s+br(?:ann|enner)|garasjebrann)\b/u.test(text)) {
    return "building_fire";
  }
  if (/\b(kollisjon|trafikkulykke|påkjør\w*|kjørte\s+(?:av|ut))\b/u.test(text)) {
    return "traffic_collision";
  }
  if (/\b(trussel\w*|vold\w*|pågrepet)\b/u.test(text)) return "threat_or_violence";
  if (/\b(ordensforstyrrelse|bortvis\w*|slagsm[åa]l\w*)\b/u.test(text)) return "public_order";
  return "unknown";
}

function subtypesCompatible(left: ArticleIncidentSubtype, right: ArticleIncidentSubtype): boolean {
  return left !== "unknown" && left === right;
}

function subtypePair(left: ArticleIncidentSubtype, right: ArticleIncidentSubtype): string {
  return [left, right].sort().join("\u0000");
}

function fingerprintHash(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  return `v2:${fingerprintHash(serialized, 2166136261)}${fingerprintHash(serialized, 3335557771)}`;
}

export function articleCoverageEvidence(
  left: Article,
  right: Article,
  matcherVersion: CoverageMatcherVersion,
): ArticleCoveragePairEvidence {
  const articleIds = [left.id, right.id].sort() as [string, string];
  const leftSubtype = articleIncidentSubtype(left);
  const rightSubtype = articleIncidentSubtype(right);
  const conflicts: ArticleCoverageConflictSignal[] = [];
  if (hasConflictingSpecificPlaces(left, right)) {
    conflicts.push({ kind: "specific_place", articleIds, detail: "Ulike spesifikke steder" });
  }
  if (incompatibleSubtypes.has(subtypePair(leftSubtype, rightSubtype))) {
    conflicts.push({
      kind: "incident_subtype",
      articleIds,
      detail: `${leftSubtype}/${rightSubtype}`,
    });
  }
  if (left.situationId && right.situationId && left.situationId !== right.situationId) {
    conflicts.push({
      kind: "situation_id",
      articleIds,
      detail: `${left.situationId}/${right.situationId}`,
    });
  }

  const positiveIncidentEvidence: PositiveIncidentEvidence[] = [];
  if (left.situationId && left.situationId === right.situationId) {
    positiveIncidentEvidence.push("same_situation_id");
  }
  if (hasSharedSpecificPlace(left, right)) {
    positiveIncidentEvidence.push("shared_specific_place");
  }
  if (hasSpecificPlaceMention(left, right)) {
    positiveIncidentEvidence.push("mentioned_specific_place");
  }
  if (hasSharedNamedEntity(left, right)) {
    positiveIncidentEvidence.push("shared_named_entity");
  }
  if (subtypesCompatible(leftSubtype, rightSubtype)) {
    positiveIncidentEvidence.push("compatible_incident_subtype");
  }

  const body = tokenSimilarity(articleBodyTokens(left), articleBodyTokens(right));
  const distinctive = tokenSimilarity(
    articleDistinctiveIncidentTokens(left),
    articleDistinctiveIncidentTokens(right),
  );
  const titleScore = tokenSimilarity(articleTitleTokens(left), articleTitleTokens(right)).score;
  const timeDistanceMs = Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  return {
    articleIds,
    positiveIncidentEvidence,
    incidentSubtypes: [leftSubtype, rightSubtype],
    sharedBodyTokenCount: body.overlap,
    sharedDistinctiveTokenCount: distinctive.overlap,
    titleScore,
    timeDistanceMs,
    conflicts,
    evidenceFingerprint: fingerprint({
      matcherVersion,
      positiveIncidentEvidence: [...positiveIncidentEvidence].sort(),
      incidentSubtypes: [leftSubtype, rightSubtype].sort(),
      conflicts: conflicts.map((item) => item.kind).sort(),
      bodyBucket: Math.min(body.overlap, 8),
      distinctiveBucket: Math.min(distinctive.overlap, 5),
      titleBucket: Math.round(titleScore * 20) / 20,
      timeBucketMinutes: Math.floor(timeDistanceMs / 300_000) * 5,
    }),
  };
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function sameBroadCategory(left: Article, right: Article): boolean {
  if (left.category === right.category) return true;
  const eventLike = new Set(["Hendelser", "Krim", "Nyheter"]);
  return eventLike.has(left.category) && eventLike.has(right.category);
}

function hasGenericIncidentOverlap(left: Article, right: Article): boolean {
  const incidentPattern =
    /\b(?:brann\w*|kollisj\w*|kontroll|nødetat\w*|politiet|trussel\w*|ulykke\w*|ungdom\w*|vold\w*)\b/giu;
  const leftTerms = new Set(normalizedText(left).match(incidentPattern) ?? []);
  return (normalizedText(right).match(incidentPattern) ?? []).some((term) => leftTerms.has(term));
}

function hasSportsTopicMatch(
  left: Article,
  right: Article,
  evidence: ArticleCoveragePairEvidence,
): boolean {
  if (left.category !== "Sport" || right.category !== "Sport") return false;
  const resultPattern = /\b(?:kamp\w*|mål\w*|seier\w*|slo|tap\w*|vant|\d+\s*[–-]\s*\d+)\b/iu;
  return (
    resultPattern.test(normalizedText(left)) &&
    resultPattern.test(normalizedText(right)) &&
    (evidence.positiveIncidentEvidence.includes("shared_specific_place") ||
      evidence.positiveIncidentEvidence.includes("shared_named_entity") ||
      evidence.sharedDistinctiveTokenCount >= 2)
  );
}

function articlePairSignalsForV2(
  left: Article,
  right: Article,
  evidence: ArticleCoveragePairEvidence,
): ArticleCoverageDecisionSignal[] {
  const signals: ArticleCoverageDecisionSignal[] = [];
  if (left.situationId && left.situationId === right.situationId) {
    signals.push({
      kind: "situation_id",
      articleIds: evidence.articleIds,
      detail: left.situationId,
    });
  }
  if (evidence.positiveIncidentEvidence.includes("shared_specific_place")) {
    signals.push({ kind: "shared_place", articleIds: evidence.articleIds });
  }
  const body = tokenSimilarity(articleBodyTokens(left), articleBodyTokens(right));
  if (left.url.length > 0 && left.url === right.url) {
    signals.push({ kind: "near_duplicate", articleIds: evidence.articleIds, score: 1 });
  } else if (evidence.titleScore >= 0.65) {
    signals.push({
      kind: "title_similarity",
      articleIds: evidence.articleIds,
      score: evidence.titleScore,
    });
  } else if (
    (normalizeText(left.excerpt).length > 0 &&
      normalizeText(left.excerpt) === normalizeText(right.excerpt)) ||
    (body.overlap >= 6 && body.score >= 0.6)
  ) {
    signals.push({
      kind: "near_duplicate",
      articleIds: evidence.articleIds,
      overlap: body.overlap,
      score: body.score,
    });
  }
  if (hasSportsTopicMatch(left, right, evidence)) {
    signals.push({ kind: "topical_thread", articleIds: evidence.articleIds });
  }
  if (
    left.source !== right.source &&
    sameBroadCategory(left, right) &&
    evidence.positiveIncidentEvidence.includes("shared_specific_place") &&
    body.overlap >= 1
  ) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: evidence.articleIds,
      overlap: body.overlap,
      score: body.score,
    });
  } else if (hasGenericIncidentOverlap(left, right)) {
    signals.push({
      kind: "generic_place_incident",
      articleIds: evidence.articleIds,
      overlap: body.overlap,
      score: body.score,
    });
  }
  return signals;
}

function coverageKindForPair(signals: ArticleCoverageDecisionSignal[]): ArticleCoverageEdgeKind {
  const hasIncident = signals.some((signal) =>
    ["situation_id", "generic_place_incident", "cross_source_incident", "shared_place"].includes(
      signal.kind,
    ),
  );
  const hasTopic = signals.some((signal) => signal.kind === "topical_thread");
  if (hasTopic && !hasIncident) return "topic";
  if (hasTopic && signals.every((signal) => signal.kind === "topical_thread")) return "topic";
  if (hasIncident) return "incident";
  return hasTopic ? "topic" : "update";
}

export function articleCoverageEdge(
  left: Article,
  right: Article,
): ArticleCoverageEdge | undefined {
  const evidence = articleCoverageEvidence(left, right, "v2");
  const signals = articlePairSignalsForV2(left, right, evidence);
  const kind = coverageKindForPair(signals);
  const positiveCount = evidence.positiveIncidentEvidence.length;
  const hasBlockingConflict = evidence.conflicts.length > 0;
  const textScore = Math.min(
    0.25,
    evidence.titleScore * 0.15 + evidence.sharedDistinctiveTokenCount * 0.025,
  );
  const situationScore = evidence.positiveIncidentEvidence.includes("same_situation_id") ? 0.7 : 0;
  const placeScore = evidence.positiveIncidentEvidence.some(
    (item) => item === "shared_specific_place" || item === "mentioned_specific_place",
  )
    ? 0.3
    : 0;
  const entityScore = evidence.positiveIncidentEvidence.includes("shared_named_entity") ? 0.2 : 0;
  const subtypeScore = evidence.positiveIncidentEvidence.includes("compatible_incident_subtype")
    ? 0.15
    : 0;
  const topicScore =
    kind === "topic" && signals.some((signal) => signal.kind === "topical_thread") ? 0.65 : 0;
  const duplicateScore = signals.some(
    (signal) => signal.kind === "near_duplicate" || signal.kind === "title_similarity",
  )
    ? 0.55
    : 0;
  const crossSourceScore = signals.some((signal) => signal.kind === "cross_source_incident")
    ? 0.2
    : 0;
  const score = boundedScore(
    situationScore +
      placeScore +
      entityScore +
      subtypeScore +
      topicScore +
      duplicateScore +
      crossSourceScore +
      textScore,
  );

  if (signals.length === 0 && score < 0.35) return undefined;
  let tier: ArticleCoverageMatchTier = "weak";
  if (
    !hasBlockingConflict &&
    score >= 0.85 &&
    (situationScore > 0 || topicScore > 0 || duplicateScore > 0)
  ) {
    tier = "strong";
  } else if (!hasBlockingConflict && score >= 0.6 && (kind !== "incident" || positiveCount > 0)) {
    tier = "moderate";
  }

  return {
    articleIds: evidence.articleIds,
    tier,
    score,
    kind,
    signals,
    conflicts: evidence.conflicts,
    evidenceFingerprint: evidence.evidenceFingerprint,
    reviewable: tier === "weak" || hasBlockingConflict,
    correctionConflict: false,
  };
}
