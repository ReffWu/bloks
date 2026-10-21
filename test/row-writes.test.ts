// The rows a turn streams are written together, not one at a time.
//
// A transcript is written whole, so every call row and every call result
// cost a JSON.stringify of the whole conversation: most of the server's
// time with a few agents working, and more the longer the conversation.
// Rows marked `soon` wait a quarter second and go as one write; the end
// of the turn, a write of anything else, and the process leaving all
// write them at once.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

// Store's data paths are fixed at import time. Never use the test runner's
// real home, including when this suite is run from an agent's own turn.
const home = mkdtempSync(join(tmpdir(), "bloks-row-writes-"));
process.env.HOME = home;
process.env.BLOKS_DATA_DIR = "";
const { Store, ROW_WAIT_MS } = await import("../server/store.ts");
after(() => rmSync(home, { recursive: true, force: true }));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const onDisk = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Array<{ id: string; tool?: { name: string; ok?: boolean } }>;

/** Counts the times `file` is replaced, until the returned stop. */
function countWrites(t: { mock: typeof import("node:test").mock }, file: string) {
  let writes = 0;
  const real = fs.renameSync;
  t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === file) writes++;
    return real(from, to);
  });
  syncBuiltinESMExports();
  return () => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    return writes;
  };
}

function lane() {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const bot = store.createBot({ name: "Busy" });
  return { store, bot, file: join(home, ".bloks", `messages-${bot.threadId}.json`) };
}

test("twenty calls and their results, streamed, are one write", async (t) => {
  const { store, bot, file } = lane();
  const stop = countWrites(t, file);
  for (let i = 0; i < 20; i++) {
    const row = store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: `Read ${i}` } }, { soon: true });
    store.patchMessage(bot.threadId, row.id, { tool: { name: `Read ${i}`, ok: true } }, { soon: true });
  }
  assert.equal(store.messagesFor(bot.threadId).length, 21, "in memory at once");
  await pause(ROW_WAIT_MS + 150);
  assert.equal(stop(), 1);
  const rows = onDisk(file).filter((m) => m.tool);
  assert.equal(rows.length, 20);
  assert.ok(rows.every((m) => m.tool!.ok === true));
});

test("anything else written takes the waiting rows with it, at once", (t) => {
  const { store, bot, file } = lane();
  store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: "Bash" } }, { soon: true });
  const stop = countWrites(t, file);
  store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Done." });
  assert.equal(stop(), 1);
  assert.deepEqual(onDisk(file).map((m) => m.tool?.name ?? "text").slice(-2), ["Bash", "text"]);
});

test("the end of a turn writes what waits", () => {
  const { store, bot, file } = lane();
  store.setTaskBusy(bot.threadId, true);
  store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: "Bash" } }, { soon: true });
  assert.equal(onDisk(file).some((m) => m.tool), false, "still waiting");
  store.setTaskBusy(bot.threadId, false);
  assert.equal(onDisk(file).filter((m) => m.tool).length, 1);
});

test("a process on its way out writes what waits", () => {
  const data = mkdtempSync(join(tmpdir(), "bloks-row-exit-"));
  try {
    const store = fileURLToPath(new URL("../server/store.ts", import.meta.url));
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { Store } = await import(${JSON.stringify(store)});
         const s = new Store(() => ({ instanceId: "claude", model: "x" }));
         const bot = s.createBot({ name: "Leaving" });
         s.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: "Last call" } }, { soon: true });
         console.log(bot.threadId);
         process.exit(0);`,
      ],
      { env: { ...process.env, HOME: data, BLOKS_DATA_DIR: "" }, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const threadId = run.stdout.trim();
    const rows = onDisk(join(data, ".bloks", `messages-${threadId}.json`));
    assert.equal(rows.at(-1)?.tool?.name, "Last call");
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
