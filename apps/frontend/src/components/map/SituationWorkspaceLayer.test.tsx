import type { MapFeature, MapFirstSituation } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SituationWorkspaceLayer } from "./SituationWorkspaceLayer.js";

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
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-layer="popup">{children}</div>,
}));

function pointFeature(id: string, label: string): MapFeature {
  return {
    id,
    type: "Feature",
    geometry: { type: "Point", coordinates: [10.4, 63.4] },
    properties: {
      label,
      provenance: "official",
      updatedAt: "2026-06-18T12:00:00.000Z",
    },
  };
}

const situation: MapFirstSituation = {
  id: "situation-1",
  type: "traffic",
  title: "Brann: Trondheim",
  summary: "Nødetatene rykker ut.",
  status: "active",
  importance: "normal",
  updatedAt: "2026-06-18T12:00:00.000Z",
  locationLabel: "Flatåsen",
  primaryFeature: pointFeature("feature-primary", "Hovedmarkering"),
  features: [
    pointFeature("feature-primary", "Hovedmarkering"),
    pointFeature("feature-secondary", "Sekundærmarkering"),
  ],
  timelinePreview: [],
  provenanceSummary: [],
  sourceConfidence: {
    level: "confirmed",
    label: "Bekreftet",
    sourceCount: 1,
    rationale: "Offentlig kilde.",
    updatedAt: "2026-06-18T12:00:00.000Z",
  },
  hasPrivateAnnotations: false,
};

describe("SituationWorkspaceLayer", () => {
  it("renders one overview object per situation even when it has multiple features", () => {
    const html = renderToStaticMarkup(
      <SituationWorkspaceLayer
        situations={[situation]}
        selectedSituationId={undefined}
        onSelectSituation={vi.fn()}
      />,
    );

    expect(html.match(/data-layer="circle"/g)).toHaveLength(1);
    expect(html).toContain("Hovedmarkering");
    expect(html).not.toContain("Sekundærmarkering");
  });
});
