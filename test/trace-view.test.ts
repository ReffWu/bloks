// The trace waterfall's arithmetic (src/lib/traceView.ts): how numbers
// read, where the ruler puts its ticks as a turn grows, which rows show,
// what a parent's bar is made of, the slowest step, several agents on
// one clock, and the made-up traces the demo draws.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  alignGroups,
  askForFold,
  barKind,
  barNote,
  childrenOf,
  clockOffset,
  currentStep,
  fixtureLive,
  fixtureScript,
  fixtureTrace,
  flattenRows,
  formatCost,
  formatDuration,
  formatTokens,
  groupsElapsed,
  markersOf,
  rulerTicks,
  ROOT,
  rowKey,
  segmentsOf,
  slowestLeaf,
  spanDuration,
  spanEnd,
  sumTotals,
  tickLabel,
  tickStep,
  ticksForWidth,
  timelineDomain,
  totalsOf,
  traceClockOffset,
  traceCovers,
  traceElapsed,
  MIN_DOMAIN_MS,
  type TraceGroup,
} from "../src/lib/traceView.ts";
import { taskTracePath, type Trace, type TraceSpan } from "../src/lib/trace.ts";

const T0 = Date.UTC(2026, 9, 26, 9, 0, 0);

function span(id: string, over: Partial<TraceSpan> = {}): TraceSpan {
  return { id, parentId: "turn", kind: "tool", status: "ok", name: id, start: 0, end: 1000, ...over };
}

function trace(spans: TraceSpan[], over: Partial<Trace> = {}): Trace {
  const all = [{ id: "turn", parentId: null, kind: "turn", status: "ok", name: "Turn", start: 0, end: 10_000 } as TraceSpan, ...spans];
  return {
    turnId: "t1",
    startedAt: T0,
    endedAt: T0 + 10_000,
    running: false,
    spans: all,
    totals: totalsOf(all, 10_000),
    ...over,
  };
}

describe("how numbers read", () => {
  test("durations: tenths under ten seconds, then seconds, minutes, hours", () => {
    assert.equal(formatDuration(0), "0.0s");
    assert.equal(formatDuration(840), "0.8s");
    assert.equal(formatDuration(9_990), "9.9s", "a running step never shows a second it has not reached");
    assert.equal(formatDuration(10_000), "10s");
    assert.equal(formatDuration(12_400), "12s");
    assert.equal(formatDuration(130_000), "2m 10s");
    assert.equal(formatDuration(120_000), "2m");
    assert.equal(formatDuration(3_900_000), "1h 5m");
    assert.equal(formatDuration(-5), "0.0s");
  });

  test("cost: three places under a cent, two above, nothing for an unpriced turn", () => {
    assert.equal(formatCost(0.005), "$0.005");
    assert.equal(formatCost(0.42), "$0.42");
    assert.equal(formatCost(12.5), "$12.50");
    assert.equal(formatCost(0.0002), "<$0.001");
    assert.equal(formatCost(0), "$0");
    assert.equal(formatCost(null), null);
    assert.equal(formatCost(undefined), null);
  });

  test("tokens: whole under a thousand, then k and M", () => {
    assert.equal(formatTokens(950), "950");
    assert.equal(formatTokens(12_400), "12.4k");
    assert.equal(formatTokens(12_499), "12.4k");
    assert.equal(formatTokens(124_000), "124k");
    assert.equal(formatTokens(1_200_000), "1.2M");
    assert.equal(formatTokens(null), null);
  });

  test("the note after a bar names the cost only when there is one", () => {
    assert.equal(barNote(3600, 0.12), "3.6s · $0.12");
    assert.equal(barNote(3600, null), "3.6s");
    assert.equal(barNote(3600, 0), "3.6s");
  });
});

describe("the ruler", () => {
  test("picks a round step for any span, five marks at most", () => {
    assert.equal(tickStep(9_000, 5), 2_000);
    assert.equal(tickStep(15_000, 5), 5_000);
    assert.equal(tickStep(46_000, 5), 10_000);
    assert.equal(tickStep(66_000, 5), 15_000);
    assert.equal(tickStep(86_000, 5), 20_000);
    assert.equal(tickStep(130_000, 5), 30_000);
    assert.equal(tickStep(4 * 60_000, 5), 60_000);
    assert.equal(tickStep(9 * 60_000, 5), 2 * 60_000);
    assert.equal(tickStep(40 * 60_000, 5), 10 * 60_000);
    assert.equal(tickStep(3 * 3_600_000, 5), 3_600_000);
  });

  test("a narrower track takes fewer marks, a wider one more", () => {
    assert.equal(ticksForWidth(160), 3);
    assert.equal(ticksForWidth(300), 5);
    assert.equal(ticksForWidth(5000), 9);
    assert.ok(tickStep(30_000, ticksForWidth(160)) > tickStep(30_000, ticksForWidth(600)));
  });

  test("ticks are keyed by their time, so the ones a new step keeps stay put", () => {
    const before = rulerTicks(14_000, 5);
    const after = rulerTicks(16_000, 5);
    assert.deepEqual(
      before.ticks.map((t) => t.at),
      [0, 5_000, 10_000],
    );
    assert.deepEqual(
      after.ticks.map((t) => t.at),
      [0, 5_000, 10_000, 15_000],
    );
    const coarser = rulerTicks(46_000, 5).ticks.map((t) => t.at);
    // 0, 10 and 20 were there under the 5s step and are the same ticks now
    for (const at of [0, 10_000, 20_000]) assert.ok(coarser.includes(at));
  });

  test("labels read like a clock", () => {
    assert.equal(tickLabel(0), "0s");
    assert.equal(tickLabel(45_000), "45s");
    assert.equal(tickLabel(90_000), "1m 30s");
    assert.equal(tickLabel(120_000), "2m");
    assert.equal(tickLabel(4_500_000), "1h 15m");
  });

  test("a live turn keeps now two thirds across; a finished one fills more; never under the minimum", () => {
    assert.equal(timelineDomain(1_000, true), MIN_DOMAIN_MS);
    assert.ok(Math.abs(timelineDomain(33_000, true) - 50_000) < 1);
    assert.ok(timelineDomain(40_000, false) < timelineDomain(40_000, true));
    assert.equal(timelineDomain(40_000, false), 50_000);
  });
});

describe("the clock", () => {
  test("a running span reaches now; a finished one keeps its end", () => {
    const running = span("a", { start: 2_000, end: null, status: "running" });
    assert.equal(spanEnd(running, 5_000), 5_000);
    assert.equal(spanDuration(running, 5_000), 3_000);
    assert.equal(spanEnd(running, 1_000), 2_000, "never before it began");
    assert.equal(spanEnd(span("b", { start: 0, end: 800 }), 5_000), 800);
  });

  test("a trace runs to now while it runs, and to its end after", () => {
    const live = trace([], { running: true, endedAt: null });
    assert.equal(traceElapsed(live, T0 + 12_000), 12_000);
    const done = trace([]);
    assert.equal(traceElapsed(done, T0 + 99_000), 10_000);
  });

  test("the server's clock is lined up from its now, or from a running trace's duration", () => {
    assert.equal(clockOffset(5_000, 4_000), 1_000);
    const live = trace([], { running: true, endedAt: null, totals: { ...totalsOf([], 7_000) } });
    assert.equal(traceClockOffset(live, T0 + 6_500), 500);
    assert.equal(traceClockOffset(trace([]), T0), 0);
    assert.equal(traceClockOffset(null, T0), 0);
  });
});

describe("several agents on one clock", () => {
  const a: TraceGroup = { id: "a", name: "A", color: "blue", trace: trace([], { startedAt: T0 + 4_000, running: true, endedAt: null }) };
  const b: TraceGroup = { id: "b", name: "B", color: "red", trace: trace([], { startedAt: T0, endedAt: T0 + 10_000 }) };

  test("each is placed by how long after the first one it began", () => {
    const { origin, offsets } = alignGroups([a, b]);
    assert.equal(origin, T0);
    assert.deepEqual(offsets, { a: 4_000, b: 0 });
    assert.deepEqual(alignGroups([]), { origin: 0, offsets: {} });
  });

  test("the shared timeline runs to now while any of them runs", () => {
    assert.equal(groupsElapsed([a, b], T0 + 20_000), 20_000);
    assert.equal(groupsElapsed([b], T0 + 20_000), 10_000);
  });

  test("totals add up, and a cost nobody gave stays unknown", () => {
    const priced = trace([span("x", { kind: "model", tokens: 1_000, cost: 0.01 })]);
    const unpriced = trace([span("y", { kind: "model", tokens: 500 })]);
    const sum = sumTotals(
      [
        { id: "p", trace: priced },
        { id: "u", trace: unpriced },
      ],
      T0 + 10_000,
    );
    assert.equal(sum.tokens, 1_500);
    assert.equal(sum.cost, 0.01);
    assert.equal(sum.modelCalls, 2);
    assert.equal(sumTotals([{ id: "u", trace: unpriced }], T0).cost, null);
  });
});

describe("rows", () => {
  const spans = [
    span("think", { kind: "model", name: "Thinking", start: 0, end: 900 }),
    span("task", { kind: "agent", name: "Task", start: 900, end: 6_000 }),
    span("inner", { parentId: "task", name: "Read", start: 1_000, end: 2_000 }),
    span("bash", { start: 6_000, end: 8_000, status: "failed" }),
    span("orphan", { parentId: "gone", start: 8_000, end: 8_500 }),
  ];
  const groups = [{ id: "g", trace: trace(spans) }];

  test("a row for the agent, then its steps in the order they began, nested", () => {
    const rows = flattenRows(groups, new Set());
    assert.deepEqual(
      rows.map((r) => [r.key, r.depth]),
      [
        ["g", 0],
        ["g:think", 1],
        ["g:task", 1],
        ["g:inner", 2],
        ["g:bash", 1],
        ["g:orphan", 1],
      ],
    );
    assert.equal(rows[0].span, null);
    assert.equal(rows[0].hasChildren, true);
    assert.equal(rows[2].hasChildren, true);
    assert.equal(rows[3].parentKey, "g:task");
  });

  test("a step whose parent was not sent still shows, under the turn", () => {
    assert.ok(childrenOf(spans.concat()).get(ROOT)!.some((s) => s.id === "orphan"));
  });

  test("folding a row hides what is under it, and folding the agent hides all of it", () => {
    const folded = flattenRows(groups, new Set([rowKey("g", "task")]));
    assert.ok(!folded.some((r) => r.key === "g:inner"));
    assert.equal(folded.find((r) => r.key === "g:task")?.collapsed, true);
    assert.deepEqual(
      flattenRows(groups, new Set(["g"])).map((r) => r.key),
      ["g"],
    );
  });
});

describe("bars", () => {
  test("a parent's bar is its children's pieces, by kind", () => {
    const kids = [
      span("m", { kind: "model", start: 0, end: 500 }),
      span("t", { kind: "tool", start: 500, end: 900 }),
      span("w", { kind: "wait", start: 900, end: 2_000 }),
      span("f", { kind: "tool", start: 2_000, end: 2_400, status: "failed" }),
      span("e", { kind: "error", start: 2_400, end: 2_400, status: "failed" }),
      span("r", { kind: "tool", start: 2_600, end: null, status: "running", retry: true }),
    ];
    assert.deepEqual(
      segmentsOf(kids).map((s) => [s.id, s.kind, s.end]),
      [
        ["m", "model", 500],
        ["t", "tool", 900],
        ["w", "wait", 2_000],
        ["f", "failed", 2_400],
        ["r", "retry", null],
      ],
    );
    assert.deepEqual(markersOf(kids), [{ id: "e", at: 2_400, kind: "error" }]);
  });

  test("a turn with nothing in it yet is one piece of model time", () => {
    assert.deepEqual(segmentsOf([], { start: 0, end: null }), [{ id: "turn", start: 0, end: null, kind: "model" }]);
    assert.deepEqual(segmentsOf([]), []);
  });

  test("a failure is red whatever it was; a stopped step is faded", () => {
    assert.equal(barKind({ kind: "agent", status: "failed" }), "failed");
    assert.equal(barKind({ kind: "tool", status: "stopped" }), "stopped");
    assert.equal(barKind({ kind: "agent", status: "ok" }), "agent");
    assert.equal(barKind({ kind: "model", status: "ok", retry: true }), "retry");
  });

  test("the slowest step is the longest leaf, live ones measured to now, waits left out", () => {
    const groups = [
      {
        id: "g",
        trace: trace(
          [
            span("short", { start: 0, end: 1_000 }),
            span("wait", { kind: "wait", start: 1_000, end: 9_000 }),
            span("long", { start: 1_000, end: 4_000 }),
            span("live", { start: 4_000, end: null, status: "running" }),
          ],
          // measured by the server at its start, so now decides
          { running: true, endedAt: null, totals: totalsOf([], 0) },
        ),
      },
    ];
    assert.deepEqual(slowestLeaf(groups, T0 + 6_000), { key: "g:long", ms: 3_000 });
    // the running one passes it, and the pill moves
    assert.deepEqual(slowestLeaf(groups, T0 + 9_000), { key: "g:live", ms: 5_000 });
    assert.equal(slowestLeaf([], T0), null);
  });

  test("what an agent is doing now is its newest running step", () => {
    const t = trace([span("a", { start: 0, end: 1_000 }), span("b", { start: 1_000, end: null, status: "running", name: "Bash" })]);
    assert.equal(currentStep(t)?.name, "Bash");
    assert.equal(currentStep(trace([span("a", { name: "Read" })]))?.name, "Read");
    assert.equal(currentStep(trace([])), null);
  });
});

describe("made-up traces", () => {
  test("a script is the same every time for a seed, and ends with the reply", () => {
    const one = fixtureScript(7);
    assert.deepEqual(one, fixtureScript(7));
    assert.equal(one.steps.at(-1)?.name, "Writing");
    assert.ok(one.total > 30_000);
    // steps follow one another, with no going back in time
    for (let i = 1; i < one.steps.length; i++) assert.ok(one.steps[i].start >= one.steps[i - 1].start);
  });

  test("partway through, only what has begun shows, and what is going is open", () => {
    const script = fixtureScript(3);
    const t = fixtureTrace(script, T0, 5_000);
    assert.equal(t.running, true);
    assert.ok(t.spans.every((s) => s.start <= 5_000));
    assert.ok(t.spans.some((s) => s.end === null));
    const done = fixtureTrace(script, T0, script.total + 1);
    assert.equal(done.running, false);
    assert.equal(done.endedAt, T0 + script.total);
    assert.ok(done.spans.every((s) => s.end !== null));
    assert.equal(done.totals.durationMs, script.total);
  });

  test("the live demo brings agents in one by one, each on its own turn", () => {
    assert.equal(fixtureLive(T0, T0).agents.length, 1);
    const later = fixtureLive(T0 + 20_000, T0);
    assert.ok(later.agents.length >= 2);
    for (const agent of later.agents) {
      assert.ok(agent.trace.running);
      assert.ok(agent.trace.startedAt <= T0 + 20_000);
      assert.equal(agent.state === "needs-you", agent.trace.spans.some((s) => s.kind === "wait" && s.end === null));
    }
    // long after, still well formed: rounds roll over
    const much = fixtureLive(T0 + 30 * 60_000, T0);
    for (const agent of much.agents) assert.ok(T0 + 30 * 60_000 - agent.trace.startedAt < 200_000);
  });
});

describe("which turn a fold opens", () => {
  test("its work's first and last moments, and the turn's id where a message carries one", () => {
    assert.deepEqual(askForFold([{ at: T0 + 5_000 }, { at: T0 + 1_000 }, { at: 0 }]), { turnId: null, window: { from: T0 + 1_000, to: T0 + 5_000 } });
    const codex = askForFold([{ at: T0, codexText: { turnId: "turn-9" } as never }]);
    assert.equal(codex.turnId, "turn-9");
    assert.deepEqual(askForFold([]), { turnId: null });
  });

  test("the trace the route gave is that turn only when their times meet", () => {
    const done = trace([], { startedAt: T0, endedAt: T0 + 10_000 });
    assert.equal(traceCovers(done, { from: T0 + 2_000, to: T0 + 9_000 }), true);
    assert.equal(traceCovers(done, { from: T0 - 90_000, to: T0 - 60_000 }), false, "a fold further up");
    assert.equal(traceCovers(trace([], { startedAt: T0, endedAt: null, running: true }), { from: T0 + 1, to: T0 + 2 }), true);
    assert.equal(traceCovers(done, undefined), true);
  });
});

test("the per-conversation route, with or without a named turn", () => {
  assert.equal(taskTracePath("b1", "t 2"), "/api/bots/b1/tasks/t%202/trace");
  assert.equal(taskTracePath("b1", "t2", "turn/9"), "/api/bots/b1/tasks/t2/trace?turn=turn%2F9");
});
