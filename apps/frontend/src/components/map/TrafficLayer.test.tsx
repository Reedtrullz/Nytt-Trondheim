import type { TrafficMapEvent } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  CircleMarker: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-layer="circle" className={className}>
      {children}
    </div>
  ),
  GeoJSON: ({ children }: { children?: React.ReactNode }) => (
    <div data-layer="geojson">{children}</div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-layer="popup">{children}</div>,
}));

import { TrafficLayer } from "./TrafficLayer.js";

const validLineEvent: TrafficMapEvent = {
  id: "line-event",
  source: "vegvesen_traffic_info",
  sourceEventId: "line-event",
  category: "roadworks",
  severity: "medium",
  state: "active",
  title: "Veiarbeid på E6",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.39, 63.39],
      [10.41, 63.4],
    ],
  },
  relatedArticles: [
    {
      id: "article-1",
      title: "Kø ved E6",
      url: "https://example.test/article",
      distanceMeters: 120,
      location: { lat: 63.395, lng: 10.4, label: "E6" },
    },
  ],
};

describe("TrafficLayer semantic objects", () => {
  it("skips malformed official point geometry instead of passing it to GeoJSON", () => {
    const invalidPointEvent: TrafficMapEvent = {
      ...validLineEvent,
      id: "bad-point",
      geometry: { type: "Point", coordinates: [999, 999] },
    };

    const html = renderToStaticMarkup(<TrafficLayer events={[invalidPointEvent]} />);

    expect(html).not.toContain('data-layer="circle"');
    expect(html).not.toContain('data-layer="geojson"');
  });

  it("renders estimated news locations separately when enabled", () => {
    const html = renderToStaticMarkup(
      <TrafficLayer events={[validLineEvent]} showEstimatedNews={true} />,
    );

    expect(html).toContain('data-layer="geojson"');
    expect(html).toContain("traffic-estimated-news-location");
    expect(html).toContain("Estimert fra nyhetskilde: E6");
  });
});
