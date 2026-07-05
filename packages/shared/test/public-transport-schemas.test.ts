import { describe, expect, it } from "vitest";
import {
  privateAnnotationUpdateRequestSchema,
  privateMapFeatureInputSchema,
  publicTransportDepartureBoardQuerySchema,
  publicTransportMapQuerySchema,
  travelPlanQuerySchema,
  workspaceMapQuerySchema,
} from "../src/schemas.js";

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

  it("validates departure-board time parameters before querying Entur", () => {
    expect(
      publicTransportDepartureBoardQuerySchema.parse({
        lat: "63.4305",
        lon: "10.3951",
        startTime: "2026-07-05T08:30:00.000Z",
      }),
    ).toMatchObject({
      lat: 63.4305,
      lon: 10.3951,
      startTime: "2026-07-05T08:30:00.000Z",
    });
    expect(() =>
      publicTransportDepartureBoardQuerySchema.parse({
        lat: "63.4305",
        lon: "10.3951",
        startTime: "2026-07-05T08:30:00",
      }),
    ).toThrow();
  });

  it("validates travel-plan queries before server-side routing work starts", () => {
    expect(
      travelPlanQuerySchema.parse({
        from: " Munkegata ",
        to: " Lade ",
        departAt: "2026-07-05T08:30:00+02:00",
      }),
    ).toEqual({
      from: "Munkegata",
      to: "Lade",
      departAt: "2026-07-05T08:30:00+02:00",
    });
    expect(() =>
      travelPlanQuerySchema.parse({
        from: "Munkegata",
        to: "Lade",
        departAt: "2026-07-05T08:30:00",
      }),
    ).toThrow();
    expect(() => travelPlanQuerySchema.parse({ from: "A", to: "Lade" })).toThrow();
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

  it("validates workspace map filters and private annotation updates", () => {
    expect(
      workspaceMapQuerySchema.parse({
        statuses: "active,preliminary",
        sources: "nrk,adressa",
        provenances: "official,reporting_estimate",
        confidenceLevels: "confirmed,likely",
        includePrivateAnnotations: "false",
        north: "63.5",
        south: "63.3",
        east: "10.6",
        west: "10.2",
      }),
    ).toMatchObject({
      statuses: ["active", "preliminary"],
      sources: ["nrk", "adressa"],
      provenances: ["official", "reporting_estimate"],
      confidenceLevels: ["confirmed", "likely"],
      includePrivateAnnotations: false,
      north: 63.5,
    });
    expect(() => workspaceMapQuerySchema.parse({ north: "63.5" })).toThrow(
      /north, south, east og west/,
    );
    expect(() => privateAnnotationUpdateRequestSchema.parse({})).toThrow(/minst ett felt/);
    expect(privateAnnotationUpdateRequestSchema.parse({ label: "Ny etikett" })).toEqual({
      label: "Ny etikett",
    });
  });
});
