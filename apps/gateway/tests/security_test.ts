import assert from "node:assert/strict";
import { join, win32 } from "node:path";
import { isRelativePathInsideRoot, listProjectDirectories, validateProjectPath } from "../src/security.ts";

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

Deno.test("directory listings navigate within allowed roots", async () => {
  const root = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-browser-" });
  try {
    const alpha = join(root, "alpha");
    const nested = join(alpha, "nested");
    const hidden = join(root, ".hidden");
    await Deno.mkdir(nested, { recursive: true });
    await Deno.mkdir(hidden);
    await Deno.mkdir(join(root, "zeta"));
    await Deno.writeTextFile(join(root, "notes.txt"), "not a directory");

    const listing = await listProjectDirectories(root, [root]);
    assert.equal(listing.path, await Deno.realPath(root));
    assert.equal(listing.parent, null);
    assert.deepEqual(listing.directories.map((entry) => entry.name), ["alpha", "zeta"]);
    assert.equal(listing.truncated, false);
    await assert.rejects(
      () => validateProjectPath(hidden, [root]),
      /HIDDEN_PATH_NOT_ALLOWED/,
    );

    const child = await listProjectDirectories(alpha, [root]);
    assert.equal(child.parent, await Deno.realPath(root));
    assert.deepEqual(child.directories, [{ name: "nested", path: nested }]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("directory listings are bounded", async () => {
  const root = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-browser-limit-" });
  try {
    await Deno.mkdir(join(root, "alpha"));
    await Deno.mkdir(join(root, "beta"));

    const listing = await listProjectDirectories(root, [root], 1);
    assert.deepEqual(listing.directories.map((entry) => entry.name), ["alpha"]);
    assert.equal(listing.truncated, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
