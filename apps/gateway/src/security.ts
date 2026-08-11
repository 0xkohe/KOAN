import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export async function validateProjectPath(
  input: string,
  allowedRoots: string[],
): Promise<{ path: string; name: string }> {
  if (!isAbsolute(input)) throw new Error("PATH_MUST_BE_ABSOLUTE");
  const real = await Deno.realPath(resolve(input));
  const info = await Deno.stat(real);
  if (!info.isDirectory) throw new Error("PATH_NOT_DIRECTORY");
  const roots = await Promise.all(allowedRoots.map(async (root) => {
    try {
      return await Deno.realPath(root);
    } catch {
      return resolve(root);
    }
  }));
  if (
    !roots.some((root) => {
      const rel = relative(root, real);
      return isRelativePathInsideRoot(rel);
    })
  ) {
    throw new Error("PATH_OUTSIDE_ALLOWED_ROOTS");
  }
  return { path: real, name: basename(real) || real };
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
