import type { WeatherPreparednessPayload } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  Circle: ({
    center,
    children,
    pathOptions,
  }: {
    center: [number, number];
    children?: React.ReactNode;
    pathOptions?: { className?: string };
  }) => (
    <div data-center={center.join(",")} data-class={pathOptions?.className} data-layer="circle">
      {children}
    </div>
  ),
  CircleMarker: ({
    center,
    children,
    pathOptions,
  }: {
    center: [number, number];
    children?: React.ReactNode;
    pathOptions?: { className?: string };
  }) => (
    <div data-center={center.join(",")} data-class={pathOptions?.className} data-layer="circle">
      {children}
    </div>
  ),
  GeoJSON: ({ data, style }: { data: { type: string }; style?: () => { className?: string } }) => (
    <div data-class={style?.().className} data-geometry={data.type} data-layer="geojson" />
  ),
  MapContainer: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className} data-layer="map">
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-layer="popup">{children}</div>,
  TileLayer: () => null,
  useMap: () => ({
    fitBounds: () => undefined,
    getContainer: () => ({ setAttribute: () => undefined }),
    getZoom: () => 10,
    setView: () => undefined,
  }),
}));

import { WeatherPreparednessMap, weatherPreparednessSourceLine } from "./WeatherPage.js";

const payload = {
  generatedAt: "2026-06-01T08:00:00.000Z",
  current: { summary: "Regn", updatedAt: "2026-06-01T08:00:00.000Z" },
  hourly: [],
  risks: [],
  actions: [],
  authority: { emergencyAlertStatus: "", civilDefenceDetail: "", links: [] },
  impactGroups: [
    {
      group: "Transport",
      status: "Våte veier",
      level: "warning",
      detail: "Redusert sikt på utsatte strekninger.",
      source: "DATEX",
    },
  ],
  warnings: [
    {
      id: "met-warning",
      source: "met",
      sourceLabel: "MET farevarsel",
      title: "Kraftig regn",
      area: "Trøndelag",
      level: "Gult",
      validUntil: "2099-06-02T09:00:00.000Z",
      url: "https://example.test/met",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [10.2, 63.3],
            [10.6, 63.3],
            [10.6, 63.5],
            [10.2, 63.3],
          ],
        ],
      },
    },
  ],
  roadWeather: [
    {
      id: "road-weather-1",
      source: "datex_weather",
      stationId: "station-1",
      stationName: "E6 Tonstad",
      observedAt: "2026-06-01T08:03:00.000Z",
      updatedAt: "2026-06-01T08:04:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.36] },
      roadSurfaceTemperatureC: 1.5,
      precipitationMm: 1.8,
    },
  ],
  mapLayers: [
    {
      id: "met-warnings",
      title: "MET farevarselgeometri",
      source: "MET",
      status: "available",
      detail: "Tegnes med kildegeometri.",
    },
    {
      id: "nve-warning-areas",
      title: "NVE flom- og skredområder",
      source: "NVE/Varsom",
      status: "planned",
      detail: "Neste lag.",
    },
  ],
  sources: [],
} satisfies WeatherPreparednessPayload;

describe("WeatherPreparednessMap", () => {
  it("renders payload-driven warning geometry and road-weather markers", () => {
    const html = renderToStaticMarkup(<WeatherPreparednessMap payload={payload} />);

    expect(html).toContain("Værkart for Trondheim");
    expect(html).toContain('data-layer="geojson"');
    expect(html).toContain('data-class="weather-warning-area weather-warning-area-watch"');
    expect(html).toContain('data-layer="circle"');
    expect(html).toContain('data-center="63.36,10.39"');
    expect(html).toContain("E6 Tonstad");
    expect(html).toContain("Tegnes i kart");
  });

  it("does not render the old decorative schematic overlay labels", () => {
    const html = renderToStaticMarkup(<WeatherPreparednessMap payload={payload} />);

    expect(html).not.toContain("rain-band");
    expect(html).not.toContain("weather-map-road");
    expect(html).not.toContain("weather-map-label");
  });

  it("builds a compact source line from the preparedness evidence, not only source health", () => {
    expect(
      weatherPreparednessSourceLine({
        ...payload,
        current: { ...payload.current, summary: "MET Locationforecast: skyet nå" },
        authority: {
          ...payload.authority,
          links: [{ label: "DSB egenberedskap", url: "https://example.test", source: "DSB" }],
        },
        sources: [
          {
            source: "datex",
            label: "Vegvesen DATEX",
            state: "awaiting_access",
            detail: "Venter på DATEX Basic Auth",
          },
        ],
      }),
    ).toBe("Kilder: MET, NVE/Varsom, Statens vegvesen DATEX, DSB");
  });
});
