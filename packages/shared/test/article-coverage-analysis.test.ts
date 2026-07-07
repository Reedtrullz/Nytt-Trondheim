import { describe, expect, it } from "vitest";
import { analyzeArticleCoverage, buildCityPulseStories, type Article } from "../src/index.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Rykker ut til slåssing",
    excerpt: "Politiet er på vei til Saupstad i Trondheim hvor noen ungdommer slåss med hverandre.",
    url: "https://example.test/article",
    publishedAt: "2026-06-18T10:39:00.000Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Saupstad", "Trondheim"],
    location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
    ...overrides,
  };
}

describe("article coverage analysis", () => {
  it("builds first-class City Pulse stories from grouped article coverage", () => {
    const bundle = {
      id: "coverage:incident:saupstad",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-18T11:00:00.000Z",
    } as const;

    const stories = buildCityPulseStories([
      article({ id: "nrk-slagsmal", sourceLabel: "NRK Trøndelag", coverageBundle: bundle }),
      article({
        id: "politiloggen-saupstad",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Ro og orden: Trondheim, Saupstad",
        publishedAt: "2026-06-18T10:37:00.000Z",
        coverageBundle: bundle,
      }),
      article({
        id: "single-story",
        title: "Konsert på Byscenen",
        excerpt: "Byscenen setter opp sommerkonsert i Trondheim sentrum.",
        category: "Kultur",
        publishedAt: "2026-06-18T09:00:00.000Z",
        url: "https://example.test/kultur",
        places: ["Trondheim sentrum"],
        location: { lat: 63.431, lng: 10.394, label: "Trondheim sentrum" },
      }),
    ]);

    expect(stories).toHaveLength(2);
    expect(stories[0]).toMatchObject({
      id: "coverage:incident:saupstad",
      primaryArticleId: "nrk-slagsmal",
      articleIds: ["nrk-slagsmal", "politiloggen-saupstad"],
      sourceLabels: ["NRK Trøndelag", "Politiloggen"],
      sourceCount: 2,
      updateCount: 2,
      latestAt: "2026-06-18T10:39:00.000Z",
      category: "Hendelser",
      coverageBundle: bundle,
    });
    expect(stories[1]).toMatchObject({
      id: "article:single-story",
      primaryArticleId: "single-story",
      sourceCount: 1,
      updateCount: 1,
      category: "Kultur",
    });
  });

  it("annotates grouped fighting coverage with observable bundle signals", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "nrk-slagsmal",
          title: "Rykker ut til slåssing",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
        }),
        article({
          id: "politiloggen-saupstad",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Ro og orden: Trondheim, Saupstad",
          excerpt: "Vi er på veg til Saupstad etter å ha fått melding om ungdommer som sloss.",
          publishedAt: "2026-06-18T10:37:00.000Z",
          situationId: "politiloggen-saupstad",
        }),
      ],
      "2026-06-18T11:00:00.000Z",
    );

    expect(analysis.articles[0]?.coverageBundle).toMatchObject({
      kind: "incident",
      reason: "Samme hendelse med offisiell tråd",
      generatedAt: "2026-06-18T11:00:00.000Z",
    });
    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      primaryArticleId: "nrk-slagsmal",
      memberArticleIds: ["nrk-slagsmal", "politiloggen-saupstad"],
      sourceIds: ["nrk", "politiloggen"],
      sourceLabels: ["NRK Trøndelag", "Politiloggen"],
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "situation_id",
          articleIds: ["nrk-slagsmal", "politiloggen-saupstad"],
        }),
        expect.objectContaining({
          kind: "generic_place_incident",
          articleIds: ["nrk-slagsmal", "politiloggen-saupstad"],
        }),
      ]),
      nearMisses: [],
    });
  });

  it("records near misses for similar incident stories kept apart by conflicting places", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "nrk-saupstad",
          title: "Rykker ut til slåssing",
          places: ["Saupstad", "Trondheim"],
          location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
        }),
        article({
          id: "politiloggen-tiller",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Ro og orden: Trondheim, Tiller",
          excerpt: "Politiet er på Tiller etter melding om ungdommer som sloss.",
          places: ["Tiller", "Trondheim"],
          location: { lat: 63.3397, lng: 10.4203, label: "Tiller" },
          publishedAt: "2026-06-18T10:37:00.000Z",
        }),
      ],
      "2026-06-18T11:00:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(0);
    expect(analysis.nearMisses).toEqual([
      expect.objectContaining({
        articleIds: ["nrk-saupstad", "politiloggen-tiller"],
        reason: "conflicting_specific_places",
      }),
    ]);
  });

  it("keeps crime and generic incident categories compatible for one reported case", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "adressa-slag",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Flere ungdommer i slagsmål i Trondheim",
          excerpt: "Ungdommer sloss på Saupstad i Trondheim. Ingen er meldt skadet.",
          category: "Krim",
        }),
        article({
          id: "nrk-slag",
          title: "Rykker ut til slåssing",
          excerpt:
            "Politiet er på vei til Saupstad i Trondheim hvor noen ungdommer slåss med hverandre.",
          category: "Hendelser",
          publishedAt: "2026-06-18T10:37:00.000Z",
        }),
      ],
      "2026-06-18T11:00:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      memberArticleIds: ["adressa-slag", "nrk-slag"],
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "slagsmal",
        }),
      ]),
    });
  });

  it("merges a Trondheim Torg fight bundle with the Politiloggen situation update", () => {
    const generatedAt = "2026-07-04T20:10:00.000Z";
    const newsBundle = {
      id: "coverage:incident:trondheim-torg-fight",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt,
    };

    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "nrk-trondheim-torg",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Slagsmål på Trondheim Torg",
          excerpt:
            "Politiet rykker ut til Trondheim Torg etter melding om slagsmål mellom flere personer. Det er ikke meldt inn at noen er skadet.",
          publishedAt: "2026-07-04T20:04:00.000Z",
          category: "Krim",
          places: ["Midtbyen", "Trondheim"],
          location: { lat: 63.4306, lng: 10.3949, label: "Midtbyen" },
          coverageBundle: newsBundle,
        }),
        article({
          id: "nidaros-torvet",
          source: "nidaros",
          sourceLabel: "Nidaros",
          title: "Slagsmål på Torvet: - Flere løp fra stedet",
          excerpt:
            "Politiet er på stedet etter melding om slagsmål på Torvet. Flere skal ha løpt fra stedet.",
          publishedAt: "2026-07-04T20:04:00.000Z",
          category: "Krim",
          places: ["Midtbyen", "Trondheim"],
          location: { lat: 63.4306, lng: 10.3949, label: "Midtbyen" },
          coverageBundle: newsBundle,
        }),
        article({
          id: "adressa-torvet",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Slagsmål på Torvet i Trondheim: - Flere har løpt fra stedet",
          excerpt:
            "Politiet har kontroll på noen av de involverte etter melding om slagsmål på Torvet i Trondheim.",
          publishedAt: "2026-07-04T20:03:00.000Z",
          category: "Krim",
          places: ["Midtbyen", "Trondheim"],
          location: { lat: 63.4306, lng: 10.3949, label: "Midtbyen" },
          coverageBundle: newsBundle,
        }),
        article({
          id: "politiloggen-trondheim-torg",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Voldshendelse: Trondheim, Sentrum",
          excerpt:
            "Politiet rykker ut til Trondheim Torg etter melding om slagsmål mellom flere personer. Ikke fått melding om at noen er skadd. Flere personer har løpt fra stedet.",
          publishedAt: "2026-07-04T20:03:00.000Z",
          category: "Hendelser",
          places: ["Trondheim", "Sentrum"],
          location: { lat: 63.4305, lng: 10.3951, label: "Trondheim sentrum" },
          situationId: "politiloggen-trondheim-torg",
        }),
      ],
      generatedAt,
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      id: "coverage:situation:politiloggen-trondheim-torg",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse med offisiell tråd",
      memberArticleIds: expect.arrayContaining([
        "nrk-trondheim-torg",
        "nidaros-torvet",
        "adressa-torvet",
        "politiloggen-trondheim-torg",
      ]),
      sourceIds: expect.arrayContaining(["nrk", "nidaros", "adressa", "politiloggen"]),
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "slagsmal",
        }),
      ]),
    });
    expect(analysis.articles.map((item) => item.coverageBundle?.id)).toEqual([
      "coverage:situation:politiloggen-trondheim-torg",
      "coverage:situation:politiloggen-trondheim-torg",
      "coverage:situation:politiloggen-trondheim-torg",
      "coverage:situation:politiloggen-trondheim-torg",
    ]);
  });

  it("merges missing-person newsroom coverage with the Politiloggen situation update", () => {
    const generatedAt = "2026-07-05T12:30:00.000Z";
    const newsBundle = {
      id: "coverage:incident:saupstad-missing-patient",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme sak på tvers av kilder",
      generatedAt,
    };

    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "adressa-savnet",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Person savnet fra sykehjem",
          excerpt:
            "En pasient skal ha vært savnet fra et sykehjem i Trondheim i over 90 minutter. Beskrivelsen på damen er en eldre dame i 70-årene. Politiet melder saken.",
          publishedAt: "2026-07-05T12:15:00.000Z",
          category: "Krim",
          places: ["Saupstad", "Trondheim"],
          location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
          coverageBundle: newsBundle,
        }),
        article({
          id: "nrk-savnet",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Kvinne savnet i Trondheim",
          excerpt:
            "Politiet melder at en eldre kvinne har vært savnet fra et sykehjem i Trondheim. Hun skal være i 70-årene.",
          publishedAt: "2026-07-05T12:14:00.000Z",
          category: "Hendelser",
          places: ["Saupstad", "Trondheim"],
          location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
          coverageBundle: newsBundle,
        }),
        article({
          id: "politiloggen-savnet",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Savnet: Trondheim, Saupstad",
          excerpt:
            "Pasient fra Saupstad Helsehus savnet i over 90 minutter. Beskrivelse eldre dame i 70-årene, 170 cm høy, grått hår, blå genser, grønn bukse.",
          publishedAt: "2026-07-05T12:12:00.000Z",
          category: "Hendelser",
          places: ["Trondheim", "Saupstad"],
          location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
          situationId: "politiloggen-saupstad-savnet",
        }),
      ],
      generatedAt,
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      id: "coverage:situation:politiloggen-saupstad-savnet",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse med offisiell tråd",
      memberArticleIds: expect.arrayContaining([
        "adressa-savnet",
        "nrk-savnet",
        "politiloggen-savnet",
      ]),
      sourceIds: expect.arrayContaining(["adressa", "nrk", "politiloggen"]),
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "missing_person",
        }),
      ]),
    });
    expect(new Set(analysis.articles.map((item) => item.coverageBundle?.id))).toEqual(
      new Set(["coverage:situation:politiloggen-saupstad-savnet"]),
    );
  });

  it("merges a Tyholt traffic collision bundle with the Politiloggen situation update", () => {
    const generatedAt = "2026-07-07T18:45:00.000Z";
    const newsBundle = {
      id: "coverage:traffic:tyholt-collision",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt,
    };

    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "adressa-tyholt-collision",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "To biler kolliderte i Trondheim",
          excerpt:
            "Politi og ambulanse har rykket ut til et trafikkuhell på Tyholt tirsdag kveld. To biler er involvert og det skal ha skjedd en påkjørsel bakfra. En person i bilen som ble påkjørt, klager på smerter.",
          publishedAt: "2026-07-07T18:20:02.000Z",
          category: "Transport",
          places: ["Trondheim", "Tyholt"],
          location: { lat: 63.4176, lng: 10.4356, label: "Tyholt" },
          situationId: "auto-traffic-tyholt-beddc20c",
          coverageBundle: newsBundle,
        }),
        article({
          id: "nrk-tyholt-collision",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Trafikkuhell på Tyholt",
          excerpt:
            "Politiet og ambulanse rykker ut til et trafikkuhell på Tyholt i Trondheim tirsdag kveld. Politiet opplyser at det har vært en påkjørsel bakfra med to biler involvert.",
          publishedAt: "2026-07-07T18:19:28.000Z",
          category: "Transport",
          places: ["Trondheim", "Tyholt", "Trøndelag"],
          location: { lat: 63.4176, lng: 10.4356, label: "Tyholt" },
          situationId: "auto-traffic-tyholt-beddc20c",
          coverageBundle: newsBundle,
        }),
        article({
          id: "politiloggen-tyholt-collision",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Trafikk: Trondheim, Tyholt",
          excerpt:
            "Politiet og ambulanse rykker ut til et trafikkuhell, påkjørsel bakfra. To biler involvert. En person i bilen som ble påkjørt, klager på smerter. Tre personer i den andre bilen fremstår som uskadd.",
          publishedAt: "2026-07-07T18:18:11.102Z",
          category: "Transport",
          places: ["Tyholt", "Trondheim"],
          location: { lat: 63.4176, lng: 10.4356, label: "Tyholt" },
          situationId: "politiloggen-26m5x8",
          coverageBundle: newsBundle,
        }),
      ],
      generatedAt,
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse med offisiell tråd",
      memberArticleIds: expect.arrayContaining([
        "adressa-tyholt-collision",
        "nrk-tyholt-collision",
        "politiloggen-tyholt-collision",
      ]),
      sourceIds: expect.arrayContaining(["adressa", "nrk", "politiloggen"]),
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "traffic_collision",
        }),
      ]),
    });
    expect(new Set(analysis.articles.map((item) => item.coverageBundle?.id))).toHaveLength(1);
  });

  it("keeps unrelated same-place traffic situations apart without collision wording", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "datex-tyholt-bilstans",
          source: "vegvesen_traffic_info",
          sourceLabel: "Statens vegvesen DATEX",
          title: "Bilstans på Tyholt",
          excerpt: "Et kjørefelt er stengt på Tyholt etter en bilstans.",
          publishedAt: "2026-07-07T18:30:00.000Z",
          category: "Transport",
          places: ["Trondheim", "Tyholt"],
          location: { lat: 63.4176, lng: 10.4356, label: "Tyholt" },
          situationId: "datex-tyholt-bilstans",
        }),
        article({
          id: "politiloggen-tyholt-order",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Trafikk: Trondheim, Tyholt",
          excerpt: "Politiet kontrollerer trafikken ved Tyholt. Det er ikke meldt om ulykke.",
          publishedAt: "2026-07-07T18:29:00.000Z",
          category: "Transport",
          places: ["Tyholt", "Trondheim"],
          location: { lat: 63.4176, lng: 10.4356, label: "Tyholt" },
          situationId: "politiloggen-tyholt-order",
        }),
      ],
      "2026-07-07T18:45:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(0);
    expect(analysis.nearMisses).toEqual([
      expect.objectContaining({
        articleIds: ["datex-tyholt-bilstans", "politiloggen-tyholt-order"],
        reason: "different_situation",
      }),
    ]);
  });

  it("bundles close downtown order and threat updates that otherwise split into several rows", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "adressa-pinne-update",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Mann skal ha med pinne - ble bortvist",
          excerpt:
            "Operasjonsleder meldte kl 19.47 om at politiet har kontroll på en mann. Mannen gikk gjennom Elgeseter gate og viftet med en pinne mot forbipasserende. Han fremstår ruset, og vi har kjørt mannen til legevakten.",
          publishedAt: "2026-07-04T17:51:00.000Z",
          category: "Krim",
          places: ["Elgeseter", "Trondheim"],
          location: { lat: 63.424, lng: 10.395, label: "Elgeseter" },
        }),
        article({
          id: "nrk-pinne",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Mann viftet med pinne mot folk i gata",
          excerpt:
            "Kl. 19.47 melder politiet at de har kontroll på en mann som har gått å viftet med en pinne mot forbipasserende i Elgesetergate i Trondheim. Mannen skal ha fremstått som ruset. Han blir kjørt til legevakta.",
          publishedAt: "2026-07-04T17:50:00.000Z",
          category: "Nyheter",
          places: ["Trondheim", "Prinsengate"],
          location: { lat: 63.424, lng: 10.395, label: "Prinsengate" },
        }),
        article({
          id: "politiloggen-pinne",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Ro og orden: Trondheim, Prinsengate",
          excerpt:
            "Patruljen har kontroll på en mann som viftet med en pinne mot forbipasserende i Elgesetergate. Mannen fremstår ruset og kjøres til legevakt.",
          publishedAt: "2026-07-04T17:47:00.000Z",
          category: "Hendelser",
          places: ["Trondheim", "Prinsengate"],
          location: { lat: 63.424, lng: 10.395, label: "Prinsengate" },
          situationId: "politiloggen-prinsensgate-pinne",
        }),
        article({
          id: "nrk-trussel",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Mulig trusselsituasjon i Midtbyen",
          excerpt:
            "Kl. 19.18 melder politiet at de har kontroll på flere ungdommer etter en mulig trusselsituasjon i Midtbyen i Trondheim. Alle de involverte er mindreårige og politiet har kontroll på dem.",
          publishedAt: "2026-07-04T17:22:00.000Z",
          category: "Krim",
          places: ["Midtbyen", "Trondheim"],
          location: { lat: 63.4305, lng: 10.3951, label: "Midtbyen" },
        }),
        article({
          id: "adressa-trussel",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Melding om mulig trusselsituasjon - flere mindreårige jenter",
          excerpt:
            "Politiet har kontroll på flere ungdommer i Midtbyen etter melding om en mulig trusselsituasjon. Alle involverte er mindreårige.",
          publishedAt: "2026-07-04T17:18:00.000Z",
          category: "Krim",
          places: ["Midtbyen", "Trondheim"],
          location: { lat: 63.4305, lng: 10.3951, label: "Midtbyen" },
        }),
        article({
          id: "politiloggen-trussel",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Andre hendelser: Trondheim, Sentrum",
          excerpt:
            "Politiet har kontroll på flere ungdommer etter en mulig trusselsituasjon i Midtbyen. Alle involverte er mindreårige. Politiet har snakket med de involverte og tre mindreårige blir bortvist fra stedet.",
          publishedAt: "2026-07-04T17:18:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Sentrum"],
          location: { lat: 63.4305, lng: 10.3951, label: "Trondheim sentrum" },
          situationId: "politiloggen-midtbyen-trussel",
        }),
      ],
      "2026-07-04T18:00:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      memberArticleIds: expect.arrayContaining([
        "adressa-pinne-update",
        "nrk-pinne",
        "politiloggen-pinne",
        "nrk-trussel",
        "adressa-trussel",
        "politiloggen-trussel",
      ]),
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "street_order",
        }),
      ]),
      nearMisses: [],
    });
    expect(new Set(analysis.articles.map((item) => item.coverageBundle?.id))).toHaveLength(1);
  });

  it("bundles serious violence reports with different source counts but the same victim context", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "nrk-voldshendelse",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Fire siktet etter alvorlig voldshendelse i Trondheim",
          excerpt:
            "En ung mann ble kritisk skadet etter hendelsen lørdag kveld. Søndag morgen er fire personer siktet for grov kroppsskade, opplyser politiet.",
          publishedAt: "2026-06-28T05:57:00.000Z",
          category: "Krim",
          places: ["Trondheim"],
          location: undefined,
        }),
        article({
          id: "vg-grov-vold",
          source: "vg",
          sourceLabel: "VG",
          title: "Tre personer siktet for grov vold i Trondheim",
          excerpt:
            "En ung mann ble kritisk skadet som følge av hendelsen som skjedde lørdag kveld.",
          publishedAt: "2026-06-28T05:51:00.000Z",
          category: "Krim",
          places: ["Trondheim"],
          location: undefined,
        }),
      ],
      "2026-06-28T06:10:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      memberArticleIds: ["nrk-voldshendelse", "vg-grov-vold"],
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "vold",
        }),
      ]),
    });
  });

  it("keeps similar violence reports separate when they name different specific places", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "lade-vold",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ung mann kritisk skadd på Lade",
          excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
          publishedAt: "2026-06-28T16:59:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
        }),
        article({
          id: "saupstad-vold",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Én person kritisk skadet etter voldshendelse på Saupstad",
          excerpt: "Politiet undersøker en voldshendelse på Saupstad.",
          publishedAt: "2026-06-28T16:52:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Saupstad"],
          location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
        }),
      ],
      "2026-06-28T17:10:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(0);
    expect(analysis.nearMisses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          articleIds: ["lade-vold", "saupstad-vold"],
          reason: "conflicting_specific_places",
        }),
      ]),
    );
    expect(analysis.articles.map((item) => item.coverageBundle)).toEqual([undefined, undefined]);
  });

  it("merges compatible violence bundles when later updates split across rows", () => {
    const generatedAt = "2026-06-28T17:10:00.000Z";
    const firstBundle = {
      id: "coverage:violence:first",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt,
    };
    const secondBundle = {
      id: "coverage:violence:second",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt,
    };
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "adressa-mindrearige-siktet",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Flere mindreårige siktet",
          excerpt: "En 19 år gammel mann ligger kritisk skadet på St. Olavs hospital.",
          publishedAt: "2026-06-28T16:59:00.000Z",
          category: "Nyheter",
          places: ["St. Olavs", "Trondheim"],
          location: undefined,
          coverageBundle: firstBundle,
        }),
        article({
          id: "nrk-kritisk-skadet-trondheim",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Én person kritisk skadet etter voldshendelse i Trondheim",
          excerpt: "Politiet opplyser at en person er kritisk skadet etter en voldshendelse.",
          publishedAt: "2026-06-28T16:45:00.000Z",
          category: "Krim",
          places: ["Trondheim"],
          location: undefined,
          coverageBundle: firstBundle,
        }),
        article({
          id: "adressa-navngitte",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ung mann kritisk skadd - politiet leter etter flere navngitte personer",
          excerpt:
            "En ung mann er kritisk skadet etter en voldshendelse på Lade i Trondheim. Politiet leter etter flere navngitte personer.",
          publishedAt: "2026-06-28T16:59:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
          coverageBundle: secondBundle,
        }),
        article({
          id: "politiloggen-lade",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Voldshendelse: Trondheim, Lade",
          excerpt:
            "En ung mann er kritisk skadet etter en voldshendelse på Lade. Politiet leter etter flere personer.",
          publishedAt: "2026-06-28T16:34:00.000Z",
          category: "Hendelser",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
          situationId: "politiloggen-lade-vold",
          coverageBundle: secondBundle,
        }),
      ],
      generatedAt,
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      memberArticleIds: expect.arrayContaining([
        "adressa-mindrearige-siktet",
        "adressa-navngitte",
        "nrk-kritisk-skadet-trondheim",
        "politiloggen-lade",
      ]),
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "vold",
        }),
      ]),
    });
  });

  it("keeps a persisted bundle id stable when an older provider joins the same incident", () => {
    const generatedAt = "2026-06-28T17:10:00.000Z";
    const existingBundle = {
      id: "coverage:incident:lade-vold-existing",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-28T17:00:00.000Z",
    };

    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "adressa-lade-update",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ung mann kritisk skadd - politiet leter etter flere navngitte personer",
          excerpt:
            "En ung mann er kritisk skadet etter en voldshendelse på Lade i Trondheim. Politiet leter etter flere navngitte personer.",
          publishedAt: "2026-06-28T16:59:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
          coverageBundle: existingBundle,
        }),
        article({
          id: "nrk-lade-update",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Én person kritisk skadet etter voldshendelse på Lade i Trondheim",
          excerpt: "Politiet opplyser at en ung mann er kritisk skadet etter en voldshendelse.",
          publishedAt: "2026-06-28T16:45:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
          coverageBundle: existingBundle,
        }),
        article({
          id: "vg-older-lade",
          source: "vg",
          sourceLabel: "VG",
          title: "Ung mann fraktet til sykehus etter voldsepisode i Trondheim",
          excerpt:
            "En ung mann ble kritisk skadet etter en voldshendelse på Lade. Politiet leter etter flere personer.",
          publishedAt: "2026-06-28T16:40:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
        }),
      ],
      generatedAt,
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      id: "coverage:incident:lade-vold-existing",
      kind: "incident",
      confidence: "high",
      memberArticleIds: ["adressa-lade-update", "nrk-lade-update", "vg-older-lade"],
    });
    expect(analysis.articles.map((item) => item.coverageBundle?.id)).toEqual([
      "coverage:incident:lade-vold-existing",
      "coverage:incident:lade-vold-existing",
      "coverage:incident:lade-vold-existing",
    ]);
  });

  it("merges existing rows when an older bridge article matches both sides of one incident", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "adressa-lade-critical",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ung mann kritisk skadd på Lade",
          excerpt: "En ung mann er kritisk skadet etter en voldshendelse på Lade i Trondheim.",
          publishedAt: "2026-06-28T16:59:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
        }),
        article({
          id: "nrk-minors-charged",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Flere mindreårige siktet",
          excerpt:
            "Fire personer er siktet for grov kroppsskade. Politiet leter etter flere navngitte personer.",
          publishedAt: "2026-06-28T16:54:00.000Z",
          category: "Krim",
          places: ["Trondheim"],
          location: undefined,
        }),
        article({
          id: "vg-bridge-lade",
          source: "vg",
          sourceLabel: "VG",
          title: "Ung mann kritisk skadd - politiet leter etter flere navngitte personer",
          excerpt:
            "En ung mann er kritisk skadet etter en voldshendelse på Lade i Trondheim. Flere personer er siktet for grov kroppsskade, og politiet leter etter navngitte personer.",
          publishedAt: "2026-06-28T16:45:00.000Z",
          category: "Krim",
          places: ["Trondheim", "Lade"],
          location: { lat: 63.443, lng: 10.445, label: "Lade" },
        }),
      ],
      "2026-06-28T17:10:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      memberArticleIds: ["adressa-lade-critical", "nrk-minors-charged", "vg-bridge-lade"],
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "vold",
          articleIds: ["adressa-lade-critical", "vg-bridge-lade"],
        }),
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "vold",
          articleIds: ["nrk-minors-charged", "vg-bridge-lade"],
        }),
      ]),
    });
  });

  it("bundles fall accident reports when one source has sparse follow-up wording", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "nrk-fallulykke",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Fallulykke i Trondheim",
          excerpt:
            "Politiet har rykket ut til Elgeseter i Trondheim sammen med ambulanse og brannvesenet etter å ha fått melding om rop om hjelp fra en adresse. En mann i 50-årene er kjørt til akuttmottaket ved St. Olavs hospital.",
          publishedAt: "2026-06-28T11:18:00.000Z",
          category: "Hendelser",
          places: ["Trondheim", "Elgeseter"],
          location: { lat: 63.416, lng: 10.398, label: "Elgeseter" },
        }),
        article({
          id: "adressa-fallulykke",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Fallulykke i Trondheim: - Hørte et smell. Så et rop om hjelp",
          excerpt: "En person skal ha falt ned fra fem meters høyde.",
          publishedAt: "2026-06-28T11:14:00.000Z",
          category: "Hendelser",
          places: ["Trondheim"],
          location: undefined,
        }),
      ],
      "2026-06-28T11:30:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      memberArticleIds: ["nrk-fallulykke", "adressa-fallulykke"],
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "fallulykke",
        }),
      ]),
    });
  });

  it("treats Fanrem, Orkdal, and Orkland as compatible for a same-wedding disturbance", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "nrk-fanrem-bryllup",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Ampert i bryllup på Fanrem",
          excerpt:
            "På Fanrem i Orkland ble det uenigheter i et bryllup. To av gjestene var ikke helt enige, men roet seg ned da politiet kom.",
          publishedAt: "2026-06-28T06:27:00.000Z",
          category: "Krim",
          places: ["Fanrem", "Orkland"],
          location: { lat: 63.171, lng: 9.827, label: "Fanrem" },
        }),
        article({
          id: "adressa-bryllup",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Slåsskamp i bryllup: - Ble enige da politiet kom",
          excerpt: "To kamphaner måtte skilles i Orkdal.",
          publishedAt: "2026-06-28T04:22:00.000Z",
          category: "Krim",
          places: ["Orkdal"],
          location: undefined,
        }),
      ],
      "2026-06-28T06:30:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "incident",
      confidence: "high",
      memberArticleIds: ["nrk-fanrem-bryllup", "adressa-bryllup"],
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "generic_place_incident",
          detail: "bryllup_uro",
        }),
      ]),
    });
  });

  it("bundles terse Ranheim match-result coverage with fuller match reports", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "nrk-ranheim-aasane",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Ranheim tapte 0-3 borte mot Åsane",
          excerpt:
            "Ranheim tapte 0-3 borte mot Åsane i 1. divisjon lørdag. Kampen var målløs til pause, før hjemmelaget tok ledelsen tidlig i andre omgang. Dette er Ranheims femte bortetap på rad.",
          publishedAt: "2026-06-28T15:59:00.000Z",
          category: "Nyheter",
          places: ["Ranheim", "Trondheim"],
          location: undefined,
        }),
        article({
          id: "adressa-bortesmell",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ny bortesmell",
          excerpt: "Ranheims bortekompleks fortsetter.",
          publishedAt: "2026-06-28T15:52:00.000Z",
          category: "Sport",
          places: [],
          location: undefined,
        }),
      ],
      "2026-06-28T16:10:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(1);
    expect(analysis.bundles[0]).toMatchObject({
      kind: "topic",
      confidence: "high",
      memberArticleIds: ["nrk-ranheim-aasane", "adressa-bortesmell"],
      signals: expect.arrayContaining([
        expect.objectContaining({
          kind: "topical_thread",
          detail: "sport_result:ranheim",
        }),
      ]),
    });
  });

  it("does not use Ranheim alone to bundle non-sports neighborhood stories with match results", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "ranheim-pris",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ranheim vant pris for ny møteplass",
          excerpt: "Prosjektet på Ranheim ble hedret av kommunen.",
          publishedAt: "2026-06-28T16:05:00.000Z",
          category: "Nyheter",
          places: ["Ranheim", "Trondheim"],
          location: undefined,
        }),
        article({
          id: "nrk-ranheim-aasane",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Ranheim tapte 0-3 borte mot Åsane",
          excerpt:
            "Ranheim tapte 0-3 borte mot Åsane i 1. divisjon lørdag. Kampen endte med Ranheims femte bortetap på rad.",
          publishedAt: "2026-06-28T15:59:00.000Z",
          category: "Nyheter",
          places: ["Ranheim", "Trondheim"],
          location: undefined,
        }),
      ],
      "2026-06-28T16:10:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(0);
  });

  it("does not bundle separate same-club match results with different explicit opponents", () => {
    const analysis = analyzeArticleCoverage(
      [
        article({
          id: "ranheim-aasane",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Ranheim tapte 0-3 borte mot Åsane",
          excerpt:
            "Ranheim tapte 0-3 borte mot Åsane i 1. divisjon lørdag. Kampen endte med bortetap.",
          publishedAt: "2026-06-28T15:59:00.000Z",
          category: "Sport",
          places: ["Ranheim", "Trondheim"],
          location: undefined,
        }),
        article({
          id: "ranheim-start",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ranheim tapte 1-2 hjemme mot Start",
          excerpt: "Ranheim tapte 1-2 hjemme mot Start etter en jevn kamp.",
          publishedAt: "2026-06-28T15:55:00.000Z",
          category: "Sport",
          places: ["Ranheim", "Trondheim"],
          location: undefined,
        }),
      ],
      "2026-06-28T16:10:00.000Z",
    );

    expect(analysis.bundles).toHaveLength(0);
  });
});
