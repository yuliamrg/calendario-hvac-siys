import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_VERSION } from "../apps/cli/src/version.js";

const root = resolve(import.meta.dirname, "..");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

async function copyRuntime(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    if (entry.isDirectory()) await copyRuntime(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile() && entry.name.endsWith(".js") && !/\.(test|spec)\.js$/.test(entry.name)) {
      // LF yields identical staging bytes for Linux and Windows checkouts.
      const text = await readFile(join(source, entry.name), "utf8");
      await writeFile(join(destination, entry.name), text.replaceAll("\r\n", "\n"));
    } else throw new Error(`Archivo runtime inesperado: ${join(source, entry.name)}`);
  }
}

export async function buildCliRelease({ outputDirectory } = {}) {
  const cli = await json("apps/cli/package.json");
  const platform = await json("packages/platform/package.json");
  if (cli.version !== CLI_VERSION || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.[1-9]\d*)?$/.test(CLI_VERSION)) throw new Error("Versión CLI inválida o no sincronizada.");
  if (platform.version !== "0.0.0" || !platform.private) throw new Error("Platform debe permanecer interno.");
  if (Object.keys(cli.dependencies ?? {}).join() !== "@siys-sync/platform" || Object.keys(platform.dependencies ?? {}).length) throw new Error("Dependencias runtime inesperadas; revisar empaquetado.");
  const name = `calendary-cli-${CLI_VERSION}`;
  const output = outputDirectory ? resolve(outputDirectory) : resolve(root, "releases", name);
  // Only the known generated default is replaceable. Custom destinations must be new.
  if (!outputDirectory) await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: false });
  await copyRuntime(resolve(root, "apps/cli/bin"), join(output, "bin"));
  await copyRuntime(resolve(root, "apps/cli/src"), join(output, "src"));
  const platformOutput = join(output, "node_modules/@siys-sync/platform");
  await copyRuntime(resolve(root, "packages/platform/src"), join(platformOutput, "src"));
  const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  await writeJson(join(output, "package.json"), { ...cli, dependencies: { "@siys-sync/platform": "0.0.0" } });
  await writeJson(join(platformOutput, "package.json"), platform);
  await writeFile(join(output, "README.txt"), `Calendary CLI ${CLI_VERSION}
Requiere Node.js >=20. No requiere npm install ni clonar el repositorio.
Desde esta carpeta:
  node bin/calendary.js --version
  node bin/calendary.js --help
Configuración pública: SIYS_SUPABASE_URL y SIYS_SUPABASE_PUBLISHABLE_KEY.
La sesión se inicia mediante cloud login; consulte --help.
Este archivo no contiene configuración cloud ni credenciales.
Guía: https://github.com/yuliamrg/calendario-hvac-siys/blob/main/docs/CLI.md
Actualizar: extraer el ZIP de otra release en una carpeta nueva.
Desinstalar: eliminar esta carpeta; la sesión externa se gestiona con cloud logout.
`.replaceAll("\r\n", "\n"));
  return { version: CLI_VERSION, output, name };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--out")) throw new Error("Uso: build-cli-release.mjs [--out <directorio nuevo>]");
  await mkdir(resolve(root, "releases"), { recursive: true });
  console.log(JSON.stringify(await buildCliRelease({ outputDirectory: args[1] }), null, 2));
}
