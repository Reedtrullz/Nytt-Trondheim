import { describe, expect, it } from "vitest";
import { categorize, detectScope, extractPlaces } from "../src/classify.js";
import { detectPreliminarySituations } from "../src/clusters.js";
import type { Article } from "@nytt/shared";
import type { OfficialEvent } from "@nytt/shared";

describe("Trondheim relevance classification", () => {
  it("routes city stories to Trondheim", () => {
    expect(detectScope("Varsel om veiarbeid i Innherredsveien i Trondheim")).toBe("trondheim");
  });

  it("keeps regional weather separate", () => {
    expect(detectScope("Farevarsel for kraftig regn i Trøndelag")).toBe("trondelag");
  });

  it("categorizes incident stories and extracts public place names", () => {
    expect(categorize("Skogbrann i Bymarka")).toBe("Hendelser");
    expect(extractPlaces("Skogbrann i Bymarka ved Granåsen")).toEqual(["Bymarka", "Granåsen"]);
    expect(categorize("Ny skole åpner i Trondheim")).toBe("Nyheter");
  });

  it("opens only multi-source preliminary incident candidates", () => {
    const base: Article = {
      id: "one",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Brann i Bymarka",
      excerpt: "Røyk er omtalt i Bymarka.",
      url: "https://example.test/one",
      publishedAt: "2026-05-26T12:00:00Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Bymarka"],
    };
    const situations = detectPreliminarySituations([
      { ...base, location: { label: "Bymarka", lat: 63.4094, lng: 10.26072 } },
      {
        ...base,
        id: "two",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        url: "https://example.test/two",
      },
    ]);
    expect(situations).toHaveLength(1);
    expect(situations[0]?.verificationStatus).toBe("Foreløpig fra rapportering");
    expect(situations[0]?.type).toBe("fire");
    expect(situations[0]?.incidentSignature).toBe("fire:bymarka");
    expect(situations[0]?.features[0]?.properties.provenance).toBe("reporting_estimate");
    expect(situations[0]?.features[0]?.geometry.type).toBe("Point");
  });

  it("does not merge independent reporting outside the 12 hour activation window", () => {
    const base: Article = {
      id: "one",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Brann i Bymarka",
      excerpt: "Røyk er omtalt i Bymarka.",
      url: "https://example.test/one",
      publishedAt: "2026-05-26T12:00:00Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Bymarka"],
    };
    expect(
      detectPreliminarySituations([
        base,
        {
          ...base,
          id: "old",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          url: "https://example.test/old",
          publishedAt: "2026-05-25T12:00:00Z",
        },
      ]),
    ).toHaveLength(0);
  });

  it("does not cluster unrelated general Trondheim stories as an incident", () => {
    const common = {
      publishedAt: "2026-05-27T15:00:00Z",
      scope: "trondheim" as const,
      places: ["Trondheim"],
    };
    expect(
      detectPreliminarySituations([
        {
          ...common,
          id: "complaint",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Trondheim får ikke klage mer - trues med bot",
          excerpt: "En administrativ sak.",
          url: "https://example.test/complaint",
          category: "Nyheter",
        },
        {
          ...common,
          id: "break-in",
          source: "nrk",
          sourceLabel: "NRK",
          title: "Innbrudd på Møllenberg",
          excerpt: "En sak omtalt i Trondheim.",
          url: "https://example.test/break-in",
          category: "Hendelser",
        },
      ]),
    ).toHaveLength(0);
  });

  it("does not turn unrelated building and burglary reporting into traffic disruption", () => {
    const common = {
      publishedAt: "2026-05-27T14:00:00Z",
      scope: "trondheim" as const,
      places: ["Trondheim"],
      category: "Transport" as const,
    };
    expect(
      detectPreliminarySituations([
        {
          ...common,
          id: "building",
          source: "nrk",
          sourceLabel: "NRK",
          title: "Sintef med nytt bygg på Tiller i Trondheim",
          excerpt: "Nytt bygg.",
          url: "https://example.test/building",
        },
        {
          ...common,
          id: "burglary",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Innbruddsmelding i Trondheim",
          excerpt: "Melding om innbrudd.",
          url: "https://example.test/burglary",
        },
      ]),
    ).toHaveLength(0);
  });

  it("adds later matching updates to an already activated incident signature", () => {
    const existing = detectPreliminarySituations([
      {
        id: "first",
        source: "nrk",
        sourceLabel: "NRK",
        title: "Brann i Bymarka",
        excerpt: "Brann i Bymarka.",
        url: "https://example.test/first",
        publishedAt: "2026-05-25T08:00:00Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Bymarka"],
      },
      {
        id: "second",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Brann i Bymarka",
        excerpt: "Brann i Bymarka.",
        url: "https://example.test/second",
        publishedAt: "2026-05-25T08:10:00Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Bymarka"],
      },
    ])[0]!;
    const updates = detectPreliminarySituations(
      [
        {
          id: "later",
          source: "trondheim_kommune",
          sourceLabel: "Trondheim kommune",
          title: "Brann i Bymarka er slukket",
          excerpt: "Kommunen melder at brannen er slukket.",
          url: "https://example.test/later",
          publishedAt: "2026-05-27T08:00:00Z",
          scope: "trondheim",
          category: "Hendelser",
          places: ["Bymarka"],
        },
      ],
      [],
      [existing],
    );
    expect(updates[0]?.id).toBe(existing.id);
    expect(updates[0]?.status).toBe("resolved");
  });

  it("uses a matching municipality report as official corroboration", () => {
    const reports: Article[] = [
      {
        id: "nrk",
        source: "nrk",
        sourceLabel: "NRK",
        title: "Brann i Bymarka",
        excerpt: "Brann omtalt i Bymarka.",
        url: "https://example.test/nrk",
        publishedAt: "2026-05-26T12:00:00Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Bymarka"],
      },
      {
        id: "kommune",
        source: "trondheim_kommune",
        sourceLabel: "Trondheim kommune",
        title: "Brann i Bymarka",
        excerpt: "Kommunen bekrefter hendelsen i Bymarka.",
        url: "https://example.test/kommune",
        publishedAt: "2026-05-26T12:10:00Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Bymarka"],
      },
    ];
    const situation = detectPreliminarySituations(reports)[0];
    expect(situation?.status).toBe("active");
    expect(situation?.verificationStatus).toBe("Offentlig bekreftet");
  });

  it("attaches official warning geometry without confirming a reported fire", () => {
    const reports: Article[] = [
      {
        id: "nrk",
        source: "nrk",
        sourceLabel: "NRK",
        title: "Brann i Bymarka",
        excerpt: "Røyk i Bymarka.",
        url: "https://example.test/nrk",
        publishedAt: "2026-05-26T12:00:00Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Bymarka"],
        location: { lat: 63.41, lng: 10.26, label: "Bymarka" },
      },
      {
        id: "adressa",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Brann i Bymarka",
        excerpt: "Røyk i Bymarka.",
        url: "https://example.test/adressa",
        publishedAt: "2026-05-26T12:10:00Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Bymarka"],
      },
    ];
    const warning: OfficialEvent = {
      id: "met-fire",
      source: "met",
      eventType: "fire",
      title: "Skogbrannfare",
      detail: "Oransje farevarsel.",
      sourceUrl: "https://api.met.no/",
      areaLabel: "Trøndelag",
      state: "active",
      publishedAt: "2026-05-26T11:00:00Z",
      validFrom: "2026-05-26T11:00:00Z",
      validTo: "2099-05-27T11:00:00Z",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [10.2, 63.3],
            [10.4, 63.3],
            [10.4, 63.5],
            [10.2, 63.5],
            [10.2, 63.3],
          ],
        ],
      },
      raw: {},
    };
    const situation = detectPreliminarySituations(reports, [warning])[0];
    expect(situation?.status).toBe("preliminary");
    expect(situation?.features.some((feature) => feature.properties.layer === "warning")).toBe(
      true,
    );
  });
});
