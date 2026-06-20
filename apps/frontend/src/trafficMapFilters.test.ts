import { describe, expect, it } from "vitest";
import {
  buildTrafficMapSearch,
  defaultTrafficLayers,
  parseTrafficMapFilters,
  trafficFiltersForPreset,
} from "./trafficMapFilters.js";

describe("traffic map URL filters", () => {
  it("uses the current operational map as the default", () => {
    const filters = parseTrafficMapFilters("");

    expect(filters).toEqual(trafficFiltersForPreset("now"));
    expect(buildTrafficMapSearch(filters)).toBe("");
  });

  it("preserves preset-specific category and severity defaults", () => {
    const planned = parseTrafficMapFilters("?preset=planned");
    const severe = parseTrafficMapFilters("?preset=severe");

    expect(planned.categories).toEqual(["roadworks"]);
    expect(planned.severities).toEqual(["low", "medium", "high", "critical"]);
    expect(severe.categories).toContain("accident");
    expect(severe.severities).toEqual(["high", "critical"]);
    expect(buildTrafficMapSearch(planned)).toBe("preset=planned");
  });

  it("marks preset overrides as custom filters", () => {
    const filters = parseTrafficMapFilters("?preset=planned&category=accident&severity=critical");

    expect(filters.preset).toBe("custom");
    expect(filters.categories).toEqual(["accident"]);
    expect(filters.severities).toEqual(["critical"]);
    expect(buildTrafficMapSearch(filters)).toBe(
      "preset=custom&category=accident&severity=critical",
    );
  });

  it("serializes full layer state when it differs from defaults", () => {
    const filters = parseTrafficMapFilters(
      "?layers=incidents,travelTime,publicTransportVehicles,showAll,privateNotes,unknown",
    );

    expect(filters.layers).toEqual({
      ...defaultTrafficLayers,
      roadworks: false,
      publicTransportDisruptions: false,
      publicTransportVehicles: true,
      privateNotes: false,
      estimatedNews: false,
      showAll: true,
    });
    expect(buildTrafficMapSearch(filters)).toBe(
      "layers=incidents%2CtravelTime%2CpublicTransportVehicles%2CshowAll",
    );
  });

  it("round-trips an explicitly empty layer selection", () => {
    const emptyLayers = {
      incidents: false,
      roadworks: false,
      travelTime: false,
      publicTransportDisruptions: false,
      publicTransportVehicles: false,
      weatherRisk: false,
      estimatedNews: false,
      privateNotes: false,
      showAll: false,
    };
    const search = buildTrafficMapSearch({
      preset: "now",
      categories: trafficFiltersForPreset("now").categories,
      severities: trafficFiltersForPreset("now").severities,
      layers: emptyLayers,
    });

    expect(search).toBe("layers=");
    expect(parseTrafficMapFilters(search).layers).toEqual(emptyLayers);
  });

  it("round-trips empty advanced filter selections without restoring defaults", () => {
    const search = buildTrafficMapSearch({
      preset: "custom",
      categories: [],
      severities: [],
      layers: defaultTrafficLayers,
    });

    expect(search).toBe("preset=custom&category=&severity=");
    expect(parseTrafficMapFilters(search)).toMatchObject({
      preset: "custom",
      categories: [],
      severities: [],
    });
  });
});
