import { defineConfig, devices } from "@playwright/test";

const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? "5176";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "18080";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;
const healthURL = process.env.PLAYWRIGHT_HEALTH_URL ?? `http://127.0.0.1:${apiPort}/health`;
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  `concurrently -n api,web "PORT=${apiPort} npm run dev -w @nytt/server" "VITE_API_TARGET=http://127.0.0.1:${apiPort} npm run dev -w @nytt/frontend -- --host 127.0.0.1 --port ${frontendPort} --strictPort"`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: healthURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
    env: {
      DEV_AUTH_BYPASS: "true",
      NODE_ENV: "development",
      PUBLIC_ORIGIN: baseURL,
      RATE_LIMIT_ENABLED: "false",
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1024 } },
    },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
