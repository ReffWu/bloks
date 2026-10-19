// The prose in a reply, grouped the way a reader sees it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { proseBlocks, type List } from "../src/lib/proseBlocks.ts";

const blocks = (text: string) => proseBlocks(text.split("\n"));

describe("proseBlocks", () => {
  test("lines run together into a paragraph, and a blank line starts the next", () => {
    assert.deepEqual(blocks("One line\nand the next.\n\nA new paragraph."), [
      { kind: "paragraph", lines: ["One line", "and the next."] },
      { kind: "paragraph", lines: ["A new paragraph."] },
    ]);
  });

  test("headings keep their level, and deeper ones settle at four", () => {
    assert.deepEqual(blocks("# One\n## Two\n### Three\n###### Six ##"), [
      { kind: "heading", level: 1, text: "One" },
      { kind: "heading", level: 2, text: "Two" },
      { kind: "heading", level: 3, text: "Three" },
      { kind: "heading", level: 4, text: "Six" },
    ]);
    // no space after the hashes is not a heading
    assert.equal(blocks("#hashtag")[0].kind, "paragraph");
  });

  test("a rule, and a quote that keeps its lines together", () => {
    assert.deepEqual(blocks("Above\n\n---\n\n> first\n> second\n\nAfter"), [
      { kind: "paragraph", lines: ["Above"] },
      { kind: "rule" },
      { kind: "quote", text: "first\nsecond" },
      { kind: "paragraph", lines: ["After"] },
    ]);
  });

  test("a list nests by indentation", () => {
    const [list] = blocks("- one\n  - one a\n    - deeper\n  - one b\n- two") as List[];
    assert.equal(list.kind, "list");
    assert.equal(list.ordered, false);
    assert.deepEqual(list.items.map((i) => i.lines[0]), ["one", "two"]);
    const inner = list.items[0].children[0];
    assert.deepEqual(inner.items.map((i) => i.lines[0]), ["one a", "one b"]);
    assert.equal(inner.items[0].children[0].items[0].lines[0], "deeper");
  });

  test("a numbered list keeps counting from where it started, through blank lines", () => {
    const [list] = blocks("3. three\n\n4. four\n\n5. five") as List[];
    assert.equal(list.ordered, true);
    assert.equal(list.start, 3);
    assert.equal(list.loose, true);
    assert.equal(list.items.length, 3);
  });

  test("an indented line carries on its item, a plain one ends the list", () => {
    const out = blocks("1. Install\n   with pnpm\n2. Run it\nThen open the app.");
    const list = out[0] as List;
    assert.deepEqual(list.items[0].lines, ["Install", "with pnpm"]);
    assert.equal(list.items.length, 2);
    assert.deepEqual(out[1], { kind: "paragraph", lines: ["Then open the app."] });
  });

  test("bullets after numbers start a new list, and tasks know if they are done", () => {
    const out = blocks("1. a\n- [x] shipped\n- [ ] not yet") as List[];
    assert.equal(out.length, 2);
    assert.equal(out[1].ordered, false);
    assert.deepEqual(out[1].items.map((i) => [i.task, i.lines[0]]), [
      [true, "shipped"],
      [false, "not yet"],
    ]);
  });

  test("a list followed by a blank line and a paragraph leaves the paragraph alone", () => {
    const out = blocks("- a\n- b\n\nAfter the list.");
    assert.equal(out.length, 2);
    assert.equal((out[0] as List).loose, false);
    assert.deepEqual(out[1], { kind: "paragraph", lines: ["After the list."] });
  });

  test("bold at the start of a line is not a bullet", () => {
    assert.equal(blocks("**Bold** start")[0].kind, "paragraph");
  });
});
