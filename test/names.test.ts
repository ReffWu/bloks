// What people are called in a conversation (src/lib/names.ts): their
// first name, told apart by a last initial where two people in one
// workspace share it, and by the whole name where even that is shared.
// Names, never handles: nothing is numbered.
import { test } from "node:test";
import assert from "node:assert/strict";

import { distinctNames, firstName, namer, withInitial } from "../src/lib/names.ts";

const shown = (people: Array<[string, string]>) => Object.fromEntries(distinctNames(people.map(([id, name]) => ({ id, name }))));

test("a first name alone, while nobody else answers to it", () => {
  assert.deepEqual(shown([["owner", "Hamed Rahimi"], ["p1", "Sam Okafor"], ["p2", "Ana"]]), { owner: "Hamed", p1: "Sam", p2: "Ana" });
  assert.equal(firstName("  Ana   Lima "), "Ana");
  assert.equal(firstName("Ana"), "Ana");
});

test("two people with one first name: each gets the initial of their last", () => {
  assert.deepEqual(shown([["p1", "Sam Okafor"], ["p2", "Sam Kim"], ["p3", "Ana Lima"]]), { p1: "Sam O.", p2: "Sam K.", p3: "Ana" });
  // the owner is one of the people a name is told apart from
  assert.deepEqual(shown([["owner", "Sam Okafor"], ["p1", "Sam Kim"]]), { owner: "Sam O.", p1: "Sam K." });
  // the first name matches whatever its case
  assert.deepEqual(shown([["p1", "sam okafor"], ["p2", "Sam Kim"]]), { p1: "sam O.", p2: "Sam K." });
});

test("somebody with one name keeps it; the others are told apart from them", () => {
  assert.deepEqual(shown([["p1", "Sam"], ["p2", "Sam Kim"]]), { p1: "Sam", p2: "Sam K." });
});

test("initials that match too: the whole name", () => {
  assert.deepEqual(shown([["p1", "Sam Okafor"], ["p2", "Sam Olsen"], ["p3", "Sam Kim"]]), {
    p1: "Sam Okafor",
    p2: "Sam Olsen",
    p3: "Sam K.",
  });
});

test("the same name twice stays the same: a number would be a handle", () => {
  assert.deepEqual(shown([["p1", "Sam"], ["p2", "Sam"]]), { p1: "Sam", p2: "Sam" });
  assert.deepEqual(shown([["p1", "Sam Kim"], ["p2", "Sam Kim"]]), { p1: "Sam Kim", p2: "Sam Kim" });
});

test("the initial is a letter, in capitals, whatever the script", () => {
  assert.equal(withInitial("Zoë Åberg"), "Zoë Å.");
  assert.equal(withInitial("ana lima"), "ana L.");
  assert.equal(withInitial("Sam"), "Sam");
  // a middle name is not the last name
  assert.equal(withInitial("Sam J. Okafor"), "Sam O.");
});

test("one person listed twice is one person; an empty name is nobody", () => {
  assert.deepEqual(shown([["p1", "Sam Okafor"], ["p1", "Sam Okafor"], ["p2", "  "]]), { p1: "Sam" });
});

test("a namer answers by id, with a fallback for whoever is not in the set", () => {
  const name = namer([{ id: "p1", name: "Sam Okafor" }, { id: "p2", name: "Sam Kim" }]);
  assert.equal(name("p1"), "Sam O.");
  assert.equal(name("gone"), "Someone");
  assert.equal(name("gone", "A former member"), "A former member");
});
