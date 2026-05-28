import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

describe("frontend source item API helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests source item pages with filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: undefined }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.sourceItems({ provider: "nrk", kind: "article", unlinked: true, limit: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/source-items?provider=nrk&kind=article&unlinked=true&limit=5",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
