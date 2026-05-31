import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { sampleWorkspace } from "@nytt/shared";

test("reader opens the active situation and keeps private map controls distinct", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Siste nytt i Trondheim" })).toBeVisible();
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
