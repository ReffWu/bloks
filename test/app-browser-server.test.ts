// The Bloks browser through a real server with no desktop app behind it,
// the way bloks-server runs: an agent's turn reaches its route with its
// own credential, is told plainly the browser is not here, and is never
// charged its turn's changes for trying; the person's settings save and
// stay saved; nothing an agent holds reaches the person's routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness } from "./helpers/server.ts";

const waitFor = async <T,>(check: () => Promise<T | null | undefined> | T | null | undefined, ms = 30_000): Promise<T | null> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

test("without the desktop app, the Bloks browser is unavailable to agents and its settings are the person's", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-app-browser-"));
  const answers = join(home, "answers.json");
  const cli = join(home, "fake-claude.mjs");
  // Told CALLS <base64 json>, makes each request with its turn credential
  // and writes down what came back.
  writeFileSync(
    cli,
    `#!${process.execPath}
import { renameSync, writeFileSync } from "node:fs";
const [first] = process.argv.slice(2);
if (first === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (first === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
let input = "";
((go) => { let line = ""; const take = (c) => { line += c; while (line.includes(String.fromCharCode(10))) { const at = line.indexOf(String.fromCharCode(10)); const next = line.slice(0, at); line = line.slice(at + 1); if (!next.trim() || JSON.parse(next).type !== "user") continue; input = next; process.stdin.off("data", take); go(); return; } }; process.stdin.on("data", take); })(async () => {
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "s-" + Math.random().toString(36).slice(2), model: "claude-sonnet-5" }));
  const asked = input.match(/CALLS ([A-Za-z0-9+\\/=]+)/);
  if (asked) {
    const out = [];
    for (const [method, path, body] of JSON.parse(Buffer.from(asked[1], "base64").toString("utf8"))) {
      const res = await fetch(process.env.BLOKS_URL + path, {
        method,
        headers: { authorization: "Bearer " + process.env.BLOKS_TOKEN, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      out.push({ status: res.status, body: await res.json().catch(() => null) });
    }
    writeFileSync(${JSON.stringify(answers)} + ".tmp", JSON.stringify(out)); renameSync(${JSON.stringify(answers)} + ".tmp", ${JSON.stringify(answers)});
  }
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 100, result: "Done." }));
});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli } } } }));
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });

  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ivy" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });

  // The agent: its status, then fourteen tries at a page, more than a
  // turn's twelve changes, then the person's routes.
  const open = ["POST", "/api/agent/browser", { action: "open", url: "https://example.com" }];
  const calls = [
    ["GET", "/api/agent/browser"],
    ...Array.from({ length: 14 }, () => open),
    ["POST", "/api/agent/browser", { action: "eval", script: "alert(1)" }],
    ["GET", "/api/browser/settings"],
    ["PUT", "/api/browser/settings", { mode: "auto" }],
    ["POST", "/api/browser/command", { action: "read" }],
  ];
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: `CALLS ${Buffer.from(JSON.stringify(calls)).toString("base64")}` }) });
  assert.ok(await waitFor(() => existsSync(answers)), "the turn never ran");
  const out = JSON.parse(readFileSync(answers, "utf8")) as Array<{ status: number; body: any }>;

  assert.equal(out[0].status, 200);
  assert.equal(out[0].body.available, false);
  assert.match(out[0].body.note, /part of the Bloks desktop app/);
  for (const tried of out.slice(1, 15)) {
    assert.equal(tried.status, 503, JSON.stringify(tried.body));
    assert.match(tried.body.error, /part of the Bloks desktop app, and the app is not running this workspace/);
  }
  assert.equal(out[15].status, 400, "a command that is not one is refused before anything");
  assert.match(out[15].body.error, /the browser does open, read/);
  for (const theirs of out.slice(16)) {
    assert.equal(theirs.status, 403, JSON.stringify(theirs.body));
    assert.match(theirs.body.error, /\/api\/browser is not something an agent can reach/);
  }

  // The person: what the browser is doing, and its rules, saved to disk.
  assert.deepEqual(await h.json("/api/browser"), { available: false, state: null });
  assert.deepEqual(await h.json("/api/browser/frame"), { live: false });
  const before = await h.json("/api/browser/settings");
  assert.deepEqual(before.settings, { mode: "ask", allow: [], deny: [] });
  assert.equal(before.available, false);
  assert.match(before.downloads, /browser-downloads$/);
  const put = await h.fetch("/api/browser/settings", { method: "PUT", body: JSON.stringify({ allow: ["https://www.Docs.example/x"], deny: ["bank.example"] }) });
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).settings, { mode: "ask", allow: ["docs.example"], deny: ["bank.example"] });
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".bloks", "app-browser.json"), "utf8")), { mode: "ask", allow: ["docs.example"], deny: ["bank.example"] });
  const bad = await h.fetch("/api/browser/settings", { method: "PUT", body: JSON.stringify({ deny: ["not a site"] }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /is not a site/);

  // another app on this computer, over MCP, hears the same
  const command = await h.fetch("/api/browser/command", { method: "POST", body: JSON.stringify({ action: "open", url: "https://docs.example" }) });
  assert.equal(command.status, 503);
  // and a browser card nobody raised is not something an answer reaches
  const respond = await h.json(`/api/bots/${bot.id}/respond`, { method: "POST", body: JSON.stringify({ requestId: "browser:nothing", behavior: "allow" }) });
  assert.deepEqual(respond, { ok: false, outcome: "unavailable" });
  // a website cannot reach any of it
  const cross = await h.fetchAs("https://evil.example", "/api/browser/settings", { method: "PUT", body: JSON.stringify({ mode: "auto" }) });
  assert.equal(cross.status, 403);
  assert.equal((await h.json("/api/browser/settings")).settings.mode, "ask");
});
