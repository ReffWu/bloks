// "Your answer is ready" on the person's phone (GitHub 384): the rule on
// its own, then the real server with a stand-in relay and a paired
// synthetic phone, a turn held open by a provider that answers on cue.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import {
  AnswerReady,
  answerDue,
  answersAllowed,
  attentionFrom,
  Viewing,
  VIEWING_FRESH_MS,
  viewingReport,
  type AnswerEnd,
} from "../server/answer-ready.ts";
import { deviceKey, open, peek } from "../server/relay-crypto.ts";
import { onScreen } from "../src/lib/viewing.ts";
import { startHarness, type Harness } from "./helpers/server.ts";
import { agentOn, fakeProvider, idle, waitFor } from "./helpers/turns.ts";

const due: AnswerEnd = {
  asked: true,
  ok: true,
  laneId: "lane",
  replyIn: "lane",
  personal: false,
  notifications: true,
  goalRunning: false,
  allowed: true,
  viewed: false,
};

test("an answer the person asked for is due, and each reason not to holds it back", () => {
  assert.equal(answerDue(due), true);
  for (const [field, value] of [
    ["asked", false],
    ["ok", false],
    ["replyIn", null],
    ["replyIn", "room"],
    ["personal", true],
    ["notifications", false],
    ["goalRunning", true],
    ["allowed", false],
    ["viewed", true],
  ] as const) {
    assert.equal(answerDue({ ...due, [field]: value }), false, `${field}: ${String(value)} still notified`);
  }
});

test("reading counts only while it is said, for the conversation it names", () => {
  let now = 1_000;
  const v = new Viewing(() => now);
  assert.equal(v.sees("lane"), false, "being connected is not reading");
  assert.equal(v.say("here:w-one", "lane", 1), true);
  assert.equal(v.sees("lane"), true);
  assert.equal(v.sees("other"), false, "another conversation on screen does not hold this one back");
  // a word that crossed with a newer one changes nothing
  assert.equal(v.say("here:w-one", "other", 3), true);
  assert.equal(v.say("here:w-one", "lane", 2), false);
  assert.equal(v.sees("lane"), false);
  // put away
  v.say("here:w-one", "lane", 4);
  v.say("here:w-one", null, 5);
  assert.equal(v.sees("lane"), false);
  // a client that went to sleep without saying so stops counting
  v.say("phone:w-two", "lane", 1);
  now += VIEWING_FRESH_MS - 1;
  assert.equal(v.sees("lane"), true);
  now += 2;
  assert.equal(v.sees("lane"), false, "a stale word still held the answer back");
  // and an unpaired device's word goes with it
  v.say("phone:w-two", "lane", 2);
  v.forget("phone:");
  assert.equal(v.sees("lane"), false);
});

test("a viewing word is read strictly", () => {
  assert.deepEqual(viewingReport({ viewer: "w-abcdef", threadId: "lane-1", seq: 3 }), { viewer: "w-abcdef", threadId: "lane-1", seq: 3 });
  assert.deepEqual(viewingReport({ viewer: "w-abcdef", threadId: null, seq: 0 }), { viewer: "w-abcdef", threadId: null, seq: 0 });
  for (const body of [{}, { viewer: "x", threadId: null, seq: 1 }, { viewer: "w-abcdef", threadId: "../x", seq: 1 }, { viewer: "w-abcdef", seq: 1 }, { viewer: "w-abcdef", threadId: null, seq: -1 }, null]) {
    assert.ok("error" in viewingReport(body), JSON.stringify(body));
  }
});

test("a window says a conversation is on screen only while it is shown and focused", () => {
  assert.equal(onScreen("lane", { visible: true, focused: true }), "lane");
  assert.equal(onScreen("lane", { visible: false, focused: true }), null);
  assert.equal(onScreen("lane", { visible: true, focused: false }), null);
  assert.equal(onScreen(null, { visible: true, focused: true }), null);
});

test("the workspace's mute and level hold an answer back the way they hold a banner", () => {
  const now = 10_000;
  assert.equal(answersAllowed(null, now), true, "a server no desktop started is not muted");
  assert.equal(answersAllowed(attentionFrom({ mute: null, notify: "all" }), now), true);
  assert.equal(answersAllowed(attentionFrom({ mute: now + 1, notify: "all" }), now), false);
  assert.equal(answersAllowed(attentionFrom({ mute: now - 1, notify: "all" }), now), true, "a mute that ran out is over");
  assert.equal(answersAllowed(attentionFrom({ mute: "forever", notify: "all" }), now), false);
  assert.equal(answersAllowed(attentionFrom({ mute: null, notify: "needs-me" }), now), false);
  assert.equal(answersAllowed(attentionFrom({ mute: null, notify: "nothing" }), now), false);
  assert.equal(attentionFrom({ notify: "loud" }), null);
});

test("the desktop app hands each workspace's mute and level to its server, which keeps them", () => {
  const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  assert.match(main, /postMessage\(\{ kind: "attention", mute: ws\.mute \?\? null, notify: ws\.notify \?\? "all" \}\)/);
  // as each server starts or comes back, and whenever the list changes
  assert.equal(main.match(/handAttention\(run\);/g)?.length, 3);
  const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(server, /kind === "attention"\) attention = attentionFrom\(message\.data\)/);
  assert.match(server, /allowed: answersAllowed\(attention\)/);
});

test("one turn wakes the phone once, however often its end is seen", () => {
  const a = new AnswerReady();
  assert.equal(a.take("t1"), false, "nothing marked, nothing to wake");
  assert.equal(a.ready("t1"), true);
  assert.equal(a.take("t1"), true);
  assert.equal(a.take("t1"), false, "a replayed frame woke the phone again");
  assert.equal(a.ready("t1"), false, "a turn already announced was marked again");
  assert.equal(a.take(undefined), false);
});

// ── the real server ────────────────────────────────────────────────────

interface Wake {
  reason: string;
  clients?: string[];
  preview?: any;
}

/** A loopback relay and one paired synthetic phone: every wake it is
 * asked for, with the preview opened with the phone's own key. */
async function phoneRelay(t: TestContext, h: Harness) {
  await h.json("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const claimed = await h.json("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Example phone" }) });
  const digest = createHash("sha256").update(claimed.token).digest("hex");
  const key = deviceKey(digest, "mac-to-phone");
  const wakes: Wake[] = [];
  let connected = false;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/space/agent/stream")) {
      connected = true;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ kind: "hello", spaceId: "example-space" })}\n\n`);
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const pushed = JSON.parse(body || "{}");
      const wake = pushed.wake;
      if (wake && typeof wake === "object") {
        const sealed = wake.sealed?.[claimed.device.id];
        wakes.push({ reason: wake.reason, clients: wake.clients, ...(sealed ? { preview: open(key, peek(sealed)!) } : {}) });
      } else if (typeof wake === "string") wakes.push({ reason: wake });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await h.json("/api/relay", {
    method: "PUT",
    body: JSON.stringify({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, agentToken: "example-agent-token", clientToken: claimed.token, enabled: true }),
  });
  assert.ok(await waitFor(() => (connected ? true : null)), "the isolated server did not connect to its relay");
  const viewing = (body: unknown) => h.fetchRemote("/api/viewing", { method: "POST", token: claimed.token, body: JSON.stringify(body) });
  return { token: claimed.token as string, digest, wakes, viewing, answers: () => wakes.filter((w) => w.reason === "reply") };
}

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

test("a turn started on the phone wakes it once with the answer when nobody reads it", async (t) => {
  const p = await fakeProvider(t);
  p.state.answerAtOnce = true;
  const h = await startHarness();
  t.after(() => h.stop());
  const phone = await phoneRelay(t, h);
  const bot = await agentOn(h, p.port, "Mira");

  const sent = await h.fetchRemote(`/api/bots/${bot.id}/messages`, { method: "POST", token: phone.token, body: JSON.stringify({ text: "Read the example notes" }) });
  assert.equal(sent.status, 202);
  assert.ok(await idle(h, bot));
  const wake = await waitFor(() => phone.answers()[0]);
  assert.ok(wake, "the answer the person asked for never reached their phone");
  assert.deepEqual(wake.clients, [phone.digest], "an answer is the owner's alone");
  assert.equal(wake.preview?.kind, "preview");
  assert.equal(wake.preview?.title, "Mira");
  assert.equal(wake.preview?.body, "Done.");
  assert.equal(wake.preview?.category, "reply");
  assert.equal(wake.preview?.botId, bot.id);
  assert.equal(wake.preview?.threadId, bot.threadId, "a tap opens the lane the answer is in");
  await settle();
  assert.equal(phone.answers().length, 1, "one turn, one notification");
});

test("an answer on screen somewhere is no news, and one on another screen still is", async (t) => {
  const p = await fakeProvider(t);
  p.state.answerAtOnce = true;
  const h = await startHarness();
  t.after(() => h.stop());
  const phone = await phoneRelay(t, h);
  const bot = await agentOn(h, p.port, "Mira");

  // the desktop has the conversation in front of the person
  const said = await h.fetch("/api/viewing", { method: "POST", body: JSON.stringify({ viewer: "w-desktop", threadId: bot.threadId, seq: 1 }) });
  assert.equal(said.status, 200);
  assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "First example" }) })).status, 202);
  assert.ok(await idle(h, bot));
  await settle();
  assert.equal(phone.answers().length, 0, "an answer being read on the desktop woke the phone");

  // the window moved on to another conversation
  await h.fetch("/api/viewing", { method: "POST", body: JSON.stringify({ viewer: "w-desktop", threadId: "another-lane", seq: 2 }) });
  // and the phone has this one open, then puts it away
  assert.equal((await phone.viewing({ viewer: "p-phone1", threadId: bot.threadId, seq: 1 })).status, 200);
  assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Second example" }) })).status, 202);
  assert.ok(await idle(h, bot));
  await settle();
  assert.equal(phone.answers().length, 0, "an answer being read on the phone woke it");

  await phone.viewing({ viewer: "p-phone1", threadId: null, seq: 2 });
  assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Third example" }) })).status, 202);
  assert.ok(await idle(h, bot));
  assert.ok(await waitFor(() => phone.answers()[0]), "another conversation on screen held the answer back");
  assert.equal(phone.answers().length, 1);
});

test("a stopped turn, and an agent told to stay quiet, say nothing", async (t) => {
  const p = await fakeProvider(t);
  const h = await startHarness();
  t.after(() => h.stop());
  const phone = await phoneRelay(t, h);
  const bot = await agentOn(h, p.port, "Mira");

  assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Example to stop" }) })).status, 202);
  assert.ok(await waitFor(() => (p.state.held.length ? true : null)));
  assert.equal((await h.fetch(`/api/bots/${bot.id}/interrupt`, { method: "POST", body: "{}" })).status, 200);
  assert.ok(await idle(h, bot));
  await settle();
  assert.equal(phone.answers().length, 0, "a stopped turn said its answer was ready");

  p.state.answerAtOnce = true;
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ notifications: false }) });
  assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Quiet example" }) })).status, 202);
  assert.ok(await idle(h, bot));
  await settle();
  assert.equal(phone.answers().length, 0, "an agent whose notifications are off woke the phone");
});

test("only the person's own screens say what is on them", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  assert.equal((await h.fetch("/api/viewing", { method: "POST", body: JSON.stringify({ viewer: "nope", threadId: null, seq: 1 }) })).status, 400);
  const health = await h.json("/api/health");
  assert.ok(health.features.includes("viewing"), "a phone cannot know to say what it shows");
});
