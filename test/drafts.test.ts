// What was being written in one conversation stays with it.
//
// The composer was one box for every agent, so a half-written message and
// its attachments followed you to the next agent and Enter sent them
// there. Each conversation keeps its own draft now.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  askLaneFocus,
  boxFor,
  carryFocus,
  dropLaneFocus,
  isEmptyDraft,
  keepDraft,
  LANE_FOCUS_TTL,
  readDraft,
  showBox,
  takeBack,
  takeFocus,
  takeLaneFocus,
} from "../src/lib/drafts.ts";

test("a draft stays with its conversation and is found there again", () => {
  keepDraft("agent-a:lane-1", { text: "for a", attachments: [{ id: "chip" }] });
  assert.deepEqual(readDraft("agent-b:lane-1"), { text: "", attachments: [] });
  // another lane of the same agent is another conversation
  assert.deepEqual(readDraft("agent-a:lane-2"), { text: "", attachments: [] });
  assert.deepEqual(readDraft("agent-a:lane-1"), { text: "for a", attachments: [{ id: "chip" }] });
});

test("a box left empty forgets what it held", () => {
  keepDraft("agent-c:lane-1", { text: "half a thought", attachments: [] });
  keepDraft("agent-c:lane-1", { text: "  \n", attachments: [] });
  assert.deepEqual(readDraft("agent-c:lane-1"), { text: "", attachments: [] });
});

test("a send that failed comes back to an empty box, chips and all", () => {
  // The box clears the moment you press Enter. A refusal after that used
  // to take the message with it, leaving only an error to say it existed.
  const sent = { text: "the plan for Friday", attachments: [{ id: "notes.pdf" }] };
  assert.deepEqual(takeBack({ text: "", attachments: [] }, sent), sent);
});

test("a send that failed leaves alone what was typed since", () => {
  const sent = { text: "the plan for Friday", attachments: [] };
  assert.equal(takeBack({ text: "actually, Monday", attachments: [] }, sent), null);
  assert.equal(takeBack({ text: "", attachments: [{ id: "chart.png" }] }, sent), null);
});

test("chips alone are a draft worth keeping", () => {
  assert.equal(isEmptyDraft({ text: "", attachments: [{ id: "chip" }] }), false);
  assert.equal(isEmptyDraft({ text: " ", attachments: [] }), true);
  assert.equal(isEmptyDraft(undefined), true);
});

test("a failed send reaches the box on screen for its conversation, not a draft nothing reads", () => {
  const got: unknown[] = [];
  const hide = showBox<string>("bot:lane", (sent) => got.push(sent));
  boxFor<string>("bot:lane")?.({ text: "the words", attachments: [] });
  assert.deepEqual(got, [{ text: "the words", attachments: [] }]);
  hide();
  assert.equal(boxFor("bot:lane"), undefined);
});

test("a box that went away does not unregister the one that replaced it", () => {
  const hideOld = showBox("bot:lane", () => {});
  const replacement = () => {};
  showBox("bot:lane", replacement);
  hideOld();
  assert.equal(boxFor("bot:lane"), replacement);
});

test("the keyboard is carried to the next box once", () => {
  carryFocus(true);
  assert.equal(takeFocus(), true);
  assert.equal(takeFocus(), false);
  carryFocus(false);
  assert.equal(takeFocus(), false);
});

// GitHub 400: a conversation made with a + or a menu puts the keyboard in
// its own box once that box shows, and never takes it from somewhere you
// went while it was being made.
describe("the keyboard and a new conversation", () => {
  const plus = { name: "the + that made it" };
  const elsewhere = { name: "another field" };

  test("the new conversation's box takes it from the + that made it", () => {
    askLaneFocus("a", "general", plus, 0);
    assert.equal(takeLaneFocus("a", "lane-2", plus, false, 10), true);
    // once: a later box is an ordinary switch
    assert.equal(takeLaneFocus("a", "lane-3", plus, false, 20), false);
  });

  test("when what was clicked has gone, a menu item or the old box, the keyboard is nowhere and it still does", () => {
    askLaneFocus("a", "general", plus, 0);
    assert.equal(takeLaneFocus("a", "lane-2", null, false, 10), true);
  });

  test("the agent's own box opening first, from the sidebar's +, is not the new one", () => {
    askLaneFocus("a", "general", plus, 0);
    assert.equal(takeLaneFocus("a", "general", plus, false, 5), false);
    assert.equal(takeLaneFocus("a", "lane-2", plus, false, 10), true);
  });

  test("a slow answer leaves the keyboard where you took it in the meantime", () => {
    askLaneFocus("a", "general", plus, 0);
    assert.equal(takeLaneFocus("a", "lane-2", elsewhere, false, 4000), false);
    askLaneFocus("a", "general", plus, 0);
    assert.equal(takeLaneFocus("a", "lane-2", plus, true, 4000), false, "a dialog opened meanwhile keeps it");
  });

  test("another agent's box means you went elsewhere, and coming back later takes nothing", () => {
    askLaneFocus("a", "general", null, 0);
    assert.equal(takeLaneFocus("b", "general", null, false, 10), false);
    assert.equal(takeLaneFocus("a", "lane-2", null, false, 20), false);
  });

  test("an ask that was refused, or waited too long, is gone", () => {
    const asked = askLaneFocus("a", "general", plus, 0);
    dropLaneFocus(asked);
    assert.equal(takeLaneFocus("a", "lane-2", plus, false, 10), false);
    askLaneFocus("a", "general", plus, 0);
    assert.equal(takeLaneFocus("a", "lane-2", plus, false, LANE_FOCUS_TTL + 1), false);
  });

  test("dropping an older ask leaves a newer one alone", () => {
    const first = askLaneFocus("a", "general", plus, 0);
    askLaneFocus("a", "general", plus, 5);
    dropLaneFocus(first);
    assert.equal(takeLaneFocus("a", "lane-2", plus, false, 10), true);
  });

  test("the new box starts empty, and the draft left behind stays where it was written", () => {
    keepDraft("a:general", { text: "half a thought", attachments: [] });
    askLaneFocus("a", "general", plus, 0);
    assert.equal(takeLaneFocus("a", "lane-2", plus, false, 10), true);
    assert.deepEqual(readDraft("a:lane-2"), { text: "", attachments: [] });
    assert.equal(readDraft("a:general").text, "half a thought");
    keepDraft("a:general", { text: "", attachments: [] });
  });
});
