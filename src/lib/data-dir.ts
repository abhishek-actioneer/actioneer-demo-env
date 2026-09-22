import { isAbsolute, resolve } from "path";

export function getDataDir(): string {
  const configured = process.env.SENTINEL_DATA_DIR?.trim();
  return configured ? resolve(configured) : resolve(process.cwd(), "data");
}

export function resolveDataPath(...segments: string[]): string {
  return resolve(getDataDir(), ...segments);
}

export function resolveRepoDataPath(path: string): string {
  if (isAbsolute(path)) return path;

  const normalized = path.replace(/\\/g, "/");
  if (normalized === "data") return getDataDir();
  if (normalized.startsWith("data/")) {
    return resolveDataPath(normalized.slice("data/".length));
  }

  return resolve(process.cwd(), path);
}
