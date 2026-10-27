// An agent opens a new conversation, a tab of its own, for itself or for
// an agent it may message, by saying the first thing in it (GitHub 408).
// Asked for a new tab, an agent had only `say`, which goes on in the
// first conversation, and the person's route for an empty tab, which an
// agent's credential is refused. The new route opens nothing that `say`
// would not reach, and the guide to Bloks names every command the
// installed command line has.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { allows } from "../server/agent-cli.ts";
import { controlledChain, type ChainTurn } from "./helpers/agent-chain.ts";

// The skills folder is fixed when the module loads, so a throwaway one is
// named first: reading the library must never read the person's own.
process.env.BLOKS_DATA_DIR = mkdtempSync(join(tmpdir(), "bloks-agent-tab-"));
const { builtinSkill, BLOKS_GUIDE } = await import("../server/skills.ts");

const CLI = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));

async function bloks(url: string, turn: ChainTurn, home: string, args: string[]) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { HOME: home, BLOKS_URL: url, BLOKS_TOKEN: turn.token } });
  let out = "", err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  const exit = await new Promise<number | null>((resolve) => child.once("close", resolve));
  clearTimeout(timer);
  return { exit, err, body: out.trim() ? JSON.parse(out) : null };
}

test("the route is the command line's own, and the person's empty tab stays theirs", () => {
  assert.equal(allows("bot-me", "POST", "/api/agent/conversations").ok, true);
  assert.equal(allows("bot-me", "GET", "/api/agent/conversations").ok, false);
  // creating an empty lane, and switching lanes, are not loosened
  assert.equal(allows("bot-me", "POST", "/api/bots/bot-me/tasks").ok, false);
  assert.equal(allows("bot-me", "POST", "/api/bots/bot-other/tasks").ok, false);
  assert.equal(allows("bot-me", "POST", "/api/bots/bot-other/tasks/lane-1/activate").ok, false);
});

test("an agent opens a tab for another with its first message, and is told which", async (t) => {
  const f = await controlledChain(t);
  const a = await f.hire("Planner"), b = await f.hire("Builder");
  const turn = await f.begin(a);
  const before = f.turns().length;

  // the reporter's 403: the person's route stays shut to an agent
  const owners = await f.agent(turn, `/api/bots/${b.id}/tasks`, { title: "Setup" });
  assert.equal(owners.status, 403);

  const opened = await bloks(f.h.url, turn, f.home, ["tab", b.id, "--title", "Staging setup", "Set up the staging box and say when it answers."]);
  assert.equal(opened.exit, 0, opened.err || JSON.stringify(opened.body));
  assert.equal(opened.body.ok, true);
  assert.deepEqual(opened.body.agent, { id: b.id, name: "Builder" });
  assert.equal(opened.body.title, "Staging setup");
  assert.match(opened.body.said, /^Opened "Staging setup" for Builder \(conversation [\w-]+\)\.$/);
  assert.ok(opened.body.said.includes(opened.body.taskId));

  // a real conversation of Builder's, beside its first, with the message in it
  const { bots } = await f.h.json("/api/bots?messages=0");
  const builder = bots.find((x: any) => x.id === b.id);
  const lane = builder.tasks.find((x: any) => x.id === opened.body.taskId);
  assert.equal(lane?.title, "Staging setup");
  assert.notEqual(lane.id, b.threadId, "it is a new tab, not the first conversation");
  // the person's screen stays on what they had open
  assert.equal(builder.activeTaskId, b.threadId);
  const { messages } = await f.h.json(`/api/bots/${b.id}/messages?thread=${lane.id}&limit=50`);
  const first = messages.find((m: any) => m.kind === "text" && m.text === "Set up the staging box and say when it answers.");
  assert.ok(first, "the first message is in the new tab");
  // and it started Builder's turn there, said as Planner's words
  const heard = await f.turnAfter(before);
  assert.match(heard.text, /Set up the staging box/);
  assert.match(heard.text, /Planner/);

  // the sender's own conversation keeps a record of it, as for `say`
  const sent = (await f.messages(a)).filter((m) => m.agent?.dir === "out");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].agent.peerId, b.id);

  // without --title the tab is named from its message
  const named = await bloks(f.h.url, turn, f.home, ["tab", "me", "Draft the release notes for Friday"]);
  assert.equal(named.exit, 0, named.err || JSON.stringify(named.body));
  assert.equal(named.body.agent.id, a.id);
  assert.equal(named.body.title, "Draft the release notes for Friday");

  // nothing to say is no tab at all
  const empty = await bloks(f.h.url, turn, f.home, ["tab", b.id]);
  assert.equal(empty.exit, 1);
  assert.match(empty.body.error, /first message/);
});

test("where `say` would be refused, so is a tab, and nothing is opened", async (t) => {
  const f = await controlledChain(t);
  const h = f.h;
  const a = await f.hire("Planner"), b = await f.hire("Builder");
  const turn = await f.begin(a);
  const lanes = async (id: string) => (await h.json("/api/bots?messages=0")).bots.find((x: any) => x.id === id)?.tasks.length;
  const count = await lanes(b.id);

  // an agent nobody can address: not on the roster at all
  const nobody = await bloks(h.url, turn, f.home, ["tab", "no-such-agent", "Hello"]);
  assert.equal(nobody.exit, 1);
  assert.match(nobody.body.error, /no such agent/);

  // an archived one, refused as `say` refuses it
  const archived = await h.fetch(`/api/bots/${b.id}`, { method: "DELETE" });
  assert.ok(archived.ok);
  const said = await f.agent(turn, `/api/bots/${b.id}/messages`, { text: "Hello" });
  assert.equal(said.status, 409);
  const tab = await bloks(h.url, turn, f.home, ["tab", b.id, "Hello"]);
  assert.equal(tab.exit, 1);
  assert.match(tab.body.error, /archived/);
  assert.equal(await lanes(b.id), count, "a refusal leaves no empty tab behind");

  // no credential, no route
  assert.equal((await h.fetch("/api/agent/conversations", { method: "POST", body: JSON.stringify({ to: a.id, text: "Hi" }) })).status, 401);
});

test("past the person's limit on agents writing to agents, a tab is held as a message is", async (t) => {
  const f = await controlledChain(t);
  await f.limit(1);
  const a = await f.hire("Planner"), b = await f.hire("Builder");
  // Builder's turn was started by Planner's message, one along the chain
  const { other, turn } = await f.depth(a, b, 1);
  const lanes = async (id: string) => (await f.h.json("/api/bots?messages=0")).bots.find((x: any) => x.id === id)?.tasks.length;
  const count = await lanes(other.id);
  const held = await bloks(f.h.url, turn, f.home, ["tab", other.id, "One more round on this"]);
  assert.equal(held.exit, 1);
  assert.match(held.body.error, /limit|not delivered|finish/i);
  assert.equal(await lanes(other.id), count, "nothing was opened past the limit");
  // the held words wait where `say`'s would: the first conversation, on its notice
  const notice = (await f.messages(other)).find((m) => m.chainHeld);
  assert.ok(notice, "the person finds the hold in the first conversation");
});

test("the guide to Bloks names every command the installed command line has", () => {
  const help = spawnSync(process.execPath, [CLI, "help"], { encoding: "utf8", env: { HOME: tmpdir() } });
  assert.equal(help.status, 0, help.stderr);
  const commands: Array<{ name: string }> = JSON.parse(help.stdout).commands;
  assert.ok(commands.some((c) => c.name === "tab"), "the new command is in `bloks help`");
  const guide = builtinSkill(BLOKS_GUIDE);
  assert.ok(guide, "the guide ships with Bloks");
  const missing = commands
    .map((c) => c.name)
    .filter((name) => !new RegExp("`" + name.replace(/[-]/g, "\\-") + "[ `]").test(guide.body));
  assert.deepEqual(missing, [], `the guide does not say when to use: ${missing.join(", ")}`);
  // the three the issue was about, told apart
  assert.match(guide.body, /A new tab: `tab /);
  assert.match(guide.body, /A handoff: `say /);
  assert.match(guide.body, /A fresh session: `fresh`/);
  assert.doesNotMatch(guide.body, /[\u2014\u2013]/);
  assert.doesNotMatch(guide.description, /[\u2014\u2013]/);
});
