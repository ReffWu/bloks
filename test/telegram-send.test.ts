// An agent sends a file it made to its own paired Telegram chat, whatever
// started the turn (GitHub 367): only to the owner's chat with its own
// bot, only while that holds, and only a file from its own folders.
// Telegram is a loopback stub, the engine a fixture that runs the agent's
// own command line, and the turns here all begin in the app.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { allows } from "../server/agent-cli.ts";
import { CHAT, agentCli, fixture } from "./helpers/telegram-native.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const BIN = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));

const uploads = (f: Awaited<ReturnType<typeof fixture>>) => [...f.tg.calls("sendPhoto"), ...f.tg.calls("sendDocument")];

test("from a turn that began in the app, a file from the agent's own folders goes to its paired chat, and the answer says so", async (t) => {
  const f = await fixture(t);
  const files = join(f.root, ".bloks", "artifacts", f.bot.id);
  const workspace = join(f.root, ".bloks", "workspaces", f.bot.id);
  mkdirSync(files, { recursive: true });
  mkdirSync(join(workspace, "out"), { recursive: true });
  writeFileSync(join(files, "chart.png"), PNG);
  writeFileSync(join(workspace, "out", "notes.pdf"), "%PDF-1.4 notes");

  const chart = await agentCli(f, ["telegram", "send", join(files, "chart.png"), "--caption", "The Q3 chart"]);
  assert.equal(chart.status, 0, JSON.stringify(chart.answer));
  assert.equal(chart.answer.ok, true);
  assert.equal(chart.answer.sent, "chart.png");
  assert.match(chart.answer.note, /^sent to the person's Telegram chat with @PlanningBot$/);
  const [photo] = f.tg.calls("sendPhoto");
  assert.equal(photo?.body.chat_id, String(CHAT));
  assert.deepEqual(photo?.body.photo, { name: "chart.png", type: "image/png", size: PNG.length });
  assert.equal(photo?.body.caption, "The Q3 chart");

  // from the folder its turns work in, with no caption
  const notes = await agentCli(f, ["telegram", "send", join(workspace, "out", "notes.pdf")]);
  assert.equal(notes.status, 0, JSON.stringify(notes.answer));
  const [document] = f.tg.calls("sendDocument");
  assert.equal(document?.body.chat_id, String(CHAT));
  assert.equal(document?.body.document.name, "notes.pdf");
  assert.equal("caption" in document!.body, false);
  assert.equal(uploads(f).length, 2);

  // too large for Telegram, said the way a turn's files say it
  writeFileSync(join(files, "footage.mov"), "");
  truncateSync(join(files, "footage.mov"), 51 * 1024 * 1024);
  const big = await agentCli(f, ["telegram", "send", join(files, "footage.mov")]);
  assert.equal(big.status, 1);
  assert.equal(big.answer.error, "footage.mov was not sent: over Telegram's 50 MB");

  // a path outside its own folders is refused, and so is one that leads
  // there by a link, a hidden file, and a file that is not there
  writeFileSync(join(f.root, "secret.txt"), "not the agent's");
  symlinkSync(join(f.root, "secret.txt"), join(files, "escape.txt"));
  writeFileSync(join(workspace, ".env"), "KEY=value");
  for (const [path, why] of [
    [join(f.root, "secret.txt"), /outside your working folder and your own files/],
    [join(files, "escape.txt"), /outside your working folder and your own files/],
    [join(workspace, ".env"), /hidden file/],
    [join(files, "nothing.png"), /^there is no file at /],
  ] as const) {
    const refused = await agentCli(f, ["telegram", "send", path]);
    assert.equal(refused.status, 1, path);
    assert.match(refused.answer.error, why, path);
  }
  assert.equal(uploads(f).length, 2, "a refused file reached Telegram");

  // once the person unpairs, nothing more goes
  const unpaired = await f.post("/api/telegram", { botId: f.bot.id, unpair: true });
  assert.equal(unpaired.ownerPaired, false);
  const after = await agentCli(f, ["telegram", "send", join(files, "chart.png")]);
  assert.equal(after.status, 1);
  assert.match(after.answer.error, /not paired with the person's chat/);
  assert.equal(uploads(f).length, 2);
});

test("an agent with no Telegram bot is told so, and nothing is sent", async (t) => {
  const f = await fixture(t, "codex", false, false);
  const files = join(f.root, ".bloks", "artifacts", f.bot.id);
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "chart.png"), PNG);
  const refused = await agentCli(f, ["telegram", "send", join(files, "chart.png")]);
  assert.equal(refused.status, 1);
  assert.match(refused.answer.error, /you have no Telegram bot/);
  assert.equal(uploads(f).length, 0);

  // and the command is in its help, beside connect
  const help = spawnSync(process.execPath, [BIN, "help"], { env: { ...process.env, HOME: f.root, BLOKS_DATA_DIR: join(f.root, ".bloks"), BLOKS_TOKEN: "" }, encoding: "utf8" });
  const telegram = JSON.parse(help.stdout).commands.find((c: { name: string }) => c.name === "telegram");
  assert.match(telegram.use, /telegram send <file> \[--caption "<words>"\]/);
  assert.match(telegram.about, /whatever started this turn/);
});

test("only its own chat: the route is the agent's own, and its Telegram settings stay the person's", () => {
  assert.equal(allows("ada", "POST", "/api/bots/ada/telegram/send").ok, true);
  const other = allows("ada", "POST", "/api/bots/grace/telegram/send");
  assert.equal(other.ok, false);
  assert.equal(other.reason, "an agent can only send files to its own Telegram chat");
  assert.equal(allows("ada", "GET", "/api/bots/ada/telegram/send").ok, false);
  assert.equal(allows("ada", "POST", "/api/bots/ada/telegram").ok, false);
  assert.equal(allows("ada", "GET", "/api/bots/ada/telegram").ok, false);
});
