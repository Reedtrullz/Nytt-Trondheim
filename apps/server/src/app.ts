import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import pg from "pg";
import { ZodError } from "zod";
import {
  accessRequestInputSchema,
  accessRequestDecisionSchema,
  accessRequestQuerySchema,
  applyNotificationDeliveryStates,
  articleQuerySchema,
  commandCenterSpatialAnalyticsQuerySchema,
  coverageBundleQuerySchema,
  emailLoginRequestSchema,
  filterNotificationTriggerPageByDeliveryStates,
  isPublicSituation,
  lifecycleInputSchema,
  noteInputSchema,
  notificationTriggerQuerySchema,
  operationsTimelineQuerySchema,
  privateAnnotationUpdateRequestSchema,
  privateMapFeatureInputSchema,
  publicTransportMapQuerySchema,
  pushSubscriptionInputSchema,
  rawInspectorAiRunQuerySchema,
  rawInspectorTelemetryQuerySchema,
  rawInspectorTelemetrySourceSchema,
  situationPublicationInputSchema,
  sourceItemLinkInputSchema,
  sourceItemQuerySchema,
  sourceAuditFilterQuerySchema,
  provenanceLabels,
  situationQuerySchema,
  sourceConfidenceLevelFromScore,
  sourceConfidenceLabels,
  sourceMixConfidenceSummary,
  situationPublicVisibility,
  taskInputSchema,
  trafficMapQuerySchema,
  travelPlanQuerySchema,
  userGrantSchema,
  userUpdateSchema,
  workspaceMapQuerySchema,
  type MapFeature,
  type MapFirstSituation,
  type PrivateAnnotationFeature,
  type Provenance,
  type ProvenanceConfidence,
  type PublicTransportVehicle,
  type Situation,
  type SituationExplanation,
  type SituationMapWorkspace,
  type SituationWorkspace,
  type SourceConfidenceSummary,
  type SourceHealth,
  type SourceId,
  type SourceItem,
  type SpatialHeatmapCell,
  type RuntimeFreshness,
  type TimelineEntry,
  type TrafficEventState,
  type TrafficMapEvent,
  type TrafficMapSourceStatus,
  type UnexplainedDelayCandidate,
} from "@nytt/shared";
import type { AppConfig } from "./config.js";
import {
  configureAuth,
  csrfToken,
  currentLogin,
  requireCsrf,
  requireOwner,
  requireUser,
} from "./auth.js";
import { createEmailSender } from "./email.js";
import { buildWorkspaceExport, safeFilename } from "./export.js";
import { loadWorldCupDashboard } from "./sport/world-cup.js";
import { MemoryStore, PgStore, type Store } from "./store.js";
import { roadClosingArticleTrafficEvents } from "./traffic/article-events.js";
import { buildCorridorImpacts } from "./traffic/corridor-impact.js";
import { officialEventToTrafficMapEvent } from "./traffic/datex-normalizer.js";
import { geometryIntersectsBounds } from "./traffic/geo.js";
import { relatedTrafficArticlesForEvent } from "./traffic/related-articles.js";
import {
  buildSpatialInvestigationQueue,
  buildUnexplainedDelayCandidates,
} from "./traffic/spatial-analytics.js";
import {
  buildTravelPlanPayload,
  resolveTravelPlanPlacesAndRoute,
  routeBounds,
} from "./traffic/travel-plan.js";
import { buildTrafficBrief } from "./traffic/traffic-brief.js";
import { loadWeatherPreparedness } from "./weather/preparedness.js";

const EXPORT_ATTACHMENT_COUNT_LIMIT = 25;
const EXPORT_ATTACHMENT_BYTE_LIMIT = 50 * 1024 * 1024;
const trafficMapSourceIds = [
  "datex",
  "datex_travel_time",
  "datex_weather",
  "datex_cctv",
  "trafikkdata",
  "vegvesen_traffic_info",
] as const;
const trafficMapSourceIdSet = new Set<string>(trafficMapSourceIds);
const publicTransportSourceIdSet = new Set<string>([
  "entur_vehicle_positions",
  "entur_service_alerts",
]);
const defaultPublicTransportBounds = { north: 63.55, south: 63.3, east: 10.65, west: 10.2 };
const defaultWeatherBounds = { north: 63.55, south: 63.3, east: 10.65, west: 10.2 };
const workerStaleAfterSeconds = 2 * 60 * 60;
const backupStaleAfterSeconds = 36 * 60 * 60;
const restoreCheckStaleAfterSeconds = 8 * 24 * 60 * 60;
const telemetrySourceIds = new Set<SourceId>([
  "datex_travel_time",
  "datex_weather",
  "datex_cctv",
  "trafikkdata",
  "entur_vehicle_positions",
]);
const contextSourceIds = new Set<SourceId>([
  "met",
  "nve",
  "entur_service_alerts",
  "bane_nor",
  "vegvesen_traffic_info",
  "dsb",
]);

function sourceRole(
  provider: SourceId,
  kind?: SourceItem["kind"],
): SituationExplanation["sourceRoles"][number]["role"] {
  if (telemetrySourceIds.has(provider)) return "telemetry";
  if (
    contextSourceIds.has(provider) ||
    kind === "warning" ||
    (provider === "entur" && kind === "official_event")
  ) {
    return "context";
  }
  if (kind === "reporter_note" || kind === "reader_tip" || provider === "deepseek")
    return "private";
  return "evidence";
}

function linkedSourceItemRole(
  item: SourceItem,
): SituationExplanation["sourceRoles"][number]["role"] {
  if (
    item.relationship === "context" ||
    item.relationship === "contradicts" ||
    item.relationship === "duplicate"
  ) {
    return "context";
  }
  return sourceRole(item.provider, item.kind);
}

function addSourceRole(
  roles: Map<SourceId, SituationExplanation["sourceRoles"][number]["role"]>,
  provider: SourceId,
  role: SituationExplanation["sourceRoles"][number]["role"],
) {
  const current = roles.get(provider);
  if (current === "evidence") return;
  if (current && role !== "evidence") return;
  roles.set(provider, role);
}

function locationConfidenceForSituation(
  situation: Situation,
): SituationExplanation["locationConfidence"] {
  const incidentLocationFeatures = situation.features.filter(
    (feature) =>
      feature.properties.provenance !== "preparedness_context" &&
      feature.properties.layer !== "warning",
  );
  const provenances = new Set(
    incidentLocationFeatures.map((feature) => feature.properties.provenance),
  );
  const hasOfficial = provenances.has("official");
  const hasEstimated =
    provenances.has("reporting_estimate") || provenances.has("private_annotation");
  if (hasOfficial && hasEstimated) return "mixed";
  if (hasOfficial) return "official";
  if (hasEstimated) return "estimated";
  return "unknown";
}

export function buildSituationExplanation(
  situation: Situation,
  sourceItems: SourceItem[] = [],
): SituationExplanation {
  const createdBecause: string[] = [];
  if (situation.activationBasis?.rule === "two_independent_sources") {
    createdBecause.push(
      `${situation.activationBasis.sourceIds.length} uavhengige kilder rapporterte samme hendelse.`,
    );
  } else if (situation.activationBasis?.rule === "official_source") {
    createdBecause.push("Opprettet fra en offentlig kilde uten krav om avisartikkel.");
  } else {
    createdBecause.push("Opprettet fra eksisterende kildegrunnlag i situasjonsrommet.");
  }
  if (situation.dismissalReason) createdBecause.push("Situasjonen er avvist som feilkobling.");

  const roles = new Map<SourceId, SituationExplanation["sourceRoles"][number]["role"]>();
  for (const provider of situation.activationBasis?.sourceIds ?? []) {
    addSourceRole(roles, provider, sourceRole(provider));
  }
  for (const evidence of situation.evidence) {
    const role =
      evidence.claimType.includes("warning") || evidence.provenance === "preparedness_context"
        ? "context"
        : sourceRole(evidence.source);
    addSourceRole(roles, evidence.source, role);
  }
  for (const feature of situation.features) {
    if (feature.properties.layer === "warning" && feature.properties.source) {
      addSourceRole(roles, feature.properties.source, "context");
    }
  }
  for (const entry of situation.timeline) {
    if (entry.source && contextSourceIds.has(entry.source)) {
      addSourceRole(roles, entry.source, "context");
    }
  }
  for (const item of sourceItems) {
    addSourceRole(roles, item.provider, linkedSourceItemRole(item));
  }

  return {
    createdBecause,
    sourceRoles: [...roles].map(([provider, role]) => ({ provider, role })),
    locationConfidence: locationConfidenceForSituation(situation),
    ...(situation.dismissalReason ? { dismissalReason: situation.dismissalReason } : {}),
  };
}

function trafficMapSourceStatuses(sourceHealth: SourceHealth[]): TrafficMapSourceStatus[] {
  return sourceHealth
    .filter((source): source is SourceHealth & { source: TrafficMapSourceStatus["source"] } =>
      trafficMapSourceIdSet.has(source.source),
    )
    .map((source) => ({
      source: source.source,
      label: source.label,
      state: source.state,
      detail: source.detail,
      ...(source.lastCheckedAt ? { lastCheckedAt: source.lastCheckedAt } : {}),
    }));
}

function formatRuntimeAge(ageSeconds: number): string {
  const minutes = Math.max(1, Math.round(ageSeconds / 60));
  if (minutes < 90) return `${minutes} min siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} t siden`;
  return `${Math.round(hours / 24)} døgn siden`;
}

function formatRuntimeInterval(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} t`;
  return `${Math.round(hours / 24)} døgn`;
}

function runtimeFreshness(input: {
  label: string;
  completedAt?: string;
  staleAfterSeconds: number;
  checkedAt?: Date;
  startedAt?: string;
  durationSeconds?: number;
}): RuntimeFreshness {
  const checkedAt = input.checkedAt ?? new Date();
  const completedTime = input.completedAt ? new Date(input.completedAt).getTime() : Number.NaN;
  if (!Number.isFinite(completedTime)) {
    return {
      status: "missing",
      label: input.label,
      checkedAt: checkedAt.toISOString(),
      staleAfterSeconds: input.staleAfterSeconds,
      detail: "Ingen fullført status registrert.",
    };
  }
  const ageSeconds = Math.max(0, Math.round((checkedAt.getTime() - completedTime) / 1000));
  const status = ageSeconds > input.staleAfterSeconds ? "stale" : "ok";
  return {
    status,
    label: input.label,
    completedAt: input.completedAt,
    checkedAt: checkedAt.toISOString(),
    staleAfterSeconds: input.staleAfterSeconds,
    ageSeconds,
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(typeof input.durationSeconds === "number"
      ? { durationSeconds: input.durationSeconds }
      : {}),
    detail:
      status === "ok"
        ? `Sist fullført ${formatRuntimeAge(ageSeconds)}.`
        : `Sist fullført ${formatRuntimeAge(ageSeconds)}; forventet innen ${formatRuntimeInterval(
            input.staleAfterSeconds,
          )}.`,
  };
}

function attachmentSizeBytes(size: unknown): number {
  const bytes =
    typeof size === "number" ? size : typeof size === "string" ? Number(size) : Number.NaN;
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : Number.POSITIVE_INFINITY;
}

function requirePublicSameOrigin(config: AppConfig): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && origin !== config.publicOrigin) {
      res.status(403).json({ error: "Ugyldig forespørselsopprinnelse." });
      return;
    }
    next();
  };
}

function appUrl(config: AppConfig, path: string): string {
  return new URL(path, config.publicOrigin).toString();
}

function accessVerificationEmail(config: AppConfig, input: { displayName: string; token: string }) {
  const url = appUrl(config, `/auth/access/verify?token=${encodeURIComponent(input.token)}`);
  return {
    subject: "Bekreft tilgangsforespørsel til Nytt Trondheim",
    text: `Hei ${input.displayName}.\n\nBekreft e-postadressen din for Nytt Trondheim:\n${url}\n\nHvis du ikke ba om tilgang, kan du ignorere denne meldingen.`,
  };
}

function emailLoginMessage(
  config: AppConfig,
  input: { displayName: string; token: string; invite?: boolean },
) {
  const url = appUrl(config, `/auth/email/callback?token=${encodeURIComponent(input.token)}`);
  return {
    subject: input.invite ? "Du har fått tilgang til Nytt Trondheim" : "Logg inn på Nytt Trondheim",
    text: `Hei ${input.displayName}.\n\n${
      input.invite
        ? "Du har fått lesetilgang til Nytt Trondheim."
        : "Bruk lenken under for å logge inn."
    }\n\n${url}\n\nLenken kan bare brukes én gang.`,
  };
}

function logPublicEmailDeliveryError(context: string, error: unknown) {
  console.error("Public auth email delivery failed", {
    context,
    error: error instanceof Error ? error.message : String(error),
  });
}

interface RateLimitRule {
  name: string;
  max: number;
  windowMs: number;
}

const rateLimitRules = {
  auth: { name: "auth", max: 20, windowMs: 15 * 60 * 1000 },
  api: { name: "api", max: 120, windowMs: 60 * 1000 },
  write: { name: "write", max: 20, windowMs: 60 * 1000 },
  export: { name: "export", max: 5, windowMs: 60 * 1000 },
  upload: { name: "upload", max: 10, windowMs: 60 * 1000 },
} satisfies Record<string, RateLimitRule>;

function selectRateLimitRule(req: express.Request): RateLimitRule | undefined {
  if (req.path.startsWith("/auth/")) return rateLimitRules.auth;
  if (!req.path.startsWith("/api/")) return undefined;
  if (req.path.includes("/attachments")) return rateLimitRules.upload;
  if (req.path.includes("/exports")) return rateLimitRules.export;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return rateLimitRules.write;
  return rateLimitRules.api;
}

function createRateLimiter(): express.RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const rule = selectRateLimitRule(req);
    if (!rule) {
      next();
      return;
    }

    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const key = `${rule.name}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + rule.windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > rule.max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: "For mange forespørsler. Prøv igjen senere." });
      return;
    }

    next();
  };
}

function validationDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status =
    "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined;
  return typeof status === "number" ? status : undefined;
}

function eventIntersectsTimeRange(event: TrafficMapEvent, from?: string, to?: string): boolean {
  const fromMs = from ? Date.parse(from) : Number.NaN;
  const toMs = to ? Date.parse(to) : Number.NaN;
  const startMs = Date.parse(event.validFrom ?? event.updatedAt);
  const endMs =
    event.state === "active" && !event.validTo
      ? Number.POSITIVE_INFINITY
      : Date.parse(event.validTo ?? event.validFrom ?? event.updatedAt);

  if (Number.isFinite(fromMs) && Number.isFinite(endMs) && endMs < fromMs) return false;
  if (Number.isFinite(toMs) && Number.isFinite(startMs) && startMs > toMs) return false;
  return true;
}

function filterTrafficMapEvents(
  events: TrafficMapEvent[],
  query: ReturnType<typeof trafficMapQuerySchema.parse>,
): TrafficMapEvent[] {
  const states = query.states === undefined ? ["active", "planned"] : query.states;
  return events.filter((event) => {
    if (query.categories !== undefined && !query.categories.includes(event.category)) return false;
    if (query.severities !== undefined && !query.severities.includes(event.severity)) return false;
    if (!(states as TrafficEventState[]).includes(event.state)) return false;
    if (!eventIntersectsTimeRange(event, query.from, query.to)) return false;
    if (
      typeof query.north === "number" &&
      typeof query.south === "number" &&
      typeof query.east === "number" &&
      typeof query.west === "number" &&
      !geometryIntersectsBounds(event.geometry, {
        north: query.north,
        south: query.south,
        east: query.east,
        west: query.west,
      })
    ) {
      return false;
    }
    return true;
  });
}

function sourceConfidenceForSituation(
  situation: Situation,
  sourceItems: SourceItem[],
): SourceConfidenceSummary {
  const evidenceScores = situation.evidence
    .map((evidence) => evidence.confidence)
    .filter((value) => Number.isFinite(value));
  const score =
    evidenceScores.length > 0
      ? evidenceScores.reduce((total, value) => total + value, 0) / evidenceScores.length
      : undefined;
  const hasOfficialSignal =
    situation.verificationStatus === "Offentlig bekreftet" ||
    situation.evidence.some((evidence) => evidence.provenance === "official") ||
    sourceItems.some(
      (item) => item.reliabilityTier === "official" && item.relationship === "supports",
    );
  const level = hasOfficialSignal ? "confirmed" : sourceConfidenceLevelFromScore(score);
  const sourceIds = new Set<SourceId>([
    ...situation.evidence.map((evidence) => evidence.source),
    ...situation.timeline.flatMap((entry) => (entry.source ? [entry.source] : [])),
    ...sourceItems.map((item) => item.provider),
  ]);
  return {
    level,
    label: sourceConfidenceLabels[level],
    ...(score !== undefined ? { score: Math.round(score * 100) / 100 } : {}),
    sourceCount: sourceIds.size,
    updatedAt: situation.updatedAt,
    rationale: hasOfficialSignal
      ? "Offentlig eller offisielt kildegrunnlag er koblet til situasjonen."
      : "Bygget fra tilgjengelige kilde- og tidslinjesignaler.",
  };
}

function sourceConfidenceForHeatmapCell(cell: SpatialHeatmapCell): SourceConfidenceSummary {
  const sources = new Set(cell.sourceIds);
  if (cell.articleCount > 0) sources.add("news_article");
  if (cell.trafficEventCount > 0) sources.add("vegvesen_traffic_info");
  return sourceMixConfidenceSummary([...sources], { updatedAt: cell.lastSeenAt });
}

function sourceConfidenceForDelayCandidate(
  candidate: UnexplainedDelayCandidate,
): SourceConfidenceSummary {
  const sources = new Set<string>(["datex_travel_time"]);
  if (candidate.matchedArticleIds.length > 0) sources.add("news_article");
  if (candidate.affectedEventIds.length > 0) sources.add("vegvesen_traffic_info");
  return sourceMixConfidenceSummary([...sources], { updatedAt: candidate.updatedAt });
}

function sourceConfidenceCounts(
  items: Array<{ sourceConfidence?: SourceConfidenceSummary }>,
): Record<SourceConfidenceSummary["level"], number> {
  return items.reduce<Record<SourceConfidenceSummary["level"], number>>(
    (counts, item) => {
      counts[item.sourceConfidence?.level ?? "uncertain"] += 1;
      return counts;
    },
    { confirmed: 0, likely: 0, uncertain: 0, speculative: 0 },
  );
}

function addProvenanceBucket(
  buckets: Map<
    Provenance,
    {
      sourceIds: Set<SourceId>;
      evidenceIds: string[];
      sourceItemIds: string[];
      scores: number[];
    }
  >,
  provenance: Provenance,
  input: {
    sourceId?: SourceId;
    evidenceId?: string;
    sourceItemId?: string;
    score?: number;
  },
) {
  const bucket = buckets.get(provenance) ?? {
    sourceIds: new Set<SourceId>(),
    evidenceIds: [],
    sourceItemIds: [],
    scores: [],
  };
  if (input.sourceId) bucket.sourceIds.add(input.sourceId);
  if (input.evidenceId) bucket.evidenceIds.push(input.evidenceId);
  if (input.sourceItemId) bucket.sourceItemIds.push(input.sourceItemId);
  if (typeof input.score === "number" && Number.isFinite(input.score))
    bucket.scores.push(input.score);
  buckets.set(provenance, bucket);
}

function provenanceSummaryForSituation(
  situation: Situation,
  sourceItems: SourceItem[],
): ProvenanceConfidence[] {
  const buckets = new Map<
    Provenance,
    {
      sourceIds: Set<SourceId>;
      evidenceIds: string[];
      sourceItemIds: string[];
      scores: number[];
    }
  >();

  for (const evidence of situation.evidence) {
    addProvenanceBucket(buckets, evidence.provenance, {
      sourceId: evidence.source,
      evidenceId: evidence.id,
      score: evidence.confidence,
    });
  }
  for (const feature of situation.features) {
    addProvenanceBucket(buckets, feature.properties.provenance, {
      sourceId: feature.properties.source,
      score: feature.properties.sourceConfidence?.score,
    });
  }
  for (const item of sourceItems) {
    const provenance: Provenance =
      item.relationship === "supports"
        ? item.reliabilityTier === "official"
          ? "official"
          : "reporting_estimate"
        : "preparedness_context";
    addProvenanceBucket(buckets, provenance, {
      sourceId: item.provider,
      sourceItemId: item.id,
      score: item.confidence?.score,
    });
  }

  return [...buckets.entries()].map(([provenance, bucket]) => {
    const averageScore =
      bucket.scores.length > 0
        ? bucket.scores.reduce((total, value) => total + value, 0) / bucket.scores.length
        : undefined;
    const level =
      provenance === "official" ? "confirmed" : sourceConfidenceLevelFromScore(averageScore);
    return {
      provenance,
      label: provenanceLabels[provenance],
      sourceIds: [...bucket.sourceIds].sort(),
      confidence: {
        level,
        label: sourceConfidenceLabels[level],
        ...(averageScore !== undefined ? { score: Math.round(averageScore * 100) / 100 } : {}),
        sourceCount: bucket.sourceIds.size,
        updatedAt: situation.updatedAt,
      },
      ...(bucket.evidenceIds.length ? { evidenceIds: bucket.evidenceIds } : {}),
      ...(bucket.sourceItemIds.length ? { sourceItemIds: bucket.sourceItemIds } : {}),
    };
  });
}

function inferredTimelineProvenance(entry: TimelineEntry): Provenance {
  if (entry.provenance) return entry.provenance;
  return entry.official ? "official" : "reporting_estimate";
}

function isPrivateTimelineEntry(entry: TimelineEntry): boolean {
  return (
    entry.kind === "private_annotation" ||
    entry.privateAnnotationId !== undefined ||
    inferredTimelineProvenance(entry) === "private_annotation"
  );
}

function viewerSafeTimeline(timeline: TimelineEntry[]): TimelineEntry[] {
  return timeline.filter((entry) => !isPrivateTimelineEntry(entry));
}

function timelineEntryMatchesWorkspaceQuery(
  entry: TimelineEntry,
  query: ReturnType<typeof workspaceMapQuerySchema.parse>,
): boolean {
  if (query.includeTelemetry === false && entry.source && telemetrySourceIds.has(entry.source))
    return false;
  if (query.sources && (!entry.source || !query.sources.includes(entry.source))) return false;
  const provenance = inferredTimelineProvenance(entry);
  if (query.provenances && !query.provenances.includes(provenance)) return false;
  if (
    query.confidenceLevels &&
    !query.confidenceLevels.includes(entry.confidence?.level ?? "uncertain")
  ) {
    return false;
  }
  if (query.includePrivateAnnotations === false && provenance === "private_annotation")
    return false;
  const timestamp = Date.parse(entry.timestamp);
  if (query.from && Number.isFinite(timestamp) && timestamp < Date.parse(query.from)) return false;
  if (query.to && Number.isFinite(timestamp) && timestamp > Date.parse(query.to)) return false;
  const search = query.q?.toLocaleLowerCase("nb");
  if (
    search &&
    !`${entry.title} ${entry.detail} ${entry.sourceLabel}`.toLocaleLowerCase("nb").includes(search)
  ) {
    return false;
  }
  return true;
}

function featureMatchesWorkspaceQuery(
  feature: MapFeature,
  query: ReturnType<typeof workspaceMapQuerySchema.parse>,
): boolean {
  if (
    query.includeTelemetry === false &&
    feature.properties.source &&
    telemetrySourceIds.has(feature.properties.source)
  ) {
    return false;
  }
  if (
    query.includePrivateAnnotations === false &&
    feature.properties.provenance === "private_annotation"
  ) {
    return false;
  }
  if (query.provenances && !query.provenances.includes(feature.properties.provenance)) return false;
  if (
    query.confidenceLevels &&
    !query.confidenceLevels.includes(feature.properties.sourceConfidence?.level ?? "uncertain")
  ) {
    return false;
  }
  if (
    typeof query.north === "number" &&
    typeof query.south === "number" &&
    typeof query.east === "number" &&
    typeof query.west === "number" &&
    !geometryIntersectsBounds(feature.geometry, {
      north: query.north,
      south: query.south,
      east: query.east,
      west: query.west,
    })
  ) {
    return false;
  }
  return true;
}

function isPrivateAnnotationFeature(feature: MapFeature): feature is PrivateAnnotationFeature {
  return feature.properties.provenance === "private_annotation";
}

function viewerSafeWorkspace(workspace: SituationWorkspace): SituationWorkspace {
  return {
    ...workspace,
    situation: {
      ...workspace.situation,
      features: workspace.situation.features.filter(
        (feature) => !isPrivateAnnotationFeature(feature),
      ),
      timeline: viewerSafeTimeline(workspace.situation.timeline),
      saved: false,
    },
    tasks: [],
    notes: [],
    attachments: [],
  };
}

function canReadSituation(req: express.Request, situation: Situation): boolean {
  return req.user?.role === "owner" || isPublicSituation(situation);
}

function sourceIdsForSituation(situation: Situation, sourceItems: SourceItem[]): Set<SourceId> {
  return new Set<SourceId>([
    ...situation.evidence.map((evidence) => evidence.source),
    ...situation.timeline.flatMap((entry) => (entry.source ? [entry.source] : [])),
    ...situation.features.flatMap((feature) =>
      feature.properties.source ? [feature.properties.source] : [],
    ),
    ...sourceItems.map((item) => item.provider),
    ...(situation.officialSource ? [situation.officialSource] : []),
    ...(situation.activationBasis?.sourceIds ?? []),
  ]);
}

function situationMatchesWorkspaceQuery(
  situation: Situation,
  sourceItems: SourceItem[],
  sourceConfidence: SourceConfidenceSummary,
  query: ReturnType<typeof workspaceMapQuerySchema.parse>,
): boolean {
  if (query.situationIds && !query.situationIds.includes(situation.id)) return false;
  if (query.statuses && !query.statuses.includes(situation.status)) return false;
  if (
    query.publicVisibility &&
    !query.publicVisibility.includes(situationPublicVisibility(situation))
  ) {
    return false;
  }
  if (query.types && !query.types.includes(situation.type)) return false;
  if (query.sources) {
    const sources = sourceIdsForSituation(situation, sourceItems);
    const allowedSources =
      query.includeTelemetry === false
        ? query.sources.filter((source) => !telemetrySourceIds.has(source))
        : query.sources;
    if (!allowedSources.length || !allowedSources.some((source) => sources.has(source)))
      return false;
  }
  if (query.provenances) {
    const visibleFeatures = situation.features.filter(
      (feature) =>
        query.includePrivateAnnotations !== false || !isPrivateAnnotationFeature(feature),
    );
    const provenances = new Set<Provenance>([
      ...situation.evidence.map((evidence) => evidence.provenance),
      ...visibleFeatures.map((feature) => feature.properties.provenance),
      ...situation.timeline.map(inferredTimelineProvenance),
    ]);
    if (!query.provenances.some((provenance) => provenances.has(provenance))) return false;
  }
  if (query.confidenceLevels && !query.confidenceLevels.includes(sourceConfidence.level))
    return false;
  if (query.from || query.to) {
    const fromTime = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
    const toTime = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;
    const relevantTimes = [
      Date.parse(situation.updatedAt),
      Date.parse(situation.createdAt),
      ...situation.timeline
        .filter((entry) => timelineEntryMatchesWorkspaceQuery(entry, query))
        .map((entry) => Date.parse(entry.timestamp)),
    ].filter(Number.isFinite);
    if (!relevantTimes.some((time) => time >= fromTime && time <= toTime)) return false;
  }
  const search = query.q?.toLocaleLowerCase("nb");
  if (
    search &&
    !`${situation.title} ${situation.summary} ${situation.locationLabel}`
      .toLocaleLowerCase("nb")
      .includes(search)
  ) {
    return false;
  }
  return true;
}

function mapFirstSituationFromWorkspace(
  situation: Situation,
  sourceItems: SourceItem[],
  query: ReturnType<typeof workspaceMapQuerySchema.parse>,
): MapFirstSituation | undefined {
  const sourceConfidence = sourceConfidenceForSituation(situation, sourceItems);
  if (!situationMatchesWorkspaceQuery(situation, sourceItems, sourceConfidence, query)) {
    return undefined;
  }
  const features = situation.features.filter((feature) =>
    featureMatchesWorkspaceQuery(feature, query),
  );
  const timelinePreview = situation.timeline
    .filter((entry) => timelineEntryMatchesWorkspaceQuery(entry, query))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 4);
  const primaryFeature =
    features.find(
      (feature) =>
        feature.geometry.type === "Point" && feature.properties.provenance !== "private_annotation",
    ) ??
    features.find((feature) => feature.geometry.type === "Point") ??
    features[0];

  return {
    id: situation.id,
    type: situation.type,
    title: situation.title,
    summary: situation.summary,
    status: situation.status,
    publicVisibility: situationPublicVisibility(situation),
    importance: situation.importance,
    updatedAt: situation.updatedAt,
    locationLabel: situation.locationLabel,
    ...(primaryFeature ? { primaryFeature } : {}),
    features,
    timelinePreview,
    provenanceSummary: provenanceSummaryForSituation({ ...situation, features }, sourceItems),
    sourceConfidence,
    hasPrivateAnnotations: features.some(isPrivateAnnotationFeature),
    saved: situation.saved,
  };
}

export interface AppRuntime {
  app: express.Express;
  store: Store;
  pool?: pg.Pool;
}

export async function createApp(config: AppConfig): Promise<AppRuntime> {
  const app = express();
  const pool = config.databaseUrl
    ? new pg.Pool({ connectionString: config.databaseUrl })
    : undefined;
  const store: Store = pool ? new PgStore(pool) : new MemoryStore();
  if (pool && config.seedDemo) await (store as PgStore).seedDevelopmentData();

  await mkdir(config.uploadDir, { recursive: true });
  app.set("trust proxy", 1);
  if (config.rateLimitEnabled) {
    app.use(createRateLimiter());
  }
  const emailSender = config.emailSender ?? createEmailSender(config);
  app.use(
    helmet({
      contentSecurityPolicy:
        config.nodeEnv === "production"
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: [
                  "'self'",
                  "data:",
                  "https://cache.kartverket.no",
                  "https://ogc.dsb.no",
                  "https://webkamera.vegvesen.no",
                  "https://webkamera.atlas.vegvesen.no",
                  "https://www.vegvesen.no",
                ],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
              },
            }
          : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  configureAuth(app, config, store, pool);

  app.get("/health", async (_req, res) => {
    try {
      if (pool) await pool.query("SELECT 1");
      res.json({ status: "ok", storage: pool ? "postgres" : "development-memory" });
    } catch {
      res.status(503).json({ status: "degraded" });
    }
  });

  app.get("/auth/access/verify", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const result = token ? await store.verifyAccessRequestToken(token) : "invalid";
      res.redirect(
        result === "verified" ? "/logg-inn?access=verified" : "/logg-inn?access=invalid",
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/email/request", requirePublicSameOrigin(config), async (req, res, next) => {
    try {
      const input = emailLoginRequestSchema.parse(req.body);
      const result = await store.requestEmailLogin(input.email);
      if (result.login) {
        const message = emailLoginMessage(config, result.login);
        try {
          await emailSender.send({ to: result.login.email, ...message });
        } catch (error) {
          logPublicEmailDeliveryError("email_login", error);
        }
      }
      res.status(202).json({ status: "received" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/email/callback", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const user = token ? await store.consumeEmailLoginToken(token) : undefined;
      if (!user) {
        res.redirect("/logg-inn?email=invalid");
        return;
      }
      req.login(user, (error) => {
        if (error) return next(error);
        res.redirect("/");
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/access-requests", requirePublicSameOrigin(config), async (req, res, next) => {
    try {
      const input = accessRequestInputSchema.parse(req.body);
      const result = await store.createAccessRequest(input);
      if (result.verification) {
        const message = accessVerificationEmail(config, result.verification);
        try {
          await emailSender.send({ to: result.verification.email, ...message });
        } catch (error) {
          logPublicEmailDeliveryError("access_verification", error);
        }
      }
      res.status(202).json({ status: "received" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/session", requireUser, (req, res) =>
    res.json({ user: req.user, csrfToken: csrfToken(req) }),
  );
  app.use("/api", requireUser);
  app.use("/api", requireCsrf(config));

  app.use("/api/operations", requireOwner);
  app.use("/api/saved", requireOwner);
  app.use("/api/source-items", requireOwner);
  app.use("/api/users", requireOwner);

  app.get("/api/notifications/settings", async (req, res, next) => {
    try {
      res.json(
        await store.getPushSettings(
          req.user?.id ?? currentLogin(req),
          config.webPushConfigured ? config.webPushPublicKey : undefined,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notifications/subscriptions", async (req, res, next) => {
    try {
      if (!config.webPushConfigured || !config.webPushPublicKey) {
        res.status(503).json({ error: "Web Push er ikke konfigurert ennå." });
        return;
      }
      const input = pushSubscriptionInputSchema.parse(req.body);
      const subscription = await store.upsertPushSubscription(
        req.user?.id ?? currentLogin(req),
        input,
      );
      res.status(201).json(subscription);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/notifications/subscriptions/:id", async (req, res, next) => {
    try {
      await store.deletePushSubscription(req.user?.id ?? currentLogin(req), String(req.params.id));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/access-requests", requireOwner, async (req, res, next) => {
    try {
      const query = accessRequestQuerySchema.parse(req.query);
      res.json(await store.listAccessRequests(query, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/access-requests/:id", requireOwner, async (req, res, next) => {
    try {
      const input = accessRequestDecisionSchema.parse(req.body);
      const result = await store.decideAccessRequest(
        String(req.params.id),
        input,
        currentLogin(req),
      );
      if (result.invite) {
        const message = emailLoginMessage(config, { ...result.invite, invite: true });
        await emailSender.send({ to: result.invite.email, ...message });
      }
      res.json(result.request);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users", requireOwner, async (req, res, next) => {
    try {
      res.json(await store.listUsers(currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users", requireOwner, async (req, res, next) => {
    try {
      const input = userGrantSchema.parse(req.body);
      const result = await store.grantUserAccess(input, currentLogin(req));
      const message = emailLoginMessage(config, { ...result.invite, invite: true });
      await emailSender.send({ to: result.invite.email, ...message });
      res.status(201).json(result.user);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:id", requireOwner, async (req, res, next) => {
    try {
      const input = userUpdateSchema.parse(req.body);
      const result = await store.updateUser(String(req.params.id), input, currentLogin(req));
      if (result.invite) {
        const message = emailLoginMessage(config, { ...result.invite, invite: true });
        await emailSender.send({ to: result.invite.email, ...message });
      }
      res.json(result.user);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/bootstrap", async (req, res, next) => {
    try {
      res.json(await store.getBootstrap(currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/articles", async (req, res, next) => {
    try {
      const query = articleQuerySchema.parse(req.query);
      res.json(await store.listArticles(query, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sport/world-cup", async (_req, res, next) => {
    try {
      const dashboard = await loadWorldCupDashboard();
      res.set("Cache-Control", "private, max-age=60");
      res.json(dashboard);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/source-items", async (req, res, next) => {
    try {
      const query = sourceItemQuerySchema.parse(req.query);
      res.json(await store.listSourceItems(query, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/map/traffic-events", async (req, res, next) => {
    try {
      const query = trafficMapQuerySchema.parse(req.query);
      const login = currentLogin(req);
      const requestedStates = query.states ?? ["active", "planned"];
      const bounds =
        typeof query.north === "number" &&
        typeof query.south === "number" &&
        typeof query.east === "number" &&
        typeof query.west === "number"
          ? { north: query.north, south: query.south, east: query.east, west: query.west }
          : undefined;
      const [
        trafficInfoEvents,
        officialEvents,
        articlesPage,
        sourceHealth,
        trafficPulse,
        weather,
        cameras,
        counters,
      ] = await Promise.all([
        store.listTrafficMapEvents(
          {
            sources: ["vegvesen_traffic_info"],
            states: requestedStates,
            categories: query.categories,
            severities: query.severities,
            from: query.from,
            to: query.to,
            bounds,
          },
          login,
        ),
        store.listOfficialEvents({ source: "datex" }, login),
        store.listArticles({ limit: 500 }, login),
        store.listSourceHealth(),
        store.listTrafficPulseCorridors(50),
        store.listRoadWeatherObservations(bounds),
        store.listRoadCameras(bounds),
        store.listTrafficCounterSnapshots(bounds),
      ]);
      const eventsBySourceKey = new Map<string, TrafficMapEvent>();
      const sourceKey = (event: TrafficMapEvent) => `${event.source}:${event.sourceEventId}`;

      for (const event of trafficInfoEvents) {
        eventsBySourceKey.set(sourceKey(event), event);
      }
      for (const event of officialEvents) {
        const trafficEvent = officialEventToTrafficMapEvent(event);
        if (trafficEvent) eventsBySourceKey.set(sourceKey(trafficEvent), trafficEvent);
      }
      if (query.estimatedNews) {
        const estimatedEvents = roadClosingArticleTrafficEvents(articlesPage.items, {
          officialEvents: [...eventsBySourceKey.values()],
        });
        for (const event of estimatedEvents) {
          eventsBySourceKey.set(sourceKey(event), event);
        }
      }
      const events = filterTrafficMapEvents([...eventsBySourceKey.values()], query).map((event) => {
        const relatedArticles = relatedTrafficArticlesForEvent(event, articlesPage.items);
        return relatedArticles.length > 0 ? { ...event, relatedArticles } : event;
      });
      res.json({
        events,
        brief: buildTrafficBrief(events),
        corridorImpacts: buildCorridorImpacts(events, trafficPulse),
        sources: trafficMapSourceStatuses(sourceHealth),
        weather,
        cameras,
        counters,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/map/travel-plan", async (req, res, next) => {
    try {
      const query = travelPlanQuerySchema.parse(req.query);
      const login = currentLogin(req);
      const { origin, destination, route } = await resolveTravelPlanPlacesAndRoute(
        query.from,
        query.to,
      );
      const bounds = routeBounds(route);
      const publicTransportModes: PublicTransportVehicle["mode"][] = [
        "bus",
        "tram",
        "rail",
        "water",
      ];
      const [trafficInfoEvents, officialEvents, vehicles, alerts, sourceHealth] = await Promise.all(
        [
          store.listTrafficMapEvents(
            {
              sources: ["vegvesen_traffic_info"],
              states: ["active", "planned"],
              bounds,
              limit: null,
            },
            login,
          ),
          store.listOfficialEvents({ source: "datex" }, login),
          store.listPublicTransportVehicles({ modes: publicTransportModes, bounds, limit: null }),
          store.listPublicTransportServiceAlerts({ states: ["active"], bounds, limit: null }),
          store.listSourceHealth(),
        ],
      );
      const eventsBySourceKey = new Map<string, TrafficMapEvent>();
      const sourceKey = (event: TrafficMapEvent) => `${event.source}:${event.sourceEventId}`;
      for (const event of trafficInfoEvents) eventsBySourceKey.set(sourceKey(event), event);
      for (const event of officialEvents) {
        const trafficEvent = officialEventToTrafficMapEvent(event);
        if (trafficEvent && (trafficEvent.state === "active" || trafficEvent.state === "planned")) {
          eventsBySourceKey.set(sourceKey(trafficEvent), trafficEvent);
        }
      }
      res.json(
        buildTravelPlanPayload({
          origin,
          destination,
          route,
          events: [...eventsBySourceKey.values()],
          vehicles,
          alerts,
          sourceHealth,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/weather/preparedness", async (req, res, next) => {
    try {
      const login = currentLogin(req);
      const [officialEvents, roadWeather, sourceHealth] = await Promise.all([
        store.listOfficialEvents({ states: ["active", "updated"] }, login),
        store.listRoadWeatherObservations(defaultWeatherBounds),
        store.listSourceHealth(),
      ]);
      res.json(await loadWeatherPreparedness({ officialEvents, roadWeather, sourceHealth }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/map/public-transport", async (req, res, next) => {
    try {
      const query = publicTransportMapQuerySchema.parse(req.query);
      const bounds =
        typeof query.north === "number" &&
        typeof query.south === "number" &&
        typeof query.east === "number" &&
        typeof query.west === "number"
          ? { north: query.north, south: query.south, east: query.east, west: query.west }
          : defaultPublicTransportBounds;
      const [vehicles, alerts, sourceHealth] = await Promise.all([
        store.listPublicTransportVehicles({ modes: query.modes, bounds }),
        query.includeAlerts === false
          ? Promise.resolve([])
          : store.listPublicTransportServiceAlerts({ states: ["active"], bounds }),
        store.listSourceHealth(),
      ]);
      res.json({
        vehicles,
        alerts,
        sources: sourceHealth.filter((source) => publicTransportSourceIdSet.has(source.source)),
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/saved/articles", async (req, res, next) => {
    try {
      res.json(await store.listSavedArticles(currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/saved/:articleId", async (req, res, next) => {
    try {
      const saved = await store.setSaved(
        req.params.articleId,
        Boolean(req.body?.saved),
        currentLogin(req),
      );
      if (!saved) return void res.status(404).json({ error: "Saken finnes ikke." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/saved/articles/:articleId", async (req, res, next) => {
    try {
      const saved = await store.setSaved(req.params.articleId, true, currentLogin(req));
      if (!saved) return void res.status(404).json({ error: "Saken finnes ikke." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/saved/:articleId", async (req, res, next) => {
    try {
      const saved = await store.setSaved(req.params.articleId, false, currentLogin(req));
      if (!saved) return void res.status(404).json({ error: "Saken finnes ikke." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/saved/articles/:articleId", async (req, res, next) => {
    try {
      const saved = await store.setSaved(req.params.articleId, false, currentLogin(req));
      if (!saved) return void res.status(404).json({ error: "Saken finnes ikke." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations", async (req, res, next) => {
    try {
      const query = situationQuerySchema.parse(req.query);
      res.json(
        await store.listSituations(
          { ...query, publicOnly: req.user?.role !== "owner" },
          currentLogin(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/workspace-map", async (req, res, next) => {
    try {
      const query = workspaceMapQuerySchema.parse(req.query);
      const effectiveQuery =
        req.user?.role === "owner"
          ? query
          : {
              ...query,
              includePrivateAnnotations: false,
              layers: query.layers?.filter((layer) => layer !== "private_annotations"),
            };
      const login = currentLogin(req);
      const includeDismissed = effectiveQuery.statuses?.includes("dismissed") ?? false;
      const situations = await store.listSituations(
        { includeDismissed, limit: 100, publicOnly: req.user?.role !== "owner" },
        login,
      );
      const workspaceRows = await Promise.all(
        situations.items.map(async (situation) => {
          const [workspace, sourceItems] = await Promise.all([
            store.getWorkspace(situation.id, login),
            store.listSituationSourceItems(situation.id, login),
          ]);
          if (!workspace) return undefined;
          return { workspace, sourceItems };
        }),
      );
      const entries = workspaceRows.filter(
        (entry): entry is { workspace: SituationWorkspace; sourceItems: SourceItem[] } =>
          Boolean(entry),
      );
      const mappedSituations = entries
        .map(({ workspace, sourceItems }) =>
          mapFirstSituationFromWorkspace(
            req.user?.role === "owner"
              ? workspace.situation
              : viewerSafeWorkspace(workspace).situation,
            sourceItems,
            effectiveQuery,
          ),
        )
        .filter((situation): situation is MapFirstSituation => Boolean(situation));
      const visibleIds = new Set(mappedSituations.map((situation) => situation.id));
      const timeline = entries
        .filter(({ workspace }) => visibleIds.has(workspace.situation.id))
        .flatMap(({ workspace }) => workspace.situation.timeline)
        .filter((entry) => timelineEntryMatchesWorkspaceQuery(entry, effectiveQuery))
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, 100);
      const privateAnnotations = mappedSituations.flatMap((situation) =>
        effectiveQuery.includePrivateAnnotations === false
          ? []
          : situation.features.filter(isPrivateAnnotationFeature),
      );
      const payload: SituationMapWorkspace = {
        situations: mappedSituations,
        mapState: {
          ...(typeof effectiveQuery.north === "number" &&
          typeof effectiveQuery.south === "number" &&
          typeof effectiveQuery.east === "number" &&
          typeof effectiveQuery.west === "number"
            ? {
                bounds: {
                  north: effectiveQuery.north,
                  south: effectiveQuery.south,
                  east: effectiveQuery.east,
                  west: effectiveQuery.west,
                },
              }
            : {}),
          layers: effectiveQuery.layers ?? [
            "situations",
            "evidence",
            "preparedness_context",
            ...(req.user?.role === "owner" ? ["private_annotations" as const] : []),
          ],
          sourceFilters: {
            providers: effectiveQuery.sources,
            provenances: effectiveQuery.provenances,
            confidenceLevels: effectiveQuery.confidenceLevels,
            includeTelemetry: effectiveQuery.includeTelemetry,
            includePrivateAnnotations: effectiveQuery.includePrivateAnnotations,
            q: effectiveQuery.q,
          },
        },
        timeline,
        privateAnnotations,
      };
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id", async (req, res, next) => {
    try {
      const situationId = String(req.params.id);
      const workspace = await store.getWorkspace(situationId, currentLogin(req));
      if (!workspace) {
        res.status(404).json({ error: "Situasjonen finnes ikke." });
        return;
      }
      if (!canReadSituation(req, workspace.situation)) {
        res.status(404).json({ error: "Situasjonen finnes ikke." });
        return;
      }
      const isOwner = req.user?.role === "owner";
      const sourceItems = isOwner
        ? await store.listSituationSourceItems(situationId, currentLogin(req))
        : [];
      const visibleWorkspace = isOwner ? workspace : viewerSafeWorkspace(workspace);
      res.json({
        ...visibleWorkspace,
        explanation: buildSituationExplanation(visibleWorkspace.situation, sourceItems),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/timeline", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      if (!canReadSituation(req, workspace.situation)) {
        return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      }
      const visibleWorkspace =
        req.user?.role === "owner" ? workspace : viewerSafeWorkspace(workspace);
      res.json(visibleWorkspace.situation.timeline);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/articles", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      if (!canReadSituation(req, workspace.situation)) {
        return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      }
      res.json(workspace.relatedArticles);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/source-items", requireOwner, async (req, res, next) => {
    try {
      const situationId = String(req.params.id);
      const workspace = await store.getWorkspace(situationId, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(await store.listSituationSourceItems(situationId, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/situations/:id/source-items/:sourceItemId",
    requireOwner,
    async (req, res, next) => {
      try {
        const { relationship } = sourceItemLinkInputSchema.parse(req.body ?? {});
        const linked = await store.linkSourceItem(
          String(req.params.id),
          String(req.params.sourceItemId),
          relationship,
          currentLogin(req),
        );
        if (!linked) {
          res.status(404).json({ error: "Situasjon eller kildeelement finnes ikke." });
          return;
        }
        res.status(201).json(linked);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/situations/:id/source-items/:sourceItemId",
    requireOwner,
    async (req, res, next) => {
      try {
        await store.unlinkSourceItem(
          String(req.params.id),
          String(req.params.sourceItemId),
          currentLogin(req),
        );
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/situations/:id/features", requireOwner, async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(String(req.params.id), currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(workspace.situation.features);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/situations/:id/saved", requireOwner, async (req, res, next) => {
    try {
      const saved = await store.setSavedSituation(String(req.params.id), true, currentLogin(req));
      if (!saved) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/situations/:id/saved", requireOwner, async (req, res, next) => {
    try {
      const saved = await store.setSavedSituation(String(req.params.id), false, currentLogin(req));
      if (!saved) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/situations/:id/status", requireOwner, async (req, res, next) => {
    try {
      const { status, dismissalReason } = lifecycleInputSchema.parse(req.body);
      const situation = await store.setSituationStatus(
        String(req.params.id),
        status,
        dismissalReason,
      );
      if (!situation) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(situation);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/situations/:id/publication", requireOwner, async (req, res, next) => {
    try {
      const { publicVisibility } = situationPublicationInputSchema.parse(req.body);
      const situation = await store.setSituationPublicVisibility(
        String(req.params.id),
        publicVisibility,
      );
      if (!situation) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(situation);
    } catch (error) {
      next(error);
    }
  });

  const ensureSituationExists: express.RequestHandler = async (req, res, next) => {
    try {
      const situationId = String(req.params.id);
      const workspace = await store.getWorkspace(situationId, currentLogin(req));
      if (!workspace) {
        res.status(404).json({ error: "Situasjonen finnes ikke." });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  async function unlinkedPrivateAnnotationSourceItemIds(
    situationId: string,
    login: string,
    sourceItemIds: string[] | undefined,
  ) {
    if (!sourceItemIds?.length) return [];
    const linkedIds = new Set(
      (await store.listSituationSourceItems(situationId, login)).map((item) => item.id),
    );
    return sourceItemIds.filter((sourceItemId) => !linkedIds.has(sourceItemId));
  }

  app.post(
    "/api/situations/:id/features",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        const input = privateMapFeatureInputSchema.parse(req.body);
        const login = currentLogin(req);
        const situationId = String(req.params.id);
        const sourceItemIds = input.properties.sourceItemIds ?? [];
        const invalidIds = await unlinkedPrivateAnnotationSourceItemIds(
          situationId,
          login,
          sourceItemIds,
        );
        if (invalidIds.length) {
          return void res.status(400).json({
            error:
              "Kildeelementer må være koblet til situasjonen før de kan brukes som privat markering-grunnlag.",
          });
        }
        const feature: MapFeature = {
          id: randomUUID(),
          type: "Feature",
          geometry: input.geometry,
          properties: {
            ...input.properties,
            provenance: "private_annotation",
            updatedAt: new Date().toISOString(),
          },
        };
        res.status(201).json(await store.addPrivateFeature(situationId, feature));
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    "/api/situations/:id/features/:featureId",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        const input = privateAnnotationUpdateRequestSchema.parse(req.body);
        const login = currentLogin(req);
        const situationId = String(req.params.id);
        const invalidIds = await unlinkedPrivateAnnotationSourceItemIds(
          situationId,
          login,
          input.sourceItemIds,
        );
        if (invalidIds.length) {
          return void res.status(400).json({
            error:
              "Kildeelementer må være koblet til situasjonen før de kan brukes som privat markering-grunnlag.",
          });
        }
        const feature = await store.updatePrivateFeature(
          situationId,
          String(req.params.featureId),
          input,
        );
        if (!feature) return void res.status(404).json({ error: "Markeringen finnes ikke." });
        res.json(feature);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/situations/:id/features/:featureId",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        if (
          !(await store.deletePrivateFeature(String(req.params.id), String(req.params.featureId)))
        ) {
          return void res.status(404).json({ error: "Markeringen finnes ikke." });
        }
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/situations/:id/tasks",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        const { text } = taskInputSchema.parse(req.body);
        res.status(201).json(await store.addTask(String(req.params.id), text));
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    "/api/situations/:id/tasks/:taskId",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        const situationId = String(req.params.id);
        const taskId = String(req.params.taskId);
        const task =
          typeof req.body?.text === "string"
            ? await store.updateTaskText(situationId, taskId, taskInputSchema.parse(req.body).text)
            : await store.toggleTask(situationId, taskId, Boolean(req.body?.completed));
        if (!task) {
          res.status(404).json({ error: "Oppgaven finnes ikke." });
          return;
        }
        res.json(task);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/situations/:id/tasks/:taskId",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        if (!(await store.deleteTask(String(req.params.id), String(req.params.taskId)))) {
          return void res.status(404).json({ error: "Oppgaven finnes ikke." });
        }
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/situations/:id/notes",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        const { text } = noteInputSchema.parse(req.body);
        res.status(201).json(await store.addNote(String(req.params.id), text));
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    "/api/situations/:id/notes/:noteId",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        const { text } = noteInputSchema.parse(req.body);
        const note = await store.updateNote(String(req.params.id), String(req.params.noteId), text);
        if (!note) return void res.status(404).json({ error: "Notatet finnes ikke." });
        res.json(note);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/situations/:id/notes/:noteId",
    requireOwner,
    ensureSituationExists,
    async (req, res, next) => {
      try {
        if (!(await store.deleteNote(String(req.params.id), String(req.params.noteId)))) {
          return void res.status(404).json({ error: "Notatet finnes ikke." });
        }
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  const upload = multer({ dest: config.uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });
  app.post(
    "/api/situations/:id/attachments",
    requireOwner,
    ensureSituationExists,
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "Vedlegg mangler." });
          return;
        }
        const attachmentBytes = await readFile(req.file.path);
        const attachment = await store.addAttachment({
          id: randomUUID(),
          situationId: String(req.params.id),
          filename: req.file.originalname,
          storagePath: req.file.path,
          contentType: req.file.mimetype,
          size: req.file.size,
          sha256: createHash("sha256").update(attachmentBytes).digest("hex"),
          createdAt: new Date().toISOString(),
        });
        res.status(201).json(attachment);
      } catch (error) {
        if (req.file) await unlink(req.file.path).catch(() => undefined);
        next(error);
      }
    },
  );

  app.get("/api/situations/:id/attachments/:attachmentId", requireOwner, async (req, res, next) => {
    try {
      const situationId = String(req.params.id);
      const attachment = await store.getAttachment(String(req.params.attachmentId));
      if (!attachment || attachment.situationId !== situationId) {
        return void res.status(404).json({ error: "Vedlegget finnes ikke." });
      }
      res.download(attachment.storagePath, safeFilename(attachment.filename));
    } catch (error) {
      next(error);
    }
  });

  app.delete(
    "/api/situations/:id/attachments/:attachmentId",
    requireOwner,
    async (req, res, next) => {
      try {
        const attachment = await store.deleteAttachment(
          String(req.params.id),
          String(req.params.attachmentId),
        );
        if (!attachment) return void res.status(404).json({ error: "Vedlegget finnes ikke." });
        await unlink(attachment.storagePath).catch(() => undefined);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/situations/:id/exports", requireOwner, async (req, res, next) => {
    try {
      const situationId = String(req.params.id);
      const workspace = await store.getWorkspace(situationId, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      const attachmentCount = workspace.attachments.length;
      const attachmentSizes = workspace.attachments.map((attachment) =>
        attachmentSizeBytes(attachment.size),
      );
      const attachmentBytes = attachmentSizes.reduce((total, size) => total + size, 0);
      if (
        attachmentCount > EXPORT_ATTACHMENT_COUNT_LIMIT ||
        attachmentBytes > EXPORT_ATTACHMENT_BYTE_LIMIT
      ) {
        res.status(413).json({ error: "Arbeidsmappen er for stor til eksport." });
        return;
      }
      const exportId = randomUUID();
      const manifest = {
        exportId,
        situationId: workspace.situation.id,
        createdAt: new Date().toISOString(),
        attachmentChecksums: workspace.attachments.map((attachment, index) => ({
          filename: safeFilename(attachment.filename),
          sha256: attachment.sha256,
          size: attachmentSizes[index] ?? 0,
        })),
      };
      const storagePath = path.join(config.uploadDir, `export-${exportId}.zip`);
      const contents = await buildWorkspaceExport(store, workspace, manifest);
      try {
        await writeFile(storagePath, contents);
        await store.recordExport({
          id: exportId,
          situationId,
          githubLogin: currentLogin(req),
          storagePath,
          payload: manifest,
          createdAt: manifest.createdAt,
        });
      } catch (error) {
        await unlink(storagePath).catch(() => undefined);
        throw error;
      }
      res.set("Location", `/api/situations/${encodeURIComponent(situationId)}/exports/${exportId}`);
      res.set("X-Export-Id", exportId);
      res.attachment(`${workspace.situation.id}-arbeidsmappe.zip`).send(contents);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/exports/:exportId", requireOwner, async (req, res, next) => {
    try {
      const situationId = String(req.params.id);
      const record = await store.getExport(
        String(req.params.exportId),
        situationId,
        currentLogin(req),
      );
      if (!record) return void res.status(404).json({ error: "Eksporten finnes ikke." });
      res.download(record.storagePath, `${situationId}-arbeidsmappe.zip`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/sources", async (_req, res, next) => {
    try {
      res.json(await store.listSourceHealth());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/source-audit", async (req, res, next) => {
    try {
      const filters = sourceAuditFilterQuerySchema.parse(req.query);
      res.json(await store.getSourceAuditWorkspace(filters, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/coverage-bundles", async (req, res, next) => {
    try {
      const filters = coverageBundleQuerySchema.parse(req.query);
      res.json(await store.listCoverageBundles(filters, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/briefing", async (req, res, next) => {
    try {
      res.json(await store.getCommandCenterBriefing(currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/notification-triggers", async (req, res, next) => {
    try {
      const filters = notificationTriggerQuerySchema.parse(req.query);
      const { deliveryStates, ...candidateFilters } = filters;
      const [page, deliveries, subscriptions, sourceHealth] = await Promise.all([
        store.listNotificationTriggers(candidateFilters, currentLogin(req)),
        store.listPushDeliveries(100, currentLogin(req)),
        store.listPushSubscriptionPreferences(currentLogin(req)),
        store.listSourceHealth(),
      ]);
      const pageWithDeliveryState = applyNotificationDeliveryStates(page, {
        configured: Boolean(config.webPushConfigured),
        deliveries: deliveries.items,
        subscriptions,
        sourceHealth,
      });
      res.json(
        filterNotificationTriggerPageByDeliveryStates(pageWithDeliveryState, deliveryStates),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/notification-deliveries", async (req, res, next) => {
    try {
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
      );
      res.json(await store.listPushDeliveries(limit, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/spatial-analytics", async (req, res, next) => {
    try {
      const query = commandCenterSpatialAnalyticsQuerySchema.parse(req.query);
      const login = currentLogin(req);
      const [
        heatmapCells,
        trafficInfoEvents,
        officialEvents,
        articlesPage,
        trafficPulse,
        trafficCounters,
        telemetryHistory,
        telemetryPatterns,
      ] = await Promise.all([
        store.listSpatialHeatmapCells(query, login),
        store.listTrafficMapEvents(
          {
            sources: ["vegvesen_traffic_info"],
            states: ["active", "planned"],
            from: query.from,
            to: query.to,
            limit: null,
          },
          login,
        ),
        store.listOfficialEvents({ source: "datex" }, login),
        store.listArticles(
          {
            limit: 500,
            ...(query.from ? { from: query.from } : {}),
            ...(query.to ? { to: query.to } : {}),
          },
          login,
        ),
        store.listTrafficPulseCorridors(50),
        store.listTrafficCounterSnapshots(),
        store.getTrafficTelemetryHistorySummary({
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
        }),
        store.listTrafficTelemetryPatterns({
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
          limit: 12,
        }),
      ]);
      const eventsBySourceKey = new Map<string, TrafficMapEvent>();
      const sourceKey = (event: TrafficMapEvent) => `${event.source}:${event.sourceEventId}`;

      for (const event of trafficInfoEvents) {
        eventsBySourceKey.set(sourceKey(event), event);
      }
      for (const event of officialEvents) {
        const trafficEvent = officialEventToTrafficMapEvent(event);
        if (trafficEvent && (trafficEvent.state === "active" || trafficEvent.state === "planned")) {
          eventsBySourceKey.set(sourceKey(trafficEvent), trafficEvent);
        }
      }

      const estimatedEvents = roadClosingArticleTrafficEvents(articlesPage.items, {
        officialEvents: [...eventsBySourceKey.values()],
      });
      for (const event of estimatedEvents) {
        eventsBySourceKey.set(sourceKey(event), event);
      }

      const events = [...eventsBySourceKey.values()].filter((event) =>
        eventIntersectsTimeRange(event, query.from, query.to),
      );
      const corridorImpacts = buildCorridorImpacts(events, trafficPulse);
      const enrichedHeatmapCells = heatmapCells.map((cell) => ({
        ...cell,
        sourceConfidence: cell.sourceConfidence ?? sourceConfidenceForHeatmapCell(cell),
      }));
      const unexplainedDelays = buildUnexplainedDelayCandidates(
        corridorImpacts,
        articlesPage.items,
        {
          minDelaySeconds: query.minDelaySeconds,
        },
      )
        .slice(0, 20)
        .map((candidate) => ({
          ...candidate,
          sourceConfidence:
            candidate.sourceConfidence ?? sourceConfidenceForDelayCandidate(candidate),
        }));
      const investigationQueue = buildSpatialInvestigationQueue(
        unexplainedDelays,
        enrichedHeatmapCells,
        articlesPage.items,
        trafficCounters,
        {
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
        },
      );
      const confidenceItems = [...enrichedHeatmapCells, ...unexplainedDelays];

      res.json({
        generatedAt: new Date().toISOString(),
        window: {
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
        },
        summary: {
          heatmapCells: enrichedHeatmapCells.length,
          observations: enrichedHeatmapCells.reduce((sum, cell) => sum + cell.count, 0),
          unexplainedDelays: unexplainedDelays.length,
          criticalDelays: unexplainedDelays.filter(
            (candidate) => candidate.confidence === "critical",
          ).length,
          bySourceConfidence: sourceConfidenceCounts(confidenceItems),
        },
        telemetryHistory,
        telemetryPatterns,
        investigationQueue,
        heatmapCells: enrichedHeatmapCells,
        unexplainedDelays,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/raw/source-items/:id", async (req, res, next) => {
    try {
      const item = await store.getRawSourceItem(String(req.params.id), currentLogin(req));
      if (!item) return void res.status(404).json({ error: "Kildeelementet finnes ikke." });
      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/raw/telemetry", async (req, res, next) => {
    try {
      const filters = rawInspectorTelemetryQuerySchema.parse(req.query);
      res.json(await store.listRawTelemetry(filters, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/raw/telemetry/:source/:id", async (req, res, next) => {
    try {
      const source = rawInspectorTelemetrySourceSchema.parse(req.params.source);
      const record = await store.getRawTelemetryRecord(
        source,
        String(req.params.id),
        currentLogin(req),
      );
      if (!record)
        return void res.status(404).json({ error: "Telemetriobservasjonen finnes ikke." });
      res.json(record);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/raw/ai-runs", async (req, res, next) => {
    try {
      const filters = rawInspectorAiRunQuerySchema.parse(req.query);
      res.json(await store.listRawAiRuns(filters, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/raw/ai-runs/:id", async (req, res, next) => {
    try {
      const run = await store.getRawAiRun(String(req.params.id), currentLogin(req));
      if (!run) return void res.status(404).json({ error: "AI-kjøringen finnes ikke." });
      res.json(run);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/timeline", async (req, res, next) => {
    try {
      const filters = operationsTimelineQuerySchema.parse(req.query);
      res.json(await store.getOperationsTimeline(filters, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/status", async (_req, res, next) => {
    try {
      const status = await store.getOperationsStatus();
      const runtimeEntry = async (filename: string) => {
        try {
          return JSON.parse(
            await readFile(path.join(config.runtimeStatusDir, filename), "utf8"),
          ) as {
            status: "ok";
            completedAt: string;
            startedAt?: string;
            durationSeconds?: number;
          };
        } catch {
          return undefined;
        }
      };
      const [backup, restoreCheck] = await Promise.all([
        runtimeEntry("backup.json"),
        runtimeEntry("restore-check.json"),
      ]);
      const checkedAt = new Date();
      res.json({
        ...status,
        workerFreshness: runtimeFreshness({
          label: "Worker-syklus",
          completedAt: status.workerCycleMetrics?.cycleCompletedAt,
          staleAfterSeconds: workerStaleAfterSeconds,
          checkedAt,
        }),
        backup: runtimeFreshness({
          label: "Sikkerhetskopi",
          completedAt: backup?.completedAt,
          startedAt: backup?.startedAt,
          durationSeconds: backup?.durationSeconds,
          staleAfterSeconds: backupStaleAfterSeconds,
          checkedAt,
        }),
        restoreCheck: runtimeFreshness({
          label: "Gjenopprettingstest",
          completedAt: restoreCheck?.completedAt,
          startedAt: restoreCheck?.startedAt,
          durationSeconds: restoreCheck?.durationSeconds,
          staleAfterSeconds: restoreCheckStaleAfterSeconds,
          checkedAt,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API-ruten finnes ikke." });
  });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(here, "../../frontend/dist");
  app.use(express.static(frontendDist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));

  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) {
        next(error);
        return;
      }

      if (error instanceof ZodError) {
        res.status(400).json({
          error: "Ugyldig forespørsel.",
          details: validationDetails(error),
        });
        return;
      }

      if (error instanceof multer.MulterError) {
        res
          .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
          .json({ error: "Ugyldig vedlegg." });
        return;
      }

      if (error instanceof Error && error.message === "Ugyldig sidepeker.") {
        res.status(400).json({ error: "Ugyldig sidepeker." });
        return;
      }

      const status = errorStatus(error);
      if (status === 400) {
        res.status(400).json({ error: "Ugyldig forespørsel." });
        return;
      }
      if (status === 502 || status === 503) {
        res.status(status).json({ error: "Karttjenesten svarte ikke. Prøv igjen." });
        return;
      }

      console.error("Unexpected API error", error);
      res.status(500).json({ error: "Intern serverfeil." });
    },
  );

  return { app, store, pool };
}
