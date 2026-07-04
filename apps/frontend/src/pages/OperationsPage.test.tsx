import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CommandCenterBriefingPayload,
  NotificationTriggerPage,
  OperationsStatus,
} from "@nytt/shared";
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
    {
      source: "deepseek",
      label: "AI-analyse",
      state: "degraded",
      lastCheckedAt: "2026-06-02T06:00:00.000Z",
      detail: "AI-analyse bruker deterministisk reserveanalyse.",
    },
  ],
  articleCount: 12,
  situationCounts: {
    preliminary: 1,
    active: 2,
    resolved: 3,
    dismissed: 4,
  },
  situationPublicationCounts: {
    public: 3,
    command_center: 2,
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
    sourceLine: "Automatisk analyse · 1/2 kilder OK",
    paragraphs: [
      "Morgenbildet følger trafikk og åpne situasjoner.",
      "Analysen samlet støttende saker uten private påstander.",
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

const notificationTriggers: NotificationTriggerPage = {
  generatedAt: "2026-06-02T06:06:00.000Z",
  filters: { limit: 4 },
  summary: {
    total: 3,
    critical: 2,
    warning: 1,
    watch: 0,
    cityPulseVisible: 1,
    commandOnly: 2,
    officialBacked: 2,
    highConfidence: 2,
    spatialSignals: 1,
    spatialCritical: 1,
    unexplainedDelays: 1,
  },
  pushStatus: {
    configured: true,
    label: "Mangler match",
    detail:
      "Minst én kandidat mangler aktivt abonnement som matcher alvorlighet, type og tilgangsnivå.",
    activeSubscriptions: 1,
    matchingCandidates: 1,
    readyCandidates: 1,
    blockedCandidates: 1,
    deliveryCounts: { total: 2, sent: 1, failed: 1, claimed: 0, skipped: 0 },
  },
  items: [
    {
      id: "notification:situation:e6",
      kind: "traffic_disruption",
      severity: "critical",
      deliveryState: "ready",
      title: "Kollisjon stenger E6",
      body: "E6 er stengt etter kollisjon.",
      detail: "Klar for Web Push.",
      score: 0.91,
      confidence: {
        level: "confirmed",
        score: 0.91,
        sourceCount: 2,
        updatedAt: "2026-06-02T06:06:00.000Z",
      },
      generatedAt: "2026-06-02T06:06:00.000Z",
      eventUpdatedAt: "2026-06-02T06:05:00.000Z",
      situationId: "e6",
      articleIds: ["article:e6"],
      sourceIds: ["datex", "adressa"],
      sourceLabels: ["Vegvesen DATEX", "Adresseavisen"],
      matchedKeywords: ["stengt"],
      reasons: ["Har offentlig kildegrunnlag."],
      links: [{ kind: "situation", label: "Åpne situasjon", href: "/situasjoner/e6" }],
      publicSurface: {
        state: "visible",
        label: "Synlig på Bypuls",
        detail: "Sjekk rute nå · Oppdatert nå",
        reason: "Samme offentlige varselregel treffer City Pulse-datasettet.",
        attention: {
          label: "Sjekk rute nå",
          detail: "Hendelsen kan påvirke reisevei eller framkommelighet.",
          tone: "urgent",
        },
        recencyLabel: "Oppdatert nå",
        link: { kind: "situation", label: "Åpne situasjonsrom", href: "/situasjoner/e6" },
      },
    },
    {
      id: "notification:article:fire",
      kind: "public_safety",
      severity: "warning",
      deliveryState: "no_subscribers",
      title: "Røykutvikling på Lade",
      body: "Nødetatene er på vei.",
      detail: "Ingen abonnent.",
      score: 0.72,
      confidence: {
        level: "likely",
        score: 0.72,
        sourceCount: 1,
        updatedAt: "2026-06-02T06:06:00.000Z",
      },
      generatedAt: "2026-06-02T06:06:00.000Z",
      eventUpdatedAt: "2026-06-02T06:04:00.000Z",
      articleIds: ["article:fire"],
      sourceIds: ["nrk"],
      sourceLabels: ["NRK Trøndelag"],
      matchedKeywords: ["røyk"],
      reasons: ["Høyeffektspråk: røyk."],
      links: [{ kind: "external", label: "NRK Trøndelag", href: "https://example.test/fire" }],
      publicSurface: {
        state: "hidden",
        label: "Ikke vist på Bypuls",
        detail: "Kandidaten er beholdt for operatørvurdering, men vises ikke som offentlig signal.",
        reason:
          "Artikkelkandidaten er under offentlig visningsterskel eller mangler public-safe signalgrunnlag.",
      },
    },
    {
      id: "notification:spatial:delay:e6-sluppen",
      kind: "traffic_disruption",
      severity: "critical",
      deliveryState: "candidate_only",
      title: "Uforklart kø på Omkjøringsvegen",
      body: "DATEX reisetid viser kø uten koblet nyhetssak.",
      detail: "Romlig analyse har flagget et trafikkavvik for operatørvurdering.",
      score: 0.84,
      confidence: {
        level: "confirmed",
        score: 0.84,
        sourceCount: 1,
        updatedAt: "2026-06-02T06:06:00.000Z",
      },
      generatedAt: "2026-06-02T06:06:00.000Z",
      eventUpdatedAt: "2026-06-02T06:05:00.000Z",
      articleIds: [],
      sourceIds: ["datex_travel_time"],
      sourceLabels: ["Vegvesen reisetid"],
      matchedKeywords: ["uforklart forsinkelse"],
      reasons: [
        "Romlig analyse kobler telemetri, trafikkbilde og nyhetsdekning.",
        "Ingen nyhetssak er koblet til forsinkelsen.",
      ],
      links: [
        {
          kind: "source_item",
          label: "Rå reisetid",
          href: "/command/radata?telemetrySource=datex_travel_time&telemetryId=e6-sluppen",
        },
      ],
      publicSurface: {
        state: "hidden",
        label: "Kun Command Center",
        detail: "Dette er et romlig operatørsignal og vises ikke direkte på City Pulse.",
        reason:
          "Telemetriavvik krever manuell kontroll mot trafikkart, nyheter og offisielle hendelser før offentlig varsel.",
      },
    },
  ],
};

describe("OperationsDashboard", () => {
  it("renders worker cycle metrics as operational telemetry", () => {
    const html = renderToStaticMarkup(
      <OperationsDashboard
        status={status}
        briefing={briefing}
        notificationTriggers={notificationTriggers}
        lastFetchedAt="2026-06-02T06:06:30.000Z"
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("Worker-syklus");
    expect(html).toContain("Operatørfeed");
    expect(html).toContain("Oppdater nå");
    expect(html).toContain("Oppdateres hvert minutt mens fanen er synlig.");
    expect(html).toContain("Operasjonell telemetri");
    expect(html).toContain("Dette er ikke hendelsesbevis");
    expect(html).toContain("3.3 sek");
    expect(html).toContain("Vegvesen DATEX");
    expect(html).toContain("Parsefeil");
    expect(html).toContain("2");
    expect(html).toContain("3 operasjonelle objekter");
    expect(html).toContain("Kilder som trenger tilsyn");
    expect(html).toContain("<span>Kilder som trenger tilsyn</span><strong>1</strong>");
    expect(html).toContain("Worker");
    expect(html).toContain("Sist fullført 4 min siden.");
    expect(html).toContain("Utdatert");
    expect(html).toContain("Gjenopprettingstest");
    expect(html).toContain("Kommandosenter");
    expect(html).toContain("2 kun Command Center");
    expect(html).toContain("Intelligence Bridge");
    expect(html).toContain("Morgenbrief, analysespor");
    expect(html).toContain("ai_assisted");
    expect(html).toContain("Analysemodus");
    expect(html).toContain("Provideranalyse brukt");
    expect(html).toContain("deepseek-v4-flash fullførte");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain("Kildehelse viser ett tilsynspunkt.");
    expect(html).toContain("/command/brief");
    expect(html).toContain("Åpne brief-revisjon");
    expect(html).toContain("Command Center-matrise");
    expect(html).toContain("Hva hver privat flate beviser");
    expect(html).toContain("Brief Analysis");
    expect(html).not.toContain("AI Summary Generator");
    expect(html).not.toContain("DeepSeek ·");
    expect(html).toContain("Brief klar");
    expect(html).toContain("/command/dekning");
    expect(html).toContain("Event Clustering");
    expect(html).toContain("Lesbar audit");
    expect(html).toContain("Åpne dekningsgrupper");
    expect(html).toContain("/command/tidslinje");
    expect(html).toContain("Source Traceability");
    expect(html).toContain("3 aktuelle situasjoner");
    expect(html).toContain("Åpne tidslinje");
    expect(html).toContain("/command/varsler");
    expect(html).toContain("Åpne varselutløsere");
    expect(html).toContain("Push Notification Trigger");
    expect(html).toContain("1 klare · 1 blokkert");
    expect(html).toContain("Varselbro");
    expect(html).toContain("Høyeffektskandidater");
    expect(html).toContain("Mangler match");
    expect(html).toContain("Bypuls");
    expect(html).toContain("2 kun Command Center");
    expect(html).toContain("1 klare · 1 sendt");
    expect(html).toContain("Kollisjon stenger E6");
    expect(html).toContain("Vegvesen DATEX, Adresseavisen");
    expect(html).toContain("Synlig på Bypuls");
    expect(html).toContain("Uforklart kø på Omkjøringsvegen");
    expect(html).toContain("Vegvesen reisetid");
    expect(html).toContain("91 %");
    expect(html).toContain("/command/romlig");
    expect(html).toContain("PostGIS Heatmaps");
    expect(html).toContain("1 romlig signal");
    expect(html).toContain("1 uforklart forsinkelse · 1 kritisk signal.");
    expect(html).toContain("Åpne romlig analyse");
    expect(html).toContain("/command/radata");
    expect(html).toContain("Raw Data Inspector");
    expect(html).toContain("3 objekter");
    expect(html).toContain("Åpne rådata");
    expect(html).toContain("Source Health");
    expect(html).toContain("1 trenger tilsyn");
    expect(html).toContain("Auth Gate");
    expect(html).toContain("Eierstyrt");
  });

  it("makes deterministic analysis mode visible in the command matrix", () => {
    const deterministicBriefing: CommandCenterBriefingPayload = {
      ...briefing,
      morningBrief: {
        ...briefing.morningBrief!,
        mode: "deterministic",
        sourceLine: "Deterministisk reserve · 1/2 kilder OK",
        aiRun: {
          provider: "deterministic",
          model: "none",
          status: "disabled",
          completedAt: "2026-06-02T06:04:00.000Z",
        },
      },
      latestAiRun: {
        id: "ai:deterministic",
        provider: "deterministic",
        model: "none",
        status: "disabled",
        startedAt: "2026-06-02T06:03:00.000Z",
        completedAt: "2026-06-02T06:04:00.000Z",
        articleCount: 24,
        error: "DEEPSEEK_ANALYSIS_ENABLED er ikke satt til true; deterministisk analyse brukes.",
      },
    };

    const html = renderToStaticMarkup(
      <OperationsDashboard status={status} briefing={deterministicBriefing} />,
    );

    expect(html).toContain("Intelligence Bridge");
    expect(html).toContain("Analysemodus");
    expect(html).toContain("Deterministisk reserve");
    expect(html).toContain("Provideranalyse er avslått");
    expect(html).toContain("regelbasert clustering");
    expect(html).toContain("Brief klar");
    expect(html).not.toContain("DeepSeek ·");
  });

  it("does not imply zero failures before worker metrics exist", () => {
    const withoutMetrics: OperationsStatus = { ...status, workerCycleMetrics: undefined };
    const html = renderToStaticMarkup(<OperationsDashboard status={withoutMetrics} />);

    expect(html).toContain("Siste syklus");
    expect(html).toContain("Ingen fullført worker-syklus");
    expect(html).toContain("Ingen måling");
    expect(html).toContain("Varselutløsere beregnes separat");
  });

  it("renders refresh progress and stale-refresh errors without hiding the dashboard", () => {
    const html = renderToStaticMarkup(
      <OperationsDashboard
        status={status}
        refreshing={true}
        refreshError="Driftstatus kunne ikke oppdateres."
        lastFetchedAt="2026-06-02T06:06:30.000Z"
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Oppdaterer");
    expect(html).toContain("Driftstatus kunne ikke oppdateres.");
    expect(html).toContain("Kommandosenter-moduler");
    expect(html).toContain("Tilpass oppsett");
    expect(html).not.toContain("Dashboard-oppsett");
    expect(html).not.toContain("Tilbakestill");
  });
});
