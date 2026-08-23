import type { Article, Situation } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SavedView } from "./SavedPage.js";

const article: Article = {
  id: "article-1",
  source: "adressa",
  sourceLabel: "Adresseavisen",
  title: "Ny E6-korridor utredes",
  excerpt: "Statens vegvesen ser paa ny trasse ved Tiller.",
  url: "https://example.test/e6",
  publishedAt: "2026-08-01T08:00:00.000Z",
  scope: "trondheim",
  category: "Transport",
  places: [],
};

const situation: Situation = {
  id: "situation-1",
  type: "traffic",
  title: "Kjorebane stengt ved Sluppen",
  summary: "Soergaaende felt er stengt etter en trafikkulykke.",
  status: "active",
  verificationStatus: "Offentlig bekreftet",
  importance: "high",
  updatedAt: "2026-08-02T10:00:00.000Z",
  createdAt: "2026-08-02T09:00:00.000Z",
  locationLabel: "Sluppen",
  relatedArticleIds: ["article-1"],
  evidence: [],
  features: [],
  timeline: [],
};

function render(props: Parameters<typeof SavedView>[0]) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SavedView {...props} />
    </MemoryRouter>,
  );
}

describe("SavedView", () => {
  it("shows loading state", () => {
    const html = render({ articles: [], situations: [], loading: true });
    expect(html).toContain("Henter lagrede elementer...");
  });

  it("shows retry control on fetch failure", () => {
    const html = render({
      articles: [],
      situations: [],
      error: "Nettverket er utilgjengelig",
      onRetry: () => {},
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Kunne ikke hente lagret");
    expect(html).toContain("Prøv igjen");
  });

  it("shows empty state when nothing is saved", () => {
    const html = render({ articles: [], situations: [] });
    expect(html).toContain("Du har ingen lagrede saker eller situasjoner.");
  });

  it("renders saved situations with links into the workspace", () => {
    const html = render({ articles: [], situations: [situation] });
    expect(html).toContain("Situasjoner");
    expect(html).toContain("Kjorebane stengt ved Sluppen");
    expect(html).toContain('href="/situasjoner/situation-1"');
  });

  it("renders saved articles with external links", () => {
    const html = render({ articles: [article], situations: [] });
    expect(html).toContain("Saker");
    expect(html).toContain("Ny E6-korridor utredes");
    expect(html).toContain('href="https://example.test/e6"');
  });
});
