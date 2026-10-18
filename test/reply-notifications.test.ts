import assert from "node:assert/strict";
import { test } from "node:test";
import { clipReply, ReplyNotifications, settledFrame, settledReply } from "../server/reply-notifications.ts";
import { memberFrame, type MemberView } from "../server/member-access.ts";
import { NoticeDelivery, noticeFor, settlesReplies } from "../src/lib/notify.ts";
import type { Message } from "../server/store.ts";
const m = (id = "m", text = "Report ready"): Message => ({ id, at: 20, role: "bot", kind: "text", text });
const ok = { continues: false, quiet: false, maintenance: false };
const ctx = { focused: false, selectedId: "", threadId: "lane", bot: { id: "bot", name: "Helper" } };
function start(goal = false) { const h = new ReplyNotifications(); h.start("lane", "t", "lane", "bot", goal); return h; }

test("ordinary running text, including a plain question, is never a notification", () => {
  for (const text of ["Which date?", "Checking the sources", "A substantive interim answer"]) assert.equal(noticeFor(m("m", text), ctx), null);
  assert.equal(noticeFor(m(), { ...ctx, replySettled: true })?.body, "Report ready");
});
test("only committed same-attempt nonempty text can be a preview", () => {
  const h = start(); h.text("lane", "old", m("wrong")); h.text("lane", "t", m("empty", " "));
  assert.equal(settledReply(h.take("lane", "t"), ok), null);
  assert.equal(settledReply(h.take("lane", "t"), ok), null);
});
test("prefer explicit final over trailing commentary, without changing saved text", () => {
  const h = start(), saved = m("final", "The answer");
  h.text("lane", "t", m("question", "Which date?")); h.text("lane", "t", saved, "final_answer");
  h.text("lane", "t", m("progress", "Still tidying"), "commentary");
  assert.deepEqual(settledReply(h.take("lane", "t"), ok)?.message, saved);
});
for (const origin of ["person", "agent"]) test(`known commentary-only ${origin} turn is never unmarked fallback`, () => {
  const h = start(); h.text("lane", "t", m(), "commentary"); assert.equal(settledReply(h.take("lane", "t"), ok), null);
});
test("unknown or partial phase uses last unmarked text, not a guessed question", () => {
  const h = start(); h.text("lane", "t", m("q", "Which date?")); h.text("lane", "t", m("p", "Checking later"));
  assert.equal(settledReply(h.take("lane", "t"), ok)?.message.id, "p");
});
test("a turn that saved a reply and then failed still says it once", () => {
  const h = start(); h.text("lane", "t", m("said", "Half the report"));
  assert.equal(settledReply(h.take("lane", "t"), { ...ok, stopReason: "error" })?.message.id, "said");
});
for (const change of [{ stopReason: "interrupted" }, { continues: true }, { quiet: true }, { maintenance: true }]) test(`no preview at excluded boundary ${JSON.stringify(change)}`, () => {
  const h = start(); h.text("lane", "t", m(), "final_answer"); assert.equal(settledReply(h.take("lane", "t"), { ...ok, ...change }), null);
});
test("goal ownership survives later status changes and quiet/deleted text stays excluded", () => {
  const h = start(true); h.text("lane", "t", m()); assert.equal(settledReply(h.take("lane", "t"), ok), null);
  const other = start(); other.text("lane", "t", { ...m(), quiet: true }); other.text("lane", "t", { ...m(), deleted: true });
  assert.equal(settledReply(other.take("lane", "t"), ok), null);
});
test("an empty backup cannot inherit failed words and stale completion cannot drain a new attempt", () => {
  const h = start(); h.text("lane", "t", m("failed")); h.take("lane", "t");
  h.start("lane", "backup", "lane", "bot", false);
  assert.equal(h.take("lane", "t"), undefined);
  assert.equal(settledReply(h.take("lane", "backup"), ok), null);
});
test("room speakers are independent snapshots and events have no history insertion kind", () => {
  const h = start(); h.start("room-lane", "other", "room", "second", false);
  h.text("room-lane", "other", { ...m("second"), from: "second" }); h.text("lane", "t", m());
  assert.equal(settledReply(h.take("room-lane", "other"), ok)?.threadId, "room");
  assert.equal(settledReply(h.take("lane", "t"), ok)?.kind, "reply.settled");
});
test("actual member projector rejects pre-join, hidden, deleted and cross-room snapshots", () => {
  const view: MemberView = { joinedAt: 10, history: "join", activityDetail: false };
  const frame = { kind: "reply.settled", threadId: "room", botId: "bot", turnId: "t", message: m() };
  const mine = (id: string) => id === "room" ? view : null;
  assert.deepEqual(memberFrame(frame, mine), frame);
  assert.equal(memberFrame({ ...frame, threadId: "other" }, mine), null);
  for (const message of [{ ...m(), at: 9 }, { ...m(), kind: "screen" }, { ...m(), deleted: true }]) assert.equal(memberFrame({ ...frame, message }, mine), null);
});
test("consume watching/disabled outcomes once, including snapshot arriving before history", () => {
  const d = new NoticeDelivery(); d.hello(10);
  assert.ok(d.take(11, "t")); assert.equal(noticeFor(m(), { ...ctx, replySettled: true, focused: true, selectedId: "bot" }), null);
  assert.equal(d.take(12, "t"), false, "focus change replayed consumed snapshot");
  assert.ok(d.take(13, "next")); assert.equal(noticeFor(m(), { ...ctx, replySettled: true, bot: { ...ctx.bot, notifications: false } }), null);
  assert.equal(d.take(14, "next"), false);
  assert.ok(d.take(15, "third")); assert.equal(noticeFor(m("not-hydrated"), { ...ctx, replySettled: true })?.body, "Report ready");
});
test("reconnect, server sequence reset, replay and duplicate requests do not announce history", () => {
  const d = new NoticeDelivery(); assert.equal(d.take(1, "no-hello"), false); d.hello(10);
  assert.equal(d.take(10, "old"), false); assert.ok(d.take(11, "request:r")); assert.equal(d.take(12, "request:r"), false);
  d.reconnect(); assert.equal(d.take(13, "between"), false); d.hello(20); assert.equal(d.take(19, "old"), false);
  d.reconnect(); d.hello(0); assert.ok(d.take(1, "new-boot")); assert.equal(d.take(1, "new-boot"), false);
  for (const bad of [undefined, NaN, -1, 1.5]) assert.equal(d.take(bad, "bad"), false);
});
test("two genuine results inside four seconds survive, while dedup state stays bounded", () => {
  const d = new NoticeDelivery(); d.hello(0); assert.ok(d.take(1, "first")); assert.ok(d.take(2, "second"));
  for (let i = 3; i < 2000; i++) assert.ok(d.take(i, `t${i}`));
  assert.equal((d as unknown as { keys: Set<string> }).keys.size, 512, "identity retention grew without bound");
  assert.equal(d.take(1, "first"), false, "evicted identity bypassed sequence watermark");
});
test("the settled frame carries no more of a reply than a banner shows, and the same words", () => {
  const h = start(); const long = m("long", "word\n\n ".repeat(400)); h.text("lane", "t", long);
  const reply = settledReply(h.take("lane", "t"), ok)!;
  const frame = settledFrame(reply, long)!;
  assert.ok(frame.message.text!.length <= 180, `carried ${frame.message.text!.length} characters`);
  assert.equal(noticeFor(frame.message, { ...ctx, replySettled: true })?.body, noticeFor(long, { ...ctx, replySettled: true })?.body);
  assert.equal(clipReply("  short\n reply "), "short reply");
  assert.equal(clipReply(frame.message.text!), frame.message.text, "clipping twice changed the words");
});
test("the settled frame reads the transcript as it is now", () => {
  const h = start(); h.text("lane", "t", m("chosen", "First words"));
  const reply = settledReply(h.take("lane", "t"), ok)!;
  assert.equal(settledFrame(reply, { ...m("chosen", "Edited words") })?.message.text, "Edited words");
  assert.equal(settledFrame(reply, { ...m("chosen"), deleted: true, text: "" }), null);
  assert.equal(settledFrame(reply, { ...m("chosen"), quiet: true }), null);
  assert.equal(settledFrame(reply, m("other")), null);
  assert.equal(settledFrame(reply, undefined), null);
});
test("a desktop knows a server that says replies when they settle from one that does not", () => {
  assert.equal(settlesReplies({ app: "bloks", features: ["sections", "reply-settled"] }), true);
  // an older server: replies are announced as they land, as before
  assert.equal(settlesReplies({ app: "bloks", features: ["sections"] }), false);
  assert.equal(settlesReplies({ app: "bloks" }), false);
  // not a reading at all keeps what was known
  for (const health of [null, undefined, "nope", { error: "the other computer could not be reached" }]) assert.equal(settlesReplies(health), null);
});
