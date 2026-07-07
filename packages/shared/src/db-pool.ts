export type DatabasePoolRole = "server" | "worker" | "migration";

export interface DatabasePoolOptions {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  maxLifetimeSeconds: number;
}

type EnvMap = Record<string, string | undefined>;

const defaults: Record<DatabasePoolRole, DatabasePoolOptions> = {
  server: {
    max: 6,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 300,
  },
  worker: {
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 15_000,
    maxLifetimeSeconds: 180,
  },
  migration: {
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    maxLifetimeSeconds: 60,
  },
};

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function rolePrefix(role: DatabasePoolRole): string {
  return role.toUpperCase();
}

export function buildDatabasePoolOptions(
  role: DatabasePoolRole,
  env: EnvMap = typeof process === "undefined" ? {} : process.env,
): DatabasePoolOptions {
  const roleEnvPrefix = rolePrefix(role);
  const base = defaults[role];
  return {
    max:
      parsePositiveInt(env[`NYTT_${roleEnvPrefix}_DB_POOL_MAX`]) ??
      parsePositiveInt(env.NYTT_DB_POOL_MAX) ??
      base.max,
    connectionTimeoutMillis:
      parsePositiveInt(env[`NYTT_${roleEnvPrefix}_DB_CONNECTION_TIMEOUT_MS`]) ??
      parsePositiveInt(env.NYTT_DB_CONNECTION_TIMEOUT_MS) ??
      base.connectionTimeoutMillis,
    idleTimeoutMillis:
      parsePositiveInt(env[`NYTT_${roleEnvPrefix}_DB_IDLE_TIMEOUT_MS`]) ??
      parsePositiveInt(env.NYTT_DB_IDLE_TIMEOUT_MS) ??
      base.idleTimeoutMillis,
    maxLifetimeSeconds:
      parsePositiveInt(env[`NYTT_${roleEnvPrefix}_DB_MAX_LIFETIME_SECONDS`]) ??
      parsePositiveInt(env.NYTT_DB_MAX_LIFETIME_SECONDS) ??
      base.maxLifetimeSeconds,
  };
}
