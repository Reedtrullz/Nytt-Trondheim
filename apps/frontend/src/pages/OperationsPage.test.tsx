import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommandCenterBriefingPayload, OperationsStatus } from "@nytt/shared";
import { OperationsDashboard } from "./OperationsPage.js";

const status: OperationsStatus = {
  sources: [
    {
      source: "nrk",
      label: "NRK Trøndelag",
      state: "ok",
      lastCheckedAt: "2026-06-02T06:00:00.000Z",
      detail: "RSS",
    },
    {
      source: "datex",
      label: "Vegvesen DATEX",
      state: "degraded",
      lastCheckedAt: "2026-06-02T06:00:00.000Z",
      detail: "DATEX feilet",
    },
  ],
  articleCount: 12,
  situationCounts: {
    preliminary: 1,
    active: 2,
    resolved: 3,
    dismissed: 4,
  },
  latestCollectionAt: "2026-06-02T06:00:00.000Z",
  trafficPulse: [],
  workerCycleMetrics: {
    cycleStartedAt: "2026-06-02T06:00:00.000Z",
    cycleCompletedAt: "2026-06-02T06:00:03.250Z",
    cycleDurationMs: 3250,
    sourceDurationsMs: {
      nrk: 240,
      datex: 920,
    },
    sourceItemCounts: {
      nrk: 2,
      datex: 1,
    },
    parseFailures: {
      datex: 2,
    },
  },
  workerFreshness: {
    status: "ok",
    label: "Worker-syklus",
    detail: "Sist fullført 4 min siden.",
    checkedAt: "2026-06-02T06:05:00.000Z",
    completedAt: "2026-06-02T06:00:03.250Z",
    staleAfterSeconds: 7200,
    ageSeconds: 297,
  },
  backup: {
    status: "ok",
    label: "Sikkerhetskopi",
    detail: "Sist fullført 65 min siden.",
    checkedAt: "2026-06-02T06:05:00.000Z",
    completedAt: "2026-06-02T05:00:00.000Z",
    staleAfterSeconds: 129600,
    ageSeconds: 3900,
  },
  restoreCheck: {
    status: "stale",
    label: "Gjenopprettingstest",
    detail: "Sist fullført 9 døgn siden; forventet innen 8 døgn siden.",
    checkedAt: "2026-06-11T06:05:00.000Z",
    completedAt: "2026-06-02T04:00:00.000Z",
    staleAfterSeconds: 691200,
    ageSeconds: 785100,
  },
};

const briefing: CommandCenterBriefingPayload = {
  generatedAt: "2026-06-02T06:04:00.000Z",
  morningBrief: {
    generatedAt: "2026-06-02T06:04:00.000Z",
    title: "Morgenbrief",
    mode: "ai_assisted",
    sourceLine: "AI-assistert · 1/2 kilder OK",
    paragraphs: [
      "Morgenbildet følger trafikk og åpne situasjoner.",
      "DeepSeek samlet støttende saker uten private påstander.",
      "Kildehelse viser ett tilsynspunkt.",
    ],
    highlights: [
      { label: "Saker", value: "12", detail: "Hendelser leder bildet" },
      { label: "Situasjoner", value: "3", detail: "Aktive eller til vurdering" },
      { label: "Kilder", value: "1/2", detail: "Rapporterer OK" },
    ],
    articleIds: ["article:one"],
    situationIds: [],
  },
  latestAiRun: {
    id: "ai:one",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    status: "ok",
    startedAt: "2026-06-02T06:03:00.000Z",
    completedAt: "2026-06-02T06:04:00.000Z",
    articleCount: 24,
  },
  operationsNotes: [],
  supportingArticles: [],
  supportingSituations: [],
  sourceHealthSummary: {
    total: 2,
    ok: 1,
    attention: 1,
    degraded: 1,
    disabled: 0,
    staleAlerts: 0,
  },
  attentionSources: [],
};

describe("OperationsDashboard", () => {
  it("renders worker cycle metrics as operational telemetry", () => {
    const html = renderToStaticMarkup(<OperationsDashboard status={status} briefing={briefing} />);

    expect(html).toContain("Worker-syklus");
    expect(html).toContain("Operasjonell telemetri");
    expect(html).toContain("Dette er ikke hendelsesbevis");
    expect(html).toContain("3.3 sek");
    expect(html).toContain("Vegvesen DATEX");
    expect(html).toContain("Parsefeil");
    expect(html).toContain("2");
    expect(html).toContain("3 operasjonelle objekter");
    expect(html).toContain("Kilder som trenger tilsyn");
    expect(html).toContain("Worker");
    expect(html).toContain("Sist fullført 4 min siden.");
    expect(html).toContain("Utdatert");
    expect(html).toContain("Gjenopprettingstest");
    expect(html).toContain("Kommandosenter");
    expect(html).toContain("Intelligence Bridge");
    expect(html).toContain("Morgenbrief, AI-spor");
    expect(html).toContain("ai_assisted");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain("Kildehelse viser ett tilsynspunkt.");
    expect(html).toContain("/command/brief");
    expect(html).toContain("Åpne brief-revisjon");
    expect(html).toContain("/command/dekning");
    expect(html).toContain("Åpne dekningsgrupper");
    expect(html).toContain("/command/tidslinje");
    expect(html).toContain("Åpne tidslinje");
    expect(html).toContain("/command/varsler");
    expect(html).toContain("Åpne varselutløsere");
    expect(html).toContain("/command/romlig");
    expect(html).toContain("Åpne romlig analyse");
    expect(html).toContain("/command/radata");
    expect(html).toContain("Åpne rådata");
  });

  it("does not imply zero failures before worker metrics exist", () => {
    const withoutMetrics: OperationsStatus = { ...status, workerCycleMetrics: undefined };
    const html = renderToStaticMarkup(<OperationsDashboard status={withoutMetrics} />);

    expect(html).toContain("Siste syklus");
    expect(html).toContain("Ingen fullført worker-syklus");
    expect(html).toContain("Ingen måling");
  });
});
