// The training export (server/run-export.ts), against a workspace on disk
// with a Claude Code lane and a Codex lane (test/helpers/run-export-fixture.ts).
//
// Each shape is checked against what its trainers read: OpenAI's chat
// format with tools and tool_calls, ShareGPT with from and value, and
// Bloks's own trajectory with every step timed. Then that nothing secret
// or personal survives, that what is left out stays out and is counted,
// and that a shortened record says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Scrubber,
  defaultChoice,
  diskSource,
  functionName,
  knownNames,
  readChoice,
  runExport,
  shorten,
  transcriptTurns,
  type ExportChoice,
  type TrajectoryRecord,
} from "../server/run-export.ts";
import { GITHUB_TOKEN, LONG_LINES, SAVED_SECRET, SECRET, writeExportFixture } from "./helpers/run-export-fixture.ts";

const HOME = "/Users/fixture";

function workspace(t: { after: (fn: () => void) => void }, options?: { privateReadable?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "bloks-run-export-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = join(dir, ".bloks");
  writeExportFixture(data, HOME, options);
  return { dir, data, source: diskSource(data, HOME) };
}

function choose(patch: Record<string, unknown> = {}): ExportChoice {
  const choice = readChoice({ ...patch });
  assert.equal(typeof choice, "object", String(choice));
  return choice as ExportChoice;
}

async function lines(source: ReturnType<typeof diskSource>, choice: ExportChoice, dir: string) {
  const out = join(dir, `out-${Math.random().toString(36).slice(2)}.jsonl`);
  const result = await runExport(source, choice, { out });
  const text = result.file ? readFileSync(result.file, "utf8") : "";
  return { result, records: text.split("\n").filter(Boolean).map((l) => JSON.parse(l)), text };
}

const reasons = (summary: { leftOut: { reasons: Array<{ reason: string; count: number }> } }) =>
  Object.fromEntries(summary.leftOut.reasons.map((r) => [r.reason, r.count]));

test("OpenAI chat records have tools, tool_calls answered by tool messages, and say their engine", async (t) => {
  const { dir, source } = workspace(t);
  const { result, records, text } = await lines(source, defaultChoice(), dir);
  // the good Claude turn, the steered one (not filtered by default), the Codex one
  assert.equal(result.summary.records, 3);
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.ok(Array.isArray(record.messages) && record.messages.length >= 2);
    const calls = new Set<string>();
    for (const [i, message] of record.messages.entries()) {
      assert.ok(["system", "user", "assistant", "tool"].includes(message.role), message.role);
      if (message.role === "tool") {
        assert.equal(typeof message.content, "string");
        assert.ok(calls.has(message.tool_call_id), "a tool message answers a call made before it");
      }
      if (message.role === "assistant" && message.tool_calls) {
        for (const call of message.tool_calls) {
          assert.equal(call.type, "function");
          assert.match(call.function.name, /^[A-Za-z0-9_-]{1,64}$/);
          assert.equal(typeof JSON.parse(call.function.arguments), "object");
          calls.add(call.id);
          // and every call is answered, right after its message
          assert.ok(record.messages.slice(i + 1).some((m: any) => m.role === "tool" && m.tool_call_id === call.id));
        }
      }
      if (message.role === "assistant" && !message.tool_calls) assert.equal(typeof message.content, "string");
    }
    for (const tool of record.tools ?? []) {
      assert.equal(tool.type, "function");
      assert.equal(tool.function.parameters.type, "object");
    }
    assert.equal(record.metadata.source, "Bloks");
    assert.ok(["claudeAgent", "codex"].includes(record.metadata.engine));
  }
  const claude = records.find((r) => r.metadata.engine === "claudeAgent" && r.messages.some((m: any) => m.tool_calls))!;
  assert.equal(claude.metadata.toolResults, "complete");
  assert.equal(claude.metadata.toolInputs, "complete");
  assert.equal(claude.metadata.model, "claude-sonnet-5");
  assert.equal(claude.metadata.cost, 0.25);
  assert.equal(claude.metadata.thumbsUp, true);
  // the person's words from the transcript, never the prompt as the engine got it
  assert.match(claude.messages[0].content, /^Fix the failing test/);
  assert.ok(!text.includes("recall and all"));
  // the words before a call are the message that made it; a sub-agent's call is not one
  const first = claude.messages[1];
  assert.equal(first.content, "Running the tests.");
  assert.deepEqual(JSON.parse(first.tool_calls[0].function.arguments), { command: "npm test" });
  assert.ok(!text.includes("child"));
  const bash = claude.tools.find((tool: any) => tool.function.name === "Bash");
  assert.deepEqual(bash.function.parameters.required, ["command"]);
  assert.equal(claude.messages.at(-1).content, "Fixed: the test now passes.");

  const codex = records.find((r) => r.metadata.engine === "codex")!;
  assert.equal(codex.metadata.model, "gpt-5.5-codex");
  // the command came back; the web search never says what it found
  assert.equal(codex.metadata.toolResults, "partial");
  const results = codex.messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);
  assert.ok(results.includes("a.txt\nb.txt\nc.txt\n"));
  assert.ok(results.some((c: string) => /not recorded/.test(c)));
  assert.equal(codex.metadata.inputTokens, 500, "a running total is the turn's highest, not its sum");
  assert.deepEqual(
    result.summary.engines.map((e) => [e.kind, e.toolResults]).sort(),
    [["claudeAgent", "complete"], ["codex", "partial"]],
  );
});

test("ShareGPT records alternate human, gpt and tool, with calls and results as tagged blocks", async (t) => {
  const { dir, source } = workspace(t);
  const { records } = await lines(source, choose({ format: "sharegpt" }), dir);
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.ok(Array.isArray(record.conversations));
    assert.equal(record.conversations[0].from, "human");
    for (const [i, turn] of record.conversations.entries()) {
      assert.ok(["system", "human", "gpt", "tool"].includes(turn.from));
      assert.equal(typeof turn.value, "string");
      if (i > 0 && turn.from !== "human") assert.notEqual(turn.from, record.conversations[i - 1].from, "one side does not speak twice in a row");
      for (const block of turn.value.matchAll(/<tool_call>\n(.*?)\n<\/tool_call>/gs)) {
        const call = JSON.parse(block[1]);
        assert.equal(typeof call.name, "string");
        assert.equal(typeof call.arguments, "object");
        assert.equal(record.conversations[i + 1].from, "tool");
      }
      for (const block of turn.value.matchAll(/<tool_response>\n(.*?)\n<\/tool_response>/gs)) assert.equal(typeof JSON.parse(block[1]).content, "string");
    }
    assert.ok(Array.isArray(JSON.parse(record.tools)));
    assert.equal(record.conversations.at(-1).from, "gpt");
  }
});

test("Bloks trajectories time every step and carry engine, model, tokens and cost", async (t) => {
  const { dir, source } = workspace(t);
  const { records } = await lines(source, choose({ format: "trajectory" }), dir);
  const claude: TrajectoryRecord = records.find((r) => r.engine.kind === "claudeAgent" && r.usage.toolCalls)!;
  assert.equal(claude.format, "bloks.trajectory");
  assert.equal(claude.engine.name, "Claude Code");
  assert.equal(claude.outcome.status, "ok");
  assert.deepEqual([claude.usage.inputTokens, claude.usage.outputTokens, claude.usage.cost], [2100, 50, 0.25]);
  assert.equal(claude.usage.toolCalls, 3);
  assert.ok(claude.durationMs >= 4_000);
  for (const step of claude.steps) assert.ok(Number.isFinite(step.at) && step.at >= 0, step.type);
  const tools = claude.steps.filter((s) => s.type === "tool");
  assert.deepEqual(tools.map((s) => (s.type === "tool" ? s.ms : null)), [2000, 100, 100]);
  assert.ok(claude.steps.some((s) => s.type === "model"), "the model's stretches are steps too");
  assert.equal(claude.steps[0].type, "user");
  const codex: TrajectoryRecord = records.find((r) => r.engine.kind === "codex")!;
  assert.equal(codex.usage.cost, null, "no price and no estimate offered is no cost");
  assert.equal(codex.toolInputs, "complete");
  assert.equal(codex.toolResults, "partial");
});

test("keys always come out, and the person's details as chosen, with each counted", async (t) => {
  const { dir, source } = workspace(t);
  const { result, text } = await lines(source, choose({ format: "trajectory" }), dir);
  for (const leaked of [SECRET, SAVED_SECRET, GITHUB_TOKEN, "sam@example.com", "415 555 0134", HOME, "Sam Lee", "Sam asked"]) {
    assert.ok(!text.includes(leaked), `${leaked} is in the export`);
  }
  assert.ok(text.includes("~/proj/app"), "a home folder path is written from ~");
  assert.ok(text.includes("[email]") && text.includes("[phone]") && text.includes("[person]"));
  const removed = result.summary.removed;
  assert.ok(removed.secrets >= 3, `secrets ${removed.secrets}`);
  assert.ok(removed.emails >= 1 && removed.phones >= 1 && removed.names >= 1 && removed.homePaths >= 3);

  // with every switch off, only the keys still go
  const kept = await lines(source, choose({ format: "trajectory", privacy: { emails: false, phones: false, homePaths: false, names: false } }), dir);
  assert.ok(kept.text.includes("sam@example.com") && kept.text.includes(HOME) && kept.text.includes("Sam Lee"));
  for (const leaked of [SECRET, SAVED_SECRET, GITHUB_TOKEN]) assert.ok(!kept.text.includes(leaked));
  assert.equal(kept.result.summary.removed.emails, 0);
});

test("the scrubber leaves dates, versions and lowercase words alone", () => {
  const scrub = new Scrubber({ emails: true, phones: true, homePaths: true, names: true }, { secrets: [], home: "/home/sam", names: ["Sam Lee"] });
  assert.equal(scrub.text("On 2026-10-27 at 10:30, v1.2.3 shipped to /home/samuel"), "On 2026-10-27 at 10:30, v1.2.3 shipped to /home/samuel");
  assert.equal(scrub.text("cd /home/sam/src && ls sample"), "cd ~/src && ls sample");
  assert.equal(scrub.text("Ask Sam, or sam lee, or SAM LEE"), "Ask [person], or [person], or [person]");
  assert.equal(scrub.removed.names, 3);
});

test("what is left out stays out and is counted, and asking for it brings it in", async (t) => {
  const { dir, source } = workspace(t);
  const plain = await runExport(source, defaultChoice());
  const why = reasons(plain.summary);
  assert.equal(why.failed, 1);
  assert.equal(why.stopped, 1);
  assert.equal(why.rewound, 1);
  assert.equal(why.others, 2, "a Telegram stranger's turn and a member's words in the team conversation");
  assert.equal(why.memberPrivate, undefined, "with reading them off, a private conversation is not even counted");
  assert.equal(plain.summary.leftOut.total, 5);
  assert.equal(plain.file, null, "a dry run writes nothing");

  const strict = await runExport(source, choose({ uncorrected: true }));
  assert.equal(reasons(strict.summary).corrected, 1, "the steered turn");
  assert.equal(strict.summary.records, 2);
  const liked = await runExport(source, choose({ thumbsUp: true }));
  assert.equal(liked.summary.records, 1);
  const whole = await runExport(source, choose({ completeResults: true }));
  assert.equal(reasons(whole.summary).incomplete, 1, "the Codex turn, whose web search has no result");
  const codex = await runExport(source, choose({ engines: ["codex"] }));
  assert.equal(codex.summary.records, 1);
  assert.equal(reasons(codex.summary).engine, 4, "every Claude turn that was not left out for something else first");
  const anyOutcome = await runExport(source, choose({ finishedWell: false }));
  assert.equal(anyOutcome.summary.records, 4, "the stopped turn comes in; the failed one said nothing and made no call");
  assert.equal(reasons(anyOutcome.summary).empty, 1);

  const others = await lines(source, choose({ include: { otherPeople: true }, format: "trajectory" }), dir);
  assert.equal(others.result.summary.records, 5);
  assert.ok(others.result.summary.warnings.some((w) => /Other people's messages/.test(w)));
  assert.ok(!others.text.includes("Kim Park"), "a Telegram person's name is still taken out");

  // members' private conversations need the workspace switch and the tick
  const off = await runExport(source, choose({ include: { memberPrivate: true } }));
  assert.equal(off.summary.records, 3);
  assert.ok(off.summary.warnings.some((w) => /stay out/.test(w)));
});

test("a member's private conversation comes in only when reading them is on and it is asked for", async (t) => {
  const { source } = workspace(t, { privateReadable: true });
  const unticked = await runExport(source, defaultChoice());
  assert.equal(reasons(unticked.summary).memberPrivate, 1);
  const ticked = await runExport(source, choose({ include: { memberPrivate: true } }));
  assert.equal(ticked.summary.records, 4);
  assert.ok(ticked.summary.warnings.some((w) => /ask them before you share it/.test(w)));
});

test("descriptions and memory are left out unless asked for", async (t) => {
  const { dir, source } = workspace(t);
  const plain = await lines(source, defaultChoice(), dir);
  assert.ok(!plain.text.includes("Keeps the build green") && !plain.text.includes("npm test.\\n"));
  assert.ok(plain.records.every((r) => r.messages[0].role === "user"));
  const asked = await lines(source, choose({ include: { systemPrompt: true, memory: true }, agents: ["ada"] }), dir);
  const system = asked.records[0].messages[0];
  assert.equal(system.role, "system");
  assert.match(system.content, /^You are Ada, Engineer\. Keeps the build green\./);
  assert.match(system.content, /Your memory:\n\nThe build runs with npm test\./);
});

test("long results keep head and tail with a marked gap, repeats point back, and the rule is in the record", async (t) => {
  const { dir, source } = workspace(t);
  const { records, result } = await lines(source, choose({ format: "trajectory", agents: ["ada"] }), dir);
  const record: TrajectoryRecord = records.find((r) => r.usage.toolCalls)!;
  const [bash, read, again] = record.steps.filter((s) => s.type === "tool") as Array<Extract<TrajectoryStep, { type: "tool" }>>;
  assert.ok(bash.output!.length < 6_200 && bash.output!.length > 5_900, `${bash.output!.length}`);
  assert.match(bash.output!, /\[\.\.\. [\d,]+ characters left out \.\.\.\]/);
  assert.ok(bash.output!.startsWith("PASS test 0 in ~/proj/app/test.js"));
  assert.match(bash.note!, /^shortened from/);
  assert.equal(read.output, "# App\nHello");
  assert.equal(again.output, `[Same result as call ${read.id}, left out]`);
  assert.equal(record.compression.shortened, 1);
  assert.equal(record.compression.repeats, 1);
  assert.match(record.compression.rule!, /first and last 3,000/);
  assert.equal(result.summary.compression.shortened, 1);

  // with both off, the result is whole
  const full = await lines(source, choose({ format: "trajectory", agents: ["ada"], compression: { toolResultChars: null, repeats: false } }), dir);
  const whole = (full.records.find((r) => r.usage.toolCalls) as TrajectoryRecord).steps.find((s) => s.type === "tool") as Extract<TrajectoryStep, { type: "tool" }>;
  assert.equal(whole.output!.split("\n").length, LONG_LINES + 2);
  assert.equal((full.records[0] as TrajectoryRecord).compression.rule, null);

  // a cap shortens further, and a record that cannot fit is left out and counted
  const capped = await lines(source, choose({ format: "trajectory", agents: ["ada"], compression: { toolResultChars: null, repeats: true, capTokens: 700 } }), dir);
  const fit = capped.records.find((r) => r.usage.toolCalls) as TrajectoryRecord;
  assert.ok(fit.compression.capped);
  assert.ok(Math.ceil(JSON.stringify(fit.steps).length / 4) < 1_200);
  const tiny = await runExport(source, choose({ agents: ["ada"], compression: { toolResultChars: null, repeats: true, capTokens: 100 } }));
  assert.equal(reasons(tiny.summary).tooLong, 1);
});

test("a whole conversation is one record, lengths filter, and dates bound the turns", async (t) => {
  const { dir, source } = workspace(t);
  const { records } = await lines(source, choose({ unit: "conversation", format: "trajectory" }), dir);
  assert.equal(records.length, 2);
  const claude: TrajectoryRecord = records.find((r) => r.engine.kind === "claudeAgent")!;
  assert.equal(claude.unit, "conversation");
  assert.equal(claude.turns, 2);
  assert.equal(claude.turnsLeftOut, 3);
  assert.equal(claude.steps.filter((s) => s.type === "user" && s.from === "owner").length, 3, "two asks and the words that steered the second");

  const short = await runExport(source, choose({ maxTokens: 40 }));
  assert.ok(reasons(short.summary).tooLong >= 1);
  const long = await runExport(source, choose({ minTokens: 40 }));
  assert.ok(reasons(long.summary).tooShort >= 1);

  const early = await runExport(source, choose({ to: "2026-10-19" }));
  assert.equal(early.summary.records, 0);
  assert.ok(reasons(early.summary).dates >= 3);
});

test("choices are checked before anything is read", () => {
  assert.match(String(readChoice({ format: "csv" })), /format/);
  assert.match(String(readChoice({ unit: "day" })), /unit/);
  assert.match(String(readChoice({ agents: ["../etc"] })), /agents/);
  assert.match(String(readChoice({ from: "2026-10-30", to: "2026-10-01" })), /after/);
  assert.match(String(readChoice({ compression: { toolResultChars: 10 } })), /200 characters/);
  assert.equal((readChoice({}) as ExportChoice).privacy.names, true);
  assert.equal(functionName("mcp server/tool name!"), "mcp_server_tool_name");
  assert.equal(shorten("abcdefghij", 4).startsWith("ab"), true);
});

test("the transcript's turns are read the way a Redo reads them", () => {
  const at = 1_000;
  const turns = transcriptTurns("lane", [
    { id: "1", role: "user", kind: "text", text: "a", at, deliveredAt: 5 },
    { id: "2", role: "user", kind: "text", text: "b", at: at + 1, deliveredAt: 5 },
    { id: "3", role: "bot", kind: "text", text: "ok", at: at + 2 },
    { id: "4", role: "user", kind: "text", text: "c", at: at + 3, midTurn: true },
    { id: "5", role: "user", kind: "text", text: "d", at: at + 4, queued: true },
    { id: "6", role: "user", kind: "text", text: "e", at: at + 5 },
  ]);
  assert.deepEqual(turns.map((t) => t.opened.map((m) => m.id)), [["1", "2"], ["6"]]);
  assert.equal(turns[0].corrected, true, "steered while it ran");
});

test("a person let in on Signal is somebody else, as a Telegram stranger is; the owner on Signal is the owner", () => {
  const signal = { botId: "cody", generation: "g" };
  const turns = transcriptTurns("lane", [
    { id: "1", role: "user", kind: "text", text: "from my phone", at: 1_000, fromSignal: signal },
    { id: "2", role: "bot", kind: "text", text: "ok", at: 1_001 },
    { id: "3", role: "user", kind: "text", text: "hi, it's Kim", at: 1_002, fromSignal: { ...signal, personId: "sp-1" } },
    { id: "4", role: "bot", kind: "text", text: "hello Kim", at: 1_003 },
  ]);
  assert.deepEqual(turns.map((t) => t.others), [false, true]);
});

test("the names taken out include the people let in on Signal", () => {
  const cfg = {
    profile: { name: "Sam Lee" },
    telegram: { bots: { cody: { people: { a: { name: "Kim Park" } } } } },
    signal: { bots: { cody: { ownerName: "Sam", people: { b: { name: "Ana Ruiz" } } } } },
  };
  assert.deepEqual(knownNames({ people: [{ name: "Jo Chen" }] }, cfg).sort(), ["Ana Ruiz", "Jo Chen", "Kim Park", "Sam", "Sam Lee"]);
});

test("a Signal person's own conversation is left out with other people's words", async (t) => {
  const { data, source } = workspace(t);
  const bots = JSON.parse(readFileSync(join(data, "bots.json"), "utf8"));
  const before = reasons((await runExport(source, defaultChoice())).summary).others ?? 0;
  // the Codex lane, answered for a person on Signal: every turn in it is theirs
  for (const bot of bots) for (const task of bot.tasks ?? []) if (task.id === "lane-codex") task.signalPerson = "sp-1";
  const after = await runExport({ ...source, bots }, defaultChoice());
  assert.equal(reasons(after.summary).others, before + 1, "the owner's ask in that lane counts as theirs too");
});

type TrajectoryStep = TrajectoryRecord["steps"][number];
