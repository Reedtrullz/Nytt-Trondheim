import type { Article } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { groupHomeArticles } from "./homeArticleGroups.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Tente på antibac i Trondheim",
    excerpt: "En mann i 50-åra spruta antibac på bakken og tente på det på Torvet i Trondheim.",
    url: "https://example.test/article",
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
});
