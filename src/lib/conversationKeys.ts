// The conversation tabs' keys (GitHub 401), the way a browser has them for
// its own: ⌘T opens a new one, ⌘W closes the open one, ⌘⇧[ and ⌘⇧] step
// along them, and the arrows move between them on a focused tab. Ctrl
// everywhere but a Mac, as shortcuts.ts spells it.
//
// Heard by the conversation (ChatView.tsx) and by the terminal, matched
// here, so the two agree on whose key a press is: ⌘⇧[ and ⌘⇧] step the
// terminal's tabs too. The terminal has them while the keyboard is in it,
// or while it covers the window; the conversation has them otherwise, and
// never both. In the terminal the conversation hears none of these: on
// Windows and Linux Ctrl+T and Ctrl+W are the shell's own.
//
// ⌘W is a conversation's and never the window's. It used to close the
// window, which is what nobody pressing it in a tab strip meant; ⌘⇧W does
// that now. With nothing it may close it does nothing at all, rather than
// falling through to the window.
//
// The Mac's menu bar lists these keys too (electron/app-menu.mjs). A
// menu's key and the page's can both hear one press, in either order, so
// a choice from the menu is played to the page as the key it names, and
// one the page has just heard itself is taken for that same press and
// dropped: the page's rules above decide every time, once.
import type { Platform } from "./shortcuts.ts";

export type ConversationChord = "new" | "close" | "next" | "previous";

interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * What a key press means to the conversation tabs, or nothing.
 *
 * T and W are read by their letter, as ⌘N and ⌘F are, so they follow the
 * keyboard's layout. The brackets are read by `code` where there is one,
 * as the terminal reads them, because shift makes braces of them.
 */
export function conversationChord(e: KeyLike, platform: Platform): ConversationChord | null {
  if (e.altKey) return null;
  const mod = platform === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  const letter = e.key.toLowerCase();
  const is = (code: string, ...keys: string[]) => e.code === code || (!e.code && keys.includes(e.key));
  if (!e.shiftKey && letter === "t") return "new";
  if (!e.shiftKey && letter === "w") return "close";
  if (e.shiftKey && is("BracketRight", "]", "}")) return "next";
  if (e.shiftKey && is("BracketLeft", "[", "{")) return "previous";
  return null;
}

/** Where the keyboard is, as these keys care about it. */
export interface KeysWhere {
  /** The keyboard is somewhere in the terminal panel. */
  inTerminal: boolean;
  /** The terminal fills the window, or is a window of its own. */
  terminalCovers: boolean;
  /** The keyboard is in a dialog, which is answered before anything
   * under it changes. */
  inDialog: boolean;
}

/**
 * Who hears a conversation key: the terminal, the conversation, or, with
 * a dialog up, nobody. The terminal only ever takes the stepping pair;
 * the rest are left to the shell there.
 */
export function keysOwner(where: KeysWhere): "terminal" | "conversation" | null {
  if (where.inDialog) return null;
  if (where.inTerminal || where.terminalCovers) return "terminal";
  return "conversation";
}

/** The page as it is now, for keysOwner. The terminal marks its panel
 * with its mode (Terminal.tsx). */
export function keysWhere(): KeysWhere {
  const at = document.activeElement;
  return {
    inTerminal: Boolean(at?.closest("[data-terminal-panel]")),
    terminalCovers: Boolean(document.querySelector('[data-terminal-panel="fill"]')),
    inDialog: Boolean(at?.closest("[role=dialog], [role=alertdialog]")),
  };
}

/** Why the open conversation cannot be closed, if it cannot. The first
 * is General, which an agent always keeps (TaskStrip.tsx), and one at
 * work is stopped before it is closed, as the server insists. */
export function closeRefusal(
  tasks: ReadonlyArray<{ id: string; state: string }>,
  open: string,
): "first" | "working" | null {
  const at = tasks.findIndex((t) => t.id === open);
  if (at <= 0) return "first";
  return tasks[at].state === "working" ? "working" : null;
}

/**
 * Where a focused tab's arrow goes: the next one or the one before,
 * wrapping at the ends, or the first or the last. Along the strip the
 * arrows are left and right; down the sidebar's list, up and down.
 */
export function rovingTo(key: string, at: number, count: number, axis: "horizontal" | "vertical"): number | null {
  if (count <= 0 || at < 0) return null;
  const back = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const on = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
  if (key === back) return (at - 1 + count) % count;
  if (key === on) return (at + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

// ── the menu bar's half ──

/** The menu's words for these choices (electron/app-menu.mjs). */
const MENU: Record<string, ConversationChord> = {
  newConversation: "new",
  closeConversation: "close",
  previousConversation: "previous",
  nextConversation: "next",
};

export function chordOfMenu(word: string | null): ConversationChord | null {
  return (word && MENU[word]) || null;
}

/** The key a menu choice is played to the page as. */
export function chordKey(chord: ConversationChord, platform: Platform): KeyboardEventInit {
  const step = chord === "next" || chord === "previous";
  const press =
    chord === "new"
      ? { key: "t", code: "KeyT" }
      : chord === "close"
        ? { key: "w", code: "KeyW" }
        : chord === "next"
          ? { key: "}", code: "BracketRight" }
          : { key: "{", code: "BracketLeft" };
  return {
    ...press,
    metaKey: platform === "mac",
    ctrlKey: platform !== "mac",
    shiftKey: step,
    bubbles: true,
    cancelable: true,
  };
}

/** How close a menu's choice and the page's own key press are for the
 * two to be one press heard twice. Far longer than that takes, far
 * shorter than pressing again. */
export const ECHO_MS = 400;

const heard = new Map<ConversationChord, number>();

/** The page heard this key itself, from the keyboard. */
export function heardKey(chord: ConversationChord, at: number): void {
  heard.set(chord, at);
}

/** Whether a menu choice now is the press the page has just heard. */
export function isEcho(chord: ConversationChord, at: number): boolean {
  const before = heard.get(chord);
  return before !== undefined && at - before >= 0 && at - before < ECHO_MS;
}

/**
 * Listen for these keys from the keyboard and for the menu's choices,
 * and play each choice that is not an echo to the page. Returns the way
 * to stop. `onMenu` is the bridge's menu subscription, absent outside the
 * desktop app.
 */
export function followMenuKeys(
  platform: Platform,
  onMenu: ((handler: (word: string) => void) => () => void) | undefined,
): () => void {
  const hear = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    const chord = conversationChord(e, platform);
    if (chord) heardKey(chord, performance.now());
  };
  // ahead of every other listener, before any of them can stop it
  window.addEventListener("keydown", hear, true);
  const stop = onMenu?.((word) => {
    const chord = chordOfMenu(word);
    if (!chord || isEcho(chord, performance.now())) return;
    window.dispatchEvent(new KeyboardEvent("keydown", chordKey(chord, platform)));
  });
  return () => {
    window.removeEventListener("keydown", hear, true);
    stop?.();
  };
}
