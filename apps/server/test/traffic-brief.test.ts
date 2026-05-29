import type { TrafficMapEvent } from "@nytt/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTrafficBrief } from "../src/traffic/traffic-brief.js";

const NOW = "2026-05-29T12:00:00.000Z";
const EMPTY_HEADLINE =
  "Ingen trafikkhendelser i valgt kartutsnitt og filter. Prøv å zoome ut eller slå på planlagte veiarbeid.";

function trafficEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "traffic-event-1",
    source: "vegvesen_traffic_info",
    sourceEventId: "NPRA_HBT_1",
    category: "roadworks",
    severity: "medium",
    state: "active",
    title: "Veiarbeid ved Trondheim sentrum",
    description: "Ett felt er stengt innenfor valgt kartutsnitt.",
    locationName: "Trondheim sentrum",
    roadName: "E6",
    validFrom: "2026-05-29T08:00:00.000Z",
    validTo: "2099-01-01T00:00:00.000Z",
    updatedAt: "2026-05-29T11:45:00.000Z",
    sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/NPRA_HBT_1",
    geometry: { type: "Point", coordinates: [10.39, 63.39] },
    rawType: "roadworks",
    confidence: 0.98,
    ...overrides,
  };
}

describe("buildTrafficBrief", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an actionable empty headline for empty visible events", () => {
    const brief = buildTrafficBrief([]);

    expect(brief).toMatchObject({
      headline: EMPTY_HEADLINE,
      freshness: "unknown",
      generatedAt: NOW,
      counts: { total: 0, byCategory: {}, bySeverity: {} },
    });
    expect(brief.primaryEventIds).toEqual([]);
  });

  it("marks visible traffic events stale when their latest update is over 30 minutes old", () => {
    const brief = buildTrafficBrief([trafficEvent({ updatedAt: "2026-05-29T11:29:00.000Z" })]);

    expect(brief.freshness).toBe("stale");
    expect(brief.counts.total).toBe(1);
  });

  it("marks visible traffic events fresh when their latest update is within 30 minutes", () => {
    const brief = buildTrafficBrief([trafficEvent({ updatedAt: "2026-05-29T11:45:00.000Z" })]);

    expect(brief.freshness).toBe("fresh");
    expect(brief.counts.total).toBe(1);
  });
});
