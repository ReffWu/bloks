// What a Claude turn does with the work it starts in the background
// (server/background-work.ts), on both of Claude Code's protocols: before
// 2.1.300, where the first result shuts stdin and the process goes on
// until its background work is done, and from 2.1.300, where every input
// has its own completion and stdin stays open for more.
//
// Let it finish keeps the turn open, shown as working, until the CLI's
// background tasks are done and the agent has said what came of them in
// a turn the CLI starts by itself. Stop when the reply is done ends the
// turn at the reply and stops the process, and what ran in it.
//
// The frames are the ones Claude Code 2.1.293 and 2.1.302 sent for a
// background shell command (task_started, background_tasks_changed,
// task_notification, and session_state_changed, which the turn asks for).
// The engine is a synthetic peer on a controlled clock.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";

const THREAD = "background-work-fixture";
const LEGACY = "2.1.299 (Claude Code)";
const ATTRIBUTED = "2.1.300 (Claude Code)";
let sessions = 0;

async function fixture(t: TestContext, version: string) {
  const home = mkdtempSync(join(tmpdir(), "bloks-background-work-"));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  const written: any[] = [];
  const events: any[] = [];
  const timeline: string[] = [];
  const spawned: { env?: Record<string, string | undefined> } = {};
  const peer = Object.assign(new EventEmitter(), {
    pid: 2_147_483_645,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdin: new Writable({
      write(chunk, _encoding, done) {
        written.push(JSON.parse(String(chunk)));
        done();
      },
      final(done) {
        timeline.push("stdin closed");
        done();
      },
    }),
    kill(signal: string) {
      timeline.push(signal);
      queueMicrotask(() => {
        if (peer.signalCode) return;
        peer.signalCode = signal;
        peer.emit("exit", null, signal);
        peer.emit("close", null, signal);
      });
      return true;
    },
  });
  t.mock.method(childProcess, "execFile", (_cli: unknown, _args: unknown, _opts: unknown, callback: any) => {
    queueMicrotask(() => callback(null, version));
    return new EventEmitter();
  });
  t.mock.method(childProcess, "spawn", (_cli: unknown, _args: unknown, options: any) => {
    spawned.env = options?.env;
    return peer;
  });
  t.mock.method(fs, "appendFileSync", () => {});
  t.mock.method(process, "kill", (pid: number) => {
    assert.equal(pid, -peer.pid, "only the peer's own group may be signalled");
    throw Object.assign(new Error("no such group"), { code: "ESRCH" });
  });
  syncBuiltinESMExports();
  const { ClaudeDriver } = await import("../server/drivers/claude.ts");
  const instance = await ClaudeDriver.create({
    instanceId: "claude",
    displayName: "Claude",
    enabled: true,
    environment: {},
    config: { cli: "fixture-claude", permissionMode: "bypassPermissions" } as any,
  });
  instance.adapter.onEvent((event) => {
    events.push(event);
    if (event.type === "turn.completed") timeline.push("turn.completed");
  });
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1_000_000 });
  t.after(async () => {
    if (!peer.signalCode) {
      peer.signalCode = "SIGKILL";
      peer.emit("exit", null, "SIGKILL");
      peer.emit("close", null, "SIGKILL");
    }
    t.mock.timers.reset();
    await instance.dispose();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  });
  const send = (frame: any) => peer.stdout.write(JSON.stringify(frame) + "\n");
  const flush = async () => {
    for (let i = 0; i < 10; i++) await setImmediate();
  };
  const tick = async (ms: number) => {
    t.mock.timers.tick(ms);
    await flush();
  };
  const ends = () => events.filter((event) => event.type === "turn.completed");
  const said = () => events.filter((event) => event.type === "item.completed" && event.itemType === "assistant_text").map((event) => event.text);
  const errors = () => events.filter((event) => event.type === "runtime.error").map((event) => event.message);
  const attributed = version === ATTRIBUTED;
  const session = `sess-background-${++sessions}`;
  let results = 0;

  /** Claude Code's frames for the turn's input, as each protocol sends them. */
  const engine = {
    start: async (backgroundWork?: "finish" | "stop", stallMs = 0) => {
      await instance.adapter.sendTurn({ threadId: THREAD, text: "Run the checks in the background", stallMs, ...(backgroundWork ? { backgroundWork } : {}) });
    },
    inputs: () => written.filter((frame) => frame.type === "user").map((frame) => frame.uuid as string | undefined),
    state: (state: "running" | "idle") => send({ type: "system", subtype: "session_state_changed", state, session_id: session }),
    /** The agent starts a shell command in the background and replies. */
    reply: (id: string | undefined, text: string, cost: number, { states = true } = {}) => {
      if (states) engine.state("running");
      send({ type: "system", subtype: "init", session_id: session, model: "claude-sonnet-5", ...(id ? { user_message_uuids: [id] } : {}) });
      if (id) send({ type: "system", subtype: "status", status: "requesting", uuid: `request-${id}`, user_message_uuids: [id] });
      send({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_checks", name: "Bash", input: { command: "npm run checks", run_in_background: true } }] } });
      send({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "bchecks", task_type: "local_bash", description: "Run the checks" }], session_id: session });
      send({ type: "system", subtype: "task_started", task_id: "bchecks", tool_use_id: "toolu_checks", description: "Run the checks", task_type: "local_bash", is_backgrounded: true, session_id: session });
      send({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_checks", content: "Command running in background with ID: bchecks" }] } });
      engine.answer(id, text, cost, { states });
    },
    /** A result for the input (or the CLI's own turn), closed the way the protocol closes it. */
    answer: (id: string | undefined, text: string, cost: number, { states = true } = {}) => {
      send({ type: "assistant", message: { content: [{ type: "text", text }] } });
      send({
        type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 500, total_cost_usd: cost, session_id: session, result: text,
        ...(attributed ? { uuid: `result-${++results}` } : {}),
        ...(attributed && id ? { user_message_uuid: id, user_message_uuids: [id] } : {}),
      });
      if (attributed && id) send({ type: "command_lifecycle", command_uuid: id, state: "completed" });
      if (states) engine.state("idle");
    },
    /** The background command ends; the CLI tells the agent, who says what came of it. */
    finishBackground: () => {
      send({ type: "system", subtype: "task_updated", task_id: "bchecks", patch: { status: "completed" }, session_id: session });
      send({ type: "system", subtype: "task_notification", task_id: "bchecks", tool_use_id: "toolu_checks", status: "completed", summary: "Checks passed", output_file: "/tmp/bchecks.out", session_id: session });
      send({ type: "system", subtype: "background_tasks_changed", tasks: [], session_id: session });
    },
    followUp: (text: string, cost: number, { states = true } = {}) => {
      if (states) engine.state("running");
      send({ type: "system", subtype: "init", session_id: session, model: "claude-sonnet-5" });
      if (attributed) send({ type: "system", subtype: "status", status: "requesting", uuid: "request-own" });
      engine.answer(undefined, text, cost, { states });
    },
  };
  return { instance, engine, send, flush, tick, ends, said, errors, timeline, spawned, attributed };
}

/** The engine was told to stop, and the turn was reported over only
 * after that: nothing of it runs beside the next turn. */
function stoppedFirst(timeline: string[]) {
  const stop = timeline.indexOf("SIGTERM");
  const over = timeline.indexOf("turn.completed");
  assert.ok(stop >= 0 && over > stop, `the process was not stopped before its turn was over: ${timeline.join(", ") || "nothing"}`);
}

for (const version of [LEGACY, ATTRIBUTED]) {
  test(`let it finish: the turn stays open until its background work is done and answered (${version})`, async (t) => {
    const f = await fixture(t, version);
    await f.engine.start("finish");
    assert.equal(f.spawned.env?.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS, "1", "the CLI was not asked to say when it is idle");
    const [first] = f.engine.inputs();
    f.engine.reply(first, "The checks are running in the background.", 1);
    await f.tick(10 * 60_000);
    assert.equal(f.ends().length, 0, "the turn ended while its background work ran");
    assert.equal(f.instance.adapter.hasSession!(THREAD), true, "the lane did not read as working");
    assert.deepEqual(f.timeline.filter((step) => step.startsWith("SIG")), [], "the background work was stopped");
    // a subagent's notes along the way are never the agent's reply
    f.send({ type: "assistant", parent_tool_use_id: "toolu_checks", message: { content: [{ type: "text", text: "SUBAGENT_NOTE retrying" }] } });
    f.engine.finishBackground();
    f.engine.followUp("All checks passed.", 3);
    await f.flush();
    assert.equal(f.ends().length, 1, "the turn did not end once the agent had answered");
    assert.equal(f.ends()[0].ok, true);
    assert.equal(f.ends()[0].cost, 3, "the turn is charged what its follow-up brought the session to");
    assert.deepEqual(f.said(), ["The checks are running in the background.", "All checks passed."]);
    stoppedFirst(f.timeline);
  });

  test(`stop when the reply is done: the turn ends at the reply and its background work is stopped (${version})`, async (t) => {
    const f = await fixture(t, version);
    await f.engine.start("stop");
    const [first] = f.engine.inputs();
    f.engine.reply(first, "The checks are running in the background.", 1);
    await f.flush();
    assert.equal(f.ends().length, 1, "the turn waited for its background work");
    assert.equal(f.ends()[0].ok, true);
    stoppedFirst(f.timeline);
    f.engine.finishBackground();
    f.engine.followUp("LATE_FOLLOW_UP", 3);
    await f.flush();
    assert.deepEqual(f.said(), ["The checks are running in the background."]);
  });

  test(`unset means let it finish (${version})`, async (t) => {
    const f = await fixture(t, version);
    await f.engine.start();
    f.engine.reply(f.engine.inputs()[0], "Started.", 1);
    await f.tick(60_000);
    assert.equal(f.ends().length, 0);
    f.engine.finishBackground();
    f.engine.followUp("Done.", 2);
    await f.flush();
    assert.equal(f.ends().length, 1);
  });

  test(`a background task gone silent while the turn waits is a stalled call (${version})`, async (t) => {
    const f = await fixture(t, version);
    await f.engine.start("finish", 60_000);
    f.engine.reply(f.engine.inputs()[0], "Started.", 1);
    await f.tick(59_000);
    assert.equal(f.ends().length, 0);
    await f.tick(16_000);
    assert.equal(f.ends().length, 1, "a silent background task held the lane past the stall limit");
    assert.equal(f.ends()[0].stopReason, "tool_stalled");
    assert.match(f.errors().join("\n"), /Bash in the background \(npm run checks\) made no progress/);
    stoppedFirst(f.timeline);
  });

  test(`a turn that started nothing in the background ends at its reply either way (${version})`, async (t) => {
    const f = await fixture(t, version);
    await f.engine.start("finish");
    const [first] = f.engine.inputs();
    f.engine.state("running");
    f.engine.answer(first, "Nothing to run.", 1);
    await f.flush();
    assert.equal(f.ends().length, 1);
    stoppedFirst(f.timeline);
  });

  test(`without the CLI saying when it is idle, the turn ends a moment after its background work and the answer (${version})`, async (t) => {
    const f = await fixture(t, version);
    await f.engine.start("finish");
    f.engine.reply(f.engine.inputs()[0], "Started.", 1, { states: false });
    await f.tick(30_000);
    assert.equal(f.ends().length, 0);
    f.engine.finishBackground();
    await f.tick(500);
    f.engine.followUp("Done.", 2, { states: false });
    await f.tick(1_900);
    assert.equal(f.ends().length, 0, "the turn ended before the CLI could have started on what the task found");
    await f.tick(400);
    assert.equal(f.ends().length, 1);
    assert.deepEqual(f.said(), ["Started.", "Done."]);
  });
}

test("words sent while a turn waits on its background work go into it, and it waits for their answer too", async (t) => {
  const f = await fixture(t, ATTRIBUTED);
  await f.engine.start("finish");
  const [first] = f.engine.inputs();
  f.engine.reply(first, "Started.", 1);
  await f.tick(5_000);
  assert.equal(await f.instance.adapter.steerTurn!(THREAD, "and tell me how long they take"), true);
  const steer = f.engine.inputs().at(-1);
  f.engine.state("running");
  f.send({ type: "system", subtype: "status", status: "requesting", uuid: "request-steer", user_message_uuids: [steer] });
  f.engine.answer(steer, "I will.", 2);
  await f.tick(5_000);
  assert.equal(f.ends().length, 0, "the answer to the words ended the turn while its background work still ran");
  f.engine.finishBackground();
  f.engine.followUp("They took four minutes.", 4);
  await f.flush();
  assert.equal(f.ends().length, 1);
  assert.equal(f.ends()[0].cost, 4);
  assert.deepEqual(f.said(), ["Started.", "I will.", "They took four minutes."]);
});

test("on a CLI that shuts input at the first result, words sent while it waits wait for the next turn", async (t) => {
  const f = await fixture(t, LEGACY);
  await f.engine.start("finish");
  f.engine.reply(undefined, "Started.", 1);
  await f.flush();
  assert.ok(f.timeline.includes("stdin closed"));
  assert.equal(await f.instance.adapter.steerTurn!(THREAD, "and tell me how long they take"), false);
  f.engine.finishBackground();
  f.engine.followUp("Done.", 2);
  await f.flush();
  assert.equal(f.ends().length, 1);
});
