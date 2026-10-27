// A picture is a chip the moment it lands, and joins the message only once
// the server has it (GitHub 399).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import { intakeFiles, intakeImage, uploadImageAttachment, type Attachment, type ImageAttachment } from "../src/lib/attachments.ts";
import {
  addPending,
  heldLine,
  heldReady,
  removePending,
  retryPending,
  sendHeldBy,
  settlePending,
  takeReady,
  uploadingPending,
  type PendingImage,
} from "../src/lib/pendingImages.ts";

const image = (id: string): ImageAttachment => ({ kind: "image", id, path: `/srv/.bloks/attachments/${id}.png`, name: `${id}.png`, bytes: 4, mime: "image/png" });

/** A box as the composer keeps it: what is on its way, and the draft's
 * attachments, which only ever grow by what takeReady lets go, in order. */
function box() {
  let list: PendingImage<string>[] = [];
  const draft: Attachment[] = [];
  const released: string[] = [];
  const commit = (next: PendingImage<string>[]) => {
    const { list: left, ready, done } = takeReady(next);
    list = left;
    draft.push(...ready);
    released.push(...done.map((item) => item.preview));
  };
  return {
    get list() {
      return list;
    },
    draft,
    letGo: released,
    add: (...ids: string[]) => commit(addPending(list, ids.map((id) => ({ id, file: id, name: `${id}.png`, bytes: 4, preview: `blob:${id}` })))),
    uploading: (id: string, attempt = 1) => commit(uploadingPending(list, id, attempt)),
    ready: (id: string, attempt = 1) => commit(settlePending(list, id, attempt, { attachment: image(id) })),
    fail: (id: string, error = "upload failed", attempt = 1) => commit(settlePending(list, id, attempt, { error })),
    remove: (id: string) => {
      const { list: left, gone } = removePending(list, id);
      if (gone) released.push(gone.preview);
      commit(left);
    },
    retry: (id: string) => commit(retryPending(list, id)),
    stage: (id: string) => list.find((item) => item.id === id)?.stage ?? "gone",
  };
}

describe("pictures on their way", () => {
  test("each is a chip at once, preparing, in the order it came", () => {
    const b = box();
    b.add("a", "b");
    b.add("c");
    assert.deepEqual(b.list.map((item) => [item.id, item.stage]), [["a", "preparing"], ["b", "preparing"], ["c", "preparing"]]);
    assert.deepEqual(b.draft, [], "nothing joins the message before the server has it");
  });

  test("preparing, then uploading, then ready", () => {
    const b = box();
    b.add("a");
    b.uploading("a");
    assert.equal(b.stage("a"), "uploading");
    b.ready("a");
    assert.equal(b.stage("a"), "gone");
    assert.deepEqual(b.draft.map((a) => a.id), ["a"]);
    assert.deepEqual(b.letGo, ["blob:a"], "its preview is let go once the server's picture stands in");
  });

  test("each settles by itself, and the message keeps the order they came in", () => {
    const b = box();
    b.add("a", "b", "c");
    b.uploading("a");
    // the last is quick, the first slow: the quick one is ready on its chip
    b.ready("c");
    assert.equal(b.stage("c"), "ready", "one slow picture does not keep a quick one out of sight");
    assert.equal(b.stage("a"), "uploading");
    assert.equal(b.draft.length, 0, "but it does not jump the queue into the message");
    b.ready("a");
    assert.deepEqual(b.draft.map((a) => a.id), ["a"]);
    assert.deepEqual(heldReady(b.list).map((a) => a.id), ["c"], "c is ready, held behind b");
    b.ready("b");
    assert.deepEqual(b.draft.map((a) => a.id), ["a", "b", "c"]);
    assert.deepEqual(b.list, []);
  });

  test("one removed before it finishes never comes back", () => {
    const b = box();
    b.add("a", "b");
    b.uploading("a");
    b.ready("b");
    b.remove("a");
    assert.deepEqual(b.draft.map((a) => a.id), ["b"], "what waited behind it goes on");
    assert.ok(b.letGo.includes("blob:a"));
    // its upload comes back after all
    b.uploading("a");
    b.ready("a");
    b.fail("a");
    assert.deepEqual(b.draft.map((a) => a.id), ["b"]);
    assert.deepEqual(b.list, []);
  });

  test("one that fails stays, saying so, and a retry is a new try", () => {
    const b = box();
    b.add("a");
    b.uploading("a");
    b.fail("a", "it is 12.0 MB, too large to send through Bloks Cloud");
    assert.equal(b.stage("a"), "failed");
    assert.equal(b.list[0]!.error, "it is 12.0 MB, too large to send through Bloks Cloud");
    assert.equal(b.letGo.length, 0, "a failed picture keeps its preview for its chip");
    b.retry("a");
    assert.equal(b.stage("a"), "preparing");
    assert.equal(b.list[0]!.attempt, 2);
    assert.equal(b.list[0]!.error, undefined);
    // the first try answering late settles nothing
    b.ready("a", 1);
    assert.equal(b.stage("a"), "preparing");
    b.ready("a", 2);
    assert.deepEqual(b.draft.map((a) => a.id), ["a"]);
  });

  test("a retry touches only a failed one, and settling one twice is the first answer only", () => {
    const b = box();
    b.add("a", "b");
    b.retry("a");
    assert.equal(b.list[0]!.attempt, 1, "retrying one still going would start a second upload of it");
    b.fail("b");
    b.ready("b");
    assert.equal(b.stage("b"), "failed");
  });

  test("one that became nothing leaves no chip in the message", () => {
    const b = box();
    b.add("a", "b");
    b.fail("a");
    b.remove("a");
    const settled = settlePending(b.list, "b", 1, { attachment: null });
    const { list, ready, done } = takeReady(settled);
    assert.deepEqual([list, ready, done.map((item) => item.id)], [[], [], ["b"]]);
  });
});

describe("what Send does while a picture holds it", () => {
  test("nothing holds a box with no pictures on their way", () => {
    assert.equal(sendHeldBy([]), null);
    assert.equal(heldLine([]), null);
  });

  test("on its way, the message waits for it", () => {
    const b = box();
    b.add("a");
    assert.equal(sendHeldBy(b.list), "pending");
    assert.equal(heldLine(b.list), "Waiting for an image to upload.");
    b.add("b");
    b.uploading("b");
    assert.equal(heldLine(b.list), "Waiting for 2 images to upload.");
    b.ready("a");
    b.ready("b");
    assert.equal(sendHeldBy(b.list), null);
  });

  test("a ready one held behind another still holds Send", () => {
    const b = box();
    b.add("a", "b");
    b.ready("b");
    assert.equal(sendHeldBy(b.list), "pending", "a, still going, would be left out");
  });

  test("a failed one holds it until retried or removed, and says so before any still going", () => {
    const b = box();
    b.add("a", "b", "c");
    b.fail("a");
    assert.equal(sendHeldBy(b.list), "failed", "waiting will not fix a failed one");
    assert.equal(heldLine(b.list), "An image didn't upload. Retry or remove it to send.");
    b.fail("b");
    assert.equal(heldLine(b.list), "2 images didn't upload. Retry or remove them to send.");
    b.remove("a");
    b.remove("b");
    assert.equal(sendHeldBy(b.list), "pending");
    b.ready("c");
    assert.equal(sendHeldBy(b.list), null);
    assert.deepEqual(b.draft.map((a) => a.id), ["c"]);
  });
});

describe("the intake hands pictures over", () => {
  const png = (name: string) => ({ name, size: 4, type: "image/png", text: async () => "" });
  const txt = (name: string) => ({ name, size: 5, type: "text/plain", text: async () => "hello" });

  test("every picture at once, in order, before anything is awaited; files still come back as before", async () => {
    const handed: string[] = [];
    const going = intakeFiles([png("one.png"), txt("notes.txt"), png("two.png")], {
      pathOf: (f) => (f.name === "notes.txt" ? "/Users/h/notes.txt" : ""),
      uploadImage: async () => assert.fail("a picture handed over was uploaded here as well"),
      onImage: (f) => handed.push(f.name),
    });
    // synchronously: a paste shows its chips on the same frame
    assert.deepEqual(handed, ["one.png", "two.png"]);
    const { attachments, refused } = await going;
    assert.equal(refused, null);
    assert.deepEqual(attachments.map((a) => a.kind), ["file"]);
  });

  test("one picture alone says why it failed, in the words the tray uses", async () => {
    await assert.rejects(
      intakeImage(png("big.png"), {
        pathOf: () => "",
        uploadImage: async () => {
          throw new Error("big.png is over 10 MB");
        },
      }),
      /^Error: big\.png is over 10 MB$/,
    );
  });

  test("a HEIC photo this window cannot convert still goes by its path to the app's own server", async () => {
    const heic = { name: "IMG_0001.HEIC", size: 4, type: "", text: async () => "" };
    const unconverted = () => Promise.reject(Object.assign(new Error("cannot make a JPEG"), { unconverted: true }));
    const here = await intakeImage(heic, { pathOf: () => "/Users/h/IMG_0001.HEIC", uploadImage: unconverted, sameComputer: async () => true });
    assert.deepEqual([here?.kind, (here as { path?: string } | null)?.path], ["file", "/Users/h/IMG_0001.HEIC"]);
    await assert.rejects(
      intakeImage(heic, { pathOf: () => "/Users/h/IMG_0001.HEIC", uploadImage: unconverted, sameComputer: false }),
      /cannot make a JPEG/,
      "never a path the server cannot open",
    );
  });
});

describe("a picture says when it starts going up", () => {
  const pngFile = (size: number) =>
    new File([Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(size - 8)])], "shot.png", { type: "image/png" });
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  test("to the app's own server: after it is ready, before the bytes go", async () => {
    const order: string[] = [];
    const fetcher = async (path: string) => {
      order.push(path);
      if (path === "/api/attachments/where") return answer(200, { sameComputer: true });
      return answer(200, { path: "/srv/.bloks/attachments/b.png", mime: "image/png", bytes: 1000 });
    };
    const sent = await uploadImageAttachment(pngFile(1000), fetcher, undefined, () => order.push("uploading"));
    assert.equal(sent?.kind, "image");
    assert.deepEqual(order, ["/api/attachments/where", "uploading", "/api/attachments"]);
  });

  test("to a server elsewhere: before its first part", async () => {
    const order: string[] = [];
    const fetcher = async (path: string, init?: RequestInit) => {
      order.push(path);
      if (path === "/api/attachments/where") return answer(200, { sameComputer: false, throughCloud: false });
      if (path === "/api/attachments/uploads") {
        const size = JSON.parse(String(init?.body)).size;
        return answer(201, { id: "00000000-0000-4000-8000-000000000000", partSize: 384 * 1024, parts: Math.ceil(size / (384 * 1024)) });
      }
      if (path.endsWith("/finish")) return answer(200, { kind: "image", path: "/srv/a.png", mime: "image/png", bytes: 1000 });
      return answer(200, { received: 1 });
    };
    await uploadImageAttachment(pngFile(1000), fetcher, undefined, () => order.push("uploading"));
    assert.deepEqual(order.slice(0, 3), ["/api/attachments/where", "uploading", "/api/attachments/uploads"]);
  });

  test("one refused before it goes never says it is going up", async () => {
    let told = false;
    const fetcher = async () => answer(200, { sameComputer: false, throughCloud: false, imageMaxBytes: 500 });
    await assert.rejects(uploadImageAttachment(pngFile(1000), fetcher, undefined, () => (told = true)));
    assert.equal(told, false);
  });
});
