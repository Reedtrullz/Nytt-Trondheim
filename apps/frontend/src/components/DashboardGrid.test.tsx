import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardGrid } from "./DashboardGrid.js";

describe("DashboardGrid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    expect(html).toContain('data-size="compact"');
    expect(html).toContain('data-next-size="standard"');
    expect(html).toContain('title="Nå: Kompakt. Neste: Normal."');
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

  it("keeps public dashboard configuration collapsed until requested", () => {
    const html = renderToStaticMarkup(
      <DashboardGrid
        ariaLabel="Bypulsmoduler"
        label="City Pulse"
        title="Dagens oversikt"
        configMode="toggle"
        variant="city-pulse"
        widgetChrome="bare"
        showWidgetHeaders={false}
        widgets={[
          {
            id: "brief",
            title: "Morgenbrief",
            defaultSize: "full",
            resizable: false,
            children: <p>Tre ting å følge.</p>,
          },
          {
            id: "signals",
            title: "Varsel og AI-spor",
            defaultSize: "full",
            children: <p>Åpen forklaring.</p>,
          },
        ]}
      />,
    );

    expect(html).toContain("Tilpass oppsett");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Tilbakestill");
    expect(html).toContain('data-editable="false"');
    expect(html).not.toContain("Dashboard-oppsett");
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("Flytt Morgenbrief senere");
    expect(html).not.toContain("Endre størrelse på Varsel og AI-spor");
  });

  it("keeps visible public widget headers passive while configuration is collapsed", () => {
    const html = renderToStaticMarkup(
      <DashboardGrid
        ariaLabel="Bypulsmoduler"
        label="City Pulse"
        title="Dagens oversikt"
        configMode="toggle"
        variant="city-pulse"
        widgets={[
          {
            id: "brief",
            title: "Morgenbrief",
            defaultSize: "full",
            children: <p>Tre ting å følge.</p>,
          },
          {
            id: "signals",
            title: "Varsel og AI-spor",
            defaultSize: "full",
            children: <p>Åpen forklaring.</p>,
          },
        ]}
      />,
    );

    expect(html).toContain("<h3>Morgenbrief</h3>");
    expect(html).not.toContain("Morgenbrief kontroller");
    expect(html).not.toContain("Flytt Morgenbrief tidligere");
    expect(html).not.toContain("Endre størrelse på Morgenbrief");
  });

  it("falls back to the default layout when browser storage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("storage blocked");
        },
        setItem() {
          throw new Error("storage blocked");
        },
      },
    });

    const html = renderToStaticMarkup(
      <DashboardGrid
        storageKey="blocked-dashboard"
        widgets={[
          {
            id: "summary",
            title: "Situasjonsbilde",
            defaultSize: "wide",
            children: <p>Tre aktive situasjoner.</p>,
          },
        ]}
      />,
    );

    expect(html).toContain("Situasjonsbilde");
    expect(html).toContain("dashboard-widget-wide");
  });
});
