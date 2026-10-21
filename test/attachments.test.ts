// Chips in, one plain prompt out.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import {
  CLOUD_IMAGE_BYTES,
  LONG_EDGE,
  OLDER_SERVER_IMAGE_BYTES,
  composeOutgoing,
  fileAttachment,
  firstTry,
  fitImage,
  imageNeeds,
  intakeFiles,
  isHeic,
  isLongPaste,
  nextTry,
  pasteAttachment,
  splitAttachments,
  attachmentBasename,
  formatBytes,
  uploadImageAttachment,
  type ImageAttachment,
  type ImageTools,
  type JpegTry,
} from "../src/lib/attachments.ts";
import { extensionFor } from "../server/attachments.ts";

const textFile = (name: string, contents: string) => ({
  name,
  size: contents.length,
  type: "text/plain",
  text: async () => contents,
});

describe("isLongPaste", () => {
  test("short text is typing, long text is a chip", () => {
    assert.equal(isLongPaste("hello there"), false);
    assert.equal(isLongPaste("x".repeat(900)), true);
    assert.equal(isLongPaste(Array(12).fill("line").join("\n")), true);
  });
});

describe("intakeFiles", () => {
  const image = (name: string): ImageAttachment => ({
    kind: "image",
    id: "i1",
    path: `/tmp/${name}`,
    name,
    bytes: 10,
    mime: "image/png",
  });

  test("images upload, pathed files keep their path, order survives", async () => {
    const files = [
      { name: "shot.png", size: 10, type: "image/png", text: async () => "" },
      textFile("notes.txt", "hello"),
    ];
    const { attachments, refused } = await intakeFiles(files, {
      pathOf: (f) => (f.name === "notes.txt" ? "/Users/h/notes.txt" : ""),
      uploadImage: async (f) => image(f.name),
    });
    assert.equal(refused, null);
    assert.deepEqual(
      attachments.map((a) => a.kind),
      ["image", "file"],
    );
  });

  test("a pathless text drop keeps its contents inline", async () => {
    const { attachments } = await intakeFiles([textFile("snippet.txt", "line one\nline two")], {
      pathOf: () => "",
      uploadImage: async () => null,
    });
    assert.equal(attachments[0]?.kind, "paste");
    assert.equal((attachments[0] as { text: string }).text, "line one\nline two");
  });

  test("nothing is dropped in silence", async () => {
    const { attachments, refused } = await intakeFiles(
      [{ name: "movie.mp4", size: 5, type: "video/mp4", text: async () => "" }],
      { pathOf: () => "", uploadImage: async () => null },
    );
    assert.equal(attachments.length, 0);
    assert.match(refused ?? "", /movie\.mp4/);
  });

  test("a failed upload becomes a sentence, not an exception", async () => {
    const { attachments, refused } = await intakeFiles(
      [{ name: "big.png", size: 10, type: "image/png", text: async () => "" }],
      {
        pathOf: () => "",
        uploadImage: async () => {
          throw new Error("big.png is over 10 MB");
        },
      },
    );
    assert.equal(attachments.length, 0);
    assert.match(refused ?? "", /over 10 MB/);
  });
});

describe("composeOutgoing and splitAttachments", () => {
  test("chips fold into tagged blocks after the typed text", () => {
    const prompt = composeOutgoing("look at this", [
      fileAttachment("a.ts", "/src/a.ts", 10),
      pasteAttachment("some\npasted\ntext"),
    ]);
    assert.ok(prompt.startsWith("look at this"));
    assert.ok(prompt.includes('<attached-file path="/src/a.ts" />'));
    assert.ok(prompt.includes("<pasted-text>\nsome\npasted\ntext\n</pasted-text>"));
  });

  test("a hostile filename stays inside its attribute", () => {
    const prompt = composeOutgoing("", [fileAttachment("x", '/tmp/a"><evil>.txt', 1)]);
    assert.ok(!prompt.includes('"><evil>'));
    const { files } = splitAttachments(prompt);
    assert.deepEqual(files, ['/tmp/a"><evil>.txt']);
  });

  test("images round-trip out of the transcript text", () => {
    const prompt = composeOutgoing("here", [
      { kind: "image", id: "i", path: "/tmp/att/abc.png", name: "s.png", bytes: 5, mime: "image/png" },
    ]);
    const { display, images } = splitAttachments(prompt);
    assert.equal(display, "here");
    assert.deepEqual(images, ["/tmp/att/abc.png"]);
  });

  test("attachments alone make a sendable prompt", () => {
    const prompt = composeOutgoing("   ", [fileAttachment("a", "/a", 1)]);
    assert.equal(prompt, '<attached-file path="/a" />');
  });
});

describe("small helpers", () => {
  test("basename handles both slash directions", () => {
    assert.equal(attachmentBasename("/tmp/att/abc.png"), "abc.png");
    assert.equal(attachmentBasename("C:\\att\\abc.png"), "abc.png");
  });

  test("sizes read like a human wrote them", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  });

  test("only real image types earn an extension", () => {
    assert.equal(extensionFor("image/png"), "png");
    assert.equal(extensionFor("image/jpeg; charset=binary"), "jpg");
    assert.equal(extensionFor("image/svg+xml"), null);
    assert.equal(extensionFor("text/html"), null);
    assert.equal(extensionFor(undefined), null);
  });
});

// ── pictures made to fit (GitHub 333) ──────────────────────────────────

const jpegOf = (size: number) => new Blob([Buffer.concat([Buffer.from("ffd8ffe0", "hex"), randomBytes(size - 4)])], { type: "image/jpeg" });
const pngFile = (size: number, name = "shot.png") =>
  new File([Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(size - 8)])], name, { type: "image/png" });
const heicFile = (size = 2_000_000, type = "") => new File([randomBytes(size)], "IMG_0001.HEIC", { type });
const MB10 = 10 * 1024 * 1024;

/** A page's canvas, played: a picture opens at the size given, and a JPEG
 * of it comes out at `perPixel` bytes a pixel at quality 0.85, fewer as the
 * quality drops. Like Chromium's, it cannot read a HEIC photo; `heic` is
 * what the desktop app's converter hands back for one. */
function playedTools(options: { width?: number; height?: number; perPixel?: number; heic?: Blob | null } = {}) {
  const tries: JpegTry[] = [];
  const tools: ImageTools = {
    async open(image) {
      if (isHeic(image)) return null;
      return {
        width: options.width ?? 4032,
        height: options.height ?? 3024,
        jpeg: async (at) => {
          tries.push(at);
          return jpegOf(Math.round((at.width * at.height * (options.perPixel ?? 0.3) * at.quality) / 0.85));
        },
        close() {},
      };
    },
    heicAsJpeg: async () => options.heic ?? null,
  };
  return { tools, tries };
}

/** A server that says where it is (null: one older than 3.0, which knows
 * neither that nor parts) and notes what it was sent. */
function playedServer(where: Record<string, unknown> | null) {
  const sent: Array<{ path: string; type: string; bytes: number }> = [];
  let size = 0;
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetcher = async (path: string, init?: RequestInit) => {
    const unknown = () => answer(404, { error: "not found", code: "unknown_route" });
    if (path === "/api/attachments/where") return where ? answer(200, where) : unknown();
    if (path === "/api/attachments/uploads") {
      if (!where) return unknown();
      const started = JSON.parse(String(init?.body));
      size = started.size;
      sent.push({ path, type: started.type, bytes: started.size });
      return answer(201, { id: "00000000-0000-4000-8000-000000000000", partSize: 384 * 1024, parts: Math.ceil(size / (384 * 1024)) });
    }
    if (path.endsWith("/finish")) return answer(200, { kind: "image", path: "/srv/.bloks/attachments/a.jpg", mime: "image/jpeg", bytes: size });
    if (path.startsWith("/api/attachments/uploads/")) return answer(200, { received: 1 });
    const body = init?.body as Uint8Array;
    sent.push({ path, type: String((init?.headers as Record<string, string>)["content-type"]), bytes: body.length });
    return answer(200, { path: "/srv/.bloks/attachments/b.jpg", mime: "image/jpeg", bytes: body.length });
  };
  return { fetcher, sent };
}

const cloudWhere = { sameComputer: false, throughCloud: true, partBytes: 384 * 1024, imageMaxBytes: MB10 };

describe("what a picture needs before it goes", () => {
  test("one that fits goes as it is, a PNG screenshot staying a PNG; one over is made a JPEG; a GIF is never made one", () => {
    assert.equal(imageNeeds({ type: "image/png", size: 500_000 }, CLOUD_IMAGE_BYTES), "as-is");
    assert.equal(imageNeeds({ type: "image/png", size: 5_000_000 }, CLOUD_IMAGE_BYTES), "jpeg");
    assert.equal(imageNeeds({ type: "image/jpeg", size: 3_000_000 }, CLOUD_IMAGE_BYTES), "jpeg");
    assert.equal(imageNeeds({ type: "image/webp", size: 900_000 }, CLOUD_IMAGE_BYTES), "jpeg");
    assert.equal(imageNeeds({ type: "image/gif", size: 700_000 }, CLOUD_IMAGE_BYTES), "as-is");
    assert.equal(imageNeeds({ type: "image/gif", size: 900_000 }, CLOUD_IMAGE_BYTES), "too-big", "a JPEG of a GIF stops it moving");
  });

  test("a HEIC photo is always made a JPEG, known by its type or, with none, by its name", () => {
    assert.equal(imageNeeds({ type: "image/heic", size: 10 }, CLOUD_IMAGE_BYTES), "jpeg");
    assert.equal(imageNeeds({ type: "", name: "IMG_0001.HEIC", size: 10 }, CLOUD_IMAGE_BYTES), "jpeg");
    assert.ok(isHeic({ type: "image/heif" }) && isHeic({ type: "", name: "x.heif" }));
    assert.equal(isHeic({ type: "image/png", name: "shot.png" }), false);
  });

  test("the budgets, from what the line carries", () => {
    // an upload is about 2.37 times its size on the line: under the
    // relay's 2,000,000 bytes a request, and, for a server before 3.0,
    // under the 1,000,000 characters its reader took of a frame
    assert.ok(CLOUD_IMAGE_BYTES * 2.371 < 2_000_000);
    assert.ok(OLDER_SERVER_IMAGE_BYTES * 2.371 < 1_000_000);
  });

  test("a JPEG is tried at the picture's own size up to the long edge, then smaller, until it fits or is not worth sending", () => {
    assert.deepEqual(firstTry(4032, 3024), { width: LONG_EDGE, height: 1920, quality: 0.85 });
    assert.deepEqual(firstTry(1200, 800), { width: 1200, height: 800, quality: 0.85 });
    const next = nextTry({ width: 2560, height: 1920, quality: 0.85 }, 1_600_000, 800_000)!;
    assert.ok(next.width < 2560 * 0.71 && next.width > 2560 * 0.6, `${next.width}`);
    assert.equal(next.quality, 0.75);
    // never less than a tenth smaller, however close the last one came
    assert.ok(nextTry({ width: 2000, height: 1000, quality: 0.85 }, 800_001, 800_000)!.width <= 1800);
    assert.equal(nextTry({ width: 700, height: 500, quality: 0.6 }, 2_000_000, 800_000), null);
  });
});

describe("fitImage", () => {
  test("a screenshot that fits is the very file; one that does not comes out a JPEG under the budget", async () => {
    const { tools, tries } = playedTools();
    const small = pngFile(300_000);
    assert.equal(await fitImage(small, CLOUD_IMAGE_BYTES, tools), small);
    assert.equal(tries.length, 0, "nothing was drawn for a picture that fits");
    const fitted = await fitImage(pngFile(6_000_000), CLOUD_IMAGE_BYTES, tools);
    assert.equal(fitted?.type, "image/jpeg");
    assert.ok(fitted!.size <= CLOUD_IMAGE_BYTES, `${fitted!.size}`);
    assert.equal(tries[0]!.width, LONG_EDGE);
    assert.ok(tries.length <= 3, `${tries.length} tries`);
  });

  test("one over the budget that cannot be made smaller here is null, for the caller to decide", async () => {
    const { tools } = playedTools();
    assert.equal(await fitImage(new File([randomBytes(900_000)], "a.gif", { type: "image/gif" }), CLOUD_IMAGE_BYTES, tools), null);
    const unreadable: ImageTools = { open: async () => null, heicAsJpeg: async () => null };
    assert.equal(await fitImage(pngFile(900_000), CLOUD_IMAGE_BYTES, unreadable), null);
  });

  test("a HEIC photo goes as the JPEG the desktop app makes of it, made smaller again when that is over", async () => {
    const converted = jpegOf(3_000_000);
    const { tools } = playedTools({ heic: converted });
    assert.equal(await fitImage(heicFile(), MB10, tools), converted, "the app's own server takes the JPEG as made");
    const fitted = await fitImage(heicFile(), CLOUD_IMAGE_BYTES, tools);
    assert.equal(fitted?.type, "image/jpeg");
    assert.ok(fitted!.size <= CLOUD_IMAGE_BYTES);
  });

  test("a HEIC photo this window cannot make a JPEG of says so", async () => {
    const { tools } = playedTools({ heic: null });
    await assert.rejects(fitImage(heicFile(), CLOUD_IMAGE_BYTES, tools), (error: Error & { unconverted?: boolean }) => {
      assert.equal(error.unconverted, true);
      assert.match(error.message, /HEIC photo, which has to go as a JPEG, and this window cannot make one/);
      return true;
    });
  });
});

describe("a picture on its way to a server elsewhere", () => {
  test("through Bloks Cloud it goes as a JPEG that fits; on the server's own network, as it is", async () => {
    const { tools } = playedTools();
    const cloud = playedServer(cloudWhere);
    const sent = await uploadImageAttachment(pngFile(6_000_000), cloud.fetcher, tools);
    assert.equal(cloud.sent[0]!.type, "image/jpeg");
    assert.ok(cloud.sent[0]!.bytes <= CLOUD_IMAGE_BYTES, `${cloud.sent[0]!.bytes}`);
    assert.equal(sent?.name, "shot.jpg", "the chip names what was sent");

    const lan = playedServer({ ...cloudWhere, throughCloud: false });
    await uploadImageAttachment(pngFile(6_000_000), lan.fetcher, tools);
    assert.deepEqual(lan.sent.map((s) => [s.type, s.bytes]), [["image/png", 6_000_000]]);
  });

  test("to a server older than 3.0, in one request small enough for the reader it has", async () => {
    const { tools } = playedTools();
    const older = playedServer(null);
    await uploadImageAttachment(pngFile(6_000_000), older.fetcher, tools);
    const whole = older.sent.find((s) => s.path === "/api/attachments")!;
    assert.equal(whole.type, "image/jpeg");
    assert.ok(whole.bytes <= OLDER_SERVER_IMAGE_BYTES, `${whole.bytes}`);
    // a GIF is not made a JPEG, so one too big says why
    const gif = new File([randomBytes(500_000)], "party.gif", { type: "image/gif" });
    await assert.rejects(uploadImageAttachment(gif, playedServer(null).fetcher, tools), /it is a GIF of 488\.3 KB, .*too large to send through Bloks Cloud/);
  });

  test("a HEIC photo goes as a JPEG; one that cannot be made one is said, or goes by its path to the app's own server", async () => {
    const converted = jpegOf(500_000);
    const cloud = playedServer(cloudWhere);
    const { attachments, refused } = await intakeFiles([heicFile()], {
      pathOf: () => "/Users/someone/Pictures/IMG_0001.HEIC",
      uploadImage: (f) => uploadImageAttachment(f, cloud.fetcher, playedTools({ heic: converted }).tools),
      uploadFile: async () => assert.fail("a HEIC photo was sent as a file"),
      sameComputer: false,
    });
    assert.equal(refused, null);
    assert.equal(attachments[0]?.kind, "image");
    assert.deepEqual(cloud.sent.map((s) => [s.type, s.bytes]), [["image/jpeg", 500_000]]);

    const cannot = playedTools({ heic: null }).tools;
    const elsewhere = await intakeFiles([heicFile(2_000_000, "image/heic")], {
      pathOf: () => "/Users/someone/Pictures/IMG_0001.HEIC",
      uploadImage: (f) => uploadImageAttachment(f, cloud.fetcher, cannot),
      uploadFile: async () => assert.fail("a HEIC photo was sent as a file"),
      sameComputer: false,
    });
    assert.deepEqual(elsewhere.attachments, [], "never a path the server cannot open");
    assert.equal(
      elsewhere.refused,
      "IMG_0001.HEIC: it is a HEIC photo, which has to go as a JPEG, and this window cannot make one. Export it as a JPEG and attach that",
    );

    const own = playedServer({ sameComputer: true, partBytes: 384 * 1024, imageMaxBytes: MB10 });
    const here = await intakeFiles([heicFile()], {
      pathOf: () => "/Users/someone/Pictures/IMG_0001.HEIC",
      uploadImage: (f) => uploadImageAttachment(f, own.fetcher, cannot),
      sameComputer: true,
    });
    assert.equal(here.refused, null);
    assert.deepEqual(here.attachments.map((a) => [a.kind, (a as { path: string }).path]), [["file", "/Users/someone/Pictures/IMG_0001.HEIC"]]);
  });
});
