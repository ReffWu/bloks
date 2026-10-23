// The hours the Day and Week views of Automations draw (src/lib/dayGrid.ts).
//
// The grid began at six, and a routine set between midnight and five was
// left out of both views: scheduled, and nowhere on the screen.
//
// And two routines at the same time were drawn one over the other, so
// neither could be read (GitHub 361). Cards that overlap sit side by side.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DAY_END, DAY_START, cardLanes, gridHours, type CardSpan } from "../src/lib/dayGrid.ts";

const at = (hour: number, minute = 0) => hour * 60 + minute;

test("an ordinary day keeps its six to eleven grid", () => {
  assert.deepEqual(gridHours([]), { start: DAY_START, end: DAY_END });
  assert.deepEqual(gridHours([at(9), at(17, 30)]), { start: 6, end: 23 });
});

test("a routine before six opens the grid at its hour", () => {
  assert.equal(gridHours([at(3, 30), at(9)]).start, 3, "a 3:30 routine had no hour to sit in");
  assert.equal(gridHours([at(0, 0)]).start, 0, "a midnight routine had no hour to sit in");
  // five o'clock used to be squashed against the top of the six o'clock row
  assert.equal(gridHours([at(5, 45)]).start, 5);
});

test("a routine late at night gets the last hour drawn too", () => {
  assert.equal(gridHours([at(23, 15)]).end, 24);
  assert.equal(gridHours([at(22, 59)]).end, 23);
});

test("a time that is not one leaves the grid alone", () => {
  assert.deepEqual(gridHours([Number.NaN]), { start: 6, end: 23 });
});

// ── cards side by side ─────────────────────────────────────────────────

const card = (id: string, start: number, end: number): CardSpan => ({ id, start, end });
/** Each card's lane as "column/columns", by id, for a readable assert. */
const lanesOf = (cards: CardSpan[]) =>
  Object.fromEntries([...cardLanes(cards)].map(([id, lane]) => [id, `${lane.column}/${lane.columns}`]));

test("two routines at the same time split the width, each in its own column", () => {
  // the report: two jobs at 09:00, drawn at the same height
  assert.deepEqual(lanesOf([card("standup", at(9), at(9, 30)), card("digest", at(9), at(9, 30))]), {
    digest: "0/2",
    standup: "1/2",
  });
  assert.deepEqual(lanesOf([card("a", 0, 60), card("b", 0, 60), card("c", 0, 60)]), { a: "0/3", b: "1/3", c: "2/3" });
  // of two that start together, the longer takes the left
  assert.deepEqual(lanesOf([card("short", 0, 30), card("long", 0, 90)]), { long: "0/2", short: "1/2" });
});

test("a partial overlap is side by side too", () => {
  assert.deepEqual(lanesOf([card("a", at(9), at(10)), card("b", at(9, 30), at(10, 30))]), { a: "0/2", b: "1/2" });
});

test("a chain is one group, and a card takes the first column free when it starts", () => {
  // a overlaps b, b overlaps c, a ends before c starts: c goes back to a's column
  assert.deepEqual(lanesOf([card("a", 0, 60), card("b", 45, 105), card("c", 90, 150)]), { a: "0/2", b: "1/2", c: "0/2" });
  // a gap left by a short card is filled rather than a column added
  assert.deepEqual(lanesOf([card("long", 0, 120), card("early", 0, 30), card("later", 60, 90)]), {
    long: "0/2",
    early: "1/2",
    later: "1/2",
  });
});

test("cards that do not overlap keep the whole width", () => {
  assert.deepEqual(lanesOf([card("a", at(9), at(10)), card("b", at(11), at(12))]), { a: "0/1", b: "0/1" });
  // one that starts as another ends is not on top of it
  assert.deepEqual(lanesOf([card("a", 0, 60), card("b", 60, 120)]), { a: "0/1", b: "0/1" });
  // a crowded morning does not narrow the afternoon
  assert.deepEqual(lanesOf([card("a", 0, 60), card("b", 0, 60), card("c", 300, 360)]), { a: "0/2", b: "1/2", c: "0/1" });
  assert.equal(cardLanes([]).size, 0);
});

test("the lanes do not depend on the order the cards come in", () => {
  const cards = [card("a", 0, 60), card("b", 45, 105), card("c", 90, 150), card("d", 0, 60), card("e", 400, 430)];
  const expected = lanesOf(cards);
  assert.deepEqual(lanesOf([...cards].reverse()), expected);
  assert.deepEqual(lanesOf([cards[2], cards[4], cards[0], cards[3], cards[1]]), expected);
});

test("a card whose times are not numbers is left in a column of its own", () => {
  assert.deepEqual(lanesOf([card("odd", Number.NaN, Number.NaN), card("a", 0, 60), card("b", 0, 60)]), {
    odd: "0/1",
    a: "0/2",
    b: "1/2",
  });
});
