import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { listenOnIPv4 } from "./http-test-app.js";

const owned: Server[] = [];

async function listenControl(body: string) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.end(body);
  });
  owned.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { hits, port: (server.address() as AddressInfo).port };
}

afterEach(async () => {
  await Promise.all(
    owned.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

const app = (_req: unknown, res: { end(body: string): void }) => res.end("app");

describe("http test app listener", () => {
  it("listens on 127.0.0.1 and serves Supertest requests and agents", async () => {
    const server = await listenOnIPv4(app);
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    expect((await request(server).get("/x").expect(200)).text).toBe("app");
    expect((await request.agent(server).get("/y").expect(200)).text).toBe("app");
  });

  it("rejects instead of routing to an owned IPv4 listener on the same port", async () => {
    const control = await listenControl("control");
    await expect(listenOnIPv4(app, control.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(control.hits).toEqual([]);
  });

  it("answers from the app while an owned control listener exists", async () => {
    const control = await listenControl("control");
    const server = await listenOnIPv4(app);
    expect((server.address() as AddressInfo).port).not.toBe(control.port);
    expect((await request(server).get("/z").expect(200)).text).toBe("app");
    expect(control.hits).toEqual([]);
  });

  it("repeats startup and teardown without leaking ports", async () => {
    const ports: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const server = await listenOnIPv4(app);
      ports.push((server.address() as AddressInfo).port);
      await request(server).get("/").expect(200);
    }
    expect(ports).toHaveLength(3);
  });
});
