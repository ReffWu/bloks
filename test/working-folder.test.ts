// An agent's working folder, changed in its settings, applies to the
// conversations it already has (GitHub 328). The settings said "Saved",
// but a conversation kept the folder of its first turn for good: one
// begun in the agent's own workspace stayed there, project instructions
// and all, and starting a fresh session did not move it either. Now the
// next turn in each conversation runs in the new folder, in a new engine
// session there (an engine's session belongs to the folder it began in),
// told the conversation so far, and the chat says so. A fresh session
// starts in the new folder too, without the old context, as fresh means.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startHarness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

test("a changed folder applies to the conversation's next turn, and a fresh session starts in it", async (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "bloks-folder-")));
  const log = join(home, "turns.jsonl");
  const cli = join(home, "fake-claude.mjs");
  // Writes down where each turn ran, whether it resumed a session, and
  // the words it was given.
  writeFileSync(
    cli,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (argv[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
let line = "";
const take = (c) => {
  line += c;
  while (line.includes("\\n")) {
    const at = line.indexOf("\\n");
    const next = line.slice(0, at);
    line = line.slice(at + 1);
    if (!next.trim()) continue;
    const frame = JSON.parse(next);
    if (frame.type !== "user") continue;
    process.stdin.off("data", take);
    const content = frame.message.content;
    const input = typeof content === "string" ? content : JSON.stringify(content);
    const resume = argv.includes("--resume") ? argv[argv.indexOf("--resume") + 1] : null;
    const session = resume ?? "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), resume, input }) + "\\n");
    console.log(JSON.stringify({ type: "system", subtype: "init", session_id: session, model: "claude-sonnet-5" }));
    console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }));
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, session_id: session, result: "Done." }));
    return;
  }
};
process.stdin.on("data", take);
`,
    { mode: 0o755 },
  );
  const project = join(home, "project");
  const other = join(home, "other");
  mkdirSync(project);
  mkdirSync(other);
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli } } } }));
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });

  // an agent made with no folder of its own
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Onboarder" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
  const turns = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const say = async (text: string) => {
    const n = turns().length + 1;
    assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text }) })).status, 202);
    assert.ok(await waitFor(() => turns().length >= n), h.logs().slice(-800));
    await waitFor(async () => ((await h.json("/api/bots?messages=0")).bots.find((b: any) => b.id === bot.id)?.busy ? null : true));
    return turns()[n - 1];
  };
  const setFolder = async (cwd: string | null) => {
    const res = await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
    assert.equal(res.status, 200);
  };
  const notices = async (): Promise<string[]> => {
    const { bots } = await h.json("/api/bots?messages=0");
    const lane = bots.find((b: any) => b.id === bot.id).tasks[0].id;
    const { messages } = await h.json(`/api/bots/${bot.id}/messages?thread=${lane}&limit=200`);
    return messages.filter((m: any) => m.kind === "notice").map((m: any) => m.text as string);
  };
  const first = await say("REMEMBER-THE-PELICAN: we set up the project here");
  const workspace = realpathSync(join(home, ".bloks", "workspaces", bot.id));
  assert.equal(first.cwd, workspace);
  const second = await say("and the next step");
  assert.equal(second.cwd, workspace);
  assert.ok(second.resume, "an unchanged folder resumes its session");

  // ── the person sets the folder in this very conversation's agent ──
  await setFolder(project);
  const moved = await say("now look at the project");
  assert.equal(moved.cwd, project, "the next turn still ran in the old folder");
  assert.equal(moved.resume, null, "a session from the old folder was resumed in the new one");
  assert.match(moved.input, /new session in ~\/.*project: the person changed the working folder/);
  assert.match(moved.input, /REMEMBER-THE-PELICAN/, "the new session was not told the conversation");
  assert.match(moved.input, /now look at the project/);
  assert.ok((await notices()).some((n) => /Onboarder works in ~\/.*project from here/.test(n)), "the chat does not say the folder changed");
  // and from there on it is that folder's session, resumed as usual
  const after = await say("carry on");
  assert.equal(after.cwd, project);
  assert.ok(after.resume);
  assert.doesNotMatch(after.input, /REMEMBER-THE-PELICAN/);

  // ── a fresh session starts in the folder set now, without the old context ──
  await setFolder(other);
  const { bots } = await h.json("/api/bots?messages=0");
  const lane = bots.find((b: any) => b.id === bot.id).tasks[0].id;
  assert.equal((await h.fetch(`/api/bots/${bot.id}/tasks/${lane}/fresh`, { method: "POST" })).status, 200);
  const fresh = await say("start over");
  assert.equal(fresh.cwd, other, "a fresh session kept the old folder");
  assert.equal(fresh.resume, null);
  assert.doesNotMatch(fresh.input, /REMEMBER-THE-PELICAN/, "a fresh session was told the old conversation");

  // ── and cleared, the agent's own workspace again ──
  await setFolder(null);
  const back = await say("back home");
  assert.equal(back.cwd, workspace);
  assert.equal(back.resume, null);
  assert.match(back.input, /REMEMBER-THE-PELICAN/);
  assert.ok((await notices()).some((n) => /works in its own workspace from here/.test(n)));
});
