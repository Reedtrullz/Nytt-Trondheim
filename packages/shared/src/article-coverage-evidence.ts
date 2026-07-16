import type { Article } from "./types.js";

export type CoverageMatcherVersion = "v1" | "v2";

export type ArticleIncidentSubtype =
  | "building_fire"
  | "vehicle_fire"
  | "vegetation_fire"
  | "construction_fire"
  | "cooking_smoke"
  | "storage_burglary"
  | "shop_theft"
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
  | "shared_official_traffic_collision_companion"
  | "shared_high_information_traffic_collision"
  | "shared_fatal_traffic_fingerprint"
  | "shared_property_crime_event"
  | "shared_city_incident_fingerprint"
  | "shared_exact_event_fingerprint"
  | "compatible_incident_subtype";

export interface ArticleCoveragePairEvidence {
  articleIds: [string, string];
  positiveIncidentEvidence: PositiveIncidentEvidence[];
  incidentSubtypes: [ArticleIncidentSubtype, ArticleIncidentSubtype];
  cityIncidentFingerprints: [string | undefined, string | undefined];
  sharedCityIncidentFingerprint?: string;
  exactEventFingerprints: [string[], string[]];
  sharedExactEventFingerprints: string[];
  sharedBodyTokenCount: number;
  bodyScore: number;
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
  positiveIncidentEvidence: PositiveIncidentEvidence[];
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

const genericPlaceTokens = new Set([
  "trondheim",
  "trøndelag",
  "trondelag",
  "sentrum",
  "midtbyen",
  "trondheim sentrum",
]);
const nonIncidentPlaceTokens = new Set(["olavs"]);
const genericIncidentTokens = new Set([
  ...genericPlaceTokens,
  "anleggsbrakke",
  "bil",
  "bilbrann",
  "brann",
  "brant",
  "brakke",
  "byggeplass",
  "fjordland",
  "bortvist",
  "bortvisning",
  "bortvise",
  "kollisjon",
  "kontroll",
  "flere",
  "involvert",
  "kjøretøy",
  "komfyr",
  "mann",
  "meldt",
  "melding",
  "meldinger",
  "middag",
  "nødetatene",
  "ordensforstyrrelse",
  "person",
  "personer",
  "politiet",
  "slagsmål",
  "sloss",
  "slåss",
  "utested",
  "utestengt",
  "trafikkulykke",
  "trussel",
  "vold",
  "røyk",
  "røykutvikling",
  "skogbrann",
  "trafikk",
  "ulykke",
  "vegetasjon",
]);
const namedEntityStopTokens = new Set([
  "ambulanse",
  "brannvesenet",
  "flere",
  "hendelse",
  "kollisjon",
  "mange",
  "meldt",
  "ny",
  "nytt",
  "oppdatering",
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
  "personer",
  "slagsmål",
  "utested",
  "utestengt",
  "norge",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
  "søndag",
]);
const recognizedSentenceInitialSingleTokenEntities = new Set(["solsiden"]);
const fireSubtypes = new Set<ArticleIncidentSubtype>([
  "building_fire",
  "vehicle_fire",
  "vegetation_fire",
  "construction_fire",
  "cooking_smoke",
]);
const trafficCompatibleCategories = new Set(["Hendelser", "Krim", "Nyheter", "Transport"]);
interface FatalTrafficArticleFingerprint {
  fatality: boolean;
  trafficIncident: boolean;
  charged: boolean;
  roads: Set<string>;
  ageDecades: Set<string>;
}
const fatalTrafficFingerprintCache = new WeakMap<Article, FatalTrafficArticleFingerprint>();

interface HighInformationTrafficCollisionFingerprint {
  trafficCollision: boolean;
  roads: Set<string>;
  reportedClockMinutes: Set<number>;
  involvedPersonCounts: Set<number>;
}

type HighInformationTrafficCollisionRelation =
  | "not_applicable"
  | "compatible"
  | "conflicting"
  | "insufficient";

const highInformationTrafficCollisionFingerprintCache = new WeakMap<
  Article,
  HighInformationTrafficCollisionFingerprint
>();

const officialSituationWindowMs = 72 * 60 * 60 * 1000;
// A locality is corroborating context, not an event identifier. Beyond two hours, a place must be
// backed by a stronger signal such as an exact entity, a topic fingerprint, or near-duplicate text.
const specificPlaceWindowMs = 2 * 60 * 60 * 1000;
const namedEntityWindowMs = 8 * 60 * 60 * 1000;
const nearDuplicateWindowMs = 24 * 60 * 60 * 1000;
const topicalThreadWindowMs = 12 * 60 * 60 * 1000;
const exactEventFingerprintWindowMs = 60 * 60 * 1000;

export const highDetailNearDuplicatePolicy = {
  windowMs: 15 * 60 * 1000,
  minBodyOverlap: 12,
  minBodyScore: 0.38,
  minDistinctiveOverlap: 8,
} as const;

export const fatalTrafficFollowUpPolicy = {
  windowMs: 8 * 60 * 60 * 1000,
} as const;

export const highInformationTrafficCollisionPolicy = {
  windowMs: 2 * 60 * 60 * 1000,
} as const;

export const entityBackedNotificationFollowUpPolicy = {
  windowMs: 24 * 60 * 60 * 1000,
} as const;

export const propertyCrimeEventPolicy = {
  windowMs: 3 * 60 * 60 * 1000,
} as const;

interface CityIncidentFingerprintRule {
  windowMs: number;
  minBodyOverlap: number;
  minDistinctiveOverlap: number;
  requiredSharedTokenFamilies: RegExp[];
}

const storageUnitPattern =
  /(?:^|[^\p{L}\p{N}_])(?:sykkel|lager|butikk)?bod(?:en|er|ene)?(?![\p{L}\p{N}_])/u;

const cityIncidentFingerprintRules = new Map<string, CityIncidentFingerprintRule>([
  [
    "property:storage-burglary",
    {
      windowMs: 3 * 60 * 60 * 1000,
      minBodyOverlap: 3,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\bsykl\w*\b/u, /\bsamei\w*\b/u],
    },
  ],
  [
    "property:shop-theft",
    {
      windowMs: 2 * 60 * 60 * 1000,
      minBodyOverlap: 3,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\bfrokost\w*\b/u, /\bingrediens\w*\b/u],
    },
  ],
  [
    "fire:construction",
    {
      windowMs: 2 * 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\banleggs?brakk\w*\b/u, /\bbyggeplass\w*\b/u],
    },
  ],
  [
    "fire:vegetation",
    {
      windowMs: 2 * 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [
        /\bskog\w*\b/u,
        /\bgress\w*\b/u,
        /\blyng\w*\b/u,
        /\bvegetasjon\w*\b/u,
      ],
    },
  ],
  [
    "fire:building",
    {
      windowMs: 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [
        /\bleilighet\w*\b/u,
        /\bbolig\w*\b/u,
        /\bhus\w*\b/u,
        /\bgarasje\w*\b/u,
        /\bbygning\w*\b/u,
      ],
    },
  ],
  [
    "fire:vehicle",
    {
      windowMs: 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\bbil\w*\b/u, /\bkjøretøy\w*\b/u],
    },
  ],
  [
    "fire:cooking",
    {
      windowMs: 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [
        /\bmatlag\w*\b/u,
        /\bkomfyr\w*\b/u,
        /\bmiddag\w*\b/u,
        /\bstekt\w*\b/u,
      ],
    },
  ],
  [
    "order:fight",
    {
      windowMs: 30 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [
        /\bkniv\w*\b/u,
        /\bvåpen\w*\b/u,
        /\bskadet\w*\b/u,
        /\bambulanse\w*\b/u,
        /\bflaske\w*\b/u,
      ],
    },
  ],
  [
    "order:removed",
    {
      windowMs: 30 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\bvekter\w*\b/u, /\bdørvakt\w*\b/u, /\bserveringssted\w*\b/u],
    },
  ],
  [
    "order:disturbance",
    {
      windowMs: 30 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\bstøy\w*\b/u, /\bnattero\w*\b/u, /\bmusikk\w*\b/u],
    },
  ],
  [
    "violence:threat",
    {
      windowMs: 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [
        /\bkniv\w*\b/u,
        /\bvåpen\w*\b/u,
        /\bbombe\w*\b/u,
        /\bdrapstrussel\w*\b/u,
      ],
    },
  ],
  [
    "violence:assault",
    {
      windowMs: 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [
        /\bskadet\w*\b/u,
        /\bambulanse\w*\b/u,
        /\bkniv\w*\b/u,
        /\bslag\w*\b/u,
      ],
    },
  ],
  [
    "collision:vulnerable-road-user",
    {
      windowMs: 90 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\bfotgjenger\w*\b/u, /\bsyklist\w*\b/u, /\bpåkjør\w*\b/u],
    },
  ],
  [
    "collision:single-vehicle",
    {
      windowMs: 90 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\butforkjør\w*\b/u, /\bkjørte\s+(?:av|ut)\b/u],
    },
  ],
  [
    "collision:multiple-vehicles",
    {
      windowMs: 60 * 60 * 1000,
      minBodyOverlap: 4,
      minDistinctiveOverlap: 2,
      requiredSharedTokenFamilies: [/\bto\s+bil\w*\b/u, /\bflere\s+(?:bil\w*|kjøretøy\w*)\b/u],
    },
  ],
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

export function publisherStoryIdentityKey(value: string): string | undefined {
  try {
    const url = new URL(value);
    const storyId = url.pathname.match(/\/i\/([^/]+)(?:\/|$)/u)?.[1];
    if (!storyId) return undefined;
    return `${url.hostname.replace(/^www\./u, "")}:${storyId}`;
  } catch {
    return undefined;
  }
}

export function samePublisherStoryUrl(left: Article, right: Article): boolean {
  if (left.url.length === 0 || right.url.length === 0) return false;
  if (left.url === right.url) return true;
  const leftStoryKey = publisherStoryIdentityKey(left.url);
  return leftStoryKey !== undefined && leftStoryKey === publisherStoryIdentityKey(right.url);
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

export function articleExactEventFingerprints(article: Article): string[] {
  const text = normalizeText(
    [article.title, article.excerpt, article.location?.label, ...article.places].join(" "),
  );
  const fingerprints = new Set<string>();

  const animal = [
    ["elg", /\belg\w*\b/u],
    ["hjort", /\bhjort\w*\b/u],
    ["rein", /\brein\w*\b/u],
    ["radyr", /\brådyr\w*\b/u],
  ].find(([, pattern]) => (pattern as RegExp).test(text))?.[0];
  if (animal) {
    for (const match of text.matchAll(/\b(e|rv|fv)\s*(\d{1,4})\b/gu)) {
      fingerprints.add(`road-animal:${match[1]}${match[2]}:${animal}`);
    }
  }

  if (
    /(?:^|\s)øks\w*(?:$|\s)/u.test(text) &&
    /\b(?:bil\w*|kjøretøy\w*)\b/u.test(text) &&
    /\b(?:gikk\s+løs|skad\w*|knus\w*|ødel\w*|hærverk\w*)\b/u.test(text)
  ) {
    fingerprints.add("vehicle-damage:axe");
  }

  const impairedDriving =
    /\bruskjør\w*\b/u.test(text) ||
    (/\b(?:ruspåvirk\w*|berus\w*)\b/u.test(text) &&
      /\b(?:bil\w*|fører\w*|kjør\w*|kjøretøy\w*)\b/u.test(text));
  if (impairedDriving) {
    for (const match of text.matchAll(/\b([a-zæøå]{3,}(?:gata|gaten|gate|vegen|veien))\b/gu)) {
      fingerprints.add(`impaired-driving:street:${match[1]}`);
    }
    if (/\bblodprøv\w*\b/u.test(text)) {
      for (const match of text.matchAll(/\b(\d{2})\s*(?:årene|åra)\b/gu)) {
        fingerprints.add(`impaired-driving:age-blood:${match[1]}`);
      }
    }
  }

  return [...fingerprints].sort();
}

export function sharedExactEventFingerprints(left: Article, right: Article): string[] {
  if (left.source === right.source) return [];
  const timeDistanceMs = Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  if (!Number.isFinite(timeDistanceMs) || timeDistanceMs > exactEventFingerprintWindowMs) return [];
  const rightFingerprints = new Set(articleExactEventFingerprints(right));
  return articleExactEventFingerprints(left).filter((item) => rightFingerprints.has(item));
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
  if (["fanrem", "fannrem"].includes(normalized)) return "fannrem";
  if (["kroppanbrua", "kroppan bru"].includes(normalized)) return "kroppan-bru";
  if (["prinsengate", "prinsen gate", "prinsensgate", "prinsens gate"].includes(normalized)) {
    return "prinsens gate";
  }
  if (["elgeseter gate", "elgesetergate", "elgesetergata", "elgesetergaten"].includes(normalized)) {
    return "elgeseter gate";
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
            !nonIncidentPlaceTokens.has(place) &&
            !/\bfylkeskommune$/u.test(place),
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
  const containsPlace = (text: string, place: string) => {
    const escaped = place
      .split(" ")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "u").test(text);
  };
  return (
    articlePlaceTokens(left).some((place) => containsPlace(rightText, place)) ||
    articlePlaceTokens(right).some((place) => containsPlace(leftText, place))
  );
}

function hasConflictingSpecificPlaces(left: Article, right: Article): boolean {
  const leftPlaces = articlePlaceTokens(left);
  const rightPlaces = articlePlaceTokens(right);
  if (leftPlaces.length === 0 || rightPlaces.length === 0) return false;
  return !leftPlaces.some((place) => rightPlaces.includes(place));
}

function articleNamedEntityTokens(article: Article): string[] {
  const text = `${article.title}. ${article.excerpt}`;
  const dottedOrganizationCandidates = [
    ...text.matchAll(/\b(?:[\p{Lu}ÆØÅ]\.){2,}\s*[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}\b/gu),
  ].map((match) => normalizeToken(match[0]));
  const capitalizedPhraseMatches = [
    ...text.matchAll(
      /\b[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}(?:\s+[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}){0,2}\b/gu,
    ),
  ];
  const capitalizedPhraseCandidates = capitalizedPhraseMatches.flatMap((match) => {
    const candidate = match[0];
    const normalizedCandidate = normalizeToken(candidate);
    const index = match.index ?? 0;
    const sentenceInitial = index === 0 || /[.!?]\s*$/u.test(text.slice(0, index));
    if (
      !candidate.includes(" ") &&
      sentenceInitial &&
      !recognizedSentenceInitialSingleTokenEntities.has(normalizedCandidate)
    ) {
      return [];
    }
    return [normalizedCandidate];
  });
  const candidates = [...dottedOrganizationCandidates, ...capitalizedPhraseCandidates];
  const declaredPlaces = new Set(
    [article.location?.label, ...article.places]
      .filter((place): place is string => Boolean(place))
      .map(canonicalPlace),
  );
  return [...new Set(candidates)].filter((token) => {
    if (token.length < 4 || genericPlaceTokens.has(token) || namedEntityStopTokens.has(token)) {
      return false;
    }
    // Place extraction frequently repeats a municipality as a capitalized entity in the story.
    // Counting the same value as both place and named-entity evidence makes locality alone look
    // like two independent signals and caused unrelated same-area stories to auto-group.
    if (declaredPlaces.has(token) || /\bfylkeskommune$/u.test(token)) return false;
    const parts = token.split(" ");
    return parts.some(
      (part) =>
        !genericPlaceTokens.has(part) &&
        !namedEntityStopTokens.has(part) &&
        !genericIncidentTokens.has(part),
    );
  });
}

function hasSharedNamedEntity(left: Article, right: Article): boolean {
  const rightEntities = new Set(articleNamedEntityTokens(right));
  return articleNamedEntityTokens(left).some((token) => rightEntities.has(token));
}

function canonicalTrafficRoad(value: string): string {
  return normalizeToken(value)
    .replace(/^håkon\b/u, "haakon")
    .replace(/\bvii(?:\s+s|s)?\b/u, "viis")
    .replace(/\s+(?:gata|gaten)$/u, " gate")
    .replace(/(?:gata|gaten)$/u, "gate")
    .replace(/\s+(?:veien|vegen)$/u, " vei")
    .replace(/(?:veien|vegen)$/u, "vei");
}

function articleTrafficRoads(article: Article): Set<string> {
  const text = `${article.title}. ${article.excerpt}`;
  const roads = new Set<string>();
  for (const match of text.matchAll(
    /\b([\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]*(?:\s+(?:[IVXLCDM]+(?:[,'’]?s)?|[\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]*)){0,3}\s+(?:gate|gata|gaten|vei|veien|veg|vegen))\b/gu,
  )) {
    if (match[1]) roads.add(canonicalTrafficRoad(match[1]));
  }
  for (const match of text.matchAll(
    /\b([\p{Lu}ÆØÅ][\p{L}ÆØÅæøå-]{2,}(?:gata|gaten|veien|vegen))\b/gu,
  )) {
    if (match[1]) roads.add(canonicalTrafficRoad(match[1]));
  }
  return roads;
}

function hasTrafficCollisionLanguage(article: Article): boolean {
  const text = normalizedText(article);
  if (
    /\b(?:kollisj\w*|kollider\w*|trafikkuhell\w*|trafikkulykk\w*|påkjør\w*|kjørte\s+(?:av|ut))\b/u.test(
      text,
    )
  ) {
    return true;
  }
  const trafficContext =
    article.category === "Transport" ||
    /\b(?:bil\w*|kjøretøy\w*|trafikk\w*|veg\w*|vei\w*)\b/u.test(text);
  return Boolean(trafficContext && /\b(?:sammenstøt\w*|ulykk\w*)\b/u.test(text));
}

export function isTrafficCollisionArticle(article: Article): boolean {
  return hasTrafficCollisionLanguage(article);
}

export function articleIncidentSubtype(article: Article): ArticleIncidentSubtype {
  const text = normalizedText(article);
  if (
    /\b(?:innbrudd\w*|br[øo]t\s+seg\s+inn|brutt\s+seg\s+inn|tyveri\w*|stj(?:e|å|a)l\w*)\b/u.test(
      text,
    ) &&
    storageUnitPattern.test(text)
  ) {
    return "storage_burglary";
  }
  if (/\b(?:tyveri\w*|tyv\w*|stj(?:e|å|a)l\w*)\b/u.test(text) && /\bbutikk\w*\b/u.test(text)) {
    return "shop_theft";
  }
  const hasActiveFire = /\b(?:[\p{L}]+brann(?:en|er)?|brann(?:en|er)?|brant|brenner)\b/u.test(text);
  const hasFireOrSmoke = hasActiveFire || /\brøyk\w*\b/u.test(text);
  if (
    /\bbilbrann\w*\b/u.test(text) ||
    (hasFireOrSmoke &&
      /\b(?:bil\w*|kjøretøy\w*)\b.{0,40}\b(?:brann\w*|brant|brenner|røyk\w*)\b|\b(?:brann\w*|brant|brenner|røyk\w*)\b.{0,40}\b(?:bil\w*|kjøretøy\w*)\b/u.test(
        text,
      ))
  ) {
    return "vehicle_fire";
  }
  if (
    /\b(?:skogbrann|gressbrann|lyngbrann)\w*\b/u.test(text) ||
    (hasFireOrSmoke &&
      /\b(?:skog\w*|gress\w*|lyng\w*|vegetasjon\w*)\b.{0,40}\b(?:brann\w*|brant|brenner|røyk\w*)\b|\b(?:brann\w*|brant|brenner|røyk\w*)\b.{0,40}\b(?:skog\w*|gress\w*|lyng\w*|vegetasjon\w*)\b/u.test(
        text,
      ))
  ) {
    return "vegetation_fire";
  }
  if (
    /\b(?:bygningsbrann|husbrann|garasjebrann)\w*\b/u.test(text) ||
    (hasActiveFire &&
      /\b(?:leilighet\w*|bolig\w*|hus\w*|garasje\w*|bygning\w*)\b.{0,40}\b(?:brann\w*|brant|brenner)\b|\b(?:brann\w*|brant|brenner)\b.{0,40}\b(?:leilighet\w*|bolig\w*|hus\w*|garasje\w*|bygning\w*)\b/u.test(
        text,
      ))
  ) {
    return "building_fire";
  }
  if (hasFireOrSmoke && /\b(?:matlag\w*|stekt\w*|komfyr\w*|middag\w*|fjordland\w*)\b/u.test(text)) {
    return "cooking_smoke";
  }
  if (
    /\b(?:leilighet\w*|bolig\w*|hus\w*|garasje\w*|bygning\w*)\b.{0,40}\brøyk\w*\b|\brøyk\w*\b.{0,40}\b(?:leilighet\w*|bolig\w*|hus\w*|garasje\w*|bygning\w*)\b/u.test(
      text,
    )
  ) {
    return "building_fire";
  }
  if (
    hasFireOrSmoke &&
    /\b(?:byggeplass\w*|anleggsbrakke\w*|brakke(?:brann|n)?\w*)\b/u.test(text)
  ) {
    return "construction_fire";
  }
  if (hasTrafficCollisionLanguage(article)) {
    return "traffic_collision";
  }
  if (/\b(trussel\w*|vold\w*|pågrepet)\b/u.test(text)) return "threat_or_violence";
  if (/\b(ordensforstyrrelse|bortvis\w*|slagsm[åa]l\w*)\b/u.test(text)) return "public_order";
  return "unknown";
}

function articleCityIncidentFingerprint(article: Article): string | undefined {
  const text = normalizedText(article);
  switch (articleIncidentSubtype(article)) {
    case "storage_burglary":
      return "property:storage-burglary";
    case "shop_theft":
      return "property:shop-theft";
    case "construction_fire":
      return "fire:construction";
    case "cooking_smoke":
      return "fire:cooking";
    case "vehicle_fire":
      return "fire:vehicle";
    case "vegetation_fire":
      return "fire:vegetation";
    case "building_fire":
      return "fire:building";
    case "public_order":
      if (/\b(slagsm[åa]l\w*|sloss\w*|slåss\w*)\b/u.test(text)) return "order:fight";
      if (/\bbortvis\w*\b/u.test(text)) return "order:removed";
      if (/\bordensforstyr\w*\b/u.test(text)) return "order:disturbance";
      return undefined;
    case "threat_or_violence":
      if (/\btrussel\w*\b/u.test(text)) return "violence:threat";
      if (/\b(vold\w*|angrep\w*)\b/u.test(text)) return "violence:assault";
      return undefined;
    case "traffic_collision":
      if (/\b(fotgjenger\w*|syklist\w*|påkjør\w*)\b/u.test(text)) {
        return "collision:vulnerable-road-user";
      }
      if (/\b(utforkjør\w*|kjørte\s+(?:av|ut))\b/u.test(text)) {
        return "collision:single-vehicle";
      }
      if (/\b(to|flere)\s+(?:bil\w*|kjøretøy\w*)\b/u.test(text)) {
        return "collision:multiple-vehicles";
      }
      return undefined;
    case "unknown":
      return undefined;
  }
}

function subtypesCompatible(left: ArticleIncidentSubtype, right: ArticleIncidentSubtype): boolean {
  return left !== "unknown" && left === right;
}

function subtypePair(left: ArticleIncidentSubtype, right: ArticleIncidentSubtype): string {
  return [left, right].sort().join("\u0000");
}

type PropertyCrimeEvidenceRelation = "not_applicable" | "compatible" | "unmatched";

const propertyCrimeSubtypes = new Set<ArticleIncidentSubtype>(["shop_theft", "storage_burglary"]);

function hasMixedPropertyCrimeSubtypes(
  left: ArticleIncidentSubtype,
  right: ArticleIncidentSubtype,
): boolean {
  return subtypePair(left, right) === "shop_theft\u0000storage_burglary";
}

const osloClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function officialPolitiloggenClockMinute(article: Article): number | undefined {
  if (article.source !== "politiloggen" || !article.situationId?.startsWith("politiloggen-")) {
    return undefined;
  }
  const publishedAt = new Date(article.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) return undefined;
  const parts = new Map(
    osloClockFormatter.formatToParts(publishedAt).map(({ type, value }) => [type, value]),
  );
  const hour = Number(parts.get("hour"));
  const minute = Number(parts.get("minute"));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  return hour * 60 + minute;
}

function articleReportedClockMinutes(article: Article): Set<number> {
  const minutes = new Set<number>();
  for (const match of normalizedText(article).matchAll(
    /(?:^|[^\p{L}\p{N}_])kl(?:okken|\.)?\s*([01]?\d|2[0-3])[.:]([0-5]\d)(?![\p{L}\p{N}_])/giu,
  )) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    minutes.add(hour * 60 + minute);
  }
  if (minutes.size === 0) {
    const officialMinute = officialPolitiloggenClockMinute(article);
    if (officialMinute !== undefined) minutes.add(officialMinute);
  }
  return minutes;
}

function hasSharedReportedClockMinute(left: Article, right: Article): boolean {
  const rightMinutes = articleReportedClockMinutes(right);
  return [...articleReportedClockMinutes(left)].some((minute) => rightMinutes.has(minute));
}

const norwegianIncidentCountWords = new Map<string, number>([
  ["en", 1],
  ["ett", 1],
  ["to", 2],
  ["tre", 3],
  ["fire", 4],
  ["fem", 5],
  ["seks", 6],
  ["sju", 7],
  ["syv", 7],
  ["åtte", 8],
  ["ni", 9],
  ["ti", 10],
]);

function incidentCount(value: string): number | undefined {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= 99) return numeric;
  return norwegianIncidentCountWords.get(value);
}

function articleInvolvedPersonCounts(article: Article): Set<number> {
  const text = normalizedText(article);
  const counts = new Set<number>();
  const countToken = "(?:en|ett|to|tre|fire|fem|seks|sju|syv|åtte|ni|ti|[1-9]\\d?)";
  const patterns = [
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])(${countToken})\\s+person(?:er)?\\s+(?:(?:er|var|ble|skal\\s+være)\\s+)?involver\\w*`,
      "gu",
    ),
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])involver\\w*(?:\\s+[\\p{L}]+){0,4}\\s+(${countToken})\\s+person(?:er)?`,
      "gu",
    ),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const count = match[1] ? incidentCount(match[1]) : undefined;
      if (count !== undefined) counts.add(count);
    }
  }
  return counts;
}

function highInformationTrafficCollisionFingerprint(
  article: Article,
): HighInformationTrafficCollisionFingerprint {
  const cached = highInformationTrafficCollisionFingerprintCache.get(article);
  if (cached) return cached;
  const fingerprint = {
    trafficCollision: hasTrafficCollisionLanguage(article),
    roads: articleTrafficRoads(article),
    reportedClockMinutes: articleReportedClockMinutes(article),
    involvedPersonCounts: articleInvolvedPersonCounts(article),
  };
  highInformationTrafficCollisionFingerprintCache.set(article, fingerprint);
  return fingerprint;
}

function descriptorSetsMismatch<T>(left: Set<T>, right: Set<T>): boolean {
  return left.size > 0 && right.size > 0 && !hasSetOverlap(left, right);
}

function highInformationTrafficCollisionRelation(
  left: Article,
  right: Article,
  timeDistanceMs: number,
): HighInformationTrafficCollisionRelation {
  const leftFingerprint = highInformationTrafficCollisionFingerprint(left);
  const rightFingerprint = highInformationTrafficCollisionFingerprint(right);
  if (!leftFingerprint.trafficCollision || !rightFingerprint.trafficCollision) {
    return "not_applicable";
  }

  if (
    (left.situationId && left.situationId === right.situationId) ||
    (left.url.length > 0 && left.url === right.url)
  ) {
    return "insufficient";
  }

  if (
    descriptorSetsMismatch(leftFingerprint.roads, rightFingerprint.roads) ||
    descriptorSetsMismatch(
      leftFingerprint.reportedClockMinutes,
      rightFingerprint.reportedClockMinutes,
    ) ||
    descriptorSetsMismatch(
      leftFingerprint.involvedPersonCounts,
      rightFingerprint.involvedPersonCounts,
    )
  ) {
    return "conflicting";
  }

  const complete = [leftFingerprint, rightFingerprint].every(
    ({ roads, reportedClockMinutes, involvedPersonCounts }) =>
      roads.size > 0 && reportedClockMinutes.size > 0 && involvedPersonCounts.size > 0,
  );
  if (!complete) return "insufficient";

  if (
    left.source === right.source ||
    !trafficCategoriesCompatible(left, right) ||
    !Number.isFinite(timeDistanceMs) ||
    timeDistanceMs > highInformationTrafficCollisionPolicy.windowMs ||
    (left.situationId && right.situationId && left.situationId !== right.situationId)
  ) {
    return "insufficient";
  }
  return "compatible";
}

export function isHighInformationTrafficCollisionMatch(left: Article, right: Article): boolean {
  return (
    highInformationTrafficCollisionRelation(
      left,
      right,
      Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt)),
    ) === "compatible"
  );
}

export function isOfficialTrafficCollisionCompanionMatch(left: Article, right: Article): boolean {
  const leftFingerprint = highInformationTrafficCollisionFingerprint(left);
  const rightFingerprint = highInformationTrafficCollisionFingerprint(right);
  const official = [left, right].find(
    (article) =>
      article.source === "politiloggen" && article.situationId?.startsWith("politiloggen-"),
  );
  if (
    !official ||
    left.source === right.source ||
    !leftFingerprint.trafficCollision ||
    !rightFingerprint.trafficCollision ||
    !trafficCategoriesCompatible(left, right) ||
    Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt)) >
      highInformationTrafficCollisionPolicy.windowMs ||
    descriptorSetsMismatch(leftFingerprint.roads, rightFingerprint.roads) ||
    descriptorSetsMismatch(
      leftFingerprint.reportedClockMinutes,
      rightFingerprint.reportedClockMinutes,
    ) ||
    descriptorSetsMismatch(
      leftFingerprint.involvedPersonCounts,
      rightFingerprint.involvedPersonCounts,
    ) ||
    !hasSetOverlap(leftFingerprint.reportedClockMinutes, rightFingerprint.reportedClockMinutes) ||
    !hasSetOverlap(leftFingerprint.involvedPersonCounts, rightFingerprint.involvedPersonCounts)
  ) {
    return false;
  }
  return hasSharedSpecificPlace(left, right) || hasSpecificPlaceMention(left, right);
}

export function trafficCollisionEvidenceConflicts(left: Article, right: Article): boolean {
  return (
    highInformationTrafficCollisionRelation(
      left,
      right,
      Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt)),
    ) === "conflicting"
  );
}

const propertyCrimeDetailFamilyPatterns: Array<[string, RegExp]> = [
  ["bicycle", /(?:^|[^\p{L}\p{N}_])syk(?:kel|l)\w*/u],
  ["housing-association", /(?:^|[^\p{L}\p{N}_])(?:samei|borettslag)\w*/u],
  ["breakfast-purpose", /(?:^|[^\p{L}\p{N}_])(?:frokost|ingrediens)\w*/u],
  [
    "electronics",
    /(?:^|[^\p{L}\p{N}_])(?:datamaskin|elektronikk|laptop|mobiltelefon|nettbrett|pc)(?![\p{L}\p{N}_])/u,
  ],
  ["jewelry", /(?:^|[^\p{L}\p{N}_])(?:gullsmed|smykk)\w*/u],
  ["cash", /(?:^|[^\p{L}\p{N}_])(?:kontant|penger)\w*/u],
  ["tools", /(?:^|[^\p{L}\p{N}_])verktøy\w*/u],
  ["clothing", /(?:^|[^\p{L}\p{N}_])(?:klær|klesplagg)\w*/u],
  ["medication", /(?:^|[^\p{L}\p{N}_])(?:legemiddel|medisin)\w*/u],
  [
    "alcohol-or-tobacco",
    /(?:^|[^\p{L}\p{N}_])(?:alkohol|sigarett|tobakk|vin|øl)(?![\p{L}\p{N}_])/u,
  ],
];

function propertyCrimeDetailFamilies(article: Article): Set<string> {
  const text = normalizedText(article);
  const families = new Set(
    propertyCrimeDetailFamilyPatterns.flatMap(([family, pattern]) =>
      pattern.test(text) ? [family] : [],
    ),
  );
  for (const match of text.matchAll(
    /(?:^|[^\p{L}\p{N}_])([1-9]\d)\s*[-–]?\s*(?:årene|åring)(?![\p{L}\p{N}_])/gu,
  )) {
    families.add(`age:${match[1]}`);
  }
  return families;
}

function sharedPropertyCrimeDetailFamilies(left: Article, right: Article): Set<string> {
  const rightDetails = propertyCrimeDetailFamilies(right);
  return new Set(
    [...propertyCrimeDetailFamilies(left)].filter((detail) => rightDetails.has(detail)),
  );
}

function hasExplicitSharedPropertyCrimeIdentity(
  left: Article,
  right: Article,
  timeDistanceMs: number,
): boolean {
  if (!Number.isFinite(timeDistanceMs)) return false;
  if (
    left.situationId &&
    left.situationId === right.situationId &&
    timeDistanceMs <= officialSituationWindowMs
  ) {
    return true;
  }
  if (left.url.length > 0 && left.url === right.url && timeDistanceMs <= nearDuplicateWindowMs) {
    return true;
  }
  if (sharedExactEventFingerprints(left, right).length > 0) return true;
  return Boolean(
    left.source !== right.source &&
    timeDistanceMs <= nearDuplicateWindowMs &&
    normalizeText(left.title).length > 0 &&
    normalizeText(left.title) === normalizeText(right.title) &&
    normalizeText(left.excerpt).length > 0 &&
    normalizeText(left.excerpt) === normalizeText(right.excerpt),
  );
}

function propertyCrimeEvidenceRelation(
  left: Article,
  right: Article,
  leftSubtype: ArticleIncidentSubtype,
  rightSubtype: ArticleIncidentSubtype,
  timeDistanceMs: number,
): PropertyCrimeEvidenceRelation {
  if (!propertyCrimeSubtypes.has(leftSubtype) || !propertyCrimeSubtypes.has(rightSubtype)) {
    return "not_applicable";
  }

  if (hasExplicitSharedPropertyCrimeIdentity(left, right, timeDistanceMs)) return "compatible";

  const sameSubtype = leftSubtype === rightSubtype;
  // Same-source updates may still enter one bundle through independently corroborated
  // cross-source edges, but their generic wording is not a direct event identity signal.
  if (sameSubtype && left.source === right.source) return "not_applicable";

  if (
    left.source === right.source ||
    !Number.isFinite(timeDistanceMs) ||
    timeDistanceMs > propertyCrimeEventPolicy.windowMs ||
    hasConflictingSpecificPlaces(left, right)
  ) {
    return "unmatched";
  }

  const sharedPlaceEvidence =
    hasSharedSpecificPlace(left, right) || hasSpecificPlaceMention(left, right);
  const sharedClock = hasSharedReportedClockMinute(left, right);
  const sharedEntity = hasSharedNamedEntity(left, right);
  const sharedDetailCount = sharedPropertyCrimeDetailFamilies(left, right).size;
  if (
    (sharedPlaceEvidence && sharedClock) ||
    ((sharedPlaceEvidence || sharedEntity) && sharedDetailCount >= 1) ||
    (sharedClock && sharedDetailCount >= 1)
  ) {
    return "compatible";
  }

  if (sameSubtype) {
    const leftFingerprint = articleCityIncidentFingerprint(left);
    const rightFingerprint = articleCityIncidentFingerprint(right);
    const body = tokenSimilarity(articleBodyTokens(left), articleBodyTokens(right));
    const distinctive = tokenSimilarity(
      articleDistinctiveIncidentTokens(left),
      articleDistinctiveIncidentTokens(right),
    );
    if (
      eligibleSharedCityIncidentFingerprint(
        left,
        right,
        leftFingerprint && leftFingerprint === rightFingerprint ? leftFingerprint : undefined,
        timeDistanceMs,
        body.overlap,
        distinctive.overlap,
      )
    ) {
      return "compatible";
    }
  }
  return "unmatched";
}

export function isPropertyCrimeCoveragePair(left: Article, right: Article): boolean {
  return (
    propertyCrimeSubtypes.has(articleIncidentSubtype(left)) &&
    propertyCrimeSubtypes.has(articleIncidentSubtype(right))
  );
}

export function isMixedPropertyCrimeCoveragePair(left: Article, right: Article): boolean {
  return hasMixedPropertyCrimeSubtypes(articleIncidentSubtype(left), articleIncidentSubtype(right));
}

export function isPropertyCrimeEventMatch(left: Article, right: Article): boolean {
  return (
    propertyCrimeEvidenceRelation(
      left,
      right,
      articleIncidentSubtype(left),
      articleIncidentSubtype(right),
      Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt)),
    ) === "compatible"
  );
}

export function propertyCrimeEvidenceConflicts(left: Article, right: Article): boolean {
  return (
    propertyCrimeEvidenceRelation(
      left,
      right,
      articleIncidentSubtype(left),
      articleIncidentSubtype(right),
      Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt)),
    ) === "unmatched"
  );
}

function subtypesConflict(left: ArticleIncidentSubtype, right: ArticleIncidentSubtype): boolean {
  if (left === "unknown" || right === "unknown" || left === right) return false;
  if (fireSubtypes.has(left) && fireSubtypes.has(right)) return true;
  const pair = subtypePair(left, right);
  return pair === "public_order\u0000threat_or_violence";
}

function eligibleSharedCityIncidentFingerprint(
  left: Article,
  right: Article,
  candidate: string | undefined,
  timeDistanceMs: number,
  sharedBodyTokenCount: number,
  sharedDistinctiveTokenCount: number,
): string | undefined {
  if (!candidate || left.source === right.source) return undefined;
  const rule = cityIncidentFingerprintRules.get(candidate);
  if (
    !rule ||
    timeDistanceMs > rule.windowMs ||
    sharedBodyTokenCount < rule.minBodyOverlap ||
    sharedDistinctiveTokenCount < rule.minDistinctiveOverlap
  ) {
    return undefined;
  }
  const leftText = normalizedText(left);
  const rightText = normalizedText(right);
  return rule.requiredSharedTokenFamilies.some(
    (pattern) => pattern.test(leftText) && pattern.test(rightText),
  )
    ? candidate
    : undefined;
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
  const leftFingerprint = articleCityIncidentFingerprint(left);
  const rightFingerprint = articleCityIncidentFingerprint(right);
  const leftExactEventFingerprints = articleExactEventFingerprints(left);
  const rightExactEventFingerprints = articleExactEventFingerprints(right);
  const exactEventFingerprints = [leftExactEventFingerprints, rightExactEventFingerprints] as [
    string[],
    string[],
  ];
  const sharedExactFingerprints = sharedExactEventFingerprints(left, right);
  const leftBodyTokens = articleBodyTokens(left);
  const rightBodyTokens = articleBodyTokens(right);
  const body = tokenSimilarity(leftBodyTokens, rightBodyTokens);
  const distinctive = tokenSimilarity(
    articleDistinctiveIncidentTokens(left),
    articleDistinctiveIncidentTokens(right),
  );
  const titleScore = tokenSimilarity(articleTitleTokens(left), articleTitleTokens(right)).score;
  const timeDistanceMs = Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  const propertyCrimeRelation = propertyCrimeEvidenceRelation(
    left,
    right,
    leftSubtype,
    rightSubtype,
    timeDistanceMs,
  );
  const fatalTrafficFollowUp = isFatalTrafficIncidentFollowUpWithinDistance(
    left,
    right,
    timeDistanceMs,
    leftBodyTokens.has("siktet") && rightBodyTokens.has("siktet"),
  );
  const highInformationTrafficCollision = highInformationTrafficCollisionRelation(
    left,
    right,
    timeDistanceMs,
  );
  const officialTrafficCollisionCompanion = isOfficialTrafficCollisionCompanionMatch(left, right);
  const sharedCityIncidentFingerprintCandidate =
    leftFingerprint && leftFingerprint === rightFingerprint ? leftFingerprint : undefined;
  const sharedCityIncidentFingerprint = eligibleSharedCityIncidentFingerprint(
    left,
    right,
    sharedCityIncidentFingerprintCandidate,
    timeDistanceMs,
    body.overlap,
    distinctive.overlap,
  );
  const conflicts: ArticleCoverageConflictSignal[] = [];
  if (
    hasConflictingSpecificPlaces(left, right) &&
    !fatalTrafficFollowUp &&
    highInformationTrafficCollision !== "compatible"
  ) {
    conflicts.push({ kind: "specific_place", articleIds, detail: "Ulike spesifikke steder" });
  }
  if (
    subtypesConflict(leftSubtype, rightSubtype) ||
    propertyCrimeRelation === "unmatched" ||
    (highInformationTrafficCollision === "conflicting" && !fatalTrafficFollowUp)
  ) {
    conflicts.push({
      kind: "incident_subtype",
      articleIds,
      detail:
        highInformationTrafficCollision === "conflicting"
          ? "traffic_collision_fingerprint"
          : [leftSubtype, rightSubtype].sort().join("/"),
    });
  }
  if (left.situationId && right.situationId && left.situationId !== right.situationId) {
    conflicts.push({
      kind: "situation_id",
      articleIds,
      detail: [left.situationId, right.situationId].sort().join("/"),
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
  if (fatalTrafficFollowUp) {
    positiveIncidentEvidence.push("shared_fatal_traffic_fingerprint");
  }
  if (highInformationTrafficCollision === "compatible") {
    positiveIncidentEvidence.push("shared_high_information_traffic_collision");
  }
  if (officialTrafficCollisionCompanion) {
    positiveIncidentEvidence.push("shared_official_traffic_collision_companion");
  }
  if (propertyCrimeRelation === "compatible") {
    positiveIncidentEvidence.push("shared_property_crime_event");
  }
  if (sharedCityIncidentFingerprint) {
    positiveIncidentEvidence.push("shared_city_incident_fingerprint");
  }
  if (sharedExactFingerprints.length > 0) {
    positiveIncidentEvidence.push("shared_exact_event_fingerprint");
  }
  if (
    (subtypesCompatible(leftSubtype, rightSubtype) && propertyCrimeRelation !== "unmatched") ||
    propertyCrimeRelation === "compatible"
  ) {
    positiveIncidentEvidence.push("compatible_incident_subtype");
  }

  return {
    articleIds,
    positiveIncidentEvidence,
    incidentSubtypes: [leftSubtype, rightSubtype],
    cityIncidentFingerprints: [leftFingerprint, rightFingerprint],
    ...(sharedCityIncidentFingerprint ? { sharedCityIncidentFingerprint } : {}),
    exactEventFingerprints,
    sharedExactEventFingerprints: sharedExactFingerprints,
    sharedBodyTokenCount: body.overlap,
    bodyScore: body.score,
    sharedDistinctiveTokenCount: distinctive.overlap,
    titleScore,
    timeDistanceMs,
    conflicts,
    evidenceFingerprint: fingerprint({
      matcherVersion,
      positiveIncidentEvidence: [...positiveIncidentEvidence].sort(),
      incidentSubtypes: [leftSubtype, rightSubtype].sort(),
      cityIncidentFingerprints: [leftFingerprint, rightFingerprint].sort(),
      exactEventFingerprints: exactEventFingerprints.map((items) => [...items].sort()).sort(),
      sharedExactEventFingerprints: sharedExactFingerprints,
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

function hasNotificationFailureLanguage(article: Article): boolean {
  return /\b(?:varslet?\s+ikke|ikke\s+varslet?|sa\s+ikke\b.{0,80}\bifra|unnlot\s+å\s+(?:varsle|melde)|meldte\s+ikke\s+fra|ikke\s+meldt\s+fra)\b/u.test(
    normalizedText(article),
  );
}

function hasAuthorityResponseLanguage(article: Article): boolean {
  return /\b(?:alvorlig\w*|kritikk\w*|myndighet\w*|reager\w*|refs\w*|statsforvalter\w*|tilsyn\w*)\b/u.test(
    normalizedText(article),
  );
}

export function isEntityBackedNotificationFailureFollowUp(left: Article, right: Article): boolean {
  const timeDistanceMs = Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  return Boolean(
    left.source !== right.source &&
    sameBroadCategory(left, right) &&
    Number.isFinite(timeDistanceMs) &&
    timeDistanceMs <= entityBackedNotificationFollowUpPolicy.windowMs &&
    !(left.situationId && right.situationId && left.situationId !== right.situationId) &&
    !hasConflictingSpecificPlaces(left, right) &&
    !subtypesConflict(articleIncidentSubtype(left), articleIncidentSubtype(right)) &&
    hasSharedNamedEntity(left, right) &&
    hasNotificationFailureLanguage(left) &&
    hasNotificationFailureLanguage(right) &&
    hasAuthorityResponseLanguage(left) &&
    hasAuthorityResponseLanguage(right),
  );
}

function trafficCategoriesCompatible(left: Article, right: Article): boolean {
  if (left.category === right.category) return true;
  return (
    trafficCompatibleCategories.has(left.category) &&
    trafficCompatibleCategories.has(right.category)
  );
}

function normalizedMatches(
  text: string,
  pattern: RegExp,
  normalize: (value: string) => string = (value) => value,
): Set<string> {
  return new Set(
    [...text.matchAll(pattern)].flatMap((match) =>
      match[1] === undefined ? [] : [normalize(match[1])],
    ),
  );
}

function hasSetOverlap<T>(left: Set<T>, right: Set<T>): boolean {
  return [...left].some((value) => right.has(value));
}

function fatalTrafficArticleFingerprint(article: Article): FatalTrafficArticleFingerprint {
  const cached = fatalTrafficFingerprintCache.get(article);
  if (cached) return cached;
  const text = normalizedText(article);
  const fingerprint = {
    fatality: /(?:dødsulykk\w*|døde|omkom\w*|mistet\s+livet)/u.test(text),
    trafficIncident: /(?:ulykk\w*|kollisj\w*|påkjør\w*|trafikkuhell\w*)/u.test(text),
    charged: /\bsiktet\w*\b/u.test(text),
    roads: normalizedMatches(text, /(?:^|\s)((?:e|rv|fv)\s*\d{1,4})(?=\s|$)/gu, (value) =>
      value.replace(/\s+/g, ""),
    ),
    ageDecades: normalizedMatches(text, /(?:^|\s)(\d{2})\s*[-–]?\s*(?:årene|åra)(?=\s|$)/gu),
  };
  fatalTrafficFingerprintCache.set(article, fingerprint);
  return fingerprint;
}

function isFatalTrafficIncidentFollowUpWithinDistance(
  left: Article,
  right: Article,
  timeDistanceMs: number,
  hasSharedChargedToken?: boolean,
): boolean {
  if (left.source === right.source || !trafficCategoriesCompatible(left, right)) return false;
  if (left.situationId && right.situationId && left.situationId !== right.situationId) return false;
  if (hasSharedChargedToken === false) return false;
  if (!Number.isFinite(timeDistanceMs) || timeDistanceMs > fatalTrafficFollowUpPolicy.windowMs) {
    return false;
  }

  const leftFingerprint = fatalTrafficArticleFingerprint(left);
  if (
    !leftFingerprint.fatality ||
    !leftFingerprint.trafficIncident ||
    !leftFingerprint.charged ||
    leftFingerprint.roads.size === 0 ||
    leftFingerprint.ageDecades.size === 0
  ) {
    return false;
  }
  const rightFingerprint = fatalTrafficArticleFingerprint(right);
  if (
    !rightFingerprint.fatality ||
    !rightFingerprint.trafficIncident ||
    !rightFingerprint.charged ||
    rightFingerprint.roads.size === 0 ||
    rightFingerprint.ageDecades.size === 0
  ) {
    return false;
  }

  return (
    hasSetOverlap(leftFingerprint.roads, rightFingerprint.roads) &&
    hasSetOverlap(leftFingerprint.ageDecades, rightFingerprint.ageDecades)
  );
}

export function isFatalTrafficIncidentFollowUp(left: Article, right: Article): boolean {
  return isFatalTrafficIncidentFollowUpWithinDistance(
    left,
    right,
    Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt)),
  );
}

function isHighDetailCrossSourceNearDuplicateFromEvidence(
  left: Article,
  right: Article,
  evidence: ArticleCoveragePairEvidence,
): boolean {
  if (left.source === right.source || !sameBroadCategory(left, right)) return false;
  if (
    !Number.isFinite(evidence.timeDistanceMs) ||
    evidence.timeDistanceMs > highDetailNearDuplicatePolicy.windowMs ||
    evidence.conflicts.length > 0
  ) {
    return false;
  }
  return (
    evidence.sharedBodyTokenCount >= highDetailNearDuplicatePolicy.minBodyOverlap &&
    evidence.bodyScore >= highDetailNearDuplicatePolicy.minBodyScore &&
    evidence.sharedDistinctiveTokenCount >= highDetailNearDuplicatePolicy.minDistinctiveOverlap
  );
}

function isDetailedExactCrossSourceCopyFromEvidence(
  left: Article,
  right: Article,
  evidence: ArticleCoveragePairEvidence,
): boolean {
  const leftExcerpt = normalizeText(left.excerpt);
  return Boolean(
    left.source !== right.source &&
    evidence.conflicts.length === 0 &&
    evidence.timeDistanceMs <= nearDuplicateWindowMs &&
    normalizeText(left.title).length > 0 &&
    normalizeText(left.title) === normalizeText(right.title) &&
    leftExcerpt.length > 0 &&
    leftExcerpt === normalizeText(right.excerpt) &&
    evidence.bodyScore === 1 &&
    evidence.sharedDistinctiveTokenCount >= 5,
  );
}

export function isHighDetailCrossSourceNearDuplicate(left: Article, right: Article): boolean {
  return isHighDetailCrossSourceNearDuplicateFromEvidence(
    left,
    right,
    articleCoverageEvidence(left, right, "v2"),
  );
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
  highDetailNearDuplicate: boolean,
  detailedExactCrossSourceCopy: boolean,
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
  if (evidence.positiveIncidentEvidence.includes("shared_fatal_traffic_fingerprint")) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: evidence.articleIds,
      detail: "fatal_traffic_follow_up",
    });
  }
  if (evidence.positiveIncidentEvidence.includes("shared_high_information_traffic_collision")) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: evidence.articleIds,
      detail: "traffic_collision:road_clock_participants",
    });
  }
  if (evidence.positiveIncidentEvidence.includes("shared_official_traffic_collision_companion")) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: evidence.articleIds,
      detail: "traffic_collision:official_clock_participants",
    });
  }
  if (evidence.sharedExactEventFingerprints.length > 0) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: evidence.articleIds,
      detail: evidence.sharedExactEventFingerprints.join(", "),
    });
  }
  if (evidence.positiveIncidentEvidence.includes("shared_property_crime_event")) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: evidence.articleIds,
      detail: "property:crime",
    });
  }
  const body = { overlap: evidence.sharedBodyTokenCount, score: evidence.bodyScore };
  const sameUrl = samePublisherStoryUrl(left, right);
  if (sameUrl) {
    signals.push({ kind: "near_duplicate", articleIds: evidence.articleIds, score: 1 });
  }
  if (evidence.titleScore >= 0.65) {
    signals.push({
      kind: "title_similarity",
      articleIds: evidence.articleIds,
      score: evidence.titleScore,
    });
  }
  if (
    !sameUrl &&
    left.source !== right.source &&
    (highDetailNearDuplicate ||
      detailedExactCrossSourceCopy ||
      (normalizeText(left.excerpt).length > 0 &&
        normalizeText(left.excerpt) === normalizeText(right.excerpt)) ||
      (body.overlap >= 6 && body.score >= 0.6))
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
  if (isEntityBackedNotificationFailureFollowUp(left, right)) {
    signals.push({
      kind: "topical_thread",
      articleIds: evidence.articleIds,
      detail: "entity_notification_failure_follow_up",
    });
  }
  if (
    left.source !== right.source &&
    sameBroadCategory(left, right) &&
    evidence.positiveIncidentEvidence.includes("shared_specific_place") &&
    evidence.timeDistanceMs <= specificPlaceWindowMs &&
    body.overlap >= 4
  ) {
    signals.push({
      kind: "cross_source_incident",
      articleIds: evidence.articleIds,
      overlap: body.overlap,
      score: body.score,
    });
  } else if (evidence.sharedCityIncidentFingerprint) {
    signals.push({
      kind: "generic_place_incident",
      articleIds: evidence.articleIds,
      detail: evidence.sharedCityIncidentFingerprint,
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

function coverageKindForPair(
  signals: ArticleCoverageDecisionSignal[],
  evidence: ArticleCoveragePairEvidence,
): ArticleCoverageEdgeKind {
  const hasIncident =
    evidence.incidentSubtypes.some((subtype) => subtype !== "unknown") ||
    signals.some((signal) =>
      ["situation_id", "generic_place_incident", "cross_source_incident"].includes(signal.kind),
    );
  const hasTopic = signals.some((signal) => signal.kind === "topical_thread");
  if (hasTopic && !hasIncident) return "topic";
  if (hasTopic && signals.every((signal) => signal.kind === "topical_thread")) return "topic";
  if (hasIncident) return "incident";
  return hasTopic ? "topic" : "update";
}

function hasSignal(
  signals: ArticleCoverageDecisionSignal[],
  kind: ArticleCoverageDecisionSignalKind,
) {
  return signals.some((signal) => signal.kind === kind);
}

function cityFingerprintEligible(
  left: Article,
  right: Article,
  evidence: ArticleCoveragePairEvidence,
): boolean {
  return Boolean(
    evidence.sharedCityIncidentFingerprint &&
    evidence.positiveIncidentEvidence.includes("shared_city_incident_fingerprint") &&
    left.source !== right.source,
  );
}

function automaticEvidenceEligible(
  left: Article,
  right: Article,
  evidence: ArticleCoveragePairEvidence,
  signals: ArticleCoverageDecisionSignal[],
  kind: ArticleCoverageEdgeKind,
  highDetailNearDuplicate: boolean,
  detailedExactCrossSourceCopy: boolean,
): boolean {
  if (evidence.positiveIncidentEvidence.includes("shared_property_crime_event")) {
    return true;
  }
  if (isPropertyCrimeCoveragePair(left, right) && !isPropertyCrimeEventMatch(left, right)) {
    return false;
  }
  if (evidence.positiveIncidentEvidence.includes("shared_exact_event_fingerprint")) {
    return true;
  }
  if (evidence.positiveIncidentEvidence.includes("shared_high_information_traffic_collision")) {
    return true;
  }
  if (evidence.positiveIncidentEvidence.includes("shared_official_traffic_collision_companion")) {
    return true;
  }
  if (evidence.positiveIncidentEvidence.includes("shared_fatal_traffic_fingerprint")) {
    return true;
  }
  if (
    evidence.positiveIncidentEvidence.includes("same_situation_id") &&
    evidence.timeDistanceMs <= officialSituationWindowMs
  ) {
    return true;
  }
  if (
    evidence.positiveIncidentEvidence.some(
      (item) => item === "shared_specific_place" || item === "mentioned_specific_place",
    ) &&
    evidence.timeDistanceMs <= specificPlaceWindowMs
  ) {
    return true;
  }
  if (
    evidence.positiveIncidentEvidence.includes("shared_named_entity") &&
    evidence.timeDistanceMs <= namedEntityWindowMs &&
    (kind !== "incident" ||
      subtypesCompatible(evidence.incidentSubtypes[0], evidence.incidentSubtypes[1]))
  ) {
    return true;
  }
  if (cityFingerprintEligible(left, right, evidence)) return true;
  if (kind === "topic") {
    const entityBackedNotificationFollowUp = signals.some(
      (signal) =>
        signal.kind === "topical_thread" &&
        signal.detail === "entity_notification_failure_follow_up",
    );
    return (
      hasSignal(signals, "topical_thread") &&
      evidence.timeDistanceMs <=
        (entityBackedNotificationFollowUp
          ? entityBackedNotificationFollowUpPolicy.windowMs
          : topicalThreadWindowMs)
    );
  }
  if (kind === "incident") {
    return (
      hasSignal(signals, "near_duplicate") &&
      (highDetailNearDuplicate || detailedExactCrossSourceCopy)
    );
  }
  if (samePublisherStoryUrl(left, right) && evidence.timeDistanceMs <= nearDuplicateWindowMs) {
    return true;
  }
  return (
    (hasSignal(signals, "near_duplicate") || hasSignal(signals, "title_similarity")) &&
    evidence.timeDistanceMs <= nearDuplicateWindowMs
  );
}

export function articleCoverageEdge(
  left: Article,
  right: Article,
): ArticleCoverageEdge | undefined {
  const evidence = articleCoverageEvidence(left, right, "v2");
  const highDetailNearDuplicate = isHighDetailCrossSourceNearDuplicateFromEvidence(
    left,
    right,
    evidence,
  );
  const detailedExactCrossSourceCopy = isDetailedExactCrossSourceCopyFromEvidence(
    left,
    right,
    evidence,
  );
  const signals = articlePairSignalsForV2(
    left,
    right,
    evidence,
    highDetailNearDuplicate,
    detailedExactCrossSourceCopy,
  );
  const kind = coverageKindForPair(signals, evidence);
  const automaticEvidence = automaticEvidenceEligible(
    left,
    right,
    evidence,
    signals,
    kind,
    highDetailNearDuplicate,
    detailedExactCrossSourceCopy,
  );
  const positiveCount = evidence.positiveIncidentEvidence.length;
  const hasBlockingConflict = evidence.conflicts.length > 0;
  const textScore = Math.min(
    0.25,
    evidence.titleScore * 0.15 + evidence.sharedDistinctiveTokenCount * 0.025,
  );
  const situationScore = evidence.positiveIncidentEvidence.includes("same_situation_id") ? 0.85 : 0;
  const placeScore = evidence.positiveIncidentEvidence.some(
    (item) => item === "shared_specific_place" || item === "mentioned_specific_place",
  )
    ? 0.3
    : 0;
  const entityScore = evidence.positiveIncidentEvidence.includes("shared_named_entity") ? 0.2 : 0;
  const subtypeScore = evidence.positiveIncidentEvidence.includes("compatible_incident_subtype")
    ? 0.25
    : 0;
  const propertyCrimeScore = evidence.positiveIncidentEvidence.includes(
    "shared_property_crime_event",
  )
    ? 0.4
    : 0;
  const cityFingerprintScore = cityFingerprintEligible(left, right, evidence) ? 0.35 : 0;
  const fatalTrafficScore = evidence.positiveIncidentEvidence.includes(
    "shared_fatal_traffic_fingerprint",
  )
    ? 0.65
    : 0;
  const highInformationTrafficCollisionScore = evidence.positiveIncidentEvidence.includes(
    "shared_high_information_traffic_collision",
  )
    ? 0.65
    : 0;
  const officialTrafficCollisionCompanionScore = evidence.positiveIncidentEvidence.includes(
    "shared_official_traffic_collision_companion",
  )
    ? 0.65
    : 0;
  const exactEventScore = evidence.positiveIncidentEvidence.includes(
    "shared_exact_event_fingerprint",
  )
    ? 0.85
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
      propertyCrimeScore +
      cityFingerprintScore +
      fatalTrafficScore +
      highInformationTrafficCollisionScore +
      officialTrafficCollisionCompanionScore +
      exactEventScore +
      topicScore +
      duplicateScore +
      crossSourceScore +
      textScore,
  );

  if (signals.length === 0 && score < 0.35 && !hasBlockingConflict) return undefined;
  let tier: ArticleCoverageMatchTier = "weak";
  if (
    !hasBlockingConflict &&
    automaticEvidence &&
    score >= 0.85 &&
    (situationScore > 0 ||
      topicScore > 0 ||
      duplicateScore > 0 ||
      fatalTrafficScore > 0 ||
      highInformationTrafficCollisionScore > 0 ||
      officialTrafficCollisionCompanionScore > 0 ||
      exactEventScore > 0)
  ) {
    tier = "strong";
  } else if (
    !hasBlockingConflict &&
    automaticEvidence &&
    score >= 0.6 &&
    (kind !== "incident" ||
      positiveCount > 0 ||
      highDetailNearDuplicate ||
      detailedExactCrossSourceCopy)
  ) {
    tier = "moderate";
  }

  return {
    articleIds: evidence.articleIds,
    tier,
    score,
    kind,
    positiveIncidentEvidence: evidence.positiveIncidentEvidence,
    signals,
    conflicts: evidence.conflicts,
    evidenceFingerprint: evidence.evidenceFingerprint,
    reviewable: tier === "weak" || hasBlockingConflict,
    correctionConflict: false,
  };
}
