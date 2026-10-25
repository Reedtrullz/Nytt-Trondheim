import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api.js";
import { MapPolling, retryAfterDeadline, shouldPollWhenVisible } from "./useVisiblePolling.js";

describe("visible polling", () => {
  it("polls only when enabled and the document is visible", () => {
    expect(shouldPollWhenVisible({ enabled: true, hidden: false })).toBe(true);
    expect(shouldPollWhenVisible({ enabled: true, hidden: true })).toBe(false);
    expect(shouldPollWhenVisible({ enabled: false, hidden: false })).toBe(false);
  });
});

function setup() {
  const polling = new MapPolling();
  const calls: {
    signal: AbortSignal;
    resolve: (value: number) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const data: number[] = [];
  const loading: boolean[] = [];
  const errors: (string | undefined)[] = [];
  const run = (key = "a") =>
    polling.run(
      key,
      (signal) => new Promise<number>((resolve, reject) => calls.push({ signal, resolve, reject })),
      (value) => data.push(value),
      (value) => loading.push(value),
      (message) => errors.push(message),
      "fallback",
    );
  return { polling, calls, data, loading, errors, run };
}

describe("map polling ownership", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces repeated triggers while one request is in flight", async () => {
    const { calls, data, run } = setup();
    const first = run();
    const rest = Array.from({ length: 20 }, () => run());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal.aborted).toBe(false);
    calls[0]?.resolve(1);
    await Promise.all([first, ...rest]);
    expect(data).toEqual([1]);
    const next = run();
    expect(calls).toHaveLength(2);
    calls[1]?.resolve(2);
    await next;
    expect(data).toEqual([1, 2]);
  });

  it("aborts the old key and ignores its late result and late rejection", async () => {
    const { calls, data, errors, run } = setup();
    const old = run("a");
    const next = run("b");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.reject(new ApiError("late", 429, "600"));
    calls[1]?.resolve(2);
    await Promise.all([old, next]);
    expect(data).toEqual([2]);
    expect(errors.filter(Boolean)).toEqual([]);
    const again = run("b");
    expect(calls).toHaveLength(3);
    calls[2]?.resolve(3);
    await again;
  });

  it("cancel aborts in-flight work without reporting an error", async () => {
    const { polling, calls, data, errors, run } = setup();
    const pending = run();
    polling.cancel();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.reject(new DOMException("aborted", "AbortError"));
    await pending;
    expect(data).toEqual([]);
    expect(errors.filter(Boolean)).toEqual([]);
  });

  it("delays the next start by Retry-After seconds or date, keeps last-good data, then recovers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { calls, data, errors, run } = setup();
    let pending = run();
    calls[0]?.resolve(1);
    await pending;
    pending = run();
    calls[1]?.reject(new ApiError("slow", 429, "30"));
    await pending;
    expect(errors.at(-1)).toBe("slow");
    expect(data).toEqual([1]);
    vi.advanceTimersByTime(29_000);
    await run();
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    pending = run();
    expect(calls).toHaveLength(3);
    calls[2]?.reject(new ApiError("slow", 429, "Thu, 01 Jan 2026 00:02:00 GMT"));
    await pending;
    vi.advanceTimersByTime(89_000);
    await run();
    expect(calls).toHaveLength(3);
    vi.advanceTimersByTime(1_000);
    pending = run();
    calls[3]?.resolve(4);
    await pending;
    expect(data).toEqual([1, 4]);
    pending = run();
    expect(calls).toHaveLength(5);
    calls[4]?.resolve(5);
    await pending;
  });

  it("uses bounded exponential fallback for 503 and invalid headers but not other errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { calls, run } = setup();
    let pending = run();
    calls[0]?.reject(new ApiError("down", 503, "soon"));
    await pending;
    vi.advanceTimersByTime(999);
    await run();
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    pending = run();
    calls[1]?.reject(new ApiError("down", 503));
    await pending;
    vi.advanceTimersByTime(1_999);
    await run();
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(1);
    pending = run();
    calls[2]?.reject(new ApiError("boom", 500));
    await pending;
    pending = run();
    expect(calls).toHaveLength(4);
    calls[3]?.reject(new Error("network"));
    await pending;
  });

  it("parses Retry-After safely", () => {
    const now = 1_000_000;
    expect(retryAfterDeadline("5", now)).toBe(now + 5_000);
    expect(retryAfterDeadline("99999999999999999999", now)).toBe(now + 3_600_000);
    expect(retryAfterDeadline("-5", now)).toBeUndefined();
    expect(retryAfterDeadline("1.5", now)).toBeUndefined();
    expect(retryAfterDeadline("garbage", now)).toBeUndefined();
    expect(retryAfterDeadline(undefined, now)).toBeUndefined();
    expect(retryAfterDeadline("Thu, 01 Jan 1970 00:00:00 GMT", now)).toBeLessThanOrEqual(now);
  });
});
