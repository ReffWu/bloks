// Gives the compiled server the npm packages it imports, in
// dist-server/node_modules. Run by `pnpm build:server`, after tsc.
//
// The packaged app and the bloks-server download both ship the compiled
// server without the repository's node_modules beside it (electron-builder.yml
// and scripts/pack-server.mjs say why). For a long time the server imported
// nothing from npm, so that cost nothing. Answers drawn as interface
// (server/genui.ts) brought the first packages in, and an import Node
// cannot resolve stops the server before it listens: in the packaged app
// and in bloks-server, while every test, run from source, still passes.
//
// So the packages the compiled server names are found here, followed
// through pnpm's links to their real folders, and copied in with what
// they depend on. Then each one is imported from a copy of the folder
// outside this checkout, where nothing above it can quietly stand in for
// a package that was not copied, and a missing one fails the build.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "dist-server");
const out = join(server, "node_modules");

if (!existsSync(join(server, "index.js"))) {
  console.error("[stage-server-deps] no dist-server/index.js: compile the server first");
  process.exit(1);
}

/** Every .js file of the compiled server, its own node_modules aside. */
function compiled(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(full).isDirectory()) return compiled(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

/** The bare module names the compiled server imports, static or dynamic,
 * and not Node's own. Read by TypeScript's own import scanner, which
 * knows an import from a string that only reads like one. tsc has
 * already dropped the imports that were only types. */
const BUILTIN = new Set(builtinModules);
const specifiers = new Set();
for (const file of compiled(server)) {
  const { importedFiles } = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  for (const { fileName: spec } of importedFiles) {
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
    if (BUILTIN.has(spec.split("/")[0])) continue;
    specifiers.add(spec);
  }
}
const packageOf = (spec) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");

/** The package's own folder, found the way Node's resolver walks up
 * node_modules, then followed through pnpm's symlinks to the real one.
 * Not require.resolve: an exports map can hide package.json. */
function packageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return realpathSync(dirname(candidate));
    if (dirname(dir) === dir) throw new Error(`[stage-server-deps] the server imports ${name}, which is not installed`);
  }
}

// always there, even empty, so both packagings can name it
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const staged = new Map();
/** One package and what it depends on. Peer dependencies are the
 * importer's to provide, and the server's own list provides them. */
function stage(name, fromDir) {
  if (staged.has(name)) return;
  const dir = packageDir(name, fromDir);
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  staged.set(name, manifest.version);
  mkdirSync(dirname(join(out, name)), { recursive: true });
  cpSync(dir, join(out, name), { recursive: true, dereference: true });
  for (const dep of Object.keys(manifest.dependencies ?? {})) stage(dep, dir);
}
for (const spec of specifiers) stage(packageOf(spec), root);

// Imported from outside this checkout, as the packaged server will be.
if (specifiers.size) {
  const scratch = mkdtempSync(join(tmpdir(), "stage-server-deps-"));
  try {
    cpSync(out, join(scratch, "node_modules"), { recursive: true });
    const check = join(scratch, "check.mjs");
    writeFileSync(check, [...specifiers].map((spec) => `await import(${JSON.stringify(spec)});`).join("\n"));
    execFileSync(process.execPath, [check], { cwd: scratch, stdio: "inherit" });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(
  specifiers.size
    ? `[stage-server-deps] ${[...staged].map(([name, version]) => `${name}@${version}`).join(", ")}`
    : "[stage-server-deps] the server imports nothing from npm",
);
