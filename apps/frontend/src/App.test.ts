import { describe, expect, it, vi } from "vitest";
import type { BootstrapPayload, SessionPayload } from "@nytt/shared";
import { canRenderAuthenticatedRoutes, loadAuthenticatedShellData } from "./App.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("authenticated app shell loading", () => {
  it("starts session and bootstrap requests in parallel for a snappier first load", async () => {
    const session = deferred<SessionPayload>();
    const bootstrap = deferred<BootstrapPayload>();
    const client = {
      session: vi.fn(() => session.promise),
      bootstrap: vi.fn(() => bootstrap.promise),
    };

    const result = loadAuthenticatedShellData(client);

    expect(client.session).toHaveBeenCalledTimes(1);
    expect(client.bootstrap).toHaveBeenCalledTimes(1);

    const sessionPayload: SessionPayload = {
      user: {
        id: "owner-one",
        login: "owner",
        displayName: "Owner",
        role: "owner",
        status: "active",
      },
      csrfToken: "csrf-token",
    };
    const bootstrapPayload: BootstrapPayload = {
      articles: [],
      situations: [],
      sourceHealth: [],
    };
    session.resolve(sessionPayload);
    bootstrap.resolve(bootstrapPayload);

    await expect(result).resolves.toEqual({ sessionPayload, bootstrapPayload });
  });

  it("lets authenticated routes render without waiting for bootstrap data", () => {
    const sessionPayload: SessionPayload = {
      user: {
        id: "viewer-one",
        login: "viewer",
        displayName: "Viewer",
        role: "viewer",
        status: "active",
      },
      csrfToken: "csrf-token",
    };

    expect(
      canRenderAuthenticatedRoutes({
        session: sessionPayload,
        sessionLoading: false,
      }),
    ).toBe(true);
  });

  it("keeps authenticated routes closed while the session is unresolved or failed", () => {
    expect(
      canRenderAuthenticatedRoutes({
        sessionLoading: true,
      }),
    ).toBe(false);
    expect(
      canRenderAuthenticatedRoutes({
        session: {
          user: {
            id: "viewer-one",
            login: "viewer",
            displayName: "Viewer",
            role: "viewer",
            status: "active",
          },
          csrfToken: "csrf-token",
        },
        sessionLoading: false,
        sessionError: "Innlogging kreves",
      }),
    ).toBe(false);
  });
});
