// The paired devices list (src/lib/deviceLabels.ts): two phones that both
// call themselves "iPhone" can be told apart from what is known about
// them, and a number is the last resort, not the first.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deviceLabels, seenLabel } from "../src/lib/deviceLabels.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const now = at(21, 12);

test("a lone device says when it paired, when it was seen and what it runs", () => {
  const labels = deviceLabels([{ id: "a", name: "iPhone", pairedAt: at(17, 9), lastSeen: now - 4 * 60_000, client: "iOS 3.0 (12)" }], now, "en-US");
  assert.deepEqual(labels.get("a"), { name: "iPhone", detail: "Paired Oct 17 · Seen 4 min ago · iOS 3.0 (12)" });
});

test("two of a name paired on different days are told apart by the day alone", () => {
  const labels = deviceLabels(
    [
      { id: "a", name: "iPhone", pairedAt: at(17, 9) },
      { id: "b", name: "iPhone", pairedAt: at(19, 9) },
    ],
    now,
    "en-US",
  );
  assert.equal(labels.get("a")!.name, "iPhone");
  assert.equal(labels.get("b")!.name, "iPhone");
  assert.equal(labels.get("a")!.detail, "Paired Oct 17");
  assert.equal(labels.get("b")!.detail, "Paired Oct 19");
});

test("two of a name paired the same day get the time, and still no number", () => {
  const labels = deviceLabels(
    [
      { id: "a", name: "iPhone", pairedAt: at(17, 9, 41) },
      { id: "b", name: "iPhone", pairedAt: at(17, 12, 41) },
    ],
    now,
    "en-US",
  );
  assert.equal(labels.get("a")!.name, "iPhone");
  assert.equal(labels.get("b")!.name, "iPhone");
  assert.match(labels.get("a")!.detail, /^Paired Oct 17, 9:41/);
  assert.match(labels.get("b")!.detail, /^Paired Oct 17, 12:41/);
});

test("only when nothing else differs is a number added, in pairing order", () => {
  const labels = deviceLabels(
    [
      { id: "late", name: "iPhone", pairedAt: at(17, 9, 41) + 20_000 },
      { id: "early", name: "iPhone", pairedAt: at(17, 9, 41) },
      { id: "pad", name: "iPad", pairedAt: at(17, 9, 41) },
    ],
    now,
    "en-US",
  );
  assert.equal(labels.get("early")!.name, "iPhone");
  assert.equal(labels.get("late")!.name, "iPhone 2");
  assert.equal(labels.get("pad")!.name, "iPad", "a different name is told apart already");
});

test("seen reads as minutes, hours, then a date", () => {
  assert.equal(seenLabel(now - 10_000, now, "en-US"), "Seen just now");
  assert.equal(seenLabel(now - 59 * 60_000, now, "en-US"), "Seen 59 min ago");
  assert.equal(seenLabel(now - 3 * 3_600_000, now, "en-US"), "Seen 3 h ago");
  assert.equal(seenLabel(at(15, 8), now, "en-US"), "Seen Oct 15");
});
