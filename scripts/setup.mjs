import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const dataDir = resolve(
  process.env.KOAN_DATA_DIR ?? resolve(repoRoot, ".koan"),
);
const envPath = resolve(repoRoot, ".env.koan");
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await chmod(dataDir, 0o700);
try {
  await readFile(envPath, "utf8");
  console.log(`Existing configuration: ${envPath}`);
} catch {
  const allowedRoot = process.cwd();
  await writeFile(
    envPath,
    `# KOAN local configuration\nKOAN_DATA_DIR=${dataDir}\nKOAN_ALLOWED_ROOTS=${allowedRoot}\n`,
    { mode: 0o600 },
  );
  console.log(`Created ${envPath}`);
}
console.log(`Data directory: ${dataDir}`);
console.log("Run `pnpm build`, then `pnpm start`.");
