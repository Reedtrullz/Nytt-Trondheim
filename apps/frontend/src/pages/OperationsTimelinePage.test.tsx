import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { OperationsTimelineResponse } from "@nytt/shared";
import { OperationsTimelineDashboard } from "./OperationsTimelinePage.js";

const timeline: OperationsTimelineResponse = {
  generatedAt: "2026-06-15T09:00:00.000Z",
  filters: { includePrivateAnnotations: true, limit: 100, sort: "desc" },
  events: [
    {
      id: "stale:datex_travel_time:freshness",
      timestamp: "2026-06-15T08:55:00.000Z",
      kind: "stale_warning",
      severity: "warning",
      title: "DATEX reisetid trenger tilsyn",
      detail: "DATEX reisetid har ikke ferske data innen forventet vindu.",
      source: "datex_travel_time",
      sourceLabel: "DATEX reisetid",
      role: "telemetry",
      provenance: "preparedness_context",
      private: false,
      links: [
        {
          kind: "source_audit",
          label: "Kilderevisjon",
          href: "/drift/kilder?sources=datex_travel_time&detail=datex_travel_time",
          sourceId: "datex_travel_time",
        },
      ],
    },
    {
      id: "timeline:t1",
      timestamp: "2026-06-15T08:30:00.000Z",
      kind: "source_update",
      severity: "info",
      title: "Publikum bes holde avstand",
      detail: "Oppdateringen er lenket til originalkilden.",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      situationId: "skogbrann-bymarka",
      situationTitle: "Skogbrann ved Bymarka",
      situationStatus: "active",
      role: "incident",
      provenance: "reporting_estimate",
      private: false,
      links: [
        {
          kind: "situation",
          label: "Skogbrann ved Bymarka",
          href: "/situasjoner/skogbrann-bymarka",
          situationId: "skogbrann-bymarka",
        },
        {
          kind: "external",
          label: "Original kilde",
          href: "https://www.nrk.no/trondelag/",
        },
      ],
    },
    {
      id: "private-note:skogbrann-bymarka:note-1",
      timestamp: "2026-06-15T08:10:00.000Z",
      kind: "review_action",
      severity: "muted",
      title: "Privat notat lagt til",
      detail: "Notatinnholdet holdes i arbeidsflaten.",
      source: "private_annotations",
      sourceLabel: "Private annotasjoner",
      situationId: "skogbrann-bymarka",
      situationTitle: "Skogbrann ved Bymarka",
      situationStatus: "active",
      role: "private",
      provenance: "private_annotation",
      private: true,
      links: [],
    },
  ],
  summary: {
    total: 3,
    activeSituations: 1,
    staleWarnings: 1,
    collectorRuns: 0,
    reviewerActions: 1,
    privateEvents: 1,
  },
};

describe("OperationsTimelineDashboard", () => {
  it("renders grouped events, badges and drawer links", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <OperationsTimelineDashboard
          timeline={timeline}
          filters={{ includePrivateAnnotations: true, selectedEvent: "timeline:t1" }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Operasjonstidslinje");
    expect(html).toContain("Utdaterte varsler");
    expect(html).toContain("DATEX reisetid trenger tilsyn");
    expect(html).toContain("Telemetri");
    expect(html).toContain("Publikum bes holde avstand");
    expect(html).toContain("Skogbrann ved Bymarka");
    expect(html).toContain("/situasjoner/skogbrann-bymarka");
    expect(html).toContain("Original kilde");
    expect(html).toContain("Privat notat lagt til");
  });

  it("renders the empty state", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <OperationsTimelineDashboard
          timeline={{
            ...timeline,
            events: [],
            summary: {
              total: 0,
              activeSituations: 0,
              staleWarnings: 0,
              collectorRuns: 0,
              reviewerActions: 0,
              privateEvents: 0,
            },
          }}
          filters={{ includePrivateAnnotations: true }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen hendelser matcher filteret.");
  });
});
