// A workspace file arriving in parts (server/move-upload.ts), which is
// how a move reaches a workspace through Bloks Cloud: parts in any order,
// a part sent twice, a send that stops and carries on, and nothing handed
// over until every byte is there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MoveUploads, PART_BYTES, UPLOAD_IDLE_MS, UploadError } from "../server/move-upload.ts";
import { MAX_REQUEST_BYTES } from "../electron/remote.mjs";
import { startHarness } from "./helpers/server.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bloks-uploads-"));
  let now = 1_000_000;
  const uploads = new MoveUploads({ dir: () => dir, maxBytes: 10 * PART_BYTES, now: () => now });
  return { dir, uploads, later: (ms: number) => (now += ms), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const parts = (file: Buffer) => Array.from({ length: Math.ceil(file.length / PART_BYTES) }, (_, i) => file.subarray(i * PART_BYTES, (i + 1) * PART_BYTES));

test("a part, sealed and wrapped for Bloks Cloud, stays well inside what one request carries", () => {
  // three base64 passes and a little JSON: about 2.4 times the bytes
  assert.ok(PART_BYTES * 2.4 < 1_000_000, "under a megabyte on the line, as the relay's stream likes it");
  assert.ok(PART_BYTES < MAX_REQUEST_BYTES, "and under what the app's stand-in will forward");
});

test("parts in any order, one twice, make the file exactly, and only when all are there", (t) => {
  const s = setup();
  t.after(s.done);
  const file = randomBytes(2 * PART_BYTES + 1234);
  const { id, parts: count, partSize } = s.uploads.start(file.length);
  assert.equal(count, 3);
  assert.equal(partSize, PART_BYTES);
  const [a, b, c] = parts(file);
  s.uploads.put(id, 2, c);
  s.uploads.put(id, 0, a);
  s.uploads.put(id, 0, a);
  assert.deepEqual(s.uploads.status(id)?.missing, [1]);
  const to = join(s.dir, "arrived.tar.gz");
  assert.throws(() => s.uploads.finish(id, to), (e: unknown) => e instanceof UploadError && e.status === 409);
  assert.equal(existsSync(to), false, "nothing handed over half done");
  assert.deepEqual(s.uploads.put(id, 1, b), { received: 3, parts: 3 });
  s.uploads.finish(id, to);
  assert.ok(readFileSync(to).equals(file));
  assert.equal(s.uploads.status(id), null, "finished is gone from the uploads");
});

test("a part of the wrong size, or a number that is not one of them, is refused and changes nothing", (t) => {
  const s = setup();
  t.after(s.done);
  const { id } = s.uploads.start(PART_BYTES + 10);
  assert.throws(() => s.uploads.put(id, 0, Buffer.alloc(10)), (e: unknown) => e instanceof UploadError && e.status === 400);
  assert.throws(() => s.uploads.put(id, 1, Buffer.alloc(11)), (e: unknown) => e instanceof UploadError && e.status === 400);
  assert.throws(() => s.uploads.put(id, 2, Buffer.alloc(10)), (e: unknown) => e instanceof UploadError && e.status === 400);
  assert.throws(() => s.uploads.put("up_nothing_here", 0, Buffer.alloc(10)), (e: unknown) => e instanceof UploadError && e.status === 404);
  assert.deepEqual(s.uploads.status(id)?.missing, [0, 1]);
});

test("a size it cannot take is refused before anything is written", (t) => {
  const s = setup();
  t.after(s.done);
  for (const size of [0, -1, 1.5, "10"]) assert.throws(() => s.uploads.start(size), (e: unknown) => e instanceof UploadError && e.status === 400);
  assert.throws(() => s.uploads.start(11 * PART_BYTES), (e: unknown) => e instanceof UploadError && e.status === 413);
  assert.deepEqual(readdirSync(s.dir), []);
});

test("one at a time: a new upload sets the last aside, and one left alone for a day is cleared", (t) => {
  const s = setup();
  t.after(s.done);
  const first = s.uploads.start(100);
  const second = s.uploads.start(100);
  assert.equal(s.uploads.status(first.id), null);
  assert.ok(s.uploads.status(second.id));
  s.later(UPLOAD_IDLE_MS - 1);
  assert.equal(s.uploads.clear(true), 0);
  s.later(2);
  assert.equal(s.uploads.clear(true), 1);
  assert.deepEqual(readdirSync(s.dir), []);
});

test("through the server: parts carry on after a stop, a file that is not a move is refused at the end and kept to try again", async (t) => {
  const h = await startHarness({ BLOKS_HOSTED: "1" });
  t.after(() => h.stop());
  const status = await h.json("/api/workspace/move");
  assert.equal(status.partSize, PART_BYTES, "the app is told it may send in parts");

  const file = randomBytes(2 * PART_BYTES + 99);
  const begun = await h.fetch("/api/workspace/move/upload", { method: "POST", body: JSON.stringify({ size: file.length }) });
  assert.equal(begun.status, 201);
  const { id, parts: count } = await begun.json();
  assert.equal(count, 3);
  const put = (i: number, body: Buffer) =>
    h.fetch(`/api/workspace/move/upload/${id}/${i}`, { method: "PUT", body: new Uint8Array(body), headers: { "content-type": "application/octet-stream" } });
  const [a, b, c] = parts(file);
  assert.equal((await put(0, a)).status, 200);
  assert.equal((await put(2, c)).status, 200);
  // the send stopped here; asked again, the server says what is left
  assert.deepEqual((await h.json(`/api/workspace/move/upload/${id}`)).missing, [1]);
  const early = await h.fetch(`/api/workspace/move/upload/${id}/finish`, { method: "POST" });
  assert.equal(early.status, 409);
  assert.equal((await put(1, Buffer.alloc(5))).status, 400, "a part the wrong size");
  assert.equal((await put(1, b)).status, 200);
  const finished = await h.fetch(`/api/workspace/move/upload/${id}/finish`, { method: "POST" });
  assert.ok(finished.status >= 400 && finished.status < 500 && finished.status !== 409, `random bytes are not a workspace (${finished.status})`);
  assert.ok((await h.json(`/api/workspace/move/upload/${id}`)).missing.length === 0, "and every part is still there to finish again");
  assert.equal((await h.fetch(`/api/workspace/move/upload/${id}`, { method: "DELETE" })).status, 200);
  assert.equal((await h.fetch(`/api/workspace/move/upload/${id}`)).status, 404);
  // a phone or a page from elsewhere gets nothing here
  assert.notEqual((await h.fetchRemote("/api/workspace/move/upload", { method: "POST", body: JSON.stringify({ size: 10 }) })).status, 201);
});
