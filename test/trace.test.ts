// A turn's events, as a waterfall (server/trace.ts).
//
// The trace is derived, never reported: tools pair by item, waits by
// request, and the model's work is whatever no tool or wait covers. These
// pin each of those rules, the two ways engines count tokens, and the
// ceiling that keeps a giant turn from becoming a giant answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RuntimeEvent } from "../server/contracts.ts";
import { MAX_SPANS, MIN_MODEL_MS, LaneTurns, buildTrace, emptyTrace, readTurn, slim } from "../server/trace.ts";

const T0 = Date.parse("2026-10-26T10:00:00.000Z");

/** A turn's events, each at a millisecond offset from T0. */
function turn(provider: string, steps: Array<[number, Record<string, unknown>]>, turnId = "turn-1"): RuntimeEvent[] {
  return steps.map(([at, rest], i) => ({
    eventId: `ev-${i}`,
    provider,
    threadId: "lane-1",
    turnId,
    createdAt: new Date(T0 + at).toISOString(),
    ...rest,
  })) as RuntimeEvent[];
}

const started = (itemId: string, title: string, more: Record<string, unknown> = {}) => ({ type: "item.started", itemType: "tool", itemId, title, ...more });
const done = (itemId: string, ok = true) => ({ type: "item.completed", itemType: "tool", itemId, ok });
const text = { type: "content.delta", streamKind: "assistant_text", delta: "Here it is" };
const thought = { type: "content.delta", streamKind: "reasoning_text", delta: "hmm" };
const usage = (input: number, output: number) => ({ type: "thread.token-usage.updated", input, output });
const end = (more: Record<string, unknown> = {}) => ({ type: "turn.completed", ok: true, stopReason: null, ...more });

const span = (trace: ReturnType<typeof buildTrace>, id: string) => {
  const found = trace.spans.find((s) => s.id === id);
  assert.ok(found, `no span ${id} in ${trace.spans.map((s) => s.id).join(", ")}`);
  return found;
};

test("tools pair by item: name, detail, start and end, failure", () => {
  const trace = buildTrace(
    turn("claudeAgent", [
      [0, { type: "turn.started" }],
      [1_000, started("a", "Bash", { command: "npm test\nand the rest" })],
      [1_000, started("b", "Edit", { paths: ["src/app.ts", "src/other.ts"] })],
      [3_000, done("b", false)],
      [4_000, done("a")],
      [5_000, end()],
    ]),
    { now: T0 + 60_000 },
  );
  assert.equal(trace.turnId, "turn-1");
  assert.equal(trace.startedAt, T0);
  assert.equal(trace.endedAt, T0 + 5_000);
  assert.equal(trace.running, false);
  assert.equal(trace.engine, "claudeAgent");
  const root = trace.spans[0];
  assert.deepEqual([root.id, root.parentId, root.kind, root.status, root.start, root.end], ["turn", null, "turn", "ok", 0, 5_000]);
  const bash = span(trace, "tool:a");
  assert.deepEqual(
    { kind: bash.kind, status: bash.status, name: bash.name, detail: bash.detail, start: bash.start, end: bash.end, parentId: bash.parentId },
    { kind: "tool", status: "ok", name: "Bash", detail: "npm test", start: 1_000, end: 4_000, parentId: "turn" },
  );
  const edit = span(trace, "tool:b");
  assert.equal(edit.status, "failed");
  assert.equal(edit.detail, "src/app.ts", "the first path is the detail");
  assert.equal(trace.totals.toolCalls, 2);
  assert.equal(trace.totals.errors, 1, "a failed call is an error");
  assert.equal(trace.totals.durationMs, 5_000);
});

test("an orphan completion and a repeated start change nothing", () => {
  const trace = buildTrace(
    turn("codex", [
      [0, { type: "turn.started" }],
      [500, started("a", "shell")],
      [600, started("a", "shell")],
      [700, done("ghost")],
      [900, done("a")],
      [1_000, end()],
    ]),
    { now: T0 + 2_000 },
  );
  assert.equal(trace.spans.filter((s) => s.kind === "tool").length, 1);
  assert.equal(span(trace, "tool:a").end, 900);
});

test("while the turn runs, an open tool is running with no end; once it ends, the tool is stopped at the turn's end", () => {
  const steps: Array<[number, Record<string, unknown>]> = [
    [0, { type: "turn.started" }],
    [1_000, started("a", "Bash", { command: "sleep 100" })],
  ];
  const live = buildTrace(turn("claudeAgent", steps), { now: T0 + 7_000 });
  assert.equal(live.running, true);
  assert.equal(live.endedAt, null);
  assert.equal(live.spans[0].status, "running");
  assert.equal(live.spans[0].end, null);
  assert.deepEqual([span(live, "tool:a").status, span(live, "tool:a").end], ["running", null]);
  assert.equal(live.totals.durationMs, 7_000, "a running turn's duration runs to now");
  assert.equal(live.totals.cost, null);

  const over = buildTrace(turn("claudeAgent", [...steps, [9_000, end({ ok: false, stopReason: "interrupted" })]]), { now: T0 + 60_000 });
  assert.deepEqual([span(over, "tool:a").status, span(over, "tool:a").end], ["stopped", 9_000]);
  assert.equal(over.spans[0].status, "stopped", "an interrupted turn is stopped, not failed");
  const failed = buildTrace(turn("claudeAgent", [...steps, [9_000, end({ ok: false, stopReason: "error" })]]), { now: T0 });
  assert.equal(failed.spans[0].status, "failed");
});

test("a Claude Task or Agent call is an agent span; the same name elsewhere is a tool", () => {
  const steps: Array<[number, Record<string, unknown>]> = [
    [0, { type: "turn.started" }],
    [200, started("t", "Task")],
    [300, started("g", "Agent")],
    [4_000, done("t")],
    [4_100, done("g")],
    [5_000, end()],
  ];
  const claude = buildTrace(turn("claudeAgent", steps), { now: T0 });
  assert.equal(span(claude, "tool:t").kind, "agent");
  assert.equal(span(claude, "tool:g").kind, "agent");
  assert.equal(claude.totals.toolCalls, 2, "an agent call is still a tool call");
  assert.equal(span(buildTrace(turn("opencode", steps), { now: T0 }), "tool:t").kind, "tool");
});

test("waits pair by request, carry the summary, and an async question is no wait", () => {
  const trace = buildTrace(
    turn("claudeAgent", [
      [0, { type: "turn.started" }],
      [1_000, started("a", "Bash", { command: "rm -rf build" })],
      [1_000, { type: "request.opened", requestId: "r1", requestType: "permission", tool: "Bash", summary: "Run rm -rf build?\nmore" }],
      [6_000, { type: "request.resolved", requestId: "r1", behavior: "allow", source: "user" }],
      [6_500, done("a")],
      [7_000, { type: "request.opened", requestId: "r2", requestType: "question", tool: "ask", summary: "Later?", async: true }],
      [7_500, { type: "request.opened", requestId: "r3", requestType: "question", tool: "ask", summary: "Which one?" }],
      [9_000, end()],
    ]),
    { now: T0 },
  );
  const wait = span(trace, "wait:r1");
  assert.deepEqual(
    { kind: wait.kind, name: wait.name, detail: wait.detail, status: wait.status, start: wait.start, end: wait.end },
    { kind: "wait", name: "Waiting for you", detail: "Run rm -rf build?", status: "ok", start: 1_000, end: 6_000 },
  );
  assert.ok(!trace.spans.some((s) => s.id === "wait:r2"), "an async question waits on nobody");
  assert.deepEqual([span(trace, "wait:r3").status, span(trace, "wait:r3").end], ["stopped", 9_000]);
  assert.equal(trace.totals.waits, 2);

  const live = buildTrace(
    turn("codex", [
      [0, { type: "turn.started" }],
      [1_000, { type: "request.opened", requestId: "r1", requestType: "permission", tool: "shell", summary: "Allow?" }],
    ]),
    { now: T0 + 5_000 },
  );
  assert.deepEqual([span(live, "wait:r1").status, span(live, "wait:r1").end], ["running", null]);
});

test("the model's stretches are what tools and waits leave: Writing, Thinking or Model, and too short is not drawn", () => {
  const trace = buildTrace(
    turn("codex", [
      [0, { type: "turn.started" }],
      [400, thought],
      [2_000, started("a", "shell")],
      [3_000, done("a")],
      [3_100, started("b", "shell")],
      [4_000, done("b")],
      [4_500, thought],
      [5_000, text],
      [6_000, started("c", "shell")],
      [6_000, started("d", "shell")],
      [7_000, done("c")],
      [8_000, done("d")],
      [10_000, end()],
    ]),
    { now: T0 },
  );
  const models = trace.spans.filter((s) => s.kind === "model");
  assert.deepEqual(
    models.map((s) => [s.name, s.start, s.end, s.status]),
    [
      ["Thinking", 0, 2_000, "ok"],
      ["Writing", 4_000, 6_000, "ok"],
      ["Model", 8_000, 10_000, "ok"],
    ],
    "the 100 ms between a and b is not drawn, and overlapping c and d leave no gap",
  );
  assert.ok(3_100 - 3_000 < MIN_MODEL_MS);
  assert.equal(trace.totals.modelCalls, 3, "outside Claude, model calls are the stretches drawn");
  assert.ok(models.every((s) => s.parentId === "turn"));

  // a stretch still going is running with no end, once it is long enough to see
  const live = (now: number) =>
    buildTrace(
      turn("codex", [
        [0, { type: "turn.started" }],
        [100, started("a", "shell")],
        [1_000, done("a")],
        [1_050, text],
      ]),
      { now: T0 + now },
    ).spans.filter((s) => s.kind === "model");
  assert.deepEqual(live(1_100).map((s) => s.start), [], "50 ms of writing is not yet a span");
  assert.deepEqual(live(3_000).map((s) => [s.name, s.start, s.end, s.status]), [["Writing", 1_000, null, "running"]]);
});

test("a Claude message's text in the same instant as its calls still names the stretch that wrote it", () => {
  const trace = buildTrace(
    turn("claudeAgent", [
      [0, { type: "turn.started" }],
      [3_000, text],
      [3_000, { type: "item.completed", itemType: "assistant_text", text: "Looking" }],
      [3_000, started("a", "Read", { paths: ["a.md"] })],
      [3_000, usage(1_000, 50)],
      [4_000, done("a")],
      [6_000, usage(1_200, 80)],
      [6_000, end({ cost: 0.02 })],
    ]),
    { now: T0 },
  );
  const models = trace.spans.filter((s) => s.kind === "model");
  assert.deepEqual(models.map((s) => [s.name, s.start, s.end, s.tokens]), [
    ["Writing", 0, 3_000, 1_050],
    ["Model", 4_000, 6_000, 1_280],
  ]);
});

test("retry: the same signature again after a failure, and not after a success", () => {
  const trace = buildTrace(
    turn("claudeAgent", [
      [0, { type: "turn.started" }],
      [100, started("a", "Bash", { signature: "sig-1" })],
      [500, done("a", false)],
      [1_000, started("b", "Bash", { signature: "sig-1" })],
      [1_500, done("b")],
      [2_000, started("c", "Bash", { signature: "sig-2" })],
      [2_500, done("c")],
      [3_000, started("d", "Bash", { signature: "sig-2" })],
      [3_500, done("d")],
      [4_000, started("e", "Bash")],
      [4_500, end()],
    ]),
    { now: T0 },
  );
  assert.equal(span(trace, "tool:a").retry, undefined);
  assert.equal(span(trace, "tool:b").retry, true);
  assert.equal(span(trace, "tool:d").retry, undefined, "repeating a call that worked is not a retry");
  assert.equal(span(trace, "tool:e").retry, undefined);
});

test("an engine error is a zero-length error span, a compaction a marker", () => {
  const trace = buildTrace(
    turn("claudeAgent", [
      [0, { type: "turn.started" }],
      [1_000, { type: "context.compacted", trigger: "auto", before: 180_000, after: null }],
      [2_000, { type: "runtime.error", message: "usage limit reached\nresets 3pm" }],
      [2_100, end({ ok: false, stopReason: "usage limit reached" })],
    ]),
    { now: T0 },
  );
  const error = trace.spans.find((s) => s.kind === "error")!;
  assert.deepEqual([error.status, error.start, error.end, error.detail], ["failed", 2_000, 2_000, "usage limit reached"]);
  const compact = trace.spans.find((s) => s.kind === "compact")!;
  assert.deepEqual([compact.start, compact.end, compact.detail], [1_000, 1_000, "auto"]);
  assert.equal(trace.totals.errors, 1);
  assert.equal(trace.spans[0].status, "failed");
});

test("a Codex web search, which never completes, is done when the turn says anything else", () => {
  const steps: Array<[number, Record<string, unknown>]> = [
    [0, { type: "turn.started" }],
    [500, started("w", "web_search")],
  ];
  const live = buildTrace(turn("codex", steps), { now: T0 + 3_000 });
  assert.equal(span(live, "tool:w").status, "running");
  const after = buildTrace(turn("codex", [...steps, [2_500, text], [4_000, end()]]), { now: T0 });
  assert.deepEqual([span(after, "tool:w").status, span(after, "tool:w").end], ["ok", 2_500]);
  assert.deepEqual(after.spans.filter((s) => s.kind === "model").map((s) => [s.name, s.start, s.end]), [
    ["Model", 0, 500],
    ["Writing", 2_500, 4_000],
  ]);
});

test("tokens and model calls: Claude sums its per-message reports, the rest keep the highest running total", () => {
  const steps: Array<[number, Record<string, unknown>]> = [
    [0, { type: "turn.started" }],
    [1_000, usage(1_000, 100)],
    [1_000, started("a", "x")],
    [2_000, done("a")],
    [3_000, usage(2_000, 300)],
    [3_000, end()],
  ];
  const claude = buildTrace(turn("claudeAgent", steps), { now: T0 });
  assert.equal(claude.totals.tokens, 3_400);
  assert.equal(claude.totals.modelCalls, 2, "one per message reported");
  assert.equal(claude.spans[0].tokens, 3_400);
  for (const engine of ["codex", "openai", "geminiCli", "antigravity"]) {
    const other = buildTrace(turn(engine, steps), { now: T0 });
    assert.equal(other.totals.tokens, 2_300, `${engine} restates the turn's total`);
    assert.equal(other.totals.modelCalls, 2, `${engine} counts the stretches drawn`);
    assert.ok(other.spans.filter((s) => s.kind === "model").every((s) => s.tokens === undefined), "a running total is not split across stretches");
  }
  const silent = buildTrace(turn("acp", [[0, { type: "turn.started" }], [500, end()]]), { now: T0 });
  assert.equal(silent.totals.tokens, null, "no report is unknown, not zero");
});

test("cost: the engine's own, else the harness's estimate, else none; never while running", () => {
  const priced = buildTrace(turn("claudeAgent", [[0, { type: "turn.started" }], [100, end({ cost: 0.12 })]]), { now: T0, price: () => 99 });
  assert.equal(priced.totals.cost, 0.12);
  assert.equal(priced.spans[0].cost, 0.12);
  const unpriced = { model: "gpt-9", input: 10, output: 5, cachedInput: 0 };
  const asked: unknown[] = [];
  const estimated = buildTrace(turn("openai", [[0, { type: "turn.started" }], [100, end({ cost: null, unpriced })]]), {
    now: T0,
    price: (completed) => (asked.push(completed.unpriced), 0.5),
  });
  assert.equal(estimated.totals.cost, 0.5);
  assert.deepEqual(asked, [unpriced]);
  assert.equal(estimated.model, "gpt-9", "the model is read off the unpriced usage when nothing else names it");
  assert.equal(buildTrace(turn("codex", [[0, { type: "turn.started" }], [100, end({ cost: null })]]), { now: T0 }).totals.cost, null);
  const running = buildTrace(turn("claudeAgent", [[0, { type: "turn.started" }]]), { now: T0 + 10, price: () => 1 });
  assert.equal(running.totals.cost, null);
});

test("the model comes from the session, events after the turn's end are not its own, and times never run backwards", () => {
  const trace = buildTrace(
    turn("claudeAgent", [
      [-50, { type: "session.started", sessionId: "s", model: "claude-opus-5" }],
      [0, { type: "turn.started" }],
      [2_000, started("a", "Bash")],
      [1_500, done("a")],
      [3_000, end()],
      [4_000, started("late", "Bash")],
    ]),
    { now: T0 },
  );
  assert.equal(trace.model, "claude-opus-5");
  assert.equal(span(trace, "tool:a").end, 2_000, "a completion stamped before its start ends where it started");
  assert.ok(!trace.spans.some((s) => s.id === "tool:late"));
});

test("spans are ordered by start, then id, with the turn first", () => {
  const trace = buildTrace(
    turn("codex", [
      [0, { type: "turn.started" }],
      [0, started("z", "shell")],
      [0, started("b", "shell")],
      [100, done("z")],
      [100, done("b")],
      [500, end()],
    ]),
    { now: T0 },
  );
  assert.deepEqual(trace.spans.map((s) => s.id), ["turn", "tool:b", "tool:z", "model:1"]);
});

test("past the ceiling the oldest finished spans fold away, running ones stay, and the totals count everything", () => {
  const steps: Array<[number, Record<string, unknown>]> = [[0, { type: "turn.started" }]];
  const calls = MAX_SPANS + 500;
  for (let i = 0; i < calls; i++) {
    steps.push([i * 10, started(`c${i}`, "shell")], [i * 10 + 5, done(`c${i}`, i % 100 !== 0)]);
  }
  steps.push([calls * 10, started("open", "shell")]);
  const trace = buildTrace(turn("codex", steps), { now: T0 + calls * 10 + 1_000 });
  assert.equal(trace.spans.length, MAX_SPANS);
  assert.equal(trace.spans[0].id, "turn");
  assert.ok(trace.spans.some((s) => s.id === "tool:open" && s.status === "running"), "the running call is never folded");
  assert.ok(!trace.spans.some((s) => s.id === "tool:c0"), "the oldest went first");
  assert.ok(trace.spans.some((s) => s.id === `tool:c${calls - 1}`), "the newest stayed");
  assert.equal(trace.totals.toolCalls, calls + 1);
  assert.equal(trace.totals.errors, Math.ceil(calls / 100));
  assert.ok(JSON.stringify(trace).length < 400_000, "a giant turn is still a small answer");
});

test("no events at all, and the empty trace a lane gets before its engine speaks", () => {
  const none = buildTrace([], { now: T0 });
  assert.equal(none.turnId, null);
  assert.equal(none.running, true);
  assert.deepEqual(none.spans.map((s) => s.id), ["turn"]);
  const empty = emptyTrace(T0, true, T0 + 4_000);
  assert.deepEqual([empty.running, empty.endedAt, empty.totals.durationMs, empty.spans[0].status], [true, null, 4_000, "running"]);
});

test("slimming keeps what a trace reads and nothing it does not", () => {
  const [delta, ask, tool, raw] = turn("claudeAgent", [
    [0, { type: "content.delta", streamKind: "assistant_text", delta: "a secret plan", raw: { source: "x", payload: { big: true } } }],
    [0, { type: "request.opened", requestId: "r", requestType: "permission", tool: "Bash", summary: "Run it?", input: { command: "cat key" }, choices: ["a"] }],
    [0, started("a", "Bash", { command: "echo one\necho two", paths: ["a", "b"], mayWrite: true, signature: "s" })],
    [0, { type: "commands.updated", cwd: null, catalog: {} }],
  ]);
  assert.equal((slim(delta) as any).delta, "");
  assert.equal((slim(delta) as any).raw, undefined);
  assert.deepEqual([(slim(ask) as any).input, (slim(ask) as any).choices, (slim(ask) as any).summary], [undefined, undefined, "Run it?"]);
  assert.deepEqual([(slim(tool) as any).command, (slim(tool) as any).paths, (slim(tool) as any).signature], ["echo one", ["a"], "s"]);
  assert.equal(slim(raw), null);
});

test("the turn log keeps each lane's running turn and the last one, bounded", () => {
  const log = new LaneTurns({ events: 50, lanes: 2 });
  const first = turn("codex", [[0, { type: "turn.started" }], [10, text], [11, text], [12, text], [20, end()]], "t1");
  for (const event of first) log.note(event);
  assert.equal(log.current("lane-1"), null);
  assert.equal(log.last("lane-1")!.length, 3, "a run of text is kept as its first piece");
  const second = turn("codex", [[100, { type: "turn.started" }], [110, started("a", "shell")]], "t2");
  for (const event of second) log.note(event);
  // a late word from the first turn is not the second's
  log.note(turn("codex", [[120, done("x")]], "t1")[0]);
  assert.equal(log.current("lane-1")!.length, 2);
  assert.equal(log.find("lane-1", "t1")!.at(-1)!.type, "turn.completed");
  assert.equal(log.find("lane-1", "t2")!.length, 2);
  assert.equal(log.find("lane-1", "t3"), null);
  // bounded per turn
  for (let i = 0; i < 200; i++) log.note(turn("codex", [[200 + i, started(`c${i}`, "shell")]], "t2")[0]);
  assert.ok(log.current("lane-1")!.length <= 50);
  assert.equal(log.current("lane-1")![0].type, "turn.started", "the start is never the one let go");
  // bounded in lanes: an idle lane goes before a busy one
  const lane = (id: string, events: RuntimeEvent[]) => events.map((e) => ({ ...e, threadId: id }));
  for (const e of lane("lane-2", turn("codex", [[0, { type: "turn.started" }], [5, end()]], "u"))) log.note(e);
  for (const e of lane("lane-3", turn("codex", [[0, { type: "turn.started" }]], "v"))) log.note(e);
  assert.ok(log.current("lane-1"), "the busy lane stayed");
  assert.equal(log.last("lane-2"), null, "the idle lane was let go");
  log.forget("lane-1");
  assert.equal(log.current("lane-1"), null);
});

test("an events file is read back by turn, or for its last turn, from its end and within a bound", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-trace-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "lane-1.ndjson");
  const lines: RuntimeEvent[] = [
    ...turn("codex", [[0, { type: "turn.started" }], [100, started("a", "shell")], [200, done("a")], [300, end()]], "t1"),
    ...turn("codex", [[1_000, { type: "turn.started" }], [1_100, started("b", "shell", { command: "ls" })], [1_200, done("b")], [1_300, end()]], "t2"),
    ...turn("codex", [[2_000, { type: "turn.started" }], [2_100, started("c", "shell")]], "t3"),
  ];
  writeFileSync(file, lines.map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n");

  const t2 = await readTurn(file, "t2");
  assert.deepEqual(t2!.map((e) => e.type), ["turn.started", "item.started", "item.completed", "turn.completed"]);
  assert.equal(buildTrace(t2!, { now: T0 }).spans.find((s) => s.id === "tool:b")!.detail, "ls");
  const latest = await readTurn(file, null);
  assert.equal(latest![0].turnId, "t3", "the last turn there, still open");
  assert.equal(await readTurn(file, "nope"), null);
  assert.equal(await readTurn(join(dir, "missing.ndjson"), null), null);

  // only the end is read: the first turn is past a small bound
  const tail = Buffer.byteLength(lines.slice(4).map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n");
  assert.equal(await readTurn(file, "t1", { bytes: tail }), null);
  assert.equal((await readTurn(file, "t2", { bytes: tail }))![0].type, "turn.started", "a read starting on a line's first byte keeps that line");
  assert.equal((await readTurn(file, "t2", { bytes: tail - 1 }))![0].type, "item.started", "one byte later, it is a fragment and goes");
});
