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
});

export const labelInputSchema = z.object({
  label: z.string().trim().min(1).max(160),
  note: z.string().trim().max(2000).optional(),
});

export const lifecycleInputSchema = z.object({
  status: z.enum(["active", "resolved"]),
});
