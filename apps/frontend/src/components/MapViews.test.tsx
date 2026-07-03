import { sampleSituation, type Article } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { nearbyStoryItems } from "../homeNearby.js";

vi.mock("leaflet", () => ({
  default: {
    divIcon: (options: unknown) => options,
  },
}));

vi.mock("react-leaflet", () => ({
  CircleMarker: ({
    center,
    children,
  }: {
    center: [number, number];
    children?: React.ReactNode;
  }) => (
    <div data-center={center.join(",")} data-layer="circle">
      {children}
    </div>
  ),
  GeoJSON: ({ children }: { children?: React.ReactNode }) => (
    <div data-layer="geojson">{children}</div>
  ),
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

import { NewsMap } from "./NewsMap.js";
import { SituationMap } from "./MapViews.js";

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

  it("renders close nearby stories as a cluster count marker", () => {
    const second = {
      ...article,
      id: "article-2",
      title: "Oppdatering ved Sluppen",
      location: { lat: 63.4005, lng: 10.4003, label: "Sluppen" },
    };
    const far = {
      ...article,
      id: "article-3",
      title: "Sak ved Lade",
      location: { lat: 63.44, lng: 10.43, label: "Lade" },
    };
    const items = nearbyStoryItems([article, second, far], { limit: 3 });
    const html = renderToStaticMarkup(<NewsMap items={items} selectedId="article-2" />);

    expect(html).toContain("story-marker-cluster");
    expect(html).toContain("story-marker-selected");
    expect(html).toContain("&lt;span&gt;2&lt;/span&gt;");
    expect(html).toContain("2 saker nær Sluppen");
    expect(html).toContain('data-layer="popup"');
    expect(html).toContain("Kartfestet sak");
    expect(html).toContain("Påvirker ferdsel");
    expect(html).toContain("Oppdatering ved Sluppen");
    expect(html).toContain('data-position="63.44,10.43"');
  });

  it("shows verification and confidence context in story marker popups", () => {
    const html = renderToStaticMarkup(
      <NewsMap
        items={nearbyStoryItems([
          {
            ...article,
            source: "adressa",
            sourceLabel: "Adresseavisen",
            title: "Kollisjon stenger E6",
            publicVerification: {
              status: "verified",
              label: "Verifisert",
              detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
              officialSources: ["datex"],
              reportingSources: ["adressa"],
              situationId: "datex-e6",
            },
          },
        ])}
      />,
    );

    expect(html).toContain("Verifisert · Statens vegvesen DATEX + Adresseavisen");
    expect(html).toContain("Kildetillit: Bekreftet");
  });
});

describe("SituationMap", () => {
  it("shows source and provenance details in feature popups", () => {
    const situation = {
      ...sampleSituation,
      features: sampleSituation.features.map((feature) =>
        feature.id === "feature-reported"
          ? {
              ...feature,
              properties: {
                ...feature.properties,
                sourceUrl: "https://example.test/source",
                sourceConfidence: {
                  level: "likely" as const,
                  label: "Sannsynlig" as const,
                  sourceCount: 2,
                  rationale: "To redaksjonelle kilder peker mot samme område.",
                  updatedAt: feature.properties.updatedAt,
                },
              },
            }
          : feature,
      ),
    };
    const html = renderToStaticMarkup(
      <SituationMap
        situation={situation}
        onCreateFeature={() => Promise.resolve(true)}
        onUpdateFeature={() => Promise.resolve()}
        onDeleteFeature={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Omtalt stedsnavn - geokodet anslag fra rapportering");
    expect(html).toContain("Anslag fra rapportering");
    expect(html).toContain("NRK Trøndelag / Adresseavisen · Sannsynlig");
    expect(html).toContain("To redaksjonelle kilder peker mot samme område.");
    expect(html).toContain('href="https://example.test/source"');
    expect(html).toContain("Farevarsel fra MET");
    expect(html).toContain("Offisiell");
  });

  it("omits unsafe source links from feature popups", () => {
    const situation = {
      ...sampleSituation,
      features: [
        {
          ...sampleSituation.features[0]!,
          properties: {
            ...sampleSituation.features[0]!.properties,
            sourceUrl: "javascript:alert(1)",
          },
        },
      ],
    };
    const html = renderToStaticMarkup(
      <SituationMap
        situation={situation}
        onCreateFeature={() => Promise.resolve(true)}
        onUpdateFeature={() => Promise.resolve()}
        onDeleteFeature={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Omtalt stedsnavn - geokodet anslag fra rapportering");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Åpne kilde");
  });
});
