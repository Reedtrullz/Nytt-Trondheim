import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AccessPage } from "./AccessPage.js";
import { AccessRequestsDashboard } from "./AccessRequestsPage.js";

describe("AccessPage", () => {
  it("renders GitHub login and access request form", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/logg-inn?auth=denied"]}>
        <AccessPage />
      </MemoryRouter>,
    );

    expect(html).toContain("Logg inn");
    expect(html).toContain("/auth/github");
    expect(html).toContain("GitHub-kontoen er ikke på tilgangslisten ennå.");
    expect(html).toContain("Send innloggingslenke");
    expect(html).toContain("Be om tilgang");
    expect(html).toContain("Hvorfor trenger du tilgang?");
  });
});

describe("AccessRequestsDashboard", () => {
  it("renders pending owner access requests", () => {
    const html = renderToStaticMarkup(
      <AccessRequestsDashboard
        page={{
          summary: { total: 1, unverified: 0, pending: 1, approved: 0, rejected: 0 },
          items: [
            {
              id: "request-one",
              displayName: "Ine Test",
              email: "ine@example.test",
              message: "Vil følge Trondheim-beredskap.",
              status: "pending",
              requestedAt: "2026-06-29T08:00:00.000Z",
              updatedAt: "2026-06-29T08:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Tilgangsforespørsler");
    expect(html).toContain("Gi tilgang uten forespørsel");
    expect(html).toContain("Gi tilgang");
    expect(html).toContain("Ine Test");
    expect(html).toContain("ine@example.test");
    expect(html).toContain("Vil følge Trondheim-beredskap.");
    expect(html).toContain("Venter");
  });
});
