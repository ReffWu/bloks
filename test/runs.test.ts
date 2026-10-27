// When a run from a script is done (server/runs.ts): every conversation
// it reached quiet for a moment on end, a card stopping it where it is,
// and the answer read from the conversation the task went to.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Runs } from "../server/runs.ts";

function clock() {
  let now = 1_000;
  return { now: () => now, pass: (ms: number) => (now += ms) };
}

const said = (id: string, text: string) => ({ id, role: "bot", kind: "text", text });
const ada = { botId: "ada", agent: "Ada" };
const ivy = { botId: "ivy", agent: "Ivy" };

test("a run is done only once every conversation it handed work to has been quiet for the whole moment", () => {
  const time = clock();
  const runs = new Runs({ now: time.now, quietMs: 1_500 });
  const busy = new Set(["lane-a"]);
  const quiet = (lane: string) => !busy.has(lane);
  const tick = () => runs.tick(quiet, () => true, () => false);
  const { id } = runs.begin({ botId: "ada", agent: "Ada", laneId: "lane-a", laneTitle: "General" });

  runs.started("lane-a", "ada", "Ada");
  runs.link("lane-a", "lane-i", "Ada", "Ivy");
  busy.add("lane-i");
  runs.message("lane-a", said("m1", "I've asked Ivy."), ada);
  runs.ended("lane-a", { ok: true, why: null });
  busy.delete("lane-a");
  time.pass(5_000);
  tick();
  // the first turn's end is not the run's: Ivy is still working
  assert.equal(runs.view(id)!.status, "working");

  runs.started("lane-i", "ivy", "Ivy");
  busy.delete("lane-i");
  tick();
  time.pass(1_000);
  tick();
  // the gap between Ivy's end and the report's turn is not the end either
  assert.equal(runs.view(id)!.status, "working");
  busy.add("lane-a");
  runs.started("lane-a", "ada", "Ada");
  runs.message("lane-a", said("m2", "All done: here it is."), ada);
  runs.ended("lane-a", { ok: true, why: null });
  busy.delete("lane-a");
  tick();
  time.pass(1_600);
  tick();
  const view = runs.view(id)!;
  assert.equal(view.status, "done");
  assert.equal(view.reply, "All done: here it is.");
  assert.equal(view.turns, 3);
  assert.deepEqual(view.agents.map((a) => a.name).sort(), ["Ada", "Ivy"]);
  assert.ok(view.steps.some((s) => s.kind === "handoff" && s.text === "handed work to Ivy"));
});

test("a card stops a run as needs-you until it closes, and the last turn's end says how it went", () => {
  const time = clock();
  const runs = new Runs({ now: time.now, quietMs: 100 });
  let live = true;
  const { id } = runs.begin({ botId: "ada", agent: "Ada", laneId: "lane-a", laneTitle: "General" });
  runs.started("lane-a", "ada", "Ada");
  runs.message("lane-a", { id: "c1", role: "bot", kind: "options", card: { title: "Approval needed", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash" } }, ada);
  runs.tick(() => true, () => true, () => live);
  time.pass(500);
  runs.tick(() => true, () => true, () => live);
  const waiting = runs.view(id)!;
  assert.equal(waiting.status, "needs-you");
  assert.equal(waiting.asks[0].approval, true);
  assert.equal(waiting.asks[0].subtitle, "rm -rf build");
  live = false;
  runs.message("lane-a", { id: "n1", role: "bot", kind: "notice", text: "The engine is signed out." }, ada);
  runs.ended("lane-a", { ok: false, why: "error" });
  runs.tick(() => true, () => true, () => live);
  time.pass(200);
  runs.tick(() => true, () => true, () => live);
  const failed = runs.view(id)!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "The engine is signed out.");
});

test("what a run spent, made and said in other conversations is its own, and nobody else's", () => {
  const runs = new Runs();
  const { id } = runs.begin({ botId: "ada", agent: "Ada", laneId: "lane-a", laneTitle: "General" });
  runs.spent("lane-a", { input: 100, output: 20, cost: 0.01 });
  runs.spent("lane-other", { input: 999, output: 999, cost: 9 });
  runs.link("lane-a", "lane-i", "Ada", "Ivy");
  runs.spent("lane-i", { input: 50, output: 5, cost: null });
  runs.message("lane-i", { id: "a1", role: "bot", kind: "artifact", artifact: { name: "report.pdf", mime: "application/pdf", size: 10 } }, ivy);
  runs.message("lane-a", { id: "c1", role: "bot", kind: "changes", changes: { checkpointId: "k1", files: [{ path: "a.ts", status: "modified" }, { path: "b.ts", status: "added", shared: true }] } }, ada);
  // a teammate's words are steps, never the run's answer
  runs.message("lane-i", said("m1", "Ivy's own words"), ivy);
  const view = runs.view(id)!;
  assert.deepEqual(view.tokens, { input: 150, output: 25 });
  assert.equal(view.cost, 0.01);
  assert.equal(view.reply, null);
  assert.deepEqual(view.files.map((f) => (f.kind === "artifact" ? f.name : f.path)), ["report.pdf", "a.ts"]);
  assert.ok(runs.stop(id));
  assert.equal(runs.view(id)!.status, "stopped");
  assert.equal(runs.stop(id), false);
});
