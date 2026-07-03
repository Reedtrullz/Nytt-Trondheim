import { z } from "zod";
import type { PrivateAnnotationUpdateRequest } from "./types.js";

export const provenanceSchema = z.enum([
  "official",
  "reporting_estimate",
  "preparedness_context",
  "private_annotation",
]);

export const situationTypeSchema = z.enum([
  "fire",
  "missing_person",
  "traffic",
  "flood",
  "landslide",
  "weather",
  "rescue",
  "service_disruption",
  "other",
]);

export const situationLifecycleSchema = z.enum(["preliminary", "active", "resolved", "dismissed"]);

export const situationPublicVisibilitySchema = z.enum(["public", "command_center"]);

export const sourceConfidenceLevelSchema = z.enum([
  "confirmed",
  "likely",
  "uncertain",
  "speculative",
]);

export const articleCategorySchema = z.enum([
  "Nyheter",
  "Hendelser",
  "Krim",
  "Byutvikling",
  "Kultur",
  "Sport",
  "Transport",
  "Politikk",
  "Vær",
]);

export const articleTopicSchema = z.enum(["rosenborg"]);

export const sourceConfidenceSummarySchema = z
  .object({
    level: sourceConfidenceLevelSchema,
    label: z.enum(["Bekreftet", "Sannsynlig", "Usikker", "Spekulativ"]).optional(),
    score: z.number().min(0).max(1).optional(),
    rationale: z.string().trim().min(1).max(500).optional(),
    sourceCount: z.coerce.number().int().min(0).max(1000).optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();

const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }),
  z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  }),
  z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1),
  }),
]);

export const privateMapAnalysisTypeSchema = z.enum([
  "freehand_note",
  "fire_perimeter",
  "hotspot",
  "smoke_wind_cone",
  "risk_radius",
  "water_access",
  "evacuation_line",
  "last_known_position",
  "witness_observation",
  "probable_route",
  "search_sector",
  "search_grid",
  "command_point",
  "resource_point",
]);

export const privateMapConfidenceSchema = z.enum([
  "observed_by_owner",
  "reported_unverified",
  "speculative",
]);
export const privateMapScenarioSchema = z.enum(["general", "fire", "sar", "traffic", "weather"]);

export const privateMapMeasurementSchema = z
  .object({
    distanceMeters: z.number().nonnegative().optional(),
    areaSquareMeters: z.number().nonnegative().optional(),
    bearingDegrees: z.number().min(0).max(360).optional(),
    radiusMeters: z.number().positive().max(50_000).optional(),
  })
  .strict();

export const privateMapFeatureInputSchema = z.object({
  geometry: geometrySchema,
  properties: z.object({
    label: z.string().trim().min(1).max(160),
    note: z.string().trim().max(2000).optional(),
    analysisType: privateMapAnalysisTypeSchema.default("freehand_note"),
    confidence: privateMapConfidenceSchema.default("speculative"),
    scenario: privateMapScenarioSchema.default("general"),
    measurement: privateMapMeasurementSchema.optional(),
    styleKey: z.string().trim().max(40).optional(),
    sourceItemIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  }),
});

export const privateAnnotationCreateRequestSchema = privateMapFeatureInputSchema;
export type PrivateAnnotationCreateRequestInput = z.infer<
  typeof privateAnnotationCreateRequestSchema
>;

export const taskInputSchema = z.object({
  text: z.string().trim().min(1).max(300),
});

export const noteInputSchema = z.object({
  text: z.string().trim().min(1).max(5000),
});

export const accessRequestInputSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254).toLowerCase(),
    message: z.string().trim().max(1000).optional(),
    website: z.string().trim().max(0).optional(),
  })
  .strict()
  .transform((value) => ({
    displayName: value.displayName,
    email: value.email,
    ...(value.message ? { message: value.message } : {}),
  }));

export type AccessRequestInputPayload = z.infer<typeof accessRequestInputSchema>;

export const accessRequestQuerySchema = z.object({
  status: z.enum(["unverified", "pending", "approved", "rejected"]).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AccessRequestQueryInput = z.infer<typeof accessRequestQuerySchema>;

export const emailLoginRequestSchema = z
  .object({
    email: z.string().trim().email().max(254).toLowerCase(),
    website: z.string().trim().max(0).optional(),
  })
  .strict()
  .transform((value) => ({ email: value.email }));

export type EmailLoginRequestPayload = z.infer<typeof emailLoginRequestSchema>;

export const accessRequestDecisionSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    reviewerNote: z.string().trim().max(1000).optional(),
  })
  .strict()
  .transform((value) => ({
    status: value.status,
    ...(value.reviewerNote ? { reviewerNote: value.reviewerNote } : {}),
  }));

export type AccessRequestDecisionPayload = z.infer<typeof accessRequestDecisionSchema>;

export const userGrantSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254).toLowerCase(),
  })
  .strict();

export type UserGrantPayload = z.infer<typeof userGrantSchema>;

export const userUpdateSchema = z
  .object({
    status: z.enum(["active", "revoked"]).optional(),
    resendInvite: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.resendInvite === true, {
    message: "Status eller resendInvite må oppgis.",
  });

export type UserUpdatePayload = z.infer<typeof userUpdateSchema>;

export const sourceIdSchema = z.enum([
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
  "private_annotations",
  "deepseek",
  "web_push",
]);

export const sourceAuditSourceIdSchema = sourceIdSchema;

export const sourceItemKindSchema = z.enum([
  "article",
  "official_event",
  "warning",
  "reporter_note",
  "reader_tip",
  "media_asset",
]);

export const sourceReliabilityTierSchema = z.enum([
  "official",
  "trusted_media",
  "internal",
  "unverified",
]);

export const sourceItemRelationshipSchema = z.enum([
  "supports",
  "contradicts",
  "context",
  "duplicate",
]);

const booleanQueryParamSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const sourceHealthStateSchema = z.enum(["ok", "degraded", "disabled", "awaiting_access"]);
export const sourceAuditProviderGroupSchema = z.enum([
  "datex",
  "entur",
  "politiloggen",
  "media",
  "internal",
  "private_annotation",
  "other",
]);
export const sourceAuditRoleSchema = z.enum([
  "incident_source",
  "context_source",
  "telemetry_source",
  "internal_analysis",
  "private_annotation",
]);
export const sourceFreshnessStateSchema = z.enum(["fresh", "lagging", "stale", "unknown"]);
export const sourceCollectorRunStatusSchema = z.enum([
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "running",
]);
export const sourceReliabilityLevelSchema = z.enum(["good", "watch", "poor", "unknown"]);
export const sourceStaleDataAlertSeveritySchema = z.enum(["watch", "warning", "critical"]);
export const sourceStaleDataAlertStatusSchema = z.enum(["open", "acknowledged", "resolved"]);
export const sourceContractCheckStatusSchema = z.enum(["pass", "warn", "fail", "not_applicable"]);
export const sourceContractCheckKindSchema = z.enum([
  "source_contract",
  "schema",
  "provenance",
  "telemetry_guardrail",
  "secret_hygiene",
  "activation_policy",
]);
export const sourceDiagnosticSeveritySchema = z.enum(["info", "warning", "error"]);
export const sourceDiagnosticKindSchema = z.enum([
  "auth_state",
  "http_status",
  "latency",
  "rate_limit",
  "schema_mismatch",
  "empty_payload",
  "parse_error",
  "network",
  "scheduler",
  "storage",
  "upstream",
]);
export const incidentTraceabilityStateSchema = z.enum(["complete", "partial", "missing"]);

const diagnosticKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/(secret|token|password|credential|authorization|api[_-]?key)/i.test(value), {
    message: "Diagnostikkfelt kan ikke identifisere hemmeligheter.",
  });
const sourceDiagnosticValueSchema = z.union([
  z.string().trim().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const sourceFreshnessSchema = z
  .object({
    state: sourceFreshnessStateSchema,
    checkedAt: z.string().datetime(),
    lastObservedAt: z.string().datetime().optional(),
    lastFetchedAt: z.string().datetime().optional(),
    lastSuccessfulRunAt: z.string().datetime().optional(),
    nextPollAt: z.string().datetime().optional(),
    expectedIntervalSeconds: z.number().int().positive().max(31_536_000).optional(),
    staleAfterSeconds: z.number().int().positive().max(31_536_000).optional(),
    ageSeconds: z.number().int().nonnegative().max(31_536_000).optional(),
    detail: z.string().trim().max(500).optional(),
  })
  .strict();

export const sourceAuditDiagnosticSchema = z
  .object({
    key: diagnosticKeySchema,
    label: z.string().trim().min(1).max(120),
    kind: sourceDiagnosticKindSchema,
    severity: sourceDiagnosticSeveritySchema,
    safeForDisplay: z.literal(true),
    value: sourceDiagnosticValueSchema.optional(),
    unit: z.enum(["ms", "seconds", "count", "percent", "status", "bytes"]).optional(),
    observedAt: z.string().datetime(),
    detail: z.string().trim().max(500).optional(),
  })
  .strict();

export const sourceNonSecretDiagnosticSchema = sourceAuditDiagnosticSchema;

export const sourceCollectorRunSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    source: sourceIdSchema,
    collector: z.string().trim().min(1).max(160),
    status: sourceCollectorRunStatusSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    recordsSeen: z.number().int().nonnegative().max(1_000_000),
    recordsAccepted: z.number().int().nonnegative().max(1_000_000),
    recordsRejected: z.number().int().nonnegative().max(1_000_000),
    errorCode: z.string().trim().min(1).max(120).optional(),
    errorMessage: z.string().trim().min(1).max(500).optional(),
    diagnostics: z.array(sourceNonSecretDiagnosticSchema).max(50).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.completedAt) return;
    if (Date.parse(value.startedAt) > Date.parse(value.completedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startedAt må være før eller lik completedAt.",
        path: ["startedAt"],
      });
    }
  });

export const sourceCollectorRunHistorySchema = z
  .object({
    source: sourceIdSchema,
    runs: z.array(sourceCollectorRunSchema).max(200),
    nextCursor: z.string().trim().max(250).optional(),
  })
  .strict();

export const sourceReliabilityIndicatorSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    source: sourceIdSchema,
    label: z.string().trim().min(1).max(160),
    level: sourceReliabilityLevelSchema,
    score: z.number().min(0).max(1).optional(),
    sampleSize: z.number().int().nonnegative().max(1_000_000).optional(),
    updatedAt: z.string().datetime(),
    detail: z.string().trim().max(500).optional(),
    diagnostics: z.array(sourceNonSecretDiagnosticSchema).max(50).optional(),
  })
  .strict();

export const sourceStaleDataAlertSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    source: sourceIdSchema,
    severity: sourceStaleDataAlertSeveritySchema,
    status: sourceStaleDataAlertStatusSchema,
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    resolvedAt: z.string().datetime().optional(),
    lastFreshAt: z.string().datetime().optional(),
    expectedFreshnessSeconds: z.number().int().positive().max(31_536_000),
    ageSeconds: z.number().int().nonnegative().max(31_536_000),
    message: z.string().trim().min(1).max(500),
    affectedSituationIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  })
  .strict();

export const sourceContractComplianceCheckSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    source: sourceIdSchema,
    kind: sourceContractCheckKindSchema,
    status: sourceContractCheckStatusSchema,
    label: z.string().trim().min(1).max(160),
    checkedAt: z.string().datetime(),
    detail: z.string().trim().max(800).optional(),
    contractPath: z.string().trim().max(240).optional(),
    failingField: z.string().trim().max(160).optional(),
    sourceItemIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    diagnostics: z.array(sourceNonSecretDiagnosticSchema).max(50).optional(),
  })
  .strict();

export const incidentSourceTraceabilityLinkSchema = z
  .object({
    source: sourceIdSchema,
    provenance: provenanceSchema,
    relationship: z.union([
      sourceItemRelationshipSchema,
      z.enum(["activation", "timeline", "private_annotation"]),
    ]),
    sourceItemId: z.string().trim().min(1).max(200).optional(),
    evidenceId: z.string().trim().min(1).max(200).optional(),
    privateAnnotationId: z.string().trim().min(1).max(200).optional(),
    confidence: sourceConfidenceSummarySchema.optional(),
    publishedAt: z.string().datetime().optional(),
    fetchedAt: z.string().datetime().optional(),
  })
  .strict();

export const incidentSourceTraceabilitySummarySchema = z
  .object({
    situationId: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(220),
    status: situationLifecycleSchema,
    updatedAt: z.string().datetime(),
    traceabilityState: incidentTraceabilityStateSchema,
    sourceCount: z.number().int().nonnegative().max(1000),
    evidenceCount: z.number().int().nonnegative().max(10_000),
    sourceItemCount: z.number().int().nonnegative().max(10_000),
    privateAnnotationCount: z.number().int().nonnegative().max(10_000),
    primarySources: z.array(sourceIdSchema).max(40),
    activationSourceIds: z.array(sourceIdSchema).max(40).optional(),
    officialSource: z.enum(["datex", "politiloggen"]).optional(),
    provenanceCounts: z.record(provenanceSchema, z.number().int().nonnegative()).default({}),
    links: z.array(incidentSourceTraceabilityLinkSchema).max(200),
    missingLinks: z
      .array(
        z
          .object({
            kind: z.enum(["evidence", "source_item", "private_annotation"]),
            reason: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export const sourceHealthSchema = z
  .object({
    source: sourceIdSchema,
    label: z.string().trim().min(1).max(160),
    state: sourceHealthStateSchema,
    lastCheckedAt: z.string().datetime().optional(),
    lastFailureAt: z.string().datetime().optional(),
    nextPollAt: z.string().datetime().optional(),
    detail: z.string().trim().min(1).max(500),
    freshness: sourceFreshnessSchema.optional(),
    reliability: z.array(sourceReliabilityIndicatorSchema).max(20).optional(),
    activeAlerts: z.array(sourceStaleDataAlertSchema).max(50).optional(),
    diagnostics: z.array(sourceNonSecretDiagnosticSchema).max(50).optional(),
  })
  .strict();

export const sourceAuditSourceSummarySchema = z
  .object({
    source: sourceIdSchema,
    label: z.string().trim().min(1).max(160),
    group: sourceAuditProviderGroupSchema,
    role: sourceAuditRoleSchema,
    provenance: provenanceSchema,
    healthState: sourceHealthStateSchema,
    freshness: sourceFreshnessSchema,
    reliability: z.array(sourceReliabilityIndicatorSchema).max(20),
    latestRun: sourceCollectorRunSchema.optional(),
    openAlertCount: z.number().int().nonnegative().max(10_000),
    criticalAlertCount: z.number().int().nonnegative().max(10_000),
    contractStatus: sourceContractCheckStatusSchema,
    lastIncidentTraceAt: z.string().datetime().optional(),
  })
  .strict();

export const sourceAuditFilterQuerySchema = z
  .object({
    sources: csvListSchema(sourceIdSchema),
    groups: csvListSchema(sourceAuditProviderGroupSchema),
    roles: csvListSchema(sourceAuditRoleSchema),
    provenances: csvListSchema(provenanceSchema),
    healthStates: csvListSchema(sourceHealthStateSchema),
    freshnessStates: csvListSchema(sourceFreshnessStateSchema),
    reliabilityLevels: csvListSchema(sourceReliabilityLevelSchema),
    alertSeverities: csvListSchema(sourceStaleDataAlertSeveritySchema),
    contractStatuses: csvListSchema(sourceContractCheckStatusSchema),
    staleOnly: booleanQueryParamSchema,
    includeDiagnostics: booleanQueryParamSchema,
    includeResolvedAlerts: booleanQueryParamSchema,
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    q: z.string().trim().max(160).optional(),
    cursor: z.string().trim().max(250).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  })
  .superRefine(validateDateRange);

export type SourceAuditFilterQueryInput = z.infer<typeof sourceAuditFilterQuerySchema>;

export const sourceAuditDetailQuerySchema = z
  .object({
    includeRuns: booleanQueryParamSchema,
    includeDiagnostics: booleanQueryParamSchema,
    includeTraceability: booleanQueryParamSchema,
    includeResolvedAlerts: booleanQueryParamSchema,
    runLimit: z.coerce.number().int().min(1).max(100).default(20),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .superRefine(validateDateRange);

export type SourceAuditDetailQueryInput = z.infer<typeof sourceAuditDetailQuerySchema>;

export const sourceAuditListResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    filters: sourceAuditFilterQuerySchema,
    sources: z.array(sourceAuditSourceSummarySchema).max(200),
    alerts: z.array(sourceStaleDataAlertSchema).max(500),
    nextCursor: z.string().trim().max(250).optional(),
  })
  .strict();

export const sourceAuditSourceDetailResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    source: sourceAuditSourceSummarySchema,
    runHistory: sourceCollectorRunHistorySchema,
    contractChecks: z.array(sourceContractComplianceCheckSchema).max(100),
    traceability: z.array(incidentSourceTraceabilitySummarySchema).max(200),
    diagnostics: z.array(sourceNonSecretDiagnosticSchema).max(100),
    alerts: z.array(sourceStaleDataAlertSchema).max(200),
  })
  .strict();

export const sourceAuditWorkspaceResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    filters: sourceAuditFilterQuerySchema,
    sources: z.array(sourceAuditSourceSummarySchema).max(200),
    collectorRuns: z.array(sourceCollectorRunSchema).max(500),
    alerts: z.array(sourceStaleDataAlertSchema).max(500),
    contractChecks: z.array(sourceContractComplianceCheckSchema).max(500),
    traceability: z.array(incidentSourceTraceabilitySummarySchema).max(500),
    diagnostics: z.array(sourceNonSecretDiagnosticSchema).max(500).optional(),
    nextCursor: z.string().trim().max(250).optional(),
  })
  .strict();

export const provenanceConfidenceSchema = z
  .object({
    provenance: provenanceSchema,
    label: z
      .enum(["Offisiell", "Anslag fra rapportering", "Beredskapskontekst", "Privat markering"])
      .optional(),
    sourceIds: z.array(sourceIdSchema).max(40),
    confidence: sourceConfidenceSummarySchema,
    evidenceIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    sourceItemIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  })
  .strict();

export const articleQuerySchema = z
  .object({
    scope: z.enum(["trondheim", "trondelag"]).optional(),
    category: articleCategorySchema.optional(),
    topic: articleTopicSchema.optional(),
    q: z.string().trim().max(120).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursor: z.string().trim().max(250).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  })
  .superRefine((query, context) => {
    if (!query.from || !query.to) return;
    if (new Date(query.from).getTime() <= new Date(query.to).getTime()) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from"],
      message: "from must be before to",
    });
  });

export const coverageBundleQuerySchema = z.object({
  kind: z.enum(["incident", "topic", "update"]).optional(),
  confidence: z.enum(["high", "medium"]).optional(),
  q: z.string().trim().max(160).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type CoverageBundleQueryInput = z.infer<typeof coverageBundleQuerySchema>;

export const sourceItemQuerySchema = z.object({
  provider: sourceIdSchema.optional(),
  kind: sourceItemKindSchema.optional(),
  unlinked: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().max(160).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const sourceItemLinkInputSchema = z.object({
  relationship: sourceItemRelationshipSchema.default("supports"),
});

export const rawInspectorAiRunQuerySchema = z.object({
  provider: z.enum(["deepseek", "deterministic"]).optional(),
  status: z.enum(["ok", "degraded", "disabled"]).optional(),
  q: z.string().trim().max(160).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type RawInspectorAiRunQueryInput = z.infer<typeof rawInspectorAiRunQuerySchema>;

export const rawInspectorTelemetrySourceSchema = z.enum(["datex_travel_time", "trafikkdata"]);

export const rawInspectorTelemetryQuerySchema = z.object({
  source: rawInspectorTelemetrySourceSchema.optional(),
  q: z.string().trim().max(160).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const trafficEventCategorySchema = z.enum([
  "roadworks",
  "accident",
  "closure",
  "congestion",
  "weather",
  "restriction",
  "obstruction",
  "other",
]);

export const trafficEventSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export const trafficEventStateSchema = z.enum(["planned", "active", "expired", "cancelled"]);

function csvListSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.preprocess((value) => {
    if (value === undefined) return undefined;
    const values = Array.isArray(value) ? value : [value];
    if (values.some((entry) => typeof entry !== "string")) return value;
    return values
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }, z.array(itemSchema).optional());
}

const coordinateParamSchema = z.preprocess(
  (value) => (value === "" ? Number.NaN : value),
  z.coerce.number().finite().optional(),
);

const publicTransportModeSchema = z.enum(["bus", "tram", "rail", "water", "metro", "unknown"]);
const publicTransportLatitudeParamSchema = z.preprocess(
  (value) => (value === "" ? Number.NaN : value),
  z.coerce.number().min(-90).max(90).finite().optional(),
);
const publicTransportLongitudeParamSchema = z.preprocess(
  (value) => (value === "" ? Number.NaN : value),
  z.coerce.number().min(-180).max(180).finite().optional(),
);

function validateOptionalBounds(
  value: { north?: number; south?: number; east?: number; west?: number },
  context: z.RefinementCtx,
) {
  const bounds = [value.north, value.south, value.east, value.west];
  const providedBounds = bounds.filter((entry) => entry !== undefined).length;
  if (providedBounds > 0 && providedBounds < bounds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Kartutsnitt krever north, south, east og west.",
      path: ["bounds"],
    });
    return;
  }
  if (providedBounds === 0) return;
  if (
    value.north! < -90 ||
    value.north! > 90 ||
    value.south! < -90 ||
    value.south! > 90 ||
    value.east! < -180 ||
    value.east! > 180 ||
    value.west! < -180 ||
    value.west! > 180
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Kartutsnitt er utenfor gyldige koordinater.",
      path: ["bounds"],
    });
  }
  if (value.north! < value.south!) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "north må være større enn eller lik south.",
      path: ["north"],
    });
  }
  if (value.east! < value.west!) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "east må være større enn eller lik west.",
      path: ["east"],
    });
  }
}

function validateDateRange(value: { from?: string; to?: string }, context: z.RefinementCtx) {
  if (!value.from || !value.to) return;
  if (Date.parse(value.from) > Date.parse(value.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "from må være før eller lik to.",
      path: ["from"],
    });
  }
}

export const situationMapLayerSchema = z.enum([
  "situations",
  "evidence",
  "preparedness_context",
  "private_annotations",
  "traffic",
  "public_transport",
]);

export const timelineEntryKindSchema = z.enum([
  "source_update",
  "official_update",
  "status_change",
  "review_action",
  "severity_change",
  "merge_decision",
  "split_decision",
  "context_update",
  "private_annotation",
  "system",
]);

export const sourceFilterQuerySchema = z.object({
  providers: csvListSchema(sourceIdSchema),
  kinds: csvListSchema(sourceItemKindSchema),
  provenances: csvListSchema(provenanceSchema),
  reliabilityTiers: csvListSchema(sourceReliabilityTierSchema),
  relationships: csvListSchema(sourceItemRelationshipSchema),
  confidenceLevels: csvListSchema(sourceConfidenceLevelSchema),
  includeTelemetry: booleanQueryParamSchema,
  includePrivateAnnotations: booleanQueryParamSchema,
  q: z.string().trim().max(160).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export type SourceFilterQueryInput = z.infer<typeof sourceFilterQuerySchema>;

export const workspaceMapQuerySchema = z
  .object({
    situationIds: csvListSchema(z.string().trim().min(1).max(200)),
    statuses: csvListSchema(situationLifecycleSchema),
    publicVisibility: csvListSchema(situationPublicVisibilitySchema),
    types: csvListSchema(situationTypeSchema),
    layers: csvListSchema(situationMapLayerSchema),
    sources: csvListSchema(sourceIdSchema),
    provenances: csvListSchema(provenanceSchema),
    confidenceLevels: csvListSchema(sourceConfidenceLevelSchema),
    includeTelemetry: booleanQueryParamSchema,
    includePrivateAnnotations: booleanQueryParamSchema,
    q: z.string().trim().max(160).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    north: coordinateParamSchema,
    south: coordinateParamSchema,
    east: coordinateParamSchema,
    west: coordinateParamSchema,
  })
  .superRefine(validateOptionalBounds)
  .superRefine(validateDateRange);

export type WorkspaceMapQueryInput = z.infer<typeof workspaceMapQuerySchema>;

export const timelineQuerySchema = z
  .object({
    sources: csvListSchema(sourceIdSchema),
    provenances: csvListSchema(provenanceSchema),
    kinds: csvListSchema(timelineEntryKindSchema),
    includePrivateAnnotations: booleanQueryParamSchema,
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().trim().max(250).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine(validateDateRange);

export type TimelineQueryInput = z.infer<typeof timelineQuerySchema>;

export const operationsTimelineEventKindSchema = z.enum([
  "situation_update",
  "source_update",
  "collector_run",
  "review_action",
  "status_change",
  "severity_change",
  "merge_decision",
  "split_decision",
  "stale_warning",
  "private_annotation",
]);
export const operationsTimelineEventSeveritySchema = z.enum([
  "critical",
  "warning",
  "info",
  "muted",
]);
export const operationsTimelineEventRoleSchema = z.enum([
  "incident",
  "context",
  "telemetry",
  "private",
  "system",
]);

export const operationsTimelineEventLinkSchema = z
  .object({
    kind: z.enum(["situation", "source_audit", "source_item", "external", "private_workspace"]),
    label: z.string().trim().min(1).max(160),
    href: z.string().trim().max(500).optional(),
    situationId: z.string().trim().min(1).max(200).optional(),
    sourceId: sourceIdSchema.optional(),
    sourceItemId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const operationsTimelineEventSchema = z
  .object({
    id: z.string().trim().min(1).max(260),
    timestamp: z.string().datetime(),
    kind: operationsTimelineEventKindSchema,
    severity: operationsTimelineEventSeveritySchema,
    title: z.string().trim().min(1).max(220),
    detail: z.string().trim().min(1).max(1000),
    source: sourceIdSchema.optional(),
    sourceLabel: z.string().trim().min(1).max(160).optional(),
    collector: z.string().trim().min(1).max(160).optional(),
    situationId: z.string().trim().min(1).max(200).optional(),
    situationTitle: z.string().trim().min(1).max(220).optional(),
    situationStatus: situationLifecycleSchema.optional(),
    role: operationsTimelineEventRoleSchema,
    provenance: provenanceSchema.optional(),
    confidence: sourceConfidenceSummarySchema.optional(),
    private: z.boolean(),
    links: z.array(operationsTimelineEventLinkSchema).max(20),
    metadata: z
      .object({
        recordsSeen: z.number().int().nonnegative().max(1_000_000).optional(),
        recordsAccepted: z.number().int().nonnegative().max(1_000_000).optional(),
        recordsRejected: z.number().int().nonnegative().max(1_000_000).optional(),
        durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
        sourceItemId: z.string().trim().min(1).max(200).optional(),
        relationship: z
          .union([
            sourceItemRelationshipSchema,
            z.enum(["activation", "timeline", "private_annotation"]),
          ])
          .optional(),
        previousValue: z.string().trim().max(160).optional(),
        nextValue: z.string().trim().max(160).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const operationsTimelineQuerySchema = z
  .object({
    sources: csvListSchema(sourceIdSchema),
    provenances: csvListSchema(provenanceSchema),
    kinds: csvListSchema(operationsTimelineEventKindSchema),
    situationIds: csvListSchema(z.string().trim().min(1).max(200)),
    statuses: csvListSchema(situationLifecycleSchema),
    severities: csvListSchema(operationsTimelineEventSeveritySchema),
    roles: csvListSchema(operationsTimelineEventRoleSchema),
    includePrivateAnnotations: booleanQueryParamSchema,
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    q: z.string().trim().max(160).optional(),
    cursor: z.string().trim().max(250).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(80),
    sort: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine(validateDateRange);

export type OperationsTimelineQueryInput = z.infer<typeof operationsTimelineQuerySchema>;

export const operationsTimelineSummarySchema = z
  .object({
    total: z.number().int().nonnegative().max(100_000),
    activeSituations: z.number().int().nonnegative().max(100_000),
    staleWarnings: z.number().int().nonnegative().max(100_000),
    collectorRuns: z.number().int().nonnegative().max(100_000),
    reviewerActions: z.number().int().nonnegative().max(100_000),
    privateEvents: z.number().int().nonnegative().max(100_000),
  })
  .strict();

export const operationsTimelineResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    filters: operationsTimelineQuerySchema,
    events: z.array(operationsTimelineEventSchema).max(100),
    summary: operationsTimelineSummarySchema,
    nextCursor: z.string().trim().max(250).optional(),
  })
  .strict();

export const notificationTriggerKindSchema = z.enum([
  "public_safety",
  "traffic_disruption",
  "weather_hazard",
  "service_disruption",
]);

export const notificationTriggerSeveritySchema = z.enum(["critical", "warning", "watch"]);
export const notificationTriggerDeliveryStateSchema = z.enum([
  "candidate_only",
  "not_configured",
  "no_subscribers",
  "ready",
  "sent",
  "failed",
  "suppressed",
]);

export const notificationTriggerQuerySchema = z.object({
  kinds: csvListSchema(notificationTriggerKindSchema),
  severities: csvListSchema(notificationTriggerSeveritySchema),
  deliveryStates: csvListSchema(notificationTriggerDeliveryStateSchema),
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type NotificationTriggerQueryInput = z.infer<typeof notificationTriggerQuerySchema>;

export const notificationTriggerCandidateSchema = z
  .object({
    id: z.string().trim().min(1).max(260),
    kind: notificationTriggerKindSchema,
    severity: notificationTriggerSeveritySchema,
    deliveryState: notificationTriggerDeliveryStateSchema,
    title: z.string().trim().min(1).max(220),
    body: z.string().trim().min(1).max(1000),
    detail: z.string().trim().min(1).max(1000),
    score: z.number().min(0).max(1),
    confidence: sourceConfidenceSummarySchema,
    generatedAt: z.string().datetime(),
    eventUpdatedAt: z.string().datetime(),
    situationId: z.string().trim().min(1).max(200).optional(),
    articleIds: z.array(z.string().trim().min(1).max(200)).max(100),
    sourceIds: z.array(sourceIdSchema).max(40),
    sourceLabels: z.array(z.string().trim().min(1).max(160)).max(40),
    matchedKeywords: z.array(z.string().trim().min(1).max(80)).max(40),
    reasons: z.array(z.string().trim().min(1).max(300)).max(20),
    links: z.array(operationsTimelineEventLinkSchema).max(20),
  })
  .strict();

export const notificationTriggerSummarySchema = z
  .object({
    total: z.number().int().nonnegative().max(100_000),
    critical: z.number().int().nonnegative().max(100_000),
    warning: z.number().int().nonnegative().max(100_000),
    watch: z.number().int().nonnegative().max(100_000),
    officialBacked: z.number().int().nonnegative().max(100_000),
    highConfidence: z.number().int().nonnegative().max(100_000),
  })
  .strict();

export const notificationPushStatusSchema = z
  .object({
    configured: z.boolean(),
    label: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(1000),
    health: sourceHealthSchema.optional(),
    activeSubscriptions: z.number().int().nonnegative().max(100_000),
    matchingCandidates: z.number().int().nonnegative().max(100_000),
    readyCandidates: z.number().int().nonnegative().max(100_000),
    blockedCandidates: z.number().int().nonnegative().max(100_000),
    deliveryCounts: z
      .object({
        total: z.number().int().nonnegative().max(100_000),
        sent: z.number().int().nonnegative().max(100_000),
        failed: z.number().int().nonnegative().max(100_000),
        claimed: z.number().int().nonnegative().max(100_000),
        skipped: z.number().int().nonnegative().max(100_000),
      })
      .strict(),
  })
  .strict();

export const notificationTriggerPageSchema = z
  .object({
    generatedAt: z.string().datetime(),
    filters: notificationTriggerQuerySchema,
    items: z.array(notificationTriggerCandidateSchema).max(100),
    summary: notificationTriggerSummarySchema,
    pushStatus: notificationPushStatusSchema.optional(),
  })
  .strict();

export const pushSubscriptionInputSchema = z
  .object({
    endpoint: z.string().trim().url().max(2048),
    expirationTime: z.number().int().nonnegative().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().trim().min(20).max(512),
        auth: z.string().trim().min(8).max(256),
      })
      .strict(),
    userAgent: z.string().trim().max(500).optional(),
    minSeverity: notificationTriggerSeveritySchema.default("warning"),
    kinds: z.array(notificationTriggerKindSchema).max(8).default([]),
  })
  .strict();

export type PushSubscriptionInputSchema = z.infer<typeof pushSubscriptionInputSchema>;

export const pushSubscriptionSummarySchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    endpointHash: z.string().trim().min(16).max(128),
    enabled: z.boolean(),
    minSeverity: notificationTriggerSeveritySchema,
    kinds: z.array(notificationTriggerKindSchema).max(8),
    userAgent: z.string().trim().max(500).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    lastSuccessAt: z.string().datetime().optional(),
    lastFailureAt: z.string().datetime().optional(),
    failureCount: z.number().int().nonnegative().max(100_000),
  })
  .strict();

export const pushNotificationSettingsSchema = z
  .object({
    configured: z.boolean(),
    publicKey: z.string().trim().min(20).max(512).optional(),
    subscriptions: z.array(pushSubscriptionSummarySchema).max(50),
  })
  .strict();

export const pushDeliveryStatusSchema = z.enum(["claimed", "sent", "failed", "skipped"]);

export const pushDeliveryListItemSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    triggerId: z.string().trim().min(1).max(260),
    subscriptionId: z.string().trim().min(1).max(200),
    userId: z.string().trim().min(1).max(200),
    status: pushDeliveryStatusSchema,
    kind: notificationTriggerKindSchema,
    severity: notificationTriggerSeveritySchema,
    title: z.string().trim().min(1).max(220),
    body: z.string().trim().min(1).max(1000),
    targetUrl: z.string().trim().max(2048).optional(),
    errorMessage: z.string().trim().max(1000).optional(),
    score: z.number().min(0).max(1).optional(),
    confidence: sourceConfidenceSummarySchema.optional(),
    sourceLabels: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    matchedKeywords: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    reasons: z.array(z.string().trim().min(1).max(260)).max(20).optional(),
    createdAt: z.string().datetime(),
    sentAt: z.string().datetime().optional(),
  })
  .strict();

export const pushDeliveryPageSchema = z
  .object({
    generatedAt: z.string().datetime(),
    items: z.array(pushDeliveryListItemSchema).max(100),
    summary: z
      .object({
        total: z.number().int().nonnegative().max(100_000),
        sent: z.number().int().nonnegative().max(100_000),
        failed: z.number().int().nonnegative().max(100_000),
        claimed: z.number().int().nonnegative().max(100_000),
        skipped: z.number().int().nonnegative().max(100_000),
      })
      .strict(),
  })
  .strict();

export const privateAnnotationQuerySchema = z.object({
  scenario: privateMapScenarioSchema.optional(),
  confidence: privateMapConfidenceSchema.optional(),
  sourceItemIds: csvListSchema(z.string().trim().min(1).max(200)),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type PrivateAnnotationQueryInput = z.infer<typeof privateAnnotationQuerySchema>;

export const publicTransportMapQuerySchema = z
  .object({
    modes: csvListSchema(publicTransportModeSchema),
    includeAlerts: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    north: publicTransportLatitudeParamSchema,
    south: publicTransportLatitudeParamSchema,
    east: publicTransportLongitudeParamSchema,
    west: publicTransportLongitudeParamSchema,
  })
  .superRefine((value, context) => {
    const bounds = [value.north, value.south, value.east, value.west];
    const providedBounds = bounds.filter((entry) => entry !== undefined).length;
    if (providedBounds > 0 && providedBounds < bounds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Kartutsnitt krever north, south, east og west.",
        path: ["bounds"],
      });
      return;
    }
    if (providedBounds === 0) return;
    if (value.north! < value.south!) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "north må være større enn eller lik south.",
        path: ["north"],
      });
    }
    if (value.east! < value.west!) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "east må være større enn eller lik west.",
        path: ["east"],
      });
    }
  });

export type PublicTransportMapQueryInput = z.infer<typeof publicTransportMapQuerySchema>;

export const travelPlanQuerySchema = z.object({
  from: z.string().trim().min(2).max(160),
  to: z.string().trim().min(2).max(160),
});

export type TravelPlanQueryInput = z.infer<typeof travelPlanQuerySchema>;

export const trafficMapQuerySchema = z
  .object({
    categories: csvListSchema(trafficEventCategorySchema),
    severities: csvListSchema(trafficEventSeveritySchema),
    states: csvListSchema(trafficEventStateSchema),
    estimatedNews: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    north: coordinateParamSchema,
    south: coordinateParamSchema,
    east: coordinateParamSchema,
    west: coordinateParamSchema,
  })
  .superRefine((value, context) => {
    const bounds = [value.north, value.south, value.east, value.west];
    const providedBounds = bounds.filter((entry) => entry !== undefined).length;
    if (providedBounds > 0 && providedBounds < bounds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Kartutsnitt krever north, south, east og west.",
        path: ["bounds"],
      });
      return;
    }
    if (providedBounds === 0) return;
    if (
      value.north! < -90 ||
      value.north! > 90 ||
      value.south! < -90 ||
      value.south! > 90 ||
      value.east! < -180 ||
      value.east! > 180 ||
      value.west! < -180 ||
      value.west! > 180
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Kartutsnitt er utenfor gyldige koordinater.",
        path: ["bounds"],
      });
    }
    if (value.north! < value.south!) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "north må være større enn eller lik south.",
        path: ["north"],
      });
    }
    if (value.east! < value.west!) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "east må være større enn eller lik west.",
        path: ["east"],
      });
    }
  });

export type TrafficMapQueryInput = z.infer<typeof trafficMapQuerySchema>;

export const commandCenterSpatialAnalyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  minDelaySeconds: z.coerce.number().int().min(0).max(7200).default(180),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});

export type CommandCenterSpatialAnalyticsQueryInput = z.infer<
  typeof commandCenterSpatialAnalyticsQuerySchema
>;

export const situationQuerySchema = z.object({
  status: situationLifecycleSchema.optional(),
  saved: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  includeDismissed: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const labelInputSchema = z.object({
  label: z.string().trim().min(1).max(160),
  note: z.string().trim().max(2000).optional(),
});

export const privateAnnotationUpdateRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(160).optional(),
    note: z.string().trim().max(2000).optional(),
    analysisType: privateMapAnalysisTypeSchema.optional(),
    confidence: privateMapConfidenceSchema.optional(),
    scenario: privateMapScenarioSchema.optional(),
    measurement: privateMapMeasurementSchema.optional(),
    styleKey: z.string().trim().max(40).optional(),
    sourceItemIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Oppdateringen må inneholde minst ett felt.",
  })
  .transform((value) => value as PrivateAnnotationUpdateRequest);

export type PrivateAnnotationUpdateRequestInput = z.input<
  typeof privateAnnotationUpdateRequestSchema
>;

export const lifecycleInputSchema = z
  .object({
    status: z.enum(["active", "resolved", "dismissed"]),
    dismissalReason: z.enum(["false_positive", "owner_dismissed"]).optional(),
  })
  .refine((value) => value.status !== "dismissed" || value.dismissalReason, {
    message: "Avviste situasjoner krever en begrunnelse.",
    path: ["dismissalReason"],
  });

export const situationPublicationInputSchema = z
  .object({
    publicVisibility: situationPublicVisibilitySchema,
  })
  .strict();
