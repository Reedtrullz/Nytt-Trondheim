import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

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

describe("private situation API", () => {
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

  it("forces user map drawings into the private layer", async () => {
    const { app } = await testApp();
    const response = await request(app)
      .post("/api/situations/skogbrann-bymarka/features")
      .send({
        geometry: { type: "Point", coordinates: [10.3, 63.4] },
        properties: { label: "Mitt punkt", provenance: "official" },
      })
      .expect(201);
    expect(response.body.properties.provenance).toBe("private_annotation");
  });

  it("provides owner data and exports a protected workspace zip", async () => {
    const { app } = await testApp();
    await request(app)
      .get("/api/bootstrap")
      .expect(200)
      .expect((response) => {
        expect(response.body.articles.length).toBeGreaterThan(0);
      });
    await request(app)
      .get("/api/situations/skogbrann-bymarka/export")
      .expect("Content-Type", /zip/)
      .expect(200);
  });

  it("stores uploaded private attachment metadata with a content checksum", async () => {
    const { app } = await testApp();
    const bytes = Buffer.from("privat vedlegg");
    const response = await request(app)
      .post("/api/situations/skogbrann-bymarka/attachments")
      .attach("file", bytes, "notat.txt")
      .expect(201);
    expect(response.body.filename).toBe("notat.txt");
    expect(response.body.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
