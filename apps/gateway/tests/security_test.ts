import assert from "node:assert/strict";
import { join, win32 } from "node:path";
import { isRelativePathInsideRoot, validateProjectPath } from "../src/security.ts";

Deno.test("project paths stay inside real allowed roots", async () => {
  const root = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-root-" });
  const outside = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-outside-" });
  try {
    const project = join(root, "project");
    await Deno.mkdir(project);
    assert.equal((await validateProjectPath(project, [root])).path, await Deno.realPath(project));
    await assert.rejects(() => validateProjectPath(outside, [root]), /PATH_OUTSIDE_ALLOWED_ROOTS/);
    const link = join(root, "escape");
    await Deno.symlink(outside, link);
    await assert.rejects(() => validateProjectPath(link, [root]), /PATH_OUTSIDE_ALLOWED_ROOTS/);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("project paths on another Windows volume stay outside allowed roots", () => {
  const relative = win32.relative("C:\\allowed", "D:\\outside");

  assert.equal(win32.isAbsolute(relative), true);
  assert.equal(isRelativePathInsideRoot(relative, win32.isAbsolute, win32.sep), false);
});
