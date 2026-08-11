import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "jsdom", setupFiles: [], exclude: ["e2e/**", "node_modules/**"] } });
