// Opening bloks.dev from the Plan page (electron/plan-link.mjs) and
// bloks://plan (electron/links.mjs). The key goes in the fragment, which
// never leaves the browser in a request, and only to the site's own
// origin; nothing else about a link changes.
import { test } from "node:test";
import assert from "node:assert/strict";

import { licencePrint, withLicence } from "../electron/plan-link.mjs";
import { linkInArgv, planLink, teamLink } from "../electron/links.mjs";

const KEY = `blok_live_${"a".repeat(32)}`;

test("an offer on bloks.dev opens with the key in the fragment, never the query", () => {
  const opened = withLicence("https://bloks.dev/cloud/upgrade?from=app", KEY, "https://bloks.dev");
  assert.equal(opened, `https://bloks.dev/cloud/upgrade?from=app#key=${KEY}`);
  const url = new URL(opened!);
  assert.equal(url.searchParams.get("key"), null, "never in the query");
  assert.ok(!url.search.includes(KEY));
  assert.ok(!url.pathname.includes(KEY));
});

test("a fragment already on the link is replaced, so the key is the only thing there", () => {
  assert.equal(withLicence("https://bloks.dev/cloud#plans", KEY, "https://bloks.dev"), `https://bloks.dev/cloud#key=${KEY}`);
});

test("any other origin opens as it came, and a key riding on it is taken off", () => {
  assert.equal(withLicence("https://example.com/buy", KEY, "https://bloks.dev"), "https://example.com/buy");
  assert.equal(withLicence("https://bloks.dev.example.com/x", KEY, "https://bloks.dev"), "https://bloks.dev.example.com/x");
  assert.equal(withLicence("https://user@bloks.dev.evil.com/x", KEY, "https://bloks.dev")?.includes(KEY), false);
  assert.equal(withLicence(`https://example.com/buy#key=${KEY}`, null, "https://bloks.dev"), "https://example.com/buy");
  // http to bloks.dev is not bloks.dev's https origin
  assert.equal(withLicence("http://bloks.dev/cloud", KEY, "https://bloks.dev"), null);
});

test("without a key, or with something that is not one, nothing is added", () => {
  assert.equal(withLicence("https://bloks.dev/cloud", null, "https://bloks.dev"), "https://bloks.dev/cloud");
  assert.equal(withLicence("https://bloks.dev/cloud", "blok_live_short", "https://bloks.dev"), "https://bloks.dev/cloud");
  assert.equal(withLicence("https://bloks.dev/cloud", `${KEY}#evil`, "https://bloks.dev"), "https://bloks.dev/cloud");
});

test("only web pages open: no files, no scripts, no other schemes", () => {
  for (const raw of ["javascript:alert(1)", "file:///etc/passwd", "bloks://plan", "data:text/html,hi", "not a link", "", null]) {
    assert.equal(withLicence(raw, KEY, "https://bloks.dev"), null, String(raw));
  }
});

test("a stand-in for the site on this computer gets the key the same way", () => {
  assert.equal(withLicence("http://127.0.0.1:4100/cloud", KEY, "http://127.0.0.1:4100"), `http://127.0.0.1:4100/cloud#key=${KEY}`);
  assert.equal(withLicence("http://127.0.0.1:4101/cloud", KEY, "http://127.0.0.1:4100"), "http://127.0.0.1:4101/cloud", "another port is another origin");
});

test("a forgotten key is remembered by a print that cannot be used as one", () => {
  const print = licencePrint(KEY);
  assert.match(print, /^[0-9a-f]{64}$/);
  assert.ok(!print.includes(KEY.slice(10)));
  assert.equal(print, licencePrint(KEY));
  assert.notEqual(print, licencePrint(`blok_live_${"b".repeat(32)}`));
});

test("bloks://plan opens Plan, and nothing rides on it", () => {
  assert.deepEqual(planLink("bloks://plan"), { kind: "plan" });
  assert.deepEqual(planLink("bloks://plan/"), { kind: "plan" });
  assert.deepEqual(planLink("bloks://plan?key=x#y"), { kind: "plan" });
  assert.equal(planLink("bloks://team/plan"), null);
  assert.equal(planLink("https://plan"), null);
  assert.equal(planLink("not a link"), null);
  assert.equal(teamLink("bloks://plan"), null, "a plan link is not taken for a team");
  assert.equal(linkInArgv(["/Applications/Bloks", "bloks://plan"]), "bloks://plan");
});
