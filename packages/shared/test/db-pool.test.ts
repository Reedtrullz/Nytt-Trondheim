import { describe, expect, it } from "vitest";
import { buildDatabasePoolOptions } from "../src/db-pool.js";

describe("database pool policy", () => {
  it("bounds server and worker pools with fast connection timeouts", () => {
    const server = buildDatabasePoolOptions("server", {});
    const worker = buildDatabasePoolOptions("worker", {});

    expect(server).toMatchObject({
      max: 6,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      maxLifetimeSeconds: 300,
    });
    expect(worker).toMatchObject({
      max: 3,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 15_000,
      maxLifetimeSeconds: 180,
    });
    expect(worker.max).toBeLessThan(server.max);
  });

  it("allows role-specific production overrides without accepting invalid values", () => {
    const worker = buildDatabasePoolOptions("worker", {
      NYTT_DB_POOL_MAX: "8",
      NYTT_WORKER_DB_POOL_MAX: "2",
      NYTT_DB_CONNECTION_TIMEOUT_MS: "2500",
      NYTT_DB_IDLE_TIMEOUT_MS: "5000",
      NYTT_DB_MAX_LIFETIME_SECONDS: "90",
    });
    const server = buildDatabasePoolOptions("server", {
      NYTT_DB_POOL_MAX: "8",
      NYTT_SERVER_DB_POOL_MAX: "not-a-number",
      NYTT_DB_CONNECTION_TIMEOUT_MS: "-1",
    });

    expect(worker).toMatchObject({
      max: 2,
      connectionTimeoutMillis: 2_500,
      idleTimeoutMillis: 5_000,
      maxLifetimeSeconds: 90,
    });
    expect(server.max).toBe(8);
    expect(server.connectionTimeoutMillis).toBe(5_000);
  });
});
