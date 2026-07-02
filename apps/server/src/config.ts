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
  rateLimitEnabled: boolean;
  webPushPublicKey?: string;
  webPushConfigured?: boolean;
  smtp?: SmtpConfig;
  emailSender?: EmailSender;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

function sessionSecretForEnvironment(nodeEnv: string): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (nodeEnv !== "production") return configured || "development-only-session-secret";
  if (!configured) throw new Error("SESSION_SECRET is required in production");
  if (configured.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }
  return configured;
}

function smtpConfigForEnvironment(nodeEnv: string): SmtpConfig | undefined {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const port = Number(process.env.SMTP_PORT ?? (process.env.SMTP_SECURE === "false" ? 587 : 465));
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== "false" : port === 465;

  if (!host && !from && nodeEnv !== "production") return undefined;
  if (!host || !from) {
    throw new Error("SMTP_HOST and SMTP_FROM are required in production.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }
  if ((user && !password) || (!user && password)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }
  return {
    host,
    port,
    secure,
    from,
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
  };
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const webPushPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || undefined;
  const webPushPrivateKeyConfigured = Boolean(process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim());
  if (nodeEnv === "production" && !databaseUrl) {
    throw new Error("DATABASE_URL is required in production");
  }
  if (nodeEnv === "production" && process.env.SEED_DEMO === "true") {
    throw new Error("SEED_DEMO must not be enabled in production");
  }
  return {
    port: Number(process.env.PORT ?? 8080),
    nodeEnv,
    publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173",
    databaseUrl,
    seedDemo: process.env.SEED_DEMO === "true" || !databaseUrl,
    devAuthBypass: nodeEnv !== "production" && process.env.DEV_AUTH_BYPASS !== "false",
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    githubAllowedLogin: process.env.GITHUB_ALLOWED_LOGIN ?? "Reedtrullz",
    sessionSecret: sessionSecretForEnvironment(nodeEnv),
    uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads"),
    runtimeStatusDir: path.resolve(process.env.RUNTIME_STATUS_DIR ?? "./data/runtime-status"),
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== "false",
    webPushPublicKey,
    webPushConfigured: Boolean(webPushPublicKey && webPushPrivateKeyConfigured),
    smtp: smtpConfigForEnvironment(nodeEnv),
  };
}
