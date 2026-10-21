// Reading a file by name inside a folder, so that the file judged to be
// inside is the file that is read. A mirror of server/open-inside.ts for
// the app's own processes, which do not load the server's modules; see
// there for the whole of why.
//
// In short: the open comes first and refuses to cross a link put in the
// way since the name was judged (O_NOFOLLOW_ANY on macOS, the kernel's
// own record of the open file on Linux), and whether it is a regular file
// inside the folder, and its bytes, are asked of the open descriptor,
// never of the name again.
//
// Plain Node on purpose (no Electron imports), like remote.mjs.
import { closeSync, constants, fstatSync, openSync, readlinkSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/** open(2)'s "no link anywhere in this path" on macOS 11 and later. */
const O_NOFOLLOW_ANY = 0x20000000;

/** For tests only: called between the judgement and the open. */
export const openHooks = { beforeOpen: undefined };

/** Whether a real path is strictly below a real folder. */
export function within(root, path) {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function flags() {
  const base = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
  if (process.platform === "darwin") return base | O_NOFOLLOW_ANY;
  return base | (constants.O_NOFOLLOW ?? 0);
}

function heldInside(fd, root, path, stat) {
  if (process.platform === "darwin") return true;
  if (process.platform === "linux") {
    try {
      return within(root, readlinkSync(`/proc/self/fd/${fd}`).replace(/ \(deleted\)$/, ""));
    } catch {
      return false;
    }
  }
  try {
    const now = realpathSync(path);
    const again = statSync(now);
    return within(root, now) && again.dev === stat.dev && again.ino === stat.ino;
  } catch {
    return false;
  }
}

/** The regular file `name` names inside `root`, open, as { fd, stat,
 * path }, or null. The caller closes it. */
export function openInside(root, name) {
  const parts = typeof name === "string" ? name.split("/") : [...name];
  if (!parts.length || parts.some((p) => !p || p === "." || p === ".." || p.includes("/") || p.includes("\0"))) return null;
  let realRoot;
  let path;
  try {
    realRoot = realpathSync(root);
    path = realpathSync(join(realRoot, ...parts));
  } catch {
    return null;
  }
  if (!within(realRoot, path)) return null;
  openHooks.beforeOpen?.(path);
  let fd;
  try {
    fd = openSync(path, flags());
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (stat.isFile() && heldInside(fd, realRoot, path, stat)) return { fd, stat, path };
  } catch {}
  try {
    closeSync(fd);
  } catch {}
  return null;
}

/** The whole of the regular file `name` names inside `root`, read from
 * the descriptor that was judged, or null. */
export function readInside(root, name, max = Number.MAX_SAFE_INTEGER) {
  const held = openInside(root, name);
  if (!held) return null;
  try {
    if (held.stat.size > max) return null;
    const chunks = [];
    let total = 0;
    for (;;) {
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
    try {
      closeSync(held.fd);
    } catch {}
  }
}
