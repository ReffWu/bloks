// How the desktop reads the incident desk (server/incidents.ts): which of
// its messages interrupt, how a lead's quiet turn is named in a fold, and
// a link into Automations that opens on the routine or watcher it is about.
import assert from "node:assert/strict";
import { test } from "node:test";

import { failedCount } from "../src/lib/activityCount.ts";
import { noticeFor, type NotifyContext } from "../src/lib/notify.ts";
import { askerWords } from "../src/lib/turnFold.ts";
import { initialState, reducer } from "../src/state/reducer.ts";

const bot = { id: "bot-1", name: "Sage", notifications: false };
const base: NotifyContext = { replySettled: true, focused: false, selectedId: "", threadId: "t1", bot };

test("a card that needs the person interrupts, past the agent's own switch", () => {
  const notice = noticeFor({ role: "bot", kind: "notice", text: "Sage's turn failed: out of credit.", incident: { kind: "needs-you", state: "open" } }, base);
  assert.equal(notice?.title, "Sage needs you");
  assert.equal(notice?.urgent, true);
  // the one card while the desk is quiet does too
  assert.equal(noticeFor({ role: "bot", kind: "notice", text: "6 things failed", incident: { kind: "summary", state: "open" } }, base)?.urgent, true);
});

test("a settled card, the lead's note, and the card on screen say nothing", () => {
  assert.equal(noticeFor({ role: "bot", kind: "notice", text: "x", incident: { kind: "needs-you", state: "resolved" } }, base), null);
  assert.equal(noticeFor({ role: "bot", kind: "notice", text: "x", incident: { kind: "note" } }, base), null);
  const watching = { ...base, focused: true, selectedId: "bot-1" };
  assert.equal(noticeFor({ role: "bot", kind: "notice", text: "x", incident: { kind: "needs-you", state: "open" } }, watching), null);
  // an incident's words naming a limit are still the desk's card, not
  // the engine-out banner they would otherwise match
  const out = noticeFor({ role: "bot", kind: "notice", text: "failed: usage limit reached", incident: { kind: "needs-you", state: "open" } }, base);
  assert.equal(out?.title, "Sage needs you");
});

test("a routine that stopped for failing is a quiet word, never an interruption", () => {
  const notice = noticeFor({ role: "bot", kind: "notice", text: "The routine Sweep failed 3 times in a row.", failing: { kind: "routine" } }, base);
  assert.equal(notice?.urgent, false);
  assert.equal(notice?.title, "Sage");
});

test("a lead's quiet turn is named as the desk's in its fold", () => {
  assert.equal(askerWords({ by: "incident" }), "About something that failed");
});

test("a link into Automations can open on one routine or watcher, and closing forgets it", () => {
  const open = reducer(initialState, { type: "toggleRoutines", open: true, tab: "watchers", focus: { kind: "watcher", id: "w1" } });
  assert.equal(open.routinesTab, "watchers");
  assert.deepEqual(open.routinesFocus, { kind: "watcher", id: "w1" });
  const closed = reducer(open, { type: "toggleRoutines", open: false });
  assert.equal(closed.routinesFocus, null);
  const plain = reducer(initialState, { type: "toggleRoutines", open: true });
  assert.equal(plain.routinesFocus, null);
});

test("what failed is counted once: a stopped routine with its own card is one thing", () => {
  const incidents = [
    { subject: "routine:r1", state: "needs-you" },
    { subject: "lane:l1", state: "needs-you" },
    { subject: "lane:l2", state: "with-lead" },
  ];
  assert.equal(failedCount(incidents, [{ kind: "routine", id: "r1" }, { kind: "watcher", id: "w1" }]), 3);
  assert.equal(failedCount([], []), 0);
});
