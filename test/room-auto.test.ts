// A room on Auto, end to end through the real server: a message that
// names nobody is put to a fake model first, which picks who answers;
// naming someone never asks it; a bad, slow or unsure answer leaves the
// lead to answer; the choice is kept on the message for the line above
// the reply, and said in a linked chat channel. The engine is a stand-in
// on loopback that answers the routing question as each test needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness, type Harness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

const ROUTING = "You route messages in a group chat";

/** One provider for routing and turns alike. `route` answers the routing
 * question (null holds it past any deadline); a turn says "Done." and is
 * kept, so which agent it was for can be read off its briefing. */
async function fakeEngine(t: { after: (fn: () => unknown) => void }) {
  const state = {
    routes: [] as string[],
    turns: [] as string[],
    route: (_prompt: string): string | null => '{"ids":["m2"],"topic":"pricing question","reason":"Scout handles plans and prices.","confidence":0.9}',
    held: [] as Array<() => void>,
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "grok-4" }] }));
      const say = (content: string) => res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
      if (body.includes(ROUTING)) {
        state.routes.push(body);
        const reply = state.route(body);
        if (reply === null) state.held.push(() => say("{}"));
        else say(reply);
        return;
      }
      state.turns.push(body);
      say("Done.");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => {
    state.held.forEach((f) => f());
    server.closeAllConnections();
    server.close();
  });
  return { state, port: (server.address() as { port: number }).port };
}

/** Who a turn was for, from the room briefing it carries. */
const turnFor = (body: string) => body.match(/- (\w+) \(you\)/)?.[1] ?? null;

async function team(h: Harness, port: number) {
  await h.json("/api/providers/grok/connect", { method: "POST", body: JSON.stringify({ key: "test-key", url: `http://127.0.0.1:${port}` }) });
  const hire = async (name: string, title: string, description: string) => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name, title, description }) });
    await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "grok", model: "grok-4" } }) });
    return bot.id as string;
  };
  return {
    ada: await hire("Ada", "Lead", "Keeps the team on track."),
    scout: await hire("Scout", "Sales", "Answers pricing and plan questions."),
    bo: await hire("Bo", "Engineer", "Fixes bugs in the product."),
  };
}

/** Posts and waits for the turns it wakes, then a moment for any it
 * should not have. Returns who answered and the message as stored. */
async function say(h: Harness, engine: Awaited<ReturnType<typeof fakeEngine>>, roomId: string, text: string) {
  const before = engine.state.turns.length;
  assert.equal((await h.fetch(`/api/bloks/${roomId}/messages`, { method: "POST", body: JSON.stringify({ text }) })).status < 300, true);
  assert.ok(await waitFor(() => engine.state.turns.length > before), h.logs());
  await new Promise((r) => setTimeout(r, 500));
  const room = (await h.json("/api/bloks")).bloks.find((b: any) => b.id === roomId);
  const message = room.messages.find((m: any) => m.role === "user" && m.text === text);
  return { answered: engine.state.turns.slice(before).map(turnFor), message };
}

test("an Auto room asks a model who answers, and a name, a bad answer or a slow one go around it", async (t) => {
  const engine = await fakeEngine(t);
  const h = await startHarness();
  t.after(() => h.stop());
  const { ada, scout, bo } = await team(h, engine.port);
  const { blok } = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Launch", memberIds: [ada, scout, bo], leadId: ada }) });

  // the choice of three, and nothing else
  assert.equal((await h.fetch(`/api/bloks/${blok.id}`, { method: "PATCH", body: JSON.stringify({ answers: "nobody" }) })).status, 400);
  const set = await h.json(`/api/bloks/${blok.id}`, { method: "PATCH", body: JSON.stringify({ answers: "auto" }) });
  assert.equal(set.blok.answers, "auto");
  // anything that reads only the old switch sees the lead, Auto's fallback
  assert.equal(set.blok.leadOnly, true);

  // a pick: Scout alone answers, and the message says why
  const pricing = await say(h, engine, blok.id, "How much is the Pro plan?");
  assert.deepEqual(pricing.answered, ["Scout"]);
  assert.equal(engine.state.routes.length, 1);
  assert.deepEqual(pricing.message.route, {
    to: [scout],
    topic: "pricing question",
    reason: "Scout handles plans and prices.",
    by: "Grok (grok-4.20-0309-non-reasoning)",
  });
  // what the model read: roles and briefs, the words as data, no real ids
  const asked = engine.state.routes[0];
  assert.ok(asked.includes("Answers pricing and plan questions."));
  assert.ok(asked.includes("How much is the Pro plan?"));
  for (const id of [ada, scout, bo]) assert.ok(!asked.includes(id), "a real agent id reached the routing prompt");

  // naming someone never asks
  const named = await say(h, engine, blok.id, "@Bo can you look at the export?");
  assert.deepEqual(named.answered, ["Bo"]);
  assert.equal(engine.state.routes.length, 1, "a message naming someone was put to the chooser");
  assert.equal(named.message.route, undefined);

  // an answer outside the list it was given: the lead, said quietly
  engine.state.route = () => '{"ids":["m9"],"reason":"someone else","confidence":0.9}';
  const stray = await say(h, engine, blok.id, "Who should handle this?");
  assert.deepEqual(stray.answered, ["Ada"]);
  assert.equal(stray.message.route.fallback, "invalid");
  assert.deepEqual(stray.message.route.to, [ada]);

  // and the history it is shown now includes what was said before
  assert.equal(engine.state.routes.length, 2);
  assert.ok(engine.state.routes[1].includes("How much is the Pro plan?"));
  assert.ok(engine.state.routes[1].includes("can you look at the export?"));

  // a model that does not answer in time is not waited for
  engine.state.route = () => null;
  const started = Date.now();
  const slow = await say(h, engine, blok.id, "Anything else today?");
  assert.deepEqual(slow.answered, ["Ada"]);
  assert.equal(slow.message.route.fallback, "timeout");
  assert.ok(Date.now() - started < 8_000);

  // a room set back to everyone asks nobody
  await h.json(`/api/bloks/${blok.id}`, { method: "PATCH", body: JSON.stringify({ answers: "everyone" }) });
  const asks = engine.state.routes.length;
  const all = await say(h, engine, blok.id, "Thanks, all.");
  assert.equal(engine.state.routes.length, asks);
  assert.equal(all.message.route, undefined);
  assert.equal((await h.json("/api/bloks")).bloks.find((b: any) => b.id === blok.id).leadOnly, false);
});

test("the engine Auto asks is the person's to choose, from those that can answer", async (t) => {
  const engine = await fakeEngine(t);
  const h = await startHarness();
  t.after(() => h.stop());
  await team(h, engine.port);

  const listed = await h.json("/api/room-router");
  assert.equal(listed.router, null);
  const grok = listed.choices.find((c: any) => c.id === "grok");
  assert.deepEqual({ small: grok.small, model: grok.model, allowance: grok.allowance }, { small: true, model: "grok-4.20-0309-non-reasoning", allowance: false });

  for (const rooms of [{ router: "nope" }, { router: 7 }, {}, "grok"]) {
    assert.equal((await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ rooms }) })).status, 400, JSON.stringify(rooms));
  }
  const saved = await h.json("/api/config", { method: "PUT", body: JSON.stringify({ rooms: { router: "grok" } }) });
  assert.equal(saved.rooms.router, "grok");
  assert.equal((await h.json("/api/config")).rooms.router, "grok");
  assert.equal((await h.json("/api/room-router")).router, "grok");
  const back = await h.json("/api/config", { method: "PUT", body: JSON.stringify({ rooms: { router: null } }) });
  assert.equal(back.rooms.router, null);
});

test("an Auto room carried into a chat channel says its choice there before the reply", async (t) => {
  const engine = await fakeEngine(t);
  const channel: string[] = [];
  const meta = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.endsWith("/messages")) channel.push(JSON.parse(body || "{}").text?.body ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ messages: [{ id: "fixture" }] }));
    });
  });
  await new Promise<void>((r) => meta.listen(0, "127.0.0.1", () => r()));
  t.after(() => {
    meta.closeAllConnections();
    meta.close();
  });
  const metaUrl = `http://127.0.0.1:${(meta.address() as { port: number }).port}`;
  // a home of the test's own, which outlives the first server's stop
  const home = mkdtempSync(join(tmpdir(), "bloks-auto-chat-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = {
    HOME: home,
    BLOKS_WHATSAPP_API: metaUrl,
    NODE_OPTIONS: `--import=${new URL("./helpers/telegram-fetch.mjs", import.meta.url).href}`,
  };
  let h = await startHarness(env);
  const { ada, scout, bo } = await team(h, engine.port);
  const { blok } = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Shop", memberIds: [ada, scout, bo], leadId: ada }) });
  await h.json(`/api/bloks/${blok.id}`, { method: "PATCH", body: JSON.stringify({ answers: "auto" }) });
  await h.stop();

  // the room shared and linked to a WhatsApp group, as the panel leaves it
  const data = join(home, ".bloks");
  const rooms = JSON.parse(readFileSync(join(data, "bloks.json"), "utf8"));
  rooms.find((r: any) => r.id === blok.id).sharing = {
    since: 0, history: "all", tools: "conversation", spendCap: 0, collaboratorsInvite: false, activityDetail: false,
    chat: { platform: "whatsapp", channelId: "fixture-group", channelName: "Fixture group" },
  };
  writeFileSync(join(data, "bloks.json"), JSON.stringify(rooms));
  const config = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
  config.chat = { whatsapp: { enabled: true, token: "fixture-only", phoneNumberId: "fixture", appSecret: "fixture-only", webhookUrl: metaUrl } };
  writeFileSync(join(data, "config.json"), JSON.stringify(config));
  h = await startHarness(env);
  t.after(() => h.stop());

  const asked = await say(h, engine, blok.id, "How much is the Pro plan?");
  assert.deepEqual(asked.answered, ["Scout"]);
  const line = await waitFor(() => channel.findIndex((c) => c === "_Scout picked: pricing question_") + 1);
  assert.ok(line, `the channel was never told: ${JSON.stringify(channel)}`);
  const reply = await waitFor(() => channel.findIndex((c) => c.startsWith("*Scout*")) + 1);
  assert.ok(reply && line < reply, `the choice came after the reply: ${JSON.stringify(channel)}`);
});
