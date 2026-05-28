import { describe, expect, it, vi } from "vitest";
import {
  createCollectionGuard,
  normalizeDatexSituationEndpoint,
  shouldResolveMissingDatexSituations,
} from "../src/index.js";

describe("worker lifecycle helpers", () => {
  it("enforces SRTI on configured DATEX situation endpoints", () => {
    const withoutSrti = normalizeDatexSituationEndpoint(
      "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata?foo=bar",
    );
    expect(new URL(withoutSrti).searchParams.get("srti")).toBe("True");
    expect(new URL(withoutSrti).searchParams.get("foo")).toBe("bar");

    const overriddenSrti = normalizeDatexSituationEndpoint(
      "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata?srti=false",
    );
    expect(new URL(overriddenSrti).searchParams.get("srti")).toBe("True");
  });

  it("rejects invalid DATEX situation endpoints", () => {
    expect(() => normalizeDatexSituationEndpoint("not a url")).toThrow(/DATEX_ENDPOINT/);
  });

  it("resolves missing DATEX situations only after a fresh snapshot", () => {
    expect(shouldResolveMissingDatexSituations(true)).toBe(true);
    expect(shouldResolveMissingDatexSituations(false)).toBe(false);
  });

  it("skips overlapping collection cycles while one is in flight", async () => {
    let finishFirstRun!: () => void;
    const firstCollection = new Promise<void>((resolve) => {
      finishFirstRun = resolve;
    });
    const collect = vi.fn(() =>
      collect.mock.calls.length === 1 ? firstCollection : Promise.resolve(),
    );
    const onSkip = vi.fn();
    const guarded = createCollectionGuard(collect, onSkip);

    const firstRun = guarded();
    await Promise.resolve();
    await guarded();

    expect(collect).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);

    finishFirstRun();
    await firstRun;
    await guarded();

    expect(collect).toHaveBeenCalledTimes(2);
  });
});
