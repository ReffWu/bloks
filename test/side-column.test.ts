// A page's column (src/lib/sideColumn.ts, src/components/SideColumn.tsx):
// how far a drag can size it, when letting go folds it instead, where each
// one keeps itself, how the arrows walk a folded column's tabs, and the
// brand line its edge is drawn with.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHAT_COLUMN,
  CHAT_SIZE,
  SIDE_COLUMN,
  clampColumn,
  columnKeys,
  releaseColumn,
  stepFocus,
} from "../src/lib/sideColumn.ts";
import { CHAT_SIDEBAR } from "../src/lib/chatSidebar.ts";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("sizing a column", () => {
  test("a drag stays between the column's limits", () => {
    assert.equal(clampColumn(SIDE_COLUMN, 10), SIDE_COLUMN.min);
    assert.equal(clampColumn(SIDE_COLUMN, 9_000), SIDE_COLUMN.max);
    assert.equal(clampColumn(SIDE_COLUMN, 251.6), 252);
    for (const size of [SIDE_COLUMN, CHAT_SIZE]) {
      assert.ok(size.foldBelow < size.min, "a column must be able to sit at its minimum without folding");
      assert.ok(size.min <= size.initial && size.initial <= size.max, "it starts inside its own limits");
    }
  });

  test("let go narrower than it can usefully be, it folds, keeping the width it had", () => {
    assert.deepEqual(releaseColumn(SIDE_COLUMN, 300, SIDE_COLUMN.foldBelow - 1), { width: 300, open: false });
    // not the minimum the drag passed through on its way down
    assert.deepEqual(releaseColumn(SIDE_COLUMN, 300, 20), { width: 300, open: false });
    // between folding and the minimum, it stays at the minimum
    assert.deepEqual(releaseColumn(SIDE_COLUMN, 300, SIDE_COLUMN.foldBelow + 1), { width: SIDE_COLUMN.min, open: true });
    assert.deepEqual(releaseColumn(SIDE_COLUMN, 300, 320), { width: 320, open: true });
  });

  test("the chat keeps the sizes and the keys it had before the others", () => {
    assert.equal(CHAT_SIDEBAR, CHAT_SIZE);
    assert.deepEqual({ ...CHAT_SIZE }, { min: 232, max: 440, initial: 288, foldBelow: 180 });
    assert.deepEqual(columnKeys(CHAT_COLUMN), { width: "bloks-chat-sidebar-width", open: "bloks-chat-sidebar-open" });
  });

  test("every other column is remembered under its own name", () => {
    const settings = columnKeys("settings");
    const memory = columnKeys("memory");
    assert.notEqual(settings.width, memory.width);
    assert.notEqual(settings.open, settings.width);
    assert.match(settings.width, /^bloks-side-settings-/);
  });
});

describe("walking a folded column's tabs", () => {
  test("the arrows step and stop at the ends; Home and End jump", () => {
    assert.equal(stepFocus("ArrowRight", 0, 3), 1);
    assert.equal(stepFocus("ArrowRight", 2, 3), 2);
    assert.equal(stepFocus("ArrowLeft", 0, 3), 0);
    assert.equal(stepFocus("ArrowLeft", 2, 3), 1);
    assert.equal(stepFocus("Home", 2, 3), 0);
    assert.equal(stepFocus("End", 0, 3), 2);
  });

  test("from outside the row an arrow lands on its first tab, and other keys are left alone", () => {
    assert.equal(stepFocus("ArrowRight", -1, 3), 0);
    assert.equal(stepFocus("Enter", 1, 3), null);
    assert.equal(stepFocus("ArrowDown", 1, 3), null);
    assert.equal(stepFocus("ArrowRight", 0, 0), null);
  });
});

describe("the edge's line", () => {
  test("is the brand gradient, one token, light and dark", () => {
    const light = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));
    const dark = css.slice(css.indexOf(".dark {"), css.indexOf("\n}", css.indexOf(".dark {")));
    assert.match(light, /--brand-gradient:\s*#004aad 0%/);
    const strength = (block: string, name: string) => Number(block.match(new RegExp(`--${name}:\\s*([\\d.]+);`))?.[1]);
    assert.equal(strength(light, "brand-line"), 0.4);
    assert.equal(strength(dark, "brand-line"), 0.55);
    // brighter in use, and still a hairline rather than a stripe
    for (const block of [light, dark]) {
      assert.ok(strength(block, "brand-line-strong") > strength(block, "brand-line"));
      assert.ok(strength(block, "brand-line-strong") < 1);
    }
    assert.match(css, /\.side-divider::before,\s*\.side-divider::after \{[^}]*linear-gradient\(to bottom, var\(--brand-gradient\)\)/);
  });

  test("fades at the top and the bottom, and only drifts for someone who has not asked for less motion", () => {
    assert.match(css, /mask-image: linear-gradient\(to bottom, transparent, #000 35%, #000 65%, transparent\)/);
    const drift = css.indexOf("animation: side-divider-drift");
    assert.ok(drift > 0);
    const guard = css.lastIndexOf("@media (prefers-reduced-motion: no-preference)", drift);
    assert.ok(guard > 0 && drift - guard < 200, "the drift runs outside the no-preference guard");
  });
});
