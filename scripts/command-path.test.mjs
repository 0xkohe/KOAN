import assert from "node:assert/strict";
import test from "node:test";
import { delimiter, resolve } from "node:path";
import { claudeSdkExecutableName, findExecutable, splitPathList } from "./command-path.mjs";

test("splitPathList discards empty permission entries", () => {
  assert.deepEqual(splitPathList("/srv/repos::/opt/code:", ":"), ["/srv/repos", "/opt/code"]);
});

test("claudeSdkExecutableName includes the Windows suffix", () => {
  assert.equal(claudeSdkExecutableName("win32"), "claude.exe");
  assert.equal(claudeSdkExecutableName("linux"), "claude");
});

test("findExecutable honors PATHEXT on Windows", async () => {
  const directories = [resolve("first"), resolve("second")];
  const expected = resolve(directories[1], "codex.CMD");
  const found = await findExecutable("codex", directories.join(delimiter), {
    platform: "win32",
    pathExt: ".EXE;.CMD",
    accessFile: (candidate) => candidate === expected ? Promise.resolve() : Promise.reject(new Error("missing")),
  });

  assert.equal(found, expected);
});
