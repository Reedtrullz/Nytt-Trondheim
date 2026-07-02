import { describe, expect, it } from "vitest";
import {
  cycleDashboardWidgetSize,
  moveDashboardWidget,
  normalizeDashboardLayout,
  parseDashboardLayout,
} from "./dashboardLayout.js";

describe("dashboard layout model", () => {
  const widgets = [
    { id: "summary", defaultSize: "wide" as const },
    { id: "worker", defaultSize: "standard" as const },
    { id: "sources", defaultSize: "compact" as const },
  ];

  it("normalizes persisted order and sizes against available widgets", () => {
    const layout = normalizeDashboardLayout(widgets, {
      order: ["sources", "missing", "summary"],
      sizes: { sources: "full", worker: "not-a-size" as never },
    });

    expect(layout.order).toEqual(["sources", "summary", "worker"]);
    expect(layout.sizes).toEqual({
      sources: "full",
      summary: "wide",
      worker: "standard",
    });
  });

  it("keeps non-resizable widgets on their declared size", () => {
    const layout = normalizeDashboardLayout(
      [{ id: "brief", defaultSize: "full" as const, resizable: false }],
      { sizes: { brief: "compact" } },
    );

    expect(layout.sizes.brief).toBe("full");
  });

  it("moves widgets with bounded indexes", () => {
    const layout = normalizeDashboardLayout(widgets);
    expect(moveDashboardWidget(layout, "sources", 0).order).toEqual([
      "sources",
      "summary",
      "worker",
    ]);
    expect(moveDashboardWidget(layout, "summary", 99).order).toEqual([
      "worker",
      "sources",
      "summary",
    ]);
  });

  it("cycles widget size without touching other widgets", () => {
    const layout = normalizeDashboardLayout(widgets);
    const next = cycleDashboardWidgetSize(layout, "summary");

    expect(next.sizes.summary).toBe("tall");
    expect(next.sizes.worker).toBe("standard");
  });

  it("parses broken persisted layout defensively", () => {
    expect(parseDashboardLayout("{not json")).toEqual({});
    expect(
      parseDashboardLayout(JSON.stringify({ order: ["worker", 42], sizes: { worker: "wide" } })),
    ).toEqual({ order: ["worker"], sizes: { worker: "wide" } });
  });
});
