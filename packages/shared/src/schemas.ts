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

export const articleQuerySchema = z.object({
  scope: z.enum(["trondheim", "trondelag"]).optional(),
  category: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
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
  cursor: z.string().datetime().optional(),
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
