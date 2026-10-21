// Calls and questions left open by a turn are settled in one write.
//
// A transcript is written whole, so settling them one patch at a time
// rewrote the whole conversation once for every call still open: a turn
// stopped with dozens of calls running held the server for as many full
// rewrites, and so did every start after a crash, once per lane.
import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// Store's data paths are fixed at import time. Never use the test runner's
// real home, including when this suite is run from an agent's own turn.
const home = mkdtempSync(join(tmpdir(), "bloks-settle-writes-"));
process.env.HOME = home;
process.env.BLOKS_DATA_DIR = "";
const { Store } = await import("../server/store.ts");
after(() => rmSync(home, { recursive: true, force: true }));

/** How many times the transcript file is replaced while `fn` runs. */
function writesOf(t: { mock: typeof import("node:test").mock }, file: string, fn: () => void): number {
  let writes = 0;
  const real = fs.renameSync;
  t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === file) writes++;
    return real(from, to);
  });
  syncBuiltinESMExports();
  try {
    fn();
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  return writes;
}

test("thirty calls left open are settled with one write, and all of them are on disk", (t) => {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const bot = store.createBot({ name: "Busy" });
  const file = join(home, ".bloks", `messages-${bot.threadId}.json`);
  for (let i = 0; i < 30; i++) store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: `Read ${i}` } });
  store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: "Done", ok: true } });

  let settled: ReturnType<typeof store.settleOpenTools> = [];
  assert.equal(writesOf(t, file, () => (settled = store.settleOpenTools(bot.threadId))), 1);
  assert.equal(settled.length, 30);
  const disk = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(disk.filter((m: any) => m.tool?.stopped).length, 30);
  assert.equal(disk.find((m: any) => m.tool?.name === "Done").tool.stopped, undefined, "a call that answered is left alone");

  assert.equal(writesOf(t, file, () => (settled = store.settleOpenTools(bot.threadId))), 0, "nothing open, nothing written");
  assert.deepEqual(settled, []);
});

test("open questions are settled with one write, and a workflow's gate stays", (t) => {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const bot = store.createBot({ name: "Asking" });
  const file = join(home, ".bloks", `messages-${bot.threadId}.json`);
  for (let i = 0; i < 5; i++) {
    store.appendMessage(bot.threadId, { role: "bot", kind: "options", card: { title: `Allow ${i}?`, subtitle: "", options: ["Yes", "No"], requestId: `r${i}` } });
  }
  store.appendMessage(bot.threadId, { role: "bot", kind: "options", card: { title: "Gate", subtitle: "", options: ["Go"], requestId: "g", runId: "run" } });

  let settled: ReturnType<typeof store.settleOpenAsks> = [];
  assert.equal(writesOf(t, file, () => (settled = store.settleOpenAsks(bot.threadId))), 1);
  assert.equal(settled.length, 5);
  const disk = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(disk.filter((m: any) => m.card?.cutOff && m.card.answered === "Cut off when Bloks stopped").length, 5);
  assert.equal(disk.find((m: any) => m.card?.runId).card.answered, undefined);
});
