import assert from "node:assert/strict";
import { PairingAuth, sha256 } from "../src/auth.ts";
import type { GatewayConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { GatewayServer } from "../src/server.ts";

Deno.test("logout revokes the authenticated device token", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-logout-" });
  try {
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 8787,
      dataDir: directory,
      webDir: directory,
      allowedRoots: [directory],
      cookieName: "koan_device",
      secureCookies: false,
    };
    const store = new Store(directory);
    const token = "device-token";
    const hash = await sha256(token);
    store.createDevice("Phone", hash);
    const server = new GatewayServer(
      config,
      store,
      new PairingAuth(store, config),
      {} as never,
      {} as never,
    );

    const response = await server.handle(
      new Request("http://127.0.0.1:8787/api/v1/auth/logout", {
        method: "POST",
        headers: {
          cookie: `koan_device=${token}`,
          origin: "http://127.0.0.1:8787",
          "x-koan-csrf": "1",
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(store.deviceByHash(hash), null);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});
