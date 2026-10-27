// The Windows taskbar badge: what it should be, and what it draws.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { BADGE_RED, overlayChoice, renderBadge } from "../electron/taskbar-badge.mjs";

/** One pixel of a BGRA buffer back as r, g, b, a. */
function pixel(buf: Buffer, size: number, x: number, y: number) {
  const o = (y * size + x) * 4;
  return { r: buf[o + 2], g: buf[o + 1], b: buf[o], a: buf[o + 3] };
}

describe("overlayChoice", () => {
  test("is nothing when nothing is waiting", () => {
    for (const n of [0, -3, NaN, Infinity]) assert.equal(overlayChoice(n).kind, "none");
    assert.equal(overlayChoice(0).description, "");
  });

  test("shows the count, and says it in words", () => {
    assert.deepEqual(overlayChoice(1), { kind: "count", label: "1", description: "1 unread" });
    assert.deepEqual(overlayChoice(9), { kind: "count", label: "9", description: "9 unread" });
  });

  test("says 9+ past 9 but still describes the real number", () => {
    assert.deepEqual(overlayChoice(10), { kind: "count", label: "9+", description: "10 unread" });
    assert.equal(overlayChoice(250).label, "9+");
    assert.equal(overlayChoice(250).description, "250 unread");
  });

  test("is a plain dot when the number is not shown", () => {
    assert.deepEqual(overlayChoice(4, false), { kind: "dot", label: "", description: "4 unread" });
    assert.equal(overlayChoice(0, false).kind, "none");
  });
});

describe("renderBadge", () => {
  test("is the right number of bytes at 100% and 200%", () => {
    for (const size of [16, 32]) assert.equal(renderBadge("count", "3", size).length, size * size * 4);
  });

  test("draws nothing for none", () => {
    assert.ok(renderBadge("none", "", 16).every((byte) => byte === 0));
  });

  test("a dot is red in the middle and clear in the corners", () => {
    for (const size of [16, 32]) {
      const buf = renderBadge("dot", "", size);
      assert.deepEqual(pixel(buf, size, size / 2, size / 2), { ...BADGE_RED, a: 255 });
      assert.equal(pixel(buf, size, 0, 0).a, 0);
      assert.equal(pixel(buf, size, size - 1, size - 1).a, 0);
    }
  });

  test("a count is white ink on the red disc", () => {
    for (const size of [16, 32]) {
      const buf = renderBadge("count", "8", size);
      let white = 0;
      let red = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const p = pixel(buf, size, x, y);
          if (p.a === 255 && p.r === 255 && p.g === 255 && p.b === 255) white++;
          else if (p.a === 255 && p.r === BADGE_RED.r && p.g === BADGE_RED.g && p.b === BADGE_RED.b) red++;
        }
      }
      assert.ok(white > size, `no white ink at ${size}px`);
      assert.ok(red > white, `the disc should show more red than ink at ${size}px`);
      assert.equal(pixel(buf, size, 0, 0).a, 0);
    }
  });

  test("every label draws, and no two look alike", () => {
    const seen = new Set<string>();
    for (const label of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+"]) {
      for (const size of [16, 32]) {
        const buf = renderBadge("count", label, size);
        assert.ok(buf.some((byte) => byte === 255), label);
        if (size === 16) seen.add(buf.toString("hex"));
      }
    }
    assert.equal(seen.size, 10);
  });

  test("the ink stays inside the disc", () => {
    const size = 16;
    const buf = renderBadge("count", "9+", size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = pixel(buf, size, x, y);
        if (p.r === 255 && p.g === 255 && p.b === 255 && p.a > 0) {
          const dx = x + 0.5 - size / 2;
          const dy = y + 0.5 - size / 2;
          assert.ok(Math.hypot(dx, dy) < size / 2 - 1, `ink at ${x},${y} touches the edge`);
        }
      }
    }
  });
});

describe("the red", () => {
  test("is the app's own destructive red", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const light = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));
    const token = /--destructive:\s*#([0-9a-fA-F]{6});/.exec(light)?.[1];
    assert.ok(token, "no --destructive in the light palette");
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    assert.equal(token.toLowerCase(), hex(BADGE_RED.r) + hex(BADGE_RED.g) + hex(BADGE_RED.b));
  });
});
