import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";
import { fetchPublicTransportMap } from "./api/publicTransportMap.js";

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

  it("requests the map-first situation workspace with typed filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        situations: [],
        mapState: { layers: ["situations"], sourceFilters: {} },
        timeline: [],
        privateAnnotations: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.situationMapWorkspace({
      statuses: ["preliminary", "active"],
      sources: ["nrk", "adressa"],
      provenances: ["official", "reporting_estimate"],
      confidenceLevels: ["confirmed"],
      includePrivateAnnotations: false,
      q: "Bymarka",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/situations/workspace-map?statuses=preliminary%2Cactive&sources=nrk%2Cadressa&provenances=official%2Creporting_estimate&confidenceLevels=confirmed&includePrivateAnnotations=false&q=Bymarka",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests the source audit workspace with typed filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        generatedAt: "2026-06-15T08:00:00.000Z",
        filters: {},
        sources: [],
        collectorRuns: [],
        alerts: [],
        contractChecks: [],
        traceability: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.sourceAudit({
      sources: ["datex", "entur"],
      groups: ["datex"],
      roles: ["telemetry_source"],
      healthStates: ["ok", "degraded"],
      freshnessStates: ["fresh", "stale"],
      contractStatuses: ["pass", "warn"],
      staleOnly: true,
      includeDiagnostics: true,
      q: "DATEX",
      limit: 25,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operations/source-audit?sources=datex%2Centur&groups=datex&roles=telemetry_source&healthStates=ok%2Cdegraded&freshnessStates=fresh%2Cstale&contractStatuses=pass%2Cwarn&staleOnly=true&includeDiagnostics=true&q=DATEX&limit=25",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests the operations timeline with typed filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        generatedAt: "2026-06-15T08:00:00.000Z",
        filters: {},
        events: [],
        summary: {
          total: 0,
          activeSituations: 0,
          staleWarnings: 0,
          collectorRuns: 0,
          reviewerActions: 0,
          privateEvents: 0,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.operationsTimeline({
      sources: ["nrk", "datex_travel_time"],
      kinds: ["source_update", "stale_warning"],
      roles: ["incident", "telemetry"],
      includePrivateAnnotations: false,
      q: "Bymarka",
      sort: "asc",
      limit: 25,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operations/timeline?sources=nrk%2Cdatex_travel_time&kinds=source_update%2Cstale_warning&roles=incident%2Ctelemetry&includePrivateAnnotations=false&q=Bymarka&sort=asc&limit=25",
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

  it("throws a friendly ApiError for 429 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "server wording should not leak here" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "42" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.bootstrap()).rejects.toMatchObject({
      name: "ApiError",
      status: 429,
      retryAfter: "42",
      message: "For mange forespørsler. Prøv igjen om litt.",
    });
  });

  it("preserves non-429 server errors with status metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Kilden er midlertidig utilgjengelig." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.bootstrap()).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: "Kilden er midlertidig utilgjengelig.",
    });
  });

  it("preserves public transport rate-limit status and retry metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "server wording should not leak here" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "30" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicTransportMap()).rejects.toMatchObject({
      name: "ApiError",
      status: 429,
      retryAfter: "30",
      message: "For mange forespørsler. Prøv igjen om litt.",
    });
  });
});
