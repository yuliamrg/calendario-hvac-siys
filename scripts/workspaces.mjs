import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "..");

export const WORKSPACES = Object.freeze({
  web: Object.freeze({
    id: "web",
    name: "@siys-sync/web",
    directory: "apps/web",
    sourceRoot: "apps/web/src"
  }),
  cli: Object.freeze({
    id: "cli",
    name: "@siys-sync/cli",
    directory: "apps/cli",
    sourceRoot: "apps/cli/src"
  }),
  platform: Object.freeze({
    id: "platform",
    name: "@siys-sync/platform",
    directory: "packages/platform",
    sourceRoot: "packages/platform/src"
  })
});

export const PLATFORM_PACKAGE_NAME = WORKSPACES.platform.name;
export const PLATFORM_SPECIFIER_PREFIX = `${PLATFORM_PACKAGE_NAME}/`;

export function normalizeModulePath(modulePath) {
  return String(modulePath)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

export function isPlatformSpecifier(specifier) {
  return specifier.startsWith(PLATFORM_SPECIFIER_PREFIX);
}

export function platformSubpath(specifier) {
  return isPlatformSpecifier(specifier)
    ? specifier.slice(PLATFORM_SPECIFIER_PREFIX.length)
    : null;
}

export function projectPathForPlatformSpecifier(specifier) {
  const subpath = platformSubpath(specifier);
  if (subpath === null) return null;
  return normalizeModulePath(`${WORKSPACES.platform.sourceRoot}/${subpath}`);
}

export function workspaceForModulePath(modulePath) {
  const normalized = normalizeModulePath(modulePath);
  for (const workspace of Object.values(WORKSPACES)) {
    if (normalized === workspace.sourceRoot || normalized.startsWith(`${workspace.sourceRoot}/`)) {
      return workspace;
    }
  }
  return null;
}

export async function readWorkspaceExports(workspaceId) {
  const workspace = Object.values(WORKSPACES).find(({ id }) => id === workspaceId);
  if (!workspace) throw new Error(`Workspace desconocido: ${workspaceId}`);
  const manifestPath = resolve(projectRoot, workspace.directory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return {
    manifest,
    exports: Object.keys(manifest.exports ?? {})
  };
}
