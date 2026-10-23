// Opening a file by name inside a folder, so that the file judged to be
// inside is the file that is read.
//
// Checking a path and then opening it by the same path is two lookups,
// and whatever can write in the folder can change what the second one
// finds: swap the file, or a folder above it, for a link out between the
// check and the open, and the bytes come from somewhere else while the
// check still says yes. So here the open comes first, and everything
// after it (is it a regular file, is it inside, how big, the bytes) is
// asked of the open descriptor, never of the name again.
//
// The open itself refuses to cross a link, on each platform by the means
// it has:
//
//   - macOS: O_NOFOLLOW_ANY, which refuses a link anywhere in the path,
//     not only at the end. The path opened is the real one, links already
//     resolved and judged inside, so any link found on the way at open
//     time is one somebody put there since.
//   - Linux: O_NOFOLLOW for the file itself, then the kernel's own record
//     of what was opened (/proc/self/fd), which names where the file
//     really is however the path got there. A folder swapped for a link
//     shows up there as a path outside.
//
// Elsewhere the same identity is asked twice, which narrows the window to
// almost nothing without being able to close it.
//
// A link that stays inside the folder is still followed, the way it
// always was: the name is resolved first, and only the place it resolves
// to is opened.
import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
  type ReadStream,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/** open(2)'s "no link anywhere in this path" on macOS 11 and later. Node
 * does not name it, so it is spelled out. */
const O_NOFOLLOW_ANY = 0x20000000;

/** A file that was open when it was judged, and is still. */
export interface HeldFile {
  /** The descriptor every answer below came from. */
  fd: number;
  /** What the descriptor says it is, not what the name says now. */
  stat: Stats;
  /** Where it was opened, links inside the folder resolved. */
  path: string;
}

/**
 * For tests only: called between the judgement of the name and the open,
 * which is exactly where a swap lands. Nothing outside a test sets it.
 */
export const openHooks: { beforeOpen?: (path: string) => void } = {};

/** Whether a real path is strictly below a real folder. */
export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function flags(): number {
  // never wait on a pipe somebody left where a file should be; a regular
  // file ignores the flag
  const base = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
  if (process.platform === "darwin") return base | O_NOFOLLOW_ANY;
  return base | (constants.O_NOFOLLOW ?? 0);
}

/** Whether the open descriptor is really inside, asked of the descriptor
 * and not of the name. */
function heldInside(fd: number, root: string, path: string, stat: Stats): boolean {
  if (process.platform === "darwin") return true; // the open refused any link
  if (process.platform === "linux") {
    let where: string;
    try {
      where = readlinkSync(`/proc/self/fd/${fd}`);
    } catch {
      // without /proc nothing can say where the descriptor is, and a
      // file that cannot be placed is not served
      return false;
    }
    return within(root, where.replace(/ \(deleted\)$/, ""));
  }
  try {
    const now = realpathSync(path);
    const again = statSync(now);
    return within(root, now) && again.dev === stat.dev && again.ino === stat.ino;
  } catch {
    return false;
  }
}

/**
 * The regular file `name` names inside `root`, open, or null. `name` is
 * a path relative to the folder, already judged as words by the caller
 * (no "..", nothing absolute); it is judged again here as the file it
 * really is. Whoever gets a HeldFile closes it: by streaming it, by
 * readHeld, or by closeHeld.
 */
export function openInside(root: string, name: string | readonly string[]): HeldFile | null {
  try {
    const found = openInsideOr(root, name);
    return typeof found === "string" ? null : found;
  } catch {
    return null;
  }
}

/**
 * The same, saying why there is nothing: "absent" when nothing is there
 * by that name, "outside" when something is but it is not a regular file
 * inside the folder (a link out, a folder, a pipe). Any other failure (a
 * file it may not read, a disk error) is thrown as it came, for a reader
 * that must not mistake an unreadable file for a missing one.
 */
export function openInsideOr(root: string, name: string | readonly string[]): HeldFile | "absent" | "outside" {
  const parts = typeof name === "string" ? name.split("/") : [...name];
  if (!parts.length || parts.some((p) => !p || p === "." || p === ".." || p.includes("/") || p.includes("\0"))) return "outside";
  const why = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return "absent" as const;
    // a link where the open refuses one
    if (code === "ELOOP" || code === "EMLINK") return "outside" as const;
    throw error;
  };
  let realRoot: string;
  let path: string;
  try {
    realRoot = realpathSync(root);
    path = realpathSync(join(realRoot, ...parts));
  } catch (error) {
    return why(error);
  }
  if (!within(realRoot, path)) return "outside";
  openHooks.beforeOpen?.(path);
  let fd: number;
  try {
    fd = openSync(path, flags());
  } catch (error) {
    return why(error);
  }
  try {
    const stat = fstatSync(fd);
    if (stat.isFile() && heldInside(fd, realRoot, path, stat)) return { fd, stat, path };
  } catch (error) {
    closeHeld({ fd });
    throw error;
  }
  closeHeld({ fd });
  return "outside";
}

/**
 * The regular file at an absolute `path`, open, when it really is inside
 * one of `roots` (links followed, then judged inside, as openInside does
 * with a name) and nothing on the way to it from there is hidden; or why
 * not: "absent", "folder", "hidden" (a dot file or a dot folder, where a
 * key or a repository's history lives), or "outside". For a route that is
 * handed a path by an agent, so what it opens is a file in the agent's
 * own folders and that file alone.
 */
export function openUnder(roots: readonly string[], path: string): HeldFile | "absent" | "folder" | "hidden" | "outside" {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return "absent";
  }
  for (const root of roots) {
    let base: string;
    try {
      base = realpathSync(root);
    } catch {
      continue;
    }
    if (!within(base, real)) continue;
    const parts = relative(base, real).split(sep);
    if (parts.some((part) => part.startsWith("."))) return "hidden";
    try {
      if (statSync(real).isDirectory()) return "folder";
    } catch {
      return "absent";
    }
    return openInsideOr(base, parts);
  }
  return "outside";
}

/** Lets a held file go, once: the descriptor is forgotten as it is
 * closed, so a second call cannot close a number reused since. */
export function closeHeld(held: Pick<HeldFile, "fd">): void {
  const fd = held.fd;
  if (fd < 0) return;
  held.fd = -1;
  try {
    closeSync(fd);
  } catch {}
}

/** The bytes, all of them or a range, from the descriptor that was
 * judged. The stream closes it when it ends, fails or is destroyed. */
export function streamHeld(held: HeldFile, range?: { start: number; end: number }): ReadStream {
  // handed over: from here the stream is what closes it
  const fd = held.fd;
  if (fd < 0) throw new Error("that file was already let go");
  held.fd = -1;
  return createReadStream(held.path, {
    fd,
    autoClose: true,
    // a whole file is read from its first byte, wherever the descriptor
    // happens to stand
    start: range ? range.start : 0,
    ...(range ? { end: range.end } : {}),
  });
}

/** The whole file, from the descriptor that was judged, then closed. At
 * most `max` bytes are read; a file bigger than that is refused rather
 * than cut, since half a file read as a whole one is a quiet lie. */
export function readHeld(held: HeldFile, max = Number.MAX_SAFE_INTEGER): Buffer<ArrayBuffer> | null {
  try {
    if (held.stat.size > max) return null;
    const chunks: Buffer<ArrayBuffer>[] = [];
    let total = 0;
    for (;;) {
      // what is left by the size it had, and one more byte to see the end
      const chunk = Buffer.alloc(Math.min(Math.max(held.stat.size - total, 0) + 1, 1 << 20));
      const n = readSync(held.fd, chunk, 0, chunk.length, total);
      if (!n) break;
      total += n;
      if (total > max) return null;
      chunks.push(n === chunk.length ? chunk : chunk.subarray(0, n));
    }
    return Buffer.concat(chunks, total);
  } catch {
    return null;
  } finally {
    closeHeld(held);
  }
}
