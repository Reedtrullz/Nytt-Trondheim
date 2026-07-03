import { createHash, randomUUID } from "node:crypto";
import type {
  AccessRequest,
  AccessRequestDecisionInput,
  AccessRequestInput,
  AccessRequestPage,
  AccessRequestQueryInput,
  AccessRequestSubmissionResponse,
  AiAnalysisAttemptDiagnostics,
  AiAnalysisProfile,
  AiProcessingRunDiagnostics,
  AppUser,
  AiProcessingRun,
  Article,
  ArticleCoverageBundleConfidence,
  ArticleCoverageBundleDecision,
  ArticleCoverageBundleKind,
  ArticlePage,
  ArticleTopic,
  Attachment,
  BootstrapPayload,
  CityPulseStoryPage,
  CommandCenterBriefingArticleSummary,
  CommandCenterBriefingPayload,
  CommandCenterOperationsNote,
  CommandCenterSpatialAnalyticsQueryInput,
  CommandCenterTelemetryHistorySummary,
  CoverageBundleArticleSummary,
  CoverageBundleListItem,
  CoverageBundlePage,
  CoverageBundleQueryInput,
  CoverageBundleSummary,
  EvidenceItem,
  MapFeature,
  MorningBrief,
  NotificationSubscriptionPreference,
  NotificationTriggerPage,
  NotificationTriggerQueryInput,
  OfficialEvent,
  OperationsTimelineEvent,
  OperationsTimelineQuery,
  OperationsTimelineResponse,
  OperationsStatus,
  PrivateAnnotationUpdateRequest,
  PushDeliveryListItem,
  PushDeliveryPage,
  PushDeliveryStatus,
  PushNotificationSettings,
  PushSubscriptionInput,
  PushSubscriptionSummary,
  Provenance,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  RawInspectorAiRunDetail,
  RawInspectorAiRunFilters,
  RawInspectorAiRunPage,
  RawInspectorAiRunSummary,
  RawInspectorSourceItemDetail,
  RawInspectorTelemetryDetail,
  RawInspectorTelemetryFilters,
  RawInspectorTelemetryPage,
  RawInspectorTelemetrySummary,
  RawInspectorTelemetrySource,
  RoadCamera,
  RoadWeatherObservation,
  Situation,
  SituationPage,
  SituationWorkspace,
  SourceAuditFilterQuery,
  SourceAuditProviderGroup,
  SourceAuditRole,
  SourceAuditSourceSummary,
  SourceAuditWorkspaceResponse,
  SourceCollectorRun,
  SourceContractCheckStatus,
  SourceContractComplianceCheck,
  SourceConfidenceSummary,
  SourceFreshness,
  IncidentSourceTraceabilitySummary,
  SourceNonSecretDiagnostic,
  SourceReliabilityIndicator,
  SourceStaleDataAlert,
  SourceItem,
  SourceItemFilters,
  SourceItemPage,
  SourceItemRecord,
  SourceItemRelationship,
  SourceHealth,
  SourceId,
  UserUpdateInput,
  UserGrantInput,
  UserPage,
  TimelineEntry,
  TrafficCounterSnapshot,
  TrafficEventSeverity,
  TrafficMapEvent,
  TrafficPulseCorridor,
  UnexplainedDelayCandidate,
  TelemetryHistoryPattern,
  SpatialHeatmapCell,
  SpatialInvestigationQueueItem,
  WorkerCycleMetrics,
  WorkspaceNote,
  WorkspaceTask,
} from "@nytt/shared";
import {
  analyzeArticleCoverage,
  activationPolicyForSource,
  bootstrapWithMorningBrief,
  buildNotificationTriggerPage,
  cityPulseStoryFromGroup,
  derivePublicVerificationForArticleGroup,
  groupHomeArticles,
  isLocalSportsCoverageText,
  isNewsroomPublicVerificationSource,
  isPublicSituation,
  sampleArticles,
  sampleBootstrap,
  sampleNotes,
  sampleSituation,
  sampleTasks,
  sampleWorkspace,
  sourceIdLabel,
  sourceMixConfidenceSummary,
} from "@nytt/shared";
import pg from "pg";
import type { Profile } from "passport-github2";
import type { Point as GeoJsonPoint } from "geojson";
import type { AuthUser } from "./auth.js";
import { officialEventToTrafficMapEvent } from "./traffic/datex-normalizer.js";
import { findRelatedTrafficArticles } from "./traffic/related-articles.js";
import { roadClosingArticleTrafficEvents } from "./traffic/article-events.js";
import { buildCorridorImpacts } from "./traffic/corridor-impact.js";
import {
  buildSpatialInvestigationQueue,
  buildUnexplainedDelayCandidates,
} from "./traffic/spatial-analytics.js";

export interface ArticleFilters {
  scope?: string;
  category?: string;
  topic?: ArticleTopic;
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface SituationFilters {
  status?: Situation["status"];
  saved?: boolean;
  includeDismissed?: boolean;
  publicOnly?: boolean;
  cursor?: string;
  limit?: number;
}

type HomeSituationSummary = BootstrapPayload["situations"][number];

export interface OfficialEventFilters {
  source?: OfficialEvent["source"];
  states?: OfficialEvent["state"][];
  cursor?: string;
  limit?: number;
}

export interface TrafficMapEventFilters {
  sources?: TrafficMapEvent["source"][];
  categories?: TrafficMapEvent["category"][];
  severities?: TrafficMapEvent["severity"][];
  states?: TrafficMapEvent["state"][];
  from?: string;
  to?: string;
  bounds?: { north: number; south: number; east: number; west: number };
  limit?: number | null;
}

export type Bounds = TrafficMapEventFilters["bounds"];

type LimitedBoundsFilter = {
  bounds: NonNullable<Bounds>;
  limit?: number | null;
};

const nonSupportingSourceItemProviders = new Set<SourceItem["provider"]>([
  "bane_nor",
  "met",
  "nve",
  "datex_travel_time",
  "datex_weather",
  "datex_cctv",
  "trafikkdata",
  "vegvesen_traffic_info",
  "entur_vehicle_positions",
  "entur_service_alerts",
  "dsb",
]);

function sourceItemCanUseRelationship(
  item: Pick<SourceItem, "provider" | "kind">,
  relationship: SourceItemRelationship,
): boolean {
  if (relationship !== "supports") return true;
  if (item.provider === "entur" && item.kind === "official_event") return false;
  return !nonSupportingSourceItemProviders.has(item.provider);
}

function invalidSourceItemRelationshipError(): Error & { status: number } {
  return Object.assign(
    new Error("Kontekst- og telemetrikilder må kobles som kontekst, ikke som hendelsesgrunnlag."),
    { status: 400 },
  );
}

function articleMatchesTopic(article: Article, topic: ArticleTopic): boolean {
  if (article.topics !== undefined) return article.topics.includes(topic);
  if (topic === "rosenborg") {
    return (
      article.category === "Sport" &&
      /\b(?:rbk|rosenborgs?)\b/iu.test(`${article.title} ${article.excerpt}`)
    );
  }
  return false;
}

function articleMatchesCategory(article: Article, category: string): boolean {
  if (category === "Alle") return true;
  if (article.category === category) return true;
  return category === "Sport" && isLocalSportsCoverageText(`${article.title} ${article.excerpt}`);
}

function sportCategorySqlPredicate(categoryParam: string): string {
  return `(a.category = ${categoryParam}
    OR (
      a.category = 'Nyheter'
      AND (
        a.payload->>'title' ILIKE '%ranheim%'
        OR a.payload->>'excerpt' ILIKE '%ranheim%'
        OR a.payload->>'title' ILIKE '%rosenborg%'
        OR a.payload->>'excerpt' ILIKE '%rosenborg%'
        OR a.payload->>'title' ILIKE '%rbk%'
        OR a.payload->>'excerpt' ILIKE '%rbk%'
        OR a.payload->>'title' ILIKE '%kolstad%'
        OR a.payload->>'excerpt' ILIKE '%kolstad%'
        OR a.payload->>'title' ILIKE '%byåsen%'
        OR a.payload->>'excerpt' ILIKE '%byåsen%'
        OR a.payload->>'title' ILIKE '%nardo%'
        OR a.payload->>'excerpt' ILIKE '%nardo%'
        OR a.payload->>'title' ILIKE '%strindheim%'
        OR a.payload->>'excerpt' ILIKE '%strindheim%'
      )
      AND (
        a.payload->>'title' ILIKE '%bortesmell%'
        OR a.payload->>'excerpt' ILIKE '%bortesmell%'
        OR a.payload->>'title' ILIKE '%bortekompleks%'
        OR a.payload->>'excerpt' ILIKE '%bortekompleks%'
        OR a.payload->>'title' ILIKE '%bortetap%'
        OR a.payload->>'excerpt' ILIKE '%bortetap%'
        OR a.payload->>'title' ILIKE '%divisjon%'
        OR a.payload->>'excerpt' ILIKE '%divisjon%'
        OR a.payload->>'title' ILIKE '%fotball%'
        OR a.payload->>'excerpt' ILIKE '%fotball%'
        OR a.payload->>'title' ILIKE '%håndball%'
        OR a.payload->>'excerpt' ILIKE '%håndball%'
        OR a.payload->>'title' ILIKE '%kamp%'
        OR a.payload->>'excerpt' ILIKE '%kamp%'
        OR a.payload->>'title' ILIKE '%tapte%'
        OR a.payload->>'excerpt' ILIKE '%tapte%'
        OR a.payload->>'title' ~* '\\d+\\s*[–-]\\s*\\d+'
        OR a.payload->>'excerpt' ~* '\\d+\\s*[–-]\\s*\\d+'
      )
    ))`;
}

function rosenborgTopicSqlPredicate(topicParam: string): string {
  return `(COALESCE(a.payload->'topics', '[]'::jsonb) ? ${topicParam}
    OR (
      NOT (a.payload ? 'topics')
      AND (
        a.category = 'Sport'
        OR ${sportCategorySqlPredicate("'Sport'")}
      )
      AND (
        a.payload->>'title' ILIKE '%rosenborg%'
        OR a.payload->>'excerpt' ILIKE '%rosenborg%'
        OR a.payload->>'title' ILIKE '%rbk%'
        OR a.payload->>'excerpt' ILIKE '%rbk%'
      )
    ))`;
}

export interface AttachmentRecord extends Attachment {
  storagePath: string;
}

export interface ExportRecord {
  id: string;
  situationId: string;
  githubLogin: string;
  storagePath: string;
  payload: unknown;
  createdAt: string;
}

export interface Store {
  createAccessRequest(input: AccessRequestInput): Promise<AccessRequestSubmissionResult>;
  verifyAccessRequestToken(token: string): Promise<"verified" | "invalid">;
  listAccessRequests(filters: AccessRequestQueryInput, login: string): Promise<AccessRequestPage>;
  decideAccessRequest(
    id: string,
    input: AccessRequestDecisionInput,
    login: string,
  ): Promise<AccessRequestDecisionResult>;
  requestEmailLogin(email: string): Promise<EmailLoginRequestResult>;
  consumeEmailLoginToken(token: string): Promise<AuthUser | undefined>;
  listUsers(login: string): Promise<UserPage>;
  grantUserAccess(input: UserGrantInput, login: string): Promise<UserGrantResult>;
  updateUser(id: string, input: UserUpdateInput, login: string): Promise<UserUpdateResult>;
  ensureGitHubOwner(profile: Profile, allowedLogin: string): Promise<AuthUser | false>;
  getBootstrap(login: string): Promise<BootstrapPayload>;
  listArticles(filters: ArticleFilters, login: string): Promise<ArticlePage>;
  listCityPulseStories(filters: ArticleFilters, login: string): Promise<CityPulseStoryPage>;
  listCoverageBundles(
    filters: CoverageBundleQueryInput,
    login: string,
  ): Promise<CoverageBundlePage>;
  listNotificationTriggers(
    filters: NotificationTriggerQueryInput,
    login: string,
  ): Promise<NotificationTriggerPage>;
  getPushSettings(userId: string, publicKey?: string): Promise<PushNotificationSettings>;
  upsertPushSubscription(
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<PushSubscriptionSummary>;
  deletePushSubscription(userId: string, id: string): Promise<void>;
  listPushSubscriptionPreferences(login: string): Promise<NotificationSubscriptionPreference[]>;
  listPushDeliveries(limit: number, login: string): Promise<PushDeliveryPage>;
  listSourceItems(filters: SourceItemFilters, login: string): Promise<SourceItemPage>;
  getRawSourceItem(id: string, login: string): Promise<RawInspectorSourceItemDetail | undefined>;
  listRawTelemetry(
    filters: RawInspectorTelemetryFilters,
    login: string,
  ): Promise<RawInspectorTelemetryPage>;
  getRawTelemetryRecord(
    source: RawInspectorTelemetrySource,
    id: string,
    login: string,
  ): Promise<RawInspectorTelemetryDetail | undefined>;
  listRawAiRuns(filters: RawInspectorAiRunFilters, login: string): Promise<RawInspectorAiRunPage>;
  getRawAiRun(id: string, login: string): Promise<RawInspectorAiRunDetail | undefined>;
  listSpatialHeatmapCells(
    filters: CommandCenterSpatialAnalyticsQueryInput,
    login: string,
  ): Promise<SpatialHeatmapCell[]>;
  listOfficialEvents(filters: OfficialEventFilters, login: string): Promise<OfficialEvent[]>;
  listTrafficMapEvents(filters: TrafficMapEventFilters, login: string): Promise<TrafficMapEvent[]>;
  listPublicTransportVehicles(
    filters: LimitedBoundsFilter & {
      modes?: PublicTransportVehicle["mode"][];
    },
  ): Promise<PublicTransportVehicle[]>;
  listPublicTransportServiceAlerts(
    filters: LimitedBoundsFilter & {
      states?: PublicTransportServiceAlert["state"][];
    },
  ): Promise<PublicTransportServiceAlert[]>;
  listRoadWeatherObservations(bounds?: Bounds): Promise<RoadWeatherObservation[]>;
  listRoadCameras(bounds?: Bounds): Promise<RoadCamera[]>;
  listTrafficCounterSnapshots(bounds?: Bounds): Promise<TrafficCounterSnapshot[]>;
  listTrafficPulseCorridors(limit?: number): Promise<TrafficPulseCorridor[]>;
  getTrafficTelemetryHistorySummary(
    filters?: Pick<CommandCenterSpatialAnalyticsQueryInput, "from" | "to">,
  ): Promise<CommandCenterTelemetryHistorySummary>;
  listTrafficTelemetryPatterns(
    filters?: Pick<CommandCenterSpatialAnalyticsQueryInput, "from" | "to"> & { limit?: number },
  ): Promise<TelemetryHistoryPattern[]>;
  listSituationSourceItems(situationId: string, login: string): Promise<SourceItem[]>;
  linkSourceItem(
    situationId: string,
    sourceItemId: string,
    relationship: SourceItemRelationship,
    login: string,
  ): Promise<SourceItem | undefined>;
  unlinkSourceItem(situationId: string, sourceItemId: string, login: string): Promise<boolean>;
  listSavedArticles(login: string): Promise<Article[]>;
  setSaved(articleId: string, saved: boolean, login: string): Promise<boolean>;
  listSituations(filters: SituationFilters, login: string): Promise<SituationPage>;
  setSavedSituation(situationId: string, saved: boolean, login: string): Promise<boolean>;
  setSituationStatus(
    id: string,
    status: Situation["status"],
    dismissalReason?: Situation["dismissalReason"],
  ): Promise<Situation | undefined>;
  setSituationPublicVisibility(
    id: string,
    publicVisibility: NonNullable<Situation["publicVisibility"]>,
  ): Promise<Situation | undefined>;
  getWorkspace(id: string, login?: string): Promise<SituationWorkspace | undefined>;
  addPrivateFeature(situationId: string, feature: MapFeature): Promise<MapFeature>;
  updatePrivateFeature(
    situationId: string,
    featureId: string,
    patch: PrivateAnnotationUpdateRequest,
  ): Promise<MapFeature | undefined>;
  deletePrivateFeature(situationId: string, featureId: string): Promise<boolean>;
  addTask(situationId: string, text: string): Promise<WorkspaceTask>;
  toggleTask(
    situationId: string,
    taskId: string,
    completed: boolean,
  ): Promise<WorkspaceTask | undefined>;
  updateTaskText(
    situationId: string,
    taskId: string,
    text: string,
  ): Promise<WorkspaceTask | undefined>;
  deleteTask(situationId: string, taskId: string): Promise<boolean>;
  addNote(situationId: string, text: string): Promise<WorkspaceNote>;
  updateNote(situationId: string, noteId: string, text: string): Promise<WorkspaceNote | undefined>;
  deleteNote(situationId: string, noteId: string): Promise<boolean>;
  addAttachment(record: AttachmentRecord): Promise<Attachment>;
  getAttachment(id: string): Promise<AttachmentRecord | undefined>;
  deleteAttachment(situationId: string, id: string): Promise<AttachmentRecord | undefined>;
  recordExport(record: ExportRecord): Promise<void>;
  getExport(id: string, situationId: string, login: string): Promise<ExportRecord | undefined>;
  listSourceHealth(): Promise<SourceHealth[]>;
  listCollectorRuns(filters?: { source?: SourceId; limit?: number }): Promise<SourceCollectorRun[]>;
  getLatestWorkerCycleMetrics(): Promise<WorkerCycleMetrics | undefined>;
  getSourceAuditWorkspace(
    filters: SourceAuditFilterQuery,
    login: string,
  ): Promise<SourceAuditWorkspaceResponse>;
  getOperationsTimeline(
    filters: OperationsTimelineQuery,
    login: string,
  ): Promise<OperationsTimelineResponse>;
  getOperationsStatus(): Promise<OperationsStatus>;
  getCommandCenterBriefing(login: string): Promise<CommandCenterBriefingPayload>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function encodeCursor(timestamp: string, id: string): string {
  return Buffer.from(JSON.stringify([timestamp, id]), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { timestamp: string; id?: string } {
  if (!Number.isNaN(Date.parse(cursor))) return { timestamp: cursor };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      typeof parsed[1] === "string"
    ) {
      return { timestamp: parsed[0], id: parsed[1] };
    }
  } catch {
    // Validation below returns one stable client-facing error for malformed cursors.
  }
  throw new Error("Ugyldig sidepeker.");
}

function beforeCursor(
  timestamp: string,
  id: string,
  cursor?: { timestamp: string; id?: string },
): boolean {
  if (!cursor) return true;
  return (
    timestamp < cursor.timestamp ||
    (timestamp === cursor.timestamp && Boolean(cursor.id && id < cursor.id))
  );
}

function normalizeAccessRequestEmail(email: string): string {
  return email.trim().toLocaleLowerCase("nb");
}

function publicPrimaryLocationForSituation(
  situation: Situation,
): HomeSituationSummary["primaryLocation"] {
  const point = situation.features.find(
    (feature) =>
      feature.geometry.type === "Point" && feature.properties.provenance !== "private_annotation",
  );
  if (point?.geometry.type !== "Point") return undefined;
  const [lng, lat] = point.geometry.coordinates;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return undefined;
  }
  return {
    lat,
    lng,
    label: point.properties.label || situation.locationLabel,
  };
}

function publicSourceConfidenceForSituation(situation: Situation): SourceConfidenceSummary {
  if (situation.sourceConfidence) return situation.sourceConfidence;
  const sources = new Set<string>();
  if (situation.officialSource) sources.add(situation.officialSource);
  for (const source of situation.activationBasis?.sourceIds ?? []) sources.add(source);
  for (const summary of situation.provenanceSummary ?? []) {
    if (summary.provenance === "private_annotation") continue;
    for (const source of summary.sourceIds) sources.add(source);
  }
  for (const item of situation.evidence) sources.add(item.source);
  for (const item of situation.timeline) {
    if (item.kind === "private_annotation" || item.provenance === "private_annotation") continue;
    if (item.source) sources.add(item.source);
  }
  return sourceMixConfidenceSummary([...sources], { updatedAt: situation.updatedAt });
}

function homeSituationSummary(situation: Situation): HomeSituationSummary {
  const primaryLocation = publicPrimaryLocationForSituation(situation);
  return {
    id: situation.id,
    title: situation.title,
    summary: situation.summary,
    status: situation.status,
    verificationStatus: situation.verificationStatus,
    updatedAt: situation.updatedAt,
    createdAt: situation.createdAt,
    locationLabel: situation.locationLabel,
    sourceConfidence: publicSourceConfidenceForSituation(situation),
    ...(primaryLocation ? { primaryLocation } : {}),
  };
}

const accessVerificationTtlMs = 24 * 60 * 60 * 1000;
const inviteTtlMs = 7 * 24 * 60 * 60 * 1000;
const loginTtlMs = 15 * 60 * 1000;

type AuthTokenKind = "access_verify" | "invite" | "login";

export interface TokenDelivery {
  email: string;
  displayName: string;
  token: string;
}

export interface AccessRequestSubmissionResult extends AccessRequestSubmissionResponse {
  verification?: TokenDelivery;
}

export interface EmailLoginRequestResult extends AccessRequestSubmissionResponse {
  login?: TokenDelivery;
}

export interface AccessRequestDecisionResult {
  request: AccessRequest;
  invite?: TokenDelivery;
}

export interface UserGrantResult {
  user: AppUser;
  invite: TokenDelivery;
}

export interface UserUpdateResult {
  user: AppUser;
  invite?: TokenDelivery;
}

function newAuthToken(): string {
  return randomUUID() + "." + randomUUID();
}

function hashAuthToken(token: string): string {
  return sha256(token);
}

function pushEndpointHash(endpoint: string): string {
  return sha256(endpoint.trim());
}

function summarizePushDeliveries(items: PushDeliveryListItem[]): PushDeliveryPage["summary"] {
  return {
    total: items.length,
    sent: items.filter((item) => item.status === "sent").length,
    failed: items.filter((item) => item.status === "failed").length,
    claimed: items.filter((item) => item.status === "claimed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
  };
}

function expiresAt(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

type AccessRequestRow = {
  id: string;
  displayName: string;
  email: string;
  message?: string | null;
  status: AccessRequest["status"];
  requestedAt: Date | string;
  updatedAt: Date | string;
  emailVerifiedAt?: Date | string | null;
  reviewedAt?: Date | string | null;
  reviewedBy?: string | null;
  reviewerNote?: string | null;
};

type UserRow = {
  id: string;
  displayName: string;
  email?: string | null;
  role: AppUser["role"];
  status: AppUser["status"];
  createdAt: Date | string;
  updatedAt: Date | string;
  lastLoginAt?: Date | string | null;
};

type MemoryUserIdentity = {
  id: string;
  userId: string;
  provider: "github" | "email";
  providerSubject: string;
  createdAt: string;
  updatedAt: string;
};

type MemoryAuthToken = {
  id: string;
  tokenHash: string;
  kind: AuthTokenKind;
  accessRequestId?: string;
  userId?: string;
  email?: string;
  emailNormalized?: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
  createdBy?: string;
};

type MemoryPushSubscription = PushSubscriptionSummary & {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushSubscriptionRow = {
  id: string;
  endpointHash: string;
  enabled: boolean;
  minSeverity: PushSubscriptionSummary["minSeverity"];
  kinds: PushSubscriptionSummary["kinds"];
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastSeenAt: Date | string;
  lastSuccessAt?: Date | string | null;
  lastFailureAt?: Date | string | null;
  failureCount: number;
};

type PushDeliveryRow = {
  id: string;
  triggerId: string;
  subscriptionId: string;
  userId: string;
  status: PushDeliveryStatus;
  kind: PushDeliveryListItem["kind"];
  severity: PushDeliveryListItem["severity"];
  title: string;
  body: string;
  targetUrl?: string | null;
  errorMessage?: string | null;
  payload?: unknown;
  createdAt: Date | string;
  sentAt?: Date | string | null;
};

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type TelemetryHistorySummaryRow = {
  observations: string;
  tracked_entities: string;
  first_observed_at: Date | string | null;
  last_observed_at: Date | string | null;
  active_day_count: string;
  notable_observations: string;
};

type TelemetryHistoryPatternRow = {
  source: TelemetryHistoryPattern["source"];
  entity_id: string;
  title: string | null;
  observation_count: string;
  notable_observation_count: string;
  active_day_count: string;
  first_observed_at: Date | string | null;
  last_observed_at: Date | string | null;
  max_delay_seconds: number | string | null;
  max_anomaly_ratio: number | string | null;
  geometry: GeoJsonPoint | null;
};

type RawDatexTravelTimeRow = {
  id: string;
  name: string;
  state: TrafficPulseCorridor["state"];
  delay_seconds: number | string | null;
  measurement_to: Date | string | null;
  source_url: string;
  payload: unknown;
  updated_at: Date | string;
};

type RawDatexTravelTimeSummaryRow = Omit<RawDatexTravelTimeRow, "payload"> & {
  updated_at_cursor: string;
};

type RawTrafficCounterSnapshotRow = {
  point_id: string;
  payload: unknown;
  updated_at: Date | string;
  geometry: GeoJsonPoint | null;
};

type RawTrafficCounterSummaryRow = RawTrafficCounterSnapshotRow & {
  updated_at_cursor: string;
};

function telemetryHistorySummaryFromRow(
  row: TelemetryHistorySummaryRow | undefined,
): CommandCenterTelemetryHistorySummary["datexTravelTime"] {
  return {
    observations: Number(row?.observations ?? 0),
    trackedEntities: Number(row?.tracked_entities ?? 0),
    ...(row?.first_observed_at ? { firstObservedAt: isoString(row.first_observed_at) } : {}),
    ...(row?.last_observed_at ? { lastObservedAt: isoString(row.last_observed_at) } : {}),
    activeDayCount: Number(row?.active_day_count ?? 0),
    notableObservations: Number(row?.notable_observations ?? 0),
  };
}

function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const datexTravelTimeStateLabels: Record<TrafficPulseCorridor["state"], string> = {
  congested: "Kø",
  free_flow: "Fri flyt",
  slow: "Sakte trafikk",
  stale: "Foreldet",
};

function telemetryPayloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function telemetryPayloadNumber(payload: unknown, key: string): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function datexTravelTimeSummary(row: Pick<RawDatexTravelTimeRow, "delay_seconds" | "state">) {
  const delaySeconds = optionalNumber(row.delay_seconds);
  const delayMinutes =
    delaySeconds === undefined ? undefined : Math.max(1, Math.round(delaySeconds / 60));
  return [
    datexTravelTimeStateLabels[row.state] ?? row.state,
    delayMinutes !== undefined ? `${delayMinutes} min forsinkelse` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function rawDatexTravelTimeSummaryFromRow(
  row: RawDatexTravelTimeSummaryRow,
): RawInspectorTelemetrySummary {
  return {
    id: row.id,
    source: "datex_travel_time",
    title: row.name,
    updatedAt: isoString(row.updated_at),
    ...(row.measurement_to ? { observedAt: isoString(row.measurement_to) } : {}),
    sourceUrl: row.source_url,
    summary: datexTravelTimeSummary(row),
  };
}

function rawDatexTravelTimeDetailFromRow(row: RawDatexTravelTimeRow): RawInspectorTelemetryDetail {
  const payload = sanitizeRawPayload(row.payload);
  return {
    record: {
      id: row.id,
      source: "datex_travel_time",
      title: row.name,
      updatedAt: isoString(row.updated_at),
      ...(row.measurement_to ? { observedAt: isoString(row.measurement_to) } : {}),
      sourceUrl: row.source_url,
      summary: datexTravelTimeSummary(row),
    },
    payload: payload.value,
    payloadBytes: payload.bytes,
    redacted: payload.redacted,
    truncated: payload.truncated,
  };
}

function trafficCounterSummary(payload: unknown) {
  const volume = telemetryPayloadNumber(payload, "volumeLastHour");
  const anomalyRatio = telemetryPayloadNumber(payload, "anomalyRatio");
  const coverage = telemetryPayloadNumber(payload, "coveragePercent");
  return [
    volume !== undefined ? `${volume} kjøretøy siste time` : undefined,
    anomalyRatio !== undefined ? `${anomalyRatio.toFixed(1)}x normal trafikk` : undefined,
    coverage !== undefined ? `${Math.round(coverage)} % dekning` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function rawTrafficCounterSummaryFromRow(
  row: RawTrafficCounterSummaryRow,
): RawInspectorTelemetrySummary {
  return {
    id: row.point_id,
    source: "trafikkdata",
    title: telemetryPayloadString(row.payload, "name") ?? row.point_id,
    updatedAt: isoString(row.updated_at),
    observedAt: telemetryPayloadString(row.payload, "updatedAt") ?? isoString(row.updated_at),
    summary: trafficCounterSummary(row.payload),
  };
}

function rawTrafficCounterDetailFromRow(
  row: RawTrafficCounterSnapshotRow,
): RawInspectorTelemetryDetail {
  const payload = sanitizeRawPayload(row.payload);
  const title = telemetryPayloadString(row.payload, "name") ?? row.point_id;
  const observedAt = telemetryPayloadString(row.payload, "updatedAt") ?? isoString(row.updated_at);
  return {
    record: {
      id: row.point_id,
      source: "trafikkdata",
      title,
      updatedAt: isoString(row.updated_at),
      observedAt,
      summary: trafficCounterSummary(row.payload),
      ...(row.geometry ? { geometry: row.geometry } : {}),
    },
    payload: payload.value,
    payloadBytes: payload.bytes,
    redacted: payload.redacted,
    truncated: payload.truncated,
  };
}

function delayDescription(seconds: number | undefined): string {
  if (seconds === undefined) return "Gjentatt reisetidssignal i historikken.";
  return `Maks ${Math.max(1, Math.round(seconds / 60))} min forsinkelse i historikken.`;
}

function counterDescription(ratio: number | undefined): string {
  if (ratio === undefined) return "Gjentatt trafikktellersignal i historikken.";
  return `Maks ${ratio.toFixed(1)}x normal trafikk i historikken.`;
}

function telemetryHistoryPatternFromRow(row: TelemetryHistoryPatternRow): TelemetryHistoryPattern {
  const maxDelaySeconds = optionalNumber(row.max_delay_seconds);
  const maxAnomalyRatio = optionalNumber(row.max_anomaly_ratio);
  const title =
    row.title ??
    (row.source === "datex_travel_time"
      ? `DATEX reisetid ${row.entity_id}`
      : `Trafikkdata ${row.entity_id}`);
  return {
    id: `telemetry-pattern:${row.source}:${row.entity_id}`,
    source: row.source,
    title,
    description:
      row.source === "datex_travel_time"
        ? delayDescription(maxDelaySeconds)
        : counterDescription(maxAnomalyRatio),
    observationCount: Number(row.observation_count),
    notableObservationCount: Number(row.notable_observation_count),
    activeDayCount: Number(row.active_day_count),
    ...(row.first_observed_at ? { firstObservedAt: isoString(row.first_observed_at) } : {}),
    ...(row.last_observed_at ? { lastObservedAt: isoString(row.last_observed_at) } : {}),
    ...(maxDelaySeconds !== undefined ? { maxDelaySeconds } : {}),
    ...(maxAnomalyRatio !== undefined ? { maxAnomalyRatio } : {}),
    ...(row.geometry ? { geometry: row.geometry } : {}),
    sourceConfidence: sourceMixConfidenceSummary([row.source], {
      ...(row.last_observed_at ? { updatedAt: isoString(row.last_observed_at) } : {}),
    }),
  };
}

function accessRequestFromRow(row: AccessRequestRow): AccessRequest {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    ...(row.message ? { message: row.message } : {}),
    status: row.status,
    requestedAt: isoString(row.requestedAt),
    updatedAt: isoString(row.updatedAt),
    ...(row.emailVerifiedAt ? { emailVerifiedAt: isoString(row.emailVerifiedAt) } : {}),
    ...(row.reviewedAt ? { reviewedAt: isoString(row.reviewedAt) } : {}),
    ...(row.reviewedBy ? { reviewedBy: row.reviewedBy } : {}),
    ...(row.reviewerNote ? { reviewerNote: row.reviewerNote } : {}),
  };
}

function summarizeAccessRequests(items: AccessRequest[]): AccessRequestPage["summary"] {
  return {
    total: items.length,
    unverified: items.filter((item) => item.status === "unverified").length,
    pending: items.filter((item) => item.status === "pending").length,
    approved: items.filter((item) => item.status === "approved").length,
    rejected: items.filter((item) => item.status === "rejected").length,
  };
}

function appUserFromRow(row: UserRow): AppUser {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt),
    ...(row.email ? { email: row.email } : {}),
    ...(row.lastLoginAt ? { lastLoginAt: isoString(row.lastLoginAt) } : {}),
  };
}

function pushSubscriptionFromRow(row: PushSubscriptionRow): PushSubscriptionSummary {
  return {
    id: row.id,
    endpointHash: row.endpointHash,
    enabled: row.enabled,
    minSeverity: row.minSeverity,
    kinds: row.kinds ?? [],
    ...(row.userAgent ? { userAgent: row.userAgent } : {}),
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt),
    lastSeenAt: isoString(row.lastSeenAt),
    ...(row.lastSuccessAt ? { lastSuccessAt: isoString(row.lastSuccessAt) } : {}),
    ...(row.lastFailureAt ? { lastFailureAt: isoString(row.lastFailureAt) } : {}),
    failureCount: Number(row.failureCount),
  };
}

function pushDeliveryFromRow(row: PushDeliveryRow): PushDeliveryListItem {
  const payload = pushDeliveryPayloadSummary(row.payload);
  return {
    id: row.id,
    triggerId: row.triggerId,
    subscriptionId: row.subscriptionId,
    userId: row.userId,
    status: row.status,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    body: row.body,
    ...(row.targetUrl ? { targetUrl: row.targetUrl } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    ...payload,
    createdAt: isoString(row.createdAt),
    ...(row.sentAt ? { sentAt: isoString(row.sentAt) } : {}),
  };
}

function payloadStringArray(
  payload: Record<string, unknown>,
  key: string,
  maxItems = 20,
): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, maxItems);
}

const pushDeliveryConfidenceLevels = new Set<SourceConfidenceSummary["level"]>([
  "confirmed",
  "likely",
  "uncertain",
  "speculative",
]);

function pushDeliveryConfidenceSummary(value: unknown): SourceConfidenceSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.level !== "string" ||
    !pushDeliveryConfidenceLevels.has(record.level as SourceConfidenceSummary["level"])
  ) {
    return undefined;
  }
  const score =
    typeof record.score === "number" ? Math.max(0, Math.min(1, record.score)) : undefined;
  const sourceCount =
    typeof record.sourceCount === "number" && Number.isFinite(record.sourceCount)
      ? Math.max(0, Math.round(record.sourceCount))
      : undefined;
  return {
    level: record.level as SourceConfidenceSummary["level"],
    ...(score !== undefined ? { score } : {}),
    ...(sourceCount !== undefined ? { sourceCount } : {}),
    ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
    ...(typeof record.rationale === "string" ? { rationale: record.rationale.slice(0, 500) } : {}),
  };
}

function pushDeliveryPayloadSummary(payload: unknown): Partial<PushDeliveryListItem> {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  const score =
    typeof record.score === "number" ? Math.max(0, Math.min(1, record.score)) : undefined;
  const confidence = pushDeliveryConfidenceSummary(record.confidence);
  const sourceLabels = payloadStringArray(record, "sourceLabels");
  const matchedKeywords = payloadStringArray(record, "matchedKeywords");
  const reasons = payloadStringArray(record, "reasons");
  return {
    ...(score !== undefined ? { score } : {}),
    ...(confidence ? { confidence } : {}),
    ...(sourceLabels.length ? { sourceLabels } : {}),
    ...(matchedKeywords.length ? { matchedKeywords } : {}),
    ...(reasons.length ? { reasons } : {}),
  };
}

function authUserFromAppUser(user: AppUser): AuthUser {
  return {
    id: user.id,
    login: user.email ?? user.id,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    ...(user.email ? { email: user.email } : {}),
  };
}

function authorizeGitHubProfileForStore(
  profile: Pick<Profile, "username" | "displayName" | "photos">,
  allowedLogin: string,
): AuthUser | false {
  if (profile.username?.toLocaleLowerCase() !== allowedLogin.toLocaleLowerCase()) return false;
  return {
    id: `github:${profile.username.toLocaleLowerCase()}`,
    login: profile.username,
    displayName: profile.displayName || profile.username,
    role: "owner",
    status: "active",
    avatarUrl: profile.photos?.[0]?.value,
  };
}

function summarizeUsers(items: AppUser[]): UserPage["summary"] {
  return {
    total: items.length,
    owner: items.filter((item) => item.role === "owner").length,
    viewer: items.filter((item) => item.role === "viewer").length,
    active: items.filter((item) => item.status === "active").length,
    revoked: items.filter((item) => item.status === "revoked").length,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceItemHash(parts: unknown[]): string {
  return sha256(JSON.stringify(parts));
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sourceItemHash([provider, kind, stableKey])}`;
}

function memorySourceItemFromArticle(article: Article): SourceItemRecord {
  const normalizedPayload = {
    id: article.id,
    source: article.source,
    sourceLabel: article.sourceLabel,
    title: article.title,
    excerpt: article.excerpt,
    url: article.url,
    publishedAt: article.publishedAt,
    scope: article.scope,
    category: article.category,
    places: article.places,
    location: article.location,
  };
  const geoHint: SourceItem["geoHint"] = article.location
    ? { type: "Point", coordinates: [article.location.lng, article.location.lat] }
    : undefined;

  return {
    id: sourceItemId(article.source, "article", article.id),
    provider: article.source,
    kind: "article",
    externalId: article.id,
    originalUrl: article.url,
    title: article.title,
    summary: article.excerpt,
    publishedAt: article.publishedAt,
    fetchedAt: article.publishedAt,
    captureHash: sourceItemHash([
      article.source,
      "article",
      article.id,
      article.url,
      article.publishedAt,
      normalizedPayload,
    ]),
    inputHash: sourceItemHash([article.source, "article", article.id]),
    geoHint,
    reliabilityTier: article.source === "trondheim_kommune" ? "official" : "trusted_media",
    role: sourceItemRoleForProvider(article.source),
    linkedSituationIds: [],
    rawPayload: article,
    normalizedPayload,
  };
}

function sourceItemRoleForProvider(provider: SourceId): SourceItem["role"] {
  const role = activationPolicyForSource(provider).role;
  if (role === "activating_official" || role === "corroborating_official") return "official";
  if (role === "reporting") return "reporting";
  if (role === "context") return "context";
  if (role === "telemetry") return "telemetry";
  if (role === "private") return "private";
  if (provider === "deepseek") return "ai_summary";
  return "ignored";
}

function sourceLabelsForIds(sources: SourceId[]): string {
  return sources.map((source) => sourceIdLabel(source)).join(", ");
}

function publicVerificationForSituation(
  situation: Situation,
): Article["publicVerification"] | undefined {
  const officialSource = situation.officialSource;
  if (officialSource !== "datex" && officialSource !== "politiloggen") return undefined;
  if (situation.verificationStatus !== "Offentlig bekreftet") return undefined;
  if (situation.status !== "active" && situation.status !== "preliminary") return undefined;
  const hasOfficialEvidence = situation.evidence.some(
    (item) => item.source === officialSource && item.provenance === "official",
  );
  if (!hasOfficialEvidence) return undefined;
  const reportingSources = [
    ...new Set(
      situation.evidence
        .filter(
          (item) =>
            item.provenance === "reporting_estimate" &&
            isNewsroomPublicVerificationSource(item.source),
        )
        .map((item) => item.source),
    ),
  ];
  if (reportingSources.length === 0) return undefined;
  return {
    status: "verified",
    label: "Verifisert",
    detail: `Bekreftet av ${sourceIdLabel(officialSource)} og ${sourceLabelsForIds(reportingSources)}.`,
    officialSources: [officialSource],
    reportingSources,
    situationId: situation.id,
  };
}

function publicVerificationForTrafficOfficialEvent(
  event: TrafficMapEvent,
  reportingSources: SourceId[],
): Article["publicVerification"] | undefined {
  const newsroomSources = [
    ...new Set(reportingSources.filter((source) => isNewsroomPublicVerificationSource(source))),
  ];
  if (event.source !== "datex" || newsroomSources.length === 0) return undefined;
  return {
    status: "verified",
    label: "Verifisert",
    detail: `Bekreftet av ${sourceIdLabel("datex")} og ${sourceLabelsForIds(newsroomSources)}.`,
    officialSources: ["datex"],
    reportingSources: newsroomSources,
  };
}

function enrichArticlesWithCoverageGroupVerification(articles: Article[]): Article[] {
  if (articles.length < 2) return articles;
  const verificationByArticleId = new Map<string, Article["publicVerification"]>();
  for (const group of groupHomeArticles(articles)) {
    const verification = derivePublicVerificationForArticleGroup(group);
    if (!verification) continue;
    for (const article of group.articles) {
      if (!article.publicVerification) verificationByArticleId.set(article.id, verification);
    }
  }
  if (verificationByArticleId.size === 0) return articles;
  return articles.map((article) => {
    if (article.publicVerification) return article;
    const publicVerification = verificationByArticleId.get(article.id);
    return publicVerification ? { ...article, publicVerification } : article;
  });
}

function cityPulseStoryPageFromArticles(
  articles: Article[],
  filters: ArticleFilters,
): CityPulseStoryPage {
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
  const limit = filters.limit ?? 40;
  const stories = groupHomeArticles(articles)
    .map((group) => {
      const publicVerification =
        group.primary.publicVerification ??
        group.articles.find((article) => article.publicVerification)?.publicVerification ??
        derivePublicVerificationForArticleGroup(group);
      const story = cityPulseStoryFromGroup(group);
      return publicVerification ? { ...story, publicVerification } : story;
    })
    .filter((story) => beforeCursor(story.latestAt, story.id, cursor));
  const page = stories.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: stories.length > limit && last ? encodeCursor(last.latestAt, last.id) : undefined,
  };
}

function articlesFromCityPulseStoryPage(page: CityPulseStoryPage): Article[] {
  const seenArticleIds = new Set<string>();
  return page.items
    .flatMap((story) => {
      const articles = story.articles.length > 0 ? story.articles : [story.primary];
      return articles.map((article) => ({
        ...article,
        ...(story.coverageBundle && !article.coverageBundle
          ? { coverageBundle: story.coverageBundle }
          : {}),
        ...(story.publicVerification && !article.publicVerification
          ? { publicVerification: story.publicVerification }
          : {}),
      }));
    })
    .filter((article) => {
      if (seenArticleIds.has(article.id)) return false;
      seenArticleIds.add(article.id);
      return true;
    });
}

function cityPulseStorySourceLimit(filters: ArticleFilters): number {
  return Math.min(500, Math.max(100, (filters.limit ?? 40) * 5));
}

function articleOverlapsTrafficEvent(article: Article, event: TrafficMapEvent): boolean {
  const articleMs = Date.parse(article.publishedAt);
  if (!Number.isFinite(articleMs)) return false;
  const validFromMs = Date.parse(event.validFrom ?? event.updatedAt);
  if (Number.isFinite(validFromMs) && articleMs < validFromMs - 24 * 60 * 60 * 1000) {
    return false;
  }
  const validToMs = Date.parse(event.validTo ?? "");
  if (Number.isFinite(validToMs) && articleMs > validToMs + 48 * 60 * 60 * 1000) {
    return false;
  }
  return true;
}

function enrichArticlesWithTrafficOfficialVerification(
  articles: Article[],
  officialEvents: OfficialEvent[],
): Article[] {
  if (articles.length === 0 || officialEvents.length === 0) return articles;
  const candidateArticles = articles.filter(
    (article) =>
      !article.publicVerification &&
      article.category === "Transport" &&
      Boolean(article.location) &&
      isNewsroomPublicVerificationSource(article.source),
  );
  if (candidateArticles.length === 0) return articles;

  const verificationByArticleId = new Map<string, Article["publicVerification"]>();
  for (const officialEvent of officialEvents) {
    const event = officialEventToTrafficMapEvent(officialEvent);
    if (!event || event.state === "cancelled") continue;
    const timedCandidates = candidateArticles.filter((article) =>
      articleOverlapsTrafficEvent(article, event),
    );
    if (timedCandidates.length === 0) continue;
    const matches = findRelatedTrafficArticles(event, timedCandidates);
    const verification = publicVerificationForTrafficOfficialEvent(
      event,
      matches.map((match) => match.article.source),
    );
    if (!verification) continue;
    for (const match of matches) {
      verificationByArticleId.set(match.article.id, verification);
    }
  }
  if (verificationByArticleId.size === 0) return articles;
  return articles.map((article) => {
    const publicVerification = verificationByArticleId.get(article.id);
    return publicVerification ? { ...article, publicVerification } : article;
  });
}

function enrichArticlesWithSituations(articles: Article[], situations: Situation[]): Article[] {
  if (articles.length === 0 || situations.length === 0) return articles;
  const articleIds = new Set(articles.map((article) => article.id));
  const situationByArticleId = new Map<string, Situation>();
  for (const situation of [...situations].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )) {
    if (situation.status !== "active" && situation.status !== "preliminary") continue;
    for (const articleId of situation.relatedArticleIds) {
      if (!articleIds.has(articleId) || situationByArticleId.has(articleId)) continue;
      situationByArticleId.set(articleId, situation);
    }
  }
  if (situationByArticleId.size === 0) return articles;
  return articles.map((article) => {
    const situation = situationByArticleId.get(article.id);
    if (!situation) return article;
    const publicVerification = publicVerificationForSituation(situation);
    return {
      ...article,
      situationId: article.situationId ?? situation.id,
      ...(publicVerification ? { publicVerification } : {}),
    };
  });
}

function trafficMapEventSourceKey(event: TrafficMapEvent): string {
  return `${event.source}:${event.sourceEventId}`;
}

function sourceConfidenceForSpatialDelayCandidate(
  candidate: UnexplainedDelayCandidate,
): SourceConfidenceSummary {
  const sources = new Set<string>(["datex_travel_time"]);
  if (candidate.matchedArticleIds.length > 0) sources.add("news_article");
  if (candidate.affectedEventIds.length > 0) sources.add("vegvesen_traffic_info");
  return sourceMixConfidenceSummary([...sources], { updatedAt: candidate.updatedAt });
}

function buildSpatialNotificationItems(input: {
  articles: Article[];
  trafficInfoEvents: TrafficMapEvent[];
  officialEvents: OfficialEvent[];
  trafficPulse: TrafficPulseCorridor[];
  trafficCounters?: TrafficCounterSnapshot[];
}): SpatialInvestigationQueueItem[] {
  if (input.trafficPulse.length === 0 && !input.trafficCounters?.length) return [];

  const eventsBySourceKey = new Map<string, TrafficMapEvent>();
  for (const event of input.trafficInfoEvents) {
    eventsBySourceKey.set(trafficMapEventSourceKey(event), event);
  }
  for (const event of input.officialEvents) {
    const trafficEvent = officialEventToTrafficMapEvent(event);
    if (!trafficEvent || (trafficEvent.state !== "active" && trafficEvent.state !== "planned")) {
      continue;
    }
    eventsBySourceKey.set(trafficMapEventSourceKey(trafficEvent), trafficEvent);
  }

  const estimatedEvents = roadClosingArticleTrafficEvents(input.articles, {
    officialEvents: [...eventsBySourceKey.values()],
  });
  for (const event of estimatedEvents) {
    eventsBySourceKey.set(trafficMapEventSourceKey(event), event);
  }

  const corridorImpacts = buildCorridorImpacts([...eventsBySourceKey.values()], input.trafficPulse);
  const delayCandidates = buildUnexplainedDelayCandidates(corridorImpacts, input.articles, {
    minDelaySeconds: 180,
  })
    .slice(0, 20)
    .map((candidate) => ({
      ...candidate,
      sourceConfidence:
        candidate.sourceConfidence ?? sourceConfidenceForSpatialDelayCandidate(candidate),
    }));

  return buildSpatialInvestigationQueue(
    delayCandidates,
    [],
    input.articles,
    input.trafficCounters ?? [],
    { limit: 8 },
  );
}

interface SourceItemRow {
  id: string;
  provider: SourceItem["provider"];
  kind: SourceItem["kind"];
  external_id: string | null;
  original_url: string | null;
  title: string | null;
  summary: string | null;
  author: string | null;
  published_at: Date | string | null;
  fetched_at: Date | string;
  fetched_at_cursor: string;
  capture_hash: string;
  input_hash: string | null;
  geo_hint: SourceItem["geoHint"] | null;
  reliability_tier: SourceItem["reliabilityTier"];
  role: SourceItem["role"] | null;
  linked_situation_ids: string[] | null;
  relationship?: SourceItemRelationship | null;
}

interface SourceItemRecordRow extends SourceItemRow {
  raw_payload: unknown;
  normalized_payload: unknown;
}

interface AiProcessingRunRow {
  id: string;
  provider: AiProcessingRun["provider"];
  model: string;
  status: AiProcessingRun["status"];
  started_at: Date | string;
  completed_at: Date | string;
  completed_at_cursor: string;
  article_ids: unknown;
  result: unknown;
  error: string | null;
}

interface SpatialHeatmapCellRow {
  id: string;
  center_lng: number | string;
  center_lat: number | string;
  observation_count: string | number;
  source_item_count: string | number;
  source_item_ids: string[] | null;
  article_count: string | number;
  traffic_event_count: string | number;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  active_day_count: string | number;
  time_buckets: unknown;
  source_ids: string[] | null;
  severity_rank: number | string | null;
}

interface CoverageBundleRow {
  id: string;
  kind: ArticleCoverageBundleKind;
  confidence: ArticleCoverageBundleConfidence;
  reason: string;
  generated_at: Date | string;
  last_seen_at: Date | string;
  last_seen_at_cursor: string;
  primary_article_id: string;
  member_article_ids: string[];
  source_ids: SourceId[];
  source_labels: string[];
  signals: CoverageBundleListItem["signals"];
  near_misses: CoverageBundleListItem["nearMisses"];
  updated_at: Date | string;
}

function sourceItemFromRow(row: SourceItemRow): SourceItem {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    externalId: row.external_id ?? undefined,
    originalUrl: row.original_url ?? undefined,
    title: row.title ?? undefined,
    summary: row.summary ?? undefined,
    author: row.author ?? undefined,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    fetchedAt: new Date(row.fetched_at).toISOString(),
    captureHash: row.capture_hash,
    inputHash: row.input_hash ?? undefined,
    geoHint: row.geo_hint ?? undefined,
    reliabilityTier: row.reliability_tier,
    role: row.role ?? undefined,
    linkedSituationIds: row.linked_situation_ids ?? [],
    ...(row.relationship ? { relationship: row.relationship } : {}),
  };
}

function sourceItemSelectColumns(alias = "si"): string {
  return `${alias}.id, ${alias}.provider, ${alias}.kind, ${alias}.external_id, ${alias}.original_url,
       ${alias}.title, ${alias}.summary, ${alias}.author, ${alias}.published_at, ${alias}.fetched_at,
       to_char(${alias}.fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fetched_at_cursor,
       ${alias}.capture_hash, ${alias}.input_hash,
       ST_AsGeoJSON(${alias}.geo_hint)::json AS geo_hint, ${alias}.reliability_tier, ${alias}.role,
       links.linked_situation_ids`;
}

const rawPayloadMaxStringLength = 4000;
const rawPayloadMaxArrayLength = 100;
const rawPayloadMaxObjectKeys = 80;
const secretKeyPattern =
  /(?:api[_-]?key|authorization|bearer|cookie|password|passwd|secret|token|client[_-]?secret|smtp|datx|datex.*(?:user|pass|credential))/iu;

interface SanitizedPayload {
  value: unknown;
  redacted: boolean;
  truncated: boolean;
  bytes: number;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

function sanitizeRawPayload(value: unknown, depth = 0): SanitizedPayload {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return { value, redacted: false, truncated: false, bytes: jsonByteLength(value) };
  }
  if (typeof value === "string") {
    const truncated = value.length > rawPayloadMaxStringLength;
    const next = truncated ? `${value.slice(0, rawPayloadMaxStringLength)}... [truncated]` : value;
    return { value: next, redacted: false, truncated, bytes: jsonByteLength(value) };
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, rawPayloadMaxArrayLength)
      .map((item) => sanitizeRawPayload(item, depth + 1));
    const truncated =
      value.length > rawPayloadMaxArrayLength || items.some((item) => item.truncated);
    const redacted = items.some((item) => item.redacted);
    const next = items.map((item) => item.value);
    if (value.length > rawPayloadMaxArrayLength) {
      next.push(`[${value.length - rawPayloadMaxArrayLength} more items truncated]`);
    }
    return { value: next, redacted, truncated, bytes: jsonByteLength(value) };
  }
  if (typeof value === "object") {
    if (depth > 8) {
      return {
        value: "[object depth truncated]",
        redacted: false,
        truncated: true,
        bytes: jsonByteLength(value),
      };
    }
    const entries = Object.entries(value as Record<string, unknown>);
    const next: Record<string, unknown> = {};
    let redacted = false;
    let truncated = entries.length > rawPayloadMaxObjectKeys;
    for (const [key, entryValue] of entries.slice(0, rawPayloadMaxObjectKeys)) {
      if (secretKeyPattern.test(key)) {
        next[key] = "[redacted]";
        redacted = true;
        continue;
      }
      const sanitized = sanitizeRawPayload(entryValue, depth + 1);
      next[key] = sanitized.value;
      redacted ||= sanitized.redacted;
      truncated ||= sanitized.truncated;
    }
    if (entries.length > rawPayloadMaxObjectKeys) {
      next.__truncatedKeys = entries.length - rawPayloadMaxObjectKeys;
    }
    return { value: next, redacted, truncated, bytes: jsonByteLength(value) };
  }
  return { value: String(value), redacted: false, truncated: false, bytes: jsonByteLength(value) };
}

function rawSourceItemDetailFromRecord(record: SourceItemRecord): RawInspectorSourceItemDetail {
  const raw = sanitizeRawPayload(record.rawPayload);
  const normalized = sanitizeRawPayload(record.normalizedPayload);
  return {
    item: sourceItemFromRecord(record),
    rawPayload: raw.value,
    normalizedPayload: normalized.value,
    payloadBytes: {
      raw: raw.bytes,
      normalized: normalized.bytes,
    },
    redacted: raw.redacted || normalized.redacted,
    truncated: raw.truncated || normalized.truncated,
  };
}

function sourceItemFromRecord(record: SourceItemRecord): SourceItem {
  const item = { ...record };
  delete item.rawPayload;
  delete item.normalizedPayload;
  return item;
}

function sourceItemRecordFromRow(row: SourceItemRecordRow): SourceItemRecord {
  return {
    ...sourceItemFromRow(row),
    rawPayload: row.raw_payload,
    normalizedPayload: row.normalized_payload,
  };
}

function articleIdsFromAiRow(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      return articleIdsFromAiRow(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function isAiAnalysisProfile(value: unknown): value is AiAnalysisProfile {
  return value === "standard" || value === "compact_recovery" || value === "brief_only_recovery";
}

function aiRunDiagnosticsFromResult(result: unknown): AiProcessingRunDiagnostics | undefined {
  if (!result || typeof result !== "object" || !("diagnostics" in result)) return undefined;
  const diagnostics = (result as { diagnostics?: unknown }).diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return undefined;
  const candidate = diagnostics as { profile?: unknown; attempts?: unknown };
  if (!isAiAnalysisProfile(candidate.profile) || !Array.isArray(candidate.attempts)) {
    return undefined;
  }
  const attempts = candidate.attempts.flatMap((attempt): AiAnalysisAttemptDiagnostics[] => {
    if (!attempt || typeof attempt !== "object") return [];
    const row = attempt as {
      profile?: unknown;
      status?: unknown;
      maxTokens?: unknown;
      articleCount?: unknown;
      situationCount?: unknown;
      error?: unknown;
    };
    if (
      !isAiAnalysisProfile(row.profile) ||
      (row.status !== "ok" && row.status !== "failed") ||
      typeof row.maxTokens !== "number" ||
      typeof row.articleCount !== "number" ||
      typeof row.situationCount !== "number"
    ) {
      return [];
    }
    return [
      {
        profile: row.profile,
        status: row.status,
        maxTokens: row.maxTokens,
        articleCount: row.articleCount,
        situationCount: row.situationCount,
        ...(typeof row.error === "string" ? { error: compactText(row.error, 240) } : {}),
      },
    ];
  });
  return attempts.length ? { profile: candidate.profile, attempts } : undefined;
}

function rawAiRunSummaryFromRow(row: AiProcessingRunRow): RawInspectorAiRunSummary {
  const articleIds = articleIdsFromAiRow(row.article_ids);
  const diagnostics = aiRunDiagnosticsFromResult(row.result);
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    startedAt: new Date(row.started_at).toISOString(),
    completedAt: new Date(row.completed_at).toISOString(),
    articleCount: articleIds.length,
    ...(diagnostics ? { diagnostics } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function rawAiRunDetailFromRow(row: AiProcessingRunRow): RawInspectorAiRunDetail {
  const result = sanitizeRawPayload(row.result);
  return {
    ...rawAiRunSummaryFromRow(row),
    articleIds: articleIdsFromAiRow(row.article_ids),
    result: result.value,
    resultBytes: result.bytes,
    redacted: result.redacted,
    truncated: result.truncated,
  };
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function briefingArticleSummary(article: Article): CommandCenterBriefingArticleSummary {
  return {
    id: article.id,
    title: article.title,
    sourceLabel: article.sourceLabel,
    publishedAt: article.publishedAt,
    category: article.category,
    excerpt: compactText(article.excerpt, 220),
    ...(article.url ? { url: article.url } : {}),
  };
}

const optionalDerivedAnalysisSources = new Set<SourceId>(["deepseek"]);

function sourceRequiresOperationalAttention(source: SourceId): boolean {
  return !optionalDerivedAnalysisSources.has(source);
}

function sourceHasOperationalAttention(source: SourceHealth): boolean {
  return (
    sourceRequiresOperationalAttention(source.source) &&
    (source.state !== "ok" || Boolean(source.activeAlerts?.length))
  );
}

function briefingSourceHealthSummary(
  sources: SourceHealth[],
): CommandCenterBriefingPayload["sourceHealthSummary"] {
  const actionableSources = sources.filter((source) =>
    sourceRequiresOperationalAttention(source.source),
  );
  return {
    total: actionableSources.length,
    ok: actionableSources.filter((source) => source.state === "ok").length,
    attention: actionableSources.filter(sourceHasOperationalAttention).length,
    degraded: actionableSources.filter((source) => source.state === "degraded").length,
    disabled: actionableSources.filter((source) => source.state === "disabled").length,
    staleAlerts: actionableSources.reduce(
      (sum, source) => sum + (source.activeAlerts?.length ?? 0),
      0,
    ),
  };
}

function isOperationsNoteKind(value: unknown): value is CommandCenterOperationsNote["kind"] {
  return (
    value === "situation_progress" ||
    value === "bundle_candidate" ||
    value === "category_relevance" ||
    value === "source_quality" ||
    value === "other"
  );
}

function operationsNotesFromAiResult(result: unknown): CommandCenterOperationsNote[] {
  if (!result || typeof result !== "object" || !("operationsNotes" in result)) return [];
  const notes = (result as { operationsNotes?: unknown }).operationsNotes;
  if (!Array.isArray(notes)) return [];
  return notes.slice(0, 12).flatMap((note): CommandCenterOperationsNote[] => {
    if (!note || typeof note !== "object") return [];
    const candidate = note as {
      kind?: unknown;
      subjectId?: unknown;
      summary?: unknown;
      citedClaims?: unknown;
    };
    if (
      !isOperationsNoteKind(candidate.kind) ||
      typeof candidate.subjectId !== "string" ||
      typeof candidate.summary !== "string"
    ) {
      return [];
    }
    const citedClaims = Array.isArray(candidate.citedClaims)
      ? candidate.citedClaims.flatMap((claim): CommandCenterOperationsNote["citedClaims"] => {
          if (!claim || typeof claim !== "object") return [];
          const value = claim as {
            claim?: unknown;
            articleId?: unknown;
            supportingSnippet?: unknown;
          };
          if (
            typeof value.claim !== "string" ||
            typeof value.articleId !== "string" ||
            typeof value.supportingSnippet !== "string"
          ) {
            return [];
          }
          return [
            {
              claim: compactText(value.claim, 140),
              articleId: value.articleId,
              supportingSnippet: compactText(value.supportingSnippet, 180),
            },
          ];
        })
      : [];
    return [
      {
        kind: candidate.kind,
        subjectId: candidate.subjectId,
        summary: compactText(candidate.summary, 220),
        citedClaims,
      },
    ];
  });
}

function numericRowValue(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function severityFromRank(rank: number | string | null): TrafficEventSeverity | undefined {
  switch (Math.round(numericRowValue(rank))) {
    case 4:
      return "critical";
    case 3:
      return "high";
    case 2:
      return "medium";
    case 1:
      return "low";
    default:
      return undefined;
  }
}

function numericBucketValue(value: unknown): number {
  return numericRowValue(
    typeof value === "number" || typeof value === "string" || value === null ? value : undefined,
  );
}

function dateBucketValue(value: unknown): string | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function spatialHeatmapTimeBucketsFromRow(
  value: SpatialHeatmapCellRow["time_buckets"],
): NonNullable<SpatialHeatmapCell["timeBuckets"]> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((bucket) => {
    if (!bucket || typeof bucket !== "object") return [];
    const record = bucket as Record<string, unknown>;
    const bucketStart = dateBucketValue(record.bucketStart);
    if (!bucketStart) return [];
    return [
      {
        bucketStart,
        count: numericBucketValue(record.count),
        sourceItemCount: numericBucketValue(record.sourceItemCount),
        articleCount: numericBucketValue(record.articleCount),
        trafficEventCount: numericBucketValue(record.trafficEventCount),
      },
    ];
  });
}

function spatialHeatmapCellFromRow(row: SpatialHeatmapCellRow): SpatialHeatmapCell {
  const sourceIds = (row.source_ids ?? []).filter(
    (source): source is SpatialHeatmapCell["sourceIds"][number] => typeof source === "string",
  );
  const sourceItemIds = (row.source_item_ids ?? []).filter(
    (sourceItemId): sourceItemId is string => typeof sourceItemId === "string",
  );
  const maxSeverity = severityFromRank(row.severity_rank);
  const timeBuckets = spatialHeatmapTimeBucketsFromRow(row.time_buckets);
  return {
    id: row.id,
    center: {
      lng: numericRowValue(row.center_lng),
      lat: numericRowValue(row.center_lat),
    },
    radiusMeters: 650,
    count: numericRowValue(row.observation_count),
    sourceItemCount: numericRowValue(row.source_item_count),
    ...(sourceItemIds.length ? { sourceItemIds } : {}),
    articleCount: numericRowValue(row.article_count),
    trafficEventCount: numericRowValue(row.traffic_event_count),
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    activeDayCount: numericRowValue(row.active_day_count),
    ...(timeBuckets.length ? { timeBuckets } : {}),
    sourceIds,
    ...(maxSeverity ? { maxSeverity } : {}),
  };
}

function coverageBundleArticleSummary(article: Article): CoverageBundleArticleSummary {
  return {
    id: article.id,
    source: article.source,
    sourceLabel: article.sourceLabel,
    title: article.title,
    excerpt: article.excerpt,
    url: article.url,
    publishedAt: article.publishedAt,
    category: article.category,
    places: article.places,
    ...(article.location ? { location: article.location } : {}),
    ...(article.coverageBundle ? { coverageBundle: article.coverageBundle } : {}),
  };
}

function coverageBundleNearMissArticleSummaries(
  nearMisses: CoverageBundleListItem["nearMisses"],
  articlesById: Map<string, Article>,
): CoverageBundleArticleSummary[] {
  const articleIds = [...new Set(nearMisses.flatMap((nearMiss) => nearMiss.articleIds))];
  return articleIds.flatMap((articleId) => {
    const article = articlesById.get(articleId);
    return article ? [coverageBundleArticleSummary(article)] : [];
  });
}

function emptyCoverageBundleSummary(): CoverageBundleSummary {
  return {
    recentBundleCount: 0,
    byKind: { incident: 0, topic: 0, update: 0 },
    byConfidence: { high: 0, medium: 0 },
  };
}

function summarizeCoverageBundleItems(items: CoverageBundleListItem[]): CoverageBundleSummary {
  const summary = emptyCoverageBundleSummary();
  summary.recentBundleCount = items.length;
  for (const item of items) {
    summary.byKind[item.kind] += 1;
    summary.byConfidence[item.confidence] += 1;
    if (!summary.latestGeneratedAt || item.generatedAt > summary.latestGeneratedAt) {
      summary.latestGeneratedAt = item.generatedAt;
    }
  }
  return summary;
}

function coverageBundleMatchesQuery(item: CoverageBundleListItem, query: string): boolean {
  const haystack = [
    item.id,
    item.kind,
    item.confidence,
    item.reason,
    item.sourceLabels.join(" "),
    ...item.memberArticles.flatMap((article) => [
      article.title,
      article.excerpt,
      article.sourceLabel,
      article.places.join(" "),
    ]),
    ...item.nearMissArticles.flatMap((article) => [
      article.title,
      article.excerpt,
      article.sourceLabel,
      article.places.join(" "),
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase("nb");
  return haystack.includes(query.toLocaleLowerCase("nb"));
}

function filterCoverageBundleItems(
  items: CoverageBundleListItem[],
  filters: CoverageBundleQueryInput,
): CoverageBundleListItem[] {
  const query = filters.q?.trim();
  return items.filter(
    (item) =>
      (!filters.kind || item.kind === filters.kind) &&
      (!filters.confidence || item.confidence === filters.confidence) &&
      (!query || coverageBundleMatchesQuery(item, query)),
  );
}

function coverageBundleItemFromDecision(
  decision: ArticleCoverageBundleDecision,
  articlesById: Map<string, Article>,
  lastSeenAt: string,
  updatedAt: string,
): CoverageBundleListItem {
  return {
    ...decision,
    lastSeenAt,
    updatedAt,
    memberArticles: decision.memberArticleIds.flatMap((articleId) => {
      const article = articlesById.get(articleId);
      return article ? [coverageBundleArticleSummary(article)] : [];
    }),
    nearMissArticles: coverageBundleNearMissArticleSummaries(decision.nearMisses, articlesById),
  };
}

function coverageBundleItemFromRow(
  row: CoverageBundleRow,
  articlesById: Map<string, Article>,
): CoverageBundleListItem {
  const generatedAt = new Date(row.generated_at).toISOString();
  return {
    id: row.id,
    kind: row.kind,
    confidence: row.confidence,
    reason: row.reason,
    generatedAt,
    primaryArticleId: row.primary_article_id,
    memberArticleIds: row.member_article_ids,
    sourceIds: row.source_ids,
    sourceLabels: row.source_labels,
    signals: row.signals,
    nearMisses: row.near_misses,
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    memberArticles: row.member_article_ids.flatMap((articleId) => {
      const article = articlesById.get(articleId);
      return article ? [coverageBundleArticleSummary(article)] : [];
    }),
    nearMissArticles: coverageBundleNearMissArticleSummaries(row.near_misses, articlesById),
  };
}

const sourceAuditRequiredSources: SourceId[] = [
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
  "trondheim_kommune",
  "bane_nor",
  "met",
  "nve",
  "datex",
  "datex_travel_time",
  "datex_weather",
  "datex_cctv",
  "trafikkdata",
  "vegvesen_traffic_info",
  "entur",
  "entur_vehicle_positions",
  "entur_service_alerts",
  "dsb",
  "politiloggen",
  "internal",
  "deepseek",
  "web_push",
  "private_annotations",
];

const sourceAuditLabelFallbacks: Record<SourceId, string> = {
  nrk: "NRK Trøndelag",
  adressa: "Adresseavisen",
  avisa_st: "Avisa Sør-Trøndelag",
  snasningen: "Snåsningen",
  merakerposten: "Meråkerposten",
  frostingen: "Frostingen",
  ytringen: "Ytringen",
  steinkjer_avisa: "Steinkjer-Avisa",
  innherred: "Innherred",
  namdalsavisa: "Namdalsavisa",
  malviknytt: "Malviknytt",
  selbyggen: "Selbyggen",
  fjell_ljom: "Fjell-Ljom",
  retten: "Arbeidets Rett",
  hitra_froya: "Hitra-Frøya",
  tronderbladet: "Trønderbladet",
  nidaros: "Nidaros",
  t_a: "Trønder-Avisa",
  vg: "VG",
  dagbladet: "Dagbladet",
  trondheim_kommune: "Trondheim kommune",
  bane_nor: "Bane NOR",
  met: "MET farevarsel",
  nve: "NVE Varsom",
  datex: "Vegvesen DATEX",
  datex_travel_time: "Vegvesen reisetid",
  datex_weather: "Vegvesen værstasjoner",
  datex_cctv: "Vegvesen kamera",
  trafikkdata: "Vegvesen Trafikkdata",
  vegvesen_traffic_info: "Vegvesen TrafficInfo",
  entur: "Entur",
  entur_vehicle_positions: "Entur kjøretøyposisjoner",
  entur_service_alerts: "Entur trafikkavvik",
  dsb: "DSB",
  politiloggen: "Politiloggen",
  internal: "Interne vurderinger",
  private_annotations: "Private annotasjoner",
  deepseek: "AI-analyse",
  web_push: "Web Push",
};

const sourceAuditContractPaths: Partial<Record<SourceId, string>> = {
  nrk: "docs/source-contracts/media-rss.md",
  adressa: "docs/source-contracts/media-rss.md",
  avisa_st: "docs/source-contracts/media-rss.md",
  snasningen: "docs/source-contracts/media-frontpage.md",
  merakerposten: "docs/source-contracts/media-frontpage.md",
  frostingen: "docs/source-contracts/media-frontpage.md",
  ytringen: "docs/source-contracts/media-rss.md",
  steinkjer_avisa: "docs/source-contracts/media-frontpage.md",
  innherred: "docs/source-contracts/media-rss.md",
  namdalsavisa: "docs/source-contracts/media-frontpage.md",
  malviknytt: "docs/source-contracts/media-rss.md",
  selbyggen: "docs/source-contracts/media-frontpage.md",
  fjell_ljom: "docs/source-contracts/media-frontpage.md",
  retten: "docs/source-contracts/media-frontpage.md",
  hitra_froya: "docs/source-contracts/media-rss.md",
  tronderbladet: "docs/source-contracts/media-rss.md",
  nidaros: "docs/source-contracts/media-frontpage.md",
  t_a: "docs/source-contracts/media-frontpage.md",
  vg: "docs/source-contracts/media-rss.md",
  dagbladet: "docs/source-contracts/media-rss.md",
  bane_nor: "docs/source-contracts/bane-nor-rss.md",
  datex: "docs/source-contracts/datex-suite.md",
  datex_travel_time: "docs/source-contracts/datex-suite.md",
  datex_weather: "docs/source-contracts/datex-suite.md",
  datex_cctv: "docs/source-contracts/datex-suite.md",
  entur: "docs/source-contracts/entur.md",
  entur_vehicle_positions: "docs/source-contracts/entur.md",
  entur_service_alerts: "docs/source-contracts/entur.md",
  dsb: "docs/source-contracts/dsb-ogc.md",
  met: "docs/source-contracts/met-nve.md",
  nve: "docs/source-contracts/met-nve.md",
  politiloggen: "docs/source-contracts/politiloggen.md",
  trafikkdata: "docs/source-contracts/trafikkdata.md",
  trondheim_kommune: "docs/source-contracts/trondheim-kommune-aktuelt.md",
  vegvesen_traffic_info: "docs/source-contracts/vegvesen-trafficinfo.md",
};

const sourceAuditPolicy: Partial<
  Record<SourceId, { role: SourceAuditRole; provenance: Provenance }>
> = {
  bane_nor: { role: "context_source", provenance: "official" },
  dsb: { role: "context_source", provenance: "preparedness_context" },
  entur: { role: "context_source", provenance: "preparedness_context" },
  trondheim_kommune: { role: "incident_source", provenance: "official" },
  vegvesen_traffic_info: { role: "context_source", provenance: "official" },
};

function sourceAuditGroup(source: SourceId): SourceAuditProviderGroup {
  if (source.startsWith("datex") || source === "trafikkdata" || source === "vegvesen_traffic_info")
    return "datex";
  if (source.startsWith("entur")) return "entur";
  if (source === "politiloggen") return "politiloggen";
  if (source === "internal" || source === "deepseek" || source === "web_push") return "internal";
  if (source === "private_annotations") return "private_annotation";
  if (
    [
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
    ].includes(source)
  )
    return "media";
  return "other";
}

function sourceAuditRole(source: SourceId): SourceAuditRole {
  const policy = sourceAuditPolicy[source];
  if (policy) return policy.role;
  if (
    source === "datex_travel_time" ||
    source === "datex_weather" ||
    source === "datex_cctv" ||
    source === "trafikkdata" ||
    source === "entur_vehicle_positions"
  ) {
    return "telemetry_source";
  }
  if (source === "internal" || source === "deepseek" || source === "web_push")
    return "internal_analysis";
  if (source === "private_annotations") return "private_annotation";
  if (source === "met" || source === "nve" || source === "entur_service_alerts") {
    return "context_source";
  }
  return "incident_source";
}

function sourceAuditProvenance(source: SourceId): Provenance {
  const policy = sourceAuditPolicy[source];
  if (policy) return policy.provenance;
  const role = sourceAuditRole(source);
  if (role === "telemetry_source" || role === "context_source") return "preparedness_context";
  if (role === "private_annotation" || role === "internal_analysis") return "private_annotation";
  if (source === "datex" || source === "politiloggen") return "official";
  return "reporting_estimate";
}

const softDeepSeekOutputFailureMarkers = [
  "truncated by token limit",
  "returned empty json content",
  "returned no json object",
  "syntaxerror",
  "unexpected end of json input",
  "unexpected token",
  "invalid_enum_value",
  "invalid_type",
  "invalid_literal",
  "invalid_union",
  "unrecognized_keys",
  "too_small",
  "too_big",
];

function isSoftDeepSeekOutputFailure(error: string | undefined): boolean {
  const normalized = error?.toLocaleLowerCase("en") ?? "";
  return softDeepSeekOutputFailureMarkers.some((marker) => normalized.includes(marker));
}

function isSoftDeepSeekCollectorRun(run: SourceCollectorRun | undefined): boolean {
  return (
    run?.source === "deepseek" &&
    (run.status === "failed" || run.status === "partial") &&
    isSoftDeepSeekOutputFailure(run.errorMessage)
  );
}

function deepSeekFallbackDetail(): string {
  return "Strukturert AI-respons ble forkastet; deterministisk gruppering og reservebrief brukes fortsatt.";
}

function sourceAuditTimestampInRange(
  value: string | undefined,
  filters: Pick<SourceAuditFilterQuery, "from" | "to">,
): boolean {
  if (!filters.from && !filters.to) return true;
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  if (filters.from && timestamp < Date.parse(filters.from)) return false;
  if (filters.to && timestamp > Date.parse(filters.to)) return false;
  return true;
}

function sourceAuditRunInRange(
  run: SourceCollectorRun,
  filters: Pick<SourceAuditFilterQuery, "from" | "to">,
): boolean {
  return sourceAuditTimestampInRange(run.completedAt ?? run.startedAt, filters);
}

function sourceAuditItemInRange(
  item: SourceItem,
  filters: Pick<SourceAuditFilterQuery, "from" | "to">,
): boolean {
  return sourceAuditTimestampInRange(item.publishedAt ?? item.fetchedAt, filters);
}

function traceabilityInRange(
  trace: IncidentSourceTraceabilitySummary,
  filters: Pick<SourceAuditFilterQuery, "from" | "to">,
): boolean {
  if (!filters.from && !filters.to) return true;
  return (
    sourceAuditTimestampInRange(trace.updatedAt, filters) ||
    trace.links.some((link) =>
      sourceAuditTimestampInRange(link.publishedAt ?? link.fetchedAt, filters),
    )
  );
}

function latestRunBySource(runs: SourceCollectorRun[]): Map<SourceId, SourceCollectorRun> {
  const latest = new Map<SourceId, SourceCollectorRun>();
  for (const run of runs) {
    const current = latest.get(run.source);
    if (!current || run.startedAt > current.startedAt) latest.set(run.source, run);
  }
  return latest;
}

function sourceFreshness(
  health: SourceHealth | undefined,
  latestRun: SourceCollectorRun | undefined,
  generatedAt: string,
): SourceFreshness {
  const expectedIntervalSeconds = 2 * 60 * 60;
  const staleAfterSeconds = 6 * 60 * 60;
  const lastObservedAt = latestRun?.completedAt ?? health?.lastCheckedAt;
  const ageSeconds = lastObservedAt
    ? Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(lastObservedAt)) / 1000))
    : undefined;
  const state =
    health?.state === "disabled" || health?.state === "awaiting_access" || ageSeconds === undefined
      ? "unknown"
      : ageSeconds > staleAfterSeconds
        ? "stale"
        : ageSeconds > expectedIntervalSeconds
          ? "lagging"
          : "fresh";

  return {
    state,
    checkedAt: health?.lastCheckedAt ?? generatedAt,
    ...(lastObservedAt ? { lastObservedAt } : {}),
    ...(health?.lastCheckedAt ? { lastFetchedAt: health.lastCheckedAt } : {}),
    ...(latestRun?.completedAt ? { lastSuccessfulRunAt: latestRun.completedAt } : {}),
    ...(health?.nextPollAt ? { nextPollAt: health.nextPollAt } : {}),
    expectedIntervalSeconds,
    staleAfterSeconds,
    ...(ageSeconds !== undefined ? { ageSeconds } : {}),
    detail: health?.detail ?? "Ingen kildehelse registrert ennå.",
  };
}

function sourceReliability(
  source: SourceId,
  health: SourceHealth | undefined,
  latestRun: SourceCollectorRun | undefined,
  generatedAt: string,
): SourceReliabilityIndicator[] {
  const failures = latestRun?.recordsRejected ?? 0;
  const state = health?.state;
  const softDeepSeekOutputFailure = state === "ok" && isSoftDeepSeekCollectorRun(latestRun);
  const effectiveFailures = softDeepSeekOutputFailure ? 0 : failures;
  const level =
    state === "degraded" || effectiveFailures > 0
      ? effectiveFailures > 2
        ? "poor"
        : "watch"
      : state === "ok"
        ? "good"
        : "unknown";
  const score =
    level === "good" ? 0.95 : level === "watch" ? 0.68 : level === "poor" ? 0.35 : undefined;
  return [
    {
      id: `${source}:health-reliability`,
      source,
      label: "Driftssignal",
      level,
      ...(score !== undefined ? { score } : {}),
      sampleSize: latestRun?.recordsSeen ?? 0,
      updatedAt: health?.lastCheckedAt ?? latestRun?.completedAt ?? generatedAt,
      detail: softDeepSeekOutputFailure
        ? deepSeekFallbackDetail()
        : failures > 0
          ? `${failures} avvik i siste registrerte innhenting.`
          : (health?.detail ?? "Basert på kildehelse og siste worker-metrikk."),
    },
  ];
}

function sourceDiagnostics(
  source: SourceId,
  health: SourceHealth | undefined,
  latestRun: SourceCollectorRun | undefined,
  generatedAt: string,
): SourceNonSecretDiagnostic[] {
  const observedAt = health?.lastCheckedAt ?? latestRun?.completedAt ?? generatedAt;
  return [
    {
      key: `${source}:health_state`,
      label: "Kildestatus",
      kind: "scheduler",
      severity: health?.state === "ok" ? "info" : health?.state === "degraded" ? "warning" : "info",
      safeForDisplay: true,
      value: health?.state ?? "unknown",
      unit: "status",
      observedAt,
      detail: health?.detail ?? "Ingen operasjonell kildestatus registrert.",
    },
    ...(latestRun
      ? [
          {
            key: `${source}:latest_duration_ms`,
            label: "Siste innhentingstid",
            kind: "latency" as const,
            severity:
              latestRun.status === "failed" && !isSoftDeepSeekCollectorRun(latestRun)
                ? ("error" as const)
                : ("info" as const),
            safeForDisplay: true as const,
            value: latestRun.durationMs ?? 0,
            unit: "ms" as const,
            observedAt: latestRun.completedAt ?? latestRun.startedAt,
            detail: isSoftDeepSeekCollectorRun(latestRun)
              ? deepSeekFallbackDetail()
              : `${latestRun.recordsAccepted} akseptert, ${latestRun.recordsRejected} avvist.`,
          },
        ]
      : []),
  ];
}

function sourceContractChecks(
  source: SourceId,
  health: SourceHealth | undefined,
  generatedAt: string,
): SourceContractComplianceCheck[] {
  const role = sourceAuditRole(source);
  const checks: SourceContractComplianceCheck[] = [];
  const contractPath = sourceAuditContractPaths[source];
  checks.push({
    id: `${source}:source-contract`,
    source,
    kind: "source_contract",
    status: contractPath ? "pass" : role === "incident_source" ? "warn" : "not_applicable",
    label: "Kildekontrakt",
    checkedAt: generatedAt,
    detail: contractPath
      ? "Kilden har eksplisitt kontrakt før adapterbruk."
      : role === "incident_source"
        ? "Ingen egen kildekontrakt registrert for denne etablerte kilden."
        : "Intern eller operasjonell kontekst uten ny ekstern adapter.",
    ...(contractPath ? { contractPath } : {}),
  });
  checks.push({
    id: `${source}:secret-hygiene`,
    source,
    kind: "secret_hygiene",
    status: "pass",
    label: "Hemmeligheter",
    checkedAt: generatedAt,
    detail:
      source.startsWith("datex") && health?.state === "awaiting_access"
        ? "Tilgang mangler, men ingen credential-verdier eksponeres."
        : "Auditflaten viser bare status, tider og tellinger.",
  });
  checks.push({
    id: `${source}:activation-policy`,
    source,
    kind: "activation_policy",
    status: role === "telemetry_source" ? "pass" : "not_applicable",
    label: "Aktiveringsregel",
    checkedAt: generatedAt,
    detail:
      role === "telemetry_source"
        ? "Telemetrikilden brukes som kontekst og skal ikke aktivere situasjoner alene."
        : "Ikke en telemetrikilde med særskilt aktiveringsvern.",
  });
  return checks;
}

function worstContractStatus(checks: SourceContractComplianceCheck[]): SourceContractCheckStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  if (checks.some((check) => check.status === "pass")) return "pass";
  return "not_applicable";
}

function staleAlertForSource(
  source: SourceId,
  label: string,
  health: SourceHealth | undefined,
  freshness: SourceFreshness,
  generatedAt: string,
): SourceStaleDataAlert | undefined {
  if (!sourceRequiresOperationalAttention(source)) return undefined;
  const healthAlert = health && health.state !== "ok";
  const staleAlert = freshness.state === "stale" || freshness.state === "lagging";
  if (!healthAlert && !staleAlert) return undefined;
  const severity =
    health?.state === "degraded" || freshness.state === "stale"
      ? "critical"
      : health?.state === "awaiting_access"
        ? "warning"
        : "watch";
  return {
    id: `${source}:freshness`,
    source,
    severity,
    status: "open",
    firstSeenAt: health?.lastFailureAt ?? freshness.lastObservedAt ?? generatedAt,
    lastSeenAt: generatedAt,
    ...(freshness.lastObservedAt ? { lastFreshAt: freshness.lastObservedAt } : {}),
    expectedFreshnessSeconds: freshness.staleAfterSeconds ?? 6 * 60 * 60,
    ageSeconds: freshness.ageSeconds ?? 0,
    message:
      health?.state === "awaiting_access"
        ? `${label} venter på tilgang.`
        : freshness.state === "stale"
          ? `${label} har ikke ferske data innen forventet vindu.`
          : (health?.detail ?? `${label} trenger tilsyn.`),
  };
}

function traceabilityForSituation(
  workspace: SituationWorkspace,
  sourceItems: SourceItem[],
): IncidentSourceTraceabilitySummary {
  const { situation } = workspace;
  const links: IncidentSourceTraceabilitySummary["links"] = [];
  for (const source of situation.activationBasis?.sourceIds ?? []) {
    links.push({
      source,
      provenance: sourceAuditProvenance(source),
      relationship: "activation",
      publishedAt: situation.activationBasis?.activatedAt,
    });
  }
  for (const evidence of situation.evidence) {
    links.push({
      source: evidence.source,
      provenance: evidence.provenance,
      relationship: "supports",
      evidenceId: evidence.id,
      confidence: evidence.confidenceSummary,
      publishedAt: evidence.publishedAt,
    });
  }
  for (const item of sourceItems) {
    links.push({
      source: item.provider,
      provenance: sourceAuditProvenance(item.provider),
      relationship: item.relationship ?? "context",
      sourceItemId: item.id,
      confidence: item.confidence,
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
    });
  }
  for (const entry of situation.timeline) {
    if (!entry.source) continue;
    links.push({
      source: entry.source,
      provenance: entry.provenance ?? sourceAuditProvenance(entry.source),
      relationship: "timeline",
      confidence: entry.confidence,
      publishedAt: entry.timestamp,
    });
  }
  for (const feature of situation.features) {
    if (feature.properties.provenance !== "private_annotation") continue;
    links.push({
      source: "private_annotations",
      provenance: "private_annotation",
      relationship: "private_annotation",
      privateAnnotationId: feature.id,
      publishedAt: feature.properties.updatedAt,
    });
  }

  const provenanceCounts: Partial<Record<Provenance, number>> = {};
  for (const link of links)
    provenanceCounts[link.provenance] = (provenanceCounts[link.provenance] ?? 0) + 1;
  const primarySources = [...new Set(links.map((link) => link.source))];
  const missingLinks =
    links.length === 0
      ? [{ kind: "source_item" as const, reason: "Ingen kildekoblinger registrert." }]
      : undefined;

  return {
    situationId: situation.id,
    title: situation.title,
    status: situation.status,
    updatedAt: situation.updatedAt,
    traceabilityState: missingLinks ? "missing" : sourceItems.length === 0 ? "partial" : "complete",
    sourceCount: primarySources.length,
    evidenceCount: situation.evidence.length,
    sourceItemCount: sourceItems.length,
    privateAnnotationCount: links.filter((link) => link.relationship === "private_annotation")
      .length,
    primarySources,
    ...(situation.activationBasis?.sourceIds
      ? { activationSourceIds: situation.activationBasis.sourceIds }
      : {}),
    ...(situation.officialSource ? { officialSource: situation.officialSource } : {}),
    provenanceCounts,
    links,
    ...(missingLinks ? { missingLinks } : {}),
  };
}

interface SourceAuditReadableStore {
  listSourceHealth(): Promise<SourceHealth[]>;
  listCollectorRuns(filters?: { source?: SourceId; limit?: number }): Promise<SourceCollectorRun[]>;
  listSourceItems(filters: SourceItemFilters, login: string): Promise<SourceItemPage>;
  listSituations(filters: SituationFilters, login: string): Promise<SituationPage>;
  listSituationSourceItems(situationId: string, login: string): Promise<SourceItem[]>;
  getWorkspace(id: string, login?: string): Promise<SituationWorkspace | undefined>;
}

async function buildSourceAuditWorkspace(
  store: SourceAuditReadableStore,
  filters: SourceAuditFilterQuery,
  login: string,
): Promise<SourceAuditWorkspaceResponse> {
  const generatedAt = new Date().toISOString();
  const [sourceHealth, collectorRuns, sourceItemPage, situationPage] = await Promise.all([
    store.listSourceHealth(),
    store.listCollectorRuns({ limit: 500 }),
    store.listSourceItems({ limit: 100 }, login),
    store.listSituations({ includeDismissed: true, limit: 100 }, login),
  ]);
  const collectorRunsInRange = collectorRuns.filter((run) => sourceAuditRunInRange(run, filters));
  const sourceItemsInRange = sourceItemPage.items.filter((item) =>
    sourceAuditItemInRange(item, filters),
  );
  const healthBySource = new Map(sourceHealth.map((health) => [health.source, health]));
  const latestRuns = latestRunBySource(collectorRunsInRange);
  const traceability = (
    await Promise.all(
      situationPage.items.map(async (situation) => {
        const [workspace, sourceItems] = await Promise.all([
          store.getWorkspace(situation.id, login),
          store.listSituationSourceItems(situation.id, login),
        ]);
        return workspace ? traceabilityForSituation(workspace, sourceItems) : undefined;
      }),
    )
  ).filter(
    (entry): entry is IncidentSourceTraceabilitySummary =>
      entry !== undefined && traceabilityInRange(entry, filters),
  );

  const sourceIds = new Set<SourceId>(sourceAuditRequiredSources);
  for (const health of sourceHealth) sourceIds.add(health.source);
  for (const run of collectorRunsInRange) sourceIds.add(run.source);
  for (const item of sourceItemsInRange) sourceIds.add(item.provider);
  for (const trace of traceability) {
    for (const source of trace.primarySources) sourceIds.add(source);
  }

  const allContractChecks: SourceContractComplianceCheck[] = [];
  const allDiagnostics: SourceNonSecretDiagnostic[] = [];
  const alerts: SourceStaleDataAlert[] = [];
  const summaries: SourceAuditSourceSummary[] = [...sourceIds].map((source) => {
    const health = healthBySource.get(source);
    const latestRun = latestRuns.get(source);
    const freshness = sourceFreshness(health, latestRun, generatedAt);
    const reliability = sourceReliability(source, health, latestRun, generatedAt);
    const diagnostics = sourceDiagnostics(source, health, latestRun, generatedAt);
    const contractChecks = sourceContractChecks(source, health, generatedAt);
    const alert = staleAlertForSource(
      source,
      health?.label ?? sourceAuditLabelFallbacks[source],
      health,
      freshness,
      generatedAt,
    );
    allContractChecks.push(...contractChecks);
    allDiagnostics.push(...diagnostics);
    if (alert) alerts.push(alert);
    const sourceTraces = traceability.filter((trace) =>
      trace.links.some((link) => link.source === source),
    );

    return {
      source,
      label: health?.label ?? sourceAuditLabelFallbacks[source],
      group: sourceAuditGroup(source),
      role: sourceAuditRole(source),
      provenance: sourceAuditProvenance(source),
      healthState: health?.state ?? "disabled",
      freshness,
      reliability,
      ...(latestRun ? { latestRun } : {}),
      openAlertCount: alert ? 1 : 0,
      criticalAlertCount: alert?.severity === "critical" ? 1 : 0,
      contractStatus: worstContractStatus(contractChecks),
      ...(sourceTraces[0]?.updatedAt ? { lastIncidentTraceAt: sourceTraces[0].updatedAt } : {}),
    };
  });

  const q = filters.q?.toLocaleLowerCase("nb");
  const filteredSources = summaries
    .filter((source) => {
      if (filters.sources?.length && !filters.sources.includes(source.source)) return false;
      if (filters.groups?.length && !filters.groups.includes(source.group)) return false;
      if (filters.roles?.length && !filters.roles.includes(source.role)) return false;
      if (filters.provenances?.length && !filters.provenances.includes(source.provenance))
        return false;
      if (filters.healthStates?.length && !filters.healthStates.includes(source.healthState))
        return false;
      if (
        filters.freshnessStates?.length &&
        !filters.freshnessStates.includes(source.freshness.state)
      )
        return false;
      if (
        filters.reliabilityLevels?.length &&
        !source.reliability.some((item) => filters.reliabilityLevels?.includes(item.level))
      )
        return false;
      if (
        filters.contractStatuses?.length &&
        !filters.contractStatuses.includes(source.contractStatus)
      )
        return false;
      if (filters.staleOnly && source.openAlertCount === 0 && source.freshness.state === "fresh")
        return false;
      if (
        q &&
        !`${source.source} ${source.label} ${source.freshness.detail ?? ""}`
          .toLocaleLowerCase("nb")
          .includes(q)
      )
        return false;
      return true;
    })
    .sort((left, right) => left.source.localeCompare(right.source));
  const cursorFilteredSources = filters.cursor
    ? filteredSources.filter((source) => source.source > filters.cursor!)
    : filteredSources;
  const limit = filters.limit ?? 40;
  const pagedSources = cursorFilteredSources.slice(0, limit);
  const visibleSourceIds = new Set(pagedSources.map((source) => source.source));
  const visibleAlerts = alerts.filter(
    (alert) =>
      visibleSourceIds.has(alert.source) &&
      sourceAuditTimestampInRange(alert.lastSeenAt, filters) &&
      (!filters.alertSeverities?.length || filters.alertSeverities.includes(alert.severity)) &&
      (filters.includeResolvedAlerts || alert.status !== "resolved"),
  );
  const visibleTraceability = traceability.filter((trace) =>
    trace.links.some((link) => visibleSourceIds.has(link.source)),
  );
  const visibleChecks = allContractChecks.filter(
    (check) =>
      visibleSourceIds.has(check.source) && sourceAuditTimestampInRange(check.checkedAt, filters),
  );
  const visibleRuns = collectorRunsInRange.filter((run) => visibleSourceIds.has(run.source));
  const nextCursor = cursorFilteredSources.length > limit ? pagedSources.at(-1)?.source : undefined;

  return {
    generatedAt,
    filters,
    sources: pagedSources,
    collectorRuns: visibleRuns,
    alerts: visibleAlerts,
    contractChecks: visibleChecks,
    traceability: visibleTraceability,
    ...(nextCursor ? { nextCursor } : {}),
    ...(filters.includeDiagnostics
      ? {
          diagnostics: allDiagnostics.filter(
            (diagnostic) =>
              visibleSourceIds.has(diagnostic.key.split(":")[0] as SourceId) &&
              sourceAuditTimestampInRange(diagnostic.observedAt, filters),
          ),
        }
      : {}),
  };
}

interface OperationsTimelineReadableStore extends SourceAuditReadableStore {
  listSourceHealth(): Promise<SourceHealth[]>;
  listCollectorRuns(filters?: { source?: SourceId; limit?: number }): Promise<SourceCollectorRun[]>;
}

function operationsRoleForSource(source: SourceId | undefined): OperationsTimelineEvent["role"] {
  if (!source) return "system";
  const role = sourceAuditRole(source);
  if (role === "telemetry_source") return "telemetry";
  if (role === "context_source") return "context";
  if (role === "private_annotation" || role === "internal_analysis") return "private";
  return "incident";
}

function severityForSituation(situation: Situation): OperationsTimelineEvent["severity"] {
  if (situation.status === "dismissed") return "muted";
  if (situation.importance === "high" && situation.status === "active") return "warning";
  return "info";
}

function severityForCollectorRun(run: SourceCollectorRun): OperationsTimelineEvent["severity"] {
  if (isSoftDeepSeekCollectorRun(run)) return "info";
  if (run.status === "failed") return "critical";
  if (run.status === "partial") return "warning";
  if (run.status === "skipped") return "muted";
  return "info";
}

function severityForStaleAlert(alert: SourceStaleDataAlert): OperationsTimelineEvent["severity"] {
  if (alert.severity === "critical") return "critical";
  if (alert.severity === "warning") return "warning";
  return "info";
}

function statusLabel(status: Situation["status"]): string {
  const labels: Record<Situation["status"], string> = {
    preliminary: "Foreløpig",
    active: "Aktiv",
    resolved: "Løst",
    dismissed: "Avvist",
  };
  return labels[status];
}

function collectorRunStatusLabel(status: SourceCollectorRun["status"]): string {
  const labels: Record<SourceCollectorRun["status"], string> = {
    succeeded: "fullført",
    partial: "delvis fullført",
    failed: "feilet",
    skipped: "hoppet over",
    running: "kjører",
  };
  return labels[status];
}

function collectorRunTitle(run: SourceCollectorRun): string {
  const label = sourceAuditLabelFallbacks[run.source];
  return isSoftDeepSeekCollectorRun(run)
    ? `${label} brukte reserveanalyse`
    : `${label} ${collectorRunStatusLabel(run.status)}`;
}

function collectorRunDetail(run: SourceCollectorRun): string {
  return isSoftDeepSeekCollectorRun(run)
    ? deepSeekFallbackDetail()
    : `${run.recordsAccepted} inn, ${run.recordsRejected} avvik, ${run.recordsSeen} sett.`;
}

function sourceItemRelationshipLabel(relationship?: SourceItemRelationship): string {
  const labels: Record<SourceItemRelationship, string> = {
    supports: "støtte",
    contradicts: "motsigelse",
    context: "kontekst",
    duplicate: "duplikat",
  };
  return relationship ? labels[relationship] : "kontekst";
}

function externalLink(url?: string): OperationsTimelineEvent["links"][number][] {
  if (!url) return [];
  return [{ kind: "external", label: "Original kilde", href: url }];
}

function situationLinks(
  situation: Pick<Situation, "id" | "title">,
): OperationsTimelineEvent["links"] {
  return [
    {
      kind: "situation",
      label: situation.title,
      href: `/situasjoner/${encodeURIComponent(situation.id)}`,
      situationId: situation.id,
    },
  ];
}

function sourceAuditLink(source?: SourceId): OperationsTimelineEvent["links"][number][] {
  if (!source) return [];
  return [
    {
      kind: "source_audit",
      label: "Kildeaudit",
      href: `/command/kilder?sources=${encodeURIComponent(source)}&detail=${encodeURIComponent(
        source,
      )}`,
      sourceId: source,
    },
  ];
}

function operationsKindForTimelineEntry(entry: TimelineEntry): OperationsTimelineEvent["kind"] {
  if (entry.kind === "private_annotation") return "private_annotation";
  if (
    entry.kind === "status_change" ||
    entry.kind === "review_action" ||
    entry.kind === "severity_change" ||
    entry.kind === "merge_decision" ||
    entry.kind === "split_decision"
  ) {
    return entry.kind;
  }

  const text = `${entry.title} ${entry.detail}`.toLocaleLowerCase("nb");
  if (/(flett|slått sammen|duplikat|merge)/.test(text)) return "merge_decision";
  if (/(splitt|del opp|delt fra|split)/.test(text)) return "split_decision";
  if (/(status|løst|avvist|gjenåpnet)/.test(text)) return "status_change";
  if (entry.source) return "source_update";
  return "situation_update";
}

function operationEventFromTimelineEntry(
  situation: Situation,
  entry: TimelineEntry,
): OperationsTimelineEvent {
  const source = entry.source;
  const provenance = entry.provenance ?? (source ? sourceAuditProvenance(source) : undefined);
  const kind = operationsKindForTimelineEntry(entry);
  const isPrivate = provenance === "private_annotation" || kind === "private_annotation";
  return {
    id: `timeline:${entry.id}`,
    timestamp: entry.timestamp,
    kind,
    severity: kind === "status_change" ? severityForSituation(situation) : "info",
    title: entry.title,
    detail: entry.detail,
    ...(source ? { source } : {}),
    ...(entry.sourceLabel ? { sourceLabel: entry.sourceLabel } : {}),
    situationId: situation.id,
    situationTitle: situation.title,
    situationStatus: situation.status,
    role: isPrivate ? "private" : operationsRoleForSource(source),
    ...(provenance ? { provenance } : {}),
    ...(entry.confidence ? { confidence: entry.confidence } : {}),
    private: isPrivate,
    links: [
      ...situationLinks(situation),
      ...sourceAuditLink(source),
      ...externalLink(entry.sourceUrl),
    ],
    ...(entry.sourceItemIds?.length || entry.privateAnnotationId
      ? {
          metadata: {
            ...(entry.sourceItemIds?.[0] ? { sourceItemId: entry.sourceItemIds[0] } : {}),
            ...(entry.privateAnnotationId
              ? { relationship: "private_annotation" as const }
              : { relationship: "timeline" as const }),
          },
        }
      : {}),
  };
}

function operationEventFromSourceItem(
  situation: Situation,
  item: SourceItem,
): OperationsTimelineEvent {
  const provenance = sourceAuditProvenance(item.provider);
  const timestamp = item.publishedAt ?? item.fetchedAt;
  const relationship = item.relationship ?? "context";
  return {
    id: `source-item:${situation.id}:${item.id}:${relationship}`,
    timestamp,
    kind: "source_update",
    severity: relationship === "contradicts" ? "warning" : "info",
    title: item.title ?? "Kildeelement koblet",
    detail: `Kildeelement brukt som ${sourceItemRelationshipLabel(relationship)} i situasjonen.`,
    source: item.provider,
    sourceLabel: sourceAuditLabelFallbacks[item.provider],
    situationId: situation.id,
    situationTitle: situation.title,
    situationStatus: situation.status,
    role: operationsRoleForSource(item.provider),
    provenance,
    ...(item.confidence ? { confidence: item.confidence } : {}),
    private: provenance === "private_annotation",
    links: [
      ...situationLinks(situation),
      ...sourceAuditLink(item.provider),
      {
        kind: "source_item",
        label: "Kildeelement",
        sourceItemId: item.id,
      },
      ...externalLink(item.originalUrl),
    ],
    metadata: {
      sourceItemId: item.id,
      relationship,
    },
  };
}

function operationEventFromCollectorRun(run: SourceCollectorRun): OperationsTimelineEvent {
  return {
    id: `collector:${run.id}`,
    timestamp: run.completedAt ?? run.startedAt,
    kind: "collector_run",
    severity: severityForCollectorRun(run),
    title: collectorRunTitle(run),
    detail: collectorRunDetail(run),
    source: run.source,
    sourceLabel: sourceAuditLabelFallbacks[run.source],
    collector: run.collector,
    role: operationsRoleForSource(run.source),
    provenance: sourceAuditProvenance(run.source),
    private: false,
    links: sourceAuditLink(run.source),
    metadata: {
      recordsSeen: run.recordsSeen,
      recordsAccepted: run.recordsAccepted,
      recordsRejected: run.recordsRejected,
      ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
    },
  };
}

function operationEventFromStaleAlert(
  alert: SourceStaleDataAlert,
  label: string,
): OperationsTimelineEvent {
  return {
    id: `stale:${alert.id}`,
    timestamp: alert.lastSeenAt,
    kind: "stale_warning",
    severity: severityForStaleAlert(alert),
    title: `${label} trenger tilsyn`,
    detail: alert.message,
    source: alert.source,
    sourceLabel: label,
    role: operationsRoleForSource(alert.source),
    provenance: sourceAuditProvenance(alert.source),
    private: false,
    links: sourceAuditLink(alert.source),
  };
}

function operationEventsFromWorkspace(
  workspace: SituationWorkspace,
  sourceItems: SourceItem[],
): OperationsTimelineEvent[] {
  const { situation } = workspace;
  const events: OperationsTimelineEvent[] = [];

  events.push({
    id: `situation:${situation.id}:updated`,
    timestamp: situation.updatedAt,
    kind: situation.status === "active" ? "situation_update" : "status_change",
    severity: severityForSituation(situation),
    title:
      situation.status === "active" ? situation.title : `Status: ${statusLabel(situation.status)}`,
    detail:
      situation.status === "active"
        ? `Situasjonen er aktiv i ${situation.locationLabel}.`
        : `Situasjonen er markert som ${statusLabel(situation.status).toLocaleLowerCase("nb")}.`,
    ...(situation.officialSource ? { source: situation.officialSource } : {}),
    ...(situation.officialSource
      ? { sourceLabel: sourceAuditLabelFallbacks[situation.officialSource] }
      : {}),
    situationId: situation.id,
    situationTitle: situation.title,
    situationStatus: situation.status,
    role: operationsRoleForSource(situation.officialSource),
    ...(situation.officialSource
      ? { provenance: sourceAuditProvenance(situation.officialSource) }
      : {}),
    ...(situation.sourceConfidence ? { confidence: situation.sourceConfidence } : {}),
    private: false,
    links: situationLinks(situation),
  });

  if (situation.importance === "high") {
    events.push({
      id: `situation:${situation.id}:importance`,
      timestamp: situation.updatedAt,
      kind: "severity_change",
      severity: "warning",
      title: "Alvorlighet markert som høy",
      detail: `${situation.title} ligger høyt i operativ prioritet.`,
      situationId: situation.id,
      situationTitle: situation.title,
      situationStatus: situation.status,
      role: "system",
      private: false,
      links: situationLinks(situation),
      metadata: { nextValue: "high" },
    });
  }

  for (const entry of situation.timeline)
    events.push(operationEventFromTimelineEntry(situation, entry));
  for (const item of sourceItems) events.push(operationEventFromSourceItem(situation, item));

  for (const feature of situation.features) {
    if (feature.properties.provenance !== "private_annotation") continue;
    events.push({
      id: `private-feature:${situation.id}:${feature.id}`,
      timestamp: feature.properties.updatedAt,
      kind: "private_annotation",
      severity: "muted",
      title: "Privat kartmarkering",
      detail:
        "Eier la inn eller oppdaterte en privat markering. Innholdet er ikke offentlig bevis.",
      source: "private_annotations",
      sourceLabel: sourceAuditLabelFallbacks.private_annotations,
      situationId: situation.id,
      situationTitle: situation.title,
      situationStatus: situation.status,
      role: "private",
      provenance: "private_annotation",
      private: true,
      links: [
        ...situationLinks(situation),
        {
          kind: "private_workspace",
          label: "Privat arbeidsflate",
          href: `/situasjoner/${encodeURIComponent(situation.id)}`,
          situationId: situation.id,
        },
      ],
      metadata: { relationship: "private_annotation" },
    });
  }

  for (const note of workspace.notes) {
    events.push({
      id: `private-note:${situation.id}:${note.id}`,
      timestamp: note.createdAt,
      kind: "review_action",
      severity: "muted",
      title: "Privat notat lagt til",
      detail: "Notatinnholdet holdes i arbeidsflaten og vises ikke i operasjonstidslinjen.",
      source: "private_annotations",
      sourceLabel: sourceAuditLabelFallbacks.private_annotations,
      situationId: situation.id,
      situationTitle: situation.title,
      situationStatus: situation.status,
      role: "private",
      provenance: "private_annotation",
      private: true,
      links: situationLinks(situation),
    });
  }

  for (const task of workspace.tasks) {
    events.push({
      id: `review-task:${situation.id}:${task.id}`,
      timestamp: task.createdAt,
      kind: "review_action",
      severity: "muted",
      title: task.completed ? "Privat oppgave fullført" : "Privat oppgave opprettet",
      detail: "Oppgaveteksten holdes i arbeidsflaten og brukes ikke som offentlig kildegrunnlag.",
      source: "private_annotations",
      sourceLabel: sourceAuditLabelFallbacks.private_annotations,
      situationId: situation.id,
      situationTitle: situation.title,
      situationStatus: situation.status,
      role: "private",
      provenance: "private_annotation",
      private: true,
      links: situationLinks(situation),
    });
  }

  return events;
}

function timelineEventMatchesQuery(
  event: OperationsTimelineEvent,
  filters: OperationsTimelineQuery,
): boolean {
  if (filters.sources?.length && (!event.source || !filters.sources.includes(event.source))) {
    return false;
  }
  if (
    filters.provenances?.length &&
    (!event.provenance || !filters.provenances.includes(event.provenance))
  ) {
    return false;
  }
  if (filters.kinds?.length && !filters.kinds.includes(event.kind)) return false;
  if (
    filters.situationIds?.length &&
    (!event.situationId || !filters.situationIds.includes(event.situationId))
  ) {
    return false;
  }
  if (
    filters.statuses?.length &&
    (!event.situationStatus || !filters.statuses.includes(event.situationStatus))
  ) {
    return false;
  }
  if (filters.severities?.length && !filters.severities.includes(event.severity)) return false;
  if (filters.roles?.length && !filters.roles.includes(event.role)) return false;
  if (filters.includePrivateAnnotations === false && event.private) return false;
  if (filters.from && event.timestamp < filters.from) return false;
  if (filters.to && event.timestamp > filters.to) return false;
  if (filters.q) {
    const haystack =
      `${event.title} ${event.detail} ${event.sourceLabel ?? ""} ${event.situationTitle ?? ""}`.toLocaleLowerCase(
        "nb",
      );
    if (!haystack.includes(filters.q.toLocaleLowerCase("nb"))) return false;
  }
  return true;
}

function timelineEventAfterCursor(
  event: OperationsTimelineEvent,
  cursor: { timestamp: string; id?: string } | undefined,
  sort: "asc" | "desc",
): boolean {
  if (!cursor) return true;
  if (sort === "asc") {
    return (
      event.timestamp > cursor.timestamp ||
      (event.timestamp === cursor.timestamp && Boolean(cursor.id && event.id > cursor.id))
    );
  }
  return beforeCursor(event.timestamp, event.id, cursor);
}

async function buildOperationsTimeline(
  store: OperationsTimelineReadableStore,
  filters: OperationsTimelineQuery,
  login: string,
): Promise<OperationsTimelineResponse> {
  const generatedAt = new Date().toISOString();
  const [situationPage, collectorRuns, sourceHealth] = await Promise.all([
    store.listSituations({ includeDismissed: true, limit: 100 }, login),
    store.listCollectorRuns({ limit: 100 }),
    store.listSourceHealth(),
  ]);
  const workspaceRows = await Promise.all(
    situationPage.items.map(async (situation) => {
      const [workspace, sourceItems] = await Promise.all([
        store.getWorkspace(situation.id, login),
        store.listSituationSourceItems(situation.id, login),
      ]);
      return workspace ? { workspace, sourceItems } : undefined;
    }),
  );

  const events: OperationsTimelineEvent[] = [];
  for (const row of workspaceRows) {
    if (row) events.push(...operationEventsFromWorkspace(row.workspace, row.sourceItems));
  }
  events.push(...collectorRuns.map(operationEventFromCollectorRun));

  const healthBySource = new Map(sourceHealth.map((health) => [health.source, health]));
  const latestRuns = latestRunBySource(collectorRuns);
  for (const health of sourceHealth) {
    const freshness = sourceFreshness(health, latestRuns.get(health.source), generatedAt);
    const alert = staleAlertForSource(health.source, health.label, health, freshness, generatedAt);
    if (alert) events.push(operationEventFromStaleAlert(alert, health.label));
  }
  for (const run of collectorRuns) {
    if (!healthBySource.has(run.source)) {
      const freshness = sourceFreshness(undefined, run, generatedAt);
      const label = sourceAuditLabelFallbacks[run.source];
      const alert = staleAlertForSource(run.source, label, undefined, freshness, generatedAt);
      if (alert) events.push(operationEventFromStaleAlert(alert, label));
    }
  }

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
  const sort = filters.sort ?? "desc";
  const visibleEvents = events
    .filter((event) => timelineEventMatchesQuery(event, filters))
    .filter((event) => timelineEventAfterCursor(event, cursor, sort))
    .sort((left, right) =>
      sort === "asc"
        ? left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
        : right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id),
    );
  const limit = filters.limit ?? 80;
  const page = visibleEvents.slice(0, limit);
  const last = page.at(-1);
  const activeSituationIds = new Set(
    visibleEvents.flatMap((event) =>
      event.situationId && event.situationStatus === "active" ? [event.situationId] : [],
    ),
  );

  return {
    generatedAt,
    filters,
    events: page,
    summary: {
      total: visibleEvents.length,
      activeSituations: activeSituationIds.size,
      staleWarnings: visibleEvents.filter((event) => event.kind === "stale_warning").length,
      collectorRuns: visibleEvents.filter((event) => event.kind === "collector_run").length,
      reviewerActions: visibleEvents.filter((event) =>
        [
          "review_action",
          "status_change",
          "severity_change",
          "merge_decision",
          "split_decision",
        ].includes(event.kind),
      ).length,
      privateEvents: visibleEvents.filter((event) => event.private).length,
    },
    nextCursor:
      visibleEvents.length > limit && last ? encodeCursor(last.timestamp, last.id) : undefined,
  };
}

const TRAFFIC_PULSE_STALE_AFTER_MS = 20 * 60 * 1000;

function validTimestampMs(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const timestampMs = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

function firstValidTimestampMs(
  ...values: Array<Date | string | null | undefined>
): number | undefined {
  for (const value of values) {
    const timestampMs = validTimestampMs(value);
    if (timestampMs !== undefined) return timestampMs;
  }
  return undefined;
}

function withTrafficPulseStaleOverlay(
  corridor: TrafficPulseCorridor,
  measurementTo: Date | string | null | undefined,
  updatedAt: Date | string | null | undefined,
  nowMs: number,
): TrafficPulseCorridor {
  const cutoffMs = nowMs - TRAFFIC_PULSE_STALE_AFTER_MS;
  const measuredAt = firstValidTimestampMs(
    measurementTo,
    corridor.measurementTo,
    updatedAt,
    corridor.updatedAt,
  );
  if (measuredAt !== undefined && measuredAt < cutoffMs) {
    return { ...corridor, state: "stale" };
  }
  return corridor;
}

export class MemoryStore implements Store {
  private articles = clone(sampleArticles);
  private situations = new Map([[sampleSituation.id, clone(sampleSituation)]]);
  private tasks = clone(sampleTasks);
  private notes = clone(sampleNotes);
  private attachments: AttachmentRecord[] = [];
  private exports: ExportRecord[] = [];
  private accessRequests: AccessRequest[] = [];
  private users: AppUser[] = [];
  private userIdentities: MemoryUserIdentity[] = [];
  private authTokens: MemoryAuthToken[] = [];
  private pushSubscriptions: MemoryPushSubscription[] = [];
  private pushDeliveries: PushDeliveryListItem[] = [];
  private savedSituations = new Set<string>();
  private sourceItems = new Map<string, SourceItemRecord>(
    sampleArticles.map((article) => {
      const item = memorySourceItemFromArticle(article);
      return [item.id, item];
    }),
  );
  private sourceLinks = new Map<
    string,
    {
      situationId: string;
      sourceItemId: string;
      relationship: SourceItemRelationship;
      linkedBy: string;
      linkedAt: string;
    }
  >(
    sampleArticles.flatMap((article) => {
      const linkedSituationId =
        article.situationId ??
        (sampleSituation.relatedArticleIds.includes(article.id) ? sampleSituation.id : undefined);
      if (!linkedSituationId) return [];
      const sourceId = sourceItemId(article.source, "article", article.id);
      return [
        [
          `${linkedSituationId}:${sourceId}`,
          {
            situationId: linkedSituationId,
            sourceItemId: sourceId,
            relationship: "supports" as SourceItemRelationship,
            linkedBy: "sample-data",
            linkedAt: article.publishedAt,
          },
        ],
      ];
    }),
  );

  private linkedSituationIdsForSourceItem(sourceItemId: string): string[] {
    return [...this.sourceLinks.values()]
      .filter((link) => link.sourceItemId === sourceItemId)
      .map((link) => link.situationId)
      .sort();
  }

  private issueMemoryToken(
    kind: AuthTokenKind,
    ttlMs: number,
    input: {
      accessRequestId?: string;
      userId?: string;
      email?: string;
      createdBy?: string;
    },
  ): string {
    const token = newAuthToken();
    const now = new Date().toISOString();
    this.authTokens.push({
      id: randomUUID(),
      tokenHash: hashAuthToken(token),
      kind,
      expiresAt: expiresAt(ttlMs),
      createdAt: now,
      ...(input.accessRequestId ? { accessRequestId: input.accessRequestId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.email
        ? { email: input.email, emailNormalized: normalizeAccessRequestEmail(input.email) }
        : {}),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    });
    return token;
  }

  private consumeMemoryToken(kind: AuthTokenKind | AuthTokenKind[], token: string) {
    const kinds = Array.isArray(kind) ? kind : [kind];
    const row = this.authTokens.find(
      (candidate) =>
        candidate.tokenHash === hashAuthToken(token) &&
        kinds.includes(candidate.kind) &&
        !candidate.consumedAt,
    );
    if (!row || Date.parse(row.expiresAt) <= Date.now()) return undefined;
    row.consumedAt = new Date().toISOString();
    return row;
  }

  private findUserByEmail(email: string): AppUser | undefined {
    const normalizedEmail = normalizeAccessRequestEmail(email);
    return this.users.find(
      (user) => user.email && normalizeAccessRequestEmail(user.email) === normalizedEmail,
    );
  }

  private ensureEmailIdentity(user: AppUser): void {
    if (!user.email) return;
    const providerSubject = normalizeAccessRequestEmail(user.email);
    const existing = this.userIdentities.find(
      (identity) => identity.provider === "email" && identity.providerSubject === providerSubject,
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.userId = user.id;
      existing.updatedAt = now;
    } else {
      this.userIdentities.push({
        id: randomUUID(),
        userId: user.id,
        provider: "email",
        providerSubject,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private createOrReactivateViewer(input: UserGrantInput): AppUser {
    const now = new Date().toISOString();
    const existing = this.findUserByEmail(input.email);
    if (existing) {
      existing.displayName = input.displayName;
      existing.role = "viewer";
      existing.status = "active";
      existing.updatedAt = now;
      this.ensureEmailIdentity(existing);
      return existing;
    }
    const user: AppUser = {
      id: randomUUID(),
      displayName: input.displayName,
      email: input.email,
      role: "viewer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    this.ensureEmailIdentity(user);
    return user;
  }

  async createAccessRequest(input: AccessRequestInput): Promise<AccessRequestSubmissionResult> {
    const now = new Date().toISOString();
    const normalizedEmail = normalizeAccessRequestEmail(input.email);
    const existing = this.accessRequests.find(
      (request) => normalizeAccessRequestEmail(request.email) === normalizedEmail,
    );
    let request: AccessRequest;
    if (existing) {
      existing.displayName = input.displayName;
      existing.email = input.email;
      if (input.message) existing.message = input.message;
      else delete existing.message;
      if (existing.status !== "approved" && existing.emailVerifiedAt) {
        existing.requestedAt = now;
      } else if (existing.status !== "approved") {
        existing.status = "unverified";
        delete existing.emailVerifiedAt;
        delete existing.reviewedAt;
        delete existing.reviewedBy;
        delete existing.reviewerNote;
        existing.requestedAt = now;
      }
      existing.updatedAt = now;
      request = existing;
    } else {
      request = {
        id: randomUUID(),
        displayName: input.displayName,
        email: input.email,
        ...(input.message ? { message: input.message } : {}),
        status: "unverified",
        requestedAt: now,
        updatedAt: now,
      };
      this.accessRequests.push(request);
    }
    if (request.status === "approved" || request.emailVerifiedAt) return { status: "received" };
    const token = this.issueMemoryToken("access_verify", accessVerificationTtlMs, {
      accessRequestId: request.id,
      email: request.email,
    });
    return {
      status: "received",
      verification: { email: request.email, displayName: request.displayName, token },
    };
  }

  async verifyAccessRequestToken(token: string): Promise<"verified" | "invalid"> {
    const row = this.consumeMemoryToken("access_verify", token);
    const request = row?.accessRequestId
      ? this.accessRequests.find((item) => item.id === row.accessRequestId)
      : undefined;
    if (!row || !request) return "invalid";
    const now = new Date().toISOString();
    request.emailVerifiedAt = now;
    if (request.status === "unverified") request.status = "pending";
    request.updatedAt = now;
    return "verified";
  }

  async listAccessRequests(filters: AccessRequestQueryInput): Promise<AccessRequestPage> {
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 50;
    const filtered = this.accessRequests
      .filter(
        (request) =>
          (!filters.status || request.status === filters.status) &&
          beforeCursor(request.requestedAt, request.id, cursor),
      )
      .sort(
        (left, right) =>
          right.requestedAt.localeCompare(left.requestedAt) || right.id.localeCompare(left.id),
      );
    const allForSummary = this.accessRequests.filter(
      (request) => !filters.status || request.status === filters.status,
    );
    const page = filtered.slice(0, limit);
    const last = page.at(-1);
    return {
      items: clone(page),
      summary: summarizeAccessRequests(allForSummary),
      nextCursor:
        filtered.length > limit && last ? encodeCursor(last.requestedAt, last.id) : undefined,
    };
  }

  async decideAccessRequest(
    id: string,
    input: AccessRequestDecisionInput,
    login: string,
  ): Promise<AccessRequestDecisionResult> {
    const request = this.accessRequests.find((item) => item.id === id);
    if (!request)
      throw Object.assign(new Error("Tilgangsforespørselen finnes ikke."), { status: 404 });
    if (input.status === "approved" && !request.emailVerifiedAt) {
      throw Object.assign(new Error("E-post må verifiseres før godkjenning."), { status: 400 });
    }
    const now = new Date().toISOString();
    request.status = input.status;
    request.reviewedAt = now;
    request.reviewedBy = login;
    request.updatedAt = now;
    if (input.reviewerNote) request.reviewerNote = input.reviewerNote;
    else delete request.reviewerNote;
    if (input.status === "rejected") return { request: clone(request) };
    const user = this.createOrReactivateViewer(request);
    const token = this.issueMemoryToken("invite", inviteTtlMs, {
      userId: user.id,
      email: user.email,
      createdBy: login,
    });
    return {
      request: clone(request),
      invite: { email: request.email, displayName: request.displayName, token },
    };
  }

  async grantUserAccess(input: UserGrantInput, login: string): Promise<UserGrantResult> {
    const user = this.createOrReactivateViewer(input);
    const token = this.issueMemoryToken("invite", inviteTtlMs, {
      userId: user.id,
      email: user.email,
      createdBy: login,
    });
    return {
      user: clone(user),
      invite: { email: user.email ?? input.email, displayName: user.displayName, token },
    };
  }

  async requestEmailLogin(email: string): Promise<EmailLoginRequestResult> {
    const user = this.findUserByEmail(email);
    if (!user || user.status !== "active") return { status: "received" };
    const token = this.issueMemoryToken("login", loginTtlMs, {
      userId: user.id,
      email: user.email,
    });
    return {
      status: "received",
      login: { email: user.email ?? email, displayName: user.displayName, token },
    };
  }

  async consumeEmailLoginToken(token: string): Promise<AuthUser | undefined> {
    const row = this.consumeMemoryToken(["invite", "login"], token);
    const user = row?.userId ? this.users.find((item) => item.id === row.userId) : undefined;
    if (!row || !user || user.status !== "active") return undefined;
    const now = new Date().toISOString();
    user.lastLoginAt = now;
    user.updatedAt = now;
    return authUserFromAppUser(user);
  }

  async listUsers(): Promise<UserPage> {
    const items = clone(
      [...this.users].sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      ),
    );
    return { items, summary: summarizeUsers(items) };
  }

  async updateUser(id: string, input: UserUpdateInput, login: string): Promise<UserUpdateResult> {
    const user = this.users.find((item) => item.id === id);
    if (!user) throw Object.assign(new Error("Brukeren finnes ikke."), { status: 404 });
    if (user.role === "owner" && input.status === "revoked") {
      throw Object.assign(new Error("Eierkontoen kan ikke tilbakekalles her."), { status: 400 });
    }
    if (input.status) user.status = input.status;
    user.updatedAt = new Date().toISOString();
    if (!input.resendInvite || !user.email || user.status !== "active")
      return { user: clone(user) };
    const token = this.issueMemoryToken("invite", inviteTtlMs, {
      userId: user.id,
      email: user.email,
      createdBy: login,
    });
    return {
      user: clone(user),
      invite: { email: user.email, displayName: user.displayName, token },
    };
  }

  async ensureGitHubOwner(profile: Profile, allowedLogin: string): Promise<AuthUser | false> {
    const authorized = authorizeGitHubProfileForStore(profile, allowedLogin);
    if (!authorized) return false;
    const subject = authorized.login.toLocaleLowerCase("nb");
    const now = new Date().toISOString();
    const identity = this.userIdentities.find(
      (item) => item.provider === "github" && item.providerSubject === subject,
    );
    let user = identity ? this.users.find((item) => item.id === identity.userId) : undefined;
    if (!user) {
      user = {
        id: randomUUID(),
        displayName: authorized.displayName,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      this.users.push(user);
      this.userIdentities.push({
        id: randomUUID(),
        userId: user.id,
        provider: "github",
        providerSubject: subject,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      user.displayName = authorized.displayName;
      user.role = "owner";
      user.status = "active";
      user.lastLoginAt = now;
      user.updatedAt = now;
    }
    return {
      ...authUserFromAppUser(user),
      login: authorized.login,
      avatarUrl: authorized.avatarUrl,
    };
  }

  async getBootstrap(): Promise<BootstrapPayload> {
    const storyPage = await this.listCityPulseStories({ scope: "trondheim", limit: 40 });
    const situations = [...this.situations.values()]
      .filter(
        (situation) =>
          isPublicSituation(situation) &&
          (situation.status === "preliminary" || situation.status === "active"),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      )
      .slice(0, 3)
      .map(homeSituationSummary);
    return bootstrapWithMorningBrief({
      articles: articlesFromCityPulseStoryPage(storyPage),
      stories: storyPage.items,
      ...(storyPage.nextCursor ? { storyNextCursor: storyPage.nextCursor } : {}),
      situations,
      sourceHealth: clone(sampleBootstrap.sourceHealth),
    });
  }

  async listArticles(filters: ArticleFilters): Promise<ArticlePage> {
    const search = filters.q?.toLocaleLowerCase("nb");
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 40;
    const items = this.articles
      .filter(
        (article) =>
          (!filters.scope || article.scope === filters.scope) &&
          (!filters.category ||
            filters.category === "Alle" ||
            articleMatchesCategory(article, filters.category)) &&
          (!filters.topic || articleMatchesTopic(article, filters.topic)) &&
          (!filters.from || article.publishedAt >= filters.from) &&
          (!filters.to || article.publishedAt <= filters.to) &&
          (!search ||
            `${article.title} ${article.excerpt} ${article.sourceLabel} ${article.category} ${article.places.join(" ")}`
              .toLocaleLowerCase("nb")
              .includes(search)) &&
          beforeCursor(article.publishedAt, article.id, cursor),
      )
      .sort(
        (left, right) =>
          right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id),
      );
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      items: clone(
        enrichArticlesWithCoverageGroupVerification(
          enrichArticlesWithSituations(
            page,
            [...this.situations.values()].filter(
              (situation) =>
                isPublicSituation(situation) &&
                (situation.status === "preliminary" || situation.status === "active"),
            ),
          ),
        ),
      ),
      nextCursor:
        items.length > limit && last ? encodeCursor(last.publishedAt, last.id) : undefined,
    };
  }

  async listCityPulseStories(filters: ArticleFilters): Promise<CityPulseStoryPage> {
    const articles = await this.listArticles({
      ...filters,
      cursor: undefined,
      limit: cityPulseStorySourceLimit(filters),
    });
    return cityPulseStoryPageFromArticles(articles.items, filters);
  }

  async listCoverageBundles(filters: CoverageBundleQueryInput): Promise<CoverageBundlePage> {
    const generatedAt = new Date().toISOString();
    const analysis = analyzeArticleCoverage(this.articles, generatedAt);
    const articlesById = new Map(analysis.articles.map((article) => [article.id, article]));
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 30;
    const allItems = analysis.bundles
      .map((bundle) => {
        const lastSeenAt =
          bundle.memberArticleIds
            .flatMap((articleId) => articlesById.get(articleId)?.publishedAt ?? [])
            .sort()
            .at(-1) ?? generatedAt;
        return coverageBundleItemFromDecision(bundle, articlesById, lastSeenAt, generatedAt);
      })
      .sort(
        (left, right) =>
          right.lastSeenAt.localeCompare(left.lastSeenAt) || right.id.localeCompare(left.id),
      );
    const filtered = filterCoverageBundleItems(allItems, filters);
    const cursorFiltered = filtered.filter((item) =>
      beforeCursor(item.lastSeenAt, item.id, cursor),
    );
    const page = cursorFiltered.slice(0, limit);
    const last = page.at(-1);
    return {
      items: clone(page),
      summary: summarizeCoverageBundleItems(filtered),
      nextCursor:
        cursorFiltered.length > limit && last ? encodeCursor(last.lastSeenAt, last.id) : undefined,
    };
  }

  async listNotificationTriggers(
    filters: NotificationTriggerQueryInput,
  ): Promise<NotificationTriggerPage> {
    const generatedAt = new Date().toISOString();
    const [situations, articles, trafficInfoEvents, officialEvents, trafficPulse, trafficCounters] =
      await Promise.all([
        this.listSituations({ includeDismissed: false, limit: 100, publicOnly: true }),
        this.listArticles({ limit: 500 }),
        this.listTrafficMapEvents({
          sources: ["vegvesen_traffic_info"],
          states: ["active", "planned"],
          limit: null,
        }),
        this.listOfficialEvents({ source: "datex", states: ["active", "updated"], limit: 200 }),
        this.listTrafficPulseCorridors(50),
        this.listTrafficCounterSnapshots(),
      ]);
    const spatialInvestigationItems = buildSpatialNotificationItems({
      articles: articles.items,
      trafficInfoEvents,
      officialEvents,
      trafficPulse,
      trafficCounters,
    });
    return buildNotificationTriggerPage({
      situations: situations.items,
      articles: articles.items,
      spatialInvestigationItems,
      generatedAt,
      filters,
    });
  }

  async getPushSettings(userId: string, publicKey?: string): Promise<PushNotificationSettings> {
    return {
      configured: Boolean(publicKey),
      ...(publicKey ? { publicKey } : {}),
      subscriptions: clone(
        this.pushSubscriptions
          .filter((subscription) => subscription.userId === userId)
          .map((subscription) => pushSubscriptionFromRow(subscription)),
      ),
    };
  }

  async upsertPushSubscription(
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<PushSubscriptionSummary> {
    const now = new Date().toISOString();
    const endpointHash = pushEndpointHash(input.endpoint);
    const existing = this.pushSubscriptions.find(
      (subscription) => subscription.endpointHash === endpointHash,
    );
    if (existing) {
      existing.userId = userId;
      existing.endpoint = input.endpoint;
      existing.p256dh = input.keys.p256dh;
      existing.auth = input.keys.auth;
      existing.enabled = true;
      existing.minSeverity = input.minSeverity ?? "warning";
      existing.kinds = input.kinds ?? [];
      if (input.userAgent) existing.userAgent = input.userAgent;
      existing.updatedAt = now;
      existing.lastSeenAt = now;
      return clone(pushSubscriptionFromRow(existing));
    }
    const subscription: MemoryPushSubscription = {
      id: randomUUID(),
      userId,
      endpoint: input.endpoint,
      endpointHash,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      enabled: true,
      minSeverity: input.minSeverity ?? "warning",
      kinds: input.kinds ?? [],
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      failureCount: 0,
    };
    this.pushSubscriptions.push(subscription);
    return clone(pushSubscriptionFromRow(subscription));
  }

  async deletePushSubscription(userId: string, id: string): Promise<void> {
    const subscription = this.pushSubscriptions.find(
      (item) => item.userId === userId && item.id === id,
    );
    if (!subscription) return;
    subscription.enabled = false;
    subscription.updatedAt = new Date().toISOString();
  }

  async listPushSubscriptionPreferences(): Promise<NotificationSubscriptionPreference[]> {
    return clone(
      this.pushSubscriptions
        .filter((subscription) => {
          const user = this.users.find((item) => item.id === subscription.userId);
          return subscription.enabled && user?.status !== "revoked";
        })
        .map((subscription) => ({
          enabled: subscription.enabled,
          minSeverity: subscription.minSeverity,
          kinds: subscription.kinds,
        })),
    );
  }

  async listPushDeliveries(limit: number): Promise<PushDeliveryPage> {
    const items = clone(
      this.pushDeliveries
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit),
    );
    return {
      generatedAt: new Date().toISOString(),
      items,
      summary: summarizePushDeliveries(items),
    };
  }

  async listSourceItems(filters: SourceItemFilters): Promise<SourceItemPage> {
    const search = filters.q?.toLocaleLowerCase("nb");
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 40;
    const withLinks = [...this.sourceItems.values()].map((item) => ({
      ...sourceItemFromRecord(item),
      linkedSituationIds: [...this.sourceLinks.values()]
        .filter((link) => link.sourceItemId === item.id)
        .map((link) => link.situationId)
        .sort(),
    }));
    const items = withLinks
      .filter(
        (item) =>
          (!filters.provider || item.provider === filters.provider) &&
          (!filters.kind || item.kind === filters.kind) &&
          (!filters.unlinked || item.linkedSituationIds.length === 0) &&
          (!search ||
            `${item.title ?? ""} ${item.summary ?? ""} ${item.originalUrl ?? ""}`
              .toLocaleLowerCase("nb")
              .includes(search)) &&
          beforeCursor(item.fetchedAt, item.id, cursor),
      )
      .sort(
        (left, right) =>
          right.fetchedAt.localeCompare(left.fetchedAt) || right.id.localeCompare(left.id),
      );
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      items: clone(page),
      nextCursor: items.length > limit && last ? encodeCursor(last.fetchedAt, last.id) : undefined,
    };
  }

  async getRawSourceItem(id: string): Promise<RawInspectorSourceItemDetail | undefined> {
    const record = this.sourceItems.get(id);
    if (!record) return undefined;
    return rawSourceItemDetailFromRecord(
      clone({
        ...record,
        linkedSituationIds: this.linkedSituationIdsForSourceItem(record.id),
      }),
    );
  }

  async listRawTelemetry(
    filters: RawInspectorTelemetryFilters,
  ): Promise<RawInspectorTelemetryPage> {
    void filters;
    return { items: [] };
  }

  async getRawTelemetryRecord(
    source: RawInspectorTelemetrySource,
    id: string,
  ): Promise<RawInspectorTelemetryDetail | undefined> {
    void source;
    void id;
    return undefined;
  }

  async listRawAiRuns(filters: RawInspectorAiRunFilters): Promise<RawInspectorAiRunPage> {
    void filters;
    return { items: [] };
  }

  async getRawAiRun(id: string): Promise<RawInspectorAiRunDetail | undefined> {
    void id;
    return undefined;
  }

  async listSpatialHeatmapCells(
    filters: CommandCenterSpatialAnalyticsQueryInput,
  ): Promise<SpatialHeatmapCell[]> {
    const cells = new Map<
      string,
      {
        lngSum: number;
        latSum: number;
        count: number;
        sourceItemCount: number;
        sourceItemIds: string[];
        articleCount: number;
        trafficEventCount: number;
        firstSeenAt: string;
        lastSeenAt: string;
        activeDays: Set<string>;
        timeBuckets: Map<string, NonNullable<SpatialHeatmapCell["timeBuckets"]>[number]>;
        sourceIds: Set<SpatialHeatmapCell["sourceIds"][number]>;
      }
    >();

    for (const item of this.sourceItems.values()) {
      if (item.geoHint?.type !== "Point") continue;
      const observedAt = item.publishedAt ?? item.fetchedAt;
      if (filters.from && observedAt < filters.from) continue;
      if (filters.to && observedAt > filters.to) continue;
      const lng = item.geoHint.coordinates[0];
      const lat = item.geoHint.coordinates[1];
      if (
        typeof lng !== "number" ||
        typeof lat !== "number" ||
        !Number.isFinite(lng) ||
        !Number.isFinite(lat)
      ) {
        continue;
      }
      const key = `cell:${Math.floor(lng * 100)}:${Math.floor(lat * 100)}`;
      const current = cells.get(key) ?? {
        lngSum: 0,
        latSum: 0,
        count: 0,
        sourceItemCount: 0,
        sourceItemIds: [],
        articleCount: 0,
        trafficEventCount: 0,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        activeDays: new Set<string>(),
        timeBuckets: new Map<string, NonNullable<SpatialHeatmapCell["timeBuckets"]>[number]>(),
        sourceIds: new Set<SpatialHeatmapCell["sourceIds"][number]>(),
      };
      current.lngSum += lng;
      current.latSum += lat;
      current.count += 1;
      current.sourceItemCount += 1;
      if (current.sourceItemIds.length < 12) current.sourceItemIds.push(item.id);
      if (item.kind === "article") current.articleCount += 1;
      if (observedAt < current.firstSeenAt) current.firstSeenAt = observedAt;
      if (observedAt > current.lastSeenAt) current.lastSeenAt = observedAt;
      current.activeDays.add(observedAt.slice(0, 10));
      const bucketStart = `${observedAt.slice(0, 10)}T00:00:00.000Z`;
      const bucket = current.timeBuckets.get(bucketStart) ?? {
        bucketStart,
        count: 0,
        sourceItemCount: 0,
        articleCount: 0,
        trafficEventCount: 0,
      };
      bucket.count += 1;
      bucket.sourceItemCount += 1;
      if (item.kind === "article") bucket.articleCount += 1;
      current.timeBuckets.set(bucketStart, bucket);
      current.sourceIds.add(item.provider);
      cells.set(key, current);
    }

    return [...cells.entries()]
      .map(([id, cell]) => {
        const timeBuckets = [...cell.timeBuckets.values()]
          .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart))
          .slice(-14);
        return {
          id,
          center: { lng: cell.lngSum / cell.count, lat: cell.latSum / cell.count },
          radiusMeters: 650,
          count: cell.count,
          sourceItemCount: cell.sourceItemCount,
          ...(cell.sourceItemIds.length ? { sourceItemIds: cell.sourceItemIds } : {}),
          articleCount: cell.articleCount,
          trafficEventCount: cell.trafficEventCount,
          firstSeenAt: cell.firstSeenAt,
          lastSeenAt: cell.lastSeenAt,
          activeDayCount: cell.activeDays.size,
          ...(timeBuckets.length ? { timeBuckets } : {}),
          sourceIds: [...cell.sourceIds],
        };
      })
      .sort(
        (left, right) =>
          right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt),
      )
      .slice(0, filters.limit);
  }

  async listOfficialEvents(_filters: OfficialEventFilters = {}): Promise<OfficialEvent[]> {
    void _filters;
    return [];
  }

  async listTrafficMapEvents(_filters: TrafficMapEventFilters = {}): Promise<TrafficMapEvent[]> {
    void _filters;
    return [];
  }

  async listPublicTransportVehicles(): Promise<PublicTransportVehicle[]> {
    return [];
  }

  async listPublicTransportServiceAlerts(): Promise<PublicTransportServiceAlert[]> {
    return [];
  }

  async listRoadWeatherObservations(): Promise<RoadWeatherObservation[]> {
    return [];
  }

  async listRoadCameras(): Promise<RoadCamera[]> {
    return [];
  }

  async listTrafficCounterSnapshots(_bounds?: Bounds): Promise<TrafficCounterSnapshot[]> {
    void _bounds;
    return [];
  }

  async listTrafficPulseCorridors(_limit = 30): Promise<TrafficPulseCorridor[]> {
    void _limit;
    return [];
  }

  async getTrafficTelemetryHistorySummary(): Promise<CommandCenterTelemetryHistorySummary> {
    return {
      datexTravelTime: {
        observations: 0,
        trackedEntities: 0,
        activeDayCount: 0,
        notableObservations: 0,
      },
      trafficCounters: {
        observations: 0,
        trackedEntities: 0,
        activeDayCount: 0,
        notableObservations: 0,
      },
    };
  }

  async listTrafficTelemetryPatterns(): Promise<TelemetryHistoryPattern[]> {
    return [];
  }

  async listSituationSourceItems(situationId: string): Promise<SourceItem[]> {
    if (!this.situations.has(situationId)) return [];
    const links = [...this.sourceLinks.values()]
      .filter((link) => link.situationId === situationId)
      .sort(
        (left, right) =>
          right.linkedAt.localeCompare(left.linkedAt) ||
          right.sourceItemId.localeCompare(left.sourceItemId),
      );
    return links.flatMap((link) => {
      const item = this.sourceItems.get(link.sourceItemId);
      if (!item) return [];
      return [
        clone({
          ...sourceItemFromRecord(item),
          linkedSituationIds: this.linkedSituationIdsForSourceItem(item.id),
          relationship: link.relationship,
        }),
      ];
    });
  }

  async linkSourceItem(
    situationId: string,
    sourceItemId: string,
    relationship: SourceItemRelationship,
    login: string,
  ): Promise<SourceItem | undefined> {
    const item = this.sourceItems.get(sourceItemId);
    if (!this.situations.has(situationId) || !item) return undefined;
    if (!sourceItemCanUseRelationship(item, relationship)) {
      throw invalidSourceItemRelationshipError();
    }
    this.sourceLinks.set(`${situationId}:${sourceItemId}`, {
      situationId,
      sourceItemId,
      relationship,
      linkedBy: login,
      linkedAt: new Date().toISOString(),
    });
    return clone({
      ...sourceItemFromRecord(item),
      linkedSituationIds: this.linkedSituationIdsForSourceItem(sourceItemId),
      relationship,
    });
  }

  async unlinkSourceItem(situationId: string, sourceItemId: string): Promise<boolean> {
    return this.sourceLinks.delete(`${situationId}:${sourceItemId}`);
  }

  async listSavedArticles(): Promise<Article[]> {
    return clone(this.articles.filter((article) => article.saved));
  }

  async setSaved(articleId: string, saved: boolean): Promise<boolean> {
    const article = this.articles.find((item) => item.id === articleId);
    if (!article) return false;
    article.saved = saved;
    return true;
  }

  async listSituations(filters: SituationFilters): Promise<SituationPage> {
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 30;
    const items = [...this.situations.values()]
      .filter(
        (situation) =>
          (!filters.publicOnly || isPublicSituation(situation)) &&
          ((!filters.status && (filters.includeDismissed || situation.status !== "dismissed")) ||
            situation.status === filters.status) &&
          (!filters.saved || this.savedSituations.has(situation.id)) &&
          beforeCursor(situation.updatedAt, situation.id, cursor),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      );
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((situation) => ({
        ...clone(situation),
        saved: this.savedSituations.has(situation.id),
      })),
      nextCursor: items.length > limit && last ? encodeCursor(last.updatedAt, last.id) : undefined,
    };
  }

  async setSavedSituation(situationId: string, saved: boolean): Promise<boolean> {
    if (!this.situations.has(situationId)) return false;
    if (saved) this.savedSituations.add(situationId);
    else this.savedSituations.delete(situationId);
    return true;
  }

  async setSituationStatus(
    id: string,
    status: Situation["status"],
    dismissalReason?: Situation["dismissalReason"],
  ): Promise<Situation | undefined> {
    const situation = this.situations.get(id);
    if (!situation) return undefined;
    situation.status = status;
    situation.updatedAt = new Date().toISOString();
    if (status === "dismissed") {
      situation.dismissedAt = new Date().toISOString();
      situation.dismissalReason = dismissalReason ?? "owner_dismissed";
    }
    return clone(situation);
  }

  async setSituationPublicVisibility(
    id: string,
    publicVisibility: NonNullable<Situation["publicVisibility"]>,
  ): Promise<Situation | undefined> {
    const situation = this.situations.get(id);
    if (!situation) return undefined;
    situation.publicVisibility = publicVisibility;
    situation.updatedAt = new Date().toISOString();
    return clone(situation);
  }

  async getWorkspace(id: string): Promise<SituationWorkspace | undefined> {
    const situation = this.situations.get(id);
    if (!situation) return undefined;
    return {
      ...clone(sampleWorkspace),
      situation: { ...clone(situation), saved: this.savedSituations.has(id) },
      relatedArticles: clone(this.articles.filter((item) => item.situationId === id)),
      tasks: clone(this.tasks.filter((task) => task.situationId === id)),
      notes: clone(this.notes.filter((note) => note.situationId === id)),
      attachments: clone(this.attachments.filter((attachment) => attachment.situationId === id)),
    };
  }

  async addPrivateFeature(situationId: string, feature: MapFeature): Promise<MapFeature> {
    const situation = this.situations.get(situationId);
    if (!situation) throw new Error("Situation not found");
    situation.features.push(clone(feature));
    return clone(feature);
  }

  async updatePrivateFeature(
    situationId: string,
    featureId: string,
    patch: PrivateAnnotationUpdateRequest,
  ) {
    const feature = this.situations
      .get(situationId)
      ?.features.find((item) => item.id === featureId);
    if (!feature || feature.properties.provenance !== "private_annotation") return undefined;
    feature.properties = {
      ...feature.properties,
      ...patch,
      provenance: "private_annotation",
      updatedAt: new Date().toISOString(),
    };
    return clone(feature);
  }

  async deletePrivateFeature(situationId: string, featureId: string): Promise<boolean> {
    const situation = this.situations.get(situationId);
    if (!situation) return false;
    const before = situation.features.length;
    situation.features = situation.features.filter(
      (feature) =>
        feature.id !== featureId || feature.properties.provenance !== "private_annotation",
    );
    return situation.features.length < before;
  }

  async addTask(situationId: string, text: string): Promise<WorkspaceTask> {
    const task = {
      id: randomUUID(),
      situationId,
      text,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    return clone(task);
  }

  async toggleTask(situationId: string, taskId: string, completed: boolean) {
    const task = this.tasks.find((item) => item.id === taskId && item.situationId === situationId);
    if (!task) return undefined;
    task.completed = completed;
    return clone(task);
  }

  async updateTaskText(situationId: string, taskId: string, text: string) {
    const task = this.tasks.find((item) => item.id === taskId && item.situationId === situationId);
    if (!task) return undefined;
    task.text = text;
    return clone(task);
  }

  async deleteTask(situationId: string, taskId: string) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(
      (task) => task.id !== taskId || task.situationId !== situationId,
    );
    return this.tasks.length < before;
  }

  async addNote(situationId: string, text: string): Promise<WorkspaceNote> {
    const note = { id: randomUUID(), situationId, text, createdAt: new Date().toISOString() };
    this.notes.push(note);
    return clone(note);
  }

  async updateNote(situationId: string, noteId: string, text: string) {
    const note = this.notes.find((item) => item.id === noteId && item.situationId === situationId);
    if (!note) return undefined;
    note.text = text;
    return clone(note);
  }

  async deleteNote(situationId: string, noteId: string) {
    const before = this.notes.length;
    this.notes = this.notes.filter(
      (note) => note.id !== noteId || note.situationId !== situationId,
    );
    return this.notes.length < before;
  }

  async addAttachment(record: AttachmentRecord): Promise<Attachment> {
    this.attachments.push(record);
    return clone({
      id: record.id,
      situationId: record.situationId,
      filename: record.filename,
      contentType: record.contentType,
      size: record.size,
      sha256: record.sha256,
      createdAt: record.createdAt,
    });
  }

  async getAttachment(id: string): Promise<AttachmentRecord | undefined> {
    return clone(this.attachments.find((attachment) => attachment.id === id));
  }

  async deleteAttachment(situationId: string, id: string) {
    const attachment = this.attachments.find(
      (item) => item.id === id && item.situationId === situationId,
    );
    this.attachments = this.attachments.filter(
      (item) => item.id !== id || item.situationId !== situationId,
    );
    return clone(attachment);
  }

  async recordExport(record: ExportRecord): Promise<void> {
    this.exports.push(clone(record));
  }

  async getExport(id: string, situationId: string, login: string) {
    return clone(
      this.exports.find(
        (record) =>
          record.id === id && record.situationId === situationId && record.githubLogin === login,
      ),
    );
  }

  async listSourceHealth() {
    return clone(sampleBootstrap.sourceHealth);
  }

  async listCollectorRuns(
    filters: { source?: SourceId; limit?: number } = {},
  ): Promise<SourceCollectorRun[]> {
    const metrics = await this.getLatestWorkerCycleMetrics();
    if (!metrics) return [];
    const runs = Object.entries(metrics.sourceDurationsMs).map(([source, durationMs]) => ({
      id: `${source}:${metrics.cycleStartedAt}`,
      source: source as SourceId,
      collector: source,
      status: ((metrics.parseFailures[source] ?? 0) > 0
        ? metrics.sourceItemCounts[source]
          ? "partial"
          : "failed"
        : "succeeded") as SourceCollectorRun["status"],
      startedAt: metrics.cycleStartedAt,
      completedAt: metrics.cycleCompletedAt,
      durationMs,
      recordsSeen: (metrics.sourceItemCounts[source] ?? 0) + (metrics.parseFailures[source] ?? 0),
      recordsAccepted: metrics.sourceItemCounts[source] ?? 0,
      recordsRejected: metrics.parseFailures[source] ?? 0,
    })) satisfies SourceCollectorRun[];
    return clone(
      runs
        .filter((run) => !filters.source || run.source === filters.source)
        .slice(0, filters.limit ?? 40),
    );
  }

  async getLatestWorkerCycleMetrics(): Promise<WorkerCycleMetrics | undefined> {
    return clone({
      cycleStartedAt: "2026-06-02T06:00:00.000Z",
      cycleCompletedAt: "2026-06-02T06:00:03.250Z",
      cycleDurationMs: 3250,
      sourceDurationsMs: {
        nrk: 240,
        datex: 920,
        deepseek: 1100,
      },
      sourceItemCounts: {
        nrk: 2,
        datex: 1,
      },
      parseFailures: {
        datex: 0,
      },
    });
  }

  async getSourceAuditWorkspace(filters: SourceAuditFilterQuery, login: string) {
    return buildSourceAuditWorkspace(this, filters, login);
  }

  async getOperationsTimeline(filters: OperationsTimelineQuery, login: string) {
    return buildOperationsTimeline(this, filters, login);
  }

  async getOperationsStatus(): Promise<OperationsStatus> {
    const situationCounts: OperationsStatus["situationCounts"] = {
      preliminary: 0,
      active: 0,
      resolved: 0,
      dismissed: 0,
    };
    const situationPublicationCounts: OperationsStatus["situationPublicationCounts"] = {
      public: 0,
      command_center: 0,
    };
    for (const situation of this.situations.values()) {
      situationCounts[situation.status] += 1;
      situationPublicationCounts[isPublicSituation(situation) ? "public" : "command_center"] += 1;
    }
    return {
      sources: await this.listSourceHealth(),
      articleCount: this.articles.length,
      situationCounts,
      situationPublicationCounts,
      trafficPulse: await this.listTrafficPulseCorridors(),
      workerCycleMetrics: await this.getLatestWorkerCycleMetrics(),
    };
  }

  async getCommandCenterBriefing(login: string): Promise<CommandCenterBriefingPayload> {
    void login;
    const bootstrap = await this.getBootstrap();
    const sourceHealthSummary = briefingSourceHealthSummary(bootstrap.sourceHealth);
    const articleIds = new Set(
      bootstrap.morningBrief?.articleIds ??
        bootstrap.articles.slice(0, 8).map((article) => article.id),
    );
    const situationIds = new Set(
      bootstrap.morningBrief?.situationIds ?? bootstrap.situations.map((situation) => situation.id),
    );
    return {
      generatedAt: bootstrap.morningBrief?.generatedAt ?? new Date().toISOString(),
      ...(bootstrap.morningBrief ? { morningBrief: bootstrap.morningBrief } : {}),
      operationsNotes: [],
      supportingArticles: bootstrap.articles
        .filter((article) => articleIds.has(article.id))
        .map(briefingArticleSummary),
      supportingSituations: bootstrap.situations.filter((situation) =>
        situationIds.has(situation.id),
      ),
      sourceHealthSummary,
      attentionSources: bootstrap.sourceHealth.filter(sourceHasOperationalAttention),
    };
  }
}

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  private async listSituationsForArticleIds(articleIds: string[]): Promise<Situation[]> {
    if (articleIds.length === 0) return [];
    const result = await this.pool.query<{ payload: Situation }>(
      `SELECT payload
       FROM situations
       WHERE status IN ('preliminary', 'active')
         AND COALESCE(payload->>'publicVisibility', 'public') = 'public'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(payload->'relatedArticleIds', '[]'::jsonb)) related(id)
           WHERE related.id = ANY($1::text[])
         )
       ORDER BY updated_at DESC`,
      [articleIds],
    );
    return result.rows.map((row) => row.payload);
  }

  private async listHomeSituationSummaries(limit = 3): Promise<HomeSituationSummary[]> {
    const result = await this.pool.query<{ payload: Situation }>(
      `SELECT payload
       FROM situations
       WHERE status IN ('preliminary', 'active')
         AND COALESCE(payload->>'publicVisibility', 'public') = 'public'
       ORDER BY updated_at DESC, id DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => homeSituationSummary(row.payload));
  }

  private async latestMorningBrief(): Promise<MorningBrief | undefined> {
    const result = await this.pool.query<{ payload: MorningBrief }>(
      `SELECT payload
       FROM morning_briefs
       ORDER BY generated_at DESC, id DESC
       LIMIT 1`,
    );
    return result.rows[0]?.payload;
  }

  private async issuePgAuthToken(
    client: Pick<pg.Pool, "query"> | pg.PoolClient,
    kind: AuthTokenKind,
    ttlMs: number,
    input: {
      accessRequestId?: string;
      userId?: string;
      email?: string;
      createdBy?: string;
    },
  ): Promise<string> {
    const token = newAuthToken();
    await client.query(
      `INSERT INTO auth_tokens (
         id, token_hash, kind, access_request_id, user_id, email, email_normalized,
         expires_at, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        hashAuthToken(token),
        kind,
        input.accessRequestId ?? null,
        input.userId ?? null,
        input.email ?? null,
        input.email ? normalizeAccessRequestEmail(input.email) : null,
        expiresAt(ttlMs),
        input.createdBy ?? null,
      ],
    );
    return token;
  }

  private async rowForUserId(
    client: Pick<pg.Pool, "query"> | pg.PoolClient,
    id: string,
  ): Promise<AppUser | undefined> {
    const result = await client.query<UserRow>(
      `SELECT id, display_name AS "displayName", email, role, status,
              created_at AS "createdAt", updated_at AS "updatedAt",
              last_login_at AS "lastLoginAt"
       FROM users
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? appUserFromRow(result.rows[0]) : undefined;
  }

  private async createOrReactivatePgViewer(
    client: Pick<pg.Pool, "query"> | pg.PoolClient,
    input: UserGrantInput,
  ): Promise<AppUser> {
    const userResult = await client.query<UserRow>(
      `INSERT INTO users (id, email, email_normalized, display_name, role, status)
       VALUES ($1,$2,$3,$4,'viewer','active')
       ON CONFLICT (email_normalized) WHERE email_normalized IS NOT NULL DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role = 'viewer',
         status = 'active',
         updated_at = now()
       RETURNING id, display_name AS "displayName", email, role, status,
                 created_at AS "createdAt", updated_at AS "updatedAt",
                 last_login_at AS "lastLoginAt"`,
      [randomUUID(), input.email, normalizeAccessRequestEmail(input.email), input.displayName],
    );
    const user = appUserFromRow(userResult.rows[0]!);
    await client.query(
      `INSERT INTO user_identities (id, user_id, provider, provider_subject)
       VALUES ($1,$2,'email',$3)
       ON CONFLICT (provider, provider_subject) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         updated_at = now()`,
      [randomUUID(), user.id, normalizeAccessRequestEmail(input.email)],
    );
    return user;
  }

  async createAccessRequest(input: AccessRequestInput): Promise<AccessRequestSubmissionResult> {
    const result = await this.pool.query<AccessRequestRow>(
      `INSERT INTO access_requests (id, email, email_normalized, display_name, message, status)
       VALUES ($1,$2,$3,$4,$5,'unverified')
       ON CONFLICT (email_normalized) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         message = EXCLUDED.message,
         status = CASE
           WHEN access_requests.status = 'approved' THEN access_requests.status
           WHEN access_requests.email_verified_at IS NOT NULL THEN 'pending'
           ELSE 'unverified'
         END,
         email_verified_at = CASE
           WHEN access_requests.status = 'approved' THEN access_requests.email_verified_at
           WHEN access_requests.email_verified_at IS NOT NULL THEN access_requests.email_verified_at
           ELSE NULL
         END,
         requested_at = CASE
           WHEN access_requests.status = 'approved' THEN access_requests.requested_at
           ELSE now()
         END,
         reviewed_at = CASE
           WHEN access_requests.status = 'approved' THEN access_requests.reviewed_at
           ELSE NULL
         END,
         reviewed_by = CASE
           WHEN access_requests.status = 'approved' THEN access_requests.reviewed_by
           ELSE NULL
         END,
         reviewer_note = CASE
           WHEN access_requests.status = 'approved' THEN access_requests.reviewer_note
           ELSE NULL
         END,
         updated_at = now()
       RETURNING id, display_name AS "displayName", email, message, status,
                 requested_at AS "requestedAt", updated_at AS "updatedAt",
                 email_verified_at AS "emailVerifiedAt",
                 reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy",
                 reviewer_note AS "reviewerNote"`,
      [
        randomUUID(),
        input.email,
        normalizeAccessRequestEmail(input.email),
        input.displayName,
        input.message ?? null,
      ],
    );
    const request = accessRequestFromRow(result.rows[0]!);
    if (request.status !== "unverified") return { status: "received" };
    const token = await this.issuePgAuthToken(this.pool, "access_verify", accessVerificationTtlMs, {
      accessRequestId: request.id,
      email: request.email,
    });
    return {
      status: "received",
      verification: { email: request.email, displayName: request.displayName, token },
    };
  }

  async verifyAccessRequestToken(token: string): Promise<"verified" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tokenResult = await client.query<{ access_request_id: string }>(
        `UPDATE auth_tokens
         SET consumed_at = now()
         WHERE token_hash = $1
           AND kind = 'access_verify'
           AND consumed_at IS NULL
           AND expires_at > now()
         RETURNING access_request_id`,
        [hashAuthToken(token)],
      );
      const requestId = tokenResult.rows[0]?.access_request_id;
      if (!requestId) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      await client.query(
        `UPDATE access_requests
         SET email_verified_at = COALESCE(email_verified_at, now()),
             status = CASE WHEN status = 'unverified' THEN 'pending' ELSE status END,
             updated_at = now()
         WHERE id = $1`,
        [requestId],
      );
      await client.query("COMMIT");
      return "verified";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAccessRequests(filters: AccessRequestQueryInput): Promise<AccessRequestPage> {
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor.timestamp, cursor.id ?? "");
      const timestampIndex = params.length - 1;
      const idIndex = params.length;
      where.push(
        `(requested_at < $${timestampIndex}::timestamptz OR (requested_at = $${timestampIndex}::timestamptz AND id < $${idIndex}))`,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = filters.limit ?? 50;
    params.push(limit + 1);
    const limitIndex = params.length;
    const [rows, summary] = await Promise.all([
      this.pool.query<AccessRequestRow>(
        `SELECT id, display_name AS "displayName", email, message, status,
                requested_at AS "requestedAt", updated_at AS "updatedAt",
                email_verified_at AS "emailVerifiedAt",
                reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy",
                reviewer_note AS "reviewerNote"
         FROM access_requests
         ${whereSql}
         ORDER BY requested_at DESC, id DESC
         LIMIT $${limitIndex}`,
        params,
      ),
      this.pool.query<{
        total: string;
        unverified: string;
        pending: string;
        approved: string;
        rejected: string;
      }>(
        `SELECT
           count(*)::text AS total,
           count(*) FILTER (WHERE status = 'unverified')::text AS unverified,
           count(*) FILTER (WHERE status = 'pending')::text AS pending,
           count(*) FILTER (WHERE status = 'approved')::text AS approved,
           count(*) FILTER (WHERE status = 'rejected')::text AS rejected
         FROM access_requests
         ${filters.status ? "WHERE status = $1" : ""}`,
        filters.status ? [filters.status] : [],
      ),
    ]);
    const hasNextPage = rows.rows.length > limit;
    const items = rows.rows.slice(0, limit).map(accessRequestFromRow);
    const last = items.at(-1);
    return {
      items,
      summary: {
        total: Number(summary.rows[0]?.total ?? 0),
        unverified: Number(summary.rows[0]?.unverified ?? 0),
        pending: Number(summary.rows[0]?.pending ?? 0),
        approved: Number(summary.rows[0]?.approved ?? 0),
        rejected: Number(summary.rows[0]?.rejected ?? 0),
      },
      nextCursor: hasNextPage && last ? encodeCursor(last.requestedAt, last.id) : undefined,
    };
  }

  async decideAccessRequest(
    id: string,
    input: AccessRequestDecisionInput,
    login: string,
  ): Promise<AccessRequestDecisionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<AccessRequestRow>(
        `SELECT id, display_name AS "displayName", email, message, status,
                requested_at AS "requestedAt", updated_at AS "updatedAt",
                email_verified_at AS "emailVerifiedAt",
                reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy",
                reviewer_note AS "reviewerNote"
         FROM access_requests
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      const existing = current.rows[0] ? accessRequestFromRow(current.rows[0]) : undefined;
      if (!existing) {
        await client.query("ROLLBACK");
        throw Object.assign(new Error("Tilgangsforespørselen finnes ikke."), { status: 404 });
      }
      if (input.status === "approved" && !existing.emailVerifiedAt) {
        await client.query("ROLLBACK");
        throw Object.assign(new Error("E-post må verifiseres før godkjenning."), { status: 400 });
      }
      const updated = await client.query<AccessRequestRow>(
        `UPDATE access_requests
         SET status = $2, reviewed_at = now(), reviewed_by = $3,
             reviewer_note = $4, updated_at = now()
         WHERE id = $1
         RETURNING id, display_name AS "displayName", email, message, status,
                   requested_at AS "requestedAt", updated_at AS "updatedAt",
                   email_verified_at AS "emailVerifiedAt",
                   reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy",
                   reviewer_note AS "reviewerNote"`,
        [id, input.status, login, input.reviewerNote ?? null],
      );
      const request = accessRequestFromRow(updated.rows[0]!);
      if (input.status === "rejected") {
        await client.query("COMMIT");
        return { request };
      }
      const user = await this.createOrReactivatePgViewer(client, request);
      const token = await this.issuePgAuthToken(client, "invite", inviteTtlMs, {
        userId: user.id,
        email: request.email,
        createdBy: login,
      });
      await client.query("COMMIT");
      return {
        request,
        invite: { email: request.email, displayName: request.displayName, token },
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async grantUserAccess(input: UserGrantInput, login: string): Promise<UserGrantResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await this.createOrReactivatePgViewer(client, input);
      const token = await this.issuePgAuthToken(client, "invite", inviteTtlMs, {
        userId: user.id,
        email: input.email,
        createdBy: login,
      });
      await client.query("COMMIT");
      return {
        user,
        invite: { email: input.email, displayName: input.displayName, token },
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async requestEmailLogin(email: string): Promise<EmailLoginRequestResult> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, display_name AS "displayName", email, role, status,
              created_at AS "createdAt", updated_at AS "updatedAt",
              last_login_at AS "lastLoginAt"
       FROM users
       WHERE email_normalized = $1 AND status = 'active'
       LIMIT 1`,
      [normalizeAccessRequestEmail(email)],
    );
    const user = result.rows[0] ? appUserFromRow(result.rows[0]) : undefined;
    if (!user || !user.email) return { status: "received" };
    const token = await this.issuePgAuthToken(this.pool, "login", loginTtlMs, {
      userId: user.id,
      email: user.email,
    });
    return {
      status: "received",
      login: { email: user.email, displayName: user.displayName, token },
    };
  }

  async consumeEmailLoginToken(token: string): Promise<AuthUser | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tokenResult = await client.query<{ user_id: string }>(
        `UPDATE auth_tokens
         SET consumed_at = now()
         WHERE token_hash = $1
           AND kind = ANY($2::text[])
           AND consumed_at IS NULL
           AND expires_at > now()
         RETURNING user_id`,
        [hashAuthToken(token), ["invite", "login"]],
      );
      const userId = tokenResult.rows[0]?.user_id;
      if (!userId) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const userResult = await client.query<UserRow>(
        `UPDATE users
         SET last_login_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING id, display_name AS "displayName", email, role, status,
                   created_at AS "createdAt", updated_at AS "updatedAt",
                   last_login_at AS "lastLoginAt"`,
        [userId],
      );
      const user = userResult.rows[0] ? appUserFromRow(userResult.rows[0]) : undefined;
      if (!user) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query("COMMIT");
      return authUserFromAppUser(user);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listUsers(): Promise<UserPage> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, display_name AS "displayName", email, role, status,
              created_at AS "createdAt", updated_at AS "updatedAt",
              last_login_at AS "lastLoginAt"
       FROM users
       ORDER BY created_at DESC, id DESC`,
    );
    const items = result.rows.map(appUserFromRow);
    return { items, summary: summarizeUsers(items) };
  }

  async updateUser(id: string, input: UserUpdateInput, login: string): Promise<UserUpdateResult> {
    const current = await this.rowForUserId(this.pool, id);
    if (!current) throw Object.assign(new Error("Brukeren finnes ikke."), { status: 404 });
    if (current.role === "owner" && input.status === "revoked") {
      throw Object.assign(new Error("Eierkontoen kan ikke tilbakekalles her."), { status: 400 });
    }
    const result = await this.pool.query<UserRow>(
      `UPDATE users
       SET status = COALESCE($2, status), updated_at = now()
       WHERE id = $1
       RETURNING id, display_name AS "displayName", email, role, status,
                 created_at AS "createdAt", updated_at AS "updatedAt",
                 last_login_at AS "lastLoginAt"`,
      [id, input.status ?? null],
    );
    const user = appUserFromRow(result.rows[0]!);
    if (!input.resendInvite || !user.email || user.status !== "active") return { user };
    const token = await this.issuePgAuthToken(this.pool, "invite", inviteTtlMs, {
      userId: user.id,
      email: user.email,
      createdBy: login,
    });
    return {
      user,
      invite: { email: user.email, displayName: user.displayName, token },
    };
  }

  async ensureGitHubOwner(profile: Profile, allowedLogin: string): Promise<AuthUser | false> {
    const authorized = authorizeGitHubProfileForStore(profile, allowedLogin);
    if (!authorized) return false;
    const subject = authorized.login.toLocaleLowerCase("nb");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<UserRow & { login: string }>(
        `SELECT u.id, u.display_name AS "displayName", u.email, u.role, u.status,
                u.created_at AS "createdAt", u.updated_at AS "updatedAt",
                u.last_login_at AS "lastLoginAt", ui.provider_subject AS login
         FROM user_identities ui
         JOIN users u ON u.id = ui.user_id
         WHERE ui.provider = 'github' AND ui.provider_subject = $1
         FOR UPDATE`,
        [subject],
      );
      let user = existing.rows[0] ? appUserFromRow(existing.rows[0]) : undefined;
      if (!user) {
        const inserted = await client.query<UserRow>(
          `INSERT INTO users (id, display_name, role, status)
           VALUES ($1,$2,'owner','active')
           RETURNING id, display_name AS "displayName", email, role, status,
                     created_at AS "createdAt", updated_at AS "updatedAt",
                     last_login_at AS "lastLoginAt"`,
          [randomUUID(), authorized.displayName],
        );
        user = appUserFromRow(inserted.rows[0]!);
        await client.query(
          `INSERT INTO user_identities (id, user_id, provider, provider_subject)
           VALUES ($1,$2,'github',$3)
           ON CONFLICT (provider, provider_subject) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             updated_at = now()`,
          [randomUUID(), user.id, subject],
        );
      } else {
        const updated = await client.query<UserRow>(
          `UPDATE users
           SET display_name = $2, role = 'owner', status = 'active',
               last_login_at = now(), updated_at = now()
           WHERE id = $1
           RETURNING id, display_name AS "displayName", email, role, status,
                     created_at AS "createdAt", updated_at AS "updatedAt",
                     last_login_at AS "lastLoginAt"`,
          [user.id, authorized.displayName],
        );
        user = appUserFromRow(updated.rows[0]!);
      }
      await client.query("COMMIT");
      return {
        ...authUserFromAppUser(user),
        login: authorized.login,
        avatarUrl: authorized.avatarUrl,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async seedDevelopmentData(): Promise<void> {
    for (const article of sampleArticles) {
      await this.pool.query(
        `INSERT INTO articles (id, canonical_url, dedupe_key, source, published_at, scope, category, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          article.id,
          article.url,
          article.id,
          article.source,
          article.publishedAt,
          article.scope,
          article.category,
          article,
        ],
      );
    }
    await this.pool.query(
      `INSERT INTO situations (id, type, status, verification_status, importance, updated_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        sampleSituation.id,
        sampleSituation.type,
        sampleSituation.status,
        sampleSituation.verificationStatus,
        sampleSituation.importance,
        sampleSituation.updatedAt,
        sampleSituation,
      ],
    );
    for (const health of sampleBootstrap.sourceHealth) {
      await this.pool.query(
        `INSERT INTO source_health (source, label, state, last_checked_at, detail)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source) DO NOTHING`,
        [health.source, health.label, health.state, health.lastCheckedAt ?? null, health.detail],
      );
    }
  }

  async getBootstrap(login: string): Promise<BootstrapPayload> {
    const [storyPage, situations, sourceHealth, latestMorningBrief, latestAiRun] =
      await Promise.all([
        this.listCityPulseStories({ scope: "trondheim", limit: 40 }, login),
        this.listHomeSituationSummaries(),
        this.listSourceHealth(),
        this.latestMorningBrief(),
        this.pool.query<{
          provider: AiProcessingRun["provider"];
          model: string;
          status: AiProcessingRun["status"];
          completedAt: Date | string;
          result: unknown;
        }>(
          `SELECT provider, model, status, completed_at AS "completedAt", result
         FROM ai_processing_runs
         ORDER BY completed_at DESC
         LIMIT 1`,
        ),
      ]);
    const bootstrapPayload = {
      articles: articlesFromCityPulseStoryPage(storyPage),
      stories: storyPage.items,
      ...(storyPage.nextCursor ? { storyNextCursor: storyPage.nextCursor } : {}),
      situations,
      sourceHealth,
    };
    if (latestMorningBrief) return { ...bootstrapPayload, morningBrief: latestMorningBrief };
    const latestAiRunRow = latestAiRun.rows[0];
    return bootstrapWithMorningBrief(
      bootstrapPayload,
      latestAiRunRow
        ? {
            provider: latestAiRunRow.provider,
            model: latestAiRunRow.model,
            status: latestAiRunRow.status,
            completedAt: new Date(latestAiRunRow.completedAt).toISOString(),
            result: latestAiRunRow.result,
          }
        : undefined,
    );
  }

  async getCommandCenterBriefing(login: string): Promise<CommandCenterBriefingPayload> {
    const [bootstrap, latestAiRunResult] = await Promise.all([
      this.getBootstrap(login),
      this.pool.query<AiProcessingRunRow>(
        `SELECT id, provider, model, status, started_at, completed_at,
          to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed_at_cursor,
          article_ids, result, error
         FROM ai_processing_runs
         ORDER BY completed_at DESC, id DESC
         LIMIT 1`,
      ),
    ]);
    const morningBrief = bootstrap.morningBrief;
    const articleIds = [...new Set(morningBrief?.articleIds ?? [])];
    const situationIds = [...new Set(morningBrief?.situationIds ?? [])];
    const [articleResult, situationResult] = await Promise.all([
      articleIds.length
        ? this.pool.query<{ payload: Article }>(
            "SELECT payload FROM articles WHERE id = ANY($1::text[])",
            [articleIds],
          )
        : Promise.resolve({ rows: [] as Array<{ payload: Article }> }),
      situationIds.length
        ? this.pool.query<{ payload: Situation }>(
            "SELECT payload FROM situations WHERE id = ANY($1::text[])",
            [situationIds],
          )
        : Promise.resolve({ rows: [] as Array<{ payload: Situation }> }),
    ]);
    const articlesById = new Map(articleResult.rows.map((row) => [row.payload.id, row.payload]));
    const situationsById = new Map(
      situationResult.rows.map((row) => [row.payload.id, homeSituationSummary(row.payload)]),
    );
    const latestAiRun = latestAiRunResult.rows[0];
    const sourceHealthSummary = briefingSourceHealthSummary(bootstrap.sourceHealth);
    return {
      generatedAt:
        morningBrief?.generatedAt ??
        (latestAiRun ? new Date(latestAiRun.completed_at).toISOString() : new Date().toISOString()),
      ...(morningBrief ? { morningBrief } : {}),
      ...(latestAiRun ? { latestAiRun: rawAiRunSummaryFromRow(latestAiRun) } : {}),
      operationsNotes: latestAiRun ? operationsNotesFromAiResult(latestAiRun.result) : [],
      supportingArticles: articleIds
        .map((id) => articlesById.get(id))
        .filter((article): article is Article => Boolean(article))
        .map(briefingArticleSummary),
      supportingSituations: situationIds
        .map((id) => situationsById.get(id))
        .filter((situation): situation is HomeSituationSummary => Boolean(situation)),
      sourceHealthSummary,
      attentionSources: bootstrap.sourceHealth.filter(sourceHasOperationalAttention),
    };
  }

  async listArticles(filters: ArticleFilters, login: string): Promise<ArticlePage> {
    const params: unknown[] = [login];
    const where: string[] = [];
    if (filters.scope) {
      params.push(filters.scope);
      where.push(`a.scope = $${params.length}`);
    }
    if (filters.category && filters.category !== "Alle") {
      params.push(filters.category);
      const categoryParam = `$${params.length}`;
      where.push(
        filters.category === "Sport"
          ? sportCategorySqlPredicate(categoryParam)
          : `a.category = ${categoryParam}`,
      );
    }
    if (filters.topic === "rosenborg") {
      params.push(filters.topic);
      const topicIndex = params.length;
      where.push(rosenborgTopicSqlPredicate(`$${topicIndex}`));
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(a.payload->>'title' ILIKE $${params.length}
          OR a.payload->>'excerpt' ILIKE $${params.length}
          OR a.payload->>'sourceLabel' ILIKE $${params.length}
          OR a.category ILIKE $${params.length}
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(a.payload->'places', '[]'::jsonb)) place_name(value)
            WHERE place_name.value ILIKE $${params.length}
          ))`,
      );
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`a.published_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`a.published_at <= $${params.length}`);
    }
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(a.published_at < $${timestampIndex} OR (a.published_at = $${timestampIndex} AND a.id < $${params.length}))`,
        );
      } else {
        where.push(`a.published_at < $${timestampIndex}`);
      }
    }
    params.push((filters.limit ?? 40) + 1);
    const result = await this.pool.query<{ payload: Article; saved: boolean }>(
      `SELECT a.payload, (s.article_id IS NOT NULL) AS saved
       FROM articles a LEFT JOIN saved_articles s ON s.article_id = a.id AND s.github_login = $1
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.published_at DESC, a.id DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 40;
    const rawItems = result.rows
      .slice(0, limit)
      .map((row) => ({ ...row.payload, saved: row.saved }));
    const relatedSituations = await this.listSituationsForArticleIds(
      rawItems.map((article) => article.id),
    );
    const officialEvents = rawItems.some(
      (article) =>
        article.category === "Transport" &&
        article.location &&
        isNewsroomPublicVerificationSource(article.source),
    )
      ? await this.listOfficialEvents({ source: "datex", limit: 500 })
      : [];
    const items = enrichArticlesWithCoverageGroupVerification(
      enrichArticlesWithTrafficOfficialVerification(
        enrichArticlesWithSituations(rawItems, relatedSituations),
        officialEvents,
      ),
    );
    return {
      items,
      nextCursor:
        result.rows.length > limit && items.at(-1)
          ? encodeCursor(items.at(-1)!.publishedAt, items.at(-1)!.id)
          : undefined,
    };
  }

  async listCityPulseStories(filters: ArticleFilters, login: string): Promise<CityPulseStoryPage> {
    const articles = await this.listArticles(
      {
        ...filters,
        cursor: undefined,
        limit: cityPulseStorySourceLimit(filters),
      },
      login,
    );
    return cityPulseStoryPageFromArticles(articles.items, filters);
  }

  async listCoverageBundles(filters: CoverageBundleQueryInput): Promise<CoverageBundlePage> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.kind) {
      params.push(filters.kind);
      where.push(`cb.kind = $${params.length}`);
    }
    if (filters.confidence) {
      params.push(filters.confidence);
      where.push(`cb.confidence = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(cb.id ILIKE $${params.length}
          OR cb.reason ILIKE $${params.length}
          OR array_to_string(cb.source_labels, ' ') ILIKE $${params.length}
          OR EXISTS (
            SELECT 1 FROM articles a
            WHERE a.id = ANY(cb.member_article_ids)
              AND (
                a.payload->>'title' ILIKE $${params.length}
                OR a.payload->>'excerpt' ILIKE $${params.length}
                OR a.payload::text ILIKE $${params.length}
              )
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(cb.near_misses) AS near_miss(item)
            JOIN LATERAL jsonb_array_elements_text(
              COALESCE(near_miss.item->'articleIds', '[]'::jsonb)
            ) AS near_miss_article(id) ON true
            JOIN articles a ON a.id = near_miss_article.id
            WHERE a.payload->>'title' ILIKE $${params.length}
              OR a.payload->>'excerpt' ILIKE $${params.length}
              OR a.payload::text ILIKE $${params.length}
          ))`,
      );
    }

    const summaryParams = [...params];
    const summaryWhere = [...where];
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(cb.last_seen_at < $${timestampIndex} OR (cb.last_seen_at = $${timestampIndex} AND cb.id < $${params.length}))`,
        );
      } else {
        where.push(`cb.last_seen_at < $${timestampIndex}`);
      }
    }

    params.push((filters.limit ?? 30) + 1);
    const result = await this.pool.query<CoverageBundleRow>(
      `SELECT cb.id, cb.kind, cb.confidence, cb.reason, cb.generated_at, cb.last_seen_at,
        to_char(cb.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_seen_at_cursor,
        cb.primary_article_id, cb.member_article_ids, cb.source_ids, cb.source_labels,
        cb.signals, cb.near_misses, cb.updated_at
       FROM coverage_bundles cb
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY cb.last_seen_at DESC, cb.id DESC
       LIMIT $${params.length}`,
      params,
    );
    const articleIds = [
      ...new Set(
        result.rows.flatMap((row) => [
          ...row.member_article_ids,
          ...row.near_misses.flatMap((nearMiss) => nearMiss.articleIds),
        ]),
      ),
    ];
    const articleResult = articleIds.length
      ? await this.pool.query<{ payload: Article }>(
          "SELECT payload FROM articles WHERE id = ANY($1::text[])",
          [articleIds],
        )
      : { rows: [] };
    const articlesById = new Map(articleResult.rows.map((row) => [row.payload.id, row.payload]));
    const limit = filters.limit ?? 30;
    const visibleRows = result.rows.slice(0, limit);
    const items = visibleRows.map((row) => coverageBundleItemFromRow(row, articlesById));

    const summaryResult = await this.pool.query<{
      total: string;
      incident: string;
      topic: string;
      update: string;
      high: string;
      medium: string;
      latest_generated_at: Date | string | null;
    }>(
      `SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE cb.kind = 'incident')::text AS incident,
        count(*) FILTER (WHERE cb.kind = 'topic')::text AS topic,
        count(*) FILTER (WHERE cb.kind = 'update')::text AS update,
        count(*) FILTER (WHERE cb.confidence = 'high')::text AS high,
        count(*) FILTER (WHERE cb.confidence = 'medium')::text AS medium,
        max(cb.generated_at) AS latest_generated_at
       FROM coverage_bundles cb
       ${summaryWhere.length ? `WHERE ${summaryWhere.join(" AND ")}` : ""}`,
      summaryParams,
    );
    const summaryRow = summaryResult.rows[0];
    const summary: CoverageBundleSummary = summaryRow
      ? {
          recentBundleCount: Number(summaryRow.total),
          byKind: {
            incident: Number(summaryRow.incident),
            topic: Number(summaryRow.topic),
            update: Number(summaryRow.update),
          },
          byConfidence: {
            high: Number(summaryRow.high),
            medium: Number(summaryRow.medium),
          },
          ...(summaryRow.latest_generated_at
            ? { latestGeneratedAt: new Date(summaryRow.latest_generated_at).toISOString() }
            : {}),
        }
      : emptyCoverageBundleSummary();
    const lastRow = visibleRows.at(-1);
    return {
      items,
      summary,
      nextCursor:
        result.rows.length > limit && lastRow
          ? encodeCursor(lastRow.last_seen_at_cursor, lastRow.id)
          : undefined,
    };
  }

  async listNotificationTriggers(
    filters: NotificationTriggerQueryInput,
    login: string,
  ): Promise<NotificationTriggerPage> {
    const generatedAt = new Date().toISOString();
    const [situations, articles, trafficInfoEvents, officialEvents, trafficPulse, trafficCounters] =
      await Promise.all([
        this.listSituations({ includeDismissed: false, limit: 100, publicOnly: true }, login),
        this.listArticles({ limit: 500 }, login),
        this.listTrafficMapEvents({
          sources: ["vegvesen_traffic_info"],
          states: ["active", "planned"],
          limit: null,
        }),
        this.listOfficialEvents({ source: "datex", states: ["active", "updated"], limit: 200 }),
        this.listTrafficPulseCorridors(50),
        this.listTrafficCounterSnapshots(),
      ]);
    const spatialInvestigationItems = buildSpatialNotificationItems({
      articles: articles.items,
      trafficInfoEvents,
      officialEvents,
      trafficPulse,
      trafficCounters,
    });
    return buildNotificationTriggerPage({
      situations: situations.items,
      articles: articles.items,
      spatialInvestigationItems,
      generatedAt,
      filters,
    });
  }

  async getPushSettings(userId: string, publicKey?: string): Promise<PushNotificationSettings> {
    const result = await this.pool.query<PushSubscriptionRow>(
      `SELECT
         id,
         endpoint_hash AS "endpointHash",
         enabled,
         min_severity AS "minSeverity",
         kinds,
         user_agent AS "userAgent",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         last_seen_at AS "lastSeenAt",
         last_success_at AS "lastSuccessAt",
         last_failure_at AS "lastFailureAt",
         failure_count AS "failureCount"
       FROM push_subscriptions
       WHERE user_id=$1 AND revoked_at IS NULL
       ORDER BY last_seen_at DESC, id DESC`,
      [userId],
    );
    return {
      configured: Boolean(publicKey),
      ...(publicKey ? { publicKey } : {}),
      subscriptions: result.rows.map(pushSubscriptionFromRow),
    };
  }

  async upsertPushSubscription(
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<PushSubscriptionSummary> {
    const endpointHash = pushEndpointHash(input.endpoint);
    const result = await this.pool.query<PushSubscriptionRow>(
      `INSERT INTO push_subscriptions
        (id, user_id, endpoint, endpoint_hash, p256dh, auth, user_agent, enabled, min_severity, kinds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
       ON CONFLICT (endpoint_hash) DO UPDATE SET
         user_id=EXCLUDED.user_id,
         endpoint=EXCLUDED.endpoint,
         p256dh=EXCLUDED.p256dh,
         auth=EXCLUDED.auth,
         user_agent=EXCLUDED.user_agent,
         enabled=true,
         min_severity=EXCLUDED.min_severity,
         kinds=EXCLUDED.kinds,
         revoked_at=NULL,
         updated_at=now(),
         last_seen_at=now()
       RETURNING
         id,
         endpoint_hash AS "endpointHash",
         enabled,
         min_severity AS "minSeverity",
         kinds,
         user_agent AS "userAgent",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         last_seen_at AS "lastSeenAt",
         last_success_at AS "lastSuccessAt",
         last_failure_at AS "lastFailureAt",
         failure_count AS "failureCount"`,
      [
        randomUUID(),
        userId,
        input.endpoint,
        endpointHash,
        input.keys.p256dh,
        input.keys.auth,
        input.userAgent ?? null,
        input.minSeverity ?? "warning",
        input.kinds ?? [],
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Kunne ikke lagre push-abonnement.");
    return pushSubscriptionFromRow(row);
  }

  async deletePushSubscription(userId: string, id: string): Promise<void> {
    await this.pool.query(
      `UPDATE push_subscriptions
       SET enabled=false, revoked_at=now(), updated_at=now()
       WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
  }

  async listPushSubscriptionPreferences(): Promise<NotificationSubscriptionPreference[]> {
    const result = await this.pool.query<{
      enabled: boolean;
      minSeverity: NotificationSubscriptionPreference["minSeverity"];
      kinds: NotificationSubscriptionPreference["kinds"];
    }>(
      `SELECT
         ps.enabled,
         ps.min_severity AS "minSeverity",
         ps.kinds
       FROM push_subscriptions ps
       LEFT JOIN users u ON u.id=ps.user_id
       WHERE ps.enabled=true AND ps.revoked_at IS NULL
         AND COALESCE(u.status, 'active') = 'active'
       ORDER BY ps.last_seen_at DESC, ps.id DESC`,
    );
    return result.rows.map((row) => ({
      enabled: row.enabled,
      minSeverity: row.minSeverity,
      kinds: row.kinds ?? [],
    }));
  }

  async listPushDeliveries(limit: number): Promise<PushDeliveryPage> {
    const result = await this.pool.query<PushDeliveryRow>(
      `SELECT
         id,
         trigger_id AS "triggerId",
         subscription_id AS "subscriptionId",
         user_id AS "userId",
         status,
         kind,
         severity,
         title,
         body,
         target_url AS "targetUrl",
         error_message AS "errorMessage",
         payload,
         created_at AS "createdAt",
         sent_at AS "sentAt"
       FROM push_notification_deliveries
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [limit],
    );
    const items = result.rows.map(pushDeliveryFromRow);
    return {
      generatedAt: new Date().toISOString(),
      items,
      summary: summarizePushDeliveries(items),
    };
  }

  async listSourceItems(filters: SourceItemFilters): Promise<SourceItemPage> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.provider) {
      params.push(filters.provider);
      where.push(`si.provider = $${params.length}`);
    }
    if (filters.kind) {
      params.push(filters.kind);
      where.push(`si.kind = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(si.title ILIKE $${params.length} OR si.summary ILIKE $${params.length} OR si.original_url ILIKE $${params.length})`,
      );
    }
    if (filters.unlinked) {
      where.push(
        "NOT EXISTS (SELECT 1 FROM situation_source_items unlinked_ssi WHERE unlinked_ssi.source_item_id = si.id)",
      );
    }
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(si.fetched_at < $${timestampIndex} OR (si.fetched_at = $${timestampIndex} AND si.id < $${params.length}))`,
        );
      } else {
        where.push(`si.fetched_at < $${timestampIndex}`);
      }
    }
    params.push((filters.limit ?? 40) + 1);
    const result = await this.pool.query<SourceItemRow>(
      `SELECT ${sourceItemSelectColumns("si")}
       FROM source_items si
       LEFT JOIN LATERAL (
         SELECT COALESCE(array_agg(ssi.situation_id ORDER BY ssi.situation_id), '{}') AS linked_situation_ids
         FROM situation_source_items ssi WHERE ssi.source_item_id = si.id
       ) links ON true
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY si.fetched_at DESC, si.id DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 40;
    const visibleRows = result.rows.slice(0, limit);
    const items = visibleRows.map(sourceItemFromRow);
    const lastRow = visibleRows.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > limit && lastRow
          ? encodeCursor(lastRow.fetched_at_cursor, lastRow.id)
          : undefined,
    };
  }

  async getRawSourceItem(
    id: string,
    _login: string,
  ): Promise<RawInspectorSourceItemDetail | undefined> {
    void _login;
    const record = await this.getSourceItemRecord(id);
    return record ? rawSourceItemDetailFromRecord(record) : undefined;
  }

  async listRawTelemetry(
    filters: RawInspectorTelemetryFilters,
    _login: string,
  ): Promise<RawInspectorTelemetryPage> {
    void _login;
    const limit = filters.limit ?? 20;
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const pageLimit = limit + 1;
    const items: RawInspectorTelemetrySummary[] = [];
    const sources = filters.source
      ? [filters.source]
      : (["datex_travel_time", "trafikkdata"] satisfies RawInspectorTelemetrySource[]);

    if (sources.includes("datex_travel_time")) {
      const params: unknown[] = [];
      const where: string[] = [];
      if (filters.q) {
        params.push(`%${filters.q}%`);
        where.push(
          `(id ILIKE $${params.length}
            OR name ILIKE $${params.length}
            OR state ILIKE $${params.length}
            OR source_url ILIKE $${params.length})`,
        );
      }
      if (cursor) {
        params.push(cursor.timestamp);
        const timestampIndex = params.length;
        if (cursor.id) {
          params.push(cursor.id);
          where.push(
            `(updated_at < $${timestampIndex}
              OR (updated_at = $${timestampIndex}
                AND ('datex_travel_time:' || id) < $${params.length}))`,
          );
        } else {
          where.push(`updated_at < $${timestampIndex}`);
        }
      }
      params.push(pageLimit);
      const result = await this.pool.query<RawDatexTravelTimeSummaryRow>(
        `SELECT id, name, state, delay_seconds, measurement_to, source_url, updated_at,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_cursor
         FROM datex_travel_times
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY updated_at DESC, id DESC
         LIMIT $${params.length}`,
        params,
      );
      items.push(...result.rows.map(rawDatexTravelTimeSummaryFromRow));
    }

    if (sources.includes("trafikkdata")) {
      const params: unknown[] = [];
      const where: string[] = [];
      if (filters.q) {
        params.push(`%${filters.q}%`);
        where.push(
          `(point_id ILIKE $${params.length}
            OR COALESCE(payload->>'name', '') ILIKE $${params.length}
            OR payload::text ILIKE $${params.length})`,
        );
      }
      if (cursor) {
        params.push(cursor.timestamp);
        const timestampIndex = params.length;
        if (cursor.id) {
          params.push(cursor.id);
          where.push(
            `(updated_at < $${timestampIndex}
              OR (updated_at = $${timestampIndex}
                AND ('trafikkdata:' || point_id) < $${params.length}))`,
          );
        } else {
          where.push(`updated_at < $${timestampIndex}`);
        }
      }
      params.push(pageLimit);
      const result = await this.pool.query<RawTrafficCounterSummaryRow>(
        `SELECT point_id, payload, updated_at,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_cursor,
          ST_AsGeoJSON(geometry)::json AS geometry
         FROM traffic_counter_snapshots
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY updated_at DESC, point_id DESC
         LIMIT $${params.length}`,
        params,
      );
      items.push(...result.rows.map(rawTrafficCounterSummaryFromRow));
    }

    const sorted = items.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        `${right.source}:${right.id}`.localeCompare(`${left.source}:${left.id}`),
    );
    const page = sorted.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        sorted.length > limit && last
          ? encodeCursor(last.updatedAt, `${last.source}:${last.id}`)
          : undefined,
    };
  }

  async getRawTelemetryRecord(
    source: RawInspectorTelemetrySource,
    id: string,
    _login: string,
  ): Promise<RawInspectorTelemetryDetail | undefined> {
    void _login;
    if (source === "datex_travel_time") {
      const result = await this.pool.query<RawDatexTravelTimeRow>(
        `SELECT id, name, state, delay_seconds, measurement_to, source_url, payload, updated_at
         FROM datex_travel_times
         WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? rawDatexTravelTimeDetailFromRow(row) : undefined;
    }

    const result = await this.pool.query<RawTrafficCounterSnapshotRow>(
      `SELECT point_id, payload, updated_at, ST_AsGeoJSON(geometry)::json AS geometry
       FROM traffic_counter_snapshots
       WHERE point_id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? rawTrafficCounterDetailFromRow(row) : undefined;
  }

  async listRawAiRuns(
    filters: RawInspectorAiRunFilters,
    _login: string,
  ): Promise<RawInspectorAiRunPage> {
    void _login;
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.provider) {
      params.push(filters.provider);
      where.push(`provider = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(id ILIKE $${params.length}
          OR model ILIKE $${params.length}
          OR COALESCE(error, '') ILIKE $${params.length}
          OR article_ids::text ILIKE $${params.length}
          OR result::text ILIKE $${params.length})`,
      );
    }
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(completed_at < $${timestampIndex} OR (completed_at = $${timestampIndex} AND id < $${params.length}))`,
        );
      } else {
        where.push(`completed_at < $${timestampIndex}`);
      }
    }

    params.push((filters.limit ?? 20) + 1);
    const result = await this.pool.query<AiProcessingRunRow>(
      `SELECT id, provider, model, status, started_at, completed_at,
        to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed_at_cursor,
        article_ids, result, error
       FROM ai_processing_runs
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY completed_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 20;
    const visibleRows = result.rows.slice(0, limit);
    const lastRow = visibleRows.at(-1);
    return {
      items: visibleRows.map(rawAiRunSummaryFromRow),
      nextCursor:
        result.rows.length > limit && lastRow
          ? encodeCursor(lastRow.completed_at_cursor, lastRow.id)
          : undefined,
    };
  }

  async getRawAiRun(id: string, _login: string): Promise<RawInspectorAiRunDetail | undefined> {
    void _login;
    const result = await this.pool.query<AiProcessingRunRow>(
      `SELECT id, provider, model, status, started_at, completed_at,
        to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed_at_cursor,
        article_ids, result, error
       FROM ai_processing_runs
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? rawAiRunDetailFromRow(row) : undefined;
  }

  async listSpatialHeatmapCells(
    filters: CommandCenterSpatialAnalyticsQueryInput,
    _login: string,
  ): Promise<SpatialHeatmapCell[]> {
    void _login;
    const params: unknown[] = [];
    const sourceWhere = ["si.geo_hint IS NOT NULL"];
    const trafficWhere = ["tme.geometry IS NOT NULL"];

    if (filters.from) {
      params.push(filters.from);
      const index = params.length;
      sourceWhere.push(`COALESCE(si.published_at, si.fetched_at) >= $${index}`);
      trafficWhere.push(`COALESCE(tme.updated_at, tme.valid_from) >= $${index}`);
    }
    if (filters.to) {
      params.push(filters.to);
      const index = params.length;
      sourceWhere.push(`COALESCE(si.published_at, si.fetched_at) <= $${index}`);
      trafficWhere.push(`COALESCE(tme.updated_at, tme.valid_from) <= $${index}`);
    }

    params.push(filters.limit ?? 80);
    const result = await this.pool.query<SpatialHeatmapCellRow>(
      `WITH observations AS (
         SELECT
           'source_item'::text AS observation_type,
           si.id::text AS source_item_id,
           si.provider::text AS source_id,
           si.kind::text AS item_kind,
           NULL::text AS severity,
           COALESCE(si.published_at, si.fetched_at) AS observed_at,
           ST_Centroid(si.geo_hint) AS point
         FROM source_items si
         WHERE ${sourceWhere.join(" AND ")}
         UNION ALL
         SELECT
           'traffic_event'::text AS observation_type,
           NULL::text AS source_item_id,
           tme.source::text AS source_id,
           tme.category::text AS item_kind,
           tme.severity::text AS severity,
           COALESCE(tme.updated_at, tme.valid_from) AS observed_at,
           ST_Centroid(tme.geometry) AS point
         FROM traffic_map_events tme
         WHERE ${trafficWhere.join(" AND ")}
       ),
	       valid_points AS (
	         SELECT *,
	           floor(ST_X(point) * 100)::int AS lng_cell,
	           floor(ST_Y(point) * 100)::int AS lat_cell
	         FROM observations
	         WHERE ST_X(point) BETWEEN 9.5 AND 11.2
	           AND ST_Y(point) BETWEEN 62.9 AND 64.1
	       ),
	       bucketed AS (
	         SELECT
	           lng_cell,
	           lat_cell,
	           date_trunc('day', observed_at) AS bucket_start,
	           count(*)::int AS bucket_count,
	           count(*) FILTER (WHERE observation_type = 'source_item')::int AS source_item_count,
	           count(*) FILTER (
	             WHERE observation_type = 'source_item' AND item_kind = 'article'
	           )::int AS article_count,
	           count(*) FILTER (WHERE observation_type = 'traffic_event')::int AS traffic_event_count
	         FROM valid_points
	         GROUP BY lng_cell, lat_cell, date_trunc('day', observed_at)
	       ),
	       recent_buckets AS (
	         SELECT *,
	           row_number() OVER (
	             PARTITION BY lng_cell, lat_cell
	             ORDER BY bucket_start DESC
	           ) AS bucket_rank
	         FROM bucketed
	       ),
	       bucket_json AS (
	         SELECT
	           lng_cell,
	           lat_cell,
	           jsonb_agg(
	             jsonb_build_object(
	               'bucketStart',
	               to_char(bucket_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	               'count',
	               bucket_count,
	               'sourceItemCount',
	               source_item_count,
	               'articleCount',
	               article_count,
	               'trafficEventCount',
	               traffic_event_count
	             )
	             ORDER BY bucket_start
	           ) AS time_buckets
	         FROM recent_buckets
	         WHERE bucket_rank <= 14
	         GROUP BY lng_cell, lat_cell
	       ),
	       grouped AS (
	         SELECT
	           lng_cell,
	           lat_cell,
	           concat('cell:', lng_cell, ':', lat_cell) AS id,
	           avg(ST_X(point)) AS center_lng,
	           avg(ST_Y(point)) AS center_lat,
	           count(*)::text AS observation_count,
	           count(*) FILTER (WHERE observation_type = 'source_item')::text AS source_item_count,
	           COALESCE(
	             (array_agg(source_item_id ORDER BY observed_at DESC) FILTER (WHERE source_item_id IS NOT NULL))[1:12],
	             ARRAY[]::text[]
	           ) AS source_item_ids,
	           count(*) FILTER (WHERE observation_type = 'source_item' AND item_kind = 'article')::text AS article_count,
	           count(*) FILTER (WHERE observation_type = 'traffic_event')::text AS traffic_event_count,
	           min(observed_at) AS first_seen_at,
	           max(observed_at) AS last_seen_at,
	           count(DISTINCT observed_at::date)::text AS active_day_count,
	           array_agg(DISTINCT source_id ORDER BY source_id) AS source_ids,
	           max(CASE severity
	             WHEN 'critical' THEN 4
	             WHEN 'high' THEN 3
	             WHEN 'medium' THEN 2
	             WHEN 'low' THEN 1
	             ELSE 0
	           END) AS severity_rank
	         FROM valid_points
	         GROUP BY lng_cell, lat_cell
	       )
	       SELECT
	         concat('cell:', lng_cell, ':', lat_cell) AS id,
	         grouped.center_lng,
	         grouped.center_lat,
	         grouped.observation_count,
	         grouped.source_item_count,
	         grouped.source_item_ids,
	         grouped.article_count,
	         grouped.traffic_event_count,
	         grouped.first_seen_at,
	         grouped.last_seen_at,
	         grouped.active_day_count,
	         COALESCE(bucket_json.time_buckets, '[]'::jsonb) AS time_buckets,
	         grouped.source_ids,
	         grouped.severity_rank
	       FROM grouped
	       LEFT JOIN bucket_json USING (lng_cell, lat_cell)
	       ORDER BY grouped.observation_count::bigint DESC, grouped.last_seen_at DESC
	       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(spatialHeatmapCellFromRow);
  }

  async listOfficialEvents(filters: OfficialEventFilters): Promise<OfficialEvent[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.source) {
      params.push(filters.source);
      where.push(`source = $${params.length}`);
    }
    if (filters.states?.length) {
      params.push(filters.states);
      where.push(`state = ANY($${params.length}::text[])`);
    }
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(published_at < $${timestampIndex} OR (published_at = $${timestampIndex} AND id < $${params.length}))`,
        );
      } else {
        where.push(`published_at < $${timestampIndex}`);
      }
    }
    const limitClause = filters.limit ? `LIMIT $${params.length + 1}` : "";
    if (filters.limit) params.push(filters.limit);
    const result = await this.pool.query<{
      payload: OfficialEvent;
      state: OfficialEvent["state"];
      geometry: OfficialEvent["geometry"] | null;
    }>(
      `SELECT payload, state, ST_AsGeoJSON(geometry)::json AS geometry
       FROM official_events
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY published_at DESC, id DESC
       ${limitClause}`,
      params,
    );

    return result.rows.map((row) => ({
      ...row.payload,
      state: row.state,
      ...(row.geometry ? { geometry: row.geometry } : {}),
    }));
  }

  async listTrafficMapEvents(filters: TrafficMapEventFilters): Promise<TrafficMapEvent[]> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.sources?.length) {
      params.push(filters.sources);
      where.push(`source = ANY($${params.length}::text[])`);
    }
    if (filters.states?.length) {
      params.push(filters.states);
      where.push(`state = ANY($${params.length}::text[])`);
    }
    if (filters.categories?.length) {
      params.push(filters.categories);
      where.push(`category = ANY($${params.length}::text[])`);
    }
    if (filters.severities?.length) {
      params.push(filters.severities);
      where.push(`severity = ANY($${params.length}::text[])`);
    }
    if (filters.bounds) {
      params.push(
        filters.bounds.west,
        filters.bounds.south,
        filters.bounds.east,
        filters.bounds.north,
      );
      const westIndex = params.length - 3;
      const southIndex = params.length - 2;
      const eastIndex = params.length - 1;
      const northIndex = params.length;
      where.push(
        `geometry && ST_MakeEnvelope($${westIndex}, $${southIndex}, $${eastIndex}, $${northIndex}, 4326)`,
      );
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(
        `((state = 'active' AND valid_to IS NULL) OR COALESCE(valid_to, updated_at) >= $${params.length})`,
      );
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`COALESCE(valid_from, updated_at) <= $${params.length}`);
    }

    const limitClause =
      filters.limit === null
        ? ""
        : filters.limit === undefined
          ? "LIMIT 1000"
          : `LIMIT $${params.length + 1}`;
    if (typeof filters.limit === "number") params.push(filters.limit);

    const result = await this.pool.query<{
      payload: TrafficMapEvent;
      state: TrafficMapEvent["state"];
    }>(
      `SELECT payload, state
       FROM traffic_map_events
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC
       ${limitClause}`,
      params,
    );

    return result.rows.map((row) => ({ ...row.payload, state: row.state }));
  }

  async listPublicTransportVehicles(
    filters: LimitedBoundsFilter & {
      modes?: PublicTransportVehicle["mode"][];
    },
  ): Promise<PublicTransportVehicle[]> {
    const params: unknown[] = [];
    const where = [
      "stale=false",
      "(expires_at IS NULL OR expires_at > now())",
      "last_seen_at >= now() - interval '5 minutes'",
    ];
    if (filters.modes?.length) {
      params.push(filters.modes);
      where.push(`mode = ANY($${params.length}::text[])`);
    }
    params.push(
      filters.bounds.west,
      filters.bounds.south,
      filters.bounds.east,
      filters.bounds.north,
    );
    const westIndex = params.length - 3;
    const southIndex = params.length - 2;
    const eastIndex = params.length - 1;
    const northIndex = params.length;
    where.push(
      `ST_Intersects(geometry, ST_MakeEnvelope($${westIndex}, $${southIndex}, $${eastIndex}, $${northIndex}, 4326))`,
    );

    const limitClause =
      filters.limit === null
        ? ""
        : filters.limit === undefined
          ? "LIMIT 1000"
          : `LIMIT $${params.length + 1}`;
    if (typeof filters.limit === "number") params.push(filters.limit);

    const result = await this.pool.query<{
      payload: PublicTransportVehicle;
      stale: boolean;
    }>(
      `SELECT payload, stale
       FROM public_transport_vehicles
       WHERE ${where.join(" AND ")}
       ORDER BY last_updated DESC, vehicle_id ASC
       ${limitClause}`,
      params,
    );
    return result.rows.map((row) => ({ ...row.payload, stale: row.stale }));
  }

  async listPublicTransportServiceAlerts(
    filters: LimitedBoundsFilter & {
      states?: PublicTransportServiceAlert["state"][];
    },
  ): Promise<PublicTransportServiceAlert[]> {
    const params: unknown[] = [];
    const where = [
      "(valid_to IS NULL OR valid_to >= now())",
      "(valid_from IS NULL OR valid_from <= now())",
    ];
    const states: PublicTransportServiceAlert["state"][] = filters.states?.length
      ? filters.states
      : ["active"];
    params.push(states);
    where.push(`state = ANY($${params.length}::text[])`);
    params.push(
      filters.bounds.west,
      filters.bounds.south,
      filters.bounds.east,
      filters.bounds.north,
    );
    const westIndex = params.length - 3;
    const southIndex = params.length - 2;
    const eastIndex = params.length - 1;
    const northIndex = params.length;
    where.push(
      `(geometry IS NULL OR ST_Intersects(geometry, ST_MakeEnvelope($${westIndex}, $${southIndex}, $${eastIndex}, $${northIndex}, 4326)))`,
    );

    const limitClause =
      filters.limit === null
        ? ""
        : filters.limit === undefined
          ? "LIMIT 500"
          : `LIMIT $${params.length + 1}`;
    if (typeof filters.limit === "number") params.push(filters.limit);

    const result = await this.pool.query<{
      payload: PublicTransportServiceAlert;
      state: PublicTransportServiceAlert["state"];
    }>(
      `SELECT payload, state
       FROM public_transport_service_alerts
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, situation_number ASC
       ${limitClause}`,
      params,
    );
    return result.rows.map((row) => ({ ...row.payload, state: row.state }));
  }

  async listRoadWeatherObservations(bounds?: Bounds): Promise<RoadWeatherObservation[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (bounds) {
      params.push(bounds.west, bounds.south, bounds.east, bounds.north);
      where.push("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    }

    const result = await this.pool.query<{ payload: RoadWeatherObservation }>(
      `SELECT payload
       FROM road_weather_observations
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, station_id ASC`,
      params,
    );
    return result.rows.map((row) => row.payload);
  }

  async listRoadCameras(bounds?: Bounds): Promise<RoadCamera[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (bounds) {
      params.push(bounds.west, bounds.south, bounds.east, bounds.north);
      where.push("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    }

    const result = await this.pool.query<{ payload: RoadCamera }>(
      `SELECT payload
       FROM road_cameras
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, camera_id ASC`,
      params,
    );
    return result.rows.map((row) => row.payload);
  }

  async listTrafficCounterSnapshots(bounds?: Bounds): Promise<TrafficCounterSnapshot[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (bounds) {
      params.push(bounds.west, bounds.south, bounds.east, bounds.north);
      where.push("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    }

    const result = await this.pool.query<{ payload: TrafficCounterSnapshot }>(
      `SELECT payload
       FROM traffic_counter_snapshots
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, point_id ASC`,
      params,
    );
    return result.rows.map((row) => row.payload);
  }

  async listSituationSourceItems(situationId: string): Promise<SourceItem[]> {
    const result = await this.pool.query<SourceItemRow>(
      `SELECT ${sourceItemSelectColumns("si")}, ssi.relationship AS relationship
       FROM situation_source_items ssi
       JOIN source_items si ON si.id = ssi.source_item_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(array_agg(source_links.situation_id ORDER BY source_links.situation_id), '{}') AS linked_situation_ids
         FROM situation_source_items source_links WHERE source_links.source_item_id = si.id
       ) links ON true
       WHERE ssi.situation_id = $1
       ORDER BY ssi.linked_at DESC, ssi.source_item_id DESC`,
      [situationId],
    );
    return result.rows.map(sourceItemFromRow);
  }

  async linkSourceItem(
    situationId: string,
    sourceItemId: string,
    relationship: SourceItemRelationship,
    login: string,
  ): Promise<SourceItem | undefined> {
    const existingSourceItem = await this.getSourceItem(sourceItemId);
    if (!existingSourceItem) return undefined;
    if (!sourceItemCanUseRelationship(existingSourceItem, relationship)) {
      throw invalidSourceItemRelationshipError();
    }
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_by)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (SELECT 1 FROM situations WHERE id = $1)
       ON CONFLICT (situation_id, source_item_id) DO UPDATE SET
         relationship = EXCLUDED.relationship,
         linked_by = EXCLUDED.linked_by,
         linked_at = now()
       RETURNING source_item_id AS id`,
      [situationId, sourceItemId, relationship, login],
    );
    const linkedId = result.rows[0]?.id;
    const item = linkedId ? await this.getSourceItem(linkedId) : undefined;
    return item ? { ...item, relationship } : undefined;
  }

  async unlinkSourceItem(situationId: string, sourceItemId: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM situation_source_items WHERE situation_id = $1 AND source_item_id = $2",
      [situationId, sourceItemId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async getSourceItem(id: string): Promise<SourceItem | undefined> {
    const result = await this.pool.query<SourceItemRow>(
      `SELECT ${sourceItemSelectColumns("si")}
       FROM source_items si
       LEFT JOIN LATERAL (
         SELECT COALESCE(array_agg(ssi.situation_id ORDER BY ssi.situation_id), '{}') AS linked_situation_ids
         FROM situation_source_items ssi WHERE ssi.source_item_id = si.id
       ) links ON true
       WHERE si.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? sourceItemFromRow(row) : undefined;
  }

  private async getSourceItemRecord(id: string): Promise<SourceItemRecord | undefined> {
    const result = await this.pool.query<SourceItemRecordRow>(
      `SELECT ${sourceItemSelectColumns("si")}, si.raw_payload, si.normalized_payload
       FROM source_items si
       LEFT JOIN LATERAL (
         SELECT COALESCE(array_agg(ssi.situation_id ORDER BY ssi.situation_id), '{}') AS linked_situation_ids
         FROM situation_source_items ssi WHERE ssi.source_item_id = si.id
       ) links ON true
       WHERE si.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? sourceItemRecordFromRow(row) : undefined;
  }

  async listSavedArticles(login: string) {
    const result = await this.pool.query<{ payload: Article }>(
      `SELECT a.payload FROM articles a
       JOIN saved_articles s ON s.article_id=a.id
       WHERE s.github_login=$1 ORDER BY a.published_at DESC`,
      [login],
    );
    return result.rows.map((row) => ({ ...row.payload, saved: true }));
  }

  async setSaved(articleId: string, saved: boolean, login: string): Promise<boolean> {
    const exists = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM articles WHERE id=$1) AS exists",
      [articleId],
    );
    if (!exists.rows[0]?.exists) return false;
    if (saved) {
      await this.pool.query(
        "INSERT INTO saved_articles (github_login, article_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [login, articleId],
      );
    } else {
      await this.pool.query("DELETE FROM saved_articles WHERE github_login=$1 AND article_id=$2", [
        login,
        articleId,
      ]);
    }
    return true;
  }

  async listSituations(filters: SituationFilters, login: string): Promise<SituationPage> {
    const params: unknown[] = [login];
    const where: string[] = [];
    if (filters.status) {
      params.push(filters.status);
      where.push(`s.status = $${params.length}`);
    } else if (!filters.includeDismissed) {
      where.push("s.status <> 'dismissed'");
    }
    if (filters.saved) where.push("ss.situation_id IS NOT NULL");
    if (filters.publicOnly) {
      where.push("COALESCE(s.payload->>'publicVisibility', 'public') = 'public'");
    }
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(s.updated_at < $${timestampIndex} OR (s.updated_at = $${timestampIndex} AND s.id < $${params.length}))`,
        );
      } else {
        where.push(`s.updated_at < $${timestampIndex}`);
      }
    }
    params.push((filters.limit ?? 30) + 1);
    const result = await this.pool.query<{ payload: Situation; saved: boolean }>(
      `SELECT s.payload, (ss.situation_id IS NOT NULL) AS saved FROM situations s
       LEFT JOIN saved_situations ss ON ss.situation_id=s.id AND ss.github_login=$1
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.updated_at DESC, s.id DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 30;
    const items = result.rows.slice(0, limit).map((row) => ({ ...row.payload, saved: row.saved }));
    return {
      items,
      nextCursor:
        result.rows.length > limit && items.at(-1)
          ? encodeCursor(items.at(-1)!.updatedAt, items.at(-1)!.id)
          : undefined,
    };
  }

  async setSavedSituation(situationId: string, saved: boolean, login: string): Promise<boolean> {
    const exists = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM situations WHERE id=$1) AS exists",
      [situationId],
    );
    if (!exists.rows[0]?.exists) return false;
    if (saved) {
      await this.pool.query(
        "INSERT INTO saved_situations (github_login, situation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [login, situationId],
      );
    } else {
      await this.pool.query(
        "DELETE FROM saved_situations WHERE github_login=$1 AND situation_id=$2",
        [login, situationId],
      );
    }
    return true;
  }

  async setSituationStatus(
    id: string,
    status: Situation["status"],
    dismissalReason?: Situation["dismissalReason"],
  ) {
    const current = await this.pool.query<{ payload: Situation }>(
      "SELECT payload FROM situations WHERE id=$1",
      [id],
    );
    if (!current.rows[0]) return undefined;
    const existing = current.rows[0].payload;
    const updatedAt = new Date().toISOString();
    const updated: Situation = {
      ...existing,
      status,
      updatedAt,
      ...(status === "dismissed"
        ? {
            dismissedAt: updatedAt,
            dismissalReason: dismissalReason ?? "owner_dismissed",
            incidentSignature: existing.incidentSignature ?? `legacy:${id}`,
            detectionVersion: existing.detectionVersion ?? "1-legacy",
            activationBasis: existing.activationBasis ?? {
              rule: "two_independent_sources",
              sourceIds: [],
              articleIds: existing.relatedArticleIds,
              activatedAt: existing.createdAt,
            },
          }
        : {}),
    };
    await this.pool.query(
      "UPDATE situations SET status=$2, updated_at=$3, payload=$4 WHERE id=$1",
      [id, status, updatedAt, updated],
    );
    if (status === "dismissed" && updated.incidentSignature && updated.activationBasis) {
      await this.pool.query(
        `INSERT INTO situation_activations
         (situation_id, incident_signature, detection_version, source_ids, article_ids, activated_at,
          dismissed_at, dismissal_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (situation_id) DO UPDATE SET dismissed_at=EXCLUDED.dismissed_at,
         dismissal_reason=EXCLUDED.dismissal_reason`,
        [
          id,
          updated.incidentSignature,
          updated.detectionVersion ?? "2",
          JSON.stringify(updated.activationBasis.sourceIds),
          JSON.stringify(updated.activationBasis.articleIds),
          updated.activationBasis.activatedAt,
          updated.dismissedAt,
          updated.dismissalReason,
        ],
      );
    }
    return updated;
  }

  async setSituationPublicVisibility(
    id: string,
    publicVisibility: NonNullable<Situation["publicVisibility"]>,
  ) {
    const current = await this.pool.query<{ payload: Situation }>(
      "SELECT payload FROM situations WHERE id=$1",
      [id],
    );
    if (!current.rows[0]) return undefined;
    const updatedAt = new Date().toISOString();
    const updated: Situation = {
      ...current.rows[0].payload,
      publicVisibility,
      updatedAt,
    };
    await this.pool.query("UPDATE situations SET updated_at=$2, payload=$3 WHERE id=$1", [
      id,
      updatedAt,
      updated,
    ]);
    return updated;
  }

  async getWorkspace(id: string, login?: string): Promise<SituationWorkspace | undefined> {
    const situationResult = await this.pool.query<{ payload: Situation; saved: boolean }>(
      `SELECT s.payload,
       CASE WHEN $2::text IS NULL THEN false ELSE EXISTS(
         SELECT 1 FROM saved_situations ss WHERE ss.situation_id=s.id AND ss.github_login=$2
       ) END AS saved
       FROM situations s WHERE s.id=$1`,
      [id, login ?? null],
    );
    const row = situationResult.rows[0];
    const situation = row ? { ...row.payload, saved: row.saved } : undefined;
    if (!situation) return undefined;
    const [articles, evidence, timeline, tasks, notes, attachments, features] = await Promise.all([
      this.pool.query<{ payload: Article }>(
        "SELECT payload FROM articles WHERE payload->>'situationId'=$1",
        [id],
      ),
      this.pool.query<{ payload: EvidenceItem }>(
        "SELECT payload FROM evidence_items WHERE situation_id=$1 ORDER BY extracted_at",
        [id],
      ),
      this.pool.query<{ payload: TimelineEntry }>(
        "SELECT payload FROM timeline_entries WHERE situation_id=$1 ORDER BY occurred_at",
        [id],
      ),
      this.pool.query<WorkspaceTask>(
        `SELECT id, situation_id AS "situationId", text, completed, created_at AS "createdAt"
         FROM workspace_tasks WHERE situation_id=$1 ORDER BY created_at`,
        [id],
      ),
      this.pool.query<WorkspaceNote>(
        `SELECT id, situation_id AS "situationId", text, created_at AS "createdAt"
         FROM workspace_notes WHERE situation_id=$1 ORDER BY created_at`,
        [id],
      ),
      this.pool.query<Attachment>(
        `SELECT id, situation_id AS "situationId", filename, content_type AS "contentType",
         size, sha256, created_at AS "createdAt" FROM attachments WHERE situation_id=$1 ORDER BY created_at`,
        [id],
      ),
      this.pool.query<MapFeature>(
        `SELECT id, 'Feature' AS type, ST_AsGeoJSON(geometry)::json AS geometry, properties
         FROM map_features WHERE situation_id=$1`,
        [id],
      ),
    ]);
    situation.features = [
      ...new Map(
        [...situation.features, ...features.rows].map((feature) => [feature.id, feature]),
      ).values(),
    ];
    situation.evidence = evidence.rows.map((item) => item.payload);
    situation.timeline = timeline.rows.map((item) => item.payload);
    return {
      situation,
      relatedArticles: articles.rows.map((row) => row.payload),
      tasks: tasks.rows,
      notes: notes.rows,
      attachments: attachments.rows,
    };
  }

  async addPrivateFeature(situationId: string, feature: MapFeature): Promise<MapFeature> {
    await this.pool.query(
      `INSERT INTO map_features (id, situation_id, provenance, geometry, properties)
       VALUES ($1,$2,'private_annotation',ST_SetSRID(ST_GeomFromGeoJSON($3),4326),$4)`,
      [feature.id, situationId, JSON.stringify(feature.geometry), feature.properties],
    );
    return feature;
  }

  async updatePrivateFeature(
    situationId: string,
    featureId: string,
    input: PrivateAnnotationUpdateRequest,
  ) {
    const patch = {
      ...input,
      provenance: "private_annotation",
      updatedAt: new Date().toISOString(),
    };
    const result = await this.pool.query<MapFeature>(
      `UPDATE map_features
       SET properties = properties || $3::jsonb
       WHERE id=$1 AND situation_id=$2 AND provenance='private_annotation'
       RETURNING id, 'Feature' AS type, ST_AsGeoJSON(geometry)::json AS geometry, properties`,
      [featureId, situationId, patch],
    );
    return result.rows[0];
  }

  async deletePrivateFeature(situationId: string, featureId: string) {
    const result = await this.pool.query(
      "DELETE FROM map_features WHERE id=$1 AND situation_id=$2 AND provenance='private_annotation'",
      [featureId, situationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addTask(situationId: string, text: string) {
    const id = randomUUID();
    const result = await this.pool.query<WorkspaceTask>(
      `INSERT INTO workspace_tasks (id, situation_id, text) VALUES ($1,$2,$3)
       RETURNING id, situation_id AS "situationId", text, completed, created_at AS "createdAt"`,
      [id, situationId, text],
    );
    return result.rows[0]!;
  }

  async toggleTask(situationId: string, taskId: string, completed: boolean) {
    const result = await this.pool.query<WorkspaceTask>(
      `UPDATE workspace_tasks SET completed=$3 WHERE id=$1 AND situation_id=$2
       RETURNING id, situation_id AS "situationId", text, completed, created_at AS "createdAt"`,
      [taskId, situationId, completed],
    );
    return result.rows[0];
  }

  async updateTaskText(situationId: string, taskId: string, text: string) {
    const result = await this.pool.query<WorkspaceTask>(
      `UPDATE workspace_tasks SET text=$3 WHERE id=$1 AND situation_id=$2
       RETURNING id, situation_id AS "situationId", text, completed, created_at AS "createdAt"`,
      [taskId, situationId, text],
    );
    return result.rows[0];
  }

  async deleteTask(situationId: string, taskId: string) {
    const result = await this.pool.query(
      "DELETE FROM workspace_tasks WHERE id=$1 AND situation_id=$2",
      [taskId, situationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addNote(situationId: string, text: string) {
    const result = await this.pool.query<WorkspaceNote>(
      `INSERT INTO workspace_notes (id, situation_id, text) VALUES ($1,$2,$3)
       RETURNING id, situation_id AS "situationId", text, created_at AS "createdAt"`,
      [randomUUID(), situationId, text],
    );
    return result.rows[0]!;
  }

  async updateNote(situationId: string, noteId: string, text: string) {
    const result = await this.pool.query<WorkspaceNote>(
      `UPDATE workspace_notes SET text=$3 WHERE id=$1 AND situation_id=$2
       RETURNING id, situation_id AS "situationId", text, created_at AS "createdAt"`,
      [noteId, situationId, text],
    );
    return result.rows[0];
  }

  async deleteNote(situationId: string, noteId: string) {
    const result = await this.pool.query(
      "DELETE FROM workspace_notes WHERE id=$1 AND situation_id=$2",
      [noteId, situationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addAttachment(record: AttachmentRecord) {
    const result = await this.pool.query<Attachment>(
      `INSERT INTO attachments
       (id, situation_id, filename, storage_path, content_type, size, sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, situation_id AS "situationId", filename, content_type AS "contentType",
       size, sha256, created_at AS "createdAt"`,
      [
        record.id,
        record.situationId,
        record.filename,
        record.storagePath,
        record.contentType,
        record.size,
        record.sha256,
      ],
    );
    return result.rows[0]!;
  }

  async getAttachment(id: string) {
    const result = await this.pool.query<AttachmentRecord>(
      `SELECT id, situation_id AS "situationId", filename, storage_path AS "storagePath",
       content_type AS "contentType", size, sha256, created_at AS "createdAt"
       FROM attachments WHERE id=$1`,
      [id],
    );
    return result.rows[0];
  }

  async deleteAttachment(situationId: string, id: string) {
    const attachment = await this.getAttachment(id);
    if (!attachment || attachment.situationId !== situationId) return undefined;
    await this.pool.query("DELETE FROM attachments WHERE id=$1 AND situation_id=$2", [
      id,
      situationId,
    ]);
    return attachment;
  }

  async recordExport(record: ExportRecord) {
    await this.pool.query(
      `INSERT INTO export_manifests
       (id, situation_id, github_login, storage_path, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        record.id,
        record.situationId,
        record.githubLogin,
        record.storagePath,
        record.payload,
        record.createdAt,
      ],
    );
  }

  async getExport(id: string, situationId: string, login: string) {
    const result = await this.pool.query<ExportRecord>(
      `SELECT id, situation_id AS "situationId", github_login AS "githubLogin",
       storage_path AS "storagePath", payload, created_at AS "createdAt"
       FROM export_manifests
       WHERE id=$1 AND situation_id=$2 AND github_login=$3 AND storage_path IS NOT NULL`,
      [id, situationId, login],
    );
    return result.rows[0];
  }

  async listSourceHealth() {
    const result = await this.pool.query<SourceHealth>(
      `SELECT source, label, state, last_checked_at AS "lastCheckedAt",
       last_failure_at AS "lastFailureAt", next_poll_at AS "nextPollAt", detail
       FROM source_health ORDER BY label`,
    );
    return result.rows;
  }

  async listCollectorRuns(
    filters: { source?: SourceId; limit?: number } = {},
  ): Promise<SourceCollectorRun[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.source) {
      params.push(filters.source);
      where.push(`source = $${params.length}`);
    }
    params.push(filters.limit ?? 40);
    const result = await this.pool.query<{
      id: string;
      source: SourceId;
      collector: string;
      status: SourceCollectorRun["status"];
      startedAt: Date | string;
      completedAt: Date | string | null;
      durationMs: number | null;
      recordsSeen: number;
      recordsAccepted: number;
      recordsRejected: number;
      errorCode: string | null;
      errorMessage: string | null;
      diagnostics: SourceCollectorRun["diagnostics"] | null;
    }>(
      `SELECT id, source, collector, status, started_at AS "startedAt",
       completed_at AS "completedAt", duration_ms AS "durationMs",
       records_seen AS "recordsSeen", records_accepted AS "recordsAccepted",
       records_rejected AS "recordsRejected", error_code AS "errorCode",
       error_message AS "errorMessage", diagnostics
       FROM collector_runs
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY started_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
    if (result.rows.length === 0) {
      const metrics = await this.getLatestWorkerCycleMetrics();
      if (!metrics) return [];
      return Object.entries(metrics.sourceDurationsMs)
        .filter(([source]) => !filters.source || source === filters.source)
        .slice(0, filters.limit ?? 40)
        .map(([source, durationMs]) => ({
          id: `${source}:${metrics.cycleStartedAt}`,
          source: source as SourceId,
          collector: source,
          status: ((metrics.parseFailures[source] ?? 0) > 0
            ? metrics.sourceItemCounts[source]
              ? "partial"
              : "failed"
            : "succeeded") as SourceCollectorRun["status"],
          startedAt: metrics.cycleStartedAt,
          completedAt: metrics.cycleCompletedAt,
          durationMs,
          recordsSeen:
            (metrics.sourceItemCounts[source] ?? 0) + (metrics.parseFailures[source] ?? 0),
          recordsAccepted: metrics.sourceItemCounts[source] ?? 0,
          recordsRejected: metrics.parseFailures[source] ?? 0,
        }));
    }
    return result.rows.map((row) => ({
      id: row.id,
      source: row.source,
      collector: row.collector,
      status: row.status,
      startedAt: new Date(row.startedAt).toISOString(),
      ...(row.completedAt ? { completedAt: new Date(row.completedAt).toISOString() } : {}),
      ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
      recordsSeen: row.recordsSeen,
      recordsAccepted: row.recordsAccepted,
      recordsRejected: row.recordsRejected,
      ...(row.errorCode ? { errorCode: row.errorCode } : {}),
      ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
      ...(row.diagnostics ? { diagnostics: row.diagnostics } : {}),
    }));
  }

  async listTrafficPulseCorridors(limit = 30): Promise<TrafficPulseCorridor[]> {
    const result = await this.pool.query<{
      payload: TrafficPulseCorridor;
      measurementTo?: Date | string | null;
      updatedAt?: Date | string | null;
    }>(
      `SELECT payload, measurement_to AS "measurementTo", updated_at AS "updatedAt"
       FROM datex_travel_times
       ORDER BY delay_seconds DESC NULLS LAST, name ASC
       LIMIT $1`,
      [limit],
    );
    const responseTimeMs = Date.now();
    return result.rows.map((row) =>
      withTrafficPulseStaleOverlay(row.payload, row.measurementTo, row.updatedAt, responseTimeMs),
    );
  }

  async getTrafficTelemetryHistorySummary(
    filters: Pick<CommandCenterSpatialAnalyticsQueryInput, "from" | "to"> = {},
  ): Promise<CommandCenterTelemetryHistorySummary> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.from) {
      params.push(filters.from);
      where.push(`observed_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`observed_at <= $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [travelTime, trafficCounters] = await Promise.all([
      this.pool.query<TelemetryHistorySummaryRow>(
        `SELECT
           count(*)::text AS observations,
           count(DISTINCT corridor_id)::text AS tracked_entities,
           min(observed_at) AS first_observed_at,
           max(observed_at) AS last_observed_at,
           count(DISTINCT observed_at::date)::text AS active_day_count,
           count(*) FILTER (
             WHERE state IN ('slow', 'congested')
                OR COALESCE(delay_seconds, 0) >= 180
           )::text AS notable_observations
         FROM datex_travel_time_history
         ${whereSql}`,
        params,
      ),
      this.pool.query<TelemetryHistorySummaryRow>(
        `SELECT
           count(*)::text AS observations,
           count(DISTINCT point_id)::text AS tracked_entities,
           min(observed_at) AS first_observed_at,
           max(observed_at) AS last_observed_at,
           count(DISTINCT observed_at::date)::text AS active_day_count,
           count(*) FILTER (WHERE COALESCE(anomaly_ratio, 0) >= 1.7)::text AS notable_observations
         FROM traffic_counter_snapshot_history
         ${whereSql}`,
        params,
      ),
    ]);

    return {
      datexTravelTime: telemetryHistorySummaryFromRow(travelTime.rows[0]),
      trafficCounters: telemetryHistorySummaryFromRow(trafficCounters.rows[0]),
    };
  }

  async listTrafficTelemetryPatterns(
    filters: Pick<CommandCenterSpatialAnalyticsQueryInput, "from" | "to"> & { limit?: number } = {},
  ): Promise<TelemetryHistoryPattern[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.from) {
      params.push(filters.from);
      where.push(`observed_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`observed_at <= $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(30, Math.max(1, filters.limit ?? 12));
    const limitParam = params.length + 1;
    const queryParams = [...params, limit];
    const [travelTime, trafficCounters] = await Promise.all([
      this.pool.query<TelemetryHistoryPatternRow>(
        `SELECT
           'datex_travel_time'::text AS source,
           corridor_id AS entity_id,
           (array_agg(name ORDER BY observed_at DESC))[1] AS title,
           count(*)::text AS observation_count,
           count(*) FILTER (
             WHERE state IN ('slow', 'congested')
                OR COALESCE(delay_seconds, 0) >= 180
           )::text AS notable_observation_count,
           count(DISTINCT observed_at::date)::text AS active_day_count,
           min(observed_at) AS first_observed_at,
           max(observed_at) AS last_observed_at,
           max(delay_seconds) AS max_delay_seconds,
           NULL::real AS max_anomaly_ratio,
           NULL::json AS geometry
         FROM datex_travel_time_history
         ${whereSql}
         GROUP BY corridor_id
         HAVING count(*) FILTER (
             WHERE state IN ('slow', 'congested')
                OR COALESCE(delay_seconds, 0) >= 180
           ) >= 2
           OR count(DISTINCT observed_at::date) >= 2
         ORDER BY count(*) FILTER (
             WHERE state IN ('slow', 'congested')
                OR COALESCE(delay_seconds, 0) >= 180
           ) DESC,
           count(DISTINCT observed_at::date) DESC,
           max(delay_seconds) DESC NULLS LAST,
           max(observed_at) DESC
         LIMIT $${limitParam}`,
        queryParams,
      ),
      this.pool.query<TelemetryHistoryPatternRow>(
        `SELECT
           'trafikkdata'::text AS source,
           point_id AS entity_id,
           COALESCE(
             (array_remove(array_agg(NULLIF(payload->>'name', '') ORDER BY observed_at DESC), NULL))[1],
             point_id
           ) AS title,
           count(*)::text AS observation_count,
           count(*) FILTER (WHERE COALESCE(anomaly_ratio, 0) >= 1.7)::text AS notable_observation_count,
           count(DISTINCT observed_at::date)::text AS active_day_count,
           min(observed_at) AS first_observed_at,
           max(observed_at) AS last_observed_at,
           NULL::real AS max_delay_seconds,
           max(anomaly_ratio) AS max_anomaly_ratio,
           (array_agg(ST_AsGeoJSON(geometry)::json ORDER BY observed_at DESC))[1] AS geometry
         FROM traffic_counter_snapshot_history
         ${whereSql}
         GROUP BY point_id
         HAVING count(*) FILTER (WHERE COALESCE(anomaly_ratio, 0) >= 1.7) >= 2
           OR count(DISTINCT observed_at::date) >= 2
         ORDER BY count(*) FILTER (WHERE COALESCE(anomaly_ratio, 0) >= 1.7) DESC,
           count(DISTINCT observed_at::date) DESC,
           max(anomaly_ratio) DESC NULLS LAST,
           max(observed_at) DESC
         LIMIT $${limitParam}`,
        queryParams,
      ),
    ]);

    return [...travelTime.rows, ...trafficCounters.rows]
      .map(telemetryHistoryPatternFromRow)
      .sort(
        (left, right) =>
          right.notableObservationCount - left.notableObservationCount ||
          right.activeDayCount - left.activeDayCount ||
          (right.maxDelaySeconds ?? 0) - (left.maxDelaySeconds ?? 0) ||
          (right.maxAnomalyRatio ?? 0) - (left.maxAnomalyRatio ?? 0) ||
          (right.lastObservedAt ?? "").localeCompare(left.lastObservedAt ?? "") ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit);
  }

  async getLatestWorkerCycleMetrics(): Promise<WorkerCycleMetrics | undefined> {
    const result = await this.pool.query<{ payload: WorkerCycleMetrics }>(
      "SELECT payload FROM worker_cycle_metrics WHERE id = 'latest' LIMIT 1",
    );
    return result.rows[0]?.payload;
  }

  async getSourceAuditWorkspace(filters: SourceAuditFilterQuery, login: string) {
    return buildSourceAuditWorkspace(this, filters, login);
  }

  async getOperationsTimeline(filters: OperationsTimelineQuery, login: string) {
    return buildOperationsTimeline(this, filters, login);
  }

  async getOperationsStatus(): Promise<OperationsStatus> {
    const [
      sources,
      articleCount,
      situationCounts,
      situationPublicationCounts,
      latestAiRun,
      trafficPulse,
    ] = await Promise.all([
      this.listSourceHealth(),
      this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM articles"),
      this.pool.query<{ status: Situation["status"]; count: string }>(
        "SELECT status, count(*)::text AS count FROM situations GROUP BY status",
      ),
      this.pool.query<{
        publicVisibility: NonNullable<Situation["publicVisibility"]>;
        count: string;
      }>(
        `SELECT COALESCE(payload->>'publicVisibility', 'public') AS "publicVisibility",
          count(*)::text AS count
         FROM situations GROUP BY COALESCE(payload->>'publicVisibility', 'public')`,
      ),
      this.pool.query<{
        provider: "deepseek" | "deterministic";
        model: string;
        status: "ok" | "degraded" | "disabled";
        completedAt: string;
        error?: string;
      }>(
        `SELECT provider, model, status, completed_at AS "completedAt", error
         FROM ai_processing_runs ORDER BY completed_at DESC LIMIT 1`,
      ),
      this.listTrafficPulseCorridors(30),
    ]);
    const workerCycleMetrics = await this.getLatestWorkerCycleMetrics();
    const counts: OperationsStatus["situationCounts"] = {
      preliminary: 0,
      active: 0,
      resolved: 0,
      dismissed: 0,
    };
    for (const row of situationCounts.rows) counts[row.status] = Number(row.count);
    const publicationCounts: OperationsStatus["situationPublicationCounts"] = {
      public: 0,
      command_center: 0,
    };
    for (const row of situationPublicationCounts.rows) {
      publicationCounts[row.publicVisibility] = Number(row.count);
    }
    return {
      sources,
      articleCount: Number(articleCount.rows[0]?.count ?? 0),
      situationCounts: counts,
      situationPublicationCounts: publicationCounts,
      latestAiRun: latestAiRun.rows[0],
      trafficPulse,
      workerCycleMetrics,
      latestCollectionAt: sources
        .map((source) => source.lastCheckedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
    };
  }
}
