import test from "node:test";
import assert from "node:assert/strict";
import {
  detectTailscaleServeUrl,
  findTailscaleServeUrl,
  normalizePublicUrl,
} from "./tailscale.mjs";

test("normalizePublicUrl accepts web URLs and rejects invalid configuration", () => {
  assert.equal(
    normalizePublicUrl("https://koan-machine.example.ts.net/koan?ignored=yes#fragment"),
    "https://koan-machine.example.ts.net/koan/",
  );
  assert.equal(normalizePublicUrl("not a URL"), null);
  assert.equal(normalizePublicUrl("ftp://koan-machine.example.ts.net/"), null);
});

test("findTailscaleServeUrl finds the HTTPS route proxying to KOAN", () => {
  const config = {
    TCP: { 443: { HTTPS: true } },
    Web: {
      "koan-machine.example.ts.net:443": {
        Handlers: { "/": { Proxy: "http://localhost:18787" } },
      },
    },
  };

  assert.equal(
    findTailscaleServeUrl(config, 18787),
    "https://koan-machine.example.ts.net/",
  );
});

test("findTailscaleServeUrl ignores a route for another local service", () => {
  const config = {
    Web: {
      "koan-machine.example.ts.net:443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } },
      },
    },
  };

  assert.equal(findTailscaleServeUrl(config, 18787), null);
});

test("detectTailscaleServeUrl reports when Tailscale needs login", async () => {
  const execute = async () => ({
    stdout: JSON.stringify({ BackendState: "NeedsLogin" }),
  });

  assert.deepEqual(
    await detectTailscaleServeUrl(18787, execute),
    { url: null, reason: "not-logged-in" },
  );
});

test("detectTailscaleServeUrl recognizes logged-out CLI errors", async () => {
  const execute = async () => {
    const error = new Error("tailscale status failed");
    error.stderr = "Logged out.";
    throw error;
  };

  assert.deepEqual(
    await detectTailscaleServeUrl(18787, execute),
    { url: null, reason: "not-logged-in" },
  );
});

test("detectTailscaleServeUrl reads Serve routes after checking login", async () => {
  const calls = [];
  const execute = async (_command, args) => {
    calls.push(args);
    if (args[0] === "status") {
      return { stdout: JSON.stringify({ BackendState: "Running" }) };
    }
    return {
      stdout: JSON.stringify({
        Web: {
          "koan-machine.example.ts.net:443": {
            Handlers: { "/": { Proxy: "http://localhost:18787" } },
          },
        },
      }),
    };
  };

  assert.deepEqual(
    await detectTailscaleServeUrl(18787, execute),
    { url: "https://koan-machine.example.ts.net/", reason: null },
  );
  assert.deepEqual(calls, [["status", "--json"], ["serve", "status", "--json"]]);
});
