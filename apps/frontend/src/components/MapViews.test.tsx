import type { Article } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { nearbyStoryItems } from "../homeNearby.js";

vi.mock("leaflet", () => ({
  default: {
    divIcon: (options: unknown) => options,
  },
}));

vi.mock("react-leaflet", () => ({
  CircleMarker: () => null,
  GeoJSON: () => null,
  MapContainer: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <div data-layer="map" id={id}>
      {children}
    </div>
  ),
  Marker: ({
    children,
    icon,
    position,
    title,
  }: {
    children?: React.ReactNode;
    icon?: { className?: string; html?: string };
    position: [number, number];
    title?: string;
  }) => (
    <div
      data-icon-class={icon?.className}
      data-icon-html={icon?.html}
      data-layer="marker"
      data-position={position.join(",")}
      title={title}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-layer="popup">{children}</div>,
  TileLayer: () => null,
  WMSTileLayer: () => null,
  useMap: () => ({
    fitBounds: () => undefined,
    getContainer: () => ({
      setAttribute: () => undefined,
    }),
    getZoom: () => 12,
    setView: () => undefined,
  }),
  useMapEvents: () => null,
}));

import { NewsMap } from "./MapViews.js";

const article: Article = {
  id: "article-1",
  source: "nrk",
  sourceLabel: "NRK Trøndelag",
  title: "Hendelse ved Sluppen",
  excerpt: "Kort sammendrag.",
  url: "https://example.test/article",
  publishedAt: "2026-06-01T16:42:00.000Z",
  scope: "trondheim",
  category: "Transport",
  places: ["Sluppen"],
  location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
};

describe("NewsMap", () => {
  it("renders valid article locations as Leaflet lat/lng markers", () => {
    const html = renderToStaticMarkup(<NewsMap items={nearbyStoryItems([article])} />);

    expect(html).toContain('data-layer="marker"');
    expect(html).toContain('data-position="63.4,10.4"');
    expect(html).toContain('id="map"');
    expect(html).toContain("story-marker-selected");
    expect(html).toContain("&lt;span&gt;1&lt;/span&gt;");
    expect(html).toContain("Hendelse ved Sluppen");
  });

  it("omits malformed article locations from the preview map", () => {
    const html = renderToStaticMarkup(
      <NewsMap
        items={nearbyStoryItems([
          {
            ...article,
            id: "invalid-article",
            location: { lat: 999, lng: 10.4, label: "Utenfor gyldig breddegrad" },
          },
        ])}
      />,
    );

    expect(html).not.toContain('data-layer="marker"');
    expect(html).not.toContain("999");
  });

  it("marks the selected nearby story marker", () => {
    const second = {
      ...article,
      id: "article-2",
      title: "Kommunalt varsel ved Lade",
      source: "trondheim_kommune" as const,
      sourceLabel: "Trondheim kommune",
      category: "Transport" as const,
      location: { lat: 63.44, lng: 10.43, label: "Lade" },
    };
    const items = nearbyStoryItems([article, second]);
    const html = renderToStaticMarkup(<NewsMap items={items} selectedId="article-2" />);

    expect(html).toContain("story-marker-selected");
    expect(html).toContain("story-marker-municipal");
    expect(html).toContain('title="1. Kommunalt varsel ved Lade (Lade)"');
  });
});
