import assert from "node:assert/strict";
import { join } from "node:path";
import { probeCommandVersion } from "../src/agents/manager.ts";

Deno.test("agent version probes time out and terminate an unresponsive executable", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-probe-" });
  try {
    const command = join(directory, "hanging-agent");
    Deno.writeTextFileSync(command, "#!/bin/sh\nwhile :; do :; done\n");
    Deno.chmodSync(command, 0o700);

    const startedAt = Date.now();
    assert.equal(await probeCommandVersion(command, 50), null);
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});
