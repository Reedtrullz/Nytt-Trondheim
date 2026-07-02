import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  fallbackWorldCupDashboard,
  sampleBootstrap,
  sampleWorkspace,
  type Article,
} from "@nytt/shared";

async function openTrafficLayersIfHidden(page: Page): Promise<void> {
  const layersButton = page.getByRole("button", { name: "Kartlag og filtre" });
  const buttonAttached = await layersButton
    .waitFor({ state: "attached", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  if (!buttonAttached) return;
  const expanded = await layersButton.getAttribute("aria-expanded").catch(() => null);
  if ((await layersButton.isVisible().catch(() => false)) && expanded !== "true") {
    await layersButton.click();
  }
}

async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

async function useViewerSession(page: Page): Promise<void> {
  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        csrfToken: "viewer-csrf-token",
        user: {
          id: "viewer-one",
          login: "viewer@example.test",
          displayName: "Ingrid Leser",
          role: "viewer",
          status: "active",
          email: "viewer@example.test",
        },
      }),
    });
  });
}

test("Situation Room explains provenance and keeps private map controls distinct", async ({
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
  await expect(page.getByRole("heading", { name: "Hvorfor vises dette?" })).toBeVisible();
  await expect(page.getByText("Kun kontekst")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kart og berørte områder" })).toBeVisible();
  await expect(page.getByText("Mine markeringer")).toBeVisible();
  await expect(page.getByText("Viser ressurser i området – ikke aktiv innsats")).toBeVisible();
  const sourceItemsPanel = page.locator(".source-items-panel");
  await expect(sourceItemsPanel.getByRole("heading", { name: "Kildegrunnlag" })).toBeVisible();
  await expect(
    sourceItemsPanel.getByText(/Ingen kildeelementer er koblet ennå|nrk|adresseavisen|vegvesen/i),
  ).toBeVisible();
});

test("frontpage uses bootstrap feed without immediate duplicate refreshes", async ({ page }) => {
  const duplicateRefreshes: string[] = [];
  await page.route("**/api/articles?**", async (route) => {
    duplicateRefreshes.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: sampleBootstrap.articles, nextCursor: undefined }),
    });
  });
  await page.route("**/api/situations?**", async (route) => {
    duplicateRefreshes.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Siste nytt i Trondheim" })).toBeVisible();
  await expect(page.getByText("Oppdaterer saker...")).toHaveCount(0);
  expect(duplicateRefreshes).toEqual([]);
});

test("situation overview keeps the selected map case actionable", async ({ page }) => {
  await page.goto("/situasjoner");

  const selected = page.getByRole("region", { name: "Valgt situasjon i kartet" });
  await expect(selected).toContainText("Skogbrann ved Bymarka");
  await expect(selected).toContainText("Bymarka");
  await expect(selected.getByRole("link", { name: "Åpne arbeidsrom" })).toHaveAttribute(
    "href",
    "/situasjoner/skogbrann-bymarka",
  );
});

test("situation overview changes map selection without refetching workspace data", async ({
  page,
}) => {
  const first = {
    id: "skogbrann-bymarka",
    type: "fire",
    title: "Skogbrann ved Bymarka",
    summary: "Samlet oversikt fra åpne, publiserte kilder.",
    status: "active",
    importance: "high",
    updatedAt: "2026-05-26T12:18:00.000Z",
    locationLabel: "Bymarka / Granåsen",
    primaryFeature: sampleWorkspace.situation.features[0],
    features: sampleWorkspace.situation.features,
    timelinePreview: sampleWorkspace.situation.timeline.slice(0, 1),
    provenanceSummary: [
      {
        provenance: "reporting_estimate",
        label: "Rapportert anslag",
        sourceIds: ["nrk"],
        confidence: {
          level: "likely",
          label: "Sannsynlig",
          sourceCount: 1,
          updatedAt: "2026-05-26T12:18:00.000Z",
        },
      },
    ],
    sourceConfidence: {
      level: "likely",
      label: "Sannsynlig",
      sourceCount: 1,
      updatedAt: "2026-05-26T12:18:00.000Z",
      rationale: "Rapportert i åpne kilder.",
    },
    hasPrivateAnnotations: false,
  };
  const second = {
    ...first,
    id: "flom-nidelva",
    type: "flood",
    title: "Vannstand ved Nidelva",
    status: "preliminary",
    importance: "normal",
    locationLabel: "Nidelva",
    primaryFeature: {
      id: "feature-nidelva",
      type: "Feature",
      geometry: { type: "Point", coordinates: [10.404, 63.425] },
      properties: {
        label: "Rapportert ved Nidelva",
        provenance: "reporting_estimate",
        sourceLabel: "Adresseavisen",
        updatedAt: "2026-05-26T12:19:00.000Z",
      },
    },
    features: [
      {
        id: "feature-nidelva",
        type: "Feature",
        geometry: { type: "Point", coordinates: [10.404, 63.425] },
        properties: {
          label: "Rapportert ved Nidelva",
          provenance: "reporting_estimate",
          sourceLabel: "Adresseavisen",
          updatedAt: "2026-05-26T12:19:00.000Z",
        },
      },
    ],
  };
  let requests = 0;
  await page.route("**/api/situations/workspace-map**", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        situations: [first, second],
        mapState: {
          layers: ["situations"],
          sourceFilters: {},
        },
        timeline: [],
        privateAnnotations: [],
      }),
    });
  });

  await page.goto("/situasjoner");
  const selected = page.getByRole("region", { name: "Valgt situasjon i kartet" });
  await expect(selected).toContainText("Skogbrann ved Bymarka");
  const requestsAfterLoad = requests;
  expect(requestsAfterLoad).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Vannstand ved Nidelva/ }).click();
  await expect(selected).toContainText("Vannstand ved Nidelva");
  await expect(page).toHaveURL(/s=flom-nidelva/);
  await page.waitForTimeout(100);
  expect(requests).toBe(requestsAfterLoad);
});

test("home nearby module links ranked local stories with the map", async ({ page }) => {
  await page.goto("/");

  const nearby = page.locator(".nearby-module");
  await expect(nearby.getByRole("heading", { name: "I nærheten" })).toBeVisible();
  await expect(nearby.getByText("4 stedsfestede saker og situasjoner.")).toBeVisible();
  await expect(nearby.getByRole("link", { name: "Åpne situasjonskart" })).toHaveAttribute(
    "href",
    "/situasjoner",
  );

  const situationRow = nearby.getByRole("button", { name: /Skogbrann ved Bymarka/ });
  await expect(situationRow).toHaveAttribute("aria-current", "true");
  await expect(nearby.getByText("Tilknyttet situasjon")).toBeVisible();
  await expect(nearby.getByRole("link", { name: "Åpne situasjon", exact: true })).toHaveAttribute(
    "href",
    "/situasjoner/skogbrann-bymarka",
  );

  const municipalRow = nearby.getByRole("button", { name: /Varsel om veiarbeid/ });
  await municipalRow.click();
  await expect(municipalRow).toHaveAttribute("aria-current", "true");
  await expect(nearby.getByRole("heading", { name: /Varsel om veiarbeid/ })).toBeVisible();
  await expect(nearby.getByText("Kommunalt varsel")).toBeVisible();
  await expect(nearby.getByRole("link", { name: /Åpne trafikkart/ })).toHaveAttribute(
    "href",
    "/trafikk",
  );

  await page.getByTitle(/Ny bru over Nidelva/).click();
  await expect(nearby.getByRole("heading", { name: /Ny bru over Nidelva/ })).toBeVisible();
  const mapAgeSlider = nearby.getByLabel("Filtrer kart etter alder");
  await expect(mapAgeSlider).toHaveValue("0");
  await mapAgeSlider.fill("2");
  await expect(page).toHaveURL(/window=24h/);
  await expect(mapAgeSlider).toHaveValue("2");
  await expect(nearby.getByText(/Kartet følger 24 timer/i)).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
});

test("home nearby module shows located active situations without matching articles", async ({
  page,
}) => {
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleBootstrap,
        articles: [],
        morningBrief: undefined,
        situations: [
          {
            id: "datex-gangasvegen",
            title: "Steinsprang, vegen er stengt",
            summary: "Gangåsvegen er stengt etter ras.",
            status: "active",
            verificationStatus: "Offentlig bekreftet",
            createdAt: "2026-07-02T08:00:00.000Z",
            updatedAt: "2026-07-02T09:00:00.000Z",
            locationLabel: "Gangåsvegen",
            primaryLocation: { lat: 63.311, lng: 10.21, label: "Gangåsvegen" },
          },
        ],
      }),
    });
  });

  await page.goto("/");

  const nearby = page.locator(".nearby-module");
  await expect(nearby.getByRole("heading", { name: "I nærheten" })).toBeVisible();
  await expect(nearby.getByText("1 stedsfestede saker og situasjoner.")).toBeVisible();
  const situationRow = nearby.getByRole("button", { name: /Steinsprang, vegen er stengt/ });
  await expect(situationRow).toHaveAttribute("aria-current", "true");
  await expect(situationRow.getByText("Offentlig bekreftet")).toBeVisible();
  await expect(nearby.getByRole("link", { name: "Åpne situasjon", exact: true })).toHaveAttribute(
    "href",
    "/situasjoner/datex-gangasvegen",
  );
  await expect(nearby.getByRole("link", { name: /Les saken/ })).toHaveCount(0);
  await expectNoHorizontalPageOverflow(page);
});

test("home feed renders persisted coverage-bundle labels for similar stories", async ({
  page,
  context,
}) => {
  const coverageBundle = {
    id: "coverage:incident:torvet-antibac",
    kind: "incident",
    confidence: "high",
    reason: "Samme hendelse på tvers av kilder",
    generatedAt: "2026-06-15T18:13:00.000Z",
  } as const;
  const articles: Article[] = [
    {
      id: "nrk-antibac",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Tente på antibac i Trondheim",
      excerpt: "En mann i 50-åra spruta antibac på bakken og tente på det på Torvet i Trondheim.",
      url: "https://example.test/nrk-antibac",
      publishedAt: "2026-06-15T18:12:00.000Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Trondheim", "Torvet"],
      location: { lat: 63.4305, lng: 10.3951, label: "Torvet" },
      coverageBundle,
    },
    {
      id: "politiloggen-antibac",
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Ro og orden: Trondheim, Torvet",
      excerpt:
        "Klokken 1846 fikk politiet inn en melding om en mann som sprutet antibac på bakken og tente på.",
      url: "https://example.test/politiloggen-antibac",
      publishedAt: "2026-06-15T18:00:00.000Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Trondheim", "Torvet"],
      location: { lat: 63.4305, lng: 10.3951, label: "Torvet" },
      coverageBundle,
    },
    {
      ...sampleBootstrap.articles[0]!,
      id: "other-local-story",
      publishedAt: "2026-06-15T16:30:00.000Z",
      situationId: undefined,
    },
  ];
  let timeWindowRequest: URL | undefined;

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        articles,
        situations: [],
        sourceHealth: sampleBootstrap.sourceHealth,
      }),
    });
  });
  await page.route("**/api/articles?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("from")) timeWindowRequest = url;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: articles }),
    });
  });
  await page.route("**/api/situations?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 63.4305, longitude: 10.3951 });

  await page.goto("/");

  const lead = page.locator(".lead-story");
  const sources = lead.locator(".source-cluster");
  await expect(lead.getByRole("heading", { name: "Tente på antibac i Trondheim" })).toBeVisible();
  await expect(sources.getByText("2 kilder · samme hendelse på tvers av kilder")).toBeVisible();
  await expect(sources.getByRole("link", { name: /NRK Trøndelag/ })).toBeVisible();
  await expect(sources.getByRole("link", { name: /Politiloggen/ })).toBeVisible();
  await expect(sources.getByText("Ro og orden: Trondheim, Torvet")).toBeVisible();
  await expect(page.locator(".story-card .story-title", { hasText: "Ro og orden" })).toHaveCount(0);
  await page.getByRole("button", { name: "24 timer" }).click();
  await expect(page).toHaveURL(/window=24h/);
  await expect
    .poll(() => timeWindowRequest?.searchParams.get("from") ?? "")
    .toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(timeWindowRequest?.searchParams.get("scope")).toBe("trondheim");
  await page.getByRole("button", { name: "Nær meg" }).click();
  await expect(page.getByRole("button", { name: "Lokalt fokus aktivt" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/innen 10 km/i)).toBeVisible();
  await page.getByLabel("Postnummer eller sted").fill("7041");
  await page.getByRole("button", { name: "Bruk" }).click();
  await expect(page.getByText(/Nær Lade · innen 5 km/i)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("nytt.home.neighborhoodFocus.v1")))
    .toBe("lade");
});

test("coverage bundle operations page renders persisted decisions and drawer detail", async ({
  page,
}) => {
  await page.route("**/api/operations/coverage-bundles**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
              },
            ],
          },
        ],
      }),
    });
  });

  await page.goto("/command/dekning");

  await expect(page.getByRole("heading", { name: "Dekningsgrupper" })).toBeVisible();
  await expect(page.getByText("Samme hendelse på tvers av kilder").first()).toBeVisible();
  await expect(page.getByText("Generisk steds-hendelse")).toBeVisible();
  await expect(page.getByText("Konflikt i spesifikt sted")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tidslinje" })).toHaveAttribute(
    "href",
    "/command/tidslinje",
  );
  await expect(page.getByRole("link", { name: "Kilderevisjon" })).toHaveAttribute(
    "href",
    "/command/kilder",
  );
});

test("command briefing page shows AI brief traceability", async ({ page }) => {
  await page.goto("/command/brief");

  await expect(page.getByRole("heading", { name: "Brief-revisjon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Morgenbrief" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Siste analyse" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historier bak briefen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rådata" })).toHaveAttribute(
    "href",
    "/command/radata",
  );
  await expectNoHorizontalPageOverflow(page);
});

test("traffic page shows summary cards semantic layers ranked list and detail drawer", async ({
  page,
}) => {
  await page.route("**/api/map/traffic-events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [
          {
            id: "datex:e6-sluppen",
            source: "datex",
            sourceEventId: "e6-sluppen",
            category: "closure",
            severity: "critical",
            state: "active",
            title: "E6 Omkjøring ved Sluppen",
            description: "Sørgående felt er stengt.",
            roadName: "E6",
            locationName: "Sluppen",
            updatedAt: "2026-06-01T16:42:00.000Z",
            geometry: { type: "Point", coordinates: [10.4, 63.4] },
            confidence: 0.98,
            relatedArticles: [
              {
                id: "article-1",
                title: "Adresseavisen: Kø ved Sluppen",
                url: "https://example.test/article",
                distanceMeters: 120,
                location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
              },
            ],
          },
          {
            id: "vegvesen-traffic-info:lade",
            source: "vegvesen_traffic_info",
            sourceEventId: "lade",
            category: "other",
            severity: "medium",
            state: "active",
            title: "Mindre melding ved Lade",
            description: "Lavere påvirkning enn E6-hendelsen.",
            roadName: "fv. 6660",
            locationName: "Lade",
            updatedAt: "2026-06-01T15:30:00.000Z",
            geometry: { type: "Point", coordinates: [10.45, 63.44] },
            confidence: 0.9,
          },
        ],
        brief: {
          headline: "2 trafikkhendelser",
          severity: "critical",
          freshness: "fresh",
          generatedAt: "2026-06-01T16:42:00.000Z",
          bullets: [],
          primaryEventIds: ["datex:e6-sluppen"],
          counts: {
            total: 2,
            byCategory: { closure: 1, other: 1 },
            bySeverity: { critical: 1, medium: 1 },
          },
        },
        corridorImpacts: [
          {
            id: "e6-south",
            name: "E6 Sluppen → Tiller",
            eventCount: 1,
            affectedEventIds: ["datex:e6-sluppen"],
            highestSeverity: "critical",
            geometry: {
              type: "LineString",
              coordinates: [
                [10.34, 63.37],
                [10.4, 63.4],
                [10.45, 63.44],
              ],
            },
            bufferMeters: 650,
            travelTime: {
              id: "100141",
              name: "E6 Sluppen → Tiller",
              state: "congested",
              travelTimeSeconds: 1260,
              freeFlowSeconds: 540,
              delaySeconds: 720,
              delayRatio: 2.33,
              updatedAt: "2026-06-01T16:41:00.000Z",
              sourceUrl: "https://example.test/datex/travel-time",
            },
          },
        ],
        sources: [
          {
            source: "datex",
            label: "Vegvesen DATEX",
            state: "ok",
            detail: "Sist hentet nå",
            lastCheckedAt: "2026-06-01T16:42:00.000Z",
          },
          {
            source: "datex_travel_time",
            label: "DATEX reisetid",
            state: "ok",
            detail: "1 korridor",
            lastCheckedAt: "2026-06-01T16:41:00.000Z",
          },
        ],
        weather: [],
        cameras: [],
        counters: [],
      }),
    });
  });
  await page.route("**/api/map/public-transport**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        vehicles: [],
        alerts: [
          {
            id: "entur-service-alert:ATB:line3",
            source: "entur_service_alerts",
            codespaceId: "ATB",
            situationNumber: "line3",
            summary: "Forsinkelse på linje 3",
            updatedAt: "2026-06-01T16:41:00.000Z",
            state: "active",
          },
        ],
        sources: [
          {
            source: "entur_service_alerts",
            label: "Entur avvik",
            state: "ok",
            detail: "1 aktivt avvik",
            lastCheckedAt: "2026-06-01T16:41:00.000Z",
          },
        ],
        generatedAt: "2026-06-01T16:42:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");

  await expect(page.getByRole("heading", { name: "Nå i trafikken" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Nå i trafikken" });
  await expect(summary.getByText("OFFISIELL").first()).toBeVisible();
  await expect(summary.getByText("REISETID").first()).toBeVisible();
  await expect(summary.getByText("KOLLEKTIV").first()).toBeVisible();
  await expect(page.getByLabel("Trafikkart og kartlag")).toContainText("Estimerte nyhetssteder");
  await openTrafficLayersIfHidden(page);
  const estimatedNewsLayer = page.getByLabel("Estimerte nyhetssteder");
  await expect(estimatedNewsLayer).toBeEnabled();
  await estimatedNewsLayer.check();
  await expect(estimatedNewsLayer).toBeChecked();
  await expect(page.getByRole("heading", { name: "Aktive trafikksituasjoner" })).toBeVisible();
  const rankedRows = page.locator(".traffic-event-list li");
  await expect(rankedRows.nth(0)).toContainText("E6 Omkjøring ved Sluppen");
  await expect(rankedRows.nth(1)).toContainText("Mindre melding ved Lade");
  await expect(page.getByText("E6 Sluppen → Tiller").first()).toBeVisible();
  await expect(page.getByText("Normal: 9 min · Nå: 21 min · +12 min").first()).toBeVisible();
  await page.getByRole("button", { name: /E6 Omkjøring ved Sluppen/ }).click();
  const drawer = page.getByLabel("Detaljer om trafikkhendelse");
  await expect(drawer).toContainText("Hvorfor ser jeg dette?");
  await expect(drawer).toContainText("Statens vegvesen DATEX Situation");
  await expect(drawer).toContainText("Adresseavisen: Kø ved Sluppen");
});

test("traffic map travel planner shows route-specific traffic and public transport advice", async ({
  page,
}) => {
  await page.route("**/api/map/travel-plan?**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("from")).toBe("Munkegata");
    expect(url.searchParams.get("to")).toBe("Leangen");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        origin: {
          query: "Munkegata",
          label: "Munkegata, Midtbyen",
          coordinate: [10.3951, 63.4305],
        },
        destination: {
          query: "Leangen",
          label: "Leangen, Trondheim",
          coordinate: [10.464, 63.433],
        },
        route: {
          source: "osrm",
          distanceMeters: 4850,
          durationSeconds: 660,
          geometry: {
            type: "LineString",
            coordinates: [
              [10.3951, 63.4305],
              [10.432, 63.432],
              [10.464, 63.433],
            ],
          },
          detail: "Rute beregnet med OSRM.",
        },
        trafficImpacts: [
          {
            event: {
              id: "vegvesen-traffic-info:near-e6-roadwork",
              source: "vegvesen_traffic_info",
              sourceEventId: "near-e6-roadwork",
              category: "roadworks",
              severity: "high",
              state: "active",
              title: "Veiarbeid på E6 ved Leangen",
              description: "Ett felt er stengt i retning sentrum.",
              updatedAt: "2026-06-01T09:00:00.000Z",
              geometry: { type: "Point", coordinates: [10.432, 63.432] },
            },
            distanceMeters: 80,
            severity: "high",
            summary: "80 m fra foreslått rute",
          },
        ],
        publicTransportSuggestions: [
          {
            id: "entur-vehicle:ATB:3-1",
            kind: "vehicle",
            title: "Buss 3 mot Lade",
            detail: "Sist sett nær ruten. Sjekk avgangstid hos AtB/Entur.",
            source: "Entur kjøretøyposisjoner",
            distanceMeters: 90,
          },
          {
            id: "entur-service-alert:ATB:line3",
            kind: "alert",
            title: "Forsinkelse på linje 3",
            detail: "Beregn ekstra tid.",
            source: "Entur avvik",
            distanceMeters: 120,
          },
          {
            id: "atb-entur-planner",
            kind: "planning_link",
            title: "Sjekk avganger hos AtB/Entur",
            detail:
              "Nytt viser trafikk- og avvikskontekst; bruk AtB/Entur for konkrete avganger og billetter.",
            source: "AtB/Entur",
            href: "https://www.atb.no/reiseplanlegger/",
          },
        ],
        sources: [],
        generatedAt: "2026-06-01T09:05:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");
  await openTrafficLayersIfHidden(page);
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.getByRole("heading", { name: "Reiseråd for ruten" })).toBeVisible();
  await expect(page.getByText("Munkegata, Midtbyen → Leangen, Trondheim")).toBeVisible();
  await expect(page.getByText("Veiarbeid på E6 ved Leangen")).toBeVisible();
  await expect(page.getByText("Buss 3 mot Lade")).toBeVisible();
  await expect(page.getByText("Forsinkelse på linje 3")).toBeVisible();
  await expect(page.getByText("Sjekk avganger hos AtB/Entur")).toBeVisible();
  await expect(
    page.getByText(
      "Nytt viser trafikk- og avvikskontekst; bruk AtB/Entur for konkrete avganger og billetter.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Åpne reiseplanlegger" })).toHaveAttribute(
    "href",
    "https://www.atb.no/reiseplanlegger/",
  );
});

test("traffic map clears a stale route when planner validation fails", async ({ page }) => {
  await page.route("**/api/map/travel-plan?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        origin: {
          query: "Munkegata",
          label: "Munkegata, Midtbyen",
          coordinate: [10.3951, 63.4305],
        },
        destination: {
          query: "Leangen",
          label: "Leangen, Trondheim",
          coordinate: [10.464, 63.433],
        },
        route: {
          source: "osrm",
          distanceMeters: 4850,
          durationSeconds: 660,
          geometry: {
            type: "LineString",
            coordinates: [
              [10.3951, 63.4305],
              [10.464, 63.433],
            ],
          },
          detail: "Rute beregnet med OSRM.",
        },
        trafficImpacts: [],
        publicTransportSuggestions: [
          {
            id: "atb-entur-planner",
            kind: "planning_link",
            title: "Sjekk avganger hos AtB/Entur",
            detail:
              "Nytt viser trafikk- og avvikskontekst; bruk AtB/Entur for konkrete avganger og billetter.",
            source: "AtB/Entur",
            href: "https://www.atb.no/reiseplanlegger/",
          },
        ],
        sources: [],
        generatedAt: "2026-06-01T09:05:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");
  await openTrafficLayersIfHidden(page);
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();
  await expect(page.getByRole("heading", { name: "Reiseråd for ruten" })).toBeVisible();
  await expect(page.locator('path[stroke="#2563eb"]')).toHaveCount(1);

  await page.getByLabel("Hvor er du?").fill("");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.getByRole("alert")).toContainText("Skriv inn både start og mål");
  await expect(page.locator('path[stroke="#2563eb"]')).toHaveCount(0);
});

test("traffic map invalidates an in-flight route when inputs change", async ({ page }) => {
  let fulfillRoute: (() => Promise<void>) | undefined;
  await page.route("**/api/map/travel-plan?**", async (route) => {
    await new Promise<void>((resolve) => {
      fulfillRoute = async () => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            origin: {
              query: "Munkegata",
              label: "Munkegata, Midtbyen",
              coordinate: [10.3951, 63.4305],
            },
            destination: {
              query: "Leangen",
              label: "Leangen, Trondheim",
              coordinate: [10.464, 63.433],
            },
            route: {
              source: "osrm",
              distanceMeters: 4850,
              durationSeconds: 660,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.464, 63.433],
                ],
              },
              detail: "Rute beregnet med OSRM.",
            },
            trafficImpacts: [],
            publicTransportSuggestions: [],
            sources: [],
            generatedAt: "2026-06-01T09:05:00.000Z",
          }),
        });
        resolve();
      };
    });
  });

  await page.goto("/trafikk");
  await openTrafficLayersIfHidden(page);
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();
  await expect(page.getByRole("button", { name: "Henter reiseråd ..." })).toBeDisabled();

  await page.getByLabel("Hvor er du?").fill("");
  await expect(page.getByRole("button", { name: "Finn reiseråd" })).toBeEnabled();
  await fulfillRoute?.();
  await page.waitForTimeout(100);

  await expect(page.getByRole("heading", { name: "Reiseråd for ruten" })).toHaveCount(0);
  await expect(page.locator('path[stroke="#2563eb"]')).toHaveCount(0);
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
  await openTrafficLayersIfHidden(page);
  await page.getByLabel("Kjøretøyposisjoner").check();
  await expect(page.getByText("45 → Hagen")).toBeVisible();
  await expect(page.getByText("Rota flyttet").first()).toBeVisible();
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
            source: "met",
            sourceLabel: "MET farevarsel",
            title: "Kraftig regn",
            area: "Trøndelag",
            level: "Gult",
            validUntil: "2026-06-02T09:00:00.000Z",
            url: "https://api.met.no/weatherapi/metalerts/2.0/current.rss",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [10.2, 63.3],
                  [10.6, 63.3],
                  [10.6, 63.5],
                  [10.2, 63.3],
                ],
              ],
            },
          },
          {
            id: "nve-flood",
            source: "nve",
            sourceLabel: "NVE flomvarsel",
            title: "Flomvarsel",
            area: "Trondheim",
            level: "Oransje",
            validUntil: "2026-06-02T09:00:00.000Z",
            url: "https://varsom.no",
          },
        ],
        hourly: [],
        roadWeather: [
          {
            id: "datex-weather:e6-tonstad",
            source: "datex_weather",
            stationId: "e6-tonstad",
            stationName: "E6 Tonstad",
            observedAt: "2026-06-01T08:03:00.000Z",
            updatedAt: "2026-06-01T08:04:00.000Z",
            geometry: { type: "Point", coordinates: [10.39, 63.36] },
            roadSurfaceTemperatureC: 1.5,
            precipitationMm: 1.8,
          },
        ],
        mapLayers: [
          {
            id: "met-warnings",
            title: "MET farevarselgeometri",
            source: "MET",
            status: "available",
            detail: "Tegnes med kildegeometri.",
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
  await expect(page.getByRole("heading", { name: "Værkart for Trondheim" })).toBeVisible();
  await expect(page.getByText("Vegværstasjoner", { exact: true })).toBeVisible();
  await expect(page.getByText("Tegnes i kart")).toBeVisible();
  await expect(page.locator(".weather-warning-area")).toHaveCount(1);
  await expect(page.locator(".road-context-marker-weather")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Hvem påvirkes?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Innbyggere" })).toBeVisible();
  await expect(page.getByText("Sivilforsvaret støtter politi, brann, helse")).toBeVisible();
});

test("searching from trafikk navigates home and shows filtered results", async ({ page }) => {
  await page.goto("/trafikk");
  await page.getByPlaceholder("Søk i saker").fill("bru");

  await expect(page).toHaveURL(/\/\?q=bru$/);
  await expect(page.getByRole("heading", { name: "Siste nytt i Trondheim" })).toBeVisible();
  await expect(
    page.locator(".news-section").getByRole("heading", { name: /Ny bru over Nidelva/ }),
  ).toBeVisible();
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

test("sport page shows a World Cup desk with local sport stories", async ({ page }) => {
  const sportArticles: Article[] = [
    {
      id: "sport-ranheim-aasane",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Ranheim tapte borte mot Åsane",
      excerpt: "Ranheim tapte 0-3 borte mot Åsane i 1. divisjon.",
      url: "https://example.test/sport-ranheim-aasane",
      publishedAt: "2026-06-30T17:59:00.000Z",
      scope: "trondelag",
      category: "Sport",
      places: ["Ranheim", "Trondheim"],
    },
  ];
  await page.route("**/api/articles?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("category") === "Sport") {
      expect(url.searchParams.get("scope")).toBe("trondelag");
      expect(url.searchParams.get("limit")).toBe("8");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: sportArticles }),
      });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/sport/world-cup", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...fallbackWorldCupDashboard,
        generatedAt: "2026-07-02T10:40:00.000Z",
        sourceMode: "live",
        sourceLabel: "ESPN livefeed",
        sourceDetail: "Kampstatus og tabeller normalisert fra ESPN.",
      }),
    });
  });

  await page.goto("/sport");

  await expect(page.getByRole("heading", { name: "VM 2026" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neste kamper" })).toBeVisible();
  const nextMatches = page.locator(".sport-match-panel");
  await expect(nextMatches).toContainText("Elfenbenskysten");
  await expect(nextMatches).toContainText("Norge");
  await expect(page.locator(".sport-data-status")).toContainText("ESPN livefeed");
  await expect(page.locator(".sport-data-status")).toContainText("Oppdateres automatisk");
  await expect(page.getByRole("heading", { name: "Veien videre" })).toBeVisible();
  await expect(page.locator(".sport-path-panel")).toContainText("Brasil");
  await expect(page.getByRole("heading", { name: "Sluttspillstatus" })).toBeVisible();
  await expect(page.locator(".sport-bracket-table")).toContainText("Møter Brasil");
  await expect(page.getByRole("heading", { name: "Gruppe I" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gruppe E" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lokale sportssaker" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ranheim tapte borte mot Åsane/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /FIFA kampoversikt/ })).toHaveAttribute(
    "target",
    "_blank",
  );

  await page.getByRole("button", { name: "Norge" }).click();
  await expect(page.locator(".sport-match-list")).toContainText("Elfenbenskysten");
  await expect(page.locator(".sport-match-list")).toContainText("Brasil");
  await expectNoHorizontalPageOverflow(page);
});

test("frontpage and sport stay responsive on phone and tablet viewports", async ({ page }) => {
  await page.route("**/api/sport/world-cup", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fallbackWorldCupDashboard),
    });
  });

  for (const viewport of [
    { width: 360, height: 780 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Siste nytt i Trondheim" })).toBeVisible();
    await expect(page.locator(".filters")).toHaveCSS("flex-wrap", "wrap");
    await expectNoHorizontalPageOverflow(page);

    await page.goto("/sport");
    await expect(page.getByRole("heading", { name: "VM 2026" })).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  }
});

test("command notification bridge shows Web Push readiness responsively", async ({ page }) => {
  await page.route("**/api/operations/notification-triggers**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-07-02T09:45:00.000Z",
        filters: { limit: 30 },
        summary: {
          total: 2,
          critical: 1,
          warning: 1,
          watch: 0,
          officialBacked: 1,
          highConfidence: 1,
        },
        pushStatus: {
          configured: true,
          label: "Mangler match",
          detail: "Minst én kandidat mangler aktivt abonnement som matcher alvorlighet og type.",
          activeSubscriptions: 1,
          matchingCandidates: 1,
          readyCandidates: 1,
          blockedCandidates: 1,
          deliveryCounts: { total: 2, sent: 1, failed: 1, claimed: 0, skipped: 0 },
          health: {
            source: "web_push",
            label: "Web Push",
            state: "degraded",
            lastCheckedAt: "2026-07-02T09:44:00.000Z",
            detail: "2 kandidater vurdert, 1 sendt, 1 feilet",
          },
        },
        items: [
          {
            id: "notification:situation:road-one",
            kind: "traffic_disruption",
            severity: "critical",
            deliveryState: "ready",
            title: "Steinsprang, vegen er stengt",
            body: "Gangåsvegen: Vegen er stengt og omkjøring er skiltet.",
            detail: "Klar for Web Push dersom en aktiv abonnent matcher alvorlighet og type.",
            score: 0.91,
            confidence: {
              level: "confirmed",
              label: "Bekreftet",
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
            reasons: ["Har offentlig kildegrunnlag."],
            links: [
              {
                kind: "situation",
                label: "Åpne situasjon",
                href: "/situasjoner/road-one",
                situationId: "road-one",
              },
            ],
          },
          {
            id: "notification:article:violence-one",
            kind: "public_safety",
            severity: "warning",
            deliveryState: "no_subscribers",
            title: "Voldshendelse på Lade",
            body: "Ingen aktive abonnement matcher denne typen.",
            detail: "Ingen aktive push-abonnement matcher alvorlighet og type.",
            score: 0.72,
            confidence: {
              level: "likely",
              label: "Sannsynlig",
              score: 0.72,
              sourceCount: 1,
              updatedAt: "2026-07-02T09:45:00.000Z",
            },
            generatedAt: "2026-07-02T09:45:00.000Z",
            eventUpdatedAt: "2026-07-02T09:42:00.000Z",
            articleIds: ["violence-one"],
            sourceIds: ["politiloggen"],
            sourceLabels: ["Politiloggen"],
            matchedKeywords: ["voldshendelse"],
            reasons: ["Høyeffektsord i fersk sak."],
            links: [],
          },
        ],
      }),
    });
  });
  await page.route("**/api/operations/notification-deliveries**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-07-02T09:46:00.000Z",
        items: [
          {
            id: "delivery-one",
            triggerId: "notification:situation:road-one",
            subscriptionId: "subscription-one",
            userId: "owner-one",
            status: "sent",
            kind: "traffic_disruption",
            severity: "critical",
            title: "Steinsprang, vegen er stengt",
            body: "Gangåsvegen: Vegen er stengt.",
            createdAt: "2026-07-02T09:46:00.000Z",
            sentAt: "2026-07-02T09:46:01.000Z",
          },
          {
            id: "delivery-two",
            triggerId: "notification:article:violence-one",
            subscriptionId: "subscription-one",
            userId: "owner-one",
            status: "failed",
            kind: "public_safety",
            severity: "warning",
            title: "Voldshendelse på Lade",
            body: "Ingen aktive abonnement matcher denne typen.",
            createdAt: "2026-07-02T09:47:00.000Z",
          },
        ],
        summary: { total: 2, sent: 1, failed: 1, claimed: 0, skipped: 0 },
      }),
    });
  });

  for (const viewport of [
    { width: 360, height: 780 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/command/varsler");
    await expect(page.getByRole("heading", { name: "Varselutløsere" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mangler match" })).toBeVisible();
    await expect(page.getByText("1/2")).toBeVisible();
    await expect(page.getByText("Kildehelse kontrollert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Siste leveranser" })).toBeVisible();
    await expect(page.getByText("Steinsprang, vegen er stengt").first()).toBeVisible();
    await expect(page.getByText("Ingen abonnent").first()).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  }
});

test("unknown viewer route is a missing page, not an owner-only denial", async ({ page }) => {
  await page.goto("/sport-does-not-exist");

  await expect(page.getByRole("heading", { name: "Fant ikke siden" })).toBeVisible();
  await expect(page.getByText("Dette krever eiertilgang")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sport" })).toHaveAttribute("href", "/sport");
});

test("viewer shell keeps command center tools out of the public traffic map", async ({ page }) => {
  await useViewerSession(page);

  for (const route of [
    { path: "/", heading: "Siste nytt i Trondheim" },
    { path: "/trafikk", heading: "Nå i trafikken" },
    { path: "/vaer", heading: "Vær" },
    { path: "/sport", heading: "VM 2026" },
    { path: "/situasjoner", heading: "Trondheim situasjonskart" },
  ]) {
    await page.goto(route.path);
    await expect(page.locator(".session-role")).toContainText("Lesetilgang · Ingrid Leser");
    await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Hovedmeny" });
    await expect(navigation.getByRole("link", { name: "Kommandosenter" })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: "Lagret" })).toHaveCount(0);
  }

  await page.goto("/trafikk");
  await openTrafficLayersIfHidden(page);
  await expect(page.getByText("Private notater/tegninger")).toHaveCount(0);

  for (const ownerOnlyPath of [
    "/command",
    "/command/brief",
    "/command/radata",
    "/drift",
    "/lagret",
  ]) {
    await page.goto(ownerOnlyPath);
    await expect(page.getByRole("heading", { name: "Dette krever eiertilgang" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Til forsiden" })).toHaveAttribute("href", "/");
  }
});

test("article save missing target rolls back optimistic state", async ({ page }) => {
  await page.route("**/api/saved/articles/a-bridge", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Saken finnes ikke lenger." }),
    });
  });

  await page.goto("/?q=bru");
  const saveButton = page.getByRole("button", {
    name: /(Lagre sak|Fjern fra lagret): Ny bru over Nidelva/,
  });
  const initialLabel = await saveButton.getAttribute("aria-label");
  await expect(saveButton).toBeEnabled();

  await saveButton.click();
  await expect(page.getByRole("alert")).toContainText("Saken finnes ikke lenger.");
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
  expect(calls).toBe(1);
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

test("mobile traffic page prioritizes the map before long summaries and filters", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout contract");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trafikk");

  const heading = page.getByRole("heading", { name: "Nå i trafikken" });
  await expect(heading).toBeVisible();
  const layersButton = page.getByRole("button", { name: "Kartlag og filtre" });
  await expect(layersButton).toBeVisible();

  const headingBox = await heading.boundingBox();
  const layersBox = await layersButton.boundingBox();
  const workspaceBox = await page.locator(".traffic-workspace").boundingBox();
  const mapBox = await page.locator(".traffic-map").boundingBox();
  expect(mapBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(headingBox?.y ?? 0);
  expect(mapBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(layersBox?.y ?? 0);
  for (const box of [layersBox, workspaceBox, mapBox]) {
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.width ?? Number.POSITIVE_INFINITY) + (box?.x ?? 0)).toBeLessThanOrEqual(391);
  }
  await expectNoHorizontalPageOverflow(page);
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
  await expect(
    page.getByRole("heading", { name: "Skogbrann ved Bymarka", level: 1 }),
  ).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Trondheim situasjonskart" })).toBeVisible();
  const situationDetails = page.getByLabel("Situasjonsdetaljer");
  await expect(situationDetails.getByRole("link", { name: "Åpne arbeidsrom" })).toBeVisible();
  await expect(
    situationDetails.getByRole("link", { name: "Se i operasjonstidslinje" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Kommandosenter" }).click();
  await expect(page.getByRole("heading", { name: "Kommandosenter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intelligence Bridge" })).toBeVisible();
  const intelligenceBridge = page.locator(".dashboard-widget", {
    has: page.getByRole("heading", { name: "Intelligence Bridge" }),
  });
  await expect(
    intelligenceBridge.getByRole("link", { name: "Åpne brief-revisjon" }),
  ).toHaveAttribute("href", "/command/brief");
  await expect(page.getByRole("heading", { name: "Sikkerhetskopi" })).toBeVisible();
  await expect(page.getByText("Innhentede saker", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Åpne kilderevisjon" }).click();
  await expect(page).toHaveURL(/\/command\/kilder$/);
  await expect(page.getByRole("heading", { name: "Kildehelse og proveniens" })).toBeVisible();
  await expect(page.getByText("Kilder i filter")).toBeVisible();
  await page.getByRole("link", { name: "Tidslinje" }).click();
  await expect(page).toHaveURL(/\/command\/tidslinje$/);
  await expect(page.getByRole("heading", { name: "Operasjonstidslinje" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Siste operative spor" })).toBeVisible();
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
