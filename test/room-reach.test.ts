// Who a room's next message reaches, as the row under the box says it
// (src/components/room/reach.ts), read the way the server routes it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { namedIn, reachOf } from "../src/components/room/reach.ts";

const bo = { id: "bo", name: "Bo" };
const bobby = { id: "bobby", name: "Bobby Tables" };
const ada = { id: "ada", name: "Ada" };
const members = [ada, bo, bobby];

test("names count longest first, each used once, in room order", () => {
  assert.deepEqual(namedIn("ask @Bobby Tables about it", members), ["bobby"]);
  assert.deepEqual(namedIn("@bo and @ADA", members), ["ada", "bo"]);
  assert.deepEqual(namedIn("nobody here", members), []);
});

test("nobody named is everyone, or the lead in a lead-only room", () => {
  assert.deepEqual(reachOf("hi all", { members, lead: "ada", leadOnly: false }), { kind: "everyone" });
  assert.deepEqual(reachOf("hi all", { members, lead: "ada", leadOnly: true }), { kind: "lead", id: "ada" });
  assert.deepEqual(reachOf("@Bo can you", { members, lead: "ada", leadOnly: true }), { kind: "named", ids: ["bo"] });
});

test("in a shared room, naming only a person wakes no agent", () => {
  assert.deepEqual(reachOf("@Sam can you check?", { members, lead: "ada", leadOnly: false, people: ["Sam"] }), { kind: "people" });
  assert.deepEqual(reachOf("@Sam and @Ada", { members, lead: "ada", leadOnly: false, people: ["Sam"] }), {
    kind: "named",
    ids: ["ada"],
  });
});
