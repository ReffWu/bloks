// Where the choice about background work is made, and who may make it
// (server/background-work.ts): the person, for the workspace in Settings,
// Behaviour, and for one agent in its own settings. An agent can read
// both with `bloks settings`, and change neither.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { backgroundWork, resolveBackgroundWork } from "../server/background-work.ts";
import { inspectWorkspaceSettings } from "../server/settings-inspection.ts";
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

test("the agent's choice, then the workspace's, then letting it finish", () => {
  assert.equal(resolveBackgroundWork(undefined, undefined), "finish");
  assert.equal(resolveBackgroundWork(undefined, "stop"), "stop");
  assert.equal(resolveBackgroundWork("finish", "stop"), "finish");
  assert.equal(resolveBackgroundWork("later", "sometimes"), "finish");
  assert.equal(backgroundWork("stop"), "stop");
  assert.equal(backgroundWork("kill"), undefined);
});

test("settings inspection says what applies and where it is set", () => {
  const read = (saved: unknown) =>
    inspectWorkspaceSettings({ saved, runtime: saved, resolved: { beforeTurn: 200000, beforeTurnAt: 0.6, stallMinutes: 15 }, redact: (s) => s })
      .find((row) => row.id === "turns.backgroundWork");
  assert.deepEqual(read({})?.effective, { status: "value", value: "finish" });
  assert.deepEqual(read({})?.saved, { status: "absent" });
  assert.equal(read({})?.control, "Settings > Behaviour");
  assert.deepEqual(read({ turns: { backgroundWork: "stop" } })?.effective, { status: "value", value: "stop" });
  assert.deepEqual(read({ turns: { backgroundWork: "never" } })?.effective, { status: "value", value: "finish" });
});

test("the person sets it for the workspace and for one agent; an agent reads it and cannot change it", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-background-settings-"));
  const token = join(home, "token");
  const release = join(home, "release");
  const cli = join(home, "fake-claude.mjs");
  writeFileSync(
    cli,
    `#!${process.execPath}
import { existsSync, writeFileSync } from "node:fs";
const [first] = process.argv.slice(2);
if (first === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (first === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
process.stdin.resume();
process.stdin.once("data", async () => {
  writeFileSync(${JSON.stringify(token)}, process.env.BLOKS_TOKEN ?? "");
  for (let i = 0; i < 1200 && !existsSync(${JSON.stringify(release)}); i++) await new Promise((r) => setTimeout(r, 50));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, result: "Done." }));
});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli } } } }));
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    writeFileSync(release, "");
    await h.stop();
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });

  // the workspace's, from Settings, Behaviour
  assert.equal((await h.json("/api/config")).turns.backgroundWork, "finish", "letting it finish is not the default");
  const put = (body: unknown) => h.fetch("/api/config", { method: "PUT", body: JSON.stringify(body) });
  assert.equal((await put({ turns: { backgroundWork: "sometimes" } })).status, 400);
  assert.equal((await put({ turns: { backgroundWork: "stop" } })).status, 200);
  assert.equal((await h.json("/api/config")).turns.backgroundWork, "stop");
  assert.equal((await h.json("/api/config")).turns.stallMinutes, 15, "saving one turn setting lost the other");
  assert.equal(JSON.parse(readFileSync(join(home, ".bloks", "config.json"), "utf8")).turns.backgroundWork, "stop");

  // one agent's own, from its settings
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Runner" }) });
  const patch = (body: unknown) => h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(body) });
  assert.equal((await patch({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).status, 200);
  assert.equal((await patch({ backgroundWork: "later" })).status, 400);
  assert.equal((await patch({ backgroundWork: "finish" })).status, 200);
  const mine = async () => (await h.json("/api/bots?messages=0")).bots.find((b: any) => b.id === bot.id);
  assert.equal((await mine()).backgroundWork, "finish");

  // an agent, with the credential its turn carries
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "hold on" }) });
  const credential = await waitFor(() => (existsSync(token) ? readFileSync(token, "utf8") : null));
  assert.match(credential ?? "", /^blk_/, "the stand-in engine never got a credential");
  const as = (path: string, init: RequestInit = {}) =>
    fetch(`${h.url}${path}`, { ...init, headers: { authorization: `Bearer ${credential}`, origin: h.url, "content-type": "application/json" } });
  const own = await as(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ backgroundWork: "stop" }) });
  assert.equal(own.status, 403, "an agent changed what happens to its own background work");
  const workspace = await as("/api/config", { method: "PUT", body: JSON.stringify({ turns: { backgroundWork: "finish" } }) });
  assert.ok(workspace.status === 401 || workspace.status === 403, `an agent reached the workspace's setting: ${workspace.status}`);
  assert.equal((await mine()).backgroundWork, "finish");
  assert.equal((await h.json("/api/config")).turns.backgroundWork, "stop");

  // and reads both, as `bloks settings` shows them
  const bloks = (...args: string[]) =>
    new Promise<any>((resolve, reject) => {
      execFile(process.execPath, [BLOKS, ...args], { env: { ...process.env, BLOKS_URL: h.url, BLOKS_TOKEN: credential! } }, (error, stdout, stderr) =>
        error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout)),
      );
    });
  const fields = (page: any) => (page.rows as any[]).flatMap((row) => row.observation?.fields ?? []);
  const general = fields(await bloks("settings", "--category", "workspace.general")).find((f: any) => f.id === "turns.backgroundWork");
  assert.deepEqual(general?.effective, { status: "value", value: "stop" });
  assert.equal(general?.control, "Settings > Behaviour");
  const agents = fields(await bloks("settings", "--category", "agent"));
  assert.ok(agents.some((f: any) => f.id === "backgroundWork" && f.effective?.value === "finish"), "the agent's own choice was not readable");

  // back to the workspace's, which only the person can do
  assert.equal((await patch({ backgroundWork: null })).status, 200);
  assert.equal((await mine()).backgroundWork, undefined);
});
