import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { compactTrafficEventRow } from "./trafficEventRows.js";

const event: TrafficMapEvent = {
  id: "event-1",
  source: "datex",
  sourceEventId: "event-1",
  category: "closure",
  severity: "critical",
  state: "active",
  title: "E6 Omkjøring ved Sluppen",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
};

const corridor: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 Sluppen → Tiller",
  eventCount: 1,
  affectedEventIds: ["event-1"],
  highestSeverity: "critical",
  travelTime: {
    id: "100141",
    name: "E6 Sluppen → Tiller",
    state: "congested",
    travelTimeSeconds: 1260,
    freeFlowSeconds: 540,
    delaySeconds: 720,
    delayRatio: 2.33,
    updatedAt: "2026-06-01T16:41:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

describe("compact traffic event rows", () => {
  it("formats a useful one-line official event row with delay context", () => {
    expect(compactTrafficEventRow(event, [corridor])).toEqual({
      title: "E6 Omkjøring ved Sluppen",
      meta: "Stengt vei · Statens vegvesen DATEX Situation · Oppdatert 18:42 · påvirker reisetid +12 min",
    });
  });

  it("omits delay context for unmatched or invalid delay corridors", () => {
    const invalidDelay = {
      ...corridor,
      id: "invalid-delay",
      travelTime: { ...corridor.travelTime!, delaySeconds: Number.NaN },
    };

    expect(compactTrafficEventRow(event, []).meta).toBe(
      "Stengt vei · Statens vegvesen DATEX Situation · Oppdatert 18:42",
    );
    expect(compactTrafficEventRow(event, [invalidDelay]).meta).toBe(
      "Stengt vei · Statens vegvesen DATEX Situation · Oppdatert 18:42",
    );
  });

  it("uses ukjent for invalid update timestamps", () => {
    expect(compactTrafficEventRow({ ...event, updatedAt: "not-a-date" }).meta).toContain(
      "Oppdatert ukjent",
    );
  });
});
