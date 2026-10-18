import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_WINDOW_MS, ASK_REUSE_MS, DeviceSettings, MAX_OBSERVATIONS, OBSERVATION_TTL_MS,
} from "../server/settings-devices.ts";

function clocks() {
  const c = { mono: 1_000, wall: 1_700_000_000_000 };
  return { c, clocks: { monotonic: () => c.mono, wall: () => c.wall } };
}
const window = (theme = "dark") => ({ schema: 1, revision: 1, observedAt: 5, values: { "theme.applied": { status: "observed", value: theme } } });
const local = { path: "local" as const, deviceId: null };

test("nothing is asked, kept or sent until an inspection asks, and one ask serves a burst of reads", () => {
  const { c, clocks: k } = clocks();
  const store = new DeviceSettings(k);
  assert.equal(store.inspect(null).entries.length, 0);
  const frames: unknown[] = [];
  const first = store.ask((frame) => frames.push(frame));
  c.mono += ASK_REUSE_MS - 1;
  assert.equal(store.ask((frame) => frames.push(frame)), first, "a read soon after joins the same ask");
  assert.equal(frames.length, 1);
  c.mono += 2;
  store.ask((frame) => frames.push(frame));
  assert.equal(frames.length, 2, "a read after the reuse window asks again");
  assert.match((frames[0] as { request: string }).request, /^[A-Za-z0-9_-]{43}$/);
});

test("a window is heard only as the answer to a live ask; an unasked or stale answer is refused", () => {
  const { c, clocks: k } = clocks();
  const store = new DeviceSettings(k);
  assert.equal(store.reportWindow(local, { label: "window-one", snapshot: window() }, null), false, "a loopback caller cannot plant an unasked report");
  let request = "";
  const ask = store.ask((frame) => { request = frame.request; });
  assert.equal(store.reportWindow(local, { request: "x".repeat(43), label: "window-one", snapshot: window() }, null), false);
  assert.equal(store.reportWindow(local, { request, label: "bad label", snapshot: window() }, null), false);
  assert.equal(store.reportWindow(local, { request, label: "window-one", snapshot: { schema: 2 } }, null), false);
  assert.equal(store.reportWindow(local, { request, label: "window-one", snapshot: window() }, null), true);
  const seen = store.inspect(ask);
  assert.equal(seen.entries.length, 1);
  assert.equal(seen.entries[0]!.freshness, "current");
  assert.equal(seen.entries[0]!.source.identity, "owner-local-window");
  assert.ok(!JSON.stringify(seen).includes(request), "the ask id is never shown");
  c.mono += ANSWER_WINDOW_MS + 1;
  assert.equal(store.reportWindow(local, { request, label: "window-two", snapshot: window() }, null), false, "a late answer is no answer");
});

test("an older answer stays, dated, as last-reported and is never shown as current", () => {
  const { c, clocks: k } = clocks();
  const store = new DeviceSettings(k);
  let request = "";
  store.ask((frame) => { request = frame.request; });
  assert.ok(store.reportWindow(local, { request, label: "window-one", snapshot: window("light") }, null));
  c.mono += ASK_REUSE_MS + 1; c.wall += 60_000;
  const later = store.ask(() => {});
  const seen = store.inspect(later).entries[0]!;
  assert.equal(seen.freshness, "last-reported");
  assert.equal(seen.receivedAt, 1_700_000_000_000);
  assert.deepEqual(seen.window!.values["theme.applied"], { status: "observed", value: "light" });
});

test("storage is bounded by count and pruned by age, without a timer", () => {
  const { c, clocks: k } = clocks();
  const store = new DeviceSettings(k);
  let request = "";
  store.ask((frame) => { request = frame.request; });
  for (let i = 0; i < MAX_OBSERVATIONS; i++) assert.ok(store.reportWindow(local, { request, label: `window-${String(i).padStart(4, "0")}`, snapshot: window() }, null));
  assert.equal(store.reportWindow(local, { request, label: "one-too-many", snapshot: window() }, null), false, "one ask takes a bounded number of answers");
  c.mono += ASK_REUSE_MS + 1;
  let next = "";
  store.ask((frame) => { next = frame.request; });
  for (let i = 0; i < 4; i++) assert.ok(store.reportWindow({ path: "relay", deviceId: `computer-${i}` }, { request: next, label: "window-late", snapshot: window() }, null));
  const seen = store.inspect(null);
  assert.equal(seen.entries.length, MAX_OBSERVATIONS);
  assert.equal(seen.droppedForSpace, 4);
  assert.ok(!seen.entries.some((e) => e.label === "window-0000"), "the oldest goes first");
  c.wall += OBSERVATION_TTL_MS + 1;
  assert.equal(store.inspect(null).entries.length, 0, "a day-old word is dropped the next time anything looks");
});

test("a read waits for answers, but no longer than its own deadline, and leaves no timer behind", async () => {
  const store = new DeviceSettings();
  let request = "";
  const ask = store.ask((frame) => { request = frame.request; });
  const started = performance.now();
  const waiting = store.wait(ask, (answers) => answers >= 1, 1_000);
  setTimeout(() => store.reportWindow(local, { request, label: "window-one", snapshot: window() }, null), 20);
  await waiting;
  assert.ok(performance.now() - started < 900, "the answer ended the wait");
  const other = new DeviceSettings();
  const quiet = other.ask(() => {});
  const begun = performance.now();
  await other.wait(quiet, () => false, 60);
  assert.ok(performance.now() - begun >= 50);
});
