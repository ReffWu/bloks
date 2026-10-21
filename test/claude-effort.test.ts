// Claude Code is told how hard to think on every turn (GitHub 334).
//
// The dial was offered on Claude agents and never reached the CLI: argv
// had --model and no effort, so every turn ran at the CLI's own default.
// Each turn is a process of its own, so the level goes on each command
// line as --effort, the levels `claude --help` lists for it. A CLI too
// old to be known to take it is sent none, rather than a flag it would
// refuse along with the turn.
//
// The engine is a synthetic peer: what is asserted is how it was started.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test, type TestContext } from "node:test";

import type { SendTurnInput } from "../server/contracts.ts";

async function fixture(t: TestContext, version = "2.1.302 (Claude Code)") {
  const home = mkdtempSync(join(tmpdir(), "bloks-claude-effort-"));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  const started: string[][] = [];
  const peer = Object.assign(new EventEmitter(), {
    pid: 2_147_483_645,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdin: new Writable({ write: (_chunk, _encoding, done) => done() }),
    kill(signal: string) {
      queueMicrotask(() => {
        if (peer.signalCode) return;
        peer.signalCode = signal;
        peer.emit("exit", null, signal);
        peer.emit("close", null, signal);
      });
      return true;
    },
  });
  t.mock.method(childProcess, "execFile", (_cli: unknown, _args: unknown, _opts: unknown, callback: any) => {
    queueMicrotask(() => callback(null, version));
    return new EventEmitter();
  });
  t.mock.method(childProcess, "spawn", (_cli: unknown, args: string[]) => {
    started.push(args);
    return peer;
  });
  t.mock.method(fs, "appendFileSync", () => {});
  t.mock.method(process, "kill", (pid: number) => {
    assert.equal(pid, -peer.pid, "only the peer's own group may be signalled");
    throw Object.assign(new Error("no such group"), { code: "ESRCH" });
  });
  syncBuiltinESMExports();
  const { ClaudeDriver } = await import("../server/drivers/claude.ts");
  const instance = await ClaudeDriver.create({
    instanceId: "claude",
    displayName: "Claude",
    enabled: true,
    environment: {},
    config: { cli: "fixture-claude", permissionMode: "bypassPermissions" } as any,
  });
  t.after(async () => {
    if (!peer.signalCode) {
      peer.signalCode = "SIGKILL";
      peer.emit("exit", null, "SIGKILL");
      peer.emit("close", null, "SIGKILL");
    }
    await instance.dispose();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  });
  /** The command line one turn was started with. */
  const argv = async (turn: Partial<SendTurnInput>) => {
    await instance.adapter.sendTurn({ threadId: "effort-fixture", text: "Think it through", stallMs: 0, ...turn });
    assert.equal(started.length, 1, "the turn never started its process");
    return started[0];
  };
  return { instance, argv };
}

const effortOf = (args: string[]) => (args.includes("--effort") ? args[args.indexOf("--effort") + 1] : undefined);

for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
  test(`an agent set to ${effort} starts Claude Code with --effort ${effort}`, async (t) => {
    const f = await fixture(t);
    const args = await f.argv({ effort, model: "claude-opus-5-5" });
    assert.equal(effortOf(args), effort);
    assert.equal(args.filter((arg) => arg === "--effort").length, 1);
    assert.equal(args[args.indexOf("--model") + 1], "claude-opus-5-5");
  });
}

test("a resumed session is told the level again, since every turn is a new process", async (t) => {
  const f = await fixture(t);
  const args = await f.argv({ effort: "max", resumeCursor: "11111111-2222-4333-8444-555555555555" });
  assert.ok(args.includes("--resume"));
  assert.equal(effortOf(args), "max");
});

test("an agent on the engine's own effort is sent none", async (t) => {
  const f = await fixture(t);
  assert.equal(effortOf(await f.argv({})), undefined);
});

test("a CLI older than any known to take --effort is sent none, and the turn still goes", async (t) => {
  const f = await fixture(t, "2.1.251 (Claude Code)");
  const args = await f.argv({ effort: "max" });
  assert.equal(effortOf(args), undefined);
  assert.ok(args.includes("-p"));
});

test("the driver says it takes every level", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.instance.adapter.capabilities.efforts, ["low", "medium", "high", "xhigh", "max"]);
});
