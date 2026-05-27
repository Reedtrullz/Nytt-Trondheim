import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authorizeGitHubProfile } from "../src/auth.js";
import { safeFilename } from "../src/export.js";

async function testApp() {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-uploads-"));
  return createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
  });
}

async function ownerAgent() {
  const { app } = await testApp();
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

describe("private situation API", () => {
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
    });
    await request(app).get("/api/bootstrap").expect(401);
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
    });
    const response = await request.agent(app).get("/auth/github").expect(302);
    const target = new URL(response.headers.location as string);
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("scope")).toBeNull();
  });

  it("forces user map drawings into the private layer", async () => {
    const { agent, csrf } = await ownerAgent();
    const response = await agent
      .post("/api/situations/skogbrann-bymarka/features")
      .set("X-CSRF-Token", csrf)
      .send({
        geometry: { type: "Point", coordinates: [10.3, 63.4] },
        properties: { label: "Mitt punkt", provenance: "official" },
      })
      .expect(201);
    expect(response.body.properties.provenance).toBe("private_annotation");
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
      });
    await agent
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.articles.length).toBeGreaterThan(0);
      });
    const created = await agent
      .post("/api/situations/skogbrann-bymarka/exports")
      .set("X-CSRF-Token", csrf)
      .expect("Content-Type", /zip/)
      .expect(200);
    await agent
      .get(created.headers.location as string)
      .expect("Content-Type", /zip/)
      .expect(200);
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
});
