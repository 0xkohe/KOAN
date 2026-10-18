import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4175", trace: "on-first-retry" },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm --filter @koan/web dev --port 4175 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:4175/pair",
    reuseExistingServer: !process.env.CI,
  },
});
