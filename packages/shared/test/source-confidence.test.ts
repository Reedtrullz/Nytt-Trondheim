import { describe, expect, it } from "vitest";
import {
  sourceConfidenceSignal,
  sourceMixConfidenceSummary,
  sourceConfidenceLevelFromScore,
} from "../src/source-confidence.js";

describe("source confidence scoring", () => {
  it("treats official and newsroom source mixes as confirmed", () => {
    const summary = sourceMixConfidenceSummary(["datex", "nrk"], {
      updatedAt: "2026-07-02T10:00:00.000Z",
    });

    expect(summary).toMatchObject({
      level: "confirmed",
      label: "Bekreftet",
      sourceCount: 2,
      updatedAt: "2026-07-02T10:00:00.000Z",
    });
    expect(summary.score).toBeGreaterThanOrEqual(0.95);
    expect(summary.rationale).toContain("Offisielle kilder og redaksjonelle kilder");
  });

  it("keeps newsroom-only signals likely but not confirmed", () => {
    const summary = sourceMixConfidenceSummary(["adressa", "vg"]);

    expect(summary.level).toBe("likely");
    expect(summary.label).toBe("Sannsynlig");
    expect(summary.rationale).toContain("Flere redaksjonelle kilder");
  });

  it("keeps telemetry-only context cautious", () => {
    const summary = sourceMixConfidenceSummary(["datex_travel_time", "entur_vehicle_positions"]);

    expect(summary.level).toBe("uncertain");
    expect(summary.label).toBe("Usikker");
    expect(summary.rationale).toContain("Kontekst- og telemetrikilder");
  });

  it("does not make missing sources look verified", () => {
    const summary = sourceMixConfidenceSummary([]);

    expect(summary).toMatchObject({
      level: "uncertain",
      label: "Usikker",
      score: 0,
      sourceCount: 0,
    });
  });

  it("classifies individual source weights", () => {
    expect(sourceConfidenceSignal("datex")).toMatchObject({ tier: "official" });
    expect(sourceConfidenceSignal("news_article")).toMatchObject({ tier: "trusted_media" });
    expect(sourceConfidenceSignal("deepseek")).toMatchObject({ tier: "private" });
    expect(sourceConfidenceSignal("unknown-feed")).toMatchObject({ tier: "unknown" });
  });

  it("maps numeric scores to existing source confidence levels", () => {
    expect(sourceConfidenceLevelFromScore(0.9)).toBe("confirmed");
    expect(sourceConfidenceLevelFromScore(0.7)).toBe("likely");
    expect(sourceConfidenceLevelFromScore(0.4)).toBe("uncertain");
    expect(sourceConfidenceLevelFromScore(0.2)).toBe("speculative");
  });
});
