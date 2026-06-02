import { describe, expect, it } from "vitest";
import {
  sourceIdSchema,
  sourceItemKindSchema,
  sourceItemLinkInputSchema,
  sourceItemQuerySchema,
  sourceItemRelationshipSchema,
  sourceReliabilityTierSchema,
} from "../src/schemas.js";

describe("source item validation schemas", () => {
  it("validates source item filters and link input", () => {
    expect(sourceItemKindSchema.parse("official_event")).toBe("official_event");
    expect(sourceIdSchema.parse("bane_nor")).toBe("bane_nor");
    expect(sourceReliabilityTierSchema.parse("official")).toBe("official");
    expect(sourceItemRelationshipSchema.parse("context")).toBe("context");
    expect(
      sourceItemQuerySchema.parse({
        provider: "nrk",
        kind: "article",
        unlinked: "true",
        limit: "5",
      }),
    ).toMatchObject({ provider: "nrk", kind: "article", unlinked: true, limit: 5 });
    expect(
      sourceItemQuerySchema.parse({
        provider: "bane_nor",
        kind: "official_event",
        limit: "5",
      }),
    ).toMatchObject({ provider: "bane_nor", kind: "official_event", limit: 5 });
    expect(sourceItemLinkInputSchema.parse({})).toEqual({ relationship: "supports" });
    expect(() => sourceItemLinkInputSchema.parse({ relationship: "travel_time" })).toThrow();
  });
});
