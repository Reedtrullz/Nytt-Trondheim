import type { Article, CityPulseEditorialSelection } from "../../src/index.js";

export interface ArticleEditorialSelectionGoldenCase {
  id: string;
  label: string;
  articles: Article[];
  expectedArticleId: string;
  expectedRationale: CityPulseEditorialSelection["rationale"];
}

function article(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Politiet rykket ut til Saupstad",
    excerpt: "Politiet rykket ut til Saupstad etter melding om en hendelse i området.",
    url: `https://example.test/${id}`,
    publishedAt: "2026-07-15T03:00:00.000Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Saupstad", "Trondheim"],
    ...overrides,
  };
}

export const articleEditorialSelectionGoldenCases: ArticleEditorialSelectionGoldenCase[] = [
  {
    id: "newsroom-over-newer-official",
    label: "Komplett redaksjonell ingress slår nyere, knapp offisiell oppdatering",
    articles: [
      article("nrk-complete", { publishedAt: "2026-07-15T02:50:00.000Z" }),
      article("police-newest", {
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Ro og orden: Saupstad",
        excerpt: "Politiet har kontroll etter hendelsen på Saupstad.",
        publishedAt: "2026-07-15T03:00:00.000Z",
      }),
    ],
    expectedArticleId: "nrk-complete",
    expectedRationale: "newsroom_complete",
  },
  {
    id: "official-over-boilerplate",
    label: "Nyttig offisiell ingress slår redaksjonell juridisk boilerplate",
    articles: [
      article("adressa-boilerplate", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        excerpt:
          "Adresseavisen arbeider etter Vær Varsom-plakaten. Se Redaktøransvar og Medietilsynet.",
      }),
      article("municipality-complete", {
        source: "trondheim_kommune",
        sourceLabel: "Trondheim kommune",
        title: "Vannlekkasje på Saupstad",
        excerpt: "Vannet er stengt i tre gater mens kommunen reparerer lekkasjen.",
      }),
    ],
    expectedArticleId: "municipality-complete",
    expectedRationale: "official_complete",
  },
  {
    id: "richer-newsroom-copy",
    label: "Mer informativ redaksjonell ingress vinner innen samme kildetrinn",
    articles: [
      article("short-newsroom", {
        source: "vg",
        sourceLabel: "VG",
        excerpt: "Politiet undersøker hendelsen på Saupstad.",
      }),
      article("rich-newsroom", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        excerpt: "Politiet undersøker hendelsen på Saupstad og ber vitner fra området ta kontakt.",
      }),
    ],
    expectedArticleId: "rich-newsroom",
    expectedRationale: "newsroom_complete",
  },
  {
    id: "best-available-title",
    label: "Beskrivende redaksjonell tittel vinner når alle ingresser mangler",
    articles: [
      article("generic-title", { title: "Oppdatering", excerpt: "" }),
      article("specific-title", {
        title: "Politiet åpner Saupstadringen etter hendelsen",
        excerpt: "",
      }),
    ],
    expectedArticleId: "specific-title",
    expectedRationale: "best_available",
  },
  {
    id: "timestamp-independent-tie",
    label: "Lik tekstkvalitet avgjøres stabilt uten publiseringstid",
    articles: [
      article("newer-nrk", {
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        publishedAt: "2026-07-15T03:10:00.000Z",
      }),
      article("older-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        publishedAt: "2026-07-15T02:40:00.000Z",
      }),
    ],
    expectedArticleId: "older-adressa",
    expectedRationale: "newsroom_complete",
  },
];
