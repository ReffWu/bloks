// A data folder of this test file's own, for a test that runs server code
// in its own process rather than through a server it starts.
//
// server/config.ts settles the data folder once, when it is first loaded,
// from BLOKS_DATA_DIR or else the real home's .bloks. A driver run in the
// test process then writes its native copy there, which on a developer's
// machine is their own Bloks. Imported first, before anything that loads
// config.ts, this points it at a throwaway folder instead. A folder said
// already (CI, or a person running one file) is left as it is, and servers
// started through helpers/server.ts choose their own regardless.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.BLOKS_DATA_DIR?.trim()) {
  const dir = mkdtempSync(join(tmpdir(), "bloks-test-data-"));
  process.env.BLOKS_DATA_DIR = dir;
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}
