// An engine switched off starts no turns (GitHub 324).
//
// An instance can be kept in the config and switched off. Other agents
// already read it as unavailable (`bloks agents`, and the warning `bloks
// say` adds), but a message to an agent on it still started a turn there
// and came back with an answer, so what the roster said and what
// happened did not agree. Now a switched-off engine is passed over the
// way a missing one is: an agent with a backup answers on that, and a
// message to one without is turned away with the reason, with nothing run
// on the engine that is off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startHarness } from "./helpers/server.ts";

const BLOKS = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));

const waitFor = async <T,>(check: () => Promise<T | null | undefined> | T | null | undefined, ms = 20_000): Promise<T | null> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

/** A stand-in Claude Code that writes down every turn it is given, and
 * whose answer names it. Told HOLD, it leaves its turn's credential in
 * `token` and keeps the turn open until `release` exists. */
const fakeClaude = (name: string, turns: string, token: string, release: string) => `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const [first] = process.argv.slice(2);
if (first === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (first === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
let input = "";
process.stdin.resume();
((go) => { let line = ""; const take = (c) => { line += c; while (line.includes(String.fromCharCode(10))) { const at = line.indexOf(String.fromCharCode(10)); const next = line.slice(0, at); line = line.slice(at + 1); if (!next.trim() || JSON.parse(next).type !== "user") continue; input = next; process.stdin.off("data", take); go(); return; } }; process.stdin.on("data", take); })(async () => {
  appendFileSync(${JSON.stringify(turns)}, JSON.parse(input).message.content.slice(-60).replace(/\\n/g, " ") + "\\n");
  if (input.includes("HOLD")) {
    writeFileSync(${JSON.stringify(token)}, process.env.BLOKS_TOKEN ?? "");
    for (let i = 0; i < 1200 && !existsSync(${JSON.stringify(release)}); i++) await new Promise((r) => setTimeout(r, 50));
  }
  const text = "Answered on ${name}.";
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, result: text }));
});
`;

test("an engine switched off starts no turn, whoever the message is from, and an agent with a backup answers on that", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-engine-off-"));
  const token = join(home, "token");
  const release = join(home, "release");
  const onTurns = join(home, "on-turns.log");
  const offTurns = join(home, "off-turns.log");
  writeFileSync(join(home, "claude-on.mjs"), fakeClaude("the engine that is on", onTurns, token, release), { mode: 0o755 });
  writeFileSync(join(home, "claude-off.mjs"), fakeClaude("the engine that is off", offTurns, token, release), { mode: 0o755 });
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", config: { cli: join(home, "claude-on.mjs") } },
        "claude-off": { driver: "claudeAgent", enabled: false, config: { cli: join(home, "claude-off.mjs") } },
      },
    }),
  );
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    writeFileSync(release, "");
    await h.stop();
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const ran = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);

  const hire = async (name: string, instanceId: string, backup?: string) => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name }) });
    const set = await h.fetch(`/api/bots/${bot.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        modelSelection: { instanceId, model: "claude-sonnet-5" },
        ...(backup ? { backupSelection: { instanceId: backup, model: "claude-sonnet-5" } } : {}),
      }),
    });
    assert.equal(set.status, 200, `${name}: ${await set.text()}`);
    return bot.id as string;
  };
  const holder = await hire("Holder", "claude");
  const off = await hire("Dormant", "claude-off");
  const covered = await hire("Covered", "claude-off", "claude");
  const settled = (botId: string, done: (messages: any[]) => boolean) =>
    waitFor(async () => {
      const me = (await h.json("/api/bots")).bots.find((b: any) => b.id === botId);
      return !me.busy && done(me.messages) ? me.messages : null;
    });

  // an agent with a turn, and so a credential, to ask and send as
  await h.fetch(`/api/bots/${holder}/messages`, { method: "POST", body: JSON.stringify({ text: "HOLD" }) });
  const credential = await waitFor(() => (existsSync(token) ? readFileSync(token, "utf8") : null));
  assert.match(credential ?? "", /^blk_/, "the stand-in engine never got a credential");
  const bloks = (...args: string[]) =>
    new Promise<any>((resolve) => {
      execFile(process.execPath, [BLOKS, ...args], { env: { ...process.env, BLOKS_URL: h.url, BLOKS_TOKEN: credential! } }, (_e, stdout) =>
        resolve(JSON.parse(stdout || "{}")),
      );
    });

  // What the roster says ...
  const roster = new Map(((await bloks("agents")) as any[]).map((a) => [a.id, a.engine]));
  assert.equal(roster.get(off), "unavailable");
  assert.equal(roster.get(covered), "ready", "its backup answers for it");

  // ... is what happens: another agent's message is turned away, saying
  // why, and nothing runs on it
  const sent = await bloks("say", off, "status check");
  assert.match(sent.error ?? "", /Claude is switched off in Settings, so it starts no turns/, JSON.stringify(sent));
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(ran(offTurns), [], "a turn ran on the engine that is switched off");

  // and the person's own, the way one to an engine that is not there is
  const own = await h.fetch(`/api/bots/${off}/messages`, { method: "POST", body: JSON.stringify({ text: "Are you there?" }) });
  assert.equal(own.status, 409);
  assert.match((await own.json()).error, /Claude is switched off in Settings/);

  // An agent with a backup answers there, as the roster said it would.
  await bloks("say", covered, "a quick question");
  assert.ok(await settled(covered, (m) => m.some((x: any) => x.text === "Answered on the engine that is on.")), "the backup never answered");

  writeFileSync(release, "");
  await settled(holder, () => true);
  assert.deepEqual(ran(offTurns), [], "a turn ran on the engine that is switched off");
  assert.equal(ran(onTurns).length, 2, "the holder's turn and the covered agent's");
  const messages = (await h.json(`/api/bots/${off}/messages?limit=100`)).messages as any[];
  assert.ok(!messages.some((m) => m.text === "Answered on the engine that is off."));
});
