// A workspace's mark is how it is told apart at a glance in the switcher,
// so the promises are about telling apart: the two fixed marks are never
// handed to anything else, and no two workspaces on one computer wear
// the same one, however many there are.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUSINESS_MARK,
  CUSTOM_PATTERNS,
  MARK_PALETTE,
  PERSONAL_MARK,
  RESERVED_COLORS,
  RESERVED_PATTERNS,
  fixedMark,
  generateMark,
  isCustomMark,
  isCustomPattern,
  litCount,
  sameMark,
  type Mark,
} from "../electron/workspace-marks.mjs";
import { accentForMark, markCells } from "../src/lib/workspaceMark.ts";

/** A seeded random, so a failure can be replayed. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("the fixed marks are the agreed ones", () => {
  assert.deepEqual({ ...PERSONAL_MARK }, { color: "#E9A83A", pattern: "010111101" });
  assert.deepEqual({ ...BUSINESS_MARK }, { color: "#3E5BD9", pattern: "111101111" });
  assert.deepEqual(fixedMark("personal"), { ...PERSONAL_MARK });
  assert.deepEqual(fixedMark("business"), { ...BUSINESS_MARK });
  assert.equal(fixedMark("custom"), null);
});

test("the palette never holds amber or indigo, and patterns never the fixed two", () => {
  for (const reserved of RESERVED_COLORS) {
    assert.ok(!MARK_PALETTE.some((c) => c.toUpperCase() === reserved.toUpperCase()), `${reserved} is in the palette`);
  }
  for (const reserved of RESERVED_PATTERNS) assert.ok(!CUSTOM_PATTERNS.includes(reserved));
  assert.equal(isCustomMark(PERSONAL_MARK), false);
  assert.equal(isCustomMark(BUSINESS_MARK), false);
  // the Personal pattern in a palette colour is still the Personal shape
  assert.equal(isCustomMark({ color: MARK_PALETTE[0], pattern: PERSONAL_MARK.pattern }), false);
  // a palette pattern in amber is still amber
  assert.equal(isCustomMark({ color: PERSONAL_MARK.color, pattern: CUSTOM_PATTERNS[0] }), false);
});

test("a pattern lights four to seven of its nine blocks", () => {
  assert.ok(CUSTOM_PATTERNS.length > 300);
  for (const p of CUSTOM_PATTERNS) {
    assert.match(p, /^[01]{9}$/);
    assert.ok(litCount(p) >= 4 && litCount(p) <= 7, p);
  }
  assert.equal(isCustomPattern("000000111"), false, "three is too few to read as a mark");
  assert.equal(isCustomPattern("111111110"), false, "eight reads as a solid square");
  assert.equal(isCustomPattern("10101010"), false);
  assert.equal(isCustomPattern("1010101x1"), false);
  assert.equal(isCustomPattern(42), false);
});

test("generated marks never collide and never use the reserved ones, however many there are", () => {
  for (const seed of [1, 7, 42, 1999]) {
    const random = seeded(seed);
    const taken: Mark[] = [{ ...PERSONAL_MARK }, { ...BUSINESS_MARK }];
    for (let i = 0; i < 400; i++) {
      const mark = generateMark(taken, { random });
      assert.ok(mark, `ran out at ${i}`);
      assert.ok(isCustomMark(mark), `${JSON.stringify(mark)} is not a custom mark`);
      assert.ok(!taken.some((m) => sameMark(m, mark)), `${JSON.stringify(mark)} collides at ${i}`);
      taken.push(mark!);
    }
  }
});

test("the first ten workspaces are ten different colours", () => {
  const random = seeded(3);
  const taken: Mark[] = [];
  for (let i = 0; i < MARK_PALETTE.length; i++) taken.push(generateMark(taken, { random })!);
  assert.equal(new Set(taken.map((m) => m.color)).size, MARK_PALETTE.length);
});

test("a reroll is a different mark, and a different colour while one is free", () => {
  const random = seeded(11);
  const taken = [generateMark([], { random })!];
  const current = generateMark(taken, { random })!;
  for (let i = 0; i < 50; i++) {
    const next = generateMark(taken, { random, avoid: current })!;
    assert.ok(!sameMark(next, current));
    assert.notEqual(next.color, current.color);
    assert.ok(!taken.some((m) => sameMark(m, next)));
  }
});

test("when every combination is taken, there is nothing to hand out rather than a duplicate", () => {
  const all: Mark[] = MARK_PALETTE.flatMap((color) => CUSTOM_PATTERNS.map((pattern) => ({ color, pattern })));
  assert.equal(generateMark(all, { random: seeded(5) }), null);
  const oneLeft = all.slice(1);
  assert.ok(sameMark(generateMark(oneLeft, { random: seeded(5) }), all[0]));
});

test("cells are drawn row by row, lit where the pattern says", () => {
  const cells = markCells("100000001");
  assert.equal(cells.length, 9);
  assert.deepEqual(
    cells.map((c) => c.on),
    [true, false, false, false, false, false, false, false, true],
  );
  // the spec's geometry on a 48 unit tile: 15.6% padding, 6.25% gaps
  assert.equal(cells[0].x, 7.5);
  assert.equal(cells[1].x, 19.5);
  assert.equal(cells[8].y, 31.5);
});

test("a new workspace's accent is the Bloks colour nearest its mark", () => {
  assert.equal(accentForMark("#3E5BD9"), "deepBlue");
  assert.equal(accentForMark("#149E8E"), "cyan");
  assert.equal(accentForMark("#8E4FC9"), "orchid");
  assert.equal(accentForMark("#3F9A5B"), "green");
  assert.equal(accentForMark("#E9A83A"), "amber");
  // a grey has no hue to follow, so it keeps the default
  assert.equal(accentForMark("#5B5F6B"), "deepBlue");
});
