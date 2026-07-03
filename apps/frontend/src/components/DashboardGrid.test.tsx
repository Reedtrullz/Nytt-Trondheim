import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardGrid } from "./DashboardGrid.js";

describe("DashboardGrid", () => {
  it("renders reusable widget controls for command surfaces", () => {
    const html = renderToStaticMarkup(
      <DashboardGrid
        storageKey="test-dashboard"
        widgets={[
          {
            id: "summary",
            title: "Situasjonsbilde",
            description: "Kort status.",
            defaultSize: "wide",
            children: <p>Tre aktive situasjoner.</p>,
          },
          {
            id: "sources",
            title: "Kilder",
            defaultSize: "compact",
            children: <p>Alle kilder OK.</p>,
          },
        ]}
      />,
    );

    expect(html).toContain("Modulært oppsett");
    expect(html).toContain("Command Center-arbeidsflate");
    expect(html).toContain("dashboard-widget-wide");
    expect(html).toContain("Dashboard-oppsett");
    expect(html).toContain("Oppsett");
    expect(html).toContain("Bred");
    expect(html).toContain("Kompakt");
    expect(html).toContain("Flytt Situasjonsbilde ned i oppsettet");
    expect(html).toContain("Bytt modulstørrelse for Kilder");
    expect(html).toContain("Flytt Situasjonsbilde senere");
    expect(html).toContain("Endre størrelse på Kilder");
    expect(html).toContain("Tilbakestill");
  });

  it("supports public dashboard copy and bare full-width widgets", () => {
    const html = renderToStaticMarkup(
      <DashboardGrid
        ariaLabel="Bypulsmoduler"
        label="City Pulse"
        title="Dagens oversikt"
        description="Kort offentlig status."
        storageKey="city-pulse-dashboard"
        variant="city-pulse"
        widgetChrome="bare"
        widgets={[
          {
            id: "brief",
            title: "Morgenbrief",
            description: "Dagens prioriterte bypuls.",
            defaultSize: "full",
            resizable: false,
            children: <p>Tre ting å følge.</p>,
          },
        ]}
      />,
    );

    expect(html).toContain("Bypulsmoduler");
    expect(html).toContain("City Pulse");
    expect(html).toContain("Dagens oversikt");
    expect(html).toContain("Kort offentlig status.");
    expect(html).toContain("dashboard-layout-city-pulse");
    expect(html).toContain("dashboard-widget-full");
    expect(html).toContain("dashboard-widget-bare");
    expect(html).not.toContain("Endre størrelse på Morgenbrief");
    expect(html).not.toContain("Dashboard-oppsett");
    expect(html).toContain("Flytt Morgenbrief senere");
  });
});
