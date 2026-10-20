// "Same accent in every workspace" (electron/workspaces.mjs): off by
// default, each workspace keeping its own; on, one accent everywhere,
// changed from any of them; off again, each back to its own.
import { test } from "node:test";
import assert from "node:assert/strict";

import { accentOf, addWorkspace, chooseAccent, parseRegistry, setSameAccent, settle } from "../electron/workspaces.mjs";

function twoWorkspaces() {
  let registry = settle(parseRegistry(null), { personalDataDir: "/tmp/bloks-personal" });
  const made = addWorkspace(registry, { kind: "business", name: "Business" }, { workspacesDir: "/tmp/bloks-ws", id: "biz" });
  registry = made.registry;
  return registry;
}

test("off by default: each workspace keeps the accent it chose", () => {
  let registry = twoWorkspaces();
  assert.equal(registry.prefs.sameAccent, false);
  registry = chooseAccent(registry, "personal", "orange");
  registry = chooseAccent(registry, "biz", "green");
  assert.equal(accentOf(registry, "personal"), "orange");
  assert.equal(accentOf(registry, "biz"), "green");
  assert.equal(chooseAccent(registry, "biz", "not an accent!"), registry, "nothing that is not an accent");
});

test("on: what the window shows becomes everyone's, and choosing anywhere changes it everywhere", () => {
  let registry = twoWorkspaces();
  registry = chooseAccent(registry, "personal", "orange");
  registry = chooseAccent(registry, "biz", "green");
  const on = setSameAccent(registry, "biz", true, "green");
  registry = on.registry;
  assert.equal(on.accent, "green");
  assert.equal(accentOf(registry, "personal"), "green");
  registry = chooseAccent(registry, "personal", "orchid");
  assert.equal(accentOf(registry, "personal"), "orchid");
  assert.equal(accentOf(registry, "biz"), "orchid");
  // kept across a restart, the way the theme is
  const again = parseRegistry(JSON.stringify(registry));
  assert.equal(again.prefs.sameAccent, true);
  assert.equal(accentOf(again, "biz"), "orchid");
});

test("off again: every workspace goes back to its own, and one that never had one keeps the shared one", () => {
  let registry = twoWorkspaces();
  registry = chooseAccent(registry, "personal", "orange");
  registry = setSameAccent(registry, "personal", true, "orange").registry;
  registry = chooseAccent(registry, "biz", "cyan");
  const off = setSameAccent(registry, "biz", false, "cyan");
  registry = off.registry;
  assert.equal(registry.prefs.sameAccent, false);
  assert.equal(accentOf(registry, "personal"), "orange", "Personal's own, from before");
  assert.equal(off.accent, "cyan", "Business never chose one, so it keeps what it was wearing");
  assert.equal(accentOf(registry, "biz"), "cyan");
});
