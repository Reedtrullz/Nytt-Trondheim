import type { Article } from "../../src/index.js";

export function correctionFixtureArticles(): Article[] {
  return [
    {
      id: "speed-a",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Kjørte i nær 200",
      excerpt: "Politiet stanset bilen i Orkland.",
      url: "https://example.test/speed-a",
      publishedAt: "2026-07-12T20:00:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
    {
      id: "speed-b",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Høy fart i Orkland",
      excerpt: "Bilen ble stanset etter svært høy fart.",
      url: "https://example.test/speed-b",
      publishedAt: "2026-07-12T19:59:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
    {
      id: "threat",
      source: "selbyggen",
      sourceLabel: "Selbyggen",
      title: "Syntetisk støttesak som eieren avviser",
      excerpt: "Testdata med samme syntetiske hendelses-ID.",
      url: "https://example.test/threat",
      publishedAt: "2026-07-12T19:58:00.000Z",
      scope: "trondelag",
      category: "Krim",
      places: ["Orkland"],
      situationId: "synthetic-correction-case",
    },
  ];
}
