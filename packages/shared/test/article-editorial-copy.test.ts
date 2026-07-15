import { describe, expect, it } from "vitest";
import type { Article } from "../src/index.js";
import { cityPulseEditorialCopy } from "../src/index.js";

function article(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Brann på Heimdal",
    excerpt: "",
    url: `https://example.test/${id}`,
    publishedAt: "2026-07-15T03:00:00.000Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Heimdal", "Trondheim"],
    ...overrides,
  };
}

describe("independent bundle editorial copy", () => {
  it("selects a specific newsroom title and a useful official ingress independently", () => {
    const articles = [
      article("newsroom-title", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Beboere evakuert etter brann i leilighet på Heimdal",
        excerpt:
          "Adresseavisen arbeider etter Vær Varsom-plakaten. Se Redaktøransvar og Medietilsynet.",
      }),
      article("official-ingress", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Brann: Trondheim, Heimdal",
        excerpt: "Nødetatene er på Heimdal etter melding om røyk fra en leilighet.",
        publishedAt: "2026-07-15T03:05:00.000Z",
      }),
    ];

    for (const ordered of [articles, [...articles].reverse()]) {
      expect(cityPulseEditorialCopy(ordered)).toEqual({
        version: 1,
        strategy: "independent-source-v1",
        title: {
          text: "Beboere evakuert etter brann i leilighet på Heimdal",
          mode: "source",
          articleId: "newsroom-title",
          field: "title",
          rationale: "specific_source_title",
        },
        ingress: {
          text: "Nødetatene er på Heimdal etter melding om røyk fra en leilighet.",
          mode: "source",
          articleId: "official-ingress",
          field: "excerpt",
          rationale: "official_complete",
        },
      });
    }
  });

  it("fails closed instead of turning unsupported title fragments into an ingress", () => {
    const copy = cityPulseEditorialCopy([
      article("empty", { title: "Brann på Heimdal", excerpt: "" }),
      article("duplicate", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Nødetatene rykket ut til brann på Heimdal",
        excerpt: "  Nødetatene rykket ut til brann på Heimdal.  ",
      }),
      article("boilerplate", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Brann på Heimdal",
        excerpt: "Adresseavisen arbeider etter Vær Varsom-plakaten og Redaktøransvar.",
      }),
    ]);

    expect(copy.ingress).toBeUndefined();
    expect(copy.ingressFallback).toEqual({ reason: "insufficient_supported_source_text" });
    const serialized = JSON.stringify(copy).toLocaleLowerCase("nb");
    for (const forbiddenClaim of ["evakuert", "skadet", "slukket", "pågrepet", "årsak"]) {
      expect(serialized).not.toContain(forbiddenClaim);
    }
  });

  it("does not let publication time change equal-quality source copy", () => {
    const older = article("older-adressa", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Brann i leilighet på Heimdal",
      excerpt: "Nødetatene arbeider ved en leilighet på Heimdal etter melding om brann.",
      publishedAt: "2026-07-15T02:30:00.000Z",
    });
    const newer = article("newer-nrk", {
      title: older.title,
      excerpt: older.excerpt,
      publishedAt: "2026-07-15T03:30:00.000Z",
    });

    expect(cityPulseEditorialCopy([newer, older])).toEqual(cityPulseEditorialCopy([older, newer]));
    expect(cityPulseEditorialCopy([newer, older]).title.articleId).toBe("older-adressa");
    expect(cityPulseEditorialCopy([newer, older]).ingress?.articleId).toBe("older-adressa");
  });

  it("prefers a neutral specific title over a colloquial production-shaped alternative", () => {
    const copy = cityPulseEditorialCopy([
      article("dora-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kjørte båt i fylla - havnet i arresten",
        excerpt:
          "Politiet fikk kontroll på båtføreren ved Dora etter meldinger om merkelig kjøring.",
        places: ["Dora", "Trondheim"],
      }),
      article("dora-nrk", {
        title: "Fyllekjøring med båt i Trondheim",
        excerpt:
          "En båtfører blåste over lovlig verdi og ble fraktet til arresten for bevissikring.",
        places: ["Dora", "Trondheim"],
      }),
      article("dora-police", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Sjø: Trondheim, Dora",
        excerpt: "Politiet fikk kontroll på mann og båt på Dora.",
        places: ["Dora", "Trondheim"],
      }),
    ]);

    expect(copy.title.articleId).toBe("dora-nrk");
    expect(copy.title.text).toBe("Fyllekjøring med båt i Trondheim");
  });

  it("prefers a concrete regulatory title over a quote-led vague alternative", () => {
    const copy = cityPulseEditorialCopy([
      article("dahls-nidaros", {
        source: "nidaros",
        sourceLabel: "Nidaros",
        title: "Varslet ikke om årelang feil: – Vi ser alvorlig på det",
        excerpt:
          "E.C. Dahls bryggeri har holdt på i Trondheim siden 1856. Nå får de kraftig refs av myndighetene.",
        places: ["Lade", "Trondheim"],
      }),
      article("dahls-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Bryggeritabbe hos E.C. Dahls – har ikke renset på flere år",
        excerpt:
          "Da renseanlegget sluttet å virke, sa ikke E.C. Dahls ifra. Det reagerer Statsforvalteren på.",
        places: ["Lade", "Trondheim"],
      }),
    ]);

    expect(copy.title.articleId).toBe("dahls-adressa");
  });

  it("does not reward a mobile-breaking title for length alone", () => {
    const concise = article("concise", {
      title: "Politiet etterforsker innbrudd i boder på Moholt",
    });
    const overlong = article("overlong", {
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title:
        "Politiet etterforsker innbrudd i en lang rekke boder på Moholt etter at flere beboere oppdaget omfattende skader tidlig tirsdag morgen",
    });

    expect(cityPulseEditorialCopy([overlong, concise]).title.articleId).toBe("concise");
  });

  it("does not promote a supporting title with a repeated phrase", () => {
    const stable = article("stable", { title: "Stor gruppesak" });
    const repetitive = article("repetitive", {
      source: "nidaros",
      sourceLabel: "Nidaros",
      title: "Skadeverk i boder på Lerkendal – skadeverk i boder, skadeverk i boder",
    });

    expect(cityPulseEditorialCopy([repetitive, stable]).title.articleId).toBe("stable");
  });
});
