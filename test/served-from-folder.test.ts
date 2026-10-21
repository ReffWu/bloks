// The routes that hand out a file from a folder, over HTTP, with a link
// out of that folder planted where a file was (GitHub 318). Each answers
// as if the file were not there; none sends a byte of what the link
// points at. The race itself is pinned down in open-inside.test.ts; this
// is the request path around it.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startRemoteProxy } from "../electron/remote.mjs";
import { startHarness } from "./helpers/server.ts";

const SECRET = "the key to everything";

test("the window's page, a Move file and an agent's photo are never read through a link", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-served-"));
  const ui = join(home, "ui");
  mkdirSync(ui);
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>Bloks</title>");
  writeFileSync(join(ui, "app.js"), "console.log('app')");
  writeFileSync(join(home, "secret.txt"), SECRET);
  symlinkSync(join(home, "secret.txt"), join(ui, "leak.js"));
  const h = await startHarness({ HOME: home, BLOKS_STATIC_DIR: ui });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });

  // Serving the page, this process is the window's own origin.
  const own = (path: string, init?: RequestInit) => h.fetchAs(h.url, path, init);
  const ownJson = async (path: string, init?: RequestInit) => (await own(path, init)).json();

  // ── the page this process serves, asked for the way a window does ──
  assert.equal(await (await fetch(`${h.url}/app.js`)).text(), "console.log('app')");
  const leak = await fetch(`${h.url}/leak.js`);
  const leaked = await leak.text();
  assert.doesNotMatch(leaked, /the key/);
  // a name that leads nowhere it may go is the page, like any other
  assert.match(leaked, /<title>Bloks<\/title>/);

  // ── a workspace written out to carry to another computer ──
  const made = await ownJson("/api/workspace/move", { method: "POST", body: "{}" });
  assert.ok(made.backup, JSON.stringify(made));
  const route = `/api/workspace/move/${encodeURIComponent(made.backup.name)}`;
  const whole = await own(route);
  assert.equal(whole.status, 200);
  const size = Number(whole.headers.get("content-length"));
  assert.equal(Buffer.from(await whole.arrayBuffer()).length, size);
  // the same file, put elsewhere, and a link to it left in its place:
  // it is a real Move file, so only the link is what refuses it
  const file = join(home, ".bloks-backups", made.backup.name);
  const elsewhere = join(home, "elsewhere.bloks");
  copyFileSync(file, elsewhere);
  unlinkSync(file);
  symlinkSync(elsewhere, file);
  assert.equal((await own(route)).status, 404);

  // ── an agent's photo ──
  const { bot } = await ownJson("/api/bots", { method: "POST", body: JSON.stringify({ name: "Pictured" }) });
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const put = await own(`/api/bots/${bot.id}/avatar`, { method: "PUT", body: JSON.stringify({ mime: "image/png", data: png.toString("base64") }) });
  assert.equal(put.status, 200);
  const photo = await own(`/api/bots/${bot.id}/avatar`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  const avatar = join(home, ".bloks", "avatars", bot.id);
  unlinkSync(avatar);
  symlinkSync(join(home, "secret.txt"), avatar);
  const linked = await own(`/api/bots/${bot.id}/avatar`);
  assert.equal(linked.status, 404);
  assert.doesNotMatch(await linked.text(), /the key/);
  const exported = await own(`/api/bots/${bot.id}/export`);
  assert.doesNotMatch(await exported.text(), new RegExp(Buffer.from(SECRET).toString("base64").slice(0, 16)));
});

test("an agent's memory file made a link out of its folder is not read back through the server", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Rememberer" }) });
  assert.equal((await h.fetch(`/api/bots/${bot.id}/memory`, { method: "PUT", body: JSON.stringify({ text: "# Memory\n\nreal note" }) })).status, 200);
  const ws = join(h.home, ".bloks", "workspaces", bot.id);
  writeFileSync(join(h.home, "secret.md"), SECRET);
  mkdirSync(join(ws, "memory"), { recursive: true });
  symlinkSync(join(h.home, "secret.md"), join(ws, "memory", "leak.md"));
  writeFileSync(join(ws, "memory", "kept.md"), "a real topic");
  const topics = await h.json(`/api/bots/${bot.id}/memory`);
  assert.match(JSON.stringify(topics), /real note/);
  assert.doesNotMatch(JSON.stringify(topics), /the key/);
  assert.equal((await h.fetch(`/api/bots/${bot.id}/memory/topics/kept.md`)).status, 200);
  const leak = await h.fetch(`/api/bots/${bot.id}/memory/topics/leak.md`);
  assert.doesNotMatch(await leak.text(), /the key/);
  // and MEMORY.md itself, swapped for a link
  unlinkSync(join(ws, "MEMORY.md"));
  symlinkSync(join(h.home, "secret.md"), join(ws, "MEMORY.md"));
  assert.doesNotMatch(JSON.stringify(await h.json(`/api/bots/${bot.id}/memory`)), /the key/);
});

test("the app's own page proxy, for a workspace on another computer, does the same", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-proxy-ui-"));
  const ui = join(home, "ui");
  mkdirSync(join(ui, "assets"), { recursive: true });
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>Bloks</title>");
  writeFileSync(join(ui, "assets", "app.js"), "console.log('app')");
  writeFileSync(join(home, "secret.txt"), SECRET);
  symlinkSync(join(home, "secret.txt"), join(ui, "assets", "leak.js"));
  symlinkSync(home, join(ui, "up"));
  const proxy = await startRemoteProxy(
    { relayUrl: "http://127.0.0.1:9", relayToken: "t", deviceId: "d", deviceToken: "token" },
    { staticDir: ui },
  );
  t.after(() => {
    proxy.stop();
    rmSync(home, { recursive: true, force: true });
  });
  const get = async (path: string) => (await fetch(`http://127.0.0.1:${proxy.port}${path}`)).text();
  assert.equal(await get("/assets/app.js"), "console.log('app')");
  for (const path of ["/assets/leak.js", "/up/secret.txt", "/..%2Fsecret.txt", "/assets/../../secret.txt"]) {
    const body = await get(path);
    assert.doesNotMatch(body, /the key/, path);
    assert.match(body, /<title>Bloks<\/title>/, path);
  }
});
