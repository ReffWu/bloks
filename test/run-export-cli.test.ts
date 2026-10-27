// bloks-server export-runs (bin/bloks-server.mjs, server/run-export-cli.ts),
// against the fixture workspace with no server running: a dry run says
// what would be written and shows the first record, and writes nothing;
// a real one writes the file; a wrong flag and an agent's own shell are
// turned away with their exit codes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeExportFixture } from "./helpers/run-export-fixture.ts";

const CLI = fileURLToPath(new URL("../bin/bloks-server.mjs", import.meta.url));

function setup(t: { after: (fn: () => void) => void }) {
  const home = mkdtempSync(join(tmpdir(), "bloks-export-cli-"));
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  const data = join(home, ".bloks");
  writeExportFixture(data, home);
  // a port nothing listens on: the command never needs the server
  const env = { HOME: home, USERPROFILE: home, BLOKS_PORT: "1", BLOKS_DATA_DIR: "", BLOKS_TOKEN: "", BLOKS_SERVER_HOME: "x" };
  return { home, data, env };
}

function cli(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "export-runs", ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("exit", (code) => resolve({ code, out, err }));
  });
}

test("a dry run says what it would write, shows the first record, and writes nothing", async (t) => {
  const { home, data, env } = setup(t);
  const dry = await cli(["--dry-run"], env);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /^Would export 3 records \(3 turns\), \d+ KB\. Nothing was written\./);
  assert.match(dry.out, /Left out 5 turns: 1 ended with an error, 1 stopped before they finished, 1 rewound or redone, 2 with other people's words\./);
  assert.match(dry.out, /Taken out: \d+ keys or passwords, 1 email address, 1 phone number, \d+ home folder paths, 1 name\./);
  assert.match(dry.out, /Claude Code: 2 turns, tool results complete\./);
  assert.match(dry.out, /Codex: 1 turn, tool results partly recorded\./);
  assert.match(dry.out, /The first record, as it would be written:\n\{\n {2}"messages"/);
  assert.ok(!dry.out.includes(home), "the home folder is written as ~");
  assert.ok(!dry.out.includes("sk-ant-"));
  assert.ok(!existsSync(`${data}-exports`), "a dry run makes no folder and no file");

  const json = await cli(["--dry-run", "--json", "--format", "trajectory", "--agent", "cody"], env);
  assert.equal(json.code, 0, json.err);
  const parsed = JSON.parse(json.out);
  assert.equal(parsed.file, null);
  assert.equal(parsed.summary.records, 1);
  assert.equal(parsed.first.format, "bloks.trajectory");
  assert.equal(parsed.first.engine.kind, "codex");
});

test("an export writes one line per record, where it was asked to or in the exports folder", async (t) => {
  const { home, data, env } = setup(t);
  const out = join(home, "chats.jsonl");
  const run = await cli(["--format", "sharegpt", "--per", "conversation", "--out", out], env);
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /^Exported 2 records \(3 turns\) to ~\/chats\.jsonl/);
  const records = readFileSync(out, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => Array.isArray(r.conversations) && r.metadata.unit === "conversation"));
  const again = await cli(["--out", out], env);
  assert.equal(again.code, 2, "never over a file that is there");

  const plain = await cli(["--keep", "emails", "--include", "other-people", "--full-results"], env);
  assert.equal(plain.code, 0, plain.err);
  const written = plain.out.match(/to ~\/\.bloks-exports\/(bloks-training-openai-turn-[\dTZ]+\.jsonl)/);
  assert.ok(written, plain.out);
  const text = readFileSync(join(`${data}-exports`, written![1]), "utf8");
  assert.ok(text.includes("sam@example.com"), "--keep emails leaves them in");
  assert.equal(text.trim().split("\n").length, 5);

  const bare = await cli(["--no-metadata", "--out", join(home, "bare.jsonl")], env);
  assert.equal(bare.code, 0, bare.err);
  assert.ok(readFileSync(join(home, "bare.jsonl"), "utf8").trim().split("\n").every((line) => !("metadata" in JSON.parse(line))));
});

test("nothing matching, a wrong flag, and an agent's own shell each have their exit code", async (t) => {
  const { env } = setup(t);
  const none = await cli(["--from", "2020-01-01", "--to", "2020-01-02", "--dry-run"], env);
  assert.equal(none.code, 3);
  assert.match(none.out, /Nothing to export/);
  const wrong = await cli(["--format", "csv"], env);
  assert.equal(wrong.code, 2);
  assert.match(wrong.err, /Format is openai, sharegpt or trajectory/);
  const unknown = await cli(["--everything"], env);
  assert.equal(unknown.code, 2);
  const nobody = await cli(["--agent", "Nobody", "--dry-run"], env);
  assert.equal(nobody.code, 2);
  assert.match(nobody.err, /No agent is called Nobody/);
  const agent = await cli(["--dry-run"], { ...env, BLOKS_TOKEN: "a-turn-credential" });
  assert.equal(agent.code, 7);
  assert.match(agent.err, /owner's to run/);
  const help = await cli(["--help"], env);
  assert.equal(help.code, 0);
  assert.match(help.out, /Keys, tokens and passwords are always taken out\./);
});
