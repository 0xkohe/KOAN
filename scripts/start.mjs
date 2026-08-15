import { access, readdir, readFile, realpath } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { spawn } from "node:child_process";
import { claudeSdkExecutableName, findExecutable, splitPathList } from "./command-path.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const env = { ...process.env };
try {
  const contents = await readFile(resolve(repoRoot, ".env.koan"), "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0 && env[trimmed.slice(0, index)] === undefined) {
      env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
  }
} catch { /* setup is optional */ }

const webDir = resolve(repoRoot, "apps/web/build/client");
try {
  await access(resolve(webDir, "index.html"));
} catch {
  console.error("Web build not found. Run `pnpm build` first.");
  process.exit(1);
}

env.KOAN_DATA_DIR ??= resolve(repoRoot, ".koan");
env.KOAN_ALLOWED_ROOTS ??= repoRoot;
env.KOAN_WEB_DIR = webDir;
const allowedRoots = splitPathList(env.KOAN_ALLOWED_ROOTS);

const canonicalPath = async (path) => {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return absolute;
    throw error;
  }
};
const readPaths = (await Promise.all([
  repoRoot,
  env.KOAN_DATA_DIR,
  "/proc/version",
  ...allowedRoots,
].map(canonicalPath))).join(",");
const writePaths = (await Promise.all(
  [env.KOAN_DATA_DIR, ...allowedRoots].map(
    canonicalPath,
  ),
)).join(",");
const claudeSdkBinaries = [];
try {
  for (const entry of await readdir(resolve(repoRoot, "node_modules/.pnpm"))) {
    const match = entry.match(/^@anthropic-ai\+(claude-agent-sdk-[^@]+)@/);
    if (!match) continue;
    claudeSdkBinaries.push(resolve(
      repoRoot,
      "node_modules/.pnpm",
      entry,
      "node_modules/@anthropic-ai",
      match[1],
      claudeSdkExecutableName(),
    ));
  }
} catch { /* SDK binary discovery is best effort */ }
const installedCommands = [];
for (
  const command of [
    "codex",
    "claude",
    "kiro-cli",
    "cline",
    "opencode",
    "opencode-cli",
    "git",
  ]
) {
  const executable = await findExecutable(command, env.PATH ?? "", {
    pathExt: env.PATHEXT,
  });
  if (executable) installedCommands.push(command, executable);
}
const allowedCommands = [...new Set([...installedCommands, ...claudeSdkBinaries])].join(",");
const args = [
  "run",
  `--allow-net=127.0.0.1:${env.KOAN_PORT ?? "18787"}`,
  `--allow-read=${readPaths}`,
  `--allow-write=${writePaths}`,
  `--allow-run=${allowedCommands}`,
  "--allow-env",
  "--allow-sys=homedir,cpus,networkInterfaces",
  resolve(repoRoot, "apps/gateway/src/main.ts"),
];
const child = spawn("deno", args, { cwd: repoRoot, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exitCode = signal ? 1 : code ?? 1);
