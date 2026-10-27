// The trace routes, against the real harness and a synthetic Claude CLI.
//
// A turn that is still running shows in GET /api/trace/live with its open
// call drawn as running; once it ends, the lane's own route returns the
// finished turn, by name too, and after a restart it is read back from the
// events file. Both are the owner's, like /api/activity: a member's device
// and an agent's own credential are turned away from them exactly as they
// are from it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { allows } from "../server/agent-cli.ts";
import { startHarness, type Harness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

const MEMBER_TOKEN = "fixture-member-device-token";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("a running turn is live with its open call, and the finished turn is the lane's trace", { timeout: 120_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-trace-routes-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const release = join(home, "release");
  const answers = join(home, "answers.json");
  const cli = join(home, "fake-claude.mjs");
  // One turn: a Bash call held open until the test lets it go, then the
  // answer. Told CALLS <base64 json>, it first makes those requests with
  // its turn's own credential and writes down what came back.
  writeFileSync(
    cli,
    `#!${process.execPath}
import { existsSync, renameSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (argv[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (argv[argv.indexOf("--output-format") + 1] === "text") { console.log("A title"); process.exit(0); }
const emit = (frame) => console.log(JSON.stringify(frame));
let input = "";
process.stdin.on("data", async function take(c) {
  input += c;
  const line = input.split("\\n").find((l) => l.trim() && JSON.parse(l).type === "user");
  if (!line) return;
  process.stdin.off("data", take);
  const words = JSON.stringify(JSON.parse(line).message.content);
  emit({ type: "system", subtype: "init", session_id: "trace-session", model: "claude-sonnet-5" });
  const asked = words.match(/CALLS ([A-Za-z0-9+\\/=]+)/);
  if (asked) {
    const out = [];
    for (const path of JSON.parse(Buffer.from(asked[1], "base64").toString("utf8"))) {
      const res = await fetch(process.env.BLOKS_URL + path, { headers: { authorization: "Bearer " + process.env.BLOKS_TOKEN } });
      out.push({ path, status: res.status, body: await res.json().catch(() => null) });
    }
    writeFileSync(${JSON.stringify(answers)} + ".tmp", JSON.stringify(out));
    renameSync(${JSON.stringify(answers)} + ".tmp", ${JSON.stringify(answers)});
  }
  emit({ type: "assistant", message: { content: [{ type: "text", text: "Running the tests." }, { type: "tool_use", id: "toolu_tests", name: "Bash", input: { command: "npm test" } }], usage: { input_tokens: 1000, output_tokens: 20 } } });
  while (!existsSync(${JSON.stringify(release)})) await new Promise((r) => setTimeout(r, 25));
  emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_tests", content: "ok" }] } });
  // long enough for the writing after the call to be drawn
  await new Promise((r) => setTimeout(r, 400));
  emit({ type: "assistant", message: { content: [{ type: "text", text: "All green." }], usage: { input_tokens: 1100, output_tokens: 30 } } });
  emit({ type: "result", subtype: "success", is_error: false, num_turns: 2, duration_api_ms: 400, total_cost_usd: 0.25, session_id: "trace-session", result: "All green." });
  setTimeout(() => process.exit(0), 50);
});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli } } },
      remote: { enabled: true, devices: [], memberDevices: [{ id: "member-device", name: "Fixture device", hash: sha(MEMBER_TOKEN), pairedAt: 1, personId: "fixture-member" }] },
      profile: { name: "Owner" },
    }),
  );
  // the member is in a shared room, so their device reaches the member
  // surface proper rather than being turned away at its door
  writeFileSync(
    join(home, ".bloks", "people.json"),
    JSON.stringify({
      people: [{ id: "fixture-member", name: "Aya", createdAt: 1, relayTokenHash: sha(MEMBER_TOKEN) }],
      memberships: [{ personId: "fixture-member", roomId: "room-team", role: "collaborator", joinedAt: 1, invitedBy: "owner" }],
      invites: [],
      knocks: [],
    }),
  );
  writeFileSync(
    join(home, ".bloks", "bloks.json"),
    JSON.stringify([{ id: "room-team", name: "Team room", memberIds: [], createdAt: 1,
      sharing: { since: 1, history: "all", collaboratorsInvite: false, activityDetail: true, tools: "conversation", collaboratorsApprove: true, spendCap: 0 } }]),
  );
  let h: Harness = await startHarness({ HOME: home });
  t.after(() => h.stop());

  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Tracer" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
  const lane = (await h.json("/api/bots?messages=0")).bots.find((b: any) => b.id === bot.id).tasks[0].id as string;
  const own = `/api/bots/${bot.id}/tasks/${lane}/trace`;

  // nothing has run: nobody is live, and the lane has no trace
  assert.deepEqual((await h.json("/api/trace/live")).agents, []);
  assert.equal((await h.json(own)).trace, null);

  const paths = ["/api/activity", "/api/trace/live", own];
  await h.fetch(`/api/bots/${bot.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: `CALLS ${Buffer.from(JSON.stringify(paths)).toString("base64")}` }),
  });

  // ── while it runs ──
  const live = await waitFor(async () => {
    const body = await h.json("/api/trace/live");
    const entry = body.agents.find((a: any) => a.taskId === lane);
    return entry?.trace.spans.some((s: any) => s.kind === "tool") ? { body, entry } : null;
  });
  assert.ok(live, "the running turn never showed its call");
  const { body, entry } = live;
  assert.ok(Math.abs(body.now - Date.now()) < 60_000, "now is the server's clock");
  assert.deepEqual(
    { botId: entry.botId, name: entry.name, color: entry.color, taskTitle: entry.taskTitle, state: entry.state },
    { botId: bot.id, name: "Tracer", color: bot.color, taskTitle: "General", state: "working" },
  );
  assert.equal(entry.trace.running, true);
  assert.equal(entry.trace.endedAt, null);
  assert.equal(entry.trace.engine, "claudeAgent");
  assert.equal(entry.trace.model, "claude-sonnet-5");
  const call = entry.trace.spans.find((s: any) => s.kind === "tool");
  assert.deepEqual(
    { name: call.name, detail: call.detail, status: call.status, end: call.end, parentId: call.parentId },
    { name: "Bash", detail: "npm test", status: "running", end: null, parentId: "turn" },
  );
  assert.deepEqual([entry.trace.spans[0].kind, entry.trace.spans[0].status], ["turn", "running"]);
  // the lane's own route says the same while it runs
  const running = (await h.json(own)).trace;
  assert.equal(running.running, true);
  assert.equal(running.turnId, entry.trace.turnId);

  // ── who may see it: as /api/activity, and nobody else ──
  const theirs = JSON.parse(readFileSync(answers, "utf8")) as Array<{ path: string; status: number; body: unknown }>;
  const activity = theirs.find((a) => a.path === "/api/activity")!;
  assert.equal(activity.status, 403, "an agent read /api/activity; the fixture is wrong");
  for (const answer of theirs) {
    assert.equal(answer.status, activity.status, `an agent's credential reached ${answer.path}`);
    assert.doesNotMatch(JSON.stringify(answer.body), /spans/);
  }
  for (const path of paths) assert.equal(allows(bot.id, "GET", path).ok, false, `${path} is on an agent's list`);
  const memberActivity = await h.fetchRemote("/api/activity", { token: MEMBER_TOKEN });
  assert.notEqual(memberActivity.status, 200, "a member read /api/activity; the fixture is wrong");
  for (const path of paths.slice(1)) {
    const member = await h.fetchRemote(path, { token: MEMBER_TOKEN });
    assert.equal(member.status, memberActivity.status, `a member's device was answered differently on ${path}`);
    assert.doesNotMatch(JSON.stringify(member.body), /spans|Bash/);
  }

  // ── once it ends ──
  writeFileSync(release, "");
  assert.ok(
    await waitFor(async () => ((await h.json("/api/bots?messages=0")).bots.find((b: any) => b.id === bot.id)?.busy ? null : true)),
    "the turn never finished",
  );
  assert.ok(!(await h.json("/api/trace/live")).agents.some((a: any) => a.taskId === lane), "an idle lane is not live");
  const { trace } = await h.json(own);
  assert.equal(trace.running, false);
  assert.equal(trace.turnId, entry.trace.turnId);
  assert.ok(trace.endedAt >= trace.startedAt);
  assert.equal(trace.spans[0].status, "ok");
  const finished = trace.spans.find((s: any) => s.id === call.id);
  assert.equal(finished.status, "ok");
  assert.ok(typeof finished.end === "number" && finished.end >= finished.start);
  assert.deepEqual(
    { cost: trace.totals.cost, tokens: trace.totals.tokens, modelCalls: trace.totals.modelCalls, toolCalls: trace.totals.toolCalls, errors: trace.totals.errors, waits: trace.totals.waits },
    { cost: 0.25, tokens: 2_150, modelCalls: 2, toolCalls: 1, errors: 0, waits: 0 },
  );
  assert.ok(
    trace.spans.some((s: any) => s.kind === "model" && s.name === "Writing" && s.start >= finished.end && s.end === trace.spans[0].end && s.tokens === 1_130),
    "the model's writing after the call is drawn, with its message's tokens",
  );
  assert.deepEqual((await h.json(`${own}?turn=${encodeURIComponent(trace.turnId)}`)).trace.turnId, trace.turnId);
  const none = await h.json(`${own}?turn=no-such-turn`);
  assert.equal(none.trace, null);
  assert.ok(typeof none.now === "number" && Math.abs(none.now - Date.now()) < 60_000, "the answer carries the server's clock");
  // a fold asks by time: during the turn finds it, before any turn finds none
  const during = trace.startedAt + Math.max(1, Math.floor((trace.endedAt - trace.startedAt) / 2));
  assert.equal((await h.json(`${own}?at=${during}`)).trace.turnId, trace.turnId);
  assert.equal((await h.json(`${own}?at=${trace.startedAt - 60_000}`)).trace, null);
  assert.equal((await h.fetch(`${own}?at=soon`)).status, 400);
  assert.equal((await h.fetch(`${own}?turn=${encodeURIComponent("../../etc")}`)).status, 400);
  assert.equal((await h.fetch(`/api/bots/${bot.id}/tasks/not-a-lane/trace`)).status, 404);

  // ── after a restart, from the events file ──
  await h.stop();
  assert.ok(existsSync(join(home, ".bloks", "events", `${lane}.ndjson`)), "the events file is where the fallback reads");
  h = await startHarness({ HOME: home });
  const again = (await h.json(own)).trace;
  assert.equal(again.turnId, trace.turnId);
  assert.deepEqual(again.totals, trace.totals);
  assert.equal((await h.json(`${own}?turn=${encodeURIComponent(trace.turnId)}`)).trace.spans.length, trace.spans.length);
  assert.equal((await h.json(`${own}?at=${during}`)).trace.turnId, trace.turnId, "by time from the file too");
});
