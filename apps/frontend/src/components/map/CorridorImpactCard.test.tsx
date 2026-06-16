import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CorridorImpactCard } from "./CorridorImpactCard.js";

const impact: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 Sluppen → Tiller",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.379, 63.341],
      [10.403, 63.43],
    ],
  },
  bufferMeters: 800,
  eventCount: 1,
  affectedEventIds: ["event-1"],
  highestSeverity: "high",
  travelTime: {
    id: "100141",
    name: "E6 Sluppen → Tiller",
    state: "congested",
    travelTimeSeconds: 1020,
    freeFlowSeconds: 540,
    delaySeconds: 480,
    delayRatio: 1.88,
    updatedAt: "2026-06-01T16:40:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

const event: TrafficMapEvent = {
  id: "event-1",
  source: "vegvesen_traffic_info",
  sourceEventId: "1",
  category: "roadworks",
  severity: "high",
  state: "active",
  title: "Veiarbeid ved Sluppen",
  updatedAt: "2026-06-01T16:39:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
};

describe("CorridorImpactCard", () => {
  it("renders traffic-pulse language, not raw telemetry", () => {
    const html = renderToStaticMarkup(
      <CorridorImpactCard
        impacts={[impact]}
        events={[event]}
        selectedImpactId="e6-south"
        onSelectImpact={vi.fn()}
      />,
    );

    expect(html).toContain("Reisetidskorridorer");
    expect(html).toContain("Normal: 9 min");
    expect(html).toContain("Nå: 17 min");
    expect(html).toContain("+8 min");
    expect(html).toContain("REISETID");
  });
});
