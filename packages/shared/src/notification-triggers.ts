import type {
  Article,
  HomeSituationSummary,
  NotificationTriggerCandidate,
  NotificationTriggerDeliveryState,
  NotificationTriggerKind,
  NotificationTriggerPage,
  NotificationTriggerQuery,
  NotificationTriggerSeverity,
  NotificationTriggerTraceState,
  OperationsTimelineEventLink,
  PublicNotificationSignalHighlight,
  PushDeliveryListItem,
  PushSubscriptionSummary,
  Situation,
  SourceConfidenceLevel,
  SourceConfidenceSummary,
  SourceHealth,
  SourceId,
} from "./types.js";
import { sourceConfidenceLabels } from "./types.js";
import { sourceMixConfidenceSummary } from "./source-confidence.js";
import { sourceIdLabel } from "./source-labels.js";

interface NotificationTriggerRule {
  kind: NotificationTriggerKind;
  severity: NotificationTriggerSeverity;
  keywords: string[];
}

export interface PublicNotificationTriggerGuidance {
  kind: NotificationTriggerKind;
  severity: NotificationTriggerSeverity;
  title: string;
  detail: string;
  examples: string[];
}

export interface BuildNotificationTriggersInput {
  situations: Situation[];
  articles: Article[];
  generatedAt: string;
  filters?: NotificationTriggerQuery;
}

export interface BuildPublicNotificationSignalHighlightsInput {
  situations: HomeSituationSummary[];
  articles: Article[];
  generatedAt: string;
  limit?: number;
}

export interface NotificationDeliveryStateContext {
  configured: boolean;
  deliveries?: Array<Pick<PushDeliveryListItem, "triggerId" | "status">>;
  subscriptions?: NotificationSubscriptionPreference[];
  sourceHealth?: SourceHealth[];
}

export type NotificationSubscriptionPreference = Pick<
  PushSubscriptionSummary,
  "enabled" | "kinds" | "minSeverity"
>;

export function notificationTriggerTraceState(
  candidate: Pick<NotificationTriggerCandidate, "links">,
): NotificationTriggerTraceState {
  if (candidate.links.some((link) => link.kind === "source_item")) return "raw_evidence";
  if (candidate.links.some((link) => link.kind === "source_audit")) return "source_audit";
  if (candidate.links.some((link) => link.kind === "external")) return "external_only";
  return "missing";
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

export const publicNotificationTriggerGuidance = [
  {
    kind: "public_safety",
    severity: "critical",
    title: "Liv og helse",
    detail:
      "Kritiske hendelser der nødetater, skadeomfang eller redningsaksjon tilsier rask varsel.",
    examples: ["kritisk skadet", "redningsaksjon", "savnet person"],
  },
  {
    kind: "traffic_disruption",
    severity: "critical",
    title: "Stengte hovedårer",
    detail: "Stengte veier, ras, kollisjoner og andre trafikkhendelser med tydelig kildegrunnlag.",
    examples: ["vegen er stengt", "ras", "trafikkulykke"],
  },
  {
    kind: "weather_hazard",
    severity: "warning",
    title: "Vær og naturfare",
    detail:
      "Varsler for flom, skred, ekstremvær eller andre forhold som kan endre hverdagen raskt.",
    examples: ["farevarsel", "flom", "skred"],
  },
  {
    kind: "service_disruption",
    severity: "warning",
    title: "Viktige bortfall",
    detail: "Strøm, vann, tele eller beredskapssignaler der flere innbyggere kan bli påvirket.",
    examples: ["strømbrudd", "vannavstenging", "bortfall"],
  },
] as const satisfies ReadonlyArray<PublicNotificationTriggerGuidance>;

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

export function notificationSubscriptionMatchesCandidate(
  subscription: Pick<NotificationSubscriptionPreference, "kinds" | "minSeverity"> & {
    enabled?: boolean;
  },
  candidate: Pick<NotificationTriggerCandidate, "kind" | "severity">,
): boolean {
  if (subscription.enabled === false) return false;
  if (severityRank[candidate.severity] < severityRank[subscription.minSeverity]) return false;
  return subscription.kinds.length === 0 || subscription.kinds.includes(candidate.kind);
}

export function notificationTriggerCandidateCanDispatch(
  candidate: Pick<NotificationTriggerCandidate, "severity" | "confidence">,
): boolean {
  if (severityRank[candidate.severity] < severityRank.warning) return false;
  return candidate.confidence.level === "confirmed" || candidate.confidence.level === "likely";
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
    label: sourceConfidenceLabels[level],
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

function publicSourceLabelsForArticle(article: Article): string[] {
  const labels = new Map<string, string>();
  labels.set(article.source, article.sourceLabel);
  const verification = article.publicVerification;
  if (verification) {
    for (const source of verification.officialSources) labels.set(source, sourceIdLabel(source));
    for (const source of verification.reportingSources) labels.set(source, sourceIdLabel(source));
  }
  return [...labels.values()];
}

function publicConfidenceForArticle(
  article: Article,
  score: number,
  generatedAt: string,
): SourceConfidenceSummary {
  const verification = article.publicVerification;
  if (!verification) return confidenceFromScore(score, 1, generatedAt);
  return sourceMixConfidenceSummary(
    [article.source, ...verification.officialSources, ...verification.reportingSources],
    { updatedAt: article.publishedAt },
  );
}

function publicAttentionForSignal(
  kind: NotificationTriggerKind,
  severity: NotificationTriggerSeverity,
): PublicNotificationSignalHighlight["attention"] {
  if (severity === "critical") {
    if (kind === "traffic_disruption") {
      return {
        label: "Sjekk rute nå",
        detail: "Hendelsen kan påvirke reisevei eller framkommelighet.",
        tone: "urgent",
      };
    }
    if (kind === "public_safety") {
      return {
        label: "Følg med nå",
        detail: "Liv, helse eller nødetater er sentrale i saken.",
        tone: "urgent",
      };
    }
    return {
      label: "Krever oppmerksomhet",
      detail: "Signalet vurderes som kritisk og bør følges tett.",
      tone: "urgent",
    };
  }

  if (kind === "weather_hazard") {
    return {
      label: "Følg utviklingen",
      detail: "Natur- eller værforhold kan endre seg raskt.",
      tone: "watch",
    };
  }
  if (kind === "service_disruption") {
    return {
      label: "Sjekk praktisk beredskap",
      detail: "Bortfall eller driftssignaler kan påvirke hverdagsfunksjoner.",
      tone: "watch",
    };
  }
  if (kind === "traffic_disruption") {
    return {
      label: "Planlegg litt ekstra",
      detail: "Trafikksignalet kan påvirke lokale reiser.",
      tone: "watch",
    };
  }
  return {
    label: "Følg med",
    detail: "Saken har høyeffektsignaler, men ikke kritisk varselnivå.",
    tone: "observe",
  };
}

function publicRecencyLabel(updatedAt: string, generatedAt: string): string {
  const updatedMs = Date.parse(updatedAt);
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(updatedMs) || !Number.isFinite(generatedMs)) return "Ukjent ferskhet";
  const ageMinutes = Math.max(0, (generatedMs - updatedMs) / 60_000);
  if (ageMinutes <= 30) return "Oppdatert nå";
  if (ageMinutes <= 120) return "Oppdatert siste 2 t";
  if (ageMinutes <= 24 * 60) return "Oppdatert i dag";
  return "Eldre signal";
}

function publicSituationSignalHighlight(
  situation: HomeSituationSummary,
  generatedAt: string,
): PublicNotificationSignalHighlight | undefined {
  if (situation.status === "dismissed" || situation.status === "resolved") return undefined;
  const matches = keywordsForText(
    `${situation.title} ${situation.summary} ${situation.locationLabel}`,
  );
  if (matches.length === 0) return undefined;

  const score = clampScore(
    0.16 +
      (situation.status === "active" ? 0.14 : 0.08) +
      (situation.verificationStatus === "Offentlig bekreftet" ? 0.16 : 0) +
      (situation.sourceConfidence?.score ??
        confidenceLevelScore[situation.sourceConfidence?.level ?? "uncertain"]) *
        0.28 +
      Math.min(0.18, matches.length * 0.06) +
      recencyBoost(situation.updatedAt, generatedAt),
  );
  if (score < 0.58) return undefined;

  const severity = strongestSeverity([
    ...matches.map((match) => match.severity),
    score >= 0.82 ? "critical" : score >= 0.68 ? "warning" : "watch",
  ]);
  const matchedKeywords = unique(matches.map((match) => match.keyword));
  const confidence = situation.sourceConfidence ?? confidenceFromScore(score, 1, generatedAt);
  const kind = candidateKind(matches);

  return {
    id: `public-signal:situation:${situation.id}`,
    kind,
    severity,
    title: situation.title,
    body: `${situation.locationLabel}: ${situation.summary}`,
    attention: publicAttentionForSignal(kind, severity),
    confidence,
    eventUpdatedAt: situation.updatedAt,
    recencyLabel: publicRecencyLabel(situation.updatedAt, generatedAt),
    sourceLabels: [situation.verificationStatus],
    matchedKeywords,
    reasons: [
      situation.status === "active" ? "Situasjonen er aktiv." : "Situasjonen er til vurdering.",
      situation.verificationStatus === "Offentlig bekreftet"
        ? "Situasjonsrommet er offentlig bekreftet."
        : undefined,
      matchedKeywords.length
        ? `Høyeffektspråk: ${matchedKeywords.slice(0, 3).join(", ")}.`
        : undefined,
    ].filter((reason): reason is string => Boolean(reason)),
    link: {
      kind: "situation",
      label: "Åpne situasjonsrom",
      href: `/situasjoner/${encodeURIComponent(situation.id)}`,
      situationId: situation.id,
    },
  };
}

function publicArticleSignalHighlight(
  article: Article,
  generatedAt: string,
): PublicNotificationSignalHighlight | undefined {
  if (article.category === "Sport" || article.category === "Kultur") return undefined;
  const matches = keywordsForText(
    `${article.title} ${article.excerpt} ${article.places.join(" ")}`,
  );
  if (matches.length === 0) return undefined;

  const official = officialSources.has(article.source);
  const reporting = reportingSources.has(article.source);
  const verified = Boolean(article.publicVerification);
  const coverageBoost =
    article.coverageBundle?.confidence === "high"
      ? 0.16
      : article.coverageBundle?.confidence === "medium"
        ? 0.08
        : 0;
  const score = clampScore(
    0.12 +
      (official ? 0.22 : 0) +
      (reporting ? 0.1 : 0) +
      (verified ? 0.18 : 0) +
      (["Hendelser", "Krim", "Transport", "Vær"].includes(article.category) ? 0.12 : 0) +
      coverageBoost +
      Math.min(0.18, matches.length * 0.06) +
      recencyBoost(article.publishedAt, generatedAt),
  );
  if (score < 0.64) return undefined;

  const severity = strongestSeverity([
    ...matches.map((match) => match.severity),
    score >= 0.82 ? "critical" : "warning",
  ]);
  const matchedKeywords = unique(matches.map((match) => match.keyword));
  const kind = candidateKind(matches);
  return {
    id: `public-signal:article:${article.id}`,
    kind,
    severity,
    title: article.title,
    body: article.excerpt,
    attention: publicAttentionForSignal(kind, severity),
    confidence: publicConfidenceForArticle(article, score, generatedAt),
    eventUpdatedAt: article.publishedAt,
    recencyLabel: publicRecencyLabel(article.publishedAt, generatedAt),
    sourceLabels: publicSourceLabelsForArticle(article),
    matchedKeywords,
    reasons: [
      verified ? "Saken er verifisert mot offentlig kilde og redaksjonell dekning." : undefined,
      article.coverageBundle
        ? `Inngår i dekningsgruppe med ${article.coverageBundle.confidence} tillit.`
        : undefined,
      `Høyeffektspråk: ${matchedKeywords.slice(0, 3).join(", ")}.`,
    ].filter((reason): reason is string => Boolean(reason)),
    link: article.situationId
      ? {
          kind: "situation",
          label: "Åpne situasjonsrom",
          href: `/situasjoner/${encodeURIComponent(article.situationId)}`,
          situationId: article.situationId,
        }
      : { kind: "external", label: article.sourceLabel, href: article.url },
  };
}

function publicSurfaceFromHighlight(
  highlight: PublicNotificationSignalHighlight | undefined,
  hiddenReason: string,
): NotificationTriggerCandidate["publicSurface"] {
  if (!highlight) {
    return {
      state: "hidden",
      label: "Ikke vist på Bypuls",
      detail: "Kandidaten er beholdt for operatørvurdering, men vises ikke som offentlig signal.",
      reason: hiddenReason,
    };
  }
  return {
    state: "visible",
    label: "Synlig på Bypuls",
    detail: `${highlight.attention.label} · ${highlight.recencyLabel}`,
    reason: "Samme offentlige varselregel treffer City Pulse-datasettet.",
    attention: highlight.attention,
    recencyLabel: highlight.recencyLabel,
    ...(highlight.link ? { link: highlight.link } : {}),
  };
}

function homeSummaryFromSituation(situation: Situation): HomeSituationSummary {
  return {
    id: situation.id,
    title: situation.title,
    summary: situation.summary,
    status: situation.status,
    verificationStatus: situation.verificationStatus,
    updatedAt: situation.updatedAt,
    createdAt: situation.createdAt,
    locationLabel: situation.locationLabel,
    ...(situation.sourceConfidence ? { sourceConfidence: situation.sourceConfidence } : {}),
  };
}

export function buildPublicNotificationSignalHighlights(
  input: BuildPublicNotificationSignalHighlightsInput,
): PublicNotificationSignalHighlight[] {
  const highlights: PublicNotificationSignalHighlight[] = [];
  const coveredSituationIds = new Set<string>();
  for (const situation of input.situations) {
    const highlight = publicSituationSignalHighlight(situation, input.generatedAt);
    if (!highlight) continue;
    highlights.push(highlight);
    coveredSituationIds.add(situation.id);
  }

  for (const article of input.articles) {
    if (article.situationId && coveredSituationIds.has(article.situationId)) continue;
    const highlight = publicArticleSignalHighlight(article, input.generatedAt);
    if (highlight) highlights.push(highlight);
  }

  return highlights
    .sort(
      (left, right) =>
        severityRank[right.severity] - severityRank[left.severity] ||
        (right.confidence.score ?? 0) - (left.confidence.score ?? 0) ||
        right.eventUpdatedAt.localeCompare(left.eventUpdatedAt),
    )
    .slice(0, input.limit ?? 3);
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
      const normalizedKeyword = normalizeText(keyword);
      const matched =
        normalizedKeyword === "ko"
          ? new RegExp(`(^|[^a-z0-9])${normalizedKeyword}([^a-z0-9]|$)`).test(normalized)
          : normalized.includes(normalizedKeyword);
      if (matched) {
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

function sourceAuditLinksForSources(sourceIds: SourceId[]): OperationsTimelineEventLink[] {
  return unique(sourceIds).map((source) => ({
    kind: "source_audit",
    label: `Kildeaudit: ${sourceIdLabel(source)}`,
    href: `/command/kilder?sources=${encodeURIComponent(source)}&detail=${encodeURIComponent(
      source,
    )}`,
    sourceId: source,
  }));
}

function sourceItemTraceLinksForSituation(situation: Situation): OperationsTimelineEventLink[] {
  const sourceItemSources = new Map<string, SourceId | undefined>();
  const add = (sourceItemId: string | undefined, source?: SourceId) => {
    if (!sourceItemId || sourceItemSources.has(sourceItemId)) return;
    sourceItemSources.set(sourceItemId, source);
  };

  for (const summary of situation.provenanceSummary ?? []) {
    for (const sourceItemId of summary.sourceItemIds ?? []) add(sourceItemId, summary.sourceIds[0]);
  }
  for (const feature of situation.features) {
    for (const sourceItemId of feature.properties.sourceItemIds ?? []) {
      add(sourceItemId, feature.properties.source);
    }
  }
  for (const entry of situation.timeline) {
    for (const sourceItemId of entry.sourceItemIds ?? []) add(sourceItemId, entry.source);
  }

  return [...sourceItemSources.entries()].slice(0, 12).map(([sourceItemId, source]) => ({
    kind: "source_item",
    label: `Rådata: ${source ? sourceIdLabel(source) : "kildeelement"}`,
    href: `/command/radata?sourceItem=${encodeURIComponent(sourceItemId)}`,
    ...(source ? { sourceId: source } : {}),
    sourceItemId,
  }));
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
      ...sourceAuditLinksForSources(sourceIds),
      ...sourceItemTraceLinksForSituation(situation),
    ],
    publicSurface: publicSurfaceFromHighlight(
      publicSituationSignalHighlight(homeSummaryFromSituation(situation), generatedAt),
      "Situasjonen er under offentlig visningsterskel eller ikke aktiv/offentlig nok for City Pulse.",
    ),
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
    links: [
      ...sourceAuditLinksForSources([article.source]),
      { kind: "external", label: article.sourceLabel, href: article.url },
    ],
    publicSurface: publicSurfaceFromHighlight(
      publicArticleSignalHighlight(article, generatedAt),
      "Artikkelkandidaten er under offentlig visningsterskel eller mangler public-safe signalgrunnlag.",
    ),
  };
}

function candidateMatchesQuery(
  candidate: NotificationTriggerCandidate,
  filters: NotificationTriggerQuery,
) {
  if (filters.kinds?.length && !filters.kinds.includes(candidate.kind)) return false;
  if (filters.severities?.length && !filters.severities.includes(candidate.severity)) return false;
  if (filters.traceStates?.length) {
    const traceState = notificationTriggerTraceState(candidate);
    if (!filters.traceStates.includes(traceState)) return false;
  }
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

function deliveryStateForCandidate(
  candidate: NotificationTriggerCandidate,
  context: NotificationDeliveryStateContext,
): NotificationTriggerDeliveryState {
  const deliveries = context.deliveries?.filter((item) => item.triggerId === candidate.id) ?? [];
  if (deliveries.some((item) => item.status === "sent")) return "sent";
  if (deliveries.some((item) => item.status === "failed")) return "failed";
  if (deliveries.some((item) => item.status === "skipped")) return "suppressed";
  if (!notificationTriggerCandidateCanDispatch(candidate)) return "suppressed";
  if (!context.configured) return "not_configured";
  if (
    context.subscriptions &&
    !context.subscriptions.some((subscription) =>
      notificationSubscriptionMatchesCandidate(subscription, candidate),
    )
  ) {
    return "no_subscribers";
  }
  return "ready";
}

function deliveryDetail(state: NotificationTriggerDeliveryState): string {
  switch (state) {
    case "not_configured":
      return "Web Push er ikke konfigurert. Kandidaten blir ikke sendt automatisk.";
    case "no_subscribers":
      return "Ingen aktive push-abonnement matcher alvorlighet og type.";
    case "ready":
      return "Klar for Web Push dersom en aktiv abonnent matcher alvorlighet og type.";
    case "sent":
      return "Push-varsel er sendt for denne utløseren.";
    case "failed":
      return "Siste push-levering for denne utløseren feilet.";
    case "suppressed":
      return "Utløseren er under terskelen, dempet eller allerede håndtert for automatiske push-varsler.";
    case "candidate_only":
      return "Kandidat for systemvarsel. Ingen push er sendt i denne visningen.";
  }
}

function pushDeliveryCounts(deliveries: NotificationDeliveryStateContext["deliveries"] = []) {
  return {
    total: deliveries.length,
    sent: deliveries.filter((item) => item.status === "sent").length,
    failed: deliveries.filter((item) => item.status === "failed").length,
    claimed: deliveries.filter((item) => item.status === "claimed").length,
    skipped: deliveries.filter((item) => item.status === "skipped").length,
  };
}

function pushStatusLabel(
  context: NotificationDeliveryStateContext,
  health: SourceHealth | undefined,
  blockedCandidates: number,
): { label: string; detail: string } {
  if (!context.configured) {
    return {
      label: "Ikke konfigurert",
      detail: "Web Push mangler VAPID-nøkler og sender ikke automatiske varsler.",
    };
  }
  if (health?.state === "degraded") {
    return {
      label: "Degradert",
      detail: health.detail,
    };
  }
  if (health?.state === "disabled") {
    return {
      label: "Avslått",
      detail: health.detail,
    };
  }
  if (blockedCandidates > 0) {
    return {
      label: "Mangler match",
      detail: "Minst én kandidat mangler aktivt abonnement som matcher alvorlighet og type.",
    };
  }
  return {
    label: "Klar",
    detail: health?.detail ?? "Web Push er konfigurert og kandidatene er vurdert for levering.",
  };
}

function notificationPushStatus(
  page: NotificationTriggerPage,
  context: NotificationDeliveryStateContext,
): NotificationTriggerPage["pushStatus"] {
  const subscriptions = context.subscriptions?.filter((subscription) => subscription.enabled) ?? [];
  const health = context.sourceHealth?.find((source) => source.source === "web_push");
  const matchingCandidates = page.items.filter((candidate) =>
    subscriptions.some((subscription) =>
      notificationSubscriptionMatchesCandidate(subscription, candidate),
    ),
  ).length;
  const readyCandidates = page.items.filter(
    (candidate) => candidate.deliveryState === "ready",
  ).length;
  const blockedCandidates = page.items.filter((candidate) =>
    ["not_configured", "no_subscribers", "failed"].includes(candidate.deliveryState),
  ).length;
  const label = pushStatusLabel(context, health, blockedCandidates);

  return {
    configured: context.configured,
    ...label,
    ...(health ? { health } : {}),
    activeSubscriptions: subscriptions.length,
    matchingCandidates,
    readyCandidates,
    blockedCandidates,
    deliveryCounts: pushDeliveryCounts(context.deliveries),
  };
}

export function applyNotificationDeliveryStates(
  page: NotificationTriggerPage,
  context: NotificationDeliveryStateContext,
): NotificationTriggerPage {
  const nextPage = {
    ...page,
    items: page.items.map((candidate) => {
      const deliveryState = deliveryStateForCandidate(candidate, context);
      return {
        ...candidate,
        deliveryState,
        detail: deliveryDetail(deliveryState),
      };
    }),
  };
  return {
    ...nextPage,
    pushStatus: notificationPushStatus(nextPage, context),
  };
}

export function filterNotificationTriggerPageByDeliveryStates(
  page: NotificationTriggerPage,
  deliveryStates: NotificationTriggerDeliveryState[] | undefined,
): NotificationTriggerPage {
  if (!deliveryStates?.length) return page;
  const allowed = new Set(deliveryStates);
  const items = page.items.filter((candidate) => allowed.has(candidate.deliveryState));
  return {
    ...page,
    filters: {
      ...page.filters,
      deliveryStates,
    },
    items,
    summary: summaryForCandidates(items),
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
