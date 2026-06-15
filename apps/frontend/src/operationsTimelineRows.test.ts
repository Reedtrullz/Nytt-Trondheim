import { describe, expect, it } from "vitest";
import type { OperationsTimelineEvent } from "@nytt/shared";
import {
  groupOperationsTimelineEvents,
  operationsTimelineConfidenceLabel,
  operationsTimelineKindLabel,
  operationsTimelineProvenanceLabel,
  operationsTimelineSeverityLabel,
  osloDayKey,
} from "./operationsTimelineRows.js";

const baseEvent: OperationsTimelineEvent = {
  id: "timeline:t1",
  timestamp: "2026-06-15T08:00:00.000Z",
  kind: "source_update",
  severity: "info",
  title: "Kildeoppdatering",
  detail: "Ny oppdatering.",
  source: "nrk",
  sourceLabel: "NRK Trøndelag",
  situationId: "skogbrann-bymarka",
  situationTitle: "Skogbrann ved Bymarka",
  situationStatus: "active",
  role: "incident",
  provenance: "reporting_estimate",
  private: false,
  links: [],
};

describe("operations timeline rows", () => {
  it("groups events by Europe/Oslo day without reordering rows", () => {
    const groups = groupOperationsTimelineEvents([
      { ...baseEvent, id: "late", timestamp: "2026-06-15T22:30:00.000Z" },
      { ...baseEvent, id: "early", timestamp: "2026-06-15T08:00:00.000Z" },
    ]);

    expect(osloDayKey("2026-06-15T22:30:00.000Z")).toBe("2026-06-16");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.events[0]?.id).toBe("late");
    expect(groups[1]?.events[0]?.id).toBe("early");
  });

  it("maps operational labels", () => {
    expect(operationsTimelineKindLabel("collector_run")).toBe("Worker-kjøring");
    expect(operationsTimelineSeverityLabel("warning")).toBe("Varsel");
    expect(operationsTimelineProvenanceLabel(baseEvent)).toBe("Anslag fra rapportering");
    expect(operationsTimelineConfidenceLabel(baseEvent)).toBe("Usikker");
  });
});
