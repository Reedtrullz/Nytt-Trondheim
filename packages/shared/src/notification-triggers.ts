import type {
  Article,
  NotificationTriggerCandidate,
  NotificationTriggerKind,
  NotificationTriggerPage,
  NotificationTriggerQuery,
  NotificationTriggerSeverity,
  Situation,
  SourceConfidenceLevel,
  SourceConfidenceSummary,
  SourceId,
} from "./types.js";

interface NotificationTriggerRule {
  kind: NotificationTriggerKind;
  severity: NotificationTriggerSeverity;
  keywords: string[];
}

export interface BuildNotificationTriggersInput {
  situations: Situation[];
  articles: Article[];
  generatedAt: string;
  filters?: NotificationTriggerQuery;
}

const highImpactRules: NotificationTriggerRule[] = [
  {
    kind: "public_safety",
    severity: "critical",
    keywords: [
      "kritisk skadet",
      "livstruende",
      "livlos",
      "livløs",
      "drukn",
      "dode",
      "døde",
      "dod",
      "død",
      "savnet",
      "evakuer",
      "redningsaksjon",
      "kniv",
      "skyting",
      "grov vold",
      "voldshendelse",
    ],
  },
  {
    kind: "public_safety",
    severity: "warning",
    keywords: ["brann", "royk", "røyk", "ulykke", "nodedat", "nødetat", "politi"],
  },
  {
    kind: "traffic_disruption",
    severity: "critical",
    keywords: ["vegen er stengt", "veien er stengt", "veg stengt", "vei stengt", "stengt"],
  },
  {
    kind: "traffic_disruption",
    severity: "warning",
    keywords: [
      "omkjoring",
      "omkjøring",
      "trafikkulykke",
      "kollisjon",
      "ras",
      "steinsprang",
      "jordskred",
      "ko",
      "kø",
    ],
  },
  {
    kind: "weather_hazard",
    severity: "warning",
    keywords: ["farevarsel", "flom", "skred", "storm", "ekstremvar", "ekstremvær", "uvar", "uvær"],
  },
  {
    kind: "service_disruption",
    severity: "warning",
    keywords: ["strombrudd", "strømbrudd", "vannavstenging", "bortfall", "tele", "beredskap"],
  },
];

const severityRank: Record<NotificationTriggerSeverity, number> = {
  watch: 0,
  warning: 1,
  critical: 2,
};

const confidenceLevelScore: Record<SourceConfidenceLevel, number> = {
  speculative: 0.2,
  uncertain: 0.42,
  likely: 0.68,
  confirmed: 0.88,
};

const reportingSources = new Set<SourceId>([
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
  "politiloggen",
  "trondheim_kommune",
]);

const officialSources = new Set<SourceId>([
  "datex",
  "politiloggen",
  "trondheim_kommune",
  "met",
  "nve",
  "bane_nor",
  "vegvesen_traffic_info",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("nb");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function strongestSeverity(severities: NotificationTriggerSeverity[]): NotificationTriggerSeverity {
  return severities.sort((left, right) => severityRank[right] - severityRank[left])[0] ?? "watch";
}

function confidenceFromScore(
  score: number,
  sourceCount: number,
  generatedAt: string,
): SourceConfidenceSummary {
  const level: SourceConfidenceLevel =
    score >= 0.82
      ? "confirmed"
      : score >= 0.68
        ? "likely"
        : score >= 0.5
          ? "uncertain"
          : "speculative";
  return {
    level,
    score,
    sourceCount,
    updatedAt: generatedAt,
    rationale:
      level === "confirmed"
        ? "Høy effekt og sterkt kildegrunnlag."
        : level === "likely"
          ? "Tydelige høyeffektsignaler med relevant kildegrunnlag."
          : "Bør vurderes manuelt før varsel sendes.",
  };
}

function keywordsForText(text: string) {
  const normalized = normalizeText(text);
  const matches: Array<{
    kind: NotificationTriggerKind;
    severity: NotificationTriggerSeverity;
    keyword: string;
  }> = [];
  for (const rule of highImpactRules) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(normalizeText(keyword))) {
        matches.push({ kind: rule.kind, severity: rule.severity, keyword });
      }
    }
  }
  return matches;
}

function situationText(situation: Situation): string {
  return [
    situation.title,
    situation.summary,
    situation.locationLabel,
    situation.type,
    ...situation.evidence.flatMap((item) => [item.claim, item.supportingSnippet, item.claimType]),
    ...situation.timeline.flatMap((entry) => [entry.title, entry.detail]),
  ].join(" ");
}

function sourceIdsForSituation(situation: Situation): SourceId[] {
  return unique([
    ...(situation.officialSource ? [situation.officialSource] : []),
    ...(situation.activationBasis?.sourceIds ?? []),
    ...situation.evidence.map((item) => item.source),
    ...situation.timeline.flatMap((entry) => (entry.source ? [entry.source] : [])),
  ]);
}

function sourceLabelsForSituation(situation: Situation): string[] {
  return unique([
    ...situation.evidence.map((item) => item.sourceLabel),
    ...situation.timeline.map((entry) => entry.sourceLabel),
  ]).filter(Boolean);
}

function articlesBySituation(articles: Article[]): Map<string, Article[]> {
  const map = new Map<string, Article[]>();
  for (const article of articles) {
    if (!article.situationId) continue;
    const next = map.get(article.situationId) ?? [];
    next.push(article);
    map.set(article.situationId, next);
  }
  return map;
}

function candidateKind(
  matches: ReturnType<typeof keywordsForText>,
  situationType?: Situation["type"],
) {
  if (situationType === "traffic" || matches.some((match) => match.kind === "traffic_disruption")) {
    return "traffic_disruption" as const;
  }
  if (situationType === "weather" || situationType === "flood" || situationType === "landslide") {
    return "weather_hazard" as const;
  }
  if (situationType === "service_disruption") return "service_disruption" as const;
  return matches[0]?.kind ?? "public_safety";
}

function recencyBoost(updatedAt: string, generatedAt: string): number {
  const updatedMs = Date.parse(updatedAt);
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(updatedMs) || !Number.isFinite(generatedMs)) return 0;
  const ageHours = Math.max(0, (generatedMs - updatedMs) / 3_600_000);
  if (ageHours <= 2) return 0.12;
  if (ageHours <= 8) return 0.08;
  if (ageHours <= 24) return 0.04;
  return 0;
}

function situationCandidate(
  situation: Situation,
  relatedArticles: Article[],
  generatedAt: string,
): NotificationTriggerCandidate | undefined {
  if (situation.status === "dismissed" || situation.status === "resolved") return undefined;
  const matches = keywordsForText(situationText(situation));
  if (matches.length === 0 && situation.importance !== "high") return undefined;

  const sourceIds = sourceIdsForSituation(situation);
  const score = clampScore(
    0.12 +
      (situation.importance === "high" ? 0.18 : 0) +
      (situation.status === "active" ? 0.12 : 0.06) +
      (situation.officialSource ? 0.22 : 0) +
      (situation.verificationStatus === "Offentlig bekreftet" ? 0.12 : 0) +
      (situation.sourceConfidence?.score ??
        confidenceLevelScore[situation.sourceConfidence?.level ?? "uncertain"]) *
        0.2 +
      Math.min(0.16, Math.max(0, sourceIds.length - 1) * 0.08) +
      Math.min(0.2, matches.length * 0.06) +
      recencyBoost(situation.updatedAt, generatedAt),
  );
  if (score < 0.58) return undefined;

  const severityFromScore: NotificationTriggerSeverity =
    score >= 0.82 ? "critical" : score >= 0.68 ? "warning" : "watch";
  const severity = strongestSeverity([
    ...matches.map((match) => match.severity),
    severityFromScore,
  ]);
  const matchedKeywords = unique(matches.map((match) => match.keyword));
  const reasons = [
    situation.importance === "high"
      ? "Situasjonen er markert med høy operativ prioritet."
      : undefined,
    situation.status === "active" ? "Situasjonen er aktiv." : "Situasjonen er til vurdering.",
    situation.officialSource ? "Har offentlig kildegrunnlag." : undefined,
    sourceIds.length >= 2 ? `${sourceIds.length} kilder inngår i grunnlaget.` : undefined,
    matchedKeywords.length
      ? `Høyeffektspråk: ${matchedKeywords.slice(0, 4).join(", ")}.`
      : undefined,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    id: `notification:situation:${situation.id}`,
    kind: candidateKind(matches, situation.type),
    severity,
    deliveryState: "candidate_only",
    title: situation.title,
    body: `${situation.locationLabel}: ${situation.summary}`,
    detail: "Kandidat for systemvarsel. Ingen push er sendt i denne versjonen.",
    score,
    confidence: confidenceFromScore(score, sourceIds.length, generatedAt),
    generatedAt,
    eventUpdatedAt: situation.updatedAt,
    situationId: situation.id,
    articleIds: unique([
      ...situation.relatedArticleIds,
      ...relatedArticles.map((article) => article.id),
    ]),
    sourceIds,
    sourceLabels: sourceLabelsForSituation(situation),
    matchedKeywords,
    reasons,
    links: [
      {
        kind: "situation",
        label: "Åpne situasjon",
        href: `/situasjoner/${encodeURIComponent(situation.id)}`,
        situationId: situation.id,
      },
    ],
  };
}

function articleCandidate(
  article: Article,
  generatedAt: string,
): NotificationTriggerCandidate | undefined {
  if (article.category === "Sport" || article.category === "Kultur") return undefined;
  const matches = keywordsForText(
    `${article.title} ${article.excerpt} ${article.places.join(" ")}`,
  );
  if (matches.length === 0) return undefined;

  const official = officialSources.has(article.source);
  const reporting = reportingSources.has(article.source);
  const coverageBoost =
    article.coverageBundle?.confidence === "high"
      ? 0.18
      : article.coverageBundle?.confidence === "medium"
        ? 0.1
        : 0;
  const score = clampScore(
    0.14 +
      (official ? 0.24 : 0) +
      (reporting ? 0.1 : 0) +
      (["Hendelser", "Krim", "Transport", "Vær"].includes(article.category) ? 0.12 : 0) +
      coverageBoost +
      Math.min(0.2, matches.length * 0.07) +
      recencyBoost(article.publishedAt, generatedAt),
  );
  if (score < 0.64) return undefined;

  const severity = strongestSeverity([
    ...matches.map((match) => match.severity),
    score >= 0.82 ? "critical" : "warning",
  ]);
  const matchedKeywords = unique(matches.map((match) => match.keyword));
  return {
    id: `notification:article:${article.id}`,
    kind: candidateKind(matches),
    severity,
    deliveryState: "candidate_only",
    title: article.title,
    body: article.excerpt,
    detail: "Artikkelbasert kandidat før egen situasjon er bekreftet. Ingen push er sendt.",
    score,
    confidence: confidenceFromScore(score, official ? 1 : 0, generatedAt),
    generatedAt,
    eventUpdatedAt: article.publishedAt,
    articleIds: [article.id],
    sourceIds: [article.source],
    sourceLabels: [article.sourceLabel],
    matchedKeywords,
    reasons: [
      official
        ? "Artikkelen kommer fra offentlig kilde."
        : "Artikkelen kommer fra redaksjonell kilde.",
      article.coverageBundle
        ? `Inngår i dekningsgruppe med ${article.coverageBundle.confidence} tillit.`
        : undefined,
      `Høyeffektspråk: ${matchedKeywords.slice(0, 4).join(", ")}.`,
    ].filter((reason): reason is string => Boolean(reason)),
    links: [{ kind: "external", label: article.sourceLabel, href: article.url }],
  };
}

function candidateMatchesQuery(
  candidate: NotificationTriggerCandidate,
  filters: NotificationTriggerQuery,
) {
  if (filters.kinds?.length && !filters.kinds.includes(candidate.kind)) return false;
  if (filters.severities?.length && !filters.severities.includes(candidate.severity)) return false;
  if (filters.q) {
    const query = normalizeText(filters.q);
    const haystack = normalizeText(
      [
        candidate.title,
        candidate.body,
        candidate.detail,
        candidate.sourceLabels.join(" "),
        candidate.matchedKeywords.join(" "),
      ].join(" "),
    );
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function summaryForCandidates(
  items: NotificationTriggerCandidate[],
): NotificationTriggerPage["summary"] {
  return {
    total: items.length,
    critical: items.filter((item) => item.severity === "critical").length,
    warning: items.filter((item) => item.severity === "warning").length,
    watch: items.filter((item) => item.severity === "watch").length,
    officialBacked: items.filter((item) =>
      item.sourceIds.some((source) => officialSources.has(source)),
    ).length,
    highConfidence: items.filter((item) => item.confidence.level === "confirmed").length,
  };
}

export function buildNotificationTriggerPage(
  input: BuildNotificationTriggersInput,
): NotificationTriggerPage {
  const filters = input.filters ?? {};
  const articlesForSituation = articlesBySituation(input.articles);
  const coveredArticleIds = new Set<string>();
  const candidates: NotificationTriggerCandidate[] = [];

  for (const situation of input.situations) {
    const relatedArticles = articlesForSituation.get(situation.id) ?? [];
    const candidate = situationCandidate(situation, relatedArticles, input.generatedAt);
    if (!candidate) continue;
    for (const articleId of candidate.articleIds) coveredArticleIds.add(articleId);
    candidates.push(candidate);
  }

  for (const article of input.articles) {
    if (article.situationId || coveredArticleIds.has(article.id)) continue;
    const candidate = articleCandidate(article, input.generatedAt);
    if (candidate) candidates.push(candidate);
  }

  const visible = candidates
    .filter((candidate) => candidateMatchesQuery(candidate, filters))
    .sort(
      (left, right) =>
        severityRank[right.severity] - severityRank[left.severity] ||
        right.score - left.score ||
        right.eventUpdatedAt.localeCompare(left.eventUpdatedAt),
    );
  const limit = filters.limit ?? 30;

  return {
    generatedAt: input.generatedAt,
    filters,
    items: visible.slice(0, limit),
    summary: summaryForCandidates(visible),
  };
}
