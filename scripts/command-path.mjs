import { access } from "node:fs/promises";
import { delimiter, resolve } from "node:path";

export function splitPathList(value, separator = delimiter) {
  return value.split(separator).filter(Boolean);
}

export function claudeSdkExecutableName(platform = process.platform) {
  return platform === "win32" ? "claude.exe" : "claude";
}

export async function findExecutable(
  command,
  pathValue,
  { platform = process.platform, pathExt = process.env.PATHEXT, accessFile = access } = {},
) {
  const extensions = platform === "win32"
    ? ["", ...(pathExt ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
    : [""];
  for (const directory of pathValue.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = resolve(directory, command + extension);
      try {
        await accessFile(candidate);
        return candidate;
      } catch { /* keep searching PATH */ }
    }
  }
  return null;
}
