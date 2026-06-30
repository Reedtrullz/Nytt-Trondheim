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

function renderDashboard(articles: Article[] = [sportArticle], loadingArticles = false) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <WorldCupSportDashboard articles={articles} loadingArticles={loadingArticles} />
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
    expect(html).toContain("Gruppe I");
    expect(html).toContain("Frankrike");
    expect(html).toContain("Gruppe E");
    expect(html).toContain("Ranheim tapte borte mot Åsane");
    expect(html).toContain("FIFA kampoversikt");
    expect(html).toContain("FIFA tabeller");
    expect(html).toContain("ESPN kampoppsett");
    expect(html).toContain("CBS gruppetabeller");
    expect(html).toContain("https://www.fifa.com/");
    expect(html).toContain("/?category=Sport");
  });

  it("renders the local sport empty state", () => {
    const html = renderDashboard([]);

    expect(html).toContain("Ingen lokale sportssaker akkurat nå.");
    expect(html).toContain("Sluttspillstatus");
  });

  it("does not link unsafe article URLs", () => {
    const html = renderDashboard([{ ...sportArticle, url: "javascript:alert(1)" }]);

    expect(html).toContain("Ranheim tapte borte mot Åsane");
    expect(html).not.toContain("javascript:alert");
  });
});
