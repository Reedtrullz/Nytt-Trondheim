import path from "node:path";

export interface AppConfig {
  port: number;
  nodeEnv: string;
  publicOrigin: string;
  databaseUrl?: string;
  seedDemo: boolean;
  devAuthBypass: boolean;
  githubClientId?: string;
  githubClientSecret?: string;
  githubAllowedLogin: string;
  sessionSecret: string;
  uploadDir: string;
  runtimeStatusDir: string;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return {
    port: Number(process.env.PORT ?? 8080),
    nodeEnv,
    publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173",
    databaseUrl: process.env.DATABASE_URL,
    seedDemo: process.env.SEED_DEMO === "true" || !process.env.DATABASE_URL,
    devAuthBypass: nodeEnv !== "production" && process.env.DEV_AUTH_BYPASS !== "false",
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    githubAllowedLogin: process.env.GITHUB_ALLOWED_LOGIN ?? "Reedtrullz",
    sessionSecret: process.env.SESSION_SECRET ?? "development-only-session-secret",
    uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads"),
    runtimeStatusDir: path.resolve(process.env.RUNTIME_STATUS_DIR ?? "./data/runtime-status"),
  };
}
