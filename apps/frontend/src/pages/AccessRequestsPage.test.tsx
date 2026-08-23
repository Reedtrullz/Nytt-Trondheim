import type { AccessRequest, AppUser, UserPage } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccessRequestsDashboard } from "./AccessRequestsPage.js";

const pendingRequest: AccessRequest = {
  id: "request-1",
  displayName: "Kari Nordmann",
  email: "kari@example.test",
  message: "Vil ha lesetilgang til nyhetsdashbordet.",
  status: "pending",
  requestedAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
};

const approvedRequest: AccessRequest = {
  ...pendingRequest,
  id: "request-2",
  displayName: "Ola Nordmann",
  email: "ola@example.test",
  message: undefined,
  status: "approved",
  emailVerifiedAt: "2026-08-01T13:00:00.000Z",
  reviewedAt: "2026-08-01T14:00:00.000Z",
  reviewedBy: "Reidar",
};

const users: UserPage = {
  items: [
    {
      id: "user-owner",
      displayName: "Reidar",
      role: "owner",
      status: "active",
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
    },
    {
      id: "user-viewer",
      displayName: "Ola Nordmann",
      role: "viewer",
      status: "active",
      createdAt: "2026-08-01T14:00:00.000Z",
      updatedAt: "2026-08-01T15:00:00.000Z",
      lastLoginAt: "2026-08-02T09:00:00.000Z",
      email: "ola@example.test",
    },
  ] satisfies AppUser[],
  summary: { total: 2, owner: 1, viewer: 1, active: 1, revoked: 0 },
};

const page = {
  items: [pendingRequest, approvedRequest],
  summary: { total: 2, unverified: 0, pending: 1, approved: 1, rejected: 0 },
};

describe("AccessRequestsDashboard", () => {
  it("renders summary cards for each access state", () => {
    const html = renderToStaticMarkup(<AccessRequestsDashboard page={page} />);
    expect(html).toContain("Tilgangsoppsummering");
    expect(html).toContain("Ubekreftet");
    expect(html).toContain("Venter");
    expect(html).toContain("Godkjente lesere");
    expect(html).toContain("Avvist");
  });

  it("marks the active filter button with aria-pressed", () => {
    const html = renderToStaticMarkup(
      <AccessRequestsDashboard page={page} status="pending" onFilter={vi.fn()} />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Alle");
  });

  it("shows pending request rows with approve and reject actions", () => {
    const html = renderToStaticMarkup(<AccessRequestsDashboard page={page} onDecision={vi.fn()} />);
    expect(html).toContain("Kari Nordmann");
    expect(html).toContain("Godkjenn");
    expect(html).toContain("Avvis");
  });

  it("shows unverified hint text for unverified requests", () => {
    const unverifiedOnly = {
      items: [{ ...pendingRequest, id: "request-unverified", status: "unverified" as const }],
      summary: { total: 1, unverified: 1, pending: 0, approved: 0, rejected: 0 },
    };
    const html = renderToStaticMarkup(<AccessRequestsDashboard page={unverifiedOnly} />);
    expect(html).toContain("Venter på e-postbekreftelse før eier kan vurdere.");
  });

  it("renders DirectGrantForm fields", () => {
    const html = renderToStaticMarkup(
      <AccessRequestsDashboard page={page} onGrantAccess={vi.fn()} />,
    );
    expect(html).toContain("Gi tilgang uten forespørsel");
    expect(html).toContain('type="email"');
  });

  it("renders user admin list with viewer controls", () => {
    const html = renderToStaticMarkup(
      <AccessRequestsDashboard page={page} users={users} onUserUpdate={vi.fn()} />,
    );
    expect(html).toContain("Godkjente kontoer");
    expect(html).toContain("1 aktiv leser");
    expect(html).toContain("Tilbakekall");
    expect(html).toContain("Send lenke");
  });

  it("renders empty state when no requests match filter", () => {
    const emptyPage = {
      items: [],
      summary: { total: 0, unverified: 0, pending: 0, approved: 0, rejected: 0 },
    };
    const html = renderToStaticMarkup(<AccessRequestsDashboard page={emptyPage} />);
    expect(html).toContain("Ingen tilgangsforespørsler matcher filteret.");
  });
});
