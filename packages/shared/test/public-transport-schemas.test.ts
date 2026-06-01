import { describe, expect, it } from "vitest";
import { privateMapFeatureInputSchema, publicTransportMapQuerySchema } from "../src/schemas.js";

describe("public transport and map tool schemas", () => {
  it("requires complete public transport bounds when any bound is provided", () => {
    expect(() => publicTransportMapQuerySchema.parse({ north: "63.5" })).toThrow(
      /north, south, east og west/,
    );
    expect(
      publicTransportMapQuerySchema.parse({
        north: "63.5",
        south: "63.3",
        east: "10.6",
        west: "10.2",
        modes: "bus,tram",
      }),
    ).toMatchObject({ modes: ["bus", "tram"], north: 63.5, south: 63.3 });
  });

  it("rejects malformed public transport query parameters", () => {
    expect(() => publicTransportMapQuerySchema.parse({ modes: { bus: true } })).toThrow();
    expect(() => publicTransportMapQuerySchema.parse({ modes: "hoverboard" })).toThrow();
    expect(() =>
      publicTransportMapQuerySchema.parse({
        north: "63.2",
        south: "63.5",
        east: "10.6",
        west: "10.2",
      }),
    ).toThrow(/north/);
  });

  it("accepts typed private analysis metadata but no client provenance", () => {
    const parsed = privateMapFeatureInputSchema.parse({
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
      properties: {
        label: "Sist sett",
        provenance: "official",
        analysisType: "last_known_position",
        confidence: "reported_unverified",
        scenario: "sar",
        measurement: { radiusMeters: 500 },
      },
    });

    expect(parsed.properties).toMatchObject({
      label: "Sist sett",
      analysisType: "last_known_position",
      confidence: "reported_unverified",
      scenario: "sar",
      measurement: { radiusMeters: 500 },
    });
    expect(parsed.properties).not.toHaveProperty("provenance");
  });
});
