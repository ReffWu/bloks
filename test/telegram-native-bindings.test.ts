// Native Telegram bindings: which bot belongs to which agent, tokens,
// rotation and removal, queued phone requests and reply context. Split
// from telegram-native.test.ts so each file finishes well inside the
// per-file time limit on a slow machine.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CHAT, STRANGER, fixture, heardContext, inputWords, sleep, waitFor } from "./helpers/telegram-native.ts";

test("two agent bots do not borrow owner pairing or intake when their private chat id is the same", async (t) => {
  const f = await fixture(t);
  const { bot: second } = await f.post("/api/bots", { name: "Lee" });
  await f.h.json(`/api/bots/${second.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "codex", model: "gpt-6.1-sol" } }) });
  const token = "22222:SECOND_TEST_TOKEN";
  const status = await f.post(`/api/bots/${second.id}/telegram`, { token, enabled: true });
  assert.equal(status.needsOwnerPairing, true);
  f.tg.say("NOT_PAIRED_YET", token);
  await waitFor(() => f.tg.calls("sendMessage").some((call) => call.token === token && call.body.text.startsWith("The owner has been asked")), "the second bot borrowed the first bot's pairing");
  const list = async (id: string) => (await f.h.json(`/api/bots/${id}/messages?limit=500`)).messages;
  assert.equal((await list(second.id)).some((message: any) => message.text === "NOT_PAIRED_YET"), false);
  const pairing = await f.post(`/api/bots/${second.id}/telegram`, { pair: true });
  f.tg.say(pairing.pairing, token);
  await waitFor(async () => (await f.h.json(`/api/bots/${second.id}/telegram`)).ownerPaired, "the second owner pairing did not complete");
  assert.deepEqual((await f.h.json(`/api/bots/${second.id}/telegram`)).people, [], "the owner was still offered as a pending person");
  f.tg.say("ONLY_SECOND_BOT", token);
  await waitFor(() => f.tg.calls("sendMessage").some((call) => call.token === token && call.body.text === "ANSWER"), "the second bot's answer did not use its token");
  assert.equal((await list(second.id)).some((message: any) => message.text === "ONLY_SECOND_BOT"), true);
  assert.equal((await f.messages()).some((message) => message.text === "ONLY_SECOND_BOT" || message.text === pairing.pairing), false);
  f.tg.say("ONLY_FIRST_BOT");
  await waitFor(async () => (await f.messages()).some((message) => message.text === "ONLY_FIRST_BOT"), "the first bot stopped receiving its chat");
  assert.equal((await list(second.id)).some((message: any) => message.text === "ONLY_FIRST_BOT"), false);
  const publicStatus = await f.h.json("/api/telegram");
  assert.equal(JSON.stringify(publicStatus).includes(token), false);
});

test("a duplicate Telegram bot is refused even under a different token string", async (t) => {
  const f = await fixture(t);
  const { bot: second } = await f.post("/api/bots", { name: "Lee" });
  const response = await f.h.fetch(`/api/bots/${second.id}/telegram`, { method: "POST", body: JSON.stringify({ token: "12345:ROTATED_TEST_TOKEN" }) });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already belongs/);
  assert.equal((await f.h.json(`/api/bots/${second.id}/telegram`)).configured, false);
  assert.equal((await f.h.json(`/api/bots/${f.bot.id}/telegram`)).ownerPaired, true);
});

test("rotation and removal invalidate held old polls before they write into a conversation", async (t) => {
  const f = await fixture(t);
  const original = "12345:TEST_ONLY_TOKEN";
  f.tg.state.holdToken = original;
  await waitFor(() => f.tg.state.heldPolls.length, "the old bot never held a poll");
  f.tg.say("OLD_ROTATION_MESSAGE", original);
  const nextToken = "12345:ROTATED_TEST_TOKEN";
  await f.post(`/api/bots/${f.bot.id}/telegram`, { token: nextToken });
  f.tg.state.holdToken = nextToken;
  for (const release of f.tg.state.heldPolls.splice(0)) release();
  await waitFor(() => f.tg.state.heldPolls.length, "the rotated bot never started its own poll");
  assert.equal((await f.messages()).some((message) => message.text === "OLD_ROTATION_MESSAGE"), false);
  f.tg.say("OLD_REMOVAL_MESSAGE", nextToken);
  await f.post(`/api/bots/${f.bot.id}/telegram`, { forget: true });
  for (const release of f.tg.state.heldPolls.splice(0)) release();
  await sleep(150);
  assert.equal((await f.messages()).some((message) => message.text === "OLD_REMOVAL_MESSAGE"), false);
  assert.equal((await f.h.json(`/api/bots/${f.bot.id}/telegram`)).configured, false);
});


test("a real 2.6 config upgrade tells both old chats and identifies the owner with a fresh word", async (t) => {
  const f = await fixture(t);
  await f.h.crash();
  const file = join(f.root, ".bloks", "config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  const offset = config.telegram.bots[f.bot.id].offset;
  config.telegram = { token: "12345:TEST_ONLY_TOKEN", botId: f.bot.id, enabled: true, chatIds: [CHAT, STRANGER], offset, pairing: "old-word" };
  writeFileSync(file, JSON.stringify(config));
  await f.reboot();
  const migrated = JSON.parse(readFileSync(file, "utf8")).telegram;
  assert.equal(migrated.version, 2);
  assert.equal(migrated.token, undefined);
  assert.equal(migrated.migratedBotId, f.bot.id);
  assert.equal(migrated.bots[f.bot.id].offset, offset);
  assert.deepEqual(migrated.bots[f.bot.id].chatIds, []);
  assert.deepEqual(migrated.bots[f.bot.id].upgradeNotices.map((n: any) => n.chatId), [CHAT, STRANGER]);
  assert.equal(migrated.bots[f.bot.id].ownerUserId, undefined);
  assert.equal(migrated.bots[f.bot.id].pairing, null);
  const status = await f.h.json(`/api/bots/${f.bot.id}/telegram`);
  assert.equal(status.needsOwnerPairing, true);
  assert.equal(status.legacyPaired, 0);
  const pairing = await f.post(`/api/bots/${f.bot.id}/telegram`, { pair: true });
  assert.notEqual(pairing.pairing, "old-word");
  f.tg.say(pairing.pairing);
  await waitFor(async () => (await f.h.json(`/api/bots/${f.bot.id}/telegram`)).ownerPaired, "fresh word did not identify owner");
  const paired = JSON.parse(readFileSync(file, "utf8")).telegram.bots[f.bot.id];
  assert.equal(paired.ownerUserId, CHAT);
  assert.deepEqual(paired.chatIds, []);
  f.tg.say("Sam after upgrade");
  await waitFor(() => f.tg.sent().find((c) => c.body.chat_id === CHAT && c.body.text === "ANSWER"), "owner chat stopped working after upgrade");
  f.tg.say("Lee after upgrade", "12345:TEST_ONLY_TOKEN", STRANGER);
  await waitFor(() => f.tg.sent().find((c) => c.body.chat_id === STRANGER && c.body.text.startsWith("The owner has been asked")), "second legacy chat had no way to knock");
  assert.equal(f.tg.sent().some((c) => c.body.chat_id === STRANGER && c.body.text === "ANSWER"), false);
});


test("a real turn credential cannot read bot settings, pair or remove its Telegram bot", async (t) => {
  const f = await fixture(t);
  f.tg.say("SETTINGS_GUARD");
  await waitFor(() => f.tg.sent().some((c) => c.body.text === "GUARDS [403,403,403,403]"), "an agent bearer reached owner-only Telegram settings");
  const status = await f.h.json(`/api/bots/${f.bot.id}/telegram`);
  assert.equal(status.configured, true);
  assert.equal(status.ownerPaired, true);
  assert.equal(status.pairing, null);
});

async function savedTelegram(f: Awaited<ReturnType<typeof fixture>>, telegram: unknown) {
  await f.h.crash();
  const file = join(f.root, ".bloks", "config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.telegram = telegram;
  writeFileSync(file, JSON.stringify(config));
  await f.reboot();
}

test("deleting an agent removes its token, retires its poller and lets another agent use the bot", async (t) => {
  const f = await fixture(t);
  const token = "12345:TEST_ONLY_TOKEN";
  const { bot: second } = await f.post("/api/bots", { name: "Lee" });
  f.tg.state.holdToken = token;
  await waitFor(() => f.tg.state.heldPolls.length, "no held poll before deletion");
  const response = await f.h.fetch(`/api/bots/${f.bot.id}?forget=1`, { method: "DELETE" });
  assert.equal(response.status, 200);
  const config = readFileSync(join(f.root, ".bloks", "config.json"), "utf8");
  assert.equal(JSON.parse(config).telegram.bots[f.bot.id], undefined);
  assert.equal(config.includes(token), false, "deleted agent token stayed on disk");
  const polls = f.tg.state.pollTokens.length;
  for (const release of f.tg.state.heldPolls.splice(0)) release();
  await sleep(250);
  assert.equal(f.tg.state.pollTokens.length, polls, "deleted agent's poller kept running");
  f.tg.state.holdToken = "";
  const saved = await f.h.fetch(`/api/bots/${second.id}/telegram`, { method: "POST", body: JSON.stringify({ token }) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).needsOwnerPairing, true);
});

test("bindings without their agent are neither identified, polled nor counted as duplicates", async (t) => {
  const f = await fixture(t);
  const orphan = "33333:RESTORED_ONLY_TEST_TOKEN";
  f.tg.state.getMeReplies.set(orphan, { status: 401, body: { ok: false } });
  await savedTelegram(f, { version: 1, bots: {
    absentKnown: { token: "12345:OLD_TEST_TOKEN", telegramId: 12345, generation: "old", enabled: true },
    absentUnknown: { token: orphan },
  } });
  const before = f.tg.calls("getMe").length;
  const saved = await f.h.fetch(`/api/bots/${f.bot.id}/telegram`, { method: "POST", body: JSON.stringify({ token: "12345:TEST_ONLY_TOKEN" }) });
  assert.equal(saved.status, 200);
  await waitFor(() => f.tg.state.pollTokens.includes("12345:TEST_ONLY_TOKEN"), "restored token blocked the real agent's poller");
  assert.equal(f.tg.calls("getMe").slice(before).some((call) => call.token === orphan || call.token === "12345:OLD_TEST_TOKEN"), false);
  assert.equal(f.tg.state.pollTokens.includes(orphan), false);
  const state = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram;
  assert.equal(state.bots.absentUnknown.telegramId, undefined);
  assert.equal(state.bots[f.bot.id].telegramId, 12345);
});

for (const sameAgent of [true, false]) {
  test(`a refused unidentified legacy token does not block a valid token on ${sameAgent ? "the same" : "another"} agent`, async (t) => {
    const f = await fixture(t);
    const { bot: second } = await f.post("/api/bots", { name: "Lee" });
    const old = "88888:REVOKED_TEST_TOKEN";
    f.tg.state.getMeReplies.set(old, sameAgent ? { status: 401, body: { ok: false } } : { body: { ok: false } });
    await savedTelegram(f, { token: old, enabled: true, botId: f.bot.id, chatIds: [CHAT, STRANGER], offset: 0 });
    const id = sameAgent ? f.bot.id : second.id;
    const response = await f.h.fetch(`/api/bots/${id}/telegram`, { method: "POST", body: JSON.stringify({ token: "22222:VALID_TEST_TOKEN" }) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const state = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram.bots;
    assert.equal(state[id].token, "22222:VALID_TEST_TOKEN");
    assert.equal(state[id].telegramId, 22222);
    await waitFor(() => f.tg.state.pollTokens.includes("22222:VALID_TEST_TOKEN"), "new token did not poll");
  });
}

test("an unidentified live binding still refuses a different token for the same bot", async (t) => {
  const f = await fixture(t);
  const { bot: second } = await f.post("/api/bots", { name: "Lee" });
  const binding = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram.bots[f.bot.id];
  delete binding.telegramId;
  binding.enabled = false;
  await savedTelegram(f, { version: 1, bots: { [f.bot.id]: binding } });
  const response = await f.h.fetch(`/api/bots/${second.id}/telegram`, { method: "POST", body: JSON.stringify({ token: "12345:ROTATED_TEST_TOKEN" }) });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already belongs/);
  assert.equal((await f.h.json(`/api/bots/${second.id}/telegram`)).configured, false);
});

test("failure to reach an old binding names the saved bot, not a refusal of the valid new token", async (t) => {
  const f = await fixture(t);
  const { bot: second } = await f.post("/api/bots", { name: "Lee" });
  const old = "12345:TEST_ONLY_TOKEN";
  const binding = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram.bots[f.bot.id];
  delete binding.telegramId;
  binding.enabled = false;
  await savedTelegram(f, { version: 2, bots: { [f.bot.id]: binding } });
  f.tg.state.getMeReplies.set(old, { status: 0, body: {} });
  const response = await f.h.fetch(`/api/bots/${second.id}/telegram`, { method: "POST", body: JSON.stringify({ token: "22222:VALID_TEST_TOKEN" }) });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /verify a saved Telegram bot/);
  assert.doesNotMatch(body.error, /token was refused/);
  assert.equal((await f.h.json(`/api/bots/${second.id}/telegram`)).configured, false);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram.bots[f.bot.id], binding);
});

for (const mode of ["same token", "same bot id", "App Settings move"]) {
  test(`a pending migration through ${mode} keeps notice jobs and offset without carrying old grants`, async (t) => {
    const f = await fixture(t);
    const token = "12345:TEST_ONLY_TOKEN";
    await savedTelegram(f, { token, enabled: true, botId: "deleted-agent", chatIds: [CHAT, STRANGER], offset: 17 });
    f.tg.state.next = 18;
    const body = mode === "App Settings move" ? { migrate: true } : { token: mode === "same bot id" ? "12345:ROTATED_TEST_TOKEN" : token };
    const response = await f.h.fetch(`/api/bots/${f.bot.id}/telegram`, { method: "POST", body: JSON.stringify(body) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const config = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8"));
    assert.equal(config.telegram.pending, undefined);
    assert.equal(config.telegram.migrationError, undefined);
    assert.equal(config.telegram.migratedBotId, f.bot.id);
    assert.deepEqual(config.telegram.bots[f.bot.id].chatIds, []);
    assert.deepEqual(config.telegram.bots[f.bot.id].upgradeNotices.map((n: any) => n.chatId), [CHAT, STRANGER]);
    assert.equal(config.telegram.bots[f.bot.id].offset, 17);
    assert.equal(config.telegram.bots[f.bot.id].ownerUserId, undefined);
    assert.equal((await f.h.json(`/api/bots/${f.bot.id}/telegram`)).needsOwnerPairing, true);
    const activeToken = config.telegram.bots[f.bot.id].token;
    f.tg.say("Lee after pending migration", activeToken, STRANGER);
    await waitFor(() => f.tg.sent().some((call) => call.token === activeToken && call.body.chat_id === STRANGER && call.body.text.startsWith("The owner has been asked")), "the second legacy chat had no way to knock");
    assert.equal(f.tg.sent().some((call) => call.token === activeToken && call.body.chat_id === STRANGER && call.body.text === "ANSWER"), false);
  });
}

test("an App Settings pending move visibly refuses a bot already bound to another agent", async (t) => {
  const f = await fixture(t);
  const { bot: second } = await f.post("/api/bots", { name: "Lee" });
  const state = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram;
  state.pending = { token: "12345:ROTATED_TEST_TOKEN", chatIds: [CHAT, STRANGER], enabled: true, offset: 17 };
  await savedTelegram(f, state);
  const response = await f.h.fetch(`/api/bots/${second.id}/telegram`, { method: "POST", body: JSON.stringify({ migrate: true }) });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already belongs/);
  const config = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8"));
  assert.deepEqual(config.telegram.pending.chatIds, [CHAT, STRANGER]);
  assert.equal(config.telegram.bots[second.id], undefined);
  assert.equal(f.tg.state.pollTokens.includes("12345:ROTATED_TEST_TOKEN"), false);
});

test("invalid getMe results leave the binding, generation, owner and answering poller unchanged", async (t) => {
  const f = await fixture(t);
  const bad = "99999:INVALID_TEST_TOKEN";
  const good = { id: 99999, is_bot: true, username: "PlanningBot" };
  const cases = [
    { status: 401, body: { ok: false } },
    { body: { ok: false, result: good } },
    { body: { ok: true, result: { ...good, is_bot: false } } },
    { body: { ok: true, result: { is_bot: true, username: "PlanningBot" } } },
    { body: { ok: true, result: { ...good, id: 0 } } },
    { body: { ok: true, result: { ...good, id: -1 } } },
  ];
  for (const [i, denied] of cases.entries()) {
    const before = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram.bots[f.bot.id];
    f.tg.state.getMeReplies.set(bad, denied);
    const response = await f.h.fetch(`/api/bots/${f.bot.id}/telegram`, { method: "POST", body: JSON.stringify({ token: bad }) });
    assert.equal(response.status, 400, `invalid getMe case ${i} was accepted`);
    const after = JSON.parse(readFileSync(join(f.root, ".bloks", "config.json"), "utf8")).telegram.bots[f.bot.id];
    assert.deepEqual(after, before, `invalid getMe case ${i} changed the connection`);
    const replies = f.tg.sent().filter((call) => call.body.text === "ANSWER").length;
    f.tg.say(`Sam after refused token ${i}`);
    await waitFor(() => f.tg.sent().filter((call) => call.body.text === "ANSWER").length > replies, `invalid getMe case ${i} stopped the old poller`);
  }
});

test("unpairing without disabling retires an in-flight answer by generation", async (t) => {
  const f = await fixture(t);
  f.tg.say("HOLD_UNPAIR");
  await waitFor(() => existsSync(join(f.root, "unpair-started")), "the old turn did not start");
  const response = await f.h.fetch(`/api/bots/${f.bot.id}/telegram`, { method: "POST", body: JSON.stringify({ unpair: true }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).enabled, true);
  writeFileSync(join(f.root, "unpair-release"), "1");
  await waitFor(async () => (await f.messages()).some((message) => message.role === "bot" && message.text === "OLD_UNPAIRED_ANSWER"), "the old turn never finished in the app");
  await sleep(150);
  assert.equal(f.tg.sent().some((call) => call.body.text === "OLD_UNPAIRED_ANSWER"), false, "the unpaired chat received its retired answer");
});

test("a normal phone request finishes independently of another busy lane", async (t) => {
  const f = await fixture(t);
  const { bot } = await f.post("/api/bots/" + f.bot.id + "/tasks", { title: "Aside" });
  const aside = bot.tasks.find((task: any) => task.id !== f.bot.threadId)!;
  const active = await f.post("/api/bots/" + f.bot.id + "/tasks/" + f.bot.threadId + "/activate");
  assert.equal(active.bot.activeTaskId, f.bot.threadId);
  await f.post("/api/bots/" + f.bot.id + "/messages", { text: "SCOPED_HOLD", taskId: aside.id });
  await waitFor(() => existsSync(join(f.root, "SCOPED_HOLD-started")), "the aside never started");
  f.tg.say("SCOPED_PHONE");
  await waitFor(async () => (await f.messages()).some((m) => m.text === "PHONE FINAL"), "the consuming turn did not end");
  await waitFor(() => f.tg.calls("sendMessage").some(c => c.body.text === "PHONE FINAL"), "the other lane held the phone answer", 3_000);
  assert.equal(existsSync(join(f.root, "aside-release")), false);
  await f.post("/api/bots/" + f.bot.id + "/messages", { text: "SCOPED_LATER", taskId: f.bot.threadId });
  await waitFor(async () => (await f.messages()).some((m) => m.text === "LATER FINAL"), "the later turn never spoke");
  writeFileSync(join(f.root, "aside-release"), "1");
  const answer = await waitFor(() => f.tg.calls("sendMessage").find((c) => c.body.text === "PHONE FINAL"), "the original answer never came");
  assert.equal("disable_notification" in answer.body, false);
  assert.equal(f.tg.calls("sendMessage").filter((c) => c.body.text.includes("LATER")).length, 0);
  assert.equal(f.tg.calls("sendMessage").filter((c) => c.body.disable_notification).length, 0);
});

test("queued words wait without notes, start the twenty seconds at delivery, and exclude a later turn", async (t) => {
  const f = await fixture(t);
  await f.post("/api/bots/" + f.bot.id + "/messages", { text: "SCOPED_MAIN_HOLD" });
  await waitFor(() => existsSync(join(f.root, "scope-force-queue")), "the first turn never held");
  f.tg.say("SCOPED_OWNER_PROGRESS");
  const request = await waitFor(async () => (await f.messages()).find((m) => m.text === "SCOPED_OWNER_PROGRESS" && m.queued), "the phone request never queued");
  writeFileSync(join(f.root, "old-note-release"), "1");
  await waitFor(async () => (await f.messages()).some((m) => m.text === "An earlier request's late note."), "no earlier note while queued");
  await sleep(21_000);
  assert.equal(f.tg.calls("sendMessage").filter((c) => c.body.disable_notification).length, 0);
  writeFileSync(join(f.root, "main-release"), "1");
  const delivered = await waitFor(async () => (await f.messages()).find((m) => m.id === request.id && !m.queued && m.deliveredAt), "the request never delivered");
  const status = await waitFor(() => f.tg.sent().find((m) => m.body.disable_notification), "no consuming-turn note", 40_000);
  assert.equal(status.body.text, "PHONE NOTE");
  assert.ok(status.at - delivered.deliveredAt >= 19_000, "queue time must not count");
  f.tg.state.holdDelete = true;
  await waitFor(() => f.tg.state.deleteReleases.length === 1, "the notes never reached cleanup");
  await f.post("/api/bots/" + f.bot.id + "/messages", { text: "SCOPED_LATER" });
  await waitFor(async () => (await f.messages()).some((m) => m.text === "LATER FINAL"), "the later turn did not end");
  assert.equal(f.tg.calls("sendMessage").filter((c) => c.body.text === "PHONE FINAL").length, 0);
  f.tg.state.holdDelete = false; f.tg.state.deleteReleases.shift()!();
  const answer = await waitFor(() => f.tg.calls("sendMessage").find((c) => c.body.text === "PHONE FINAL"), "no queued answer");
  assert.ok(f.tg.state.deleted.some((d) => d.id === status.id && d.at <= answer.at));
  assert.equal(f.tg.calls("editMessageText").length, 0);
  assert.equal(f.tg.calls("sendMessage").filter((c) => c.body.text.includes("EARLIER") || c.body.text.includes("LATER")).length, 0);
});

test("a queued phone request taken back in the app sends none of the running turn's text", async (t) => {
  const f = await fixture(t);
  await f.post("/api/bots/" + f.bot.id + "/messages", { text: "SCOPED_MAIN_HOLD" });
  await waitFor(() => existsSync(join(f.root, "scope-force-queue")), "the first turn never held");
  f.tg.say("SCOPED_PHONE");
  const request = await waitFor(async () => (await f.messages()).find((m) => m.text === "SCOPED_PHONE" && m.queued), "the phone request never queued");
  writeFileSync(join(f.root, "old-note-release"), "1");
  await waitFor(async () => (await f.messages()).some((m) => m.text === "An earlier request's late note."), "no earlier note");
  await f.h.json("/api/threads/" + f.bot.threadId + "/messages/" + request.id, { method: "DELETE" });
  const fallback = "(the agent finished without saying anything)";
  await waitFor(() => f.tg.calls("sendMessage").some((c) => c.body.text === fallback), "no no-text answer after takeback");
  writeFileSync(join(f.root, "main-release"), "1");
  await waitFor(async () => (await f.messages()).some((m) => m.text === "EARLIER FINAL"), "the original work was lost");
  assert.equal(f.tg.calls("sendMessage").filter((c) => /earlier|PHONE/i.test(c.body.text)).length, 0);
  assert.equal(f.tg.calls("sendMessage").filter((c) => c.body.disable_notification).length, 0);
  assert.equal(existsSync(join(f.root, "SCOPED_PHONE-started")), false);
});

const ctxOriginal = (id: number, text = "Earlier sample") => ({ message_id: id, chat: { id: CHAT }, from: { first_name: "Sample author" }, text });


test("reply context reaches saved Telegram input and direct engine prompt once", async t => {
  const f = await fixture(t); f.tg.say("Current request", undefined, CHAT, { ...ctxOriginal(11), text: undefined, caption: "Earlier document caption", document: { file_id: "quoted", file_name: "sample.pdf" } });
  const calls = await waitFor(() => { const c = heardContext(f); return c.length ? c : null }, "no direct input"); const words = inputWords(calls[0]);
  assert.match(words, /Replying to Sample author's earlier message: "Earlier document caption"/); assert.equal((words.match(/Replying to/g) ?? []).length, 1);
  const saved = await waitFor(async () => { const m = (await f.messages()).find(m => m.text === "Current request"); return m ?? null }, "no saved input");
  assert.deepEqual(saved.replyTo, { id: `tg:${CHAT}:11`, author: "Sample author", excerpt: "Earlier document caption" }); assert.equal(saved.fromTelegram, true);
  assert.equal(f.tg.calls("getFile").length, 0, "quoted document must not be downloaded");
});
test("reply context accepted steer matches in-app steer without quote-driven skills", async t => {
  const f = await fixture(t); f.tg.say("CTX_HOLD"); await waitFor(() => existsSync(join(f.root, "ctx-started")), "no active turn");
  f.tg.say("Telegram followup", undefined, CHAT, ctxOriginal(12, "/compact $quoted_skill"));
  await waitFor(() => heardContext(f).some(c => c.method === "turn/steer"), "no Telegram steer");
  await f.post(`/api/bots/${f.bot.id}/messages`, { text: "In-app followup", replyTo: { author: "Sample author", excerpt: "/compact $quoted_skill", id: "app-ref" }, delivery: "now" });
  const calls = await waitFor(() => { const c = heardContext(f).filter(c => c.method === "turn/steer"); return c.length === 2 ? c : null }, "no in-app steer");
  for (const c of calls) { assert.match(inputWords(c), /Replying to Sample author's earlier message/); assert.equal((inputWords(c).match(/Replying to/g) ?? []).length, 1); assert.ok(c.params.input.every((i: any) => i.type === "text"), "quoted skill is not activated") }
  const rows = await f.messages(); for (const text of ["Telegram followup", "In-app followup"]) { const row = rows.find(m => m.text === text); assert.equal(row.midTurn, true); assert.ok(row.replyTo) }
  writeFileSync(join(f.root, "ctx-release"), "1");
});
test("reply context survives definite steer refusal and its queued delivery", async t => {
  const f = await fixture(t); writeFileSync(join(f.root, "scope-force-queue"), "1"); await f.post(`/api/bots/${f.bot.id}/messages`, { text: "CTX_HOLD" }); await waitFor(() => existsSync(join(f.root, "ctx-started")), "no active turn");
  f.tg.say("Queued Telegram request", undefined, CHAT, ctxOriginal(13, "Queued sample excerpt"));
  const row = await waitFor(async () => (await f.messages()).find(m => m.text === "Queued Telegram request" && m.queued), "no queued input"); assert.equal(row.replyTo.excerpt, "Queued sample excerpt");
  writeFileSync(join(f.root, "ctx-release"), "1");
  const c = await waitFor(() => heardContext(f).find(c => c.method === "turn/start" && inputWords(c).includes("Queued Telegram request")), "no queued engine delivery"); assert.match(inputWords(c), /Queued sample excerpt/); assert.equal((inputWords(c).match(/Replying to/g) ?? []).length, 1);
});
