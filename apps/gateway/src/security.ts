import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type DirectoryListing = {
  path: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
  truncated: boolean;
};

export async function validateProjectPath(
  input: string,
  allowedRoots: string[],
): Promise<{ path: string; name: string }> {
  if (!isAbsolute(input)) throw new Error("PATH_MUST_BE_ABSOLUTE");
  const real = await Deno.realPath(resolve(input));
  const info = await Deno.stat(real);
  if (!info.isDirectory) throw new Error("PATH_NOT_DIRECTORY");
  const roots = await realAllowedRoots(allowedRoots);
  const allowedRoot = rootContaining(real, roots);
  if (!allowedRoot) {
    throw new Error("PATH_OUTSIDE_ALLOWED_ROOTS");
  }
  const segments = relative(allowedRoot, real).split(sep).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) {
    throw new Error("HIDDEN_PATH_NOT_ALLOWED");
  }
  return { path: real, name: basename(real) || real };
}

export async function listProjectDirectories(
  input: string,
  allowedRoots: string[],
  limit = 500,
): Promise<DirectoryListing> {
  const current = await validateProjectPath(input, allowedRoots);
  const roots = await realAllowedRoots(allowedRoots);
  const directories: Array<{ name: string; path: string }> = [];
  for await (const entry of Deno.readDir(current.path)) {
    // Symlinks are omitted here. Following one is only safe after resolving and
    // revalidating it, which happens when a project path is submitted directly.
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    directories.push({ name: entry.name, path: join(current.path, entry.name) });
  }
  directories.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  const parent = dirname(current.path);
  return {
    path: current.path,
    parent: parent !== current.path && isPathInsideRoots(parent, roots) ? parent : null,
    directories: directories.slice(0, limit),
    truncated: directories.length > limit,
  };
}

async function realAllowedRoots(allowedRoots: string[]) {
  return await Promise.all(allowedRoots.map(async (root) => {
    try {
      return await Deno.realPath(root);
    } catch {
      return resolve(root);
    }
  }));
}

function isPathInsideRoots(path: string, roots: string[]) {
  return Boolean(rootContaining(path, roots));
}

function rootContaining(path: string, roots: string[]) {
  return [...roots]
    .sort((left, right) => right.length - left.length)
    .find((root) => isRelativePathInsideRoot(relative(root, path)));
}

export function isRelativePathInsideRoot(
  path: string,
  pathIsAbsolute = isAbsolute,
  separator = sep,
): boolean {
  return path === "" || (!pathIsAbsolute(path) && !path.startsWith(`..${separator}`) && path !== "..");
}

export function sameHostOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ??
      new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
