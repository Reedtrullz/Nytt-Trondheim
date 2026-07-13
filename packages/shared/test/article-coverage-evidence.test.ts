import { describe, expect, it } from "vitest";
import type { Article } from "../src/index.js";
import {
  articleCoverageEdge,
  articleCoverageEvidence,
  articleIncidentSubtype,
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
        excerpt: "Brakke brant i Nærøysund",
        places: ["Nærøysund"],
      }),
      article("fire-b", {
        title: "Nødetatene til brakkebrann",
        excerpt: "Byggeplassen i Nærøysund",
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

  it("caps specific-place incident evidence at twelve hours", () => {
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
        publishedAt: "2026-07-12T09:01:00.000Z",
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
        publishedAt: "2026-07-12T06:59:00.000Z",
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
