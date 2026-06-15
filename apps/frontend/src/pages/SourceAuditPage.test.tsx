import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SourceAuditWorkspaceResponse } from "@nytt/shared";
import { SourceAuditDashboard } from "./SourceAuditPage.js";

const audit: SourceAuditWorkspaceResponse = {
  generatedAt: "2026-06-15T08:00:00.000Z",
  filters: { includeDiagnostics: true, limit: 80 },
  sources: [
    {
      source: "datex",
      label: "Vegvesen DATEX",
      group: "datex",
      role: "incident_source",
      provenance: "official",
      healthState: "degraded",
      freshness: {
        state: "stale",
        checkedAt: "2026-06-15T07:00:00.000Z",
        lastObservedAt: "2026-06-15T07:00:00.000Z",
        nextPollAt: "2026-06-15T08:10:00.000Z",
      },
      reliability: [
        {
          id: "datex:health-reliability",
          source: "datex",
          label: "Driftssignal",
          level: "watch",
          updatedAt: "2026-06-15T07:00:00.000Z",
        },
      ],
      latestRun: {
        id: "datex:run",
        source: "datex",
        collector: "datex",
        status: "partial",
        startedAt: "2026-06-15T06:59:00.000Z",
        completedAt: "2026-06-15T07:00:00.000Z",
        durationMs: 1000,
        recordsSeen: 4,
        recordsAccepted: 3,
        recordsRejected: 1,
      },
      openAlertCount: 1,
      criticalAlertCount: 1,
      contractStatus: "warn",
      lastIncidentTraceAt: "2026-06-15T06:50:00.000Z",
    },
  ],
  collectorRuns: [
    {
      id: "datex:run",
      source: "datex",
      collector: "datex",
      status: "partial",
      startedAt: "2026-06-15T06:59:00.000Z",
      completedAt: "2026-06-15T07:00:00.000Z",
      durationMs: 1000,
      recordsSeen: 4,
      recordsAccepted: 3,
      recordsRejected: 1,
    },
  ],
  alerts: [
    {
      id: "datex:freshness",
      source: "datex",
      severity: "critical",
      status: "open",
      firstSeenAt: "2026-06-15T07:00:00.000Z",
      lastSeenAt: "2026-06-15T08:00:00.000Z",
      expectedFreshnessSeconds: 3600,
      ageSeconds: 7200,
      message: "Vegvesen DATEX har ikke ferske data.",
    },
  ],
  contractChecks: [
    {
      id: "datex:secret-hygiene",
      source: "datex",
      kind: "secret_hygiene",
      status: "pass",
      label: "Hemmeligheter",
      checkedAt: "2026-06-15T08:00:00.000Z",
      detail: "Revisjonsflaten viser bare status, tider og tellinger.",
    },
  ],
  traceability: [
    {
      situationId: "datex-e6",
      title: "Trafikkhendelse på E6",
      status: "active",
      updatedAt: "2026-06-15T06:50:00.000Z",
      traceabilityState: "complete",
      sourceCount: 1,
      evidenceCount: 1,
      sourceItemCount: 1,
      privateAnnotationCount: 0,
      primarySources: ["datex"],
      provenanceCounts: { official: 1 },
      links: [
        {
          source: "datex",
          provenance: "official",
          relationship: "activation",
          publishedAt: "2026-06-15T06:50:00.000Z",
        },
      ],
    },
  ],
  diagnostics: [
    {
      key: "datex:health_state",
      label: "Kildestatus",
      kind: "scheduler",
      severity: "warning",
      safeForDisplay: true,
      value: "degraded",
      unit: "status",
      observedAt: "2026-06-15T07:00:00.000Z",
      detail: "DATEX feilet",
    },
  ],
};

describe("SourceAuditDashboard", () => {
  it("renders audit summaries, run history, diagnostics and situation links", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SourceAuditDashboard
          audit={audit}
          filters={{ includeDiagnostics: true }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Kildehelse og proveniens");
    expect(html).toContain("Revisjonskonsoll");
    expect(html).toContain("Vegvesen DATEX");
    expect(html).toContain("Kjøringshistorikk");
    expect(html).toContain("Kontraktsjekker");
    expect(html).toContain("Diagnostikk");
    expect(html).toContain("Trafikkhendelse på E6");
    expect(html).toContain("/situasjoner/datex-e6");
    expect(html).toContain("/drift/tidslinje");
  });
});
