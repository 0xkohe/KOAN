import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { JsonLineRpc } from "../src/agents/json-lines.ts";

Deno.test("JSON line transport resolves RPC and tolerates unknown notifications", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/fake_rpc.ts", import.meta.url));
  const rpc = new JsonLineRpc("deno", ["run", "--quiet", fixture], Deno.cwd());
  const notified = Promise.withResolvers<string>();
  rpc.onNotification = (message) => notified.resolve(String(message.method));
  const result = await rpc.call("initialize", {});
  assert.equal(result.echoedMethod, "initialize");
  assert.equal(await notified.promise, "unknown/futureEvent");
  await rpc.stop();
});

Deno.test("JSON line transport rejects pending RPCs when a child exits during a request", async () => {
  const child = [
    "await Deno.stdin.readable.getReader().read();",
    'console.log(JSON.stringify({ id: 99, method: "approval", params: {} }));',
  ].join("\n");
  const rpc = new JsonLineRpc("deno", ["eval", child], Deno.cwd());
  rpc.onRequest = () => new Promise(() => {});

  await assert.rejects(() => rpc.call("session/prompt"), /Agent process closed/);
  await rpc.stop();
});

Deno.test("JSON line transport adds the JSON-RPC version when requested", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/fake_rpc.ts", import.meta.url));
  const rpc = new JsonLineRpc("deno", ["run", "--quiet", fixture], Deno.cwd(), {
    jsonRpcVersion: "2.0",
  });

  const result = await rpc.call("initialize", {});

  assert.equal(result.jsonRpcVersion, "2.0");
  await rpc.stop();
});

Deno.test("JSON line transport closes stdin so launcher descendants can exit", async () => {
  const child = "await Deno.stdin.readable.getReader().read();";
  const launcher = [
    `const child = new Deno.Command("deno", { args: ["eval", ${JSON.stringify(child)}], stdin: "inherit", stdout: "inherit", stderr: "inherit" }).spawn();`,
    "await child.status;",
  ].join("\n");
  const rpc = new JsonLineRpc("deno", ["eval", launcher], Deno.cwd());

  await rpc.stop();
});
