import pg, { type ClientConfig } from "pg";

const defaultConnectionTimeoutMs = 1_000;
const defaultStatementTimeoutMs = 1_000;
const defaultSuccessCacheMs = 1_000;
const queryTimeoutGraceMs = 500;

export interface DatabaseReadinessOptions {
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  successCacheMs?: number;
}

export interface DatabaseReadinessClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
}

export type DatabaseReadinessClientFactory = (config: ClientConfig) => DatabaseReadinessClient;

function positiveMilliseconds(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function defaultClientFactory(config: ClientConfig): DatabaseReadinessClient {
  return new pg.Client(config);
}

export async function probeDatabaseReadiness(
  connectionString: string,
  options: DatabaseReadinessOptions = {},
  clientFactory: DatabaseReadinessClientFactory = defaultClientFactory,
): Promise<void> {
  const connectionTimeoutMs = positiveMilliseconds(
    options.connectionTimeoutMs,
    defaultConnectionTimeoutMs,
  );
  const statementTimeoutMs = positiveMilliseconds(
    options.statementTimeoutMs,
    defaultStatementTimeoutMs,
  );
  const client = clientFactory({
    connectionString,
    connectionTimeoutMillis: connectionTimeoutMs,
    statement_timeout: statementTimeoutMs,
    // PostgreSQL gets the first chance to cancel execution. This slightly longer client deadline
    // bounds a broken connection after the server-side statement deadline has elapsed.
    query_timeout: statementTimeoutMs + queryTimeoutGraceMs,
    application_name: "nytt-readiness",
  });
  let failure: Error | undefined;

  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (error) {
    failure = asError(error);
  }

  try {
    await client.end();
  } catch (error) {
    failure ??= asError(error);
  }

  if (failure) throw failure;
}

export function createDatabaseReadinessProbe(
  connectionString: string,
  options: DatabaseReadinessOptions = {},
  clientFactory: DatabaseReadinessClientFactory = defaultClientFactory,
): () => Promise<void> {
  const successCacheMs = positiveMilliseconds(options.successCacheMs, defaultSuccessCacheMs);
  let inFlight: Promise<void> | undefined;
  let lastSuccessAt = Number.NEGATIVE_INFINITY;

  return async () => {
    if (Date.now() - lastSuccessAt < successCacheMs) return;
    if (inFlight) return inFlight;

    inFlight = probeDatabaseReadiness(connectionString, options, clientFactory);
    try {
      await inFlight;
      lastSuccessAt = Date.now();
    } finally {
      inFlight = undefined;
    }
  };
}
