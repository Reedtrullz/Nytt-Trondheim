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
      ],
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
    expect(html).toContain("Siste leveranser");
    expect(html).toContain("1 sendt");
    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("Kritisk");
    expect(html).toContain("Sendt");
    expect(html).toContain("Push-varsel er sendt for denne utløseren");
    expect(html).toContain("Har offentlig kildegrunnlag");
    expect(html).toContain("stengt");
    expect(html).toContain("/situasjoner/road-one");
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
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen varselkandidater matcher filtrene.");
    expect(html).toContain("Ingen kandidat valgt");
  });
});
