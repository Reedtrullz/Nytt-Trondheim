import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

async function testApp(devAuthBypass = true) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-source-items-"));
  return createApp({
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
  });
}

describe("source item API", () => {
  it("rejects source item listing without an authenticated owner", async () => {
    const { app } = await testApp(false);
    await request(app).get("/api/source-items").expect(401);
    await request(app).get("/api/situations/skogbrann-bymarka/source-items").expect(401);
  });

  it("lists source items for the owner with validated filters", async () => {
    const { app } = await testApp();
    await request(app)
      .get("/api/source-items?kind=article&unlinked=true&limit=5")
      .expect(200)
      .expect((response) => {
        expect(response.body.items.length).toBeGreaterThan(0);
        expect(response.body.items[0]).toMatchObject({ kind: "article" });
        expect(response.body.items[0]).not.toHaveProperty("rawPayload");
        expect(response.body.items[0]).not.toHaveProperty("normalizedPayload");
      });

    await request(app).get("/api/source-items?kind=travel_time").expect(400);
  });

  it("returns prelinked sample source items for a situation", async () => {
    const { app } = await testApp();
    await request(app)
      .get("/api/situations/skogbrann-bymarka/source-items")
      .expect(200)
      .expect((response) => {
        expect(response.body.map((item: { externalId?: string }) => item.externalId)).toContain(
          "a-fire",
        );
        expect(response.body[0]).not.toHaveProperty("rawPayload");
        expect(response.body[0]).not.toHaveProperty("normalizedPayload");
      });
  });

  it("links and unlinks source items with CSRF and relationship validation", async () => {
    const { app } = await testApp();
    const agent = request.agent(app);
    const session = await agent.get("/api/session").expect(200);
    const csrf = session.body.csrfToken as string;
    const sourceItems = await agent.get("/api/source-items?unlinked=true&limit=1").expect(200);
    const sourceItemId = sourceItems.body.items[0].id as string;
    const encoded = encodeURIComponent(sourceItemId);

    await agent
      .post(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
      .send({ relationship: "supports" })
      .expect(403);

    await agent
      .post(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
      .set("X-CSRF-Token", csrf)
      .send({ relationship: "bad" })
      .expect(400);

    await agent
      .post(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
      .set("X-CSRF-Token", csrf)
      .send({ relationship: "supports" })
      .expect(201)
      .expect((response) => {
        expect(response.body.id).toBe(sourceItemId);
        expect(response.body.linkedSituationIds).toContain("skogbrann-bymarka");
      });

    await agent
      .delete(`/api/situations/skogbrann-bymarka/source-items/${encoded}`)
      .set("X-CSRF-Token", csrf)
      .expect(204);

    await agent
      .get("/api/situations/skogbrann-bymarka/source-items")
      .expect(200)
      .expect((response) => {
        const ids = response.body.map((item: { id: string }) => item.id);
        expect(ids).not.toContain(sourceItemId);
        expect(response.body.map((item: { externalId?: string }) => item.externalId)).toContain(
          "a-fire",
        );
      });
  });
});
