import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_WINDOW_MS, ASK_REUSE_MS, DeviceSettings, MAX_OBSERVATIONS, OBSERVATION_TTL_MS, phoneSettings,
} from "../server/settings-devices.ts";

function clocks() {
  const c = { mono: 1_000, wall: 1_700_000_000_000 };
  return { c, clocks: { monotonic: () => c.mono, wall: () => c.wall } };
}
const window = (theme = "dark") => ({ schema: 1, revision: 1, observedAt: 5, values: { "theme.applied": { status: "observed", value: theme } } });
const local = { path: "local" as const, deviceId: null };
const phone = { path: "relay" as const, deviceId: "owner-phone" };
const none = (text: string) => text;
const setting = (over: Record<string, unknown> = {}) => ({
  id: "looks.roleBadges", kind: "preference", value: { status: "value", value: false }, default: { status: "value", value: true },
  owner: "Conversation list", control: "Settings > How it looks > Role badges", ...over,
});

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
  for (let i = 0; i < 4; i++) assert.ok(store.reportPhone({ path: "relay", deviceId: `phone-${i}` }, { reason: "connected", observedAt: 1, settings: [setting()] }, null, none));
  const seen = store.inspect(null);
  assert.equal(seen.entries.length, MAX_OBSERVATIONS);
  assert.equal(seen.droppedForSpace, 4);
  assert.ok(!seen.entries.some((e) => e.label === "window-0000"), "the oldest goes first");
  c.wall += OBSERVATION_TTL_MS + 1;
  assert.equal(store.inspect(null).entries.length, 0, "a day-old word is dropped the next time anything looks");
});

test("a phone reports as itself when it connects and changes, and answers an ask as current", () => {
  const { c, clocks: k } = clocks();
  const store = new DeviceSettings(k);
  assert.equal(store.reportPhone(local, { reason: "connected", observedAt: 1, settings: [setting()] }, null, none), false, "no paired identity, no phone report");
  assert.equal(store.reportPhone(phone, { observedAt: 1, settings: [setting()] }, null, none), false, "an unasked report says why it was sent");
  assert.ok(store.reportPhone(phone, { reason: "connected", observedAt: 1, settings: [setting()] }, "iOS 3.0 (40)", none));
  c.mono += 10;
  let request = "";
  const ask = store.ask((frame) => { request = frame.request; });
  let entry = store.inspect(ask).entries[0]!;
  assert.equal(entry.freshness, "last-reported", "a report from before the ask is not current");
  assert.equal(entry.client, "iOS 3.0 (40)");
  assert.equal(store.reportPhone(phone, { request: "y".repeat(43), observedAt: 2, settings: [] }, null, none), false);
  assert.ok(store.reportPhone(phone, { request, observedAt: 2, settings: [setting({ value: { status: "value", value: true } })] }, null, none));
  entry = store.inspect(ask).entries[0]!;
  assert.equal(entry.freshness, "current");
  assert.equal(entry.reason, "asked");
  assert.deepEqual(entry.phone![0]!.value, { status: "value", value: true }, "a report replaces the last one whole");
  store.forget("owner-phone");
  assert.equal(store.inspect(ask).entries.length, 0, "a revoked device's word goes with it");
});

test("phone settings are narrow: credentials say configured only, defaults are the device's, bad shapes are refused", () => {
  const redact = (text: string) => text.split("PROTECTED-VALUE").join("[redacted]");
  assert.equal(phoneSettings({}, redact), null);
  assert.equal(phoneSettings(Array.from({ length: 65 }, (_, i) => setting({ id: `a.b${i}` })), redact), null);
  assert.equal(phoneSettings([setting(), setting()], redact), null, "an id twice is refused");
  assert.equal(phoneSettings([setting({ id: "../etc" })], redact), null);
  assert.equal(phoneSettings([setting({ kind: "secret" })], redact), null);
  const out = phoneSettings([
    setting({ id: "pairing.token", kind: "credential", value: { status: "value", value: "PROTECTED-VALUE" }, default: { status: "value", value: "x" } }),
    setting({ id: "pairing.relay", kind: "credential", value: { status: "configured", configured: true } }),
    setting({ id: "looks.text", value: { status: "value", value: "PROTECTED-VALUE beside text" } }),
    setting({ id: "looks.nested", value: { status: "value", value: { token: "PROTECTED-VALUE" } } }),
    setting({ id: "system.notifications", kind: "system", value: { status: "unknown", reason: "not_determined" }, default: null }),
  ], redact)!;
  assert.deepEqual(out[0]!.value, { status: "unknown", reason: "invalid_report" }, "a credential sent as a value is refused, not passed on");
  assert.equal(out[0]!.default, null, "a credential has no default to say");
  assert.deepEqual(out[1]!.value, { status: "configured", configured: true });
  assert.deepEqual(out[2]!.value, { status: "value", value: "[redacted] beside text" });
  assert.deepEqual(out[3]!.value, { status: "unknown", reason: "invalid_report" }, "nested values never pass through");
  assert.equal(out[4]!.default, null);
  assert.ok(!JSON.stringify(out).includes("PROTECTED-VALUE"));
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
