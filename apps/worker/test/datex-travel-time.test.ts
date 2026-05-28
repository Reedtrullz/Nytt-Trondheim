import { describe, expect, it } from "vitest";
import type { OperationsStatus, SourceHealth, TrafficPulseCorridor } from "@nytt/shared";

const _trafficPulseCorridorTypeCheck = {
  id: "e6-sluppen-sandmoen",
  name: "E6 Sluppen–Sandmoen",
  state: "slow",
  travelTimeSeconds: 720,
  freeFlowSeconds: 540,
  delaySeconds: 180,
  delayRatio: 1.33,
  trend: "increasing",
  measurementFrom: "2026-05-28T09:55:00.000Z",
  measurementTo: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  sourceUrl: "https://datex.example.test/datexapi/GetTravelTime/pullsnapshotdata",
} satisfies TrafficPulseCorridor;

const _sourceHealthTypeCheck = {
  source: "datex_travel_time",
  label: "Vegvesen DATEX reisetid",
  state: "ok",
  lastCheckedAt: "2026-05-28T10:00:00.000Z",
  detail: "Travel time feed available",
} satisfies SourceHealth;

const _operationsStatusTypeCheck = {
  sources: [_sourceHealthTypeCheck],
  articleCount: 0,
  situationCounts: {
    preliminary: 0,
    active: 0,
    resolved: 0,
    dismissed: 0,
  },
  trafficPulse: [_trafficPulseCorridorTypeCheck],
} satisfies OperationsStatus;

void _trafficPulseCorridorTypeCheck;
void _operationsStatusTypeCheck;

describe("DATEX travel time shared types", () => {
  it("exposes a dedicated source-health id for traffic pulse", () => {
    expect(_sourceHealthTypeCheck.source).toBe("datex_travel_time");
  });
});
