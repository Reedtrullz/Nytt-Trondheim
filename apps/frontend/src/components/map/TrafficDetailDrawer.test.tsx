import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrafficDetailDrawer } from "./TrafficDetailDrawer.js";

const event: TrafficMapEvent = {
  id: "datex:e6-sluppen",
  source: "datex",
  sourceEventId: "e6-sluppen",
  category: "closure",
  severity: "critical",
  state: "active",
  title: "E6 ved Sluppen",
  description: "Sørgående felt er stengt.",
  roadName: "E6",
  locationName: "Sluppen",
  updatedAt: "2026-06-01T16:39:00.000Z",
  validFrom: "2026-06-01T16:21:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
  confidence: 0.98,
  relatedArticles: [
    {
      id: "article-1",
      title: "Adresseavisen: Kø ved Sluppen",
      url: "https://example.test/article",
      distanceMeters: 120,
      location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
    },
  ],
};

const impact: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 Sluppen → Tiller",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.379, 63.341],
      [10.403, 63.43],
    ],
  },
  bufferMeters: 800,
  eventCount: 1,
  affectedEventIds: ["datex:e6-sluppen"],
  highestSeverity: "critical",
  travelTime: {
    id: "100141",
    name: "E6 Sluppen → Tiller",
    state: "congested",
    travelTimeSeconds: 1140,
    freeFlowSeconds: 480,
    delaySeconds: 660,
    delayRatio: 2.37,
    updatedAt: "2026-06-01T16:39:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

describe("TrafficDetailDrawer", () => {
  it("renders why-this-is-visible details with provenance and traffic pulse", () => {
    const html = renderToStaticMarkup(
      <TrafficDetailDrawer event={event} corridorImpacts={[impact]} onClose={vi.fn()} />,
    );

    expect(html).toContain("Hvorfor ser jeg dette?");
    expect(html).toContain("E6 ved Sluppen");
    expect(html).toContain("Status");
    expect(html).toContain("Aktiv");
    expect(html).toContain("Kilde");
    expect(html).toContain("Statens vegvesen DATEX Situation");
    expect(html).toContain("Plassering");
    expect(html).toContain("Offisiell koordinat/geometri");
    expect(html).toContain("Konfidens");
    expect(html).toContain("98 %");
    expect(html).toContain("Normal: 8 min");
    expect(html).toContain("Nå: 19 min");
    expect(html).toContain("Adresseavisen: Kø ved Sluppen");
    expect(html).toContain("estimert nyhetsplassering");
  });

  it("returns no markup when no event is selected", () => {
    expect(
      renderToStaticMarkup(<TrafficDetailDrawer corridorImpacts={[]} onClose={vi.fn()} />),
    ).toBe("");
  });

  it("suppresses unsafe URLs and invalid optional measurements", () => {
    const html = renderToStaticMarkup(
      <TrafficDetailDrawer
        event={{
          ...event,
          sourceUrl: "javascript:alert(1)",
          updatedAt: "not-a-date",
          validFrom: "also-not-a-date",
          confidence: 2.5,
          relatedArticles: [
            {
              id: "unsafe-article",
              title: "Utrygg lenke",
              url: "data:text/html,<script>alert(1)</script>",
              distanceMeters: -5,
              location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
            },
          ],
        }}
        corridorImpacts={[]}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("Oppdatert");
    expect(html).toContain("ukjent");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("250 %");
    expect(html).not.toContain("-5 m unna");
    expect(html).toContain("Utrygg lenke");
  });
});
