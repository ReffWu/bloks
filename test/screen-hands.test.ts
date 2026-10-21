// A person's hands on an agent's screen, from the phone: a tap, text, a
// key or a scroll into the agent's own browser or cloud computer. What is
// asked for is checked before anything reaches either, a phone looking at
// the screen never opens a browser to do it, and the keys are the same
// set at both doors.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BOX_KEYS, shellWord } from "../server/box-hands.ts";
import { PAGE_KEYS } from "../server/browser-view.ts";
import { startHarness } from "./helpers/server.ts";

test("the browser and the cloud computer take the same keys", () => {
  assert.deepEqual(Object.keys(BOX_KEYS).sort(), Object.keys(PAGE_KEYS).sort());
});

test("typed text reaches the box as one word, never a command", () => {
  assert.equal(shellWord("hello"), "'hello'");
  assert.equal(shellWord("it's; rm -rf ~"), `'it'\\''s; rm -rf ~'`);
  assert.equal(shellWord("$(whoami) `id`"), "'$(whoami) `id`'");
});

test("what a phone asks for is checked, and an agent without the thing to reach is told", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-hands-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Shopper" }) });
  const post = (path: string, body: unknown) => h.fetch(path, { method: "POST", body: JSON.stringify(body) });

  // no browser of its own yet
  const none = await post(`/api/bots/${bot.id}/browser/click`, { x: 0.5, y: 0.5 });
  assert.equal(none.status, 409);

  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ browser: true }) });
  for (const [act, body] of [
    ["click", { x: 1.5, y: 0.2 }],
    ["click", { x: "left", y: 0.2 }],
    ["scroll", { x: 0.5, y: 0.5, screens: 0 }],
    ["scroll", { x: 0.5, y: 0.5, screens: 40 }],
    ["key", { key: "F13" }],
    ["key", { key: "ctrl+alt+Delete" }],
  ] as const) {
    const res = await post(`/api/bots/${bot.id}/browser/${act}`, body);
    assert.equal(res.status, 400, `${act} ${JSON.stringify(body)}`);
  }
  // asked well, but the browser is not open: said, not opened
  const closed = await post(`/api/bots/${bot.id}/browser/key`, { key: "Enter" });
  assert.equal(closed.status, 409);
  assert.match((await closed.json()).error, /not open/);

  // a phone looking does not start a browser either
  const looked = await h.fetch(`/api/bots/${bot.id}/screen?watch=1`);
  assert.deepEqual(await looked.json(), { live: false });

  // no cloud computer here at all
  const noBox = await post(`/api/bots/${bot.id}/computer/click`, { x: 0.5, y: 0.5 });
  assert.equal(noBox.status, 409);
  const unknown = await post("/api/bots/nobody/computer/click", { x: 0.5, y: 0.5 });
  assert.equal(unknown.status, 404);
});
