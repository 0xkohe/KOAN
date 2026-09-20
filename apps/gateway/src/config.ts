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
  defaultProjectPath?: string;
  cookieName: string;
  secureCookies: boolean;
  publicUrl?: string;
};

export function splitPaths(value: string | undefined): string[] {
  return value?.split(delimiter).filter(Boolean).map((path) => resolve(path)) ?? [];
}

export function loadConfig(): GatewayConfig {
  const dataDir = resolve(Deno.env.get("KOAN_DATA_DIR") ?? join(repoRoot, ".koan"));
  const configuredRoots = splitPaths(Deno.env.get("KOAN_ALLOWED_ROOTS"));
  const allowedRoots = configuredRoots.length ? configuredRoots : [resolve(Deno.cwd())];
  return {
    host: Deno.env.get("KOAN_HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("KOAN_PORT") ?? "18787"),
    dataDir,
    webDir: resolve(Deno.env.get("KOAN_WEB_DIR") ?? join(repoRoot, "apps/web/build/client")),
    allowedRoots,
    defaultProjectPath: resolve(Deno.env.get("KOAN_DEFAULT_PROJECT_PATH") ?? allowedRoots[0]),
    cookieName: "koan_device",
    secureCookies: Deno.env.get("KOAN_INSECURE_COOKIE") !== "1",
    publicUrl: normalizePublicUrl(Deno.env.get("KOAN_PUBLIC_URL")),
  };
}

function normalizePublicUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    return undefined;
  }
}
