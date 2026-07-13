import type { ClientConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  assertCoverageProjectionReady,
  createDatabaseReadinessProbe,
  probeDatabaseReadiness,
  type DatabaseReadinessClient,
} from "../src/readiness.js";

function clientFixture(
  input: {
    connectError?: Error;
    queryError?: Error;
    endError?: Error;
  } = {},
): DatabaseReadinessClient & {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  return {
    connect: input.connectError
      ? vi.fn().mockRejectedValue(input.connectError)
      : vi.fn().mockResolvedValue(undefined),
    query: input.queryError
      ? vi.fn().mockRejectedValue(input.queryError)
      : vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    end: input.endError
      ? vi.fn().mockRejectedValue(input.endError)
      : vi.fn().mockResolvedValue(undefined),
  };
}

describe("database readiness probe", () => {
  it("accepts a clean completed current active v2 coverage projection", () => {
    expect(() =>
      assertCoverageProjectionReady({
        generationValid: true,
        integrityErrorCount: 0,
        parityClean: true,
      }),
    ).not.toThrow();
  });

  it.each([
    ["missing generation", { generationValid: false, integrityErrorCount: 0, parityClean: true }],
    [
      "wrong matcher",
      {
        generationValid: false,
        integrityErrorCount: 0,
        parityClean: true,
      },
    ],
    [
      "dirty integrity",
      {
        generationValid: true,
        integrityErrorCount: 1,
        parityClean: true,
      },
    ],
    [
      "dirty base parity",
      {
        generationValid: true,
        integrityErrorCount: 0,
        parityClean: false,
      },
    ],
  ])("rejects normalized-active readiness for %s", (_label, projection) => {
    expect(() => assertCoverageProjectionReady(projection)).toThrow(
      "Normalized coverage projection is not ready",
    );
  });

  it("bounds connection and query work with a dedicated PostgreSQL client", async () => {
    const client = clientFixture();
    let capturedConfig: ClientConfig | undefined;

    await probeDatabaseReadiness(
      "postgresql://example.invalid/nytt",
      { connectionTimeoutMs: 250, statementTimeoutMs: 750 },
      (config) => {
        capturedConfig = config;
        return client;
      },
    );

    expect(capturedConfig).toMatchObject({
      connectionTimeoutMillis: 250,
      statement_timeout: 750,
      query_timeout: 1_250,
      application_name: "nytt-readiness",
    });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith("SELECT 1");
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("closes the dedicated client after a connection failure", async () => {
    const failure = new Error("connection timed out");
    const client = clientFixture({ connectError: failure });

    await expect(
      probeDatabaseReadiness("postgresql://example.invalid/nytt", {}, () => client),
    ).rejects.toThrow(failure.message);

    expect(client.query).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("closes the dedicated client after PostgreSQL cancels the statement", async () => {
    const failure = new Error("canceling statement due to statement timeout");
    const client = clientFixture({ queryError: failure });

    await expect(
      probeDatabaseReadiness("postgresql://example.invalid/nytt", {}, () => client),
    ).rejects.toThrow(failure.message);

    expect(client.end).toHaveBeenCalledOnce();
  });

  it("reports a close failure when the probe itself succeeded", async () => {
    const failure = new Error("socket close failed");
    const client = clientFixture({ endError: failure });

    await expect(
      probeDatabaseReadiness("postgresql://example.invalid/nytt", {}, () => client),
    ).rejects.toThrow(failure.message);
  });

  it("coalesces concurrent probes and briefly caches a success", async () => {
    let releaseConnect: (() => void) | undefined;
    const client = clientFixture();
    client.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseConnect = resolve;
        }),
    );
    const factory = vi.fn(() => client);
    const probe = createDatabaseReadinessProbe(
      "postgresql://example.invalid/nytt",
      { successCacheMs: 1_000 },
      factory,
    );

    const first = probe();
    const concurrent = probe();
    expect(factory).toHaveBeenCalledOnce();
    releaseConnect?.();
    await Promise.all([first, concurrent]);
    await probe();

    expect(factory).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledOnce();
  });

  it("does not cache a failed probe", async () => {
    const failedClient = clientFixture({ queryError: new Error("database unavailable") });
    const healthyClient = clientFixture();
    const factory = vi.fn().mockReturnValueOnce(failedClient).mockReturnValueOnce(healthyClient);
    const probe = createDatabaseReadinessProbe("postgresql://example.invalid/nytt", {}, factory);

    await expect(probe()).rejects.toThrow("database unavailable");
    await expect(probe()).resolves.toBeUndefined();

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
