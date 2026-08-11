import assert from "node:assert/strict";
import { resolve } from "node:path";
import { splitPaths } from "../src/config.ts";

Deno.test("empty allowed-root entries are discarded before resolving", () => {
  assert.deepEqual(splitPaths("/tmp/root::/tmp/other:"), [
    resolve("/tmp/root"),
    resolve("/tmp/other"),
  ]);
});
