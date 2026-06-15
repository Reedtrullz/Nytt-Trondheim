import { describe, expect, it } from "vitest";
import {
  buildSituationWorkspaceSearch,
  parseSituationWorkspaceFilters,
  toggleFilterValue,
  workspaceQueryFromFilters,
} from "./situationWorkspaceFilters.js";

describe("situation workspace URL filters", () => {
  it("parses and serializes compact map workspace filters", () => {
    const parsed = parseSituationWorkspaceFilters(
      "?q=Bymarka&status=active,resolved&sources=nrk,adressa&provenance=official,private_annotation&confidence=confirmed,likely&private=false&s=skogbrann-bymarka",
    );

    expect(parsed).toMatchObject({
      q: "Bymarka",
      statuses: ["active", "resolved"],
      sources: ["nrk", "adressa"],
      provenances: ["official", "private_annotation"],
      confidenceLevels: ["confirmed", "likely"],
      includePrivateAnnotations: false,
      selectedSituationId: "skogbrann-bymarka",
    });
    expect(buildSituationWorkspaceSearch(parsed)).toBe(
      "?q=Bymarka&status=active%2Cresolved&sources=nrk%2Cadressa&provenance=official%2Cprivate_annotation&confidence=confirmed%2Clikely&private=false&s=skogbrann-bymarka",
    );
  });

  it("uses operational defaults and builds API query state", () => {
    const parsed = parseSituationWorkspaceFilters("?sources=unknown&private=true");

    expect(parsed.statuses).toEqual(["preliminary", "active"]);
    expect(parsed.sources).toEqual([]);
    expect(buildSituationWorkspaceSearch(parsed)).toBe("");
    expect(workspaceQueryFromFilters(parsed)).toMatchObject({
      statuses: ["preliminary", "active"],
      includePrivateAnnotations: true,
    });
  });

  it("toggles string filter values without duplicates", () => {
    expect(toggleFilterValue(["nrk"], "adressa")).toEqual(["nrk", "adressa"]);
    expect(toggleFilterValue(["nrk", "adressa"], "nrk")).toEqual(["adressa"]);
  });
});
