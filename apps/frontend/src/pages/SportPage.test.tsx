import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Article } from "@nytt/shared";
import { WorldCupSportDashboard } from "./SportPage.js";

const sportArticle: Article = {
  id: "ranheim-aasane",
  source: "nrk",
  sourceLabel: "NRK Trøndelag",
  title: "Ranheim tapte borte mot Åsane",
  excerpt: "Ranheim tapte 0-3 i 1. divisjon.",
  url: "https://example.test/ranheim-aasane",
  publishedAt: "2026-06-30T17:59:00.000Z",
  scope: "trondelag",
  category: "Sport",
  places: ["Ranheim", "Trondheim"],
};

function renderDashboard({
  articles = [sportArticle],
  loadingArticles = false,
  articleError,
  now = new Date("2026-07-01T10:45:00.000Z"),
}: {
  articles?: Article[];
  loadingArticles?: boolean;
  articleError?: string;
  now?: Date;
} = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <WorldCupSportDashboard
        articles={articles}
        loadingArticles={loadingArticles}
        articleError={articleError}
        now={now}
      />
    </MemoryRouter>,
  );
}

describe("WorldCupSportDashboard", () => {
  it("renders the World Cup desk, source links, Norway match and local sport context", () => {
    const html = renderDashboard();

    expect(html).toContain("VM 2026");
    expect(html).toContain("32-delsfinaler");
    expect(html).toContain("Elfenbenskysten");
    expect(html).toContain("Norge");
    expect(html).toContain("Elfenbenskysten 1–2 Norge");
    expect(html).toContain("Brasil – Norge");
    expect(html).toContain("Veien videre");
    expect(html).toContain("Datastatus");
    expect(html).toContain("ikke live-resultater");
    expect(html).toContain("Åttedelsfinale");
    expect(html).toContain("MF");
    expect(html).toContain("MM");
    expect(html).toContain("Gruppe I");
    expect(html).toContain("Frankrike");
    expect(html).toContain("Gruppe E");
    expect(html).toContain("Ranheim tapte borte mot Åsane");
    expect(html).toContain("FIFA format");
    expect(html).toContain("FIFA kampoversikt");
    expect(html).toContain("ESPN kampoppsett");
    expect(html).toContain("FOX live score");
    expect(html).toContain("FOX tabeller");
    expect(html).toContain("https://www.fifa.com/");
    expect(html).toContain("/?category=Sport");
  });

  it("renders the local sport empty state", () => {
    const html = renderDashboard({ articles: [] });

    expect(html).toContain("Ingen lokale sportssaker akkurat nå.");
    expect(html).toContain("Sluttspillstatus");
  });

  it("keeps initial sport stories visible when a later fetch error is shown", () => {
    const html = renderDashboard({ articleError: "Kunne ikke hente sportssaker." });

    expect(html).toContain("Ranheim tapte borte mot Åsane");
    expect(html).toContain("Kunne ikke hente sportssaker.");
  });

  it("warns when the curated World Cup snapshot should be checked", () => {
    const html = renderDashboard({ now: new Date("2026-07-02T10:45:00.000Z") });

    expect(html).toContain("Bør kontrolleres mot live score");
  });

  it("does not link unsafe article URLs", () => {
    const html = renderDashboard({ articles: [{ ...sportArticle, url: "javascript:alert(1)" }] });

    expect(html).toContain("Ranheim tapte borte mot Åsane");
    expect(html).not.toContain("javascript:alert");
  });
});
