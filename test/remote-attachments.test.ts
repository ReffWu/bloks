// A file attached in the Mac app reaches the server the conversation lives
// on (GitHub 332). With the app's own server, a file goes by its path, as
// it always has. Connected to a server elsewhere, a path on this Mac names
// nothing there, so the file itself is sent, in parts small enough to
// cross Bloks Cloud, and the message names where it landed on that
// server. One too big to send is refused in words, never passed on as a
// path nobody can open.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, test } from "node:test";

import { startRemoteProxy } from "../electron/remote.mjs";
import { allows } from "../server/agent-cli.ts";
import {
  composeOutgoing,
  destination,
  intakeFiles,
  sendInParts,
  uploadFileAttachment,
  uploadImageAttachment,
  type FileAttachment,
} from "../src/lib/attachments.ts";
import { sealedRelay } from "./helpers/sealed-relay.ts";
import { startHarness } from "./helpers/server.ts";

const MAC_PATH = "/Users/someone/Downloads/Q3 budget.xlsx";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const png = (size: number) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(size - 8)]);

describe("the composer's intake", () => {
  const sheet = new File([randomBytes(2048)], "Q3 budget.xlsx", { type: XLSX });
  const sent: string[] = [];
  const uploadFile = async (file: File): Promise<FileAttachment> => {
    sent.push(file.name);
    return { kind: "file", id: "f1", path: `/home/server/.bloks/attachments/u1/${file.name}`, name: file.name, bytes: file.size };
  };

  test("with the app's own server, a file goes by its path and nothing is sent", async () => {
    sent.length = 0;
    const { attachments, refused } = await intakeFiles([sheet], { pathOf: () => MAC_PATH, uploadImage: async () => null, uploadFile, sameComputer: true });
    assert.equal(refused, null);
    assert.deepEqual(attachments.map((a) => (a as FileAttachment).path), [MAC_PATH]);
    assert.deepEqual(sent, []);
  });

  test("with a server elsewhere, the file is sent and the message names where it landed, never the Mac's path", async () => {
    sent.length = 0;
    const sending: string[] = [];
    const { attachments, refused } = await intakeFiles([sheet], {
      pathOf: () => MAC_PATH,
      uploadImage: async () => null,
      uploadFile,
      sameComputer: async () => false,
      onSending: (file) => sending.push(file.name),
    });
    assert.equal(refused, null);
    assert.deepEqual(sent, ["Q3 budget.xlsx"]);
    assert.deepEqual(sending, ["Q3 budget.xlsx"]);
    const prompt = composeOutgoing("what changed?", attachments);
    assert.match(prompt, /<attached-file path="\/home\/server\/\.bloks\/attachments\/u1\/Q3 budget\.xlsx" \/>/);
    assert.doesNotMatch(prompt, /\/Users\/someone/);
  });

  test("a small text drop with no path keeps its words inline here, and is sent to a server elsewhere", async () => {
    const note = new File(["line one\nline two"], "note.txt", { type: "text/plain" });
    const here = await intakeFiles([note], { pathOf: () => "", uploadImage: async () => null, uploadFile, sameComputer: true });
    assert.equal(here.attachments[0]?.kind, "paste");
    sent.length = 0;
    const there = await intakeFiles([note], { pathOf: () => "", uploadImage: async () => null, uploadFile, sameComputer: false });
    assert.equal(there.attachments[0]?.kind, "file");
    assert.deepEqual(sent, ["note.txt"]);
    // a file with no path and no words to inline is sent, not refused
    const clip = new File([randomBytes(64)], "clip.mp4", { type: "video/mp4" });
    const pathless = await intakeFiles([clip], { pathOf: () => "", uploadImage: async () => null, uploadFile, sameComputer: true });
    assert.equal(pathless.refused, null);
    assert.equal(pathless.attachments[0]?.kind, "file");
  });

  test("a file too big to send is refused in words before anything goes, and nothing is passed as a path", async () => {
    const asked: string[] = [];
    const fetcher = async (path: string) => {
      asked.push(path);
      return new Response(JSON.stringify({ sameComputer: false, partBytes: 1024, fileMaxBytes: 4096, imageMaxBytes: 4096 }), { status: 200 });
    };
    const big = new File([randomBytes(5000)], "Q3 budget.xlsx", { type: XLSX });
    const { attachments, refused } = await intakeFiles([big], {
      pathOf: () => MAC_PATH,
      uploadImage: async () => null,
      uploadFile: (file) => uploadFileAttachment(file, fetcher),
      sameComputer: async () => (await destination(fetcher)).sameComputer,
    });
    assert.deepEqual(attachments, []);
    assert.equal(refused, "Q3 budget.xlsx: it is 4.9 KB, and a file sent to the computer this workspace runs on can be 4.0 KB at most");
    assert.ok(asked.every((path) => path === "/api/attachments/where"), "an upload began anyway");
  });
});

test("the server takes a file in parts and keeps it under its own name; the person's devices only", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const fetcher = (path: string, init?: RequestInit) => h.fetch(path, init);
  assert.equal((await destination(fetcher)).sameComputer, true, "the app's own window is on this computer");

  // a few parts, the last a short one
  const bytes = randomBytes(1_000_000);
  const kept = await sendInParts(new File([bytes], "Q3 budget.xlsx", { type: XLSX }), { fetcher, partBytes: 384 * 1024 });
  assert.equal(kept.kind, "file");
  assert.equal(basename(kept.path), "Q3 budget.xlsx");
  assert.equal(dirname(dirname(kept.path)), join(h.home, ".bloks", "attachments"));
  assert.deepEqual(readFileSync(kept.path), bytes);
  // a file in a folder of its own is never served back by name
  assert.equal((await h.fetch(`/api/attachments/${basename(dirname(kept.path))}`)).status, 404);

  // a name that would be a path is only a name
  const odd = await sendInParts(new File(["x"], "../../.ssh/authorized_keys", { type: "text/plain" }), { fetcher, partBytes: 384 * 1024 });
  assert.equal(basename(odd.path), "authorized_keys");
  assert.equal(dirname(dirname(odd.path)), join(h.home, ".bloks", "attachments"));

  // an image goes where a pasted one does, named by what it really is
  const image = png(500_000);
  const shot = await sendInParts(new File([image], "shot.png", { type: "image/png" }), { fetcher, partBytes: 384 * 1024 });
  assert.equal(shot.kind, "image");
  assert.match(basename(shot.path), /^[0-9a-f-]{36}\.png$/);
  assert.deepEqual(Buffer.from(await (await h.fetch(`/api/attachments/${basename(shot.path)}`)).arrayBuffer()), image);
  const fake = await h.json("/api/attachments/uploads", { method: "POST", body: JSON.stringify({ name: "x.png", size: 4, type: "image/png" }) });
  await h.fetch(`/api/attachments/uploads/${fake.id}/0`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: "abcd" });
  assert.equal((await h.fetch(`/api/attachments/uploads/${fake.id}/finish`, { method: "POST" })).status, 415);

  // the limits, said at the start rather than after the bytes
  const huge = await h.fetch("/api/attachments/uploads", { method: "POST", body: JSON.stringify({ name: "a.mov", size: 21 * 1024 * 1024, type: "video/quicktime" }) });
  assert.equal(huge.status, 413);
  assert.match((await huge.json()).error, /20 MB/);
  assert.equal((await h.fetch("/api/attachments/uploads", { method: "POST", body: JSON.stringify({ name: "a.png", size: 11 * 1024 * 1024, type: "image/png" }) })).status, 413);
  assert.equal((await h.fetch("/api/attachments/uploads", { method: "POST", body: JSON.stringify({ name: "empty", size: 0 }) })).status, 400);
  // a part out of place, a short one, and finishing early
  const started = await h.json("/api/attachments/uploads", { method: "POST", body: JSON.stringify({ name: "b.bin", size: 500_000 }) });
  const put = (n: string, body: Uint8Array<ArrayBuffer>) => h.fetch(`/api/attachments/uploads/${started.id}/${n}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body });
  assert.equal((await put("9", new Uint8Array(10))).status, 400);
  assert.equal((await put("0", new Uint8Array(10))).status, 400);
  assert.equal((await put("0", new Uint8Array(started.partSize))).status, 200);
  assert.equal((await h.fetch(`/api/attachments/uploads/${started.id}/finish`, { method: "POST" })).status, 409);
  assert.deepEqual(await (await h.fetch(`/api/attachments/uploads/${started.id}`, { method: "DELETE" })).json(), { ok: true });
  assert.equal((await put("1", new Uint8Array(500_000 - started.partSize))).status, 404);
  // nothing is left gathering once every upload is done or called off
  await h.json("/api/attachments/uploads", { method: "POST", body: JSON.stringify({ name: "c.bin", size: 1 }) }).then((u) =>
    h.fetch(`/api/attachments/uploads/${u.id}`, { method: "DELETE" }),
  );
  await h.json("/api/attachments/uploads", { method: "POST", body: JSON.stringify({ name: "d.bin", size: 1 }) }).then((u) =>
    h.fetch(`/api/attachments/uploads/${u.id}`, { method: "DELETE" }),
  );
  assert.deepEqual(readdirSync(join(h.home, ".bloks", "attachments", ".incoming")), []);

  // never an agent's: a turn has no business posting files as the person
  assert.equal(allows("ada", "POST", "/api/attachments/uploads").ok, false);
  assert.equal(allows("ada", "GET", "/api/attachments/where").ok, false);
  // and nothing from the network while nothing is paired
  assert.equal((await h.fetchRemote("/api/attachments/where")).status, 403);
});

test("the Mac app on a workspace elsewhere, through the relay: a spreadsheet and an image arrive, and the message carries the server's path", { timeout: 120_000 }, async (t) => {
  const relay = await sealedRelay();
  const files = mkdtempSync(join(tmpdir(), "bloks-remote-attach-"));
  writeFileSync(join(files, "index.html"), "<!doctype html><title>Fixture</title>");
  // an owner's device and the relay, seeded, and a server that answers
  // only on loopback, as bloks-server does
  const h = await startHarness({
    NODE_OPTIONS: `--import=${new URL("./helpers/settings-app-preload.mjs", import.meta.url).href}`,
    BLOKS_SETTINGS_TEST_TRACE: join(files, "trace.json"),
    BLOKS_SETTINGS_TEST_RELAY: relay.url,
    BLOKS_LOOPBACK_ONLY: "1",
  });
  await relay.connection;
  const app = await startRemoteProxy(
    { relayUrl: relay.url, relayToken: "fixture-relay-client", deviceId: "owner-device", deviceToken: "fixture-owner" },
    { staticDir: files, client: "macOS 3.0" },
  );
  t.after(async () => {
    app.stop();
    await h.stop();
    await relay.stop();
    rmSync(files, { recursive: true, force: true });
  });
  const fetcher = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${app.port}${path}`, init);

  const where = await destination(fetcher);
  assert.equal(where.sameComputer, false, "a path on this Mac was taken for one the server can open");

  // bigger than one request through Bloks Cloud can carry
  const bytes = randomBytes(1_500_000);
  const sheet = new File([bytes], "Q3 budget.xlsx", { type: XLSX });
  const shot = png(900_000);
  const image = new File([shot], "chart.png", { type: "image/png" });
  const { attachments, refused } = await intakeFiles([sheet, image], {
    // the desktop app hands over the file's path on this Mac
    pathOf: (file) => `/Users/someone/Downloads/${file.name}`,
    uploadImage: (file) => uploadImageAttachment(file, fetcher),
    uploadFile: (file) => uploadFileAttachment(file, fetcher),
    sameComputer: async () => (await destination(fetcher)).sameComputer,
  });
  assert.equal(refused, null);
  assert.deepEqual(attachments.map((a) => a.kind), ["file", "image"]);
  const [file, picture] = attachments as Array<{ path: string; name: string }>;
  assert.equal(file.name, "Q3 budget.xlsx");
  assert.ok(file.path.startsWith(join(h.home, ".bloks", "attachments")), file.path);
  assert.ok(existsSync(file.path));
  assert.deepEqual(readFileSync(file.path), bytes);
  assert.deepEqual(readFileSync(picture.path), shot);
  const prompt = composeOutgoing("see attached", attachments);
  assert.ok(prompt.includes(`<attached-file path="${file.path}" />`), prompt);
  assert.doesNotMatch(prompt, /\/Users\/someone/);

  // too big for the server is said before a byte is sent
  const huge = await intakeFiles([new File([new Uint8Array(21 * 1024 * 1024)], "film.mov", { type: "video/quicktime" })], {
    pathOf: () => "/Users/someone/Movies/film.mov",
    uploadImage: async () => null,
    uploadFile: (f) => uploadFileAttachment(f, fetcher),
    sameComputer: false,
  });
  assert.deepEqual(huge.attachments, []);
  assert.match(huge.refused ?? "", /^film\.mov: it is 21\.0 MB, and a file sent to the computer this workspace runs on can be 20\.0 MB at most$/);
});
