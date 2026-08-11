import assert from "node:assert/strict";
import { join } from "node:path";
import type { GatewayConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import {
  GatewayServer,
  isUtf8TextAttachment,
  pairingRateLimitKeys,
  parseWsClientMessage,
  readFormDataBounded,
} from "../src/server.ts";

Deno.test("multipart bodies are rejected before exceeding the upload buffer limit", async () => {
  const request = new Request("http://localhost/api/v1/attachments", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body: new Uint8Array(9),
  });
  assert.equal(request.headers.get("content-length"), null);
  await assert.rejects(() => readFormDataBounded(request, 8), /UPLOAD_TOO_LARGE/);
});

Deno.test("bounded multipart bodies are parsed normally", async () => {
  const source = new FormData();
  source.set("sessionId", "session");
  source.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
  const request = new Request("http://localhost/api/v1/attachments", {
    method: "POST",
    body: source,
  });
  const parsed = await readFormDataBounded(request, 1024);
  assert.equal(parsed.get("sessionId"), "session");
  assert.equal((parsed.get("file") as File).name, "hello.txt");
});

Deno.test("UTF-8 coding files are accepted when browser MIME types are unreliable", () => {
  const contents = new TextEncoder().encode("const value = 1;\n");
  assert.equal(isUtf8TextAttachment(new File([contents], ".env", { type: "" }), contents), true);
  assert.equal(
    isUtf8TextAttachment(new File([contents], "main.ts", { type: "video/mp2t" }), contents),
    true,
  );
  assert.equal(
    isUtf8TextAttachment(new File([new Uint8Array([0xff])], "main.ts"), new Uint8Array([0xff])),
    false,
  );
});

Deno.test("failed attachment metadata insertion removes the uploaded file", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-upload-cleanup-" });
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
    const server = new GatewayServer(
      config,
      store,
      { authenticate: () => Promise.resolve({ id: "device" }) } as never,
      {} as never,
      {} as never,
    );
    const form = new FormData();
    form.set("sessionId", "missing-session");
    form.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));

    const response = await server.handle(
      new Request("http://127.0.0.1:8787/api/v1/attachments", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:8787", "x-koan-csrf": "1" },
        body: form,
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual([...Deno.readDirSync(join(directory, "attachments"))], []);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("pairing requests reject oversized streaming bodies", async () => {
  const config: GatewayConfig = {
    host: "127.0.0.1",
    port: 8787,
    dataDir: "/tmp",
    webDir: "/tmp",
    allowedRoots: ["/tmp"],
    cookieName: "koan_device",
    secureCookies: false,
  };
  const server = new GatewayServer(config, {} as never, {} as never, {} as never, {} as never);
  const response = await server.handle(
    new Request("http://127.0.0.1:8787/api/v1/auth/pair", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:8787" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4097));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit),
  );

  assert.equal(response.status, 413);
});

Deno.test("WebSocket messages reject malformed JSON values", () => {
  assert.equal(parseWsClientMessage(null), null);
  assert.equal(parseWsClientMessage({ type: "subscribe", cursors: null }), null);
  assert.equal(parseWsClientMessage({ type: "subscribe", cursors: { session: -1 } }), null);
  assert.deepEqual(parseWsClientMessage({ type: "subscribe", cursors: { session: 4 } }), {
    type: "subscribe",
    cursors: { session: 4 },
  });
});

Deno.test("pairing rate limits ignore spoofed forwarding headers", () => {
  const first = new Request("http://localhost/api/v1/auth/pair", {
    headers: { "x-forwarded-for": "198.51.100.1" },
  });
  const second = new Request("http://localhost/api/v1/auth/pair", {
    headers: { "x-forwarded-for": "203.0.113.2" },
  });

  assert.deepEqual(pairingRateLimitKeys(first, "100.64.0.10"), ["peer:100.64.0.10"]);
  assert.deepEqual(pairingRateLimitKeys(second, "100.64.0.10"), ["peer:100.64.0.10"]);
});

Deno.test("pairing rate limits trust Tailscale identity only from loopback", () => {
  const request = new Request("http://localhost/api/v1/auth/pair", {
    headers: { "tailscale-user-login": " Alice@Example.com " },
  });

  assert.deepEqual(pairingRateLimitKeys(request, "127.0.0.1"), [
    "peer:127.0.0.1",
    "tailscale-user:alice@example.com",
  ]);
  assert.deepEqual(pairingRateLimitKeys(request, "::1"), [
    "peer:::1",
    "tailscale-user:alice@example.com",
  ]);
  assert.deepEqual(pairingRateLimitKeys(request, "100.64.0.10"), ["peer:100.64.0.10"]);
});
