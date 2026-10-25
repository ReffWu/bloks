// The GitHub CLI plugin (GitHub 387): what Bloks finds of git and gh on
// this computer, what it says is left to do, what an agent is told, and
// that none of it reads gh's token or keeps a copy of it.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { allows } from "../server/agent-cli.ts";
import { checkGitHubCli, ghHint, gitAsksGh, parseStatusJson, parseStatusText, type CheckDeps, type RunResult } from "../server/cli-plugins.ts";
import { startHarness } from "./helpers/server.ts";
import { idle, waitFor } from "./helpers/turns.ts";

const STATUS_JSON = JSON.stringify({
  hosts: {
    "github.com": [
      { state: "success", active: true, host: "github.com", login: "octo", tokenSource: "keyring", scopes: "gist, read:org, repo, workflow", gitProtocol: "https" },
      { state: "success", active: false, host: "github.com", login: "other", tokenSource: "/Users/me/.config/gh/hosts.yml", scopes: "repo", gitProtocol: "https" },
    ],
  },
});

/** A computer with these answers. Every command run is kept, so a test
 * can say what was never asked. */
function machine(answers: Record<string, RunResult>, found: Record<string, string>, extra: Partial<CheckDeps> = {}) {
  const ran: string[] = [];
  const deps: CheckDeps = {
    run: async (command, args) => {
      const line = `${command} ${args.join(" ")}`;
      ran.push(line);
      for (const [start, answer] of Object.entries(answers)) if (line.startsWith(start)) return answer;
      return { code: 1, stdout: "", stderr: "" };
    },
    resolve: (command) => found[command] ?? null,
    exists: () => true,
    platform: "darwin",
    home: "/Users/me",
    ...extra,
  };
  return { deps, ran };
}

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const READY = {
  "/usr/bin/git --version": ok("git version 2.50.1 (Apple Git-155)\n"),
  "/usr/bin/git config": ok("credential.https://github.com.helper \ncredential.https://github.com.helper !/opt/homebrew/bin/gh auth git-credential\n"),
  "/opt/homebrew/bin/gh --version": ok("gh version 2.96.0 (2026-07-02)\n"),
  "/opt/homebrew/bin/gh auth status --hostname github.com --json hosts": ok(STATUS_JSON),
};
const FOUND = { git: "/usr/bin/git", gh: "/opt/homebrew/bin/gh", brew: "/opt/homebrew/bin/brew" };

test("ready: git, gh signed in from the keychain, and git asking gh", async () => {
  const { deps, ran } = machine(READY, FOUND);
  const status = await checkGitHubCli(deps);
  assert.equal(status.ready, true);
  assert.equal(status.next, null);
  assert.deepEqual([status.git.version, status.gh.version], ["2.50.1", "2.96.0"]);
  assert.equal(status.account?.login, "octo");
  assert.equal(status.account?.storage, "keychain");
  assert.equal(status.accounts.find((a) => a.login === "other")?.where, "~/.config/gh/hosts.yml");
  assert.equal(status.gitUsesGh, true);
  // never the token: not `gh auth token`, not status with it shown
  for (const line of ran) {
    assert.doesNotMatch(line, /auth token|--show-token|\s-t(\s|$)/, line);
  }
  assert.match(ghHint(status), /signed in to github\.com as @octo/);
  assert.match(ghHint(status), /gh pr create/);
  assert.match(ghHint(status), /Never print, copy or save its token/);
});

test("each missing piece is the next step, in order", async () => {
  // no developer tools: /usr/bin/git is the installer stub and is never run
  const stub = machine(READY, FOUND, { exists: () => false });
  const noTools = await checkGitHubCli(stub.deps);
  assert.equal(noTools.git.found, false);
  assert.equal(noTools.git.problem, "needs the Command Line Tools");
  assert.equal(noTools.next?.kind, "git");
  assert.equal(noTools.next?.command, "xcode-select --install");
  assert.ok(!stub.ran.some((line) => line.startsWith("/usr/bin/git")), "the stub was run");

  const noGh = await checkGitHubCli(machine(READY, { git: "/usr/bin/git", brew: "/opt/homebrew/bin/brew" }).deps);
  assert.equal(noGh.next?.kind, "install");
  assert.equal(noGh.next?.kind === "install" && noGh.next.command, "brew install gh");
  const noBrew = await checkGitHubCli(machine(READY, { git: "/usr/bin/git" }).deps);
  assert.equal(noBrew.next?.kind === "install" && noBrew.next.command, null);
  assert.equal(noBrew.next?.kind === "install" && noBrew.next.url, "https://cli.github.com");

  const signedOut = await checkGitHubCli(
    machine({ ...READY, "/opt/homebrew/bin/gh auth status --hostname github.com --json hosts": ok(JSON.stringify({ hosts: {} })) }, FOUND).deps,
  );
  assert.equal(signedOut.next?.kind, "sign-in");
  assert.match(signedOut.next?.kind === "sign-in" ? signedOut.next.command : "", /^gh auth login --hostname github\.com/);
  assert.match(ghHint(signedOut), /not ready/);

  const broken = await checkGitHubCli(
    machine(
      { ...READY, "/opt/homebrew/bin/gh auth status --hostname github.com --json hosts": ok(JSON.stringify({ hosts: { "github.com": [{ state: "error", active: true, login: "octo", tokenSource: "keyring" }] } })) },
      FOUND,
    ).deps,
  );
  assert.equal(broken.next?.kind, "sign-in");
  assert.match(broken.next?.says ?? "", /@octo no longer works/);

  const noHelper = await checkGitHubCli(machine({ ...READY, "/usr/bin/git config": { code: 1, stdout: "", stderr: "" } }, FOUND).deps);
  assert.equal(noHelper.gitUsesGh, false);
  assert.equal(noHelper.next?.kind, "setup-git");
});

test("an older gh without --json is read from its words", async () => {
  const words = [
    "github.com",
    "  ✓ Logged in to github.com account octo (keyring)",
    "  - Active account: true",
    "  - Git operations protocol: https",
    "  - Token: gho_************************************",
    "  - Token scopes: 'gist', 'read:org', 'repo'",
    "",
  ].join("\n");
  const accounts = parseStatusText(words);
  assert.deepEqual(accounts, [{ host: "github.com", login: "octo", active: true, ok: true, storage: "keychain", scopes: "gist, read:org, repo", gitProtocol: "https" }]);
  const status = await checkGitHubCli(
    machine({ ...READY, "/opt/homebrew/bin/gh auth status --hostname github.com --json hosts": { code: 1, stdout: "", stderr: "unknown flag: --json" }, "/opt/homebrew/bin/gh auth status --hostname github.com": { code: 0, stdout: "", stderr: words } }, FOUND).deps,
  );
  assert.equal(status.ready, true);
  assert.equal(status.account?.login, "octo");
  assert.equal(parseStatusJson("not json"), null);
});

test("git's helper is gh's only when it says so", () => {
  assert.equal(gitAsksGh("credential.https://github.com.helper !/usr/local/bin/gh auth git-credential"), true);
  assert.equal(gitAsksGh("credential.helper !gh auth git-credential"), true);
  assert.equal(gitAsksGh("credential.helper osxkeychain"), false);
  assert.equal(gitAsksGh("credential.https://gitlab.com.helper !glab auth git-credential"), false);
});

/** gh and git stand-ins on a PATH of their own, each writing down how it
 * was run. */
function fakeTools(dir: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "ran.log");
  writeFileSync(log, "");
  const tool = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  tool(
    "gh",
    [
      'case "$*" in',
      '  "--version") echo "gh version 2.96.0 (2026-07-02)";;',
      `  "auth status --hostname github.com --json hosts") echo '${STATUS_JSON}';;`,
      '  "auth setup-git --hostname github.com") echo "credential.https://github.com.helper !gh auth git-credential" > "$HOME/helper";;',
      "  *) exit 1;;",
      "esac",
    ].join("\n"),
  );
  tool(
    "git",
    [
      'case "$*" in',
      '  "--version") echo "git version 2.50.1";;',
      '  config*) if [ -f "$HOME/helper" ]; then cat "$HOME/helper"; else exit 1; fi;;',
      "  *) exit 1;;",
      "esac",
    ].join("\n"),
  );
  return { bin, ran: () => readFileSync(log, "utf8") };
}

test("Settings, Plugins, CLIs: this computer only, never an agent; and an agent is told while it is on", { skip: process.platform === "win32", timeout: 120_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-cli-plugins-"));
  const scratch = mkdtempSync(join(tmpdir(), "bloks-cli-plugins-tools-"));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });
  const tools = fakeTools(scratch);
  const runs = join(scratch, "runs.jsonl");
  const cli = join(scratch, "fake-claude.mjs");
  writeFileSync(runs, "");
  writeFileSync(
    cli,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const out = (f) => console.log(JSON.stringify(f));
const file = args[args.indexOf("--append-system-prompt-file") + 1];
let input = "";
process.stdin.on("data", function take(c) {
  input += c;
  const frame = input.split("\\n").slice(0, -1).filter(Boolean).map(JSON.parse).find((f) => f.type === "user");
  if (!frame) return;
  process.stdin.off("data", take);
  const said = typeof frame.message.content === "string" ? frame.message.content : JSON.stringify(frame.message.content);
  appendFileSync(${JSON.stringify(runs)}, JSON.stringify({ said: (said.match(/TURN-\\d/) || [""])[0], system: file && existsSync(file) ? readFileSync(file, "utf8") : "" }) + "\\n");
  out({ type: "system", subtype: "init", session_id: "s", model: "claude-sonnet-5" });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, session_id: "s", result: "Done", total_cost_usd: 0 });
});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"));
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli } } } }));
  const h = await startHarness({ HOME: home, PATH: tools.bin });
  t.after(() => h.stop());
  const runOf = (marker: string) =>
    waitFor(() =>
      readFileSync(runs, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .find((r) => r.said === marker),
    );

  const listed = await h.json("/api/cli-plugins");
  const github = listed.plugins[0];
  assert.equal(github.id, "github");
  assert.equal(github.enabled, false, "off until the person turns it on");
  assert.equal(github.status.account.login, "octo");
  assert.equal(github.status.gitUsesGh, false);
  assert.equal(github.status.next.kind, "setup-git");

  // set git up with the same gh, then it is ready
  const setUp = await h.json("/api/cli-plugins/github/setup-git", { method: "POST" });
  assert.equal(setUp.ok, true);
  assert.equal(setUp.plugin.status.ready, true);
  assert.match(tools.ran(), /gh auth setup-git --hostname github\.com/);

  // off: an agent is told nothing of gh
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ada" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "TURN-1" }) });
  const off = await runOf("TURN-1");
  assert.ok(off, h.logs());
  assert.doesNotMatch(off.system, /GitHub/);
  await idle(h, bot);

  // on: told it is signed in, as whom, and how to use it
  assert.equal((await h.fetch("/api/cli-plugins/github", { method: "PUT", body: JSON.stringify({ enabled: "yes" }) })).status, 400);
  const on = await h.json("/api/cli-plugins/github", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  assert.equal(on.plugin.enabled, true);
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".bloks", "config.json"), "utf8")).cliPlugins, { github: { enabled: true } });
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "TURN-2" }) });
  const told = await runOf("TURN-2");
  assert.ok(told, h.logs());
  assert.match(told.system, /git and gh on this computer are signed in to github\.com as @octo/);
  await idle(h, bot);

  // never the token, and nothing kept of gh's sign-in
  assert.doesNotMatch(tools.ran(), /auth token|--show-token/);
  assert.doesNotMatch(readFileSync(join(home, ".bloks", "config.json"), "utf8"), /octo|keyring/);

  // not a website, not a phone, not an agent
  assert.equal((await h.fetchAs("https://example.com", "/api/cli-plugins")).status, 403);
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Test iPhone" }) });
  assert.ok(paired.body?.token);
  for (const [method, path] of [
    ["GET", "/api/cli-plugins"],
    ["PUT", "/api/cli-plugins/github"],
    ["POST", "/api/cli-plugins/github/check"],
    ["POST", "/api/cli-plugins/github/sign-in"],
    ["POST", "/api/cli-plugins/github/setup-git"],
    ["POST", "/api/cli-plugins/github/install"],
  ]) {
    const res = await h.fetchRemote(path, { method, token: paired.body.token, ...(method === "GET" ? {} : { body: "{}" }) }).catch((e) => ({ status: String(e), body: null }));
    assert.equal(res.status, 403, `a phone reached ${method} ${path}`);
    assert.equal(allows(bot.id, method, path).ok, false, `an agent may ${method} ${path}`);
  }

  // off again: Disconnect
  const disconnected = await h.json("/api/cli-plugins/github", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  assert.equal(disconnected.plugin.enabled, false);
});
