import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import { pruneExpiredData, retentionConfig } from "../src/retention.js";

function fakePool(deleteCounts: number[]) {
  let call = 0;
  return {
    query: vi.fn(async () => ({ rowCount: deleteCounts[call++] ?? 0 })),
  } as unknown as pg.Pool;
}

describe("retentionConfig", () => {
  it("uses documented defaults", () => {
    const config = retentionConfig({});
    expect(config).toEqual({
      capturesDays: 30,
      collectorRunsDays: 90,
      telemetryHistoryDays: 30,
      vehicleRowsDays: 7,
      pushDeliveriesDays: 180,
    });
  });

  it("rejects non-integer or below-minimum values", () => {
    expect(retentionConfig({ RETENTION_SOURCE_ITEM_CAPTURES_DAYS: "0" }).capturesDays).toBe(30);
    expect(retentionConfig({ RETENTION_COLLECTOR_RUNS_DAYS: "1.5" }).collectorRunsDays).toBe(90);
    expect(retentionConfig({ RETENTION_PUSH_DELIVERIES_DAYS: "-3" }).pushDeliveriesDays).toBe(180);
    expect(retentionConfig({ RETENTION_TELEMETRY_HISTORY_DAYS: "14" }).telemetryHistoryDays).toBe(
      14,
    );
  });
});

describe("pruneExpiredData", () => {
  it("deletes each table with its configured interval", async () => {
    const pool = fakePool([5, 3, 12, 8, 40, 2]);
    const result = await pruneExpiredData(pool, retentionConfig({}));
    expect(pool.query).toHaveBeenCalledTimes(6);
    expect(result.sourceItemCaptures).toBe(5);
    expect(result.collectorRuns).toBe(3);
    expect(result.datexTravelTimeHistory).toBe(12);
    expect(result.trafficCounterSnapshotHistory).toBe(8);
    expect(result.expiredVehicles).toBe(40);
    expect(result.pushNotificationDeliveries).toBe(2);

    const firstCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(firstCall[0]).toContain("source_item_captures");
    expect(firstCall[1]).toEqual([30]);
  });

  it("treats null rowCount as zero", async () => {
    const pool = {
      query: vi.fn(async () => ({ rowCount: null })),
    } as unknown as pg.Pool;
    const result = await pruneExpiredData(pool, retentionConfig({}));
    expect(Object.values(result).every((count) => count === 0)).toBe(true);
  });
});
