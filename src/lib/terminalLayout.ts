// Where the terminal sits around a conversation, and how big it is there.
//
// Kept on this device, like the chat sidebar's width: how much terminal
// you want in view depends on the screen you are at, not on the
// workspace. It can sit on any side of the chat, take half of it beside
// the conversation, or cover the whole window; each side remembers its own
// size, because a terminal you like 260 pixels tall at the bottom is not
// one you want 260 pixels wide down the left.
//
// No React and no browser in here, so the tests can read it as it is. The
// storage is handed in, and a store that will not take a write (a private
// window) holds the choice for the visit rather than losing it.

export type TerminalPosition = "left" | "right" | "top" | "bottom";
/** Docked to a side at its own size, half the chat beside it, or the
 * whole window. */
export type TerminalArrangement = "docked" | "split" | "fill";

export interface TerminalLayout {
  position: TerminalPosition;
  arrangement: TerminalArrangement;
  /** Pixels: across the chat on the left or right, down it at the top or
   * bottom. */
  sizes: Record<TerminalPosition, number>;
  /** Split: the terminal's share of the width. */
  split: number;
}

export const TERMINAL_LAYOUT_KEY = "bloks-terminal-layout";
/** What the bottom drawer's height was kept under before it could move,
 * still written so the setting reads the same as it always did. */
export const TERMINAL_HEIGHT_KEY = "bloks-terminal-height";

export const TERMINAL_SIZE = {
  /** A terminal shorter than this shows a prompt and nothing else. */
  minHeight: 140,
  /** And narrower than this, every line wraps. */
  minWidth: 280,
  /** What the conversation keeps, whatever the terminal asks for. */
  chatHeight: 220,
  chatWidth: 320,
  splitMin: 0.25,
  splitMax: 0.75,
} as const;

export const DEFAULT_LAYOUT: TerminalLayout = {
  position: "bottom",
  arrangement: "docked",
  sizes: { left: 440, right: 440, top: 260, bottom: 260 },
  split: 0.5,
};

const POSITIONS: readonly TerminalPosition[] = ["left", "right", "top", "bottom"];
const ARRANGEMENTS: readonly TerminalArrangement[] = ["docked", "split", "fill"];

/** Beside the chat, so sized by width; the others are sized by height. */
export function across(position: TerminalPosition): boolean {
  return position === "left" || position === "right";
}

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * A stored layout, or the default for anything in it that is missing or
 * nonsense. The old drawer height is the bottom size when nothing newer
 * says otherwise, so the drawer opens at the height it always did.
 */
export function parseLayout(raw: string | null, legacyHeight: string | null = null): TerminalLayout {
  let saved: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
  } catch {
    /* unreadable: the default */
  }
  const sizes = { ...DEFAULT_LAYOUT.sizes };
  const legacy = legacyHeight === null || legacyHeight.trim() === "" ? null : Number(legacyHeight);
  if (legacy !== null && Number.isFinite(legacy) && legacy >= TERMINAL_SIZE.minHeight) sizes.bottom = legacy;
  const savedSizes = saved.sizes && typeof saved.sizes === "object" ? (saved.sizes as Record<string, unknown>) : {};
  for (const position of POSITIONS) {
    const size = number(savedSizes[position]);
    if (size !== null && size > 0) sizes[position] = Math.round(size);
  }
  const split = number(saved.split);
  return {
    position: POSITIONS.includes(saved.position as TerminalPosition) ? (saved.position as TerminalPosition) : DEFAULT_LAYOUT.position,
    arrangement: ARRANGEMENTS.includes(saved.arrangement as TerminalArrangement)
      ? (saved.arrangement as TerminalArrangement)
      : DEFAULT_LAYOUT.arrangement,
    sizes,
    split: split === null ? DEFAULT_LAYOUT.split : clampSplit(split),
  };
}

export function serializeLayout(layout: TerminalLayout): string {
  return JSON.stringify(layout);
}

export function clampSplit(share: number): number {
  return Math.min(TERMINAL_SIZE.splitMax, Math.max(TERMINAL_SIZE.splitMin, share));
}

/**
 * Move to a side. Beside the chat, a split stays a split on the new side;
 * anything else, a full window included, becomes a terminal docked there,
 * because choosing where it goes is choosing to see the chat as well.
 */
export function moveTerminal(layout: TerminalLayout, position: TerminalPosition): TerminalLayout {
  const arrangement = layout.arrangement === "split" && across(position) ? "split" : "docked";
  return { ...layout, position, arrangement };
}

/**
 * Fill the window or split it, or go back to docked by choosing the one
 * already chosen. A split is always side by side, so a terminal at the
 * top or bottom moves to the right to make one.
 */
export function arrangeTerminal(layout: TerminalLayout, arrangement: TerminalArrangement): TerminalLayout {
  if (arrangement === layout.arrangement && arrangement !== "docked") return { ...layout, arrangement: "docked" };
  if (arrangement === "split" && !across(layout.position)) return { ...layout, arrangement, position: "right" };
  return { ...layout, arrangement };
}

/** The side the terminal is drawn on, which for a split is its side of
 * the chat. Nothing for the whole window. */
export function dockSide(layout: TerminalLayout): TerminalPosition | null {
  return layout.arrangement === "fill" ? null : layout.position;
}

/** A size that leaves the conversation room, in a box of this size. */
export function clampDock(position: TerminalPosition, size: number, room: { width: number; height: number }): number {
  const wide = across(position);
  const min = wide ? TERMINAL_SIZE.minWidth : TERMINAL_SIZE.minHeight;
  const max = (wide ? room.width - TERMINAL_SIZE.chatWidth : room.height - TERMINAL_SIZE.chatHeight);
  // a box too small for both gets the terminal's minimum, not less
  return Math.round(Math.max(min, Math.min(max, size)));
}

/** The terminal's size in pixels as it should be drawn now. */
export function shownSize(layout: TerminalLayout, room: { width: number; height: number }): number {
  if (layout.arrangement === "split") return clampDock(layout.position, Math.round(layout.split * room.width), room);
  return clampDock(layout.position, layout.sizes[layout.position], room);
}

/** After a drag: the docked side's size, or a split's share. */
export function resizeTerminal(layout: TerminalLayout, size: number, room: { width: number; height: number }): TerminalLayout {
  const clamped = clampDock(layout.position, size, room);
  if (layout.arrangement === "split") {
    return room.width > 0 ? { ...layout, split: clampSplit(clamped / room.width) } : layout;
  }
  return { ...layout, sizes: { ...layout.sizes, [layout.position]: clamped } };
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The kept layout, with its storage handed in. */
export function createTerminalLayout(storage: Storage) {
  const read = (): TerminalLayout => {
    try {
      return parseLayout(storage.getItem(TERMINAL_LAYOUT_KEY), storage.getItem(TERMINAL_HEIGHT_KEY));
    } catch {
      return DEFAULT_LAYOUT;
    }
  };
  let current = read();
  let sessionOnly = false;
  return {
    get: () => current,
    set(next: TerminalLayout) {
      current = next;
      try {
        storage.setItem(TERMINAL_LAYOUT_KEY, serializeLayout(next));
        storage.setItem(TERMINAL_HEIGHT_KEY, String(next.sizes.bottom));
        sessionOnly = false;
      } catch {
        sessionOnly = true;
      }
    },
    /** Another window changed it. Re-reading after a write that failed
     * would quietly undo the choice just made. */
    sync() {
      if (!sessionOnly) current = read();
    },
  };
}
