// The terminal's tabs: which one is open after a close, which one the
// keyboard steps to, and which keys mean what.
//
// The keys are heard in the terminal panel (and ⌃` in the conversation,
// which owns whether the panel is open), but they are matched here, so
// the shell and the panel agree on which keys belong to the app: the
// shell is told to leave exactly these alone, and gets every other key.
// They are listed for the ⌘/ sheet in shortcuts.ts.
import type { Platform } from "./shortcuts.ts";

/** The tab one step along, wrapping at either end. */
export function stepTab(ids: readonly string[], active: string | null, by: 1 | -1): string | null {
  if (!ids.length) return null;
  const at = active === null ? -1 : ids.indexOf(active);
  if (at < 0) return ids[0];
  return ids[(at + by + ids.length) % ids.length];
}

/**
 * Which tab is open once one closes. Closing another tab leaves you where
 * you were; closing the open one opens its neighbour to the right, or to
 * the left at the end of the strip, the way browser tabs do.
 */
export function activeAfterClose(ids: readonly string[], closing: string, active: string | null): string | null {
  const rest = ids.filter((id) => id !== closing);
  if (active !== closing && active !== null && rest.includes(active)) return active;
  const at = ids.indexOf(closing);
  if (!rest.length) return null;
  return rest[Math.min(Math.max(at, 0), rest.length - 1)];
}

export type TerminalChord = "toggle" | "new" | "close" | "next" | "previous" | "fill";

interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * What a key press means to the terminal, or nothing.
 *
 * Read by `code` where shift changes the character: ⌃⇧` types a tilde on
 * most layouts and ⌘⇧] a brace, and the key is the same key either way.
 * The Control key means Control on a Mac too for the backtick ones, the
 * way editors have them; tab stepping and the full window use ⌘ there
 * and Ctrl elsewhere, like every tabbed app on each.
 */
export function terminalChord(e: KeyLike, platform: Platform): TerminalChord | null {
  if (e.altKey) return null;
  const mod = platform === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const ctrlOnly = e.ctrlKey && !e.metaKey;
  // An event made by software rather than a keyboard can come without a
  // code, and then the character is all there is to go on.
  const is = (code: string, ...keys: string[]) => e.code === code || (!e.code && keys.includes(e.key));
  if (ctrlOnly && is("Backquote", "`", "~")) return e.shiftKey ? "new" : "toggle";
  if (ctrlOnly && e.shiftKey && is("KeyW", "w", "W")) return "close";
  if (mod && e.shiftKey && is("BracketRight", "]", "}")) return "next";
  if (mod && e.shiftKey && is("BracketLeft", "[", "{")) return "previous";
  if (mod && e.shiftKey && e.key === "Enter") return "fill";
  return null;
}
