// The accent picker's promise, checked for every colour it offers: the
// fill is the logo colour exactly, words on it read, and the accent as
// words on the page reads, in light and in dark (lib/accent.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCENTS, contrast, tokensFor } from "../src/lib/accent.ts";

const PAGES = { light: ["#ffffff", "#f7f7f8"], dark: ["#0e0e10", "#17171a", "#1a1a1e"] };

test("the eight are the eight squares of the Bloks mark", () => {
  assert.deepEqual(
    ACCENTS.map((a) => a.hex),
    ["#004aad", "#ff751f", "#cb6ce6", "#ff3131", "#ff5757", "#5ce1e6", "#7ed957", "#ffbd59"],
  );
});

for (const accent of ACCENTS) {
  test(`${accent.name}: the fill is exact, and its words and its ink read in both modes`, () => {
    const t = tokensFor(accent.hex);
    for (const mode of ["light", "dark"] as const) {
      const v = t[mode];
      assert.equal(v.brand, accent.hex, "the fill is the logo colour");
      assert.ok(contrast(v["brand-foreground"], v.brand) >= 4.5, `${mode}: words on the fill read`);
      for (const page of PAGES[mode]) {
        assert.ok(contrast(v["brand-ink"], page) >= 4.5, `${mode}: the ink reads on ${page}`);
      }
    }
  });
}
