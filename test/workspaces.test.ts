// The list of workspaces the desktop app keeps (electron/workspaces.mjs).
// What matters most is the first launch: the folder people already have
// becomes Personal where it is, and nothing about it is touched. After
// that, the rules a person meets: one Business, names that tell apart,
// Personal never deleted, mutes that end on their own, and notices that
// follow each workspace's own switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addWorkspace,
  allowsNotice,
  badgeTotal,
  cleanName,
  configuredPort,
  isMuted,
  mergeDrains,
  muteFor,
  muteState,
  nextMuteEnd,
  parseRegistry,
  readRegistry,
  removeWorkspace,
  reorder,
  rerollMark,
  setCurrent,
  settle,
  snapshot,
  updateWorkspace,
  writeRegistry,
  type Registry,
} from "../electron/workspaces.mjs";
import { BUSINESS_MARK, PERSONAL_MARK, isCustomMark, sameMark } from "../electron/workspace-marks.mjs";

const HOME_DATA = "/Users/someone/.bloks";
const WS_DIR = "/Users/someone/Library/Application Support/Bloks/workspaces";
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const fresh = (): Registry => settle(parseRegistry(null), { personalDataDir: HOME_DATA, now: NOW });

let ids = 0;
function add(reg: Registry, input: { kind: string; name: string; team?: boolean; mark?: any }) {
  return addWorkspace(reg, input, { workspacesDir: WS_DIR, now: NOW, random: seeded(++ids), id: `ws_${ids}` });
}

test("the first launch makes the folder that was always there Personal, in place", () => {
  const reg = fresh();
  assert.equal(reg.workspaces.length, 1);
  const [personal] = reg.workspaces;
  assert.equal(personal.kind, "personal");
  assert.equal(personal.name, "Personal");
  assert.equal(personal.dataDir, HOME_DATA, "Personal is ~/.bloks itself, not a copy of it");
  assert.deepEqual(personal.mark, { ...PERSONAL_MARK });
  assert.equal(personal.notify, "all", "as loud as the app was before workspaces");
  assert.equal(reg.current, personal.id);
});

test("settling twice changes nothing, and a saved list comes back the same", () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-ws-"));
  try {
    const file = join(dir, "workspaces.json");
    let reg = fresh();
    reg = add(reg, { kind: "custom", name: "Okafor Studio" }).registry;
    writeRegistry(file, reg);
    const back = settle(readRegistry(file), { personalDataDir: "/somewhere/else" });
    assert.deepEqual(back, reg);
    assert.equal(back.workspaces[0].dataDir, HOME_DATA, "a later launch never re-points Personal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable list costs a fresh one, never the app", () => {
  const reg = settle(parseRegistry("{ not json"), { personalDataDir: HOME_DATA });
  assert.equal(reg.workspaces[0].kind, "personal");
  const odd = parseRegistry(
    JSON.stringify({
      current: "nope",
      workspaces: [
        { id: "../../etc", kind: "custom", name: "x", dataDir: "/x" },
        { id: "a", kind: "wizard", name: "  Side \n project  ", dataDir: "/a", notify: "loud", mute: -5 },
        { id: "b", kind: "custom", name: "No folder" },
      ],
    }),
  );
  assert.deepEqual(odd.workspaces.map((w) => w.id), ["a"]);
  assert.equal(odd.workspaces[0].kind, "custom");
  assert.equal(odd.workspaces[0].name, "Side project");
  assert.equal(odd.workspaces[0].notify, "all");
  assert.equal(odd.workspaces[0].mute, null);
  const settled = settle(odd, { personalDataDir: HOME_DATA });
  assert.ok(settled.workspaces.some((w) => w.id === settled.current));
  assert.ok(isCustomMark(settled.workspaces.find((w) => w.id === "a")!.mark), "a missing mark is drawn on load");
});

test("a new workspace gets a folder of its own, by id, under the app's folder", () => {
  const { registry, entry } = add(fresh(), { kind: "custom", name: "Okafor Studio", team: true });
  assert.equal(entry.dataDir, join(WS_DIR, entry.id));
  assert.equal(entry.team, true);
  assert.ok(isCustomMark(entry.mark));
  assert.equal(registry.workspaces.at(-1)!.id, entry.id);
});

test("Business wears its fixed mark, and there is only ever one", () => {
  const first = add(fresh(), { kind: "business", name: "Business" });
  assert.deepEqual(first.entry.mark, { ...BUSINESS_MARK });
  assert.throws(() => add(first.registry, { kind: "business", name: "Other business" }), /Business workspace already/);
  assert.throws(() => add(first.registry, { kind: "personal", name: "Second me" }), /Business or has a name/);
});

test("names are cleaned, needed, and tell workspaces apart", () => {
  assert.equal(cleanName("  Rahimi\tEnterprises \n"), "Rahimi Enterprises");
  assert.equal(cleanName("x".repeat(90)).length, 40);
  const one = add(fresh(), { kind: "custom", name: "Clients" }).registry;
  assert.throws(() => add(one, { kind: "custom", name: "  " }), /Give it a name/);
  assert.throws(() => add(one, { kind: "custom", name: "clients" }), /called clients already/);
  assert.throws(() => add(one, { kind: "custom", name: "personal" }), /called personal already/);
});

test("the mark the dialog showed is kept while it is free, and replaced when it is not", () => {
  const first = add(fresh(), { kind: "custom", name: "Shop" });
  const offered = { ...first.entry.mark! };
  const second = add(first.registry, { kind: "custom", name: "Archive", mark: offered });
  assert.ok(!sameMark(second.entry.mark, offered), "two workspaces never share a mark");
  const free = { color: "#5B5F6B", pattern: "011011100" };
  const third = add(second.registry, { kind: "custom", name: "Podcast", mark: free });
  assert.ok(sameMark(third.entry.mark, free));
  // a mark that is not a custom one is never taken at its word
  const fourth = add(third.registry, { kind: "custom", name: "Wedding", mark: { ...PERSONAL_MARK } });
  assert.ok(isCustomMark(fourth.entry.mark));
});

test("rerolling gives a different mark nobody else has; fixed marks do not reroll", () => {
  let reg = fresh();
  for (const name of ["A", "B", "C"]) reg = add(reg, { kind: "custom", name }).registry;
  const target = reg.workspaces[2];
  const after = rerollMark(reg, target.id, { random: seeded(9) });
  const mark = after.workspaces[2].mark!;
  assert.ok(!sameMark(mark, target.mark));
  for (const other of after.workspaces) if (other.id !== target.id) assert.ok(!sameMark(other.mark, mark));
  assert.throws(() => rerollMark(reg, reg.workspaces[0].id), /fixed/);
  assert.throws(() => updateWorkspace(reg, reg.workspaces[1].id, { mark: { ...reg.workspaces[2].mark! } }), /Another workspace/);
});

test("changing kind: to Business takes its mark, away from it draws one; Personal stays Personal", () => {
  let reg = add(fresh(), { kind: "custom", name: "Work" }).registry;
  const id = reg.workspaces[1].id;
  reg = updateWorkspace(reg, id, { kind: "business" });
  assert.deepEqual(reg.workspaces[1].mark, { ...BUSINESS_MARK });
  reg = updateWorkspace(reg, id, { kind: "custom", name: "Work again" });
  assert.ok(isCustomMark(reg.workspaces[1].mark));
  assert.equal(reg.workspaces[1].name, "Work again");
  const personal = updateWorkspace(reg, "personal", { kind: "business", name: "Home" });
  assert.equal(personal.workspaces[0].kind, "personal");
  assert.equal(personal.workspaces[0].name, "Home");
});

test("Personal is never deleted; deleting the current one goes back to Personal", () => {
  let reg = add(fresh(), { kind: "custom", name: "Gone soon" }).registry;
  const id = reg.workspaces[1].id;
  assert.throws(() => removeWorkspace(reg, "personal"), /Personal cannot be deleted/);
  reg = setCurrent(reg, id);
  const { registry, removed } = removeWorkspace(reg, id);
  assert.equal(removed.id, id);
  assert.equal(registry.current, "personal");
  assert.deepEqual(registry.workspaces.map((w) => w.order), [0]);
});

test("a new order keeps everyone, mentioned or not", () => {
  let reg = fresh();
  for (const name of ["A", "B", "C"]) reg = add(reg, { kind: "custom", name }).registry;
  const [p, a, b, c] = reg.workspaces.map((w) => w.id);
  const next = reorder(reg, [c, p]);
  assert.deepEqual(next.workspaces.map((w) => w.id), [c, p, a, b]);
  assert.deepEqual(next.workspaces.map((w) => w.order), [0, 1, 2, 3]);
});

test("a mute runs out on its own; forever lasts until turned off", () => {
  const hour = muteFor("1h", NOW);
  assert.equal(hour, NOW + 3_600_000);
  const entry = { mute: hour as number | "forever" | null, notify: "all" as const };
  assert.equal(isMuted(entry, NOW), true);
  assert.equal(isMuted(entry, NOW + 3_599_999), true);
  assert.equal(isMuted(entry, NOW + 3_600_000), false, "over at the minute it said");
  assert.deepEqual(muteState(entry, NOW + 3_600_001), { muted: false, until: null });
  assert.deepEqual(muteState({ mute: "forever" }, NOW * 2), { muted: true, until: "forever" });
  assert.equal(muteFor("forever", NOW), "forever");
  assert.equal(muteFor("off", NOW), null);
  assert.equal(muteFor("15m", NOW), NOW + 15 * 60_000);
  assert.equal(muteFor("24h", NOW), NOW + 24 * 3_600_000);
  assert.throws(() => muteFor("2h", NOW));
  assert.equal(nextMuteEnd([{ mute: null }, { mute: "forever" }, { mute: NOW + 50 }, { mute: NOW + 10 }, { mute: NOW - 1 }], NOW), NOW + 10);
});

test("notices follow each workspace's level, and a mute silences every level", () => {
  const at = (notify: "all" | "needs-me" | "nothing", mute: number | "forever" | null = null) => ({ notify, mute });
  assert.equal(allowsNotice(at("all"), "activity", NOW), true);
  assert.equal(allowsNotice(at("all"), "needs-me", NOW), true);
  assert.equal(allowsNotice(at("needs-me"), "activity", NOW), false);
  assert.equal(allowsNotice(at("needs-me"), "needs-me", NOW), true);
  assert.equal(allowsNotice(at("nothing"), "needs-me", NOW), false);
  assert.equal(allowsNotice(at("all", NOW + 1000), "needs-me", NOW), false, "muted: not even approvals");
  assert.equal(allowsNotice(at("all", NOW - 1000), "needs-me", NOW), true, "a mute that ran out is over");
  assert.equal(allowsNotice(at("all", "forever"), "needs-me", NOW), false);
  assert.equal(allowsNotice(null, "needs-me", NOW), false);
});

test("the Dock badge is the sum of what may still interrupt", () => {
  const entries = [
    { id: "a", notify: "all" as const, mute: null },
    { id: "b", notify: "needs-me" as const, mute: null },
    { id: "c", notify: "nothing" as const, mute: null },
    { id: "d", notify: "all" as const, mute: "forever" as const },
    { id: "e", notify: "all" as const, mute: NOW - 5 },
  ];
  assert.equal(badgeTotal(entries, { a: 2, b: 3, c: 7, d: 9, e: 1, z: 40 }, NOW), 6);
  assert.equal(badgeTotal(entries, { a: -1, b: Number.NaN }, NOW), 0);
});

test("the drain before an update waits for every workspace", () => {
  assert.equal(mergeDrains([null, null]), null);
  assert.deepEqual(
    mergeDrains([
      { draining: true, done: true, running: [], deadline: 10 },
      { draining: true, done: false, running: ["x"], deadline: 30 },
      null,
    ]),
    { draining: true, done: false, running: ["x"], deadline: 30 },
  );
  assert.equal(mergeDrains([{ draining: true, done: true, running: [] }])!.done, true);
});

test("the window is told what it draws, and live state where the main process has it", () => {
  let reg = add(fresh(), { kind: "custom", name: "Okafor Studio" }).registry;
  reg = updateWorkspace(reg, reg.workspaces[1].id, { mute: NOW + 60_000, notify: "needs-me" });
  const shown = snapshot(reg, { [reg.workspaces[1].id]: { status: "running", waiting: 2 } }, NOW);
  assert.equal(shown.current, "personal");
  assert.equal(shown.workspaces[0].status, "stopped");
  assert.equal(shown.workspaces[1].waiting, 2);
  assert.deepEqual(shown.workspaces[1].mute, { muted: true, until: NOW + 60_000 });
  assert.equal(shown.workspaces[1].notify, "needs-me");
});

test("a workspace's own config.json may choose its port", () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-ws-port-"));
  try {
    assert.equal(configuredPort(dir), null);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 9123 }));
    assert.equal(configuredPort(dir), 9123);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: "lots" }));
    assert.equal(configuredPort(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the list on disk is private to the person", () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-ws-mode-"));
  try {
    const file = join(dir, "workspaces.json");
    writeRegistry(file, fresh());
    assert.ok(readFileSync(file, "utf8").includes('"personal"'));
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
