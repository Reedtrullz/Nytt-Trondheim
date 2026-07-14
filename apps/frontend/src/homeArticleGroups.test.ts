import type { Article } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { annotateArticleCoverageBundles, groupHomeArticles } from "./homeArticleGroups.js";

function article(overrides: Partial<Article> = {}): Article {
  const id = overrides.id ?? "article-1";
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Tente på antibac i Trondheim",
    excerpt: "En mann i 50-åra spruta antibac på bakken og tente på det på Torvet i Trondheim.",
    url: `https://example.test/${id}`,
    publishedAt: "2026-06-15T20:12:00.000Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Trondheim", "Torvet"],
    location: { lat: 63.4305, lng: 10.3951, label: "Torvet" },
    ...overrides,
  };
}

describe("home article grouping", () => {
  it("consolidates the same event from different sources", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-antibac",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
      }),
      article({
        id: "politiloggen-antibac",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Ro og orden: Trondheim, Torvet",
        excerpt:
          "Klokken 1846 fikk politiet inn en melding om en mann som sprutet antibac på bakken og tente på.",
        publishedAt: "2026-06-15T20:00:00.000Z",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-antibac",
      "politiloggen-antibac",
    ]);
    expect(groups[0]?.sourceLabels).toEqual(["NRK Trøndelag", "Politiloggen"]);
  });

  it("consolidates repeated headlines from the same source", () => {
    const groups = groupHomeArticles([
      article({
        id: "vg-1",
        source: "vg",
        sourceLabel: "VG",
        title: "Marius Borg Høiby anker dommen",
        excerpt: "Da forsvarerne møtte pressen etter å ha besøkt Høiby i Ila fengsel.",
        publishedAt: "2026-06-15T13:04:00.000Z",
        category: "Nyheter",
        places: ["Ila"],
        location: undefined,
      }),
      article({
        id: "vg-2",
        source: "vg",
        sourceLabel: "VG",
        title: "Marius Borg Høiby anker dommen",
        excerpt: "Det sier 29-åringens forsvarere etter å ha besøkt ham i Ila fengsel.",
        publishedAt: "2026-06-15T12:58:00.000Z",
        category: "Nyheter",
        places: ["Ila"],
        location: undefined,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe("vg-1");
    expect(groups[0]?.articles).toHaveLength(2);
  });

  it("consolidates similar cross-source coverage while keeping unrelated stories separate", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-maga-1",
        title: "«Maga-cruiseskip» i Trondheim – møtt av demonstranter",
        excerpt:
          "Cruiseskipet Silver Dawn la mandag morgen til kai i Trondheim og møtes av demonstranter.",
        publishedAt: "2026-06-15T08:22:00.000Z",
        category: "Hendelser",
        places: ["Trondheim", "Brattørkaia"],
      }),
      article({
        id: "adressa-maga",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "«Maga-skipet» møtt med protester og bannere i Trondheim",
        excerpt:
          "Klokka halv åtte mandag morgen klappet det såkalte Maga-skipet Silver Dawn til kai ved Brattørkaia.",
        publishedAt: "2026-06-15T08:04:00.000Z",
        category: "Nyheter",
        places: ["Trondheim", "Brattørkaia"],
      }),
      article({
        id: "other",
        title: "Ny bru åpnet på Sluppen",
        excerpt: "Gående og syklende kan bruke den nye brua.",
        publishedAt: "2026-06-15T08:00:00.000Z",
        category: "Transport",
        places: ["Sluppen"],
        location: { lat: 63.3978, lng: 10.3995, label: "Sluppen" },
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual(["nrk-maga-1", "adressa-maga"]);
    expect(groups[1]?.primary.id).toBe("other");
  });

  it("consolidates same-place police reports when one source says innbruddsalarm", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-tiller",
        title: "Innbruddsalarm på Tiller",
        excerpt:
          "En halv time over midnatt mottok politiet melding om en innbruddsalarm på Tiller i Trondheim. Politiet kom i kontakt med to personer.",
        publishedAt: "2026-06-18T03:31:00.000Z",
        places: ["Tiller"],
        location: { lat: 63.33974, lng: 10.4203, label: "Tiller" },
      }),
      article({
        id: "politiloggen-tiller",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Innbrudd: Trondheim, Tiller",
        excerpt:
          "Politiet mottok melding om en innbruddsalarm på Tiller. Politiet har rykket ut og kommet i kontakt med to personer.",
        publishedAt: "2026-06-17T22:57:00.000Z",
        places: ["Tiller", "Trondheim"],
        location: { lat: 63.33974, lng: 10.4203, label: "Tiller" },
        situationId: "politiloggen-tiller",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-tiller",
      "politiloggen-tiller",
    ]);
  });

  it("consolidates city-center RSS reporting with a Sentrum Politiloggen thread", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-sentrum",
        title: "Tyveri i Trondheim sentrum",
        excerpt: "Politiet undersøker et tyveri i Trondheim sentrum.",
        publishedAt: "2026-06-18T05:34:00.000Z",
        places: ["Sentrum", "Trondheim"],
        location: { lat: 63.43209, lng: 10.3991, label: "Trondheim sentrum" },
      }),
      article({
        id: "politiloggen-sentrum",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Tyveri: Trondheim, Sentrum",
        excerpt: "Politiet har opprettet sak etter melding om tyveri i Sentrum.",
        publishedAt: "2026-06-18T05:31:00.000Z",
        places: ["Sentrum", "Trondheim"],
        location: { lat: 63.43209, lng: 10.3991, label: "Trondheim sentrum" },
        situationId: "politiloggen-sentrum",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-sentrum",
      "politiloggen-sentrum",
    ]);
  });

  it("consolidates traffic coverage across canonical local place aliases", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-kroppanbrua",
        title: "Trafikkulykke på Kroppanbrua",
        excerpt: "En kollisjon gir kø ved Kroppan bru etter trafikkulykke.",
        publishedAt: "2026-06-18T08:00:00.000Z",
        category: "Transport",
        places: ["Kroppanbrua"],
        location: { lat: 63.373, lng: 10.365, label: "Kroppanbrua" },
      }),
      article({
        id: "adressa-kroppan-bru",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kollisjon på Kroppan bru",
        excerpt: "En kollisjon gir kø ved Kroppan bru etter trafikkulykke.",
        publishedAt: "2026-06-18T07:55:00.000Z",
        category: "Transport",
        places: ["Kroppan bru"],
        location: { lat: 63.373, lng: 10.365, label: "Kroppan bru" },
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-kroppanbrua",
      "adressa-kroppan-bru",
    ]);
  });

  it("keeps Trondheim S as a specific station place anchor", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-trondheim-s",
        title: "Signalfeil gir forsinkelser på Trondheim S",
        excerpt: "Togene står på grunn av signalfeil ved Trondheim S.",
        publishedAt: "2026-06-18T08:20:00.000Z",
        category: "Transport",
        places: ["Trondheim", "Trondheim S"],
        location: { lat: 63.436, lng: 10.399, label: "Trondheim S" },
      }),
      article({
        id: "adressa-trondheim-s",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Signalfeil ved Trondheim S",
        excerpt: "Togene står på grunn av signalfeil ved Trondheim S.",
        publishedAt: "2026-06-18T08:15:00.000Z",
        category: "Transport",
        places: ["Trondheim", "Trondheim S"],
        location: { lat: 63.436, lng: 10.399, label: "Trondheim S" },
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-trondheim-s",
      "adressa-trondheim-s",
    ]);
  });

  it("consolidates near-duplicate police updates even when RSS places are generic", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-arrestert",
        title: "Hørte ikke på politiet - ble arrestert",
        excerpt:
          "En mann i slutten av 20-åra ble innbrakt til arresten etter å ha tilgriset en politibil på oppdrag i Trondheim sentrum. Han var i følge med en mann i 30-åra som anmeldes for å stjele alkohol på bakeriet Snurr. Tjuven ble bortvist fra Trondheim sentrum frem til i morgen tidlig. Men han klarte ikke å",
        publishedAt: "2026-06-18T15:02:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "nrk-bortvist",
        title: "Tjuv bortvist fra Trondheim sentrum",
        excerpt:
          "En mann i slutten av 20-åra ble innbrakt til arresten etter å ha tilgriset en politibil på oppdrag i Trondheim sentrum. Han var i følge med en mann i 30-åra som anmeldes for å stjele alkohol på bakeriet Snurr. Tyven blir bortvist fra Trondheim sentrum frem til i morgen tidlig.",
        publishedAt: "2026-06-18T15:02:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "politiloggen-tyveri",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Tyveri: Trondheim",
        excerpt:
          "En mann i slutten av 20 - årene ble innbrakt til arresten etter å ha tilgriset en politibil på oppdrag i Trondheim sentrum. Han var i følge med en mann i 30 - årene som anmeldes for å stjele alkohol på bakeriet Snurr. Tyven blir bortvist fra Trondheim sentrum frem til i morgen tidlig. Mannen som ble bortvist fra Trondheim sentrum greide ikke å overholde dette pålegget og ble innbrakt til arresten kl 1930.",
        publishedAt: "2026-06-18T14:59:00.000Z",
        places: ["Trondheim"],
        location: undefined,
        situationId: "politiloggen-tyveri",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-bortvist",
      "nrk-arrestert",
      "politiloggen-tyveri",
    ]);
    expect(groups[0]?.sourceLabels).toEqual(["NRK Trøndelag", "Politiloggen"]);
  });

  it("consolidates same fighting incident from news and Politiloggen phrasing", () => {
    const groups = groupHomeArticles([
      article({
        id: "adressa-slagsmal",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Flere ungdommer i slagsmål i Trondheim",
        excerpt: "",
        publishedAt: "2026-06-18T10:40:00.000Z",
        category: "Nyheter",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "nrk-slassing",
        title: "Rykker ut til slåssing",
        excerpt:
          "Politiet er på vei til Saupstad i Trondheim hvor noen ungdommer slåss med hverandre. Det er ikke meldt om at noen er skadet.",
        publishedAt: "2026-06-18T10:39:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "politiloggen-saupstad",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Ro og orden: Trondheim, Saupstad",
        excerpt:
          "Vi er på veg til Saupstad etter å ha fått melding om ungdommer som sloss. Det er ikke meldt om noen skadde. Slagsmålet har opphørt.",
        publishedAt: "2026-06-18T10:37:00.000Z",
        places: ["Trondheim", "Saupstad"],
        location: { lat: 63.363, lng: 10.356, label: "Saupstad" },
        situationId: "politiloggen-saupstad",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "adressa-slagsmal",
      "nrk-slassing",
      "politiloggen-saupstad",
    ]);
    expect(groups[0]?.sourceLabels).toEqual(["Adresseavisen", "NRK Trøndelag", "Politiloggen"]);
  });

  it("consolidates missing-person news bundle with the Politiloggen situation row", () => {
    const coverageBundle = {
      id: "coverage:incident:saupstad-savnet",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme sak på tvers av kilder",
      generatedAt: "2026-07-05T12:20:00.000Z",
    };
    const groups = groupHomeArticles([
      article({
        id: "adressa-savnet",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Person savnet fra sykehjem",
        excerpt:
          "En pasient skal ha vært savnet fra et sykehjem i Trondheim i over 90 minutter. Beskrivelsen på damen er en eldre dame i 70-årene.",
        publishedAt: "2026-07-05T12:15:00.000Z",
        category: "Krim",
        places: ["Saupstad", "Trondheim"],
        location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
        coverageBundle,
      }),
      article({
        id: "nrk-savnet",
        title: "Kvinne savnet i Trondheim",
        excerpt:
          "Politiet melder at en eldre kvinne har vært savnet fra et sykehjem i Trondheim. Hun skal være i 70-årene.",
        publishedAt: "2026-07-05T12:14:00.000Z",
        category: "Hendelser",
        places: ["Saupstad", "Trondheim"],
        location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
        coverageBundle,
      }),
      article({
        id: "politiloggen-savnet",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Savnet: Trondheim, Saupstad",
        excerpt:
          "Pasient fra Saupstad Helsehus savnet i over 90 minutter. Beskrivelse eldre dame i 70-årene. 170 cm høy, grått hår, blå genser, grønn bukse.",
        publishedAt: "2026-07-05T12:12:00.000Z",
        category: "Hendelser",
        places: ["Trondheim", "Saupstad"],
        location: { lat: 63.3675, lng: 10.3567, label: "Saupstad" },
        situationId: "politiloggen-saupstad-savnet",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "adressa-savnet",
      "nrk-savnet",
      "politiloggen-savnet",
    ]);
    expect(groups[0]?.sourceLabels).toEqual(["Adresseavisen", "NRK Trøndelag", "Politiloggen"]);
  });

  it("consolidates Kyvannet drowning and lifeless-under-water updates", () => {
    const groups = groupHomeArticles([
      article({
        id: "dagbladet-badeulykke",
        source: "dagbladet",
        sourceLabel: "Dagbladet",
        title: "Mann død i badeulykke",
        excerpt:
          "En mann i 20-åra har mistet livet i en badeulykke i Trondheim natt til onsdag. Hendelsen framstår som en ulykke, sier politiet.",
        publishedAt: "2026-06-18T08:50:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "nrk-kyvannet",
        title: "Redningsaksjon ved Kyvannet i Trondheim i natt",
        excerpt:
          "En person ble i natt henta opp av Kyvannet i Trondheim. Vedkommende skal ha havna under vann i forbindelse med bading og ble lokalisert av dykkere fra brannvesenet. Det ble starta hjerte- og lungeredning på stedet.",
        publishedAt: "2026-06-18T04:03:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "adressa-livlos",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Person funnet livløs under vann i Trondheim",
        excerpt:
          "Nødetatene rykket natt til onsdag ut til Kyvannet i Trondheim etter melding om at en person var havnet under vann. Det ble gitt hjerte- og lungeredning, og politiet omtaler det som en alvorlig ulykke.",
        publishedAt: "2026-06-18T02:05:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "politiloggen-kyvannet",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Redning: Trondheim, Kyvannet",
        excerpt:
          "Klokken 02:39 natt til onsdag ble det iverksatt en redningsaksjon ved Kyvannet. Meldingen var at en person hadde gått under vann i forbindelse med bading.",
        publishedAt: "2026-06-18T01:31:00.000Z",
        places: ["Trondheim", "Kyvannet"],
        location: { lat: 63.419, lng: 10.333, label: "Kyvannet" },
        situationId: "politiloggen-kyvannet",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "dagbladet-badeulykke",
      "nrk-kyvannet",
      "adressa-livlos",
      "politiloggen-kyvannet",
    ]);
    expect(groups[0]?.sourceLabels).toEqual([
      "Dagbladet",
      "NRK Trøndelag",
      "Adresseavisen",
      "Politiloggen",
    ]);
  });

  it("consolidates smoke-development updates when the specific place is only in text", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-flatåsen-røykutvikling",
        title: "Rykka til Flatåsen etter røykutvikling",
        excerpt:
          "Nødetatene har rykka til Flatåsen i Trondheim etter meldinger om røyk fra en bygning. Det pågår evakuering fra leilighetsbygget. Få minutter senere opplyser politiet at brannen er slukka. Sannsynlig årsak er arbeid på stedet.",
        publishedAt: "2026-06-18T08:50:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "nrk-flatåsen",
        title: "Rykker til Flatåsen",
        excerpt:
          "Nødetatene har rykka til Flatåsen i Trondheim etter meldinger om røyk fra en bygning.",
        publishedAt: "2026-06-18T08:50:00.000Z",
        category: "Nyheter",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "politiloggen-flatåsen",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Brann: Trondheim",
        excerpt:
          "Nødetatene rykker kl 1046 ut til Øvre Flatåsveg 9a i Trondheim i forbindelse med melding om røyk fra bygning. Brannen er slukket. Sannsynlig årsak er arbeid på stedet.",
        publishedAt: "2026-06-18T08:48:00.000Z",
        places: ["Trondheim"],
        location: undefined,
        situationId: "politiloggen-flatåsen",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-flatåsen-røykutvikling",
      "nrk-flatåsen",
      "politiloggen-flatåsen",
    ]);
    expect(groups[0]?.sourceLabels).toEqual(["NRK Trøndelag", "Politiloggen"]);
  });

  it("consolidates burglary-at-car-dealer updates with generic structured places", () => {
    const groups = groupHomeArticles([
      article({
        id: "nrk-bilforhandler",
        title: "Flere innbruddsforsøk hos bilforhandler",
        excerpt:
          "Politiet har vært hos Melhus bil på Tunga i Trondheim for å gjøre undersøkelser etter innbruddsforsøk i flere biler. I løpet av natta har noen prøvd å bryte seg inn i flere biler på tomta til forhandleren.",
        publishedAt: "2026-06-18T08:30:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "nrk-skader",
        title: "Skader for store summer hos bilforhandler i Trondheim",
        excerpt:
          "Politiet har vært hos Melhus bil på Tunga i Trondheim for å gjøre undersøkelser etter innbruddsforsøk i flere biler. Ifølge bedriften vil det bli dyrt å rette opp i skaden som er gjort.",
        publishedAt: "2026-06-18T08:30:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "politiloggen-bilforhandler",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Innbrudd: Trondheim",
        excerpt:
          "En politipatrulje er på Melhus bil på Tunga i Trondheim for åstedsundersøkelser. Det er i løpet av natta vært innbruddsforsøk i flere biler på tomta til forhandleren.",
        publishedAt: "2026-06-18T08:27:00.000Z",
        places: ["Trondheim"],
        location: undefined,
        situationId: "politiloggen-bilforhandler",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "nrk-skader",
      "nrk-bilforhandler",
      "politiloggen-bilforhandler",
    ]);
    expect(groups[0]?.sourceLabels).toEqual(["NRK Trøndelag", "Politiloggen"]);
  });

  it("bundles same-place break-in coverage without merging nearby separate burglaries", () => {
    const groups = groupHomeArticles([
      article({
        id: "adressa-kompis-lade",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Mann med hette og svart plagg i ansiktet dukket opp på bildene",
        excerpt:
          "En mann brukte brekkjern for å bryte seg inn i restauranten Kompis på Lade i Trondheim natt til torsdag.",
        publishedAt: "2026-06-18T04:33:40.000Z",
        category: "Transport",
        places: ["Lade", "Trondheim"],
        location: { lat: 63.44626, lng: 10.44344, label: "Lade" },
      }),
      article({
        id: "nrk-lade-break-in",
        title: "Innbrudd på Lade i Trondheim",
        excerpt:
          "Like før klokka 4.30 i natt meldte en vekter fra om innbrudd hos ei bedrift på Lade i Trondheim. Overvåkingsbilder viste at en mann hadde tatt seg inn på stedet, så politiet rykka ut.",
        publishedAt: "2026-06-18T03:38:20.000Z",
        places: ["Lade", "Trondheim"],
        location: { lat: 63.44626, lng: 10.44344, label: "Lade" },
      }),
      article({
        id: "nrk-postbil-lade",
        title: "Tok pakker fra postbil i Trondheim",
        excerpt:
          "Ved 3-tida i natt rykka politiet ut til Lade i Trondheim etter melding om mistenkelige personer ved et kjøretøy. To unge menn skal ha åpna pakker fra en postbil.",
        publishedAt: "2026-06-18T03:34:51.000Z",
        places: ["Lade", "Trondheim"],
        location: { lat: 63.44626, lng: 10.44344, label: "Lade" },
      }),
      article({
        id: "nrk-tiller-alarm",
        title: "Innbruddsalarm på Tiller",
        excerpt:
          "En halv time over midnatt mottok politiet melding om en innbruddsalarm på Tiller i Trondheim. Politiet rykka ut og kom i kontakt med to personer.",
        publishedAt: "2026-06-18T03:31:51.000Z",
        places: ["Tiller", "Trondheim"],
        location: { lat: 63.33974, lng: 10.4203, label: "Tiller" },
      }),
    ]);

    expect(groups).toHaveLength(3);
    expect(
      groups
        .find((group) => group.articles.some((item) => item.id === "nrk-lade-break-in"))
        ?.articles.map((item) => item.id),
    ).toEqual(["adressa-kompis-lade", "nrk-lade-break-in"]);
    expect(groups.find((group) => group.primary.id === "nrk-postbil-lade")?.articles).toHaveLength(
      1,
    );
    expect(groups.find((group) => group.primary.id === "nrk-tiller-alarm")?.articles).toHaveLength(
      1,
    );
  });

  it("bundles developing Rosenborg trainer topic coverage across categories", () => {
    const groups = groupHomeArticles([
      article({
        id: "vg-freyr-kan-bli",
        source: "vg",
        sourceLabel: "VG",
        title: "Medier: Freyr Alexandersson kan bli ny Rosenborg-trener",
        excerpt:
          "Islendingen er aktuell for trenerjobben i Rosenborg, ifølge Bergens Tidende og Adressa.",
        publishedAt: "2026-06-18T13:57:00.000Z",
        category: "Nyheter",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "adressa-rbk-trener",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Han kan bli RBK-trener",
        excerpt: "Freyr Alexandersson har vært i konkrete samtaler med Rosenborg.",
        publishedAt: "2026-06-18T13:50:00.000Z",
        category: "Vær",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "vg-freyr-hovedtrener",
        source: "vg",
        sourceLabel: "VG",
        title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
        excerpt:
          "For bare to og en halv uke siden var han ferdig i Brann. I dag ble han presentert som Rosenborgs nye trener.",
        publishedAt: "2026-06-18T07:34:00.000Z",
        category: "Hendelser",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "adressa-neppe-losning",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Neppe en god løsning",
        excerpt: "KOMMENTAR: Rosenborg har ansatt ny trener. Planen bak er umulig å se.",
        publishedAt: "2026-06-18T07:22:00.000Z",
        category: "Byutvikling",
        places: ["Trondheim"],
        location: undefined,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.articles.map((item) => item.id)).toEqual([
      "vg-freyr-kan-bli",
      "adressa-rbk-trener",
      "vg-freyr-hovedtrener",
      "adressa-neppe-losning",
    ]);
    expect(groups[0]?.sourceLabels).toEqual(["VG", "Adresseavisen"]);
  });

  it("does not consolidate unrelated city-wide stories just because both mention Trondheim", () => {
    const groups = groupHomeArticles([
      article({
        id: "school-budget",
        title: "Nytt budsjettmøte i Trondheim",
        excerpt:
          "Politikerne i Trondheim behandler saken mandag og sier innbyggerne får mer informasjon.",
        publishedAt: "2026-06-15T11:00:00.000Z",
        category: "Nyheter",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "concert-update",
        title: "Stor konserthelg i Trondheim",
        excerpt:
          "Arrangørene i Trondheim behandler kø og sier publikum får mer informasjon mandag.",
        publishedAt: "2026-06-15T10:45:00.000Z",
        category: "Nyheter",
        places: ["Trondheim"],
        location: undefined,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.primary.id)).toEqual(["school-budget", "concert-update"]);
  });

  it("does not consolidate exact same headlines at conflicting specific places", () => {
    const groups = groupHomeArticles([
      article({
        id: "lade-facility",
        title: "Nytt nærmiljøanlegg åpnet",
        excerpt: "Anlegget på Lade er klart for bruk.",
        url: "https://example.test/lade-facility",
        publishedAt: "2026-06-18T12:00:00.000Z",
        category: "Nyheter",
        places: ["Lade", "Trondheim"],
        location: { lat: 63.443, lng: 10.45, label: "Lade" },
      }),
      article({
        id: "tiller-facility",
        title: "Nytt nærmiljøanlegg åpnet",
        excerpt: "Anlegget på Tiller er klart for bruk.",
        url: "https://example.test/tiller-facility",
        publishedAt: "2026-06-18T11:55:00.000Z",
        category: "Nyheter",
        places: ["Tiller", "Trondheim"],
        location: { lat: 63.339, lng: 10.42, label: "Tiller" },
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.primary.id)).toEqual(["lade-facility", "tiller-facility"]);
  });

  it("does not consolidate generic incident-keyword stories without a distinctive shared clue", () => {
    const groups = groupHomeArticles([
      article({
        id: "generic-innbrudd-news",
        title: "Innbrudd i Trondheim",
        excerpt: "Politiet undersøker et innbrudd i Trondheim.",
        publishedAt: "2026-06-18T07:00:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "generic-innbrudd-log",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Innbrudd: Trondheim",
        excerpt: "Politiet fikk melding om innbrudd i Trondheim.",
        publishedAt: "2026-06-18T06:55:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.primary.id)).toEqual([
      "generic-innbrudd-news",
      "generic-innbrudd-log",
    ]);
  });

  it("does not consolidate different official situation ids even with similar titles", () => {
    const groups = groupHomeArticles([
      article({
        id: "politiloggen-sentrum-1",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Tyveri: Trondheim, Sentrum",
        excerpt: "Politiet har opprettet sak etter et tyveri ved et bakeri i sentrum.",
        publishedAt: "2026-06-18T15:10:00.000Z",
        places: ["Sentrum", "Trondheim"],
        location: { lat: 63.43209, lng: 10.3991, label: "Trondheim sentrum" },
        situationId: "politiloggen-sentrum-bakeri",
      }),
      article({
        id: "politiloggen-sentrum-2",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Tyveri: Trondheim, Sentrum",
        excerpt: "Politiet har opprettet sak etter et tyveri fra en butikk ved Solsiden.",
        publishedAt: "2026-06-18T14:55:00.000Z",
        places: ["Solsiden", "Trondheim"],
        location: { lat: 63.436, lng: 10.414, label: "Solsiden" },
        situationId: "politiloggen-sentrum-solsiden",
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.primary.id)).toEqual([
      "politiloggen-sentrum-1",
      "politiloggen-sentrum-2",
    ]);
  });

  it("does not let a generic city-center theft bridge distinct specific places", () => {
    const groups = groupHomeArticles([
      article({
        id: "generic-sentrum-theft",
        title: "Tyveri i Trondheim sentrum",
        excerpt:
          "En mann stjal alkohol i Trondheim sentrum og ble bortvist fra området etter hendelsen.",
        publishedAt: "2026-06-18T15:02:00.000Z",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "snurr-theft",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Tyveri: Trondheim",
        excerpt:
          "En mann stjal alkohol på bakeriet Snurr i Trondheim sentrum og ble bortvist fra stedet.",
        publishedAt: "2026-06-18T14:59:00.000Z",
        places: ["Sentrum", "Trondheim"],
        location: { lat: 63.43209, lng: 10.3991, label: "Trondheim sentrum" },
      }),
      article({
        id: "solsiden-theft",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Tyveri på Solsiden",
        excerpt: "En mann stjal alkohol fra en butikk på Solsiden i Trondheim sentrum.",
        publishedAt: "2026-06-18T14:58:00.000Z",
        places: ["Solsiden", "Trondheim"],
        location: { lat: 63.436, lng: 10.414, label: "Solsiden" },
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(
      groups
        .find((group) => group.articles.some((item) => item.id === "snurr-theft"))
        ?.articles.map((item) => item.id),
    ).toEqual(["generic-sentrum-theft", "snurr-theft"]);
    expect(groups.find((group) => group.primary.id === "solsiden-theft")?.articles).toHaveLength(1);
  });

  it("does not bundle generic Rosenborg stories without trainer-topic overlap", () => {
    const groups = groupHomeArticles([
      article({
        id: "rosenborg-trener-topic",
        source: "vg",
        sourceLabel: "VG",
        title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
        excerpt: "I dag ble han presentert som Rosenborgs nye trener.",
        publishedAt: "2026-06-18T07:34:00.000Z",
        category: "Nyheter",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "rosenborg-kamp",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Rosenborg vant klart hjemme",
        excerpt: "Laget tok tre poeng foran publikum på Lerkendal.",
        publishedAt: "2026-06-18T07:30:00.000Z",
        category: "Nyheter",
        places: ["Trondheim"],
        location: undefined,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.primary.id)).toEqual([
      "rosenborg-trener-topic",
      "rosenborg-kamp",
    ]);
  });

  it("annotates same-topic coverage with durable bundle metadata", () => {
    const annotated = annotateArticleCoverageBundles(
      [
        article({
          id: "vg-freyr-kan-bli",
          source: "vg",
          sourceLabel: "VG",
          title: "Medier: Freyr Alexandersson kan bli ny Rosenborg-trener",
          excerpt: "Islendingen er aktuell for trenerjobben i Rosenborg.",
          publishedAt: "2026-06-18T13:57:00.000Z",
          category: "Sport",
          places: ["Trondheim"],
          location: undefined,
        }),
        article({
          id: "adressa-rbk-trener",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Han kan bli RBK-trener",
          excerpt: "Freyr Alexandersson har vært i konkrete samtaler med Rosenborg.",
          publishedAt: "2026-06-18T13:50:00.000Z",
          category: "Sport",
          places: ["Trondheim"],
          location: undefined,
        }),
      ],
      "2026-06-18T14:00:00.000Z",
    );

    expect(annotated[0]?.coverageBundle).toMatchObject({
      kind: "topic",
      confidence: "high",
      reason: "Samme nyhetstema",
      generatedAt: "2026-06-18T14:00:00.000Z",
    });
    expect(annotated[1]?.coverageBundle?.id).toBe(annotated[0]?.coverageBundle?.id);
  });

  it("does not mark football club Brann topic coverage as incident coverage", () => {
    const annotated = annotateArticleCoverageBundles(
      [
        article({
          id: "vg-freyr-hovedtrener",
          source: "vg",
          sourceLabel: "VG",
          title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
          excerpt:
            "For bare to og en halv uke siden var han ferdig i Brann. I dag ble han presentert som Rosenborgs nye trener.",
          publishedAt: "2026-06-18T07:34:00.000Z",
          category: "Sport",
          places: ["Trondheim"],
          location: undefined,
        }),
        article({
          id: "adressa-rbk-trener",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Han kan bli RBK-trener",
          excerpt: "Freyr Alexandersson har vært i konkrete samtaler med Rosenborg.",
          publishedAt: "2026-06-18T07:20:00.000Z",
          category: "Sport",
          places: ["Trondheim"],
          location: undefined,
        }),
      ],
      "2026-06-18T08:00:00.000Z",
    );

    expect(annotated[0]?.coverageBundle).toMatchObject({
      kind: "topic",
      reason: "Samme nyhetstema",
    });
  });

  it("keeps generated bundle ids stable when another provider joins later", () => {
    const originalCoverage = [
      article({
        id: "vg-freyr-kan-bli",
        source: "vg",
        sourceLabel: "VG",
        title: "Medier: Freyr Alexandersson kan bli ny Rosenborg-trener",
        excerpt: "Islendingen er aktuell for trenerjobben i Rosenborg.",
        publishedAt: "2026-06-18T13:57:00.000Z",
        category: "Sport",
        places: ["Trondheim"],
        location: undefined,
      }),
      article({
        id: "adressa-rbk-trener",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Han kan bli RBK-trener",
        excerpt: "Freyr Alexandersson har vært i konkrete samtaler med Rosenborg.",
        publishedAt: "2026-06-18T13:50:00.000Z",
        category: "Sport",
        places: ["Trondheim"],
        location: undefined,
      }),
    ];
    const firstBundleId = annotateArticleCoverageBundles(
      originalCoverage,
      "2026-06-18T14:00:00.000Z",
    )[0]?.coverageBundle?.id;

    const expandedBundleId = annotateArticleCoverageBundles(
      [
        ...originalCoverage,
        article({
          id: "dagbladet-rbk",
          source: "dagbladet",
          sourceLabel: "Dagbladet",
          title: "Rosenborg nær ny trener",
          excerpt: "Freyr Alexandersson er aktuell som ny hovedtrener i Rosenborg.",
          publishedAt: "2026-06-18T14:03:00.000Z",
          category: "Sport",
          places: ["Trondheim"],
          location: undefined,
        }),
      ],
      "2026-06-18T14:10:00.000Z",
    )[0]?.coverageBundle?.id;

    expect(expandedBundleId).toBe(firstBundleId);
  });

  it("does not use persisted coverage bundle ids as grouping evidence", () => {
    const bundle = {
      id: "coverage:topic:manual",
      kind: "topic" as const,
      confidence: "high" as const,
      reason: "Samme nyhetstema",
      generatedAt: "2026-06-18T14:00:00.000Z",
    };
    const groups = groupHomeArticles([
      article({
        id: "topic-follow-up",
        source: "vg",
        sourceLabel: "VG",
        title: "Ny trener presentert",
        excerpt: "Kort oppdatering fra Lerkendal.",
        publishedAt: "2026-06-18T14:05:00.000Z",
        places: ["Trondheim"],
        location: undefined,
        coverageBundle: bundle,
      }),
      article({
        id: "topic-analysis",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kommenterer valget",
        excerpt: "Analyse fra sportsredaksjonen.",
        publishedAt: "2026-06-18T14:00:00.000Z",
        places: ["Trondheim"],
        location: undefined,
        coverageBundle: bundle,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(({ id }) => id).sort()).toEqual([
      "article:topic-analysis",
      "article:topic-follow-up",
    ]);
    expect(groups.every(({ bundle }) => bundle === undefined)).toBe(true);
    expect(
      groups.every(({ articles }) =>
        articles.every(({ coverageBundle }) => coverageBundle === undefined),
      ),
    ).toBe(true);
  });

  it("does not let stale persisted bundle ids overmerge distant articles", () => {
    const bundle = {
      id: "coverage:stale-manual",
      kind: "topic" as const,
      confidence: "high" as const,
      reason: "Samme nyhetstema",
      generatedAt: "2026-06-18T14:00:00.000Z",
    };
    const groups = groupHomeArticles([
      article({
        id: "current-topic",
        title: "Ny trener presentert",
        excerpt: "Kort oppdatering fra Lerkendal.",
        publishedAt: "2026-06-18T14:05:00.000Z",
        places: ["Trondheim"],
        location: undefined,
        coverageBundle: bundle,
      }),
      article({
        id: "old-topic",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Gammel kommentar om RBK",
        excerpt: "En eldre analyse fra sportsredaksjonen.",
        publishedAt: "2026-06-08T14:00:00.000Z",
        places: ["Trondheim"],
        location: undefined,
        coverageBundle: bundle,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.articles.map((item) => item.id))).toEqual([
      ["current-topic"],
      ["old-topic"],
    ]);
  });
});
