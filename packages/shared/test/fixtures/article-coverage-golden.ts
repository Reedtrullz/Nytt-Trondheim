import type { Article, ArticleCoverageGoldenCase } from "../../src/index.js";

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

export const articleCoverageGoldenCases: ArticleCoverageGoldenCase[] = [
  {
    id: "rbk-match-coverage",
    articles: [
      article("rbk-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Har begynt å kalle ham Zlatan",
        excerpt: "RBK-spissen scoret et praktfullt mål i seieren mot Kristiansund.",
        category: "Sport",
        places: ["Lerkendal", "Trondheim"],
      }),
      article("rbk-nrk", {
        title: "Seier på Lerkendal",
        excerpt: "Rosenborg slo Kristiansund 3-0 på Lerkendal.",
        category: "Sport",
        places: ["Lerkendal", "Trondheim"],
        publishedAt: "2026-07-12T19:09:00.000Z",
      }),
    ],
    expectedSamePairs: [["rbk-adressa", "rbk-nrk"]],
    expectedSeparatePairs: [],
    expectedGroups: [["rbk-adressa", "rbk-nrk"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
  {
    id: "syndicated-profile",
    articles: [
      article("profile-ta", {
        source: "t_a",
        sourceLabel: "Trønder-Avisa",
        title: "Mistet foreldrene med ett års mellomrom: Det var tøft",
        excerpt: "Nå ønsker Heidi å videreføre det foreldrene lærte henne.",
        category: "Nyheter",
        places: ["Trondheim"],
      }),
      article("profile-nidaros", {
        source: "nidaros",
        sourceLabel: "Nidaros",
        title: "Senterlederen mistet begge foreldrene med ett års mellomrom",
        excerpt: "Nå ønsker Heidi å videreføre det foreldrene lærte henne.",
        category: "Nyheter",
        places: ["Trondheim"],
        publishedAt: "2026-07-12T05:14:00.000Z",
      }),
    ],
    expectedSamePairs: [["profile-ta", "profile-nidaros"]],
    expectedSeparatePairs: [],
    expectedGroups: [["profile-ta", "profile-nidaros"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
  {
    id: "speeding-versus-threat",
    articles: [
      article("speed-a", {
        source: "avisa_st",
        sourceLabel: "Avisa Sør-Trøndelag",
        title: "Ungdommer kjørte i nær 200 kilometer i timen",
        excerpt: "Politiet fikk kontroll på bilen etter svært høy fart.",
        category: "Krim",
        places: ["Orkland"],
      }),
      article("speed-b", {
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Stanset ungdommer etter kjøring i 200",
        excerpt: "Politiet har kontroll på ungdommene etter kjøringen.",
        category: "Krim",
        places: ["Orkland"],
        publishedAt: "2026-07-12T19:55:00.000Z",
      }),
      article("threat-selbyggen", {
        source: "selbyggen",
        sourceLabel: "Selbyggen",
        title: "Mann pågrepet etter en trussel- og voldssituasjon",
        excerpt: "Politiet har kontroll på mannen etter at ungdom tok kontakt.",
        category: "Krim",
        places: ["Selbu"],
        publishedAt: "2026-07-12T19:50:00.000Z",
      }),
    ],
    expectedSamePairs: [["speed-a", "speed-b"]],
    expectedSeparatePairs: [
      ["speed-a", "threat-selbyggen"],
      ["speed-b", "threat-selbyggen"],
    ],
    expectedGroups: [["speed-a", "speed-b"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
  {
    id: "construction-fire-versus-cooking",
    articles: [
      article("fire-nrk", {
        title: "Brann i brakke på byggeplass",
        excerpt: "Nødetatene rykket til en anleggsbrakke i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("fire-adressa", {
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Brakke brant på byggeplass i Nærøysund",
        excerpt: "Brannvesenet fikk kontroll på brannen i anleggsbrakka.",
        places: ["Nærøysund"],
        publishedAt: "2026-07-12T19:55:00.000Z",
      }),
      article("cooking-nrk", {
        title: "Stekte Fjordland med plasten på",
        excerpt: "Matlagingen førte til røyk i en bolig på Møllenberg.",
        places: ["Møllenberg", "Trondheim"],
        publishedAt: "2026-07-12T19:50:00.000Z",
      }),
    ],
    expectedSamePairs: [["fire-nrk", "fire-adressa"]],
    expectedSeparatePairs: [
      ["fire-nrk", "cooking-nrk"],
      ["fire-adressa", "cooking-nrk"],
    ],
    expectedGroups: [["fire-nrk", "fire-adressa"]],
    expectedVerifiedGroups: [],
    critical: true,
    provenance: "sanitized-production-shape",
  },
];
