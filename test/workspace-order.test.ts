// Reordering the workspaces from the switcher: where a dragged row lands,
// the new order kept by the app's list, and every list of workspaces
// (the switcher, the number keys, the palette) following it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { addWorkspace, parseRegistry, reorder, settle, snapshot } from "../electron/workspaces.mjs";
import { dropIndex, moveId, workspaceForKey } from "../src/lib/workspaces.ts";

test("a dragged row lands past every row whose middle it has crossed", () => {
  // three rows, 40 pixels apart, middles at 20, 60 and 100
  const centers = [20, 60, 100];
  assert.equal(dropIndex(centers, 0, 20), 0, "held still, it stays");
  assert.equal(dropIndex(centers, 0, 59), 0, "not yet past the next middle");
  assert.equal(dropIndex(centers, 0, 61), 1);
  assert.equal(dropIndex(centers, 0, 140), 2, "past the end is last");
  assert.equal(dropIndex(centers, 2, 61), 2);
  assert.equal(dropIndex(centers, 2, 59), 1);
  assert.equal(dropIndex(centers, 2, -10), 0);
});

test("moving one id keeps every other in its order", () => {
  const ids = ["personal", "music", "okafor"];
  assert.deepEqual(moveId(ids, 0, 1), ["music", "personal", "okafor"]);
  assert.deepEqual(moveId(ids, 2, 0), ["okafor", "personal", "music"]);
  assert.deepEqual(moveId(ids, 1, 1), ids);
  assert.deepEqual(moveId(ids, 1, 99), ["personal", "okafor", "music"]);
  assert.deepEqual(moveId(ids, 7, 0), ids, "a row that is not there moves nothing");
});

test("the new order is the list's, kept on disk, and every list follows it", () => {
  let reg = settle(parseRegistry(null), { personalDataDir: "/home/a/.bloks", now: 1 });
  for (const name of ["Music Studio", "Okafor Studio"]) {
    reg = addWorkspace(reg, { kind: "custom", name }, { workspacesDir: "/apps/ws", id: `ws_${name.split(" ")[0]!.toLowerCase()}` }).registry;
  }
  reg = reorder(reg, moveId(reg.workspaces.map((w) => w.id), 2, 0));
  const kept = settle(parseRegistry(JSON.stringify(reg)), { personalDataDir: "/home/a/.bloks", now: 2 });
  assert.deepEqual(kept.workspaces.map((w) => w.name), ["Okafor Studio", "Personal", "Music Studio"]);
  const shown = { ...snapshot(kept), current: "personal", plan: null } as const;
  assert.deepEqual(shown.workspaces.map((w) => w.name), ["Okafor Studio", "Personal", "Music Studio"]);
  // the number keys go by the same order
  assert.equal(workspaceForKey(shown as never, 1)?.name, "Okafor Studio");
  assert.equal(workspaceForKey(shown as never, 2)?.name, "Personal");
});

test("the switcher reorders by holding and dragging, and by Option and an arrow, and says so", () => {
  const src = readFileSync(new URL("../src/components/WorkspaceSwitcher.tsx", import.meta.url), "utf8");
  assert.match(src, /window\.bloks\?\.workspaceReorder\?\.\(next\)/);
  // a hold, not a click: the lift waits, and a pointer that wanders is a move to another row
  assert.match(src, /const HOLD_MS = \d+;/);
  assert.match(src, /setPointerCapture\(pointerId\)/);
  // the release that ends a drag never switches workspace
  assert.match(src, /onClickCapture=/);
  // the keyboard's way, for anyone who does not drag
  assert.match(src, /e\.altKey/);
  assert.match(src, /aria-live="polite"/);
});
