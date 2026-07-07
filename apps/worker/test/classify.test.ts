import { describe, expect, it } from "vitest";
import {
  articleTopics,
  canonicalPlaceName,
  categorize,
  detectScope,
  extractPlaces,
} from "../src/classify.js";
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

  it("routes high-signal Trondheim institutions to Trondheim", () => {
    expect(detectScope("St. Olavs hospital melder om beredskap")).toBe("trondheim");
    expect(detectScope("NTNU og SINTEF åpner nytt testsenter på Gløshaugen")).toBe("trondheim");
    expect(extractPlaces("NTNU og St. Olavs omtales i saken")).toEqual(["NTNU", "St. Olavs"]);
  });

  it("routes regional transport corridors and institutions to Trøndelag", () => {
    expect(detectScope("Forsinkelser på Dovrebanen og Nordlandsbanen")).toBe("trondelag");
    expect(detectScope("Flytrafikken ved Værnes påvirkes av uvær")).toBe("trondelag");
    expect(extractPlaces("AtB varsler endringer på Trønderbanen via Værnes")).toEqual([
      "AtB",
      "Trønderbanen",
      "Værnes",
    ]);
  });

  it("does not keep national road-number stories without a local anchor", () => {
    expect(detectScope("E6 stengt etter ulykke i Gudbrandsdalen")).toBeUndefined();
    expect(categorize("E6 stengt etter ulykke i Gudbrandsdalen")).toBe("Transport");
  });

  it("categorizes incident stories and extracts public place names", () => {
    expect(categorize("Skogbrann i Bymarka")).toBe("Hendelser");
    expect(extractPlaces("Skogbrann i Bymarka ved Granåsen")).toEqual(["Bymarka", "Granåsen"]);
    expect(categorize("Ny skole åpner i Trondheim")).toBe("Nyheter");
  });

  it("categorizes local sports coverage separately from incidents and culture", () => {
    expect(categorize("Freyr Alexandersson blir ny hovedtrener i Rosenborg")).toBe("Sport");
    expect(categorize("Han kan bli RBK-trener")).toBe("Sport");
    expect(categorize("Ukas eiendomsoverdragelser: RBK-profil har kjøpt seg ny bolig")).toBe(
      "Sport",
    );
    expect(categorize("Rosenborg-profil har kjøpt seg ny bolig")).toBe("Sport");
    expect(categorize("Kolstad håndball møter europeisk motstand")).toBe("Sport");
    expect(categorize("Rosenborg møter Brann på Lerkendal")).toBe("Sport");
    expect(
      categorize("Ranheim tapte 0-3 borte mot Åsane i 1. divisjon. Kampen var målløs til pause."),
    ).toBe("Sport");
    expect(categorize("Ny bortesmell. Ranheims bortekompleks fortsetter.")).toBe("Sport");
    expect(categorize("Brann i Bymarka")).toBe("Hendelser");
    expect(articleTopics("Freyr Alexandersson blir ny hovedtrener i Rosenborg")).toEqual([
      "rosenborg",
    ]);
    expect(articleTopics("Han kan bli RBK-trener")).toEqual(["rosenborg"]);
    expect(articleTopics("Ukas eiendomsoverdragelser: RBK-profil har kjøpt seg ny bolig")).toEqual([
      "rosenborg",
    ]);
    expect(articleTopics("Rosenborg-profil har kjøpt seg ny bolig")).toEqual(["rosenborg"]);
    expect(articleTopics("Kolstad håndball møter europeisk motstand")).toEqual([]);
  });

  it("separates police and crime items from generic incidents", () => {
    expect(categorize("Innbrudd: Trondheim, Tiller")).toBe("Krim");
    expect(categorize("Tyveri: Trondheim")).toBe("Krim");
    expect(categorize("Ro og orden: Trondheim, Saupstad")).toBe("Krim");
    expect(categorize("Hørte ikke på politiet - ble arrestert")).toBe("Krim");
  });

  it("does not treat politics or ordinary være text as incidents or weather", () => {
    expect(categorize("Politikk i Trondheim")).toBe("Politikk");
    expect(categorize("Kommunen varsler ny politikk for sentrum")).toBe("Politikk");
    expect(categorize("Dette skal være et åpent møte på biblioteket")).toBe("Nyheter");
    expect(categorize("Han har vært i samtaler med Rosenborg")).toBe("Sport");
    expect(categorize("Politiet rykker ut etter melding")).toBe("Hendelser");
    expect(categorize("Farevarsel om vær i Trondheim")).toBe("Vær");
  });

  it("recognizes traffic collision wording beyond the word kollisjon", () => {
    expect(categorize("Trafikkulykke på Kroppanbrua")).toBe("Transport");
    expect(categorize("Syklist og bil i sammenstøt på Tiller")).toBe("Transport");
    expect(categorize("Fotgjenger påkjørt ved Elgeseter")).toBe("Transport");
  });

  it("keeps non-transport closures and smoke reports in incidents", () => {
    expect(categorize("Skole stengt på Rosenborg")).toBe("Hendelser");
    expect(categorize("Rykker til Flatåsen etter røykutvikling")).toBe("Hendelser");
  });

  it("requires planning context before classifying byutvikling", () => {
    expect(categorize("Planen bak treneransettelsen er umulig")).toBe("Nyheter");
    expect(categorize("Ny reguleringsplan for Sluppen")).toBe("Byutvikling");
  });

  it("does not classify local club names as sport without match context", () => {
    expect(categorize("Ranheim vant pris for ny møteplass")).toBe("Nyheter");
    expect(categorize("Rosenborg skole får nytt uteområde")).toBe("Nyheter");
  });

  it("does not classify Rosenborg district incidents or ordinary bruker text as sport or transport", () => {
    expect(categorize("Brann på Rosenborg skole i Trondheim")).toBe("Hendelser");
    expect(categorize("Skole stengt på Rosenborg")).toBe("Hendelser");
    expect(articleTopics("Skole stengt på Rosenborg")).toEqual([]);
    expect(categorize("Kommunen bruker nytt system")).toBe("Nyheter");
    expect(categorize("Ny app bruker kunstig intelligens i Trondheim")).toBe("Nyheter");
  });

  it("does not geocode football-club-only Rosenborg mentions as the district", () => {
    expect(extractPlaces("Freyr Alexandersson blir ny hovedtrener i Rosenborg")).toEqual([]);
    expect(extractPlaces("Han kan bli RBK-trener")).toEqual([]);
    expect(extractPlaces("Rosenborg møter Brann på Lerkendal")).toEqual(["Lerkendal"]);
    expect(extractPlaces("Brann på Rosenborg skole i Trondheim")).toEqual([
      "Rosenborg",
      "Trondheim",
    ]);
    expect(extractPlaces("Skole stengt på Rosenborg")).toEqual(["Rosenborg"]);
  });

  it("prefers a specific district over the generic city when placing a story", () => {
    expect(extractPlaces("Brann i Bymarka i Trondheim")).toEqual(["Bymarka", "Trondheim"]);
  });

  it("extracts Trondheim sentrum as a specific place without accepting bare sentrum", () => {
    expect(detectScope("Tyveri i Trondheim sentrum")).toBe("trondheim");
    expect(extractPlaces("Tyveri i Trondheim sentrum")).toEqual(["Sentrum", "Trondheim"]);
    expect(detectScope("Tyveri i Oslo sentrum")).toBeUndefined();
    expect(extractPlaces("Tyveri i Oslo sentrum")).toEqual([]);
  });

  it("extracts recurring incident anchors around Kyvannet and Solsiden", () => {
    expect(detectScope("Person funnet livløs under vann ved Kyvatnet")).toBe("trondheim");
    expect(extractPlaces("Person funnet livløs under vann ved Kyvatnet")).toEqual(["Kyvannet"]);
    expect(extractPlaces("Redningsaksjon ved Kyvannet i Trondheim")).toEqual([
      "Kyvannet",
      "Trondheim",
    ]);
    expect(extractPlaces("Ras med steiner og løsmasser på Gangåsveien i Orkland")).toEqual([
      "Gangåsvegen",
      "Orkland",
    ]);
    expect(extractPlaces("Tyveri ved Solsiden i Trondheim")).toEqual(["Solsiden", "Trondheim"]);
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

  it("opens armed police threat reports as high-priority public-safety situations", () => {
    const base: Article = {
      id: "armed-nrk",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Bevæpnet politi rykket ut i Trondheim",
      excerpt: "Politiet rykket ut til en trusselsituasjon på Byåsen i Trondheim.",
      url: "https://example.test/armed-nrk",
      publishedAt: "2026-07-07T17:46:00Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Byåsen", "Trondheim"],
      location: { label: "Byåsen", lat: 63.405, lng: 10.356 },
    };

    const situations = detectPreliminarySituations([
      base,
      {
        ...base,
        id: "armed-adressa",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Trusselsituasjon i Trondheim",
        url: "https://example.test/armed-adressa",
        publishedAt: "2026-07-07T17:47:00Z",
      },
    ]);

    expect(situations).toHaveLength(1);
    expect(situations[0]).toMatchObject({
      type: "rescue",
      importance: "high",
      incidentSignature: "rescue:byåsen",
      locationLabel: "Byåsen",
    });
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

  it("does not open a fire situation from football club Brann coverage", () => {
    const common = {
      publishedAt: "2026-06-18T14:00:00Z",
      scope: "trondheim" as const,
      category: "Sport" as const,
      places: ["Lerkendal", "Trondheim"],
      location: { lat: 63.4125, lng: 10.405, label: "Lerkendal" },
    };

    expect(
      detectPreliminarySituations([
        {
          ...common,
          id: "rosenborg-brann-one",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Rosenborg møter Brann på Lerkendal",
          excerpt: "Kampen spilles søndag kveld.",
          url: "https://example.test/brann-one",
        },
        {
          ...common,
          id: "rosenborg-brann-two",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Brann kommer til Trondheim",
          excerpt: "Rosenborg gjør seg klar til hjemmekamp mot Brann.",
          url: "https://example.test/brann-two",
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

  it("activates traffic situations from syklist and sammenstøt wording", () => {
    const situations = detectPreliminarySituations([
      incidentArticle("traffic-one", "nrk", "2026-06-02T10:30:00Z", {
        title: "Syklist og bil i sammenstøt på Tiller",
        excerpt: "Nødetatene er på stedet etter sammenstøt mellom syklist og bil.",
        category: "Transport",
        places: ["Tiller"],
      }),
      incidentArticle("traffic-two", "adressa", "2026-06-02T10:35:00Z", {
        title: "Syklist påkjørt på Tiller",
        excerpt: "Politiet omtaler en trafikkhendelse etter at en syklist ble påkjørt.",
        category: "Transport",
        places: ["Tiller"],
      }),
    ]);

    expect(situations).toHaveLength(1);
    expect(situations[0]?.type).toBe("traffic");
    expect(situations[0]?.incidentSignature).toBe("traffic:tiller");
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
