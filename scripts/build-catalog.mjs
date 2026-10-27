// Writes catalog/index.json from the files in catalog/teams and
// catalog/skills. Run it after adding or changing an item:
//
//   node scripts/build-catalog.mjs          write the index
//   node scripts/build-catalog.mjs --check  only say whether it is current
//
// The index is never edited by hand. It carries each file's size and
// sha256, which is what the app checks a download against, so an index
// that drifted from its files would refuse every item it got wrong. The
// same build runs in the test suite (test/catalog.test.ts), and fails
// there when the checked-in index is not what this would write.
//
// Every file is read with the parser the app itself uses, so an item
// that would not install does not make it into the index either.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex, serializeIndex } from "../server/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "catalog");

/** Every file under teams/ and skills/, as the build wants them. */
function catalogFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push({ path: relative(root, path).split(sep).join("/"), bytes: new Uint8Array(readFileSync(path)) });
    }
  };
  for (const kind of ["teams", "skills"]) walk(join(root, kind));
  return out;
}

const check = process.argv.includes("--check");
const { index, problems } = buildIndex(catalogFiles());
if (problems.length) {
  console.error(`The catalogue has ${problems.length === 1 ? "a problem" : `${problems.length} problems`}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const written = serializeIndex(index);
const file = join(root, "index.json");
let current = "";
try {
  current = readFileSync(file, "utf8");
} catch {
  /* first build */
}
if (check) {
  if (current !== written) {
    console.error("catalog/index.json is out of date. Run: node scripts/build-catalog.mjs");
    process.exit(1);
  }
  console.log(`catalog/index.json is current: ${index.items.length} items.`);
} else {
  writeFileSync(file, written);
  const teams = index.items.filter((i) => i.kind === "team").length;
  console.log(`Wrote catalog/index.json: ${teams} teams, ${index.items.length - teams} skills.`);
}
