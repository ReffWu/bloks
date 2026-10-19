// What a busy room shows of itself (src/lib/roomVoices.ts): handoffs
// between members, a member's words as they arrive, and who is working.
import { test } from "node:test";
import assert from "node:assert/strict";

import { askIn, handoffsIn, namesLine, unsaid } from "../src/lib/roomVoices.ts";
import type { Message } from "../src/state/reducer.ts";

const ada = { id: "ada", name: "Ada" };
const ben = { id: "ben", name: "Ben" };
const cy = { id: "cy", name: "Cy" };
const members = [ada, ben, cy];

let n = 0;
const say = (from: string | null, text: string, extra: Partial<Message> = {}): Message =>
  ({
    id: `m${++n}`,
    at: n,
    role: from ? "bot" : "user",
    kind: "text",
    text,
    ...(from ? { from } : {}),
    ...extra,
  }) as Message;

test("the ask is the sentence that names them, without the names", () => {
  assert.equal(askIn("Plan is set. @Ben, can you draft the API? Thanks", ben, members), "can you draft the API?");
  assert.equal(askIn("@Ben and @Cy: write the tests.", ben, members), "write the tests.");
  assert.equal(askIn("First line\n@ben draft the **API**\nmore", ben, members), "draft the API");
  assert.equal(askIn("Over to you @Ben", ben, members), "Over to you");
  assert.equal(askIn("@Ben", ben, members), "");
  assert.equal(askIn("nobody named", ben, members), "");
});

test("a handoff lands at the named member's next message, as the server reads a mention", () => {
  const said = [
    say(null, "Ship the launch page"),
    say("ada", "Splitting it. @Ben draft the API. @cy write tests."),
    say("ben", "Drafting now", { kind: "activity" }),
    say("ben", "API drafted"),
    say("cy", "Tests written"),
  ];
  const { placed, pending } = handoffsIn(said, members);
  assert.deepEqual([...placed.keys()], [2, 4]);
  assert.deepEqual(placed.get(2)?.map((h) => [h.fromId, h.toId, h.ask, h.sourceId]), [["ada", "ben", "draft the API.", said[1].id]]);
  assert.equal(placed.get(4)?.[0].ask, "write tests.");
  assert.equal(pending.size, 0);
});

test("a member naming itself, your own words, and a taken back message hand nothing off", () => {
  const said = [
    say("ada", "@Ada will do it"),
    say(null, "@Ben what do you think?"),
    say("cy", "@Ben look", { deleted: true }),
    say("ben", "Looking"),
  ];
  const { placed, pending } = handoffsIn(said, members);
  assert.equal(placed.size, 0);
  assert.equal(pending.size, 0);
});

test("one still to answer is pending, and your next message ends the wait", () => {
  const named = [say("ada", "@Ben over to you, draft it")];
  assert.equal(handoffsIn(named, members).pending.get("ben")?.ask, "over to you, draft it");
  assert.equal(handoffsIn([...named, say(null, "Actually, stop")], members).pending.size, 0);
});

test("a stream shows only what the room does not have yet", () => {
  // nothing landed: all of it
  let step = unsaid("Looking at the", undefined, undefined);
  assert.equal(step.text, "Looking at the");
  // the first part lands, and the next has begun in the same stream
  const first = { id: "a1", text: "Looking at the schema now." };
  step = unsaid("Looking at the schema now.Found two tables", first, step.mark);
  assert.equal(step.text, "Found two tables");
  // and keeps growing from the same cut
  step = unsaid("Looking at the schema now.Found two tables to merge", first, step.mark);
  assert.equal(step.text, "Found two tables to merge");
  // the house style turned a dash into a comma: the stretch after it still matches
  const second = { id: "a2", text: "Found two tables to merge, users and accounts." };
  step = unsaid("Looking at the schema now.Found two tables to merge \u2014 users and accounts.", second, step.mark);
  assert.equal(step.text, "");
});

test("a room opened mid-turn finds the part it already has, and an older turn's words do not cut", () => {
  const landed = { id: "a1", text: "Here is the plan for today." };
  assert.equal(unsaid("Here is the plan for today. Next I will", landed, undefined).text, "Next I will");
  const old = { id: "a0", text: "Something from yesterday entirely." };
  assert.equal(unsaid("Fresh words", old, undefined).text, "Fresh words");
  // a part that cannot be found counts the whole stream as said
  const mark = unsaid("Fresh words", old, undefined).mark;
  assert.equal(unsaid("Fresh words and more", { id: "a2", text: "Rewritten entirely" }, mark).text, "");
  // a stream that started again is read from its start
  assert.equal(unsaid("New", old, { lastId: "a0", cut: 40 }).text, "New");
});

test("who is working, in one line", () => {
  assert.equal(namesLine(["Ada"]), "Ada");
  assert.equal(namesLine(["Ada", "Ben"]), "Ada and Ben");
  assert.equal(namesLine(["Ada", "Ben", "Cy"]), "Ada, Ben and Cy");
  assert.equal(namesLine(["Ada", "Ben", "Cy", "Dee"]), "Ada, Ben and 2 others");
});
