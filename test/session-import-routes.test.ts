// Past sessions, through the real server: who may look, what an import
// makes, how the agent carries a session on, and that the person's own
// session files are never written.
//
// The harness runs with HOME set to a throwaway folder holding synthetic
// Claude Code and Codex sessions, and a stand-in Claude Code CLI that
// records how each turn was started: its arguments, the folder it ran in
// and the words it was given.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import { allows, NEVER } from "../server/agent-cli.ts";
import { startHarness } from "./helpers/server.ts";

const CLAUDE_ID = "11111111-2222-3333-4444-555555555555";
const CODEX_ID = "0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee";
const SECRET = "sk-ant-api03-ROUTESROUTESROUTES0123456789";

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

interface Call {
  argv: string[];
  cwd: string;
  said: string;
  sessionId: string;
}

async function setup(t: TestContext, version = "2.1.299 (Claude Code)") {
  const home = mkdtempSync(join(tmpdir(), "bloks-past-"));
  let stop: (() => Promise<void>) | undefined;
  t.after(async () => {
    await stop?.();
    rmSync(home, { recursive: true, force: true });
  });
  const project = join(home, "code", "sidebar");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "sidebar-app", dependencies: { react: "19" } }));
  const claudeDir = join(home, ".claude", "projects", "-code-sidebar");
  const claudeFile = join(claudeDir, `${CLAUDE_ID}.jsonl`);
  const base = { cwd: project, sessionId: CLAUDE_ID };
  write(
    claudeFile,
    jsonl([
      { ...base, type: "user", message: { role: "user", content: "Why do pinned rows jump around in the sidebar?" }, timestamp: "2026-09-01T09:00:00.000Z" },
      { ...base, type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: join(project, "src/sections.ts") } }] }, timestamp: "2026-09-01T09:00:01.000Z" },
      { ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "..." }] }, timestamp: "2026-09-01T09:00:02.000Z" },
      { ...base, type: "assistant", message: { id: "m2", role: "assistant", content: [{ type: "text", text: "compareRows sorts by activity before pinOrder, so a pinned zeppelin row moves." }] }, timestamp: "2026-09-01T09:00:03.000Z" },
      { ...base, type: "user", message: { role: "user", content: `my key is ${SECRET}` }, timestamp: "2026-09-01T09:00:04.000Z" },
    ]),
  );
  const codexFile = join(home, ".codex", "sessions", "2026", "09", "02", `rollout-2026-09-02T10-00-00-${CODEX_ID}.jsonl`);
  write(
    codexFile,
    jsonl([
      { timestamp: "2026-09-02T10:00:00.000Z", type: "session_meta", payload: { id: CODEX_ID, cwd: project, originator: "codex_cli_rs" } },
      { timestamp: "2026-09-02T10:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "Add a walrus test for the sidebar order" } },
      { timestamp: "2026-09-02T10:00:02.000Z", type: "event_msg", payload: { type: "agent_message", message: "Added the walrus test." } },
    ]),
  );

  // A stand-in Claude Code: answers the first user frame, writes down how
  // it was started, and, like the real one, leaves a session file of its
  // own in the project's folder, which must never come back as a past one.
  const cli = join(home, "fake-claude.mjs");
  const callsFile = join(home, "calls.json");
  writeFileSync(
    cli,
    `#!${process.execPath}
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log(${JSON.stringify(version)}); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
let line = "";
const take = (chunk) => {
  line += chunk;
  while (line.includes("\\n")) {
    const at = line.indexOf("\\n");
    const next = line.slice(0, at);
    line = line.slice(at + 1);
    if (!next.trim()) continue;
    const frame = JSON.parse(next);
    if (frame.type !== "user") continue;
    process.stdin.off("data", take);
    answer(frame);
    return;
  }
};
process.stdin.on("data", take);
function answer(frame) {
  const resumed = value("--resume");
  const sessionId = resumed && !args.includes("--fork-session") ? resumed : resumed ? randomUUID() : value("--session-id");
  const content = frame.message.content;
  const said = typeof content === "string" ? content : JSON.stringify(content);
  const calls = existsSync(${JSON.stringify(callsFile)}) ? JSON.parse(readFileSync(${JSON.stringify(callsFile)}, "utf8")) : [];
  calls.push({ argv: args, cwd: process.cwd(), said, sessionId });
  writeFileSync(${JSON.stringify(callsFile)} + ".tmp", JSON.stringify(calls));
  renameSync(${JSON.stringify(callsFile)} + ".tmp", ${JSON.stringify(callsFile)});
  const dir = ${JSON.stringify(claudeDir)};
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + "/" + sessionId + ".jsonl", JSON.stringify({ type: "user", cwd: process.cwd(), sessionId, message: { role: "user", content: said }, timestamp: new Date().toISOString() }) + "\\n");
  const out = (f) => console.log(JSON.stringify(f));
  out({ type: "system", subtype: "init", session_id: sessionId, model: "claude-sonnet-5" });
  out({ type: "assistant", message: { content: [{ type: "text", text: "Carrying on." }] } });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, session_id: sessionId, result: "Carrying on." });
}
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli, permissionMode: "bypassPermissions" } } } }),
  );
  const h = await startHarness({ HOME: home });
  stop = () => h.stop();
  const sources = [claudeFile, codexFile];
  const fingerprint = () => sources.map((f) => createHash("sha256").update(readFileSync(f)).digest("hex"));
  const calls = (): Call[] => (existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, "utf8")) : []);
  const makeAgent = async (name: string) => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name }) });
    const patched = await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
    assert.equal(patched.status, 200);
    return bot as { id: string; threadId: string };
  };
  const turn = async (botId: string, taskId: string, text: string) => {
    const n = calls().length + 1;
    const accepted = await h.fetch(`/api/bots/${botId}/messages`, { method: "POST", body: JSON.stringify({ text, taskId }) });
    assert.equal(accepted.status, 202);
    for (let i = 0; i < 200; i++) {
      const { bots } = await h.json("/api/bots?messages=0");
      if (calls().length >= n && !bots.find((b: any) => b.id === botId)?.busy) return calls()[n - 1];
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`the stand-in CLI did not finish: ${h.logs().slice(-800)}`);
  };
  const look = async () => {
    const res = await h.fetch("/api/session-import");
    assert.equal(res.status, 200);
    return res.json();
  };
  const bring = async (keys: string[], to: unknown) => {
    const review = await h.json("/api/session-import/review", { method: "POST", body: JSON.stringify({ picks: keys, to }) });
    const picks = review.sessions.map((s: any) => ({ key: s.key, digest: s.digest }));
    const outcome = await h.json("/api/session-import", { method: "POST", body: JSON.stringify({ picks, to }) });
    return { review, outcome };
  };
  return { h, home, project, claudeFile, fingerprint, calls, makeAgent, turn, look, bring };
}

test("only the person at this computer can look or bring anything over", async (t) => {
  const s = await setup(t);
  assert.ok(NEVER.includes("/api/session-import"));
  for (const [method, path] of [["GET", "/api/session-import"], ["POST", "/api/session-import"], ["POST", "/api/session-import/review"], ["GET", "/api/session-import/places"]]) {
    assert.equal(allows("some-agent", method, path).ok, false, `${method} ${path} reachable by an agent`);
    const remote = await s.h.fetchRemote(path, { method, body: method === "POST" ? "{}" : undefined });
    assert.ok(remote.status === 401 || remote.status === 403, `${method} ${path} answered ${remote.status} from the network`);
  }
  // whether the places are there, without opening either
  assert.deepEqual((await s.h.json("/api/session-import/places")).places, { claude: true, codex: true });
});

test("a look lists by project and shows no secrets; an import makes lanes that carry the session on", async (t) => {
  const s = await setup(t);
  const before = s.fingerprint();
  const kat = await s.makeAgent("Kat");

  const res = await s.h.fetch("/api/session-import");
  const text = await res.text();
  assert.equal(text.includes(SECRET), false, "a key reached the window");
  const listed = JSON.parse(text);
  assert.deepEqual(
    listed.projects.map((p: any) => [p.label, p.sessions.map((x: any) => [x.engine, x.title, x.messages])]),
    [["~/code/sidebar", [["codex", "Add a walrus test for the sidebar order", 2], ["claude", "Why do pinned rows jump around in the sidebar?", 3]]]],
  );
  assert.equal(existsSync(join(s.home, ".bloks", "session-import.json")), false, "looking wrote something down");

  const keys = [`claude:${CLAUDE_ID}`, `codex:${CODEX_ID}`];
  const { review, outcome } = await s.bring(keys, { botId: kat.id });
  assert.equal(JSON.stringify(review).includes(SECRET), false);
  assert.deepEqual(review.to, { botId: kat.id, name: "Kat", room: 19 });
  assert.deepEqual(
    review.sessions.map((x: any) => [x.engine, x.resumes, x.removed]),
    [["claude", true, 1], ["codex", false, 0]],
  );
  assert.match(review.sessions[1].why, /Kat does not run on Codex/);
  assert.deepEqual(outcome.results.map((r: any) => [r.key, r.ok, r.resumes]), [[`claude:${CLAUDE_ID}`, true, true], [`codex:${CODEX_ID}`, true, false]]);

  const { bots } = await s.h.json("/api/bots");
  const lanes = bots.find((b: any) => b.id === kat.id).tasks.filter((x: any) => x.imported);
  assert.deepEqual(lanes.map((x: any) => [x.title, x.imported.engine, x.imported.resumes]), [
    ["Why do pinned rows jump around in the sidebar?", "claude", true],
    ["Add a walrus test for the sidebar order", "codex", false],
  ]);
  const claudeLane = lanes[0].id;
  const codexLane = lanes[1].id;
  const { messages } = await s.h.json(`/api/bots/${kat.id}/messages?thread=${claudeLane}&limit=500`);
  assert.deepEqual(
    messages.map((m: any) => [m.role, m.kind, m.kind === "activity" ? m.tool.command : m.text?.slice(0, 40), m.imported]),
    [
      ["user", "text", "Why do pinned rows jump around in the si", "claude"],
      ["bot", "activity", "Read src/sections.ts", "claude"],
      ["bot", "text", "compareRows sorts by activity before pin", "claude"],
      ["user", "text", "[a line that looked like a key or a pass", "claude"],
      ["bot", "notice", "Brought over from Claude Code, where it ", "claude"],
    ],
  );
  assert.equal(messages[0].at, Date.parse("2026-09-01T09:00:00.000Z"), "the time it was said is kept");
  assert.match(messages[4].text, /Kat carries on the same Claude Code session, in a copy, so your own stays as it is\./);
  assert.match(messages[4].text, /One line that looked like keys or passwords stayed behind\./);

  // recall reaches it, and says where it was said
  const { hits } = await s.h.json(`/api/bots/${kat.id}/recall?q=${encodeURIComponent("zeppelin row")}`);
  assert.equal(hits[0]?.where, `your conversation "Why do pinned rows jump around in the sidebar?" (had in Claude Code before Bloks)`);
  assert.equal(hits[0]?.who, "Claude Code");

  // the first turn carries on the very session, forked, in its folder
  const first = await s.turn(kat.id, claudeLane, "So how do we fix it?");
  assert.equal(first.argv[first.argv.indexOf("--resume") + 1], CLAUDE_ID);
  assert.ok(first.argv.includes("--fork-session"), "the person's own session was resumed in place");
  assert.equal(first.cwd.replace(/^\/private/, ""), s.project.replace(/^\/private/, ""));
  assert.match(first.said, /brought over into Bloks from Claude Code\. You carry it on here as Kat\./);
  assert.doesNotMatch(first.said, /picking up/, "a resumed session is not told the story it already has");
  // and from then on, the fork, as any session
  const second = await s.turn(kat.id, claudeLane, "Go ahead.");
  assert.equal(second.argv[second.argv.indexOf("--resume") + 1], first.sessionId);
  assert.ok(!second.argv.includes("--fork-session"));
  assert.doesNotMatch(second.said, /brought over/);

  // Kat runs on Claude Code, so the Codex conversation is told, not resumed
  const told = await s.turn(kat.id, codexLane, "Is the walrus test still there?");
  assert.ok(!told.argv.includes("--resume"));
  assert.match(told.said, /^You are picking up a conversation the person had in Codex before Bloks\./);
  assert.match(told.said, /Added the walrus test\./);

  assert.deepEqual(s.fingerprint(), before, "a session file was written");

  // again: already here, and the forks Bloks made are not past sessions
  const again = await s.h.json("/api/session-import", { method: "POST", body: JSON.stringify({ picks: [`claude:${CLAUDE_ID}`], to: { botId: kat.id } }) });
  assert.match(again.results[0].error, /already a conversation with Kat/);
  const relisted = await s.look();
  const sessions = relisted.projects.flatMap((p: any) => p.sessions);
  assert.deepEqual(sessions.map((x: any) => x.key).sort(), keys.slice().sort(), "a session Bloks ran came back as a past one");
  assert.deepEqual(sessions.find((x: any) => x.engine === "claude").imported, { botId: kat.id, laneId: claudeLane, name: "Kat" });
});

test("a Claude Code that cannot fork a session is told the story instead of resuming it in place", async (t) => {
  const s = await setup(t, "1.0.40 (Claude Code)");
  const before = s.fingerprint();
  const kat = await s.makeAgent("Kat");
  const { outcome } = await s.bring([`claude:${CLAUDE_ID}`], { botId: kat.id });
  const lane = outcome.results[0].laneId;
  const call = await s.turn(kat.id, lane, "Where were we?");
  assert.ok(!call.argv.includes("--resume"), "an old CLI resumed the person's own session");
  assert.ok(call.argv.includes("--session-id"));
  assert.match(call.said, /You are picking up a conversation the person had in Claude Code before Bloks\./);
  assert.match(call.said, /pinned zeppelin row/);
  assert.deepEqual(s.fingerprint(), before);
});

test("hiring for a project makes one agent for its folder, on the engine its sessions ran on", async (t) => {
  const s = await setup(t);
  const { outcome } = await s.bring([`claude:${CLAUDE_ID}`, `codex:${CODEX_ID}`], { hire: true });
  assert.equal(outcome.created.length, 1);
  assert.ok(outcome.results.every((r: any) => r.ok));
  const { bots } = await s.h.json("/api/bots");
  const hired = bots.find((b: any) => b.id === outcome.created[0]);
  // scouting named it from the folder's own manifest, and made it the lead
  assert.equal(hired.name, "sidebar-app");
  assert.equal(hired.title, "Tech lead");
  assert.equal(hired.cwd.replace(/^\/private/, ""), s.project.replace(/^\/private/, ""));
  assert.equal(hired.modelSelection.instanceId, "claude");
  // it opens on the latest conversation it was given
  const latest = outcome.results.at(-1).laneId;
  assert.equal(hired.threadId, latest);
  assert.equal(hired.tasks.filter((x: any) => x.imported).length, 2);
});
