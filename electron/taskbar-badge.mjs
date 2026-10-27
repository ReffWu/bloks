// The Windows taskbar badge: a red disc, with the count in white or
// nothing at all.
//
// Windows has no badge count on a taskbar button, only an overlay icon
// the app draws itself, so the badge is drawn here. It is rasterised by
// hand into a BGRA buffer rather than shipped as images, because
// nativeImage cannot load SVG on Windows, a checked-in PNG would need a
// script and a test to stay in step with the palette, and a 16x16 disc
// with a 5x7 pixel font is a few dozen lines that a test can read
// back pixel by pixel. Nothing here touches Electron, so the choice and
// the drawing are both testable on any machine.

/** The red the app uses for what needs a person: --destructive in the
 * light palette of src/styles.css (test/taskbar-badge.test.ts keeps the
 * two equal). The light one, because the taskbar behind it is whatever
 * the person chose and white on this red clears 5:1 either way. */
export const BADGE_RED = { r: 0xc0, g: 0x27, b: 0x2d };

/** What the overlay should be for this many waiting, as a plain value.
 * `showNumber` is false where the number should not be read off the
 * taskbar, which leaves a dot: something is waiting, not how much.
 * Past 9 the digit would not stay legible at 16px, so it says 9+. */
export function overlayChoice(count, showNumber = true) {
  const n = Number.isFinite(count) ? Math.trunc(count) : 0;
  if (n <= 0) return { kind: "none", label: "", description: "" };
  const description = `${n} unread`;
  if (!showNumber) return { kind: "dot", label: "", description };
  return { kind: "count", label: n > 9 ? "9+" : String(n), description };
}

// 5x7 glyphs, one string per row, "#" for ink. A hand-drawn pixel font
// instead of a scaled-down real one, because anti-aliased 5px digits on
// a 16px disc blur into each other and these do not.
const GLYPHS = {
  "1": [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

/** The pixels of a label as [x, y] cells on a grid of its own, one cell
 * of space between glyphs, plus the grid's width. */
function inkFor(label) {
  const cells = [];
  let x = 0;
  for (const ch of label) {
    const rows = GLYPHS[ch];
    if (!rows) continue;
    rows.forEach((row, y) => {
      for (let i = 0; i < GLYPH_W; i++) if (row[i] === "#") cells.push([x + i, y]);
    });
    x += GLYPH_W + 1;
  }
  return { cells, width: Math.max(0, x - 1) };
}

/**
 * The badge as raw pixels: `size` x `size`, 4 bytes each, B G R A with
 * the colour premultiplied by the alpha, which is what
 * nativeImage.createFromBitmap reads. `kind` and `label` are an
 * overlayChoice. Sizes below 24 draw the font one pixel to a cell, larger
 * ones scale it by whole cells so the glyphs stay sharp at 200%.
 */
export function renderBadge(kind, label, size) {
  const buf = Buffer.alloc(size * size * 4);
  if (kind === "none") return buf;
  // a dot is a smaller disc than the one a number needs room in
  const radius = (kind === "dot" ? 0.375 : 0.5) * size;
  const mid = size / 2;
  const SS = 4; // samples per axis, for a smooth edge on the disc
  const scale = Math.max(1, Math.round(size / 16));
  const ink = kind === "count" ? inkFor(label) : { cells: [], width: 0 };
  const left = Math.round((size - ink.width * scale) / 2);
  const top = Math.round((size - GLYPH_H * scale) / 2);
  const white = new Set(
    ink.cells.flatMap(([cx, cy]) => {
      const out = [];
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) out.push((top + cy * scale + dy) * size + left + cx * scale + dx);
      }
      return out;
    }),
  );
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - mid;
          const py = y + (sy + 0.5) / SS - mid;
          if (px * px + py * py <= radius * radius) inside++;
        }
      }
      const alpha = inside / (SS * SS);
      if (alpha === 0) continue;
      const o = (y * size + x) * 4;
      const [r, g, b] = white.has(y * size + x) ? [255, 255, 255] : [BADGE_RED.r, BADGE_RED.g, BADGE_RED.b];
      buf[o] = Math.round(b * alpha);
      buf[o + 1] = Math.round(g * alpha);
      buf[o + 2] = Math.round(r * alpha);
      buf[o + 3] = Math.round(alpha * 255);
    }
  }
  return buf;
}
