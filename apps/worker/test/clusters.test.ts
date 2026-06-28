import { describe, expect, it } from "vitest";
import type { Article, OfficialEvent, Situation } from "@nytt/shared";
import {
  detectPreliminarySituations,
  officialTrafficSituationsFromEvents,
  promotableDatexEventIds,
  resolvedDuplicateOfficialTrafficSituationsForMergedDatex,
  resolvedNonPromotableOfficialTrafficSituations,
  resolvedOfficialTrafficSituationsForMissingDatex,
} from "../src/clusters.js";
import { promotableDatexEvent } from "./fixtures/incident-fixtures.js";

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

  it("can promote high-impact official DATEX traffic without an article", () => {
    const situations = officialTrafficSituationsFromEvents([
      promotableDatexEvent("datex-high-impact"),
    ]);

    expect(situations).toHaveLength(1);
    expect(situations[0]).toMatchObject({
      status: "active",
      type: "traffic",
      verificationStatus: "Offentlig bekreftet",
      officialSource: "datex",
      officialEventId: "datex-high-impact",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
      },
    });
    expect(situations[0]?.relatedArticleIds).toEqual([]);
    expect(situations[0]?.evidence[0]?.source).toBe("datex");
  });

  it("deduplicates multiple DATEX records from the same upstream situation", () => {
    const obstruction: OfficialEvent = {
      ...datexEvent,
      id: "datex-landslide-obstruction",
      title: "Jordskred, vegen er stengt",
      detail: "Jordskred, vegen er stengt.",
      raw: {
        datex: {
          promoteToSituation: true,
          impact: "high",
          situationId: "NPRA_HBT_11-04-2025.68022",
          recordKind: "ns12:EnvironmentalObstruction",
        },
      },
    };
    const rerouting: OfficialEvent = {
      ...datexEvent,
      id: "datex-landslide-rerouting",
      title: "Omkjøring er skiltet",
      detail: "Omkjøring er skiltet.",
      raw: {
        datex: {
          promoteToSituation: true,
          impact: "high",
          situationId: "NPRA_HBT_11-04-2025.68022",
          recordKind: "ns12:ReroutingManagement",
        },
      },
    };
    const management: OfficialEvent = {
      ...datexEvent,
      id: "datex-landslide-management",
      title: "Vegen er stengt for gjennomkjøring",
      detail: "Vegen er stengt for gjennomkjøring.",
      raw: {
        datex: {
          promoteToSituation: true,
          impact: "high",
          situationId: "NPRA_HBT_11-04-2025.68022",
          recordKind: "ns12:RoadOrCarriagewayOrLaneManagement",
        },
      },
    };

    const situations = officialTrafficSituationsFromEvents(
      [rerouting, management, obstruction],
      [],
    );

    expect(situations).toHaveLength(1);
    expect(situations[0]).toMatchObject({
      title: "Jordskred, vegen er stengt",
      incidentSignature: "datex:NPRA_HBT_11-04-2025.68022",
      officialEventId: "datex-landslide-obstruction",
      importance: "high",
    });
    expect(situations[0]?.evidence.map((item) => item.claim).sort()).toEqual([
      "Jordskred, vegen er stengt",
      "Omkjøring er skiltet",
      "Vegen er stengt for gjennomkjøring",
    ]);
  });

  it("links matching article progress to long-running DATEX road closures", () => {
    const gangasDatex: OfficialEvent = {
      ...datexEvent,
      id: "datex-gangas-landslide",
      title: "Steinskred/steinsprang, vegen er stengt",
      detail: "Steinskred/steinsprang, vegen er stengt.",
      areaLabel: "Gangåsvegen",
      publishedAt: "2026-06-28T13:48:09.000Z",
      validFrom: "2026-03-26T10:31:13.000Z",
      validTo: "2026-07-08T07:00:00.000Z",
      raw: {
        datex: {
          promoteToSituation: true,
          impact: "high",
          version: "8",
          situationId: "NPRA_HBT_26-03-2026.53267",
          recordKind: "ns12:EnvironmentalObstruction",
          roadName: "Gangåsvegen",
          roadNumber: "K1810",
          situationRecordVersionTime: "2026-06-08T06:48:12.327Z",
          publicationTime: "2026-06-28T13:48:09.000Z",
        },
      },
    };
    const article: Article = {
      id: "adressa-gangas",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Ti meter stort ras - kan bli stengt i flere uker",
      excerpt:
        "Onsdag kveld gikk det et ras med steiner og løsmasser på Gangåsveien i Orkland. Nå er en strekning på cirka 100 meter stengt.",
      url: "https://www.adressa.no/nyhetsstudio/i/k00ejA/ti-meter-stort-ras-kan-bli-stengt-i-flere-uker",
      publishedAt: "2026-03-28T20:28:47.000Z",
      scope: "trondelag",
      category: "Transport",
      places: ["Gangåsvegen", "Orkland"],
    };

    const [situation] = officialTrafficSituationsFromEvents([gangasDatex], [], [article]);

    expect(situation?.relatedArticleIds).toEqual(["adressa-gangas"]);
    expect(situation?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "adressa",
          claim: "Ti meter stort ras - kan bli stengt i flere uker",
          provenance: "reporting_estimate",
        }),
      ]),
    );
    expect(situation?.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "timeline-related-adressa-gangas",
          title: "Ti meter stort ras - kan bli stengt i flere uker",
          official: false,
        }),
        expect.objectContaining({
          kind: "official_update",
          source: "datex",
          official: true,
        }),
      ]),
    );
    expect(situation?.timeline[0]?.id).not.toBe("timeline-datex-gangas-landslide");
  });

  it("does not link generic slide reporting without a shared official road or place", () => {
    const article: Article = {
      id: "adressa-other-slide",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Ti meter stort ras - kan bli stengt i flere uker",
      excerpt: "Raset gikk på en kommunal vei i en annen del av Trøndelag.",
      url: "https://example.test/other",
      publishedAt: "2026-03-28T20:28:47.000Z",
      scope: "trondelag",
      category: "Transport",
      places: ["Orkland"],
    };

    const [situation] = officialTrafficSituationsFromEvents([datexEvent], [], [article]);

    expect(situation?.relatedArticleIds).toEqual([]);
    expect(
      situation?.timeline.some((entry) => entry.id === "timeline-related-adressa-other-slide"),
    ).toBe(false);
  });

  it("resolves legacy DATEX record-level duplicates after merging by upstream situation", () => {
    const legacy = (id: string, officialEventId: string): Situation => ({
      id,
      type: "traffic",
      title: `Legacy ${officialEventId}`,
      summary: "Legacy DATEX record-level situation.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      updatedAt: "2026-05-28T10:00:00.000Z",
      createdAt: "2026-05-28T09:55:00.000Z",
      locationLabel: "E6 Tiller",
      incidentSignature: `datex:${officialEventId}`,
      detectionVersion: "datex-1",
      officialSource: "datex",
      officialEventId,
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: "2026-05-28T10:00:00.000Z",
      },
      relatedArticleIds: [],
      evidence: [],
      features: [],
      timeline: [],
    });
    const obstruction: OfficialEvent = {
      ...datexEvent,
      id: "datex-landslide-obstruction",
      raw: {
        datex: {
          promoteToSituation: true,
          impact: "high",
          situationId: "NPRA_HBT_11-04-2025.68022",
          recordKind: "ns12:EnvironmentalObstruction",
        },
      },
    };
    const rerouting: OfficialEvent = {
      ...datexEvent,
      id: "datex-landslide-rerouting",
      title: "Omkjøring er skiltet",
      raw: {
        datex: {
          promoteToSituation: true,
          impact: "high",
          situationId: "NPRA_HBT_11-04-2025.68022",
          recordKind: "ns12:ReroutingManagement",
        },
      },
    };
    const existing = [
      legacy("datex-old-primary", obstruction.id),
      legacy("datex-old-rerouting", rerouting.id),
    ];
    const active = officialTrafficSituationsFromEvents([rerouting, obstruction], existing);
    const resolved = resolvedDuplicateOfficialTrafficSituationsForMergedDatex(
      existing,
      promotableDatexEventIds([obstruction, rerouting]),
      new Set(active.map((situation) => situation.id)),
      "2026-05-28T10:30:00.000Z",
    );

    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe("datex-old-primary");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      id: "datex-old-rerouting",
      status: "resolved",
      updatedAt: "2026-05-28T10:30:00.000Z",
    });
    expect(resolved[0]?.timeline.at(-1)).toMatchObject({
      title: "DATEX-delhendelse er samlet i en hovedsituasjon",
      official: true,
    });
  });

  it("resolves active DATEX situations when their event no longer qualifies for promotion", () => {
    const [existing] = officialTrafficSituationsFromEvents([datexEvent], []);
    const demoted: OfficialEvent = {
      ...datexEvent,
      raw: { datex: { promoteToSituation: false, impact: "normal" } },
    };

    const resolved = resolvedNonPromotableOfficialTrafficSituations(
      [existing!],
      new Set([demoted.id]),
      promotableDatexEventIds([demoted]),
      new Set<string>(),
      "2026-06-18T08:45:00.000Z",
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      id: existing?.id,
      status: "resolved",
      updatedAt: "2026-06-18T08:45:00.000Z",
    });
    expect(resolved[0]?.timeline.at(-1)).toMatchObject({
      title: "DATEX-hendelsen vises ikke lenger som aktiv situasjon",
      detail:
        "DATEX-posten er fortsatt tilgjengelig som trafikkontekst, men oppfyller ikke lenger terskelen for automatisk situasjonsrom.",
      official: true,
    });
  });

  it("does not promote low-impact DATEX roadworks", () => {
    const low = { ...datexEvent, id: "datex-low", raw: { datex: { promoteToSituation: false } } };
    expect(officialTrafficSituationsFromEvents([low], [])).toEqual([]);
  });

  it("does not promote stale raw flags for low-impact animal obstructions", () => {
    const animal: OfficialEvent = {
      ...datexEvent,
      id: "datex-animal",
      title: "Dyr",
      detail: "Dyr.",
      severity: "low",
      areaLabel: "Kvamsvegen",
      raw: {
        datex: {
          impact: "high",
          promoteToSituation: true,
          recordKind: "EnvironmentalObstruction",
        },
      },
    };

    expect(promotableDatexEventIds([animal])).toEqual(new Set());
    expect(officialTrafficSituationsFromEvents([animal], [])).toEqual([]);
  });

  it("does not reuse a non-DATEX situation with a matching official event id", () => {
    const [existing] = officialTrafficSituationsFromEvents([datexEvent], []);
    const nonDatexExisting: Situation = {
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

  it("does not treat DATEX traffic events as MET/NVE warning context", () => {
    const base: Article = {
      id: "nrk-tiller",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Trafikkulykke på E6 ved Tiller",
      excerpt: "Trafikkulykke ved Tiller skaper kø på E6.",
      url: "https://example.test/nrk-tiller",
      publishedAt: "2026-05-28T10:00:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["Tiller"],
      location: { label: "Tiller", lat: 63.361, lng: 10.376 },
    };
    const situations = detectPreliminarySituations(
      [
        base,
        {
          ...base,
          id: "adressa-tiller",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          url: "https://example.test/adressa-tiller",
          publishedAt: "2026-05-28T10:10:00.000Z",
        },
      ],
      [datexEvent],
      [],
    );

    expect(situations).toHaveLength(1);
    expect(situations[0]?.features.some((feature) => feature.properties.layer === "warning")).toBe(
      false,
    );
    expect(
      situations[0]?.evidence.some((evidence) => evidence.claimType === "official_warning_context"),
    ).toBe(false);
  });
});
