import type { Feature, Geometry, LineString, Point, Polygon } from "geojson";

export type SourceId =
  | "nrk"
  | "adressa"
  | "avisa_st"
  | "snasningen"
  | "merakerposten"
  | "frostingen"
  | "ytringen"
  | "steinkjer_avisa"
  | "innherred"
  | "namdalsavisa"
  | "malviknytt"
  | "selbyggen"
  | "fjell_ljom"
  | "retten"
  | "hitra_froya"
  | "tronderbladet"
  | "nidaros"
  | "t_a"
  | "vg"
  | "dagbladet"
  | "trondheim_kommune"
  | "bane_nor"
  | "met"
  | "nve"
  | "datex"
  | "datex_travel_time"
  | "datex_weather"
  | "datex_cctv"
  | "trafikkdata"
  | "vegvesen_traffic_info"
  | "entur"
  | "entur_vehicle_positions"
  | "entur_service_alerts"
  | "dsb"
  | "politiloggen"
  | "internal"
  | "private_annotations"
  | "deepseek"
  | "web_push";

export type GeographicScope = "trondheim" | "trondelag";
export type ArticleCategory =
  | "Nyheter"
  | "Hendelser"
  | "Krim"
  | "Byutvikling"
  | "Kultur"
  | "Sport"
  | "Transport"
  | "Politikk"
  | "Vær";

export type ArticleTopic = "rosenborg";

export type SituationType =
  | "fire"
  | "missing_person"
  | "traffic"
  | "flood"
  | "landslide"
  | "weather"
  | "rescue"
  | "service_disruption"
  | "other";

export type SituationLifecycle = "preliminary" | "active" | "resolved" | "dismissed";
export type Provenance =
  | "official"
  | "reporting_estimate"
  | "preparedness_context"
  | "private_annotation";

export const provenanceLabels = {
  official: "Offisiell",
  reporting_estimate: "Anslag fra rapportering",
  preparedness_context: "Beredskapskontekst",
  private_annotation: "Privat markering",
} as const satisfies Record<Provenance, string>;

export type ProvenanceDisplayLabel = (typeof provenanceLabels)[keyof typeof provenanceLabels];
export type SourceConfidenceLevel = "confirmed" | "likely" | "uncertain" | "speculative";

export const sourceConfidenceLabels = {
  confirmed: "Bekreftet",
  likely: "Sannsynlig",
  uncertain: "Usikker",
  speculative: "Spekulativ",
} as const satisfies Record<SourceConfidenceLevel, string>;

export type SourceConfidenceLabel =
  (typeof sourceConfidenceLabels)[keyof typeof sourceConfidenceLabels];

export interface SourceConfidenceSummary {
  level: SourceConfidenceLevel;
  label?: SourceConfidenceLabel;
  score?: number;
  rationale?: string;
  sourceCount?: number;
  updatedAt?: string;
}

export interface ProvenanceConfidence {
  provenance: Provenance;
  label?: ProvenanceDisplayLabel;
  sourceIds: SourceId[];
  confidence: SourceConfidenceSummary;
  evidenceIds?: string[];
  sourceItemIds?: string[];
}

export interface Article {
  id: string;
  source: SourceId;
  sourceLabel: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
  scope: GeographicScope;
  category: ArticleCategory;
  topics?: ArticleTopic[];
  places: string[];
  location?: { lat: number; lng: number; label: string };
  saved?: boolean;
  situationId?: string;
  imageUrl?: string;
  coverageBundle?: ArticleCoverageBundle;
  publicVerification?: ArticlePublicVerification;
}

export interface ArticlePublicVerification {
  status: "verified";
  label: string;
  detail: string;
  officialSources: SourceId[];
  reportingSources: SourceId[];
  situationId?: string;
}

export type ArticleCoverageBundleKind = "incident" | "topic" | "update";
export type ArticleCoverageBundleConfidence = "high" | "medium";
export type CoverageProjectionState = "legacy" | "shadow" | "active" | "superseded";

export interface CoverageGenerationSummary {
  id: string;
  matcherVersion: "v1" | "v2";
  mode: "active" | "shadow";
  status: "completed";
  startedAt: string;
  completedAt: string;
  articleCount: number;
  bundleCount: number;
  edgeCount: number;
  correctionConflictCount: number;
}

export interface CoverageProjectionParity {
  legacyBundleCount: number;
  normalizedBundleCount: number;
  membershipMismatchCount: number;
  primaryMismatchCount: number;
  clean: boolean;
}

export interface CoverageBundleSplitRequest {
  expectedGeneratedAt: string;
  expectedProjectionRevision?: number;
  originalBundleId?: string;
  anchorArticleId: string;
  rejectedArticleIds: string[];
  reason?: string;
}

export interface CoverageBundleCorrection {
  id: string;
  originalBundleId: string;
  anchorArticleId: string;
  rejectedArticleId: string;
  matcherVersion: "v1" | "v2";
  evidenceFingerprint: string;
  status: "active" | "reverted";
  createdAt: string;
  revertedAt?: string;
}

export interface CoverageBundleCorrectionResult {
  corrections: CoverageBundleCorrection[];
  removedStoryIds: string[];
  replacementStories: CityPulseStory[];
}

export interface CoverageCorrectionExportRow {
  correctionId: string;
  label: "separate";
  articleIds: [string, string];
  sources: [SourceId, SourceId];
  normalizedTitles: [string, string];
  normalizedExcerpts: [string, string];
  matcherVersion: "v1" | "v2";
  evidenceFingerprint: string;
  createdAt: string;
}

export interface CoverageCorrectionExport {
  schemaVersion: 1;
  generatedAt: string;
  rows: CoverageCorrectionExportRow[];
}

export interface CoverageMatchConfidence {
  tier: "strong" | "moderate";
  score: number;
  rationale: string;
}

export interface CoverageTrustSummary {
  match: CoverageMatchConfidence;
  source: SourceConfidenceSummary;
  verification?: ArticlePublicVerification;
}

export interface ArticleCoverageBundle {
  id: string;
  kind: ArticleCoverageBundleKind;
  confidence: ArticleCoverageBundleConfidence;
  reason: string;
  generatedAt: string;
  matchConfidence?: CoverageMatchConfidence;
  matcherVersion?: "v1" | "v2";
  correctionTarget?: {
    originalBundleId: string;
    projectionRevision: number;
  };
}

export interface EvidenceItem {
  id: string;
  situationId: string;
  source: SourceId;
  sourceLabel: string;
  sourceUrl: string;
  supportingSnippet: string;
  claim: string;
  claimType: string;
  provenance: Exclude<Provenance, "private_annotation">;
  confidence: number;
  confidenceSummary?: SourceConfidenceSummary;
  extractedAt: string;
  publishedAt: string;
}

export type PrivateMapAnalysisType =
  | "freehand_note"
  | "fire_perimeter"
  | "hotspot"
  | "smoke_wind_cone"
  | "risk_radius"
  | "water_access"
  | "evacuation_line"
  | "last_known_position"
  | "witness_observation"
  | "probable_route"
  | "search_sector"
  | "search_grid"
  | "command_point"
  | "resource_point";
export type PrivateMapConfidence = "observed_by_owner" | "reported_unverified" | "speculative";
export type PrivateMapScenario = "general" | "fire" | "sar" | "traffic" | "weather";

export interface MapFeature extends Feature<Geometry> {
  id: string;
  properties: {
    label: string;
    provenance: Provenance;
    sourceLabel?: string;
    source?: SourceId;
    sourceUrl?: string;
    updatedAt: string;
    note?: string;
    layer?: string;
    analysisType?: PrivateMapAnalysisType;
    confidence?: PrivateMapConfidence;
    scenario?: PrivateMapScenario;
    measurement?: {
      distanceMeters?: number;
      areaSquareMeters?: number;
      bearingDegrees?: number;
      radiusMeters?: number;
    };
    styleKey?: string;
    sourceItemIds?: string[];
    sourceConfidence?: SourceConfidenceSummary;
  };
}

export type PrivateMapFeatureInput = {
  geometry: Point | LineString | Polygon;
  properties: Pick<
    MapFeature["properties"],
    | "label"
    | "note"
    | "analysisType"
    | "confidence"
    | "scenario"
    | "measurement"
    | "styleKey"
    | "sourceItemIds"
  >;
};

export type PrivateAnnotationFeature = MapFeature & {
  properties: MapFeature["properties"] & {
    provenance: "private_annotation";
  };
};

export type PrivateAnnotationCreateRequest = PrivateMapFeatureInput;
type RequireAtLeastOne<T> = {
  [Key in keyof T]-?: Required<Pick<T, Key>> & Partial<Omit<T, Key>>;
}[keyof T];
type PrivateAnnotationUpdateFields = Pick<
  MapFeature["properties"],
  | "label"
  | "note"
  | "analysisType"
  | "confidence"
  | "scenario"
  | "measurement"
  | "styleKey"
  | "sourceItemIds"
>;
export type PrivateAnnotationUpdateRequest = RequireAtLeastOne<PrivateAnnotationUpdateFields>;
export type PrivateAnnotationCreateResponse = PrivateAnnotationFeature;
export type PrivateAnnotationUpdateResponse = PrivateAnnotationFeature;

export type TimelineEntryKind =
  | "source_update"
  | "official_update"
  | "status_change"
  | "review_action"
  | "severity_change"
  | "merge_decision"
  | "split_decision"
  | "context_update"
  | "private_annotation"
  | "system";

export const timelineEntryKindLabels = {
  source_update: "Kildeoppdatering",
  official_update: "Offisiell oppdatering",
  status_change: "Statusendring",
  review_action: "Manuell vurdering",
  severity_change: "Alvorlighetsendring",
  merge_decision: "Flettebeslutning",
  split_decision: "Delingsbeslutning",
  context_update: "Kontekstoppdatering",
  private_annotation: "Privat markering",
  system: "System",
} as const satisfies Record<TimelineEntryKind, string>;

export type TimelineEntryKindLabel =
  (typeof timelineEntryKindLabels)[keyof typeof timelineEntryKindLabels];

export interface TimelineEntry {
  id: string;
  situationId: string;
  timestamp: string;
  kind?: TimelineEntryKind;
  title: string;
  detail: string;
  sourceLabel: string;
  source?: SourceId;
  sourceUrl: string;
  official: boolean;
  provenance?: Provenance;
  confidence?: SourceConfidenceSummary;
  sourceItemIds?: string[];
  privateAnnotationId?: string;
}

export type SourceItemKind =
  | "article"
  | "official_event"
  | "warning"
  | "reporter_note"
  | "reader_tip"
  | "media_asset";

export type SourceReliabilityTier = "official" | "trusted_media" | "internal" | "unverified";
export type SourceItemRelationship = "supports" | "contradicts" | "context" | "duplicate";
export type SourceItemRole =
  | "official"
  | "reporting"
  | "context"
  | "telemetry"
  | "private"
  | "ai_summary"
  | "ignored";

export interface SourceItem {
  id: string;
  provider: SourceId;
  kind: SourceItemKind;
  externalId?: string;
  originalUrl?: string;
  title?: string;
  summary?: string;
  author?: string;
  publishedAt?: string;
  fetchedAt: string;
  captureHash: string;
  inputHash?: string;
  geoHint?: MapFeature["geometry"];
  reliabilityTier: SourceReliabilityTier;
  role?: SourceItemRole;
  confidence?: SourceConfidenceSummary;
  linkedSituationIds: string[];
  relationship?: SourceItemRelationship;
}

export interface SourceItemRecord extends SourceItem {
  rawPayload: unknown;
  normalizedPayload: unknown;
}

export type SourceItemInput = Omit<SourceItemRecord, "linkedSituationIds"> & {
  // Capture-only source revision clock. The current source_items projection intentionally keeps
  // its existing schema; append-only source_item_captures preserves this value per observation.
  sourceUpdatedAt?: string;
};

export interface SourceItemPage {
  items: SourceItem[];
  nextCursor?: string;
}

export interface SourceItemFilters {
  provider?: SourceId;
  kind?: SourceItemKind;
  unlinked?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface RawInspectorSourceItemDetail {
  item: SourceItem;
  rawPayload: unknown;
  normalizedPayload: unknown;
  payloadBytes: {
    raw: number;
    normalized: number;
  };
  redacted: boolean;
  truncated: boolean;
}

export type RawInspectorTelemetrySource = "datex_travel_time" | "trafikkdata";

export interface RawInspectorTelemetryDetail {
  record: {
    id: string;
    source: RawInspectorTelemetrySource;
    title: string;
    updatedAt: string;
    observedAt?: string;
    sourceUrl?: string;
    summary?: string;
    geometry?: Point;
  };
  payload: unknown;
  payloadBytes: number;
  redacted: boolean;
  truncated: boolean;
}

export interface RawInspectorTelemetrySummary {
  id: string;
  source: RawInspectorTelemetrySource;
  title: string;
  updatedAt: string;
  observedAt?: string;
  sourceUrl?: string;
  summary?: string;
}

export interface RawInspectorTelemetryPage {
  items: RawInspectorTelemetrySummary[];
  nextCursor?: string;
}

export interface RawInspectorTelemetryFilters {
  source?: RawInspectorTelemetrySource;
  q?: string;
  cursor?: string;
  limit?: number;
}

export type AiAnalysisProfile = "standard" | "compact_recovery" | "brief_only_recovery";

export interface AiAnalysisAttemptDiagnostics {
  profile: AiAnalysisProfile;
  status: "ok" | "failed";
  maxTokens: number;
  articleCount: number;
  situationCount: number;
  error?: string;
}

export interface AiProcessingRunDiagnostics {
  profile: AiAnalysisProfile;
  attempts: AiAnalysisAttemptDiagnostics[];
}

export interface RawInspectorAiRunSummary {
  id: string;
  provider: AiProcessingRun["provider"];
  model: string;
  status: AiProcessingRun["status"];
  startedAt: string;
  completedAt: string;
  articleCount: number;
  diagnostics?: AiProcessingRunDiagnostics;
  error?: string;
}

export interface RawInspectorAiRunDetail extends RawInspectorAiRunSummary {
  articleIds: string[];
  result: unknown;
  resultBytes: number;
  redacted: boolean;
  truncated: boolean;
}

export interface RawInspectorAiRunPage {
  items: RawInspectorAiRunSummary[];
  nextCursor?: string;
}

export interface RawInspectorAiRunFilters {
  provider?: AiProcessingRun["provider"];
  status?: AiProcessingRun["status"];
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CommandCenterBriefingArticleSummary {
  id: string;
  title: string;
  sourceLabel: string;
  publishedAt: string;
  category: Article["category"];
  excerpt: string;
  url?: string;
}

export interface SourceFilterQueryState {
  providers?: SourceId[];
  kinds?: SourceItemKind[];
  provenances?: Provenance[];
  reliabilityTiers?: SourceReliabilityTier[];
  relationships?: SourceItemRelationship[];
  confidenceLevels?: SourceConfidenceLevel[];
  includeTelemetry?: boolean;
  includePrivateAnnotations?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export type SourceHealthState = "ok" | "degraded" | "disabled" | "awaiting_access";
export type SourceAuditProviderGroup =
  | "datex"
  | "entur"
  | "politiloggen"
  | "media"
  | "internal"
  | "private_annotation"
  | "other";
export type SourceAuditRole =
  | "incident_source"
  | "context_source"
  | "telemetry_source"
  | "internal_analysis"
  | "private_annotation";
export type SourceFreshnessState = "fresh" | "lagging" | "stale" | "unknown";
export type SourceCollectorRunStatus = "succeeded" | "partial" | "failed" | "skipped" | "running";
export type SourceReliabilityLevel = "good" | "watch" | "poor" | "unknown";
export type SourceStaleDataAlertSeverity = "watch" | "warning" | "critical";
export type SourceStaleDataAlertStatus = "open" | "acknowledged" | "resolved";
export type SourceContractCheckStatus = "pass" | "warn" | "fail" | "not_applicable";
export type SourceContractCheckKind =
  | "source_contract"
  | "schema"
  | "provenance"
  | "telemetry_guardrail"
  | "secret_hygiene"
  | "activation_policy";
export type SourceDiagnosticSeverity = "info" | "warning" | "error";
export type SourceDiagnosticKind =
  | "auth_state"
  | "http_status"
  | "latency"
  | "rate_limit"
  | "schema_mismatch"
  | "empty_payload"
  | "parse_error"
  | "network"
  | "scheduler"
  | "storage"
  | "upstream";
export type SourceDiagnosticValue = string | number | boolean | null;
export type IncidentTraceabilityState = "complete" | "partial" | "missing";

export interface SourceFreshness {
  state: SourceFreshnessState;
  checkedAt: string;
  lastObservedAt?: string;
  lastFetchedAt?: string;
  lastSuccessfulRunAt?: string;
  nextPollAt?: string;
  expectedIntervalSeconds?: number;
  staleAfterSeconds?: number;
  ageSeconds?: number;
  detail?: string;
}

export interface SourceAuditDiagnostic {
  key: string;
  label: string;
  kind: SourceDiagnosticKind;
  severity: SourceDiagnosticSeverity;
  safeForDisplay: true;
  value?: SourceDiagnosticValue;
  unit?: "ms" | "seconds" | "count" | "percent" | "status" | "bytes";
  observedAt: string;
  detail?: string;
}

export type SourceNonSecretDiagnostic = SourceAuditDiagnostic;

export interface SourceCollectorRun {
  id: string;
  source: SourceId;
  collector: string;
  status: SourceCollectorRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  recordsSeen: number;
  recordsAccepted: number;
  recordsRejected: number;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: SourceNonSecretDiagnostic[];
}

export interface SourceCollectorRunHistory {
  source: SourceId;
  runs: SourceCollectorRun[];
  nextCursor?: string;
}

export interface SourceReliabilityIndicator {
  id: string;
  source: SourceId;
  label: string;
  level: SourceReliabilityLevel;
  score?: number;
  sampleSize?: number;
  updatedAt: string;
  detail?: string;
  diagnostics?: SourceNonSecretDiagnostic[];
}

export interface SourceStaleDataAlert {
  id: string;
  source: SourceId;
  severity: SourceStaleDataAlertSeverity;
  status: SourceStaleDataAlertStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  lastFreshAt?: string;
  expectedFreshnessSeconds: number;
  ageSeconds: number;
  message: string;
  affectedSituationIds?: string[];
}

export interface SourceContractComplianceCheck {
  id: string;
  source: SourceId;
  kind: SourceContractCheckKind;
  status: SourceContractCheckStatus;
  label: string;
  checkedAt: string;
  detail?: string;
  contractPath?: string;
  failingField?: string;
  sourceItemIds?: string[];
  diagnostics?: SourceNonSecretDiagnostic[];
}

export interface IncidentSourceTraceabilityLink {
  source: SourceId;
  provenance: Provenance;
  relationship: SourceItemRelationship | "activation" | "timeline" | "private_annotation";
  sourceItemId?: string;
  evidenceId?: string;
  privateAnnotationId?: string;
  confidence?: SourceConfidenceSummary;
  publishedAt?: string;
  fetchedAt?: string;
}

export interface IncidentSourceTraceabilitySummary {
  situationId: string;
  title: string;
  status: SituationLifecycle;
  updatedAt: string;
  traceabilityState: IncidentTraceabilityState;
  sourceCount: number;
  evidenceCount: number;
  sourceItemCount: number;
  privateAnnotationCount: number;
  primarySources: SourceId[];
  activationSourceIds?: SourceId[];
  officialSource?: Extract<SourceId, "datex" | "politiloggen">;
  provenanceCounts: Partial<Record<Provenance, number>>;
  links: IncidentSourceTraceabilityLink[];
  missingLinks?: Array<{
    kind: "evidence" | "source_item" | "private_annotation";
    reason: string;
  }>;
}

export interface SourceAuditFilterQuery {
  sources?: SourceId[];
  groups?: SourceAuditProviderGroup[];
  roles?: SourceAuditRole[];
  provenances?: Provenance[];
  healthStates?: SourceHealthState[];
  freshnessStates?: SourceFreshnessState[];
  reliabilityLevels?: SourceReliabilityLevel[];
  alertSeverities?: SourceStaleDataAlertSeverity[];
  contractStatuses?: SourceContractCheckStatus[];
  staleOnly?: boolean;
  includeDiagnostics?: boolean;
  includeResolvedAlerts?: boolean;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface SourceAuditDetailQuery {
  includeRuns?: boolean;
  includeDiagnostics?: boolean;
  includeTraceability?: boolean;
  includeResolvedAlerts?: boolean;
  runLimit?: number;
  from?: string;
  to?: string;
}

export interface SourceAuditSourceSummary {
  source: SourceId;
  label: string;
  group: SourceAuditProviderGroup;
  role: SourceAuditRole;
  provenance: Provenance;
  healthState: SourceHealthState;
  freshness: SourceFreshness;
  reliability: SourceReliabilityIndicator[];
  latestRun?: SourceCollectorRun;
  openAlertCount: number;
  criticalAlertCount: number;
  contractStatus: SourceContractCheckStatus;
  lastIncidentTraceAt?: string;
}

export interface SourceAuditListResponse {
  generatedAt: string;
  filters: SourceAuditFilterQuery;
  sources: SourceAuditSourceSummary[];
  alerts: SourceStaleDataAlert[];
  nextCursor?: string;
}

export interface SourceAuditSourceDetailResponse {
  generatedAt: string;
  source: SourceAuditSourceSummary;
  runHistory: SourceCollectorRunHistory;
  contractChecks: SourceContractComplianceCheck[];
  traceability: IncidentSourceTraceabilitySummary[];
  diagnostics: SourceNonSecretDiagnostic[];
  alerts: SourceStaleDataAlert[];
}

export interface SourceAuditWorkspaceResponse {
  generatedAt: string;
  filters: SourceAuditFilterQuery;
  sources: SourceAuditSourceSummary[];
  collectorRuns: SourceCollectorRun[];
  alerts: SourceStaleDataAlert[];
  contractChecks: SourceContractComplianceCheck[];
  traceability: IncidentSourceTraceabilitySummary[];
  diagnostics?: SourceNonSecretDiagnostic[];
  nextCursor?: string;
}

export type OperationsTimelineEventKind =
  | "situation_update"
  | "source_update"
  | "collector_run"
  | "review_action"
  | "status_change"
  | "severity_change"
  | "merge_decision"
  | "split_decision"
  | "stale_warning"
  | "private_annotation";

export const operationsTimelineEventKindLabels = {
  situation_update: "Situasjonsoppdatering",
  source_update: "Kildeoppdatering",
  collector_run: "Worker-kjøring",
  review_action: "Manuell vurdering",
  status_change: "Statusendring",
  severity_change: "Alvorlighetsendring",
  merge_decision: "Flettebeslutning",
  split_decision: "Delingsbeslutning",
  stale_warning: "Stale-varsel",
  private_annotation: "Privat markering",
} as const satisfies Record<OperationsTimelineEventKind, string>;

export type OperationsTimelineEventKindLabel =
  (typeof operationsTimelineEventKindLabels)[keyof typeof operationsTimelineEventKindLabels];

export type OperationsTimelineEventSeverity = "critical" | "warning" | "info" | "muted";
export type OperationsTimelineEventRole =
  | "incident"
  | "context"
  | "telemetry"
  | "private"
  | "system";

export interface OperationsTimelineEventLink {
  kind: "situation" | "source_audit" | "source_item" | "external" | "private_workspace";
  label: string;
  href?: string;
  situationId?: string;
  sourceId?: SourceId;
  sourceItemId?: string;
}

export interface OperationsTimelineEvent {
  id: string;
  timestamp: string;
  kind: OperationsTimelineEventKind;
  severity: OperationsTimelineEventSeverity;
  title: string;
  detail: string;
  source?: SourceId;
  sourceLabel?: string;
  collector?: string;
  situationId?: string;
  situationTitle?: string;
  situationStatus?: SituationLifecycle;
  role: OperationsTimelineEventRole;
  provenance?: Provenance;
  confidence?: SourceConfidenceSummary;
  private: boolean;
  links: OperationsTimelineEventLink[];
  metadata?: {
    recordsSeen?: number;
    recordsAccepted?: number;
    recordsRejected?: number;
    durationMs?: number;
    sourceItemId?: string;
    relationship?: SourceItemRelationship | "activation" | "timeline" | "private_annotation";
    previousValue?: string;
    nextValue?: string;
  };
}

export interface OperationsTimelineSummary {
  total: number;
  activeSituations: number;
  staleWarnings: number;
  collectorRuns: number;
  reviewerActions: number;
  privateEvents: number;
}

export interface OperationsTimelineQuery {
  sources?: SourceId[];
  provenances?: Provenance[];
  kinds?: OperationsTimelineEventKind[];
  situationIds?: string[];
  statuses?: SituationLifecycle[];
  severities?: OperationsTimelineEventSeverity[];
  roles?: OperationsTimelineEventRole[];
  includePrivateAnnotations?: boolean;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  sort?: "asc" | "desc";
}

export interface OperationsTimelineResponse {
  generatedAt: string;
  filters: OperationsTimelineQuery;
  events: OperationsTimelineEvent[];
  summary: OperationsTimelineSummary;
  nextCursor?: string;
}

export type NotificationTriggerKind =
  | "public_safety"
  | "traffic_disruption"
  | "weather_hazard"
  | "service_disruption";
export type NotificationTriggerSeverity = "critical" | "warning" | "watch";
export type NotificationTriggerDeliveryState =
  | "candidate_only"
  | "not_configured"
  | "no_subscribers"
  | "ready"
  | "sent"
  | "failed"
  | "suppressed";
export type NotificationTriggerTraceState =
  | "raw_evidence"
  | "source_audit"
  | "external_only"
  | "missing";

export const notificationTriggerTraceStateLabels = {
  raw_evidence: "Rådata",
  source_audit: "Kildeaudit",
  external_only: "Ekstern",
  missing: "Mangler spor",
} as const satisfies Record<NotificationTriggerTraceState, string>;

export interface NotificationTriggerPublicSurface {
  state: "visible" | "hidden";
  label: string;
  detail: string;
  reason: string;
  attention?: PublicNotificationSignalHighlight["attention"];
  recencyLabel?: string;
  link?: OperationsTimelineEventLink;
}

export interface NotificationTriggerCandidate {
  id: string;
  kind: NotificationTriggerKind;
  severity: NotificationTriggerSeverity;
  deliveryState: NotificationTriggerDeliveryState;
  title: string;
  body: string;
  detail: string;
  score: number;
  confidence: SourceConfidenceSummary;
  generatedAt: string;
  eventUpdatedAt: string;
  situationId?: string;
  articleIds: string[];
  sourceIds: SourceId[];
  sourceLabels: string[];
  matchedKeywords: string[];
  reasons: string[];
  links: OperationsTimelineEventLink[];
  publicSurface: NotificationTriggerPublicSurface;
}

export interface NotificationTriggerSummary {
  total: number;
  critical: number;
  warning: number;
  watch: number;
  cityPulseVisible: number;
  commandOnly: number;
  officialBacked: number;
  highConfidence: number;
  spatialSignals: number;
  spatialCritical: number;
  unexplainedDelays: number;
}

export interface PublicNotificationSignalHighlight {
  id: string;
  kind: NotificationTriggerKind;
  severity: NotificationTriggerSeverity;
  title: string;
  body: string;
  attention: {
    label: string;
    detail: string;
    tone: "urgent" | "watch" | "observe";
  };
  confidence: SourceConfidenceSummary;
  eventUpdatedAt: string;
  recencyLabel: string;
  sourceLabels: string[];
  matchedKeywords: string[];
  reasons: string[];
  link?: OperationsTimelineEventLink;
}

export interface NotificationPushStatus {
  configured: boolean;
  label: string;
  detail: string;
  health?: SourceHealth;
  activeSubscriptions: number;
  matchingCandidates: number;
  readyCandidates: number;
  blockedCandidates: number;
  deliveryCounts: {
    total: number;
    sent: number;
    failed: number;
    claimed: number;
    skipped: number;
  };
}

export interface NotificationTriggerQuery {
  kinds?: NotificationTriggerKind[];
  severities?: NotificationTriggerSeverity[];
  deliveryStates?: NotificationTriggerDeliveryState[];
  traceStates?: NotificationTriggerTraceState[];
  q?: string;
  limit?: number;
}

export interface NotificationTriggerPage {
  generatedAt: string;
  filters: NotificationTriggerQuery;
  items: NotificationTriggerCandidate[];
  summary: NotificationTriggerSummary;
  pushStatus?: NotificationPushStatus;
}

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  minSeverity?: NotificationTriggerSeverity;
  kinds?: NotificationTriggerKind[];
}

export interface PushSubscriptionSummary {
  id: string;
  endpointHash: string;
  enabled: boolean;
  minSeverity: NotificationTriggerSeverity;
  kinds: NotificationTriggerKind[];
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  failureCount: number;
}

export interface PushNotificationSettings {
  configured: boolean;
  publicKey?: string;
  subscriptions: PushSubscriptionSummary[];
}

export type PushDeliveryStatus = "claimed" | "sent" | "failed" | "skipped";

export interface PushDeliveryListItem {
  id: string;
  triggerId: string;
  subscriptionId: string;
  userId: string;
  status: PushDeliveryStatus;
  kind: NotificationTriggerKind;
  severity: NotificationTriggerSeverity;
  title: string;
  body: string;
  targetUrl?: string;
  errorMessage?: string;
  score?: number;
  confidence?: SourceConfidenceSummary;
  sourceLabels?: string[];
  matchedKeywords?: string[];
  reasons?: string[];
  createdAt: string;
  sentAt?: string;
}

export interface PushDeliveryPage {
  generatedAt: string;
  items: PushDeliveryListItem[];
  summary: {
    total: number;
    sent: number;
    failed: number;
    claimed: number;
    skipped: number;
  };
}

export interface SituationSourceItemLink {
  situationId: string;
  sourceItemId: string;
  relationship: SourceItemRelationship;
  confidenceContribution?: number;
  linkedAt: string;
  linkedBy?: string;
}

export interface Situation {
  id: string;
  type: SituationType;
  title: string;
  summary: string;
  status: SituationLifecycle;
  publicVisibility?: "public" | "command_center";
  verificationStatus: "Foreløpig fra rapportering" | "Offentlig bekreftet";
  importance: "high" | "normal";
  updatedAt: string;
  createdAt: string;
  locationLabel: string;
  incidentSignature?: string;
  detectionVersion?: string;
  officialSource?: Extract<SourceId, "datex" | "politiloggen">;
  officialEventId?: string;
  activationBasis?: {
    rule: "two_independent_sources" | "official_source";
    sourceIds: SourceId[];
    articleIds: string[];
    activatedAt: string;
  };
  dismissedAt?: string;
  dismissalReason?: "false_positive" | "owner_dismissed";
  relatedArticleIds: string[];
  evidence: EvidenceItem[];
  features: MapFeature[];
  timeline: TimelineEntry[];
  provenanceSummary?: ProvenanceConfidence[];
  sourceConfidence?: SourceConfidenceSummary;
  saved?: boolean;
}

export type HomeSituationSummary = Pick<
  Situation,
  | "id"
  | "title"
  | "summary"
  | "status"
  | "verificationStatus"
  | "updatedAt"
  | "createdAt"
  | "locationLabel"
> & {
  sourceConfidence?: SourceConfidenceSummary;
  primaryLocation?: {
    lat: number;
    lng: number;
    label: string;
  };
};

export interface MapViewport {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type SituationMapLayer =
  | "situations"
  | "evidence"
  | "preparedness_context"
  | "private_annotations"
  | "traffic"
  | "public_transport";

export const situationMapLayerLabels = {
  situations: "Situasjoner",
  evidence: "Kilder",
  preparedness_context: "Beredskapskontekst",
  private_annotations: "Private markeringer",
  traffic: "Trafikk",
  public_transport: "Kollektiv",
} as const satisfies Record<SituationMapLayer, string>;

export type SituationMapLayerLabel =
  (typeof situationMapLayerLabels)[keyof typeof situationMapLayerLabels];

export interface SituationMapState {
  bounds?: MapViewport;
  selectedSituationId?: string;
  selectedFeatureId?: string;
  layers: SituationMapLayer[];
  sourceFilters: SourceFilterQueryState;
}

export interface MapFirstSituation {
  id: string;
  type: SituationType;
  title: string;
  summary: string;
  status: SituationLifecycle;
  publicVisibility: NonNullable<Situation["publicVisibility"]>;
  importance: Situation["importance"];
  updatedAt: string;
  locationLabel: string;
  primaryFeature?: MapFeature;
  features: MapFeature[];
  timelinePreview: TimelineEntry[];
  provenanceSummary: ProvenanceConfidence[];
  sourceConfidence: SourceConfidenceSummary;
  hasPrivateAnnotations: boolean;
  saved?: boolean;
}

export interface SituationMapWorkspace {
  situations: MapFirstSituation[];
  mapState: SituationMapState;
  timeline: TimelineEntry[];
  privateAnnotations: PrivateAnnotationFeature[];
}

export interface SituationExplanation {
  createdBecause: string[];
  sourceRoles: Array<{
    provider: SourceId;
    role: "evidence" | "context" | "telemetry" | "private";
  }>;
  locationConfidence: "official" | "estimated" | "mixed" | "unknown";
  dismissalReason?: Situation["dismissalReason"];
}

export type OfficialEventState = "active" | "updated" | "cancelled" | "expired";

export interface OfficialEvent {
  id: string;
  source: "met" | "nve" | "datex";
  eventType: SituationType;
  title: string;
  detail: string;
  sourceUrl: string;
  areaLabel: string;
  state: OfficialEventState;
  severity?: string;
  publishedAt: string;
  validFrom: string;
  validTo: string;
  geometry?: MapFeature["geometry"];
  replacesIds?: string[];
  raw: unknown;
}

export interface AiProcessingRun {
  id: string;
  provider: "deepseek" | "deterministic";
  model: string;
  status: "ok" | "degraded" | "disabled";
  startedAt: string;
  completedAt: string;
  articleIds: string[];
  result: unknown;
  error?: string;
}

export interface MorningBrief {
  generatedAt: string;
  title: string;
  mode: "ai_assisted" | "deterministic";
  sourceLine: string;
  paragraphs: [string, string, string];
  highlights: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  articleIds: string[];
  situationIds: string[];
  aiRun?: Pick<AiProcessingRun, "provider" | "model" | "status" | "completedAt">;
}

export interface WorkspaceTask {
  id: string;
  situationId: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

export interface WorkspaceNote {
  id: string;
  situationId: string;
  text: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  situationId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface SourceHealth {
  source: SourceId;
  label: string;
  state: SourceHealthState;
  lastCheckedAt?: string;
  lastFailureAt?: string;
  nextPollAt?: string;
  detail: string;
  freshness?: SourceFreshness;
  reliability?: SourceReliabilityIndicator[];
  activeAlerts?: SourceStaleDataAlert[];
  diagnostics?: SourceNonSecretDiagnostic[];
}

export interface TrafficPulseCorridor {
  id: string;
  name: string;
  state: "free_flow" | "slow" | "congested" | "stale";
  travelTimeSeconds?: number;
  freeFlowSeconds?: number;
  delaySeconds?: number;
  delayRatio?: number;
  trend?: string;
  measurementFrom?: string;
  measurementTo?: string;
  updatedAt: string;
  sourceUrl: string;
}

export interface SituationWorkspace {
  situation: Situation;
  explanation?: SituationExplanation;
  relatedArticles: Article[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  attachments: Attachment[];
  mapState?: SituationMapState;
  privateAnnotations?: PrivateAnnotationFeature[];
  sourceFilters?: SourceFilterQueryState;
}

export interface BootstrapPayload {
  articles: Article[];
  stories?: CityPulseStory[];
  storyNextCursor?: string;
  storyProjection?: CityPulseStoryProjection;
  situations: HomeSituationSummary[];
  sourceHealth: SourceHealth[];
  morningBrief?: MorningBrief;
}

export interface ArticlePage {
  items: Article[];
  nextCursor?: string;
}

export interface CityPulseStory {
  id: string;
  primaryArticleId: string;
  articleIds: string[];
  primary: Article;
  articles: Article[];
  sourceLabels: string[];
  sourceCount: number;
  updateCount: number;
  latestAt: string;
  category: ArticleCategory;
  editorialSelection?: CityPulseEditorialSelection;
  coverageBundle?: ArticleCoverageBundle;
  publicVerification?: ArticlePublicVerification;
}

export interface CityPulseEditorialSelection {
  articleId: string;
  strategy: "best-source-v1";
  rationale: "newsroom_complete" | "official_complete" | "best_available";
}

export interface CityPulseStoryPage {
  items: CityPulseStory[];
  nextCursor?: string;
  projection?: CityPulseStoryProjection;
}

export interface CityPulseStoryProjection {
  mode: "legacy" | "normalized";
  generationId?: string;
  matcherVersion: "v1" | "v2";
  parityClean: boolean;
  projectionRevision?: number;
  fallbackReason?:
    | "disabled"
    | "no_completed_active_generation"
    | "integrity_error"
    | "parity_error";
}

export interface SituationPage {
  items: Situation[];
  nextCursor?: string;
}

export interface WorkerCycleMetrics {
  cycleStartedAt: string;
  cycleCompletedAt: string;
  cycleDurationMs: number;
  sourceDurationsMs: Record<string, number>;
  sourceItemCounts: Record<string, number>;
  parseFailures: Record<string, number>;
  coverage?: {
    matcherVersion: "v2";
    generationId: string;
    mode: "shadow" | "active";
    analysisDurationMs: number;
    articleCount: number;
    bundleCountByTier: { strong: number; moderate: number };
    edgeCountByTier: { strong: number; moderate: number; weak: number };
    reviewCandidateCount: number;
    correctionConflictCount: number;
  };
}

export type RuntimeFreshnessStatus = "ok" | "stale" | "missing";

export interface RuntimeFreshness {
  status: RuntimeFreshnessStatus;
  label: string;
  detail: string;
  checkedAt: string;
  staleAfterSeconds: number;
  completedAt?: string;
  ageSeconds?: number;
  startedAt?: string;
  durationSeconds?: number;
}

export type CommandCenterOperationsNoteKind =
  | "situation_progress"
  | "bundle_candidate"
  | "category_relevance"
  | "source_quality"
  | "other";

export interface CommandCenterOperationsNote {
  kind: CommandCenterOperationsNoteKind;
  subjectId: string;
  summary: string;
  citedClaims: Array<{
    claim: string;
    articleId: string;
    supportingSnippet: string;
  }>;
}

export interface CommandCenterBriefingPayload {
  generatedAt: string;
  morningBrief?: MorningBrief;
  latestAiRun?: RawInspectorAiRunSummary;
  operationsNotes: CommandCenterOperationsNote[];
  supportingArticles: CommandCenterBriefingArticleSummary[];
  supportingSituations: HomeSituationSummary[];
  sourceHealthSummary: {
    total: number;
    ok: number;
    attention: number;
    degraded: number;
    disabled: number;
    staleAlerts: number;
  };
  attentionSources: SourceHealth[];
}

export interface OperationsStatus {
  sources: SourceHealth[];
  articleCount: number;
  situationCounts: Record<SituationLifecycle, number>;
  situationPublicationCounts: Record<NonNullable<Situation["publicVisibility"]>, number>;
  latestAiRun?: Pick<AiProcessingRun, "provider" | "model" | "status" | "completedAt" | "error">;
  latestCollectionAt?: string;
  trafficPulse?: TrafficPulseCorridor[];
  workerCycleMetrics?: WorkerCycleMetrics;
  workerFreshness?: RuntimeFreshness;
  backup?: RuntimeFreshness;
  restoreCheck?: RuntimeFreshness;
}

export type UserRole = "owner" | "viewer";
export type UserStatus = "active" | "revoked";

export interface SessionUser {
  id: string;
  login: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  email?: string;
  avatarUrl?: string;
}

export interface SessionPayload {
  user: SessionUser;
  csrfToken: string;
  capabilities?: {
    coverageCorrections: boolean;
  };
}

export type AccessRequestStatus = "unverified" | "pending" | "approved" | "rejected";

export interface AccessRequestInput {
  displayName: string;
  email: string;
  message?: string;
}

export interface AccessRequest {
  id: string;
  displayName: string;
  email: string;
  message?: string;
  status: AccessRequestStatus;
  requestedAt: string;
  updatedAt: string;
  emailVerifiedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewerNote?: string;
}

export interface AccessRequestSubmissionResponse {
  status: "received";
}

export interface AccessRequestPage {
  items: AccessRequest[];
  summary: {
    total: number;
    unverified: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  nextCursor?: string;
}

export interface EmailLoginRequestInput {
  email: string;
}

export interface AccessRequestDecisionInput {
  status: "approved" | "rejected";
  reviewerNote?: string;
}

export interface AppUser {
  id: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  email?: string;
}

export interface UserPage {
  items: AppUser[];
  summary: {
    total: number;
    owner: number;
    viewer: number;
    active: number;
    revoked: number;
  };
}

export interface UserGrantInput {
  displayName: string;
  email: string;
}

export interface UserUpdateInput {
  status?: UserStatus;
  resendInvite?: boolean;
}
