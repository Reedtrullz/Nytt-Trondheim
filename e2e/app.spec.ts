import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("Viser ressurser i området - ikke aktiv innsats")).toBeVisible();
  const sourceItemsPanel = page.locator(".source-items-panel");
  await expect(sourceItemsPanel.getByRole("heading", { name: "Kildegrunnlag" })).toBeVisible();
  await expect(
    sourceItemsPanel.getByText(/Ingen kildeelementer er koblet ennå|NRK|Adresseavisen|Vegvesen/),
  ).toBeVisible();
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
