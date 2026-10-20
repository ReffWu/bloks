// The Usage page in words (src/lib/usagePage.ts): how a figure is
// written, what the line under the headline admits to, how the span
// before is compared, and what the page remembers between visits.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_VIEW,
  axisMoney,
  deltaLine,
  figure,
  headlineNotes,
  money,
  niceTicks,
  readView,
  saveView,
  shareText,
  sortRows,
  topsUpLine,
  valueOf,
  type UsageTotals,
} from "../src/lib/usagePage.ts";

const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({ turns: 0, input: 0, output: 0, cost: 0, unmeasured: 0, ...over });

test("dollars are written as a bill writes them, and a sliver is never $0.00", () => {
  assert.equal(money(0), "$0.00");
  assert.equal(money(0.004), "under $0.01");
  assert.equal(money(12.4), "$12.40");
  assert.equal(money(1204.183), "$1,204.18");
  assert.equal(axisMoney(0), "$0");
  assert.equal(axisMoney(0.25), "$0.25");
  assert.equal(axisMoney(2.5), "$2.5");
  assert.equal(axisMoney(40), "$40");
  assert.equal(figure(1_250_000, "tokens"), "1.3M");
  assert.equal(figure(1234, "turns"), "1,234");
});

test("each metric reads its own number from a tally", () => {
  const t = totals({ turns: 3, input: 100, output: 20, cost: 0.5 });
  assert.deepEqual([valueOf(t, "cost"), valueOf(t, "tokens"), valueOf(t, "turns")], [0.5, 120, 3]);
});

test("the line under the headline says what the figure leaves out", () => {
  const report = { total: totals({ turns: 40, unmeasured: 2 }), unpricedTurns: 12, bloksAiTurns: 5, priced: true };
  assert.deepEqual(headlineNotes(report, "cost"), [
    "40 turns",
    "estimate from what engines report",
    "USD",
    "12 turns with no price reported",
    "5 turns on Bloks AI, never priced",
    "2 turns unmeasured",
  ]);
  // tokens and turns are counted for everyone, Bloks AI included
  assert.deepEqual(headlineNotes(report, "tokens"), ["40 turns", "2 turns unmeasured"]);
  assert.deepEqual(headlineNotes({ ...report, total: totals({ turns: 1 }) }, "turns"), ["1 turn"]);
});

test("against the span before: more, less, about the same, and nothing from nothing", () => {
  assert.deepEqual(deltaLine(12, 10, 30), { text: "20% more than the 30 days before", direction: "up" });
  assert.deepEqual(deltaLine(5, 10, 7), { text: "50% less than the 7 days before", direction: "down" });
  assert.deepEqual(deltaLine(10.02, 10, 7), { text: "About the same as the 7 days before", direction: "flat" });
  assert.deepEqual(deltaLine(250, 10, 1), { text: "25 times the 1 day before", direction: "up" });
  assert.equal(deltaLine(10, 0, 7), null, "growth from nothing is no percent");
});

test("shares, ticks and the tops-up date", () => {
  assert.equal(shareText(1, 3), "33%");
  assert.equal(shareText(1, 500), "under 1%");
  assert.equal(shareText(0, 0), "0%");
  assert.deepEqual(niceTicks(0), [0]);
  assert.deepEqual(niceTicks(7.3), [0, 2.5, 5, 7.5]);
  assert.deepEqual(niceTicks(1_200_000), [0, 500_000, 1_000_000, 1_500_000]);
  assert.equal(topsUpLine(new Date(2026, 10, 1).getTime(), "en-US"), "Tops up Nov 1");
});

test("rows sort by the header asked for, busiest first on a tie", () => {
  const rows = [
    { ...totals({ cost: 1, input: 10 }), name: "b" },
    { ...totals({ cost: 3, input: 5 }), name: "A" },
    { ...totals({ cost: 1, input: 50 }), name: "c" },
  ];
  assert.deepEqual(sortRows(rows, "value", true, "cost", (r) => r.name).map((r) => r.name), ["A", "c", "b"]);
  assert.deepEqual(sortRows(rows, "name", false, "cost", (r) => r.name).map((r) => r.name), ["A", "b", "c"]);
  assert.deepEqual(sortRows(rows, "tokens", true, "cost", (r) => r.name).map((r) => r.name), ["c", "b", "A"]);
});

test("the page's choices are kept on this device, and a damaged one falls back", () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  assert.deepEqual(readView(storage), DEFAULT_VIEW);
  saveView({ range: "month", metric: "tokens", bot: "ada", engine: null, tab: "engine" }, storage);
  assert.deepEqual(readView(storage), { range: "month", metric: "tokens", bot: "ada", engine: null, tab: "engine" });
  kept.set("bloks-usage-view", JSON.stringify({ range: "year", metric: 4, bot: "", tab: "week" }));
  assert.deepEqual(readView(storage), DEFAULT_VIEW);
  kept.set("bloks-usage-view", "{not json");
  assert.deepEqual(readView(storage), DEFAULT_VIEW);
  assert.deepEqual(readView(null), DEFAULT_VIEW, "no storage at all is the default");
});
