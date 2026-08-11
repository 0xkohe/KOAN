import assert from "node:assert/strict";
import { join } from "node:path";
import type { GatewayConfig } from "../src/config.ts";
import { GatewayServer } from "../src/server.ts";

Deno.test("HTML responses apply the CSP nonce to React Router bootstrap scripts", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-static-" });
  try {
    await Deno.writeTextFile(
      join(directory, "index.html"),
      '<html><body><script>window.bootstrap = true</script><script type="module" src="/entry.js"></script></body></html>',
    );
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 8787,
      dataDir: directory,
      webDir: directory,
      allowedRoots: [directory],
      cookieName: "koan_device",
      secureCookies: false,
    };
    const server = new GatewayServer(config, {} as never, {} as never, {} as never, {} as never);

    const response = await server.handle(new Request("http://127.0.0.1:8787/"));
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/script-src 'self' 'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    const html = await response.text();
    assert.equal(html.match(new RegExp(`<script nonce="${nonce}"`, "g"))?.length, 2);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("static file misses fall back only for HTML navigation", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-static-fallback-" });
  try {
    await Deno.writeTextFile(join(directory, "index.html"), "<html><body>KOAN</body></html>");
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 8787,
      dataDir: directory,
      webDir: directory,
      allowedRoots: [directory],
      cookieName: "koan_device",
      secureCookies: false,
    };
    const server = new GatewayServer(config, {} as never, {} as never, {} as never, {} as never);

    const asset = await server.handle(new Request("http://127.0.0.1:8787/assets/old.js"));
    assert.equal(asset.status, 404);
    const navigation = await server.handle(
      new Request("http://127.0.0.1:8787/sessions/example", {
        headers: { accept: "text/html,application/xhtml+xml" },
      }),
    );
    assert.equal(navigation.status, 200);
    assert.match(await navigation.text(), /KOAN/);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});
