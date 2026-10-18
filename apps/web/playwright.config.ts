import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    // These tests mock the API; a PWA service worker must not bypass the routes.
    serviceWorkers: "block",
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // CI builds first. Preview avoids Vite's cold dependency compilation/reloads.
    command: process.env.CI
      ? "pnpm --filter @koan/web exec vite preview --host 127.0.0.1 --port 4175 --strictPort"
      : "pnpm --filter @koan/web dev --port 4175 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:4175/pair",
    reuseExistingServer: !process.env.CI,
  },
});
