// BLOKS_DATA_DIR moves the whole data folder. The desktop app runs one
// server per workspace, each on its own folder, so every place that
// decides where the data lives has to hear it, and with it unset nothing
// may change: Personal is still ~/.bloks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { dataDirFrom } from "../server/config.ts";

const HOME = "/Users/someone";

test("unset, or blank, the data folder is ~/.bloks as it always was", () => {
  assert.equal(dataDirFrom({}, HOME), join(HOME, ".bloks"));
  assert.equal(dataDirFrom({ BLOKS_DATA_DIR: "" }, HOME), join(HOME, ".bloks"));
  assert.equal(dataDirFrom({ BLOKS_DATA_DIR: "   " }, HOME), join(HOME, ".bloks"));
});

test("set, it is the folder named, with ~ as the home folder", () => {
  assert.equal(dataDirFrom({ BLOKS_DATA_DIR: "/tmp/ws/one" }, HOME), "/tmp/ws/one");
  assert.equal(dataDirFrom({ BLOKS_DATA_DIR: "~/work-bloks" }, HOME), join(HOME, "work-bloks"));
  assert.equal(dataDirFrom({ BLOKS_DATA_DIR: "~" }, HOME), HOME);
  // relative is relative to where it was started, never to HOME
  assert.equal(dataDirFrom({ BLOKS_DATA_DIR: "rel/dir" }, HOME), join(process.cwd(), "rel/dir"));
});

test("the agent CLI finds the server through the folder it was pointed at", () => {
  // bin/bloks.mjs reads the port the server wrote in its data folder. A
  // workspace's agent would otherwise call Personal's server.
  const dir = mkdtempSync(join(tmpdir(), "bloks-datadir-"));
  try {
    const data = join(dir, "data");
    mkdirSync(data);
    writeFileSync(join(data, "port"), "54321");
    const cli = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));
    let said = "";
    try {
      execFileSync(process.execPath, [cli, "whoami"], {
        env: { ...process.env, HOME: dir, BLOKS_DATA_DIR: data, BLOKS_URL: "", BLOKS_TOKEN: "x" },
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch (error) {
      said = String((error as { stdout?: Buffer; stderr?: Buffer }).stdout ?? "") + String((error as { stderr?: Buffer }).stderr ?? "");
    }
    // nothing listens there, so it fails, but it fails at the right door
    assert.match(said, /54321/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
