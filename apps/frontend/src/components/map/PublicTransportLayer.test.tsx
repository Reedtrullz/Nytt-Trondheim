import type { PublicTransportMapPayload } from "@nytt/shared";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  CircleMarker: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Popup: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import { PublicTransportSummary, publicTransportModeGroups } from "./PublicTransportLayer.js";

const payload: PublicTransportMapPayload = {
  generatedAt: "2026-06-01T16:42:00.000Z",
  vehicles: [
    {
      id: "vehicle-bus-3",
      source: "entur_vehicle_positions",
      codespaceId: "ATB",
      vehicleId: "3",
      mode: "bus",
      publicCode: "3",
      destinationName: "Lade",
      lastUpdated: "2026-06-01T16:41:00.000Z",
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
      stale: false,
    },
    {
      id: "vehicle-tram-9",
      source: "entur_vehicle_positions",
      codespaceId: "ATB",
      vehicleId: "9",
      mode: "tram",
      publicCode: "9",
      destinationName: "Lian",
      lastUpdated: "2026-06-01T16:40:00.000Z",
      geometry: { type: "Point", coordinates: [10.38, 63.42] },
      stale: false,
    },
  ],
  alerts: [
    {
      id: "alert-bus-3",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "line3",
      summary: "Forsinkelse på linje 3",
      advice: "Beregn ekstra tid.",
      updatedAt: "2026-06-01T16:39:00.000Z",
      state: "active",
      affectedLineNames: ["Linje 3"],
      affectedStopNames: ["Prinsen kino"],
    },
    {
      id: "alert-rail",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "rail",
      summary: "Toget til Steinkjer er innstilt",
      updatedAt: "2026-06-01T16:39:00.000Z",
      state: "active",
      affectedLineNames: ["Trønderbanen"],
    },
  ],
  sources: [],
};

describe("PublicTransportSummary", () => {
  it("groups vehicles and alerts by travel mode", () => {
    expect(publicTransportModeGroups(payload).map((group) => group.label)).toEqual([
      "Buss",
      "Trikk",
      "Tog",
    ]);

    const html = renderToStaticMarkup(<PublicTransportSummary payload={payload} />);

    expect(html).toContain("Buss");
    expect(html).toContain("Trikk");
    expect(html).toContain("Tog");
    expect(html).toContain("Forsinkelse på linje 3");
    expect(html).toContain("Linjer: Linje 3");
    expect(html).toContain("Stopp: Prinsen kino");
    expect(html).toContain("Beregn ekstra tid.");
    expect(html).toContain("9 → Lian");
  });

  it("keeps an honest empty state that points to AtB/Entur for departures", () => {
    const html = renderToStaticMarkup(
      <PublicTransportSummary payload={{ ...payload, vehicles: [], alerts: [] }} />,
    );

    expect(html).toContain("Ingen aktive kollektivavvik eller kjøretøyposisjoner");
    expect(html).toContain("Sjekk AtB/Entur for konkrete avganger.");
  });
});
