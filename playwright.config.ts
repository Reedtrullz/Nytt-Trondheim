import { defineConfig, devices } from "@playwright/test";

const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? "5176";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "18080";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;
const readinessURL = process.env.PLAYWRIGHT_READY_URL ?? `http://127.0.0.1:${apiPort}/health/live`;
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  `concurrently -n api,web "PORT=${apiPort} npm run dev -w @nytt/server" "VITE_API_TARGET=http://127.0.0.1:${apiPort} npm run dev -w @nytt/frontend -- --host 127.0.0.1 --port ${frontendPort} --strictPort"`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // Correction journeys mutate the one deterministic MemoryStore owned by the shared web server.
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: readinessURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
    env: {
      DEV_AUTH_BYPASS: "true",
      E2E_COVERAGE_FIXTURES: "true",
      NODE_ENV: "development",
      PUBLIC_ORIGIN: baseURL,
      RATE_LIMIT_ENABLED: "false",
      COVERAGE_CORRECTIONS_ENABLED: "true",
      COVERAGE_PROJECTION_MODE: "normalized-active",
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1024 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
