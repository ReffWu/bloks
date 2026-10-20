// One Bloks Cloud licence for every workspace (server/licence.ts, and the
// app's side in electron/main.mjs): a workspace's own licence wins, the
// app's one is used otherwise, and nothing but a licence is taken from
// the app's line.
import { test } from "node:test";
import assert from "node:assert/strict";

import { CLOUD_KEY, licenceFrom, licenceToUse } from "../server/licence.ts";

const KEY = `blok_live_${"a".repeat(32)}`;
const OTHER = `blok_live_${"b".repeat(32)}`;

test("a workspace with no licence of its own uses the app's, and its own wins when it has one", () => {
  assert.equal(licenceToUse(null, KEY), KEY);
  assert.equal(licenceToUse(OTHER, KEY), OTHER);
  assert.equal(licenceToUse(null, null), null);
  // something that is not a licence is no licence, from either side
  assert.equal(licenceToUse("blok_live_short", null), null);
  assert.equal(licenceToUse("nonsense", KEY), KEY);
});

test("only a licence message carrying a licence is taken from the app", () => {
  assert.equal(licenceFrom({ data: { kind: "licence", key: KEY } }), KEY);
  assert.equal(licenceFrom({ data: { kind: "stop" } }), null);
  assert.equal(licenceFrom({ data: { kind: "licence", key: "sk-live-other" } }), null);
  assert.equal(licenceFrom({ data: { kind: "licence", key: 42 } }), null);
  assert.equal(licenceFrom(null), null);
  assert.ok(CLOUD_KEY.test(KEY));
});

test("the app keeps the licence and hands it to each server over its own line, never in an environment", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  // handed over the utility process's message line
  assert.match(main, /run\.child\.postMessage\(\{ kind: "licence", key \}\)/);
  // kept with the keychain's protection, and never put in a server's env
  assert.match(main, /safeStorage\.encryptString\(key\)/);
  const env = main.slice(main.indexOf("utilityProcess.fork("), main.indexOf("execArgv: source.execArgv"));
  assert.doesNotMatch(env, /licen[cs]e/i);
});
