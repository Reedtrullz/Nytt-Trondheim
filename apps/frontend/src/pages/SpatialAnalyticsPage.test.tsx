import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CommandCenterSpatialAnalyticsPayload } from "@nytt/shared";

vi.mock("react-leaflet", () => ({
  CircleMarker: () => null,
  MapContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Polyline: () => null,
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
}));

import { SpatialAnalyticsDashboard } from "./SpatialAnalyticsPage.js";

const payload: CommandCenterSpatialAnalyticsPayload = {
  generatedAt: "2026-07-02T09:45:00.000Z",
  window: {},
  summary: {
    heatmapCells: 2,
    observations: 5,
    unexplainedDelays: 2,
    criticalDelays: 0,
    bySourceConfidence: {
      confirmed: 1,
      likely: 2,
      uncertain: 0,
      speculative: 1,
    },
  },
  heatmapCells: [
    {
      id: "cell:weak",
      center: { lat: 63.41, lng: 10.36 },
      radiusMeters: 650,
      count: 1,
      sourceItemCount: 1,
      articleCount: 0,
      trafficEventCount: 0,
      lastSeenAt: "2026-07-02T09:44:00.000Z",
      sourceIds: ["deepseek"],
      maxSeverity: "low",
    },
    {
      id: "cell:1039:6339",
      center: { lat: 63.39, lng: 10.39 },
      radiusMeters: 650,
      count: 4,
      sourceItemCount: 3,
      articleCount: 2,
      trafficEventCount: 1,
      lastSeenAt: "2026-07-02T09:40:00.000Z",
      sourceIds: ["nrk", "vegvesen_traffic_info"],
      maxSeverity: "high",
    },
  ],
  unexplainedDelays: [
    {
      id: "delay:weak",
      corridorId: "byasen",
      corridorName: "Byåsen - Stavne",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.35, 63.41],
          [10.37, 63.42],
        ],
      },
      state: "slow",
      delaySeconds: 90,
      delayRatio: 1.1,
      updatedAt: "2026-07-02T09:44:00.000Z",
      sourceUrl: "https://example.test/datex-weak",
      matchedArticleIds: [],
      affectedEventIds: [],
      confidence: "watch",
      reason: "Kort DATEX-forsinkelse uten koblede saker.",
      sourceConfidence: {
        level: "likely",
        label: "Sannsynlig",
        score: 0.7,
        rationale: "API-levert kildevurdering.",
      },
    },
    {
      id: "delay:e6-south:100141",
      corridorId: "e6-south",
      corridorName: "E6 Okstadbakken - E6 Sluppenrampene",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.39, 63.36],
          [10.4, 63.39],
        ],
      },
      state: "slow",
      delaySeconds: 360,
      delayRatio: 1.67,
      updatedAt: "2026-07-02T09:40:00.000Z",
      sourceUrl: "https://example.test/datex",
      matchedArticleIds: ["article-one"],
      affectedEventIds: [],
      confidence: "warning",
      reason: "DATEX viser ca. 6 min forsinkelse uten koblet trafikkhendelse.",
    },
  ],
};

describe("SpatialAnalyticsDashboard", () => {
  it("renders spatial summary, unexplained delays and heatmap cells", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SpatialAnalyticsDashboard
          filters={{ minDelaySeconds: 180, limit: 80 }}
          onFiltersChange={vi.fn()}
          payload={payload}
          showMap={false}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Romlig analyse");
    expect(html).toContain("Uforklarte forsinkelser");
    expect(html).toContain("Bekreftet/sannsynlig");
    expect(html).toContain("E6 Okstadbakken");
    expect(html).toContain("6 min forsinkelse");
    expect(html).toContain("Sannsynlig tillit");
    expect(html).toContain("Redaksjonell dekning støttes av kontekstsignaler");
    expect(html).toContain("API-levert kildevurdering");
    expect(html).toContain("Varmepunkter");
    expect(html).toContain("Høy prioritet");
    expect(html).toContain("Bekreftet tillit");
    expect(html).toContain("4 observasjoner");
    expect(html).toContain("høy alvorlighet");
    expect(html).toContain("1 trafikkhendelse");
    expect(html).toContain("Offisielle kilder og redaksjonelle kilder");
    expect(html).toContain("NRK");
    expect(html).toContain("Vegvesen trafikk");
    expect(html).toContain("/command/radata");

    const highPriorityIndex = html.indexOf("4 observasjoner");
    const weakSignalIndex = html.indexOf("1 observasjoner");
    expect(highPriorityIndex).toBeGreaterThan(-1);
    expect(weakSignalIndex).toBeGreaterThan(-1);
    expect(highPriorityIndex).toBeLessThan(weakSignalIndex);

    const strongDelayIndex = html.indexOf("E6 Okstadbakken");
    const weakDelayIndex = html.indexOf("Byåsen - Stavne");
    expect(strongDelayIndex).toBeGreaterThan(-1);
    expect(weakDelayIndex).toBeGreaterThan(-1);
    expect(strongDelayIndex).toBeLessThan(weakDelayIndex);
  });

  it("renders honest empty states", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SpatialAnalyticsDashboard
          filters={{ minDelaySeconds: 300, limit: 50 }}
          onFiltersChange={vi.fn()}
          payload={{
            ...payload,
            summary: {
              heatmapCells: 0,
              observations: 0,
              unexplainedDelays: 0,
              criticalDelays: 0,
              bySourceConfidence: {
                confirmed: 0,
                likely: 0,
                uncertain: 0,
                speculative: 0,
              },
            },
            heatmapCells: [],
            unexplainedDelays: [],
          }}
          showMap={false}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen store DATEX-forsinkelser uten koblet trafikkhendelse");
    expect(html).toContain("Ingen stedfestede observasjoner");
  });
});
