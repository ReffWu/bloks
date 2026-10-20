// When a conversation is drawn as a group (src/lib/participants.ts): more
// than two people and agents. A chat with one agent stays as it was; a
// room, or a team conversation with another human on its list or
// speaking, draws every message as a bubble, runs grouped, with "Seen by"
// under where each other person has read to.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isGroup, otherHumans, receiptsAt, runs, seenLine, senderOf, speakers, teamHumans, type Said } from "../src/lib/participants.ts";

const at = (min: number) => 1_000_000 + min * 60_000;
const msg = (id: string, role: "user" | "bot", min: number, extra: Partial<Said> = {}): Said => ({ id, role, at: at(min), ...extra });

test("one person and one agent is not a group; a third voice makes one", () => {
  assert.equal(isGroup({ humans: new Set(["owner"]), agents: new Set(["a"]) }), false);
  assert.equal(isGroup({ humans: new Set(["owner", "p_sam"]), agents: new Set(["a"]) }), true);
  // a room: two agents and the owner already
  assert.equal(isGroup({ humans: new Set(["owner"]), agents: new Set(["a", "b"]) }), true);
  assert.equal(otherHumans({ humans: new Set(["owner", "p_sam"]), agents: new Set() }, "owner"), 1);
  assert.equal(otherHumans({ humans: new Set(["owner"]), agents: new Set(["a", "b"]) }, "owner"), 0, "nobody to show receipts to");
});

test("a team conversation's humans follow its access list, as the server's rule does", () => {
  const members = [
    { id: "p_sam", role: "member" as const },
    { id: "p_ana", role: "admin" as const },
    { id: "p_lee", role: "member" as const },
  ];
  assert.deepEqual([...teamHumans(undefined, members)].sort(), ["owner", "p_ana", "p_lee", "p_sam"]);
  assert.deepEqual([...teamHumans({ mode: "only", people: ["p_sam"] }, members)].sort(), ["owner", "p_ana", "p_sam"], "admins are in unless the owner says otherwise");
  assert.deepEqual([...teamHumans({ mode: "only", people: [], admins: false }, members)], ["owner"]);
  assert.deepEqual([...teamHumans({ mode: "except", people: ["p_lee"] }, members)].sort(), ["owner", "p_ana", "p_sam"]);
  // nobody else on the list: the owner and the agent, so not a group
  // until somebody else speaks there
  const only = teamHumans({ mode: "only", people: [], admins: false }, members);
  assert.equal(isGroup({ humans: only, agents: new Set(["chief"]) }), false);
  for (const id of speakers([msg("1", "user", 0, { author: "p_sam" })])) only.add(id);
  assert.equal(isGroup({ humans: only, agents: new Set(["chief"]) }), true);
});

test("who sent a message: the owner, a member, a Telegram person, or an agent", () => {
  assert.equal(senderOf(msg("1", "user", 0)), "owner");
  assert.equal(senderOf(msg("1", "user", 0, { author: "p_sam" })), "p_sam");
  assert.equal(senderOf(msg("1", "user", 0, { telegramPerson: { personId: "tg1" } })), "telegram:tg1");
  assert.equal(senderOf(msg("1", "bot", 0, { from: "b2" })), "agent:b2");
  assert.equal(senderOf(msg("1", "bot", 0), "chief"), "agent:chief");
});

test("runs: one sender's messages close together read as one, and anything else ends a run", () => {
  const list: Array<Said & { tool?: boolean }> = [
    msg("a", "user", 0, { author: "p_sam" }),
    msg("b", "user", 1, { author: "p_sam" }),
    msg("c", "user", 2, { author: "p_sam" }),
    msg("d", "user", 3),
    msg("e", "bot", 4, { from: "x" }),
    { ...msg("f", "bot", 4, { from: "x" }), tool: true },
    msg("g", "bot", 5, { from: "x" }),
    msg("h", "bot", 30, { from: "x" }),
  ];
  const r = runs(list, (m) => !m.tool);
  assert.deepEqual(r.get("a"), { first: true, last: false });
  assert.deepEqual(r.get("b"), { first: false, last: false });
  assert.deepEqual(r.get("c"), { first: false, last: true });
  assert.deepEqual(r.get("d"), { first: true, last: true });
  assert.deepEqual(r.get("e"), { first: true, last: true }, "a tool line between ends it");
  assert.equal(r.has("f"), false);
  assert.deepEqual(r.get("g"), { first: true, last: true }, "and so does a long pause");
  assert.deepEqual(r.get("h"), { first: true, last: true });
});

test("receipts: under the latest message drawn each other person read, never the reader's own", () => {
  const order = ["m1", "m2", "tool", "m3", "m4"];
  const anchors = new Set(["m1", "m2", "m3", "m4"]);
  const reads = [
    { personId: "p_sam", messageId: "m4", at: 5 },
    { personId: "p_ana", messageId: "tool", at: 4 },
    { personId: "owner", messageId: "m2", at: 3 },
    { personId: "p_gone", messageId: "deleted", at: 2 },
  ];
  const seen = receiptsAt(order, anchors, reads, "owner");
  assert.deepEqual(seen.get("m4"), ["p_sam"]);
  assert.deepEqual(seen.get("m2"), ["p_ana"], "a place on a tool line moves back to the message above it");
  assert.equal([...seen.values()].flat().includes("owner"), false, "the reader never sees their own");
  assert.equal(seen.size, 2, "a message no longer there carries nothing");
  assert.deepEqual(receiptsAt(order, anchors, reads, "p_sam").get("m2")?.sort(), ["owner", "p_ana"]);
  assert.equal(seenLine(["Sam", "Ana"]), "Seen by Sam, Ana");
});

test("receipts: nobody's place shows under their own message", () => {
  const order = ["m1", "m2"];
  const anchors = new Set(order);
  const senders = new Map([["m1", "agent:scout"], ["m2", "p_ana"]]);
  const reads = [
    { personId: "p_ana", messageId: "m2", at: 2 },
    { personId: "p_sam", messageId: "m2", at: 3 },
  ];
  const seen = receiptsAt(order, anchors, reads, "owner", senders);
  assert.deepEqual(seen.get("m2"), ["p_sam"], "Ana wrote m2, so her place there says nothing");
});
