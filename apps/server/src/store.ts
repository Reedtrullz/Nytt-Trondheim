import { createHash, randomUUID } from "node:crypto";
import type {
  Article,
  ArticlePage,
  Attachment,
  BootstrapPayload,
  EvidenceItem,
  MapFeature,
  OfficialEvent,
  OperationsTimelineEvent,
  OperationsTimelineQuery,
  OperationsTimelineResponse,
  OperationsStatus,
  PrivateAnnotationUpdateRequest,
  Provenance,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
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
  SourceFreshness,
  IncidentSourceTraceabilitySummary,
  SourceNonSecretDiagnostic,
  SourceReliabilityIndicator,
  SourceStaleDataAlert,
  SourceItem,
  SourceItemFilters,
  SourceItemPage,
  SourceItemRelationship,
  SourceHealth,
  SourceId,
  TimelineEntry,
  TrafficCounterSnapshot,
  TrafficMapEvent,
  TrafficPulseCorridor,
  WorkerCycleMetrics,
  WorkspaceNote,
  WorkspaceTask,
} from "@nytt/shared";
import {
  sampleArticles,
  sampleBootstrap,
  sampleNotes,
  sampleSituation,
  sampleTasks,
  sampleWorkspace,
} from "@nytt/shared";
import pg from "pg";

export interface ArticleFilters {
  scope?: string;
  category?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface SituationFilters {
  status?: Situation["status"];
  saved?: boolean;
  includeDismissed?: boolean;
  cursor?: string;
  limit?: number;
}

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
  getBootstrap(login: string): Promise<BootstrapPayload>;
  listArticles(filters: ArticleFilters, login: string): Promise<ArticlePage>;
  listSourceItems(filters: SourceItemFilters, login: string): Promise<SourceItemPage>;
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
  listSituationSourceItems(situationId: string, login: string): Promise<SourceItem[]>;
  linkSourceItem(
    situationId: string,
    sourceItemId: string,
    relationship: SourceItemRelationship,
    login: string,
  ): Promise<SourceItem | undefined>;
  unlinkSourceItem(situationId: string, sourceItemId: string, login: string): Promise<boolean>;
  listSavedArticles(login: string): Promise<Article[]>;
  setSaved(articleId: string, saved: boolean, login: string): Promise<void>;
  listSituations(filters: SituationFilters, login: string): Promise<SituationPage>;
  setSavedSituation(situationId: string, saved: boolean, login: string): Promise<void>;
  setSituationStatus(
    id: string,
    status: Situation["status"],
    dismissalReason?: Situation["dismissalReason"],
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceItemHash(parts: unknown[]): string {
  return sha256(JSON.stringify(parts));
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sourceItemHash([provider, kind, stableKey])}`;
}

function memorySourceItemFromArticle(article: Article): SourceItem {
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
    geoHint,
    reliabilityTier: article.source === "trondheim_kommune" ? "official" : "trusted_media",
    linkedSituationIds: [],
  };
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
  geo_hint: SourceItem["geoHint"] | null;
  reliability_tier: SourceItem["reliabilityTier"];
  linked_situation_ids: string[] | null;
  relationship?: SourceItemRelationship | null;
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
    geoHint: row.geo_hint ?? undefined,
    reliabilityTier: row.reliability_tier,
    linkedSituationIds: row.linked_situation_ids ?? [],
    ...(row.relationship ? { relationship: row.relationship } : {}),
  };
}

function sourceItemSelectColumns(alias = "si"): string {
  return `${alias}.id, ${alias}.provider, ${alias}.kind, ${alias}.external_id, ${alias}.original_url,
       ${alias}.title, ${alias}.summary, ${alias}.author, ${alias}.published_at, ${alias}.fetched_at,
       to_char(${alias}.fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fetched_at_cursor,
       ${alias}.capture_hash,
       ST_AsGeoJSON(${alias}.geo_hint)::json AS geo_hint, ${alias}.reliability_tier,
       links.linked_situation_ids`;
}

const sourceAuditRequiredSources: SourceId[] = [
  "nrk",
  "adressa",
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
  "private_annotations",
];

const sourceAuditLabelFallbacks: Record<SourceId, string> = {
  nrk: "NRK Trøndelag",
  adressa: "Adresseavisen",
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
};

const sourceAuditContractPaths: Partial<Record<SourceId, string>> = {
  nrk: "docs/source-contracts/media-rss.md",
  adressa: "docs/source-contracts/media-rss.md",
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
  trondheim_kommune: { role: "context_source", provenance: "official" },
  vegvesen_traffic_info: { role: "context_source", provenance: "official" },
};

function sourceAuditGroup(source: SourceId): SourceAuditProviderGroup {
  if (source.startsWith("datex") || source === "trafikkdata" || source === "vegvesen_traffic_info")
    return "datex";
  if (source.startsWith("entur")) return "entur";
  if (source === "politiloggen") return "politiloggen";
  if (source === "internal" || source === "deepseek") return "internal";
  if (source === "private_annotations") return "private_annotation";
  if (["nrk", "adressa", "vg", "dagbladet"].includes(source)) return "media";
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
  if (source === "internal" || source === "deepseek") return "internal_analysis";
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
  const level =
    state === "degraded" || failures > 0
      ? failures > 2
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
      detail:
        failures > 0
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
            severity: latestRun.status === "failed" ? ("error" as const) : ("info" as const),
            safeForDisplay: true as const,
            value: latestRun.durationMs ?? 0,
            unit: "ms" as const,
            observedAt: latestRun.completedAt ?? latestRun.startedAt,
            detail: `${latestRun.recordsAccepted} akseptert, ${latestRun.recordsRejected} avvist.`,
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
      href: `/drift/kilder?sources=${encodeURIComponent(source)}&detail=${encodeURIComponent(
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
    title: `${sourceAuditLabelFallbacks[run.source]} ${collectorRunStatusLabel(run.status)}`,
    detail: `${run.recordsAccepted} inn, ${run.recordsRejected} avvik, ${run.recordsSeen} sett.`,
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
  private savedSituations = new Set<string>();
  private sourceItems = new Map<string, SourceItem>(
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

  async getBootstrap(): Promise<BootstrapPayload> {
    return {
      ...clone(sampleBootstrap),
      articles: clone(this.articles),
      situations: [...this.situations.values()].map(clone),
    };
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
            article.category === filters.category) &&
          (!search ||
            `${article.title} ${article.excerpt} ${article.places.join(" ")}`
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
      items: clone(page),
      nextCursor:
        items.length > limit && last ? encodeCursor(last.publishedAt, last.id) : undefined,
    };
  }

  async listSourceItems(filters: SourceItemFilters): Promise<SourceItemPage> {
    const search = filters.q?.toLocaleLowerCase("nb");
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 40;
    const withLinks = [...this.sourceItems.values()].map((item) => ({
      ...item,
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

  async listOfficialEvents(): Promise<OfficialEvent[]> {
    return [];
  }

  async listTrafficMapEvents(): Promise<TrafficMapEvent[]> {
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

  async listTrafficCounterSnapshots(): Promise<TrafficCounterSnapshot[]> {
    return [];
  }

  async listTrafficPulseCorridors(): Promise<TrafficPulseCorridor[]> {
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
          ...item,
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
      ...item,
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

  async setSaved(articleId: string, saved: boolean): Promise<void> {
    const article = this.articles.find((item) => item.id === articleId);
    if (article) article.saved = saved;
  }

  async listSituations(filters: SituationFilters): Promise<SituationPage> {
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 30;
    const items = [...this.situations.values()]
      .filter(
        (situation) =>
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

  async setSavedSituation(situationId: string, saved: boolean): Promise<void> {
    if (saved) this.savedSituations.add(situationId);
    else this.savedSituations.delete(situationId);
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
    return {
      sources: await this.listSourceHealth(),
      articleCount: this.articles.length,
      situationCounts: {
        preliminary: 0,
        active: this.situations.size,
        resolved: 0,
        dismissed: 0,
      },
      trafficPulse: await this.listTrafficPulseCorridors(),
      workerCycleMetrics: await this.getLatestWorkerCycleMetrics(),
    };
  }
}

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

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
    const [articles, situations, sourceHealth] = await Promise.all([
      this.listArticles({ limit: 100 }, login),
      this.listSituations({ includeDismissed: false, limit: 100 }, login),
      this.listSourceHealth(),
    ]);
    return { articles: articles.items, situations: situations.items, sourceHealth };
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
      where.push(`a.category = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(a.payload->>'title' ILIKE $${params.length} OR a.payload->>'excerpt' ILIKE $${params.length})`,
      );
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
    const items = result.rows.slice(0, limit).map((row) => ({ ...row.payload, saved: row.saved }));
    return {
      items,
      nextCursor:
        result.rows.length > limit && items.at(-1)
          ? encodeCursor(items.at(-1)!.publishedAt, items.at(-1)!.id)
          : undefined,
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
      where.push(`COALESCE(valid_to, updated_at) >= $${params.length}`);
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

  async listSavedArticles(login: string) {
    const result = await this.pool.query<{ payload: Article }>(
      `SELECT a.payload FROM articles a
       JOIN saved_articles s ON s.article_id=a.id
       WHERE s.github_login=$1 ORDER BY a.published_at DESC`,
      [login],
    );
    return result.rows.map((row) => ({ ...row.payload, saved: true }));
  }

  async setSaved(articleId: string, saved: boolean, login: string) {
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

  async setSavedSituation(situationId: string, saved: boolean, login: string) {
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
    const [sources, articleCount, situationCounts, latestAiRun, trafficPulse] = await Promise.all([
      this.listSourceHealth(),
      this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM articles"),
      this.pool.query<{ status: Situation["status"]; count: string }>(
        "SELECT status, count(*)::text AS count FROM situations GROUP BY status",
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
    return {
      sources,
      articleCount: Number(articleCount.rows[0]?.count ?? 0),
      situationCounts: counts,
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
