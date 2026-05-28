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
  });
}

describe("source item API", () => {
  it("rejects source item listing without an authenticated owner", async () => {
    const { app } = await testApp(false);
    await request(app).get("/api/source-items").expect(401);
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

  it("returns an empty linked-source list for a situation with no linked items", async () => {
    const { app } = await testApp();
    await request(app).get("/api/situations/skogbrann-bymarka/source-items").expect(200, []);
  });
});
