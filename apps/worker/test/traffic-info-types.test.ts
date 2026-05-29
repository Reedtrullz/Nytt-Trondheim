import type { SourceHealth, SourceItemInput, TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";

const _trafficInfoHealth = {
  source: "vegvesen_traffic_info",
  label: "Vegvesen trafikkmeldinger",
  state: "ok",
  detail: "1 trafikkmelding hentet",
} satisfies SourceHealth;

const _trafficInfoSourceItem = {
  id: "source:test",
  provider: "vegvesen_traffic_info",
  kind: "official_event",
  externalId: "NPRA_HBT_1",
  title: "Fv. 6650 Vestre Kystad",
  fetchedAt: "2026-05-29T11:00:00.000Z",
  captureHash: "abc",
  rawPayload: {},
  normalizedPayload: {},
  reliabilityTier: "official",
} satisfies SourceItemInput;

const _trafficInfoMapEvent = {
  id: "vegvesen-traffic-info:NPRA_HBT_1",
  source: "vegvesen_traffic_info",
  sourceEventId: "NPRA_HBT_1",
  category: "roadworks",
  severity: "medium",
  state: "active",
  title: "Fv. 6650 Vestre Kystad",
  updatedAt: "2026-05-29T11:00:00.000Z",
  geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
} satisfies TrafficMapEvent;

void _trafficInfoHealth;
void _trafficInfoSourceItem;
void _trafficInfoMapEvent;

describe("TrafficInfo shared source types", () => {
  it("accepts Vegvesen TrafficInfo as a shared source", () => {
    expect(true).toBe(true);
  });
});
