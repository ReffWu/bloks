// Standing intents: words that come up in a conversation, and what is
// done about them. The matching, the guardrails, what an agent may
// propose, the command line, and each action through the server.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { allows } from "../server/agent-cli.ts";
import { FEATURES } from "../server/features.ts";
import {
  agentTurnText,
  cleanIntent,
  coversWhere,
  excerptAround,
  INTENT_LIFETIME_MS,
  intentView,
  matchPhrases,
  mayFire,
  phrasePattern,
  phrasesFrom,
  recordFire,
  type Intent,
} from "../server/intents.ts";
import { controlledChain } from "./helpers/agent-chain.ts";
import { waitFor } from "./helpers/turns.ts";

const hour = 60 * 60 * 1000;
const base = (over: Partial<Intent> = {}): Intent => ({
  id: "i1",
  name: "Refunds",
  phrases: ["refund*"],
  covers: { everywhere: true },
  action: { kind: "note", text: "Refunds: full refund within 30 days." },
  cooldownHours: 24,
  enabled: true,
  status: "active",
  createdAt: 0,
  expiresAt: 1_000 * hour,
  by: { kind: "person" },
  fires: [],
  ...over,
});

describe("matching", () => {
  test("whole words, any case, a run of spaces or a hyphen between them", () => {
    const launch = phrasePattern("launch date")!;
    assert.ok(launch.test("When is the Launch   Date again?"));
    assert.ok(launch.test("the launch-date moved"));
    assert.ok(!launch.test("the relaunch date"), "not inside another word");
    assert.ok(!launch.test("launch dates"), "not the start of a longer word");
    assert.ok(phrasePattern("Launch")!.test("LAUNCH!"));
  });

  test("a word ending in * takes its other endings; symbols are just characters", () => {
    const refund = phrasePattern("refund*")!;
    for (const said of ["a refund", "Refunds please", "they refunded it"]) assert.ok(refund.test(said), said);
    assert.ok(!refund.test("nonrefundable"));
    assert.ok(phrasePattern("c++")!.test("we write c++ here"));
    assert.ok(phrasePattern("Q4 (plan)")!.test("about the q4 (plan) today"));
    assert.equal(phrasePattern("*"), null);
    assert.equal(phrasePattern("  "), null);
    assert.equal(phrasePattern("--"), null);
  });

  test("letters beyond English are words too", () => {
    assert.ok(phrasePattern("café")!.test("Meet at the Café at noon"));
    assert.ok(!phrasePattern("café")!.test("cafés"));
  });

  test("the first phrase said, where, and a few words around it", () => {
    const text = `${"x ".repeat(100)}the customer asked about a refund for order 1182 yesterday ${"y ".repeat(100)}`;
    const found = matchPhrases(text, ["launch", "refund*"])!;
    assert.equal(found.phrase, "refund*");
    const excerpt = excerptAround(text, found);
    assert.match(excerpt, /^….*a refund for order 1182.*…$/);
    assert.ok(excerpt.length < 200);
    assert.equal(matchPhrases("nothing here", ["refund*"]), null);
  });

  test("phrases come from a list or a comma separated string, cleaned and once each", () => {
    assert.deepEqual(phrasesFrom('launch date, "Launch Date", refund* ; ,  , *'), ["launch date", "refund*"]);
    assert.deepEqual(phrasesFrom(["a", 3, "b"]), ["a", "3", "b"]);
  });
});

describe("where and when it may fire", () => {
  test("everywhere is every agent's conversations and every room nobody else was invited to", () => {
    const everywhere = base();
    assert.equal(coversWhere(everywhere, { botId: "a" }), true);
    assert.equal(coversWhere(everywhere, { roomId: "r", shared: false }), true);
    assert.equal(coversWhere(everywhere, { roomId: "r", shared: true }), false, "a shared room only when it is named");
    const named = base({ covers: { agents: ["a"], rooms: ["shared"] } });
    assert.equal(coversWhere(named, { botId: "a" }), true);
    assert.equal(coversWhere(named, { botId: "b" }), false);
    assert.equal(coversWhere(named, { roomId: "shared", shared: true }), true);
    assert.equal(coversWhere(named, { roomId: "other", shared: false }), false);
  });

  test("once a day in one conversation, three times a day in all, and never paused, proposed or expired", () => {
    const intent = base();
    assert.deepEqual(mayFire(intent, "t1", 0), { ok: true });
    recordFire(intent, { at: 0, threadId: "t1", messageId: "m1", phrase: "refund*", excerpt: "a refund" });
    assert.deepEqual(mayFire(intent, "t1", 23 * hour), { ok: false, why: "cooldown" });
    assert.deepEqual(mayFire(intent, "t1", 24 * hour), { ok: true });
    assert.deepEqual(mayFire(intent, "t2", hour), { ok: true });
    recordFire(intent, { at: hour, threadId: "t2", messageId: "m2", phrase: "refund*", excerpt: "" });
    recordFire(intent, { at: 2 * hour, threadId: "t3", messageId: "m3", phrase: "refund*", excerpt: "" });
    assert.deepEqual(mayFire(intent, "t4", 3 * hour), { ok: false, why: "daily" });
    assert.deepEqual(mayFire(intent, "t4", 24 * hour + 1), { ok: true }, "the first has aged out of the day");
    assert.deepEqual(mayFire(base({ enabled: false }), "t", 0), { ok: false, why: "paused" });
    assert.deepEqual(mayFire(base({ status: "proposed" }), "t", 0), { ok: false, why: "proposed" });
    assert.deepEqual(mayFire(base({ expiresAt: 10 }), "t", 10), { ok: false, why: "expired" });
    assert.deepEqual(mayFire(base({ cooldownHours: 1 }), "t", 0), { ok: true });
  });

  test("a client reads its state in a word, and how many times it fired today", () => {
    assert.equal(intentView(base({ status: "proposed" }), 0).state, "proposed");
    assert.equal(intentView(base({ enabled: false }), 0).state, "paused");
    assert.equal(intentView(base({ expiresAt: 5 }), 5).state, "expired");
    const fired = base();
    recordFire(fired, { at: 0, threadId: "t", messageId: "m", phrase: "x", excerpt: "" });
    assert.equal(intentView(fired, hour).state, "listening");
    assert.equal(intentView(fired, hour).firesToday, 1);
  });

  test("ninety days, then renewed", () => {
    assert.equal(INTENT_LIFETIME_MS, 90 * 24 * hour);
  });
});

describe("what is asked for", () => {
  const has = { agent: (id: string) => id === "maya", room: (id: string) => id === "r1" };

  test("a note, a mention or a message, with the words and the agent each needs", () => {
    const note = cleanIntent({ when: "refund*", action: { kind: "note", text: " Policy " } }, has);
    assert.ok(note.ok);
    assert.deepEqual(note.ok && note.value, {
      name: "refund*",
      phrases: ["refund*"],
      covers: { everywhere: true },
      action: { kind: "note", text: "Policy" },
      cooldownHours: 24,
    });
    const refusals: Array<[Record<string, unknown>, RegExp]> = [
      [{ action: { kind: "note", text: "x" } }, /which words/],
      [{ phrases: "a", action: { kind: "note" } }, /needs the words to post/],
      [{ phrases: "a", action: { kind: "message", botId: "maya" } }, /needs the words to send/],
      [{ phrases: "a", action: { kind: "mention", botId: "ghost" } }, /no such agent/],
      [{ phrases: "a", action: { kind: "shout" } }, /note, mention or message/],
      [{ phrases: "a", action: { kind: "note", text: "x" }, covers: { agents: [], rooms: [] } }, /at least one agent or room/],
      [{ phrases: "a", action: { kind: "note", text: "x" }, covers: { rooms: ["nope"] } }, /no agent or room nope/],
      [{ phrases: "a", action: { kind: "note", text: "x" }, cooldownHours: 0 }, /1 to 168 hours/],
      [{ phrases: Array.from({ length: 13 }, (_, i) => `w${i}`), action: { kind: "note", text: "x" } }, /at most 12/],
      [{ phrases: "a", action: { kind: "note", text: "x".repeat(601) } }, /at most 600/],
    ];
    for (const [raw, error] of refusals) {
      const checked = cleanIntent(raw, has);
      assert.equal(checked.ok, false, JSON.stringify(raw));
      assert.match(!checked.ok ? checked.error : "", error);
    }
    const mention = cleanIntent({ phrases: ["launch date"], name: "Launch", covers: { rooms: ["r1"] }, action: { kind: "mention", botId: "maya" } }, has);
    assert.ok(mention.ok && mention.value.covers && "rooms" in mention.value.covers && mention.value.action.kind === "mention");
  });

  test("a change keeps what it does not mention", () => {
    const was = cleanIntent({ phrases: "a, b", name: "Kept", action: { kind: "message", botId: "maya", text: "Look" }, cooldownHours: 4 }, has);
    assert.ok(was.ok);
    const changed = cleanIntent({ phrases: "c" }, has, was.ok ? was.value : undefined);
    assert.ok(changed.ok);
    assert.deepEqual(changed.ok && changed.value, { name: "Kept", phrases: ["c"], covers: { everywhere: true }, action: { kind: "message", botId: "maya", text: "Look" }, cooldownHours: 4 });
  });

  test("what an agent is told says where it came from, who said it, and what to do", () => {
    const text = agentTurnText({
      intent: { name: "Launch", action: { kind: "message", botId: "maya", text: "Check the press plan." } },
      phrase: "launch date",
      where: "the room Launch",
      who: "Hamed",
      excerpt: "the launch date moved to Thursday",
    });
    assert.match(text, /^Your standing intent "Launch" was set off\./);
    assert.match(text, /"launch date" came up in the room Launch, from Hamed:\n> the launch date moved to Thursday/);
    assert.match(text, /What you were asked to do when this happens: Check the press plan\./);
    assert.match(text, /say so in one line and stop/);
    assert.match(agentTurnText({ intent: { name: "L", action: { kind: "mention", botId: "m" } }, phrase: "p", where: "w", who: "x", excerpt: "e", outside: true }), /cannot join that conversation/);
  });
});

describe("what an agent may do", () => {
  test("propose, read and withdraw its own; never change, approve or pause one", () => {
    assert.equal(allows("me", "GET", "/api/intents").ok, true);
    assert.equal(allows("me", "POST", "/api/intents").ok, true);
    assert.equal(allows("me", "DELETE", "/api/intents/abc").ok, true);
    assert.equal(allows("me", "PATCH", "/api/intents/abc").ok, false);
    assert.ok(FEATURES.includes("intents"));
  });
});

describe("the command line", () => {
  const cli = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));

  test("intent sends one proposal shaped the way the route reads it", async (t) => {
    const home = mkdtempSync(join(tmpdir(), "bloks-intent-cli-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const calls: Array<{ method?: string; path?: string; body: any }> = [];
    const server = createServer(async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      calls.push({ method: req.method, path: req.url, body: text ? JSON.parse(text) : null });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/api/agent/whoami" ? { botId: "me" } : { intent: { id: "i1" }, intents: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const run = (args: string[]) =>
      new Promise<{ code: number; out: string; err: string }>((resolve) => {
        execFile(process.execPath, [cli, ...args], { env: { HOME: home, PATH: "/nonexistent", BLOKS_URL: url, BLOKS_TOKEN: "blk_fixture" }, timeout: 10_000 }, (error, out, err) =>
          resolve({ code: typeof error?.code === "number" ? error.code : 0, out, err }),
        );
      });

    assert.equal((await run(["intent", "--when", "launch date, launch day", "--message", "maya", "--say", "Loop in marketing", "--name", "Launch", "--rooms", "r1,r2"])).code, 0);
    const posted = calls.find((c) => c.path === "/api/intents")!;
    assert.equal(posted.method, "POST");
    assert.deepEqual(posted.body, {
      phrases: ["launch date", " launch day"],
      action: { kind: "message", botId: "maya", text: "Loop in marketing" },
      name: "Launch",
      covers: { agents: ["me"], rooms: ["r1", "r2"] },
    });

    calls.length = 0;
    await run(["intent", "--when", "refund*", "--note", "Remind them of the policy"]);
    assert.deepEqual(calls.map((c) => c.body), [{ phrases: ["refund*"], action: { kind: "note", text: "Remind them of the policy" } }]);

    for (const [args, error] of [
      [["intent", "--note", "x"], /needs --when/],
      [["intent", "--when", "a", "--note", "x", "--mention", "maya"], /one of --note, --mention or --message/],
      [["intent", "--when", "a", "--message", "maya"], /needs --say/],
    ] as const) {
      calls.length = 0;
      const result = await run([...args]);
      assert.notEqual(result.code, 0);
      assert.match(result.out + result.err, error);
      assert.equal(calls.length, 0, "nothing is sent for a command that is wrong");
    }
    calls.length = 0;
    await run(["unintent", "i1"]);
    assert.deepEqual(calls.map((c) => [c.method, c.path]), [["DELETE", "/api/intents/i1"]]);
  });
});

describe("through the server", () => {
  test("a note, then the cooldown; a message to an agent that never sets anything off again", async (t) => {
    const f = await controlledChain(t);
    const alpha = await f.hire("Alpha");
    const maya = await f.hire("Maya");
    const make = async (body: unknown) => {
      const res = await f.h.fetch("/api/intents", { method: "POST", body: JSON.stringify(body) });
      assert.equal(res.status, 201);
      return (await res.json()).intent;
    };
    const refunds = await make({ name: "Refunds", phrases: "refund*", action: { kind: "note", text: "Refund policy: full refund within 30 days." } });
    assert.equal(refunds.status, "active");
    assert.equal(refunds.state, "listening");
    const launch = await make({ name: "Launch", phrases: ["launch date"], action: { kind: "message", botId: maya.id, text: "Check the press plan." } });
    // one more listening for the same words, so an intent's own message
    // in Maya's conversation would set it off if anything could
    const echo = await make({ name: "Echo", phrases: ["launch date"], covers: { agents: [maya.id], rooms: [] }, action: { kind: "note", text: "Echo" } });

    // Alpha's turn and the one the intent starts for Maya begin side by
    // side, in either order
    await f.begin(alpha, "A customer wants a refund for order 1182, and when is the launch date?");
    const both = [await f.turnAfter(0), await f.turnAfter(1)];
    const told = both.find((turn) => /standing intent/.test(turn.text))!;
    const first = both.find((turn) => turn !== told)!;
    const note = await waitFor(async () => (await f.messages(alpha)).find((m) => m.intent?.id === refunds.id), 10_000);
    assert.ok(note, "the note was posted in the conversation");
    assert.equal(note.kind, "notice");
    assert.equal(note.text, "Refund policy: full refund within 30 days.");

    // Maya hears it in her own conversation, in the intent's words
    assert.ok(told, "Maya was told");
    assert.match(told.text, /Your standing intent "Launch" was set off/);
    assert.match(told.text, /"launch date" came up in Alpha's conversation, from the person you work for:/);
    assert.match(told.text, /Check the press plan\./);
    const mine = await f.messages(maya);
    assert.ok(mine.some((m) => m.via === "intent" && m.intent?.id === launch.id));
    await f.finish(told, maya);
    assert.equal(mine.filter((m) => m.intent?.id === echo.id).length, 0, "an intent's message sets off no intent");

    await f.finish(first, alpha);
    const again = await f.begin(alpha, "Refunds again: they want two more refunds.");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await f.messages(alpha)).filter((m) => m.intent?.id === refunds.id).length, 1, "once a day in one conversation");
    await f.finish(again, alpha);

    const { intents } = await f.h.json("/api/intents");
    const seen = intents.find((i: any) => i.id === refunds.id);
    assert.equal(seen.fires.length, 1);
    assert.equal(seen.firesToday, 1);
    assert.match(seen.fires[0].excerpt, /refund for order 1182/);
    assert.equal(intents.find((i: any) => i.id === echo.id).fires.length, 0);
  });

  test("a mention wakes a member in the room; one who cannot join is sent what was said", async (t) => {
    const f = await controlledChain(t);
    const alpha = await f.hire("Alpha");
    const maya = await f.hire("Maya");
    const ivy = await f.hire("Ivy");
    const { blok } = await f.h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Launch", memberIds: [alpha.id, maya.id] }) });
    for (const [botId, name] of [[maya.id, "Room"], [ivy.id, "Outside"]]) {
      const res = await f.h.fetch("/api/intents", {
        method: "POST",
        body: JSON.stringify({ name, phrases: "pricing", covers: { agents: [], rooms: [blok.id] }, action: { kind: "mention", botId } }),
      });
      assert.equal(res.status, 201);
    }
    const n = f.turns().length;
    await f.h.fetch(`/api/bloks/${blok.id}/messages`, { method: "POST", body: JSON.stringify({ text: "@Alpha the pricing page is wrong" }) });
    // Alpha's turn in the room and Ivy's in her own conversation start
    // side by side, in either order
    const both = [await f.turnAfter(n), await f.turnAfter(n + 1)];
    const ivyTurn = both.find((turn) => /cannot join that conversation/.test(turn.text))!;
    const alphaTurn = both.find((turn) => turn !== ivyTurn)!;
    assert.ok(ivyTurn, "Ivy is in no room here, so she hears it in her own conversation");
    assert.match(alphaTurn.text, /the pricing page is wrong/);
    assert.match(ivyTurn.text, /came up in the room Launch, from/);
    await f.finish(ivyTurn, ivy);
    await f.finish(alphaTurn, alpha);

    // Maya is woken in the room once Alpha's turn there is done
    const mayaTurn = await f.turnAfter(n + 2);
    assert.match(mayaTurn.text, /brought you into this conversation/);
    const { messages } = await f.h.json(`/api/bloks/${blok.id}/messages?limit=100`);
    assert.ok(messages.some((m: any) => m.kind === "notice" && m.event && /^Looping in Maya, since "pricing" came up\.$/.test(m.text)));
    assert.ok(messages.some((m: any) => m.kind === "notice" && /^Ivy can't join this conversation/.test(m.text)));
    await f.finish(mayaTurn, maya);
  });

  test("an agent proposes, the person approves; until then it does nothing", async (t) => {
    const f = await controlledChain(t);
    const alpha = await f.hire("Alpha");
    const other = await f.hire("Other");
    const turn = await f.begin(alpha);

    const refused = await f.agent(turn, "/api/intents", { phrases: "deadline", covers: "everywhere", action: { kind: "note", text: "x" } });
    assert.equal(refused.status, 403);
    const elsewhere = await f.agent(turn, "/api/intents", { phrases: "deadline", covers: { agents: [other.id], rooms: [] }, action: { kind: "note", text: "x" } });
    assert.equal(elsewhere.status, 403, "only its own conversations");
    const res = await f.agent(turn, "/api/intents", { phrases: "deadline", action: { kind: "note", text: "The deadline is the 30th." } });
    assert.equal(res.status, 201);
    const { intent, note } = await res.json();
    assert.equal(intent.status, "proposed");
    assert.deepEqual(intent.covers, { agents: [alpha.id], rooms: [] });
    assert.deepEqual(intent.by, { kind: "agent", botId: alpha.id, name: "Alpha" });
    assert.match(note, /does nothing until .* approves it/);
    const spare = await (await f.agent(turn, "/api/intents", { phrases: "spare", action: { kind: "note", text: "x" } })).json();

    assert.equal((await f.agent(turn, `/api/intents/${intent.id}`, { approve: true }, "PATCH")).status, 403, "an agent never approves");
    assert.equal((await f.agent(turn, `/api/intents/${spare.intent.id}`, undefined, "DELETE")).status, 200, "it withdraws its own proposal");
    const listed = await (await f.agent(turn, "/api/intents", undefined, "GET")).json();
    assert.deepEqual(listed.intents.map((i: any) => i.id), [intent.id]);
    await f.finish(turn, alpha);

    // proposed: the words come up and nothing happens
    const quiet = await f.begin(alpha, "The deadline is close.");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await f.messages(alpha)).filter((m) => m.intent).length, 0);
    await f.finish(quiet, alpha);

    const approved = await f.h.json(`/api/intents/${intent.id}`, { method: "PATCH", body: JSON.stringify({ approve: true }) });
    assert.equal(approved.intent.status, "active");
    assert.ok(approved.intent.expiresAt > Date.now() + 89 * 24 * hour);
    const live = await f.begin(alpha, "Remind me about the deadline");
    assert.ok(await waitFor(async () => (await f.messages(alpha)).find((m) => m.intent?.id === intent.id), 10_000));
    await f.finish(live, alpha);

    // once approved it is the person's: the agent can no longer withdraw it
    const late = await f.begin(alpha);
    assert.equal((await f.agent(late, `/api/intents/${intent.id}`, undefined, "DELETE")).status, 403);
    await f.finish(late, alpha);

    // the person pauses, renews and removes it
    const paused = await f.h.json(`/api/intents/${intent.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    assert.equal(paused.intent.state, "paused");
    const renamed = await f.h.json(`/api/intents/${intent.id}`, { method: "PATCH", body: JSON.stringify({ name: "Deadline", phrases: "due date", renew: true }) });
    assert.deepEqual(renamed.intent.phrases, ["due date"]);
    assert.equal(renamed.intent.name, "Deadline");
    const bad = await f.h.fetch(`/api/intents/${intent.id}`, { method: "PATCH", body: JSON.stringify({ phrases: "" }) });
    assert.equal(bad.status, 400);
    assert.equal((await f.h.fetch(`/api/intents/${intent.id}`, { method: "DELETE" })).status, 200);
    assert.deepEqual((await f.h.json("/api/intents")).intents, []);
  });
});
