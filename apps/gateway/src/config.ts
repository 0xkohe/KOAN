import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

export type GatewayConfig = {
  host: string;
  port: number;
  dataDir: string;
  webDir: string;
  allowedRoots: string[];
  cookieName: string;
  secureCookies: boolean;
};

export function splitPaths(value: string | undefined): string[] {
  return value?.split(delimiter).filter(Boolean).map((path) => resolve(path)) ?? [];
}

export function loadConfig(): GatewayConfig {
  const dataDir = resolve(Deno.env.get("KOAN_DATA_DIR") ?? join(repoRoot, ".koan"));
  const configuredRoots = splitPaths(Deno.env.get("KOAN_ALLOWED_ROOTS"));
  return {
    host: Deno.env.get("KOAN_HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("KOAN_PORT") ?? "8787"),
    dataDir,
    webDir: resolve(Deno.env.get("KOAN_WEB_DIR") ?? join(repoRoot, "apps/web/build/client")),
    allowedRoots: configuredRoots.length ? configuredRoots : [resolve(Deno.cwd())],
    cookieName: "koan_device",
    secureCookies: Deno.env.get("KOAN_INSECURE_COOKIE") !== "1",
  };
}
