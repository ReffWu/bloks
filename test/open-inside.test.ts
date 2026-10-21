// A file served from a folder is the file that was judged to be inside it
// (GitHub 318). Checking a name and then opening it by the same name is two
// lookups, and whatever can write in the folder can swap the file, or a
// folder above it, for a link out between them. So the open comes first,
// and the judgement, the size and the bytes are all asked of the one open
// file. The swaps here are made at the exact moment that matters, through
// the test hook between the judgement and the open, or right after the
// open has answered, before a byte is read.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { after, afterEach, describe, test } from "node:test";

// Every module below reads the data folder's place as it loads, so it is a
// throwaway before any of them is imported. Nothing here reaches ~/.bloks.
const home = realpathSync(mkdtempSync(join(tmpdir(), "bloks-open-inside-")));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.BLOKS_DATA_DIR = join(home, ".bloks");
const { closeHeld, openHooks, openInside, readHeld, streamHeld } = await import("../server/open-inside.ts");
const artifacts = await import("../server/artifacts.ts");
const attachments = await import("../server/attachments.ts");
const skills = await import("../server/skills.ts");
const app = await import("../electron/open-inside.mjs");
after(() => rmSync(home, { recursive: true, force: true }));
afterEach(() => {
  openHooks.beforeOpen = undefined;
  app.openHooks.beforeOpen = undefined;
});

const read = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

/** A folder to serve from, with a file and a folder in it, and a secret
 * beside it that nothing may reach. */
function fixture() {
  const base = mkdtempSync(join(home, "case-"));
  const root = join(base, "root");
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(join(root, "note.txt"), "inside");
  writeFileSync(join(root, "reports", "q3.txt"), "inside q3");
  const outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "note.txt"), "OUTSIDE SECRET, longer than the file it replaces");
  writeFileSync(join(outside, "q3.txt"), "OUTSIDE SECRET q3");
  return { root, outside };
}

/** The file at `path` replaced by a link to `to`. */
const swapFile = (path: string, to: string) => {
  unlinkSync(path);
  symlinkSync(to, path);
};
/** The folder at `path` moved aside and a link to `to` put in its place. */
const swapFolder = (path: string, to: string) => {
  renameSync(path, `${path}-moved`);
  symlinkSync(to, path);
};

/** How many descriptors this process holds. Counted, not named, since a
 * closed number is soon somebody else's. */
const descriptors = () => readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;

describe("opening a file inside a folder", () => {
  test("a file inside is opened, and its size and bytes come from the open file", async () => {
    const { root } = fixture();
    const held = openInside(root, ["reports", "q3.txt"])!;
    assert.ok(held);
    assert.equal(held.stat.size, "inside q3".length);
    assert.equal(await read(streamHeld(held)), "inside q3");
    const again = openInside(root, "note.txt")!;
    assert.equal(readHeld(again)?.toString("utf8"), "inside");
  });

  test("a link already leading out is refused, at the file or at a folder above it", () => {
    const { root, outside } = fixture();
    symlinkSync(join(outside, "note.txt"), join(root, "escape.txt"));
    symlinkSync(outside, join(root, "elsewhere"));
    assert.equal(openInside(root, ["escape.txt"]), null);
    assert.equal(openInside(root, ["elsewhere", "note.txt"]), null);
    // and the folder itself, or a climb, is not a file
    assert.equal(openInside(root, ["reports"]), null);
    assert.equal(openInside(root, ["..", "outside", "note.txt"]), null);
    assert.equal(openInside(root, ["reports", "..", "..", "outside", "note.txt"]), null);
  });

  test("a link that stays inside is followed, the way it always was", () => {
    const { root } = fixture();
    symlinkSync(join(root, "reports", "q3.txt"), join(root, "latest.txt"));
    symlinkSync(join(root, "reports"), join(root, "current"));
    assert.equal(readHeld(openInside(root, ["latest.txt"])!)?.toString("utf8"), "inside q3");
    assert.equal(readHeld(openInside(root, ["current", "q3.txt"])!)?.toString("utf8"), "inside q3");
  });

  test("a pipe where a file should be is refused at once rather than waited on", { skip: process.platform === "win32" }, () => {
    const { root } = fixture();
    execFileSync("mkfifo", [join(root, "pipe.txt")]);
    assert.equal(openInside(root, ["pipe.txt"]), null);
  });

  test("the file swapped for a link out between the check and the open is refused", () => {
    const { root, outside } = fixture();
    let swapped = false;
    openHooks.beforeOpen = (path) => {
      swapFile(path, join(outside, "note.txt"));
      swapped = true;
    };
    assert.equal(openInside(root, ["note.txt"]), null);
    assert.ok(swapped, "the swap never happened, so the test proves nothing");
  });

  test("a folder above it swapped for a link out between the check and the open is refused", () => {
    const { root, outside } = fixture();
    let swapped = false;
    openHooks.beforeOpen = () => {
      swapFolder(join(root, "reports"), outside);
      swapped = true;
    };
    assert.equal(openInside(root, ["reports", "q3.txt"]), null);
    assert.ok(swapped);
  });

  test("a swap after the open changes nothing: the bytes are the open file's, whole or a range", async () => {
    const { root, outside } = fixture();
    const whole = openInside(root, ["note.txt"])!;
    const part = openInside(root, ["reports", "q3.txt"])!;
    swapFile(join(root, "note.txt"), join(outside, "note.txt"));
    swapFolder(join(root, "reports"), outside);
    assert.equal(await read(streamHeld(whole)), "inside");
    assert.equal(await read(streamHeld(part, { start: 3, end: 5 })), "ide");
  });

  test("every open is let go: streamed to the end, read whole, closed unread, or refused", async () => {
    const { root, outside } = fixture();
    symlinkSync(join(outside, "note.txt"), join(root, "escape.txt"));
    const before = descriptors();
    for (let i = 0; i < 40; i++) {
      await read(streamHeld(openInside(root, ["note.txt"])!));
      await read(streamHeld(openInside(root, ["note.txt"])!, { start: 1, end: 2 }));
      readHeld(openInside(root, ["note.txt"])!);
      // a file bigger than the reader takes is refused, and still let go
      assert.equal(readHeld(openInside(root, ["note.txt"])!, 2), null);
      closeHeld(openInside(root, ["note.txt"])!);
      assert.equal(openInside(root, ["escape.txt"]), null);
      // a stream nobody reads to the end, destroyed the way a viewer
      // hanging up destroys it
      const stream = streamHeld(openInside(root, ["note.txt"])!);
      await new Promise((resolve) => {
        stream.once("close", resolve);
        stream.destroy();
      });
    }
    assert.ok(descriptors() - before < 5, `${descriptors() - before} descriptors were left open`);
    const held = openInside(root, ["note.txt"])!;
    const fd = held.fd;
    await read(streamHeld(held));
    assert.throws(() => fstatSync(fd), /EBADF/);
    // and once handed over, it cannot be closed a second time by number
    assert.equal(held.fd, -1);
    closeHeld(held);
  });
});

describe("a shared file, as the artifact route opens it", () => {
  const files = (botId: string) => join(home, ".bloks", "artifacts", botId);
  const setup = (botId: string) => {
    const dir = artifacts.artifactsDir(botId);
    mkdirSync(join(dir, "reports"), { recursive: true });
    writeFileSync(join(dir, "note.txt"), "inside");
    writeFileSync(join(dir, "reports", "q3.txt"), "inside q3");
    const outside = mkdtempSync(join(home, "outside-"));
    writeFileSync(join(outside, "note.txt"), "OUTSIDE SECRET, longer than the file it replaces");
    writeFileSync(join(outside, "q3.txt"), "OUTSIDE SECRET q3");
    return { dir, outside };
  };

  test("the file replaced by a link out after it is opened, before it is read: the inside bytes, at the inside size", async () => {
    const { dir, outside } = setup("leaf");
    const opened = artifacts.openArtifact("leaf", "note.txt")!;
    assert.ok(opened);
    swapFile(join(dir, "note.txt"), join(outside, "note.txt"));
    const body = await read(opened.stream());
    assert.equal(body, "inside");
    // what the route says the length is, is the length of what it sends
    assert.equal(opened.size, Buffer.byteLength(body));
  });

  test("the same for a range, the way a video player seeks", async () => {
    const { dir, outside } = setup("range");
    const opened = artifacts.openArtifact("range", "note.txt")!;
    swapFile(join(dir, "note.txt"), join(outside, "note.txt"));
    const range = artifacts.parseRange("bytes=0-", opened.size)!;
    assert.equal(await read(opened.stream(range)), "inside");
    const tail = artifacts.parseRange("bytes=-3", opened.size)!;
    const again = artifacts.openArtifact("range", "note.txt");
    // and once the link is there, nothing opens by that name at all
    assert.equal(again, null);
    assert.ok(tail);
  });

  test("a folder above it replaced by a link out after it is opened", async () => {
    const { dir, outside } = setup("ancestor");
    const opened = artifacts.openArtifact("ancestor", "reports/q3.txt")!;
    swapFolder(join(dir, "reports"), outside);
    assert.equal(await read(opened.stream()), "inside q3");
    assert.equal(artifacts.openArtifact("ancestor", "reports/q3.txt"), null);
    assert.equal(artifacts.artifactInfo("ancestor", "reports/q3.txt"), null);
  });

  test("a swap at the moment between the check and the open finds nothing to send", () => {
    const { dir, outside } = setup("boundary");
    openHooks.beforeOpen = () => swapFile(join(dir, "note.txt"), join(outside, "note.txt"));
    assert.equal(artifacts.openArtifact("boundary", "note.txt"), null);
    openHooks.beforeOpen = () => swapFolder(join(dir, "reports"), outside);
    assert.equal(artifacts.openArtifact("boundary", "reports/q3.txt"), null);
    openHooks.beforeOpen = undefined;
    // the names that answer whether a file is shared judge the same way
    assert.equal(artifacts.artifactPath("boundary", "note.txt"), null);
    assert.equal(artifacts.fingerprint("boundary", "reports/q3.txt"), null);
  });

  test("a link out that was there all along is never opened, and one inside still is", () => {
    const { dir, outside } = setup("planted");
    symlinkSync(join(outside, "note.txt"), join(dir, "escape.txt"));
    symlinkSync(join(dir, "reports", "q3.txt"), join(dir, "latest.txt"));
    assert.equal(artifacts.openArtifact("planted", "escape.txt"), null);
    const latest = artifacts.openArtifact("planted", "latest.txt")!;
    assert.equal(latest.read()?.toString("utf8"), "inside q3");
    assert.equal(latest.name, "latest.txt");
    assert.equal(files("planted"), dir);
  });

  test("an open file the route does not send is let go", () => {
    setup("cleanup");
    const before = descriptors();
    for (let i = 0; i < 40; i++) {
      artifacts.openArtifact("cleanup", "note.txt")!.close();
      artifacts.artifactInfo("cleanup", "note.txt");
      artifacts.artifactPath("cleanup", "note.txt");
      artifacts.fingerprint("cleanup", "note.txt");
      artifacts.openArtifact("cleanup", "note.txt")!.read();
    }
    assert.ok(descriptors() - before < 5, `${descriptors() - before} descriptors were left open`);
  });
});

describe("the other places that serve a file from a folder", () => {
  test("a pasted image's name planted as a link out is not served", async () => {
    const dir = join(home, ".bloks", "attachments");
    mkdirSync(dir, { recursive: true });
    const secret = join(home, "secret.txt");
    writeFileSync(secret, "the key");
    const name = "00000000-0000-4000-8000-000000000000.png";
    symlinkSync(secret, join(dir, name));
    const kept = attachments.saveImage(Buffer.from("89504e470d0a1a0a0000", "hex"));
    const server = createServer((req, res: ServerResponse) => attachments.serveAttachment(req.url!.slice(1), res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      const planted = await fetch(`http://127.0.0.1:${port}/${name}`);
      assert.equal(planted.status, 404);
      assert.doesNotMatch(await planted.text(), /the key/);
      const real = await fetch(`http://127.0.0.1:${port}/${kept.split("/").pop()}`);
      assert.equal(real.status, 200);
      assert.equal(real.headers.get("content-length"), "10");
    } finally {
      server.close();
    }
  });

  test("a skill file that is a link out of the skills folder is not read into anything", () => {
    const dir = join(home, ".bloks", "skills");
    mkdirSync(dir, { recursive: true });
    const secret = join(home, "credentials.md");
    writeFileSync(secret, "---\nname: Leak\n---\nAWS_SECRET=hunter2");
    symlinkSync(secret, join(dir, "leak.md"));
    writeFileSync(join(dir, "real.md"), "---\nname: Real\n---\nDo the real thing.");
    symlinkSync(join(dir, "real.md"), join(dir, "alias.md"));
    const listed = skills.listSkills().filter((s) => s.source === "user");
    assert.deepEqual(listed.map((s) => s.id).sort(), ["alias", "real"]);
    assert.ok(!listed.some((s) => s.body.includes("hunter2")));
  });

  test("the app's own page server opens the same way", () => {
    const { root, outside } = fixture();
    symlinkSync(join(outside, "note.txt"), join(root, "escape.txt"));
    symlinkSync(join(root, "note.txt"), join(root, "alias.txt"));
    assert.equal(app.readInside(root, ["escape.txt"]), null);
    assert.equal(app.readInside(root, ["alias.txt"])?.toString("utf8"), "inside");
    assert.equal(app.readInside(root, ["note.txt"], 2), null);
    let swapped = false;
    app.openHooks.beforeOpen = () => {
      swapFolder(join(root, "reports"), outside);
      swapped = true;
    };
    assert.equal(app.readInside(root, ["reports", "q3.txt"]), null);
    assert.ok(swapped);
  });
});
