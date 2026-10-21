// Moving a workspace between this Mac and the person's hosted machine, end
// to end and both ways (electron/hosting-move.mjs), between real servers:
// one temp-HOME server as this Mac, one in hosted mode as the hosted
// machine, the hosted one reached the way the app reaches it, through the
// app's own stand-in server (electron/remote.mjs) and a stand-in for Bloks
// Cloud that carries sealed asks and nothing more. A small supervisor
// brings each server back after it stops to put a move in place, as the
// app's keeper does on a Mac and the hosting image does on the machine.
//
// What this holds shut: a move landing in a workspace with work in it;
// counts that do not match on the other side; a move killed mid-send
// starting over rather than carrying on; anything running twice once a
// move is done (a routine fires only where the workspace is live now);
// and a key or a secret travelling, in any part sent.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { newMove, runMove, type Move } from "../electron/hosting-move.mjs";
import { startRemoteProxy } from "../electron/remote.mjs";
import { startHarness, type Harness } from "./helpers/server.ts";

const PROVIDER_KEY = "sk-or-v1-hostingmove0123456789abcdef";
const SAVED_SECRET = "weather-secret-hostingmove-0987654321";
const COMPOSIO_KEY = "ak_hostingmovecomposio123456";
const SLACK_BOT = "xoxb-1111-2222-hostingmoveslackbot";
const SLACK_APP = "xapp-1-A111-2222-hostingmoveslackapp";
const HOSTED_SECRET = "hosted-only-secret-hostingmove-5555";
const RELAY_AGENT = "relay-agent-token-hostingmove";
const RELAY_CLIENT = "relay-client-token-hostingmove";
const DEVICE_TOKEN = "owner-device-token-hostingmove";
const SECRETS = [PROVIDER_KEY, SAVED_SECRET, COMPOSIO_KEY, SLACK_BOT, SLACK_APP, HOSTED_SECRET, RELAY_AGENT, RELAY_CLIENT];

const RUNNER = fileURLToPath(new URL("./helpers/move-runner.mjs", import.meta.url));
/** Each step as it happens, with MOVE_TRACE=1: a move that waits on two
 * restarts is slow to read from its end alone. */
const trace = (line: string) => process.env.MOVE_TRACE && process.stderr.write(`[move-test ${new Date().toISOString().slice(11, 19)}] ${line}\n`);

async function until<T>(check: () => T | null | undefined | false | Promise<T | null | undefined | false>, ms = 60_000, every = 200): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const got = await check();
    if (got) return got as T;
    await new Promise((r) => setTimeout(r, every));
  }
  return undefined;
}

function home(config: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "bloks-test-hosting-move-"));
  mkdirSync(join(dir, ".bloks"), { recursive: true });
  writeFileSync(join(dir, ".bloks", "config.json"), JSON.stringify(config, null, 2));
  return dir;
}

/** Bloks Cloud, just real enough: the workspace's line, sealed asks carried
 * to it and their sealed answers back. When the workspace's line drops (a
 * restart), what was waiting is answered "not connected" at once. */
async function stubRelay() {
  let upstream: ServerResponse | null = null;
  const pending = new Map<string, ServerResponse>();
  const streams = new Set<ServerResponse>();
  let asks = 0;
  const server: Server = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    if (path === "/space/agent/stream") {
      upstream = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"kind":"hello","spaceId":"hosting-move-space"}\n\n');
      req.on("close", () => {
        if (upstream !== res) return;
        upstream = null;
        for (const waiting of pending.values()) waiting.writeHead(503, { "content-type": "application/json" }).end('{"error":"not connected"}');
        pending.clear();
      });
      return;
    }
    if (path === "/space/client/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"kind":"hello","online":true}\n\n');
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (path === "/space/client/ask") {
      if (!upstream) return void res.writeHead(503, { "content-type": "application/json" }).end('{"error":"not connected"}');
      const id = `ask-${++asks}`;
      pending.set(id, res);
      upstream.write(`data: ${JSON.stringify({ kind: "ask", id, payload: body.payload })}\n\n`);
      return;
    }
    if (path === "/space/agent/result") {
      const waiting = pending.get(String(body.id));
      pending.delete(String(body.id));
      waiting?.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ payload: body.payload }));
    }
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    get connected() {
      return upstream !== null;
    },
    async stop() {
      for (const s of streams) s.end();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** A server that is brought back whenever it stops, on the same home, the
 * way a supervisor brings a hosted machine back and the app's keeper a
 * workspace on the Mac. Paused while a test edits its files. */
async function supervised(dir: string, env: Record<string, string> = {}) {
  let h: Harness = await startHarness({ HOME: dir, ...env });
  let paused = false;
  let stopped = false;
  let restarts = 0;
  const alive = async () => {
    try {
      return (await fetch(`${h.url}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok;
    } catch {
      return false;
    }
  };
  const loop = (async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 250));
      if (paused || stopped) continue;
      if (await alive()) continue;
      // twice, so a slow answer is not taken for a stop
      await new Promise((r) => setTimeout(r, 300));
      if (paused || stopped || (await alive())) continue;
      await h.stop().catch(() => {});
      if (stopped) break;
      h = await startHarness({ HOME: dir, ...env });
      restarts++;
      trace(`supervisor: ${env.BLOKS_HOSTED ? "hosted" : "mac"} back on ${h.url}`);
    }
  })();
  return {
    get h() {
      return h;
    },
    get url() {
      return h.url;
    },
    get restarts() {
      return restarts;
    },
    data: join(dir, ".bloks"),
    /** Stopped while `edit` changes its files, then started again. */
    async around(edit: () => void) {
      paused = true;
      await h.stop();
      edit();
      h = await startHarness({ HOME: dir, ...env });
      paused = false;
    },
    async stop() {
      stopped = true;
      await loop;
      await h.stop();
    },
  };
}

const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/** The names and contents of a plain move file's entries. */
function entries(file: Buffer): Map<string, string> {
  const tar = gunzipSync(file);
  const out = new Map<string, string>();
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = tar.subarray(at, at + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(tar.subarray(at + 124, at + 136).toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
    if (String.fromCharCode(tar[at + 156]) === "0") out.set(name, tar.subarray(at + 512, at + 512 + size).toString("latin1"));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Every byte that crossed, and the file as it was put together where it
 * landed: no key and no secret in any of it, gzipped or opened. */
function assertNoSecrets(sent: Buffer[], arrivedDir: string) {
  const crossed = Buffer.concat(sent);
  for (const secret of SECRETS) assert.equal(crossed.includes(secret), false, `${secret.slice(0, 12)} crossed in a part`);
  const landed = readdirSync(arrivedDir).filter((name) => name.includes("-move-in"));
  assert.ok(landed.length > 0, "the file that arrived is kept where it landed");
  for (const name of landed) {
    const bytes = readFileSync(join(arrivedDir, name));
    const inside = [...entries(bytes).values()].join("\n");
    for (const secret of SECRETS) {
      assert.equal(bytes.includes(secret), false, `${secret.slice(0, 12)} is in the file that arrived`);
      assert.equal(inside.includes(secret), false, `${secret.slice(0, 12)} is inside the file that arrived`);
    }
  }
}

/** A routine due a minute ago on whichever copies hold it, as the
 * scheduler finds it on its first look after a start. */
function dueNow(dataDir: string) {
  const file = join(dataDir, "routines.json");
  if (!existsSync(file)) return;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const at = new Date(Date.now() - 60_000);
  for (const r of saved) {
    r.time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    r.days = [];
    r.scheduledAt = Date.now() - 86_400_000;
    delete r.lastRunAt;
    r.runs = [];
  }
  writeFileSync(file, JSON.stringify(saved));
}

/** Move files written out in a backups folder (not ones that arrived). */
const moveFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.includes("-move") && !n.includes("-move-in")) : []);

const ran = async (url: string) => {
  const { body } = await json(`${url}/api/routines`);
  return (body.routines ?? []).filter((r: any) => r.lastRunAt !== undefined || (r.runs ?? []).length > 0).length;
};

/** Runs the move in a process of its own and kills it once some parts are
 * across and some are not. Answers the move as it kept it. */
async function killMidSend(start: Move, source: string, target: string, dir: string): Promise<Move> {
  const state = join(dir, `move-${start.id}.json`);
  trace(`kill mid-send: ${start.direction}`);
  const child = spawn(process.execPath, [RUNNER], {
    env: { ...process.env, MOVE_START: JSON.stringify(start), MOVE_SOURCE: source, MOVE_TARGET: target, MOVE_STATE: state },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr?.on("data", (c) => (err += c));
  let lastStep = "";
  const mid = await until(() => {
    if (!existsSync(state)) return null;
    try {
      const move = JSON.parse(readFileSync(state, "utf8")) as Move;
      if (`${move.step}${move.phase}` !== lastStep) {
        lastStep = `${move.step}${move.phase}`;
        trace(`runner: ${move.step} ${move.phase} ${move.sent}/${move.size} ${move.error ?? ""}`);
      }
      return move.step === "sending" && move.sent > 0 && move.sent < move.size ? move : null;
    } catch {
      return null;
    }
  }, 120_000, 50);
  assert.ok(mid, `the send never got to its middle: ${err.slice(-400)}`);
  const gone = new Promise((r) => child.once("exit", r));
  child.kill("SIGKILL");
  await gone;
  const kept = JSON.parse(readFileSync(state, "utf8")) as Move;
  assert.equal(kept.step, "sending");
  assert.ok(kept.upload?.id, "the upload it was sending into is kept");
  return kept;
}

describe("moving a workspace between this Mac and the hosted machine", { timeout: 600_000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "bloks-hosting-move-scratch-"));
  let relay: Awaited<ReturnType<typeof stubRelay>>;
  let mac: Awaited<ReturnType<typeof supervised>>;
  let hosted: Awaited<ReturnType<typeof supervised>>;
  let proxy: Awaited<ReturnType<typeof startRemoteProxy>>;
  let hostedUrl = "";
  let homes: string[] = [];
  let macCounts: any = null;

  before(async () => {
    relay = await stubRelay();
    const macHome = home({
      providers: { openrouter: { key: PROVIDER_KEY } },
      secrets: { WEATHER_TOKEN: SAVED_SECRET },
      composio: { key: COMPOSIO_KEY },
      chat: { slack: { enabled: false, botToken: SLACK_BOT, appToken: SLACK_APP } },
      profile: { about: "I run a bakery." },
      backups: { auto: false },
      brief: { enabled: false },
    });
    const hostedHome = home({
      relay: { enabled: true, url: relay.url, agentToken: RELAY_AGENT, clientToken: RELAY_CLIENT },
      remote: { enabled: false, devices: [{ id: "owner-desktop", name: "Mac (desktop)", hash: createHash("sha256").update(DEVICE_TOKEN).digest("hex"), pairedAt: 1 }] },
      secrets: { HOSTED_ONLY: HOSTED_SECRET },
      backups: { auto: false },
      brief: { enabled: false },
    });
    homes = [macHome, hostedHome];
    mac = await supervised(macHome);
    // as bloks-server runs it there: on loopback, with Bloks Cloud its door
    hosted = await supervised(hostedHome, { BLOKS_HOSTED: "1", BLOKS_LOOPBACK_ONLY: "1" });
    assert.ok(await until(() => relay.connected), "the hosted machine dialled Bloks Cloud");
    const ui = join(scratch, "ui");
    mkdirSync(ui, { recursive: true });
    writeFileSync(join(ui, "index.html"), "<!doctype html><title>Fixture</title>");
    proxy = await startRemoteProxy(
      { relayUrl: relay.url, relayToken: RELAY_CLIENT, deviceId: "owner-desktop", deviceToken: DEVICE_TOKEN },
      { staticDir: ui, client: "macOS 3.0" },
    );
    hostedUrl = `http://127.0.0.1:${proxy.port}`;

    // ── the workspace on the Mac ──
    const a = mac.h;
    const { bot: alpha } = await a.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Alpha" }) });
    const { bot: beta } = await a.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Beta" }) });
    assert.equal((await a.fetch(`/api/bots/${alpha.id}/memory`, { method: "PUT", body: JSON.stringify({ text: "- Croissants sell out by nine.\n" }) })).status, 200);
    assert.ok((await a.fetch("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Kitchen", memberIds: [alpha.id, beta.id] }) })).status < 300);
    assert.ok((await a.fetch("/api/routines", { method: "POST", body: JSON.stringify({ targetId: alpha.id, targetKind: "agent", prompt: "Count the flour.", time: "06:00", days: [] }) })).status < 300);
    assert.ok((await a.fetch("/api/watchers", { method: "POST", body: JSON.stringify({ botId: beta.id, kind: "page", target: "http://127.0.0.1:9/menu", instruction: "Say when the menu changes", name: "Menu", every: 60 }) })).status < 300);
    assert.ok((await a.fetch("/api/workflows", { method: "POST", body: JSON.stringify({ name: "Orders", trigger: { kind: "manual" }, steps: [{ action: "ask", text: "Check the orders", targetId: alpha.id }] }) })).status < 300);
    // bigger than a few parts, and nothing gzip can shrink
    const desk = join(mac.data, "workspaces", alpha.id);
    mkdirSync(desk, { recursive: true });
    writeFileSync(join(desk, "photos.bin"), randomBytes(2_400_000));
    macCounts = (await json(`${mac.url}/api/workspace/move`)).body.counts;
    trace(`before: counts ${JSON.stringify(macCounts)}`);
    // the two made here and the one a first start greets with
    assert.equal(macCounts.agents, 3);
    assert.equal(macCounts.rooms, 1);
    assert.equal(macCounts.routines, 1);
    assert.equal(macCounts.watchers, 1);
    assert.equal(macCounts.workflows, 1);
    assert.ok(macCounts.memoryFiles >= 1);
  });

  after(async () => {
    proxy?.stop();
    await mac?.stop();
    await hosted?.stop();
    await relay?.stop();
    for (const dir of [...homes, scratch]) rmSync(dir, { recursive: true, force: true });
  });

  test("to the hosted machine: one with work in it already is refused in a sentence, and nothing changes", async () => {
    const busyHome = home({ backups: { auto: false } });
    homes.push(busyHome);
    const busy = await startHarness({ HOME: busyHome, BLOKS_HOSTED: "1" });
    try {
      const { bots: there } = await busy.json("/api/bots");
      const routine = await busy.fetch("/api/routines", { method: "POST", body: JSON.stringify({ targetId: there[0].id, targetKind: "agent", prompt: "Somebody's own routine.", time: "07:00", days: [] }) });
      assert.ok(routine.status < 300, "a routine of somebody's own is there already");
      assert.equal((await busy.json("/api/workspace/move")).empty, false);
      const move = newMove({ direction: "to-hosted", from: { id: "personal", name: "Personal" }, to: { id: "ws_hosted", name: "Hosted" } });
      trace("refusal to hosted: start");
      const ended = await runMove(move, { source: () => mac.url, target: () => busy.url });
      trace(`refusal to hosted: ${ended.phase} ${ended.error}`);
      assert.equal(ended.phase, "failed");
      assert.equal(ended.code, "not-empty");
      assert.match(ended.error ?? "", /already has work in it, so nothing was moved/);
      // the Mac is as it was: not paused, nothing written out
      const here = (await json(`${mac.url}/api/workspace/move`)).body;
      assert.equal(here.moved, null);
      assert.deepEqual(here.counts, macCounts);
      assert.deepEqual(moveFiles(`${mac.data}-backups`), []);
      const theirs = (await busy.json("/api/workspace/move")).counts;
      assert.equal(theirs.routines, 1, "nothing landed there either");
      assert.equal(theirs.rooms, 0);
    } finally {
      await busy.stop();
    }
  });

  test("to the hosted machine through Bloks Cloud: killed mid-send, it carries on, all of it arrives, no key goes, and the Mac copy stops", async () => {
    const start = newMove({ direction: "to-hosted", from: { id: "personal", name: "Personal" }, to: { id: "ws_hosted", name: "Hosted" } });
    const kept = await killMidSend(start, mac.url, hostedUrl, scratch);
    // paused while it was carried, and still paused after the kill: the
    // move is under way, it just lost its carrier
    assert.equal((await json(`${mac.url}/api/workspace/move`)).body.moved?.pending, true);

    const sent: Buffer[] = [];
    let parts = 0;
    const watching: typeof fetch = async (input, init) => {
      if (init?.method === "PUT" && init.body) {
        parts++;
        sent.push(Buffer.from(init.body as Uint8Array));
      }
      if (init?.body && typeof init.body === "string") sent.push(Buffer.from(init.body));
      const res = await fetch(input, init);
      if (String(input).includes("/part/")) sent.push(Buffer.from(await res.clone().arrayBuffer()));
      return res;
    };
    const steps: string[] = [];
    const done = await runMove(kept, {
      source: () => mac.url,
      target: () => hostedUrl,
      fetch: watching,
      backWithinMs: 180_000,
      save: (m) => {
        if (steps.at(-1) !== m.step) {
          steps.push(m.step);
          trace(`to hosted: ${m.step} ${m.phase} ${m.error ?? ""}`);
        }
      },
    });
    assert.equal(done.phase, "done", done.error ?? "");
    assert.deepEqual(steps.slice(-4), ["sending", "unpacking", "checking", "done"]);
    const all = kept.file!.partDigests.length;
    assert.ok(all >= 6, "big enough to be several parts");
    assert.ok(parts > 0 && parts < all, `it carried on: ${parts} of ${all} parts sent after the kill`);
    assert.ok(hosted.restarts >= 1, "the hosted machine restarted to put it in place");

    // all of it arrived, counted on the other side
    const there = (await json(`${hostedUrl}/api/workspace/move`)).body;
    assert.deepEqual(there.counts, macCounts);
    const { bots } = (await json(`${hostedUrl}/api/bots`)).body;
    for (const name of ["Alpha", "Beta"]) assert.ok(bots.some((b: any) => b.name === name), name);

    // keys stayed behind, named, each with where it is entered again
    const keys = new Map((done.keys ?? []).map((k) => [k.label, k.page]));
    trace(`to hosted: keys ${JSON.stringify(done.keys)}`);
    assert.equal(keys.get("OpenRouter key"), "engines");
    assert.equal(keys.get("Saved secret WEATHER_TOKEN"), "apps");
    assert.equal(keys.get("Composio key"), "apps");
    assert.equal(keys.get("Slack bot token"), "chat");
    assert.equal(keys.get("Slack app token"), "chat");
    assertNoSecrets(sent, `${hosted.data}-backups`);
    const config = JSON.parse(readFileSync(join(hosted.data, "config.json"), "utf8"));
    assert.equal(config.providers?.openrouter?.key, undefined);
    assert.equal(config.relay.agentToken, RELAY_AGENT, "the hosted machine keeps its own Bloks Cloud space");
    assert.equal(config.secrets?.HOSTED_ONLY, HOSTED_SECRET, "and its own keys");

    // the Mac copy stays, marked moved for good, with its file cleared away
    const here = (await json(`${mac.url}/api/workspace/move`)).body;
    assert.equal(here.moved?.to, "hosted");
    assert.equal(here.moved?.pending, false);
    assert.deepEqual(here.counts, macCounts, "never deleted");
    assert.deepEqual(moveFiles(`${mac.data}-backups`), [], "the file carried is cleared away where it was written");

    // nothing runs twice: the routine is due on both copies, and fires on
    // the hosted machine only, the Mac's copy sitting it out
    await mac.around(() => dueNow(mac.data));
    await hosted.around(() => dueNow(hosted.data));
    assert.ok(await until(async () => (await ran(hosted.url)) === 1, 45_000), "the routine fired on the hosted machine");
    await new Promise((r) => setTimeout(r, 7_000));
    assert.equal(await ran(mac.url), 0, "the Mac's copy did not fire it");
    const marked = (await json(`${mac.url}/api/workspace/move`)).body.moved;
    assert.equal(marked?.to, "hosted", "the mark outlives a restart");
  });

  test("to this Mac: a workspace with work in it is refused, unless it is the copy the work came from", async () => {
    const otherHome = home({ backups: { auto: false } });
    homes.push(otherHome);
    const other = await startHarness({ HOME: otherHome });
    try {
      const { bot } = await other.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Somebody" }) });
      assert.ok((await other.fetch("/api/routines", { method: "POST", body: JSON.stringify({ targetId: bot.id, targetKind: "agent", prompt: "Somebody's own routine.", time: "07:00", days: [] }) })).status < 300);
      assert.equal((await other.json("/api/workspace/move")).empty, false);
      const refused = await runMove(newMove({ direction: "to-mac", from: { id: "ws_hosted", name: "Hosted" }, to: { id: "ws_other", name: "Other" } }), {
        source: () => hostedUrl,
        target: () => other.url,
      });
      assert.equal(refused.code, "not-empty");
      assert.match(refused.error ?? "", /Other already has work in it/);
      // asking to replace a workspace that was never moved out is no different
      const still = await runMove(newMove({ direction: "to-mac", from: { id: "ws_hosted", name: "Hosted" }, to: { id: "ws_other", name: "Other" }, replace: true }), {
        source: () => hostedUrl,
        target: () => other.url,
      });
      assert.equal(still.code, "not-empty");
      // the hosted side carries on as it was
      assert.equal((await json(`${hostedUrl}/api/workspace/move`)).body.moved, null);
    } finally {
      await other.stop();
    }
  });

  test("to this Mac through Bloks Cloud: killed mid-send, it carries on, replaces the copy it came from, keeps that copy's keys, and the hosted side is left empty", async () => {
    // work done on the hosted machine since the move, to bring home
    const made = await json(`${hostedUrl}/api/bots`, { method: "POST", body: JSON.stringify({ name: "Gamma" }) });
    assert.ok(made.status < 300, JSON.stringify(made.body));
    const hostedCounts = (await json(`${hostedUrl}/api/workspace/move`)).body.counts;
    assert.equal(hostedCounts.agents, macCounts.agents + 1);

    const start = newMove({ direction: "to-mac", from: { id: "ws_hosted", name: "Hosted" }, to: { id: "personal", name: "Personal" }, replace: true });
    const kept = await killMidSend(start, hostedUrl, mac.url, scratch);
    assert.equal((await json(`${hostedUrl}/api/workspace/move`)).body.moved?.pending, true, "the hosted side is paused while it is carried");

    const sent: Buffer[] = [];
    let parts = 0;
    const watching: typeof fetch = async (input, init) => {
      if (init?.method === "PUT" && init.body) {
        parts++;
        sent.push(Buffer.from(init.body as Uint8Array));
      }
      return fetch(input, init);
    };
    const restartsBefore = mac.restarts;
    const done = await runMove(kept, {
      source: () => hostedUrl,
      target: () => mac.url,
      fetch: watching,
      backWithinMs: 180_000,
      save: (m) => trace(`to mac: ${m.step} ${m.phase} ${m.sent}/${m.size} ${m.error ?? ""}`),
    });
    assert.equal(done.phase, "done", done.error ?? "");
    assert.ok(parts > 0 && parts < kept.file!.partDigests.length, "it carried on from the parts already there");
    assert.ok(mac.restarts > restartsBefore, "the Mac's workspace restarted to put it in place");

    // all of it, and the work done there since
    const here = (await json(`${mac.url}/api/workspace/move`)).body;
    assert.deepEqual(here.counts, hostedCounts);
    assert.equal(here.moved, null, "the copy on this Mac is the live one again");
    const { bots } = (await json(`${mac.url}/api/bots`)).body;
    for (const name of ["Alpha", "Beta", "Gamma"]) assert.ok(bots.some((b: any) => b.name === name), name);

    // no key crossed, and the Mac copy's own keys are still here, so only
    // what it never had is asked for
    assertNoSecrets(sent, `${mac.data}-backups`);
    const config = JSON.parse(readFileSync(join(mac.data, "config.json"), "utf8"));
    assert.equal(config.providers?.openrouter?.key, PROVIDER_KEY);
    assert.equal(config.secrets?.WEATHER_TOKEN, SAVED_SECRET);
    assert.ok(!(done.keys ?? []).some((k) => k.label === "OpenRouter key"), "a key this Mac kept is not asked for again");

    // the hosted machine is left empty, set aside whole there, and up
    assert.ok(await until(async () => (await json(`${hostedUrl}/api/workspace/move`)).body.empty === true, 60_000), "the hosted workspace was emptied");
    const emptied = (await json(`${hostedUrl}/api/workspace/move`)).body;
    assert.equal(emptied.counts.routines, 0);
    assert.equal(emptied.moved, null);
    assert.ok(readdirSync(join(hosted.data, "..")).some((n) => n.startsWith(".bloks-moved-")), "what was there is set aside, not deleted");

    // and the routine fires on this Mac again
    await mac.around(() => dueNow(mac.data));
    assert.ok(await until(async () => (await ran(mac.url)) === 1, 45_000), "the routine fired on the Mac");
    assert.equal(await ran(hosted.url), 0);
  });

  test("stopped part way, or put off, the workspace it leaves runs again as it was", async () => {
    const spareHome = home({ backups: { auto: false } });
    homes.push(spareHome);
    const spare = await startHarness({ HOME: spareHome, BLOKS_HOSTED: "1" });
    try {
      for (const how of ["stopped", "later"] as const) {
        const controller = new AbortController();
        const ended = await runMove(newMove({ direction: "to-hosted", from: { id: "personal", name: "Personal" }, to: { id: "ws_spare", name: "Hosted" } }), {
          source: () => mac.url,
          target: () => spare.url,
          signal: controller.signal,
          lanes: 1,
          onPart: (index) => {
            if (index === 1) controller.abort(how);
          },
        });
        assert.equal(ended.phase, how);
        assert.equal(ended.held, false);
        assert.equal(ended.file, null, "what was written out is not the workspace any more, and goes");
        const here = (await json(`${mac.url}/api/workspace/move`)).body;
        assert.equal(here.moved, null, "running again");
        assert.deepEqual(moveFiles(`${mac.data}-backups`), []);
        assert.equal((await json(`${spare.url}/api/workspace/move`)).body.empty, true, "nothing was put in place there");
      }
    } finally {
      await spare.stop();
    }
  });

  test("counts that do not match where it landed: the move is taken back out there, and the workspace it left carries on", async () => {
    const spareHome = home({ backups: { auto: false } });
    homes.push(spareHome);
    const spare = await supervised(spareHome, { BLOKS_HOSTED: "1" });
    try {
      const before = (await json(`${mac.url}/api/workspace/move`)).body.counts;
      // the other side miscounts once the workspace is in place there
      const miscounting: typeof fetch = async (input, init) => {
        const res = await fetch(input, init);
        if (!String(input).startsWith(spare.url) || !String(input).endsWith("/api/workspace/move") || (init?.method ?? "GET") !== "GET") return res;
        const body = await res.json();
        if (body.lastRestore?.from?.includes("-move-in")) body.counts = { ...body.counts, agents: body.counts.agents - 1 };
        return new Response(JSON.stringify(body), { status: res.status, headers: { "content-type": "application/json" } });
      };
      const ended = await runMove(newMove({ direction: "to-hosted", from: { id: "personal", name: "Personal" }, to: { id: "ws_spare", name: "Hosted" } }), {
        source: () => mac.url,
        target: () => spare.url,
        fetch: miscounting,
        backWithinMs: 180_000,
      });
      assert.equal(ended.phase, "failed");
      assert.match(ended.error ?? "", /^Not everything arrived \(\d+ of \d+ agents\), so the move was taken back and Personal carries on where it was\. Try again\.$/);
      // taken back out there: the workspace from before the move, in place
      const there = (await json(`${spare.url}/api/workspace/move`)).body;
      assert.equal(there.empty, true);
      assert.ok(!there.lastRestore?.from.includes("-move-in"), "the copy from before the move is what is there now");
      // and here, running as it was, with nothing left over
      const here = (await json(`${mac.url}/api/workspace/move`)).body;
      assert.equal(here.moved, null);
      assert.deepEqual(here.counts, before);
      assert.deepEqual(moveFiles(`${mac.data}-backups`), []);
    } finally {
      await spare.stop();
    }
  });
});
