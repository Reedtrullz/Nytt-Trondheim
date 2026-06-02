import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OperationsStatus } from "@nytt/shared";
import { OperationsDashboard } from "./OperationsPage.js";

const status: OperationsStatus = {
  sources: [
    {
      source: "nrk",
      label: "NRK Trøndelag",
      state: "ok",
      lastCheckedAt: "2026-06-02T06:00:00.000Z",
      detail: "RSS",
    },
    {
      source: "datex",
      label: "Vegvesen DATEX",
      state: "degraded",
      lastCheckedAt: "2026-06-02T06:00:00.000Z",
      detail: "DATEX feilet",
    },
  ],
  articleCount: 12,
  situationCounts: {
    preliminary: 1,
    active: 2,
    resolved: 3,
    dismissed: 4,
  },
  latestCollectionAt: "2026-06-02T06:00:00.000Z",
  trafficPulse: [],
  workerCycleMetrics: {
    cycleStartedAt: "2026-06-02T06:00:00.000Z",
    cycleCompletedAt: "2026-06-02T06:00:03.250Z",
    cycleDurationMs: 3250,
    sourceDurationsMs: {
      nrk: 240,
      datex: 920,
    },
    sourceItemCounts: {
      nrk: 2,
      datex: 1,
    },
    parseFailures: {
      datex: 2,
    },
  },
  backup: { status: "ok", completedAt: "2026-06-02T05:00:00.000Z" },
  restoreCheck: { status: "ok", completedAt: "2026-06-02T04:00:00.000Z" },
};

describe("OperationsDashboard", () => {
  it("renders worker cycle metrics as operational telemetry", () => {
    const html = renderToStaticMarkup(<OperationsDashboard status={status} />);

    expect(html).toContain("Worker-syklus");
    expect(html).toContain("Operasjonell telemetri");
    expect(html).toContain("Dette er ikke hendelsesbevis");
    expect(html).toContain("3.3 sek");
    expect(html).toContain("Vegvesen DATEX");
    expect(html).toContain("Parsefeil");
    expect(html).toContain("2");
    expect(html).toContain("3 kildeobjekter");
    expect(html).toContain("Kilder som trenger tilsyn");
    expect(html).toContain("Gjenopprettingstest");
  });
});
