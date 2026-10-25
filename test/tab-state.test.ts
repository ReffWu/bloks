// Whether a conversation's tab says working or idle, and whether that is
// still true by the time anyone looks (GitHub 398).
//
// Two ways it went stale. The agent list asked for on load or reconnect
// could arrive after newer frames on the stream and put the older state
// back over them. And a turn starting or ending changed nothing on the
// tabs, so a finished turn read as working until another snapshot came.
import { test } from "node:test";
import assert from "node:assert/strict";

import { initialState, reducer, type Action, type AppState, type Bot, type TaskSummary } from "../src/state/reducer.ts";
import { snapshotOrder } from "../src/state/snapshotOrder.ts";

const lane = (id: string, state: TaskSummary["state"], over: Partial<TaskSummary> = {}): TaskSummary => ({ id, title: id, state, createdAt: 1, ...over });

const bot = (id: string, tasks: TaskSummary[], over: Partial<Bot> = {}): Bot => ({
  id,
  threadId: tasks[0]?.id ?? `t-${id}`,
  name: id,
  title: "",
  description: "",
  notifications: true,
  color: "blue",
  unread: false,
  modelSelection: { instanceId: "claude", model: "m" },
  messages: [],
  tasks,
  activeTaskId: tasks[0]?.id,
  busy: tasks.some((t) => t.state === "working"),
  ...over,
});

const stateOf = (s: AppState, botId: string, laneId: string) => s.bots.find((b) => b.id === botId)?.tasks?.find((t) => t.id === laneId)?.state;
const busyOf = (s: AppState, botId: string) => s.bots.find((b) => b.id === botId)?.busy;

/** The store's way with the stream and the list: every frame is applied
 * as it comes and noted for any load still out; a load's answer is the
 * list, then whatever the stream said after the list was made. */
function harness(start: Bot[]) {
  let state = reducer({ ...initialState }, { type: "hydrate", bots: start });
  const order = snapshotOrder<Action>();
  return {
    get state() {
      return state;
    },
    frame(seq: number | undefined, action: Action) {
      state = reducer(state, action);
      order.note(seq, action);
    },
    load() {
      const load = order.begin();
      return (bots: Bot[], seq?: number) => {
        state = reducer(state, { type: "hydrate", bots, after: load.settle(seq) });
      };
    },
  };
}

test("a list made while a turn ran cannot put working back over the newer idle", () => {
  const h = harness([bot("a", [lane("l1", "working")])]);
  const answer = h.load();
  // the server makes the list at sequence 10, mid-turn; the answer is slow
  const madeMidTurn = [bot("a", [lane("l1", "working")])];
  // the turn ends and its idle frame comes first
  h.frame(11, { type: "turnSettled", threadId: "l1" });
  h.frame(12, { type: "botPatched", bot: bot("a", [lane("l1", "idle")]) });
  assert.equal(stateOf(h.state, "a", "l1"), "idle");
  answer(madeMidTurn, 10);
  assert.equal(stateOf(h.state, "a", "l1"), "idle", "the late list put the finished turn back to working");
  assert.equal(busyOf(h.state, "a"), false);
});

test("a list made while idle cannot put idle back over a turn that has started since", () => {
  const h = harness([bot("a", [lane("l1", "idle")])]);
  const answer = h.load();
  const madeIdle = [bot("a", [lane("l1", "idle")])];
  h.frame(21, { type: "botPatched", bot: bot("a", [lane("l1", "working")]) });
  h.frame(22, { type: "turnStarted", threadId: "l1", turnId: "u1" });
  answer(madeIdle, 20);
  assert.equal(stateOf(h.state, "a", "l1"), "working", "the late list made a running turn look idle");
  assert.equal(busyOf(h.state, "a"), true);
});

test("what the list already holds is not said twice, and what came after it is kept", () => {
  const h = harness([bot("a", [lane("l1", "idle")])]);
  const answer = h.load();
  // the stream ran ahead of the list: 30 is in it, 31 is not
  h.frame(30, { type: "messageAdded", threadId: "l1", message: { id: "m1", role: "user", kind: "text", text: "go", at: 1 } });
  h.frame(31, { type: "messageAdded", threadId: "l1", message: { id: "m2", role: "bot", kind: "text", text: "done", at: 2 } });
  const made = [bot("a", [lane("l1", "idle")], { messages: [{ id: "m1", role: "user", kind: "text", text: "go", at: 1 }] })];
  answer(made, 30);
  assert.deepEqual(h.state.bots[0].messages.map((m) => m.id), ["m1", "m2"], "a reply that came after the list was lost");
});

test("going back over what the stream said does not cut off a reply streaming now", () => {
  const h = harness([bot("a", [lane("l1", "working")])]);
  const answer = h.load();
  h.frame(51, { type: "messageAdded", threadId: "l1", message: { id: "m1", role: "bot", kind: "text", text: "first", at: 1 } });
  h.frame(52, { type: "turnSettled", threadId: "l1", turnId: "u1" });
  h.frame(53, { type: "turnStarted", threadId: "l1", turnId: "u2" });
  h.frame(undefined, { type: "streamDelta", threadId: "l1", delta: "Second" });
  answer([bot("a", [lane("l1", "working")])], 50);
  assert.equal(h.state.streaming.l1, "Second", "the reply streaming now was cleared");
  assert.equal(h.state.liveTurns.l1, "u2");
  assert.equal(stateOf(h.state, "a", "l1"), "working");
  assert.deepEqual(h.state.bots[0].messages.map((m) => m.id), ["m1"]);
});

test("a server too old to say when its list was made still ends on what the stream said last", () => {
  const h = harness([bot("a", [lane("l1", "working")])]);
  const answer = h.load();
  h.frame(41, { type: "turnSettled", threadId: "l1" });
  h.frame(42, { type: "botPatched", bot: bot("a", [lane("l1", "idle")]) });
  answer([bot("a", [lane("l1", "working")])]);
  assert.equal(stateOf(h.state, "a", "l1"), "idle");
});

test("a load that was let go keeps nothing, and one that answered stops listening", () => {
  const order = snapshotOrder<string>();
  const dropped = order.begin();
  const kept = order.begin();
  order.note(1, "one");
  dropped.drop();
  order.note(2, "two");
  assert.deepEqual(kept.settle(0), ["one", "two"]);
  order.note(3, "three");
  assert.ok(!kept.settle(0).includes("three"), "a settled load went on collecting frames");
  assert.deepEqual(dropped.settle(0), ["one"], "a dropped load went on collecting frames");
  // a frame without a sequence cannot be placed, so it counts as newer
  const next = order.begin();
  order.note(undefined, "unplaced");
  order.note(4, "four");
  assert.deepEqual(next.settle(10), ["unplaced"]);
});

test("a turn ending sets its tab idle, and the agent idle once nothing else runs", () => {
  let s = reducer({ ...initialState }, { type: "hydrate", bots: [bot("a", [lane("l1", "working"), lane("l2", "working")])] });
  s = reducer(s, { type: "turnSettled", threadId: "l1", turnId: "u1" });
  assert.equal(stateOf(s, "a", "l1"), "idle", "a finished turn's tab still read working");
  assert.equal(stateOf(s, "a", "l2"), "working", "another lane's turn was ended with it");
  assert.equal(busyOf(s, "a"), true, "the agent read idle while another lane worked");
  s = reducer(s, { type: "turnSettled", threadId: "l2" });
  assert.equal(stateOf(s, "a", "l2"), "idle");
  assert.equal(busyOf(s, "a"), false, "the agent still read working with every lane idle");
});

test("a turn starting sets its tab and its agent working", () => {
  let s = reducer({ ...initialState }, { type: "hydrate", bots: [bot("a", [lane("l1", "idle"), lane("l2", "idle")])] });
  s = reducer(s, { type: "turnStarted", threadId: "l2", turnId: "u1" });
  assert.equal(stateOf(s, "a", "l2"), "working", "a running turn's tab still read idle");
  assert.equal(stateOf(s, "a", "l1"), "idle");
  assert.equal(busyOf(s, "a"), true);
});

test("a tab waiting on the person is left to the server either way", () => {
  // waiting outranks working on the server (blockedOn), and whether a
  // card still waits once its turn ends is the server's to say
  let s = reducer({ ...initialState }, { type: "hydrate", bots: [bot("a", [lane("l1", "needs-you")], { busy: true })] });
  s = reducer(s, { type: "turnStarted", threadId: "l1" });
  assert.equal(stateOf(s, "a", "l1"), "needs-you");
  s = reducer(s, { type: "turnSettled", threadId: "l1" });
  assert.equal(stateOf(s, "a", "l1"), "needs-you");
});

test("an older turn's end that arrives after a newer start leaves the tab working", () => {
  let s = reducer({ ...initialState }, { type: "hydrate", bots: [bot("a", [lane("l1", "idle")])] });
  s = reducer(s, { type: "turnStarted", threadId: "l1", turnId: "old" });
  s = reducer(s, { type: "turnStarted", threadId: "l1", turnId: "new" });
  s = reducer(s, { type: "turnSettled", threadId: "l1", turnId: "old" });
  assert.equal(stateOf(s, "a", "l1"), "working", "the newer turn read as finished");
  assert.equal(busyOf(s, "a"), true);
  // and a turn that is ended for it, with no id of its own (an engine
  // rebuilt under it), ends whatever runs
  s = reducer(s, { type: "turnSettled", threadId: "l1" });
  assert.equal(stateOf(s, "a", "l1"), "idle");
});

test("a turn asked again reads working again, not idle until the next snapshot", () => {
  let s = reducer({ ...initialState }, { type: "hydrate", bots: [bot("a", [lane("l1", "working")])] });
  s = reducer(s, { type: "turnSettled", threadId: "l1", turnId: "u1" });
  s = reducer(s, { type: "turnStarted", threadId: "l1", turnId: "u2" });
  assert.equal(stateOf(s, "a", "l1"), "working");
  s = reducer(s, { type: "turnSettled", threadId: "l1", turnId: "u2" });
  assert.equal(stateOf(s, "a", "l1"), "idle");
});

test("a turn's end drops what only a running turn carries", () => {
  let s = reducer({ ...initialState }, {
    type: "hydrate",
    bots: [bot("a", [lane("l1", "working", { room: "r1", codexDispatch: { configured: "fast" } as unknown as TaskSummary["codexDispatch"] })])],
  });
  s = reducer(s, { type: "turnSettled", threadId: "l1" });
  const t = s.bots[0].tasks![0];
  assert.equal(t.room, undefined, "the room still showed the agent thinking");
  assert.equal(t.codexDispatch, undefined);
});

test("an agent from a server that lists no lanes follows its own thread", () => {
  let s = reducer({ ...initialState }, { type: "hydrate", bots: [bot("a", [], { threadId: "t-a", busy: false, tasks: undefined })] });
  s = reducer(s, { type: "turnStarted", threadId: "t-a" });
  assert.equal(busyOf(s, "a"), true);
  s = reducer(s, { type: "turnSettled", threadId: "t-a" });
  assert.equal(busyOf(s, "a"), false);
});
