import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CoverageBundlePage } from "@nytt/shared";
import { CoverageBundlesDashboard } from "./CoverageBundlesPage.js";

const page: CoverageBundlePage = {
  summary: {
    recentBundleCount: 1,
    byKind: { incident: 1, topic: 0, update: 0 },
    byConfidence: { high: 1, medium: 0 },
    latestGeneratedAt: "2026-06-18T10:55:00.000Z",
  },
  items: [
    {
      id: "coverage:flatåsen-smoke",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-18T10:55:00.000Z",
      lastSeenAt: "2026-06-18T10:55:00.000Z",
      updatedAt: "2026-06-18T10:55:30.000Z",
      primaryArticleId: "nrk-flatåsen-smoke",
      memberArticleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
      sourceIds: ["nrk", "politiloggen"],
      sourceLabels: ["NRK Trøndelag", "Politiloggen"],
      memberArticles: [
        {
          id: "nrk-flatåsen-smoke",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Rykka til Flatåsen etter røykutvikling",
          excerpt: "Nødetatene har rykka til Flatåsen.",
          url: "https://example.test/nrk-flatåsen-smoke",
          publishedAt: "2026-06-18T10:50:00.000Z",
          category: "Hendelser",
          places: ["Flatåsen", "Trondheim"],
        },
        {
          id: "politiloggen-flatåsen-smoke",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Brann: Trondheim",
          excerpt: "Nødetatene rykker til Øvre Flatåsveg.",
          url: "https://example.test/politiloggen-flatåsen-smoke",
          publishedAt: "2026-06-18T10:48:00.000Z",
          category: "Hendelser",
          places: ["Flatåsen", "Trondheim"],
        },
      ],
      signals: [
        {
          kind: "generic_place_incident",
          articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
          detail: "brann",
          overlap: 4,
          score: 0.42,
        },
      ],
      nearMisses: [
        {
          articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
          reason: "conflicting_specific_places",
          overlap: 3,
          score: 0.24,
        },
      ],
      nearMissArticles: [
        {
          id: "adressa-other-smoke",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Røykmelding ved Heimdal",
          excerpt: "Nødetatene undersøker røyk ved Heimdal.",
          url: "https://example.test/adressa-other-smoke",
          publishedAt: "2026-06-18T10:49:00.000Z",
          category: "Hendelser",
          places: ["Heimdal", "Trondheim"],
        },
      ],
    },
  ],
};

describe("CoverageBundlesDashboard", () => {
  it("renders bundle summary, rows and detail drawer", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard page={page} filters={{ limit: 30 }} onFiltersChange={vi.fn()} />
      </MemoryRouter>,
    );

    expect(html).toContain("Dekningsgrupper");
    expect(html).toContain("Samme hendelse på tvers av kilder");
    expect(html).toContain("NRK Trøndelag");
    expect(html).toContain("Politiloggen");
    expect(html).toContain("Generisk steds-hendelse");
    expect(html).toContain("Konflikt i spesifikt sted");
    expect(html).toContain("3 treff");
    expect(html).toContain("24 %");
    expect(html).toContain("NRK Trøndelag: Rykka til Flatåsen etter røykutvikling");
    expect(html).toContain("Adresseavisen: Røykmelding ved Heimdal");
    expect(html).toContain("Rykka til Flatåsen etter røykutvikling");
    expect(html).toContain("/command/tidslinje");
    expect(html).toContain("/command/kilder");
  });

  it("renders the empty state", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={{
            summary: {
              recentBundleCount: 0,
              byKind: { incident: 0, topic: 0, update: 0 },
              byConfidence: { high: 0, medium: 0 },
            },
            items: [],
          }}
          filters={{ limit: 30, kind: "topic" }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen dekningsgrupper matcher filteret.");
    expect(html).toContain("Ingen gruppe valgt");
  });

  it("does not link unsafe persisted article URLs", () => {
    const unsafePage: CoverageBundlePage = {
      ...page,
      items: [
        {
          ...page.items[0]!,
          memberArticles: [
            {
              ...page.items[0]!.memberArticles[0]!,
              title: "Utrygg lenke",
              url: "javascript:alert(1)",
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={unsafePage}
          filters={{ limit: 30 }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Utrygg lenke");
    expect(html).toContain("coverage-bundle-member-linkless");
    expect(html).not.toContain("javascript:alert");
  });
});
