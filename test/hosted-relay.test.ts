// A hosted workspace from its owner's side, end to end: the real server in
// hosted mode, a stand-in for Bloks Cloud just real enough to carry asks,
// answers and frames, and the desktop app's own stand-in server
// (electron/remote.mjs) in front of it.
//
// What this holds shut: a hosted workspace taking the Mac's workspace id
// at Bloks Cloud; nobody but the licence's holder getting a pairing link
// out of it, and the link being readable on the way; a Mac handing one
// out at all; the terminal and the desktop, which are a live stream and a
// live socket rather than a request and its answer, not reaching the
// owner's app; a terminal reaching anybody's device but the one that
// opened it, or any device at all on a Mac; and a large request being cut
// in two on the line.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claimPairLink, deviceKeys, startRemoteProxy } from "../electron/remote.mjs";
import { readOwnerLink, requesterKey } from "../server/owner-link.ts";
import { deviceKey, open, peek, seal } from "../server/relay-crypto.ts";
import { startHarness, type Harness } from "./helpers/server.ts";

const KEY = `blok_live_${"5e".repeat(16)}`;

async function until<T>(check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const got = await check();
    if (got) return got as T;
    await new Promise((r) => setTimeout(r, 40));
  }
  return undefined;
}

const listen = (server: Server) =>
  new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));

/** Bloks Cloud, just real enough: a space, the host's line, asks and their
 * answers, frames fanned out to every device's stream, and what the host
 * said about its next routine. */
function miniRelay() {
  let host: ((frame: unknown) => void) | null = null;
  const results = new Map<string, { status: number; payload: string }>();
  const listeners = new Set<ServerResponse>();
  const spaces: Array<Record<string, unknown>> = [];
  const nextDue: Array<{ at: unknown }> = [];
  const frames: string[] = [];
  let asks = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (path === "/space/agent/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      host = (frame) => res.write(`data: ${JSON.stringify(frame)}\n\n`);
      host({ kind: "hello", spaceId: "space-hosted" });
      req.on("close", () => (host = null));
      return;
    }
    if (path === "/space/client/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ kind: "hello", online: true })}\n\n`);
      listeners.add(res);
      req.on("close", () => listeners.delete(res));
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const parsed = body ? JSON.parse(body) : {};
      if (path === "/spaces") {
        spaces.push(parsed);
        return reply(201, { spaceId: "space-hosted", agentToken: "agent-token", clientToken: "client-token" });
      }
      if (path === "/space/agent/result") {
        results.set(String(parsed.id), { status: Number(parsed.status), payload: String(parsed.payload ?? "") });
        return reply(200, { ok: true });
      }
      if (path === "/space/agent/events") {
        for (const frame of parsed.frames ?? []) {
          frames.push(frame);
          for (const listener of listeners) listener.write(`data: ${JSON.stringify({ kind: "frame", payload: frame })}\n\n`);
        }
        return reply(200, { delivered: listeners.size });
      }
      if (path === "/space/agent/next-due") {
        nextDue.push(parsed);
        return reply(200, { ok: true });
      }
      if (path === "/space/client/ask") {
        const id = `client-${++asks}`;
        host?.({ kind: "ask", id, payload: parsed.payload });
        const answer = await until(() => results.get(id), 20_000);
        return answer ? reply(200, answer) : reply(504, { error: "no answer" });
      }
      reply(200, {});
    });
  });
  return {
    server,
    get connected() {
      return host !== null;
    },
    ask: (id: string, payload: string) => host?.({ kind: "ask", id, payload }),
    answer: (id: string) => until(() => results.get(id)),
    spaces,
    nextDue,
    frames,
  };
}

/** noVNC as the image serves it: a page, and a socket that echoes. */
function fakeViewer() {
  const asked: IncomingMessage["headers"][] = [];
  const server = createServer((req, res) => {
    asked.push(req.headers);
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>noVNC</title>");
  });
  server.on("upgrade", (req, socket) => {
    asked.push(req.headers);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (chunk) => socket.write(Buffer.concat([Buffer.from("echo:"), chunk])));
  });
  return { server, asked };
}

/** The machine's one public port, as the image runs it: the viewer's
 * ticketed paths passed to the server as they came, socket and all. */
function fakeDoor() {
  let target = 0;
  const server = createServer((req, res) => {
    const upstream = httpRequest({ host: "127.0.0.1", port: target, path: req.url, method: req.method, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => res.writeHead(502).end());
    upstream.end();
  });
  server.on("upgrade", (req, socket, head) => {
    const upstream = connect(target, "127.0.0.1", () => {
      const lines = [`GET ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  return { server, aim: (port: number) => (target = port) };
}

/** A question for a pairing link as Bloks Cloud puts it to the machine. */
function linkQuestion(licence: string, key: string, at = Date.now()) {
  const mac = createHmac("sha256", licence).update(`bloks-hosted-link-v1:${key}:${at}`).digest("hex");
  return `pair-link:${JSON.stringify({ key, at, mac })}`;
}

/** The text of an SSE response as it arrives. */
function readStream(res: Response) {
  let text = "";
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      text += decoder.decode(value, { stream: true });
    }
  })();
  return { get text() {
    return text;
  }, stop: () => reader.cancel().catch(() => {}) };
}

/** Everything a terminal stream's frames wrote to the screen. */
function screenOf(sse: string): string {
  let out = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const frame = JSON.parse(line.slice(5).trim());
      if (typeof frame.b64 === "string") out += Buffer.from(frame.b64, "base64").toString("utf8");
    } catch {
      /* a keepalive */
    }
  }
  return out;
}

describe("a hosted workspace, from its owner's side", () => {
  const relay = miniRelay();
  const viewer = fakeViewer();
  const door = fakeDoor();
  const ui = mkdtempSync(join(tmpdir(), "bloks-hosted-ui-"));
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>Bloks</title>");
  let h: Harness;
  let relayUrl = "";
  let doorUrl = "";
  let owner: Awaited<ReturnType<typeof claimPairLink>>;
  let proxy: Awaited<ReturnType<typeof startRemoteProxy>> | null = null;

  before(async () => {
    relayUrl = `http://127.0.0.1:${await listen(relay.server)}`;
    const viewerPort = await listen(viewer.server);
    doorUrl = `http://127.0.0.1:${await listen(door.server)}`;
    h = await startHarness({
      BLOKS_HOSTED: "1",
      BLOKS_LOOPBACK_ONLY: "1",
      BLOKS_RELAY_URL: relayUrl,
      BLOKS_WORKSPACE_ID: "hosted",
      BLOKS_HOSTED_VNC: `http://127.0.0.1:${viewerPort}/`,
      BLOKS_PUBLIC_URL: doorUrl,
    });
    door.aim(Number(new URL(h.url).port));
    const activated = await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: KEY }) });
    assert.equal(activated.status, 200);
    assert.ok(await until(() => relay.connected), "the machine dialled Bloks Cloud");
  });

  after(async () => {
    proxy?.stop();
    await h?.stop();
    for (const server of [relay.server, viewer.server, door.server]) {
      server.closeAllConnections();
      server.close();
    }
    rmSync(ui, { recursive: true, force: true });
  });

  test("it activates as its own workspace, never the Mac's Personal", () => {
    assert.deepEqual(relay.spaces, [{ workspaceId: "hosted" }]);
  });

  test("a question signed with the licence gets a link sealed for the app that asked, and the link pairs the owner's app", async () => {
    const asker = requesterKey();
    relay.ask("link-1", linkQuestion(KEY, asker.key));
    const answered = await relay.answer("link-1");
    assert.equal(answered?.status, 200);
    assert.ok(!answered!.payload.includes("pair#"), "nothing of the link is readable at Bloks Cloud");
    const made = readOwnerLink(asker.open(JSON.parse(answered!.payload)));
    assert.ok(made, "the app that asked can open it");
    const fragment = JSON.parse(Buffer.from(made!.link.split("#")[1], "base64url").toString("utf8"));
    assert.equal(fragment.k, "pair");
    assert.equal(fragment.hosted, true, "a hosted workspace's link says so, for the app to name it before pairing");
    assert.equal(fragment.r, relayUrl);
    assert.equal(fragment.t, "client-token");
    assert.ok(made!.expiresAt > Date.now());

    // spent by the desktop app, the way it spends any pairing link
    owner = await claimPairLink(made!.link, "Owner's Mac (desktop)");
    assert.equal(owner.relayUrl, relayUrl);
    const paired = await h.json("/api/pair");
    assert.ok(paired.devices.some((d: { id: string; name: string }) => d.id === owner.deviceId && d.name === "Owner's Mac (desktop)"));
  });

  test("a question not signed with the licence, a stale one, or the same one twice, is refused with nothing in it", async () => {
    const asker = requesterKey();
    relay.ask("bad-1", linkQuestion(`blok_live_${"00".repeat(16)}`, asker.key));
    relay.ask("bad-2", linkQuestion(KEY, asker.key, Date.now() - 10 * 60_000));
    const question = linkQuestion(KEY, asker.key);
    relay.ask("once", question);
    assert.equal((await relay.answer("once"))?.status, 200);
    relay.ask("twice", question);
    for (const id of ["bad-1", "bad-2", "twice"]) {
      const answered = await relay.answer(id);
      assert.equal(answered?.status, 401, id);
      assert.equal(answered?.payload, "", `${id}: not even ciphertext`);
    }
  });

  test("the owner's app opens a terminal there and follows it through Bloks Cloud, sealed for that app alone", async () => {
    // a second device of the owner's, which must never be sent the stream
    const asker = requesterKey();
    relay.ask("link-2", linkQuestion(KEY, asker.key));
    const second = await claimPairLink(readOwnerLink(asker.open(JSON.parse((await relay.answer("link-2"))!.payload)))!.link, "Owner's phone");
    const firstFrame = relay.frames.length;

    proxy = await startRemoteProxy(owner, { staticDir: ui });
    const base = `http://127.0.0.1:${proxy.port}`;
    const call = (path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const made = await call("/api/bots", { name: "Hal" });
    assert.ok(made.ok, `an agent is made there (${made.status})`);
    const { bot } = await made.json();
    const opened = await call(`/api/bots/${bot.id}/terminals`, { cols: 80, rows: 24 });
    assert.equal(opened.status, 200, "a hosted workspace's owner may open its shell");
    const { terminal } = await opened.json();

    const res = await fetch(`${base}/api/bots/${bot.id}/terminals/stream`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const stream = readStream(res);
    try {
      assert.ok(await until(() => stream.text.includes('"list"')), "the tabs arrive");
      assert.equal((await call(`/api/bots/${bot.id}/terminals/${terminal.id}/input`, { data: "echo hosted-$((40+2))\n" })).status, 200);
      assert.ok(await until(() => screenOf(stream.text).includes("hosted-42"), 15_000), `the output arrives: ${stream.text.slice(-600)}`);
    } finally {
      await stream.stop();
    }

    // every frame of the stream was sealed for the app that opened it
    const theirs = deviceKeys(second.deviceToken);
    for (const frame of relay.frames.slice(firstFrame)) {
      const envelope = peek(frame);
      if (envelope?.d !== second.deviceId) continue;
      const opened = open(theirs.open, envelope) as { kind?: string } | null;
      assert.notEqual(opened?.kind, "stream", "another device was sent the terminal");
    }
  });

  test("the desktop opens in the owner's app through the door its ticket names, page and socket", async () => {
    proxy ??= await startRemoteProxy(owner, { staticDir: ui });
    const base = `http://127.0.0.1:${proxy.port}`;
    const minted = await fetch(`${base}/api/hosted/desktop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(minted.status, 200);
    const { url, door: named } = await minted.json();
    assert.equal(named, doorUrl);
    const page = await fetch(`${base}${url}`, { headers: { cookie: "session=owner" } });
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "<title>noVNC</title>");
    assert.equal(viewer.asked.at(-1)?.cookie, undefined, "nothing of the window's is passed along");

    const ticket = /desktop\/([0-9a-f]{48})\//.exec(url)![1];
    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = connect(proxy!.port, "127.0.0.1", () => {
        socket.write(
          `GET /hosted/desktop/${ticket}/websockify HTTP/1.1\r\nHost: 127.0.0.1:${proxy!.port}\r\nOrigin: ${base}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      let got = "";
      socket.on("data", (chunk) => {
        got += chunk.toString();
        if (got.includes("\r\n\r\n") && !got.includes("echo:")) socket.write("ping");
        if (got.includes("echo:ping")) {
          socket.destroy();
          resolve(got);
        }
      });
      socket.on("error", reject);
      setTimeout(() => reject(new Error(`no echo: ${got}`)), 8_000);
    });
    assert.match(echoed, /^HTTP\/1\.1 101/);

    // a ticket this window was never given goes nowhere
    assert.equal((await fetch(`${base}/hosted/desktop/${"a".repeat(48)}/vnc.html`)).status, 404);
  });

  test("an ask bigger than a megabyte reaches the machine whole", async () => {
    const begun = await h.json("/api/workspace/move/upload", { method: "POST", body: JSON.stringify({ size: 1_000_000 }) });
    const keys = deviceKeys(owner.deviceToken);
    const big = randomBytes(700_000).toString("base64");
    const request = { method: "PUT", path: `/api/workspace/move/upload/${begun.id}/0`, raw: true, bodyB64: big, type: "application/octet-stream", ts: Date.now(), nonce: "big-1" };
    const payload = seal(keys.seal, owner.deviceId, request);
    assert.ok(payload.length > 1_200_000, "bigger than the line's old limit");
    relay.ask("big", payload);
    const answered = await relay.answer("big");
    assert.ok(answered, "answered at all, so it arrived in one piece");
    const reply = open(keys.open, peek(answered!.payload)!) as { status: number };
    assert.equal(reply.status, 413, "and was read whole: too big to be a part");
  });

  test("the machine tells Bloks Cloud when its next routine is due", async () => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Early" }) });
    const made = await h.fetch("/api/routines", { method: "POST", body: JSON.stringify({ targetId: bot.id, targetKind: "agent", prompt: "Count.", time: "06:00", days: [] }) });
    assert.ok(made.status < 300);
    const said = await until(() => relay.nextDue.find((n) => typeof n.at === "number"), 20_000);
    assert.ok(said, "the next due time was said");
    assert.ok((said!.at as number) > Date.now() - 60_000);
  });
});

describe("on a Mac", () => {
  const relay = miniRelay();
  let h: Harness;

  before(async () => {
    const relayUrl = `http://127.0.0.1:${await listen(relay.server)}`;
    h = await startHarness({ BLOKS_RELAY_URL: relayUrl });
    await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
    assert.equal((await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: KEY }) })).status, 200);
    assert.ok(await until(() => relay.connected));
  });

  after(async () => {
    await h?.stop();
    relay.server.closeAllConnections();
    relay.server.close();
  });

  test("a link made at the Mac does not say hosted", async () => {
    const made = await h.json("/api/pair/link", { method: "POST" });
    const fragment = JSON.parse(Buffer.from(String(made.link).split("#")[1], "base64url").toString("utf8"));
    assert.equal(fragment.k, "pair");
    assert.equal("hosted" in fragment, false);
  });

  test("even a question signed with the licence gets no link: a Mac's owner pairs at the Mac", async () => {
    relay.ask("mac-link", linkQuestion(KEY, requesterKey().key));
    const answered = await relay.answer("mac-link");
    assert.equal(answered?.status, 404);
    assert.equal(answered?.payload, "");
  });

  test("a paired device gets no terminal through Bloks Cloud, and no stream of one", async () => {
    const started = await h.json("/api/pair/start", { method: "POST" });
    const claimed = await h.json("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "A phone" }) });
    const digest = createHash("sha256").update(claimed.token as string).digest("hex");
    const sealKey = deviceKey(digest, "phone-to-mac");
    const openKey = deviceKey(digest, "mac-to-phone");
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Mac agent" }) });
    relay.ask("term", seal(sealKey, claimed.device.id, { method: "POST", path: `/api/bots/${bot.id}/terminals`, body: {}, ts: Date.now(), nonce: "t-1" }));
    relay.ask(
      "follow",
      seal(sealKey, claimed.device.id, { method: "POST", path: "/api/relay/streams", body: { path: `/api/bots/${bot.id}/terminals/stream` }, ts: Date.now(), nonce: "t-2" }),
    );
    for (const id of ["term", "follow"]) {
      const answered = await relay.answer(id);
      assert.equal((open(openKey, peek(answered!.payload)!) as { status: number }).status, 403, id);
    }
  });
});
