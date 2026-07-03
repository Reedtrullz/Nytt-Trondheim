import { describe, expect, it } from "vitest";
import {
  buildSituationWorkspaceSearch,
  parseSituationWorkspaceFilters,
  toggleFilterValue,
  workspaceQueryFromFilters,
  workspaceTimeWindowFrom,
} from "./situationWorkspaceFilters.js";

describe("situation workspace URL filters", () => {
  it("parses and serializes compact map workspace filters", () => {
    const parsed = parseSituationWorkspaceFilters(
      "?q=Bymarka&status=active,resolved&publication=public,command_center&sources=nrk,adressa&provenance=official,private_annotation&confidence=confirmed,likely&window=24h&private=false&s=skogbrann-bymarka",
    );

    expect(parsed).toMatchObject({
      q: "Bymarka",
      statuses: ["active", "resolved"],
      publicVisibility: ["public", "command_center"],
      sources: ["nrk", "adressa"],
      provenances: ["official", "private_annotation"],
      confidenceLevels: ["confirmed", "likely"],
      timeWindow: "24h",
      includePrivateAnnotations: false,
      selectedSituationId: "skogbrann-bymarka",
    });
    expect(buildSituationWorkspaceSearch(parsed)).toBe(
      "?q=Bymarka&status=active%2Cresolved&publication=public%2Ccommand_center&sources=nrk%2Cadressa&provenance=official%2Cprivate_annotation&confidence=confirmed%2Clikely&window=24h&private=false&s=skogbrann-bymarka",
    );
  });

  it("uses operational defaults and builds API query state", () => {
    const parsed = parseSituationWorkspaceFilters("?sources=unknown&private=true");

    expect(parsed.statuses).toEqual(["preliminary", "active"]);
    expect(parsed.publicVisibility).toEqual([]);
    expect(parsed.sources).toEqual([]);
    expect(parsed.timeWindow).toBe("all");
    expect(buildSituationWorkspaceSearch(parsed)).toBe("");
    expect(workspaceQueryFromFilters(parsed)).toMatchObject({
      statuses: ["preliminary", "active"],
      includePrivateAnnotations: true,
    });
  });

  it("converts recency presets into workspace map query bounds", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const parsed = parseSituationWorkspaceFilters("?window=2h");

    expect(workspaceTimeWindowFrom("2h", now)).toBe("2026-07-03T10:00:00.000Z");
    expect(workspaceQueryFromFilters(parsed, now)).toMatchObject({
      from: "2026-07-03T10:00:00.000Z",
    });
  });

  it("toggles string filter values without duplicates", () => {
    expect(toggleFilterValue(["nrk"], "adressa")).toEqual(["nrk", "adressa"]);
    expect(toggleFilterValue(["nrk", "adressa"], "nrk")).toEqual(["adressa"]);
  });
});
