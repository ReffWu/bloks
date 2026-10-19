// The server keeps its own copy of the settings wire values, because it
// is compiled on its own: one import from src/ moves the whole compiled
// server from dist-server/index.js to dist-server/server/index.js, and
// packing bloks-server stops finding it. These hold the copy to the
// interface's, and the server to importing only its own folder.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
test("the server's copy of the settings wire values is the interface's, line for line", () => {
  const ours = readFileSync(join(root, "server/settings-observation.ts"), "utf8");
  const theirs = readFileSync(join(root, "src/lib/settings-observation.ts"), "utf8");
  assert.ok(ours.endsWith(theirs), "server/settings-observation.ts drifted from src/lib/settings-observation.ts");
});

test("nothing in server/ imports the interface's code", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|mts|mjs|js)$/.test(entry.name) && /from\s+["'](\.\.\/)+src\//.test(readFileSync(join(root, path), "utf8"))) offenders.push(path);
    }
  };
  walk("server");
  assert.deepEqual(offenders, []);
});
