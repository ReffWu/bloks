// What the app says about credits and about a hosted workspace, held to
// what the server sends: the composer's notice after an empty balance
// (src/lib/credits.ts), the computer choices both doors offer
// (src/lib/hosted.ts), and the keys a moved workspace asks for again
// (src/lib/backups.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { balanceNote, balanceText, refusalToShow, runsOnCredits } from "../src/lib/credits.ts";
import { computerOptions } from "../src/lib/hosted.ts";
import { keysToEnter, kindLabel } from "../src/lib/backups.ts";
import { computerChoices } from "../server/hosted.ts";
import { CREDITS_KIND } from "../server/credits.ts";

const instances = [
  { instanceId: "claude", driverKind: "claudeAgent" },
  { instanceId: "bloks", driverKind: "bloks" },
  { instanceId: "codex", driverKind: "codex" },
];

test("an agent spends credits on the Bloks engine, or on Claude Code with its access set to credits", () => {
  assert.equal(runsOnCredits({ modelSelection: { instanceId: CREDITS_KIND } }, instances), true, "the engine id is the server's");
  assert.equal(runsOnCredits({ modelSelection: { instanceId: "claude" }, engineAccess: "credits" }, instances), true);
  assert.equal(runsOnCredits({ modelSelection: { instanceId: "claude" } }, instances), false, "its own sign-in");
  // access is Claude Code's alone; anything else on credits access is not
  assert.equal(runsOnCredits({ modelSelection: { instanceId: "codex" }, engineAccess: "credits" }, instances), false);
  assert.equal(runsOnCredits({ modelSelection: null }, instances), false);
});

test("the composer's notice shows a standing refusal to an agent on credits, until it is put away", () => {
  const refused = { at: 1_000, message: "Your Bloks credits have run out." };
  assert.deepEqual(refusalToShow(refused, true, null), refused);
  assert.equal(refusalToShow(refused, false, null), null, "an agent on its own sign-in was not refused");
  assert.equal(refusalToShow(null, true, null), null, "nothing standing, nothing said");
  assert.equal(refusalToShow(refused, true, 1_000), null, "put away");
  assert.deepEqual(refusalToShow({ ...refused, at: 2_000 }, true, 1_000), { ...refused, at: 2_000 }, "a later refusal is a new one");
});

test("a balance is said in the service's own currency, and nothing is converted", () => {
  assert.equal(balanceText(12.5, "USD", "en-US"), "$12.50");
  assert.equal(balanceText(3, "EUR", "en-US"), "€3.00");
  assert.equal(balanceText(1, "not a currency", "en-US"), "1.00 not a currency");
  assert.equal(balanceNote({ low: true, autoReload: false }), "Running low.");
  assert.equal(balanceNote({ low: true, autoReload: true }), "Tops itself up when it runs low.");
  assert.equal(balanceNote({ low: false, autoReload: false }), null);
});

test("both doors offer the computers the server says, and a Mac's four otherwise", () => {
  assert.deepEqual(computerOptions(computerChoices(true)).map(([id]) => id), ["local", "off"]);
  assert.deepEqual(computerOptions(computerChoices(false)), computerOptions(undefined), "the app's own list is the server's for a Mac");
  assert.deepEqual(computerOptions([]).map(([id]) => id), ["cloud", "sandbox", "local", "off"], "an older server sends none");
});

test("a moved workspace names the keys to enter again, each once", () => {
  assert.equal(keysToEnter([]), "No saved keys were left behind.");
  assert.equal(keysToEnter(["OpenRouter key"]), "Keys stay behind. Enter this again where it lands: OpenRouter key.");
  assert.equal(
    keysToEnter(["OpenRouter key", "Saved secret A", "OpenRouter key", "Slack bot token"]),
    "Keys stay behind. Enter these again where it lands: OpenRouter key, Saved secret A and Slack bot token.",
  );
  assert.equal(kindLabel("move"), "For moving");
});
