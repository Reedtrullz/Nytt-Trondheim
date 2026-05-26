import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8080/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DEV_AUTH_BYPASS: "true", NODE_ENV: "development" },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1024 } },
    },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
