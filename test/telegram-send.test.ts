// An agent sends a file it made to its own paired Telegram chat, whatever
// started the turn (GitHub 367): only to the owner's chat with its own
// bot, only while that holds, and only a file from its own folders.
// Telegram is a loopback stub, the engine a fixture that runs the agent's
// own command line, and the turns here all begin in the app. Words go
// the same way, as messages of their own, and either can go silent
// (GitHub 420).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { allows } from "../server/agent-cli.ts";
import { MAX_TELEGRAM_SEND_TEXT_CHARS, MAX_TELEGRAM_SENDS_PER_HOUR } from "../server/limits.ts";
import { trySendText } from "../server/telegram.ts";
import { CHAT, agentCli, agentTries, fixture } from "./helpers/telegram-native.ts";

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
  assert.match(telegram.use, /telegram send <file> \[--caption "<words>"\] \[--silent\]/);
  assert.match(telegram.use, /telegram send --text "<words>" \[--silent\]/);
  assert.match(telegram.about, /whatever started this turn/);

  // nor is a text
  const text = await agentCli(f, ["telegram", "send", "--text", "Ready"]);
  assert.equal(text.status, 1);
  assert.match(text.answer.error, /you have no Telegram bot/);
  assert.equal(f.tg.calls("sendMessage").length, 0);
});

test("a text goes as its own message, formatted the way an answer is, and can go without a sound", async (t) => {
  const f = await fixture(t);
  const messages = () => f.tg.calls("sendMessage").slice(before);
  const before = f.tg.calls("sendMessage").length;

  const words = "Tonight's three:\n**First** is `git push`\n\n```\nnpm test\n```\n[the site](https://example.com)";
  const sent = await agentCli(f, ["telegram", "send", "--text", words]);
  assert.equal(sent.status, 0, JSON.stringify(sent.answer));
  assert.deepEqual(sent.answer, { ok: true, sent: "text", messages: 1, note: "sent to the person's Telegram chat with @PlanningBot" });
  const [message] = messages();
  assert.equal(message?.body.chat_id, CHAT);
  assert.equal(message?.body.parse_mode, "HTML");
  // a code span and a block are what Telegram makes one tap to copy
  assert.match(message?.body.text, /^Tonight's three:\n<b>First<\/b> is <code>git push<\/code>\n\n<pre>npm test<\/pre>\n<a href="https:\/\/example\.com">the site<\/a>$/);
  assert.equal("disable_notification" in message!.body, false);

  // silent, before the words or after them
  for (const args of [["--silent", "--text", "One"], ["--text", "Two", "--silent"]]) {
    const quiet = await agentCli(f, ["telegram", "send", ...args]);
    assert.equal(quiet.status, 0, JSON.stringify(quiet.answer));
    assert.equal(quiet.answer.note, "sent to the person's Telegram chat with @PlanningBot, silently");
    assert.equal(messages().at(-1)?.body.disable_notification, true);
  }
  assert.deepEqual(messages().map((m) => m.body.text), [message?.body.text, "One", "Two"]);

  // a long text is split as a long answer is, and the answer counts them
  const long = await agentCli(f, ["telegram", "send", "--text", "word ".repeat(1800), "--silent"]);
  assert.equal(long.status, 0, JSON.stringify(long.answer));
  assert.equal(long.answer.messages, 3);
  assert.equal(messages().length, 6);
  assert.ok(messages().slice(3).every((m) => m.body.disable_notification === true && m.body.text.length <= 4096));

  // and a file can go silently too
  const files = join(f.root, ".bloks", "artifacts", f.bot.id);
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "chart.png"), PNG);
  const chart = await agentCli(f, ["telegram", "send", "--silent", join(files, "chart.png"), "--caption", "The Q3 chart"]);
  assert.equal(chart.status, 0, JSON.stringify(chart.answer));
  assert.equal(chart.answer.sent, "chart.png");
  const [photo] = f.tg.calls("sendPhoto");
  assert.equal(photo?.body.disable_notification, "true");
  assert.equal(photo?.body.caption, "The Q3 chart");

  // refused: too long, empty, both a file and words, and a caption on words
  for (const [args, why] of [
    [["--text", "x".repeat(MAX_TELEGRAM_SEND_TEXT_CHARS + 1)], new RegExp(`^a text is ${MAX_TELEGRAM_SEND_TEXT_CHARS} characters at most, and that one is ${MAX_TELEGRAM_SEND_TEXT_CHARS + 1}`)],
    [["--text", "   "], /needs the words/],
    [["--text"], /needs the words/],
    [[join(files, "chart.png"), "--text", "And this"], /a file or --text, not both/],
    [["--text", "Two", "words"], /Put the text in quotes/],
  ] as const) {
    const refused = await agentCli(f, ["telegram", "send", ...args]);
    assert.equal(refused.status, 1, args.join(" ").slice(0, 80));
    assert.match(refused.answer.error, why);
  }
  assert.deepEqual(await agentTries(f, [
    ["POST", `/api/bots/${f.bot.id}/telegram/send`, { text: "Ready", caption: "A caption" }],
    ["POST", `/api/bots/${f.bot.id}/telegram/send`, { text: "Ready", path: join(files, "chart.png") }],
    ["POST", `/api/bots/${f.bot.id}/telegram/send`, {}],
  ]), [400, 400, 400]);
  assert.equal(messages().length, 6, "a refused text reached Telegram");
  assert.equal(f.tg.calls("sendPhoto").length, 1);

  // once the person unpairs, no words go either
  await f.post("/api/telegram", { botId: f.bot.id, unpair: true });
  const after = await agentCli(f, ["telegram", "send", "--text", "Still there?"]);
  assert.equal(after.status, 1);
  assert.match(after.answer.error, /not paired with the person's chat/);
  assert.equal(messages().length, 6);
});

test("files and texts share one hour's count", async (t) => {
  const f = await fixture(t);
  const send = `/api/bots/${f.bot.id}/telegram/send`;
  const before = f.tg.calls("sendMessage").length;
  // over two turns, since one turn makes twelve changes at most
  const texts = (from: number, count: number) => Array.from({ length: count }, (_, i) => ["POST", send, { text: `Text ${from + i}`, silent: true }] as [string, string, unknown]);
  const half = MAX_TELEGRAM_SENDS_PER_HOUR / 2;
  assert.deepEqual(await agentTries(f, texts(1, half)), Array(half).fill(200));
  assert.deepEqual(await agentTries(f, texts(half + 1, half + 1)), [...Array(half).fill(200), 429]);
  assert.equal(f.tg.calls("sendMessage").length - before, MAX_TELEGRAM_SENDS_PER_HOUR);

  const files = join(f.root, ".bloks", "artifacts", f.bot.id);
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "chart.png"), PNG);
  const chart = await agentCli(f, ["telegram", "send", join(files, "chart.png")]);
  assert.equal(chart.status, 1);
  assert.equal(chart.answer.error, `chart.png was not sent: an agent sends at most ${MAX_TELEGRAM_SENDS_PER_HOUR} files and texts to Telegram an hour. Try again later`);
  assert.equal(f.tg.calls("sendPhoto").length, 0);
});

test("the command line reads --text - from stdin, and --silent never takes the file after it", async (t) => {
  // a stand-in workspace that only says who the agent is and keeps what
  // it was asked to send
  const asked: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/agent/whoami") return res.end(JSON.stringify({ botId: "ada" }));
      asked.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString() || "{}") });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "bloks-tg-send-")));
  t.after(() => { server.close(); rmSync(home, { recursive: true, force: true }); });
  const env = { ...process.env, HOME: home, BLOKS_DATA_DIR: join(home, ".bloks"), BLOKS_URL: `http://127.0.0.1:${(server.address() as any).port}`, BLOKS_TOKEN: "turn-token" };
  const run = (args: string[], input?: string) => new Promise<{ status: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, [BIN, "telegram", "send", ...args], { env, cwd: home });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stdin.end(input ?? "");
    child.on("close", (status) => resolve({ status, out }));
  });

  const piped = await run(["--text", "-", "--silent"], "First line\n`npm test`\n");
  assert.equal(piped.status, 0, piped.out);
  writeFileSync(join(home, "chart.png"), PNG);
  const file = await run(["--silent", "chart.png"]);
  assert.equal(file.status, 0, file.out);
  assert.deepEqual(asked, [
    { url: "/api/bots/ada/telegram/send", body: { text: "First line\n`npm test`\n", silent: true } },
    { url: "/api/bots/ada/telegram/send", body: { path: join(home, "chart.png"), silent: true } },
  ]);

  const empty = await run(["--text", "-"], "  \n");
  assert.equal(empty.status, 1);
  assert.match(JSON.parse(empty.out).error, /needs the words/);
  assert.equal(asked.length, 2);
});

test("only its own chat: the route is the agent's own, and its Telegram settings stay the person's", () => {
  assert.equal(allows("ada", "POST", "/api/bots/ada/telegram/send").ok, true);
  const other = allows("ada", "POST", "/api/bots/grace/telegram/send");
  assert.equal(other.ok, false);
  assert.equal(other.reason, "an agent can only send files and texts to its own Telegram chat");
  assert.equal(allows("ada", "GET", "/api/bots/ada/telegram/send").ok, false);
  assert.equal(allows("ada", "POST", "/api/bots/ada/telegram").ok, false);
  assert.equal(allows("ada", "GET", "/api/bots/ada/telegram").ok, false);
});

test("a text that stops partway says how much of it went, so it is not sent again whole", async (t) => {
  const previous = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
  };
  t.after(() => { globalThis.fetch = previous; });
  const partly = await trySendText("TEST", 101, "word ".repeat(1800), true);
  assert.equal(partly.messages, 1);
  assert.equal(partly.why, "Telegram answered HTTP 403");
  assert.equal(bodies.length, 2, "it went on after a refusal");
  assert.ok(bodies.every((b) => b.disable_notification === true && b.parse_mode === "HTML"));
});
