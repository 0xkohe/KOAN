import { access, readdir, readFile, realpath } from "node:fs/promises";
import { delimiter, parse, resolve } from "node:path";
import { spawn } from "node:child_process";
import { claudeSdkExecutableName, findExecutable, splitPathList } from "./command-path.mjs";
import { detectTailscaleServeUrl, normalizePublicUrl } from "./tailscale.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const env = { ...process.env };
const options = new Set(process.argv.slice(2));
const unknownOptions = [...options].filter((option) => option !== "--allow-all");
if (unknownOptions.length) {
  console.error(`Unknown option(s): ${unknownOptions.join(", ")}`);
  console.error("Usage: node scripts/start.mjs [--allow-all]");
  process.exit(1);
}
const allowAll = options.has("--allow-all");
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
if (allowAll) {
  env.KOAN_ALLOWED_ROOTS = parse(repoRoot).root;
  env.KOAN_DEFAULT_PROJECT_PATH = repoRoot;
}
env.KOAN_WEB_DIR = webDir;
const port = env.KOAN_PORT ?? "18787";
if (env.KOAN_PUBLIC_URL) {
  const publicUrl = normalizePublicUrl(env.KOAN_PUBLIC_URL);
  if (publicUrl) {
    env.KOAN_PUBLIC_URL = publicUrl;
  } else {
    console.log(`\n  Invalid KOAN_PUBLIC_URL: ${env.KOAN_PUBLIC_URL}`);
    console.log("  Expected an http:// or https:// URL. Trying Tailscale detection instead.\n");
    delete env.KOAN_PUBLIC_URL;
  }
}
if (!env.KOAN_PUBLIC_URL) {
  const tailscale = await detectTailscaleServeUrl(port);
  if (tailscale.url) {
    env.KOAN_PUBLIC_URL = tailscale.url;
  } else {
    const detail = tailscale.reason === "missing"
      ? "Tailscale CLI was not found. Install and connect Tailscale first."
      : tailscale.reason === "not-logged-in"
      ? "Tailscale is not logged in. Run `tailscale up` and complete the login first."
      : tailscale.reason === "unavailable"
      ? "Tailscale is not running or its status could not be read."
      : `No Tailscale Serve route points to localhost:${port}.`;
    console.log(`\n  Pairing QR unavailable: ${detail}`);
    console.log(`  Configure it with: tailscale serve --bg localhost:${port}`);
    console.log("  Then restart KOAN to display the QR code.\n");
  }
}
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
if (allowAll) {
  console.warn("\n  WARNING: KOAN unrestricted mode is enabled.");
  console.warn("  The Gateway has unrestricted filesystem, network, environment, and command access.\n");
  console.warn(`  Projects can be selected anywhere under ${env.KOAN_ALLOWED_ROOTS}.\n`);
}
const permissionArgs = allowAll
  ? ["--allow-all"]
  : [
    `--allow-net=127.0.0.1:${port}`,
    `--allow-read=${readPaths}`,
    `--allow-write=${writePaths}`,
    `--allow-run=${allowedCommands}`,
    "--allow-env",
    "--allow-sys=homedir,cpus,networkInterfaces",
  ];
const args = [
  "run",
  "--no-prompt",
  ...permissionArgs,
  resolve(repoRoot, "apps/gateway/src/main.ts"),
];
const child = spawn("deno", args, { cwd: repoRoot, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exitCode = signal ? 1 : code ?? 1);
