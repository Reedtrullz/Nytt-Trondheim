import { describe, expect, it } from "vitest";
import type { Article } from "../src/index.js";
import {
  analyzeArticleCoverage,
  analyzeArticleCoverageV2,
  articleCoverageEdge,
  articleCoverageEvidence,
  articleIncidentSubtype,
  isPropertyCrimeEventMatch,
  propertyCrimeEventPolicy,
} from "../src/index.js";

function article(id: string, overrides: Partial<Article>): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: "",
    url: `https://example.test/${id}`,
    publishedAt: "2026-07-12T20:00:00.000Z",
    scope: "trondelag",
    category: "Hendelser",
    places: ["Trøndelag"],
    ...overrides,
  };
}

describe("v2 pair evidence", () => {
  it("does not treat generic order words as positive place or entity evidence", () => {
    const evidence = articleCoverageEvidence(
      article("speed", {
        title: "Ungdommer kjørte i nær 200",
        excerpt: "Politiet har kontroll på ungdommene.",
        places: ["Orkland"],
      }),
      article("threat", {
        title: "Mann pågrepet etter trusselsituasjon",
        excerpt: "Politiet har kontroll etter at ungdom tok kontakt.",
        places: ["Selbu"],
      }),
      "v2",
    );
    expect(evidence.positiveIncidentEvidence).toEqual([]);
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "specific_place" })]),
    );
  });

  it("does not count a locality twice as both place and named-entity evidence", () => {
    const left = article("malvik-property", {
      source: "malviknytt",
      sourceLabel: "Malviknytt",
      title: "Solgt for åtte millioner – Se eiendomsoverdragelsene her",
      excerpt: "Her er oversikten over de siste eiendomsoverdragelsene i Malvik.",
      category: "Nyheter",
      places: ["Malvik"],
    });
    const right = article("malvik-business", {
      source: "malviknytt",
      sourceLabel: "Malviknytt",
      title: "Næringslivet blomstrer: Disse startet nye bedrifter i Malvik",
      excerpt: "Her er oversikten over de nyregistrerte selskapene i Malvik.",
      category: "Nyheter",
      places: ["Malvik"],
      publishedAt: "2026-07-12T20:30:00.000Z",
    });

    const evidence = articleCoverageEvidence(left, right, "v2");
    expect(evidence.positiveIncidentEvidence).toContain("shared_specific_place");
    expect(evidence.positiveIncidentEvidence).not.toContain("shared_named_entity");
    expect(articleCoverageEdge(left, right)?.tier).toBe("weak");
  });

  it("keeps unrelated same-area stories weak even inside the place window", () => {
    const edge = articleCoverageEdge(
      article("roros-driving", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Fikk melding om «vinglebil»",
        excerpt: "Politiet kontrollerte en bil ved Haltdalen nær Røros.",
        category: "Krim",
        places: ["Røros"],
      }),
      article("roros-waffles", {
        source: "retten",
        sourceLabel: "Arbeidets Rett",
        title: "Over 30 år med vafler i Tufta – Nå deler de på dugnaden",
        excerpt: "Frivillige holder liv i en sommertradisjon på Røros.",
        category: "Nyheter",
        places: ["Røros"],
        publishedAt: "2026-07-12T19:30:00.000Z",
      }),
    );

    expect(edge?.tier).toBe("weak");
  });

  it("does not treat a regional authority as a specific shared place", () => {
    const evidence = articleCoverageEvidence(
      article("heim-road", {
        source: "avisa_st",
        sourceLabel: "Avisa Sør-Trøndelag",
        title: "Stenger fylkesvei og innstiller bussruter",
        excerpt: "Hellandsjøveien i Heim blir stengt i august.",
        category: "Transport",
        places: ["Trøndelag", "Trøndelag fylkeskommune"],
      }),
      article("hoylandet-road", {
        source: "ytringen",
        sourceLabel: "Ytringen",
        title: "Stenger veien for all trafikk inntil en uke",
        excerpt: "Skrøyvdalsvegen i Høylandet blir stengt i juli.",
        category: "Transport",
        places: ["Trøndelag", "Trøndelag fylkeskommune"],
        publishedAt: "2026-07-12T19:30:00.000Z",
      }),
      "v2",
    );

    expect(evidence.positiveIncidentEvidence).not.toContain("shared_specific_place");
    expect(evidence.positiveIncidentEvidence).not.toContain("shared_named_entity");
  });

  it("separates distinct traffic controls in one municipality", () => {
    const edge = articleCoverageEdge(
      article("orkland-night-control", {
        title: "Trafikkontroll i Orkland",
        excerpt: "En kontroll i 40-sone ga åtte forelegg og ett førerkortbeslag.",
        category: "Krim",
        places: ["Orkland"],
      }),
      article("orkland-day-control", {
        title: "14 fikk bot",
        excerpt: "En fartskontroll i 80-sone ga 14 forelegg. Høyeste fart var 114 km/t.",
        category: "Krim",
        places: ["Orkland"],
        publishedAt: "2026-07-12T11:20:00.000Z",
      }),
    );

    expect(edge?.tier).toBe("weak");
  });

  it("still admits corroborated cross-source coverage at one place", () => {
    const edge = articleCoverageEdge(
      article("pool-local", {
        source: "innherred",
        sourceLabel: "Innherred",
        title: "– Ikke noe fullgodt tilbud",
        excerpt: "Bassenget i Trønderhallen i Levanger holder stengt etter en rørsprekk.",
        category: "Nyheter",
        places: ["Levanger"],
      }),
      article("pool-nrk", {
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Sprekk i vannrør stenger svømmehall i Levanger",
        excerpt: "Trønderhallen holder bassenget stengt på grunn av et ødelagt vannrør.",
        category: "Nyheter",
        places: ["Levanger"],
        publishedAt: "2026-07-12T19:00:00.000Z",
      }),
    );

    expect(edge?.tier).toMatch(/strong|moderate/);
  });

  it("admits a detailed exact cross-source copy despite generic incident wording", () => {
    const edge = articleCoverageEdge(
      article("gas-shower-local", {
        source: "namdalsavisa",
        sourceLabel: "Namdalsavisa",
        title: "Gassdusj eksploderte – politiet jakter på årsaken",
        excerpt:
          "Politiet er i gang med å finne årsaken til at en gassdusj eksploderte. En kvinne fikk brannskader i ulykka.",
        category: "Nyheter",
        places: [],
      }),
      article("gas-shower-wire", {
        source: "t_a",
        sourceLabel: "Trønder-Avisa",
        title: "Gassdusj eksploderte – politiet jakter på årsaken",
        excerpt:
          "Politiet er i gang med å finne årsaken til at en gassdusj eksploderte. En kvinne fikk brannskader i ulykka.",
        category: "Nyheter",
        places: [],
        publishedAt: "2026-07-12T16:00:00.000Z",
      }),
    );

    expect(edge?.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "near_duplicate" })]),
    );
    expect(edge?.tier).toMatch(/strong|moderate/);
  });

  it("distinguishes construction fire from cooking smoke", () => {
    const evidence = articleCoverageEvidence(
      article("construction", {
        title: "Brann i brakke på byggeplass",
        excerpt: "En anleggsbrakke brant i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("cooking", {
        title: "Stekte middag med plasten på",
        excerpt: "Matlaging førte til røyk i en bolig.",
        places: ["Møllenberg", "Trondheim"],
      }),
      "v2",
    );
    expect(evidence.incidentSubtypes).toEqual(["construction_fire", "cooking_smoke"]);
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
  });

  it("treats every distinct classified fire subtype as conflicting evidence", () => {
    const fires = [
      article("building", { title: "Brann i leilighet", places: ["Trondheim"] }),
      article("vehicle", { title: "Bilbrann meldt", places: ["Trondheim"] }),
      article("vegetation", { title: "Gressbrann meldt", places: ["Trondheim"] }),
      article("construction", {
        title: "Brann i anleggsbrakke på byggeplass",
        places: ["Trondheim"],
      }),
      article("cooking", {
        title: "Røyk etter matlaging på komfyr",
        places: ["Trondheim"],
      }),
    ];

    for (const [index, left] of fires.entries()) {
      for (const right of fires.slice(index + 1)) {
        expect(
          articleCoverageEvidence(left, right, "v2").conflicts,
          `${left.id}/${right.id}`,
        ).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]));
      }
    }
  });

  it("accepts shared specific place plus compatible construction-fire subtype", () => {
    const evidence = articleCoverageEvidence(
      article("left", {
        title: "Brann i brakke på byggeplass",
        excerpt: "Anleggsbrakka brant i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("right", {
        title: "Nødetatene til brakkebrann",
        excerpt: "Brannvesenet fikk kontroll på byggeplassen i Nærøysund.",
        places: ["Nærøysund"],
      }),
      "v2",
    );
    expect(evidence.positiveIncidentEvidence).toEqual(
      expect.arrayContaining(["shared_specific_place", "compatible_incident_subtype"]),
    );
    expect(evidence.conflicts).toEqual([]);
  });

  it("scores a shared official situation as strong", () => {
    const edge = articleCoverageEdge(
      article("official", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        situationId: "incident-1",
        places: ["Lade"],
      }),
      article("news", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        situationId: "incident-1",
        places: ["Lade"],
      }),
    );
    expect(edge).toMatchObject({ tier: "strong", kind: "incident" });
    expect(edge?.score).toBeGreaterThanOrEqual(0.85);
  });

  it("scores compatible shared-place coverage as moderate", () => {
    const edge = articleCoverageEdge(
      article("fire-a", {
        title: "Brann i anleggsbrakke",
        excerpt: "Sveising antente isolasjon i brakka i Nærøysund",
        places: ["Nærøysund"],
      }),
      article("fire-b", {
        title: "Nødetatene til brakkebrann",
        excerpt: "Isolasjon tok fyr etter sveising på byggeplassen i Nærøysund",
        places: ["Nærøysund"],
      }),
    );
    expect(edge).toMatchObject({ tier: "moderate", kind: "incident" });
    expect(edge?.score).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps text-only generic incident overlap weak", () => {
    const edge = articleCoverageEdge(
      article("generic-a", {
        title: "Politiet har kontroll",
        excerpt: "Ungdom var involvert",
        places: ["Trøndelag"],
      }),
      article("generic-b", {
        title: "Politiet fikk kontroll",
        excerpt: "Ungdom tok kontakt",
        places: ["Trøndelag"],
      }),
    );
    expect(edge?.tier).toBe("weak");
  });

  it("keeps identical generic public-order reports separate outside the city rule window", () => {
    const edge = articleCoverageEdge(
      article("order-a", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Ordensforstyrrelse i Trondheim",
        excerpt: "Politiet har kontroll på en mann etter en ordensforstyrrelse.",
        places: ["Trondheim"],
      }),
      article("order-b", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Ordensforstyrrelse i Trondheim",
        excerpt: "Politiet har kontroll på en mann etter en ordensforstyrrelse.",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T18:00:00.000Z",
      }),
    );

    expect(edge?.tier).toBe("weak");
  });

  it("does not admit a city-only generic collision from duplicate wording", () => {
    const edge = articleCoverageEdge(
      article("collision-a", {
        title: "Kollisjon i Trondheim",
        excerpt: "Nødetatene rykket ut etter en trafikkulykke.",
        places: ["Trondheim"],
      }),
      article("collision-b", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kollisjon i Trondheim",
        excerpt: "Nødetatene rykket ut etter en trafikkulykke.",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T19:40:00.000Z",
      }),
    );

    expect(edge?.tier).toBe("weak");
  });

  it("admits a narrow construction-fire city fingerprint inside its two-hour window", () => {
    const edge = articleCoverageEdge(
      article("construction-a", {
        title: "Brann i anleggsbrakke ved havna",
        excerpt: "Sveising antente isolasjon i brakka.",
        places: ["Trondheim"],
      }),
      article("construction-b", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Anleggsbrakke brant etter sveising",
        excerpt: "Isolasjon tok fyr ved havna.",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T19:15:00.000Z",
      }),
    );

    expect(edge?.tier).toMatch(/strong|moderate/);
    expect(edge?.positiveIncidentEvidence).toContain("shared_city_incident_fingerprint");
  });

  it("does not advertise a city fingerprint before every eligibility condition passes", () => {
    const eligibleShape = {
      title: "Brann i anleggsbrakke ved havna",
      excerpt: "Sveising antente isolasjon i brakka.",
      places: ["Trondheim"],
    };
    const sameSource = articleCoverageEdge(
      article("same-source-a", eligibleShape),
      article("same-source-b", {
        ...eligibleShape,
        publishedAt: "2026-07-12T19:30:00.000Z",
      }),
    );
    const outsideWindow = articleCoverageEdge(
      article("outside-a", eligibleShape),
      article("outside-b", {
        ...eligibleShape,
        source: "adressa",
        sourceLabel: "Adresseavisen",
        excerpt: "Isolasjon tok fyr ved havna etter en ukjent hendelse.",
        publishedAt: "2026-07-12T17:59:00.000Z",
      }),
    );
    const lowOverlap = articleCoverageEdge(
      article("low-a", {
        title: "Brann i anleggsbrakke",
        excerpt: "Sveising pågikk.",
        places: ["Trondheim"],
      }),
      article("low-b", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Anleggsbrakke brant",
        excerpt: "Elektrisk feil oppstod.",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T19:30:00.000Z",
      }),
    );

    for (const edge of [sameSource, outsideWindow, lowOverlap]) {
      expect(edge?.positiveIncidentEvidence ?? []).not.toContain(
        "shared_city_incident_fingerprint",
      );
      expect(edge?.tier ?? "weak").toBe("weak");
    }
  });

  it("does not use generic shop and food tokens as a fingerprint for separate thefts", () => {
    const left = article("shop-byasen", {
      title: "Tyv tatt i butikk",
      excerpt: "Politiet rykket ut etter tyveri fra butikk. En mann stjal matvarer og ost.",
      category: "Krim",
      places: ["Trondheim"],
    });
    const right = article("shop-heimdal", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Politiet rykket ut",
      excerpt: "En tyv stjal matvarer og kjøtt fra butikk. Politiet fikk kontroll på mannen.",
      category: "Krim",
      places: ["Trondheim"],
      publishedAt: "2026-07-12T19:30:00.000Z",
    });

    const evidence = articleCoverageEvidence(left, right, "v2");
    expect(evidence.incidentSubtypes).toEqual(["shop_theft", "shop_theft"]);
    expect(evidence.sharedCityIncidentFingerprint).toBeUndefined();
    expect(articleCoverageEdge(left, right)?.tier).toBe("weak");
    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      expect(analyze([left, right], "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
      expect(analyze([right, left], "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
    }
  });

  it("does not use generic storage-unit wording as same-city event identity", () => {
    const left = article("generic-storage-left", {
      source: "nrk",
      title: "Innbrudd i flere boder",
      excerpt: "Politiet rykket ut etter tyveri fra boder. En mann tok med seg varer.",
      category: "Krim",
      places: ["Trondheim"],
    });
    const right = article("generic-storage-right", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Tyveri fra bod i Trondheim",
      excerpt: "En mann brøt seg inn i en bod og tok varer. Politiet etterforsker saken.",
      category: "Krim",
      places: ["Trondheim"],
      publishedAt: "2026-07-12T19:30:00.000Z",
    });

    expect(
      articleCoverageEvidence(left, right, "v2").sharedCityIncidentFingerprint,
    ).toBeUndefined();
    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      expect(analyze([left, right], "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
      expect(analyze([right, left], "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
    }
  });

  it("keeps same-source same-subtype updates eligible through canonical URL continuity", () => {
    const left = article("storage-update-left", {
      source: "nidaros",
      sourceLabel: "Nidaros",
      title: "Oppdatering: Innbrudd i boder",
      excerpt: "Politiet etterforsker tyveri fra flere boder.",
      category: "Krim",
      places: ["Trondheim"],
    });
    const right = article("storage-update-right", {
      source: "nidaros",
      sourceLabel: "Nidaros",
      title: "Oppdatering: Innbrudd i boder",
      excerpt: "Saken er oppdatert etter tyveri fra flere boder.",
      category: "Krim",
      places: ["Trondheim"],
      publishedAt: "2026-07-12T19:40:00.000Z",
      url: left.url,
    });

    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      for (const ordered of [
        [left, right],
        [right, left],
      ]) {
        expect(analyze(ordered, "2026-07-12T21:00:00.000Z").bundles).toHaveLength(1);
      }
    }
  });

  it("keeps same-source property reports with only identical boilerplate separate", () => {
    const left = article("storage-boilerplate-left", {
      source: "nidaros",
      sourceLabel: "Nidaros",
      title: "Innbrudd i flere boder på Moholt",
      excerpt: "Politiet etterforsker tyveri fra flere boder på Moholt.",
      category: "Krim",
      places: ["Moholt", "Trondheim"],
    });
    const right = article("storage-boilerplate-right", {
      source: "nidaros",
      sourceLabel: "Nidaros",
      title: left.title,
      excerpt: left.excerpt,
      category: "Krim",
      places: ["Moholt", "Trondheim"],
      publishedAt: "2026-07-12T19:40:00.000Z",
    });

    expect(left.url).not.toBe(right.url);
    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      expect(analyze([left, right], "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
      expect(analyze([right, left], "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
    }
  });

  it("does not read the bod prefix in Bodø as a storage unit", () => {
    expect(
      articleIncidentSubtype(
        article("bodo-theft", {
          title: "Tyveri i Bodø",
          excerpt: "Politiet etterforsker et tyveri i Bodø.",
          category: "Krim",
          places: ["Bodø"],
        }),
      ),
    ).toBe("unknown");
  });

  it("recognizes common storage-unit compounds without place-name special cases", () => {
    for (const storageUnit of ["sykkelbod", "lagerbod", "butikkbod"]) {
      expect(
        articleIncidentSubtype(
          article("compound-" + storageUnit, {
            title: "Innbrudd i " + storageUnit,
            excerpt: "Politiet etterforsker tyveri fra en " + storageUnit + ".",
            category: "Krim",
            places: ["Trondheim"],
          }),
        ),
      ).toBe("storage_burglary");
    }
  });

  it("admits mixed property-crime angles through explicit independent anchors", () => {
    const mixedPair = (
      suffix: string,
      shopOverrides: Partial<Article>,
      storageOverrides: Partial<Article>,
    ) =>
      [
        article("shop-" + suffix, {
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Tyveri fra butikk",
          excerpt: "Elektronikk ble stjålet fra butikken.",
          category: "Krim",
          places: ["Trondheim"],
          ...shopOverrides,
        }),
        article("storage-" + suffix, {
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Innbrudd i bod",
          excerpt: "Elektronikk ble stjålet fra boden.",
          category: "Krim",
          places: ["Trondheim"],
          publishedAt: "2026-07-12T19:55:00.000Z",
          ...storageOverrides,
        }),
      ] as const;

    const cases = [
      mixedPair("place-detail", { places: ["Heimdal"] }, { places: ["Heimdal"] }),
      mixedPair(
        "entity-detail",
        { excerpt: "Elektronikk ble stjålet fra butikken på Solsiden." },
        { excerpt: "Elektronikk ble stjålet fra boden ved Solsiden." },
      ),
      mixedPair(
        "clock-detail",
        { excerpt: "Klokken 03.12 ble elektronikk stjålet fra butikken." },
        { excerpt: "Klokken 03.12 ble elektronikk stjålet fra boden." },
      ),
    ];

    for (const [shopAngle, storageAngle] of cases) {
      expect(isPropertyCrimeEventMatch(shopAngle, storageAngle)).toBe(true);
      expect(
        articleCoverageEvidence(shopAngle, storageAngle, "v2").positiveIncidentEvidence,
      ).toContain("shared_property_crime_event");
      expect(articleCoverageEdge(shopAngle, storageAngle)?.tier).toBe("moderate");
    }
  });

  it("does not admit mixed property crimes from details without an event anchor", () => {
    const pairs = [
      [
        article("unanchored-shop-objects", {
          source: "nrk",
          title: "Tyveri fra butikk",
          excerpt: "Elektronikk og en sykkel ble stjålet fra butikken.",
          category: "Krim",
          places: ["Trondheim"],
        }),
        article("unanchored-storage-objects", {
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Innbrudd i bod",
          excerpt: "Elektronikk og en sykkel ble stjålet fra boden.",
          category: "Krim",
          places: ["Trondheim"],
          publishedAt: "2026-07-12T19:55:00.000Z",
        }),
      ],
      [
        article("unanchored-shop-age", {
          source: "nrk",
          title: "Tyveri fra butikk",
          excerpt: "En mann i 40-årene stjal elektronikk fra butikken.",
          category: "Krim",
          places: ["Trondheim"],
        }),
        article("unanchored-storage-age", {
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Innbrudd i bod",
          excerpt: "En mann i 40-årene stjal elektronikk fra boden.",
          category: "Krim",
          places: ["Trondheim"],
          publishedAt: "2026-07-12T18:00:00.000Z",
        }),
      ],
    ] as const;

    for (const pair of pairs) {
      expect(isPropertyCrimeEventMatch(...pair)).toBe(false);
      for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
        expect(analyze(pair, "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
      }
    }
  });

  it("preserves explicit URL and official-situation identity for mixed property angles", () => {
    const sharedUrl = "https://example.test/property-live";
    const pairs = [
      [
        article("identity-url-shop", {
          source: "nrk",
          title: "Tyveri fra butikk",
          excerpt: "Politiet etterforsker saken.",
          category: "Krim",
          places: ["Trondheim"],
          url: sharedUrl,
        }),
        article("identity-url-storage", {
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Innbrudd i bod",
          excerpt: "Politiet etterforsker saken.",
          category: "Krim",
          places: ["Trondheim"],
          url: sharedUrl,
          publishedAt: "2026-07-12T19:55:00.000Z",
        }),
      ],
      [
        article("identity-situation-shop", {
          source: "nrk",
          title: "Tyveri fra butikk",
          excerpt: "Politiet etterforsker saken.",
          category: "Krim",
          places: ["Trondheim"],
          situationId: "property-official-thread",
        }),
        article("identity-situation-storage", {
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Innbrudd i bod",
          excerpt: "Politiet etterforsker saken.",
          category: "Hendelser",
          places: ["Trondheim"],
          situationId: "property-official-thread",
          publishedAt: "2026-07-12T19:55:00.000Z",
        }),
      ],
    ] as const;

    for (const pair of pairs) {
      expect(isPropertyCrimeEventMatch(...pair)).toBe(true);
      expect(articleCoverageEvidence(...pair, "v2").conflicts).toEqual([]);
      for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
        expect(analyze(pair, "2026-07-12T21:00:00.000Z").bundles).toHaveLength(1);
      }
    }
  });

  it("does not count generic property or food terms as independent event details", () => {
    const shopAngle = article("generic-shop-angle", {
      source: "nrk",
      title: "Tyveri fra butikk",
      excerpt: "En mann stjal matvarer fra en butikk etter melding til politiet.",
      category: "Krim",
      places: ["Trondheim"],
    });
    const storageAngle = article("generic-storage-angle", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Tyveri fra bod",
      excerpt: "En mann stjal matvarer fra en bod etter melding til politiet.",
      category: "Krim",
      places: ["Trondheim"],
      publishedAt: "2026-07-12T19:55:00.000Z",
    });

    expect(isPropertyCrimeEventMatch(shopAngle, storageAngle)).toBe(false);
    expect(
      articleCoverageEvidence(shopAngle, storageAngle, "v2").positiveIncidentEvidence,
    ).not.toContain("shared_property_crime_event");
    expect(articleCoverageEdge(shopAngle, storageAngle)?.tier ?? "weak").toBe("weak");
  });

  it("does not promote shared police boilerplate into independent property-crime details", () => {
    const pair = [
      article("boilerplate-shop", {
        source: "nrk",
        title: "Tyveri fra butikk",
        excerpt: "Ingen er pågrepet. En ukjent gjerningsperson stjal elektronikk fra en butikk.",
        category: "Krim",
        places: ["Trondheim"],
      }),
      article("boilerplate-storage", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Tyveri fra bod",
        excerpt: "Ingen er pågrepet. En ukjent gjerningsperson stjal elektronikk fra en bod.",
        category: "Krim",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T19:55:00.000Z",
      }),
    ] as const;

    expect(isPropertyCrimeEventMatch(...pair)).toBe(false);
    expect(articleCoverageEdge(...pair)?.tier ?? "weak").toBe("weak");
  });

  it("does not treat a repeated place plus generic property wording as one event", () => {
    const pair = [
      article("same-place-shop", {
        source: "nrk",
        title: "Tyveri fra butikk på Heimdal",
        excerpt: "Ingen er pågrepet etter tyveriet. Politiet etterforsker saken.",
        category: "Krim",
        places: ["Heimdal", "Trondheim"],
      }),
      article("same-place-storage", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Innbrudd i bod på Heimdal",
        excerpt: "Ingen er pågrepet etter tyveriet. Politiet etterforsker saken.",
        category: "Krim",
        places: ["Heimdal", "Trondheim"],
        publishedAt: "2026-07-12T19:55:00.000Z",
      }),
    ] as const;

    expect(isPropertyCrimeEventMatch(...pair)).toBe(false);
    const evidence = articleCoverageEvidence(...pair, "v2");
    expect(evidence.positiveIncidentEvidence).not.toContain("shared_property_crime_event");
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
    expect(articleCoverageEdge(...pair)).toMatchObject({ tier: "weak", reviewable: true });
    for (const analyze of [analyzeArticleCoverage, analyzeArticleCoverageV2]) {
      expect(analyze(pair, "2026-07-12T21:00:00.000Z").bundles).toEqual([]);
    }
  });

  it("bounds mixed property-crime admission by source independence and three hours", () => {
    const shopAngle = article("bounded-shop", {
      source: "nrk",
      title: "Tyveri fra butikk",
      excerpt: "Klokken 03.12 ble elektronikk og en sykkel stjålet fra butikken.",
      category: "Krim",
      places: ["Trondheim"],
    });
    const storageAngle = article("bounded-storage", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Innbrudd i bod",
      excerpt: "Klokken 03.12 ble elektronikk og en sykkel stjålet fra boden.",
      category: "Krim",
      places: ["Trondheim"],
      publishedAt: new Date(
        Date.parse(shopAngle.publishedAt) - propertyCrimeEventPolicy.windowMs,
      ).toISOString(),
    });

    expect(isPropertyCrimeEventMatch(shopAngle, storageAngle)).toBe(true);
    expect(isPropertyCrimeEventMatch(shopAngle, { ...storageAngle, source: "nrk" })).toBe(false);
    expect(
      isPropertyCrimeEventMatch(shopAngle, {
        ...storageAngle,
        publishedAt: new Date(
          Date.parse(shopAngle.publishedAt) - propertyCrimeEventPolicy.windowMs - 1,
        ).toISOString(),
      }),
    ).toBe(false);
  });

  it("rejects a gameable city fight made only from common incident wording", () => {
    const edge = articleCoverageEdge(
      article("fight-police", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Slagsmål i Trondheim",
        excerpt: "Flere personer ble utestengt fra et utested.",
        category: "Krim",
        places: ["Trondheim"],
      }),
      article("fight-news", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Slagsmål i Trondheim",
        excerpt: "Flere personer ble utestengt fra et utested.",
        category: "Krim",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T19:40:00.000Z",
      }),
    );

    expect(edge?.positiveIncidentEvidence).not.toContain("shared_city_incident_fingerprint");
    expect(edge?.positiveIncidentEvidence).not.toContain("shared_named_entity");
    expect(edge?.tier).toBe("weak");
  });

  it("keeps a shared Solsiden entity diagnostic when only one incident subtype is classified", () => {
    const left = article("solsiden-classified", {
      title: "Solsiden: Politiet rykket ut",
      excerpt: "Et slagsmål ble meldt ved et utested.",
      category: "Krim",
      places: ["Trondheim"],
    });
    const right = article("solsiden-unknown", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Solsiden: Politiet rykket ut",
      excerpt: "Flere personer var samlet da nødetatene kom.",
      category: "Krim",
      places: ["Trondheim"],
      publishedAt: "2026-07-12T19:50:00.000Z",
    });
    const evidence = articleCoverageEvidence(left, right, "v2");
    const edge = articleCoverageEdge(left, right);

    expect(evidence.positiveIncidentEvidence).toContain("shared_named_entity");
    expect(evidence.incidentSubtypes).toEqual(["public_order", "unknown"]);
    expect(edge?.tier).toBe("weak");
  });

  it("admits shared Solsiden entity evidence for compatible classified incident subtypes", () => {
    const left = article("solsiden-order-a", {
      title: "Solsiden: Politiet rykket ut",
      excerpt: "Et slagsmål ble meldt ved et utested.",
      category: "Krim",
      places: ["Trondheim"],
    });
    const right = article("solsiden-order-b", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Solsiden: Politiet rykket ut",
      excerpt: "Politiet stanset et slagsmål utenfor et utested.",
      category: "Krim",
      places: ["Trondheim"],
      publishedAt: "2026-07-12T19:50:00.000Z",
    });
    const evidence = articleCoverageEvidence(left, right, "v2");
    const edge = articleCoverageEdge(left, right);

    expect(evidence.positiveIncidentEvidence).toEqual(
      expect.arrayContaining(["shared_named_entity", "compatible_incident_subtype"]),
    );
    expect(edge?.tier).toMatch(/strong|moderate/);
  });

  it("does not restore generic sentence-initial words as named entities", () => {
    const evidence = articleCoverageEvidence(
      article("generic-capital-a", {
        title: "Flere: Politiet rykket ut",
        excerpt: "Et slagsmål ble meldt.",
      }),
      article("generic-capital-b", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Flere: Politiet rykket ut",
        excerpt: "Et slagsmål ble meldt.",
      }),
      "v2",
    );

    expect(evidence.positiveIncidentEvidence).not.toContain("shared_named_entity");
  });

  it("does not collapse Fanrem, Orkdal, and Orkland into one specific place", () => {
    for (const municipality of ["Orkdal", "Orkland"]) {
      const evidence = articleCoverageEvidence(
        article("fanrem-event", {
          title: "Slagsmål på Fanrem",
          places: ["Fanrem"],
        }),
        article(`${municipality.toLowerCase()}-event`, {
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: `Slagsmål i ${municipality}`,
          places: [municipality],
          publishedAt: "2026-07-12T19:50:00.000Z",
        }),
        "v2",
      );

      expect(evidence.positiveIncidentEvidence, municipality).not.toContain(
        "shared_specific_place",
      );
      expect(evidence.conflicts, municipality).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "specific_place" })]),
      );
    }
  });

  it("matches the Fanrem spelling variant to the official Fannrem locality", () => {
    const evidence = articleCoverageEvidence(
      article("fannrem-official", {
        title: "Hendelse på Fannrem",
        places: ["Fannrem"],
      }),
      article("fanrem-variant", {
        title: "Oppdatering fra Fanrem",
        places: ["Fanrem"],
      }),
      "v2",
    );

    expect(evidence.positiveIncidentEvidence).toContain("shared_specific_place");
    expect(evidence.conflicts).toEqual([]);
  });

  it("preserves exact central streets and conflicts Prinsengate with Elgeseter", () => {
    const evidence = articleCoverageEvidence(
      article("prinsens", {
        title: "Slagsmål i Prinsens gate",
        excerpt: "Politiet rykket ut.",
        places: ["Prinsens gate", "Midtbyen", "Trondheim"],
      }),
      article("elgeseter", {
        title: "Slagsmål i Elgeseter gate",
        excerpt: "Politiet rykket ut.",
        places: ["Elgeseter gate", "Midtbyen", "Trondheim"],
      }),
      "v2",
    );

    expect(evidence.positiveIncidentEvidence).not.toContain("shared_specific_place");
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "specific_place" })]),
    );
  });

  it("matches exact street aliases without treating broad sentrum as the specific place", () => {
    const evidence = articleCoverageEvidence(
      article("prinsens-a", {
        title: "Hendelse i Prinsengate",
        places: ["Prinsengate", "Sentrum", "Trondheim"],
      }),
      article("prinsens-b", {
        title: "Oppdatering fra Prinsens gate",
        places: ["Prinsens gate", "Midtbyen", "Trondheim"],
      }),
      "v2",
    );

    expect(evidence.positiveIncidentEvidence).toContain("shared_specific_place");
    expect(evidence.conflicts).toEqual([]);
  });

  it("uses token boundaries for place mentions so Lade does not match sjokolade", () => {
    const evidence = articleCoverageEvidence(
      article("lade", {
        title: "Hendelse på Lade",
        places: ["Lade"],
      }),
      article("chocolate", {
        title: "Ny sjokolade lansert",
        excerpt: "Butikken viste fram sjokoladen.",
        category: "Nyheter",
        places: ["Trondheim"],
      }),
      "v2",
    );

    expect(evidence.positiveIncidentEvidence).not.toContain("mentioned_specific_place");
  });

  it("does not let an exact URL bypass incident evidence", () => {
    const sharedUrl = "https://example.test/live-incident";
    const edge = articleCoverageEdge(
      article("url-order-a", {
        title: "Ordensforstyrrelse i Trondheim",
        excerpt: "Politiet har kontroll på en person.",
        category: "Krim",
        places: ["Trondheim"],
        url: sharedUrl,
      }),
      article("url-order-b", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Ordensforstyrrelse i Trondheim",
        excerpt: "Politiet har kontroll på en person.",
        category: "Krim",
        places: ["Trondheim"],
        url: sharedUrl,
        publishedAt: "2026-07-12T19:50:00.000Z",
      }),
    );

    expect(edge?.tier).toBe("weak");
  });

  it("classifies fire only with fire or smoke context and prioritizes the object subtype", () => {
    expect(
      articleIncidentSubtype(
        article("bare-anlegg", {
          title: "Nytt anlegg åpnet",
          excerpt: "Arbeidet fortsetter på byggeplassen.",
        }),
      ),
    ).toBe("unknown");
    expect(
      articleIncidentSubtype(
        article("bare-dinner", {
          title: "Middag med plast",
          excerpt: "Et nytt produkt ble testet.",
        }),
      ),
    ).toBe("unknown");
    expect(
      articleIncidentSubtype(
        article("fire-safety", {
          title: "Brannsikkerhet på byggeplass",
          excerpt: "Anleggsbrakka fikk nytt sikkerhetsutstyr.",
        }),
      ),
    ).toBe("unknown");
    expect(
      articleIncidentSubtype(
        article("vehicle-site", {
          title: "Bilbrann på byggeplass",
          excerpt: "Et kjøretøy brant ved anleggsbrakka.",
        }),
      ),
    ).toBe("vehicle_fire");
    expect(
      articleIncidentSubtype(
        article("building-site", {
          title: "Brann i leilighet ved byggeplass",
          excerpt: "Boligen brant ved anlegget.",
        }),
      ),
    ).toBe("building_fire");
    expect(
      articleIncidentSubtype(
        article("cooking-site", {
          title: "Røyk etter matlaging i anleggsbrakke",
          excerpt: "En komfyr førte til røyk under middagen.",
        }),
      ),
    ).toBe("cooking_smoke");
    expect(
      articleIncidentSubtype(
        article("smoke-vehicle", {
          title: "Røykutvikling i bil",
          excerpt: "Nødetatene undersøkte kjøretøyet.",
        }),
      ),
    ).toBe("vehicle_fire");
    expect(
      articleIncidentSubtype(
        article("smoke-building", {
          title: "Røykutvikling i bygning",
          excerpt: "Beboerne forlot boligen.",
        }),
      ),
    ).toBe("building_fire");
    expect(
      articleIncidentSubtype(
        article("smoke-vegetation", {
          title: "Røykutvikling i vegetasjon",
          excerpt: "Brannvesenet undersøkte skogen.",
        }),
      ),
    ).toBe("vegetation_fire");
  });

  it("uses a 72-hour maximum window for one official situation", () => {
    const inside = articleCoverageEdge(
      article("official-current", {
        situationId: "official-incident",
        places: ["Trondheim"],
      }),
      article("official-update", {
        situationId: "official-incident",
        places: ["Trondheim"],
        publishedAt: "2026-07-10T20:01:00.000Z",
      }),
    );
    const outside = articleCoverageEdge(
      article("official-current", {
        situationId: "official-incident",
        places: ["Trondheim"],
      }),
      article("official-stale", {
        situationId: "official-incident",
        places: ["Trondheim"],
        publishedAt: "2026-07-09T19:59:00.000Z",
      }),
    );

    expect(inside?.tier).toBe("strong");
    expect(outside?.tier).toBe("weak");
  });

  it("caps place-led automatic evidence at two hours", () => {
    const inside = articleCoverageEdge(
      article("place-current", {
        title: "Brann i anleggsbrakke på Lade",
        excerpt: "Sveising antente isolasjon i brakka.",
        places: ["Lade"],
      }),
      article("place-update", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Anleggsbrakke brant på Lade",
        excerpt: "Isolasjon tok fyr etter sveising.",
        places: ["Lade"],
        publishedAt: "2026-07-12T18:01:00.000Z",
      }),
    );
    const outside = articleCoverageEdge(
      article("place-current", {
        title: "Brann i anleggsbrakke på Lade",
        excerpt: "Sveising antente isolasjon i brakka.",
        places: ["Lade"],
      }),
      article("place-stale", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Anleggsbrakke brant på Lade",
        excerpt: "Isolasjon tok fyr etter sveising.",
        places: ["Lade"],
        publishedAt: "2026-07-12T17:59:00.000Z",
      }),
    );

    expect(inside?.tier).toMatch(/strong|moderate/);
    expect(outside?.tier).toBe("weak");
  });

  it("keeps true syndicated non-incident duplicates within 24 hours but rejects stale copies", () => {
    const current = article("profile-current", {
      title: "Senterlederen mistet begge foreldrene",
      excerpt: "Nå ønsker Heidi å videreføre det foreldrene lærte henne.",
      category: "Nyheter",
      places: ["Trondheim"],
    });
    const inside = articleCoverageEdge(
      current,
      article("profile-inside", {
        source: "t_a",
        sourceLabel: "Trønder-Avisa",
        title: "Senterlederen mistet begge foreldrene",
        excerpt: "Nå ønsker Heidi å videreføre det foreldrene lærte henne.",
        category: "Nyheter",
        places: ["Trondheim"],
        publishedAt: "2026-07-11T20:01:00.000Z",
      }),
    );
    const outside = articleCoverageEdge(
      current,
      article("profile-outside", {
        source: "t_a",
        sourceLabel: "Trønder-Avisa",
        title: "Senterlederen mistet begge foreldrene",
        excerpt: "Nå ønsker Heidi å videreføre det foreldrene lærte henne.",
        category: "Nyheter",
        places: ["Trondheim"],
        publishedAt: "2026-07-11T19:59:00.000Z",
      }),
    );

    expect(inside?.tier).toBe("strong");
    expect(outside?.tier).toBe("weak");
  });
});
