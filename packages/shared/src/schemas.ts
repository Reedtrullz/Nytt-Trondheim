import { z } from "zod";

export const provenanceSchema = z.enum([
  "official",
  "reporting_estimate",
  "preparedness_context",
  "private_annotation",
]);

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

const privateMapAnalysisTypeSchema = z.enum([
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

const privateMapConfidenceSchema = z.enum([
  "observed_by_owner",
  "reported_unverified",
  "speculative",
]);
const privateMapScenarioSchema = z.enum(["general", "fire", "sar", "traffic", "weather"]);

const privateMapMeasurementSchema = z
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

export const taskInputSchema = z.object({
  text: z.string().trim().min(1).max(300),
});

export const noteInputSchema = z.object({
  text: z.string().trim().min(1).max(5000),
});

export const sourceIdSchema = z.enum([
  "nrk",
  "adressa",
  "vg",
  "dagbladet",
  "trondheim_kommune",
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
  "deepseek",
]);

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

export const articleQuerySchema = z.object({
  scope: z.enum(["trondheim", "trondelag"]).optional(),
  category: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().trim().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

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

export const situationQuerySchema = z.object({
  status: z.enum(["preliminary", "active", "resolved", "dismissed"]).optional(),
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

export const lifecycleInputSchema = z
  .object({
    status: z.enum(["active", "resolved", "dismissed"]),
    dismissalReason: z.enum(["false_positive", "owner_dismissed"]).optional(),
  })
  .refine((value) => value.status !== "dismissed" || value.dismissalReason, {
    message: "Avviste situasjoner krever en begrunnelse.",
    path: ["dismissalReason"],
  });
