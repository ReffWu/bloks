// The newest picture of an agent's screen, for a phone whose live view is
// open. Live frames never go through Bloks Cloud, so this is how a phone
// away from home sees an agent at work. It only reads what the Mac
// already took: nothing is photographed because somebody asked.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startHarness } from "./helpers/server.ts";

test("an agent nobody is watching says so, and an unknown one is not found", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-screen-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Shopper" }) });

  const idle = await h.fetch(`/api/bots/${bot.id}/screen`);
  assert.equal(idle.status, 200);
  assert.deepEqual(await idle.json(), { live: false });

  const missing = await h.fetch("/api/bots/nobody/screen");
  assert.equal(missing.status, 404);
});
