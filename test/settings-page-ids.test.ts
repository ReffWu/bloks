// Settings' pages as data (src/lib/settingsPages.ts): every id that was
// ever opened from somewhere still lands on a real page, the reducer
// takes the old ids where they went, and search finds the row a word
// lives on, not only its page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SETTINGS_GROUPS,
  SETTINGS_PAGE_LIST,
  SETTINGS_REDIRECTS,
  resolveSettingsPage,
  rowKey,
  searchSettings,
} from "../src/lib/settingsPages.ts";
import { initialState, reducer } from "../src/state/reducer.ts";

test("every page has one id, a group that exists, and words to be found by", () => {
  const ids = SETTINGS_PAGE_LIST.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const groups = new Set(SETTINGS_GROUPS.map((g) => g.id));
  for (const page of SETTINGS_PAGE_LIST) {
    assert.ok(groups.has(page.group), `${page.id} is in no group`);
    assert.ok(page.label && page.description, `${page.id} says nothing`);
    assert.equal(page.workspace === true, page.id.startsWith("workspace:"), `${page.id} is filed on the wrong side`);
    assert.ok(!/[\u2013\u2014]/.test(`${page.label} ${page.description} ${page.keywords} ${(page.rows ?? []).join(" ")}`), `${page.id} has a dash`);
  }
  assert.equal(SETTINGS_PAGE_LIST[0].id, "plan", "Plan leads the Account group");
});

test("old page ids go where their settings live now, and every redirect lands on a page", () => {
  assert.equal(resolveSettingsPage("cloud"), "plan");
  assert.equal(resolveSettingsPage("workspace:engines"), "engines");
  assert.equal(resolveSettingsPage("workspace:usage"), "plan");
  assert.equal(resolveSettingsPage("workspace:general"), "workspace:general");
  assert.equal(resolveSettingsPage("workspace:members"), "workspace:members");
  assert.equal(resolveSettingsPage("behaviour"), "behaviour");
  assert.equal(resolveSettingsPage("no-such-page"), "general");
  assert.equal(resolveSettingsPage(""), "general");
  assert.equal(resolveSettingsPage(undefined), "general");
  const known = new Set(SETTINGS_PAGE_LIST.map((p) => p.id));
  for (const [from, to] of Object.entries(SETTINGS_REDIRECTS)) {
    assert.ok(known.has(to), `${from} redirects to ${to}, which is not a page`);
    assert.ok(!known.has(from), `${from} is a page and a redirect at once`);
  }
});

test("every id the app and the server open is a page or a redirect", () => {
  const known = new Set([...SETTINGS_PAGE_LIST.map((p) => p.id), ...Object.keys(SETTINGS_REDIRECTS)]);
  // the security checkup's fixes are opened by id from the server
  const security = readFileSync(new URL("../server/security.ts", import.meta.url), "utf8");
  const fixes = [...security.matchAll(/kind: "page", page: "([\w:-]+)"/g)].map((m) => m[1]!);
  assert.ok(fixes.length >= 3);
  for (const id of fixes) assert.ok(known.has(id), `the security checkup opens ${id}, which is not a page`);
  // and the screens open these by name
  for (const id of ["general", "about-you", "engines", "apps", "rules", "plugins", "computers", "behaviour", "plan", "workspace:general", "workspace:members"]) {
    assert.ok(known.has(id), id);
  }
});

test("opening Settings at an old id lands on its new page", () => {
  const moved = reducer(initialState, { type: "toggleAppSettings", open: true, page: "cloud" });
  assert.equal(moved.appSettingsOpen, true);
  assert.equal(moved.settingsPage, "plan");
  const links = reducer(initialState, { type: "toggleAppSettings", open: true, page: "workspace:engines" });
  assert.equal(links.settingsPage, "engines");
  const plain = reducer(initialState, { type: "toggleAppSettings", open: true });
  assert.equal(plain.settingsPage, "general");
  const kept = reducer({ ...plain, appSettingsOpen: true, settingsPage: "voices" }, { type: "toggleAppSettings", open: true });
  assert.equal(kept.settingsPage, "voices", "opening Settings again without a page keeps the one on screen");
});

test("search finds the page and names the row a word lives on", () => {
  const compact = searchSettings("compact while");
  assert.deepEqual(
    compact.map((m) => m.page.id),
    ["behaviour"],
  );
  assert.deepEqual(compact[0]!.rows, ["Compact while idle"]);
  const name = searchSettings("your name");
  assert.ok(name.some((m) => m.page.id === "general" && m.rows.includes("Your name")));
  assert.ok(!name.some((m) => m.page.id === "plan"), "your name lives on General alone, not on Plan as well");
  // the key's choices are in one small menu on its row, and still found
  assert.ok(searchSettings("replace key").some((m) => m.page.id === "plan"));
  assert.deepEqual(searchSettings("bloks key").find((m) => m.page.id === "plan")?.rows, ["Bloks key"]);
  // a label that says the words already needs no row named under it
  assert.deepEqual(searchSettings("voices")[0]!.rows, []);
  // the old words still find where they went
  assert.ok(searchSettings("licence").some((m) => m.page.id === "plan"));
  assert.ok(searchSettings("boat").some((m) => m.page.id === "computers"));
  assert.deepEqual(searchSettings("zzzz nothing"), []);
  assert.equal(searchSettings("   ").length, SETTINGS_PAGE_LIST.length);
});

test("a row's address is its label, plainly", () => {
  assert.equal(rowKey("Compact while idle"), "compact-while-idle");
  assert.equal(rowKey("Something broken, or missing?"), "something-broken-or-missing");
});
