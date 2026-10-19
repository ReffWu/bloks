// The terminal panel's own choices, kept on this device: where it sits and
// how big, how it draws, and how its tabs and keys behave.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_LAYOUT,
  TERMINAL_HEIGHT_KEY,
  TERMINAL_LAYOUT_KEY,
  TERMINAL_SIZE,
  arrangeTerminal,
  clampDock,
  createTerminalLayout,
  dockSide,
  moveTerminal,
  parseLayout,
  resizeTerminal,
  shownSize,
  type TerminalLayout,
} from "../src/lib/terminalLayout.ts";
import {
  DEFAULT_PREFS,
  FONT_SIZE,
  TERMINAL_PREFS_KEY,
  createTerminalPrefs,
  parsePrefs,
  scrollbackLabel,
  stepFont,
} from "../src/lib/terminalPrefs.ts";
import { activeAfterClose, stepTab, terminalChord } from "../src/lib/terminalTabs.ts";
import { keysFor } from "../src/lib/shortcuts.ts";
import { terminalAgent, terminalQuery } from "../electron/terminal-window.mjs";

const room = { width: 1200, height: 800 };

/** A storage that remembers, or one that refuses every write. */
function memory(seed: Record<string, string> = {}, refuse = false) {
  const kept = new Map(Object.entries(seed));
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (refuse) throw new Error("private mode");
      kept.set(key, value);
    },
  };
}

describe("where the terminal sits", () => {
  test("nothing kept is the bottom drawer it always was", () => {
    assert.deepEqual(parseLayout(null), DEFAULT_LAYOUT);
    assert.equal(DEFAULT_LAYOUT.position, "bottom");
    assert.equal(DEFAULT_LAYOUT.arrangement, "docked");
  });

  test("the old drawer height carries over as the bottom size", () => {
    assert.equal(parseLayout(null, "333").sizes.bottom, 333);
    // too small or not a number is the default, not a sliver
    assert.equal(parseLayout(null, "20").sizes.bottom, DEFAULT_LAYOUT.sizes.bottom);
    assert.equal(parseLayout(null, "tall").sizes.bottom, DEFAULT_LAYOUT.sizes.bottom);
    // and a newer layout says otherwise
    const saved = JSON.stringify({ ...DEFAULT_LAYOUT, sizes: { ...DEFAULT_LAYOUT.sizes, bottom: 410 } });
    assert.equal(parseLayout(saved, "333").sizes.bottom, 410);
  });

  test("anything unreadable falls back field by field", () => {
    assert.deepEqual(parseLayout("{not json"), DEFAULT_LAYOUT);
    assert.deepEqual(parseLayout("[1,2]"), DEFAULT_LAYOUT);
    const odd = parseLayout(JSON.stringify({ position: "diagonal", arrangement: "fill", sizes: { left: "wide", right: 512 }, split: 9 }));
    assert.equal(odd.position, "bottom");
    assert.equal(odd.arrangement, "fill");
    assert.equal(odd.sizes.left, DEFAULT_LAYOUT.sizes.left);
    assert.equal(odd.sizes.right, 512);
    assert.equal(odd.split, TERMINAL_SIZE.splitMax);
  });

  test("moving docks it on that side, and a split stays a split beside the chat", () => {
    const right = moveTerminal(DEFAULT_LAYOUT, "right");
    assert.deepEqual([right.position, right.arrangement], ["right", "docked"]);
    const split = arrangeTerminal(right, "split");
    assert.deepEqual([moveTerminal(split, "left").position, moveTerminal(split, "left").arrangement], ["left", "split"]);
    // a split cannot be on top, so moving there docks it
    assert.equal(moveTerminal(split, "top").arrangement, "docked");
    // choosing a side while it fills the window is choosing to see the chat
    const filled = arrangeTerminal(DEFAULT_LAYOUT, "fill");
    assert.equal(moveTerminal(filled, "left").arrangement, "docked");
  });

  test("fill and split are toggles, and a split from the bottom goes to the right", () => {
    const filled = arrangeTerminal(DEFAULT_LAYOUT, "fill");
    assert.equal(filled.arrangement, "fill");
    assert.equal(dockSide(filled), null);
    assert.equal(arrangeTerminal(filled, "fill").arrangement, "docked");
    const split = arrangeTerminal(DEFAULT_LAYOUT, "split");
    assert.deepEqual([split.position, split.arrangement], ["right", "split"]);
    assert.equal(dockSide(split), "right");
    assert.equal(arrangeTerminal(split, "split").arrangement, "docked");
  });

  test("each side keeps its own size, and the chat always keeps some room", () => {
    let layout: TerminalLayout = moveTerminal(DEFAULT_LAYOUT, "left");
    layout = resizeTerminal(layout, 500, room);
    assert.equal(layout.sizes.left, 500);
    assert.equal(layout.sizes.bottom, DEFAULT_LAYOUT.sizes.bottom, "the bottom forgot its own size");
    layout = resizeTerminal(layout, 5_000, room);
    assert.equal(layout.sizes.left, room.width - TERMINAL_SIZE.chatWidth);
    layout = resizeTerminal(moveTerminal(layout, "top"), 10, room);
    assert.equal(layout.sizes.top, TERMINAL_SIZE.minHeight);
    assert.equal(clampDock("bottom", 9_999, room), room.height - TERMINAL_SIZE.chatHeight);
    // a window too small for both still gives the terminal its minimum
    assert.equal(clampDock("right", 400, { width: 300, height: 300 }), TERMINAL_SIZE.minWidth);
  });

  test("a split is a share of the width, kept as a share", () => {
    const split = arrangeTerminal(DEFAULT_LAYOUT, "split");
    assert.equal(shownSize(split, room), 600);
    const wider = resizeTerminal(split, 720, room);
    assert.equal(wider.split, 0.6);
    assert.equal(shownSize(wider, { width: 1000, height: 800 }), 600);
    assert.equal(wider.sizes.right, DEFAULT_LAYOUT.sizes.right, "a split drag changed the docked size");
  });

  test("kept between visits, with the old height key still written", () => {
    const store = memory();
    const kept = createTerminalLayout(store);
    kept.set(resizeTerminal(DEFAULT_LAYOUT, 300, room));
    assert.equal(store.kept.get(TERMINAL_HEIGHT_KEY), "300");
    assert.equal(createTerminalLayout(store).get().sizes.bottom, 300);
    assert.equal(JSON.parse(store.kept.get(TERMINAL_LAYOUT_KEY)!).position, "bottom");
  });

  test("a store that refuses writes holds the choice for the visit", () => {
    const kept = createTerminalLayout(memory({}, true));
    kept.set(moveTerminal(DEFAULT_LAYOUT, "left"));
    kept.sync();
    assert.equal(kept.get().position, "left", "a failed write was undone by the next sync");
  });
});

describe("how it draws", () => {
  test("the defaults are the terminal it has always been", () => {
    assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
    assert.equal(DEFAULT_PREFS.cursorStyle, "bar");
    assert.equal(DEFAULT_PREFS.scrollback, 10_000);
  });

  test("only the listed choices are taken from storage", () => {
    const odd = parsePrefs(JSON.stringify({ cursorStyle: "beam", cursorBlink: "yes", copyOnSelect: true, scrollback: 7, fontSize: 300 }));
    assert.equal(odd.cursorStyle, DEFAULT_PREFS.cursorStyle);
    assert.equal(odd.cursorBlink, DEFAULT_PREFS.cursorBlink);
    assert.equal(odd.copyOnSelect, true);
    assert.equal(odd.scrollback, DEFAULT_PREFS.scrollback);
    assert.equal(odd.fontSize, FONT_SIZE.max);
    assert.deepEqual(parsePrefs("nonsense"), DEFAULT_PREFS);
    const fine = parsePrefs(JSON.stringify({ cursorStyle: "underline", cursorBlink: false, scrollback: 1000, fontSize: 15 }));
    assert.deepEqual([fine.cursorStyle, fine.cursorBlink, fine.scrollback, fine.fontSize], ["underline", false, 1000, 15]);
  });

  test("text size steps within its range and resets", () => {
    let prefs = DEFAULT_PREFS;
    prefs = stepFont(prefs, 1);
    assert.equal(prefs.fontSize, FONT_SIZE.initial + 1);
    for (let i = 0; i < 40; i++) prefs = stepFont(prefs, -1);
    assert.equal(prefs.fontSize, FONT_SIZE.min);
    assert.equal(stepFont(prefs, 0).fontSize, FONT_SIZE.initial);
  });

  test("scrollback is said the way the menu says it", () => {
    assert.equal(scrollbackLabel(10_000), "10,000 lines");
    assert.equal(scrollbackLabel(1_000), "1,000 lines");
  });

  test("kept between visits", () => {
    const store = memory();
    createTerminalPrefs(store).set({ ...DEFAULT_PREFS, copyOnSelect: true });
    assert.equal(JSON.parse(store.kept.get(TERMINAL_PREFS_KEY)!).copyOnSelect, true);
    assert.equal(createTerminalPrefs(store).get().copyOnSelect, true);
  });
});

describe("tabs", () => {
  test("stepping wraps at either end", () => {
    const ids = ["a", "b", "c"];
    assert.equal(stepTab(ids, "a", 1), "b");
    assert.equal(stepTab(ids, "c", 1), "a");
    assert.equal(stepTab(ids, "a", -1), "c");
    assert.equal(stepTab(ids, "gone", 1), "a");
    assert.equal(stepTab([], "a", 1), null);
  });

  test("closing the open tab opens its neighbour, and closing another changes nothing", () => {
    const ids = ["a", "b", "c"];
    assert.equal(activeAfterClose(ids, "b", "b"), "c");
    assert.equal(activeAfterClose(ids, "c", "c"), "b");
    assert.equal(activeAfterClose(ids, "a", "c"), "c");
    assert.equal(activeAfterClose(["a"], "a", "a"), null);
    assert.equal(activeAfterClose(ids, "a", null), "b");
  });
});

describe("the terminal's keys", () => {
  const press = (over: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  });

  test("⌃` and ⌃⇧` are Control on every platform, and shift does not change the key", () => {
    for (const platform of ["mac", "other"] as const) {
      assert.equal(terminalChord(press({ code: "Backquote", key: "`", ctrlKey: true }), platform), "toggle");
      // a tilde is what shift makes of the key on most layouts
      assert.equal(terminalChord(press({ code: "Backquote", key: "~", ctrlKey: true, shiftKey: true }), platform), "new");
      assert.equal(terminalChord(press({ code: "KeyW", key: "W", ctrlKey: true, shiftKey: true }), platform), "close");
    }
    // a key event with no code is read by its character
    assert.equal(terminalChord(press({ key: "`", ctrlKey: true }), "mac"), "toggle");
    assert.equal(terminalChord(press({ key: "}", metaKey: true, shiftKey: true }), "mac"), "next");
    // but a code, where there is one, wins over the character
    assert.equal(terminalChord(press({ key: "`", code: "KeyA", ctrlKey: true }), "mac"), null);
    // ⌘` on a Mac cycles windows and is not ours
    assert.equal(terminalChord(press({ code: "Backquote", metaKey: true }), "mac"), null);
  });

  test("tab stepping and the full window are ⌘ on a Mac and Ctrl elsewhere", () => {
    assert.equal(terminalChord(press({ code: "BracketRight", key: "}", metaKey: true, shiftKey: true }), "mac"), "next");
    assert.equal(terminalChord(press({ code: "BracketLeft", key: "{", metaKey: true, shiftKey: true }), "mac"), "previous");
    assert.equal(terminalChord(press({ code: "BracketRight", ctrlKey: true, shiftKey: true }), "other"), "next");
    assert.equal(terminalChord(press({ code: "BracketRight", ctrlKey: true, shiftKey: true }), "mac"), null);
    assert.equal(terminalChord(press({ key: "Enter", code: "Enter", metaKey: true, shiftKey: true }), "mac"), "fill");
    // without shift, ⌘[ is back and ⌘↩ sends: not ours
    assert.equal(terminalChord(press({ code: "BracketLeft", metaKey: true }), "mac"), null);
    assert.equal(terminalChord(press({ key: "Enter", metaKey: true }), "mac"), null);
  });

  test("everything else is the shell's", () => {
    for (const key of [
      press({ key: "c", code: "KeyC", ctrlKey: true }),
      press({ key: "w", code: "KeyW", ctrlKey: true }),
      press({ key: "Escape", code: "Escape" }),
      press({ code: "Backquote", ctrlKey: true, altKey: true }),
    ]) {
      assert.equal(terminalChord(key, "mac"), null);
      assert.equal(terminalChord(key, "other"), null);
    }
  });

  test("the sheet lists them in each platform's words", () => {
    assert.deepEqual(keysFor("terminalToggle", "mac"), ["⌃`"]);
    assert.deepEqual(keysFor("terminalNew", "other"), ["Ctrl+Shift+`"]);
    assert.deepEqual(keysFor("terminalStep", "mac"), ["⇧⌘]", "⇧⌘["]);
    assert.deepEqual(keysFor("terminalStep", "other"), ["Ctrl+Shift+]", "Ctrl+Shift+["]);
  });
});

describe("a terminal in its own window", () => {
  test("is asked for by an agent id, and by nothing else", () => {
    assert.equal(terminalQuery("bot_abc-123"), "terminal=bot_abc-123");
    assert.equal(terminalAgent("bot_abc-123"), "bot_abc-123");
    for (const bad of ["", "../etc", "a b", "x&quick=1", "a".repeat(65), 7, null, undefined]) {
      assert.equal(terminalQuery(bad), null, String(bad));
    }
  });
});
