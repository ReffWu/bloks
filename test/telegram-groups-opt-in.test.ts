// Groups are the owner's choice per agent, off until made, and bounded
// once made. Real HTTP/store handlers and a loopback Telegram only.
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_TELEGRAM_GROUP_REQUESTS_PER_HOUR } from "../server/limits.ts";
import { personFixture, until, SAM, LEE } from "./helpers/telegram-person.ts";

type Fixture = Awaited<ReturnType<typeof personFixture>>;
const GROUP = -7001, REX = 30303;
function group(f: Fixture, text: string, from = SAM, extra: any = {}) {
  return f.say(`@PlanningBot ${text}`, from, { chat: { id: GROUP, type: "supergroup", title: "Planning group" }, entities: [{ type: "mention", offset: 0, length: 12 }], ...extra });
}
function words(record: any): string { return record.text?.split("--- the new message ---").at(-1) ?? ""; }

test("groups are off until the owner turns them on: nobody there knocks, starts a turn, downloads or hears back", async (t) => {
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const f = await personFixture(t, "claude", { groups: false, files: { quiet: png } });
  assert.equal((await f.status()).groups, false);
  await f.admit("PRIVATE_LET_IN FAKE_TEXT"); await f.idle();
  group(f, "OWNER_WHILE_OFF FAKE_REPLY", SAM);
  group(f, "MEMBER_WHILE_OFF FAKE_REPLY", LEE);
  group(f, "STRANGER_WHILE_OFF FAKE_REPLY", REX, { from: { id: REX, is_bot: false, first_name: "Rex" } });
  group(f, "ALBUM_WHILE_OFF", LEE, { media_group_id: "quiet-album", photo: [{ file_id: "quiet", width: 1, height: 1 }] });
  f.say("@PlanningBot REPLY_WHILE_OFF", LEE, { chat: { id: GROUP, type: "supergroup", title: "Planning group" }, entities: [], reply_to_message: { message_id: 30, chat: { id: GROUP }, from: { id: 12345, first_name: "PlanningBot" }, text: "Bot answer" } });
  await f.flushed();
  f.say("PRIVATE_CONTROL_WORDS FAKE_TEXT");
  await until(() => f.records().some((r) => words(r).includes("PRIVATE_CONTROL_WORDS")), "the offset did not pass the group messages");
  await f.idle();
  assert.equal(f.records().some((r) => /WHILE_OFF/.test(r.text ?? "")), false, "a group message reached an engine while groups were off");
  assert.deepEqual((await f.status()).people.map((p: any) => p.name), ["Lee"], "a group member knocked while groups were off");
  assert.equal((await f.messages()).some((m) => /WHILE_OFF/.test(m.text ?? "") || /WHILE_OFF/.test(m.card?.subtitle ?? "")), false);
  assert.equal(f.calls.some((c) => c.method === "getFile"), false, "a group file was fetched while groups were off");
  assert.equal(f.sent(GROUP).length, 0);
  assert.equal(f.h.logs().includes("WHILE_OFF"), false);
});

test("groups can be turned on only once the owner is paired, and unpairing turns them off", async (t) => {
  const f = await personFixture(t, "claude", { groups: false });
  const bad = await f.h.fetch(`/api/bots/${f.bot.id}/telegram`, { method: "POST", body: JSON.stringify({ groups: "yes" }) });
  assert.equal(bad.status, 400);
  assert.equal((await f.post(`/api/bots/${f.bot.id}/telegram`, { groups: true })).groups, true);
  const unpaired = await f.post(`/api/bots/${f.bot.id}/telegram`, { unpair: true });
  assert.equal(unpaired.groups, false, "groups outlived the owner they were turned on by");
  const refused = await f.h.fetch(`/api/bots/${f.bot.id}/telegram`, { method: "POST", body: JSON.stringify({ groups: true }) });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /Pair yourself/);
});

test("turning groups off keeps waiting group words unsent and stops the group hearing back", async (t) => {
  const f = await personFixture(t);
  await f.admit("FAKE_TEXT"); await f.idle();
  group(f, "OWNER_RUNNING_GROUP FAKE_HOLD", SAM);
  await until(() => existsSync(join(f.root, "held")), "the owner group turn did not start");
  group(f, "MEMBER_QUEUED_GROUP FAKE_REPLY", LEE);
  await until(async () => (await f.messages()).some((m) => m.queued && m.text?.includes("MEMBER_QUEUED_GROUP")), "the member's group words did not queue");
  const off = await f.post(`/api/bots/${f.bot.id}/telegram`, { groups: false });
  assert.equal(off.groups, false);
  await until(async () => (await f.messages()).some((m) => m.text?.includes("MEMBER_QUEUED_GROUP") && m.unsent && !m.queued), "the member's waiting group words were not kept as unsent");
  writeFileSync(join(f.root, "release"), "1");
  await until(() => f.records().some((r) => r.reply), "the owner group turn did not try its reply");
  await f.idle();
  assert.equal(f.sent(GROUP).some((c) => c.body.text === "Hello Lee"), false, "a reply reached the group after groups were turned off");
  assert.equal(f.records().some((r) => words(r).includes("MEMBER_QUEUED_GROUP")), false);
  group(f, "GROUP_OWNER_LATER FAKE_REPLY", SAM);
  group(f, "GROUP_MEMBER_LATER FAKE_REPLY", LEE);
  await f.flushed();
  f.say("PRIVATE_CONTROL_WORDS FAKE_TEXT");
  await until(() => f.records().some((r) => words(r).includes("PRIVATE_CONTROL_WORDS")), "private chat stopped when groups were turned off");
  await f.idle();
  assert.equal(f.records().some((r) => /GROUP_(?:OWNER|MEMBER)_LATER/.test(r.text ?? "")), false);
  assert.equal(f.sent(GROUP).some((c) => c.body.text === "Hello Lee"), false);
});

test("let-in people's group requests are bounded each hour, the group and owner are told once, and the owner's own are not counted", async (t) => {
  const f = await personFixture(t);
  await f.admit("FAKE_TEXT"); await f.idle();
  await f.post(`/api/bots/${f.bot.id}/messages`, { text: "OWNER_BARRIER FAKE_HOLD" });
  await until(() => existsSync(join(f.root, "held")), "the owner barrier did not start");
  const anchors: number[] = [];
  for (let i = 1; i <= MAX_TELEGRAM_GROUP_REQUESTS_PER_HOUR + 2; i++) anchors.push(group(f, `BUDGET_${i}_WORDS`, LEE));
  group(f, "OWNER_UNCOUNTED_WORDS FAKE_TEXT", SAM);
  await f.flushed();
  await until(async () => (await f.messages()).some((m) => m.queued && m.text?.includes("OWNER_UNCOUNTED_WORDS")), "the owner's group words were counted against the budget");
  const rows = await f.messages();
  for (let i = 1; i <= MAX_TELEGRAM_GROUP_REQUESTS_PER_HOUR; i++) assert.ok(rows.some((m) => m.queued && m.text?.includes(`BUDGET_${i}_WORDS`)), `request ${i} was dropped inside the budget`);
  for (const i of [MAX_TELEGRAM_GROUP_REQUESTS_PER_HOUR + 1, MAX_TELEGRAM_GROUP_REQUESTS_PER_HOUR + 2]) assert.equal(rows.some((m) => m.text?.includes(`BUDGET_${i}_WORDS`)), false, `request ${i} passed the budget`);
  const told = f.sent(GROUP).filter((c) => c.body.text.includes("as many group requests"));
  assert.equal(told.length, 1, "the group was not told exactly once");
  assert.deepEqual(told[0].body.reply_parameters, { message_id: anchors[MAX_TELEGRAM_GROUP_REQUESTS_PER_HOUR] });
  assert.equal(rows.filter((m) => m.kind === "notice" && m.text?.includes("Later group requests are dropped")).length, 1, "the owner was not told exactly once");
  writeFileSync(join(f.root, "release"), "1");
  await f.idle();
  assert.equal(f.records().some((r) => r.text?.includes(`BUDGET_${MAX_TELEGRAM_GROUP_REQUESTS_PER_HOUR + 1}_WORDS`)), false);
  assert.ok(f.records().some((r) => words(r).includes("OWNER_UNCOUNTED_WORDS")));
});
