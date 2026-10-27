// Skills that keep every version, and improve only when the person says.
//
// Against the real server: the versions and their routes, a skill
// written before versions existed coming in whole, two writers that read
// the same version, an agent's credential asking for a change and being
// refused everything else, and the learning loop staging a revision and
// a new skill from what a turn showed, against an engine of our own.
// Nothing here may change a skill without a person keeping it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startHarness, type Harness } from "./helpers/server.ts";

const CLI = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));

const NOTES_V1 = "Lead with what broke.\n\nThen what is new.\n\nSign it off with the team name.";

async function waitFor<T>(check: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const found = await check();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

let h: Harness;
let home: string;
let skillsDir: string;
const answers = { revision: "NOTHING", review: "NOTHING" };
const asked: string[] = [];
let closeEngine = () => {};
const out = () => join(home, "agent-said.json");

before(async () => {
  home = mkdtempSync(join(tmpdir(), "bloks-skill-versions-"));
  skillsDir = join(home, ".bloks", "skills");
  mkdirSync(skillsDir, { recursive: true });
  // a skill written by an earlier Bloks, before versions existed
  writeFileSync(
    join(skillsDir, "release-notes.md"),
    `---\nname: Release notes\ndescription: Writing a release note\n---\n\n${NOTES_V1}\n`,
  );

  // A stand-in for Claude Code that, told REVISE, does what an agent
  // asking for a change would, with its own credential, and writes down
  // every answer it got.
  const fake = join(home, "fake-claude.mjs");
  writeFileSync(
    fake,
    `#!${process.execPath}
import { renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [first] = process.argv.slice(2);
if (first === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (first === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
let input = "";
process.stdin.on("data", (c) => (input += c));
((go) => { let line = ""; const take = (c) => { line += c; while (line.includes(String.fromCharCode(10))) { const at = line.indexOf(String.fromCharCode(10)); const next = line.slice(0, at); line = line.slice(at + 1); if (!next.trim() || JSON.parse(next).type !== "user") continue; input = next; process.stdin.off("data", take); go(); return; } }; process.stdin.on("data", take); })(async () => {
  if (input.includes("REVISE")) {
    const auth = { authorization: "Bearer " + process.env.BLOKS_TOKEN, "content-type": "application/json" };
    const call = async (method, path, body) => {
      const res = await fetch(process.env.BLOKS_URL + path, { method, headers: auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const said = {};
    said.read = await call("GET", "/api/skills/release-notes");
    const at = said.read.body.skill.revision;
    said.history = await call("GET", "/api/skills/release-notes/history");
    said.old = await call("GET", "/api/skills/release-notes?version=1");
    said.stale = await call("POST", "/api/skills/release-notes/revisions", { from: at - 1, why: "An older reading", body: "Something else" });
    // the command line, with the new text piped in
    const cli = spawnSync(process.execPath, [${JSON.stringify(CLI)}, "skill", "revise", "release-notes", "--from", String(at), "--why", "Put the version first"], {
      env: { ...process.env }, input: "Put the version at the top.\\n\\n" + said.read.body.skill.body, encoding: "utf8",
    });
    said.cli = { status: cli.status, body: JSON.parse(cli.stdout || "{}") };
    const staged = said.cli.body.proposal?.id ?? "none";
    said.keep = await call("POST", "/api/skills/proposals/" + staged, {});
    said.restore = await call("POST", "/api/skills/release-notes/restore", { revision: 1 });
    said.edit = await call("PUT", "/api/skills/release-notes", { body: "mine now" });
    said.fork = await call("POST", "/api/skills/daily-brief/fork", {});
    said.install = await call("POST", "/api/skills/registry/revisions", { from: 0, why: "x", body: "y" });
    said.keepShaped = await call("POST", "/api/skills/proposals/revisions", { from: 0, why: "x", body: "y" });
    said.after = await call("GET", "/api/skills/release-notes");
    writeFileSync(${JSON.stringify(out())} + ".tmp", JSON.stringify(said));
    renameSync(${JSON.stringify(out())} + ".tmp", ${JSON.stringify(out())});
  }
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done" }));
});
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli: fake } } } }),
  );

  // and an engine of our own for the learning loop: a turn is answered,
  // and a review is answered with whatever the test set
  const engine = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const parsed = JSON.parse(raw || "{}");
    const prompt = String(parsed.messages?.[parsed.messages.length - 1]?.content ?? "");
    if (parsed.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Here is the note, with the details you asked for. ".repeat(6) }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    asked.push(prompt);
    const content = /An agent followed a skill called/.test(prompt)
      ? answers.revision
      : /taught a procedure worth writing down/.test(prompt)
        ? answers.review
        : "NOTES: nothing.";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
  await new Promise<void>((r) => engine.listen(0, "127.0.0.1", () => r()));
  closeEngine = () => engine.close();

  h = await startHarness({ HOME: home });
  const connected = await h.fetch("/api/providers/ollama/connect", {
    method: "POST",
    body: JSON.stringify({ url: `http://127.0.0.1:${(engine.address() as { port: number }).port}/v1` }),
  });
  assert.equal(connected.status, 200, "the stand-in engine did not register");
});

after(async () => {
  await h?.stop();
  closeEngine();
  rmSync(home, { recursive: true, force: true });
});

const put = (path: string, body: object) => h.fetch(path, { method: "PUT", body: JSON.stringify(body) });
const post = (path: string, body: object = {}) => h.fetch(path, { method: "POST", body: JSON.stringify(body) });
const notesFile = () => readFileSync(join(skillsDir, "release-notes.md"), "utf8");
const notes = async () => (await h.json("/api/skills/release-notes")).skill;

describe("a skill written before versions", () => {
  test("is version 1, word for word, by nobody but how it stood", async () => {
    const { skills } = await h.json("/api/skills");
    const found = skills.find((s: any) => s.id === "release-notes");
    assert.equal(found.revision, 1);
    assert.equal(found.uses, 0);
    const history = await h.json("/api/skills/release-notes/history");
    assert.equal(history.current, 1);
    assert.equal(history.revisions.length, 1);
    assert.equal(history.revisions[0].by.kind, "migration");
    const first = (await h.json("/api/skills/release-notes/history/1")).revision;
    assert.equal(first.body, NOTES_V1, "the migration changed the text");
    assert.equal(first.name, "Release notes");
  });
});

describe("versions", () => {
  test("an edit is the next version, and one made from an old version is refused", async () => {
    const saved = await (await put("/api/skills/release-notes", { body: `Put the version at the top.\n\n${NOTES_V1}`, why: "Version first", from: 1 })).json();
    assert.equal(saved.skill.revision, 2);
    const late = await put("/api/skills/release-notes", { body: "Somebody else's edit", from: 1 });
    assert.equal(late.status, 409);
    const refusal = await late.json();
    assert.equal(refusal.current, 2);
    assert.match(refusal.error, /version 2/);
    assert.match(notesFile(), /Put the version at the top/, "the refused edit was written anyway");
    assert.doesNotMatch(notesFile(), /Somebody else/);
  });

  test("any version can be read, and two compared", async () => {
    const old = (await h.json("/api/skills/release-notes?version=1")).skill;
    assert.equal(old.revision, 1);
    assert.equal(old.current, 2);
    assert.equal(old.body, NOTES_V1);
    const diff = await h.json("/api/skills/release-notes/diff");
    assert.deepEqual([diff.from, diff.to], [1, 2]);
    assert.ok(diff.lines.some((l: any) => l.kind === "add" && /version at the top/.test(l.text)));
    const both = await h.json("/api/skills/release-notes/diff?from=2&to=1");
    assert.ok(both.lines.some((l: any) => l.kind === "del" && /version at the top/.test(l.text)));
    assert.equal((await h.fetch("/api/skills/release-notes?version=9")).status, 404);
    assert.equal((await h.fetch("/api/skills/release-notes/diff?from=x")).status, 400);
  });

  test("restoring is a new version, so nothing is lost", async () => {
    const restored = await (await post("/api/skills/release-notes/restore", { revision: 1, from: 2 })).json();
    assert.equal(restored.skill.revision, 3);
    assert.equal((await notes()).body, NOTES_V1);
    const history = await h.json("/api/skills/release-notes/history");
    assert.deepEqual(history.revisions.map((r: any) => r.n), [3, 2, 1]);
    assert.equal(history.revisions[0].restoredFrom, 1);
    assert.match(history.revisions[1].why, /Version first/, "what it replaced is still there");
    const again = await post("/api/skills/release-notes/restore", { revision: 1 });
    assert.equal(again.status, 400, "restoring what it already says is not a change");
  });

  test("a hand edit in a text editor is kept as its own version", async () => {
    writeFileSync(join(skillsDir, "release-notes.md"), notesFile().replace("Sign it off", "Always sign it off"));
    const history = await h.json("/api/skills/release-notes/history");
    assert.equal(history.current, 4);
    assert.equal(history.revisions[0].by.kind, "file");
    assert.equal((await h.json("/api/skills/release-notes/history/3")).revision.body, NOTES_V1, "the version before the hand edit is intact");
  });

  test("a built-in stays as it ships; making it yours starts its versions from that text", async () => {
    const shipped = await h.json("/api/skills/daily-brief/history");
    assert.equal(shipped.builtin, true);
    assert.equal(shipped.current, 0);
    const made = await post("/api/skills/daily-brief/fork");
    assert.equal(made.status, 201);
    const mine = await h.json("/api/skills/daily-brief/history");
    assert.equal(mine.builtin, false);
    assert.equal(mine.shipped, true);
    assert.equal(mine.revisions[0].by.kind, "builtin");
    assert.equal((await post("/api/skills/daily-brief/fork")).status, 409, "it is already yours");
    const edited = await (await put("/api/skills/daily-brief", { body: "Mine.", from: 1 })).json();
    assert.equal(edited.skill.revision, 2);
    const fromShipped = await h.json("/api/skills/daily-brief/diff?from=0&to=2");
    assert.ok(fromShipped.lines.some((l: any) => l.kind === "add" && l.text === "Mine."));
    // removing your copy brings the built-in back
    await h.fetch("/api/skills/daily-brief", { method: "DELETE" });
    const back = (await h.json("/api/skills")).skills.find((s: any) => s.id === "daily-brief");
    assert.equal(back.source, "builtin");
    assert.equal(back.revision, 0);
  });
});

describe("asking for a change", () => {
  test("is staged against the version read, never applied, and refused once that version has moved on", async () => {
    const before = await notes();
    const stale = await post("/api/skills/release-notes/revisions", { from: before.revision - 1, why: "x", body: "y" });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).current, before.revision);
    assert.equal((await post("/api/skills/release-notes/revisions", { from: before.revision, body: "y" })).status, 400, "no reason");
    assert.equal((await post("/api/skills/release-notes/revisions", { from: before.revision, why: "x", body: before.body })).status, 400, "no change");

    const staged = await post("/api/skills/release-notes/revisions", {
      from: before.revision,
      why: "Number the sections",
      body: `1. ${before.body}`,
      via: "mcp",
    });
    assert.equal(staged.status, 202);
    const { proposal } = await staged.json();
    assert.equal((await notes()).body, before.body, "asking changed the skill");

    // somebody else's change lands first
    await put("/api/skills/release-notes", { body: `${before.body}\n\nKeep it under 200 words.`, from: before.revision, why: "Shorter" });
    const shown = (await h.json("/api/skills/proposals")).proposals.find((p: any) => p.id === proposal.id);
    assert.equal(shown.whole, true);
    assert.equal(shown.base, before.revision);
    assert.equal(shown.current, before.revision + 1);
    assert.equal(shown.movedOn, true);
    assert.equal(shown.botName, "An app over MCP");

    // kept as it is, it would undo that change, so it is refused
    const keep = await post(`/api/skills/proposals/${proposal.id}`, {});
    assert.equal(keep.status, 409);
    assert.match((await keep.json()).error, /undo/);
    assert.match((await notes()).body, /under 200 words/);

    // the person may still keep their own edit of it
    const mine = await post(`/api/skills/proposals/${proposal.id}`, { body: `1. ${before.body}\n\nKeep it under 200 words.`, from: before.revision + 1 });
    assert.equal(mine.status, 200);
    const history = await h.json("/api/skills/release-notes/history");
    assert.equal(history.revisions[0].by.kind, "agent");
    assert.equal(history.revisions[0].why, "Number the sections");
  });

  test("an agent asks with its own credential, and may do nothing else to a skill", async () => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Scribe" }) });
    await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
    const before = await notes();
    rmSync(out(), { force: true });
    await post(`/api/bots/${bot.id}/messages`, { text: "REVISE" });
    const said = await waitFor(async () => (existsSync(out()) ? JSON.parse(readFileSync(out(), "utf8")) : null), 30_000);
    assert.ok(said, "the agent's turn never ran");

    assert.equal(said.read.status, 200);
    assert.equal(said.read.body.skill.revision, before.revision);
    assert.equal(said.history.status, 200);
    assert.equal(said.old.status, 200);
    assert.equal(said.stale.status, 409, "a revision against an old version was taken");
    assert.equal(said.cli.status, 0, JSON.stringify(said.cli.body));
    assert.equal(said.cli.body.staged, true);
    for (const key of ["keep", "restore", "edit", "fork", "install", "keepShaped"]) {
      assert.equal(said[key].status, 403, `an agent could ${key}: ${JSON.stringify(said[key].body)}`);
    }
    assert.equal(said.after.body.skill.body, before.body, "the agent changed the skill");
    assert.equal(said.after.body.skill.revision, before.revision);

    const staged = (await h.json("/api/skills/proposals")).proposals.find((p: any) => p.id === said.cli.body.proposal.id);
    assert.equal(staged.by, "agent");
    assert.equal(staged.botName, "Scribe");
    assert.equal(staged.because, "Put the version first");
    assert.ok(staged.diff.some((l: any) => l.kind === "add" && /version at the top/.test(l.text)));
    // reading it in full in a turn is a use
    const counted = (await h.json("/api/skills")).skills.find((s: any) => s.id === "release-notes");
    assert.ok(counted.uses >= 1, "reading the skill in a turn was not counted");
    await h.fetch(`/api/skills/proposals/${staged.id}`, { method: "DELETE" });
    await h.fetch(`/api/bots/${bot.id}?forget=1`, { method: "DELETE" });
  });

  test("the command line says what it needs before it asks", () => {
    const run = (args: string[]) =>
      spawnSync(process.execPath, [CLI, "skill", ...args], { env: { HOME: home, BLOKS_URL: "http://127.0.0.1:9", BLOKS_TOKEN: "blk_x" }, input: "", encoding: "utf8" });
    assert.match(JSON.parse(run(["revise", "notes", "--why", "x"]).stdout).error, /--from/);
    assert.match(JSON.parse(run(["revise", "notes", "--from", "2"]).stdout).error, /--why/);
    assert.match(JSON.parse(run(["revise", "notes", "--from", "2", "--why", "x"]).stdout).error, /new text/);
    assert.match(JSON.parse(run(["notes", "--version", "two"]).stdout).error, /--version is a number/);
  });
});

describe("learning from a turn", () => {
  let agent = "";
  before(async () => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Writer" }) });
    agent = bot.id;
    const { instances } = await h.json("/api/instances");
    const stand = instances.find((i: any) => i.instanceId === "ollama");
    assert.ok(stand, "the stand-in engine never appeared");
    await h.fetch(`/api/bots/${agent}`, {
      method: "PATCH",
      body: JSON.stringify({ modelSelection: { instanceId: "ollama", model: stand.models.default }, skillIds: ["release-notes"] }),
    });
  });
  const say = async (text: string) => {
    await post(`/api/bots/${agent}/messages`, { text });
    await waitFor(async () => {
      const { bots } = await h.json("/api/bots");
      const found = bots.find((b: any) => b.id === agent);
      return found && !found.tasks.some((t: any) => t.state === "working") ? found : null;
    }, 15_000);
    // the review runs after the turn, in the background
    await new Promise((r) => setTimeout(r, 400));
  };

  test("is off by default, and nothing is read back while it is", async () => {
    const config = await h.json("/api/config");
    assert.equal(config.skills.learn, "off");
    assert.equal(config.skills.propose, false);
    const before = asked.length;
    await say("/release-notes draft the note for 0.2");
    await say("no, the version goes at the top");
    assert.equal(asked.filter((p) => /taught a procedure|followed a skill/.test(p)).length, 0, "a review spent a call while it was off");
    assert.ok(asked.length >= before);
    // but the use and the correction were counted, which costs nothing
    const counted = (await h.json("/api/skills")).skills.find((s: any) => s.id === "release-notes");
    assert.ok(counted.uses >= 2);
    assert.ok(counted.corrected >= 1, "a correction after the skill was used was not counted");
  });

  test("the setting has three answers and keeps the old switch in step", async () => {
    await put("/api/config", { skills: { learn: "more" } });
    let config = await h.json("/api/config");
    assert.deepEqual(config.skills, { propose: true, learn: "more" });
    await put("/api/config", { skills: { propose: false } });
    config = await h.json("/api/config");
    assert.deepEqual(config.skills, { propose: false, learn: "off" });
    await put("/api/config", { skills: { learn: "suggest" } });
    assert.deepEqual((await h.json("/api/config")).skills, { propose: true, learn: "suggest" });
  });

  test("a skill that was used and then corrected gets a revision, shown as a diff, and stays as it was", async () => {
    answers.revision = [
      "WHY: the version kept ending up at the bottom",
      "LESSON: put the version at the top",
      "<<<FIND",
      "Lead with what broke.",
      "===",
      "Put the version at the top.\n\nLead with what broke.",
      ">>>",
    ].join("\n");
    const before = await notes();
    const versions = (await h.json("/api/skills/release-notes/history")).revisions.length;
    await say("/release-notes draft the note for 0.3");
    await say("no, I said the version goes at the top");
    const staged = await waitFor(async () => {
      const { proposals } = await h.json("/api/skills/proposals");
      return proposals.find((p: any) => p.skillId === "release-notes" && p.trigger === "correction");
    });
    assert.ok(staged, "no revision was suggested after the skill was corrected");
    assert.equal(staged.kind, "patch");
    assert.equal(staged.by, "review");
    assert.equal(staged.base, before.revision);
    assert.equal(staged.because, "the version kept ending up at the bottom");
    assert.ok(staged.diff.some((l: any) => l.kind === "add" && /version at the top/.test(l.text)));
    // never silent: the skill and its versions are exactly as they were
    const after = await notes();
    assert.equal(after.body, before.body);
    assert.equal(after.revision, before.revision);
    assert.equal((await h.json("/api/skills/release-notes/history")).revisions.length, versions);
    assert.ok(asked.some((p) => /An agent followed a skill called "Release notes"/.test(p) && p.includes(before.body)));

    // keeping it is the person's, and makes the next version, credited
    const kept = await (await post(`/api/skills/proposals/${staged.id}`, { from: staged.current })).json();
    assert.equal(kept.skill.revision, before.revision + 1);
    const top = (await h.json("/api/skills/release-notes/history")).revisions[0];
    assert.equal(top.by.kind, "proposal");
    assert.equal(top.by.name, "Writer");
  });

  test("a turn the person corrected, with no skill used, can suggest a new one", async () => {
    answers.review = ["SKILL: Changelog order", "WHEN: writing a changelog", "WHY: they corrected the order", "---", "1. Breaking changes first.\n2. Then the rest."].join("\n");
    await h.fetch(`/api/bots/${agent}`, { method: "PATCH", body: JSON.stringify({ skillIds: [] }) });
    const lane = (await h.json(`/api/bots/${agent}/tasks`, { method: "POST", body: JSON.stringify({ title: "Changelog" }) })).bot.activeTaskId;
    const sayIn = async (text: string) => {
      await post(`/api/bots/${agent}/messages`, { text, taskId: lane });
      await waitFor(async () => {
        const { bots } = await h.json("/api/bots");
        const found = bots.find((b: any) => b.id === agent);
        return found && !found.tasks.some((t: any) => t.state === "working") ? found : null;
      }, 15_000);
    };
    await sayIn(`write the changelog for 0.4 ${"with every detail of what changed ".repeat(10)}`);
    await sayIn("no, breaking changes always go first");
    const staged = await waitFor(async () => {
      const { proposals } = await h.json("/api/skills/proposals");
      return proposals.find((p: any) => p.name === "Changelog order");
    });
    assert.ok(staged, "a corrected turn suggested nothing");
    assert.equal(staged.kind, "new");
    assert.equal(staged.trigger, "correction");
    assert.ok(!(await h.json("/api/skills")).skills.some((s: any) => s.name === "Changelog order"), "a suggestion installed itself");
    await h.fetch(`/api/skills/proposals/${staged.id}`, { method: "DELETE" });
    await put("/api/config", { skills: { learn: "off" } });
  });
});
