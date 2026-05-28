import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

describe("frontend source item API helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function okResponse(body: unknown = {}) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("requests source item pages with filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ items: [], nextCursor: undefined }));
    vi.stubGlobal("fetch", fetchMock);

    await api.sourceItems({ provider: "nrk", kind: "article", unlinked: true, limit: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/source-items?provider=nrk&kind=article&unlinked=true&limit=5",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("encodes reserved characters in situation source item paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await api.situationSourceItems("incident/with spaces?#fragment");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/situations/incident%2Fwith%20spaces%3F%23fragment/source-items",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("encodes reserved characters in situation and source item link paths", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(
        okResponse({
          id: "nrk:item/with spaces?#fragment",
          provider: "nrk",
          kind: "article",
          fetchedAt: "2026-05-29T10:00:00.000Z",
          captureHash: "abc123",
          reliabilityTier: "trusted_media",
          linkedSituationIds: ["incident/with spaces?#fragment"],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.linkSourceItem(
      "incident/with spaces?#fragment",
      "nrk:item/with spaces?#fragment",
      "supports",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/situations/incident%2Fwith%20spaces%3F%23fragment/source-items/nrk%3Aitem%2Fwith%20spaces%3F%23fragment",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    );
  });
});
