import type { TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { buildCorridorImpacts } from "../src/traffic/corridor-impact.js";

function trafficEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "traffic-crossing-line",
    source: "vegvesen_traffic_info",
    sourceEventId: "NPRA_HBT_CROSSING_LINE",
    category: "roadworks",
    severity: "high",
    state: "active",
    title: "Veiarbeid krysser E6 sør",
    updatedAt: "2026-05-29T12:00:00.000Z",
    geometry: { type: "Point", coordinates: [10.39, 63.39] },
    ...overrides,
  };
}

describe("traffic geo corridor impact", () => {
  it("detects a LineString crossing a corridor between event vertices", () => {
    const crossingEvent = trafficEvent({
      geometry: {
        type: "LineString",
        coordinates: [
          [10.36, 63.385],
          [10.41, 63.385],
        ],
      },
    });

    const impacts = buildCorridorImpacts([crossingEvent]);
    const e6SouthImpact = impacts.find((impact) => impact.id === "e6-south");

    expect(e6SouthImpact).toMatchObject({
      eventCount: 1,
      highestSeverity: "high",
      geometry: expect.objectContaining({ type: "LineString" }),
      affectedEventIds: ["traffic-crossing-line"],
    });
  });
});
