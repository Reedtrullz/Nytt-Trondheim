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

  it("requests article pages with time-window bounds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ items: [], nextCursor: undefined }));
    vi.stubGlobal("fetch", fetchMock);

    await api.articles({
      scope: "trondheim",
      category: "Transport",
      from: "2026-07-02T08:00:00.000Z",
      to: "2026-07-02T10:00:00.000Z",
      limit: 20,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/articles?scope=trondheim&category=Transport&from=2026-07-02T08%3A00%3A00.000Z&to=2026-07-02T10%3A00%3A00.000Z&limit=20",
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

  it("requests coverage bundle operations with typed filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        items: [],
        summary: {
          recentBundleCount: 0,
          byKind: { incident: 0, topic: 0, update: 0 },
          byConfidence: { high: 0, medium: 0 },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.coverageBundles({
      kind: "incident",
      confidence: "high",
      q: "Flatåsen",
      cursor: "cursor:one",
      limit: 25,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operations/coverage-bundles?kind=incident&confidence=high&q=Flat%C3%A5sen&cursor=cursor%3Aone&limit=25",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests notification trigger candidates with typed filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        generatedAt: "2026-07-02T09:45:00.000Z",
        filters: {},
        items: [],
        summary: {
          total: 0,
          critical: 0,
          warning: 0,
          watch: 0,
          officialBacked: 0,
          highConfidence: 0,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.notificationTriggers({
      kinds: ["public_safety", "traffic_disruption"],
      severities: ["critical", "warning"],
      q: "røyk",
      limit: 20,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operations/notification-triggers?kinds=public_safety%2Ctraffic_disruption&severities=critical%2Cwarning&q=r%C3%B8yk&limit=20",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests notification settings and delivery history", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          configured: false,
          subscriptions: [],
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          generatedAt: "2026-07-02T09:45:00.000Z",
          items: [],
          summary: { total: 0, sent: 0, failed: 0, claimed: 0, skipped: 0 },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.notificationSettings();
    await api.notificationDeliveries(10);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/notifications/settings",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/operations/notification-deliveries?limit=10",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests command center spatial analytics with typed filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        generatedAt: "2026-07-02T09:45:00.000Z",
        window: {},
        summary: {
          heatmapCells: 0,
          observations: 0,
          unexplainedDelays: 0,
          criticalDelays: 0,
          bySourceConfidence: {
            confirmed: 0,
            likely: 0,
            uncertain: 0,
            speculative: 0,
          },
        },
        telemetryHistory: {
          datexTravelTime: {
            observations: 0,
            trackedEntities: 0,
            activeDayCount: 0,
            notableObservations: 0,
          },
          trafficCounters: {
            observations: 0,
            trackedEntities: 0,
            activeDayCount: 0,
            notableObservations: 0,
          },
        },
        telemetryPatterns: [],
        investigationQueue: [],
        heatmapCells: [],
        unexplainedDelays: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.spatialAnalytics({
      from: "2026-07-02T08:00:00.000Z",
      to: "2026-07-02T10:00:00.000Z",
      minDelaySeconds: 300,
      limit: 40,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operations/spatial-analytics?from=2026-07-02T08%3A00%3A00.000Z&to=2026-07-02T10%3A00%3A00.000Z&minDelaySeconds=300&limit=40",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests raw operations inspector data with typed filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ items: [], nextCursor: undefined }));
    vi.stubGlobal("fetch", fetchMock);

    await api.rawAiRuns({
      provider: "deepseek",
      status: "degraded",
      q: "truncated",
      cursor: "cursor:ai",
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operations/raw/ai-runs?provider=deepseek&status=degraded&q=truncated&cursor=cursor%3Aai&limit=10",
      expect.objectContaining({ credentials: "include" }),
    );

    fetchMock.mockResolvedValueOnce(
      okResponse({
        item: { id: "source:one" },
        rawPayload: {},
        normalizedPayload: {},
        payloadBytes: { raw: 2, normalized: 2 },
        redacted: false,
        truncated: false,
      }),
    );

    await api.rawSourceItem("source:one/two");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/operations/raw/source-items/source%3Aone%2Ftwo",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("submits public access requests without an authenticated CSRF lookup", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "received" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.requestAccess({
      displayName: "Ine Test",
      email: "ine@example.test",
      message: "Trenger tilgang uten GitHub.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/access-requests",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          displayName: "Ine Test",
          email: "ine@example.test",
          message: "Trenger tilgang uten GitHub.",
        }),
      }),
    );
  });

  it("requests owner access request pages with filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        items: [],
        summary: { total: 0, unverified: 0, pending: 0, approved: 0, rejected: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.accessRequests({ status: "pending", cursor: "cursor:one", limit: 25 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/access-requests?status=pending&cursor=cursor%3Aone&limit=25",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests email login links without authenticated CSRF lookup", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "received" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.requestEmailLogin({ email: "ine@example.test" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/email/request",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "ine@example.test" }),
      }),
    );
  });

  it("submits owner access decisions with CSRF protection", async () => {
    vi.resetModules();
    const { api: freshApi } = await import("./api.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(
        okResponse({
          id: "request-one",
          status: "approved",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await freshApi.decideAccessRequest("request one", { status: "approved" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/access-requests/request%20one",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
        body: JSON.stringify({ status: "approved" }),
      }),
    );
  });

  it("updates users through owner API helpers", async () => {
    vi.resetModules();
    const { api: freshApi } = await import("./api.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(okResponse({ id: "viewer-one", status: "revoked" }));
    vi.stubGlobal("fetch", fetchMock);

    await freshApi.updateUser("viewer one", { status: "revoked" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/users/viewer%20one",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
        body: JSON.stringify({ status: "revoked" }),
      }),
    );
  });

  it("grants users through the owner API helper", async () => {
    vi.resetModules();
    const { api: freshApi } = await import("./api.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(okResponse({ id: "viewer-one", status: "active" }));
    vi.stubGlobal("fetch", fetchMock);

    await freshApi.grantUserAccess({
      displayName: "Ine Viewer",
      email: "ine@example.test",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/users",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
        body: JSON.stringify({
          displayName: "Ine Viewer",
          email: "ine@example.test",
        }),
      }),
    );
  });

  it("manages push subscriptions with CSRF protection", async () => {
    vi.resetModules();
    const { api: freshApi } = await import("./api.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(okResponse({ id: "subscription-one", endpointHash: "hash" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await freshApi.subscribeToNotifications({
      endpoint: "https://push.example.test/send/secret",
      keys: {
        p256dh: "p256dh-key-material-that-is-long-enough",
        auth: "auth-key-long-enough",
      },
      minSeverity: "warning",
      kinds: [],
    });
    await freshApi.unsubscribeFromNotifications("subscription one");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/notifications/subscriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/notifications/subscriptions/subscription%20one",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
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
        body: JSON.stringify({ relationship: "supports" }),
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

  it("retries CSRF token lookup after a failed unsafe request setup", async () => {
    vi.resetModules();
    const { api: freshApi, ApiError: FreshApiError } = await import("./api.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "midlertidig feil" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(okResponse({ csrfToken: "fresh-csrf" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(freshApi.saveArticle("article-one", true)).rejects.toBeInstanceOf(FreshApiError);
    await freshApi.saveArticle("article-one", true);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/session",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/saved/articles/article-one",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "X-CSRF-Token": "fresh-csrf" }),
      }),
    );
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
