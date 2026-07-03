import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { NotificationTriggerPage } from "@nytt/shared";
import { NotificationTriggerCandidatesDashboard } from "./NotificationTriggerCandidatesPage.js";

const page: NotificationTriggerPage = {
  generatedAt: "2026-07-02T09:45:00.000Z",
  filters: { limit: 30 },
  summary: {
    total: 1,
    critical: 1,
    warning: 0,
    watch: 0,
    officialBacked: 1,
    highConfidence: 1,
  },
  pushStatus: {
    configured: true,
    label: "Klar",
    detail: "Web Push er konfigurert og kandidatene er vurdert for levering.",
    activeSubscriptions: 1,
    matchingCandidates: 1,
    readyCandidates: 0,
    blockedCandidates: 0,
    deliveryCounts: { total: 1, sent: 1, failed: 0, claimed: 0, skipped: 0 },
    health: {
      source: "web_push",
      label: "Web Push",
      state: "ok",
      lastCheckedAt: "2026-07-02T09:46:00.000Z",
      detail: "1 kandidater vurdert, 1 sendt",
    },
  },
  items: [
    {
      id: "notification:situation:road-one",
      kind: "traffic_disruption",
      severity: "critical",
      deliveryState: "sent",
      title: "Steinsprang, vegen er stengt",
      body: "Gangåsvegen: Vegen er stengt og omkjøring er skiltet.",
      detail: "Push-varsel er sendt for denne utløseren.",
      score: 0.91,
      confidence: {
        level: "confirmed",
        score: 0.91,
        sourceCount: 2,
        updatedAt: "2026-07-02T09:45:00.000Z",
      },
      generatedAt: "2026-07-02T09:45:00.000Z",
      eventUpdatedAt: "2026-07-02T09:40:00.000Z",
      situationId: "road-one",
      articleIds: ["article-one"],
      sourceIds: ["datex", "adressa"],
      sourceLabels: ["Vegvesen DATEX", "Adresseavisen"],
      matchedKeywords: ["stengt", "omkjøring"],
      reasons: [
        "Situasjonen er markert med høy operativ prioritet.",
        "Har offentlig kildegrunnlag.",
      ],
      links: [
        {
          kind: "situation",
          label: "Åpne situasjon",
          href: "/situasjoner/road-one",
          situationId: "road-one",
        },
        {
          kind: "source_audit",
          label: "Kildeaudit: Statens vegvesen DATEX",
          href: "/command/kilder?sources=datex&detail=datex",
          sourceId: "datex",
        },
        {
          kind: "source_item",
          label: "Rådata: Statens vegvesen DATEX",
          href: "/command/radata?sourceItem=source%3Adatex-one",
          sourceId: "datex",
          sourceItemId: "source:datex-one",
        },
      ],
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
        link: {
          kind: "situation",
          label: "Åpne situasjonsrom",
          href: "/situasjoner/road-one",
          situationId: "road-one",
        },
      },
    },
  ],
};

const deliveries = {
  generatedAt: "2026-07-02T09:46:00.000Z",
  items: [
    {
      id: "delivery-one",
      triggerId: "notification:situation:road-one",
      subscriptionId: "subscription-one",
      userId: "viewer-one",
      status: "sent" as const,
      kind: "traffic_disruption" as const,
      severity: "critical" as const,
      title: "Steinsprang, vegen er stengt",
      body: "Gangåsvegen: Vegen er stengt.",
      score: 0.91,
      confidence: {
        level: "confirmed" as const,
        score: 0.91,
        sourceCount: 2,
        updatedAt: "2026-07-02T09:45:00.000Z",
      },
      sourceLabels: ["Vegvesen DATEX", "Adresseavisen"],
      matchedKeywords: ["stengt", "omkjøring"],
      reasons: ["Har offentlig kildegrunnlag."],
      createdAt: "2026-07-02T09:46:00.000Z",
      sentAt: "2026-07-02T09:46:01.000Z",
    },
  ],
  summary: { total: 1, sent: 1, failed: 0, claimed: 0, skipped: 0 },
};

describe("NotificationTriggerCandidatesDashboard", () => {
  it("renders candidates with delivery disclaimers and reasons", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30 }}
          deliveries={deliveries}
          onFiltersChange={vi.fn()}
          page={page}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Varselutløsere");
    expect(html).toContain("Web Push-kanal");
    expect(html).toContain("Operatørprioritet");
    expect(html).toContain("Sendt: Steinsprang, vegen er stengt");
    expect(html).toContain("Push-varsel er allerede sendt for denne utløseren.");
    expect(html).toContain("Klar");
    expect(html).toContain("1/1");
    expect(html).toContain("Ingen kjente blokkere");
    expect(html).toContain("Kildehelse kontrollert");
    expect(html).toContain("Siste leveranser");
    expect(html).toContain("1 sendt");
    expect(html).toContain("91 % score");
    expect(html).toContain("Vegvesen DATEX, Adresseavisen");
    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("Kritisk");
    expect(html).toContain("Sendt");
    expect(html).toContain("Bypuls");
    expect(html).toContain("Synlig på Bypuls");
    expect(html).toContain("Sjekk rute nå · Oppdatert nå");
    expect(html).toContain("Sporbarhet");
    expect(html).toContain("1 audit · 1 rådata");
    expect(html).toContain("Operatørvalg");
    expect(html).not.toContain("Ikke sendt");
    expect(html).toContain("Push-varsel er sendt for denne utløseren");
    expect(html).toContain("Har offentlig kildegrunnlag");
    expect(html).toContain("stengt");
    expect(html).toContain("/situasjoner/road-one");
    expect(html).toContain("Kildeaudit");
    expect(html).toContain("/command/kilder?sources=datex&amp;detail=datex");
    expect(html).toContain("Rådata");
    expect(html).toContain("/command/radata?sourceItem=source%3Adatex-one");
  });

  it("renders spatial anomaly candidates as command-center-only raw telemetry signals", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30, traceStates: ["raw_evidence"] }}
          deliveries={deliveries}
          onFiltersChange={vi.fn()}
          page={{
            ...page,
            summary: {
              total: 1,
              critical: 0,
              warning: 1,
              watch: 0,
              officialBacked: 0,
              highConfidence: 0,
            },
            items: [
              {
                ...page.items[0]!,
                id: "notification:spatial:investigation:delay:e6-south:100141",
                kind: "traffic_disruption",
                severity: "warning",
                deliveryState: "candidate_only",
                title: "E6 Okstadbakken - E6 Sluppenrampene",
                body: "6 min forsinkelse uten kjent årsak",
                detail: "Romlig analyse har flagget et trafikkavvik for operatørvurdering.",
                score: 0.74,
                confidence: {
                  level: "likely",
                  label: "Sannsynlig",
                  score: 0.67,
                  sourceCount: 2,
                  updatedAt: "2026-07-02T09:40:00.000Z",
                },
                generatedAt: "2026-07-02T09:45:00.000Z",
                eventUpdatedAt: "2026-07-02T09:40:00.000Z",
                situationId: undefined,
                articleIds: [],
                sourceIds: ["datex_travel_time"],
                sourceLabels: ["DATEX reisetid"],
                matchedKeywords: ["uforklart forsinkelse"],
                reasons: [
                  "Romlig analyse kobler telemetri, trafikkbilde og nyhetsdekning.",
                  "DATEX viser ca. 6 min forsinkelse uten koblet trafikkhendelse.",
                ],
                links: [
                  {
                    kind: "source_audit",
                    label: "Kildeaudit: DATEX reisetid",
                    href: "/command/kilder?sources=datex_travel_time&detail=datex_travel_time",
                    sourceId: "datex_travel_time",
                  },
                  {
                    kind: "source_item",
                    label: "Rådata: DATEX reisetid",
                    href: "/command/radata?telemetrySource=datex_travel_time&telemetryId=100141",
                    sourceId: "datex_travel_time",
                    sourceItemId: "telemetry:datex_travel_time:100141",
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
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("E6 Okstadbakken - E6 Sluppenrampene");
    expect(html).toContain("Kun Command Center");
    expect(html).toContain("romlig operatørsignal");
    expect(html).toContain("1 audit · 1 rådata");
    expect(html).toContain("uforklart forsinkelse");
    expect(html).toContain(
      "/command/radata?telemetrySource=datex_travel_time&amp;telemetryId=100141",
    );
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30 }}
          deliveries={{
            ...deliveries,
            items: [],
            summary: { total: 0, sent: 0, failed: 0, claimed: 0, skipped: 0 },
          }}
          onFiltersChange={vi.fn()}
          page={{
            ...page,
            items: [],
            summary: {
              total: 0,
              critical: 0,
              warning: 0,
              watch: 0,
              officialBacked: 0,
              highConfidence: 0,
            },
            pushStatus: {
              configured: true,
              label: "Klar",
              detail: "Ingen kandidater i nåværende filter.",
              activeSubscriptions: 1,
              matchingCandidates: 0,
              readyCandidates: 0,
              blockedCandidates: 0,
              deliveryCounts: { total: 0, sent: 0, failed: 0, claimed: 0, skipped: 0 },
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen varselkandidater matcher filtrene.");
    expect(html).toContain("Ingen aktive kandidater");
    expect(html).toContain("Ingen kandidat valgt");
  });

  it("renders no-subscriber readiness honestly", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30 }}
          deliveries={deliveries}
          onFiltersChange={vi.fn()}
          page={{
            ...page,
            items: [
              {
                ...page.items[0]!,
                deliveryState: "no_subscribers",
                detail: "Ingen aktive push-abonnement matcher alvorlighet, type og tilgangsnivå.",
              },
            ],
            pushStatus: {
              configured: true,
              label: "Mangler match",
              detail:
                "Minst én kandidat mangler aktivt abonnement som matcher alvorlighet, type og tilgangsnivå.",
              activeSubscriptions: 0,
              matchingCandidates: 0,
              readyCandidates: 0,
              blockedCandidates: 1,
              deliveryCounts: { total: 0, sent: 0, failed: 0, claimed: 0, skipped: 0 },
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen abonnent");
    expect(html).toContain("Blokkert: Steinsprang, vegen er stengt");
    expect(html).toContain(
      "Ingen aktive push-abonnement matcher alvorlighet, type og tilgangsnivå.",
    );
    expect(html).toContain("Mangler match");
    expect(html).toContain("Må følges opp");
    expect(html).toContain("Ingen aktive nettleserabonnement er registrert.");
    expect(html).toContain("1 kandidat mangler match eller har feilet levering.");
  });

  it("can render a delivery-state-filtered operator list", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30, deliveryStates: ["no_subscribers"] }}
          onFiltersChange={vi.fn()}
          page={{
            ...page,
            summary: {
              ...page.summary,
              total: 2,
            },
            items: [
              page.items[0]!,
              {
                ...page.items[0]!,
                id: "notification:article:violence-one",
                title: "Ung mann kritisk skadd",
                body: "Ingen aktive abonnenter matcher denne typen akkurat nå.",
                deliveryState: "no_subscribers",
                detail: "Ingen aktive push-abonnement matcher alvorlighet, type og tilgangsnivå.",
              },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Levering");
    expect(html).toContain("1 vist av 2");
    expect(html).toContain("Ung mann kritisk skadd");
    expect(html).toContain("Ingen abonnent");
    expect(html).toContain(
      "Ingen aktive push-abonnement matcher alvorlighet, type og tilgangsnivå.",
    );
    expect(html).not.toContain("Steinsprang, vegen er stengt</strong>");
  });

  it("can render a trace-state-filtered operator list", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30, traceStates: ["raw_evidence"] }}
          onFiltersChange={vi.fn()}
          page={{
            ...page,
            summary: {
              ...page.summary,
              total: 2,
            },
            items: [
              page.items[0]!,
              {
                ...page.items[0]!,
                id: "notification:article:external-one",
                title: "Politiet oppdaterer om voldshendelse",
                body: "Kun ekstern kilde i denne fixture-kandidaten.",
                links: [
                  {
                    kind: "external",
                    label: "Politiloggen",
                    href: "https://example.test/politiloggen",
                  },
                ],
              },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Sporbarhet");
    expect(html).toContain("Rådata");
    expect(html).toContain("1 vist av 2");
    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("1 audit · 1 rådata");
    expect(html).not.toContain("Politiet oppdaterer om voldshendelse</strong>");
  });
});
