import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import {
  RETENTION_INTERVAL_MS,
  createRetentionScheduler,
  pruneExpiredData,
  retentionConfig,
} from "../src/retention.js";

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

describe("createRetentionScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(deleteCounts: number[] = []) {
    vi.useFakeTimers();
    const pool = fakePool(deleteCounts);
    const log = { log: vi.fn(), warn: vi.fn() };
    const prune = vi.fn(() => pruneExpiredData(pool, retentionConfig({})));
    return { pool, log, prune, scheduler: createRetentionScheduler(prune, log) };
  }

  it("runs further passes on the interval without a restart and logs rowcounts", async () => {
    const { pool, log, prune, scheduler } = setup([4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await scheduler.runNow();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 2);
    expect(prune).toHaveBeenCalledTimes(3);
    expect(pool.query).toHaveBeenCalledTimes(18);
    expect(log.log).toHaveBeenCalledTimes(3);
    expect(log.log.mock.calls[0]![0]).toContain('"sourceItemCaptures":4');
    expect(log.log.mock.calls[1]![0]).toContain('"sourceItemCaptures":0');
    await scheduler.stop();
  });

  it("skips a tick while the previous pass is still running", async () => {
    vi.useFakeTimers();
    const log = { log: vi.fn(), warn: vi.fn() };
    let finish!: () => void;
    const prune = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof pruneExpiredData>>>((resolve) => {
          finish = () =>
            resolve({
              sourceItemCaptures: 0,
              collectorRuns: 0,
              datexTravelTimeHistory: 0,
              trafficCounterSnapshotHistory: 0,
              expiredVehicles: 0,
              pushNotificationDeliveries: 0,
            });
        }),
    );
    const scheduler = createRetentionScheduler(prune, log);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 3);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(prune).toHaveBeenCalledTimes(2);
    finish();
    await scheduler.stop();
  });

  it("reports a rejected pass and retries on the next tick", async () => {
    vi.useFakeTimers();
    const log = { log: vi.fn(), warn: vi.fn() };
    const prune = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue({ sourceItemCaptures: 0 });
    const scheduler = createRetentionScheduler(prune, log);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("db down"));
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(prune).toHaveBeenCalledTimes(2);
    expect(log.log).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it("reports a synchronously thrown pass and retries on the next tick", async () => {
    vi.useFakeTimers();
    const log = { log: vi.fn(), warn: vi.fn() };
    const prune = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync boom");
      })
      .mockResolvedValue({ sourceItemCaptures: 0 });
    const scheduler = createRetentionScheduler(prune, log);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("sync boom"));
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(prune).toHaveBeenCalledTimes(2);
    expect(log.log).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it("does not schedule anything unless started (--once)", async () => {
    const { prune, scheduler } = setup();
    await scheduler.runNow();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 2);
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("stop clears the timer and waits for the running pass", async () => {
    vi.useFakeTimers();
    const log = { log: vi.fn(), warn: vi.fn() };
    let release!: () => void;
    let settled = false;
    const prune = vi.fn(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      settled = true;
      return { sourceItemCaptures: 0 };
    });
    const scheduler = createRetentionScheduler(prune, log);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    const stopped = scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    release();
    await stopped;
    expect(settled).toBe(true);
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 2);
    expect(prune).toHaveBeenCalledTimes(1);
  });
});
