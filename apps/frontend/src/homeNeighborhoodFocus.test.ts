import { describe, expect, it } from "vitest";
import {
  homeNeighborhoodFocusOption,
  homeNeighborhoodFocusOptions,
  parseHomeNeighborhoodFocusId,
} from "./homeNeighborhoodFocus.js";

describe("home neighborhood focus", () => {
  it("offers known Trondheim neighborhood focus presets", () => {
    expect(homeNeighborhoodFocusOptions.map((option) => option.label)).toContain("Midtbyen");
    expect(homeNeighborhoodFocusOptions.map((option) => option.label)).toContain("Tiller");
    expect(homeNeighborhoodFocusOption("lade")).toMatchObject({
      label: "Lade",
      point: { lat: 63.445, lng: 10.447 },
    });
  });

  it("ignores unknown persisted local-focus ids", () => {
    expect(parseHomeNeighborhoodFocusId("midtbyen")).toBe("midtbyen");
    expect(parseHomeNeighborhoodFocusId(" ukjent ")).toBeUndefined();
    expect(homeNeighborhoodFocusOption("")).toBeUndefined();
  });
});
