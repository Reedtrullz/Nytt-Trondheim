import type { TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it, vi } from "vitest";
import {
  collectTrafficInfoForMap,
  createCollectionGuard,
  normalizeDatexSituationEndpoint,
  shouldResolveMissingDatexSituations,
} from "../src/index.js";

function trafficInfoEvent(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "vegvesen-traffic-info:NPRA_HBT_1",
    source: "vegvesen_traffic_info",
    sourceEventId: "NPRA_HBT_1",
    category: "roadworks",
    severity: "medium",
    state: "active",
    title: "Fv. 6650 Vestre Kystad",
    description: "Lysregulering.",
    locationName: "Fv. 6650 Vestre Kystad, Trondheim",
    roadName: "Fv. 6650",
    validFrom: "2026-04-21T05:00:00.000Z",
    validTo: "2026-06-26T14:00:00.000Z",
    updatedAt: "2026-05-07T04:59:25.000Z",
    sourceUrl: "https://www.vegvesen.no/trafikk/hvaskjer?lat=63.38945&lng=10.345405&zoom=14",
    geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
    rawType: "roadworks",
    confidence: 1,
    ...overrides,
  };
}

function fakeTrafficInfoRepository() {
  return {
    upsertTrafficMapEvents: vi.fn().mockResolvedValue(undefined),
    upsertTrafficInfoSourceItems: vi.fn().mockResolvedValue(undefined),
    markMissingTrafficMapEventsExpired: vi.fn().mockResolvedValue(4),
    expireStaleOpenEndedTrafficMapEvents: vi.fn().mockResolvedValue(5),
    setCollectorState: vi.fn().mockResolvedValue(undefined),
    setHealth: vi.fn().mockResolvedValue(undefined),
  };
}

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

describe("TrafficInfo worker collection", () => {
  it("persists map events, mirrors source items, expires missing rows, stores hash and records ok health", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const activeEvent = trafficInfoEvent();
    const plannedEvent = trafficInfoEvent({
      id: "vegvesen-traffic-info:NPRA_HBT_2",
      sourceEventId: "NPRA_HBT_2",
      state: "planned",
      title: "E6 planlagt vegarbeid",
      updatedAt: "2026-05-29T10:59:00.000Z",
    });
    const rawActiveMessage = { id: "NPRA_HBT_1", publicCommentDescription: "Lysregulering." };
    const rawPlannedMessage = { id: "NPRA_HBT_2", publicCommentDescription: "Planlagt arbeid." };
    const repository = fakeTrafficInfoRepository();
    const collector = vi.fn().mockResolvedValue({
      events: [activeEvent, plannedEvent],
      rawMessagesById: new Map([
        ["NPRA_HBT_1", rawActiveMessage],
        ["NPRA_HBT_2", rawPlannedMessage],
      ]),
      sourcePayloadHash: "traffic-info-hash",
      totalMessages: 3,
      relevantMessages: 2,
    });

    await collectTrafficInfoForMap({
      repository: repository as never,
      endpoint: "https://traffic-info.example.test/messages",
      nextPollAt,
      now: () => new Date(checkedAt),
      collector,
    });

    expect(collector).toHaveBeenCalledWith({
      endpoint: "https://traffic-info.example.test/messages",
      now: expect.any(Function),
    });
    expect(repository.upsertTrafficMapEvents).toHaveBeenCalledWith([activeEvent, plannedEvent], {
      source: "vegvesen_traffic_info",
      fetchedAt: checkedAt,
    });
    expect(repository.upsertTrafficInfoSourceItems).toHaveBeenCalledTimes(1);
    const sourceItems = repository.upsertTrafficInfoSourceItems.mock.calls[0]?.[0];
    expect(sourceItems).toHaveLength(2);
    expect(sourceItems).toMatchObject([
      {
        provider: "vegvesen_traffic_info",
        kind: "official_event",
        externalId: "NPRA_HBT_1",
        normalizedPayload: activeEvent,
        rawPayload: rawActiveMessage,
        fetchedAt: checkedAt,
      },
      {
        provider: "vegvesen_traffic_info",
        kind: "official_event",
        externalId: "NPRA_HBT_2",
        normalizedPayload: plannedEvent,
        rawPayload: rawPlannedMessage,
        fetchedAt: checkedAt,
      },
    ]);
    expect(repository.markMissingTrafficMapEventsExpired).toHaveBeenCalledWith(
      "vegvesen_traffic_info",
      ["NPRA_HBT_1", "NPRA_HBT_2"],
      checkedAt,
    );
    expect(repository.expireStaleOpenEndedTrafficMapEvents).toHaveBeenCalledWith(
      "vegvesen_traffic_info",
      checkedAt,
      7 * 24,
    );
    expect(repository.setCollectorState).toHaveBeenCalledWith(
      "vegvesen_traffic_info:lastHash",
      "traffic-info-hash",
    );
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail:
        "2 relevante av 3 Vegvesen trafikkmeldinger hentet (1 aktive, 1 planlagte, 4 utløpt fra snapshot, 5 stale utløpt)",
    });
    expect(
      repository.markMissingTrafficMapEventsExpired.mock.invocationCallOrder[0],
    ).toBeGreaterThan(repository.upsertTrafficInfoSourceItems.mock.invocationCallOrder[0] ?? 0);
    expect(
      repository.expireStaleOpenEndedTrafficMapEvents.mock.invocationCallOrder[0],
    ).toBeGreaterThan(repository.markMissingTrafficMapEventsExpired.mock.invocationCallOrder[0] ?? 0);
  });

  it("records degraded health and skips expiry when TrafficInfo collection fails", async () => {
    const checkedAt = "2026-05-29T11:15:00.000Z";
    const nextPollAt = "2026-05-29T11:25:00.000Z";
    const repository = fakeTrafficInfoRepository();
    const collector = vi.fn().mockRejectedValue(new Error("upstream unavailable"));

    await collectTrafficInfoForMap({
      repository: repository as never,
      endpoint: "https://traffic-info.example.test/messages",
      nextPollAt,
      now: () => new Date(checkedAt),
      collector,
    });

    expect(repository.upsertTrafficMapEvents).not.toHaveBeenCalled();
    expect(repository.upsertTrafficInfoSourceItems).not.toHaveBeenCalled();
    expect(repository.markMissingTrafficMapEventsExpired).not.toHaveBeenCalled();
    expect(repository.expireStaleOpenEndedTrafficMapEvents).not.toHaveBeenCalled();
    expect(repository.setCollectorState).not.toHaveBeenCalled();
    expect(repository.setHealth).toHaveBeenCalledWith({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "degraded",
      lastCheckedAt: checkedAt,
      lastFailureAt: checkedAt,
      nextPollAt,
      detail: "TrafficInfo-innhenting feilet: Error: upstream unavailable",
    });
  });
});
