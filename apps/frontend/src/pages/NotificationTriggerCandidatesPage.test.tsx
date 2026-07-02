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
      deliveryState: "candidate_only",
      title: "Steinsprang, vegen er stengt",
      body: "Gangåsvegen: Vegen er stengt og omkjøring er skiltet.",
      detail: "Kandidat for systemvarsel. Ingen push er sendt i denne versjonen.",
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

describe("NotificationTriggerCandidatesDashboard", () => {
  it("renders candidates with delivery disclaimers and reasons", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30 }}
          onFiltersChange={vi.fn()}
          page={page}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Varselutløsere");
    expect(html).toContain("ingen Web Push-varsler sendes");
    expect(html).toContain("Steinsprang, vegen er stengt");
    expect(html).toContain("Kritisk");
    expect(html).toContain("Ikke sendt");
    expect(html).toContain("Har offentlig kildegrunnlag");
    expect(html).toContain("stengt");
    expect(html).toContain("/situasjoner/road-one");
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationTriggerCandidatesDashboard
          filters={{ limit: 30 }}
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
