// Saved secrets, by name, with Forget, from any of the person's own devices
// (GitHub 327). The secure card saves a key an agent asked for into
// config.json, and the only list of them, with the only Forget, was the
// security checkup, which opens on this computer alone. A workspace on a
// server elsewhere, reached by this app through the relay, had no way to
// drop one short of editing config.json by hand. Names only, never a
// value; never an agent's turn, never a member's device.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startRemoteProxy } from "../electron/remote.mjs";
import { allows } from "../server/agent-cli.ts";
import { startHarness, type Harness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

const onDisk = (home: string) => Object.keys(JSON.parse(readFileSync(join(home, ".bloks", "config.json"), "utf8")).secrets ?? {}).sort();

test("the person lists and forgets saved secrets here and from a paired device; an agent's turn cannot", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-saved-secrets-"));
  const runs = join(home, "runs.jsonl");
  const cli = join(home, "fake-claude.mjs");
  writeFileSync(runs, "");
  // a turn told ASK tries the list and a Forget with its own credential
  writeFileSync(
    cli,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const out = (f) => console.log(JSON.stringify(f));
let input = "";
process.stdin.on("data", async function take(c) {
  input += c;
  const frame = input.split("\\n").slice(0, -1).filter(Boolean).map(JSON.parse).find((f) => f.type === "user");
  if (!frame) return;
  process.stdin.off("data", take);
  const said = typeof frame.message.content === "string" ? frame.message.content : JSON.stringify(frame.message.content);
  const asked = {};
  if (said.includes("ASK")) {
    const auth = { authorization: "Bearer " + process.env.BLOKS_TOKEN };
    const list = await fetch(process.env.BLOKS_URL + "/api/secrets", { headers: auth });
    asked.list = list.status;
    asked.body = await list.text();
    asked.forget = (await fetch(process.env.BLOKS_URL + "/api/secrets/SPARE_KEY", { method: "DELETE", headers: auth })).status;
  }
  appendFileSync(${JSON.stringify(runs)}, JSON.stringify(asked) + "\\n");
  out({ type: "system", subtype: "init", session_id: "s", model: "claude-sonnet-5" });
  out({ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, session_id: "s", result: "Done", total_cost_usd: 0 });
});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"));
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli } } },
      secrets: { GITHUB_TOKEN: "ghp-the-value-itself", SPARE_KEY: "spare-value", ONE_TIME: "once-value" },
    }),
  );
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });

  // ── on this computer ──
  const here = await h.fetch("/api/secrets");
  assert.equal(here.status, 200);
  const listed = await here.text();
  assert.deepEqual(JSON.parse(listed), { secrets: ["GITHUB_TOKEN", "ONE_TIME", "SPARE_KEY"] });
  assert.doesNotMatch(listed, /ghp-the-value-itself|spare-value|once-value/);
  const forgot = await h.fetch("/api/secrets/ONE_TIME", { method: "DELETE" });
  assert.equal(forgot.status, 200);
  assert.deepEqual(await forgot.json(), { secrets: ["GITHUB_TOKEN", "SPARE_KEY"] });
  assert.deepEqual(onDisk(home), ["GITHUB_TOKEN", "SPARE_KEY"]);
  assert.equal((await h.fetch("/api/secrets/ONE_TIME", { method: "DELETE" })).status, 404);
  assert.equal((await h.fetch("/api/secrets/..%2Fconfig", { method: "DELETE" })).status, 404);
  // the checkup, here, agrees
  const checkup = await h.json("/api/security");
  assert.deepEqual(checkup.findings.find((f: any) => f.id === "secrets").items.map((i: any) => i.name), ["GITHUB_TOKEN", "SPARE_KEY"]);

  // ── from a device the person paired, which the checkup turns away ──
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Test iPhone" }) });
  const token = paired.body?.token;
  assert.ok(token, "the fixture phone did not pair");
  assert.equal((await h.fetchRemote("/api/security", { token })).status, 403, "the checkup stays on this computer");
  const phoneList = await h.fetchRemote("/api/secrets", { token });
  assert.equal(phoneList.status, 200);
  assert.deepEqual(phoneList.body, { secrets: ["GITHUB_TOKEN", "SPARE_KEY"] });
  const phoneForget = await h.fetchRemote("/api/secrets/GITHUB_TOKEN", { method: "DELETE", token });
  assert.equal(phoneForget.status, 200);
  assert.deepEqual(phoneForget.body, { secrets: ["SPARE_KEY"] });
  assert.deepEqual(onDisk(home), ["SPARE_KEY"]);
  // and nobody who has not paired
  assert.equal((await h.fetchRemote("/api/secrets")).status, 401);
  assert.equal((await h.fetchRemote("/api/secrets/SPARE_KEY", { method: "DELETE", token: "not-a-device" })).status, 401);

  // ── an agent, by the rules and in a real turn ──
  assert.equal(allows("ada", "GET", "/api/secrets").ok, false);
  assert.equal(allows("ada", "DELETE", "/api/secrets/SPARE_KEY").ok, false);
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ada" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "ASK which keys there are" }) });
  const asked = await waitFor(() =>
    readFileSync(runs, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((run) => run.list !== undefined),
  );
  assert.ok(asked, h.logs());
  assert.equal(asked.list, 403);
  assert.equal(asked.forget, 403);
  assert.doesNotMatch(asked.body, /SPARE_KEY/);
  assert.deepEqual(onDisk(home), ["SPARE_KEY"], "an agent forgot a secret");
});

test("this app run against a workspace elsewhere, through the relay, lists and forgets them; a member's device cannot", { timeout: 60_000 }, async (t) => {
  // A relay that forwards sealed payloads and nothing else, the way the
  // real one does. The app's own remote proxy seals each request with the
  // paired device's key, so this is the path the Mac app takes to a
  // server on another computer.
  const files = mkdtempSync(join(tmpdir(), "bloks-saved-secrets-relay-"));
  writeFileSync(join(files, "index.html"), "<!doctype html><title>Fixture</title>");
  const pending = new Map<string, ServerResponse>();
  let upstream: ServerResponse | null = null;
  let connected!: () => void;
  const connection = new Promise<void>((resolve) => (connected = resolve));
  const relay = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    if (path === "/space/agent/stream") {
      upstream = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"kind":"hello","spaceId":"fixture-space"}\n\n');
      connected();
      return;
    }
    if (path === "/space/client/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"kind":"hello","online":true}\n\n');
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (path === "/space/client/ask") {
      if (!upstream) return void res.writeHead(503).end("{}");
      const id = randomUUID();
      pending.set(id, res);
      upstream.write(`data: ${JSON.stringify({ kind: "ask", id, payload: body.payload })}\n\n`);
      return;
    }
    if (path === "/space/agent/result") {
      const answer = pending.get(body.id);
      pending.delete(body.id);
      answer?.writeHead(200, { "content-type": "application/json" });
      answer?.end(JSON.stringify({ payload: body.payload }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  relay.listen(0, "127.0.0.1");
  await once(relay, "listening");
  const relayUrl = `http://127.0.0.1:${(relay.address() as { port: number }).port}`;
  let h: Harness | undefined;
  const proxies: Awaited<ReturnType<typeof startRemoteProxy>>[] = [];
  t.after(async () => {
    proxies.forEach((proxy) => proxy.stop());
    await h?.stop();
    relay.closeAllConnections();
    await new Promise<void>((resolve) => relay.close(() => resolve()));
    rmSync(files, { recursive: true, force: true });
  });
  // The fixture seeds an owner's device and a member's, the relay, and one
  // saved secret, and answers only on loopback, as bloks-server does.
  h = await startHarness({
    NODE_OPTIONS: `--import=${new URL("./helpers/settings-app-preload.mjs", import.meta.url).href}`,
    BLOKS_SETTINGS_TEST_TRACE: join(files, "trace.json"),
    BLOKS_SETTINGS_TEST_RELAY: relayUrl,
    BLOKS_LOOPBACK_ONLY: "1",
  });
  await connection;
  const app = await startRemoteProxy(
    { relayUrl, relayToken: "fixture-relay-client", deviceId: "owner-device", deviceToken: "fixture-owner" },
    { staticDir: files, client: "macOS 3.0" },
  );
  const member = await startRemoteProxy(
    { relayUrl, relayToken: "fixture-relay-member", deviceId: "member-device", deviceToken: "fixture-member" },
    { staticDir: files },
  );
  proxies.push(app, member);
  const at = (proxy: { port: number }, path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${proxy.port}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });

  // the checkup still opens only where Bloks runs
  assert.equal((await at(app, "/api/security")).status, 403);
  const listed = await at(app, "/api/secrets");
  assert.equal(listed.status, 200);
  const text = await listed.text();
  assert.deepEqual(JSON.parse(text), { secrets: ["FIXTURE_CREDENTIAL"] });
  assert.doesNotMatch(text, /fixture-protected-value/);
  // a member of the workspace is somebody else
  const theirs = await at(member, "/api/secrets");
  assert.notEqual(theirs.status, 200);
  assert.doesNotMatch(await theirs.text(), /FIXTURE_CREDENTIAL/);
  assert.notEqual((await at(member, "/api/secrets/FIXTURE_CREDENTIAL", { method: "DELETE" })).status, 200);
  assert.deepEqual(onDisk(h.home), ["FIXTURE_CREDENTIAL"]);

  const forgot = await at(app, "/api/secrets/FIXTURE_CREDENTIAL", { method: "DELETE" });
  assert.equal(forgot.status, 200);
  assert.deepEqual(await forgot.json(), { secrets: [] });
  assert.deepEqual(onDisk(h.home), []);
  assert.deepEqual(await (await at(app, "/api/secrets")).json(), { secrets: [] });
});
