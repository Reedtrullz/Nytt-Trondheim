import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalEnv = { ...process.env };

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  process.env = { ...originalEnv };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    process.env = { ...originalEnv };
  }
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig session secret policy", () => {
  it("keeps a development-only fallback outside production", () => {
    withEnv({ NODE_ENV: "development", SESSION_SECRET: undefined }, () => {
      expect(loadConfig().sessionSecret).toBe("development-only-session-secret");
    });
  });

  it("requires SESSION_SECRET in production", () => {
    withEnv(
      {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://nytt:test@localhost:5432/nytt",
        SESSION_SECRET: undefined,
      },
      () => {
        expect(() => loadConfig()).toThrow(/SESSION_SECRET is required in production/);
      },
    );
  });

  it("requires a high-entropy SESSION_SECRET in production", () => {
    withEnv(
      {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://nytt:test@localhost:5432/nytt",
        SESSION_SECRET: "short",
      },
      () => {
        expect(() => loadConfig()).toThrow(/SESSION_SECRET must be at least 32 characters/);
      },
    );
  });

  it("requires persistent Postgres storage in production", () => {
    withEnv(
      {
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(32),
        DATABASE_URL: undefined,
      },
      () => {
        expect(() => loadConfig()).toThrow(/DATABASE_URL is required in production/);
      },
    );
  });

  it("rejects demo seeding in production", () => {
    withEnv(
      {
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(32),
        DATABASE_URL: "postgres://nytt:test@localhost:5432/nytt",
        SEED_DEMO: "true",
      },
      () => {
        expect(() => loadConfig()).toThrow(/SEED_DEMO must not be enabled in production/);
      },
    );
  });
});
