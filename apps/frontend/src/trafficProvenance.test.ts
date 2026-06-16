import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  TrafficCorridorImpact,
  TrafficMapEvent,
} from "@nytt/shared";
import { describe, expect, it } from "vitest";
import {
  badgeForPublicTransportAlert,
  badgeForPublicTransportVehicle,
  badgeForTrafficPulse,
  badgesForTrafficEvent,
  sourceDisplayLabel,
} from "./trafficProvenance.js";

const event: TrafficMapEvent = {
  id: "event-1",
  source: "vegvesen_traffic_info",
  sourceEventId: "1",
  category: "closure",
  severity: "critical",
  state: "active",
  title: "E6 stengt ved Sluppen",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
  confidence: 0.98,
};

const pulse: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 sør inn mot Trondheim",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.379, 63.341],
      [10.403, 63.43],
    ],
  },
  bufferMeters: 800,
  eventCount: 0,
  affectedEventIds: [],
  highestSeverity: "low",
  travelTime: {
    id: "100141",
    name: "E6 Okstadbakken - E6 Sluppenrampene",
    state: "slow",
    travelTimeSeconds: 1020,
    freeFlowSeconds: 540,
    delaySeconds: 480,
    delayRatio: 1.88,
    updatedAt: "2026-06-01T16:40:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

const alert: PublicTransportServiceAlert = {
  id: "entur-service-alert:ATB:line3",
  source: "entur_service_alerts",
  codespaceId: "ATB",
  situationNumber: "line3",
  summary: "Forsinkelse på linje 3",
  updatedAt: "2026-06-01T16:40:00.000Z",
  state: "active",
};

const vehicle: PublicTransportVehicle = {
  id: "entur-vehicle:ATB:bus1",
  source: "entur_vehicle_positions",
  codespaceId: "ATB",
  vehicleId: "bus1",
  mode: "bus",
  lastUpdated: "2026-06-01T16:40:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
  stale: false,
};

describe("traffic provenance labels", () => {
  it("labels official road events as official, not estimated", () => {
    expect(badgesForTrafficEvent(event)).toEqual(["OFFISIELL"]);
    expect(sourceDisplayLabel(event.source)).toBe("Statens vegvesen TrafficInfo");
  });

  it("adds ESTIMERT and NYHETSKILDE when related estimated article locations exist", () => {
    expect(
      badgesForTrafficEvent({
        ...event,
        relatedArticles: [
          {
            id: "article-1",
            title: "Kø ved Sluppen",
            url: "https://example.test/article",
            distanceMeters: 80,
            location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
          },
        ],
      }),
    ).toEqual(["OFFISIELL", "ESTIMERT", "NYHETSKILDE"]);
  });

  it("labels traffic pulse, public transport alerts and vehicles distinctly", () => {
    expect(badgeForTrafficPulse(pulse)).toBe("REISETID");
    expect(badgeForPublicTransportAlert(alert)).toBe("KOLLEKTIV");
    expect(badgeForPublicTransportVehicle(vehicle)).toBe("KOLLEKTIV");
  });
});
