// The training export's routes (server/index.ts, serveTrainingExport),
// against the real harness with the fixture workspace as its data folder.
//
// The owner at this computer lists what there is, previews one record,
// writes the file, downloads it and deletes it, and the write is in the
// Record. Nobody else gets anywhere: not a paired device, not a member's
// credential on this machine, not an agent's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { allows } from "../server/agent-cli.ts";
import { startHarness } from "./helpers/server.ts";
import { writeExportFixture } from "./helpers/run-export-fixture.ts";

const MEMBER_TOKEN = "fixture-member-device-token-for-export";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("the owner previews, writes, downloads and deletes an export, and nobody else reaches it", { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-export-routes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const data = join(dir, ".bloks");
  writeExportFixture(data, dir);
  // a member's device, so a member's credential can be tried on this machine
  const config = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
  writeFileSync(
    join(data, "config.json"),
    JSON.stringify({ ...config, remote: { enabled: true, devices: [], memberDevices: [{ id: "member-device", name: "Sam's Mac", hash: sha(MEMBER_TOKEN), pairedAt: 1, personId: "p-sam" }] } }),
  );
  const h = await startHarness({ BLOKS_DATA_DIR: data });
  t.after(() => h.stop());

  const listing = await h.json("/api/training-export");
  assert.deepEqual(listing.agents.map((a: any) => a.name).sort(), ["Ada", "Cody"]);
  const ada = listing.agents.find((a: any) => a.id === "ada");
  // reading members' private conversations is off, so theirs is not even listed
  assert.deepEqual(ada.conversations.map((c: any) => c.id).sort(), ["lane-claude", "lane-team"]);
  assert.equal(ada.conversations.find((c: any) => c.id === "lane-claude").turns, 5);
  assert.equal(listing.privateReadable, false);
  assert.match(listing.folder, /\.bloks-exports$/);
  assert.deepEqual(listing.exports, []);
  assert.equal(listing.defaults.format, "openai");

  const bad = await h.fetch("/api/training-export/preview", { method: "POST", body: JSON.stringify({ format: "csv" }) });
  assert.equal(bad.status, 400);

  const preview = await h.json("/api/training-export/preview", { method: "POST", body: JSON.stringify({ format: "openai" }) });
  assert.equal(preview.summary.records, 3);
  assert.equal(preview.summary.leftOut.total, 5);
  assert.match(preview.preview, /"messages"/);
  assert.ok(!preview.preview.includes("sk-ant-"), "the preview is cleaned like the file");
  assert.ok(!existsSync(`${data}-exports`), "a preview writes nothing");

  const written = await h.json("/api/training-export", { method: "POST", body: JSON.stringify({ format: "trajectory" }) });
  assert.match(written.file.name, /^bloks-training-trajectory-turn-\d{8}T\d{6}Z\.jsonl$/);
  assert.equal(written.exports.length, 1);
  const download = await h.fetch(`/api/training-export/files/${written.file.name}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  const lines = (await download.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.ok(lines.every((r) => r.format === "bloks.trajectory"));

  const ledger = await h.json("/api/ledger");
  const entries = ledger.entries ?? ledger.recent ?? ledger;
  assert.ok(JSON.stringify(entries).includes("runs.exported"), "the export is in the Record");

  // nobody but the owner at this computer
  const remote = await h.fetchRemote("/api/training-export", { token: MEMBER_TOKEN });
  // a member's device on the network is answered by its own small surface,
  // which refuses this however it says so (no plan for members here: 402)
  assert.ok(remote.status === 403 || remote.status === 402, String(remote.status));
  assert.ok(!JSON.stringify(remote.body).includes("lane-claude"));
  const member = await h.fetch("/api/training-export", { headers: { authorization: `Bearer ${MEMBER_TOKEN}` } });
  assert.equal(member.status, 403);
  assert.equal(allows("ada", "GET", "/api/training-export").ok, false);
  assert.equal(allows("ada", "POST", "/api/training-export/preview").ok, false);

  const traversal = await h.fetch("/api/training-export/files/..%2Fbots.json");
  assert.equal(traversal.status, 400);
  const gone = await h.json(`/api/training-export/files/${written.file.name}`, { method: "DELETE" });
  assert.deepEqual(gone.exports, []);
  assert.equal((await h.fetch(`/api/training-export/files/${written.file.name}`)).status, 404);
});
