import type { PublicTransportMapPayload, TrafficMapPayload } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { buildTrafficViewModel } from "./trafficViewModel.js";

const traffic: TrafficMapPayload = {
  events: [
    {
      id: "high-newer",
      source: "vegvesen_traffic_info",
      sourceEventId: "high-newer",
      category: "accident",
      severity: "high",
      state: "active",
      title: "Ulykke ved Lade",
      locationName: "Lade",
      updatedAt: "2026-06-01T16:43:00.000Z",
      geometry: { type: "Point", coordinates: [10.45, 63.44] },
    },
    {
      id: "critical-e6",
      source: "datex",
      sourceEventId: "datex-1",
      category: "closure",
      severity: "critical",
      state: "active",
      title: "E6 stengt ved Sluppen",
      locationName: "Sluppen",
      roadName: "E6",
      updatedAt: "2026-06-01T16:42:00.000Z",
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
      confidence: 0.98,
    },
    {
      id: "roadwork-1",
      source: "vegvesen_traffic_info",
      sourceEventId: "roadwork-1",
      category: "roadworks",
      severity: "medium",
      state: "planned",
      title: "Veiarbeid på Omkjøringsvegen",
      locationName: "Omkjøringsvegen",
      roadName: "E6",
      updatedAt: "2026-06-01T16:38:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
    },
    {
      id: "minor-active",
      source: "vegvesen_traffic_info",
      sourceEventId: "minor-active",
      category: "other",
      severity: "low",
      state: "active",
      title: "Mindre trafikkmelding",
      updatedAt: "2026-06-01T15:30:00.000Z",
      geometry: { type: "Point", coordinates: [10.41, 63.41] },
    },
    {
      id: "expired-medium",
      source: "vegvesen_traffic_info",
      sourceEventId: "expired-medium",
      category: "congestion",
      severity: "medium",
      state: "expired",
      title: "Utløpt kømelding",
      updatedAt: "2026-06-01T15:00:00.000Z",
      geometry: { type: "Point", coordinates: [10.42, 63.42] },
    },
  ],
  brief: {
    headline: "Trafikkstatus",
    severity: "critical",
    freshness: "fresh",
    generatedAt: "2026-06-01T16:42:00.000Z",
    bullets: [],
    primaryEventIds: ["critical-e6"],
    counts: { total: 3, byCategory: {}, bySeverity: {} },
  },
  corridorImpacts: [
    {
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
      affectedEventIds: ["critical-e6"],
      highestSeverity: "critical",
      travelTime: {
        id: "100141",
        name: "E6 Sluppen → Tiller",
        state: "congested",
        travelTimeSeconds: 1020,
        freeFlowSeconds: 540,
        delaySeconds: 480,
        delayRatio: 1.88,
        updatedAt: "2026-06-01T16:41:00.000Z",
        sourceUrl: "https://example.test/datex/travel-time",
      },
    },
  ],
  sources: [
    {
      source: "datex",
      label: "DATEX",
      state: "ok",
      detail: "1 aktiv hendelse",
      lastCheckedAt: "2026-06-01T16:42:00.000Z",
    },
  ],
};

const publicTransport: PublicTransportMapPayload = {
  vehicles: [],
  alerts: [
    {
      id: "entur-service-alert:ATB:line3",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "line3",
      summary: "Forsinkelse på linje 3",
      updatedAt: "2026-06-01T16:41:00.000Z",
      state: "active",
      affectedLineNames: ["Linje 3"],
    },
    {
      id: "entur-service-alert:ATB:expired",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "expired",
      summary: "Gammelt avvik på linje 10",
      updatedAt: "2026-06-01T15:41:00.000Z",
      state: "expired",
      affectedLineNames: ["Linje 10"],
    },
  ],
  sources: [
    {
      source: "entur_service_alerts",
      label: "Entur avvik",
      state: "ok",
      detail: "1 aktivt avvik",
      lastCheckedAt: "2026-06-01T16:41:00.000Z",
    },
  ],
  generatedAt: "2026-06-01T16:42:00.000Z",
};

describe("traffic view model", () => {
  it("builds the five top cards without exposing raw feeds", () => {
    const model = buildTrafficViewModel({ traffic, publicTransport, showAll: false });

    expect(model.summaryCards.map((card) => card.id)).toEqual([
      "critical",
      "delays",
      "roadworks",
      "publicTransport",
      "updated",
    ]);
    expect(model.summaryCards[0]).toMatchObject({ title: "Kritisk", count: 2, badge: "OFFISIELL" });
    expect(model.summaryCards[0]?.detail).toBe("E6 stengt ved Sluppen");
    expect(model.summaryCards[1]?.detail).toContain("+8 min");
    expect(model.summaryCards[3]).toMatchObject({
      title: "Kollektiv",
      count: 1,
      badge: "KOLLEKTIV",
    });
    expect(model.summaryCards[4]?.detail).toContain("18:42");
  });

  it("hides expired and minor rows by default but shows them with showAll", () => {
    const defaultIds = buildTrafficViewModel({
      traffic,
      publicTransport,
      showAll: false,
    }).rankedEvents.map((row) => row.id);
    expect(defaultIds).not.toContain("minor-active");
    expect(defaultIds).not.toContain("expired-medium");

    const showAllIds = buildTrafficViewModel({
      traffic,
      publicTransport,
      showAll: true,
    }).rankedEvents.map((row) => row.id);
    expect(showAllIds).toContain("minor-active");
    expect(showAllIds).toContain("expired-medium");
  });

  it("keeps summary cards aligned with hidden incident, roadwork, and travel-time layers", () => {
    const model = buildTrafficViewModel({
      traffic,
      publicTransport,
      showAll: false,
      visibleLayers: {
        incidents: false,
        roadworks: false,
        travelTime: false,
      },
    });

    expect(model.rankedEvents).toEqual([]);
    expect(model.delayCorridors).toEqual([]);
    expect(model.summaryCards.find((card) => card.id === "critical")).toMatchObject({
      title: "Rolig",
      count: 0,
      detail: "Ingen alvorlige aktive hendelser i kartutsnittet.",
    });
    expect(model.summaryCards.find((card) => card.id === "roadworks")).toMatchObject({
      count: 0,
      detail: "Ingen større planlagte arbeider i valgt område.",
    });
    expect(model.summaryCards.find((card) => card.id === "delays")).toMatchObject({
      count: 0,
      detail: "Ingen unormal reisetid i kjente korridorer.",
    });
  });

  it("keeps news-derived traffic estimates behind the estimated news layer", () => {
    const newsEvent = {
      id: "news-traffic:article-1",
      source: "news_article" as const,
      sourceEventId: "article-1",
      category: "closure" as const,
      severity: "high" as const,
      state: "active" as const,
      title: "Trafikkulykke stenger E6 ved Tiller",
      updatedAt: "2026-06-01T16:44:00.000Z",
      geometry: { type: "Point" as const, coordinates: [10.39, 63.39] },
      confidence: 0.62,
    };
    const hidden = buildTrafficViewModel({
      traffic: { ...traffic, events: [newsEvent] },
      publicTransport,
      showAll: false,
      visibleLayers: {
        incidents: true,
        roadworks: true,
        travelTime: true,
        estimatedNews: false,
      },
    });
    const visible = buildTrafficViewModel({
      traffic: { ...traffic, events: [newsEvent] },
      publicTransport,
      showAll: false,
      visibleLayers: {
        incidents: true,
        roadworks: true,
        travelTime: true,
        estimatedNews: true,
      },
    });

    expect(hidden.rankedEvents).toEqual([]);
    expect(visible.rankedEvents).toEqual([
      expect.objectContaining({
        id: "news-traffic:article-1",
        badges: ["ESTIMERT", "NYHETSKILDE"],
      }),
    ]);
    expect(visible.summaryCards[0]).toMatchObject({ title: "Kritisk", badge: "ESTIMERT" });
  });

  it("does not describe non-ok sources as simply current", () => {
    const model = buildTrafficViewModel({
      traffic: {
        ...traffic,
        sources: [
          ...(traffic.sources ?? []),
          {
            source: "datex_weather",
            label: "DATEX vær",
            state: "awaiting_access",
            detail: "Mangler tilgang",
            lastCheckedAt: "2026-06-01T16:40:00.000Z",
          },
        ],
      },
      publicTransport: {
        ...publicTransport,
        sources: [
          {
            ...publicTransport.sources[0]!,
            state: "disabled",
            detail: "Slått av i kartlag",
          },
        ],
      },
      showAll: false,
    });

    expect(model.summaryCards.find((card) => card.id === "updated")?.detail).toBe(
      "Sist hentet 18:42 · 2 kilder krever oppmerksomhet",
    );
  });

  it("keeps TravelTime as a delay card, not an incident row", () => {
    const model = buildTrafficViewModel({
      traffic: { ...traffic, events: [] },
      publicTransport,
      showAll: false,
    });
    expect(model.summaryCards.find((card) => card.id === "delays")?.count).toBe(1);
    expect(model.rankedEvents).toEqual([]);
  });

  it("keeps ranking scores finite when an upstream timestamp is invalid", () => {
    const model = buildTrafficViewModel({
      traffic: {
        ...traffic,
        events: [{ ...traffic.events[0]!, id: "invalid-time", updatedAt: "not-a-date" }],
      },
      publicTransport,
      showAll: false,
    });

    expect(model.rankedEvents).toHaveLength(1);
    expect(Number.isFinite(model.rankedEvents[0]?.score)).toBe(true);
  });
});
