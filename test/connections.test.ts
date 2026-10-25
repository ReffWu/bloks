// Connections an agent uses without holding the credential (GitHub 386),
// in pieces: what each host lets through, what a turn's environment gets,
// and the proxy itself against a stand-in for GitHub, served in this
// process so every byte that reached "GitHub" can be looked at.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  AuditLog,
  ConnectionHandles,
  SERVICES,
  checkGitHubToken,
  cleanToken,
  connectionEnv,
  connectionHint,
  isConnectionEnvName,
  proxyConnection,
  publicConnection,
  scrub,
  type ConnectionRecord,
  type ProxyContext,
} from "../server/connections.ts";
import { shellConfig } from "../server/drivers/codex.ts";

const TOKEN = `ghp_${"T0kenValue".repeat(4)}`;
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");

const api = SERVICES.github.hosts["api.github.com"];
const git = SERVICES.github.hosts["github.com"];
const q = (s = "") => new URLSearchParams(s);

test("the API host: read is GET and HEAD, write adds the rest, and some calls are never sent", () => {
  assert.equal(api.refuse("GET", "/repos/o/r", q(), "read"), null);
  assert.equal(api.refuse("HEAD", "/repos/o/r", q(), "read"), null);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.match(api.refuse(method, "/repos/o/r/pulls", q(), "read") ?? "", /read only/, `${method} on read`);
    assert.equal(api.refuse(method, "/repos/o/r/pulls", q(), "write"), null, `${method} on write`);
  }
  assert.ok(api.refuse("OPTIONS", "/", q(), "write"));
  assert.ok(api.refuse("TRACE", "/", q(), "write"));
  // lasting access for someone or something else, whatever the grant
  for (const [method, path] of [
    ["POST", "/user/keys"],
    ["POST", "/user/gpg_keys"],
    ["POST", "/User/SSH_signing_keys"],
    ["POST", "/repos/o/r/keys"],
    ["PUT", "/repos/o/r/collaborators/stranger"],
    ["POST", "/orgs/acme/invitations"],
    ["PUT", "/orgs/acme/memberships/stranger"],
    ["PUT", "/orgs/acme/teams/core/memberships/stranger"],
    ["POST", "/repos/o/r/hooks"],
    ["PATCH", "/orgs/acme/hooks/7/config"],
  ]) {
    assert.match(api.refuse(method, path, q(), "write") ?? "", /never sent/, `${method} ${path}`);
  }
  // and reading them is reading
  assert.equal(api.refuse("GET", "/user/keys", q(), "read"), null);
});

test("github.com: git's own requests only, and push only with write", () => {
  const upload = q("service=git-upload-pack");
  const receive = q("service=git-receive-pack");
  assert.equal(git.refuse("GET", "/o/r.git/info/refs", upload, "read"), null);
  assert.equal(git.refuse("POST", "/o/r.git/git-upload-pack", q(), "read"), null);
  assert.equal(git.refuse("GET", "/o/r/info/refs", upload, "read"), null, "without .git, as GitHub also answers");
  assert.match(git.refuse("GET", "/o/r.git/info/refs", receive, "read") ?? "", /read only/);
  assert.match(git.refuse("POST", "/o/r.git/git-receive-pack", q(), "read") ?? "", /read only/);
  assert.equal(git.refuse("GET", "/o/r.git/info/refs", receive, "write"), null);
  assert.equal(git.refuse("POST", "/o/r.git/git-receive-pack", q(), "write"), null);
  // anything else on github.com: pages, LFS (which hands out tokens of
  // its own), the dumb protocol, the wrong verb
  for (const [method, path, search] of [
    ["GET", "/settings/tokens", q()],
    ["GET", "/o/r", q()],
    ["POST", "/o/r.git/info/lfs/objects/batch", q()],
    ["GET", "/o/r.git/info/refs", q()],
    ["POST", "/o/r.git/info/refs", upload],
    ["GET", "/o/r.git/git-upload-pack", q()],
    ["GET", "/o/r.git/objects/info/packs", q()],
  ] as const) {
    assert.ok(git.refuse(method, path, search, "write"), `${method} ${path}${search}`);
  }
  assert.equal(git.describe("GET", "/o/r.git/info/refs", receive), "push o/r");
  assert.equal(git.describe("POST", "/o/r.git/git-upload-pack", q()), "fetch o/r");
});

test("the credential goes on as each host takes it", () => {
  assert.deepEqual(api.inject(TOKEN), { authorization: `Bearer ${TOKEN}` });
  assert.deepEqual(git.inject(TOKEN), { authorization: `Basic ${BASIC}` });
});

test("a token is letters, digits and underscores, and nothing that ends a header", () => {
  assert.equal(cleanToken(` ${TOKEN}\n`), TOKEN);
  assert.equal(cleanToken(`github_pat_${"A1b2".repeat(10)}`), `github_pat_${"A1b2".repeat(10)}`);
  assert.equal(cleanToken(`${TOKEN}\r\nX-Evil: 1`), null);
  assert.equal(cleanToken("short"), null);
  assert.equal(cleanToken(42), null);
});

test("a turn's environment points git and the API at the address, and never holds the value", () => {
  const base = "http://127.0.0.1:4100/connect/bkc_abcdefghijklmnopqrstuvwx";
  const env = connectionEnv("github", base, {});
  assert.equal(env.BLOKS_GITHUB_API, `${base}/api.github.com`);
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(env.GIT_CONFIG_KEY_0, `url.${base}/github.com/.insteadOf`);
  assert.equal(env.GIT_CONFIG_VALUE_0, "https://github.com/");
  assert.equal(env.GIT_CONFIG_KEY_1, `credential.${base}/.helper`);
  assert.equal(env.GIT_CONFIG_VALUE_1, "");
  // carries on from config the person's environment already had
  const after = connectionEnv("github", base, { GIT_CONFIG_COUNT: "3" });
  assert.equal(after.GIT_CONFIG_COUNT, "5");
  assert.ok(after.GIT_CONFIG_KEY_3 && after.GIT_CONFIG_KEY_4 && !after.GIT_CONFIG_KEY_0);
  for (const name of Object.keys(env)) assert.ok(isConnectionEnvName(name), name);
  assert.ok(!isConnectionEnvName("GITHUB_TOKEN") && !isConnectionEnvName("GIT_SSH_COMMAND"));
  // Codex hands these to its shell too, as `set` entries
  const codex = shellConfig({ BLOKS_TOKEN: "blk_x", ...env });
  assert.equal(codex?.["shell_environment_policy.set.BLOKS_GITHUB_API"], env.BLOKS_GITHUB_API);
  assert.equal(codex?.["shell_environment_policy.set.GIT_CONFIG_KEY_0"], env.GIT_CONFIG_KEY_0);
  const hint = connectionHint("github", "read", "octo");
  assert.match(hint, /@octo/);
  assert.match(hint, /read only/);
  assert.doesNotMatch(hint, /pulls/, "a read-only agent is not shown how to open a pull request");
  assert.match(connectionHint("github", "write"), /\/pulls/);
});

test("what anyone but config.json is shown has no token, and grants only for agents that exist", () => {
  const record: ConnectionRecord = { id: "conn_1", service: "github", token: TOKEN, account: "octo", addedAt: 1, grants: { ada: "write", gone: "read" } };
  const shown = publicConnection(record, (id) => id === "ada");
  assert.doesNotMatch(JSON.stringify(shown), new RegExp(TOKEN));
  assert.deepEqual(shown.grants, { ada: "write" });
});

test("scrub takes out the token and its git form", () => {
  assert.equal(scrub(`a ${TOKEN} b Basic ${BASIC}`, TOKEN), "a [redacted] b Basic [redacted]");
});

test("asking GitHub who a token is never says the token back", async () => {
  const seen: Array<string | undefined> = [];
  const fake = (async (_url: string, init: RequestInit) => {
    seen.push((init.headers as Record<string, string>).authorization);
    return new Response(JSON.stringify({ message: `Bad credentials ${TOKEN}` }), { status: 401 });
  }) as typeof fetch;
  const result = await checkGitHubToken(TOKEN, "https://api.github.com", fake);
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
  assert.deepEqual(seen, [`Bearer ${TOKEN}`]);
  const ok = await checkGitHubToken(TOKEN, "https://api.github.com", (async () =>
    new Response(JSON.stringify({ login: "octo" }), { status: 200, headers: { "x-oauth-scopes": "repo" } })) as typeof fetch);
  assert.deepEqual(ok, { ok: true, account: "octo", scopes: "repo" });
});

// ── the proxy, end to end in this process ──

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

async function setup(t: { after: (fn: () => unknown) => void }) {
  const seen: Seen[] = [];
  const github = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (req.url === "/echo") {
        // a service that says the credential back, which GitHub does not,
        // and which must not reach the agent if one ever did
        res.writeHead(200, { "content-type": "application/json", "x-echo": String(req.headers.authorization) });
        return res.end(JSON.stringify({ youSent: req.headers.authorization }));
      }
      if (req.url === "/moved") {
        res.writeHead(301, { location: "https://api.github.com/repos/o/new" });
        return res.end();
      }
      if (req.url === "/elsewhere") {
        res.writeHead(302, { location: "https://objects.example.com/blob?sig=1" });
        return res.end();
      }
      if (req.url === "/denied") {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Basic" });
        return res.end("{}");
      }
      if (req.url?.startsWith("/o/r.git/")) {
        res.writeHead(200, { "content-type": "application/x-git-upload-pack-advertisement", "set-cookie": "_gh_sess=1" });
        return res.end("001e# service=git-upload-pack\n0000");
      }
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "logged_in=yes" });
      res.end(JSON.stringify({ ok: true, path: req.url, body }));
    });
  });
  const upstreamPort = await listen(github);
  const dir = mkdtempSync(join(tmpdir(), "bloks-connections-"));
  const audit = new AuditLog(join(dir, "audit.jsonl"));
  const handles = new ConnectionHandles();
  const records = new Map<string, ConnectionRecord>([
    ["conn_1", { id: "conn_1", service: "github", token: TOKEN, account: "octo", addedAt: 1, grants: { ada: "write", ben: "read" } }],
  ]);
  const live = new Set<string>(["cred-ada", "cred-ben"]);
  const ctx: ProxyContext = {
    handles,
    liveAgent: (entry) => (live.has(entry.credential) ? entry.botId : null),
    connection: (id) => records.get(id),
    agentName: (id) => id.toUpperCase(),
    audit,
    upstream: () => `http://127.0.0.1:${upstreamPort}`,
  };
  const proxy = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    proxyConnection(req, res, url.pathname, url.search, req.headers["x-test-remote"] !== "1", ctx);
  });
  const port = await listen(proxy);
  t.after(() => {
    github.closeAllConnections();
    github.close();
    proxy.closeAllConnections();
    proxy.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const ada = handles.mint({ credential: "cred-ada", botId: "ada", connectionId: "conn_1" });
  const ben = handles.mint({ credential: "cred-ben", botId: "ben", connectionId: "conn_1" });
  const call = (
    handle: string,
    rest: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; headers: IncomingMessage["headers"]; body: string }> =>
    new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, method: init.method ?? "GET", path: `/connect/${handle}/${rest}`, headers: { host: `127.0.0.1:${port}`, ...init.headers } },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on("error", reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  return { seen, audit, records, live, ada, ben, call, port, auditFile: join(dir, "audit.jsonl") };
}

test("a granted request goes to its host with the credential, and the agent's own does not", async (t) => {
  const s = await setup(t);
  const res = await s.call(s.ada, "api.github.com/repos/o/r", {
    headers: { authorization: "Bearer agent-made-this-up", cookie: "a=b", "x-forwarded-for": "1.2.3.4", accept: "application/json" },
  });
  assert.equal(res.status, 200);
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0].url, "/repos/o/r");
  assert.equal(s.seen[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(s.seen[0].headers.cookie, undefined);
  assert.equal(s.seen[0].headers["x-forwarded-for"], undefined);
  assert.equal(s.seen[0].headers.accept, "application/json");
  assert.equal(s.seen[0].headers["accept-encoding"], "identity", "asked for plain, so it can be checked");
  assert.equal(res.headers["set-cookie"], undefined, "no cookie of the service's comes back");

  // a pull request, with its body passed along
  const pr = await s.call(s.ada, "api.github.com/repos/o/r/pulls", { method: "POST", body: JSON.stringify({ title: "Fix", head: "fix", base: "main" }), headers: { "content-type": "application/json" } });
  assert.equal(pr.status, 200);
  assert.equal(JSON.parse(s.seen[1].body).title, "Fix");
});

test("the credential never comes back, even from a service that echoes it", async (t) => {
  const s = await setup(t);
  const res = await s.call(s.ada, "api.github.com/echo");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.body, new RegExp(TOKEN));
  assert.doesNotMatch(String(res.headers["x-echo"]), new RegExp(TOKEN));
  assert.match(res.body, /\[redacted\]/);
});

test("another host, a refused method, a read-only push and a never call reach nobody", async (t) => {
  const s = await setup(t);
  const refused = [
    await s.call(s.ada, "evil.example.com/steal"),
    await s.call(s.ada, "uploads.github.com/x"),
    await s.call(s.ada, "api.github.com/user/keys", { method: "POST", body: "{}" }),
    await s.call(s.ben, "api.github.com/repos/o/r/pulls", { method: "POST", body: "{}" }),
    await s.call(s.ben, "github.com/o/r.git/info/refs?service=git-receive-pack"),
    await s.call(s.ben, "github.com/o/r.git/git-receive-pack", { method: "POST", body: "0000" }),
    await s.call(s.ada, "github.com/settings/tokens"),
  ];
  for (const res of refused) {
    assert.equal(res.status, 403, res.body);
    assert.doesNotMatch(res.body, new RegExp(TOKEN));
  }
  assert.equal(s.seen.length, 0, "nothing reached any host");
  // and the read-only agent may still clone
  assert.equal((await s.call(s.ben, "github.com/o/r.git/info/refs?service=git-upload-pack")).status, 200);
  assert.equal(s.seen[0].headers.authorization, `Basic ${BASIC}`);
});

test("a dot segment cannot step out of the host it names", async (t) => {
  const s = await setup(t);
  // the server hands the proxy a normalised path, as WHATWG URL makes it
  const path = new URL(`http://x/connect/${s.ada}/api.github.com/../evil.example.com/x`).pathname;
  assert.equal(path, `/connect/${s.ada}/evil.example.com/x`);
  assert.equal((await s.call(s.ada, "api.github.com/../evil.example.com/x")).status, 403);
  assert.equal(s.seen.length, 0);
});

test("an ended turn, a revoked grant, a removed connection or another computer is refused", async (t) => {
  const s = await setup(t);
  assert.equal((await s.call(s.ada, "api.github.com/user", { headers: { "x-test-remote": "1" } })).status, 403, "not from this computer");
  assert.equal((await s.call("bkc_notonethatwasevermintedhere", "api.github.com/user")).status, 403);
  s.records.get("conn_1")!.grants = { ben: "read" };
  assert.equal((await s.call(s.ada, "api.github.com/user")).status, 403, "grant taken back mid turn");
  s.live.delete("cred-ben");
  assert.equal((await s.call(s.ben, "api.github.com/user")).status, 403, "turn over");
  s.live.add("cred-ben");
  assert.equal((await s.call(s.ben, "api.github.com/user")).status, 403, "and a handle once refused for its turn stays gone");
  assert.equal(s.seen.length, 0);
});

test("a redirect to the service's own host comes back through the proxy; elsewhere goes as it is", async (t) => {
  const s = await setup(t);
  const moved = await s.call(s.ada, "api.github.com/moved");
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.location, `http://127.0.0.1:${s.port}/connect/${s.ada}/api.github.com/repos/o/new`);
  const away = await s.call(s.ada, "api.github.com/elsewhere");
  assert.equal(away.headers.location, "https://objects.example.com/blob?sig=1");
});

test("a credential the service refuses is said in words, never as a 401 git would answer", async (t) => {
  const s = await setup(t);
  const res = await s.call(s.ada, "api.github.com/denied");
  assert.equal(res.status, 502);
  assert.equal(res.headers["www-authenticate"], undefined);
  assert.match(JSON.parse(res.body).error, /did not accept/);
});

test("every use is one audit line, sent or refused, and none holds the credential", async (t) => {
  const s = await setup(t);
  await s.call(s.ada, "api.github.com/repos/o/r?secret=query");
  await s.call(s.ben, "github.com/o/r.git/git-receive-pack", { method: "POST", body: "0000" });
  await s.call(s.ada, "evil.example.com/x");
  const lines = s.audit.recent("conn_1");
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => [l.agent, l.outcome, l.what, l.status]),
    [
      ["ADA", "refused", "GET evil.example.com/x", 403],
      ["BEN", "refused", "push o/r", 403],
      ["ADA", "sent", "GET /repos/o/r", 200],
    ],
  );
  const raw = readFileSync(s.auditFile, "utf8");
  assert.doesNotMatch(raw, new RegExp(TOKEN));
  assert.doesNotMatch(raw, /secret=query/, "no query strings");
});

// ── real git, through the proxy, to a real git server ──
//
// git's own smart HTTP server (git http-backend) stands in for github.com,
// and the turn's environment is exactly what connectionEnv gives: clone,
// branch and push go through the address with nothing else set up, the
// server sees the credential, and git, its config and its output never do.

function gitHere(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}

test("git clones, branches and pushes through a connection, and never holds the token", { skip: !gitHere() || process.platform === "win32" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "bloks-connections-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // asynchronous: the servers git talks to are in this process
  const run = (args: string[], cwd: string, env: Record<string, string> = {}) =>
    new Promise<{ status: number | null; out: string }>((resolve) => {
      const child = spawn("git", args, {
        cwd,
        env: { PATH: process.env.PATH ?? "", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", ...env },
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (status) => resolve({ status, out }));
    });
  // a bare repository with one commit, which accepts pushes over HTTP
  const seed = join(root, "seed");
  assert.equal((await run(["init", "-q", "-b", "main", seed], root)).status, 0);
  writeFileSync(join(seed, "README.md"), "hello\n");
  const who = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
  assert.equal((await run(["add", "."], seed)).status, 0);
  assert.equal((await run(["commit", "-q", "-m", "first"], seed, who)).status, 0);
  const served = join(root, "served");
  mkdirSync(join(served, "o"), { recursive: true });
  assert.equal((await run(["clone", "-q", "--bare", seed, join(served, "o", "r.git")], root)).status, 0);
  assert.equal((await run(["config", "http.receivepack", "true"], join(served, "o", "r.git"))).status, 0);

  // github.com: git http-backend behind a check that the credential is ours
  const auths: Array<string | undefined> = [];
  const github = createServer((req, res) => {
    auths.push(req.headers.authorization);
    if (req.headers.authorization !== `Basic ${BASIC}`) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="GitHub"' });
      return res.end();
    }
    const url = new URL(req.url ?? "/", "http://x");
    const cgi = spawn("git", ["http-backend"], {
      env: {
        PATH: process.env.PATH ?? "",
        GIT_PROJECT_ROOT: served,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method ?? "GET",
        CONTENT_TYPE: String(req.headers["content-type"] ?? ""),
        HTTP_CONTENT_ENCODING: String(req.headers["content-encoding"] ?? ""),
        HTTP_GIT_PROTOCOL: String(req.headers["git-protocol"] ?? ""),
        REMOTE_USER: "x-access-token",
        REMOTE_ADDR: "127.0.0.1",
      },
    });
    req.pipe(cgi.stdin);
    const chunks: Buffer[] = [];
    cgi.stdout.on("data", (c: Buffer) => chunks.push(c));
    cgi.on("close", () => {
      const all = Buffer.concat(chunks);
      const split = all.indexOf("\r\n\r\n");
      const head = all.subarray(0, split).toString();
      const body = all.subarray(split + 4);
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of head.split("\r\n")) {
        const at = line.indexOf(":");
        const name = line.slice(0, at).trim().toLowerCase();
        const value = line.slice(at + 1).trim();
        if (name === "status") status = Number.parseInt(value, 10);
        else headers[name] = value;
      }
      res.writeHead(status, headers);
      res.end(body);
    });
  });
  const upstreamPort = await listen(github);
  const handles = new ConnectionHandles();
  const records = new Map<string, ConnectionRecord>([["conn_1", { id: "conn_1", service: "github", token: TOKEN, addedAt: 1, grants: { ada: "write", ben: "read" } }]]);
  const audit = new AuditLog(join(root, "audit.jsonl"));
  const proxy = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    proxyConnection(req, res, url.pathname, url.search, true, {
      handles,
      liveAgent: (entry) => entry.botId,
      connection: (id) => records.get(id),
      agentName: (id) => id,
      audit,
      upstream: () => `http://127.0.0.1:${upstreamPort}`,
    });
  });
  const port = await listen(proxy);
  t.after(() => {
    github.closeAllConnections();
    github.close();
    proxy.closeAllConnections();
    proxy.close();
  });
  const envFor = (botId: string) =>
    connectionEnv("github", `http://127.0.0.1:${port}/connect/${handles.mint({ credential: botId, botId, connectionId: "conn_1" })}`, {});

  // Ada, read and write: clone, branch, commit, push
  const ada = envFor("ada");
  const work = join(root, "work");
  const cloned = await run(["clone", "https://github.com/o/r.git", work], root, ada);
  assert.equal(cloned.status, 0, cloned.out);
  assert.equal(readFileSync(join(work, "README.md"), "utf8"), "hello\n");
  assert.equal((await run(["switch", "-q", "-c", "fix"], work, ada)).status, 0);
  writeFileSync(join(work, "fix.txt"), "fixed\n");
  assert.equal((await run(["add", "."], work, ada)).status, 0);
  assert.equal((await run(["commit", "-q", "-m", "fix"], work, { ...ada, ...who })).status, 0);
  const pushed = await run(["push", "-u", "origin", "fix"], work, ada);
  assert.equal(pushed.status, 0, pushed.out);
  assert.equal((await run(["rev-parse", "--verify", "-q", "refs/heads/fix"], join(served, "o", "r.git"))).status, 0, "the branch reached the server");
  // the remote is still github.com: the address is the turn's, not the repository's
  assert.equal((await run(["remote", "get-url", "origin"], work)).out.trim(), "https://github.com/o/r.git");

  // Ben, read only: fetches, cannot push
  const ben = envFor("ben");
  assert.equal((await run(["fetch", "-q", "origin"], work, ben)).status, 0);
  writeFileSync(join(work, "more.txt"), "more\n");
  await run(["add", "."], work, ben);
  await run(["commit", "-q", "-m", "more"], work, { ...ben, ...who });
  const refused = await run(["push", "origin", "fix"], work, ben);
  assert.notEqual(refused.status, 0, "a read-only agent pushed");

  // everything git said and wrote, and the server saw the credential
  assert.ok(auths.length > 0 && auths.every((a) => a === `Basic ${BASIC}`));
  for (const out of [cloned.out, pushed.out, refused.out]) {
    assert.doesNotMatch(out, new RegExp(TOKEN));
    assert.doesNotMatch(out, new RegExp(BASIC));
  }
  assert.doesNotMatch(readFileSync(join(work, ".git", "config"), "utf8"), new RegExp(`${TOKEN}|${BASIC}|connect/bkc_`));
  assert.deepEqual(
    audit.recent("conn_1").map((l) => `${l.botId} ${l.outcome} ${l.what}`).filter((l) => l.includes("push")).reverse()[0],
    "ada sent push o/r",
  );
  assert.ok(audit.recent("conn_1").some((l) => l.botId === "ben" && l.outcome === "refused" && l.what === "push o/r"));
});
