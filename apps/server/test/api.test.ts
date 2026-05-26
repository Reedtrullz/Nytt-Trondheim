import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authorizeGitHubProfile } from "../src/auth.js";

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
    });
    const response = await request.agent(app).get("/auth/github").expect(302);
    const target = new URL(response.headers.location as string);
    expect(target.searchParams.get("state")).toBeTruthy();
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
});
