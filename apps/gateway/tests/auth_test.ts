import assert from "node:assert/strict";
import { PairingAuth, pruneExpiredAttempts } from "../src/auth.ts";
import type { GatewayConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";

Deno.test("pairing rate limits discard expired client buckets", () => {
  const attempts = new Map([
    ["expired", { count: 8, resetAt: 100 }],
    ["active", { count: 2, resetAt: 101 }],
  ]);

  pruneExpiredAttempts(attempts, 100);

  assert.deepEqual([...attempts], [["active", { count: 2, resetAt: 101 }]]);
});

Deno.test("pairing enforces every supplied rate-limit bucket", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-auth-limit-" });
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
    const auth = new PairingAuth(store, config);
    for (let index = 0; index < 8; index++) {
      assert.equal(
        await auth.pair("invalid", "Phone", ["peer:127.0.0.1", `tailscale-user:user-${index}`]),
        null,
      );
    }
    await assert.rejects(
      () => auth.pair("invalid", "Phone", ["peer:127.0.0.1", "tailscale-user:another"]),
      /RATE_LIMITED/,
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});
