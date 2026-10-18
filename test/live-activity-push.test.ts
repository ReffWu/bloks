// Live Activities ended, and started, from this computer (GitHub 280).
//
// The phone can only end an activity while it runs; once it is suspended
// the end has to come from here, through Bloks Cloud. These run the real
// server with a stand-in relay and a paired synthetic phone, and hold the
// turn open with a provider that answers on cue.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { activityRelay } from "./helpers/activity-relay.ts";
import { startHarness } from "./helpers/server.ts";
import { agentOn, fakeProvider, idle, waitFor } from "./helpers/turns.ts";

const START = "ab".repeat(40);
const ACTIVITY = "cd".repeat(40);
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

test("a turn the person started at the computer starts an activity on their phone, and its end ends it", async (t) => {
  const p = await fakeProvider(t);
  const h = await startHarness({ BLOKS_ACTIVITY_DELAY_MS: "200" });
  t.after(() => h.stop());
  const phone = await activityRelay(t, h);
  const bot = await agentOn(h, p.port, "Mira");
  assert.equal((await phone.report({ env: "sandbox", start: START })).status, 200);

  assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Read the example notes" }) })).status, 202);
  const start = await waitFor(() => phone.pushes.find((x) => x.event === "start"));
  assert.ok(start, "a running turn the person started put no activity on their phone");
  assert.equal(start.token, START);
  assert.equal(start.env, "sandbox", "the token's environment rode along");
  assert.equal(start.state, "working");
  assert.equal(start.agentId, bot.id);
  assert.equal(start.laneId, bot.threadId);
  assert.equal(typeof start.startedAt, "number");
  // the words are the phone's alone: sealed for it, and opened here with its key
  assert.equal(start.words?.kind, "activity");
  assert.equal(start.words?.name, "Mira");
  assert.equal(typeof start.words?.task, "string");
  const plain = JSON.stringify({ ...start, sealed: undefined, words: undefined });
  assert.doesNotMatch(plain, /Mira|example notes/, "the relay must not be able to read whose turn it is or what about");

  // the phone woke, and reports the token iOS gave the new activity
  assert.equal((await phone.report({ env: "sandbox", activities: [{ token: ACTIVITY, agentId: bot.id, laneId: bot.threadId }] })).status, 200);
  await settle();
  assert.equal(phone.pushes.filter((x) => x.event === "end").length, 0, "an activity ended while its turn still ran");

  p.state.held.forEach((f) => f());
  p.state.answerAtOnce = true;
  assert.ok(await idle(h, bot));
  const end = await waitFor(() => phone.pushes.find((x) => x.event === "end"));
  assert.ok(end, "the answered turn's activity was never ended");
  assert.equal(end.token, ACTIVITY);
  assert.equal(end.sealed, undefined, "an end needs no words");
  assert.equal(phone.pushes.filter((x) => x.event === "start").length, 1, "one turn, one activity");
});

test("Stop ends the activity too, and a phone that started its own gets no second one", async (t) => {
  const p = await fakeProvider(t);
  const h = await startHarness({ BLOKS_ACTIVITY_DELAY_MS: "300" });
  t.after(() => h.stop());
  const phone = await activityRelay(t, h);
  const bot = await agentOn(h, p.port, "Mira");
  await phone.report({ env: "production", start: START });

  // Sent from the phone, which starts its own activity at once and says so.
  const sent = await h.fetchRemote(`/api/bots/${bot.id}/messages`, { method: "POST", token: phone.token, body: JSON.stringify({ text: "Draft the example reply" }) });
  assert.equal(sent.status, 202);
  await phone.report({ env: "production", activities: [{ token: ACTIVITY, agentId: bot.id, laneId: bot.threadId }] });
  await settle();
  assert.equal(phone.pushes.filter((x) => x.event === "start").length, 0, "the phone that sent the message already shows it");

  assert.equal((await h.fetch(`/api/bots/${bot.id}/interrupt`, { method: "POST", body: "{}" })).status, 200);
  const end = await waitFor(() => phone.pushes.find((x) => x.event === "end"));
  assert.ok(end, "a stopped turn's activity was never ended");
  assert.equal(end.token, ACTIVITY);
  assert.equal(end.env, "production");

  // The same phone, not saying it started one this time: the turn is the
  // person's own all the same, so the push starts it.
  assert.ok(await idle(h, bot));
  await h.fetchRemote(`/api/bots/${bot.id}/messages`, { method: "POST", token: phone.token, body: JSON.stringify({ text: "And the example summary" }) });
  const start = await waitFor(() => phone.pushes.find((x) => x.event === "start"));
  assert.ok(start, "a turn the phone's own message started got no activity");
  assert.equal(start.agentId, bot.id);
});

test("a routine's turn gets no activity, and an unpaired phone's tokens go with it", async (t) => {
  const p = await fakeProvider(t);
  p.state.answerAtOnce = false;
  const h = await startHarness({ BLOKS_ACTIVITY_DELAY_MS: "200" });
  t.after(() => h.stop());
  const phone = await activityRelay(t, h);
  const bot = await agentOn(h, p.port, "Mira");
  await phone.report({ env: "sandbox", start: START });

  const { routine } = await h.json("/api/routines", {
    method: "POST",
    body: JSON.stringify({ targetId: bot.id, targetKind: "agent", name: "Example digest", prompt: "Sum up the example feed", time: "08:00" }),
  });
  assert.equal((await h.fetch(`/api/routines/${routine.id}/run`, { method: "POST" })).status, 202);
  assert.ok(await waitFor(() => (p.state.held.length ? true : null)), "the routine's turn never reached its engine");
  await settle();
  assert.equal(phone.pushes.length, 0, "nobody asked for a routine's turn, so it is not on their Lock Screen");
  p.state.held.forEach((f) => f());
  p.state.answerAtOnce = true;
  assert.ok(await idle(h, bot));

  const file = join(h.home, ".bloks", "live-activities.json");
  assert.ok(existsSync(file), "the tokens were not kept for a restart");
  assert.ok(readFileSync(file, "utf8").includes(phone.deviceId));
  assert.equal((await h.fetch(`/api/pair/devices/${phone.deviceId}`, { method: "DELETE" })).status, 200);
  assert.ok(!readFileSync(file, "utf8").includes(phone.deviceId), "an unpaired phone's tokens outlived its pairing");
  assert.ok(!readFileSync(file, "utf8").includes(START));

  assert.equal((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "One more example" }) })).status, 202);
  assert.ok(await idle(h, bot));
  await settle();
  assert.equal(phone.pushes.length, 0, "an unpaired phone was still pushed to");
});

test("only a paired phone hands over tokens, and only real ones", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const phone = await activityRelay(t, h);
  assert.equal((await h.fetch("/api/live-activities", { method: "POST", body: JSON.stringify({ start: START }) })).status, 403, "this computer has no Lock Screen");
  assert.equal((await h.fetchRemote("/api/live-activities", { method: "POST", token: "not-a-real-token", body: JSON.stringify({ start: START }) })).status, 401);
  assert.equal((await phone.report({ start: "not hex" })).status, 400);
  assert.equal((await phone.report({ start: "ab" })).status, 400);
  assert.equal((await phone.report({ activities: "nope" })).status, 400);
  assert.equal((await phone.report({ start: START })).status, 200);
  assert.ok((await h.json("/api/health")).features.includes("live-activities"));
});

test("a question turns the activity to waiting for the person, and its answer turns it back", async (t) => {
  const p = await fakeProvider(t);
  p.state.askOn = "DECIDE-EXAMPLE";
  const h = await startHarness({ BLOKS_ACTIVITY_DELAY_MS: "200" });
  t.after(() => h.stop());
  const phone = await activityRelay(t, h);
  const bot = await agentOn(h, p.port, "Mira");
  await phone.report({ env: "sandbox", start: START });
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "DECIDE-EXAMPLE" }) });
  assert.ok(await waitFor(() => phone.pushes.find((x) => x.event === "start")), "no activity started");
  await phone.report({ env: "sandbox", activities: [{ token: ACTIVITY, agentId: bot.id, laneId: bot.threadId }] });

  const asking = await waitFor(() => phone.pushes.find((x) => x.event === "update" && x.state === "needs-you"));
  assert.ok(asking, "a card waiting for the person did not reach the Lock Screen");
  assert.equal(asking.token, ACTIVITY);
  assert.equal(asking.words?.name, "Mira");
  assert.equal(typeof asking.words?.question, "string");
  const card = (await h.json(`/api/bots/${bot.id}/messages?thread=${bot.threadId}&limit=100`)).messages.find((m: any) => m.kind === "options" && m.card?.requestId);
  assert.ok(card);
  p.state.answerAtOnce = true;
  await h.json(`/api/bots/${bot.id}/respond`, { method: "POST", body: JSON.stringify({ requestId: card.card.requestId, behavior: "answer", message: "Yes" }) });
  const back = await waitFor(() => phone.pushes.find((x) => x.event === "update" && x.state === "working"));
  assert.ok(back, "the answered card left the activity waiting");
  assert.equal(phone.pushes.filter((x) => x.event === "update" && x.state === "needs-you").length, 1, "one card, one change");
  assert.ok(await idle(h, bot));
  assert.ok(await waitFor(() => phone.pushes.find((x) => x.event === "end")), "the activity outlived its turn");
});
