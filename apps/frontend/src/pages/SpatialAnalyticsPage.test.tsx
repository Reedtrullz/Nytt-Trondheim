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

import {
  SpatialAnalyticsDashboard,
  spatialAnalyticsFiltersForTimeWindow,
} from "./SpatialAnalyticsPage.js";

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
  investigationQueue: [
    {
      id: "investigation:delay:e6-south:100141",
      kind: "unexplained_delay",
      priority: "high",
      title: "E6 Okstadbakken - E6 Sluppenrampene",
      summary: "6 min forsinkelse uten kjent årsak",
      reason: "DATEX viser ca. 6 min forsinkelse uten koblet trafikkhendelse.",
      updatedAt: "2026-07-02T09:40:00.000Z",
      evidence: [
        "DATEX reisetid: 6 min",
        "Mulige saker: Kø på E6 ved Sluppen",
        "Ingen romlig koblet trafikkhendelse",
      ],
      articleIds: ["article-one"],
      sourceItemIds: [],
      sourceConfidence: {
        level: "likely",
        label: "Sannsynlig",
        score: 0.7,
        rationale: "Redaksjonell dekning støttes av kontekstsignaler.",
      },
      targetUrl: "https://example.test/datex",
    },
    {
      id: "investigation:cell:1039:6339",
      kind: "hotspot",
      priority: "high",
      title: "Varmepunkt 1039:6339",
      summary: "4 observasjoner ved 63.390, 10.390",
      reason: "Tetthet eller tverrkildesignal bør kontrolleres i kart og rådata.",
      updatedAt: "2026-07-02T09:40:00.000Z",
      evidence: ["4 observasjoner", "2 nyhetssaker", "1 trafikkhendelse"],
      articleIds: [],
      sourceItemIds: ["source:one"],
    },
    {
      id: "investigation:traffic-counter:06970V72811",
      kind: "traffic_counter_anomaly",
      priority: "high",
      title: "E6 Sluppen",
      summary: "Trafikkdata viser 2.8x normal trafikk",
      reason:
        "Trafikkdata er et kontekstsignal og bør kontrolleres mot kart, nyheter og DATEX før tiltak.",
      updatedAt: "2026-07-02T09:40:00.000Z",
      evidence: ["2200 kjøretøy siste time", "Normalnivå: 800", "2.8x normal trafikk"],
      articleIds: [],
      sourceItemIds: [],
      sourceConfidence: {
        level: "uncertain",
        label: "Usikker",
        score: 0.46,
        rationale: "Kontekstsignal fra Trafikkdata.",
      },
    },
  ],
  heatmapCells: [
    {
      id: "cell:weak",
      center: { lat: 63.41, lng: 10.36 },
      radiusMeters: 650,
      count: 1,
      sourceItemCount: 1,
      articleCount: 0,
      trafficEventCount: 0,
      firstSeenAt: "2026-07-02T09:44:00.000Z",
      lastSeenAt: "2026-07-02T09:44:00.000Z",
      activeDayCount: 1,
      sourceIds: ["deepseek"],
      maxSeverity: "low",
    },
    {
      id: "cell:1039:6339",
      center: { lat: 63.39, lng: 10.39 },
      radiusMeters: 650,
      count: 4,
      sourceItemCount: 3,
      sourceItemIds: ["source:one", "source:two", "source:three", "source:four"],
      articleCount: 2,
      trafficEventCount: 1,
      firstSeenAt: "2026-06-30T09:40:00.000Z",
      lastSeenAt: "2026-07-02T09:40:00.000Z",
      activeDayCount: 3,
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
  it("builds deterministic query windows for spatial-temporal analysis", () => {
    const base = new Date("2026-07-02T12:00:00.000Z");

    expect(spatialAnalyticsFiltersForTimeWindow("2h", base)).toEqual({
      from: "2026-07-02T10:00:00.000Z",
      to: "2026-07-02T12:00:00.000Z",
    });
    expect(spatialAnalyticsFiltersForTimeWindow("24h", base)).toEqual({
      from: "2026-07-01T12:00:00.000Z",
      to: "2026-07-02T12:00:00.000Z",
    });
    expect(spatialAnalyticsFiltersForTimeWindow("7d", base)).toEqual({
      from: "2026-06-25T12:00:00.000Z",
      to: "2026-07-02T12:00:00.000Z",
    });
    expect(spatialAnalyticsFiltersForTimeWindow("all", base)).toEqual({});
  });

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
    expect(html).toContain("Tidsrom");
    expect(html).toContain("Siste døgn");
    expect(html).toContain("Analysevindu: Hele tilgjengelige datasett");
    expect(html).toContain("Operatørkø");
    expect(html).toContain("Signaler å undersøke");
    expect(html).toContain("3 signaler");
    expect(html).toContain("Høy prioritet · Uforklart forsinkelse");
    expect(html).toContain("Høy prioritet · Trafikkdata-avvik");
    expect(html).toContain("E6 Sluppen");
    expect(html).toContain("2.8x normal trafikk");
    expect(html).toContain("DATEX reisetid: 6 min");
    expect(html).toContain("Mulige saker: Kø på E6 ved Sluppen");
    expect(html).toContain("1 mulige saker");
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
    expect(html).toContain("Først sett 30. juni 2026");
    expect(html).toContain("3 aktive dager");
    expect(html).toContain("høy alvorlighet");
    expect(html).toContain("1 trafikkhendelse");
    expect(html).toContain("Offisielle kilder og redaksjonelle kilder");
    expect(html).toContain("NRK");
    expect(html).toContain("Vegvesen trafikk");
    expect(html).toContain("/command/radata?sourceItem=source%3Aone");
    expect(html).toContain("Rådata 1");
    expect(html).toContain("+1 flere");
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
            investigationQueue: [],
            heatmapCells: [],
            unexplainedDelays: [],
          }}
          showMap={false}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen store DATEX-forsinkelser uten koblet trafikkhendelse");
    expect(html).toContain("Ingen prioriterte romlige signaler");
    expect(html).toContain("Ingen stedfestede observasjoner");
  });
});
