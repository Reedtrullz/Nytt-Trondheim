import type { Article, TrafficCorridorImpact } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { buildUnexplainedDelayCandidates } from "../src/traffic/spatial-analytics.js";

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
});
