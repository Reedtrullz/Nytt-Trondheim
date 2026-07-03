import type { Article, TrafficCorridorImpact } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import {
  buildSpatialInvestigationQueue,
  buildUnexplainedDelayCandidates,
} from "../src/traffic/spatial-analytics.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-e6-delay",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Kø på E6 ved Sluppen",
    excerpt: "Trafikken står sakte sør for Trondheim.",
    url: "https://example.test/e6-delay",
    publishedAt: "2026-07-02T09:30:00.000Z",
    scope: "trondheim",
    category: "Transport",
    places: ["Sluppen", "Trondheim"],
    ...overrides,
  };
}

function corridorImpact(overrides: Partial<TrafficCorridorImpact> = {}): TrafficCorridorImpact {
  return {
    id: "e6-south",
    name: "E6 Okstadbakken - E6 Sluppenrampene",
    geometry: {
      type: "LineString",
      coordinates: [
        [10.39, 63.36],
        [10.4, 63.39],
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
      travelTimeSeconds: 900,
      freeFlowSeconds: 540,
      delaySeconds: 360,
      delayRatio: 1.67,
      measurementFrom: "2026-07-02T09:25:00.000Z",
      measurementTo: "2026-07-02T09:30:00.000Z",
      updatedAt: "2026-07-02T09:30:20.000Z",
      sourceUrl: "https://example.test/datex-travel-time",
    },
    ...overrides,
  };
}

describe("spatial analytics unexplained delay candidates", () => {
  it("flags delayed corridors without a spatially linked traffic event", () => {
    const candidates = buildUnexplainedDelayCandidates([corridorImpact()], [article()], {
      minDelaySeconds: 180,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "delay:e6-south:100141",
      corridorId: "e6-south",
      confidence: "warning",
      delaySeconds: 360,
      matchedArticleIds: ["article-e6-delay"],
      affectedEventIds: [],
      rawRefs: [
        {
          type: "telemetry",
          source: "datex_travel_time",
          id: "100141",
          label: "DATEX reisetid",
          observedAt: "2026-07-02T09:30:00.000Z",
        },
      ],
    });
  });

  it("does not flag corridors already explained by traffic events", () => {
    const candidates = buildUnexplainedDelayCandidates(
      [corridorImpact({ affectedEventIds: ["traffic:event"], eventCount: 1 })],
      [article()],
    );

    expect(candidates).toEqual([]);
  });

  it("ignores weak delays below the configured threshold", () => {
    const candidates = buildUnexplainedDelayCandidates(
      [
        corridorImpact({
          travelTime: {
            ...corridorImpact().travelTime!,
            delaySeconds: 90,
            state: "slow",
          },
        }),
      ],
      [article()],
      { minDelaySeconds: 180 },
    );

    expect(candidates).toEqual([]);
  });

  it("builds a prioritized operator investigation queue from delays and hot cells", () => {
    const candidates = buildUnexplainedDelayCandidates([corridorImpact()], [article()], {
      minDelaySeconds: 180,
    }).map((candidate) => ({
      ...candidate,
      sourceConfidence: {
        level: "likely" as const,
        label: "Sannsynlig",
        score: 0.72,
        rationale: "DATEX reisetid støttes av mulig nyhetssak.",
      },
    }));
    const queue = buildSpatialInvestigationQueue(
      candidates,
      [
        {
          id: "cell:1039:6339",
          center: { lat: 63.39, lng: 10.39 },
          radiusMeters: 650,
          count: 4,
          sourceItemCount: 2,
          sourceItemIds: ["source:item-one", "source:item-two"],
          articleCount: 1,
          trafficEventCount: 1,
          firstSeenAt: "2026-06-30T09:38:00.000Z",
          lastSeenAt: "2026-07-02T09:38:00.000Z",
          activeDayCount: 3,
          sourceIds: ["nrk", "vegvesen_traffic_info"],
          maxSeverity: "high",
        },
      ],
      [article()],
    );

    expect(queue).toEqual([
      expect.objectContaining({
        kind: "unexplained_delay",
        priority: "high",
        title: "E6 Okstadbakken - E6 Sluppenrampene",
        articleIds: ["article-e6-delay"],
        sourceItemIds: [],
        rawRefs: [
          {
            type: "telemetry",
            source: "datex_travel_time",
            id: "100141",
            label: "DATEX reisetid",
            observedAt: "2026-07-02T09:30:00.000Z",
          },
        ],
        evidence: expect.arrayContaining([
          "DATEX reisetid: 6 min",
          "Mulige saker: Kø på E6 ved Sluppen",
          "Ingen romlig koblet trafikkhendelse",
        ]),
        sourceConfidence: expect.objectContaining({ level: "likely" }),
        targetUrl: "https://example.test/datex-travel-time",
      }),
      expect.objectContaining({
        kind: "hotspot",
        priority: "high",
        sourceItemIds: ["source:item-one", "source:item-two"],
        evidence: expect.arrayContaining([
          "4 observasjoner",
          "3 aktive dager",
          "1 nyhetssak",
          "1 trafikkhendelse",
        ]),
      }),
    ]);
  });

  it("adds Trafikkdata counter anomalies as context-only investigation items", () => {
    const queue = buildSpatialInvestigationQueue(
      [],
      [],
      [],
      [
        {
          id: "trafikkdata:06970V72811",
          source: "trafikkdata",
          pointId: "06970V72811",
          name: "E6 Sluppen",
          updatedAt: "2026-07-02T09:40:00.000Z",
          geometry: { type: "Point", coordinates: [10.39, 63.39] },
          roadCategory: "E",
          roadNumber: "6",
          volumeLastHour: 2200,
          baselineVolumeLastHour: 800,
          anomalyRatio: 2.75,
          coveragePercent: 94,
        },
        {
          id: "trafikkdata:normal",
          source: "trafikkdata",
          pointId: "normal",
          name: "Normal teller",
          updatedAt: "2026-07-02T09:40:00.000Z",
          geometry: { type: "Point", coordinates: [10.4, 63.4] },
          anomalyRatio: 1.1,
        },
      ],
      { minCounterAnomalyRatio: 1.7 },
    );

    expect(queue).toEqual([
      expect.objectContaining({
        kind: "traffic_counter_anomaly",
        priority: "high",
        title: "E6 Sluppen",
        summary: "Trafikkdata viser 2.8x normal trafikk",
        articleIds: [],
        sourceItemIds: [],
        rawRefs: [
          {
            type: "telemetry",
            source: "trafikkdata",
            id: "06970V72811",
            label: "Trafikkdata teller",
            observedAt: "2026-07-02T09:40:00.000Z",
          },
        ],
        evidence: expect.arrayContaining([
          "2200 kjøretøy siste time",
          "Normalnivå: 800",
          "2.8x normal trafikk",
          "94 % dekning",
          "E 6",
        ]),
        sourceConfidence: expect.objectContaining({
          level: "uncertain",
          label: "Usikker",
        }),
      }),
    ]);
  });
});
