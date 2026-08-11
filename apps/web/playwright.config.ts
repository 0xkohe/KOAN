import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry" },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: { command: "pnpm dev:web", cwd: "../..", url: "http://127.0.0.1:5173/pair", reuseExistingServer: true },
});
