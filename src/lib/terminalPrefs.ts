// How the terminal draws and behaves: the cursor, what a selection does,
// how far back it keeps, how big the type is.
//
// One set for every tab and every agent, kept on this device. These are
// the habits of the person typing, not properties of a shell, so a new
// tab or a terminal popped out into its own window comes up the way the
// last one was left. No React and no browser here; the storage is handed
// in, as in terminalLayout.ts.
import { t, type MessageKey } from "./i18n.ts";

export type CursorStyle = "block" | "bar" | "underline";

/** Each label is a catalogue key, put into words where the menu draws it. */
export const CURSOR_STYLES: ReadonlyArray<{ id: CursorStyle; label: MessageKey }> = [
  { id: "block", label: "terminalPrefs.cursor.block" },
  { id: "bar", label: "terminalPrefs.cursor.bar" },
  { id: "underline", label: "terminalPrefs.cursor.underline" },
];

/** Lines kept above the screen. More is more memory per tab, so it is a
 * short list rather than a field. */
export const SCROLLBACK_CHOICES = [1_000, 5_000, 10_000] as const;
export type Scrollback = (typeof SCROLLBACK_CHOICES)[number];

export const FONT_SIZE = { min: 9, max: 24, initial: 13 } as const;

export interface TerminalPrefs {
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  copyOnSelect: boolean;
  scrollback: Scrollback;
  fontSize: number;
}

export const TERMINAL_PREFS_KEY = "bloks-terminal-prefs";

export const DEFAULT_PREFS: TerminalPrefs = {
  // the bar the panel has always had
  cursorStyle: "bar",
  cursorBlink: true,
  copyOnSelect: false,
  scrollback: 10_000,
  fontSize: FONT_SIZE.initial,
};

export function clampFont(size: number): number {
  return Math.round(Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, size)));
}

/** "10,000 lines", the way the menu says it. */
export function scrollbackLabel(lines: number): string {
  return t("terminalPrefs.scrollbackLines", { count: lines });
}

/** Stored preferences, with the default for anything missing or wrong. */
export function parsePrefs(raw: string | null): TerminalPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
  } catch {
    /* unreadable: the default */
  }
  const style = CURSOR_STYLES.find((c) => c.id === saved.cursorStyle)?.id;
  const scrollback = SCROLLBACK_CHOICES.find((n) => n === saved.scrollback);
  const font = typeof saved.fontSize === "number" && Number.isFinite(saved.fontSize) ? clampFont(saved.fontSize) : null;
  return {
    cursorStyle: style ?? DEFAULT_PREFS.cursorStyle,
    cursorBlink: typeof saved.cursorBlink === "boolean" ? saved.cursorBlink : DEFAULT_PREFS.cursorBlink,
    copyOnSelect: typeof saved.copyOnSelect === "boolean" ? saved.copyOnSelect : DEFAULT_PREFS.copyOnSelect,
    scrollback: scrollback ?? DEFAULT_PREFS.scrollback,
    fontSize: font ?? DEFAULT_PREFS.fontSize,
  };
}

/** One step smaller, one larger, or back to where it started. */
export function stepFont(prefs: TerminalPrefs, by: -1 | 0 | 1): TerminalPrefs {
  return { ...prefs, fontSize: by === 0 ? FONT_SIZE.initial : clampFont(prefs.fontSize + by) };
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createTerminalPrefs(storage: Storage) {
  const read = (): TerminalPrefs => {
    try {
      return parsePrefs(storage.getItem(TERMINAL_PREFS_KEY));
    } catch {
      return DEFAULT_PREFS;
    }
  };
  let current = read();
  let sessionOnly = false;
  return {
    get: () => current,
    set(next: TerminalPrefs) {
      current = next;
      try {
        storage.setItem(TERMINAL_PREFS_KEY, JSON.stringify(next));
        sessionOnly = false;
      } catch {
        sessionOnly = true;
      }
    },
    sync() {
      if (!sessionOnly) current = read();
    },
  };
}
