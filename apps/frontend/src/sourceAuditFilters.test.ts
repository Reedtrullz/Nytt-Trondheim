import { describe, expect, it } from "vitest";
import {
  buildSourceAuditSearch,
  parseSourceAuditFilters,
  sourceAuditQueryFromFilters,
  toggleAuditFilterValue,
} from "./sourceAuditFilters.js";

describe("source audit filters", () => {
  it("parses compact URL filters", () => {
    expect(
      parseSourceAuditFilters(
        "sources=datex,entur&groups=datex&roles=telemetry_source&health=ok,degraded&fresh=stale&contract=warn&stale=true&q=reise&cursor=datex_travel_time&detail=datex",
      ),
    ).toMatchObject({
      sources: ["datex", "entur"],
      groups: ["datex"],
      roles: ["telemetry_source"],
      healthStates: ["ok", "degraded"],
      freshnessStates: ["stale"],
      contractStatuses: ["warn"],
      staleOnly: true,
      includeDiagnostics: true,
      q: "reise",
      cursor: "datex_travel_time",
      selectedSource: "datex",
    });
  });

  it("serializes filters while omitting defaults", () => {
    const search = buildSourceAuditSearch({
      sources: ["nrk", "adressa"],
      freshnessStates: ["fresh"],
      includeDiagnostics: false,
      cursor: "nrk",
      selectedSource: "nrk",
    });

    expect(search).toBe("sources=nrk%2Cadressa&fresh=fresh&diag=false&cursor=nrk&detail=nrk");
  });

  it("keeps newer source providers selectable from URLs", () => {
    expect(
      parseSourceAuditFilters(
        "sources=vg,dagbladet,trondheim_kommune,bane_nor,met,nve,trafikkdata,vegvesen_traffic_info,dsb,deepseek",
      ).sources,
    ).toEqual([
      "vg",
      "dagbladet",
      "trondheim_kommune",
      "bane_nor",
      "met",
      "nve",
      "trafikkdata",
      "vegvesen_traffic_info",
      "dsb",
      "deepseek",
    ]);
  });

  it("converts UI filters to the API query shape", () => {
    expect(
      sourceAuditQueryFromFilters({
        groups: ["private_annotation"],
        staleOnly: true,
        cursor: "private_annotations",
        selectedSource: "private_annotations",
      }),
    ).toMatchObject({
      groups: ["private_annotation"],
      staleOnly: true,
      includeDiagnostics: true,
      cursor: "private_annotations",
      limit: 80,
    });
  });

  it("toggles array values", () => {
    expect(toggleAuditFilterValue(["datex"], "nrk")).toEqual(["datex", "nrk"]);
    expect(toggleAuditFilterValue(["datex", "nrk"], "datex")).toEqual(["nrk"]);
  });
});
