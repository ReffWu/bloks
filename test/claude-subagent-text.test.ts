// A background subagent's own words are not the agent's reply (GitHub 331).
//
// A turn started a subagent in the background, wrote its reply and
// ended. The subagent went on in the same Claude Code process, and its
// scratch notes between tool calls ("My pkill likely killed my own
// shell. Retry.") were saved as the agent's messages, after the turn had
// ended, and kept coming once the next turn had started a second process
// on the same session. The frames say whose they are: a subagent's carry
// the parent_tool_use_id of the call that started it.
//
// Either way the turn ends (server/background-work.ts): letting the
// background work finish, the turn stays open until the subagent is done
// and the agent has said what it found; stopping it, the turn ends at the
// reply and the subagent goes with its process. Neither leaves a note in
// the chat or a process beside the next turn.
//
// Through the real server, store and stream, with a stand-in CLI that
// does what the report's did, with the task frames Claude Code sends for
// a background subagent. No real Claude runs.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { startHarness } from "./helpers/server.ts";

async function until<T>(read: () => T | null | undefined | Promise<T | null | undefined>, why: string, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(why);
}

const rows = (path: string): any[] =>
  existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A Claude Code that, told RESEARCH, starts a subagent in the background
 * and answers; the subagent speaks during the turn and again after its
 * result, from the same process, which stays up for it, and once it is
 * done the agent says what it found. Each process writes down which
 * earlier ones were still running when it started. */
async function fixture(t: TestContext, version: string, choice: { workspace?: "finish" | "stop"; agent?: "finish" | "stop" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "bloks-subagent-text-"));
  const cli = join(home, "fake-claude.mjs");
  mkdirSync(join(home, ".bloks"));
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({
    instances: { claude: { driver: "claudeAgent", config: { cli } } },
    ...(choice.workspace ? { turns: { backgroundWork: choice.workspace } } : {}),
  }));
  writeFileSync(
    cli,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const home = ${JSON.stringify(home)}, args = process.argv.slice(2);
if (args[0] === "--version") { console.log(${JSON.stringify(version)}); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const earlier = existsSync(home + "/pids") ? readFileSync(home + "/pids", "utf8").trim().split("\\n").map(Number) : [];
appendFileSync(home + "/spawns.jsonl", JSON.stringify({ pid: process.pid, args, stillRunning: earlier.filter(alive) }) + "\\n");
appendFileSync(home + "/pids", process.pid + "\\n");
const out = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const state = (value) => process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS === "1" && out({ type: "system", subtype: "session_state_changed", state: value });
const child = (text) => out({ type: "assistant", parent_tool_use_id: "toolu_research", session_id: "sess-subagents",
  message: { content: [{ type: "text", text }], usage: { input_tokens: 4, output_tokens: 2 } } });
let buffer = "", taken = false;
process.stdin.on("error", () => {});
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let i = buffer.indexOf("\\n"); i >= 0; i = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.type !== "user" || taken) continue;
    taken = true;
    run(String(frame.message.content), frame.uuid);
  }
});
function run(text, id) {
  const own = id ? { user_message_uuid: id, user_message_uuids: [id] } : {};
  const result = (said) => {
    out({ type: "result", subtype: "success", is_error: false, num_turns: 2, duration_api_ms: 50, total_cost_usd: 0,
      session_id: "sess-subagents", result: said, ...(id ? { uuid: "result-" + id, ...own } : {}) });
    if (id) out({ type: "command_lifecycle", command_uuid: id, state: "completed" });
  };
  state("running");
  out({ type: "system", subtype: "init", session_id: "sess-subagents", model: "claude-sonnet-5" });
  if (id) out({ type: "system", subtype: "status", status: "requesting", uuid: "request-" + id, user_message_uuids: [id] });
  if (!text.includes("RESEARCH")) {
    out({ type: "assistant", message: { content: [{ type: "text", text: "Here is the summary." }] } });
    result("Here is the summary.");
    state("idle");
    return;
  }
  out({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_research", name: "Agent",
    input: { description: "Research", prompt: "Dig through the logs", run_in_background: true } }] } });
  out({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "a-research", task_type: "local_agent", subagent_type: "general-purpose", description: "Research" }] });
  out({ type: "system", subtype: "task_started", task_id: "a-research", tool_use_id: "toolu_research", description: "Research", task_type: "local_agent", is_backgrounded: true });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_research", content: "Async agent launched successfully." }] } });
  child("SUBAGENT_NOTE My pkill likely killed my own shell. Retry.");
  out({ type: "assistant", message: { content: [{ type: "text", text: "I have started the research in the background." }] } });
  result("I have started the research in the background.");
  state("idle");
  // the subagent works on in this process after its parent's result
  setTimeout(() => { appendFileSync(home + "/late.jsonl", JSON.stringify({ pid: process.pid }) + "\\n"); child("SUBAGENT_NOTE Wasted loads. Print raw this time."); }, 400);
  // and finishes; the CLI tells the agent, who says what it found
  setTimeout(() => {
    out({ type: "system", subtype: "task_notification", task_id: "a-research", tool_use_id: "toolu_research", status: "completed", summary: "Found it", output_file: "/tmp/a-research.out" });
    out({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    state("running");
    out({ type: "system", subtype: "init", session_id: "sess-subagents", model: "claude-sonnet-5" });
    out({ type: "assistant", message: { content: [{ type: "text", text: "The research is done: the outage was the cache." }] } });
    out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 50, total_cost_usd: 0,
      session_id: "sess-subagents", result: "The research is done: the outage was the cache.", ...(id ? { uuid: "result-own" } : {}) });
    state("idle");
  }, 1_200);
  setTimeout(() => child("SUBAGENT_NOTE A newer turn of this agent took over, so I'm stopping."), 2_500);
}
setInterval(() => {}, 1000);
`,
    { mode: 0o755 },
  );
  const h = await startHarness({ HOME: home, USERPROFILE: home });
  t.after(async () => {
    await h.stop();
    for (const pid of rows(join(home, "spawns.jsonl")).map((row) => row.pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Researcher" }) });
  await h.json(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, ...(choice.agent ? { backgroundWork: choice.agent } : {}) }) });
  const messages = async (): Promise<any[]> => (await h.json(`/api/bots/${bot.id}/messages?limit=100`)).messages;
  const busy = async () => Boolean((await h.json("/api/bots?messages=0")).bots.find((row: any) => row.id === bot.id)?.busy);
  const send = (text: string) => h.json(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  const said = async (text: string) => (await messages()).some((row) => row.role === "bot" && row.text === text);
  return { home, bot, messages, busy, send, said };
}

const STARTED = "I have started the research in the background.";
const FOUND = "The research is done: the outage was the cache.";

/** What the conversation holds once two turns are done: no subagent's
 * note anywhere, the parent's own call shown as its activity, and the
 * replies in order. */
async function conversation(f: Awaited<ReturnType<typeof fixture>>, replies: string[]) {
  const stored = await f.messages();
  const said = stored.filter((row) => row.role === "bot" && row.kind !== "activity" && row.text).map((row) => row.text);
  assert.deepEqual(said.slice(-replies.length), replies);
  assert.doesNotMatch(JSON.stringify(stored), /SUBAGENT_NOTE/, "a subagent's note reached the conversation");
  assert.ok(stored.some((row) => row.kind === "activity" && row.tool?.name === "Agent"));
}

/** The next turn resumes the same session, with nothing of the last one
 * still running beside it. */
async function nextTurn(f: Awaited<ReturnType<typeof fixture>>) {
  await f.send("Summarise it");
  await until(async () => (await f.said("Here is the summary.")) && !(await f.busy()), "the next turn never ended");
  const second = rows(join(f.home, "spawns.jsonl"))[1];
  assert.equal(second.args[second.args.indexOf("--resume") + 1], "sess-subagents");
  assert.deepEqual(second.stillRunning, [], "the next turn resumed the session beside the old process");
}

for (const version of ["2.1.299 (Claude Code)", "2.1.300 (Claude Code)"]) {
  test(`stopping background work at the reply: the subagent goes with its turn, and its notes never show (${version})`, { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, version, { workspace: "stop" });
    await f.send("RESEARCH the outage");
    await until(async () => (await f.said(STARTED)) && !(await f.busy()), "the turn never ended");
    const [first] = rows(join(f.home, "spawns.jsonl"));
    // the process that would have gone on talking is gone with its turn
    await until(() => !alive(first.pid), "the turn's process outlived its turn");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(rows(join(f.home, "late.jsonl")).length, 0, "the subagent was still running after its parent's turn ended");
    await nextTurn(f);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await conversation(f, [STARTED, "Here is the summary."]);
  });

  test(`letting background work finish: the turn waits for the subagent, says what it found, and its notes never show (${version})`, { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, version, { workspace: "finish" });
    await f.send("RESEARCH the outage");
    await until(() => f.said(STARTED), "the agent never replied");
    assert.equal(await f.busy(), true, "the turn ended while its subagent worked");
    await until(async () => (await f.said(FOUND)) && !(await f.busy()), "the turn never ended once the subagent was done");
    const [first] = rows(join(f.home, "spawns.jsonl"));
    await until(() => !alive(first.pid), "the turn's process outlived its turn");
    await nextTurn(f);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await conversation(f, [STARTED, FOUND, "Here is the summary."]);
  });
}

test("with nothing chosen, background work is let finish", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, "2.1.300 (Claude Code)");
  await f.send("RESEARCH the outage");
  await until(() => f.said(STARTED), "the agent never replied");
  assert.equal(await f.busy(), true, "the turn ended while its subagent worked");
  await until(async () => (await f.said(FOUND)) && !(await f.busy()), "the turn never ended once the subagent was done");
});

test("an agent's own choice wins over the workspace's", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, "2.1.300 (Claude Code)", { workspace: "stop", agent: "finish" });
  await f.send("RESEARCH the outage");
  await until(async () => (await f.said(FOUND)) && !(await f.busy()), "the agent's own choice to let it finish was not kept");
  await conversation(f, [STARTED, FOUND]);
});
