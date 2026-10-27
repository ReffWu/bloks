// `bloks-server run`: a task given to an agent from a script, followed to
// its answer through every teammate it handed work to (server/runs.ts,
// server/scripting-cli.ts). One test per ending, each with the exit code
// a script branches on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cli, scriptingWorkspace } from "./helpers/scripting.ts";
import { agentOn, fakeProvider, waitFor } from "./helpers/turns.ts";

test("a plain task: the reply on stdout, progress on stderr, exit 0", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  await hire("Ada");
  const ran = await cli(h, ["run", "Ada", "PLAIN please"]);
  assert.equal(ran.code, 0, ran.err);
  assert.equal(ran.out, "PLAIN-REPLY\n");
  assert.match(ran.err, /Asked Ada in "General"/);
  assert.match(ran.err, /Ada is working/);
  assert.match(ran.err, /Done in/);
});

test("--json is one document with the reply, the conversation, turns, cost, tokens and duration", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  await hire("Ada");
  const ran = await cli(h, ["run", "ada", "PLAIN please", "--json", "--conversation", "nightly"]);
  assert.equal(ran.code, 0, ran.err);
  const doc = JSON.parse(ran.out);
  assert.equal(doc.status, "done");
  assert.equal(doc.exitCode, 0);
  assert.equal(doc.reply, "PLAIN-REPLY");
  assert.equal(doc.agent, "Ada");
  // a conversation named by a script is made once, then found by its name
  assert.equal(doc.conversation.title, "nightly");
  assert.equal(doc.turns, 1);
  assert.equal(typeof doc.duration, "number");
  assert.ok(doc.tokens.input >= 0 && doc.tokens.output >= 0);
  assert.ok(doc.cost === null || doc.cost >= 0);
  const again = JSON.parse((await cli(h, ["run", "Ada", "PLAIN again", "--json", "--conversation", "Nightly"])).out);
  assert.equal(again.conversation.id, doc.conversation.id, "the named conversation was made twice");
});

test("a handoff: the run waits for the teammate and the report back, and prints the final answer", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  const ada = await hire("Ada");
  const ivy = await hire("Ivy");
  // Before runs, the first turn's end ("Asked for help") was the answer,
  // printed while Ivy was still working.
  const ran = await cli(h, ["run", "Ada", `HANDOFF ${ivy.id} ${ada.id}`, "--json"]);
  assert.equal(ran.code, 0, ran.err);
  const doc = JSON.parse(ran.out);
  assert.equal(doc.reply, "FINAL-ANSWER");
  assert.equal(doc.turns, 3);
  assert.deepEqual([...doc.agents].sort(), ["Ada", "Ivy"]);
  assert.match(ran.err, /handed work to Ivy/);
});

test("a failed turn exits 1 with why", async (t) => {
  const { h, hire } = await scriptingWorkspace(t, { BLOKS_RETRY_WAIT_MS: "1" });
  await hire("Ada");
  const ran = await cli(h, ["run", "Ada", "FAIL now", "--json"]);
  assert.equal(ran.code, 1, ran.err);
  const doc = JSON.parse(ran.out);
  assert.equal(doc.status, "failed");
  assert.ok(doc.error, "a failed run says why");
});

test("--timeout exits 3 and stops the work, which would otherwise run on unwatched", async (t) => {
  const { h, hire, home } = await scriptingWorkspace(t);
  const ada = await hire("Ada");
  const running = cli(h, ["run", "Ada", "SLOW work", "--timeout", "4s", "--json"]);
  // an agent's own credential never starts, reads or stops a run: a run
  // speaks as the person
  const token = await waitFor(() => (existsSync(join(home, "agent-token")) ? readFileSync(join(home, "agent-token"), "utf8") : null));
  assert.ok(token);
  for (const [method, path] of [["POST", "/api/runs"], ["POST", "/api/teams/apply"]] as const) {
    const res = await h.fetch(path, { method, headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ agent: "Ada", text: "PLAIN" }) });
    assert.equal(res.status, 403, `${method} ${path} answered an agent`);
  }
  const ran = await running;
  assert.equal(ran.code, 3, ran.err);
  assert.equal(JSON.parse(ran.out).status, "timed-out");
  assert.ok(
    await waitFor(async () => {
      const { bots } = await h.json("/api/bots?messages=0");
      return bots.find((b: any) => b.id === ada.id)?.busy ? null : true;
    }),
    "the turn was left running after the timeout",
  );
});

test("an open card exits 4 with the request shown, and is left for the person, never answered", async (t) => {
  const { h } = await scriptingWorkspace(t);
  const provider = await fakeProvider(t);
  provider.state.answerAtOnce = true;
  provider.state.askOn = "ASKME";
  await agentOn(h, provider.port, "Sam");
  const ran = await cli(h, ["run", "Sam", "ASKME first", "--approve", "never", "--json"]);
  assert.equal(ran.code, 4, ran.err);
  const doc = JSON.parse(ran.out);
  assert.equal(doc.status, "needs-you");
  assert.equal(doc.asks.length, 1);
  assert.match(ran.err, /\? Sam asks\. .*Ship it\?/);
  // still waiting in the app: a script never answers for the person
  const { bots } = await h.json("/api/bots?messages=0");
  assert.equal(bots.find((b: any) => b.name === "Sam").tasks[0].state, "needs-you");
});

test("an agent that is not there exits 5; a server that is not there exits 6", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  await hire("Ada");
  const missing = await cli(h, ["run", "Nobody", "PLAIN", "--json"]);
  assert.equal(missing.code, 5, missing.err);
  assert.equal(JSON.parse(missing.out).status, "agent-not-found");
  const away = await cli(h, ["run", "Ada", "PLAIN"], { env: { BLOKS_PORT: "1" } });
  assert.equal(away.code, 6);
  assert.match(away.err, /Bloks is not running/);
});

test("refused exits 7: inside an agent's turn, another computer without a token, an archived agent", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  const ada = await hire("Ada");
  // an agent's shell carries BLOKS_TOKEN; it does not get to be the owner
  const asAgent = await cli(h, ["run", "Ada", "PLAIN"], { env: { BLOKS_TOKEN: "blt_something" } });
  assert.equal(asAgent.code, 7);
  assert.match(asAgent.err, /agent's turn/);
  const remote = await cli(h, ["run", "Ada", "PLAIN", "--server", "http://192.168.1.20:8800"]);
  assert.equal(remote.code, 7);
  assert.match(remote.err, /BLOKS_SERVER_TOKEN/);
  // a token the server does not know is refused, not read as the owner
  const badToken = await cli(h, ["run", "Ada", "PLAIN", "--server", h.url], { env: { BLOKS_SERVER_TOKEN: "not-a-token" } });
  assert.equal(badToken.code, 7, badToken.err);
  // the person's archive, which keeps everything and can be undone
  assert.ok((await h.fetch(`/api/bots/${ada.id}`, { method: "DELETE" })).ok);
  const archived = await cli(h, ["run", "Ada", "PLAIN"]);
  assert.equal(archived.code, 7);
  assert.match(archived.err, /archived/);
  const usage = await cli(h, ["run", "Ada"]);
  assert.equal(usage.code, 2);
});

test("--export copies what the run made: files it changed, as the turn left them, and deliverables", async (t) => {
  const { h, hire, home } = await scriptingWorkspace(t);
  const ada = await hire("Ada");
  const dir = join(home, "exported");
  const ran = await cli(h, ["run", "Ada", `MAKEFILE ${ada.id}`, "--export", dir, "--json"]);
  assert.equal(ran.code, 0, ran.err);
  const doc = JSON.parse(ran.out);
  assert.ok(doc.files.some((f: any) => f.kind === "change" && f.path === "made/report.txt"), JSON.stringify(doc.files));
  assert.ok(doc.files.some((f: any) => f.kind === "artifact" && f.name === "summary.txt"), JSON.stringify(doc.files));
  assert.equal(readFileSync(join(dir, "made", "report.txt"), "utf8"), "the report\n");
  assert.equal(readFileSync(join(dir, "summary.txt"), "utf8"), "the summary\n");
  assert.deepEqual([...doc.exported].sort(), ["made/report.txt", "summary.txt"]);
});

test("--server with a paired device's token speaks as the owner; bloks-server token trades a pairing code for one", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  await hire("Ada");
  await h.json("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const { code } = await h.json("/api/pair/start", { method: "POST" });
  const traded = await cli(h, ["token", "--server", h.url, "--code", code, "--name", "CI runner"]);
  assert.equal(traded.code, 0, traded.err);
  const token = traded.out.trim();
  assert.ok(token.length > 20);
  // shown once, on stdout alone, so it can be piped straight into a secret
  assert.ok(!traded.err.includes(token));
  const ran = await cli(h, ["run", "Ada", "PLAIN please", "--server", h.url], { env: { BLOKS_SERVER_TOKEN: token } });
  assert.equal(ran.code, 0, ran.err);
  assert.equal(ran.out, "PLAIN-REPLY\n");
  const spent = await cli(h, ["token", "--server", h.url, "--code", code]);
  assert.equal(spent.code, 7, "a pairing code worked twice");
});
