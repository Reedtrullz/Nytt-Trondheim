import type {
  Article,
  ArticleCoverageBundle,
  ArticleCoverageBundleConfidence,
  ArticleCoverageBundleKind,
  CityPulseStory,
  CoverageMatchConfidence,
  CoverageCorrectionReasonCategory,
  CoverageGenerationSummary,
  CoverageProjectionState,
  CoverageProjectionParity,
} from "./types.js";
import { isFootballClubBrannContext } from "./incident-text.js";
import {
  comparableEditorialText,
  editorialTextRejectionReason,
  normalizedEditorialText,
} from "./editorial-text.js";
import {
  clusterArticlesByCoverageEdges,
  type CoverageRejectedPair,
} from "./article-coverage-clustering.js";
import {
  articleCoverageEdge,
  isEntityBackedNotificationFailureFollowUp,
  isFatalTrafficIncidentFollowUp,
  isHighDetailCrossSourceNearDuplicate,
  isHighInformationTrafficCollisionMatch,
  isPropertyCrimeCoveragePair,
  isPropertyCrimeEventMatch,
  isTrafficCollisionArticle,
  propertyCrimeEvidenceConflicts,
  publisherStoryVariantKey,
  samePublisherStoryUrl,
  sharedExactEventFingerprints,
  trafficCollisionEvidenceConflicts,
} from "./article-coverage-evidence.js";
import type {
  ArticleCoverageDecisionSignal,
  ArticleCoverageEdge,
} from "./article-coverage-evidence.js";

export type {
  ArticleCoverageDecisionSignal,
  ArticleCoverageDecisionSignalKind,
} from "./article-coverage-evidence.js";

export interface HomeArticleGroup {
  id: string;
  primary: Article;
  articles: Article[];
  sourceLabels: string[];
  bundle?: ArticleCoverageBundle;
  acceptedEdges?: ArticleCoverageEdge[];
}

export type ArticleCoverageNearMissReason =
  | "conflicting_specific_places"
  | "different_situation"
  | "outside_time_window"
  | "low_text_overlap"
  | "stale_persisted_bundle";

export interface ArticleCoverageNearMiss {
  articleIds: string[];
  reason: ArticleCoverageNearMissReason;
  detail?: string;
  overlap?: number;
  score?: number;
}

export interface ArticleCoverageBundleDecision extends ArticleCoverageBundle {
  primaryArticleId: string;
  memberArticleIds: string[];
  sourceIds: Article["source"][];
  sourceLabels: string[];
  signals: ArticleCoverageDecisionSignal[];
  nearMisses: ArticleCoverageNearMiss[];
}

export interface ArticleCoverageAnalysis {
  articles: Article[];
  bundles: ArticleCoverageBundleDecision[];
  nearMisses: ArticleCoverageNearMiss[];
  edges?: ArticleCoverageEdge[];
}

export interface CoverageBundleArticleSummary {
  id: string;
  source: Article["source"];
  sourceLabel: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
  category: Article["category"];
  places: string[];
  location?: Article["location"];
  coverageBundle?: ArticleCoverageBundle;
}

export interface CoverageBundleListItem extends ArticleCoverageBundleDecision {
  lastSeenAt: string;
  updatedAt: string;
  memberArticles: CoverageBundleArticleSummary[];
  nearMissArticles: CoverageBundleArticleSummary[];
  generation?: CoverageGenerationSummary;
  state: CoverageProjectionState;
  edges: ArticleCoverageEdge[];
  reviewCandidates: ArticleCoverageEdge[];
  corrections: Array<{
    id: string;
    generationId?: string;
    anchorArticleId: string;
    rejectedArticleId: string;
    reasonCategory?: CoverageCorrectionReasonCategory;
    status: "active" | "reverted";
    applicability?: "active" | "history";
    createdAt: string;
    revertedAt?: string;
  }>;
  publicVerification?: Article["publicVerification"];
  generationChanged?: boolean;
  correctionTombstone?: boolean;
  integrityErrors: string[];
}

export interface CoverageBundleSummary {
  recentBundleCount: number;
  byKind: Record<ArticleCoverageBundleKind, number>;
  byConfidence: Record<ArticleCoverageBundleConfidence, number>;
  latestGeneratedAt?: string;
  activeBundleCount: number;
  byMatchTier: { strong: number; moderate: number };
  reviewCandidateCount: number;
  activeCorrectionCount: number;
  integrityErrorCount: number;
  matcherVersion: "v1" | "v2";
  projectionState: CoverageProjectionState;
  generation?: CoverageGenerationSummary;
}

export interface CoverageBundlePage {
  items: CoverageBundleListItem[];
  summary: CoverageBundleSummary;
  selectedProjection?: CoverageProjectionState;
  nextCursor?: string;
  historyNextCursor?: string;
  selectedGenerationId?: string;
  parity?: CoverageProjectionParity;
  correctionsEnabled?: boolean;
}

type CoverageParityItem = {
  id: string;
  primaryArticleId: string;
  memberArticleIds: string[];
};

export function coverageProjectionParity(
  legacy: CoverageParityItem[],
  normalized: CoverageParityItem[],
): CoverageProjectionParity {
  const canonical = (item: CoverageParityItem) =>
    [...new Set(item.memberArticleIds)].sort().join("\0");
  const groupByMembers = (items: CoverageParityItem[]) => {
    const grouped = new Map<string, CoverageParityItem[]>();
    for (const item of items) {
      const key = canonical(item);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    for (const values of grouped.values()) {
      values.sort(
        (left, right) =>
          left.primaryArticleId.localeCompare(right.primaryArticleId) ||
          left.id.localeCompare(right.id),
      );
    }
    return grouped;
  };
  const legacyByMembers = groupByMembers(legacy);
  const normalizedByMembers = groupByMembers(normalized);
  const membershipKeys = new Set([...legacyByMembers.keys(), ...normalizedByMembers.keys()]);
  const membershipMismatchCount = [...membershipKeys].reduce(
    (count, key) =>
      count +
      Math.abs(
        (legacyByMembers.get(key)?.length ?? 0) - (normalizedByMembers.get(key)?.length ?? 0),
      ),
    0,
  );
  const primaryMismatchCount = [...membershipKeys].reduce((count, key) => {
    const legacyItems = legacyByMembers.get(key) ?? [];
    const normalizedItems = normalizedByMembers.get(key) ?? [];
    const pairedCount = Math.min(legacyItems.length, normalizedItems.length);
    return (
      count +
      Array.from({ length: pairedCount }, (_, index) => index).filter(
        (index) =>
          legacyItems[index]?.primaryArticleId !== normalizedItems[index]?.primaryArticleId,
      ).length
    );
  }, 0);
  return {
    legacyBundleCount: legacy.length,
    normalizedBundleCount: normalized.length,
    membershipMismatchCount,
    primaryMismatchCount,
    clean: membershipMismatchCount === 0 && primaryMismatchCount === 0,
  };
}

const maxGroupAgeMs = 24 * 60 * 60 * 1000;
const crossSourceIncidentWindowMs = 8 * 60 * 60 * 1000;
const nearDuplicateTextWindowMs = 2 * 60 * 60 * 1000;
const topicalThreadWindowMs = 12 * 60 * 60 * 1000;
const genericPlaceIncidentSignalRules = new Map<
  string,
  { windowMs: number; minBodyOverlap: number; minDistinctiveOverlap: number }
>([
  ["slagsmal", { windowMs: 60 * 60 * 1000, minBodyOverlap: 1, minDistinctiveOverlap: 1 }],
  [
    "water_rescue",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 2, minDistinctiveOverlap: 1 },
  ],
  ["brann", { windowMs: nearDuplicateTextWindowMs, minBodyOverlap: 3, minDistinctiveOverlap: 1 }],
  [
    "fallulykke",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 2, minDistinctiveOverlap: 1 },
  ],
  [
    "innbrudd",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 3, minDistinctiveOverlap: 2 },
  ],
  [
    "missing_person",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 2, minDistinctiveOverlap: 1 },
  ],
  ["vold", { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 3, minDistinctiveOverlap: 2 }],
  [
    "bryllup_uro",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 2, minDistinctiveOverlap: 1 },
  ],
  ["street_order", { windowMs: 90 * 60 * 1000, minBodyOverlap: 2, minDistinctiveOverlap: 1 }],
  ["tyveri", { windowMs: nearDuplicateTextWindowMs, minBodyOverlap: 4, minDistinctiveOverlap: 2 }],
  [
    "traffic_collision",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 3, minDistinctiveOverlap: 1 },
  ],
]);
const compatibleDifferentSituationSignals = new Set(["street_order", "traffic_collision"]);
const genericPlaceTokens = new Set(["trondheim", "trøndelag", "trondelag"]);
const nonIncidentPlaceTokens = new Set(["olavs"]);
const centralTrondheimPlaceAliases = new Set([
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
]);
const centralTrondheimAreaPattern = /\b(?:midtbyen|sentrum|trondheim\s+sentrum)\b/iu;
const centralTrondheimStreetPattern =
  /\b(?:prinsen(?:s)?\s*gate|elgeseter\s*(?:gate|gata|gaten)|elgesetergate|elgesetergata)\b/iu;
const genericIncidentTokens = new Set([
  ...genericPlaceTokens,
  "badeulykke",
  "brann",
  "bryllup",
  "fallulykke",
  "innbrudd",
  "innbruddsforsøk",
  "melding",
  "meldinger",
  "nødetatene",
  "politiet",
  "redningsaksjon",
  "rykka",
  "rykket",
  "rykker",
  "savnet",
  "leteaksjon",
  "søker",
  "røyk",
  "røykutvikling",
  "slagsmål",
  "sloss",
  "slåss",
  "slåssing",
  "trafikk",
  "trafikkuhell",
  "trafikkulykke",
  "kollisjon",
  "kolliderte",
  "kollidert",
  "påkjørsel",
  "påkjørt",
  "sammenstøt",
  "tyveri",
  "ulykke",
  "vold",
  "voldshendelse",
]);
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
const incidentSignals: Array<[string, RegExp]> = [
  [
    "innbrudd",
    /\b(innbrudd\w*|brekkjern\w*|br[øo]t\s+seg\s+inn|brutt\s+seg\s+inn|bryt(?:e|er)?\s+seg\s+inn)\b/iu,
  ],
  ["tyveri", /\b(tyveri|tyvgods|tyv\w*|tjuv\w*|stj(?:e|å|a)l\w*)\b/iu],
  ["brann", /\b(brann\w*|røyk\w*|slukk\w*)\b/iu],
  [
    "fallulykke",
    /\b(fallulykke\w*|falt\s+(?:ned|ca|cirka)|fall(?:et)?\s+(?:p[åa]|fra)|rop\s+om\s+hjelp)\b/iu,
  ],
  [
    "traffic_collision",
    /\b(trafikkuhell\w*|trafikkulykke\w*|kollisj\w*|kollider\w*|p[åa]kj[øo]r\w*|p[åa]k[øo]yr\w*|sammenst[øo]t\w*)\b/iu,
  ],
  ["trafikk", /\b(trafikk|kollisjon|ulykke|påkjør\w*|bilstans)\b/iu],
  ["orden", /\b(ro og orden|ordensforstyrrelse)\b/iu],
  ["slagsmal", /\b(slagsm[åa]l\w*|sl[åa]ss\w*|sloss\w*)\b/iu],
  ["vold", /\b(vold\w*|kroppsskade\w*|kritisk\s+skad\w*|siktet\s+for\s+grov)\b/iu],
  [
    "street_order",
    /\b(ro og orden|ordensforstyrrelse\w*|trusselsituasjon\w*|trussel\w*|bortvis\w*|mindre[åa]rig\w*|ungdom(?:men|mer|mene)?|viftet\w*|pinne\w*|forbipasserende|ruset|kontroll\s+p[åa]|har\s+kontroll)\b/iu,
  ],
  [
    "bryllup_uro",
    /\b(?=.*\bbryllup\w*\b)(?:ampert|kamp\w*|slagsm[åa]l\w*|sl[åa]ss\w*|sloss\w*|uenighet\w*|politiet|roet\s+seg)\b/iu,
  ],
  [
    "water_rescue",
    /\b(badeulykke\w*|drukn\w*|livl[øo]s\s+under\s+vann|hav(?:net|na)\s+under\s+vann|g[åa]tt\s+under\s+vann|under\s+vann|bading|hjerte\s*-?\s*og\s*lungeredning|redningsaksjon\b(?=.*\b(vann|bading|kyvannet)\b))/iu,
  ],
  [
    "missing_person",
    /^(?!.*\b(?:dyr|hund|hest|katt)\b)(?=.*\b(?:savnet\w*|leteaksjon\w*|s[øo]k(?:er|te|t|es)?\w*)\b)(?=.*\b(?:dame|eldre|kvinne|mann|pasient|person|[0-9]{2}\s*-?\s*[åa]r(?:ene|ing)?|[0-9]{2}-[åa]ra)\b)/iu,
  ],
];
const streetOrderSubSignals: Array<[string, RegExp]> = [
  ["pinne", /\b(pinne\w*|viftet\w*|forbipasserende|ruset|legevakt\w*)\b/iu],
  [
    "trussel",
    /\b(trusselsituasjon\w*|trussel\w*|mindre[åa]rig\w*|ungdom(?:men|mer|mene)?|bortvis\w*)\b/iu,
  ],
];
const topicSignals: Array<[string, (text: string) => boolean]> = [
  [
    "rosenborg_trener",
    (text) =>
      /\b(rosenborg\w*|rbk)\b/iu.test(text) &&
      /\b(hovedtrener\w*|trenerjobb\w*|trener\w*|ansatt\w*|presentert\w*)\b/iu.test(text),
  ],
  [
    "trondheim_vm_fest",
    (text) =>
      /\btrondheim\b/iu.test(text) &&
      /\b(?:vm\s*-?\s*fest\w*|fotballfest\w*|folkefest\w*|storskjerm\w*)\b/iu.test(text) &&
      /\b(?:bank\w*|byr[åa]d\w*|dato\w*|ekstraordin[æa]r\w*|kommune\w*|m[øo]te\w*|planlegging\w*|politiker\w*|snuoperasjon\w*)\b/iu.test(
        text,
      ),
  ],
];
const sportsResultTopicPrefix = "sport_result:";
const localSportsClubSignals: Array<[string, RegExp]> = [
  ["ranheim", /\branheim(?:s)?\b/iu],
  ["rosenborg", /\b(?:rosenborg(?:s)?|rbk)\b/iu],
  ["kolstad", /\bkolstad(?:s)?\b/iu],
  ["byasen", /\bby[åa]sen(?:s)?\b/iu],
  ["nardo", /\bnardo(?:s)?\b/iu],
  ["strindheim", /\bstrindheim(?:s)?\b/iu],
  ["levanger", /\blevanger(?:s)?\b/iu],
  ["stjordals-blink", /\bstj[øo]rdals(?:-|\s+)blink\b|\bstj[øo]rdalsblink\b/iu],
];
const sportsResultPattern =
  /\b(?:bortekompleks\w*|bortesmell\w*|bortetap\w*|hjemmeseier\w*|seier\w*|slo|tap(?:et|te)?|uavgjort|vant)\b|\b\d+\s*[–-]\s*\d+\b/iu;
const sportsMatchContextPattern =
  /\b(?:borte|divisjon\w*|eliteserien|fotball\w*|hjemme(?:laget)?|kamp(?:en)?|lag(?:et)?|liga(?:en)?|m[åa]l(?:et|ene)?|obos|poeng\w*|resultat(?:et)?)\b|bortekompleks\w*|bortesmell\w*|bortetap\w*/iu;
const localSportsClubKeys = new Set(localSportsClubSignals.map(([club]) => club));
const articleTextCache = new WeakMap<Article, string>();
const articleTextTokensCache = new WeakMap<Article, Set<string>>();
const articleTitleTokensCache = new WeakMap<Article, Set<string>>();
const articleDistinctiveTokensCache = new WeakMap<Article, Set<string>>();
const articlePlaceTokensCache = new WeakMap<Article, Set<string>>();
const articleIncidentSignalsCache = new WeakMap<Article, Set<string>>();
const articleStreetOrderSubSignalsCache = new WeakMap<Article, Set<string>>();
const articleTopicSignalsCache = new WeakMap<Article, Set<string>>();

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("nb")
    .replace(/[«»"'’`´]/g, "")
    .replace(/[^0-9a-zæøå]+/gi, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function distinctiveIncidentTokens(value: string): Set<string> {
  const result = tokens(value);
  genericIncidentTokens.forEach((token) => result.delete(token));
  return result;
}

function tokenSimilarity(
  left: Set<string>,
  right: Set<string>,
): { overlap: number; score: number } {
  if (left.size === 0 || right.size === 0) return { overlap: 0, score: 0 };
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) overlap += 1;
  });
  return { overlap, score: overlap / (left.size + right.size - overlap) };
}

function articlePlaceTokens(article: Article): Set<string> {
  const cached = articlePlaceTokensCache.get(article);
  if (cached) return cached;
  const placeValues = [article.location?.label, ...article.places].filter(
    (place): place is string => Boolean(place),
  );
  const placeTokens = tokens(placeValues.join(" "));
  const normalizedText = normalizeText([article.title, article.excerpt, ...placeValues].join(" "));
  const normalizedPlaceValues = placeValues.map(normalizeText);
  const hasExplicitCentralPlace = normalizedPlaceValues.some((place) =>
    centralTrondheimPlaceAliases.has(place),
  );
  const hasSpecificNonCentralPlace = normalizedPlaceValues.some(
    (place) =>
      !centralTrondheimPlaceAliases.has(place) &&
      !genericPlaceTokens.has(place) &&
      !nonIncidentPlaceTokens.has(place) &&
      tokens(place).size > 0,
  );
  if (
    /\btrondheim\s+torg(?:et)?\b/iu.test(normalizedText) ||
    ((article.scope === "trondheim" || /\btrondheim\b/iu.test(normalizedText)) &&
      /\b(?:torvet|torget)\b/iu.test(normalizedText))
  ) {
    placeTokens.add("trondheim-torg");
  }
  if (
    (article.scope === "trondheim" || /\btrondheim\b/iu.test(normalizedText)) &&
    (centralTrondheimStreetPattern.test(normalizedText) ||
      hasExplicitCentralPlace ||
      (centralTrondheimAreaPattern.test(normalizedText) && !hasSpecificNonCentralPlace))
  ) {
    placeTokens.add("trondheim-sentrum");
  }
  placeValues.forEach((place) => {
    const normalized = normalizeText(place);
    if (normalized === "kroppanbrua" || normalized === "kroppan bru") {
      placeTokens.add("kroppan-bru");
    }
    if (normalized === "trondheim s") {
      placeTokens.add("trondheim-s");
    }
    if (["fanrem", "orkdal", "orkland"].includes(normalized)) {
      placeTokens.add("orkland-area");
    }
    if (centralTrondheimPlaceAliases.has(normalized)) {
      placeTokens.add("trondheim-sentrum");
    }
  });
  genericPlaceTokens.forEach((token) => placeTokens.delete(token));
  nonIncidentPlaceTokens.forEach((token) => placeTokens.delete(token));
  articlePlaceTokensCache.set(article, placeTokens);
  return placeTokens;
}

function publishedDistanceMs(left: Article, right: Article): number {
  const leftTime = Date.parse(left.publishedAt);
  const rightTime = Date.parse(right.publishedAt);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime);
}

function hasSharedPlace(left: Article, right: Article): boolean {
  const leftPlaces = articlePlaceTokens(left);
  const rightPlaces = articlePlaceTokens(right);
  return tokenSimilarity(leftPlaces, rightPlaces).overlap > 0;
}

function hasSpecificPlaceMention(left: Article, right: Article): boolean {
  const leftPlaces = articlePlaceTokens(left);
  const rightPlaces = articlePlaceTokens(right);
  const leftText = articleTextTokens(left);
  const rightText = articleTextTokens(right);
  return (
    [...leftPlaces].some((place) => rightText.has(place)) ||
    [...rightPlaces].some((place) => leftText.has(place))
  );
}

function hasConflictingSpecificPlaces(left: Article, right: Article): boolean {
  const leftPlaces = articlePlaceTokens(left);
  const rightPlaces = articlePlaceTokens(right);
  if (leftPlaces.size === 0 || rightPlaces.size === 0) return false;
  return tokenSimilarity(leftPlaces, rightPlaces).overlap === 0;
}

function sameBroadCategory(left: Article, right: Article): boolean {
  if (left.category === right.category) return true;
  const eventLike = new Set(["Hendelser", "Krim", "Nyheter"]);
  return eventLike.has(left.category) && eventLike.has(right.category);
}

function categoriesCompatibleForIncidentSignal(
  left: Article,
  right: Article,
  signal: string,
): boolean {
  if (sameBroadCategory(left, right)) return true;
  if (signal !== "traffic_collision") return false;
  const eventLike = new Set(["Hendelser", "Krim", "Nyheter"]);
  return (
    (left.category === "Transport" && eventLike.has(right.category)) ||
    (right.category === "Transport" && eventLike.has(left.category))
  );
}

function sameCanonicalUrl(left: Article, right: Article): boolean {
  return samePublisherStoryUrl(left, right);
}

function articleText(article: Article): string {
  const cached = articleTextCache.get(article);
  if (cached !== undefined) return cached;
  const text = [article.title, article.excerpt, article.location?.label, ...article.places]
    .filter(Boolean)
    .join(" ");
  articleTextCache.set(article, text);
  return text;
}

function articleTextTokens(article: Article): Set<string> {
  const cached = articleTextTokensCache.get(article);
  if (cached) return cached;
  const value = tokens(articleText(article));
  articleTextTokensCache.set(article, value);
  return value;
}

function articleTitleTokens(article: Article): Set<string> {
  const cached = articleTitleTokensCache.get(article);
  if (cached) return cached;
  const value = tokens(article.title);
  articleTitleTokensCache.set(article, value);
  return value;
}

function articleDistinctiveIncidentTokens(article: Article): Set<string> {
  const cached = articleDistinctiveTokensCache.get(article);
  if (cached) return cached;
  const value = distinctiveIncidentTokens(articleText(article));
  articleDistinctiveTokensCache.set(article, value);
  return value;
}

function articleIncidentSignals(article: Article): Set<string> {
  const cached = articleIncidentSignalsCache.get(article);
  if (cached) return cached;
  const text = articleText(article);
  const signals = new Set(
    incidentSignals.flatMap(([signal, pattern]) => (pattern.test(text) ? [signal] : [])),
  );
  if (signals.has("brann") && isFootballClubBrannContext(article)) signals.delete("brann");
  articleIncidentSignalsCache.set(article, signals);
  return signals;
}

function articleStreetOrderSubSignals(article: Article): Set<string> {
  const cached = articleStreetOrderSubSignalsCache.get(article);
  if (cached) return cached;
  const text = articleText(article);
  const signals = new Set(
    streetOrderSubSignals.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal),
  );
  if (signals.has("pinne")) {
    const pinneSignals = new Set(["pinne"]);
    articleStreetOrderSubSignalsCache.set(article, pinneSignals);
    return pinneSignals;
  }
  articleStreetOrderSubSignalsCache.set(article, signals);
  return signals;
}

function streetOrderSubSignalsCompatible(left: Article, right: Article): boolean {
  const leftSignals = articleStreetOrderSubSignals(left);
  const rightSignals = articleStreetOrderSubSignals(right);
  if (leftSignals.size === 0 || rightSignals.size === 0) return true;
  return [...leftSignals].some((signal) => rightSignals.has(signal));
}

function sportsResultTopicSignals(text: string): string[] {
  if (!sportsResultPattern.test(text) || !sportsMatchContextPattern.test(text)) return [];
  return localSportsClubSignals.flatMap(([club, pattern]) =>
    pattern.test(text) ? [`${sportsResultTopicPrefix}${club}`] : [],
  );
}

function sportsMatchDescriptors(text: string): { opponents: Set<string>; scores: Set<string> } {
  const scores = new Set(
    [...text.matchAll(/\b(\d+)\s*[–-]\s*(\d+)\b/giu)].map((match) => `${match[1]}-${match[2]}`),
  );
  const opponents = new Set(
    [...text.matchAll(/\bmot\s+([0-9a-zæøå-]{3,})\b/giu)]
      .map((match) => normalizeText(match[1] ?? ""))
      .filter((opponent) => opponent.length > 2 && !localSportsClubKeys.has(opponent)),
  );
  return { opponents, scores };
}

function descriptorSetsConflict(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) return false;
  return tokenSimilarity(left, right).overlap === 0;
}

function sportsResultDescriptorsConflict(left: Article, right: Article): boolean {
  const leftDescriptors = sportsMatchDescriptors(articleText(left));
  const rightDescriptors = sportsMatchDescriptors(articleText(right));
  return (
    descriptorSetsConflict(leftDescriptors.opponents, rightDescriptors.opponents) ||
    descriptorSetsConflict(leftDescriptors.scores, rightDescriptors.scores)
  );
}

function isSportsResultTopic(signal: string): boolean {
  return signal.startsWith(sportsResultTopicPrefix);
}

function articleTopicSignals(article: Article): Set<string> {
  const cached = articleTopicSignalsCache.get(article);
  if (cached) return cached;
  const text = articleText(article);
  const signals = new Set([
    ...topicSignals.flatMap(([signal, matches]) => (matches(text) ? [signal] : [])),
    ...sportsResultTopicSignals(text),
  ]);
  articleTopicSignalsCache.set(article, signals);
  return signals;
}

function sharedIncidentSignals(left: Article, right: Article): Set<string> {
  const leftSignals = articleIncidentSignals(left);
  if (leftSignals.size === 0) return new Set();
  return new Set([...articleIncidentSignals(right)].filter((signal) => leftSignals.has(signal)));
}

function sharedTopicSignals(left: Article, right: Article): Set<string> {
  const leftSignals = articleTopicSignals(left);
  if (leftSignals.size === 0) return new Set();
  return new Set([...articleTopicSignals(right)].filter((signal) => leftSignals.has(signal)));
}

function hasSharedIncidentSignal(left: Article, right: Article): boolean {
  return sharedIncidentSignals(left, right).size > 0;
}

function compatibleDifferentSituationSignal(
  left: Article,
  right: Article,
): ArticleCoverageDecisionSignal | undefined {
  if (!left.situationId || !right.situationId || left.situationId === right.situationId) {
    return undefined;
  }
  const sharedPlace = hasSharedPlace(left, right);
  if (!sharedPlace && hasConflictingSpecificPlaces(left, right)) return undefined;
  const body = tokenSimilarity(articleTextTokens(left), articleTextTokens(right));
  const distinctive = tokenSimilarity(
    articleDistinctiveIncidentTokens(left),
    articleDistinctiveIncidentTokens(right),
  );

  for (const signal of sharedIncidentSignals(left, right)) {
    if (!compatibleDifferentSituationSignals.has(signal)) continue;
    if (signal === "street_order" && !streetOrderSubSignalsCompatible(left, right)) {
      continue;
    }
    if (!sharedPlace && signal !== "traffic_collision") continue;
    if (!sharedPlace && !hasSpecificPlaceMention(left, right)) continue;
    if (!categoriesCompatibleForIncidentSignal(left, right, signal)) continue;
    const rule = genericPlaceIncidentSignalRules.get(signal);
    if (
      !rule ||
      publishedDistanceMs(left, right) > rule.windowMs ||
      body.overlap < rule.minBodyOverlap ||
      distinctive.overlap < rule.minDistinctiveOverlap
    ) {
      continue;
    }
    return {
      kind: "generic_place_incident",
      articleIds: [left.id, right.id],
      detail: signal,
      overlap: body.overlap,
      score: body.score,
    };
  }

  return undefined;
}

function articlesConflict(left: Article, right: Article): boolean {
  if (isFatalTrafficIncidentFollowUp(left, right)) return false;
  if (isHighInformationTrafficCollisionMatch(left, right)) return false;
  if (trafficCollisionEvidenceConflicts(left, right)) return true;
  if (propertyCrimeEvidenceConflicts(left, right)) return true;
  if (left.situationId && right.situationId && left.situationId !== right.situationId) {
    if (compatibleDifferentSituationSignal(left, right)) return false;
    return true;
  }
  return hasConflictingSpecificPlaces(left, right) && hasSharedIncidentSignal(left, right);
}

function genericPlaceIncidentSignals(
  left: Article,
  right: Article,
  body: { overlap: number; score: number },
): ArticleCoverageDecisionSignal[] {
  if (hasConflictingSpecificPlaces(left, right)) return [];
  const distance = publishedDistanceMs(left, right);
  const distinctive = tokenSimilarity(
    articleDistinctiveIncidentTokens(left),
    articleDistinctiveIncidentTokens(right),
  );
  return [...sharedIncidentSignals(left, right)].flatMap((signal) => {
    if (signal === "street_order" && !streetOrderSubSignalsCompatible(left, right)) {
      return [];
    }
    if (!categoriesCompatibleForIncidentSignal(left, right, signal)) return [];
    if (
      !sameBroadCategory(left, right) &&
      signal === "traffic_collision" &&
      !hasSharedPlace(left, right) &&
      !hasSpecificPlaceMention(left, right)
    ) {
      return [];
    }
    const rule = genericPlaceIncidentSignalRules.get(signal);
    if (
      !rule ||
      distance > rule.windowMs ||
      body.overlap < rule.minBodyOverlap ||
      distinctive.overlap < rule.minDistinctiveOverlap
    ) {
      return [];
    }
    return [
      {
        kind: "generic_place_incident" as const,
        articleIds: [left.id, right.id],
        detail: signal,
        overlap: body.overlap,
        score: body.score,
      },
    ];
  });
}

function hasTopicalThreadMatch(
  left: Article,
  right: Article,
  body: { overlap: number; score: number },
): boolean {
  if (publishedDistanceMs(left, right) > topicalThreadWindowMs) return false;
  const topics = sharedTopicSignals(left, right);
  if (topics.size === 0) return false;
  if ([...topics].some(isSportsResultTopic)) {
    return body.overlap >= 1 && !sportsResultDescriptorsConflict(left, right);
  }
  return body.overlap >= 2;
}

function coverageBundlesStale(left: Article, right: Article): boolean {
  const bundleId = left.coverageBundle?.id;
  return Boolean(
    bundleId &&
    bundleId === right.coverageBundle?.id &&
    !bundleId.startsWith("coverage:situation:") &&
    publishedDistanceMs(left, right) > maxGroupAgeMs,
  );
}

function articlePairSignals(left: Article, right: Article): ArticleCoverageDecisionSignal[] {
  const signals: ArticleCoverageDecisionSignal[] = [];
  if (left.id === right.id) return [{ kind: "shared_place", articleIds: [left.id, right.id] }];
  if (left.situationId || right.situationId) {
    signals.push({
      kind: "situation_id",
      articleIds: [left.id, right.id],
      detail: [left.situationId, right.situationId].filter(Boolean).join(", "),
    });
  }
  if (left.situationId && left.situationId === right.situationId) return signals;
  if (left.situationId && right.situationId) {
    const compatibleSignal = compatibleDifferentSituationSignal(left, right);
    if (compatibleSignal) return [...signals, compatibleSignal];
    return [];
  }
  if (isFatalTrafficIncidentFollowUp(left, right)) {
    const body = tokenSimilarity(articleTextTokens(left), articleTextTokens(right));
    signals.push({
      kind: "cross_source_incident",
      articleIds: [left.id, right.id],
      detail: "fatal_traffic_follow_up",
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }
  if (isHighInformationTrafficCollisionMatch(left, right)) {
    const body = tokenSimilarity(articleTextTokens(left), articleTextTokens(right));
    signals.push({
      kind: "cross_source_incident",
      articleIds: [left.id, right.id],
      detail: "traffic_collision:road_clock_participants",
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }
  const topics = sharedTopicSignals(left, right);
  const hasSportsResultTopic = [...topics].some(isSportsResultTopic);
  if (
    hasConflictingSpecificPlaces(left, right) &&
    !sameCanonicalUrl(left, right) &&
    !(hasSportsResultTopic && !sportsResultDescriptorsConflict(left, right))
  ) {
    return [];
  }
  if (
    sameCanonicalUrl(left, right) &&
    publishedDistanceMs(left, right) <= nearDuplicateTextWindowMs
  ) {
    return [...signals, { kind: "near_duplicate", articleIds: [left.id, right.id], score: 1 }];
  }
  const exactEventFingerprints = sharedExactEventFingerprints(left, right);
  if (exactEventFingerprints.length > 0) {
    return [
      ...signals,
      {
        kind: "cross_source_incident",
        articleIds: [left.id, right.id],
        detail: exactEventFingerprints.join(", "),
      },
    ];
  }
  if (isPropertyCrimeCoveragePair(left, right)) {
    if (propertyCrimeEvidenceConflicts(left, right)) return [];
    if (isPropertyCrimeEventMatch(left, right)) {
      const body = tokenSimilarity(articleTextTokens(left), articleTextTokens(right));
      return [
        ...signals,
        {
          kind: "cross_source_incident",
          articleIds: [left.id, right.id],
          detail: "property:crime",
          overlap: body.overlap,
          score: body.score,
        },
      ];
    }
    return [];
  }
  if (publishedDistanceMs(left, right) > maxGroupAgeMs) return [];

  const title = tokenSimilarity(articleTitleTokens(left), articleTitleTokens(right));
  if (title.overlap >= 3 && title.score >= 0.56) {
    signals.push({
      kind: "title_similarity",
      articleIds: [left.id, right.id],
      overlap: title.overlap,
      score: title.score,
    });
    return signals;
  }
  if (normalizeText(left.title) === normalizeText(right.title)) {
    signals.push({ kind: "title_similarity", articleIds: [left.id, right.id], score: 1 });
    return signals;
  }

  const body = tokenSimilarity(articleTextTokens(left), articleTextTokens(right));
  if (
    (left.source !== right.source &&
      publishedDistanceMs(left, right) <= nearDuplicateTextWindowMs &&
      body.overlap >= 10 &&
      body.score >= 0.5 &&
      sameBroadCategory(left, right)) ||
    isHighDetailCrossSourceNearDuplicate(left, right)
  ) {
    signals.push({
      kind: "near_duplicate",
      articleIds: [left.id, right.id],
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }

  const genericSignals = genericPlaceIncidentSignals(left, right, body);
  if (genericSignals.length > 0) return [...signals, ...genericSignals];

  if (isEntityBackedNotificationFailureFollowUp(left, right)) {
    signals.push({
      kind: "topical_thread",
      articleIds: [left.id, right.id],
      detail: "entity_notification_failure_follow_up",
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }

  if (hasTopicalThreadMatch(left, right, body)) {
    signals.push({
      kind: "topical_thread",
      articleIds: [left.id, right.id],
      detail: [...sharedTopicSignals(left, right)].join(", "),
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }

  const sharedPlace = hasSharedPlace(left, right);
  if (
    left.source !== right.source &&
    publishedDistanceMs(left, right) <= crossSourceIncidentWindowMs &&
    body.overlap >= 4 &&
    sharedPlace &&
    hasSharedIncidentSignal(left, right)
  ) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: [left.id, right.id],
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }
  if (body.overlap >= 5 && body.score >= 0.38 && sameBroadCategory(left, right) && sharedPlace) {
    signals.push({
      kind: "shared_place",
      articleIds: [left.id, right.id],
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }
  if (body.overlap >= 4 && body.score >= 0.28 && sameBroadCategory(left, right) && sharedPlace) {
    signals.push({
      kind: "shared_place",
      articleIds: [left.id, right.id],
      overlap: body.overlap,
      score: body.score,
    });
    return signals;
  }

  return [];
}

function nearMissForPair(left: Article, right: Article): ArticleCoverageNearMiss | undefined {
  const articleIds = [left.id, right.id];
  if (left.situationId && right.situationId && left.situationId !== right.situationId) {
    return { articleIds, reason: "different_situation" };
  }
  if (hasConflictingSpecificPlaces(left, right) && hasSharedIncidentSignal(left, right)) {
    return { articleIds, reason: "conflicting_specific_places" };
  }
  if (coverageBundlesStale(left, right)) {
    return { articleIds, reason: "stale_persisted_bundle", detail: left.coverageBundle?.id };
  }
  if (publishedDistanceMs(left, right) > maxGroupAgeMs) {
    return { articleIds, reason: "outside_time_window" };
  }
  const body = tokenSimilarity(articleTextTokens(left), articleTextTokens(right));
  if (
    sameBroadCategory(left, right) &&
    (hasSharedPlace(left, right) || hasSharedIncidentSignal(left, right))
  ) {
    return {
      articleIds,
      reason: "low_text_overlap",
      overlap: body.overlap,
      score: body.score,
    } as ArticleCoverageNearMiss;
  }
  return undefined;
}

function articlesSimilar(left: Article, right: Article): boolean {
  return articlePairSignals(left, right).length > 0;
}

function pairKey(left: Article, right: Article): string {
  return left.id < right.id ? `${left.id}\u0000${right.id}` : `${right.id}\u0000${left.id}`;
}

interface GroupPairMemo {
  conflicts: Map<string, boolean>;
  similarities: Map<string, boolean>;
}

function memoizedArticlesConflict(left: Article, right: Article, memo: GroupPairMemo): boolean {
  const key = pairKey(left, right);
  const existing = memo.conflicts.get(key);
  if (existing !== undefined) return existing;
  const value = articlesConflict(left, right);
  memo.conflicts.set(key, value);
  return value;
}

function memoizedArticlesSimilar(left: Article, right: Article, memo: GroupPairMemo): boolean {
  const key = pairKey(left, right);
  const existing = memo.similarities.get(key);
  if (existing !== undefined) return existing;
  const value = articlesSimilar(left, right);
  memo.similarities.set(key, value);
  return value;
}

function sortArticles(left: Article, right: Article): number {
  return right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id);
}

function preferredPublicationVariant(left: Article, right: Article): Article {
  const fidelity =
    right.excerpt.trim().length - left.excerpt.trim().length ||
    right.title.trim().length - left.title.trim().length ||
    right.publishedAt.localeCompare(left.publishedAt) ||
    left.id.localeCompare(right.id);
  return fidelity > 0 ? right : left;
}

function collapsePublisherPathVariants(articles: Article[]): Article[] {
  const retained: Article[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const article of articles) {
    const storyIdentity = publisherStoryVariantKey(article.url, article.publishedAt);
    if (!storyIdentity) {
      retained.push(article);
      continue;
    }
    const identity = `${article.source}:${storyIdentity}`;
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, retained.length);
      retained.push(article);
      continue;
    }
    retained[existingIndex] = preferredPublicationVariant(retained[existingIndex]!, article);
  }
  return retained;
}

const newsroomArticleSources = new Set<Article["source"]>([
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

const officialArticleSources = new Set<Article["source"]>([
  "trondheim_kommune",
  "bane_nor",
  "met",
  "nve",
  "datex",
  "vegvesen_traffic_info",
  "entur_service_alerts",
  "dsb",
  "politiloggen",
]);

const genericEditorialTitlePattern =
  /^(?:oppdatering|nytt|melding(?:\s+fra)?|andre\s+hendelser|ro\s+og\s+orden|trafikk)(?:\s*[:–—-].*)?$/iu;
const editorialTitleRiskPattern =
  /(?:\bi\s+fylla\b|:\s*[–—-]\s*(?:jeg|vi|han|hun|de|det|dette|slik|nå)\b)/iu;

function editorialInformationScore(value: string): number {
  const normalized = normalizedEditorialText(value).toLocaleLowerCase("nb");
  const tokens = new Set(normalized.match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  return Math.min(normalized.length, 320) + Math.min(tokens.size, 40) * 8;
}

function hasUsefulEditorialExcerpt(article: Article): boolean {
  return !editorialTextRejectionReason(article.excerpt, {
    title: article.title,
    minLength: 24,
  });
}

function editorialSourceTier(article: Article): number {
  if (newsroomArticleSources.has(article.source)) return 2;
  if (officialArticleSources.has(article.source)) return 1;
  return 0;
}

function hasSpecificEditorialTitle(article: Article): boolean {
  const title = normalizedEditorialText(article.title);
  const tokens = title.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return title.length >= 16 && tokens.length >= 3 && !genericEditorialTitlePattern.test(title);
}

function hasRepeatedEditorialTitlePhrase(title: string): boolean {
  const tokens = comparableEditorialText(title).split(" ").filter(Boolean);
  const phrases = new Set<string>();
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    const phrase = tokens.slice(index, index + 3).join(" ");
    if (phrases.has(phrase)) return true;
    phrases.add(phrase);
  }
  return false;
}

function hasEditorialTitleRisk(article: Article): boolean {
  const title = normalizedEditorialText(article.title);
  return (
    title.length > 110 ||
    editorialTitleRiskPattern.test(title) ||
    hasRepeatedEditorialTitlePhrase(title)
  );
}

function compareEditorialTitleArticles(left: Article, right: Article): number {
  return (
    Number(hasEditorialTitleRisk(left)) - Number(hasEditorialTitleRisk(right)) ||
    Number(hasSpecificEditorialTitle(right)) - Number(hasSpecificEditorialTitle(left)) ||
    editorialSourceTier(right) - editorialSourceTier(left) ||
    editorialInformationScore(right.title) - editorialInformationScore(left.title) ||
    left.source.localeCompare(right.source) ||
    left.url.localeCompare(right.url) ||
    left.id.localeCompare(right.id)
  );
}

function compareEditorialIngressArticles(left: Article, right: Article): number {
  return (
    editorialSourceTier(right) - editorialSourceTier(left) ||
    editorialInformationScore(right.excerpt) - editorialInformationScore(left.excerpt) ||
    left.source.localeCompare(right.source) ||
    left.url.localeCompare(right.url) ||
    left.id.localeCompare(right.id)
  );
}

function compareEditorialArticles(left: Article, right: Article): number {
  return (
    Number(hasUsefulEditorialExcerpt(right)) - Number(hasUsefulEditorialExcerpt(left)) ||
    editorialSourceTier(right) - editorialSourceTier(left) ||
    editorialInformationScore(right.excerpt) - editorialInformationScore(left.excerpt) ||
    editorialInformationScore(right.title) - editorialInformationScore(left.title) ||
    left.source.localeCompare(right.source) ||
    left.url.localeCompare(right.url) ||
    left.id.localeCompare(right.id)
  );
}

export function selectEditorialArticle(articles: Article[]): Article {
  if (articles.length === 0) throw new Error("Cannot select editorial copy without articles");
  return [...articles].sort(compareEditorialArticles)[0]!;
}

function editorialSelectionRationale(
  article: Article,
): NonNullable<CityPulseStory["editorialSelection"]>["rationale"] {
  if (!hasUsefulEditorialExcerpt(article)) return "best_available";
  if (newsroomArticleSources.has(article.source)) return "newsroom_complete";
  if (officialArticleSources.has(article.source)) return "official_complete";
  return "best_available";
}

export function cityPulseEditorialSelection(
  articles: Article[],
): NonNullable<CityPulseStory["editorialSelection"]> {
  const article = selectEditorialArticle(articles);
  return {
    articleId: article.id,
    strategy: "best-source-v1",
    rationale: editorialSelectionRationale(article),
  };
}

export function cityPulseEditorialCopy(
  articles: Article[],
): NonNullable<CityPulseStory["editorialCopy"]> {
  if (articles.length === 0) throw new Error("Cannot select editorial copy without articles");
  const titleArticle = [...articles].sort(compareEditorialTitleArticles)[0]!;
  const ingressArticle = [...articles]
    .filter(hasUsefulEditorialExcerpt)
    .sort(compareEditorialIngressArticles)[0];
  const title: NonNullable<CityPulseStory["editorialCopy"]>["title"] = {
    text: normalizedEditorialText(titleArticle.title),
    mode: "source",
    articleId: titleArticle.id,
    field: "title",
    rationale: hasSpecificEditorialTitle(titleArticle)
      ? "specific_source_title"
      : "best_available_title",
  };
  if (!ingressArticle) {
    return {
      version: 1,
      strategy: "independent-source-v1",
      title,
      ingressFallback: { reason: "insufficient_supported_source_text" },
    };
  }
  return {
    version: 1,
    strategy: "independent-source-v1",
    title,
    ingress: {
      text: normalizedEditorialText(ingressArticle.excerpt),
      mode: "source",
      articleId: ingressArticle.id,
      field: "excerpt",
      rationale: editorialSelectionRationale(ingressArticle),
    },
  };
}

function latestArticleTimestamp(articles: Article[]): string {
  return articles.reduce(
    (latest, article) => (article.publishedAt > latest ? article.publishedAt : latest),
    articles[0]?.publishedAt ?? "",
  );
}

function groupId(article: Article): string {
  if (article.coverageBundle?.id) return article.coverageBundle.id;
  if (article.situationId) return `situation:${article.situationId}`;
  return `article:${article.id}`;
}

function uniqueGroupId(article: Article, groups: HomeArticleGroup[]): string {
  const baseId = groupId(article);
  if (!groups.some((group) => group.id === baseId)) return baseId;
  return `${baseId}:article:${article.id}`;
}

function sourceLabelsFor(articles: Article[]): string[] {
  return [...new Set(articles.map((article) => article.sourceLabel))];
}

function bundleFor(articles: Article[]): ArticleCoverageBundle | undefined {
  return articles.find((article) => article.coverageBundle)?.coverageBundle;
}

function articleFitsGroup(article: Article, group: HomeArticleGroup, memo: GroupPairMemo): boolean {
  const hasPairConflict = group.articles.some((existing) =>
    memoizedArticlesConflict(article, existing, memo),
  );
  if (
    hasPairConflict &&
    groupsConflict(
      {
        id: groupId(article),
        primary: article,
        articles: [article],
        sourceLabels: [article.sourceLabel],
        bundle: article.coverageBundle,
      },
      group,
      memo,
    )
  ) {
    return false;
  }
  return group.articles.some((existing) => memoizedArticlesSimilar(article, existing, memo));
}

function groupsConflict(
  left: HomeArticleGroup,
  right: HomeArticleGroup,
  memo: GroupPairMemo,
): boolean {
  const hasConflict = left.articles.some((leftArticle) =>
    right.articles.some((rightArticle) =>
      memoizedArticlesConflict(leftArticle, rightArticle, memo),
    ),
  );
  if (!hasConflict) return false;

  const hasExactTrafficBridge = left.articles.some((leftArticle) =>
    right.articles.some((rightArticle) =>
      isHighInformationTrafficCollisionMatch(leftArticle, rightArticle),
    ),
  );
  if (!hasExactTrafficBridge) return true;

  const allArticles = [...left.articles, ...right.articles];
  if (!allArticles.every(isTrafficCollisionArticle)) return true;
  return left.articles.some((leftArticle) =>
    right.articles.some(
      (rightArticle) =>
        trafficCollisionEvidenceConflicts(leftArticle, rightArticle) ||
        propertyCrimeEvidenceConflicts(leftArticle, rightArticle) ||
        Boolean(
          leftArticle.situationId &&
          rightArticle.situationId &&
          leftArticle.situationId !== rightArticle.situationId,
        ),
    ),
  );
}

function groupFromArticles(id: string, articles: Article[]): HomeArticleGroup {
  const sortedArticles = [...articles].sort(sortArticles);
  return {
    id,
    primary: sortedArticles[0]!,
    articles: sortedArticles,
    sourceLabels: sourceLabelsFor(sortedArticles),
    bundle: bundleFor(sortedArticles),
  };
}

function mergeCandidateGroups(
  article: Article,
  candidateGroups: HomeArticleGroup[],
  memo: GroupPairMemo,
): HomeArticleGroup[] {
  const mergeableGroups: HomeArticleGroup[] = [];
  const orderedCandidates = [...candidateGroups].sort(
    (left, right) =>
      Number(right.articles.some((existing) => sameCanonicalUrl(article, existing))) -
      Number(left.articles.some((existing) => sameCanonicalUrl(article, existing))),
  );
  for (const candidate of orderedCandidates) {
    if (
      mergeableGroups.some((existing) =>
        groupsConflict({ ...existing, articles: [article, ...existing.articles] }, candidate, memo),
      )
    ) {
      continue;
    }
    mergeableGroups.push(candidate);
  }
  return mergeableGroups;
}

export function groupHomeArticles(articles: Article[]): HomeArticleGroup[] {
  const groups: HomeArticleGroup[] = [];
  const sorted = collapsePublisherPathVariants(articles).sort(sortArticles);
  const memo: GroupPairMemo = { conflicts: new Map(), similarities: new Map() };

  sorted.forEach((article) => {
    const candidateGroups = groups.filter((candidate) =>
      articleFitsGroup(article, candidate, memo),
    );
    if (candidateGroups.length > 0) {
      const mergeableGroups = mergeCandidateGroups(article, candidateGroups, memo);
      const mergeableGroupIds = new Set(mergeableGroups.map((candidate) => candidate.id));
      const mergedGroupId = mergeableGroups[0]?.id ?? groupId(article);
      const mergedGroup = groupFromArticles(mergedGroupId, [
        article,
        ...mergeableGroups.flatMap((candidate) => candidate.articles),
      ]);
      groups.splice(
        0,
        groups.length,
        ...groups.filter((candidate) => !mergeableGroupIds.has(candidate.id)),
        mergedGroup,
      );
      return;
    }
    groups.push({
      id: uniqueGroupId(article, groups),
      primary: article,
      articles: [article],
      sourceLabels: [article.sourceLabel],
      bundle: article.coverageBundle,
    });
  });

  return normalizeHomeGroupsForServing(
    groups.sort((left, right) => sortArticles(left.primary, right.primary)),
  );
}

export function cityPulseStoryFromGroup(group: HomeArticleGroup): CityPulseStory {
  const editorialCopy = cityPulseEditorialCopy(group.articles);
  const titleArticle = group.articles.find(({ id }) => id === editorialCopy.title.articleId)!;
  return {
    id: group.id,
    primaryArticleId: group.primary.id,
    articleIds: group.articles.map((article) => article.id),
    primary: group.primary,
    articles: group.articles,
    sourceLabels: group.sourceLabels,
    sourceCount: group.sourceLabels.length,
    updateCount: group.articles.length,
    latestAt: latestArticleTimestamp(group.articles),
    category: titleArticle.category,
    editorialSelection: cityPulseEditorialSelection(group.articles),
    editorialCopy,
    ...(group.bundle ? { coverageBundle: group.bundle } : {}),
  };
}

export function buildCityPulseStories(articles: Article[]): CityPulseStory[] {
  return groupHomeArticles(articles).map(cityPulseStoryFromGroup);
}

function stableBundleArticleId(articles: Article[]): string {
  return [...articles].sort(
    (left, right) =>
      left.publishedAt.localeCompare(right.publishedAt) || left.id.localeCompare(right.id),
  )[0]!.id;
}

function hashBundleParts(parts: string[]): string {
  const value = parts.join("|");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function groupMembershipKey(group: HomeArticleGroup): string {
  return group.articles
    .map(({ id }) => id)
    .sort()
    .join("\u0000");
}

function naturalCoverageBundleId(articles: Article[]): string {
  const situationId = articles.find((article) => article.situationId)?.situationId;
  if (situationId) return `coverage:situation:${situationId}`;
  return `coverage:${hashBundleParts([stableBundleArticleId(articles)])}`;
}

function remappedCoverageBundleId(
  naturalId: string,
  memberArticleIds: string[],
  attempt: number,
): string {
  return `coverage:${hashBundleParts([
    "split",
    naturalId,
    ...memberArticleIds.sort(),
    String(attempt),
  ])}`;
}

function coverageBundleIdsForGroups(
  groups: HomeArticleGroup[],
  options: { preservePersistedIdsForSituationGroups?: boolean } = {},
): Map<string, string> {
  const candidates = groups
    .filter(({ articles }) => articles.length >= 2)
    .map((group) => {
      const claims = new Map<string, { articleCount: number; articles: Article[] }>();
      for (const article of group.articles) {
        const id = article.coverageBundle?.id;
        if (!id) continue;
        const claim = claims.get(id) ?? { articleCount: 0, articles: [] };
        claim.articleCount += 1;
        claim.articles.push(article);
        claims.set(id, claim);
      }
      return {
        group,
        groupKey: groupMembershipKey(group),
        naturalId: naturalCoverageBundleId(group.articles),
        claims: [...claims].filter(([, claim]) =>
          claim.articles.every((left, leftIndex) =>
            claim.articles
              .slice(leftIndex + 1)
              .every((right) => !coverageBundlesStale(left, right)),
          ),
        ),
      };
    });
  const previousIds = new Set(candidates.flatMap(({ claims }) => claims.map(([id]) => id)));
  const assignedIds = new Map<string, string>();
  const usedIds = new Set<string>();

  if (!options.preservePersistedIdsForSituationGroups) {
    for (const candidate of [...candidates]
      .filter(({ naturalId }) => naturalId.startsWith("coverage:situation:"))
      .sort((left, right) => left.groupKey.localeCompare(right.groupKey))) {
      let id = candidate.naturalId;
      let attempt = 0;
      while (usedIds.has(id)) {
        id = remappedCoverageBundleId(
          candidate.naturalId,
          candidate.group.articles.map(({ id: articleId }) => articleId),
          attempt,
        );
        attempt += 1;
      }
      assignedIds.set(candidate.groupKey, id);
      usedIds.add(id);
    }
  }

  const claimOptions = candidates.flatMap((candidate) =>
    candidate.claims.map(([previousId, claim]) => ({
      candidate,
      previousId,
      sharedCount: claim.articleCount,
    })),
  );
  const availablePreviousIds = new Set([...previousIds].filter((id) => !usedIds.has(id)));
  const assign = (groupKey: string, previousId: string) => {
    if (
      assignedIds.has(groupKey) ||
      usedIds.has(previousId) ||
      !availablePreviousIds.has(previousId)
    ) {
      return;
    }
    assignedIds.set(groupKey, previousId);
    usedIds.add(previousId);
    availablePreviousIds.delete(previousId);
  };

  [...claimOptions]
    .filter(({ candidate, previousId }) => candidate.naturalId === previousId)
    .sort((left, right) => left.candidate.groupKey.localeCompare(right.candidate.groupKey))
    .forEach(({ candidate, previousId }) => assign(candidate.groupKey, previousId));
  [...claimOptions]
    .sort(
      (left, right) =>
        right.sharedCount - left.sharedCount ||
        left.previousId.localeCompare(right.previousId) ||
        left.candidate.groupKey.localeCompare(right.candidate.groupKey),
    )
    .forEach(({ candidate, previousId }) => assign(candidate.groupKey, previousId));

  for (const candidate of [...candidates].sort((left, right) =>
    left.groupKey.localeCompare(right.groupKey),
  )) {
    if (assignedIds.has(candidate.groupKey)) continue;
    let id = candidate.naturalId;
    let attempt = 0;
    while (usedIds.has(id) || previousIds.has(id)) {
      id = remappedCoverageBundleId(
        candidate.naturalId,
        candidate.group.articles.map(({ id: articleId }) => articleId),
        attempt,
      );
      attempt += 1;
    }
    assignedIds.set(candidate.groupKey, id);
    usedIds.add(id);
  }

  if (new Set(assignedIds.values()).size !== assignedIds.size) {
    throw new Error("Coverage bundle identity assignment produced duplicate IDs");
  }
  return assignedIds;
}

function normalizeHomeGroupsForServing(groups: HomeArticleGroup[]): HomeArticleGroup[] {
  const bundleIds = coverageBundleIdsForGroups(groups, {
    preservePersistedIdsForSituationGroups: true,
  });
  return groups.map((group) => {
    if (group.articles.length === 1) {
      const article = { ...group.primary, coverageBundle: undefined };
      return {
        ...group,
        id: article.situationId ? `situation:${article.situationId}` : `article:${article.id}`,
        primary: article,
        articles: [article],
        bundle: undefined,
      };
    }

    const persistedBundle =
      group.bundle ?? group.articles.find(({ coverageBundle }) => coverageBundle)?.coverageBundle;
    if (!persistedBundle) return group;
    const assignedId = bundleIds.get(groupMembershipKey(group));
    if (!assignedId) {
      throw new Error("Persisted coverage group is missing an assigned identity");
    }
    const articles = group.articles.map((article) =>
      article.coverageBundle
        ? {
            ...article,
            coverageBundle: { ...article.coverageBundle, id: assignedId },
          }
        : article,
    );
    return {
      ...group,
      id: assignedId,
      primary: articles.find(({ id }) => id === group.primary.id) ?? articles[0]!,
      articles,
      bundle: { ...persistedBundle, id: assignedId },
    };
  });
}

function groupKind(articles: Article[]): ArticleCoverageBundleKind {
  const hasTopic = articles.some((article) => articleTopicSignals(article).size > 0);
  const hasIncident = articles.some((article) => articleIncidentSignals(article).size > 0);
  if (hasTopic && !hasIncident) return "topic";
  if (hasIncident) return "incident";
  return "update";
}

function groupConfidence(articles: Article[]): ArticleCoverageBundleConfidence {
  const distinctSources = new Set(articles.map((article) => article.source));
  if (articles.some((article) => article.situationId) || distinctSources.size > 1) return "high";
  return "medium";
}

function groupReason(kind: ArticleCoverageBundleKind, articles: Article[]): string {
  const distinctSources = new Set(articles.map((article) => article.source));
  if (kind === "topic") return "Samme nyhetstema";
  if (kind === "incident" && articles.some((article) => article.situationId)) {
    return "Samme hendelse med offisiell tråd";
  }
  if (kind === "incident" && distinctSources.size > 1) return "Samme hendelse på tvers av kilder";
  if (kind === "incident") return "Samme hendelse i oppdateringer";
  if (distinctSources.size > 1) return "Samme sak på tvers av kilder";
  return "Oppdateringer fra samme kilde";
}

function coverageBundleForGroup(
  articles: Article[],
  generatedAt: string,
  id: string | undefined,
): ArticleCoverageBundle | undefined {
  if (articles.length < 2) return undefined;
  if (!id) throw new Error("Coverage bundle group is missing an assigned identity");
  const kind = groupKind(articles);
  return {
    id,
    kind,
    confidence: groupConfidence(articles),
    reason: groupReason(kind, articles),
    generatedAt,
  };
}

function signalKey(signal: ArticleCoverageDecisionSignal): string {
  return `${signal.kind}:${signal.articleIds.join(":")}:${signal.detail ?? ""}`;
}

function uniqueSignals(signals: ArticleCoverageDecisionSignal[]): ArticleCoverageDecisionSignal[] {
  return [...new Map(signals.map((signal) => [signalKey(signal), signal])).values()];
}

function coverageDecisionForGroup(
  group: HomeArticleGroup,
  generatedAt: string,
  nearMisses: ArticleCoverageNearMiss[],
  id: string | undefined,
): ArticleCoverageBundleDecision | undefined {
  const bundle = coverageBundleForGroup(group.articles, generatedAt, id);
  if (!bundle) return undefined;
  const groupArticleIds = new Set(group.articles.map((article) => article.id));
  const signals = group.articles.flatMap((left, leftIndex) =>
    group.articles.slice(leftIndex + 1).flatMap((right) => articlePairSignals(left, right)),
  );
  return {
    ...bundle,
    primaryArticleId: group.primary.id,
    memberArticleIds: group.articles.map((article) => article.id),
    sourceIds: [...new Set(group.articles.map((article) => article.source))],
    sourceLabels: sourceLabelsFor(group.articles),
    signals: uniqueSignals(signals),
    nearMisses: nearMisses.filter((nearMiss) =>
      nearMiss.articleIds.some((articleId) => groupArticleIds.has(articleId)),
    ),
  };
}

function allNearMisses(articles: Article[]): ArticleCoverageNearMiss[] {
  return articles.flatMap((left, leftIndex) =>
    articles
      .slice(leftIndex + 1)
      .flatMap((right) =>
        articlePairSignals(left, right).length ? [] : (nearMissForPair(left, right) ?? []),
      ),
  );
}

export function analyzeArticleCoverage(
  articles: Article[],
  generatedAt = new Date().toISOString(),
): ArticleCoverageAnalysis {
  const groups = groupHomeArticles(articles);
  const nearMisses = allNearMisses(articles);
  const bundleIds = coverageBundleIdsForGroups(groups);
  const bundles = groups.flatMap(
    (group) =>
      coverageDecisionForGroup(
        group,
        generatedAt,
        nearMisses,
        bundleIds.get(groupMembershipKey(group)),
      ) ?? [],
  );
  const bundleByArticleId = new Map<string, ArticleCoverageBundle>();

  bundles.forEach((bundle) => {
    const articleBundle: ArticleCoverageBundle = {
      id: bundle.id,
      kind: bundle.kind,
      confidence: bundle.confidence,
      reason: bundle.reason,
      generatedAt: bundle.generatedAt,
    };
    bundle.memberArticleIds.forEach((articleId) => bundleByArticleId.set(articleId, articleBundle));
  });

  return {
    articles: articles.map((article) => ({
      ...article,
      coverageBundle: bundleByArticleId.get(article.id),
    })),
    bundles,
    nearMisses,
  };
}

export interface AnalyzeArticleCoverageV2Options {
  rejectedPairs?: CoverageRejectedPair[];
}

function v2GroupMatchConfidence(group: HomeArticleGroup): CoverageMatchConfidence {
  const accepted = group.acceptedEdges ?? [];
  const anchorId = group.primary.id;
  const admissions = group.articles
    .filter((article) => article.id !== anchorId)
    .map((article) => {
      const connecting = accepted
        .filter((edge) => edge.articleIds.includes(article.id))
        .sort((left, right) => right.score - left.score);
      const anchorEdge = connecting.find((edge) => edge.articleIds.includes(anchorId));
      return {
        score: anchorEdge?.score ?? connecting[1]?.score ?? connecting[0]?.score ?? 0,
        directStrong: anchorEdge?.tier === "strong",
      };
    });
  const strong =
    admissions.length === group.articles.length - 1 &&
    admissions.every((admission) => admission.directStrong);
  const minimum = Math.min(...admissions.map((admission) => admission.score));
  const cohesionPenalty = strong ? 0 : 0.05;
  return {
    tier: strong ? "strong" : "moderate",
    score: Math.max(0, Math.round((minimum - cohesionPenalty) * 1000) / 1000),
    rationale: strong
      ? "Alle støttesakene har et sterkt direkte treff med hovedsaken."
      : "Støttesakene er tatt inn gjennom hovedsak eller flertallstreff.",
  };
}

function coverageDecisionForV2Group(
  group: HomeArticleGroup,
  generatedAt: string,
  allEdges: ArticleCoverageEdge[],
): ArticleCoverageBundleDecision | undefined {
  if (group.articles.length < 2) return undefined;
  const memberIds = new Set(group.articles.map((article) => article.id));
  const groupEdges = allEdges.filter((edge) => edge.articleIds.every((id) => memberIds.has(id)));
  const accepted = groupEdges.filter(
    (edge) => edge.tier !== "weak" && edge.conflicts.length === 0 && !edge.reviewable,
  );
  const matchConfidence = v2GroupMatchConfidence({
    ...group,
    acceptedEdges: accepted,
  });
  const kind = accepted.some((edge) => edge.kind === "incident")
    ? "incident"
    : accepted.some((edge) => edge.kind === "topic")
      ? "topic"
      : "update";
  return {
    id: group.id,
    kind,
    confidence: matchConfidence.tier === "strong" ? "high" : "medium",
    reason:
      kind === "incident"
        ? "Samme hendelse"
        : kind === "topic"
          ? "Samme nyhetstema"
          : "Samme publiserte sak",
    generatedAt,
    matcherVersion: "v2",
    matchConfidence,
    primaryArticleId: group.primary.id,
    memberArticleIds: group.articles.map((article) => article.id),
    sourceIds: [...new Set(group.articles.map((article) => article.source))],
    sourceLabels: [...new Set(group.articles.map((article) => article.sourceLabel))],
    signals: uniqueSignals(accepted.flatMap((edge) => edge.signals)),
    nearMisses: groupEdges
      .filter((edge) => edge.reviewable)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map((edge) => ({
        articleIds: edge.articleIds,
        reason: edge.conflicts.some((conflict) => conflict.kind === "specific_place")
          ? "conflicting_specific_places"
          : "low_text_overlap",
        score: edge.score,
      })),
  };
}

function coverageBundleMetadata(bundle: ArticleCoverageBundleDecision): ArticleCoverageBundle {
  return {
    id: bundle.id,
    kind: bundle.kind,
    confidence: bundle.confidence,
    reason: bundle.reason,
    generatedAt: bundle.generatedAt,
    matcherVersion: "v2",
    matchConfidence: bundle.matchConfidence,
  };
}

export function analyzeArticleCoverageV2(
  articles: Article[],
  generatedAt = new Date().toISOString(),
  options: AnalyzeArticleCoverageV2Options = {},
): ArticleCoverageAnalysis {
  const rejectedPairKeys = new Set(
    (options.rejectedPairs ?? []).map(({ articleIds }) => [...articleIds].sort().join("\0")),
  );
  const evaluatedEdges = articles
    .flatMap((left, index) =>
      articles.slice(index + 1).flatMap((right) => articleCoverageEdge(left, right) ?? []),
    )
    .map((edge) =>
      rejectedPairKeys.has([...edge.articleIds].sort().join("\0"))
        ? {
            ...edge,
            reviewable: true,
            correctionConflict: edge.tier === "strong" || edge.tier === "moderate",
          }
        : edge,
    );
  const acceptedEdges = evaluatedEdges.filter(
    (edge) => edge.tier !== "weak" && edge.conflicts.length === 0 && !edge.reviewable,
  );
  const reviewCounts = new Map<string, number>();
  const correctionConflicts = evaluatedEdges.filter((edge) => edge.correctionConflict);
  const reviewableEdges = evaluatedEdges
    .filter((edge) => edge.reviewable && !edge.correctionConflict)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.articleIds.join("\u0000").localeCompare(right.articleIds.join("\u0000")),
    )
    .filter((edge) => {
      if (edge.articleIds.some((id) => (reviewCounts.get(id) ?? 0) >= 5)) return false;
      for (const id of edge.articleIds) reviewCounts.set(id, (reviewCounts.get(id) ?? 0) + 1);
      return true;
    })
    .slice(0, 500);
  const edges = [...acceptedEdges, ...correctionConflicts, ...reviewableEdges].sort((left, right) =>
    left.articleIds.join("\u0000").localeCompare(right.articleIds.join("\u0000")),
  );
  const blockingConflictEdges = evaluatedEdges.filter((edge) => edge.conflicts.length > 0);
  const clusteringEdges = [
    ...new Map(
      [...acceptedEdges, ...correctionConflicts, ...blockingConflictEdges].map((edge) => [
        edge.articleIds.join("\u0000"),
        edge,
      ]),
    ).values(),
  ].sort((left, right) =>
    left.articleIds.join("\u0000").localeCompare(right.articleIds.join("\u0000")),
  );
  const groups = clusterArticlesByCoverageEdges(articles, clusteringEdges, {
    rejectedPairs: options.rejectedPairs ?? [],
  });
  const bundles = groups.flatMap(
    (group) => coverageDecisionForV2Group(group, generatedAt, edges) ?? [],
  );
  const bundleByArticleId = new Map(
    bundles.flatMap((bundle) => bundle.memberArticleIds.map((id) => [id, bundle] as const)),
  );
  return {
    articles: articles.map((article) => {
      const bundle = bundleByArticleId.get(article.id);
      return bundle
        ? { ...article, coverageBundle: coverageBundleMetadata(bundle) }
        : { ...article, coverageBundle: undefined };
    }),
    bundles,
    nearMisses: [],
    edges,
  };
}

export function recomputeCoverageStories(
  articles: Article[],
  rejectedPairs: CoverageRejectedPair[],
  generatedAt = new Date().toISOString(),
): CityPulseStory[] {
  const analysis = analyzeArticleCoverageV2(articles, generatedAt, { rejectedPairs });
  const articlesById = new Map(analysis.articles.map((article) => [article.id, article]));
  const groupedArticleIds = new Set(
    analysis.bundles.flatMap(({ memberArticleIds }) => memberArticleIds),
  );
  const groupedStories = analysis.bundles.map((bundle) => {
    const members = bundle.memberArticleIds
      .map((id) => articlesById.get(id))
      .filter((article): article is Article => Boolean(article));
    const primary = articlesById.get(bundle.primaryArticleId) ?? members[0]!;
    return cityPulseStoryFromGroup({
      id: bundle.id,
      primary,
      articles: members,
      sourceLabels: bundle.sourceLabels,
      bundle,
    });
  });
  const singletonStories = analysis.articles
    .filter(({ id }) => !groupedArticleIds.has(id))
    .map((article) =>
      cityPulseStoryFromGroup({
        id: article.id,
        primary: article,
        articles: [article],
        sourceLabels: [article.sourceLabel],
      }),
    );
  return [...groupedStories, ...singletonStories].sort(
    (left, right) => right.latestAt.localeCompare(left.latestAt) || right.id.localeCompare(left.id),
  );
}

export function annotateArticleCoverageBundles(
  articles: Article[],
  generatedAt = new Date().toISOString(),
): Article[] {
  return analyzeArticleCoverage(articles, generatedAt).articles;
}
