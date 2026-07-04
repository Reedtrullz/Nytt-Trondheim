import type {
  Article,
  ArticleCoverageBundle,
  ArticleCoverageBundleConfidence,
  ArticleCoverageBundleKind,
  CityPulseStory,
} from "./types.js";
import { isFootballClubBrannContext } from "./incident-text.js";

export interface HomeArticleGroup {
  id: string;
  primary: Article;
  articles: Article[];
  sourceLabels: string[];
  bundle?: ArticleCoverageBundle;
}

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
}

export interface CoverageBundleSummary {
  recentBundleCount: number;
  byKind: Record<ArticleCoverageBundleKind, number>;
  byConfidence: Record<ArticleCoverageBundleConfidence, number>;
  latestGeneratedAt?: string;
}

export interface CoverageBundlePage {
  items: CoverageBundleListItem[];
  summary: CoverageBundleSummary;
  nextCursor?: string;
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
  ["vold", { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 3, minDistinctiveOverlap: 2 }],
  [
    "bryllup_uro",
    { windowMs: crossSourceIncidentWindowMs, minBodyOverlap: 2, minDistinctiveOverlap: 1 },
  ],
  ["street_order", { windowMs: 90 * 60 * 1000, minBodyOverlap: 2, minDistinctiveOverlap: 1 }],
  ["tyveri", { windowMs: nearDuplicateTextWindowMs, minBodyOverlap: 4, minDistinctiveOverlap: 2 }],
]);
const genericPlaceTokens = new Set(["trondheim", "trøndelag", "trondelag"]);
const nonIncidentPlaceTokens = new Set(["olavs"]);
const centralTrondheimPlaceAliases = new Set([
  "midtbyen",
  "sentrum",
  "trondheim sentrum",
  "prinsensgate",
  "prinsens gate",
  "elgesetergate",
  "elgesetergata",
  "elgesetergaten",
]);
const centralTrondheimAreaPattern = /\b(?:midtbyen|sentrum|trondheim\s+sentrum)\b/iu;
const centralTrondheimStreetPattern =
  /\b(?:prinsens\s*gate|prinsensgate|elgeseter(?:gate|gata|gaten)|elgesetergate|elgesetergata)\b/iu;
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
  "røyk",
  "røykutvikling",
  "slagsmål",
  "sloss",
  "slåss",
  "slåssing",
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
];
const topicSignals: Array<[string, (text: string) => boolean]> = [
  [
    "rosenborg_trener",
    (text) =>
      /\b(rosenborg\w*|rbk)\b/iu.test(text) &&
      /\b(hovedtrener\w*|trenerjobb\w*|trener\w*|ansatt\w*|presentert\w*)\b/iu.test(text),
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

function sameCanonicalUrl(left: Article, right: Article): boolean {
  return left.url.length > 0 && left.url === right.url;
}

function articleText(article: Article): string {
  return [article.title, article.excerpt, article.location?.label, ...article.places]
    .filter(Boolean)
    .join(" ");
}

function articleIncidentSignals(article: Article): Set<string> {
  const text = articleText(article);
  const signals = new Set(
    incidentSignals.flatMap(([signal, pattern]) => (pattern.test(text) ? [signal] : [])),
  );
  if (signals.has("brann") && isFootballClubBrannContext(article)) signals.delete("brann");
  return signals;
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
  const text = articleText(article);
  return new Set([
    ...topicSignals.flatMap(([signal, matches]) => (matches(text) ? [signal] : [])),
    ...sportsResultTopicSignals(text),
  ]);
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

function compatibleStreetOrderSituationSignal(
  left: Article,
  right: Article,
): ArticleCoverageDecisionSignal | undefined {
  if (!left.situationId || !right.situationId || left.situationId === right.situationId) {
    return undefined;
  }
  const rule = genericPlaceIncidentSignalRules.get("street_order");
  if (!rule || publishedDistanceMs(left, right) > rule.windowMs) return undefined;
  if (!sameBroadCategory(left, right) || !hasSharedPlace(left, right)) return undefined;
  if (!sharedIncidentSignals(left, right).has("street_order")) return undefined;
  const body = tokenSimilarity(tokens(articleText(left)), tokens(articleText(right)));
  const distinctive = tokenSimilarity(
    distinctiveIncidentTokens(articleText(left)),
    distinctiveIncidentTokens(articleText(right)),
  );
  if (body.overlap < rule.minBodyOverlap || distinctive.overlap < rule.minDistinctiveOverlap) {
    return undefined;
  }
  return {
    kind: "generic_place_incident",
    articleIds: [left.id, right.id],
    detail: "street_order",
    overlap: body.overlap,
    score: body.score,
  };
}

function articlesConflict(left: Article, right: Article): boolean {
  if (left.situationId && right.situationId && left.situationId !== right.situationId) {
    return !compatibleStreetOrderSituationSignal(left, right);
  }
  return hasConflictingSpecificPlaces(left, right) && hasSharedIncidentSignal(left, right);
}

function genericPlaceIncidentSignals(
  left: Article,
  right: Article,
  body: { overlap: number; score: number },
): ArticleCoverageDecisionSignal[] {
  if (hasConflictingSpecificPlaces(left, right)) return [];
  if (!sameBroadCategory(left, right)) return [];
  const distance = publishedDistanceMs(left, right);
  const distinctive = tokenSimilarity(
    distinctiveIncidentTokens(articleText(left)),
    distinctiveIncidentTokens(articleText(right)),
  );
  return [...sharedIncidentSignals(left, right)].flatMap((signal) => {
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
    const compatibleStreetOrderSignal = compatibleStreetOrderSituationSignal(left, right);
    return compatibleStreetOrderSignal ? [...signals, compatibleStreetOrderSignal] : [];
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
  if (coverageBundlesCompatible(left, right)) {
    signals.push({
      kind: "persisted_bundle",
      articleIds: [left.id, right.id],
      detail: left.coverageBundle?.id,
    });
    return signals;
  }
  if (publishedDistanceMs(left, right) > maxGroupAgeMs) return [];

  const title = tokenSimilarity(tokens(left.title), tokens(right.title));
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

  const body = tokenSimilarity(tokens(articleText(left)), tokens(articleText(right)));
  if (
    publishedDistanceMs(left, right) <= nearDuplicateTextWindowMs &&
    body.overlap >= 10 &&
    body.score >= 0.5 &&
    sameBroadCategory(left, right)
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
  const body = tokenSimilarity(tokens(articleText(left)), tokens(articleText(right)));
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

function sortArticles(left: Article, right: Article): number {
  return right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id);
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

function articleFitsGroup(article: Article, group: HomeArticleGroup): boolean {
  if (group.articles.some((existing) => articlesConflict(article, existing))) return false;
  return group.articles.some((existing) => articlesSimilar(article, existing));
}

function groupsConflict(left: HomeArticleGroup, right: HomeArticleGroup): boolean {
  return left.articles.some((leftArticle) =>
    right.articles.some((rightArticle) => articlesConflict(leftArticle, rightArticle)),
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
): HomeArticleGroup[] {
  const mergeableGroups: HomeArticleGroup[] = [];
  for (const candidate of candidateGroups) {
    if (mergeableGroups.some((existing) => groupsConflict(existing, candidate))) continue;
    mergeableGroups.push(candidate);
  }
  return mergeableGroups;
}

export function groupHomeArticles(articles: Article[]): HomeArticleGroup[] {
  const groups: HomeArticleGroup[] = [];
  const sorted = [...articles].sort(sortArticles);

  sorted.forEach((article) => {
    const candidateGroups = groups.filter((candidate) => articleFitsGroup(article, candidate));
    if (candidateGroups.length > 0) {
      const mergeableGroups = mergeCandidateGroups(article, candidateGroups);
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

  return groups.sort((left, right) => sortArticles(left.primary, right.primary));
}

export function cityPulseStoryFromGroup(group: HomeArticleGroup): CityPulseStory {
  return {
    id: group.id,
    primaryArticleId: group.primary.id,
    articleIds: group.articles.map((article) => article.id),
    primary: group.primary,
    articles: group.articles,
    sourceLabels: group.sourceLabels,
    sourceCount: group.sourceLabels.length,
    updateCount: group.articles.length,
    latestAt: group.primary.publishedAt,
    category: group.primary.category,
    ...(group.bundle ? { coverageBundle: group.bundle } : {}),
  };
}

export function buildCityPulseStories(articles: Article[]): CityPulseStory[] {
  return groupHomeArticles(articles).map(cityPulseStoryFromGroup);
}

function coverageBundlesCompatible(left: Article, right: Article): boolean {
  const bundleId = left.coverageBundle?.id;
  if (!bundleId || bundleId !== right.coverageBundle?.id) return false;
  if (bundleId.startsWith("coverage:situation:")) return true;
  if (publishedDistanceMs(left, right) > maxGroupAgeMs) return false;
  return sameBroadCategory(left, right) || left.coverageBundle?.kind === right.coverageBundle?.kind;
}

function stableBundleArticleId(articles: Article[]): string {
  return [...articles].sort(
    (left, right) =>
      left.publishedAt.localeCompare(right.publishedAt) || left.id.localeCompare(right.id),
  )[0]!.id;
}

function reusableCoverageBundleId(articles: Article[]): string | undefined {
  const candidates = new Map<
    string,
    { id: string; generatedAt: string; memberCount: number; articles: Article[] }
  >();

  for (const article of articles) {
    const bundle = article.coverageBundle;
    if (!bundle?.id || bundle.id.startsWith("coverage:situation:")) continue;
    const candidate = candidates.get(bundle.id) ?? {
      id: bundle.id,
      generatedAt: bundle.generatedAt,
      memberCount: 0,
      articles: [],
    };
    candidate.memberCount += 1;
    candidate.articles.push(article);
    if (bundle.generatedAt < candidate.generatedAt) candidate.generatedAt = bundle.generatedAt;
    candidates.set(bundle.id, candidate);
  }

  return [...candidates.values()]
    .filter((candidate) =>
      candidate.articles.every((left, leftIndex) =>
        candidate.articles
          .slice(leftIndex + 1)
          .every((right) => !coverageBundlesStale(left, right)),
      ),
    )
    .sort(
      (left, right) =>
        right.memberCount - left.memberCount ||
        left.generatedAt.localeCompare(right.generatedAt) ||
        left.id.localeCompare(right.id),
    )[0]?.id;
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

function coverageBundleId(articles: Article[]): string {
  const situationId = articles.find((article) => article.situationId)?.situationId;
  if (situationId) return `coverage:situation:${situationId}`;
  const reusableId = reusableCoverageBundleId(articles);
  if (reusableId) return reusableId;
  const anchor = stableBundleArticleId(articles);
  return `coverage:${hashBundleParts([anchor])}`;
}

function coverageBundleForGroup(
  articles: Article[],
  generatedAt: string,
): ArticleCoverageBundle | undefined {
  if (articles.length < 2) return undefined;
  const kind = groupKind(articles);
  return {
    id: coverageBundleId(articles),
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
): ArticleCoverageBundleDecision | undefined {
  const bundle = coverageBundleForGroup(group.articles, generatedAt);
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
  const bundles = groups.flatMap(
    (group) => coverageDecisionForGroup(group, generatedAt, nearMisses) ?? [],
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

export function annotateArticleCoverageBundles(
  articles: Article[],
  generatedAt = new Date().toISOString(),
): Article[] {
  return analyzeArticleCoverage(articles, generatedAt).articles;
}
