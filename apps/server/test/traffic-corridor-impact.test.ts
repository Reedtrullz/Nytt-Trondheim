import type { TrafficMapEvent, TrafficPulseCorridor } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { buildCorridorImpacts } from "../src/traffic/corridor-impact.js";

function trafficEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "vegvesen-traffic-info:NPRA_HBT_1",
    source: "vegvesen_traffic_info",
    sourceEventId: "NPRA_HBT_1",
    category: "roadworks",
    severity: "medium",
    state: "active",
    title: "Veiarbeid ved E6 sør",
    updatedAt: "2026-05-29T11:40:00.000Z",
    geometry: { type: "Point", coordinates: [10.39, 63.39] },
    ...overrides,
  };
}

function trafficPulseCorridor(overrides: Partial<TrafficPulseCorridor> = {}): TrafficPulseCorridor {
  return {
    id: "100141",
    name: "E6 Okstadbakken - E6 Sluppenrampene",
    state: "slow",
    travelTimeSeconds: 720,
    freeFlowSeconds: 540,
    delaySeconds: 180,
    delayRatio: 1.33,
    measurementFrom: "2026-05-29T11:40:00.000Z",
    measurementTo: "2026-05-29T11:45:00.000Z",
    updatedAt: "2026-05-29T11:45:30.000Z",
    sourceUrl: "https://example.test/datex-travel-time",
    ...overrides,
  };
}

describe("traffic corridor impact travel-time telemetry", () => {
  it("attaches the worst matching DATEX TravelTime row by curated upstream location id", () => {
    const impacts = buildCorridorImpacts(
      [trafficEvent()],
      [
        trafficPulseCorridor({ id: "e6-south", delaySeconds: 999, state: "congested" }),
        trafficPulseCorridor({ id: "100142", delaySeconds: 120, state: "congested" }),
        trafficPulseCorridor(),
      ],
    );

    const impact = impacts.find((item) => item.id === "e6-south");

    expect(impact).toMatchObject({
      id: "e6-south",
      eventCount: 1,
      travelTime: {
        id: "100141",
        state: "slow",
        travelTimeSeconds: 720,
        delaySeconds: 180,
        measurementTo: "2026-05-29T11:45:00.000Z",
      },
    });
    expect(impact?.affectedEventIds).toEqual(["vegvesen-traffic-info:NPRA_HBT_1"]);
  });

  it("does not create traffic events or increase event count from TravelTime telemetry alone", () => {
    const impacts = buildCorridorImpacts([], [trafficPulseCorridor()]);

    const impact = impacts.find((item) => item.id === "e6-south");

    expect(impact).toMatchObject({
      id: "e6-south",
      eventCount: 0,
      affectedEventIds: [],
      travelTime: {
        id: "100141",
        delaySeconds: 180,
      },
    });
  });
});
