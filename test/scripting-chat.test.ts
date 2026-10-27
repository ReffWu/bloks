// `bloks-server chat` read line by line from a script, the way a pipe or
// an expect script drives it: each line is one message or command, each
// reply waits for the turn and its handoffs to be done, and a card is
// asked as a line and answered by the next (server/scripting-cli.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { chatScript, cli, scriptingWorkspace } from "./helpers/scripting.ts";
import { agentOn, fakeProvider } from "./helpers/turns.ts";
import { readAnswer, readArgs, readDuration, stepLine } from "../server/scripting-cli.ts";

test("a scripted chat: history, a reply with its tool step, /help, /model, /new and /exit", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  const ada = await hire("Ada");
  assert.equal((await cli(h, ["run", "Ada", "PLAIN earlier"])).code, 0);

  const ran = await chatScript(h, ["chat", "Ada"], [
    [/Type a message, or \/help\./, "/help"],
    [/\/exit +leave/, "PLAIN hi"],
    [/Ada: PLAIN-REPLY\n/, "/model"],
    [/Ada runs on .*\n/, "/new"],
    [/Your next message starts a new conversation\./, "PLAIN again"],
    [/Ada: PLAIN-REPLY\n/, "/exit"],
  ]);
  assert.equal(ran.code, 0, ran.err + ran.out);
  const lines = ran.out.split("\n");
  assert.equal(lines[0], 'Ada, in "General". Type a message, or /help.');
  // where the conversation stood, before the first line is read
  assert.ok(lines.includes("you: PLAIN earlier"), ran.out);
  assert.ok(lines.includes("  · Ada is working"), ran.out);
  assert.ok(lines.some((l) => l.startsWith("  · Ada: ") && l.includes("echo checking")), ran.out);
  assert.equal(lines.filter((l) => l === "Ada: PLAIN-REPLY").length, 3, ran.out);
  // /new went to a conversation of its own
  const { bots } = await h.json("/api/bots?messages=0");
  assert.equal(bots.find((b: any) => b.id === ada.id).tasks.length, 2);
});

test("a card is asked as a line and the next line answers it; a wrong answer is asked again", async (t) => {
  const { h } = await scriptingWorkspace(t);
  const provider = await fakeProvider(t);
  provider.state.answerAtOnce = true;
  provider.state.askOn = "ASKME";
  await agentOn(h, provider.port, "Sam");
  const ran = await chatScript(h, ["chat", "sam"], [
    [/Type a message/, "ASKME please"],
    [/\? Sam asks\. .*Ship it\?.*\[1\) Yes  2\) No\]\n/, "maybe"],
    [/That is not one of the choices\./, "1"],
    [/Sam: Done\.\n/, "<end>"],
  ]);
  assert.equal(ran.code, 0, ran.err + ran.out);
  // the answer went to the agent the way a tap in the app sends it
  assert.ok(provider.state.calls.some((c) => c.includes('"role":"tool"') && c.includes("Yes")), "the answer never reached the agent");
});

test("a handoff in chat: the reply waits for the teammate, whose steps show as they happen", async (t) => {
  const { h, hire } = await scriptingWorkspace(t);
  const ada = await hire("Ada");
  const ivy = await hire("Ivy");
  const ran = await chatScript(h, ["chat", "Ada"], [
    [/Type a message/, `HANDOFF ${ivy.id} ${ada.id}`],
    [/Ada: FINAL-ANSWER\n/, "/exit"],
  ]);
  assert.equal(ran.code, 0, ran.err + ran.out);
  const at = (text: string) => ran.out.indexOf(text);
  assert.ok(at("  · Ada handed work to Ivy") > 0, ran.out);
  assert.ok(at("Ivy: Helped.") > at("  · Ada handed work to Ivy"), ran.out);
  assert.ok(at("Ada: FINAL-ANSWER") > at("Ivy: Helped."), ran.out);
});

test("chat with an agent that is not there exits 5", async (t) => {
  const { h } = await scriptingWorkspace(t);
  const ran = await cli(h, ["chat", "Nobody"]);
  assert.equal(ran.code, 5);
  assert.match(ran.err, /no agent called "Nobody"/);
});

// ── the line protocol's pieces ──

test("flags, durations, answers and steps read the way the docs say", () => {
  assert.deepEqual(readArgs(["Ada", "do it", "--json", "--timeout", "5m", "--conversation=new"], ["timeout", "conversation"]), {
    words: ["Ada", "do it"],
    flags: { json: true, timeout: "5m", conversation: "new" },
  });
  assert.throws(() => readArgs(["--timeout"], ["timeout"]), /needs a value/);
  assert.equal(readDuration("90"), 90_000);
  assert.equal(readDuration("15m"), 900_000);
  assert.equal(readDuration("2h"), 7_200_000);
  assert.throws(() => readDuration("soon"));
  // an approval takes a yes or a no and nothing that only looks like one
  const approval = { approval: true, options: ["Allow", "Deny"] };
  assert.deepEqual(readAnswer(approval, "yes"), { behavior: "allow" });
  assert.deepEqual(readAnswer(approval, "Deny"), { behavior: "deny" });
  assert.equal(readAnswer(approval, "1"), null);
  assert.equal(readAnswer(approval, "sure, go on"), null);
  const question = { approval: false, options: ["Yes", "No"] };
  assert.deepEqual(readAnswer(question, "2"), { behavior: "answer", message: "No" });
  assert.deepEqual(readAnswer(question, "yes"), { behavior: "answer", message: "Yes" });
  assert.equal(readAnswer(question, "3"), null);
  assert.deepEqual(readAnswer({ approval: false, options: [] }, " in the morning "), { behavior: "answer", message: "in the morning" });
  assert.equal(stepLine({ kind: "tool", agent: "Ada", text: "Bash: ls" }), "  · Ada: Bash: ls");
  assert.equal(stepLine({ kind: "said", agent: "Ivy", text: "Done" }), "Ivy: Done");
  assert.equal(stepLine({ kind: "ended", agent: "Ada", text: "done" }), null);
});
