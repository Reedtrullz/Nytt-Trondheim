import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { sampleWorkspace } from "@nytt/shared";

test("reader opens the active situation and keeps private map controls distinct", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Siste nytt i Trondheim" })).toBeVisible();
  const municipalityArchiveLink = page.getByRole("link", { name: "Se alle", exact: true });
  await expect(municipalityArchiveLink).toHaveAttribute(
    "href",
    "https://www.trondheim.kommune.no/aktuelt/nyheter/",
  );
  await expect(municipalityArchiveLink).toHaveAttribute("target", "_blank");
  await expect(municipalityArchiveLink).toHaveAttribute("rel", "noreferrer noopener");
  await expect(
    page.getByRole("heading", { name: "Skogbrann ved Bymarka", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Åpne situasjonsrom/ }).click();
  await expect(page.getByRole("heading", { name: "Kart og berørte områder" })).toBeVisible();
  await expect(page.getByText("Mine markeringer")).toBeVisible();
  await expect(page.getByText("Viser ressurser i området – ikke aktiv innsats")).toBeVisible();
  const sourceItemsPanel = page.locator(".source-items-panel");
  await expect(sourceItemsPanel.getByRole("heading", { name: "Kildegrunnlag" })).toBeVisible();
  await expect(
    sourceItemsPanel.getByText(/Ingen kildeelementer er koblet ennå|nrk|adresseavisen|vegvesen/i),
  ).toBeVisible();
});

test("traffic map can show Entur public transport context", async ({ page }) => {
  await page.route("**/api/map/public-transport**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-05-31T21:15:00.000Z",
        vehicles: [
          {
            id: "entur-vehicle:ATB:8790",
            source: "entur_vehicle_positions",
            codespaceId: "ATB",
            vehicleId: "8790",
            mode: "bus",
            publicCode: "45",
            destinationName: "Hagen",
            lastUpdated: "2026-05-31T21:02:50.207Z",
            geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
            stale: false,
          },
        ],
        alerts: [
          {
            id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
            source: "entur_service_alerts",
            codespaceId: "ATB",
            situationNumber: "ATB:SituationNumber:24982-stopPoint",
            state: "active",
            summary: "Rota flyttet",
            updatedAt: "2026-05-31T21:00:00.000Z",
            geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
          },
        ],
        sources: [
          {
            source: "entur_vehicle_positions",
            label: "Entur kjøretøyposisjoner",
            state: "ok",
            detail: "1",
          },
        ],
      }),
    });
  });
  await page.goto("/trafikk");
  await expect(page.getByRole("heading", { name: "Kollektivtrafikk" })).toBeVisible();
  await page.getByLabel("Vis kollektivtrafikk").check();
  await expect(page.getByText("45 → Hagen")).toBeVisible();
  await expect(page.getByText("Rota flyttet")).toBeVisible();
});

test("bootstrap 429 shows retryable error without stale loading", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/bootstrap", async (route) => {
    attempts += 1;
    if (attempts <= 2) {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "30" },
        body: JSON.stringify({ error: "Too many requests" }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "For mange forespørsler. Prøv igjen om litt.",
  );
  await expect(page.getByText("Henter siste nytt...")).toHaveCount(0);

  await page.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(page.getByRole("heading", { name: "Siste nytt i Trondheim" })).toBeVisible();
});

test("weather page presents the preparedness desk with source-labeled official guidance", async ({
  page,
}) => {
  await page.route("**/api/weather/preparedness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-06-01T08:05:00.000Z",
        current: {
          summary: "MET Locationforecast: regnbyger nå",
          updatedAt: "2026-06-01T08:00:00.000Z",
          airTemperatureC: 7,
          windSpeedMps: 8,
          precipitationNextHourMm: 2.4,
        },
        risks: [
          {
            key: "precipitation",
            label: "Nedbør",
            status: "MET farevarsel: Gult regn",
            level: "warning",
            source: "MET Locationforecast + MET farevarsel",
            confidence: "Høy",
            nextChange: "Gjelder til tirsdag 09:00",
            detail: "Lokalt overvann mulig.",
          },
          {
            key: "wind",
            label: "Vind",
            status: "Frisk bris",
            level: "watch",
            source: "MET Locationforecast",
            confidence: "Middels",
            nextChange: "Neste time",
            detail: "8 m/s fra sørvest.",
          },
          {
            key: "floodLandslide",
            label: "Flom/skred",
            status: "NVE flomvarsel: Oransje",
            level: "severe",
            source: "NVE/Varsom",
            confidence: "Høy",
            nextChange: "Følg Varsom",
            detail: "Økt vannføring.",
          },
          {
            key: "roadConditions",
            label: "Føre",
            status: "Våte veger",
            level: "watch",
            source: "Statens vegvesen DATEX",
            confidence: "Middels",
            nextChange: "Oppdateres fra vegstasjoner",
            detail: "Våt vegbane.",
          },
          {
            key: "powerTelecom",
            label: "Strøm/tele",
            status: "Følg egenberedskap",
            level: "watch",
            source: "DSB egenberedskap",
            confidence: "Råd",
            nextChange: "Ved oransje/rødt varsel",
            detail: "Forbered strøm, vann og mobilutfall ved forverring.",
          },
          {
            key: "health",
            label: "Helse",
            status: "Ingen særskilt værhelserisiko",
            level: "normal",
            source: "MET/DSB",
            confidence: "Middels",
            nextChange: "Følg temperaturendringer",
            detail: "Vurder sårbare grupper ved kulde/varme.",
          },
        ],
        actions: [
          {
            id: "rain-drains",
            level: "warning",
            title: "Rens sluk og hold avrenning åpen",
            detail: "Gult regnvarsel: fjern løv fra sluk og unngå utsatte underganger.",
            source: "MET farevarsel + Trondheim klimatilpasning",
          },
          {
            id: "neighbours",
            level: "severe",
            title: "Sjekk sårbare naboer og egenberedskap",
            detail:
              "Ved oransje/rødt: følg offisielle varsler og forbered bortfall av strøm, vann og mobilnett.",
            source: "DSB egenberedskap",
          },
        ],
        authority: {
          emergencyAlertStatus:
            "Nytt er ikke koblet til Nødvarsel. Følg Nødvarsel hvis du får det.",
          civilDefenceDetail:
            "Sivilforsvaret støtter politi, brann, helse og kommuner ved større hendelser.",
          links: [
            {
              label: "Nødvarsel",
              url: "https://www.nodvarsel.no/om-nodvarsel/",
              source: "Nødvarsel",
            },
            {
              label: "DSB egenberedskap",
              url: "https://www.dsb.no/sikkerhverdag/egenberedskap/",
              source: "DSB",
            },
          ],
        },
        impactGroups: [
          {
            group: "Innbyggere",
            status: "Følg lokale råd",
            level: "warning",
            detail: "Hold sluk åpne.",
            source: "DSB/Trondheim",
          },
          {
            group: "Transport",
            status: "Våte veger",
            level: "watch",
            detail: "Sjekk trafikkart.",
            source: "Vegvesen DATEX",
          },
          {
            group: "Helse",
            status: "Normal",
            level: "normal",
            detail: "Ingen særskilt risiko.",
            source: "MET",
          },
          {
            group: "Skole/arrangement",
            status: "Uteaktivitet påvirkes",
            level: "watch",
            detail: "Vurder eksponering.",
            source: "MET",
          },
          {
            group: "Beredskap",
            status: "Følg offisielle varsler",
            level: "warning",
            detail: "Ingen Nødvarsel.",
            source: "Nødvarsel/DSB",
          },
        ],
        warnings: [
          {
            id: "met-rain",
            sourceLabel: "MET farevarsel",
            title: "Kraftig regn",
            area: "Trøndelag",
            level: "Gult",
            validUntil: "2026-06-02T09:00:00.000Z",
            url: "https://api.met.no/weatherapi/metalerts/2.0/current.rss",
          },
          {
            id: "nve-flood",
            sourceLabel: "NVE flomvarsel",
            title: "Flomvarsel",
            area: "Trondheim",
            level: "Oransje",
            validUntil: "2026-06-02T09:00:00.000Z",
            url: "https://varsom.no",
          },
        ],
        hourly: [],
        roadWeather: [],
        mapLayers: [
          {
            id: "met-warnings",
            title: "MET warning polygons",
            source: "MET",
            status: "planned",
            detail: "Vises når varselgeometri eksponeres i værkartet.",
          },
        ],
        sources: [],
      }),
    });
  });

  await page.goto("/vaer");

  await expect(page.getByRole("heading", { name: "Hva betyr været nå?" })).toBeVisible();
  await expect(page.getByText("MET Locationforecast: regnbyger nå")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nedbør" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Flom/skred" })).toBeVisible();
  await expect(page.getByText("MET farevarsel + Trondheim klimatilpasning")).toBeVisible();
  await expect(page.getByText("Nytt er ikke koblet til Nødvarsel")).toBeVisible();
  await expect(page.getByText("Neste lag")).toBeVisible();
  await expect(page.locator(".warning-area")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hvem påvirkes?" })).toBeVisible();
  await expect(page.getByText("Innbyggere")).toBeVisible();
  await expect(page.getByText("Sivilforsvaret støtter politi, brann, helse")).toBeVisible();
});

test("searching from trafikk navigates home and shows filtered results", async ({ page }) => {
  await page.goto("/trafikk");
  await page.getByPlaceholder("Søk i saker").fill("bru");

  await expect(page).toHaveURL(/\/\?q=bru$/);
  await expect(page.getByRole("heading", { name: "Siste nytt i Trondheim" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Ny bru over Nidelva/ })).toBeVisible();
  await expect(page.locator(".situation-banner")).toHaveCount(0);
});

test("home keeps Vær as weather page navigation, not an article category filter", async ({
  page,
}) => {
  await page.goto("/?q=bru&category=V%C3%A6r&scope=trondelag");

  await expect(page.getByRole("link", { name: "Vær" })).toHaveAttribute("href", "/vaer");
  await expect(page.getByRole("button", { name: "Vær" })).toHaveCount(0);
  await expect(page.getByText('Ingen saker samsvarer med "bru" i Trøndelag.')).toBeVisible();
});

test("article save failure rolls back optimistic state", async ({ page }) => {
  await page.route("**/api/saved/articles/a-bridge", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Lagring er midlertidig utilgjengelig." }),
    });
  });

  await page.goto("/?q=bru");
  const saveButton = page.getByRole("button", {
    name: /(Lagre sak|Fjern fra lagret): Ny bru over Nidelva/,
  });
  const initialLabel = await saveButton.getAttribute("aria-label");
  await expect(saveButton).toBeEnabled();

  await saveButton.click();
  await expect(page.getByRole("alert")).toContainText("Lagring er midlertidig utilgjengelig.");
  await expect(
    page.getByRole("button", { name: initialLabel ?? /Ny bru over Nidelva/ }),
  ).toBeEnabled();
});

test("article save is disabled while a request is pending", async ({ page }) => {
  let releaseArticleRefresh!: () => void;
  const articleRefreshMayFinish = new Promise<void>((resolve) => {
    releaseArticleRefresh = resolve;
  });
  await page.route("**/api/articles?**", async (route) => {
    await articleRefreshMayFinish;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "a-bridge",
            source: "adressa",
            sourceLabel: "Adresseavisen",
            title: "Ny bru over Nidelva åpnet for gående og syklende",
            excerpt: "Stale refresh while save is pending.",
            url: "https://www.adressa.no/nyheter/trondheim",
            publishedAt: "2026-05-26T10:18:00.000Z",
            scope: "trondheim",
            category: "Transport",
            places: ["Midtbyen", "Skansen"],
            saved: false,
          },
        ],
      }),
    });
  });

  let releaseSave!: () => void;
  const saveCanFinish = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let calls = 0;
  await page.route("**/api/saved/articles/a-bridge", async (route) => {
    calls += 1;
    await saveCanFinish;
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/?q=bru");
  const saveButton = page.getByRole("button", {
    name: /(Lagre sak|Fjern fra lagret): Ny bru over Nidelva/,
  });
  const initialLabel = (await saveButton.getAttribute("aria-label")) ?? "";
  await saveButton.click();
  const articleRefreshResponse = page.waitForResponse(
    (response) => response.url().includes("/api/articles?") && response.status() === 200,
  );
  releaseArticleRefresh();
  await articleRefreshResponse;
  const pendingSaveButton = page.getByRole("button", {
    name: /(Lagre sak|Fjern fra lagret): Ny bru over Nidelva/,
  });
  await expect(pendingSaveButton).toBeDisabled();
  await pendingSaveButton.click({ force: true }).catch(() => undefined);
  releaseSave();

  const expectedLabel = initialLabel.startsWith("Fjern fra lagret")
    ? /Lagre sak: Ny bru over Nidelva/
    : /Fjern fra lagret: Ny bru over Nidelva/;
  await expect(page.getByRole("button", { name: expectedLabel })).toBeEnabled();
  expect(calls).toBe(1);
});

test("stale article refresh after save completion does not undo optimistic saved state", async ({
  page,
}) => {
  let releaseArticleRefresh!: () => void;
  const staleArticleRefreshMayFinish = new Promise<void>((resolve) => {
    releaseArticleRefresh = resolve;
  });
  await page.route("**/api/articles?**", async (route) => {
    await staleArticleRefreshMayFinish;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "a-bridge",
            source: "adressa",
            sourceLabel: "Adresseavisen",
            title: "Ny bru over Nidelva åpnet for gående og syklende",
            excerpt: "Stale refresh after save completion.",
            url: "https://www.adressa.no/nyheter/trondheim",
            publishedAt: "2026-05-26T10:18:00.000Z",
            scope: "trondheim",
            category: "Transport",
            places: ["Midtbyen", "Skansen"],
            saved: false,
          },
        ],
      }),
    });
  });
  await page.route("**/api/saved/articles/a-bridge", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/?q=bru");
  const saveButton = page.getByRole("button", {
    name: /(Lagre sak|Fjern fra lagret): Ny bru over Nidelva/,
  });
  const initialLabel = (await saveButton.getAttribute("aria-label")) ?? "";
  const saveResponse = page.waitForResponse((response) =>
    response.url().includes("/api/saved/articles/a-bridge"),
  );
  await saveButton.click();
  await saveResponse;

  const staleRefreshResponse = page.waitForResponse(
    (response) => response.url().includes("/api/articles?") && response.status() === 200,
  );
  releaseArticleRefresh();
  await staleRefreshResponse;

  const expectedLabel = initialLabel.startsWith("Fjern fra lagret")
    ? /Lagre sak: Ny bru over Nidelva/
    : /Fjern fra lagret: Ny bru over Nidelva/;
  await expect(page.getByRole("button", { name: expectedLabel })).toBeEnabled();
});

test("load more response from an old filter is ignored after URL filter changes", async ({
  page,
}) => {
  let releaseOldPage!: () => void;
  const oldPageMayFinish = new Promise<void>((resolve) => {
    releaseOldPage = resolve;
  });
  await page.route("**/api/articles?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor") === "old-bru-page") {
      await oldPageMayFinish;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "a-old-bru",
              source: "adressa",
              sourceLabel: "Adresseavisen",
              title: "Gammel bru-sak fra forrige filter",
              excerpt: "Denne skal ikke blandes inn etter filterbytte.",
              url: "https://www.adressa.no/nyheter/trondheim/gammel-bru",
              publishedAt: "2026-05-25T10:18:00.000Z",
              scope: "trondheim",
              category: "Transport",
              places: ["Midtbyen"],
              saved: false,
            },
          ],
        }),
      });
      return;
    }
    if (url.searchParams.get("category") === "Politikk") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "a-bridge",
            source: "adressa",
            sourceLabel: "Adresseavisen",
            title: "Ny bru over Nidelva åpnet for gående og syklende",
            excerpt: "Første side for bru-filteret.",
            url: "https://www.adressa.no/nyheter/trondheim",
            publishedAt: "2026-05-26T10:18:00.000Z",
            scope: "trondheim",
            category: "Transport",
            places: ["Midtbyen", "Skansen"],
            saved: false,
          },
        ],
        nextCursor: "old-bru-page",
      }),
    });
  });

  await page.goto("/?q=bru");
  await expect(page.getByRole("button", { name: "Vis flere saker" })).toBeVisible();
  await page.getByRole("button", { name: "Vis flere saker" }).click();
  const politicsRefreshResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/articles" && url.searchParams.get("category") === "Politikk";
  });
  await page.getByRole("button", { name: "Politikk" }).click();
  await expect(page).toHaveURL(/category=Politikk/);
  await politicsRefreshResponse;
  await expect(
    page.getByText('Ingen saker samsvarer med "bru" Politikk i Trondheim.'),
  ).toBeVisible();
  releaseOldPage();

  await expect(
    page.getByText('Ingen saker samsvarer med "bru" Politikk i Trondheim.'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Gammel bru-sak fra forrige filter" }),
  ).toHaveCount(0);
});

test("situation save failure stays visible and blocks duplicate clicks while pending", async ({
  page,
}) => {
  let releaseSave!: () => void;
  const saveRequestSeen = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let calls = 0;
  await page.route("**/api/situations/skogbrann-bymarka/saved", async (route) => {
    calls += 1;
    await saveRequestSeen;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Situasjonen kunne ikke lagres." }),
    });
  });

  await page.goto("/situasjoner/skogbrann-bymarka");
  const saveButton = page.getByRole("button", { name: /Lagre situasjon|Fjern lagring/ });
  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  await saveButton.click({ force: true }).catch(() => undefined);
  releaseSave();

  await expect(page.getByText("Situasjonen kunne ikke lagres.")).toBeVisible();
  expect(calls).toBe(1);
});

test("mobile traffic page shows heading and controls before the map", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout contract");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trafikk");

  const heading = page.getByRole("heading", { name: "Trafikkart" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "Nå" })).toBeVisible();

  const headingBox = await heading.boundingBox();
  const mapBox = await page.locator(".traffic-map").boundingBox();
  expect(headingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(mapBox?.y ?? 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("situation map exposes private fire and SAR planning tools", async ({ page }) => {
  await page.goto("/situasjoner/skogbrann-bymarka");
  await expect(page.getByRole("heading", { name: "Kart og berørte områder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brannfront" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hotspot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Røyk/vind" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Risikoring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Evakuering/stengt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sist sett" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vitneobs." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Søksområde" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Søkerute/grid" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ressurs" })).toBeVisible();
  await expect(page.getByText("Private analyser – ikke offentlig verifisert")).toBeVisible();
});

test("situation map can show Kollektivtrafikk-kontekst", async ({ page }) => {
  await page.route("**/api/map/public-transport**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-05-31T21:15:00.000Z",
        vehicles: [],
        alerts: [],
        sources: [
          {
            source: "entur_vehicle_positions",
            label: "Entur kjøretøyposisjoner",
            state: "ok",
            detail: "0",
          },
        ],
      }),
    });
  });
  await page.goto("/situasjoner/skogbrann-bymarka");
  await expect(page.getByLabel("Kollektivtrafikk-kontekst")).toBeVisible();
  await page.getByLabel("Kollektivtrafikk-kontekst").check();
  await expect(page.getByText("Entur kjøretøyposisjoner")).toBeVisible();
  await expect(page.getByText("Kontekstlag – ikke bevis for aktiv hendelse")).toBeVisible();
});

test("source item panel shows loading before the empty state", async ({ page }) => {
  let releaseSourceItems!: () => void;
  const sourceItemsReady = new Promise<void>((resolve) => {
    releaseSourceItems = resolve;
  });

  await page.route("**/api/situations/skogbrann-bymarka/source-items", async (route) => {
    await sourceItemsReady;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/situasjoner/skogbrann-bymarka");
  const sourceItemsPanel = page.locator(".source-items-panel");
  await expect(sourceItemsPanel.getByText("Henter kildegrunnlag...")).toBeVisible();

  releaseSourceItems();
  await expect(sourceItemsPanel.getByText("Ingen kildeelementer er koblet ennå.")).toBeVisible();
});

test("source item panel announces retryable errors and renders only safe external links", async ({
  page,
}) => {
  let allowSuccess = false;
  await page.route("**/api/situations/skogbrann-bymarka/source-items", async (route) => {
    if (!allowSuccess) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Kildegrunnlag er midlertidig utilgjengelig." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "nrk:test",
          provider: "nrk",
          kind: "article",
          originalUrl: "https://example.test/source",
          title: "Sikker kilde",
          fetchedAt: "2026-05-29T10:00:00.000Z",
          captureHash: "safe",
          reliabilityTier: "trusted_media",
          linkedSituationIds: ["skogbrann-bymarka"],
        },
        {
          id: "nrk:unsafe",
          provider: "nrk",
          kind: "article",
          originalUrl: "javascript:alert(1)",
          title: "Usikker kilde",
          fetchedAt: "2026-05-29T10:00:00.000Z",
          captureHash: "unsafe",
          reliabilityTier: "trusted_media",
          linkedSituationIds: ["skogbrann-bymarka"],
        },
      ]),
    });
  });

  await page.goto("/situasjoner/skogbrann-bymarka");
  const sourceItemsPanel = page.locator(".source-items-panel");
  await expect(sourceItemsPanel.getByRole("alert")).toContainText(
    "Kildegrunnlag er midlertidig utilgjengelig.",
  );

  allowSuccess = true;
  await sourceItemsPanel.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(sourceItemsPanel.getByText("Sikker kilde", { exact: true })).toBeVisible();
  await expect(sourceItemsPanel.getByText("Usikker kilde", { exact: true })).toBeVisible();
  const links = sourceItemsPanel.getByRole("link", { name: "Åpne kilde" });
  await expect(links).toHaveCount(1);
  await expect(links.first()).toHaveAttribute("href", "https://example.test/source");
  await expect(links.first()).toHaveAttribute("target", "_blank");
  await expect(links.first()).toHaveAttribute("rel", "noreferrer noopener");
});

test("situation evidence and related links render only safe external URLs", async ({ page }) => {
  await page.route("**/api/situations/skogbrann-bymarka", async (route) => {
    const evidenceTemplate = sampleWorkspace.situation.evidence[0]!;
    const relatedTemplate = sampleWorkspace.relatedArticles[0]!;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleWorkspace,
        situation: {
          ...sampleWorkspace.situation,
          evidence: [
            {
              ...evidenceTemplate,
              id: "safe-evidence",
              claim: "Trygg originalmelding",
              sourceUrl: "https://example.test/evidence",
            },
            {
              ...evidenceTemplate,
              id: "unsafe-evidence",
              claim: "Utrygg originalmelding",
              sourceUrl: "javascript:alert(1)",
            },
          ],
        },
        relatedArticles: [
          {
            ...relatedTemplate,
            id: "safe-related",
            title: "Trygg relatert sak",
            url: "https://example.test/related",
          },
          {
            ...relatedTemplate,
            id: "unsafe-related",
            title: "Utrygg relatert sak",
            url: "javascript:alert(1)",
          },
        ],
      }),
    });
  });
  await page.route("**/api/situations/skogbrann-bymarka/source-items", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/situasjoner/skogbrann-bymarka");

  const evidenceLinks = page.getByRole("link", { name: "Se originalmelding" });
  await expect(evidenceLinks).toHaveCount(1);
  await expect(evidenceLinks.first()).toHaveAttribute("href", "https://example.test/evidence");
  await expect(page.getByRole("link", { name: "Trygg relatert sak" })).toHaveAttribute(
    "href",
    "https://example.test/related",
  );
  await expect(page.getByRole("link", { name: "Utrygg relatert sak" })).toHaveCount(0);
  await expect(page.getByText("Utrygg relatert sak")).toBeVisible();
});

test("workspace attachment links encode reserved route characters", async ({ page }) => {
  const situationId = "incident/with spaces?#fragment";
  const attachmentId = "attachment/with spaces?#fragment";
  const encodedSituationId = encodeURIComponent(situationId);
  const encodedAttachmentId = encodeURIComponent(attachmentId);
  await page.route(`**/api/situations/${encodedSituationId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleWorkspace,
        situation: { ...sampleWorkspace.situation, id: situationId, title: "Encoded route test" },
        relatedArticles: [],
        tasks: [],
        notes: [],
        attachments: [
          {
            id: attachmentId,
            situationId,
            filename: "encoded-attachment.txt",
            contentType: "text/plain",
            size: 12,
            sha256: "0".repeat(64),
            createdAt: "2026-05-29T10:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route(`**/api/situations/${encodedSituationId}/source-items`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto(`/situasjoner/${encodedSituationId}`);

  await expect(page.getByRole("link", { name: "encoded-attachment.txt" })).toHaveAttribute(
    "href",
    `/api/situations/${encodedSituationId}/attachments/${encodedAttachmentId}`,
  );
});

test("primary surfaces have no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations).toEqual([]);
  await page.goto("/situasjoner/skogbrann-bymarka");
  const incident = await new AxeBuilder({ page }).analyze();
  expect(incident.violations).toEqual([]);
});

test("owner manages private situation workspace and creates an export", async ({ page }) => {
  await page.goto("/situasjoner/skogbrann-bymarka");
  const saveButton = page.getByRole("button", { name: /Lagre situasjon|Fjern lagring/ });
  if ((await saveButton.textContent())?.includes("Lagre")) {
    await saveButton.click();
  }
  await expect(page.getByRole("button", { name: "Fjern lagring" })).toBeVisible();

  const tasks = page.locator(".tasks");
  await tasks.getByPlaceholder("Ny oppgave").fill("Kontroller ny oppdatering");
  await tasks.getByRole("button", { name: "Legg til" }).click();
  await expect(
    tasks.getByRole("textbox", { name: "Rediger oppgave: Kontroller ny oppdatering" }).last(),
  ).toHaveValue("Kontroller ny oppdatering");

  const notes = page.locator(".notes");
  await notes.getByPlaceholder("Skriv privat notat...").fill("Privat vurdering.");
  await notes.getByRole("button", { name: "Legg til notat" }).click();
  await expect(notes.getByRole("textbox", { name: "Rediger notat" }).last()).toHaveValue(
    "Privat vurdering.",
  );

  await page.getByRole("button", { name: /Eksporter arbeidsmappe/ }).click();
  await expect(page.getByText("Arbeidsmappen er eksportert.")).toBeVisible();
});

test("owner can open the real situation index and operations status", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Situasjonsrom", exact: true }).click();
  await expect(page).toHaveURL(/\/situasjoner$/);
  await expect(page.getByRole("heading", { name: "Hendelser og utvikling" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Åpne oversikt" })).toBeVisible();
  await page.getByRole("link", { name: "Drift" }).click();
  await expect(page.getByRole("heading", { name: "Kilder og systemstatus" })).toBeVisible();
  await expect(page.getByText("Sikkerhetskopi")).toBeVisible();
  await expect(page.getByText("Innhentede saker")).toBeVisible();
  await page.getByRole("link", { name: "Lagret" }).click();
  await expect(page.getByRole("heading", { name: "Lagret" })).toBeVisible();
});

test("workspace mutation failures are visible to the owner", async ({ page }) => {
  await page.route("**/api/situations/skogbrann-bymarka/notes", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Notater er midlertidig utilgjengelige." }),
    });
  });
  await page.goto("/situasjoner/skogbrann-bymarka");
  const notes = page.locator(".notes");
  await notes.getByPlaceholder("Skriv privat notat...").fill("Skal ikke forsvinne stille.");
  await notes.getByRole("button", { name: "Legg til notat" }).click();
  await expect(page.getByText("Notater er midlertidig utilgjengelige.")).toBeVisible();
  await expect(notes.getByPlaceholder("Skriv privat notat...")).toHaveValue(
    "Skal ikke forsvinne stille.",
  );
});
