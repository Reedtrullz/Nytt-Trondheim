import type { Article, CoverageGenerationSummary } from "@nytt/shared";

const fixtureCompletedAt = "2026-07-13T07:00:00.000Z";
const fixtureSources = [
  ["nrk", "NRK Trøndelag"],
  ["adressa", "Adresseavisen"],
  ["nidaros", "Nidaros"],
  ["t_a", "Trønder-Avisa"],
  ["vg", "VG"],
] as const;

export function e2eCoverageFixtureArticles(advanced = false): Article[] {
  const largeGroup = Array.from({ length: 7 }, (_, index): Article => {
    const [source, sourceLabel] = fixtureSources[index % fixtureSources.length]!;
    return {
      id: `e2e-large-${index + 1}`,
      source,
      sourceLabel,
      title:
        index === 0
          ? "Stor gruppesak"
          : index === 1
            ? "Brøt seg inn og raserte flere boder i sameie: – Jeg er sjokkert"
            : index === 2
              ? "Skadeverk i boder på Lerkendal – skadeverk i boder, skadeverk i boder"
              : `Støttesak ${index}`,
      excerpt: "Sanitert E2E-innhold om samme kamp på Lerkendal.",
      url: `https://example.test/e2e-large-${index + 1}`,
      publishedAt: new Date(Date.parse(fixtureCompletedAt) - index * 60_000).toISOString(),
      scope: "trondelag",
      category: "Sport",
      places: ["Lerkendal", "Trondheim"],
      situationId: "e2e-large-group",
    };
  });
  const correctable: Article[] = [
    {
      id: "e2e-correctable-main",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Korrigerbar hovedsak",
      excerpt: "Sanitert E2E-innhold om fartskontroll i Orkland.",
      url: "https://example.test/e2e-correctable-main",
      publishedAt: "2026-07-13T06:50:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "e2e-correctable-group",
    },
    {
      id: "e2e-correctable-support",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Relatert støttesak",
      excerpt: "Sanitert E2E-innhold om samme fartskontroll i Orkland.",
      url: "https://example.test/e2e-correctable-support",
      publishedAt: "2026-07-13T06:49:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "e2e-correctable-group",
    },
    {
      id: "e2e-correctable-rejectable",
      source: "selbyggen",
      sourceLabel: "Selbyggen",
      title: "Urelatert støttesak",
      excerpt: advanced
        ? "Sanitert E2E-innhold om en annen hendelse i Selbu."
        : "Sanitert E2E-innhold med samme syntetiske hendelses-ID.",
      url: "https://example.test/e2e-correctable-rejectable",
      publishedAt: "2026-07-13T06:48:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: advanced ? ["Selbu"] : ["Orkland"],
      situationId: advanced ? "e2e-advanced-rejectable" : "e2e-correctable-group",
    },
  ];
  return [...largeGroup, ...correctable];
}

export function e2eCoverageFixtureGeneration(sequence: number): CoverageGenerationSummary {
  const completedAt = new Date(
    Date.parse(fixtureCompletedAt) + (sequence - 1) * 60_000,
  ).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    matcherVersion: "v2",
    mode: "active",
    status: "completed",
    startedAt: new Date(Date.parse(completedAt) - 1_000).toISOString(),
    completedAt,
    articleCount: 10,
    bundleCount: 2,
    edgeCount: sequence === 1 ? 8 : 7,
    correctionConflictCount: 0,
  };
}
