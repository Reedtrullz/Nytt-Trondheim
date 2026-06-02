import { describe, expect, it } from "vitest";
import { canonicalPlaceName, categorize, detectScope, extractPlaces } from "../src/classify.js";
import { detectPreliminarySituations } from "../src/clusters.js";
import type { Article } from "@nytt/shared";
import type { OfficialEvent } from "@nytt/shared";
import { dismissedSituation, incidentArticle, warningEvent } from "./fixtures/incident-fixtures.js";

describe("Trondheim relevance classification", () => {
  it("routes city stories to Trondheim", () => {
    expect(detectScope("Varsel om veiarbeid i Innherredsveien i Trondheim")).toBe("trondheim");
  });

  it("keeps regional weather separate", () => {
    expect(detectScope("Farevarsel for kraftig regn i Trøndelag")).toBe("trondelag");
  });

  it("does not match Trondheim place names inside unrelated words", () => {
    const text =
      "- Himmelen lyste opp - Jeg kjente en vegg av varm luft, sier Laurentio Mardare til Dagbladet. To av naboene hans ble skadd da en drone traff en boligblokk i Ukraina.";

    expect(detectScope(text)).toBeUndefined();
    expect(extractPlaces(text)).toEqual([]);
  });

  it("categorizes incident stories and extracts public place names", () => {
    expect(categorize("Skogbrann i Bymarka")).toBe("Hendelser");
    expect(extractPlaces("Skogbrann i Bymarka ved Granåsen")).toEqual(["Bymarka", "Granåsen"]);
    expect(categorize("Ny skole åpner i Trondheim")).toBe("Nyheter");
  });

  it("prefers a specific district over the generic city when placing a story", () => {
    expect(extractPlaces("Brann i Bymarka i Trondheim")).toEqual(["Bymarka", "Trondheim"]);
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

  it("does not attach late ordinary reporting to a stale open case", () => {
    const activated = detectPreliminarySituations([
      incidentArticle("first", "nrk", "2026-05-20T08:00:00Z"),
      incidentArticle("second", "adressa", "2026-05-20T08:10:00Z"),
    ])[0]!;
    const updates = detectPreliminarySituations(
      [incidentArticle("late", "nrk", "2026-05-27T08:00:00Z")],
      [],
      [activated],
    );
    expect(updates).toEqual([]);
  });

  it("creates a new qualified incident after a resolved same-place case", () => {
    const oldCase = {
      ...detectPreliminarySituations([
        incidentArticle("old-one", "nrk", "2026-05-20T08:00:00Z"),
        incidentArticle("old-two", "adressa", "2026-05-20T08:10:00Z"),
      ])[0]!,
      status: "resolved" as const,
    };
    const newCases = detectPreliminarySituations(
      [
        incidentArticle("new-one", "nrk", "2026-05-27T08:00:00Z"),
        incidentArticle("new-two", "adressa", "2026-05-27T08:10:00Z"),
      ],
      [],
      [oldCase],
    );
    expect(newCases).toHaveLength(1);
    expect(newCases[0]?.id).not.toBe(oldCase.id);
    expect(newCases[0]?.relatedArticleIds).toEqual(["new-two", "new-one"]);
  });

  it("allows a real incident after an earlier dismissed same-place candidate", () => {
    const dismissed = {
      ...detectPreliminarySituations([
        incidentArticle("dismissed-one", "nrk", "2026-05-20T08:00:00Z"),
        incidentArticle("dismissed-two", "adressa", "2026-05-20T08:10:00Z"),
      ])[0]!,
      status: "dismissed" as const,
      dismissalReason: "false_positive" as const,
    };
    const newCases = detectPreliminarySituations(
      [
        incidentArticle("fresh-one", "nrk", "2026-05-27T08:00:00Z"),
        incidentArticle("fresh-two", "adressa", "2026-05-27T08:10:00Z"),
      ],
      [],
      [dismissed],
    );
    expect(newCases).toHaveLength(1);
    expect(newCases[0]?.id).not.toBe(dismissed.id);
  });

  it("does not merge different events only because they mention the same place", () => {
    const situations = detectPreliminarySituations([
      incidentArticle("garage-one", "nrk", "2026-06-02T08:00:00Z", {
        title: "Garasjebrann på Tiller",
        excerpt: "Nødetatene rykket ut til brann i garasje ved Tonstad.",
        places: ["Tiller"],
      }),
      incidentArticle("garage-two", "adressa", "2026-06-02T08:05:00Z", {
        title: "Garasjebrann på Tiller",
        excerpt: "Brann i garasje ved Tonstad.",
        places: ["Tiller"],
      }),
      incidentArticle("shed-one", "vg", "2026-06-02T08:10:00Z", {
        title: "Bodbrann på Tiller",
        excerpt: "Brannvesenet melder om separat brann i bod ved City Syd.",
        places: ["Tiller"],
      }),
      incidentArticle("shed-two", "dagbladet", "2026-06-02T08:12:00Z", {
        title: "Bodbrann på Tiller",
        excerpt: "Politiet omtaler en annen brann i bod ved City Syd.",
        places: ["Tiller"],
      }),
    ]);

    expect(situations).toHaveLength(2);
    expect(situations.map((situation) => situation.relatedArticleIds.join(",")).sort()).toEqual([
      "garage-two,garage-one",
      "shed-two,shed-one",
    ]);
  });

  it("detects compound-only fire headlines and merges matching phrase variants", () => {
    const situations = detectPreliminarySituations([
      incidentArticle("car-fire-one", "nrk", "2026-06-02T09:00:00Z", {
        title: "Bilbrann på Tiller",
        excerpt: "Røyk fra kjøretøy ved City Syd.",
        places: ["Tiller"],
      }),
      incidentArticle("car-fire-two", "adressa", "2026-06-02T09:05:00Z", {
        title: "Brann i bil på Tiller",
        excerpt: "Brannvesenet jobber ved City Syd.",
        places: ["Tiller"],
      }),
    ]);

    expect(situations).toHaveLength(1);
    expect(situations[0]?.type).toBe("fire");
    expect(situations[0]?.incidentSignature).toBe("fire:tiller:bilbrann");
    expect(situations[0]?.relatedArticleIds).toEqual(["car-fire-two", "car-fire-one"]);
  });

  it("canonicalizes only explicitly listed local place aliases", () => {
    expect(extractPlaces("Trafikkulykke på Kroppanbrua")).toEqual(["Kroppanbrua"]);
    expect(extractPlaces("Kollisjon på Kroppan bru")).toEqual(["Kroppan bru"]);
    expect(canonicalPlaceName("Kroppanbrua")).toBe("Kroppan Bru");
    expect(canonicalPlaceName("Kroppan bru")).toBe("Kroppan Bru");
    expect(canonicalPlaceName("Bymarka")).toBe("Bymarka");
    expect(canonicalPlaceName("Trondheim")).toBe("Trondheim");
  });

  it("merges the same event when articles use canonical local place aliases", () => {
    const situations = detectPreliminarySituations([
      incidentArticle("kroppan-one", "nrk", "2026-06-02T10:00:00Z", {
        title: "Trafikkulykke på Kroppanbrua",
        excerpt: "En kollisjon gir kø ved Kroppanbrua.",
        category: "Transport",
        places: ["Kroppanbrua"],
      }),
      incidentArticle("kroppan-two", "adressa", "2026-06-02T10:05:00Z", {
        title: "Kollisjon på Kroppan bru",
        excerpt: "Ulykken omtales ved Kroppan bru.",
        category: "Transport",
        places: ["Kroppan bru"],
      }),
    ]);

    expect(situations).toHaveLength(1);
    expect(situations[0]?.incidentSignature).toBe("traffic:kroppan-bru");
    expect(situations[0]?.locationLabel).toBe("Kroppan Bru");
  });

  it("does not activate from a broad Trondheim-only incident mention", () => {
    const situations = detectPreliminarySituations([
      incidentArticle("broad-one", "nrk", "2026-06-02T11:00:00Z", {
        title: "Ulykke i Trondheim",
        excerpt: "Politiet omtaler en ulykke i Trondheim uten mer presis stedfesting.",
        places: ["Trondheim"],
      }),
      incidentArticle("broad-two", "adressa", "2026-06-02T11:03:00Z", {
        title: "Ulykke i Trondheim",
        excerpt: "Nødetatene er varslet om ulykke i Trondheim, men stedet er ikke oppgitt.",
        places: ["Trondheim"],
      }),
    ]);

    expect(situations).toEqual([]);
  });

  it("keeps MET and NVE warnings as context without article confirmation", () => {
    const met = warningEvent("met-fire", { source: "met", eventType: "fire" });
    const nve = warningEvent("nve-flood", {
      source: "nve",
      eventType: "flood",
      title: "Flomvarsel for Trondheim",
      areaLabel: "Trondheim kommune",
    });

    expect(detectPreliminarySituations([], [met, nve])).toEqual([]);
  });

  it("keeps a MET warning as context when attached to reported incidents", () => {
    const situation = detectPreliminarySituations(
      [
        incidentArticle("smoke-one", "nrk", "2026-06-02T11:30:00Z", {
          location: { lat: 63.41, lng: 10.26, label: "Bymarka" },
        }),
        incidentArticle("smoke-two", "adressa", "2026-06-02T11:35:00Z", {
          location: { lat: 63.41, lng: 10.26, label: "Bymarka" },
        }),
      ],
      [
        warningEvent("met-fire", {
          source: "met",
          eventType: "fire",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [10.2, 63.35],
                [10.35, 63.35],
                [10.35, 63.45],
                [10.2, 63.45],
                [10.2, 63.35],
              ],
            ],
          },
        }),
      ],
    )[0]!;

    expect(situation.activationBasis?.rule).toBe("two_independent_sources");
    expect(situation.activationBasis?.sourceIds.sort()).toEqual(["adressa", "nrk"]);
    expect(situation.verificationStatus).toBe("Foreløpig fra rapportering");
    expect(situation.evidence.some((item) => item.source === "met")).toBe(false);
    expect(
      situation.features.find((feature) => feature.properties.layer === "warning"),
    ).toMatchObject({
      properties: { source: "met", sourceLabel: "MET farevarsel" },
    });
  });

  it("labels attached NVE warning context with NVE provenance", () => {
    const situation = detectPreliminarySituations(
      [
        incidentArticle("flood-one", "nrk", "2026-06-02T11:40:00Z", {
          title: "Flom ved Nidelva",
          excerpt: "Vannstanden stiger ved Nidelva.",
          places: ["Nidelva"],
        }),
        incidentArticle("flood-two", "adressa", "2026-06-02T11:45:00Z", {
          title: "Flom ved Nidelva",
          excerpt: "Nødetatene følger flom ved Nidelva.",
          places: ["Nidelva"],
        }),
      ],
      [
        warningEvent("nve-flood", {
          source: "nve",
          eventType: "flood",
          title: "Flomvarsel for Trondheim",
          areaLabel: "Trondheim kommune",
        }),
      ],
    )[0]!;

    expect(situation.activationBasis?.sourceIds.sort()).toEqual(["adressa", "nrk"]);
    expect(situation.evidence.some((item) => item.source === "nve")).toBe(false);
    expect(situation.features.some((feature) => feature.properties.source === "nve")).toBe(false);
    expect(situation.timeline.find((entry) => entry.source === "nve")).toMatchObject({
      sourceLabel: "NVE / Varsom",
      official: true,
    });
  });

  it("allows a later real event after an earlier false positive was dismissed", () => {
    const dismissed = dismissedSituation(
      detectPreliminarySituations([
        incidentArticle("dismissed-one", "nrk", "2026-05-20T08:00:00Z"),
        incidentArticle("dismissed-two", "adressa", "2026-05-20T08:10:00Z"),
      ])[0]!,
    );

    const newCases = detectPreliminarySituations(
      [
        incidentArticle("fresh-one", "nrk", "2026-06-02T12:00:00Z"),
        incidentArticle("fresh-two", "adressa", "2026-06-02T12:05:00Z"),
      ],
      [],
      [dismissed],
    );

    expect(newCases).toHaveLength(1);
    expect(newCases[0]?.id).not.toBe(dismissed.id);
    expect(newCases[0]?.activationBasis?.articleIds).toEqual(["fresh-two", "fresh-one"]);
    expect(newCases[0]?.relatedArticleIds).toEqual(["fresh-two", "fresh-one"]);
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
