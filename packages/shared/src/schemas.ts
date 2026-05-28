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

export const privateMapFeatureInputSchema = z.object({
  geometry: geometrySchema,
  properties: z.object({
    label: z.string().trim().min(1).max(160),
    note: z.string().trim().max(2000).optional(),
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
