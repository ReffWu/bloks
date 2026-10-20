// A workspace in the background says what needs the person to the
// desktop app (server/desktop-notice.ts). Its rules are the window's
// rules (src/lib/notify.ts) with nobody watching, so the two are held to
// the same answer here, message by message: a background workspace must
// not be louder, or quieter, than the same workspace on screen.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SaidOnce, desktopNotice, noticeKey, unreadCount, type NoticeContext } from "../server/desktop-notice.ts";
import { noticeFor } from "../src/lib/notify.ts";

const bot = { id: "bot-1", name: "Researcher", notifications: true, avatarAt: 5 };
const quietBot = { id: "bot-2", name: "Quiet one", notifications: false };
const room = { id: "room-1", name: "Launch" };

function ctx(over: Partial<{ bot: typeof bot | typeof quietBot | null; room: typeof room | null; goal: boolean }> = {}): NoticeContext {
  return {
    bot: () => (over.bot === undefined ? bot : over.bot),
    room: () => (over.room === undefined ? null : over.room),
    goalRunning: () => over.goal === true,
  };
}

const CASES: Array<{ name: string; message: Record<string, unknown> }> = [
  { name: "an approval", message: { id: "a", role: "bot", kind: "options", card: { requestId: "r1", title: "Approval needed", subtitle: "Run rm -rf build" } } },
  { name: "a workflow's approval", message: { id: "w", role: "bot", kind: "options", card: { runId: "run", title: "Ship it?", subtitle: "Step 3" } } },
  { name: "a question already answered", message: { id: "b", role: "bot", kind: "options", card: { requestId: "r2", title: "Which?", answered: "A" } } },
  { name: "a question dismissed", message: { id: "c", role: "bot", kind: "options", card: { requestId: "r3", title: "Which?", dismissed: true } } },
  { name: "a card that asks nothing", message: { id: "d", role: "bot", kind: "options", card: { title: "Pick one" } } },
  { name: "a blocked goal", message: { id: "e", role: "bot", kind: "notice", goal: "blocked", text: "Needs the API key" } },
  { name: "a finished goal", message: { id: "f", role: "bot", kind: "notice", goal: "done", text: "Tests pass" } },
  { name: "a goal out of turns", message: { id: "g", role: "bot", kind: "notice", goal: "out", text: "Ran out" } },
  { name: "a paused goal", message: { id: "h", role: "bot", kind: "notice", goal: "paused", text: "Paused" } },
  { name: "a chain hold", message: { id: "i", role: "bot", kind: "notice", chainHeld: true, goal: "blocked", text: "billing" } },
  { name: "an incident for the person", message: { id: "j", role: "bot", kind: "notice", incident: { kind: "needs-you" }, text: "The routine failed" } },
  { name: "an incident note", message: { id: "k", role: "bot", kind: "notice", incident: { kind: "note" }, text: "For the lead" } },
  { name: "a resolved incident", message: { id: "l", role: "bot", kind: "notice", incident: { kind: "needs-you", state: "resolved" }, text: "Fixed" } },
  { name: "a routine that stopped", message: { id: "m", role: "bot", kind: "notice", failing: { kind: "routine" }, text: "Stopped after 3 failures" } },
  { name: "an engine out of credits", message: { id: "n", role: "bot", kind: "notice", text: "Your credit balance is too low" } },
  { name: "an ordinary notice", message: { id: "o", role: "bot", kind: "notice", text: "Switched model" } },
  { name: "a person's own message", message: { id: "p", role: "user", kind: "text", text: "hello" } },
  { name: "a quiet check-in", message: { id: "q", role: "bot", kind: "options", quiet: true, card: { requestId: "r4", title: "x" } } },
  { name: "a deleted card", message: { id: "r", role: "bot", kind: "options", deleted: true, card: { requestId: "r5", title: "x" } } },
  { name: "a long question", message: { id: "s", role: "bot", kind: "options", card: { requestId: "r6", subtitle: "word ".repeat(80) } } },
];

for (const { name, message } of CASES) {
  for (const where of ["agent", "room", "quiet agent"] as const) {
    test(`${name}, in ${where === "room" ? "a room" : `a conversation with ${where === "agent" ? "an agent" : "a quiet agent"}`}: the same as the window`, () => {
      const here = where === "room" ? ctx({ room, bot: null }) : where === "agent" ? ctx() : ctx({ bot: quietBot });
      const frame = { kind: "message", threadId: "t", message };
      const desktop = desktopNotice(frame, here);
      const shown = noticeFor(message as never, {
        focused: false,
        selectedId: "",
        threadId: "t",
        ...(where === "room" ? { room } : { bot: where === "agent" ? bot : quietBot }),
      });
      assert.equal(desktop === null, shown === null, `desktop ${JSON.stringify(desktop)} window ${JSON.stringify(shown)}`);
      if (!desktop || !shown) return;
      assert.equal(desktop.title, shown.title);
      assert.equal(desktop.body, shown.body);
      assert.equal(desktop.target, shown.target);
      assert.equal(desktop.level === "needs-me", shown.urgent, "needs-me is exactly what the window calls urgent");
    });
  }
}

test("a settled reply is activity, and only where the window would say it", () => {
  const reply = { kind: "reply.settled", threadId: "t", botId: bot.id, turnId: "u", message: { id: "x", role: "bot", kind: "text", text: "Report ready" } };
  const said = desktopNotice(reply, ctx());
  assert.deepEqual(said, { level: "activity", title: "Researcher", body: "Report ready", target: bot.id, avatar: "/api/bots/bot-1/avatar?v=5" });
  assert.equal(desktopNotice(reply, ctx({ bot: quietBot })), null, "an agent asked not to interrupt");
  assert.equal(desktopNotice(reply, ctx({ goal: true })), null, "a goal says its piece at its end");
  assert.equal(desktopNotice(reply, ctx({ room, bot: null })), null, "a room reply is coordination");
  const window = noticeFor(reply.message as never, { replySettled: true, focused: false, selectedId: "", threadId: "t", bot });
  assert.equal(window?.title, said?.title);
});

test("a patch is news only as the incident desk's card for the person", () => {
  const card = { id: "card", role: "bot", kind: "notice", incident: { id: "inc-1", kind: "needs-you" }, text: "Three routines failed" };
  assert.equal(desktopNotice({ kind: "message.patch", threadId: "t", message: card }, ctx())?.level, "needs-me");
  assert.equal(desktopNotice({ kind: "message.patch", threadId: "t", message: { ...card, incident: undefined, kind: "options", card: { requestId: "z" } } }, ctx()), null);
});

test("frames about nothing in this workspace, or not about a message, say nothing", () => {
  const approval = CASES[0].message;
  assert.equal(desktopNotice({ kind: "message", threadId: "t", message: approval }, ctx({ bot: null })), null);
  assert.equal(desktopNotice({ kind: "bot", bot: { id: "x" } }, ctx()), null);
  assert.equal(desktopNotice({ kind: "message", message: approval }, ctx()), null);
  assert.equal(desktopNotice(null, ctx()), null);
});

test("the same card is said once, however often its frame comes", () => {
  const said = new SaidOnce();
  const frame = { kind: "message", threadId: "t", message: CASES[0].message };
  assert.equal(said.take(noticeKey(frame)), true);
  assert.equal(said.take(noticeKey(frame)), false);
  assert.equal(said.take(noticeKey({ ...frame, message: { ...CASES[0].message, card: { requestId: "other" } } })), true);
  for (let i = 0; i < 600; i++) said.take(`k${i}`);
  assert.equal(said.take(noticeKey(frame)), true, "and forgotten once it is long past");
});

test("the waiting count is the Dock badge's count", () => {
  assert.equal(unreadCount([{ unread: true }, { unread: true, archivedAt: 5 }, { unread: false }, {}]), 1);
});
