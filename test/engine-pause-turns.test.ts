// Engine pauses as turns meet them (server/engine-pauses.ts, based on
// GitHub 305). With nothing paused nothing changes and nothing is written.
// A pause holds what is said to an agent on that engine, where the person
// can see it and until when, and lets it go when the pause ends or is
// ended, after a restart too. A running turn finishes unless the owner
// asked for it to stop. A saved file that cannot be read stops nothing.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness, type Harness } from "./helpers/server.ts";
import { agentOn, fakeProvider, idle, messagesOf, waitFor } from "./helpers/turns.ts";

const pauseFile = (home: string) => join(home, ".bloks", "engine-pauses.json");
const pause = (h: Harness, body: Record<string, unknown>) =>
  h.fetch("/api/engine-pauses", { method: "POST", body: JSON.stringify(body) });
const quiet = (ms = 800) => new Promise((r) => setTimeout(r, ms));

// Each test's own after hooks run in the order they were registered, and
// a home is made before its server, so removing it there raced the server
// still writing its last file. The homes go once the whole file is done,
// when every server has stopped.
const homes: string[] = [];
after(() => {
  for (const dir of homes) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function home(_t: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "bloks-pause-turns-"));
  mkdirSync(join(dir, ".bloks"), { recursive: true });
  homes.push(dir);
  return dir;
}

test("with nothing paused a turn runs as it did, and no pause file is written", async (t) => {
  const dir = home(t);
  const fake = await fakeProvider(t);
  fake.state.answerAtOnce = true;
  const h = await startHarness({ HOME: dir });
  t.after(() => h.stop());
  const ivy = await agentOn(h, fake.port, "Ivy");
  const said = await h.json(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "PLAIN-WORDS" }) });
  assert.equal(said.queued, undefined);
  assert.ok(await waitFor(() => fake.sent("PLAIN-WORDS") >= 1), "the turn never ran");
  await idle(h, ivy);
  const listed = await h.json("/api/engine-pauses");
  assert.deepEqual(listed.pauses, []);
  assert.equal(listed.fault, null);
  assert.ok(listed.choices.some((c: any) => c.what.instanceId === "grok"), "the engine is not offered to pause");
  assert.equal(existsSync(pauseFile(dir)), false, "a pause file was written with nothing paused");
  assert.ok(!(await messagesOf(h, ivy)).some((m) => /paused/.test(m.text ?? "")));
});

test("a pause holds what is said to an agent on that engine, says so, and lets it go when ended", async (t) => {
  const dir = home(t);
  const fake = await fakeProvider(t);
  fake.state.answerAtOnce = true;
  const h = await startHarness({ HOME: dir });
  t.after(() => h.stop());
  const ivy = await agentOn(h, fake.port, "Ivy");
  const jo = await agentOn(h, fake.port, "Jo");
  const { blok } = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Ops", memberIds: [ivy.id, jo.id] }) });

  assert.equal((await pause(h, { what: { instanceId: "grok" }, agents: [ivy.id] })).status, 400, "a pause with no end");
  assert.equal((await pause(h, { what: { instanceId: "grok" }, agents: [ivy.id], minutes: 8 * 24 * 60 })).status, 400, "a pause past a week");
  const made = await pause(h, { what: { instanceId: "grok" }, agents: [ivy.id], minutes: 60, note: "plan nearly spent" });
  assert.equal(made.status, 201);
  const { pause: held, running, stopped } = await made.json();
  assert.deepEqual([running, stopped], [0, 0]);
  assert.ok(Math.abs(held.until - Date.now() - 60 * 60_000) < 10_000);
  assert.deepEqual(held.agentNames, ["Ivy"]);
  assert.ok(existsSync(pauseFile(dir)), "the pause was not saved");

  // the person's words wait in the lane, shown as waiting for the pause
  const said = await h.json(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "HELD-WORDS" }) });
  assert.equal(said.queued, true);
  assert.match(said.note, /Ivy is paused on .* until .*plan nearly spent/);
  // a room line for her waits too
  await h.json(`/api/bloks/${blok.id}/messages`, { method: "POST", body: JSON.stringify({ text: "@Ivy ROOM-WORDS" }) });
  // and somebody not paused answers as ever
  await h.json(`/api/bots/${jo.id}/messages`, { method: "POST", body: JSON.stringify({ text: "FREE-WORDS" }) });
  assert.ok(await waitFor(() => fake.sent("FREE-WORDS") >= 1), "a pause for Ivy held up Jo");
  await quiet();
  assert.equal(fake.sent("HELD-WORDS"), 0, "a paused engine heard the person");
  assert.equal(fake.sent("ROOM-WORDS"), 0, "a paused engine heard the room");
  const waiting = (await messagesOf(h, ivy)).find((m) => m.text === "HELD-WORDS");
  assert.equal(waiting.queued, true);
  assert.equal(waiting.waitsFor, "pause");
  assert.equal(waiting.waitsUntil, held.until);
  const notices = (await messagesOf(h, ivy)).filter((m) => m.kind === "notice" && /is paused on/.test(m.text));
  assert.equal(notices.length, 1, "the hold is said once");
  const room = (await h.json("/api/bloks")).bloks.find((b: any) => b.id === blok.id);
  assert.ok(room.messages.some((m: any) => m.kind === "notice" && /Ivy is paused/.test(m.text)), "the room was not told");

  // a second message joins the first without a second notice
  await h.json(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "MORE-WORDS" }) });
  assert.equal((await messagesOf(h, ivy)).filter((m) => m.kind === "notice" && /is paused on/.test(m.text)).length, 1);

  const listed = await h.json("/api/engine-pauses");
  assert.deepEqual(listed.pauses.map((p: any) => p.id), [held.id]);

  // ended early, what it held goes, in its own lane and in the room
  const ended = await h.fetch(`/api/engine-pauses/${held.id}`, { method: "DELETE" });
  assert.equal(ended.status, 200);
  assert.ok(await waitFor(() => fake.sent("HELD-WORDS") >= 1), "what waited never went");
  assert.ok(await waitFor(() => fake.sent("ROOM-WORDS") >= 1), "the room line never went");
  await idle(h, ivy);
  const went = (await messagesOf(h, ivy)).find((m) => m.text === "HELD-WORDS");
  assert.equal(went.queued, false);
  assert.equal(went.waitsFor, undefined);
  assert.equal(fake.sent("HELD-WORDS"), 1);
  assert.deepEqual((await h.json("/api/engine-pauses")).pauses, []);
});

test("an agent with a backup that may go is answered by it while its own engine is paused", async (t) => {
  const dir = home(t);
  const fake = await fakeProvider(t);
  fake.state.answerAtOnce = true;
  const h = await startHarness({ HOME: dir });
  t.after(() => h.stop());
  const ivy = await agentOn(h, fake.port, "Ivy");
  await h.json("/api/providers/deepseek/connect", { method: "POST", body: JSON.stringify({ key: "test-key", url: `http://127.0.0.1:${fake.port}` }) });
  const set = await h.fetch(`/api/bots/${ivy.id}`, { method: "PATCH", body: JSON.stringify({ backupSelection: { instanceId: "deepseek", model: "grok-4" } }) });
  assert.equal(set.status, 200);
  assert.equal((await pause(h, { what: { instanceId: "grok" }, minutes: 30 })).status, 201);
  const said = await h.json(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "BACKUP-WORDS" }) });
  assert.equal(said.queued, undefined, "a pause held a turn its backup could take");
  assert.ok(await waitFor(() => fake.sent("BACKUP-WORDS") >= 1));
  await idle(h, ivy);
  const bot = (await h.json("/api/bots")).bots.find((b: any) => b.id === ivy.id);
  assert.deepEqual(bot.modelSelection, { instanceId: "grok", model: "grok-4" }, "a pause changed the agent's own engine");
});

test("a turn already running finishes, unless the owner asks for it to stop", async (t) => {
  const dir = home(t);
  const fake = await fakeProvider(t);
  const h = await startHarness({ HOME: dir });
  t.after(() => h.stop());
  const ivy = await agentOn(h, fake.port, "Ivy");

  await h.fetch(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "LONG-ONE" }) });
  assert.ok(await waitFor(() => fake.sent("LONG-ONE") >= 1));
  const kept = await (await pause(h, { what: { family: "xai" }, minutes: 30 })).json();
  assert.deepEqual([kept.running, kept.stopped], [1, 0]);
  await quiet(500);
  assert.equal((await h.json("/api/bots")).bots.find((b: any) => b.id === ivy.id).busy, true, "a pause stopped a turn nobody asked it to");
  fake.state.held.shift()!();
  await idle(h, ivy);
  assert.ok((await messagesOf(h, ivy)).some((m) => m.role === "bot" && m.text === "Done."), "the running turn did not finish");
  await h.fetch(`/api/engine-pauses/${kept.pause.id}`, { method: "DELETE" });

  await h.fetch(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "LONG-TWO" }) });
  assert.ok(await waitFor(() => fake.sent("LONG-TWO") >= 1));
  const stopping = await (await pause(h, { what: { instanceId: "grok", model: "grok-4" }, minutes: 30, stopRunning: true })).json();
  assert.deepEqual([stopping.running, stopping.stopped], [0, 1]);
  assert.ok(await idle(h, ivy), "the turn the owner stopped is still running");
  assert.ok((await messagesOf(h, ivy)).some((m) => m.kind === "notice" && /was stopped, as you asked/.test(m.text)));
});

test("a pause saved before a restart still holds after it, and ends on its own", async (t) => {
  const dir = home(t);
  const fake = await fakeProvider(t);
  fake.state.answerAtOnce = true;
  let first!: Harness;
  let second!: Harness;
  t.after(async () => {
    await first?.crash();
    await second?.stop();
  });
  first = await startHarness({ HOME: dir });
  const ivy = await agentOn(first, fake.port, "Ivy");
  const made = await (await pause(first, { what: { instanceId: "grok" }, minutes: 60 })).json();
  const said = await first.json(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "ACROSS-RESTART" }) });
  assert.equal(said.queued, true);
  await first.crash();

  // Brought to its end soon, as if most of the hour passed while Bloks
  // was away: the next start reads it, holds until then, and lets go
  // with no tick and nobody asking.
  const saved = JSON.parse(readFileSync(pauseFile(dir), "utf8"));
  const until = Date.now() + 25_000;
  saved.pauses[0].until = until;
  writeFileSync(pauseFile(dir), JSON.stringify(saved));
  second = await startHarness({ HOME: dir });
  assert.deepEqual((await second.json("/api/engine-pauses")).pauses.map((p: any) => p.id), [made.pause.id]);
  await quiet();
  if (Date.now() < until - 1_000) {
    assert.equal(fake.sent("ACROSS-RESTART"), 0, "a restart let a paused turn go");
    assert.equal((await messagesOf(second, ivy)).find((m) => m.text === "ACROSS-RESTART").queued, true);
  }
  assert.ok(await waitFor(() => fake.sent("ACROSS-RESTART") >= 1, 45_000), "the pause ended and what it held never went");
  assert.ok(Date.now() >= until, "what a pause held went before it ended");
  await idle(second, ivy);
  assert.equal((await messagesOf(second, ivy)).find((m) => m.text === "ACROSS-RESTART").queued, false);
  assert.deepEqual((await second.json("/api/engine-pauses")).pauses, []);
});

test("a pause file that cannot be read stops no work, and the owner is told", async (t) => {
  const dir = home(t);
  writeFileSync(pauseFile(dir), "{ this is not a pause list");
  const fake = await fakeProvider(t);
  fake.state.answerAtOnce = true;
  const h = await startHarness({ HOME: dir });
  t.after(() => h.stop());
  const ivy = await agentOn(h, fake.port, "Ivy");
  const said = await h.json(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "STILL-WORKS" }) });
  assert.equal(said.queued, undefined);
  assert.ok(await waitFor(() => fake.sent("STILL-WORKS") >= 1), "an unreadable pause file stopped a turn");
  const listed = await h.json("/api/engine-pauses");
  assert.deepEqual(listed.pauses, []);
  assert.match(listed.fault, /could not be read/);
  // and a new pause still saves, and holds
  assert.equal((await pause(h, { what: { instanceId: "grok" }, minutes: 30 })).status, 201);
  const held = await h.json(`/api/bots/${ivy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "NOW-HELD" }) });
  assert.equal(held.queued, true);
});
