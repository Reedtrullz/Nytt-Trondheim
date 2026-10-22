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

describe("map polling ownership", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces repeated triggers while one request is in flight", () => {
    const polling = new MapPolling();
    const first = polling.start("a");
    expect(first).toBeDefined();
    for (let i = 0; i < 20; i += 1) expect(polling.start("a")).toBeUndefined();
    expect(first?.signal.aborted).toBe(false);
    polling.finished(first!);
    expect(polling.start("a")).toBeDefined();
  });

  it("aborts the old generation on a key change and ignores its late result", () => {
    const polling = new MapPolling();
    const old = polling.start("a")!;
    const next = polling.start("b")!;
    expect(old.signal.aborted).toBe(true);
    expect(polling.owns(old)).toBe(false);
    polling.failed(old, new ApiError("late", 429, "600"));
    polling.finished(old);
    expect(polling.owns(next)).toBe(true);
    polling.cancel();
    expect(next.signal.aborted).toBe(true);
    expect(polling.start("b")).toBeDefined();
  });

  it("delays the next start by Retry-After seconds or date, then recovers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const polling = new MapPolling();
    let c = polling.start("a")!;
    polling.failed(c, new ApiError("slow", 429, "30"));
    polling.finished(c);
    vi.advanceTimersByTime(29_000);
    expect(polling.start("a")).toBeUndefined();
    vi.advanceTimersByTime(1_000);
    c = polling.start("a")!;
    expect(c).toBeDefined();
    polling.failed(c, new ApiError("slow", 429, "Thu, 01 Jan 2026 00:02:00 GMT"));
    polling.finished(c);
    vi.advanceTimersByTime(89_000);
    expect(polling.start("a")).toBeUndefined();
    vi.advanceTimersByTime(1_000);
    c = polling.start("a")!;
    polling.succeeded(c);
    polling.finished(c);
    expect(polling.start("a")).toBeDefined();
  });

  it("uses bounded exponential fallback for 503 and invalid headers but not other errors", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const polling = new MapPolling();
    let c = polling.start("a")!;
    polling.failed(c, new ApiError("down", 503, "soon"));
    polling.finished(c);
    vi.advanceTimersByTime(999);
    expect(polling.start("a")).toBeUndefined();
    vi.advanceTimersByTime(1);
    c = polling.start("a")!;
    polling.failed(c, new ApiError("down", 503));
    polling.finished(c);
    vi.advanceTimersByTime(1_999);
    expect(polling.start("a")).toBeUndefined();
    vi.advanceTimersByTime(1);
    c = polling.start("a")!;
    polling.failed(c, new ApiError("boom", 500));
    polling.failed(c, new Error("network"));
    polling.finished(c);
    expect(polling.start("a")).toBeDefined();
  });

  it("parses Retry-After safely", () => {
    const now = 1_000_000;
    expect(retryAfterDeadline("5", now)).toBe(now + 5_000);
    expect(retryAfterDeadline("99999999999999999999", now)).toBe(now + 3_600_000);
    expect(retryAfterDeadline("-5", now)).toBeUndefined();
    expect(retryAfterDeadline("1.5", now)).toBeUndefined();
    expect(retryAfterDeadline("garbage", now)).toBeUndefined();
    expect(retryAfterDeadline(undefined, now)).toBeUndefined();
    expect(retryAfterDeadline("Thu, 01 Jan 1970 00:00:00 GMT", now)).toBe(now);
  });
});
