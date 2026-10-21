// Separate tasks within a budget the person allows (GitHub 326).
//
// The whole chain of agents' turns counts against the limit, which is
// what makes it a bound on cost (GitHub 248). A reviewer that moves from
// one task to the next inside turns other agents started was held as if
// the tasks were one runaway exchange. Now the person may allow a budget
// across separate tasks: a task an agent names when it hands work on
// counts its own run against the limit, and the whole chain counts
// against the budget, which no name an agent gives can reset. Without
// a budget nothing changes.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

import {
  agentTaskBudget,
  chainAgentRefusal,
  chainHoldText,
  chainPast,
  MAX_TASK_BUDGET,
  MAX_TASK_NAME_CHARS,
  MIN_TASK_BUDGET,
  pastAgentLimit,
  taskFor,
  taskName,
  validTaskBudget,
  type ChainTask,
} from "../server/agent-chain.ts";
import { controlledChain, type ChainBot, type ChainTurn } from "./helpers/agent-chain.ts";

const CLI = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));

// ── the rule, on its own ─────────────────────────────────────────────

/** Turns started by one message after another, each from the turn the
 * last one started, as the server keeps them: the place in the chain and
 * the task each turn is on. Returns the bound that held the message, at
 * the index it was refused, or null when all went. */
function walk(names: Array<string | undefined>, limit: number, budget: number | null) {
  let depth = 0;
  let task: ChainTask | undefined;
  for (const [i, named] of names.entries()) {
    const next = taskFor(task, named, depth);
    const held = chainPast(depth + 1, next, limit, budget);
    if (held) return { at: i, held };
    depth += 1;
    task = next;
  }
  return null;
}

test("without a budget the whole chain counts, whatever the tasks are called", () => {
  const renamed = Array.from({ length: 20 }, (_, i) => `Task ${i}`);
  assert.deepEqual(walk(renamed, 12, null), { at: 12, held: "limit" });
  assert.deepEqual(walk(Array(20).fill(undefined), 12, null), { at: 12, held: "limit" });
  // a budget no higher than the limit is no budget
  assert.deepEqual(walk(renamed, 12, 12), { at: 12, held: "limit" });
  assert.deepEqual(walk(renamed, 12, 8), { at: 12, held: "limit" });
});

test("healthy sequential tasks go on within the budget, and stop at it", () => {
  // a reviewer on task A, then B, then C, each a handful of handoffs, the
  // first of each naming it and the rest going on with it
  const work = [
    "Task A", undefined, undefined, undefined,
    "Task B", undefined, undefined,
    "Task C", undefined, undefined,
  ];
  assert.equal(walk(work, 4, 10), null, "separate tasks within the budget were held");
  assert.deepEqual(walk(work, 4, null), { at: 4, held: "limit" }, "without the budget the fifth turn is held, as today");
  assert.deepEqual(walk([...work, "Task D"], 4, 10), { at: 10, held: "budget" });
  // a correction handed back to an earlier task's name starts that name's
  // run where it is named, and still counts toward the budget
  assert.equal(walk(["Task A", undefined, "Task B", "Task A", undefined], 2, 6), null);
});

test("a runaway loop on one task is still held at the limit", () => {
  assert.deepEqual(walk(["Loop", ...Array(20).fill(undefined)], 4, 10), { at: 4, held: "task" });
  assert.deepEqual(walk(Array(20).fill("Loop"), 4, 10), { at: 4, held: "task" });
  // and one that never names a task is the whole chain against the limit
  assert.deepEqual(walk(Array(20).fill(undefined), 4, 10), { at: 4, held: "limit" });
});

test("a loop that renames its work every time is held at the budget", () => {
  const renamed = Array.from({ length: 200 }, (_, i) => `Round ${i}`);
  assert.deepEqual(walk(renamed, 4, 10), { at: 10, held: "budget" });
  assert.deepEqual(walk(renamed, 1, MAX_TASK_BUDGET), { at: MAX_TASK_BUDGET, held: "budget" });
  // two names in turn do no better than many
  assert.deepEqual(walk(renamed.map((_, i) => (i % 2 ? "Even" : "Odd")), 4, 10), { at: 10, held: "budget" });
});

test("a task's start is the sending turn's place, never anything the agent says", () => {
  assert.deepEqual(taskFor(undefined, "Review C", 7), { name: "Review C", from: 7 });
  const on = { name: "Review C", from: 7 };
  assert.equal(taskFor(on, "Review C", 9), on, "the same name goes on with the task");
  assert.equal(taskFor(on, undefined, 9), on, "no name goes on with the turn's task");
  assert.deepEqual(taskFor(on, "Review D", 9), { name: "Review D", from: 9 });
  assert.equal(taskFor(undefined, undefined, 9), undefined);
});

test("only a number in the budget's bounds is a budget; anything else is none", () => {
  for (const value of [undefined, null, "24", 1, 0, -5, 1.5, true, [], {}, Number.NaN]) {
    assert.equal(agentTaskBudget(value), null, JSON.stringify(value));
  }
  assert.equal(agentTaskBudget(MIN_TASK_BUDGET), MIN_TASK_BUDGET);
  assert.equal(agentTaskBudget(40), 40);
  assert.equal(agentTaskBudget(MAX_TASK_BUDGET + 900), MAX_TASK_BUDGET, "past the bound is the bound");
  for (const value of [null, MIN_TASK_BUDGET, 40, MAX_TASK_BUDGET]) assert.equal(validTaskBudget(value), true, String(value));
  for (const value of [undefined, 1, MAX_TASK_BUDGET + 1, 2.5, "40", false]) assert.equal(validTaskBudget(value), false, String(value));
});

test("a task name is short text, tidied, and refused rather than cut", () => {
  assert.deepEqual(taskName(undefined), {});
  assert.deepEqual(taskName("  Review\n  task C "), { name: "Review task C" });
  assert.deepEqual(taskName("x".repeat(MAX_TASK_NAME_CHARS)), { name: "x".repeat(MAX_TASK_NAME_CHARS) });
  for (const value of ["", "   ", "x".repeat(MAX_TASK_NAME_CHARS + 1), 12, {}]) {
    assert.match(taskName(value).error ?? "", new RegExp(`from 1 to ${MAX_TASK_NAME_CHARS} characters`), JSON.stringify(value));
  }
});

test("each hold says which bound it was, and the agent is only told to wrap up", () => {
  const what = "A message from Alpha to Bravo was not delivered.";
  const limit = chainHoldText(what, { bound: "limit", limit: 12, budget: 40 });
  assert.match(limit, /^A message from Alpha to Bravo was not delivered: agents reached the limit of 12 consecutive turns\. /);
  const task = chainHoldText(what, { bound: "task", limit: 12, budget: 40, task: "Review C" });
  assert.match(task, /agents reached the limit of 12 consecutive turns on the task "Review C"\./);
  const budget = chainHoldText(what, { bound: "budget", limit: 12, budget: 40 }, "Example words");
  assert.match(budget, /agents used all 40 turns in a row you allowed across separate tasks\./);
  for (const text of [limit, task, budget]) {
    assert.match(text, /This limit helps prevent repeated messages from using up your plan\. Change it in Settings > Behaviour\./);
  }
  assert.match(budget, /Excerpt: "Example words"$/);
  for (const told of [chainAgentRefusal("Bravo", 12), chainAgentRefusal("Bravo", 12, 40)]) {
    assert.match(told, /^Bravo did not get this message: agents reached the /);
    assert.match(told, /Finish this turn and report any unfinished work\.$/);
    assert.doesNotMatch(told, /Settings|raise|switch off|plan|task "/i);
  }
  assert.match(chainAgentRefusal("Bravo", 12, 40), /the budget of 40 turns in a row for separate tasks/);
});

// ── the rule, in the workspace ───────────────────────────────────────

type Chain = Awaited<ReturnType<typeof controlledChain>>;

/** Messages handed round a ring of agents, each sent from the turn the
 * last one started, with the task named for each (or none). Stops at the
 * first refusal and returns it with where things stood. */
async function handoffs(f: Chain, ring: ChainBot[], names: Array<string | undefined>) {
  let turn = await f.begin(ring[0]);
  for (const [i, task] of names.entries()) {
    const from = ring[i % ring.length], to = ring[(i + 1) % ring.length];
    const before = f.turns().length;
    const res = await f.agent(turn, `/api/bots/${to.id}/messages`, { text: `Example handoff ${i + 1}`, ...(task ? { task } : {}) });
    if (!res.ok) return { at: i, res, from, to, turn };
    const next = await f.turnAfter(before);
    await f.finish(turn, from);
    turn = next;
  }
  return { at: names.length, res: null, from: ring[names.length % ring.length], to: ring[(names.length + 1) % ring.length], turn };
}

async function held(f: Chain, bot: ChainBot) {
  return (await f.messages(bot)).filter((m) => m.chainHeld);
}

test("without a budget, a workspace counts the whole chain however tasks are named", async (t) => {
  const f = await controlledChain(t, { agents: { turnLimit: 3 } });
  const a = await f.hire("Alpha"), b = await f.hire("Bravo");
  const out = await handoffs(f, [a, b], ["One", "Two", "Three", "Four"]);
  assert.equal(out.at, 3, "naming a new task moved the limit without a budget");
  assert.equal(out.res!.status, 429);
  assert.match((await out.res!.json()).error, new RegExp(`^${out.to.name} did not get this message: agents reached the limit of 3 consecutive turns\\.`));
  const [notice] = await held(f, out.to);
  assert.match(notice.text, new RegExp(`^A message from ${out.from.name} to ${out.to.name} was not delivered: agents reached the limit of 3 consecutive turns\\. `));
  assert.equal((await f.h.json("/api/config")).agents.taskBudget, null);
});

test("with the person's budget, a reviewer moves from task to task and stops at the budget", async (t) => {
  const f = await controlledChain(t, { agents: { turnLimit: 3, taskBudget: 8 } });
  const coordinator = await f.hire("Coordinator"), engineer = await f.hire("Engineer"), reviewer = await f.hire("Reviewer");
  // three tasks, each within the limit of three, eight turns in all
  const work = ["Task A", undefined, undefined, "Task B", undefined, undefined, "Task C", undefined];
  const out = await handoffs(f, [coordinator, engineer, reviewer], [...work, "Task D"]);
  assert.equal(out.at, work.length, "a healthy handoff within the budget was held");
  assert.equal(out.res!.status, 429);
  assert.match((await out.res!.json()).error, /agents reached the budget of 8 turns in a row for separate tasks\. Finish this turn/);
  const [notice] = await held(f, out.to);
  assert.ok(notice, "the person was not told");
  assert.match(notice.text, new RegExp(`^A message from ${out.from.name} to ${out.to.name} was not delivered: agents used all 8 turns in a row you allowed across separate tasks\\.`));
  assert.match(notice.text, /Change it in Settings > Behaviour\./);
  assert.match(notice.text, /Excerpt: "Example handoff 9"/);
  assert.equal(f.turns().length, work.length + 1, "the held message started a turn");
  // the person's next words start both counts over
  await f.finish(out.turn, out.from);
  const fresh = await f.begin(out.to, "The person writes again");
  const before = f.turns().length;
  const res = await f.agent(fresh, `/api/bots/${out.from.id}/messages`, { text: "After the person", task: "Task D" });
  assert.ok(res.ok, "the person's message did not start the chain over");
  await f.turnAfter(before);
});

test("with a budget, a runaway loop on one task is still held at the limit, named or not", async (t) => {
  const secret = "example-stored-credential-abcdefgh";
  const f = await controlledChain(t, { agents: { turnLimit: 3, taskBudget: 20 }, secrets: { example: secret } });
  const a = await f.hire("Alpha"), b = await f.hire("Bravo");
  const work = `Same work ${secret}`;
  const out = await handoffs(f, [a, b], [work, undefined, work, undefined]);
  assert.equal(out.at, 3);
  assert.equal(out.res!.status, 429);
  const told = (await out.res!.json()).error;
  assert.match(told, /agents reached the limit of 3 consecutive turns\. Finish this turn/);
  assert.doesNotMatch(told, /task|budget/i, "the agent was given a hint to rename the work");
  const [notice] = await held(f, out.to);
  // the name is the agent's words, and a stored secret in it is not repeated
  assert.match(notice.text, /agents reached the limit of 3 consecutive turns on the task "Same work \[redacted\]"\./);
  assert.ok(!notice.text.includes(secret));

  // and a loop that never names a task is the whole chain on the limit
  const c = await f.hire("Charlie"), d = await f.hire("Delta");
  const unnamed = await handoffs(f, [c, d], [undefined, undefined, undefined, undefined]);
  assert.equal(unnamed.at, 3);
  const [plain] = await held(f, unnamed.to);
  assert.match(plain.text, /agents reached the limit of 3 consecutive turns\. /);
});

test("three agents that rename their work every time are held at the budget", async (t) => {
  const f = await controlledChain(t, { agents: { turnLimit: 2, taskBudget: 6 } });
  const ring = [await f.hire("Alpha"), await f.hire("Bravo"), await f.hire("Charlie")];
  const out = await handoffs(f, ring, Array.from({ length: 10 }, (_, i) => `Round ${i + 1}`));
  assert.equal(out.at, 6, "renaming the work moved the budget");
  assert.equal(out.res!.status, 429);
  const [notice] = await held(f, out.to);
  assert.match(notice.text, /agents used all 6 turns in a row you allowed across separate tasks/);
});

test("a task carried on a message that waited still counts from where it was named", async (t) => {
  const f = await controlledChain(t, { agents: { turnLimit: 2, taskBudget: 6 } });
  const a = await f.hire("Alpha"), b = await f.hire("Bravo");
  const a0 = await f.begin(a);
  let n = f.turns().length;
  assert.ok((await f.agent(a0, `/api/bots/${b.id}/messages`, { text: "Start X", task: "Task X" })).ok);
  const b1 = await f.turnAfter(n);
  // Alpha is still busy, so this waits in its queue with its task
  const queued = await f.agent(b1, `/api/bots/${a.id}/messages`, { text: "Start Y", task: "Task Y" });
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).queued, true);
  // the queued message starts Alpha's next turn as soon as this one ends,
  // so Alpha is never idle in between
  n = f.turns().length;
  writeFileSync(join(f.home, `finish-${a0.pid}`), "");
  const a2 = await f.turnAfter(n);
  await f.finish(b1, b);
  // the second turn on Task Y: past the whole-chain limit of two, within
  // the task's own
  n = f.turns().length;
  const second = await f.agent(a2, `/api/bots/${b.id}/messages`, { text: "More on Y" });
  assert.ok(second.ok, "the task was lost while the message waited");
  const b3 = await f.turnAfter(n);
  await f.finish(a2, a);
  const third = await f.agent(b3, `/api/bots/${a.id}/messages`, { text: "Still more on Y" });
  assert.equal(third.status, 429);
  const [notice] = await held(f, a);
  assert.match(notice.text, /limit of 2 consecutive turns on the task "Task Y"/);
});

test("the budget is the person's: checked, saved, shown, and refused to agents", async (t) => {
  const f = await controlledChain(t);
  assert.equal((await f.h.json("/api/config")).agents.taskBudget, null, "a budget nobody allowed");
  const put = (agents: unknown) => f.h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ agents }) });
  const res = await put({ taskBudget: 40 });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).agents, { turnLimit: 12, taskBudget: 40 });
  // the limit alone leaves the budget where it was, and the other way round
  assert.equal((await put({ turnLimit: 20 })).status, 200);
  assert.deepEqual((await f.h.json("/api/config")).agents, { turnLimit: 20, taskBudget: 40 });
  await f.restart();
  assert.deepEqual((await f.h.json("/api/config")).agents, { turnLimit: 20, taskBudget: 40 });
  const saved = () => readFileSync(join(f.home, ".bloks/config.json"), "utf8");
  for (const taskBudget of [1, 0, MAX_TASK_BUDGET + 1, 2.5, "40", true, {}]) {
    const before = saved();
    const refused = await put({ taskBudget });
    assert.equal(refused.status, 400, JSON.stringify(taskBudget));
    assert.match((await refused.json()).error, new RegExp(`agents\\.taskBudget must be a whole number from ${MIN_TASK_BUDGET} to ${MAX_TASK_BUDGET}, or null for none`));
    assert.equal(saved(), before);
  }
  // a valid budget beside a bad limit writes neither
  const before = saved();
  assert.equal((await put({ turnLimit: 0, taskBudget: 30 })).status, 400);
  assert.equal(saved(), before);
  assert.equal((await put({})).status, 400);
  // off again
  assert.equal((await put({ taskBudget: null })).status, 200);
  assert.equal((await f.h.json("/api/config")).agents.taskBudget, null);
  // never an agent's to set
  const a = await f.hire("Alpha");
  const turn = await f.begin(a);
  assert.equal((await f.agent(turn, "/api/config", { agents: { taskBudget: MAX_TASK_BUDGET } }, "PUT")).status, 403);
  assert.equal((await f.h.json("/api/config")).agents.taskBudget, null);
});

test("an agent's task name is checked before anything is delivered", async (t) => {
  const f = await controlledChain(t, { agents: { turnLimit: 2, taskBudget: 6 } });
  const a = await f.hire("Alpha"), b = await f.hire("Bravo");
  const turn = await f.begin(a);
  for (const task of ["", "x".repeat(MAX_TASK_NAME_CHARS + 1), 42]) {
    const res = await f.agent(turn, `/api/bots/${b.id}/messages`, { text: "Example work", task });
    assert.equal(res.status, 400, JSON.stringify(task));
    assert.match((await res.json()).error, /task is the name of the task this message hands off/);
  }
  assert.ok(!(await f.messages(b)).some((m) => m.text === "Example work"), "a refused message was delivered");
  assert.equal(f.turns().length, 1);
});

/** The real `bloks` on a turn's credential. */
async function bloks(f: Chain, turn: ChainTurn, args: string[]) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { HOME: f.home, BLOKS_URL: f.h.url, BLOKS_TOKEN: turn.token } });
  let out = "", err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  const exit = await new Promise<number | null>((done) => child.once("close", done));
  return { exit, out, err, body: out.trim() ? JSON.parse(out) : null };
}

test("bloks say --task names the task, either side of who it is to", async (t: TestContext) => {
  const f = await controlledChain(t, { agents: { turnLimit: 1, taskBudget: 6 } });
  const a = await f.hire("Alpha"), b = await f.hire("Bravo");
  let turn = await f.begin(a);
  let n = f.turns().length;
  const first = await bloks(f, turn, ["say", "--task", "Task A", b.id, "Start", "on", "A"]);
  assert.equal(first.exit, 0, first.err);
  let next = await f.turnAfter(n);
  assert.match(next.text, /Start on A/);
  await f.finish(turn, a);
  turn = next;
  // at the limit of one, only a message on a task of its own may go
  const plain = await bloks(f, turn, ["say", a.id, "Same", "task"]);
  assert.notEqual(plain.exit, 0);
  assert.match(plain.body?.error ?? plain.err, /agents reached the limit of 1 consecutive turn\./);
  n = f.turns().length;
  const named = await bloks(f, turn, ["say", a.id, "--task", "Task B", "--now", "Start", "on", "B"]);
  assert.equal(named.exit, 0, named.err);
  next = await f.turnAfter(n);
  assert.match(next.text, /Start on B/);
  assert.doesNotMatch(next.text, /--task|--now/);
  const missing = await bloks(f, next, ["say", b.id, "--task"]);
  assert.notEqual(missing.exit, 0);
  assert.match(missing.body?.error ?? missing.err, /--task needs the name of the task/);
});

test("routines and watchers an agent files on a task still count the whole chain", async (t) => {
  // a routine or a watcher carries only the chain's place, so with a
  // budget it is held at the limit as it always was
  const f = await controlledChain(t, { agents: { turnLimit: 3, taskBudget: 10 } });
  const a = await f.hire("Alpha"), b = await f.hire("Bravo");
  const out = await handoffs(f, [a, b], ["Task A", undefined, "Task B", undefined, "Task C"]);
  assert.equal(out.at, 5);
  const routine = await f.agent(out.turn, "/api/routines", { targetId: out.from.id, targetKind: "agent", prompt: "Example", time: "23:59", days: [] });
  assert.equal(routine.status, 201);
  const chain = (await routine.json()).routine.chain;
  assert.equal(chain, 6);
  assert.equal(pastAgentLimit(chain, 3), true, "the routine would run past the limit");
});
