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
    heatmapCells: 1,
    observations: 4,
    unexplainedDelays: 1,
    criticalDelays: 0,
  },
  heatmapCells: [
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
    expect(html).toContain("E6 Okstadbakken");
    expect(html).toContain("6 min forsinkelse");
    expect(html).toContain("Varmepunkter");
    expect(html).toContain("4 observasjoner");
    expect(html).toContain("NRK");
    expect(html).toContain("Vegvesen trafikk");
    expect(html).toContain("/command/radata");
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
