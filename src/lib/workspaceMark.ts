// Workspace marks, for the window: the rules come from the one module the
// main process checks marks with (electron/workspace-marks.mjs), so the
// switcher, the settings and the main process can never disagree about
// what a mark may be. This adds what only drawing needs: where each block
// sits, and which accent a new workspace starts with.
export {
  BUSINESS_MARK,
  CUSTOM_PATTERNS,
  MARK_PALETTE,
  PERSONAL_MARK,
  fixedMark,
  generateMark,
  isCustomMark,
  sameMark,
  type Mark,
} from "../../electron/workspace-marks.mjs";

/** The tile is drawn on a 48 unit square and scaled, so every size is
 * the same mark: corners at 27% of the side, 15.6% padding, 6.25% gaps. */
export const MARK_BOX = 48;
export const MARK_RADIUS = 13;
const PAD = 7.5;
const GAP = 3;
export const MARK_CELL = (MARK_BOX - PAD * 2 - GAP * 2) / 3;
export const MARK_CELL_RADIUS = 2.5;

export interface MarkCell {
  x: number;
  y: number;
  on: boolean;
}

/** The nine blocks of a pattern, row by row from the top left. */
export function markCells(pattern: string): MarkCell[] {
  return Array.from({ length: 9 }, (_, i) => ({
    x: PAD + (i % 3) * (MARK_CELL + GAP),
    y: PAD + Math.floor(i / 3) * (MARK_CELL + GAP),
    on: pattern[i] === "1",
  }));
}

function hueAndSaturation(hex: string): [number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return [0, 0];
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s];
}

/** The accents a workspace may start on: every colour of the Bloks mark
 * but red, which reads as something wrong when it is the first thing a
 * new workspace shows (src/lib/accent.ts). */
const STARTING_ACCENTS: Array<[string, string]> = [
  ["deepBlue", "#004aad"],
  ["orange", "#ff751f"],
  ["orchid", "#cb6ce6"],
  ["coral", "#ff5757"],
  ["cyan", "#5ce1e6"],
  ["green", "#7ed957"],
  ["amber", "#ffbd59"],
];

/** The accent nearest a mark's colour by hue, so a new workspace looks
 * like its mark from the first screen. A grey has no hue to follow and
 * keeps the default. */
export function accentForMark(color: string): string {
  const [hue, saturation] = hueAndSaturation(color);
  if (saturation < 0.15) return "deepBlue";
  let best = STARTING_ACCENTS[0][0];
  let distance = Infinity;
  for (const [id, hex] of STARTING_ACCENTS) {
    const raw = Math.abs(hueAndSaturation(hex)[0] - hue);
    const d = Math.min(raw, 360 - raw);
    if (d < distance) [best, distance] = [id, d];
  }
  return best;
}
