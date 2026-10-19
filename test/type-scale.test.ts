// The type scale, checked where it can quietly break: class merging.
//
// `cn` runs every className through tailwind-merge, which decides which
// of two classes wins. It knows Tailwind's own sizes, not ours, so until
// it is told, `text-body` looks like a colour and evicts the real colour
// beside it. A primary button lost its label that way: white on white.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cn } from "../src/lib/cn.ts";

const SCALE = ["micro", "caption", "small", "body", "ui", "lead", "title", "heading", "display"];

test("a size from the scale never evicts a colour, and the later size wins", () => {
  for (const size of SCALE) {
    assert.equal(cn("bg-primary text-primary-foreground", `text-${size}`), `bg-primary text-primary-foreground text-${size}`);
    assert.equal(cn("text-small text-muted-foreground", `text-${size}`), `text-muted-foreground text-${size}`);
  }
  assert.equal(cn("text-muted-foreground", "text-foreground"), "text-foreground");
});

test("every size cn knows is defined in the stylesheet, and the other way round", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const defined = [...css.matchAll(/^\s*--text-([a-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(defined, SCALE);
  const merged = readFileSync(new URL("../src/lib/cn.ts", import.meta.url), "utf8");
  for (const size of SCALE) assert.match(merged, new RegExp(`"${size}"`));
});
