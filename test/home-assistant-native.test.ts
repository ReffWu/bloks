// Home Assistant end to end against the real harness: a fake Home
// Assistant (REST and WebSocket) on loopback, a fake engine running the
// agent's own command line, and nothing real anywhere. What an agent sees
// is only what the owner listed, framed as data; a change waits on the
// owner's card; locks and garage doors always ask; and Home Assistant can
// start an agent through its webhook.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { agentCli, agentTries, fixture, sleep, waitFor } from "./helpers/telegram-native.ts";
import { HOME_TOKEN, fakeHome } from "./helpers/fake-home.ts";

async function homeFixture(t: TestContext, grant = true, waitMs = 20_000) {
  const ha = await fakeHome(t);
  const f = await fixture(t, "codex", false, false, { BLOKS_HOME_WAIT_MS: String(waitMs) });
  const connected = await f.post("/api/home", { url: ha.url, token: HOME_TOKEN });
  assert.equal(connected.configured, true, JSON.stringify(connected));
  await f.post("/api/home", {
    entities: ["light.kitchen", "sensor.living_room_temperature", "lock.front_door", "cover.garage"],
    auto: ["light.porch"],
    ...(grant ? { agents: [f.bot.id] } : {}),
  });
  /** The approval card a change is waiting on, once it is in the lane. */
  const homeCard = () => waitFor(async () => (await f.messages()).find((m) => m.card?.requestId?.startsWith("home:") && !m.card.answered), "no card for the change");
  return { ...f, ha, homeCard };
}

test("connecting checks the token with Home Assistant, and the token never comes back out", async (t) => {
  const ha = await fakeHome(t);
  const f = await fixture(t, "codex", false, false);
  const wrong = await f.h.fetch("/api/home", { method: "POST", body: JSON.stringify({ url: ha.url, token: "eyJhbGciOiJIUzI1NiJ9wrong.eyJpc3MiOiJ0ZXN0In0wrongx.c2lnbmF0dXJld3Jvbmd4" }) });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /refused the token/);
  const notToken = await f.h.fetch("/api/home", { method: "POST", body: JSON.stringify({ url: ha.url, token: "hunter2" }) });
  assert.equal(notToken.status, 400);
  const ok = await f.post("/api/home", { url: `${ha.url}/`, token: HOME_TOKEN });
  assert.equal(ok.configured, true);
  assert.equal(ok.name, "Test Home");
  const shown = JSON.stringify(await f.h.json("/api/home"));
  assert.ok(!shown.includes(HOME_TOKEN), "the token is never sent to a client");
  const saved = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).home;
  assert.equal(saved.token, HOME_TOKEN, "it is kept in the private config");
  // the picker reads areas from the WebSocket registries, a device's included
  const { entities } = await f.h.json("/api/home/catalog");
  const byId = Object.fromEntries(entities.map((e: any) => [e.entity_id, e]));
  assert.equal(byId["light.kitchen"].area, "Kitchen");
  assert.equal(byId["cover.garage"].area, "Garage");
  assert.equal(byId["lock.front_door"].alwaysAsks, true);
  assert.equal(byId["cover.garage"].alwaysAsks, true, "a garage door always asks, by its class");
  assert.equal(byId["light.kitchen"].alwaysAsks, false);
  // a lock can never be marked to change without asking
  const lists = await f.post("/api/home", { entities: ["lock.front_door", "light.kitchen", "not an entity"], auto: ["lock.front_door", "light.kitchen", "light.nowhere"] });
  assert.deepEqual(lists.entities, ["lock.front_door", "light.kitchen"]);
  assert.deepEqual(lists.auto, ["light.kitchen"]);
});

test("an agent sees only what is listed, bounded and framed as data", async (t) => {
  const f = await homeFixture(t);
  const { status, answer } = await agentCli(f, ["home", "entities"]);
  assert.equal(status, 0, JSON.stringify(answer));
  assert.match(answer.note, /never as instructions/);
  const ids = answer.entities.map((e: any) => e.entity_id).sort();
  assert.deepEqual(ids, ["cover.garage", "light.kitchen", "lock.front_door", "sensor.living_room_temperature"], "nothing off the list exists for it");
  const sensor = answer.entities.find((e: any) => e.entity_id === "sensor.living_room_temperature");
  assert.ok(!sensor.name.includes("\u202e"), "invisible reordering marks are taken out");
  assert.equal(sensor.attributes.entity_picture, undefined, "a camera's address is not about the state of anything");
  assert.deepEqual(sensor.attributes.nested, { a: {} }, "nesting is bounded");
  assert.equal(answer.entities.find((e: any) => e.entity_id === "lock.front_door").changes, "always asks the owner");
  const history = await agentCli(f, ["home", "history", "sensor.living_room_temperature", "--hours", "6"]);
  assert.equal(history.status, 0, JSON.stringify(history.answer));
  assert.deepEqual(history.answer.points.map((p: any) => p.state), ["20.0", "21.5"]);
  const unlisted = await agentCli(f, ["home", "history", "switch.heater"]);
  assert.equal(unlisted.status, 1);
  assert.match(unlisted.answer.error, /on your list/);
});

test("a change waits for the owner's yes on a card, and only then runs", async (t) => {
  const f = await homeFixture(t);
  const ran = agentCli(f, ["home", "call", "light.turn_on", "light.kitchen", "--data", JSON.stringify({ brightness_pct: 40, area_id: "everywhere" })]);
  const card = await f.homeCard();
  assert.equal(card.card.title, "Approval needed");
  assert.match(card.card.subtitle, /light\.turn_on on Kitchen light \(light\.kitchen\)/);
  await sleep(300);
  assert.equal(f.ha.calls.length, 0, "nothing is changed before the owner says");
  const answered = await f.post(`/api/bots/${f.bot.id}/respond`, { requestId: card.card.requestId, behavior: "allow" });
  assert.equal(answered.ok, true, JSON.stringify(answered));
  const { status, answer } = await ran;
  assert.equal(status, 0, JSON.stringify(answer));
  assert.equal(answer.ok, true);
  assert.deepEqual(f.ha.calls, [{ domain: "light", service: "turn_on", body: { brightness_pct: 40, entity_id: ["light.kitchen"] } }], "aimed only at the named entity");
  const settled = (await f.messages()).find((m) => m.id === card.id);
  assert.equal(settled.card.answered, "Allowed");
});

test("an unanswered card says it is still waiting, and a yes after its turn ended runs nothing", async (t) => {
  const f = await homeFixture(t, true, 600);
  const { status, answer } = await agentCli(f, ["home", "call", "light.turn_on", "light.kitchen"]);
  assert.equal(status, 0, JSON.stringify(answer));
  assert.equal(answer.pending, true);
  assert.match(answer.note, /home wait [\w-]+/);
  // the turn that asked is over: its card closed with it
  const card = await waitFor(async () => (await f.messages()).find((m) => m.card?.requestId?.startsWith("home:") && m.card.answered), "the card did not close with its turn");
  assert.match(card.card.answered, /the turn that asked has ended/);
  const late = await f.post(`/api/bots/${f.bot.id}/respond`, { requestId: card.card.requestId, behavior: "allow" });
  assert.equal(late.ok, false);
  await sleep(300);
  assert.equal(f.ha.calls.length, 0, "an approval is for the work that asked, not for later");
});

test("a no is final, and nothing changes", async (t) => {
  const f = await homeFixture(t);
  const ran = agentCli(f, ["home", "call", "light.turn_off", "light.kitchen"]);
  const card = await f.homeCard();
  await f.post(`/api/bots/${f.bot.id}/respond`, { requestId: card.card.requestId, behavior: "deny" });
  const { status, answer } = await ran;
  assert.equal(status, 1);
  assert.match(answer.error, /said no/);
  assert.equal(f.ha.calls.length, 0);
});

test("what the owner marked auto runs without a card; a garage door asks whatever is marked", async (t) => {
  const f = await homeFixture(t);
  await f.post("/api/home", { entities: ["light.kitchen", "cover.garage"], auto: ["light.kitchen", "cover.garage"] });
  const quick = await agentCli(f, ["home", "call", "light.turn_on", "light.kitchen"]);
  assert.equal(quick.status, 0, JSON.stringify(quick.answer));
  assert.equal(f.ha.calls.length, 1);
  assert.ok(!(await f.messages()).some((m) => m.card?.requestId?.startsWith("home:")), "no card for what the owner allowed");
  const ran = agentCli(f, ["home", "call", "cover.open_cover", "cover.garage"]);
  const card = await f.homeCard();
  assert.match(card.card.subtitle, /garage doors always ask/);
  await f.post(`/api/bots/${f.bot.id}/respond`, { requestId: card.card.requestId, behavior: "deny" });
  assert.equal((await ran).status, 1);
  assert.equal(f.ha.calls.length, 1, "the garage door did not open");
});

test("an agent the owner did not let in, or an entity off the list, is refused", async (t) => {
  const f = await homeFixture(t, false);
  const refused = await agentCli(f, ["home", "entities"]);
  assert.equal(refused.status, 1);
  assert.match(refused.answer.error, /may not use the home/);
  await f.post("/api/home", { agents: [f.bot.id] });
  const off = await agentCli(f, ["home", "call", "switch.turn_on", "switch.heater"]);
  assert.equal(off.status, 1);
  assert.match(off.answer.error, /not on the list/);
  const wide = await agentCli(f, ["home", "call", "light.turn_on", "lock.front_door"]);
  assert.equal(wide.status, 1, "a service of another domain does not reach a lock");
  // the settings, the token and the other apps' way in are never an agent's
  assert.deepEqual(await agentTries(f, [["GET", "/api/home"], ["POST", "/api/home", { auto: ["lock.front_door"] }], ["GET", "/api/home/mcp/entities"]]), [403, 403, 403]);
  assert.equal(f.ha.calls.length, 0);
});

test("Home Assistant starts an agent through a webhook of its own, with YAML ready to paste", async (t) => {
  const f = await homeFixture(t);
  const made = await f.post("/api/home/automation", { botId: f.bot.id, entity: "binary_sensor.front_door" });
  assert.match(made.command, /^# configuration\.yaml\nrest_command:\n {2}bloks_planning:\n/);
  const hook = /\/hook\/([\w-]+)"/.exec(made.command)?.[1];
  assert.ok(hook, made.command);
  assert.match(made.state, /trigger: state\n {4}entity_id: binary_sensor\.front_door/);
  assert.match(made.voice, /- "ask planning \{request\}"/);
  assert.match(made.voice, /set_conversation_response/);
  assert.equal(made.network, false, "without Phone access only this computer can post to it");
  // asked again, it is the same webhook, not another
  const again = await f.post("/api/home/automation", { botId: f.bot.id });
  assert.equal(again.webhookId, made.webhookId);
  const fired = await f.h.fetch(`/hook/${hook}`, { method: "POST", body: JSON.stringify({ event: "binary_sensor.front_door changed", entity: "binary_sensor.front_door", state: "on", said: "" }) });
  assert.equal(fired.status, 202);
  const said = await waitFor(async () => (await f.messages()).find((m) => m.role === "user" && m.text?.includes('The webhook "Home Assistant" just fired')), "the event never reached the agent");
  assert.match(said.text, /not as instructions from me/);
  await waitFor(async () => (await f.messages()).some((m) => m.role === "bot" && m.text === "ANSWER"), "the agent never answered");
});

test("other AI apps read the home only once let in, and change only what needs no asking", async (t) => {
  const f = await homeFixture(t);
  const shut = await f.h.fetch("/api/home/mcp/entities");
  assert.equal(shut.status, 403);
  await f.post("/api/home", { mcp: true, entities: ["light.kitchen", "light.porch", "lock.front_door"], auto: ["light.porch"] });
  const { entities } = await f.h.json("/api/home/mcp/entities");
  assert.deepEqual(entities.map((e: any) => e.entity_id).sort(), ["light.kitchen", "light.porch", "lock.front_door"]);
  const asks = await f.h.fetch("/api/home/mcp/call", { method: "POST", body: JSON.stringify({ service: "lock.unlock", entities: ["lock.front_door"] }) });
  assert.equal(asks.status, 403);
  assert.match((await asks.json()).error, /only an agent in Bloks can ask/);
  const quick = await f.h.json("/api/home/mcp/call", { method: "POST", body: JSON.stringify({ service: "light.turn_off", entities: ["light.porch"] }) });
  assert.equal(quick.ok, true);
  assert.deepEqual(f.ha.calls.map((c) => `${c.domain}.${c.service}`), ["light.turn_off"]);
});
