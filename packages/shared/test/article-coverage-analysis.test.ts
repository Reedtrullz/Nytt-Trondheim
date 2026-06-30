import { describe, expect, it } from "vitest";
import { analyzeArticleCoverage, type Article } from "../src/index.js";

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
