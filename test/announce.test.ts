// The local network hears where this Bloks is only while a phone may
// reach it, and never after the server is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  announceCommand,
  instanceName,
  mayAnnounce,
  stopAnnouncing,
  syncAnnouncement,
  workspaceTag,
  type Announcer,
} from "../server/announce.ts";

function recorder() {
  const spawned: { command: string; args: string[]; killed: boolean }[] = [];
  const spawner = (command: string, args: string[]): Announcer => {
    const entry = { command, args, killed: false };
    spawned.push(entry);
    return {
      kill: () => {
        entry.killed = true;
        return true;
      },
    };
  };
  return { spawned, spawner };
}

test("announces only from the desktop app on a Mac, and never from bloks-server", () => {
  assert.equal(mayAnnounce({}, "darwin", true), true);
  assert.equal(mayAnnounce({}, "darwin", false), false, "tests and hand-started servers stay quiet");
  assert.equal(mayAnnounce({ BLOKS_ANNOUNCE: "1" }, "darwin", false), true);
  assert.equal(mayAnnounce({ BLOKS_ANNOUNCE: "0" }, "darwin", true), false);
  assert.equal(mayAnnounce({ BLOKS_LOOPBACK_ONLY: "1" }, "darwin", true), false);
  assert.equal(mayAnnounce({}, "linux", true), false);
  assert.equal(mayAnnounce({}, "win32", true), false);
});

test("the name is the computer, with the workspace when it is not Personal, in 63 bytes", () => {
  assert.equal(instanceName("Hamed's MacBook"), "Hamed's MacBook");
  assert.equal(instanceName("Hamed's MacBook", "Personal"), "Hamed's MacBook");
  assert.equal(instanceName("Hamed's MacBook", "Studio"), "Studio on Hamed's MacBook");
  assert.equal(instanceName("Mac\u0000\n"), "Mac");
  assert.equal(instanceName("  "), "Bloks");
  const long = instanceName("é".repeat(60));
  assert.ok(Buffer.byteLength(long, "utf8") <= 63);
});

test("a workspace's tag is a hash of its own key, the same each time, and never its id", () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-tag-"));
  const other = mkdtempSync(join(tmpdir(), "bk-tag-"));
  try {
    const tag = workspaceTag(dir);
    assert.match(tag, /^[0-9a-f]{16}$/);
    assert.equal(workspaceTag(dir), tag);
    assert.notEqual(workspaceTag(other), tag, "each workspace its own");
    assert.equal(workspaceTag(dir), tag, "and back again, from its folder");
    assert.doesNotMatch(readFileSync(join(dir, "announce-key"), "utf8"), new RegExp(tag), "the key is not the tag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("on announces once, a new port replaces the old, and off stops it", () => {
  const { spawned, spawner } = recorder();
  try {
    assert.equal(syncAnnouncement(true, { name: "Mac", port: 8811 }, spawner, 4242), true);
    assert.equal(spawned.length, 1);
    const [command, args] = announceCommand({ name: "Mac", port: 8811 }, 4242);
    assert.equal(spawned[0].command, command);
    assert.deepEqual(spawned[0].args, args);
    assert.deepEqual(args.slice(3), ["Mac", "8811", "4242", ""]);
    assert.match(args[1], /"ws=\$4"/, "the workspace's tag rides in the TXT record");

    syncAnnouncement(true, { name: "Mac", port: 8811 }, spawner, 4242);
    assert.equal(spawned.length, 1, "saying it again changes nothing");

    syncAnnouncement(true, { name: "Mac", port: 8812 }, spawner, 4242);
    assert.equal(spawned.length, 2);
    assert.equal(spawned[0].killed, true, "the old port is no longer announced");

    assert.equal(syncAnnouncement(false, { name: "Mac", port: 8812 }, spawner, 4242), false);
    assert.equal(spawned[1].killed, true);
    assert.equal(syncAnnouncement(true, { name: "Mac", port: 0 }, spawner, 4242), false, "no port, nothing said");
    assert.equal(spawned.length, 2);
  } finally {
    stopAnnouncing();
  }
});

test("the announcement ends within seconds of its server going, however it went", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-announce-"));
  try {
    // stands in for dns-sd: says who it is, then waits to be ended
    const fake = join(dir, "dns-sd");
    const pidFile = join(dir, "pid");
    writeFileSync(fake, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`);
    chmodSync(fake, 0o755);
    // stands in for the server, gone in a moment without any cleanup
    const server = spawn("sleep", ["1"], { stdio: "ignore" });
    const [command, args] = announceCommand({ name: "Mac", port: 8811 }, server.pid!, fake);
    const watcher = spawn(command, args, { stdio: "ignore" });
    const watcherDone = new Promise((resolve) => watcher.on("exit", resolve));

    for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
    const announcer = Number(readFileSync(pidFile, "utf8").trim());
    assert.ok(announcer > 0);
    assert.doesNotThrow(() => process.kill(announcer, 0), "announcing while the server lives");

    await new Promise((resolve) => server.on("exit", resolve));
    await Promise.race([watcherDone, new Promise((_, reject) => setTimeout(() => reject(new Error("watcher kept going")), 6000))]);
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(() => process.kill(announcer, 0), "the announcement went with the server");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
