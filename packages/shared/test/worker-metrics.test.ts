import { describe, expect, it } from "vitest";
import type { OperationsStatus, WorkerCycleMetrics } from "../src/types.js";

const metrics: WorkerCycleMetrics = {
  cycleStartedAt: "2026-06-02T06:00:00.000Z",
  cycleCompletedAt: "2026-06-02T06:00:03.250Z",
  cycleDurationMs: 3250,
  sourceDurationsMs: {
    nrk: 120,
    datex: 850,
  },
  sourceItemCounts: {
    nrk: 4,
    datex: 2,
  },
  parseFailures: {
    datex: 1,
  },
};

describe("worker cycle metrics shared contract", () => {
  it("fits inside OperationsStatus without routing telemetry through source items", () => {
    const status: OperationsStatus = {
      sources: [],
      articleCount: 0,
      situationCounts: {
        preliminary: 0,
        active: 0,
        resolved: 0,
        dismissed: 0,
      },
      workerCycleMetrics: metrics,
    };

    expect(status.workerCycleMetrics?.cycleDurationMs).toBe(3250);
    expect(status.workerCycleMetrics?.sourceItemCounts.nrk).toBe(4);
    expect(status.workerCycleMetrics?.parseFailures.datex).toBe(1);
  });
});
