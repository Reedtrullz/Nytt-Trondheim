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
    expect(html).toContain("Flytt Situasjonsbilde senere");
    expect(html).toContain("Endre størrelse på Kilder");
    expect(html).toContain("Tilbakestill");
  });
});
