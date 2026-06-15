import { describe, expect, it } from "vitest";
import {
  buildOperationsTimelineSearch,
  operationsTimelineQueryFromFilters,
  parseOperationsTimelineFilters,
  toggleTimelineFilterValue,
} from "./operationsTimelineFilters.js";

describe("operations timeline filters", () => {
  it("parses compact URL filters", () => {
    expect(
      parseOperationsTimelineFilters(
        "q=Bymarka&sources=nrk,datex_travel_time&provenance=reporting_estimate&kind=source_update,stale_warning&status=active&severity=warning&role=incident,telemetry&private=false&s=skogbrann-bymarka&e=timeline%3At1&sort=asc",
      ),
    ).toMatchObject({
      q: "Bymarka",
      sources: ["nrk", "datex_travel_time"],
      provenances: ["reporting_estimate"],
      kinds: ["source_update", "stale_warning"],
      statuses: ["active"],
      severities: ["warning"],
      roles: ["incident", "telemetry"],
      includePrivateAnnotations: false,
      selectedSituation: "skogbrann-bymarka",
      selectedEvent: "timeline:t1",
      sort: "asc",
    });
  });

  it("serializes filters while omitting defaults", () => {
    const search = buildOperationsTimelineSearch({
      sources: ["nrk"],
      kinds: ["collector_run"],
      includePrivateAnnotations: true,
      selectedSituation: "skogbrann-bymarka",
      selectedEvent: "collector:datex",
      sort: "desc",
    });

    expect(search).toBe("sources=nrk&kind=collector_run&s=skogbrann-bymarka&e=collector%3Adatex");
  });

  it("converts UI filters to the API query shape", () => {
    expect(
      operationsTimelineQueryFromFilters({
        selectedSituation: "skogbrann-bymarka",
        includePrivateAnnotations: false,
        roles: ["private"],
      }),
    ).toMatchObject({
      situationIds: ["skogbrann-bymarka"],
      includePrivateAnnotations: false,
      roles: ["private"],
      sort: "desc",
      limit: 100,
    });
  });

  it("toggles array values", () => {
    expect(toggleTimelineFilterValue(["collector_run"], "source_update")).toEqual([
      "collector_run",
      "source_update",
    ]);
    expect(toggleTimelineFilterValue(["collector_run", "source_update"], "collector_run")).toEqual([
      "source_update",
    ]);
  });
});
