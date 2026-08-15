import assert from "node:assert/strict";
import { join } from "node:path";
import { PairingAuth, sha256 } from "../src/auth.ts";
import type { GatewayConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { GatewayServer } from "../src/server.ts";
import { lstatIfExists, workingTreeDiff } from "../src/server.ts";

Deno.test("working tree diff includes staged, unstaged, and untracked files", async () => {
  const directory = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-diff-" });
  try {
    await git(directory, ["init"]);
    await Deno.writeTextFile(join(directory, "tracked.txt"), "staged\n");
    await git(directory, ["add", "tracked.txt"]);
    await Deno.writeTextFile(join(directory, "tracked.txt"), "staged\nunstaged\n");
    await Deno.writeTextFile(join(directory, "new.txt"), "untracked\n");
    const result = await workingTreeDiff(directory);
    assert.match(result.diff, /## Staged/);
    assert.match(result.diff, /staged/);
    assert.match(result.diff, /## Unstaged/);
    assert.match(result.diff, /unstaged/);
    assert.match(result.diff, /## Untracked/);
    assert.match(result.diff, /untracked/);
    assert.equal(result.truncated, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("working tree diff does not fail on a broken untracked symlink", async () => {
  const directory = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-diff-link-" });
  try {
    await git(directory, ["init"]);
    await Deno.writeTextFile(join(directory, "tracked.txt"), "staged\n");
    await git(directory, ["add", "tracked.txt"]);
    await Deno.symlink("missing-target", join(directory, "broken-link"));

    const result = await workingTreeDiff(directory);

    assert.match(result.diff, /## Staged/);
    assert.match(result.diff, /broken-link \(not a file\)/);
    assert.equal(result.truncated, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("working tree diff ignores an untracked file removed during collection", async () => {
  const directory = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-diff-removed-" });
  try {
    await git(directory, ["init"]);
    const removed = join(directory, "removed.txt");
    await Deno.writeTextFile(removed, "temporary\n");
    await Deno.remove(removed);

    assert.equal(await lstatIfExists(removed), null);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("working tree diff does not execute configured textconv filters", async () => {
  const directory = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-diff-textconv-" });
  try {
    const marker = join(directory, "executed");
    const converter = join(directory, "textconv");
    await Deno.writeTextFile(converter, `#!/bin/sh\ntouch '${marker}'\ncat "$1"\n`);
    await Deno.chmod(converter, 0o700);
    await git(directory, ["init"]);
    await git(directory, ["config", "user.email", "koan@example.test"]);
    await git(directory, ["config", "user.name", "KOAN Test"]);
    await git(directory, ["config", "diff.unsafe.textconv", converter]);
    await Deno.writeTextFile(join(directory, ".gitattributes"), "*.foo diff=unsafe\n");
    await Deno.writeTextFile(join(directory, "tracked.foo"), "before\n");
    await git(directory, ["add", ".gitattributes", "tracked.foo"]);
    await git(directory, ["commit", "-m", "initial"]);
    await Deno.writeTextFile(join(directory, "tracked.foo"), "after\n");

    const result = await workingTreeDiff(directory);

    assert.match(result.diff, /before/);
    assert.match(result.diff, /after/);
    assert.throws(() => Deno.statSync(marker), Deno.errors.NotFound);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("working tree diff does not execute configured fsmonitor hooks", async () => {
  const directory = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-diff-fsmonitor-" });
  try {
    const marker = join(directory, "executed");
    const monitor = join(directory, "fsmonitor");
    await Deno.writeTextFile(monitor, `#!/bin/sh\ntouch '${marker}'\nprintf 'builtin:fake\\0'\n`);
    await Deno.chmod(monitor, 0o700);
    await git(directory, ["init"]);
    await git(directory, ["config", "user.email", "koan@example.test"]);
    await git(directory, ["config", "user.name", "KOAN Test"]);
    await Deno.writeTextFile(join(directory, "tracked.txt"), "before\n");
    await git(directory, ["add", "tracked.txt"]);
    await git(directory, ["commit", "-m", "initial"]);
    await git(directory, ["config", "core.fsmonitor", monitor]);
    await Deno.writeTextFile(join(directory, "tracked.txt"), "after\n");
    await Deno.writeTextFile(join(directory, "untracked.txt"), "new\n");

    const result = await workingTreeDiff(directory);

    assert.match(result.diff, /after/);
    assert.match(result.diff, /untracked/);
    assert.throws(() => Deno.statSync(marker), Deno.errors.NotFound);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("diff revalidates a saved project path before invoking Git", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-diff-path-" });
  const root = join(directory, "root");
  const projectPath = join(root, "project");
  const outside = join(directory, "outside");
  try {
    Deno.mkdirSync(projectPath, { recursive: true });
    Deno.mkdirSync(outside);
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 18787,
      dataDir: join(directory, "data"),
      webDir: directory,
      allowedRoots: [root],
      cookieName: "koan_device",
      secureCookies: false,
    };
    const store = new Store(config.dataDir);
    const project = store.createProject("KOAN", projectPath);
    const session = store.createSession(project.id, "codex");
    const token = "device-token";
    store.createDevice("Phone", await sha256(token));
    const server = new GatewayServer(
      config,
      store,
      new PairingAuth(store, config),
      {} as never,
      {} as never,
    );
    Deno.removeSync(projectPath);
    Deno.symlinkSync(outside, projectPath);

    const response = await server.handle(
      new Request(`http://127.0.0.1:18787/api/v1/sessions/${session.id}/diff`, {
        headers: { cookie: `koan_device=${token}` },
      }),
    );
    const body = await response.json();
    assert.match(body.error, /PATH_OUTSIDE_ALLOWED_ROOTS/);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

async function git(cwd: string, args: string[]) {
  const output = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "piped" }).output();
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
}
