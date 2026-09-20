import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function normalizePublicUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    return null;
  }
}

export function findTailscaleServeUrl(config, port) {
  if (!config || typeof config !== "object" || !config.Web || typeof config.Web !== "object") {
    return null;
  }

  for (const [authority, web] of Object.entries(config.Web)) {
    if (!web || typeof web !== "object" || !web.Handlers || typeof web.Handlers !== "object") {
      continue;
    }
    for (const [path, handler] of Object.entries(web.Handlers)) {
      if (!handler || typeof handler !== "object" || !proxiesToPort(handler.Proxy, port)) continue;
      const url = new URL(`https://${authority}`);
      url.pathname = path.endsWith("/") ? path : `${path}/`;
      return url.toString();
    }
  }
  return null;
}

export async function detectTailscaleServeUrl(port, execute = execFileAsync) {
  try {
    const options = {
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
    };
    const status = await execute("tailscale", ["status", "--json"], options);
    if (JSON.parse(status.stdout).BackendState === "NeedsLogin") {
      return { url: null, reason: "not-logged-in" };
    }

    const { stdout } = await execute("tailscale", ["serve", "status", "--json"], options);
    return {
      url: findTailscaleServeUrl(JSON.parse(stdout), port),
      reason: null,
    };
  } catch (error) {
    return {
      url: null,
      reason: error?.code === "ENOENT"
        ? "missing"
        : isLoginError(error)
        ? "not-logged-in"
        : "unavailable",
    };
  }
}

function isLoginError(error) {
  const detail = [error?.message, error?.stdout, error?.stderr].filter(Boolean).join("\n");
  return /needs.?login|not logged in|logged out|login required/i.test(detail);
}

function proxiesToPort(proxy, port) {
  if (typeof proxy !== "string") return false;
  try {
    const target = new URL(proxy);
    const loopback = target.hostname === "localhost" || target.hostname === "127.0.0.1" ||
      target.hostname === "[::1]";
    const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    return loopback && targetPort === Number(port);
  } catch {
    return false;
  }
}
