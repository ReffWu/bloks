// A workspace's mark: a coloured tile with a 3x3 grid of blocks on it.
//
// Two are fixed and look the same on every computer, so they are never
// mistaken for anything else: Personal (amber, a little house of blocks)
// and Business (indigo, a ring). Every other workspace is given a mark
// when it is made, from a palette and a set of patterns of its own that
// never use those two colours or those two patterns, and no two
// workspaces on one computer share both a colour and a pattern. Owners
// can reroll it, or upload a logo instead.
//
// Plain JavaScript with no imports, on purpose: the main process checks
// a mark before it saves one, the window draws them and offers a reroll,
// and both have to agree on what a mark may be. One module, read by both
// (src/lib/workspaceMark.ts re-exports it), and by the tests.

export const PERSONAL_MARK = Object.freeze({ color: "#E9A83A", pattern: "010111101" });
export const BUSINESS_MARK = Object.freeze({ color: "#3E5BD9", pattern: "111101111" });

/** The colours a named workspace's mark is drawn from. Ten, chosen to
 * stay apart from each other and from amber and indigo. */
export const MARK_PALETTE = Object.freeze([
  "#149E8E",
  "#8E4FC9",
  "#E8664A",
  "#D64C7F",
  "#2A86C7",
  "#7A8F2A",
  "#B86A3C",
  "#4D6478",
  "#3F9A5B",
  "#5B5F6B",
]);

export const RESERVED_COLORS = Object.freeze([PERSONAL_MARK.color, BUSINESS_MARK.color]);
export const RESERVED_PATTERNS = Object.freeze([PERSONAL_MARK.pattern, BUSINESS_MARK.pattern]);

const PATTERN = /^[01]{9}$/;

/** How many of a pattern's nine blocks are lit. */
export function litCount(pattern) {
  let n = 0;
  for (const bit of String(pattern)) if (bit === "1") n++;
  return n;
}

/** Whether a named workspace may wear this pattern: nine blocks, four to
 * seven of them lit (fewer reads as empty, more as a solid square), and
 * neither of the two fixed ones. */
export function isCustomPattern(pattern) {
  if (typeof pattern !== "string" || !PATTERN.test(pattern)) return false;
  const lit = litCount(pattern);
  return lit >= 4 && lit <= 7 && !RESERVED_PATTERNS.includes(pattern);
}

/** Every pattern a named workspace can have, in a fixed order. */
export const CUSTOM_PATTERNS = Object.freeze(
  Array.from({ length: 512 }, (_, n) => n.toString(2).padStart(9, "0")).filter(isCustomPattern),
);

const sameColor = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();

/** Whether a named workspace may wear this mark at all, before asking
 * whether another workspace already does. */
export function isCustomMark(mark) {
  return Boolean(
    mark &&
      typeof mark.color === "string" &&
      MARK_PALETTE.some((c) => sameColor(c, mark.color)) &&
      isCustomPattern(mark.pattern),
  );
}

/** The fixed mark of a fixed kind; null for every other kind. */
export function fixedMark(kind) {
  if (kind === "personal") return { ...PERSONAL_MARK };
  if (kind === "business") return { ...BUSINESS_MARK };
  return null;
}

/** Two marks are the same mark when both the colour and the pattern
 * match; a shared colour alone is fine, the pattern tells them apart. */
export function sameMark(a, b) {
  return Boolean(a && b && sameColor(a.color, b.color) && a.pattern === b.pattern);
}

/**
 * A fresh mark for a named workspace that matches none of `taken` (the
 * marks the other workspaces on this computer wear) nor `avoid` (the one
 * a reroll is replacing).
 *
 * Colours nobody has yet go first, so the first ten workspaces are ten
 * colours; after that, the least used. A pattern nobody has goes first
 * too, so even two of one colour differ in shape as much as they can.
 * `random` returns [0, 1), and is a parameter so tests can pin it.
 */
export function generateMark(taken = [], { random = Math.random, avoid = null } = {}) {
  const worn = [...taken, ...(avoid ? [avoid] : [])].filter(Boolean);
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

  const uses = (color) => worn.filter((m) => sameColor(m.color, color)).length;
  const fewest = Math.min(...MARK_PALETTE.map(uses));
  // a reroll that lands on the colour it had looks like nothing happened
  const fresh = MARK_PALETTE.filter((c) => uses(c) === fewest && !(avoid && sameColor(avoid.color, c)));
  const colors = fresh.length ? fresh : MARK_PALETTE.filter((c) => uses(c) === fewest);

  const usedPatterns = new Set(worn.map((m) => m.pattern));
  // every colour is tried before giving up, in case the first has run out
  // of patterns: ten colours times hundreds of patterns is a lot of
  // workspaces, but "never collide" is a promise, not a likelihood
  const shuffled = [...colors];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const order = [...shuffled, ...MARK_PALETTE.filter((c) => !colors.includes(c))];
  for (const color of order) {
    const free = CUSTOM_PATTERNS.filter((p) => !worn.some((m) => sameMark(m, { color, pattern: p })));
    if (!free.length) continue;
    const unseen = free.filter((p) => !usedPatterns.has(p));
    return { color, pattern: pick(unseen.length ? unseen : free) };
  }
  return null;
}
