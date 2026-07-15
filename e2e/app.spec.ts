import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  buildCityPulseStories,
  fallbackWorldCupDashboard,
  sampleBootstrap,
  sampleWorkspace,
  type Article,
  type CityPulseStory,
  type MorningBrief,
  type SourceHealth,
} from "@nytt/shared";

async function openTrafficLayersIfHidden(page: Page): Promise<void> {
  const mapDisclosure = page.locator("details.traffic-map-disclosure").first();
  if ((await mapDisclosure.count()) > 0) {
    await mapDisclosure.evaluate((node) => {
      (node as HTMLDetailsElement).open = true;
    });
  }
  const layersButton = page.getByRole("button", { name: "Kartlag og filtre" });
  const buttonAttached = await layersButton
    .waitFor({ state: "attached", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  if (!buttonAttached) return;
  const expanded = await layersButton.getAttribute("aria-expanded").catch(() => null);
  if ((await layersButton.isVisible().catch(() => false)) && expanded !== "true") {
    await layersButton.scrollIntoViewIfNeeded();
    await layersButton.click();
  }
}

async function openTrafficDisclosure(page: Page, summary: string): Promise<void> {
  const disclosure = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: summary }) })
    .first();
  await expect(disclosure).toHaveCount(1);
  const isOpen = await disclosure.evaluate((node) => (node as HTMLDetailsElement).open);
  if (!isOpen) {
    await disclosure.locator("summary").click();
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

function cityPulseStoryPageBody(articles: Article[], nextCursor?: string): string {
  return JSON.stringify({
    items: buildCityPulseStories(articles),
    ...(nextCursor ? { nextCursor } : {}),
  });
}

const travelPlanComparisonFixturePresets = ["now", "in30", "in60", "in120"] as const;

function estimateWalkingDurationSeconds(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  return Math.max(60, Math.round(distanceMeters / 1.35 / 60) * 60);
}

function hasUsableTransitItinerary(itinerary: Record<string, any>): boolean {
  const modes = Array.isArray(itinerary.modes) ? itinerary.modes : [];
  return itinerary.decision !== "avoid" && modes.some((mode) => mode !== "walk");
}

function withModeAwareTravelPlanMock(plan: Record<string, any>) {
  const itineraries = Array.isArray(plan.itineraries) ? plan.itineraries : [];
  if (itineraries.some(hasUsableTransitItinerary)) {
    return {
      ...plan,
      primaryMode: "transit",
    };
  }

  const route = plan.route;
  const coordinates = route?.geometry?.coordinates;
  const hasUsableRoute =
    typeof route?.distanceMeters === "number" &&
    route.distanceMeters > 0 &&
    route?.geometry?.type === "LineString" &&
    Array.isArray(coordinates) &&
    coordinates.length >= 2;
  if (!hasUsableRoute) {
    return {
      ...plan,
      primaryMode: "fallback",
    };
  }

  const confidence = route.source === "osrm" ? "route" : "corridor";
  return {
    ...plan,
    primaryMode: "walk",
    walkingRoute: {
      source: route.source,
      geometry: route.geometry,
      distanceMeters: route.distanceMeters,
      durationSeconds: estimateWalkingDurationSeconds(route.distanceMeters),
      detail:
        confidence === "route"
          ? "Gangtid estimert fra rutelengde. Ruten vises som OSRM-korridor."
          : "Gangtid estimert fra luftlinjekorridor.",
      confidence,
    },
  };
}

function travelPlanComparisonFixture(plan: unknown, activePreset = "now") {
  const selectedPlan = withModeAwareTravelPlanMock(plan as Record<string, any>);
  return {
    activePreset,
    selectedPlan,
    sources: travelPlanComparisonFixturePresets.map((preset) => ({ preset, plan: selectedPlan })),
    generatedAt: "2026-06-01T09:05:00.000Z",
  };
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

async function coverageFixtureControl(
  page: Page,
  action: "reset" | "advance-generation" | "restore-defaults",
): Promise<{ generationId: string }> {
  const session = await page.request.get("/api/session");
  expect(session.ok()).toBe(true);
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  const response = await page.request.post(`/api/__e2e/coverage/${action}`, {
    headers: { "X-CSRF-Token": csrfToken },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { generationId: string };
}

function staleCoverageSplitStory(): CityPulseStory {
  const primary = {
    ...sampleBootstrap.articles[0]!,
    id: "stale-split-result-article",
    title: "Gammelt splitteresultat skal forkastes",
    url: "https://example.test/stale-split-result",
  } satisfies Article;
  return {
    id: "stale-split-result-story",
    primaryArticleId: primary.id,
    articleIds: [primary.id],
    primary,
    articles: [primary],
    sourceLabels: [primary.sourceLabel],
    sourceCount: 1,
    updateCount: 1,
    latestAt: primary.publishedAt,
    category: primary.category,
  };
}

async function changeCoverageRouteFilterAndGeneration(page: Page): Promise<string> {
  const { generationId } = await coverageFixtureControl(page, "advance-generation");
  await page.evaluate(() => {
    window.history.pushState({}, "", "/?scope=trondelag&category=Krim");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/scope=trondelag/);
  await expect(page).toHaveURL(/category=Krim/);
  await expect(page.locator("main.home")).toHaveAttribute("data-generation-id", generationId);
  return generationId;
}

async function normalizedArticleIds(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute("data-article-id"))
      .filter((id): id is string => Boolean(id))
      .sort(),
  );
}

async function mockTrafficDepartureBoard(page: Page): Promise<void> {
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        detail: "Entur viser konkrete avganger nær valgt område.",
        areaLabel: "Trondheim sentrum",
        center: { lat: 63.4305, lon: 10.3951 },
        stops: [
          {
            id: "NSR:StopPlace:41613",
            name: "Prinsens gate",
            coordinate: [10.392007, 63.431034],
            distanceMeters: 183,
            modes: ["bus"],
            departures: [
              {
                id: "departure:71",
                stopId: "NSR:StopPlace:41613",
                stopName: "Prinsens gate",
                stopDistanceMeters: 183,
                quayId: "NSR:Quay:71181",
                quayName: "Prinsens gate",
                quayPublicCode: "P2",
                mode: "bus",
                lineId: "ATB:Line:71",
                publicCode: "71",
                lineName: "MelhusSkyss-Trondheim",
                destinationName: "Dora",
                aimedDepartureTime: "2026-07-05T16:24:00.000Z",
                expectedDepartureTime: "2026-07-05T16:26:48.000Z",
                delaySeconds: 168,
                realtime: true,
                cancelled: false,
                notices: [
                  {
                    id: "notice:route-change",
                    title: "Endret rute",
                    detail: "Planlagt vegarbeid.",
                    severity: "info",
                  },
                ],
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
              },
            ],
          },
        ],
        departures: [
          {
            id: "departure:71",
            stopId: "NSR:StopPlace:41613",
            stopName: "Prinsens gate",
            stopDistanceMeters: 183,
            quayId: "NSR:Quay:71181",
            quayName: "Prinsens gate",
            quayPublicCode: "P2",
            mode: "bus",
            lineId: "ATB:Line:71",
            publicCode: "71",
            lineName: "MelhusSkyss-Trondheim",
            destinationName: "Dora",
            aimedDepartureTime: "2026-07-05T16:24:00.000Z",
            expectedDepartureTime: "2026-07-05T16:26:48.000Z",
            delaySeconds: 168,
            realtime: true,
            cancelled: false,
            notices: [
              {
                id: "notice:route-change",
                title: "Endret rute",
                detail: "Planlagt vegarbeid.",
                severity: "info",
              },
            ],
            handoffUrl: "https://www.atb.no/reiseplanlegger/",
          },
        ],
        sources: [
          {
            source: "entur_service_alerts",
            label: "Entur avvik",
            state: "ok",
            detail: "1 aktivt avvik",
          },
        ],
        generatedAt: "2026-07-05T16:20:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });
}

async function mockTravelPlaceSuggestions(page: Page): Promise<void> {
  await page.route("**/api/map/travel-suggestions**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") ?? "";
    const suggestions = query.toLocaleLowerCase("nb").includes("munkegata")
      ? [
          {
            id: "NSR:StopPlace:63277",
            label: "Munkegata, Trondheim",
            query: "Munkegata, Trondheim",
            kind: "stop",
            coordinate: [10.393742, 63.432883],
            locality: "Trondheim",
            source: "Entur Geocoder",
          },
        ]
      : query.toLocaleLowerCase("nb").includes("leangen")
        ? [
            {
              id: "NSR:StopPlace:44051",
              label: "Leangen, Trondheim",
              query: "Leangen, Trondheim",
              kind: "stop",
              coordinate: [10.464, 63.433],
              locality: "Trondheim",
              source: "Entur Geocoder",
            },
          ]
        : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query,
        status: suggestions.length ? "ok" : "empty",
        detail: suggestions.length
          ? "Entur foreslår stopp og steder i Trøndelag."
          : "Ingen Entur-steder funnet i Trøndelag for søket.",
        suggestions,
        generatedAt: "2026-07-05T16:20:00.000Z",
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await coverageFixtureControl(page, "restore-defaults");
  await mockTrafficDepartureBoard(page);
  await mockTravelPlaceSuggestions(page);
});

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
  await expect(page.getByLabel("Sammendrag av bypulssaker")).toContainText(
    /bypulssaker samlet fra/,
  );
  const trustStrip = page.getByLabel("Kildebilde for bypulssaker");
  await expect(trustStrip).toContainText("Verifisert");
  await expect(trustStrip).toContainText("Kildetillit");
  await expect(page.getByText("Oppdaterer saker...")).toHaveCount(0);
  expect(duplicateRefreshes).toEqual([]);
});

test("frontpage can refresh City Pulse on demand without duplicate article fetches", async ({
  page,
}) => {
  const articleRequests: string[] = [];
  let bootstrapCalls = 0;
  let refreshRequested = false;
  const initialArticle: Article = {
    ...sampleBootstrap.articles[0]!,
    id: "city-pulse-initial",
    title: "Første bypuls fra bootstrap",
    excerpt: "Dette er den første forsiden.",
    publishedAt: "2026-07-03T10:00:00.000Z",
  };
  const refreshedArticle: Article = {
    ...sampleBootstrap.articles[0]!,
    id: "city-pulse-refreshed",
    title: "Oppdatert bypuls fra live-refresh",
    excerpt: "Dette kom inn etter manuell oppdatering.",
    publishedAt: "2026-07-03T10:05:00.000Z",
  };
  await page.route("**/api/bootstrap", async (route) => {
    bootstrapCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleBootstrap,
        articles: refreshRequested ? [refreshedArticle] : [initialArticle],
        stories: buildCityPulseStories(refreshRequested ? [refreshedArticle] : [initialArticle]),
        situations: [],
        morningBrief: undefined,
      }),
    });
  });
  await page.route("**/api/articles?**", async (route) => {
    articleRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [refreshedArticle] }),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 2, name: "Første bypuls fra bootstrap" }),
  ).toBeVisible();
  expect(bootstrapCalls).toBeGreaterThanOrEqual(1);
  expect(articleRequests).toEqual([]);
  refreshRequested = true;
  await page.getByRole("button", { name: "Oppdater bypuls" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Oppdatert bypuls fra live-refresh" }),
  ).toBeVisible();
  expect(bootstrapCalls).toBeGreaterThanOrEqual(2);
  expect(articleRequests).toEqual([]);
  await expectNoHorizontalPageOverflow(page);
});

test("default City Pulse load more uses story pagination instead of raw article pages", async ({
  page,
}) => {
  const rawArticleRequests: string[] = [];
  const initialArticle: Article = {
    ...sampleBootstrap.articles[0]!,
    id: "city-pulse-default-initial",
    title: "Første samlede bypulsrad",
    excerpt: "Bootstrap leverer første rad uten ekstra artikkelforespørsel.",
    publishedAt: "2026-07-03T10:00:00.000Z",
  };
  const nextArticle: Article = {
    ...sampleBootstrap.articles[0]!,
    id: "city-pulse-default-next",
    title: "Neste samlede bypulsrad",
    excerpt: "Denne kommer fra story-endepunktet.",
    publishedAt: "2026-07-03T09:30:00.000Z",
  };
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleBootstrap,
        articles: [initialArticle],
        stories: buildCityPulseStories([initialArticle]),
        storyNextCursor: "story-next",
        situations: [],
        morningBrief: undefined,
      }),
    });
  });
  await page.route("**/api/articles?**", async (route) => {
    rawArticleRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("cursor")).toBe("story-next");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: cityPulseStoryPageBody([nextArticle]),
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 2, name: "Første samlede bypulsrad" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Vis flere saker" }).click();
  await expect(
    page.locator(".coverage-source-cluster").getByRole("link", { name: /Neste samlede bypulsrad/ }),
  ).toBeVisible();
  expect(rawArticleRequests).toEqual([]);
});

test("filtered City Pulse modules use refreshed feed instead of stale bootstrap context", async ({
  page,
}) => {
  const freshPublishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const staleArticle: Article = {
    id: "stale-default-story",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Stale default road story",
    excerpt: "Denne saken hører til standardforsiden.",
    url: "https://example.test/stale",
    publishedAt: "2026-06-01T08:00:00.000Z",
    scope: "trondheim",
    category: "Nyheter",
    places: ["Trondheim"],
    location: { lat: 63.43, lng: 10.39, label: "Trondheim" },
  };
  const freshArticle: Article = {
    id: "fresh-traffic-story",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Fersk trafikk ved Sluppen",
    excerpt: "Trafikken går sakte ved Sluppen etter arbeid i vegbanen.",
    url: "https://example.test/fresh-traffic",
    publishedAt: freshPublishedAt,
    scope: "trondheim",
    category: "Transport",
    places: ["Sluppen"],
    location: { lat: 63.39795, lng: 10.3997, label: "Sluppen" },
  };
  const staleBrief: MorningBrief = {
    generatedAt: "2026-06-01T08:30:00.000Z",
    title: "Stale morgenbrief",
    mode: "ai_assisted",
    sourceLine: "AI-assistert · gammelt grunnlag",
    paragraphs: [
      "Denne morgenbriefen hører til standardforsiden.",
      "Den skal ikke vises i et filtrert transportvindu.",
      "Stale Ras følger fortsatt standardforsiden.",
    ],
    highlights: [
      { label: "Saker", value: "99", detail: "Stale leder bildet" },
      { label: "Situasjoner", value: "1", detail: "Aktive eller til vurdering" },
      { label: "Kilder", value: "1/1", detail: "Rapporterer OK" },
    ],
    articleIds: [staleArticle.id],
    situationIds: ["stale-ras"],
  };

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        articles: [staleArticle],
        stories: buildCityPulseStories([staleArticle]),
        situations: [
          {
            id: "stale-ras",
            title: "Stale Ras",
            summary: "Denne situasjonen hører til standardforsiden.",
            status: "active",
            verificationStatus: "Offentlig bekreftet",
            createdAt: "2026-06-01T07:00:00.000Z",
            updatedAt: "2026-06-01T08:00:00.000Z",
            locationLabel: "Gangåsvegen",
            primaryLocation: { lat: 63.311, lng: 10.21, label: "Gangåsvegen" },
          },
        ],
        sourceHealth: sampleBootstrap.sourceHealth,
        morningBrief: staleBrief,
      }),
    });
  });
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: cityPulseStoryPageBody([freshArticle]),
    });
  });

  await page.goto("/?category=Transport&window=24h");

  await expect(
    page.locator(".news-section").getByRole("heading", { name: "Fersk trafikk ved Sluppen" }),
  ).toBeVisible();
  await expect(page.getByText("Stale morgenbrief")).toHaveCount(0);
  await expect(page.getByText("Stale leder bildet")).toHaveCount(0);
  await expect(page.getByText("Stale Ras")).toHaveCount(0);
  await expect(page.getByText("Morgenbildet dekker 1 ferske saker")).toHaveCount(0);

  const nearby = page.locator(".nearby-module");
  await expect(nearby.getByText("1 stedsfestede saker og situasjoner.")).toBeVisible();
  await expect(nearby.getByRole("button", { name: /Fersk trafikk ved Sluppen/ })).toBeVisible();
});

test("City Pulse keeps the public frontpage free of morning brief chrome", async ({ page }) => {
  const article = sampleBootstrap.articles.find((item) => item.id === "a-road")!;
  const situation = sampleBootstrap.situations[0]!;
  const morningBrief: MorningBrief = {
    generatedAt: "2026-07-02T07:30:00.000Z",
    title: "Morgenbrief",
    mode: "ai_assisted",
    sourceLine: "Automatisk analyse · 6/7 kilder OK",
    paragraphs: [
      "Bypulsen starter med tre tydelige signaler i Trondheim.",
      "Trafikk og framkommelighet peker seg ut rundt østbyen og E6.",
      "Ett åpent situasjonsrom følges videre, men offentlige kilder styrer prioriteringen.",
    ],
    highlights: [
      { label: "Saker", value: "18", detail: "Transport leder bildet" },
      { label: "Situasjoner", value: "1", detail: "Aktive eller til vurdering" },
      { label: "Kilder", value: "6/7", detail: "Rapporterer OK" },
    ],
    articleIds: [article.id],
    situationIds: [situation.id],
    aiRun: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      status: "ok",
      completedAt: "2026-07-02T07:25:00.000Z",
    },
  };
  const sourceHealth: SourceHealth[] = [
    ...sampleBootstrap.sourceHealth,
    {
      source: "deepseek",
      label: "AI-analyse",
      state: "degraded",
      detail: "DeepSeek bruker deterministisk reserveanalyse.",
      lastCheckedAt: "2026-07-02T07:35:00.000Z",
    },
    {
      source: "web_push",
      label: "Web Push",
      state: "disabled",
      detail: "Intern varslingskanal.",
    },
  ];

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleBootstrap,
        morningBrief,
        sourceHealth,
      }),
    });
  });

  await page.goto("/");

  const brief = page.locator(".morning-brief");
  await expect(brief).toHaveCount(0);
  await expect(page.getByText("Kort oversikt")).toHaveCount(0);
  await expect(page.getByText("Bypulsen starter med tre tydelige signaler")).toHaveCount(0);
  const situationBanner = page.locator(".situation-banner");
  await expect(situationBanner.getByRole("heading", { name: situation.title })).toBeVisible();
  await expect(situationBanner.getByRole("link", { name: /Åpne situasjonsrom/ })).toHaveAttribute(
    "href",
    `/situasjoner/${situation.id}`,
  );
  const publicSources = page.locator(".source-status");
  await expect(publicSources).toContainText("Delvis kildegrunnlag");
  await expect(publicSources).toContainText("2 kilder trenger tilsyn blant 7 åpne kilder.");
  await expect(publicSources).toContainText("2 interne kontroller vises bare i Command Center.");
  await expect(publicSources).not.toContainText("Basic Auth");
  await expect(publicSources).not.toContainText("AI-analyse");
  await expect(publicSources).not.toContainText("Web Push");
  await expectNoHorizontalPageOverflow(page);
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

test("situation overview recency presets update the workspace query", async ({ page }) => {
  await page.goto("/situasjoner");

  const requestPromise = page.waitForRequest((request) => {
    if (!request.url().includes("/api/situations/workspace-map")) return false;
    return new URL(request.url()).searchParams.has("from");
  });
  await page.getByRole("button", { name: "24 timer" }).click();
  const request = await requestPromise;
  const requestUrl = new URL(request.url());

  expect(requestUrl.searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await expect(page).toHaveURL(/window=24h/);
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
    publicVisibility: "public",
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
  await expect(nearby.locator(".nearby-kind-situation")).toHaveText("Tilknyttet situasjon");
  await expect(nearby.getByRole("link", { name: "Åpne situasjon", exact: true })).toHaveAttribute(
    "href",
    "/situasjoner/skogbrann-bymarka",
  );

  const municipalRow = nearby.getByRole("button", { name: /Varsel om veiarbeid/ });
  await municipalRow.click();
  await expect(municipalRow).toHaveAttribute("aria-current", "true");
  await expect(nearby.getByRole("heading", { name: /Varsel om veiarbeid/ })).toBeVisible();
  await expect(nearby.locator(".nearby-kind-municipal")).toHaveText("Kommunalt varsel");
  await expect(nearby.getByRole("link", { name: /Åpne trafikk/ })).toHaveAttribute(
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

test("home nearby map cluster popup exposes member stories", async ({ page }) => {
  const sluppenArticle = sampleBootstrap.articles.find((article) => article.id === "a-sluppen")!;
  const clusterArticles: Article[] = [
    {
      ...sluppenArticle,
      publicVerification: {
        status: "verified",
        label: "Verifisert",
        detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
        officialSources: ["datex"],
        reportingSources: ["adressa"],
        situationId: "datex-sluppen",
      },
    },
    {
      ...sluppenArticle,
      id: "a-sluppen-traffic",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Oppdatering ved Sluppen",
      excerpt: "Trafikken går sakte ved Sluppen etter vegarbeid og innsnevring.",
      url: "https://example.test/sluppen-trafikk",
      publishedAt: "2026-05-26T09:48:00.000Z",
      category: "Transport",
      places: ["Sluppen"],
      location: { lat: 63.39795, lng: 10.3997, label: "Sluppen" },
    },
    {
      ...sampleBootstrap.articles[3]!,
      id: "a-lade-far",
      location: { lat: 63.4402, lng: 10.437, label: "Lade" },
    },
  ];

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleBootstrap,
        articles: clusterArticles,
        stories: buildCityPulseStories(clusterArticles),
        situations: [],
        morningBrief: undefined,
      }),
    });
  });

  await page.goto("/");

  const nearby = page.locator(".nearby-module");
  await expect(nearby.getByRole("heading", { name: "I nærheten" })).toBeVisible();
  await nearby.locator(".story-marker-cluster").click();

  const popup = page.locator(".story-marker-popup");
  await expect(popup.getByText("2 saker")).toBeVisible();
  await expect(popup.getByText("Sluppen", { exact: true })).toBeVisible();
  await expect(popup.getByRole("button", { name: /Starter byggingen/ })).toBeVisible();
  await expect(popup.getByText(/Verifisert · Statens vegvesen DATEX/)).toBeVisible();
  await expect(popup.getByText(/Kildetillit: Bekreftet/).first()).toBeVisible();
  await popup.getByRole("button", { name: /Oppdatering ved Sluppen/ }).click();

  await expect(nearby.getByRole("heading", { name: "Oppdatering ved Sluppen" })).toBeVisible();
  await expect(
    nearby.locator(".nearby-detail").getByText("Stedsfestet transport- eller framkommelighetssak"),
  ).toBeVisible();
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
        stories: [],
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
  let timeWindowStoryRequest: URL | undefined;
  let categoryStoryRequest: URL | undefined;

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        articles,
        stories: buildCityPulseStories(articles),
        situations: [],
        sourceHealth: sampleBootstrap.sourceHealth,
      }),
    });
  });
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("from")) timeWindowStoryRequest = url;
    if (url.searchParams.get("category")) categoryStoryRequest = url;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: cityPulseStoryPageBody(articles),
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

  const channels = page.getByLabel("Tematiske kanaler");
  await expect(channels.getByRole("button", { name: /Alle/ })).toContainText("2");
  await expect(channels.getByRole("button", { name: /Hendelser/ })).toContainText("2");
  const channelContext = page.locator(".channel-context");
  await expect(channelContext).toContainText("Alle");
  await expect(channelContext).toContainText("2 bypulssaker i gjeldende visning");
  await channels.getByRole("button", { name: /Hendelser/ }).click();
  await expect(page).toHaveURL(/category=Hendelser/);
  await expect(channelContext).toContainText("Hendelser");
  await expect(channelContext).toContainText("Pågående og stedsfestede hendelser");
  await expect(channelContext.getByRole("button", { name: "Vis alle kanaler" })).toBeVisible();
  await expect
    .poll(() => categoryStoryRequest?.searchParams.get("category") ?? "")
    .toBe("Hendelser");
  await channelContext.getByRole("button", { name: "Vis alle kanaler" }).click();
  await expect(page).not.toHaveURL(/category=Hendelser/);
  await expect(channelContext).toContainText("Alle");
  await expect(channelContext.getByRole("button", { name: "Vis alle kanaler" })).toHaveCount(0);
  await expectNoHorizontalPageOverflow(page);

  await expect(page.getByLabel("Kort oversikt")).toHaveCount(0);
  await expect(page.locator(".morning-brief")).toHaveCount(0);
  await expect(page.getByLabel("Bypulsmoduler")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tilpass oppsett" })).toHaveCount(0);

  const lead = page.locator(".lead-story");
  const sources = lead.locator(".coverage-source-cluster");
  await expect(lead.getByRole("heading", { name: "Tente på antibac i Trondheim" })).toBeVisible();
  await expect(lead.locator(".story-event-summary")).toContainText("Samlet hendelse");
  await expect(lead.locator(".story-event-summary")).toContainText(
    "2 kilder · samme hendelse på tvers av kilder",
  );
  await expect(lead.getByText(/Kildetillit: Bekreftet/)).toBeVisible();
  await expect(lead.locator(".story-badge-verified")).toHaveCount(0);
  await expect(lead.locator(".story-verification-proof")).toHaveCount(0);
  await expect(sources).toHaveAttribute(
    "aria-label",
    "Samlet dekning: 2 saker fra 2 kilder. 1 annen sak fra 1 kilde",
  );
  await expect(sources.getByText("Sammenfallende dekning")).toBeVisible();
  await expect(sources.getByRole("link", { name: /NRK Trøndelag/ })).toHaveCount(0);
  await expect(sources.getByRole("link", { name: /Politiloggen/ })).toBeVisible();
  await expect(sources.getByText("Ro og orden: Trondheim, Torvet")).toBeVisible();
  await expect(page.locator(".story-card .story-title", { hasText: "Ro og orden" })).toHaveCount(0);
  await page.getByRole("button", { name: "24 timer" }).click();
  await expect(page).toHaveURL(/window=24h/);
  await expect
    .poll(() => timeWindowStoryRequest?.searchParams.get("from") ?? "")
    .toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(timeWindowStoryRequest?.searchParams.get("scope")).toBe("trondheim");
  await page.getByRole("button", { name: "Nær meg" }).click();
  await expect(page.getByRole("button", { name: "Lokalt fokus aktivt" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/^Nær din posisjon · innen 10 km/i)).toBeVisible();
  await expect(page.getByLabel("Lokalt fokus").getByText("Nær din posisjon")).toBeVisible();
  await expect(
    page.getByLabel("Lokalt fokus").getByText("2 av 2 stedsfestede saker er innen 10 km."),
  ).toBeVisible();
  await page.getByLabel("Postnummer eller sted").fill("7041");
  await page.getByRole("button", { name: "Bruk" }).click();
  await expect(page.getByText(/Nær Lade · innen 5 km/i)).toBeVisible();
  const radiusControl = page.getByLabel("Velg lokal radius");
  await expect(radiusControl).toHaveAttribute("aria-valuetext", "5 km");
  await radiusControl.press("Home");
  await expect(page.getByText(/Nær Lade · innen 3 km/i)).toBeVisible();
  await expect(
    page.getByLabel("Lokalt fokus").getByText(/stedsfestede saker er innen 3 km/),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("nytt.home.neighborhoodFocus.v1")))
    .toBe("lade");
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("nytt.home.localFocusRadius.v1")))
    .toBe("3");
  await page.getByLabel("Velg nærområde").selectOption("midtbyen");
  await expect(page.getByText(/Nær Midtbyen · innen 3 km/i)).toBeVisible();
  await expect(page.getByLabel("Velg lokal radius")).toHaveAttribute("aria-valuetext", "3 km");
  await expectNoHorizontalPageOverflow(page);
});

test("owner splits and restores a grouped Siste nytt card", async ({ page }) => {
  await coverageFixtureControl(page, "reset");
  await page.goto("/");
  const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  await expect(card.getByText("2 andre saker fra 2 kilder")).toBeVisible();
  await card.getByRole("button", { name: "Feil gruppering?" }).click();
  await page.getByRole("checkbox", { name: /Urelatert støttesak/ }).check();
  await page.getByRole("button", { name: "Splitt nå" }).click();
  await expect(page.locator(".coverage-correction-toast")).toContainText("Gruppen er splittet");
  await expect(page.getByRole("link", { name: "Urelatert støttesak" })).toBeVisible();
  await page.getByRole("button", { name: "Angre" }).click();
  await expect(page.locator("p.sr-only[role=status]")).toContainText(
    "Grupperingen er gjenopprettet",
  );
  await expect(
    page
      .locator("article", { hasText: "Korrigerbar hovedsak" })
      .getByText("2 andre saker fra 2 kilder"),
  ).toBeVisible();
});

test("owner reports a missed grouping without changing the visible projection", async ({
  page,
}) => {
  await coverageFixtureControl(page, "reset");
  await page.goto("/");
  const anchor = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  const candidate = page.locator("article", { hasText: "Stor gruppesak" });
  await anchor.getByRole("button", { name: "Mangler samling?" }).click();
  await expect(page.locator(".coverage-merge-report-banner")).toContainText(
    "Velg saken som hører sammen",
  );

  const reportRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/coverage-bundle-merge-reports") && request.method() === "POST",
  );
  await candidate.getByRole("button", { name: "Denne hører sammen" }).click();
  const payload = (await reportRequest).postDataJSON() as {
    anchorArticleIds: string[];
    candidateArticleIds: string[];
  };

  expect(payload.anchorArticleIds.length).toBe(3);
  expect(payload.candidateArticleIds.length).toBe(7);
  await expect(
    page.getByText("Rapporten er lagret. Sakene er ikke slått sammen automatisk.", {
      exact: true,
    }),
  ).toBeAttached();
  await expect(page.locator(".coverage-merge-report-banner")).toHaveCount(0);
  await expect(anchor.getByText("2 andre saker fra 2 kilder")).toBeVisible();
  await expect(candidate.getByText("6 andre saker fra 5 kilder", { exact: true })).toBeVisible();
});

test("undo context is dropped after a projection generation change without false success", async ({
  page,
}) => {
  let undoRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/coverage-bundle-corrections\/[^/]+\/undo$/.test(request.url())) {
      undoRequests += 1;
    }
  });

  const splitFixtureGroup = async () => {
    const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
    await expect(card.getByText("2 andre saker fra 2 kilder")).toBeVisible();
    await card.getByRole("button", { name: "Feil gruppering?" }).click();
    await page.getByRole("checkbox", { name: /Urelatert støttesak/ }).check();
    await page.getByRole("button", { name: "Splitt nå" }).click();
    await expect(page.locator(".coverage-correction-toast")).toContainText("Gruppen er splittet");
  };

  await coverageFixtureControl(page, "reset");
  await page.goto("/");
  await splitFixtureGroup();
  const splitGeneration = await page.locator("main.home").getAttribute("data-generation-id");
  await coverageFixtureControl(page, "advance-generation");
  await page.getByRole("button", { name: "Oppdater bypuls" }).click();
  await expect(page.locator("main.home")).not.toHaveAttribute(
    "data-generation-id",
    splitGeneration ?? "",
  );
  await expect(page.locator(".coverage-correction-toast")).toHaveCount(0);
  await expect(page.locator("p.sr-only[role=status]")).not.toContainText(
    "Grupperingen er gjenopprettet",
  );
  expect(undoRequests).toBe(0);
});

test("undo context is dropped across scope and filter changes without false success", async ({
  page,
}) => {
  let undoRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/coverage-bundle-corrections\/[^/]+\/undo$/.test(request.url())) {
      undoRequests += 1;
    }
  });

  await coverageFixtureControl(page, "reset");
  await page.goto("/");
  const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  await expect(card.getByText("2 andre saker fra 2 kilder")).toBeVisible();
  await card.getByRole("button", { name: "Feil gruppering?" }).click();
  await page.getByRole("checkbox", { name: /Urelatert støttesak/ }).check();
  await page.getByRole("button", { name: "Splitt nå" }).click();
  await expect(page.locator(".coverage-correction-toast")).toContainText("Gruppen er splittet");
  await page.getByRole("button", { name: "Trøndelag" }).click();
  await page.getByRole("button", { name: /Krim/ }).click();
  await expect(page).toHaveURL(/scope=trondelag/);
  await expect(page).toHaveURL(/category=Krim/);
  await expect(page.locator(".coverage-correction-toast")).toHaveCount(0);
  await expect(page.locator("p.sr-only[role=status]")).not.toContainText(
    "Grupperingen er gjenopprettet",
  );
  expect(undoRequests).toBe(0);
});

test("split dialog closes when route, filter and generation change", async ({ page }) => {
  await coverageFixtureControl(page, "reset");
  await page.goto("/");
  const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  await card.getByRole("button", { name: "Feil gruppering?" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await changeCoverageRouteFilterAndGeneration(page);

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("p.sr-only[role=status]")).toHaveText("");
});

test("in-flight split success is discarded after coverage context changes", async ({ page }) => {
  let releaseSplit!: () => void;
  let markSplitStarted!: () => void;
  const splitRelease = new Promise<void>((resolve) => {
    releaseSplit = resolve;
  });
  const splitStarted = new Promise<void>((resolve) => {
    markSplitStarted = resolve;
  });
  await page.route("**/api/coverage-bundles/*/corrections/split", async (route) => {
    markSplitStarted();
    await splitRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        corrections: [],
        removedStoryIds: ["coverage:e2e-correctable-group"],
        replacementStories: [staleCoverageSplitStory()],
      }),
    });
  });

  await coverageFixtureControl(page, "reset");
  await page.goto("/");
  const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  await card.getByRole("button", { name: "Feil gruppering?" }).click();
  await page.getByRole("checkbox", { name: /Urelatert støttesak/ }).check();
  await page.getByRole("button", { name: "Splitt nå" }).click();
  await splitStarted;

  await changeCoverageRouteFilterAndGeneration(page);
  releaseSplit();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Gammelt splitteresultat skal forkastes")).toHaveCount(0);
  await expect(page.locator(".coverage-correction-toast")).toHaveCount(0);
  await expect(page.locator("p.sr-only[role=status]")).not.toContainText("Gruppen er splittet");
});

test("in-flight stale split performs no old-feed refresh after context changes", async ({
  page,
}) => {
  let releaseSplit!: () => void;
  let markSplitStarted!: () => void;
  let oldFeedRefreshes = 0;
  const splitRelease = new Promise<void>((resolve) => {
    releaseSplit = resolve;
  });
  const splitStarted = new Promise<void>((resolve) => {
    markSplitStarted = resolve;
  });
  page.on("request", (request) => {
    if (!request.url().includes("/api/city-pulse/stories")) return;
    const url = new URL(request.url());
    if (url.searchParams.get("scope") === "trondheim") oldFeedRefreshes += 1;
  });
  await page.route("**/api/coverage-bundles/*/corrections/split", async (route) => {
    markSplitStarted();
    await splitRelease;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ replacementStories: [staleCoverageSplitStory()] }),
    });
  });

  await coverageFixtureControl(page, "reset");
  await page.goto("/");
  const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  await card.getByRole("button", { name: "Feil gruppering?" }).click();
  await page.getByRole("checkbox", { name: /Urelatert støttesak/ }).check();
  await page.getByRole("button", { name: "Splitt nå" }).click();
  await splitStarted;

  await changeCoverageRouteFilterAndGeneration(page);
  releaseSplit();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Gammelt splitteresultat skal forkastes")).toHaveCount(0);
  await expect(page.locator("p.sr-only[role=status]")).not.toContainText(
    "Gruppen ble oppdatert før endringen kunne lagres",
  );
  await expect.poll(() => oldFeedRefreshes).toBe(0);
});

test("grouped cards remain compact and correctable by keyboard at phone width", async ({
  page,
}) => {
  await coverageFixtureControl(page, "reset");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".news-section")).toHaveCSS("min-width", "0px");
  const card = page.locator("article", { hasText: "Stor gruppesak" });
  const longSupportingTitle = card.getByText(
    "Skadeverk i boder på Lerkendal – skadeverk i boder, skadeverk i boder",
    { exact: true },
  );
  await expect(card.locator(".coverage-source-row")).toHaveCount(2);
  await expect(longSupportingTitle).toHaveCSS("white-space", "nowrap");
  await expectNoHorizontalPageOverflow(page);
  const showAll = card.getByRole("button", { name: "Vis alle 6 andre saker fra 5 kilder" });
  await expect(showAll).toBeVisible();
  await showAll.focus();
  await expect(showAll).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card.locator(".coverage-source-row")).toHaveCount(6);
  await expectNoHorizontalPageOverflow(page);
  await expect(card.locator(".coverage-source-list")).toHaveAttribute("data-expanded", "true");
  await expect(longSupportingTitle).toHaveCSS("white-space", "normal");
  const expandedTitleMetrics = await longSupportingTitle.evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      height: node.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(styles.lineHeight),
    };
  });
  expect(expandedTitleMetrics.height).toBeGreaterThan(expandedTitleMetrics.lineHeight * 1.5);
  const showLess = card.getByRole("button", { name: "Vis færre saker" });
  await showLess.focus();
  await expect(showLess).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card.locator(".coverage-source-row")).toHaveCount(2);
  await expect(longSupportingTitle).toHaveCSS("white-space", "nowrap");
  await expectNoHorizontalPageOverflow(page);
  await card.getByRole("button", { name: "Feil gruppering?" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const firstCheckbox = dialog.getByRole("checkbox").first();
  await expect(firstCheckbox).toBeFocused();
  await page.keyboard.press("Space");
  await expect(firstCheckbox).toBeChecked();
  for (let index = 0; index < 8; index += 1) await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Splitt nå" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".coverage-correction-toast")).toContainText("Gruppen er splittet");
  await expectNoHorizontalPageOverflow(page);
});

test("regional grouped coverage keeps feed and active audit membership in parity", async ({
  page,
}) => {
  await coverageFixtureControl(page, "reset");
  await page.goto("/?scope=trondelag");
  const card = page.locator("article", { hasText: "Stor gruppesak" });
  const countLabel = card.locator(".coverage-source-heading strong");
  await expect(countLabel).toHaveText("6 andre saker fra 5 kilder");
  await card.getByRole("button", { name: "Vis alle 6 andre saker fra 5 kilder" }).click();
  const primaryArticleId = await card.getAttribute("data-article-id");
  const feedArticleIds = [
    ...(primaryArticleId ? [primaryArticleId] : []),
    ...(await normalizedArticleIds(card.locator("[data-article-id]"))),
  ].sort();
  expect(feedArticleIds).toHaveLength(7);
  const feedGenerationId = await page.locator("main.home").getAttribute("data-generation-id");
  expect(feedGenerationId).toBeTruthy();

  await page.goto("/command/dekning?projection=active");
  await page.locator('[data-primary-article-id="e2e-large-1"]').click();
  const audit = page.locator("main.coverage-bundles-page");
  const auditArticleIds = await normalizedArticleIds(
    audit.locator(".coverage-bundle-member-list [data-article-id]"),
  );
  await expect(audit.locator(".coverage-bundle-badges")).toContainText("7 saker");
  expect(auditArticleIds).toEqual(feedArticleIds);
  await expect(audit).toHaveAttribute("data-generation-id", feedGenerationId!);
});

test("stale grouped correction refreshes current membership without a correction toast", async ({
  page,
}) => {
  await coverageFixtureControl(page, "reset");
  await page.goto("/?scope=trondelag");
  const card = page.locator("article", { hasText: "Korrigerbar hovedsak" });
  await expect(card.getByText("2 andre saker fra 2 kilder")).toBeVisible();
  const home = page.locator("main.home");
  await expect(home).toHaveAttribute("data-generation-id", /.+/);
  const staleGenerationId = await home.getAttribute("data-generation-id");
  await card.getByRole("button", { name: "Feil gruppering?" }).click();
  await page.getByRole("checkbox", { name: /Urelatert støttesak/ }).check();
  const advanced = await coverageFixtureControl(page, "advance-generation");
  const conflict = page.waitForResponse(
    (response) => response.url().includes("/corrections/split") && response.status() === 409,
  );
  await page.getByRole("button", { name: "Splitt nå" }).click();
  await conflict;

  await expect(page.locator("p.sr-only[role=status]")).toContainText(
    "Gruppen ble oppdatert før endringen kunne lagres",
  );
  await expect(page.locator(".coverage-correction-toast")).toHaveCount(0);
  await expect(
    page
      .locator("article", { hasText: "Korrigerbar hovedsak" })
      .getByText("1 annen sak fra 1 kilde"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Urelatert støttesak" })).toBeVisible();
  const refreshedGenerationId = await page.locator("main.home").getAttribute("data-generation-id");
  expect(refreshedGenerationId).toBe(advanced.generationId);
  expect(refreshedGenerationId).not.toBe(staleGenerationId);

  await page.goto("/command/dekning?projection=active");
  await page.locator('[data-primary-article-id="e2e-correctable-main"]').click();
  await expect(page.locator("main.coverage-bundles-page")).toHaveAttribute(
    "data-generation-id",
    refreshedGenerationId!,
  );
});

test("stale correction on a later loaded page preserves older cards, cursor, focus and scope", async ({
  page,
}) => {
  const storyArticle = (
    id: string,
    title: string,
    publishedAt: string,
    source: Article["source"],
  ) =>
    ({
      ...sampleBootstrap.articles[0]!,
      id,
      title,
      excerpt: `${title} i den deterministiske pagineringsprøven.`,
      publishedAt,
      source,
      sourceLabel: source === "nrk" ? "NRK Trøndelag" : "Adresseavisen",
      scope: "trondelag" as const,
      places: ["Trondheim"],
    }) satisfies Article;
  const story = (article: Article, id = article.id): CityPulseStory => ({
    id,
    primaryArticleId: article.id,
    articleIds: [article.id],
    primary: article,
    articles: [article],
    sourceLabels: [article.sourceLabel],
    sourceCount: 1,
    updateCount: 1,
    latestAt: article.publishedAt,
    category: article.category,
  });
  const first = story(
    storyArticle(
      "stale-page-first",
      "Første side før generasjonsbytte",
      "2026-07-13T09:00:00.000Z",
      "nrk",
    ),
  );
  const refreshedFirst = story({
    ...first.primary,
    title: "Første side etter generasjonsbytte",
    publishedAt: "2026-07-13T09:01:00.000Z",
  });
  const anchor = storyArticle(
    "stale-later-anchor",
    "Korrigerbar sak på side to",
    "2026-07-13T08:00:00.000Z",
    "nrk",
  );
  const supporting = storyArticle(
    "stale-later-support",
    "Urelatert side-to-støttesak",
    "2026-07-13T07:59:00.000Z",
    "adressa",
  );
  const effectiveBundle = {
    id: "coverage:effective-page-two",
    kind: "incident" as const,
    confidence: "high" as const,
    reason: "Testgruppe på side to",
    generatedAt: "2026-07-13T08:05:00.000Z",
    matcherVersion: "v2" as const,
    correctionTarget: {
      originalBundleId: "coverage:stable-page-two",
      projectionRevision: 7,
    },
  };
  const laterTarget: CityPulseStory = {
    id: effectiveBundle.id,
    primaryArticleId: anchor.id,
    articleIds: [anchor.id, supporting.id],
    primary: anchor,
    articles: [anchor, supporting],
    sourceLabels: [anchor.sourceLabel, supporting.sourceLabel],
    sourceCount: 2,
    updateCount: 2,
    latestAt: anchor.publishedAt,
    category: anchor.category,
    coverageBundle: effectiveBundle,
  };
  const refreshedCanonicalTarget: CityPulseStory = {
    ...laterTarget,
    articleIds: [anchor.id],
    articles: [anchor],
    sourceLabels: [anchor.sourceLabel],
    sourceCount: 1,
    updateCount: 1,
    coverageBundle: {
      ...effectiveBundle,
      correctionTarget: {
        ...effectiveBundle.correctionTarget,
        projectionRevision: 8,
      },
    },
  };
  const older = story(
    storyArticle("stale-page-older", "Eldre upåvirket sak", "2026-07-13T07:00:00.000Z", "nrk"),
  );
  const replacementAnchor = story(anchor, `article:${anchor.id}`);
  const replacementSupporting = story(supporting, `article:${supporting.id}`);
  const finalPageStory = story(
    storyArticle("stale-page-final", "Tredje side beholdt", "2026-07-13T06:00:00.000Z", "nrk"),
  );
  const projection = (generationId: string) => ({
    mode: "normalized" as const,
    generationId,
    matcherVersion: "v2" as const,
    parityClean: true,
  });
  let firstPageReads = 0;
  let splitBody: Record<string, unknown> | undefined;
  const requestedCursors: Array<string | null> = [];

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleBootstrap,
        articles: [],
        stories: [],
        situations: [],
        morningBrief: undefined,
      }),
    });
  });
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    requestedCursors.push(cursor);
    const body =
      cursor === "page-2"
        ? { items: [laterTarget, older], nextCursor: "page-3", projection: projection("gen-1") }
        : cursor === "page-3"
          ? { items: [finalPageStory], projection: projection("gen-2") }
          : firstPageReads++ === 0
            ? { items: [first], nextCursor: "page-2", projection: projection("gen-1") }
            : {
                items: [refreshedFirst, refreshedCanonicalTarget],
                nextCursor: "new-page-2",
                projection: projection("gen-2"),
              };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/coverage-bundles/*/corrections/split", async (route) => {
    splitBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        replacementStories: [replacementAnchor, replacementSupporting],
      }),
    });
  });
  await page.goto("/?scope=trondelag");
  await expect(page.locator(`[id="story-${first.id}"]`)).toContainText(first.primary.title);
  await page.getByRole("button", { name: "Vis flere saker" }).click();
  const laterCard = page.locator("article", { hasText: anchor.title });
  await laterCard.scrollIntoViewIfNeeded();
  await laterCard.getByRole("button", { name: "Feil gruppering?" }).click();
  await page.getByRole("checkbox", { name: new RegExp(supporting.title) }).check();
  const scrollBeforeSubmit = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Splitt nå" }).click();

  await expect(page.locator("p.sr-only[role=status]")).toContainText(
    "Gruppen ble oppdatert før endringen kunne lagres",
  );
  await expect(page.locator(".coverage-correction-toast")).toHaveCount(0);
  await expect(page.locator(`[id="story-${refreshedFirst.id}"]`)).toContainText(
    refreshedFirst.primary.title,
  );
  await expect(page.locator(`[id="story-${refreshedCanonicalTarget.id}"]`)).toContainText(
    anchor.title,
  );
  await expect(page.locator(`[id="story-${replacementAnchor.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[id="story-${older.id}"]`)).toContainText(older.primary.title);
  await expect(page.locator(`[id="story-${replacementSupporting.id}"]`)).toContainText(
    replacementSupporting.primary.title,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeSubmit);
  await expect(page.locator(`[id="story-${replacementSupporting.id}"]`)).toBeFocused();
  expect(page.url()).toContain("scope=trondelag");
  expect(splitBody).toMatchObject({
    originalBundleId: "coverage:stable-page-two",
    expectedProjectionRevision: 7,
    anchorArticleId: anchor.id,
    rejectedArticleIds: [supporting.id],
  });

  await page.getByRole("button", { name: "Vis flere saker" }).click();
  await expect(page.locator(`[id="story-${finalPageStory.id}"]`)).toContainText(
    finalPageStory.primary.title,
  );
  expect(requestedCursors).toEqual([null, "page-2", null, "page-3"]);
});

test("coverage audit review filters are keyboard-safe and usable at phone width", async ({
  page,
}, testInfo) => {
  await coverageFixtureControl(page, "reset");
  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.goto("/command/dekning?projection=active");

  const weakFilter = page.getByRole("checkbox", { name: "Svake kandidater" });
  await weakFilter.focus();
  await page.keyboard.press("Space");
  await expect(weakFilter).toBeChecked();
  await expect(page).toHaveURL(/review=weak/);
  await expect(page.getByRole("status")).toContainText(/Serverfilteret returnerte \d+ grupper/);
  await expectNoHorizontalPageOverflow(page);
  const accessibility = await new AxeBuilder({ page })
    .include("main.coverage-bundles-page")
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("combobox", { name: "Projeksjon" }).selectOption("superseded");
  await expect(page.getByLabel("Historisk generasjon")).toContainText(
    "Viser valgt tidligere generering",
  );
  await expect(page.getByRole("button", { name: "Splitt gruppe" })).toHaveCount(0);
  await expectNoHorizontalPageOverflow(page);
});

test("verified public story proof opens the linked situation room for viewers", async ({
  page,
}) => {
  await useViewerSession(page);
  const article: Article = {
    id: "adressa-lade-violence",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Ung mann kritisk skadd på Lade",
    excerpt:
      "En ung mann er kritisk skadet etter en voldshendelse på Lade i Trondheim. Politiet leter etter flere navngitte personer.",
    url: "https://example.test/lade-vold",
    publishedAt: "2026-07-02T18:59:00.000Z",
    scope: "trondheim",
    category: "Krim",
    places: ["Lade", "Trondheim"],
    location: { lat: 63.4402, lng: 10.437, label: "Lade" },
    situationId: "politiloggen-lade-vold",
    publicVerification: {
      status: "verified",
      label: "Verifisert",
      detail: "Bekreftet av Politiloggen og Adresseavisen.",
      officialSources: ["politiloggen"],
      reportingSources: ["adressa"],
      situationId: "politiloggen-lade-vold",
    },
  };
  const situation = {
    id: "politiloggen-lade-vold",
    title: "Voldshendelse på Lade",
    summary: "Politiloggen og Adresseavisen omtaler samme voldshendelse på Lade.",
    status: "active",
    verificationStatus: "Offentlig bekreftet",
    updatedAt: "2026-07-02T19:05:00.000Z",
    createdAt: "2026-07-02T18:34:00.000Z",
    locationLabel: "Lade",
    primaryLocation: { lat: 63.4402, lng: 10.437, label: "Lade" },
  } as const;

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        articles: [article],
        stories: buildCityPulseStories([article]),
        situations: [situation],
        sourceHealth: sampleBootstrap.sourceHealth,
        morningBrief: undefined,
      }),
    });
  });
  await page.route("**/api/articles?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [article] }),
    });
  });
  await page.route("**/api/situations/politiloggen-lade-vold", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...sampleWorkspace,
        situation: {
          ...sampleWorkspace.situation,
          id: situation.id,
          title: situation.title,
          summary: situation.summary,
          status: situation.status,
          verificationStatus: situation.verificationStatus,
          updatedAt: situation.updatedAt,
          createdAt: situation.createdAt,
          locationLabel: situation.locationLabel,
          officialSource: "politiloggen",
          officialEventId: "lade-vold",
          relatedArticleIds: [article.id],
          timeline: [
            {
              id: "timeline-lade-official",
              timestamp: situation.createdAt,
              title: "Politiet bekrefter hendelsen",
              detail: "Politiloggen omtaler voldshendelsen på Lade.",
              sourceLabel: "Politiloggen",
            },
          ],
          features: [
            {
              id: "feature-lade",
              type: "Feature",
              geometry: { type: "Point", coordinates: [10.437, 63.4402] },
              properties: {
                label: "Lade",
                provenance: "official",
                source: "politiloggen",
                sourceLabel: "Politiloggen",
                updatedAt: situation.updatedAt,
              },
            },
          ],
          evidence: [
            {
              id: "politiloggen-lade-evidence",
              situationId: situation.id,
              source: "politiloggen",
              sourceLabel: "Politiloggen",
              sourceUrl: "https://example.test/politiloggen/lade-vold",
              supportingSnippet: "Voldshendelse: Trondheim, Lade",
              claim: "Politiet undersøker voldshendelse på Lade",
              claimType: "official_police_log",
              provenance: "official",
              confidence: 1,
              extractedAt: situation.updatedAt,
              publishedAt: situation.createdAt,
            },
          ],
        },
        explanation: {
          createdBecause: ["Offisiell politilogg og redaksjonell dekning peker på samme hendelse."],
          sourceRoles: [
            { provider: "politiloggen", role: "evidence" },
            { provider: "adressa", role: "evidence" },
          ],
          locationConfidence: "official",
        },
        relatedArticles: [article],
        tasks: [],
        notes: [],
        attachments: [],
      }),
    });
  });
  let sourceItemsRequested = false;
  await page.route("**/api/situations/politiloggen-lade-vold/source-items", async (route) => {
    sourceItemsRequested = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/");

  const lead = page.locator(".lead-story");
  await expect(lead.getByRole("heading", { name: "Ung mann kritisk skadd på Lade" })).toBeVisible();
  const proof = lead.locator(".story-verification-proof");
  await expect(proof).toContainText("Politiloggen + Adresseavisen");
  await expect(proof.getByRole("link", { name: "Åpne situasjonsrom" })).toHaveAttribute(
    "href",
    "/situasjoner/politiloggen-lade-vold",
  );

  await proof.getByRole("link", { name: "Åpne situasjonsrom" }).click();

  await expect(page).toHaveURL(/\/situasjoner\/politiloggen-lade-vold$/);
  await expect(page.getByRole("heading", { name: "Voldshendelse på Lade" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hvorfor vises dette?" })).toBeVisible();
  const explanation = page.locator(".situation-explanation");
  await expect(explanation.getByText("Politiloggen", { exact: true })).toBeVisible();
  await expect(explanation.getByText("Adresseavisen", { exact: true })).toBeVisible();
  await expect(
    page.locator(".related").getByRole("link", { name: /Ung mann kritisk skadd på Lade/ }),
  ).toHaveAttribute("href", "https://example.test/lade-vold");
  await expect(page.getByText("Private analyser")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Kildegrunnlag" })).toHaveCount(0);
  expect(sourceItemsRequested).toBe(false);
});

test("coverage bundle operations page renders persisted decisions and drawer detail", async ({
  page,
}) => {
  const generation = {
    id: "coverage-generation-shadow-1",
    matcherVersion: "v2",
    mode: "shadow",
    status: "completed",
    startedAt: "2026-06-18T10:54:00.000Z",
    completedAt: "2026-06-18T10:55:00.000Z",
    articleCount: 3,
    bundleCount: 1,
    edgeCount: 2,
    correctionConflictCount: 0,
  } as const;
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
          activeBundleCount: 1,
          byMatchTier: { strong: 1, moderate: 0 },
          reviewCandidateCount: 1,
          activeCorrectionCount: 0,
          integrityErrorCount: 0,
          matcherVersion: "v2",
          projectionState: "shadow",
          generation,
        },
        selectedProjection: "shadow",
        correctionsEnabled: false,
        parity: {
          legacyBundleCount: 1,
          normalizedBundleCount: 1,
          membershipMismatchCount: 0,
          primaryMismatchCount: 0,
          clean: true,
        },
        items: [
          {
            id: "coverage:flatåsen-smoke",
            kind: "incident",
            confidence: "high",
            reason: "Samme hendelse på tvers av kilder",
            generatedAt: "2026-06-18T10:55:00.000Z",
            matcherVersion: "v2",
            matchConfidence: {
              tier: "strong",
              score: 0.91,
              rationale: "To uavhengige kilder beskriver samme hendelse på Flatåsen.",
            },
            generation,
            state: "shadow",
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
            edges: [
              {
                articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
                tier: "strong",
                score: 0.91,
                kind: "incident",
                positiveIncidentEvidence: ["shared_specific_place"],
                signals: [
                  {
                    kind: "generic_place_incident",
                    articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
                    detail: "brann",
                    overlap: 4,
                    score: 0.42,
                  },
                ],
                conflicts: [],
                evidenceFingerprint: "accepted-flatåsen-smoke",
                reviewable: false,
                correctionConflict: false,
              },
              {
                articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
                tier: "weak",
                score: 0.24,
                kind: "incident",
                positiveIncidentEvidence: [],
                signals: [],
                conflicts: [
                  {
                    kind: "specific_place",
                    articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
                    detail: "Flatåsen og Heimdal er ulike spesifikke steder.",
                  },
                ],
                evidenceFingerprint: "review-flatåsen-heimdal",
                reviewable: true,
                correctionConflict: false,
              },
            ],
            reviewCandidates: [
              {
                articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
                tier: "weak",
                score: 0.24,
                kind: "incident",
                positiveIncidentEvidence: [],
                signals: [],
                conflicts: [
                  {
                    kind: "specific_place",
                    articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
                    detail: "Flatåsen og Heimdal er ulike spesifikke steder.",
                  },
                ],
                evidenceFingerprint: "review-flatåsen-heimdal",
                reviewable: true,
                correctionConflict: false,
              },
            ],
            corrections: [],
            integrityErrors: [],
          },
        ],
      }),
    });
  });

  await page.goto("/command/dekning");

  await expect(page.getByRole("heading", { name: "Dekningsgrupper" })).toBeVisible();
  await expect(page.getByText("Samme hendelse på tvers av kilder").first()).toBeVisible();
  await expect(
    page.getByText("Generisk steds-hendelse · 4 treff · 42 % · brann", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Konflikt i spesifikt sted")).toBeVisible();
  await expect(page.getByText("Adresseavisen: Røykmelding ved Heimdal")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Brief-arbeidsflate" })).toBeVisible();
  const briefModules = page.getByLabel("Brief-revisjon-moduler");
  await expect(briefModules).toBeVisible();
  await expect(briefModules.getByRole("button", { name: "Tilpass oppsett" })).toBeVisible();
  await expect(briefModules.getByLabel("Dashboard-oppsett")).toHaveCount(0);
  await expect(briefModules.getByRole("button", { name: "Tilbakestill" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Morgenbrief" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Siste analyse" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historier bak briefen" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Rådata" })).toHaveAttribute(
    "href",
    "/command/radata",
  );
  await expectNoHorizontalPageOverflow(page);
});

test("legacy drift routes redirect to canonical command center paths", async ({ page }) => {
  await page.route("**/api/operations/coverage-bundles**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          recentBundleCount: 0,
          byKind: { incident: 0, topic: 0, update: 0 },
          byConfidence: { high: 0, medium: 0 },
          activeBundleCount: 0,
          byMatchTier: { strong: 0, moderate: 0 },
          reviewCandidateCount: 0,
          activeCorrectionCount: 0,
          integrityErrorCount: 0,
          matcherVersion: "v2",
          projectionState: "shadow",
        },
        selectedProjection: "shadow",
        correctionsEnabled: false,
        parity: {
          legacyBundleCount: 0,
          normalizedBundleCount: 0,
          membershipMismatchCount: 0,
          primaryMismatchCount: 0,
          clean: true,
        },
        items: [],
      }),
    });
  });

  await page.goto("/drift/dekning?kind=incident&q=Flat%C3%A5sen");

  await expect(page).toHaveURL(/\/command\/dekning\?kind=incident&q=Flat%C3%A5sen$/);
  await expect(page.getByRole("heading", { name: "Dekningsgrupper" })).toBeVisible();
});

test("command spatial analytics links heatmap evidence to raw source payloads", async ({
  page,
}) => {
  await page.route("**/api/operations/spatial-analytics**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-07-02T09:45:00.000Z",
        live: {
          status: "live",
          refreshIntervalSeconds: 60,
          nextRefreshAt: "2026-07-02T09:46:00.000Z",
          staleAfterSeconds: 900,
          dataUpdatedAt: "2026-07-02T09:45:00.000Z",
          dataAgeSeconds: 0,
          detail: "Siste romlige signal 1 min siden.",
        },
        window: {},
        summary: {
          heatmapCells: 1,
          observations: 4,
          unexplainedDelays: 1,
          criticalDelays: 0,
          bySourceConfidence: {
            confirmed: 0,
            likely: 1,
            uncertain: 1,
            speculative: 0,
          },
        },
        telemetryHistory: {
          datexTravelTime: {
            observations: 24,
            trackedEntities: 4,
            firstObservedAt: "2026-07-01T09:00:00.000Z",
            lastObservedAt: "2026-07-02T09:45:00.000Z",
            activeDayCount: 2,
            notableObservations: 6,
          },
          trafficCounters: {
            observations: 18,
            trackedEntities: 3,
            firstObservedAt: "2026-07-01T10:00:00.000Z",
            lastObservedAt: "2026-07-02T09:40:00.000Z",
            activeDayCount: 2,
            notableObservations: 3,
          },
        },
        telemetryPatterns: [],
        investigationQueue: [
          {
            id: "investigation:cell:sluppen",
            kind: "hotspot",
            priority: "high",
            title: "Varmepunkt Sluppen",
            summary: "4 observasjoner over 2 aktive dager, topp 3 observasjoner 2. juli.",
            reason: "Tetthet og tverrkilde-signal bør kontrolleres i kart og rådata.",
            updatedAt: "2026-07-02T09:40:00.000Z",
            evidence: [
              "4 observasjoner",
              "2 aktive dager",
              "Toppdag 2. juli: 3 observasjoner",
              "1 trafikkhendelse",
            ],
            articleIds: [],
            sourceItemIds: ["source:one"],
            sourceConfidence: {
              level: "likely",
              label: "Sannsynlig",
              score: 0.72,
              rationale: "Offisielt trafikkgrunnlag støttes av redaksjonell dekning.",
            },
          },
          {
            id: "investigation:delay:e6-sluppen",
            kind: "unexplained_delay",
            priority: "high",
            title: "E6 Okstadbakken - Sluppen",
            summary: "6 min forsinkelse uten kjent årsak",
            reason: "DATEX viser ca. 6 min forsinkelse uten koblet trafikkhendelse.",
            updatedAt: "2026-07-02T09:40:00.000Z",
            evidence: ["DATEX reisetid: 6 min", "Ingen romlig koblet trafikkhendelse"],
            articleIds: ["article:one"],
            sourceItemIds: [],
            rawRefs: [
              {
                type: "telemetry",
                source: "datex_travel_time",
                id: "e6-sluppen",
                label: "DATEX reisetid",
                observedAt: "2026-07-02T09:40:00.000Z",
              },
            ],
            sourceConfidence: {
              level: "likely",
              label: "Sannsynlig",
              score: 0.72,
              rationale: "DATEX-reisetid støttes av en mulig nyhetssak.",
            },
          },
        ],
        heatmapCells: [
          {
            id: "cell:sluppen",
            center: { lat: 63.3979, lng: 10.3997 },
            radiusMeters: 650,
            count: 4,
            sourceItemCount: 1,
            sourceItemIds: ["source:one"],
            articleCount: 1,
            trafficEventCount: 1,
            firstSeenAt: "2026-07-01T09:40:00.000Z",
            lastSeenAt: "2026-07-02T09:40:00.000Z",
            activeDayCount: 2,
            timeBuckets: [
              {
                bucketStart: "2026-07-01T00:00:00.000Z",
                count: 1,
                sourceItemCount: 1,
                articleCount: 0,
                trafficEventCount: 0,
              },
              {
                bucketStart: "2026-07-02T00:00:00.000Z",
                count: 3,
                sourceItemCount: 1,
                articleCount: 1,
                trafficEventCount: 1,
              },
            ],
            sourceIds: ["nrk", "vegvesen_traffic_info"],
            maxSeverity: "high",
            sourceConfidence: {
              level: "likely",
              label: "Sannsynlig",
              score: 0.72,
              rationale: "Offisielt trafikkgrunnlag støttes av redaksjonell dekning.",
            },
          },
        ],
        unexplainedDelays: [
          {
            id: "delay:e6-sluppen",
            corridorId: "e6-sluppen",
            corridorName: "E6 Okstadbakken - Sluppen",
            geometry: {
              type: "LineString",
              coordinates: [
                [10.38, 63.37],
                [10.4, 63.397],
              ],
            },
            state: "slow",
            delaySeconds: 360,
            delayRatio: 1.7,
            updatedAt: "2026-07-02T09:40:00.000Z",
            sourceUrl: "https://example.test/datex",
            explanationStatus: "unlinked_news_match",
            matchedArticleIds: ["article:one"],
            affectedEventIds: [],
            confidence: "warning",
            reason: "DATEX viser ca. 6 min forsinkelse uten koblet trafikkhendelse.",
            rawRefs: [
              {
                type: "telemetry",
                source: "datex_travel_time",
                id: "e6-sluppen",
                label: "DATEX reisetid",
                observedAt: "2026-07-02T09:40:00.000Z",
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/api/source-items?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "source:one",
            provider: "datex",
            kind: "official_event",
            title: "DATEX Sluppen payload",
            summary: "Sanitert kildeelement for E6 ved Sluppen.",
            fetchedAt: "2026-07-02T09:40:00.000Z",
            captureHash: "hash-one",
            reliabilityTier: "official",
            linkedSituationIds: [],
          },
        ],
      }),
    });
  });
  await page.route("**/api/operations/raw/source-items/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: {
          id: "source:one",
          provider: "datex",
          kind: "official_event",
          title: "DATEX Sluppen payload",
          fetchedAt: "2026-07-02T09:40:00.000Z",
          captureHash: "hash-one",
          reliabilityTier: "official",
          linkedSituationIds: [],
        },
        rawPayload: {
          situation: {
            id: "datex-sluppen",
            road: "E6",
            delaySeconds: 360,
          },
        },
        normalizedPayload: {
          title: "DATEX Sluppen payload",
          road: "E6",
          location: "Sluppen",
        },
        payloadBytes: { raw: 2048, normalized: 512 },
        redacted: true,
        truncated: false,
      }),
    });
  });
  await page.route("**/api/operations/raw/telemetry?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "e6-sluppen",
            source: "datex_travel_time",
            title: "E6 Okstadbakken - Sluppen",
            updatedAt: "2026-07-02T09:40:20.000Z",
            observedAt: "2026-07-02T09:40:00.000Z",
            summary: "Sakte trafikk · 6 min forsinkelse",
          },
        ],
      }),
    });
  });
  await page.route("**/api/operations/raw/telemetry/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: "e6-sluppen",
          source: "datex_travel_time",
          title: "E6 Okstadbakken - Sluppen",
          updatedAt: "2026-07-02T09:40:20.000Z",
          observedAt: "2026-07-02T09:40:00.000Z",
          sourceUrl: "https://example.test/datex",
          summary: "Sakte trafikk · 6 min forsinkelse",
        },
        payload: {
          corridorId: "e6-sluppen",
          delaySeconds: 360,
          secret: "[redacted]",
        },
        payloadBytes: 1536,
        redacted: true,
        truncated: false,
      }),
    });
  });
  await page.route("**/api/operations/raw/ai-runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.goto("/command/romlig");

  await expect(page.getByRole("heading", { name: "Romlig analyse" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Romlig arbeidsflate" })).toBeVisible();
  const spatialModules = page.getByLabel("Romlig analysemoduler");
  await expect(spatialModules.getByRole("button", { name: "Tilpass oppsett" })).toBeVisible();
  await expect(spatialModules.getByRole("button", { name: "Tilbakestill" })).toHaveCount(0);
  await expect(spatialModules.getByLabel("Dashboard-oppsett")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Analysefilter" })).toBeVisible();
  const blackSpotStrip = page.locator(".spatial-blackspot-strip");
  await expect(
    blackSpotStrip.getByRole("heading", { name: "Svartpunkt-kandidater" }),
  ).toBeVisible();
  await expect(blackSpotStrip.getByText("1 prioritert")).toBeVisible();
  await expect(blackSpotStrip.getByRole("heading", { name: "63.398, 10.400" })).toBeVisible();
  await expect(
    blackSpotStrip.getByText("Nyhetsdekning og rådata peker mot samme område."),
  ).toBeVisible();
  await expect(blackSpotStrip.getByText("2 kilder")).toBeVisible();
  await expect(blackSpotStrip.getByText("nyhet + trafikkhendelse")).toBeVisible();
  await expect(blackSpotStrip.getByText("1 råspor")).toBeVisible();
  await expect(blackSpotStrip.getByRole("link", { name: "Rådata 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signaler å undersøke" }).first()).toBeVisible();
  const correlationBrief = page.locator(".spatial-correlation-brief");
  await expect(
    correlationBrief.getByRole("heading", { name: "Hva krever oppfølging nå?" }),
  ).toBeVisible();
  await expect(correlationBrief.getByText("2 høyprioriterte")).toBeVisible();
  await expect(correlationBrief.getByText("1 usikre signaler")).toBeVisible();
  await expect(correlationBrief.getByText("nyhet + rådata/offisiell kontekst")).toBeVisible();
  await expect(correlationBrief.getByRole("link", { name: "DATEX reisetid" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Varmepunkt Sluppen" })).toBeVisible();
  await expect(
    page
      .getByLabel("Signaler å undersøke", { exact: true })
      .getByText("Toppdag 2. juli: 3 observasjoner"),
  ).toBeVisible();
  await expect(page.getByLabel("Tidsprofil for varmepunkt").first()).toBeVisible();
  await expect(page.getByText("3 obs").first()).toBeVisible();
  await page.getByRole("link", { name: "Rådata 1" }).first().click();

  await expect(page).toHaveURL(/\/command\/radata\?sourceItem=source%3Aone/);
  await expect(page.getByRole("heading", { name: "Rådata-inspektør" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rådata-arbeidsflate" })).toBeVisible();
  await expect(page.getByLabel("Rådata-inspektør-moduler")).toBeVisible();
  await expect(page.getByRole("heading", { name: "DATEX Sluppen payload" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Normalisert payload" })).toBeVisible();
  await expect(page.getByText('"location": "Sluppen"')).toBeVisible();
  await expect(page.getByText('"delaySeconds": 360')).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  await page.goto("/command/romlig");
  await page.getByRole("link", { name: "DATEX reisetid" }).first().click();

  await expect(page).toHaveURL(
    /\/command\/radata\?telemetrySource=datex_travel_time&telemetryId=e6-sluppen/,
  );
  const rawDetail = page.getByLabel("Rådatadetalj");
  await expect(rawDetail.getByRole("heading", { name: "E6 Okstadbakken - Sluppen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Telemetripayload" })).toBeVisible();
  await expect(page.getByText('"corridorId": "e6-sluppen"')).toBeVisible();
  await expect(page.getByText('"secret": "[redacted]"')).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
});

test("raw inspector explains degraded AI recovery attempts", async ({ page }) => {
  await page.route("**/api/operations/raw/source-items?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/api/operations/raw/telemetry?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/api/operations/raw/ai-runs?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "ai:one",
            provider: "deepseek",
            model: "deepseek-v4-flash",
            status: "degraded",
            startedAt: "2026-07-02T09:01:00.000Z",
            completedAt: "2026-07-02T09:02:00.000Z",
            articleCount: 12,
            diagnostics: {
              profile: "compact_recovery",
              attempts: [
                {
                  profile: "standard",
                  status: "failed",
                  maxTokens: 4096,
                  articleCount: 12,
                  situationCount: 4,
                  error: "JSON response was truncated",
                },
                {
                  profile: "compact_recovery",
                  status: "ok",
                  maxTokens: 2048,
                  articleCount: 8,
                  situationCount: 4,
                },
              ],
            },
            error: "JSON response was truncated",
          },
        ],
      }),
    });
  });
  await page.route("**/api/operations/raw/ai-runs/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "ai:one",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "degraded",
        startedAt: "2026-07-02T09:01:00.000Z",
        completedAt: "2026-07-02T09:02:00.000Z",
        articleCount: 12,
        articleIds: ["article:one", "article:two"],
        diagnostics: {
          profile: "compact_recovery",
          attempts: [
            {
              profile: "standard",
              status: "failed",
              maxTokens: 4096,
              articleCount: 12,
              situationCount: 4,
              error: "JSON response was truncated",
            },
            {
              profile: "compact_recovery",
              status: "ok",
              maxTokens: 2048,
              articleCount: 8,
              situationCount: 4,
            },
          ],
        },
        result: {
          morningBrief: {
            paragraphs: ["Kort bypuls.", "Trafikk følges.", "Ingen store væravvik."],
          },
          clusters: [
            {
              title: "Kø ved Sluppen",
              citedClaims: [{ claim: "Sakte trafikk", articleId: "article:one" }],
            },
          ],
          situationUpdates: [],
          bundleHints: [
            {
              title: "Sluppen-trafikk",
              citedClaims: [{ claim: "Samme korridor", articleId: "article:two" }],
            },
          ],
          categoryHints: [{ articleId: "article:one", category: "Transport" }],
          relevanceHints: [{ articleId: "article:two", scope: "trondheim" }],
          operationsNotes: [
            {
              kind: "bundle_candidate",
              summary: "Mulig kobling til trafikkpuls.",
              citedClaims: [{ claim: "Mulig trafikkårsak", articleId: "article:one" }],
            },
          ],
          diagnostics: { profile: "compact_recovery" },
        },
        resultBytes: 32,
        redacted: false,
        truncated: false,
        error: "JSON response was truncated",
      }),
    });
  });

  await page.goto("/command/radata?run=ai%3Aone");

  await expect(page.getByRole("heading", { name: "Rådata-inspektør" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI-spor og reserveflyt" })).toBeVisible();
  await expect(page.getByText("Reserveanalyse brukt")).toBeVisible();
  await expect(page.getByText("Full analyse feilet", { exact: true })).toBeVisible();
  await expect(page.getByText("12 saker / 4 situasjoner")).toBeVisible();
  await expect(page.getByText("4096 maks tokens")).toBeVisible();
  await expect(page.getByText("Kompakt gjenoppretting OK")).toBeVisible();
  await expect(page.getByText("2048 maks tokens")).toBeVisible();
  await expect(page.getByText("Sanitert resultat: 32 B")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analysebeslutninger" })).toBeVisible();
  await expect(page.getByText("3 avsnitt")).toBeVisible();
  await expect(page.getByText("1 klynge")).toBeVisible();
  await expect(page.getByText("3 spor")).toBeVisible();
  await expect(page.getByText("JSON response was truncated").first()).toBeVisible();
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
    if (new URL(route.request().url()).pathname.endsWith("/departures")) {
      await route.fallback();
      return;
    }
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

  await openTrafficDisclosure(page, "Trafikkbildet nå");
  await expect(page.getByRole("heading", { name: "Trafikkbildet nå" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Trafikkbildet nå" });
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

test("traffic map shows useful default public transport departures", async ({ page }) => {
  await page.goto("/trafikk");

  const board = page.getByRole("region", { name: "Avganger nå" });
  await expect(board.getByRole("heading", { name: "Avganger nå" })).toBeVisible();
  await expect(board).toContainText("Trondheim sentrum");
  await expect(board).toContainText("Buss 71");
  await expect(board).toContainText("Dora");
  await expect(board).toContainText("Prinsens gate");
  await expect(board).toContainText("3 min forsinket");
  await expect(board).toContainText("Endret rute");
  await expect(board.getByRole("link", { name: "AtB/Entur" })).toHaveAttribute(
    "href",
    "https://www.atb.no/reiseplanlegger/",
  );
});

test("traffic map offers common destination presets for faster planning", async ({ page }) => {
  await page.goto("/trafikk");

  const presetList = page.getByRole("group", { name: "Vanlige reisemål" });
  const stOlavsPreset = presetList.getByRole("button", { name: "St. Olavs" });
  await expect(stOlavsPreset).toBeVisible();
  await stOlavsPreset.click();

  await expect(page.getByLabel("Hvor skal du?")).toHaveValue("St. Olavs hospital");
  await expect(presetList.getByRole("button", { name: "St. Olavs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("traffic map can reverse a planned route without retyping", async ({ page }) => {
  await page.goto("/trafikk");

  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page
    .getByRole("group", { name: "Vanlige reisemål" })
    .getByRole("button", { name: "Lade" })
    .click();
  await page.getByRole("button", { name: "Bytt retning" }).click();

  await expect(page.getByLabel("Hvor er du?")).toHaveValue("Lade Arena");
  await expect(page.getByLabel("Hvor skal du?")).toHaveValue("Munkegata");
});

test("traffic map can use Entur route input suggestions without re-geocoding labels", async ({
  page,
}) => {
  const travelPlanRequestUrls: URL[] = [];
  const departureRequestUrls: URL[] = [];
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    const url = new URL(route.request().url());
    departureRequestUrls.push(url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const hasCenter = Boolean(lat && lon);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        detail: hasCenter
          ? "Entur viser konkrete avganger nær valgt startpunkt."
          : "Entur viser konkrete avganger nær Trondheim sentrum.",
        areaLabel: hasCenter ? "Munkegata, Trondheim" : "Trondheim sentrum",
        center: hasCenter ? { lat: Number(lat), lon: Number(lon) } : { lat: 63.4305, lon: 10.3951 },
        stops: [],
        departures: hasCenter
          ? [
              {
                id: "departure:3",
                stopId: "NSR:StopPlace:41613",
                stopName: "Munkegata",
                stopDistanceMeters: 42,
                mode: "bus",
                lineId: "ATB:Line:3",
                publicCode: "3",
                lineName: "Lade - Hallset",
                serviceJourneyId: "ATB:ServiceJourney:3",
                destinationName: "Leangen",
                aimedDepartureTime: "2026-07-05T16:24:00.000Z",
                expectedDepartureTime: "2026-07-05T16:24:00.000Z",
                delaySeconds: 0,
                realtime: true,
                cancelled: false,
                notices: [],
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
              },
              {
                id: "departure:71",
                stopId: "NSR:StopPlace:41613",
                stopName: "Munkegata",
                stopDistanceMeters: 42,
                mode: "bus",
                lineId: "ATB:Line:71",
                publicCode: "71",
                lineName: "MelhusSkyss-Trondheim",
                serviceJourneyId: "ATB:ServiceJourney:71",
                destinationName: "Dora",
                aimedDepartureTime: "2026-07-05T16:26:00.000Z",
                expectedDepartureTime: "2026-07-05T16:26:00.000Z",
                delaySeconds: 0,
                realtime: true,
                cancelled: false,
                notices: [],
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
              },
            ]
          : [],
        sources: [],
        generatedAt: "2026-07-05T16:20:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });
  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    travelPlanRequestUrls.push(url);
    const activePreset = url.searchParams.get("preset") ?? "now";
    expect(url.searchParams.get("from")).toBe("63.43288, 10.39374");
    expect(url.searchParams.get("to")).toBe("63.43300, 10.46400");
    expect(url.searchParams.get("fromLabel")).toBe("Munkegata, Trondheim");
    expect(url.searchParams.get("toLabel")).toBe("Leangen, Trondheim");
    expect(["now", "in30"]).toContain(activePreset);
    const selectedPlan = withModeAwareTravelPlanMock({
      origin: {
        query: "Munkegata, Trondheim",
        label: "Munkegata, Trondheim",
        coordinate: [10.393742, 63.432883],
      },
      destination: {
        query: "Leangen, Trondheim",
        label: "Leangen, Trondheim",
        coordinate: [10.464, 63.433],
      },
      route: {
        source: "direct",
        distanceMeters: 4850,
        geometry: {
          type: "LineString",
          coordinates: [
            [10.393742, 63.432883],
            [10.464, 63.433],
          ],
        },
        detail: "Direkte korridor.",
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
      itineraries: [],
      journeyPlanner: {
        status: "empty",
        detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
        requestedDepartureTime: "2026-07-05T16:20:00.000Z",
        source: "Entur Journey Planner",
      },
      sources: [],
      generatedAt: "2026-07-05T16:20:00.000Z",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activePreset,
        selectedPlan,
        sources: ["now", "in30", "in60", "in120"].map((preset) => ({
          preset,
          plan: selectedPlan,
        })),
        generatedAt: "2026-07-05T16:20:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await expect(page.getByRole("option", { name: /Munkegata, Trondheim/ })).toBeVisible();
  await page.getByRole("option", { name: /Munkegata, Trondheim/ }).click();
  await expect(page.getByLabel("Hvor er du?")).toHaveValue("Munkegata, Trondheim");
  await expect(page.getByText("Bruker holdeplass fra Entur")).toBeVisible();
  await expect
    .poll(() => departureRequestUrls.map((url) => url.searchParams.get("lat")))
    .toContain("63.432883");
  await expect
    .poll(() => departureRequestUrls.map((url) => url.searchParams.get("lon")))
    .toContain("10.393742");
  await expect(page.getByRole("region", { name: "Avganger nå" })).toContainText(
    "Munkegata, Trondheim",
  );
  const departureBoard = page.getByRole("region", { name: "Avganger nå" });
  await departureBoard.getByRole("button", { name: "Lagre tavle" }).click();
  await expect(departureBoard.getByRole("button", { name: "Tavle lagret" })).toBeDisabled();
  await departureBoard.getByRole("button", { name: "Sentrum" }).click();
  await expect
    .poll(() => departureRequestUrls.some((url) => !url.searchParams.has("lat")))
    .toBe(true);
  const rememberedBoardLoadsBeforeSelect = departureRequestUrls.length;
  await departureBoard.getByRole("button", { name: "Munkegata, Trondheim", exact: true }).click();
  await expect
    .poll(() =>
      departureRequestUrls.slice(rememberedBoardLoadsBeforeSelect).map((url) => ({
        lat: url.searchParams.get("lat"),
        lon: url.searchParams.get("lon"),
      })),
    )
    .toContainEqual({ lat: "63.432883", lon: "10.393742" });
  await departureBoard.getByRole("button", { name: "Buss 3 mot Leangen 1" }).click();
  await expect(departureBoard.locator(".departure-board-grid")).toContainText("Leangen");
  await expect(departureBoard.locator(".departure-board-grid")).not.toContainText("Dora");
  await departureBoard.getByRole("button", { name: "Lagre linje" }).click();
  await expect(departureBoard.getByRole("button", { name: "Linje lagret" })).toBeDisabled();
  await expect(
    departureBoard.getByRole("button", {
      name: "Munkegata, Trondheim · Buss 3 mot Leangen",
      exact: true,
    }),
  ).toBeVisible();
  await departureBoard.getByRole("button", { name: "Sentrum" }).click();
  const focusedBoardLoadsBeforeSelect = departureRequestUrls.length;
  await departureBoard
    .getByRole("button", {
      name: "Munkegata, Trondheim · Buss 3 mot Leangen",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      departureRequestUrls.slice(focusedBoardLoadsBeforeSelect).map((url) => ({
        lat: url.searchParams.get("lat"),
        lon: url.searchParams.get("lon"),
      })),
    )
    .toContainEqual({ lat: "63.432883", lon: "10.393742" });
  await expect(
    departureBoard.getByRole("button", { name: "Buss 3 mot Leangen 1" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(departureBoard.locator(".departure-board-grid")).toContainText("Leangen");
  await expect(departureBoard.locator(".departure-board-grid")).not.toContainText("Dora");
  await departureBoard
    .getByRole("button", {
      name: "Fjern Munkegata, Trondheim · Buss 3 mot Leangen fra lagrede avgangstavler",
    })
    .click();
  await departureBoard
    .getByRole("button", { name: "Fjern Munkegata, Trondheim fra lagrede avgangstavler" })
    .click();
  await expect(
    departureBoard.getByRole("button", { name: "Munkegata, Trondheim", exact: true }),
  ).toHaveCount(0);

  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await expect(page.getByRole("option", { name: /Leangen, Trondheim/ })).toBeVisible();
  await page.getByRole("option", { name: /Leangen, Trondheim/ }).click();
  await expect(page.getByLabel("Hvor skal du?")).toHaveValue("Leangen, Trondheim");
  expect(travelPlanRequestUrls).toHaveLength(0);

  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Gå til Leangen");
  await expect(page.locator("#travel-plan-result")).toContainText(
    "Ingen kollektivreise akkurat nå.",
  );
  await expect(page.locator("#travel-plan-result")).not.toContainText("Ruteoppsummering");
  await expect.poll(() => travelPlanRequestUrls.length).toBe(1);
  expect(travelPlanRequestUrls[0]?.pathname).toBe("/api/map/travel-plan/compare");

  const savedRoutesDisclosure = page.locator("details.remembered-routes-disclosure");
  await expect(savedRoutesDisclosure).toContainText("Lagrede ruter (1)");
  await savedRoutesDisclosure.locator("summary").click();
  await expect(savedRoutesDisclosure.getByRole("region", { name: "Ruter" })).toContainText(
    "Lagres bare i denne nettleseren",
  );
  const rememberedRoute = savedRoutesDisclosure.getByRole("button", {
    name: /Munkegata, Trondheim → Leangen, Trondheim/,
  });
  await expect(rememberedRoute).toContainText("brukt 1 gang");
  await page
    .getByRole("button", { name: "Fest Munkegata, Trondheim til Leangen, Trondheim" })
    .click();
  await expect(page.getByText("Festet")).toBeVisible();
  await rememberedRoute.click();
  await expect.poll(() => travelPlanRequestUrls.length).toBe(2);
  expect(travelPlanRequestUrls[1]?.searchParams.get("from")).toBe("63.43288, 10.39374");
  expect(travelPlanRequestUrls[1]?.searchParams.get("to")).toBe("63.43300, 10.46400");
  await expect(rememberedRoute).toContainText("brukt 2 ganger");
  await page.getByLabel("Når?").selectOption("in30");
  await expect.poll(() => travelPlanRequestUrls.length).toBe(3);
  expect(travelPlanRequestUrls[2]?.searchParams.get("from")).toBe("63.43288, 10.39374");
  expect(travelPlanRequestUrls[2]?.searchParams.get("to")).toBe("63.43300, 10.46400");
  expect(travelPlanRequestUrls[2]?.searchParams.get("preset")).toBe("in30");
});

test("traffic map restores a shared route from the URL", async ({ page }) => {
  const travelPlanRequestUrls: URL[] = [];
  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    travelPlanRequestUrls.push(url);
    const activePreset = url.searchParams.get("preset") ?? "now";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        travelPlanComparisonFixture(
          {
            origin: {
              query: "Munkegata",
              label: "Munkegata",
              coordinate: [10.3951, 63.4305],
            },
            destination: {
              query: "Lade Arena",
              label: "Lade Arena",
              coordinate: [10.464, 63.433],
            },
            route: {
              source: "direct",
              distanceMeters: 4850,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.464, 63.433],
                ],
              },
              detail: "Direkte korridor.",
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
            itineraries: [],
            journeyPlanner: {
              status: "empty",
              detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
              requestedDepartureTime: "2026-07-05T16:20:00.000Z",
              source: "Entur Journey Planner",
            },
            sources: [],
            generatedAt: "2026-07-05T16:20:00.000Z",
          },
          activePreset,
        ),
      ),
    });
  });

  await page.goto("/trafikk?fra=Munkegata&til=Lade+Arena&tid=in30&preset=severe");

  await expect(page.getByLabel("Hvor er du?")).toHaveValue("Munkegata");
  await expect(page.getByLabel("Hvor skal du?")).toHaveValue("Lade Arena");
  await expect(page.getByLabel("Når?")).toHaveValue("in30");
  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Gå til Lade Arena");
  await expect(page.locator(".traffic-journey-answer")).toContainText("1 t");
  await expect(page.locator(".traffic-primary-map-section")).toContainText("Kartet viser ruten");
  await expect(page.locator(".traffic-map")).toBeVisible();
  await expect.poll(() => travelPlanRequestUrls.length).toBeGreaterThan(0);
  expect(travelPlanRequestUrls.at(-1)?.searchParams.get("from")).toBe("Munkegata");
  expect(travelPlanRequestUrls.at(-1)?.searchParams.get("to")).toBe("Lade Arena");
  expect(travelPlanRequestUrls.at(-1)?.pathname).toBe("/api/map/travel-plan/compare");
  await expect(page).toHaveURL(/fra=Munkegata/);
});

test("traffic map can use browser location as the route origin and nearby stop board", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 63.4305, longitude: 10.3951 });

  const departureRequestUrls: URL[] = [];
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    const url = new URL(route.request().url());
    departureRequestUrls.push(url);
    if (!url.searchParams.has("lat") && !url.searchParams.has("lon")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "empty",
          detail: "Ingen avganger funnet nær valgt område.",
          areaLabel: "Trondheim sentrum",
          center: { lat: 63.4305, lon: 10.3951 },
          stops: [],
          departures: [],
          sources: [],
          generatedAt: "2026-06-01T09:06:00.000Z",
          handoffUrl: "https://www.atb.no/reiseplanlegger/",
        }),
      });
      return;
    }
    if (url.searchParams.get("lat") !== "63.4305" || url.searchParams.get("lon") !== "10.3951") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        detail: "Entur viser konkrete avganger nær valgt område.",
        areaLabel: "Din posisjon",
        center: { lat: 63.4305, lon: 10.3951 },
        stops: [],
        departures: [
          {
            id: "departure:3",
            stopId: "NSR:StopPlace:41613",
            stopName: "Munkegata",
            stopDistanceMeters: 42,
            mode: "bus",
            lineId: "ATB:Line:3",
            publicCode: "3",
            lineName: "Lade - Hallset",
            serviceJourneyId: "ATB:ServiceJourney:3",
            destinationName: "Leangen",
            aimedDepartureTime: "2026-06-01T09:10:00.000Z",
            expectedDepartureTime: "2026-06-01T09:10:00.000Z",
            delaySeconds: 0,
            realtime: true,
            cancelled: false,
            notices: [],
            handoffUrl: "https://www.atb.no/reiseplanlegger/",
          },
        ],
        sources: [],
        generatedAt: "2026-06-01T09:06:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });

  await page.goto("/trafikk");
  await page.getByRole("button", { name: "Bruk min posisjon" }).click();

  await expect(page.getByLabel("Hvor er du?")).toHaveValue("63.43050, 10.39510");
  await expect(
    page.getByText("Posisjonen brukes bare i nettleseren og lagres ikke av Nytt."),
  ).toBeVisible();
  const board = page.getByRole("region", { name: "Avganger nå" });
  await expect(board).toContainText(
    "Din posisjon: neste avganger fra holdeplasser ved startpunktet.",
  );
  await expect(board).toContainText("Buss 3");
  await expect(board).toContainText("Leangen");
  expect(
    departureRequestUrls.some(
      (url) =>
        url.searchParams.get("lat") === "63.4305" && url.searchParams.get("lon") === "10.3951",
    ),
  ).toBe(true);
});

test("traffic map travel planner shows route-specific traffic and public transport advice", async ({
  page,
}) => {
  const departureRequestUrls: URL[] = [];
  const travelPlanRequestUrls: URL[] = [];
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    const url = new URL(route.request().url());
    departureRequestUrls.push(url);
    if (url.searchParams.get("lat") !== "63.4305" || url.searchParams.get("lon") !== "10.3951") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        detail: "Entur viser konkrete avganger nær valgt område.",
        areaLabel: "Valgt område",
        center: { lat: 63.4305, lon: 10.3951 },
        stops: [],
        departures: [
          {
            id: "departure:3",
            stopId: "NSR:StopPlace:41613",
            stopName: "Munkegata",
            stopDistanceMeters: 42,
            quayPublicCode: "M1",
            mode: "bus",
            lineId: "ATB:Line:3",
            publicCode: "3",
            lineName: "Lade - Hallset",
            serviceJourneyId: "ATB:ServiceJourney:3",
            destinationName: "Leangen",
            aimedDepartureTime: "2026-06-01T09:10:00.000Z",
            expectedDepartureTime: "2026-06-01T09:10:00.000Z",
            delaySeconds: 0,
            realtime: true,
            cancelled: false,
            notices: [],
            handoffUrl: "https://www.atb.no/reiseplanlegger/",
          },
        ],
        sources: [
          {
            source: "entur_service_alerts",
            label: "Entur avvik",
            state: "ok",
            detail: "Ingen aktive avvik",
          },
        ],
        generatedAt: "2026-06-01T09:06:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });

  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    travelPlanRequestUrls.push(url);
    expect(url.searchParams.get("from")).toBe("Munkegata");
    expect(url.searchParams.get("to")).toBe("Leangen");
    const requestedPreset = url.searchParams.get("preset") ?? "now";
    expect(["now", "in30", "in60", "in120"]).toContain(requestedPreset);
    const departureTimes: Record<string, [string, string]> = {
      now: ["2026-06-01T08:40:00.000Z", "2026-06-01T08:57:00.000Z"],
      in30: ["2026-06-01T09:10:00.000Z", "2026-06-01T09:27:00.000Z"],
      in60: ["2026-06-01T09:40:00.000Z", "2026-06-01T09:57:00.000Z"],
      in120: ["2026-06-01T11:10:00.000Z", "2026-06-01T11:27:00.000Z"],
    };
    const planForPreset = (preset: string) => {
      const [departureTime, arrivalTime] = departureTimes[preset] ?? departureTimes.now;
      return withModeAwareTravelPlanMock({
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
            id: "entur-service-alert:ATB:line23",
            kind: "alert",
            title: "Endret rute for linje 23",
            detail: "Linjevarsel uten publisert kartpunkt.",
            source: "Entur avvik",
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
        itineraries: [
          {
            id: "itinerary-1",
            decision: "watch",
            decisionReason: "Nytt fant avvik eller trafikkmeldinger som kan påvirke reisen.",
            labels: ["best_now", "fewest_transfers", "soonest_departure", "most_robust"],
            departureTime,
            arrivalTime,
            durationSeconds: 1020,
            transferCount: 0,
            walkTimeSeconds: 240,
            realtime: true,
            modes: ["bus"],
            disruptionCount: 1,
            handoffUrl: "https://www.atb.no/reiseplanlegger/",
            legs: [
              {
                id: "leg-bus-3",
                mode: "bus",
                from: {
                  name: "Munkegata",
                  stopName: "Munkegata",
                  coordinate: [10.3951, 63.4305],
                },
                to: {
                  name: "Leangen",
                  stopName: "Leangen",
                  coordinate: [10.464, 63.433],
                },
                aimedStartTime: departureTime,
                expectedStartTime: departureTime,
                aimedEndTime: arrivalTime,
                expectedEndTime: arrivalTime,
                durationSeconds: 1020,
                distanceMeters: 4850,
                realtime: true,
                cancelled: false,
                replacementTransport: false,
                publicCode: "3",
                lineName: "Lade - Hallset",
                serviceJourneyId: "ATB:ServiceJourney:3",
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [10.3951, 63.4305],
                    [10.464, 63.433],
                  ],
                },
                notices: [
                  {
                    id: "alert-1",
                    title: "Forsinkelse på linje 3",
                    detail: "Beregn ekstra tid.",
                    source: "Entur avvik",
                    severity: "warning",
                  },
                ],
              },
            ],
          },
        ],
        journeyPlanner: {
          status: "ok",
          detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
          requestedDepartureTime: departureTime,
          source: "Entur Journey Planner",
        },
        sources: [],
        generatedAt: "2026-06-01T09:05:00.000Z",
      });
    };
    const selectedPlan = planForPreset(requestedPreset);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activePreset: requestedPreset,
        selectedPlan,
        sources: ["now", "in30", "in60", "in120"].map((preset) => ({
          preset,
          plan: planForPreset(preset),
        })),
        generatedAt: "2026-06-01T09:05:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");
  await expect(page.getByRole("heading", { name: "Planlegg reisen" })).toBeVisible();
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByLabel("Når?").selectOption("in30");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.locator(".travel-planner-panel-post-search")).toBeVisible();
  await expect(page.locator(".travel-planner-copy")).toHaveCount(0);
  await expect(page.locator(".route-planner-form-compact")).toBeVisible();
  await expect(page.locator(".travel-plan-result")).toBeVisible();
  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Ta Buss 3 fra Munkegata");
  await expect(page.locator(".traffic-journey-answer")).toContainText(
    "11:10 → 11:27 · 17 min · Direkte",
  );
  await expect(page.getByText("Reiseråd nå", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Ruteoppsummering")).toHaveCount(0);
  await expect(page.getByLabel("Andre reiseforslag")).toBeVisible();
  await expect(page.getByLabel("Andre reiseforslag")).toContainText("Buss 3");
  await expect(page.getByLabel("Andre reiseforslag")).toContainText("Anbefalt");
  await expect(page.getByText("Ta Buss 3 mot Leangen")).toBeVisible();
  await expect(page.getByLabel("Sjekk før avreise")).toContainText("Sjekk dette før avreise");
  await expect(page.getByLabel("Sjekk før avreise")).toContainText("Forsinkelse på linje 3");
  await expect(page.getByLabel("Trafikk langs reisen")).toHaveCount(0);
  await expect(page.getByText("Kartpunkter langs valgt rute")).toHaveCount(0);
  await expect(page.getByText("Se trafikk langs ruten")).toHaveCount(0);
  await expect(page.locator(".traffic-primary-map-section")).toContainText("Kartet viser ruten");
  await expect(page.locator(".traffic-primary-map-section")).toContainText("Stopp, gangetapper");
  await expect(page.locator("details.traffic-map-disclosure")).toHaveCount(0);
  await expect(page.locator(".traffic-map")).toBeVisible();
  await openTrafficDisclosure(page, "Varsler uten kartpunkt");
  await expect(
    page
      .locator("details.traffic-line-alert-disclosure")
      .getByText("Forsinkelse på linje 3", { exact: true }),
  ).toBeVisible();
  await openTrafficDisclosure(page, "Dra nå eller vent?");
  const comparison = page.getByLabel("Dra nå eller vent");
  await expect(comparison).toContainText("Dra nå eller vent?");
  await expect(comparison).toContainText("Om 2 timer");
  await openTrafficDisclosure(page, "Avganger for valgt reise");
  const board = page.getByRole("region", { name: /Avganger rundt/ });
  await expect(board).toContainText("Munkegata: neste avganger fra holdeplasser ved startpunktet.");
  await expect(board.getByRole("button", { name: "Startpunkt" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const selectedDeparture = board.getByLabel("Valgt reiseforslag");
  await expect(selectedDeparture).toContainText("Buss 3 fra Munkegata");
  await expect(selectedDeparture).toContainText("Sanntid");
  await expect(selectedDeparture).toContainText("Matcher sanntidsavgang mot Leangen");
  expect(
    departureRequestUrls.some(
      (url) =>
        url.searchParams.get("lat") === "63.4305" &&
        url.searchParams.get("lon") === "10.3951" &&
        url.searchParams.get("startTime") === "2026-06-01T09:10:00.000Z",
    ),
  ).toBe(true);
  await page.getByLabel("Når?").selectOption("in120");
  await expect.poll(() => travelPlanRequestUrls.length).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/tid=in120/);
  await expect
    .poll(() =>
      departureRequestUrls.some(
        (url) =>
          url.searchParams.get("lat") === "63.4305" &&
          url.searchParams.get("lon") === "10.3951" &&
          url.searchParams.get("startTime") === "2026-06-01T11:10:00.000Z",
      ),
    )
    .toBe(true);
  await expect(
    page.getByText("Nytt vurderer reiserisiko, ikke billetter eller garanti."),
  ).toBeVisible();
  await expect(
    page.locator(".traffic-journey-answer").getByRole("link", { name: "Åpne hos AtB/Entur" }),
  ).toHaveAttribute("href", "https://www.atb.no/reiseplanlegger/");
  await page.getByText("Se datagrunnlag").click();
  await expect(page.getByText("Entur Journey Planner", { exact: true })).toBeVisible();
});

test("trafikk shows walking route and map when Entur has no current trip", async ({ page }) => {
  const walkingPlan = {
    origin: {
      label: "Munkegata, Trondheim",
      query: "Munkegata",
      coordinate: [10.393742, 63.432883],
    },
    destination: {
      label: "Lade gård, Trondheim",
      query: "Lade",
      coordinate: [10.463, 63.433],
    },
    route: {
      source: "direct",
      distanceMeters: 3500,
      detail: "Direkte korridor mellom punktene.",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
    },
    primaryMode: "walk",
    walkingRoute: {
      source: "direct",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.393742, 63.432883],
          [10.463, 63.433],
        ],
      },
      distanceMeters: 3500,
      durationSeconds: 2580,
      detail: "Gangtid estimert fra luftlinjekorridor.",
      confidence: "corridor",
    },
    trafficImpacts: [],
    publicTransportSuggestions: [],
    itineraries: [],
    journeyPlanner: {
      status: "empty",
      detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
      requestedDepartureTime: "2026-06-01T23:30:00.000Z",
      source: "Entur Journey Planner",
    },
    sources: [],
    generatedAt: "2026-06-01T23:30:00.000Z",
  };

  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activePreset: "now",
        selectedPlan: walkingPlan,
        sources: [{ preset: "now", plan: walkingPlan }],
        generatedAt: "2026-06-01T23:30:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Lade gård");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Gå til Lade gård");
  await expect(page.locator(".traffic-journey-answer")).toContainText("43 min");
  await expect(page.getByText("Ingen konkrete Entur-reiser funnet for valgt tid.")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Kartet viser ruten" })).toBeVisible();
  await expect(page.locator(".traffic-map")).toBeVisible();
});

test("traffic map explains selected route departures that are missing from the live board", async ({
  page,
}) => {
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("lat") !== "63.4305" || url.searchParams.get("lon") !== "10.3951") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "empty",
        detail: "Ingen avganger funnet nær valgt område.",
        areaLabel: "Valgt område",
        center: { lat: 63.4305, lon: 10.3951 },
        stops: [],
        departures: [],
        sources: [],
        generatedAt: "2026-06-01T09:06:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });

  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        travelPlanComparisonFixture(
          {
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
            itineraries: [
              {
                id: "itinerary-1",
                decision: "good",
                decisionReason: "Normal reise.",
                labels: ["best_now", "fewest_transfers", "soonest_departure", "most_robust"],
                departureTime: "2026-06-01T09:10:00.000Z",
                arrivalTime: "2026-06-01T09:27:00.000Z",
                durationSeconds: 1020,
                transferCount: 0,
                walkTimeSeconds: 240,
                realtime: true,
                modes: ["bus"],
                disruptionCount: 0,
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
                legs: [
                  {
                    id: "leg-bus-3",
                    mode: "bus",
                    from: {
                      name: "Munkegata",
                      stopName: "Munkegata",
                      coordinate: [10.3951, 63.4305],
                    },
                    to: {
                      name: "Leangen",
                      stopName: "Leangen",
                      coordinate: [10.464, 63.433],
                    },
                    aimedStartTime: "2026-06-01T09:10:00.000Z",
                    expectedStartTime: "2026-06-01T09:10:00.000Z",
                    aimedEndTime: "2026-06-01T09:27:00.000Z",
                    expectedEndTime: "2026-06-01T09:27:00.000Z",
                    durationSeconds: 1020,
                    distanceMeters: 4850,
                    realtime: true,
                    cancelled: false,
                    replacementTransport: false,
                    publicCode: "3",
                    lineName: "Lade - Hallset",
                    serviceJourneyId: "ATB:ServiceJourney:3",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [10.3951, 63.4305],
                        [10.464, 63.433],
                      ],
                    },
                    notices: [],
                  },
                ],
              },
            ],
            journeyPlanner: {
              status: "ok",
              detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
              requestedDepartureTime: "2026-06-01T09:05:00.000Z",
              source: "Entur Journey Planner",
            },
            sources: [],
            generatedAt: "2026-06-01T09:05:00.000Z",
          },
          url.searchParams.get("preset") ?? "now",
        ),
      ),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await openTrafficDisclosure(page, "Avganger for valgt reise");
  const board = page.getByRole("region", { name: /Avganger rundt/ });
  const selectedDeparture = board.getByLabel("Valgt reiseforslag");
  await expect(selectedDeparture).toContainText("Buss 3 fra Munkegata");
  await expect(selectedDeparture).toContainText("Ingen tavletreff");
  await expect(selectedDeparture).toContainText(
    "Avgangstavla for Valgt område har ingen avganger for valgt tidsrom.",
  );
  await expect(selectedDeparture).toContainText("Planlagt");
  await expect(board).toContainText("Ingen avganger funnet nær valgt område.");
});

test("traffic map checks transfer legs against live departure boards", async ({ page }) => {
  const departureRequestUrls: URL[] = [];
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    const url = new URL(route.request().url());
    departureRequestUrls.push(url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const isStart = lat === "63.4305" && lon === "10.3951";
    const isTransfer = lat === "63.433" && lon === "10.447";
    const departures = isStart
      ? [
          {
            id: "departure:3",
            stopId: "NSR:StopPlace:41613",
            stopName: "Munkegata",
            stopDistanceMeters: 42,
            mode: "bus",
            lineId: "ATB:Line:3",
            publicCode: "3",
            lineName: "Lade - Hallset",
            serviceJourneyId: "ATB:ServiceJourney:3",
            destinationName: "Strindheim",
            aimedDepartureTime: "2026-06-01T09:10:00.000Z",
            expectedDepartureTime: "2026-06-01T09:10:00.000Z",
            delaySeconds: 0,
            realtime: true,
            cancelled: false,
            notices: [],
            handoffUrl: "https://www.atb.no/reiseplanlegger/",
          },
        ]
      : isTransfer
        ? [
            {
              id: "departure:4",
              stopId: "NSR:StopPlace:41000",
              stopName: "Strindheim",
              stopDistanceMeters: 30,
              mode: "bus",
              lineId: "ATB:Line:4",
              publicCode: "4",
              lineName: "Strindheim - Lade",
              serviceJourneyId: "ATB:ServiceJourney:4",
              destinationName: "Lade",
              aimedDepartureTime: "2026-06-01T09:20:00.000Z",
              expectedDepartureTime: "2026-06-01T09:20:00.000Z",
              delaySeconds: 0,
              realtime: true,
              cancelled: true,
              notices: [],
              handoffUrl: "https://www.atb.no/reiseplanlegger/",
            },
          ]
        : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: departures.length ? "ok" : "empty",
        detail: departures.length
          ? "Entur viser konkrete avganger nær valgt område."
          : "Ingen avganger funnet nær valgt område.",
        areaLabel: isTransfer ? "Strindheim" : isStart ? "Munkegata" : "Trondheim sentrum",
        center: { lat: Number(lat ?? 63.4305), lon: Number(lon ?? 10.3951) },
        stops: [],
        departures,
        sources: [],
        generatedAt: "2026-06-01T09:06:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });

  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        travelPlanComparisonFixture(
          {
            origin: {
              query: "Munkegata",
              label: "Munkegata, Midtbyen",
              coordinate: [10.3951, 63.4305],
            },
            destination: {
              query: "Lade",
              label: "Lade, Trondheim",
              coordinate: [10.465, 63.444],
            },
            route: {
              source: "osrm",
              distanceMeters: 5200,
              durationSeconds: 1440,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.447, 63.433],
                  [10.465, 63.444],
                ],
              },
              detail: "Rute beregnet med OSRM.",
            },
            trafficImpacts: [],
            publicTransportSuggestions: [],
            itineraries: [
              {
                id: "itinerary-transfer",
                decision: "good",
                decisionReason: "Normal reise, men bytte kontrolleres mot live-tavle.",
                labels: ["best_now", "fewest_transfers"],
                departureTime: "2026-06-01T09:10:00.000Z",
                arrivalTime: "2026-06-01T09:34:00.000Z",
                durationSeconds: 1440,
                transferCount: 1,
                walkTimeSeconds: 180,
                realtime: true,
                modes: ["bus"],
                disruptionCount: 0,
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
                legs: [
                  {
                    id: "leg-bus-3",
                    mode: "bus",
                    from: {
                      name: "Munkegata",
                      stopName: "Munkegata",
                      stopId: "NSR:StopPlace:41613",
                      coordinate: [10.3951, 63.4305],
                    },
                    to: {
                      name: "Strindheim",
                      stopName: "Strindheim",
                      coordinate: [10.447, 63.433],
                    },
                    aimedStartTime: "2026-06-01T09:10:00.000Z",
                    expectedStartTime: "2026-06-01T09:10:00.000Z",
                    aimedEndTime: "2026-06-01T09:18:00.000Z",
                    expectedEndTime: "2026-06-01T09:18:00.000Z",
                    durationSeconds: 480,
                    distanceMeters: 2800,
                    realtime: true,
                    cancelled: false,
                    replacementTransport: false,
                    lineId: "ATB:Line:3",
                    publicCode: "3",
                    lineName: "Lade - Hallset",
                    serviceJourneyId: "ATB:ServiceJourney:3",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [10.3951, 63.4305],
                        [10.447, 63.433],
                      ],
                    },
                    notices: [],
                  },
                  {
                    id: "leg-bus-4",
                    mode: "bus",
                    from: {
                      name: "Strindheim",
                      stopName: "Strindheim",
                      stopId: "NSR:StopPlace:41000",
                      coordinate: [10.447, 63.433],
                    },
                    to: {
                      name: "Lade",
                      stopName: "Lade",
                      coordinate: [10.465, 63.444],
                    },
                    aimedStartTime: "2026-06-01T09:20:00.000Z",
                    expectedStartTime: "2026-06-01T09:20:00.000Z",
                    aimedEndTime: "2026-06-01T09:34:00.000Z",
                    expectedEndTime: "2026-06-01T09:34:00.000Z",
                    durationSeconds: 840,
                    distanceMeters: 2400,
                    realtime: true,
                    cancelled: false,
                    replacementTransport: false,
                    lineId: "ATB:Line:4",
                    publicCode: "4",
                    lineName: "Strindheim - Lade",
                    serviceJourneyId: "ATB:ServiceJourney:4",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [10.447, 63.433],
                        [10.465, 63.444],
                      ],
                    },
                    notices: [],
                  },
                ],
              },
            ],
            journeyPlanner: {
              status: "ok",
              detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
              requestedDepartureTime: "2026-06-01T09:05:00.000Z",
              source: "Entur Journey Planner",
            },
            sources: [],
            generatedAt: "2026-06-01T09:05:00.000Z",
          },
          url.searchParams.get("preset") ?? "now",
        ),
      ),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Lade");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await openTrafficDisclosure(page, "Live-sjekk av bytter");
  const confidence = page.getByRole("region", { name: "Sjekk byttene før du drar" });
  await expect(confidence).toContainText("Start: Munkegata");
  await expect(confidence).toContainText("Bytte 1: Strindheim");
  await expect(confidence).toContainText("Innstilt");
  await expect(confidence).toContainText("Buss 4");
  await openTrafficDisclosure(page, "Dra nå eller vent?");
  const comparison = page.getByLabel("Dra nå eller vent");
  await expect(comparison).toContainText("Vent til om 30 min kan være bedre");
  await expect(comparison).toContainText("Live-sjekken for valgt reise gir usikkerhet");
  await expect(comparison.getByRole("button", { name: /Om 30 min · anbefalt/ })).toBeVisible();
  expect(
    departureRequestUrls.some(
      (url) =>
        url.searchParams.get("lat") === "63.433" &&
        url.searchParams.get("lon") === "10.447" &&
        url.searchParams.get("startTime") === "2026-06-01T09:20:00.000Z",
    ),
  ).toBe(true);
});

test("traffic map recommends the robust itinerary when the fastest live departure is cancelled", async ({
  page,
}) => {
  const departureRequestUrls: URL[] = [];
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    const url = new URL(route.request().url());
    departureRequestUrls.push(url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const startTime = url.searchParams.get("startTime");
    const isRouteStart = lat === "63.4305" && lon === "10.3951";
    const departures =
      isRouteStart && startTime === "2026-06-01T09:10:00.000Z"
        ? [
            {
              id: "departure:3-cancelled",
              stopId: "NSR:StopPlace:41613",
              stopName: "Munkegata",
              stopDistanceMeters: 42,
              mode: "bus",
              lineId: "ATB:Line:3",
              publicCode: "3",
              lineName: "Lade - Hallset",
              serviceJourneyId: "ATB:ServiceJourney:3",
              destinationName: "Leangen",
              aimedDepartureTime: "2026-06-01T09:10:00.000Z",
              expectedDepartureTime: "2026-06-01T09:10:00.000Z",
              delaySeconds: 0,
              realtime: true,
              cancelled: true,
              notices: [],
              handoffUrl: "https://www.atb.no/reiseplanlegger/",
            },
          ]
        : isRouteStart && startTime === "2026-06-01T09:16:00.000Z"
          ? [
              {
                id: "departure:71",
                stopId: "NSR:StopPlace:41613",
                stopName: "Munkegata",
                stopDistanceMeters: 42,
                mode: "bus",
                lineId: "ATB:Line:71",
                publicCode: "71",
                lineName: "MelhusSkyss-Trondheim",
                serviceJourneyId: "ATB:ServiceJourney:71",
                destinationName: "Leangen",
                aimedDepartureTime: "2026-06-01T09:16:00.000Z",
                expectedDepartureTime: "2026-06-01T09:16:00.000Z",
                delaySeconds: 0,
                realtime: true,
                cancelled: false,
                notices: [],
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
              },
            ]
          : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: departures.length ? "ok" : "empty",
        detail: departures.length
          ? "Entur viser konkrete avganger nær valgt område."
          : "Ingen avganger funnet nær valgt område.",
        areaLabel: isRouteStart ? "Munkegata" : "Trondheim sentrum",
        center: {
          lat: Number(lat ?? 63.4305),
          lon: Number(lon ?? 10.3951),
        },
        stops: [],
        departures,
        sources: [],
        generatedAt: "2026-06-01T09:06:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });

  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    const fastDeparture = "2026-06-01T09:10:00.000Z";
    const fastArrival = "2026-06-01T09:25:00.000Z";
    const robustDeparture = "2026-06-01T09:16:00.000Z";
    const robustArrival = "2026-06-01T09:38:00.000Z";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        travelPlanComparisonFixture(
          {
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
            itineraries: [
              {
                id: "itinerary-fastest",
                decision: "good",
                decisionReason: "Raskeste reiseforslag, men live-tavla avgjør.",
                labels: ["best_now", "soonest_departure"],
                departureTime: fastDeparture,
                arrivalTime: fastArrival,
                durationSeconds: 900,
                transferCount: 0,
                walkTimeSeconds: 180,
                realtime: true,
                modes: ["bus"],
                disruptionCount: 0,
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
                legs: [
                  {
                    id: "leg-bus-3",
                    mode: "bus",
                    from: {
                      name: "Munkegata",
                      stopName: "Munkegata",
                      stopId: "NSR:StopPlace:41613",
                      coordinate: [10.3951, 63.4305],
                    },
                    to: {
                      name: "Leangen",
                      stopName: "Leangen",
                      coordinate: [10.464, 63.433],
                    },
                    aimedStartTime: fastDeparture,
                    expectedStartTime: fastDeparture,
                    aimedEndTime: fastArrival,
                    expectedEndTime: fastArrival,
                    durationSeconds: 900,
                    distanceMeters: 4850,
                    realtime: true,
                    cancelled: false,
                    replacementTransport: false,
                    lineId: "ATB:Line:3",
                    publicCode: "3",
                    lineName: "Lade - Hallset",
                    serviceJourneyId: "ATB:ServiceJourney:3",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [10.3951, 63.4305],
                        [10.464, 63.433],
                      ],
                    },
                    notices: [],
                  },
                ],
              },
              {
                id: "itinerary-robust",
                decision: "good",
                decisionReason: "Direkte alternativ med bedre live-margin.",
                labels: ["fewest_transfers", "most_robust"],
                departureTime: robustDeparture,
                arrivalTime: robustArrival,
                durationSeconds: 1320,
                transferCount: 0,
                walkTimeSeconds: 180,
                realtime: true,
                modes: ["bus"],
                disruptionCount: 0,
                handoffUrl: "https://www.atb.no/reiseplanlegger/",
                legs: [
                  {
                    id: "leg-bus-71",
                    mode: "bus",
                    from: {
                      name: "Munkegata",
                      stopName: "Munkegata",
                      stopId: "NSR:StopPlace:41613",
                      coordinate: [10.3951, 63.4305],
                    },
                    to: {
                      name: "Leangen",
                      stopName: "Leangen",
                      coordinate: [10.464, 63.433],
                    },
                    aimedStartTime: robustDeparture,
                    expectedStartTime: robustDeparture,
                    aimedEndTime: robustArrival,
                    expectedEndTime: robustArrival,
                    durationSeconds: 1320,
                    distanceMeters: 4850,
                    realtime: true,
                    cancelled: false,
                    replacementTransport: false,
                    lineId: "ATB:Line:71",
                    publicCode: "71",
                    lineName: "MelhusSkyss-Trondheim",
                    serviceJourneyId: "ATB:ServiceJourney:71",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [10.3951, 63.4305],
                        [10.464, 63.433],
                      ],
                    },
                    notices: [],
                  },
                ],
              },
            ],
            journeyPlanner: {
              status: "ok",
              detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
              requestedDepartureTime: fastDeparture,
              source: "Entur Journey Planner",
            },
            sources: [],
            generatedAt: "2026-06-01T09:05:00.000Z",
          },
          url.searchParams.get("preset") ?? "now",
        ),
      ),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.locator(".travel-planner-panel-post-search")).toBeVisible();
  await expect(page.locator(".travel-plan-result")).toBeVisible();
  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Ta Buss 3 fra Munkegata");
  const choices = page.getByLabel("Andre reiseforslag");
  await expect(choices).toBeVisible();
  await expect(choices).toContainText("Et annet reiseforslag ser tryggere ut");
  await expect(choices.getByRole("button")).toHaveCount(2);
  await expect(choices.getByRole("button", { name: /Anbefalt/ })).toContainText("Buss 71");
  await expect(choices.getByRole("button", { name: /Raskest/ })).toContainText(
    "Avgangen mot Leangen er innstilt",
  );
  await choices.getByRole("button", { name: /Anbefalt/ }).click();
  await expect(choices).toContainText("Valgt reiseforslag ser best ut");
  await expect(choices).toContainText("Matcher sanntidsavgang mot Leangen");
  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Ta Buss 71 fra Munkegata");
  expect(
    departureRequestUrls.some(
      (url) =>
        url.searchParams.get("lat") === "63.4305" &&
        url.searchParams.get("lon") === "10.3951" &&
        url.searchParams.get("startTime") === "2026-06-01T09:16:00.000Z",
    ),
  ).toBe(true);
});

test("traffic map clears a stale route when planner validation fails", async ({ page }) => {
  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        travelPlanComparisonFixture(
          {
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
            itineraries: [],
            journeyPlanner: {
              status: "empty",
              detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
              requestedDepartureTime: "2026-06-01T09:05:00.000Z",
              source: "Entur Journey Planner",
            },
            sources: [],
            generatedAt: "2026-06-01T09:05:00.000Z",
          },
          url.searchParams.get("preset") ?? "now",
        ),
      ),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();
  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Gå til Leangen");
  await expect(page.locator('path[stroke="#2563eb"]')).toHaveCount(1);

  await page.getByLabel("Hvor er du?").fill("");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.getByRole("alert")).toContainText("Skriv inn både start og mål");
  await expect(page.locator('path[stroke="#2563eb"]')).toHaveCount(0);
});

test("traffic map keeps planner useful when Entur journey search is unavailable", async ({
  page,
}) => {
  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        travelPlanComparisonFixture(
          {
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
              source: "direct",
              distanceMeters: 4850,
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.3951, 63.4305],
                  [10.464, 63.433],
                ],
              },
              detail: "Ruten er vist som rett korridor fordi veiruting ikke var tilgjengelig.",
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
            itineraries: [],
            journeyPlanner: {
              status: "unavailable",
              detail: "Entur reisesøk er ikke tilgjengelig akkurat nå.",
              requestedDepartureTime: "2026-06-01T09:05:00.000Z",
              source: "Entur Journey Planner",
            },
            sources: [],
            generatedAt: "2026-06-01T09:05:00.000Z",
          },
          url.searchParams.get("preset") ?? "now",
        ),
      ),
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  await expect(page.locator("h1#travel-planner-heading")).toHaveText("Gå til Leangen");
  await expect(page.locator(".traffic-journey-answer")).toContainText("1 t");
  await expect(page.locator(".traffic-journey-answer")).toContainText(
    "Kollektivsøket feilet akkurat nå.",
  );
  await expect(page.getByRole("link", { name: "Sjekk AtB/Entur" })).toHaveAttribute(
    "href",
    "https://www.atb.no/reiseplanlegger/",
  );
});

test("traffic map invalidates an in-flight route when inputs change", async ({ page }) => {
  let fulfillRoute: (() => Promise<void>) | undefined;
  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const url = new URL(route.request().url());
    await new Promise<void>((resolve) => {
      fulfillRoute = async () => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            travelPlanComparisonFixture(
              {
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
                itineraries: [],
                journeyPlanner: {
                  status: "empty",
                  detail: "Ingen konkrete Entur-reiser funnet for valgt tidspunkt.",
                  requestedDepartureTime: "2026-06-01T09:05:00.000Z",
                  source: "Entur Journey Planner",
                },
                sources: [],
                generatedAt: "2026-06-01T09:05:00.000Z",
              },
              url.searchParams.get("preset") ?? "now",
            ),
          ),
        });
        resolve();
      };
    });
  });

  await page.goto("/trafikk");
  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Leangen");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();
  await expect(page.getByRole("button", { name: "Henter reiseråd ..." })).toBeDisabled();

  await page.getByLabel("Hvor er du?").fill("");
  await expect(page.getByRole("button", { name: "Finn reiseråd" })).toBeEnabled();
  await fulfillRoute?.();
  await page.waitForTimeout(100);

  await expect(page.getByRole("heading", { name: "Reiseråd for ruten" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sjekk AtB/Entur" })).toHaveCount(0);
  await expect(page.locator('path[stroke="#2563eb"]')).toHaveCount(0);
});

test("traffic map can show Entur public transport context", async ({ page }) => {
  await page.route("**/api/map/public-transport**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/departures")) {
      await route.fallback();
      return;
    }
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
  await page.getByRole("button", { name: "Vis kjøretøy" }).click();
  await expect(page.getByRole("heading", { name: "Kollektivtrafikk" })).toBeVisible();
  await openTrafficLayersIfHidden(page);
  await expect(page.getByText("45 → Hagen")).toBeVisible();
  await expect(page.locator(".public-transport-card").getByText("Rota flyttet")).toBeVisible();
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

test("weather page presents a forecast-first local weather tool with source-labeled guidance", async ({
  page,
}) => {
  await page.route("**/api/weather/preparedness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-06-01T08:05:00.000Z",
        location: {
          id: "sentrum",
          label: "Sentrum",
          latitude: 63.4305,
          longitude: 10.3951,
          description: "Midtbyen, Solsiden og sentrale Trondheim.",
        },
        current: {
          summary: "MET Locationforecast: regnbyger nå",
          updatedAt: "2026-06-01T08:00:00.000Z",
          airTemperatureC: 7,
          windSpeedMps: 8,
          precipitationNextHourMm: 2.4,
          symbolCode: "rain",
          sourceLabel: "MET Locationforecast",
          dataStatus: "ok",
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
        hourly: [
          {
            time: "2026-06-01T08:00:00.000Z",
            airTemperatureC: 7,
            windSpeedMps: 8,
            precipitationMm: 2.4,
            symbolCode: "rain",
            sourceProduct: "nowcast",
          },
          {
            time: "2026-06-01T09:00:00.000Z",
            airTemperatureC: 8,
            windSpeedMps: 7,
            precipitationMm: 1.5,
            symbolCode: "rain",
            sourceProduct: "nowcast",
          },
          {
            time: "2026-06-01T10:00:00.000Z",
            airTemperatureC: 9,
            windSpeedMps: 6,
            precipitationMm: 0.4,
            symbolCode: "cloudy",
            sourceProduct: "locationforecast",
          },
        ],
        forecast: {
          primaryLocationId: "sentrum",
          zones: [
            {
              location: {
                id: "sentrum",
                label: "Sentrum",
                latitude: 63.4305,
                longitude: 10.3951,
                description: "Midtbyen, Solsiden og sentrale Trondheim.",
              },
              current: {
                summary: "MET Locationforecast: regnbyger nå",
                updatedAt: "2026-06-01T08:00:00.000Z",
                airTemperatureC: 7,
                windSpeedMps: 8,
                precipitationNextHourMm: 2.4,
                symbolCode: "rain",
                sourceLabel: "MET Nowcast + Locationforecast",
                dataStatus: "ok",
              },
              hourly: [
                {
                  time: "2026-06-01T08:00:00.000Z",
                  airTemperatureC: 7,
                  windSpeedMps: 8,
                  precipitationMm: 2.4,
                  symbolCode: "rain",
                  sourceProduct: "nowcast",
                },
                {
                  time: "2026-06-01T09:00:00.000Z",
                  airTemperatureC: 8,
                  windSpeedMps: 7,
                  precipitationMm: 1.5,
                  symbolCode: "rain",
                  sourceProduct: "nowcast",
                },
                {
                  time: "2026-06-01T10:00:00.000Z",
                  airTemperatureC: 9,
                  windSpeedMps: 6,
                  precipitationMm: 0.4,
                  symbolCode: "cloudy",
                  sourceProduct: "locationforecast",
                },
              ],
              dataStatus: "ok",
              updatedAt: "2026-06-01T08:00:00.000Z",
              products: [],
            },
            {
              location: {
                id: "byasen",
                label: "Byåsen/Bymarka",
                latitude: 63.41,
                longitude: 10.29,
                description: "Byåsen, Bymarka og vestlige høyder.",
              },
              current: {
                summary: "MET Locationforecast: opphold nå",
                updatedAt: "2026-06-01T08:00:00.000Z",
                airTemperatureC: 4,
                windSpeedMps: 5,
                precipitationNextHourMm: 0.1,
                symbolCode: "cloudy",
                sourceLabel: "MET Locationforecast",
                dataStatus: "partial",
              },
              hourly: [
                {
                  time: "2026-06-01T08:00:00.000Z",
                  airTemperatureC: 4,
                  windSpeedMps: 5,
                  precipitationMm: 0.1,
                  symbolCode: "cloudy",
                  sourceProduct: "locationforecast",
                },
                {
                  time: "2026-06-01T09:00:00.000Z",
                  airTemperatureC: 5,
                  windSpeedMps: 5,
                  precipitationMm: 0,
                  symbolCode: "cloudy",
                  sourceProduct: "locationforecast",
                },
              ],
              dataStatus: "partial",
              updatedAt: "2026-06-01T08:00:00.000Z",
              products: [],
            },
          ],
          products: [],
        },
        quality: {
          generatedAt: "2026-06-01T08:05:00.000Z",
          cacheStatus: "miss",
          dataStatus: "ok",
          products: [
            {
              source: "met",
              product: "locationforecast",
              locationId: "sentrum",
              fetchedAt: "2026-06-01T08:05:00.000Z",
              updatedAt: "2026-06-01T08:00:00.000Z",
              cacheStatus: "miss",
              dataStatus: "ok",
              detail: "Hentet fra MET Locationforecast.",
            },
            {
              source: "met",
              product: "nowcast",
              locationId: "sentrum",
              fetchedAt: "2026-06-01T08:05:00.000Z",
              updatedAt: "2026-06-01T08:00:00.000Z",
              cacheStatus: "miss",
              dataStatus: "ok",
              detail: "Hentet fra MET Nowcast.",
            },
          ],
          detail: "MET-prognose er fersk.",
        },
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

  await expect(page.getByRole("heading", { name: "Vær", level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Nå", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Regnbyger nå" })).toBeVisible();
  await expect(page.getByText("MET Locationforecast: regnbyger nå")).toHaveCount(0);
  const byasenButton = page.getByRole("button", { name: /Byåsen\/Bymarka/ });
  await expect(byasenButton).toHaveAttribute("aria-pressed", "false");
  await byasenButton.click();
  await expect(byasenButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Opphold nå" })).toBeVisible();
  await expect(page.getByText("Neste 6 timer")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neste døgn" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nedbør" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Flom/skred" })).toBeVisible();
  await expect(page.getByText("MET farevarsel + Trondheim klimatilpasning")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Værkart for Trondheim" })).toBeVisible();
  await expect(page.getByText("Vegværstasjoner", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Aktive lag: varsler, vegvær, konsekvenser · Kartverket"),
  ).toBeVisible();
  await expect(page.getByText("Tegnes i kart")).toBeVisible();
  await expect(page.locator(".weather-warning-area")).toHaveCount(1);
  await expect(page.locator(".road-context-marker-weather")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Varsler og konsekvenser" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Innbyggere" })).toBeVisible();
  await page.getByText("Kilder og datagrunnlag").click();
  await expect(page.getByText("Fersk").first()).toBeVisible();
  await expect(page.getByText("Nytt er ikke koblet til Nødvarsel")).toBeVisible();
  await expect(page.getByText("Sivilforsvaret støtter politi, brann, helse")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalPageOverflow(page);
  const forecastTop = await page.getByText("Neste 6 timer").evaluate((node) => {
    return node.getBoundingClientRect().top;
  });
  const mapTop = await page
    .getByRole("heading", { name: "Værkart for Trondheim" })
    .evaluate((node) => {
      return node.getBoundingClientRect().top;
    });
  expect(forecastTop).toBeLessThan(mapTop);
});

test("weather page shows a useful retry state when the weather API fails once", async ({
  page,
}) => {
  let attempts = 0;
  let shouldFail = true;
  await page.route("**/api/weather/preparedness", async (route) => {
    attempts += 1;
    if (shouldFail) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Værdata er midlertidig utilgjengelig." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-06-01T08:05:00.000Z",
        location: {
          id: "sentrum",
          label: "Sentrum",
          latitude: 63.4305,
          longitude: 10.3951,
          description: "Midtbyen og sentrale Trondheim.",
        },
        current: {
          summary: "MET Locationforecast: opphold nå",
          updatedAt: "2026-06-01T08:00:00.000Z",
          airTemperatureC: 11,
          windSpeedMps: 2,
          precipitationNextHourMm: 0,
          symbolCode: "clearsky_day",
          sourceLabel: "MET Locationforecast",
          dataStatus: "ok",
        },
        hourly: [
          {
            time: "2026-06-01T08:00:00.000Z",
            airTemperatureC: 11,
            windSpeedMps: 2,
            precipitationMm: 0,
            symbolCode: "clearsky_day",
            sourceProduct: "locationforecast",
          },
        ],
        risks: [],
        actions: [],
        authority: { emergencyAlertStatus: "", civilDefenceDetail: "", links: [] },
        impactGroups: [],
        warnings: [],
        roadWeather: [],
        mapLayers: [],
        sources: [],
        quality: {
          generatedAt: "2026-06-01T08:05:00.000Z",
          cacheStatus: "miss",
          dataStatus: "ok",
          products: [],
          detail: "MET-prognose er fersk.",
        },
      }),
    });
  });

  await page.goto("/vaer");
  await expect(page.getByRole("alert")).toContainText("Værdata er midlertidig utilgjengelig.");
  await expect(page.getByText("Henter værberedskap...")).toHaveCount(0);

  shouldFail = false;
  await page.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(page.getByRole("heading", { name: "Opphold nå" })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
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

test("home keeps Vær as weather page navigation and a thematic feed filter", async ({ page }) => {
  await page.goto("/?q=bru&category=V%C3%A6r&scope=trondelag");

  await expect(page.getByRole("link", { name: "Vær" })).toHaveAttribute("href", "/vaer");
  await expect(page.getByRole("button", { name: "Vær" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText('Ingen saker samsvarer med "bru" Vær i Trøndelag.')).toBeVisible();
});

test("filtered feed failure does not claim that no stories match", async ({ page }) => {
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Bypulsen er midlertidig utilgjengelig." }),
    });
  });

  await page.goto("/?q=bru");

  await expect(
    page.getByText("Kunne ikke hente saker: Bypulsen er midlertidig utilgjengelig."),
  ).toBeVisible();
  await expect(page.getByText('Ingen saker samsvarer med "bru" i Trondheim.')).toHaveCount(0);
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
      expect(url.searchParams.get("limit")).toBe("12");
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
        dataUpdatedAt: "2026-07-02T10:40:00.000Z",
        sourceMode: "live",
        sourceLabel: "ESPN livefeed",
        sourceDetail: "Kampstatus og tabeller normalisert fra ESPN.",
      }),
    });
  });

  await page.goto("/sport");

  await expect(page.getByRole("heading", { name: "Fotballoversikt" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lag å følge" })).toBeVisible();
  await expect(page.locator(".sport-team-panel")).toContainText("Norge menn");
  await expect(page.locator(".sport-team-panel")).toContainText("RBK herrer");
  await expect(page.locator(".sport-team-panel")).toContainText("RBK kvinner");
  await expect(page.locator(".sport-team-panel")).toContainText("Ranheim herrer");
  await expect(page.locator(".sport-team-panel")).toContainText("1 saker i Nytt");
  await expect(page.getByRole("heading", { name: "Aktuelle VM-kamper" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Fotballoversikt" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lag å følge" })).toBeVisible();
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
          cityPulseVisible: 1,
          commandOnly: 1,
          officialBacked: 1,
          highConfidence: 1,
          spatialSignals: 0,
          spatialCritical: 0,
          unexplainedDelays: 0,
        },
        pushStatus: {
          configured: true,
          label: "Mangler match",
          detail:
            "Minst én kandidat mangler aktivt abonnement som matcher alvorlighet, type og tilgangsnivå.",
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
              {
                kind: "source_audit",
                label: "Kildeaudit: Statens vegvesen DATEX",
                href: "/command/kilder?sources=datex&detail=datex",
                sourceId: "datex",
              },
              {
                kind: "source_item",
                label: "Rådata: Statens vegvesen DATEX",
                href: "/command/radata?sourceItem=source%3Adatex-one",
                sourceId: "datex",
                sourceItemId: "source:datex-one",
              },
            ],
            publicSurface: {
              state: "visible",
              label: "Synlig på Bypuls",
              detail: "Sjekk rute nå · Oppdatert nå",
              reason: "Samme offentlige varselregel treffer City Pulse-datasettet.",
              attention: {
                label: "Sjekk rute nå",
                detail: "Hendelsen kan påvirke reisevei eller framkommelighet.",
                tone: "urgent",
              },
              recencyLabel: "Oppdatert nå",
              link: {
                kind: "situation",
                label: "Åpne situasjonsrom",
                href: "/situasjoner/road-one",
                situationId: "road-one",
              },
            },
          },
          {
            id: "notification:article:violence-one",
            kind: "public_safety",
            severity: "warning",
            deliveryState: "no_subscribers",
            title: "Voldshendelse på Lade",
            body: "Ingen aktive abonnement matcher denne typen.",
            detail: "Ingen aktive push-abonnement matcher alvorlighet, type og tilgangsnivå.",
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
            links: [
              {
                kind: "external",
                label: "Politiloggen",
                href: "https://example.test/politiloggen/violence-one",
              },
            ],
            publicSurface: {
              state: "hidden",
              label: "Ikke vist på Bypuls",
              detail:
                "Kandidaten er beholdt for operatørvurdering, men vises ikke som offentlig signal.",
              reason:
                "Artikkelkandidaten er under offentlig visningsterskel eller mangler public-safe signalgrunnlag.",
            },
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
            score: 0.91,
            confidence: {
              level: "confirmed",
              label: "Bekreftet",
              score: 0.91,
              sourceCount: 2,
              updatedAt: "2026-07-02T09:45:00.000Z",
            },
            sourceLabels: ["Vegvesen DATEX", "Adresseavisen"],
            matchedKeywords: ["stengt", "omkjøring"],
            reasons: ["Har offentlig kildegrunnlag."],
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
    await expect(page.locator(".notification-triggers-summary").getByText("Bypuls")).toBeVisible();
    await expect(
      page.locator(".notification-triggers-summary").getByText("Kun Command Center"),
    ).toBeVisible();
    await expect(page.getByText("1/2")).toBeVisible();
    await expect(page.getByText("Kildehelse kontrollert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Siste leveranser" })).toBeVisible();
    const deliveryHistory = page.locator(".notification-delivery-history");
    await expect(deliveryHistory.getByText("91 % score")).toBeVisible();
    await expect(deliveryHistory.getByText("Vegvesen DATEX, Adresseavisen")).toBeVisible();
    await expect(page.getByText("Steinsprang, vegen er stengt").first()).toBeVisible();
    await expect(page.getByText("Synlig på Bypuls").first()).toBeVisible();
    await expect(page.getByText("Sjekk rute nå · Oppdatert nå").first()).toBeVisible();
    await expect(page.getByText("1 audit · 1 rådata").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Kildeaudit.*Statens vegvesen DATEX/ }),
    ).toHaveAttribute("href", "/command/kilder?sources=datex&detail=datex");
    await expect(
      page.getByRole("link", { name: /Rådata.*Statens vegvesen DATEX/ }),
    ).toHaveAttribute("href", "/command/radata?sourceItem=source%3Adatex-one");
    await expect(page.getByText("Ingen abonnent").first()).toBeVisible();
    await expect(page.getByRole("group", { name: "Levering" })).toBeVisible();
    const candidateList = page.getByLabel("Varselkandidater");
    const traceFilters = page.getByRole("group", { name: "Sporbarhet" });
    await expect(traceFilters).toBeVisible();
    await traceFilters.getByLabel("Rådata").click();
    await expect(candidateList.getByText("1 vist av 2")).toBeVisible();
    await expect(candidateList.getByText("Steinsprang, vegen er stengt")).toBeVisible();
    await expect(candidateList.getByText("Voldshendelse på Lade")).not.toBeVisible();
    await traceFilters.getByLabel("Rådata").click();
    await page.getByLabel("Filtre").getByLabel("Ingen abonnent").click();
    await expect(candidateList.getByText("1 vist av 2")).toBeVisible();
    await expect(candidateList.getByText("Voldshendelse på Lade")).toBeVisible();
    await expect(candidateList.getByText("Kun ekstern kilde")).toBeVisible();
    await expect(candidateList.getByText("Steinsprang, vegen er stengt")).not.toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  }
});

test("public notification settings explain background readiness responsively", async ({ page }) => {
  await page.route("**/api/notifications/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        publicKey: "test-public-vapid-key",
        subscriptions: [
          {
            id: "subscription-one",
            endpointHash: "hashed-endpoint",
            enabled: true,
            minSeverity: "warning",
            kinds: [],
            createdAt: "2026-07-02T09:00:00.000Z",
            updatedAt: "2026-07-02T09:05:00.000Z",
            lastSeenAt: "2026-07-02T09:05:00.000Z",
            lastSuccessAt: "2026-07-02T09:10:00.000Z",
            failureCount: 0,
          },
        ],
      }),
    });
  });

  for (const viewport of [
    { width: 360, height: 780 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/varsler");
    await expect(page.getByRole("heading", { name: "Varsler", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hva virker hvor?" })).toBeVisible();
    const readiness = page.locator(".notification-readiness");
    await expect(readiness.getByText("Serverkanal", { exact: true })).toBeVisible();
    await expect(readiness.getByText("Nettleser", { exact: true })).toBeVisible();
    await expect(readiness.getByText("Åpen fane", { exact: true })).toBeVisible();
    const background = readiness.locator('[data-readiness-key="background"]');
    await expect(background).toContainText(/Koblet|Ikke klar|Ikke koblet/);
    const guidance = page.locator(".notification-trigger-guidance");
    await expect(guidance.getByRole("heading", { name: "Dette kan gi varsel" })).toBeVisible();
    await expect(guidance.getByRole("heading", { name: "Liv og helse" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hva vil du bli varslet om?" })).toBeVisible();
    const defaultSeverity = page.getByRole("button", { name: /Kritisk \+ varsel/ });
    const criticalOnly = page.getByRole("button", { name: /Bare kritisk/ });
    const trafficOnly = page.getByRole("button", { name: "Stengte hovedårer" }).first();
    await expect(defaultSeverity).toHaveAttribute("aria-pressed", "true");
    await criticalOnly.click();
    await expect(criticalOnly).toHaveAttribute("aria-pressed", "true");
    await trafficOnly.click();
    await expect(trafficOnly).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Stengte hovedårer").first()).toBeVisible();
    await expect(page.getByText("hashed-endpoint")).toHaveCount(0);
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
    { path: "/trafikk", heading: "Planlegg reisen" },
    { path: "/vaer", heading: "Vær" },
    { path: "/sport", heading: "Fotballoversikt" },
    { path: "/situasjoner", heading: "Trondheim situasjonskart" },
  ]) {
    await page.goto(route.path);
    await expect(page.locator(".session-role")).toContainText("Lesetilgang · Ingrid Leser");
    await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Hovedmeny" });
    await expect(navigation.getByRole("link", { name: "Kommandosenter" })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: "Lagret" })).toHaveCount(0);
  }

  await page.goto("/situasjoner");
  await expect(
    page.getByText("Offentlig kartvisning for pågående situasjoner, åpne kilder og siste nytt."),
  ).toBeVisible();
  await expect(
    page.getByLabel("Situasjonsdetaljer").getByRole("heading", { name: "Kilder" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Situasjonsdetaljer").getByRole("link", { name: "Åpne situasjonsrom" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Åpne arbeidsrom" })).toHaveCount(0);

  await page.goto("/trafikk");
  await openTrafficLayersIfHidden(page);
  await expect(page.getByText("Private notater/tegninger")).toHaveCount(0);

  for (const ownerOnlyPath of [
    "/command",
    "/command/brief",
    "/command/dekning",
    "/command/kilder",
    "/command/romlig",
    "/command/radata",
    "/command/tidslinje",
    "/command/varsler",
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
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: cityPulseStoryPageBody([
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
      ]),
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
  const saveResponse = page.waitForResponse((response) =>
    response.url().includes("/api/saved/articles/a-bridge"),
  );
  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  const pendingSaveButton = page.getByRole("button", {
    name: /(Lagre sak|Fjern fra lagret): Ny bru over Nidelva/,
  });
  await expect(pendingSaveButton).toBeDisabled();
  expect(calls).toBe(1);
  releaseSave();
  await saveResponse;

  const expectedLabel = initialLabel.startsWith("Fjern fra lagret")
    ? /Lagre sak: Ny bru over Nidelva/
    : /Fjern fra lagret: Ny bru over Nidelva/;
  await expect(page.getByRole("button", { name: expectedLabel })).toBeEnabled();
  expect(calls).toBe(1);
});

test("stale article refresh after save completion does not undo optimistic saved state", async ({
  page,
}) => {
  let storyRequestCount = 0;
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    storyRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: cityPulseStoryPageBody([
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
      ]),
    });
  });
  await page.route("**/api/saved/articles/a-bridge", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
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
    (response) => response.url().includes("/api/city-pulse/stories?") && response.status() === 200,
  );
  await page.getByPlaceholder("Søk i saker").fill("bru");
  await staleRefreshResponse;
  expect(storyRequestCount).toBe(1);

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
  await page.route("**/api/city-pulse/stories?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor") === "old-bru-page") {
      await oldPageMayFinish;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: cityPulseStoryPageBody([
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
        ]),
      });
      return;
    }
    if (url.searchParams.get("category") === "Politikk") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: cityPulseStoryPageBody([]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: cityPulseStoryPageBody(
        [
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
        "old-bru-page",
      ),
    });
  });

  await page.goto("/?q=bru");
  await expect(page.getByRole("button", { name: "Vis flere saker" })).toBeVisible();
  await page.getByRole("button", { name: "Vis flere saker" }).click();
  const politicsRefreshResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/city-pulse/stories" && url.searchParams.get("category") === "Politikk"
    );
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

test("mobile traffic page prioritizes travel planning before map summaries and filters", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout contract");
  await page.route("**/api/map/public-transport/departures**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "empty",
        detail: "Ingen avganger funnet nær valgt område.",
        areaLabel: "Valgt område",
        center: { lat: 63.4305, lon: 10.3951 },
        stops: [],
        departures: [],
        sources: [],
        generatedAt: "2026-06-01T09:06:00.000Z",
        handoffUrl: "https://www.atb.no/reiseplanlegger/",
      }),
    });
  });
  await page.route("**/api/map/travel-plan/compare?**", async (route) => {
    const departureTime = "2026-06-01T09:10:00.000Z";
    const arrivalTime = "2026-06-01T09:28:00.000Z";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        travelPlanComparisonFixture({
          origin: {
            query: "Munkegata",
            label: "Munkegata, Midtbyen",
            coordinate: [10.3951, 63.4305],
          },
          destination: {
            query: "Lade",
            label: "Lade, Trondheim",
            coordinate: [10.445, 63.442],
          },
          route: {
            source: "osrm",
            distanceMeters: 3700,
            durationSeconds: 420,
            geometry: {
              type: "LineString",
              coordinates: [
                [10.3951, 63.4305],
                [10.445, 63.442],
              ],
            },
            detail: "Rute beregnet med OSRM.",
          },
          trafficImpacts: [
            {
              event: {
                id: "mobile-roadwork",
                source: "datex",
                sourceEventId: "mobile-roadwork",
                category: "roadworks",
                severity: "medium",
                state: "active",
                title: "Vegarbeid ved Bakklandet",
                updatedAt: "2026-06-01T09:00:00.000Z",
                geometry: { type: "Point", coordinates: [10.412, 63.429] },
              },
              distanceMeters: 220,
              severity: "medium",
              summary: "220 m fra foreslått rute.",
            },
          ],
          publicTransportSuggestions: [
            {
              id: "mobile-line-alert",
              kind: "alert",
              title: "Forsinkelse på linje 2",
              detail: "Beregn ekstra tid på Buss 2.",
              source: "Entur avvik",
            },
          ],
          itineraries: [
            {
              id: "mobile-itinerary",
              decision: "good",
              decisionReason: "Direkte reiseforslag uten kjente avvik.",
              labels: ["best_now", "fewest_transfers", "most_robust"],
              departureTime,
              arrivalTime,
              durationSeconds: 1080,
              transferCount: 0,
              walkTimeSeconds: 360,
              realtime: true,
              modes: ["bus"],
              disruptionCount: 0,
              handoffUrl: "https://www.atb.no/reiseplanlegger/",
              legs: [
                {
                  id: "mobile-leg-bus-2",
                  mode: "bus",
                  from: {
                    name: "Søndre gate",
                    stopName: "Søndre gate",
                    stopId: "NSR:StopPlace:41613",
                    coordinate: [10.3951, 63.4305],
                  },
                  to: {
                    name: "Lade gård",
                    stopName: "Lade gård",
                    coordinate: [10.445, 63.442],
                  },
                  aimedStartTime: departureTime,
                  expectedStartTime: departureTime,
                  aimedEndTime: arrivalTime,
                  expectedEndTime: arrivalTime,
                  durationSeconds: 1080,
                  distanceMeters: 3700,
                  realtime: true,
                  cancelled: false,
                  replacementTransport: false,
                  lineId: "ATB:Line:2",
                  publicCode: "2",
                  lineName: "Strindheim - Lade",
                  serviceJourneyId: "ATB:ServiceJourney:2",
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [10.3951, 63.4305],
                      [10.445, 63.442],
                    ],
                  },
                  notices: [],
                },
              ],
            },
          ],
          journeyPlanner: {
            status: "ok",
            detail: "Entur Journey Planner returnerte konkrete reiseforslag.",
            requestedDepartureTime: departureTime,
            source: "Entur Journey Planner",
          },
          sources: [],
          generatedAt: "2026-06-01T09:05:00.000Z",
        }),
      ),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trafikk");

  const heading = page.getByRole("heading", { name: "Planlegg reisen" });
  await expect(heading).toBeVisible();
  const layersButton = page.getByRole("button", { name: "Kartlag og filtre" });
  await expect(layersButton).toBeVisible();

  const headingBox = await heading.boundingBox();
  const layersBox = await layersButton.boundingBox();
  const workspaceBox = await page.locator(".traffic-workspace").boundingBox();
  const mapBox = await page.locator(".traffic-map").boundingBox();
  expect(headingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(mapBox?.y ?? 0);
  expect(mapBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(layersBox?.y ?? 0);
  for (const box of [layersBox, workspaceBox, mapBox]) {
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.width ?? Number.POSITIVE_INFINITY) + (box?.x ?? 0)).toBeLessThanOrEqual(391);
  }

  await page.getByLabel("Hvor er du?").fill("Munkegata");
  await page.getByLabel("Hvor skal du?").fill("Lade");
  await page.getByRole("button", { name: "Finn reiseråd" }).click();

  const postSearchPanel = page.locator(".travel-planner-panel-post-search");
  const choices = page.getByLabel("Andre reiseforslag");
  const travelAdvice = page.locator(".traffic-journey-answer");
  const departureContext = page.locator("details.traffic-support-disclosure", {
    hasText: "Avganger for valgt reise",
  });
  const trafficPicture = page.locator("details.traffic-support-disclosure", {
    hasText: "Trafikkbildet nå",
  });
  const lineAlertDisclosure = page.locator("details.traffic-line-alert-disclosure");
  const postSearchMap = page.locator(".traffic-primary-map-section");
  const sourceData = page.locator(".traffic-data-disclosure");
  await expect(postSearchPanel).toBeVisible();
  await expect(page.getByText("Reiseråd nå", { exact: true })).toBeVisible();
  await expect(choices).toBeVisible();
  await expect(travelAdvice).toContainText("Buss 2");
  await expect(departureContext).toBeVisible();
  await expect(trafficPicture).toBeVisible();
  await expect(postSearchMap).toContainText("Kartet viser ruten");
  await expect(lineAlertDisclosure).toContainText("Varsler uten kartpunkt");
  await openTrafficDisclosure(page, "Varsler uten kartpunkt");
  await expect(
    lineAlertDisclosure.getByText("Forsinkelse på linje 2", { exact: true }),
  ).toBeVisible();
  await expect(sourceData).toContainText("Se datagrunnlag");
  await expect(page.locator(".travel-planner-copy")).toHaveCount(0);
  await expect(choices.getByRole("button", { name: /Anbefalt/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(choices.getByRole("button", { name: /Anbefalt/ })).toBeEnabled();

  const answerBox = travelAdvice.first();
  const routeMap = postSearchMap.first();
  const trafficNow = trafficPicture.getByText("Trafikkbildet nå", { exact: true }).first();
  await expect(answerBox).toBeVisible();
  await expect(routeMap).toBeVisible();
  await expect(trafficNow).toBeVisible();

  const answerTop = await answerBox.boundingBox();
  const mapTop = await routeMap.boundingBox();
  const trafficTop = await trafficNow.boundingBox();
  expect(answerTop?.y ?? 0).toBeLessThan(mapTop?.y ?? 0);
  expect(mapTop?.y ?? 0).toBeLessThan(trafficTop?.y ?? 0);
  const answerPresentation = await answerBox.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      borderLeftWidth: Number.parseFloat(styles.borderLeftWidth),
      paddingTop: Number.parseFloat(styles.paddingTop),
    };
  });
  expect(answerPresentation.borderLeftWidth).toBeGreaterThanOrEqual(4);
  expect(answerPresentation.paddingTop).toBeGreaterThanOrEqual(14);

  const adviceBox = await travelAdvice.boundingBox();
  const postSearchBox = await postSearchPanel.boundingBox();
  const choicesBox = await choices.boundingBox();
  const lineAlertDisclosureBox = await lineAlertDisclosure.boundingBox();
  const departureContextBox = await departureContext.boundingBox();
  const trafficPictureBox = await trafficPicture.boundingBox();
  const postSearchMapBox = await postSearchMap.boundingBox();
  const sourceDataBox = await sourceData.boundingBox();
  const documentY = async (locator: Locator) =>
    locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  for (const box of [
    postSearchBox,
    adviceBox,
    choicesBox,
    lineAlertDisclosureBox,
    departureContextBox,
    trafficPictureBox,
    postSearchMapBox,
    sourceDataBox,
  ]) {
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.width ?? Number.POSITIVE_INFINITY) + (box?.x ?? 0)).toBeLessThanOrEqual(391);
  }
  await expect.poll(() => documentY(travelAdvice)).toBeLessThan(await documentY(choices));
  await expect.poll(() => documentY(choices)).toBeLessThan(await documentY(postSearchMap));
  await expect
    .poll(() => documentY(postSearchMap))
    .toBeLessThan(await documentY(lineAlertDisclosure));
  await expect
    .poll(() => documentY(lineAlertDisclosure))
    .toBeLessThan(await documentY(departureContext));
  await expect
    .poll(() => documentY(departureContext))
    .toBeLessThan(await documentY(trafficPicture));
  await expect.poll(() => documentY(postSearchMap)).toBeLessThan(await documentY(sourceData));
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
    if (new URL(route.request().url()).pathname.endsWith("/departures")) {
      await route.fallback();
      return;
    }
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
  await page.goto("/vaer");
  await expect(page.getByRole("heading", { name: "Vær", level: 1 })).toBeVisible();
  const weather = await new AxeBuilder({ page }).analyze();
  expect(weather.violations).toEqual([]);
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

test("command center stays inside the phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/command");

  const heading = page.getByRole("heading", { name: "Kommandosenter" });
  await expect(heading).toBeVisible();
  const fontSize = await heading.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize),
  );
  expect(fontSize).toBeLessThanOrEqual(42);
  await expectNoHorizontalPageOverflow(page);
});

test("owner can open the real situation index and operations status", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Hovedmeny")
    .getByRole("link", { name: "Situasjonsrom", exact: true })
    .click();
  await expect(page).toHaveURL(/\/situasjoner$/);
  await expect(page.getByRole("heading", { name: "Trondheim situasjonskart" })).toBeVisible();
  const situationDetails = page.getByLabel("Situasjonsdetaljer");
  await expect(situationDetails.getByRole("link", { name: "Åpne arbeidsrom" })).toBeVisible();
  await expect(
    situationDetails.getByRole("link", { name: "Se i operasjonstidslinje" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Kommandosenter" }).click();
  await expect(page.getByRole("heading", { name: "Kommandosenter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Command Center-matrise" })).toBeVisible();
  const commandModules = page.getByLabel("Kommandosenter-moduler");
  await expect(commandModules.getByRole("button", { name: "Tilpass oppsett" })).toBeVisible();
  await expect(commandModules.getByLabel("Dashboard-oppsett")).toHaveCount(0);
  await commandModules.getByRole("button", { name: "Tilpass oppsett" }).click();
  await expect(commandModules.getByLabel("Dashboard-oppsett")).toBeVisible();
  await expect(commandModules.getByRole("button", { name: "Tilbakestill" })).toBeVisible();
  const sourceWidget = commandModules.locator(".dashboard-widget", {
    has: page.getByRole("heading", { name: "Kilder" }),
  });
  await expect(sourceWidget).toHaveClass(/dashboard-widget-large/);
  await commandModules.getByRole("button", { name: "Bytt modulstørrelse for Kilder" }).click();
  await expect(sourceWidget).toHaveClass(/dashboard-widget-full/);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("nytt-command-dashboard-v1")))
    .toContain('"sources":"full"');
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kommandosenter" })).toBeVisible();
  await expect(sourceWidget).toHaveClass(/dashboard-widget-full/);
  await commandModules.getByRole("button", { name: "Tilpass oppsett" }).click();
  await commandModules.getByRole("button", { name: "Tilbakestill" }).click();
  await expect(sourceWidget).toHaveClass(/dashboard-widget-large/);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("nytt-command-dashboard-v1")))
    .toContain('"sources":"large"');
  await expect(page.getByRole("link", { name: /Raw Data Inspector/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Push Notification Trigger/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intelligence Bridge" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Varselbro" })).toBeVisible();
  const intelligenceBridge = page.locator(".dashboard-widget", {
    has: page.getByRole("heading", { name: "Intelligence Bridge" }),
  });
  await expect(intelligenceBridge.getByText("Analysemodus")).toBeVisible();
  await expect(
    intelligenceBridge
      .getByText(/Provideranalyse brukt|Deterministisk reserve|Reserve uten lagret kjøring/)
      .first(),
  ).toBeVisible();
  await expect(
    intelligenceBridge.getByRole("link", { name: "Åpne brief-revisjon" }),
  ).toHaveAttribute("href", "/command/brief");
  const notificationBridge = page.locator(".dashboard-widget", {
    has: page.getByRole("heading", { name: "Varselbro" }),
  });
  await expect(
    notificationBridge.getByRole("link", { name: "Åpne varselutløsere" }),
  ).toHaveAttribute("href", "/command/varsler");
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
