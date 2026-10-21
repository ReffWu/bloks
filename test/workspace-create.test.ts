// Making a workspace runs once, says nothing false, and does not keep the
// dialog open while the new server starts.
//
// What used to happen: Create waited for the new workspace's server to
// answer, a few seconds on a fresh folder. Meanwhile the app told every
// window about the list with the new workspace already in it, the dialog
// checked the name it was making against that list, and said "There is a
// workspace called Okafor Studio already" under the field, just before
// the window went to Okafor Studio's welcome anyway. A second press of
// Create, or Enter held down, asked the main process again and got the
// same words from it, for the same reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { addWorkspace, oneAtATime, parseRegistry, settle } from "../electron/workspaces.mjs";
import { checkDraft, draftName } from "../src/lib/newWorkspace.ts";

const fresh = () => settle(parseRegistry(null), { personalDataDir: "/home/a/.bloks", now: 1, random: () => 0.5 });

test("a second Create while the first is under way gets the first one's answer, and makes nothing", async () => {
  let registry = fresh();
  let made = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  // the main process's create, as main.mjs runs it: the list changes at
  // once, and the answer waits on something slow
  const create = oneAtATime(async (input: { kind: string; name: string }) => {
    try {
      const done = addWorkspace(registry, input, { workspacesDir: "/apps/Bloks/workspaces", id: `ws_${++made}` });
      registry = done.registry;
      await gate;
      return { ok: true, id: done.entry.id };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });
  const first = create({ kind: "custom", name: "Okafor Studio" });
  const second = create({ kind: "custom", name: "Okafor Studio" });
  assert.equal(first, second, "the same making, not a second one");
  release();
  assert.deepEqual(await first, { ok: true, id: "ws_1" });
  assert.deepEqual(await second, { ok: true, id: "ws_1" }, "never 'there is a workspace called Okafor Studio already'");
  assert.equal(registry.workspaces.filter((w) => w.name === "Okafor Studio").length, 1);
  assert.equal(made, 1);
  // once it is done, the next one is a new making, held to the rules
  assert.deepEqual(await create({ kind: "custom", name: "Okafor Studio" }), { error: "There is a workspace called Okafor Studio already." });
});

test("the dialog does not call the workspace it is making taken, and says a real clash under the name", () => {
  const before = [{ name: "Personal", kind: "personal" }];
  const after = [...before, { name: "Okafor Studio", kind: "custom" }];
  // the list arrives with the new workspace in it while it is being made
  assert.deepEqual(checkDraft({ kind: "custom", name: "Okafor Studio" }, after, "Okafor Studio"), { ready: false, problem: null });
  // a name somebody already has is a sentence, and Create stays off
  assert.deepEqual(checkDraft({ kind: "custom", name: "okafor  studio " }, after), { ready: false, problem: "There is a workspace called okafor studio already." });
  assert.deepEqual(checkDraft({ kind: "custom", name: "Okafor Studio" }, before), { ready: true, problem: null });
  // an empty field is not a mistake yet: nothing said, nothing to make
  assert.deepEqual(checkDraft({ kind: "custom", name: "   " }, before), { ready: false, problem: null });
  // Business may go without a name of its own, once per computer
  assert.equal(draftName("business", ""), "Business");
  assert.deepEqual(checkDraft({ kind: "business", name: "" }, before), { ready: true, problem: null });
  assert.deepEqual(checkDraft({ kind: "business", name: "Acme" }, [...before, { name: "Business", kind: "business" }]), {
    ready: false,
    problem: "There is a Business workspace already.",
  });
});

test("Create answers once the window is on its way, not once the new server has started", () => {
  const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  const handler = main.slice(main.indexOf("const createOnce = oneAtATime("), main.indexOf('handle("workspaces:create"'));
  assert.match(main, /handle\("workspaces:create", \(_event, input\) => createOnce\(input\)\);/);
  // opened, not switched to: switching waits for the server to answer
  assert.match(handler, /openMade\(made\.entry\.id\);\s*return \{ ok: true, id: made\.entry\.id \};/);
  assert.doesNotMatch(handler, /await switchWorkspace/);
  const opening = main.slice(main.indexOf("function openMade("), main.indexOf("function noteMembers("));
  // and the window goes to the welcome when the server is up, or to why not
  assert.match(opening, /showIn\(shown, id, started \? "welcome=workspace" : ""\)/);
  const dialog = readFileSync(new URL("../src/components/NewWorkspaceDialog.tsx", import.meta.url), "utf8");
  // the window's own guard is set before anything is awaited
  assert.match(dialog, /if \(!ready \|\| submitting\.current\) return;\s*submitting\.current = true;/);
});
