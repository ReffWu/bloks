// The conversation tabs' keys (GitHub 401): ⌘T, ⌘W, ⌘⇧[ and ⌘⇧], the
// arrows on a focused tab, whose a press is when the terminal wants the
// same one, and the menu bar's echo of a key the page has already heard.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  chordKey,
  chordOfMenu,
  closeRefusal,
  conversationChord,
  ECHO_MS,
  heardKey,
  isEcho,
  keysOwner,
  rovingTo,
  type ConversationChord,
  type KeysWhere,
} from "../src/lib/conversationKeys.ts";
import { terminalChord } from "../src/lib/terminalTabs.ts";

const press = (over: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("which keys are the tabs'", () => {
  test("⌘T, ⌘W, ⌘⇧[ and ⌘⇧] on a Mac", () => {
    assert.equal(conversationChord(press({ key: "t", code: "KeyT", metaKey: true }), "mac"), "new");
    assert.equal(conversationChord(press({ key: "w", code: "KeyW", metaKey: true }), "mac"), "close");
    assert.equal(conversationChord(press({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }), "mac"), "next");
    assert.equal(conversationChord(press({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }), "mac"), "previous");
    // with no code, the character is all there is
    assert.equal(conversationChord(press({ key: "}", metaKey: true, shiftKey: true }), "mac"), "next");
    // caps lock on
    assert.equal(conversationChord(press({ key: "W", code: "KeyW", metaKey: true }), "mac"), "close");
  });

  test("Ctrl everywhere else, and Control on a Mac is not ⌘", () => {
    assert.equal(conversationChord(press({ key: "t", ctrlKey: true }), "other"), "new");
    assert.equal(conversationChord(press({ key: "w", ctrlKey: true }), "other"), "close");
    assert.equal(conversationChord(press({ code: "BracketRight", key: "}", ctrlKey: true, shiftKey: true }), "other"), "next");
    assert.equal(conversationChord(press({ key: "t", ctrlKey: true }), "mac"), null);
    assert.equal(conversationChord(press({ key: "t", metaKey: true }), "other"), null);
  });

  test("the keys beside them stay what they were", () => {
    for (const key of [
      press({ key: "W", code: "KeyW", metaKey: true, shiftKey: true }), // Close Window
      press({ key: "T", code: "KeyT", metaKey: true, shiftKey: true }), // reopen, not offered
      press({ key: "[", code: "BracketLeft", metaKey: true }), // back
      press({ key: "]", code: "BracketRight", metaKey: true }), // forward
      press({ key: "w", code: "KeyW", metaKey: true, altKey: true }),
      press({ key: "n", code: "KeyN", metaKey: true }), // new agent
      press({ key: "Tab", code: "Tab", ctrlKey: true }), // recent conversations
      press({ key: "1", code: "Digit1", metaKey: true }), // a workspace
      press({ key: "t", code: "KeyT" }),
    ]) {
      assert.equal(conversationChord(key, "mac"), null, JSON.stringify(key));
    }
    // ⌃⇧W is the terminal's close on every platform
    assert.equal(conversationChord(press({ key: "W", code: "KeyW", ctrlKey: true, shiftKey: true }), "other"), null);
  });
});

describe("the terminal or the conversation, never both", () => {
  const everywhere: KeysWhere[] = [];
  for (const inTerminal of [false, true])
    for (const terminalCovers of [false, true])
      for (const inDialog of [false, true]) everywhere.push({ inTerminal, terminalCovers, inDialog });

  // what each of the two listeners does with a press, by the rules they
  // follow (ChatView.tsx and Terminal.tsx)
  const conversationActs = (e: ReturnType<typeof press>, where: KeysWhere) =>
    conversationChord(e, "mac") !== null && keysOwner(where) === "conversation";
  const terminalActs = (e: ReturnType<typeof press>, where: KeysWhere) => {
    const chord = terminalChord(e, "mac");
    const step = chord === "next" || chord === "previous";
    return step && keysOwner(where) === "terminal";
  };

  test("⌘⇧[ and ⌘⇧] are a step for both, and one of them takes it unless a dialog is up", () => {
    for (const key of [
      press({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }),
      press({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
    ]) {
      assert.ok(terminalChord(key, "mac") === "next" || terminalChord(key, "mac") === "previous");
      for (const where of everywhere) {
        const both = conversationActs(key, where) && terminalActs(key, where);
        assert.ok(!both, `both heard it at ${JSON.stringify(where)}`);
        const either = conversationActs(key, where) || terminalActs(key, where);
        assert.equal(either, !where.inDialog, JSON.stringify(where));
      }
    }
  });

  test("the terminal has them while it has the keyboard or the window", () => {
    const step = press({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true });
    assert.equal(terminalActs(step, { inTerminal: true, terminalCovers: false, inDialog: false }), true);
    assert.equal(terminalActs(step, { inTerminal: false, terminalCovers: true, inDialog: false }), true);
    // the panel merely open beside the conversation leaves them to it
    assert.equal(conversationActs(step, { inTerminal: false, terminalCovers: false, inDialog: false }), true);
  });

  test("in the terminal ⌘T and ⌘W are not the conversation's, and the shell keeps Ctrl+T and Ctrl+W", () => {
    const inTerminal = { inTerminal: true, terminalCovers: false, inDialog: false };
    for (const key of [press({ key: "t", metaKey: true }), press({ key: "w", metaKey: true })]) {
      assert.equal(conversationActs(key, inTerminal), false);
      assert.equal(terminalChord(key, "mac"), null);
    }
    // the terminal's own matcher leaves Ctrl+W to the shell, so it is typed
    assert.equal(terminalChord(press({ key: "w", code: "KeyW", ctrlKey: true }), "other"), null);
  });

  test("a dialog keeps every one of them from changing what is under it", () => {
    assert.equal(keysOwner({ inTerminal: false, terminalCovers: false, inDialog: true }), null);
    assert.equal(keysOwner({ inTerminal: true, terminalCovers: true, inDialog: true }), null);
  });
});

describe("closing the open one", () => {
  const tasks = [
    { id: "general", state: "idle" },
    { id: "b", state: "idle" },
    { id: "c", state: "working" },
  ];

  test("General, the first, stays, and so does the only one an agent has", () => {
    assert.equal(closeRefusal(tasks, "general"), "first");
    assert.equal(closeRefusal([], "thread"), "first");
    // a conversation the list does not have is not one to delete
    assert.equal(closeRefusal(tasks, "gone"), "first");
  });

  test("one at work is stopped first, and any other closes", () => {
    assert.equal(closeRefusal(tasks, "c"), "working");
    assert.equal(closeRefusal(tasks, "b"), null);
  });
});

describe("the arrows on a focused tab", () => {
  test("left and right along the strip, wrapping, and Home and End to its ends", () => {
    assert.equal(rovingTo("ArrowRight", 0, 3, "horizontal"), 1);
    assert.equal(rovingTo("ArrowRight", 2, 3, "horizontal"), 0);
    assert.equal(rovingTo("ArrowLeft", 0, 3, "horizontal"), 2);
    assert.equal(rovingTo("Home", 2, 3, "horizontal"), 0);
    assert.equal(rovingTo("End", 0, 3, "horizontal"), 2);
    // up and down are not the strip's
    assert.equal(rovingTo("ArrowDown", 0, 3, "horizontal"), null);
  });

  test("up and down along the sidebar's list", () => {
    assert.equal(rovingTo("ArrowDown", 0, 3, "vertical"), 1);
    assert.equal(rovingTo("ArrowUp", 0, 3, "vertical"), 2);
    assert.equal(rovingTo("End", 1, 3, "vertical"), 2);
    assert.equal(rovingTo("ArrowRight", 0, 3, "vertical"), null);
  });

  test("other keys, and a tab that is not in the list, go nowhere", () => {
    assert.equal(rovingTo("Enter", 0, 3, "horizontal"), null);
    assert.equal(rovingTo("ArrowRight", -1, 3, "horizontal"), null);
    assert.equal(rovingTo("ArrowRight", 0, 0, "horizontal"), null);
  });
});

describe("the menu bar's choices", () => {
  test("each is played as the key it names, which the page reads back as the same chord", () => {
    const words: Record<string, ConversationChord> = {
      newConversation: "new",
      closeConversation: "close",
      previousConversation: "previous",
      nextConversation: "next",
    };
    for (const [word, chord] of Object.entries(words)) {
      assert.equal(chordOfMenu(word), chord);
      for (const platform of ["mac", "other"] as const) {
        const init = chordKey(chord, platform);
        const e = press({
          key: init.key,
          code: init.code,
          metaKey: init.metaKey,
          ctrlKey: init.ctrlKey,
          shiftKey: init.shiftKey,
        });
        assert.equal(conversationChord(e, platform), chord, `${word} on ${platform}`);
      }
    }
    assert.equal(chordOfMenu("settings"), null);
    assert.equal(chordOfMenu(null), null);
  });

  test("a stepping key played from the menu reaches the terminal the same way, so it wins there too", () => {
    const init = chordKey("next", "mac");
    const e = press({ key: init.key, code: init.code, metaKey: init.metaKey, shiftKey: init.shiftKey });
    assert.equal(terminalChord(e, "mac"), "next");
  });

  test("a choice right after the page heard the key itself is that same press, and is dropped", () => {
    heardKey("close", 1000);
    assert.equal(isEcho("close", 1000 + 20), true);
    assert.equal(isEcho("close", 1000 + ECHO_MS + 1), false, "pressed again later");
    assert.equal(isEcho("new", 1000 + 20), false, "another key");
  });
});
