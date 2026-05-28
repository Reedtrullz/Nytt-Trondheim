import { describe, expect, it } from "vitest";
import type { OfficialEvent } from "@nytt/shared";
import {
  officialTrafficSituationsFromEvents,
  resolvedOfficialTrafficSituationsForMissingDatex,
} from "../src/clusters.js";

const datexEvent: OfficialEvent = {
  id: "datex-e6-tiller",
  source: "datex",
  eventType: "traffic",
  title: "Trafikkulykke på E6 ved Tiller",
  detail: "Trafikkulykke på E6 ved Tiller. Ett felt stengt.",
  sourceUrl: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
  areaLabel: "E6 Tiller",
  state: "active",
  severity: "high",
  publishedAt: "2026-05-28T10:00:00.000Z",
  validFrom: "2026-05-28T09:55:00.000Z",
  validTo: "2026-05-28T12:00:00.000Z",
  geometry: { type: "Point", coordinates: [10.376, 63.361] },
  raw: { datex: { promoteToSituation: true, impact: "high", roadNumber: "E6" } },
};

describe("official traffic situation promotion", () => {
  it("creates an official active traffic situation from a promotable DATEX event", () => {
    const [situation] = officialTrafficSituationsFromEvents([datexEvent], []);

    expect(situation).toMatchObject({
      type: "traffic",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      locationLabel: "E6 Tiller",
      officialSource: "datex",
      officialEventId: "datex-e6-tiller",
      activationBasis: { rule: "official_source", sourceIds: ["datex"], articleIds: [] },
    });
    expect(situation?.evidence[0]).toMatchObject({
      source: "datex",
      sourceLabel: "Statens vegvesen DATEX",
      provenance: "official",
      confidence: 1,
    });
    expect(situation?.features[0]).toMatchObject({
      geometry: { type: "Point", coordinates: [10.376, 63.361] },
      properties: { provenance: "official", sourceLabel: "Statens vegvesen DATEX" },
    });
  });

  it("does not promote low-impact DATEX roadworks", () => {
    const low = { ...datexEvent, id: "datex-low", raw: { datex: { promoteToSituation: false } } };
    expect(officialTrafficSituationsFromEvents([low], [])).toEqual([]);
  });

  it("does not reuse a non-DATEX situation with a matching official event id", () => {
    const [existing] = officialTrafficSituationsFromEvents([datexEvent], []);
    const nonDatexExisting = {
      ...existing!,
      id: "non-datex-existing",
      officialSource: undefined,
      officialEventId: datexEvent.id,
      createdAt: "2026-05-28T00:00:00.000Z",
      activationBasis: {
        rule: "two_independent_sources",
        sourceIds: ["nrk", "adressa"],
        articleIds: ["nrk-1", "adressa-1"],
        activatedAt: "2026-05-28T00:00:00.000Z",
      },
    };

    const [situation] = officialTrafficSituationsFromEvents([datexEvent], [nonDatexExisting]);

    expect(situation?.id).not.toBe("non-datex-existing");
    expect(situation?.createdAt).toBe(datexEvent.validFrom);
    expect(situation?.activationBasis?.rule).toBe("official_source");
  });

  it("resolves active DATEX situations whose official event is missing from the latest snapshot", () => {
    const [existing] = officialTrafficSituationsFromEvents([datexEvent], []);
    const [resolved] = resolvedOfficialTrafficSituationsForMissingDatex(
      [existing!],
      new Set<string>(),
      "2026-05-28T10:30:00.000Z",
    );

    expect(resolved).toMatchObject({
      id: existing?.id,
      status: "resolved",
      updatedAt: "2026-05-28T10:30:00.000Z",
    });
    expect(resolved?.timeline.at(-1)).toMatchObject({
      title: "DATEX-hendelsen er ikke lenger aktiv",
      official: true,
    });
  });
});
