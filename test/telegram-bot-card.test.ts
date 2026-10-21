// An agent asks for its own Telegram bot, and the owner pastes the token
// into a card that names both. The token goes to that agent's Telegram
// settings and nowhere the agent can read. Telegram is a loopback stub and
// the engine a fixture that runs the agent's own command line.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { agentTries, fixture, waitFor } from "./helpers/telegram-native.ts";

const TOKEN = "777:SYNTHETIC_bot_token_abcdefghijk";

async function ask(f: Awaited<ReturnType<typeof fixture>>, name: string) {
  const file = join(f.root, "connect-answer.json");
  rmSync(file, { force: true });
  const asked = async () => (await f.messages()).filter((m) => m.text === "ASKED").length;
  const before = await asked();
  await f.post(`/api/bots/${f.bot.id}/messages`, { text: `CONNECT_BOT ${name}` });
  await waitFor(() => existsSync(file), "the agent never asked");
  await waitFor(async () => (await asked()) > before, "the asking turn never ended");
  return JSON.parse(readFileSync(file, "utf8"));
}

const cards = async (f: Awaited<ReturnType<typeof fixture>>) => (await f.messages()).filter((m) => m.kind === "secret");

test("the agent asks, the owner pastes, and the bot is that agent's without the agent seeing the token", async (t) => {
  const f = await fixture(t, "codex", false, false);
  const asked = await ask(f, "@PlanningBot");
  assert.equal(asked.status, 0, asked.err);
  assert.match(asked.out, /@PlanningBot/);
  const [card] = await cards(f);
  assert.ok(card, "no card was planted");
  assert.equal(card.secret.status, "needs-value");
  assert.deepEqual(card.secret.telegram, { bot: "PlanningBot" });
  assert.match(card.secret.hint, /Planning/);

  const saved = await f.h.fetch(`/api/bots/${f.bot.id}/secret-cards/${card.id}/save`, { method: "POST", body: JSON.stringify({ value: ` ${TOKEN} ` }) });
  assert.equal(saved.status, 200, await saved.text());
  const status = await f.h.json(`/api/bots/${f.bot.id}/telegram`);
  assert.equal(status.configured, true);
  assert.equal(status.enabled, true);
  assert.equal(status.username, "PlanningBot");
  // pairing stays the owner's, from their own Telegram, as in Settings
  assert.equal(status.ownerPaired, false);
  assert.ok(status.pairing, "the owner was not given a pairing word");
  await waitFor(() => f.tg.state.pollTokens.includes(TOKEN), "the bot never started listening");

  const after = (await cards(f))[0];
  assert.equal(after.secret.status, "saved");
  assert.equal(after.secret.telegram.username, "PlanningBot");
  // The resumed turn hears that the bot is connected, never its token.
  await waitFor(() => readFileSync(join(f.root, "calls.jsonl"), "utf8").includes("@PlanningBot"), "the task never resumed");
  for (const where of [JSON.stringify(await f.messages()), readFileSync(join(f.root, "calls.jsonl"), "utf8")]) {
    assert.equal(where.includes(TOKEN), false, "the token reached the conversation or the engine");
    assert.equal(where.includes(status.pairing), false, "the pairing word reached the conversation or the engine");
  }
  const config = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8"));
  assert.equal(config.telegram.bots[f.bot.id].token, TOKEN);
  assert.equal(JSON.stringify(config.secrets ?? {}).includes(TOKEN), false, "the token was kept as an environment secret");
});

test("a token for a different bot is refused, and nothing is saved", async (t) => {
  const f = await fixture(t, "codex", false, false);
  await ask(f, "PlanningBot");
  const [card] = await cards(f);
  f.tg.state.getMeReplies.set(TOKEN, { body: { ok: true, result: { id: 777, is_bot: true, username: "SomeoneElsesBot" } } });
  const refused = await f.h.fetch(`/api/bots/${f.bot.id}/secret-cards/${card.id}/save`, { method: "POST", body: JSON.stringify({ value: TOKEN }) });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /@SomeoneElsesBot, not @PlanningBot/);
  assert.equal((await f.h.json(`/api/bots/${f.bot.id}/telegram`)).configured, false);
  assert.equal((await cards(f))[0].secret.status, "needs-value");
});


test("only the agent's own bot, only by the owner's paste, and only while it has none", async (t) => {
  const f = await fixture(t, "codex", false, false);
  const bad = await ask(f, "not-a-bot");
  assert.equal(bad.status, 0, bad.err);
  assert.match(bad.out, /not a Telegram bot's username/);
  assert.equal((await cards(f)).length, 0, "a card was planted for a name that is not a bot's");

  await f.post(`/api/bots/${f.bot.id}/messages`, { text: "CONNECT_BOT PlanningBot" });
  const card = await waitFor(async () => (await cards(f))[0], "no card was planted");
  // The agent's own credential cannot ask for another agent's bot, save
  // its own card or reach its Telegram settings.
  const { bot: other } = await f.post("/api/bots", { name: "Other" });
  const statuses = await agentTries(f, [
    ["POST", `/api/bots/${other.id}/secrets`, { telegramBot: "OtherBot" }],
    ["POST", `/api/bots/${f.bot.id}/secret-cards/${card.id}/save`, { value: TOKEN }],
    ["POST", `/api/bots/${f.bot.id}/telegram`, { token: TOKEN }],
  ]);
  assert.deepEqual(statuses, [403, 403, 403]);
  assert.equal((await f.h.json(`/api/bots/${other.id}/telegram`)).configured, false);

  // The owner gives it a bot another way first: the card no longer
  // replaces anything, and asking again is told so.
  await f.post(`/api/bots/${f.bot.id}/telegram`, { token: "12345:TEST_ONLY_TOKEN" });
  const late = await f.h.fetch(`/api/bots/${f.bot.id}/secret-cards/${card.id}/save`, { method: "POST", body: JSON.stringify({ value: TOKEN }) });
  assert.equal(late.status, 409);
  assert.equal((await f.h.json(`/api/bots/${f.bot.id}/telegram`)).username, "PlanningBot");
  const again = await ask(f, "AnotherBot");
  assert.match(again.out, /already have a Telegram bot, @PlanningBot/);
  assert.equal((await cards(f)).length, 1);
});
