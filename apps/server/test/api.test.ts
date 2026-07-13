import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import type { Response as SuperAgentResponse } from "superagent";
import { describe, expect, it, vi } from "vitest";
import { buildSituationExplanation, createApp } from "../src/app.js";
import { authorizeGitHubProfile } from "../src/auth.js";
import { safeFilename } from "../src/export.js";
import { loadConfig, type EmailMessage } from "../src/config.js";
import { CoverageBundleConflictError, PgStore, type Store } from "../src/store.js";
import { sampleSituation } from "@nytt/shared";
import type {
  Article,
  OfficialEvent,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  RoadCamera,
  RoadWeatherObservation,
  Situation,
  MorningBrief,
  SourceCollectorRun,
  SourceHealth,
  SourceItem,
  TrafficCounterSnapshot,
  TrafficMapEvent,
  TrafficPulseCorridor,
  CoverageBundleSplitRequest,
} from "@nytt/shared";

const execFileAsync = promisify(execFile);
const privateAnalysisWarning =
  "Private analyser er ikke offentlig verifisert og må ikke leses som operativ sannhet.";

function parseBinaryResponse(
  response: SuperAgentResponse,
  callback: (error: Error | null, body?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.on("error", (error) => callback(error));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
}

async function testApp() {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: true,
  });
  return { ...runtime, uploadDir };
}

function coverageSplitInput(): CoverageBundleSplitRequest {
  return {
    expectedGeneratedAt: "2026-07-12T21:00:00.000Z",
    anchorArticleId: "speed-a",
    rejectedArticleIds: ["threat"],
    reason: "Ulik hendelse",
  };
}

async function ownerAgentWithCoverageCorrections(
  enabled: boolean,
  coverageProjectionMode?: "legacy" | "normalized-shadow" | "normalized-active",
) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-coverage-corrections-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: false,
    coverageCorrectionsEnabled: enabled,
    coverageProjectionMode,
  });
  const agent = request.agent(runtime.app);
  const session = await agent.get("/api/session").expect(200);
  return {
    ...runtime,
    agent,
    csrf: session.body.csrfToken as string,
    capabilities: session.body.capabilities as { coverageCorrections: boolean },
  };
}

async function ownerAgentWithE2ECoverageFixtures() {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-e2e-coverage-fixtures-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: false,
    coverageCorrectionsEnabled: true,
    coverageProjectionMode: "normalized-active",
    e2eCoverageFixtures: true,
  });
  const agent = request.agent(runtime.app);
  const session = await agent.get("/api/session").expect(200);
  await agent
    .post("/api/__e2e/coverage/reset")
    .set("X-CSRF-Token", session.body.csrfToken as string)
    .expect(200);
  return { ...runtime, agent, csrf: session.body.csrfToken as string };
}

async function testAppWithRateLimit(rateLimitEnabled: boolean) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled,
  });
  return { ...runtime, uploadDir };
}

async function testAppWithPushPublicKey(publicKey = "test-public-vapid-key") {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: true,
    webPushPublicKey: publicKey,
    webPushConfigured: true,
  });
  return { ...runtime, uploadDir };
}

async function testAppWithEmail(devAuthBypass = true, coverageCorrectionsEnabled = false) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
  const sentEmails: EmailMessage[] = [];
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass,
    githubClientId: devAuthBypass ? undefined : "test-client",
    githubClientSecret: devAuthBypass ? undefined : "test-secret",
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: true,
    coverageCorrectionsEnabled,
    emailSender: {
      async send(message) {
        sentEmails.push(message);
      },
    },
  });
  return { ...runtime, uploadDir, sentEmails };
}

function tokenFromEmail(
  message: EmailMessage,
  route: "/auth/access/verify" | "/auth/email/callback",
) {
  const match = message.text.match(
    new RegExp(`http://localhost${route.replace("/", "\\/")}\\?token=([^\\s]+)`),
  );
  if (!match?.[1]) throw new Error(`Missing ${route} token in email: ${message.text}`);
  return decodeURIComponent(match[1]);
}

function withEnvValue<T>(key: string, value: string | undefined, run: () => T): T {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

async function ownerAgent() {
  const { app } = await testApp();
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

async function loginViewer(runtime: Awaited<ReturnType<typeof testAppWithEmail>>) {
  const grant = await runtime.store.grantUserAccess(
    {
      displayName: "Timeline Viewer",
      email: "timeline-viewer@example.test",
    },
    "owner",
  );
  const agent = request.agent(runtime.app);
  await confirmEmailLogin(agent, grant.invite.token);
  return agent;
}

async function confirmEmailLogin(agent: ReturnType<typeof request.agent>, token: string) {
  const confirmation = await agent
    .get(`/auth/email/callback?token=${encodeURIComponent(token)}`)
    .expect(200)
    .expect("Cache-Control", /no-store/);
  const csrf = confirmation.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
  expect(csrf).toBeDefined();
  await agent
    .post("/auth/email/callback")
    .set("Origin", "http://localhost")
    .type("form")
    .send({ token, _csrf: csrf })
    .expect(302)
    .expect("Location", "/");
}

function addMemorySituation(store: Store, situation: Situation): void {
  const memoryStore = store as unknown as { situations?: Map<string, Situation> };
  if (!memoryStore.situations) {
    throw new Error("Expected MemoryStore-backed test runtime.");
  }
  memoryStore.situations.set(situation.id, structuredClone(situation));
}

describe("private situation API", () => {
  it("serves live and ready health endpoints before the SPA fallback", async () => {
    const { app } = await testApp();

    const live = await request(app).get("/health/live").expect(200);
    expect(live.type).toContain("json");
    expect(live.body).toMatchObject({
      status: "ok",
      storage: "development-memory",
    });

    const ready = await request(app).get("/health/ready").expect(200);
    expect(ready.type).toContain("json");
    expect(ready.body).toMatchObject({
      status: "ok",
      storage: "development-memory",
      coverageProjectionMode: "legacy",
    });
  });

  it("fails readiness closed in normalized-active mode without a completed current v2 generation", async () => {
    const runtime = await ownerAgentWithCoverageCorrections(false, "normalized-active");

    await runtime.agent.get("/health/live").expect(200);
    await runtime.agent.get("/health/ready").expect(503, {
      status: "degraded",
      storage: "development-memory",
      coverageProjectionMode: "normalized-active",
    });
  });

  it("keeps normalized-active readiness healthy after an effective correction changes membership", async () => {
    const runtime = await ownerAgentWithE2ECoverageFixtures();
    const page = await runtime.agent
      .get("/api/operations/coverage-bundles?projection=active")
      .expect(200);
    const bundle = page.body.items.find((item: { memberArticleIds: string[] }) =>
      item.memberArticleIds.includes("e2e-correctable-main"),
    );

    await runtime.agent
      .post(`/api/coverage-bundles/${encodeURIComponent(bundle.id)}/corrections/split`)
      .set("X-CSRF-Token", runtime.csrf)
      .send({
        expectedGeneratedAt: bundle.generatedAt,
        anchorArticleId: "e2e-correctable-main",
        rejectedArticleIds: ["e2e-correctable-rejectable"],
        reason: "Separat hendelse",
      })
      .expect(200);

    const ready = await runtime.agent.get("/health/ready").expect(200);
    expect(ready.body.coverageProjectionMode).toBe("normalized-active");
  });

  it("returns a non-cacheable 404 for missing frontend assets", async () => {
    const { app } = await testApp();

    const response = await request(app).get("/assets/nonexistent-probe.js").expect(404);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toBe("Fant ikke ressursen");
  });

  it("defaults rate limiting on unless RATE_LIMIT_ENABLED explicitly disables it", () => {
    expect(withEnvValue("RATE_LIMIT_ENABLED", undefined, () => loadConfig().rateLimitEnabled)).toBe(
      true,
    );
    expect(withEnvValue("RATE_LIMIT_ENABLED", "false", () => loadConfig().rateLimitEnabled)).toBe(
      false,
    );
  });

  it("treats Web Push as configured only when both VAPID keys exist", () => {
    withEnvValue("WEB_PUSH_VAPID_PRIVATE_KEY", undefined, () => {
      expect(
        withEnvValue(
          "WEB_PUSH_VAPID_PUBLIC_KEY",
          "public-key",
          () => loadConfig().webPushConfigured,
        ),
      ).toBe(false);
    });
    withEnvValue("WEB_PUSH_VAPID_PRIVATE_KEY", "private-key", () => {
      expect(
        withEnvValue(
          "WEB_PUSH_VAPID_PUBLIC_KEY",
          "public-key",
          () => loadConfig().webPushConfigured,
        ),
      ).toBe(true);
    });
  });

  it("can disable API rate limiting through config", async () => {
    const { app } = await testAppWithRateLimit(false);
    const agent = request.agent(app);

    for (let attempt = 0; attempt < 130; attempt += 1) {
      await agent.get("/api/session").expect(200);
    }
  });

  it("enforces API rate limiting when config enables it", async () => {
    const { app } = await testAppWithRateLimit(true);
    const agent = request.agent(app);

    let lastStatus = 0;
    for (let attempt = 0; attempt < 130; attempt += 1) {
      const response = await agent.get("/api/session");
      lastStatus = response.status;
      if (response.status === 429) {
        expect(response.headers["retry-after"]).toBeTruthy();
        expect(response.body.error).toContain("For mange forespørsler");
        return;
      }
    }
    throw new Error(`expected a 429 before loop finished, last status was ${lastStatus}`);
  });

  it("keeps bootstrap situations as lean frontpage summaries", async () => {
    const { app } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const response = await agent.get("/api/bootstrap").expect(200);

    expect(response.body.articles.length).toBeGreaterThan(0);
    expect(response.body.sourceHealth.length).toBeGreaterThan(0);
    expect(response.body.situations.length).toBeGreaterThan(0);
    expect(response.body.morningBrief).toBeUndefined();
    expect(response.body.stories.length).toBeLessThanOrEqual(20);
    expect(response.body.storyProjection).toEqual({
      mode: "legacy",
      matcherVersion: "v1",
      parityClean: true,
      fallbackReason: "disabled",
    });
    expect(response.body.situations.length).toBeLessThanOrEqual(3);
    for (const situation of response.body.situations as Array<Record<string, unknown>>) {
      expect(["preliminary", "active"]).toContain(situation.status);
      expect(situation).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          summary: expect.any(String),
          status: expect.any(String),
          verificationStatus: expect.any(String),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          locationLabel: expect.any(String),
        }),
      );
      expect(situation.primaryLocation).toEqual(
        expect.objectContaining({
          lat: expect.any(Number),
          lng: expect.any(Number),
          label: expect.any(String),
        }),
      );
      expect(situation).not.toHaveProperty("evidence");
      expect(situation).not.toHaveProperty("features");
      expect(situation).not.toHaveProperty("timeline");
      expect(situation).not.toHaveProperty("relatedArticleIds");
      expect(situation).not.toHaveProperty("activationBasis");
      expect(situation).not.toHaveProperty("provenanceSummary");
      expect(situation.sourceConfidence).toEqual(
        expect.objectContaining({
          level: expect.any(String),
          label: expect.any(String),
          score: expect.any(Number),
          sourceCount: expect.any(Number),
        }),
      );
    }
  });

  it("keeps PgStore bootstrap lean for the public first screen", async () => {
    const article: Article = {
      id: "article-one",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Kø på E6 ved Sluppen",
      excerpt: "Trafikken går sakte ved Sluppen.",
      url: "https://example.test/article-one",
      publishedAt: "2026-07-02T07:20:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["Sluppen", "Trondheim"],
    };
    const captured: string[] = [];
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        captured.push(normalizedSql);
        if (normalizedSql.includes("FROM articles a LEFT JOIN saved_articles")) {
          expect(params?.slice(0, 2)).toEqual(["Reedtrullz", "trondheim"]);
          expect(params?.[2]).toBe(81);
          return { rows: [{ payload: article, saved: false }] };
        }
        if (normalizedSql.includes("FROM situations WHERE status IN")) {
          return { rows: [{ payload: sampleSituation }] };
        }
        if (normalizedSql.includes("FROM source_health")) {
          return {
            rows: [
              {
                source: "nrk",
                label: "NRK Trøndelag",
                state: "ok",
                detail: "RSS",
              } satisfies SourceHealth,
            ],
          };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };

    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
    const bootstrap = await store.getBootstrap("Reedtrullz");

    expect(bootstrap.articles).toEqual([{ ...article, saved: false }]);
    expect(bootstrap.storyProjection).toEqual({
      mode: "legacy",
      matcherVersion: "v1",
      parityClean: true,
      fallbackReason: "disabled",
    });
    expect(bootstrap.situations).toEqual([
      expect.objectContaining({
        id: sampleSituation.id,
        sourceConfidence: expect.objectContaining({
          level: "likely",
          label: "Sannsynlig",
        }),
        primaryLocation: expect.objectContaining({
          lat: expect.any(Number),
          lng: expect.any(Number),
          label: expect.any(String),
        }),
      }),
    ]);
    expect(bootstrap.morningBrief).toBeUndefined();
    expect(captured.some((sql) => sql.includes("FROM morning_briefs"))).toBe(false);
    expect(captured.some((sql) => sql.includes("FROM ai_processing_runs"))).toBe(false);
    const homeSituationSql = captured.find(
      (sql) =>
        sql.includes("FROM situations WHERE status IN") &&
        sql.includes("ORDER BY updated_at DESC, id DESC"),
    );
    expect(homeSituationSql).toContain("payload->>'createdAt' < $1");
    expect(homeSituationSql).toContain("LIMIT $2");
  });

  it("sanitizes stored morning briefs for command-center briefing", async () => {
    const article: Article = {
      id: "article-one",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Leteaksjon etter savnet mann i Meråker",
      excerpt: "Politiet søker med letemannskap ved Funnsjøen.",
      url: "https://example.test/article-one",
      publishedAt: "2026-07-04T09:35:00.000Z",
      scope: "trondelag",
      category: "Hendelser",
      places: ["Meråker"],
    };
    const storedBrief: MorningBrief = {
      generatedAt: "2026-07-04T09:45:00.000Z",
      title: "Morgenbrief",
      mode: "deterministic",
      sourceLine: "Automatisk analyse",
      paragraphs: [
        "Pågående situasjon: Gangåsvegen er fortsatt stengt.",
        "Fersk leteaksjon følges i nyhetsbildet.",
        "Frustrasjonen over køen er forståelig.",
        "Skreddersydd pendlerinfo er ikke en faresak.",
        "Kildebildet oppdateres fortløpende.",
      ],
      highlights: [
        { label: "Saker", value: "1", detail: "Hendelser leder bildet" },
        { label: "Situasjoner", value: "1", detail: "Aktive eller til vurdering" },
      ],
      articleIds: [article.id],
      situationIds: ["old-road"],
    };
    const captured: string[] = [];
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        captured.push(normalizedSql);
        if (normalizedSql.includes("FROM articles a LEFT JOIN saved_articles")) {
          expect(params?.slice(0, 2)).toEqual(["Reedtrullz", "trondheim"]);
          return { rows: [{ payload: article, saved: false }] };
        }
        if (normalizedSql.includes("SELECT payload FROM articles WHERE id = ANY")) {
          expect(params).toEqual([[article.id]]);
          return { rows: [{ payload: article }] };
        }
        if (normalizedSql.includes("FROM situations WHERE status IN")) {
          return { rows: [] };
        }
        if (normalizedSql.includes("FROM source_health")) {
          return { rows: [] };
        }
        if (normalizedSql.includes("FROM morning_briefs")) {
          return { rows: [{ payload: storedBrief }] };
        }
        if (normalizedSql.includes("FROM ai_processing_runs")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };

    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
    const briefing = await store.getCommandCenterBriefing("Reedtrullz");

    expect(briefing.supportingSituations).toEqual([]);
    expect(briefing.supportingArticles).toEqual([
      expect.objectContaining({ id: article.id, title: article.title }),
    ]);
    expect(briefing.morningBrief).toMatchObject({
      situationIds: [],
      highlights: expect.arrayContaining([
        expect.objectContaining({
          label: "Situasjoner",
          value: "0",
          detail: "Ingen ferske høyeffekt-situasjoner i offentlig toppbilde",
        }),
      ]),
      paragraphs: [
        "Ingen ferske høyeffekt-situasjoner dominerer toppbildet akkurat nå.",
        "Fersk leteaksjon følges i nyhetsbildet.",
        "Frustrasjonen over køen er forståelig.",
        "Skreddersydd pendlerinfo er ikke en faresak.",
        "Kildebildet oppdateres fortløpende.",
      ],
    });
    expect(
      captured.some(
        (sql) =>
          sql.includes("FROM situations WHERE status IN") &&
          sql.includes("payload->>'createdAt' < $1") &&
          sql.includes("LIMIT $2"),
      ),
    ).toBe(true);
  });

  it("keeps surviving situation brief paragraphs in command-center briefing", async () => {
    const storedBrief: MorningBrief = {
      generatedAt: "2026-07-04T09:45:00.000Z",
      title: "Morgenbrief",
      mode: "deterministic",
      sourceLine: "Automatisk analyse",
      paragraphs: [
        "Pågående situasjon: Gangåsvegen er fortsatt stengt.",
        "Situasjonsrommet følger fersk leteaksjon i Meråker.",
        "Kildebildet oppdateres fortløpende.",
      ],
      highlights: [
        { label: "Saker", value: "1", detail: "Hendelser leder bildet" },
        { label: "Situasjoner", value: "2", detail: "Aktive eller til vurdering" },
      ],
      articleIds: [],
      situationIds: ["old-road", "missing-person"],
    };
    const missingPersonSummary = {
      ...sampleSituation,
      id: "missing-person",
      type: "missing_person",
      title: "Leteaksjon etter savnet mann i Meråker",
      summary: "Politiet søker med letemannskap og redningshelikopter.",
      status: "active",
      verificationStatus: "Foreløpig fra rapportering",
      createdAt: "2026-07-04T08:45:00.000Z",
      updatedAt: "2026-07-04T09:40:00.000Z",
      locationLabel: "Funnsjøen",
    };
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        if (normalizedSql.includes("FROM articles a LEFT JOIN saved_articles")) {
          return { rows: [] };
        }
        if (normalizedSql.includes("FROM situations WHERE status IN")) {
          return { rows: [{ payload: missingPersonSummary }] };
        }
        if (normalizedSql.includes("SELECT payload FROM situations WHERE id = ANY")) {
          expect(params).toEqual([["missing-person"]]);
          return { rows: [{ payload: missingPersonSummary }] };
        }
        if (normalizedSql.includes("FROM source_health")) {
          return { rows: [] };
        }
        if (normalizedSql.includes("FROM morning_briefs")) {
          return { rows: [{ payload: storedBrief }] };
        }
        if (normalizedSql.includes("FROM ai_processing_runs")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };

    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
    const briefing = await store.getCommandCenterBriefing("Reedtrullz");

    expect(briefing.morningBrief).toMatchObject({
      situationIds: ["missing-person"],
      highlights: expect.arrayContaining([
        expect.objectContaining({
          label: "Situasjoner",
          value: "1",
          detail: "Aktive eller til vurdering",
        }),
      ]),
      paragraphs: [
        "Ingen ferske høyeffekt-situasjoner dominerer toppbildet akkurat nå.",
        "Situasjonsrommet følger fersk leteaksjon i Meråker.",
        "Kildebildet oppdateres fortløpende.",
      ],
    });
    expect(briefing.supportingSituations).toEqual([
      expect.objectContaining({
        id: "missing-person",
        title: "Leteaksjon etter savnet mann i Meråker",
      }),
    ]);
  });

  it("accepts only the configured GitHub owner account", () => {
    expect(
      authorizeGitHubProfile({ username: "someone-else", displayName: "Other" }, "Reedtrullz"),
    ).toBe(false);
    expect(
      authorizeGitHubProfile({ username: "Reedtrullz", displayName: "Reidar" }, "Reedtrullz"),
    ).toMatchObject({ login: "Reedtrullz" });
  });

  it("rejects incident data requests without an authenticated owner session", async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
    const { app } = await createApp({
      port: 0,
      nodeEnv: "development",
      publicOrigin: "http://localhost",
      seedDemo: true,
      devAuthBypass: false,
      githubClientId: "test-client",
      githubClientSecret: "test-secret",
      githubAllowedLogin: "Reedtrullz",
      sessionSecret: "test-only-secret",
      uploadDir,
      runtimeStatusDir: uploadDir,
      rateLimitEnabled: true,
    });
    await request(app).get("/api/bootstrap").expect(401);
    await request(app).get("/api/notifications/settings").expect(401);
    await request(app).get("/api/operations/coverage-bundles").expect(401);
    await request(app).get("/api/operations/notification-triggers").expect(401);
    await request(app).get("/api/operations/notification-deliveries").expect(401);
    await request(app).get("/api/operations/spatial-analytics").expect(401);
    await request(app).get("/api/operations/raw/ai-runs").expect(401);
    await request(app).get("/api/access-requests").expect(401);
    await request(app)
      .post("/api/access-requests")
      .send({
        displayName: "Ine Test",
        email: "ine@example.test",
        message: "Vil følge Trondheim-beredskap uten GitHub.",
      })
      .expect(202)
      .expect({ status: "received" });
  });

  it("stores public access requests as unverified until email confirmation", async () => {
    const { app, store, sentEmails } = await testAppWithEmail();
    await request(app)
      .post("/api/access-requests")
      .send({
        displayName: "Første Navn",
        email: "Person@Example.test",
        message: "Første melding.",
      })
      .expect(202);
    expect(sentEmails).toHaveLength(1);
    await request(app)
      .post("/api/access-requests")
      .send({
        displayName: "Oppdatert Navn",
        email: "person@example.test",
        message: "Oppdatert melding.",
      })
      .expect(202);
    expect(sentEmails).toHaveLength(2);
    await request(app)
      .post("/api/access-requests")
      .send({
        displayName: "Spam",
        email: "spam@example.test",
        website: "https://bot.example",
      })
      .expect(400);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    await agent
      .get("/api/access-requests")
      .expect(200)
      .expect((response) => {
        expect(response.body.summary).toMatchObject({ total: 1, unverified: 1, pending: 0 });
        expect(response.body.items).toHaveLength(1);
        expect(response.body.items[0]).toMatchObject({
          displayName: "Oppdatert Navn",
          email: "person@example.test",
          message: "Oppdatert melding.",
          status: "unverified",
        });
        expect(response.body.items[0].emailVerifiedAt).toBeUndefined();
      });
    const unverified = await store.listAccessRequests({ status: "unverified", limit: 10 }, "owner");
    await expect(
      store.decideAccessRequest(unverified.items[0]!.id, { status: "approved" }, "owner"),
    ).rejects.toThrow(/E-post må verifiseres/);
  });

  it("keeps public email endpoints generic when email delivery fails", async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
    const runtime = await createApp({
      port: 0,
      nodeEnv: "development",
      publicOrigin: "http://localhost",
      seedDemo: true,
      devAuthBypass: true,
      githubAllowedLogin: "Reedtrullz",
      sessionSecret: "test-only-secret",
      uploadDir,
      runtimeStatusDir: uploadDir,
      rateLimitEnabled: true,
      emailSender: {
        async send() {
          throw new Error("SMTP rejected sender domain");
        },
      },
    });

    await request(runtime.app)
      .post("/api/access-requests")
      .send({
        displayName: "Ine Test",
        email: "ine-delivery-fail@example.test",
        message: "Vil følge Trondheim-beredskap uten GitHub.",
      })
      .expect(202)
      .expect({ status: "received" });

    await request(runtime.app)
      .post("/auth/email/request")
      .send({ email: "ine-delivery-fail@example.test" })
      .expect(202)
      .expect({ status: "received" });
  });

  it("verifies access requests, lets the owner approve, and logs in approved viewers by email", async () => {
    const { app, store, sentEmails } = await testAppWithEmail(false);

    await request(app)
      .post("/api/access-requests")
      .send({
        displayName: "Ine Viewer",
        email: "viewer@example.test",
        message: "Vil lese Trondheim-nyheter.",
      })
      .expect(202)
      .expect({ status: "received" });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.subject).toContain("Bekreft");
    const verifyToken = tokenFromEmail(sentEmails[0]!, "/auth/access/verify");

    await request(app)
      .get(`/auth/access/verify?token=${encodeURIComponent(verifyToken)}`)
      .expect(302)
      .expect("Location", "/logg-inn?access=verified");
    await request(app)
      .get(`/auth/access/verify?token=${encodeURIComponent(verifyToken)}`)
      .expect(302)
      .expect("Location", "/logg-inn?access=invalid");

    const pending = await store.listAccessRequests({ status: "pending", limit: 10 }, "owner");
    expect(pending.items).toHaveLength(1);
    const decision = await store.decideAccessRequest(
      pending.items[0]!.id,
      { status: "approved" },
      "owner",
    );
    expect(decision.request.status).toBe("approved");
    expect(decision.invite).toBeDefined();

    const viewerAgent = request.agent(app);
    const confirmationUrl = `/auth/email/callback?token=${encodeURIComponent(
      decision.invite!.token,
    )}`;
    await viewerAgent
      .get(confirmationUrl)
      .expect(200)
      .expect("Cache-Control", /no-store/);
    await viewerAgent.get("/api/session").expect(401);
    await viewerAgent.get(confirmationUrl).expect(200);
    await confirmEmailLogin(viewerAgent, decision.invite!.token);
    const session = await viewerAgent.get("/api/session").expect(200);
    expect(session.body.user).toMatchObject({
      email: "viewer@example.test",
      role: "viewer",
      status: "active",
    });
    expect(session.body.capabilities).toEqual({ coverageCorrections: false });
    await viewerAgent.get("/api/bootstrap").expect(200);
    await viewerAgent.get("/api/situations/skogbrann-bymarka").expect(200);
    await viewerAgent.get("/api/operations/status").expect(403);
    await viewerAgent.get("/api/saved/articles").expect(403);
    await viewerAgent.get("/api/source-items?limit=1").expect(403);
    await viewerAgent.get("/api/situations/skogbrann-bymarka/source-items").expect(403);
    await viewerAgent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .expect(403);

    const replayAgent = request.agent(app);
    const replayConfirmation = await replayAgent.get(confirmationUrl).expect(200);
    const replayCsrf = replayConfirmation.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await replayAgent
      .post("/auth/email/callback")
      .set("Origin", "http://localhost")
      .type("form")
      .send({ token: decision.invite!.token, _csrf: replayCsrf })
      .expect(302)
      .expect("Location", "/logg-inn?email=invalid");
    await replayAgent.get("/api/session").expect(401);
  });

  it("keeps private timeline entries out of viewer situation endpoints", async () => {
    const publicEntry = {
      id: "timeline-public",
      situationId: sampleSituation.id,
      timestamp: "2026-06-15T07:00:00.000Z",
      kind: "source_update",
      title: "Offentlig oppdatering",
      detail: "Kan vises for lesere.",
      sourceLabel: "NRK Trøndelag",
      source: "nrk",
      sourceUrl: "https://example.test/public",
      official: false,
    } satisfies Situation["timeline"][number];
    const privateAnnotationEntry = {
      id: "timeline-private-annotation",
      situationId: sampleSituation.id,
      timestamp: "2026-06-15T07:05:00.000Z",
      kind: "private_annotation",
      title: "Privat kartmarkering",
      detail: "Intern observasjon for Command Center.",
      sourceLabel: "Privat markering",
      source: "private_annotations",
      sourceUrl: "",
      official: false,
      provenance: "private_annotation",
      privateAnnotationId: "annotation-one",
    } satisfies Situation["timeline"][number];
    const privateReviewEntry = {
      id: "timeline-private-review",
      situationId: sampleSituation.id,
      timestamp: "2026-06-15T07:10:00.000Z",
      kind: "review_action",
      title: "Privat vurdering",
      detail: "Intern vurdering som ikke skal til City Pulse.",
      sourceLabel: "Privat markering",
      source: "private_annotations",
      sourceUrl: "",
      official: false,
      provenance: "private_annotation",
    } satisfies Situation["timeline"][number];
    const privateKindOnlyEntry = {
      id: "timeline-private-kind-only",
      situationId: sampleSituation.id,
      timestamp: "2026-06-15T07:15:00.000Z",
      kind: "private_annotation",
      title: "Privat uten eksplisitt proveniens",
      detail: "Intern kind-only observasjon.",
      sourceLabel: "Privat markering",
      sourceUrl: "",
      official: false,
    } satisfies Situation["timeline"][number];
    const privateIdOnlyEntry = {
      id: "timeline-private-id-only",
      situationId: sampleSituation.id,
      timestamp: "2026-06-15T07:20:00.000Z",
      kind: "review_action",
      title: "Privat koblet markering",
      detail: "Intern privateAnnotationId-observasjon.",
      sourceLabel: "Privat markering",
      sourceUrl: "",
      official: false,
      privateAnnotationId: "annotation-two",
    } satisfies Situation["timeline"][number];
    const situation = {
      ...sampleSituation,
      timeline: [
        publicEntry,
        privateAnnotationEntry,
        privateReviewEntry,
        privateKindOnlyEntry,
        privateIdOnlyEntry,
      ],
    } satisfies Situation;
    const workspace = {
      situation,
      relatedArticles: [],
      tasks: [],
      notes: [],
      attachments: [],
    };

    const ownerRuntime = await testApp();
    vi.spyOn(ownerRuntime.store, "getWorkspace").mockResolvedValue(workspace);
    const owner = request.agent(ownerRuntime.app);
    await owner.get("/api/session").expect(200);
    await owner
      .get(`/api/situations/${sampleSituation.id}/timeline`)
      .expect(200)
      .expect((response) => {
        expect(response.body.map((entry: { id: string }) => entry.id)).toEqual([
          "timeline-public",
          "timeline-private-annotation",
          "timeline-private-review",
          "timeline-private-kind-only",
          "timeline-private-id-only",
        ]);
      });

    const viewerRuntime = await testAppWithEmail(false);
    vi.spyOn(viewerRuntime.store, "getWorkspace").mockResolvedValue(workspace);
    const viewer = await loginViewer(viewerRuntime);
    await viewer
      .get(`/api/situations/${sampleSituation.id}/timeline`)
      .expect(200)
      .expect((response) => {
        expect(response.body.map((entry: { id: string }) => entry.id)).toEqual(["timeline-public"]);
        expect(JSON.stringify(response.body)).not.toContain("Intern observasjon");
        expect(JSON.stringify(response.body)).not.toContain("Intern vurdering");
      });
    await viewer
      .get(`/api/situations/${sampleSituation.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.situation.timeline.map((entry: { id: string }) => entry.id)).toEqual([
          "timeline-public",
        ]);
      });
    await viewer
      .get("/api/situations/workspace-map")
      .expect(200)
      .expect((response) => {
        expect(response.body.timeline.map((entry: { id: string }) => entry.id)).toEqual([
          "timeline-public",
        ]);
        expect(JSON.stringify(response.body)).not.toContain("kind-only observasjon");
        expect(JSON.stringify(response.body)).not.toContain("privateAnnotationId-observasjon");
      });
  });

  it("keeps command-center-only situations out of City Pulse viewer surfaces", async () => {
    const commandOnlySituation = {
      ...sampleSituation,
      id: "command-only-ras",
      title: "Intern vurdering av rasfare",
      summary: "Kun for Command Center inntil publisering er besluttet.",
      publicVisibility: "command_center",
      updatedAt: "2026-07-03T03:50:00.000Z",
      createdAt: "2026-07-03T03:30:00.000Z",
      relatedArticleIds: [],
      timeline: [
        {
          id: "command-only-timeline",
          situationId: "command-only-ras",
          timestamp: "2026-07-03T03:45:00.000Z",
          kind: "review_action",
          title: "Intern vurdering",
          detail: "Skal ikke vises på City Pulse.",
          sourceLabel: "Privat markering",
          source: "private_annotations",
          sourceUrl: "",
          official: false,
          provenance: "private_annotation",
        },
      ],
    } satisfies Situation;

    const ownerRuntime = await testApp();
    addMemorySituation(ownerRuntime.store, commandOnlySituation);
    const owner = request.agent(ownerRuntime.app);
    await owner.get("/api/session").expect(200);
    await owner
      .get("/api/situations")
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "command-only-ras" })]),
        );
      });
    await owner
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.situations).toEqual(
          expect.not.arrayContaining([expect.objectContaining({ id: "command-only-ras" })]),
        );
      });
    await owner
      .get("/api/situations/workspace-map?publicVisibility=command_center")
      .expect(200)
      .expect((response) => {
        expect(response.body.situations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "command-only-ras",
              publicVisibility: "command_center",
            }),
          ]),
        );
        expect(response.body.situations).toEqual(
          expect.not.arrayContaining([expect.objectContaining({ publicVisibility: "public" })]),
        );
      });

    const viewerRuntime = await testAppWithEmail(false);
    addMemorySituation(viewerRuntime.store, commandOnlySituation);
    const viewer = await loginViewer(viewerRuntime);
    await viewer
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.situations).toEqual(
          expect.not.arrayContaining([expect.objectContaining({ id: "command-only-ras" })]),
        );
      });
    await viewer
      .get("/api/situations")
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toEqual(
          expect.not.arrayContaining([expect.objectContaining({ id: "command-only-ras" })]),
        );
      });
    await viewer.get("/api/situations/command-only-ras").expect(404);
    await viewer.get("/api/situations/command-only-ras/timeline").expect(404);
    await viewer.get("/api/situations/command-only-ras/articles").expect(404);
    await viewer.get("/api/situations/command-only-ras/source-items").expect(403);
  });

  it("lets the owner publish a command-center-only situation to City Pulse", async () => {
    const commandOnlySituation = {
      ...sampleSituation,
      id: "publishable-command-only",
      title: "Publiserbar intern situasjon",
      summary: "Vurdert i Command Center før den vises offentlig.",
      publicVisibility: "command_center",
      updatedAt: "2026-07-03T04:05:00.000Z",
      createdAt: "2026-07-03T03:55:00.000Z",
      relatedArticleIds: [],
    } satisfies Situation;

    const ownerRuntime = await testApp();
    addMemorySituation(ownerRuntime.store, commandOnlySituation);
    const owner = request.agent(ownerRuntime.app);
    const ownerSession = await owner.get("/api/session").expect(200);
    const published = await owner
      .patch("/api/situations/publishable-command-only/publication")
      .set("X-CSRF-Token", ownerSession.body.csrfToken as string)
      .send({ publicVisibility: "public" })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            id: "publishable-command-only",
            publicVisibility: "public",
          }),
        );
      });

    await owner
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.situations).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "publishable-command-only" })]),
        );
      });

    const viewerRuntime = await testAppWithEmail(false);
    addMemorySituation(viewerRuntime.store, published.body as Situation);
    const viewer = await loginViewer(viewerRuntime);
    await viewer
      .get("/api/situations")
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "publishable-command-only" })]),
        );
      });
    await viewer.get("/api/situations/publishable-command-only").expect(200);
  });

  it("lets the owner grant viewer access without a prior request", async () => {
    const { app, store, sentEmails } = await testAppWithEmail();
    const owner = request.agent(app);
    const ownerSession = await owner.get("/api/session").expect(200);

    const response = await owner
      .post("/api/users")
      .set("X-CSRF-Token", ownerSession.body.csrfToken as string)
      .send({ displayName: "Direkte Leser", email: "direct@example.test" })
      .expect(201);

    expect(response.body).toMatchObject({
      displayName: "Direkte Leser",
      email: "direct@example.test",
      role: "viewer",
      status: "active",
    });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.subject).toContain("tilgang");
    const accessRequests = await store.listAccessRequests({ limit: 10 }, "owner");
    expect(accessRequests.summary.total).toBe(0);

    const login = await store.consumeEmailLoginToken(
      tokenFromEmail(sentEmails[0]!, "/auth/email/callback"),
    );
    expect(login).toMatchObject({
      email: "direct@example.test",
      role: "viewer",
      status: "active",
    });
  });

  it("sends generic email-login responses and refuses revoked viewers", async () => {
    const { app, store, sentEmails } = await testAppWithEmail(false);
    const requestResult = await store.createAccessRequest({
      displayName: "Revoked Viewer",
      email: "revoked@example.test",
    });
    await store.verifyAccessRequestToken(requestResult.verification!.token);
    const pending = await store.listAccessRequests({ status: "pending", limit: 10 }, "owner");
    const approved = await store.decideAccessRequest(
      pending.items[0]!.id,
      { status: "approved" },
      "owner",
    );
    const login = await store.consumeEmailLoginToken(approved.invite!.token);
    expect(login).toMatchObject({ role: "viewer", status: "active" });

    const users = await store.listUsers("owner");
    const viewer = users.items.find((user) => user.email === "revoked@example.test");
    expect(viewer).toBeDefined();
    await store.updateUser(viewer!.id, { status: "revoked" }, "owner");

    await request(app)
      .post("/auth/email/request")
      .send({ email: "revoked@example.test" })
      .expect(202)
      .expect({ status: "received" });
    await request(app)
      .post("/auth/email/request")
      .send({ email: "unknown@example.test" })
      .expect(202)
      .expect({ status: "received" });
    expect(sentEmails).toHaveLength(0);
  });

  it("invalidates an existing viewer session when access is revoked", async () => {
    const runtime = await testAppWithEmail(false);
    const viewerAgent = await loginViewer(runtime);
    const users = await runtime.store.listUsers("owner");
    const viewer = users.items.find((user) => user.email === "timeline-viewer@example.test");
    expect(viewer).toBeDefined();

    await viewerAgent.get("/api/session").expect(200);
    await runtime.store.updateUser(viewer!.id, { status: "revoked" }, "owner");

    await viewerAgent
      .get("/api/session")
      .expect(403)
      .expect({ error: "Tilgangen er tilbakekalt." });

    await runtime.store.updateUser(viewer!.id, { status: "active" }, "owner");
    await viewerAgent
      .get("/api/session")
      .expect(401)
      .expect({ error: "Innlogging kreves.", loginUrl: "/logg-inn" });
  });

  it("deletes both current and legacy PostgreSQL sessions when revoking a viewer", async () => {
    const captured: Array<{ sql: string; params?: unknown[] }> = [];
    const userRow = {
      id: "viewer-id",
      displayName: "Viewer",
      email: "viewer@example.test",
      role: "viewer",
      status: "active",
      createdAt: "2026-07-12T20:00:00.000Z",
      updatedAt: "2026-07-12T20:00:00.000Z",
      lastLoginAt: "2026-07-12T20:00:00.000Z",
    };
    const client = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        captured.push({ sql: normalizedSql, params });
        if (normalizedSql.startsWith("SELECT id, display_name")) return { rows: [userRow] };
        if (normalizedSql.startsWith("UPDATE users")) {
          return { rows: [{ ...userRow, status: "revoked" }] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const fakePool = { connect: async () => client };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    await store.updateUser("viewer-id", { status: "revoked" }, "owner");

    const deletion = captured.find((query) => query.sql.startsWith('DELETE FROM "session"'));
    expect(deletion).toEqual({
      sql: expect.stringContaining("sess->'passport'->'user'->>'id' = $1"),
      params: ["viewer-id"],
    });
    expect(captured.at(-1)?.sql).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("includes a provenance explanation for situation workspaces", async () => {
    const { agent } = await ownerAgent();
    const response = await agent.get("/api/situations/skogbrann-bymarka").expect(200);

    expect(response.body.explanation).toMatchObject({
      createdBecause: ["2 uavhengige kilder rapporterte samme hendelse."],
      locationConfidence: "estimated",
    });
    expect(response.body.explanation.sourceRoles).toEqual(
      expect.arrayContaining([
        { provider: "nrk", role: "evidence" },
        { provider: "adressa", role: "evidence" },
        { provider: "met", role: "context" },
      ]),
    );
    expect(response.body.explanation.sourceRoles).not.toContainEqual({
      provider: "met",
      role: "evidence",
    });
  });

  it("keeps warning timeline sources visible as context without evidence leakage", () => {
    const explanation = buildSituationExplanation({
      ...sampleSituation,
      evidence: sampleSituation.evidence.filter(
        (item) => item.source !== "nve" && item.source !== "met",
      ),
      features: sampleSituation.features.filter(
        (feature) => feature.properties.layer !== "warning",
      ),
      timeline: [
        ...sampleSituation.timeline,
        {
          id: "timeline-nve-warning",
          situationId: sampleSituation.id,
          timestamp: "2026-06-02T12:00:00.000Z",
          title: "Flomvarsel for Trondheim",
          detail: "NVE-varsel brukes som kontekst, ikke hendelsesgrunnlag.",
          sourceLabel: "NVE / Varsom",
          source: "nve",
          sourceUrl: "https://varsom.no/",
          official: true,
        },
      ],
    });

    expect(explanation.sourceRoles).toContainEqual({ provider: "nve", role: "context" });
    expect(explanation.sourceRoles).not.toContainEqual({ provider: "nve", role: "evidence" });
  });

  it("uses link relationships when explaining situation source items", async () => {
    const { agent, csrf } = await ownerAgent();
    const availableSourceItems = await agent
      .get("/api/source-items?provider=vg&kind=article&q=Olavsfestdagene&limit=1")
      .expect(200);
    const contextSourceItem = availableSourceItems.body.items[0] as SourceItem | undefined;
    expect(contextSourceItem).toMatchObject({ provider: "vg", kind: "article" });
    const contextSourceItemId = String(contextSourceItem?.id);

    const linkResponse = await agent
      .post(
        `/api/situations/skogbrann-bymarka/source-items/${encodeURIComponent(contextSourceItemId)}`,
      )
      .set("X-CSRF-Token", csrf)
      .send({ relationship: "context" })
      .expect(201);
    expect(linkResponse.body).toMatchObject({
      id: contextSourceItemId,
      provider: "vg",
      relationship: "context",
    });

    const sourceItems = await agent
      .get("/api/situations/skogbrann-bymarka/source-items")
      .expect(200);
    expect(sourceItems.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: contextSourceItemId,
          provider: "vg",
          relationship: "context",
        }),
      ]),
    );

    const response = await agent.get("/api/situations/skogbrann-bymarka").expect(200);
    expect(response.body.explanation.sourceRoles).toContainEqual({
      provider: "vg",
      role: "context",
    });
    expect(response.body.explanation.sourceRoles).not.toContainEqual({
      provider: "vg",
      role: "evidence",
    });
  });

  it("keeps source-item-only explanation roles out of viewer situation details", async () => {
    const runtime = await testAppWithEmail(false);
    const availableSourceItems = await runtime.store.listSourceItems(
      {
        provider: "vg",
        kind: "article",
        q: "Olavsfestdagene",
        limit: 1,
      },
      "owner",
    );
    const contextSourceItem = availableSourceItems.items[0];
    expect(contextSourceItem).toMatchObject({ provider: "vg", kind: "article" });
    await runtime.store.linkSourceItem(
      "skogbrann-bymarka",
      contextSourceItem!.id,
      "context",
      "owner",
    );

    const viewer = await loginViewer(runtime);
    const response = await viewer.get("/api/situations/skogbrann-bymarka").expect(200);

    expect(response.body.explanation.sourceRoles).toEqual(
      expect.arrayContaining([
        { provider: "nrk", role: "evidence" },
        { provider: "adressa", role: "evidence" },
      ]),
    );
    expect(response.body.explanation.sourceRoles).not.toContainEqual({
      provider: "vg",
      role: "context",
    });
  });

  it("keeps telemetry and context providers out of causal evidence roles", () => {
    const telemetrySourceItem: SourceItem = {
      id: "source:datex_travel_time:100141",
      provider: "datex_travel_time",
      kind: "official_event",
      externalId: "100141",
      originalUrl: "https://example.test/datex/travel-time",
      title: "E6 Sluppen → Tiller",
      summary: "Travel-time measurement used only as operational telemetry.",
      fetchedAt: "2026-06-02T10:00:00.000Z",
      captureHash: "sha256:telemetry",
      reliabilityTier: "official",
      linkedSituationIds: [sampleSituation.id],
    };

    const serviceAlertSourceItem: SourceItem = {
      id: "source:entur:official_event:line3",
      provider: "entur",
      kind: "official_event",
      externalId: "ATB:line3",
      title: "Linje 3 innstilt",
      summary: "Entur service alert is public-transport context, not causal incident evidence.",
      fetchedAt: "2026-06-02T10:00:00.000Z",
      captureHash: "sha256:entur-service-alert",
      reliabilityTier: "official",
      linkedSituationIds: [sampleSituation.id],
    };

    const trafficInfoSourceItem: SourceItem = {
      id: "source:vegvesen_traffic_info:official_event:NPRA_HBT_1",
      provider: "vegvesen_traffic_info",
      kind: "official_event",
      externalId: "NPRA_HBT_1",
      title: "Vegarbeid på E6",
      summary: "TrafficInfo row is operational map context, not causal incident evidence.",
      fetchedAt: "2026-06-02T10:00:00.000Z",
      captureHash: "sha256:trafficinfo",
      reliabilityTier: "official",
      linkedSituationIds: [sampleSituation.id],
    };

    const railContextSourceItem: SourceItem = {
      id: "source:bane_nor:official_event:rail-message",
      provider: "bane_nor",
      kind: "official_event",
      externalId: "rail-message",
      title: "Togtrafikkmelding",
      summary: "Bane NOR message is mobility context, not causal incident evidence.",
      fetchedAt: "2026-06-02T10:00:00.000Z",
      captureHash: "sha256:bane-nor",
      reliabilityTier: "official",
      linkedSituationIds: [sampleSituation.id],
    };

    const explanation = buildSituationExplanation(sampleSituation, [
      telemetrySourceItem,
      serviceAlertSourceItem,
      trafficInfoSourceItem,
      railContextSourceItem,
    ]);

    expect(explanation.sourceRoles).toContainEqual({
      provider: "datex_travel_time",
      role: "telemetry",
    });
    expect(explanation.sourceRoles).toContainEqual({ provider: "met", role: "context" });
    expect(explanation.sourceRoles).toContainEqual({ provider: "entur", role: "context" });
    expect(explanation.sourceRoles).toContainEqual({
      provider: "vegvesen_traffic_info",
      role: "context",
    });
    expect(explanation.sourceRoles).toContainEqual({ provider: "bane_nor", role: "context" });
    expect(explanation.sourceRoles).not.toContainEqual({
      provider: "datex_travel_time",
      role: "evidence",
    });
    expect(explanation.sourceRoles).not.toContainEqual({ provider: "met", role: "evidence" });
    expect(explanation.sourceRoles).not.toContainEqual({ provider: "entur", role: "evidence" });
    expect(explanation.sourceRoles).not.toContainEqual({
      provider: "vegvesen_traffic_info",
      role: "evidence",
    });
    expect(explanation.sourceRoles).not.toContainEqual({ provider: "bane_nor", role: "evidence" });
  });

  it("shows telemetry stale warnings as operations context, not evidence", async () => {
    const { app, store } = await testApp();
    vi.spyOn(store, "listSituations").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "datex_travel_time",
        label: "DATEX reisetid",
        state: "degraded",
        lastCheckedAt: "2026-06-15T06:00:00.000Z",
        lastFailureAt: "2026-06-15T06:00:00.000Z",
        detail: "Mangler fersk reisetid",
      },
    ] satisfies SourceHealth[]);
    vi.spyOn(store, "listCollectorRuns").mockResolvedValue([]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get("/api/operations/timeline?sources=datex_travel_time")
      .expect(200);

    expect(response.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "stale_warning",
          source: "datex_travel_time",
          role: "telemetry",
          provenance: "preparedness_context",
        }),
      ]),
    );
    expect(JSON.stringify(response.body.events)).not.toContain('"relationship":"supports"');
    expect(JSON.stringify(response.body.events)).not.toContain('"relationship":"activation"');
  });

  it("keeps soft DeepSeek output failures as fallback diagnostics, not critical incidents", async () => {
    const { app, store } = await testApp();
    const completedAt = new Date().toISOString();
    const softRun = {
      id: "deepseek:soft-json",
      source: "deepseek",
      collector: "deepseek",
      status: "failed",
      startedAt: completedAt,
      completedAt,
      durationMs: 121_000,
      recordsSeen: 1,
      recordsAccepted: 0,
      recordsRejected: 1,
      errorCode: "parse_or_collection_failure",
      errorMessage: "Error: DeepSeek JSON response was truncated by token limit.",
    } satisfies SourceCollectorRun;
    vi.spyOn(store, "listSituations").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "deepseek",
        label: "AI-analyse",
        state: "ok",
        lastCheckedAt: completedAt,
        detail:
          "AI-analyse ga ikke brukbar strukturert respons; deterministisk gruppering og reservebrief brukes fortsatt.",
      },
    ] satisfies SourceHealth[]);
    vi.spyOn(store, "listCollectorRuns").mockResolvedValue([softRun]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const timeline = await agent
      .get("/api/operations/timeline?sources=deepseek&kinds=collector_run")
      .expect(200);
    expect(timeline.body.events).toEqual([
      expect.objectContaining({
        kind: "collector_run",
        source: "deepseek",
        severity: "info",
        role: "private",
        title: "AI-analyse brukte reserveanalyse",
        detail:
          "Strukturert AI-respons ble forkastet; deterministisk gruppering og reservebrief brukes fortsatt.",
      }),
    ]);
    expect(JSON.stringify(timeline.body.events)).not.toContain("trenger tilsyn");

    const audit = await agent
      .get("/api/operations/source-audit?sources=deepseek&includeDiagnostics=true")
      .expect(200);
    expect(audit.body.alerts).toEqual([]);
    expect(audit.body.sources).toEqual([
      expect.objectContaining({
        source: "deepseek",
        healthState: "ok",
        reliability: [
          expect.objectContaining({
            level: "good",
            detail:
              "Strukturert AI-respons ble forkastet; deterministisk gruppering og reservebrief brukes fortsatt.",
          }),
        ],
      }),
    ]);
    expect(audit.body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "deepseek:latest_duration_ms",
          severity: "info",
          detail:
            "Strukturert AI-respons ble forkastet; deterministisk gruppering og reservebrief brukes fortsatt.",
        }),
      ]),
    );
  });

  it("does not escalate DeepSeek provider failures into source outage alerts", async () => {
    const { app, store } = await testApp();
    const completedAt = new Date().toISOString();
    vi.spyOn(store, "listSituations").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "deepseek",
        label: "AI-analyse",
        state: "degraded",
        lastCheckedAt: completedAt,
        lastFailureAt: completedAt,
        detail: "AI-analyse feilet, men deterministisk gruppering brukes fortsatt.",
      },
    ] satisfies SourceHealth[]);
    vi.spyOn(store, "listCollectorRuns").mockResolvedValue([]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const timeline = await agent
      .get("/api/operations/timeline?sources=deepseek&kinds=stale_warning")
      .expect(200);
    expect(timeline.body.events).toEqual([]);

    const audit = await agent
      .get("/api/operations/source-audit?sources=deepseek&includeDiagnostics=true")
      .expect(200);
    expect(audit.body.alerts).toEqual([]);
    expect(audit.body.sources).toEqual([
      expect.objectContaining({
        source: "deepseek",
        healthState: "degraded",
        openAlertCount: 0,
        criticalAlertCount: 0,
      }),
    ]);
  });

  it("classifies status, severity, merge and split decisions on the operations timeline", async () => {
    const { app, store } = await testApp();
    const situation = {
      ...sampleSituation,
      importance: "normal",
      timeline: [
        {
          id: "decision-status",
          situationId: sampleSituation.id,
          timestamp: "2026-06-15T07:00:00.000Z",
          kind: "status_change",
          title: "Status satt til aktiv",
          detail: "Redaksjonen flyttet saken fra foreløpig til aktiv.",
          sourceLabel: "Redaksjon",
          sourceUrl: "",
          official: false,
        },
        {
          id: "decision-severity",
          situationId: sampleSituation.id,
          timestamp: "2026-06-15T07:05:00.000Z",
          kind: "severity_change",
          title: "Alvorlighet satt til høy",
          detail: "Vaktleder prioriterte saken for videre oppfølging.",
          sourceLabel: "Redaksjon",
          sourceUrl: "",
          official: false,
        },
        {
          id: "decision-merge",
          situationId: sampleSituation.id,
          timestamp: "2026-06-15T07:10:00.000Z",
          kind: "merge_decision",
          title: "Flettet med duplikat",
          detail: "To parallelle meldinger ble samlet i samme situasjon.",
          sourceLabel: "Redaksjon",
          sourceUrl: "",
          official: false,
        },
        {
          id: "decision-split",
          situationId: sampleSituation.id,
          timestamp: "2026-06-15T07:15:00.000Z",
          kind: "split_decision",
          title: "Delt ut separat hendelse",
          detail: "Et sidespor ble flyttet til egen operasjonell oppfølging.",
          sourceLabel: "Redaksjon",
          sourceUrl: "",
          official: false,
        },
      ],
    } satisfies Situation;
    vi.spyOn(store, "listSituations").mockResolvedValue({ items: [situation] });
    vi.spyOn(store, "getWorkspace").mockResolvedValue({
      situation,
      relatedArticles: [],
      tasks: [],
      notes: [],
      attachments: [],
    });
    vi.spyOn(store, "listSituationSourceItems").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([]);
    vi.spyOn(store, "listCollectorRuns").mockResolvedValue([]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/operations/timeline?kinds=status_change,severity_change,merge_decision,split_decision&sort=asc",
      )
      .expect(200);

    expect(response.body.events.map((event: { kind: string }) => event.kind)).toEqual([
      "status_change",
      "severity_change",
      "merge_decision",
      "split_decision",
    ]);
    expect(response.body.summary.reviewerActions).toBe(4);
  });

  it("keeps operations timeline summary counts independent from page size", async () => {
    const { app, store } = await testApp();
    const firstSituation = {
      ...sampleSituation,
      id: "timeline-active-one",
      title: "Aktiv hendelse én",
      importance: "normal",
      updatedAt: "2026-06-15T08:00:00.000Z",
      timeline: [],
    } satisfies Situation;
    const secondSituation = {
      ...sampleSituation,
      id: "timeline-active-two",
      title: "Aktiv hendelse to",
      importance: "normal",
      updatedAt: "2026-06-15T08:05:00.000Z",
      timeline: [],
    } satisfies Situation;
    vi.spyOn(store, "listSituations").mockResolvedValue({
      items: [firstSituation, secondSituation],
    });
    vi.spyOn(store, "getWorkspace").mockImplementation(async (id) => {
      const situation = id === firstSituation.id ? firstSituation : secondSituation;
      return {
        situation,
        relatedArticles: [],
        tasks: [],
        notes: [],
        attachments: [],
      };
    });
    vi.spyOn(store, "listSituationSourceItems").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([]);
    vi.spyOn(store, "listCollectorRuns").mockResolvedValue([]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent.get("/api/operations/timeline?limit=1").expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.summary.total).toBe(2);
    expect(response.body.summary.activeSituations).toBe(2);
  });

  it("returns a map-first situation workspace with source-filtered timeline", async () => {
    const { agent } = await ownerAgent();
    const response = await agent
      .get("/api/situations/workspace-map?sources=nrk&provenances=reporting_estimate")
      .expect(200);

    expect(response.body.mapState.layers).toEqual(
      expect.arrayContaining(["situations", "evidence", "private_annotations"]),
    );
    expect(response.body.situations).toHaveLength(1);
    expect(response.body.situations[0]).toMatchObject({
      id: "skogbrann-bymarka",
      title: "Skogbrann ved Bymarka",
      sourceConfidence: {
        level: "likely",
        label: "Sannsynlig",
      },
    });
    expect(response.body.situations[0].provenanceSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provenance: "reporting_estimate",
          label: "Anslag fra rapportering",
        }),
      ]),
    );
    expect(response.body.timeline).toEqual([
      expect.objectContaining({
        id: "t1",
        source: "nrk",
        title: "Første melding om røyk",
      }),
    ]);
  });

  it("filters the workspace map and timeline by explicit time bounds", async () => {
    const { agent } = await ownerAgent();

    const recent = await agent
      .get("/api/situations/workspace-map?from=2026-05-26T12:00:00.000Z")
      .expect(200);
    expect(recent.body.situations).toEqual([expect.objectContaining({ id: "skogbrann-bymarka" })]);
    expect(recent.body.timeline).toEqual([
      expect.objectContaining({ id: "t2", timestamp: "2026-05-26T12:18:00.000Z" }),
    ]);

    const afterLastUpdate = new Date(Date.parse(sampleSituation.updatedAt) + 1000).toISOString();
    const stale = await agent
      .get(`/api/situations/workspace-map?from=${encodeURIComponent(afterLastUpdate)}`)
      .expect(200);
    expect(stale.body.situations).toEqual([]);
    expect(stale.body.timeline).toEqual([]);

    await agent
      .get(
        "/api/situations/workspace-map?from=2026-05-26T13:00:00.000Z&to=2026-05-26T12:00:00.000Z",
      )
      .expect(400);
  });

  it("honors explicit situationIds in the workspace map", async () => {
    const { agent } = await ownerAgent();

    const missing = await agent
      .get("/api/situations/workspace-map?situationIds=missing-situation-id")
      .expect(200);
    expect(missing.body.situations).toEqual([]);
    expect(missing.body.timeline).toEqual([]);

    const matching = await agent
      .get("/api/situations/workspace-map?situationIds=skogbrann-bymarka")
      .expect(200);
    expect(matching.body.situations).toEqual([
      expect.objectContaining({ id: "skogbrann-bymarka" }),
    ]);
  });

  it("projects private annotations in the map workspace without making them evidence", async () => {
    const { agent, csrf } = await ownerAgent();
    const created = await agent
      .post("/api/situations/skogbrann-bymarka/features")
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.31, 63.405] },
        properties: {
          label: "Privat observasjonspunkt",
          provenance: "official",
          analysisType: "hotspot",
          confidence: "reported_unverified",
          scenario: "fire",
        },
      })
      .expect(201);

    const response = await agent.get("/api/situations/workspace-map").expect(200);
    expect(response.body.privateAnnotations).toEqual([
      expect.objectContaining({
        id: created.body.id,
        properties: expect.objectContaining({
          label: "Privat observasjonspunkt",
          provenance: "private_annotation",
        }),
      }),
    ]);
    expect(response.body.situations[0].provenanceSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provenance: "private_annotation",
          label: "Privat markering",
        }),
      ]),
    );
    expect(response.body.situations[0].timelinePreview).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ provenance: "private_annotation" })]),
    );

    const hidden = await agent
      .get("/api/situations/workspace-map?includePrivateAnnotations=false")
      .expect(200);
    expect(hidden.body.privateAnnotations).toEqual([]);
    expect(hidden.body.situations[0].features).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: created.body.id })]),
    );
    expect(hidden.body.situations[0].provenanceSummary).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ provenance: "private_annotation" })]),
    );
    expect(hidden.body.situations[0].hasPrivateAnnotations).toBe(false);
  });

  it("honors includeTelemetry when filtering the workspace map", async () => {
    const { app, store } = await testApp();
    vi.spyOn(store, "listSituationSourceItems").mockResolvedValue([
      {
        id: "source:datex_travel_time:100141",
        provider: "datex_travel_time",
        kind: "official_event",
        externalId: "100141",
        originalUrl: "https://example.test/datex/travel-time",
        title: "E6 Sluppen → Tiller",
        summary: "Travel-time measurement used only as operational telemetry.",
        fetchedAt: "2026-06-02T10:00:00.000Z",
        captureHash: "sha256:telemetry-map",
        reliabilityTier: "official",
        linkedSituationIds: [sampleSituation.id],
      },
    ] satisfies SourceItem[]);
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    await agent
      .get("/api/situations/workspace-map?sources=datex_travel_time")
      .expect(200)
      .expect((response) => {
        expect(response.body.situations).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: sampleSituation.id })]),
        );
      });

    await agent
      .get("/api/situations/workspace-map?sources=datex_travel_time&includeTelemetry=false")
      .expect(200)
      .expect((response) => {
        expect(response.body.situations).toEqual([]);
        expect(response.body.timeline).toEqual([]);
      });
  });

  it("starts GitHub OAuth with a session-backed state nonce", async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
    const { app } = await createApp({
      port: 0,
      nodeEnv: "development",
      publicOrigin: "http://localhost",
      seedDemo: true,
      devAuthBypass: false,
      githubClientId: "test-client",
      githubClientSecret: "test-secret",
      githubAllowedLogin: "Reedtrullz",
      sessionSecret: "test-only-secret",
      uploadDir,
      runtimeStatusDir: uploadDir,
      rateLimitEnabled: true,
    });
    const response = await request.agent(app).get("/auth/github").expect(302);
    const target = new URL(response.headers.location as string);
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("scope")).toBeNull();
  });

  it("forces user map drawings into the private layer", async () => {
    const { agent, csrf } = await ownerAgent();
    const sourceItems = await agent.get("/api/source-items?limit=1").expect(200);
    const sourceItemId = String(sourceItems.body.items[0].id);
    await agent
      .post(`/api/situations/skogbrann-bymarka/source-items/${sourceItemId}`)
      .set("X-CSRF-Token", csrf)
      .send({ relationship: "context" })
      .expect(201);
    const response = await agent
      .post("/api/situations/skogbrann-bymarka/features")
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.3, 63.4] },
        properties: {
          label: "Mitt punkt",
          provenance: "official",
          analysisType: "last_known_position",
          confidence: "reported_unverified",
          scenario: "sar",
          measurement: { radiusMeters: 500 },
          styleKey: "last-seen",
          sourceItemIds: [sourceItemId],
        },
      })
      .expect(201);
    expect(response.body.properties).toMatchObject({
      provenance: "private_annotation",
      analysisType: "last_known_position",
      confidence: "reported_unverified",
      scenario: "sar",
      styleKey: "last-seen",
      sourceItemIds: [sourceItemId],
    });
    expect(response.body.properties.measurement).toEqual({ radiusMeters: 500 });

    const patched = await agent
      .patch(`/api/situations/skogbrann-bymarka/features/${response.body.id as string}`)
      .set("X-CSRF-Token", csrf)
      .send({
        label: "Oppdatert punkt",
        confidence: "observed_by_owner",
        measurement: { radiusMeters: 750 },
        styleKey: "hotspot",
        sourceItemIds: [sourceItemId],
      })
      .expect(200);
    expect(patched.body.properties).toMatchObject({
      label: "Oppdatert punkt",
      provenance: "private_annotation",
      analysisType: "last_known_position",
      confidence: "observed_by_owner",
      scenario: "sar",
      styleKey: "hotspot",
      sourceItemIds: [sourceItemId],
    });
    expect(patched.body.properties.measurement).toEqual({ radiusMeters: 750 });
  });

  it("keeps raw source payloads behind the owner-only raw inspector", async () => {
    const { agent } = await ownerAgent();
    const sourceItems = await agent.get("/api/source-items?limit=1").expect(200);
    const item = sourceItems.body.items[0] as Record<string, unknown>;
    expect(item).toMatchObject({ id: expect.any(String), provider: expect.any(String) });
    expect(item).not.toHaveProperty("rawPayload");
    expect(item).not.toHaveProperty("normalizedPayload");

    const raw = await agent
      .get(`/api/operations/raw/source-items/${encodeURIComponent(String(item.id))}`)
      .expect(200);
    expect(raw.body.item).toMatchObject({ id: item.id });
    expect(raw.body.rawPayload).toBeDefined();
    expect(raw.body.normalizedPayload).toBeDefined();
    expect(raw.body.payloadBytes).toMatchObject({
      raw: expect.any(Number),
      normalized: expect.any(Number),
    });

    await agent.get("/api/operations/raw/source-items/source:missing").expect(404);
  });

  it("keeps raw telemetry payloads behind the owner-only raw inspector", async () => {
    await request((await testAppWithEmail(false)).app)
      .get("/api/operations/raw/telemetry")
      .expect(401);
    await request((await testAppWithEmail(false)).app)
      .get("/api/operations/raw/telemetry/datex_travel_time/100141")
      .expect(401);

    const { app, store } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    vi.spyOn(store, "listRawTelemetry").mockResolvedValue({
      items: [
        {
          id: "100141",
          source: "datex_travel_time",
          title: "E6 Okstadbakken - E6 Sluppenrampene",
          updatedAt: "2026-07-02T09:40:20.000Z",
          observedAt: "2026-07-02T09:40:00.000Z",
          summary: "Sakte trafikk · 6 min forsinkelse",
        },
      ],
      nextCursor: "cursor:telemetry",
    });
    vi.spyOn(store, "getRawTelemetryRecord").mockResolvedValue({
      record: {
        id: "100141",
        source: "datex_travel_time",
        title: "E6 Okstadbakken - E6 Sluppenrampene",
        updatedAt: "2026-07-02T09:40:20.000Z",
        observedAt: "2026-07-02T09:40:00.000Z",
        sourceUrl: "https://example.test/datex-travel-time",
        summary: "Sakte trafikk · 6 min forsinkelse",
      },
      payload: { id: "100141", token: "[redacted]" },
      payloadBytes: 512,
      redacted: true,
      truncated: false,
    });

    const list = await agent
      .get("/api/operations/raw/telemetry?source=datex_travel_time&q=Sluppen&limit=12")
      .expect(200);
    expect(list.body).toMatchObject({
      items: [
        {
          id: "100141",
          source: "datex_travel_time",
          title: "E6 Okstadbakken - E6 Sluppenrampene",
        },
      ],
      nextCursor: "cursor:telemetry",
    });
    expect(JSON.stringify(list.body)).not.toContain("rawPayload");
    expect(store.listRawTelemetry).toHaveBeenCalledWith(
      { source: "datex_travel_time", q: "Sluppen", limit: 12 },
      "Reedtrullz",
    );

    const response = await agent
      .get("/api/operations/raw/telemetry/datex_travel_time/100141")
      .expect(200);

    expect(response.body).toMatchObject({
      record: {
        id: "100141",
        source: "datex_travel_time",
        title: "E6 Okstadbakken - E6 Sluppenrampene",
      },
      payload: { id: "100141", token: "[redacted]" },
      payloadBytes: 512,
      redacted: true,
    });
    expect(store.getRawTelemetryRecord).toHaveBeenCalledWith(
      "datex_travel_time",
      "100141",
      "Reedtrullz",
    );

    await agent.get("/api/operations/raw/telemetry/datex_weather/weather-1").expect(400);
  });

  it("returns an owner-only AI raw inspector page shape", async () => {
    const { agent } = await ownerAgent();
    const response = await agent
      .get("/api/operations/raw/ai-runs?provider=deepseek&status=degraded&limit=5")
      .expect(200);

    expect(response.body).toMatchObject({ items: expect.any(Array) });
    expect(JSON.stringify(response.body)).not.toContain("raw_payload");
  });

  it("returns a derived owner-only briefing review without raw payloads", async () => {
    const { agent } = await ownerAgent();
    const response = await agent.get("/api/operations/briefing").expect(200);

    expect(response.body).toMatchObject({
      generatedAt: expect.any(String),
      morningBrief: expect.objectContaining({
        title: "Morgenbrief",
        paragraphs: expect.arrayContaining([expect.any(String)]),
      }),
      operationsNotes: expect.any(Array),
      supportingArticles: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          sourceLabel: expect.any(String),
        }),
      ]),
      supportingSituations: expect.any(Array),
      sourceHealthSummary: expect.objectContaining({
        total: expect.any(Number),
        ok: expect.any(Number),
        attention: expect.any(Number),
      }),
      attentionSources: expect.any(Array),
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("normalizedPayload");
    expect(serialized).not.toContain("raw_payload");
    expect(serialized).not.toContain("normalized_payload");
  });

  it("rejects private feature provenance links that are not attached to the situation", async () => {
    const { agent, csrf } = await ownerAgent();
    await agent
      .post("/api/situations/skogbrann-bymarka/features")
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.3, 63.4] },
        properties: {
          label: "Ugyldig kildekobling",
          analysisType: "last_known_position",
          confidence: "reported_unverified",
          scenario: "sar",
          sourceItemIds: ["source:not-linked"],
        },
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toMatch(/Kildeelementer må være koblet/);
      });
    const created = await agent
      .post("/api/situations/skogbrann-bymarka/features")
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.3, 63.4] },
        properties: {
          label: "Gyldig privat punkt",
          analysisType: "last_known_position",
          confidence: "reported_unverified",
          scenario: "sar",
        },
      })
      .expect(201);
    await agent
      .patch(`/api/situations/skogbrann-bymarka/features/${created.body.id as string}`)
      .set("X-CSRF-Token", csrf)
      .send({ sourceItemIds: ["source:not-linked"] })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toMatch(/Kildeelementer må være koblet/);
      });
  });

  it("provides owner data and exports a protected workspace zip", async () => {
    const { agent, csrf } = await ownerAgent();
    await agent
      .get("/api/articles?scope=trondheim&limit=2")
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toHaveLength(2);
      });
    await agent
      .get("/api/situations")
      .expect(200)
      .expect((response) => {
        expect(response.body.items.length).toBeGreaterThan(0);
      });
    await agent
      .get("/api/operations/status")
      .expect(200)
      .expect((response) => {
        expect(response.body.articleCount).toBeGreaterThan(0);
        expect(response.body.trafficPulse).toEqual([]);
        expect(response.body.workerCycleMetrics).toMatchObject({
          cycleDurationMs: 3250,
          sourceDurationsMs: { datex: 920 },
          sourceItemCounts: { nrk: 2 },
          parseFailures: { datex: 0 },
        });
        expect(response.body.workerFreshness).toMatchObject({
          label: "Worker-syklus",
        });
        expect(response.body.workerFreshness.detail).toContain("Sist fullført");
        expect(response.body.backup).toMatchObject({
          status: "missing",
          label: "Sikkerhetskopi",
        });
      });
    await agent
      .get(
        "/api/operations/source-audit?sources=datex,nrk,trondheim_kommune,private_annotations&includeDiagnostics=true",
      )
      .expect(200)
      .expect((response) => {
        expect(response.body.sources).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "datex",
              label: "Vegvesen DATEX",
              contractStatus: expect.any(String),
            }),
            expect.objectContaining({ source: "nrk", label: "NRK Trøndelag" }),
            expect.objectContaining({
              source: "trondheim_kommune",
              label: "Trondheim kommune",
              contractStatus: "pass",
            }),
            expect.objectContaining({ source: "private_annotations" }),
          ]),
        );
        expect(response.body.collectorRuns).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "datex",
              collector: "datex",
              status: "succeeded",
            }),
          ]),
        );
        expect(response.body.contractChecks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ source: "datex", kind: "secret_hygiene", status: "pass" }),
            expect.objectContaining({
              source: "trondheim_kommune",
              kind: "source_contract",
              status: "pass",
              contractPath: "docs/source-contracts/trondheim-kommune-aktuelt.md",
            }),
          ]),
        );
        expect(JSON.stringify(response.body)).not.toContain("trondheim-notify.md");
        expect(response.body.traceability).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              situationId: "skogbrann-bymarka",
              links: expect.arrayContaining([expect.objectContaining({ source: "nrk" })]),
            }),
          ]),
        );
        expect(JSON.stringify(response.body)).not.toContain("rawPayload");
        expect(JSON.stringify(response.body)).not.toContain("normalizedPayload");
      });
    await agent
      .get(
        "/api/operations/source-audit?sources=datex&from=2026-06-02T06:00:00.000Z&to=2026-06-02T06:00:04.000Z",
      )
      .expect(200)
      .expect((response) => {
        expect(response.body.sources).toEqual([
          expect.objectContaining({ source: "datex", latestRun: expect.any(Object) }),
        ]);
        expect(response.body.collectorRuns).toEqual([expect.objectContaining({ source: "datex" })]);
      });
    await agent
      .get(
        "/api/operations/source-audit?sources=datex&from=2026-06-03T06:00:00.000Z&to=2026-06-03T06:00:04.000Z",
      )
      .expect(200)
      .expect((response) => {
        expect(response.body.sources).toEqual([expect.objectContaining({ source: "datex" })]);
        expect(response.body.sources[0]).not.toHaveProperty("latestRun");
        expect(response.body.collectorRuns).toEqual([]);
      });
    const firstAuditPage = await agent.get("/api/operations/source-audit?limit=1").expect(200);
    expect(firstAuditPage.body.sources).toHaveLength(1);
    expect(firstAuditPage.body.nextCursor).toBe(firstAuditPage.body.sources[0].source);
    await agent
      .get(`/api/operations/source-audit?limit=1&cursor=${firstAuditPage.body.nextCursor}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.sources).toHaveLength(1);
        expect(response.body.sources[0].source > firstAuditPage.body.sources[0].source).toBe(true);
      });
    await agent
      .get("/api/operations/timeline?kinds=source_update,collector_run,review_action&sort=desc")
      .expect(200)
      .expect((response) => {
        expect(response.body.summary.total).toBeGreaterThan(0);
        const timestamps = response.body.events.map(
          (event: { timestamp: string }) => event.timestamp,
        );
        expect(timestamps).toEqual([...timestamps].sort().reverse());
        expect(response.body.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "collector_run",
              source: "datex",
              role: "incident",
            }),
            expect.objectContaining({
              kind: "source_update",
              situationId: "skogbrann-bymarka",
              source: "nrk",
            }),
            expect.objectContaining({
              kind: "review_action",
              title: expect.stringMatching(/Privat/),
              private: true,
            }),
          ]),
        );
        expect(JSON.stringify(response.body)).not.toContain("rawPayload");
        expect(JSON.stringify(response.body)).not.toContain("normalizedPayload");
        expect(JSON.stringify(response.body)).not.toContain("Følg nye offentlige oppdateringer");
      });
    await agent
      .get("/api/operations/timeline?includePrivateAnnotations=false")
      .expect(200)
      .expect((response) => {
        expect(response.body.events).toEqual(
          expect.not.arrayContaining([expect.objectContaining({ private: true })]),
        );
      });
    await agent
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.articles.length).toBeGreaterThan(0);
      });
    await agent
      .post("/api/situations/skogbrann-bymarka/features")
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.32, 63.41] },
        properties: {
          label: "Sist sett",
          analysisType: "last_known_position",
          confidence: "reported_unverified",
          scenario: "sar",
          measurement: { radiusMeters: 500 },
          styleKey: "last-seen",
        },
      })
      .expect(201);
    const created = await agent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", csrf)
      .expect("Content-Type", /zip/)
      .expect(200);
    const zip = await agent
      .get(created.headers.location as string)
      .buffer(true)
      .parse(parseBinaryResponse)
      .expect("Content-Type", /zip/)
      .expect(200);
    const exportDir = await mkdtemp(path.join(os.tmpdir(), "nytt-export-"));
    const zipPath = path.join(exportDir, "workspace.zip");
    await writeFile(zipPath, zip.body as Buffer);
    const { stdout } = await execFileAsync("unzip", [
      "-p",
      zipPath,
      "manifest.json",
      "kartlag/private_annotation.geojson",
    ]);
    expect(stdout).toContain(privateAnalysisWarning);
    expect(stdout).toContain('"analysisType": "last_known_position"');
    expect(stdout).toContain('"confidence": "reported_unverified"');
    expect(stdout).toContain('"scenario": "sar"');
    expect(stdout).toContain('"radiusMeters": 500');
  });

  it("does not treat source-health freshness as a completed worker cycle", async () => {
    const { app, store } = await testApp();
    const latestCollectionAt = new Date().toISOString();
    vi.spyOn(store, "getOperationsStatus").mockResolvedValue({
      sources: [
        {
          source: "nrk",
          label: "NRK Trøndelag",
          state: "ok",
          detail: "RSS sist hentet.",
          lastCheckedAt: latestCollectionAt,
        },
      ],
      articleCount: 1,
      situationCounts: { preliminary: 0, active: 1, resolved: 0, dismissed: 0 },
      situationPublicationCounts: { public: 1, command_center: 0 },
      latestAiRun: undefined,
      trafficPulse: [],
      latestCollectionAt,
    });
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    await agent
      .get("/api/operations/status")
      .expect(200)
      .expect((response) => {
        expect(response.body.latestCollectionAt).toBe(latestCollectionAt);
        expect(response.body.workerFreshness).toMatchObject({
          status: "missing",
          label: "Worker-syklus",
        });
      });
  });

  it("returns normalized and filtered DATEX traffic map events", async () => {
    const { app, store } = await testApp();
    const datexEvents: OfficialEvent[] = [
      {
        id: "datex-roadwork-e6",
        source: "datex",
        eventType: "traffic",
        title: "Veiarbeid på E6 ved Tiller",
        detail: "Ett felt er stengt i forbindelse med veiarbeid.",
        sourceUrl: "https://example.test/datex/e6",
        areaLabel: "E6 Tiller",
        state: "active",
        severity: "medium",
        publishedAt: "2026-05-28T10:00:00.000Z",
        validFrom: "2026-05-28T09:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        geometry: { type: "Point", coordinates: [10.39, 63.39] },
        raw: { datex: { recordKind: "MaintenanceWorks", roadName: "E6" } },
      },
      {
        id: "datex-accident-outside-bounds",
        source: "datex",
        eventType: "traffic",
        title: "Ulykke på E6",
        detail: "Utenfor valgt kartutsnitt.",
        sourceUrl: "https://example.test/datex/outside",
        areaLabel: "E6 Oppdal",
        state: "active",
        severity: "high",
        publishedAt: "2026-05-28T10:05:00.000Z",
        validFrom: "2026-05-28T10:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        geometry: { type: "Point", coordinates: [9.69, 62.59] },
        raw: { datex: { recordKind: "Accident", roadName: "E6" } },
      },
    ];
    const relatedArticles: Article[] = [
      {
        id: "article-near-e6",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Kø ved Tiller etter veiarbeid",
        excerpt: "Trafikken går sakte ved Tiller.",
        url: "https://example.test/articles/e6",
        publishedAt: "2026-05-28T10:10:00.000Z",
        scope: "trondheim",
        category: "Transport",
        places: ["Tiller"],
        location: { lat: 63.3902, lng: 10.3902, label: "Tiller" },
      },
      {
        id: "article-far-away",
        source: "nrk",
        sourceLabel: "NRK",
        title: "Annen trafikknyhet",
        excerpt: "Ikke i nærheten av hendelsen.",
        url: "https://example.test/articles/far",
        publishedAt: "2026-05-28T10:20:00.000Z",
        scope: "trondheim",
        category: "Transport",
        places: ["Ranheim"],
        location: { lat: 63.43, lng: 10.55, label: "Ranheim" },
      },
    ];
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue(datexEvents);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: relatedArticles });
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "datex",
        label: "Vegvesen DATEX",
        state: "ok",
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
        detail: "Sist hentet nå",
      },
      {
        source: "datex_travel_time",
        label: "DATEX reisetid",
        state: "degraded",
        detail: "Mangler oppdaterte reisetider",
      },
      {
        source: "vegvesen_traffic_info",
        label: "Vegvesen TrafficInfo",
        state: "ok",
        detail: "Meldinger hentet",
      },
      { source: "nrk", label: "NRK Trøndelag", state: "ok", detail: "RSS" },
    ] satisfies SourceHealth[]);
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([
      {
        id: "100141",
        name: "E6 Okstadbakken - E6 Sluppenrampene",
        state: "slow",
        travelTimeSeconds: 720,
        freeFlowSeconds: 540,
        delaySeconds: 180,
        delayRatio: 1.33,
        measurementTo: "2026-05-28T10:05:00.000Z",
        updatedAt: "2026-05-28T10:05:30.000Z",
        sourceUrl: "https://example.test/datex/travel-time/100141",
      },
    ] satisfies TrafficPulseCorridor[]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/traffic-events?categories=roadworks&severities=medium&north=63.5&south=63.3&east=10.5&west=10.2",
      )
      .expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      id: "datex:datex-roadwork-e6",
      category: "roadworks",
      severity: "medium",
      state: "active",
      roadName: "E6",
      relatedArticles: [
        {
          id: "article-near-e6",
          title: "Kø ved Tiller etter veiarbeid",
          url: "https://example.test/articles/e6",
        },
      ],
    });
    expect(response.body.events[0].relatedArticles[0].distanceMeters).toBeLessThan(100);
    expect(response.body.brief).toMatchObject({
      headline: "1 trafikkhendelser i valgt kartutsnitt akkurat nå.",
      freshness: expect.any(String),
      counts: {
        total: 1,
        byCategory: { roadworks: 1 },
        bySeverity: { medium: 1 },
      },
    });
    expect(response.body.corridorImpacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "e6-south",
          eventCount: 1,
          affectedEventIds: ["datex:datex-roadwork-e6"],
          highestSeverity: "medium",
          travelTime: expect.objectContaining({
            id: "100141",
            state: "slow",
            delaySeconds: 180,
          }),
        }),
      ]),
    );
    expect(response.body.sources).toEqual([
      {
        source: "datex",
        label: "Vegvesen DATEX",
        state: "ok",
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
        detail: "Sist hentet nå",
      },
      {
        source: "datex_travel_time",
        label: "DATEX reisetid",
        state: "degraded",
        detail: "Mangler oppdaterte reisetider",
      },
      {
        source: "vegvesen_traffic_info",
        label: "Vegvesen TrafficInfo",
        state: "ok",
        detail: "Meldinger hentet",
      },
    ]);

    const emptyCategoryResponse = await agent
      .get("/api/map/traffic-events?categories=&north=63.5&south=63.3&east=10.5&west=10.2")
      .expect(200);
    expect(emptyCategoryResponse.body.events).toEqual([]);
    expect(emptyCategoryResponse.body.brief).toMatchObject({
      headline:
        "Ingen trafikkhendelser i valgt kartutsnitt og filter. Prøv å zoome ut eller slå på planlagte veiarbeid.",
      counts: { total: 0 },
    });
    expect(emptyCategoryResponse.body.corridorImpacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "e6-south",
          eventCount: 0,
          affectedEventIds: [],
          travelTime: expect.objectContaining({ id: "100141", delaySeconds: 180 }),
        }),
      ]),
    );

    await agent.get("/api/map/traffic-events?states=not-a-state").expect(400);
  });

  it("returns dedicated traffic_map_events rows with bounds and state filters", async () => {
    const { app, store } = await testApp();
    const insideEvent: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_HBT_1",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_1",
      category: "roadworks",
      severity: "medium",
      state: "active",
      title: "Veiarbeid ved Trondheim sentrum",
      description: "Ett felt er stengt innenfor valgt kartutsnitt.",
      locationName: "Trondheim sentrum",
      roadName: "E6",
      validFrom: "2026-05-29T08:00:00.000Z",
      validTo: "2099-01-01T00:00:00.000Z",
      updatedAt: "2026-05-29T08:05:00.000Z",
      sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/NPRA_HBT_1",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      rawType: "roadworks",
      confidence: 0.98,
    };
    const outsideEvent: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_HBT_2",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_2",
      category: "roadworks",
      severity: "medium",
      state: "active",
      title: "Veiarbeid utenfor Trondheim",
      description: "Skal filtreres bort av bounds.",
      locationName: "Utenfor Trondheim",
      roadName: "E6",
      validFrom: "2026-05-29T08:00:00.000Z",
      validTo: "2099-01-01T00:00:00.000Z",
      updatedAt: "2026-05-29T08:05:00.000Z",
      sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/NPRA_HBT_2",
      geometry: { type: "Point", coordinates: [9.69, 62.59] },
      rawType: "roadworks",
      confidence: 0.98,
    };
    type ListTrafficMapEvents = (
      filters: {
        bounds?: { north: number; south: number; east: number; west: number };
        categories?: TrafficMapEvent["category"][];
        severities?: TrafficMapEvent["severity"][];
        states?: TrafficMapEvent["state"][];
        from?: string;
        to?: string;
      },
      login: string,
    ) => Promise<TrafficMapEvent[]>;
    const listTrafficMapEvents = vi.fn<ListTrafficMapEvents>(async (filters) => {
      return [insideEvent, outsideEvent].filter((event) => {
        if (filters.states && !filters.states.includes(event.state)) return false;
        if (filters.categories && !filters.categories.includes(event.category)) return false;
        if (filters.severities && !filters.severities.includes(event.severity)) return false;
        if (!filters.bounds || event.geometry.type !== "Point") return true;
        const [lng, lat] = event.geometry.coordinates;
        return (
          lat <= filters.bounds.north &&
          lat >= filters.bounds.south &&
          lng <= filters.bounds.east &&
          lng >= filters.bounds.west
        );
      });
    });
    (store as unknown as { listTrafficMapEvents: ListTrafficMapEvents }).listTrafficMapEvents =
      listTrafficMapEvents;
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2&states=active,planned&categories=roadworks&severities=medium",
      )
      .expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_1",
    });
    expect(listTrafficMapEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
        categories: ["roadworks"],
        severities: ["medium"],
        states: ["active", "planned"],
      }),
      "Reedtrullz",
    );
  });

  it("keeps active open-ended traffic map events visible in future time windows", async () => {
    const { app, store } = await testApp();
    const openEndedEvent: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_OPEN",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_OPEN",
      category: "closure",
      severity: "high",
      state: "active",
      title: "E6 er stengt",
      updatedAt: "2026-05-29T08:05:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
    };
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([openEndedEvent]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/traffic-events?states=active&from=2026-05-29T10:00:00.000Z&to=2026-05-30T10:00:00.000Z",
      )
      .expect(200);

    expect(response.body.events).toEqual([
      expect.objectContaining({
        id: "vegvesen-traffic-info:NPRA_OPEN",
        state: "active",
      }),
    ]);
  });

  it("surfaces road-closing crash articles as estimated traffic events only when requested", async () => {
    const { app, store } = await testApp();
    const crashArticle: Article = {
      id: "article-e6-crash",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Trafikkulykke stenger E6 ved Tiller",
      excerpt: "Politiet melder at veien er stengt etter en kollisjon.",
      url: "https://example.test/e6-crash",
      publishedAt: new Date().toISOString(),
      scope: "trondheim",
      category: "Transport",
      places: ["Tiller"],
      location: { lat: 63.39, lng: 10.39, label: "Tiller" },
    };
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [crashArticle] });

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const hidden = await agent
      .get("/api/map/traffic-events?categories=closure&north=63.5&south=63.3&east=10.5&west=10.2")
      .expect(200);
    const visible = await agent
      .get(
        "/api/map/traffic-events?estimatedNews=true&categories=closure&north=63.5&south=63.3&east=10.5&west=10.2",
      )
      .expect(200);

    expect(hidden.body.events).toEqual([]);
    expect(visible.body.events).toEqual([
      expect.objectContaining({
        id: "news-traffic:article-e6-crash",
        source: "news_article",
        category: "closure",
        severity: "high",
        state: "active",
        relatedArticles: [
          expect.objectContaining({
            id: "article-e6-crash",
            distanceMeters: 0,
          }),
        ],
      }),
    ]);
  });

  it("does not fall back from DATEX source_items into active traffic map events", async () => {
    const { app, store } = await testApp();
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    const listSourceItems = vi.spyOn(store, "listSourceItems").mockResolvedValue({
      items: [
        {
          id: "datex-source-expired",
          provider: "datex",
          kind: "official_event",
          externalId: "expired-accident",
          title: "Gammel ulykke på E6",
          summary: "Skal ikke vises som aktiv fordi source_items er ledger, ikke state table.",
          originalUrl: "https://example.test/datex/expired-accident",
          publishedAt: "2026-05-28T08:00:00.000Z",
          fetchedAt: "2026-05-28T08:00:00.000Z",
          captureHash: "sha256:test-expired-datex-source-item",
          geoHint: { type: "Point", coordinates: [10.39, 63.39] },
          reliabilityTier: "official",
          linkedSituationIds: [],
        },
      ],
    });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([]);
    vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue([]);
    vi.spyOn(store, "listRoadCameras").mockResolvedValue([]);
    vi.spyOn(store, "listTrafficCounterSnapshots").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get("/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2")
      .expect(200);

    expect(response.body.events).toEqual([]);
    expect(listSourceItems).not.toHaveBeenCalled();
  });

  it("returns road weather and camera context inside traffic map bounds", async () => {
    const { app, store } = await testApp();
    const insideWeather: RoadWeatherObservation = {
      id: "datex-weather:SN123",
      source: "datex_weather",
      stationId: "SN123",
      stationName: "E6 Sluppen værstasjon",
      observedAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      airTemperatureC: 5,
    };
    const outsideWeather: RoadWeatherObservation = {
      ...insideWeather,
      id: "datex-weather:SN999",
      stationId: "SN999",
      stationName: "Oppdal værstasjon",
      geometry: { type: "Point", coordinates: [9.69, 62.59] },
    };
    const insideCamera: RoadCamera = {
      id: "datex-cctv:CAM123",
      source: "datex_cctv",
      cameraId: "CAM123",
      name: "E6 Sluppen kamera",
      status: "ok",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.38, 63.38] },
      imageUrl: "https://example.test/camera.jpg",
    };
    const outsideCamera: RoadCamera = {
      ...insideCamera,
      id: "datex-cctv:CAM999",
      cameraId: "CAM999",
      name: "Oppdal kamera",
      geometry: { type: "Point", coordinates: [9.7, 62.58] },
    };
    const inBounds = (
      point: { coordinates: number[] },
      bounds?: { north: number; south: number; east: number; west: number },
    ) => {
      if (!bounds) return true;
      const [lng, lat] = point.coordinates;
      return lat <= bounds.north && lat >= bounds.south && lng <= bounds.east && lng >= bounds.west;
    };
    const listRoadWeatherObservations = vi.fn(async (bounds) =>
      [insideWeather, outsideWeather].filter((item) => inBounds(item.geometry, bounds)),
    );
    const listRoadCameras = vi.fn(async (bounds) =>
      [insideCamera, outsideCamera].filter((item) => inBounds(item.geometry, bounds)),
    );
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "datex_weather",
        label: "Vegvesen værstasjoner",
        state: "ok",
        lastCheckedAt: "2026-05-29T10:01:00.000Z",
        detail: "2 stasjoner oppdatert",
      },
      {
        source: "datex_cctv",
        label: "Vegvesen webkamera",
        state: "degraded",
        detail: "Kamerastatus mangler",
      },
      { source: "nrk", label: "NRK", state: "ok", detail: "RSS" },
    ] satisfies SourceHealth[]);
    vi.spyOn(store, "listRoadWeatherObservations").mockImplementation(listRoadWeatherObservations);
    vi.spyOn(store, "listRoadCameras").mockImplementation(listRoadCameras);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get("/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2")
      .expect(200);

    expect(response.body.events).toEqual([]);
    expect(response.body.weather).toEqual([insideWeather]);
    expect(response.body.cameras).toEqual([insideCamera]);
    expect(listRoadWeatherObservations).toHaveBeenCalledWith({
      north: 63.5,
      south: 63.3,
      east: 10.5,
      west: 10.2,
    });
    expect(listRoadCameras).toHaveBeenCalledWith({
      north: 63.5,
      south: 63.3,
      east: 10.5,
      west: 10.2,
    });
    expect(response.body.sources).toEqual([
      {
        source: "datex_weather",
        label: "Vegvesen værstasjoner",
        state: "ok",
        lastCheckedAt: "2026-05-29T10:01:00.000Z",
        detail: "2 stasjoner oppdatert",
      },
      {
        source: "datex_cctv",
        label: "Vegvesen webkamera",
        state: "degraded",
        detail: "Kamerastatus mangler",
      },
    ]);
  });

  it("returns Trafikkdata counters inside traffic map bounds and includes source health", async () => {
    const { app, store } = await testApp();
    const insideCounter: TrafficCounterSnapshot = {
      id: "trafikkdata:06970V72811",
      source: "trafikkdata",
      pointId: "06970V72811",
      name: "Kroppanbrua",
      updatedAt: "2026-05-29T10:00:00.000Z",
      geometry: { type: "Point", coordinates: [10.384529, 63.391793] },
      municipalityName: "Trondheim",
      volumeLastHour: 1234,
      coveragePercent: 98,
    };
    const outsideCounter: TrafficCounterSnapshot = {
      ...insideCounter,
      id: "trafikkdata:OUTSIDE",
      pointId: "OUTSIDE",
      name: "Oppdal sør",
      geometry: { type: "Point", coordinates: [9.69, 62.59] },
    };
    const inBounds = (
      point: { coordinates: number[] },
      bounds?: { north: number; south: number; east: number; west: number },
    ) => {
      if (!bounds) return true;
      const [lng, lat] = point.coordinates;
      return lat <= bounds.north && lat >= bounds.south && lng <= bounds.east && lng >= bounds.west;
    };
    const listTrafficCounterSnapshots = vi.fn(async (bounds) =>
      [insideCounter, outsideCounter].filter((item) => inBounds(item.geometry, bounds)),
    );
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([]);
    vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue([]);
    vi.spyOn(store, "listRoadCameras").mockResolvedValue([]);
    vi.spyOn(store, "listTrafficCounterSnapshots").mockImplementation(listTrafficCounterSnapshots);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "trafikkdata",
        label: "Vegvesen Trafikkdata",
        state: "ok",
        lastCheckedAt: "2026-05-29T10:00:00.000Z",
        detail: "1 Trafikkdata tellepunkter oppdatert (1 med timesvolum)",
      },
      { source: "nrk", label: "NRK", state: "ok", detail: "RSS" },
    ] satisfies SourceHealth[]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get("/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2")
      .expect(200);

    expect(response.body.events).toEqual([]);
    expect(response.body.counters).toEqual([insideCounter]);
    expect(listTrafficCounterSnapshots).toHaveBeenCalledWith({
      north: 63.5,
      south: 63.3,
      east: 10.5,
      west: 10.2,
    });
    expect(response.body.sources).toEqual([
      {
        source: "trafikkdata",
        label: "Vegvesen Trafikkdata",
        state: "ok",
        lastCheckedAt: "2026-05-29T10:00:00.000Z",
        detail: "1 Trafikkdata tellepunkter oppdatert (1 med timesvolum)",
      },
    ]);
  });

  it("bounds DATEX and skips hidden traffic context layers", async () => {
    const { app, store } = await testApp();
    const listOfficialEvents = vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    const listTrafficPulseCorridors = vi
      .spyOn(store, "listTrafficPulseCorridors")
      .mockResolvedValue([]);
    const listRoadWeatherObservations = vi
      .spyOn(store, "listRoadWeatherObservations")
      .mockResolvedValue([]);
    const listRoadCameras = vi.spyOn(store, "listRoadCameras").mockResolvedValue([]);
    const listTrafficCounterSnapshots = vi
      .spyOn(store, "listTrafficCounterSnapshots")
      .mockResolvedValue([]);
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listArticles").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    await agent
      .get(
        "/api/map/traffic-events?north=63.5&south=63.3&east=10.5&west=10.2&includeTravelTime=false&includeRoadContext=false",
      )
      .expect(200);

    expect(listOfficialEvents).toHaveBeenCalledWith(
      {
        source: "datex",
        states: ["active", "updated"],
        bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
        limit: 300,
      },
      "Reedtrullz",
    );
    expect(listTrafficPulseCorridors).not.toHaveBeenCalled();
    expect(listRoadWeatherObservations).not.toHaveBeenCalled();
    expect(listRoadCameras).not.toHaveBeenCalled();
    expect(listTrafficCounterSnapshots).not.toHaveBeenCalled();
  });

  it("supports planned roadwork timeline queries", async () => {
    const { app, store } = await testApp();
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([
      {
        id: "datex-planned-roadwork",
        source: "datex",
        eventType: "traffic",
        title: "Planlagt veiarbeid på Omkjøringsveien",
        detail: "Nattarbeid med redusert framkommelighet.",
        sourceUrl: "https://example.test/datex/planned",
        areaLabel: "Omkjøringsveien",
        state: "active",
        severity: "medium",
        publishedAt: "2026-05-28T11:00:00.000Z",
        validFrom: "2099-01-02T18:00:00.000Z",
        validTo: "2099-01-03T05:00:00.000Z",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.33, 63.395],
            [10.435, 63.405],
          ],
        },
        raw: { datex: { recordKind: "MaintenanceWorks", roadName: "Omkjøringsveien" } },
      },
      {
        id: "datex-active-accident",
        source: "datex",
        eventType: "traffic",
        title: "Ulykke på E6",
        detail: "Aktiv hendelse skal ikke vises i planlagt-modus.",
        sourceUrl: "https://example.test/datex/active",
        areaLabel: "E6",
        state: "active",
        severity: "high",
        publishedAt: "2026-05-28T12:00:00.000Z",
        validFrom: "2026-05-28T12:00:00.000Z",
        validTo: "2099-01-03T05:00:00.000Z",
        geometry: { type: "Point", coordinates: [10.39, 63.39] },
        raw: { datex: { recordKind: "Accident", roadName: "E6" } },
      },
    ]);
    vi.spyOn(store, "listSourceItems").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({
      items: [
        {
          id: "article-near-planned-line",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Nattarbeid på Omkjøringsveien",
          excerpt: "Arbeidet skjer langs traseen.",
          url: "https://example.test/articles/omkjoringsveien",
          publishedAt: "2026-05-28T12:30:00.000Z",
          scope: "trondheim",
          category: "Transport",
          places: ["Omkjøringsveien"],
          location: { lat: 63.4001, lng: 10.382, label: "Omkjøringsveien" },
        },
      ],
    });

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/traffic-events?states=planned&categories=roadworks&from=2099-01-01T00%3A00%3A00.000Z&to=2099-01-04T00%3A00%3A00.000Z",
      )
      .expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      id: "datex:datex-planned-roadwork",
      state: "planned",
      category: "roadworks",
      roadName: "Omkjøringsveien",
      relatedArticles: [
        {
          id: "article-near-planned-line",
          title: "Nattarbeid på Omkjøringsveien",
        },
      ],
    });
    expect(response.body.events[0].relatedArticles[0].distanceMeters).toBeLessThan(300);
    expect(response.body.corridorImpacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "omkjoringsveien",
          eventCount: 1,
          affectedEventIds: ["datex:datex-planned-roadwork"],
        }),
      ]),
    );
  });

  it("uses opaque cursor pagination without repeating feed items", async () => {
    const { agent } = await ownerAgent();
    const first = await agent.get("/api/articles?limit=1").expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await agent
      .get(`/api/articles?limit=1&cursor=${encodeURIComponent(first.body.nextCursor as string)}`)
      .expect(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    await agent.get("/api/articles?cursor=not-a-valid-cursor").expect(400);
  });

  it("serves grouped City Pulse stories through a story-native API", async () => {
    const { app, store } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const bundle = {
      id: "coverage:incident:city-pulse-api",
      kind: "incident" as const,
      confidence: "high" as const,
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-03T09:00:00.000Z",
    };
    const articles: Article[] = [
      {
        id: "city-pulse-api-adressa",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Bypulsstory: Ung mann kritisk skadd på Lade",
        excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
        url: "https://example.test/city-pulse-api-adressa",
        publishedAt: "2026-07-03T09:10:00.000Z",
        scope: "trondheim",
        category: "Krim",
        places: ["Lade", "Trondheim"],
        coverageBundle: bundle,
      },
      {
        id: "city-pulse-api-politiloggen",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Bypulsstory: Voldshendelse: Trondheim, Lade",
        excerpt: "En person er kritisk skadet etter en voldshendelse på Lade.",
        url: "https://example.test/city-pulse-api-politiloggen",
        publishedAt: "2026-07-03T09:06:00.000Z",
        scope: "trondheim",
        category: "Krim",
        places: ["Lade", "Trondheim"],
        situationId: "politiloggen-lade-vold",
        coverageBundle: bundle,
      },
      {
        id: "city-pulse-api-single",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Bypulsstory: Konsert på Byscenen",
        excerpt: "Kulturarrangement i Trondheim sentrum.",
        url: "https://example.test/city-pulse-api-single",
        publishedAt: "2026-07-03T08:00:00.000Z",
        scope: "trondheim",
        category: "Kultur",
        places: ["Trondheim sentrum"],
      },
    ];
    (store as unknown as { articles: Article[] }).articles.unshift(...articles);

    const first = await agent.get("/api/city-pulse/stories?q=Bypulsstory&limit=1").expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0]).toMatchObject({
      id: "coverage:incident:city-pulse-api",
      primaryArticleId: "city-pulse-api-adressa",
      articleIds: ["city-pulse-api-adressa", "city-pulse-api-politiloggen"],
      sourceLabels: ["Adresseavisen", "Politiloggen"],
      sourceCount: 2,
      updateCount: 2,
      latestAt: "2026-07-03T09:10:00.000Z",
      coverageBundle: { reason: "Samme hendelse på tvers av kilder" },
    });
    expect(first.body.items[0].publicVerification).toBeUndefined();
    expect(first.body.projection).toEqual({
      mode: "legacy",
      matcherVersion: "v1",
      parityClean: true,
      fallbackReason: "disabled",
    });
    expect(first.body.nextCursor).toBeTruthy();

    const second = await agent
      .get(
        `/api/city-pulse/stories?q=Bypulsstory&limit=1&cursor=${encodeURIComponent(
          first.body.nextCursor as string,
        )}`,
      )
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0]).toMatchObject({
      id: "article:city-pulse-api-single",
      primaryArticleId: "city-pulse-api-single",
      sourceCount: 1,
      updateCount: 1,
    });
  });

  it("rejects unknown article category query values", async () => {
    const { agent } = await ownerAgent();
    await agent.get("/api/articles?category=Mat").expect(400);
    await agent.get("/api/articles?category=Trafikk").expect(400);
  });

  it("rejects invalid article time-window query values", async () => {
    const { agent } = await ownerAgent();
    await agent.get("/api/articles?from=not-a-date").expect(400);
    await agent
      .get("/api/articles?from=2026-07-02T10%3A00%3A00.000Z&to=2026-07-02T08%3A00%3A00.000Z")
      .expect(400);
  });

  it("serves coverage bundle metadata through article APIs, pagination and saved overlays", async () => {
    const { app, store } = await testApp();
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);
    const csrf = session.body.csrfToken as string;
    const bundle = {
      id: "coverage:api-contract",
      kind: "topic" as const,
      confidence: "high" as const,
      reason: "Samme nyhetstema",
      generatedAt: "2026-06-18T20:00:00.000Z",
    };
    const bundledArticles: Article[] = [
      {
        id: "api-bundle-new",
        source: "vg",
        sourceLabel: "VG",
        title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
        excerpt: "I dag ble han presentert som Rosenborgs nye trener.",
        url: "https://example.test/api-bundle-new",
        publishedAt: "2026-06-18T23:59:00.000Z",
        scope: "trondheim",
        category: "Sport",
        places: ["Trondheim"],
        coverageBundle: bundle,
      },
      {
        id: "api-bundle-old",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Han kan bli RBK-trener",
        excerpt: "Freyr Alexandersson har vært i konkrete samtaler med Rosenborg.",
        url: "https://example.test/api-bundle-old",
        publishedAt: "2026-06-18T23:58:00.000Z",
        scope: "trondheim",
        category: "Sport",
        places: ["Trondheim"],
        coverageBundle: bundle,
      },
    ];
    (store as unknown as { articles: Article[] }).articles.unshift(...bundledArticles);

    await agent
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.articles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "api-bundle-new",
              coverageBundle: expect.objectContaining({ id: "coverage:api-contract" }),
            }),
          ]),
        );
      });
    const first = await agent.get("/api/articles?limit=1").expect(200);
    expect(first.body.items[0]).toMatchObject({
      id: "api-bundle-new",
      coverageBundle: { id: "coverage:api-contract" },
    });
    const second = await agent
      .get(`/api/articles?limit=1&cursor=${encodeURIComponent(first.body.nextCursor as string)}`)
      .expect(200);
    expect(second.body.items[0]).toMatchObject({
      id: "api-bundle-old",
      coverageBundle: { id: "coverage:api-contract" },
    });

    await agent.put("/api/saved/articles/api-bundle-new").set("X-CSRF-Token", csrf).expect(204);
    await agent
      .get("/api/articles?limit=1")
      .expect(200)
      .expect((response) => {
        expect(response.body.items[0]).toMatchObject({
          id: "api-bundle-new",
          saved: true,
          coverageBundle: { id: "coverage:api-contract" },
        });
      });
    await agent
      .get("/api/saved/articles")
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "api-bundle-new",
              saved: true,
              coverageBundle: expect.objectContaining({ reason: "Samme nyhetstema" }),
            }),
          ]),
        );
      });
  });

  it("serves coverage bundle decisions through the operations API with filters and pagination", async () => {
    const { app, store } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const articles: Article[] = [
      {
        id: "ops-rbk-vg",
        source: "vg",
        sourceLabel: "VG",
        title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
        excerpt: "I dag ble han presentert som Rosenborgs nye trener.",
        url: "https://example.test/ops-rbk-vg",
        publishedAt: "2026-06-18T15:57:00.000Z",
        scope: "trondheim",
        category: "Sport",
        places: ["Trondheim"],
      },
      {
        id: "ops-rbk-adressa",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Han kan bli RBK-trener",
        excerpt: "Freyr Alexandersson har vært i konkrete samtaler med Rosenborg.",
        url: "https://example.test/ops-rbk-adressa",
        publishedAt: "2026-06-18T15:50:00.000Z",
        scope: "trondheim",
        category: "Sport",
        places: ["Trondheim"],
      },
      {
        id: "ops-smoke-nrk",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Rykka til Flatåsen etter røykutvikling",
        excerpt: "Nødetatene har rykka til Flatåsen i Trondheim etter meldinger om røyk.",
        url: "https://example.test/ops-smoke-nrk",
        publishedAt: "2026-06-18T10:50:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Flatåsen", "Trondheim"],
      },
      {
        id: "ops-smoke-politiloggen",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Brann: Trondheim",
        excerpt:
          "Nødetatene rykker til Øvre Flatåsveg i Trondheim i forbindelse med melding om røyk fra bygning.",
        url: "https://example.test/ops-smoke-politiloggen",
        publishedAt: "2026-06-18T10:48:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Flatåsen", "Trondheim"],
      },
    ];
    (store as unknown as { articles: Article[] }).articles.unshift(...articles);

    const topic = await agent
      .get("/api/operations/coverage-bundles?projection=legacy&kind=topic&q=Rosenborg&limit=1")
      .expect(200);

    expect(topic.body.summary).toMatchObject({
      recentBundleCount: expect.any(Number),
      byKind: expect.objectContaining({ topic: expect.any(Number) }),
      byConfidence: expect.objectContaining({ high: expect.any(Number) }),
      latestGeneratedAt: expect.any(String),
    });
    expect(topic.body.items).toHaveLength(1);
    expect(topic.body.items[0]).toMatchObject({
      kind: "topic",
      reason: "Samme nyhetstema",
      sourceLabels: ["VG", "Adresseavisen"],
      memberArticles: [
        expect.objectContaining({ id: "ops-rbk-vg", title: expect.stringContaining("Freyr") }),
        expect.objectContaining({ id: "ops-rbk-adressa", title: "Han kan bli RBK-trener" }),
      ],
      signals: expect.arrayContaining([expect.objectContaining({ kind: "topical_thread" })]),
    });
    expect(topic.body.items[0]).not.toHaveProperty("payload");
    expect(JSON.stringify(topic.body)).not.toContain("raw_payload");

    const first = await agent
      .get("/api/operations/coverage-bundles?projection=legacy&limit=1")
      .expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await agent
      .get(
        `/api/operations/coverage-bundles?projection=legacy&limit=1&cursor=${encodeURIComponent(
          first.body.nextCursor as string,
        )}`,
      )
      .expect(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  describe("coverage bundle corrections API", () => {
    it("keeps E2E fixture controls absent unless explicitly enabled", async () => {
      const runtime = await ownerAgentWithCoverageCorrections(true, "normalized-active");
      await runtime.agent
        .post("/api/__e2e/coverage/reset")
        .set("X-CSRF-Token", runtime.csrf)
        .expect(404);
    });

    it("requires owner CSRF and advances only the E2E coverage generation", async () => {
      const runtime = await ownerAgentWithE2ECoverageFixtures();
      await runtime.agent.post("/api/__e2e/coverage/advance-generation").expect(403);

      const before = await runtime.agent
        .get("/api/operations/coverage-bundles?projection=active")
        .expect(200);
      const advanced = await runtime.agent
        .post("/api/__e2e/coverage/advance-generation")
        .set("X-CSRF-Token", runtime.csrf)
        .expect(200);
      const after = await runtime.agent
        .get("/api/operations/coverage-bundles?projection=active")
        .expect(200);

      expect(advanced.body.generationId).not.toBe(before.body.summary.generation.id);
      expect(after.body.summary.generation.id).toBe(advanced.body.generationId);
      expect(
        after.body.items.find((item: { memberArticleIds: string[] }) =>
          item.memberArticleIds.includes("e2e-correctable-main"),
        ).memberArticleIds,
      ).toHaveLength(2);
    });

    it("resets deterministic E2E fixture membership and corrections", async () => {
      const runtime = await ownerAgentWithE2ECoverageFixtures();
      await runtime.agent
        .post("/api/__e2e/coverage/advance-generation")
        .set("X-CSRF-Token", runtime.csrf)
        .expect(200);
      const reset = await runtime.agent
        .post("/api/__e2e/coverage/reset")
        .set("X-CSRF-Token", runtime.csrf)
        .expect(200);
      const page = await runtime.agent
        .get("/api/operations/coverage-bundles?projection=active")
        .expect(200);

      expect(page.body.summary.generation.id).toBe(reset.body.generationId);
      expect(
        page.body.items.find((item: { memberArticleIds: string[] }) =>
          item.memberArticleIds.includes("e2e-correctable-main"),
        ).memberArticleIds,
      ).toHaveLength(3);
    });

    it("selects the promotion-aware default projection while respecting explicit queries", async () => {
      for (const mode of ["legacy", "normalized-shadow"] as const) {
        const prePromotion = await ownerAgentWithCoverageCorrections(false, mode);
        const prePromotionDefault = await prePromotion.agent
          .get("/api/operations/coverage-bundles")
          .expect(200);
        expect(prePromotionDefault.body).toMatchObject({
          selectedProjection: "shadow",
          summary: { projectionState: "shadow" },
        });
      }

      const promoted = await ownerAgentWithCoverageCorrections(false, "normalized-active");
      const promotedDefault = await promoted.agent
        .get("/api/operations/coverage-bundles")
        .expect(200);
      expect(promotedDefault.body).toMatchObject({
        selectedProjection: "active",
        summary: { projectionState: "active" },
      });

      const explicitShadow = await promoted.agent
        .get("/api/operations/coverage-bundles?projection=shadow")
        .expect(200);
      expect(explicitShadow.body).toMatchObject({
        selectedProjection: "shadow",
        summary: { projectionState: "shadow" },
      });
    });

    it("exposes the corrections capability on coverage workspace responses", async () => {
      const enabled = await ownerAgentWithCoverageCorrections(true);
      const enabledResponse = await enabled.agent
        .get("/api/operations/coverage-bundles?projection=shadow")
        .expect(200);
      expect(enabledResponse.body).toMatchObject({ correctionsEnabled: true });

      const disabled = await ownerAgentWithCoverageCorrections(false);
      const disabledResponse = await disabled.agent
        .get("/api/operations/coverage-bundles?projection=shadow")
        .expect(200);
      expect(disabledResponse.body).toMatchObject({ correctionsEnabled: false });
    });

    it("advertises capability and fails closed while mutation is disabled", async () => {
      const { agent, csrf, capabilities } = await ownerAgentWithCoverageCorrections(false);
      expect(capabilities.coverageCorrections).toBe(false);
      await agent
        .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
        .set("X-CSRF-Token", csrf)
        .send(coverageSplitInput())
        .expect(503, { error: "Korrigering av grupper er ikke aktivert." });
    });

    it("requires authentication, owner access, CSRF, and strict input", async () => {
      const authRuntime = await testAppWithEmail(false, true);
      await request(authRuntime.app)
        .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
        .send(coverageSplitInput())
        .expect(401);

      const viewer = await loginViewer(authRuntime);
      const viewerSession = await viewer.get("/api/session").expect(200);
      expect(viewerSession.body.capabilities).toEqual({ coverageCorrections: false });
      await viewer
        .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
        .set("X-CSRF-Token", viewerSession.body.csrfToken as string)
        .send(coverageSplitInput())
        .expect(403);

      const owner = await ownerAgentWithCoverageCorrections(true);
      await owner.agent
        .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
        .send(coverageSplitInput())
        .expect(403);
      await owner.agent
        .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
        .set("X-CSRF-Token", owner.csrf)
        .send({ ...coverageSplitInput(), unexpected: true })
        .expect(400);
    });

    it("returns replacements and emits content-free structured split telemetry", async () => {
      const runtime = await ownerAgentWithCoverageCorrections(true);
      expect(runtime.capabilities.coverageCorrections).toBe(true);
      const split = vi.spyOn(runtime.store, "splitCoverageBundle").mockResolvedValue({
        corrections: [
          {
            id: "correction-1",
            originalBundleId: "coverage:v2:speed",
            anchorArticleId: "speed-a",
            rejectedArticleId: "threat",
            matcherVersion: "v2",
            evidenceFingerprint: "v2:test-edge",
            status: "active",
            createdAt: "2026-07-12T21:01:00.000Z",
          },
        ],
        removedStoryIds: ["coverage:v2:speed"],
        replacementStories: [],
      });
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const response = await runtime.agent
        .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
        .set("X-CSRF-Token", runtime.csrf)
        .send(coverageSplitInput())
        .expect(200);
      expect(response.body).toMatchObject({
        removedStoryIds: ["coverage:v2:speed"],
        replacementStories: [],
      });
      expect(split).toHaveBeenCalledWith(
        "coverage:v2:speed",
        coverageSplitInput(),
        expect.any(String),
      );
      const log = info.mock.calls.map(([value]) => String(value)).join("\n");
      expect(log).toContain('"action":"split"');
      expect(log).not.toMatch(/Ulik hendelse|speed-a|threat|session|credential/i);
      info.mockRestore();
      split.mockRestore();
    });

    it("returns current replacement stories for stale input", async () => {
      const runtime = await ownerAgentWithCoverageCorrections(true);
      const split = vi
        .spyOn(runtime.store, "splitCoverageBundle")
        .mockRejectedValue(new CoverageBundleConflictError("stale", []));
      const response = await runtime.agent
        .post("/api/coverage-bundles/coverage%3Av2%3Aspeed/corrections/split")
        .set("X-CSRF-Token", runtime.csrf)
        .send(coverageSplitInput())
        .expect(409);
      expect(response.body).toEqual({
        error: "Gruppen ble endret mens du vurderte den.",
        replacementStories: [],
      });
      split.mockRestore();
    });

    it("undoes corrections and exports only sanitized review material", async () => {
      const runtime = await ownerAgentWithCoverageCorrections(true);
      const undo = vi.spyOn(runtime.store, "undoCoverageCorrection").mockResolvedValue({
        corrections: [
          {
            id: "correction-1",
            originalBundleId: "coverage:v2:speed",
            anchorArticleId: "speed-a",
            rejectedArticleId: "threat",
            matcherVersion: "v2",
            evidenceFingerprint: "v2:test-edge",
            status: "reverted",
            createdAt: "2026-07-12T21:01:00.000Z",
            revertedAt: "2026-07-12T21:02:00.000Z",
          },
        ],
        removedStoryIds: [],
        replacementStories: [],
      });
      const exportCorrections = vi
        .spyOn(runtime.store, "exportCoverageCorrections")
        .mockResolvedValue({
          schemaVersion: 1,
          generatedAt: "2026-07-12T21:05:00.000Z",
          rows: [],
        });
      await runtime.agent
        .post("/api/coverage-bundle-corrections/correction-1/undo")
        .set("X-CSRF-Token", runtime.csrf)
        .expect(200)
        .expect((response) => {
          expect(response.body.corrections[0]).toMatchObject({ status: "reverted" });
        });
      const exported = await runtime.agent
        .get("/api/operations/coverage-corrections/export?sinceDays=30")
        .expect(200);
      expect(exported.headers["content-disposition"]).toContain("coverage-corrections-v1.json");
      expect(exported.body).toEqual({
        schemaVersion: 1,
        generatedAt: "2026-07-12T21:05:00.000Z",
        rows: [],
      });
      expect(undo).toHaveBeenCalledWith("correction-1", expect.any(String));
      expect(exportCorrections).toHaveBeenCalledWith(30);
      undo.mockRestore();
      exportCorrections.mockRestore();
    });

    it("maps undo conflicts to bounded 409 replacements and missing corrections to 404", async () => {
      const runtime = await ownerAgentWithCoverageCorrections(true);
      const replacementStories = Array.from({ length: 12 }, (_, index) => ({
        id: `replacement-${index}`,
      })) as never[];
      const undo = vi.spyOn(runtime.store, "undoCoverageCorrection");
      undo.mockRejectedValueOnce(
        new CoverageBundleConflictError("stale", replacementStories.slice(0, 10)),
      );
      const conflict = await runtime.agent
        .post("/api/coverage-bundle-corrections/correction-stale/undo")
        .set("X-CSRF-Token", runtime.csrf)
        .expect(409);
      expect(conflict.body).toEqual({
        error: "Korrigeringen kan ikke angres i gjeldende dekningsgenerasjon.",
        replacementStories: replacementStories.slice(0, 10),
      });

      undo.mockRejectedValueOnce(
        Object.assign(new Error("Korrigeringen finnes ikke."), { status: 404 }),
      );
      await runtime.agent
        .post("/api/coverage-bundle-corrections/correction-missing/undo")
        .set("X-CSRF-Token", runtime.csrf)
        .expect(404, { error: "Korrigeringen finnes ikke." });
      undo.mockRestore();
    });
  });

  it("serves notification trigger candidates as private derived operations data", async () => {
    const { app } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const response = await agent
      .get("/api/operations/notification-triggers?severities=critical,warning&q=brann&limit=10")
      .expect(200);

    expect(response.body).toMatchObject({
      generatedAt: expect.any(String),
      summary: expect.objectContaining({
        total: expect.any(Number),
        critical: expect.any(Number),
        warning: expect.any(Number),
        officialBacked: expect.any(Number),
      }),
      pushStatus: expect.objectContaining({
        configured: false,
        label: "Ikke konfigurert",
        blockedCandidates: expect.any(Number),
      }),
      items: expect.any(Array),
    });
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toMatchObject({
      id: expect.stringContaining("notification:"),
      deliveryState: "not_configured",
      title: expect.any(String),
      detail: expect.stringContaining("Web Push er ikke konfigurert"),
      score: expect.any(Number),
      confidence: expect.objectContaining({ level: expect.any(String) }),
      reasons: expect.arrayContaining([expect.any(String)]),
      links: expect.arrayContaining([expect.objectContaining({ label: expect.any(String) })]),
    });
    expect(JSON.stringify(response.body)).not.toContain("rawPayload");
    expect(JSON.stringify(response.body)).not.toContain("normalizedPayload");
    expect(JSON.stringify(response.body)).not.toContain("raw_payload");
  });

  it("includes spatial unexplained-delay candidates in private notification triggers", async () => {
    const { app, store } = await testApp();
    vi.spyOn(store, "listSituations").mockResolvedValue({ items: [] });
    vi.spyOn(store, "listArticles").mockResolvedValue({
      items: [
        {
          id: "article-e6-delay",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Kø på E6 ved Sluppen",
          excerpt: "Trafikken går sakte ved E6 sør for Trondheim.",
          url: "https://example.test/e6-delay",
          publishedAt: "2026-07-02T09:30:00.000Z",
          scope: "trondheim",
          category: "Transport",
          places: ["Sluppen", "Trondheim"],
        },
      ] satisfies Article[],
    });
    vi.spyOn(store, "listTrafficMapEvents").mockResolvedValue([]);
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([
      {
        id: "100141",
        name: "E6 Okstadbakken - E6 Sluppenrampene",
        state: "slow",
        travelTimeSeconds: 900,
        freeFlowSeconds: 540,
        delaySeconds: 360,
        delayRatio: 1.67,
        measurementFrom: "2026-07-02T09:25:00.000Z",
        measurementTo: "2026-07-02T09:30:00.000Z",
        updatedAt: "2026-07-02T09:30:20.000Z",
        sourceUrl: "https://example.test/datex-travel-time",
      },
    ] satisfies TrafficPulseCorridor[]);
    vi.spyOn(store, "listTrafficCounterSnapshots").mockResolvedValue([]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/operations/notification-triggers?kinds=traffic_disruption&traceStates=raw_evidence&q=E6&limit=10",
      )
      .expect(200);

    expect(response.body.summary.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      id: "notification:spatial:investigation:delay:e6-south:100141",
      kind: "traffic_disruption",
      severity: "warning",
      title: "E6 sør inn mot Trondheim",
      sourceIds: ["datex_travel_time"],
      matchedKeywords: ["uforklart forsinkelse"],
      publicSurface: {
        state: "hidden",
        label: "Kun Command Center",
      },
      links: expect.arrayContaining([
        expect.objectContaining({
          kind: "source_audit",
          href: "/command/kilder?sources=datex_travel_time&detail=datex_travel_time",
        }),
        expect.objectContaining({
          kind: "source_item",
          href: "/command/radata?telemetrySource=datex_travel_time&telemetryId=100141",
          sourceItemId: "telemetry:datex_travel_time:100141",
        }),
      ]),
    });
    expect(JSON.stringify(response.body)).not.toContain("rawPayload");
    expect(JSON.stringify(response.body)).not.toContain("normalizedPayload");
  });

  it("marks notification trigger candidates as waiting when no active subscription matches", async () => {
    const { app } = await testAppWithPushPublicKey("test-public-vapid-key");
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const response = await agent
      .get("/api/operations/notification-triggers?severities=critical,warning&q=brann&limit=10")
      .expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toMatchObject({
      id: expect.stringContaining("notification:"),
      deliveryState: "no_subscribers",
      detail: expect.stringContaining("Ingen aktive push-abonnement"),
    });
    expect(response.body.pushStatus).toMatchObject({
      configured: true,
      label: "Mangler match",
      activeSubscriptions: 0,
      matchingCandidates: 0,
    });
  });

  it("filters notification trigger candidates by delivery state after readiness is applied", async () => {
    const { app } = await testAppWithPushPublicKey("test-public-vapid-key");
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);

    const blockedResponse = await agent
      .get(
        "/api/operations/notification-triggers?severities=critical,warning&q=brann&deliveryStates=no_subscribers&limit=10",
      )
      .expect(200);

    expect(blockedResponse.body.filters).toMatchObject({
      deliveryStates: ["no_subscribers"],
    });
    expect(blockedResponse.body.items.length).toBeGreaterThan(0);
    expect(
      blockedResponse.body.items.every(
        (item: { deliveryState: string }) => item.deliveryState === "no_subscribers",
      ),
    ).toBe(true);
    expect(blockedResponse.body.summary.total).toBe(blockedResponse.body.items.length);
    expect(blockedResponse.body.pushStatus).toMatchObject({
      configured: true,
      label: "Mangler match",
    });

    const readyResponse = await agent
      .get(
        "/api/operations/notification-triggers?severities=critical,warning&q=brann&deliveryStates=ready&limit=10",
      )
      .expect(200);

    expect(readyResponse.body.filters).toMatchObject({
      deliveryStates: ["ready"],
    });
    expect(readyResponse.body.items).toEqual([]);
    expect(readyResponse.body.summary.total).toBe(0);
  });

  it("marks notification trigger candidates as ready when an active subscription matches", async () => {
    const { app } = await testAppWithPushPublicKey("test-public-vapid-key");
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);
    await agent
      .post("/api/notifications/subscriptions")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .send({
        endpoint: "https://push.example.test/send/ready-state-token",
        keys: {
          p256dh: "p256dh-key-material-that-is-long-enough",
          auth: "auth-key-long-enough",
        },
        minSeverity: "warning",
        kinds: [],
      })
      .expect(201);

    const response = await agent
      .get("/api/operations/notification-triggers?severities=critical,warning&q=brann&limit=10")
      .expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toMatchObject({
      id: expect.stringContaining("notification:"),
      deliveryState: "ready",
      detail: expect.stringContaining("Klar for Web Push"),
    });
    expect(response.body.pushStatus).toMatchObject({
      configured: true,
      label: "Klar",
      activeSubscriptions: 1,
      matchingCandidates: expect.any(Number),
      readyCandidates: expect.any(Number),
    });
  });

  it("keeps candidates blocked when the saved push profile filters them out", async () => {
    const { app } = await testAppWithPushPublicKey("test-public-vapid-key");
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);
    await agent
      .post("/api/notifications/subscriptions")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .send({
        endpoint: "https://push.example.test/send/traffic-critical-only",
        keys: {
          p256dh: "p256dh-key-material-that-is-long-enough",
          auth: "auth-key-long-enough",
        },
        minSeverity: "critical",
        kinds: ["traffic_disruption"],
      })
      .expect(201);

    const response = await agent
      .get("/api/operations/notification-triggers?severities=critical,warning&q=brann&limit=10")
      .expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toMatchObject({
      id: expect.stringContaining("notification:"),
      deliveryState: "no_subscribers",
      detail: expect.stringContaining("Ingen aktive push-abonnement"),
    });
    expect(response.body.pushStatus).toMatchObject({
      configured: true,
      label: "Mangler match",
      activeSubscriptions: 1,
      matchingCandidates: 0,
      blockedCandidates: expect.any(Number),
    });
  });

  it("lets signed-in users manage Web Push subscriptions without exposing endpoint secrets", async () => {
    const { app } = await testAppWithPushPublicKey("test-public-vapid-key");
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);
    const csrf = session.body.csrfToken as string;

    const initial = await agent.get("/api/notifications/settings").expect(200);
    expect(initial.body).toMatchObject({
      configured: true,
      publicKey: "test-public-vapid-key",
      subscriptions: [],
    });

    const subscription = await agent
      .post("/api/notifications/subscriptions")
      .set("X-CSRF-Token", csrf)
      .send({
        endpoint: "https://push.example.test/send/very-secret-endpoint-token",
        keys: {
          p256dh: "p256dh-key-material-that-is-long-enough",
          auth: "auth-key-long-enough",
        },
        userAgent: "Vitest Browser",
        minSeverity: "critical",
        kinds: ["traffic_disruption"],
      })
      .expect(201);

    expect(subscription.body).toMatchObject({
      id: expect.any(String),
      endpointHash: expect.any(String),
      enabled: true,
      minSeverity: "critical",
      kinds: ["traffic_disruption"],
      userAgent: "Vitest Browser",
    });
    expect(JSON.stringify(subscription.body)).not.toContain("very-secret-endpoint-token");
    expect(JSON.stringify(subscription.body)).not.toContain("p256dh-key-material");
    expect(JSON.stringify(subscription.body)).not.toContain("auth-key");

    const settings = await agent.get("/api/notifications/settings").expect(200);
    expect(settings.body.subscriptions).toHaveLength(1);

    await agent
      .delete(`/api/notifications/subscriptions/${subscription.body.id as string}`)
      .set("X-CSRF-Token", csrf)
      .expect(204);
    const afterDelete = await agent.get("/api/notifications/settings").expect(200);
    expect(afterDelete.body.subscriptions[0]).toMatchObject({ enabled: false });
  });

  it("requires Web Push configuration before accepting subscriptions", async () => {
    const { app } = await testApp();
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);
    await agent
      .post("/api/notifications/subscriptions")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .send({
        endpoint: "https://push.example.test/send/disabled",
        keys: {
          p256dh: "p256dh-key-material-that-is-long-enough",
          auth: "auth-key-long-enough",
        },
      })
      .expect(503);
  });

  it("serves recent notification delivery history as owner-only operations data", async () => {
    await request((await testAppWithEmail(false)).app)
      .get("/api/operations/notification-deliveries")
      .expect(401);
    const { agent } = await ownerAgent();

    const response = await agent
      .get("/api/operations/notification-deliveries?limit=10")
      .expect(200);

    expect(response.body).toMatchObject({
      generatedAt: expect.any(String),
      items: expect.any(Array),
      summary: expect.objectContaining({
        total: expect.any(Number),
        sent: expect.any(Number),
        failed: expect.any(Number),
      }),
    });
  });

  it("serves command center spatial analytics as derived operations data", async () => {
    const { app, store } = await testApp();
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    vi.spyOn(store, "listSpatialHeatmapCells").mockResolvedValue([
      {
        id: "cell:1039:6339",
        center: { lat: 63.39, lng: 10.39 },
        radiusMeters: 650,
        count: 3,
        sourceItemCount: 2,
        sourceItemIds: ["source:item-one", "source:item-two"],
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
            count: 2,
            sourceItemCount: 1,
            articleCount: 1,
            trafficEventCount: 1,
          },
        ],
        sourceIds: ["nrk", "vegvesen_traffic_info"],
        maxSeverity: "high",
      },
    ]);
    vi.spyOn(store, "listTrafficPulseCorridors").mockResolvedValue([
      {
        id: "100141",
        name: "E6 Okstadbakken - E6 Sluppenrampene",
        state: "slow",
        travelTimeSeconds: 900,
        freeFlowSeconds: 540,
        delaySeconds: 360,
        delayRatio: 1.67,
        measurementFrom: "2026-07-02T09:35:00.000Z",
        measurementTo: "2026-07-02T09:40:00.000Z",
        updatedAt: "2026-07-02T09:40:20.000Z",
        sourceUrl: "https://example.test/datex-travel-time",
      },
    ]);
    vi.spyOn(store, "listTrafficCounterSnapshots").mockResolvedValue([
      {
        id: "trafikkdata:06970V72811",
        source: "trafikkdata",
        pointId: "06970V72811",
        name: "E6 Sluppen",
        updatedAt: "2026-07-02T09:40:00.000Z",
        geometry: { type: "Point", coordinates: [10.39, 63.39] },
        volumeLastHour: 2200,
        baselineVolumeLastHour: 800,
        anomalyRatio: 2.75,
        coveragePercent: 94,
      },
    ]);
    vi.spyOn(store, "getTrafficTelemetryHistorySummary").mockResolvedValue({
      datexTravelTime: {
        observations: 144,
        trackedEntities: 12,
        firstObservedAt: "2026-06-30T09:00:00.000Z",
        lastObservedAt: "2026-07-02T09:45:00.000Z",
        activeDayCount: 3,
        notableObservations: 18,
      },
      trafficCounters: {
        observations: 96,
        trackedEntities: 8,
        firstObservedAt: "2026-07-01T07:00:00.000Z",
        lastObservedAt: "2026-07-02T09:40:00.000Z",
        activeDayCount: 2,
        notableObservations: 5,
      },
    });
    vi.spyOn(store, "listTrafficTelemetryPatterns").mockResolvedValue([
      {
        id: "telemetry-pattern:datex_travel_time:e6-sluppen",
        source: "datex_travel_time",
        title: "E6 Sluppen",
        description: "Maks 8 min forsinkelse i historikken.",
        observationCount: 18,
        notableObservationCount: 7,
        activeDayCount: 3,
        firstObservedAt: "2026-06-30T09:00:00.000Z",
        lastObservedAt: "2026-07-02T09:45:00.000Z",
        maxDelaySeconds: 480,
      },
    ]);

    const response = await agent
      .get("/api/operations/spatial-analytics?minDelaySeconds=180&limit=20")
      .expect(200);

    expect(response.body).toMatchObject({
      live: {
        status: expect.stringMatching(/^(live|stale)$/u),
        refreshIntervalSeconds: 60,
        nextRefreshAt: expect.any(String),
        staleAfterSeconds: 900,
        dataUpdatedAt: "2026-07-02T09:45:00.000Z",
        dataAgeSeconds: expect.any(Number),
        detail: expect.any(String),
      },
      summary: {
        heatmapCells: 1,
        observations: 3,
        unexplainedDelays: expect.any(Number),
        criticalDelays: expect.any(Number),
        bySourceConfidence: expect.objectContaining({
          confirmed: expect.any(Number),
          likely: expect.any(Number),
          uncertain: expect.any(Number),
          speculative: expect.any(Number),
        }),
      },
      telemetryHistory: {
        datexTravelTime: {
          observations: 144,
          trackedEntities: 12,
          activeDayCount: 3,
          notableObservations: 18,
        },
        trafficCounters: {
          observations: 96,
          trackedEntities: 8,
          activeDayCount: 2,
          notableObservations: 5,
        },
      },
      telemetryPatterns: [
        expect.objectContaining({
          id: "telemetry-pattern:datex_travel_time:e6-sluppen",
          source: "datex_travel_time",
          title: "E6 Sluppen",
          notableObservationCount: 7,
          activeDayCount: 3,
          maxDelaySeconds: 480,
        }),
      ],
      investigationQueue: expect.arrayContaining([
        expect.objectContaining({
          kind: "hotspot",
          priority: "high",
          summary:
            "3 observasjoner over 2 aktive dager, topp 2 observasjoner 2. juli ved 63.390, 10.390",
          evidence: expect.arrayContaining(["Toppdag 2. juli: 2 observasjoner"]),
        }),
        expect.objectContaining({
          kind: "traffic_counter_anomaly",
          priority: "high",
          title: "E6 Sluppen",
          evidence: expect.arrayContaining(["2.8x normal trafikk"]),
          sourceItemIds: [],
          articleIds: [],
          rawRefs: [
            {
              type: "telemetry",
              source: "trafikkdata",
              id: "06970V72811",
              label: "Trafikkdata teller",
              observedAt: "2026-07-02T09:40:00.000Z",
            },
          ],
        }),
        expect.objectContaining({
          kind: expect.stringMatching(/^(hotspot|unexplained_delay)$/u),
          priority: expect.stringMatching(/^(critical|high|watch)$/u),
          title: expect.any(String),
          evidence: expect.any(Array),
          sourceItemIds: expect.any(Array),
          articleIds: expect.any(Array),
        }),
      ]),
      heatmapCells: [
        expect.objectContaining({
          id: "cell:1039:6339",
          count: 3,
          firstSeenAt: "2026-07-01T09:40:00.000Z",
          activeDayCount: 2,
          timeBuckets: [
            expect.objectContaining({
              bucketStart: "2026-07-01T00:00:00.000Z",
              count: 1,
            }),
            expect.objectContaining({
              bucketStart: "2026-07-02T00:00:00.000Z",
              count: 2,
              trafficEventCount: 1,
            }),
          ],
          sourceItemIds: ["source:item-one", "source:item-two"],
          sourceIds: ["nrk", "vegvesen_traffic_info"],
          sourceConfidence: expect.objectContaining({
            level: "confirmed",
            label: "Bekreftet",
            score: expect.any(Number),
          }),
        }),
      ],
    });
    expect(response.body).not.toHaveProperty("rawPayload");
    expect(response.body).not.toHaveProperty("sourceItems");
    expect(JSON.stringify(response.body)).not.toContain("raw_payload");
  });

  it("stores uploaded private attachment metadata with a content checksum", async () => {
    const { agent, csrf } = await ownerAgent();
    const bytes = Buffer.from("privat vedlegg");
    const response = await agent
      .post("/api/situations/skogbrann-bymarka/attachments")
      .set("X-CSRF-Token", csrf)
      .attach("file", bytes, "notat.txt")
      .expect(201);
    expect(response.body.filename).toBe("notat.txt");
    expect(response.body.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("PgStore returns sanitized raw telemetry details for DATEX and Trafikkdata rows", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const fakePool = {
      async query(sql: string, params: unknown[]) {
        queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        if (sql.includes("FROM datex_travel_times")) {
          return {
            rows: [
              {
                id: "100141",
                name: "E6 Okstadbakken - E6 Sluppenrampene",
                state: "slow",
                delay_seconds: 360,
                measurement_to: "2026-07-02T09:40:00.000Z",
                source_url: "https://example.test/datex-travel-time",
                payload: { id: "100141", token: "secret-token" },
                updated_at: "2026-07-02T09:40:20.000Z",
              },
            ],
          };
        }
        return {
          rows: [
            {
              point_id: "06970V72811",
              payload: {
                name: "E6 Sluppen",
                updatedAt: "2026-07-02T09:40:00.000Z",
                volumeLastHour: 2200,
                anomalyRatio: 2.75,
                coveragePercent: 94,
                apiKey: "secret-key",
              },
              updated_at: "2026-07-02T09:40:05.000Z",
              geometry: { type: "Point", coordinates: [10.39, 63.39] },
            },
          ],
        };
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    const datex = await store.getRawTelemetryRecord("datex_travel_time", "100141", "owner");
    const counter = await store.getRawTelemetryRecord("trafikkdata", "06970V72811", "owner");

    expect(queries[0]).toMatchObject({
      params: ["100141"],
    });
    expect(queries[0]?.sql).toContain("FROM datex_travel_times");
    expect(queries[1]).toMatchObject({
      params: ["06970V72811"],
    });
    expect(queries[1]?.sql).toContain("FROM traffic_counter_snapshots");
    expect(datex).toMatchObject({
      record: {
        id: "100141",
        source: "datex_travel_time",
        title: "E6 Okstadbakken - E6 Sluppenrampene",
        observedAt: "2026-07-02T09:40:00.000Z",
        summary: "Sakte trafikk · 6 min forsinkelse",
      },
      payload: { id: "100141", token: "[redacted]" },
      redacted: true,
    });
    expect(counter).toMatchObject({
      record: {
        id: "06970V72811",
        source: "trafikkdata",
        title: "E6 Sluppen",
        observedAt: "2026-07-02T09:40:00.000Z",
        summary: "2200 kjøretøy siste time · 2.8x normal trafikk · 94 % dekning",
        geometry: { type: "Point", coordinates: [10.39, 63.39] },
      },
      payload: {
        name: "E6 Sluppen",
        apiKey: "[redacted]",
      },
      redacted: true,
    });
  });

  it("PgStore lists recent raw telemetry rows with source filters and opaque cursors", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const fakePool = {
      async query(sql: string, params: unknown[]) {
        capturedSql = sql.replace(/\s+/g, " ").trim();
        capturedParams = params;
        return {
          rows: [
            {
              point_id: "06970V72811",
              payload: {
                name: "E6 Sluppen",
                updatedAt: "2026-07-02T09:40:00.000Z",
                volumeLastHour: 2200,
                anomalyRatio: 2.75,
                coveragePercent: 94,
              },
              updated_at: "2026-07-02T09:40:05.000Z",
              updated_at_cursor: "2026-07-02T09:40:05.000000Z",
              geometry: { type: "Point", coordinates: [10.39, 63.39] },
            },
            {
              point_id: "06970V72810",
              payload: {
                name: "E6 Kroppanbrua",
                updatedAt: "2026-07-02T09:38:00.000Z",
                volumeLastHour: 1800,
              },
              updated_at: "2026-07-02T09:38:05.000Z",
              updated_at_cursor: "2026-07-02T09:38:05.000000Z",
              geometry: { type: "Point", coordinates: [10.38, 63.38] },
            },
          ],
        };
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    const cursor = Buffer.from(
      JSON.stringify(["2026-07-02T09:45:00.000Z", "trafikkdata:cursor"]),
      "utf8",
    ).toString("base64url");
    const page = await store.listRawTelemetry(
      {
        source: "trafikkdata",
        q: "Sluppen",
        cursor,
        limit: 1,
      },
      "owner",
    );

    expect(capturedSql).toContain("FROM traffic_counter_snapshots");
    expect(capturedSql).toContain("point_id ILIKE $1");
    expect(capturedSql).toContain("payload::text ILIKE $1");
    expect(capturedSql).toContain("('trafikkdata:' || point_id) < $3");
    expect(capturedParams).toEqual([
      "%Sluppen%",
      "2026-07-02T09:45:00.000Z",
      "trafikkdata:cursor",
      2,
    ]);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: "06970V72811",
        source: "trafikkdata",
        title: "E6 Sluppen",
        summary: "2200 kjøretøy siste time · 2.8x normal trafikk · 94 % dekning",
      }),
    ]);
    expect(page.nextCursor).toBeTruthy();
  });

  it("PgStore lists traffic map events with SQL filters and overlays row state", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const payload: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_HBT_1",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_1",
      category: "roadworks",
      severity: "medium",
      state: "planned",
      title: "Veiarbeid ved Trondheim sentrum",
      description: "Ett felt er stengt innenfor valgt kartutsnitt.",
      locationName: "Trondheim sentrum",
      roadName: "E6",
      validFrom: "2026-05-29T08:00:00.000Z",
      validTo: "2026-05-29T12:00:00.000Z",
      updatedAt: "2026-05-29T08:05:00.000Z",
      sourceUrl: "https://trafikkinfo.atlas.vegvesen.no/NPRA_HBT_1",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      rawType: "roadworks",
      confidence: 0.98,
    };
    const fakePool = {
      async query(sql: string, params: unknown[]) {
        capturedSql = sql.replace(/\s+/g, " ").trim();
        capturedParams = params;
        return { rows: [{ payload, state: "active" as TrafficMapEvent["state"] }] };
      },
    };

    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
    const events = await store.listTrafficMapEvents({
      sources: ["vegvesen_traffic_info"],
      states: ["active", "planned"],
      categories: ["roadworks", "closure"],
      severities: ["medium", "high"],
      bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
      from: "2026-05-29T00:00:00.000Z",
      to: "2026-05-30T00:00:00.000Z",
    });

    expect(capturedSql).toContain("FROM traffic_map_events");
    expect(capturedSql).toContain("source = ANY($1::text[])");
    expect(capturedSql).toContain("state = ANY($2::text[])");
    expect(capturedSql).toContain("category = ANY($3::text[])");
    expect(capturedSql).toContain("severity = ANY($4::text[])");
    expect(capturedSql).toContain("geometry && ST_MakeEnvelope($5, $6, $7, $8, 4326)");
    expect(capturedSql).toContain(
      "((state = 'active' AND valid_to IS NULL) OR COALESCE(valid_to, updated_at) >= $9)",
    );
    expect(capturedSql).toContain("COALESCE(valid_from, updated_at) <= $10");
    expect(capturedSql).toContain("ORDER BY updated_at DESC LIMIT 1000");
    expect(capturedSql.indexOf("category = ANY($3::text[])")).toBeLessThan(
      capturedSql.indexOf("ORDER BY updated_at DESC LIMIT 1000"),
    );
    expect(capturedSql.indexOf("severity = ANY($4::text[])")).toBeLessThan(
      capturedSql.indexOf("ORDER BY updated_at DESC LIMIT 1000"),
    );
    expect(capturedParams).toEqual([
      ["vegvesen_traffic_info"],
      ["active", "planned"],
      ["roadworks", "closure"],
      ["medium", "high"],
      10.2,
      63.3,
      10.5,
      63.5,
      "2026-05-29T00:00:00.000Z",
      "2026-05-30T00:00:00.000Z",
    ]);
    expect(events).toEqual([{ ...payload, state: "active" }]);
  });

  it("PgStore applies official-event bounds before limiting route context", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const payload: OfficialEvent = {
      id: "datex:route-closure",
      source: "datex",
      eventType: "traffic",
      title: "E6 stengt ved Leangen",
      detail: "Omkjøring er skiltet.",
      sourceUrl: "https://datex.example.test/route-closure",
      areaLabel: "Leangen",
      state: "active",
      severity: "high",
      publishedAt: "2026-07-05T08:00:00.000Z",
      validFrom: "2026-07-05T08:00:00.000Z",
      validTo: "2026-07-05T10:00:00.000Z",
      raw: {},
    };
    const geometry: OfficialEvent["geometry"] = {
      type: "Point",
      coordinates: [10.432, 63.432],
    };
    const fakePool = {
      async query(sql: string, params: unknown[]) {
        capturedSql = sql.replace(/\s+/g, " ").trim();
        capturedParams = params;
        return { rows: [{ payload, state: "active" as OfficialEvent["state"], geometry }] };
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    const events = await store.listOfficialEvents({
      source: "datex",
      states: ["active", "updated"],
      bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
      limit: 200,
    });

    expect(capturedSql).toContain("FROM official_events");
    expect(capturedSql).toContain("source = $1");
    expect(capturedSql).toContain("state = ANY($2::text[])");
    expect(capturedSql).toContain("geometry && ST_MakeEnvelope($3, $4, $5, $6, 4326)");
    expect(capturedSql.indexOf("geometry && ST_MakeEnvelope")).toBeLessThan(
      capturedSql.indexOf("ORDER BY published_at DESC"),
    );
    expect(capturedParams).toEqual(["datex", ["active", "updated"], 10.2, 63.3, 10.5, 63.5, 200]);
    expect(events).toEqual([{ ...payload, state: "active", geometry }]);
  });

  it("PgStore hides expired or long-unseen public transport vehicles", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const vehicle: PublicTransportVehicle = {
      id: "entur-vehicle:ATB:8790",
      source: "entur_vehicle_positions",
      codespaceId: "ATB",
      vehicleId: "8790",
      mode: "bus",
      lastUpdated: "2026-05-31T21:02:50.207Z",
      geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
      stale: false,
    };
    const fakePool = {
      async query(sql: string, params: unknown[]) {
        capturedSql = sql.replace(/\s+/g, " ").trim();
        capturedParams = params;
        return { rows: [{ payload: vehicle, stale: false }] };
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    const vehicles = await store.listPublicTransportVehicles({
      modes: ["bus"],
      bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
    });

    expect(capturedSql).toContain("FROM public_transport_vehicles");
    expect(capturedSql).toContain("stale=false");
    expect(capturedSql).toContain("(expires_at IS NULL OR expires_at > now())");
    expect(capturedSql).toContain("last_seen_at >= now() - interval '5 minutes'");
    expect(capturedSql).toContain("mode = ANY($1::text[])");
    expect(capturedParams).toEqual([["bus"], 10.2, 63.3, 10.5, 63.5]);
    expect(vehicles).toEqual([vehicle]);
  });

  it("PgStore keeps line-only active public transport alerts eligible and excludes expired active alerts", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const alert: PublicTransportServiceAlert = {
      id: "entur-service-alert:ATB:line-only",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "line-only",
      state: "active",
      summary: "Linje 3 er innstilt",
      updatedAt: "2026-05-31T21:00:00.000Z",
      affectedLineRefs: ["ATB:Line:2_3"],
      affectedLineNames: ["Linje 3"],
    };
    const fakePool = {
      async query(sql: string, params: unknown[]) {
        capturedSql = sql.replace(/\s+/g, " ").trim();
        capturedParams = params;
        return {
          rows: [{ payload: alert, state: "active" as PublicTransportServiceAlert["state"] }],
        };
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    const alerts = await store.listPublicTransportServiceAlerts({
      states: ["active"],
      bounds: { north: 63.5, south: 63.3, east: 10.5, west: 10.2 },
    });

    expect(capturedSql).toContain("FROM public_transport_service_alerts");
    expect(capturedSql).toContain("state = ANY($1::text[])");
    expect(capturedSql).toContain("(valid_to IS NULL OR valid_to >= now())");
    expect(capturedSql).toContain("(valid_from IS NULL OR valid_from <= now())");
    expect(capturedSql).toContain(
      "(geometry IS NULL OR ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326)))",
    );
    expect(capturedParams).toEqual([["active"], 10.2, 63.3, 10.5, 63.5]);
    expect(alerts).toEqual([alert]);
  });

  it("PgStore includes temporal evidence when listing spatial heatmap cells", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] | undefined;
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        capturedSql = sql.replace(/\s+/g, " ").trim();
        capturedParams = params;
        return {
          rows: [
            {
              id: "cell:1039:6339",
              center_lng: "10.39",
              center_lat: "63.39",
              observation_count: "4",
              source_item_count: "3",
              source_item_ids: ["source:item-one", "source:item-two"],
              article_count: "2",
              traffic_event_count: "1",
              first_seen_at: "2026-06-30T09:40:00.000Z",
              last_seen_at: "2026-07-02T09:40:00.000Z",
              active_day_count: "3",
              time_buckets: [
                {
                  bucketStart: "2026-06-30T00:00:00.000Z",
                  count: 1,
                  sourceItemCount: 1,
                  articleCount: 0,
                  trafficEventCount: 0,
                },
                {
                  bucketStart: "2026-07-01T00:00:00.000Z",
                  count: 1,
                  sourceItemCount: 1,
                  articleCount: 1,
                  trafficEventCount: 0,
                },
                {
                  bucketStart: "2026-07-02T00:00:00.000Z",
                  count: 2,
                  sourceItemCount: 1,
                  articleCount: 1,
                  trafficEventCount: 1,
                },
              ],
              source_ids: ["nrk", "vegvesen_traffic_info"],
              severity_rank: "3",
            },
          ],
        };
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    await expect(
      store.listSpatialHeatmapCells(
        {
          from: "2026-06-30T00:00:00.000Z",
          to: "2026-07-02T23:59:59.000Z",
          limit: 5,
        },
        "Reedtrullz",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "cell:1039:6339",
        firstSeenAt: "2026-06-30T09:40:00.000Z",
        lastSeenAt: "2026-07-02T09:40:00.000Z",
        activeDayCount: 3,
        timeBuckets: [
          {
            bucketStart: "2026-06-30T00:00:00.000Z",
            count: 1,
            sourceItemCount: 1,
            articleCount: 0,
            trafficEventCount: 0,
          },
          {
            bucketStart: "2026-07-01T00:00:00.000Z",
            count: 1,
            sourceItemCount: 1,
            articleCount: 1,
            trafficEventCount: 0,
          },
          {
            bucketStart: "2026-07-02T00:00:00.000Z",
            count: 2,
            sourceItemCount: 1,
            articleCount: 1,
            trafficEventCount: 1,
          },
        ],
        maxSeverity: "high",
      }),
    ]);
    expect(capturedSql).toContain("min(observed_at) AS first_seen_at");
    expect(capturedSql).toContain("count(DISTINCT observed_at::date)::text AS active_day_count");
    expect(capturedSql).toContain("date_trunc('day', observed_at) AS bucket_start");
    expect(capturedSql).toContain("jsonb_agg( jsonb_build_object");
    expect(capturedParams).toEqual(["2026-06-30T00:00:00.000Z", "2026-07-02T23:59:59.000Z", 5]);
  });

  it("PgStore lists road weather, camera, and counter rows with bounds SQL filters", async () => {
    const weatherPayload: RoadWeatherObservation = {
      id: "datex-weather:SN123",
      source: "datex_weather",
      stationId: "SN123",
      stationName: "E6 Sluppen værstasjon",
      observedAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      airTemperatureC: 5,
    };
    const cameraPayload: RoadCamera = {
      id: "datex-cctv:CAM123",
      source: "datex_cctv",
      cameraId: "CAM123",
      name: "E6 Sluppen kamera",
      status: "ok",
      updatedAt: "2026-05-29T10:01:00.000Z",
      geometry: { type: "Point", coordinates: [10.38, 63.38] },
    };
    const counterPayload: TrafficCounterSnapshot = {
      id: "trafikkdata:06970V72811",
      source: "trafikkdata",
      pointId: "06970V72811",
      name: "Kroppanbrua",
      updatedAt: "2026-05-29T10:02:00.000Z",
      geometry: { type: "Point", coordinates: [10.384529, 63.391793] },
      municipalityName: "Trondheim",
      volumeLastHour: 1234,
    };
    const captured: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        captured.push({ sql: normalizedSql, params });
        if (normalizedSql.includes("FROM road_weather_observations")) {
          return { rows: [{ payload: weatherPayload }] };
        }
        if (normalizedSql.includes("FROM road_cameras")) {
          return { rows: [{ payload: cameraPayload }] };
        }
        if (normalizedSql.includes("FROM traffic_counter_snapshots")) {
          return { rows: [{ payload: counterPayload }] };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
    const bounds = { north: 63.5, south: 63.3, east: 10.5, west: 10.2 };

    await expect(store.listRoadWeatherObservations(bounds)).resolves.toEqual([weatherPayload]);
    await expect(store.listRoadCameras(bounds)).resolves.toEqual([cameraPayload]);
    await expect(store.listTrafficCounterSnapshots(bounds)).resolves.toEqual([counterPayload]);

    expect(captured[0]?.sql).toContain("FROM road_weather_observations");
    expect(captured[0]?.sql).toContain("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(captured[0]?.sql).toContain("ORDER BY updated_at DESC, station_id ASC");
    expect(captured[0]?.params).toEqual([10.2, 63.3, 10.5, 63.5]);
    expect(captured[1]?.sql).toContain("FROM road_cameras");
    expect(captured[1]?.sql).toContain("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(captured[1]?.sql).toContain("ORDER BY updated_at DESC, camera_id ASC");
    expect(captured[1]?.params).toEqual([10.2, 63.3, 10.5, 63.5]);
    expect(captured[2]?.sql).toContain("FROM traffic_counter_snapshots");
    expect(captured[2]?.sql).toContain("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(captured[2]?.sql).toContain("ORDER BY updated_at DESC, point_id ASC");
    expect(captured[2]?.params).toEqual([10.2, 63.3, 10.5, 63.5]);
  });

  it("PgStore summarizes telemetry history with the spatial analytics time window", async () => {
    const captured: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        captured.push({ sql: normalizedSql, params });
        if (normalizedSql.includes("FROM datex_travel_time_history")) {
          return {
            rows: [
              {
                observations: "144",
                tracked_entities: "12",
                first_observed_at: new Date("2026-06-30T09:00:00.000Z"),
                last_observed_at: new Date("2026-07-02T09:45:00.000Z"),
                active_day_count: "3",
                notable_observations: "18",
              },
            ],
          };
        }
        if (normalizedSql.includes("FROM traffic_counter_snapshot_history")) {
          return {
            rows: [
              {
                observations: "96",
                tracked_entities: "8",
                first_observed_at: "2026-07-01T07:00:00.000Z",
                last_observed_at: "2026-07-02T09:40:00.000Z",
                active_day_count: "2",
                notable_observations: "5",
              },
            ],
          };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    await expect(
      store.getTrafficTelemetryHistorySummary({
        from: "2026-06-30T00:00:00.000Z",
        to: "2026-07-02T23:59:59.000Z",
      }),
    ).resolves.toEqual({
      datexTravelTime: {
        observations: 144,
        trackedEntities: 12,
        firstObservedAt: "2026-06-30T09:00:00.000Z",
        lastObservedAt: "2026-07-02T09:45:00.000Z",
        activeDayCount: 3,
        notableObservations: 18,
      },
      trafficCounters: {
        observations: 96,
        trackedEntities: 8,
        firstObservedAt: "2026-07-01T07:00:00.000Z",
        lastObservedAt: "2026-07-02T09:40:00.000Z",
        activeDayCount: 2,
        notableObservations: 5,
      },
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]?.sql).toContain("FROM datex_travel_time_history");
    expect(captured[0]?.sql).toContain("observed_at >= $1");
    expect(captured[0]?.sql).toContain("observed_at <= $2");
    expect(captured[0]?.sql).toContain("count(DISTINCT corridor_id)");
    expect(captured[0]?.sql).toContain("COALESCE(delay_seconds, 0) >= 180");
    expect(captured[1]?.sql).toContain("FROM traffic_counter_snapshot_history");
    expect(captured[1]?.sql).toContain("count(DISTINCT point_id)");
    expect(captured[1]?.sql).toContain("COALESCE(anomaly_ratio, 0) >= 1.7");
    expect(captured[0]?.params).toEqual(["2026-06-30T00:00:00.000Z", "2026-07-02T23:59:59.000Z"]);
    expect(captured[1]?.params).toEqual(["2026-06-30T00:00:00.000Z", "2026-07-02T23:59:59.000Z"]);
  });

  it("PgStore ranks recurring telemetry patterns from history tables", async () => {
    const captured: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        captured.push({ sql: normalizedSql, params });
        if (normalizedSql.includes("FROM datex_travel_time_history")) {
          return {
            rows: [
              {
                source: "datex_travel_time",
                entity_id: "e6-sluppen",
                title: "E6 Sluppen",
                observation_count: "18",
                notable_observation_count: "7",
                active_day_count: "3",
                first_observed_at: new Date("2026-06-30T09:00:00.000Z"),
                last_observed_at: new Date("2026-07-02T09:45:00.000Z"),
                max_delay_seconds: 480,
                max_anomaly_ratio: null,
                geometry: null,
              },
            ],
          };
        }
        if (normalizedSql.includes("FROM traffic_counter_snapshot_history")) {
          return {
            rows: [
              {
                source: "trafikkdata",
                entity_id: "06970V72811",
                title: "Kroppanbrua",
                observation_count: "12",
                notable_observation_count: "5",
                active_day_count: "2",
                first_observed_at: "2026-07-01T07:00:00.000Z",
                last_observed_at: "2026-07-02T09:40:00.000Z",
                max_delay_seconds: null,
                max_anomaly_ratio: 2.75,
                geometry: { type: "Point", coordinates: [10.384529, 63.391793] },
              },
            ],
          };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };
    const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);

    await expect(
      store.listTrafficTelemetryPatterns({
        from: "2026-06-30T00:00:00.000Z",
        to: "2026-07-02T23:59:59.000Z",
        limit: 8,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "telemetry-pattern:datex_travel_time:e6-sluppen",
        source: "datex_travel_time",
        title: "E6 Sluppen",
        description: "Maks 8 min forsinkelse i historikken.",
        observationCount: 18,
        notableObservationCount: 7,
        activeDayCount: 3,
        firstObservedAt: "2026-06-30T09:00:00.000Z",
        lastObservedAt: "2026-07-02T09:45:00.000Z",
        maxDelaySeconds: 480,
        sourceConfidence: expect.objectContaining({ level: "uncertain" }),
      }),
      expect.objectContaining({
        id: "telemetry-pattern:trafikkdata:06970V72811",
        source: "trafikkdata",
        title: "Kroppanbrua",
        description: "Maks 2.8x normal trafikk i historikken.",
        observationCount: 12,
        notableObservationCount: 5,
        activeDayCount: 2,
        maxAnomalyRatio: 2.75,
        geometry: { type: "Point", coordinates: [10.384529, 63.391793] },
      }),
    ]);
    expect(captured[0]?.sql).toContain("FROM datex_travel_time_history");
    expect(captured[0]?.sql).toContain("GROUP BY corridor_id");
    expect(captured[0]?.sql).toContain("HAVING count(*) FILTER");
    expect(captured[0]?.sql).toContain("LIMIT $3");
    expect(captured[1]?.sql).toContain("FROM traffic_counter_snapshot_history");
    expect(captured[1]?.sql).toContain("GROUP BY point_id");
    expect(captured[1]?.sql).toContain("ST_AsGeoJSON(geometry)::json");
    expect(captured[0]?.params).toEqual([
      "2026-06-30T00:00:00.000Z",
      "2026-07-02T23:59:59.000Z",
      8,
    ]);
    expect(captured[1]?.params).toEqual([
      "2026-06-30T00:00:00.000Z",
      "2026-07-02T23:59:59.000Z",
      8,
    ]);
  });

  it("includes DATEX traffic pulse rows in PgStore operations status with stale overlay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));

    const queries: string[] = [];
    let trafficPulseParams: unknown[] | undefined;
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        queries.push(normalizedSql);

        if (normalizedSql.includes("FROM source_health")) return { rows: [] };
        if (normalizedSql.includes("FROM articles")) return { rows: [{ count: "7" }] };
        if (normalizedSql.includes("FROM situations GROUP BY status")) {
          return { rows: [{ status: "active", count: "2" }] };
        }
        if (normalizedSql.includes("GROUP BY COALESCE(payload->>'publicVisibility', 'public')")) {
          return {
            rows: [
              { publicVisibility: "public", count: "1" },
              { publicVisibility: "command_center", count: "1" },
            ],
          };
        }
        if (normalizedSql.includes("FROM ai_processing_runs")) return { rows: [] };
        if (normalizedSql.includes("FROM worker_cycle_metrics")) return { rows: [] };
        if (normalizedSql.includes("FROM datex_travel_times")) {
          trafficPulseParams = params;
          expect(normalizedSql).toContain(
            "FROM datex_travel_times ORDER BY delay_seconds DESC NULLS LAST, name ASC LIMIT $1",
          );
          return {
            rows: [
              {
                measurementTo: "not-a-date",
                payload: {
                  id: "e6-omkjoring",
                  name: "E6 Omkjøring",
                  state: "slow",
                  travelTimeSeconds: 900,
                  freeFlowSeconds: 780,
                  delaySeconds: 120,
                  measurementTo: "2026-05-28T11:30:00.000Z",
                  updatedAt: "2026-05-28T11:59:00.000Z",
                  sourceUrl: "https://example.test/datex",
                },
              },
              {
                measurementTo: "2026-05-28T11:35:00.000Z",
                payload: {
                  id: "e6-sluppen",
                  name: "E6 Sluppen",
                  state: "congested",
                  travelTimeSeconds: 700,
                  freeFlowSeconds: 600,
                  delaySeconds: 100,
                  measurementTo: "2026-05-28T11:59:00.000Z",
                  updatedAt: "2026-05-28T11:59:00.000Z",
                  sourceUrl: "https://example.test/datex",
                },
              },
              {
                measurementTo: "2026-05-28T11:58:00.000Z",
                payload: {
                  id: "rv706-stavne",
                  name: "Rv706 Stavne",
                  state: "free_flow",
                  travelTimeSeconds: 300,
                  freeFlowSeconds: 300,
                  delaySeconds: 0,
                  measurementTo: "2026-05-28T11:58:00.000Z",
                  updatedAt: "2026-05-28T11:58:00.000Z",
                  sourceUrl: "https://example.test/datex",
                },
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${normalizedSql}`);
      },
    };

    try {
      const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
      const status = await store.getOperationsStatus();

      expect(status.articleCount).toBe(7);
      expect(status.situationCounts.active).toBe(2);
      expect(status.situationPublicationCounts).toEqual({
        public: 1,
        command_center: 1,
      });
      expect(status.trafficPulse?.map((corridor) => corridor.name)).toEqual([
        "E6 Omkjøring",
        "E6 Sluppen",
        "Rv706 Stavne",
      ]);
      expect(status.trafficPulse?.map((corridor) => corridor.state)).toEqual([
        "stale",
        "stale",
        "free_flow",
      ]);
      expect(trafficPulseParams).toEqual([30]);
      expect(queries.some((sql) => sql.includes("FROM datex_travel_times"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("PgStore overlays DATEX traffic pulse stale state from updated_at fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T10:00:00.000Z"));
    const corridor: TrafficPulseCorridor = {
      id: "e6-open-ended",
      name: "E6 open ended",
      state: "slow",
      updatedAt: "2026-05-28T09:39:59.000Z",
      sourceUrl: "https://example.test/datex/travel-time/e6-open-ended",
    };
    const fakePool = {
      async query(sql: string) {
        expect(sql).toContain("updated_at");
        return {
          rows: [
            {
              payload: corridor,
              measurementTo: null,
              updatedAt: new Date("2026-05-28T09:39:59.000Z"),
            },
          ],
        };
      },
    };

    try {
      const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
      await expect(store.listTrafficPulseCorridors()).resolves.toEqual([
        { ...corridor, state: "stale" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("PgStore keeps DATEX traffic pulse fresh when column measurement_to is fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T10:00:00.000Z"));
    const corridor: TrafficPulseCorridor = {
      id: "e6-old-payload-fresh-column",
      name: "E6 old payload fresh column",
      state: "slow",
      measurementTo: "2026-05-28T09:39:59.000Z",
      updatedAt: "2026-05-28T09:55:00.000Z",
      sourceUrl: "https://example.test/datex/travel-time/e6-old-payload-fresh-column",
    };
    const fakePool = {
      async query() {
        return {
          rows: [
            {
              payload: corridor,
              measurementTo: new Date("2026-05-28T09:55:00.000Z"),
              updatedAt: new Date("2026-05-28T09:55:00.000Z"),
            },
          ],
        };
      },
    };

    try {
      const store = new PgStore(fakePool as unknown as ConstructorParameters<typeof PgStore>[0]);
      await expect(store.listTrafficPulseCorridors()).resolves.toEqual([corridor]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sanitizes private filenames before they enter downloads and export paths", () => {
    expect(safeFilename('../rapport\r\n".txt')).toBe("rapport___.txt");
    expect(safeFilename("../../")).toBe("vedlegg");
  });

  it("rejects state-changing requests without a CSRF token", async () => {
    const { app } = await testApp();
    await request(app)
      .post("/api/situations/skogbrann-bymarka/tasks")
      .send({ text: "Test" })
      .expect(403);
  });

  it("returns 404 when creating workspace records for a missing situation", async () => {
    const { agent, csrf } = await ownerAgent();
    const missingId = "missing-situation-id";

    await agent
      .post(`/api/situations/${missingId}/tasks`)
      .set("X-CSRF-Token", csrf)
      .send({ text: "Call innsatsleder" })
      .expect(404);

    await agent
      .post(`/api/situations/${missingId}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ text: "Notat" })
      .expect(404);

    await agent
      .post(`/api/situations/${missingId}/features`)
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.39, 63.39] },
        properties: { label: "Markering" },
      })
      .expect(404);
  });

  it("returns 404 when mutating workspace children under a missing situation", async () => {
    const { agent, csrf } = await ownerAgent();
    const missingId = "missing-situation-id";

    await agent
      .patch(`/api/situations/${missingId}/features/missing-feature`)
      .set("X-CSRF-Token", csrf)
      .send({ sourceItemIds: ["source:not-linked"] })
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
    await agent
      .delete(`/api/situations/${missingId}/features/missing-feature`)
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
    await agent
      .patch(`/api/situations/${missingId}/tasks/missing-task`)
      .set("X-CSRF-Token", csrf)
      .send({ completed: true })
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
    await agent
      .delete(`/api/situations/${missingId}/tasks/missing-task`)
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
    await agent
      .patch(`/api/situations/${missingId}/notes/missing-note`)
      .set("X-CSRF-Token", csrf)
      .send({ text: "Oppdatert" })
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
    await agent
      .delete(`/api/situations/${missingId}/notes/missing-note`)
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
  });

  it("returns JSON 404 responses for unknown API routes", async () => {
    const { agent } = await ownerAgent();
    const response = await agent
      .get("/api/does-not-exist")
      .expect("Content-Type", /json/)
      .expect(404);
    expect(response.body.error).toBe("API-ruten finnes ikke.");
  });

  it("sanitizes unexpected internal errors while logging server-side detail", async () => {
    const { app, store } = await testApp();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(store, "getBootstrap").mockRejectedValue(new Error("database password leaked"));

    try {
      const response = await request.agent(app).get("/api/bootstrap").expect(500);
      expect(response.body).toEqual({ error: "Intern serverfeil." });
      expect(JSON.stringify(response.body)).not.toContain("database password leaked");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not persist uploaded files when the situation is missing", async () => {
    const { app, uploadDir } = await testApp();
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);

    await agent
      .post("/api/situations/missing-situation/attachments")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .attach("file", Buffer.from("skal ikke lagres"), "missing.txt")
      .expect(404);

    await expect(readdir(uploadDir)).resolves.toEqual([]);
  });

  it("rejects workspace exports that exceed the attachment quota before building a zip", async () => {
    const { app, store } = await testApp();
    await store.addAttachment({
      id: "oversized-export-attachment",
      situationId: "skogbrann-bymarka",
      filename: "huge.bin",
      storagePath: path.join(os.tmpdir(), "does-not-need-to-exist.bin"),
      contentType: "application/octet-stream",
      size: 51 * 1024 * 1024,
      sha256: "0".repeat(64),
      createdAt: new Date().toISOString(),
    });
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);

    const response = await agent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .expect(413);

    expect(response.body.error).toBe("Arbeidsmappen er for stor til eksport.");
  });

  it("treats PostgreSQL bigint attachment sizes as numbers when enforcing export quotas", async () => {
    const { app, store, uploadDir } = await testApp();
    const paths = [
      path.join(uploadDir, "pg-size-one.txt"),
      path.join(uploadDir, "pg-size-two.txt"),
    ];
    await Promise.all(paths.map((filePath, index) => writeFile(filePath, `attachment ${index}`)));
    for (const [index, storagePath] of paths.entries()) {
      await store.addAttachment({
        id: `pg-size-${index}`,
        situationId: "skogbrann-bymarka",
        filename: `pg-size-${index}.txt`,
        storagePath,
        contentType: "text/plain",
        size: String(1024 * 1024) as unknown as number,
        sha256: createHash("sha256").update(`attachment ${index}`).digest("hex"),
        createdAt: new Date().toISOString(),
      });
    }
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);

    await agent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", session.body.csrfToken as string)
      .expect("Content-Type", /zip/)
      .expect(200);
  });

  it("rate limits abusive write bursts", async () => {
    const { agent, csrf } = await ownerAgent();
    let limited = false;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await agent
        .post("/api/situations/skogbrann-bymarka/tasks")
        .set("X-CSRF-Token", csrf)
        .send({ text: `Oppgave ${attempt}` });
      if (response.status === 429) {
        limited = true;
        expect(response.body.error).toBe("For mange forespørsler. Prøv igjen senere.");
        break;
      }
      expect(response.status).toBe(201);
    }

    expect(limited).toBe(true);
  });

  it("supports saved situation and private workspace deletion operations", async () => {
    const { agent, csrf } = await ownerAgent();
    await agent
      .put("/api/situations/skogbrann-bymarka/saved")
      .set("X-CSRF-Token", csrf)
      .expect(204);
    const workspace = await agent.get("/api/situations/skogbrann-bymarka").expect(200);
    expect(workspace.body.situation.saved).toBe(true);
    const task = await agent
      .post("/api/situations/skogbrann-bymarka/tasks")
      .set("X-CSRF-Token", csrf)
      .send({ text: "Fjern meg" })
      .expect(201);
    await agent
      .delete(`/api/situations/skogbrann-bymarka/tasks/${task.body.id}`)
      .set("X-CSRF-Token", csrf)
      .expect(204);
  });

  it("returns 404 when saving or unsaving missing articles and situations", async () => {
    const { agent, csrf } = await ownerAgent();

    await agent
      .put("/api/saved/missing-article")
      .set("X-CSRF-Token", csrf)
      .send({ saved: true })
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Saken finnes ikke."));
    await agent
      .delete("/api/saved/missing-article")
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Saken finnes ikke."));
    await agent
      .put("/api/saved/articles/missing-article")
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Saken finnes ikke."));
    await agent
      .delete("/api/saved/articles/missing-article")
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Saken finnes ikke."));
    await agent
      .put("/api/situations/missing-situation/saved")
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
    await agent
      .delete("/api/situations/missing-situation/saved")
      .set("X-CSRF-Token", csrf)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Situasjonen finnes ikke."));
  });

  it("dismisses a false-positive situation while keeping it visible in history", async () => {
    const { agent, csrf } = await ownerAgent();
    const dismissed = await agent
      .patch("/api/situations/skogbrann-bymarka/status")
      .set("X-CSRF-Token", csrf)
      .send({ status: "dismissed", dismissalReason: "false_positive" })
      .expect(200);
    expect(dismissed.body.status).toBe("dismissed");
    expect(dismissed.body.dismissalReason).toBe("false_positive");
    const active = await agent.get("/api/situations").expect(200);
    expect(active.body.items).toHaveLength(0);
    const history = await agent.get("/api/situations?status=dismissed").expect(200);
    expect(history.body.items[0].id).toBe("skogbrann-bymarka");
  });

  it("returns bounds-filtered public transport vehicles and alerts", async () => {
    const { app, store } = await testApp();
    vi.spyOn(store, "listPublicTransportVehicles").mockResolvedValue([
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
    ] satisfies PublicTransportVehicle[]);
    vi.spyOn(store, "listPublicTransportServiceAlerts").mockResolvedValue([
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
    ] satisfies PublicTransportServiceAlert[]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue([
      {
        source: "entur_vehicle_positions",
        label: "Entur kjøretøyposisjoner",
        state: "ok",
        detail: "1",
      },
      { source: "entur_service_alerts", label: "Entur avvik", state: "ok", detail: "1" },
      { source: "datex", label: "DATEX", state: "ok", detail: "ignored" },
    ] satisfies SourceHealth[]);

    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    const response = await agent
      .get(
        "/api/map/public-transport?modes=bus&includeAlerts=true&north=63.6&south=63.3&east=10.8&west=10.2",
      )
      .expect(200);

    expect(response.body.vehicles).toHaveLength(1);
    expect(response.body.alerts).toHaveLength(1);
    expect(response.body.sources.map((source: SourceHealth) => source.source)).toEqual([
      "entur_vehicle_positions",
      "entur_service_alerts",
    ]);
    expect(store.listPublicTransportVehicles).toHaveBeenCalledWith({
      modes: ["bus"],
      bounds: { north: 63.6, south: 63.3, east: 10.8, west: 10.2 },
    });
    expect(store.listPublicTransportServiceAlerts).toHaveBeenCalledWith({
      states: ["active"],
      bounds: { north: 63.6, south: 63.3, east: 10.8, west: 10.2 },
    });
  });
});
