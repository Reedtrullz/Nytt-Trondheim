import type { RoadCamera, RoadWeatherObservation, TrafficCounterSnapshot } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  CircleMarker: ({
    children,
    center,
  }: {
    children?: React.ReactNode;
    center: [number, number];
  }) => (
    <div data-center={center.join(",")} data-layer="circle">
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-layer="popup">{children}</div>,
}));

import { RoadContextLayer } from "./RoadContextLayer.js";

const observation: RoadWeatherObservation = {
  id: "weather-1",
  source: "datex_weather",
  stationId: "station-1",
  stationName: "E6 Sluppen",
  observedAt: "2026-06-01T16:42:00.000Z",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
  airTemperatureC: 8,
};

const camera: RoadCamera = {
  id: "camera-1",
  source: "datex_cctv",
  cameraId: "kamera-1",
  name: "E6 Sluppen kamera",
  status: "ok",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: { type: "Point", coordinates: [10.41, 63.41] },
  imageUrl: "https://webkamera.vegvesen.no/public/kamera.jpg",
};

const counter: TrafficCounterSnapshot = {
  id: "counter-1",
  source: "trafikkdata",
  pointId: "punkt-1",
  name: "E6 Sluppen tellepunkt",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: { type: "Point", coordinates: [10.42, 63.42] },
  volumeLastHour: 123,
};

describe("RoadContextLayer", () => {
  it("renders valid road context points as Leaflet lat/lng", () => {
    const html = renderToStaticMarkup(<RoadContextLayer weather={[observation]} />);

    expect(html).toContain('data-layer="circle"');
    expect(html).toContain('data-center="63.4,10.4"');
    expect(html).toContain("E6 Sluppen");
  });

  it("skips malformed road context points instead of rendering them at null island", () => {
    const html = renderToStaticMarkup(
      <RoadContextLayer
        weather={[
          {
            ...observation,
            id: "weather-invalid",
            geometry: { type: "Point", coordinates: [999, 999] },
          } as RoadWeatherObservation,
        ]}
      />,
    );

    expect(html).not.toContain('data-layer="circle"');
    expect(html).not.toContain("999");
    expect(html).not.toContain("0,0");
  });

  it("renders camera and counter context payloads from the traffic map response", () => {
    const html = renderToStaticMarkup(
      <RoadContextLayer weather={[]} cameras={[camera]} counters={[counter]} />,
    );

    expect(html).toContain("E6 Sluppen kamera");
    expect(html).toContain("E6 Sluppen tellepunkt");
    expect(html).toContain('data-center="63.41,10.41"');
    expect(html).toContain('data-center="63.42,10.42"');
  });
});
